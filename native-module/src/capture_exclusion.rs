//! Keep the app's OTHER windows out of screen capture in Undetectable mode.
//!
//! Electron's `setContentProtection` covers BrowserWindows only. Everything
//! else the process puts on screen is its own OS window with default capture
//! visibility: file pickers, message boxes, tooltips, `<select>` popups,
//! context menus. Measured 2026-09-27 on macOS: the resume picker was an
//! 880x448 window owned by the Natively process (its contents come from the
//! openAndSavePanelService XPC, but the window is ours) reading
//! kCGWindowSharingState 1, so it showed in a screen share while the launcher
//! beside it read 0.
//!
//! `set_foreign_windows_capture_excluded(true, own)` marks every top-level
//! window of this process that is NOT one of `own` (the BrowserWindows,
//! passed as their native handles and left to Electron) as excluded from
//! capture; `false` puts them back. It is a sweep, not a hook: the caller runs
//! it right after opening a dialog, when the app activates, and on a short
//! interval while Undetectable is on. Returns how many windows it set.
//!
//!   macOS   — `-[NSWindow setSharingType:]` NSWindowSharingNone / ReadOnly
//!             on each `[NSApp windows]` entry. Main thread only (Electron's
//!             main process JS runs there).
//!   Windows — `SetWindowDisplayAffinity` WDA_EXCLUDEFROMCAPTURE / WDA_NONE on
//!             each top-level window EnumWindows reports for this process.
//!             Before Windows 10 2004 the exclusion shows as a black box.

use napi::bindgen_prelude::*;

/// A native handle from `BrowserWindow.getNativeWindowHandle()`: one pointer
/// (macOS: the content NSView; Windows: the HWND).
fn handle_to_usize(handle: &Buffer) -> Option<usize> {
    let bytes = handle.as_ref();
    if bytes.len() != std::mem::size_of::<usize>() {
        return None;
    }
    let arr: [u8; std::mem::size_of::<usize>()] = bytes.try_into().ok()?;
    let value = usize::from_ne_bytes(arr);
    (value != 0).then_some(value)
}

#[napi]
pub fn set_foreign_windows_capture_excluded(excluded: bool, own_handles: Vec<Buffer>) -> u32 {
    let own: Vec<usize> = own_handles.iter().filter_map(handle_to_usize).collect();
    imp::sweep(excluded, &own)
}

#[cfg(target_os = "macos")]
mod imp {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    const NS_WINDOW_SHARING_NONE: usize = 0;
    const NS_WINDOW_SHARING_READ_ONLY: usize = 1;

    pub fn sweep(excluded: bool, own_views: &[usize]) -> u32 {
        let want = if excluded { NS_WINDOW_SHARING_NONE } else { NS_WINDOW_SHARING_READ_ONLY };
        let mut changed = 0u32;
        // SAFETY:
        //   - Called on the main thread (Electron main-process JS), as AppKit
        //     requires for NSApp / NSWindow access.
        //   - The own-window handles are content NSViews Electron keeps alive
        //     for the duration of the call; `window` on a live view is safe.
        //   - Every selector is standard AppKit on NSApplication / NSArray /
        //     NSWindow; none can throw for valid receivers.
        unsafe {
            let Some(app_class) = AnyClass::get("NSApplication") else { return 0 };
            let app: *mut AnyObject = msg_send![app_class, sharedApplication];
            if app.is_null() {
                return 0;
            }
            let own_windows: Vec<usize> = own_views
                .iter()
                .map(|&view| {
                    let window: *mut AnyObject = msg_send![view as *mut AnyObject, window];
                    window as usize
                })
                .filter(|&w| w != 0)
                .collect();

            let windows: *mut AnyObject = msg_send![app, windows];
            if windows.is_null() {
                return 0;
            }
            let count: usize = msg_send![windows, count];
            for i in 0..count {
                let window: *mut AnyObject = msg_send![windows, objectAtIndex: i];
                if window.is_null() || own_windows.contains(&(window as usize)) {
                    continue;
                }
                // Unconditional, never "skip if already set": an activation
                // change makes the WindowServer silently reset a window's
                // sharing state while AppKit keeps reporting the value we set
                // (the same trap WindowHelper.applyContentProtection re-pushes
                // for). Measured 2026-09-27: a picker skipped by a compare
                // showed in ~3 captured frames right after the app activated.
                let _: () = msg_send![window, setSharingType: want];
                changed += 1;
            }
        }
        changed
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowDisplayAffinity, GetWindowThreadProcessId, SetWindowDisplayAffinity,
        WDA_EXCLUDEFROMCAPTURE, WDA_MONITOR, WDA_NONE,
    };

    struct Sweep<'a> {
        pid: u32,
        own: &'a [usize],
        excluded: bool,
        changed: u32,
    }

    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let sweep = &mut *(lparam.0 as *mut Sweep);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid != sweep.pid || sweep.own.contains(&(hwnd.0 as usize)) {
            return BOOL(1);
        }
        let mut current = 0u32;
        let _ = GetWindowDisplayAffinity(hwnd, &mut current);
        if sweep.excluded {
            if current == WDA_NONE.0 {
                // Before Windows 10 2004, WDA_EXCLUDEFROMCAPTURE is accepted
                // but behaves as WDA_MONITOR (a black box in the capture). The
                // WDA_MONITOR retry only matters if a build rejects the call.
                if SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE).is_ok()
                    || SetWindowDisplayAffinity(hwnd, WDA_MONITOR).is_ok()
                {
                    sweep.changed += 1;
                }
            }
        } else if current != WDA_NONE.0 && SetWindowDisplayAffinity(hwnd, WDA_NONE).is_ok() {
            sweep.changed += 1;
        }
        BOOL(1)
    }

    pub fn sweep(excluded: bool, own: &[usize]) -> u32 {
        let mut state = Sweep { pid: unsafe { GetCurrentProcessId() }, own, excluded, changed: 0 };
        // SAFETY: `state` outlives the synchronous EnumWindows call, and the
        // callback only reads/writes it through the LPARAM it was given.
        unsafe {
            let _ = EnumWindows(Some(visit), LPARAM(&mut state as *mut Sweep as isize));
        }
        state.changed
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    pub fn sweep(_excluded: bool, _own: &[usize]) -> u32 {
        0
    }
}
