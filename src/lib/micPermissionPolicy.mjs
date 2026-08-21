// src/lib/micPermissionPolicy.mjs
//
// CR-03 (code-review HIGH, 2026-08-21): F-706 made win32 report the REAL
// microphone status instead of a hardcoded 'granted', but nothing on win32 can
// ACT on a non-granted result — `permissions:request-mic` returns true without
// doing anything off darwin, the onboarding offers no settings link off darwin,
// and `allGranted` requires 'granted'. A Windows user whose mic toggle is off
// therefore sees a control that can never turn green and no way forward.
//
// The platform decision lives here, pure and injectable, so BOTH platform
// branches are testable without mutating process.platform (CLAUDE.md).

/**
 * Electron 43 `systemPreferences.getMediaAccessStatus('microphone')` returns
 * 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'.
 * @typedef {'granted'|'denied'|'not-determined'|'restricted'|'unknown'} MicStatus
 */

/**
 * How the user can actually reach a working microphone from `status`.
 *
 * - 'none'     — already usable, nothing to do.
 * - 'request'  — the OS can show a consent prompt (macOS only; askForMediaAccess
 *                is documented @platform darwin and is a no-op elsewhere).
 * - 'settings' — no programmatic request exists; send the user to the OS panel.
 * - 'policy'   — blocked by administrator policy. The settings panel will NOT
 *                help, so promising it there would be a dead end.
 *
 * @param {string|undefined|null} platform
 * @param {MicStatus|string|undefined|null} status
 * @returns {{ usable: boolean, remedy: 'none'|'request'|'settings'|'policy' }}
 */
export function classifyMicStatus(platform, status) {
  // 'unknown' means GetDeviceAccessStatus could not resolve the state — NOT
  // that it is denied. (Older Windows returns 'granted', per Electron's own
  // typings, so 'unknown' is a genuine query failure on Win10/11.) F-706's
  // stated intent is that a query failure must never LOCK a working machine out
  // of capture, so treat it as usable and offer no dead-end remedy.
  if (status === 'granted' || status === 'unknown') {
    return { usable: true, remedy: 'none' };
  }
  if (status === 'restricted') {
    // Administrator/group policy. A Settings deep-link cannot change this.
    return { usable: false, remedy: 'policy' };
  }
  // 'denied' | 'not-determined' | anything unrecognised.
  if (platform === 'darwin') {
    // macOS can still prompt for 'not-determined'; once 'denied' the prompt is
    // suppressed and the user must use System Settings — but askForMediaAccess
    // resolves with the existing status rather than failing, and the caller
    // re-reads status afterwards, so 'request' is safe for both.
    return { usable: false, remedy: status === 'denied' ? 'settings' : 'request' };
  }
  // win32 (and anything else): no programmatic request exists at all.
  return { usable: false, remedy: 'settings' };
}

/**
 * Deep link to the OS microphone privacy panel, or null when the platform has
 * none. Kept beside the classifier so the two cannot disagree about which
 * platforms have a reachable panel.
 * @param {string|undefined|null} platform
 * @returns {string|null}
 */
export function micSettingsUri(platform) {
  switch (platform) {
    case 'darwin':
      return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
    case 'win32':
      // Windows 10/11 privacy panel. There is no per-app grant API on Windows;
      // this panel is the ONLY remedy.
      return 'ms-settings:privacy-microphone';
    default:
      // Linux has no queryable per-app model here, so there is nothing to open.
      return null;
  }
}
