// electron/llm/providerErrorClassifier.ts
//
// Pure, deterministic classification of provider failures (release 2026-06-07c).
// One place to decide: is this a quota/rate-limit, an overload, an auth failure, a
// timeout, a zero-token empty, or a content-free clarification stall? The product
// uses it to decide whether to fall back deterministically vs surface an error; the
// benchmark uses it to SEPARATE provider-outage rows (excluded from the pass
// denominator) from genuine logic defects.
//
// No I/O, no LLM. Inspects an error object and/or the produced text.

import { redactSecretsOnly } from '../utils/redactForLog';

export type ProviderErrorKind =
  | 'rate_limit'        // 429 / RESOURCE_EXHAUSTED / "rate limit"
  | 'auth'              // 401 / 403 / API_KEY / permission
  | 'overloaded'        // 503 / 529 / "overloaded"
  | 'server_error'      // 500 / other 5xx
  | 'timeout'           // deadline / ETIMEDOUT / first-useful timeout / abort
  | 'network'           // ENOTFOUND / ECONNRESET / DNS
  | 'zero_token'        // stream produced no text
  | 'stall'             // produced only a content-free clarification ("could you repeat that?")
  | 'none';             // not a provider failure

export interface ProviderErrorClassification {
  kind: ProviderErrorKind;
  /** True when this is an ENVIRONMENT condition (exclude from logic-defect scoring). */
  isOutage: boolean;
  /** True when the product MAY safely retry/hedge/fallback. */
  retryable: boolean;
  /** Short code for telemetry (no raw content). */
  code: string;
}

// A content-free clarification stall the model emits when it's confused/degraded.
// MUST stay in sync with IntelligenceEngine's "Could you repeat that?" fallback and
// the benchmark's stall quarantine.
const STALL_RE = /^(?:\s*)(?:i couldn'?t generate an answer|the answer(?: about [^.]{1,60})? didn'?t come through|no answer came back|could you (?:please )?repeat|can you repeat|i(?:'m| am)? (?:sorry,? )?(?:i )?(?:didn'?t|did not) (?:catch|hear|get)|sorry,? (?:could|can) you|i want to make sure i (?:address|understand)|please (?:repeat|clarify|rephrase)|what (?:was|did) (?:the|you))/i;

/** Is `text` a content-free clarification stall (not a real answer)? */
export function isClarificationStall(text: string | null | undefined): boolean {
  const s = (text || '').trim();
  return s.length > 0 && s.length < 200 && STALL_RE.test(s);
}

function statusOf(err: any): number {
  if (!err) return 0;
  return Number(err.status ?? err.statusCode ?? err.code) || 0;
}

/**
 * Is this a PERMANENT, account-level failure that will NOT self-heal on retry
 * and — critically — is shared across every model that uses the SAME API key?
 *
 * Returns true for: expired / invalid / missing API key, 401/403 auth &
 * permission failures, and BILLING / credit exhaustion (Gemini surfaces these as
 * RESOURCE_EXHAUSTED with a "billing"/"credit" hint, or FAILED_PRECONDITION /
 * "billing account"). These mean the KEY is the problem, so retrying a sibling
 * model on the same key is pointless — the caller should abandon that provider's
 * cascade entirely and fall through to the NEXT provider.
 *
 * Returns false for transient conditions that ARE worth walking sibling models
 * for: plain 429 rate limits (per-model quota buckets differ), 503/529 overload,
 * timeouts, network blips, and generic 5xx. A bare "quota"/"RESOURCE_EXHAUSTED"
 * without a billing/credit hint is treated as a transient rate limit, NOT a
 * permanent billing failure (Gemini uses RESOURCE_EXHAUSTED for per-minute rate
 * limits too), so we still try the next model tier.
 */
export function isPermanentKeyError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  const status = statusOf(err);

  // 401/403 + auth/permission/expired/invalid-key signals → key is bad.
  if (
    status === 401 || status === 403 ||
    /\b401\b|\b403\b|unauthor|forbidden|permission_denied|permission denied|\bpermission\b/.test(msg) ||
    /api[_ ]?key (?:not valid|invalid|expired)|invalid.*api[_ ]?key|expired.*api[_ ]?key|api[_ ]?key.*(?:invalid|expired)|api_key_invalid|invalid_api_key|missing.*api[_ ]?key/.test(msg)
  ) {
    return true;
  }

  // Billing / credit exhaustion → account can't pay; sibling models share it.
  // Gemini: FAILED_PRECONDITION + "billing"; or RESOURCE_EXHAUSTED that explicitly
  // names billing/credit (vs a bare per-minute rate-limit RESOURCE_EXHAUSTED).
  if (
    /billing|insufficient[_ ]?(?:credit|quota|funds)|no credits?|out of credits?|payment required|account.*(?:suspend|disabled|deactivat)|failed_precondition.*billing/.test(msg)
  ) {
    return true;
  }
  if (status === 402 || /\b402\b/.test(msg)) return true; // Payment Required

  return false;
}

/**
 * Classify a provider failure from an error object and/or the produced text.
 * Pass `text` (possibly empty) so a successful HTTP call that returned no tokens or
 * a stall is still classified as an outage rather than a logic pass.
 */
export function classifyProviderError(err: any, text?: string): ProviderErrorClassification {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  const status = statusOf(err);

  // 1. Hard error object present → classify by status/message first.
  if (err) {
    if (status === 429 || /\b429\b|rate.?limit|resource_exhausted|quota|too many requests/.test(msg)) {
      return { kind: 'rate_limit', isOutage: true, retryable: true, code: 'rate_limit' };
    }
    if (status === 401 || status === 403 || /\b401\b|\b403\b|api[_ ]?key|permission|unauthor|forbidden|invalid.*key|expired.*key/.test(msg)) {
      return { kind: 'auth', isOutage: true, retryable: false, code: 'auth' };
    }
    if (status === 503 || status === 529 || /\b503\b|\b529\b|overloaded|unavailable|capacity/.test(msg)) {
      return { kind: 'overloaded', isOutage: true, retryable: true, code: 'overloaded' };
    }
    if (/etimedout|deadline|timeout|timed out|aborted|abort|first.?useful.*deadline/.test(msg)) {
      return { kind: 'timeout', isOutage: true, retryable: true, code: 'timeout' };
    }
    if (/enotfound|econnreset|econnrefused|network|dns|getaddrinfo|socket hang/.test(msg)) {
      return { kind: 'network', isOutage: true, retryable: true, code: 'network' };
    }
    if (status >= 500 || /\b5\d\d\b|internal error|server error/.test(msg)) {
      return { kind: 'server_error', isOutage: true, retryable: true, code: 'server_error' };
    }
    // An unrecognized thrown error is still a failure — treat as a retryable outage
    // conservatively (it produced no usable answer), so it never scores as a defect.
    return { kind: 'server_error', isOutage: true, retryable: true, code: 'unknown_error' };
  }

  // 2. No error object — inspect the produced text.
  const t = (text ?? '').trim();
  if (!t) return { kind: 'zero_token', isOutage: true, retryable: true, code: 'zero_token' };
  if (isClarificationStall(t)) return { kind: 'stall', isOutage: true, retryable: true, code: 'stall' };

  return { kind: 'none', isOutage: false, retryable: false, code: 'ok' };
}

/** `code` on the error LLMHelper throws when every configured provider was
 *  tried and failed (as opposed to none being configured). */
export const PROVIDERS_EXHAUSTED_CODE = 'PROVIDERS_EXHAUSTED';

export function isProvidersExhaustedError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === PROVIDERS_EXHAUSTED_CODE;
}

/** Same opening as the transport line below, so the overlay's
 *  PROVIDER_FAILURE_SENTENCE_STARTS already recognises it. */
const PROVIDERS_UNREACHABLE_LINE = "The AI provider is unreachable or overloaded right now, so I couldn't generate an answer. Try again in a moment.";

/**
 * The user-facing line for a PROVIDER failure on the What-To-Answer path, or
 * null when the error is not a provider failure (2026-09-07).
 *
 * The engine's catch used to return the graceful "Could you repeat that?"
 * retry for EVERY error — including a dead API key, a 429 and a network
 * outage — so a provider problem read as the app not having heard the
 * question. WhatToAnswerLLM already distinguishes those for its own stream
 * failures; this is the same distinction, made once, for the engine's outer
 * catch. Timeouts and empty streams keep the graceful retry: those already
 * have their own deadline fallbacks and the retry wording is honest there.
 */
export function providerFailureUserMessage(err: unknown): string | null {
  if (!err) return null;
  const own = accountOrSetupUserMessage(err);
  if (own) return own;
  // Every configured provider was tried and failed (F-ACC-10). Say what the last
  // one said when that is specific (a key, a rate limit), else that the
  // providers are not answering — never "set one up".
  if (isProvidersExhaustedError(err)) {
    const cause = (err as { cause?: unknown }).cause;
    const specific = cause && !isProvidersExhaustedError(cause) ? providerFailureUserMessage(cause) : null;
    return specific ?? PROVIDERS_UNREACHABLE_LINE;
  }
  const rejection = providerRejectionUserMessage(err);
  if (rejection) return rejection;
  const c = classifyProviderError(err);
  const msg = String((err as { message?: unknown })?.message ?? err ?? '').toLowerCase();
  const status = statusOf(err);
  // The classifier's server/network buckets are deliberately broad for outage
  // SCORING; for a user-facing claim require a concrete transport signal, so a
  // plain programming error keeps the graceful retry instead of blaming the
  // provider.
  const transportSignal = status >= 500
    || /\b5\d\d\b|internal server error|bad gateway|overloaded|unavailable|capacity|enotfound|econnreset|econnrefused|eai_again|etimedout|socket hang up|network|dns\b|fetch failed/.test(msg);
  switch (c.kind) {
    case 'auth':
      return "I couldn't reach the AI provider — this looks like an API key or permission issue. Check your API keys / plan in Settings and try again.";
    case 'rate_limit':
      return 'The AI provider is rate-limiting requests right now. Give it a moment and try again.';
    case 'overloaded':
    case 'server_error':
    case 'network':
      return transportSignal
        ? "The AI provider is unreachable or overloaded right now, so I couldn't generate an answer. Try again in a moment."
        : null;
    default:
      return null;
  }
}

// A request the provider refuses PERMANENTLY for this account/model: a model the
// plan does not include, a model id that does not exist, a parameter value the
// model rejects. Retrying cannot succeed, so the provider's own explanation is
// the answer (issue #543: a ChatGPT-plan Codex user pressed "What to answer"
// and saw "could you ask that once more?" while the backend was saying
// "The '<model>' model is not supported when using Codex with a ChatGPT account").
// ── Not a provider's failure: the trial, the plan, or nothing set up ───────
//
// 2026-11-03. A trial whose AI allowance ran out was refused by the Natively
// API, fell through every other provider (a trial has none) and ended on
// "No AI provider configured. Please add at least one API key in Settings."
// Every catch then read "api key" or "quota" as a provider's problem and said
// "this looks like an API key or rate-limit issue. Check your API keys": the
// wrong cause, and a fix that fixes nothing. These say what happened. The same
// four sorts as the overlay's src/lib/chatFailure.mjs, in the same order; its
// PROVIDER_FAILURE_SENTENCE_STARTS lists these openings (checked by test).
const NATIVELY_SOURCE_RE = /\bNatively API\b/i;
const NATIVELY_PLAN_LIMIT_RE = /\b(?:[a-z]+_)?(?:quota_exceeded|plan_limit|limit_exceeded|lifetime_exceeded)\b/;
const NATIVELY_PLAN_EXPIRED_RE = /\b(?:subscription_expired|license_expired)\b/;
const TRIAL_ENDED_RE = /\btrial[_ ](?:has[_ ])?(?:expired|ended)\b/i;
const NO_PROVIDER_RE = /\bNo AI provider configured\b/;

/**
 * The line for a failure that is no provider's fault: the free trial ended,
 * the Natively plan's limit was reached or the plan lapsed, or no AI provider
 * is set up. Null for anything else.
 */
export function accountOrSetupUserMessage(err: unknown): string | null {
  if (!err) return null;
  const msg = String((err as { message?: unknown })?.message ?? err ?? '');
  if (TRIAL_ENDED_RE.test(msg)) return 'Your free trial has ended. Pick a plan or add your own keys to keep getting answers.';
  const natively = NATIVELY_SOURCE_RE.test(msg);
  if (natively && NATIVELY_PLAN_LIMIT_RE.test(msg)) return "You've reached your Natively plan's limit. See Settings › Plans to keep getting answers.";
  if (natively && NATIVELY_PLAN_EXPIRED_RE.test(msg)) return 'Your Natively plan has expired. Renew it in Settings › Plans to keep getting answers.';
  if (NO_PROVIDER_RE.test(msg)) return 'No AI provider is set up yet. Add one in Settings › AI Providers.';
  return null;
}

const PROVIDER_REJECTION_RE = /\bmodels?\b[^\n]{0,120}?\b(?:is not supported|not supported|is not available|not available|is not found|not found|does not exist|is not enabled|unsupported)\b|\bunsupported (?:value|parameter|model)\b|\bmodel_not_found\b|\binvalid[_ ]model\b/i;

/** Fixed start of the rejection line, so downstream guards can recognise it
 *  as a provider error (shown, never stored as session history). */
export const PROVIDER_REJECTION_PREFIX = 'The AI provider rejected this request: ';

const PROVIDER_REJECTION_DETAIL_MAX = 240;

/**
 * The user-facing line for a permanent provider rejection, or null. Auth and
 * rate-limit failures keep their own lines (providerFailureUserMessage).
 */
export function providerRejectionUserMessage(err: unknown): string | null {
  if (!err) return null;
  const raw = String((err as { message?: unknown })?.message ?? err ?? '');
  if (!PROVIDER_REJECTION_RE.test(raw)) return null;
  const kind = classifyProviderError(err).kind;
  if (kind === 'auth' || kind === 'rate_limit') return null;
  let detail = String(redactSecretsOnly(raw.replace(/\s+/g, ' ').trim()));
  if (detail.length > PROVIDER_REJECTION_DETAIL_MAX) {
    detail = `${detail.slice(0, PROVIDER_REJECTION_DETAIL_MAX).trimEnd()}…`;
  } else if (!/[.!?]$/.test(detail)) {
    detail += '.';
  }
  return `${PROVIDER_REJECTION_PREFIX}${detail} Choose a different model in Settings → AI Providers.`;
}

/** Is `text` a line produced by providerRejectionUserMessage? */
export function isProviderRejectionLine(text: string | null | undefined): boolean {
  return (text || '').trim().startsWith(PROVIDER_REJECTION_PREFIX);
}
