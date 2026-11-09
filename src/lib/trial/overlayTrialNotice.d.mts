export const TRIAL_ENDING_MS: number;
export const TRIAL_STARTED_BANNER_MS: number;

export type OverlayTrialBanner = 'started' | 'ending' | 'ended' | 'failed';
export type OverlayTrialEndReason = 'clock' | 'allowance';
export interface OverlayTrialChip { minutesLeft: number; tone: 'ok' | 'warning' }

export function overlayTrialNotice(s: {
  now: number;
  expiresAt?: number | null;
  announcedAt?: number | null;
  liveThisMeeting?: boolean;
  startFailed?: null | 'unreachable' | 'rate_limited' | 'paused';
  durationMs?: number | null;
  /** Closed by the user in this meeting (the hook resets it per meeting). */
  dismissed?: { started?: boolean; ending?: boolean; ended?: boolean };
  /** Main says the trial's AI allowance is in its last quarter. */
  allowanceLow?: boolean;
  /** What ended it, when main said so. */
  endedBy?: null | OverlayTrialEndReason;
}): {
  banner: OverlayTrialBanner | null;
  chip: OverlayTrialChip | null;
  minutesLeft: number | null;
  reason: OverlayTrialEndReason | null;
  /** The ending or ended banner that would show, closed by the user. */
  closed?: 'ending' | 'ended';
};
