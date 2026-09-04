/**
 * Hosted reranking providers.
 *
 * Every one of these speaks the same request/response shape — the one Cohere
 * introduced and everyone copied:
 *
 *   POST {base}/rerank   { model, query, documents, top_n }
 *   -> { results: [{ index, relevance_score, document? }], usage: {...} }
 *
 * So the client is shared; only the endpoint, the credential and the model list
 * differ. That is why adding Jina needed a table entry rather than a second
 * implementation.
 *
 * Jina's entry exists for one reason: jina-reranker-v3.5 CANNOT run locally.
 * Its GGUF needs per-layer sliding-window attention that the bundled llama.cpp
 * reads and then discards (it reports n_swa = 0), and no ONNX or OpenVINO build
 * of v3.5 exists anywhere — verified against the Hub's base_model index, which
 * lists exactly one derivative of jinaai/jina-reranker-v3.5: the official GGUF.
 * Jina's own API is the only way to actually use it.
 */

export type HostedRerankProviderId = 'openrouter' | 'jina';

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
}

export const HOSTED_RERANK_PROVIDERS: Record<HostedRerankProviderId, HostedRerankProvider> = {
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
    models: [
      // The notes were removed once because v3.5's had gone stale — it said
      // "cannot run locally", which stopped being true when Core learned the
      // listwise protocol. Deleting all four took the card's only explanatory
      // text with it: RerankerSettings renders these under a static catalogue
      // and shows nothing when they are absent. Corrected rather than dropped.
      { id: 'jina-reranker-v3.5', label: 'Jina Reranker v3.5', recommended: true, note: 'Listwise, multilingual, 131K context. Also downloadable to run on this device (410MB); hosted needs no download and no warm-up.' },
      { id: 'jina-reranker-v3', label: 'Jina Reranker v3', note: 'The previous listwise model. Hosted only.' },
      { id: 'jina-reranker-m0', label: 'Jina Reranker m0', note: 'Multimodal. Natively sends text only, so its image capability goes unused here.' },
      { id: 'jina-reranker-v2-base-multilingual', label: 'Jina Reranker v2 Multilingual', note: 'A plain cross-encoder. Also downloadable to run on this device (297MB).' },
    ],
    staticCatalogue: true,
  },
};

export function hostedRerankProvider(id: string | undefined): HostedRerankProvider | null {
  if (id !== 'openrouter' && id !== 'jina') return null;
  return HOSTED_RERANK_PROVIDERS[id];
}

/** Default model for a provider whose catalogue is fixed. Null when discovered live. */
export function defaultHostedModel(id: HostedRerankProviderId): string | null {
  const provider = HOSTED_RERANK_PROVIDERS[id];
  if (!provider.staticCatalogue) return null;
  return (provider.models.find((m) => m.recommended) ?? provider.models[0])?.id ?? null;
}
