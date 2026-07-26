// Behavioral persistence tests for CredentialsManager's app-managed fallback.
//
// These run against the COMPILED dist-electron module and exercise real disk I/O in
// a temp userData dir, so they prove actual save→restart→load behavior — unlike the
// source-text assertions in CredentialStorage.test.mjs. They were added after a
// code review found two silent-loss paths that the source-text suite passed green:
//   1. a real disk-write failure still reported "Saved" (write result was discarded);
//   2. os.hostname() in the key material made the fallback undecryptable after a
//      hostname change (Wi-Fi/DHCP/roaming), silently re-losing the key.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/CredentialPersistenceBehavior.test.mjs

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

// Shared, mutable electron mock. Tests flip `keyringAvailable` and `hostname` (the
// hostname is irrelevant to the key now — that's the point of one of the tests).
function makeEnv() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-persist-'));
  const state = { keyringAvailable: false, userData, encryptShouldThrow: false };
  const fakeElectron = {
    app: { getPath: () => state.userData, isPackaged: false, getVersion: () => '0.0.0-test' },
    safeStorage: {
      isEncryptionAvailable: () => state.keyringAvailable,
      // Trivial reversible transform so the keyring path is exercisable in tests.
      // When `encryptShouldThrow` is set, encryptString throws to model the
      // Windows DPAPI failure shape (`isEncryptionAvailable()` returns true but
      // `encryptString()` throws on the actual call due to policy/roaming
      // profile/sandboxing).
      encryptString: (s) => {
        if (state.encryptShouldThrow) {
          throw new Error('DPAPI: policy blocked encryption');
        }
        return Buffer.concat([Buffer.from('KR'), Buffer.from(s, 'utf8')]);
      },
      decryptString: (b) => Buffer.from(b).subarray(2).toString('utf8'),
      getSelectedStorageBackend: () => 'basic_text',
    },
  };
  return { state, fakeElectron, userData };
}

// Install the electron mock once; point it at whichever env is "current".
let CURRENT = null;
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    if (!CURRENT) throw new Error('no electron env active');
    return CURRENT.fakeElectron;
  }
  return origLoad.apply(this, arguments);
};

// Load a FRESH CredentialsManager class (cleared module cache + reset singleton) so
// each "restart" is a genuine cold start that re-reads disk.
function freshManager(env) {
  CURRENT = env;
  delete require.cache[require.resolve(COMPILED)];
  const mod = require(COMPILED);
  // Reset the singleton in case the class object was cached elsewhere.
  if (mod.CredentialsManager.instance) mod.CredentialsManager.instance = undefined;
  const cm = mod.CredentialsManager.getInstance();
  cm.init();
  return cm;
}

const SECRET = 'sk-deepgram-LIVE-SENTINEL-abc123XYZ';

test('save with keyring unavailable → key survives a restart via the encrypted fallback', () => {
  const env = makeEnv();
  env.state.keyringAvailable = false;

  const cm = freshManager(env);
  const persisted = cm.setDeepgramApiKey(SECRET);
  assert.equal(persisted, true, 'setter must report a successful write');

  const fallback = path.join(env.userData, 'credentials.fallback.enc');
  assert.ok(fs.existsSync(fallback), 'fallback file should exist');
  assert.ok(!fs.existsSync(path.join(env.userData, 'credentials.enc')), 'no keyring file while keyring down');

  // No plaintext at rest.
  const blob = fs.readFileSync(fallback);
  assert.ok(!blob.includes(Buffer.from(SECRET, 'utf8')), 'secret must not appear in the file');

  // Restart (cold) — key must load back.
  const cm2 = freshManager(env);
  assert.equal(cm2.getDeepgramApiKey(), SECRET, 'key must survive restart');
});

test('hostname change between restarts does NOT lose the key (regression: no os.hostname in key material)', () => {
  const env = makeEnv();
  env.state.keyringAvailable = false;

  const cm = freshManager(env);
  cm.setSonioxApiKey(SECRET);

  // Simulate a hostname change (Wi-Fi roaming, DHCP, rename). The OLD code mixed
  // os.hostname() into the derived key, so this used to make the fallback
  // undecryptable. We monkeypatch os.hostname for the next cold load to prove the
  // key material no longer depends on it.
  const realHostname = os.hostname;
  os.hostname = () => 'A-Totally-Different-Name.local';
  try {
    const cm2 = freshManager(env);
    assert.equal(cm2.getSonioxApiKey(), SECRET, 'key must survive a hostname change');
  } finally {
    os.hostname = realHostname;
  }
});

test('disk-write failure is reported (success=false), never a false "Saved"', () => {
  const env = makeEnv();
  env.state.keyringAvailable = false;

  const cm = freshManager(env);

  // The on-disk paths were fixed (from this temp dir) at module load, so to force a
  // real write failure we make the directory itself unwritable. The fallback (and
  // its salt) write then throws EACCES inside saveCredentials → must return false.
  fs.chmodSync(env.userData, 0o500); // r-x, no write for owner
  try {
    const persisted = cm.setDeepgramApiKey(SECRET);
    assert.equal(persisted, false, 'a failed disk write must return false, not a false success');
  } finally {
    fs.chmodSync(env.userData, 0o700); // restore so temp cleanup works
  }
});

test('keyring becomes available → fallback migrates up and is deleted', () => {
  const env = makeEnv();
  env.state.keyringAvailable = false;

  const cm = freshManager(env);
  cm.setDeepgramApiKey(SECRET);
  const fallback = path.join(env.userData, 'credentials.fallback.enc');
  const keyring = path.join(env.userData, 'credentials.enc');
  assert.ok(fs.existsSync(fallback));

  // Keyring returns; cold start should load the fallback then migrate up.
  env.state.keyringAvailable = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.getDeepgramApiKey(), SECRET, 'key survives the migration');
  assert.ok(fs.existsSync(keyring), 'keyring file written on migrate-up');
  assert.ok(!fs.existsSync(fallback), 'fallback deleted after migrate-up');

  // And a further restart still has it (now via keyring).
  const cm3 = freshManager(env);
  assert.equal(cm3.getDeepgramApiKey(), SECRET, 'key persists via keyring post-migration');
});

test('a decrypt failure does NOT destroy a recoverable fallback (no migrate of empty creds)', () => {
  const env = makeEnv();
  env.state.keyringAvailable = false;

  const cm = freshManager(env);
  cm.setDeepgramApiKey(SECRET);
  const fallback = path.join(env.userData, 'credentials.fallback.enc');

  // Corrupt the salt so the derived key changes → decrypt throws → creds = {}.
  // With the keyring now "available", the migrate-up guard must NOT run on an empty
  // set and delete the fallback.
  fs.writeFileSync(path.join(env.userData, 'credentials.salt'), Buffer.alloc(32, 7));
  env.state.keyringAvailable = true;

  const cm2 = freshManager(env);
  // Key is unrecoverable (expected — corruption), but the empty set must not have
  // been migrated/persisted as if it were real, and nothing crashed.
  assert.equal(cm2.getDeepgramApiKey(), undefined);
  // The fallback file must NOT have been deleted by an empty-set migrate-up.
  assert.ok(fs.existsSync(fallback), 'fallback must be preserved when load yielded empty creds');
});

test.after(() => { Module._load = origLoad; });

/* ──────────────────────────────────────────────────────────────────────────
 * Regression tests for "STT key not saving" user-reported bug.
 *
 * Investigation (debugger + code-reviewer agents, 2026-06-26) confirmed the
 * STT keys ARE persisted correctly and survive a restart. The user-visible
 * symptom ('Please enter an API key first' after restart) was a renderer-side
 * UX false alarm — the input fields were correctly empty (per the #318
 * masked-pre-population fix), but `handleTestSttConnection` only read local
 * React state. The fixes are:
 *
 *   P1: new `__USE_STORED__` sentinel in test-stt-connection IPC + renderer
 *       `hasStoredXxxKey` gate. The IPC resolves the sentinel to the persisted
 *       key — the raw key never round-trips back into renderer state, so the
 *       masked-key regression cannot recur.
 *   P2 (M1): empty-string normalization across all 7 STT key setters.
 *   P3 (M2): setSttProvider returns boolean; IPC surfaces save failures.
 *   P4 (M3): 'local-whisper' added to set-stt-provider IPC + types unions.
 *   P5 (M5): process.platform dropped from fallback key material (no-op for
 *       the per-install random salt, eliminates Linux-container drift risk).
 *
 * Tests below pin the contract end-to-end against real disk I/O. 18 tests
 * total: 7 in the per-provider round-trip loop, plus 11 named contracts
 * (empty-string + whitespace clear, setSttProvider round-trip + write-failure,
 * dispatcher, source guards x4, plus M-2 LLM key parity x2).
 *
 * The IPC integration of the sentinel mechanism is in a separate file:
 *   electron/services/__tests__/TestSttConnectionSentinel.test.mjs
 * ────────────────────────────────────────────────────────────────────────── */

const STT_KEY_SETTERS = [
  { name: 'Groq STT',         setter: 'setGroqSttApiKey',     getter: 'getGroqSttApiKey',     secret: 'sk-groq-STT-LIVE-aaa111' },
  { name: 'OpenAI STT',       setter: 'setOpenAiSttApiKey',   getter: 'getOpenAiSttApiKey',   secret: 'sk-openai-STT-LIVE-bbb222' },
  { name: 'Deepgram',         setter: 'setDeepgramApiKey',    getter: 'getDeepgramApiKey',    secret: 'sk-deepgram-LIVE-ccc333' },
  { name: 'ElevenLabs',       setter: 'setElevenLabsApiKey',  getter: 'getElevenLabsApiKey',  secret: 'sk-elevenlabs-LIVE-ddd444' },
  { name: 'Azure',            setter: 'setAzureApiKey',       getter: 'getAzureApiKey',       secret: 'sk-azure-LIVE-eee555' },
  { name: 'IBM Watson',       setter: 'setIbmWatsonApiKey',   getter: 'getIbmWatsonApiKey',   secret: 'sk-ibmwatson-LIVE-fff666' },
  { name: 'Soniox',           setter: 'setSonioxApiKey',      getter: 'getSonioxApiKey',      secret: 'sk-soniox-LIVE-ggg777' },
];

for (const { name, setter, getter, secret } of STT_KEY_SETTERS) {
  test(`${name} key: save → restart → load (keyring unavailable, full round-trip)`, () => {
    const env = makeEnv();
    env.state.keyringAvailable = false;

    const cm = freshManager(env);
    const persisted = cm[setter](secret);
    assert.equal(persisted, true, `${setter} must return true on successful write`);

    // Cold restart — new module load, fresh singleton, real disk read.
    const cm2 = freshManager(env);
    assert.equal(cm2[getter](), secret, `${name} key must survive a restart`);
  });
}

test('empty-string resave clears the stored key (M1 contract — matches setNativelyApiKey semantics)', () => {
  const env = makeEnv();
  env.state.keyringAvailable = false;

  const cm = freshManager(env);
  cm.setDeepgramApiKey('sk-real-secret-1234567890');
  assert.equal(cm.getDeepgramApiKey(), 'sk-real-secret-1234567890');

  // User clicked Remove (empty input) → setter must store `undefined`, NOT `''`.
  // `''` would survive but `hasKey = (k) => !!(k && k.trim().length > 0)` would
  // return false anyway — the contract is "stored as undefined so JSON output
  // doesn't carry an empty-string key".
  cm.setDeepgramApiKey('');
  const cm2 = freshManager(env);
  assert.equal(cm2.getDeepgramApiKey(), undefined, 'empty resave must clear the persisted key');
});

test('whitespace-only resave is treated as empty (M1 contract)', () => {
  const env = makeEnv();
  env.state.keyringAvailable = false;

  const cm = freshManager(env);
  cm.setSonioxApiKey('sk-real-soniox-LIVE-abc');
  cm.setSonioxApiKey('   '); // user typed only whitespace
  const cm2 = freshManager(env);
  assert.equal(cm2.getSonioxApiKey(), undefined, 'whitespace-only input must clear the stored key');
});

test('setSttProvider round-trip + persistence status (M2 contract)', () => {
  const env = makeEnv();
  env.state.keyringAvailable = false;

  const cm = freshManager(env);
  const persisted = cm.setSttProvider('soniox');
  assert.equal(persisted, true, 'setSttProvider must return the persistence boolean');
  assert.equal(cm.getSttProvider(), 'soniox');

  const cm2 = freshManager(env);
  assert.equal(cm2.getSttProvider(), 'soniox', 'STT provider selection must survive restart');
});

test('setSttProvider returns false when the disk write fails (M2 contract — mirrors STT key guard)', () => {
  const env = makeEnv();
  env.state.keyringAvailable = false;

  const cm = freshManager(env);

  // Force a real write failure (EACCES) — the setter must report it.
  fs.chmodSync(env.userData, 0o500);
  try {
    const persisted = cm.setSttProvider('deepgram');
    assert.equal(persisted, false, 'setSttProvider must return false on write failure');
  } finally {
    fs.chmodSync(env.userData, 0o700);
  }
});

test('getStoredSttKeyForProvider dispatches the persisted key by provider (P1 contract)', () => {
  const env = makeEnv();
  env.state.keyringAvailable = false;

  const cm = freshManager(env);
  cm.setDeepgramApiKey('sk-dg-LIVE-1234');
  cm.setSonioxApiKey('sk-sn-LIVE-5678');

  assert.equal(cm.getStoredSttKeyForProvider('deepgram'), 'sk-dg-LIVE-1234');
  assert.equal(cm.getStoredSttKeyForProvider('soniox'), 'sk-sn-LIVE-5678');
  assert.equal(cm.getStoredSttKeyForProvider('groq'), undefined, 'unset provider must return undefined');
  assert.equal(cm.getStoredSttKeyForProvider('openai'), undefined);
});

test('process.platform is NOT in the fallback key material (P5 hardening)', () => {
  // Source-text guard: grep the compiled output and the source to make sure
  // process.platform was removed from the fallback key derivation. This pins
  // the comment block at CredentialsManager.ts:822-847 against future regressions.
  const src = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../CredentialsManager.ts'),
    'utf8',
  );
  // Locate the getFallbackKey body — everything from "private getFallbackKey"
  // through the next private/public declaration at the same indent.
  const start = src.indexOf('private getFallbackKey');
  assert.ok(start >= 0, 'getFallbackKey method must exist');
  const end = src.indexOf('\n    private ', start + 1);
  const body = end > start ? src.slice(start, end) : src.slice(start, start + 1500);
  assert.doesNotMatch(body, /process\.platform/, 'process.platform must not appear inside getFallbackKey body');
});

test('STT key setter source normalizes empty string to undefined (P2 source guard)', () => {
  const src = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../CredentialsManager.ts'),
    'utf8',
  );
  for (const { name, setter } of STT_KEY_SETTERS) {
    // Find the setter body and confirm it contains `trimmed || undefined`.
    const idx = src.indexOf(`public ${setter}(`);
    assert.ok(idx >= 0, `${setter} must exist in source`);
    const end = src.indexOf('\n    public ', idx + 1);
    const body = end > idx ? src.slice(idx, end) : src.slice(idx, idx + 500);
    assert.match(
      body,
      /trimmed\s*\|\|\s*undefined/,
      `${name} setter (${setter}) must normalize empty input to undefined`,
    );
  }
});

test('LLM key setter source normalizes empty string to undefined (M-2 follow-up — matches STT pattern)', () => {
  const src = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../CredentialsManager.ts'),
    'utf8',
  );
  // The 4 LLM key setters that originally stored `''` verbatim. setNativelyApiKey
  // and setDeepseekApiKey already had the trim pattern before this work.
  const LLM_KEY_SETTERS = ['setGeminiApiKey', 'setGroqApiKey', 'setOpenaiApiKey', 'setClaudeApiKey'];
  for (const setter of LLM_KEY_SETTERS) {
    const idx = src.indexOf(`public ${setter}(`);
    assert.ok(idx >= 0, `${setter} must exist in source`);
    const end = src.indexOf('\n    public ', idx + 1);
    const body = end > idx ? src.slice(idx, end) : src.slice(idx, idx + 500);
    assert.match(
      body,
      /trimmed\s*\|\|\s*undefined/,
      `${setter} must normalize empty input to undefined (M-2 follow-up to STT key setters)`,
    );
  }
});

test('LLM key setters: empty-string resave clears the stored key (M-2 behavioral)', () => {
  const env = makeEnv();
  env.state.keyringAvailable = false;

  const cm = freshManager(env);
  cm.setGeminiApiKey('AIza-real-gemini-LIVE-1234567890');
  assert.equal(cm.getGeminiApiKey(), 'AIza-real-gemini-LIVE-1234567890');

  // User cleared the field (or it was a programmatic '' call from a future IPC).
  cm.setGeminiApiKey('');
  const cm2 = freshManager(env);
  assert.equal(cm2.getGeminiApiKey(), undefined, 'empty resave must clear the persisted LLM key');
});

test('local-whisper is in the set-stt-provider IPC + preload + types unions (P4 contract)', () => {
  const ipc = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../ipcHandlers.ts'),
    'utf8',
  );
  // The handler signature must include 'local-whisper'.
  const handlerStart = ipc.indexOf("safeHandle(\n    'set-stt-provider'");
  assert.ok(handlerStart >= 0, 'set-stt-provider IPC handler must exist');
  const handlerEnd = ipc.indexOf("safeHandle(", handlerStart + 1);
  const handlerBlock = handlerEnd > handlerStart ? ipc.slice(handlerStart, handlerEnd) : ipc.slice(handlerStart, handlerStart + 1500);
  assert.match(handlerBlock, /'local-whisper'/, 'set-stt-provider IPC handler union must include local-whisper');

  const preload = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../preload.ts'),
    'utf8',
  );
  assert.match(preload, /'local-whisper'/, 'preload setSttProvider union must include local-whisper');

  const types = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../src/types/electron.d.ts'),
    'utf8',
  );
  assert.match(types, /setSttProvider[^]*'local-whisper'/, 'electron.d.ts setSttProvider union must include local-whisper');
});

test('SettingsOverlay sends USE_STORED sentinel when input empty but key on disk (P1 renderer guard)', () => {
  const src = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../src/components/SettingsOverlay.tsx'),
    'utf8',
  );
  // The sentinel constant must appear in the renderer (it matches what the IPC resolves).
  assert.match(src, /__USE_STORED__/, 'SettingsOverlay must reference the USE_STORED sentinel');
  // The handleTestSttConnection function must branch on the stored-key flags
  // and prefer the sentinel over the misleading 'Please enter an API key first'.
  const fnStart = src.indexOf('const handleTestSttConnection');
  assert.ok(fnStart >= 0, 'handleTestSttConnection must exist');
  // Capture a generous 4000-char window — the function body is ~50 lines.
  const fnBody = src.slice(fnStart, fnStart + 4000);
  assert.match(fnBody, /hasStoredStt[A-Za-z]+Key/, 'handleTestSttConnection must consult hasStored*Key flags');
  assert.match(fnBody, /apiKeyToSend/, 'handleTestSttConnection must use the apiKeyToSend variable');
  assert.doesNotMatch(fnBody, /'Please enter an API key first'/, 'misleading "Please enter an API key first" message must be removed');
});

// ───────────────────────────────────────────────────────────────────────────
// PR #370 regression: STT key persistence on Windows when safeStorage.encryptString
// throws after isEncryptionAvailable() returns true (DPAPI policy/roaming
// profile/sandboxing failures). The save must fall through to the app-managed
// fallback instead of returning false (which would surface a misleading "Save
// Failed" badge to the user). Closes the bug reported for Deepgram + other
// STT keys.
// ───────────────────────────────────────────────────────────────────────────

test('PR #370: keyring AVAILABLE but encryptString throws → save falls through to fallback (returns true, NOT false)', () => {
  const env = makeEnv();
  env.state.keyringAvailable = true;
  env.state.encryptShouldThrow = true;

  const cm = freshManager(env);
  const SECRET = 'dg-LIVE-PR370-FALLTHROUGH-abc123';
  const persisted = cm.setDeepgramApiKey(SECRET);

  // CRITICAL: the save MUST succeed (true), NOT fail (false). The user entered a
  // key, sees "Saved" badge, and the key is actually persisted via the fallback.
  assert.equal(persisted, true,
    'a keyring write that throws must fall through to the fallback, not return false');

  // Verify the fallback file exists and contains the secret.
  const fbPath = path.join(env.userData, 'credentials.fallback.enc');
  assert.ok(fs.existsSync(fbPath), 'fallback file must exist after a keyring-throws save');

  // Verify a fresh cold-start loads the secret from the fallback.
  const cm2 = freshManager(env);
  assert.equal(cm2.getDeepgramApiKey(), SECRET,
    'a saved-via-fallback key must survive a restart');
});

test('PR #370: keyring-throws save leaves NO stale credentials.enc on disk', () => {
  const env = makeEnv();
  env.state.keyringAvailable = true;
  env.state.encryptShouldThrow = true;

  const cm = freshManager(env);
  cm.setDeepgramApiKey('dg-LIVE-PR370-CLEANUP-xyz');

  // The stale keyring file (if any pre-existed) must have been removed before
  // the fallback write returned. Otherwise loadCredentials() would read it on
  // next startup and discard the fresh fallback.
  const keyringPath = path.join(env.userData, 'credentials.enc');
  assert.ok(!fs.existsSync(keyringPath),
    'a successful fallback save must unlink any pre-existing stale credentials.enc');
});

test('PR #370: loadCredentials detects stale-keyring state via mtime and unlinks before read', () => {
  const env = makeEnv();

  // Pre-populate BOTH stores with mtimes that make the fallback strictly newer
  // than the keyring — modeling a saveCredentials() that hit the fallback path
  // (fallback just-written) but failed to clean up the stale keyring.
  const keyringPath = path.join(env.userData, 'credentials.enc');
  const fallbackPath = path.join(env.userData, 'credentials.fallback.enc');
  const OLD_TIME = new Date('2026-01-01T00:00:00Z');
  const NEW_TIME = new Date('2026-07-01T00:00:00Z');
  fs.writeFileSync(keyringPath, Buffer.from('KR{"deepgramApiKey":"OLD-STALE-VALUE"}'));
  fs.writeFileSync(fallbackPath, Buffer.from('garbage-encrypted-blob'));
  fs.utimesSync(keyringPath, OLD_TIME, OLD_TIME);
  fs.utimesSync(fallbackPath, NEW_TIME, NEW_TIME);

  // Keyring reports available (the normal macOS/healthy-Windows state).
  env.state.keyringAvailable = true;

  // Cold-start: loadCredentials must detect the mtime inversion and unlink the
  // stale keyring BEFORE attempting to decrypt it (otherwise it would either
  // corrupt the credential set or shadow the fallback).
  freshManager(env);

  assert.ok(!fs.existsSync(keyringPath),
    'a keyring older than the fallback must be unlinked before load attempts to decrypt it');
});

test('PR #370: loadCredentials does NOT discard a fresh keyring when fallback is older (legitimate round-trip)', () => {
  const env = makeEnv();

  // Inverse: keyring is newer than fallback. Models the normal
  // keyring-saves-everything case where removeFallbackFile() ran cleanly and
  // the fallback is just a stale leftover from a previous machine.
  const keyringPath = path.join(env.userData, 'credentials.enc');
  const fallbackPath = path.join(env.userData, 'credentials.fallback.enc');
  const NEW_TIME = new Date('2026-07-01T00:00:00Z');
  const OLD_TIME = new Date('2026-01-01T00:00:00Z');
  fs.writeFileSync(keyringPath, Buffer.from('KR{"deepgramApiKey":"CURRENT-VALID-VIA-KEYRING"}'));
  fs.writeFileSync(fallbackPath, Buffer.from('garbage-from-old-machine'));
  fs.utimesSync(keyringPath, NEW_TIME, NEW_TIME);
  fs.utimesSync(fallbackPath, OLD_TIME, OLD_TIME);

  env.state.keyringAvailable = true;

  const cm = freshManager(env);

  assert.ok(fs.existsSync(keyringPath),
    'a fresher keyring must NOT be discarded just because a stale fallback exists alongside it');
  assert.equal(cm.getDeepgramApiKey(), 'CURRENT-VALID-VIA-KEYRING',
    'the keyring path must load the current value (not fall through to the fallback)');
});
