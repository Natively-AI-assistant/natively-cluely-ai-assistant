// electron/rag/embeddingStatus.ts
//
// Pure logic behind the Embedding settings panel: what to tell the user is
// running, whether to show the lightweight indicator, and what to recommend.
//
// Kept free of Electron and IPC so it is unit-testable, and so the renderer and
// the main process cannot disagree about what "lightweight" means.

import { normalizeModel } from './embeddingSpace';
import type { IEmbeddingProvider } from './providers/IEmbeddingProvider';

/**
 * Models that are lightweight/compatibility-tier rather than a serious choice
 * for code and project retrieval.
 *
 * Matched on the MODEL inside the space key, not on the provider — the same
 * MiniLM is lightweight whether it is the bundled ONNX copy or pulled through
 * Ollama. Kept as a small explicit list because "lightweight" is a judgement
 * about specific known models, not something derivable from dimensions alone.
 */
const LIGHTWEIGHT_MODEL_MARKERS = ['all-minilm', 'minilm'];

/** Providers whose embedding calls leave the machine. */
// Every provider that POSTs text off the machine. Getting this wrong is not a
// mislabel: describeEmbeddingProvider() feeds the Active Model card, which then
// tells a user their documents stay "On-device" while they are being uploaded.
// 'custom' is absent from the SET because it depends on the host: LM Studio on
// localhost is genuinely on-device, a vendor proxy is not. describeEmbeddingProvider
// resolves it per-space below rather than assuming.
/**
 * Where the text actually goes. A wrong answer here is a false privacy claim in
 * the Active Model card, not a cosmetic label.
 *
 * The custom endpoint is decided by HOST: `normalizeCustomBaseUrl` accepts any
 * absolute URL, so the same provider id covers both a loopback LM Studio and a
 * remote proxy. Its space key carries the host for exactly this reason
 * (`custom@<host>:<model>:<dims>`), so it can be read back here.
 */
function resolveLocation(provider: { name: string; space?: string }): 'cloud' | 'on-device' {
  if (CLOUD_PROVIDERS.has(provider.name)) return 'cloud';
  if (provider.name === 'custom') {
    const host = (provider.space || '').split(':')[0].split('@')[1] || '';
    const bare = host.replace(/:\d+$/, '').toLowerCase();
    const loopback = bare === 'localhost' || bare === '127.0.0.1' || bare === '::1' || bare === '0.0.0.0';
    return loopback ? 'on-device' : 'cloud';
  }
  return 'on-device';
}

const CLOUD_PROVIDERS = new Set(['natively', 'openai', 'gemini', 'voyage', 'openrouter']);

/**
 * Whether an embedding space is a lightweight/compatibility-tier model.
 *
 * Takes the SPACE KEY rather than a provider name on purpose. Keying this on the
 * provider would flag an Ollama user running nomic-embed-text — a perfectly good
 * 768-d local embedder — and nag them about a problem they do not have, while
 * missing a MiniLM reached through some other route.
 *
 * Unknown/absent input is NOT lightweight: never invent a warning from missing
 * data.
 */
export function isLightweightSpace(space?: string | null): boolean {
  if (typeof space !== 'string' || space.trim() === '') return false;
  const normalized = normalizeModel(space);
  return LIGHTWEIGHT_MODEL_MARKERS.some(marker => normalized.includes(marker));
}

export interface EmbeddingProviderDescription {
  configured: boolean;
  provider: string | null;
  model: string | null;
  dimensions: number | null;
  space: string | null;
  /** Where embedding actually happens — drives the local-only claim in the UI. */
  location: 'on-device' | 'cloud' | 'unknown';
  lightweight: boolean;
}

/**
 * Describe the RESOLVED provider — what is really running, not what settings
 * asked for. The two differ whenever a provider was unavailable and the chain
 * fell through, which is exactly the case the user most needs to see.
 */
export function describeEmbeddingProvider(
  provider: Pick<IEmbeddingProvider, 'name' | 'model' | 'dimensions' | 'space'> | null | undefined,
): EmbeddingProviderDescription {
  if (!provider) {
    return { configured: false, provider: null, model: null, dimensions: null, space: null, location: 'unknown', lightweight: false };
  }
  return {
    configured: true,
    provider: provider.name,
    model: provider.model,
    dimensions: provider.dimensions,
    space: provider.space,
    // Ollama counts as on-device: "local-only" means no external call, and an
    // Ollama embedder satisfies that.
    location: resolveLocation(provider),
    lightweight: isLightweightSpace(provider.space),
  };
}

/** Generation providers that are the user's own third-party choice. */
const THIRD_PARTY_GENERATION = new Set(['openrouter', 'litellm', 'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'minimax', 'codex']);

/**
 * Whether to surface the "your embeddings are lightweight" warning.
 *
 * The case this exists for (§5): the user configures a strong third-party
 * generation provider and reasonably assumes it handles everything, while
 * retrieval quietly stays on MiniLM — so a great model still gives a poor answer
 * because the wrong context was retrieved.
 *
 * Deliberately does NOT fire for a deliberate all-local setup: someone running
 * Ollama for generation with no cloud key has made a coherent choice, and
 * nagging them is noise. And it never fires once acknowledged — "Continue with
 * MiniLM" has to actually stick, or the warning becomes something to click past.
 */
export function shouldWarnAboutLightweightEmbeddings(input: {
  embeddingSpace?: string | null;
  /** Single provider, when one is known. */
  generationProvider?: string | null;
  /**
   * All configured providers. Natively is key-based rather than having one
   * "current provider" setting, so the real question is whether ANY third-party
   * AI provider is configured while embeddings stayed lightweight.
   */
  generationProviders?: Array<string | null | undefined>;
  acknowledged?: boolean;
}): boolean {
  if (input.acknowledged) return false;
  if (!isLightweightSpace(input.embeddingSpace)) return false;
  const candidates = [input.generationProvider, ...(input.generationProviders || [])];
  return candidates.some(p => THIRD_PARTY_GENERATION.has((p || '').trim().toLowerCase()));
}

export interface EmbeddingRecommendation {
  slot: 'quality' | 'lightweight';
  name: string;
  dimensions: number | null;
  reason: string;
}

/**
 * Rank INSTALLED models into recommendation slots.
 *
 * Derived entirely from what the user actually has, never a hardcoded catalogue
 * — a recommendation for a model they have not pulled is not a recommendation,
 * it is an advert.
 *
 * Carries NO comparative performance claim. Any "N% better than MiniLM" number
 * would be unmeasured until the embedding benchmark runs against Natively's own
 * retrieval workload, and an invented one is worse than silence.
 */
export function recommendEmbeddingModels(
  installed: Array<{ name: string; dimensionsHint?: number | null }>,
): EmbeddingRecommendation[] {
  const withWidth = (installed || []).filter(m => typeof m?.dimensionsHint === 'number' && m.dimensionsHint! > 0);
  if (withWidth.length === 0) return [];

  const sorted = [...withWidth].sort((a, b) => (b.dimensionsHint! - a.dimensionsHint!));
  const widest = sorted[0];
  const narrowest = sorted[sorted.length - 1];

  const recs: EmbeddingRecommendation[] = [];
  // Only offer a "quality" pick when it is not itself a lightweight model.
  if (!LIGHTWEIGHT_MODEL_MARKERS.some(m => widest.name.toLowerCase().includes(m))) {
    recs.push({
      slot: 'quality',
      name: widest.name,
      dimensions: widest.dimensionsHint!,
      reason: 'Highest-dimensional embedding model installed. Larger embeddings can capture more detail for code and project retrieval.',
    });
  }
  if (narrowest.name !== widest.name) {
    recs.push({
      slot: 'lightweight',
      name: narrowest.name,
      dimensions: narrowest.dimensionsHint!,
      reason: 'Smallest installed embedding model. Fastest and lowest memory, suitable for modest hardware.',
    });
  }
  return recs;
}
