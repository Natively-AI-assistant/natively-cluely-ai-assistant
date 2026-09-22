'use strict';
/**
 * notary-defaults.cjs — the notarization identity defaults, in ONE place.
 *
 * WHY THIS FILE EXISTS: electron-builder.signed.cjs applies these defaults at
 * CONFIG-LOAD time, which is minutes AFTER scripts/preflight-notary.cjs runs. So
 * at preflight time `process.env.APPLE_KEYCHAIN_PROFILE` is still empty, and a
 * preflight that read only the env would either skip the check or validate the
 * wrong profile name — and then report green for a build that is about to die on
 * a credential the preflight never looked at. Both consumers import from here so
 * the name the preflight validates is provably the name the build will use.
 *
 * Neither value is a secret: the profile name is a keychain label and the Team ID
 * is embedded in every signed binary. The Apple credential itself lives only in
 * the keychain (see `xcrun notarytool store-credentials`).
 */

/** notarytool keychain profile used by the local signed build. */
const DEFAULT_KEYCHAIN_PROFILE = 'natively-notary';

/** Apple Developer Team ID (matches the Developer ID Application certificate). */
const DEFAULT_TEAM_ID = 'BJM29W3UQ6';

/**
 * Apply the same defaults electron-builder.signed.cjs applies, without mutating
 * the caller's env. Lets the preflight resolve credentials exactly as the build
 * will, before the config that sets them has been loaded.
 * @param {Record<string,string|undefined>} env
 * @returns {Record<string,string|undefined>}
 */
function withNotaryDefaults(env) {
  return {
    ...env,
    APPLE_KEYCHAIN_PROFILE: env.APPLE_KEYCHAIN_PROFILE || DEFAULT_KEYCHAIN_PROFILE,
    APPLE_TEAM_ID: env.APPLE_TEAM_ID || DEFAULT_TEAM_ID,
  };
}

module.exports = { DEFAULT_KEYCHAIN_PROFILE, DEFAULT_TEAM_ID, withNotaryDefaults };
