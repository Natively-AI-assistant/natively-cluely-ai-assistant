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
  | 'answer' | 'autoanswer' | 'permissions' | 'speech' | 'model' | 'retrieval' | 'stealth' | 'verify' | 'sync'
  | 'phone' | 'modes' | 'profile' | 'notes' | 'followup' | 'search';

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
  clips: Record<HelpClipId, boolean>;
}

export function getPlatformFacts(platform: HelpPlatform): HelpPlatformFacts;
