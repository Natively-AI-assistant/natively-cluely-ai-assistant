# Findings — how Interview Coder hides its process, and the Natively fix

Case: `ic-stealth` · PRIMARY: macos-reverse (R31) · offline-sample, auth granted

## TL;DR
Interview Coder is not caught because it disguises the **on-disk identity**, not
just the display name. On macOS the whole bundle is renamed to `systemcontainer`
(main bundle + main executable + every helper bundle/executable), so
`proc_pidpath()` and Activity Monitor never show a brand string. On Windows the
exe keeps its name but the PE version resource (`FileDescription`/`ProductName`)
is set to `systemcontainer`. Natively only set `process.title` and a helper
plist `CFBundleName` — the on-disk bundle/exe/helpers were still `Natively`, so
any path-resolving detector saw the brand.

**Fix implemented (rounds 1–3):**
1. **On-disk identity** — build `productName` set to a *real* per-platform
   system process (`corespeechd` on macOS, `audiodg` on Windows; single source
   of truth `scripts/disguise-name.cjs`), so bundle + main exe + every helper +
   the Windows version resource all present a plausible system identity (the
   exact layout IC ships, safe per E-004). `userData` migrated off the brand
   to `…/corespeechd` (atomic once-only move; aborts/deferrals keep the old
   dir) so `--user-data-dir` no longer leaks `Natively` into process listings.
2. **Telemetry** — remote sinks (PostHog/Axiom/Sentry) are suppressed whenever
   undetectable is on, so a network proctor sees no third-party analytics
   endpoints (only local-jsonl).
3. **Window title** — the renderer's HTML `<title>` ("Natively") can no longer
   own the window title while undetectable; the disguise title is re-asserted,
   so a window-title enumeration never reads the brand.
4. **Bundle ID** — `com.electron.meeting-notes` → `com.apple.corespeechd`, so a
   bundle-identifier check reads a plausible Apple system id instead of
   "electron" + "meeting-notes".

## Evidence → Finding → Path

| # | Evidence | Finding | Path (fix) |
|---|----------|---------|------------|
| 1 | E-001: IC macOS bundle is `systemcontainer.app` / `systemcontainer` / `systemcontainer Helper (X)`; no `process.title` in main JS | IC's macOS stealth = on-disk rename; the Name column + `proc_pidpath` both reflect the executable basename | Rename Natively's on-disk identity to a neutral name |
| 2 | E-002: IC Windows exe = `interviewcoder.exe`, but version resource `FileDescription`/`ProductName` = `systemcontainer` | IC's Windows stealth = version resource, not the image name | Set the Windows version resource to the disguise name |
| 3 | E-003: Natively on-disk = `Natively.app`/`Natively`/`Natively Helper (X)`; only `process.title` + helper plist `CFBundleName` disguised | `process.title`/plist do not change `proc_pidpath`; the brand is exposed to any path-resolving detector | Drive the rename from `productName` so bundle+exe+helpers+version resource all match |
| 4 | E-004: Chromium builds the helper path from the main exe basename (`<base> Helper (Renderer).app`); no hardcoded literal | A *consistent* rename is what Electron expects; the old "don't rename" comment is wrong | `productName` rename is safe (electron-builder emits the consistent layout) |

## The concrete changes (this case)

### Round 1 — on-disk identity (the IC gap)

1. **`package.json` → `build.productName` + `win.executableName`: real per-platform system processes.**
   The disguise is a *real* system process per platform (single source of truth
   `scripts/disguise-name.cjs`, consumed by every CI/release script):
   - macOS: `productName` = `corespeechd` → `corespeechd.app`,
     `Contents/MacOS/corespeechd`, `corespeechd Helper (Renderer/GPU/Plugin).app`
     (+ executables), main `CFBundleName` = `corespeechd`.
   - Windows: `win.executableName` = `audiodg` → `audiodg.exe`, version resource
     `FileDescription`/`ProductName` = `audiodg`.
   This closes the E-003 gap on **both** platforms in one lever. (The first
   draft used IC's own `systemcontainer`; it was refined to a *real* process
   per platform so the name is independently plausible, not just neutral.)

2. **`electron/utils/pinUserData.ts` + `migrateUserData.ts` — pin + migrate `userData` (packaged only).**
   The profile dir is derived from the app name; renaming the app would move it
   to `…/corespeechd` and orphan every existing user's settings/transcripts/
   credentials — and the old `…/Natively` path leaks the brand in every process
   listing (`--user-data-dir=…/Natively`, which HackerEarth v3.1.1 reads). So
   the first launch after the rename **migrates** the profile atomically
   (`renameSync` within one parent dir — cannot half-complete) to the
   per-platform disguise name, then pins there; later launches are no-ops.
   Safety: never throws (aborts to the legacy dir), defers when an old-version
   process is observed (ps basename / tasklist image match, main exe only) or
   the liveness scan fails, never merges or deletes (both-dirs-nonempty adopts
   the new one), leaves a receipt marker. Keychain/safeStorage is untouched by
   a folder move (salt travels with the folder, OS key is signature-bound, and
   the CredentialsManager key-canary backstops surprises). Dev is untouched,
   and the `NATIVELY_AGENT_USER_DATA` override still wins.

3. **`scripts/ad-hoc-sign.js` — `DISGUISE_BASE` tracks the per-platform name.**
   The helper executables are now `corespeechd Helper (X)` / `audiodg Helper (X)`;
   the plist pass re-asserts the same name on `CFBundleName`/`CFBundleDisplayName`
   so the metadata matches the on-disk binary (no `Natively` left in the bundle).
   The outdated "renaming breaks Electron" comment was corrected (see E-004).

4. **`package.json` → `build.mac.extendInfo` usage strings:** `Natively …` →
   `corespeechd …`, so the macOS permission prompts match the new app
   identity instead of contradicting it.

### Round 2 — telemetry + window title (the runtime vectors)

5. **Telemetry stealth — `electron/services/telemetry/telemetrySinks.ts` (new).**
   Remote sinks (PostHog/Axiom/Sentry) are env-gated and unset in the packaged
   build (local-jsonl by default), but a dev/test/user shell *can* carry creds.
   A dependency-free `buildTelemetrySinks(isUndetectable, deps)` now returns
   local-jsonl only when undetectable is on, so no third-party analytics
   endpoint is ever contacted in stealth. Wired via DI from `main.ts`; the
   `setUndetectable` toggle reconfigures sinks mid-session. 11 contract tests.

6. **Window-title stealth — `electron/utils/windowTitleGuard.ts` (new).**
   `applyInitialDisguise()` ran *before* `createWindow()`, so its `setTitle`
   calls no-op'd; the renderer's `<title>Natively</title>` then reached the
   window title via the default `page-title-updated` handling and nothing
   re-applied the disguise. A pure `createPageTitleGuard` (preventDefault +
   re-assert the disguise title, active only while undetectable) is attached in
   `_applyDisguise` for launcher/overlay/settings, and `applyInitialDisguise()`
   is re-called after `createWindow()`. 4 contract tests.

### Round 3 — bundle ID (the identifier vector)

7. **Bundle ID — `com.electron.meeting-notes` → `com.apple.corespeechd`.**
   A bundle-identifier check read "electron" + "meeting-notes". The new id is a
   plausible Apple system id consistent with the macOS `corespeechd` disguise.
   Updated everywhere it is hardcoded: `build.appId`, the TCC-repair bundle id
   (`ipcHandlers.ts`), the Windows AUMID (`windowsTaskbarPolicy.ts`), the
   homebrew cask zap paths (render script + cask), and the clean/uninstall
   scripts (which keep the legacy id too, so upgrades clean up fully). Keychain
   is tied to the code signature (not the bundle id), so credentials survive;
   TCC (mic/screen) is tied to the bundle id, so it resets once.

## What this does / does not change
- **Does:** make the process name, executable path, helper names, (Windows)
  version resource, window title, telemetry endpoints, bundle identifier,
  AND the profile dir (`--user-data-dir`) all present a single plausible
  system identity — the same shape Interview
  Coder ships, extended to the runtime vectors IC also covers.
- **Does not:** alter the
  runtime per-mode `process.title` feature (it still runs on top; the on-disk
  identity is now neutral regardless of mode).

## Residual / honest limits
- **Bundle ID change resets TCC once.** Mic/Screen-Capture grants are tied to
  the bundle id, so a one-time re-grant is required after the rename. Keychain
  (safeStorage) is tied to the code signature, not the bundle id, so
  credentials survive (the app's key-canary would catch a key change anyway).
- **`com.apple.*` namespace is bold.** A deep inspector that checks the
  signature *and* the `com.apple.*` namespace could flag a non-Apple app using
  it. Most proctoring tools check process name / window title / network, not
  the bundle-namespace, so the risk is low.
- **Windows image name is now `audiodg.exe`** (a real system process, more
  neutral than IC's `interviewcoder.exe`). If the team prefers to keep a brand
  exe on Windows and disguise only the version resource (exactly IC's choice),
  that is a `win.executableName` override — a one-line follow-up.
- **~~Model-selector + cropper windows are not title-guarded~~ — fixed (round 4).**
  A creation-time `browser-window-created` handler guards every window from birth
  (via non-constructing `peekInstance()` — the first draft used `getInstance()`
  and nested a second AppState because the constructor itself creates the cropper
  window; caught in dev, fixed, verified clean), and `_applyDisguise` now
  explicitly guards + titles the model-selector and cropper windows.
- **Brand restored in Dock/Finder via `CFBundleDisplayName: Natively` (round 4).**
  Display surfaces (Dock, Finder, Spotlight, prompts, notifications) read the
  static display name; detectors read the executable basename (`corespeechd`) and
  the Dock tile is hidden in undetectable mode anyway. Helpers keep the alias.
  Reopened vector, accepted: `NSWorkspace.localizedName` enumeration reads the
  brand. Pinned by new `packaging-config` tests (DisplayName brand, no
  `CFBundleName` override, usage-string branding, committed `productName` alias —
  release CI consumes it verbatim).
- **"Perfectly undetectable" is a moving target.** This closes the on-disk
  identity gap that distinguishes IC from Natively, plus the telemetry,
  window-title, and bundle-id vectors. A detector that fingerprints the
  Electron/Chromium runtime or the code signature is a different class of check
  not addressed here.
- **Packaged build runtime-verified (round 3):** `npm run app:build` produced
  `corespeechd.app`; a live launch confirmed `proc_pidpath` =
  `…/corespeechd.app/Contents/MacOS/corespeechd`, and the process is
  name-identical to the real macOS `corespeechd` daemon (indistinguishable by
  name in Activity Monitor). A deep path-resolving inspector still sees the
  `.app` bundle shape (the real daemon lives in `/System/Library`).
