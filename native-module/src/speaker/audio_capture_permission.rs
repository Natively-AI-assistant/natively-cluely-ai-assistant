// The macOS "System Audio Recording" grant a Core Audio process tap needs
// (TCC service kTCCServiceAudioCapture). Apple has no public API to read it, and
// a tap without it just delivers silence, so a user who declined the prompt saw
// no sign of why the other side was never transcribed. This reads it the way
// AudioCap (insidegui/AudioCap, Apple's tap sample in Swift) does: the private
// TCCAccessPreflight from TCC.framework, loaded at run time with dlopen. Nothing
// is linked, so native-link-checks stays clean, and if the symbol ever goes
// away the answer is "unknown", never a crash or a false "denied".

use cidre::cf;
use std::ffi::{c_char, c_int, c_void};

extern "C" {
    fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

const RTLD_NOW: c_int = 0x2;

/// TCCAccessPreflight(service, options): 0 granted, 1 denied, anything else
/// not decided yet (or unknown to this macOS).
type Preflight = unsafe extern "C" fn(service: *const c_void, options: *const c_void) -> c_int;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioCapturePermission {
    Granted,
    Denied,
    Unknown,
}

impl AudioCapturePermission {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Unknown => "unknown",
        }
    }
}

fn from_preflight(code: c_int) -> AudioCapturePermission {
    match code {
        0 => AudioCapturePermission::Granted,
        1 => AudioCapturePermission::Denied,
        _ => AudioCapturePermission::Unknown,
    }
}

pub fn audio_capture_permission() -> AudioCapturePermission {
    unsafe {
        let handle = dlopen(
            c"/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC".as_ptr(),
            RTLD_NOW,
        );
        if handle.is_null() {
            return AudioCapturePermission::Unknown;
        }
        let sym = dlsym(handle, c"TCCAccessPreflight".as_ptr());
        if sym.is_null() {
            return AudioCapturePermission::Unknown;
        }
        let preflight: Preflight = std::mem::transmute(sym);
        let service = cf::String::from_str("kTCCServiceAudioCapture");
        let ptr = &*service as *const cf::String as *const c_void;
        from_preflight(preflight(ptr, std::ptr::null()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preflight_codes_map_to_granted_denied_and_unknown() {
        assert_eq!(from_preflight(0), AudioCapturePermission::Granted);
        assert_eq!(from_preflight(1), AudioCapturePermission::Denied);
        assert_eq!(from_preflight(2), AudioCapturePermission::Unknown);
        assert_eq!(from_preflight(-1), AudioCapturePermission::Unknown);
    }

    #[test]
    fn reading_the_grant_never_panics() {
        let _ = audio_capture_permission().as_str();
    }
}
