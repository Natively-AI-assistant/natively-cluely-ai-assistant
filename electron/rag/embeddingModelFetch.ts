// electron/rag/embeddingModelFetch.ts
//
// Live discovery of a cloud provider's EMBEDDING models — the same endpoints the
// AI Providers card already uses for chat models (electron/utils/modelFetcher.ts),
// with the filters inverted.
//
//   OpenAI  GET {base}/v1/models          -> { data: [{ id }] }
//           No capability field, so embedders are identified by id prefix.
//   Gemini  GET {base}/v1beta/models?key= -> { models: [{ name, displayName,
//                                             supportedGenerationMethods }] }
//           The chat fetch already reads supportedGenerationMethods for
//           'generateContent'; an embedder is one offering 'embedContent'.

import { STATIC_EMBEDDING_MODELS, RETIRED_EMBEDDING_MODELS, type EmbeddingCatalogModel } from './embeddingCatalog';

const TIMEOUT_MS = 15_000;

export interface FetchOptions {
  /** Origin override for tests. */
  baseUrl?: string;
  /** Test-only: extra rows spliced into the provider response. */
  _testExtra?: Array<{ id: string }>;
}

/** Documented facts for models we know; anything else is listed with no invented width. */
function decorate(providerId: 'openai' | 'gemini', id: string): EmbeddingCatalogModel {
  const known = (STATIC_EMBEDDING_MODELS as any)[providerId]?.find((m: any) => m.id === id);
  if (known) return { ...known };
  // A newly released embedder the app has never heard of must still be
  // selectable — hiding it would make discovery pointless. Its width is simply
  // unknown until it is measured.
  return { id, label: id, dimensions: 0, dimensionsVerified: false };
}

async function getJson(url: string, headers: Record<string, string>): Promise<any | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * Embedding models this key can actually use.
 *
 * Never throws: an unreachable provider or a rejected key is "no models", which
 * the panel already renders, rather than an error every call site must handle.
 * Returns [] without calling anything when there is no key — an unauthenticated
 * probe would just burn a round trip to get a 401.
 */
export async function fetchEmbeddingModels(
  providerId: string,
  apiKey: string,
  opts: FetchOptions = {},
): Promise<EmbeddingCatalogModel[]> {
  const key = (apiKey || '').trim();
  if (!key) return [];

  if (providerId === 'openai') {
    const base = opts.baseUrl || 'https://api.openai.com';
    const data = await getJson(`${base}/v1/models`, { Authorization: `Bearer ${key}` });
    if (!data) return [];
    const rows: Array<{ id?: string }> = [...(data.data || []), ...(opts._testExtra || [])];
    return rows
      .map(m => m?.id)
      .filter((id): id is string => typeof id === 'string' && id.startsWith('text-embedding-'))
      .filter(id => !RETIRED_EMBEDDING_MODELS.has(id))
      .map(id => decorate('openai', id))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  if (providerId === 'gemini') {
    const base = opts.baseUrl || 'https://generativelanguage.googleapis.com';
    // This API takes the key in the query string, not a header.
    const data = await getJson(`${base}/v1beta/models?key=${encodeURIComponent(key)}`, {});
    if (!data) return [];
    const rows: any[] = [...(data.models || []), ...(opts._testExtra || [])];
    return rows
      .filter(m => {
        const methods = m?.supportedGenerationMethods;
        // Capability data when the API gives it; otherwise fall back to the id,
        // so a response shape change degrades to something usable rather than
        // an empty list.
        if (Array.isArray(methods)) return methods.includes('embedContent');
        return typeof m?.name === 'string' && m.name.includes('embedding');
      })
      .map(m => String(m.name || m.id || '').replace(/^models\//, ''))
      .filter(Boolean)
      // ListModels still advertises embedContent for models past their shutdown
      // date; offering one fails only at index time.
      .filter(id => !RETIRED_EMBEDDING_MODELS.has(id))
      .map(id => decorate('gemini', id))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  // Natively pins its model server-side; Ollama and the custom endpoint have
  // their own discovery paths (ollamaEmbeddingModels / customEmbeddingModels).
  return [];
}
