//! Windows: clicks on a no-activate window are delivered, never eaten.
//!
//! The overlay family and the notes window are put under the no-activate
//! policy with BrowserWindow.setFocusable(false) (electron/utils/
//! windowsFocusPolicy.ts). Chromium then answers WM_MOUSEACTIVATE with
//! MA_NOACTIVATEANDEAT: "do not activate me, and DISCARD this button-down".
//!
//! Windows only asks when the click lands on a window that is not the active
//! window of its thread. While some Natively window is still the thread's
//! active window (a hidden launcher counts) it never asks, so the policy looked
//! fine. Once nothing of ours is active — the launcher's Start was clicked and
//! the launcher hid, and a notepad meeting shows only the notes window,
//! inactive — every button-down is eaten while moves and button-ups still
//! arrive: hover works, nothing can be clicked or typed into (typing starts
//! from a click). Measured on the notes window, 2026-11-02.
//!
//! The fix is the answer the policy always meant: MA_NOACTIVATE, "do not
//! activate, but deliver the click". The window is subclassed once; every
//! other message goes to the original window procedure untouched.

#![cfg(target_os = "windows")]

use std::sync::Mutex;

use napi::bindgen_prelude::*;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, DefWindowProcW, IsWindow, SetWindowLongPtrW, GWLP_WNDPROC, MA_NOACTIVATE,
    WM_MOUSEACTIVATE, WM_NCDESTROY, WNDPROC,
};

/// (hwnd, original window procedure) for every subclassed window.
static ORIGINAL_PROCS: Mutex<Vec<(isize, isize)>> = Mutex::new(Vec::new());

fn original_proc(hwnd: HWND) -> Option<isize> {
    let procs = ORIGINAL_PROCS.lock().unwrap_or_else(|p| p.into_inner());
    procs.iter().find(|(h, _)| *h == hwnd.0).map(|(_, p)| *p)
}

unsafe extern "system" fn deliver_clicks_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_MOUSEACTIVATE {
        return LRESULT(MA_NOACTIVATE as isize);
    }
    let Some(original) = original_proc(hwnd) else {
        return DefWindowProcW(hwnd, msg, wparam, lparam);
    };
    if msg == WM_NCDESTROY {
        // The last message the window gets: hand it back to its own procedure.
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC, original);
        ORIGINAL_PROCS
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .retain(|(h, _)| *h != hwnd.0);
    }
    // SAFETY: `original` is the value GWLP_WNDPROC held before we replaced it.
    let original: WNDPROC = std::mem::transmute(original);
    CallWindowProcW(original, hwnd, msg, wparam, lparam)
}

/// Make the BrowserWindow whose handle is passed in (getNativeWindowHandle())
/// answer WM_MOUSEACTIVATE with MA_NOACTIVATE. Idempotent. Returns whether the
/// window is now subclassed.
#[napi]
pub fn deliver_clicks_without_activation(handle: Buffer) -> Result<bool> {
    let bytes = handle.as_ref();
    let bytes: [u8; std::mem::size_of::<isize>()] = bytes.try_into().map_err(|_| {
        Error::new(
            Status::InvalidArg,
            format!("expected an HWND of {} bytes, got {}", std::mem::size_of::<isize>(), bytes.len()),
        )
    })?;
    let hwnd = HWND(isize::from_ne_bytes(bytes));
    // SAFETY: IsWindow accepts any value.
    if hwnd.0 == 0 || !unsafe { IsWindow(hwnd) }.as_bool() {
        return Err(Error::new(Status::InvalidArg, "not a window"));
    }

    let mut procs = ORIGINAL_PROCS.lock().unwrap_or_else(|p| p.into_inner());
    if procs.iter().any(|(h, _)| *h == hwnd.0) {
        return Ok(true);
    }
    // SAFETY: called on Electron's main thread, which owns the window.
    let proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT = deliver_clicks_proc;
    let original = unsafe { SetWindowLongPtrW(hwnd, GWLP_WNDPROC, proc as isize) };
    if original == 0 {
        return Ok(false);
    }
    procs.push((hwnd.0, original));
    Ok(true)
}
