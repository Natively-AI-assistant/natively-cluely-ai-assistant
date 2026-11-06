// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { CompanyResearchEngine } from "./CompanyResearchEngine";
import { TechnicalDepthScorer } from "./TechnicalDepthScorer";
import { AOTPipeline } from "./AOTPipeline";
import { SalaryIntelligenceEngine } from "./SalaryIntelligenceEngine";
import { NegotiationConversationTracker } from "./NegotiationConversationTracker";
import { isProfileGroundingV2Enabled } from "../../../electron/llm/profileGroundingV2";
import * as ProfilePackBuilder_exports from "../../../electron/services/knowledge/ProfilePackBuilder";
import { RoleInsightDatabase } from "./roleInsight/RoleInsightDatabase";
import { RoleInsightService } from "./roleInsight/RoleInsightService";
import * as NegotiationEngine_exports from "./NegotiationEngine";
import * as CoverLetterEngine_exports from "./CoverLetterEngine";
import { extractDocumentText } from "./DocumentReader";
import { extractStructuredData } from "./StructuredExtractor";
import { heuristicResumeExtract } from "./HeuristicExtractor";
import { heuristicJDExtract } from "./HeuristicExtractor";
import { normalizeStructuredResume } from "./StructuredResumeNormalizer";
import { processResume } from "./PostProcessor";
import { normalizeStructuredJD } from "./StructuredJDNormalizer";
import { PROFILE_SCHEMA_VERSION } from "./types";
import { chunkAndEmbedDocument } from "./DocumentChunker";
import { generateStarStoryNodes } from "./StarStoryGenerator";
import { isIntelligenceFlagEnabled } from "../../../electron/intelligence/intelligenceFlags";
import { buildGroundingBlock } from "./ProfileContextBuilder";
import { classifyIntentWithContext } from "./IntentClassifier";
import { looksLikeGarbledComp } from "./IntentClassifier";
import { INTRO_PATTERNS as INTRO_PATTERNS3 } from "./IntentClassifier";
import { flattenSkills } from "./skillsUtil";
import { isJdFactualLookupNotNegotiationAdvice } from "../../../electron/llm/AnswerPlanner";
import { isGenericKnowledgeQuestion } from "./IntentClassifier";
import { planAnswer } from "../../../electron/llm/AnswerPlanner";
import { isLayerAllowed } from "../../../electron/llm/contextRoute";
import { detectCategoryHints } from "./HybridSearchEngine";
import { isProfileGroundingV2JdFitCoverageEnabled } from "../../../electron/llm/profileGroundingV2";
import { getRelevantNodes } from "./HybridSearchEngine";
import { needsCompanyResearch } from "./IntentClassifier";
import { jdContextFromStructured } from "./CompanyResearchEngine";
import { formatDossierBlock } from "./HybridSearchEngine";
import { generateLiveCoachingResponse } from "./LiveNegotiationAdvisor";
import { assemblePromptContext } from "./ContextAssembler";
import { findRelevantValueAlignments } from "./CultureValuesMapper";
import { formatValueAlignmentBlock } from "./CultureValuesMapper";
import { isLegacyFlatSkills } from "./skillsUtil";
import { coerceSkills } from "./skillsUtil";
import { detectSkillCategories } from "./skillsUtil";
import { SKILL_CATEGORIES } from "./types";
import { escapeXml } from "./NegotiationConversationTracker";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e3) {
    throw err = [e3], e3;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e3) {
    throw mod = 0, e3;
  }
};
var __export = (target, all3) => {
  for (var name in all3)
    __defProp(target, name, { get: all3[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
void 0;
void 0;
// premium/electron/knowledge/KnowledgeOrchestrator.ts
void 0;
void 0;
void 0;
// premium/electron/knowledge/KnowledgeOrchestrator.ts
var normalizeCompensationHint = (raw) => {
    if (raw == null || raw === "")
        return "";
    const s3 = String(raw);
    return s3.replace(/-{2,}/g, "\u2013").replace(/\s+–\s+/g, " \u2013 ");
};
var KnowledgeOrchestrator = class _KnowledgeOrchestrator {
    db;
    knowledgeModeActive = false;
    depthScorer;
    aotPipeline;
    salaryEngine;
    negotiationTracker;
    // Cached state for fast retrieval
    activeResume = null;
    activeJD = null;
    cachedNodes = [];
    // Conversational negotiation stickiness: the timestamp of the last turn that
    // classified as NEGOTIATION. While recent (within the window), ambiguous
    // follow-ups ("what are your expectations?", "give me the number") stay
    // negotiation-aware so the salary intelligence keeps applying across a
    // multi-turn comp conversation instead of being lost per-utterance.
    _lastNegotiationTurnAt = 0;
    static NEGOTIATION_STICKY_WINDOW_MS = 4 * 60 * 1e3;
    // 4 min
    // Decay (not just wall-clock): count consecutive substantive non-comp turns
    // since the last negotiation turn. After this many, stickiness is dropped even
    // if still inside the time window — prevents a behavioral/fit detour mid-thread
    // from inheriting comp routing for the full 4 minutes.
    _nonCompTurnsSinceNegotiation = 0;
    static NEGOTIATION_DECAY_TURNS = 2;
    /** Memoized result of processResume() keyed on the resume document's DB id. */
    _processedResumeCache = null;
    // Injected dependencies
    generateContentFn = null;
    // Latency-critical LLM fn for LIVE negotiation coaching (spoken in real time).
    // Wired to a Flash-first generation chain so the live tactical note appears
    // fast; falls back to generateContentFn when unset. The AOT negotiation SCRIPT
    // and all extraction keep using the quality-first generateContentFn.
    liveCoachingContentFn = null;
    embedFn = null;
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
    embedWithMetadataFn = null;
    // Batch counterpart, optional: one provider request per batch of node texts at ingest.
    embedBatchWithMetadataFn = null;
    // Cloud QUERY embedder (asymmetric — applies the retrieval task prefix, e.g.
    // Gemini v2 `task: search result | query:`). Produces vectors in the SAME space
    // as embedFn (same model/dims/endpoint, only the task framing differs), so it's
    // space-safe to use for queries while documents use embedFn. Optional — when
    // unset, the cloud query path falls back to embedFn (document framing).
    embedQueryFn = null;
    // Fast on-device query embedder (bundled MiniLM, ~10ms) used for the
    // latency-critical query path INSTEAD of embedFn (which may be a ~100-200ms
    // cloud call). Only used when its output dimension matches the indexed
    // nodes' dimension — otherwise cosine similarity silently returns 0 (see
    // HybridSearchEngine), so we fall back to embedFn. Returns null on failure.
    fastQueryEmbedFn = null;
    /**
     * Returns the active document-embedder's composite space key (`${name}:${model}:${dims}`),
     * matching what embedFn produces. Used to (a) stamp ingested nodes, (b) detect nodes
     * embedded in an OLD space and re-embed them, (c) gate retrieval to space-matching nodes
     * so a v1 node is never cosine-compared against a v2 query. Undefined when the pipeline
     * isn't ready — callers then skip the space gate (best-effort, same as pre-feature).
     */
    activeSpaceFn = null;
    /** Guards against concurrent re-embed passes. */
    _reembedInFlight = false;
    /**
     * Wall-clock of the last COMPLETED convergence attempt. Used to debounce rapid
     * re-convergence: refreshCache fires on every ingest + the startup kick, and a
     * flapping cloud would otherwise re-embed the whole corpus local↔cloud on each
     * fire. Within the debounce window, if the corpus is already fully in a committed
     * space we skip the attempt (it would be redundant). A genuine pending re-embed
     * (stale nodes) always runs regardless of the window. Tiny corpus, so this is a
     * cost-smoothing nicety, not a correctness gate.
     */
    _lastConvergeAt = 0;
    static REEMBED_DEBOUNCE_MS = 6e4;
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
    _indexSpace = void 0;
    // Phase 1: transcript-aware intent hint. The app layer (which owns the
    // SessionTracker / rolling ~180s transcript) registers a provider that
    // returns a lightweight verdict so the premium package never imports
    // app-layer state. Used to recognize a comp thread even where the live
    // NegotiationConversationTracker isn't fed interviewer STT (e.g. typed chat).
    conversationContextProvider = null;
    // Company research engine
    companyResearch;
    // Resolves the current company-research search provider (Tavily key →
    // Natively key → null) at AOT time. Injected by the app layer (main.ts)
    // like setGenerateContentFn, so the premium package never imports
    // CredentialsManager. Resolved PER RUN — not once at startup — because
    // keys can be added, changed, or removed mid-session.
    searchProviderResolver = null;
    // Is company research contextually appropriate right now? Injected by the
    // app layer (main.ts) like setSearchProviderResolver, so this package never
    // imports ModesManager. Resolved PER CALL — the user switches modes
    // mid-session, and a cached verdict would be wrong the moment they do.
    //
    // UNSET means allow, so a host that does not wire this keeps today's
    // behaviour byte for byte. The host opts in; the submodule never narrows
    // behaviour on its own.
    companyResearchAllowedFn = null;
    // Role Insight (2026-08-04). Attached by the app layer with the raw sqlite
    // handle — the orchestrator only holds a KnowledgeDatabaseManager, and Role
    // Insight owns tables that manager does not know about. Lazily constructed
    // so a build without the feature (or a DB that failed to open) simply has
    // no service, and every consumer null-checks.
    roleInsightService = null;
    constructor(db2) {
        this.db = db2;
        this.db.initializeSchema();
        this.companyResearch = new CompanyResearchEngine(db2);
        this.depthScorer = new TechnicalDepthScorer();
        this.aotPipeline = new AOTPipeline(db2, this.companyResearch);
        this.salaryEngine = new SalaryIntelligenceEngine();
        this.negotiationTracker = new NegotiationConversationTracker();
        this.refreshCache();
    }
    // ============================================
    // Configuration
    // ============================================
    setGenerateContentFn(fn) {
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
    setSearchProviderResolver(fn) {
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
    setCompanyResearchAllowedFn(fn) {
        this.companyResearchAllowedFn = fn;
    }
    /** Unset, or a throwing predicate, means allow — see setCompanyResearchAllowedFn. */
    isCompanyResearchAllowed() {
        if (!this.companyResearchAllowedFn)
            return true;
        try {
            return this.companyResearchAllowedFn() !== false;
        }
        catch {
            return true;
        }
    }
    /**
     * Optional low-latency generation fn for LIVE negotiation coaching only.
     * When set, the live tactical-note path uses it (Flash-first) so the spoken
     * coaching appears fast; everything else keeps the quality-first fn. Safe to
     * leave unset — the live path falls back to generateContentFn.
     */
    setLiveCoachingContentFn(fn) {
        this.liveCoachingContentFn = fn;
    }
    setEmbedFn(fn) {
        this.embedFn = fn;
    }
    /**
     * Register the metadata-returning document embedder. Ingest prefers this over
     * setEmbedFn so a mid-ingest provider degrade is recorded per node instead of
     * being papered over with the space that was active before the call.
     */
    /** One provider request for many texts, reporting the space that produced them. Optional. */
    setEmbedBatchWithMetadataFn(fn) {
        this.embedBatchWithMetadataFn = fn;
    }
    setEmbedWithMetadataFn(fn) {
        this.embedWithMetadataFn = fn;
    }
    /**
     * Register the cloud QUERY embedder (asymmetric retrieval framing). Must produce
     * vectors in the SAME embedding space as setEmbedFn's document embedder — same
     * provider/model/dims, only the task prefix differs (e.g. Gemini v2's
     * `task: search result | query:` vs the document's `title: | text:`). Optional;
     * when unset the cloud query path uses embedFn (document framing) as before.
     */
    setEmbedQueryFn(fn) {
        this.embedQueryFn = fn;
    }
    /**
     * Register a function returning the active document-embedder's composite space key.
     * Enables space-aware re-embedding + retrieval gating (the v1/v2 fix). Optional —
     * when unset, behavior falls back to the prior dimension-only guard.
     */
    setActiveSpaceFn(fn) {
        this.activeSpaceFn = fn;
    }
    /**
     * Phase 1: register the transcript-aware conversation-context provider. The
     * app layer reads the rolling ~180s transcript (SessionTracker), inspects the
     * last 1-2 INTERVIEWER turns for comp evidence, and returns a small verdict.
     * Called synchronously at classification time in processQuestion. Optional —
     * when unset, routing falls back to the tracker + sticky-window heuristics.
     */
    setConversationContextProvider(fn) {
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
    setFastQueryEmbedFn(fn) {
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
    _committedIndexSpace() {
        if (this._indexSpace)
            return this._indexSpace;
        const active = this.activeSpaceFn?.();
        if (active)
            return active;
        const counts = /* @__PURE__ */ new Map();
        for (const n2 of this.cachedNodes) {
            if (n2.embedding && n2.embedding_space)
                counts.set(n2.embedding_space, (counts.get(n2.embedding_space) ?? 0) + 1);
        }
        let best;
        let bestN = 0;
        for (const [space, n2] of counts)
            if (n2 > bestN) {
                best = space;
                bestN = n2;
            }
        return best;
    }
    /**
     * Nodes eligible for retrieval scoring: those embedded in the COMMITTED index
     * space. Keyword-only nodes (no embedding) always survive. Nodes in any OTHER
     * space (stale v1, or mid-migration) are EXCLUDED so they can't be cosine-
     * compared against a query vector produced in the committed space. When no
     * committed space can be derived (empty corpus), don't gate (nothing to protect).
     */
    _spaceGatedNodes() {
        const indexSpace = this._committedIndexSpace();
        if (!indexSpace)
            return this.cachedNodes;
        return this.cachedNodes.filter((n2) => !n2.embedding || n2.embedding_space === indexSpace);
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
    cloudQueryEmbedder() {
        const raw = this.embedQueryFn ?? this.embedFn;
        if (!raw)
            return null;
        const QUERY_EMBED_BUDGET_MS = 300;
        return async (text4) => {
            try {
                const result = await Promise.race([
                    raw(text4),
                    new Promise((resolve3) => setTimeout(() => resolve3([]), QUERY_EMBED_BUDGET_MS))
                ]);
                return Array.isArray(result) ? result : [];
            }
            catch {
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
    resolveBatchQueryEmbedder() {
        const indexSpace = this._committedIndexSpace();
        const fast = this.fastQueryEmbedFn ? this.fastQueryEmbedFn() : null;
        const fastUsable = !!fast && fast.dimensions != null;
        const cloudRaw = this.embedQueryFn ?? this.embedFn;
        const strict = (embed) => async (text4) => {
            const v2 = await embed(text4);
            if (!Array.isArray(v2) || v2.length === 0) {
                throw new Error("embedder returned no vector");
            }
            return v2;
        };
        if (indexSpace) {
            if (fastUsable && fast.space && fast.space === indexSpace) {
                return strict(fast.embed);
            }
            return cloudRaw ? strict(cloudRaw) : null;
        }
        if (!fastUsable)
            return cloudRaw ? strict(cloudRaw) : null;
        const indexedDim = this.cachedNodes.find((n2) => n2.embedding && n2.embedding.length > 0)?.embedding?.length ?? null;
        if (indexedDim != null && indexedDim !== fast.dimensions) {
            return cloudRaw ? strict(cloudRaw) : null;
        }
        const fastEmbed = fast.embed;
        return async (text4) => {
            const v2 = await fastEmbed(text4);
            if (Array.isArray(v2) && v2.length > 0)
                return v2;
            if (cloudRaw)
                return strict(cloudRaw)(text4);
            throw new Error("no embedder produced a vector");
        };
    }
    resolveQueryEmbedder() {
        const indexSpace = this._committedIndexSpace();
        const fast = this.fastQueryEmbedFn ? this.fastQueryEmbedFn() : null;
        const fastUsable = !!fast && fast.dimensions != null;
        if (indexSpace) {
            if (fastUsable && fast.space && fast.space === indexSpace) {
                const fastEmbed2 = fast.embed;
                return async (text4) => {
                    const v2 = await fastEmbed2(text4);
                    return Array.isArray(v2) && v2.length > 0 ? v2 : [];
                };
            }
            return this.cloudQueryEmbedder();
        }
        if (!fastUsable)
            return this.cloudQueryEmbedder();
        const indexedDim = this.cachedNodes.find((n2) => n2.embedding && n2.embedding.length > 0)?.embedding?.length ?? null;
        if (indexedDim != null && indexedDim !== fast.dimensions) {
            return this.cloudQueryEmbedder();
        }
        const fastEmbed = fast.embed;
        const fallback = this.cloudQueryEmbedder();
        return async (text4) => {
            const v2 = await fastEmbed(text4);
            if (Array.isArray(v2) && v2.length > 0)
                return v2;
            if (fallback)
                return fallback(text4);
            return [];
        };
    }
    setKnowledgeMode(enabled3) {
        const hasGroundableDoc = isProfileGroundingV2Enabled() ? this.activeResume !== null || this.activeJD !== null : this.activeResume !== null;
        if (enabled3 && !hasGroundableDoc) {
            console.warn("[KnowledgeOrchestrator] Cannot enable knowledge mode: no resume or JD loaded");
            return;
        }
        this.knowledgeModeActive = enabled3;
        console.log(`[KnowledgeOrchestrator] Knowledge mode ${enabled3 ? "ENABLED" : "DISABLED"}`);
    }
    isKnowledgeMode() {
        if (isProfileGroundingV2Enabled()) {
            return this.knowledgeModeActive && (this.activeResume !== null || this.activeJD !== null);
        }
        return this.knowledgeModeActive && this.activeResume !== null;
    }
    /**
     * Get the company research engine for external use (e.g., IPC handlers).
     */
    getCompanyResearchEngine() {
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
    _generateProfileOkfPack(kind2, force = false) {
        try {
            const mod = (void 0, __toCommonJS(ProfilePackBuilder_exports));
            const builder = mod.ProfilePackBuilder.getInstance();
            if (kind2 === "resume") {
                if (!this.activeResume)
                    return;
                const processed = this.getProcessedResume();
                builder.generateForProfile({
                    kind: "resume",
                    docId: this.activeResume.id ?? "resume",
                    structuredData: this.activeResume.structured_data,
                    totalExperienceYears: processed?.totalExperienceYears ?? 0
                }, force);
            }
            else {
                if (!this.activeJD)
                    return;
                builder.generateForProfile({
                    kind: "jd",
                    docId: this.activeJD.id ?? "jd",
                    structuredData: this.activeJD.structured_data,
                    artifacts: {
                        gapAnalysis: this.getGapAnalysis(),
                        negotiationScript: this.getNegotiationScript(),
                        mockQuestions: this.getMockQuestions(),
                        cultureMappings: this.getCultureMappings(),
                        intro: this.activeJD?.id ? this.db.getIntro(this.activeJD.id) : null
                    }
                }, force);
            }
        }
        catch (err) {
            console.warn("[KnowledgeOrchestrator] profile OKF pack generation skipped:", err?.message || err);
        }
    }
    /**
     * Get the AOT pipeline for status and results.
     */
    getAOTPipeline() {
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
    attachRoleInsight(rawDb) {
        if (this.roleInsightService)
            return;
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
                generateContentFn: async (contents) => {
                    if (!this.generateContentFn)
                        throw new Error("Analysis model is not configured.");
                    return this.generateContentFn(contents);
                },
                // Resolved per CALL, not captured once: the embedder choice can
                // change mid-session. Uses the BATCH variant — the hot-path
                // resolveQueryEmbedder carries a 300ms budget that resolves an
                // EMPTY vector, which for an analysis run silently disables
                // semantic retrieval and fabricates false gaps (F1).
                embedFn: async (text4) => {
                    const embedder = this.resolveBatchQueryEmbedder();
                    if (!embedder)
                        throw new Error("No embedding pipeline available");
                    return embedder(text4);
                },
                getSearchProvider: () => this.searchProviderResolver?.() ?? null,
                appendProfileEvidence: (claim, label) => this._appendUserConfirmedEvidence(claim, label),
                // Semantic-admission gate (Phase 1): resolved per CALL like
                // embedFn — the committed space can change mid-session (cloud →
                // local degrade), and a floor calibrated for the wrong space is
                // exactly the cross-space hazard the space keys exist to prevent.
                getEmbeddingSpaceKey: () => this._committedIndexSpace() ?? null
            });
            console.log("[KnowledgeOrchestrator] Role Insight attached");
        }
        catch (e3) {
            console.error("[KnowledgeOrchestrator] Failed to attach Role Insight:", e3?.message);
            this.roleInsightService = null;
        }
    }
    getRoleInsightService() {
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
    async _appendUserConfirmedEvidence(claim, label) {
        try {
            if (!this.activeResume?.id) {
                console.warn("[KnowledgeOrchestrator] Cannot append confirmed evidence: no active r\xE9sum\xE9.");
                return false;
            }
            let embedding;
            let embeddingSpace;
            if (this.embedWithMetadataFn || this.embedFn) {
                try {
                    if (this.embedWithMetadataFn) {
                        const r3 = await this.embedWithMetadataFn(claim);
                        embedding = r3?.embedding;
                        embeddingSpace = r3?.space ?? void 0;
                    }
                    else {
                        embedding = await this.embedFn(claim);
                        embeddingSpace = this.activeSpaceFn?.();
                    }
                }
                catch (e3) {
                    console.warn("[KnowledgeOrchestrator] Confirmed evidence saved without an embedding:", e3?.message);
                }
            }
            this.db.saveNodes([{
                    source_type: "resume" /* RESUME */,
                    category: "experience",
                    title: label,
                    text_content: claim,
                    tags: ["user_confirmed", "role_insight"],
                    embedding,
                    embedding_space: embedding ? embeddingSpace ?? this.activeSpaceFn?.() : void 0
                }], this.activeResume.id);
            this.refreshCache();
            return true;
        }
        catch (e3) {
            console.error("[KnowledgeOrchestrator] Failed to append confirmed evidence:", e3?.message);
            return false;
        }
    }
    /**
     * Get cached gap analysis from AOT pipeline or DB.
     */
    getGapAnalysis() {
        const cached3 = this.aotPipeline.getCachedGapAnalysis();
        if (cached3)
            return cached3;
        if (this.activeJD?.id) {
            return this.db.getGapAnalysis(this.activeJD.id);
        }
        return null;
    }
    /**
     * Get cached negotiation script from AOT pipeline or DB.
     */
    getNegotiationScript() {
        const cached3 = this.aotPipeline.getCachedNegotiationScript();
        if (cached3)
            return cached3;
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
    getResumeSalaryEstimate() {
        try {
            const cached3 = this.salaryEngine.getCachedEstimate();
            if (cached3)
                return cached3;
            const structured = this.activeResume?.structured_data;
            if (!structured?.identity)
                return null;
            const persisted = this.db.getSalaryEstimate();
            if (!persisted)
                return null;
            if (persisted.cacheKey !== SalaryIntelligenceEngine.cacheKeyFor(structured))
                return null;
            const estimate = persisted.estimate;
            if (typeof estimate?.min !== "number" || typeof estimate?.max !== "number")
                return null;
            this.salaryEngine.primeCache(persisted.cacheKey, estimate);
            return estimate;
        }
        catch {
            return null;
        }
    }
    /**
     * Estimate + persist, the ONE choke point both salary call sites use
     * (2026-08-02): ingest pre-compute and the legacy on-demand salary
     * context. Persisting inside the shared path is what makes the estimate
     * survive a relaunch regardless of which surface computed it first.
     */
    async _estimateAndPersistSalary(resume, totalExperienceYears, generateContentFn) {
        const estimate = await this.salaryEngine.estimateFromResume(resume, totalExperienceYears, generateContentFn);
        if (estimate) {
            try {
                this.db.saveSalaryEstimate(SalaryIntelligenceEngine.cacheKeyFor(resume), estimate);
            }
            catch (err) {
                console.warn("[KnowledgeOrchestrator] Salary estimate persistence failed:", err?.message);
            }
        }
        return estimate;
    }
    /**
     * Generate a negotiation script on-demand (used when AOT has not run yet).
     * Persists the result to DB so subsequent calls return it instantly.
     */
    async generateNegotiationScriptOnDemand() {
        if (!this.activeResume || !this.activeJD || !this.generateContentFn)
            return null;
        const { generateNegotiationScript: generateNegotiationScript2 } = await Promise.resolve().then(() => (void 0, NegotiationEngine_exports));
        const dossier = this.companyResearch.getCachedDossier(this.activeJD.structured_data.company || "");
        const script = await generateNegotiationScript2(this.activeResume, this.activeJD, dossier, this.generateContentFn);
        if (script && this.activeJD.id) {
            this.db.saveNegotiationScript(this.activeJD.id, script);
            if (script.salary_range?.max) {
                this.negotiationTracker.setUserTarget(script.salary_range.max);
            }
        }
        return script;
    }
    /**
     * Get cached cover letter from DB.
     */
    getCoverLetter() {
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
    async generateCoverLetterOnDemand() {
        if (!this.activeResume || !this.activeJD || !this.generateContentFn)
            return null;
        const { generateCoverLetter: generateCoverLetter2 } = await Promise.resolve().then(() => (void 0, CoverLetterEngine_exports));
        const dossier = this.companyResearch.getCachedDossier(this.activeJD.structured_data.company || "");
        const letter = await generateCoverLetter2(this.activeResume, this.activeJD, dossier, this.generateContentFn);
        if (letter && this.activeJD.id) {
            this.db.saveCoverLetter(this.activeJD.id, letter);
        }
        return letter;
    }
    /**
     * Get cached mock questions from DB.
     */
    getMockQuestions() {
        if (this.activeJD?.id) {
            return this.db.getMockQuestions(this.activeJD.id);
        }
        return null;
    }
    /**
     * Get cached culture value mappings from AOT pipeline or DB.
     */
    getCultureMappings() {
        const cached3 = this.aotPipeline.getCachedCultureMapping();
        if (cached3)
            return cached3;
        if (this.activeJD?.id) {
            return this.db.getCultureMappings(this.activeJD.id);
        }
        return null;
    }
    // ============================================
    // Status & UI
    // ============================================
    getStatus() {
        const hasResume = this.activeResume !== null;
        const hasJD = this.activeJD !== null;
        let resumeSummary;
        if (hasResume) {
            try {
                const processed = this.getProcessedResume();
                if (processed) {
                    const structured = this.activeResume.structured_data;
                    resumeSummary = {
                        name: structured.identity.name,
                        role: structured.experience?.[0]?.role || "Professional",
                        totalExperienceYears: processed.totalExperienceYears
                    };
                }
            }
            catch {
            }
        }
        let jdSummary2;
        if (hasJD) {
            try {
                const structured = this.activeJD.structured_data;
                jdSummary2 = {
                    title: structured.title || structured.role || "Unknown Title",
                    company: structured.company || ""
                };
            }
            catch {
            }
        }
        return {
            hasResume,
            hasActiveJD: hasJD,
            activeMode: this.knowledgeModeActive,
            resumeSummary,
            jdSummary: jdSummary2
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
    heuristicExtractionDisabled() {
        try {
            const v2 = (process.env.PI_HEURISTIC_EXTRACTION || "").trim().toLowerCase();
            return v2 === "off" || v2 === "false" || v2 === "0" || v2 === "disabled";
        }
        catch {
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
    _ingestChainByType = /* @__PURE__ */ new Map();
    async ingestDocument(filePath, type = "resume" /* RESUME */) {
        const prior = this._ingestChainByType.get(type);
        const run = (async () => {
            try {
                await prior;
            }
            catch {
            }
            return this._ingestDocumentExclusive(filePath, type);
        })();
        this._ingestChainByType.set(type, run);
        try {
            return await run;
        }
        finally {
            if (this._ingestChainByType.get(type) === run)
                this._ingestChainByType.delete(type);
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
    isIngesting(type) {
        return this._ingestChainByType.has(type);
    }
    async _ingestDocumentExclusive(filePath, type = "resume" /* RESUME */) {
        if (!this.generateContentFn || !this.embedFn && !this.embedWithMetadataFn) {
            return { success: false, error: "LLM and embedding functions not configured." };
        }
        try {
            console.log(`[KnowledgeOrchestrator] Starting ingestion for ${type} from: ${filePath}`);
            const rawText = await extractDocumentText(filePath);
            let structuredData;
            let extractionMode = "llm";
            try {
                structuredData = await extractStructuredData(rawText, type, this.generateContentFn);
                if (type === "resume" /* RESUME */ && !this.heuristicExtractionDisabled()) {
                    const isDegenerateResume = (r3) => {
                        const nameMissing = !r3?.identity?.name || /^unknown candidate$/i.test(r3.identity.name);
                        const emptyBody = (r3?.experience?.length || 0) === 0 && (r3?.education?.length || 0) === 0 && (r3?.projects?.length || 0) === 0;
                        return nameMissing || emptyBody;
                    };
                    if (isDegenerateResume(structuredData)) {
                        const heur = heuristicResumeExtract(rawText);
                        const heurBetter = heur?.identity?.name && !/^unknown/i.test(heur.identity.name) || (heur?.experience?.length || 0) > 0 || (heur?.education?.length || 0) > 0;
                        if (heurBetter) {
                            console.warn("[KnowledgeOrchestrator] LLM extraction degenerate (no name / empty body); using deterministic heuristic instead.");
                            structuredData = heur;
                            extractionMode = "heuristic";
                        }
                    }
                }
                else if (type === "job_description" /* JD */ && !this.heuristicExtractionDisabled()) {
                    const isDegenerateJD = (j2) => {
                        const titleMissing = !j2?.title || /^unknown role$/i.test(j2.title);
                        const emptyBody = (j2?.requirements?.length || 0) === 0 && (j2?.responsibilities?.length || 0) === 0;
                        return titleMissing || emptyBody;
                    };
                    if (isDegenerateJD(structuredData)) {
                        const heur = heuristicJDExtract(rawText);
                        const heurBetter = heur?.title && !/^unknown role$/i.test(heur.title) || (heur?.requirements?.length || 0) > 0 || (heur?.responsibilities?.length || 0) > 0;
                        if (heurBetter) {
                            console.warn("[KnowledgeOrchestrator] LLM JD extraction degenerate (no title / empty body); using deterministic heuristic instead.");
                            structuredData = heur;
                            extractionMode = "heuristic";
                        }
                    }
                }
            }
            catch (extractErr) {
                if (this.heuristicExtractionDisabled())
                    throw extractErr;
                console.warn(`[KnowledgeOrchestrator] LLM structured extraction failed (${extractErr?.message}); falling back to deterministic heuristic extractor.`);
                structuredData = type === "resume" /* RESUME */ ? heuristicResumeExtract(rawText) : heuristicJDExtract(rawText);
                extractionMode = "heuristic";
            }
            if (type === "resume" /* RESUME */) {
                structuredData = normalizeStructuredResume(structuredData);
                const processed = processResume(structuredData);
                structuredData = processed.structured;
                this._processedResumeCache = null;
            }
            else if (type === "job_description" /* JD */) {
                structuredData = normalizeStructuredJD(structuredData);
            }
            if (structuredData && typeof structuredData === "object") {
                structuredData._schema_version = PROFILE_SCHEMA_VERSION;
                structuredData._extraction_mode = extractionMode;
            }
            const preservedConfirmedNodes = type === "resume" /* RESUME */ ? this.db.getNodesBySourceType("resume" /* RESUME */).filter((n2) => Array.isArray(n2.tags) && n2.tags.includes("user_confirmed")) : [];
            this.db.deleteDocumentsByType(type);
            const docId = this.db.saveDocument({
                type,
                source_uri: filePath,
                structured_data: structuredData,
                raw_text: rawText
            });
            if (preservedConfirmedNodes.length > 0) {
                this.db.saveNodes(preservedConfirmedNodes.map(({ id: _oldId, document_id: _oldDoc, ...node }) => node), docId);
                console.log(`[KnowledgeOrchestrator] Preserved ${preservedConfirmedNodes.length} user-confirmed claim(s) across re-upload`);
            }
            try {
                const activeSpace = this.activeSpaceFn?.();
                const producedSpaceByText = /* @__PURE__ */ new Map();
                const ingestEmbedFn = this._makeIngestEmbedFn(producedSpaceByText);
                const ingestEmbedBatchFn = this._makeIngestEmbedBatchFn(producedSpaceByText);
                const nodesWithEmbeddings = await chunkAndEmbedDocument(structuredData, type, ingestEmbedFn, ingestEmbedBatchFn);
                this.db.saveNodes(this._stampProducedSpace(nodesWithEmbeddings, producedSpaceByText, activeSpace), docId);
                if (type === "resume" /* RESUME */) {
                    try {
                        console.log(`[KnowledgeOrchestrator] Generating STAR stories for resume...`);
                        const starNodes = await generateStarStoryNodes(structuredData, this.generateContentFn, ingestEmbedFn, ingestEmbedBatchFn);
                        this.db.saveNodes(this._stampProducedSpace(starNodes, producedSpaceByText, activeSpace), docId);
                    }
                    catch (err) {
                        console.error("[KnowledgeOrchestrator] Failed to generate STAR stories:", err.message);
                    }
                }
            }
            catch (embedError) {
                console.error(`[KnowledgeOrchestrator] Embedding/storage failed for document ${docId}:`, embedError.message);
                if (this.heuristicExtractionDisabled()) {
                    this.db.deleteDocumentsByType(type);
                    this.refreshCache();
                    return { success: false, error: `Embedding failed: ${embedError.message}. Document rolled back.` };
                }
                this.refreshCache();
                console.warn(`[KnowledgeOrchestrator] Kept document ${docId} despite embedding failure \u2014 facts remain answerable via grounding + fast path; RAG degraded.`);
            }
            this.refreshCache();
            console.log(`[KnowledgeOrchestrator] \u2705 Ingestion complete for ${type}`);
            if (type === "job_description" /* JD */) {
                this.aotPipeline.reset();
                if (this.searchProviderResolver) {
                    try {
                        this.companyResearch.setSearchProvider(this.searchProviderResolver());
                    }
                    catch (err) {
                        console.warn("[KnowledgeOrchestrator] Search provider resolution failed; company research will be LLM-only:", err?.message || err);
                    }
                }
                const jdDoc = this.db.getDocumentByType("job_description" /* JD */);
                const resumeDoc = this.db.getDocumentByType("resume" /* RESUME */);
                if (isIntelligenceFlagEnabled("atomicJdProfilePackGeneration")) {
                    try {
                        await this.aotPipeline.runForJD(jdDoc, resumeDoc);
                        const script = this.getNegotiationScript();
                        if (script?.salary_range?.max) {
                            this.negotiationTracker.setUserTarget(script.salary_range.max);
                        }
                    }
                    catch (err) {
                        console.error("[KnowledgeOrchestrator] AOT Pipeline failed:", err);
                    }
                    this._generateProfileOkfPack("jd");
                }
                else {
                    this.aotPipeline.runForJD(jdDoc, resumeDoc).then(() => {
                        const script = this.getNegotiationScript();
                        if (script?.salary_range?.max) {
                            this.negotiationTracker.setUserTarget(script.salary_range.max);
                        }
                        setImmediate(() => this._generateProfileOkfPack("jd"));
                    }).catch((err) => {
                        console.error("[KnowledgeOrchestrator] AOT Pipeline failed:", err);
                        setImmediate(() => this._generateProfileOkfPack("jd"));
                    });
                }
            }
            if (type === "resume" /* RESUME */ && this.generateContentFn) {
                const resumeData = structuredData;
                const processed = this.getProcessedResume();
                const totalExperienceYears = processed?.totalExperienceYears ?? 0;
                this._estimateAndPersistSalary(resumeData, totalExperienceYears, this.generateContentFn).catch((err) => console.error("[KnowledgeOrchestrator] Salary pre-compute failed:", err));
            }
            if (type === "resume" /* RESUME */) {
                this._generateProfileOkfPack("resume");
            }
            return { success: true };
        }
        catch (error) {
            console.error("[KnowledgeOrchestrator] Ingestion failed:", error);
            return { success: false, error: error.message };
        }
    }
    // ============================================
    // Chat Integration
    // ============================================
    async processQuestion(question) {
        if (!this.activeResume) {
            if (isProfileGroundingV2Enabled() && this.knowledgeModeActive && this.activeJD) {
                const grounding = buildGroundingBlock(null, this.activeJD);
                if (grounding.block) {
                    return {
                        systemPromptInjection: "",
                        contextBlock: grounding.block,
                        isIntroQuestion: false,
                        factualRecall: true
                    };
                }
            }
            return null;
        }
        if (!this.isKnowledgeMode()) {
            return null;
        }
        const negotiationActive = this.negotiationTracker.isNegotiating();
        const recentIntentWasNegotiation = this._lastNegotiationTurnAt > 0 && Date.now() - this._lastNegotiationTurnAt < _KnowledgeOrchestrator.NEGOTIATION_STICKY_WINDOW_MS && this._nonCompTurnsSinceNegotiation < _KnowledgeOrchestrator.NEGOTIATION_DECAY_TURNS;
        let recentInterviewerComp = false;
        try {
            const ctxHint = this.conversationContextProvider?.();
            recentInterviewerComp = Boolean(ctxHint?.recentInterviewerComp);
        }
        catch {
        }
        let intent = classifyIntentWithContext(question, {
            negotiationActive,
            recentIntentWasNegotiation,
            recentInterviewerComp
        });
        let compRescued = false;
        if (intent === "general" /* GENERAL */ && looksLikeGarbledComp(question)) {
            intent = "negotiation" /* NEGOTIATION */;
            compRescued = true;
        }
        if (intent === "negotiation" /* NEGOTIATION */) {
            this._lastNegotiationTurnAt = Date.now();
            this._nonCompTurnsSinceNegotiation = 0;
        }
        else if (this._lastNegotiationTurnAt > 0) {
            this._nonCompTurnsSinceNegotiation += 1;
        }
        const stickyCtx = negotiationActive || recentIntentWasNegotiation || recentInterviewerComp;
        console.log(`[KnowledgeOrchestrator] Intent classified: ${intent}${stickyCtx ? ` (negotiation-sticky ctx${recentInterviewerComp ? " +transcript" : ""})` : ""}${compRescued ? " (garbled-comp rescue)" : ""}`);
        const qLower = question.toLowerCase().trim();
        const isIdentityDirect = intent === "intro" /* INTRO */ && !INTRO_PATTERNS3.some((p2) => qLower.includes(p2));
        if (isIdentityDirect && this.activeResume) {
            const resume = this.activeResume.structured_data;
            let factAnswer = "";
            if (qLower.includes("name") || qLower.includes("who am i")) {
                factAnswer = `You are ${resume.identity.name}.`;
            }
            else if (qLower.includes("role") || qLower.includes("job") || qLower.includes("work") || qLower.includes("company")) {
                const latest = resume.experience?.[0];
                if (latest) {
                    factAnswer = `You are currently a ${latest.role} at ${latest.company}.`;
                }
                else {
                    factAnswer = `You are a professional in the field.`;
                }
            }
            else if (qLower.includes("experience")) {
                const processed = this.getProcessedResume();
                if (processed && processed.totalExperienceYears) {
                    factAnswer = `You have roughly ${processed.totalExperienceYears} years of experience.`;
                }
                else {
                    factAnswer = `You have several years of experience based on your resume.`;
                }
            }
            else if (qLower.includes("background")) {
                const latest = resume.experience?.[0];
                const education = resume.education?.[0];
                let bg = `You are a professional`;
                if (latest)
                    bg += ` currently working as a ${latest.role} at ${latest.company}`;
                if (education)
                    bg += ` with a degree from ${education.institution}`;
                factAnswer = bg + `.`;
            }
            if (factAnswer) {
                console.log("[KnowledgeOrchestrator] Direct Identity Fact match. Returning instantly.");
                return {
                    systemPromptInjection: "",
                    contextBlock: "",
                    isIntroQuestion: true,
                    introResponse: factAnswer,
                    // The user's own identity fact — factual recall, never the
                    // gated coaching layer. Lets the live what-to-answer path
                    // ground on it (see IntelligenceEngine grounding gate).
                    factualRecall: true
                };
            }
        }
        let fastPathNodes = null;
        if (intent === "profile_detail" /* PROFILE_DETAIL */ && this.activeResume) {
            const resume = this.activeResume.structured_data;
            if (resume.projects && Array.isArray(resume.projects)) {
                for (const proj of resume.projects) {
                    if (proj.name && qLower.includes(proj.name.toLowerCase())) {
                        console.log(`[KnowledgeOrchestrator] Direct Project match for: ${proj.name}. Bypassing vector search.`);
                        fastPathNodes = [{
                                source_type: "resume" /* RESUME */,
                                category: "projects",
                                title: proj.name,
                                text_content: [
                                    `- ${proj.name}: ${proj.description || ""}`,
                                    `  Technologies: ${(proj.technologies || []).join(", ")}`,
                                    ...(proj.highlights || []).filter(Boolean).map((highlight) => `  Highlight: ${highlight}`)
                                ].join("\n"),
                                tags: [...proj.technologies || [], ...proj.highlights || []]
                            }];
                        break;
                    }
                }
            }
            if (!fastPathNodes && (qLower.startsWith("do i know ") || qLower.startsWith("what is my experience with ") || qLower.startsWith("have i used "))) {
                const skillMatch = qLower.replace(/^(do i know|what is my experience with|have i used) /, "").replace(/\?$/, "").trim();
                const flatSkills = resume.skills_flat ?? flattenSkills(resume.skills);
                if (skillMatch && flatSkills.some((s3) => s3.toLowerCase() === skillMatch)) {
                    console.log(`[KnowledgeOrchestrator] Direct Skill match for: ${skillMatch}. Bypassing vector search.`);
                    fastPathNodes = [{
                            source_type: "resume" /* RESUME */,
                            category: "skills",
                            title: skillMatch,
                            text_content: `- ${skillMatch}: Yes, this is listed in your skills.`,
                            tags: [skillMatch]
                        }];
                }
            }
        }
        const candidateDirectedIntents = /* @__PURE__ */ new Set([
            "intro" /* INTRO */,
            "profile_detail" /* PROFILE_DETAIL */,
            "negotiation" /* NEGOTIATION */,
            "company_research" /* COMPANY_RESEARCH */
        ]);
        const CANDIDATE_FRAMING_REGEX = /\b(i|i've|i'm|i'd|i'll|my|mine|myself|me|we|our|ours|us|you|your|yours|yourself|you've|you're|you'd|you'll)\b/i;
        const hasCandidateFraming = CANDIDATE_FRAMING_REGEX.test(question);
        if (intent === "negotiation" /* NEGOTIATION */ && isJdFactualLookupNotNegotiationAdvice(question)) {
            const v2 = this.maybeGroundedOnlyResult(question);
            if (v2) {
                console.log("[KnowledgeOrchestrator] Negotiation-keyword match resolved as a JD factual lookup \u2014 grounding in JD only, no coaching layer");
                return v2;
            }
        }
        if (isGenericKnowledgeQuestion(question)) {
            console.log(`[KnowledgeOrchestrator] Generic-knowledge question \u2014 full bypass (no identity/retrieval)`);
            const v2 = this.maybeGroundedOnlyResult(question);
            if (v2)
                return v2;
            return null;
        }
        const isCandidateDirected = candidateDirectedIntents.has(intent) || hasCandidateFraming;
        if (isIntelligenceFlagEnabled("pronounRegexShadowObservation")) {
            try {
                const plan = planAnswer({ question, source: "manual_input" });
                const canonicalResumeAllowed = isLayerAllowed(plan, "resume");
                const payload = {
                    legacyResumeAllowed: isCandidateDirected,
                    canonicalResumeAllowed,
                    answerType: plan.answerType,
                    intent
                };
                if (isCandidateDirected !== canonicalResumeAllowed) {
                    console.warn("[PronounRegexShadow] divergence (observe-only, no behavior change)", payload);
                }
                else {
                    console.log("[PronounRegexShadow] agreement (observe-only)", payload);
                }
            }
            catch (shadowErr) {
                console.warn("[PronounRegexShadow] shadow call skipped (non-fatal):", shadowErr?.message);
            }
        }
        if (isCandidateDirected && this.activeResume.structured_data) {
            const structuredPack = this.buildStructuredCategoryPack(question, this.activeResume.structured_data);
            if (structuredPack && structuredPack.length > 0) {
                fastPathNodes = structuredPack;
            }
        }
        if (!isCandidateDirected) {
            const v2 = this.maybeGroundedOnlyResult(question);
            if (v2)
                return v2;
            const identityBlock = this.buildCompactIdentityBlock();
            if (identityBlock) {
                console.log(`[KnowledgeOrchestrator] Ambiguous question (intent=${intent}) \u2014 injecting compact identity (inclusion bias), skipping heavy retrieval`);
                return {
                    systemPromptInjection: "",
                    contextBlock: identityBlock,
                    isIntroQuestion: false,
                    // The user's own identity facts — never suppressed by the
                    // premium-intercept mode gate. See PromptAssemblyResult.factualRecall.
                    factualRecall: true
                };
            }
            console.log(`[KnowledgeOrchestrator] Ambiguous question (intent=${intent}) \u2014 no identity available, bypassing`);
            return null;
        }
        this.negotiationTracker.addUserUtterance(question);
        const categoryHints = detectCategoryHints(question);
        if (categoryHints.length > 0) {
            console.log(`[KnowledgeOrchestrator] Category hints detected: ${categoryHints.join(", ")}`);
        }
        const maxNodes = intent === "profile_detail" /* PROFILE_DETAIL */ ? 12 : void 0;
        let jdRequiredSkills = [];
        if (this.activeJD) {
            const jd = this.activeJD.structured_data;
            jdRequiredSkills = [...jd.requirements || [], ...jd.technologies || []];
        }
        const groundingCoversAnswer = (() => {
            if (!isProfileGroundingV2Enabled())
                return false;
            try {
                const t3 = planAnswer({ question, source: "manual_input" }).answerType;
                const fullyCovered = /* @__PURE__ */ new Set([
                    "identity_answer",
                    "profile_fact_answer",
                    "skills_answer",
                    "skill_experience_answer",
                    "project_answer",
                    "experience_answer"
                ]);
                if (isProfileGroundingV2JdFitCoverageEnabled()) {
                    fullyCovered.add("jd_fit_answer");
                    fullyCovered.add("resume_jd_fit_answer");
                }
                return fullyCovered.has(t3);
            }
            catch {
                return false;
            }
        })();
        const queryEmbedder = groundingCoversAnswer ? null : this.resolveQueryEmbedder();
        if (groundingCoversAnswer) {
            console.log("[KnowledgeOrchestrator] V2 grounding covers this answer type \u2014 skipping redundant vector retrieval embed");
        }
        const retrievalNodes = this._spaceGatedNodes();
        const relevantNodesPromise = fastPathNodes ? Promise.resolve(fastPathNodes) : queryEmbedder && retrievalNodes.length > 0 ? getRelevantNodes(question, retrievalNodes, queryEmbedder, {
            sourceTypes: ["resume" /* RESUME */, "job_description" /* JD */],
            jdRequiredSkills,
            categoryHintKeywords: categoryHints.length > 0 ? categoryHints : void 0,
            maxNodes,
            // Semantic-admission gate (Phase 1): the committed space is
            // the one the corpus vectors AND resolveQueryEmbedder's
            // query vectors provably share, so its floor is valid here.
            embeddingSpaceKey: this._committedIndexSpace() ?? null
        }).then((scored) => scored.map((sn) => sn.node)).catch((error) => {
            console.warn("[KnowledgeOrchestrator] Relevance scoring failed:", error.message);
            return [];
        }) : Promise.resolve([]);
        let dossierContext = "";
        if (needsCompanyResearch(question) && this.activeJD && this.isCompanyResearchAllowed()) {
            const jd = this.activeJD.structured_data;
            if (jd.company) {
                try {
                    let dossier = this.aotPipeline.getCachedDossier();
                    if (!dossier) {
                        dossier = this.companyResearch.getCachedDossier(jd.company);
                    }
                    if (!dossier) {
                        console.warn("[KnowledgeOrchestrator] No cached dossier found, running live research (2s budget; continues in background)");
                        const researchPromise = this.companyResearch.researchCompany(jd.company, jdContextFromStructured(jd));
                        researchPromise.catch(() => {
                        });
                        dossier = await Promise.race([
                            researchPromise,
                            new Promise((resolve3) => setTimeout(() => resolve3(null), 2e3))
                        ]);
                        if (!dossier) {
                            console.warn("[KnowledgeOrchestrator] Live research exceeded 2s budget \u2014 answering without dossier (background fill continues)");
                        }
                    }
                    if (dossier)
                        dossierContext = formatDossierBlock(dossier);
                }
                catch (error) {
                    console.warn("[KnowledgeOrchestrator] Company research failed:", error.message);
                }
            }
        }
        if (intent === "negotiation" /* NEGOTIATION */) {
            if (this.negotiationTracker.isActive() && this.generateContentFn && this.activeResume) {
                const dossier = this.activeJD ? this.companyResearch.getCachedDossier(this.activeJD.structured_data.company || "") : null;
                const script = this.getNegotiationScript();
                const coachingResponse = await generateLiveCoachingResponse(this.negotiationTracker, question, this.activeResume, this.activeJD, dossier, script, 
                // Live coaching is spoken in real time — prefer the fast
                // (Flash-first) fn when wired; fall back to the quality fn.
                this.liveCoachingContentFn || this.generateContentFn);
                return {
                    systemPromptInjection: "",
                    contextBlock: "",
                    isIntroQuestion: false,
                    liveNegotiationResponse: coachingResponse
                };
            }
        }
        let salaryContext = "";
        if (intent === "negotiation" /* NEGOTIATION */ && this.activeResume && this.generateContentFn) {
            try {
                const resume = this.activeResume.structured_data;
                const processed = this.getProcessedResume();
                const totalExperienceYears = processed?.totalExperienceYears ?? 0;
                if (this.activeJD) {
                    const negotiationScript = this.getNegotiationScript();
                    const resumeEstimate = this.salaryEngine.getCachedEstimate();
                    salaryContext = SalaryIntelligenceEngine.buildSalaryContextBlock(resumeEstimate, negotiationScript, true);
                    console.log("[KnowledgeOrchestrator] Injecting JD-based salary intelligence");
                }
                else {
                    const resumeEstimate = await this._estimateAndPersistSalary(resume, totalExperienceYears, this.generateContentFn);
                    salaryContext = SalaryIntelligenceEngine.buildSalaryContextBlock(resumeEstimate, null, false);
                    console.log("[KnowledgeOrchestrator] Injecting resume-based salary intelligence");
                }
            }
            catch (error) {
                console.warn("[KnowledgeOrchestrator] Salary intelligence failed:", error.message);
            }
        }
        let gapContext = "";
        const gapRelevantTypes = /* @__PURE__ */ new Set(["jd_fit_answer", "gap_analysis_answer", "behavioral_interview_answer"]);
        let plannedTypeForGap = "";
        try {
            plannedTypeForGap = planAnswer({ question, source: "manual_input" }).answerType;
        }
        catch {
        }
        if (this.activeJD && gapRelevantTypes.has(plannedTypeForGap)) {
            try {
                const riEvidence = this.roleInsightService?.getLiveEvidence(question) ?? null;
                if (riEvidence) {
                    gapContext = riEvidence;
                    console.log("[KnowledgeOrchestrator] Injecting Role Insight fit evidence");
                }
            }
            catch (e3) {
                console.warn("[KnowledgeOrchestrator] Role Insight live evidence failed:", e3?.message);
            }
        }
        if (!gapContext && this.activeJD && gapRelevantTypes.has(plannedTypeForGap)) {
            const gapAnalysis = this.getGapAnalysis();
            if (gapAnalysis && gapAnalysis.gaps && gapAnalysis.gaps.length > 0) {
                const questionLower = question.toLowerCase();
                const matchingGaps = gapAnalysis.gaps.filter((gap) => questionLower.includes(gap.skill.toLowerCase()));
                if (matchingGaps.length > 0) {
                    const pivotLines = matchingGaps.map((gap) => `[Gap: ${gap.skill} (${gap.gap_type})] Pivot: ${gap.pivot_script}${gap.transferable_skills.length > 0 ? ` Transferable skills: ${gap.transferable_skills.join(", ")}` : ""}`);
                    gapContext = `<gap_pivot_scripts>
${pivotLines.join("\n")}
</gap_pivot_scripts>`;
                    console.log(`[KnowledgeOrchestrator] Injecting ${matchingGaps.length} pivot script(s) for detected gap skills`);
                }
            }
        }
        const toneXML = this.depthScorer.getToneXML();
        let cachedIntro = null;
        if (this.activeJD?.id != null) {
            cachedIntro = this.db.getIntro(this.activeJD.id);
        }
        let relevantNodes = await relevantNodesPromise;
        const wantsPreciseValue = /\b(exact|exactly|specific|precise)\b|\bwhat was my\b.*\b(percentage|percent|%|rate|number|score|figure|amount)\b|\bhow much\b/i.test(question);
        if (relevantNodes.length === 0 && !wantsPreciseValue && this.activeResume.structured_data) {
            const fitPack = this.buildExperienceFallbackPack(this.activeResume.structured_data);
            if (fitPack.length > 0) {
                console.log(`[KnowledgeOrchestrator] Zero-node candidate-directed question \u2014 seeding ${fitPack.length} real experience/achievement node(s) to prevent fabrication`);
                relevantNodes = fitPack;
            }
        }
        const result = await assemblePromptContext(question, this.activeResume, this.activeJD, relevantNodes.map((n2) => ({ node: n2, score: 1 })), this.generateContentFn, toneXML, cachedIntro);
        if (dossierContext && result) {
            result.contextBlock = result.contextBlock ? `${result.contextBlock}

${dossierContext}` : dossierContext;
        }
        if (salaryContext && result) {
            result.contextBlock = result.contextBlock ? `${result.contextBlock}

${salaryContext}` : salaryContext;
        }
        if (gapContext && result) {
            result.contextBlock = result.contextBlock ? `${result.contextBlock}

${gapContext}` : gapContext;
        }
        if (this.activeJD && result) {
            const mockQuestions = this.getMockQuestions();
            if (mockQuestions && mockQuestions.length > 0) {
                const questionLower = question.toLowerCase();
                const questionWords = new Set(questionLower.split(/\s+/).filter((w2) => w2.length > 3));
                const scoredMocks = mockQuestions.map((mq) => {
                    const mqWords = mq.question.toLowerCase().split(/\s+/).filter((w2) => w2.length > 3);
                    const overlap = mqWords.filter((w2) => questionWords.has(w2)).length;
                    const similarity = mqWords.length > 0 ? overlap / mqWords.length : 0;
                    return { mock: mq, similarity };
                }).filter((s3) => s3.similarity >= 0.4).sort((a2, b2) => b2.similarity - a2.similarity);
                if (scoredMocks.length > 0) {
                    const bestMatch = scoredMocks[0];
                    const hintLines = [
                        `Predicted Question: "${bestMatch.mock.question}"`,
                        `Category: ${bestMatch.mock.category} | Difficulty: ${bestMatch.mock.difficulty}`,
                        `Key Points to Hit: ${bestMatch.mock.suggested_answer_key}`,
                        `Why This Is Asked: ${bestMatch.mock.rationale}`
                    ];
                    const mockBlock = `<mock_question_hint>
This question closely matches a predicted interview question. Use these key points:
${hintLines.join("\n")}
</mock_question_hint>`;
                    result.contextBlock = result.contextBlock ? `${result.contextBlock}

${mockBlock}` : mockBlock;
                    console.log(`[KnowledgeOrchestrator] Injecting mock question hint (${(bestMatch.similarity * 100).toFixed(0)}% match): "${bestMatch.mock.question.substring(0, 60)}..."`);
                }
            }
        }
        const cultureMappings = this.getCultureMappings();
        if (cultureMappings && cultureMappings.mappings.length > 0 && this.activeJD && result) {
            const jd = this.activeJD.structured_data;
            const alignments = findRelevantValueAlignments(question, cultureMappings.mappings, cultureMappings.core_values, 2);
            if (alignments.length > 0) {
                const cultureBlock = formatValueAlignmentBlock(alignments, jd.company);
                if (cultureBlock) {
                    result.contextBlock = result.contextBlock ? `${result.contextBlock}

${cultureBlock}` : cultureBlock;
                    console.log(`[KnowledgeOrchestrator] Injecting ${alignments.length} culture alignment(s) for ${jd.company}`);
                }
            }
        }
        if (result && intent !== "negotiation" /* NEGOTIATION */ && (intent === "profile_detail" /* PROFILE_DETAIL */ || intent === "intro" /* INTRO */ || fastPathNodes)) {
            result.factualRecall = true;
        }
        if (result && intent !== "negotiation" /* NEGOTIATION */ && isProfileGroundingV2Enabled()) {
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
    profileGroundingPlan(question) {
        try {
            const plan = planAnswer({ question, source: "manual_input" });
            const t3 = plan.answerType;
            const noProfile = plan.forbiddenContextLayers.includes("resume");
            if (noProfile)
                return { useResume: false, useJD: false };
            const useJD = plan.requiredContextLayers.includes("jd") && !plan.forbiddenContextLayers.includes("jd");
            const tightTypes = /* @__PURE__ */ new Set(["identity_answer", "skills_answer", "skill_experience_answer", "profile_fact_answer"]);
            return { useResume: true, useJD: tightTypes.has(t3) ? false : useJD };
        }
        catch {
            return { useResume: true, useJD: true };
        }
    }
    /**
     * Prepend the deterministic full-profile grounding block to a result's
     * contextBlock and mark it factualRecall so the mode gate can't drop it.
     * Idempotent within a single result (won't double-inject). Gated by answer
     * type (spec §8): coding/technical/sales/lecture get NO resume/JD block.
     */
    applyFullProfileGrounding(result, question) {
        if (!result || result.isIntroQuestion || result.liveNegotiationResponse)
            return;
        if (result.contextBlock && result.contextBlock.includes("<candidate_profile>"))
            return;
        if (result.contextBlock && result.contextBlock.includes("<target_job>"))
            return;
        const gate = this.profileGroundingPlan(question);
        if (!gate.useResume && !gate.useJD)
            return;
        const grounding = buildGroundingBlock(this.activeResume, this.activeJD, {
            includeResume: gate.useResume,
            includeJD: gate.useJD
        });
        if (!grounding.block)
            return;
        result.contextBlock = result.contextBlock ? `${grounding.block}

${result.contextBlock}` : grounding.block;
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
    maybeGroundedOnlyResult(question) {
        if (!isProfileGroundingV2Enabled())
            return null;
        const gate = question ? this.profileGroundingPlan(question) : { useResume: true, useJD: true };
        if (!gate.useResume && !gate.useJD)
            return null;
        const grounding = buildGroundingBlock(this.activeResume, this.activeJD, {
            includeResume: gate.useResume,
            includeJD: gate.useJD
        });
        if (!grounding.block)
            return null;
        return {
            systemPromptInjection: "",
            contextBlock: grounding.block,
            isIntroQuestion: false,
            factualRecall: true
        };
    }
    // ============================================
    // Management
    // ============================================
    deleteDocumentsByType(type) {
        this.db.deleteDocumentsByType(type);
        if (type === "resume" /* RESUME */) {
            this.knowledgeModeActive = false;
            this.salaryEngine.clearCache();
            this.negotiationTracker.reset();
            this._lastNegotiationTurnAt = 0;
            this._nonCompTurnsSinceNegotiation = 0;
        }
        else if (type === "job_description" /* JD */) {
            this.negotiationTracker.reset();
            this._lastNegotiationTurnAt = 0;
            this._nonCompTurnsSinceNegotiation = 0;
        }
        try {
            const mod = (void 0, __toCommonJS(ProfilePackBuilder_exports));
            mod.ProfilePackBuilder.getInstance().deleteProfilePack(type === "resume" /* RESUME */ ? "resume" : "jd");
        }
        catch {
        }
        this.refreshCache();
    }
    refreshCache() {
        const prevResumeId = this.activeResume?.id ?? null;
        this.activeResume = this.db.getDocumentByType("resume" /* RESUME */);
        this.activeJD = this.db.getDocumentByType("job_description" /* JD */);
        this.migrateActiveResumeSkills();
        this.migrateActiveJDSchema();
        this.cachedNodes = this.db.getAllNodes();
        if ((this.activeResume?.id ?? null) !== prevResumeId) {
            this._processedResumeCache = null;
        }
        console.log(`[KnowledgeOrchestrator] Cache refreshed: ${this.cachedNodes.length} total nodes across all docs`);
        this.ensureEmbeddingSpace().catch((err) => console.warn("[KnowledgeOrchestrator] ensureEmbeddingSpace failed (non-fatal):", err?.message || err));
    }
    /**
     * One-shot v1→v2 skills migration for the active resume. If the stored
     * resume's skills are a legacy flat string[] (or it predates the schema
     * version stamp), categorize them deterministically, refresh skills_flat,
     * stamp _schema_version, and persist back. Idempotent: a v2 profile whose
     * skills are already an object is left untouched.
     */
    migrateActiveResumeSkills() {
        const doc = this.activeResume;
        if (!doc?.structured_data || typeof doc.structured_data !== "object")
            return;
        const sd = doc.structured_data;
        const needsMigration = isLegacyFlatSkills(sd.skills) || sd._schema_version !== PROFILE_SCHEMA_VERSION;
        const categorized = coerceSkills(sd.skills);
        sd.skills = categorized;
        sd.skills_flat = flattenSkills(categorized);
        if (!needsMigration)
            return;
        sd._schema_version = PROFILE_SCHEMA_VERSION;
        try {
            if (typeof this.db.updateDocumentStructuredData === "function" && doc.id != null) {
                this.db.updateDocumentStructuredData(doc.id, sd);
                console.log("[KnowledgeOrchestrator] Migrated resume skills to categorized v2 schema.");
            }
        }
        catch (err) {
            console.warn("[KnowledgeOrchestrator] Skills migration persist failed (non-fatal):", err?.message || err);
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
    migrateActiveJDSchema() {
        const doc = this.activeJD;
        if (!doc?.structured_data || typeof doc.structured_data !== "object")
            return;
        const sd = doc.structured_data;
        if (sd._schema_version === PROFILE_SCHEMA_VERSION)
            return;
        const normalized = normalizeStructuredJD(sd);
        Object.assign(sd, normalized);
        sd._schema_version = PROFILE_SCHEMA_VERSION;
        try {
            if (typeof this.db.updateDocumentStructuredData === "function" && doc.id != null) {
                this.db.updateDocumentStructuredData(doc.id, sd);
                console.log("[KnowledgeOrchestrator] Migrated JD to current schema version.");
            }
        }
        catch (err) {
            console.warn("[KnowledgeOrchestrator] JD schema migration persist failed (non-fatal):", err?.message || err);
        }
    }
    /** Stamp an active embedding-space key onto freshly-embedded nodes. */
    _stampSpace(nodes, space) {
        if (!space)
            return nodes;
        for (const n2 of nodes)
            if (n2.embedding)
                n2.embedding_space = space;
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
    _makeIngestEmbedBatchFn(producedSpaceByText) {
        const batch = this.embedBatchWithMetadataFn;
        if (!batch)
            return void 0;
        return async (texts) => {
            const r3 = await batch(texts);
            if (r3?.space)
                for (const t3 of texts)
                    producedSpaceByText.set(t3, r3.space);
            return r3?.embeddings ?? [];
        };
    }
    _makeIngestEmbedFn(producedSpaceByText) {
        const withMeta = this.embedWithMetadataFn;
        const plain = this.embedFn;
        return async (text4) => {
            if (withMeta) {
                const r3 = await withMeta(text4);
                if (r3?.space)
                    producedSpaceByText.set(text4, r3.space);
                return r3?.embedding ?? [];
            }
            if (!plain)
                throw new Error("no document embedder registered");
            return plain(text4);
        };
    }
    /**
     * Stamp each node with the space that produced ITS vector, falling back to
     * the pre-call active space only where the producer reported nothing (the
     * legacy embedFn path). A node whose embedding failed carries no space.
     */
    _stampProducedSpace(nodes, producedSpaceByText, fallbackSpace) {
        for (const n2 of nodes) {
            if (!n2.embedding)
                continue;
            const produced = producedSpaceByText.get(n2.text_content) ?? fallbackSpace;
            if (produced)
                n2.embedding_space = produced;
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
    async ensureEmbeddingSpace() {
        if (this._reembedInFlight)
            return;
        const embedFn = this.embedFn;
        const activeSpace = this.activeSpaceFn?.();
        const fast = this.fastQueryEmbedFn ? this.fastQueryEmbedFn() : null;
        const localSpace = fast?.space ?? null;
        const localEmbed = fast?.embed ?? null;
        if (!activeSpace && !localSpace)
            return;
        if (activeSpace && this._indexSpace === activeSpace && Date.now() - this._lastConvergeAt < _KnowledgeOrchestrator.REEMBED_DEBOUNCE_MS && this.db.getNodesNeedingReembed(activeSpace).length === 0) {
            return;
        }
        this._reembedInFlight = true;
        try {
            if (activeSpace && embedFn) {
                const fullyConverged = await this._reembedCorpusTo(activeSpace, (t3) => embedFn(t3));
                if (fullyConverged) {
                    this._indexSpace = activeSpace;
                    this._lastConvergeAt = Date.now();
                    this.cachedNodes = this.db.getAllNodes();
                    return;
                }
                console.warn("[KnowledgeOrchestrator] Cloud embedder could not converge the corpus \u2014 attempting local degrade.");
            }
            if (localSpace && localEmbed) {
                const localFn = async (t3) => {
                    const v2 = await localEmbed(t3);
                    if (!Array.isArray(v2) || v2.length === 0)
                        throw new Error("local embed returned empty");
                    return v2;
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
            this.cachedNodes = this.db.getAllNodes();
            console.warn("[KnowledgeOrchestrator] ensureEmbeddingSpace could not converge the corpus on any single space; will retry next refresh.");
        }
        finally {
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
    async _reembedCorpusTo(targetSpace, embed) {
        const MAX_REEMBED_PASSES = 5;
        for (let pass = 0; pass < MAX_REEMBED_PASSES; pass++) {
            const stale = this.db.getNodesNeedingReembed(targetSpace);
            if (stale.length === 0)
                return true;
            let passProgress = 0;
            for (const node of stale) {
                if (node.id == null)
                    continue;
                try {
                    const vec = await embed(node.text_content);
                    if (Array.isArray(vec) && vec.length > 0) {
                        this.db.updateNodeEmbedding(node.id, vec, targetSpace);
                        passProgress++;
                    }
                }
                catch (e3) {
                    console.warn(`[KnowledgeOrchestrator] Re-embed (\u2192${targetSpace}) failed for node ${node.id}:`, e3?.message || e3);
                }
            }
            if (passProgress === 0)
                break;
        }
        return this.db.getNodesNeedingReembed(targetSpace).length === 0;
    }
    /**
     * Memoized wrapper around processResume().
     * Re-processes only when the active resume document changes (checked by DB id).
     * Returns null if no resume is loaded.
     */
    getProcessedResume() {
        if (!this.activeResume)
            return null;
        const docId = this.activeResume.id ?? null;
        if (this._processedResumeCache && this._processedResumeCache.docId === docId) {
            return this._processedResumeCache.result;
        }
        const structured = this.activeResume.structured_data;
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
    async generateCompactJDHeader() {
        if (!this.activeJD || !this.generateContentFn)
            return null;
        const jd = this.activeJD.structured_data;
        const prompt = `Create a compact summary (~150 tokens) of this job for persona tuning. Include: role title, level, company, top 3 technical themes, and key focus areas. Output a single paragraph, no markdown.

Job: ${jd.title} at ${jd.company}
Level: ${jd.level || "mid"}
Location: ${jd.location}
Key Requirements: ${jd.requirements?.slice(0, 5).join(", ")}
Technologies: ${jd.technologies?.join(", ")}
Keywords: ${jd.keywords?.join(", ")}`;
        try {
            const header = await this.generateContentFn([{ text: prompt }]);
            return header.trim();
        }
        catch (error) {
            console.warn("[KnowledgeOrchestrator] Failed to generate compact JD header:", error.message);
            return `${jd.level || "Mid-level"} ${jd.title} at ${jd.company}. Focus: ${jd.keywords?.slice(0, 3).join(", ") || jd.technologies?.slice(0, 3).join(", ") || "general"}.`;
        }
    }
    /**
     * Get a deterministic compact JD header for persona merging.
     */
    getCompactJDHeader() {
        if (!this.activeJD)
            return null;
        const jd = this.activeJD.structured_data;
        const levelStr = jd.level ? jd.level.charAt(0).toUpperCase() + jd.level.slice(1) : "Mid-level";
        const techFocus = jd.technologies?.slice(0, 4).join(", ") || "";
        const keyThemes = jd.keywords?.slice(0, 3).join(", ") || "";
        const hasKnownLocation = jd.location && jd.location !== "Unknown Location";
        return `${levelStr} ${jd.title} at ${jd.company}${hasKnownLocation ? ` (${jd.location})` : ""}. Tech: ${techFocus}. Themes: ${keyThemes}.`;
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
    buildExperienceFallbackPack(resume) {
        const nodes = [];
        if (Array.isArray(resume.experience)) {
            for (const exp of resume.experience) {
                if (!exp?.role && !exp?.company)
                    continue;
                const bullets = (exp.bullets || []).filter(Boolean);
                const dates = [exp.start_date, exp.end_date || "Present"].filter(Boolean).join(" \u2013 ");
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "experience",
                    title: exp.role || "Role",
                    organization: exp.company || "",
                    text_content: `${exp.role || "Role"}${exp.company ? ` at ${exp.company}` : ""}${dates ? ` (${dates})` : ""}${bullets.length ? `
  ${bullets.join("\n  ")}` : ""}`.trim(),
                    tags: []
                });
            }
        }
        if (Array.isArray(resume.achievements)) {
            for (const ach of resume.achievements) {
                if (!ach?.title)
                    continue;
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "achievement",
                    title: ach.title,
                    text_content: `${ach.title}${ach.description ? `: ${ach.description}` : ""}`.trim(),
                    tags: []
                });
            }
        }
        if (Array.isArray(resume.leadership)) {
            for (const lead of resume.leadership) {
                if (!lead?.role && !lead?.organization)
                    continue;
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "leadership",
                    title: lead.role || "Leadership",
                    organization: lead.organization || "",
                    text_content: `${lead.role || ""}${lead.organization ? ` at ${lead.organization}` : ""}${lead.description ? `: ${lead.description}` : ""}`.trim(),
                    tags: []
                });
            }
        }
        return nodes;
    }
    buildStructuredCategoryPack(question, resume) {
        const hints = detectCategoryHints(question);
        const qLower = question.toLowerCase();
        const mentions = (...words2) => words2.some((w2) => qLower.includes(w2));
        const skillKeywords = [
            "skill",
            "tech stack",
            "technolog",
            "tech i know",
            "languages i",
            "framework",
            "frameworks",
            "tools",
            "tooling",
            "tool ",
            "stack",
            "proficient",
            "proficien",
            "comfortable with",
            "familiar with",
            "languages",
            "libraries",
            "platforms"
        ];
        const skillFocused = mentions(...skillKeywords);
        if (hints.length === 0 && !skillFocused)
            return null;
        const nodes = [];
        const wants = (c2) => {
            if (!hints.includes(c2))
                return false;
            if (skillFocused && (c2 === "experience" || c2 === "project")) {
                if (c2 === "experience")
                    return mentions("experience", "work", "job", "role", "employ", "career");
                if (c2 === "project")
                    return mentions("project", "built", "build");
            }
            return true;
        };
        if (wants("project") && Array.isArray(resume.projects)) {
            for (const proj of resume.projects) {
                if (!proj?.name)
                    continue;
                const tech = (proj.technologies || []).filter(Boolean);
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "project",
                    title: proj.name,
                    text_content: `${proj.name}: ${proj.description || ""}${tech.length ? `
  Technologies: ${tech.join(", ")}` : ""}`.trim(),
                    tags: tech
                });
            }
        }
        if (wants("experience") && Array.isArray(resume.experience)) {
            for (const exp of resume.experience) {
                if (!exp?.role && !exp?.company)
                    continue;
                const bullets = (exp.bullets || []).filter(Boolean);
                const dates = [exp.start_date, exp.end_date || "Present"].filter(Boolean).join(" \u2013 ");
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "experience",
                    title: exp.role || "Role",
                    organization: exp.company || "",
                    text_content: `${exp.role || "Role"}${exp.company ? ` at ${exp.company}` : ""}${dates ? ` (${dates})` : ""}${bullets.length ? `
  ${bullets.join("\n  ")}` : ""}`.trim(),
                    tags: []
                });
            }
        }
        if (wants("education") && Array.isArray(resume.education)) {
            for (const edu of resume.education) {
                if (!edu?.institution && !edu?.degree)
                    continue;
                const degree = [edu.degree, edu.field].filter(Boolean).join(", ");
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "education",
                    title: degree || edu.institution || "Education",
                    organization: edu.institution || "",
                    text_content: `${degree || "Studies"}${edu.institution ? ` \u2014 ${edu.institution}` : ""}${edu.end_date ? ` (${edu.end_date})` : ""}`.trim(),
                    tags: []
                });
            }
        }
        if (wants("achievement") && Array.isArray(resume.achievements)) {
            for (const ach of resume.achievements) {
                if (!ach?.title)
                    continue;
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "achievement",
                    title: ach.title,
                    text_content: `${ach.title}${ach.description ? `: ${ach.description}` : ""}`.trim(),
                    tags: []
                });
            }
        }
        if (wants("certification") && Array.isArray(resume.certifications)) {
            for (const cert of resume.certifications) {
                if (!cert?.name)
                    continue;
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "certification",
                    title: cert.name,
                    text_content: `${cert.name}${cert.issuer ? ` \u2014 ${cert.issuer}` : ""}`.trim(),
                    tags: []
                });
            }
        }
        if (Array.isArray(resume.leadership)) {
            const namesLeadershipOrg = (org) => {
                const o2 = (org || "").toLowerCase().trim();
                if (!o2)
                    return false;
                if (qLower.includes(o2))
                    return true;
                const tokens = o2.split(/[^a-z0-9]+/).filter((t3) => t3.length >= 3 && !["the", "and", "chapter", "club", "society", "team", "university", "college"].includes(t3));
                return tokens.some((t3) => qLower.includes(t3));
            };
            for (const lead of resume.leadership) {
                if (!lead?.role && !lead?.organization)
                    continue;
                if (!wants("leadership") && !namesLeadershipOrg(String(lead.organization || "")))
                    continue;
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "leadership",
                    title: lead.role || "Leadership",
                    organization: lead.organization || "",
                    text_content: `${lead.role || ""}${lead.organization ? ` at ${lead.organization}` : ""}${lead.description ? `: ${lead.description}` : ""}`.trim(),
                    tags: []
                });
            }
        }
        if (skillFocused) {
            const skills = coerceSkills(resume.skills);
            const targeted = detectSkillCategories(qLower);
            const cats = targeted.length > 0 ? targeted : SKILL_CATEGORIES;
            const SKILL_CATEGORY_LABEL3 = {
                languages: "Programming Languages",
                frameworks: "Frameworks & Libraries",
                cloud: "Cloud & Platforms",
                databases: "Databases",
                ml: "AI / ML",
                devops: "DevOps & Infrastructure",
                tools: "Tools"
            };
            for (const cat of cats) {
                const items = skills[cat];
                if (!items || items.length === 0)
                    continue;
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: `skills_${cat}`,
                    title: SKILL_CATEGORY_LABEL3[cat] || cat,
                    text_content: `${SKILL_CATEGORY_LABEL3[cat] || cat}: ${items.join(", ")}`,
                    tags: items
                });
            }
            if (targeted.length > 0 && nodes.filter((n2) => String(n2.category).startsWith("skills_")).length === 0) {
                const label = SKILL_CATEGORY_LABEL3[targeted[0]] || targeted[0];
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: `skills_${targeted[0]}`,
                    title: label,
                    text_content: `${label}: (none listed on the resume)`,
                    tags: []
                });
            }
        }
        if (nodes.length === 0)
            return null;
        console.log(`[KnowledgeOrchestrator] Deterministic structured pack: ${nodes.length} node(s) for categories [${hints.join(", ")}] \u2014 bypassing vector search`);
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
    buildCompactIdentityBlock() {
        if (!this.activeResume)
            return "";
        try {
            const resume = this.activeResume.structured_data;
            const name = resume.identity?.name?.trim();
            const latest = resume.experience?.[0];
            const facts = [];
            if (name)
                facts.push(`Name: ${escapeXml(name)}`);
            if (latest?.role) {
                facts.push(`Current role: ${escapeXml(latest.role)}${latest.company ? ` at ${escapeXml(latest.company)}` : ""}`);
            }
            if (this.activeJD) {
                const jd = this.activeJD.structured_data;
                if (jd.title) {
                    facts.push(`Target role: ${escapeXml(jd.title)}${jd.company ? ` at ${escapeXml(jd.company)}` : ""}`);
                }
            }
            if (facts.length === 0)
                return "";
            return `<candidate_identity note="background only; ignore for purely generic/technical questions">
${facts.join("\n")}
</candidate_identity>
The above identifies the user. If the question is about the user (their fit, their decisions, their situation), answer from it in first person. If it's a generic/technical question, ignore this block and answer normally.`;
        }
        catch {
            return "";
        }
    }
    // Temporary helper for UI compatibility while refactoring
    getProfileData() {
        if (!this.activeResume && !this.activeJD)
            return null;
        let jdData = null;
        if (this.activeJD) {
            const jd = this.activeJD.structured_data;
            jdData = {
                title: jd.title || jd.role || "Unknown Title",
                company: jd.company || "",
                location: jd.location || "Unknown Location",
                level: jd.level,
                requirements: jd.requirements,
                technologies: jd.technologies,
                keywords: jd.keywords,
                compensation_hint: normalizeCompensationHint(jd.compensation_hint),
                min_years_experience: jd.min_years_experience
            };
        }
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
                compactPersona: this.getCompactJDHeader() || "Job-Aware Mode Active",
                toneDirective: this.depthScorer.getToneDirective()
            };
        }
        try {
            const structured = this.activeResume.structured_data;
            const gapAnalysis = this.getGapAnalysis();
            const negotiationScript = this.getNegotiationScript();
            const coverLetter = this.getCoverLetter();
            const mockQuestions = this.getMockQuestions();
            const cultureMappings = this.getCultureMappings();
            const aotStatus = this.aotPipeline.getStatus();
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
                nodeCount: this.db.getNodeCount("resume" /* RESUME */),
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
                compactPersona: this.getCompactJDHeader() || "Resume-Aware Mode Active",
                toneDirective: this.depthScorer.getToneDirective()
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Feed an interviewer's STT transcript to the technical depth scorer and negotiation tracker.
     * Call this ONLY from the verified STT path in main.ts where speaker === 'interviewer'.
     */
    feedInterviewerUtterance(text4) {
        this.depthScorer.addUtterance(text4);
        this.negotiationTracker.addRecruiterUtterance(text4);
    }
    /**
     * Feed text to the depth scorer only — does NOT touch the negotiation tracker.
     * Use this from chatWithGemini/streamChat where the message is the user's question to the AI,
     * not a verified recruiter utterance. Prevents misclassifying user questions as recruiter offers.
     */
    feedForDepthScoring(text4) {
        this.depthScorer.addUtterance(text4);
    }
    getNegotiationTracker() {
        return this.negotiationTracker;
    }
    resetNegotiationSession() {
        this.negotiationTracker.reset();
        this._lastNegotiationTurnAt = 0;
        this._nonCompTurnsSinceNegotiation = 0;
    }
    /**
     * Get extracted vocabulary for STT hints, filtering out long sentences.
     */
    getVocabularyHints() {
        const hints = /* @__PURE__ */ new Set();
        if (this.activeJD) {
            const jd = this.activeJD.structured_data;
            if (jd.company)
                hints.add(jd.company);
            if (jd.title)
                hints.add(jd.title);
            jd.technologies?.forEach((t3) => hints.add(t3));
            jd.keywords?.forEach((k2) => hints.add(k2));
            for (const req of jd.requirements || []) {
                if (req.trim().split(/\s+/).length <= 3) {
                    hints.add(req.trim());
                }
            }
        }
        return Array.from(hints);
    }
};
export { KnowledgeOrchestrator };
