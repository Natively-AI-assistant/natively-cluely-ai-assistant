//! What the meeting apps on this computer are doing, for meeting detection
//! (electron/services/meetingDetection). Read-only; nothing here opens a
//! device, a window or a permission prompt.
//!
//! `get_mic_users()`: who is capturing from a microphone right now.
//!   macOS 14+ — CoreAudio's process objects (kAudioHardwarePropertyProcessObjectList)
//!               with kAudioProcessPropertyIsRunningInput, plus the pid, bundle id
//!               and executable path (proc_pidpath). Reading them starts no audio
//!               IO, so no microphone indicator: measured 2026-09-27, a reader
//!               polling every second never listed itself, and an ffmpeg capture
//!               appeared within a second and left when it stopped. Before macOS
//!               14 there is no per-process list: None.
//!   Windows   — the Capability Access Manager's microphone consent store under
//!               HKCU, which Windows keeps per app: LastUsedTimeStop is 0 while the
//!               app is using the microphone. NonPackaged entries are executable
//!               paths ('#' for '\'); the others are packaged apps' family names
//!               (new Teams is MSTeams_8wekyb3d8bbwe). No pid: the store is per app.
//!
//! `get_visible_windows()`: the on-screen top-level windows, with the owning
//! process and title.
//!   macOS     — CGWindowListCopyWindowInfo, normal layer only. Titles need Screen
//!               Recording permission; without it they are empty (no prompt).
//!   Windows   — EnumWindows + IsWindowVisible + GetWindowTextW +
//!               QueryFullProcessImageNameW.

use napi_derive::napi;

#[napi(object)]
pub struct MicUser {
    /// macOS: the capturing process. Windows: unknown (the consent store is per app).
    pub pid: Option<i32>,
    /// macOS: the process's bundle id. Windows: a packaged app's family name.
    pub bundle_id: Option<String>,
    /// The executable: macOS proc_pidpath; Windows a NonPackaged entry's path.
    pub path: Option<String>,
}

#[napi(object)]
pub struct WindowInfo {
    pub pid: i32,
    /// The owning app's name (macOS kCGWindowOwnerName; Windows the exe's file name).
    pub owner: String,
    /// Empty when unknown (macOS without Screen Recording permission).
    pub title: String,
    pub path: Option<String>,
}

/// Who is capturing from a microphone right now; null where the OS can't say.
#[napi]
pub fn get_mic_users() -> Option<Vec<MicUser>> {
    imp::mic_users()
}

/// The visible top-level windows; null where the OS can't say.
#[napi]
pub fn get_visible_windows() -> Option<Vec<WindowInfo>> {
    imp::windows()
}

/// Bounds a window list (a machine with hundreds of windows gets the first 300).
const MAX_WINDOWS: usize = 300;

#[cfg(target_os = "macos")]
mod imp {
    use super::{MicUser, WindowInfo, MAX_WINDOWS};
    use cidre::core_audio as ca;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowLayer, kCGWindowListExcludeDesktopElements,
        kCGWindowListOptionOnScreenOnly, kCGWindowName, kCGWindowOwnerName, kCGWindowOwnerPID,
    };

    extern "C" {
        // libproc (libSystem): the executable path of a pid.
        fn proc_pidpath(pid: i32, buffer: *mut std::ffi::c_void, buffersize: u32) -> i32;
    }

    pub fn path_of(pid: i32) -> Option<String> {
        if pid <= 0 {
            return None;
        }
        let mut buf = vec![0u8; 4096];
        // SAFETY: the buffer is 4096 bytes (PROC_PIDPATHINFO_MAXSIZE) and we pass its length.
        let n = unsafe { proc_pidpath(pid, buf.as_mut_ptr() as *mut _, buf.len() as u32) };
        if n <= 0 {
            return None;
        }
        buf.truncate(n as usize);
        String::from_utf8(buf).ok()
    }

    pub fn mic_users() -> Option<Vec<MicUser>> {
        let procs = ca::System::processes().ok()?;
        Some(
            procs
                .iter()
                .filter(|p| p.is_running_input().unwrap_or(false))
                .map(|p| {
                    let pid = p.pid().ok();
                    MicUser {
                        pid,
                        bundle_id: p.bundle_id().ok().map(|b| b.to_string()).filter(|s| !s.is_empty()),
                        path: pid.and_then(path_of),
                    }
                })
                .collect(),
        )
    }

    fn key(k: core_foundation::string::CFStringRef) -> CFString {
        // SAFETY: the kCGWindow* keys are static CFStrings owned by CoreGraphics.
        unsafe { CFString::wrap_under_get_rule(k) }
    }

    pub fn windows() -> Option<Vec<WindowInfo>> {
        let list = copy_window_info(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID)?;
        let (k_pid, k_owner, k_name, k_layer) = unsafe {
            (key(kCGWindowOwnerPID), key(kCGWindowOwnerName), key(kCGWindowName), key(kCGWindowLayer))
        };
        let mut out = Vec::new();
        for item in list.iter() {
            // SAFETY: each element of the window-info array is a CFDictionary
            // (documented), alive for as long as `list` is.
            let dict: CFDictionary<CFString, CFType> =
                unsafe { CFDictionary::wrap_under_get_rule(*item as core_foundation::dictionary::CFDictionaryRef) };
            let number = |k: &CFString| dict.find(k).and_then(|v| v.downcast::<CFNumber>()).and_then(|n| n.to_i64());
            let string = |k: &CFString| dict.find(k).and_then(|v| v.downcast::<CFString>()).map(|s| s.to_string());
            // Layer 0 is the normal app windows; menu bar, Dock and overlays sit above.
            if number(&k_layer).unwrap_or(0) != 0 {
                continue;
            }
            let pid = number(&k_pid).unwrap_or(-1) as i32;
            out.push(WindowInfo {
                pid,
                owner: string(&k_owner).unwrap_or_default(),
                title: string(&k_name).unwrap_or_default(),
                path: path_of(pid),
            });
            if out.len() >= MAX_WINDOWS {
                break;
            }
        }
        Some(out)
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use super::{MicUser, WindowInfo, MAX_WINDOWS};
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    };

    const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// An open registry key, closed when dropped.
    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            // SAFETY: the handle came from RegOpenKeyExW and is closed once.
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    fn open(parent: HKEY, sub: &str) -> Option<Key> {
        let name = wide(sub);
        let mut key = HKEY::default();
        // SAFETY: `name` is NUL-terminated and outlives the call; `key` receives the handle.
        // (windows-rs 0.52: the registry calls return Result, not a WIN32_ERROR.)
        let opened = unsafe { RegOpenKeyExW(parent, PCWSTR(name.as_ptr()), 0, KEY_READ, &mut key) };
        opened.is_ok().then_some(Key(key))
    }

    fn subkeys(key: &Key) -> Vec<String> {
        let mut out = Vec::new();
        for index in 0..4096u32 {
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            // SAFETY: `buf`/`len` describe a writable buffer of `len` UTF-16 units.
            let listed = unsafe {
                RegEnumKeyExW(key.0, index, PWSTR(buf.as_mut_ptr()), &mut len, None, PWSTR::null(), None, None)
            };
            if listed.is_err() {
                break; // ERROR_NO_MORE_ITEMS, or a name too long to be an app
            }
            out.push(String::from_utf16_lossy(&buf[..len as usize]));
        }
        out
    }

    fn qword(key: &Key, value: &str) -> Option<u64> {
        let name = wide(value);
        let mut data = [0u8; 8];
        let mut len = data.len() as u32;
        // SAFETY: `data` holds `len` bytes; a QWORD value is 8.
        let read = unsafe {
            RegQueryValueExW(key.0, PCWSTR(name.as_ptr()), None, None, Some(data.as_mut_ptr()), Some(&mut len))
        };
        (read.is_ok() && len == 8).then(|| u64::from_le_bytes(data))
    }

    /// In use now: it started using the microphone and hasn't stopped.
    fn in_use(key: &Key) -> bool {
        qword(key, "LastUsedTimeStart").unwrap_or(0) > 0 && qword(key, "LastUsedTimeStop") == Some(0)
    }

    pub fn mic_users() -> Option<Vec<MicUser>> {
        let store = open(HKEY_CURRENT_USER, STORE)?;
        let mut out = Vec::new();
        for name in subkeys(&store) {
            if name.eq_ignore_ascii_case("NonPackaged") {
                let Some(np) = open(store.0, &name) else { continue };
                for exe in subkeys(&np) {
                    if open(np.0, &exe).is_some_and(|k| in_use(&k)) {
                        out.push(MicUser { pid: None, bundle_id: None, path: Some(exe.replace('#', "\\")) });
                    }
                }
            } else if open(store.0, &name).is_some_and(|k| in_use(&k)) {
                out.push(MicUser { pid: None, bundle_id: Some(name), path: None });
            }
        }
        Some(out)
    }

    fn image_path(pid: u32) -> Option<String> {
        // SAFETY: a query-only handle, closed below; the buffer length is passed in `size`.
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size).is_ok();
            let _ = CloseHandle(handle);
            ok.then(|| String::from_utf16_lossy(&buf[..size as usize]))
        }
    }

    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam.0 as *mut Vec<WindowInfo>);
        if out.len() >= MAX_WINDOWS {
            return BOOL(0);
        }
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return BOOL(1);
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(hwnd, &mut buf);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let path = image_path(pid);
        let owner = path
            .as_deref()
            .and_then(|p| p.rsplit('\\').next())
            .unwrap_or_default()
            .to_string();
        out.push(WindowInfo {
            pid: pid as i32,
            owner,
            title: String::from_utf16_lossy(&buf[..n.max(0) as usize]),
            path,
        });
        BOOL(1)
    }

    pub fn windows() -> Option<Vec<WindowInfo>> {
        let mut out: Vec<WindowInfo> = Vec::new();
        // SAFETY: `out` outlives the synchronous EnumWindows call and the callback
        // only touches it through the LPARAM it was given.
        unsafe {
            let _ = EnumWindows(Some(visit), LPARAM(&mut out as *mut Vec<WindowInfo> as isize));
        }
        Some(out)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    use super::{MicUser, WindowInfo};
    pub fn mic_users() -> Option<Vec<MicUser>> {
        None
    }
    pub fn windows() -> Option<Vec<WindowInfo>> {
        None
    }
}
