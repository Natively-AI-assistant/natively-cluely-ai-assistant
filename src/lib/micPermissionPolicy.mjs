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
  // 'unknown' is only the `default:` arm of Electron's ConvertDeviceAccessStatus
  // — an enum value outside the four named ones — and is effectively unreachable
  // for the microphone. A genuine query failure does NOT land here: both
  // GetActivationFactory and CreateFromDeviceClass failures return
  // DeviceAccessStatus_Allowed ('granted'), and a failed get_CurrentStatus leaves
  // Unspecified ('not-determined'). So the win32 API fails OPEN, and treating an
  // out-of-range value as usable simply matches that: never lock a working
  // machine out over a status nobody can act on.
  if (status === 'granted' || status === 'unknown') {
    return { usable: true, remedy: 'none' };
  }

  if (platform === 'darwin') {
    // AVAuthorizationStatusRestricted: MDM or parental controls. Genuinely not
    // user-fixable, so offering the Settings pane would be a dead end.
    if (status === 'restricted') return { usable: false, remedy: 'policy' };
    // macOS can still prompt for 'not-determined'; once 'denied' the prompt is
    // suppressed and the user must use System Settings — but askForMediaAccess
    // resolves with the existing status rather than failing, and the caller
    // re-reads status afterwards, so 'request' is safe for both.
    return { usable: false, remedy: status === 'denied' ? 'settings' : 'request' };
  }

  // win32 (and anything else): no programmatic request exists at all, so the
  // privacy panel is the only remedy for EVERY non-granted status.
  //
  // 'restricted' must NOT be treated as policy here. Electron maps win32
  // DeviceAccessStatus_DeniedBySystem to 'restricted', which is the DEVICE-level
  // "Microphone access for this device" switch being off — the single most common
  // Windows mic denial, and exactly what ms-settings:privacy-microphone fixes.
  // Calling that "blocked by your organization" and disabling the button told the
  // user something false and left them with no way forward — worse than the state
  // this fix replaced. ('denied' is DeniedByUser, the per-app toggle; same panel.)
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

/**
 * What Windows itself calls the microphone privacy page, and the switches a
 * desktop app such as Natively needs on it, in the page's own order.
 *
 * Three switches, not two. "Let desktop apps access your microphone" is the one
 * that covers Natively, but on the page it sits inside the "Let apps access
 * your microphone" group, and Microsoft's own steps for a desktop app are to
 * check all three, in this order. A guide that pictured only the first and the
 * last left the middle one out.
 *
 * Windows 10 words all three differently and has no "& security" in the path.
 * The names are Microsoft's own, from "Turn on app permissions for your
 * microphone in Windows" (support.microsoft.com).
 *
 * `platformVersion` is `navigator.userAgentData`'s high-entropy value: Windows
 * 11 reports a major of 13 or more, Windows 10 reports 1 to 10. Anything
 * unreadable is drawn as Windows 11, the current release.
 *
 * @param {string|number|undefined|null} platformVersion
 * @returns {{ release: '10'|'11', path: string[], switches: string[] }}
 */
export function windowsMicPage(platformVersion) {
  const major = Number.parseInt(String(platformVersion ?? ''), 10);
  if (Number.isFinite(major) && major >= 1 && major < 13) {
    return {
      release: '10',
      path: ['Settings', 'Privacy', 'Microphone'],
      switches: [
        'Microphone access for this device',
        'Allow apps to access your microphone',
        'Allow desktop apps to access your microphone',
      ],
    };
  }
  return {
    release: '11',
    path: ['Settings', 'Privacy & security', 'Microphone'],
    switches: [
      'Microphone access',
      'Let apps access your microphone',
      'Let desktop apps access your microphone',
    ],
  };
}

/**
 * Which part of the Windows microphone page a non-granted status points at, so
 * the onboarding row can say what is off in the page's own words.
 *
 * Electron reads Windows's DeviceAccessStatus (see classifyMicStatus):
 *  - 'restricted' is DeniedBySystem: the device-wide switch at the top of the
 *    page is off (or held off by policy). -> 'device'
 *  - 'denied' is DeniedByUser: one of the two app-level switches is off. The
 *    status cannot tell which. -> 'apps'
 *  - anything else says nothing about a particular switch. -> null
 *
 * @param {MicStatus|string|undefined|null} status
 * @returns {'device'|'apps'|null}
 */
export function windowsMicBlocker(status) {
  if (status === 'restricted') return 'device';
  if (status === 'denied') return 'apps';
  return null;
}
