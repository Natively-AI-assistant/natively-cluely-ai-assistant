// src/lib/helpContent.mjs
//
// Every fact Settings → Setup & Help states that differs between macOS and
// Windows, as a pure function of `platform`. The pane used to decide these
// inline from `isMac`, which let a test exercise only the branch it ran on and
// let "not macOS" silently become "Windows": Windows users were shown the macOS
// Zoom walkthrough, and the macOS Quick Start named a permission (Accessibility)
// that shortcuts never needed. Here darwin and win32 are both asserted on
// either OS, and an unsupported platform throws rather than borrowing one.
//
// Sources, so the next edit can re-check them rather than trust this file:
//   permissions      main.ts ensureMacMicrophoneAccess + the startup Screen
//                    Recording check; PermissionsToaster rows; ipcHandlers
//                    `permissions:open-mic-settings` (Windows microphone page) and
//                    `open-external` (allows x-apple.systempreferences on darwin only)
//   system audio     Audio → Audio Configuration; macOS: Core Audio tap with
//                    ScreenCaptureKit fallback, "SCK Backend" switch; Windows:
//                    WASAPI loopback of the Output Device, no switch
//   stealth          main.ts Undetectable (off by default) + WindowHelper content
//                    protection; Process Disguise names in SettingsOverlay
//   stealth typing   StealthKeyboardManager: Accessibility on macOS only
//   code runners     electron/llm/codeVerification localRunner candidates
//
// Keep copy here short and free of things that rot: no model ids, no counts,
// no prices or trial lengths. Point at UI labels instead.
//
// `recordings` says which screen recordings of the real app a platform may be
// shown. Every recording was made on macOS (2026-09-25), so each one is
// macOS-only unless a frame-by-frame review found nothing platform-specific in
// it — no ⌘ keycap, no Apple Speech row, no macOS window chrome:
//   overlay          the overlay answering a spoken question; its ask box shows
//                    ⌘ ⇧ H keycaps → macOS only
//   speechProviders  Audio's provider list, which includes Apple Speech → macOS only
//   activeModel      AI Providers' Active Model menu; nothing platform-specific → both

/** @typedef {'darwin'|'win32'} HelpPlatform */

export const HELP_PLATFORMS = /** @type {const} */ (['darwin', 'win32']);

/** @param {unknown} platform @returns {platform is HelpPlatform} */
export function isHelpPlatform(platform) {
  return platform === 'darwin' || platform === 'win32';
}

/** @param {unknown} platform @returns {HelpPlatform} */
function assertPlatform(platform) {
  if (!isHelpPlatform(platform)) {
    throw new Error(`Unsupported platform: ${String(platform)}`);
  }
  return platform;
}

const MAC_SCREEN_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const MAC_MIC_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';

/**
 * The OS permissions Natively depends on, in the order a person should grant
 * them. `open` says how the pane opens the right OS page:
 *   { kind: 'url', url }         openExternal (macOS deep link)
 *   { kind: 'mic-settings' }     window.electronAPI.openMicSettings (Windows)
 * @param {HelpPlatform} platform
 */
export function getPermissions(platform) {
  switch (assertPlatform(platform)) {
    case 'darwin':
      return [
        {
          id: 'screen',
          title: 'Screen & System Audio Recording',
          // macOS 14 and earlier name the same pane without "& System Audio".
          olderTitle: 'Screen Recording',
          why: 'Lets Natively see your screen and hear the other side of a meeting.',
          path: ['System Settings', 'Privacy & Security', 'Screen & System Audio Recording'],
          open: { kind: 'url', url: MAC_SCREEN_URL },
        },
        {
          id: 'microphone',
          title: 'Microphone',
          olderTitle: null,
          why: 'Lets Natively hear you.',
          path: ['System Settings', 'Privacy & Security', 'Microphone'],
          open: { kind: 'url', url: MAC_MIC_URL },
        },
      ];
    case 'win32':
      return [
        {
          id: 'microphone',
          title: 'Microphone',
          olderTitle: null,
          why: 'Lets Natively hear you. Screen capture needs no permission on Windows.',
          path: ['Settings', 'Privacy & security', 'Microphone'],
          open: { kind: 'mic-settings' },
        },
      ];
  }
}

/**
 * Row-level copy that differs by platform. Every string here is a Settings row
 * description, so each stays within one short line.
 * @param {HelpPlatform} platform
 */
export function getRowCopy(platform) {
  switch (assertPlatform(platform)) {
    case 'darwin':
      return {
        permissionsStep: 'Microphone and Screen Recording, in System Settings.',
        permissionsGuide: 'What macOS asks for, and how to turn it back on.',
      };
    case 'win32':
      return {
        permissionsStep: 'Microphone access for desktop apps, in Windows Settings.',
        permissionsGuide: 'What Windows asks for, and how to turn it back on.',
      };
  }
}

/**
 * Facts the guides state per platform.
 * @param {HelpPlatform} platform
 */
export function getPlatformFacts(platform) {
  switch (assertPlatform(platform)) {
    case 'darwin':
      return {
        platform,
        osName: 'macOS',
        // Settings panes spell the modifier as the app's keycaps do.
        modifierKey: '⌘',
        terminal: 'Terminal',
        restartAfterGrant: true,
        // Apple Speech is offered on macOS only (SettingsOverlay, isMac).
        onDeviceSpeech: ['Apple Speech', 'Local Models'],
        systemAudio: {
          summary: 'Meeting audio comes from a Core Audio tap, or ScreenCaptureKit on older macOS.',
          fix: 'If the other side is never transcribed, turn on Use ScreenCaptureKit backend under SCK Backend.',
        },
        undetectable: {
          hides: 'its Dock icon',
          caveat: 'Some newer capture apps can still see it.',
        },
        disguises: ['Terminal', 'System Settings', 'Activity Monitor'],
        stealthTypingNeedsAccessibility: true,
        // The Zoom walkthrough and its screenshot are of macOS Zoom; Zoom's
        // behaviour on Windows has not been verified.
        zoomGuide: true,
        shortcutGuard: false,
        pythonCommand: 'python3',
        sqliteBundled: true,
        recordings: { overlay: true, speechProviders: true, activeModel: true },
      };
    case 'win32':
      return {
        platform,
        osName: 'Windows',
        modifierKey: 'Ctrl',
        terminal: 'PowerShell',
        restartAfterGrant: false,
        onDeviceSpeech: ['Local Models'],
        systemAudio: {
          summary: 'Meeting audio is recorded from the Output Device you pick.',
          fix: 'Pick the speakers or headset your meeting app plays through.',
        },
        undetectable: {
          hides: 'its taskbar button',
          caveat: 'Needs Windows 10 version 2004 or later. Older versions show a black box.',
        },
        disguises: ['Command Prompt', 'Settings', 'Task Manager'],
        stealthTypingNeedsAccessibility: false,
        zoomGuide: false,
        // Settings → General → "Protect Natively shortcuts" exists on Windows only.
        shortcutGuard: true,
        pythonCommand: 'python or py',
        sqliteBundled: false,
        // Nothing has been recorded on Windows yet; only a clip with no
        // platform-specific content is shown here.
        recordings: { overlay: false, speechProviders: false, activeModel: true },
      };
  }
}
