# Windows shortcut-guard — physical verification checklist

The shortcut-guard is now **default ON (opt-out)** on Windows. It must be
verified on a real Windows machine — the automated tests only pin the source
contracts (`electron/services/__tests__/StealthShortcutGuard.test.mjs`,
`WindowsStealthSurfaceInvariants.test.mjs`), not runtime behaviour. This is the
remaining `Requires physical Windows verification` item from the platform review.

## Preconditions

- A **Windows x64** build with a current native binary
  (`native-module/index.win32-x64-msvc.node`). Confirm the hook is present:
  ```
  node -e "const m=require('./native-module');console.log(typeof m.StealthKeyboardTap, typeof m.isImeKeyboardActive)"
  ```
  Expect: `function function`. If either is `undefined`, run `npm run build:native`
  first — the guard cannot engage without the hook.
- Run with verbose logging so the guard's warnings surface
  (`SettingsManager` `verboseLogging: true`, or watch the main-process console).
- No corporate EDR that blocks `SetWindowsHookExW` (if it does, start() reports
  failure and the app degrades to a focusable overlay — see Test 4).

## Test 1 — Guard engages at boot by default (fresh profile)

1. Start from a clean user-data dir (no stored `stealthShortcutGuard`).
2. Launch the app; let global shortcuts register.
3. **Expected:** no `shortcut-guard failed to engage` warning; the guard is
   running. To confirm it is armed, do Test 2. There should be **no** visible UI
   change — the guard is silent by design.

## Test 2 — A dropped RegisterHotKey does NOT leak the shortcut character

This is the core regression the default-on guard closes.

1. With the app running (stealth typing OFF), open Notepad (or any text field)
   and click into it so it is the foreground app.
2. Force the app's global shortcut registration to drop, then before the ~10 s
   health poll re-registers it, press one of the app's printable-leak chords
   (e.g. **Ctrl+Enter**, **Ctrl+1**). Ways to force the drop:
   - Sleep/resume the machine, or lock/unlock, or switch virtual desktop —
     Windows silently drops `RegisterHotKey` on these; **or**
   - Temporarily comment the re-register call in `KeybindManager` for a dev run.
3. **Expected (guard ON, default):** the chord fires its Natively action and
   **no character appears in Notepad** — no stray newline from Ctrl+Enter, no
   `1` from Ctrl+1. The hook swallowed the down + the matching up.
4. **Contrast (guard OFF):** set `stealthShortcutGuard: false`, restart, repeat.
   The character now leaks into Notepad during the recovery window — the bug the
   default-on guard prevents.

## Test 3 — Opt-out works

1. Set `stealthShortcutGuard: false` (via the AppState setter / IPC).
2. Restart. **Expected:** no guard hook is installed at boot; Test 2 leaks again.
3. Set it back to unset/`true`; restart. Guard is active again.

## Test 4 — EDR / hook-blocked degradation

1. On a machine where `SetWindowsHookExW` is blocked, launch the app.
2. **Expected:** a `shortcut-guard failed to engage (hook blocked?)` warning; the
   app stays fully functional (shortcuts fall back to `RegisterHotKey` alone).
   No crash, no dead input.

## Test 5 — No interference with normal typing or system shortcuts

With the guard running (stealth typing still OFF), in the foreground app:
- Ordinary typing reaches the app normally (the guard is shortcut-only; it does
  not siphon text).
- System shortcuts still work: **Win+D**, **Alt+Tab**, **Ctrl+C/V**, AltGr
  characters on an EU layout (e.g. `@ { } €`) all pass through untouched.
- Non-Ctrl and Alt/Win chords are unaffected (only the Ctrl/Ctrl+Shift +
  A–Z/0–9/Enter/Space subset is swallowed).

## Record the result

Report each test with the review's validation vocabulary, e.g.
`Tested physically on Windows` for the ones you ran, and leave the rest as
`Requires physical Windows verification`.
