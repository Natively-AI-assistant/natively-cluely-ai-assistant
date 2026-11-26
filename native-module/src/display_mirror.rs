//! Is this machine's screen being mirrored to another display right now?
//!
//! Undetectable mode keeps Natively out of screen CAPTURE (setContentProtection,
//! capture_exclusion.rs). A mirrored display is not a capture: the GPU scans the
//! same picture out to the laptop panel and the projector, so a protected window
//! shows on both. There is no way to show a window on one output of a mirror set
//! and not the other, so the app hides its windows instead
//! (electron/services/presentationMirrorGuard.ts). This module only answers the
//! question; Electron's `screen` API cannot, because it reports a mirror set as
//! a single display.
//!
//!   macOS   — `CGGetOnlineDisplayList` (unlike the active list it also returns
//!             the secondaries of a hardware mirror set), then
//!             `CGDisplayIsInMirrorSet` on each. Covers software and hardware
//!             mirroring. `wireless` is always false: CoreGraphics does not say
//!             whether a display is an AirPlay receiver.
//!   Windows — `QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS)`. In Duplicate (clone)
//!             mode on one graphics adapter, two or more active paths share one
//!             source. Across adapters (a laptop panel duplicated to a
//!             DisplayLink dock, or to a second GPU) each adapter has its own
//!             source, but both sit on the same desktop rectangle, which an
//!             extended desktop never does. Either counts. A target whose
//!             output technology is Miracast marks the set as wireless.
//!
//! Cheap enough to poll: one CoreGraphics list or one display-config query, no
//! allocation beyond the path array.

#[napi(object)]
pub struct DisplayMirrorState {
    /// Some display is showing the same picture as another one.
    pub mirrored: bool,
    /// Windows only: a mirrored set includes a Miracast (wireless) display.
    pub wireless: bool,
    /// How many displays are in a mirror set (0 when not mirrored).
    pub mirrored_displays: u32,
}

#[napi]
pub fn get_display_mirror_state() -> DisplayMirrorState {
    imp::read()
}

/// Where a source sits on the virtual desktop, in desktop pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DesktopRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl DesktopRect {
    fn overlaps(&self, other: &DesktopRect) -> bool {
        // i64: x + width can pass i32::MAX on a very wide desktop.
        let (ax0, ay0) = (self.x as i64, self.y as i64);
        let (ax1, ay1) = (ax0 + self.width as i64, ay0 + self.height as i64);
        let (bx0, by0) = (other.x as i64, other.y as i64);
        let (bx1, by1) = (bx0 + other.width as i64, by0 + other.height as i64);
        ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1
    }
}

/// One active display path: the picture it shows (`source`, and that source's
/// place on the desktop when the mode is known) and whether its output is a
/// Miracast receiver. Platform-free so the grouping is unit-tested on every OS,
/// even though only the Windows reader produces these.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PathSource {
    pub adapter_low: u32,
    pub adapter_high: i32,
    pub source_id: u32,
    pub rect: Option<DesktopRect>,
    pub miracast: bool,
}

/// Two paths show the same picture: one source on one adapter (clone mode),
/// or sources on different adapters covering the same part of the desktop
/// (cross-adapter clone). Extended displays tile the desktop without overlap.
fn same_picture(a: &PathSource, b: &PathSource) -> bool {
    let same_source =
        a.adapter_low == b.adapter_low && a.adapter_high == b.adapter_high && a.source_id == b.source_id;
    same_source || matches!((a.rect, b.rect), (Some(ra), Some(rb)) if ra.overlaps(&rb))
}

/// Clone mode is two or more active paths showing the same picture.
pub fn summarize_paths(paths: &[PathSource]) -> DisplayMirrorState {
    let mut mirrored_displays = 0u32;
    let mut wireless = false;
    for (i, path) in paths.iter().enumerate() {
        let shares = paths.iter().enumerate().any(|(j, other)| i != j && same_picture(path, other));
        if shares {
            mirrored_displays += 1;
            if path.miracast {
                wireless = true;
            }
        }
    }
    DisplayMirrorState { mirrored: mirrored_displays > 0, wireless, mirrored_displays }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::DisplayMirrorState;
    use core_graphics::display::{CGDirectDisplayID, CGDisplay};

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGGetOnlineDisplayList(max: u32, displays: *mut CGDirectDisplayID, count: *mut u32) -> i32;
    }

    fn online_displays() -> Vec<CGDirectDisplayID> {
        // SAFETY: the first call only writes the count; the second writes at
        // most `count` ids into a buffer of that length.
        unsafe {
            let mut count = 0u32;
            if CGGetOnlineDisplayList(0, std::ptr::null_mut(), &mut count) != 0 || count == 0 {
                return Vec::new();
            }
            let mut ids: Vec<CGDirectDisplayID> = vec![0; count as usize];
            let mut written = 0u32;
            if CGGetOnlineDisplayList(count, ids.as_mut_ptr(), &mut written) != 0 {
                return Vec::new();
            }
            ids.truncate(written as usize);
            ids
        }
    }

    pub fn read() -> DisplayMirrorState {
        let in_mirror_set = online_displays()
            .into_iter()
            .filter(|&id| CGDisplay::new(id).is_in_mirror_set())
            .count() as u32;
        DisplayMirrorState { mirrored: in_mirror_set > 0, wireless: false, mirrored_displays: in_mirror_set }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use super::{summarize_paths, DesktopRect, DisplayMirrorState, PathSource};
    use windows::Win32::Devices::Display::{
        GetDisplayConfigBufferSizes, QueryDisplayConfig, DISPLAYCONFIG_MODE_INFO,
        DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST,
        DISPLAYCONFIG_PATH_INFO, QDC_ONLY_ACTIVE_PATHS,
    };

    // DISPLAYCONFIG_PATH_ACTIVE (wingdi.h). The crate puts it under
    // Win32_Graphics_Gdi, a feature this module needs nothing else from.
    const DISPLAYCONFIG_PATH_ACTIVE: u32 = 0x1;

    type Config = (Vec<DISPLAYCONFIG_PATH_INFO>, Vec<DISPLAYCONFIG_MODE_INFO>);

    fn query() -> Option<Config> {
        // The configuration can change between the size query and the read
        // (a display plugged in at that moment); the read then fails with
        // ERROR_INSUFFICIENT_BUFFER, so size again and retry.
        for _ in 0..3 {
            let mut path_count = 0u32;
            let mut mode_count = 0u32;
            // SAFETY: both out-pointers are valid u32s; the buffers passed to
            // QueryDisplayConfig hold exactly the counts it is told about.
            unsafe {
                if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count).is_err() {
                    return None;
                }
                let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
                let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
                let read = QueryDisplayConfig(
                    QDC_ONLY_ACTIVE_PATHS,
                    &mut path_count,
                    paths.as_mut_ptr(),
                    &mut mode_count,
                    modes.as_mut_ptr(),
                    None,
                );
                if read.is_ok() {
                    paths.truncate(path_count as usize);
                    modes.truncate(mode_count as usize);
                    return Some((paths, modes));
                }
            }
        }
        None
    }

    /// The source's desktop rectangle, from the mode its path points at.
    /// None when the index is DISPLAYCONFIG_PATH_MODE_IDX_INVALID (out of
    /// range here) or names a mode that is not a source mode.
    fn source_rect(path: &DISPLAYCONFIG_PATH_INFO, modes: &[DISPLAYCONFIG_MODE_INFO]) -> Option<DesktopRect> {
        // SAFETY: without QDC_VIRTUAL_MODE_AWARE the union holds modeInfoIdx,
        // and a mode whose infoType is SOURCE holds sourceMode.
        unsafe {
            let mode = modes.get(path.sourceInfo.Anonymous.modeInfoIdx as usize)?;
            if mode.infoType != DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE {
                return None;
            }
            let source = mode.Anonymous.sourceMode;
            Some(DesktopRect {
                x: source.position.x,
                y: source.position.y,
                width: source.width,
                height: source.height,
            })
        }
    }

    pub fn read() -> DisplayMirrorState {
        let Some((paths, modes)) = query() else {
            return DisplayMirrorState { mirrored: false, wireless: false, mirrored_displays: 0 };
        };
        let sources: Vec<PathSource> = paths
            .iter()
            .filter(|p| p.flags & DISPLAYCONFIG_PATH_ACTIVE != 0)
            .map(|p| PathSource {
                adapter_low: p.sourceInfo.adapterId.LowPart,
                adapter_high: p.sourceInfo.adapterId.HighPart,
                source_id: p.sourceInfo.id,
                rect: source_rect(p, &modes),
                miracast: p.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST,
            })
            .collect();
        summarize_paths(&sources)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    use super::DisplayMirrorState;

    pub fn read() -> DisplayMirrorState {
        DisplayMirrorState { mirrored: false, wireless: false, mirrored_displays: 0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(source_id: u32, miracast: bool) -> PathSource {
        PathSource { adapter_low: 7, adapter_high: 0, source_id, rect: None, miracast }
    }

    fn at(adapter_low: u32, source_id: u32, x: i32, y: i32, width: u32, height: u32) -> PathSource {
        PathSource {
            adapter_low,
            adapter_high: 0,
            source_id,
            rect: Some(DesktopRect { x, y, width, height }),
            miracast: false,
        }
    }

    #[test]
    fn one_display_is_not_mirrored() {
        let s = summarize_paths(&[path(0, false)]);
        assert!(!s.mirrored);
        assert_eq!(s.mirrored_displays, 0);
    }

    #[test]
    fn extended_desktop_is_not_mirrored() {
        let s = summarize_paths(&[path(0, false), path(1, false)]);
        assert!(!s.mirrored);
    }

    #[test]
    fn duplicate_mode_is_mirrored() {
        let s = summarize_paths(&[path(0, false), path(0, false)]);
        assert!(s.mirrored);
        assert!(!s.wireless);
        assert_eq!(s.mirrored_displays, 2);
    }

    #[test]
    fn miracast_duplicate_is_wireless() {
        let s = summarize_paths(&[path(0, false), path(0, true)]);
        assert!(s.mirrored);
        assert!(s.wireless);
    }

    #[test]
    fn miracast_extended_is_not_mirrored() {
        let s = summarize_paths(&[path(0, false), path(1, true)]);
        assert!(!s.mirrored);
        assert!(!s.wireless);
    }

    #[test]
    fn same_source_id_on_another_adapter_is_not_a_clone() {
        let other = PathSource { adapter_low: 9, adapter_high: 0, source_id: 0, rect: None, miracast: false };
        let s = summarize_paths(&[path(0, false), other]);
        assert!(!s.mirrored);
    }

    #[test]
    fn three_outputs_two_cloned() {
        let s = summarize_paths(&[path(0, false), path(0, false), path(1, false)]);
        assert!(s.mirrored);
        assert_eq!(s.mirrored_displays, 2);
    }
    #[test]
    fn cross_adapter_duplicate_is_mirrored() {
        // Laptop panel on the GPU, the projector on a DisplayLink dock: two
        // adapters, two sources, one desktop rectangle.
        let s = summarize_paths(&[at(7, 0, 0, 0, 1920, 1080), at(42, 0, 0, 0, 1920, 1080)]);
        assert!(s.mirrored);
        assert_eq!(s.mirrored_displays, 2);
    }

    #[test]
    fn cross_adapter_extended_is_not_mirrored() {
        let s = summarize_paths(&[at(7, 0, 0, 0, 1920, 1080), at(42, 0, 1920, 0, 1920, 1080)]);
        assert!(!s.mirrored);
    }

    #[test]
    fn touching_edges_are_not_an_overlap() {
        // Stacked vertically and side by side: extended, sharing only an edge.
        let s = summarize_paths(&[
            at(7, 0, 0, 0, 1920, 1080),
            at(7, 1, 0, 1080, 1920, 1080),
            at(42, 0, -2560, 0, 2560, 1440),
        ]);
        assert!(!s.mirrored);
    }

    #[test]
    fn extended_desktop_with_known_rects_on_one_adapter_is_not_mirrored() {
        let s = summarize_paths(&[at(7, 0, 0, 0, 2880, 1800), at(7, 1, 2880, 0, 1920, 1080)]);
        assert!(!s.mirrored);
    }

    #[test]
    fn cross_adapter_clone_beside_an_extended_display() {
        let s = summarize_paths(&[
            at(7, 0, 0, 0, 1920, 1080),
            at(42, 0, 0, 0, 1920, 1080),
            at(7, 1, 1920, 0, 1920, 1080),
        ]);
        assert!(s.mirrored);
        assert_eq!(s.mirrored_displays, 2);
    }

    #[test]
    fn far_off_desktop_coordinates_do_not_overflow() {
        let s = summarize_paths(&[at(7, 0, i32::MAX - 10, 0, 1920, 1080), at(42, 0, 0, 0, 1920, 1080)]);
        assert!(!s.mirrored);
    }
}
