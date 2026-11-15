//! Which render endpoint the Windows system-audio loopback binds to, in order
//! of preference (F-PLT-01, 2026-11-13).
//!
//! WASAPI loopback captures ONE render endpoint. Windows keeps two role
//! defaults that can differ: eConsole (music, browsers: what the loopback
//! always used) and eCommunications (where Teams, Zoom and Discord play by
//! default, often a headset). Until now, when the eConsole default could not
//! be used, the capture failed outright, even with a working communications
//! headset plugged in.
//!
//! The order, unchanged where it existed:
//!   1. the device the user picked in Settings (when it is still there),
//!   2. the eConsole default (the default, exactly as before),
//!   3. the eCommunications default, as the fallback.
//! The same endpoint is never tried twice (both roles often point at one
//! device). Moving a running capture to the communications device when the
//! meeting plays there is done in JS (electron/audio/outputRouteMismatch.mjs).
//!
//! Pure: no COM, no `cfg`, so the order is unit-tested on macOS and Windows
//! alike. Only windows.rs calls it.

/// Why an endpoint is on the list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub enum LoopbackRole {
    /// The output device chosen in Settings.
    Explicit,
    /// Windows' default render device for the eConsole role.
    Console,
    /// Windows' default render device for the eCommunications role.
    Communications,
}

/// One endpoint to try.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub struct LoopbackTarget {
    pub id: String,
    pub role: LoopbackRole,
}

/// The endpoints to try, best first. `explicit` is the saved device id ("" and
/// "default" mean none); `console` / `communications` are the role defaults'
/// ids when Windows reports them. Ids are compared exactly (WASAPI endpoint
/// ids are stable strings).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn loopback_targets(
    explicit: Option<&str>,
    console: Option<&str>,
    communications: Option<&str>,
) -> Vec<LoopbackTarget> {
    let mut out: Vec<LoopbackTarget> = Vec::with_capacity(3);
    let candidates = [
        (explicit.filter(|id| *id != "default"), LoopbackRole::Explicit),
        (console, LoopbackRole::Console),
        (communications, LoopbackRole::Communications),
    ];
    for (id, role) in candidates {
        let Some(id) = id.map(str::trim).filter(|id| !id.is_empty()) else { continue };
        if out.iter().any(|t| t.id == id) {
            continue;
        }
        out.push(LoopbackTarget { id: id.to_string(), role });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roles(t: &[LoopbackTarget]) -> Vec<(&str, LoopbackRole)> {
        t.iter().map(|t| (t.id.as_str(), t.role)).collect()
    }

    #[test]
    fn console_default_stays_first_and_communications_is_the_fallback() {
        let t = loopback_targets(None, Some("speakers"), Some("headset"));
        assert_eq!(
            roles(&t),
            vec![("speakers", LoopbackRole::Console), ("headset", LoopbackRole::Communications)]
        );
    }

    #[test]
    fn a_chosen_device_leads_then_both_role_defaults() {
        let t = loopback_targets(Some("usb-dac"), Some("speakers"), Some("headset"));
        assert_eq!(
            roles(&t),
            vec![
                ("usb-dac", LoopbackRole::Explicit),
                ("speakers", LoopbackRole::Console),
                ("headset", LoopbackRole::Communications),
            ]
        );
    }

    #[test]
    fn one_device_for_both_roles_is_tried_once() {
        let t = loopback_targets(None, Some("speakers"), Some("speakers"));
        assert_eq!(roles(&t), vec![("speakers", LoopbackRole::Console)]);
        let t = loopback_targets(Some("speakers"), Some("speakers"), Some("headset"));
        assert_eq!(
            roles(&t),
            vec![("speakers", LoopbackRole::Explicit), ("headset", LoopbackRole::Communications)]
        );
    }

    #[test]
    fn no_console_default_falls_back_to_communications() {
        let t = loopback_targets(None, None, Some("headset"));
        assert_eq!(roles(&t), vec![("headset", LoopbackRole::Communications)]);
    }

    #[test]
    fn empty_and_default_ids_mean_none() {
        assert!(loopback_targets(Some(""), Some("  "), None).is_empty());
        let t = loopback_targets(Some("default"), Some("speakers"), None);
        assert_eq!(roles(&t), vec![("speakers", LoopbackRole::Console)]);
    }
}
