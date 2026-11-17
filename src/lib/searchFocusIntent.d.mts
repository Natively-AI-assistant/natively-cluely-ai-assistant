export const FOCUS_INTENT_MS: number;
export const RESTORE_WINDOW_MS: number;
/** A focus on the Launcher's search box that the browser restored as the window became active (2026-11-17). */
export function isRestoredSearchFocus(t: { lastIntentAt: number; lastWindowFocusAt: number; now: number }): boolean;
