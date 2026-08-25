//! App-hotkey chord matching for the Windows WH_KEYBOARD_LL stealth hook.
//!
//! # Why this exists
//!
//! While stealth typing is engaged the hook is the FIRST thing to see every
//! keystroke, system-wide (see `keyboard_hook_windows.rs`). The app's own
//! global shortcuts are normally consumed by Win32 `RegisterHotKey`, but the OS
//! silently drops those registrations on sleep/wake, display/workspace change,
//! etc. During the recovery window (KeybindManager's 10 s health poll) a chord
//! whose registration is currently dead falls THROUGH the hook to the
//! foreground app — e.g. `Ctrl+Enter` drops a newline into the focused answer
//! field, `Ctrl+1..7` type digits. When the hook recognises the app's OWN
//! chord it swallows it (down + the matching up) and dispatches the action
//! itself, so the leak cannot happen regardless of `RegisterHotKey` state.
//!
//! # Scope (deliberately narrow)
//!
//! Only chords in the "printable-leak" subset are matched here: `Ctrl` (or
//! `Ctrl+Shift`) plus a completing key that would type a visible character —
//! letters, digits, Enter, Space. Chords involving `Alt` (AltGr ambiguity) or
//! `Win`, and nav/function completing keys (arrows, F-keys) are intentionally
//! NOT matched: they either can't leak a character or ride delicate
//! pass-through paths the hook already handles. Those keep their existing
//! `RegisterHotKey` behaviour untouched.
//!
//! # No winapi here on purpose
//!
//! This module is pure data + comparison so it compiles and unit-tests on every
//! platform (`cargo test` on macOS), even though it is only USED by the
//! Windows-gated hook. The hook builds the `mods` bitmask from `GetAsyncKeyState`
//! and passes it in; the VK is the raw `KBDLLHOOKSTRUCT.vkCode`.

#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

/// Modifier bitmask bits. This layout is a CONTRACT shared with the JS side
/// (`electron/services/winChord.ts` — `MOD_*`). Keep the two in lockstep.
pub const MOD_CTRL: u32 = 1 << 0;
pub const MOD_ALT: u32 = 1 << 1;
pub const MOD_SHIFT: u32 = 1 << 2;
pub const MOD_WIN: u32 = 1 << 3;

/// One registered app hotkey the hook should swallow + dispatch itself.
/// `vk` is the Win32 virtual-key of the COMPLETING key; `mods` is the exact set
/// of modifiers that must be held; `id` is the KeybindManager action id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppChord {
    pub vk: u32,
    pub mods: u32,
    pub id: String,
}

/// napi input mirror of `AppChord`, passed from JS into `start()`. Defined here
/// (unconditionally compiled) so BOTH the macOS `keyboard_tap` and the Windows
/// `keyboard_hook_windows` modules — which each expose the identical
/// `StealthKeyboardTap.start` surface — can reference one napi object with a
/// single generated TS type. `vk`/`mods` come from
/// `electron/services/winChord.ts` (which owns the accelerator→VK translation).
#[napi_derive::napi(object)]
pub struct AppChordInput {
    pub vk: u32,
    pub mods: u32,
    pub id: String,
}

impl AppChordInput {
    pub fn into_app_chord(self) -> AppChord {
        AppChord { vk: self.vk, mods: self.mods, id: self.id }
    }
}

/// Convert the JS-supplied table into the internal form, dropping nothing —
/// the JS side (`buildChordTable`) has already filtered to the safe subset, and
/// `match_app_chord` re-checks the subset defensively at match time.
pub fn app_chords_from_inputs(inputs: Vec<AppChordInput>) -> Vec<AppChord> {
    inputs.into_iter().map(AppChordInput::into_app_chord).collect()
}

/// True if `vk` is a completing key we allow in the printable-leak subset:
/// A–Z (0x41..=0x5A), 0–9 (0x30..=0x39), Enter (0x0D), Space (0x20).
/// Everything else (arrows, F-keys, nav, punctuation-by-scancode) is excluded.
pub fn is_printable_leak_vk(vk: u32) -> bool {
    matches!(vk, 0x30..=0x39 | 0x41..=0x5A | 0x0D | 0x20)
}

/// True if `mods` is a modifier set we are willing to swallow: `Ctrl` present,
/// `Alt` and `Win` absent. `Shift` is allowed. This mirrors the hook's own
/// insertion point (`ctrl && !alt`, before the Win pass-through has already
/// returned) so a match here can never override Alt/AltGr/Win handling.
pub fn is_safe_mods(mods: u32) -> bool {
    (mods & MOD_CTRL) != 0 && (mods & MOD_ALT) == 0 && (mods & MOD_WIN) == 0
}

/// Find the app chord matching `(vk, mods)` exactly, or `None`.
///
/// The modifier match is EXACT (`chord.mods == mods`), not subset: pressing
/// `Ctrl+Shift+Enter` must NOT fire a `Ctrl+Enter` bind, and vice-versa — they
/// are distinct shortcuts. A non-match falls through to the hook's existing
/// pass-through, so a miss degrades gracefully to today's behaviour.
///
/// Returns `None` unless the key is in the printable-leak subset AND the
/// modifiers are in the safe set — a defence-in-depth guard so a malformed
/// chord table (e.g. an `Alt` chord that slipped past the JS filter) can never
/// make the hook swallow something it shouldn't.
pub fn match_app_chord(chords: &[AppChord], vk: u32, mods: u32) -> Option<&str> {
    if !is_printable_leak_vk(vk) || !is_safe_mods(mods) {
        return None;
    }
    chords
        .iter()
        .find(|c| c.vk == vk && c.mods == mods)
        .map(|c| c.id.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chord(vk: u32, mods: u32, id: &str) -> AppChord {
        AppChord { vk, mods, id: id.to_string() }
    }

    #[test]
    fn matches_ctrl_enter_exactly() {
        let table = vec![chord(0x0D, MOD_CTRL, "general:process-screenshots")];
        assert_eq!(match_app_chord(&table, 0x0D, MOD_CTRL), Some("general:process-screenshots"));
    }

    #[test]
    fn ctrl_enter_does_not_fire_ctrl_shift_enter_bind() {
        // Distinct shortcuts: exact modifier match, not subset.
        let table = vec![chord(0x0D, MOD_CTRL | MOD_SHIFT, "general:capture-and-process")];
        assert_eq!(match_app_chord(&table, 0x0D, MOD_CTRL), None);
    }

    #[test]
    fn ctrl_shift_enter_matches_its_own_bind() {
        let table = vec![chord(0x0D, MOD_CTRL | MOD_SHIFT, "general:capture-and-process")];
        assert_eq!(
            match_app_chord(&table, 0x0D, MOD_CTRL | MOD_SHIFT),
            Some("general:capture-and-process")
        );
    }

    #[test]
    fn digit_chords_match() {
        let table = vec![
            chord(0x31, MOD_CTRL, "chat:whatToAnswer"), // Ctrl+1
            chord(0x35, MOD_CTRL, "chat:answer"),       // Ctrl+5
        ];
        assert_eq!(match_app_chord(&table, 0x31, MOD_CTRL), Some("chat:whatToAnswer"));
        assert_eq!(match_app_chord(&table, 0x35, MOD_CTRL), Some("chat:answer"));
        assert_eq!(match_app_chord(&table, 0x36, MOD_CTRL), None); // Ctrl+6 not in table
    }

    #[test]
    fn alt_chords_are_never_matched_even_if_in_table() {
        // Defence in depth: an Alt chord that slipped past the JS filter must
        // NOT be swallowed (AltGr on EU layouts produces real text).
        let table = vec![chord(0x0D, MOD_CTRL | MOD_ALT, "bogus")];
        assert_eq!(match_app_chord(&table, 0x0D, MOD_CTRL | MOD_ALT), None);
    }

    #[test]
    fn win_chords_are_never_matched() {
        let table = vec![chord(0x0D, MOD_CTRL | MOD_WIN, "bogus")];
        assert_eq!(match_app_chord(&table, 0x0D, MOD_CTRL | MOD_WIN), None);
    }

    #[test]
    fn bare_key_without_ctrl_is_never_matched() {
        // A lone printable key must keep flowing to the overlay as typed text.
        let table = vec![chord(0x41, 0, "bogus")]; // 'A' with no modifiers
        assert_eq!(match_app_chord(&table, 0x41, 0), None);
        assert_eq!(match_app_chord(&table, 0x41, MOD_SHIFT), None);
    }

    #[test]
    fn nav_and_function_keys_excluded() {
        // Arrow (VK_LEFT 0x25) / F1 (0x70): not printable-leak keys, never matched.
        let table = vec![chord(0x25, MOD_CTRL, "nav"), chord(0x70, MOD_CTRL, "fkey")];
        assert_eq!(match_app_chord(&table, 0x25, MOD_CTRL), None);
        assert_eq!(match_app_chord(&table, 0x70, MOD_CTRL), None);
    }

    #[test]
    fn space_is_a_printable_leak_key() {
        let table = vec![chord(0x20, MOD_CTRL | MOD_SHIFT, "chat:focusInput")];
        assert_eq!(
            match_app_chord(&table, 0x20, MOD_CTRL | MOD_SHIFT),
            Some("chat:focusInput")
        );
    }

    #[test]
    fn empty_table_matches_nothing() {
        assert_eq!(match_app_chord(&[], 0x0D, MOD_CTRL), None);
    }
}
