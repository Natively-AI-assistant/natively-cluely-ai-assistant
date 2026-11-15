// electron/llm/__tests__/JudgeRunsOnNatively2026_11_14.test.mjs
//
// LLMHelper.judgeRunsOnNatively(): Settings › Auto Answer leaves the reference
// model's name out of its cost estimate when the judge runs on Natively API
// (Evin 2026-11-14), and keeps it when the user's own provider judges. The
// check must follow generateJudgeVerdict's ladder: own keys first, Natively last.
// Pure: no platform branches. Runs on the built dist-electron bundle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};
let fastPick = null; // the Background Model pick CredentialsManager reports
globalThis.__nativelyCredentialsManagerV1__ = new Proxy({ getDisabledProviders: () => [], getFastModel: () => fastPick }, {
  get: (target, prop) => (prop in target ? target[prop] : () => null),
});

const { LLMHelper } = require(dist('LLMHelper.js'));

test('no Natively key: never Natively', () => {
  const h = new LLMHelper(undefined, false);
  assert.equal(h.judgeRunsOnNatively(), false);
});

test('a Natively key and no own provider: the judge runs on Natively', () => {
  const h = new LLMHelper(undefined, false);
  h.setNativelyKey('natively_test_key');
  assert.equal(h.judgeRunsOnNatively(), true);
});

test('an own Gemini, Groq or OpenAI key judges first, so the model name stays', () => {
  for (const set of ['setApiKey', 'setGroqApiKey', 'setOpenaiApiKey']) {
    const h = new LLMHelper(undefined, false);
    h.setNativelyKey('natively_test_key');
    h[set]('test-key-123');
    assert.equal(h.judgeRunsOnNatively(), false, set);
  }
});

test('local-only mode: not Natively', () => {
  const h = new LLMHelper(undefined, false);
  h.setNativelyKey('natively_test_key');
  h.setLocalOnlyMode(true);
  assert.equal(h.judgeRunsOnNatively(), false);
});

// Review 2026-11-15: a Background Model pick only takes the judge when its provider can run;
// callFastModel otherwise falls through to the ladder, which here ends on Natively.
test('a pick whose provider has no key leaves the judge on Natively; with the key it does not', () => {
  fastPick = 'claude-haiku-4-5';
  try {
    const h = new LLMHelper(undefined, false);
    h.setNativelyKey('natively_test_key');
    assert.equal(h.judgeRunsOnNatively(), true, 'stale Claude pick, no Claude key');
    h.setClaudeApiKey('test-key-123');
    assert.equal(h.judgeRunsOnNatively(), false, 'Claude pick with a Claude key');
  } finally { fastPick = null; }
});
