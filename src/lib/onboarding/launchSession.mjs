// src/lib/onboarding/launchSession.mjs
//
// What the launcher's card scheduler remembers for ONE app run (2026-11-09):
// which full-window cards it has shown, which the user closed, and whether
// this run began with the first-run Welcome.
//
// Kept in sessionStorage, not memory. A launcher renderer that crashes is
// reloaded in the same window (main.ts render-process-gone), and a reload
// that forgot these let another card show in the same app run. sessionStorage
// survives that reload and is gone when the app quits. Every access is
// guarded: no storage (tests, a locked profile) just means memory only.
//
// One full-window card per launch (toaster policy, 2026-11-09). The one
// exception is the launch where the first-run Welcome happened: there the
// permissions card may be followed by one more card. Pure apart from the
// storage it is handed; no platform branches.

export const LAUNCH_SESSION_KEY = 'natively_orchestrator_launch_v1';

/** @returns {{ shown: string[], dismissed: string[], welcome: boolean }} */
export function emptyLaunchSession() {
  return { shown: [], dismissed: [], welcome: false };
}

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/** This run's record from `storage` (sessionStorage), or an empty one. */
export function loadLaunchSession(storage) {
  try {
    const raw = storage?.getItem?.(LAUNCH_SESSION_KEY);
    if (!raw) return emptyLaunchSession();
    const parsed = JSON.parse(raw);
    return { shown: strings(parsed?.shown), dismissed: strings(parsed?.dismissed), welcome: parsed?.welcome === true };
  } catch {
    return emptyLaunchSession();
  }
}

export function saveLaunchSession(storage, session) {
  try {
    storage?.setItem?.(LAUNCH_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* memory keeps it for this renderer */
  }
}

/**
 * May the card `id` show now, given what this launch has shown already?
 * Nothing shown yet: yes. On the Welcome launch, after only the permissions
 * card: one more (not permissions again). Otherwise: no.
 */
export function launchCapAllows(session, id) {
  const shown = session.shown;
  if (shown.length === 0) return true;
  return session.welcome && shown.length === 1 && shown[0] === 'permissions' && id !== 'permissions';
}
