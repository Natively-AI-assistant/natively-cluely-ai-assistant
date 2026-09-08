import type { DirectAssistErrorCode, DirectAssistErrorPayload } from './types';

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

/** Convert provider failures to a stable, content-free IPC error contract. */
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

  // Do not forward SDK response bodies: they can echo user prompts or URLs.
  return new DirectAssistError(
    'PROVIDER_ERROR',
    status ? `The selected provider failed (HTTP ${status}).` : 'The selected provider could not complete the request.',
    status === undefined || status >= 500,
  );
}
