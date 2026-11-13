#![cfg_attr(not(target_os = "linux"), allow(dead_code))]
//! Pure key decisions for the Linux evdev stealth tap (keyboard_evdev_linux.rs).
//! No I/O and no OS types, so it compiles and unit-tests on every platform.
//!
//! Mirrors the decisions keyboard_hook_windows.rs makes inside its hook proc —
//! same order, same renderer contract (macOS HID keycodes, Windows-VK chord
//! table) — with one difference forced by the OS: an evdev grab (EVIOCGRAB)
//! takes the WHOLE keyboard, and Linux has no per-key "pass this one on"
//! without re-injecting through uinput (not done: it needs write access to
//! /dev/uinput, a bigger privilege than reading /dev/input). So where the
//! Windows hook passes a key through (Alt/Win combos, Tab, arrows, F-keys, bare
//! modifiers) the Linux tap DROPS it for as long as the grab lasts. The grab is
//! short by design: Esc releases it, the manager's 10 s idle timer stops it, and
//! the tap's own idle backstop releases it regardless of JS.

use crate::app_chord::{match_app_chord, AppChord, MOD_ALT, MOD_CTRL, MOD_SHIFT};
use crate::edit_shortcut::windows_edit_key;

/// Modifiers currently held, tracked from the raw key events.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Held {
    pub ctrl: bool,
    pub shift: bool,
    /// Left Alt. Right Alt is AltGr on layouts that have one.
    pub alt: bool,
    pub altgr: bool,
    pub meta: bool,
}

/// What the tap does with one key-down.
#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    /// Swallowed, delivered to nobody.
    Drop,
    /// The app's own chord: deliver its action id.
    AppChord(String),
    /// Paste / copy / cut / select-all / word delete, as the renderer reads them.
    Edit { key_code: u32, chars: &'static str },
    /// Typing. `key_code` is the mac HID code for Esc/Return/Backspace, else 0
    /// and the caller supplies the layout's characters.
    Type { key_code: u32 },
}

pub const KEY_ESC: u16 = 1;
pub const KEY_BACKSPACE: u16 = 14;
pub const KEY_ENTER: u16 = 28;
pub const KEY_KPENTER: u16 = 96;

pub fn mac_keycode(code: u16) -> u32 {
    match code {
        KEY_ESC => 53,
        KEY_ENTER => 36,
        KEY_KPENTER => 76,
        KEY_BACKSPACE => 51,
        _ => 0,
    }
}

/// Keys the Windows hook lets through; here they are swallowed (see header).
pub fn is_dropped_key(code: u16) -> bool {
    matches!(code,
        15                              // Tab
        | 58 | 69 | 70                  // Caps/Num/Scroll lock
        | 99 | 119                      // PrintScreen, Pause
        | 102..=111                     // Home Up PgUp Left Right End Down PgDn Ins Del
        | 59..=68 | 87 | 88 | 183..=194 // F1-F24
        | 29 | 97 | 42 | 54 | 56 | 100 | 125 | 126 | 127 // modifiers, Compose
    )
}

/// Which modifier a key code is, for tracking.
pub fn apply_modifier(held: &mut Held, code: u16, down: bool) -> bool {
    match code {
        29 | 97 => held.ctrl = down,
        42 | 54 => held.shift = down,
        56 => held.alt = down,
        100 => held.altgr = down,
        125 | 126 => held.meta = down,
        _ => return false,
    }
    true
}

/// The Windows virtual-key of the completing key, which the chord table is
/// written in. `sym` is the layout's character for the key (letters follow the
/// layout, like VK_A on AZERTY); the physical QWERTY position is the fallback.
pub fn to_vk(code: u16, sym: Option<char>) -> Option<u32> {
    match code {
        KEY_BACKSPACE => return Some(0x08),
        KEY_ENTER | KEY_KPENTER => return Some(0x0D),
        57 => return Some(0x20),
        105 => return Some(0x25),
        103 => return Some(0x26),
        106 => return Some(0x27),
        108 => return Some(0x28),
        111 => return Some(0x2E),
        _ => {}
    }
    if let Some(c) = sym.filter(char::is_ascii_alphanumeric) {
        return Some(c.to_ascii_uppercase() as u32);
    }
    const ROWS: [(u16, &str); 4] = [(2, "1234567890"), (16, "QWERTYUIOP"), (30, "ASDFGHJKL"), (44, "ZXCVBNM")];
    ROWS.iter().find_map(|&(start, keys)| {
        code.checked_sub(start)
            .and_then(|i| keys.as_bytes().get(i as usize))
            .map(|&b| b as u32)
    })
}

pub fn decide(code: u16, vk: Option<u32>, h: &Held, chords: &[AppChord]) -> Action {
    if h.meta {
        return Action::Drop;
    }
    if h.ctrl {
        let mods = MOD_CTRL
            | if h.shift { MOD_SHIFT } else { 0 }
            | if h.alt { MOD_ALT } else { 0 };
        if let Some(id) = vk.and_then(|vk| match_app_chord(chords, vk, mods)) {
            return Action::AppChord(id.to_string());
        }
    }
    if let Some((key_code, chars)) = vk.and_then(|vk| windows_edit_key(vk, h.ctrl, h.alt, h.shift)) {
        return Action::Edit { key_code, chars };
    }
    if (h.ctrl || h.alt) || is_dropped_key(code) {
        return Action::Drop;
    }
    Action::Type { key_code: mac_keycode(code) }
}

/// Holding a key repeats it. Typing and Backspace should; Enter and Esc must not
/// (a held Enter would submit twice, a held Esc is already released).
pub fn repeats(code: u16) -> bool {
    !matches!(code, KEY_ESC | KEY_ENTER | KEY_KPENTER)
}

/// How long the grab may sit with no key before the tap lets go on its own.
pub const IDLE_RELEASE_MS: u64 = 5 * 60_000;

/// `NATIVELY_EVDEV_IDLE_MS` shortens the backstop (tests, and anyone wanting a
/// tighter leash). Never longer than the default: a typo cannot lengthen a grab.
pub fn idle_release_ms(env: Option<&str>) -> u64 {
    env.and_then(|v| v.parse::<u64>().ok())
        .filter(|&ms| ms > 0)
        .map_or(IDLE_RELEASE_MS, |ms| ms.min(IDLE_RELEASE_MS))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chord(vk: u32, mods: u32, id: &str) -> AppChord {
        AppChord { vk, mods, id: id.into() }
    }
    fn ctrl() -> Held { Held { ctrl: true, ..Held::default() } }

    #[test]
    fn special_keys_map_to_the_mac_codes_the_renderer_switches_on() {
        assert_eq!(mac_keycode(KEY_ESC), 53);
        assert_eq!(mac_keycode(KEY_ENTER), 36);
        assert_eq!(mac_keycode(KEY_KPENTER), 76);
        assert_eq!(mac_keycode(KEY_BACKSPACE), 51);
        assert_eq!(mac_keycode(30), 0, "A is identified by chars");
    }

    #[test]
    fn plain_typing_is_typed_and_navigation_is_dropped() {
        assert_eq!(decide(30, to_vk(30, Some('a')), &Held::default(), &[]), Action::Type { key_code: 0 });
        assert_eq!(decide(KEY_ESC, None, &Held::default(), &[]), Action::Type { key_code: 53 });
        for code in [15, 103, 105, 59, 58, 111] {
            assert_eq!(decide(code, None, &Held::default(), &[]), Action::Drop, "{code}");
        }
    }

    #[test]
    fn app_chord_needs_ctrl_and_exact_mods() {
        let chords = [chord(0x42, MOD_CTRL, "toggle"), chord(0x42, MOD_CTRL | MOD_SHIFT, "passthrough")];
        let vk = to_vk(48, Some('b'));
        assert_eq!(decide(48, vk, &ctrl(), &chords), Action::AppChord("toggle".into()));
        let both = Held { ctrl: true, shift: true, ..Held::default() };
        assert_eq!(decide(48, vk, &both, &chords), Action::AppChord("passthrough".into()));
        assert_eq!(decide(48, vk, &Held::default(), &chords), Action::Type { key_code: 0 });
    }

    #[test]
    fn edit_chords_need_ctrl_alone() {
        let v = to_vk(47, Some('v'));
        assert_eq!(decide(47, v, &ctrl(), &[]), Action::Edit { key_code: 0, chars: "v" });
        let with_shift = Held { ctrl: true, shift: true, ..Held::default() };
        assert_eq!(decide(47, v, &with_shift, &[]), Action::Drop);
        assert_eq!(decide(KEY_BACKSPACE, to_vk(KEY_BACKSPACE, None), &ctrl(), &[]), Action::Edit { key_code: 51, chars: "" });
    }

    #[test]
    fn alt_and_meta_combos_and_bare_modifiers_are_dropped_altgr_types() {
        let alt = Held { alt: true, ..Held::default() };
        assert_eq!(decide(30, to_vk(30, Some('a')), &alt, &[]), Action::Drop);
        let meta = Held { meta: true, ..Held::default() };
        assert_eq!(decide(30, to_vk(30, Some('a')), &meta, &[]), Action::Drop);
        assert_eq!(decide(56, None, &Held::default(), &[]), Action::Drop);
        let altgr = Held { altgr: true, ..Held::default() };
        assert_eq!(decide(30, to_vk(30, Some('a')), &altgr, &[]), Action::Type { key_code: 0 });
    }

    #[test]
    fn vk_follows_the_layout_letter_then_the_qwerty_position() {
        assert_eq!(to_vk(30, Some('q')), Some(0x51), "AZERTY: the A position types q");
        assert_eq!(to_vk(30, None), Some(0x41));
        assert_eq!(to_vk(2, None), Some(0x31));
        assert_eq!(to_vk(11, None), Some(0x30));
        assert_eq!(to_vk(50, None), Some(0x4D));
        assert_eq!(to_vk(57, None), Some(0x20));
        assert_eq!(to_vk(105, None), Some(0x25));
        assert_eq!(to_vk(1, None), None);
    }

    #[test]
    fn modifier_tracking_and_repeat_rules() {
        let mut h = Held::default();
        assert!(apply_modifier(&mut h, 97, true) && h.ctrl);
        assert!(apply_modifier(&mut h, 97, false) && !h.ctrl);
        assert!(!apply_modifier(&mut h, 30, true));
        assert!(repeats(KEY_BACKSPACE) && repeats(30));
        assert!(!repeats(KEY_ENTER) && !repeats(KEY_ESC));
    }

    #[test]
    fn idle_backstop_can_only_be_shortened() {
        assert_eq!(idle_release_ms(None), IDLE_RELEASE_MS);
        assert_eq!(idle_release_ms(Some("3000")), 3000);
        assert_eq!(idle_release_ms(Some("99999999")), IDLE_RELEASE_MS);
        assert_eq!(idle_release_ms(Some("0")), IDLE_RELEASE_MS);
        assert_eq!(idle_release_ms(Some("abc")), IDLE_RELEASE_MS);
    }
}
