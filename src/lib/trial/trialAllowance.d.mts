export const TRIAL_AI_ALLOWANCE_CODE: 'ai_quota_exceeded';
export function shouldEndTrialForUsedAllowance(s: {
  /** The refusal's code, from the 429 body (error or code). */
  code?: string;
  /** The refused request went out on the trial (the trial key, not a paid key). */
  onTrial?: boolean;
  hasTrialToken?: boolean;
  /** The app is still running on the trial: its Natively key is the trial sentinel. */
  holdsTrialKey?: boolean;
  expiresAt?: string | null;
  now?: number;
} | null | undefined): boolean;
export const TRIAL_ALLOWANCE_LOW_SHARE: number;
export function isTrialAllowanceLow(s: { used?: unknown; limit?: unknown } | null | undefined): boolean;
