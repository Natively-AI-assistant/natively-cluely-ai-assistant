// LicenseManager: entitlement + overwrite protection when the Rust native
// module IS present, i.e. when hardware ownership is decidable.
//
// Companion to LicenseNativeModuleAbsent.test.mjs, which pins the opposite
// state. The split is forced by the implementation: `getHardwareId` is a
// module-level binding seeded once at import from loadNativeModule(), so a
// single process can only ever model one of the two. Neither file's assertions
// mean anything without the other's.
//
// What only this file can reach:
//   - the HWID-MATCH branch — a perpetual license that is genuinely granting
//     Pro right now, so skipping an API-key activation costs the user nothing;
//   - the HWID-MISMATCH branch — a license PROVEN to belong to another device
//     (a stale license.enc from someone else's backup). It grants nothing here,
//     and protecting it would block the user's own API-key activation with no
//     visible error, so protection must be released.
//
// That mismatch branch was previously asserted by regex-matching the source of
// premium/electron/services/LicenseManager.ts. That test could not fail for the
// right reason (an equivalent refactor broke it; a behavioural regression did
// not), read submodule source that is absent under a checkout without
// `submodules: true`, and resolved its path against process.cwd(). It is
// replaced by the real thing here.
//
// Platform note: no process.platform branch is involved. The native module is
// equally present/absent on macOS and Windows and the provider branching is
// identical, so one run covers both.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-license-present-'));
process.env.NATIVELY_TEST_USERDATA = USER_DATA;

const LICENSE_PATH = path.join(USER_DATA, 'license.enc');

// Resolve stubs relative to THIS file, not process.cwd() — the runner's working
// directory is not something a test may assume. fileURLToPath (not URL.pathname)
// because the latter yields "/C:/..." on Windows.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const electronStub = path.join(HERE, '__electron_license_stub.mjs');
const nativeStub = path.join(HERE, '__native_module_stub.cjs');
const { HWID: THIS_DEVICE_HWID, control: native } = createRequire(import.meta.url)(nativeStub);
const OTHER_DEVICE_HWID = 'f'.repeat(64);

// Two redirects, both installed before the bundle loads:
//   'electron'  → app.getPath/safeStorage stand-in
//   *.node      → the fake native module, which is what makes getHardwareId
//                 available. nativeModuleLoader builds an ABSOLUTE path and
//                 require()s it; _resolveFilename sees absolute requests too,
//                 so the path never has to exist on disk.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  if (typeof request === 'string' && request.endsWith('.node')) return nativeStub;
  return originalResolve.call(this, request, ...rest);
};

const { LicenseManager } = await import(
  '../../../dist-electron/premium/electron/services/LicenseManager.js'
);

after(() => {
  Module._resolveFilename = originalResolve;
  fs.rmSync(USER_DATA, { recursive: true, force: true });
});

/** Write a license.enc exactly as storeLicense() would. */
function writeLicense(provider, hwid, extra = {}) {
  const payload = {
    key: 'gumroad-lifetime-key',
    hwid,
    activatedAt: new Date().toISOString(),
    ...(provider ? { provider } : {}),
    ...extra,
  };
  fs.writeFileSync(LICENSE_PATH, Buffer.from(`ENC:${JSON.stringify(payload)}`, 'utf8'));
}

/** Cold app launch. Both singleton handles must be cleared — getInstance()
 *  falls back to the static when the globalThis anchor is gone. */
function freshManager() {
  delete globalThis.__nativelyLicenseManagerV1__;
  LicenseManager.instance = undefined;
  return LicenseManager.getInstance();
}

/** Fail loudly rather than silently reaching the network. */
const originalFetch = globalThis.fetch;
beforeEach(() => {
  fs.rmSync(LICENSE_PATH, { force: true });
  native.reset();
  globalThis.fetch = async () => {
    throw new Error('unexpected network call: these paths must decide before /v1/pro/verify');
  };
});
after(() => {
  globalThis.fetch = originalFetch;
});

before(() => {
  // Guard the premise. If the stub failed to load, getHardwareId is undefined,
  // every assertion below silently becomes the ABSENT case, and this file
  // duplicates its companion instead of covering the branches only it can reach.
  assert.equal(
    freshManager().getHardwareId(),
    THIS_DEVICE_HWID,
    'precondition failed: native module stub not loaded — this test must run with it PRESENT',
  );
});

describe('native module present: this device owns the license', () => {
  test('a matching HWID grants Pro', () => {
    writeLicense('gumroad', THIS_DEVICE_HWID);
    assert.equal(freshManager().isPremium(), true);
  });

  test('activateWithApiKey skips WITHOUT an error — the license is already granting Pro', async () => {
    // The skip is benign here and must stay silent: ownership is verifiable and
    // matched, so the perpetual license is active on this device right now and
    // refusing the API key costs the user nothing. This is the branch that
    // distinguishes a benign skip from the unverifiable one, which MUST carry a
    // reason (asserted in LicenseNativeModuleAbsent.test.mjs).
    writeLicense('gumroad', THIS_DEVICE_HWID);
    const before = fs.readFileSync(LICENSE_PATH);

    const result = await freshManager().activateWithApiKey('natively_sk_other');

    assert.equal(result.skipped, true);
    assert.equal(result.error, undefined, 'a benign skip must not surface an error to the user');
    assert.deepEqual(fs.readFileSync(LICENSE_PATH), before, 'license.enc was modified');
  });
});

describe('native module present: the license belongs to ANOTHER device', () => {
  test('a mismatched HWID grants nothing', () => {
    writeLicense('gumroad', OTHER_DEVICE_HWID);
    const mgr = freshManager();
    assert.equal(mgr.isPremium(), false);
    assert.equal(mgr.getLicenseDetails().isPremium, false);
  });

  test('activateWithApiKey is NOT skipped — protection is released for a proven-foreign license', async () => {
    // The behavioural assertion the source-regex test was standing in for.
    // Protection exists for licenses whose ownership is UNVERIFIABLE, not for
    // ones positively shown to be foreign: a stale license.enc restored from
    // another machine's backup grants nothing here, and treating it as
    // protected would block the user's own API-key activation with no visible
    // error (the skip path has no UI surface).
    writeLicense('gumroad', OTHER_DEVICE_HWID);

    // Reaching the network IS the pass condition — it proves the protection
    // branch was not taken. Answer it locally rather than calling out.
    globalThis.fetch = async () => ({
      status: 200,
      json: async () => ({ ok: true, has_pro: true, plan: 'ultra' }),
    });

    const result = await freshManager().activateWithApiKey('natively_sk_mine');

    assert.notEqual(result.skipped, true, 'a proven-foreign license must not block activation');
    assert.equal(result.success, true);

    const stored = JSON.parse(
      fs.readFileSync(LICENSE_PATH, 'utf8').replace(/^ENC:/, ''),
    );
    assert.equal(stored.provider, 'natively_api', 'the foreign license should have been replaced');
  });

  test('a foreign legacy license (no provider field) is also released', async () => {
    // Legacy files predate the provider field and are treated as HWID-bound.
    // A mismatch is just as provable for them.
    writeLicense(undefined, OTHER_DEVICE_HWID);
    globalThis.fetch = async () => ({
      status: 200,
      json: async () => ({ ok: true, has_pro: true, plan: 'pro' }),
    });

    const result = await freshManager().activateWithApiKey('natively_sk_mine');
    assert.notEqual(result.skipped, true);
  });
});

describe('native module present: replacing one perpetual license with another', () => {
  // activateLicense() is the user deliberately entering a new Gumroad/Dodo key,
  // so it opts into replacing a perpetual license (storeLicense's
  // replacePerpetual). Driven end to end through activateLicense rather than by
  // calling storeLicense directly: the opt-in argument at each call site IS the
  // contract, and a direct call cannot tell whether a site still passes it.
  //
  // COVERAGE, stated honestly: the Dodo OK:, 409-with-id, 409-without-id,
  // 422+validate-OK and Gumroad sites are each driven below. The 422-without-
  // validate site is covered by the separate suite that pins its refusal. If a
  // site is added later, add a case here — a missing one fails silently, because
  // the guard's refusal looks like an ordinary unsuccessful activation.
  test('a deliberate Dodo swap is written, not refused', async () => {
    writeLicense('dodo', THIS_DEVICE_HWID, { key: 'DODO-OLD', instanceId: 'lki_old' });
    native.verifyDodo = 'OK:lki_new';

    const result = await freshManager().activateLicense('DODO-NEW');

    assert.equal(result.success, true, result.error);
    const stored = JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8').replace(/^ENC:/, ''));
    assert.equal(stored.key, 'DODO-NEW');
    assert.equal(stored.instanceId, 'lki_new');
  });

  test('the 409-with-instance-id site keeps its opt-in', async () => {
    // Dodo says the key is already activated and hands back the existing slot.
    // The key is proven real, so this is a server-confirmed branch and must be
    // allowed over a perpetual license. Drop the opt-in here and the guard
    // refuses a key Dodo just vouched for.
    writeLicense('gumroad', THIS_DEVICE_HWID, { key: 'GUM-OLD' });
    native.verifyDodo = 'ERR:dodo:duplicate:lki_existing';

    const result = await freshManager().activateLicense('DODO-DUP');

    assert.equal(result.success, true, result.error);
    const stored = JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8').replace(/^ENC:/, ''));
    assert.equal(stored.key, 'DODO-DUP');
    assert.equal(stored.instanceId, 'lki_existing');
  });

  test('the 409-without-instance-id site keeps its opt-in', async () => {
    // Same branch, conflict body with no id. Still server-confirmed.
    writeLicense('gumroad', THIS_DEVICE_HWID, { key: 'GUM-OLD' });
    native.verifyDodo = 'ERR:dodo:duplicate';

    const result = await freshManager().activateLicense('DODO-DUP');

    assert.equal(result.success, true, result.error);
    assert.equal(
      JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8').replace(/^ENC:/, '')).key,
      'DODO-DUP',
    );
  });

  test('the 422-with-validate-OK site keeps its opt-in', async () => {
    // The activation limit is full but validate confirms the user owns the key,
    // so ownership IS established and the write must be allowed. This is the
    // branch the 422-WITHOUT-validate case is deliberately distinguished from.
    writeLicense('gumroad', THIS_DEVICE_HWID, { key: 'GUM-OLD' });
    native.verifyDodo = 'ERR:dodo:limit_reached';
    native.validateDodo = 'OK';

    const result = await freshManager().activateLicense('DODO-LIMITED');

    assert.equal(result.success, true, result.error);
    assert.equal(
      JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8').replace(/^ENC:/, '')).key,
      'DODO-LIMITED',
    );
  });

  test('a Gumroad key may replace a Dodo license', async () => {
    writeLicense('dodo', THIS_DEVICE_HWID, { key: 'DODO-OLD', instanceId: 'lki_old' });
    native.verifyDodo = 'ERR:dodo:invalid';
    native.verifyGumroad = 'OK';

    const result = await freshManager().activateLicense('GUMROAD-KEY');

    assert.equal(result.success, true, result.error);
    assert.equal(
      JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8').replace(/^ENC:/, '')).provider,
      'gumroad',
    );
  });

  test('replacing a license does NOT touch the server activation seat', async () => {
    // A previous revision freed the displaced license's Dodo seat here. It was
    // removed: it proved the license FILE belonged to this device but not the
    // stored instanceId, which a 409-duplicate response can populate with
    // ANOTHER machine's activation — so the swap could silently revoke a
    // different computer. The seat is left alone until that ownership question
    // has a real answer.
    writeLicense('dodo', THIS_DEVICE_HWID, { key: 'DODO-OLD', instanceId: 'lki_old' });
    native.verifyDodo = 'OK:lki_new';

    await freshManager().activateLicense('DODO-NEW');

    assert.deepEqual(native.calls.deactivateDodo, [], 'a swap must not deactivate anything server-side');
  });

  test('without the opt-in the same write is REFUSED — one guard, at the writer', async () => {
    // The guard lives in storeLicense, not in its callers: a caller-side check
    // could be (and was) missing on one path, and where it existed it was
    // evaluated before an 8s network round trip. Any caller that does not
    // explicitly opt in is protected here, whatever it forgot to do.
    writeLicense('dodo', THIS_DEVICE_HWID, { key: 'DODO-OLD', instanceId: 'lki_old' });
    const before = fs.readFileSync(LICENSE_PATH);

    const result = await freshManager().storeLicense('natively_sk_x', 'natively_api', undefined, 'ultra');

    assert.equal(result.success, false);
    assert.equal(result.skipped, true);
    assert.deepEqual(fs.readFileSync(LICENSE_PATH), before, 'license.enc was modified');
  });
});

describe('native module present: what a benign skip reports', () => {
  test('activateLicense does NOT claim success for a key it never validated', async () => {
    // The guard returns before /v1/pro/verify, so nothing checked this key and
    // nothing stored it. Reporting success told a user their subscription key
    // was registered when a typo'd or revoked key would say exactly the same.
    // Reporting "Failed to activate with API key" was equally untrue. The
    // result must say what happened: Pro is already on, the key was not applied.
    writeLicense('gumroad', THIS_DEVICE_HWID);

    const result = await freshManager().activateLicense('natively_sk_never_validated');

    assert.equal(result.success, false, 'an unvalidated key must not report success');
    assert.match(result.error, /already active/i);
    assert.doesNotMatch(result.error, /failed to activate/i, 'must not blame the key');
  });

  test('the guard does NOT mutate cachedPremium — it must fail closed', async () => {
    // The guard used to clear the cache here, so a stale `false` from a transient
    // safeStorage failure at launch could not outlive an activation attempt. That
    // failed OPEN: removeLocalLicenseFile() is best-effort, so after a
    // server-confirmed revocation whose unlink failed, license.enc survives and
    // the cached `false` is the ONLY thing withholding Pro — clearing it handed
    // the revoked license back for the rest of the session. A stale `false` costs
    // a restart; this costs entitlement. The guard is side-effect free again,
    // which is also what makes it safe for storeLicense to re-run as the authority.
    writeLicense('gumroad', THIS_DEVICE_HWID);
    const mgr = freshManager();
    mgr.cachedPremium = false; // as a revocation would leave it

    const result = await mgr.activateWithApiKey('natively_sk_x');

    assert.equal(result.skipped, true, 'precondition: the guard must fire');
    assert.equal(mgr.cachedPremium, false, 'the guard resurrected a withheld verdict');
    assert.equal(mgr.isPremium(), false, 'a revoked license must stay revoked for the session');
  });

  test('a revocation clears license.enc.tmp too, so Pro cannot be renamed back', async () => {
    // storeLicense writes license.enc.tmp and unlinks it on failure, but that
    // unlink is best-effort — on Windows the lock that failed the rename can fail
    // it too. A leftover .tmp is a complete, safeStorage-decryptable license, so a
    // revoked user could rename one file and be Pro again.
    writeLicense('natively_api', THIS_DEVICE_HWID, { plan: 'ultra' });
    fs.writeFileSync(LICENSE_PATH + '.tmp', fs.readFileSync(LICENSE_PATH));

    const mgr = freshManager();
    assert.equal(mgr.isPremium(), true, 'precondition: Pro is active');

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      status: 200,
      json: async () => ({ ok: true, has_pro: false, plan: 'standard' }),
    });
    let stillPro;
    try {
      stillPro = await mgr.isPremiumAsync();
    } finally {
      globalThis.fetch = previousFetch;
    }

    assert.equal(stillPro, false);
    assert.equal(fs.existsSync(LICENSE_PATH), false, 'the revoked license must be removed');
    assert.equal(
      fs.existsSync(LICENSE_PATH + '.tmp'),
      false,
      'a decryptable .tmp survived the revocation and can be renamed back into Pro',
    );
  });

});

describe('native module present: an unvalidated key must not displace a verified license', () => {
  test('a 422 with no validation available does NOT overwrite a perpetual license', async () => {
    // 422 alone only says the product's activation limit is full — an invalid key
    // produces it too. When validateDodoKey is missing from the binary (the
    // module-load block warns this happens with a stale .node) nothing has
    // confirmed the key, so this branch must not carry the replacePerpetual
    // opt-in that the server-confirmed branches do. Otherwise a typo'd key
    // replaces a verified Gumroad license, and the next validate revokes it.
    writeLicense('gumroad', THIS_DEVICE_HWID, { key: 'GUM-VERIFIED' });
    const before = fs.readFileSync(LICENSE_PATH);
    native.verifyDodo = 'ERR:dodo:limit_reached';
    native.validateDodo = new Error('validateDodoKey not in binary');

    const result = await freshManager().activateLicense('WRONG-KEY');

    assert.notEqual(result.success, true, 'an unvalidated key must not be stored over a verified one');
    assert.deepEqual(fs.readFileSync(LICENSE_PATH), before, 'the verified license was overwritten');
  });
});
