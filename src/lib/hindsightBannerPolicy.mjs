// src/lib/hindsightBannerPolicy.mjs
//
// What the launcher's long-term memory notice (HindsightStatusBanner.tsx)
// shows, and how long its ✕ holds (2026-11-09).
//
// Main broadcasts the Hindsight server's lifecycle ('spawning', 'ready',
// 'unreachable', 'spawn-failed', 'auth-failed'). Every broadcast used to
// clear the ✕, so a server that kept retrying brought the notice straight
// back. Now a close holds until the server actually recovers ('ready'): a
// crash-looping server flips between states and exit codes, and none of
// that reopens it. A failure after a recovery shows again. Pure; no DOM, no
// platform branches.

/** @typedef {{ state: string, reason?: string, logPath?: string, at?: number }} HindsightStatus */
/** @typedef {{ status: HindsightStatus | null, dismissed: boolean }} HindsightBannerState */

/** @returns {HindsightBannerState} */
export function initialHindsightBanner() {
  return { status: null, dismissed: false };
}

/** What one status is (state and reason), for logs and view keys. */
export function hindsightStatusKey(status) {
  if (!status || typeof status.state !== 'string') return null;
  return `${status.state}|${status.reason ?? ''}`;
}

/** Apply a status from main (a broadcast, or the current one read on mount). */
export function applyHindsightStatus(prev, status) {
  if (!status || typeof status.state !== 'string') return prev;
  // Recovered: nothing to show, and the next failure may show again.
  if (status.state === 'ready') return { status: null, dismissed: false };
  return { status, dismissed: prev.dismissed };
}

/** The user closed the notice: it stays closed until the server recovers. */
export function dismissHindsightBanner(prev) {
  return { ...prev, dismissed: true };
}

/** True while the ✕ holds. */
export function hindsightBannerDismissed(state) {
  return state.dismissed === true;
}
