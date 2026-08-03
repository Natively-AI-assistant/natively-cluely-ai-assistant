//! Windows stealth keyboard interception via a WH_KEYBOARD_LL low-level hook.
//!
//! # What this is (and why)
//!
//! This is the Windows counterpart of `keyboard_tap.rs` (macOS CGEventTap). It
//! exposes the SAME napi surface — a `StealthKeyboardTap` class with
//! `start`/`stop`/`update_overlay_bounds`/`is_active` plus a free
//! `is_accessibility_granted()` — so `StealthKeyboardManager` (JS) and the
//! renderer's `stealth-key-captured` contract are byte-for-byte identical
//! across platforms. The renderer never learns which OS produced a keystroke.
//!
//! On macOS an NSPanel can become the keyboard-receiving ("key") window WITHOUT
//! activating the app, so clicking the overlay input types with no focus shift.
//! Windows has no equivalent: a window either is foreground (steals focus →
//! the meeting app fires blur) or it receives no `WM_KEYDOWN` at all. The only
//! way to type into the overlay without stealing focus is to siphon keystrokes
//! at the OS input layer and inject the characters into the renderer — exactly
//! what the macOS tap does. `SetWindowsHookEx(WH_KEYBOARD_LL)` is that layer.
//!
//! # Activation model (identical to macOS)
//!
//! Opt-in per session, driven entirely from JS (`StealthKeyboardManager`):
//!   1. User presses Ctrl+Shift+Space (globalShortcut) OR clicks the overlay
//!      input once a session is live → JS calls `start(callback)`.
//!   2. Each captured key fires `callback` with `{keyCode, chars, flags,
//!      isKeyDown}`. Plain typing keys are SWALLOWED (return 1 from the hook
//!      proc) so the foreground meeting app never receives them.
//!   3. JS calls `stop()` on Esc / Enter-submit / 10s idle / hotkey-again.
//!
//! Swallowing is unconditional while engaged, mirroring the macOS design note:
//! pass-through mode would just be a keylogger. The hook is therefore
//! short-lived — engaged only while the user is actively typing into Natively.
//!
//! # keyCode contract with the renderer
//!
//! `NativelyInterface.tsx` hardcodes macOS HID virtual keycodes (53=Esc,
//! 36=Return, 76=NumpadEnter, 51=Backspace) and expects Tab (48) + arrows
//! (123-126) + F-keys + any system-modifier combo to be PASSED THROUGH (never
//! delivered). We translate Windows VK codes to those mac HID codes and apply
//! the same pass-through filter, so the JS switch statement works unchanged.
//!
//! # Threading
//!
//! `WH_KEYBOARD_LL` is a global hook whose callback runs on the thread that
//! installed it, and that thread MUST pump a message loop or the callback
//! never fires. We spawn a dedicated worker thread, install the hook there,
//! and block on `GetMessageW`. `stop()` posts `WM_QUIT` to the worker via
//! `PostThreadMessageW`, the loop exits, we unhook, and the thread joins.
//!
//! The LowLevelKeyboardProc has NO user-data parameter (unlike CGEventTap), so
//! the shared state is reached through a process-global `Mutex<Option<...>>`.
//! Only one tap is ever active at a time (single overlay), so a global is the
//! natural fit.

#![cfg(target_os = "windows")]

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use once_cell::sync::Lazy;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HINSTANCE, HMODULE, HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{GetCurrentProcessId, GetCurrentThreadId};
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetKeyState, ToUnicodeEx, VIRTUAL_KEY, VK_CAPITAL, VK_CONTROL, VK_LWIN,
    VK_MENU, VK_RWIN, VK_SHIFT,
};
// HKL (keyboard layout handle) lives under TextServices, not KeyboardAndMouse.
use windows::Win32::UI::TextServices::HKL;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetAncestor, GetMessageW, GetWindowThreadProcessId,
    PostThreadMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, WindowFromPoint,
    EVENT_SYSTEM_FOREGROUND, GA_ROOT, HHOOK, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT,
    WH_KEYBOARD_LL, WH_MOUSE_LL, WINEVENT_OUTOFCONTEXT, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN,
    WM_MBUTTONDOWN, WM_QUIT, WM_RBUTTONDOWN, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN,
};

// ─── napi objects shared with the macOS module's JS surface ──────────────────
//
// These mirror keyboard_tap.rs EXACTLY (same field names/types) so the emitted
// TypeScript and the JS callers are identical. On Windows the keyboard_tap
// module is cfg'd out, so defining them here creates no duplicate-symbol clash.

/// Overlay bounds accepted for API parity with macOS. Windows does not wire an
/// outside-click stop (neither does the shipped macOS build — its bounds
/// provider is never registered), so these are accepted and ignored.
#[napi(object)]
pub struct OverlayBoundsInput {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Event payload delivered to the JS callback. Flat, matching macOS.
#[napi(object)]
pub struct CapturedKey {
    /// macOS HID virtual keycode (53=Esc, 36=Return, 76=NumpadEnter,
    /// 51=Backspace). Translated from the Windows VK so the renderer's
    /// hardcoded switch works unchanged. 0 for ordinary printable keys.
    pub key_code: u32,
    /// The character(s) this key produces under the active layout + modifiers
    /// (via ToUnicodeEx). Empty for non-printable keys.
    pub chars: String,
    /// Modifier bitmask using the SAME bit layout the macOS tap emits
    /// (cmd=1<<20, opt=1<<19, ctrl=1<<18, shift=1<<17, capsLock=1<<16) so the
    /// renderer can decode identically. We only ever set shift/caps here
    /// because modifier combos are passed through (see the filter below).
    pub flags: u32,
    /// True for keyDown, false for keyUp. The renderer only acts on keyDown.
    pub is_key_down: bool,
    /// True when the user has left Natively and stealth must stop: a click on
    /// another process's window (mouse hook) or a foreground switch such as
    /// Alt+Tab (WinEvent hook). StealthKeyboardManager turns this into stop().
    /// Named for the macOS field it mirrors; on Windows it covers both triggers.
    pub is_outside_mouse_down: bool,
}

// macOS CGEventFlags bits the renderer decodes. We reuse the SHIFT/CAPS bits.
const MAC_FLAG_SHIFT: u32 = 1 << 17;
const MAC_FLAG_CAPS: u32 = 1 << 16;

// ─── Shared hook state ───────────────────────────────────────────────────────

struct HookState {
    /// True while the hook is installed and swallowing keys.
    active: AtomicBool,
    /// Worker thread id, for PostThreadMessageW(WM_QUIT) from stop().
    worker_thread_id: AtomicU32,
    /// Threadsafe callback into V8. Set on start(), cleared on stop().
    callback: Mutex<Option<Arc<ThreadsafeFunction<CapturedKey>>>>,
}

impl HookState {
    fn new() -> Self {
        Self {
            active: AtomicBool::new(false),
            worker_thread_id: AtomicU32::new(0),
            callback: Mutex::new(None),
        }
    }
}

/// The single in-flight hook's state, reachable from the C hook proc (which
/// has no user-data pointer). `None` when no tap is engaged. Set by the worker
/// thread just before installing the hook, cleared after it unhooks.
static ACTIVE_HOOK: Lazy<Mutex<Option<Arc<HookState>>>> = Lazy::new(|| Mutex::new(None));

// ─── The low-level keyboard hook procedure ───────────────────────────────────
//
// Runs on the worker thread's message loop for every key event, system-wide.
// Must return promptly (Windows drops slow LL hooks after LowLevelHooksTimeout,
// ~300ms). We do no blocking work: the tsfn.call is non-blocking (queues onto
// V8 and returns).
unsafe extern "system" fn keyboard_hook_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // HC_ACTION == 0. Negative codes must be passed straight through per the
    // Win32 contract; codes other than HC_ACTION carry no actionable struct.
    if code != 0 {
        return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
    }

    // Snapshot the shared state (clone the Arc under a brief lock, then drop the
    // lock before doing any work / calling into V8) so stop() on another thread
    // can't deadlock against us.
    let state = {
        let guard = match ACTIVE_HOOK.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard.as_ref().map(Arc::clone)
    };
    let Some(state) = state else {
        return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
    };
    if !state.active.load(Ordering::Acquire) {
        return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
    }

    let msg = wparam.0 as u32;
    let is_key_down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
    let is_key_up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
    if !is_key_down && !is_key_up {
        return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
    }

    let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
    let vk = kb.vkCode;
    let scan = kb.scanCode;

    // ── PASS-THROUGH FILTER (mirrors keyboard_tap.rs R3/R4) ──
    // Any system-modifier combo (Ctrl / Alt / Win), F-keys, Tab and arrows are
    // returned to the OS so system shortcuts and focus-cycling keep working and
    // the renderer only ever sees plain text keys + Enter + Backspace + Esc.
    if modifier_held(VK_CONTROL) || modifier_held(VK_MENU) || win_held() {
        return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
    }
    if is_passthrough_vk(vk) {
        return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
    }

    // Translate to the macOS HID keycode the renderer expects, or 0 for keys
    // whose identity the renderer reads from `chars` instead of `keyCode`.
    let key_code = vk_to_mac_keycode(vk);

    // Shift / CapsLock are the only modifiers that can reach here (combos with
    // Ctrl/Alt/Win were passed through above). Encode them in the mac bit
    // layout for completeness; `chars` already reflects their effect.
    let mut flags = 0u32;
    if modifier_held(VK_SHIFT) {
        flags |= MAC_FLAG_SHIFT;
    }
    if caps_lock_on() {
        flags |= MAC_FLAG_CAPS;
    }

    // Printable characters via the active keyboard layout (handles Shift,
    // CapsLock, and layout-specific keys). Non-printable keys yield "".
    let chars = if key_code == 0 {
        unicode_for_key(vk, scan)
    } else {
        // Enter/Backspace/Esc: the renderer keys off key_code, not chars.
        String::new()
    };

    // Send BOTH keydown and keyup (renderer filters on isKeyDown), matching
    // the macOS tap so the cross-platform contract is identical.
    send_payload(&state, CapturedKey {
        key_code,
        chars,
        flags,
        is_key_down,
        is_outside_mouse_down: false,
    });

    // Swallow: the foreground meeting app never sees this keystroke.
    LRESULT(1)
}

// ─── The low-level MOUSE hook procedure ──────────────────────────────────────
//
// Runs alongside the keyboard hook while stealth typing is engaged. Its ONLY
// job is to detect a click that lands OUTSIDE every Natively window and stop
// the session — the Windows equivalent of the macOS tap's isOutsideMouseDown.
// Without it, because the keyboard hook swallows keys process-wide, a user who
// clicks back into their meeting app could not type there until Esc / 10s idle.
//
// Clicks are NEVER swallowed (always CallNextHookEx) — the click itself must
// reach whatever the user clicked. We only classify inside-vs-outside.
//
// DPI-free by design: rather than compare cursor coordinates (physical pixels)
// against the overlay's DIP bounds, we ask which window is under the cursor and
// whether it belongs to OUR process. Clicking any Natively window (overlay,
// pill, toggle, settings, model selector) keeps the session; clicking any other
// process's window — or empty desktop — stops it.
unsafe extern "system" fn mouse_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code != 0 {
        return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
    }

    // Only button-DOWN events matter; ignore moves / wheels / button-ups.
    let msg = wparam.0 as u32;
    let is_button_down = matches!(
        msg,
        WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN
    );
    if !is_button_down {
        return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
    }

    let state = {
        let guard = match ACTIVE_HOOK.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard.as_ref().map(Arc::clone)
    };
    let Some(state) = state else {
        return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
    };
    if !state.active.load(Ordering::Acquire) {
        return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
    }

    // Screen-space click point from the hook struct.
    let pt: POINT = (*(lparam.0 as *const MSLLHOOKSTRUCT)).pt;
    let outside = !window_belongs_to_us(WindowFromPoint(pt));

    if outside {
        send_payload(
            &state,
            CapturedKey {
                key_code: 0,
                chars: String::new(),
                flags: 0,
                is_key_down: false,
                is_outside_mouse_down: true,
            },
        );
    }

    // Never swallow the click.
    CallNextHookEx(HHOOK::default(), code, wparam, lparam)
}

/// True if `hwnd` (or its root top-level window) belongs to THIS process — i.e.
/// it is one of Natively's windows.
///
/// The GA_ROOT walk matters: WindowFromPoint can return a Chromium child HWND
/// (Chrome_RenderWidgetHostHWND) whose owning process differs from the main
/// process in some Electron versions. The root BrowserWindow HWND is always
/// owned by the main process where this native module runs. Without the walk,
/// clicking the overlay input could read as "not ours" and stop stealth on the
/// very click that engages typing.
///
/// SAFETY: pure Win32 queries on a possibly-stale HWND; both calls are
/// null/invalid tolerant.
unsafe fn window_belongs_to_us(hwnd: HWND) -> bool {
    // HWND(0) = no window (empty desktop, or a destroyed window).
    if hwnd.0 == 0 {
        return false;
    }
    let root = GetAncestor(hwnd, GA_ROOT);
    let target = if root.0 != 0 { root } else { hwnd };
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(target, Some(&mut pid as *mut u32));
    pid != 0 && pid == GetCurrentProcessId()
}

// ─── Foreground-change hook (Alt+Tab and friends) ────────────────────────────
//
// The mouse hook only sees CLICKS. The user can also leave via the keyboard —
// Alt+Tab, Win+Tab, Win+D — and those combos are deliberately passed through by
// the keyboard hook's system-modifier filter, so no click ever happens. Without
// this, stealth would stay engaged after Alt+Tab and keep swallowing keystrokes
// system-wide: the user would type into their newly focused app and the text
// would silently land in Natively's chatbox instead.
//
// macOS gets this for free: when another app activates, the nonactivating panel
// resigns key and typing goes to the new app. This WinEvent hook is the
// equivalent — any foreground change to a window that is not ours stops the
// session.
//
// WINEVENT_OUTOFCONTEXT delivers the callback on the installing thread via its
// message queue, which the worker already pumps (GetMessageW/DispatchMessageW).
unsafe extern "system" fn foreground_event_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if event != EVENT_SYSTEM_FOREGROUND {
        return;
    }
    let state = {
        let guard = match ACTIVE_HOOK.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard.as_ref().map(Arc::clone)
    };
    let Some(state) = state else { return };
    if !state.active.load(Ordering::Acquire) {
        return;
    }
    // The overlay is WS_EX_NOACTIVATE so it never becomes foreground; any
    // foreground change is therefore a real app switch. Still check ownership
    // explicitly so activating a Natively window (e.g. the launcher) doesn't
    // end the session.
    if window_belongs_to_us(hwnd) {
        return;
    }
    send_payload(
        &state,
        CapturedKey {
            key_code: 0,
            chars: String::new(),
            flags: 0,
            is_key_down: false,
            // Reuse the existing stop signal: StealthKeyboardManager already
            // calls stop() on isOutsideMouseDown, and reusing it keeps the
            // captured-key payload byte-identical across platforms (no JS or
            // macOS change needed for a Windows-only trigger).
            is_outside_mouse_down: true,
        },
    );
}

fn send_payload(state: &HookState, payload: CapturedKey) {
    // Clone the tsfn Arc under the lock, drop the lock, then call — same
    // deadlock-avoidance pattern as the macOS module.
    let tsfn = {
        let guard = match state.callback.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard.as_ref().map(Arc::clone)
    };
    if let Some(tsfn) = tsfn {
        tsfn.call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking);
    }
}

#[inline]
fn modifier_held(vk: VIRTUAL_KEY) -> bool {
    // GetAsyncKeyState, NOT GetKeyState: this hook runs on a worker thread that
    // never processes the key messages, so GetKeyState there is stale. The
    // async (real-time hardware) state is set at the raw-input layer BEFORE the
    // hook decides to swallow the key, so it correctly reflects held modifiers.
    // High-order bit (0x8000) = currently down.
    (unsafe { GetAsyncKeyState(vk.0 as i32) } as u16 & 0x8000) != 0
}

#[inline]
fn caps_lock_on() -> bool {
    // Toggle state (low bit) of CapsLock. This is a global lock state the
    // system keeps synchronized, so the per-thread GetKeyState toggle bit is
    // the pragmatic read here (GetAsyncKeyState carries no toggle state).
    (unsafe { GetKeyState(VK_CAPITAL.0 as i32) } & 0x0001) != 0
}

#[inline]
fn win_held() -> bool {
    modifier_held(VK_LWIN) || modifier_held(VK_RWIN)
}

/// VK codes we pass through untouched, matching the macOS whitelist intent:
/// Tab, the four arrows, and F1–F24. (Esc/Enter/Backspace are NOT here — those
/// are delivered to the renderer with a translated keyCode.)
fn is_passthrough_vk(vk: u32) -> bool {
    const VK_TAB: u32 = 0x09;
    const VK_LEFT: u32 = 0x25;
    const VK_UP: u32 = 0x26;
    const VK_RIGHT: u32 = 0x27;
    const VK_DOWN: u32 = 0x28;
    const VK_F1: u32 = 0x70;
    const VK_F24: u32 = 0x87;
    matches!(vk, VK_TAB | VK_LEFT | VK_UP | VK_RIGHT | VK_DOWN)
        || (VK_F1..=VK_F24).contains(&vk)
}

/// Map a Windows VK to the macOS HID keycode the renderer switch expects.
/// Returns 0 for keys the renderer identifies via `chars` (ordinary text).
fn vk_to_mac_keycode(vk: u32) -> u32 {
    const VK_BACK: u32 = 0x08;
    const VK_RETURN: u32 = 0x0D;
    const VK_ESCAPE: u32 = 0x1B;
    match vk {
        VK_ESCAPE => 53,
        VK_RETURN => 36, // Enter (numpad Enter also reports VK_RETURN via LL hook)
        VK_BACK => 51,   // Backspace
        _ => 0,
    }
}

/// Resolve the character(s) a key produces under the current layout, using the
/// foreground window's keyboard layout and a synthesized modifier key-state.
///
/// We build the 256-byte key-state array ourselves from live GetKeyState reads
/// for Shift/CapsLock rather than GetKeyboardState(), because a low-level hook
/// runs outside the foreground input queue and GetKeyboardState there does not
/// reliably reflect the real-time modifier state.
///
/// `ToUnicodeEx` is called with wFlags bit 2 (0x4) set — "do not change the
/// kernel keyboard state" (Windows 10 1607+) — so probing a dead key here does
/// not corrupt the foreground app's subsequent composition.
fn unicode_for_key(vk: u32, scan: u32) -> String {
    let mut key_state = [0u8; 256];
    // Only the modifiers that survive the pass-through filter matter for text.
    if modifier_held(VK_SHIFT) {
        key_state[VK_SHIFT.0 as usize] = 0x80;
    }
    if caps_lock_on() {
        key_state[VK_CAPITAL.0 as usize] = 0x01;
    }

    // NULL HKL → ToUnicodeEx uses the calling thread's active layout. Deriving
    // the foreground thread's layout is more correct but adds FFI surface; the
    // default is acceptable for v1. Dead-key/AltGr text is out of scope (those
    // combos are passed through by the modifier filter above).
    let hkl = HKL::default();

    let mut buf = [0u16; 8];
    // wFlags = 0x4 → do not alter kernel keyboard state (preserve dead keys).
    let n = unsafe { ToUnicodeEx(vk, scan, &key_state, &mut buf, 0x4, hkl) };
    if n <= 0 {
        // 0 = no translation; <0 = dead key (no standalone char to emit).
        return String::new();
    }
    let n = (n as usize).min(buf.len());
    String::from_utf16_lossy(&buf[..n])
}

// ─── Worker thread: installs the hook and pumps messages ─────────────────────

fn hook_worker(state: Arc<HookState>, ready_tx: mpsc::Sender<bool>) {
    // Publish this thread's id so stop() can PostThreadMessageW(WM_QUIT).
    let tid = unsafe { GetCurrentThreadId() };
    state.worker_thread_id.store(tid, Ordering::Release);

    // Register the shared state BEFORE installing the hook so the very first
    // callback (which can fire immediately) can find it.
    {
        let mut guard = match ACTIVE_HOOK.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        *guard = Some(state.clone());
    }

    // hmod: the module containing the hook proc. For a WH_KEYBOARD_LL hook the
    // proc lives in this module; passing our own module handle is the documented
    // form (GetModuleHandle(NULL) = the running .exe). HMODULE → HINSTANCE via
    // the From impl. Fall back to NULL on the unlikely GetModuleHandleW error.
    let hmod: HINSTANCE = unsafe { GetModuleHandleW(PCWSTR::null()) }
        .map(HINSTANCE::from)
        .unwrap_or_default();

    let hook = match unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), hmod, 0) }
    {
        Ok(h) => h,
        Err(e) => {
            // Most likely cause in the wild: security software / corporate EDR
            // blocking global keyboard hooks. Report the failure to start() so
            // it returns false and JS never shows an "engaged" state that would
            // silently capture nothing.
            eprintln!("[keyboard_hook_windows] SetWindowsHookExW failed: {e:?}");
            state.active.store(false, Ordering::Release);
            state.worker_thread_id.store(0, Ordering::Release);
            let mut guard = ACTIVE_HOOK.lock().unwrap_or_else(|p| p.into_inner());
            *guard = None;
            let _ = ready_tx.send(false);
            return;
        }
    };

    // Also install the low-level MOUSE hook for outside-click stop. NON-FATAL:
    // if it fails, keyboard stealth still works; the user just loses the
    // click-away auto-stop (Esc / 10s idle / hotkey still disengage).
    let mouse_hook = match unsafe {
        SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), hmod, 0)
    } {
        Ok(h) => Some(h),
        Err(e) => {
            eprintln!("[keyboard_hook_windows] WH_MOUSE_LL install failed (outside-click stop disabled): {e:?}");
            None
        }
    };

    // Foreground-change hook: stops the session on Alt+Tab / Win+Tab / any app
    // switch that happens without a click. NON-FATAL, same as the mouse hook.
    // hmod must be NULL for an out-of-context WinEvent hook.
    let fg_hook = unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            HMODULE::default(),
            Some(foreground_event_proc),
            0, // all processes
            0, // all threads
            WINEVENT_OUTOFCONTEXT,
        )
    };
    if fg_hook.0 == 0 {
        eprintln!(
            "[keyboard_hook_windows] SetWinEventHook failed (Alt+Tab auto-stop disabled)"
        );
    }

    // The keyboard hook is installed — tell start() it may report success. Sent
    // BEFORE the blocking message loop below.
    let _ = ready_tx.send(true);

    // Message pump: REQUIRED for the LL hook to fire. GetMessageW blocks until
    // stop() posts WM_QUIT (returns 0) or an error (returns -1).
    let mut msg = MSG::default();
    loop {
        // HWND::default() (NULL) → retrieve messages for any window of THIS
        // thread, which is where the WM_QUIT posted by stop() lands.
        let r = unsafe { GetMessageW(&mut msg, HWND::default(), 0, 0) };
        if r.0 <= 0 {
            // 0 = WM_QUIT, -1 = error. Either way, exit the loop and unhook.
            break;
        }
        unsafe {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        if !state.active.load(Ordering::Acquire) {
            break;
        }
    }

    // Cleanup: unhook all three, then clear the global so no stray callback can
    // run against a state we are about to drop.
    unsafe {
        let _ = UnhookWindowsHookEx(hook);
        if let Some(mh) = mouse_hook {
            let _ = UnhookWindowsHookEx(mh);
        }
        if fg_hook.0 != 0 {
            let _ = UnhookWinEvent(fg_hook);
        }
    }
    {
        let mut guard = ACTIVE_HOOK.lock().unwrap_or_else(|p| p.into_inner());
        // Only clear if it's still OUR state (a fast stop→start could have
        // installed a new one; guard against nuking it).
        if let Some(cur) = guard.as_ref() {
            if Arc::ptr_eq(cur, &state) {
                *guard = None;
            }
        }
    }
    state.worker_thread_id.store(0, Ordering::Release);
    state.active.store(false, Ordering::Release);
}

// ─── Public N-API: identical surface to the macOS StealthKeyboardTap ─────────

/// Windows needs no OS permission for a WH_KEYBOARD_LL hook (unlike macOS
/// Accessibility). Always true so the JS permission flow no-ops.
#[napi]
pub fn is_accessibility_granted() -> bool {
    true
}

#[napi]
pub struct StealthKeyboardTap {
    state: Arc<HookState>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

#[napi]
impl StealthKeyboardTap {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: Arc::new(HookState::new()),
            worker: Mutex::new(None),
        }
    }

    /// Engage the hook. Every plain-text keystroke fires `callback` and is
    /// swallowed from the foreground app. `overlay_bounds` is accepted for
    /// cross-platform parity and ignored (no outside-click stop on Windows,
    /// matching the shipped macOS build). Idempotent while active.
    #[napi]
    pub fn start(
        &self,
        callback: ThreadsafeFunction<CapturedKey>,
        _overlay_bounds: Option<OverlayBoundsInput>,
    ) -> Result<bool> {
        if self.state.active.load(Ordering::Acquire) {
            return Ok(true);
        }

        // Join any prior worker still winding down before publishing active,
        // so its cleanup store(false) can't race our store(true).
        let prev = self.worker.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(h) = prev {
            let _ = h.join();
        }

        self.state.active.store(true, Ordering::Release);
        *self.state.callback.lock().unwrap_or_else(|p| p.into_inner()) = Some(Arc::new(callback));

        // Confirm the hook actually installs before reporting success. Without
        // this, start() returns true the moment the thread spawns, so a hook
        // blocked by EDR would leave JS showing "stealth engaged" while keys go
        // nowhere. The worker sends true once SetWindowsHookExW succeeds (before
        // its blocking message loop) or false on failure.
        let (ready_tx, ready_rx) = mpsc::channel::<bool>();
        let state = self.state.clone();
        let handle = thread::Builder::new()
            .name("natively-keyboard-hook".into())
            .spawn(move || hook_worker(state, ready_tx))
            .map_err(|e| {
                self.state.active.store(false, Ordering::Release);
                *self.state.callback.lock().unwrap_or_else(|p| p.into_inner()) = None;
                Error::new(
                    Status::GenericFailure,
                    format!("failed to spawn keyboard-hook worker: {e}"),
                )
            })?;

        // SetWindowsHookExW is fast; 2s is a generous ceiling. On success keep
        // the worker (stop() joins it later). On failure/timeout roll back so
        // no false "engaged" state persists.
        match ready_rx.recv_timeout(Duration::from_secs(2)) {
            Ok(true) => {
                *self.worker.lock().unwrap_or_else(|p| p.into_inner()) = Some(handle);
                Ok(true)
            }
            Ok(false) => {
                // Worker reported an install failure and has already returned.
                self.state.active.store(false, Ordering::Release);
                let _ = handle.join();
                *self.state.callback.lock().unwrap_or_else(|p| p.into_inner()) = None;
                Ok(false)
            }
            Err(_) => {
                // Timeout or the worker died before signalling. Don't block on
                // join(); best-effort ask it to quit and detach the handle.
                self.state.active.store(false, Ordering::Release);
                let tid = self.state.worker_thread_id.load(Ordering::Acquire);
                if tid != 0 {
                    unsafe {
                        let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
                    }
                }
                drop(handle);
                *self.state.callback.lock().unwrap_or_else(|p| p.into_inner()) = None;
                Ok(false)
            }
        }
    }

    /// No-op on Windows (accepted for API parity — see `start`).
    #[napi]
    pub fn update_overlay_bounds(&self, _overlay_bounds: Option<OverlayBoundsInput>) {}

    /// Disengage the hook. Safe to call when inactive. After this returns the
    /// next keystroke reaches the foreground app normally.
    #[napi]
    pub fn stop(&self) {
        if !self.state.active.swap(false, Ordering::AcqRel) {
            return;
        }
        // Wake the worker's GetMessageW loop so it unhooks and exits.
        let tid = self.state.worker_thread_id.load(Ordering::Acquire);
        if tid != 0 {
            unsafe {
                let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        }
        // Drop the JS callback so V8 can GC it.
        *self.state.callback.lock().unwrap_or_else(|p| p.into_inner()) = None;

        // Wait for the worker to finish unhooking (so a fast start() after this
        // installs cleanly and the WM_KEYBOARD_LL hook is provably removed).
        let handle = self.worker.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(h) = handle {
            let join_start = std::time::Instant::now();
            if let Err(e) = h.join() {
                eprintln!("[keyboard_hook_windows] worker panicked during cleanup: {e:?}");
            }
            let ms = join_start.elapsed().as_millis();
            if ms > 100 {
                eprintln!("[keyboard_hook_windows] stop() join took {ms}ms");
            }
        }
    }

    #[napi(getter)]
    pub fn is_active(&self) -> bool {
        self.state.active.load(Ordering::Acquire)
    }
}

impl Default for StealthKeyboardTap {
    fn default() -> Self {
        Self::new()
    }
}
