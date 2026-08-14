# Natively — Cosine Similarity & Semantic Retrieval Investigation

**Date:** 2026-08-13
**Branch:** `fix/answer-policy-and-conversation-state`
**Scope:** Full relevance/similarity audit. **Investigation only — zero code modified.**
**Method:** Static trace of `electron/`, `premium/`, `src/`, `natively-api/`, cross-checked against prior
session memory (several findings here were empirically established in earlier sessions and are
cited as such rather than re-derived).

---

## Executive Summary

Natively makes relevance decisions at **two structurally separate layers**, and the single most
important architectural fact in this repo is that they are already separated correctly:

| Layer | Mechanism | Similarity used? |
|---|---|---|
| **Source selection** ("which corpus may this turn read?") | Deterministic policy — `electron/llm/turnSourceDecision.ts` + `electron/context-intelligence/policies/source-authority-policy.ts` | **None. Zero.** |
| **Chunk retrieval** ("which passages inside that corpus?") | Five *different* scorers, one per corpus | Mixed — lexical, BM25, IDF, cosine |

**Answer to the task's §4 critical question:** semantic similarity is used **only at the
chunk-retrieval level, never at the source-selection level.** That is not a gap — it is the
correct design, and it should stay that way. `filterByScopeAndVersion`
(`source-authority-policy.ts:131`) makes wrong sources *unretrievable* rather than
*low-ranked*, with an explicit comment (line 101) explaining why ranking cannot solve it:
two résumé versions are "correctly almost identical — no reranker or weight change can
separate them."

The real problems are **inside** the chunk layer, and they are not "cosine is missing." They are:

1. **A cosine gate that is mathematically unreachable** (P0). In `HybridSearchEngine.scoreNode`
   cosine contributes at most `0.6` to an additive score filtered at `> 0.55`. A node must score
   cosine **> 0.9167** to be retrieved on semantic merit alone, while non-semantic boosts sum to
   **1.35** and can admit a node whose cosine is zero. This is the profile/résumé path.
2. **Five independent scorers with incomparable score scales** (P1), all feeding thresholds that
   look like they mean the same thing and do not.
3. **A finished-but-unwired hybrid** (P1): `bm25.ts:105` documents `scoreNormalized()` as existing
   "so BM25 can be fused with cosine similarity." It has **zero callers.** The V3 profile port is
   BM25-only.

Adding cosine anywhere else is *not* the top priority. Fixing the one place cosine already exists
but cannot fire is.

**A prior cosine experiment in this repo was already falsified — and the P0 was already
diagnosed and then routed around rather than fixed.** `PROFILE_GROUNDING_V2` is **DEFAULT ON**
(`electron/llm/profileGroundingV2.ts:41`, kill-switch model). It replaces cosine retrieval with
whole-profile injection **for six answer types only**. `KnowledgeOrchestrator.ts:1467-1469`
states the reason in the codebase's own words:

> Why it must bypass vector retrieval: `getRelevantNodes` drops nodes below a 0.55 cosine
> threshold, and a terse listing query embeds poorly — so retrieval can return ZERO
> project/experience nodes even though the structured resume contains them. That empty context
> block is the structural cause of "I don't have access to your projects".

That is §5's Consequence 1, independently confirmed by the code. **The scorer was never fixed —
traffic was routed around it.** Behavioral (STAR nodes), jd_fit/company (dossier), and
negotiation answer types still run through the broken scorer today (`:1560-1592`), as does
`roleInsight/EvidenceRetriever` at its own `RETRIEVAL_THRESHOLD = 0.42`.

---

## 1. Current Retrieval Architecture (as discovered)

```
                            USER QUESTION
                                 │
                                 ▼
              ┌──────────── ENTRY POINT ────────────┐
              │                                      │
   ipcHandlers.ts:693                    IntelligenceEngine (live/WTA)
   'gemini-chat-stream'                  + electron/llm/index.ts (V3)
   (the REAL Ask-AI box)                          │
              │                                      │
              └──────────────┬───────────────────────┘
                             ▼
        ┌──── MODE (explicit, DB-persisted — NOT inferred) ────┐
        │  ModesManager.getActiveMode() → SQLite row           │
        │  NO similarity. NO classifier override.              │
        └───────────────────────┬──────────────────────────────┘
                                ▼
        ┌──── SOURCE DECISION (deterministic policy) ──────────┐
        │  turnSourceDecision.ts:186 resolveTurnSourceDecision │
        │  inputs: persisted sourceContract                    │
        │        + explicitRequests (user asked for X)         │
        │        + availability (hasReferenceFiles / …)        │
        │  output: outcome + allowedEvidenceKinds + reasonCode │
        │  NO similarity. NO embeddings. NO LLM.               │
        └───────────────────────┬──────────────────────────────┘
                                ▼
        ┌──── SCOPE FILTER (hard prison, not a ranking) ───────┐
        │  source-authority-policy.ts:131                      │
        │  filterByScopeAndVersion → OUT_OF_SCOPE /            │
        │    SUPERSEDED_VERSION / UNAUTHORIZED_SOURCE          │
        └───────────────────────┬──────────────────────────────┘
                                ▼
        ┌──── CHUNK RETRIEVAL — FIVE SEPARATE SCORERS ─────────┐
        │                                                      │
        │  A. Mode reference files (doc-grounded)              │
        │     ModeContextRetriever.ts:435  scoreChunk          │
        │     → PURE LEXICAL. overlap + Levenshtein-1 +        │
        │       verbatim entity coverage. NO EMBEDDINGS.       │
        │                                                      │
        │  B. Mode reference files (hybrid)                    │
        │     ModeHybridRetriever.ts:772  combinedScore        │
        │     → 0.4·FTS + 0.6·cosine, + ONNX cross-encoder     │
        │       rerank on low confidence                       │
        │                                                      │
        │  C. Profile (V3 port)                                │
        │     profile-retrieval-port.ts:590                    │
        │     → BM25 + intent boosts. NO EMBEDDINGS.           │
        │                                                      │
        │  D. Profile (legacy premium)                         │
        │     HybridSearchEngine.ts:109  scoreNode             │
        │     → 0.6·cosine + up to 1.35 of metadata boosts,    │
        │       filtered at 0.55  ← THE P0                     │
        │                                                      │
        │  E. Meeting transcripts (RAG)                        │
        │     VectorStore.ts:744  cosineSimilarity             │
        │     → TRUE vector search, sqlite-vec or JS fallback  │
        │                                                      │
        │  F. OKF knowledge cards                              │
        │     OkfRetriever.ts:50  IDF-weighted field blend     │
        └───────────────────────┬──────────────────────────────┘
                                ▼
        ┌──── CONTEXT ASSEMBLY / DEDUP ────────────────────────┐
        │  combineRetrievalPorts + packContext (normalized     │
        │  passage dedup — EXACT match, not semantic)          │
        └───────────────────────┬──────────────────────────────┘
                                ▼
        ┌──── FINAL PROMPT VALIDATION (last boundary) ─────────┐
        │  context-os/finalPromptValidation.ts                 │
        │  fails closed on missing-required / forbidden        │
        │  (only when contextOs* flags ON — prod = observe)    │
        └───────────────────────┬──────────────────────────────┘
                                ▼
                              LLM
                                ▼
        ┌──── POST-STREAM ────────────────────────────────────┐
        │  answerPolish.ts:515  Jaccard ≥ 0.6 dedup           │
        │  assistant claims persistence (contextOs)           │
        └─────────────────────────────────────────────────────┘
```

---

## 2. Similarity Inventory — every mechanism found

| # | File:line | Metric | Domain | Live? |
|---|---|---|---|---|
| 1 | `electron/rag/VectorStore.ts:744` | **Cosine** (Float32 BLOB, no intermediate alloc) | Meeting transcript RAG | Yes |
| 2 | `electron/rag/VectorStore.ts:243` | `1 - distance` from sqlite-vec `MATCH` | Meeting RAG, native path | Yes (macOS) |
| 3 | `premium/electron/knowledge/HybridSearchEngine.ts:24` | **Cosine**, weighted 0.6 into additive score | Résumé / JD nodes | **Partially** — bypassed for 6 profile answer types under V2 (default ON); live for behavioral / jd_fit / negotiation / roleInsight (see §5) |
| 4 | `electron/services/modes/ModeHybridRetriever.ts:749` | **Cosine** (`computeVectorScore`) | Mode reference files | Yes |
| 5 | `electron/services/modes/ModeHybridRetriever.ts:772` | `0.4·FTS + 0.6·cosine` | Mode reference files | Yes |
| 6 | `electron/rag/LocalReranker.ts` | **ONNX cross-encoder** (`bge-reranker-base`, q8) | Mode ref files, escalation | Dev yes / packaged **no model** |
| 7 | `electron/context-intelligence/retrieval/bm25.ts:61` | **BM25** (k1=1.5, b=0.75) | V3 profile port | Yes |
| 8 | `electron/context-intelligence/retrieval/bm25.ts:108` | BM25 min-max normalized *for cosine fusion* | — | **DEAD — 0 callers** |
| 9 | `electron/services/ModeContextRetriever.ts:435` | Normalized word overlap + Levenshtein-1 + entity fraction | Doc-grounded reference files | Yes |
| 10 | `electron/services/ModeContextRetriever.ts:190` | **Levenshtein** (bounded, dist ≤ 1) | Typo tolerance | Yes |
| 11 | `electron/services/modes/retrievalTextMatch.ts:8` | **Levenshtein-1** (second copy) | Mode text match | Yes |
| 12 | `premium/electron/knowledge/IntentClassifier.ts:102` | **Levenshtein** (third copy, unbounded) | Intent matching | Yes |
| 13 | `electron/services/knowledge/OkfRetriever.ts:50` | **IDF**-weighted field blend (0.35 title + 0.30 body + 0.20 entity + …) | OKF cards | Yes |
| 14 | `electron/services/knowledge/OkfProfileRetriever.ts:210` | Score ≥ 0.1 + relative band floor | OKF profile cards | Yes |
| 15 | `electron/llm/answerPolish.ts:515` | **Jaccard** ≥ 0.6 | Answer sentence dedup | Yes |
| 16 | `electron/llm/speculativeSimilarity.ts:22` | **Jaccard** (variant denominator) | Speculative answer reuse | Yes |

**Three independent Levenshtein implementations** (#10, #11, #12) and **two independent Jaccard
implementations with different denominators** (#15, #16). #16 computes
`intersection / (|A| + |B| − intersection)` — that *is* standard Jaccard; #15 is a separate
closure. Duplication, not divergence, but it is drift-prone.

---

## 3. Embedding Inventory

| Provider | Model | Dims | Space key | Role |
|---|---|---|---|---|
| Gemini | `gemini-embedding-2` | 768 | `gemini:gemini-embedding-2:768` | Cloud primary |
| OpenAI | `text-embedding-3-small` | 1536 | `openai:…:1536` | Cloud, if key present |
| Ollama | `nomic-embed-text` | **768** | `ollama:nomic-embed-text:768` | Local server |
| Local ONNX | `Xenova/all-MiniLM-L6-v2` | 384 | `local:…:384` | Terminal fallback, bundled |

Resolution order: `EmbeddingProviderResolver.resolve()` — OpenAI → Gemini → Ollama → **Local
(unconditional terminal fallback, never probed** so the ONNX model isn't loaded at startup,
`EmbeddingProviderResolver.ts:147`).

### Are embeddings from different models ever compared?

**No — and this was a real bug that is now correctly fixed.** Gemini-768 and Ollama-768 have
**identical dimensions and different semantic spaces**; a dims-only check cannot tell them apart.
The fix is the composite `embedding_space = ${name}:${normalizedModel}:${dims}`
(`electron/rag/embeddingSpace.ts`), threaded through every search path. Hard guards:

- `VectorStore.ts:187` — `searchSimilar` without `spaceKey` returns `[]` rather than leaking
  across spaces.
- `VectorStore.ts:458` — same invariant for `searchSummaries`.
- `ModeHybridRetriever.ts:1655` — "NEVER cross-compare; cosine across spaces is semantically"
  [unusable].

This is one of the strongest parts of the codebase. **Do not weaken it.** Session memory
(`embedding_space_v2_migration`) records that the pre-fix version silently cosine-compared v1
vectors against v2 queries with no error — same name, same dims, incompatible space.

**Server-side embeddings are separate and stateless:** `natively-api` `/v1/embed` stores no
vectors and is not called by the desktop app. All user-facing RAG embeds locally with the user's
own key.

---

## 4. Source Selection Analysis — the critical question, answered

`resolveTurnSourceDecision` (`electron/llm/turnSourceDecision.ts:186`) is a **pure deterministic
function** of three inputs:

1. the persisted `sourceContract` / authority (`reference_files`, `profile_plus_transcript`,
   `transcript_only`, …)
2. `explicitRequests[]` — the user explicitly asking for a source
3. `availability` — `hasReferenceFiles`, `hasProfileFacts`, `hasJobDescription`,
   `hasLiveTranscript`, `hasMeetingRag`

It emits `outcome` + `allowedEvidenceKinds` + `requiredEvidenceKinds` + `reasonCode`. There is
**no embedding, no cosine, no LLM classifier, and no threshold** anywhere in it. Strict-mode
authorities are described in memory as "a hard prison"; `explicit_unavailable` is deliberately
distinct from `explicit_denied`.

Mode routing is equally deterministic: `ModesManager.getActiveMode()` (line 446) reads a SQLite
row. Nothing infers or overrides the user's explicit mode selection.

**Assessment: this is correct and should not change.** The task's §16 warning — "do not allow
semantic similarity to override an explicit user-selected mode" — is already honored by
construction. Introducing a similarity signal at this layer would be a regression, and the
`filterByScopeAndVersion` comment (line 101) explains exactly why: version disambiguation between
two near-identical résumé revisions is *not a similarity problem* and no reranker can solve it.

---

## 5. THE P0 — `HybridSearchEngine.scoreNode` cosine gate is mathematically unreachable

**File:** `premium/electron/knowledge/HybridSearchEngine.ts:109-179`, filtered at line 230.

```
score  = 0.6 · cosine(node, question)     // semantic
       + 0.20  if any query keyword hits node.tags
       + 0.10  if node.duration_months > 12
       + 0.10  if isRecent(node.end_date)        // within 2 years, or ongoing
       + 0.15  if node matches a JD required skill      (résumé nodes)
       + 0.25  if node.category ∈ categoryHintKeywords  (résumé nodes)
       + 0.35  if ≥2 title words appear in the question (résumé nodes)
       + 0.20  if organization name appears in question (résumé nodes)

filter:  score > RELEVANCE_THRESHOLD  (0.55, line 3)
```

### Consequence 1 — semantic relevance alone can almost never retrieve

Cosine's maximum contribution is `0.6`. To clear `0.55` on semantics alone requires

```
cosine > 0.55 / 0.6 = 0.9167
```

Gemini embeddings for a question and a genuinely relevant but differently-worded passage
typically land well below that. **A perfectly on-topic node scoring cosine 0.90 is filtered
out.** The 60% weight in the comment ("60% — Semantic similarity") describes an intent the
threshold arithmetic contradicts.

### Consequence 2 — a query-independent floor admits irrelevant nodes

`duration_months > 12` (+0.10) and `isRecent` (+0.10) are **properties of the node, not of the
query.** Every current or recent long-held role carries a standing +0.20 before the question is
even read. Such a node needs only

```
cosine > (0.55 − 0.20) / 0.6 = 0.583
```

Gemini embeddings are not mean-centered, so unrelated text pairs routinely sit in the 0.5–0.7
band. **A recent, long-held role is therefore admitted on essentially any question** — while an
older, shorter, genuinely-relevant project needs an unreachable 0.9167.

The retrieval bias is exactly inverted from what it should be: **recency and tenure beat
relevance.** This is a concrete, code-level mechanism for the résumé-contamination class of bugs
recorded in `context-os-source-authority-2026-07-10` ("four phases of the project" leaking
TalentScope).

**Verified inversion** (arithmetic replicated exactly from lines 109-179 and 230):

| Node | cosine | score | outcome |
|---|---|---|---|
| Recent, >12-month role, *no* keyword/title/category match | **0.60** | `0.6·0.60 + 0.20` = **0.560** | **ADMITTED** |
| Older, <12-month project, strongly on-topic, no keyword match | **0.90** | `0.6·0.90` = **0.540** | **REJECTED** |

The less relevant node wins by 0.02 purely on tenure and recency. Max non-semantic boost sum is
**1.35**, which alone clears the 0.55 gate — a node with **cosine exactly 0** can be retrieved.
Maximum achievable score is 1.95, so the "relevance threshold" of 0.55 sits at 28% of a scale
that is 69% non-semantic.

### Consequence 3 — the threshold is on the wrong quantity

`RELEVANCE_THRESHOLD` reads as a *similarity* threshold. It is applied to a **blended score with
a maximum near 1.95**, where 1.35 of that range is non-semantic. Nothing named "relevance
threshold" should be comparable to `0.6·cosine + 1.35·metadata`.

### Reachability — VERIFIED. Which traffic still hits this scorer?

`PROFILE_GROUNDING_V2` is **default ON**. `KnowledgeOrchestrator.ts:1566-1576` computes
`groundingCoversAnswer` and sets `queryEmbedder = null` — skipping `getRelevantNodes` entirely —
for six answer types:

`identity_answer`, `profile_fact_answer`, `skills_answer`, `skill_experience_answer`,
`project_answer`, `experience_answer`.

**Retrieval still runs, through the broken scorer, for:**

| Path | Threshold | Still live? |
|---|---|---|
| Behavioral (STAR-story nodes — not in the grounding block) | 0.55 | **Yes** |
| `jd_fit` / company (dossier nodes) | 0.55 | **Yes** |
| Negotiation (salary / dossier) | 0.55 | **Yes** |
| `roleInsight/EvidenceRetriever.ts:26` | **0.42** | **Yes** |
| The six covered profile types | — | No — bypassed |

So the P0's **false-negative** half (Consequence 1) is largely mitigated for the common profile
questions and **fully live for behavioral, JD-fit, and negotiation**. The **contamination** half
(Consequence 2) is live on every one of those paths, because the +0.20 query-independent floor
still admits recent long-held roles into behavioral and negotiation contexts.

**At `RETRIEVAL_THRESHOLD = 0.42` the trade is worse, not better** (same scorer, lower gate):

| | 0.55 (`HybridSearchEngine`) | 0.42 (`EvidenceRetriever`) |
|---|---|---|
| cosine needed alone | 0.9167 | **0.7000** |
| cosine needed with the free +0.20 floor | 0.5833 | **0.3667** |
| cosine = 0 + max boosts (1.35) admitted? | Yes | Yes |

Lowering the threshold mildly relieves unreachability and **materially worsens contamination** —
at 0.42 an irrelevant recent role is admitted at cosine 0.367. This is the clearest possible
demonstration that retuning the constant cannot fix the design.

### Smallest safe fix (documented, NOT implemented)

Do **not** raise or lower `0.55` — that trades one failure mode for the other. The minimal
correct change is to **separate the gate from the ranking**:

```
admit  iff  cosine ≥ SEMANTIC_FLOOR         // a real cosine threshold, calibrated
rank   by   the existing blended score      // boosts order, they no longer admit
```

This is one predicate, leaves every boost weight untouched, and is directly testable: assert that
a node with cosine 0 and full metadata boosts is *not* returned, and that a node with cosine 0.85
and no boosts *is*. `SEMANTIC_FLOOR` must be calibrated per embedding space
(`gemini:gemini-embedding-2:768` and `local:MiniLM:384` have different score distributions) —
a single hard-coded constant would reintroduce the same class of bug.

**Before touching this, reconcile against `profile-grounding-rewrite-2026-06-04`**, which
concluded that for a ~2KB profile corpus the correct answer is *whole-document injection*, not
better retrieval. If `PROFILE_GROUNDING_V2` is ON, this path may be bypassed entirely for the main
answer flow — in which case the fix's value is confined to the paths V2 does not cover
(`roleInsight/EvidenceRetriever.ts`, which uses its own `RETRIEVAL_THRESHOLD = 0.42` against the
same unreachable-cosine scorer). **Determine V2's live default state first** — this audit did not
execute the app.

---

## 6. Reference File Analysis — two retrievers, divergent eligibility

Mode reference files (uploaded PDFs, theses, docs) have **two** retrievers:

**A. `ModeContextRetriever.scoreChunk` (`:435`) — purely lexical, no embeddings.**

```
lexical = matches / sqrt(|queryWords| · |uniqueChunkWords|)     // exact=1.0, Levenshtein-1=0.5
final   = convex combination of lexical and entityFrac ∈ [0,1]  // doc-grounded only
```

Well-engineered for what it is — bounded to [0,1] (an earlier unbounded `+0.5·entityHits` reached
2.207 in live logs and made the two retrievers' orderings incomparable), word-boundary entity
matching (substring matching had counted "lora" inside "exploration"), and fine sub-chunking at
`SUBCHUNK_WORDS = 45` gated to doc-grounded only. But it is **lexical**: a question that shares no
vocabulary with the answer-bearing passage scores near zero.

**B. `ModeHybridRetriever` — real hybrid.** `0.4·FTS + 0.6·cosine`, plus an ONNX cross-encoder
rerank over a widened 30-candidate pool when a confidence gate trips.

**Finding (P1): the two call sites disagree on when hybrid is eligible.**

- `LLMHelper.ts:2800` — `if (forceDocumentGrounding && typeof …Hybrid === 'function')`
- `LLMHelper.ts:5854` — `const wantHybrid = isRagLocalRerankEnabled() || forceDocumentGrounding`

The second is strictly more permissive. A non-doc-grounded custom mode with rerank enabled gets
hybrid retrieval through one entry point and lexical-only through the other, for the same
question and same files. Budgets also differ (`HYBRID_BUDGET_MS = forceDocumentGrounding ? 2000
: 1000`, line 5860) — on timeout it silently falls back to lexical, so **retrieval quality is
non-deterministic under load.**

Memory `document-grounded-real-path-2026-06-27` establishes that `gemini-chat-stream`
(`ipcHandlers.ts:693`) is the real Ask-AI path and that an earlier `!forceDocumentGrounding` term
had *skipped* hybrid on exactly that path. The negation is now fixed at 5854; the divergence
between the two sites is not.

### The `MIN_LEXICAL_SCORE` fix is exemplary — cite it as the pattern

`ModeHybridRetriever.ts:135-160` documents a scale-mismatch bug worth generalizing:

> `combinedScore = FTS_WEIGHT·fts + (1−FTS_WEIGHT)·vector`, so a bare `ftsScore` and a combined
> score are on different scales. Filtering `ftsScore >= MIN_COMBINED_SCORE` requires the lexical
> arm alone to clear a bar calibrated for lexical AND vector together.

Measured consequence recorded in the comment: `fts = 0.109, vector = 0.478, combined = 0.330` —
above the 0.15 combined floor, yet the lexical path returned **zero** chunks because
`0.109 < 0.15`, making uploaded references "silently inert for any keyless install." The fix
scales the floor by the arm's own weight: `MIN_LEXICAL_SCORE = MIN_COMBINED_SCORE · FTS_WEIGHT`.

**This is precisely the bug class present in `HybridSearchEngine` (§5) — one threshold applied
across two different score scales.** It was diagnosed and fixed here and not there.

---

## 7. Profile Intelligence Analysis

**Storage** (per `v3-profile-source-routing-fix-2026-07-31`):
`knowledge_documents` (structured JSON; autoincrement id changes on re-upload — **not canonical**)
plus OKF `knowledge_sources` under reserved mode `__profile_okf__`, with **stable** ids
`psrc_<sha1_16>`. `content_hash` is the version key. Raw document text is never persisted.

**Retrieval — three paths, only one uses embeddings:**

| Path | Scorer | Embeddings |
|---|---|---|
| V3 `profile-retrieval-port.ts:590` | BM25 + intent boosts, `squash(x)=x/(x+1.5)` | **No** |
| Legacy `HybridSearchEngine` | 0.6·cosine + boosts | Yes (but see §5) |
| OKF `OkfRetriever.ts:50` | IDF-weighted field blend | **No** |

The V3 port's boost discipline is well-reasoned and worth preserving: boosts are **capped at
0.35** and cannot admit a chunk on their own, with one deliberate exception — a *complete
inventory* chunk targeted by a fired intent is policy-admitted at a fixed **0.6**, because
"absence evidence can never rank on similarity by construction — the skills list that proves
'Kubernetes is not listed' deliberately does not contain the word Kubernetes."

**That single comment is the strongest argument in this repo against cosine-everywhere.** No
similarity metric — lexical or semantic — can retrieve the evidence for a grounded negative. It
requires policy admission. Any "replace X with cosine" proposal must preserve this.

### "Should Profile Intelligence be included in this answer?"

This is a **source-level** question and it is already answered deterministically —
`ModePolicy.profileSources` is an explicit opt-in allowlist (Looking-for-Work: all three;
technical-interview: RESUME + JD; **all others: empty**, so "recruiting must never see the user's
target JD"). Cosine must not participate in this decision. The task's §5 framing is correct and
the architecture already implements the right answer.

---

## 8. Where Cosine Should NOT Be Used

| Location | Why not | Better mechanism |
|---|---|---|
| **Source selection** (`turnSourceDecision.ts`) | Authority is a permission, not a resemblance. A JD and a résumé about the same role are *maximally* similar and must be kept apart. | Deterministic policy — already there |
| **Version disambiguation** (`filterByScopeAndVersion`) | Two résumé revisions are near-identical by construction; the code says so at line 101 | Version metadata — already there |
| **Grounded-absence evidence** (complete inventories) | The proving chunk provably lacks the query term | Policy admission at fixed 0.6 — already there |
| **Mode routing** (`ModesManager.getActiveMode`) | Explicit user intent outranks any score | DB row — already there |
| **Exact identifiers** — filenames, function names, API names, `ROS#`, `C++`, `OpenVLA-OFT` | Embeddings blur rare tokens; verbatim presence is the signal | BM25 / entity coverage — already there |
| **Answer dedup** (`answerPolish.ts:515`) | Sentence-level set overlap is cheap, deterministic, and adequate at n≈10 sentences | Jaccard — already there |
| **Typo tolerance** (`ModeContextRetriever.ts:190`) | Character-level noise is not a semantic phenomenon | Levenshtein-1 — already there |

**Every one of these is already implemented with the right mechanism.** The architecture's
instincts are sound; the defects are arithmetic, not conceptual.

---

## 9. Context Contamination Risks

| # | Path | Severity |
|---|---|---|
| C1 | `HybridSearchEngine` query-independent +0.20 recency/tenure floor admits recent roles on any question (§5) | **P0** |
| C2 | Hybrid-eligibility divergence between `LLMHelper.ts:2800` and `:5854` → same question retrieves differently by entry point (§6) | **P1** |
| C3 | Hybrid budget timeout (1000/2000 ms) silently degrades to lexical → retrieval quality varies with machine load | **P1** |
| C4 | `finalPromptValidation` fails closed **only when `contextOs*` flags are on**; production default is observe-only, so the last boundary is advisory in prod | **P1** |
| C5 | `autoContextSnapshot` rolling transcript previously fed prior *assistant* answers back as context. Mitigated by `stripPriorAssistantTurns`, but the mitigation is a string-prefix strip of `[ASSISTANT (PREVIOUS SUGGESTION)]:` blocks — fragile to any format change | **P2** |
| C6 | Cross-bundle singleton staleness — `getInstance()` returns different objects per esbuild bundle. **Latent in production** (only `main.js` loads) but **active in every test/benchmark harness**, i.e. the runtimes all measurements come from | **P2 (measurement integrity)** |

C6 deserves emphasis for this audit specifically: **any benchmark number produced by a harness
that loads ≥2 `dist-electron` bundles may reflect a stale cache rather than real behavior.** Per
`esbuild-per-bundle-singletons-2026-07-31`, `ModesManager._activeModeInfoCache` caused Recruiting
and Sales turns to retrieve **Technical Interview** reference files. Any calibration of the
thresholds proposed here must be run in a real Electron main process, not a bare-node harness.

---

## 10. Threshold Inventory

| Threshold | Value | File:line | Metric it gates | Assessment |
|---|---|---|---|---|
| `RELEVANCE_THRESHOLD` | 0.55 | `HybridSearchEngine.ts:3` | **blended** (max ~1.95) | **Wrong scale — P0** |
| `RETRIEVAL_THRESHOLD` | 0.42 | `roleInsight/EvidenceRetriever.ts:26` | same blended score | Arbitrary. Same scorer, **different trade**: cosine-alone needs 0.70, but an irrelevant recent role is admitted at cosine **0.367** — contamination worse (§5) |
| `minSimilarity` | 0.25 | `RAGRetriever.ts:90,185`; `VectorStore.ts:179` | **true cosine** | Correct scale, value unjustified |
| `MIN_COMBINED_SCORE` | 0.15 | `ModeHybridRetriever.ts:135` | combined [0,1] | Correct scale |
| `MIN_LEXICAL_SCORE` | 0.06 | `ModeHybridRetriever.ts:158` | lexical arm | **Correctly derived** — the model to copy |
| `CONF_TOP_SCORE_FLOOR` | 0.30 | `ModeHybridRetriever.ts:167` | combined | Observe-only, documented as provisional |
| `CONF_MARGIN_MIN` | 0.05 | `:168` | top-2 margin | Observe-only |
| `CONF_CONFIDENT_FLOOR` | 0.45 | `:169` | combined | Observe-only |
| boost cap | 0.35 | `profile-retrieval-port.ts:606` | BM25-squashed | **Well-reasoned** |
| inventory admission | 0.6 | `profile-retrieval-port.ts:606` | policy, not similarity | **Correct by design** |
| Jaccard dedup | 0.6 | `answerPolish.ts:650` | set overlap | Reasonable |
| `REJECT_GROUNDING_THRESHOLD` | 0.5 | `OkfProfileVerifier.ts:54` | verifier score | Unvalidated |
| `REJECT_CONFIDENCE_THRESHOLD` | 0.3 | `OkfVerifier.ts:44` | card confidence | Unvalidated |
| `SENTENCE_REJECT_THRESHOLD` | 0.15 | `OkfVerifier.ts:49` | per-sentence | Unvalidated |
| OKF floor / band | 0.1 / `top·0.5` | `OkfProfileRetriever.ts:210,225` | IDF blend | Relative floor is a good pattern |

**Every threshold is a hard-coded module constant.** None is mode-specific, none is
embedding-space-specific, and only `MIN_LEXICAL_SCORE` is *derived* rather than chosen. Since the
active embedding space can be Gemini-768 **or** MiniLM-384 depending on whether the user has a
key, a single constant cannot be right for both — score distributions differ materially between
those spaces.

---

## 11. Hybrid Retrieval Opportunities

`ModeHybridRetriever` is the only true hybrid (BM25/FTS + cosine + cross-encoder rerank). It is
also the best-engineered retrieval code in the repo. The opportunity is **propagation, not
invention**:

| Target | Today | Opportunity | Note |
|---|---|---|---|
| V3 profile port | BM25 only | Add the cosine arm — `bm25.ts:108 scoreNormalized()` **already exists for exactly this** and has zero callers | Corpus is small; measure before assuming gain |
| `ModeContextRetriever` lexical path | Pure lexical | Already has a hybrid sibling; fix eligibility divergence instead of adding a third scorer | §6 |
| OKF cards | IDF blend | Cards are short and title-dominated; lexical is likely correct here | Low priority |

**Where lexical genuinely beats semantic in this product:** technical terminology, model names
(`OpenVLA-OFT`), tool names (`ROS#`), exact résumé/JD keywords, page markers. The entity-coverage
signal in `ModeContextRetriever` and BM25's rare-term weighting handle these better than cosine
would. Any hybrid must *keep* the lexical arm, not replace it.

---

## 12. Performance Analysis

**Do not trust unmeasured latency claims in this codebase.** Session memory
`wta-latency-measured-2026-08-07` records a prior report attributing "up to 14 seconds" to a
post-stream repair cascade; live measurement found post-stream to be **0–6 ms** and the entire
cost to be pre-first-token context assembly plus provider TTFT. The lesson applies directly here.

What can be stated from the code:

| Stage | Cost | Evidence |
|---|---|---|
| Query embedding | 1 network call (Gemini) or 1 local ONNX pass | `getEmbeddingForQuery` |
| Vector search, native | sqlite-vec `MATCH … ORDER BY distance LIMIT` | `VectorStore.ts:218` |
| Vector search, JS fallback | **O(n) full scan**, one cosine per stored chunk | `VectorStore.ts:294` |
| Cross-encoder rerank | 30 candidates ÷ batch 6 = **5 sequential forward passes** | `RERANK_BATCH_SIZE = 6` |
| Hybrid total | Hard-capped at 1000 ms (2000 ms doc-grounded), falls back on timeout | `LLMHelper.ts:5860` |

`RERANK_BATCH_SIZE = 6` is not a performance tuning choice — it is **crash mitigation**. The
comment records a 2026-07-06 SIGTRAP (`BFCArena::Extend → posix_memalign` in
`onnxruntime::Add<float>::Compute`) from a 30-pair forward pass on a 16 GB MacBook Air under
multi-ONNX + LLM streaming pressure. Cost: ~50–100 ms extra. **Any proposal to widen the rerank
pool must account for this crash, not just the latency.**

Similarly, `shouldUseLexicalForLocalManualQuery` (`ModeHybridRetriever.ts:790`) disables the
vector arm for manual turns on keyless installs specifically because running MiniLM ONNX per
keystroke-turn "stacks native ONNX arena pressure with STT/intent/LLM streaming."

**Implication: adding semantic scoring anywhere is not free on this platform.** Natively runs
multiple ONNX sessions (embedder, reranker, intent classifier) alongside live STT and LLM
streaming in one Electron process, and has already crashed from that pressure once.

---

## 13. Cross-Platform Findings

Per the repo's cross-platform contract, each semantic component was checked on both targets.

| Component | macOS | Windows |
|---|---|---|
| `sqlite-vec` native search | Yes — `sqlite-vec-darwin-arm64`, `-darwin-x64` pinned in `package.json` and force-installed by `scripts/ensure-sqlite-vec.js` | **Not pinned, not force-installed.** `sqlite-vec-windows-x64` exists upstream (0.1.9) but appears only via npm's own optional-dep resolution |
| JS cosine fallback | Yes | Yes — platform-neutral (`VectorStore.ts:744`) |
| Local MiniLM embedder | Yes | Presumed (onnxruntime-node ships both), **not verified here** |
| `bge-reranker-base` | Dev only | Dev only |

**`scripts/ensure-sqlite-vec.js` handles only the two darwin packages** (lines 14-15), and its
own header explains why the script exists: "npm skips optional deps with non-matching `cpu`
constraints, so we force-install them." That reasoning applies identically to Windows and is not
applied there. A native Windows `npm install` would likely resolve `sqlite-vec-windows-x64` on
its own; a **cross-built or CI-built Windows artifact would not**, and would silently degrade to
the O(n) JS cosine scan.

This is **graceful degradation, not a crash** — `VectorStore.ts:72` catches it and logs
"sqlite-vec not available, using JS cosine similarity fallback." So it is a performance and
verification gap, not a correctness bug. But it means **vector-search latency on Windows is
unverified**, and any latency budget calibrated on macOS native search may not hold there.

### Reranker bundling — the code comments are STALE; the model IS shipped

`LocalReranker.ts:15-18` states the model "is NOT bundled yet, so in a packaged build `load()`
fails," and `verify-packaged-local-assets.mjs:16` says "The bge reranker is OPTIONAL
(lazy-downloaded) and intentionally NOT checked here." **Both comments are contradicted by the
build code:**

- `scripts/download-models.js:17-20, 81-85` downloads `Xenova/bge-reranker-base` (q8,
  `model_quantized.onnx`, ~280 MB) at postinstall.
- `package.json` `extraResources` maps `resources/models/ → models/`, so it ships.
- `verify-packaged-local-assets.mjs:36-39` lists all four reranker files in
  **`REQUIRED_MODEL_FILES`**, and line 133 iterates that array as `'required model file'` with
  exit code 1 on absence — the same file's header claims it is not checked.
- `asarUnpack` covers `**/localRerankerWorker.js` and the full `onnxruntime-node` tree.

**Correction to an earlier draft of this report: the cross-encoder IS bundled and IS enforced by
the packaging gate on both platforms.** What gates it at runtime is the confidence trigger, not
model absence. Two stale comments in two files independently assert otherwise — worth fixing,
since one of them is the packaging contract's own documentation.

---

## 13b. Answer Generation Analysis — what happens AFTER retrieval

Relevance is used after retrieval, but **never semantically**. Tracing from packed context to
final answer:

| Stage | File | Mechanism | Semantic? |
|---|---|---|---|
| Context assembly / dedup | `combineRetrievalPorts` + `packContext` | **Exact** normalized-passage dedup | No |
| Prompt composition | `context-intelligence/generation/prompt-composer.ts` | Template + policy branches | No |
| Absence wording | `prompt-composer.ts` `noEvidenceNotice` | 3 deterministic branches on source state + `generalKnowledgeAllowed` | No |
| Last provider boundary | `context-os/finalPromptValidation.ts` | Fails closed on missing-required / forbidden-rendered | No |
| Legacy boundary | `validateAgainstSourceContract` | Unconditional path; both run | No |
| Post-stream dedup | `answerPolish.ts:650` | **Jaccard ≥ 0.6** on sentence token sets | Lexical |
| Claim persistence | `context-os` assistant_claims | Stores claims; no scoring | No |

**Verification point:** per `answer-policy-denial-branches-2026-08-07`, any check of what
actually reaches the model must be made at **`buildV3Prompt`** (engine-bridge), **never
`composePrompt`**. A prior round passed 90/90 composer-level tests while the live app still
denied every reported question.

### Should a second relevance calculation run between question and retrieved context?

**No — not as a filter.** Three reasons grounded in this codebase:

1. **It would re-introduce the P0 one layer later.** A post-retrieval semantic cut is the same
   "score everything, threshold it" pattern that is already misfiring in `scoreNode`.
2. **It cannot handle grounded absence.** The complete-inventory chunk admitted at a fixed 0.6
   (`profile-retrieval-port.ts:606`) exists precisely because the evidence proving "Kubernetes is
   not listed" *does not contain the word Kubernetes*. A question↔context similarity filter would
   discard exactly the evidence needed for correct negative answers.
3. **It costs an embedding call on the hot path.** §12 documents that this process already
   crashed (SIGTRAP) from concurrent ONNX pressure, and that `shouldUseLexicalForLocalManualQuery`
   *disables* the vector arm on manual turns for keyless installs for that reason.

**Where post-hoc semantic matching IS defensible:** claim↔evidence checking as an
*observe-only telemetry signal*, not a gate. The infrastructure already exists — `assistant_claims`
persists claims, and `EvidenceAssembler`/`OkfVerifier` already do lexical grounding verification
(`REJECT_GROUNDING_THRESHOLD = 0.5`, `SENTENCE_REJECT_THRESHOLD = 0.15`). Adding a cosine signal
alongside those, logged and never enforcing, would measure fabrication rate without risking a
false rejection. That is P3, and it must run off the hot path.

**A regex over answers can never prove non-fabrication.** The validated method in this repo is a
known-answer probe (`scripts/answer-policy-grounded-sweep.mjs`): supply evidence with deliberately
unusual values (17 percent, 250 seats, 14 March 2027), then ask one in-evidence and one
not-in-evidence question. That is decidable; similarity scoring is not.

---

## 13c. False Positives / False Negatives, by pair

| Pair | Failure | Mechanism | Would cosine help? |
|---|---|---|---|
| **Résumé vs JD** | FP — JD text answers a question about the candidate's own experience | Maximally similar by construction; similarity cannot separate them | **No.** Solved by `ModePolicy.profileSources` allowlist + `authorityOf` |
| **Thesis vs profile** | FP — "what methodology did I use?" pulls résumé | The task's own example. Mode-attached thesis and résumé both score well | **No.** Solved by scope filter; cosine would make it *worse* |
| **Behavioral / negotiation** | FP — irrelevant recent role admitted at cosine 0.583 (0.367 at the 0.42 gate) | §5 free floor, **live today** | Fixing the gate helps; more cosine does not |
| **Résumé, terse listing query** | FN — zero project nodes returned | Documented at `KnowledgeOrchestrator.ts:1467`; bypassed, not fixed | Fixing the gate would fix it properly |
| **Old vs recent work** | FN — older relevant project needs unreachable cosine 0.9167 | §5 inversion table | Yes — this IS the cosine fix |
| **Technical terms** (`ROS#`, `OpenVLA-OFT`, `C++`) | FN — embeddings blur rare tokens | — | **No.** BM25 + entity coverage already correct |
| **Coding questions** | FP — profile leaks into a coding answer | Answer-type gating, not similarity | **No.** Deterministic gate, correct |
| **Two résumé versions** | FP — superseded version retrieved | "Correctly almost identical" (`source-authority-policy.ts:101`) | **No — impossible.** Version metadata |

**Pattern:** every false *positive* in this product is a **source/authority** problem that
similarity cannot solve and would worsen. Every false *negative* is a **threshold-arithmetic**
problem that the existing cosine signal would solve if it could fire. This asymmetry is the
strongest single argument for the recommended plan.

---

## 13d. Résumé ↔ JD Matching (task §15)

**Can Natively compute résumé ↔ JD similarity today? Not as a first-class score.** What exists:

- `jdRequiredSkills` is passed into `scoreNode` and contributes a **flat +0.15**, capped at one
  boost per node (`HybridSearchEngine.ts:139-151`) — a binary "any skill matched" flag, not a
  match score.
- `roleInsight/CoverageCalculator.ts:265` bands a coverage score (`>= 0.8 → 'high'`).
- `roleInsight/EvidenceRetriever.ts` retrieves "deliberately WIDER than the app's answer path."
- `ProfileCardTemplates`/`buildSourceText` **drop `compensation_hint` and
  `min_years_experience`** from the structured JD (per `v3-profile-source-routing-fix-2026-07-31`)
  — no card carries the salary band, so any consumer needing full fidelity must render from
  `structured_data`, not cards.

**Assessment: this is a product feature, not a retrieval fix.** A useful résumé↔JD score is
*hybrid and decomposed*, and pure cosine is the wrong shape because a single scalar cannot answer
the question users actually have ("what am I missing?"):

```
skill overlap        — set intersection over CategorizedSkills (deterministic, explainable)
missing skills       — set difference, JD requirements \ résumé skills   ← the valuable half
experience relevance — years/seniority vs min_years_experience (numeric, NOT semantic)
semantic similarity  — cosine, for narrative fit only
```

`CategorizedSkills` (languages/frameworks/cloud/databases/ml/devops/tools) plus
`categorizeFlatSkills` already exist from the P1 skills work and make the set operations trivial.
The **missing-skills** term is the one users care about and is pure set difference — cosine
cannot produce it. **P2, and scope it as a feature with its own UI, not as a retrieval change.**

---

## 13e. Recommended Architecture (described, not implemented)

The target differs from today in four places only. Everything else stays.

```
USER QUESTION
     │
     ▼
MODE — explicit, DB-persisted                          ◄── UNCHANGED (correct)
     │
     ▼
SOURCE DECISION — deterministic policy                 ◄── UNCHANGED (correct)
  turnSourceDecision(contract, explicitRequests, availability)
     │
     ▼
SCOPE FILTER — hard prison                             ◄── UNCHANGED (correct)
  filterByScopeAndVersion → OUT_OF_SCOPE / SUPERSEDED / UNAUTHORIZED
     │
     ▼
┌─ CHUNK RETRIEVAL — per corpus ──────────────────────────────────────┐
│                                                                      │
│  ADMIT  ← semantic floor, per embedding space        ◄── CHANGE 1   │
│           cosine ≥ FLOOR[spaceKey]                                   │
│           OR policy-admitted (complete inventory @ 0.6) ◄ PRESERVE  │
│           OR lexical/entity hit (exact terms)         ◄ PRESERVE    │
│                                                                      │
│  RANK   ← blended score (all existing boosts)        ◄── CHANGE 2   │
│           boosts ORDER candidates; they never ADMIT them            │
│                                                                      │
│  RERANK ← ONNX cross-encoder on low confidence       ◄── UNCHANGED  │
└──────────────────────────────────────────────────────────────────────┘
     │
     ▼
ONE retrieval entry point per corpus                   ◄── CHANGE 3
  (today: two LLMHelper call sites disagree on hybrid eligibility)
     │
     ▼
CONTEXT ASSEMBLY — exact dedup                         ◄── UNCHANGED
     │
     ▼
FINAL PROMPT VALIDATION — fail closed                  ◄── CHANGE 4
  (today: enforcing only when contextOs* flags ON)
     │
     ▼
LLM ──► post-stream Jaccard dedup                      ◄── UNCHANGED
     │
     └──► claim↔evidence cosine, OBSERVE-ONLY, off hot path  ◄── OPTIONAL (P3)
```

**The four changes:**

1. **Admission ≠ ranking.** A semantic floor decides *whether* a chunk may be seen; boosts decide
   *what order*. This removes both the unreachable gate and the query-independent contamination
   floor in one predicate, without retuning a single weight.
2. **Thresholds keyed by `embeddingSpaceKey`.** Gemini-768 and MiniLM-384 need different floors;
   follow the `MIN_LEXICAL_SCORE = MIN_COMBINED_SCORE · FTS_WEIGHT` derivation already in the repo.
3. **One retrieval entry point per corpus.** Identical questions must not retrieve differently by
   call site or machine load.
4. **Final validation enforcing in production**, not observe-only — or an explicit, documented
   decision that it stays advisory.

**Invariants any implementation must preserve:** never compare across embedding spaces; never let
similarity influence source selection, mode routing, or version filtering; never let a similarity
floor block policy-admitted absence evidence; never widen the rerank pool without accounting for
the ONNX arena crash.

---

## 14. Cosine Opportunity Map

| Location | Current method | Cosine useful? | Priority | Risk | Recommendation |
|---|---|---|---|---|---|
| `HybridSearchEngine.scoreNode` | 0.6·cosine + 1.35 boosts, gated at 0.55 | **Already there, cannot fire** | **P0** | Low | Split admission (cosine floor) from ranking (blend). Do not retune 0.55 |
| Mode ref files — eligibility split | Hybrid at one site, lexical at the other | N/A — consistency bug | **P1** | Low | Unify `wantHybrid` across `LLMHelper.ts:2800` and `:5854` |
| V3 profile port | BM25 only | **Yes** — `scoreNormalized()` is already written for it | P1 | Med | Wire the dead fusion helper; measure on a real corpus first |
| Thresholds (all) | Hard-coded constants | N/A | P1 | Low | Make them embedding-space-aware; only `MIN_LEXICAL_SCORE` is derived today |
| Meeting RAG | True cosine, `minSimilarity` 0.25 | Already correct | P2 | Low | Justify 0.25 empirically or derive it |
| Source selection | Deterministic policy | **No** | — | — | **Leave alone.** Correct as-is |
| Mode routing | Explicit DB row | **No** | — | — | **Leave alone** |
| Grounded absence | Policy admission at 0.6 | **No — impossible** | — | — | **Leave alone**; preserve under any refactor |
| Answer dedup | Jaccard 0.6 | Marginal | P3 | Low | Fine at n≈10 sentences |
| Résumé ↔ JD matching | JD skills as a +0.15 boost only | Partially | P2 | Med | A dedicated hybrid score (skill overlap + gap analysis + cosine) is a *feature*, not a retrieval fix |
| Answer grounding | Post-hoc validators | Possibly | P3 | High | Claim↔evidence semantic matching is attractive but adds an embedding call to the hot path — see §12 |
| Levenshtein ×3, Jaccard ×2 | Duplicated | N/A | P3 | Low | Consolidate |

---

## 15. Tech Debt Register

1. `bm25.ts:108 scoreNormalized()` — written for cosine fusion, **zero callers**. Dead or unfinished.
2. Three Levenshtein implementations (`ModeContextRetriever.ts:190`, `retrievalTextMatch.ts:8`,
   `IntentClassifier.ts:102`).
3. Two Jaccard implementations (`answerPolish.ts:515`, `speculativeSimilarity.ts:22`).
4. Two cosine implementations (`VectorStore.ts:744` BLOB-optimized, `HybridSearchEngine.ts:24`
   array-based) plus a third in `ModeHybridRetriever.ts:749`.
5. Two profile retrievers with different metrics (V3 BM25 port vs legacy premium cosine engine),
   both apparently live.
6. `RETRIEVAL_THRESHOLD = 0.42` in `roleInsight/EvidenceRetriever.ts` is a second arbitrary
   constant on the same broken scale as `RELEVANCE_THRESHOLD`.
7. **Two stale comments assert the reranker is not bundled** — `LocalReranker.ts:15-18` and
   `verify-packaged-local-assets.mjs:16` — while the same verify script lists it in
   `REQUIRED_MODEL_FILES` and fails the build without it. One of these is the packaging
   contract's own documentation. Correct the comments, not the code.
7b. The P0 scorer was **diagnosed and routed around, not repaired**
   (`KnowledgeOrchestrator.ts:1467`). The bypass covers six answer types; three still use it.
8. `sqlite-vec` force-install script is macOS-only (§13).
9. Flag-gated-and-off is pervasive (`contextOsEnforceSourceCapabilities`, `contextOsPropertyValidation`,
   `answerDiversityGuard`, `PROFILE_GROUNDING_V2`). **Several mechanisms this report describes as
   "present" are present-but-inactive in production.** Verify each flag's live default before
   assigning priority.

---

## 16. Priority Matrix

**P0 — correctness**
- Cosine gate unreachable in `HybridSearchEngine.scoreNode`; query-independent recency/tenure floor
  admits irrelevant nodes (§5).

**P1 — major relevance improvement**
- Unify hybrid eligibility between `LLMHelper.ts:2800` and `:5854` (§6).
- Make thresholds embedding-space-aware (§10).
- Wire `scoreNormalized()` into the V3 profile port, if measurement justifies it (§11).
- Confirm whether `finalPromptValidation` runs enforcing or observe-only in production (§9 C4).

**P2 — meaningful optimization**
- Windows `sqlite-vec` pinning + force-install parity (§13).
- Derive `minSimilarity = 0.25` empirically.
- Résumé ↔ JD hybrid scoring as a product feature.

**P3 — optional**
- Consolidate duplicate Levenshtein / Jaccard / cosine implementations.
- Claim↔evidence semantic grounding (weigh against §12 latency and ONNX pressure).

---

## 17. Proposed Implementation Plan (phased, not implemented)

**Phase 0 — Measure before changing anything.**
Instrument `scoreNode` to log `(cosine, boostSum, finalScore, admitted)` per candidate on real
queries. Confirm the §5 arithmetic empirically. Run in a **real Electron main process**
(`npx electron scripts/…`) — a bare-node or multi-bundle harness can report stale-cache behavior
(§9 C6), and `app.getPath('userData')` is unavailable under `ELECTRON_RUN_AS_NODE`. Also
determine the live default of `PROFILE_GROUNDING_V2`: if it is ON and bypasses this path for the
main answer flow, Phase 1's blast radius shrinks to `roleInsight`.

**Phase 1 — Split admission from ranking in `scoreNode`.** One predicate. Tests: cosine-0 +
full-boosts must be rejected; cosine-0.85 + no-boosts must be admitted. No boost weight changes.

**Phase 2 — Unify hybrid eligibility.** Make `wantHybrid` a single shared helper. Add a test that
drives both entry points with the same question and asserts identical retrieval.

**Phase 3 — Space-aware thresholds.** Key each similarity threshold by `embeddingSpaceKey`,
following the `MIN_LEXICAL_SCORE` derivation pattern. Calibrate Gemini-768 and MiniLM-384
separately.

**Phase 4 — Wire the BM25 ↔ cosine fusion** in the V3 profile port, gated behind a flag,
**only if** Phase 0 measurement shows BM25-only is actually missing relevant chunks. The profile
corpus is ~2KB; `profile-grounding-rewrite-2026-06-04` concluded retrieval is the wrong tool at
that scale. This phase may correctly end in "no change."

**Phase 5 — Windows verification.** Pin `sqlite-vec-windows-x64`, extend `ensure-sqlite-vec.js`,
and measure vector-search latency on a real Windows build.

Each phase is independently revertible. Phases 1–3 touch no source-selection code and therefore
cannot introduce contamination.

---

## 18. The Critical Final Question

> If we wanted Natively to have world-class semantic retrieval and context selection, what are
> the most important changes, in what order?

1. **Make the cosine gate in `HybridSearchEngine.scoreNode` reachable** by separating admission
   from ranking. Today a node needs cosine > 0.9167 to be retrieved on merit, while any recent
   long-held role carries a free +0.20 and is admitted at cosine 0.583. This is the single
   highest-value correctness change and it *removes* a contamination path rather than adding a
   mechanism.
2. **Measure before you touch it** (Phase 0), in a real Electron main process. Two prior sessions
   in this repo produced confidently wrong numbers from harnesses — a "14 second" latency that was
   6 ms, and per-bundle singletons that made a mode-contamination bug invisible to single-copy tests.
3. **Unify hybrid eligibility across the two `LLMHelper` call sites.** Identical questions
   currently get different retrieval depending on entry point and machine load.
4. **Make every similarity threshold embedding-space-aware.** The active space is Gemini-768 or
   MiniLM-384 depending on whether the user has a key; one constant cannot serve both. Follow the
   `MIN_LEXICAL_SCORE = MIN_COMBINED_SCORE · FTS_WEIGHT` derivation already in the codebase.
5. **Leave source selection, mode routing, version filtering, and grounded-absence admission
   exactly as they are.** They are deterministic, they are correct, and cosine would actively
   damage all four. The `filterByScopeAndVersion` comment and the complete-inventory 0.6
   admission are the two best pieces of retrieval reasoning in this repo.
6. **Fix the two stale comments claiming the reranker is unbundled.** It *is* shipped and *is*
   enforced by `verify-packaged-local-assets.mjs`'s required list — but `LocalReranker.ts:15-18`
   and that script's own header both say otherwise, which is how a team talks itself out of using
   the strongest semantic signal it already ships.
7. **Consider BM25 ↔ cosine fusion in the V3 profile port last, and be willing to conclude "no."**
   `scoreNormalized()` is already written for it, but the profile corpus is ~2KB and a prior
   session established that vector RAG at that scale *caused* the failures it was meant to fix.

The through-line: **Natively's relevance architecture is conceptually right and arithmetically
wrong.** The mechanisms are correctly chosen and correctly placed; the defects are thresholds
applied to the wrong scale, a dead fusion helper, and two call sites that disagree. Fixing
arithmetic is cheaper, safer, and higher-value than adding embeddings.

---

## Validation Statement

- `Reviewed but not executed on macOS` — all findings are from static trace of source.
- `Reviewed but not executed on Windows` — no Windows execution available.
- `Requires physical macOS verification` — §5 arithmetic (Phase 0 instrumentation).
- `Requires physical Windows verification` — §13 `sqlite-vec` availability and vector-search latency.
- **No tests were run. No code was modified. No benchmarks were executed.**
- Latency figures in §12 are read from code comments and prior *measured* sessions; none was
  re-measured here.

**Verified during this audit (not assumed):**
- `PROFILE_GROUNDING_V2` default state — **ON** (`profileGroundingV2.ts:41`, kill-switch model),
  and it bypasses the P0 scorer for exactly six answer types (`KnowledgeOrchestrator.ts:1566-1576`).
  Behavioral / jd_fit / negotiation / roleInsight still use it.
- §5 and §5-reachability arithmetic — replicated numerically from lines 109-179 and 230 for both
  the 0.55 and 0.42 thresholds.
- Reranker bundling — **shipped and enforced**; two in-repo comments claiming otherwise are stale.

**Still undetermined — affects priority, not correctness of findings:**
- Live default state of `contextOsEnforceSourceCapabilities`, `contextOsPropertyValidation`, and
  `answerDiversityGuard` (bears on §9 C4 and §16 P1 ordering).
- Whether `isRagLocalRerankEnabled()` defaults on, which decides how often the §6 eligibility
  divergence is actually observable.

**Correction made during this audit:** an earlier draft asserted the cross-encoder "does not run
in production on either OS," sourced from a single code comment. The build configuration
contradicts it; the claim was wrong and has been reversed.

### Commands executed

Read-only inspection only: `grep`, `sed`, `wc`, `ls`, `git log`, and one `python3` invocation to
parse `node_modules/sqlite-vec/package.json`. No build, no test, no write to tracked files.
