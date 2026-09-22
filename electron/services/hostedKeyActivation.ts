// electron/services/hostedKeyActivation.ts
//
// What a pasted hosted API key should turn on, and what it must not.
//
// Natively was the only key that did anything on its own: setNativelyApiKey()
// promotes the reranker to 'natively' and readHostedModel() falls back to the
// managed model. Every other hosted key was written to the credential store and
// then ignored — setOpenrouterApiKey/setJinaApiKey save and return, and both
// retrieval consumers gate on a MODEL as well as a key:
//
//   • readHostedModel returns settings.jinaModel / settings.openrouterModel
//     raw, so a keyed provider with no model chosen fails eligibility as
//     'no-model' and silently falls back to the local cross-encoder.
//   • EmbeddingProviderResolver builds a hosted candidate only under
//     `key && model` — a pasted Voyage key adds NO candidate to the chain.
//
// So the key was accepted and changed nothing, with no symptom: reranking that
// does not happen just leaves the cosine order, and an absent embedding
// candidate falls through to the bundled model. This module decides the
// activation; the callers do the I/O.
//
// ── THE GUARDS ARE THE FEATURE ──────────────────────────────────────────────
//
// setRerankerProviderIfManaged already documents three, and every reason it
// gives is provider-independent, so they apply here unchanged:
//
//   1. Promote only from an AUTO-DEFAULT. An explicit pick is a decision, and
//      replacing it the moment a key is added is a bug this repo has already
//      fixed once on the model side (see AUTO_ASSIGNED_MODEL_IDS).
//   2. Ask the PRIVACY POLICY first. A hosted reranker ships retrieved document
//      text off the machine on the next BACKGROUND query, with nothing invoked
//      by the user; hosted embeddings do the same on the next index. Promoting
//      into a denied scope would also arm itself later, if the scope were ever
//      allowed for an unrelated reason.
//   3. REVERT symmetrically on a cleared key, or the user is left pointed at a
//      provider that cannot authenticate — and a failed rerank keeps the
//      existing order, so nothing surfaces.
//
// And one this module adds, because it is the first to activate a provider
// whose catalogue is fetched rather than curated:
//
//   4. Never store a model id we did not verify exists. OpenRouter's rerank
//      catalogue is live (staticCatalogue: false) and the ids in the original
//      brief did not exist on the real API — see openrouterRerankModels.ts.
//      A failed fetch leaves the setting unset rather than guessing.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
//
// It does not write embeddingMode:'manual'. That would filter the candidate
// list to exactly one entry and delete the fallback chain — "a regression
// wearing the feature's clothes", in the words of the Natively-key test that
// refused to do it for the same reason. Filling in the model and its width is
// what makes a keyed provider usable: the resolver then builds the candidate,
// and for Voyage ranks it above the generic chain. The user gets their key
// used, and still has a chain to fall back to.

export type HostedRerankKeyProvider = 'openrouter' | 'jina';
export type HostedEmbeddingKeyProvider = 'openrouter' | 'voyage';

export interface ActivationEnv {
    /** `reranker.provider` as stored. Absent or 'local' is the auto-default. */
    rerankerProvider?: string;
    /** The embedding model already chosen for the provider in question. */
    embeddingModel?: string;
    /** providerDataScopes.reference_files — gates hosted RERANKING. */
    referenceFilesAllowed: boolean;
    /** providerDataScopes.embeddings — gates hosted EMBEDDING. */
    embeddingsAllowed: boolean;
}

export type ActivationVerdict =
    | 'activate'
    /** The user picked something else. Never replaced. */
    | 'explicit-choice'
    /** The scope forbids this data leaving the device. */
    | 'privacy-denied'
    /** Not a provider this module activates. */
    | 'unsupported';

export interface ActivationDecision {
    verdict: ActivationVerdict;
    /** One line for the log, so a refusal is never silent. */
    reason: string;
}

const RERANK_KEY_PROVIDERS = new Set<string>(['openrouter', 'jina']);
const EMBEDDING_KEY_PROVIDERS = new Set<string>(['openrouter', 'voyage']);

/** Absent or 'local' means nobody has chosen; anything else is a decision. */
const isAutoDefault = (provider?: string): boolean => !provider || provider === 'local';

/**
 * Should a pasted `provider` key make it the active RERANKER?
 *
 * Order matters and mirrors evaluateHostedEligibility: the explicit-choice check
 * runs before privacy, so a user who deliberately picked another provider is
 * told that, not told about a scope that was never going to apply to them.
 */
export function decideRerankerActivation(
    provider: string,
    env: ActivationEnv,
): ActivationDecision {
    if (!RERANK_KEY_PROVIDERS.has(provider)) {
        return { verdict: 'unsupported', reason: `${provider} is not a hosted reranker` };
    }
    if (!isAutoDefault(env.rerankerProvider)) {
        // Re-saving the SAME provider's key is not a replacement, so it stays
        // an activation rather than being refused as an explicit choice.
        if (env.rerankerProvider !== provider) {
            return {
                verdict: 'explicit-choice',
                reason: `reranker is explicitly set to ${env.rerankerProvider}; not replacing it`,
            };
        }
    }
    if (!env.referenceFilesAllowed) {
        return {
            verdict: 'privacy-denied',
            reason: 'reference-file content may not leave this device',
        };
    }
    return { verdict: 'activate', reason: `${provider} key present and reranker is unset` };
}

/**
 * Should a pasted `provider` key fill in the active EMBEDDING model?
 *
 * Gated on the EMBEDDINGS scope, which is a different switch from the
 * reranker's: a user may allow one and deny the other, and conflating them
 * would arm a cloud embed that was explicitly refused.
 */
export function decideEmbeddingActivation(
    provider: string,
    env: ActivationEnv,
): ActivationDecision {
    if (!EMBEDDING_KEY_PROVIDERS.has(provider)) {
        return { verdict: 'unsupported', reason: `${provider} is not a hosted embedder` };
    }
    if (env.embeddingModel && env.embeddingModel.trim()) {
        return {
            verdict: 'explicit-choice',
            reason: `${provider} already has model ${env.embeddingModel}; not replacing it`,
        };
    }
    if (!env.embeddingsAllowed) {
        return { verdict: 'privacy-denied', reason: 'embeddings may not leave this device' };
    }
    return { verdict: 'activate', reason: `${provider} key present and no model chosen` };
}

export interface RevertDecision {
    verdict: 'revert' | 'not-active';
    reason: string;
}

/**
 * A cleared or refused key must undo its own promotion.
 *
 * Keyed on the CURRENT value being this provider rather than on a pre-call
 * snapshot — the same reasoning revertNativelyPromotions records: re-saving a
 * key that was already stored leaves the snapshot reading the same value, so
 * restoring it would restore the broken state.
 */
export function decideRevert(provider: string, env: { rerankerProvider?: string }): RevertDecision {
    return env.rerankerProvider === provider
        ? { verdict: 'revert', reason: `${provider} key cleared; returning the reranker to local` }
        : { verdict: 'not-active', reason: `reranker is not on ${provider}; nothing to revert` };
}

/**
 * The rerank model to store when activating `provider`.
 *
 * Jina is a curated static catalogue, so it resolves with no network. OpenRouter
 * is fetched, and returns null without a catalogue — guard 4: an id we have not
 * seen on the live API is never written.
 */
export function rerankModelForActivation(
    provider: string,
    catalog?: Array<{ id: string; group?: string; free?: boolean; multimodal?: boolean }>,
): string | null {
    if (provider === 'jina') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { defaultHostedModel } = require('../rag/hostedRerankProviders') as typeof import('../rag/hostedRerankProviders');
        return defaultHostedModel('jina');
    }
    if (provider === 'openrouter') {
        if (!Array.isArray(catalog) || catalog.length === 0) return null;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { defaultRerankModel } = require('../rag/openrouterRerankModels') as typeof import('../rag/openrouterRerankModels');
        return defaultRerankModel(catalog as any);
    }
    return null;
}

export interface EmbeddingSelection {
    model: string;
    /**
     * The catalogue's width, for LOGGING and comparison only — deliberately not
     * a value to store.
     *
     * withMeasuredVoyageDims/withMeasuredOpenRouterDims skip the probe entirely
     * when a width is already set (`if (dims > 0) return config`). So writing
     * this number would suppress the measurement, and embedding:set-config
     * measures Voyage even though the catalogue says dimensionsVerified — the
     * curated list is hand-maintained (Voyage publishes no models endpoint) and
     * can go stale, and a wrong width stamps a wrong space key over real
     * vectors, after which every embed fails its length check as a RETRYABLE
     * error and indexing retries forever.
     */
    catalogueDimensions: number;
}

/**
 * The embedding model and width to store when activating `provider`.
 *
 * Returns the MODEL only. The width is never taken from here — see
 * EmbeddingSelection.catalogueDimensions for why storing it would suppress the
 * very measurement that protects the vector space.
 *
 * Only curated entries carrying `dimensionsVerified` are eligible, because an
 * unverified entry is not a model we have ever seen answer. OpenRouter's
 * embedding catalogue is fetched rather than curated, so it has no curated
 * recommendation and returns null here.
 */
export function defaultEmbeddingSelection(provider: string): EmbeddingSelection | null {
    if (!EMBEDDING_KEY_PROVIDERS.has(provider) || provider === 'openrouter') return null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { STATIC_EMBEDDING_MODELS } = require('../rag/embeddingCatalog') as typeof import('../rag/embeddingCatalog');
    const models = (STATIC_EMBEDDING_MODELS as unknown as Record<string, ReadonlyArray<any>>)[provider];
    if (!Array.isArray(models) || models.length === 0) return null;
    const chosen = models.find((m) => m.recommended && m.dimensionsVerified)
        ?? models.find((m) => m.dimensionsVerified);
    if (!chosen) return null;
    const catalogueDimensions = Number(chosen.dimensions);
    if (!Number.isInteger(catalogueDimensions) || catalogueDimensions <= 0) return null;
    // NOTE: the caller stores the model and lets the resolver MEASURE the width.
    return { model: String(chosen.id), catalogueDimensions };
}

// ── Applying the decision ───────────────────────────────────────────────────

/**
 * Everything the applier touches, injected so the decisions above can be tested
 * without a SettingsManager singleton or a network.
 */
export interface ActivationIo {
    getSetting(key: string): unknown;
    setSetting(key: string, value: unknown): boolean;
    /** The live OpenRouter rerank catalogue, or null when it could not be fetched. */
    fetchRerankCatalog(): Promise<Array<{ id: string; group?: string }> | null>;
    log(message: string): void;
}

export interface ActivationOutcome {
    reranker: ActivationVerdict | 'revert' | 'not-active' | 'no-model';
    embedding: ActivationVerdict;
}

const scopes = (io: ActivationIo): { reference_files?: boolean; embeddings?: boolean } =>
    (io.getSetting('providerDataScopes') as { reference_files?: boolean; embeddings?: boolean }) ?? {};

/** Both scopes default to ALLOWED, matching referenceFilesScopeAllowed(). */
const EMBEDDING_MODEL_SETTING: Readonly<Record<string, string>> = Object.freeze({
    voyage: 'voyageEmbeddingModel',
    openrouter: 'openrouterEmbeddingModel',
});

const readEnv = (io: ActivationIo, embeddingProvider?: string): ActivationEnv => {
    const s = scopes(io);
    const reranker = (io.getSetting('reranker') as { provider?: string }) ?? {};
    const modelKey = embeddingProvider ? EMBEDDING_MODEL_SETTING[embeddingProvider] : undefined;
    return {
        rerankerProvider: reranker.provider,
        embeddingModel: modelKey ? ((io.getSetting(modelKey) as string | undefined) ?? undefined) : undefined,
        referenceFilesAllowed: s.reference_files !== false,
        embeddingsAllowed: s.embeddings !== false,
    };
};

/**
 * Turn a pasted (or cleared) hosted key into the retrieval settings it implies.
 *
 * Deliberately returns rather than throws: this runs as a side effect of saving
 * a credential, and a failed activation must never fail the save. Every refusal
 * is logged, because a silent no-op is exactly the bug this module exists to
 * fix.
 *
 * The WIDTH is never written here. The model alone makes the resolver build a
 * candidate and MEASURE the width on the next initialize() — which is what keeps
 * a stale curated number from stamping a wrong space key over real vectors.
 * That measurement is also what makes this a re-index: see
 * embeddingConfigChanged.
 */
export async function applyHostedKeyActivation(
    provider: string,
    opts: { keyPresent: boolean; io?: ActivationIo },
): Promise<ActivationOutcome> {
    const io = opts.io ?? productionIo();
    const outcome: ActivationOutcome = { reranker: 'unsupported', embedding: 'unsupported' };

    // ── Cleared key: undo only what this provider turned on ──
    if (!opts.keyPresent) {
        const env = readEnv(io, provider);
        const revert = decideRevert(provider, env);
        outcome.reranker = revert.verdict;
        io.log(`[hostedKeyActivation] ${provider} key cleared — ${revert.reason}`);
        if (revert.verdict === 'revert') {
            const current = (io.getSetting('reranker') as Record<string, unknown>) ?? {};
            io.setSetting('reranker', { ...current, provider: 'local' });
        }
        // The embedding model is left in place on purpose: it is not a
        // credential, it names the SPACE the existing vectors were built in, and
        // clearing it would re-index the corpus on the way back to the bundled
        // model. The resolver already declines to build a candidate with no key.
        outcome.embedding = 'explicit-choice';
        return outcome;
    }

    // ── Reranker ──
    if (RERANK_KEY_PROVIDERS.has(provider)) {
        const env = readEnv(io, provider);
        const decision = decideRerankerActivation(provider, env);
        outcome.reranker = decision.verdict;
        io.log(`[hostedKeyActivation] reranker/${provider}: ${decision.verdict} — ${decision.reason}`);
        if (decision.verdict === 'activate') {
            let model: string | null = null;
            if (provider === 'jina') {
                model = rerankModelForActivation('jina');
            } else {
                // Guard 4: only an id seen on the live API is ever written. A
                // failed fetch leaves BOTH the provider and the model alone —
                // activating a provider with no model would be 'no-model'
                // ineligible, which is the inert state this feature removes.
                const catalog = await io.fetchRerankCatalog().catch(() => null);
                model = rerankModelForActivation('openrouter', catalog ?? undefined);

                // RE-DECIDE after the await. The verdict above was computed from
                // settings read BEFORE a network round trip, and a key saved
                // during that window would otherwise be overwritten by this
                // stale decision — the user lands on whichever provider's fetch
                // finished last rather than the one they chose last.
                const fresh = decideRerankerActivation(provider, readEnv(io, provider));
                if (fresh.verdict !== 'activate') {
                    outcome.reranker = fresh.verdict;
                    io.log(`[hostedKeyActivation] reranker/${provider}: ${fresh.verdict} on re-check — ${fresh.reason}`);
                    return finishEmbedding(provider, io, outcome);
                }
            }
            if (!model) {
                outcome.reranker = 'no-model';
                io.log(`[hostedKeyActivation] reranker/${provider}: no verified model id — leaving the provider unset`);
            } else {
                const current = (io.getSetting('reranker') as Record<string, unknown>) ?? {};
                const modelKey = provider === 'jina' ? 'jinaModel' : 'openrouterModel';
                // A model already stored for THIS provider is the user's pick and
                // outranks the recommendation. The auto-default guard above only
                // protects the PROVIDER, so without this a key rotation — or a
                // re-paste after a failed test — silently replaced a deliberately
                // chosen model. That is the bug AUTO_ASSIGNED_MODEL_IDS records
                // being fixed once already, one setting over.
                const existing = current[modelKey];
                const keep = typeof existing === 'string' && existing.trim() ? existing : null;
                io.setSetting('reranker', { ...current, provider, [modelKey]: keep ?? model });
                io.log(keep
                    ? `[hostedKeyActivation] reranker provider set to ${provider}; keeping your model ${keep}`
                    : `[hostedKeyActivation] reranker provider set to ${provider} with ${model}`);
            }
        }
    }

    return finishEmbedding(provider, io, outcome);
}

/**
 * The embedding half, split out so a reranker verdict that returns early still
 * runs it — the two halves are independent and gated by different scopes.
 */
function finishEmbedding(provider: string, io: ActivationIo, outcome: ActivationOutcome): ActivationOutcome {
    if (EMBEDDING_KEY_PROVIDERS.has(provider)) {
        const env = readEnv(io, provider);
        const decision = decideEmbeddingActivation(provider, env);
        outcome.embedding = decision.verdict;
        io.log(`[hostedKeyActivation] embedding/${provider}: ${decision.verdict} — ${decision.reason}`);
        if (decision.verdict === 'activate') {
            const selection = defaultEmbeddingSelection(provider);
            if (!selection) {
                // OpenRouter: the catalogue is fetched and its widths are
                // measured, so there is no curated default to adopt. The panel's
                // own flow still applies; nothing is guessed here.
                io.log(`[hostedKeyActivation] embedding/${provider}: no curated default — leaving it to the panel`);
            } else {
                const key = EMBEDDING_MODEL_SETTING[provider];
                io.setSetting(key, selection.model);
                io.log(
                    `[hostedKeyActivation] ${key} set to ${selection.model} `
                    + `(catalogue says ${selection.catalogueDimensions}d; the real width is MEASURED on the next index, `
                    + `and this change re-indexes the corpus)`,
                );
            }
        }
    }

    return outcome;
}

function productionIo(): ActivationIo {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SettingsManager } = require('./SettingsManager');
    const settings = SettingsManager.getInstance();
    return {
        getSetting: (k) => settings.get(k),
        setSetting: (k, v) => settings.set(k, v) !== false,
        fetchRerankCatalog: async () => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { listOpenRouterRerankModels } = require('../rag/openrouterRerankModels');
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { CredentialsManager } = require('./CredentialsManager');
                const apiKey = CredentialsManager.getInstance().getOpenrouterApiKey?.();
                if (!apiKey) return null;
                const models = await listOpenRouterRerankModels({ apiKey });
                return Array.isArray(models) && models.length > 0 ? models : null;
            } catch {
                return null;
            }
        },
        log: (m) => console.log(m),
    };
}
