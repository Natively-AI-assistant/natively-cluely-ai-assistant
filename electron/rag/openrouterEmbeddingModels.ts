// electron/rag/openrouterEmbeddingModels.ts
//
// Model discovery for OpenRouter embeddings.
//
//   GET {base}/models?output_modalities=embeddings
//
// The capability filter is applied SERVER-SIDE and needs no key (verified live,
// 2026-08-31: 34 models). Two consequences worth keeping:
//   - capability comes from OpenRouter, not from guessing at names;
//   - the catalogue can be shown BEFORE a key exists, so a user can see what is
//     on offer (and what it costs) before deciding to sign up.

import type { EmbeddingCatalogModel } from './embeddingCatalog';

const LIST_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 20_000;
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DIMENSION_PROBE_TEXT = 'natively embedding dimension probe';

export interface OpenRouterListOptions {
  baseUrl?: string;
  /** Optional: browsing works unauthenticated, but a key gives per-account visibility. */
  apiKey?: string;
}

function headers(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = {
    'HTTP-Referer': 'https://natively.software',
    'X-Title': 'Natively',
  };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

/**
 * Widths OpenRouter can forward for a model, derived ONLY from families whose
 * own documentation this repo has already verified:
 *   voyageai/*                    256/512/1024/2048  (docs.voyageai.com)
 *   openai/text-embedding-3-small 512/1536           (developers.openai.com)
 *   openai/text-embedding-3-large 256/1024/3072
 *   google/gemini-embedding-*     768/1536/3072      (ai.google.dev)
 *
 * Everything else gets NO width choice. OpenRouter's listing carries no
 * dimension data, so offering options for an unknown model would be inventing a
 * capability — and the request would simply fail or be ignored upstream. The
 * dimension probe is still the arbiter either way.
 */
function supportedWidthsFor(id: string): number[] | undefined {
  if (id.startsWith('voyageai/')) return [256, 512, 1024, 2048];
  if (id === 'openai/text-embedding-3-small') return [512, 1536];
  if (id === 'openai/text-embedding-3-large') return [256, 1024, 3072];
  if (id.startsWith('google/gemini-embedding-')) return [768, 1536, 3072];
  return undefined;
}

/** `pricing.prompt` is $/token as a string; humans think in $/1M. */
function pricePerMillion(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Number((n * 1_000_000).toFixed(4));
}

/**
 * OpenRouter's embedding models.
 *
 * Never throws — an unreachable OpenRouter is "no models", which the panel
 * already renders, rather than an error every call site must handle.
 */
export async function listOpenRouterEmbeddingModels(
  opts: OpenRouterListOptions = {},
): Promise<EmbeddingCatalogModel[]> {
  const base = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/models?output_modalities=embeddings`, {
      headers: headers(opts.apiKey),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const rows: any[] = Array.isArray(data?.data) ? data.data : [];
    return rows
      // Defence in depth: the query param is the contract, but a filter that is
      // ignored or changed would otherwise drop a CHAT model into an embedding
      // picker, where it fails only at index time.
      .filter(m => typeof m?.id === 'string'
        && (m?.architecture?.output_modalities ?? []).includes('embeddings'))
      .map(m => ({
        id: m.id,
        // Keep OpenRouter's display name; the raw id stays the identity.
        label: m.id,
        // Width is UNKNOWN here: the listing carries no dimension field, and not
        // every upstream model honours `dimensions`. It is measured on selection.
        dimensions: 0,
        dimensionsVerified: false,
        supportedDimensions: supportedWidthsFor(m.id),
        note: [
          typeof m?.name === 'string' ? m.name : undefined,
          m?.context_length ? `${m.context_length} token context` : undefined,
          (() => {
            const p = pricePerMillion(m?.pricing?.prompt);
            return p === undefined ? undefined : p === 0 ? 'free' : `$${p}/1M tokens`;
          })(),
        ].filter(Boolean).join(' · ') || undefined,
        pricePerMillion: pricePerMillion(m?.pricing?.prompt),
      })) as EmbeddingCatalogModel[];
  } catch { return []; }
}

/**
 * Measure a model's real output width, through the SAME endpoint embeddings use —
 * probing anything else could report a width the stored vectors never have.
 *
 * Returns null when the model cannot embed, the key is missing, or OpenRouter is
 * unreachable; the caller must then NOT configure it rather than assume a width.
 */
export async function probeOpenRouterEmbeddingDimensions(
  model: string,
  apiKey: string,
  baseUrl?: string,
  /** Ask for a specific width. The RETURNED length is still the truth. */
  requestedDimensions?: number,
): Promise<number | null> {
  const key = (apiKey || '').trim();
  if (!key || !model) return null;
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers(key) },
      body: JSON.stringify({
        model,
        input: DIMENSION_PROBE_TEXT,
        ...(requestedDimensions ? { dimensions: requestedDimensions } : {}),
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const values = data?.data?.[0]?.embedding;
    if (!Array.isArray(values) || values.length === 0) return null;
    return values.length;
  } catch { return null; }
}
