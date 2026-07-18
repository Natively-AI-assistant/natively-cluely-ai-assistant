// E2E-only outbound provider payload observer.
//
// Canonical prompt capture proves prompt assembly. This observer records the
// provider-specific object after each adapter has shaped it and immediately
// before SDK/fetch dispatch. It is intentionally unavailable outside the two
// explicit E2E flags and never retains credentials or raw image bytes.

export type ProviderPayloadClassification =
  | 'sdk_request_object_before_serialization'
  | 'exact_serialized_provider_payload'
  | 'custom_template_expanded_payload';

export interface ProviderPayloadCapture {
  provider: string;
  classification: ProviderPayloadClassification;
  payload: unknown;
  serializedPayload?: string;
  markerIntegrity?: boolean;
}

function enabled(): boolean {
  return process.env.NATIVELY_E2E === '1'
    && process.env.NATIVELY_CONTEXT_OS_PROVIDER_CAPTURE === '1';
}

function sanitize(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (/^(data:.*;base64,|[A-Za-z0-9+/]{512,}={0,2}$)/.test(value)) return '[binary omitted]';
    return value;
  }
  if (Array.isArray(value)) {
    if (/images?|inlineData|data/i.test(key)) return value.map(() => '[binary omitted]');
    return value.map((item) => sanitize(item));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
    childKey,
    /^(authorization|x-natively-key|x-trial-token|api[_-]?key)$/i.test(childKey)
      ? '[credential omitted]'
      : /^(data|images?)$/i.test(childKey) && typeof child === 'string'
        ? '[binary omitted]'
        : sanitize(child, childKey),
  ]));
}

/** Record a bounded payload only in explicit E2E capture mode. */
export function captureProviderPayload(input: ProviderPayloadCapture): void {
  if (!enabled()) return;
  const global = globalThis as any;
  const entry = {
    provider: input.provider,
    classification: input.classification,
    payload: sanitize(input.payload),
    serializedPayload: input.serializedPayload ? sanitize(input.serializedPayload) : undefined,
    markerIntegrity: input.markerIntegrity,
  };
  (global.__contextOsProviderPayloadCapture ||= []).push(entry);
  if (global.__contextOsProviderPayloadCapture.length > 40) global.__contextOsProviderPayloadCapture.shift();
}

export function getProviderPayloadCapture(): unknown[] {
  const global = globalThis as any;
  return Array.isArray(global.__contextOsProviderPayloadCapture)
    ? global.__contextOsProviderPayloadCapture.slice()
    : [];
}

export function clearProviderPayloadCapture(): void {
  (globalThis as any).__contextOsProviderPayloadCapture = [];
}
