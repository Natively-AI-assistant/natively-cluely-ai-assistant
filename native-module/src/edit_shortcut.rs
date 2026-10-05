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

/// Renderer flag bits, the macOS CGEventFlags layout both hooks already use.
pub const FLAG_CTRL: u32 = 1 << 18;
pub const FLAG_OPT: u32 = 1 << 19;
pub const FLAG_CMD: u32 = 1 << 20;

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
    }

    #[test]
    fn windows_word_delete_is_backspace_or_delete_only() {
        assert!(windows_vk_is_word_delete(0x08)); // VK_BACK
        assert!(windows_vk_is_word_delete(0x2E)); // VK_DELETE
        for vk in [0x56u32, 0x41, 0x0D, 0x20, 0x25, 0x2D] {
            assert!(!windows_vk_is_word_delete(vk), "{vk:#x} must not trigger word-delete");
        }
    }
}
