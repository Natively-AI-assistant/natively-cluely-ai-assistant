# Phase 9 — Legacy Removal Matrix

**Status:** PARTIALLY EXECUTED (2026-07-30) — see §5. The blocking chain in §4 is cleared; one removal performed, and the rest **re-verified as NOT dead**.
**Date:** 2026-07-29, revised 2026-07-30

---

## 1. Why nothing was deleted

Two independent reasons, either sufficient on its own.

**(1) The brief gates it.** §28 opens with *"After acceptance gates pass"*. The §27 gates require a measurable test suite. Per **F21**, `npm test` cannot terminate — test files that import `IntentClassifier` pass every assertion and then never exit, because a worker thread holds the event loop open. `unref()` on the worker and on its stdio was attempted and **falsified**; `process._getActiveHandles()` still shows `[Socket, Socket, MessagePort]`. A real disposal lifecycle is required. Until that lands, **no acceptance gate can be evaluated, so the precondition for removal is unmet.**

**(2) The working tree is shared and actively changing.** During this single session the tree drifted twice without my involvement: `NativelyInterface.tsx` was reverted mid-session, and `README.md`, `ProviderCard.tsx`, `proHarness.*`, `plansHarness.*` appeared. Deleting files another agent is editing produces a conflict nobody can reconstruct afterwards.

This document therefore records **what to remove and under what condition** — the §28 deliverable — without executing any of it.

---

## 2. Removal candidates, with evidence and conditions

Grouped by what unblocks them.

### 2.1 Removable on reachability alone (no benchmark needed)

These cannot affect behaviour today; the evidence is structural.

| Target | Evidence | Condition to remove |
|--------|----------|---------------------|
| `submit-manual-question` IPC + `runManualAnswer` | Registered and reachable, **zero renderer callers**, and applies no source authority whatsoever | Confirm no external consumer (phone mirror, e2e) — then delete rather than migrate |
| `RrfFusion` | `ragRrfFusion` false everywhere; nothing in the mode-document path calls it | Confirm `SearchOrchestrator` is out of scope, then delete |
| `promptComposer.composePrompt` **or** its replacement | **Zero call sites.** Either wire it or delete it — what must not persist is a third composer | Phase 4 decides which; the other goes |
| `PromptAssemblerV2` | `ipcHandlers.ts:1424` hardcodes `prompt_assembler_v2_mode: 'off'` | Delete with the composer decision |
| `ProfileGraphExtractor`, `OkfCardEditor` | Flags `false` in every context | Delete unless Phase 8 measures Graph RAG favourably |
| Checked-in compiled `.js` twins in `src/components/` | Duplicate call sites at different line numbers; bundler resolution order decides which wins | Verify the bundler entry, then delete the `.js` |

### 2.2 Removable only after the new path is measured

| Target | Blocking evidence | Condition |
|--------|-------------------|-----------|
| Five duplicate source-decision sites | The WTA pair (`:1763` / `:2028`) straddles `resolveCanonicalTurn`; the earlier call **gates fetches feeding the later one** | Reorder, not a cut. Requires `AnswerTrace` parity on both before touching |
| `_geminiChatStreamHandler` inline logic (~3 690 lines) | Highest-effort item in the migration; it is an extraction | Manual Chat migrated + trace parity green |
| Eight answerability implementations | F15 | Config 11 measured against the same corpus |
| `computeFtsScore` | Measured inferior (R@1 40.0 vs 63.3) | Replaced by `retrieval/bm25.ts`, then deleted — not before |
| Renderer-composed prompts + `skipSystemPrompt: true` | A grounding policy hardcoded in a React component | Overlay migrated to the orchestrator |
| Legacy Knowledge Source selector state | UI simplification (Phase 7) | After answer-policy control ships |

### 2.3 Explicitly NOT removal candidates

Recorded because a careless reading of "dead code" would delete exactly the wrong things.

| Target | Why it stays |
|--------|--------------|
| `meetingChunksToEvidenceItems` | Complete, tested, **zero production callers**. Still NOT a removal candidate, but the reasoning changed (2026-07-30): V3 now has its own meeting port, and it deliberately does not use this adapter because that would put a second evidence contract on one answer. This one remains the Context OS path's adapter — wire it there, or retire it with that path, but do not delete it as "dead" while Context OS still owns surfaces |
| `assistantClaims` + precedence check | One call site and disabled in production. Wire and enable |
| Tier-2 OKF provenance | The only content-hash versioning in the system, and §6.2 proved version isolation is the top measured risk |
| `EvidenceResolver` | Already returns the target shape with injected dependencies — config 11 is built on it |
| `DocumentMap` | Only exported structural-routing surface |
| `knowledgeOrchestratorGate`, `deleteProfileTransactional` | Zero callers, but they implement gaps that remain open. Decide during Phase 4; do not delete blind |
| Graph RAG | `INSUFFICIENT EVIDENCE`. Never run in production, so absence of measured benefit is not evidence of absence |

---

## 3. Mandatory pre-removal procedure

For every item, at the time of removal — not from this document's snapshot:

1. `/usr/bin/grep -ra` for all references. **Plain `grep` is unsafe in this repo**: four files are misdetected as binary and silently produce false negatives (`TurnEvidenceCoordinator.ts`, `HeuristicExtractor.ts`, `card.tsx`, `WtaOutputShapeWiring.test.mjs`). Prior audits produced false DEAD verdicts this way.
2. Re-diff the working tree; confirm no other agent is editing the file.
3. Run the full suite — which requires F21 fixed.
4. Confirm no active entry point depends on it, via `AnswerTrace`, not static reading alone.
5. Add a regression test that prevents the pattern returning (§28).

---

## 4. Ordered unblock chain

```
F21 disposal fix
      ↓
suite terminates → §27 gates become measurable
      ↓
AnswerTrace on legacy layers → parity diffable
      ↓
config 11 measured vs the same corpus
      ↓
gates pass
      ↓
removal §2.1 → §2.2, each with its own regression test
```

**Nothing below the first arrow can proceed today.**


---

## 5. Execution, 2026-07-30

### 5.1 The §4 unblock chain is cleared

| Link | State |
|---|---|
| F21 disposal fix | **DONE** — suite terminates (67 s) |
| suite terminates → gates measurable | **DONE** |
| AnswerTrace on legacy layers | **DONE** — both engines feed one counter set |
| config 11 measured vs the same corpus | **DONE** — golden-live 39/42, provider eval on two models |
| gates pass | **DONE** — six gates, four previously vacuous, now exercised |

### 5.2 Removed

| Target | Evidence at removal time | Guard |
|---|---|---|
| `electron/llm/promptComposer.ts` | ZERO importers. Only its own file and its own test referenced `composePrompt`, while the V3 composer drives five surfaces | `SingleComposerInvariant.test.mjs` — asserts the file stays gone, exactly one implementation exists under `electron/`, **and that the survivor is still reached** (deleting the wired one and keeping the orphan would satisfy a naive "only one" check) |
| its test file | Existed solely to test the deleted module | — |
| `promptComposerV2` flag | Zero production readers; its `isInternalDevTestContext` default was an instance of F5 | Same test asserts the flag stays gone |

### 5.3 §2.1 candidates RE-VERIFIED AS NOT DEAD

The matrix's own §3 says verify at removal time, not from the snapshot. That paid off — most §2.1 entries have live references now, and deleting on the 2026-07-29 evidence would have broken working code:

| Target | 2026-07-29 verdict | Evidence 2026-07-30 |
|---|---|---|
| `runManualAnswer` / `submit-manual-question` | "zero renderer callers" | **Wired to V3** in Phase 6 and called from `IntelligenceManager`; the IPC is declared in `electron.d.ts` |
| `RrfFusion` | removable if SearchOrchestrator out of scope | Referenced by `SearchOrchestrator` — in scope |
| `PromptAssemblerV2` | delete with the composer decision | Runs **shadow-mode** inside `WhatToAnswerLLM` |
| `ProfileGraphExtractor` | flags false everywhere | Used by `ProfilePackBuilder` |
| `OkfCardEditor` | flags false everywhere | Live in `KnowledgeManager`, `OkfRetriever`, `ipcHandlers` |

Every check used `/usr/bin/grep -ra`, because plain `grep` in this repo misdetects four files as binary and silently produces false negatives — the documented cause of earlier false DEAD verdicts.

### 5.4 §2.2 remains gated, and one item is now decided differently

`computeFtsScore` was slated for deletion once BM25 replaced it. It is **no longer a removal candidate**: Phase 9's tokenizer work made it the consumer of the shared numeral-aware tokenizer, and it is live on the default answer path with the V3 flag off. The five duplicate source-decision sites, the `_geminiChatStreamHandler` extraction, and the eight answerability implementations stay gated on the same conditions as before — each is a reorder or an extraction, not a cut.
