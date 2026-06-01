# macOS Signing & Notarization — Operator Checklist

**Audience:** Evin.
**STATUS (2026-05-30): ✅ LIVE & VERIFIED.** A real signed + notarized + stapled build of **v2.7.0** has been produced and verified (both arches, apps + DMGs + ZIPs all `spctl` → "accepted / Notarized Developer ID"). **`apple-signing-report.md` (repo root) is the authoritative, up-to-date record** — read it first. This checklist is background/reference; a few details below predate the final implementation (see report for the current truth):
> - Entitlements live in **`build/`** (not `assets/`).
> - Notarization uses an **App Store Connect API key** (`APPLE_API_KEY`/`_KEY_ID`/`_ISSUER`), because the `natively-notary` keychain profile auto-locks mid-build.
> - The **app** is notarized via `afterSign` (`scripts/notarize.js`, with staple-retry); **DMGs** are rebuilt via `create-dmg` and notarized by `scripts/afterAllArtifactBuild.cjs` (electron-builder's own DMG creation corrupts the embedded signature).
> - electron-builder builds the **`zip` target only**; the hook makes the DMGs.

---

## What changed in the repo (Phase 1)

Production signing lives in a **separate opt-in config file** so the default build is untouched:

- **Default / dev build** (`npm run app:build` / `npm run dist`): **completely unchanged** — `package.json` `build.mac` still has `identity: null`, so electron-builder skips application signing and only the ad-hoc `scripts/ad-hoc-sign.js` signs. No Apple account needed. (We deliberately did NOT remove `identity: null` from package.json: on arm64 that would trigger electron-builder's own ad-hoc fallback and double-sign the bundle.)
- **Production build** (`npm run app:build:signed` / `npm run dist:signed`): runs `electron-builder --config electron-builder.signed.cjs`. That config spreads the package.json `build` block and overrides only mac signing keys: `hardenedRuntime: true`, `entitlements: assets/entitlements.mac.plist`, `entitlementsInherit: assets/entitlements.mac.inherit.plist` (minimal helper entitlements), `gatekeeperAssess: false`, `notarize: false`, `identity` from `NATIVELY_SIGN_IDENTITY`/`CSC_NAME` (or auto-discovered from `CSC_LINK`/keychain). It sets `NATIVELY_PRODUCTION_SIGN=1` so `ad-hoc-sign.js` stands down (never clobbers the Developer ID signature) and wires `afterSign: scripts/notarize.js` to notarize + staple.

New files: `electron-builder.signed.cjs`, `assets/entitlements.mac.inherit.plist`, `scripts/notarize.js`.

---

## Prerequisites (one-time)

1. **Enroll** in the Apple Developer Program ($99/yr).
2. **Create a "Developer ID Application" certificate** (Xcode → Settings → Accounts → Manage Certificates → +, or developer.apple.com → Certificates). Export it as a `.p12` if building in CI.
3. Note your **Team ID** (developer.apple.com → Membership).
4. Create notarization credentials — pick ONE:
   - **App Store Connect API key (recommended):** developer.apple.com → Users and Access → Integrations → App Store Connect API → create a key with "Developer" access. Download the `.p8` (one-time download). Note the **Key ID** and **Issuer ID**.
   - **App-specific password:** appleid.apple.com → Sign-In and Security → App-Specific Passwords → generate one for "notarytool".

---

## Decision needed from you: appId

Current `appId` is `com.electron.meeting-notes` (a stale Electron-sample-style id). For a professional notarized release you likely want something like `software.natively.desktop` or `com.natively.app`.

⚠️ **Changing appId resets ALL macOS TCC permissions** (mic, screen recording, accessibility) for existing installs, because TCC keys grants by bundle id. It may also affect how `natively-api` associates installs/licenses if the backend keys anything to the bundle id. **Do this once, before the first notarized public release — not after.** Tell Claude the desired id and confirm the backend doesn't key on bundle id, and it will update `package.json` `build.appId`.

---

## Build commands

```bash
# Option A — App Store Connect API key (recommended)
export CSC_LINK="/absolute/path/DeveloperIDApplication.p12"   # or omit if cert is in login keychain
export CSC_KEY_PASSWORD="<p12 export password>"               # omit if no password / using keychain
export APPLE_API_KEY="/absolute/path/AuthKey_XXXXXXXXXX.p8"
export APPLE_API_KEY_ID="XXXXXXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
npm run dist:signed

# Option B — Apple ID + app-specific password
export CSC_LINK="/absolute/path/DeveloperIDApplication.p12"
export CSC_KEY_PASSWORD="<p12 export password>"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"
npm run dist:signed

# Option C — cert already trusted in login keychain (no .p12)
export CSC_NAME="Developer ID Application: Your Name (ABCDE12345)"
export APPLE_API_KEY="..."; export APPLE_API_KEY_ID="..."; export APPLE_API_ISSUER="..."
npm run dist:signed
```

> Secrets are read from env only and are **never logged** by `notarize.js`. Do not paste them into committed files.

---

## Verification commands (run on the produced `.app` / `.dmg`)

```bash
APP="release/mac-arm64/Natively.app"   # adjust arch/path

# 1. Code signature is valid and from your Developer ID (not ad-hoc "-")
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dvvv "$APP" 2>&1 | grep -E "Authority|TeamIdentifier|flags"
#   Expect: Authority=Developer ID Application: ...; flags include "runtime" (hardened runtime).

# 2. Gatekeeper accepts it (post-notarization)
spctl --assess --type execute --verbose=4 "$APP"
#   Expect: "accepted" + "source=Notarized Developer ID".

# 3. Notarization ticket is stapled
xcrun stapler validate "$APP"
#   Expect: "The validate action worked!"

# 4. DMG is also signed + stapled
codesign --verify --verbose=2 "release/Natively-2.6.0-arm64.dmg"
xcrun stapler validate "release/Natively-2.6.0-arm64.dmg"

# 5. Entitlements actually present on the app
codesign -d --entitlements :- "$APP"
#   Expect: allow-jit, disable-library-validation, device.audio-input, screen-capture, apple-events.
```

If `spctl` says "rejected" but `codesign` is valid, notarization/stapling didn't complete — re-check the `afterSign` log for `[notarize] Success`.

---

## After the FIRST successful notarized build — cleanup (do NOT do earlier)

Once Gatekeeper accepts the notarized build, the "app is damaged / run xattr" workarounds become obsolete and misleading. Update (do not rewrite historical release notes):
- `.github/RELEASE_TEMPLATE.md` — drop the `xattr -cr` steps for future releases.
- `README.md` install section — replace xattr workaround with "open the DMG, drag to Applications".
- `src/components/.../UpdateModal.tsx` — gate the `xattr` troubleshooting card behind `!notarized` AND `isMac` (also fixes cross-platform bug F-009 where it shows on Windows).

---

## Known external blockers (cannot be done locally by Claude)
- Real cert + notarization upload requires the paid Apple Developer Program + network access to Apple's notary service. The wiring is complete and structurally verified; the live run is yours.
