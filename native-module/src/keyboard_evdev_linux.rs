//! Linux stealth keyboard capture over evdev (/dev/input/event*).
//!
//! The Linux counterpart of keyboard_tap.rs (macOS CGEventTap) and
//! keyboard_hook_windows.rs (WH_KEYBOARD_LL): the SAME napi surface —
//! `StealthKeyboardTap`, `CapturedKey`, `OverlayBoundsInput`,
//! `is_accessibility_granted`, `is_ime_keyboard_active` — so
//! StealthKeyboardManager and the renderer's `stealth-key-captured` contract are
//! unchanged. The per-key decisions live in linux_keymap.rs (pure, tested).
//!
//! # How it works
//!
//! `start()` opens every readable keyboard under /dev/input, waits until no key
//! is held, then `EVIOCGRAB`s them: while grabbed, the compositor and every app
//! (Wayland or X11) stop receiving that keyboard, and the events come only here.
//! Characters come from xkbcommon, with the layout from XKB_DEFAULT_* or, on a
//! Wayland session where the compositor owns it, `localectl`'s X11 layout; `us`
//! is the last resort.
//!
//! # Privilege: none beyond group membership
//!
//! /dev/input is `root:input 0660`. The user must be in the `input` group (or
//! have a udev rule) — the app never uses sudo and never runs as root. Without
//! access `start()` returns false and `is_accessibility_granted()` is false;
//! `linux_input_access()` says why ("ok", "permission-denied", "no-devices").
//!
//! # Safety: a grab must never strand the keyboard
//!
//! - Esc is delivered, then the grab is released (the renderer also stops it).
//! - Idle backstop (linux_keymap::IDLE_RELEASE_MS, shortenable through
//!   NATIVELY_EVDEV_IDLE_MS) releases it with no JS involvement.
//! - No callback to deliver to ⟹ release; a dead device is dropped, none left
//!   ⟹ release.
//! - The grab lives in a guard whose Drop ungrabs on every exit, panics
//!   included. And the kernel drops a grab when the fd closes, so even a killed
//!   process frees the keyboard.
//! - Devices another process already grabbed (EBUSY) are skipped, not fought over.
//! - Never grabs while a key is held (the compositor would see a press with no
//!   release: a stuck, repeating key), and never grabs zero devices.
//!
//! # Differences from the Windows hook
//!
//! Windows passes Alt/Win combos, Tab, arrows, F-keys through to the foreground
//! app. A grab takes everything and Linux has no per-key pass-through without
//! uinput re-injection (a bigger privilege, not used), so those keys are
//! swallowed while the grab lasts. See linux_keymap.rs. No IME probe, no
//! outside-click stop (JS's idle timer and Esc end the session), key-ups are not
//! delivered (the renderer only acts on key-down).

#![cfg(target_os = "linux")]

use std::os::fd::AsRawFd;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use evdev::{Device, EventType, KeyCode};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use xkbcommon::xkb;

use crate::app_chord::{app_chords_from_inputs, AppChord, AppChordInput};
use crate::linux_keymap::{apply_modifier, decide, idle_release_ms, repeats, to_vk, Action, Held, KEY_ESC};

#[napi(object)]
pub struct OverlayBoundsInput {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Same fields and bit layout as the macOS and Windows taps.
#[napi(object)]
pub struct CapturedKey {
    pub key_code: u32,
    pub chars: String,
    /// shift = 1<<17, capsLock = 1<<16 (the macOS CGEventFlags layout).
    pub flags: u32,
    pub is_key_down: bool,
    /// True when the tap let go on its own (idle backstop); JS turns it into stop().
    pub is_outside_mouse_down: bool,
    pub app_chord_id: String,
}

const MAC_FLAG_SHIFT: u32 = 1 << 17;
const MAC_FLAG_CAPS: u32 = 1 << 16;
const EVDEV_TO_XKB: u32 = 8;
const POLL_MS: i32 = 100;
const KEYS_UP_WAIT: Duration = Duration::from_millis(1500);

type Tsfn = ThreadsafeFunction<CapturedKey>;

struct Shared {
    active: AtomicBool,
    stop: AtomicBool,
    session: AtomicU64,
    callback: Mutex<Option<Arc<Tsfn>>>,
    chords: Mutex<Vec<AppChord>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn is_keyboard(d: &Device) -> bool {
    d.supported_keys()
        .is_some_and(|k| k.contains(KeyCode::KEY_A) && k.contains(KeyCode::KEY_ENTER))
}

/// Readable keyboards, and how many event nodes were refused for permission.
fn open_keyboards() -> (Vec<Device>, usize) {
    let mut keyboards = Vec::new();
    let mut denied = 0;
    let Ok(dir) = std::fs::read_dir("/dev/input") else { return (keyboards, 0) };
    for entry in dir.flatten() {
        let path = entry.path();
        if !path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("event")) {
            continue;
        }
        match Device::open(&path) {
            Ok(d) if is_keyboard(&d) => keyboards.push(d),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => denied += 1,
            Err(_) => {}
        }
    }
    (keyboards, denied)
}

/// "ok" | "permission-denied" | "no-devices": whether the tap can read a keyboard
/// now. Opens and closes the devices; grabs nothing.
#[napi]
pub fn linux_input_access() -> String {
    let (keyboards, denied) = open_keyboards();
    if !keyboards.is_empty() {
        "ok"
    } else if denied > 0 {
        "permission-denied"
    } else {
        "no-devices"
    }
    .to_string()
}

/// The Linux equivalent of macOS Accessibility: can this user read the keyboard.
#[napi]
pub fn is_accessibility_granted() -> bool {
    linux_input_access() == "ok"
}

/// No IME probe on Linux: composition (fcitx/ibus) happens above evdev, so an IME
/// user would get raw keys. Reported false like macOS-less defaults; the opt-in
/// gate in JS is what keeps the grab off unless the user asked for it.
#[napi]
pub fn is_ime_keyboard_active() -> bool {
    false
}

fn make_keymap() -> Option<xkb::Keymap> {
    let ctx = xkb::Context::new(xkb::CONTEXT_NO_FLAGS);
    let build = |layout: &str, variant: &str| {
        xkb::Keymap::new_from_names(&ctx, "", "", layout, variant, None, xkb::KEYMAP_COMPILE_NO_FLAGS)
    };
    // Empty names make xkbcommon read XKB_DEFAULT_*. With none set, ask the system.
    if std::env::var_os("XKB_DEFAULT_LAYOUT").is_none() {
        if let Some((layout, variant)) = system_layout() {
            if let Some(k) = build(&layout, &variant) {
                return Some(k);
            }
        }
        return build("us", "");
    }
    build("", "").or_else(|| build("us", ""))
}

/// `localectl status` "X11 Layout" / "X11 Variant" (first layout only).
fn system_layout() -> Option<(String, String)> {
    let out = std::process::Command::new("localectl").arg("status").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let field = |name: &str| {
        text.lines()
            .find_map(|l| l.trim().strip_prefix(name))
            .map(|v| v.trim().split(',').next().unwrap_or("").trim().to_string())
    };
    let layout = field("X11 Layout:").filter(|l| !l.is_empty() && l != "n/a")?;
    Some((layout, field("X11 Variant:").filter(|v| v != "n/a").unwrap_or_default()))
}

/// Ungrabs on every exit path, panics included.
struct GrabGuard {
    devices: Vec<Device>,
    shared: Arc<Shared>,
    session: u64,
}

impl Drop for GrabGuard {
    fn drop(&mut self) {
        for d in &mut self.devices {
            let _ = d.ungrab();
        }
        // Only the current session clears shared state: a stale worker must not
        // clobber a newer start().
        if self.shared.session.load(Ordering::Acquire) == self.session {
            self.shared.active.store(false, Ordering::Release);
            *lock(&self.shared.callback) = None;
        }
    }
}

fn send(shared: &Shared, payload: CapturedKey) -> bool {
    let tsfn = lock(&shared.callback).as_ref().map(Arc::clone);
    match tsfn {
        Some(t) => {
            t.call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking);
            true
        }
        None => false,
    }
}

fn payload(key_code: u32, chars: String, flags: u32, chord: String) -> CapturedKey {
    CapturedKey {
        key_code,
        chars,
        flags,
        is_key_down: true,
        is_outside_mouse_down: false,
        app_chord_id: chord,
    }
}

fn keys_all_up(devices: &[Device]) -> bool {
    devices.iter().all(|d| d.get_key_state().map_or(true, |s| s.iter().next().is_none()))
}

fn worker(shared: Arc<Shared>, session: u64, devices: Vec<Device>, ready: mpsc::Sender<bool>) {
    let Some(keymap) = make_keymap() else {
        let _ = ready.send(false);
        return;
    };
    let mut xkb_state = xkb::State::new(&keymap);

    let deadline = Instant::now() + KEYS_UP_WAIT;
    while !keys_all_up(&devices) {
        if Instant::now() > deadline {
            let _ = ready.send(false); // a key is still down: grabbing would strand it
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }

    let mut guard = GrabGuard { devices, shared: shared.clone(), session };
    // A device someone else already grabbed (a remapper like keyd, kmonad) refuses
    // with EBUSY and its events never reach us anyway: skip it. Need at least one.
    guard.devices.retain_mut(|d| {
        let _ = d.set_nonblocking(true);
        d.grab().is_ok()
    });
    if guard.devices.is_empty() {
        let _ = ready.send(false);
        return;
    }
    let _ = ready.send(true);

    let idle = Duration::from_millis(idle_release_ms(std::env::var("NATIVELY_EVDEV_IDLE_MS").ok().as_deref()));
    let mut last_key = Instant::now();
    let mut held = Held::default();

    'run: loop {
        if shared.stop.load(Ordering::Acquire) {
            break;
        }
        if last_key.elapsed() >= idle {
            send(&shared, CapturedKey { is_outside_mouse_down: true, ..payload(0, String::new(), 0, String::new()) });
            break;
        }
        let mut fds: Vec<libc::pollfd> = guard
            .devices
            .iter()
            .map(|d| libc::pollfd { fd: d.as_raw_fd(), events: libc::POLLIN, revents: 0 })
            .collect();
        // SAFETY: `fds` is a live, correctly sized pollfd array for the call.
        unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, POLL_MS) };

        let mut dead = Vec::new();
        for (i, pfd) in fds.iter().enumerate() {
            if pfd.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
                dead.push(i);
                continue;
            }
            if pfd.revents & libc::POLLIN == 0 {
                continue;
            }
            let events: Vec<_> = match guard.devices[i].fetch_events() {
                Ok(it) => it.collect(),
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                Err(_) => {
                    dead.push(i);
                    continue;
                }
            };
            for ev in events {
                if ev.event_type() != EventType::KEY {
                    continue;
                }
                let (code, value) = (ev.code(), ev.value());
                let kc = xkb::Keycode::new(code as u32 + EVDEV_TO_XKB);
                if value == 0 || value == 1 {
                    xkb_state.update_key(kc, if value == 1 { xkb::KeyDirection::Down } else { xkb::KeyDirection::Up });
                }
                if apply_modifier(&mut held, code, value != 0) || value == 0 {
                    continue;
                }
                if value == 2 && !repeats(code) {
                    continue;
                }
                last_key = Instant::now();

                let sym = char::from_u32(xkb::keysym_to_utf32(xkb_state.key_get_one_sym(kc)));
                let vk = to_vk(code, sym);
                let action = decide(code, vk, &held, &lock(&shared.chords));
                let mut flags = 0;
                if held.shift {
                    flags |= MAC_FLAG_SHIFT;
                }
                if xkb_state.mod_name_is_active(xkb::MOD_NAME_CAPS, xkb::STATE_MODS_EFFECTIVE) {
                    flags |= MAC_FLAG_CAPS;
                }
                let delivered = match action {
                    Action::Drop => true,
                    Action::AppChord(id) => send(&shared, payload(0, String::new(), 0, id)),
                    Action::Edit { key_code, chars } => {
                        send(&shared, payload(key_code, chars.to_string(), crate::edit_shortcut::FLAG_CTRL, String::new()))
                    }
                    Action::Type { key_code } => {
                        let chars = if key_code == 0 { xkb_state.key_get_utf8(kc) } else { String::new() };
                        if key_code == 0 && (chars.is_empty() || chars.chars().any(char::is_control)) {
                            true // dead key, F-key, nothing typeable
                        } else {
                            send(&shared, payload(key_code, chars, flags, String::new()))
                        }
                    }
                };
                // Esc releases; so does having nowhere to deliver (a swallowed key
                // with no listener is lost input).
                if !delivered || code == KEY_ESC {
                    break 'run;
                }
            }
        }
        for i in dead.into_iter().rev() {
            guard.devices.remove(i);
        }
        if guard.devices.is_empty() {
            break;
        }
    }
}

#[napi]
pub struct StealthKeyboardTap {
    shared: Arc<Shared>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

#[napi]
impl StealthKeyboardTap {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            shared: Arc::new(Shared {
                active: AtomicBool::new(false),
                stop: AtomicBool::new(false),
                session: AtomicU64::new(0),
                callback: Mutex::new(None),
                chords: Mutex::new(Vec::new()),
            }),
            worker: Mutex::new(None),
        }
    }

    /// Grab the keyboards and stream keys to `callback`. False when it cannot:
    /// shortcut-only mode (Linux global shortcuts are Electron's), no readable
    /// keyboard (see `linux_input_access`), a key still held, or a grab refused.
    /// `overlay_bounds` is accepted for parity and ignored. Idempotent while active.
    #[napi]
    pub fn start(
        &self,
        callback: ThreadsafeFunction<CapturedKey>,
        app_chords: Vec<AppChordInput>,
        shortcut_only: bool,
        _overlay_bounds: Option<OverlayBoundsInput>,
    ) -> Result<bool> {
        if shortcut_only {
            return Ok(false);
        }
        if self.shared.active.load(Ordering::Acquire) {
            return Ok(true);
        }
        if let Some(prev) = lock(&self.worker).take() {
            let _ = prev.join();
        }
        let (devices, _) = open_keyboards();
        if devices.is_empty() {
            return Ok(false);
        }

        *lock(&self.shared.chords) = app_chords_from_inputs(app_chords);
        *lock(&self.shared.callback) = Some(Arc::new(callback));
        self.shared.stop.store(false, Ordering::Release);
        let session = self.shared.session.fetch_add(1, Ordering::AcqRel) + 1;
        self.shared.active.store(true, Ordering::Release);

        let (tx, rx) = mpsc::channel();
        let shared = self.shared.clone();
        let spawned = thread::Builder::new().name("evdev-tap".into()).spawn(move || {
            // The guard inside `worker` ungrabs on unwind; this keeps the panic
            // from reaching the runtime.
            let _ = catch_unwind(AssertUnwindSafe(|| worker(shared, session, devices, tx)));
        });
        let handle = match spawned {
            Ok(h) => h,
            Err(e) => {
                self.shared.active.store(false, Ordering::Release);
                *lock(&self.shared.callback) = None;
                return Err(Error::new(Status::GenericFailure, format!("failed to spawn evdev worker: {e}")));
            }
        };
        match rx.recv_timeout(Duration::from_secs(3)) {
            Ok(true) => {
                *lock(&self.worker) = Some(handle);
                Ok(true)
            }
            _ => {
                self.shared.stop.store(true, Ordering::Release);
                self.shared.active.store(false, Ordering::Release);
                *lock(&self.shared.callback) = None;
                let _ = handle.join();
                Ok(false)
            }
        }
    }

    /// Accepted for parity; there is no outside-click stop on Linux.
    #[napi]
    pub fn update_overlay_bounds(&self, _overlay_bounds: Option<OverlayBoundsInput>) {}

    /// Release the grab. Safe when inactive; the next key reaches the foreground app.
    #[napi]
    pub fn stop(&self) {
        self.shared.stop.store(true, Ordering::Release);
        if let Some(h) = lock(&self.worker).take() {
            let _ = h.join();
        }
        self.shared.active.store(false, Ordering::Release);
        *lock(&self.shared.callback) = None;
    }

    #[napi(getter)]
    pub fn is_active(&self) -> bool {
        self.shared.active.load(Ordering::Acquire)
    }
}

impl Drop for StealthKeyboardTap {
    fn drop(&mut self) {
        self.stop();
    }
}

impl Default for StealthKeyboardTap {
    fn default() -> Self {
        Self::new()
    }
}
