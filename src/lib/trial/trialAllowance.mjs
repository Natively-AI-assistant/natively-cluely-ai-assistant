// src/lib/trial/trialAllowance.mjs
//
// The free trial's AI allowance (2026-11-03).
//
// A trial is 30 minutes and 60,000 AI tokens (natively-api lib/plans.js). A
// meeting answer carries the transcript with it, about 7,000 tokens, so the
// tokens ran out after eight or nine answers: about three trials in ten that
// used AI, a median of eleven minutes before the clock. The server then
// refused every question (429 ai_quota_exceeded) while the overlay still said
// the trial was running, and the app told the user to check their API keys.
//
// Now the trial ends when its AI allowance does: the same "Free trial ended"
// banner and card as at 30 minutes, at the moment the user needs an answer.
//
// Pure and platform-free; applied in the main process (ipcHandlers.ts, fed by
// LLMHelper when a Natively request is refused for its plan allowance).

/** The refusal that ends a trial: the AI tokens, and nothing else. */
export const TRIAL_AI_ALLOWANCE_CODE = 'ai_quota_exceeded';

/**
 * Should this refusal end the trial now?
 *
 * Only a refusal of the trial's own AI allowance, made for the trial itself,
 * while this device still holds that trial and is running on it. A search or
 * embedding allowance is not the trial's point and does not end it; a paid
 * key's monthly limit is a plan's, never the trial's; a trial already over
 * (by its clock, or by an earlier refusal) has nothing left to end.
 *
 * @param {{ code?: string, onTrial?: boolean, hasTrialToken?: boolean, holdsTrialKey?: boolean,
 *           expiresAt?: string | null, now?: number } | null | undefined} s
 * @returns {boolean}
 */
export function shouldEndTrialForUsedAllowance(s) {
  if (!s) return false;
  if (s.code !== TRIAL_AI_ALLOWANCE_CODE) return false;
  if (s.onTrial !== true || s.hasTrialToken !== true || s.holdsTrialKey !== true) return false;
  const at = Date.parse(s.expiresAt ?? '');
  // No expiry on record is not a trial this can reason about.
  if (!Number.isFinite(at)) return false;
  const now = typeof s.now === 'number' ? s.now : Date.now();
  return at > now;
}

/**
 * The warning starts when this share of the AI allowance is left: a quarter of
 * 60,000 tokens is about two meeting answers.
 */
export const TRIAL_ALLOWANCE_LOW_SHARE = 0.25;

/**
 * Is the trial's AI allowance nearly used, but not yet gone? From the server's
 * own numbers (/v1/trial/status: usage.ai_tokens and limits.ai_tokens), so the
 * overlay can say "Free trial is almost over" before the answers stop, as it
 * does five minutes before the clock.
 *
 * False when either number is missing or not a number (an older server, a
 * failed read): a warning is never guessed.
 *
 * @param {{ used?: unknown, limit?: unknown } | null | undefined} s
 * @returns {boolean}
 */
export function isTrialAllowanceLow(s) {
  const used = Number(s?.used);
  const limit = Number(s?.limit);
  if (s?.used == null || s?.limit == null) return false;
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0 || used < 0) return false;
  if (used >= limit) return false; // used up: the refusal ends the trial instead
  return (limit - used) / limit <= TRIAL_ALLOWANCE_LOW_SHARE;
}
