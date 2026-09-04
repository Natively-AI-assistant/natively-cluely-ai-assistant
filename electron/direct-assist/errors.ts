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

  const candidate = error as any;
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
