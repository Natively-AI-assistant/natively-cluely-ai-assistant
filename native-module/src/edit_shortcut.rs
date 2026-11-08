//! Editing shortcuts for the overlay's own text box while stealth typing is
//! engaged: paste, select all, copy, cut (Ctrl+V/A/C/X on Windows, Cmd on
//! macOS).
//!
//! Both keyboard hooks pass every Ctrl/Cmd combination through to the
//! foreground app, so system shortcuts keep working. That also sent these four
//! to the meeting app: Ctrl+V pasted into whatever was underneath instead of
//! the overlay. The hooks now keep just these, deliver them to the renderer
//! tagged with the modifier flag, and swallow them.
//!
//! Pure and platform-free, so it compiles and unit-tests on every platform
//! (like app_chord).

use crate::app_chord::{AppChord, MOD_CTRL};

/// Renderer flag bits, the macOS CGEventFlags layout both hooks already use.
pub const FLAG_CTRL: u32 = 1 << 18;
pub const FLAG_OPT: u32 = 1 << 19;
pub const FLAG_CMD: u32 = 1 << 20;
pub const FLAG_SHIFT: u32 = 1 << 17;

const MAC_CHORD_MASK: u32 = FLAG_CMD | FLAG_OPT | FLAG_CTRL | FLAG_SHIFT;

/// macOS: the editing letters are taken with Cmd alone. With Shift they belong
/// to the meeting app: Zoom's Cmd+Shift+A mutes and Cmd+Shift+V starts video,
/// and the tap has no app-chord match ahead of this to keep them.
pub fn mac_is_edit_chord(flags: u32) -> bool {
    flags & MAC_CHORD_MASK == FLAG_CMD
}

/// macOS: word delete is Option+Backspace, Option alone.
pub fn mac_is_word_delete_chord(flags: u32) -> bool {
    flags & MAC_CHORD_MASK == FLAG_OPT
}

/// Windows: the editing letters and word delete are taken with Ctrl alone.
/// Not with Alt (AltGr text is Ctrl+Alt) and not with Shift, which leaves
/// Ctrl+Shift shortcuts to the meeting app as before.
pub fn windows_is_edit_chord(ctrl: bool, alt: bool, shift: bool) -> bool {
    ctrl && !alt && !shift
}

/// Windows word-delete trigger VKs: Backspace (0x08) and Delete (0x2E). Both map
/// to the overlay's single backward "delete last word" because the box has no
/// caret (nothing after the end). macOS uses Option+Backspace instead and keys
/// off the Backspace keycode directly, so this helper is Windows-only.
pub fn windows_vk_is_word_delete(vk: u32) -> bool {
    vk == 0x08 || vk == 0x2E
}

/// The command letter for a keystroke's character, if it is one of the editing
/// shortcuts. Case-insensitive; anything but a single character is not one.
pub fn edit_letter(chars: &str) -> Option<&'static str> {
    let mut it = chars.chars();
    let c = it.next()?;
    if it.next().is_some() {
        return None;
    }
    match c.to_ascii_lowercase() {
        'a' => Some("a"),
        'c' => Some("c"),
        'v' => Some("v"),
        'x' => Some("x"),
        _ => None,
    }
}

/// macOS: the command letter for a keystroke, from the character the layout
/// produces (so AZERTY and Dvorak follow their labels). When that character is
/// not ASCII (Russian, Greek, Hebrew, Arabic layouts can give their own letter
/// under Cmd), fall back to the ANSI key position, as Windows does through VKs:
/// kVK_ANSI_A = 0, X = 7, C = 8, V = 9. An ASCII character never falls back, so
/// Dvorak's "." on the V position is not taken for V; nor does a key with no
/// character at all.
pub fn mac_edit_letter(chars: &str, key_code: u16) -> Option<&'static str> {
    if chars.is_ascii() {
        return edit_letter(chars);
    }
    match key_code {
        0 => Some("a"),
        7 => Some("x"),
        8 => Some("c"),
        9 => Some("v"),
        _ => None,
    }
}

/// macOS: true when Cmd+`letter` is one of the app's own global shortcuts, so
/// the tap leaves it to the hot key rather than running it as an edit. The tap
/// sees keys before Carbon's hot keys do, so taking it would lose the user's
/// shortcut. `chords` comes from electron/services/macEditChord.ts: the
/// letter's VK code ('A' = 0x41) with MOD_CTRL standing for Cmd alone.
pub fn mac_edit_letter_is_app_chord(chords: &[AppChord], letter: &str) -> bool {
    let Some(vk) = letter.bytes().next().map(|b| b.to_ascii_uppercase() as u32) else {
        return false;
    };
    chords.iter().any(|c| c.vk == vk && c.mods == MOD_CTRL)
}

/// Windows: the command letter for a virtual-key code. Letter VKs are the
/// uppercase ASCII codes and are already mapped through the active layout, so
/// on AZERTY the key labelled A is VK_A wherever it sits.
pub fn windows_vk_letter(vk: u32) -> Option<&'static str> {
    if (0x41..=0x5A).contains(&vk) {
        edit_letter(&char::from(vk as u8).to_string())
    } else {
        None
    }
}

/// The macOS Backspace keycode (kVK_Delete) the renderer keys word delete off.
pub const MAC_KEYCODE_BACKSPACE: u32 = 51;

/// Windows: the editing key a key-down is, as the renderer reads it
/// (`key_code`, `chars`), or `None` when the hook should leave it alone.
/// Ctrl alone (see `windows_is_edit_chord`). Backspace and Delete are word
/// delete, sent as Backspace: the box has no caret, so both mean "the last
/// word". A letter VK is one of the four commands, sent as its letter.
pub fn windows_edit_key(vk: u32, ctrl: bool, alt: bool, shift: bool) -> Option<(u32, &'static str)> {
    if !windows_is_edit_chord(ctrl, alt, shift) {
        return None;
    }
    if windows_vk_is_word_delete(vk) {
        return Some((MAC_KEYCODE_BACKSPACE, ""));
    }
    windows_vk_letter(vk).map(|letter| (0, letter))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_four_editing_letters_and_nothing_else() {
        for (c, want) in [("v", "v"), ("V", "v"), ("a", "a"), ("C", "c"), ("x", "x")] {
            assert_eq!(edit_letter(c), Some(want), "{c}");
        }
        for c in ["b", "z", "1", "", "vv", "\u{16}", "é"] {
            assert_eq!(edit_letter(c), None, "{c:?}");
        }
    }

    #[test]
    fn mac_letters_follow_the_layout_then_the_ansi_position() {
        assert_eq!(mac_edit_letter("v", 9), Some("v"));
        assert_eq!(mac_edit_letter("v", 47), Some("v"), "Dvorak: V is where QWERTY has '.'");
        assert_eq!(mac_edit_letter(".", 9), None, "Dvorak: an ASCII character never falls back");
        assert_eq!(mac_edit_letter("q", 0), None, "AZERTY: the A position types q");
        assert_eq!(mac_edit_letter("\u{43c}", 9), Some("v"), "Russian: Cmd+V gives м");
        assert_eq!(mac_edit_letter("\u{3c6}", 8), Some("c"), "Greek");
        assert_eq!(mac_edit_letter("\u{5d4}", 7), Some("x"), "Hebrew");
        assert_eq!(mac_edit_letter("\u{436}", 0), Some("a"));
        assert_eq!(mac_edit_letter("\u{434}", 2), None, "a non-Latin letter elsewhere is not a shortcut");
        assert_eq!(mac_edit_letter("", 9), None, "no character at all: not swallowed on a guess");
    }

    #[test]
    fn windows_letter_vks_map_by_layout_letter() {
        assert_eq!(windows_vk_letter(0x56), Some("v")); // VK_V
        assert_eq!(windows_vk_letter(0x41), Some("a")); // VK_A
        assert_eq!(windows_vk_letter(0x43), Some("c")); // VK_C
        assert_eq!(windows_vk_letter(0x58), Some("x")); // VK_X
        assert_eq!(windows_vk_letter(0x5A), None); // VK_Z: not an editing shortcut here
        assert_eq!(windows_vk_letter(0x0D), None); // Enter
        assert_eq!(windows_vk_letter(0x76), None); // F7 (0x76 = 'v' in ASCII, not a letter VK)
    }

    #[test]
    fn flags_match_the_cgevent_layout_the_renderer_reads() {
        assert_eq!(FLAG_CTRL, 0x40000);
        assert_eq!(FLAG_OPT, 0x80000);
        assert_eq!(FLAG_CMD, 0x100000);
        assert_eq!(FLAG_SHIFT, 0x20000);
    }

    #[test]
    fn mac_chords_take_the_modifier_alone() {
        const CAPS: u32 = 1 << 16;
        const FN: u32 = 1 << 23;
        assert!(mac_is_edit_chord(FLAG_CMD));
        assert!(mac_is_edit_chord(FLAG_CMD | CAPS), "Caps Lock does not count");
        assert!(mac_is_edit_chord(FLAG_CMD | FN));
        assert!(!mac_is_edit_chord(FLAG_CMD | FLAG_SHIFT), "Cmd+Shift+A/V are Zoom's mute and video");
        assert!(!mac_is_edit_chord(FLAG_CMD | FLAG_OPT));
        assert!(!mac_is_edit_chord(FLAG_CMD | FLAG_CTRL));
        assert!(!mac_is_edit_chord(0));
        assert!(mac_is_word_delete_chord(FLAG_OPT));
        assert!(!mac_is_word_delete_chord(FLAG_OPT | FLAG_SHIFT));
        assert!(!mac_is_word_delete_chord(FLAG_CMD), "Cmd+Backspace is delete-to-line-start");
        assert!(!mac_is_word_delete_chord(FLAG_OPT | FLAG_CTRL));
    }

    #[test]
    fn windows_chords_take_ctrl_alone() {
        assert!(windows_is_edit_chord(true, false, false));
        assert!(!windows_is_edit_chord(true, false, true), "Ctrl+Shift stays with the meeting app");
        assert!(!windows_is_edit_chord(true, true, false), "AltGr (Ctrl+Alt) is text");
        assert!(!windows_is_edit_chord(false, false, false));
    }

    #[test]
    fn windows_word_delete_is_backspace_or_delete_only() {
        assert!(windows_vk_is_word_delete(0x08)); // VK_BACK
        assert!(windows_vk_is_word_delete(0x2E)); // VK_DELETE
        for vk in [0x56u32, 0x41, 0x0D, 0x20, 0x25, 0x2D] {
            assert!(!windows_vk_is_word_delete(vk), "{vk:#x} must not trigger word-delete");
        }
    }

    #[test]
    fn windows_edit_keys_are_what_the_renderer_reads() {
        assert_eq!(windows_edit_key(0x56, true, false, false), Some((0, "v")));
        assert_eq!(windows_edit_key(0x41, true, false, false), Some((0, "a")));
        assert_eq!(windows_edit_key(0x08, true, false, false), Some((51, "")), "Ctrl+Backspace");
        assert_eq!(windows_edit_key(0x2E, true, false, false), Some((51, "")), "Ctrl+Delete");
        assert_eq!(windows_edit_key(0x5A, true, false, false), None, "Ctrl+Z goes to the meeting app");
        assert_eq!(windows_edit_key(0x56, true, false, true), None, "Ctrl+Shift+V");
        assert_eq!(windows_edit_key(0x56, true, true, false), None, "AltGr+V is text");
        assert_eq!(windows_edit_key(0x08, false, false, false), None, "plain Backspace");
        assert_eq!(windows_edit_key(0x56, false, false, false), None, "plain V");
    }

    #[test]
    fn mac_leaves_the_apps_own_cmd_letter_binds_alone() {
        let chord = |vk: u32, mods: u32| AppChord { vk, mods, id: "x".into() };
        let table = vec![chord(0x56, MOD_CTRL)]; // Cmd+V bound to an action
        assert!(mac_edit_letter_is_app_chord(&table, "v"));
        assert!(!mac_edit_letter_is_app_chord(&table, "a"), "Cmd+A is still select all");
        assert!(!mac_edit_letter_is_app_chord(&[], "v"));
        let shifted = vec![chord(0x56, MOD_CTRL | crate::app_chord::MOD_SHIFT)];
        assert!(!mac_edit_letter_is_app_chord(&shifted, "v"), "Cmd+Shift+V is not Cmd+V");
    }
}
