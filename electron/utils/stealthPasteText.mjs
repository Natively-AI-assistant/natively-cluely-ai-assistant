// Clipboard-text normalisation for the Windows stealth paste path.
//
// Pure and dependency-free (no electron import) so both platform branches are
// unit-testable from either OS — same rationale as windowsFocusPolicy.ts.
// StealthKeyboardManager owns the clipboard read and the IPC send; this module
// owns only the shape of the text.
//
// WHY THIS PATH EXISTS: on macOS the overlay chat input holds real DOM focus,
// so Chromium services Cmd+V itself and never reaches this code. On Windows the
// overlay is WS_EX_NOACTIVATE and is never focused, so there is no DOM paste to
// service — the native hook swallows Ctrl+V (see the EDIT-CHORD SWALLOW in
// native-module/src/keyboard_hook_windows.rs) and the clipboard text is typed
// in through the same channel as ordinary keystrokes.

/**
 * Upper bound on a single stealth paste, in characters.
 *
 * The destination is a one-line question box, not a document editor. Without a
 * cap, pasting a large file's contents would push a multi-megabyte string
 * through IPC and into a React `setInputValue` — the renderer stalls, and the
 * overlay is the one surface that must never freeze mid-meeting. Generous
 * enough that no realistic question or pasted snippet is touched.
 */
export const MAX_STEALTH_PASTE_CHARS = 8000;

/**
 * Flatten clipboard text into something a single-line <input> can hold.
 *
 * - CRLF / CR / LF / tabs → a single space, so a multi-line paste reads as one
 *   continuous question instead of losing its line breaks' word spacing.
 * - Other C0/C1 control characters are dropped: they cannot be typed, render as
 *   nothing or as tofu, and NUL in particular truncates strings in some
 *   downstream consumers.
 * - A clipboard that is entirely whitespace yields '' so the caller can skip the
 *   send, rather than appending a stray space to the user's input.
 *
 * @param {string | null | undefined} raw
 * @returns {string}
 */
export function normalizePastedText(raw) {
  if (!raw) return '';
  const flattened = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\n\t]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  if (!flattened.trim()) return '';
  return flattened.slice(0, MAX_STEALTH_PASTE_CHARS);
}
