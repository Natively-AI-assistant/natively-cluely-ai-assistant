// electron/services/__tests__/TrialClaimReset2026_09_29.test.mjs
//
// CredentialsManager.resetTrialClaim(): the credential half of the one-time trial
// campaign (src/lib/trialCampaign.mjs). It must forget the token, the expiry, the
// start AND the claimed flag (clearTrialToken keeps that one on purpose), it must
// say honestly whether that reached disk, and a degraded store must not be written
// over. Nothing here reads process.platform: macOS (Keychain) and Windows (DPAPI)
// differ only behind safeStorage, which the harness fakes, so the same code path
// runs for both and the degraded case stands in for either failing.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/TrialClaimReset2026_09_29.test.mjs

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

const TOKEN = 'natively_trial_OLD_abc123';
const past = () => new Date(Date.now() - 3 * 86_400_000).toISOString();
const keyringPath = (env) => path.join(env.userData, 'credentials.enc');

test('resetTrialClaim forgets token, expiry, start AND the claimed flag, and persists it', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  cm.setTrialToken(TOKEN, past(), past());
  assert.equal(cm.getTrialClaimed(), true, 'precondition');

  assert.deepEqual(cm.resetTrialClaim(), { persisted: true });
  assert.equal(cm.getTrialToken(), undefined);
  assert.equal(cm.getTrialExpiresAt(), undefined);
  assert.equal(cm.getTrialStartedAt(), undefined);
  assert.equal(cm.getTrialClaimed(), false, 'the start card may show again');

  const cm2 = freshManager(env);
  assert.equal(cm2.getTrialClaimed(), false, 'and it stays reset after a restart');
  assert.equal(cm2.getTrialToken(), undefined);
});

test('it leaves every other credential alone', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  cm.setDeepgramApiKey('sk-deepgram-KEEP-ME');
  cm.setTrialToken(TOKEN, past(), past());
  cm.resetTrialClaim();
  assert.equal(freshManager(env).getDeepgramApiKey(), 'sk-deepgram-KEEP-ME');
});

test('a device with nothing to forget reports persisted and writes nothing', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  assert.deepEqual(cm.resetTrialClaim(), { persisted: true });
  assert.equal(fs.existsSync(keyringPath(env)), false, 'no write for a no-op');
});

test('a degraded store refuses: reports persisted:false, keeps the claim, never writes over intact keys', () => {
  const env = makeEnv();
  const cm1 = freshManager(env);
  cm1.setDeepgramApiKey('sk-deepgram-KEEP-ME');
  cm1.setTrialToken(TOKEN, past(), past());
  const intact = fs.readFileSync(keyringPath(env));

  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.isCredentialStoreDegraded(), true, 'precondition: degraded');

  assert.deepEqual(cm2.resetTrialClaim(), { persisted: false });
  assert.deepEqual(fs.readFileSync(keyringPath(env)), intact, 'the encrypted file is byte-identical');

  // The keychain recovers: the campaign retries and now succeeds.
  env.state.decryptShouldThrow = false;
  const cm3 = freshManager(env);
  assert.equal(cm3.getTrialClaimed(), true, 'still claimed, so the marker was rightly never written');
  assert.deepEqual(cm3.resetTrialClaim(), { persisted: true });
  assert.equal(cm3.getTrialClaimed(), false);
});

test('clearTrialToken keeps its contract: it still preserves trialClaimed', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  cm.setTrialToken(TOKEN, past(), past());
  cm.clearTrialToken();
  assert.equal(cm.getTrialClaimed(), true);
});
