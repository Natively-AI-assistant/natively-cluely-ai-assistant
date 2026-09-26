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
// `clips` says which screen recordings of the real app a platform may be shown.
// Every recording was made on macOS (2026-09-25/26), so a clip is shown on
// Windows only when a frame-by-frame review found nothing macOS-only in it —
// no ⌘ keycap, no Apple Speech row, no macOS disguise names, no macOS-only
// permission. A Windows-only row missing from a clip is not treated as
// misleading (Settings › General there also lists Protect Natively shortcuts).
//   answer        the overlay answering a spoken question; ⌘ ⇧ H keycaps → macOS
//   permissions   the permissions card, which lists Screen Recording → macOS
//   speech        Audio's provider list, which includes Apple Speech → macOS
//   model         AI Providers' Active Model menu → both
//   stealth       General › Process Disguise names macOS apps → macOS
//   verify        General › Show advanced settings › Verify coding answers → both
//   sync          Sync; its extension row shows ⌘+Y → macOS
//   modes         Launcher › Modes → both
//   profile       Launcher › Profile Intelligence → both
//   notes         Launcher › a meeting's notes, transcript and Ask → both
//   search        Launcher search finding a meeting (its step says "Open
//                 search", not a key) → both

/** @typedef {'darwin'|'win32'} HelpPlatform */

export const HELP_PLATFORMS = /** @type {const} */ (['darwin', 'win32']);

/** Every recording the pane can show, in the order the guides use them. */
export const HELP_CLIP_IDS = /** @type {const} */ ([
  'answer', 'permissions', 'speech', 'model', 'stealth', 'verify', 'sync', 'modes', 'profile', 'notes', 'search',
]);

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
        clips: {
          answer: true, permissions: true, speech: true, model: true, stealth: true,
          verify: true, sync: true, modes: true, profile: true, notes: true, search: true,
        },
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
        // Nothing has been recorded on Windows; see `clips` above.
        clips: {
          answer: false, permissions: false, speech: false, model: true, stealth: false,
          verify: true, sync: false, modes: true, profile: true, notes: true, search: true,
        },
      };
  }
}
