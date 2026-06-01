//! Session-wide stealth keyboard interception via CGEventTap.
//!
//! # What this is
//!
//! A CGEventTap is the macOS mechanism for sitting in the OS keyboard event
//! pipeline BEFORE events reach the foreground app. We use the session-level
//! tap (`kCGSessionEventTap`) so we see every keystroke routed through the
//! login session, regardless of which app would otherwise receive it. While
//! the tap is active, our callback decides whether to swallow each event
//! (return null → event is destroyed and never delivered) or pass it through
//! (return the event → normal delivery).
//!
//! # Why we want this on top of NSPanel-nonactivating
//!
//! NSPanel + becomesKeyOnlyIfNeeded already prevents Natively from activating
//! the app when buttons are clicked or the input is focused. But for keystrokes
//! to reach our text input via the normal DOM pipeline, the panel still has to
//! become the OS-level "key window" — which causes a window-level focus shift
//! that some screen-share / focus-follower tools can detect. With CGEventTap,
//! Natively NEVER becomes the key window for keyboard input. The user's Zoom
//! call stays the key window of the frontmost app; we silently siphon
//! keystrokes off the wire and present them in the renderer.
//!
//! # Activation model
//!
//! The tap is opt-in per session. Caller pattern:
//!
//!   1. User presses an activation hotkey (handled at the JS layer via
//!      globalShortcut, which fires before the session event tap so the
//!      hotkey itself is consumed by Carbon and not seen by us).
//!   2. JS calls `StealthKeyboardTap.start(callback)` to engage the tap.
//!   3. Every key event fires the callback with `{keyCode, chars, flags,
//!      isKeyDown}`. The event is SWALLOWED — the foreground app does not
//!      receive it.
//!   4. JS calls `stop()` to disengage (typically on Esc, hotkey-again, or
//!      blur-by-mouse).
//!
//! Swallowing is unconditional while the tap is active. Pass-through mode
//! defeats the purpose (foreground app would still receive everything; this
//! would just be a keylogger). Simpler and safer to gate the tap's lifetime
//! at the JS layer than to negotiate per-event suppression.
//!
//! # Permission requirements
//!
//! `CGEventTapCreate` returns NULL unless the process has Accessibility
//! trust (System Settings → Privacy & Security → Accessibility). On first
//! `start()` without permission, we surface a `false` return; the caller
//! should invoke `request_accessibility_permission()` to show the system
//! prompt. After the user grants in System Settings, the app must be
//! restarted (macOS does not retroactively grant tap rights to a running
//! process).
//!
//! # Threading
//!
//! `CFRunLoopRun` blocks the calling thread. We spawn a dedicated worker
//! thread, create the tap inside it, attach to that thread's runloop, and
//! block on `CFRunLoopRun()` until `stop()` is called. `stop()` calls
//! `CFRunLoopStop` from the main thread (CFRunLoop is documented as
//! thread-safe for stop), the worker thread unblocks, releases the tap,
//! and exits.
//!
//! Callbacks land on the worker thread; we use napi-rs's
//! `ThreadsafeFunction` to marshal each captured event back to V8.

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};

use core_foundation::base::CFRelease;
use core_foundation::mach_port::{CFMachPortInvalidate, CFMachPortRef};
use core_foundation::runloop::{
    kCFRunLoopCommonModes, CFRunLoopAddSource, CFRunLoopGetCurrent, CFRunLoopRef,
    CFRunLoopRemoveSource, CFRunLoopRun, CFRunLoopSourceRef, CFRunLoopStop,
};

// ─── ApplicationServices FFI for Accessibility permission ────────────────
//
// These are not exposed by core-graphics or objc2-app-kit. Smallest possible
// FFI surface: the `kAXTrustedCheckOptionPrompt` constant is a CFStringRef,
// but we use the prompt-less variant by passing NULL options and check first,
// then call once with `prompt: true` if untrusted. The `prompt: true` path
// requires building a CFDictionary, which we skip for simplicity by using the
// well-known undocumented behavior: passing NULL is equivalent to "check, do
// not prompt." For the actual prompt we use the system-wide preference URL
// scheme via NSWorkspace from the JS side (cleaner and doesn't require us to
// own a CFDictionary just for one bool).
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

// ─── Public N-API: permission helpers ────────────────────────────────────

/// True if this process has Accessibility trust (required for CGEventTap).
/// Cheap; safe to poll from JS to drive UI state.
#[napi]
pub fn is_accessibility_granted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

// ─── CGEvent FFI extras core-graphics doesn't wrap nicely ────────────────
//
// CGEventKeyboardGetUnicodeString is the One True Way to get the typed
// character for a key event (handles dead keys, IME composition pre-edit
// state, layout-dependent characters). core-graphics 0.24 exposes it as
// `CGEvent::keyboard_get_unicode_string` but the method allocates and copies;
// we call the C entrypoint directly to avoid the per-event Vec churn.
#[repr(C)]
#[derive(Copy, Clone)]
struct UniChar(u16);

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventKeyboardGetUnicodeString(
        event: *mut c_void,
        max_string_length: usize,
        actual_string_length: *mut usize,
        unicode_string: *mut UniChar,
    );

    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: unsafe extern "C" fn(*mut c_void, u32, *mut c_void, *mut c_void) -> *mut c_void,
        user_info: *mut c_void,
    ) -> CFMachPortRef;

    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);

    fn CFMachPortCreateRunLoopSource(
        allocator: *mut c_void,
        port: CFMachPortRef,
        order: isize,
    ) -> CFRunLoopSourceRef;
}

// ─── Tap state shared across worker thread + JS handle ───────────────────

/// Wrapper around CFRunLoopRef so we can stash it in shared state. CFRunLoop
/// pointers are thread-safe for `CFRunLoopStop` per Apple documentation; we
/// only ever read this field from the JS thread to call stop, never to
/// drive the runloop.
struct RunLoopHandle(CFRunLoopRef);
unsafe impl Send for RunLoopHandle {}
unsafe impl Sync for RunLoopHandle {}

#[derive(Clone, Copy)]
struct OverlayBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[napi(object)]
pub struct OverlayBoundsInput {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

struct TapState {
    /// True while the worker thread is alive and the tap is engaged.
    active: AtomicBool,
    /// Set by the worker thread once the tap is created and the runloop is
    /// running. Cleared on stop. JS-thread reads this to call CFRunLoopStop.
    runloop: Mutex<Option<RunLoopHandle>>,
    /// CFMachPortRef of the active tap, stored so the C callback can
    /// re-enable the tap when macOS disables it (TAP_DISABLED_BY_TIMEOUT or
    /// USER_INPUT). Atomic-storing as `usize` avoids the `Send`/`Sync`
    /// dance for raw `*mut`. Loaded with Acquire so the callback always
    /// sees a valid port after the worker publishes it.
    port: AtomicU64,
    /// Latest overlay bounds in global display coordinates. Mouse-down events
    /// outside this rect stop stealth typing while passing the click through.
    overlay_bounds: Mutex<Option<OverlayBounds>>,
    /// Threadsafe callback into V8. Set on start(), cleared on stop(). The
    /// option indirection lets stop() drop the tsfn handle so JS can GC the
    /// closure without keeping the worker thread's strong ref alive past
    /// stop.
    callback: Mutex<Option<Arc<ThreadsafeFunction<CapturedKey>>>>,
}

/// Event payload delivered to the JS callback. Crossing the V8 boundary is
/// not free, so we keep this struct flat (no nested objects) and only include
/// fields the renderer actually needs.
#[napi(object)]
pub struct CapturedKey {
    /// HID virtual keycode (e.g. 36 = Return, 51 = Delete, 53 = Esc). Stable
    /// across keyboard layouts; use for shortcut detection (Esc → exit mode).
    pub key_code: u32,
    /// The characters this key would type, given the active keyboard layout
    /// and any held dead keys. Empty string for non-printable keys (Esc,
    /// arrows, modifiers alone). Multi-char for IME composition or
    /// surrogate pairs.
    pub chars: String,
    /// Raw CGEventFlags bitmask (cmd=1<<20, opt=1<<19, ctrl=1<<18,
    /// shift=1<<17, capsLock=1<<16, fn=1<<23). Renderer can decode without
    /// us pre-splitting into bools.
    pub flags: u32,
    /// True for keyDown, false for keyUp. flagsChanged events are converted
    /// to keyDown=true (modifier press) or keyDown=false (modifier release)
    /// by the worker.
    pub is_key_down: bool,
    /// True for a pass-through mouse down outside the overlay bounds.
    pub is_outside_mouse_down: bool,
}

// ─── The C callback CGEventTap calls for every keystroke ─────────────────

/// CGEventTap callback. Called from the worker thread's runloop for every
/// key event. We:
///   1. Re-check the active flag (defensive — tap may fire one more event
///      after stop() invalidates the port).
///   2. Extract the keycode, modifier flags, and unicode chars.
///   3. Marshal to JS via the threadsafe function.
///   4. Return null to swallow the event (kCGEventTapOptionDefault honors
///      the null-return convention for deletion).
///
/// SAFETY:
///   - `user_info` is the `*const TapState` we passed to CGEventTapCreate;
///     CFMachPort retains it for the tap's lifetime, so it outlives every
///     callback invocation.
///   - `event` is owned by the runloop; we MUST NOT release it. Returning
///     a non-null pointer hands it back; returning null deletes it.
///   - We never block in this callback (no synchronous JS calls); the tsfn
///     queues onto the V8 thread and returns immediately.
/// Marked `unsafe extern "C"` because:
///   - The C runtime invokes us through a function pointer with the
///     `extern "C"` calling convention; `unsafe` documents that we trust
///     the C-side contract (pointer validity, calling convention).
///   - A panic that crosses an `extern "C"` boundary is undefined behavior.
///     We wrap the entire body in `catch_unwind` and replace `.unwrap()`
///     calls on Mutexes (which panic on poison) with explicit handling so
///     a panic in one path can't propagate into the C runloop.
unsafe extern "C" fn tap_callback(
    _proxy: *mut c_void,
    event_type: u32,
    event: *mut c_void,
    user_info: *mut c_void,
) -> *mut c_void {
    // ── UAF guard, BEFORE catch_unwind ──
    // Promote the borrowed *const TapState into an Arc by manually managing
    // the refcount: clone via raw → Arc → temporary clone → forget the
    // original to avoid double-decrement. This bumps strong_count for the
    // duration of the callback so the worker thread can't drop the Arc
    // mid-execution.
    //
    // ROUND 2 FIX: this dance MUST happen outside catch_unwind. If a panic
    // fired between Arc::from_raw and forget(original), the local `original`
    // would drop during unwind, decrementing the C-owned refcount. The
    // worker's later cleanup Arc::from_raw would then operate on a count
    // that's one too low → premature drop → UAF on subsequent in-flight
    // callbacks. Doing the refcount math here means the only locals catch_unwind
    // can drop are the bumped clone (which we own) — never touches the C ref.
    //
    // These primitive pointer ops cannot panic, so doing them outside the
    // catch_unwind boundary is safe.
    let state: Arc<TapState> = unsafe {
        let raw = user_info as *const TapState;
        let original = Arc::from_raw(raw);
        let clone = original.clone();
        std::mem::forget(original); // user_info retains the original ref
        clone
    };

    // Now pass the already-bumped Arc into catch_unwind. If anything inside
    // panics (mutex poison, tsfn closure panic, slice bug), only the local
    // `state` clone drops as the unwind passes through — C refcount intact.
    // Better to leak one keystroke into the foreground app than to UB the
    // C runloop.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        tap_callback_inner(event_type, event, state)
    }));
    match result {
        Ok(p) => p,
        Err(_) => {
            eprintln!("[keyboard_tap] callback panicked; passing event through");
            event
        }
    }
}

fn tap_callback_inner(
    event_type: u32,
    event: *mut c_void,
    state: Arc<TapState>,
) -> *mut c_void {
    // CGEventType values: 10 = keyDown, 11 = keyUp, 12 = flagsChanged,
    // 0xFFFFFFFE = tapDisabledByTimeout, 0xFFFFFFFF = tapDisabledByUserInput.
    // The "disabled by timeout" event fires if our callback was too slow on a
    // prior call (>1s); we re-enable using the port stored in TapState.
    const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFFFFFE;
    const TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFFFFFF;

    if event_type == TAP_DISABLED_BY_TIMEOUT || event_type == TAP_DISABLED_BY_USER_INPUT {
        // The OS disabled our tap (most commonly: a prior callback exceeded
        // the 1s budget). Without re-enabling, the tap is dead — every
        // subsequent keystroke goes straight to the foreground app and
        // stealth typing silently breaks. We re-enable in-place using the
        // port handle the worker stored in TapState.
        let port = state.port.load(Ordering::Acquire) as CFMachPortRef;
        if !port.is_null() {
            unsafe { CGEventTapEnable(port, true) };
            eprintln!(
                "[keyboard_tap] tap was disabled (event_type={:#x}); re-enabled",
                event_type
            );
        }
        return event;
    }

    // Re-check active flag to guard against post-stop callback fires.
    if !state.active.load(Ordering::Acquire) {
        // Pass the event through if we're shutting down — better to leak a
        // keystroke into the foreground app than to swallow one after the
        // user thinks stealth mode is off.
        return event;
    }

    const LEFT_MOUSE_DOWN: u32 = 1;
    const RIGHT_MOUSE_DOWN: u32 = 3;
    const OTHER_MOUSE_DOWN: u32 = 25;

    if matches!(event_type, LEFT_MOUSE_DOWN | RIGHT_MOUSE_DOWN | OTHER_MOUSE_DOWN) {
        let bounds = {
            let guard = state.overlay_bounds.lock().unwrap_or_else(|p| p.into_inner());
            *guard
        };
        if let Some(bounds) = bounds {
            let point = unsafe { core_graphics_get_location(event) };
            if !point_in_bounds(point, bounds) {
                let payload = CapturedKey {
                    key_code: 0,
                    chars: String::new(),
                    flags: 0,
                    is_key_down: false,
                    is_outside_mouse_down: true,
                };
                send_payload_to_js(&state, payload);
            }
        }
        return event;
    }

    // Extract keystroke metadata. CGEventField::KEYBOARD_EVENT_KEYCODE = 9.
    let key_code = unsafe { core_graphics_get_int_field(event, 9) } as u32;
    let flags = unsafe { core_graphics_get_flags(event) };

    // ── PASS-THROUGH FILTER (R3) ──
    //
    // The previous design swallowed every captured event while the tap was
    // active. That broke macOS system shortcuts entirely: Cmd+Tab, Cmd+Q,
    // Cmd+Space (Spotlight), Cmd+H (hide), Cmd+`, volume/brightness keys,
    // media keys, F-keys — all eaten silently the moment the tap engaged.
    // User report: "shortcuts of the macbook aren't working when natively
    // meeting interface is active."
    //
    // Fix: only swallow plain typing keys. Pass through (return event) any
    // event with a system modifier (Cmd / Ctrl / Option / Fn), any F-key,
    // and any modifier-flagsChanged event. The OS routes those normally to
    // the foreground app while non-modified character keys still get routed
    // into Natively's input.
    //
    // Trade-off: Cmd+Backspace / Cmd+A / Cmd+Enter no longer reach the
    // renderer's switch statement. Plain Enter still submits (case 36),
    // plain Backspace still deletes (case 51), so the typing UX is intact.
    // Cmd+Enter as alternate submit is dropped in favor of system-shortcut
    // sanity — net win.
    const CMD: u32 = 1 << 20;
    const OPT: u32 = 1 << 19;
    const CTRL: u32 = 1 << 18;
    const FN: u32 = 1 << 23;
    const SYSTEM_MODIFIER_MASK: u32 = CMD | OPT | CTRL | FN;

    if (flags & SYSTEM_MODIFIER_MASK) != 0 {
        return event;
    }

    // F-keys: F1=122, F2=120, F3=99, F4=118, F5=96, F6=97, F7=98, F8=100,
    // F9=101, F10=109, F11=103, F12=111, F13=105, F14=107, F15=113.
    // ROUND 3 FIX (#3): added F16=106, F17=64, F18=79, F19=80, F20=90 —
    // extended Apple/Logitech keyboards bind these to media/launchpad/
    // app-switch by default; users would lose those bindings without this.
    // On most modern Macs F-keys are bound to brightness, Mission Control,
    // volume, media playback — eating them would feel completely broken.
    //
    // ROUND 4 FIX (#2): added Tab=48 + arrows=123-126. After Cmd+Tab the
    // user expects plain Tab to work in their newly-active app (focus-
    // cycle). Tab is rarely useful as text in a chat input — never as a
    // submit gesture — so passing it through is the right default. Same
    // rationale for arrow keys: they're navigation, not text.
    if matches!(
        key_code,
        48 | 64 | 79 | 80 | 90 | 96 | 97 | 98 | 99 | 100 | 101 | 103
            | 105 | 106 | 107 | 109 | 111 | 113 | 118 | 120 | 122
            | 123 | 124 | 125 | 126
    ) {
        return event;
    }

    // flagsChanged events (modifier press/release alone, e.g. tapping Shift).
    // Pass through so the OS sees the modifier — otherwise sticky-keys and
    // accessibility features break. We don't need to deliver these to the
    // renderer (it ignores keyUp/flagsChanged anyway via the isKeyDown guard).
    if event_type == 12 {
        return event;
    }

    // Pull unicode chars (handles layout, dead keys, IME). 8 UniChars is
    // enough for any single keystroke including surrogate pairs and IME
    // composition fragments; longer compositions would be unusual.
    let mut buf: [UniChar; 8] = [UniChar(0); 8];
    let mut actual_len: usize = 0;
    unsafe {
        CGEventKeyboardGetUnicodeString(event, buf.len(), &mut actual_len, buf.as_mut_ptr());
    }
    let chars: String = if actual_len == 0 {
        String::new()
    } else {
        // CGEventKeyboardGetUnicodeString returns the FULL composition length
        // in actual_len even when the buffer was truncated to max_string_length.
        // Long IME compositions (Korean Hangul, Japanese kanji) can exceed our
        // 8-UniChar buffer; without clamping, slice::from_raw_parts reads past
        // the stack frame — UB / crash / garbage chars. Truncating to buf.len()
        // loses the tail of the composition (rare, acceptable trade-off for
        // safety on a short fixed-size buffer).
        let n = actual_len.min(buf.len());
        let u16_slice: &[u16] =
            unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const u16, n) };
        String::from_utf16_lossy(u16_slice)
    };

    // flagsChanged (event_type == 12) is filtered out by the pass-through
    // above, so it cannot reach this point. keyDown=10, keyUp=11 are the
    // only remaining values we subscribe to. Any other value is unexpected
    // (event mask doesn't include it) — pass through defensively.
    //
    // ROUND 4 FIX (#8): log once per process when we see an unknown event
    // type. The event mask only subscribes to keyDown/keyUp/flagsChanged
    // so this branch should be unreachable, but if Apple ever changes the
    // tap to deliver synthetic events or new types, we want to know
    // (otherwise the event silently passes through and we'd never debug
    // why some captured-key path is missing). Using a static AtomicBool
    // keyed on the file scope so we don't spam logs.
    let is_key_down = match event_type {
        10 => true,  // keyDown
        11 => false, // keyUp
        _ => {
            static UNKNOWN_TYPE_LOGGED: AtomicBool = AtomicBool::new(false);
            if !UNKNOWN_TYPE_LOGGED.swap(true, Ordering::Relaxed) {
                eprintln!(
                    "[keyboard_tap] unexpected event_type={:#x} from CGEventTap; passing through",
                    event_type
                );
            }
            return event;
        }
    };

    let payload = CapturedKey {
        key_code,
        chars,
        flags,
        is_key_down,
        is_outside_mouse_down: false,
    };

    send_payload_to_js(&state, payload);

    // Return null → swallow. Foreground app does not see this keystroke.
    // `state` (the local Arc clone) drops here, decrementing the refcount
    // we bumped above. The worker-thread-owned Arc lives until cleanup.
    ptr::null_mut()
}

fn send_payload_to_js(state: &TapState, payload: CapturedKey) {
    // Lock-snapshot pattern: clone the Arc<ThreadsafeFunction> under the
    // lock, then drop the lock BEFORE calling tsfn. Without this, the
    // tsfn.call could trigger a re-entrant scenario (tsfn drop on JS-side
    // close, blocking napi callbacks) while we still hold the Mutex,
    // potentially deadlocking with the JS-thread `stop()` that's also
    // trying to lock to clear the callback.
    let tsfn_snapshot: Option<Arc<ThreadsafeFunction<CapturedKey>>> = {
        let cb_guard = match state.callback.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        cb_guard.as_ref().map(Arc::clone)
    };
    if let Some(tsfn) = tsfn_snapshot {
        tsfn.call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking);
    }
}

// Tiny FFI shims for CGEvent accessors that core-graphics 0.24 wraps in
// types we can't easily use from inside an extern "C" callback without
// taking ownership. Pulling them in via `core-graphics-sys` would also work
// but adds a dep we don't need elsewhere.
#[repr(C)]
#[derive(Copy, Clone)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    #[link_name = "CGEventGetIntegerValueField"]
    fn cge_get_int_field(event: *mut c_void, field: u32) -> i64;
    #[link_name = "CGEventGetFlags"]
    fn cge_get_flags(event: *mut c_void) -> u64;
    #[link_name = "CGEventGetLocation"]
    fn cge_get_location(event: *mut c_void) -> CGPoint;
}

#[inline]
unsafe fn core_graphics_get_int_field(event: *mut c_void, field: u32) -> i64 {
    cge_get_int_field(event, field)
}

#[inline]
unsafe fn core_graphics_get_flags(event: *mut c_void) -> u32 {
    // Flags fit in u32 in practice; high bits are reserved.
    cge_get_flags(event) as u32
}

#[inline]
unsafe fn core_graphics_get_location(event: *mut c_void) -> CGPoint {
    cge_get_location(event)
}

#[inline]
fn point_in_bounds(point: CGPoint, bounds: OverlayBounds) -> bool {
    point.x >= bounds.x
        && point.x < bounds.x + bounds.width
        && point.y >= bounds.y
        && point.y < bounds.y + bounds.height
}

// ─── Worker thread: owns the runloop while the tap is alive ──────────────

fn tap_worker(state: Arc<TapState>) {
    // Event mask: mouseDown variants + keyDown | keyUp | flagsChanged.
    // Mouse events are always passed through; they only cancel stealth mode.
    const EVENT_MASK: u64 =
        (1u64 << 1) | (1u64 << 3) | (1u64 << 25) | (1u64 << 10) | (1u64 << 11) | (1u64 << 12);

    // tap=kCGSessionEventTap(1), place=kCGHeadInsertEventTap(0),
    // options=kCGEventTapOptionDefault(0).
    let user_info = Arc::into_raw(state.clone()) as *mut c_void;
    let port: CFMachPortRef =
        unsafe { CGEventTapCreate(1, 0, 0, EVENT_MASK, tap_callback, user_info) };

    if port.is_null() {
        // CGEventTapCreate returned NULL → almost always Accessibility not
        // granted. Reclaim the Arc we leaked into user_info; the JS-side
        // active flag stays false, JS can re-poll.
        unsafe { Arc::from_raw(user_info as *const TapState) };
        state.active.store(false, Ordering::Release);
        eprintln!(
            "[keyboard_tap] CGEventTapCreate returned NULL — Accessibility \
             permission likely missing"
        );
        return;
    }

    // Attach the tap to this thread's runloop and enable it.
    let source: CFRunLoopSourceRef =
        unsafe { CFMachPortCreateRunLoopSource(ptr::null_mut(), port, 0) };
    let current_loop: CFRunLoopRef = unsafe { CFRunLoopGetCurrent() };
    unsafe { CFRunLoopAddSource(current_loop, source, kCFRunLoopCommonModes) };
    unsafe { CGEventTapEnable(port, true) };

    // Publish the port so the C callback can re-enable the tap if macOS
    // disables it (TAP_DISABLED_BY_TIMEOUT). Release-store pairs with the
    // Acquire-load in the callback. Done BEFORE stash-runloop so that if a
    // disable event fires immediately, the callback sees a valid port.
    state.port.store(port as u64, Ordering::Release);

    // Stash the runloop so stop() can wake us.
    *state.runloop.lock().unwrap() = Some(RunLoopHandle(current_loop));

    // Block until stop() calls CFRunLoopStop. CFRunLoopRun is the canonical
    // blocking call for this pattern; returns when the runloop is stopped.
    unsafe { CFRunLoopRun() };

    // ─── Cleanup: invalidate the port, release CF resources, drop our Arc.
    // Clear the port atomic FIRST so any in-flight callback sees null and
    // skips the re-enable path. Then disable + remove source from runloop +
    // invalidate port + release. Per Apple docs (CFMachPort + CFRunLoopSource
    // section), the source MUST be removed from the runloop BEFORE the port
    // is invalidated; releasing a still-attached source while the runloop
    // holds a reference is undefined behavior. In practice it works on
    // current macOS, but the ordering is the documented contract.
    state.port.store(0, Ordering::Release);
    unsafe { CGEventTapEnable(port, false) };
    unsafe { CFRunLoopRemoveSource(current_loop, source, kCFRunLoopCommonModes) };
    unsafe { CFMachPortInvalidate(port) };
    unsafe { CFRelease(source as *const c_void) };
    unsafe { CFRelease(port as *const c_void) };

    // Reclaim the Arc we leaked into the C user_info. If the active flag
    // was still true at this point (unusual — would mean the runloop exited
    // for another reason), we still flip it false so JS can re-start cleanly.
    state.runloop.lock().unwrap().take();
    state.active.store(false, Ordering::Release);
    drop(unsafe { Arc::from_raw(user_info as *const TapState) });
}

// ─── Public N-API: the tap handle JS holds ───────────────────────────────

#[napi]
pub struct StealthKeyboardTap {
    state: Arc<TapState>,
    /// JoinHandle for the worker thread, stored so `stop()` can wait for
    /// the worker to fully release its CF resources and clear the shared
    /// TapState before returning. Without this, a fast stop()→start() cycle
    /// from JS could spawn a NEW worker that reads/writes `state.port` and
    /// `state.runloop` while the OLD worker is still in its cleanup path,
    /// resulting in the new worker's runloop ref being cleared by the old
    /// worker's `take()` and the new tap being permanently un-stoppable.
    /// Behind a Mutex so concurrent stop() calls don't double-join.
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

#[napi]
impl StealthKeyboardTap {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: Arc::new(TapState {
                active: AtomicBool::new(false),
                runloop: Mutex::new(None),
                port: AtomicU64::new(0),
                overlay_bounds: Mutex::new(None),
                callback: Mutex::new(None),
            }),
            worker: Mutex::new(None),
        }
    }

    /// Engage the tap. Every keystroke fires `callback` with the captured
    /// metadata; the foreground app does NOT receive the event.
    ///
    /// Returns:
    ///   - `true` if the tap engaged.
    ///   - `false` if Accessibility permission is missing. Call
    ///     `is_accessibility_granted()` and `request_accessibility_permission()`
    ///     to drive the user through System Settings, then restart the app.
    ///
    /// Idempotent: repeated `start()` calls while active are no-ops.
    #[napi]
    pub fn start(
        &self,
        callback: ThreadsafeFunction<CapturedKey>,
        overlay_bounds: Option<OverlayBoundsInput>,
    ) -> Result<bool> {
        if !is_accessibility_granted() {
            return Ok(false);
        }

        // ROUND 4 FIX (#1): Re-entry guard via non-mutating load — safe
        // because JS is single-threaded so concurrent start() calls cannot
        // happen in practice. The previous swap(true)-first ordering left
        // a narrow window where the prior worker's auto-exit cleanup path
        // could write active.store(false) AFTER our swap(true), silently
        // killing the new session.
        if self.state.active.load(Ordering::Acquire) {
            return Ok(true);
        }

        // ROUND 2 FIX (#2) + R4 reorder: take and join any prior worker
        // handle BEFORE flipping active=true. If a previous session's
        // worker is still in its cleanup path (which includes a final
        // active.store(false)), joining first guarantees that store
        // happens BEFORE our store(true). Without this order, the
        // cleanup-store could overwrite our true and leave the new tap
        // silently dead. join() returns immediately when the worker has
        // already exited.
        let prev_handle = self.worker.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(h) = prev_handle {
            let _ = h.join();
        }

        let overlay_bounds = overlay_bounds.and_then(|b| {
            if b.width > 0.0 && b.height > 0.0 {
                Some(OverlayBounds {
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    height: b.height,
                })
            } else {
                None
            }
        });
        *self.state.overlay_bounds.lock().unwrap_or_else(|p| p.into_inner()) = overlay_bounds;

        // Now safely publish the active state.
        self.state.active.store(true, Ordering::Release);

        // ROUND 2 FIX (#6): poison-safe lock. Without this, a prior panic
        // that poisoned the callback Mutex would make .unwrap() panic here,
        // leaving active=true with no worker — permanently broken until
        // process restart.
        *self.state.callback.lock().unwrap_or_else(|p| p.into_inner()) =
            Some(Arc::new(callback));

        let state = self.state.clone();
        let handle = thread::Builder::new()
            .name("natively-keyboard-tap".into())
            .spawn(move || tap_worker(state))
            .map_err(|e| {
                // Spawn failed → roll back state so JS can retry cleanly.
                // Clear the callback we just installed; otherwise the
                // Arc<ThreadsafeFunction> stays in TapState forever, holding
                // a strong ref to the JS closure (memory leak) and blocking
                // V8 from GC-ing the closure even after JS dropped its ref.
                self.state.active.store(false, Ordering::Release);
                *self.state.overlay_bounds.lock().unwrap_or_else(|p| p.into_inner()) = None;
                *self.state.callback.lock().unwrap_or_else(|p| p.into_inner()) = None;
                Error::new(
                    Status::GenericFailure,
                    format!("failed to spawn tap worker thread: {e}"),
                )
            })?;
        // Stash the JoinHandle so stop() can wait for full cleanup before
        // returning to JS. Lock is brief (one assignment) — no contention.
        *self.worker.lock().unwrap_or_else(|p| p.into_inner()) = Some(handle);

        Ok(true)
    }

    /// Push fresh overlay bounds into the live tap. Required when the
    /// OS window moves or resizes mid-session: without this, the start()
    /// snapshot goes stale and mouse-down classification (inside vs
    /// outside the overlay) drifts against the actual frame. No-op when
    /// the tap is not active so JS can call it unconditionally.
    ///
    /// Concurrency note: a benign TOCTOU exists where this method observes
    /// `active=true`, stop() then clears bounds, and we overwrite with a
    /// stale value. That's safe: the worker is exiting, the per-event reader
    /// short-circuits on `!active`, and the next `start()` re-snapshots
    /// bounds from the provider — so the stale write is invisible.
    #[napi]
    pub fn update_overlay_bounds(&self, overlay_bounds: Option<OverlayBoundsInput>) {
        if !self.state.active.load(Ordering::Acquire) {
            return;
        }
        let overlay_bounds = overlay_bounds.and_then(|b| {
            if b.width > 0.0 && b.height > 0.0 {
                Some(OverlayBounds {
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    height: b.height,
                })
            } else {
                None
            }
        });
        *self.state.overlay_bounds.lock().unwrap_or_else(|p| p.into_inner()) = overlay_bounds;
    }

    /// Disengage the tap. After this returns, the next keystroke will
    /// reach the foreground app normally. Safe to call multiple times.
    #[napi]
    pub fn stop(&self) {
        if !self.state.active.swap(false, Ordering::AcqRel) {
            return;
        }
        // Atomically claim ownership of the runloop handle by `take()`-ing
        // it out of the Mutex. This guarantees:
        //   1. Concurrent stop() calls — only one path calls CFRunLoopStop.
        //      Subsequent stops see None and no-op.
        //   2. The worker thread's cleanup-path `take()` (line ~410) and
        //      ours can't both call CFRunLoopStop on the same handle.
        //   3. Once the worker thread has exited via its own path (rare —
        //      would require CFRunLoopRun returning without our stop, which
        //      shouldn't happen with our setup, but defensive), the handle
        //      is already None and we don't try to call into a freed runloop.
        // The null-check on handle.0 is belt-and-braces; CFRunLoopGetCurrent
        // never returns null on a live thread, but we're paranoid here
        // because deref-on-null is UB and the cost is one branch.
        let runloop = self.state.runloop.lock().unwrap().take();
        if let Some(handle) = runloop {
            if !handle.0.is_null() {
                // Wake the worker thread out of CFRunLoopRun. CFRunLoopStop
                // is safe to call from any thread per Apple docs.
                unsafe { CFRunLoopStop(handle.0) };
            }
        }
        *self.state.overlay_bounds.lock().unwrap_or_else(|p| p.into_inner()) = None;
        // Drop the JS callback handle so V8 can GC its closure.
        *self.state.callback.lock().unwrap_or_else(|p| p.into_inner()) = None;

        // Wait for the worker thread to fully finish cleanup (releasing CF
        // resources, dropping its Arc on user_info, clearing runloop/port
        // fields of TapState). Without this, a subsequent start() could
        // spawn a new worker that races with the old worker on the shared
        // TapState — the new worker's runloop ref gets cleared by the old
        // worker's cleanup-path `take()`, leaving the new tap un-stoppable.
        //
        // We `take()` the JoinHandle out under the lock to avoid double-join
        // if stop() is called concurrently from two paths (shouldn't happen
        // but defensive). join() can panic if the worker panicked.
        //
        // ROUND 2 FIX (#3): timing watchdog. join() blocks the JS event loop
        // synchronously. CFRunLoopStop is documented to wake the runloop on
        // its next iteration; in practice this is sub-millisecond, but if
        // it ever fails (CG bug, runloop stuck dispatching a long callback),
        // the entire Node event loop wedges. We log if join exceeds 100ms so
        // production hangs are diagnosable from console output. We also
        // surface worker panics rather than silently swallowing — the user
        // sees "[keyboard_tap] worker panicked" in logs and we know to
        // investigate.
        let handle = self.worker.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(h) = handle {
            let join_start = std::time::Instant::now();
            match h.join() {
                Ok(_) => {}
                Err(e) => eprintln!("[keyboard_tap] worker panicked during cleanup: {:?}", e),
            }
            let join_ms = join_start.elapsed().as_millis();
            if join_ms > 100 {
                eprintln!(
                    "[keyboard_tap] stop() join() took {}ms — runloop may have been wedged",
                    join_ms
                );
            }
        }
    }

    /// True while the tap is engaged. Use to drive UI state ("stealth
    /// typing" badge, mode indicator, etc.).
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
