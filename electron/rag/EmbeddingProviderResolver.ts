import { IEmbeddingProvider } from './providers/IEmbeddingProvider';
import { OpenAIEmbeddingProvider } from './providers/OpenAIEmbeddingProvider';
import { GeminiEmbeddingProvider } from './providers/GeminiEmbeddingProvider';
import { OllamaEmbeddingProvider } from './providers/OllamaEmbeddingProvider';
import { LocalEmbeddingProvider } from './providers/LocalEmbeddingProvider';
import { ProviderScopeError, assertProviderDataScopes, type ProviderDataScopePolicy } from '../llm/ProviderRouter';

export interface AppAPIConfig {
  openaiKey?: string;
  geminiKey?: string;
  ollamaUrl?: string; // e.g. 'http://localhost:11434'
  providerDataScopes?: ProviderDataScopePolicy;
  // Optional overrides for the Gemini embedding model/dims (internal escape hatch
  // for a future bump). Default to gemini-embedding-2 @ 768d when omitted.
  geminiEmbeddingModel?: string;
  geminiEmbeddingDims?: number;
}

export class EmbeddingProviderResolver {
  /** Cloud providers get a bounded probe-retry before we demote (hysteresis). */
  private static readonly CLOUD_PROBE_ATTEMPTS = 3;
  private static readonly CLOUD_PROBE_BACKOFF_MS = 400;
  private static readonly CLOUD_PROVIDER_NAMES = new Set(['openai', 'gemini']);

  /**
   * Probe a provider's availability. For CLOUD providers (which require a real
   * billed network round-trip), retry a few times with short backoff so a single
   * transient 429 / timeout / network blip does NOT demote to the next candidate.
   *
   * WHY THIS MATTERS for the embedding-space migration: a spurious demotion
   * (gemini → ollama) changes the active embedding SPACE, which persists to
   * `last_embedding_space` and triggers a FULL billed re-index of the entire
   * corpus — then reverts on the next launch when the cloud provider returns.
   * Stabilizing the probe keeps the active space stable and avoids the thrash.
   * Local/Ollama probes are cheap + deterministic, so they aren't retried.
   */
  private static async probeAvailable(provider: IEmbeddingProvider): Promise<boolean> {
    const isCloud = EmbeddingProviderResolver.CLOUD_PROVIDER_NAMES.has(provider.name);
    const attempts = isCloud ? EmbeddingProviderResolver.CLOUD_PROBE_ATTEMPTS : 1;
    for (let i = 1; i <= attempts; i++) {
      if (await provider.isAvailable()) return true;
      if (i < attempts) {
        console.log(`[EmbeddingProviderResolver] ${provider.name} probe ${i}/${attempts} failed — retrying (avoids spurious space-thrash demotion)...`);
        await new Promise(r => setTimeout(r, EmbeddingProviderResolver.CLOUD_PROBE_BACKOFF_MS * i));
      }
    }
    return false;
  }

  /**
   * Returns the best available provider.
   * Runs isAvailable() checks in priority order.
   * Local model is the unconditional fallback — always last.
   */
  static async resolve(config: AppAPIConfig): Promise<IEmbeddingProvider> {
    const candidates: IEmbeddingProvider[] = [];

    let embeddingsDenied = false;

    if (config.openaiKey) {
      try {
        assertProviderDataScopes('openai_embeddings', ['embeddings'], config.providerDataScopes);
        candidates.push(new OpenAIEmbeddingProvider(config.openaiKey));
      } catch (error) {
        if (error instanceof ProviderScopeError) {
          embeddingsDenied = true;
          console.warn('[ScopeFallback] embeddings denied for cloud; routing to Ollama');
        } else {
          throw error;
        }
      }
    }
    if (config.geminiKey) {
      try {
        assertProviderDataScopes('gemini_embeddings', ['embeddings'], config.providerDataScopes);
        // Rollback lever: NATIVELY_GEMINI_EMBED_MODEL / _DIMS env vars pin the model
        // without a rebuild (e.g. back to 'gemini-embedding-001' @ 768 in an incident).
        // Explicit config overrides take precedence over env, which overrides the v2 default.
        const envModel = process.env.NATIVELY_GEMINI_EMBED_MODEL;
        const envDims = process.env.NATIVELY_GEMINI_EMBED_DIMS ? Number(process.env.NATIVELY_GEMINI_EMBED_DIMS) : undefined;
        candidates.push(new GeminiEmbeddingProvider(
          config.geminiKey,
          config.geminiEmbeddingModel ?? envModel,
          config.geminiEmbeddingDims ?? (Number.isFinite(envDims) ? envDims : undefined),
        ));
      } catch (error) {
        if (error instanceof ProviderScopeError) {
          embeddingsDenied = true;
          console.warn('[ScopeFallback] embeddings denied for cloud; routing to Ollama');
        } else {
          throw error;
        }
      }
    }

    candidates.push(new OllamaEmbeddingProvider(config.ollamaUrl || 'http://localhost:11434'));
    if (!embeddingsDenied) {
      candidates.push(new LocalEmbeddingProvider()); // always last, always works
    }

    for (const provider of candidates) {
      const available = await EmbeddingProviderResolver.probeAvailable(provider);
      if (available) {
        console.log(`[EmbeddingProviderResolver] Selected provider: ${provider.name} (${provider.dimensions}d)`);
        return provider;
      }
      console.log(`[EmbeddingProviderResolver] Provider ${provider.name} unavailable, trying next...`);
    }

    if (embeddingsDenied) {
      console.warn('[ScopeFallback] embeddings denied; Ollama unavailable, using bundled local embedding model');
      return new LocalEmbeddingProvider();
    }

    // This should never happen since LocalEmbeddingProvider.isAvailable()
    // only returns false if the bundled model is corrupted — a fatal install error
    throw new Error('No embedding provider available. The bundled model may be corrupted. Please reinstall.');
  }
}
