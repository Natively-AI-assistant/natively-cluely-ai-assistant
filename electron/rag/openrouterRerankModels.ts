// electron/rag/openrouterRerankModels.ts
//
// Model discovery for OpenRouter RERANK models.
//
//   GET {base}/models?output_modalities=rerank
//
// The capability filter is applied SERVER-SIDE and needs no key (verified live,
// 2026-09-01: 7 models). Same contract as openrouterEmbeddingModels.ts, and
// deliberately the same shape, so the two panels behave identically.
//
// Two things this file must NOT pretend to know:
//
//  1. PRICE. Every rerank model comes back with `pricing: {prompt:"0",
//     completion:"0"}` — including the paid VoyageAI ones. OpenRouter does not
//     publish rerank pricing through the models API. Rendering "$0/1M" would be
//     a lie that reads as "free". The real number arrives per call as
//     `usage.cost` on the rerank response, which OpenRouterReranker records; the
//     UI shows that, labelled as a measurement of the last call.
//
//  2. QUALITY. The grouping below is derived from context length, modality and
//     this repo's own benchmark runs (benchmarks/reranker-eval, n=28:
//     2026-08-31, and 2026-10-05 for the Voyage rerank-3 pair) — not from
//     OpenRouter's usage rankings, which measure popularity rather than
//     retrieval quality.

const LIST_TIMEOUT_MS = 10_000;
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/** How long a successful catalogue read stays fresh before a background refresh. */
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

export type RerankModelGroup = 'recommended' | 'quality' | 'fast' | 'multimodal' | 'other';

export interface RerankCatalogModel {
  /** OpenRouter model id — the identity, and what goes in the request body. */
  id: string;
  /** OpenRouter's display name, or the id when it has none. */
  label: string;
  vendor: string;
  contextLength?: number;
  /** True only for ids OpenRouter itself marks `:free`. */
  free: boolean;
  /** Accepts image input as well as text. */
  multimodal: boolean;
  group: RerankModelGroup;
  /** One line of human-readable metadata for the picker row. */
  note?: string;
  /** OpenRouter's own description, for the expandable details. */
  description?: string;
}

export interface OpenRouterRerankListOptions {
  baseUrl?: string;
  /** Optional: browsing works unauthenticated. A key only adds per-account visibility. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function headers(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = {
    'HTTP-Referer': 'https://natively.software',
    'X-Title': 'Natively',
  };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

const RECOMMENDED_RERANK_MODEL = 'voyageai/rerank-3-lite';
const PREVIOUS_RECOMMENDED_RERANK_MODEL = 'voyageai/rerank-2.5-lite';

/**
 * Which shelf a model sits on.
 *
 * `recommended` is reserved for the model this repo has actually MEASURED as a
 * good latency/quality trade at the live-path budget.
 *
 * Since 2026-10-05 that is voyageai/rerank-3-lite, Voyage's successor to
 * rerank-2.5-lite (released 2026-09-30, same price). Same benchmark, same 28
 * queries, all four Voyage models run back to back, twice:
 *
 *   rerank-3-lite     0.917 MRR   recall@1 0.857   p95 703 / 882 ms
 *   rerank-3          0.905 MRR   recall@1 0.821   p95 512 / 523 ms
 *   rerank-2.5        0.905 MRR   recall@1 0.821   p95 640 / 496 ms
 *   rerank-2.5-lite   0.864 MRR   recall@1 0.786   p95 1044 / 612 ms
 *
 * The rankings were identical across the two passes; the latency was not, so
 * read p95 as "inside RERANK_BUDGET_MS (1200ms)", which all four are, and not
 * as an ordering. rerank-2.5-lite reproduced its 2026-08-31 score (0.864)
 * exactly, which is what makes the comparison a like-for-like one.
 *
 * Lite is the recommendation because it is the cheaper of the pair and, on
 * this set, not the weaker one. The 0.012 MRR it has over rerank-3 is one query
 * in 28: it shows the two are level here, not that lite is better.
 *
 * Anything not measured here lands in `other`. A model does not get promoted for
 * being popular, or for being new.
 */
function groupFor(id: string, multimodal: boolean): RerankModelGroup {
  if (multimodal) return 'multimodal';
  if (id === RECOMMENDED_RERANK_MODEL) return 'recommended';
  if (id === 'voyageai/rerank-3' || id === 'cohere/rerank-4-pro' || id === 'qwen/qwen3-reranker-8b') return 'quality';
  // The previous generation: measured, still served, no longer the pick.
  if (id === 'voyageai/rerank-2.5' || id === PREVIOUS_RECOMMENDED_RERANK_MODEL) return 'quality';
  if (id === 'cohere/rerank-4-fast' || id === 'cohere/rerank-v3.5') return 'fast';
  return 'other';
}

function vendorOf(id: string): string {
  const slash = id.indexOf('/');
  return slash > 0 ? id.slice(0, slash) : id;
}

/**
 * OpenRouter's rerank-capable models.
 *
 * Never throws. An unreachable OpenRouter is "no models", which the caller
 * renders as "using the last known catalogue" — not an error every call site
 * has to handle.
 */
export async function listOpenRouterRerankModels(
  opts: OpenRouterRerankListOptions = {},
): Promise<RerankCatalogModel[]> {
  const base = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${base}/models?output_modalities=rerank`, {
      headers: headers(opts.apiKey),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const rows: any[] = Array.isArray(data?.data) ? data.data : [];
    return rows
      // Defence in depth: the query param is the contract, but a filter that is
      // ignored or silently changed would otherwise drop a CHAT model into a
      // rerank picker, where it fails only at answer time.
      .filter((m) => typeof m?.id === 'string'
        && (m?.architecture?.output_modalities ?? []).includes('rerank'))
      .map((m) => {
        const id: string = m.id;
        const inputs: string[] = m?.architecture?.input_modalities ?? [];
        const multimodal = inputs.includes('image');
        const contextLength = typeof m?.context_length === 'number' ? m.context_length : undefined;
        const free = id.endsWith(':free');
        return {
          id,
          label: typeof m?.name === 'string' && m.name ? m.name : id,
          vendor: vendorOf(id),
          contextLength,
          free,
          multimodal,
          group: groupFor(id, multimodal),
          note: [
            contextLength ? `${Math.round(contextLength / 1000)}K context` : undefined,
            multimodal ? 'multimodal' : undefined,
            free ? 'free tier' : undefined,
          ].filter(Boolean).join(' · ') || undefined,
          description: typeof m?.description === 'string' ? m.description : undefined,
        } as RerankCatalogModel;
      });
  } catch {
    return [];
  }
}

/**
 * The default model, chosen from a live catalogue rather than hard-coded.
 *
 * Returns null when the catalogue is empty — the caller must then leave the
 * setting unset rather than guessing an id that may not exist. Every id in the
 * original brief's example list was checked against the live API on 2026-09-01;
 * `qwen/qwen3-reranker-0.6b` and `qwen/qwen3-reranker-4b` do NOT exist there,
 * which is exactly the failure a hard-coded default would ship.
 */
export function defaultRerankModel(catalog: RerankCatalogModel[]): string | null {
  if (catalog.length === 0) return null;
  const recommended = catalog.find((m) => m.group === 'recommended');
  if (recommended) return recommended.id;
  // A catalogue that does not carry the current recommendation (an account or
  // region OpenRouter does not serve it to, or a delisting) still gets a
  // MEASURED model before it gets "whichever paid one sorts first".
  const previous = catalog.find((m) => m.id === PREVIOUS_RECOMMENDED_RERANK_MODEL);
  if (previous) return previous.id;
  const paidText = catalog.find((m) => !m.free && !m.multimodal);
  return (paidText ?? catalog[0]).id;
}
