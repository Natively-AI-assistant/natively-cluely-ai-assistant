//! Stealth-window attributes for the overlay BrowserWindow on macOS.
//!
//! Electron's `type: 'panel'` sets `NSWindowStyleMaskNonactivatingPanel`,
//! which is necessary but not sufficient for true Spotlight/Alfred-grade
//! stealth. The style mask lives in two places (AppKit's NSWindow + the
//! WindowServer's per-window tag bitmap) and Electron's path frequently
//! desyncs the two, so we also call the private `_setPreventsActivation:`
//! SPI to write the WindowServer tag directly.
//!
//! This module applies the additional NSWindow properties Electron does not
//! expose:
//!
//!   • `becomesKeyOnlyIfNeeded = YES` — clicks on the panel only make it the
//!     key window if the click lands on a control that needs key (e.g. a text
//!     input). Clicks on buttons / surfaces do NOT promote the panel to key,
//!     which means the user's foreground app keeps key state and frontmost
//!     status everywhere observable (dock, menu bar, screen-share, focus
//!     followers). This is THE attribute that fixes "clicking any button on
//!     Natively dims my Zoom window."
//!
//!   • `hidesOnDeactivate = NO` — without this, macOS auto-hides the panel
//!     when another app activates. Combined with becomesKeyOnlyIfNeeded,
//!     this keeps the overlay continuously visible while the user types in
//!     other apps.
//!
//!   • `collectionBehavior` — joins all spaces, full-screen aux, ignores
//!     window cycling. The auxiliary flag is what lets the overlay render
//!     above other apps' fullscreen windows without us having to fullscreen.
//!
//! All work happens on the main thread (Electron is calling us from main).
//! No threadsafe-function plumbing needed; this is a one-shot setter.

#![cfg(target_os = "macos")]

use napi::bindgen_prelude::*;
use objc2::msg_send;
use objc2::runtime::{AnyObject, Bool, Sel};
use objc2::sel;

/// Apply stealth attributes to the BrowserWindow whose native handle is
/// passed in.
///
/// `handle` is the buffer returned by `BrowserWindow.getNativeWindowHandle()`.
/// On macOS that buffer contains a single pointer to the BrowserWindow's
/// content `NSView`. We dereference to the parent `NSWindow` and apply the
/// stealth attributes on it.
///
/// Returns `Ok(())` on success, `Err(...)` if the handle is malformed or the
/// view has no associated window (e.g. window destroyed mid-call).
#[napi]
pub fn apply_stealth_to_window(handle: Buffer) -> Result<()> {
    let bytes = handle.as_ref();

    // The handle buffer must be exactly one pointer wide. macOS arm64 + x64
    // are both 64-bit; we don't support 32-bit macOS.
    if bytes.len() != std::mem::size_of::<usize>() {
        return Err(Error::new(
            Status::InvalidArg,
            format!(
                "expected NSView handle of {} bytes, got {}",
                std::mem::size_of::<usize>(),
                bytes.len()
            ),
        ));
    }

    let view_ptr = usize::from_ne_bytes(
        bytes
            .try_into()
            .map_err(|_| Error::new(Status::InvalidArg, "handle slice → array conversion failed"))?,
    ) as *mut AnyObject;

    if view_ptr.is_null() {
        return Err(Error::new(Status::InvalidArg, "NSView pointer is null"));
    }

    // SAFETY:
    //   - Electron guarantees the view pointer outlives this call (the
    //     BrowserWindow we were called from owns it).
    //   - All msg_send! calls below dispatch to standard AppKit selectors;
    //     they cannot panic on a valid NSView/NSWindow.
    //   - We drop the raw window pointer immediately after the setters; we
    //     never store or share it across threads.
    unsafe {
        let window: *mut AnyObject = msg_send![view_ptr, window];
        if window.is_null() {
            return Err(Error::new(
                Status::GenericFailure,
                "NSView has no associated NSWindow (window destroyed?)",
            ));
        }

        // respondsToSelector: returns Objective-C BOOL (signed char on macOS
        // arm64). Receiving it as Rust `bool` is UB-adjacent — the high bytes
        // of the return register may carry uninitialized data and Rust's
        // `bool` requires the value to be exactly 0 or 1. objc2::runtime::Bool
        // is the strongly-typed marshaller; .as_bool() converts the C BOOL
        // to a real Rust bool safely.
        //
        // Setter calls below pass `true`/`false` Rust bools — objc2 0.5
        // converts these to C BOOL automatically via its Encode trait
        // (Boolean Encode impl). No risk on the call side.
        let sel_set_becomes_key: Sel = sel!(setBecomesKeyOnlyIfNeeded:);
        let responds_raw: Bool = msg_send![window, respondsToSelector: sel_set_becomes_key];
        let responds_to_becomes_key: bool = responds_raw.as_bool();
        if responds_to_becomes_key {
            let _: () = msg_send![window, setBecomesKeyOnlyIfNeeded: true];
        }

        let sel_set_hides: Sel = sel!(setHidesOnDeactivate:);
        let responds_raw_hides: Bool = msg_send![window, respondsToSelector: sel_set_hides];
        let responds_to_hides: bool = responds_raw_hides.as_bool();
        if responds_to_hides {
            let _: () = msg_send![window, setHidesOnDeactivate: false];
        }

        // NSWindowCollectionBehavior bitmask values from
        // <AppKit/NSWindow.h>. Inlined as raw u64 to avoid pulling the full
        // enum binding for three constants.
        //
        // ROUND 2 FIX: removed NSWindowCollectionBehaviorStationary (1<<4).
        // Per Apple docs, Stationary means "the window is visible during
        // Mission Control but does not move when spaces are switched" —
        // semantically conflicts with CanJoinAllSpaces (which means "this
        // window appears on every space"). On macOS Sonoma 14.4+ the
        // combination has been observed to cause the panel to vanish from
        // secondary spaces. CanJoinAllSpaces alone gives the correct
        // overlay-on-every-space behavior.
        const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
        const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;
        const IGNORES_CYCLE: u64 = 1 << 6;
        let behavior: u64 =
            CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY | IGNORES_CYCLE;
        let _: () = msg_send![window, setCollectionBehavior: behavior];

        // Belt-and-braces: ensure the nonactivating panel style mask is set
        // even if Electron's `type: 'panel'` didn't apply it (defensive — we
        // saw cases where the mask was dropped during window-style updates).
        // NSWindowStyleMaskNonactivatingPanel = 1 << 7
        let current_mask: u64 = msg_send![window, styleMask];
        const NONACTIVATING_PANEL: u64 = 1 << 7;
        if current_mask & NONACTIVATING_PANEL == 0 {
            let _: () = msg_send![window, setStyleMask: current_mask | NONACTIVATING_PANEL];
            // -setStyleMask: after window init is documented to reset several
            // NSWindow properties (notably for NSPanel: the panel-specific
            // becomesKeyOnlyIfNeeded flag is one of them per CocoaDev notes).
            // Re-apply the setters that AppKit may have wiped. Cheap (one
            // ObjC dispatch) and prevents silent regression of the entire
            // stealth model when the style mask path is taken.
            if responds_to_becomes_key {
                let _: () = msg_send![window, setBecomesKeyOnlyIfNeeded: true];
            }
            if responds_to_hides {
                let _: () = msg_send![window, setHidesOnDeactivate: false];
            }
            // collectionBehavior also gets reset on style-mask change.
            let _: () = msg_send![window, setCollectionBehavior: behavior];
        }

        // ─── Public API: -[NSWindow setSharingType:] ───
        //
        // NSWindowSharingNone (= 0) excludes the window from
        // `CGWindowListCreateImage` and other legacy CoreGraphics
        // capture paths. This is the original Spotlight/1Password trick.
        //
        // On macOS 15+ Sequoia, ScreenCaptureKit (which Zoom 5.16+, Teams,
        // Loom all use now) IGNORES this flag — Apple deliberately
        // changed SCK to capture from the compositor framebuffer regardless
        // of per-window sharing type. So setSharingType is no longer
        // sufficient on its own. But it IS still effective on:
        //   • macOS ≤ 14 (Sonoma and earlier)
        //   • Older Zoom builds (pre-5.16) on any macOS
        //   • Loom older builds, screencap CLI, OBS Display Capture without SCK
        //   • Most native screenshot APIs (Cmd+Shift+4 → window capture)
        // So we set it as defense-in-depth — costs nothing, helps in many
        // real-world scenarios. Electron's `setContentProtection(true)`
        // also sets this internally, but only when called from JS — going
        // direct from native ensures it sticks even if the JS-side toggle
        // is bypassed by some code path.
        let sel_set_sharing: Sel = sel!(setSharingType:);
        let responds_raw_sharing: Bool = msg_send![window, respondsToSelector: sel_set_sharing];
        let responds_to_sharing: bool = responds_raw_sharing.as_bool();
        if responds_to_sharing {
            const NS_WINDOW_SHARING_NONE: u64 = 0;
            let _: () = msg_send![window, setSharingType: NS_WINDOW_SHARING_NONE];
        }

        // ─── Private SPI: -[NSWindow _setPreventsActivation:] ───
        //
        // The public `NSWindowStyleMaskNonactivatingPanel` style mask is
        // stored in two places: AppKit's NSWindow object AND the WindowServer's
        // per-window tag bitmap (specifically `kCGSPreventsActivationTagBit`,
        // value `1 << 16`). When you set the style mask via the public API
        // AFTER window initialization (which we do above as belt-and-braces,
        // and which Electron's `type:'panel'` may also do internally during
        // window-style updates), AppKit fails to resync the WindowServer tag.
        // Result: the window LOOKS nonactivating to AppKit but the
        // WindowServer still treats clicks as app-activating, so the user's
        // foreground app loses frontmost status anyway.
        //
        // The fix is the private `_setPreventsActivation:` selector. It calls
        // `CGSSetWindowTags` on the WindowServer side, flipping
        // `kCGSPreventsActivationTagBit` directly. This is the same SPI
        // Spotlight/Alfred/Raycast use; documented at
        // https://philz.blog/nspanel-nonactivating-style-mask-flag/ and
        // referenced in the long-standing CocoaDev NSPanel notes.
        //
        // We `respondsToSelector:` first so a future macOS that removes/renames
        // the SPI degrades gracefully — the public-API path still gives ~90%
        // of the stealth behavior. This is best-effort closure of the
        // remaining 10% gap (the tag desync window where window-level activation
        // can still leak through to the foreground app).
        let sel_set_prevents: Sel = sel!(_setPreventsActivation:);
        let responds_raw_prevents: Bool = msg_send![window, respondsToSelector: sel_set_prevents];
        let responds_to_prevents: bool = responds_raw_prevents.as_bool();
        if responds_to_prevents {
            let _: () = msg_send![window, _setPreventsActivation: true];
        } else {
            // Log to stderr (no eprintln noise unless verboseLogging is on,
            // but this is rare enough — once per overlay creation — that the
            // line is acceptable). Caller (WindowHelper) ignores stderr.
            eprintln!(
                "[stealth_window] _setPreventsActivation: SPI unavailable on this \
                 macOS — public-API stealth still active, but window-level \
                 activation may leak in edge cases (e.g. style-mask updates)."
            );
        }
    }

    Ok(())
}
