#!/usr/bin/env node
/**
 * preflight-notary.cjs — first step of `npm run app:build:signed`.
 *
 * A signed build spends ~10 minutes compiling (tsc, Vite, Rust), packing and
 * Developer-ID signing before it ever talks to Apple. When the machine has no
 * network route, all of that is wasted and the build dies at the notary call.
 * This fails in about a second instead.
 *
 * Wired ONLY into the signed chain, so its presence already means "this build
 * will notarize" — no credential guessing is needed (and would be wrong anyway:
 * electron-builder.signed.cjs defaults APPLE_KEYCHAIN_PROFILE at config-load
 * time, long after this runs).
 *
 * Escape hatch: NATIVELY_SKIP_NOTARY_PREFLIGHT=1 (or NATIVELY_SKIP_NOTARIZE=1).
 * No-op on non-darwin.
 */

const { decidePreflight, checkNotaryReachable, NOTARY_HOST } = require('./lib/notary-preflight.cjs');

(async () => {
  const decision = decidePreflight({ platform: process.platform, env: process.env });
  if (!decision.run) {
    console.log(`[preflight-notary] ${decision.reason}`);
    return;
  }

  const result = await checkNotaryReachable();
  if (result.ok) {
    console.log(`[preflight-notary] ${NOTARY_HOST} reachable ✅ — proceeding.`);
    return;
  }

  console.error(
    `[preflight-notary] FATAL: cannot reach ${NOTARY_HOST}:443 after ${result.attempts} attempt(s) ` +
      `(${result.detail}).\n` +
      '  Notarization would fail ~10 minutes from now, after compiling, packing and signing —\n' +
      '  so this stops before any of that work is spent.\n' +
      '  Fix your connection and re-run, or set NATIVELY_SKIP_NOTARY_PREFLIGHT=1 to build anyway.'
  );
  process.exit(1);
})();
