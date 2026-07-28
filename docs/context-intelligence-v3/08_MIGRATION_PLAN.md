# Phase 3 — Migration Plan

**Status:** COMPLETE (plan). **Date:** 2026-07-29

---

## 1. Flag

**One** flag: `contextIntelligenceV3`.

```ts
contextIntelligenceV3: {
  env: 'NATIVELY_CONTEXT_INTELLIGENCE_V3',
  setting: 'contextIntelligenceV3Enabled',
  default: false,          // ← identical in dev, test, and production
}
```

**`isInternalDevTestContext` is forbidden as this flag's default.** 20 of the existing 62 flags resolve differently in dev vs production, and that split is the mechanism by which `composePrompt` was built, tested, and never run for a user. A rebuild that reproduces the split reproduces the outcome.

Corollary for the whole phase: **any new sub-behaviour ships on the same value in both configurations, or it does not ship.**

---

## 2. Phase 5 is not what the brief assumes — restated

§25.4 / Phase 5 ("ingestion migration") assumed a new storage schema. The owner chose **decision + orchestration layer only**, with ingestion, embeddings, `VectorStore` and chunking explicitly reused.

So Phase 5 reduces to, and is redefined as:

| In scope | Out of scope (option not chosen) |
|----------|----------------------------------|
| Adapter from existing storage → `EvidenceItem` / `EvidencePack` | New `knowledge_sources` / `structured_chunks` / `profile_facts` tables |
| Add **`scopeId`** to `EvidenceItem` (F19) | Full §15 schema rewrite |
| Widen `ModeRetrievedChunk` with the 4 dropped fields (§07.2.1) | DB migration |
| Active-version filter over existing `mode_reference_files` | Re-ingesting the corpus into a new store |

This is recorded explicitly so Phase 5 does not read as a skipped phase. It is a **narrowed** phase, by decision.

---

## 3. Ordering — trace first, and why the brief's order cannot be used

§25.3 puts surface migration first. Not executable: two of three decision layers emit no structured artefact, so shadow mode has nothing to diff and parity tests have nothing to compare.

```
0. Fix F21 (worker disposal)              ← nothing below is measurable until this lands
1. AnswerTrace emission, retrofitted to the LEGACY layers
2. Contracts + policies + registry (types only, no behaviour)
3. Unified retriever (scope filter → BM25 + semantic → fusion)
4. Evidence evaluator + claim planner + packer + composer
5. Orchestrator + lifecycle (sequence guards)
6. Surfaces, in risk order: developer harness → Manual Chat → WTA →
   Meeting Overlay → follow-up → screenshot → custom modes
7. UI simplification
8. Verification
```

Step 1 before step 6 is the single most important reordering in this document. Without it the migration is unverifiable — which is how the previous attempts failed while passing their own tests.

---

## 4. Surface migration risk

| Surface | Effort | Note |
|---------|--------|------|
| Developer harness | trivial | Already exists (`__e2e__:*`) |
| Manual Chat (`gemini-chat-stream`) | **highest** | ~3 690 lines inline in one IPC handler. An **extraction**, not a re-wire. |
| What to Answer | high | Two `buildTurnContractIfEnabled` calls straddling `resolveCanonicalTurn`; the earlier one gates fetches feeding the later one — a **reorder, not a cut**. |
| Recap / follow-up | medium | Contract exists but fails open to "mode-blind" |
| Assist / clarify / brainstorm / code-hint | medium | No source authority at all today |
| `submit-manual-question` | **delete, don't migrate** | Registered, ungrounded, **no renderer caller** |

---

## 5. Shadow mode

Compare old vs new `TurnDecision`, authorized sources, retrieval candidates, accepted evidence, fallback, and latency. **No duplicate paid generation by default** — decision-layer diffing needs no model call, and that is where the defects are.

---

## 6. Cross-repo step: the backend prompt-text regex

`natively-api` selects models by regex-matching English prose in the client's system prompt. This is a hard cross-repo coupling with no shared constant and no test.

1. Client sends `modeId` + `modePolicyVersion` as structured fields (backward compatible; server ignores unknown fields).
2. Server routes on `modeId`, keeping the regex as fallback.
3. Once telemetry shows no regex-only requests, delete the regex.

Ordering matters: deleting the regex first silently downgrades both interview modes to the weaker model.

---

## 7. Rollback

`contextIntelligenceV3 = false` restores the legacy path completely, because the new module is additive: nothing is deleted until Phase 9, and Phase 9 is gated on acceptance gates that cannot currently be evaluated.

Rollback is therefore a **flag flip**, not a revert — for the entire duration of the migration.

---

## 8. Risks carried into implementation

| Risk | Mitigation |
|------|------------|
| **Shared working tree** — drifted twice during this investigation | Re-diff before touching any file; never delete a file another agent may be editing |
| **F21** — suite cannot terminate | Fix first; it is a disposal lifecycle, not the one-liner originally proposed |
| **F22** — 128k-char PDF aborts the process | Independent P1. The rebuild inherits it via reused ingestion and must not paper over it |
| **Type errors do not fail the build** | esbuild is transpile-only; `typecheck:electron` must be a separate gate |
| Fusion weight tuned against a broken lexical arm | Re-tune `FTS_WEIGHT` after the BM25 swap; 0.4 has no remaining justification |
