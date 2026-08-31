// electron/rag/customEmbeddingModels.ts
//
// Model discovery for a user-hosted OpenAI-compatible embedding endpoint
// (LM Studio, llama.cpp's llama-server, vLLM, text-embeddings-inference,
// LiteLLM). Mirrors ollamaEmbeddingModels.ts: capability data where the server
// offers it, and a MEASURED width always.

import { normalizeCustomBaseUrl } from './providers/CustomEmbeddingProvider';

const LIST_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 20_000;
const DIMENSION_PROBE_TEXT = 'natively embedding dimension probe';

export interface CustomEmbeddingModel {
  id: string;
  /**
   * True when the SERVER told us this is an embedding model (LM Studio's native
   * catalogue). False when the list came from plain /v1/models, which carries no
   * type — then the dimension probe is the only real gate, and the UI must not
   * imply a capability nobody checked.
   */
  capabilityKnown: boolean;
}

const auth = (apiKey?: string): Record<string, string> =>
  apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

/**
 * Models this endpoint can embed with.
 *
 * Prefers LM Studio's native `GET /api/v1/models`, which reports
 * `type: 'llm' | 'embedding'` — actual capability data rather than a name guess
 * (`qwen3-8b` and `text-embedding-nomic-v2` are indistinguishable by name only
 * if you are lucky; plenty of embedders are named neither way).
 *
 * Falls back to the OpenAI-compatible `GET /v1/models`, which has no type at
 * all. There EVERY model is listed: hiding some on a name heuristic would hide
 * working embedders, and the dimension probe already rejects one that cannot
 * embed.
 *
 * Never throws — an unreachable server is "no models", not an error every call
 * site has to handle.
 */
export async function listCustomEmbeddingModels(baseUrl: string, apiKey?: string): Promise<CustomEmbeddingModel[]> {
  const base = normalizeCustomBaseUrl(baseUrl);
  if (!base) return [];

  // LM Studio's native catalogue lives beside /v1, not under it.
  const nativeUrl = base.replace(/\/v1$/, '/api/v1/models');
  if (nativeUrl !== base) {
    try {
      const res = await fetch(nativeUrl, { headers: auth(apiKey), signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      if (res.ok) {
        const data: any = await res.json();
        const rows = Array.isArray(data?.models) ? data.models : null;
        if (rows) {
          return rows
            .filter((m: any) => m?.type === 'embedding' && typeof m?.id === 'string')
            .map((m: any) => ({ id: m.id, capabilityKnown: true }));
        }
      }
    } catch { /* fall through to the OpenAI-compatible list */ }
  }

  try {
    const res = await fetch(`${base}/models`, { headers: auth(apiKey), signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data: any = await res.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    return rows
      .filter((m: any) => typeof m?.id === 'string')
      .map((m: any) => ({ id: m.id, capabilityKnown: false }));
  } catch { return []; }
}

/**
 * Measure a model's real output width.
 *
 * Uses the SAME endpoint and request shape CustomEmbeddingProvider uses for real
 * embeddings — probing a different path could report a width the stored vectors
 * never have.
 *
 * Returns null when the model cannot embed or the server is unreachable; the
 * caller must then NOT configure it rather than assume a width.
 */
export async function probeCustomEmbeddingDimensions(
  baseUrl: string,
  model: string,
  apiKey?: string,
): Promise<number | null> {
  const base = normalizeCustomBaseUrl(baseUrl);
  if (!base || !model) return null;
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(apiKey) },
      body: JSON.stringify({ model, input: DIMENSION_PROBE_TEXT }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const values = data?.data?.[0]?.embedding;
    if (!Array.isArray(values) || values.length === 0) return null;
    return values.length;
  } catch { return null; }
}
