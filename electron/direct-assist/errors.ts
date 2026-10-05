import type { DirectAssistErrorCode, DirectAssistErrorPayload, DirectAssistFailureInfo } from './types';
import { redactSecretsOnly } from '../utils/redactForLog';

export class DirectAssistError extends Error {
  public readonly code: DirectAssistErrorCode;
  public readonly retryable: boolean;

  constructor(code: DirectAssistErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'DirectAssistError';
    this.code = code;
    this.retryable = retryable;
  }

  public toPayload(): DirectAssistErrorPayload {
    return Object.freeze({
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    });
  }
}

function statusFrom(error: unknown): number | undefined {
  const candidate = error as any;
  const status = candidate?.status ?? candidate?.statusCode ?? candidate?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The selected provider could not complete the request.';
}

/**
 * Convert provider failures to a stable IPC error contract. The `code` and
 * `message` it produces are content-free: fixed sentences, never provider
 * text. What the provider itself said travels separately, through
 * describeDirectAssistFailure below.
 */
export function normalizeDirectAssistError(error: unknown): DirectAssistError {
  if (error instanceof DirectAssistError) return error;

  // The shared fallback engine throws an AGGREGATE when a multi-rung ladder is
  // exhausted, and hangs the first rung's real error on `firstProviderError`
  // (streamFallbackEngine, "Carry the first error through"). Unwrap that
  // instead of classifying the aggregate's prose: the sentence names every
  // provider tried, which is exactly what this function exists to keep off
  // the IPC contract, and its wording would fall through to a generic
  // PROVIDER_ERROR. The FIRST rung is the right one to report — it is the
  // provider the user actually selected.
  //
  // Keyed on `firstProviderError` ALONE, and deliberately NOT on `.cause`.
  // Node's own fetch sets `.cause` on a TypeError, and plenty of SDKs set it
  // for unrelated wrapping — following it would let an inner error discard a
  // correct top-level classification (a real `.status`, say).
  // `firstProviderError` is set by nothing but our engine, so it is
  // unambiguous. Single-hop, not recursive: the engine's firstError is always
  // a rung's own throw and never another aggregate, so one hop suffices — and
  // not recursing removes an unbounded-recursion vector on a cyclic `.cause`.
  const wrapped = (error as any)?.firstProviderError;
  if (wrapped && wrapped !== error) return normalizeDirectAssistError(wrapped);

  const candidate = error as any;
  if (candidate?.name === 'AntigravityError') {
    if (candidate.code === 'cancelled') return new DirectAssistError('CANCELLED', 'The request was cancelled.');
    if (candidate.code === 'auth_required' || candidate.code === 'auth_revoked') {
      return new DirectAssistError('AUTH_FAILED', 'Sign in to Google Antigravity again in Settings → AI Providers.');
    }
    if (candidate.code === 'storage') {
      return new DirectAssistError('PROVIDER_ERROR', 'Google credentials could not be saved. Check credential storage in Settings and try again.');
    }
  }
  if (candidate?.name === 'AbortError' || candidate?.code === 'ABORT_ERR') {
    return new DirectAssistError('CANCELLED', 'The request was cancelled.');
  }

  const status = statusFrom(error);
  if (status === 401 || status === 403) {
    return new DirectAssistError('AUTH_FAILED', 'The selected provider rejected its credentials.');
  }
  if (status === 402) {
    return new DirectAssistError('QUOTA_EXHAUSTED', 'The selected provider has no available quota.');
  }
  if (status === 429) {
    return new DirectAssistError('RATE_LIMITED', 'The selected provider is rate limited.', true);
  }

  const code = String(candidate?.code ?? '').toUpperCase();
  const message = safeMessage(error).toLowerCase();
  if (code.includes('TIMEOUT') || message.includes('timed out') || message.includes('timeout')) {
    return new DirectAssistError('CONNECT_TIMEOUT', 'The selected provider timed out.', true);
  }
  if (message.includes('not initialized') || message.includes('not configured') || message.includes('not set')) {
    return new DirectAssistError('NO_PROVIDER_CONFIGURED', 'The selected provider is not configured.');
  }
  if (status === 404 || message.includes('model_not_found') || message.includes('model not found')) {
    return new DirectAssistError('MODEL_UNAVAILABLE', 'The selected model is unavailable.');
  }

  // Not the SDK's message: `message` stays a fixed sentence. The provider's own
  // words are describeDirectAssistFailure's job, where they are cut down first.
  return new DirectAssistError(
    'PROVIDER_ERROR',
    status ? `The selected provider failed (HTTP ${status}).` : 'The selected provider could not complete the request.',
    status === undefined || status >= 500,
  );
}

// ── why it failed, for the person reading the overlay ───────────────────────

const FAILURE_DETAIL_MAX = 240;
const NOTHING_TO_ADD: DirectAssistFailureInfo = Object.freeze({});

/** Socket-level failures: the request never got an answer of any kind. */
const UNREACHABLE_RE = /\b(?:ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT)\b|socket hang up|^fetch failed$/i;

/** The engine's internal markers. They name a mechanism, not a cause. */
const ENGINE_SENTINELS: ReadonlySet<string> = new Set(['empty-stream', 'interchunk-stall']);

/**
 * Our own sentences that say no more than their code does ("The selected
 * provider rejected its credentials."). The overlay already words the code, so
 * repeating one of these underneath would be noise.
 */
function isCannedSentence(message: string): boolean {
  return /^The selected (?:provider|model) /.test(message)
    || message === 'No provider answered in time.'
    || message === 'The request was cancelled.';
}

function validStatus(value: unknown): number | undefined {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

/**
 * Several adapters put the status only in the sentence they throw
 * ("Custom Provider HTTP 500", "Ollama /api/chat 404: …", "[400 Bad Request]"),
 * so a status property is not enough. Only these known shapes: a bare leading
 * number is not read as a status, because "500 tokens exceeded" is not one.
 */
function statusFromText(text: string): number | undefined {
  const match = /\bHTTP (\d{3})\b/.exec(text)
    ?? /^Ollama (?:\/api\/\w+|API error:) (\d{3})\b/.exec(text)
    ?? /\[(\d{3}) [A-Za-z][A-Za-z ]*\]/.exec(text);
  return match ? validStatus(match[1]) : undefined;
}

function messageFromBody(body: unknown): string | undefined {
  const candidate = body as any;
  const found = [
    candidate?.error?.message,
    candidate?.error?.error?.message,
    candidate?.message,
    candidate?.error,
    candidate?.detail,
    candidate?.error_description,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);
  return found as string | undefined;
}

// Key shapes the shared log redactor does not cover: its `sk-` pattern stops at
// the hyphen in `sk-proj-…` and `sk-or-v1-…`. Kept here, not added there,
// because the log redactor's output is read by other tools. `*` is part of the
// run: OpenAI masks the key itself ("sk-proj-****…6789") and still shows its
// last four characters.
const KEY_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_*-]{16,}/g, '…'],
  [/\b(?:gsk|nvapi|xai|pplx|hf|dg)[-_][A-Za-z0-9_-]{16,}/g, '…'],
  [/AIza[A-Za-z0-9_-]{20,}/g, '…'],
  [/\bBearer\s+[A-Za-z0-9._~+/=:-]{8,}/gi, 'Bearer …'],
  [/([?&](?:key|api[_-]?key|token|access_token)=)[^&\s]+/gi, '$1…'],
];

function stripKeys(text: string): string {
  let out = text;
  for (const [pattern, replacement] of KEY_PATTERNS) out = out.replace(pattern, replacement);
  return String(redactSecretsOnly(out))
    .replace(/\[REDACTED\]/g, '…')
    // A key that ended a sentence leaves "….": the ellipsis is the full stop.
    .replace(/…\.(?=\s|$)/g, '…');
}

/**
 * One readable line out of whatever an adapter threw. The adapters wrap the
 * provider's answer in their own bookkeeping (request ids, the endpoint, the
 * raw JSON body); none of that is the reason, so it comes off.
 */
function humanLine(raw: string, status: number | undefined, echoOf: readonly string[]): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (!text || ENGINE_SENTINELS.has(text)) return '';

  // Google appends its machine-readable details as a JSON array. Only when a
  // sentence precedes it: a body that IS an array is read as a body below.
  text = text.replace(/(\S)\s*\[\{.*\}\]$/, '$1');

  // A JSON body is read for its message. More than once, because Google's
  // current SDK wraps the API's JSON body as the `message` of another one.
  for (let depth = 0; depth < 3; depth += 1) {
    const open = text.indexOf('{');
    const close = text.lastIndexOf('}');
    if (open < 0 || close <= open) break;
    let inner: string | undefined;
    try {
      inner = messageFromBody(JSON.parse(text.slice(open, close + 1)));
    } catch {
      break; // Not a JSON body after all: the sentence is used as written.
    }
    text = (inner ?? text.slice(0, open)).replace(/\s+/g, ' ').trim();
    if (inner === undefined) break;
  }

  text = text
    .replace(/\b(?:serverRequestId|requestId|endpoint)=\S+/g, '')
    .replace(/^Natively API(?: stream)? HTTP \d{3}\b[\s:]*/, '')
    .replace(/^\[GoogleGenerativeAI Error\]:\s*(?:Error fetching from \S+\s*)?/, '')
    .replace(/^\[\d{3}[^\]]*\]\s*/, '')
    .replace(/^Error: Failed to stream from Ollama \((.*)\)\.$/, '$1')
    .replace(/^Ollama (?:\/api\/\w+|API error:) \d{3}\b[\s:]*/, '')
    .replace(/^(?:Error: )?Custom Provider (?:returned )?HTTP \d{3}\b[\s:.]*/, '')
    .replace(/^Error streaming from custom provider\.?$/, '')
    .replace(/^Error:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (status !== undefined && text.startsWith(`${status} `)) text = text.slice(4).trim();
  // A machine code in front of the sentence ("RESOURCE_EXHAUSTED: Quota…",
  // "invalid_request_error: The model…"). It has to contain an underscore, so
  // an ordinary word before a colon ("Warning: …") is left alone.
  text = text.replace(/^(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[a-z]+(?:_[a-z0-9]+)+):\s*/, '');
  if (!text || text === 'unknown') return '';

  const bounded = text.slice(0, ECHO_SCAN_MAX);
  const unquoted = scrubEcho(bounded, echoOf);
  // Nothing of the provider's own left once the quote is out: say nothing.
  if (unquoted !== bounded && unquoted.replace(/[^\p{L}]/gu, '').length < 8) return '';
  text = stripKeys(unquoted);
  return text.length > FAILURE_DETAIL_MAX
    ? `${text.slice(0, FAILURE_DETAIL_MAX).trimEnd()}…`
    : text;
}

const ECHO_WINDOW = 20;
const ECHO_SCAN_MAX = 600;
const ECHO_SOURCE_MAX = 400_000;

/**
 * Cut out anything the provider quoted from the request.
 *
 * Providers often explain a refusal by repeating the input ("the content
 * '<your text>' was flagged"). The explanation is worth showing; the user's
 * own words — a transcript, a pasted document — are not something an error
 * line should carry around. Every run of ECHO_WINDOW or more characters that
 * also appears in the prompt is replaced by "…", and the provider's own words
 * around it stay.
 *
 * One sweep over each prompt against a table of the line's windows, not a
 * search per window: the prompt can be a few hundred thousand characters.
 */
function scrubEcho(text: string, echoOf: readonly string[]): string {
  if (echoOf.length === 0 || text.length < ECHO_WINDOW) return text;
  // Compared case-insensitively. Lower-casing can change a string's length for
  // a handful of characters; spans are then matched as written instead.
  const lowered = text.toLowerCase();
  const foldCase = lowered.length === text.length;
  const line = foldCase ? lowered : text;

  const windowStarts = new Map<string, number[]>();
  for (let i = 0; i + ECHO_WINDOW <= line.length; i += 1) {
    const key = line.slice(i, i + ECHO_WINDOW);
    const starts = windowStarts.get(key);
    if (starts) starts.push(i); else windowStarts.set(key, [i]);
  }

  const quoted = new Uint8Array(text.length);
  let found = false;
  for (const source of echoOf) {
    const collapsed = String(source ?? '').slice(0, ECHO_SOURCE_MAX).replace(/\s+/g, ' ');
    const prompt = foldCase ? collapsed.toLowerCase() : collapsed;
    for (let i = 0; i + ECHO_WINDOW <= prompt.length; i += 1) {
      const starts = windowStarts.get(prompt.slice(i, i + ECHO_WINDOW));
      if (!starts) continue;
      found = true;
      for (const start of starts) quoted.fill(1, start, start + ECHO_WINDOW);
    }
  }
  if (!found) return text;

  // A quote usually sits between spaces in the prompt too, so the match
  // reaches one space past each end. Give those back, or the words either
  // side of the "…" run together.
  for (let i = 0; i < text.length; i += 1) {
    if (!quoted[i] || text[i] !== ' ') continue;
    if (i === 0 || !quoted[i - 1] || i + 1 === text.length || !quoted[i + 1]) quoted[i] = 0;
  }

  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (!quoted[i]) out += text[i];
    else if (i === 0 || !quoted[i - 1]) out += '…';
  }
  return out.replace(/…(?:\s*…)+/g, '…').trim();
}

/**
 * What can be said about a failure beyond its code: the HTTP status, and one
 * short line of explanation.
 *
 * This is the ONLY place provider text is allowed onto the Direct Assist
 * contract, and only as `detail`: one line of FAILURE_DETAIL_MAX characters,
 * keys removed, sent to the window that asked and nowhere else, never copied
 * into `message`. Pass the prompt as `echoOf` and anything the provider quoted
 * from it is cut out as well — the request must not come back on the event.
 */
export function describeDirectAssistFailure(
  error: unknown,
  options: { readonly echoOf?: readonly string[] } = {},
): DirectAssistFailureInfo {
  // Same single hop as normalizeDirectAssistError, for the same reason: the
  // first rung is the provider the user selected.
  const wrapped = (error as any)?.firstProviderError;
  if (wrapped && wrapped !== error) return describeDirectAssistFailure(wrapped, options);

  const candidate = error as any;
  if (candidate == null) return NOTHING_TO_ADD;
  if (candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR') return NOTHING_TO_ADD;

  // A sentence we wrote ourselves is already safe to show; it is worth showing
  // only when it explains something ("Cloud providers are disabled in
  // local-only mode."). Matched by name: the build inlines this module into
  // more than one bundle, so `instanceof` can miss an error thrown from another.
  const ownSentence: string | undefined = candidate.name === 'DirectAssistError'
    ? String(candidate.message ?? '')
    : candidate.name === 'AntigravityError'
      ? normalizeDirectAssistError(error).message
      : undefined;
  if (ownSentence !== undefined && !isCannedSentence(ownSentence)) {
    return Object.freeze({ detail: ownSentence });
  }
  if (candidate.name === 'DirectAssistError') return NOTHING_TO_ADD;

  let raw = typeof error === 'string'
    ? error
    : typeof candidate.message === 'string' ? candidate.message : '';
  // undici reports every network failure as "fetch failed" and hangs the
  // actual reason (ENOTFOUND, ECONNREFUSED) one level down.
  if (/^fetch failed$/i.test(raw.trim()) && typeof candidate.cause?.message === 'string') {
    raw = candidate.cause.message;
  }

  const status = validStatus(statusFrom(error)) ?? statusFromText(raw.replace(/\s+/g, ' ').trim());
  // Never reached: no status came back, and the failure is a socket-level one
  // (offline, a local server that is not running). The overlay says so rather
  // than a bare "failed".
  if (status === undefined && UNREACHABLE_RE.test(raw)) {
    // The socket message ("connect ECONNREFUSED 127.0.0.1:11434") is a raw
    // error code, and the overlay already says the provider couldn't be
    // reached. The ADDRESS is the one part worth showing: it tells someone
    // running Ollama or a custom endpoint which one was not there.
    const address = addressFrom(raw);
    return Object.freeze({ ...(address ? { detail: address } : {}), unreachable: true as const });
  }
  const detail = humanLine(raw, status, options.echoOf ?? []);
  return Object.freeze({
    ...(status !== undefined ? { status } : {}),
    ...(detail ? { detail } : {}),
  });
}

/** "connect ECONNREFUSED 127.0.0.1:11434" → "127.0.0.1:11434". */
function addressFrom(raw: string): string {
  const candidate = /\bE[A-Z_]{3,}\s+(\S+)/.exec(raw)?.[1] ?? '';
  return /^(?:[\w.-]+|\[[0-9a-f:]+\]|[0-9a-f:]*::[0-9a-f:]*)(?::\d{1,5})?$/i.test(candidate) ? candidate : '';
}
