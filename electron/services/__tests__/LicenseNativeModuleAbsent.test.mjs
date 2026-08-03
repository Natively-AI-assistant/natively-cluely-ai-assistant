// LicenseManager: entitlement resolution when the Rust native module is ABSENT.
//
// Regression for a silent Pro revocation. storeLicense() deliberately exempts
// 'natively_api' from the HWID requirement (those licenses are server-validated
// per-request, not device-bound), but the three READ paths did not agree with
// it: readStoredLicense(), isPremium() and getLicenseDetails() each bailed out
// on `!getHardwareId` before ever looking at the provider.
//
// Consequence on any machine where loadNativeModule() returns null — an unbuilt
// dev checkout, an ASAR unpack failure, or AV quarantine of the .node on
// Windows — an API-plan key activated successfully and wrote license.enc, yet
// every read reported isPremium:false. The Modes Manager only appeared to
// unlock because App.tsx trusts the 'license-status-changed' event payload
// directly; Profile Intelligence queries licenseGetDetails() and so kept
// showing its Pro gate wall. Nothing in main ever agreed the user had Pro.
//
// The invariant the fix must NOT break: gumroad/dodo licenses are HWID-bound,
// so with no native module their device binding is unverifiable and they must
// still resolve to false. Both branches are asserted below.
//
// Platform note: this logic has no process.platform branch — the native module
// is equally absent on macOS and Windows, and the provider branching is
// identical. One run covers both.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-license-'));
process.env.NATIVELY_TEST_USERDATA = USER_DATA;

const LICENSE_PATH = path.join(USER_DATA, 'license.enc');

// Redirect require('electron') to the stub before loading the bundle.
const stubPath = path.resolve('electron/services/__tests__/__electron_license_stub.mjs');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return stubPath;
  return originalResolve.call(this, request, ...rest);
};

const { LicenseManager } = await import(
  '../../../dist-electron/premium/electron/services/LicenseManager.js'
);

after(() => {
  Module._resolveFilename = originalResolve;
  fs.rmSync(USER_DATA, { recursive: true, force: true });
});

/** Write a license.enc exactly as storeLicense() would, for a given provider. */
function writeLicense(provider, extra = {}) {
  const payload = {
    key: 'natively_sk_test_key',
    // natively_api stores the empty-string HWID sentinel; HWID-bound providers
    // store a real fingerprint that can never match here (no native module).
    hwid: provider === 'natively_api' ? '' : 'a'.repeat(64),
    activatedAt: new Date().toISOString(),
    provider,
    ...extra,
  };
  fs.writeFileSync(LICENSE_PATH, Buffer.from(`ENC:${JSON.stringify(payload)}`, 'utf8'));
}

/**
 * Fresh manager — models a cold app launch. The instance memoizes
 * cachedPremium, so each scenario must start from a clean one or it reads the
 * previous scenario's verdict.
 *
 * BOTH handles must be cleared: getInstance() falls back to the static
 * `LicenseManager.instance` when the globalThis anchor is gone, so dropping
 * only the anchor hands back the same warm object.
 */
function freshManager() {
  delete globalThis.__nativelyLicenseManagerV1__;
  LicenseManager.instance = undefined;
  return LicenseManager.getInstance();
}

beforeEach(() => {
  fs.rmSync(LICENSE_PATH, { force: true });
});

before(() => {
  // Guard the premise: if the native module somehow loaded, every assertion
  // below is vacuous and would pass for the wrong reason.
  const mgr = freshManager();
  assert.equal(
    mgr.getHardwareId(),
    'unavailable',
    'precondition failed: native module loaded — this test must run with it ABSENT',
  );
});

describe('native module absent: natively_api (server-validated, not HWID-bound)', () => {
  test('isPremium() resolves true from a stored license', () => {
    writeLicense('natively_api', { plan: 'ultra' });
    assert.equal(freshManager().isPremium(), true);
  });

  test('getLicenseDetails() reports Pro AND carries the server plan through', () => {
    // The plan label is not cosmetic: PI's header CTA and the ad-campaign
    // targeting in useAdCampaigns.ts branch on plan === 'pro' / 'standard'.
    writeLicense('natively_api', { plan: 'ultra' });
    const details = freshManager().getLicenseDetails();
    assert.equal(details.isPremium, true);
    assert.equal(details.plan, 'ultra');
    assert.equal(details.provider, 'natively_api');
  });

  test('isPremium() and getLicenseDetails() agree — the two must never diverge', () => {
    // The original bug WAS a divergence between these two: licenseCheckPremium
    // and licenseGetDetails answered differently for the same stored license,
    // so which surface unlocked depended on which IPC channel it happened to
    // call.
    writeLicense('natively_api', { plan: 'pro' });
    const mgr = freshManager();
    assert.equal(mgr.isPremium(), mgr.getLicenseDetails().isPremium);
  });

  test('survives a restart — verdict comes from disk, not the activation cache', () => {
    // storeLicense() sets cachedPremium=true in memory. A fresh instance has no
    // cache, which is what the next app launch sees.
    writeLicense('natively_api', { plan: 'ultra' });
    const mgr = freshManager();
    assert.equal(mgr.cachedPremium ?? null, null, 'expected a cold instance');
    assert.equal(mgr.isPremium(), true);
  });
});

describe('native module absent: HWID-bound providers stay locked', () => {
  for (const provider of ['gumroad', 'dodo']) {
    test(`${provider} license resolves false — device binding is unverifiable`, () => {
      writeLicense(provider);
      const mgr = freshManager();
      assert.equal(mgr.isPremium(), false, `${provider} must not grant Pro without HWID`);
      assert.equal(mgr.getLicenseDetails().isPremium, false);
    });
  }

  test('a license with no provider field is treated as HWID-bound (fails closed)', () => {
    // Legacy files predate the provider field. Absent an explicit
    // 'natively_api' marker they must take the strict path, not the exempt one.
    writeLicense(undefined);
    assert.equal(freshManager().isPremium(), false);
  });
});

describe('native module absent: activateWithApiKey must not clobber a perpetual license', () => {
  // The skip decision happens before any network call, so these run offline.
  // The hazard: activateWithApiKey used readStoredLicense() to detect an
  // existing license, and that read returns null for an HWID-bound license it
  // cannot verify. A lifetime Gumroad license therefore looked ABSENT on a
  // machine with no native module, and saving an API key overwrote it — the
  // user's perpetual entitlement, gone, with no way to recover it locally.
  for (const provider of ['gumroad', 'dodo']) {
    test(`${provider} license on disk → skipped, and the file is left byte-identical`, async () => {
      writeLicense(provider);
      const before = fs.readFileSync(LICENSE_PATH);

      const result = await freshManager().activateWithApiKey('natively_sk_some_other_key');

      assert.equal(result.success, false);
      assert.equal(result.skipped, true, `${provider} license must be preserved, not overwritten`);
      assert.deepEqual(fs.readFileSync(LICENSE_PATH), before, 'license.enc was modified');

      // The skip MUST carry a reason here. Without a native module this stored
      // license grants nothing (readStoredLicense rejects it), so refusing the
      // API key leaves the user with Pro from neither credential. A bare
      // `skipped` made activateLicense() render the empty error as "Failed to
      // activate with API key" — blaming the one credential that is fine — and
      // made the set-natively-api-key handler show nothing at all.
      assert.ok(
        result.error,
        `${provider}: an unverifiable license must explain why Pro is inactive`,
      );
      assert.doesNotMatch(
        result.error,
        /API key/i,
        'the message must not blame the API key; the native module is the fault',
      );
    });
  }

  test('legacy license with no provider field is also protected', async () => {
    writeLicense(undefined);
    const before = fs.readFileSync(LICENSE_PATH);
    const result = await freshManager().activateWithApiKey('natively_sk_some_other_key');
    assert.equal(result.skipped, true);
    assert.deepEqual(fs.readFileSync(LICENSE_PATH), before);
  });

  test('protection applies only while ownership is UNVERIFIABLE, not to proven-foreign licenses', () => {
    // With no native module we cannot tell whether a gumroad license is this
    // user's, so we protect it. When getHardwareId IS available and the stored
    // HWID does not match, the license is positively foreign — a stale
    // license.enc restored from another machine's backup. It grants nothing
    // here, and protecting it would block the user's own API-key activation
    // with no visible error (the skip path surfaces no UI message).
    //
    // Asserted through peekStoredProvider directly: the native module is absent
    // in this process, so the mismatch branch cannot be reached end-to-end here.
    // This pins the intent so the branch is not "simplified" away later.
    const src = fs.readFileSync(
      path.resolve('premium/electron/services/LicenseManager.ts'),
      'utf8',
    );
    const body = src.slice(src.indexOf('private peekStoredProvider'));
    assert.match(
      body.slice(0, 900),
      /provider !== 'natively_api' && getHardwareId && license\.hwid !== getHardwareId\(\)/,
      'peekStoredProvider must release protection for a provably-foreign license',
    );
  });

  test('an existing natively_api license is NOT protected — reactivation must work', async () => {
    // Overwriting one API license with another is the supported reinstall /
    // key-rotation path; only perpetual licenses are sacred. This must reach the
    // network call rather than short-circuiting to skipped.
    writeLicense('natively_api', { plan: 'ultra' });
    const result = await freshManager().activateWithApiKey('natively_sk_some_other_key');
    assert.notEqual(result.skipped, true, 'API-plan reactivation must not be skipped');
  });
});

describe('native module absent: no license at all', () => {
  test('isPremium() is false and getLicenseDetails() reports no plan', () => {
    const mgr = freshManager();
    assert.equal(mgr.isPremium(), false);
    const details = mgr.getLicenseDetails();
    assert.equal(details.isPremium, false);
    assert.equal(details.plan, undefined);
  });
});
