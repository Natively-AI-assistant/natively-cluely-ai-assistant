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
// The literals live in scripts/lib/notary-defaults.cjs because these are applied at
// CONFIG-LOAD time — minutes after scripts/preflight-notary.cjs runs. The preflight
// has to validate the very profile this line selects, so both read one source.
const { DEFAULT_KEYCHAIN_PROFILE, DEFAULT_TEAM_ID } = require('./scripts/lib/notary-defaults.cjs');
process.env.APPLE_KEYCHAIN_PROFILE = process.env.APPLE_KEYCHAIN_PROFILE || DEFAULT_KEYCHAIN_PROFILE;
process.env.APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || DEFAULT_TEAM_ID;

const base = require('./package.json').build;

// Identity resolution: explicit env override → else auto-discover the single
// "Developer ID Application" cert from the login keychain (undefined = auto-discover).
const signIdentity =
  process.env.NATIVELY_SIGN_IDENTITY || process.env.CSC_NAME || undefined;

module.exports = {
  ...base,
  // A signed release without the calendar client secret ships a calendar that
  // can never connect (scripts/lib/calendar-client-secret.cjs). Checked at pack
  // time rather than when this file loads, so the notary preflight and tests
  // that load this config never need the secret. CI's release job calls
  // electron-builder directly, so scripts/package-app.js's check does not
  // cover it; this does.
  beforePack: async (context) => {
    require('./scripts/lib/calendar-client-secret.cjs').assertCalendarSecretBaked(__dirname);
    return require(base.beforePack)(context);
  },
  // Bake a runtime flag into the packaged app's package.json so the main process
  // knows it is a real Developer ID-signed build and may perform a true in-place
  // auto-install + relaunch (autoUpdater.quitAndInstall). The default/dev build
  // omits this, so isSignedBuild()/canAutoInstall() in electron/main.ts return
  // false there and the manual download-fallback path is used instead.
  extraMetadata: {
    ...(base.extraMetadata || {}),
    nativelySigned: true,
    // NOTE: `keychainGroupEntitled` used to be baked here to prove the
    // keychain-access-groups entitlement shipped. That entitlement was removed on
    // 2026-08-19 — it is restricted/profile-requiring and, with no embedded
    // provisioning profile, AMFI refused to exec the signed app at all. See
    // build/entitlements.mac.plist.
  },
  // afterSign: notarize the .app via scripts/notarize.js, which adds STAPLE-RETRY
  // recovery for the Apple CDN ticket-propagation race (Error 65). We do NOT use
  // electron-builder's built-in `mac.notarize` because its single-shot staple has
  // no retry and fails the whole build on that race (observed repeatedly). See the
  // notarize.js header and apple-signing-report.md §"Error 65 staple race".
  afterSign: './scripts/notarize.js',
  // Rebuild styled DMGs from the pristine signed .app (create-dmg), then notarize +
  // staple them, then patch latest*.yml dmg hashes and assert the updater ZIP manifest.
  // (electron-builder's own DMG creation corrupts the embedded app signature — see header.)
  afterAllArtifactBuild: require('./scripts/afterAllArtifactBuild.cjs'),
  // As soon as the arm64 updater zip exists, start the Apple Silicon DMG (build +
  // notarize + staple + verify) in a separate background process, so its ~9-min
  // notary wait overlaps the Intel pack/sign/notarize instead of following it.
  // The job stops when this build stops, so a failed build leaves nothing running.
  // Optional speed-up only: any problem starting it is logged and
  // afterAllArtifactBuild builds the DMG itself. Only for builds run through
  // scripts/package-app.js (it sets the run id); otherwise afterAllArtifactBuild
  // builds both DMGs itself, as before. See scripts/lib/dmg-job.cjs.
  artifactBuildCompleted: (event) => {
    const dmgJob = require('./scripts/lib/dmg-job.cjs');
    const runId = process.env[dmgJob.RUN_ID_ENV];
    if (!dmgJob.shouldStartEarlyDmg({ platform: process.platform, file: event && event.file, runId })) return;
    try {
      if (!require('./scripts/afterAllArtifactBuild.cjs').notarytoolArgs()) return; // unsigned: nothing to notarize
      dmgJob.startEarlyDmgJob({ outDir: require('path').dirname(event.file), runId });
    } catch (err) {
      console.warn(`[dmg-job] could not start the early Apple Silicon DMG (${err && err.message}); it will be built at the end instead.`);
    }
  },
  mac: {
    ...base.mac,
    identity: signIdentity,                 // undefined => auto-discover Developer ID Application
    hardenedRuntime: true,                  // REQUIRED for notarization
    gatekeeperAssess: false,                // don't run spctl assess mid-build (fails pre-staple)
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    // notarize is handled by the afterSign hook (with staple retry), NOT by
    // electron-builder's built-in single-shot notarize. `false` disables the
    // built-in path so the .app is notarized exactly once (no double-submit).
    notarize: false,
    // Build ONLY zip with electron-builder (preserves signatures + is the updater
    // artifact); the DMGs are produced cleanly by the afterAllArtifactBuild hook.
    // arm64 FIRST: electron-builder builds arches in this order, and the arm64 DMG
    // starts in the background the moment its zip exists (artifactBuildCompleted).
    target: [
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
  },
};
