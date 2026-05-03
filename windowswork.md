# Windows Stealth-Input Work — Plan

> Tracking doc for the Windows-only fix to issue **#225** (overlay focus events
> are detectable via `window.onblur` / `window.onfocus`). This is the design and
> implementation plan for the long path: a non-activating overlay plus an
> opt-in keyboard pipeline that lets the user type without surfacing the
> overlay as the foreground HWND.

---

## 0. Bug

- **Issue:** [#225 — Window blur / visibility issue on Windows - Detectable](https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/issues/225)
- **Reporter:** @mat926 · OS: Windows 11 · Natively 2.5.0 · Label: bug
- **Repro:** Open https://www.proginosko.com/test/WindowFocusEvents.html → enable Natively undetected mode → click between the page and the Natively overlay → page logs `blur` and `focus` events.
- **Expected:** In undetected mode, switching attention to/from Natively must not produce focus events on the previously-active window.

### Root cause

`electron/WindowHelper.ts:285` constructs the overlay with `focusable: true`
and no `WS_EX_NOACTIVATE`-equivalent. Any Win32 HWND that becomes the
foreground window — whether by `focus()` or by a user click — fires
`WM_KILLFOCUS` on the previous foreground HWND. The page sees that as
`window.onblur`, the test page records it, the user is detected.

`electron/main.ts:2299` `setUndetectable()` only flips content protection
on Windows. There is no equivalent of the macOS dedicated stealth wiring
(`setVisibleOnAllWorkspaces`, `setHiddenInMissionControl`,
`setAlwaysOnTop("floating")` at `WindowHelper.ts:295-299`).

---

## 1. Goal

Two requirements that conflict in the standard Win32 input model:

1. **Undetectable** — typing into / clicking the overlay must NOT cause the browser to fire `blur` / `focus` events.
2. **Typeable** — the user must be able to type a question into the overlay's input field while the browser keeps foreground.

Standard model conflicts because the foreground window IS the keyboard-focus
window. Solving both means bypassing the standard input path.

---

## 2. Architecture

Three phases, ship-able independently. Phase 1 alone resolves the literal
issue #225 repro. Phases 2 + 3 give the full "undetectable + typeable" UX.

```
                     ┌──────────────────────────────────────────┐
                     │  Phase 1: Non-activating overlay         │
                     │  WS_EX_NOACTIVATE via setFocusable(false)│
                     │  - Overlay never becomes foreground       │
                     │  - Browser never blurs                    │
                     │  - User cannot type by clicking ❌        │
                     └────────────┬─────────────────────────────┘
                                  │
                                  ▼
        ┌─────────────────────────────────────────────────────────┐
        │  Phase 2: Type Mode — opt-in low-level keyboard hook     │
        │  WH_KEYBOARD_LL installed only while user opts in        │
        │  Hook swallows keystrokes, ships them to overlay via     │
        │  napi-rs threadsafe-fn → IPC → renderer input field      │
        │  Activated by global hotkey, ended by Esc / Enter / idle │
        │  Browser still keeps foreground → no blur                │
        │  User can type ✅                                         │
        └─────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼ (optional, future)
        ┌─────────────────────────────────────────────────────────┐
        │  Phase 3: Passive raw-input observer                     │
        │  RegisterRawInputDevices with RIDEV_INPUTSINK            │
        │  Observe (does NOT swallow) keystrokes globally          │
        │  Use case: detect "user is typing" → prompt them with a  │
        │  subtle cue to hit the hotkey if they want Natively to   │
        │  receive it. Always-on, no swallowing → low AV risk.     │
        └─────────────────────────────────────────────────────────┘
```

> ⚠️ **Important correction to my earlier message in chat:** `RIDEV_INPUTSINK`
> lets a window *observe* keystrokes when not in foreground. It does NOT
> intercept them — the browser still receives them. To *swallow* keys (so
> the browser does not see what the user types into Natively), you need
> `SetWindowsHookEx(WH_KEYBOARD_LL, ...)` and return non-zero from the
> hook proc. The plan reflects this.

---

## 3. Phase 1 — Non-activating overlay (small, ship first)

**Outcome:** closes the literal repro on issue #225. User loses click-to-type
into the overlay (this is the trade-off). Ship as a standalone PR.

### Files

#### `electron/WindowHelper.ts`

Two changes:

**a)** In the overlay constructor (`createWindow()`, around line 285),
gate `focusable` on platform:

```ts
const overlaySettings: Electron.BrowserWindowConstructorOptions = {
  // ...existing fields...
  alwaysOnTop: true,
  focusable: process.platform !== 'win32', // Win32 → WS_EX_NOACTIVATE: never becomes foreground
  resizable: false,
  movable: true,
  skipTaskbar: true,
  hasShadow: false,
}
```

**b)** Update `syncOverlayInteractionPolicy()` (around line 482) — its
unconditional `setFocusable(true)` would undo the stealth fix on Windows
when passthrough toggles off. Make it respect platform + undetectable:

```ts
} else {
  this.overlayWindow.setIgnoreMouseEvents(false);
  // Restore focusability only when not in Windows-undetectable mode.
  const undetectable = this.appState.getUndetectable();
  const shouldBeFocusable = !(process.platform === 'win32' && undetectable);
  this.overlayWindow.setFocusable(shouldBeFocusable);
}
```

**c)** Update the explicit `focus()` calls in `showOverlay()` (line 511)
and `switchToOverlay()` (lines 612, 630) to skip `focus()` when on
Windows + undetectable:

```ts
const shouldGrabFocus = !(process.platform === 'win32' && this.appState.getUndetectable());
if (!inactive && shouldGrabFocus) this.overlayWindow.focus();
```

#### `electron/main.ts`

Inside `setUndetectable(state)` (line 2299), add a Windows branch that
mirrors the focusability flip on the live overlay so toggling undetected
mode at runtime works without restart:

```ts
if (process.platform === 'win32') {
  const overlay = this.windowHelper.getOverlayWindow();
  if (overlay && !overlay.isDestroyed()) {
    overlay.setFocusable(!state);
  }
  // launcher window stays focusable — the user needs the launcher.
}
```

### Manual test on Windows

1. `npm run build && npm run dist` on Windows 11.
2. Launch Natively, enable undetected mode.
3. Open https://www.proginosko.com/test/WindowFocusEvents.html in Chrome.
4. Click back and forth between Chrome and the Natively overlay.
5. **PASS:** the test page logs no `blur` or `focus` events.
6. Sanity:
   - Disable undetected mode → page sees blur/focus events again (proves the gate works).
   - On macOS: nothing changed; overlay still focusable; hotkeys still fire.
   - Cmd+B / Ctrl+B toggle still hides/shows correctly.
   - The Opacity Shield path (`switchToOverlay()` lines 599-614) still hides DWM artifacts.

### What Phase 1 does NOT solve

- User cannot type by clicking the overlay.
- User cannot type at all unless they toggle undetected OFF first.

Phase 2 fixes this.

---

## 4. Phase 2 — Type Mode (low-level keyboard hook, opt-in)

**Outcome:** undetectable + typeable. The only sensitive piece (the LL hook)
is installed strictly during user-initiated typing windows, not always-on.

### UX contract

- User triggers **type mode** via a global hotkey (default `Ctrl+Shift+Space`,
  configurable via existing `KeybindManager`). Or by clicking a "Type"
  button visible in the overlay (the click is non-activating; clicking
  the button just sends an IPC).
- While type mode is active:
  - Native LL hook is installed.
  - Hook swallows keystrokes (`Esc`, `Enter`, modifier keys handled per below).
  - Each char is forwarded as a synthetic input event to the overlay's
    text field via IPC.
  - A clear, persistent indicator inside the overlay shows "typing…" so
    the user knows their keystrokes are being captured (auditability —
    important for AV story and user trust).
- Type mode ends on:
  - `Enter` → submit, then uninstall hook.
  - `Esc` → cancel, uninstall hook.
  - 5 seconds of idle (no key) → auto-end, uninstall hook.
  - Browser foreground change detected (defensive).
- Hook is NEVER installed while type mode is off. No always-on keyboard
  surveillance.

### Native module changes

#### `native-module/Cargo.toml`

Extend the Windows feature list on the `windows` crate. Existing entry:

```toml
[target.'cfg(target_os = "windows")'.dependencies]
wasapi = "0.13.0"
windows = { version = "0.52.0", features = ["Win32_Media_Audio", "Win32_System_Com", "Win32_System_Threading"] }
tracing = "0.1.44"
```

Add features:

```toml
windows = { version = "0.52.0", features = [
  "Win32_Media_Audio", "Win32_System_Com", "Win32_System_Threading",
  "Win32_UI_WindowsAndMessaging",     # SetWindowsHookExW, CallNextHookEx, message loop
  "Win32_UI_Input_KeyboardAndMouse",  # KBDLLHOOKSTRUCT, virtual key codes
  "Win32_UI_TextServices",            # ToUnicode for scancode → char
  "Win32_System_LibraryLoader",       # GetModuleHandleW
  "Win32_Foundation",
] }
```

#### New module: `native-module/src/keyboard/`

Layout:

```
native-module/src/keyboard/
├── mod.rs          # platform router; on non-windows, exports no-op stubs
└── win_hook.rs     # Windows LL hook + dispatch to napi tsfn
```

#### `native-module/src/keyboard/mod.rs`

```rust
#[cfg(target_os = "windows")]
mod win_hook;

#[cfg(target_os = "windows")]
pub use win_hook::{install_keyboard_hook, uninstall_keyboard_hook};

// no-op stubs for macOS so the napi binding compiles cross-platform.
#[cfg(not(target_os = "windows"))]
pub fn install_keyboard_hook(_cb: napi::threadsafe_function::ThreadsafeFunction<KeyEvent, napi::threadsafe_function::ErrorStrategy::Fatal>) -> napi::Result<()> {
  Err(napi::Error::from_reason("keyboard hook is windows-only"))
}

#[cfg(not(target_os = "windows"))]
pub fn uninstall_keyboard_hook() -> napi::Result<()> { Ok(()) }
```

#### `native-module/src/keyboard/win_hook.rs` (skeleton)

Single hook on a dedicated thread with a message pump. Forwards to JS via
napi `ThreadsafeFunction`. The hook must run on a thread with a message
loop (LL hooks are a thread-local Win32 concept).

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::thread::{self, JoinHandle};
use windows::Win32::Foundation::{HINSTANCE, LRESULT, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
  CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx,
  HHOOK, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL,
  WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{ToUnicode, GetKeyboardState};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;

#[napi(object)]
pub struct KeyEvent {
  pub vk: u32,
  pub scancode: u32,
  pub down: bool,
  pub alt: bool,
  pub ctrl: bool,
  pub shift: bool,
  pub win: bool,
  pub character: Option<String>, // resolved via ToUnicode when printable
}

static HOOK_THREAD: OnceLock<JoinHandle<()>> = OnceLock::new();
static HOOK_RUNNING: AtomicBool = AtomicBool::new(false);
static TSFN: OnceLock<napi::threadsafe_function::ThreadsafeFunction<KeyEvent>> = OnceLock::new();

pub fn install_keyboard_hook(
  tsfn: napi::threadsafe_function::ThreadsafeFunction<KeyEvent>,
) -> napi::Result<()> {
  if HOOK_RUNNING.swap(true, Ordering::SeqCst) {
    return Err(napi::Error::from_reason("hook already installed"));
  }
  let _ = TSFN.set(tsfn);
  let handle = thread::spawn(move || {
    unsafe {
      let hinst: HINSTANCE = GetModuleHandleW(None).unwrap_or_default().into();
      let hook: HHOOK =
        SetWindowsHookExW(WH_KEYBOARD_LL, Some(low_level_keyboard_proc), hinst, 0)
          .expect("SetWindowsHookExW failed");

      // Pump messages on this thread until uninstall_keyboard_hook() posts WM_QUIT.
      let mut msg = MSG::default();
      while GetMessageW(&mut msg, None, 0, 0).as_bool() {
        // No translate/dispatch — we only need to keep the queue draining.
      }

      let _ = UnhookWindowsHookEx(hook);
    }
  });
  let _ = HOOK_THREAD.set(handle);
  Ok(())
}

pub fn uninstall_keyboard_hook() -> napi::Result<()> {
  if !HOOK_RUNNING.swap(false, Ordering::SeqCst) { return Ok(()); }
  // PostThreadMessage WM_QUIT to the hook thread so GetMessageW returns false.
  // (Need to capture the thread id when we spawn — simplification omitted here.)
  // tsfn is dropped automatically when the OnceLock is reset on next install.
  Ok(())
}

unsafe extern "system" fn low_level_keyboard_proc(
  code: i32,
  wparam: WPARAM,
  lparam: LPARAM,
) -> LRESULT {
  if code < 0 {
    return CallNextHookEx(None, code, wparam, lparam);
  }
  let kb = *(lparam.0 as *const KBDLLHOOKSTRUCT);
  let event_kind = wparam.0 as u32;
  let down = matches!(event_kind, WM_KEYDOWN | WM_SYSKEYDOWN);

  // Translate virtual key + modifier state to a printable character via ToUnicode.
  // Buffer modifier flags from a thread-local KeyboardState snapshot.
  let mut keyboard_state = [0u8; 256];
  let _ = GetKeyboardState(&mut keyboard_state);

  let mut buf = [0u16; 8];
  let n = ToUnicode(kb.vkCode, kb.scanCode, Some(&keyboard_state), &mut buf, 0);
  let character = if n > 0 {
    Some(String::from_utf16_lossy(&buf[..n as usize]))
  } else { None };

  let alt   = (keyboard_state[0x12] & 0x80) != 0; // VK_MENU
  let ctrl  = (keyboard_state[0x11] & 0x80) != 0; // VK_CONTROL
  let shift = (keyboard_state[0x10] & 0x80) != 0; // VK_SHIFT
  let win   = (keyboard_state[0x5B] & 0x80) != 0  // VK_LWIN
           || (keyboard_state[0x5C] & 0x80) != 0; // VK_RWIN

  if let Some(tsfn) = TSFN.get() {
    let event = KeyEvent {
      vk: kb.vkCode, scancode: kb.scanCode, down,
      alt, ctrl, shift, win, character,
    };
    let _ = tsfn.call(Ok(event), napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking);
  }

  // Return 1 to *swallow* the key (browser does not see it).
  // Caveat: returning 1 for ALL keys while hook is installed means user cannot
  // type into ANYTHING else, including system shortcuts. So the JS layer must
  // be the gatekeeper that asks for hook installation only during type mode,
  // and uninstall promptly on Esc / Enter / idle.
  LRESULT(1)
}
```

Caveats encoded above:

- **Modifier key handling.** `ToUnicode` requires the keyboard-state buffer
  to reflect modifier-down state. The skeleton uses `GetKeyboardState` which
  is per-thread and may not reflect global state in an LL hook. Production
  code should track modifier state explicitly via WM_KEYDOWN/UP transitions.
- **Dead keys / IME.** `ToUnicode` mutates the kernel's dead-key state. For
  IME-using languages (CJK), this hook bypasses the IME entirely. **Out of
  scope for v1**; document as known limitation. Users on IME locales should
  fall back to STT.
- **System shortcuts.** Returning 1 swallows everything. If type mode
  needs to allow Ctrl+C / Ctrl+V to work normally inside the overlay's
  text field (yes, eventually), the JS side dispatches a synthetic
  clipboard event to the renderer; the hook still swallows the literal key.
- **Crash safety.** The hook proc must NOT panic. Wrap the body in
  `std::panic::catch_unwind` and return `CallNextHookEx(...)` on panic so
  the OS doesn't disable the hook.
- **Timeout.** Win32 silently uninstalls LL hooks that take longer than
  `LowLevelHooksTimeout` (registry value, default 300ms) per call. The
  hook proc must be lock-free and never block on the tsfn dispatch.

#### `native-module/src/lib.rs`

Add napi exports:

```rust
mod keyboard;

#[napi]
pub fn install_keyboard_hook(callback: napi::JsFunction) -> napi::Result<()> {
  let tsfn: napi::threadsafe_function::ThreadsafeFunction<keyboard::KeyEvent, _> =
    callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
  keyboard::install_keyboard_hook(tsfn)
}

#[napi]
pub fn uninstall_keyboard_hook() -> napi::Result<()> {
  keyboard::uninstall_keyboard_hook()
}
```

### TS bridge

#### New file: `electron/services/WindowsKeyboardHook.ts`

```ts
import { app } from 'electron';

type KeyEvent = {
  vk: number; scancode: number; down: boolean;
  alt: boolean; ctrl: boolean; shift: boolean; win: boolean;
  character: string | null;
};

export class WindowsKeyboardHook {
  private active = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private native: any | null = null;

  constructor(private onKey: (e: KeyEvent) => void) {
    if (process.platform !== 'win32') return;
    // require lazily so non-Windows builds don't fail to load.
    this.native = require('../../native-module/index.node');
  }

  start(): void {
    if (process.platform !== 'win32' || this.active || !this.native) return;
    this.native.installKeyboardHook((e: KeyEvent) => {
      this.bumpIdleTimer();
      this.onKey(e);
    });
    this.active = true;
    this.bumpIdleTimer();
  }

  stop(): void {
    if (!this.active || !this.native) return;
    this.native.uninstallKeyboardHook();
    this.active = false;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  isActive(): boolean { return this.active; }

  private bumpIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), 5_000);
  }
}
```

#### Wire-in: `electron/main.ts`

- Instantiate the hook in `AppState` constructor (skip on non-win32).
- Add `enterTypeMode()` / `exitTypeMode()` methods that call `start()` / `stop()`.
- Forward filtered `KeyEvent`s to the overlay renderer via IPC (`'overlay:type-mode-key'`).
- Register a global shortcut (`Ctrl+Shift+Space` default, configurable) that flips `enterTypeMode()`.
- On `Esc` or `Enter`, stop the hook AFTER dispatching the event so the renderer can use them as submit/cancel.

#### IPC: `electron/ipcHandlers.ts`

Two new channels:

```ts
safeHandle('overlay:enter-type-mode', async () => appState.enterTypeMode());
safeHandle('overlay:exit-type-mode',  async () => appState.exitTypeMode());
```

#### Preload: `electron/preload.ts`

```ts
overlay: {
  enterTypeMode: () => ipcRenderer.invoke('overlay:enter-type-mode'),
  exitTypeMode:  () => ipcRenderer.invoke('overlay:exit-type-mode'),
  onTypeModeKey: (cb: (e: KeyEvent) => void) => {
    const h = (_: unknown, e: KeyEvent) => cb(e);
    ipcRenderer.on('overlay:type-mode-key', h);
    return () => ipcRenderer.removeListener('overlay:type-mode-key', h);
  },
},
```

### Renderer (overlay) integration

In `src/components/NativelyInterface.tsx` (or whichever component owns the
overlay's input field):

- Show a non-modal "typing…" badge whenever `electronAPI.overlay.onTypeModeKey`
  fires, until 5s of inactivity.
- Append printable chars to the input value; handle `Backspace`, `Enter`
  (submit), `Esc` (cancel + clear).
- Visual state must be unmistakable so the user knows their keys are being
  captured (this is the user-trust / AV-story affordance).

---

## 5. Phase 3 — Passive raw-input observer (optional, future)

Not required to close #225 and not required for type-mode-while-undetected.
Adds a "subtle nudge" UX: when the user starts typing in their browser,
Natively can show a faint hint ("press Ctrl+Shift+Space to ask Natively
about this"). Always-on, observe-only, no swallow → low AV risk.

Implementation: a hidden message-only window (HWND_MESSAGE) on a dedicated
Rust thread, `RegisterRawInputDevices` for usage page 0x01 / usage 0x06
(generic keyboard) with `RIDEV_INPUTSINK`, `WM_INPUT` handler dispatches
to napi tsfn. Skip until Phase 2 is solid.

---

## 6. Out-of-scope for this work

- Linux. Reporter is on Windows; X11/Wayland have their own focus model.
- macOS. Already has working stealth wiring; no changes needed.
- IME locales (CJK, etc.) — Phase 2 v1 cannot deliver IME composition
  through the LL hook. Document and direct users to STT.
- Mouse-side detection (the user's clicks themselves can be detected by
  `mouseleave`/`pointerleave` in some setups). Out of scope; #225 is
  specifically about focus events.
- Browser-extension-based fixes (would need to ship + maintain an
  extension; off-topic for an Electron desktop app).

---

## 7. Build & packaging

- The native module already builds via existing tooling (see `native-module/`
  scripts). Adding the keyboard module is no new infrastructure.
- Verify the prebuild step still works on Windows after adding the new
  Cargo features (`npm run build:native`).
- The new module increases binary size by a few hundred KB at most (the
  `windows` crate is already a dep).

---

## 8. AV / EDR / code-signing posture

A low-level keyboard hook is the textbook signature of a keylogger.
Mitigations:

1. **Lifecycle.** Hook is installed only during type-mode windows
   (max ~5s typical). Never installed at app start, never installed
   while idle. Auditable.
2. **Visible indicator.** Overlay shows "typing…" while hook is active.
   No silent capture.
3. **No exfiltration.** Captured chars stay in-process; they go to the
   overlay text field, full stop. No telemetry, no logs.
4. **Signed binary.** Existing Windows build is presumably code-signed
   (verify; if not, this work is a forcing function). Most reputable
   AV products treat a signed binary with a low-level hook as suspicious
   but not malicious; an unsigned one with the same code path will be
   quarantined.
5. **AV smoke-test.** Before shipping: run installer through Windows
   Defender, Bitdefender, Kaspersky, ESET on a clean VM. Note any
   detections. Submit false-positive reports if needed.
6. **Documentation.** README needs a clear paragraph about what the
   keyboard hook does, when it runs, and that no keystrokes leave the
   user's machine. Users on managed corporate machines may find their
   IT blocks LL hooks at the OS policy level — that's their boundary,
   not Natively's.

---

## 9. Test plan

### Unit / integration (run on dev machine)
- TS-side `WindowsKeyboardHook` exposes a no-op on non-Windows; assert
  `start()`/`stop()` are safe no-ops.
- Idle timer: simulate a single `start()` → no key events → `stop()`
  should fire within 5.5s.

### Manual on Windows 11 (real hardware)

**Phase 1 (non-activating overlay):**
- [ ] Repro test page logs no events when clicking between browser and overlay in undetectable mode.
- [ ] Toggle undetectable OFF → events resume.
- [ ] Cmd+B / Ctrl+B toggle still works.
- [ ] Opacity Shield (content-protection branch) still hides DWM artifacts.
- [ ] Launcher window unaffected.

**Phase 2 (type mode):**
- [ ] Press Ctrl+Shift+Space while browser is foreground → "typing…" indicator appears.
- [ ] Type "hello world" → renders in overlay's input field.
- [ ] Browser does NOT receive the keystrokes.
- [ ] `WindowFocusEvents.html` page does NOT fire `blur` while typing.
- [ ] `Enter` submits + ends type mode.
- [ ] `Esc` cancels + ends type mode.
- [ ] 5s idle → auto-ends.
- [ ] After type-mode ends, normal typing in the browser works again.
- [ ] Run AV smoke-test on Windows Defender minimum.

**Sanity (run on macOS dev machine):**
- [ ] `npm run build:native` succeeds.
- [ ] No regressions to existing macOS stealth (overlay focusable, hotkeys, dock hide).

### Repro page
- https://www.proginosko.com/test/WindowFocusEvents.html — primary
- https://document-policy-feedback.glitch.me/ — secondary if available
- Optional: write a small local HTML that logs any `blur`/`focus` to console
  for quicker iteration.

---

## 10. Risks & open questions

- **IME users.** Phase 2 v1 cannot type via IME. Decide: ship without and
  document, or block on Phase 4 IME work?
- **Modifier-key UX.** What does Alt+Tab do while the hook is active? It's
  swallowed. The 5s idle timer mitigates user confusion, but consider an
  explicit "always pass through window-management keys" allow-list inside
  the hook.
- **Multi-monitor / RDP.** LL hooks behave subtly differently inside RDP
  sessions. Test on at least one RDP target.
- **Nesting.** What if the user enters type mode while the launcher (not
  overlay) is the active window? Decide: refuse, or also send the keys to
  the launcher's input.
- **Settings UI.** Add a toggle in `SettingsOverlay.tsx` for "Enable type
  mode in undetected" with a clear explainer paragraph and a default of
  ON. Some users may want to disable it for AV reasons.
- **macOS parity question.** Should macOS also gain a type-mode for symmetry?
  Current macOS uses a different stealth path (dock hide + content protection
  + level=floating) and isn't subject to the same focus-detectability bug.
  Defer.

---

## 11. Milestones / ordering

| # | Milestone | Estimate | Closes |
|---|-----------|----------|--------|
| 1 | Phase 1 — non-activating overlay (TS only) | 1–2h | #225 repro |
| 2 | Phase 2a — native LL hook + tsfn dispatch (Rust) | 4–8h | — |
| 3 | Phase 2b — TS bridge + IPC + renderer integration | 2–4h | — |
| 4 | Phase 2c — settings toggle + AV smoke-test | 1–2h | — |
| 5 | Phase 3 — passive raw-input observer (optional) | 4–6h | — |

Total Phase 1+2: ~1 working day on Windows. Phase 1 alone is ship-able
the same day.

---

## 12. PR strategy

- **PR 1** — Phase 1 only. Title: `fix(stealth/win32): non-activating overlay in undetected mode (closes #225)`. Small diff, easy review, ships the literal fix.
- **PR 2** — Phase 2 native + bridge. Title: `feat(stealth/win32): opt-in keyboard hook for type-while-undetected`. Larger diff, includes the AV-posture README change.
- **PR 3** — Phase 3 if/when needed.

Branch naming follows existing repo convention (`fix/issue-225-…`,
`feat/win32-type-mode`).

---

## 13. References

- Issue: https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/issues/225
- Repro page: https://www.proginosko.com/test/WindowFocusEvents.html
- `windows` crate docs: https://microsoft.github.io/windows-docs-rs/doc/windows/
- WH_KEYBOARD_LL: https://learn.microsoft.com/windows/win32/winmsg/lowlevelkeyboardproc
- Raw Input (RIDEV_INPUTSINK): https://learn.microsoft.com/windows/win32/inputdev/about-raw-input
- WS_EX_NOACTIVATE: https://learn.microsoft.com/windows/win32/winmsg/extended-window-styles
- Existing repo prior art for napi + windows crate: `native-module/Cargo.toml`, `native-module/src/speaker/` (Windows audio path).

---

*Saved 2026-05-03. Resume on Windows machine. Phase 1 is independent — ship it first.*
