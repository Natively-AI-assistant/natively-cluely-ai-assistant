// Answer-policy cross-bundle staleness (2026-07-31) — same class as the
// ModesManager active-mode leak, found by architecture review immediately after.
//
// esbuild inlines answer-policy-store into every bundle that imports it. The
// setter IPC (`context-intelligence:answer-policy-set`) runs in the ipcHandlers
// bundle; with a module-level `cached`, that bundle saw the change immediately
// while the IntelligenceEngine bundle — which reads the store per turn through
// engine-bridge for WTA/assist/manual-answer — kept its first-loaded value until
// restart. Both call sites carry comments promising "a Settings change applies
// to the very next answer"; only one bundle delivered it.
//
// Models the split by loading the compiled module twice (require.cache bust),
// exactly like ModeSwitchCrossBundleCacheLeak2026_07_31.test.mjs.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const STORE_PATH = path.join(repoRoot, 'dist-electron/electron/context-intelligence/policies/answer-policy-store.js');
const CACHE_KEY = '__nativelyAnswerPolicyStoreCacheV1__';

let tmpDir;

function loadBundleCopy() {
  delete require.cache[STORE_PATH];
  return require(STORE_PATH);
}

describe('answer-policy store — writes visible across bundle copies (2026-07-31)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-xbundle-'));
    process.env.NATIVELY_TEST_USERDATA = tmpDir;
    delete globalThis[CACHE_KEY];
  });

  afterEach(() => {
    delete require.cache[STORE_PATH];
    delete globalThis[CACHE_KEY];
    delete process.env.NATIVELY_TEST_USERDATA;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  test('a set through copy B is served by copy A on the very next read', () => {
    const A = loadBundleCopy();
    const B = loadBundleCopy();
    assert.notEqual(A, B, 'require.cache bust failed — test would be vacuous');

    // Copy A (the engine bundle) reads first, warming its cache with "no choice".
    assert.equal(A.getStoredAnswerPolicy('mode_x'), null);

    // Copy B (the ipcHandlers bundle) persists the user's Settings change.
    B.setStoredAnswerPolicy('mode_x', 'only_answer_from_references');

    // The regression: copy A kept returning null until app restart, so WTA and
    // manual-answer ignored the user's strictness choice for the whole session.
    assert.equal(A.getStoredAnswerPolicy('mode_x'), 'only_answer_from_references',
      'copy A served a stale answer policy — the per-bundle cache is back');

    // And clearing propagates the same way.
    B.setStoredAnswerPolicy('mode_x', null);
    assert.equal(A.getStoredAnswerPolicy('mode_x'), null);
  });

  test('the cache lives in the process-wide slot, not module scope', () => {
    const A = loadBundleCopy();
    A.getStoredAnswerPolicy('anything');
    assert.ok(globalThis[CACHE_KEY],
      'cache slot missing from globalThis — the store moved back to module scope');
  });
});
