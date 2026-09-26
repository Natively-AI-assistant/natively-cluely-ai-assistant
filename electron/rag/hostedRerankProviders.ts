/**
 * Hosted reranking providers.
 *
 * All but one speak the request/response shape Cohere introduced and everyone
 * copied:
 *
 *   POST {base}/rerank   { model, query, documents, top_n }
 *   -> { results: [{ index, relevance_score, document? }], usage: {...} }
 *
 * Voyage differs in exactly two field names — `top_k` in, `data` out — which
 * its descriptor carries as `wire`. So the client stays shared; only the
 * endpoint, the credential, the model list and those two names differ. That is
 * why adding Jina (and Voyage) needed a table entry rather than a second
 * implementation.
 *
 * Jina's entry exists for one reason: jina-reranker-v3.5 CANNOT run locally.
 * Its GGUF needs per-layer sliding-window attention that the bundled llama.cpp
 * reads and then discards (it reports n_swa = 0), and no ONNX or OpenVINO build
 * of v3.5 exists anywhere — verified against the Hub's base_model index, which
 * lists exactly one derivative of jinaai/jina-reranker-v3.5: the official GGUF.
 * Jina's own API is the only way to actually use it.
 */

export type HostedRerankProviderId = 'natively' | 'openrouter' | 'jina' | 'voyage';

/** The two field names that vary between rerank APIs. Absent = Cohere's. */
export interface RerankWire {
  /** Request field that caps how many results come back. */
  topField: 'top_n' | 'top_k';
  /** Response field holding the ranked `{ index, relevance_score }` rows. */
  resultsField: 'results' | 'data';
}

export const COHERE_RERANK_WIRE: RerankWire = { topField: 'top_n', resultsField: 'results' };

export interface HostedRerankModel {
  id: string;
  label: string;
  note?: string;
  /** Ranked first in the picker. One per provider at most. */
  recommended?: boolean;
}

export interface HostedRerankProvider {
  id: HostedRerankProviderId;
  name: string;
  baseUrl: string;
  /** Where a user gets a key, shown beside the empty field. */
  keyUrl: string;
  /** How the provider names its key, for the placeholder. */
  keyPlaceholder: string;
  /**
   * Models known to work. OpenRouter's are discovered live from
   * `?output_modalities=rerank`; Jina publishes a fixed enum in its OpenAPI
   * spec, so those are listed here rather than guessed.
   */
  models: HostedRerankModel[];
  /** True when the catalogue above is a static list rather than live discovery. */
  staticCatalogue: boolean;
  /** Field names, when they are not Cohere's. */
  wire?: RerankWire;
}

/**
 * Where the managed reranker lives. Same resolution NativelyEmbeddingProvider
 * uses, so pointing the app at a local server moves BOTH managed routes together
 * — a split base is how you end up testing embeddings locally while reranking
 * silently bills production.
 */
const NATIVELY_RERANK_BASE_URL =
  `${(process.env.NATIVELY_API_URL || 'https://api.natively.software').replace(/\/+$/, '')}/v1`;

export const HOSTED_RERANK_PROVIDERS: Record<HostedRerankProviderId, HostedRerankProvider> = {
  /**
   * The one entry here that is NOT bring-your-own-key: it runs on the Natively
   * API key the user already has, is billed against their plan's Knowledge
   * allowance, and needs no second signup. That is the whole reason it exists —
   * before it, a Natively customer who wanted hosted reranking had to go get an
   * OpenRouter account.
   *
   * `POST /v1/rerank` on natively-api speaks the same Cohere-shaped contract as
   * the other two, which is why this is a table entry rather than a second
   * client.
   */
  natively: {
    id: 'natively',
    name: 'Natively',
    baseUrl: NATIVELY_RERANK_BASE_URL,
    keyUrl: 'https://natively.software',
    keyPlaceholder: 'natively_sk_…',
    // One managed model, chosen and served by the API. Nothing to discover and
    // nothing to pick, so the card shows no model list.
    models: [
      { id: 'rerank-2.5-lite', label: 'Voyage Rerank 2.5 Lite', recommended: true },
    ],
    staticCatalogue: true,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-v1-…',
    models: [],            // discovered live; see openrouterRerankModels.ts
    staticCatalogue: false,
  },
  jina: {
    id: 'jina',
    name: 'Jina AI',
    baseUrl: 'https://api.jina.ai/v1',
    keyUrl: 'https://jina.ai/api-dashboard/',
    keyPlaceholder: 'jina_…',
    // From Jina's published OpenAPI spec: RerankerV3Request accepts v3 and
    // v3.5; TextRerankerRequest covers v2 and the v1 family; m0 is multimodal.
    // A fixed enum, so there is nothing to discover.
    // No per-model notes: the card lists the models and nothing else. The
    // descriptions were removed deliberately — RerankerSettings only renders
    // this block when a model carries a note, so with none the Jina card shows
    // just the picker.
    models: [
      { id: 'jina-reranker-v3.5', label: 'Jina Reranker v3.5', recommended: true },
      { id: 'jina-reranker-v3', label: 'Jina Reranker v3' },
      { id: 'jina-reranker-m0', label: 'Jina Reranker m0' },
      { id: 'jina-reranker-v2-base-multilingual', label: 'Jina Reranker v2 Multilingual' },
    ],
    staticCatalogue: true,
  },
  /**
   * Voyage AI, on the SAME key as the Voyage embedding provider — one vendor,
   * one credential, like OpenRouter. Models and wire format from Voyage's API
   * reference (docs.voyageai.com/reference/reranker-api, checked 2026-09-22):
   * `rerank-2.5` and `rerank-2.5-lite` are the recommended models, the cap is
   * `top_k`, and results arrive in `data`, sorted by relevance.
   */
  voyage: {
    id: 'voyage',
    name: 'Voyage AI',
    baseUrl: 'https://api.voyageai.com/v1',
    keyUrl: 'https://dashboard.voyageai.com/',
    keyPlaceholder: 'pa-…',
    models: [
      { id: 'rerank-2.5', label: 'Voyage Rerank 2.5', recommended: true },
      { id: 'rerank-2.5-lite', label: 'Voyage Rerank 2.5 Lite' },
    ],
    staticCatalogue: true,
    wire: { topField: 'top_k', resultsField: 'data' },
  },
};

export function hostedRerankProvider(id: string | undefined): HostedRerankProvider | null {
  if (id !== 'natively' && id !== 'openrouter' && id !== 'jina' && id !== 'voyage') return null;
  return HOSTED_RERANK_PROVIDERS[id];
}

/** Default model for a provider whose catalogue is fixed. Null when discovered live. */
export function defaultHostedModel(id: HostedRerankProviderId): string | null {
  const provider = HOSTED_RERANK_PROVIDERS[id];
  if (!provider.staticCatalogue) return null;
  return (provider.models.find((m) => m.recommended) ?? provider.models[0])?.id ?? null;
}
