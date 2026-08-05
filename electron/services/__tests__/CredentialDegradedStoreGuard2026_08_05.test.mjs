// electron/services/__tests__/CredentialDegradedStoreGuard2026_08_05.test.mjs
//
// The credential store must never overwrite a keyring file it could not READ.
//
// THE BUG THIS PINS
// loadCredentials() falls through to the app-managed fallback when the keyring
// file will not decrypt, and (correctly) skips the boot-time migrate-up so it
// does not clobber the keyring from a possibly-older fallback. That guard was
// first written as a function-LOCAL, so it protected only the boot write. But
// saveCredentials() serializes the WHOLE credential object, so the first
// ordinary write of the session — a Codex OAuth token refresh, any settings
// write — re-encrypted an empty-or-partial object straight over the intact
// keyring file. With no fallback present, `credentials` is EMPTY and every
// stored key is destroyed with no copy anywhere.
//
// WHY REFUSING IS RIGHT
// safeStorage.decryptString throws for TRANSIENT reasons: a locked macOS
// keychain, a denied keychain-access prompt, a Windows roaming DPAPI profile
// that has not synced. The data is usually fine and comes back next launch. So
// the degraded session refuses writes and preserves the file.
//
// WHY IT MUST BE A FULL REFUSAL, not "write to the fallback only"
// The mtime staleness guard at the top of loadCredentials() deletes the keyring
// whenever the fallback is NEWER. A fallback-only write would therefore make
// the NEXT boot delete the very keyring file being preserved. Covered below.
//
// Both platforms: keyringAvailable=true + decryptString throwing is exactly the
// shape of a locked macOS Keychain AND of a Windows DPAPI failure, so these
// tests exercise the same branch that both platforms take.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/CredentialDegradedStoreGuard2026_08_05.test.mjs

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

function makeEnv() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-degraded-'));
  const state = { keyringAvailable: true, userData, decryptShouldThrow: false };
  const fakeElectron = {
    app: { getPath: () => state.userData, isPackaged: false, getVersion: () => '0.0.0-test' },
    safeStorage: {
      isEncryptionAvailable: () => state.keyringAvailable,
      encryptString: (s) => Buffer.concat([Buffer.from('KR'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => {
        // Models a locked keychain / denied prompt / unsynced DPAPI profile:
        // isEncryptionAvailable() says yes, the actual decrypt throws.
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

const SECRET = 'sk-deepgram-LIVE-SENTINEL-abc123XYZ';
const keyringPath = (env) => path.join(env.userData, 'credentials.enc');
const fallbackPath = (env) => path.join(env.userData, 'credentials.fallback.enc');

// ── the headline case: no fallback to fall back to ──────────────────────────

test('keyring unreadable + NO fallback: a later save must not wipe the keyring file', () => {
  const env = makeEnv();

  // Session 1: healthy. Store a key via the keyring.
  const cm1 = freshManager(env);
  assert.equal(cm1.setDeepgramApiKey(SECRET), true);
  assert.ok(fs.existsSync(keyringPath(env)), 'keyring file should exist');
  const intact = fs.readFileSync(keyringPath(env));
  assert.ok(!fs.existsSync(fallbackPath(env)), 'no fallback — this is the dangerous shape');

  // Session 2: keychain locked. Load yields EMPTY credentials.
  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.getDeepgramApiKey(), undefined, 'the key is not readable this session (expected)');
  assert.equal(cm2.isCredentialStoreDegraded(), true, 'the manager must know it is degraded');

  // The write that used to destroy everything.
  const saved = cm2.setSonioxApiKey('sk-soniox-new');
  assert.equal(saved, false, 'a degraded session must report the write as FAILED, not a false "Saved"');

  assert.deepEqual(
    fs.readFileSync(keyringPath(env)), intact,
    'the keyring file must be byte-identical — overwriting it here destroys every stored key with no copy anywhere',
  );

  // Session 3: keychain unlocked again. Everything is still there.
  env.state.decryptShouldThrow = false;
  const cm3 = freshManager(env);
  assert.equal(cm3.getDeepgramApiKey(), SECRET, 'the original key must survive the degraded session');
  assert.equal(cm3.isCredentialStoreDegraded(), false, 'a healthy load clears the degraded flag');
});

// ── the fallback-present variant ────────────────────────────────────────────

test('keyring unreadable + an OLDER fallback: saves refuse, and neither file is corrupted', () => {
  const env = makeEnv();

  // Build an older fallback (keyring unavailable), then a newer keyring.
  env.state.keyringAvailable = false;
  const cm1 = freshManager(env);
  cm1.setDeepgramApiKey('sk-OLD-fallback-value');
  assert.ok(fs.existsSync(fallbackPath(env)), 'fallback should exist');
  const oldFallback = fs.readFileSync(fallbackPath(env));

  env.state.keyringAvailable = true;
  const cm2 = freshManager(env);
  cm2.setDeepgramApiKey(SECRET);
  const intactKeyring = fs.readFileSync(keyringPath(env));

  // Re-create the older fallback next to the newer keyring.
  fs.writeFileSync(fallbackPath(env), oldFallback);
  const past = Date.now() - 60_000;
  fs.utimesSync(fallbackPath(env), past / 1000, past / 1000);

  // Keychain locks. Load falls through to the older fallback.
  env.state.decryptShouldThrow = true;
  const cm3 = freshManager(env);
  assert.equal(cm3.isCredentialStoreDegraded(), true);

  assert.equal(cm3.setSonioxApiKey('sk-soniox-new'), false, 'writes must be refused while degraded');
  assert.deepEqual(
    fs.readFileSync(keyringPath(env)), intactKeyring,
    'the newer keyring must not be overwritten from the older fallback',
  );

  // The full-refusal requirement: a fallback-only write would have made the
  // fallback NEWER than the keyring, and the mtime staleness guard would then
  // DELETE the keyring on this next boot.
  env.state.decryptShouldThrow = false;
  const cm4 = freshManager(env);
  assert.ok(fs.existsSync(keyringPath(env)), 'the keyring must survive to the next boot');
  assert.equal(cm4.getDeepgramApiKey(), SECRET, 'the newer keyring value wins once it is readable again');
});

// ── memory must not diverge from disk (Greptile P1 on PR #435) ──────────────

test('a refused write does not mutate in-memory state either', () => {
  // The first cut of this guard refused inside saveCredentials(), i.e. AFTER
  // the setter had already mutated `this.credentials`. 21 of the setters on
  // this class return void and discard the save result, so the value stayed
  // live in memory while never reaching disk: Settings would show a key as
  // saved that vanishes on restart. Reject BEFORE mutating instead.
  const env = makeEnv();
  const cm1 = freshManager(env);
  cm1.setDeepgramApiKey(SECRET);
  cm1.setGeminiApiKey('sk-gemini-ORIGINAL');

  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.isCredentialStoreDegraded(), true);

  // A void setter (no way to report failure) must leave memory untouched.
  cm2.setGeminiApiKey('sk-gemini-SHOULD-NOT-STICK');
  assert.notEqual(cm2.getGeminiApiKey(), 'sk-gemini-SHOULD-NOT-STICK',
    'a void setter must not leave an unpersisted value live in memory — the UI reads this back '
    + 'and would report a save that never reached disk');

  // A boolean setter must report false AND not mutate.
  assert.equal(cm2.setSonioxApiKey('sk-soniox-SHOULD-NOT-STICK'), false);
  assert.notEqual(cm2.getSonioxApiKey(), 'sk-soniox-SHOULD-NOT-STICK');
});

test('a refused Codex token rotation does not stick in memory', () => {
  // ChatGPT OAuth rotates the refresh token on every refresh, and
  // CodexOAuthService caches its own copy. Accepting a rotation that never
  // reaches disk means the session works until the next launch, which then
  // hits invalid_grant and forces a re-auth.
  const env = makeEnv();
  const cm1 = freshManager(env);
  cm1.setCodexOAuthTokens({
    accessToken: 'access-ORIGINAL', refreshToken: 'refresh-ORIGINAL', expiresAt: Date.now() + 3600_000,
  });

  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.isCredentialStoreDegraded(), true);

  cm2.setCodexOAuthTokens({
    accessToken: 'access-ROTATED', refreshToken: 'refresh-ROTATED', expiresAt: Date.now() + 3600_000,
  });
  const live = cm2.getCodexOAuthTokens();
  assert.notEqual(live?.refreshToken, 'refresh-ROTATED',
    'an unpersisted rotation must not be accepted in memory');

  // And the original is intact once the keychain unlocks.
  env.state.decryptShouldThrow = false;
  const cm3 = freshManager(env);
  assert.equal(cm3.getCodexOAuthTokens()?.refreshToken, 'refresh-ORIGINAL');
});

// ── structural: no future mutator may skip the guard ────────────────────────

test('EVERY method that calls saveCredentials() checks the degraded guard first', () => {
  // A per-method behavioural test cannot cover a setter that does not exist yet,
  // and the first pass at this fix missed four real mutators (saveCustomProvider,
  // deleteCustomProvider, saveCurlProvider, deleteCurlProvider) precisely because
  // they are not named set*/clear*. This walks the source instead, so a NEW
  // mutator added later fails here rather than silently reintroducing the
  // memory/disk divergence.
  const src = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../CredentialsManager.ts'),
    'utf8',
  );
  const lines = src.split('\n');
  const unguarded = [];
  let i = 0;
  while (i < lines.length) {
    const m = /^\s*(?:public|private|protected)?\s*(\w+)\(/.exec(lines[i]);
    if (m && lines[i].includes('{')) {
      const name = m[1];
      let depth = (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      let j = i + 1;
      const body = [];
      while (j < lines.length && depth > 0) {
        depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
        body.push(lines[j]);
        j++;
      }
      const b = body.join('\n');
      // loadCredentials legitimately calls save() for the migrate-up, and it is
      // the thing that SETS the flag; the two write primitives are the guard's home.
      const exempt = ['saveCredentials', 'writeCredentials', 'loadCredentials'];
      if (b.includes('this.saveCredentials()') && !exempt.includes(name)
          && !b.includes('refuseWriteWhileDegraded') && !b.includes('keyringUnreadable')) {
        unguarded.push(name);
      }
      i = j;
      continue;
    }
    i++;
  }
  assert.deepEqual(unguarded, [],
    'these methods write credentials without checking the degraded guard, so in a degraded session '
    + 'they mutate in-memory state that never reaches disk: ' + unguarded.join(', '));
});

// ── the escape hatch ────────────────────────────────────────────────────────

test('resetDegradedCredentialStore() is the only thing that discards the preserved file', () => {
  const env = makeEnv();
  const cm1 = freshManager(env);
  cm1.setDeepgramApiKey(SECRET);

  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.isCredentialStoreDegraded(), true);
  assert.equal(cm2.setDeepgramApiKey('nope'), false);

  cm2.resetDegradedCredentialStore();
  assert.equal(cm2.isCredentialStoreDegraded(), false, 'the explicit reset clears the degraded state');
  assert.ok(!fs.existsSync(keyringPath(env)), 'the unreadable file is discarded on explicit request');

  // Writes work again afterwards.
  assert.equal(cm2.setDeepgramApiKey('sk-fresh-start'), true);
});

// ── the healthy path is untouched ───────────────────────────────────────────

test('a normal session is unaffected — writes still persist', () => {
  const env = makeEnv();
  const cm1 = freshManager(env);
  assert.equal(cm1.isCredentialStoreDegraded(), false);
  assert.equal(cm1.setDeepgramApiKey(SECRET), true);

  const cm2 = freshManager(env);
  assert.equal(cm2.getDeepgramApiKey(), SECRET);
  assert.equal(cm2.setSonioxApiKey('sk-soniox'), true, 'ordinary writes must keep working');

  const cm3 = freshManager(env);
  assert.equal(cm3.getSonioxApiKey(), 'sk-soniox');
  assert.equal(cm3.getDeepgramApiKey(), SECRET);
});

test('a fresh install (no credential files at all) is not treated as degraded', () => {
  const env = makeEnv();
  const cm = freshManager(env);
  assert.equal(cm.isCredentialStoreDegraded(), false,
    'no keyring file means nothing to protect — writes must work on a first run');
  assert.equal(cm.setDeepgramApiKey(SECRET), true);
});
