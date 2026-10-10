import type { TrialStartReply } from './trialStart.mjs';

export type AutoTrialOutcome = 'started' | 'unavailable' | 'unsupported' | 'network_limited' | 'rate_limited' | 'failed';
export type AutoTrialFailure = 'unreachable' | 'rate_limited';

export function shouldAutoStartTrial(s: {
  meetingAi?: 'natively' | 'own' | 'none';
  hasRealNativelyKey?: boolean;
  licensed?: boolean;
  trialClaimed?: boolean;
  hasTrialToken?: boolean;
  /** Must be true: an unread credential store looks like an install with nothing. */
  credentialsReadable?: boolean;
} | null | undefined): boolean;
export function classifyAutoTrial(res: TrialStartReply | null | undefined): AutoTrialOutcome;
export function runAutoTrial(start: () => Promise<unknown>, wait?: (ms: number) => Promise<void>): Promise<AutoTrialOutcome>;
export const AUTO_TRIAL_QUIET_MS: number;
export function autoTrialFollowUp(outcome: AutoTrialOutcome): { markClaimed: boolean; notify: AutoTrialFailure | null; quietMs: number };
