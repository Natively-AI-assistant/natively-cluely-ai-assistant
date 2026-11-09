// src/lib/hindsightBannerPolicy.mjs
//
// What the launcher's long-term memory notice (HindsightStatusBanner.tsx)
// shows, and how long its ✕ holds (2026-11-09).
//
// Main broadcasts the Hindsight server's lifecycle ('spawning', 'ready',
// 'unreachable', 'spawn-failed', 'auth-failed'). Every broadcast used to
// clear the ✕, so a server that kept retrying brought the notice straight
// back. Now a close holds until something genuinely different happens: a
// failure other than the one closed (another state, or another reason), or a
// recovery ('ready') followed by a new failure. A retry ('spawning') never
// reopens a closed notice. Pure; no DOM, no platform branches.

/** @typedef {{ state: string, reason?: string, logPath?: string, at?: number }} HindsightStatus */
/** @typedef {{ status: HindsightStatus | null, dismissedKey: string | null }} HindsightBannerState */

/** @returns {HindsightBannerState} */
export function initialHindsightBanner() {
  return { status: null, dismissedKey: null };
}

/** What one status is, for telling a new failure from the one closed. */
export function hindsightStatusKey(status) {
  if (!status || typeof status.state !== 'string') return null;
  return `${status.state}|${status.reason ?? ''}`;
}

/** Apply a status from main (a broadcast, or the current one read on mount). */
export function applyHindsightStatus(prev, status) {
  if (!status || typeof status.state !== 'string') return prev;
  // Recovered: nothing to show, and the next failure is new.
  if (status.state === 'ready') return { status: null, dismissedKey: null };
  return { status, dismissedKey: prev.dismissedKey };
}

/** The user closed the notice: what it shows now stays closed. */
export function dismissHindsightBanner(prev) {
  return { ...prev, dismissedKey: hindsightStatusKey(prev.status) };
}

/** True when the ✕ still holds for what would be shown. */
export function hindsightBannerDismissed(state) {
  if (!state.dismissedKey) return false;
  const s = state.status;
  if (!s) return true;
  if (s.state === 'spawning') return true;
  return hindsightStatusKey(s) === state.dismissedKey;
}
