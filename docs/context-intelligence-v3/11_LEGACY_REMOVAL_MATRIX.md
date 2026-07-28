# Phase 9 — Legacy Removal Matrix

**Status:** BLOCKED — analysis complete, **execution deliberately not performed**.
**Date:** 2026-07-29

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
| `meetingChunksToEvidenceItems` | Complete, tested, **zero production callers** — the fix is to WIRE it. Meeting RAG currently bypasses the evidence contract entirely |
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
