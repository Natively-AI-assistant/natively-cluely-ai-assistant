// src/lib/trial/trialStart.mjs
//
// What a trial:start reply means for the Free-trial promo (toaster policy
// Phase 3, spec §6 rows 7-8). The card never shows a raw code: it shows one of
// these outcomes and, for our own errors, retries once by itself first.

const UNAVAILABLE_CODES = new Set(['trial_ip_limit', 'already_used', 'trial_already_used', 'trial_expired']);
const RATE_LIMITED_CODES = new Set(['trial_start_rate_limited']);

/**
 * @param {{ ok?: boolean, hasToken?: boolean, persisted?: boolean, expired?: boolean,
 *           already_used?: boolean, error?: string, status?: number } | null | undefined} res
 * @returns {'started' | 'unavailable' | 'rate_limited' | 'failed'}
 */
export function classifyTrialStart(res) {
  if (!res || typeof res !== 'object') return 'failed';
  if (res.ok) {
    // The server's ok:true, expired:true is "this device already had its
    // trial", not a trial that started.
    if (res.expired || res.already_used) return 'unavailable';
    // A token main could not persist still runs this session (it is held in
    // memory and announced); the endpoint re-issues the same trial, so a
    // retry would only loop. Settings warns that it will end on quit.
    if (res.hasToken) return 'started';
    return 'failed';
  }
  if (typeof res.error === 'string' && UNAVAILABLE_CODES.has(res.error)) return 'unavailable';
  if ((typeof res.error === 'string' && RATE_LIMITED_CODES.has(res.error)) || res.status === 429) return 'rate_limited';
  return 'failed';
}

export const TRIAL_RETRY_DELAY_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the trial; on our own error (network, timeout, server) try once more
 * after 3 s. The server's answers (used up, rate limited) are final.
 *
 * @param {() => Promise<unknown>} start
 * @param {(ms: number) => Promise<void>} [wait]
 */
export async function startTrialWithRetry(start, wait = sleep) {
  const attempt = async () => {
    try { return classifyTrialStart(await start()); } catch { return 'failed'; }
  };
  const first = await attempt();
  if (first !== 'failed') return first;
  await wait(TRIAL_RETRY_DELAY_MS);
  return attempt();
}

/** What the card says for each outcome other than a started trial. */
export const TRIAL_START_COPY = Object.freeze({
  failed: "Couldn't reach Natively. Check your connection and try again.",
  rate_limited: 'Too many attempts. Try again later.',
  unavailable: 'The free trial has already been used on this device.',
});
