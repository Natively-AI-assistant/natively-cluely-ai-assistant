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
  recordings: { overlay: boolean; speechProviders: boolean; activeModel: boolean };
}

export function getPlatformFacts(platform: HelpPlatform): HelpPlatformFacts;
