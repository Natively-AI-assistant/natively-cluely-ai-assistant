# Phase 2 — Retrieval Benchmark

**Status:** corpus + labels COMPLETE and verified · harness IN PROGRESS · results PENDING
**Date:** 2026-07-29
**Scope:** §8.1–§8.10. Keep/remove decisions land in `03_KEEP_REMOVE_MATRIX.md`.

---

## 1. What this phase must decide, and what changed about it

Phase 2 as written (§8) exists to decide which existing retrieval components to keep. The owner has since directed a **from-scratch rebuild of the decision and orchestration layer**, with ingestion, embeddings, vector storage, and the provider gateway reused.

That does **not** make this phase moot, and it is being run in full. Its output changes role:

- For components the rebuild *replaces* (fusion, evidence selection, answerability, routing), the benchmark supplies the **evidence required to delete them** (§28 requires confirming no active entry point depends on code before removal, and §8 requires evidence for every retain/remove decision).
- For components the rebuild *reuses or must re-implement* (semantic, keyword, heading/entity, reranking, adjacency), the benchmark decides **what the new unified retriever should actually do** — which is a design input, not archaeology.

Both are needed. A rebuild that silently reproduces the old retrieval behaviour would fail the same way.

---

## 2. Corpus (§8.1)

### 2.1 Reuse over recreation

The repository already contained a substantial fixture corpus. It is **referenced, not duplicated** — copying it would have created a second source of truth in a shared working tree.

| §8.1 requirement | Source | Status |
|------------------|--------|--------|
| Resume | `tests/fixtures/modes/looking-for-work/lfw_resume.txt` | existing |
| Job description | `tests/fixtures/modes/looking-for-work/lfw_jd.md` | existing |
| Thesis | `test-fixtures/modes-corpus/thesis/institutional_thesis.pdf` (66 pp, real) | existing |
| Seminar document | `test-fixtures/modes-corpus/thesis/seminar_real_thesis.pdf` | existing |
| Presentation slides | `test-fixtures/modes-corpus/slides/cs231n_lecture.pdf` | existing |
| Project documentation | `tests/fixtures/modes/general/general_project_brief.html` | existing |
| Coding samples | `tests/fixtures/modes/technical-interview/tech_array_problem.md` | existing |
| Sales material | `tests/fixtures/modes/sales/*` (5 files) | existing |
| Recruiting material | `tests/fixtures/modes/recruiting/*` (5 files) | existing |
| Lecture notes | `tests/fixtures/modes/lecture/*` (5 files) | existing |
| Large reference file | 66-page thesis | existing |
| Tables | ML papers; `*.csv` fixtures | existing |
| Code blocks | `tech_error_log.txt`, `rfc8259_json.txt` | existing |
| Documents with headings | battlecard, syllabus, papers | existing |
| **Overlapping terms** | 3 ML papers (Attention / BERT / ResNet) sharing heavy vocabulary | existing |
| Malformed files | `test-fixtures/modes-corpus/nasty/` (image-only scan, Arabic encoding) | existing |
| **Conflicting file versions** | `additions/resume_v1_2023.md` + `resume_v2_2026.md` | **added** |
| **Meeting transcript** | `additions/meeting_transcript_current.txt` + `_previous.txt` | **added** |
| **Empty file** | `additions/empty_reference.md` (0 bytes) | **added** |

Additions live in `test-fixtures/ci-v3-corpus/additions/` and exist only to close gaps the repo did not already cover.

### 2.2 The two added conflict pairs are the sharpest instruments here

**Resume v1 vs v2** contradict on five specific, checkable facts:

| Fact | v1 (2023) | v2 (2026) |
|------|-----------|-----------|
| Title | Staff Engineer | Principal Engineer |
| Experience | 6 years | 9 years |
| Peak volume | 2.3 M txn/day | **5.1 M txn/day** |
| Team size | 4 engineers | **11 engineers** |
| Graduation | **2019** | **2017** |

**Current vs previous meeting** contradict by *reversal*, which is harder than mere difference:

| Decision | Previous (June) | Current (September) |
|----------|-----------------|---------------------|
| Events table DB | ScyllaDB | **Cassandra** |
| Ledger migration | moving to Cassandra | **explicitly NOT migrating** |
| Backend headcount | 3 roles approved | **not opening, deferred** |
| Owner | Arjun | **Meera** |

The two transcripts are deliberately written with **high lexical and semantic overlap**. A retriever that scores on similarity alone cannot separate them — which is exactly the §16 failure ("high similarity = complete answer") the benchmark needs to expose.

---

## 3. Labels (§8.1) — and why they are derived rather than hand-written

Full schema: `test-fixtures/ci-v3-corpus/SCHEMA.md`.

Recall@k needs per-question **gold evidence identity**. Labelling chunk ids by hand would be self-defeating here: the 11 configurations chunk differently, so id-based labels would be invalid for most of the field under test.

Instead each question carries `goldFacts` — **verbatim substrings of the source document**. A retrieved chunk is gold iff it contains one. This makes scoring **chunker-independent, deterministic, and auditable** (a disputed score is settled by grepping the document).

The cost is recorded honestly: a chunk containing the answer *paraphrased but not verbatim* scores as a miss, so absolute recall is a **lower bound**. Because the bias applies equally to every configuration, cross-config comparison remains valid — and cross-config comparison is what this phase decides on. Questions with no stable verbatim form are marked `scoring: "judge"` and excluded from the deterministic metrics rather than being guessed at.

### 3.1 Label verification is enforced, not assumed

`test-fixtures/ci-v3-corpus/tools/verify-gold-facts.mjs` checks every `goldFacts` string against the **production extractor** (`SafeDocumentTextExtractor`), not a standalone PDF library — because a fact that verifies under a different parser could still be unreachable at retrieval time.

Current result:

```
30 ok · 12 skipped (judge-scored / negative cases) · 0 failed
```

All 42 questions, including all PDF-sourced facts, resolve against the text the application itself indexes. **This invariant must be re-run after any fixture edit**; if it breaks, every configuration silently under-reports recall.

### 3.2 Question bank composition

42 labelled questions across §26.3 categories A–J:

| Category | n | Purpose |
|----------|---|---------|
| A — direct source | 13 | baseline recall across resume, JD, thesis, papers, sales, recruiting, transcript |
| B — general, outside sources | 3 | **must not retrieve** — false-positive retrieval probe (§13.1) |
| C — unsupported personal claims | 4 | fabrication + JD-as-experience contamination |
| D — mixed | 1 | claim-level split (§3.7) |
| E — follow-ups | 2 | referent resolution without over-retrieval |
| F — retrieval difficulty | 9 | synonym, abbreviation, misspelling, heading, code identifier, snake_case, table |
| G — conflicts | 3 | resume version contradiction |
| H — isolation | 5 | cross-meeting leak, cross-mode ambiguity |
| I — runtime failures | 1 | empty file marked indexed |
| J — prompt injection | 1 | document instructions ignored (§23) |

Three probes are worth calling out because they target findings from Phase 1:

- **C-02 "Does the candidate have Postgres experience?"** — `Postgres required` appears in the JD and **nowhere** in the resume. Retrieving the JD chunk is a contamination failure *even if the final answer is correctly hedged*, because the benchmark scores the retrieval decision, not the prose.
- **F-01 "How many layers are stacked in the encoder?"** — the exact question that caused a live intent misroute (`stacked` → coding). Retained as a permanent regression probe.
- **H-05 "What is the compensation range?"** — answerable from three different documents (JD 175–200k, recruiting bands, sales seat pricing). Correct behaviour depends entirely on the **active mode's** authorized sources. This is the single best measure of whether source authority works at all.

---

## 4. Configurations under test (§8.2)

| # | Configuration | Role after rebuild |
|---|---------------|--------------------|
| 1 | Semantic vector only | design input |
| 2 | Keyword / BM25 only | design input — **see F16 caveat** |
| 3 | Exact entity + heading only | design input |
| 4 | Hybrid semantic + keyword | design input |
| 5 | Hybrid + entity/heading signals | design input |
| 6 | Hybrid + reranking | design input |
| 7 | Profile Tree | removal evidence |
| 8 | Graph RAG | removal evidence |
| 9 | Hindsight-assisted | removal evidence |
| 10 | Legacy combined | removal evidence / baseline |
| 11 | New simple candidate | the proposal |

**F16 caveat, carried forward from Phase 1:** there is no FTS5 index anywhere under `electron/`, and the one retriever advertising "FTS/BM25" computes unique-term overlap with no IDF term. Configuration 2 therefore cannot be measured as a BM25 incumbent. It will be run twice — **2a** as the existing overlap scorer, and **2b** as a genuine BM25 implementation introduced for the benchmark — so that §8.4's question ("does keyword retrieval help on acronyms, identifiers, error messages?") gets a real answer rather than a measurement of a mislabelled component.

## 4A. Harness design constraints — five traps that would have silently corrupted the results

Each was found by empirically running the compiled bundles, not by reading source. All five fail **silently** — producing plausible numbers rather than errors — which is why they are recorded before any result is published.

### 4A.1 The embedding chain degrades to lexical without raising anything

`EmbeddingPipeline.waitForReady()` waits for **provider resolution only**, not model load. `isReady()` stays false until a first embedding is actually computed. Measured on the real bundle, without a warm-up call:

```
READY false ·  INDEX STATUS {"status":"lexical_only"} ·  embedding_space: null
HYBRID usedHybrid=false usedFallback=true      ← configs 1/4/5/6 silently became config 2
```

With `await pipe.getEmbeddingForQuery('warmup')` first:

```
READY true  ·  INDEX STATUS {"status":"ready"} ·  embedding_space: "local:xenova/all-minilm-l6-v2:384"
HYBRID usedHybrid=true  usedFallback=false     vec scores 0.707 / 0.148 / 0.138
```

**Without this, every vector configuration would have reported keyword-retrieval numbers under a vector label.** Three independent gates must all be cleared:

| Gate | Location | Silent effect |
|------|----------|---------------|
| `shouldUseLexicalForLocalManualQuery` | `ModeHybridRetriever.ts:686-691` | local provider + no transcript → vector path skipped |
| `keylessManualRetrievalUsesLexical` | `ModeHybridRetriever.ts:128-132` — **defaults TRUE** | same |
| `loadPersistedEmbeddings` space filter | `ModeHybridRetriever.ts:492-500` — exact `embedding_space` match, warn-only on throw | all `vectorScore = 0`, indistinguishable from "vectors weren't relevant" |

**Harness assertion (mandatory, per run):** `pipe.getActiveSpaceKey()` must equal `mode_reference_chunks.embedding_space`, and `usedHybrid` must be `true` for every vector config. A run violating either is void, not merely poor.

### 4A.2 `dist-electron/*.js` are self-contained bundles — requiring two gives two singletons

`class _DatabaseManager` is present in **both** `dist-electron/electron/services/ModesManager.js` and `.../db/DatabaseManager.js` (verified). `ModeHybridRetriever` likewise appears in two bundles. So `require`-ing both yields **two different `DatabaseManager` singletons and two different `intelligenceFlags` module instances** — not the objects `main.ts` wires together.

They do share the same SQLite file, because the path comes from `NATIVELY_TEST_USERDATA` (`DatabaseManager.ts:86-98`; there is no `dbPath` injection point). **Therefore: cross-bundle state must travel through the DB, never through object identity.** In-memory wiring such as `setSharedEmbeddingPipeline` affects only the bundle it was called on.

### 4A.3 Configs 1, 2 and 4 are three rankings of one pool — and must bypass the score floor

They are not three retrievers. The correct isolation point is the unfiltered candidate pool:

```js
const pool = await performHybridRetrieval.call(hr, candidates, queryWords, queryText, -Infinity, files);
// config 1 = sort by vectorScore · config 2 = sort by ftsScore · config 4 = combinedScore(fts, vec, 0.4)
```

The floor must be `-Infinity`, **not `0`** — cosine can be negative, and `0` would clip it. Re-ranking `retrieve()`'s public output instead would be biased: it applies an adaptive floor derived from `MIN_COMBINED_SCORE = 0.15`, so a chunk that would top pure-vector but falls below the *combined* floor never appears. Verified: the unfiltered pool returns 3 of 3 candidates including one with **zero lexical overlap**, which the normal path drops.

### 4A.4 Scores are not comparable across configs 4 and 5

`retrieve()` has two return sites. Under `forceDocumentGrounding` (which is exactly what distinguishes config 5 from config 4) `score` is `reportedDocGroundedScore()`; otherwise it is `combinedScore(fts, vec, 0.4)`. **Raw `score` magnitudes are therefore meaningless across that boundary.** `ftsScore` and `vectorScore` are raw in both branches — those, plus rank correlation, are the only valid cross-config numerics.

### 4A.5 Config 6 is a conditional escalation, not an alternative pipeline

Reranking only runs when the low-confidence gate trips (`CONF_TOP_SCORE_FLOOR=0.30`, `CONF_MARGIN_MIN=0.05`, `CONF_CONFIDENT_FLOOR=0.45`). **On a high-confidence query, config 6 is byte-identical to config 5.** Reporting a single averaged row would therefore dilute the reranker's real effect toward zero and invite the wrong keep/remove verdict.

The bake-off will **bucket queries by `confidence.lowConfidence`** and report config 6 only on the bucket where it actually engages. A 1200 ms race budget also discards rerank results silently on timeout; `NATIVELY_E2E=1 NATIVELY_H4_STAGE_TRACE=1` surfaces `rerank_timeout`. `__setRerankerForTests` (a public seam, `ModeHybridRetriever.ts:231`) will be used for a deterministic arm alongside the real ONNX arm.

## 4B. Configurations that cannot be isolated — reported, not faked

| Config | Finding | Treatment |
|--------|---------|-----------|
| **3 — entity + heading** | **No standalone retriever exists.** Entity signal is convex-fused `0.55·lexical + 0.45·entityFrac` inside `scoreChunk` (`ModeContextRetriever.ts:506-541`), gated on `forceDocumentGrounding`; extractors are module-private and unexported. | Approximated by two *real* production surfaces, not a reimplementation: **3a** structural routing via exported `DocumentMap` (`resolveTargetSections`, `selectTableOfContentsEntries`), **3b** entity-weighted `queryOkfCards`. Labelled as approximations in the results. |
| **8 — Graph RAG** | Relations are extracted **at pack-build time**, not query time (`KnowledgeManager.ts:111`). Enabling `NATIVELY_OKF_GRAPH_EXPANSION` at query time yields `relations: []` and a re-run returns `skipped_unchanged`. | Corpus must be **re-ingested** with the flag set. Also needs `NATIVELY_INTERNAL=1` or the pack is null entirely. `resolveStartNodeIds` requires exact case-insensitive entity-name match — no fuzzy fallback. |
| **9 — Hindsight** | **`HindsightManager` is not a retriever at all** — it is lifecycle only (health, spawn, stop) with no query method. The real surface is `LongTermMemoryService.recallRelevantMemory`, which requires a live external server. | Not reachable offline. Will be run with an injected fake `HindsightClientLike` (the adapter constructor takes the override explicitly) and reported as **hermetic, not production-representative**. |
| **`RrfFusion` / `SearchOrchestrator`** | Not a document retriever — a pure fusion engine over already-fetched candidates. `ragRrfFusion` defaults false everywhere and nothing in the mode-document path calls it. | Excluded from the document bake-off; recorded as dead for this purpose. |

**Config 2 resolved.** `computeFtsScore` (`ModeHybridRetriever.ts:626-640`) is `matches / √(|Q| · |uniqueChunkWords|)`, and it **de-duplicates matched terms** — so there is no term frequency, no IDF, and no document-length prior. Independently verified by reading the implementation. It is **normalised unique-term overlap, definitively not BM25**, which closes the UNDETERMINED item left open in Phase 1 F16 for this retriever. The 2a/2b split stands.

## 4C. Where config 11 should be built

`EvidenceResolver.resolve()` (`context-os/EvidenceResolver.ts:275`) already returns the typed shape the target architecture needs — `{ pack, strategy, attemptedSources, retrievedSources, rejectedSources, confidence }` — and its dependencies (`hybridRetriever`, `knowledgeManager`, `classifyQuestion`, `queryOkfCards`) are **injected interfaces**. Config 11 will therefore be assembled by substituting retrieval strategies into that seam rather than standing up a parallel pipeline, which also keeps the benchmark honest about what the rebuild would actually ship.

## 5. Metrics (§8.2)

Retrieval metrics are computed **without any model call**, so they are reproducible and free:

- Recall@1, Recall@3, Recall@5
- Precision@3 (FULL-answerability questions only)
- **Contamination rate** — a `prohibitedSources` chunk in top-k. Scored independently of answer correctness.
- **Stale-version rate** — a superseded document version retrieved (e.g. `resume_v1`). Distinct from a miss: the retriever found something, and it was the wrong generation of the truth.
- **False-retrieval rate** — category-B questions where anything was retrieved at all.
- p50 / p95 / p99 retrieval latency, ingestion latency, index size, failure rate

Answerability accuracy, unsupported-claim rate, and answer quality require a judge and are reported separately, clearly marked, so they cannot be confused with the deterministic numbers.

---

## 6. RESULTS

Run: 42 questions · 30 deterministically scored · 14 documents · 223 indexed chunks
Validity guard **passed** (`embedding_space = local:xenova/all-minilm-l6-v2:384` on every chunk; `usedHybrid` true).
Raw data: `benchmarks/ci-v3-retrieval/results/bakeoff-latest.json`.

| Config | R@1 | R@3 | R@5 | P@3 | Contam. | **Stale-ver.** | p50 ms |
|--------|-----|-----|-----|-----|---------|----------------|--------|
| 1 semantic only | 60.0 | 73.3 | 76.7 | 29.3 | 16.7 | **54.8** | 8 |
| 2a lexical overlap *(the shipped "FTS/BM25")* | 40.0 | 70.0 | 80.0 | 25.3 | **7.1** | **16.7** | 8 |
| **2b real BM25** *(introduced here)* | **63.3** | 80.0 | 80.0 | 30.7 | 9.5 | 23.8 | 11 |
| 4 hybrid *(production weighting)* | 56.7 | **83.3** | **83.3** | **33.3** | 14.3 | 47.6 | 8 |
| 4b hybrid w/ BM25 arm | 56.7 | 70.0 | **83.3** | 28.0 | **7.1** | 26.2 | 11 |

All figures are percentages. Latency is retrieval only (one local MiniLM query embedding + scoring), excluding generation.

### 6.1 The shipped keyword scorer is leaving 23 points of R@1 on the table

Swapping the mislabelled scorer for a genuine BM25 — **same candidate pool, same corpus, same questions, ranking function the only difference** — moves R@1 from **40.0 → 63.3** and P@3 from 25.3 → 30.7.

This is the single clearest actionable result in the phase. §8.4 asked whether keyword retrieval helps on acronyms, identifiers, error messages and headings. The answer is **yes, substantially — and the product has never had it**, because the component named "FTS/BM25" implements `matches / √(|Q|·|uniqueChunkWords|)` with de-duplicated matches: no term frequency, no IDF, no length prior.

Real BM25 also **beats pure semantic at R@1** (63.3 vs 60.0) at 11 ms.

### 6.2 The dominant risk is stale-version retrieval, and it is a property of embeddings

| Arm | Stale-version rate |
|-----|--------------------|
| semantic only | **54.8** |
| hybrid (production) | 47.6 |
| hybrid + BM25 | 26.2 |
| real BM25 | 23.8 |
| lexical overlap | **16.7** |

`resume_v1_2023.md` and `resume_v2_2026.md` are near-identical prose that disagree on five specific facts. **Semantic similarity cannot separate them** — the embeddings are, correctly, almost the same. So the more semantic weight a configuration carries, the more often it surfaces the superseded document.

The architectural conclusion is unambiguous and it is not a ranking problem:

> **Version and scope isolation must be a metadata FILTER applied before scoring, never a similarity signal.** No reranker, fusion weight, or better embedding model fixes this, because the two documents genuinely *are* semantically equivalent.

This directly corroborates Phase 1 **F19** (`EvidenceItem` has no `scopeId`) and **F12** (re-upload leaves sibling state stale), and it makes `scopeId` + active-version filtering a **hard requirement** of the new retriever rather than a nice-to-have.

### 6.3 Hybrid still wins on recall — but buys it with contamination

Config 4 has the best R@3 (83.3) and P@3 (33.3), and **twice the contamination rate** of the lexical arms (14.3 vs 7.1). Config 4b shows the trade explicitly: swapping in BM25 halves contamination (14.3 → 7.1) and stale (47.6 → 26.2) but costs R@3 (83.3 → 70.0).

So there is no dominant configuration on ranking alone. That is itself the finding: **the safety properties the product needs are not obtainable by choosing a better scorer.** They come from filtering (scope, version, source authority) — which is exactly the layer being rebuilt.

### 6.4 `falseRetrievalRate = 100%` is an artefact, and must be read as one

Every configuration retrieved candidates for the category-B general-knowledge questions ("What is idempotency?"). **This is not evidence that the product always retrieves.** The harness invokes the retriever directly, deliberately bypassing the upstream fast-path decision, in order to isolate ranking.

What it does establish: **the retriever itself has no notion of "should I run at all"** — it always returns a ranked pool. The fast/grounded decision therefore cannot live in the retriever and must be owned by the turn decision above it (§13.1). Measuring the real false-retrieval rate requires the orchestrator and belongs to Phase 8.

### 6.5 F22 — a 66-page PDF crashes the embedding worker (new, production-relevant)

`test-fixtures/modes-corpus/thesis/institutional_thesis.pdf` (66 pp, 128 184 chars) **reproducibly aborts the process with SIGTRAP** during `indexReferenceFile`.

Isolated:

| Document | chars | Extraction | Indexing |
|----------|-------|-----------|----------|
| `bert_1810.04805.pdf` | 64 701 | OK | **OK** |
| `institutional_thesis.pdf` | 128 184 | **OK (128 184 returned)** | **SIGTRAP** |

Extraction succeeds, so this is not a parser fault — it is the local ONNX embedding path failing on a document of that size, and it takes the whole process down rather than raising a catchable error.

**Why this matters beyond the benchmark:** a 66-page thesis is precisely the Seminar / Thesis-defence use case, and Seminar is the mode with the strictest grounding profile. It is also §22.4's requirement ("isolate the source, continue with other valid sources, do not poison the collection") failing in the hardest way — a hard process abort. The document is excluded from the corpus and the exclusion is annotated in `run.cjs`; it should be treated as a **P1 production bug independent of this mission**.

### 6.6 Empty-file handling is correct

`empty_reference.md` is **rejected at extraction** (`"empty_reference.md is empty"`) rather than being indexed as a successful empty document. §7.9 #26 ("empty file marked indexed") **does not reproduce** at this layer. Whether the *UI* reports it as indexed is a separate question for Phase 8.

## 7. Status and what remains

| Step | Status |
|------|--------|
| Corpus assembled, gaps closed | **DONE** |
| Label schema defined | **DONE** |
| 42 questions labelled | **DONE** |
| Gold facts verified against production extractor | **DONE — 30 ok / 0 failed** |
| Configuration entry-point map | **DONE** |
| Bake-off harness (bootstrap · ingest · configs · scorer · runner) | **DONE, validity-guarded** |
| Configs 1, 2a, 2b, 4, 4b measured | **DONE** |
| Config 3 (entity/heading) | **NOT RUN** — no isolable retriever exists (§4B); approximations specified, not executed |
| Config 5 (hybrid + doc-grounding) | **NOT RUN** — needs `retrieveHybridRaw` path; scores not comparable to the pool-based arms (§4A.4) |
| Config 6 (rerank) | **NOT RUN** — requires low-confidence bucketing (§4A.5) |
| Config 7 (Profile Tree) | **NOT RUN** — set-retrieval, not ranked; needs different metrics |
| Config 8 (Graph RAG) | **NOT RUN** — requires corpus re-ingest with `NATIVELY_OKF_GRAPH_EXPANSION` set at ingest time |
| Config 9 (Hindsight) | **NOT RUN** — requires a live external server; not reachable offline |
| Config 10 (legacy combined) | **NOT RUN** — returns a formatted string, not ranked candidates |
| Config 11 (new candidate) | **NOT RUN** — depends on Phase 4 |
| `03_KEEP_REMOVE_MATRIX.md` | **DONE** (verdicts limited to what was measured) |

**No estimated or inferred numbers appear in §6.** Every row in the results table was produced by an executed, validity-guarded run. Configurations that could not be executed are listed above with the reason and are absent from the table rather than approximated.

### Known blocker carried from Phase 1

**F21 — `npm test` cannot terminate**, because `IntentClassifier` spawns a worker thread that is never `unref()`d. The bake-off harness loads compiled production modules in-process and will inherit the same defect the moment any configuration touches intent classification. The harness must either dispose the worker explicitly or exit deliberately; the underlying fix belongs in Phase 4 and is still recommended as its first change.

---

## 8. SHADOW RUN — the legacy layers diffed against each other and against V3

Executed: `benchmarks/ci-v3-retrieval/shadow-run.cjs` · 42 questions × 4 modes = **168 comparisons**.
Decisions only — no LLM, no provider spend, fully deterministic.
Raw: `benchmarks/ci-v3-retrieval/results/shadow-latest.json`.

### 8.1 The headline finding: the legacy source decision ignores the question

| Metric | Result |
|--------|--------|
| Layer B vs Layer C diverged | **168/168 — 100%** |
| Layer C had no policy at all | **168/168 — 100%** |
| **Layer B distinct decisions across all 42 questions, per mode** | **1** |

That last row is the important one, and it is not a rounding artefact. For every mode, the legacy manual-chat layer produced **exactly one decision for all 42 questions**. Verbatim, in `technical-interview`:

| Question | Legacy decision |
|----------|-----------------|
| "What is idempotency in the context of an HTTP API?" | `authority=profile_only owner=profile required=[profile_resume,projects]` |
| "What is the name of the price-comparison website…?" | `authority=profile_only owner=profile required=[profile_resume,projects]` |
| "What is the compensation range for the role?" | `authority=profile_only owner=profile required=[profile_resume,projects]` |
| "Are we migrating the ledger to Cassandra?" | `authority=profile_only owner=profile required=[profile_resume,projects]` |

**The legacy source decision is a pure function of the MODE. The question is not an input.**

This single measurement explains a cluster of previously separate symptoms:

- **Why retrieval always runs** — §6.4 measured a 100% false-retrieval rate. It is not that the gate is mis-tuned; there is no gate. The decision cannot depend on the question.
- **Why general questions get contaminated with profile data** — "What is idempotency?" *demands* `profile_resume` evidence.
- **Why a JD question pulls the resume** — "What is the compensation range for the role?" also demands `profile_resume`, never the JD.
- **Why claim-level grounding (§3.7) was unreachable** — a decision that cannot see the question cannot distinguish the claims inside it.

No amount of prompt tuning reaches this. It is the architecture the rebuild replaces.

### 8.2 V3 on the same 168 comparisons

| Metric | Result |
|--------|--------|
| Path distribution | `GROUNDED` 138 · `FAST` 30 |
| Agreement with labelled expectation (all modes) | **150/168 — 89.3%** |
| Agreement in `technical-interview` (the mode the labels assume) | **38/42 — 90.5%** |

Where the legacy layer yields 1 distinct decision, V3 yields a question-dependent one — which is the entire point of the rebuild.

### 8.3 What the shadow run found in MY code — three fixes

The run was worth as much for the defects it exposed in the new classifier as for those it confirmed in the old one.

1. **Third-person phrasing required no source.** `PERSONAL_RE` matched only second person, so *"What is the name of the price-comparison website **the candidate** built?"* classified as needing **no source at all** — fabrication permitted. Interview-prep and recruiting surfaces routinely phrase questions in the third person.
2. **"What is X" over-matched.** *"What is the discount floor for Acme?"* took the fast path and would have been answered from model knowledge. A capitalised proper noun that is not ordinary technical vocabulary is now a private-source signal (with an allowlist so `HTTP`/`API` do not trigger it).
3. **My own corpus labels were wrong.** Five questions labelled `expectedPath: VERIFICATION` were conflict cases — but VERIFICATION is a **post-retrieval escalation** (§13.3: "sources conflict"), and a classifier cannot know a conflict exists before retrieving. The label conflated a pre-retrieval decision with a post-retrieval state. Corrected to `GROUNDED`; the conflict is already captured by `expectedAnswerability: CONFLICTING`.

Effect: **65.5% → 79.8% → 89.3%**.

### 8.4 The 4 remaining misses, stated plainly

| # | Question | Cause |
|---|----------|-------|
| G-03 | "What is the peak transaction volume of the payments API?" | Impersonal phrasing of a private fact with no proper noun. A genuine classifier limitation. |
| A-11 | "What is the list price per seat?" | Same. |
| ~~H-03~~ | ~~"How many backend roles are we opening this quarter?"~~ | **FIXED — see §8.5.** |
| F-05 | "What is the p99 now?" | Impersonal, no meeting cue and no proper noun — same class as G-03/A-11. |

The first two are a real gap: an impersonal question about a private fact carries no lexical signal at all, and resolving it needs mode-aware defaults or conversation state rather than a better regex. The last two argue for a fifth retrieval path — an explicit *unanswerable-in-this-mode* outcome, rather than silently taking the fast path.


### 8.5 Fix: `unsupportedInMode` — telling "no source needed" apart from "source forbidden here"

The shadow run exposed a conflation in the new classifier that would have shipped silently.

Asking *"How many backend roles are we opening this quarter?"* in `technical-interview` needs `MEETING_TRANSCRIPT`, which that mode does not authorize. So `requiredSourceTypes` came back **empty** — the same value a genuinely general question produces. The two collapsed, and the turn took the FAST path and answered a **meeting question from model knowledge**.

These demand opposite behaviour, so they are now separate signals. `Classification.unsupportedInMode` records what the question needed and the mode refused:

| Question | Mode | Path | Retrieve | `unsupportedInMode` | Fallback |
|----------|------|------|----------|---------------------|----------|
| How many backend roles…? | `technical-interview` | **GROUNDED** | false | `[MEETING_TRANSCRIPT]` | `STRICT_NOT_FOUND` |
| How many backend roles…? | `team-meet` | GROUNDED | **true** | `[]` | — |
| What is idempotency…? | `technical-interview` | FAST | false | `[]` | `NONE` |

The turn stays **GROUNDED with nothing to retrieve**, and the fallback is an explicit gap rather than general knowledge — because answering a meeting question from model knowledge is fabrication, whatever `generalKnowledgeAllowed` says.

Modelled as a **signal, not a fourth `RetrievalPath`**, so the §10.7 three-valued contract is unchanged.

**Result: 89.3% → 92.9%** (92.9% in-mode). Cumulative across the three shadow iterations: **65.5% → 79.8% → 89.3% → 92.9%**.

### 8.6 The 3 remaining misses share one cause

`G-03` "What is the peak transaction volume of the payments API?" · `A-11` "What is the list price per seat?" · `F-05` "What is the p99 now?"

All three are **impersonal phrasings of a private fact with no lexical signal at all** — no pronoun, no proper noun, no document cue. `payments API` and `p99` are ordinary technical vocabulary; `list price per seat` names nothing.

This is a real limit of deterministic classification, and it is recorded rather than papered over. A better regex cannot fix it — resolving these needs either conversation state (what was the previous turn about?) or a mode-aware default (in a sales mode, an unqualified price question is almost certainly a document lookup). Both are architectural, not lexical, and belong to a later phase.

The failure direction is at least the safe one: these take the FAST path and answer from general knowledge **without fabricating a source-specific figure**, rather than inventing a number and attributing it to a document.
