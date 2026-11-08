export type HelpPlatform = 'darwin' | 'win32';

export declare const HELP_PLATFORMS: readonly ['darwin', 'win32'];

export function isHelpPlatform(platform: unknown): platform is HelpPlatform;

export type PermissionOpener = { kind: 'url'; url: string } | { kind: 'mic-settings' };

export interface HelpPermission {
  id: 'screen' | 'microphone';
  title: string;
  olderTitle: string | null;
  why: string;
  path: string[];
  open: PermissionOpener;
}

export function getPermissions(platform: HelpPlatform): HelpPermission[];

export interface HelpRowCopy {
  permissionsStep: string;
  permissionsGuide: string;
}

export function getRowCopy(platform: HelpPlatform): HelpRowCopy;

export type HelpClipId =
  | 'permissions' | 'speech' | 'model' | 'calendar' | 'modes' | 'profile'
  | 'overlay' | 'buttons' | 'notepad' | 'answer' | 'autoanswer' | 'stealth' | 'phone' | 'sync' | 'verify'
  | 'notes' | 'followup' | 'share' | 'mcp' | 'search' | 'retrieval';

export declare const HELP_CLIP_IDS: readonly HelpClipId[];

export interface HelpPlatformFacts {
  platform: HelpPlatform;
  osName: 'macOS' | 'Windows';
  modifierKey: string;
  terminal: string;
  restartAfterGrant: boolean;
  onDeviceSpeech: string[];
  systemAudio: { summary: string; fix: string };
  undetectable: { hides: string; caveat: string };
  disguises: string[];
  stealthTypingNeedsAccessibility: boolean;
  zoomGuide: boolean;
  shortcutGuard: boolean;
  pythonCommand: string;
  sqliteBundled: boolean;
  /** A platform condition on Calendar › Detect meetings, or null when there is none to state. */
  meetingDetection: string | null;
  /** Audio › "Use the meeting app's microphone" exists on this platform. */
  followMeetingMic: boolean;
  /** Calendar offers Apple Calendar. */
  appleCalendar: boolean;
  /** Reading the call app for names, meeting ID and mute needs Accessibility. */
  callDetailsNeedAccessibility: boolean;
  /** Keys that close the notepad, as its X does. */
  closeNotepadKeys: string[];
  /** Keys that delete a word while stealth typing. */
  wordDeleteKeys: string[];
  clips: Record<HelpClipId, boolean>;
}

export function getPlatformFacts(platform: HelpPlatform): HelpPlatformFacts;
