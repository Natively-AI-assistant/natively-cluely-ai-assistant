# Phase 3 — Target Architecture

**Status:** COMPLETE (contract definition). Implementation is Phase 4.
**Date:** 2026-07-29
**Scope decision (owner, 2026-07-29):** clean-room rebuild of the **decision + orchestration layer only**. Ingestion, embeddings, `VectorStore`/sqlite-vec, chunking, the provider gateway, STT, auth, billing and updates are **REUSED AS-IS**.

---

## 1. What the evidence requires this architecture to do

Three measured/verified findings constrain the design more than anything in the original brief. They are stated first because each one kills an otherwise-obvious design.

**(1) Version isolation must be a filter, not a score.** Measured: pure semantic retrieval surfaced a superseded resume version on **54.8%** of questions; the hybrid production weighting on **47.6%**. `resume_v1` and `resume_v2` are genuinely near-identical semantically, so no reranker, fusion weight, or better embedding model can separate them. ⇒ **Scope and version are applied as a pre-scoring filter, and `EvidenceItem` must carry `scopeId`.**

**(2) The retriever has no notion of "should I run".** It always returns a ranked pool. ⇒ **The fast/grounded/verification decision cannot live in retrieval; it belongs to the immutable turn decision above it.**

**(3) Unadopted architecture is this codebase's dominant failure mode.** `composePrompt` has zero call sites; `resolveCanonicalTurn` one; `meetingChunksToEvidenceItems` zero; `assistantClaims` one and disabled in production. The mechanism was the **dev-vs-prod flag split** (20 of 62 flags resolve differently). ⇒ **`contextIntelligenceV3` MUST default identically in dev and production.** If it is ever written as `isInternalDevTestContext`, the rebuild has recreated the disease.

---

## 2. Runtime shape

```
AnswerRequest  (typed, one shape for every surface)
      ↓
Request normalization          — surface-specific → canonical
      ↓
Question resolution            — ONCE. manual > selection > transcript > follow-up
      ↓
Mode policy resolution         — one declarative registry
      ↓
Turn classification + claim planning
      ↓
╔═══════════════════════════════════════════╗
║  TurnDecision   (deep-frozen, immutable)  ║
╚═══════════════════════════════════════════╝
      ↓
Scope/version FILTER  →  Targeted retrieval (only if the plan says so)
      ↓
Evidence evaluation  →  controlled retry (max 2)
      ↓
Claim-level answer plan
      ↓
Context packing (budgeted, deterministic)
      ↓
Canonical prompt composition
      ↓
Model gateway (provider-neutral)
      ↓
Response validation → streaming (sequence-guarded)
      ↓
AnswerTrace
```

**One implementation per box.** The measured justification for that constraint is F15: eight independent implementations of "answerability" exist today, so §32.11 ("retrieval failure is not proof of absence") cannot be enforced anywhere.

---

## 3. Module layout

Adapted to this repository's conventions; `electron/context-intelligence/`.

```
context-intelligence/
  contracts/        answer-request.ts · turn-decision.ts · evidence.ts
                    claim-plan.ts · mode-policy.ts · trace.ts
  policies/         mode-policy-registry.ts · source-authority-policy.ts
                    grounding-policy.ts · capability-policy.ts
  question/         question-resolver.ts · conversation-state.ts · turn-classifier.ts
  retrieval/        unified-retriever.ts · scope-filter.ts · bm25.ts
                    semantic.ts · fusion.ts · adjacent-context.ts · reranker.ts
  evidence/         evidence-evaluator.ts · conflict-resolver.ts · retry-planner.ts
  generation/       claim-planner.ts · context-packer.ts · prompt-composer.ts
                    response-validator.ts
  orchestration/    orchestrator.ts · request-lifecycle.ts
  observability/    answer-trace.ts
```

### 3.1 What is deliberately NOT rebuilt

| Reused as-is | Why |
|--------------|-----|
| `SafeDocumentTextExtractor` | Works; already the shared extractor for modes + profile. |
| `EmbeddingPipeline`, `EmbeddingProviderResolver` | Works offline with bundled MiniLM; provider cascade is sound. |
| `VectorStore` / sqlite-vec | Verified loading natively; already refuses cross-space search. |
| Chunking (`ModeHybridRetriever.chunkText`, `DocumentMap`) | `DocumentMap` is the only structural-routing surface and is exported. |
| `ProviderRouter` / model gateway | Out of scope per §32.22. |

**One exception worth flagging:** `EmbeddingPipeline` crashes the process (SIGTRAP) on a 128k-char document (F22). Reuse does not mean "unexamined" — that is a P1 bug the rebuild will inherit and must not paper over.

---

## 4. Ordering constraint that overrides the brief's §25.3

§25.3 lists surface migration first. **That order is not executable here.**

Two of three decision layers produce no structured artefact, so shadow mode (§25.2) and cross-surface parity (§21.4) have nothing to diff. Therefore:

> **`AnswerTrace` emission is the first architectural deliverable**, retrofitted to the legacy layers *before* any surface migrates. Without it there is no way to demonstrate the new path matches the old, and the migration becomes unverifiable — which is precisely how the previous attempts failed.

---

## 5. The retrieval design the benchmark actually supports

```
authorized sources (from TurnDecision)
      ↓
SCOPE + VERSION FILTER          ← metadata, pre-scoring, non-negotiable (§1.1)
      ↓
   ┌──────────────┬──────────────┬────────────────────┐
   │  semantic    │  real BM25   │  heading / entity  │
   └──────┬───────┴──────┬───────┴─────────┬──────────┘
          └──────── deterministic fusion ──┘
                          ↓
          optional rerank (low-confidence only, timeout-bounded)
                          ↓
             adjacent / parent context expansion
                          ↓
                  evidence evaluation
```

Justification per component, from measured results:

| Component | Keep? | Measured basis |
|-----------|-------|----------------|
| Scope/version filter | **required** | 54.8% stale-version on semantic; unfixable by ranking |
| Real BM25 | **required** | R@1 63.3 vs 40.0 for the shipped scorer |
| Semantic | required, never alone | needed for paraphrase; worst stale rate |
| Fusion | keep, **re-tune** | best R@3/P@3 (83.3/33.3), but weight was tuned against a broken lexical arm |
| Heading/entity | keep | not isolable today; `DocumentMap` is exported and the corpus exercises it |
| Rerank | optional, gated | **not measured** — must be bucketed by low-confidence before any verdict |

---

## 6. Non-negotiables

1. `TurnDecision` is deep-frozen. No adapter, prompt builder, retriever, UI surface, or fallback handler may reinterpret it.
2. General model knowledge is a **capability**, not a retrieved source.
3. Grounding policy governs fallback; it does not select sources.
4. Modes **authorize** source types; they do not force them into every answer.
5. Retrieval decides relevance **within** authorized sources; it never decides whether general knowledge is permitted.
6. Every evidence item carries `sourceId`, `versionId`, **`scopeId`**, authority, and direct-vs-inferred.
7. A policy-resolution failure fails **closed** to a declared default — never to "mode-blind" (the defect in `buildRecapFollowUpContract`).
8. Every stream event carries request identity. **No untagged emitter is permitted**, including error paths (F4).
9. `contextIntelligenceV3` resolves identically in dev and production (§1.3).
