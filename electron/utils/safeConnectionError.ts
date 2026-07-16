export interface SafeConnectionErrorInfo {
  provider: string;
  status?: number | string;
  statusText?: string;
  code?: string;
  message?: string;
  responseError?: string;
}

const MAX_ERROR_TEXT_LENGTH = 1000;

/**
 * Remove credentials from provider error text before it reaches logs or UI.
 * Explicit secrets are replaced first, then common API-key/header patterns.
 */
export function redactSensitiveText(
  value: unknown,
  secrets: Array<string | null | undefined> = [],
): string {
  let text = typeof value === 'string' ? value : String(value ?? '');

  for (const secret of secrets) {
    const normalized = secret?.trim();
    if (normalized && normalized.length >= 4) {
      text = text.split(normalized).join('[REDACTED]');
    }
  }

  return text
    .replace(/\b(Bearer|Token)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|gsk|xai)[-_][a-z0-9._-]{8,}\b/gi, '[REDACTED]')
    .replace(/\bAIza[a-z0-9_-]{20,}\b/gi, '[REDACTED]')
    .replace(/((?:api[-_ ]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, MAX_ERROR_TEXT_LENGTH)
    .trim();
}

/**
 * Axios errors contain the full request config, including Authorization
 * headers. Return a deliberately small, credential-safe diagnostic shape.
 */
export function buildSafeConnectionErrorInfo(
  provider: string,
  error: any,
  secrets: Array<string | null | undefined> = [],
): SafeConnectionErrorInfo {
  const safeText = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    const redacted = redactSensitiveText(value, secrets);
    return redacted || undefined;
  };

  const statusValue = error?.response?.status;
  const status =
    typeof statusValue === 'number'
      ? statusValue
      : safeText(statusValue);
  const responseError =
    error?.response?.data?.error?.message ??
    error?.response?.data?.message;

  return {
    provider,
    status,
    statusText: safeText(error?.response?.statusText),
    code: safeText(error?.code),
    message: safeText(error?.message),
    responseError: safeText(responseError),
  };
}
