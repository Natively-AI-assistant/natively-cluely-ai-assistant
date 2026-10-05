// electron/rag/customRerankModels.ts
//
// Model discovery for a user-hosted OpenAI/Cohere-compatible reranking endpoint
// (LM Studio, llama.cpp llama-server, vLLM, text-embeddings-inference,
// Infinity, LiteLLM).

import { normalizeCustomBaseUrl } from './providers/CustomEmbeddingProvider';

const LIST_TIMEOUT_MS = 5_000;

export interface CustomRerankModel {
  id: string;
  label: string;
  note?: string;
}

const auth = (apiKey?: string): Record<string, string> =>
  apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

/**
 * List models served by a custom reranking endpoint.
 *
 * Never throws — returns [] on network error or unreachable server so callers
 * don't need boilerplate try/catch.
 */
export async function listCustomRerankModels(baseUrl: string, apiKey?: string): Promise<CustomRerankModel[]> {
  const base = normalizeCustomBaseUrl(baseUrl);
  if (!base) return [];

  // 1. LM Studio's native catalogue: /api/v1/models
  const nativeUrl = base.replace(/\/v1$/, '/api/v1/models');
  if (nativeUrl !== base) {
    try {
      const res = await fetch(nativeUrl, { headers: auth(apiKey), signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      if (res.ok) {
        const data: any = await res.json();
        const rows = Array.isArray(data?.models) ? data.models : null;
        if (rows && rows.length > 0) {
          return rows
            .filter((m: any) => typeof m?.id === 'string' && m.id.trim())
            .map((m: any) => ({
              id: m.id.trim(),
              label: m.name || m.id.trim(),
              note: m.type ? `Type: ${m.type}` : undefined,
            }));
        }
      }
    } catch { /* fall through */ }
  }

  // 2. Standard OpenAI-compatible /models endpoint: ${base}/models
  try {
    const res = await fetch(`${base}/models`, { headers: auth(apiKey), signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    if (res.ok) {
      const data: any = await res.json();
      const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      if (rows.length > 0) {
        return rows
          .filter((m: any) => typeof m?.id === 'string' && m.id.trim())
          .map((m: any) => ({
            id: m.id.trim(),
            label: m.name || m.id.trim(),
          }));
      }
    }
  } catch { /* fall through */ }

  // 3. Fallback: Check root /models if base has a trailing path segment like /v1
  const rootBase = base.replace(/\/v1\/?$/, '');
  if (rootBase !== base) {
    try {
      const res = await fetch(`${rootBase}/models`, { headers: auth(apiKey), signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      if (res.ok) {
        const data: any = await res.json();
        const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
        if (rows.length > 0) {
          return rows
            .filter((m: any) => typeof m?.id === 'string' && m.id.trim())
            .map((m: any) => ({
              id: m.id.trim(),
              label: m.name || m.id.trim(),
            }));
        }
      }
    } catch { /* fall through */ }
  }

  return [];
}
