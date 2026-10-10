// src/lib/trial/trialStart.mjs
//
// What a trial:start reply means for the Free-trial promo (toaster policy
// Phase 3, spec §6 rows 7-8). The card never shows a raw code: it shows one of
// these outcomes and, for our own errors, retries once by itself first.

const UNAVAILABLE_CODES = new Set(['trial_ip_limit', 'already_used', 'trial_already_used', 'trial_expired']);
// 'trial_daily_limit' is the server's ceiling on new trials per day: nothing
// about this device, and gone tomorrow, so it is "try again later".
const RATE_LIMITED_CODES = new Set(['trial_start_rate_limited', 'trial_daily_limit']);

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

const REFUSALS = {
  trial_ip_limit: 'The free-trial limit for this network has been reached.',
  trial_start_rate_limited: 'Too many attempts. Try again later.',
  trial_daily_limit: 'Free trials are paused for the moment. Please try again later.',
  invalid_hwid: 'Could not read device ID. Restart the app and try again.',
  hardware_id_unavailable: 'Could not read device ID. Restart the app and try again.',
};

/**
 * A failed trial:start, in words, for Settings. Never the code itself.
 *
 * `deviceUsed` is whether the answer means this DEVICE has had its trial, the
 * only thing worth remembering locally. None of these do: a network at its
 * cap, the hourly limit and the day's ceiling say nothing about the device,
 * and a device that has had its trial is answered with ok:true, expired.
 *
 * @param {unknown} error
 * @returns {{ message: string, deviceUsed: boolean }}
 */
export function trialRefusal(error) {
  const known = typeof error === 'string' && Object.hasOwn(REFUSALS, error) ? REFUSALS[error] : null;
  return { message: known ?? 'Could not start trial. Try again.', deviceUsed: false };
}

export const TRIAL_RETRY_DELAY_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the trial; on our own error (network, timeout, server) try once more
 * after 3 s. The server's answers (used up, rate limited) are final.
 *
 * `classify` reads the reply. The automatic start at a meeting passes its own
 * (autoTrial.mjs), which knows two answers the card did not need; anything but
 * 'failed' is final.
 *
 * @template {string} [T='started' | 'unavailable' | 'rate_limited' | 'failed']
 * @param {() => Promise<unknown>} start
 * @param {(ms: number) => Promise<void>} [wait]
 * @param {(res: any) => T | 'failed'} [classify]
 */
export async function startTrialWithRetry(start, wait = sleep, classify = classifyTrialStart) {
  const attempt = async () => {
    try { return classify(await start()); } catch { return 'failed'; }
  };
  const first = await attempt();
  if (first !== 'failed') return first;
  await wait(TRIAL_RETRY_DELAY_MS);
  return attempt();
}
