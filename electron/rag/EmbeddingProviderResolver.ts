import { IEmbeddingProvider } from './providers/IEmbeddingProvider';
import { OpenAIEmbeddingProvider } from './providers/OpenAIEmbeddingProvider';
import { GeminiEmbeddingProvider } from './providers/GeminiEmbeddingProvider';
import { OllamaEmbeddingProvider } from './providers/OllamaEmbeddingProvider';
import { LocalEmbeddingProvider } from './providers/LocalEmbeddingProvider';
import { NativelyEmbeddingProvider } from './providers/NativelyEmbeddingProvider';
import { TRIAL_SENTINEL_KEY } from '../config/constants';
import { probeOllamaEmbeddingDimensions } from './ollamaEmbeddingModels';
import { probeCustomEmbeddingDimensions } from './customEmbeddingModels';
import { CustomEmbeddingProvider } from './providers/CustomEmbeddingProvider';
import { OpenRouterEmbeddingProvider } from './providers/OpenRouterEmbeddingProvider';
import { VoyageEmbeddingProvider } from './providers/VoyageEmbeddingProvider';
import { probeOpenRouterEmbeddingDimensions } from './openrouterEmbeddingModels';
import { probeVoyageEmbeddingDimensions } from './voyageEmbeddingModels';
import { STATIC_EMBEDDING_MODELS } from './embeddingCatalog';

/**
 * Models whose default output width this app has verified against the provider,
 * so constructing one without an explicitly measured width is safe. Derived from
 * the curated catalogue so the two cannot drift.
 *
 * A model NOT in here is one live discovery turned up that we have never
 * measured — its width is unknown, and guessing stamps a wrong space key over
 * real vectors.
 */
/** Hosts that never leave the machine, so a privacy scope has nothing to gate. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

const KNOWN_DEFAULT_WIDTH_MODELS = new Set<string>([
  ...STATIC_EMBEDDING_MODELS.openai.map(m => m.id),
  ...STATIC_EMBEDDING_MODELS.gemini.map(m => m.id),
]);
import { ProviderScopeError, assertProviderDataScopes, type ProviderDataScopePolicy } from '../llm/ProviderRouter';

export interface AppAPIConfig {
  openaiKey?: string;
  geminiKey?: string;
  // Optional Gemini key POOL for rotation + per-key 429 cooldown. When present,
  // ALL of these (plus geminiKey) are handed to GeminiEmbeddingProvider so a
  // rate-limited key is skipped for the others instead of hard-failing the index.
  geminiKeys?: string[];
  ollamaUrl?: string; // e.g. 'http://localhost:11434'
  /**
   * User-selected Ollama embedding model. Omit for the shipped default
   * (nomic-embed-text @ 768d) — changing that default would re-space every
   * existing Ollama user.
   */
  ollamaEmbeddingModel?: string;
  /**
   * MEASURED output width for ollamaEmbeddingModel, from
   * probeOllamaEmbeddingDimensions(). Required whenever ollamaEmbeddingModel is
   * set: without it the model's real width is unknown, and defaulting would
   * stamp a wrong space key over the vectors.
   */
  ollamaEmbeddingDims?: number;
  /**
   * A user-hosted OpenAI-compatible embedding endpoint (LM Studio, llama.cpp's
   * llama-server, vLLM, text-embeddings-inference, a LiteLLM proxy).
   */
  customEmbeddingUrl?: string;
  customEmbeddingModel?: string;
  /** MEASURED width for that model — never declared. */
  customEmbeddingDims?: number;
  /** Optional bearer token. Local servers usually need none. */
  customEmbeddingKey?: string;
  /** OpenRouter — one key, many vendors' embedding models. */
  openrouterKey?: string;
  openrouterEmbeddingModel?: string;
  /** MEASURED width; OpenRouter's model list carries none. */
  openrouterEmbeddingDims?: number;
  /** Voyage AI — the only wired provider with query/document asymmetry. */
  voyageKey?: string;
  voyageEmbeddingModel?: string;
  voyageEmbeddingDims?: number;
  /**
   * Natively API key. Routed FIRST when present: this is the managed embedding
   * tier, and until it was wired up a Natively customer silently fell through to
   * Ollama or the bundled MiniLM model.
   */
  nativelyApiKey?: string;
  /** Required when nativelyApiKey is the trial sentinel — trials auth by token. */
  nativelyTrialToken?: string;
  /** Override for the Natively API base (tests, staging). */
  nativelyApiUrl?: string;
  providerDataScopes?: ProviderDataScopePolicy;
  // Optional overrides for the Gemini embedding model/dims (internal escape hatch
  // for a future bump). Default to gemini-embedding-2 @ 768d when omitted.
  geminiEmbeddingModel?: string;
  geminiEmbeddingDims?: number;
  /**
   * An EXPLICIT provider choice from Settings. When mode is 'manual' and a
   * provider is named, that provider is the only candidate — the automatic
   * priority chain is bypassed entirely.
   */
  embeddingMode?: 'auto' | 'manual';
  embeddingProvider?: string;
  /** User-selected OpenAI embedding model and output width. */
  openaiEmbeddingModel?: string;
  openaiEmbeddingDims?: number;
  /**
   * True when config came from the Settings UI credential store. In that mode,
   * clearing a key must actually remove that provider; shell/.env keys should not
   * silently keep it alive and make the UI lie about provider availability.
   */
  explicitKeyManagement?: boolean;
}

export class EmbeddingProviderResolver {
  /** Cloud providers get a bounded probe-retry before we demote (hysteresis). */
  private static readonly CLOUD_PROBE_ATTEMPTS = 3;
  private static readonly CLOUD_PROBE_BACKOFF_MS = 400;
  // 'natively' added 2026-08-30. It is a billed network round-trip like the
  // other two, so a single 429 or blip must not demote it — demotion changes the
  // active embedding SPACE and strands every persisted vector, which is the
  // thrash this hysteresis exists to prevent. Omitting it gave the managed tier
  // ONE probe attempt where openai/gemini get three.
  // Drives the 3-attempt probe retry. Every NETWORK provider belongs here: a
  // single 429 or DNS blip would otherwise demote on the first failure, which
  // changes the active embedding SPACE and strands every persisted vector —
  // exactly the thrash this hysteresis exists to prevent.
  private static readonly CLOUD_PROVIDER_NAMES = new Set([
    'openai', 'gemini', 'natively', 'voyage', 'openrouter', 'custom',
  ]);

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
  /**
   * Assemble the ordered, de-duped Gemini key pool for embedding rotation:
   *   config.geminiKeys[]  →  config.geminiKey  →  env GEMINI_API_KEY(_2.._6) / GOOGLE_API_KEY
   * Env keys are included so a packaged app (which may only have process env) still
   * gets rotation, and so the mission's multi-key .env is used automatically.
   */
  static buildGeminiKeyPool(config: AppAPIConfig): string[] {
    const pool: string[] = [];
    const add = (k?: string) => { const v = (k || '').trim(); if (v) pool.push(v); };
    for (const k of config.geminiKeys || []) add(k);
    add(config.geminiKey);
    if (!config.explicitKeyManagement) {
      for (const name of ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5', 'GEMINI_API_KEY_6', 'GOOGLE_API_KEY']) {
        add(process.env[name]);
      }
    }
    return [...new Set(pool)];
  }

  /**
   * The ordered candidate list, WITHOUT probing any of them.
   *
   * Separated from resolve() so priority is unit-testable with no network: an
   * order asserted through resolve() would pass for the wrong reason, since a
   * bogus cloud key failing its probe lets almost any ordering end up selecting
   * the same provider.
   *
   * LocalEmbeddingProvider is deliberately NOT in this list — it is the terminal
   * fallback and is never probed (probing loads the MiniLM ONNX model).
   */
  static buildCandidates(config: AppAPIConfig): IEmbeddingProvider[] {
    return EmbeddingProviderResolver.buildCandidatesWithScope(config).candidates;
  }

  /**
   * Candidates plus whether a provider-data-scope policy DENIED cloud
   * embeddings. resolve() needs the flag only for its log line; keeping one
   * builder means the ordering resolve() actually uses is the ordering the
   * tests assert — two copies is exactly how priority silently drifts.
   */
  private static buildCandidatesWithScope(config: AppAPIConfig): { candidates: IEmbeddingProvider[]; embeddingsDenied: boolean } {
    const candidates: IEmbeddingProvider[] = [];
    let embeddingsDenied = false;

    /** Add a cloud provider unless the scope policy forbids sending embeddings there. */
    const pushScoped = (scopeName: string, make: () => IEmbeddingProvider) => {
      try {
        assertProviderDataScopes(scopeName, ['embeddings'], config.providerDataScopes);
        candidates.push(make());
      } catch (error) {
        if (error instanceof ProviderScopeError) {
          embeddingsDenied = true;
          console.warn('[ScopeFallback] embeddings denied for cloud; routing to Ollama');
        } else {
          throw error;
        }
      }
    };

    // ── Natively first ────────────────────────────────────────────────────────
    // "If a Natively API key exists, route through it first; if it fails, follow
    // the chain." A managed key is an explicit choice of the managed tier, so it
    // outranks a BYO key for embeddings.
    //
    // Still scope-gated: Natively is a CLOUD provider, so a privacy policy that
    // forbids sending content off-device must exclude it exactly as it excludes
    // OpenAI and Gemini. "Managed" is not an exemption from the user's policy.
    const nativelyKey = (config.nativelyApiKey || '').trim();
    // The trial sentinel is not a credential — without the paired trial token the
    // provider cannot authenticate, so offering it just burns a probe per index.
    const trialUsable = nativelyKey !== TRIAL_SENTINEL_KEY || !!config.nativelyTrialToken;
    if (nativelyKey && trialUsable) {
      pushScoped('natively_embeddings', () => new NativelyEmbeddingProvider(nativelyKey, {
        baseUrl: config.nativelyApiUrl,
        trialToken: config.nativelyTrialToken,
      }));
    }

    // A user who has configured their own endpoint has made a deliberate choice;
    // it outranks the generic key chain. Local by nature, so NOT scope-gated —
    // an on-device server is exactly what a privacy policy wants.
    const customUrl = (config.customEmbeddingUrl || '').trim();
    const customModel = (config.customEmbeddingModel || '').trim();
    const customDims = config.customEmbeddingDims;
    if (customUrl && customModel) {
      if (typeof customDims === 'number' && Number.isInteger(customDims) && customDims > 0) {
        // pushScoped, not push. `normalizeCustomBaseUrl` accepts ANY absolute
        // URL, so "custom" is only on-device by convention — point it at
        // https://proxy.vendor.com/v1 and every chunk leaves the machine. It was
        // the one network provider the embeddings privacy scope did not gate,
        // and CLOUD_PROVIDER_NAMES already classifies it as network, so the two
        // contradicted each other.
        //
        // A loopback host is genuinely local, so it stays exempt: that is the
        // LM Studio / llama.cpp case the provider exists for.
        const customIsLoopback = LOOPBACK_HOSTS.has(hostnameOf(customUrl));
        const pushCustom = () => new CustomEmbeddingProvider({
          baseUrl: customUrl, model: customModel, dimensions: customDims, apiKey: config.customEmbeddingKey,
        });
        if (customIsLoopback) candidates.push(pushCustom());
        else pushScoped('custom_embeddings', pushCustom);
      } else {
        // Same rule as Ollama: no measured width means NO candidate. Guessing
        // stamps a wrong space key over the vectors.
        console.warn(
          `[EmbeddingProviderResolver] Custom endpoint model '${customModel}' has no measured dimensions `
          + `(got ${String(customDims)}) — skipping it rather than assuming a width.`
        );
      }
    }

    // Voyage ranks above the generic chain when explicitly configured: it is the
    // only provider here that embeds queries and documents differently, so it is
    // never something the user got by accident.
    const voyModel = (config.voyageEmbeddingModel || '').trim();
    const voyDims = config.voyageEmbeddingDims;
    if (config.voyageKey && voyModel) {
      if (typeof voyDims === 'number' && Number.isInteger(voyDims) && voyDims > 0) {
        pushScoped('voyage_embeddings', () => new VoyageEmbeddingProvider({
          apiKey: config.voyageKey!, model: voyModel, dimensions: voyDims,
        }));
      } else {
        console.warn(
          `[EmbeddingProviderResolver] Voyage model '${voyModel}' has no measured dimensions `
          + `(got ${String(voyDims)}) — skipping it rather than assuming a width.`
        );
      }
    }

    // OpenRouter sits with the other cloud providers: it is a paid third-party
    // service, so the same privacy scope gates it.
    const orModel = (config.openrouterEmbeddingModel || '').trim();
    const orDims = config.openrouterEmbeddingDims;
    if (config.openrouterKey && orModel) {
      if (typeof orDims === 'number' && Number.isInteger(orDims) && orDims > 0) {
        pushScoped('openrouter_embeddings', () => new OpenRouterEmbeddingProvider({
          apiKey: config.openrouterKey!, model: orModel, dimensions: orDims,
        }));
      } else {
        // Same rule as Ollama and the custom endpoint: no measured width means NO
        // candidate. Guessing stamps a wrong space key over real vectors.
        console.warn(
          `[EmbeddingProviderResolver] OpenRouter model '${orModel}' has no measured dimensions `
          + `(got ${String(orDims)}) — skipping it rather than assuming a width.`
        );
      }
    }

    // A DISCOVERED model has no width until it is measured, and unlike the other
    // providers these two fall back to a hardcoded default instead of refusing.
    // That fabricates a space key: the server returns its own natural width,
    // validate() then throws on every single call, and the index is labelled with
    // a width it never had.
    const openaiModel = (config.openaiEmbeddingModel || '').trim();
    const openaiWidthKnown = !openaiModel
      || KNOWN_DEFAULT_WIDTH_MODELS.has(openaiModel)
      || (typeof config.openaiEmbeddingDims === 'number' && config.openaiEmbeddingDims > 0);
    if (config.openaiKey && !openaiWidthKnown) {
      console.warn(
        `[EmbeddingProviderResolver] OpenAI model '${openaiModel}' has no measured dimensions `
        + `(got ${String(config.openaiEmbeddingDims)}) — skipping it rather than assuming a width.`
      );
    }
    if (config.openaiKey && openaiWidthKnown) {
      pushScoped('openai_embeddings', () => new OpenAIEmbeddingProvider(
        config.openaiKey!, config.openaiEmbeddingModel, config.openaiEmbeddingDims,
      ));
    }

    const geminiPool = EmbeddingProviderResolver.buildGeminiKeyPool(config);
    if (geminiPool.length > 0) {
      pushScoped('gemini_embeddings', () => {
        // Rollback lever: NATIVELY_GEMINI_EMBED_MODEL / _DIMS env vars pin the model
        // without a rebuild (e.g. back to 'gemini-embedding-001' @ 768 in an incident).
        // Explicit config overrides take precedence over env, which overrides the v2 default.
        const envModel = process.env.NATIVELY_GEMINI_EMBED_MODEL;
        const envDims = process.env.NATIVELY_GEMINI_EMBED_DIMS ? Number(process.env.NATIVELY_GEMINI_EMBED_DIMS) : undefined;
        return new GeminiEmbeddingProvider(
          geminiPool,
          config.geminiEmbeddingModel ?? envModel,
          config.geminiEmbeddingDims ?? (Number.isFinite(envDims) ? envDims : undefined),
        );
      });
    }

    const ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
    const ollamaModel = (config.ollamaEmbeddingModel || '').trim();
    if (!ollamaModel) {
      // Shipped default, unchanged: nomic-embed-text @ 768d.
      candidates.push(new OllamaEmbeddingProvider(ollamaUrl));
    } else {
      const dims = config.ollamaEmbeddingDims;
      const usable = typeof dims === 'number' && Number.isInteger(dims) && dims > 0;
      if (usable) {
        candidates.push(new OllamaEmbeddingProvider(ollamaUrl, ollamaModel, dims));
      } else {
        // OFFER NO CANDIDATE rather than fall back to the default width. A
        // 4096-d model written under a 768-d space key produces an index that
        // compares as noise with no error anywhere; having no Ollama provider
        // (and falling through to the next one) is strictly recoverable.
        console.warn(
          `[EmbeddingProviderResolver] Ollama model '${ollamaModel}' has no measured dimensions `
          + `(got ${String(dims)}) — skipping it rather than guessing a width and stamping a wrong embedding space.`
        );
      }
    }
    // ── An explicit choice outranks the chain ────────────────────────────────
    // Without this the ordered list above decided everything and the user's pick
    // was ignored: choosing Gemini while a Natively key existed simply kept
    // Natively, because natively sorts first and was available.
    //
    // Narrowed to a SINGLE candidate rather than merely reordered. Falling
    // through to another provider when the chosen one is unavailable would
    // change the embedding SPACE behind the user's back and re-index the corpus
    // into vectors they never asked for — the pipeline's own retry/hysteresis is
    // the right place to ride out a transient outage, not a silent substitution.
    //
    // 'local' deliberately yields an EMPTY list: LocalEmbeddingProvider is
    // resolve()'s terminal fallback and is never a candidate (probing it loads
    // the ONNX model), so "no candidate" is exactly how "use the built-in one"
    // is expressed.
    const chosen = (config.embeddingProvider || '').trim();
    if (config.embeddingMode === 'manual' && chosen) {
      return { candidates: candidates.filter(c => c.name === chosen), embeddingsDenied };
    }

    return { candidates, embeddingsDenied };
  }

  private static async probeAvailable(provider: IEmbeddingProvider): Promise<boolean> {
    const isCloud = EmbeddingProviderResolver.CLOUD_PROVIDER_NAMES.has(provider.name);
    const attempts = isCloud ? EmbeddingProviderResolver.CLOUD_PROBE_ATTEMPTS : 1;
    for (let i = 1; i <= attempts; i++) {
      try {
        if (await provider.isAvailable()) return true;
      } catch (error: any) {
        if (error?.permanentAuthFailure || error?.status === 401 || error?.status === 403) {
          console.warn(`[EmbeddingProviderResolver] ${provider.name} unavailable due to permanent auth failure — demoting immediately.`);
          return false;
        }
        throw error;
      }
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
  /**
   * Fill in a configured Ollama model's MEASURED width when it isn't cached.
   *
   * buildCandidates() rightly refuses to guess a width, but on its own that
   * would leave a user who picked qwen3-embedding:8b with no Ollama provider at
   * all. One probe here turns "unknown, so skipped" into "measured, so usable" —
   * and the measurement is what gets persisted in the space key, so it must come
   * from the same call path real embeddings use.
   *
   * Never throws: an unmeasurable model simply stays unconfigured and the chain
   * continues, which is the safe outcome.
   */
  static async withMeasuredOllamaDims(config: AppAPIConfig): Promise<AppAPIConfig> {
    const model = (config.ollamaEmbeddingModel || '').trim();
    if (!model) return config;
    const dims = config.ollamaEmbeddingDims;
    if (typeof dims === 'number' && Number.isInteger(dims) && dims > 0) return config;

    const measured = await probeOllamaEmbeddingDimensions(config.ollamaUrl || 'http://localhost:11434', model);
    if (measured == null) {
      console.warn(`[EmbeddingProviderResolver] Could not measure embedding width for Ollama model '${model}' — leaving it unconfigured rather than assuming one.`);
      return config;
    }
    console.log(`[EmbeddingProviderResolver] Measured Ollama model '${model}' at ${measured}d.`);
    return { ...config, ollamaEmbeddingDims: measured };
  }

  /** Same contract as withMeasuredOllamaDims, for a user-hosted endpoint. */
  static async withMeasuredCustomDims(config: AppAPIConfig): Promise<AppAPIConfig> {
    const url = (config.customEmbeddingUrl || '').trim();
    const model = (config.customEmbeddingModel || '').trim();
    if (!url || !model) return config;
    const dims = config.customEmbeddingDims;
    if (typeof dims === 'number' && Number.isInteger(dims) && dims > 0) return config;

    const found = await probeCustomEmbeddingDimensions(url, model, config.customEmbeddingKey);
    if (found == null) {
      console.warn(`[EmbeddingProviderResolver] Could not measure embedding width for custom model '${model}' — leaving it unconfigured.`);
      return config;
    }
    console.log(`[EmbeddingProviderResolver] Measured custom model '${model}' at ${found}d.`);
    return { ...config, customEmbeddingDims: found };
  }

  /** Same contract as withMeasuredOllamaDims, for OpenRouter. */
  static async withMeasuredOpenRouterDims(config: AppAPIConfig): Promise<AppAPIConfig> {
    const model = (config.openrouterEmbeddingModel || '').trim();
    if (!config.openrouterKey || !model) return config;
    const dims = config.openrouterEmbeddingDims;
    if (typeof dims === 'number' && Number.isInteger(dims) && dims > 0) return config;

    const found = await probeOpenRouterEmbeddingDimensions(model, config.openrouterKey);
    if (found == null) {
      console.warn(`[EmbeddingProviderResolver] Could not measure embedding width for OpenRouter model '${model}' — leaving it unconfigured.`);
      return config;
    }
    console.log(`[EmbeddingProviderResolver] Measured OpenRouter model '${model}' at ${found}d.`);
    return { ...config, openrouterEmbeddingDims: found };
  }

  /** Same contract as withMeasuredOllamaDims, for Voyage. */
  static async withMeasuredVoyageDims(config: AppAPIConfig): Promise<AppAPIConfig> {
    const model = (config.voyageEmbeddingModel || '').trim();
    if (!config.voyageKey || !model) return config;
    const dims = config.voyageEmbeddingDims;
    if (typeof dims === 'number' && Number.isInteger(dims) && dims > 0) return config;

    const found = await probeVoyageEmbeddingDimensions(model, config.voyageKey);
    if (found == null) {
      console.warn(`[EmbeddingProviderResolver] Could not measure embedding width for Voyage model '${model}' — leaving it unconfigured.`);
      return config;
    }
    console.log(`[EmbeddingProviderResolver] Measured Voyage model '${model}' at ${found}d.`);
    return { ...config, voyageEmbeddingDims: found };
  }

  static async resolve(config: AppAPIConfig): Promise<IEmbeddingProvider> {
    // Measure only what this resolve can actually USE, and do it concurrently.
    //
    // These were four SEQUENTIAL network round trips with 15-20s timeouts, run
    // unconditionally — before the manual-mode filter narrowed to one provider.
    // A user pinned to Gemini with a Voyage key and an unreachable LM Studio
    // endpoint paid up to ~55s of serial timeouts on every app start AND every
    // set-config (which awaits initializeEmbeddings, blocking the IPC reply).
    const pinned = config.embeddingMode === 'manual' ? (config.embeddingProvider || '') : '';
    const wanted = (name: string) => !pinned || pinned === name;
    const [ollamaCfg, customCfg, orCfg, voyCfg] = await Promise.all([
      wanted('ollama') ? EmbeddingProviderResolver.withMeasuredOllamaDims(config) : config,
      wanted('custom') ? EmbeddingProviderResolver.withMeasuredCustomDims(config) : config,
      wanted('openrouter') ? EmbeddingProviderResolver.withMeasuredOpenRouterDims(config) : config,
      wanted('voyage') ? EmbeddingProviderResolver.withMeasuredVoyageDims(config) : config,
    ]);
    // Each helper returns a copy of `config` with at most its OWN dims field
    // filled, so merging the four is safe and order-independent.
    const measured: AppAPIConfig = {
      ...config,
      ollamaEmbeddingDims: ollamaCfg.ollamaEmbeddingDims,
      customEmbeddingDims: customCfg.customEmbeddingDims,
      openrouterEmbeddingDims: orCfg.openrouterEmbeddingDims,
      voyageEmbeddingDims: voyCfg.voyageEmbeddingDims,
    };
    const { candidates, embeddingsDenied } = EmbeddingProviderResolver.buildCandidatesWithScope(measured);
    const chosenProvider = measured.embeddingMode === 'manual' ? (measured.embeddingProvider || '') : '';

    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i];
      const available = await EmbeddingProviderResolver.probeAvailable(provider);
      if (available) {
        console.log(`[EmbeddingProviderResolver] Selected provider: ${provider.name} (${provider.dimensions}d)`);
        return provider;
      }
      // Say which it actually is. Printed unconditionally, "trying next" read as
      // "the chain continued" even when the list was exhausted — which made a
      // single-candidate MANUAL selection look indistinguishable from an
      // auto-mode fallthrough while diagnosing exactly that bug.
      const more = i < candidates.length - 1;
      console.log(more
        ? `[EmbeddingProviderResolver] Provider ${provider.name} unavailable, trying next...`
        : `[EmbeddingProviderResolver] Provider ${provider.name} unavailable and it was the last candidate`
          + `${chosenProvider ? ` (you selected ${chosenProvider}) — falling back to the bundled model` : ''}.`);
    }

    // Local is the terminal fallback. Do NOT probe isAvailable() here: that loads
    // the MiniLM ONNX model and defeats startup lazy-loading for keyless/offline
    // users. Construction exposes dimensions/space cheaply; the actual model load
    // happens on first embed()/embedQuery(), where failures can still surface and
    // retry normally.
    if (embeddingsDenied) {
      console.warn('[ScopeFallback] embeddings denied; Ollama unavailable, using bundled local embedding model lazily');
    } else {
      console.log('[EmbeddingProviderResolver] No cloud/Ollama provider available; using bundled local embedding model lazily');
    }
    const local = new LocalEmbeddingProvider();
    console.log(`[EmbeddingProviderResolver] Selected provider: ${local.name} (${local.dimensions}d, lazy load)`);
    return local;
  }
}
