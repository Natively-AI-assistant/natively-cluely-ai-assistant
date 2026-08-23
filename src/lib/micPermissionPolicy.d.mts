export type MicStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

export function classifyMicStatus(
  platform: string | undefined | null,
  status: MicStatus | string | undefined | null,
): { usable: boolean; remedy: 'none' | 'request' | 'settings' | 'policy' };

export function micSettingsUri(platform: string | undefined | null): string | null;
