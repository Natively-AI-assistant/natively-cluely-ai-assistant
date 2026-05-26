# Cross-Platform Contamination Audit

**Date:** 2026-05-23
**Scope:** macOS-only concepts/APIs/strings leaking into Windows (and Linux) code paths.
**Excluded:** `premium/`, `node_modules/`, `dist*`, `.git/`, `.claude/`.

## Summary

- **22 findings total**: 5 CRITICAL, 8 MAJOR, 9 MINOR.
- **Worst affected subsystems** (ranked by user-visible impact on Windows):
  1. Permission/onboarding UI copy + "Open Settings" deep links (still partially Mac-only).
  2. Settings UI exposing macOS-only backends (SCK toggle) and Help/Setup Guide copy.
  3. `electron/main.ts` user-facing strings ("System Settings → Privacy & Security …") propagated to renderer toasts/banners on every platform.
  4. Rust `native-module/src/speaker/mod.rs` has a **broken fallback module** (duplicate struct definitions, conflicting impls) that will fail to compile on Linux — orthogonal to Windows but a sign the conditional-compilation surface was not exercised.
  5. Keyboard shortcut display in non-Settings surfaces (Queue, Solutions, NativelyInterface, SettingsPopup) still renders raw `⌘` glyphs without going through `getModifierSymbol`.

---

## CRITICAL — Breaks on Windows / produces wrong UX

### F-001 — `electron/main.ts` broadcasts Mac-only permission copy to all platforms
- **Location:** `electron/main.ts:1296`, `:1312`, `:1398`, `:1504`, `:1543`, `:2443`, `:2544`, `:2563`, `:4094`
- **Symptom on Windows:** Audio-recovery banners, mic test failures, and meeting-start errors broadcast strings like:
  - `"macOS cannot tap a device while it is also the active microphone"` (1296)
  - `"macOS Screen Recording permission needs to be re-granted… Open System Settings → Privacy & Security → Screen Recording, toggle Natively off and back on"` (1398)
  - `"macOS Microphone permission is granted to Natively in System Settings → Privacy & Security → Microphone"` (1504)
  - `"Screen Recording permission denied… System Settings → Privacy & Security → Screen Recording"` (1543, 2563, 4094)
  - `"Microphone access denied. Please allow microphone access in System Settings"` (2443, 2544)
  All of these surface in the renderer's `audio-capture-failed`/`system-audio-permission-denied` listeners. The renderer already shows them verbatim in the banner (`NativelyInterface.tsx:3182` renders `systemAudioWarning.message`).
- **Reachable on Windows:** YES. The CoreAudio Tap zero-fill detector (`:1395-1404`) is the only one gated by macOS-specific zero-fill logic, but the `audio-capture-failed` broadcast at `:1296` (same-device input/output guard) and `:1310` (8s no-chunks watchdog) fire on Windows too. The `:1502-1505` mic-zero-fill broadcast definitely fires on Windows because it lives inside `setupMicrophoneCapture` which runs on every platform.
- **Root cause:** Diagnostic strings were written for macOS first and never branched. The platform-conditional Open-Settings button (the Issue #252 fix) only switches the URL — it still shows the same Mac-flavored body text.
- **Fix sketch:** Add a `formatPermissionMessage(reason, process.platform)` helper alongside `getMacScreenCaptureStatus`. For Windows substitute `"Settings → Privacy → Microphone"` and `"Settings → Privacy → Screen Recording"` (or drop the Screen-Recording reference entirely — Windows has no equivalent TCC, the same Rust SCK/CA paths don't exist there). For the `:1396-1403` TCC zero-fill detector specifically, gate the whole detector on `process.platform === 'darwin'`: zero-filled chunks on Windows mean WASAPI loopback failure, not TCC.

### F-002 — Rust `speaker/mod.rs` fallback module has duplicate struct definitions
- **Location:** `native-module/src/speaker/mod.rs:39-90`
- **Symptom on Windows:** Doesn't affect Windows (Windows path resolves via lines 18-27). On Linux the build fails with `error[E0428]: the name 'SpeakerStream' is defined multiple times` and `error[E0592]: duplicate definitions with name 'sample_rate'`. Lines 39-66 and lines 68-82 declare the same `SpeakerStream` struct + impl twice. Lines 41-60 also declare `SpeakerInput::stream(self) -> SpeakerStream` AND `SpeakerInput::stream(self) -> Result<SpeakerStream>` — duplicate method, conflicting return types.
- **Reachable on Windows:** No (the file is only compiled when `not(any(target_os="macos", target_os="windows"))`), but it indicates conditional-compilation hygiene is poor across the crate — the file would silently rot until someone runs CI for Linux.
- **Root cause:** A copy-paste during the issue-#219 fix duplicated the fallback impl. The crate has no Linux CI lane to catch it.
- **Fix sketch:** Delete lines 56-90 (the second `stream()` method and the second `SpeakerStream` struct + impl), keep one definition. Add a Linux build to CI (or `cargo check --target x86_64-unknown-linux-gnu`).

### F-003 — `useExperimentalSckBackend` toggle is visible on Windows and silently mis-routes audio
- **Location:** `src/components/SettingsOverlay.tsx:2752-2779` (UI), `src/App.tsx:389-398` (consumer)
- **Symptom on Windows:** The "SCK Backend" toggle in Settings → (parent tab) is rendered without any `isMac` gate. A Windows user enabling it sets `outputDeviceId = "sck"` in `App.tsx:395`, which then passes through `electronAPI.startMeeting` → `electron/main.ts` → `native-module/src/lib.rs:128` → `speaker::SpeakerInput::new(Some("sck"))` → `speaker/windows.rs` (because macOS's `Backend::Sck` branch isn't compiled here). The Windows speaker module will treat `"sck"` as an unknown WASAPI device ID and fall back, or fail outright depending on its lookup logic. Either way: a confusingly named toggle that does nothing useful on Windows and may silently break system-audio capture.
- **Reachable on Windows:** YES.
- **Root cause:** Toggle was added for the macOS A/B test and the surrounding settings section has no platform check.
- **Fix sketch:** Wrap the entire `SCK Backend` card in `{isMac && (…)}`. Read `isMac` from `src/utils/platformUtils.ts` (already imported elsewhere in the file or trivially added). Also hide the corresponding `HelpSettings.tsx:949-966` "ScreenCaptureKit (SCK) / CoreAudio (Legacy)" comparison block on Windows.

### F-004 — Help & Setup Guide tells Windows users to grant macOS-only permissions
- **Location:** `src/components/settings/HelpSettings.tsx:808` ("Enable Screen Recording and Accessibility for Natively in macOS Privacy & Security"), `:828-832` (`'⌘H', '⌘⇧H', '⌘K'` hardcoded hotkeys), `:933-994` (entire "App Permissions Setup" section using `System Settings > Privacy & Security > Screen Recording / Accessibility` paths), `:1772` ("Cmd+Shift+Arrows … Cmd+B … Cmd+1-7")
- **Symptom on Windows:** Brand-new Windows users open the help/onboarding panel and are told to do something impossible (`Privacy & Security` is a macOS-only OS pane). Accessibility permission is a macOS-only concept; on Windows we don't need it because there is no global event-tap equivalent (the StealthKeyboardTap is already gated `#[cfg(target_os="macos")]`).
- **Reachable on Windows:** YES — the whole Help panel renders on every platform.
- **Root cause:** Static copy authored for macOS launch, never branched.
- **Fix sketch:** Branch every step in `SetupGuide` and the `App Permissions Setup` accordion on `isMac`. On Windows: drop the Accessibility step entirely; the Screen Recording step becomes `"Allow Natively when Windows asks for microphone access on first meeting (Settings → Privacy → Microphone)."` The `hotkeys` array should run through `getPlatformShortcut(['⌘','H'])` etc.

### F-005 — `PermissionsToaster` still shows Mac-only "System Preferences" copy on Windows
- **Location:** `src/components/onboarding/PermissionsToaster.tsx:213-219`, `:258`
- **Symptom on Windows:** On first launch the toaster renders a "Screen Recording" row with description `"Required to capture meeting content"` on both platforms; correctly hides the "Open Settings" CTA when `platform !== 'darwin'`. BUT:
  - The label `"Screen Recording"` is shown to Windows users even though Windows has no equivalent OS-level permission concept. There is no "Open Settings" CTA on Windows, so users will see a row that just sits there saying `"System handles this"` (line 291) — slightly confusing but accurate.
  - Line 258 still says `"You can grant permissions later in System Preferences."` unconditionally on the final-CTA helper text. That string is macOS-only — Windows users should see `"Windows will ask the first time you start a meeting."` or equivalent.
- **Reachable on Windows:** YES.
- **Root cause:** Final text-helper was missed when the row-level platform branching was added.
- **Fix sketch:** Change line 258 to a conditional: `platform === 'darwin' ? 'You can grant permissions later in System Preferences.' : 'Windows will prompt you the first time Natively needs the mic.'`. Optionally drop the entire Screen Recording row on Windows since `scrStatus` will always be `'granted'` on Windows per `permissions:check` IPC handler.

---

## MAJOR — Works but shows wrong copy / odd behavior

### F-006 — Keyboard shortcut display uses raw `⌘` glyphs in user-visible UI
- **Location:**
  - `src/_pages/Solutions.tsx:371` — `"Take a screenshot of your problem (⌘H) and press ⌘↵ to generate the script."`
  - `src/_pages/Queue.tsx:357` — `"Take a screenshot (Cmd+H) for automatic analysis"`
  - `src/components/NativelyInterfaceCard.tsx:169` — hardcoded `<kbd>⌘</kbd>`
  - `src/components/UpdateBanner.tsx:60` — comment-only; ignore
  - `src/components/SettingsPopup.tsx:341-357` — fallback hotkey arrays default to `['⌘','B']` and `['⌘','H']` instead of using `getModifierSymbol` for the platform.
  - `src/components/NativelyInterface.tsx:3501` — `(shortcuts.selectiveScreenshot || ['⌘', 'Shift', 'H'])`
  - `src/components/NativelyInterface.tsx:3416` — comment + body: "Cmd+Shift+Space" text
  - `src/components/NativelyInterface.tsx:3452` — "Grant it in System Settings, then restart Natively."
  - `src/components/settings/HelpSettings.tsx:1230-1238` — entire dynamic-action grid hardcodes `'⌘'` symbols (line 1241 belatedly remaps to `'Ctrl'` only inside one map iteration — other rows like `kbd: '⌘1'` at lines 19-23 don't pass through the remap).
- **Symptom on Windows:** Users see the Mac Command glyph `⌘` everywhere except SettingsOverlay shortcuts (which have proper formatting via `useShortcuts`). It's intelligible but unprofessional and wrong for the platform.
- **Reachable on Windows:** YES.
- **Root cause:** No central enforcement; some surfaces use `getPlatformShortcut`, others were added with hardcoded glyphs.
- **Fix sketch:** Mechanical find-and-replace pass — every hardcoded `'⌘'`/`'⌥'`/`'⇧'` literal becomes `getModifierSymbol('cmd'|'option'|'shift')`. Every kbd fallback array becomes `getPlatformShortcut(['⌘','H'])`.

### F-007 — `NativelyInterface.tsx:3452` shows "Grant it in System Settings" on Windows
- **Location:** `src/components/NativelyInterface.tsx:3416-3452`
- **Symptom on Windows:** This is the chat-focus-input failure path that fires when `globalShortcut.register('CommandOrControl+Shift+Space')` fails. On Windows the failure mode is different (probably another app owning the hotkey, not the Accessibility-permission gap macOS has). The dialog explicitly tells the user "Grant it in System Settings" — wrong OS, wrong remedy.
- **Reachable on Windows:** YES — `globalShortcut.register` returning false fires on Windows too.
- **Root cause:** Diagnostic written for macOS Accessibility failure.
- **Fix sketch:** Add an `isMac` branch; on Windows replace with `"Another app may be using Ctrl+Shift+Space. Close it or change the Natively chat shortcut in Settings."`

### F-008 — `IpcHandlers.ts:2553` allowlist accepts `x-apple.systempreferences:` even when invoked from Windows
- **Location:** `electron/ipcHandlers.ts:2544-2562`
- **Symptom on Windows:** The `open-external` IPC handler allows any URL with `x-apple.systempreferences:` protocol. On Windows, `shell.openExternal()` will return a generic protocol-not-handled failure (or pop up "How do you want to open this?" dialog depending on Edge config). The renderer should never be reaching this handler with that scheme — but if any code path slips through (like the `NativelyInterface:3188` line that the user just fixed but might re-regress), the IPC layer silently approves it.
- **Reachable on Windows:** Conditionally — depends on renderer-side bugs, but this is the last line of defense and it has no platform gate.
- **Root cause:** Allowlist trusts protocol, not platform.
- **Fix sketch:** `const allowedSystemSettingsUrl = parsed.protocol === 'x-apple.systempreferences:' && process.platform === 'darwin';`

### F-009 — `UpdateModal.tsx` shows mac-only `xattr -cr` instructions unconditionally
- **Location:** `src/components/UpdateModal.tsx:87`, `:194`, `:201`, `:237-249` (rendered in both `instructions` and `downloading` states — the "If macOS says 'App is damaged'" card)
- **Symptom on Windows:** The "downloading" overlay card embeds an `xattr -cr /Applications/Natively.app` shell command for Windows users. The header literally says `"If macOS says 'App is damaged'"`. Windows users will see this every time the auto-updater downloads a build.
- **Reachable on Windows:** YES — UpdateModal is rendered in `UpdateBanner.tsx` regardless of platform.
- **Root cause:** Update flow was originally Mac-only and the Windows updater path (NSIS) was added without revising the modal.
- **Fix sketch:** Wrap the `xattr` card with `{isMac && (…)}`. The `instructions` state should branch entirely: macOS gets the DMG + xattr steps; Windows gets `.exe` installer instructions (or just "Run the downloaded installer to update.")

### F-010 — `_applyDisguise` and `app.setName` flow uses macOS-tinged process names on Windows
- **Location:** `electron/main.ts:3703-3801`
- **Symptom on Windows:** The disguise mapping is correct (`isWin ? "Command Prompt " : "Terminal "`, etc.), but `process.title = appName` followed by `app.setName(appName)` runs on both platforms — on Windows `app.setName` affects window titles and the AUMID derivation but is largely cosmetic. Mostly fine; flagged because line 3778 sets `process.env.CFBundleName = appName.trim();` — `CFBundleName` is a macOS-only Cocoa env var that has zero effect on Windows but adds noise to the process environment. Not user-visible; minor leak.
- **Reachable on Windows:** Already correctly gated for icon-paths; the `process.env.CFBundleName` line is inside `if (isMac)` — it's clean. Re-classify as MINOR-noted, not a bug.
- **Root cause:** Already gated; this entry is a false-positive on closer reading. Moving to "Verified clean" below.

### F-011 — `HelpSettings.tsx:1240-1241` only re-maps `⌘` in ONE dynamic-action grid; other instances stay raw
- **Location:** `src/components/settings/HelpSettings.tsx:1240-1241` vs lines 19-23, 126-128, 829-832, 1403-1448
- **Symptom on Windows:** Inconsistent. The `dynamic-action` grid at line 1230-1241 correctly maps `'⌘' → 'Ctrl'` via `navigator.platform`-based isWindows; but the same component at lines 19-23, 829, and 1403-1448 keeps raw `⌘` glyphs. Adjacent visual elements in the same panel display different conventions.
- **Reachable on Windows:** YES.
- **Root cause:** Partial fix.
- **Fix sketch:** Migrate the panel to a single `getPlatformShortcut` call site. Same fix family as F-006.

### F-012 — `Solutions.tsx` and `Queue.tsx` shortcut hints hardcode `⌘H` / `⌘↵` / `Cmd+H`
- **Location:** `src/_pages/Solutions.tsx:371`, `src/_pages/Queue.tsx:357`
- **Symptom on Windows:** Same as F-006 but called out separately because these are first-launch empty-state hints — they're the literal first instruction a new user reads.
- **Reachable on Windows:** YES.
- **Fix sketch:** Run through `getPlatformShortcut` / `getModifierSymbol`.

### F-013 — `PhoneMirrorSettings.tsx:171` says "Connect this Mac to the same Wi-Fi as your phone"
- **Location:** `src/components/settings/PhoneMirrorSettings.tsx:171`
- **Symptom on Windows:** "Connect this Mac to the same Wi-Fi as your phone" — wrong device name.
- **Reachable on Windows:** YES — Phone Mirror is exposed on Windows per the settings panel.
- **Root cause:** Hardcoded.
- **Fix sketch:** Change to `"Connect this computer to the same Wi-Fi"` or branch via `isMac ? 'this Mac' : 'this PC'`.

---

## MINOR — Cosmetic / code smell

### F-014 — `LocalWhisperModelPanel.tsx:304` says "Recommended for your Mac" / "PC"
- **Location:** `src/components/LocalWhisperModelPanel.tsx:304`
- **Status:** Already branches on `hardware.isAppleSilicon`, so it's a fair UX. Note for review: an Intel Mac will see "PC" since `isAppleSilicon` is false. Probably intentional (recommendation is about CPU/GPU class, not OS), but worth confirming the wording matches intent.

### F-015 — `electron/services/CodexCliService.ts:90-97` candidate paths are correctly platform-split, but the *order* of macOS paths is fine
- **Location:** `electron/services/CodexCliService.ts:78-99`
- **Status:** Verified clean — Windows branch at lines 80-87 returns early; macOS-only `/Applications/Codex.app/...` only runs in the non-Windows fallback branch. No leak.

### F-016 — `StealthKeyboardManager.ts:163-164` `x-apple.systempreferences:` deep-link
- **Location:** `electron/services/StealthKeyboardManager.ts:151-168`
- **Status:** Verified clean — `openSettings()` early-returns at line 152 if `process.platform !== 'darwin'`. The `x-apple.systempreferences:` URL is unreachable on Windows.

### F-017 — `app.dock.*` calls
- **Location:** `electron/main.ts:437, 3613, 3614, 3627, 3794, 3912, 4146`
- **Status:** Verified clean — all `app.dock.*` calls are inside `if (process.platform === 'darwin')` blocks (verified at lines 436, 3574, 3908, 4142). The bare `app.dock.setIcon(image)` at line 3794 is inside `if (isMac)` (line 3791). Safe.

### F-018 — Comment-only Mac references in `audio/MicrophoneCapture.ts:123`, `audio/NativelyProSTT.ts:107`, `audio/SystemAudioCapture.ts:117,152`
- **Status:** Verified clean — these are comments explaining the original macOS rationale (CoreAudio handle teardown, 5-7s SCK init). No runtime impact.

### F-019 — `src/components/SettingsOverlay.tsx:2083` "System Settings" tab label
- **Status:** `'System Settings'` is the in-app navigation tab inside Natively's own settings UI, not a deep link. Fine.

### F-020 — `native-module/index.d.ts:109` mentions "CoreAudio" / "WASAPI"
- **Status:** This is the auto-generated TypeScript declaration. Comments are descriptive only, not user-facing strings.

### F-021 — Multiple files use `'-apple-system, BlinkMacSystemFont'` font stack
- **Location:** `Cropper.tsx:250`, `FeatureSpotlight.tsx:183, 198`, `ProfileIntelligenceSettings.tsx:507`, `PermissionsToaster.tsx:19`
- **Status:** Standard CSS font-stack. Windows falls through to `"Segoe UI"` or `system-ui` automatically. Not a bug, but if you want pristine Windows typography you can lead with `"Segoe UI Variable"` on Windows.

### F-022 — `electron/main.ts:1395, 1453, 4009` powerMonitor/CoreAudio recovery comments
- **Status:** Comments only; the actual recovery code at `:4017` does not branch on platform but is safe on Windows (no-op for CoreAudio, exercises the cpal restart path).

---

## Verified clean

- **Mac-only NAPI functions** (`applyStealthToWindow`, `isAccessibilityGranted`, `StealthKeyboardTap`) are called via `typeof native.applyStealthToWindow === 'function'` runtime guards (verified in `WindowHelper.ts:350`, `SettingsWindowHelper.ts:219`, `ModelSelectorWindowHelper.ts:209`, `CropperWindowHelper.ts:482`). The Rust side only exports them on `#[cfg(target_os="macos")]`, so on Windows the functions are simply absent and the JS guard correctly skips the call. Clean.
- **Rust `stealth_window.rs` / `keyboard_tap.rs`** are gated `#[cfg(target_os = "macos")]` at the module level in `lib.rs:22, 25`. They don't ship in the Windows binary. Clean.
- **Rust `speaker/mod.rs` macOS/Windows dispatch** for `SpeakerInput`/`list_output_devices`/`default_output_device_uid` is correctly conditional (lines 3-27). The macOS `core_audio.rs` and `sck.rs` are gated by `#[cfg(target_os = "macos")]` at `mod.rs:4, 7`. CoreAudio/SCK do NOT leak into the Windows binary. **This contradicts the user's intuition that "CoreAudio and Screen SCK backend audio is unnecessary on Windows" — the compile gates are correct.** What IS unnecessary on Windows is the renderer-side `useExperimentalSckBackend` toggle (F-003) and the SCK-vs-CoreAudio help copy (F-004 / part of HelpSettings).
- **`ensureMacMicrophoneAccess`** (`electron/main.ts:83-103`) early-returns `true` on non-Darwin. Clean.
- **`getMacScreenCaptureStatus`** (`electron/main.ts:119-136`) early-returns `'granted'` on non-Darwin. Clean.
- **`assertScreenRecordingPermission`** (`electron/ScreenshotHelper.ts:31-60`) early-returns on non-Darwin. Clean.
- **`StealthKeyboardManager.isPermissionGranted/requestPermission/openSettings`** all early-return on non-Darwin (lines 123, 140, 152). Clean.
- **`powerMonitor` resume handler** in `main.ts:4017-4028` correctly works on both platforms (cpal restart is cross-platform; the comment about CoreAudio is descriptive).
- **Disguise icon paths** in `_applyDisguise` (`main.ts:3703-3801`) are correctly branched per `isWin` / `isMac` with platform-appropriate icon assets.
- **`process.env.CFBundleName`** assignment (`main.ts:3778`) is correctly gated by `if (isMac)`.

---

## Triage recommendation

**Block release on Windows until F-001 through F-005 are fixed.** F-001 alone produces the same class of bug as Issue #252 (Mac-only string in a Windows-visible banner) and is reachable through normal meeting flows. F-003 will silently corrupt audio routing for Windows users who toggle the SCK option.

**Mechanical fixes that can land together (~1 day):**
- F-001 (extract `formatPermissionMessage(reason, platform)`)
- F-003 (`{isMac && <SCK toggle />}`)
- F-004 (branch HelpSettings setup steps + permission accordion + hotkey arrays)
- F-005 (PermissionsToaster final-CTA copy)
- F-006 / F-011 / F-012 (one find-and-replace pass for `⌘`/`⌥`/`⇧` → `getModifierSymbol`)
- F-007 (NativelyInterface chat-focus error message)
- F-008 (allowlist platform check)
- F-009 (UpdateModal xattr card)
- F-013 (PhoneMirrorSettings "Mac" → "computer")

**Architectural fix (one-off, ~2h):**
- F-002 (delete duplicate `SpeakerStream` struct + impl in `mod.rs:56-90`, add Linux CI lane).
