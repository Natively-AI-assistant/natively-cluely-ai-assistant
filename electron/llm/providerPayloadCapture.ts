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

/**
 * Strip binary payloads from ANYWHERE inside a string, not just from a string
 * that IS one.
 *
 * The previous test was anchored (`/^(data:...|...$)/`), which is correct for a
 * field whose whole value is a data URL — and useless for `serializedPayload`,
 * the JSON.stringify of the entire request body. That string starts with `{`,
 * so it never matched, and every custom-provider and Ollama-vision capture
 * retained the full base64 screenshot: measured at 600 KB per entry, up to 40
 * entries, directly contradicting this file's own "never retains ... raw image
 * bytes" header.
 *
 * The data-URL prefix is deliberately KEPT. `data:image/png;base64,` over JPEG
 * bytes was a real shipped defect; a capture that elides the declared mime type
 * cannot show it.
 */
function scrubBinaryFromString(value: string): string {
  return value
    // Data URLs: keep `data:<mime>;base64,` and drop the payload.
    .replace(/(data:[\w.+-]+\/[\w.+-]+;base64,)[A-Za-z0-9+/]{64,}={0,2}/g, '$1[binary omitted]')
    // Any other long base64 run (a bare `"image": "<b64>"`, an inlineData blob).
    .replace(/[A-Za-z0-9+/]{512,}={0,2}/g, '[binary omitted]');
}

function sanitize(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    return scrubBinaryFromString(value);
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
