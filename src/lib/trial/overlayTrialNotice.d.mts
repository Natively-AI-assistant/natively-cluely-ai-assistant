export const TRIAL_ENDING_MS: number;
export const TRIAL_STARTED_BANNER_MS: number;

export type OverlayTrialBanner = 'started' | 'ending' | 'ended' | 'failed';
export interface OverlayTrialChip { minutesLeft: number; tone: 'ok' | 'warning' }

export function overlayTrialNotice(s: {
  now: number;
  expiresAt?: number | null;
  announcedAt?: number | null;
  liveThisMeeting?: boolean;
  startFailed?: null | 'unreachable' | 'rate_limited' | 'paused';
  durationMs?: number | null;
  dismissed?: { started?: boolean };
}): { banner: OverlayTrialBanner | null; chip: OverlayTrialChip | null; minutesLeft: number | null };
