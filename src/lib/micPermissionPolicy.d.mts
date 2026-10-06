export type MicStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

export function classifyMicStatus(
  platform: string | undefined | null,
  status: MicStatus | string | undefined | null,
): { usable: boolean; remedy: 'none' | 'request' | 'settings' | 'policy' };

export function micSettingsUri(platform: string | undefined | null): string | null;

export function windowsMicPage(
  platformVersion: string | number | undefined | null,
): { release: '10' | '11'; path: string[]; switches: string[]; label: string };

export function windowsMicBlocker(
  status: MicStatus | string | undefined | null,
): 'device' | 'apps' | null;
