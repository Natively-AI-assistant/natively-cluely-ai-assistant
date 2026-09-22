/**
 * The bundled reranker must be findable without Electron, and a stale cache
 * must never win over the copy the repository ships.
 *
 * FOUND 2026-09-04. `LocalRerankerModel.test.mjs` was failing with
 * "Protobuf parsing failed". Every candidate in `resolveModelPath` is built
 * from Electron's `app`, so under `node --test` none were even constructed and
 * resolution fell through to the UNVERIFIED last resort, `<cwd>/models`. On
 * this machine that directory held a 230 MB truncated copy of a 279 MB model,
 * left over from an interrupted download. A truncated ONNX does not fail
 * loudly — it loads as a protobuf error, `isAvailable()` returns false, and
 * the reranker quietly disables itself ("rerank disabled, falling back to
 * top-K"). Nothing surfaced that.
 *
 * The fix adds two cwd-relative candidates, verified by the same marker, with
 * `resources/models` — the copy the repo ships — ahead of the ambiguous
 * `<cwd>/models` cache.
 *
 * Run in a child process with its own cwd, so the assertion is about the
 * resolver rather than about whatever happens to sit in this repo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
/**
 * The bundled default, read from the source rather than hardcoded.
 *
 * This suite is about PATH RESOLUTION, not about which model is bundled — but
 * it lays down markers under that model's id, so a hardcoded value silently
 * turns "resolution is broken" into "the default changed". It did exactly that
 * when ms-marco-MiniLM-L-6-v2 replaced bge-reranker-base on 2026-09-04.
 */
const MODEL_ID = (() => {
  const src = fs.readFileSync(path.resolve(repoRoot, 'electron/rag/LocalReranker.ts'), 'utf8');
  const m = src.match(/const DEFAULT_RERANKER_MODEL = '([^']+)'/);
  assert.ok(m, 'DEFAULT_RERANKER_MODEL is gone from LocalReranker.ts');
  return m[1];
})();

/** Lay down a marker (tokenizer.json) for MODEL_ID under each named root. */
function fixture(roots) {
  // realpath, not the raw mkdtemp path: on macOS os.tmpdir() is /var/..., a
  // symlink to /private/var/..., and the child's process.cwd() reports the
  // resolved form. Comparing the two spellings fails for no real reason.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reranker-shadow-')));
  for (const root of roots) {
    const target = path.join(dir, ...root.split('/'), ...MODEL_ID.split('/'));
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'tokenizer.json'), '{}');
  }
  return dir;
}

/** Resolve in a child process whose cwd is `dir`. Returns the chosen root. */
function resolveFrom(dir) {
  const script = `
    const { getLocalReranker } = require(${JSON.stringify(
      path.join(repoRoot, 'dist-electron/electron/rag/LocalReranker.js'))});
    process.stdout.write(String(getLocalReranker().modelPath));
  `;
  // HOME is redirected as well as cwd. resolveModelPath also consults
  // `<userData>/local-models`, and userData is derived from os.homedir() — so
  // whether this test passed depended on whether the DEFAULT model happened to
  // be installed on the developer's machine. It did not catch that until
  // ms-marco-MiniLM-L-6-v2 became the default and turned out to be installed
  // here, at which point three assertions failed for a reason that had nothing
  // to do with path precedence. Pointing HOME at an empty directory makes the
  // fixture the only thing that can answer.
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'reranker-home-'));
  return execFileSync(process.execPath, ['-e', script], {
    cwd: dir,
    encoding: 'utf8',
    // A stray NATIVELY_* override on the developer's shell would decide the
    // answer instead of the code under test.
    env: {
      ...process.env,
      NATIVELY_LOCAL_MODELS_PATH: '',
      NATIVELY_RERANKER_MODEL: '',
      HOME: emptyHome,            // POSIX
      USERPROFILE: emptyHome,     // Windows
    },
  }).trim();
}

test('the repo-shipped resources/models is found without Electron', () => {
  const dir = fixture(['resources/models']);
  assert.equal(resolveFrom(dir), path.join(dir, 'resources', 'models'));
});

test('a bare models/ cache is still found when it is all there is', () => {
  const dir = fixture(['models']);
  assert.equal(resolveFrom(dir), path.join(dir, 'models'));
});

test('resources/models WINS over a shadowing models/ cache', () => {
  // The whole point: both carry a valid tokenizer.json, so the marker alone
  // cannot tell them apart. Order is what makes the shipped copy win.
  const dir = fixture(['resources/models', 'models']);
  assert.equal(
    resolveFrom(dir),
    path.join(dir, 'resources', 'models'),
    'a stale <cwd>/models cache must not shadow the copy the repository ships',
  );
});

test('with no candidate at all it still returns a coherent path, not a throw', () => {
  const dir = fixture([]);
  const resolved = resolveFrom(dir);
  assert.ok(resolved.length > 0);
  assert.doesNotMatch(resolved, /undefined|null/);
});
