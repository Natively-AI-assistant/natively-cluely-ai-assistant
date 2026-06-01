/**
 * electron-builder.signed.cjs — PRODUCTION (Developer ID + notarization) build config.
 *
 * Used ONLY by `npm run app:build:signed` / `npm run dist:signed` via
 * `electron-builder --config electron-builder.signed.cjs`.
 *
 * WHY A SEPARATE FILE (not editing package.json `build`):
 *   The default `package.json` `build.mac` keeps `identity: null`, which makes
 *   electron-builder SKIP application signing on the default/dev path (only the
 *   ad-hoc afterPack signer runs). Removing `identity` from package.json would
 *   trigger electron-builder's arm64 "fall back to ad-hoc" path and double-sign
 *   the dev build. Keeping production signing in this opt-in file means the default
 *   build is byte-for-byte unchanged, and real signing/notarization is explicit.
 *
 * SIGNING + NOTARIZATION (electron-builder built-in, electron-builder 26):
 *   - identity        : Developer ID Application (auto-discovered, or NATIVELY_SIGN_IDENTITY/CSC_NAME)
 *   - hardenedRuntime : true  (REQUIRED for notarization)
 *   - entitlements    : build/entitlements.mac.plist (top-level)
 *   - entitlementsInherit : build/entitlements.mac.inherit.plist (helpers)
 *   - notarize: true  → electron-builder runs notarytool (@electron/notarize) and staples.
 *                       It deep-signs the app, frameworks, helpers, and native .node/.dylib
 *                       inside-out automatically, then submits + staples.
 *
 * DMG: electron-builder's own DMG-creation corrupts the embedded app signature
 *   (Apple notary log: "The signature of the binary is invalid" on the inner
 *   Natively executable). So we build ONLY the `zip` target with electron-builder
 *   (zip preserves signatures + is the auto-updater artifact), and the
 *   afterAllArtifactBuild hook rebuilds the styled DMGs from the pristine signed
 *   .app via create-dmg, then notarizes + staples them. See scripts/afterAllArtifactBuild.cjs.
 *
 *   Notarization credentials use the macOS keychain profile `natively-notary`
 *   (created via `xcrun notarytool store-credentials`). No plaintext Apple password
 *   lives in source — the secret is in the keychain; only the profile NAME and the
 *   (non-secret) Team ID are referenced here. electron-builder's getNotarizeOptions
 *   reads APPLE_KEYCHAIN_PROFILE for the keychain strategy.
 *
 * See docs/engineering/MACOS_SIGNING_NOTARIZATION_CHECKLIST.md and apple-signing-report.md.
 */

// Signal so the ad-hoc afterPack signer (scripts/ad-hoc-sign.js) STANDS DOWN — we want
// electron-builder's real Developer ID signature, not an ad-hoc one over the top.
process.env.NATIVELY_PRODUCTION_SIGN = '1';

// Default to the user's stored notarytool keychain profile + Team ID. These are NOT
// secrets (the profile name is a label; the Team ID is embedded in every signed binary).
// The actual Apple credential lives only in the macOS keychain. Both are overridable.
process.env.APPLE_KEYCHAIN_PROFILE = process.env.APPLE_KEYCHAIN_PROFILE || 'natively-notary';
process.env.APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || 'BJM29W3UQ6';

const base = require('./package.json').build;

// Identity resolution: explicit env override → else auto-discover the single
// "Developer ID Application" cert from the login keychain (undefined = auto-discover).
const signIdentity =
  process.env.NATIVELY_SIGN_IDENTITY || process.env.CSC_NAME || undefined;

module.exports = {
  ...base,
  // Bake a runtime flag into the packaged app's package.json so the main process
  // knows it is a real Developer ID-signed build and may perform a true in-place
  // auto-install + relaunch (autoUpdater.quitAndInstall). The default/dev build
  // omits this, so isSignedBuild()/canAutoInstall() in electron/main.ts return
  // false there and the manual download-fallback path is used instead.
  extraMetadata: {
    ...(base.extraMetadata || {}),
    nativelySigned: true,
  },
  // Rebuild styled DMGs from the pristine signed .app (create-dmg), then notarize +
  // staple them, then patch latest*.yml dmg hashes and assert the updater ZIP manifest.
  // (electron-builder's own DMG creation corrupts the embedded app signature — see header.)
  afterAllArtifactBuild: require('./scripts/afterAllArtifactBuild.cjs'),
  mac: {
    ...base.mac,
    identity: signIdentity,                 // undefined => auto-discover Developer ID Application
    hardenedRuntime: true,                  // REQUIRED for notarization
    gatekeeperAssess: false,                // don't run spctl assess mid-build (fails pre-staple)
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    notarize: true,                         // built-in notarytool + staple of the .app, via APPLE_KEYCHAIN_PROFILE
    // Build ONLY zip with electron-builder (preserves signatures + is the updater
    // artifact); the DMGs are produced cleanly by the afterAllArtifactBuild hook.
    target: [
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
  },
};
