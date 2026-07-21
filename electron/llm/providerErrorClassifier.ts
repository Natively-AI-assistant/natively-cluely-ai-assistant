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
const STALL_RE = /^(?:\s*)(?:could you (?:please )?repeat|can you repeat|i(?:'m| am)? (?:sorry,? )?(?:i )?(?:didn'?t|did not) (?:catch|hear|get)|sorry,? (?:could|can) you|i want to make sure i (?:address|understand)|please (?:repeat|clarify|rephrase)|what (?:was|did) (?:the|you))/i;

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
