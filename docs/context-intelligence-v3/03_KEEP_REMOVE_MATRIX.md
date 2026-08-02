# Phase 2 — Keep / Remove Matrix

**Status:** PARTIAL — verdicts backed by measurement where §8.2 could be executed; everything else is explicitly marked *insufficient evidence*.
**Date:** 2026-07-29
**Evidence base:** `02_RETRIEVAL_BENCHMARK.md` §6 (executed run) and `01_INVESTIGATION_REPORT.md` (reachability).

---

## Rule applied throughout

> A component that could not be benchmarked is **not thereby a remove candidate.**

Every verdict below cites either a measured number or a reachability fact. Where neither exists, the verdict is `INSUFFICIENT EVIDENCE` and the component is carried forward, not deleted. §28 additionally gates all removal on acceptance gates passing — which, per F21, cannot currently be evaluated. **Nothing in this matrix authorises deletion today.**

---

## 1. Retrieval scoring components

| Component | Verdict | Evidence |
|-----------|---------|----------|
| `computeFtsScore` (the "FTS/BM25" scorer) | **REPLACE** | Measured: R@1 **40.0** vs **63.3** for real BM25 on the identical pool. Implementation verified as de-duplicated term overlap with no TF, IDF, or length prior. |
| Real BM25 | **ADOPT (new)** | Best R@1 (63.3), 11 ms p50, less than half the stale-version rate of semantic (23.8 vs 54.8). |
| Semantic vector retrieval | **KEEP, but never alone** | Best-in-class only at R@1 among incumbents (60.0); **worst stale-version rate at 54.8%**. Essential for paraphrase (A-03, A-11) but must be filtered, not trusted. |
| Hybrid fusion (`combinedScore`, `FTS_WEIGHT=0.4`) | **KEEP, re-tune after BM25 swap** | Best R@3/R@5/P@3 (83.3/83.3/33.3). Weight was tuned against the *broken* lexical arm, so 0.4 is not justified once the arm is replaced. |
| `MIN_COMBINED_SCORE = 0.15` adaptive floor | **KEEP but relocate** | The floor discards candidates that top pure-vector (§4A.3). Belongs in evidence evaluation where it can be reasoned about, not buried in the ranker. |
| `LocalReranker` | **INSUFFICIENT EVIDENCE** | Not run. Only engages on low-confidence queries; on high-confidence queries it is byte-identical to config 5. Requires bucketed measurement before any verdict. |
| `RrfFusion` | **REMOVE (reachability, not quality)** | `ragRrfFusion` defaults false everywhere; nothing in the mode-document path calls it. Consulted only from `SearchOrchestrator`. Dead for document retrieval. |
| `SearchOrchestrator` | **KEEP — out of scope** | Not a document retriever; a fusion engine over already-fetched candidates, reachable via its own IPC. Unaffected by this rebuild. |

## 2. Structural / entity signals

| Component | Verdict | Evidence |
|-----------|---------|----------|
| Entity fusion in `scoreChunk` (0.55/0.45) | **INSUFFICIENT EVIDENCE** | Not isolable — no standalone retriever exists, extractors unexported, gated on `forceDocumentGrounding`. Cannot be measured without reimplementation, which would measure the reimplementation. |
| `DocumentMap` (`resolveTargetSections`, `selectTableOfContentsEntries`) | **KEEP** | Exported, self-contained, and the only structural-routing surface. Corpus contains heading-dependent questions (F-08, A-13) it is designed for. Benchmark it in Phase 8. |
| `answerabilityScore` / `answerabilityBoosts` / `rerankScore` | **KEEP + WIDEN THE TYPE** | Computed on `ChunkCandidate` then **dropped** at the `ModeRetrievedChunk` boundary, so no consumer — including `EvidenceResolver` — can see them. Purely additive fix; values already exist at the return site. |

## 3. Knowledge / profile layers

| Component | Verdict | Evidence |
|-----------|---------|----------|
| `ProfileTreeService` | **REMOVE as a retrieval/routing layer** | Reachability, not quality: gated behind `profileTreeV2` which defaults **false in production *and* dev/test**. Returns a JIT *prompt string* — no ids, no scores, no ranking. Cannot participate in ranked retrieval by construction. |
| `selectManualProfileEvidence` | **KEEP — this is the real profile retriever** | Returns typed, source-tagged, confidence-bearing `ProfileEvidenceItem[]`. Set-retrieval, so score it with set precision/recall, not nDCG. Live on 9 importers. |
| Graph RAG (`GraphRetriever`, `expandGraph`) | **INSUFFICIENT EVIDENCE — leaning REMOVE** | Not run: relations are built at pack-generation time, so the flag must be set *at ingest*, and it has never been on in production — no live pack has relations. `GraphExpansionHit` carries **no score**. §8.9 requires demonstrated multi-hop benefit; none has been demonstrated because it has never run. Re-ingest and measure before deleting. |
| OKF card retrieval (`queryOkfCards`) | **KEEP** | Genuinely entity/title-weighted with explicit scoring. The natural home for config 3b. |
| Tier-2 OKF provenance (`sourceQuotes`, `contentHash`, `packVersion`) | **KEEP AND PROMOTE** | The only content-hash versioning in the system, and §6.2 shows version isolation is the dominant risk. Currently off in production — that is the defect, not the design. |
| Hindsight (`LongTermMemoryService.recallRelevantMemory`) | **INSUFFICIENT EVIDENCE — restrict regardless** | Not runnable offline. Independent of measurement, §8.8 already forbids it being authoritative for resume/JD/document claims, and `hindsightEvidence.ts` hard-codes `validated=false`. Keep as scoped conversation continuity; never as an evidence source. |

## 4. Evidence plumbing

| Component | Verdict | Evidence |
|-----------|---------|----------|
| `EvidenceResolver` | **KEEP — build config 11 on it** | Already returns the target shape (`pack`, `strategy`, `attempted/retrieved/rejectedSources`, `confidence`) and takes its retrieval dependencies as **injected interfaces**. |
| `EvidenceItem` | **KEEP + ADD `scopeId`** | §6.2 makes this load-bearing: stale-version retrieval is the top measured risk and the type cannot currently express the filter that fixes it. |
| `meetingChunksToEvidenceItems` | **KEEP — WIRE IT** | Complete and tested with **zero production callers**; live meeting RAG bypasses the evidence contract entirely. Removal would be exactly backwards. |
| `assistantClaims` / precedence check | **KEEP — WIRE IT + ENABLE** | One call site, and `assistantClaimsEnforcement` is off in production, so the model's own prior output is re-injected without provenance on 6 of 9 surfaces. |
| `knowledgeOrchestratorGate`, `deleteProfileTransactional` | **INSUFFICIENT EVIDENCE** | Zero importers / zero production callers. Built and tested but never wired. Decide during Phase 4 whether the rebuild subsumes them; do not delete blind. |

## 5. Cross-cutting removals justified by reachability alone

These need no benchmark — the evidence is that they cannot affect behaviour, or that they duplicate a responsibility the rebuild centralises.

| Target | Evidence |
|--------|----------|
| Duplicate source-decision sites (5 for 9 surfaces) | F2. The rebuild defines exactly one. |
| Renderer-side prompt + grounding policy (`skipSystemPrompt: true`) | F3. A grounding policy hardcoded in a React component. |
| Untagged stream-event emitters | F4, reproduced. Every early-return path is un-supersedable. |
| The 8 independent answerability implementations | F15. |
| Server-side prompt-text regex model routing | F7. A cross-repo English-string dependency with no test or shared constant. |
| Checked-in compiled `.js` twins in `src/components/` | F3. Source-of-truth ambiguity. |

---

## 6. What this matrix does NOT authorise

1. **No deletion today.** §28 gates removal on §27 acceptance gates, which are unmeasurable while F21 stands.
2. **Six of eleven configurations were never executed.** Their components carry `INSUFFICIENT EVIDENCE` and must not be read as remove candidates.
3. **The working tree is shared and drifted twice during this investigation.** Any removal must re-verify reachability at the time of removal, not rely on this document's snapshot.
4. **`03` should be revisited after Phase 4**, when config 11 exists and can be measured against the same corpus — that comparison is the actual justification for retiring the legacy path.
