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
//                    ScreenCaptureKit fallback, the "System Audio Capture" picker; Windows:
//                    WASAPI loopback of the Output Device, no switch
//   stealth          main.ts Undetectable (off by default) + WindowHelper content
//                    protection; Process Disguise names in SettingsOverlay
//   stealth typing   StealthKeyboardManager: Accessibility on macOS only
//   code runners     electron/llm/codeVerification localRunner candidates
//   meeting surface  electron/utils/meetingSurface.ts + NotesWindow close (⌘W / Alt+F4)
//   stealth edits    src/lib/stealthEdit.mjs word delete (⌥ / Ctrl + Backspace)
//   meeting detect   native-module meeting_signals.rs: macOS 14+ reads which apps
//                    hold the microphone (CoreAudio) and window titles (Screen
//                    Recording); Windows reads the microphone consent store and
//                    window titles. Offered on both; Windows has not been tried
//                    with real calls (meetingApps.ts), so no promise beyond that.
//
// Keep copy here short and free of things that rot: no model ids, no counts,
// no prices or trial lengths. Point at UI labels instead.
//
// `clips` says which screen recordings of the real app a platform may be shown.
// Every recording was made on macOS (all re-recorded 2026-11-01 for 3.0), so a
// clip is shown on Windows only when a frame-by-frame review found nothing
// macOS-only in it: no ⌘ keycap, no Apple Speech row, no macOS disguise names,
// no macOS-only permission or app. A Windows-only row missing from a clip is not
// treated as misleading (Settings › General there also lists Protect Natively
// shortcuts).
//   answer        the overlay answering a spoken question; ⌘ ⇧ H keycaps → macOS
//   autoanswer    the overlay answering on its own; same ⌘ ⇧ H keycaps → macOS
//   overlay       the overlay mid-call: What to answer? on a live question;
//                 same ⌘ ⇧ H keycaps → macOS
//   permissions   the permissions card, which lists Screen Recording → macOS
//   speech        Audio's provider list, which includes Apple Speech → macOS
//   model         AI Providers' Active Model menu → both
//   retrieval     Retrieval; its on-device cards carry the Apple logo and say
//                 "Best for this Mac" → macOS
//   stealth       General › Process Disguise names macOS apps → macOS
//   verify        General › Show advanced settings › Verify coding answers → both
//   phone         the Phone Mirror page on a phone; nothing from the desktop OS → both
//   sync          Companion: Phone Mirror on, the pairing code (blurred); its
//                 browser extension row shows a ⌘ keycap → macOS
//   modes         Launcher › Modes → both
//   profile       Launcher › Profile Intelligence → both
//   buttons       Settings › Overlay › Your buttons, making one → both
//   notepad       the meeting notepad live: notes, transcript, What did I miss → both
//   notes         Launcher › a meeting's notes, transcript and Ask → both
//   followup      the Follow-up email sheet; its send menu names the Mac's own
//                 Mail app with Apple's icon → macOS
//   share         a meeting's Share menu, Copy → both
//   mcp           Settings › Connectors › MCP (the command is blurred) → both
//   calendar      Settings › Calendar connecting a demo week, and Detect meetings;
//                 its source list has the Apple Calendar row, which Windows
//                 does not offer (calendarSourcesFor) → macOS
//   search        Launcher search finding a meeting (its step says "Open
//                 search", not a key) → both

/** @typedef {'darwin'|'win32'} HelpPlatform */

export const HELP_PLATFORMS = /** @type {const} */ (['darwin', 'win32']);

/** Every recording the pane can show, in the order the guides use them. */
export const HELP_CLIP_IDS = /** @type {const} */ ([
  'permissions', 'speech', 'model', 'calendar', 'modes', 'profile',
  'overlay', 'buttons', 'notepad', 'answer', 'autoanswer', 'stealth', 'phone', 'sync', 'verify',
  'notes', 'followup', 'share', 'mcp', 'search', 'retrieval',
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
          fix: 'If the other side is never transcribed, set System Audio Capture to ScreenCaptureKit.',
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
        // Detect meetings asks which app holds the microphone, which macOS
        // reports from 14 on (meeting_signals.rs). Earlier, it can only see a
        // meeting tab playing sound, which the browser extension reports
        // (detectMeeting.ts, micUsers === null).
        meetingDetection: 'On macOS 13 and earlier it needs the browser extension.',
        // Audio › "Use the meeting app's microphone" is drawn on macOS only
        // (SettingsOverlay, isMac around FollowMicDeviceSettings).
        followMeetingMic: true,
        // Apple Calendar is registered on darwin only (calendar/providers/registry.ts).
        appleCalendar: true,
        // Reading Zoom and Teams for names, the meeting ID and mute needs
        // Accessibility on macOS (desktopCallSpeakers.ts); Windows asks nothing.
        callDetailsNeedAccessibility: true,
        // NotesWindow: ⌘W closes the notepad like its X (main.ts close handling).
        closeNotepadKeys: ['⌘', 'W'],
        // stealthEdit.mjs: delete a word while stealth typing.
        wordDeleteKeys: ['⌥', 'Backspace'],
        clips: {
          permissions: true, speech: true, model: true, calendar: true, modes: true, profile: true,
          overlay: true, buttons: true, notepad: true, answer: true, autoanswer: true, stealth: true,
          phone: true, sync: true, verify: true, notes: true, followup: true, share: true, mcp: true,
          search: true, retrieval: true,
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
        meetingDetection: null,
        followMeetingMic: false,
        appleCalendar: false,
        callDetailsNeedAccessibility: false,
        closeNotepadKeys: ['Alt', 'F4'],
        wordDeleteKeys: ['Ctrl', 'Backspace'],
        // Nothing has been recorded on Windows; see `clips` above.
        clips: {
          permissions: false, speech: false, model: true, calendar: false, modes: true, profile: true,
          overlay: false, buttons: true, notepad: true, answer: false, autoanswer: false, stealth: false,
          phone: true, sync: false, verify: true, notes: true, followup: false, share: true, mcp: true,
          search: true, retrieval: false,
        },
      };
  }
}
