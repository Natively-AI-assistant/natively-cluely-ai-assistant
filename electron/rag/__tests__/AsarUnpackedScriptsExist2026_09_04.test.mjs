/**
 * Rewriting a path to `app.asar.unpacked` and actually unpacking the file are
 * ONE decision. This pins them together.
 *
 * THE BUG. `resolveBundledScript` rewrote every resolved path from `app.asar`
 * to `app.asar.unpacked`, unconditionally. That is only correct for a file
 * `build.asarUnpack` was told to copy out. `fs.existsSync` returns true for a
 * path inside the archive — Electron patches fs so the asar looks like a
 * directory — so a candidate always "exists", the rewrite always fires, and for
 * any script NOT in asarUnpack the result is a path electron-builder never
 * wrote. The extension host bootstrap was exactly that: the dev-mode fix landed,
 * and packaged builds would have failed to fork it, silently, with every
 * extension dying at startup for the second time in one day.
 *
 * Nothing caught it because both path tests run against the unpacked
 * `dist-electron` tree, where no path contains `app.asar` and the rewrite never
 * fires. The rule cannot be checked by resolving; it has to be checked against
 * the packaging config.
 *
 * Run: `node --test electron/rag/__tests__/AsarUnpackedScriptsExist2026_09_04.test.mjs`
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

const { resolveBundledScript, resolveRagWorker } =
  require(path.join(repoRoot, 'dist-electron/electron/rag/resolveRagWorker.js'));

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const UNPACK = pkg.build.asarUnpack ?? [];

/** Does any asarUnpack glob cover this dist-relative path? */
function isUnpacked(relPath) {
  return UNPACK.some((g) => {
    // Order matters, and getting it wrong is silent. Expanding `**/` to
    // `(.*/)?` FIRST and then replacing `*` rewrites the `*` inside the
    // `(.*/)?` that was just inserted, producing `(.[^/]*/)?` — which matches
    // almost nothing. So the two wildcards are swapped for placeholders before
    // either expansion runs.
    const re = new RegExp('^' + g
      .replace(/\*\*\//g, '\u0000')
      .replace(/\*/g, '\u0001')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\u0000/g, '(?:.*/)?')
      .replace(/\u0001/g, '[^/]*') + '$');
    return re.test(relPath) || re.test(path.basename(relPath));
  });
}

test('the glob matcher itself works', () => {
  // It is the whole basis of this file, and its first version silently matched
  // nothing.
  assert.equal(isUnpacked('services/extensions/host/bootstrap.js'), true);
  assert.equal(isUnpacked('rag/localRerankerWorker.js'), true);
  assert.equal(isUnpacked('services/somethingElse.js'), false,
    'an unlisted script must NOT read as unpacked, or this file proves nothing');
});

/**
 * Every script the app resolves through the bundled-script resolver AND asks to
 * be unpacked. Adding a caller here without an asarUnpack glob fails.
 */
const UNPACKED_CALLERS = [
  { what: 'the ONNX reranker worker', segments: ['rag', 'localRerankerWorker.js'] },
  { what: 'the GGUF reranker worker', segments: ['rag', 'ggufRerankerWorker.js'] },
  { what: 'the extension host bootstrap', segments: ['services', 'extensions', 'host', 'bootstrap.js'] },
];

test('every script we rewrite out of the asar is actually unpacked', () => {
  for (const { what, segments } of UNPACKED_CALLERS) {
    const rel = segments.join('/');
    assert.ok(isUnpacked(rel),
      `${what} (${rel}) is rewritten to app.asar.unpacked but no build.asarUnpack `
      + 'glob copies it there — the rewritten path will not exist in a packaged build');
  }
});

test('and each of those files exists in the built output', () => {
  // An asarUnpack glob for a file that is never emitted is equally useless.
  for (const { what, segments } of UNPACKED_CALLERS) {
    const full = path.join(repoRoot, 'dist-electron', 'electron', ...segments);
    assert.ok(fs.existsSync(full), `${what} is not in dist-electron (${full})`);
  }
});

test('the asar rewrite is OPT-IN, not the default', () => {
  // The whole defect in one assertion: a caller that does not ask must not be
  // rewritten, or adding a resolver call silently breaks packaged builds.
  const asarDir = '/Applications/Natively.app/Contents/Resources/app.asar/dist-electron/electron';

  const notAsked = resolveBundledScript(asarDir, ['services', 'thing.js'], { exists: () => true });
  assert.ok(notAsked.includes('app.asar/'), `default must stay inside the archive: ${notAsked}`);
  assert.ok(!notAsked.includes('app.asar.unpacked'), notAsked);

  const asked = resolveBundledScript(asarDir, ['services', 'thing.js'],
    { exists: () => true, unpackFromAsar: true });
  assert.ok(asked.includes('app.asar.unpacked'), `opting in must rewrite: ${asked}`);
});

test('the rag workers still opt in — they load a native addon', () => {
  // onnxruntime / llama.cpp cannot be dlopened from inside an archive, so these
  // two must keep the rewrite regardless of what the default becomes.
  const asarDir = '/Applications/Natively.app/Contents/Resources/app.asar/dist-electron/electron/services/reranking';
  for (const worker of ['localRerankerWorker.js', 'ggufRerankerWorker.js']) {
    const resolved = resolveRagWorker(asarDir, worker, () => true);
    assert.ok(resolved.includes('app.asar.unpacked'), `${worker}: ${resolved}`);
    assert.ok(!/app\.asar(?!\.unpacked)/.test(resolved), `${worker} still points inside the archive: ${resolved}`);
  }
});

test('the extension host asks for the rewrite, and says why', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/services/extensions/ExtensionHost.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const fn = code.slice(code.indexOf('export function bootstrapPath'));
  assert.match(fn.slice(0, fn.indexOf('\n}')), /unpackFromAsar:\s*true/,
    'utilityProcess.fork needs a real file on disk, so the bootstrap must be unpacked');
});
