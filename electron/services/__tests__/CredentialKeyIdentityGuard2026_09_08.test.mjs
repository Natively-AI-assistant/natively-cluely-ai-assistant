// safeStorage can hand two launches two DIFFERENT keys while telling both that
// encryption is available — so the app could overwrite a credential file it
// could never have read.
//
// REPRODUCED 2026-09-08 on macOS with a throwaway app name: a blob written under
// an automated (Playwright-driven) Electron launch could not be decrypted by a
// normal `electron .` launch, and vice versa, with the Keychain item untouched
// (cdat === mdat, months old). Both keys are stable, so each launcher reads its
// OWN writes and silently cannot read the other's. Chromium's OSCrypt falls back
// to a well-known key when the Keychain item is not reachable by the caller.
//
// Cost, before this guard: an automated launch rewrote a real user's
// credentials.enc; their next normal launch could not decrypt it, disabled saves,
// and began counting cold starts toward DECRYPT_FAIL_PERMANENT_THRESHOLD.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(process.cwd(), 'electron/services/CredentialsManager.ts'), 'utf8');

test('a key canary is stamped by whoever writes the credential file', () => {
  // The canary must be written in the SAME place as the content hash, or the
  // record could describe a different write than the file it sits beside.
  assert.match(src, /const KEY_CANARY_PLAINTEXT = 'natively\.safe-storage\.key-canary\.v1';/);
  assert.match(
    src,
    /this\.stampProvenance\('enc', Buffer\.from\(encrypted\)\);[\s\S]{0,400}?this\.stampKeyCanary\(\);/,
    'the canary stamp must be paired with the enc stamp',
  );
  assert.match(src, /next\.keyCanary = safeStorage\.encryptString\(KEY_CANARY_PLAINTEXT\)\.toString\('base64'\)/);
});

test('an absent canary reads as UNKNOWN, never as a mismatch', () => {
  // A store written before the canary existed is not evidence of anything.
  // Treating it as a mismatch would lock legacy users out of saving — a worse
  // bug than the one being prevented.
  const probe = src.slice(src.indexOf('private probeKeyIdentity'));
  assert.match(probe, /if \(!safeStorage\.isEncryptionAvailable\(\)\) return 'unknown';/);
  assert.match(probe, /if \(typeof canary !== 'string' \|\| !canary\) return 'unknown';/);
  // But a canary that will not decrypt IS evidence.
  assert.match(probe, /catch \{[\s\S]{0,260}?return 'different';/);
});

test('the mismatch is detected BEFORE anything can be written', () => {
  // Every other protection reacts to a decrypt that was attempted and failed —
  // one step too late for a session that writes before it reads (a startup
  // setPhoneMirrorToken, for instance), because by then the file it could never
  // have read has already been replaced.
  const load = src.slice(src.indexOf('private loadCredentials'));
  const probeAt = load.indexOf('this.probeKeyIdentity()');
  const readAt = load.indexOf('safeStorage.decryptString');
  assert.ok(probeAt >= 0, 'loadCredentials must probe key identity');
  assert.ok(readAt >= 0 && probeAt < readAt, 'the probe must run before the first decrypt attempt');
  assert.match(load, /if \(fs\.existsSync\(CREDENTIALS_PATH\) && this\.probeKeyIdentity\(\) === 'different'\)/);
});

test('both write gates refuse on a proven key mismatch, and both honour re-entry', () => {
  // saveCredentials and refuseWriteWhileDegraded must agree, or a setter would
  // reject a mutation the save would have accepted (or worse, the reverse).
  // The PREDICATE, not the raw flag — see the upgrade-safety test below for why
  // a different key on its own must not refuse a write.
  assert.match(src, /if \(this\.keyMismatchWouldDestroy\(\) && !this\.reentryRequired\) \{/);
  assert.match(src, /if \(!this\.keyringUnreadable && !this\.keyMismatchWouldDestroy\(\)\) return false;/);
  // reentryRequired is the escape hatch: once the store is classified
  // unrecoverable, refusing writes leaves the user unable to use the app at all.
  const gate = src.slice(src.indexOf('private refuseWriteWhileDegraded'));
  assert.match(gate.slice(0, 600), /if \(this\.reentryRequired\) return false;/);
});

test('the two degraded states give DIFFERENT recovery advice', () => {
  // "Unlock your keychain" is useless when the keychain is unlocked and simply
  // handed this launch a different key — which is exactly what a user saw.
  assert.match(src, /start the app the same way it was started when the credentials were saved/);
  assert.match(src, /an automated\/test launcher and a normal launch do not share a key/);
});

test('credential telemetry reports key IDENTITY, not just availability', () => {
  // The outage logged `available: true, mode: "keyring"` on every failing
  // startup — true, and useless. `available` says a key exists; this says
  // whether it is the right one.
  const tel = src.slice(src.indexOf('storesAmbiguous: this.credentialStoresAmbiguous,'));
  assert.match(tel.slice(0, 900), /keyIdentity: this\.probeKeyIdentity\(\)/);
  assert.match(tel.slice(0, 900), /keyIdentityMismatch: this\.keyIdentityMismatch/);
});

// ── UPGRADE SAFETY ──────────────────────────────────────────────────────────
// Every existing install has a credential file written before the canary
// existed. None of them may be locked out of saving.

test('an existing store written before the canary existed is never treated as a mismatch', () => {
  // probeKeyIdentity returns 'unknown' with no canary, and ONLY 'different'
  // latches. An upgrading user therefore keeps saving exactly as before, and the
  // first save stamps a canary for future launches.
  const load = src.slice(src.indexOf('private loadCredentials'));
  assert.match(load, /this\.probeKeyIdentity\(\) === 'different'/);
  assert.doesNotMatch(load, /probeKeyIdentity\(\) !== 'same'/,
    "must not latch on 'unknown' — that would lock out every pre-canary install");
});

test('a different key alone does NOT refuse writes — only a write that would destroy does', () => {
  // A session can legitimately hold a different key and still have a good
  // credential set: the app-managed fallback exists for that, and
  // preferFallbackThisLoad (keyring read SKIPPED because the fallback is newer)
  // reaches write time with keyringUnreadable false and writes ALLOWED.
  // Refusing on the raw flag would have broken those sessions.
  assert.match(
    src,
    /private keyMismatchWouldDestroy\(\): boolean \{\s*\n\s*return this\.keyIdentityMismatch && Object\.keys\(this\.credentials\)\.length === 0;/,
  );
  // Both write gates use the PREDICATE, never the raw flag.
  assert.match(src, /if \(this\.keyMismatchWouldDestroy\(\) && !this\.reentryRequired\) \{/);
  assert.match(src, /if \(!this\.keyringUnreadable && !this\.keyMismatchWouldDestroy\(\)\) return false;/);
  // And the user-facing "is the store degraded" answer follows the same rule.
  assert.equal((src.match(/return this\.keyringUnreadable \|\| this\.keyMismatchWouldDestroy\(\);/g) ?? []).length, 2);
});
