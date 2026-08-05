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
import { fileURLToPath } from 'node:url';

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-license-'));
process.env.NATIVELY_TEST_USERDATA = USER_DATA;

const LICENSE_PATH = path.join(USER_DATA, 'license.enc');

// Redirect require('electron') to the stub before loading the bundle. Resolved
// relative to THIS file, not process.cwd() — the runner's working directory is
// not something a test may assume.
const stubPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '__electron_license_stub.mjs');
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

/** A /v1/pro/verify response granting Pro — the only shape that reaches storeLicense(). */
const PRO_VERIFY_OK = { status: 200, body: { ok: true, has_pro: true, plan: 'ultra' } };

/**
 * Run `fn` with globalThis.fetch answering /v1/pro/verify locally.
 *
 * A unit test must never call api.natively.software. Outside this helper fetch
 * is replaced by a throwing stub, so any path that reaches the network fails
 * loudly here instead of depending on a live server (and on the tester being
 * online) to reach its verdict.
 */
async function withStubbedFetch({ status, body }, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({ status, json: async () => body });
  try {
    return await fn();
  } finally {
    globalThis.fetch = previous;
  }
}

const originalFetch = globalThis.fetch;
beforeEach(() => {
  fs.rmSync(LICENSE_PATH, { force: true });
  fs.rmSync(LICENSE_PATH + '.tmp', { force: true });
  globalThis.fetch = async (url) => {
    throw new Error(`unexpected network call to ${url} — stub it with withStubbedFetch()`);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
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
    // Both read the same unmodified file from a cold instance, so this pins the
    // agreement that the original bug broke — licenseCheckPremium and
    // licenseGetDetails answering differently for one stored license.
    writeLicense('natively_api', { plan: 'pro' });
    const mgr = freshManager();
    assert.equal(mgr.isPremium(), true);
    assert.equal(mgr.getLicenseDetails().isPremium, true);
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

  // The proven-foreign case — where protection must be RELEASED — needs
  // getHardwareId available, which cannot happen in this process. It is covered
  // behaviourally in LicenseNativeModulePresent.test.mjs. (It used to be
  // approximated here by regex-matching LicenseManager.ts; that assertion could
  // not fail for the right reason and is gone.)

  test('an existing natively_api license is NOT protected — reactivation must work', async () => {
    // Overwriting one API license with another is the supported reinstall /
    // key-rotation path; only perpetual licenses are sacred. This must reach the
    // network call rather than short-circuiting to skipped.
    writeLicense('natively_api', { plan: 'ultra' });
    const result = await withStubbedFetch(PRO_VERIFY_OK, () =>
      freshManager().activateWithApiKey('natively_sk_some_other_key'),
    );
    assert.notEqual(result.skipped, true, 'API-plan reactivation must not be skipped');
    assert.equal(result.success, true);
  });
});

describe('native module absent: a license.enc that cannot be decrypted', () => {
  // Overwrite protection is decrypt-based, so a file it cannot read looks exactly
  // like free space. Refusing on it would be worse than letting the write
  // through: a genuinely corrupt file would lock the user out of activating at
  // all, with no local way to clear it.
  //
  // An earlier attempt kept a copy of the file aside first. That is gone — it
  // made things worse, not better (decryptable credentials left behind that a
  // revocation never cleaned up, and an eviction rule that discarded the very
  // license it existed to protect). The one genuinely irreplaceable thing in a
  // replaced license is a Dodo activation slot, and it is NOT rescued: a release
  // on swap was built and removed because the stored instanceId is not proven to
  // belong to this device, so freeing it could deactivate another machine.
  // Re-activating your own key therefore still strands the seat. That is an open
  // bug, not a solved one — LicenseNativeModulePresent asserts the current
  // behaviour ('replacing a license does NOT touch the server activation seat').
  const UNDECRYPTABLE = Buffer.from('v10\x00\x01ciphertext-from-a-key-we-no-longer-have', 'utf8');

  test('activation proceeds — an unreadable file must not lock the user out', async () => {
    fs.writeFileSync(LICENSE_PATH, UNDECRYPTABLE);
    const result = await withStubbedFetch(PRO_VERIFY_OK, () =>
      freshManager().activateWithApiKey('natively_sk_my_key'),
    );
    assert.equal(result.success, true, 'a file nobody can read must not block activation');
    assert.notEqual(result.skipped, true);
  });

  test('no stray copies are left in userData', async () => {
    // The activation replaces license.enc and writes nothing else. Copies of an
    // encrypted license are restorable into a working entitlement and survive
    // every teardown path, so the directory must stay clean.
    fs.writeFileSync(LICENSE_PATH, UNDECRYPTABLE);

    await withStubbedFetch(PRO_VERIFY_OK, () =>
      freshManager().activateWithApiKey('natively_sk_my_key'),
    );

    assert.deepEqual(
      fs.readdirSync(USER_DATA).sort(),
      ['license.enc'],
      'activation left extra files behind',
    );
  });

  test('protection is enforced at the write, after the network round trip', async () => {
    // The overwrite decision used to be taken before an up-to-8s call to
    // /v1/pro/verify, and it rests on whether license.enc decrypts — not a stable
    // property. Chromium exposes a transient "temporarily unavailable" decrypt
    // state that the synchronous safeStorage API cannot report, so a perpetual
    // license can be unreadable when the decision is made and readable by the time
    // the write happens. storeLicense() runs the guard itself, so there is no
    // window to lose. The flip is staged inside the fetch stub, which runs at
    // exactly that point.
    fs.writeFileSync(LICENSE_PATH, UNDECRYPTABLE);

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      writeLicense('gumroad');
      return { status: 200, json: async () => PRO_VERIFY_OK.body };
    };

    let result;
    try {
      result = await freshManager().activateWithApiKey('natively_sk_my_key');
    } finally {
      globalThis.fetch = previousFetch;
    }

    assert.equal(
      result.skipped,
      true,
      'a perpetual license that became readable mid-activation must still be protected',
    );
    assert.equal(
      JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8').replace(/^ENC:/, '')).provider,
      'gumroad',
      'the perpetual license was overwritten by the in-flight activation',
    );
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
