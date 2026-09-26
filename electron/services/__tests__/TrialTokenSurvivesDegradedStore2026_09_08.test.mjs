// electron/services/__tests__/TrialTokenSurvivesDegradedStore2026_09_08.test.mjs
//
// THE BUG THIS PINS: "I pressed Start free trial and got no trial."
//
// A trial is unlike every other credential in this store. By the time
// setTrialToken() is called the SERVER has already spent this machine's
// one-per-hwid `free_trials` row — so a write we cannot perform must not also
// throw the trial away. The old implementation opened with
//
//     if (this.refuseWriteWhileDegraded('set trial token')) return;
//
// which returned BEFORE assigning, so in a degraded session (locked keychain,
// denied prompt, unsynced DPAPI profile, or a launch holding a different
// encryption key) the token never reached memory either. `trial:start` ignored
// the void return and answered `ok`, the renderer then polled `trial:status`,
// CredentialsManager had no token, and the user was left with a spent trial and
// no sign of one — the exact shape of the reports.
//
// The fix separates two questions that were conflated:
//   - can this trial be USED right now?      -> always, memory holds the token
//   - will it SURVIVE a restart?             -> only when the store can write
// and returns the second so the UI can say it out loud.
//
// What must NOT change: the degraded guard still gates the WRITE. saveCredentials
// serializes the whole credential object, and in a degraded session that object
// is empty-or-partial, so writing would clobber intact stored keys. That is the
// protection CredentialDegradedStoreGuard2026_08_05 exists for, and the last
// test here re-pins it for this path specifically.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/TrialTokenSurvivesDegradedStore2026_09_08.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const COMPILED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../dist-electron/electron/services/CredentialsManager.js',
);

function makeEnv() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-token-'));
  const state = { keyringAvailable: true, userData, decryptShouldThrow: false };
  const fakeElectron = {
    app: { getPath: () => state.userData, isPackaged: false, getVersion: () => '0.0.0-test' },
    safeStorage: {
      isEncryptionAvailable: () => state.keyringAvailable,
      encryptString: (s) => Buffer.concat([Buffer.from('KR'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => {
        // isEncryptionAvailable() says yes and the decrypt still throws: a
        // locked macOS keychain, a denied prompt, an unsynced Windows profile.
        if (state.decryptShouldThrow) throw new Error('could not decrypt: keychain is locked');
        return Buffer.from(b).subarray(2).toString('utf8');
      },
      getSelectedStorageBackend: () => 'basic_text',
    },
  };
  return { state, fakeElectron, userData };
}

let CURRENT = null;
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    if (!CURRENT) throw new Error('no electron env active');
    return CURRENT.fakeElectron;
  }
  return origLoad.apply(this, arguments);
};
test.after(() => { Module._load = origLoad; });

/** Cold start: fresh class, reset singleton, re-read disk. */
function freshManager(env) {
  CURRENT = env;
  delete require.cache[require.resolve(COMPILED)];
  const mod = require(COMPILED);
  if (mod.CredentialsManager.instance) mod.CredentialsManager.instance = undefined;
  const g = globalThis;
  delete g.__nativelyCredentialsManagerV1__;
  const cm = mod.CredentialsManager.getInstance();
  cm.init();
  return cm;
}

const TOKEN = 'natively_trial_LIVE_SENTINEL_abc123';
const inThirtyMinutes = () => new Date(Date.now() + 30 * 60_000).toISOString();
const keyringPath = (env) => path.join(env.userData, 'credentials.enc');

test('a healthy store persists the trial and reports it', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  const startedAt = new Date().toISOString();
  const expiresAt = inThirtyMinutes();

  const res = cm.setTrialToken(TOKEN, expiresAt, startedAt);

  assert.equal(res.persisted, true, 'a healthy store must report the write as done');
  assert.equal(cm.getTrialToken(), TOKEN);
  assert.equal(cm.getTrialExpiresAt(), expiresAt);
  assert.equal(cm.getTrialClaimed(), true);
});

test('the trial SURVIVES a restart — the "closed it and reopened inside 30 minutes" case', () => {
  const env = makeEnv();
  const expiresAt = inThirtyMinutes();
  freshManager(env).setTrialToken(TOKEN, expiresAt, new Date().toISOString());

  // Cold start, same profile, healthy store: this is what `trial:get-local`
  // reads on boot to decide whether to show the countdown.
  const cm2 = freshManager(env);
  assert.equal(cm2.getTrialToken(), TOKEN, 'a restart inside the window must still hold the token');
  assert.equal(cm2.getTrialExpiresAt(), expiresAt, 'and the clock it is measured against');
  assert.equal(new Date(cm2.getTrialExpiresAt()).getTime() > Date.now(), true, 'still unexpired');
});

test('a DEGRADED store still hands back a usable trial, and admits it is not saved', () => {
  const env = makeEnv();

  // Session 1: healthy, and holding a credential worth protecting.
  const cm1 = freshManager(env);
  assert.equal(cm1.setDeepgramApiKey('sk-deepgram-KEEP-ME'), true);
  const intact = fs.readFileSync(keyringPath(env));

  // Session 2: keychain locked. The user presses Start free trial; the server
  // spends the hwid row and returns a token.
  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.isCredentialStoreDegraded(), true, 'precondition: the store is degraded');

  const res = cm2.setTrialToken(TOKEN, inThirtyMinutes(), new Date().toISOString());

  // THE REGRESSION: this returned undefined and left getTrialToken() empty, so
  // every subsequent /v1/trial/status call answered 'no_trial_token' and the
  // user saw nothing happen at all.
  assert.equal(cm2.getTrialToken(), TOKEN, 'the trial must be usable this session — the server already spent it');
  assert.equal(res.persisted, false, 'and the caller must be told it will not survive a restart');

  // And the protection that made the old guard necessary is untouched.
  assert.deepEqual(
    fs.readFileSync(keyringPath(env)), intact,
    'a degraded session must not write — saveCredentials serializes a partial object over intact keys',
  );
});

test('the unsaved trial is gone after a restart, which is exactly what persisted:false promised', () => {
  const env = makeEnv();

  // A store only becomes degraded when there is a file it FAILS to decrypt. An
  // empty profile decrypts nothing, so it is healthy and writes succeed — this
  // seeding step is the difference between testing the degraded path and
  // testing the happy one by accident. (It caught exactly that mistake here.)
  freshManager(env).setDeepgramApiKey('sk-deepgram-SEED');

  env.state.decryptShouldThrow = true;
  const cm = freshManager(env);
  assert.equal(cm.isCredentialStoreDegraded(), true, 'precondition: degraded');
  assert.equal(cm.setTrialToken(TOKEN, inThirtyMinutes(), new Date().toISOString()).persisted, false);
  assert.equal(cm.getTrialToken(), TOKEN, 'live for this session');

  // Store recovers (keychain unlocked), app restarts. Nothing was written, so
  // there is nothing to read — the UI's job is to have warned about this, and
  // the server's job is to re-issue the same trial when Start is pressed again.
  env.state.decryptShouldThrow = false;
  const cm2 = freshManager(env);
  assert.equal(cm2.getTrialToken(), undefined, 'honest: an unwritten token cannot come back');
  assert.equal(cm2.getTrialClaimed(), false,
    'and trialClaimed must not be set either, or the start card would hide itself and strand the user');
});

test('clearing a trial keeps trialClaimed, so an ended trial cannot be restarted locally', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  cm.setTrialToken(TOKEN, inThirtyMinutes(), new Date().toISOString());

  cm.clearTrialToken();

  assert.equal(cm.getTrialToken(), undefined);
  assert.equal(cm.getTrialExpiresAt(), undefined);
  assert.equal(cm.getTrialClaimed(), true, 'claimed is deliberately sticky — see clearTrialToken');
});
