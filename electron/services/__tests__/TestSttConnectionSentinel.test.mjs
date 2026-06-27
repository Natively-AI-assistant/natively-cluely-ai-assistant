/**
 * IPC integration test for the `__USE_STORED__` sentinel mechanism in
 * `test-stt-connection`. Closes M-1 from the pre-release review (2026-06-26).
 *
 * Why a separate file from CredentialPersistenceBehavior.test.mjs:
 *   - That file proves the persistence layer round-trips; it doesn't drive the
 *     IPC handler end-to-end.
 *   - The handler logic is large and depends on `ws`/`axios`/`appState` for the
 *     provider-specific probe paths (Deepgram WS, Soniox WS, Groq/OpenAI/Azure
 *     HTTP). We extract the sentinel resolution into a pure helper
 *     (`resolveSttTestKey`) in CredentialsManager.ts and unit-test that here,
 *     avoiding the need to mock the entire IPC bootstrap or hit the network.
 *
 * What this test pins:
 *   - The sentinel constant exported from CredentialsManager is the literal
 *     `'__USE_STORED__'` (and is the SAME literal the renderer sends, verified
 *     via source-text guard).
 *   - `resolveSttTestKey` returns the persisted key when given the sentinel.
 *   - `resolveSttTestKey` returns a clean error when the sentinel is given but
 *     no key is on disk for the provider (no false "Please enter an API key
 *     first" regression).
 *   - `resolveSttTestKey` returns the explicit key unchanged when it's not the
 *     sentinel (the legacy path still works).
 *   - `resolveSttTestKey` rejects empty/whitespace input with a clean error
 *     instead of forwarding `''` to the provider.
 *   - `resolveSttTestKey` returns the key trimmed (no leading/trailing space
 *     leaks into the provider auth header).
 *
 * Run via: npm run build:electron && node --test electron/services/__tests__/TestSttConnectionSentinel.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const COMPILED = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../dist-electron/electron/services/CredentialsManager.js',
);

// Shared, mutable electron mock — same shape as CredentialPersistenceBehavior.
function makeEnv() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-sentinel-'));
  const state = { keyringAvailable: false, userData };
  const fakeElectron = {
    app: { getPath: () => state.userData, isPackaged: false, getVersion: () => '0.0.0-test' },
    safeStorage: {
      isEncryptionAvailable: () => state.keyringAvailable,
      encryptString: (s) => Buffer.concat([Buffer.from('KR'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(2).toString('utf8'),
      getSelectedStorageBackend: () => 'basic_text',
    },
  };
  return { state, fakeElectron, userData };
}

let CURRENT = null;
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    if (!CURRENT) throw new Error('no electron env active');
    return CURRENT.fakeElectron;
  }
  return origLoad.apply(this, arguments);
};

function loadHelper() {
  // Fresh require — the helper module reads the singleton on every call, so we
  // do NOT need a fresh singleton per test. But we DO need the singleton loaded
  // against the CURRENT env so the key we save via setDeepgramApiKey() lands in
  // a userData dir that resolveSttTestKey will read from.
  delete require.cache[require.resolve(COMPILED)];
  return require(COMPILED);
}

function freshManager(env) {
  CURRENT = env;
  delete require.cache[require.resolve(COMPILED)];
  const mod = require(COMPILED);
  if (mod.CredentialsManager.instance) mod.CredentialsManager.instance = undefined;
  const cm = mod.CredentialsManager.getInstance();
  cm.init();
  return { cm, mod };
}

test('sentinel constant exported as the literal "__USE_STORED__" (must match renderer)', () => {
  const env = makeEnv();
  CURRENT = env;
  const { USE_STORED_KEY_SENTINEL } = loadHelper();
  assert.equal(USE_STORED_KEY_SENTINEL, '__USE_STORED__');
});

test('renderer source uses the same sentinel literal (drift guard)', () => {
  // Source-text pin: if the renderer or the IPC helper ever drift to a
  // different sentinel value, the sentinel contract silently breaks (the IPC
  // would fall into the new "No API key provided" branch). This test makes
  // that drift fail CI loudly.
  const overlay = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../src/components/SettingsOverlay.tsx'),
    'utf8',
  );
  assert.match(overlay, /'__USE_STORED__'/, 'renderer must reference the sentinel literal');
});

test('resolveSttTestKey returns the persisted key when given the sentinel', () => {
  const env = makeEnv();
  const { cm, mod } = freshManager(env);

  // Save a real key first.
  cm.setDeepgramApiKey('sk-deepgram-LIVE-abc123');
  // Then simulate the renderer post-restart: input field is empty (so it
  // sends the sentinel instead), and the key IS on disk.
  const result = mod.resolveSttTestKey('deepgram', mod.USE_STORED_KEY_SENTINEL);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.apiKey, 'sk-deepgram-LIVE-abc123', 'sentinel must resolve to the persisted key');
  }
});

test('resolveSttTestKey returns a clean error when sentinel is given but no key is on disk', () => {
  const env = makeEnv();
  const { mod } = freshManager(env);

  // No setSonioxApiKey call — disk is empty.
  const result = mod.resolveSttTestKey('soniox', mod.USE_STORED_KEY_SENTINEL);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /No API key saved/i, 'error must explicitly say "no key saved"');
    assert.doesNotMatch(result.error, /Please enter an API key first/, 'must NOT use the misleading legacy message');
  }
});

test('resolveSttTestKey returns the explicit key unchanged when not the sentinel (legacy path)', () => {
  const env = makeEnv();
  const { mod } = freshManager(env);

  // User typed a key and is testing before saving — legacy path.
  const result = mod.resolveSttTestKey('groq', 'sk-groq-typed-by-user-XYZ');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.apiKey, 'sk-groq-typed-by-user-XYZ');
  }
});

test('resolveSttTestKey rejects empty input with a clean error (does not forward "" to the provider)', () => {
  const env = makeEnv();
  const { mod } = freshManager(env);

  const result1 = mod.resolveSttTestKey('azure', '');
  assert.equal(result1.ok, false);

  const result2 = mod.resolveSttTestKey('azure', '   ');
  assert.equal(result2.ok, false);

  const result3 = mod.resolveSttTestKey('azure', null);
  assert.equal(result3.ok, false);

  const result4 = mod.resolveSttTestKey('azure', undefined);
  assert.equal(result4.ok, false);
});

test('resolveSttTestKey trims the resolved key (no leading/trailing space leaks into provider auth)', () => {
  const env = makeEnv();
  const { cm, mod } = freshManager(env);

  // Save a key with surrounding whitespace (e.g., user pasted from clipboard).
  cm.setSonioxApiKey('  sk-soniox-LIVE-1234  ');
  // Wait — the setter normalizes via trim(), so the stored value is already
  // trimmed. Verify that explicitly: the sentinel resolves to the trimmed value.
  const result = mod.resolveSttTestKey('soniox', mod.USE_STORED_KEY_SENTINEL);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.apiKey, 'sk-soniox-LIVE-1234', 'stored key is already trimmed by the setter');
  }

  // Also verify the explicit-key path trims.
  const result2 = mod.resolveSttTestKey('groq', '  sk-groq-LIVE-XYZ  ');
  assert.equal(result2.ok, true);
  if (result2.ok) {
    assert.equal(result2.apiKey, 'sk-groq-LIVE-XYZ', 'explicit key path must trim');
  }
});

test('resolveSttTestKey dispatches across all 7 providers', () => {
  const env = makeEnv();
  const { cm, mod } = freshManager(env);

  cm.setGroqSttApiKey('k-groq');
  cm.setOpenAiSttApiKey('k-openai');
  cm.setDeepgramApiKey('k-deepgram');
  cm.setElevenLabsApiKey('k-elevenlabs');
  cm.setAzureApiKey('k-azure');
  cm.setIbmWatsonApiKey('k-ibmwatson');
  cm.setSonioxApiKey('k-soniox');

  const cases = [
    ['groq', 'k-groq'],
    ['openai', 'k-openai'],
    ['deepgram', 'k-deepgram'],
    ['elevenlabs', 'k-elevenlabs'],
    ['azure', 'k-azure'],
    ['ibmwatson', 'k-ibmwatson'],
    ['soniox', 'k-soniox'],
  ];
  for (const [provider, expected] of cases) {
    const r = mod.resolveSttTestKey(provider, mod.USE_STORED_KEY_SENTINEL);
    assert.equal(r.ok, true, `${provider} must resolve`);
    if (r.ok) assert.equal(r.apiKey, expected, `${provider} must return its persisted key`);
  }
});

test('resolveSttTestKey post-restart simulation: save → fresh singleton → resolve with sentinel', () => {
  // Full behavioral round-trip: prove that even after a cold restart (fresh
  // module load + fresh singleton reading from disk), the sentinel path
  // resolves to the originally-saved key.
  const env = makeEnv();
  const { cm: cm1 } = freshManager(env);
  cm1.setDeepgramApiKey('sk-deepgram-LIVE-original');

  // Cold restart — fresh singleton, real disk read.
  const { mod: mod2 } = freshManager(env);
  const r = mod2.resolveSttTestKey('deepgram', mod2.USE_STORED_KEY_SENTINEL);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.apiKey, 'sk-deepgram-LIVE-original', 'sentinel resolves to the key that survived restart');
  }
});

test.after(() => { Module._load = origLoad; });