import { execFileSync } from 'child_process';

/**
 * macOS-only: detect whether the user has a composition-based Input Method
 * Editor (IME) enabled, or one is currently selected.
 *
 * Why this exists:
 *   The CGEventTap-based stealth typing path captures keystrokes at the OS
 *   event-pipeline level — BEFORE the macOS Text Input System (TIS) routes
 *   them through the active input method. `CGEventKeyboardGetUnicodeString`
 *   honours the keyboard layout (US, AZERTY, dead keys), but it does NOT
 *   honour composition: pressing "z" with Simplified Pinyin selected still
 *   returns the literal "z", because pinyin composition happens at the
 *   NSTextInputClient layer one level above the tap. Auto-engaging the tap
 *   when the user clicks the chat input therefore breaks every CJK / IME
 *   user — they can only type Latin characters into the chat box.
 *
 * Cheap fallback: if any IME is present in the user's enabled input sources,
 * we skip auto-engaging the tap on click. The explicit activation hotkey
 * still works for users who deliberately opt into stealth typing.
 *
 * Detection mechanism:
 *   `defaults read com.apple.HIToolbox` returns the user's HIToolbox prefs.
 *   Each enabled input source carries `InputSourceKind` and `KeyboardLayout
 *   Name` keys; IMEs (Pinyin, Hangul, Kanji, Anthy, etc.) carry
 *   `InputSourceKind = "Keyboard Input Method"` and an ID prefixed with
 *   `com.apple.inputmethod.`. Plain layouts use `com.apple.keylayout.`.
 *
 *   We shell out once at startup (and on demand) and cache the boolean.
 *   `defaults` is a built-in macOS CLI; cost is ~10–30 ms per call.
 */

let cached: boolean | null = null;

function probeOnce(): boolean {
    try {
        const raw = execFileSync(
            'defaults',
            ['read', 'com.apple.HIToolbox'],
            { encoding: 'utf8', timeout: 1500 },
        );
        // The dump contains every enabled input source plus the currently
        // selected one. Either of these signals an IME is in play.
        if (/InputSourceKind\s*=\s*"?Keyboard Input Method"?/i.test(raw)) {
            return true;
        }
        if (/com\.apple\.inputmethod\./i.test(raw)) {
            return true;
        }
        return false;
    } catch {
        // `defaults` missing, prefs unreadable, timeout — fail open so we
        // never silently break stealth typing for users on a standard ASCII
        // layout. If the probe is unreliable, IME users still have the
        // hotkey path as an escape hatch.
        return false;
    }
}

/**
 * True when the stealth tap is safe to auto-engage (click-to-type). False
 * when an IME is enabled and would be broken by tap interception.
 *
 * Non-macOS: always true — there is no CGEventTap on those platforms, and
 * the Windows stealth focus path is independent of this gating.
 */
export function shouldAutoEngageStealthTap(): boolean {
    if (process.platform !== 'darwin') return true;
    if (cached === null) cached = !probeOnce();
    return cached;
}

/**
 * Force a re-read. Call when the user is likely to have changed their input
 * sources (e.g., from Settings, after a system input-source change event).
 * Cheap; no harm in calling occasionally.
 */
export function refreshImeDetection(): void {
    cached = null;
}
