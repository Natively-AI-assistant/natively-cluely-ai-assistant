export type RowStatus =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'unknown'
  | 'loading';

export type RowTone = 'granted' | 'pending' | 'action' | 'blocked';

export type RowRemedy =
  | 'none'
  | 'wait'
  | 'request'
  | 'settings'
  | 'policy'
  | 'unsupported';

export interface RowPresentation {
  tone: RowTone;
  actionable: boolean;
  sublabel: string;
  actionLabel: string | null;
  remedy: RowRemedy;
}

export function describePermRow(
  platform: string | undefined | null,
  kind: 'screen' | 'microphone',
  status: RowStatus | string | undefined | null,
): RowPresentation;

export function allPermissionsResolved(
  platform: string | undefined | null,
  statuses: { microphone: RowStatus | string; screen: RowStatus | string },
): boolean;
