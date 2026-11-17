// Whether a focus on the Launcher's search box is the browser handing it back
// as the window becomes active, rather than anyone asking for the search
// (2026-11-17, user report). Chromium focuses the first focusable element of a
// page by itself when its window is shown again, and in the Launcher that is
// the search box. ⌘B shows the window without activating it, so that focus is
// silent until the window becomes active, usually by the user's first click.
// The box then opened the search (backdrop over the page), the click meant for
// the page was spent, and a second click was needed to close it.
//
// Restored = the focus lands within RESTORE_WINDOW_MS of the window becoming
// active, and the user did not press on the pill, press ⌘K or Tab within
// FOCUS_INTENT_MS. Every other focus (a screen reader moving to the box, say)
// still opens the search as before.

export const FOCUS_INTENT_MS = 1000;
export const RESTORE_WINDOW_MS = 250;

/**
 * @param {{ lastIntentAt: number, lastWindowFocusAt: number, now: number }} t
 *   Date.now() values; 0 when it never happened.
 * @returns {boolean}
 */
export function isRestoredSearchFocus({ lastIntentAt, lastWindowFocusAt, now }) {
  const recent = (at, ms) => at > 0 && now - at >= 0 && now - at <= ms;
  if (recent(lastIntentAt, FOCUS_INTENT_MS)) return false;
  return recent(lastWindowFocusAt, RESTORE_WINDOW_MS);
}
