'use strict';
/**
 * notary-preflight.cjs — fail a signed build in seconds when the notary service
 * is unreachable, instead of ~10 minutes in.
 *
 * WHY (2026-08-27): two signed builds in a row spent the full tsc + Vite + Rust +
 * pack + Developer-ID-sign sequence and then died at the FIRST network call:
 *
 *   Error Domain=NSURLErrorDomain Code=-1009 "The Internet connection appears to
 *   be offline." … _NSURLErrorNWPathKey=unsatisfied (No network route)
 *
 * scripts/lib/notary-transient.cjs now retries that, which is right for a blip —
 * but retrying a machine with no route just spends the retry budget to reach the
 * same failure. Neither helps if the connection was never there. Checking first
 * costs about a second and turns a ten-minute dead end into an immediate answer.
 *
 * A false "unreachable" would block a working build, so the check errs toward
 * passing: multiple attempts, and any successful connection is enough.
 *
 * CREDENTIALS (2026-09-08): reachability alone was not enough. A signed build ran
 * the full compile + pack + Developer-ID sign and then died in afterSign with
 *
 *   Error: No Keychain password item found for profile: natively-notary
 *
 * — a decided credential failure, knowable in about a second, discovered ~20
 * minutes in. checkCredentials() below now resolves the very strategy the build
 * will use (via scripts/notarize.js's own resolveCredentials — not a copy) and
 * proves the credential loads. It does NOT predict Apple-side verdicts: everything
 * except a recognised, decided credential error warns and proceeds.
 */

const net = require('node:net');
const { execFile } = require('node:child_process');
const { withNotaryDefaults } = require('./notary-defaults.cjs');

/** notarytool's control plane — the host in the -1009 failure above. */
const NOTARY_HOST = 'appstoreconnect.apple.com';
const NOTARY_PORT = 443;

/**
 * Should the preflight run at all?
 * @param {{platform: string, env: Record<string,string|undefined>}} ctx
 * @returns {{run: boolean, reason: string}}
 */
function decidePreflight({ platform, env }) {
  if (env.NATIVELY_SKIP_NOTARY_PREFLIGHT === '1') {
    return { run: false, reason: 'NATIVELY_SKIP_NOTARY_PREFLIGHT=1 — skipping (offline packaging).' };
  }
  if (platform !== 'darwin') {
    return { run: false, reason: `platform is ${platform}, not darwin — nothing here notarizes.` };
  }
  if (env.NATIVELY_SKIP_NOTARIZE === '1') {
    // Honour the same escape hatch scripts/notarize.js uses; a build that will
    // not notarize must not be blocked by the notary being unreachable.
    return { run: false, reason: 'NATIVELY_SKIP_NOTARIZE=1 — this build will not notarize.' };
  }
  return { run: true, reason: 'signed darwin build — notarization will need the network.' };
}

/** Default connector: resolve + TCP-connect, resolving true/false, never throwing. */
function tcpProbe({ host, port, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* best effort */ }
      resolve({ ok, detail });
    };
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true, 'connected'));
    socket.once('timeout', () => done(false, `no response within ${timeoutMs}ms`));
    socket.once('error', (err) => done(false, err && err.code ? err.code : String(err && err.message)));
  });
}

/**
 * Is the notary host reachable? Retries before declaring failure, because a
 * single dropped probe must not block an otherwise fine build.
 *
 * @param {object} [opts]
 * @param {string} [opts.host]
 * @param {number} [opts.port]
 * @param {number} [opts.timeoutMs=6000]
 * @param {number} [opts.attempts=2]
 * @param {Function} [opts.probe]  injectable ({host,port,timeoutMs}) => Promise<{ok,detail}>
 * @param {Function} [opts.sleep]  injectable (ms) => Promise<void>
 * @returns {Promise<{ok: boolean, attempts: number, detail: string}>}
 */
async function checkNotaryReachable(opts = {}) {
  const {
    host = NOTARY_HOST,
    port = NOTARY_PORT,
    timeoutMs = 6000,
    attempts = 2,
    probe = tcpProbe,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  let detail = 'no attempt made';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await probe({ host, port, timeoutMs });
    if (result && result.ok) return { ok: true, attempts: attempt, detail: result.detail || 'connected' };
    detail = (result && result.detail) || 'unknown';
    if (attempt < attempts) await sleep(1000);
  }
  return { ok: false, attempts, detail };
}

/* ------------------------------------------------------------------ *
 * Credential preflight
 * ------------------------------------------------------------------ */

/**
 * Messages that mean the credential is DECIDED-BAD: it cannot self-heal, so the
 * build 20 minutes from now will fail exactly the same way. Only these fail the
 * preflight. Anything else — a timeout, a network blip, an unrecognised Apple
 * error — warns and proceeds, matching the fail-open discipline in
 * notary-transient.cjs. Every fatal message names the escape hatch, so even a
 * signature that turns out to be wrong is never a dead end.
 */
const CREDENTIAL_FATAL_SIGNATURES = [
  // The exact failure this check was built for.
  /No Keychain password item found for profile/i,
  // A stored credential Apple itself rejects: re-running the build cannot fix it.
  /Unable to authenticate/i,
  /HTTP status code: 401/i,
];

/**
 * Ask notarytool itself whether a keychain profile loads.
 *
 * WHY NOT `security find-generic-password`: it CANNOT SEE these items. On
 * 2026-09-08, with `xcrun notarytool history --keychain-profile natively-notary`
 * succeeding against real submission history, all of `security find-generic-password`
 * by label, by account, by service, and a full `security dump-keychain` found
 * nothing — notarytool stores profiles in the data-protection keychain, which the
 * `security` CLI does not enumerate. A check built on `security` would hard-fail
 * every working build on this machine. Ask the tool that owns the credential.
 *
 * `history` is the cheapest command that loads credentials: the "No Keychain
 * password item" error is raised while resolving the profile, before any work.
 * Args are an array — never a shell string — because a profile name may contain
 * spaces (CLAUDE.md: no shell interpolation).
 */
function xcrunProbe({ args, timeoutMs }) {
  return new Promise((resolve) => {
    execFile('xcrun', args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      if (!err) return resolve({ ok: true, output });
      resolve({
        ok: false,
        timedOut: err.killed === true || err.signal === 'SIGTERM',
        output: output || (err && err.message ? err.message : String(err)),
      });
    });
  });
}

/** First non-empty line of a tool's output — enough to name a failure without dumping it. */
function firstLine(text) {
  return String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || 'no output';
}

/**
 * Will this build be able to load its notarization credential?
 *
 * @param {object} [opts]
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {Function} [opts.resolve]  (env) => {strategy, creds}|null — defaults to the
 *                                   REAL resolver in scripts/notarize.js.
 * @param {Function} [opts.probe]    injectable ({args,timeoutMs}) => Promise<{ok,output,timedOut}>
 * @param {number}   [opts.timeoutMs=30000]
 * @returns {Promise<{ok: boolean, strategy: string, summary: string, warnings: string[], remedy?: string}>}
 */
async function checkCredentials(opts = {}) {
  const {
    env = process.env,
    resolve = require('../notarize.js').resolveCredentials,
    probe = xcrunProbe,
    timeoutMs = 30000,
  } = opts;

  // electron-builder.signed.cjs applies these at config-load time, long after this
  // runs — so apply them here to resolve the strategy the build will actually pick.
  const effective = withNotaryDefaults(env);
  const warnings = [];

  // KNOWN DRIFT (not fixed here, deliberately): scripts/notarize.js selects the
  // api-key strategy on key+id alone (the issuer must be OMITTED for Individual
  // keys), while scripts/afterAllArtifactBuild.cjs requires key+id+ISSUER. With an
  // issuer-less key the .app notarizes via api-key and the DMG step silently falls
  // back to the keychain profile. Warn — whether notarytool's CLI accepts --key
  // without --issuer is unverified, so changing the DMG path is not a preflight's
  // business.
  if (effective.APPLE_API_KEY && effective.APPLE_API_KEY_ID && !effective.APPLE_API_ISSUER) {
    warnings.push(
      'APPLE_API_KEY/APPLE_API_KEY_ID are set without APPLE_API_ISSUER. The .app may notarize via the ' +
        'api-key strategy while the DMG step (scripts/afterAllArtifactBuild.cjs, which requires an issuer) ' +
        'falls back to the keychain profile. Set APPLE_API_ISSUER for a team key so both paths agree.'
    );
  }

  const resolved = resolve(effective);
  if (!resolved) {
    // Unreachable with the defaults applied (a keychain profile always resolves),
    // so treat it as a surprise to report, not a reason to block a build.
    warnings.push('No credential strategy resolved even with defaults applied — notarization will be skipped.');
    return { ok: true, strategy: 'none', summary: 'no credential strategy resolved', warnings };
  }

  if (resolved.strategy === 'api-key') {
    // resolveCredentials only returns api-key when the .p8 exists, so reaching here
    // IS the check. Filesystem only — say so, rather than implying Apple agreed.
    return {
      ok: true,
      strategy: 'api-key',
      summary: `App Store Connect key file exists: ${effective.APPLE_API_KEY} (file check only — Apple not contacted)`,
      warnings,
    };
  }

  if (resolved.strategy === 'apple-id') {
    // An app-specific password can only be validated by sending it to Apple, which
    // a preflight has no business doing. Presence only — and the message says so.
    return {
      ok: true,
      strategy: 'apple-id',
      summary: `APPLE_ID + app-specific password + team ${effective.APPLE_TEAM_ID} present (NOT validated)`,
      warnings,
    };
  }

  const profile = resolved.creds.keychainProfile;
  const args = ['notarytool', 'history', '--keychain-profile', profile];
  if (resolved.creds.keychain) args.push('--keychain', resolved.creds.keychain);

  const result = await probe({ args, timeoutMs });
  if (result && result.ok) {
    return {
      ok: true,
      strategy: 'keychain-profile',
      summary: `keychain profile "${profile}" loaded and authenticated with Apple`,
      warnings,
    };
  }

  const output = (result && result.output) || 'no output';
  const fatal = CREDENTIAL_FATAL_SIGNATURES.some((re) => re.test(output));
  if (!fatal) {
    warnings.push(
      `keychain profile "${profile}" could not be verified (${result && result.timedOut ? `no answer within ${timeoutMs}ms` : firstLine(output)}) — ` +
        'proceeding anyway; an unrecognised failure must not block a build that may be fine.'
    );
    return { ok: true, strategy: 'keychain-profile', summary: `keychain profile "${profile}" UNVERIFIED`, warnings };
  }

  return {
    ok: false,
    strategy: 'keychain-profile',
    summary: `keychain profile "${profile}" cannot be used: ${firstLine(output)}`,
    warnings,
    remedy:
      `  Recreate it (the app-specific password comes from appleid.apple.com, NOT your Apple ID password):\n` +
      `    xcrun notarytool store-credentials ${profile} --apple-id <your-apple-id> --team-id ${effective.APPLE_TEAM_ID}\n` +
      `  Or use an App Store Connect key: APPLE_API_KEY (path to the .p8) + APPLE_API_KEY_ID + APPLE_API_ISSUER.\n` +
      `  To build anyway: NATIVELY_SKIP_NOTARY_PREFLIGHT=1 (or NATIVELY_SKIP_NOTARIZE=1 to skip notarizing entirely).`,
  };
}

module.exports = {
  NOTARY_HOST,
  NOTARY_PORT,
  decidePreflight,
  checkNotaryReachable,
  tcpProbe,
  checkCredentials,
  xcrunProbe,
  CREDENTIAL_FATAL_SIGNATURES,
};
