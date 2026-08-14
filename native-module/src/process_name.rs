//! Live process-name disguise for macOS Activity Monitor.
//!
//! ── The discovery this module is built on ──
//! Activity Monitor's "Process Name" column for a GUI app does NOT come from
//! the binary filename (that only drives `ps`/`top`/`pgrep`). It comes from
//! the app's **LaunchServices display name** (`LSDisplayName`), which is seeded
//! at launch from `CFBundleDisplayName`/`CFBundleName` but is a *mutable,
//! per-running-process* record in the LaunchServices database.
//!
//! That means a running app can rewrite its OWN Activity Monitor name at
//! runtime — with no bundle edit and no re-signing — by calling the private
//! LaunchServices SPI `_LSSetApplicationInformationItem` with the display-name
//! key. This is what lets the disguise switch live (Terminal → System Settings
//! → …) even on a Developer-ID-signed, notarized build: we never touch a file
//! on disk, so the code signature stays intact.
//!
//! The three symbols are undocumented SPI and live in the LaunchServices
//! framework, not in any public header, so we resolve them at runtime via
//! `dlsym`. Each lookup is null-checked: if a future macOS drops or renames
//! one, `set_process_display_name` returns `Ok(false)` and the caller degrades
//! to the static build-time disguise (binary + plist rename). This mirrors the
//! `respondsToSelector:`-then-degrade pattern in `stealth_window.rs`.

#![cfg(target_os = "macos")]

use core_foundation::base::TCFType;
use core_foundation::string::{CFString, CFStringRef};
use napi::bindgen_prelude::*;
use std::os::raw::{c_int, c_void};
use std::ptr;

// Opaque LaunchServices Application Serial Number reference. The real struct is
// private; we only ever pass the pointer straight back into the SPI.
type LSASNRef = *const c_void;

// _LSGetCurrentApplicationASN() -> LSASNRef
type LSGetCurrentApplicationASNFn = unsafe extern "C" fn() -> LSASNRef;

// _LSSetApplicationInformationItem(LSSessionID, LSASNRef, CFStringRef key,
//                                  CFStringRef value, CFDictionaryRef* outErr)
//   -> OSStatus
type LSSetApplicationInformationItemFn = unsafe extern "C" fn(
    c_int,
    LSASNRef,
    CFStringRef,
    CFStringRef,
    *mut *const c_void,
) -> c_int;

// kLSCurrentSession == -1 in <LaunchServices/LSInfo.h> — "the caller's own
// session". Verified working against a GUI-registered process (status 0,
// lsappinfo reflects the new name). -2 (kLSDefaultSessionID) was observed to
// be rejected for this SPI, so we use -1.
const K_LS_CURRENT_SESSION_ID: c_int = -1;

/// Resolve a symbol from the already-loaded global symbol table.
///
/// Electron links ApplicationServices (which re-exports LaunchServices), so the
/// SPI symbols are normally already resident in the process. We therefore look
/// them up with the global handle (`RTLD_DEFAULT`) and avoid `dlopen`ing — no
/// handle to leak, no framework-path assumptions. Returns null if not found.
unsafe fn global_sym(name: &[u8]) -> *mut c_void {
    // RTLD_DEFAULT searches all globally-visible loaded images. On macOS this
    // pseudo-handle is (void*)-2 — NOT null. Passing null resolves nothing.
    // (Linux defines RTLD_DEFAULT as null, but this module is macOS-only.)
    let rtld_default: *mut c_void = -2isize as *mut c_void;
    libc::dlsym(rtld_default, name.as_ptr() as *const _)
}

/// Live-rename the current process's Activity Monitor display name.
///
/// Passing the real product name (e.g. "Natively") restores the original
/// identity; passing a disguise (e.g. "System Settings") masks it.
///
/// Returns `Ok(true)` when LaunchServices accepted the change (OSStatus 0),
/// `Ok(false)` when any required SPI symbol is unavailable on this macOS or the
/// API rejected the call. Never errors for "unavailable" — the caller treats a
/// `false`/throw uniformly and falls back to the static build-time disguise.
#[napi]
pub fn set_process_display_name(name: String) -> Result<bool> {
    // SAFETY: each symbol is null-checked before being transmuted into a
    // callable fn pointer; the SPI signatures match <LaunchServices/LSInfo.h>
    // (private). We only pass an opaque ASN straight back into the API and a
    // CFString we own for the duration of the call. No pointer is retained.
    unsafe {
        let get_asn_ptr = global_sym(b"_LSGetCurrentApplicationASN\0");
        let set_item_ptr = global_sym(b"_LSSetApplicationInformationItem\0");
        // _kLSDisplayNameKey is a global CFStringRef; dlsym yields a pointer TO
        // that global, so we deref once to get the key itself.
        let display_key_ptr = global_sym(b"_kLSDisplayNameKey\0") as *const CFStringRef;

        if get_asn_ptr.is_null() || set_item_ptr.is_null() || display_key_ptr.is_null() {
            return Ok(false);
        }

        let get_asn: LSGetCurrentApplicationASNFn = std::mem::transmute(get_asn_ptr);
        let set_item: LSSetApplicationInformationItemFn = std::mem::transmute(set_item_ptr);
        let display_name_key: CFStringRef = *display_key_ptr;
        if display_name_key.is_null() {
            return Ok(false);
        }

        let asn = get_asn();
        if asn.is_null() {
            return Ok(false);
        }

        let value = CFString::new(&name);
        let status = set_item(
            K_LS_CURRENT_SESSION_ID,
            asn,
            display_name_key,
            value.as_concrete_TypeRef(),
            ptr::null_mut(),
        );

        Ok(status == 0)
    }
}
