// electron/rag/embeddingConfigIdentity.ts
//
// ONE place that assembles the embedding provider config, and ONE place that
// decides whether it changed.
//
// Before this, four call sites hand-rolled the same AppAPIConfig object
// (main.ts bootstrapOllamaEmbeddings + initializeRAGManager, ipcHandlers
// set-gemini-api-key + set-openai-api-key) and had ALREADY drifted: `geminiKeys`
// was passed at only one of them, so Gemini key rotation silently didn't apply
// when a key was entered through Settings. Any newly added field inherits that
// drift by default, which is how a Natively key would reach the resolver from
// some entry points and not others.

import type { AppAPIConfig } from './EmbeddingProviderResolver';
import { TRIAL_SENTINEL_KEY } from '../config/constants';

/**
 * The credential reads buildEmbeddingConfig needs. Injectable because esbuild
 * INLINES the CredentialsManager module into each entry bundle, so a test cannot
 * intercept `require('../services/CredentialsManager')` — the dependency has to
 * be a parameter, not a module lookup, to be substitutable.
 */
export interface EmbeddingCredentialStore {
  getGeminiApiKey(): string | undefined;
  getOpenaiApiKey(): string | undefined;
  getNativelyApiKey(): string | undefined;
  getTrialToken?(): string | undefined;
  /** Optional bearer token for a user-hosted endpoint. */
  getCustomEmbeddingApiKey?(): string | undefined;
  getOpenrouterApiKey?(): string | undefined;
  getVoyageApiKey?(): string | undefined;
}

export interface EmbeddingConfigSources {
  nativelyApiKey?: string;
  /** The real credential when nativelyApiKey is the trial sentinel. */
  trialToken?: string;
  openaiKey?: string;
  geminiKey?: string;
  geminiKeys?: string[];
  ollamaUrl?: string;
  /** User-selected Ollama embedding model (omit for the shipped default). */
  ollamaEmbeddingModel?: string;
  /** MEASURED width for that model — never a guess. See ollamaEmbeddingModels.ts. */
  ollamaEmbeddingDims?: number;
  /** User-hosted OpenAI-compatible endpoint (LM Studio, llama.cpp, vLLM, …). */
  customEmbeddingUrl?: string;
  customEmbeddingModel?: string;
  customEmbeddingDims?: number;
  customEmbeddingKey?: string;
  openrouterKey?: string;
  openrouterEmbeddingModel?: string;
  openrouterEmbeddingDims?: number;
  voyageKey?: string;
  voyageEmbeddingModel?: string;
  voyageEmbeddingDims?: number;
  /** An explicit provider choice from Settings. */
  embeddingMode?: 'auto' | 'manual';
  embeddingProvider?: string;
  /** User-selected cloud embedding model + width. */
  openaiEmbeddingModel?: string;
  openaiEmbeddingDims?: number;
  geminiEmbeddingModel?: string;
  geminiEmbeddingDims?: number;
  nativelyApiUrl?: string;
  providerDataScopes?: AppAPIConfig['providerDataScopes'];
  explicitKeyManagement?: boolean;
}

/** Trim, and treat a blank string as absent so a cleared key really removes its provider. */
const clean = (v?: string): string | undefined => {
  const t = (v || '').trim();
  return t.length > 0 ? t : undefined;
};

/** Assemble the resolver config from already-read credential values. Pure. */
export function embeddingConfigFrom(sources: EmbeddingConfigSources): AppAPIConfig {
  const nativelyApiKey = clean(sources.nativelyApiKey);
  return {
    nativelyApiKey,
    // Only meaningful for the sentinel, but carried whenever present so the
    // change-detector can see a new trial arrive.
    nativelyTrialToken: clean(sources.trialToken),
    nativelyApiUrl: clean(sources.nativelyApiUrl),
    openaiKey: clean(sources.openaiKey),
    geminiKey: clean(sources.geminiKey),
    geminiKeys: (sources.geminiKeys || []).map(k => clean(k)).filter((k): k is string => !!k),
    ollamaUrl: sources.ollamaUrl,
    ollamaEmbeddingModel: clean(sources.ollamaEmbeddingModel),
    ollamaEmbeddingDims: sources.ollamaEmbeddingDims,
    customEmbeddingUrl: clean(sources.customEmbeddingUrl),
    customEmbeddingModel: clean(sources.customEmbeddingModel),
    customEmbeddingDims: sources.customEmbeddingDims,
    customEmbeddingKey: clean(sources.customEmbeddingKey),
    openrouterKey: clean(sources.openrouterKey),
    openrouterEmbeddingModel: clean(sources.openrouterEmbeddingModel),
    openrouterEmbeddingDims: sources.openrouterEmbeddingDims,
    voyageKey: clean(sources.voyageKey),
    voyageEmbeddingModel: clean(sources.voyageEmbeddingModel),
    voyageEmbeddingDims: sources.voyageEmbeddingDims,
    embeddingMode: sources.embeddingMode,
    embeddingProvider: clean(sources.embeddingProvider),
    openaiEmbeddingModel: clean(sources.openaiEmbeddingModel),
    openaiEmbeddingDims: sources.openaiEmbeddingDims,
    geminiEmbeddingModel: clean(sources.geminiEmbeddingModel),
    geminiEmbeddingDims: sources.geminiEmbeddingDims,
    providerDataScopes: sources.providerDataScopes,
    explicitKeyManagement: sources.explicitKeyManagement,
  };
}

/**
 * Read the live credential/settings singletons and build the config.
 *
 * Kept in the main process and required lazily, matching how the call sites
 * already reach these singletons. Every embedding entry point must go through
 * here so they cannot drift apart again.
 */
export function resolveEmbeddingCredentials(
  overrides: Partial<EmbeddingConfigSources>,
  store: EmbeddingCredentialStore,
): AppAPIConfig {
  const explicitKeyManagement = overrides.explicitKeyManagement;

  // `in`, NOT `!== undefined`. The Settings handlers pass
  // `{ geminiKey: apiKey || undefined }`, so CLEARING the field yields an
  // explicit `undefined` that must mean "this key is gone". Treating that as
  // "no override given" resurrects the removed key from the credential store,
  // keeps the provider alive until restart, and makes the UI report a provider
  // the app is no longer using.
  const has = (k: keyof EmbeddingConfigSources) => Object.prototype.hasOwnProperty.call(overrides, k);
  const pick = (k: keyof EmbeddingConfigSources, fromStore: () => string | undefined): string | undefined =>
    has(k) ? (overrides[k] as string | undefined) : fromStore();

  const geminiKey = pick('geminiKey', () =>
    store.getGeminiApiKey() || (explicitKeyManagement ? undefined : (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY)));
  const openaiKey = pick('openaiKey', () =>
    store.getOpenaiApiKey() || (explicitKeyManagement ? undefined : process.env.OPENAI_API_KEY));
  const nativelyApiKey = pick('nativelyApiKey', () => store.getNativelyApiKey());
  const customEmbeddingKey = pick('customEmbeddingKey', () => store.getCustomEmbeddingApiKey?.());
  const openrouterKey = pick('openrouterKey', () => store.getOpenrouterApiKey?.());
  const voyageKey = pick('voyageKey', () => store.getVoyageApiKey?.());

  // Gemini embedding key POOL: the effective key + GEMINI_API_KEY(_2.._6)/GOOGLE
  // env keys, de-duped. Lets the provider rotate off a rate-limited key (429 →
  // per-key cooldown → next key) instead of failing the whole index.
  //
  // Seeded from `geminiKey` above, not from the store, so a cleared key is not
  // quietly reintroduced through the rotation pool.
  const geminiKeys: string[] = [];
  const addGemini = (k?: string) => { const v = (k || '').trim(); if (v && !geminiKeys.includes(v)) geminiKeys.push(v); };
  addGemini(geminiKey);
  if (!explicitKeyManagement) {
    for (const n of ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5', 'GEMINI_API_KEY_6', 'GOOGLE_API_KEY']) {
      addGemini(process.env[n]);
    }
  }

  // SPREAD the overrides, do not re-list them. A hand-written pass-through
  // dropped embeddingMode, embeddingProvider and both cloud model/dims pairs —
  // settings could read {mode:'manual', provider:'gemini'} while the config
  // arrived as auto with a null model, so the user's choice never reached the
  // resolver. embeddingConfigFrom only reads fields it names, so spreading is
  // safe and, unlike a list, cannot fall behind the type.
  //
  // Same defect that hit RAGManager's config subset and ProcessingHelper's init
  // object in this campaign. Three times is a pattern: never hand-maintain a
  // field list for this config.
  return embeddingConfigFrom({
    ...overrides,
    nativelyApiKey,
    // A trial's sentinel key is not a credential — the token is. Read it
    // whenever the sentinel is in play so trials get managed embeddings too.
    trialToken: (clean(nativelyApiKey) === TRIAL_SENTINEL_KEY)
      ? (has('trialToken') ? overrides.trialToken : store.getTrialToken?.())
      : undefined,
    openaiKey,
    geminiKey,
    geminiKeys,
    ollamaUrl: overrides.ollamaUrl ?? process.env.OLLAMA_URL ?? 'http://localhost:11434',
    ollamaEmbeddingModel: overrides.ollamaEmbeddingModel,
    ollamaEmbeddingDims: overrides.ollamaEmbeddingDims,
    customEmbeddingUrl: overrides.customEmbeddingUrl,
    customEmbeddingModel: overrides.customEmbeddingModel,
    customEmbeddingDims: overrides.customEmbeddingDims,
    customEmbeddingKey,
    openrouterKey,
    voyageKey,
    nativelyApiUrl: overrides.nativelyApiUrl ?? process.env.NATIVELY_API_URL,
    providerDataScopes: overrides.providerDataScopes,
    explicitKeyManagement,
  });
}

/**
 * Read the live credential/settings singletons and build the config.
 *
 * Thin wrapper over resolveEmbeddingCredentials — all the logic worth testing
 * lives there, where the credential source can be substituted.
 */
export function buildEmbeddingConfig(overrides: Partial<EmbeddingConfigSources> = {}): AppAPIConfig {
  const { CredentialsManager } = require('../services/CredentialsManager');
  const cm = CredentialsManager.getInstance();

  const settings = (() => {
    try {
      const { SettingsManager } = require('../services/SettingsManager');
      return SettingsManager.getInstance();
    } catch { return null; }
  })();
  const providerDataScopes = (() => {
    try { return settings?.get('providerDataScopes'); } catch { return undefined; }
  })();

  // User-chosen embedding model. Only Ollama is user-selectable today; the other
  // providers each have exactly one model. `mode: 'auto'` (the default) leaves
  // the chain untouched so an upgrading user is never silently re-spaced.
  const chosen = (() => {
    try { return settings?.get('embedding') || undefined; } catch { return undefined; }
  })();
  const customEndpoint = (() => {
    try { return settings?.get('customEmbeddingEndpoint') || undefined; } catch { return undefined; }
  })();
  const ollamaFromSettings = (chosen?.mode === 'manual' && chosen?.provider === 'ollama')
    ? { ollamaEmbeddingModel: chosen.model, ollamaEmbeddingDims: chosen.dimensions }
    : {};

  // A manual selection for a CLOUD provider reaches its provider the same way
  // Ollama's does. Without this the panel would let a user pick
  // text-embedding-3-large and the resolver would quietly keep 3-small.
  // The Built-in card lists the bundled MiniLM AND nomic-embed-text, because
  // nomic arrives without configuration when Ollama is present. But nomic is
  // SERVED BY OLLAMA, and provider 'local' deliberately yields no candidate (it
  // is resolve()'s terminal fallback), so selecting it there resolved to MiniLM —
  // the user asked for a 768-d nomic index and silently got the 384-d
  // lightweight model this whole panel exists to steer them away from.
  const BUNDLED_LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2';
  const localIsOllamaBacked = chosen?.mode === 'manual'
    && chosen?.provider === 'local'
    && !!chosen?.model
    && chosen.model !== BUNDLED_LOCAL_MODEL;
  const effectiveProvider = localIsOllamaBacked ? 'ollama' : chosen?.provider;
  const localViaOllama = localIsOllamaBacked
    ? { ollamaEmbeddingModel: chosen!.model, ollamaEmbeddingDims: chosen!.dimensions }
    : {};

  const voyageFromSettings = (chosen?.mode === 'manual' && chosen?.provider === 'voyage')
    ? { voyageEmbeddingModel: chosen.model, voyageEmbeddingDims: chosen.dimensions }
    : {};

  const openrouterFromSettings = (chosen?.mode === 'manual' && chosen?.provider === 'openrouter')
    ? { openrouterEmbeddingModel: chosen.model, openrouterEmbeddingDims: chosen.dimensions }
    : {};

  const cloudFromSettings = (chosen?.mode === 'manual' && chosen?.provider === 'openai')
    ? { openaiEmbeddingModel: chosen.model, openaiEmbeddingDims: chosen.dimensions }
    : (chosen?.mode === 'manual' && chosen?.provider === 'gemini')
      ? { geminiEmbeddingModel: chosen.model, geminiEmbeddingDims: chosen.dimensions }
      : {};

  const customFromSettings = (chosen?.mode === 'manual' && chosen?.provider === 'custom')
    ? { customEmbeddingUrl: customEndpoint, customEmbeddingModel: chosen.model, customEmbeddingDims: chosen.dimensions }
    : { customEmbeddingUrl: customEndpoint };

  // The choice itself, not just its model/dims hints. Every provider is covered
  // here — including natively and local, which have no hints to carry and were
  // therefore dropped entirely before.
  const choice = { embeddingMode: chosen?.mode, embeddingProvider: effectiveProvider };

  return resolveEmbeddingCredentials({ providerDataScopes, ...choice, ...ollamaFromSettings, ...cloudFromSettings, ...openrouterFromSettings, ...voyageFromSettings, ...localViaOllama, ...customFromSettings, ...overrides }, cm);
}

/**
 * Whether any provider-selection input changed, in EITHER direction.
 *
 * Removals matter as much as additions: a cleared key that does not re-resolve
 * leaves the stale provider alive until restart, and the UI then reports a
 * provider that is no longer really in use.
 */
export function embeddingConfigChanged(prev: AppAPIConfig, next: AppAPIConfig): boolean {
  const norm = (value?: string) => (value || '').trim();
  const normList = (values?: string[]) => (values || []).map(norm).filter(Boolean).join('\n');
  const normScopes = (value: AppAPIConfig['providerDataScopes']) => JSON.stringify(value || {});
  return (
    norm(prev.nativelyApiKey) !== norm(next.nativelyApiKey) ||
    // The sentinel key is IDENTICAL across trials, so comparing the key alone
    // would treat a brand-new trial as unchanged and keep using the dead token.
    norm(prev.nativelyTrialToken) !== norm(next.nativelyTrialToken) ||
    norm(prev.nativelyApiUrl) !== norm(next.nativelyApiUrl) ||
    norm(prev.openaiKey) !== norm(next.openaiKey) ||
    norm(prev.geminiKey) !== norm(next.geminiKey) ||
    norm(prev.ollamaUrl) !== norm(next.ollamaUrl) ||
    // A model swap changes the VECTOR SPACE. Missing this means the user picks a
    // new embedding model in Settings and nothing happens — no re-resolve, no
    // error, the old provider still active until restart.
    norm(prev.ollamaEmbeddingModel) !== norm(next.ollamaEmbeddingModel) ||
    (prev.ollamaEmbeddingDims || 0) !== (next.ollamaEmbeddingDims || 0) ||
    // Endpoint, model and width all change the VECTOR SPACE for a custom server.
    norm(prev.customEmbeddingUrl) !== norm(next.customEmbeddingUrl) ||
    norm(prev.customEmbeddingModel) !== norm(next.customEmbeddingModel) ||
    (prev.customEmbeddingDims || 0) !== (next.customEmbeddingDims || 0) ||
    norm(prev.customEmbeddingKey) !== norm(next.customEmbeddingKey) ||
    norm(prev.openrouterKey) !== norm(next.openrouterKey) ||
    norm(prev.openrouterEmbeddingModel) !== norm(next.openrouterEmbeddingModel) ||
    (prev.openrouterEmbeddingDims || 0) !== (next.openrouterEmbeddingDims || 0) ||
    norm(prev.voyageKey) !== norm(next.voyageKey) ||
    norm(prev.voyageEmbeddingModel) !== norm(next.voyageEmbeddingModel) ||
    (prev.voyageEmbeddingDims || 0) !== (next.voyageEmbeddingDims || 0) ||
    normList(prev.geminiKeys) !== normList(next.geminiKeys) ||
    norm(prev.geminiEmbeddingModel) !== norm(next.geminiEmbeddingModel) ||
    (prev.geminiEmbeddingDims || 0) !== (next.geminiEmbeddingDims || 0) ||
    // Width is part of the embedding SPACE, so a change here is a re-index.
    // Without these, switching from (say) Natively to Built-in changes no model
    // or width, so initialize() would find the config "unchanged", skip
    // re-resolution, and the switch would silently do nothing.
    norm(prev.embeddingMode) !== norm(next.embeddingMode) ||
    norm(prev.embeddingProvider) !== norm(next.embeddingProvider) ||
    norm(prev.openaiEmbeddingModel) !== norm(next.openaiEmbeddingModel) ||
    (prev.openaiEmbeddingDims || 0) !== (next.openaiEmbeddingDims || 0) ||
    normScopes(prev.providerDataScopes) !== normScopes(next.providerDataScopes) ||
    Boolean(prev.explicitKeyManagement) !== Boolean(next.explicitKeyManagement)
  );
}
