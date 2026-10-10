// src/lib/trial/autoTrial.mjs
//
// The free trial starts by itself when a meeting starts with no AI to answer
// it (2026-10-09). It replaced the "try Natively" card on Home, which reached
// about one new install in twelve while half of them started their first
// meeting with nothing configured.
//
// Pure and platform-free, so every branch is testable; applied in one place in
// the main process (the meeting-start hook in ipcHandlers.ts).

import { classifyTrialStart, startTrialWithRetry } from './trialStart.mjs';

/**
 * Should this meeting start a trial?
 *
 * Only for someone with no way to get an answer and no trial behind them: the
 * same audience the Home card had. A licence or a real Natively key is a
 * customer, not a trial; the user's own AI is their choice and stays theirs.
 *
 * `credentialsReadable` must be said, and true. A keychain that could not be
 * read looks exactly like "nothing set up, never had a trial": starting one
 * then would spend an existing customer's only trial, and could not even
 * switch them onto it, because writes are refused while the store is unread.
 *
 * @param {{ meetingAi?: 'natively' | 'own' | 'none', hasRealNativelyKey?: boolean, licensed?: boolean,
 *           trialClaimed?: boolean, hasTrialToken?: boolean, credentialsReadable?: boolean } | null | undefined} s
 * @returns {boolean}
 */
export function shouldAutoStartTrial(s) {
  if (!s) return false;
  return s.credentialsReadable === true
    && s.meetingAi === 'none'
    && !s.hasRealNativelyKey && !s.licensed && !s.trialClaimed && !s.hasTrialToken;
}

/**
 * A trial:start reply, as the automatic start reads it. The card's reading
 * (trialStart.mjs) plus two cases of its own:
 *
 *  - a machine with no hardware id can never start a trial, so offering "try
 *    again" would be a button that cannot work;
 *  - "too many trials from this network" is about the network, not the
 *    device. The card could file it under "unavailable" because it only chose
 *    a sentence; here that answer is REMEMBERED (autoTrialFollowUp), and a
 *    first meeting on a campus or office address must not cost the device the
 *    trial it would get at home the next day.
 *
 * @param {Parameters<typeof classifyTrialStart>[0] } res
 * @returns {'started' | 'unavailable' | 'unsupported' | 'network_limited' | 'rate_limited' | 'failed'}
 */
export function classifyAutoTrial(res) {
  if (res && typeof res === 'object' && !res.ok) {
    if (res.error === 'hardware_id_unavailable') return 'unsupported';
    // ...and so is the server's daily ceiling on new trials: it says nothing
    // about this device either.
    if (res.error === 'trial_ip_limit' || res.error === 'trial_daily_limit') return 'network_limited';
  }
  return classifyTrialStart(res);
}

/**
 * Start the trial; on our own error (network, timeout, server) try once more.
 * The server's answers are final. The card's retry loop, with this reading.
 *
 * @param {() => Promise<unknown>} start
 * @param {(ms: number) => Promise<void>} [wait]
 * @returns {Promise<ReturnType<typeof classifyAutoTrial>>}
 */
export function runAutoTrial(start, wait) {
  return startTrialWithRetry(start, wait, classifyAutoTrial);
}

/** How long the automatic start stays quiet after a refusal that is not about this device. */
export const AUTO_TRIAL_QUIET_MS = 30 * 60_000;

/**
 * What main does after an automatic start.
 *
 * `markClaimed`: the server says this DEVICE has had its trial, so remember it
 * locally; that is what lets the Natively API card take the trial's place.
 * Only 'unavailable' is that answer. A network-wide refusal and a machine with
 * no hardware id write nothing.
 * `notify`: tell the overlay the start failed, so it can offer the manual one.
 * Only for our own failure (network, timeout, server), where pressing Start
 * again can work.
 *
 * `quietMs`: do not ask again for this long. A refusal that is not about this
 * device (the network's limit, the server's ceiling for the day) is not
 * remembered, and asking at every meeting would walk an honest user into the
 * server's hourly limit.
 *
 * @param {ReturnType<typeof classifyAutoTrial>} outcome
 * @returns {{ markClaimed: boolean, notify: null | 'unreachable' | 'rate_limited', quietMs: number }}
 */
export function autoTrialFollowUp(outcome) {
  if (outcome === 'unavailable') return { markClaimed: true, notify: null, quietMs: 0 };
  if (outcome === 'failed') return { markClaimed: false, notify: 'unreachable', quietMs: 0 };
  // The hourly limit on attempts is per network and counts attempts the
  // network's own cap refuses, so on a shared address at its cap this is the
  // same answer as 'network_limited' and gets the same treatment: nothing on
  // screen for someone who pressed nothing, and no asking again for a while.
  if (outcome === 'rate_limited') return { markClaimed: false, notify: null, quietMs: AUTO_TRIAL_QUIET_MS };
  if (outcome === 'network_limited') return { markClaimed: false, notify: null, quietMs: AUTO_TRIAL_QUIET_MS };
  return { markClaimed: false, notify: null, quietMs: 0 };
}
