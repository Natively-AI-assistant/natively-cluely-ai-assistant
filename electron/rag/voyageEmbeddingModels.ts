// electron/rag/voyageEmbeddingModels.ts
//
// Width measurement for Voyage models.
//
// Voyage publishes no models-list endpoint, so the catalogue is curated in
// embeddingCatalog.ts. What CANNOT be curated is the real output width, so it is
// measured here — through a RAW fetch rather than VoyageEmbeddingProvider.
//
// That distinction is the whole point: the provider's embed() runs validate(),
// which throws on any length != its declared `dimensions`. Probing through it
// could therefore only ever confirm the width it was constructed with, and any
// other value surfaced as "could not get an embedding" — a key/availability
// error for what is actually a width mismatch.

const PROBE_TIMEOUT_MS = 20_000;
const DEFAULT_BASE_URL = 'https://api.voyageai.com/v1';
const DIMENSION_PROBE_TEXT = 'natively embedding dimension probe';

async function embedOnce(
  base: string, apiKey: string, model: string, outputDimension?: number,
): Promise<{ ok: boolean; length: number | null; status: number }> {
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: DIMENSION_PROBE_TEXT,
      input_type: 'document',
      output_dtype: 'float',
      ...(outputDimension ? { output_dimension: outputDimension } : {}),
    }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, length: null, status: res.status };
  const data: any = await res.json();
  const values = data?.data?.[0]?.embedding;
  return {
    ok: true,
    length: Array.isArray(values) && values.length > 0 ? values.length : null,
    status: res.status,
  };
}

/**
 * Measure a Voyage model's real output width.
 *
 * When `requestedDimensions` is given it is sent as `output_dimension` — but the
 * RETURNED length is the answer, never the request. Voyage's domain models
 * (voyage-code-4, voyage-finance-2, voyage-law-2) are fixed at 1024 and may
 * reject the parameter outright, so a rejected request is retried WITHOUT it and
 * the model's natural width is reported. The caller compares the two and decides.
 *
 * Returns null when the model cannot embed, the key is missing, or Voyage is
 * unreachable — the caller must then NOT configure it rather than assume.
 */
export async function probeVoyageEmbeddingDimensions(
  model: string,
  apiKey: string,
  baseUrl?: string,
  requestedDimensions?: number,
): Promise<number | null> {
  const key = (apiKey || '').trim();
  if (!key || !model) return null;
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  try {
    if (requestedDimensions) {
      const withWidth = await embedOnce(base, key, model, requestedDimensions);
      if (withWidth.ok) return withWidth.length;
      // A 4xx here usually means "this model takes no output_dimension", which is
      // a real answer about the model, not a failure. Ask for its natural width.
      if (withWidth.status >= 400 && withWidth.status < 500) {
        const natural = await embedOnce(base, key, model);
        return natural.ok ? natural.length : null;
      }
      return null;
    }
    const natural = await embedOnce(base, key, model);
    return natural.ok ? natural.length : null;
  } catch { return null; }
}
