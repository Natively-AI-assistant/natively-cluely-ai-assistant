// electron/context-intelligence/debug/redaction.ts
//
// THE centralized redaction utility for Context Intelligence debug logging.
// Every debug sink (terminal renderer, JSONL writer, previews) goes through
// these functions — no logger implements its own ad-hoc redaction, which is how
// redaction lists drift and leak.
//
// Two tiers:
//   redactSecrets  — ALWAYS applied, at every level including unsafe local
//                    content mode. Credentials must never reach a log file.
//   redactPii      — applied at Standard and normal Verbose. Emails, phone
//                    numbers and street-address-shaped lines are masked.
//
// Previews are additionally length-limited (PREVIEW_MAX_CHARS) and marked.

export const PREVIEW_MAX_CHARS = 240;

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // Bearer / authorization headers (value redacted, header name kept).
  { re: /\b(authorization\s*[:=]\s*)(?:bearer\s+)?[a-z0-9._~+/=-]{8,}/gi, label: '$1[REDACTED_AUTH]' },
  { re: /\bbearer\s+[a-z0-9._~+/=-]{8,}/gi, label: 'Bearer [REDACTED_TOKEN]' },
  // Common provider key shapes.
  { re: /\bsk-[a-zA-Z0-9_-]{16,}\b/g, label: '[REDACTED_API_KEY]' },
  { re: /\bsk-ant-[a-zA-Z0-9_-]{16,}\b/g, label: '[REDACTED_API_KEY]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: '[REDACTED_AWS_KEY]' },
  { re: /\bAIza[0-9A-Za-z_-]{30,}\b/g, label: '[REDACTED_API_KEY]' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, label: '[REDACTED_GITHUB_TOKEN]' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, label: '[REDACTED_SLACK_TOKEN]' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, label: '[REDACTED_JWT]' },
  // key=value / key: value for sensitive key names (json or env style).
  {
    re: /\b((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd|pwd|secret|token|cookie|set-cookie)\b\s*["']?\s*[:=]\s*["']?)([^\s"',;&]{4,})/gi,
    label: '$1[REDACTED]',
  },
  // Private key blocks.
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: '[REDACTED_PRIVATE_KEY]' },
  // Connection strings with credentials: scheme://user:pass@host
  { re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@]+)@/gi, label: '$1$2:[REDACTED]@' },
  // Signed URLs — strip query-string signatures.
  { re: /([?&](?:sig|signature|x-amz-signature|token|sas|se|st|sp|sv|sr|x-goog-signature)=)[^\s&"']+/gi, label: '$1[REDACTED]' },
];

const PII_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // Email addresses.
  { re: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, label: '[REDACTED_EMAIL]' },
  // Phone numbers: +cc and common grouped forms (7+ digits with separators).
  { re: /(?<![\d/.-])(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)\d{3,4}[\s-]\d{3,4}(?![\d/.-])/g, label: '[REDACTED_PHONE]' },
  { re: /(?<![\w/.-])\+\d{9,14}\b/g, label: '[REDACTED_PHONE]' },
  // Street-address-shaped fragments ("12 Foo Street", "Flat 4B, ... Road").
  { re: /\b\d{1,5}[a-z]?[,\s]+(?:[A-Z][a-z]+\s){0,3}(?:street|st\.|road|rd\.|avenue|ave\.?|lane|ln\.|drive|dr\.|boulevard|blvd\.?|apartment|apt\.?|flat|suite)\b[^\n]{0,40}/gi, label: '[REDACTED_ADDRESS]' },
];

/** Always-on credential scrubbing. Idempotent. */
export function redactSecrets(text: string): string {
  let out = String(text);
  for (const { re, label } of SECRET_PATTERNS) out = out.replace(re, label);
  return out;
}

/** PII scrubbing for Standard/Verbose. Idempotent. */
export function redactPii(text: string): string {
  let out = String(text);
  for (const { re, label } of PII_PATTERNS) out = out.replace(re, label);
  return out;
}

export interface PreviewOptions {
  /** Skip PII masking — ONLY for unsafe local content mode (secrets still scrubbed). */
  includePii?: boolean;
  maxChars?: number;
}

export interface RedactedPreview {
  text: string;
  redacted: boolean;
  truncated: boolean;
}

/**
 * Build a log-safe preview of arbitrary source/evidence text: secrets always
 * scrubbed, PII scrubbed unless unsafe content mode, whitespace collapsed,
 * hard length cap with an explicit truncation marker.
 */
export function buildPreview(text: string, opts: PreviewOptions = {}): RedactedPreview {
  const max = opts.maxChars ?? PREVIEW_MAX_CHARS;
  const collapsed = String(text).replace(/\s+/g, ' ').trim();
  let scrubbed = redactSecrets(collapsed);
  if (!opts.includePii) scrubbed = redactPii(scrubbed);
  const redacted = scrubbed !== collapsed;
  if (scrubbed.length <= max) return { text: scrubbed, redacted, truncated: false };
  return { text: `${scrubbed.slice(0, max)}… [truncated]`, redacted, truncated: true };
}

/**
 * Deep-scrub every string field of a record before it reaches a sink. Applied
 * as the LAST line of defence at the writer/terminal boundary — individual
 * fields should already be clean, but a field added later by someone who did
 * not read this file must not become a leak.
 */
export function deepRedactStrings<T>(value: T, includePii = false): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const s = redactSecrets(v);
      return includePii ? s : redactPii(s);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
