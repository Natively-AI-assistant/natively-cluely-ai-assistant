// electron/rag/embeddingCatalog.ts
//
// The per-provider embedding model catalogue the Settings panel renders.
//
// Ids and default widths come from each provider's CURRENT official docs
// (checked 2026-08-29), not from memory. Google publishes shutdown dates for its
// embedding models and several are already past them — offering a retired model
// is worse than offering none, because the failure only shows up at index time,
// after the user has committed to a re-index.

export interface EmbeddingCatalogModel {
  id: string;
  /** Short display name. The id is shown separately where it differs. */
  label: string;
  /** Default output width. */
  dimensions: number;
  /** False when the width is declared by the provider rather than measured here. */
  dimensionsVerified: boolean;
  /** Widths the provider documents as selectable, when it supports truncation. */
  supportedDimensions?: number[];
  /** Compatibility-tier model — small and fast, weaker retrieval. */
  lightweight?: boolean;
  /** The provider's current pick. At most one per provider. */
  recommended?: boolean;
  /** One short line of provider-documented fact. Never a comparative claim. */
  note?: string;
  /** OpenRouter only: list price in USD per million tokens. 0 means free. */
  pricePerMillion?: number;
}

export interface EmbeddingCatalogProvider {
  id: 'natively' | 'ollama' | 'custom' | 'openrouter' | 'voyage' | 'openai' | 'gemini' | 'local';
  name: string;
  /** Embedding calls leave the machine. */
  cloud: boolean;
  /** Natively picks the model server-side; the user does not choose one. */
  managed?: boolean;
  available: boolean;
  unavailableReason?: 'no_key' | 'not_running' | 'blocked_by_policy' | 'not_configured';
  models: EmbeddingCatalogModel[];
  /** Custom only: the endpoint currently configured, for display. */
  endpoint?: string;
  /**
   * Custom only: the server reported no capability data, so the listed models
   * are everything it serves — not a verified set of embedders.
   */
  capabilityUnknown?: boolean;
}

/**
 * Static, provider-documented models.
 *
 * OpenAI (developers.openai.com/api/docs/guides/embeddings): text-embedding-3-small
 * defaults to 1536, text-embedding-3-large to 3072, and the 3-series accepts a
 * `dimensions` parameter to shorten. text-embedding-ada-002 is 1536.
 *
 * Widths are each model's OWN default (omitting the parameter returns it), not a
 * truncation. Gemini was pinned to 768 only to stay on the already-provisioned
 * vec_chunks_768 table through the 001 -> 2 migration; that is over.
 *
 * Gemini (ai.google.dev/gemini-api/docs/models): gemini-embedding-2 is the
 * designated replacement for every deprecated embedding model and is multimodal;
 * gemini-embedding-001 supports 128-3072 with 768/1536/3072 recommended.
 * DELIBERATELY ABSENT — all past their published shutdown dates:
 *   text-embedding-004        2026-01-14
 *   embedding-2-preview       2026-08-10
 *   embedding-001, embedding-gecko-001   2025-10-30
 */
/**
 * Ids that must NEVER be offered, whatever discovery returns.
 *
 * The curated lists below already omit these, but live discovery REPLACES the
 * seed — and Gemini's ListModels still reports retired models with
 * `embedContent` in supportedGenerationMethods. One click of Refresh would
 * otherwise put every one of them back, selectable, failing only at index time:
 * exactly what the exclusion exists to prevent.
 *
 * Shutdown dates published by Google, all in the past as of 2026-08-31.
 */
export const RETIRED_EMBEDDING_MODELS: ReadonlySet<string> = new Set([
  'text-embedding-004',      // 2026-01-14
  'embedding-2-preview',     // 2026-08-10
  'embedding-001',           // 2025-10-30
  'embedding-gecko-001',     // 2025-10-30
]);

export const STATIC_EMBEDDING_MODELS = Object.freeze({
  openai: Object.freeze([
    Object.freeze({ id: 'text-embedding-3-small', label: 'text-embedding-3-small', dimensions: 1536, dimensionsVerified: true, supportedDimensions: [512, 1536], recommended: true, note: 'Default 1536 dimensions. Supports shortening via the dimensions parameter.' }),
    Object.freeze({ id: 'text-embedding-3-large', label: 'text-embedding-3-large', dimensions: 3072, dimensionsVerified: true, supportedDimensions: [256, 1024, 3072], note: 'Default 3072 dimensions. Supports shortening via the dimensions parameter.' }),
    Object.freeze({ id: 'text-embedding-ada-002', label: 'text-embedding-ada-002', dimensions: 1536, dimensionsVerified: true, note: 'Previous generation. Fixed at 1536 dimensions.' }),
  ]),
  gemini: Object.freeze([
    Object.freeze({ id: 'gemini-embedding-2', label: 'gemini-embedding-2', dimensions: 3072, dimensionsVerified: true, supportedDimensions: [768, 1536, 3072], recommended: true, note: 'Current model, and multimodal — accepts text, images, audio and video.' }),
    Object.freeze({ id: 'gemini-embedding-001', label: 'gemini-embedding-001', dimensions: 3072, dimensionsVerified: true, supportedDimensions: [768, 1536, 3072], note: 'Text only. Supports 128-3072 dimensions; 768, 1536 and 3072 are recommended.' }),
  ]),
  natively: Object.freeze([
    Object.freeze({ id: 'gemini-embedding-2', label: 'gemini-embedding-2', dimensions: 3072, dimensionsVerified: true, recommended: true, note: 'Managed by Natively. Nothing to configure.' }),
  ]),
  /** The model bundled with the app — always present, needs no network. */
  local: Object.freeze([
    Object.freeze({ id: 'Xenova/all-MiniLM-L6-v2', label: 'MiniLM', dimensions: 384, dimensionsVerified: true, lightweight: true, note: 'Bundled with Natively. Small and fast; weaker retrieval on large projects.' }),
  ]),
  /**
   * Voyage AI's embedding suite (docs.voyageai.com, checked 2026-08-31).
   *
   * Voyage has NO models-list endpoint, so this is curated rather than fetched —
   * and every width is still MEASURED on selection, which makes staleness here
   * self-correcting for the number that actually matters.
   *
   * CORRECTED AGAINST THE LIVE API (2026-08-31), which disagreed with the prose
   * docs in three places:
   *   - voyage-code-4 DOES accept output_dimension (512 and 2048 both return);
   *     the docs' support list omits it.
   *   - voyage-finance-2 and voyage-law-2 answer 400 for any output_dimension,
   *     so they are genuinely fixed at 1024.
   *   - voyage-4-nano and voyage-multimodal-3.5 are NOT served by /v1/embeddings
   *     at all. The endpoint's own error enumerates what it accepts; nano is
   *     open-weights only, and multimodal needs the separate multimodal endpoint
   *     with a different input shape. Listing either would offer a model that
   *     cannot be selected.
   * Context is 32,000 tokens except voyage-law-2 at 16,000.
   *
   * Notes are provider-documented facts only — no comparative claims.
   */
  voyage: Object.freeze([
    Object.freeze({ id: 'voyage-4', label: 'voyage-4', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], recommended: true, note: 'General purpose. 32k context.' }),
    Object.freeze({ id: 'voyage-4-large', label: 'voyage-4-large', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], note: 'Voyage suggests it when quality matters most. 32k context.' }),
    Object.freeze({ id: 'voyage-4-lite', label: 'voyage-4-lite', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], note: 'Voyage suggests it for cost and latency. 32k context.' }),
    Object.freeze({ id: 'voyage-code-4', label: 'voyage-code-4', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], note: 'Tuned for code retrieval. 32k context.' }),
    Object.freeze({ id: 'voyage-finance-2', label: 'voyage-finance-2', dimensions: 1024, dimensionsVerified: true, note: 'Tuned for finance. Fixed 1024 dimensions.' }),
    Object.freeze({ id: 'voyage-law-2', label: 'voyage-law-2', dimensions: 1024, dimensionsVerified: true, note: 'Tuned for legal text. 16k context, fixed 1024 dimensions.' }),
    Object.freeze({ id: 'voyage-3.5', label: 'voyage-3.5', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], note: 'Previous generation. 32k context.' }),
    Object.freeze({ id: 'voyage-3.5-lite', label: 'voyage-3.5-lite', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], note: 'Previous generation, cost tier. 32k context.' }),
    Object.freeze({ id: 'voyage-3-large', label: 'voyage-3-large', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], note: 'Previous generation, quality tier. 32k context.' }),
    Object.freeze({ id: 'voyage-code-3', label: 'voyage-code-3', dimensions: 1024, dimensionsVerified: true, supportedDimensions: [256, 512, 1024, 2048], note: 'Previous generation code model. 32k context.' }),
  ]),
  /** Auto-pulled through Ollama, so it arrives without configuration — but only if Ollama is running. */
  localViaOllama: Object.freeze([
    Object.freeze({ id: 'nomic-embed-text', label: 'nomic-embed-text', dimensions: 768, dimensionsVerified: true, note: 'Pulled automatically when Ollama is available.' }),
  ]),
});

export interface CatalogInput {
  ollamaReachable?: boolean;
  ollamaModels?: Array<{ name: string; dimensionsHint?: number | null; dimensionsVerified?: boolean }>;
  hasOpenaiKey?: boolean;
  hasGeminiKey?: boolean;
  hasNativelyKey?: boolean;
  hasOpenrouterKey?: boolean;
  hasVoyageKey?: boolean;
  /**
   * OpenRouter's embedding catalogue. Fetched WITHOUT a key (the listing is
   * public), so it is shown even before one is added — a user can see what is on
   * offer, and what it costs, before signing up.
   */
  openrouterModels?: EmbeddingCatalogModel[];
  /** A user-hosted OpenAI-compatible endpoint, if one is configured. */
  customEndpoint?: string;
  customModels?: Array<{ id: string; capabilityKnown?: boolean }>;
  /**
   * Models discovered live from a provider's list API. When present they REPLACE
   * the static seed — the provider is the authority on what this key can use.
   */
  fetchedModels?: Partial<Record<'openai' | 'gemini' | 'voyage', EmbeddingCatalogModel[]>>;
  /** Privacy policy forbids sending embeddings to a cloud provider. */
  cloudBlocked?: boolean;
}

const clone = <T,>(models: readonly T[]): T[] => models.map(m => ({ ...(m as object) })) as T[];

/**
 * Assemble the catalogue for the current machine.
 *
 * Availability is about CREDENTIALS AND REACHABILITY, not existence: a provider
 * with no key is still listed (so the user can see it exists and why it is off)
 * but is not selectable. Silently omitting it would leave the user wondering
 * whether Natively supports it at all.
 */
export function buildEmbeddingCatalog(input: CatalogInput): EmbeddingCatalogProvider[] {
  const cloudBlocked = !!input.cloudBlocked;
  const cloudReason = (hasKey: boolean): EmbeddingCatalogProvider['unavailableReason'] | undefined => {
    if (cloudBlocked) return 'blocked_by_policy';
    if (!hasKey) return 'no_key';
    return undefined;
  };

  const ollamaModels = (input.ollamaReachable ? (input.ollamaModels || []) : []).map(m => ({
    id: m.name,
    label: m.name,
    dimensions: typeof m.dimensionsHint === 'number' ? m.dimensionsHint : 0,
    // A declared width is the model's hidden size, which is not guaranteed to be
    // the output width — it is measured for real before anything is persisted.
    dimensionsVerified: !!m.dimensionsVerified,
  }));

  const natively: EmbeddingCatalogProvider = {
    id: 'natively',
    name: 'Natively',
    cloud: true,
    managed: true,
    available: !cloudBlocked && !!input.hasNativelyKey,
    unavailableReason: cloudReason(!!input.hasNativelyKey),
    models: (cloudBlocked || !input.hasNativelyKey) ? [] : clone(STATIC_EMBEDDING_MODELS.natively),
  };

  const ollama: EmbeddingCatalogProvider = {
    id: 'ollama',
    name: 'Ollama',
    cloud: false,
    available: !!input.ollamaReachable,
    unavailableReason: input.ollamaReachable ? undefined : 'not_running',
    models: ollamaModels,
  };

  const customEndpoint = (input.customEndpoint || '').trim();
  const customModels = customEndpoint ? (input.customModels || []) : [];
  const custom: EmbeddingCatalogProvider = {
    id: 'custom',
    name: 'Custom endpoint',
    // Runs wherever the user pointed it. Treated as on-device because the whole
    // point is self-hosting (LM Studio, llama.cpp) — a remote proxy is possible
    // but is the user's own deliberate choice, not something Natively routes to.
    cloud: false,
    available: customEndpoint.length > 0 && customModels.length > 0,
    // A saved endpoint whose server is down previously left `available: false`
    // with NO reason, which collapsed the message to "not available right now" —
    // the one state that most needs "the server isn't reachable" was the one
    // state with nothing to act on.
    unavailableReason: !customEndpoint
      ? 'not_configured'
      : customModels.length === 0
        ? 'not_running'
        : undefined,
    endpoint: customEndpoint || undefined,
    // Plain OpenAI-compatible servers report no model type, so the list is
    // everything they serve. Saying so keeps the UI from implying a check
    // nobody performed; the dimension probe is the real gate.
    capabilityUnknown: customModels.length > 0 && customModels.every(m => !m.capabilityKnown),
    models: customModels.map(m => ({
      id: m.id,
      label: m.id,
      dimensions: 0,
      dimensionsVerified: false,
    })),
  };

  /**
   * A cloud provider lists NOTHING until its key is present.
   *
   * Showing a model you cannot select is noise, and worse, it invites a click
   * that silently does nothing. The card still appears — with the reason — so
   * "Natively does not support this" stays distinguishable from "you have not
   * added a key".
   */
  const cloudModels = (
    id: 'openai' | 'gemini' | 'voyage',
    hasKey: boolean,
    seed: readonly EmbeddingCatalogModel[],
  ): EmbeddingCatalogModel[] => {
    if (cloudBlocked || !hasKey) return [];
    // Discovery reflects what THIS key can actually use — but it is NOT
    // authoritative about retirement: Gemini's ListModels still reports models
    // that are past their shutdown date with `embedContent` advertised. Filter
    // them out, or a single Refresh silently undoes the curated exclusion.
    const fetched = (input.fetchedModels?.[id] || []).filter(m => !RETIRED_EMBEDDING_MODELS.has(m.id));
    return fetched.length > 0 ? fetched.map(m => ({ ...m })) : clone(seed);
  };

  const openrouter: EmbeddingCatalogProvider = {
    id: 'openrouter',
    name: 'OpenRouter',
    cloud: true,
    available: !cloudBlocked && !!input.hasOpenrouterKey,
    unavailableReason: cloudReason(!!input.hasOpenrouterKey),
    // Deliberately NOT emptied when there is no key, unlike the other cloud
    // providers: OpenRouter's catalogue is public, and its whole value here is
    // letting someone compare models and prices before committing to an account.
    models: cloudBlocked ? [] : (input.openrouterModels || []).map(m => ({ ...m })),
  };

  const voyage: EmbeddingCatalogProvider = {
    id: 'voyage',
    name: 'Voyage AI',
    cloud: true,
    available: !cloudBlocked && !!input.hasVoyageKey,
    unavailableReason: cloudReason(!!input.hasVoyageKey),
    models: cloudModels('voyage', !!input.hasVoyageKey, STATIC_EMBEDDING_MODELS.voyage),
  };

  const openai: EmbeddingCatalogProvider = {
    id: 'openai',
    name: 'OpenAI',
    cloud: true,
    available: !cloudBlocked && !!input.hasOpenaiKey,
    unavailableReason: cloudReason(!!input.hasOpenaiKey),
    models: cloudModels('openai', !!input.hasOpenaiKey, STATIC_EMBEDDING_MODELS.openai),
  };

  const gemini: EmbeddingCatalogProvider = {
    id: 'gemini',
    name: 'Gemini',
    cloud: true,
    available: !cloudBlocked && !!input.hasGeminiKey,
    unavailableReason: cloudReason(!!input.hasGeminiKey),
    models: cloudModels('gemini', !!input.hasGeminiKey, STATIC_EMBEDDING_MODELS.gemini),
  };

  const local: EmbeddingCatalogProvider = {
    id: 'local',
    name: 'Built-in',
    cloud: false,
    // Always available: the model ships with the app and needs no network or key.
    available: true,
    models: [
      ...clone(STATIC_EMBEDDING_MODELS.local),
      ...(input.ollamaReachable ? clone(STATIC_EMBEDDING_MODELS.localViaOllama) : []),
    ],
  };

  return [natively, ollama, custom, openrouter, voyage, openai, gemini, local];
}
