# Cross-Platform Fix Review

## Verdict
- **Overall: PASS-WITH-NITS** — primary leak class is closed; one stealth contamination point and a few cosmetic copy issues remain.
- **0 CRITICAL remaining**, **1 MAJOR remaining**, **5 nits**.

The 13 audit findings are all mechanically resolved. The only blocker-class issue is a NEW finding (N-001 below) the audit missed: `src/App.tsx:389-395` still routes `outputDeviceId = "sck"` on every platform if the localStorage flag is set, even after the SCK toggle was correctly hidden in SettingsOverlay. The user's clean Windows install will never hit it; a user who toggled the flag on macOS then switched to a Windows build with the same userData will.

---

## Per-finding review

### F-001 — `electron/main.ts` Mac-only permission copy
- Score: **HIGH**
- Correct? **Yes.** `formatPermissionMessage` introduced with a 6-member `PermissionReason` union, all 6 broadcast sites rewired (verified line-by-line: 1340, 1356, 1445, 1551, 1590, 2490, 2591, 2610). The switch is exhaustive — TS will flag any new variant on add.
- TCC zero-fill detector at 1422 now gated by `process.platform === 'darwin'` — correct; WASAPI doesn't produce sustained zero-fill on revocation.
- Regression risk on macOS: **None.** Mac branches preserve the original strings verbatim where it matters.
- Notes:
  - `screen-recording-revoked-rebuild` returns a Mac-only string unconditionally — acceptable because the only call site (1445) is now gated on darwin. Tight coupling between gate and string; if someone later calls this case from a cross-platform path it will leak. Consider adding an `if (!isMac) return formatPermissionMessage('system-audio-stuck')` guard inside the case, or making the function require platform context.
  - `same-device-input-output` (1340) also returns Mac-only copy — gate at call site is correct (1336: `process.platform === 'darwin'`). Same tight-coupling note.
  - `system-audio-stuck` mentions "AirPods/HFP" — Apple terminology that surfaces on Windows. Cosmetic. See N-005.

### F-002 — Rust `speaker/mod.rs` duplicate stubs
- Score: **HIGH**
- Correct? **Yes.** Re-read the file end-to-end. Single `SpeakerStream` struct (line 40), single `impl SpeakerStream` (58-71), single `pub fn stream(self) -> Result<SpeakerStream>` (45), no duplicate `pub use fallback::SpeakerStream`. Clean. Linux `cargo check` will pass.
- Regression risk on macOS/Windows: **None** — the fallback module is excluded by `cfg(not(any(target_os="macos", target_os="windows")))`.

### F-003 — SCK Backend toggle visible on Windows
- Score: **MEDIUM** (UI fix correct; underlying device-id leak NOT closed — see N-001)
- Correct? **Partial.** UI gate is correct (`{isMac && (…)}` at SettingsOverlay 2754). Surrounding divider also moved inside the gate. JSX brackets balanced.
- Regression risk on macOS: **None** — toggle still renders identically on darwin.
- **Critical gap**: `src/App.tsx:389-395` reads `useExperimentalSckBackend` from localStorage and assigns `outputDeviceId = "sck"` on every platform. If the value is `true` (cross-OS user, manual localStorage edit, restored backup), the Windows native module gets `"sck"` as a device id with no UI to clear it. See N-001.

### F-004 — Help/Setup Guide Mac permissions copy
- Score: **HIGH**
- Correct? **Yes.** All four touchpoints branched: SetupGuide steps[0].desc (812), App Permissions Setup intro (943), SCK vs CoreAudio grid wrapped in `{isMac &&}` (961-983), Screen Recording/Accessibility cards branched into a Mac path vs a Windows-only Microphone card (992-1019). Hotkeys array uses `getModifierSymbol`.
- The Cmd+Shift+Arrows / Cmd+B / Cmd+1-7 string at 1802 branches via inline ternaries — works.
- MockPermissionsAnim caption (443) branches; the animation widget itself is now hidden on Windows (945: `{isMac && <MockPermissionsAnim />}`).
- Regression risk on macOS: **None.**

### F-005 — PermissionsToaster Mac-only final copy
- Score: **HIGH**
- Correct? **Yes.** Final CTA helper branches (267-269). Screen Recording row entirely hidden on non-darwin (215). `allGranted` correctly drops the `scrStatus` requirement when `platform !== 'darwin'` (113).
- Regression risk on macOS: **None.**

### F-006 / F-011 / F-012 — Hardcoded `⌘` glyphs
- Score: **HIGH**
- Correct? **Yes** for the changed surfaces: Solutions.tsx:372, Queue.tsx:358, NativelyInterfaceCard.tsx:170, SettingsPopup.tsx:342/358, NativelyInterface.tsx:3503, HelpSettings.tsx dynamic-action grid (1267) now uses `getModifierSymbol` consistently and the per-row remap is platform-correct.
- HelpSettings hotkeys array (837-839) uses computed cmd/shift constants.
- See N-003 — `useShortcuts.DEFAULT_SHORTCUTS` const is still Mac-hardcoded but unused; `buildDefaultShortcuts()` is correct.

### F-007 — "Grant it in System Settings" on Windows
- Score: **HIGH**
- Correct? **Yes by gating.** The string at 3454 was not rewritten, but the entire banner is now wrapped in `{isMac && stealthPermissionMissing && (…)}` at 3449. CGEventTap is darwin-only at the Rust layer, so `stealthPermissionMissing` should never be set true on Windows anyway — the JSX gate is belt-and-suspenders. Confirmed `stealthHotkeyConflict` banner (3421) is already cross-platform safe ("Click the input to activate, or rebind in Settings").
- Regression risk on macOS: **None.**

### F-008 — `x-apple.systempreferences:` allowlist
- Score: **HIGH**
- Correct? **Yes.** `allowedSystemSettingsUrl` now requires `process.platform === 'darwin'` (ipcHandlers.ts:2560). Defense in depth confirmed.
- Regression risk on macOS: **None.**

### F-009 — UpdateModal xattr instructions
- Score: **HIGH**
- Correct? **Yes.** Both the `instructions` block (193-214) and the `downloading` troubleshooting card (240-277) are now `isMac`-gated. JSX bracket balance verified — `{isMac && (` at 240 closes with `)}` at 277 wrapping a single `<div>`.
- `handleCopyCommand` (87) still hardcodes the mac path but is only reachable from inside the `isMac` branch — dead code on Windows. Harmless.
- Windows path renders a single short paragraph ("Run the downloaded installer…") — correct.
- Regression risk on macOS: **None.**

### F-013 — "this Mac" in PhoneMirrorSettings
- Score: **HIGH**
- Correct? **Yes.** Line 172 now uses `{isMac ? 'Mac' : 'PC'}` and branches the firewall reference to Windows Defender Firewall on non-mac. Reads naturally.

---

## New findings (audit missed these)

### N-001 — `src/App.tsx:389-395` routes `outputDeviceId="sck"` to the Windows native module
- Severity: **MAJOR**
- Location: `src/App.tsx:389-395`
- Symptom: F-003 hid the UI toggle on Windows, but the consumer in `handleStartMeeting` still reads `useExperimentalSckBackend` from localStorage unconditionally and sets `outputDeviceId = "sck"`. Any Windows user with that flag set (cross-platform sync, prior macOS session that wrote the key, manual localStorage tinkering, support troubleshooting) will pass `"sck"` to `native-module/src/speaker/windows.rs` which does not understand it. The audit explicitly called this leak path in F-003 but the fix only addressed the UI.
- Suggested fix: Add `&& isMac` to line 393, or in the same block delete the localStorage key on non-darwin startup. Recommended: `if (useExperimentalSck && isMac) { outputDeviceId = "sck"; }`.

### N-002 — `formatPermissionMessage` tightly couples gate-at-callsite with Mac-only strings
- Severity: **MINOR**
- Location: `electron/main.ts:160-161, 170-171`
- Symptom: `screen-recording-revoked-rebuild` and `same-device-input-output` return Mac-only copy without checking `isMac` internally. Each works only because the current call site is gated. The helper is otherwise platform-aware (the other 4 cases branch). If a future contributor calls these cases from a cross-platform path, the leak returns silently.
- Suggested fix: Add `if (!isMac) return formatPermissionMessage('system-audio-stuck');` (or similar fallback) inside both cases so the helper is defensive end-to-end. Or rename the type variants to make the macOS-only constraint explicit (e.g. `mac-screen-recording-revoked-rebuild`).

### N-003 — `useShortcuts.DEFAULT_SHORTCUTS` const is Mac-hardcoded
- Severity: **MINOR**
- Location: `src/hooks/useShortcuts.ts:70-97`
- Symptom: The `DEFAULT_SHORTCUTS` exported constant uses `'⌘'`/`'⌥'`/`'⇧'` literals while `buildDefaultShortcuts()` (37-68) uses `isMac`. Currently no consumer imports `DEFAULT_SHORTCUTS` (grep clean), so it's a latent footgun, not an active bug.
- Suggested fix: Delete `DEFAULT_SHORTCUTS` or replace its body with `buildDefaultShortcuts()`.

### N-004 — `Queue.tsx:359` still has `⚙️ Models` emoji next to Cmd hint
- Severity: **MINOR / SUGGESTION**
- Location: `src/_pages/Queue.tsx:359`
- Symptom: One line below the fix, the next line "Click ⚙️ Models to switch AI providers" is fine, but it sits in the same JSX block — easy to overlook if you scan in isolation. No actual bug. Listing here so the next pair of eyes confirms no other strings in that empty-state hint embed Mac concepts.

### N-005 — `formatPermissionMessage('system-audio-stuck')` mentions "AirPods/HFP"
- Severity: **MINOR**
- Location: `electron/main.ts:173`
- Symptom: This branch fires on Windows (broadcast at line 1356 is cross-platform). "AirPods" is Apple branding; HFP is a Bluetooth profile but the pairing reads as Mac terminology to a Windows user.
- Suggested fix: Generalize to "If your meeting app is using a different output device (Bluetooth headset, virtual cable), switch it to your default output."

### N-006 — `LocalWhisperModelPanel.tsx:304` Intel Mac sees "PC"
- Severity: **NIT** (already flagged in audit as F-014, restated for completeness)
- Status: Branches on `isAppleSilicon`, not `isMac`. An Intel Mac will see "Recommended for your PC". Confirm intent.

---

## What's verified clean

- **All `isMac` / `getModifierSymbol` imports present** in the 9 changed renderer files (verified by grep).
- **JSX bracket balance** in `UpdateModal.tsx` (the `{isMac && (` at 240 / `)}` at 277 wraps a single `<div>` cleanly; instructions block at 193-214 similarly clean).
- **No rogue `process.platform` in `src/`** — only legitimate fallback in `platformUtils.ts`.
- **No direct `navigator.platform` use** outside `platformUtils.ts`.
- **No Mac-only NPM packages** (`node-mac-permissions`, `mac-screen-capture-permissions`, `node-mac-notifications` etc.) imported anywhere.
- **No unconditional Mac shell-outs** (`osascript`, `pbcopy`, `defaults`, `tccutil`, `open -a`) in `electron/`.
- **`app.dock.*` calls** at lines 476, 3661, 3674, 3841, 3959, 4193 are all inside `if (process.platform === 'darwin')` blocks — re-verified the two the audit didn't enumerate (476, 4193, 3959).
- **`systemPreferences.getMediaAccessStatus` / `askForMediaAccess`** call sites (main.ts:87, 94, 130, 4106; ipcHandlers.ts:3710, 3711, 3721; ScreenshotHelper.ts:36) all gated on darwin or fall through `ensureMacMicrophoneAccess` which early-returns.
- **`WindowHelper.ts` BrowserWindow options** (`vibrancy`, `visualEffectState`, `titleBarStyle`, `trafficLightPosition`) all behind `isMac ?` ternaries (185-200).
- **Rust speaker mod fallback** compiles cleanly — verified single struct/impl/method definition.
- **F-007 chat-focus banner gating** — confirmed `{isMac && stealthPermissionMissing && …}`; the related `stealthHotkeyConflict` banner has no Mac copy.
- **`x-apple.systempreferences:` is unreachable on Windows** at three layers: (1) the renderer button (NativelyInterface 3189) only renders when `kind === 'screen-recording-permission'` and that event only fires from a darwin-gated broadcast; (2) `PermissionsToaster.openScreenSettings` is only invoked when `platform === 'darwin'`; (3) the IPC allowlist (ipcHandlers 2560) requires darwin. Defense in depth confirmed.
- **`-apple-system, BlinkMacSystemFont, …`** font stacks are standard CSS fallbacks — Windows falls through to Segoe UI automatically. Audit correctly classified as non-issue.

---

## Manual test recommendation

### Windows
1. Fresh install: confirm Settings → SCK Backend toggle is NOT visible.
2. Set `localStorage.useExperimentalSckBackend = 'true'` via DevTools, then click Start Meeting. Confirm the audio pipeline doesn't pass `"sck"` to the native module — this will currently fail per N-001.
3. Trigger the audio-capture-failed banner (start meeting with mic muted at OS level): banner title should say "Audio Capture Issue" and the "Open Settings" button should open Natively's own Settings window, not pop a Microsoft Store dialog.
4. Open Help → App Permissions Setup: should show ONLY a Microphone card, no Screen Recording / Accessibility cards, no SCK vs CoreAudio grid, no MockPermissionsAnim widget.
5. Open Help → Hotkeys panel: confirm all glyphs show "Ctrl", not "⌘".
6. Trigger the UpdateModal via test flow (`Cmd+I` per UpdateBanner): downloading view should NOT show the xattr troubleshooting card.
7. Phone Mirror with LAN access on but no Wi-Fi: warning should say "this PC" and reference Windows Defender Firewall.
8. PermissionsToaster on first launch: should show only the Microphone row, no Screen Recording row, and the helper text should read "Windows will prompt you the first time…".

### macOS
1. Confirm Settings → SCK Backend toggle still renders identically.
2. Confirm all permission-denied banners read the same Mac-flavored copy they did before (no regression in helpfulness — re-read against pre-fix screenshots if available).
3. Trigger TCC zero-fill detector by revoking Screen Recording mid-meeting: banner should still fire with `screen-recording-revoked-rebuild` message.
4. Stealth typing without Accessibility: banner at NativelyInterface 3449 should still appear.
5. UpdateModal: xattr troubleshooting card still visible.

### Build / type-check
- Run `npm run typecheck` (or equivalent) — the user said only a partial typecheck was run. Critical verifications: (a) `formatPermissionMessage` exhaustive switch infers `string`; (b) all new `isMac` / `getModifierSymbol` imports resolve; (c) `PermissionReason` union doesn't conflict elsewhere.
- Run `cargo check` from `native-module/` on macOS and Windows; `cargo check --target x86_64-unknown-linux-gnu` from a host with the toolchain, or wait for CI.
