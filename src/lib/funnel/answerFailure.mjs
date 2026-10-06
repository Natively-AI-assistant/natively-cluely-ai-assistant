// src/lib/funnel/answerFailure.mjs
//
// Why an answer did not come, as one word for the funnel.
//
// The overlay already sorts every failure before it words its notice
// (src/lib/directAssistFailure.mjs, src/lib/chatFailure.mjs). This turns that
// sorting into the catalogue's `answer_failed.cause`. Only the word leaves:
// never the provider's sentence, the status number, the provider or the model.
//
// WHY IT EXISTS. On the first day of funnel data a quarter of the long
// meetings held on the user's own keys produced no answer at all, and nothing
// could say whether a key was failing or nobody had asked.
//
// Pure: a failure in, a word (or null) out.

import { directAssistFailureCause } from '../directAssistFailure.mjs';

/** Sentences of Natively's own: not a provider's failure. */
const OWN = Object.freeze({
  TRIAL_ENDED: 'trial_ended',
  PLAN_LIMIT: 'plan_limit',
  PLAN_EXPIRED: 'plan_expired',
  INTERNAL_ERROR: 'app',
});

/** The request never left: a privacy setting, an attachment, a model that cannot read images. */
const NOT_SENT = new Set([
  'INVALID_REQUEST',
  'MODEL_DOES_NOT_SUPPORT_IMAGES',
  'SCREENSHOT_BLOCKED_BY_PRIVACY',
  'TRANSCRIPT_BLOCKED_BY_PRIVACY',
  'INVALID_ATTACHMENT',
]);

/**
 * Not a failure to answer: the user stopped it, or Natively cut a long or
 * repeating answer short (the answer was given).
 */
const NOT_A_FAILURE = new Set(['CANCELLED', 'OUTPUT_LIMIT', 'OUTPUT_REPETITION']);

/** The overlay's cause names that the catalogue spells differently. */
const RENAMED = Object.freeze({ brokeOff: 'broke_off', tooLarge: 'too_large', waited: 'timeout' });

/**
 * Is this raw error the user's own doing: a request they stopped, or one
 * replaced by their next question? The overlay's other answer paths hand over
 * whatever was thrown as a string, and an abort arrives looking like any other
 * unknown error. It is not a failed answer and must not be counted as one.
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
export function looksLikeUserStop(raw) {
  const text = typeof raw === 'string' ? raw : (raw && typeof raw.message === 'string' ? raw.message : '');
  const name = raw && typeof raw === 'object' && typeof raw.name === 'string' ? raw.name : '';
  return name === 'AbortError' || /\babort(?:ed|error)?\b|\bcancel+ed\b|\bsuperseded\b/i.test(text);
}

/**
 * @param {{ code?: string, status?: number, waitedMs?: number, partial?: boolean, unreachable?: boolean } | null | undefined} failure
 * @returns {string | null} one of ANSWER_FAILURE_CAUSES, or null when this is not a failure to report
 */
export function answerFailureCause(failure) {
  const code = failure?.code;
  if (typeof code !== 'string' || !code || NOT_A_FAILURE.has(code)) return null;
  if (Object.hasOwn(OWN, code)) return OWN[code];
  if (NOT_SENT.has(code)) return 'not_sent';
  if (code === 'CONTEXT_TOO_LARGE') return 'too_large';
  const cause = directAssistFailureCause(failure);
  return RENAMED[cause] ?? cause;
}
