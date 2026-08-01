# Retrieval System Inventory — Natively (electron/)

**Audit date:** 2026-07-29
**Repo:** `/Users/evin/natively-cluely-ai-assistant`
**Branch:** `main` (`0001587a`)
**IMPORTANT — this documents WORKING-TREE state, not `HEAD`.** `electron/rag/VectorStore.ts` and
`electron/rag/RAGManager.ts` are modified (`M`), and `electron/rag/vectorSearchWorker.ts` is deleted
(`D`) in the working tree. The only surviving reference to the deleted worker is a verbatim SQL copy
in a test: `/Users/evin/natively-cluely-ai-assistant/electron/rag/__tests__/SearchSpaceFilter.test.mjs:59`.
`scripts/VectorStoreRebuild.js` is deleted with no remaining references.

**Reachability method.** Callers were traced by basename + exported-symbol grep across `electron/`,
`premium/`, `src/`, and `scripts/` — not by `^import` alone, because this codebase resolves most
Context OS / knowledge modules through lazy `require()` inside `IntelligenceEngine.ts`,
`ipcHandlers.ts`, and `LLMHelper.ts` (e.g. `electron/IntelligenceEngine.ts:2104-2108`). Two barrels
re-export symbols and were symbol-mapped first: `electron/rag/index.ts` and
`electron/intelligence/context-os/index.ts`.

> **Grep-integrity note (matters for every DEAD/TEST-ONLY verdict below).** Four source files in
> this repo are misdetected as *binary* by BSD `grep`, which silently suppresses line output:
> `electron/intelligence/context-os/TurnEvidenceCoordinator.ts`,
> `premium/electron/knowledge/HeuristicExtractor.ts`, `src/components/ui/card.tsx`, and
> `electron/intelligence/__tests__/WtaOutputShapeWiring.test.mjs` (`file` reports `data` for
> `TurnEvidenceCoordinator.ts`). Every DEAD / TEST-ONLY verdict in this document was **re-verified
> with `/usr/bin/grep -ra`** (binary-as-text) across `electron premium src scripts`. Any future
> audit of this repo that uses plain `grep` will produce false DEADs on those four files.

**Labels used in column 9:**
- **LIVE** — reachable from a real answer path with default flags in a packaged/production build.
- **LIVE-FLAGGED(ON)** / **LIVE-FLAGGED(OFF)** / **LIVE-FLAGGED(DEV-ONLY)** — real call site, but
  guarded by an `intelligenceFlags` key. `DEV-ONLY` = `default: isInternalDevTestContext`
  (`electron/intelligence/intelligenceFlags.ts:374-382`), i.e. ON in dev/test/benchmark, **OFF in
  production** unless the user/env opts in. Verified body — none of these four conditions can hold
  in a packaged build, so DEV-ONLY == OFF in production:
  ```ts
  function isInternalDevTestContext(): boolean {
    try {
      if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') return true;
      if (process.env.BENCHMARK_MODEL) return true;
      if (process.env.NATIVELY_INTERNAL === '1' || process.env.NATIVELY_DEV === '1') return true;
    } catch { /* default false */ }
    return false;
  }
  ```
  (Caveat: resolution order is env → `SettingsManager` → default, so a persisted setting can still
  turn any of these on — see UNDETERMINED §4.)
- **TEST-ONLY** — only referenced from `__tests__`/`*.test.mjs`.
- **DEAD** — no references outside its own file.
- **UNDETERMINED** — stated explicitly with what was checked.

---

## 0. Executive summary of invariant status

| Invariant | Status | Primary evidence |
|---|---|---|
| 1. All retrieved material becomes `EvidenceItem` | **VIOLATED** | `electron/rag/RAGManager.ts:240-256` (meeting RAG → raw prompt string); `electron/services/knowledge/OkfProfileRetriever.ts:234` (returns `block: string`); `electron/services/modes/ModeHybridRetriever.ts` `formattedContext` XML string consumed directly at `electron/LLMHelper.ts:4927` |
| 2. Every `EvidenceItem` carries kind/id/authority/trust/**scope id** | **PARTIAL** | `electron/intelligence/context-os/evidencePack.ts:35-57` has no `scopeId` field. Scope is collapsed into `sourceId` from `cap?.scopeId` (`EvidenceOrchestrator.ts:211`, `:260`) and is often a fallback (`'active-mode'`, `'active-profile'`) |
| 3. Retrieval accepts `SourceCapability[]` | **PARTIAL** | Only 3 of ~14 retrievers take a contract: `EvidenceResolver.resolve` (`EvidenceResolver.ts:278`), `ProfileEvidenceService.retrieveEvidence` (`ProfileEvidenceService.ts:97`), `EvidenceOrchestrator.buildEvidencePack` (TEST-ONLY). `ModeHybridRetriever`, `ModeContextRetriever`, `RAGRetriever`, `VectorStore`, `OkfRetriever`, `GraphRetriever`, `SearchOrchestrator`, premium `HybridSearchEngine` accept none |
| 4. No capability → no factual evidence | **PARTIAL / FLAG-DEPENDENT** | Enforced in `EvidenceResolver.ts:302-314` and `ProfileEvidenceService.ts:99-109`. But `contextOsEnforceSourceCapabilities` defaults **DEV-ONLY** (`intelligenceFlags.ts:535`), and all legacy raw-text injection paths (`ipcHandlers.ts:2516-2530`, `LLMHelper.ts:4927`) bypass capabilities entirely |
| 5. Prior assistant responses → referent evidence only unless verified | **PARTIAL — holds on 3 paths, unenforced on plain manual chat** | Holds: `EvidenceResolver.ts:106-108` uses prior assistant text ONLY to expand the retrieval query (`followUpReferentHint`) and never shows it to the model; `EvidenceOrchestrator.ts:169-175` demotes referent-only capabilities; `TemporalContextBuilder.ts:183-190` injects prior responses only as `<previous_responses_to_avoid_repeating>` (negative/style guidance, not a fact source). Not enforced: `contextRoute.ts:132` made `prior_assistant_responses` fail-closed, but its consumer `conversationHistoryPolicy.ts:36/75` is reachable only from `promptComposer.composePrompt`, which is **TEST-ONLY**. The live strip is a *second, duplicate* `stripPriorAssistantTurns` at `ipcHandlers.ts:153`, and it fires only for doc-grounded turns (`:2096`) and phone doc-grounded (`:11004`) — see §1.8 / F10 |
| 6. Meeting RAG uses the same EvidencePack interface as document RAG | **VIOLATED** | `meetingChunksToEvidenceItems` (`meetingRagEvidence.ts:33`) is **TEST-ONLY**. Live meeting RAG (`ipcHandlers.ts:9012-9180`) goes RAGManager → `buildRAGPrompt` → LLM with zero EvidencePack |
| 7. Property-aware matching in scores/validation metadata | **HOLDS where EvidencePack is used** | `score.propertyMatch` set at `EvidenceResolver.ts:432`, `:606`; `EvidenceOrchestrator.ts:241`, `:269`; `meetingRagEvidence.ts:108`. Absent from every non-EvidencePack retriever |
| 8. Similarity alone is not proof | **HOLDS in Context OS, VIOLATED elsewhere** | `evidenceSufficiency.ts:69-77` requires `propertySatisfied` before `answerable`. But `ModeHybridRetriever` `MIN_COMBINED_SCORE = 0.15` (`ModeHybridRetriever.ts:97`), `ModeContextRetriever` `MIN_RELEVANCE_SCORE = 0.18` (`:120`), `RAGRetriever` `minSimilarity: 0.25` (`:90`), premium `RELEVANCE_THRESHOLD = 0.55` (`HybridSearchEngine.ts:3`) all gate purely on similarity |

---

## 1. Master inventory table

Columns: (1) path + main export · (2) index/storage · (3) source scopes · (4) metadata filters ·
(5) scores/thresholds · (6) failure/retry/timeout · (7) **answerability decision** · (8) query
rewrite/expansion · (9) status.

### 1.1 `electron/rag/` — meeting/transcript RAG stack

| # | File + main export | Index + storage | Source scopes | Metadata filters (⚠ = can run unscoped) | Scores + thresholds | Failure / retry / timeout | **Answerability decision?** | Query rewrite? | Status |
|---|---|---|---|---|---|---|---|---|---|
| R1 | `electron/rag/RAGManager.ts:86` `class RAGManager` | Orchestrator over VectorStore + EmbeddingPipeline (better-sqlite3) | meeting transcript chunks + meeting summaries | `meetingId` on `queryMeeting`; **⚠ `queryGlobal` (`:262`) passes NO meetingId** | delegates | `RAG_STREAM_STALL_MS = 15_000` (`:27`) per-token `Promise.race` (`:29-59`); `AUTO_REINDEX_DEFER_MS=15_000`, `REINDEX_LIVE_RECHECK_MS=30_000`, `REINDEX_MAX_LIVE_WAITS=20`, `REINDEX_DRAIN_POLL_MS=2_000`, `REINDEX_MAX_DRAIN_POLLS=900` (`:554-558`) | **YES.** Throws `NO_MEETING_EMBEDDINGS` (`:235`) and `NO_RELEVANT_CONTEXT_FOUND` (`:244`); `queryGlobal` yields `NO_GLOBAL_CONTEXT_FALLBACK` (`:274`). These are consumed as "fall back to plain chat" at `ipcHandlers.ts:9065-9070`, `:9132-9136` — i.e. **the app answers WITHOUT evidence** rather than refusing (the "fall back to regular chat" semantics are the handler's own, `ipcHandlers.ts:9019` and `:9065` comments; the renderer side was not read) | No | **LIVE** — `main.ts:2107`, IPC `rag:query-meeting` `ipcHandlers.ts:9013`, `rag:query-live` `:9080`, `rag:query-global` `:9148` |
| R2 | `electron/rag/RAGRetriever.ts:42` `class RAGRetriever` | vector-only over VectorStore | meeting transcript chunks; meeting summaries (global path) | passes `meetingId` through; **⚠ `retrieveGlobal` (`:152`) never sets `meetingId` — cross-meeting by design** | `minSimilarity: 0.25` (`:90`, `:186`); `topK=8`, over-fetch `topK*2`; `maxTokens=1500`; `recencyWeight=0.3`; recency half-life 168 h (`:265`); summary-boost `×1.2` (`:198`) | embed failure → returns empty context (`:74-83`, `:171-179`). No retry, no timeout of its own | **Partially.** Returns `chunks: []`, which R1 converts into the throw at `RAGManager.ts:244` | **No rewrite**, but `detectIntent()` (`:276`) and `detectScope()` (`:315`) are regex classifiers that steer retrieval | **LIVE** (only via R1) |
| R3 | `electron/rag/VectorStore.ts:46` `class VectorStore` | **sqlite-vec `vec0` virtual tables** `vec_chunks_{dim}` / `vec_summaries_{dim}`, with pure-JS cosine fallback; BLOB Float32 in `chunks.embedding`; shared better-sqlite3 connection | meeting transcript chunks, meeting summaries | `spaceKey` is **MANDATORY** — `searchSimilar` returns `[]` without it (`:186-189`), same for `searchSummaries` (`:457-460`). `meetingId` is **OPTIONAL** (`:172`) → **⚠ `searchSimilar` with no `meetingId` scans every meeting in the active embedding space**. There is **no userId/orgId column anywhere** (single-user desktop DB) | `minSimilarity = 0.25` default (`:179`); native path `similarity = 1 - distance` (`:243`); `fetchLimit = limit*4` when filtered (`:215`) | native vec search throws → falls back to JS cosine (`:194-197`); vec0 insert failures logged and swallowed (`:132`); `destroy()` is a no-op (`:82`) | No | No | **LIVE** (via R1/R2 and via `ModeHybridRetriever`) |
| R4 | `electron/rag/EmbeddingPipeline.ts` `class EmbeddingPipeline` | durable `embedding_queue` table + provider cascade (`EmbeddingProviderResolver`) | n/a (write path) | queue rows keyed by `meeting_id`,`chunk_id` (UNIQUE since DB v10, `DatabaseManager.ts:673`) | n/a | `EMBED_TIMEOUT_MS` 30 s (referenced `electron/llm/WhatToAnswerLLM.ts:26`); provider fallback + `clearEmbeddingsForMeeting` on mid-stream provider switch | No | No | **LIVE** — `RAGManager.ts:99`, `main.ts:2123` (shared into ModesManager) |
| R5 | `electron/rag/LiveRAGIndexer.ts:19` | JIT chunk+embed of the live transcript into the same VectorStore tables | live transcript | writes under the synthetic meeting id `live-meeting-current` (`RAGManager.ts:343-345`) | n/a | n/a | Indirect: `hasIndexedChunks()` gates `rag:query-live` at `ipcHandlers.ts:9094` | No | **LIVE** — `main.ts:2862` feeds finals, `main.ts:5270` starts |
| R6 | `electron/rag/SemanticChunker.ts` `chunkTranscript`, `formatChunkForContext` | pure | transcript | n/a | n/a | n/a | No | No | **LIVE** |
| R7 | `electron/rag/TranscriptPreprocessor.ts` `preprocessTranscript`, `estimateTokens` | pure | transcript | n/a | n/a | n/a | No | No | **LIVE** |
| R8 | `electron/rag/LocalReranker.ts` `getLocalReranker()` | local ONNX cross-encoder in a worker thread (`localRerankerWorker.ts`) | any candidate list | none | rerank logit replaces combined score | ONNX poison sentinel (`main.ts:1432-1456`), cleared via `ipcHandlers.ts:7144`; batch cap `RERANK_BATCH_SIZE = 6` and pool `RERANK_CANDIDATE_POOL = 30` at `ModeHybridRetriever.ts:117-128` | No | No | **LIVE-FLAGGED(DEV-ONLY)** — `ragLocalRerank` default `isInternalDevTestContext` (`intelligenceFlags.ts:437`); required call sites `ModeHybridRetriever.ts:1361`, `ModesManager.ts:959` |
| R9 | `electron/rag/embeddingSpace.ts` `embeddingSpaceKey`, `buildLegacySpaceCaseSql` | pure — composite `${name}:${model}:${dims}` identity | n/a | **This is the isolation primitive** used by R3 and by `ModeHybridRetriever.loadPersistedEmbeddings` | n/a | n/a | No | No | **LIVE** — all 4 providers + `DatabaseManager.ts:8` |
| R10 | `electron/rag/vectorSearchWorker.ts` | (deleted in working tree) | — | — | — | — | — | — | **DELETED** — only residual reference is a verbatim SQL copy in `electron/rag/__tests__/SearchSpaceFilter.test.mjs:59` |

### 1.2 `electron/services/modes/` + `electron/services/ModeContextRetriever.ts` — document / reference-file retrieval

| # | File + main export | Index + storage | Source scopes | Metadata filters | Scores + thresholds | Failure / retry / timeout | **Answerability decision?** | Query rewrite? | Status |
|---|---|---|---|---|---|---|---|---|---|
| M1 | `electron/services/modes/ModeHybridRetriever.ts:203` `class ModeHybridRetriever` | **Hand-rolled lexical + dense hybrid.** Persisted chunks + Float32 BLOB vectors in its own `mode_reference_chunks` table (created `:252-266`), state in `mode_reference_index_state` (`:241-247`). **NOT sqlite FTS5, NOT BM25** despite the file header claim on line 2 — `computeFtsScore` (`:626`) is normalized unique-term overlap | mode reference files (uploaded docs/PDF/CSV); optional live `transcript` string passed in | Scope filter is `WHERE file_id IN (...) AND embedding IS NOT NULL AND embedding_space = ?` (`:504-507`). **⚠ There is no `mode_id`, `user_id`, or `version` column on `mode_reference_chunks` — scoping is entirely caller-supplied via the `files[]` array.** A caller that passes the wrong file list gets cross-mode leakage with no DB-level guard | `MIN_COMBINED_SCORE = 0.15` (`:97`); `FTS_WEIGHT = 0.4` alpha (`:98`); `DEFAULT_TOKEN_BUDGET = 1800`, `DEFAULT_TOP_K = 6` (`:87-88`); `CHUNK_WORDS = 140`, `CHUNK_OVERLAP = 30` (`:89-90`); confidence gate `CONF_TOP_SCORE_FLOOR = 0.30`, `CONF_MARGIN_MIN = 0.05`, `CONF_CONFIDENT_FLOOR = 0.45`, `CONF_MIN_QUERY_TOKENS = 3` (`:106-109`) | hybrid throws → lexical fallback + throttled telemetry (`:713`, 60 s per `(modeId,reason)`); rerank raced against `RERANK_BUDGET_MS = 1200` (`:1221-1236`); `RERANK_CANDIDATE_POOL = 30` (`:116`), `RERANK_BATCH_SIZE = 6` (`:126`); embed batch `MODE_INDEX_EMBED_BATCH = 100` (`:96`); env kill-switch `NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL` (`:128`) | **Emits the signal, does not decide.** `RetrievalConfidence.lowConfidence` (`:769-833`) is documented OBSERVE-ONLY; it gates *rerank escalation*, not answerability. `computeDocumentAnswerabilityScore` (imported from `electron/llm/documentGroundedPrompt.ts`) is a **ranking boost**, applied at `:1601 applyAnswerabilityScores` | Yes — `normalizeDocumentGroundedRetrievalQuery` + `followUpReferentHint` expansion (`:537-551` call site in EvidenceResolver) | **LIVE** — `ModeContextRetriever.ts:1697 ensureHybridRetriever()`, reached from `LLMHelper.ts:4894`, `ipcHandlers.ts:2401`, `EvidenceResolver.ts:537` |
| M2 | `electron/services/ModeContextRetriever.ts:834` `class ModeContextRetriever` | **Pure in-memory lexical.** Re-chunks file content per query into a cached array; no DB index of its own (delegates to M1 for the hybrid path) | mode reference files | same as M1 — caller-supplied `files[]` only | `MIN_RELEVANCE_SCORE = 0.18` (`:120`); `DEFAULT_TOKEN_BUDGET = 1800`, `DEFAULT_TOP_K = 6` (`:110-111`); `DOC_GROUNDED_TOKEN_BUDGET = 3600`, `DOC_GROUNDED_TOP_K = 12` (`:118-119`); `ENTITY_WEIGHT = 0.45` (`:540`); short-query floor relaxation `MIN_RELEVANCE_SCORE * min(1, queryWords/5)` (`:1010-1013`); flat-field detector `(top - mid) < 0.12` (`:1253`); navigation/ToC match forces `score = max(score, 0.9)` (`:1213`); sibling-section rescue capped `0.15` (`:1172`); hint weight `0.30`/`0.40` (`:1355`) | synchronous, no timeout; `retryLexicalOnlyFiles` (`:1660`) re-attempts embedding for `lexical_only` files; db-unavailable branch emits via `ModeHybridRetriever.emitFallbackTelemetryStatic` | **No hard gate** — returns fewer/zero snippets; the *prompt* then carries the refusal instruction (`EVIDENCE_USE_RULE` in `electron/llm/documentGroundedPrompt.ts`) | Yes — planner-driven target/sibling section expansion (`:1114`), rescue hints (`:1304`) | **LIVE** — `ModesManager.ts:332`, reached via `LLMHelper.ts:4927 buildRetrievedActiveModeContextBlock` and `ipcHandlers.ts:3536` |
| M3 | `electron/services/modes/DocumentMap.ts` `buildDocumentMap`, `resolveTargetSections`, `sectionAwareChunksFromMap`, `selectTableOfContentsEntries`, `sentenceAwareWindows`, `tabularChunks` | pure structural map over document text | reference files | n/a | n/a | n/a | No — supplies structure used by M1/M2 boosts | Indirectly (section targeting) | **LIVE** — `ModeHybridRetriever.ts:10`, `ModeContextRetriever.ts` |
| M4 | `electron/services/modes/retrievalTextMatch.ts` `includesPlannerTerm` | pure | n/a | n/a | n/a | n/a | No | No | **LIVE** — `electron/llm/AnswerPlanner.ts:8`, `DocumentMap.ts:6` |
| M5 | `electron/services/ModeReferenceFileIngestion.ts` | ingestion/extraction only (writes the corpus M1/M2 read); pairs with `electron/services/SafeDocumentTextExtractor.ts` | reference files | n/a | n/a | n/a | No | No | **LIVE** (ingest path) — verified with `-ra`: non-test references are `electron/ipcHandlers.ts` and `electron/services/SafeDocumentTextExtractor.ts` |

### 1.3 `electron/services/knowledge/` — OKF (Objective Knowledge Format) card retrieval

| # | File + main export | Index + storage | Source scopes | Metadata filters | Scores + thresholds | Failure / retry / timeout | **Answerability decision?** | Query rewrite? | Status |
|---|---|---|---|---|---|---|---|---|---|
| K1 | `electron/services/knowledge/OkfRetriever.ts:130` `queryOkfCards` | **Pure lexical, in-memory full scan** of `pack.cards` with per-pack IDF. Packs persisted by `KnowledgePackStore` in `knowledge_*` tables | document reference files (OKF document cards) **and** resume/JD (OKF profile cards — same function, different pack) | Scoped by the `pack` object the caller hands in + `options.fileId` for cache keying. **⚠ No scope predicate inside the function itself.** Rejected cards excluded (`:150`) | `topN = 6`, `minScore = 0.12` (`:136-137`); weights `0.35·title + 0.30·body + 0.20·entity + 0.05·tag` (`:97-105`); `exactTitleBoost = 0.4` (`:88`); confidence boosts `high 0.15 / medium 0.05 / low 0` (`:32`); type boosts `0.1–0.35` (`:33-43`); IDF `ln(1 + N/(1+df))` (`:184`) | synchronous, pure; cache invalidated on `packVersion` bump (`:140`, `:197`) | No — scoring only. **The answerability decision built on it lives in `EvidenceResolver.resolveFromOkf`** | No | **LIVE-FLAGGED(DEV-ONLY)** via `okfKnowledgePacks` + `okfHybridRetrieval` (`intelligenceFlags.ts:450,452`). Call sites: `LLMHelper.ts:4773`, `:5086`; `ipcHandlers.ts:2388`, `:3586`; `IntelligenceEngine.ts:2107`; `WhatToAnswerLLM.ts:311`; `EvidenceResolver.ts:391` |
| K2 | `electron/services/knowledge/OkfProfileRetriever.ts:148` `retrieveProfileEvidence` | wraps K1 over `ProfilePackBuilder.getAllProfilePacks()` | resume, JD, profile artifacts (negotiation/gap/intro/mock-questions/culture) | Gate chain only: `hasExplicitPlan` → flag → `profileContextPolicy !== 'forbidden'` → `!documentGroundedActive` (`:150-168`). No per-user/version DB filter | `topN = 6`; candidate widen `max(topN*2, 12)` at `minScore 0.1` (`:189`); intent→type boosts `0.2–0.6` (`:80-101`); relative band floor `topScore >= 0.35 ? max(0.1, topScore*0.5) : 0` (`:225`); per-card `MAX_CARD_EVIDENCE_CHARS = 1000` (`:124`) | pure; `ProfilePackBuilder` throw → `EMPTY('no_pack')` (`:173-175`) | **YES, a soft one** — returns `{allowed:true, blockedReason:'no_match', block:''}` (`:230`). Caller treats empty block as "answer without profile evidence", not as refusal (`ipcHandlers.ts:2526`) | No | **LIVE-FLAGGED(DEV-ONLY)** — `okfProfileHybridRetrieval` (`intelligenceFlags.ts:462`). Call site `ipcHandlers.ts:2516`. **⚠ Returns a raw prompt string `block`, not `EvidenceItem[]` — invariant 1 violation on a live path** |
| K3 | `electron/services/knowledge/GraphRetriever.ts:35` `expandGraph`, `:80` `resolveStartNodeIds`, `:98` `formatGraphHintsForPrompt` | in-memory BFS over `knowledge_relations` rows | OKF document cards + profile cards | start nodes derived from `classifyQuestion(...).targetEntities` | (no numeric cutoffs in file) | pure | No — additive hints only (`KnowledgeManager.ts:110`: "only ever ADDS retrieval hints") | Yes — **graph query expansion** | **LIVE-FLAGGED(OFF)** — `okfGraphExpansion` / `okfProfileGraphExpansion` both `default: false` (`intelligenceFlags.ts:454,464`). Call sites `LLMHelper.ts:5105`, `ModesManager.ts:1492` |
| K4 | `electron/services/knowledge/QuestionClassifier.ts` `classifyQuestion` | pure regex/lexical | question text | n/a | returns `{type, isSynthesis, targetEntities, softEntities}` | pure | Feeds every answerability gate downstream (entity/synthesis branches in `EvidenceResolver.ts:466-505`, `evidenceSufficiency.ts:57`) | Extracts entities used for expansion | **LIVE** — `LLMHelper.ts:4772`, `ipcHandlers.ts:2387`/`3571`/`3657`, `IntelligenceEngine.ts:2106`, `EvidenceOrchestrator.ts:40` |
| K5 | `electron/services/knowledge/EvidenceAssembler.ts:71` `assembleEvidence` → `RetrievalEvidencePack` (`:77`) | assembles OKF scored cards into a 4-tier answer policy | OKF document cards | n/a | `computeTier` → tier 1 confident / 2 synthesis / 3 soft refusal / 4 hard refusal (`RetrievalEvidencePack.ts:36`) | pure | **YES — a 4-tier answerability decision.** Consumed by the doc-grounded false-refusal repair gate at `ipcHandlers.ts:3739` (`isTier1Or2Evidence`) | No | **LIVE-FLAGGED(DEV-ONLY)** — `ipcHandlers.ts:3573` under the OKF flags. **⚠ This is a SECOND, parallel evidence-pack type to `context-os/evidencePack.ts` — see §3** |
| K6 | `electron/services/knowledge/KnowledgeCache.ts` `getCachedRetrieval`/`setCachedRetrieval` | in-memory retrieval-result cache | OKF packs | key = `(fileId, packVersion, question, topN)` (`OkfRetriever.ts:140`) | n/a | invalidated by `packVersion` bump | No | No | **LIVE** (with K1) |
| K7 | `electron/services/knowledge/KnowledgeIndexQueue.ts`, `KnowledgeManager.ts`, `KnowledgePackStore.ts`, `ProfilePackBuilder.ts`, `OkfExtractor.ts`, `OkfCardBuilder.ts`, `OkfVerifier.ts`, `OkfProfileVerifier.ts`, `ProfileCardTemplates.ts`, `ProfileGraphExtractor.ts`, `GraphExtractor.ts`, `FrontMatterExtractor.ts` | index/write path for OKF packs, `knowledge_sources` / `knowledge_index_versions` tables (`DatabaseManager.ts:1604`, `:1838`) — these DO carry `mode_id`, `content_hash`, `index_version`, `embedding_space` | reference files + resume/JD | `knowledge_sources` has `mode_id` + `embedding_space` + `content_hash` — the **best-scoped** table in the retrieval stack | n/a | `KnowledgeIndexQueue` retries; self-heal sweep at `main.ts:2235` | No | No | **LIVE** (ingest) |
| K8 | `electron/services/knowledge/OkfPromptFormatter.ts`, `OkfMarkdownExporter.ts`, `ProfileMarkdownExporter.ts`, `OkfConformance.ts`, `OkfSlugger.ts`, `OkfCardEditor.ts`, `deleteProfileTransactional.ts` | formatting/admin | — | — | — | — | No | No | **LIVE** (UI/IPC), non-retrieval |

### 1.4 `electron/intelligence/context-os/` — the typed EvidencePack layer

| # | File + main export | Index + storage | Source scopes | Metadata filters | Scores + thresholds | Failure / retry / timeout | **Answerability decision?** | Query rewrite? | Status |
|---|---|---|---|---|---|---|---|---|---|
| C1 | `electron/intelligence/context-os/EvidenceResolver.ts:275` `class EvidenceResolver` | **no storage of its own** — orchestrates K1 (OKF) then M1 (hybrid) | reference files only (explicitly excludes profile/transcript, `:296-301`) | **Capability-scoped**: `allowsRetrieval(contract,'mode_reference_chunk'\|'mode_reference_file')` (`:302`) → hard return with `rejectedSources:[{reason:'forbidden_source'}]` (`:305-314`) | `OKF_CARD_HIGH_CONFIDENCE_SCORE = 0.55` (`:190`); `MIN_ANSWER_CONFIDENCE = 0.32` imported from `evidenceSufficiency.ts:30`; relaxed repair pass `tokenBudget 5200`, `topK 24` (`:542-543`) | hybrid throw → insufficient pack (`:560-570`); zero chunks → insufficient (`:572-581`) | **YES — THE primary one.** `answerPolicy` at `:706-710` from `deriveEvidenceSufficiency`. Also 4 distinct earlier hard-stops: clarify (`:285`), forbidden source (`:304`), no mode (`:317`), no files (`:329`). Plus the salient-distinctive-term gate (`:466-505`) and the confidence floor (`:620-631`) | Yes — `distinctiveQueryTerms` (`:219`), `salientDistinctiveTerms` (`:241`), `followUpReferentHint` (`:550`) | **LIVE-FLAGGED** — `ipcHandlers.ts:2386-2410` (behind `contextOsEvidencePackEnabled` default **true**, `intelligenceFlags.ts:520`, AND `contextOsMultiFamilyEvidenceEnabled` **DEV-ONLY**, `:537`); `LLMHelper.ts:4741-4806` (doc-grounded path) |
| C2 | `electron/intelligence/context-os/ProfileEvidenceService.ts:37` | wraps `selectManualProfileEvidence` (`electron/llm/manualProfileIntelligence.ts`) | resume, projects, JD | **Capability-scoped and pre-filtered**: unauthorized families are passed as `undefined` BEFORE the selector runs (`:69-70`), then filtered again post-hoc (`:78`) | `score.final` from confidence band: high `0.9` / medium `0.6` / low `0.3` (`:148`) | try/catch → `null` (`:87-89`) | **YES** — `answerPolicy` at `:181-183`: `refuse_insufficient_evidence` \| `answer` \| `answer_with_uncertainty` | No | **LIVE** — `ipcHandlers.ts:1274` (shadow), `:1759` (gate), `:2427` (coordinator), `IntelligenceEngine.ts:2174` |
| C3 | `electron/intelligence/context-os/TurnEvidenceCoordinator.ts:164` `class TurnEvidenceCoordinator`, `:120 allocateRequiredEvidenceFamilies` | composes C1 + C2 packs via `Promise.allSettled` (`:186`) so one retriever's throw can't discard the other's evidence | reference_files, profile_resume, projects, profile_jd. **`live_transcript` and `meeting_rag` are explicitly OUT OF SCOPE** — `KNOWN_COORDINATOR_KINDS` at `ipcHandlers.ts:2352` (and a duplicate `KNOWN_COORDINATOR_KINDS_EARLY` at `:1835`) | required-kind reservation before budget fill (`:132-140`) | `DEFAULT_EVIDENCE_PACK_MAX_CHARS = 14_000` (`:111`) | `COORDINATOR_BUDGET_MS` = 2000 (doc-grounded) / 1000 (`ipcHandlers.ts:2450`); timeout → throw → **silent fall-through to legacy raw-text injection** (`:2494-2499`) | **YES** — 4 early failure packs (`:167-175`), `missingKinds` → `required_family_starved` / `retrieval_returned_no_evidence` (`:200-205`), and `propertySatisfied`-gated `answerPolicy` (`:213-217`) | No | **LIVE-FLAGGED(DEV-ONLY)** — requires `contextOsMultiFamilyEvidenceEnabled` (`intelligenceFlags.ts:537`) |
| C4 | `electron/intelligence/context-os/evidenceSufficiency.ts:45` `deriveEvidenceSufficiency`, `:154` `selectSmallestSufficientEvidence` | pure | any EvidencePack | `targetEntities` from K4 | **`MIN_ANSWER_CONFIDENCE = 0.32` (`:30`)** — the single shared floor | pure | **YES — the canonical pre-dispatch decision.** Ordered reasons: `resolver_unavailable` → `conflicting` → `property_missing` → `entity_missing` → `low_confidence` → answerable (`:65-86`). **Property satisfaction is required before confidence is even consulted → invariant 8 holds here** | No | **LIVE** (only through C1: `EvidenceResolver.ts:666`, `:696`) |
| C5 | `electron/intelligence/context-os/EvidenceOrchestrator.ts:126` `class EvidenceOrchestrator` | capability-scoped adapter that wraps 5 legacy string retrievers into EvidenceItems (`:44-55`) | mode chunks, profile, transcript, hindsight, **meeting RAG** | **Best capability model in the repo**: `allowsRetrieval` checked BEFORE calling the retriever (`:149-155`); referent-only demotion (`:169-175`); hindsight force-demoted to `referent_only` (`:196-201`) | `final: 0.5` placeholder for whole-block items (`:242`, `:270`); `propertyMatch` from `textCanProveProperty` | retriever throw → skip source (`:160-163`) | **YES** — `answerPolicy` at `:330-336` | No | **TEST-ONLY.** Only `parseModeSnippets` (`:91`) is live, via `generationContext.ts:17`. Verified: `EvidenceOrchestrator` appears only in `context-os/index.ts`, its own file, `ProfileEvidenceService.ts` (comment), and 4 `__tests__` files. **This is the module that would satisfy invariants 3+6 — and it is dark** |
| C6 | `electron/intelligence/context-os/meetingRagEvidence.ts:33` `meetingChunksToEvidenceItems` | adapter: `ScoredChunk[]` → `EvidenceItem[]` | meeting RAG chunks | **cross-meeting isolation** via `currentMeetingId` → `wrong_entity` rejection (`:67-77`); capability check `cap.permissions.useAsEvidence` (`:45-55`) | `MEETING_RAG_MIN_SIMILARITY = 0.3` (`:24`) | pure | **YES** — `confident: items.length > 0` | No | **TEST-ONLY.** Verified: referenced only by `context-os/index.ts` and `electron/intelligence/__tests__/ContextOsMeetingRagEvidence.test.mjs`. **⚠ This is invariant 6's implementation and it has zero production callers** |
| C7 | `electron/intelligence/context-os/hindsightEvidence.ts:67` `toRecalledMemoryEvidence`, `:101` `recalledMemoryToEvidenceItems`, `:128` `renderHindsightRecallBlock` | adapter for Hindsight recall | long-term memory | contract-gated | — | pure | Partial | No | **SPLIT**: `toRecalledMemoryEvidence` + `renderHindsightRecallBlock` are **LIVE** (`ipcHandlers.ts:2250-2251`) but produce a **string block**, not EvidenceItems. `recalledMemoryToEvidenceItems` — the typed one — is **TEST-ONLY**. **⚠ invariant 1 violation on a live path** |
| C8 | `electron/intelligence/context-os/SourceAuthorityKernel.ts:192` `class SourceAuthorityKernel`, `buildSourceClarification` | builds the `TurnContextContract` (the `SourceCapability[]` carrier) | all | **This is where scopeId/trustLevel/permissions originate** | — | — | **YES** — emits `ask_clarification` contracts | No | **LIVE** — via `buildTurnContractIfEnabled` (`IntelligenceEngine.ts:1639`, `:2001`, `:4072`; `ipcHandlers.ts`) |
| C9 | `electron/intelligence/context-os/propertyEvidenceValidator.ts:32` `validateEvidenceForProperty`, `itemSupportsProperty`, `buildInsufficientPropertyAnswer` | pure | any pack | — | — | pure | **YES** | No | **SPLIT**: `itemSupportsProperty` **LIVE** (used by C4 and `evidencePackValidation.ts`); `buildInsufficientPropertyAnswer` **LIVE** (`LLMHelper.ts` ×4, `WhatToAnswerLLM.ts` ×2, `ipcHandlers.ts` ×2); `validateEvidenceForProperty` **TEST-ONLY** |
| C10 | `electron/intelligence/context-os/evidencePackValidation.ts:92` `checkImpossibleEvidenceState` | pure | any pack | — | — | pure | **YES — forbidden-direction gate** | No | **LIVE-FLAGGED(DEV-ONLY)** — `ipcHandlers.ts:1281` (shadow), `:1766` (enforce); `contextOsImpossibleStateGateEnforceForbidden` (`intelligenceFlags.ts:554`) |
| C11 | `electron/intelligence/context-os/finalPromptValidation.ts:60` `validateFinalPromptEvidence` | pure — last provider-boundary check | rendered prompt | family-level | — | pure | **YES — last-boundary gate** | No | **LIVE** — `LLMHelper.ts:5323-5328` |
| C12 | `electron/intelligence/context-os/assistantClaims.ts` + `assistantClaimsPrecedenceCheck.ts:` | pure — prior-assistant-answer claim handling | prior assistant responses | — | — | pure | **YES** — `claimContradictedByEvidence`, `claimReusableAsEvidence` | No | **TEST-ONLY** for `checkAssistantClaimsPrecedence` and `claimReusableAsEvidence` (only `__tests__` + `index.ts` + flag comment). `assistantClaimsEnforcement` DEV-ONLY (`intelligenceFlags.ts:550`). **⚠ invariant 5 is implemented but dark** |
| C13 | `electron/intelligence/context-os/generationContext.ts:` `buildDocumentEvidencePackFromBlock`, `renderGoverningFactualBlock` | converts a legacy string block back into an EvidencePack | reference files | contract | — | pure | Partial | No | **LIVE** — `IntelligenceEngine.ts:3989`, `:4144` |
| C14 | `promptRenderer.ts`, `renderedEvidenceManifest.ts`, `requestedProperty.ts` (`PROPERTY_RULES`, `textCanProveProperty`), `requestedPropertyDetector.ts`, `sourceKinds.ts`, `types.ts`, `explicitSourceSwitch.ts`, `recapFollowUp.ts`, `integration.ts`, `trace.ts`, `benchmarkAudit.ts` | pure support layer | — | `types.ts` defines `SourceCapability` incl. `scopeId`, `trustLevel`, `permissions{retrieve,useAsEvidence,useAsReferent}` | — | — | `textCanProveProperty` is **the** invariant-8 primitive | — | **LIVE** |

### 1.5 `electron/intelligence/` — search / fusion / memory

| # | File + main export | Index + storage | Source scopes | Metadata filters | Scores + thresholds | Failure / retry / timeout | **Answerability decision?** | Query rewrite? | Status |
|---|---|---|---|---|---|---|---|---|---|
| I1 | `electron/intelligence/SearchOrchestrator.ts:112` `class SearchOrchestrator` | **pure fusion engine** — candidates injected already-fetched | lexical (meeting titles/summaries/`meetingMemory`), vector, memory (Hindsight), metadata | **Enforces `userId`/`orgId` isolation before ranking** (`:131-135`). In practice `userId:'local'` is hardcoded (`ipcHandlers.ts:7934`) so the invariant holds trivially | `WEIGHTS = {lexical .30, vector .30, memory .20, recency .10, metadata .10}` (`:73`); recency linear decay to 0 at 180 days (`:82`); in-meeting `coverage*0.7 + phraseBonus 0.3` (`:320-322`); hindsight candidates get flat `score: 0.85` (`ipcHandlers.ts:7920`) | never throws — `catch { return [] }` (`:212`, `:326`) | No — ranking only | No | **LIVE-FLAGGED(OFF)** — `globalSearchV2` and `inMeetingSearchV2` both `default: false` (`intelligenceFlags.ts:418-419`). Call sites `ipcHandlers.ts:7934`, `:7959`. **⚠ Its `vector` source is never populated — `ipcHandlers.ts:7862-7893` only builds `source:'lexical'` candidates plus Hindsight `source:'memory'`. The vector arm of this fusion is dead data-flow** |
| I2 | `electron/intelligence/RrfFusion.ts:125` `fuseRanked` | pure RRF | any ranked lists | none | RRF `1/(k+rank)` | never throws | No | No | **LIVE-FLAGGED(OFF)** — only caller is `SearchOrchestrator.ts:235` behind `ragRrfFusion` `default: false` (`intelligenceFlags.ts:439`), which itself sits inside the OFF-by-default `globalSearchV2`. **Effectively double-dark** |
| I3 | `electron/intelligence/ContextFusionEngine.ts:144` `fuseContext`, `:283` `toPromptContextContract` | pure — merges pre-fetched blocks by trust + priority | 13 `FusionSource` kinds incl. `rag_evidence`, `reference_files`, `meeting_memory`, `hindsight_memory`, `browser_dom`, `diagram_spec` (`:106-121`) | trust-level assignment per source (`SOURCE_TRUST`); prompt-injection scan on untrusted sources (`:198`) | token budget passed in (`max(1000, assemblerBudget)`) | pure | No — assembles, does not gate | No | **LIVE** — `electron/llm/WhatToAnswerLLM.ts:10`, `:611`. **⚠ This is a THIRD evidence-container shape (`FusedContextBlock`) alongside `EvidencePack` and `RetrievalEvidencePack`** |
| I4 | `electron/intelligence/ProfileTreeService.ts` `getCandidatePerspectiveGuard` | pure | profile identity | — | — | pure | No — perspective guard only | No | **LIVE** — `ipcHandlers.ts:3178`, `PromptAssemblerV2.ts:174`. (`profileTreeV2` flag `default:false` gates the *routing*, `intelligenceFlags.ts:395`, but the guard call at `ipcHandlers.ts:3178` is unconditional) |
| I5 | `electron/intelligence/memory/LongTermMemoryService.ts:26` `recallRelevantMemory:86` | HTTP to a Hindsight server via `HindsightClientAdapter` | long-term memory across meetings/sessions | `MemoryScope` tags (`userId`, `meetingId`, `sessionId`, `lectureId`, `courseId`) built by `HindsightTagBuilder` | `maxResults` default 8 | `timeoutMs` default **800 ms** (`:92`); 2000 ms for global search (`ipcHandlers.ts:7912`, `:2235`); `[]` on disabled/error/timeout | No — returns `[]` | No | **LIVE-FLAGGED(OFF)** — `hindsightMemory` `default:false` (`intelligenceFlags.ts:423`). Call sites `ipcHandlers.ts:2235` (live recall), `:7912` (global search), `MeetingPersistence.ts:608` (retain) |
| I6 | `electron/intelligence/memory/HindsightClientAdapter.ts`, `HindsightRetainQueue.ts`, `HindsightTagBuilder.ts`, `MemoryProvider.ts` | transport + queue | — | tag construction is where scope actually lands | — | queue-based retain | No | No | **LIVE-FLAGGED(OFF)** |
| I7 | `electron/services/HindsightManager.ts:` `HindsightManager.getInstance()` | spawns/manages the Hindsight sidecar; `getHindsightConfig()`, `isAvailable()`, `localUserId()` | — | supplies `userId` used as the isolation key at `ipcHandlers.ts:7915` | — | cached health check short-circuits the 2 s recall timeout (`ipcHandlers.ts:7909`) | No | No | **LIVE** — `main.ts:1722` starts it |
| I8 | `electron/intelligence/ConversationMemoryService.ts` | in-memory per-session turn store | conversation history | keyed by `sessionId` | — | — | No | No | **LIVE-FLAGGED(OFF)** — `conversationMemoryV2` `default:false` (`intelligenceFlags.ts:420`); instantiated `ipcHandlers.ts:828` |
| I9 | `electron/intelligence/MeetingMemoryService.ts:` `buildMeetingRecord` | structured meeting-memory extraction (topics/entities/decisions/questions) | meeting transcript | per-meeting | — | — | No | No | **LIVE-FLAGGED(OFF)** — `meetingMemoryV2` `default:false` (`:400`); `MeetingPersistence.ts:525`. **Its output is the lexical haystack for I1** (`ipcHandlers.ts:7869-7876`) |
| I10 | `electron/intelligence/ContextRouter.ts` `routeContext`, `isBackwardLookingQuery` | pure routing decision | all | — | — | pure | Sets `useHindsightRecall` — gates whether I5 runs at all | No | **LIVE** — `ipcHandlers.ts:39` (the `contextRouterV2` flag `default:false` gates the *consolidated* path, `:396`) |
| I11 | `electron/intelligence/LiveTranscriptBrain.ts`, `LiveMomentRouter.ts`, `CodingConversationState.ts`, `LectureIntelligenceService.ts`, `DiagramIntelligenceService.ts` | transcript-derived state | live transcript | session | — | — | No (LectureIntelligence gated by `lectureIntelligenceV2` `default:false`) | No | mixed **LIVE** / **LIVE-FLAGGED(OFF)** |

### 1.6 `electron/services/meeting/` + `electron/services/context/`

| # | File + main export | Index + storage | Source scopes | Metadata filters | Scores + thresholds | Failure / retry | **Answerability decision?** | Query rewrite? | Status |
|---|---|---|---|---|---|---|---|---|---|
| S1 | `electron/services/meeting/CrossMeetingRecall.ts:27` `class CrossMeetingRecall` | in-memory diff over `getRecentMeetings()` summaries | past meeting summaries | recent-N window | — | non-fatal catch (`MeetingPersistence.ts:389`) | No | No | **LIVE** — `MeetingPersistence.ts:383` |
| S2 | `electron/services/meeting/MeetingContextAssembler.ts:42` | assembles V3 summary context | meeting transcript + summaries | per-meeting | — | non-fatal catch (`:146`, `:160`, `:181`) | No | No | **LIVE** — `MeetingPersistence.ts:307`, `:807` |
| S3 | `electron/services/meeting/TranscriptChunker.ts`, `ChunkSummaryGenerator.ts`, `MeetingSummaryReducer.ts`, `MeetingSummaryV3.ts`, `SectionPromptCompiler.ts`, `MeetingRecipes.ts`, `SpeakerLabelService.ts`, `TranscriptNormalizer.ts`, `SummaryPolisher.ts`, `FollowUpDraftGenerator.ts`, `MeetingModeDetector.ts`, `MeetingSummarySchemaValidator.ts`, `MeetingSummaryStrategySelector.ts`, `generateStructured.ts` | summarization pipeline (**a second, independent chunker** to `rag/SemanticChunker.ts`) | meeting transcript | per-meeting | — | — | No | No | **LIVE** (`meetingSummaryV3` `default:true`, `intelligenceFlags.ts:405`) |
| S4 | `electron/services/context/PromptAssembler.ts` (852 lines), `ContextPacket.ts`, `TrustLevels.ts` | prompt assembly + trust taxonomy | all | `TrustLevels.ts` is the `TrustLevel` enum consumed by I3 | — | — | No | No | **LIVE** — `TrustLevel` imported by `ContextFusionEngine.ts`. **⚠ A FOURTH context container (`ContextPacket`)** |

### 1.7 `electron/llm/` — transcript / session recall (retrieval over conversation, not documents)

| # | File + main export | Index + storage | Source scopes | Metadata filters | Scores + thresholds | Failure / retry | **Answerability decision?** | Query rewrite? | Status |
|---|---|---|---|---|---|---|---|---|---|
| L1 | `electron/llm/longRangeTranscriptRecall.ts:133` `recallLongRangeContext` | **in-memory keyword retrieval over the durable transcript window** (`SessionTracker.getDurableContext()`) | live transcript (interviewer + user turns) | `timestamp < recentWindowCutoffMs`; **`t.role !== 'assistant'` (`:147`) — prior assistant turns are structurally excluded from recall**; comp-value gate `COMP_VALUE_RE` unless negotiation mode (`:153`) | `MIN_MATCH_SCORE` keyword-overlap floor; `MAX_MATCHED_TURNS`; `MAX_BLOCK_CHARS` truncation | pure; returns `{block:'', matchCount:0}` on no match | No — emits an `<earlier_context>` block or nothing | Keyword extraction from the question | **LIVE** — `IntelligenceEngine.ts:1319/1337` |
| L2 | `electron/llm/TemporalContextBuilder.ts:162` `buildTemporalContext`, `:182` `formatTemporalContextForPrompt` | in-memory 180 s window over `ContextItem[]` + `AssistantResponse[]` | live transcript **and prior assistant responses** | `windowSeconds = 180` default | tone-signal `confidence` sort | pure | No | No | **LIVE** — `WhatToAnswerLLM.ts`. **Supports invariant 5**: prior responses are rendered only as `<previous_responses_to_avoid_repeating>` (`:184-188`), never as evidence |
| L3 | `electron/llm/conversationHistoryPolicy.ts:36` `resolveHistoryGrant`, `:55` `stripPriorAssistantTurns`, `:75` `applyHistoryGrant` | pure filter over the rolling snapshot string | prior assistant turns | `isLayerAllowed(plan,'prior_assistant_responses')` → **fail-closed** (`contextRoute.ts:132`) | n/a | pure | **YES — the intended invariant-5 gate** | No | **TEST-ONLY.** Verified via `-ra`: only consumer is `promptComposer.ts:40/172`, and `composePrompt` itself has no non-test caller (`grep -ral composePrompt` → `promptComposer.ts`, its test, and a flag comment). `promptComposerV2` is DEV-ONLY (`intelligenceFlags.ts:547`) |
| L4 | `electron/ipcHandlers.ts:153` `stripPriorAssistantTurns` (local duplicate of L3) | pure filter | prior assistant turns | fires only when `documentGroundedCustomModeActive && isDocGroundedAnswerType` (`:2096-2098`) or `phoneDocGrounded` (`:11004`) | n/a | pure | Partial | No | **LIVE** — this is the only prior-assistant strip that runs in production, and it is narrower than L3 |
| L5 | `electron/llm/SessionMemory.ts`, `liveSessionMemory.ts`, `sessionFollowupResolver.ts`, `FollowUpResolver.ts`, `transcriptEntityExtractor.ts` | in-memory per-session stores + recency/keyword recall | live transcript, conversation | per-session; SessionMemory applies its own comp gate (mirrored by L1's comment at `:124-130`) | recency tie-breaks | pure | No | Follow-up referent resolution feeds `followUpReferentHint` into C1 (`EvidenceResolver.ts:108`) | **LIVE** (`IntelligenceEngine.ts`); `liveSessionMemory` config-gated via `liveSessionMemoryConfig.ts` |
| L6 | `electron/llm/contextRoute.ts:110` `isLayerAllowed`, `buildContextRoute` | pure layer-permission predicate | all 15 context layers | `plan.requiredContextLayers` / `forbiddenContextLayers`; **fail-open by default except `prior_assistant_responses`** (`:132`) | per-layer char budgets (`:60`, `prior_assistant_responses: 600`) | pure | **YES — the per-layer admission gate** | No | **LIVE** — `WhatToAnswerLLM.ts:289/443/455` |

### 1.8 `premium/electron/knowledge/` — profile RAG (git submodule, reachable from `electron/`)

Out of the literal `electron/` tree but **on the live answer path** via
`appState.getKnowledgeOrchestrator()` (`ipcHandlers.ts:11484`) and `llmHelper.getKnowledgeOrchestrator()`
(`ipcHandlers.ts:2374`). Included because omitting it would misrepresent the profile retrieval story.

| # | File + main export | Index + storage | Source scopes | Metadata filters | Scores + thresholds | **Answerability decision?** | Query rewrite? | Status |
|---|---|---|---|---|---|---|---|---|
| P1 | `premium/electron/knowledge/HybridSearchEngine.ts:196` `getRelevantNodes`, `:98` `detectCategoryHints`, `:247` `formatContextBlock` | JS cosine over `context_nodes` rows in the premium knowledge DB | resume, JD, profile artifacts | `embedding_space` per node (surfaced at `ipcHandlers.ts:11524`) | **`RELEVANCE_THRESHOLD = 0.55`** (`:3`); cosine weighted `×0.6` (`:121`); boosts `+0.1`…`+0.35` (`:126-175`) | **YES — hard drop below 0.55**, logged "no injection" (`:237`). `KnowledgeOrchestrator.ts:1138` documents deliberate **bypasses** of this gate for certain routes | Category hints (`detectCategoryHints`) | **LIVE** — `KnowledgeOrchestrator.ts:1263` |
| P2 | `premium/electron/knowledge/ProfileContextBuilder.ts` `buildGroundingBlock` | deterministic full-profile injection (no retrieval) | resume, JD | none | none | Bypasses P1's threshold entirely | No | **LIVE** — `KnowledgeOrchestrator.ts:4` |
| P3 | `premium/electron/knowledge/ContextAssembler.ts`, `DocumentChunker.ts`, `KnowledgeDatabaseManager.ts`, `IntentClassifier.ts`, `StructuredExtractor.ts`, `HeuristicExtractor.ts`, `AOTPipeline.ts` | ingest + assembly (**a third independent chunker**) | resume, JD | — | — | No | No | **LIVE** |

---

## 2. DUPLICATE RESPONSIBILITY MATRIX

`✓` = implements it. `(f)` = flag-gated. `(t)` = test-only/dark. Rows with more than one `✓` are the
duplication hotspots.

| Responsibility | rag/RAGRetriever | rag/VectorStore | modes/ModeHybridRetriever | ModeContextRetriever | knowledge/OkfRetriever | knowledge/OkfProfileRetriever | knowledge/GraphRetriever | context-os/EvidenceResolver | context-os/ProfileEvidenceService | context-os/EvidenceOrchestrator | context-os/meetingRagEvidence | intelligence/SearchOrchestrator | intelligence/RrfFusion | intelligence/ContextFusionEngine | knowledge/EvidenceAssembler | context-os/evidenceSufficiency | premium/HybridSearchEngine | rag/LocalReranker | **count** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Semantic (vector) search** | ✓ | ✓ | ✓ | | | | | ✓ (via M1) | | | | ✓ (arm never fed) | | | | | ✓ | | **6** |
| **Keyword / lexical search** | | | ✓ | ✓ | ✓ | ✓ (via K1) | | ✓ (via K1/M1) | | | | ✓ (f) | | | | | ✓ (title/category) | | **7** |
| **Graph expansion** | | | | | | | ✓ (f,off) | | | | | | | | | | | | **1** |
| **Fusion / score combination** | ✓ (relevance+recency) | | ✓ (α·fts+(1−α)·vec) | ✓ (weighted boosts) | ✓ (5-term weighted) | ✓ (lexical+intent boost) | | | | | | ✓ (5-weight sum) | ✓ (RRF, f,off) | ✓ (trust+priority) | | | ✓ (cosine+boosts) | | **8** |
| **Reranking** | ✓ (recency rerank) | | ✓ (cross-encoder, f) | | | ✓ (band trim) | | | | | | ✓ (RRF rerank, f) | ✓ | | | ✓ (smallest-sufficient) | | ✓ | **7** |
| **Chunking** | | | ✓ (`chunkText`) | ✓ (`chunkText`) | | | | | | | | | | | | | | | plus `rag/SemanticChunker`, `meeting/TranscriptChunker`, `premium/DocumentChunker`, `modes/DocumentMap` → **7 chunkers** |
| **Evidence selection (which items ship)** | ✓ (token budget) | | ✓ (budget+dedup) | ✓ (section cap + top-K) | ✓ (topN) | ✓ (band+topN) | | ✓ (`selectSmallestSufficientEvidence`) | ✓ | ✓ (t) | ✓ (t) | | | ✓ (token budget) | ✓ (tiering) | ✓ | ✓ (threshold) | | **11** |
| **ANSWERABILITY DECISION** | ✓ (empty→R1 throws) | | ✗ (observe-only confidence) | ✗ | ✗ | ✓ (soft `no_match`) | ✗ | ✓✓ (5 hard stops + policy) | ✓ (3-way policy) | ✓ (t) | ✓ (t) | ✗ | ✗ | ✗ | ✓ (4-tier) | ✓✓ (canonical) | ✓ (0.55 hard drop) | ✗ | **8** |
| **Capability / `SourceCapability[]` enforcement** | ✗ | ✗ | ✗ | ✗ | ✗ | partial (4 boolean gates) | ✗ | ✓ | ✓ | ✓ (t) | ✓ (t) | user/org only | ✗ | trust-level only | ✗ | ✗ | ✗ | ✗ | **5** |
| **Produces typed `EvidenceItem`** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (raw string) | ✗ (raw string) | ✓ | ✓ | ✓ (t) | ✓ (t) | ✗ | ✗ | ✗ (`FusedContextBlock`) | ✗ (`RetrievalEvidencePack`) | n/a | ✗ (raw string) | ✗ | **4 (2 dark)** |
| **Property-aware match in score/metadata** | ✗ | ✗ | ✗ (answerability score ≠ property) | ✗ | ✗ | ✗ | ✗ | ✓ `propertyMatch` | ✓ | ✓ (t) | ✓ (t) | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | **5** |

### 2.1 Duplicate groups (grouped by what they compete over)

**Group A — document/reference-file retrieval (3 overlapping implementations):**
`ModeHybridRetriever` (M1), `ModeContextRetriever` (M2), `OkfRetriever` (K1). All three can answer
the same "what does my uploaded document say" question with different scores, different chunk
boundaries, and different thresholds (0.15 / 0.18 / 0.12). `EvidenceResolver` (C1) arbitrates K1 →
M1, but M2 is reachable independently at `LLMHelper.ts:4927`.

**Group B — profile retrieval (4 overlapping implementations):**
`manualProfileIntelligence.selectManualProfileEvidence` (deterministic fast path, wrapped by C2),
`OkfProfileRetriever` (K2), premium `HybridSearchEngine.getRelevantNodes` (P1), premium
`ProfileContextBuilder.buildGroundingBlock` (P2). `ipcHandlers.ts:2506-2530` explicitly documents
the mutual-exclusion dance between three of them.

**Group C — meeting/transcript retrieval (2 implementations, non-overlapping interfaces):**
`RAGManager`/`RAGRetriever` (R1/R2, live, string-based) vs `meetingRagEvidence` (C6, typed, dark).
**This is the invariant-6 gap.**

**Group D — evidence container types (4 competing shapes):**
`context-os/evidencePack.ts::EvidencePack` (typed, the target), `knowledge/RetrievalEvidencePack.ts`
(OKF tiers), `intelligence/ContextFusionEngine.ts::FusedContextBlock` (trust levels),
`services/context/ContextPacket.ts`. Plus raw XML/markdown strings from M1/M2/K2/K3/C7.

**Group E — fusion/ranking (3 implementations):**
`SearchOrchestrator` weighted sum (I1), `RrfFusion` rank fusion (I2), `ContextFusionEngine`
trust-priority ordering (I3). I1 and I2 are both dark by default.

**Group F — chunkers (6 confirmed + 1 unread):** `rag/SemanticChunker.chunkTranscript` (read),
`ModeHybridRetriever.chunkText:558` (read), `ModeContextRetriever.chunkText` (read),
`modes/DocumentMap` — `sectionAwareChunksFromMap` / `sentenceAwareWindows` / `tabularChunks`,
consumed at `ModeHybridRetriever.ts:573`/`:615` (call sites read; module body not read),
`meeting/TranscriptChunker` (**not read** — reachability confirmed via `-ra`: non-test consumers are
`meeting/MeetingContextAssembler.ts` and `meeting/index.ts`), `premium/DocumentChunker` (**not
read**). `knowledge/OkfExtractor` section-splitting is asserted from `OkfRetriever.ts:6-9`'s
description of pack ordering, **not from reading `OkfExtractor.ts`** — treat as UNDETERMINED.
Two of these (`ModeHybridRetriever.wordsOf` at `:158` and `ModeContextRetriever.wordsOf`) carry an
explicit comment that they must be kept "in lock-step" — a manual invariant with no test binding.

---

## 3. Findings ranked by severity

### F1 (critical, invariant 6) — Meeting RAG has a typed adapter that nothing calls
`electron/intelligence/context-os/meetingRagEvidence.ts` implements exactly the required
EvidencePack bridge, including cross-meeting isolation and a `MEETING_RAG_MIN_SIMILARITY = 0.3`
gate. Verified callers: `electron/intelligence/context-os/index.ts` (re-export) and
`electron/intelligence/__tests__/ContextOsMeetingRagEvidence.test.mjs` only. The live path
(`ipcHandlers.ts:9013`/`9080`/`9148` → `RAGManager.queryMeeting`/`queryGlobal` →
`prompts.buildRAGPrompt` → `LLMHelper.streamChatWithGemini`) never constructs a contract, never
constructs a pack, and never checks a capability. It is additionally excluded by name from the
coordinator: `KNOWN_COORDINATOR_KINDS` at `ipcHandlers.ts:2357` omits `meeting_rag`.

### F2 (critical, invariant 4) — "No relevant context" degrades to answering without evidence
`RAGManager.ts:244` throws `NO_RELEVANT_CONTEXT_FOUND` when retrieval returns zero chunks. Both IPC
handlers catch it and return `{ fallback: true }` (`ipcHandlers.ts:9065-9070`, `:9132-9136`), which
the handler's own comments describe as "falling back to regular chat" / "use the context window"
(`:9019`, `:9065`, `:9092`, `:9135`). So the retrieval layer's "I found nothing" is converted into a
signal to answer from unretrieved context. **Scope caveat:** the renderer's handling of
`{fallback:true}` was NOT read (no `src/` tracing was done); the finding rests on the main-process
handler code and its comments alone. Same shape, fully in-process, at `ipcHandlers.ts:2494-2499`: a
`TurnEvidenceCoordinator` budget timeout (1000 ms non-doc-grounded, `:2450`) throws and silently
falls through to the legacy raw-text profile injection at `:2516`.

### F3 (high, invariants 3+4) — Capability enforcement is DEV-ONLY in production
`contextOsEnforceSourceCapabilities` (`intelligenceFlags.ts:535`),
`contextOsPropertyValidation` (`:536`), `contextOsMultiFamilyEvidenceEnabled` (`:537`),
`assistantClaimsEnforcement` (`:550`), `contextOsImpossibleStateGateEnforceForbidden` (`:554`),
`okfKnowledgePacks`/`okfHybridRetrieval`/`okfProfilePacks`/`okfProfileHybridRetrieval`
(`:450,452,461,462`), `ragConfidenceGate` (`:433`), `ragLocalRerank` (`:437`) all resolve via
`isInternalDevTestContext` (`:374`). In a packaged production build these are **off**, so the
governed path (C1/C3) is not the path a shipped user hits — the legacy raw-string paths are.
`contextOsEvidencePackEnabled` (`:520`) is `default: true`, but the multi-family coordinator that
consumes it for profile/JD turns is not.

### F4 (high, invariant 2) — `EvidenceItem` has no `scopeId`
`electron/intelligence/context-os/evidencePack.ts:35-57` defines `sourceKind`, `sourceId`,
`sourceOwner`, `authority`, `trustLevel`, `pointer`, `supports`, `score` — but **no `scopeId`**.
Scope is squeezed into `sourceId` with a fallback chain: `cap?.scopeId ?? contract.activeModeId ??
'active-mode'` (`EvidenceOrchestrator.ts:211`, `:260`) and `sourceRef || 'active-profile'`
(`ProfileEvidenceService.ts:139`). When the capability lacks a `scopeId`, the item's provenance
degrades to a literal placeholder string and cross-scope contamination becomes undetectable
downstream.

### F5 (high, invariant 1) — Live evidence paths emit strings, not items
Three live paths inject raw prompt text:
- `electron/services/knowledge/OkfProfileRetriever.ts:234` returns `block: string`, consumed by
  string concatenation at `ipcHandlers.ts:2526` (`context = \`${profileEvidence.block}\n\n${context}\``).
- `electron/intelligence/context-os/hindsightEvidence.ts:128 renderHindsightRecallBlock` at
  `ipcHandlers.ts:2251` — while the typed `recalledMemoryToEvidenceItems` (`:101`) is test-only.
- `ModeHybridRetriever`/`ModeContextRetriever` `formattedContext` XML at `LLMHelper.ts:4927`.
`EvidenceOrchestrator.parseModeSnippets` (`:91`) exists precisely to re-parse that XML back into
items — a round-trip through a string that loses `scopeId` and `trustLevel` in the middle.

### F5b (medium) — `KNOWN_COORDINATOR_KINDS` is duplicated, not shared
`ipcHandlers.ts:1835` declares `KNOWN_COORDINATOR_KINDS_EARLY` and `:2352` declares
`KNOWN_COORDINATOR_KINDS` — two independent `new Set([...])` literals with identical contents and a
comment at `:1830` asserting they mirror each other. Adding `meeting_rag` (see §5 item 1) requires
editing both, and nothing enforces that.

### F10 (high, invariant 5) — the intended prior-assistant gate is dark; a narrower duplicate ships
`electron/llm/conversationHistoryPolicy.ts` is the module written to enforce invariant 5, backed by
the deliberate fail-closed flip at `electron/llm/contextRoute.ts:132`. Its only consumer is
`promptComposer.composePrompt` (`promptComposer.ts:172`), and `composePrompt` has **no non-test
caller** (verified with `-ra` across `electron premium src scripts`). What actually runs in
production is a *separate, duplicated* `stripPriorAssistantTurns` declared locally at
`electron/ipcHandlers.ts:153`, invoked at `:2098` only when
`manualActiveMode?.documentGroundedCustomModeActive && isDocGroundedAnswerType(...)` (`:2096`) and at
`:11004` for `phoneDocGrounded`. **On an ordinary non-doc-grounded manual chat turn, prior assistant
turns enter the prompt inside the rolling transcript snapshot with no grant check.** The
`assistantClaims` verification layer that would classify them as referent-vs-evidence is also
TEST-ONLY (C12).

Mitigating evidence — invariant 5 *does* hold on three specific paths, all verified:
`EvidenceResolver.ts:106-108` (prior assistant text expands the retrieval query only, never reaches
the model), `EvidenceOrchestrator.ts:169-175` (referent-only demotion), and
`TemporalContextBuilder.ts:182-190` (prior responses rendered only as
`<previous_responses_to_avoid_repeating>`). `longRangeTranscriptRecall.ts:147` excludes
`role === 'assistant'` from recall outright.

### F6 (medium, invariant 8) — Four independent similarity-only cutoffs gate answers
`VectorStore` `minSimilarity 0.25` (`:179`), `ModeHybridRetriever` `MIN_COMBINED_SCORE 0.15`
(`:96`), `ModeContextRetriever` `MIN_RELEVANCE_SCORE 0.18` (`:120`), `OkfRetriever` `minScore 0.12`
(`:137`), premium `RELEVANCE_THRESHOLD 0.55` (`:3`). None consults property or entity. Only
`evidenceSufficiency.ts` (`MIN_ANSWER_CONFIDENCE = 0.32`, `:30`) requires `propertySatisfied` first
(`:69-77`) — and it is only reachable through `EvidenceResolver`.

### F7 (medium) — Unscoped-query surfaces
- `VectorStore.searchSimilar` (`:170-200`): `meetingId` optional. `RAGRetriever.retrieveGlobal`
  (`:183-187`) deliberately omits it, so `rag:query-global` (`ipcHandlers.ts:9148`) searches every
  meeting in the active embedding space. Intentional for global search, but there is **no
  contract/capability check on that IPC handler at all**.
- `mode_reference_chunks` (`ModeHybridRetriever.ts:252-266`) has **no `mode_id` column**. Isolation
  depends entirely on the `files[]` array the caller passes; there is no DB-level guard.
- No table in the retrieval stack has a `user_id` column. Single-user desktop DB, so this is
  currently sound — but `SearchOrchestrator`'s user/org isolation logic (`:131-135`) is therefore
  exercised only with the hardcoded `userId:'local'` (`ipcHandlers.ts:7934`, `:7915`).
- `OkfRetriever.queryOkfCards` has no scope predicate of its own; scope is whichever `pack` object
  the caller supplies.

### F8 (medium) — `ModeHybridRetriever` is not FTS/BM25 despite its own documentation
File header line 2 says "combining FTS/BM25 + vector semantic search"; `computeFtsScore` (`:626`)
is `matches / sqrt(|queryWords| · |uniqueChunkWords|)` — unique-term overlap with a length
normalizer, no term frequency, no document frequency, no k1/b. **There is no SQLite FTS5 virtual
table anywhere under `electron/`** (verified: no `fts5`/`USING fts` match). Any planning that
assumes a BM25 arm exists is planning against a comment.

### F9 (low) — `SearchOrchestrator`'s vector arm is never populated
`ipcHandlers.ts:7862-7893` builds only `source:'lexical'` candidates; the Hindsight block adds
`source:'memory'`. No caller ever emits `source:'vector'` or `source:'metadata'`. So `WEIGHTS.vector
= 0.30` (`SearchOrchestrator.ts:73`) contributes zero on every real query, and the RRF path's
`vector` ranked source is always absent.

---

## 4. UNDETERMINED items

- **`electron/services/context/PromptAssembler.ts` (852 lines) reachability.** `TrustLevels.ts` is
  confirmed live via `ContextFusionEngine.ts`. I did not trace every export of `PromptAssembler.ts`
  itself; a basename grep shows it is a distinct module from `intelligence/PromptAssemblerV2.ts`
  (which is gated by `promptAssemblerV2` `default:false`, `intelligenceFlags.ts:398`). **Checked:**
  basename grep for `PromptAssembler` returns both files; I did not disambiguate every hit.
- **Whether `okfProfilePacks`/`okfHybridRetrieval`/`contextOsMultiFamilyEvidenceEnabled` are turned
  on in any shipped build by `SettingsManager`.** The flag resolution order is env → settings →
  default (`intelligenceFlags.ts` `resolveFlagDefault`); I read the defaults and the
  `isInternalDevTestContext` body but did not enumerate what the packaged settings file ships with,
  nor whether onboarding writes any of these keys. **Checked:** `intelligenceFlags.ts:365-382`,
  `:851-853`. This is the single assumption F3 rests on.
- **`electron/services/meeting/TranscriptChunker.ts`, `premium/electron/knowledge/DocumentChunker.ts`,
  `electron/services/knowledge/OkfExtractor.ts` internals.** Counted in Group F on the strength of
  reachability greps and neighbouring documentation; bodies not read.
- **Premium submodule internals beyond `HybridSearchEngine`/`ProfileContextBuilder`.** `premium` is
  a git submodule (`.gitmodules:1-3`) and is marked `m` (dirty) in `git status`. I inspected
  thresholds and call sites but did not audit `KnowledgeOrchestrator.ts`'s ~2000 lines of routing.

---

## 5. What to change first (ordered, for the architecture report)

1. **Make `meetingChunksToEvidenceItems` live.** It already exists and is tested. Wire
   `RAGManager.queryMeeting`/`queryGlobal` to return `ScoredChunk[]` to a caller that builds a
   contract and a pack, instead of returning a formatted string. Add `meeting_rag` to **both**
   `KNOWN_COORDINATOR_KINDS` (`ipcHandlers.ts:2352`) and `KNOWN_COORDINATOR_KINDS_EARLY` (`:1835`).
   This closes invariant 6 with existing, already-tested code.
2. **Add `scopeId` as a required field on `EvidenceItem`** (`evidencePack.ts:35`) and stop
   collapsing it into `sourceId`. Every construction site already has `cap` in hand.
3. **Make the fallback-to-plain-chat paths explicit refusals or explicitly-unevidenced answers.**
   `{ fallback: true }` at `ipcHandlers.ts:9065`/`9132` and the coordinator timeout fall-through at
   `:2494` are the two places invariant 4 is silently traded away.
4. **Promote `EvidenceOrchestrator`** (C5) from test-only to the single adapter all five legacy
   string retrievers pass through — it is the only module that already implements
   "retriever is not called when capability is absent" (`:149-155`).
5. **Collapse Group D (4 evidence containers) onto `EvidencePack`,** with
   `RetrievalEvidencePack`'s tiering expressed as `answerPolicy` + `sufficiency.reason`.
6. **Give the non-Context-OS retrievers a `SourceCapability[]` parameter** — starting with
   `ModeHybridRetriever.retrieve` (`:910`) and `VectorStore.searchSimilar` (`:170`), which are the
   two that every other path bottoms out in.
7. **Wire `conversationHistoryPolicy.resolveHistoryGrant`/`applyHistoryGrant` into the live manual
   chat path** and delete the duplicate `stripPriorAssistantTurns` at `ipcHandlers.ts:153`. The
   fail-closed rule at `contextRoute.ts:132` is already written and already correct; only the
   consumer is missing (F10). This closes invariant 5 without new logic.

---

## 6. Verification log (for reproducibility)

| Claim | How verified |
|---|---|
| No SQLite FTS5 anywhere under `electron/` | `grep -rniE 'fts5\|USING fts\|VIRTUAL TABLE' electron/` → only `vec0` virtual tables (`DatabaseManager.ts:2114`, `:2120`) |
| C5/C6/C9/C12 + `recalledMemoryToEvidenceItems` are TEST-ONLY | `/usr/bin/grep -ral <symbol> electron premium src scripts` → hits only in `__tests__`, the defining file, `context-os/index.ts`, and (for `EvidenceOrchestrator`) two *comment* references in `ProfileEvidenceService.ts` and `TurnEvidenceCoordinator.ts:212` |
| `composePrompt` has no non-test caller | `/usr/bin/grep -ral composePrompt electron premium src` → `promptComposer.ts`, `__tests__/PromptComposer2026_07_25.test.mjs`, `intelligenceFlags.ts` (comment) |
| DEV-ONLY == OFF in production | read `intelligenceFlags.ts:374-382` |
| `SearchOrchestrator`'s vector arm is never fed | `grep -rn "source: 'vector'" electron/` → no matches |
| Binary-misdetected source files | `find … -print0 \| xargs -0 -I{} sh -c '/usr/bin/grep -Iq "" "{}" \|\| echo "{}"'` → 4 files (listed in the header note) |
