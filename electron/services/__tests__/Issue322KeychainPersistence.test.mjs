// Issue #322 reproduction — STT API key "shows as invalid after restart" on macOS.
//
// The real signal is @Hassansidiqui's comment: paste an STT key, it connects and works;
// SAVE, CLOSE the app, REOPEN — the key now shows as invalid. On macOS the keyring
// (safeStorage) is normally AVAILABLE, so this is the KEYCHAIN round-trip, not the
// app-managed fallback that the June-22 fixes (eaa19fd / f2dc18c) hardened — those target
// the keyring-UNAVAILABLE branch + the false-"Saved" badge.
//
// Electron's macOS safeStorage binds the keychain item ("Natively Safe Storage") to
// app.getName() AND to an ACL scoped to the app's CODE SIGNATURE (Chromium OSCrypt).
// Natively IS signed + notarized with a stable Developer ID (electron-builder.signed.cjs,
// since v2.7), but build/entitlements.mac.plist declares no `keychain-access-groups`, so
// the item's ACL is bound to the concrete signing context rather than a stable team group.
// safeStorage.decryptString() can therefore THROW when the reading signing context differs
// from the writing one — most plausibly a user who saved keys on a pre-v2.7 UNSIGNED build
// and updated to the signed build, or a denied per-launch keychain-access prompt. When it
// throws, loadCredentials() drops ALL keys to {}, and — the actual permanent-loss bug a
// SUBSEQUENT save in that same session overwrites the (unreadable but possibly
// recoverable-next-launch) keyring file with an encrypted "{}" and deletes the fallback, so
// the key is gone for good even after the keychain becomes readable again.
//
// This test pins the "don't make it worse" half: the clobber-guard must preserve the
// undecryptable store so a later readable launch can recover it. It does NOT (and cannot)
// make the key readable in the failing session — that needs the keychain-layer fix
// (a stable keychain-access-groups entitlement and/or a re-enter-then-fallback prompt).
//
// Run via: npm run build:electron && node --test electron/services/__tests__/Issue322KeychainPersistence.test.mjs

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

// Electron mock whose safeStorage models the macOS Keychain: `decryptShouldThrow` makes
// decryptString throw exactly the way a locked/denied keychain or a changed-signature
// ACL does on a real machine. Encryption stays available throughout (the reporter's mac
// has a working keyring), so the code always takes the keyring branch.
function makeEnv() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'issue322-'));
  const state = { keyringAvailable: true, userData, decryptShouldThrow: false };
  const fakeElectron = {
    app: { getPath: () => state.userData, isPackaged: false, getVersion: () => '0.0.0-test', getName: () => 'Natively' },
    safeStorage: {
      isEncryptionAvailable: () => state.keyringAvailable,
      encryptString: (s) => Buffer.concat([Buffer.from('KC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => {
        if (state.decryptShouldThrow) {
          throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString');
        }
        const text = Buffer.from(b).toString('utf8');
        if (!text.startsWith('KC:')) throw new Error('not a keychain blob');
        return text.slice(3);
      },
      getSelectedStorageBackend: () => 'unknown',
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

function freshManager(env) {
  CURRENT = env;
  delete require.cache[require.resolve(COMPILED)];
  const mod = require(COMPILED);
  if (mod.CredentialsManager.instance) mod.CredentialsManager.instance = undefined;
  const cm = mod.CredentialsManager.getInstance();
  cm.init();
  return cm;
}

const SECRET = 'dg-LIVE-SENTINEL-issue322-abc123XYZ';
const encPath = (env) => path.join(env.userData, 'credentials.enc');

test('macOS keyring AVAILABLE: STT key survives save → close → reopen (sanity)', () => {
  const env = makeEnv();

  const cm = freshManager(env);
  const persisted = cm.setDeepgramApiKey(SECRET);
  assert.equal(persisted, true, 'keyring save must report success');
  assert.ok(fs.existsSync(encPath(env)), 'keyring file written');

  const cm2 = freshManager(env);
  assert.equal(cm2.getDeepgramApiKey(), SECRET, 'STT key must survive a normal restart');
});

test('REPRO: a save during a keychain-decrypt-FAILED session must not permanently destroy the stored key', () => {
  const env = makeEnv();

  // 1) User pastes the key, it connects, saved under a readable keychain.
  const cm = freshManager(env);
  cm.setDeepgramApiKey(SECRET);
  assert.equal(cm.getDeepgramApiKey(), SECRET);

  // 2) Reopen while the keychain is momentarily unreadable (ACL prompt denied, or a
  //    signing-context mismatch after a signed update / pre-v2.7 migration). decryptString throws.
  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.getDeepgramApiKey(), undefined, 'this session cannot read the key (expected)');

  // 3) Something writes credentials during this failed session (any setter / startup
  //    reconfigure / self-heal that calls saveCredentials while creds are empty).
  //    BUG: the old code overwrites credentials.enc with an encrypted "{}" and deletes
  //    the fallback — destroying the key for good. The fix must refuse to overwrite an
  //    existing on-disk store with an EMPTY credential set.
  cm2.saveCredentials(); // white-box: models the empty-state save that caused the clobber

  // 4) Keychain readable again next launch — the key MUST still be recoverable.
  env.state.decryptShouldThrow = false;
  const cm3 = freshManager(env);
  assert.equal(cm3.getDeepgramApiKey(), SECRET,
    'key must survive a transient keychain failure — an empty-state save must not clobber it');
});

test('wasExistingStoreUnreadable() reports true ONLY during an undecryptable-store launch', () => {
  const env = makeEnv();

  // Healthy first run with a saved key → not unreadable.
  const cm = freshManager(env);
  cm.setDeepgramApiKey(SECRET);
  assert.equal(cm.wasExistingStoreUnreadable(), false, 'a clean save is not an unreadable store');

  // Reopen while the keychain can't decrypt → flag must be true so startup self-heals
  // (e.g. the GOOGLE_APPLICATION_CREDENTIALS persist in main.ts) know to skip persisting.
  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.wasExistingStoreUnreadable(), true, 'undecryptable existing store must report unreadable');

  // Healthy launch again → real data loads, flag clears.
  env.state.decryptShouldThrow = false;
  const cm3 = freshManager(env);
  assert.equal(cm3.getDeepgramApiKey(), SECRET);
  assert.equal(cm3.wasExistingStoreUnreadable(), false, 'a successful load clears the flag');
});

test('REPRO (side door): a single-field auto-populate during an unreadable session must not clobber the store', () => {
  // This models the main.ts startup self-heal that persists GOOGLE_APPLICATION_CREDENTIALS.
  // It calls a PUBLIC single-field setter (setGoogleServiceAccountPath) — which makes creds
  // non-empty, so saveCredentials()'s empty-set guard does NOT fire. The protection has to
  // live at the CALL SITE via wasExistingStoreUnreadable(); this test asserts that contract:
  // an auto-heal that respects the flag leaves the recoverable store intact.
  const env = makeEnv();

  const cm = freshManager(env);
  cm.setDeepgramApiKey(SECRET);

  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.getDeepgramApiKey(), undefined, 'unreadable this session (expected)');

  // The fixed call site checks the flag before persisting. Emulate that guarded self-heal:
  if (!cm2.wasExistingStoreUnreadable()) {
    cm2.setGoogleServiceAccountPath('/some/env/service-account.json');
  }
  // (If the guard were missing and we called the setter unconditionally, the next launch
  //  would lose SECRET — that is the bug this test pins shut.)

  env.state.decryptShouldThrow = false;
  const cm3 = freshManager(env);
  assert.equal(cm3.getDeepgramApiKey(), SECRET,
    'a flag-respecting auto-heal must not overwrite the still-recoverable store');
});

test('REPRO (side door 2): PhoneMirror ext-token mint during an unreadable session must not clobber the store', () => {
  // Models PhoneMirrorService.loadOrCreatePersistedExtToken(): at startup it mints a fresh ext
  // token and persists it via setPhoneMirrorToken() when none is found. During an unreadable
  // launch getPhoneMirrorToken() is undefined (creds are the empty recovery set), so an
  // unguarded mint would write a single-field { phoneMirrorToken } — non-empty, past
  // saveCredentials()'s empty-set guard — clobbering the recoverable keyring file. The fixed
  // call site mints in memory but only PERSISTS when !wasExistingStoreUnreadable().
  //
  // NOTE: this mirrors the call-site guard rather than importing the bundled function, because
  // PhoneMirrorService is esbuild-bundled with its OWN inlined CredentialsManager singleton —
  // driving the real function would require a test-only CM accessor in production code, a worse
  // tradeoff than this contract test. The guard mechanism itself (wasExistingStoreUnreadable →
  // skip persist → store survives) is exercised end-to-end here and verified honest: defeating
  // the getter makes this and side-door-1 fail. The matching production call site is covered by
  // PhoneMirrorExtensionV2.test.mjs's persist round-trip on the healthy path.
  const env = makeEnv();

  const cm = freshManager(env);
  cm.setDeepgramApiKey(SECRET);

  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.getPhoneMirrorToken(), undefined, 'no persisted ext token readable this session');

  // Emulate loadOrCreatePersistedExtToken()'s guarded mint-and-persist.
  const fresh = 'ext-tok-FRESH-0123456789abcdef';
  if (!cm2.wasExistingStoreUnreadable()) {
    cm2.setPhoneMirrorToken(fresh);
  }

  env.state.decryptShouldThrow = false;
  const cm3 = freshManager(env);
  assert.equal(cm3.getDeepgramApiKey(), SECRET,
    'a flag-respecting ext-token mint must not overwrite the still-recoverable store');
});

// ───────────────────────────────────────────────────────────────────────────
// Recovery state machine (issue #322 production fix): transient vs permanent
// classification, the re-enter banner signal, fallback fall-through, and re-key.
// ───────────────────────────────────────────────────────────────────────────

const sidecarPath = (env) => path.join(env.userData, 'credentials.decryptfail');

test('TRANSIENT: ≤2 decrypt failures do NOT trigger re-entry, then a healthy launch recovers', () => {
  const env = makeEnv();

  const cm = freshManager(env);
  cm.setDeepgramApiKey(SECRET);
  assert.equal(cm.needsCredentialReentry(), false);

  // Two failing cold starts (below the threshold of 3).
  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.needsCredentialReentry(), false, 'failure 1/3 is still transient — no banner');
  const cm3 = freshManager(env);
  assert.equal(cm3.needsCredentialReentry(), false, 'failure 2/3 is still transient — no banner');

  // The keychain recovers on the 3rd launch (it was a transient lock all along).
  env.state.decryptShouldThrow = false;
  const cm4 = freshManager(env);
  assert.equal(cm4.getDeepgramApiKey(), SECRET, 'key recovers once the keychain is readable again');
  assert.equal(cm4.needsCredentialReentry(), false, 'recovery clears any pending re-entry state');
  assert.ok(!fs.existsSync(sidecarPath(env)), 'the decrypt-fail sidecar is deleted after recovery');
});

test('PERMANENT: 3 distinct cold-start decrypt failures escalate to needsCredentialReentry', () => {
  const env = makeEnv();

  const cm = freshManager(env);
  cm.setDeepgramApiKey(SECRET);

  env.state.decryptShouldThrow = true;
  freshManager(env);                // failure 1
  freshManager(env);                // failure 2
  const cm3 = freshManager(env);    // failure 3 → permanent
  assert.equal(cm3.needsCredentialReentry(), true, 'reaches the re-enter banner at the 3rd failure');
  assert.ok(fs.existsSync(encPath(env)), 'the undecryptable keyring file is PRESERVED, never deleted');
});

test('RE-ENTER heals: saving a real key during permanent-fail persists and clears the banner', () => {
  const env = makeEnv();

  const cm = freshManager(env);
  cm.setDeepgramApiKey(SECRET);

  // Drive to permanent.
  env.state.decryptShouldThrow = true;
  freshManager(env); freshManager(env);
  const broken = freshManager(env);
  assert.equal(broken.needsCredentialReentry(), true);

  // User re-enters a NEW key. Decrypt is still "broken" for the OLD ciphertext, but the
  // fresh write creates a new readable item (the test mock always decrypts what it wrote
  // unless decryptShouldThrow — so flip it off to model the healed, re-keyed item).
  env.state.decryptShouldThrow = false;
  const NEW = 'dg-REENTERED-KEY-987zzz';
  const persisted = broken.setDeepgramApiKey(NEW);
  assert.equal(persisted, true, 're-entered key persists');
  assert.equal(broken.needsCredentialReentry(), false, 're-key clears the banner immediately');
  assert.ok(!fs.existsSync(sidecarPath(env)), 're-key deletes the decrypt-fail sidecar');

  // Next cold start reads the re-keyed value cleanly.
  const after = freshManager(env);
  assert.equal(after.getDeepgramApiKey(), NEW, 'the re-entered key survives restart');
  assert.equal(after.needsCredentialReentry(), false);
});

test('FALLBACK fall-through: an undecryptable keyring file no longer strands a readable fallback', () => {
  // Models a user already routed to the app-managed fallback (after a permanent keychain
  // failure) whose stale credentials.enc still exists. The OLD code early-returned on the
  // keyring decrypt-throw and never tried the fallback, stranding them. Now it falls through.
  const env = makeEnv();

  // Phase A — keyring unavailable: a save lands in the app-managed fallback (no enc written).
  env.state.keyringAvailable = false;
  const cm = freshManager(env);
  cm.setDeepgramApiKey(SECRET);
  const fallbackFile = path.join(env.userData, 'credentials.fallback.enc');
  assert.ok(fs.existsSync(fallbackFile), 'fallback written while keyring down');
  assert.ok(!fs.existsSync(encPath(env)), 'no enc file while keyring down');

  // Phase B — simulate a leftover, undecryptable keyring file (e.g. one written by the
  // pre-migration signed build) sitting alongside the good fallback.
  fs.writeFileSync(encPath(env), Buffer.from('KC:{"stale":"unreadable"}'));

  // Phase C — keyring returns but that enc is undecryptable (#322 mismatch). The loader must
  // fall through to the readable fallback instead of early-returning empty.
  env.state.keyringAvailable = true;
  env.state.decryptShouldThrow = true;
  const cm2 = freshManager(env);
  assert.equal(cm2.getDeepgramApiKey(), SECRET,
    'undecryptable keyring file must fall through to the readable app-managed fallback');
});

test('VERIFIED-HEALED: a recovery re-key KEEPS the fallback until a cold-start decrypt proves the keyring readable', () => {
  // The HIGH finding: the recovery population's keyring is broken by definition, so deleting
  // the fallback immediately on re-key bets everything on the entitlement having healed the
  // ACL — unprovable until a FRESH launch decrypts. This test pins the safety net: during a
  // recovery re-key the fallback survives, and only a real cold-start decrypt deletes it.
  const env = makeEnv();
  const fallbackFile = path.join(env.userData, 'credentials.fallback.enc');

  // Drive to permanent-fail with a fallback present (keyring down → fallback written), then a
  // stale undecryptable enc appears, then the keyring "returns" but still can't decrypt.
  env.state.keyringAvailable = false;
  const a = freshManager(env);
  a.setDeepgramApiKey(SECRET);
  assert.ok(fs.existsSync(fallbackFile), 'fallback seeded while keyring down');

  // Keyring returns but the enc is undecryptable → loader recovers from fallback and re-keys.
  fs.writeFileSync(encPath(env), Buffer.from('KC:{"stale":"unreadable"}'));
  env.state.keyringAvailable = true;
  env.state.decryptShouldThrow = true;
  const b = freshManager(env);
  assert.equal(b.getDeepgramApiKey(), SECRET, 'recovered from fallback this launch');
  // The migrate-up re-key ran, but because the keyring item is still unproven, the fallback
  // MUST still exist as the safety net.
  assert.ok(fs.existsSync(fallbackFile),
    'verified-healed gate: the fallback safety net is preserved through a recovery re-key');

  // SUBSEQUENT launch where the re-key is STILL broken (entitlement didn't heal): the user is
  // NOT stranded — the preserved fallback rescues them again.
  const c = freshManager(env);
  assert.equal(c.getDeepgramApiKey(), SECRET,
    'if the re-key never healed, the preserved fallback still rescues the user');

  // Finally the keychain becomes genuinely readable: the load-success path cleans up the
  // now-redundant fallback.
  env.state.decryptShouldThrow = false;
  // Write a readable enc to model the healed item (encrypt via the mock's own format).
  const d = freshManager(env);
  // d recovered from fallback (enc still the stale unreadable blob until a real write), so its
  // migrate-up re-key writes a READABLE enc now that decryptShouldThrow is false.
  assert.equal(d.getDeepgramApiKey(), SECRET);
  const e = freshManager(env);
  assert.equal(e.getDeepgramApiKey(), SECRET, 'key now served from the healed keyring item');
  assert.ok(!fs.existsSync(fallbackFile),
    'once a cold-start decrypt proves the keyring readable, the redundant fallback is removed');
});
