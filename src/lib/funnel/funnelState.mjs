// src/lib/funnel/funnelState.mjs
//
// The small decisions behind the funnel events: what this install is entitled
// to right now, whether today's activity has been reported, how a trial start
// turned out, how long ago something happened. Pure, so each can be tested with
// plain values.

/**
 * What the install can do right now, as one word.
 *
 * Paid states win over the trial, the trial over the user's own keys: the word
 * answers "what would this person lose if nothing changed", which is what a
 * funnel groups by.
 *
 * @param {{ licensed?: boolean, hasRealApiKey?: boolean, hasTrialToken?: boolean,
 *           trialExpired?: boolean, hasOwnAi?: boolean }} s
 * @returns {'none'|'byok'|'trial'|'trial_expired'|'api'|'pro'|'api_pro'}
 */
export function resolveEntitlement(s = {}) {
  if (s.hasRealApiKey) return s.licensed ? 'api_pro' : 'api';
  if (s.licensed) return 'pro';
  if (s.hasTrialToken) return s.trialExpired ? 'trial_expired' : 'trial';
  if (s.hasOwnAi) return 'byok';
  return 'none';
}

/**
 * Is a local model the one selected?
 *
 * hasOwnAiKey (trialPolicy.mjs) deliberately does not count Ollama: it has a
 * default URL and no opt-in field, so its presence says nothing. A local model
 * being the SELECTED model does say something, and without this the people
 * running entirely on their own machine would be reported as having no AI.
 */
export function usesLocalModel(defaultModel) {
  return typeof defaultModel === 'string' && defaultModel.startsWith('ollama-');
}

/** Whose AI answers a meeting: ours, the user's own, or nobody's. */
export function resolveMeetingAi({ defaultModel, hasOwnAi } = {}) {
  if (defaultModel === 'natively') return 'natively';
  return hasOwnAi || usesLocalModel(defaultModel) ? 'own' : 'none';
}

/** The local calendar day, as YYYY-MM-DD. */
export function localDay(nowMs) {
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Whole minutes since a moment, or undefined when there is no such moment.
 * A moment in the future (a clock that moved) reads as zero, never negative.
 *
 * @param {number | string | null | undefined} then  epoch ms or an ISO string
 * @param {number} nowMs
 */
export function minutesSince(then, nowMs) {
  if (then === null || then === undefined || then === '') return undefined;
  const t = typeof then === 'number' ? then : Date.parse(then);
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, Math.floor((nowMs - t) / 60_000));
}

/** Whole days since a moment; zero when unknown. */
export function daysSince(thenMs, nowMs) {
  if (!Number.isFinite(thenMs)) return 0;
  return Math.max(0, Math.floor((nowMs - thenMs) / 86_400_000));
}

/**
 * How a trial start turned out, in the catalogue's words.
 *
 * Until this existed a failed start left no trace anywhere: the server refuses
 * before it writes a row, and the client only logged to its own console.
 *
 * @param {{ hwidUnavailable?: boolean, threw?: boolean, status?: number,
 *           error?: string, body?: { ok?: boolean, expired?: boolean, already_used?: boolean } }} r
 */
export function mapTrialStartResult(r = {}) {
  if (r.hwidUnavailable) return 'hwid_unavailable';
  if (r.threw) return 'network';
  if (typeof r.status === 'number' && r.status >= 400) {
    if (r.error === 'trial_ip_limit') return 'ip_limit';
    if (r.status === 429) return 'rate_limited';
    return 'server_error';
  }
  const b = r.body || {};
  if (b.ok !== true) return 'server_error';
  if (b.already_used) return b.expired ? 'already_used_expired' : 'already_used';
  return 'ok';
}

/** The plan tile a user picked on the trial card, as a trial_card action. */
export function trialCardActionForChoice(choice) {
  return { standard: 'plan_standard', pro: 'plan_pro', max: 'plan_max', ultra: 'plan_ultra', byok: 'byok' }[choice] ?? null;
}

/**
 * The stored funnel state, made safe to read. Everything optional; a missing or
 * damaged file is simply an install that has not reported anything yet.
 *
 * @returns {{ firstRunSent: boolean, lastActiveDay: string, trialStartedAt: number | null,
 *             byokExitAt: number | null, meetings: number }}
 */
export function normalizeFunnelState(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const ms = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  return {
    firstRunSent: s.firstRunSent === true,
    lastActiveDay: typeof s.lastActiveDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.lastActiveDay) ? s.lastActiveDay : '',
    trialStartedAt: ms(s.trialStartedAt),
    byokExitAt: ms(s.byokExitAt),
    meetings: Number.isInteger(s.meetings) && s.meetings >= 0 ? s.meetings : 0,
  };
}

/**
 * Is this launch the install's first?
 *
 * There is no "first run" flag to read: the install id file is created on the
 * first launch, so an install whose id is minutes old and that has never
 * reported is new. An install that upgrades INTO this code has an old id and is
 * not counted as a first run — it has been here all along.
 */
export function isFirstRun({ firstRunSent, installCreatedAtMs, nowMs, windowMs = 10 * 60_000 }) {
  if (firstRunSent) return false;
  if (!Number.isFinite(installCreatedAtMs)) return false;
  // File times carry fractions of a millisecond and the clock read beside them
  // does not, so a file made "now" can read as a hair in the future. Two
  // seconds of slack covers that; a file dated further ahead is a clock that
  // moved, and says nothing.
  const age = nowMs - installCreatedAtMs;
  return age >= -2000 && age <= windowMs;
}
