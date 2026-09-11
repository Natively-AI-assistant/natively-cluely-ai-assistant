// Tests for scripts/lib/notary-preflight.cjs — the "is the notary reachable"
// gate that runs FIRST in the signed build.
//
// WHY IT EXISTS (2026-08-27): two signed builds spent the full ~10 minutes of
// tsc + Vite + Rust + pack + Developer-ID sign, then died on the first network
// call with NSURLErrorDomain Code=-1009 "The Internet connection appears to be
// offline… (No network route)". The retry in notary-transient.cjs is right for a
// blip, but a machine with no route just spends the retry budget reaching the
// same failure.
//
// The probe and the sleep are injected, so nothing here touches the network.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { decidePreflight, checkNotaryReachable, NOTARY_HOST } = require('../lib/notary-preflight.cjs');

describe('decidePreflight', () => {
  test('runs for a signed darwin build', () => {
    assert.equal(decidePreflight({ platform: 'darwin', env: {} }).run, true);
  });

  test('never runs on Windows — nothing there notarizes', () => {
    const d = decidePreflight({ platform: 'win32', env: {} });
    assert.equal(d.run, false);
    assert.match(d.reason, /not darwin/);
  });

  test('respects its own escape hatch, for packaging while offline', () => {
    const d = decidePreflight({ platform: 'darwin', env: { NATIVELY_SKIP_NOTARY_PREFLIGHT: '1' } });
    assert.equal(d.run, false);
  });

  test('respects NATIVELY_SKIP_NOTARIZE — a build that will not notarize must not be blocked', () => {
    // Otherwise an unreachable notary would fail a build that never intended to
    // contact it, which is strictly worse than the problem being solved.
    const d = decidePreflight({ platform: 'darwin', env: { NATIVELY_SKIP_NOTARIZE: '1' } });
    assert.equal(d.run, false);
  });
});

describe('checkNotaryReachable', () => {
  const okProbe = async () => ({ ok: true, detail: 'connected' });
  const deadProbe = async () => ({ ok: false, detail: 'ENETUNREACH' });

  test('passes on the first attempt when the host answers', async () => {
    const r = await checkNotaryReachable({ probe: okProbe, sleep: async () => {} });
    assert.deepEqual({ ok: r.ok, attempts: r.attempts }, { ok: true, attempts: 1 });
  });

  test('ONE dropped probe must not fail the build — it retries', async () => {
    // Erring toward passing is deliberate: a false "unreachable" blocks a build
    // that would have worked, which is worse than letting it proceed and fail later.
    let n = 0;
    const flaky = async () => (++n === 1 ? { ok: false, detail: 'ETIMEDOUT' } : { ok: true, detail: 'connected' });
    const r = await checkNotaryReachable({ probe: flaky, sleep: async () => {} });
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 2);
  });

  test('a genuinely dead network fails, carrying the reason', async () => {
    const r = await checkNotaryReachable({ probe: deadProbe, sleep: async () => {}, attempts: 2 });
    assert.equal(r.ok, false);
    assert.equal(r.attempts, 2);
    assert.equal(r.detail, 'ENETUNREACH');
  });

  test('it targets the host that actually failed in the -1009 error', () => {
    assert.equal(NOTARY_HOST, 'appstoreconnect.apple.com');
  });

  test('the probe receives the host/port/timeout it was configured with', async () => {
    const seen = [];
    await checkNotaryReachable({
      host: 'example.invalid', port: 8443, timeoutMs: 1234, attempts: 1,
      probe: async (args) => { seen.push(args); return { ok: true }; },
      sleep: async () => {},
    });
    assert.deepEqual(seen, [{ host: 'example.invalid', port: 8443, timeoutMs: 1234 }]);
  });

  test('a probe that resolves nothing is treated as unreachable, not as success', async () => {
    const r = await checkNotaryReachable({ probe: async () => undefined, sleep: async () => {}, attempts: 1 });
    assert.equal(r.ok, false);
  });
});

// ---------------------------------------------------------------------------
// checkCredentials — added 2026-09-08.
//
// WHY: a signed build compiled, packed and Developer-ID-signed for ~20 minutes and
// then died in afterSign with "No Keychain password item found for profile:
// natively-notary". Reachability was green the whole time; the credential was never
// looked at. These tests inject the probe, so nothing here shells out or notarizes.
// ---------------------------------------------------------------------------

const { checkCredentials, CREDENTIAL_FATAL_SIGNATURES } = require('../lib/notary-preflight.cjs');
const { DEFAULT_KEYCHAIN_PROFILE, DEFAULT_TEAM_ID, withNotaryDefaults } = require('../lib/notary-defaults.cjs');

/** Records what the probe was asked to run, so the ARGV itself can be asserted. */
function recordingProbe(result) {
  const calls = [];
  const probe = async (opts) => {
    calls.push(opts);
    return result;
  };
  return { probe, calls };
}

const OK = { ok: true, output: 'Successfully received submission history.' };
const NO_ITEM = {
  ok: false,
  output: 'Error: No Keychain password item found for profile: natively-notary\nRun \'notarytool store-credentials\'…',
};

describe('checkCredentials — keychain profile', () => {
  test('passes when notarytool loads the profile', async () => {
    const { probe } = recordingProbe(OK);
    const r = await checkCredentials({ env: { APPLE_KEYCHAIN_PROFILE: 'p' }, probe });
    assert.equal(r.ok, true);
    assert.equal(r.strategy, 'keychain-profile');
    assert.match(r.summary, /loaded and authenticated/);
  });

  test('FAILS on the exact error that cost the 2026-09-08 build', async () => {
    const { probe } = recordingProbe(NO_ITEM);
    const r = await checkCredentials({ env: {}, probe });
    assert.equal(r.ok, false);
    // The message has to carry the fix, not just the diagnosis.
    assert.match(r.remedy, /notarytool store-credentials/);
    assert.match(r.remedy, /NATIVELY_SKIP_NOTARY_PREFLIGHT=1/);
  });

  test('a credential Apple rejects is decided too — 401 / auth failures fail', async () => {
    for (const output of ['Error: Unable to authenticate. Invalid credentials.', 'HTTP status code: 401']) {
      const { probe } = recordingProbe({ ok: false, output });
      const r = await checkCredentials({ env: {}, probe });
      assert.equal(r.ok, false, `expected fatal for: ${output}`);
    }
  });

  test('FAIL-OPEN: an unrecognised failure warns and proceeds', async () => {
    // A preflight that blocks a build it merely failed to understand is worse than
    // no preflight — same discipline as notary-transient.cjs.
    const { probe } = recordingProbe({ ok: false, output: 'Error: something Apple has never said before' });
    const r = await checkCredentials({ env: {}, probe });
    assert.equal(r.ok, true);
    assert.equal(r.summary.includes('UNVERIFIED'), true);
    assert.equal(r.warnings.some((w) => /could not be verified/.test(w)), true);
  });

  test('FAIL-OPEN: a timeout warns and proceeds, naming the timeout', async () => {
    const { probe } = recordingProbe({ ok: false, timedOut: true, output: '' });
    const r = await checkCredentials({ env: {}, probe, timeoutMs: 1234 });
    assert.equal(r.ok, true);
    assert.equal(r.warnings.some((w) => /1234ms/.test(w)), true);
  });
});

describe('checkCredentials — it must check the profile the BUILD will use', () => {
  test('applies the electron-builder.signed.cjs default, which is set long after preflight runs', async () => {
    // The config assigns APPLE_KEYCHAIN_PROFILE at config-load time — minutes after
    // this runs. Reading only the env here would check nothing at all.
    const { probe, calls } = recordingProbe(OK);
    await checkCredentials({ env: {}, probe });
    assert.deepEqual(calls[0].args, ['notarytool', 'history', '--keychain-profile', DEFAULT_KEYCHAIN_PROFILE]);
  });

  test('an explicit profile overrides the default', async () => {
    const { probe, calls } = recordingProbe(OK);
    await checkCredentials({ env: { APPLE_KEYCHAIN_PROFILE: 'other-profile' }, probe });
    assert.equal(calls[0].args[3], 'other-profile');
  });

  test('APPLE_KEYCHAIN is forwarded as its own argv entry', async () => {
    const { probe, calls } = recordingProbe(OK);
    await checkCredentials({ env: { APPLE_KEYCHAIN_PROFILE: 'p', APPLE_KEYCHAIN: '/tmp/my keychain.db' }, probe });
    assert.deepEqual(calls[0].args.slice(4), ['--keychain', '/tmp/my keychain.db']);
  });

  test('argv is an ARRAY — a profile name with spaces stays ONE argument', async () => {
    // CLAUDE.md: pass command arguments as arrays, no shell interpolation.
    const { probe, calls } = recordingProbe(OK);
    await checkCredentials({ env: { APPLE_KEYCHAIN_PROFILE: 'my notary profile' }, probe });
    assert.equal(Array.isArray(calls[0].args), true);
    assert.equal(calls[0].args[3], 'my notary profile');
  });

  test('asks notarytool, NEVER the `security` CLI', async () => {
    // 2026-09-08: with the profile demonstrably working, `security find-generic-password`
    // (by label, account and service) and a full `security dump-keychain` all found
    // NOTHING — notarytool keeps profiles in the data-protection keychain, invisible to
    // `security`. A check built on it would hard-fail every working build.
    const { probe, calls } = recordingProbe(OK);
    await checkCredentials({ env: {}, probe });
    assert.equal(calls[0].args[0], 'notarytool');
    assert.equal(calls.some((c) => c.args.join(' ').includes('security')), false);
  });

  test('uses the REAL resolver from scripts/notarize.js, not a copy', async () => {
    // No `resolve` injected: this exercises the exact precedence the afterSign hook
    // obeys, so the two cannot drift into disagreeing about the strategy.
    const { probe, calls } = recordingProbe(OK);
    const r = await checkCredentials({ env: { APPLE_KEYCHAIN_PROFILE: 'from-real-resolver' }, probe });
    assert.equal(r.strategy, 'keychain-profile');
    assert.equal(calls[0].args[3], 'from-real-resolver');
  });
});

describe('checkCredentials — the other strategies, honestly labelled', () => {
  test('api-key is a FILE check and says so — Apple is never contacted', async () => {
    const { probe, calls } = recordingProbe(OK);
    const r = await checkCredentials({
      env: { APPLE_API_KEY: process.argv[1], APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I' },
      probe,
    });
    assert.equal(r.ok, true);
    assert.equal(r.strategy, 'api-key');
    assert.match(r.summary, /file check only/);
    assert.equal(calls.length, 0, 'must not spend a network round trip on a file-existence check');
  });

  test('a dead .p8 path falls through to the keychain profile, exactly as the build does', async () => {
    const { probe, calls } = recordingProbe(OK);
    const r = await checkCredentials({
      env: { APPLE_API_KEY: '/definitely/not/here.p8', APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I' },
      probe,
    });
    assert.equal(r.strategy, 'keychain-profile');
    assert.equal(calls[0].args[3], DEFAULT_KEYCHAIN_PROFILE);
  });

  test('apple-id cannot be validated offline, and the summary must not pretend otherwise', async () => {
    const { probe, calls } = recordingProbe(OK);
    const r = await checkCredentials({
      env: { APPLE_ID: 'a@b.c', APPLE_APP_SPECIFIC_PASSWORD: 'x', APPLE_TEAM_ID: 'T' },
      probe,
    });
    assert.equal(r.strategy, 'apple-id');
    assert.match(r.summary, /NOT validated/);
    assert.equal(calls.length, 0, 'a preflight must not send an app-specific password to Apple');
  });

  test('warns about the api-key issuer split between the .app and DMG paths', async () => {
    // scripts/notarize.js selects api-key on key+id; scripts/afterAllArtifactBuild.cjs
    // requires key+id+ISSUER. Issuer-less, the .app notarizes via api-key and the DMG
    // silently falls back to the keychain profile.
    const { probe } = recordingProbe(OK);
    const r = await checkCredentials({ env: { APPLE_API_KEY: process.argv[1], APPLE_API_KEY_ID: 'K' }, probe });
    assert.equal(r.warnings.some((w) => /APPLE_API_ISSUER/.test(w)), true);
  });
});

describe('notary-defaults', () => {
  test('withNotaryDefaults does not mutate the caller env', () => {
    const env = {};
    const out = withNotaryDefaults(env);
    assert.deepEqual(env, {});
    assert.equal(out.APPLE_KEYCHAIN_PROFILE, DEFAULT_KEYCHAIN_PROFILE);
    assert.equal(out.APPLE_TEAM_ID, DEFAULT_TEAM_ID);
  });

  test('an explicit env value always wins', () => {
    const out = withNotaryDefaults({ APPLE_KEYCHAIN_PROFILE: 'mine', APPLE_TEAM_ID: 'T' });
    assert.equal(out.APPLE_KEYCHAIN_PROFILE, 'mine');
    assert.equal(out.APPLE_TEAM_ID, 'T');
  });

  test('electron-builder.signed.cjs really does select these values', () => {
    // Loaded in a child process: the config mutates process.env by design, and this
    // is the assertion that the preflight validates the profile the build will use.
    const out = execFileSync(
      process.execPath,
      ['-e', "require('./electron-builder.signed.cjs');console.log(process.env.APPLE_KEYCHAIN_PROFILE+' '+process.env.APPLE_TEAM_ID)"],
      { cwd: new URL('../..', import.meta.url).pathname, encoding: 'utf8' }
    ).trim();
    assert.equal(out, `${DEFAULT_KEYCHAIN_PROFILE} ${DEFAULT_TEAM_ID}`);
  });

  test('the fatal list stays small and decided', () => {
    // Growing this list trades a 20-minute wasted build for the risk of blocking a
    // good one. Anything not provably self-unhealable belongs in the warn path.
    assert.equal(CREDENTIAL_FATAL_SIGNATURES.length <= 4, true);
    assert.equal(CREDENTIAL_FATAL_SIGNATURES.some((re) => re.test('No Keychain password item found for profile: x')), true);
  });
});
