import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';
import { DocType, KnowledgeDocument, ContextNode, KnowledgeStatus, StructuredResume, StructuredJD, IntentType, CompanyDossier, ProcessedResumeData, SKILL_CATEGORIES, SkillCategory, PROFILE_SCHEMA_VERSION, ResumeSalaryEstimate } from './types';
import { coerceSkills, flattenSkills, detectSkillCategories, isLegacyFlatSkills } from './skillsUtil';
import { buildGroundingBlock } from './ProfileContextBuilder';
import { isProfileGroundingV2Enabled, isProfileGroundingV2JdFitCoverageEnabled } from '../../../electron/llm/profileGroundingV2';
import { planAnswer, isJdFactualLookupNotNegotiationAdvice } from '../../../electron/llm/AnswerPlanner';
import { isIntelligenceFlagEnabled } from '../../../electron/intelligence/intelligenceFlags';
import { isLayerAllowed } from '../../../electron/llm/contextRoute';
import { extractDocumentText } from './DocumentReader';
import { extractStructuredData } from './StructuredExtractor';
import { heuristicResumeExtract, heuristicJDExtract } from './HeuristicExtractor';
import { chunkAndEmbedDocument } from './DocumentChunker';
import { processResume } from './PostProcessor';
import { normalizeStructuredResume } from './StructuredResumeNormalizer';
import { normalizeStructuredJD } from './StructuredJDNormalizer';

// Compensation hints come from the LLM extractor and occasionally emit "--"
// between two numbers (e.g. "₹35--55 LPA"). Collapse any run of 2+ hyphens
// to a single en-dash so the UI never shows "--". Applied at the read
// boundary in getProfileData — the stored structured_data is left untouched
// so dossier / prompt-context still see the original.
const normalizeCompensationHint = (raw: unknown): string => {
    if (raw == null || raw === '') return '';
    const s = String(raw);
    return s
        .replace(/-{2,}/g, '–')          // ₹35--55 LPA → ₹35–55 LPA
        .replace(/\s+–\s+/g, ' – ');     // tidy spacing around the dash
};
import { getRelevantNodes, formatDossierBlock, detectCategoryHints } from './HybridSearchEngine';
import { assemblePromptContext, PromptAssemblyResult } from './ContextAssembler';
import { classifyIntent, classifyIntentWithContext, needsCompanyResearch, isGenericKnowledgeQuestion, INTRO_PATTERNS, looksLikeGarbledComp } from './IntentClassifier';
import { CompanyResearchEngine, jdContextFromStructured, SearchProvider } from './CompanyResearchEngine';
import { TechnicalDepthScorer } from './TechnicalDepthScorer';
import { AOTPipeline } from './AOTPipeline';
import { generateStarStories, generateStarStoryNodes } from './StarStoryGenerator';
import { generateMockQuestions } from './MockInterviewGenerator';
import { findRelevantValueAlignments, formatValueAlignmentBlock, CultureMappingResult } from './CultureValuesMapper';
import { SalaryIntelligenceEngine } from './SalaryIntelligenceEngine';
import { NegotiationConversationTracker, escapeXml } from './NegotiationConversationTracker';
import { generateLiveCoachingResponse } from './LiveNegotiationAdvisor';
import { RoleInsightDatabase } from './roleInsight/RoleInsightDatabase';
import { RoleInsightService } from './roleInsight/RoleInsightService';

export class KnowledgeOrchestrator {
    private db: KnowledgeDatabaseManager;
    private knowledgeModeActive: boolean = false;
    private depthScorer: TechnicalDepthScorer;
    private aotPipeline: AOTPipeline;
    private salaryEngine: SalaryIntelligenceEngine;
    private negotiationTracker: NegotiationConversationTracker;

    // Cached state for fast retrieval
    private activeResume: KnowledgeDocument | null = null;
    private activeJD: KnowledgeDocument | null = null;
    private cachedNodes: ContextNode[] = [];

    // Conversational negotiation stickiness: the timestamp of the last turn that
    // classified as NEGOTIATION. While recent (within the window), ambiguous
    // follow-ups ("what are your expectations?", "give me the number") stay
    // negotiation-aware so the salary intelligence keeps applying across a
    // multi-turn comp conversation instead of being lost per-utterance.
    private _lastNegotiationTurnAt = 0;
    private static readonly NEGOTIATION_STICKY_WINDOW_MS = 4 * 60 * 1000; // 4 min
    // Decay (not just wall-clock): count consecutive substantive non-comp turns
    // since the last negotiation turn. After this many, stickiness is dropped even
    // if still inside the time window — prevents a behavioral/fit detour mid-thread
    // from inheriting comp routing for the full 4 minutes.
    private _nonCompTurnsSinceNegotiation = 0;
    private static readonly NEGOTIATION_DECAY_TURNS = 2;
    /** Memoized result of processResume() keyed on the resume document's DB id. */
    private _processedResumeCache: { docId: number | null; result: ProcessedResumeData } | null = null;

    // Injected dependencies
    private generateContentFn: ((contents: any[]) => Promise<string>) | null = null;
    // Latency-critical LLM fn for LIVE negotiation coaching (spoken in real time).
    // Wired to a Flash-first generation chain so the live tactical note appears
    // fast; falls back to generateContentFn when unset. The AOT negotiation SCRIPT
    // and all extraction keep using the quality-first generateContentFn.
    private liveCoachingContentFn: ((contents: any[]) => Promise<string>) | null = null;
    private embedFn: ((text: string) => Promise<number[]>) | null = null;
    /**
     * Document embedder that also reports WHICH SPACE produced the vector.
     *
     * Ingest used to snapshot `activeSpaceFn()` BEFORE embedding and stamp every
     * saved node with that value. If the embedding pipeline degraded cloud->local
     * partway through (the single-embedding fallback), local vectors were
     * persisted labelled as cloud-space vectors — and retrieval then computed
     * cosine similarity across two incompatible spaces, silently, with no error.
     *
     * When set, ingest stamps each node with the space its OWN vector came from.
     * Optional: unset keeps the legacy embedFn + activeSpaceFn behaviour.
     */
    private embedWithMetadataFn: ((text: string) => Promise<{
        embedding: number[];
        space?: string | null;
        provider?: string | null;
        dimensions?: number | null;
    }>) | null = null;
    // Batch counterpart, optional: one provider request per batch of node texts at ingest.
    private embedBatchWithMetadataFn: ((texts: string[]) => Promise<{ embeddings: number[][]; space?: string | null }>) | null = null;
    // Cloud QUERY embedder (asymmetric — applies the retrieval task prefix, e.g.
    // Gemini v2 `task: search result | query:`). Produces vectors in the SAME space
    // as embedFn (same model/dims/endpoint, only the task framing differs), so it's
    // space-safe to use for queries while documents use embedFn. Optional — when
    // unset, the cloud query path falls back to embedFn (document framing).
    private embedQueryFn: ((text: string) => Promise<number[]>) | null = null;
    // Fast on-device query embedder (bundled MiniLM, ~10ms) used for the
    // latency-critical query path INSTEAD of embedFn (which may be a ~100-200ms
    // cloud call). Only used when its output dimension matches the indexed
    // nodes' dimension — otherwise cosine similarity silently returns 0 (see
    // HybridSearchEngine), so we fall back to embedFn. Returns null on failure.
    private fastQueryEmbedFn: (() => { dimensions: number | null; space?: string | null; embed: (text: string) => Promise<number[] | null> }) | null = null;
    /**
     * Returns the active document-embedder's composite space key (`${name}:${model}:${dims}`),
     * matching what embedFn produces. Used to (a) stamp ingested nodes, (b) detect nodes
     * embedded in an OLD space and re-embed them, (c) gate retrieval to space-matching nodes
     * so a v1 node is never cosine-compared against a v2 query. Undefined when the pipeline
     * isn't ready — callers then skip the space gate (best-effort, same as pre-feature).
     */
    private activeSpaceFn: (() => string | undefined) | null = null;
    /** Guards against concurrent re-embed passes. */
    private _reembedInFlight = false;
    /**
     * Wall-clock of the last COMPLETED convergence attempt. Used to debounce rapid
     * re-convergence: refreshCache fires on every ingest + the startup kick, and a
     * flapping cloud would otherwise re-embed the whole corpus local↔cloud on each
     * fire. Within the debounce window, if the corpus is already fully in a committed
     * space we skip the attempt (it would be redundant). A genuine pending re-embed
     * (stale nodes) always runs regardless of the window. Tiny corpus, so this is a
     * cost-smoothing nicety, not a correctness gate.
     */
    private _lastConvergeAt = 0;
    private static readonly REEMBED_DEBOUNCE_MS = 60_000;
    /**
     * The embedding space the knowledge corpus is COMMITTED to — i.e. the space
     * ensureEmbeddingSpace last converged all embedded nodes into. Normally equals
     * the active (cloud) space; degrades to the LOCAL space when the cloud embedder
     * is unavailable, so retrieval keeps working (lower quality) instead of going
     * silently empty. Retrieval gating + query embedding both key off THIS, not the
     * raw active space — that's what keeps the gate, the stored vectors, and the
     * query vector all in one consistent space. Undefined until the first convergence;
     * _committedIndexSpace() derives a safe value in the meantime.
     */
    private _indexSpace: string | undefined = undefined;

    // Phase 1: transcript-aware intent hint. The app layer (which owns the
    // SessionTracker / rolling ~180s transcript) registers a provider that
    // returns a lightweight verdict so the premium package never imports
    // app-layer state. Used to recognize a comp thread even where the live
    // NegotiationConversationTracker isn't fed interviewer STT (e.g. typed chat).
    private conversationContextProvider:
        (() => { recentInterviewerComp?: boolean; lastInterviewerTurn?: string } | null) | null = null;

    // Company research engine
    private companyResearch: CompanyResearchEngine;

    // Resolves the current company-research search provider (Tavily key →
    // Natively key → null) at AOT time. Injected by the app layer (main.ts)
    // like setGenerateContentFn, so the premium package never imports
    // CredentialsManager. Resolved PER RUN — not once at startup — because
    // keys can be added, changed, or removed mid-session.
    private searchProviderResolver: (() => SearchProvider | null) | null = null;

    // Is company research contextually appropriate right now? Injected by the
    // app layer (main.ts) like setSearchProviderResolver, so this package never
    // imports ModesManager. Resolved PER CALL — the user switches modes
    // mid-session, and a cached verdict would be wrong the moment they do.
    //
    // UNSET means allow, so a host that does not wire this keeps today's
    // behaviour byte for byte. The host opts in; the submodule never narrows
    // behaviour on its own.
    private companyResearchAllowedFn: (() => boolean) | null = null;

    // Role Insight (2026-08-04). Attached by the app layer with the raw sqlite
    // handle — the orchestrator only holds a KnowledgeDatabaseManager, and Role
    // Insight owns tables that manager does not know about. Lazily constructed
    // so a build without the feature (or a DB that failed to open) simply has
    // no service, and every consumer null-checks.
    private roleInsightService: RoleInsightService | null = null;

    constructor(db: KnowledgeDatabaseManager) {
        this.db = db;
        this.db.initializeSchema();
        this.companyResearch = new CompanyResearchEngine(db);
        this.depthScorer = new TechnicalDepthScorer();
        this.aotPipeline = new AOTPipeline(db, this.companyResearch);
        this.salaryEngine = new SalaryIntelligenceEngine();
        this.negotiationTracker = new NegotiationConversationTracker();
        this.refreshCache();
        // P2-5: do NOT seed the tracker from a cached script at construction time.
        // The script belongs to whatever JD was last persisted (possibly from a prior
        // session for a completely different company). Seeding here would contaminate a
        // fresh negotiation with stale target data.
        // The tracker target is set only when AOT completes for the *current* JD
        // (see the aotPipeline.runForJD callback in ingestDocument).
    }

    // ============================================
    // Configuration
    // ============================================

    setGenerateContentFn(fn: (contents: any[]) => Promise<string>): void {
        this.generateContentFn = fn;
        this.companyResearch.setGenerateContentFn(fn);
        this.aotPipeline.setGenerateContentFn(fn);
    }

    /**
     * Register the search-provider resolver for AOT company research. Without
     * this, the automatic JD-upload pipeline runs with whatever provider the
     * manual research button happened to leave on the shared engine (usually
     * none) and every dossier silently degrades to LLM-only guesswork.
     */
    setSearchProviderResolver(fn: () => SearchProvider | null): void {
        this.searchProviderResolver = fn;
    }

    /**
     * Register the "is company research appropriate in the active mode?"
     * predicate.
     *
     * WHY THIS EXISTS (routing audit, 2026-09-04). The dossier gate in
     * `processQuestion` was `needsCompanyResearch(question) && this.activeJD`,
     * with no notion of the active mode. `needsCompanyResearch` is a substring
     * test over COMPANY_RESEARCH_PATTERNS — which contains the bare tokens
     * `company`, `reviews` and `funding` — OR'd with a NEGOTIATION verdict. The
     * second condition is only that a JD happens to be loaded, and a JD
     * persists across sessions and across modes.
     *
     * So a Team Meet turn containing "reviews", or a Lecture turn containing
     * "funding", could reach `researchCompany` and put a query on the wire to an
     * external search provider, in a mode that has nothing to do with hiring.
     *
     * The waste is provable, not speculative. The host discards the entire
     * knowledge result in exactly those modes: LLMHelper gates consumption on
     * `isPremiumKnowledgeInterceptAllowed()`, which excludes technical-interview,
     * team-meet, lecture, seminar and call-center. The gate runs AFTER
     * `processQuestion` has already returned, so the research had already
     * happened and its output was then thrown away. The call could never affect
     * the answer; it could only leak the query and spend the budget.
     *
     * This narrows the five modes where the result is provably unused. It does
     * NOT touch general, sales, recruiting or looking-for-work, where the
     * dossier IS consumed and company research is plausibly intended. Tightening
     * the keyword list itself is a separate product decision and is deliberately
     * not made here.
     */
    setCompanyResearchAllowedFn(fn: () => boolean): void {
        this.companyResearchAllowedFn = fn;
    }

    /** Unset, or a throwing predicate, means allow — see setCompanyResearchAllowedFn. */
    private isCompanyResearchAllowed(): boolean {
        if (!this.companyResearchAllowedFn) return true;
        try {
            return this.companyResearchAllowedFn() !== false;
        } catch {
            // A broken host predicate must never silently disable a paid
            // capability. Fail OPEN, matching the unset default.
            return true;
        }
    }

    /**
     * Optional low-latency generation fn for LIVE negotiation coaching only.
     * When set, the live tactical-note path uses it (Flash-first) so the spoken
     * coaching appears fast; everything else keeps the quality-first fn. Safe to
     * leave unset — the live path falls back to generateContentFn.
     */
    setLiveCoachingContentFn(fn: (contents: any[]) => Promise<string>): void {
        this.liveCoachingContentFn = fn;
    }

    setEmbedFn(fn: (text: string) => Promise<number[]>): void {
        this.embedFn = fn;
    }

    /**
     * Register the metadata-returning document embedder. Ingest prefers this over
     * setEmbedFn so a mid-ingest provider degrade is recorded per node instead of
     * being papered over with the space that was active before the call.
     */
    /** One provider request for many texts, reporting the space that produced them. Optional. */
    setEmbedBatchWithMetadataFn(fn: (texts: string[]) => Promise<{ embeddings: number[][]; space?: string | null }>): void {
        this.embedBatchWithMetadataFn = fn;
    }

    setEmbedWithMetadataFn(fn: (text: string) => Promise<{
        embedding: number[];
        space?: string | null;
        provider?: string | null;
        dimensions?: number | null;
    }>): void {
        this.embedWithMetadataFn = fn;
    }

    /**
     * Register the cloud QUERY embedder (asymmetric retrieval framing). Must produce
     * vectors in the SAME embedding space as setEmbedFn's document embedder — same
     * provider/model/dims, only the task prefix differs (e.g. Gemini v2's
     * `task: search result | query:` vs the document's `title: | text:`). Optional;
     * when unset the cloud query path uses embedFn (document framing) as before.
     */
    setEmbedQueryFn(fn: (text: string) => Promise<number[]>): void {
        this.embedQueryFn = fn;
    }

    /**
     * Register a function returning the active document-embedder's composite space key.
     * Enables space-aware re-embedding + retrieval gating (the v1/v2 fix). Optional —
     * when unset, behavior falls back to the prior dimension-only guard.
     */
    setActiveSpaceFn(fn: () => string | undefined): void {
        this.activeSpaceFn = fn;
    }

    /**
     * Phase 1: register the transcript-aware conversation-context provider. The
     * app layer reads the rolling ~180s transcript (SessionTracker), inspects the
     * last 1-2 INTERVIEWER turns for comp evidence, and returns a small verdict.
     * Called synchronously at classification time in processQuestion. Optional —
     * when unset, routing falls back to the tracker + sticky-window heuristics.
     */
    setConversationContextProvider(
        fn: () => { recentInterviewerComp?: boolean; lastInterviewerTurn?: string } | null,
    ): void {
        this.conversationContextProvider = fn;
    }

    /**
     * Register a fast on-device query embedder (bundled MiniLM) for the
     * latency-critical retrieval path. The provider reports its `dimensions` so
     * processQuestion can dimension-check against the indexed nodes BEFORE using
     * it; on mismatch (e.g. resume indexed with a 1536d cloud model) it falls
     * back to embedFn so cosine similarity is never computed across mismatched
     * vector spaces. `embed` resolves null on any failure → caller falls back.
     */
    setFastQueryEmbedFn(fn: () => { dimensions: number | null; space?: string | null; embed: (text: string) => Promise<number[] | null> }): void {
        this.fastQueryEmbedFn = fn;
    }

    /**
     * The space the corpus is COMMITTED to for retrieval. Prefers the converged
     * `_indexSpace`; before the first convergence, derives a safe value: the active
     * (cloud) space if known, else the most common space among already-embedded
     * nodes (handles a degraded launch where the cloud probe failed but the corpus
     * is already entirely in the local space). Returns undefined only when there's
     * nothing to gate against (empty/unembedded corpus AND no active space).
     */
    private _committedIndexSpace(): string | undefined {
        if (this._indexSpace) return this._indexSpace;
        const active = this.activeSpaceFn?.();
        if (active) return active;
        // No active space (pipeline not ready). Fall back to whatever space the
        // embedded nodes are actually in, so a degraded-but-consistent corpus is
        // still searchable. Pick the majority space among embedded nodes.
        const counts = new Map<string, number>();
        for (const n of this.cachedNodes) {
            if (n.embedding && n.embedding_space) counts.set(n.embedding_space, (counts.get(n.embedding_space) ?? 0) + 1);
        }
        let best: string | undefined; let bestN = 0;
        for (const [space, n] of counts) if (n > bestN) { best = space; bestN = n; }
        return best;
    }

    /**
     * Nodes eligible for retrieval scoring: those embedded in the COMMITTED index
     * space. Keyword-only nodes (no embedding) always survive. Nodes in any OTHER
     * space (stale v1, or mid-migration) are EXCLUDED so they can't be cosine-
     * compared against a query vector produced in the committed space. When no
     * committed space can be derived (empty corpus), don't gate (nothing to protect).
     */
    private _spaceGatedNodes(): ContextNode[] {
        const indexSpace = this._committedIndexSpace();
        if (!indexSpace) return this.cachedNodes; // nothing embedded → nothing to gate
        return this.cachedNodes.filter(n => !n.embedding || n.embedding_space === indexSpace);
    }

    /**
     * Resolve the embedder for the QUERY. The query vector MUST be produced in the
     * COMMITTED index space (what _spaceGatedNodes filters to), otherwise it would be
     * cosine-compared across incompatible spaces (same-dim/different-space = silent
     * garbage). So we pick the embedder whose space equals the committed index space:
     *
     *   - committed == local space  → use the fast local embedder. If it returns null
     *     we return [] (NOT a cloud fallback — that would be cross-space).
     *   - committed == cloud space   → use the fast local ONLY if its space happens to
     *     equal the committed space (it won't, normally), else the cloud query embedder.
     *   - committed unknown          → legacy dimension check, then prefer fast local.
     *
     * The cloud branch prefers the asymmetric QUERY embedder (embedQueryFn — applies
     * the retrieval task prefix) over the document embedFn. Both produce the same
     * space (same model/dims), so this is space-safe and improves retrieval relevance.
     */
    private cloudQueryEmbedder(): ((text: string) => Promise<number[]>) | null {
        const raw = this.embedQueryFn ?? this.embedFn;
        if (!raw) return null;
        // RC5 (Profile Intelligence production-fix round 2, 2026-07-05): the
        // cloud query embed sits on the manual-answer HOT PATH. A provider
        // 429/cooldown turned one processQuestion into a 1986ms stall (real
        // session evidence) before the answer could even dispatch. Budget it:
        // past QUERY_EMBED_BUDGET_MS we resolve [] — retrieval then returns
        // zero nodes and the existing zero-node fallback pack (structured
        // experience/achievement seeding) grounds the answer instead. We do
        // NOT fall back to the local embedder here: its vectors are a
        // different space than the committed cloud index and would be
        // silently-garbage cosine comparisons (see resolveQueryEmbedder doc).
        const QUERY_EMBED_BUDGET_MS = 300;
        return async (text: string): Promise<number[]> => {
            try {
                const result = await Promise.race([
                    raw(text),
                    new Promise<number[]>((resolve) => setTimeout(() => resolve([]), QUERY_EMBED_BUDGET_MS)),
                ]);
                return Array.isArray(result) ? result : [];
            } catch {
                return [];
            }
        };
    }

    /**
     * Batch-analysis variant of resolveQueryEmbedder (F1, code review
     * 2026-08-05): SAME space-selection rules — never compare vectors across
     * embedding spaces — but NONE of the hot-path ergonomics. The 300ms
     * QUERY_EMBED_BUDGET_MS and its resolve-[] semantics exist because the
     * manual answer path must never stall; Role Insight's analysis pipeline is
     * the opposite trade: latency-tolerant and correctness-critical. An empty
     * vector silently zeroes semantic retrieval, which manufactures false
     * "missing capability" gaps — the worst failure the feature has, and one
     * that then leaks into live interview answers via getLiveEvidence. Here
     * errors and empties PROPAGATE so EvidenceRetriever can log and degrade
     * per-requirement, visibly.
     */
    private resolveBatchQueryEmbedder(): ((text: string) => Promise<number[]>) | null {
        const indexSpace = this._committedIndexSpace();
        const fast = this.fastQueryEmbedFn ? this.fastQueryEmbedFn() : null;
        const fastUsable = !!fast && fast.dimensions != null;
        const cloudRaw = this.embedQueryFn ?? this.embedFn;

        const strict = (embed: (text: string) => Promise<number[] | null>) =>
            async (text: string): Promise<number[]> => {
                const v = await embed(text);
                if (!Array.isArray(v) || v.length === 0) {
                    throw new Error('embedder returned no vector');
                }
                return v;
            };

        if (indexSpace) {
            if (fastUsable && fast!.space && fast!.space === indexSpace) {
                return strict(fast!.embed);
            }
            return cloudRaw ? strict(cloudRaw) : null;
        }
        if (!fastUsable) return cloudRaw ? strict(cloudRaw) : null;
        const indexedDim = this.cachedNodes.find(n => n.embedding && n.embedding.length > 0)?.embedding?.length ?? null;
        if (indexedDim != null && indexedDim !== fast!.dimensions) {
            return cloudRaw ? strict(cloudRaw) : null;
        }
        const fastEmbed = fast!.embed;
        return async (text: string): Promise<number[]> => {
            const v = await fastEmbed(text);
            if (Array.isArray(v) && v.length > 0) return v;
            if (cloudRaw) return strict(cloudRaw)(text);
            throw new Error('no embedder produced a vector');
        };
    }

    private resolveQueryEmbedder(): ((text: string) => Promise<number[]>) | null {
        const indexSpace = this._committedIndexSpace();
        const fast = this.fastQueryEmbedFn ? this.fastQueryEmbedFn() : null;
        const fastUsable = !!fast && fast.dimensions != null;

        // Committed-space known: choose the embedder that produces THAT space.
        if (indexSpace) {
            if (fastUsable && fast!.space && fast!.space === indexSpace) {
                // Local IS the committed space (degraded mode, or local-only install).
                // Never fall back to cloud here — its vectors are a different space.
                const fastEmbed = fast!.embed;
                return async (text: string): Promise<number[]> => {
                    const v = await fastEmbed(text);
                    return (Array.isArray(v) && v.length > 0) ? v : [];
                };
            }
            // Otherwise the cloud query embedder produces the committed (cloud) space.
            return this.cloudQueryEmbedder();
        }

        // Committed space unknown (empty/unembedded corpus, pipeline not ready) →
        // legacy dimension guard so we never compare across mismatched dimensions.
        if (!fastUsable) return this.cloudQueryEmbedder();
        const indexedDim = this.cachedNodes.find(n => n.embedding && n.embedding.length > 0)?.embedding?.length ?? null;
        if (indexedDim != null && indexedDim !== fast!.dimensions) {
            return this.cloudQueryEmbedder();
        }
        const fastEmbed = fast!.embed;
        const fallback = this.cloudQueryEmbedder();
        return async (text: string): Promise<number[]> => {
            const v = await fastEmbed(text);
            if (Array.isArray(v) && v.length > 0) return v;
            if (fallback) return fallback(text);
            return [];
        };
    }

    setKnowledgeMode(enabled: boolean): void {
        // V2 (RC-8): a JD-only session (no resume yet) is a valid grounded state —
        // JD questions ground on the JD alone. Legacy still requires a resume.
        const hasGroundableDoc = isProfileGroundingV2Enabled()
            ? (this.activeResume !== null || this.activeJD !== null)
            : (this.activeResume !== null);
        if (enabled && !hasGroundableDoc) {
            console.warn('[KnowledgeOrchestrator] Cannot enable knowledge mode: no resume or JD loaded');
            return;
        }
        this.knowledgeModeActive = enabled;
        console.log(`[KnowledgeOrchestrator] Knowledge mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }

    isKnowledgeMode(): boolean {
        // V2: knowledge mode is valid with a resume OR a JD. Legacy: resume only.
        if (isProfileGroundingV2Enabled()) {
            return this.knowledgeModeActive && (this.activeResume !== null || this.activeJD !== null);
        }
        return this.knowledgeModeActive && this.activeResume !== null;
    }

    /**
     * Get the company research engine for external use (e.g., IPC handlers).
     */
    getCompanyResearchEngine(): CompanyResearchEngine {
        return this.companyResearch;
    }

    /**
     * OKF Profile Intelligence upgrade (2026-07-02): generate + persist the
     * profile OKF Knowledge Pack for the active resume/JD from already-extracted
     * structured_data + AOT artifacts. ADDITIVE and fully isolated: reached via
     * lazy require (so a load-time failure of the shared stack can never break
     * premium module load), gated behind okfProfilePacks, wrapped so it NEVER
     * throws into or slows the ingest path. Chunk/node retrieval, the fast path,
     * grounding V2, and AOT all keep working when this no-ops.
     */
    private _generateProfileOkfPack(kind: 'resume' | 'jd', force = false): void {
        try {
            const mod = require('../../../electron/services/knowledge/ProfilePackBuilder') as typeof import('../../../electron/services/knowledge/ProfilePackBuilder');
            const builder = mod.ProfilePackBuilder.getInstance();
            if (kind === 'resume') {
                if (!this.activeResume) return;
                const processed = this.getProcessedResume();
                builder.generateForProfile({
                    kind: 'resume',
                    docId: this.activeResume.id ?? 'resume',
                    structuredData: this.activeResume.structured_data,
                    totalExperienceYears: processed?.totalExperienceYears ?? 0,
                }, force);
            } else {
                if (!this.activeJD) return;
                builder.generateForProfile({
                    kind: 'jd',
                    docId: this.activeJD.id ?? 'jd',
                    structuredData: this.activeJD.structured_data,
                    artifacts: {
                        gapAnalysis: this.getGapAnalysis(),
                        negotiationScript: this.getNegotiationScript(),
                        mockQuestions: this.getMockQuestions(),
                        cultureMappings: this.getCultureMappings(),
                        intro: this.activeJD?.id ? this.db.getIntro(this.activeJD.id) : null,
                    },
                }, force);
            }
        } catch (err: any) {
            // Best effort — the OKF profile layer must never affect ingest.
            console.warn('[KnowledgeOrchestrator] profile OKF pack generation skipped:', err?.message || err);
        }
    }

    /**
     * Get the AOT pipeline for status and results.
     */
    getAOTPipeline(): AOTPipeline {
        return this.aotPipeline;
    }

    // ============================================
    // Role Insight
    // ============================================

    /**
     * Attach Role Insight to the same SQLite file the knowledge engine uses.
     *
     * Called once from the app layer with the raw handle. Idempotent — a second
     * call is a no-op — and non-fatal: a failure here disables Role Insight and
     * leaves every other Profile Intelligence feature untouched.
     */
    attachRoleInsight(rawDb: any): void {
        if (this.roleInsightService) return;
        try {
            const riDb = new RoleInsightDatabase(rawDb);
            riDb.initializeSchema();
            this.roleInsightService = new RoleInsightService({
                db: riDb,
                getResumeDoc: () => this.activeResume,
                getJdDoc: () => this.activeJD,
                // Space-gated, exactly as the answer path retrieves: nodes embedded
                // in a stale space must not be cosine-compared against fresh query
                // vectors here either.
                getNodes: () => this._spaceGatedNodes(),
                generateContentFn: async (contents: any[]) => {
                    if (!this.generateContentFn) throw new Error('Analysis model is not configured.');
                    return this.generateContentFn(contents);
                },
                // Resolved per CALL, not captured once: the embedder choice can
                // change mid-session. Uses the BATCH variant — the hot-path
                // resolveQueryEmbedder carries a 300ms budget that resolves an
                // EMPTY vector, which for an analysis run silently disables
                // semantic retrieval and fabricates false gaps (F1).
                embedFn: async (text: string) => {
                    const embedder = this.resolveBatchQueryEmbedder();
                    if (!embedder) throw new Error('No embedding pipeline available');
                    return embedder(text);
                },
                getSearchProvider: () => this.searchProviderResolver?.() ?? null,
                appendProfileEvidence: (claim, label) => this._appendUserConfirmedEvidence(claim, label),
                // Semantic-admission gate (Phase 1): resolved per CALL like
                // embedFn — the committed space can change mid-session (cloud →
                // local degrade), and a floor calibrated for the wrong space is
                // exactly the cross-space hazard the space keys exist to prevent.
                getEmbeddingSpaceKey: () => this._committedIndexSpace() ?? null,
            });
            console.log('[KnowledgeOrchestrator] Role Insight attached');
        } catch (e: any) {
            console.error('[KnowledgeOrchestrator] Failed to attach Role Insight:', e?.message);
            this.roleInsightService = null;
        }
    }

    getRoleInsightService(): RoleInsightService | null {
        return this.roleInsightService;
    }

    /**
     * Persist a user-confirmed claim as a first-class, embedded context node so
     * it is retrievable by the WHOLE app, not just Role Insight.
     *
     * Reached ONLY from RoleInsightService.saveToProfile, which the UI calls
     * behind an explicit second confirmation. Tagged `user_confirmed` so its
     * provenance stays distinguishable from résumé-extracted content forever.
     */
    private async _appendUserConfirmedEvidence(claim: string, label: string): Promise<boolean> {
        try {
            if (!this.activeResume?.id) {
                console.warn('[KnowledgeOrchestrator] Cannot append confirmed evidence: no active résumé.');
                return false;
            }
            let embedding: number[] | undefined;
            // Same producer-space rule as ingest: stamp what actually made the
            // vector, not whatever space happened to be active at save time.
            let embeddingSpace: string | undefined;
            if (this.embedWithMetadataFn || this.embedFn) {
                try {
                    if (this.embedWithMetadataFn) {
                        const r = await this.embedWithMetadataFn(claim);
                        embedding = r?.embedding;
                        embeddingSpace = r?.space ?? undefined;
                    } else {
                        embedding = await this.embedFn!(claim);
                        embeddingSpace = this.activeSpaceFn?.();
                    }
                } catch (e: any) {
                    // A node without an embedding is still lexically matchable and
                    // still readable by the user. Losing the confirmation entirely
                    // because the embedder was down would be worse.
                    console.warn('[KnowledgeOrchestrator] Confirmed evidence saved without an embedding:', e?.message);
                }
            }
            this.db.saveNodes([{
                source_type: DocType.RESUME,
                category: 'experience',
                title: label,
                text_content: claim,
                tags: ['user_confirmed', 'role_insight'],
                embedding,
                embedding_space: embedding ? (embeddingSpace ?? this.activeSpaceFn?.()) : undefined,
            }], this.activeResume.id);
            this.refreshCache();
            return true;
        } catch (e: any) {
            console.error('[KnowledgeOrchestrator] Failed to append confirmed evidence:', e?.message);
            return false;
        }
    }

    /**
     * Get cached gap analysis from AOT pipeline or DB.
     */
    getGapAnalysis(): any | null {
        const cached = this.aotPipeline.getCachedGapAnalysis();
        if (cached) return cached;
        // Fallback to DB
        if (this.activeJD?.id) {
            return this.db.getGapAnalysis(this.activeJD.id);
        }
        return null;
    }

    /**
     * Get cached negotiation script from AOT pipeline or DB.
     */
    getNegotiationScript(): any | null {
        const cached = this.aotPipeline.getCachedNegotiationScript();
        if (cached) return cached;
        if (this.activeJD?.id) {
            return this.db.getNegotiationScript(this.activeJD.id);
        }
        return null;
    }

    /**
     * The cached résumé-derived salary estimate, if one has been computed.
     *
     * Exposed for the V3 PROFILE_FACT source (2026-08-02). The engine already
     * computed this on every résumé ingest and logged it ("Resume-based
     * estimate: INR 350,000-650,000 (medium)"), but the only reader was the
     * legacy salary-context block — so "what is my expected salary" planned
     * [RESUME, PROFILE_FACT], found RESUME silent on the subject and
     * PROFILE_FACT structurally empty, and answered DOCUMENT_FACT_NOT_FOUND
     * about a number the app had already worked out.
     *
     * Returns the raw estimate. Callers MUST present it as a derived estimate,
     * never as a fact stated on the résumé — see v3ProfileSources.
     */
    getResumeSalaryEstimate(): ResumeSalaryEstimate | null {
        try {
            const cached = this.salaryEngine.getCachedEstimate();
            if (cached) return cached;

            // COLD-START FALLBACK (2026-08-02). The engine cache is per-process;
            // before this, every relaunch emptied the PROFILE_FACT pool until
            // the next résumé re-upload. The persisted row is only served when
            // its identity key matches the CURRENT active résumé — a row from a
            // replaced résumé fails the comparison and is ignored (the next
            // ingest overwrites it).
            const structured = this.activeResume?.structured_data as StructuredResume | undefined;
            if (!structured?.identity) return null;
            const persisted = this.db.getSalaryEstimate();
            if (!persisted) return null;
            if (persisted.cacheKey !== SalaryIntelligenceEngine.cacheKeyFor(structured)) return null;
            const estimate = persisted.estimate as ResumeSalaryEstimate;
            if (typeof estimate?.min !== 'number' || typeof estimate?.max !== 'number') return null;
            // Prime the in-memory cache so legacy salary context and the V3
            // fact source read one consistent value from here on.
            this.salaryEngine.primeCache(persisted.cacheKey, estimate);
            return estimate;
        } catch { return null; }
    }

    /**
     * Estimate + persist, the ONE choke point both salary call sites use
     * (2026-08-02): ingest pre-compute and the legacy on-demand salary
     * context. Persisting inside the shared path is what makes the estimate
     * survive a relaunch regardless of which surface computed it first.
     */
    private async _estimateAndPersistSalary(
        resume: StructuredResume,
        totalExperienceYears: number,
        generateContentFn: (contents: any[]) => Promise<string>,
    ): Promise<ResumeSalaryEstimate | null> {
        const estimate = await this.salaryEngine.estimateFromResume(resume, totalExperienceYears, generateContentFn);
        if (estimate) {
            // Best-effort: a persistence failure must never break the answer
            // that is about to use the in-memory estimate.
            try { this.db.saveSalaryEstimate(SalaryIntelligenceEngine.cacheKeyFor(resume), estimate); }
            catch (err: any) { console.warn('[KnowledgeOrchestrator] Salary estimate persistence failed:', err?.message); }
        }
        return estimate;
    }

    /**
     * Generate a negotiation script on-demand (used when AOT has not run yet).
     * Persists the result to DB so subsequent calls return it instantly.
     */
    async generateNegotiationScriptOnDemand(): Promise<any | null> {
        if (!this.activeResume || !this.activeJD || !this.generateContentFn) return null;
        const { generateNegotiationScript } = await import('./NegotiationEngine.js');
        const dossier = this.companyResearch.getCachedDossier(
            (this.activeJD.structured_data as StructuredJD).company || ''
        );
        const script = await generateNegotiationScript(
            this.activeResume, this.activeJD, dossier, this.generateContentFn
        );
        if (script && this.activeJD.id) {
            this.db.saveNegotiationScript(this.activeJD.id, script);
            // Seed tracker with the newly generated target so live coaching has a number to anchor to
            if (script.salary_range?.max) {
                this.negotiationTracker.setUserTarget(script.salary_range.max);
            }
        }
        return script;
    }

    /**
     * Get cached cover letter from DB.
     */
    getCoverLetter(): any | null {
        if (this.activeJD?.id) {
            return this.db.getCoverLetter(this.activeJD.id);
        }
        return null;
    }

    /**
     * Generate a cover letter on-demand (mirrors generateNegotiationScriptOnDemand's
     * shape but with no side-effects like seeding a coaching tracker). Persists to DB
     * so subsequent calls return the cached letter instantly.
     */
    async generateCoverLetterOnDemand(): Promise<any | null> {
        if (!this.activeResume || !this.activeJD || !this.generateContentFn) return null;
        const { generateCoverLetter } = await import('./CoverLetterEngine.js');
        const dossier = this.companyResearch.getCachedDossier(
            (this.activeJD.structured_data as StructuredJD).company || ''
        );
        const letter = await generateCoverLetter(
            this.activeResume, this.activeJD, dossier, this.generateContentFn
        );
        if (letter && this.activeJD.id) {
            this.db.saveCoverLetter(this.activeJD.id, letter);
        }
        return letter;
    }

    /**
     * Get cached mock questions from DB.
     */
    getMockQuestions(): any | null {
        if (this.activeJD?.id) {
            return this.db.getMockQuestions(this.activeJD.id);
        }
        return null;
    }

    /**
     * Get cached culture value mappings from AOT pipeline or DB.
     */
    getCultureMappings(): CultureMappingResult | null {
        const cached = this.aotPipeline.getCachedCultureMapping();
        if (cached) return cached;
        if (this.activeJD?.id) {
            return this.db.getCultureMappings(this.activeJD.id) as CultureMappingResult | null;
        }
        return null;
    }

    // ============================================
    // Status & UI
    // ============================================

    getStatus(): KnowledgeStatus {
        const hasResume = this.activeResume !== null;
        const hasJD = this.activeJD !== null;

        let resumeSummary;
        if (hasResume) {
            try {
                const processed = this.getProcessedResume();
                if (processed) {
                    const structured = this.activeResume!.structured_data as StructuredResume;
                    resumeSummary = {
                        name: structured.identity.name,
                        role: structured.experience?.[0]?.role || 'Professional',
                        totalExperienceYears: processed.totalExperienceYears
                    };
                }
            } catch { /* ignore */ }
        }

        let jdSummary;
        if (hasJD) {
            try {
                const structured = this.activeJD!.structured_data as StructuredJD;
                jdSummary = {
                    title: structured.title || (structured as any).role || 'Unknown Title',
                    company: structured.company || ''
                };
            } catch { /* ignore */ }
        }

        return {
            hasResume,
            hasActiveJD: hasJD,
            activeMode: this.knowledgeModeActive,
            resumeSummary,
            jdSummary
        };
    }

    // ============================================
    // Ingestion
    // ============================================

    /**
     * D2 kill-switch: when set, disables BOTH the heuristic extraction fallback
     * and the keep-document-on-embed-failure graceful degrade, restoring the
     * original throw-on-failure / full-rollback behavior. Off by default.
     *   PI_HEURISTIC_EXTRACTION = 'off' | 'false' | '0' | 'disabled'
     */
    private heuristicExtractionDisabled(): boolean {
        try {
            const v = (process.env.PI_HEURISTIC_EXTRACTION || '').trim().toLowerCase();
            return v === 'off' || v === 'false' || v === '0' || v === 'disabled';
        } catch {
            return false;
        }
    }

    /**
     * One in-flight ingest per document type, serialized (2026-08-02 data loss).
     *
     * THE RACE, straight off a production log. Step 4 below deletes every
     * document of the type before saving the new one, and step 8 (STAR stories)
     * awaits multi-second LLM calls AFTER its document row exists. Re-uploading
     * a résumé while the first ingest was still generating STAR stories
     * interleaved as:
     *
     *   03:46:41  upload A saves doc 61, starts STAR generation (~35s of LLM)
     *   03:47:03  upload B runs deleteDocumentsByType(RESUME) -> doc 61 GONE,
     *             saves doc 62
     *   03:47:18  upload A's STAR nodes land -> saveNodes(..., 61)
     *             -> "FOREIGN KEY constraint failed"
     *
     * Upload A's six STAR stories were silently lost — the catch below treats a
     * STAR failure as non-fatal enrichment, which is right for a flaky LLM and
     * wrong for "the parent row was deleted underneath us".
     *
     * Serializing per type is the fix rather than a docId-still-exists guard:
     * the guard would stop the FK error but still discard the work, and every
     * step here (delete -> save -> chunk -> embed -> STAR) assumes it is the
     * only writer for its type. Keyed per type so a résumé upload and a JD
     * upload still overlap — only same-type writers queue.
     */
    private _ingestChainByType = new Map<DocType, Promise<{ success: boolean; error?: string }>>();

    async ingestDocument(filePath: string, type: DocType = DocType.RESUME): Promise<{ success: boolean; error?: string }> {
        const prior = this._ingestChainByType.get(type);
        // Chain onto any in-flight ingest for THIS type. `.catch` so a rejected
        // predecessor never poisons the successor — each ingest reports its own
        // outcome, and this method already resolves {success:false} on failure.
        const run = (async () => {
            // Await, never adopt: a predecessor that rejected reported its own
            // outcome to its own caller and must not poison this one.
            try { await prior; } catch { /* predecessor owns its failure */ }
            return this._ingestDocumentExclusive(filePath, type);
        })();
        this._ingestChainByType.set(type, run);
        try {
            return await run;
        } finally {
            // Only clear if no newer ingest queued behind us, so the map does
            // not leak an entry per upload for the lifetime of the process.
            if (this._ingestChainByType.get(type) === run) this._ingestChainByType.delete(type);
        }
    }

    /**
     * True while an ingest for `type` is running or queued. Derived from the
     * serialization chain above so there is exactly one source of truth.
     *
     * Ingestion lives entirely in the main process and outlives the Profile
     * Intelligence panel, which is a React modal inside the shell renderer —
     * closing it only unmounts a subtree, it never cancels the IPC handler. So
     * the renderer cannot own "is indexing": on reopen its local upload state
     * is gone and the panel would render the empty upload slot mid-ingest.
     * Main owns the flag; the UI reads it back via profile:get-status.
     */
    isIngesting(type: DocType): boolean {
        return this._ingestChainByType.has(type);
    }

    private async _ingestDocumentExclusive(filePath: string, type: DocType = DocType.RESUME): Promise<{ success: boolean; error?: string }> {
        // Either embedder satisfies this: embedWithMetadataFn is the preferred one
        // (it reports the producing space per vector), embedFn the legacy path.
        if (!this.generateContentFn || (!this.embedFn && !this.embedWithMetadataFn)) {
            return { success: false, error: 'LLM and embedding functions not configured.' };
        }

        try {
            console.log(`[KnowledgeOrchestrator] Starting ingestion for ${type} from: ${filePath}`);

            // 1. Extract Text
            const rawText = await extractDocumentText(filePath);

            // 2. Extract Structured JSON.
            // PRIMARY: LLM extraction (richest). FALLBACK (D2): when the
            // extraction LLM is unavailable (billing-blocked / timed out /
            // unparseable JSON) it THROWS — without a fallback `activeResume` is
            // never saved and the profile is NEVER ready (profileFactsReady false
            // forever, the live real-UI failure). So on extraction failure we
            // parse the raw text deterministically (LLM-free) into the minimum
            // usable shape so name/skills/experience/projects/education still
            // answer. Disable with PI_HEURISTIC_EXTRACTION=off.
            let structuredData: any;
            let extractionMode: 'llm' | 'heuristic' = 'llm';
            try {
                structuredData = await extractStructuredData<any>(rawText, type, this.generateContentFn);
                // QUALITY GATE: the LLM can return VALID JSON that is degenerate —
                // no real name ("Unknown Candidate") or empty across every content
                // section — especially under provider throttling. That parses fine
                // (no throw), so the catch-based heuristic fallback never fires and a
                // useless profile wins over the deterministic heuristic. Detect the
                // degenerate case and prefer the heuristic, which reliably recovers
                // name/experience/education from the raw text. (E2E MiniMax campaign.)
                if (type === DocType.RESUME && !this.heuristicExtractionDisabled()) {
                    const isDegenerateResume = (r: StructuredResume | undefined): boolean => {
                        const nameMissing = !r?.identity?.name || /^unknown candidate$/i.test(r.identity.name);
                        const emptyBody = (r?.experience?.length || 0) === 0
                            && (r?.education?.length || 0) === 0
                            && (r?.projects?.length || 0) === 0;
                        return nameMissing || emptyBody;
                    };
                    if (isDegenerateResume(structuredData as StructuredResume)) {
                        // The extraction path is flash-lite→3.5-flash ONLY (no stronger
                        // model to escalate to — Pro/MiniMax are excluded by design). So
                        // on a degenerate-but-valid result, fall to the deterministic
                        // heuristic, which reliably recovers name/experience/education
                        // from the raw text on real-world layouts.
                        const heur = heuristicResumeExtract(rawText);
                        // Only switch if the heuristic actually recovered more.
                        const heurBetter = (heur?.identity?.name && !/^unknown/i.test(heur.identity.name))
                            || (heur?.experience?.length || 0) > 0
                            || (heur?.education?.length || 0) > 0;
                        if (heurBetter) {
                            console.warn('[KnowledgeOrchestrator] LLM extraction degenerate (no name / empty body); using deterministic heuristic instead.');
                            structuredData = heur;
                            extractionMode = 'heuristic';
                        }
                    }
                } else if (type === DocType.JD && !this.heuristicExtractionDisabled()) {
                    // Same class of bug on the JD side: the LLM can return VALID JSON
                    // that is degenerate — title stuck at the "Unknown Role" fallback
                    // (StructuredExtractor.ts sets this when the parsed title is
                    // missing) or empty across requirements/responsibilities — which
                    // parses fine and never throws, so the JD side had the identical
                    // "unknown-but-valid" exposure the resume side was fixed for
                    // (code review finding). Mirror the resume gate.
                    const isDegenerateJD = (j: StructuredJD | undefined): boolean => {
                        const titleMissing = !j?.title || /^unknown role$/i.test(j.title);
                        const emptyBody = (j?.requirements?.length || 0) === 0
                            && (j?.responsibilities?.length || 0) === 0;
                        return titleMissing || emptyBody;
                    };
                    if (isDegenerateJD(structuredData as StructuredJD)) {
                        const heur = heuristicJDExtract(rawText);
                        const heurBetter = (heur?.title && !/^unknown role$/i.test(heur.title))
                            || (heur?.requirements?.length || 0) > 0
                            || (heur?.responsibilities?.length || 0) > 0;
                        if (heurBetter) {
                            console.warn('[KnowledgeOrchestrator] LLM JD extraction degenerate (no title / empty body); using deterministic heuristic instead.');
                            structuredData = heur;
                            extractionMode = 'heuristic';
                        }
                    }
                }
            } catch (extractErr: any) {
                if (this.heuristicExtractionDisabled()) throw extractErr;
                console.warn(`[KnowledgeOrchestrator] LLM structured extraction failed (${extractErr?.message}); falling back to deterministic heuristic extractor.`);
                structuredData = type === DocType.RESUME
                    ? heuristicResumeExtract(rawText)
                    : heuristicJDExtract(rawText);
                extractionMode = 'heuristic';
            }

            // 3. Normalize and post-process resume output. Structured extraction is
            // untrusted JSON: one omitted nested array must not abort ingestion or
            // wipe all downstream atomic nodes.
            if (type === DocType.RESUME) {
                structuredData = normalizeStructuredResume(structuredData as StructuredResume);
                const processed = processResume(structuredData as StructuredResume);
                structuredData = processed.structured; // Save the normalized version
                // Invalidate the memoized cache since the resume changed
                this._processedResumeCache = null;
            } else if (type === DocType.JD) {
                // Runs unconditionally regardless of which of the three
                // extraction paths (LLM success, degenerate-JD heuristic
                // override, catch-based heuristic fallback) produced
                // structuredData above — closing the gap StructuredExtractor's
                // own inline `|| []` defaults leave on the non-LLM-success paths.
                structuredData = normalizeStructuredJD(structuredData as StructuredJD);
            }

            // Stamp the schema version so legacy (flat-skills) blobs can be
            // distinguished from v2 (categorized) on load and backfilled once.
            // Stamp the extraction mode so a heuristic (LLM-down) profile can be
            // re-extracted with the richer LLM once it recovers.
            if (structuredData && typeof structuredData === 'object') {
                (structuredData as any)._schema_version = PROFILE_SCHEMA_VERSION;
                (structuredData as any)._extraction_mode = extractionMode;
            }

            // F8 (code review 2026-08-05): user_confirmed nodes are the one class
            // of résumé-scoped node the USER authored by hand — Role Insight's
            // explicit save-to-profile step. The delete below cascades them away
            // with the replaced document, silently destroying explicitly saved
            // evidence on a routine re-upload. Capture them first and re-attach
            // under the new document so the save-to-profile contract holds. They
            // still die with profile DELETION — "delete your resume and its
            // extracted data" must delete what the user typed too.
            const preservedConfirmedNodes = type === DocType.RESUME
                ? this.db.getNodesBySourceType(DocType.RESUME)
                    .filter(n => Array.isArray(n.tags) && n.tags.includes('user_confirmed'))
                : [];

            // 4. Delete old documents of this type (we assume 1 active resume and 1 active JD for now)
            this.db.deleteDocumentsByType(type);

            // 5. Save Document Metadata — WITH the raw parsed text (2026-08-01,
            // deep-test D1): structured extraction is lossy by design, and any
            // fact without a schema slot was unretrievable at answer time. The
            // raw text is already size-bounded by DocumentReader
            // (MAX_PROFILE_DOCUMENT_CHARS).
            const docId = this.db.saveDocument({
                type,
                source_uri: filePath,
                structured_data: structuredData,
                raw_text: rawText
            });

            // Re-attach preserved user-confirmed claims to the NEW document,
            // before the fallible embed steps so they survive a degraded ingest.
            if (preservedConfirmedNodes.length > 0) {
                this.db.saveNodes(
                    preservedConfirmedNodes.map(({ id: _oldId, document_id: _oldDoc, ...node }) => node),
                    docId,
                );
                console.log(`[KnowledgeOrchestrator] Preserved ${preservedConfirmedNodes.length} user-confirmed claim(s) across re-upload`);
            }

            // Steps 6-8 can fail — recover by deleting the partially saved document
            try {
                // 6. Chunk and Embed
                //
                // `activeSpace` is only a FALLBACK now. It used to be the stamp for
                // every node, snapshotted before a call that can take minutes — so a
                // cloud->local degrade partway through persisted local vectors
                // labelled cloud, and retrieval silently compared across two
                // incompatible spaces. The embedder now reports the space it
                // actually used, per vector, and `producedSpaceByText` carries that
                // back out of the chunker without changing its signature.
                const activeSpace = this.activeSpaceFn?.();
                const producedSpaceByText = new Map<string, string>();
                const ingestEmbedFn = this._makeIngestEmbedFn(producedSpaceByText);
                const ingestEmbedBatchFn = this._makeIngestEmbedBatchFn(producedSpaceByText);
                const nodesWithEmbeddings = await chunkAndEmbedDocument(structuredData, type, ingestEmbedFn, ingestEmbedBatchFn);

                // 7. Save Nodes, stamped with the space that PRODUCED each vector so
                //    a later model swap can detect + re-embed them rather than
                //    silently comparing across incompatible spaces.
                this.db.saveNodes(this._stampProducedSpace(nodesWithEmbeddings, producedSpaceByText, activeSpace), docId);

                // 8. Generate STAR Stories (Resume Only)
                if (type === DocType.RESUME) {
                    try {
                        console.log(`[KnowledgeOrchestrator] Generating STAR stories for resume...`);
                        const starNodes = await generateStarStoryNodes(structuredData as StructuredResume, this.generateContentFn, ingestEmbedFn, ingestEmbedBatchFn);
                        this.db.saveNodes(this._stampProducedSpace(starNodes, producedSpaceByText, activeSpace), docId);
                    } catch (err: any) {
                        console.error('[KnowledgeOrchestrator] Failed to generate STAR stories:', err.message);
                        // Non-fatal — STAR stories are optional enrichment
                    }
                }
            } catch (embedError: any) {
                // D2/R2b: embedding failure must NOT erase the answerable profile.
                // The deterministic fast path + V2 full-profile grounding need only
                // the saved structured_data — NOT embeddings. So instead of rolling
                // back the whole document (which made profileFactsReady false and
                // re-broke "what is my name?"), we KEEP the saved document.
                // Embedding (step 6) runs BEFORE saveNodes (step 7), so a failure
                // here means no nodes were persisted — the document stands alone
                // with its structured_data, and any nodes that DID persist with
                // missing embeddings simply cosine-score 0 in HybridSearchEngine,
                // so RAG degrades to nothing without polluting results. Disable
                // this graceful-degrade with PI_HEURISTIC_EXTRACTION=off (full rollback).
                console.error(`[KnowledgeOrchestrator] Embedding/storage failed for document ${docId}:`, embedError.message);
                if (this.heuristicExtractionDisabled()) {
                    this.db.deleteDocumentsByType(type);
                    this.refreshCache();
                    return { success: false, error: `Embedding failed: ${embedError.message}. Document rolled back.` };
                }
                this.refreshCache();
                console.warn(`[KnowledgeOrchestrator] Kept document ${docId} despite embedding failure — facts remain answerable via grounding + fast path; RAG degraded.`);
                // fall through to success: the profile IS usable for grounding + fast path.
            }

            this.refreshCache();
            console.log(`[KnowledgeOrchestrator] ✅ Ingestion complete for ${type}`);

            // 9. Fire AOT Pipeline (JD Only)
            if (type === DocType.JD) {
                this.aotPipeline.reset();
                // Wire the search provider for THIS run (null clears a stale one).
                // A resolver failure only degrades research to LLM-only — it must
                // never block the AOT pipeline itself.
                if (this.searchProviderResolver) {
                    try {
                        this.companyResearch.setSearchProvider(this.searchProviderResolver());
                    } catch (err: any) {
                        console.warn('[KnowledgeOrchestrator] Search provider resolution failed; company research will be LLM-only:', err?.message || err);
                    }
                }
                const jdDoc = this.db.getDocumentByType(DocType.JD)!;
                const resumeDoc = this.db.getDocumentByType(DocType.RESUME);
                if (isIntelligenceFlagEnabled('atomicJdProfilePackGeneration')) {
                    // Phase 6 Slice 5 (context-rebuild, 2026-07-25, item 3):
                    // awaited sequence closing Ingestion Audit §A.6.3's race —
                    // the IPC caller now only sees {success:true} after AOT +
                    // the JD profile pack both exist. Unlike the resume branch
                    // above, this has a genuine user-facing cost (slower
                    // upload-ack, since AOT runs real LLM calls), so it is
                    // flag-gated dev/test-only until a documented promotion
                    // decision; production keeps the fire-and-forget behavior
                    // in the `else` branch below, byte-identical to before.
                    try {
                        await this.aotPipeline.runForJD(jdDoc, resumeDoc);
                        const script = this.getNegotiationScript();
                        if (script?.salary_range?.max) {
                            this.negotiationTracker.setUserTarget(script.salary_range.max);
                        }
                    } catch (err: any) {
                        console.error('[KnowledgeOrchestrator] AOT Pipeline failed:', err);
                        // Still build the JD pack (role/requirements/keywords) even if
                        // AOT failed — artifact cards simply won't be present.
                    }
                    this._generateProfileOkfPack('jd');
                } else {
                    this.aotPipeline.runForJD(jdDoc, resumeDoc).then(() => {
                        // AOT may have generated a negotiation script; seed tracker target now
                        const script = this.getNegotiationScript();
                        if (script?.salary_range?.max) {
                            this.negotiationTracker.setUserTarget(script.salary_range.max);
                        }
                        // OKF: generate the JD profile pack AFTER AOT so its artifact
                        // cards (gap/negotiation/mock/culture/intro) are populated.
                        // Fire-and-forget, never blocks, never throws.
                        setImmediate(() => this._generateProfileOkfPack('jd'));
                    }).catch((err: Error) => {
                        console.error('[KnowledgeOrchestrator] AOT Pipeline failed:', err);
                        // Still build the JD pack (role/requirements/keywords) even if
                        // AOT failed — artifact cards simply won't be present.
                        setImmediate(() => this._generateProfileOkfPack('jd'));
                    });
                }
            }

            // 10. Pre-compute salary estimate (Resume Only, non-blocking)
            if (type === DocType.RESUME && this.generateContentFn) {
                const resumeData = structuredData as StructuredResume;
                // Re-use freshly computed processResume result — cache was just invalidated above
                const processed = this.getProcessedResume();
                const totalExperienceYears = processed?.totalExperienceYears ?? 0;
                this._estimateAndPersistSalary(
                    resumeData, totalExperienceYears, this.generateContentFn
                ).catch((err: Error) => console.error('[KnowledgeOrchestrator] Salary pre-compute failed:', err));
            }

            // OKF Profile Intelligence (2026-07-02): generate the resume profile
            // pack. Phase 6 Slice 5 (context-rebuild, 2026-07-25, item 3): this
            // was `setImmediate(() => ...)`, deferring past ingestDocument's
            // return — a real race (Ingestion Audit §A.6.3) where the IPC caller
            // saw {success:true} before the profile pack existed. Investigation
            // showed generateForProfile() is fully deterministic/synchronous (no
            // LLM call, DB-transaction-wrapped) and _generateProfileOkfPack
            // never throws (its own try/catch), so calling it directly here
            // closes the race with no added latency — no flag needed, unlike
            // the JD branch below (which has genuine async LLM work in the
            // critical path).
            if (type === DocType.RESUME) {
                this._generateProfileOkfPack('resume');
            }

            return { success: true };

        } catch (error: any) {
            console.error('[KnowledgeOrchestrator] Ingestion failed:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // Chat Integration
    // ============================================

    async processQuestion(question: string): Promise<PromptAssemblyResult | null> {
        // Profile Grounding V2 JD-only short-circuit (RC-8): a session with a JD
        // but no resume can't enter the legacy resume-gated path (the whole method
        // below dereferences this.activeResume). When V2 is on and knowledge mode
        // is active with a JD present, ground on the JD alone so JD questions
        // ("what role am I applying for?") work instead of refusing. Guarded so it
        // only fires in exactly the JD-only case; resume sessions are untouched.
        if (!this.activeResume) {
            if (isProfileGroundingV2Enabled() && this.knowledgeModeActive && this.activeJD) {
                const grounding = buildGroundingBlock(null, this.activeJD);
                if (grounding.block) {
                    return {
                        systemPromptInjection: '',
                        contextBlock: grounding.block,
                        isIntroQuestion: false,
                        factualRecall: true,
                    };
                }
            }
            return null;
        }
        if (!this.isKnowledgeMode()) {
            return null;
        }

        // Classify intent first — gates both persona AND retrieval. Context-aware:
        // a comp conversation (active tracker OR a recent negotiation turn) keeps
        // ambiguous follow-ups negotiation-aware so salary intelligence persists.
        // isNegotiating, not isActive: every final interviewer utterance feeds
        // the tracker and its FIRST one enters PROBE, so isActive() was true for
        // an entire looking-for-work call and made every ambiguous question
        // "sticky" — measured 2026-09-27, 10 of 16 ordinary interview questions
        // ("And why?", "How did you figure out the root cause?", "So how did you
        // handle PayPal refunds?") routed to negotiation, where the live answer
        // waited up to 2 s for a coaching call and lost its résumé grounding.
        // A salary question still opens the sticky window through the keyword
        // rule (recentIntentWasNegotiation) and the transcript hint below.
        const negotiationActive = this.negotiationTracker.isNegotiating();
        // Stickiness decays on intervening non-comp turns, not just on wall-clock.
        const recentIntentWasNegotiation =
            this._lastNegotiationTurnAt > 0 &&
            (Date.now() - this._lastNegotiationTurnAt) < KnowledgeOrchestrator.NEGOTIATION_STICKY_WINDOW_MS &&
            this._nonCompTurnsSinceNegotiation < KnowledgeOrchestrator.NEGOTIATION_DECAY_TURNS;
        // Phase 1: transcript hint — did the interviewer just raise comp? Pull it
        // from the app-layer provider (rolling ~180s transcript). Cheap + sync.
        let recentInterviewerComp = false;
        try {
            const ctxHint = this.conversationContextProvider?.();
            recentInterviewerComp = Boolean(ctxHint?.recentInterviewerComp);
        } catch { /* provider failure must never break classification */ }
        let intent = classifyIntentWithContext(question, {
            negotiationActive,
            recentIntentWasNegotiation,
            recentInterviewerComp,
        });

        // Phase 2 — garbled/typo'd comp rescue. When the sync tiers said GENERAL
        // but the turn contains a NEAR-MISS of a core comp word (e.g. "slalary",
        // "salery", "compensaton") that the keyword scorer can't match, treat it
        // as negotiation. This is a deterministic edit-distance check (see
        // looksLikeGarbledComp): it caught 10/10 real typos with ZERO false
        // positives across a 133-word technical/interview vocabulary. We tried a
        // zero-shot SLM here first, but empirically it MISSED the real garble
        // ("slalary" scored 0.18) and false-fired on unrelated tech terms
        // ("hashmap" scored 0.82) — strictly worse than the deterministic gate,
        // so the SLM was dropped from this path.
        let compRescued = false;
        if (intent === IntentType.GENERAL && looksLikeGarbledComp(question)) {
            intent = IntentType.NEGOTIATION;
            compRescued = true;
        }

        if (intent === IntentType.NEGOTIATION) {
            this._lastNegotiationTurnAt = Date.now();
            this._nonCompTurnsSinceNegotiation = 0;
        } else if (this._lastNegotiationTurnAt > 0) {
            // A substantive, non-comp turn while a thread was live → decay it.
            this._nonCompTurnsSinceNegotiation += 1;
        }
        const stickyCtx = negotiationActive || recentIntentWasNegotiation || recentInterviewerComp;
        console.log(`[KnowledgeOrchestrator] Intent classified: ${intent}${stickyCtx ? ` (negotiation-sticky ctx${recentInterviewerComp ? ' +transcript' : ''})` : ''}${compRescued ? ' (garbled-comp rescue)' : ''}`);

        // Fast paths for specific facts (bypasses vector retrieval and standard ContextAssembler)
        // 1. Identity recall (name, role, etc)
        const qLower = question.toLowerCase().trim();
        const isIdentityDirect = intent === IntentType.INTRO && !INTRO_PATTERNS.some(p => qLower.includes(p));

        if (isIdentityDirect && this.activeResume) {
            const resume = this.activeResume.structured_data as StructuredResume;
            let factAnswer = '';

            if (qLower.includes('name') || qLower.includes('who am i')) {
                factAnswer = `You are ${resume.identity.name}.`;
            } else if (qLower.includes('role') || qLower.includes('job') || qLower.includes('work') || qLower.includes('company')) {
                const latest = resume.experience?.[0];
                if (latest) {
                    factAnswer = `You are currently a ${latest.role} at ${latest.company}.`;
                } else {
                    factAnswer = `You are a professional in the field.`;
                }
            } else if (qLower.includes('experience')) {
                const processed = this.getProcessedResume();
                if (processed && processed.totalExperienceYears) {
                    factAnswer = `You have roughly ${processed.totalExperienceYears} years of experience.`;
                } else {
                    factAnswer = `You have several years of experience based on your resume.`;
                }
            } else if (qLower.includes('background')) {
                const latest = resume.experience?.[0];
                const education = resume.education?.[0];
                let bg = `You are a professional`;
                if (latest) bg += ` currently working as a ${latest.role} at ${latest.company}`;
                if (education) bg += ` with a degree from ${education.institution}`;
                factAnswer = bg + `.`;
            }

            if (factAnswer) {
                console.log('[KnowledgeOrchestrator] Direct Identity Fact match. Returning instantly.');
                return {
                    systemPromptInjection: '',
                    contextBlock: '',
                    isIntroQuestion: true,
                    introResponse: factAnswer,
                    // The user's own identity fact — factual recall, never the
                    // gated coaching layer. Lets the live what-to-answer path
                    // ground on it (see IntelligenceEngine grounding gate).
                    factualRecall: true,
                };
            }
        }

        // 2. Direct Project/Skill Retrieval fast path
        let fastPathNodes: ContextNode[] | null = null;
        if (intent === IntentType.PROFILE_DETAIL && this.activeResume) {
            const resume = this.activeResume.structured_data as StructuredResume;

            // Check for direct project match
            if (resume.projects && Array.isArray(resume.projects)) {
                for (const proj of resume.projects) {
                    if (proj.name && qLower.includes(proj.name.toLowerCase())) {
                        console.log(`[KnowledgeOrchestrator] Direct Project match for: ${proj.name}. Bypassing vector search.`);
                        fastPathNodes = [{
                            source_type: DocType.RESUME,
                            category: 'projects',
                            title: proj.name,
                            text_content: [
                                `- ${proj.name}: ${proj.description || ''}`,
                                `  Technologies: ${(proj.technologies || []).join(', ')}`,
                                ...(proj.highlights || []).filter(Boolean).map((highlight: string) => `  Highlight: ${highlight}`),
                            ].join('\n'),
                            tags: [...(proj.technologies || []), ...(proj.highlights || [])]
                        }];
                        break;
                    }
                }
            }

            // Check for direct skill match
            if (!fastPathNodes && (qLower.startsWith('do i know ') || qLower.startsWith('what is my experience with ') || qLower.startsWith('have i used '))) {
                const skillMatch = qLower.replace(/^(do i know|what is my experience with|have i used) /, '').replace(/\?$/, '').trim();
                const flatSkills = resume.skills_flat ?? flattenSkills(resume.skills);
                if (skillMatch && flatSkills.some((s: string) => s.toLowerCase() === skillMatch)) {
                    console.log(`[KnowledgeOrchestrator] Direct Skill match for: ${skillMatch}. Bypassing vector search.`);
                    fastPathNodes = [{
                        source_type: DocType.RESUME,
                        category: 'skills',
                        title: skillMatch,
                        text_content: `- ${skillMatch}: Yes, this is listed in your skills.`,
                        tags: [skillMatch]
                    }];
                }
            }

        }

        // Candidate-context gate: only questions that are about the candidate
        // themselves (intro, profile details, salary negotiation, the target
        // company) OR phrased with second-person framing ("you / your / we /
        // our") should trigger the persona prompt and resume-node retrieval.
        //
        // TECHNICAL and GENERAL intents without candidate framing — e.g.
        // "what is an API", "explain TCP", "write a function to reverse a
        // string", "implement quicksort" — get answered by the base
        // assistant prompt. Returning null makes streamChat fall through to
        // HARD_SYSTEM_PROMPT / CHAT_MODE_PROMPT with no contextBlock and no
        // first-person persona, so factual questions get factual answers
        // instead of resume-flavored monologues.
        //
        // The legacy isGenericKnowledgeQuestion() check (definitional-pattern
        // match) is kept as a fast-path because it catches questions even when
        // the intent classifier under-scores them (e.g. one-word definitional
        // asks the keyword classifier doesn't recognise).
        const candidateDirectedIntents = new Set<IntentType>([
            IntentType.INTRO,
            IntentType.PROFILE_DETAIL,
            IntentType.NEGOTIATION,
            IntentType.COMPANY_RESEARCH,
        ]);
        // Includes standalone "i" / "i've" / "i'm": questions like "what ML
        // frameworks do I know?", "have I used Redis?", "which tools do I use?"
        // are unambiguously candidate-directed but were missed when only second-
        // person/possessive tokens counted — so skills/tools recall silently
        // fell through to the inclusion-bias path and grounded nothing. Truly
        // generic questions ("what is a hashmap") are already removed by the
        // isGenericKnowledgeQuestion bypass that runs BEFORE this, so admitting
        // "i" here does not pull generic-knowledge into the candidate path.
        const CANDIDATE_FRAMING_REGEX = /\b(i|i've|i'm|i'd|i'll|my|mine|myself|me|we|our|ours|us|you|your|yours|yourself|you've|you're|you'd|you'll)\b/i;
        const hasCandidateFraming = CANDIDATE_FRAMING_REGEX.test(question);

        // Bug fix (2026-07-26, live-testing session): this JD-factual-lookup
        // redirect used to sit BELOW the isGenericKnowledgeQuestion bypass
        // (further down), which made it dead code for its own target case.
        // "What's the compensation range for THIS ROLE?" literal-matches
        // isGenericKnowledgeQuestion's naive "what's the " pattern, so the
        // bypass always fired FIRST and hard-returned null (no further
        // fallback) before this dedicated, already-tested redirect (test/
        // harness case C4-002, see its comment below) ever ran — the
        // "[KnowledgeOrchestrator] Negotiation-keyword match resolved as a
        // JD factual lookup" log line could never appear for this exact
        // phrasing. Moved above the generic-knowledge bypass so a genuine
        // JD-fact lookup is claimed before the naive pattern match can
        // intercept it. Narrow condition (NEGOTIATION intent AND the
        // JD-reference + non-advice shape) — every other intent still hits
        // the generic-knowledge bypass exactly as before.
        //
        // Grounding-campaign fix (2026-07-17): NEGOTIATION is in
        // candidateDirectedIntents so a real salary-coaching question (which
        // needs the résumé + salary/dossier context assembled below) isn't
        // accidentally routed elsewhere. But this classifier's keyword scan
        // ("compensation", "salary") ALSO fires on a pure factual JD lookup —
        // "what's the compensation range for THIS ROLE?" — which is asking what
        // the DOCUMENT states, not for negotiation coaching. Confirmed live
        // (test/harness case C4-002): such a question fell through the
        // candidate-directed path (no JD-only grounding available there) and
        // never reached factualRecall=true (NEGOTIATION intent is explicitly
        // excluded from that gate below, by design, so salary-coaching content
        // doesn't leak into modes that forbid it) — so the model got zero real
        // JD evidence and falsely claimed facts literally present in the JD
        // were absent. isJdFactualLookupNotNegotiationAdvice reuses the same
        // JD-reference + negotiation-advice-cue signals AnswerPlanner's own
        // resolveJdSourceType relies on, so a genuine "how should I negotiate
        // my salary" ask is untouched — this only redirects the FACT-LOOKUP
        // shape to a clean JD-only grounding block (maybeGroundedOnlyResult),
        // never the salary/dossier coaching layer.
        if (intent === IntentType.NEGOTIATION && isJdFactualLookupNotNegotiationAdvice(question)) {
            const v2 = this.maybeGroundedOnlyResult(question);
            if (v2) {
                console.log('[KnowledgeOrchestrator] Negotiation-keyword match resolved as a JD factual lookup — grounding in JD only, no coaching layer');
                return v2;
            }
        }

        // Clearly-generic questions ("what is a hashmap", "explain TCP",
        // "write a function to reverse a string") get a clean factual answer:
        // full bypass, no identity/persona/retrieval. This must stay a hard
        // bypass so generic knowledge isn't wrapped in the candidate's voice.
        if (isGenericKnowledgeQuestion(question)) {
            console.log(`[KnowledgeOrchestrator] Generic-knowledge question — full bypass (no identity/retrieval)`);
            // V2 (spec §8.3 gated): a question that secretly needs the profile
            // ("how do I fit this JD?") gets grounded, but a genuine coding /
            // technical-concept question gets NO profile — maybeGroundedOnlyResult
            // returns null for those answer types, falling through to the bypass.
            const v2 = this.maybeGroundedOnlyResult(question);
            if (v2) return v2;
            return null;
        }

        const isCandidateDirected = candidateDirectedIntents.has(intent) || hasCandidateFraming;

        // Phase 6 Slice 4 item 2, follow-up pass (context-rebuild,
        // 2026-07-26): SHADOW-ONLY observation, zero behavior change. Logs
        // whether isLayerAllowed(plan, 'resume') — the target-arch
        // decision-maker this pronoun gate is slated to be replaced by —
        // agrees with the legacy isCandidateDirected computation above.
        // See intelligenceFlags.ts's pronounRegexShadowObservation doc
        // comment for why this is not yet promoted to the live decision.
        if (isIntelligenceFlagEnabled('pronounRegexShadowObservation')) {
            try {
                const plan = planAnswer({ question, source: 'manual_input' });
                const canonicalResumeAllowed = isLayerAllowed(plan, 'resume');
                const payload = {
                    legacyResumeAllowed: isCandidateDirected,
                    canonicalResumeAllowed,
                    answerType: plan.answerType,
                    intent,
                };
                if (isCandidateDirected !== canonicalResumeAllowed) {
                    console.warn('[PronounRegexShadow] divergence (observe-only, no behavior change)', payload);
                } else {
                    console.log('[PronounRegexShadow] agreement (observe-only)', payload);
                }
            } catch (shadowErr: any) {
                console.warn('[PronounRegexShadow] shadow call skipped (non-fatal):', shadowErr?.message);
            }
        }

        // Deterministic structured pack for category-listing questions about the
        // user's OWN facts ("what are my projects?", "tell me about my work
        // experience", "my education", "what are my skills?").
        //
        // This fires on the TRUE signal — a resume category keyword
        // (detectCategoryHints) combined with candidate framing — NOT on the
        // brittle intent score. "tell me about my work experience" classifies as
        // GENERAL (the keyword classifier has no 'work experience' pattern), yet
        // it is unambiguously the user listing their own experience. Gating on
        // category-hint + framing catches it regardless of intent label.
        //
        // Why it must bypass vector retrieval: getRelevantNodes drops nodes below
        // a 0.55 cosine threshold, and a terse listing query embeds poorly — so
        // retrieval can return ZERO project/experience nodes even though the
        // structured resume contains them. That empty context block is the
        // structural cause of "I don't have access to your projects". Building the
        // nodes straight from structured_data guarantees recall and also removes
        // the query-embedding round-trip from the hot path. Fully dynamic — every
        // value comes from the uploaded resume.
        if (isCandidateDirected && this.activeResume.structured_data) {
            const structuredPack = this.buildStructuredCategoryPack(question, this.activeResume.structured_data as StructuredResume);
            if (structuredPack && structuredPack.length > 0) {
                fastPathNodes = structuredPack;
            }
        }

        // Inclusion bias (Self-RAG / Adaptive-RAG): for AMBIGUOUS questions —
        // not clearly generic, but lacking a strong candidate signal (GENERAL
        // intent, no first/second-person framing) — do NOT fully bypass. A hard
        // skip here is the documented #1 failure mode: a question that secretly
        // needed the candidate's context ("would you take this offer?", "what
        // should I prioritize here?", "is that a good fit?") gets answered blind.
        // Instead inject a COMPACT identity block (name, current role, target
        // role/company). It's tiny and lives in the cached prefix, so the cost
        // is ~nil, while heavy retrieval (resume chunks, dossier, salary) is
        // still skipped. The block is self-labeled so the model ignores it for
        // genuinely generic asks the keyword gate didn't catch.
        if (!isCandidateDirected) {
            // V2: replace the compact-identity inclusion-bias block with the FULL
            // profile (cached prefix, ~nil cost) so an ambiguous question that
            // secretly needs the profile or JD has everything available — not just
            // name+role. Gated by answer type: a coding/technical/sales/lecture
            // question returns null here and keeps the legacy compact-identity /
            // bypass behavior (no resume/JD), per spec §8.3.
            const v2 = this.maybeGroundedOnlyResult(question);
            if (v2) return v2;
            const identityBlock = this.buildCompactIdentityBlock();
            if (identityBlock) {
                console.log(`[KnowledgeOrchestrator] Ambiguous question (intent=${intent}) — injecting compact identity (inclusion bias), skipping heavy retrieval`);
                // Identity goes in contextBlock, NOT systemPromptInjection:
                // systemPromptInjection REPLACES the base system prompt body
                // (LLMHelper does CORE_IDENTITY + injection), which would strip
                // HARD_SYSTEM_PROMPT's behavior rules. A compact identity is a
                // context fragment, so it's prepended as context with the base
                // system prompt left intact.
                return {
                    systemPromptInjection: '',
                    contextBlock: identityBlock,
                    isIntroQuestion: false,
                    // The user's own identity facts — never suppressed by the
                    // premium-intercept mode gate. See PromptAssemblyResult.factualRecall.
                    factualRecall: true,
                };
            }
            console.log(`[KnowledgeOrchestrator] Ambiguous question (intent=${intent}) — no identity available, bypassing`);
            return null;
        }

        // Feed user utterance for silence timer detection
        this.negotiationTracker.addUserUtterance(question);

        // Detect category hints for boosting (e.g. "projects" → boost project nodes)
        const categoryHints = detectCategoryHints(question);
        if (categoryHints.length > 0) {
            console.log(`[KnowledgeOrchestrator] Category hints detected: ${categoryHints.join(', ')}`);
        }

        // For PROFILE_DETAIL queries (e.g. "what projects have you worked on?"),
        // use a higher node limit to retrieve all relevant items
        const maxNodes = intent === IntentType.PROFILE_DETAIL ? 12 : undefined;

        // Get JD required skills for boosting
        let jdRequiredSkills: string[] = [];
        if (this.activeJD) {
            const jd = this.activeJD.structured_data as StructuredJD;
            jdRequiredSkills = [...(jd.requirements || []), ...(jd.technologies || [])];
        }

        // Retrieve relevant nodes with JD boost and category hints.
        // Use the fast on-device query embedder when its dimension matches the
        // index (saves a ~100-200ms cloud round-trip); falls back to the
        // index-matching embedder otherwise so cosine similarity stays valid.
        //
        // PARALLELISM: kick retrieval off as a promise NOW (non-blocking) and
        // await it only right before it's consumed (assemblePromptContext). This
        // overlaps the query embedding with the dossier/salary work below — which
        // can include a live research/estimate LLM call when uncached. Retrieval
        // is a pure read of cachedNodes + an embed, so eager-starting it is safe;
        // the only cost is a ~10ms local embed wasted if the live-negotiation
        // early-return below fires (negligible, and that path is itself an LLM call).
        // PERF (V2): when full-profile grounding is ON and this answer type is
        // fully covered by the injected grounding block (plain profile facts —
        // identity/skills/projects/experience/education), the vector retrieval
        // below is REDUNDANT: the same facts are already in <candidate_profile>.
        // Running getRelevantNodes there costs a cloud query-embedding round-trip
        // (the log's "Found N relevant nodes" line) for nothing. Skip it for those
        // types. KEEP retrieval for behavioral (STAR-story nodes aren't in the
        // grounding block) and negotiation (applyFullProfileGrounding is
        // intent-gated `intent !== NEGOTIATION` below, so negotiation turns never
        // receive the grounding block — retrieval is their only resume-fact
        // source). NOTE (2026-08-13 correction): dossier and salary blocks are
        // assembled by separate code paths (dossierContext / salaryContext below)
        // and NEVER flow through getRelevantNodes — its sourceTypes filter is
        // [RESUME, JD]. jd_fit retrieval therefore duplicates the grounding block
        // except for STAR nodes, and is skippable behind the flag. Never skip
        // when a deterministic fastPathNodes pack already matched.
        const groundingCoversAnswer = (() => {
            if (!isProfileGroundingV2Enabled()) return false;
            try {
                const t = planAnswer({ question, source: 'manual_input' }).answerType;
                const fullyCovered = new Set([
                    'identity_answer', 'profile_fact_answer', 'skills_answer',
                    'skill_experience_answer', 'project_answer', 'experience_answer',
                ]);
                // Phase 0.5 (semantic-retrieval repair): the fit family's
                // retrieval pool duplicates the injected grounding block (see
                // NOTE above). Both fit shapes carry required layers
                // [resume, jd], so the block is guaranteed present. Opt-in
                // flag, default OFF. Deliberately NOT negotiation — see
                // isProfileGroundingV2JdFitCoverageEnabled's doc for why that
                // would silently drop resume facts.
                if (isProfileGroundingV2JdFitCoverageEnabled()) {
                    fullyCovered.add('jd_fit_answer');
                    fullyCovered.add('resume_jd_fit_answer');
                }
                return fullyCovered.has(t);
            } catch { return false; }
        })();
        const queryEmbedder = groundingCoversAnswer ? null : this.resolveQueryEmbedder();
        if (groundingCoversAnswer) {
            console.log('[KnowledgeOrchestrator] V2 grounding covers this answer type — skipping redundant vector retrieval embed');
        }
        // Space gate: only score nodes embedded in the COMMITTED index space
        // (_committedIndexSpace: the converged space, normally cloud, or local when
        // degraded). A node still in an old space (e.g. v1 768d while committed is v2
        // 768d, mid re-embed) would otherwise be cosine-compared against the query
        // vector — same dims, silent garbage. When no committed space can be derived
        // (empty corpus) we don't gate; otherwise the resolveQueryEmbedder picks the
        // embedder that produces THAT same committed space, keeping query+nodes consistent.
        const retrievalNodes = this._spaceGatedNodes();
        const relevantNodesPromise: Promise<ContextNode[]> = fastPathNodes
            ? Promise.resolve(fastPathNodes)
            : (queryEmbedder && retrievalNodes.length > 0)
                ? getRelevantNodes(question, retrievalNodes, queryEmbedder, {
                    sourceTypes: [DocType.RESUME, DocType.JD],
                    jdRequiredSkills,
                    categoryHintKeywords: categoryHints.length > 0 ? categoryHints : undefined,
                    maxNodes,
                    // Semantic-admission gate (Phase 1): the committed space is
                    // the one the corpus vectors AND resolveQueryEmbedder's
                    // query vectors provably share, so its floor is valid here.
                    embeddingSpaceKey: this._committedIndexSpace() ?? null,
                  })
                    .then(scored => scored.map(sn => sn.node))
                    .catch((error: any) => {
                        console.warn('[KnowledgeOrchestrator] Relevance scoring failed:', error.message);
                        return [] as ContextNode[];
                    })
                : Promise.resolve([] as ContextNode[]);

        // Company research — prefer pre-computed AOT dossier, fallback to DB cache
        let dossierContext = '';
        if (needsCompanyResearch(question) && this.activeJD && this.isCompanyResearchAllowed()) {
            const jd = this.activeJD.structured_data as StructuredJD;
            if (jd.company) {
                try {
                    // 1. Try AOT pipeline cache (in-memory)
                    let dossier = this.aotPipeline.getCachedDossier();
                    // 2. Fallback: DB cache (persisted from previous AOT runs)
                    if (!dossier) {
                        dossier = this.companyResearch.getCachedDossier(jd.company);
                    }
                    // 3. Last resort: live research — BUDGET-BOUNDED (manual
                    // regression 2026-06-12: a live research call took ~6.9s in
                    // the hot path → provider_timeout at 7s → fallback answer).
                    // The answer path gets at most 2s; on timeout the research
                    // keeps running in the BACKGROUND so the NEXT question hits
                    // the DB cache, and THIS answer proceeds without a dossier
                    // (the JD block still grounds the role).
                    if (!dossier) {
                        console.warn('[KnowledgeOrchestrator] No cached dossier found, running live research (2s budget; continues in background)');
                        const researchPromise = this.companyResearch.researchCompany(
                            jd.company, jdContextFromStructured(jd)
                        );
                        // Keep it from becoming an unhandled rejection when it
                        // outlives the budget.
                        researchPromise.catch(() => { /* logged inside engine */ });
                        dossier = await Promise.race([
                            researchPromise,
                            new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
                        ]);
                        if (!dossier) {
                            console.warn('[KnowledgeOrchestrator] Live research exceeded 2s budget — answering without dossier (background fill continues)');
                        }
                    }
                    if (dossier) dossierContext = formatDossierBlock(dossier);
                } catch (error: any) {
                    console.warn('[KnowledgeOrchestrator] Company research failed:', error.message);
                }
            }
        }

        // Live negotiation path — only when tracker has active state
        if (intent === IntentType.NEGOTIATION) {
            if (this.negotiationTracker.isActive() && this.generateContentFn && this.activeResume) {
                const dossier = this.activeJD
                    ? this.companyResearch.getCachedDossier(
                        (this.activeJD.structured_data as StructuredJD).company || ''
                      )
                    : null;
                const script = this.getNegotiationScript();
                const coachingResponse = await generateLiveCoachingResponse(
                    this.negotiationTracker,
                    question,
                    this.activeResume,
                    this.activeJD,
                    dossier,
                    script,
                    // Live coaching is spoken in real time — prefer the fast
                    // (Flash-first) fn when wired; fall back to the quality fn.
                    this.liveCoachingContentFn || this.generateContentFn
                );
                return {
                    systemPromptInjection: '',
                    contextBlock: '',
                    isIntroQuestion: false,
                    liveNegotiationResponse: coachingResponse,
                };
            }
        }

        // Salary intelligence injection — for negotiation/salary questions
        let salaryContext = '';
        if (intent === IntentType.NEGOTIATION && this.activeResume && this.generateContentFn) {
            try {
                const resume = this.activeResume.structured_data as StructuredResume;
                const processed = this.getProcessedResume();
                const totalExperienceYears = processed?.totalExperienceYears ?? 0;

                if (this.activeJD) {
                    // JD mode: use pre-computed negotiation script + dossier salary data
                    const negotiationScript = this.getNegotiationScript();
                    const resumeEstimate = this.salaryEngine.getCachedEstimate();
                    salaryContext = SalaryIntelligenceEngine.buildSalaryContextBlock(
                        resumeEstimate, negotiationScript, true
                    );
                    console.log('[KnowledgeOrchestrator] Injecting JD-based salary intelligence');
                } else {
                    // Resume-only mode: generate salary estimate from resume data
                    const resumeEstimate = await this._estimateAndPersistSalary(
                        resume, totalExperienceYears, this.generateContentFn
                    );
                    salaryContext = SalaryIntelligenceEngine.buildSalaryContextBlock(
                        resumeEstimate, null, false
                    );
                    console.log('[KnowledgeOrchestrator] Injecting resume-based salary intelligence');
                }
            } catch (error: any) {
                console.warn('[KnowledgeOrchestrator] Salary intelligence failed:', error.message);
            }
        }
        // Gap analysis pivot injection — if question mentions a gap skill, inject the pre-computed pivot script.
        // LATENCY/PROMPT-SIZE GATE (manual regression 2026-06-12): pivots used to
        // inject for ANY question containing a gap-skill token — real-session
        // logs showed "Injecting 1 pivot script(s)" on unrelated questions,
        // bloating every prompt by hundreds of chars and steering off-topic
        // answers toward gap-pivot phrasing. Pivots only make sense when the
        // answer IS about fit/gaps — gate on the planned answer type.
        let gapContext = '';
        const gapRelevantTypes = new Set(['jd_fit_answer', 'gap_analysis_answer', 'behavioral_interview_answer']);
        let plannedTypeForGap = '';
        try { plannedTypeForGap = planAnswer({ question, source: 'manual_input' }).answerType; } catch { /* keep '' → skip pivots */ }
        if (this.activeJD && gapRelevantTypes.has(plannedTypeForGap)) {
            // Role Insight first (2026-08-04): when a fresh, evidence-grounded
            // analysis exists, its per-requirement explanation + limitations
            // replace the keyword-matched pivot_script below — the live answer
            // then inherits "never claim beyond the evidence" from the
            // validated analysis instead of a canned pivot. getLiveEvidence
            // returns null (→ fall through to pivots, behavior unchanged) when
            // there is no analysis, it is outdated, or the question does not
            // precisely match an at-risk requirement. Same answer-type gate as
            // the pivot path, so the 2026-06-12 prompt-bloat fix is preserved.
            try {
                const riEvidence = this.roleInsightService?.getLiveEvidence(question) ?? null;
                if (riEvidence) {
                    gapContext = riEvidence;
                    console.log('[KnowledgeOrchestrator] Injecting Role Insight fit evidence');
                }
            } catch (e: any) {
                console.warn('[KnowledgeOrchestrator] Role Insight live evidence failed:', e?.message);
            }
        }
        if (!gapContext && this.activeJD && gapRelevantTypes.has(plannedTypeForGap)) {
            const gapAnalysis = this.getGapAnalysis() as import('./types').GapAnalysisResult | null;
            if (gapAnalysis && gapAnalysis.gaps && gapAnalysis.gaps.length > 0) {
                const questionLower = question.toLowerCase();
                const matchingGaps = gapAnalysis.gaps.filter(gap =>
                    questionLower.includes(gap.skill.toLowerCase())
                );
                if (matchingGaps.length > 0) {
                    const pivotLines = matchingGaps.map(gap =>
                        `[Gap: ${gap.skill} (${gap.gap_type})] Pivot: ${gap.pivot_script}${gap.transferable_skills.length > 0 ? ` Transferable skills: ${gap.transferable_skills.join(', ')}` : ''}`
                    );
                    gapContext = `<gap_pivot_scripts>\n${pivotLines.join('\n')}\n</gap_pivot_scripts>`;
                    console.log(`[KnowledgeOrchestrator] Injecting ${matchingGaps.length} pivot script(s) for detected gap skills`);
                }
            }
        }

        // Get tone directive from technical depth scorer
        const toneXML = this.depthScorer.getToneXML();

        // AOT-precomputed intro (keyed by JD doc id). Served instantly for
        // "tell me about yourself" instead of a live LLM call. Null when the JD
        // has no intro yet (e.g. AOT not finished or resume-only mode) — the
        // assembler then falls back to JIT generation.
        let cachedIntro: string | null = null;
        if (this.activeJD?.id != null) {
            cachedIntro = this.db.getIntro(this.activeJD.id);
        }

        // Await retrieval now (it ran concurrently with the dossier/salary work above).
        let relevantNodes = await relevantNodesPromise;

        // Zero-node fit/persona fallback. A candidate-directed question with no
        // category keyword ("why should they hire me?", "make your case") matches
        // no structured pack and embeds poorly, so retrieval returns nothing — a
        // VOID. With a confident persona and no grounded facts, the model fills
        // the void by INVENTING metrics (the persona-fabrication finding). Seed
        // the candidate's REAL experience + achievements from structured_data so
        // the model has genuine material to cite instead of a void to fabricate
        // into. Fully dynamic — every value comes from the uploaded resume.
        //
        // EXCLUDE questions asking for a SPECIFIC unknown datum ("what was my
        // EXACT NPS improvement / quota attainment / uptime %?"). Those SHOULD
        // hit the void so the model admits the number isn't loaded — seeding
        // metric-bearing experience bullets there just gives the model adjacent
        // numbers to recombine into a fabricated specific (regression observed).
        // Heuristic: a precise-value ask ("exact", "specific", "what was my ... %",
        // "how much exactly") wants a datum, not a pitch.
        const wantsPreciseValue = /\b(exact|exactly|specific|precise)\b|\bwhat was my\b.*\b(percentage|percent|%|rate|number|score|figure|amount)\b|\bhow much\b/i.test(question);
        if (relevantNodes.length === 0 && !wantsPreciseValue && this.activeResume.structured_data) {
            const fitPack = this.buildExperienceFallbackPack(this.activeResume.structured_data as StructuredResume);
            if (fitPack.length > 0) {
                console.log(`[KnowledgeOrchestrator] Zero-node candidate-directed question — seeding ${fitPack.length} real experience/achievement node(s) to prevent fabrication`);
                relevantNodes = fitPack;
            }
        }

        // Pass everything to the Context Assembler for prompt construction
        const result = await assemblePromptContext(
            question,
            this.activeResume,
            this.activeJD,
            relevantNodes.map(n => ({ node: n, score: 1 })),
            this.generateContentFn,
            toneXML,
            cachedIntro
        );

        // Append dossier context if available
        if (dossierContext && result) {
            result.contextBlock = result.contextBlock
                ? `${result.contextBlock}\n\n${dossierContext}`
                : dossierContext;
        }

        // Append salary intelligence if available
        if (salaryContext && result) {
            result.contextBlock = result.contextBlock
                ? `${result.contextBlock}\n\n${salaryContext}`
                : salaryContext;
        }

        // Append gap pivot scripts if available
        if (gapContext && result) {
            result.contextBlock = result.contextBlock
                ? `${result.contextBlock}\n\n${gapContext}`
                : gapContext;
        }

        // Mock question matching — if the interviewer's question matches a pre-computed mock question,
        // inject the suggested answer key to help the candidate
        if (this.activeJD && result) {
            const mockQuestions = this.getMockQuestions() as import('./types').MockQuestion[] | null;
            if (mockQuestions && mockQuestions.length > 0) {
                const questionLower = question.toLowerCase();
                const questionWords = new Set(questionLower.split(/\s+/).filter(w => w.length > 3));

                // Score each mock question by keyword overlap with the interviewer's question
                const scoredMocks = mockQuestions.map(mq => {
                    const mqWords = mq.question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                    const overlap = mqWords.filter(w => questionWords.has(w)).length;
                    const similarity = mqWords.length > 0 ? overlap / mqWords.length : 0;
                    return { mock: mq, similarity };
                }).filter(s => s.similarity >= 0.4) // At least 40% word overlap
                  .sort((a, b) => b.similarity - a.similarity);

                if (scoredMocks.length > 0) {
                    const bestMatch = scoredMocks[0];
                    const hintLines = [
                        `Predicted Question: "${bestMatch.mock.question}"`,
                        `Category: ${bestMatch.mock.category} | Difficulty: ${bestMatch.mock.difficulty}`,
                        `Key Points to Hit: ${bestMatch.mock.suggested_answer_key}`,
                        `Why This Is Asked: ${bestMatch.mock.rationale}`
                    ];
                    const mockBlock = `<mock_question_hint>\nThis question closely matches a predicted interview question. Use these key points:\n${hintLines.join('\n')}\n</mock_question_hint>`;

                    result.contextBlock = result.contextBlock
                        ? `${result.contextBlock}\n\n${mockBlock}`
                        : mockBlock;
                    console.log(`[KnowledgeOrchestrator] Injecting mock question hint (${(bestMatch.similarity * 100).toFixed(0)}% match): "${bestMatch.mock.question.substring(0, 60)}..."`);
                }
            }
        }

        // Culture values alignment injection
        const cultureMappings = this.getCultureMappings();
        if (cultureMappings && cultureMappings.mappings.length > 0 && this.activeJD && result) {
            const jd = this.activeJD.structured_data as StructuredJD;
            const alignments = findRelevantValueAlignments(
                question, cultureMappings.mappings, cultureMappings.core_values, 2
            );
            if (alignments.length > 0) {
                const cultureBlock = formatValueAlignmentBlock(alignments, jd.company);
                if (cultureBlock) {
                    result.contextBlock = result.contextBlock
                        ? `${result.contextBlock}\n\n${cultureBlock}`
                        : cultureBlock;
                    console.log(`[KnowledgeOrchestrator] Injecting ${alignments.length} culture alignment(s) for ${jd.company}`);
                }
            }
        }

        // INTRO / PROFILE_DETAIL questions are the user asking about THEMSELVES
        // (name, projects, skills, experience, education, background). These are
        // direct factual recall, not the premium persona/coaching layer that the
        // active-mode gate suppresses in technical-interview/team-meet/lecture
        // modes. Flag them so LLMHelper applies the candidate context regardless
        // of the mode gate — otherwise the base assistant answers in third
        // person ("I don't have access to your resume"). See
        // PromptAssemblyResult.factualRecall.
        // `fastPathNodes` is set when a deterministic structured pack matched
        // (e.g. "tell me about my work experience" → GENERAL intent but clearly
        // the user's own facts), so flag those too — not just the PROFILE_DETAIL/
        // INTRO intent labels.
        //
        // NEGOTIATION is EXCLUDED even when a structured pack matched: a
        // negotiation-intent question can trip a category keyword
        // ("what are my projects worth in this offer?"), but the salary/dossier
        // coaching blocks appended above are exactly the premium layer the
        // active-mode gate is meant to suppress in technical-interview/team-meet/
        // lecture modes. factualRecall must mean "the user's own plain facts" —
        // never the coaching layer — so the mode gate keeps suppressing salary
        // coaching. (The live-coaching short-circuit already returned earlier;
        // this guards the salary-context branch the reviewer flagged.)
        if (result && intent !== IntentType.NEGOTIATION &&
            (intent === IntentType.PROFILE_DETAIL || intent === IntentType.INTRO || fastPathNodes)) {
            result.factualRecall = true;
        }

        // Profile Grounding V2 (RC-1/2/4/5/10): inject the FULL typed profile +
        // JD as an always-present block. With the whole profile in context there
        // is no retrieval void to misfire into "I don't have access", the JD is
        // finally a first-class consumer, and every fact (not just retrieved
        // chunks) is available. Flagged off by default until the eval gate (P4).
        // Excludes the live-negotiation coaching channel (handled/returned above).
        if (result && intent !== IntentType.NEGOTIATION && isProfileGroundingV2Enabled()) {
            this.applyFullProfileGrounding(result, question);
        }

        return result;
    }

    /**
     * Spec §3/§8 gate: decide whether the resume/JD grounding block may be used
     * for a question, and which parts. Coding / technical-concept / sales /
     * lecture answers must NOT see the resume or JD (spec non-goal #3, Case F/G/H).
     * Identity / skills questions get the resume but not the JD (minimal context,
     * §4). JD-fit / behavioral / experience / project get both. Deterministic —
     * uses the shared answer-type classifier, no LLM.
     */
    private profileGroundingPlan(question: string): { useResume: boolean; useJD: boolean } {
        try {
            const plan = planAnswer({ question, source: 'manual_input' });
            const t = plan.answerType;
            // Hard exclusions — these answer types forbid resume in the planner.
            const noProfile = plan.forbiddenContextLayers.includes('resume');
            if (noProfile) return { useResume: false, useJD: false };
            // Resume allowed; JD only when the answer type's required layers want it.
            const useJD = plan.requiredContextLayers.includes('jd') && !plan.forbiddenContextLayers.includes('jd');
            // Identity / pure-skill questions stay tight (resume only, no JD) even
            // though JD isn't strictly forbidden — keeps the block minimal (§4).
            const tightTypes = new Set(['identity_answer', 'skills_answer', 'skill_experience_answer', 'profile_fact_answer']);
            return { useResume: true, useJD: tightTypes.has(t) ? false : useJD };
        } catch {
            // Classifier failure must never break grounding — default to full.
            return { useResume: true, useJD: true };
        }
    }

    /**
     * Prepend the deterministic full-profile grounding block to a result's
     * contextBlock and mark it factualRecall so the mode gate can't drop it.
     * Idempotent within a single result (won't double-inject). Gated by answer
     * type (spec §8): coding/technical/sales/lecture get NO resume/JD block.
     */
    private applyFullProfileGrounding(result: PromptAssemblyResult, question: string): void {
        if (!result || result.isIntroQuestion || result.liveNegotiationResponse) return;
        if (result.contextBlock && result.contextBlock.includes('<candidate_profile>')) return;
        if (result.contextBlock && result.contextBlock.includes('<target_job>')) return;
        const gate = this.profileGroundingPlan(question);
        if (!gate.useResume && !gate.useJD) return; // coding/technical/sales/lecture → no profile
        const grounding = buildGroundingBlock(this.activeResume, this.activeJD, {
            includeResume: gate.useResume,
            includeJD: gate.useJD,
        });
        if (!grounding.block) return;
        result.contextBlock = result.contextBlock
            ? `${grounding.block}\n\n${result.contextBlock}`
            : grounding.block;
        // The user's own facts are always allowed past the mode gate.
        result.factualRecall = true;
    }

    /**
     * V2-only: build a grounding-only result (full profile + JD, no retrieval)
     * for early-return paths (generic bypass, inclusion-bias) that would
     * otherwise return null or a compact identity. Returns null when V2 is off,
     * no profile data exists, OR the question is a coding/technical/sales/lecture
     * type that must not use the profile (spec §8.3) — so those fall through to
     * the legacy generic-bypass (null) and answer with no profile.
     */
    private maybeGroundedOnlyResult(question?: string): PromptAssemblyResult | null {
        if (!isProfileGroundingV2Enabled()) return null;
        const gate = question ? this.profileGroundingPlan(question) : { useResume: true, useJD: true };
        if (!gate.useResume && !gate.useJD) return null;
        const grounding = buildGroundingBlock(this.activeResume, this.activeJD, {
            includeResume: gate.useResume,
            includeJD: gate.useJD,
        });
        if (!grounding.block) return null;
        return {
            systemPromptInjection: '',
            contextBlock: grounding.block,
            isIntroQuestion: false,
            factualRecall: true,
        };
    }

    // ============================================
    // Management
    // ============================================

    deleteDocumentsByType(type: DocType): void {
        this.db.deleteDocumentsByType(type);
        if (type === DocType.RESUME) {
            this.knowledgeModeActive = false;
            this.salaryEngine.clearCache();
            this.negotiationTracker.reset(); this._lastNegotiationTurnAt = 0; this._nonCompTurnsSinceNegotiation = 0;
        } else if (type === DocType.JD) {
            // Replacing a JD means the user is targeting a different role/company.
            // Phase, offer history, and pushback counts from the previous session must
            // not bleed into the new negotiation — reset unconditionally.
            this.negotiationTracker.reset(); this._lastNegotiationTurnAt = 0; this._nonCompTurnsSinceNegotiation = 0;
        }
        // OKF Profile Intelligence (2026-07-02): the profile OKF pack for this
        // doc kind must die with its source document. This single choke point
        // covers every clear/re-ingest path (profile:clear, profile:delete,
        // trial wipes, and step-4 of ingestDocument itself), so a stale profile
        // pack can never outlive the structured data it was built from. Best
        // effort — never blocks or throws into the delete path.
        try {
            const mod = require('../../../electron/services/knowledge/ProfilePackBuilder') as typeof import('../../../electron/services/knowledge/ProfilePackBuilder');
            mod.ProfilePackBuilder.getInstance().deleteProfilePack(type === DocType.RESUME ? 'resume' : 'jd');
        } catch { /* OKF layer must never affect delete */ }
        this.refreshCache();
    }

    private refreshCache(): void {
        const prevResumeId = this.activeResume?.id ?? null;
        this.activeResume = this.db.getDocumentByType(DocType.RESUME);
        this.activeJD = this.db.getDocumentByType(DocType.JD);
        // RC-3 back-compat: migrate any legacy flat-skills (v1) resume to the
        // categorized (v2) shape. Deterministic keyword categorization — no LLM
        // call, works from the stored flat list (raw text may be gone). Runs once
        // per profile (guarded by _schema_version), persisted back to the DB.
        this.migrateActiveResumeSkills();
        this.migrateActiveJDSchema();
        this.cachedNodes = this.db.getAllNodes();
        // Invalidate the processResume cache if the resume document changed
        if ((this.activeResume?.id ?? null) !== prevResumeId) {
            this._processedResumeCache = null;
        }
        console.log(`[KnowledgeOrchestrator] Cache refreshed: ${this.cachedNodes.length} total nodes across all docs`);
        // Fire-and-forget: re-embed any nodes left in an incompatible/old space
        // (e.g. after a gemini-embedding-001 → -2 upgrade). No-op when all match.
        this.ensureEmbeddingSpace().catch(err =>
            console.warn('[KnowledgeOrchestrator] ensureEmbeddingSpace failed (non-fatal):', err?.message || err));
    }

    /**
     * One-shot v1→v2 skills migration for the active resume. If the stored
     * resume's skills are a legacy flat string[] (or it predates the schema
     * version stamp), categorize them deterministically, refresh skills_flat,
     * stamp _schema_version, and persist back. Idempotent: a v2 profile whose
     * skills are already an object is left untouched.
     */
    private migrateActiveResumeSkills(): void {
        const doc = this.activeResume;
        if (!doc?.structured_data || typeof doc.structured_data !== 'object') return;
        const sd = doc.structured_data as any;
        const needsMigration = isLegacyFlatSkills(sd.skills) || sd._schema_version !== PROFILE_SCHEMA_VERSION;
        // Always normalize the in-memory shape so downstream readers never see a
        // raw flat array, even if persistence fails.
        const categorized = coerceSkills(sd.skills);
        sd.skills = categorized;
        sd.skills_flat = flattenSkills(categorized);
        if (!needsMigration) return;
        sd._schema_version = PROFILE_SCHEMA_VERSION;
        try {
            if (typeof (this.db as any).updateDocumentStructuredData === 'function' && doc.id != null) {
                (this.db as any).updateDocumentStructuredData(doc.id, sd);
                console.log('[KnowledgeOrchestrator] Migrated resume skills to categorized v2 schema.');
            }
        } catch (err: any) {
            console.warn('[KnowledgeOrchestrator] Skills migration persist failed (non-fatal):', err?.message || err);
        }
    }

    /**
     * JD-side counterpart to migrateActiveResumeSkills. No real schema
     * migration exists yet for JD data (unlike resume's v1→v2 categorized-
     * skills migration) — this is intentionally a no-op today beyond
     * idempotently re-normalizing the cached JD and re-stamping
     * _schema_version. It exists so a future JD schema change has a
     * backfill mechanism to extend, rather than needing one invented from
     * scratch under time pressure (the JD side previously had no migration
     * hook at all, unlike resume).
     */
    private migrateActiveJDSchema(): void {
        const doc = this.activeJD;
        if (!doc?.structured_data || typeof doc.structured_data !== 'object') return;
        const sd = doc.structured_data as any;
        if (sd._schema_version === PROFILE_SCHEMA_VERSION) return;
        const normalized = normalizeStructuredJD(sd as StructuredJD);
        Object.assign(sd, normalized);
        sd._schema_version = PROFILE_SCHEMA_VERSION;
        try {
            if (typeof (this.db as any).updateDocumentStructuredData === 'function' && doc.id != null) {
                (this.db as any).updateDocumentStructuredData(doc.id, sd);
                console.log('[KnowledgeOrchestrator] Migrated JD to current schema version.');
            }
        } catch (err: any) {
            console.warn('[KnowledgeOrchestrator] JD schema migration persist failed (non-fatal):', err?.message || err);
        }
    }

    /** Stamp an active embedding-space key onto freshly-embedded nodes. */
    private _stampSpace(nodes: ContextNode[], space: string | undefined): ContextNode[] {
        if (!space) return nodes;
        for (const n of nodes) if (n.embedding) n.embedding_space = space;
        return nodes;
    }

    /**
     * Build the embedder ingest hands to the chunker. Prefers the
     * metadata-returning fn and records, per source text, which space produced
     * that vector. Keeping the chunker's `(text) => Promise<number[]>` signature
     * means neither DocumentChunker nor StarStoryGenerator has to change.
     */
    /**
     * Batch counterpart of the ingest embedder: ONE provider request per batch of
     * node texts, with the space that produced them recorded per text exactly as
     * _makeIngestEmbedFn does. Undefined when the host wired no batch embedder —
     * the chunker then embeds text by text, as it always has. See
     * DocumentChunker.embedTextsBatched for the measured failure this removes.
     */
    private _makeIngestEmbedBatchFn(producedSpaceByText: Map<string, string>): ((texts: string[]) => Promise<number[][]>) | undefined {
        const batch = this.embedBatchWithMetadataFn;
        if (!batch) return undefined;
        return async (texts: string[]): Promise<number[][]> => {
            const r = await batch(texts);
            if (r?.space) for (const t of texts) producedSpaceByText.set(t, r.space);
            return r?.embeddings ?? [];
        };
    }

    private _makeIngestEmbedFn(producedSpaceByText: Map<string, string>): (text: string) => Promise<number[]> {
        const withMeta = this.embedWithMetadataFn;
        const plain = this.embedFn;
        return async (text: string): Promise<number[]> => {
            if (withMeta) {
                const r = await withMeta(text);
                if (r?.space) producedSpaceByText.set(text, r.space);
                return r?.embedding ?? [];
            }
            if (!plain) throw new Error('no document embedder registered');
            return plain(text);
        };
    }

    /**
     * Stamp each node with the space that produced ITS vector, falling back to
     * the pre-call active space only where the producer reported nothing (the
     * legacy embedFn path). A node whose embedding failed carries no space.
     */
    private _stampProducedSpace(
        nodes: ContextNode[],
        producedSpaceByText: Map<string, string>,
        fallbackSpace: string | undefined,
    ): ContextNode[] {
        for (const n of nodes) {
            if (!n.embedding) continue;
            const produced = producedSpaceByText.get(n.text_content) ?? fallbackSpace;
            if (produced) n.embedding_space = produced;
        }
        return nodes;
    }

    /**
     * Converge the knowledge corpus onto a SINGLE, consistent embedding space and
     * record it as `_indexSpace` (which retrieval gating + query embedding key off).
     * Knowledge-base analogue of the meetings auto-reindex, but with all-or-nothing
     * semantics and a local-degrade fallback:
     *
     *   1. Target the active (cloud) space. Re-embed every node not already in it.
     *   2. If the cloud embedder can't bring the WHOLE corpus into the target space
     *      (sustained 429 / network down) AND a local embedder is available, DEGRADE:
     *      re-embed the ENTIRE corpus into the local space instead. Grounding then
     *      works at lower quality rather than going silently empty.
     *   3. Commit `_indexSpace` to whichever space the corpus is now FULLY in. If
     *      neither cloud nor local can produce a single consistent space, leave
     *      `_indexSpace` unset and let _committedIndexSpace() derive a safe value.
     *
     * The all-or-nothing rule is essential: a corpus split across two spaces is worse
     * than useless, because _spaceGatedNodes filters to ONE space, hiding the rest.
     * Idempotent; guarded against concurrent passes.
     */
    async ensureEmbeddingSpace(): Promise<void> {
        if (this._reembedInFlight) return;
        const embedFn = this.embedFn;
        const activeSpace = this.activeSpaceFn?.();
        const fast = this.fastQueryEmbedFn ? this.fastQueryEmbedFn() : null;
        const localSpace = fast?.space ?? null;
        const localEmbed = fast?.embed ?? null;

        // Nothing to anchor to at all (pipeline not ready, no local) → skip; a later
        // refreshCache retries once something is available.
        if (!activeSpace && !localSpace) return;

        // Debounce: if we recently converged AND the corpus is already fully in the
        // ACTIVE (cloud) space, skip — re-running would be a redundant full re-embed.
        // We only skip in the fully-healthy state: a degraded (_indexSpace===local) or
        // stale corpus is NOT debounced, so recovery + genuine re-embeds always proceed.
        if (
            activeSpace &&
            this._indexSpace === activeSpace &&
            (Date.now() - this._lastConvergeAt) < KnowledgeOrchestrator.REEMBED_DEBOUNCE_MS &&
            this.db.getNodesNeedingReembed(activeSpace).length === 0
        ) {
            return;
        }

        this._reembedInFlight = true;
        try {
            // ── Attempt 1: converge on the active (cloud) space ──────────────────
            if (activeSpace && embedFn) {
                const fullyConverged = await this._reembedCorpusTo(activeSpace, (t) => embedFn(t));
                if (fullyConverged) {
                    this._indexSpace = activeSpace;
                    this._lastConvergeAt = Date.now();
                    this.cachedNodes = this.db.getAllNodes();
                    return;
                }
                console.warn('[KnowledgeOrchestrator] Cloud embedder could not converge the corpus — attempting local degrade.');
            }

            // ── Attempt 2: degrade — converge the ENTIRE corpus on the local space ──
            if (localSpace && localEmbed) {
                const localFn = async (t: string): Promise<number[]> => {
                    const v = await localEmbed(t);
                    if (!Array.isArray(v) || v.length === 0) throw new Error('local embed returned empty');
                    return v;
                };
                const fullyLocal = await this._reembedCorpusTo(localSpace, localFn);
                if (fullyLocal) {
                    this._indexSpace = localSpace;
                    this._lastConvergeAt = Date.now();
                    this.cachedNodes = this.db.getAllNodes();
                    console.warn(`[KnowledgeOrchestrator] Degraded knowledge index to LOCAL space ${localSpace} (cloud embedder unavailable). Will restore on the next refresh once cloud recovers.`);
                    return;
                }
            }

            // Neither space could fully converge. Leave _indexSpace as-is (don't
            // commit a partial/mixed space); reload cache and let the next refresh retry.
            this.cachedNodes = this.db.getAllNodes();
            console.warn('[KnowledgeOrchestrator] ensureEmbeddingSpace could not converge the corpus on any single space; will retry next refresh.');
        } finally {
            this._reembedInFlight = false;
        }
    }

    /**
     * Re-embed every node NOT already in `targetSpace` using `embed`, in place.
     * Returns true iff, after the attempt, the WHOLE embedded corpus is in
     * `targetSpace` (i.e. zero nodes remain in any other space). Loop-until-empty
     * (bounded) so mid-pass arrivals converge; stops early if a pass makes no
     * progress (embedder failing). Pure DB writes — caller reloads cachedNodes.
     */
    private async _reembedCorpusTo(targetSpace: string, embed: (text: string) => Promise<number[]>): Promise<boolean> {
        const MAX_REEMBED_PASSES = 5;
        for (let pass = 0; pass < MAX_REEMBED_PASSES; pass++) {
            const stale = this.db.getNodesNeedingReembed(targetSpace);
            if (stale.length === 0) return true; // whole corpus is in targetSpace
            let passProgress = 0;
            for (const node of stale) {
                if (node.id == null) continue;
                try {
                    const vec = await embed(node.text_content);
                    if (Array.isArray(vec) && vec.length > 0) {
                        this.db.updateNodeEmbedding(node.id, vec, targetSpace);
                        passProgress++;
                    }
                } catch (e: any) {
                    console.warn(`[KnowledgeOrchestrator] Re-embed (→${targetSpace}) failed for node ${node.id}:`, e?.message || e);
                }
            }
            if (passProgress === 0) break; // embedder failing — stop; caller may degrade
        }
        // Did we get the whole corpus there?
        return this.db.getNodesNeedingReembed(targetSpace).length === 0;
    }

    /**
     * Memoized wrapper around processResume().
     * Re-processes only when the active resume document changes (checked by DB id).
     * Returns null if no resume is loaded.
     */
    private getProcessedResume(): ProcessedResumeData | null {
        if (!this.activeResume) return null;
        const docId = this.activeResume.id ?? null;
        if (this._processedResumeCache && this._processedResumeCache.docId === docId) {
            return this._processedResumeCache.result;
        }
        const structured = this.activeResume.structured_data as StructuredResume;
        const result = processResume(structured);
        this._processedResumeCache = { docId, result };
        return result;
    }

    // ============================================
    // Compact JD Header
    // ============================================

    /**
     * Generate a compact JD header (~150 tokens) for persona injection.
     */
    async generateCompactJDHeader(): Promise<string | null> {
        if (!this.activeJD || !this.generateContentFn) return null;

        const jd = this.activeJD.structured_data as StructuredJD;
        const prompt = `Create a compact summary (~150 tokens) of this job for persona tuning. Include: role title, level, company, top 3 technical themes, and key focus areas. Output a single paragraph, no markdown.

Job: ${jd.title} at ${jd.company}
Level: ${jd.level || 'mid'}
Location: ${jd.location}
Key Requirements: ${jd.requirements?.slice(0, 5).join(', ')}
Technologies: ${jd.technologies?.join(', ')}
Keywords: ${jd.keywords?.join(', ')}`;

        try {
            const header = await this.generateContentFn([{ text: prompt }]);
            return header.trim();
        } catch (error: any) {
            console.warn('[KnowledgeOrchestrator] Failed to generate compact JD header:', error.message);
            return `${jd.level || 'Mid-level'} ${jd.title} at ${jd.company}. Focus: ${jd.keywords?.slice(0, 3).join(', ') || jd.technologies?.slice(0, 3).join(', ') || 'general'}.`;
        }
    }

    /**
     * Get a deterministic compact JD header for persona merging.
     */
    getCompactJDHeader(): string | null {
        if (!this.activeJD) return null;
        const jd = this.activeJD.structured_data as StructuredJD;
        const levelStr = jd.level ? jd.level.charAt(0).toUpperCase() + jd.level.slice(1) : 'Mid-level';
        const techFocus = jd.technologies?.slice(0, 4).join(', ') || '';
        const keyThemes = jd.keywords?.slice(0, 3).join(', ') || '';
        // Bug fix 2026-07-28: StructuredExtractor's LLM path and
        // normalizeStructuredJD's heuristic-path fallback both fill an
        // absent location with the literal string 'Unknown Location'
        // (never blank) — so this ternary's falsy-check never actually
        // omitted the parenthetical once a JD went through either path. A
        // real location and the "we don't know" sentinel are both truthy
        // strings; only a real location should render.
        const hasKnownLocation = jd.location && jd.location !== 'Unknown Location';
        return `${levelStr} ${jd.title} at ${jd.company}${hasKnownLocation ? ` (${jd.location})` : ''}. Tech: ${techFocus}. Themes: ${keyThemes}.`;
    }

    /**
     * Build a deterministic context pack for category-listing PROFILE_DETAIL
     * questions ("what are my projects?", "list my work experience", "my
     * education", "what are my skills?") directly from the structured resume —
     * NO vector retrieval, NO query embedding, NO similarity threshold.
     *
     * Why this exists: vector retrieval (getRelevantNodes) drops nodes below a
     * 0.55 cosine threshold. A terse listing query embeds poorly and can return
     * zero project/experience/education nodes even when the resume clearly
     * contains them — the structural cause of the "I don't have access to your
     * projects" bug. For a question that is literally "list category X", we
     * already know the exact nodes to return: all of them. This guarantees
     * recall and removes the embedding round-trip from the hot path.
     *
     * Categories are derived from detectCategoryHints (the same keyword map the
     * boosting path uses), so it stays in sync. Node `category` values match the
     * DocumentChunker / formatContextBlock taxonomy ('experience', 'project',
     * 'education') so they render into the correct <candidate_*> XML blocks.
     *
     * Fully dynamic — every value comes from the uploaded resume; nothing is
     * hardcoded. Returns null when the question isn't a clean category listing
     * (so the normal retrieval path still handles nuanced queries).
     */
    /**
     * Build a real experience + achievements node pack from structured_data, used
     * as the zero-node fallback for candidate-directed fit/persona questions
     * ("why should they hire me?") that match no category keyword and return
     * nothing from retrieval. Gives the model genuine material to cite so it does
     * not invent metrics to fill the void. Fully dynamic; resume-derived.
     */
    private buildExperienceFallbackPack(resume: StructuredResume): ContextNode[] {
        const nodes: ContextNode[] = [];
        if (Array.isArray(resume.experience)) {
            for (const exp of resume.experience) {
                if (!exp?.role && !exp?.company) continue;
                const bullets = (exp.bullets || []).filter(Boolean);
                const dates = [exp.start_date, exp.end_date || 'Present'].filter(Boolean).join(' – ');
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'experience',
                    title: exp.role || 'Role',
                    organization: exp.company || '',
                    text_content: `${exp.role || 'Role'}${exp.company ? ` at ${exp.company}` : ''}${dates ? ` (${dates})` : ''}${bullets.length ? `\n  ${bullets.join('\n  ')}` : ''}`.trim(),
                    tags: [],
                });
            }
        }
        if (Array.isArray(resume.achievements)) {
            for (const ach of resume.achievements) {
                if (!ach?.title) continue;
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'achievement',
                    title: ach.title,
                    text_content: `${ach.title}${ach.description ? `: ${ach.description}` : ''}`.trim(),
                    tags: [],
                });
            }
        }
        // leadership[] is real resume content but is NOT a full-time role, so it
        // never lands in experience[] and — because the category keyword map only
        // reaches it via the literal word "leadership"/"led"/"managed" — an
        // org-named question ("your role at SEDS CUSAT", "what did you do for
        // TEDx") surfaces zero leadership nodes and the model DENIES real content
        // (fabrication). Seed it into the zero-node fallback so the org is always
        // groundable. Small array; negligible prompt cost.
        if (Array.isArray(resume.leadership)) {
            for (const lead of resume.leadership) {
                if (!lead?.role && !lead?.organization) continue;
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'leadership',
                    title: lead.role || 'Leadership',
                    organization: lead.organization || '',
                    text_content: `${lead.role || ''}${lead.organization ? ` at ${lead.organization}` : ''}${lead.description ? `: ${lead.description}` : ''}`.trim(),
                    tags: [],
                });
            }
        }
        return nodes;
    }

    private buildStructuredCategoryPack(question: string, resume: StructuredResume): ContextNode[] | null {
        const hints = detectCategoryHints(question);
        const qLower = question.toLowerCase();
        const mentions = (...words: string[]) => words.some(w => qLower.includes(w));

        // Skill/tooling questions are often phrased without any word in
        // detectCategoryHints' map: "what ML frameworks do I know?", "which
        // monitoring tools have you used?", "what tech stack...". Detect them
        // directly so skills still ground when hints is empty — otherwise a
        // whole class of tools/frameworks questions surfaces nothing.
        const skillKeywords = [
            'skill', 'tech stack', 'technolog', 'tech i know', 'languages i',
            'framework', 'frameworks', 'tools', 'tooling', 'tool ', 'stack',
            'proficient', 'proficien', 'comfortable with', 'familiar with',
            'languages', 'libraries', 'platforms',
        ];
        const skillFocused = mentions(...skillKeywords);

        // Bail only when there is neither a category hint NOR a skill signal.
        if (hints.length === 0 && !skillFocused) return null;

        const nodes: ContextNode[] = [];

        // detectCategoryHints intentionally over-maps for retrieval boosting:
        // 'skill'/'skills' → ['experience','project'] so a skills query also
        // boosts work/project nodes during vector search. For the DETERMINISTIC
        // pack that over-mapping bleeds: "what are my skills?" would dump every
        // experience and project node alongside the skills. So a category is
        // only emitted here when the question EXPLICITLY names it (or its direct
        // synonyms), not merely via the boosting map. `skillFocused` is the one
        // case that must not pull in experience/projects.
        const wants = (c: string) => {
            if (!hints.includes(c)) return false;
            // When the question is about skills, suppress the experience/project
            // bleed from the keyword map unless those categories are named too.
            if (skillFocused && (c === 'experience' || c === 'project')) {
                if (c === 'experience') return mentions('experience', 'work', 'job', 'role', 'employ', 'career');
                if (c === 'project') return mentions('project', 'built', 'build');
            }
            return true;
        };

        if (wants('project') && Array.isArray(resume.projects)) {
            for (const proj of resume.projects) {
                if (!proj?.name) continue;
                const tech = (proj.technologies || []).filter(Boolean);
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'project',
                    title: proj.name,
                    text_content: `${proj.name}: ${proj.description || ''}${tech.length ? `\n  Technologies: ${tech.join(', ')}` : ''}`.trim(),
                    tags: tech,
                });
            }
        }

        if (wants('experience') && Array.isArray(resume.experience)) {
            for (const exp of resume.experience) {
                if (!exp?.role && !exp?.company) continue;
                const bullets = (exp.bullets || []).filter(Boolean);
                const dates = [exp.start_date, exp.end_date || 'Present'].filter(Boolean).join(' – ');
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'experience',
                    title: exp.role || 'Role',
                    organization: exp.company || '',
                    text_content: `${exp.role || 'Role'}${exp.company ? ` at ${exp.company}` : ''}${dates ? ` (${dates})` : ''}${bullets.length ? `\n  ${bullets.join('\n  ')}` : ''}`.trim(),
                    tags: [],
                });
            }
        }

        if (wants('education') && Array.isArray(resume.education)) {
            for (const edu of resume.education) {
                if (!edu?.institution && !edu?.degree) continue;
                const degree = [edu.degree, edu.field].filter(Boolean).join(', ');
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'education',
                    title: degree || edu.institution || 'Education',
                    organization: edu.institution || '',
                    text_content: `${degree || 'Studies'}${edu.institution ? ` — ${edu.institution}` : ''}${edu.end_date ? ` (${edu.end_date})` : ''}`.trim(),
                    tags: [],
                });
            }
        }

        if (wants('achievement') && Array.isArray(resume.achievements)) {
            for (const ach of resume.achievements) {
                if (!ach?.title) continue;
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'achievement',
                    title: ach.title,
                    text_content: `${ach.title}${ach.description ? `: ${ach.description}` : ''}`.trim(),
                    tags: [],
                });
            }
        }

        if (wants('certification') && Array.isArray(resume.certifications)) {
            for (const cert of resume.certifications) {
                if (!cert?.name) continue;
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'certification',
                    title: cert.name,
                    text_content: `${cert.name}${cert.issuer ? ` — ${cert.issuer}` : ''}`.trim(),
                    tags: [],
                });
            }
        }

        // Leadership emits when the question names the category ("leadership",
        // "led", "managed") OR when it references a leadership ORG by name. The
        // keyword map routes "your role at SEDS CUSAT" to `experience` (via the
        // word "role"), so without the org-name check the SEDS/TEDx leadership
        // entries stay invisible and the model fabricates a denial. Org matching
        // is fully dynamic — the org strings come from the resume itself.
        if (Array.isArray(resume.leadership)) {
            const namesLeadershipOrg = (org: string): boolean => {
                const o = (org || '').toLowerCase().trim();
                if (!o) return false;
                if (qLower.includes(o)) return true;
                // Match on the distinctive org token(s) too, ignoring generic
                // suffixes so a "<Org> <Institution>" entry matches "<Org>".
                const tokens = o.split(/[^a-z0-9]+/).filter((t) => t.length >= 3
                    && !['the', 'and', 'chapter', 'club', 'society', 'team', 'university', 'college'].includes(t));
                return tokens.some((t) => qLower.includes(t));
            };
            for (const lead of resume.leadership) {
                if (!lead?.role && !lead?.organization) continue;
                if (!wants('leadership') && !namesLeadershipOrg(String(lead.organization || ''))) continue;
                nodes.push({
                    source_type: DocType.RESUME,
                    category: 'leadership',
                    title: lead.role || 'Leadership',
                    organization: lead.organization || '',
                    text_content: `${lead.role || ''}${lead.organization ? ` at ${lead.organization}` : ''}${lead.description ? `: ${lead.description}` : ''}`.trim(),
                    tags: [],
                });
            }
        }

        // RC-3: skills are sub-categorized (CategorizedSkills). Map the question
        // to the specific bucket(s) it targets so "what cloud tools do I know?"
        // returns the CLOUD bucket — not the entire flat skill list (the old bug).
        // A generic skills question ("what are my skills?") emits all buckets.
        if (skillFocused) {
            const skills = coerceSkills(resume.skills);
            const targeted = detectSkillCategories(qLower);
            const cats = targeted.length > 0 ? targeted : SKILL_CATEGORIES;
            const SKILL_CATEGORY_LABEL: Record<string, string> = {
                languages: 'Programming Languages', frameworks: 'Frameworks & Libraries',
                cloud: 'Cloud & Platforms', databases: 'Databases', ml: 'AI / ML',
                devops: 'DevOps & Infrastructure', tools: 'Tools',
            };
            for (const cat of cats) {
                const items = (skills as any)[cat] as string[];
                if (!items || items.length === 0) continue;
                nodes.push({
                    source_type: DocType.RESUME,
                    category: `skills_${cat}`,
                    title: SKILL_CATEGORY_LABEL[cat] || cat,
                    text_content: `${SKILL_CATEGORY_LABEL[cat] || cat}: ${items.join(', ')}`,
                    tags: items,
                });
            }
            // If the question explicitly named a category but the candidate has
            // nothing there, emit an explicit empty marker so the model can say
            // "you have no cloud skills listed" instead of refusing or guessing.
            if (targeted.length > 0 && nodes.filter(n => String(n.category).startsWith('skills_')).length === 0) {
                const label = SKILL_CATEGORY_LABEL[targeted[0]] || targeted[0];
                nodes.push({
                    source_type: DocType.RESUME,
                    category: `skills_${targeted[0]}`,
                    title: label,
                    text_content: `${label}: (none listed on the resume)`,
                    tags: [],
                });
            }
        }

        if (nodes.length === 0) return null;
        console.log(`[KnowledgeOrchestrator] Deterministic structured pack: ${nodes.length} node(s) for categories [${hints.join(', ')}] — bypassing vector search`);
        return nodes;
    }

    /**
     * Build a compact, dynamic identity block for the inclusion-bias path in
     * processQuestion() — name, current role/employer, and target role/company
     * from the active resume/JD. Returned in `contextBlock` (not
     * systemPromptInjection) so it's prepended as context with the base system
     * prompt left intact.
     *
     * Tiny and self-labeled so the model uses it only when the question is
     * actually about the candidate (the false-skip mitigation): an ambiguous
     * question that secretly needed the user's context gets the essentials at
     * ~zero token cost, while heavy retrieval (resume chunks, dossier, salary)
     * is still skipped. Returns '' when no resume is loaded.
     *
     * Fully dynamic — every value comes from the uploaded resume/JD; no
     * candidate/company/role values are hardcoded. All interpolated fields are
     * XML-escaped so resume content containing `<`/`>`/`&` (or an injected
     * `</candidate_identity>`) cannot break out of the block.
     */
    private buildCompactIdentityBlock(): string {
        if (!this.activeResume) return '';
        try {
            const resume = this.activeResume.structured_data as StructuredResume;
            const name = resume.identity?.name?.trim();
            const latest = resume.experience?.[0];
            const facts: string[] = [];
            if (name) facts.push(`Name: ${escapeXml(name)}`);
            if (latest?.role) {
                facts.push(`Current role: ${escapeXml(latest.role)}${latest.company ? ` at ${escapeXml(latest.company)}` : ''}`);
            }
            if (this.activeJD) {
                const jd = this.activeJD.structured_data as StructuredJD;
                if (jd.title) {
                    facts.push(`Target role: ${escapeXml(jd.title)}${jd.company ? ` at ${escapeXml(jd.company)}` : ''}`);
                }
            }
            if (facts.length === 0) return '';
            return `<candidate_identity note="background only; ignore for purely generic/technical questions">\n${facts.join('\n')}\n</candidate_identity>\n` +
                `The above identifies the user. If the question is about the user (their fit, their decisions, their situation), answer from it in first person. If it's a generic/technical question, ignore this block and answer normally.`;
        } catch {
            return '';
        }
    }

    // Temporary helper for UI compatibility while refactoring
    getProfileData(): any {
        // RC-8 fix: an uploaded JD must be visible even before a resume exists.
        // Previously this returned null whenever activeResume was missing, so a
        // JD-only session showed nothing in the UI despite the JD ingesting fine.
        if (!this.activeResume && !this.activeJD) return null;

        // JD data (computed regardless of resume presence)
        let jdData = null;
        if (this.activeJD) {
            const jd = this.activeJD.structured_data as StructuredJD;
            jdData = {
                title: jd.title || (jd as any).role || 'Unknown Title',
                company: jd.company || '',
                location: jd.location || 'Unknown Location',
                level: jd.level,
                requirements: jd.requirements,
                technologies: jd.technologies,
                keywords: jd.keywords,
                compensation_hint: normalizeCompensationHint(jd.compensation_hint),
                min_years_experience: jd.min_years_experience
            };
        }

        // JD-only session: no resume yet. Return a minimal payload so the UI can
        // render the uploaded JD instead of treating the whole profile as absent.
        if (!this.activeResume) {
            return {
                identity: null,
                skills: [],
                experienceCount: 0,
                projectCount: 0,
                educationCount: 0,
                nodeCount: 0,
                experience: [],
                projects: [],
                education: [],
                activeJD: jdData,
                hasActiveJD: this.activeJD !== null,
                gapAnalysis: null,
                negotiationScript: null,
                coverLetter: null,
                // Hydrate any prior company-research dossier from disk so the panel
                // doesn't lose state across restarts (covers JD-only sessions too).
                companyDossier: jdData?.company ? this.companyResearch.getCachedDossier(jdData.company) : null,
                mockQuestions: null,
                cultureMappings: null,
                aotStatus: this.aotPipeline.getStatus(),
                compactPersona: this.getCompactJDHeader() || 'Job-Aware Mode Active',
                toneDirective: this.depthScorer.getToneDirective()
            };
        }

        try {
            const structured = this.activeResume.structured_data as StructuredResume;

            // Get AOT results
            const gapAnalysis = this.getGapAnalysis();
            const negotiationScript = this.getNegotiationScript();
            const coverLetter = this.getCoverLetter();
            const mockQuestions = this.getMockQuestions();
            const cultureMappings = this.getCultureMappings();
            const aotStatus = this.aotPipeline.getStatus();
            // Pull the cached dossier so the panel rehydrates its rendered state
            // automatically when the app restarts. Saved by CompanyResearchEngine
            // on every successful research (writes to the company_dossiers table).
            const companyDossier = jdData?.company ? this.companyResearch.getCachedDossier(jdData.company) : null;

            const categorizedSkills = coerceSkills(structured.skills);
            return {
                identity: structured.identity,
                // Categorized skills object (RC-3) + a derived flat list so any
                // older UI code that treats skills as an array keeps working.
                skills: categorizedSkills,
                skillsFlat: flattenSkills(categorizedSkills),
                experienceCount: structured.experience?.length || 0,
                projectCount: structured.projects?.length || 0,
                educationCount: structured.education?.length || 0,
                nodeCount: this.db.getNodeCount(DocType.RESUME),

                // Expose raw data for detailed visualizations
                experience: structured.experience || [],
                projects: structured.projects || [],
                education: structured.education || [],

                // JD context
                activeJD: jdData,
                hasActiveJD: this.activeJD !== null,

                // AOT pipeline results
                gapAnalysis,
                negotiationScript,
                coverLetter,
                companyDossier,
                mockQuestions,
                cultureMappings,
                aotStatus,

                // Dynamic persona info
                compactPersona: this.getCompactJDHeader() || 'Resume-Aware Mode Active',
                toneDirective: this.depthScorer.getToneDirective()
            };
        } catch {
            return null;
        }
    }

    /**
     * Feed an interviewer's STT transcript to the technical depth scorer and negotiation tracker.
     * Call this ONLY from the verified STT path in main.ts where speaker === 'interviewer'.
     */
    feedInterviewerUtterance(text: string): void {
        this.depthScorer.addUtterance(text);
        this.negotiationTracker.addRecruiterUtterance(text);
    }

    /**
     * Feed text to the depth scorer only — does NOT touch the negotiation tracker.
     * Use this from chatWithGemini/streamChat where the message is the user's question to the AI,
     * not a verified recruiter utterance. Prevents misclassifying user questions as recruiter offers.
     */
    feedForDepthScoring(text: string): void {
        this.depthScorer.addUtterance(text);
    }

    getNegotiationTracker(): NegotiationConversationTracker {
        return this.negotiationTracker;
    }

    resetNegotiationSession(): void {
        this.negotiationTracker.reset(); this._lastNegotiationTurnAt = 0; this._nonCompTurnsSinceNegotiation = 0;
    }

    /**
     * Get extracted vocabulary for STT hints, filtering out long sentences.
     */
    getVocabularyHints(): string[] {
        const hints = new Set<string>();
        if (this.activeJD) {
            const jd = this.activeJD.structured_data as StructuredJD;
            if (jd.company) hints.add(jd.company);
            if (jd.title) hints.add(jd.title);
            jd.technologies?.forEach(t => hints.add(t));
            jd.keywords?.forEach(k => hints.add(k));

            // Only include short, keyword-like entries for STT hints
            for (const req of (jd.requirements || [])) {
                if (req.trim().split(/\s+/).length <= 3) {
                    hints.add(req.trim());
                }
            }
        }
        return Array.from(hints);
    }
}

