/**
 * What the overlay says when a provider fails on the direct-ask path
 * (unit-tested). Main sends a reason code, an HTTP status, how long the
 * provider was given and the provider's own words; this turns them into what
 * is shown. Nothing here ever prints the code or the status number — they are
 * for choosing the words.
 *
 * Every state has the same shape (directAssistNoticeView): a headline, the
 * provider's own words, one row per provider that failed, and whether opening
 * AI Providers could fix it.
 *
 * Wording is whole sentences with a `{provider}` slot, passed through `t`
 * BEFORE the name goes in, so a language can put the name where it belongs.
 * Provider names arrive already written for display and are never translated;
 * neither are the provider's own words.
 */

const identity = (text) => text;

// One entry per cause. `fixable` = the user can do something about it in
// Settings → AI Providers (a key, a plan, a model, a missing setup).
const CAUSE = {
  auth: { phrase: '{provider} rejected your key or sign-in', fixable: true },
  credits: { phrase: '{provider} is out of credits', fixable: true },
  model: { phrase: "{provider} doesn't have this model", fixable: true },
  setup: { phrase: "{provider} isn't set up", fixable: true },
  rate: { phrase: '{provider} is rate limiting requests' },
  idle: { phrase: '{provider} stopped responding' },
  timeout: { phrase: "{provider} didn't respond in time" },
  waited: { phrase: "{provider} didn't respond in {seconds} s" },
  empty: { phrase: '{provider} returned an empty answer' },
  brokeOff: { phrase: '{provider} stopped before finishing' },
  unreachable: { phrase: "{provider} couldn't be reached" },
  tooLarge: { phrase: '{provider} rejected the request as too large' },
  rejected: { phrase: '{provider} rejected the request' },
  overloaded: { phrase: '{provider} is overloaded' },
  server: { phrase: '{provider} had a server error' },
  failed: { phrase: '{provider} failed' },
};

const ANSWERED_BY = 'Answered by {provider}';
const TRYING = 'Trying {provider}…';
const NOBODY_ANSWERED = 'None of your providers could answer';
const CUT_OFF = 'Answer cut off';
const APP_FAULT = 'Natively lost track of this answer. Ask again.';
const NOT_COMPLETED = "The request couldn't be completed.";
const NO_PROVIDER = 'No AI provider is set up yet';
// An answer Natively itself stopped (2026-10-04): the output reached the
// length limit, or the model began repeating one passage over and over.
// Not a provider failure — nothing in AI Providers fixes it.
const LENGTH_LIMIT = 'It reached the length limit';
const REPEATING = 'It started repeating itself';
const OWN_STOP_BY_CODE = { OUTPUT_LIMIT: LENGTH_LIMIT, OUTPUT_REPETITION: REPEATING };

/**
 * The notice data for an answer Natively stopped itself, from the stream's
 * stop reason (main's StreamOutcome.reason). Null for any other reason: a
 * provider breaking off is not reported through this path.
 *
 * @param {string | undefined | null} reason
 * @returns {{ partial: true, code: 'OUTPUT_LIMIT' | 'OUTPUT_REPETITION', provider: '' } | null}
 */
export function ownStopFailure(reason) {
  if (reason === 'output_cap_reached') return { partial: true, code: 'OUTPUT_LIMIT', provider: '' };
  if (reason === 'output_repetition') return { partial: true, code: 'OUTPUT_REPETITION', provider: '' };
  return null;
}

/** The label of the one action a notice can offer. Worded here so the
 *  translation tables are checked against a single list. */
export const DIRECT_ASSIST_OPEN_PROVIDERS = 'Open AI Providers';

/** Every sentence this module can hand to `t`. */
export const DIRECT_ASSIST_PHRASES = Object.freeze([
  ...Object.values(CAUSE).map((cause) => cause.phrase),
  ANSWERED_BY,
  TRYING,
  NOBODY_ANSWERED,
  CUT_OFF,
  LENGTH_LIMIT,
  REPEATING,
  APP_FAULT,
  NOT_COMPLETED,
  NO_PROVIDER,
]);

/** A cause main names outright. */
const CAUSE_BY_CODE = {
  AUTH_FAILED: 'auth',
  RATE_LIMITED: 'rate',
  QUOTA_EXHAUSTED: 'credits',
  MODEL_UNAVAILABLE: 'model',
  NO_PROVIDER_CONFIGURED: 'setup',
  STREAM_IDLE_TIMEOUT: 'idle',
};

/**
 * Codes that mean the PROVIDER failed. For anything else (a bad attachment, a
 * blocked screenshot) the request never left, and main's own sentence is the
 * explanation.
 */
const PROVIDER_CODES = new Set([
  ...Object.keys(CAUSE_BY_CODE),
  'CONNECT_TIMEOUT',
  'INCOMPLETE_STREAM',
  'PROVIDER_ERROR',
]);

/** A fault of ours (the relay broke), never the provider's. */
const APP_FAULT_CODE = 'INTERNAL_ERROR';

/** A generic failure, sorted by its status. */
function causeForStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'credits';
  if (status === 429) return 'rate';
  if (status === 404) return 'model';
  if (status === 413) return 'tooLarge';
  if (status === 400 || status === 422) return 'rejected';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 503 || status === 529) return 'overloaded';
  if (status >= 500 && status <= 599) return 'server';
  return 'failed';
}

function causeOf({ code, status, waitedMs, partial, unreachable }) {
  if (code === 'CONNECT_TIMEOUT') return Math.round(Number(waitedMs) / 1000) >= 1 ? 'waited' : 'timeout';
  if (code === 'INCOMPLETE_STREAM') return partial ? 'brokeOff' : 'empty';
  // Offline, or a local server that is not running: no status ever came back.
  return CAUSE_BY_CODE[code] ?? (unreachable ? 'unreachable' : causeForStatus(status));
}

function fill(template, values, t) {
  return t(template).replace(/\{(\w+)\}/g, (slot, key) => (key in values ? String(values[key]) : slot));
}

/**
 * "OpenAI rejected your key or sign-in" — no trailing punctuation.
 *
 * @param {{ provider: string, code: string, status?: number, waitedMs?: number, partial?: boolean, unreachable?: boolean }} failure
 * @param {(text: string) => string} [t]
 * @returns {string}
 */
export function directAssistFailureReason(failure, t = identity) {
  return fill(CAUSE[causeOf(failure)].phrase, {
    provider: failure.provider,
    seconds: Math.round(Number(failure.waitedMs) / 1000),
  }, t);
}

function rowFor(failure, t) {
  return {
    text: directAssistFailureReason(failure, t),
    ...(failure.detail ? { detail: failure.detail } : {}),
  };
}

const isFixable = (failure) => CAUSE[causeOf(failure)].fixable === true;

const isProviderFailure = (failure) => Boolean(failure.provider) && PROVIDER_CODES.has(failure.code);

/**
 * Everything the notice under (or in place of) an answer shows.
 *
 *  - `trying`   a provider failed and the next one is being asked
 *  - `answered` a different provider than the selected one answered
 *  - `cutoff`   an answer began and broke off
 *  - `failed`   nobody answered
 *
 * `ended` = the request is over (the card is no longer streaming). A request
 * that ended with no answerer and no failure was cancelled: nothing is shown,
 * because "trying" would describe something that is no longer happening.
 *
 * @param {{ failure?: object, fallbackNotice?: { hops: object[], answeredBy?: string }, ended?: boolean }} state
 * @param {(text: string) => string} [t]
 * @returns {{ tone: 'trying' | 'answered' | 'cutoff' | 'failed', headline: string, detail?: string, rows: Array<{ text: string, detail?: string }>, fixable: boolean } | null}
 */
export function directAssistNoticeView({ failure, fallbackNotice, ended = false }, t = identity) {
  const hops = fallbackNotice?.hops ?? [];

  if (failure?.partial && OWN_STOP_BY_CODE[failure.code]) {
    return { tone: 'cutoff', headline: t(CUT_OFF), rows: [{ text: t(OWN_STOP_BY_CODE[failure.code]) }], fixable: false };
  }

  if (failure?.partial) {
    // Whoever was writing stopped; then what failed before it took over.
    const causes = [failure, ...hops];
    return {
      tone: 'cutoff',
      headline: t(CUT_OFF),
      rows: isProviderFailure(failure)
        ? causes.map((cause) => rowFor(cause, t))
        : [{ text: appFaultOrMessage(failure, t) }, ...hops.map((hop) => rowFor(hop, t))],
      fixable: causes.some((cause) => isProviderFailure(cause) && isFixable(cause)),
    };
  }

  if (failure) {
    // First run: nothing is set up, so nothing was asked. Main's sentence for
    // this is internal wording, and it is the one failure where opening
    // AI Providers is exactly the fix.
    if (failure.code === 'NO_PROVIDER_CONFIGURED' && !failure.provider) {
      return { tone: 'failed', headline: t(NO_PROVIDER), rows: [], fixable: true };
    }
    // The words beneath are OUR sentence, not the provider's (main sends a
    // specific sentence of its own both as the message and as the detail).
    // It explains more than "<provider> failed" would, so it is the headline
    // — once. This also covers a fault of ours thrown inside every provider
    // attempt (an unreadable screenshot): one cause, not a list of providers.
    const ownSentence = failure.message?.trim();
    if (!isProviderFailure(failure) || (ownSentence && failure.detail === ownSentence)) {
      const headline = appFaultOrMessage(failure, t);
      return {
        tone: 'failed',
        headline,
        ...(failure.detail && failure.detail !== headline ? { detail: failure.detail } : {}),
        rows: [],
        fixable: false,
      };
    }
    const attempts = failure.attempts ?? [];
    if (attempts.length > 1) {
      return {
        tone: 'failed',
        headline: t(NOBODY_ANSWERED),
        rows: attempts.map((attempt) => rowFor(attempt, t)),
        fixable: attempts.some(isFixable),
      };
    }
    return {
      tone: 'failed',
      headline: directAssistFailureReason(failure, t),
      ...(failure.detail ? { detail: failure.detail } : {}),
      rows: [],
      fixable: isFixable(failure),
    };
  }

  if (hops.length === 0) return null;
  if (!fallbackNotice.answeredBy && ended) return null;
  return {
    tone: fallbackNotice.answeredBy ? 'answered' : 'trying',
    headline: fallbackNotice.answeredBy
      ? fill(ANSWERED_BY, { provider: fallbackNotice.answeredBy }, t)
      : fill(TRYING, { provider: hops[hops.length - 1].next }, t),
    rows: hops.map((hop) => rowFor(hop, t)),
    fixable: hops.some(isFixable),
  };
}

/** Not a provider failure: our own fault, or the sentence main wrote. */
function appFaultOrMessage(failure, t) {
  if (failure.code === APP_FAULT_CODE) return t(APP_FAULT);
  return failure.message?.trim() || t(NOT_COMPLETED);
}

/**
 * The one plain sentence kept as the failed message's TEXT — what Copy takes
 * and what later context sees. The provider's own words are not part of it.
 *
 * @param {object} failure
 * @param {(text: string) => string} [t]
 * @returns {string}
 */
export function directAssistFailureText(failure, t = identity) {
  const { headline } = directAssistNoticeView({ failure: { ...failure, partial: false }, ended: true }, t);
  if (/[.!?。！？…]$/u.test(headline)) return headline;
  // Ended the way the language ends a sentence: Chinese and Japanese use 。
  return /[぀-ヿ一-鿿]/u.test(headline) ? `${headline}。` : `${headline}.`;
}
