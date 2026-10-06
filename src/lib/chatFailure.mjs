/**
 * Turns a RAW error from the overlay's other answer paths into the same data
 * the direct-ask path's notice is drawn from (unit-tested).
 *
 * Direct Assist failures arrive from main already sorted: a reason code, a
 * status, the provider's own words cut down. The other paths (the quick
 * actions, a typed or spoken question on the legacy stream, an engine error)
 * hand the renderer whatever was thrown, as a string:
 *
 *     Natively API HTTP 403 requestId=nat_json_0d7b… serverRequestId=n/a
 *       endpoint=https://api.natively.software/v1/chat: trial_expired
 *     Error: Error: Error invoking remote method 'generate-clarify': Error:
 *       No handler registered for 'generate-clarify'
 *
 * and the overlay printed it into the chat behind a ❌ or inside "[Error: …]".
 * This sorts that string into a DirectAssistAnswerFailure, so the row draws
 * DirectAssistNotice instead: the cause in words, the provider's own sentence
 * underneath when it has one, and never a code, a status number, a request id,
 * an endpoint or a key (they choose the words; they are not shown).
 *
 * The result is DATA. directAssistNoticeView and directAssistFailureText do
 * the wording and the translation.
 */

const DETAIL_MAX = 240;

/** A thrown value as a string. An object with no message has nothing to say
 *  ("[object Object]" is not a sentence). */
function text(raw) {
  if (typeof raw === 'string') return raw;
  if (raw == null) return '';
  if (typeof raw.message === 'string') return raw.message;
  return typeof raw === 'object' ? '' : String(raw);
}

/** `Error: Error: Error invoking remote method 'x': Error: …` down to the `…`. */
function unwrap(s) {
  let out = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 8; i += 1) {
    const next = out
      .replace(/^(?:Uncaught\s+)?(?:[A-Z][A-Za-z]*Error|Error)\s*:\s*/, '')
      .replace(/^Error invoking remote method '[^']*'\s*:\s*/, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * The provider's own sentence with everything machine-made taken out. May
 * come back empty: a string that was only ids and codes has nothing to say.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function scrubErrorText(raw) {
  let s = unwrap(text(raw))
    // ids and where it was sent
    .replace(/\b(?:server_?request_?id|request_?id|trace_?id|x-request-id)\s*[=:]\s*\S+/gi, ' ')
    .replace(/\bendpoint\s*=\s*\S+/gi, ' ')
    .replace(/https?:\/\/[^\s)"']+/gi, ' ')
    // keys, whole or masked
    .replace(/\b(?:sk|pk|rk|gsk|xai|nat|key)[-_][A-Za-z0-9_\-*]{8,}/g, ' ')
    .replace(/\bAIza[0-9A-Za-z_\-*]{10,}/g, ' ')
    .replace(/\bBearer\s+\S+/gi, ' ')
    // status numbers and machine codes
    .replace(/\b(?:HTTP|status(?:\s+code)?)\s*[:=]?\s*\d{3}\b/gi, ' ')
    .replace(/\bconnect\s+(?=E[A-Z]{4,}\b)/g, ' ')
    .replace(/\bE(?:CONNREFUSED|CONNRESET|CONNABORTED|NOTFOUND|TIMEDOUT|AI_AGAIN|HOSTUNREACH|PIPE)\b/g, ' ')
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b:?/g, ' ')
    // an SDK naming itself and its own plumbing
    .replace(/\[[A-Za-z ]*Error\]\s*:?/g, ' ')
    .replace(/\bError fetching from\b\s*:?/gi, ' ')
    .replace(/\[\d{3}[^\]]*\]/g, ' ')
    // who is speaking, when it is our own relay naming itself
    .replace(/^\s*Natively API(?:\s+stream)?\b/i, ' ');
  // a bare status at the front ("401 Unauthorized") and a lone reason code at
  // the end (": trial_expired")
  s = s.replace(/\s+/g, ' ').trim()
    .replace(/^\d{3}\b[\s:–-]*/, '')
    .replace(LEADING_REASON_PHRASE_RE, '')
    .replace(/[\s:;,–-]*\b[a-z0-9]+(?:_[a-z0-9]+)+\s*$/, '');
  s = s.replace(/\s+([:;,.!?])/g, '$1').replace(/:(?=[.!?]|$)/g, '').replace(/^[\s:;,.–—-]+|[\s:;,–—-]+$/g, '').trim();
  // A sentence left pointing at something that was removed ("You can find your
  // API key at") goes too, and so does what is only an HTTP reason phrase.
  s = s.split(/(?<=[.!?])\s+/).filter((part) => !DANGLING_RE.test(part)).join(' ').trim();
  if (REASON_PHRASE_RE.test(s)) return '';
  if (s.length > DETAIL_MAX) s = `${s.slice(0, DETAIL_MAX).trimEnd()}…`;
  return s;
}

const DANGLING_RE = /\b(?:at|from|see|visit|here|to|in|on|via)\s*[.:]?$/i;
const LEADING_REASON_PHRASE_RE = /^(?:internal server error|bad gateway|service unavailable|gateway time-?out|unauthorized|forbidden|not found|too many requests|bad request|payment required|request time-?out)\s*[:–-]\s*/i;
const REASON_PHRASE_RE = /^(?:internal server error|bad gateway|service unavailable|gateway time-?out|unauthorized|forbidden|not found|too many requests|bad request|payment required|request time-?out)\.?$/i;

/** A fault inside Natively: the request never reached anybody. */
const INTERNAL_RE = /no handler registered|is not a function|cannot read propert|cannot access '|is not defined|is not iterable|undefined is not|maximum call stack|object could not be cloned/i;
// The reason codes Natively's own API answers with (natively-api).
const NATIVELY_PLAN_LIMIT_RE = /\b(?:[a-z]+_)?(?:quota_exceeded|plan_limit|limit_exceeded|lifetime_exceeded)\b/;
const NATIVELY_PLAN_EXPIRED_RE = /\b(?:subscription_expired|license_expired)\b/;
const TRIAL_RE = /\btrial[_ ](?:has[_ ])?(?:expired|ended)\b/i;
// A plan or balance that ran out. "Quota exceeded for requests per minute" is
// a rate limit and is sorted as one; a snake_case *_quota_exceeded is a plan's.
const CREDITS_RE = /insufficient_quota|[a-z]*_?quota_exceeded\b|exceeded your current quota|out of credits|credit balance|billing|payment required/;
const AUTH_RE = /api[ _-]?key|unauthori[sz]ed|unauthenticated|invalid[_ ]credentials|permission[_ ]denied|forbidden|sign[- ]?in/i;
const RATE_RE = /rate[ _-]?limit|too many requests|resource_exhausted|quota exceeded for|per (?:minute|second)\b/i;
const MODEL_RE = /\bmodels?\b[^.\n]{0,120}?\b(?:not found|not supported|does not exist|not available|unavailable|not enabled)\b/i;
const UNREACHABLE_RE = /econnrefused|enotfound|econnreset|econnaborted|eai_again|ehostunreach|fetch failed|failed to fetch|network ?error|socket hang up/i;
const TIMEOUT_RE = /timed?[ -]?out|etimedout|deadline exceeded/i;
// host:port or a bare address, for "couldn't be reached"
const ADDRESS_RE = /\b(?:(?:\d{1,3}\.){3}\d{1,3}|localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d{2,5})?\b/i;

function statusOf(raw) {
  const named = raw.match(/\b(?:HTTP|status(?:\s+code)?)\s*[:=]?\s*(\d{3})\b/i);
  if (named) return Number(named[1]);
  const leading = unwrap(raw).match(/^(\d{3})\b/);
  const n = leading ? Number(leading[1]) : 0;
  return n >= 400 && n <= 599 ? n : undefined;
}

/** A sentence a person wrote, as opposed to what is left of a dump. */
function reads(sentence) {
  return sentence.length >= 12
    && /\s/.test(sentence)
    && !/[{}<>=]|\bat\s+\S+\s+\(|\bundefined\b|\bnull\b/.test(sentence);
}

const sentenceEnd = (s) => (/[.!?。！？…]$/u.test(s) ? s : `${s}.`);

/**
 * @param {unknown} raw  whatever was thrown or sent: an Error, a string.
 * @param {{ provider?: string }} [context]  the selected model's provider, as
 *   the model dropdown names it. Left out, a provider's failure is still
 *   explained, without naming anybody.
 * @returns {import('./directAssistFailure.mjs').DirectAssistAnswerFailure}
 */
export function chatFailureFromError(raw, context = {}) {
  const source = text(raw);
  const cleaned = scrubErrorText(source);

  if (INTERNAL_RE.test(source)) return { code: 'INTERNAL_ERROR' };
  if (TRIAL_RE.test(source)) return { code: 'TRIAL_ENDED' };

  const natively = /\bNatively API\b/i.test(source);
  // Natively's own plan ran out or lapsed: said as that, never as a provider
  // "out of credits" with a button to AI Providers, where nothing fixes it.
  if (natively && NATIVELY_PLAN_LIMIT_RE.test(source)) return { code: 'PLAN_LIMIT' };
  if (natively && NATIVELY_PLAN_EXPIRED_RE.test(source)) return { code: 'PLAN_EXPIRED' };

  const provider = natively ? 'Natively' : (context.provider || '').trim();
  const status = statusOf(source);
  // The provider's words are worth a line only when they say more than the
  // headline will ("Unauthorized" under "… rejected your key" says nothing).
  const detail = cleaned.split(/\s+/).length >= 3 ? cleaned : '';

  let cause = null;
  if (UNREACHABLE_RE.test(source)) {
    const address = source.match(ADDRESS_RE)?.[0];
    cause = { code: 'PROVIDER_ERROR', unreachable: true, ...(address ? { detail: address } : {}) };
  } else if (CREDITS_RE.test(source.toLowerCase()) || status === 402) cause = { code: 'QUOTA_EXHAUSTED' };
  else if (RATE_RE.test(source) || status === 429) cause = { code: 'RATE_LIMITED' };
  else if (MODEL_RE.test(source)) cause = { code: 'MODEL_UNAVAILABLE' };
  else if (AUTH_RE.test(source) || status === 401 || status === 403) cause = { code: 'AUTH_FAILED' };
  else if (TIMEOUT_RE.test(source) || status === 408 || status === 504) cause = { code: 'CONNECT_TIMEOUT' };
  else if (status) cause = { code: 'PROVIDER_ERROR', status };

  if (cause && provider) {
    return { provider, ...cause, ...(detail && !cause.unreachable ? { detail } : {}) };
  }
  if (cause) {
    // A provider failed and we cannot say which: its own words, or nothing.
    return { code: 'CHAT_ERROR', ...(detail && !cause.unreachable ? { detail } : {}) };
  }
  // Not a provider's failure at all: a sentence the app wrote ("Skill … is
  // disabled. Enable it in Settings → Skills.") is the explanation as it is.
  if (reads(cleaned)) return { code: 'CHAT_ERROR', message: sentenceEnd(cleaned) };
  return { code: 'CHAT_ERROR' };
}

/**
 * Is `text` the sentence main's engine sends as the ANSWER when What to Answer
 * failed on a provider (providerFailureUserMessage and
 * providerRejectionUserMessage in electron/llm/providerErrorClassifier.ts)?
 *
 * The engine sends its raw error first and this sentence after it. The overlay
 * posts a notice for the error so a failure is never silent, and takes that
 * notice back when this arrives, so the failure is said once.
 *
 * @param {string | null | undefined} text
 * @returns {boolean}
 */
export function isProviderFailureSentence(text) {
  const s = (text || '').trim();
  return PROVIDER_FAILURE_SENTENCE_STARTS.some((start) => s.startsWith(start));
}

/** The fixed openings of those sentences. Checked against main's source by test. */
export const PROVIDER_FAILURE_SENTENCE_STARTS = Object.freeze([
  "I couldn't reach the AI provider",
  'The AI provider is rate-limiting requests right now.',
  'The AI provider is unreachable or overloaded right now',
  'The AI provider rejected this request: ',
]);
