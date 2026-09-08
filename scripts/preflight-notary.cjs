#!/usr/bin/env node
/**
 * preflight-notary.cjs — first step of `npm run app:build:signed`.
 *
 * A signed build spends ~10 minutes compiling (tsc, Vite, Rust), packing and
 * Developer-ID signing before it ever talks to Apple. Two classes of failure are
 * knowable in about a second yet, left unchecked, surface only at the end:
 *
 *   1. NO NETWORK ROUTE (2026-08-27) — the notary host is unreachable.
 *   2. NO USABLE CREDENTIAL (2026-09-08) — a build got all the way through
 *      Developer-ID signing and then died in afterSign with
 *      "No Keychain password item found for profile: natively-notary".
 *
 * Both now fail here instead, in seconds, with the fix in the message.
 *
 * Wired ONLY into the signed chain, so its presence already means "this build
 * will notarize". The credential check resolves the strategy through
 * scripts/notarize.js's OWN resolveCredentials — the function the build obeys —
 * with the electron-builder.signed.cjs defaults applied, because that config is
 * loaded minutes after this runs. Nothing here is a second copy of that logic.
 *
 * FAIL-OPEN: only a DECIDED-BAD credential (see CREDENTIAL_FATAL_SIGNATURES)
 * stops the build. A timeout, a blip, or any unrecognised Apple error warns and
 * proceeds — a preflight that blocks a working build is worse than no preflight.
 *
 * Escape hatch: NATIVELY_SKIP_NOTARY_PREFLIGHT=1 (or NATIVELY_SKIP_NOTARIZE=1).
 * No-op on non-darwin: nothing outside macOS notarizes, and `xcrun` is macOS-only,
 * so neither check ever runs on Windows.
 */

const {
  decidePreflight,
  checkNotaryReachable,
  checkCredentials,
  NOTARY_HOST,
} = require('./lib/notary-preflight.cjs');

(async () => {
  const decision = decidePreflight({ platform: process.platform, env: process.env });
  if (!decision.run) {
    console.log(`[preflight-notary] ${decision.reason}`);
    return;
  }

  const reachable = await checkNotaryReachable();
  if (!reachable.ok) {
    console.error(
      `[preflight-notary] FATAL: cannot reach ${NOTARY_HOST}:443 after ${reachable.attempts} attempt(s) ` +
        `(${reachable.detail}).\n` +
        '  Notarization would fail ~10 minutes from now, after compiling, packing and signing —\n' +
        '  so this stops before any of that work is spent.\n' +
        '  Fix your connection and re-run, or set NATIVELY_SKIP_NOTARY_PREFLIGHT=1 to build anyway.'
    );
    process.exit(1);
  }
  console.log(`[preflight-notary] ${NOTARY_HOST} reachable ✅`);

  const creds = await checkCredentials();
  for (const warning of creds.warnings) console.warn(`[preflight-notary] WARNING: ${warning}`);

  if (!creds.ok) {
    console.error(
      `[preflight-notary] FATAL: ${creds.summary}\n` +
        '  This is the credential the afterSign hook will use, so notarization would fail ~20 minutes\n' +
        '  from now — after compiling, packing and Developer-ID signing have all succeeded.\n' +
        (creds.remedy || '')
    );
    process.exit(1);
  }

  // Name the check that ran: the strategies are not equally proven. api-key is a
  // file-existence check, apple-id is presence only, and only keychain-profile is
  // validated against Apple. A green line must not overstate which one you got.
  console.log(`[preflight-notary] credentials [${creds.strategy}] ✅ — ${creds.summary}. Proceeding.`);
})();
