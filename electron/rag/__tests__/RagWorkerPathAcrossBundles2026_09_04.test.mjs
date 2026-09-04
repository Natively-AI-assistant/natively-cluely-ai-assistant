/**
 * The rerank workers must be findable from EVERY bundle that inlines them.
 *
 * The bug this exists for: `GgufReranker` and `LocalReranker` each resolved
 * their worker with three fixed candidates —
 *
 *     <__dirname>/<worker>.js
 *     <__dirname>/rag/<worker>.js
 *     <__dirname>/electron/rag/<worker>.js
 *
 * — which covers `electron/rag/` and `electron/` and nothing else. esbuild
 * builds one bundle per entry point and INLINES every module it imports, so
 * both classes exist in ~30 output files at four different depths, and
 * `__dirname` is the executing bundle's directory rather than the source file's.
 * The rerank seam lives under `services/`, where none of the three resolved.
 *
 * What that looked like in production: `buildLocalGgufPort()` returned a port,
 * the port spawned a Worker on a path that does not exist, `rerank()` caught the
 * error and returned null, and the seam read null as "keep the existing order".
 * All three GGUF rerankers scored nothing, with no error anywhere. MEASURED
 * before the fix: 0 of 10 benchmark queries produced a ranking; after: 8-9 of 10
 * had the known-correct passage first.
 *
 * These assertions are on the RESOLVER, driven by a simulated dist layout, so
 * they hold without building 30 bundles — and they fail if anyone reintroduces
 * depth guessing.
 *
 * Run: `node --test electron/rag/__tests__/RagWorkerPathAcrossBundles2026_09_04.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const { resolveRagWorker } = require(path.join(repoRoot, 'dist-electron/electron/rag/resolveRagWorker.js'));

const WORKERS = ['localRerankerWorker.js', 'ggufRerankerWorker.js'];

/** The real dist tree, so this tracks the layout that actually ships. */
const DIST = path.join(repoRoot, 'dist-electron');

/**
 * Directories the reranker classes are inlined into. Derived from the built
 * output rather than hardcoded: a new entry point at a new depth then has to
 * pass this test rather than silently becoming a fifth broken case.
 */
function bundleDirsInlining(sourceMarker) {
  const dirs = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      // Cheap containment check — esbuild writes the source path as a banner
      // comment above each inlined module.
      if (fs.readFileSync(p, 'utf8').includes(sourceMarker)) dirs.add(path.dirname(p));
    }
  };
  walk(DIST);
  return [...dirs];
}

test('every bundle that inlines LocalReranker can find its worker', () => {
  const dirs = bundleDirsInlining('// electron/rag/LocalReranker.ts');
  assert.ok(dirs.length > 1, `expected LocalReranker in several bundles, found ${dirs.length}`);
  const broken = dirs.filter(d => !fs.existsSync(resolveRagWorker(d, 'localRerankerWorker.js')));
  assert.deepEqual(broken.map(d => path.relative(DIST, d)), [],
    'these bundle depths cannot reach localRerankerWorker.js');
});

test('every bundle that inlines GgufReranker can find its worker', () => {
  const dirs = bundleDirsInlining('// electron/rag/GgufReranker.ts');
  assert.ok(dirs.length > 1, `expected GgufReranker in several bundles, found ${dirs.length}`);
  const broken = dirs.filter(d => !fs.existsSync(resolveRagWorker(d, 'ggufRerankerWorker.js')));
  assert.deepEqual(broken.map(d => path.relative(DIST, d)), [],
    'these bundle depths cannot reach ggufRerankerWorker.js');
});

test('the seam\'s own directory resolves — it is the one that was broken', () => {
  // services/reranking is where buildLocalGgufPort() runs, and services/modes
  // is where the seam calls it from. Named explicitly so the regression cannot
  // hide behind a directory listing that happens to come back empty.
  for (const dir of ['electron/services/reranking', 'electron/services/modes', 'electron/llm']) {
    for (const worker of WORKERS) {
      const resolved = resolveRagWorker(path.join(DIST, dir), worker);
      assert.ok(fs.existsSync(resolved), `${dir} cannot reach ${worker} (tried ${resolved})`);
    }
  }
});

test('resolution walks UP, and prefers the nearest match', () => {
  // A fake tree: the caller is three levels deep and the worker sits at the
  // electron root. Injected `exists` so this does not depend on the real dist.
  const present = new Set([
    '/app/electron/rag/w.js',
    '/app/electron/services/reranking/rag/w.js',   // a nearer, shadowing copy
  ]);
  const exists = (p) => present.has(p.split(path.sep).join('/'));

  assert.equal(
    resolveRagWorker('/app/electron/services/reranking', 'w.js', exists).split(path.sep).join('/'),
    '/app/electron/services/reranking/rag/w.js',
    'the nearest ancestor must win, so a nested app dir cannot be shadowed by an outer one');

  assert.equal(
    resolveRagWorker('/app/electron/services/modes', 'w.js', exists).split(path.sep).join('/'),
    '/app/electron/rag/w.js',
    'with no nearby copy it must keep ascending');
});

test('a file sitting beside the caller wins over any ancestor', () => {
  const present = new Set(['/app/electron/rag/w.js', '/app/electron/rag/rag/w.js']);
  const exists = (p) => present.has(p.split(path.sep).join('/'));
  assert.equal(
    resolveRagWorker('/app/electron/rag', 'w.js', exists).split(path.sep).join('/'),
    '/app/electron/rag/w.js');
});

test('an unfindable worker still returns a coherent path, not undefined', () => {
  // The caller spawns a Worker on whatever comes back. A path that does not
  // exist produces a clear MODULE_NOT_FOUND naming the file; `undefined` would
  // produce a TypeError inside worker_threads that names nothing.
  const resolved = resolveRagWorker('/nowhere/at/all', 'missing.js', () => false);
  assert.equal(typeof resolved, 'string');
  assert.ok(resolved.endsWith('missing.js'), resolved);
});

test('the asar rewrite survives, because a native addon cannot load from an archive', () => {
  const asar = '/Applications/Natively.app/Contents/Resources/app.asar/dist-electron/electron/services/reranking';
  const resolved = resolveRagWorker(asar, 'ggufRerankerWorker.js', () => true);
  assert.ok(resolved.includes('app.asar.unpacked'), resolved);
  assert.ok(!/app\.asar(?!\.unpacked)/.test(resolved), `still points inside the archive: ${resolved}`);
});

test('ascent is bounded, so a deep path cannot walk to the filesystem root forever', () => {
  const tried = [];
  resolveRagWorker('/a/b/c/d/e/f/g/h/i/j', 'w.js', (p) => { tried.push(p); return false; });
  // One "beside me" plus two per ancestor level, capped. The exact number is not
  // the contract; that it is bounded and small is.
  assert.ok(tried.length <= 32, `tried ${tried.length} paths — the ascent is not bounded`);
  assert.ok(tried.length >= 5, `tried only ${tried.length} paths — it is not ascending at all`);
});
