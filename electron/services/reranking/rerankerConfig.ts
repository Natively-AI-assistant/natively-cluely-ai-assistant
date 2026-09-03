/**
 * The reranker's user-facing configuration, and the policy that turns it into a
 * port the seam may use.
 *
 * Everything the registry refuses to know lives here: which provider the user
 * picked, whether a key exists, whether local-only mode forbids a network call.
 * The registry only ever sees a port or null, which is what keeps it
 * synchronous and testable without a network or an Electron app object.
 *
 * There is ONE reranker section in Settings. Provider is a choice inside it, not
 * a second section — a "Local Reranker" panel beside an "OpenRouter Reranker"
 * panel would let a user configure two things that cannot both be active.
 */

export type RerankerProvider = 'local' | 'openrouter' | 'jina';

export interface RerankerSettings {
  /**
   * Defaults to 'local'. An upgrading user's reranker must not change because a
   * new setting appeared, so absent === local === exactly today's behaviour.
   */
  provider?: RerankerProvider;
  /** OpenRouter model id. No default is hard-coded — see defaultRerankModel(). */
  openrouterModel?: string;
  /** Jina AI model id, e.g. jina-reranker-v3.5. */
  jinaModel?: string;
  /**
   * A catalogue id from rag/rerankerModelCatalog.ts, or absent for the bundled
   * bge-reranker-base. ONNX entries are read by LocalReranker; GGUF entries are
   * run by llama.cpp through buildLocalGgufPort().
   */
  localModelId?: string;
  /** How many candidates to send. Absent keeps ModeHybridRetriever's own pool size. */
  candidateCount?: number;
  /**
   * Opt-in: when the hosted reranker fails, try the built-in one for that
   * request. Default OFF — a silent substitution reorders evidence with a model
   * the user did not choose.
   */
  fallbackToLocal?: boolean;
  /** Cached from the last successful "Test connection", for the settings panel. */
  lastTest?: {
    at: string;
    model: string;
    latencyMs: number;
    ok: boolean;
    failure?: string;
  };
}

export const DEFAULT_RERANKER_SETTINGS: Required<Pick<RerankerSettings, 'provider' | 'fallbackToLocal'>> = {
  provider: 'local',
  fallbackToLocal: false,
};

/**
 * Why the hosted reranker may not run. Returned rather than thrown so the
 * settings panel can explain the state instead of just hiding the option.
 */
export type HostedIneligibility =
  | 'provider-not-selected'
  | 'local-only-mode'
  | 'reference-files-scope-denied'
  | 'no-api-key'
  | 'no-model';

export interface HostedEligibility {
  eligible: boolean;
  reason?: HostedIneligibility;
}

export interface EligibilityInputs {
  provider: RerankerProvider;
  hasApiKey: boolean;
  model: string | undefined;
  /** `LLMHelper.isLocalOnly()`. See isLocalOnlyMode() below for what this is worth today. */
  localOnly: boolean;
  /**
   * `providerDataScopes.reference_files`. This is the control that actually
   * ships, and it describes exactly what hosted rerank sends: retrieved document
   * snippets. A user who turned it off has said those snippets do not leave this
   * machine, and a rerank request is a way for them to leave.
   */
  referenceFilesScopeAllowed: boolean;
}

/**
 * The whole hosted-rerank gate, as a pure function so both the runtime path and
 * the settings panel reach the same verdict from the same inputs — and so the
 * local-only guarantee is a test, not an inspection.
 *
 * Order matters: local-only is checked BEFORE the key and the model, so a
 * local-only user is told the truth ("hosted rerankers are unavailable") rather
 * than being invited to fix a key that would still not be used.
 */
export function evaluateHostedEligibility(input: EligibilityInputs): HostedEligibility {
  if (input.provider !== 'openrouter' && input.provider !== 'jina') {
    return { eligible: false, reason: 'provider-not-selected' };
  }
  if (input.localOnly) return { eligible: false, reason: 'local-only-mode' };
  if (!input.referenceFilesScopeAllowed) return { eligible: false, reason: 'reference-files-scope-denied' };
  if (!input.hasApiKey) return { eligible: false, reason: 'no-api-key' };
  if (!input.model || !input.model.trim()) return { eligible: false, reason: 'no-model' };
  return { eligible: true };
}

export function describeIneligibility(reason: HostedIneligibility): string {
  switch (reason) {
    case 'provider-not-selected':
      return 'The reranker provider is set to Local.';
    case 'local-only-mode':
      return 'Local-only mode is enabled. Hosted rerankers are unavailable.';
    case 'reference-files-scope-denied':
      return 'Reference-file content is not allowed to leave this machine '
        + '(Settings > Privacy). Hosted reranking would send retrieved document text, '
        + 'so it is unavailable.';
    case 'no-api-key':
      return 'No OpenRouter API key is configured.';
    case 'no-model':
      return 'No OpenRouter rerank model is selected.';
  }
}

// ---------------------------------------------------------------------------
// Runtime readers
//
// Lazy `require` throughout, and every one wrapped: this module is reached from
// the retrieval hot path, and a missing or half-initialised singleton must
// degrade to "local", never throw into retrieval. esbuild gives every electron
// TS file its own bundle, so a top-level import here would also inline a second
// copy of each singleton — see services/extensions/singleton.ts.
// ---------------------------------------------------------------------------

export function readRerankerSettings(): RerankerSettings {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SettingsManager } = require('../SettingsManager');
    return (SettingsManager.getInstance().get('reranker') as RerankerSettings) ?? {};
  } catch {
    return {};
  }
}

/** The key for a hosted provider. One credential per provider, shared app-wide. */
export function readHostedApiKey(provider: RerankerProvider): string | undefined {
  if (provider === 'jina') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { CredentialsManager } = require('../CredentialsManager');
      const stored = CredentialsManager.getInstance().getJinaApiKey?.();
      if (stored && stored.trim()) return stored.trim();
    } catch { /* fall through to env */ }
    const env = (process.env.JINA_API_KEY || '').trim();
    return env || undefined;
  }
  return readOpenRouterApiKey();
}

/** The model id for whichever hosted provider is selected. */
export function readHostedModel(settings: RerankerSettings): string | undefined {
  return settings.provider === 'jina' ? settings.jinaModel : settings.openrouterModel;
}

export function readOpenRouterApiKey(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CredentialsManager } = require('../CredentialsManager');
    const stored = CredentialsManager.getInstance().getOpenrouterApiKey();
    if (stored && stored.trim()) return stored.trim();
  } catch { /* fall through to env */ }
  // The same OPENROUTER_API_KEY the rest of the app uses. One credential, not two.
  const env = (process.env.OPENROUTER_API_KEY || '').trim();
  return env || undefined;
}

/**
 * True when the user has turned on local-only mode.
 *
 * A caveat worth writing down rather than discovering later: `setLocalOnlyMode()`
 * has NO production caller in this app — `CodexVisionPayload2026_08_05.test.mjs:341`
 * says so explicitly — so `LLMHelper.isLocalOnlyMode` is always false in a
 * shipped build. This check is therefore future-proofing, not the real gate.
 * The real gate is referenceFilesScopeAllowed() below, which reads a control
 * that ships and is enforced at every other outbound boundary.
 */
export function isLocalOnlyMode(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../LLMHelper');
    const helper = mod?.getLLMHelper?.() ?? mod?.llmHelper ?? null;
    if (helper && typeof helper.isLocalOnly === 'function') return Boolean(helper.isLocalOnly());
  } catch { /* no helper reachable; not evidence of local-only */ }
  return false;
}

/**
 * Whether retrieved reference-file text may leave this machine.
 *
 * This is THE privacy gate for hosted reranking, because rerank candidates are
 * reference-file content — the same bytes `LLMHelper` already refuses to send
 * when this scope is denied (LLMHelper.ts:581, 6424).
 *
 * Matches the repo's existing reading of the flag (`!== false`: allowed unless
 * explicitly denied) but fails CLOSED when settings cannot be read at all. A
 * policy reader that fails OPEN is exactly the bug
 * OutboundBoundaryUniversality2026_08_01.test.mjs was written about.
 */
export function referenceFilesScopeAllowed(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SettingsManager } = require('../SettingsManager');
    const scopes = SettingsManager.getInstance().get('providerDataScopes');
    return scopes?.reference_files !== false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Port construction
// ---------------------------------------------------------------------------

import type { RerankSeamPort } from './RerankerRegistry';
import { peekProcessSingleton, setProcessSingleton } from '../extensions/singleton';

/**
 * The hosted port, or null when it may not run.
 *
 * Called synchronously on the retrieval path, once per query, so it does no I/O
 * — every input is a cheap local read. It returns null far more often than not,
 * and null is the cheap path.
 */
export function buildHostedRerankPort(): RerankSeamPort | null {
  const settings = readRerankerSettings();
  const provider = settings.provider ?? DEFAULT_RERANKER_SETTINGS.provider;
  const apiKey = readHostedApiKey(provider);
  const model = readHostedModel(settings);

  const verdict = evaluateHostedEligibility({
    provider,
    hasApiKey: Boolean(apiKey),
    model,
    localOnly: isLocalOnlyMode(),
    referenceFilesScopeAllowed: referenceFilesScopeAllowed(),
  });
  if (!verdict.eligible) return null;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { hostedRerankProvider } = require('../../rag/hostedRerankProviders') as typeof import('../../rag/hostedRerankProviders');
  const descriptor = hostedRerankProvider(provider);
  if (!descriptor) return null;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OpenRouterReranker } = require('./OpenRouterReranker') as typeof import('./OpenRouterReranker');
  // One client for every hosted provider: they all speak the same rerank
  // request and response. Only the endpoint and the credential differ.
  return new OpenRouterReranker({
    baseUrl: descriptor.baseUrl,
    providerId: descriptor.id,
    // Re-read per call rather than closing over the values: a key or model
    // changed in Settings must take effect without a restart.
    getApiKey: () => readHostedApiKey(readRerankerSettings().provider ?? 'local'),
    getModel: () => readHostedModel(readRerankerSettings()),
    onStats: (stats) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { telemetryService } = require('../telemetry/TelemetryService');
        telemetryService.track({
          name: 'rerank_request',
          properties: {
            provider: descriptor.id,
            model: stats.model,
            // Named for what it measures. This includes the network round trip
            // and is NOT model inference time.
            requestLatencyMs: stats.requestLatencyMs,
            candidateCount: stats.candidateCount,
            ok: stats.ok,
            failure: stats.failure,
            costUsd: stats.costUsd,
            httpStatus: stats.httpStatus,
          },
        });
      } catch { /* telemetry never blocks retrieval */ }
    },
    logger: console,
  });
}

/**
 * The built-in reranker as a seam port, for the opt-in hosted fallback.
 * Null when the user has not opted in, so the default hosted failure stays
 * "keep the existing order".
 */
export function buildHostedFallbackPort(): RerankSeamPort | null {
  if (readRerankerSettings().fallbackToLocal !== true) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getLocalReranker } = require('../../rag/LocalReranker');
    const local = getLocalReranker();
    if (!local) return null;
    return { rerank: (q: string, p: string[]) => rerankInSafeBatches(local, q, p) };
  } catch {
    return null;
  }
}

/**
 * The built-in reranker's batch ceiling, mirroring `RERANK_BATCH_SIZE` in
 * ModeHybridRetriever.
 *
 * The fallback CANNOT inherit the caller's batch. The hosted port asks the seam
 * for the whole 30-candidate pool in one call (that is the entire point of its
 * `batchSize`), so when a hosted rerank fails and this port takes over, it is
 * handed all 30 passages at once. Passing those straight to `LocalReranker`
 * would be a 30-pair joint-encoding forward pass — precisely what
 * RERANK_BATCH_SIZE exists to prevent, and what its comment names as the
 * ONNX-arena crash trigger. So the fallback re-chunks on its own behalf.
 */
const LOCAL_FALLBACK_BATCH_SIZE = 6;

async function rerankInSafeBatches(
  local: { rerank(q: string, p: string[]): Promise<Array<{ index: number; score: number }> | null> },
  query: string,
  passages: string[],
): Promise<Array<{ index: number; score: number }> | null> {
  const all: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < passages.length; i += LOCAL_FALLBACK_BATCH_SIZE) {
    const batch = passages.slice(i, i + LOCAL_FALLBACK_BATCH_SIZE);
    const scored = await local.rerank(query, batch);
    // A partial result is worse than none: an unscored candidate sinks to
    // -Infinity in the host's ordering, below chunks the reranker never saw. If
    // any batch fails, abandon the whole fallback and keep the existing order.
    if (!scored || scored.length !== batch.length) return null;
    for (const r of scored) all.push({ index: i + r.index, score: r.score });
  }

  all.sort((a, b) => b.score - a.score);
  return all;
}

// ---------------------------------------------------------------------------
// Local GGUF
// ---------------------------------------------------------------------------

/**
 * Cached per model path: loading a 400MB GGUF per query would be absurd.
 *
 * Held on the PROCESS, not in a module-local — the same rule RerankerRegistry
 * follows, and the one this file's own header warns about. esbuild gives every
 * electron entry its own bundle and INLINES this module into each: a
 * `require('./rerankerConfig')` from ipcHandlers is rewritten to
 * `(init_rerankerConfig(), __toCommonJS(rerankerConfig_exports))` — its own
 * copy, not a runtime load of the shared file. Verified 2026-09-03: 30 built
 * bundles each define `buildLocalGgufPort`, and both ipcHandlers.js and main.js
 * carry their own `var ggufPort`.
 *
 * A module-local therefore meant TWO live llama.cpp contexts: Settings
 * (`reranker:use-local-model` in ipcHandlers) loaded one into its copy, and the
 * retrieval path (RerankerRegistry) then saw its own copy still null and loaded
 * a second — 452 MB apiece at the bounded context size, more before that. Worse,
 * `resetLocalGgufPort()` from Settings only ever cleared the Settings copy, so
 * the retrieval one stayed resident for the life of the process with nothing
 * able to reach it.
 */
const GGUF_PORT_KEY = 'natively.reranker.ggufPort';

type GgufPortEntry = { id: string; port: RerankSeamPort } | null;

function getGgufPort(): GgufPortEntry {
  return peekProcessSingleton<GgufPortEntry>(GGUF_PORT_KEY) ?? null;
}

function setGgufPort(entry: GgufPortEntry): void {
  setProcessSingleton(GGUF_PORT_KEY, entry);
}

/**
 * The seam port for a selected local GGUF model, or null.
 *
 * ONNX selections are handled inside `LocalReranker` (it reads the same setting
 * and swaps its own modelId), so this covers only the runtime Core cannot
 * express that way. Returning null lets the chain fall through to the built-in.
 */
export function buildLocalGgufPort(): RerankSeamPort | null {
  const settings = readRerankerSettings();
  const id = settings.localModelId;

  // Anything that means "a local GGUF is no longer what runs" must release the
  // worker. Switching to OpenRouter or to an extension goes through
  // setRerankerConfig / setExtensionEnabled, never useLocalRerankerModel, so
  // resetLocalGgufPort() is not called on those paths — without this a loaded
  // 438MB llama.cpp context stayed resident for the life of the process even
  // though resolvePort() would never reach it again.
  if (!id || settings.provider === 'openrouter') {
    if (getGgufPort()) resetLocalGgufPort();
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { findCatalogModel } = require('../../rag/rerankerModelCatalog') as typeof import('../../rag/rerankerModelCatalog');
    const model = findCatalogModel(id);
    if (!model || model.runtime !== 'gguf' || !model.supported) {
      if (getGgufPort()) resetLocalGgufPort();
      return null;
    }

    const cached = getGgufPort();
    if (cached?.id === id) return cached.port;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ggufModelFile, companionModelFile } =
      require('./localModelInstaller') as typeof import('./localModelInstaller');
    const file = ggufModelFile(id);
    if (!file) return null;

    // v3.5's scoring MLP ships beside the weights rather than inside them.
    // Without it the port would load and then score nothing, so refuse here
    // instead — the catalogue entry declares the file, and the installer
    // fetched and verified it.
    let projector: string | null = null;
    if (model.scoring === 'listwise') {
      projector = companionModelFile(id, 'projector.safetensors');
      if (!projector) return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GgufReranker } = require('../../rag/GgufReranker') as typeof import('../../rag/GgufReranker');
    // Selection changed: tear the old worker (and its several hundred MB) down.
    void (cached?.port as { dispose?: () => Promise<void> } | undefined)?.dispose?.();
    // 'rank' vs 'yes-no' is a property of the model, not a preference: giving a
    // causal LM to the ranking API is a refusal, and giving a ranking model the
    // yes/no prompt is a meaningless number.
    const created = { id, port: new GgufReranker(file, model.scoring ?? 'rank', projector) };
    setGgufPort(created);
    return created.port;
  } catch {
    return null;
  }
}

/** Drop the cached GGUF port. Called when the selection changes. */
export function resetLocalGgufPort(): void {
  const current = getGgufPort();
  void (current?.port as { dispose?: () => Promise<void> } | undefined)?.dispose?.();
  setGgufPort(null);
}
