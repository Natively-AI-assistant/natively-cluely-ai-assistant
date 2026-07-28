# Context Intelligence V3 — Final Report

**Status:** PARTIAL — Phases 0–3 complete; Phase 4 substantially landed and tested; **F21 fixed, unblocking the acceptance gates**; Phases 6–8 not started; Phase 9 **blocked by design**.
**Date:** 2026-07-29
**Run:** unattended overnight continuation.

This report is accurate about where the work stopped. Nothing below is estimated, and no result appears that was not produced by an executed run.

---

## 0. Headline: the measurement blocker is gone

**`npm test` went from "never terminates" to 67 seconds**, and §7.1's numeric baseline — open since Phase 1 — is now recorded:

```
# tests 6593   # pass 6258   # fail 278   # skipped 45   # duration 67.2 s
```

**Root cause of F21 was `unref()` ORDERING, and it was a defect class.** Attaching a `'message'` listener implicitly re-references a `MessagePort`, so an `unref()` placed next to `new Worker()` is undone by the very next line. Three files owned workers and none called `unref()` at all:

| File | Before | After |
|------|--------|-------|
| `electron/llm/IntentClassifier.ts` | never exits | **exits rc=0** |
| `electron/rag/providers/LocalEmbeddingProvider.ts` | never exits | **exits rc=0** |
| `electron/rag/LocalReranker.ts` | never exits | **exits** (rc=1, pre-existing failure) |

Total production change: **51 lines across 3 files, purely additive** — one `this.worker.unref?.()` each plus explanatory comments. No deletions. No behavioural change in Electron, where the loop is anchored by `app` and its windows.

**The suite caught a regression I introduced, and I fixed it.** A hard `unref()` call threw against the *mock* Worker used by test doubles — silently disabling the model rather than hanging. The optional call (`unref?.()`) resolves it. After the fix, **zero failures trace to files this mission changed**, with one exception *proved* pre-existing by discriminator (`LocalReranker — real bundled model` fails identically at ~550 ms with the fix reverted).

---

## 1. Phase status

| Phase | Status | Deliverable |
|-------|--------|-------------|
| 0 — Baseline | **COMPLETE** | §1 of `01_INVESTIGATION_REPORT.md` |
| 1 — Investigation | **COMPLETE** | `01_INVESTIGATION_REPORT.md` — 22 findings + reproduction |
| 2 — Benchmarks | **PARTIAL** | `02_RETRIEVAL_BENCHMARK.md`, `03_KEEP_REMOVE_MATRIX.md` — 5 of 11 configs executed |
| 3 — Contracts | **COMPLETE** | `04`–`08` |
| 4 — Core implementation | **PARTIAL** | `electron/context-intelligence/` — contracts, source authority, scope filter, mode registry, turn classifier, BM25, AnswerTrace · **66 tests** |
| 5 — Ingestion migration | **NOT STARTED** (scope-reduced, see §5) | — |
| 6 — Surface integration | **NOT STARTED** | — |
| 7 — UI simplification | **NOT STARTED** | — |
| 8 — Full verification | **PARTIAL** — F21 unblocked it; suite now runs (6593 tests, 67 s). Golden suite + provider eval not run | §1.6.1 of `01_…` |
| 9 — Legacy removal | **BLOCKED, deliberately not executed** | `11_LEGACY_REMOVAL_MATRIX.md` |
| 10 — Rollout | **PLAN ONLY** | `12_ROLLOUT_AND_ROLLBACK.md` |
| 11 — Final report | **COMPLETE** | this document |

**No production ANSWER behaviour was changed.** The only production edits are the three F21 `unref?.()` calls (§0) — process-lifetime only, additive, and inert inside Electron. The new `context-intelligence/` module is not wired to any surface.

---

## 2. Root causes

The brief hypothesised duplicate, uncoordinated source-decision layers. Confirmed — with a sharper diagnosis.

**The dominant failure mode is unadopted architecture, not missing architecture.**

| Component | State |
|-----------|-------|
| `resolveCanonicalTurn` (immutable TurnDecision, deep-frozen) | exists — **1 call site** |
| `composePrompt` (canonical composer) | exists — **0 call sites** |
| `meetingChunksToEvidenceItems` (evidence bridge) | exists, tested — **0 production callers** |
| `assistantClaims` precedence | exists — 1 call site, **off in production** |
| Tier-2 OKF provenance | exists — **off in production** |
| `knowledgeOrchestratorGate`, `deleteProfileTransactional` | exist, tested — **0 importers** |

The mechanism is **F5**: 20 of 62 intelligence flags resolve differently in dev/test than production. Components could be built, pass their tests, and never run for a user. That is why repeated fixes validated by tests did not improve production behaviour.

Supporting structural findings: nine answer surfaces run five independent source-decision sites, and **five of the nine construct no source authority at all** (F2); two renderer overlays compose their own system prompts including a hardcoded grounding policy (F3); the backend has no mode registry and regex-matches English prose in the client's prompt to pick models (F7).

---

## 3. Measured results

Executed run, validity-guarded. 42 questions (30 deterministically scored), 14 documents, 223 chunks.

| Config | R@1 | R@3 | R@5 | P@3 | Contam. | **Stale-ver.** | p50 |
|--------|-----|-----|-----|-----|---------|----------------|-----|
| semantic only | 60.0 | 73.3 | 76.7 | 29.3 | 16.7 | **54.8** | 8 ms |
| lexical overlap *(shipped "FTS/BM25")* | 40.0 | 70.0 | 80.0 | 25.3 | 7.1 | 16.7 | 8 ms |
| **real BM25** | **63.3** | 80.0 | 80.0 | 30.7 | 9.5 | 23.8 | 11 ms |
| hybrid *(production)* | 56.7 | **83.3** | **83.3** | **33.3** | 14.3 | 47.6 | 8 ms |
| hybrid + BM25 | 56.7 | 70.0 | 83.3 | 28.0 | **7.1** | 26.2 | 11 ms |

**Two decision-grade conclusions:**

**(1) The shipped keyword scorer costs 23 points of Recall@1.** Same pool, same corpus, ranking the only difference. The component named "FTS/BM25" computes `matches / √(|Q|·|unique|)` over de-duplicated matches — no term frequency, no IDF, no length prior — and there is no FTS5 index anywhere under `electron/`.

**(2) Version isolation must be a filter, not a score.** Semantic ranking surfaced a *superseded* resume on 54.8% of questions. `resume_v1` and `resume_v2` are near-identical prose, so their embeddings are correctly almost identical — **no reranker, fusion weight, or better model can separate them.** This is the single most important architectural constraint the phase produced, and it was not in the original brief.

---

## 4. Two findings that changed the plan

**F21 — RESOLVED, but only after my first two attempts were falsified.**
Worth recording as a method note: the obvious fix looked right twice and was wrong twice.

1. `worker.unref()` next to `new Worker()` → still hung.
2. `+ worker.stdout/stderr.unref()` → still hung.
3. Diagnosis via `process._getActiveHandles()`: a lone surviving `MessagePort`. (The two `Socket`s alongside it were an artefact of piping the diagnostic through `grep` — with a file redirect they vanish. Chasing them would have wasted the night.)
4. **Actual cause: ordering.** Attaching a `'message'` listener re-references the port, so the `unref()` on line 1 was undone on line 2. Moving it *after* all listeners fixed it — and the same defect existed in two more files.

The lesson generalises beyond this bug: each attempt was verified against the discriminator that actually distinguished the hypotheses (*does the process **exit***, not *do the tests pass*), which is what stopped a plausible-but-wrong fix from shipping.

**F22 — a 66-page PDF crashes the embedding worker (new, P1, independent of this mission).**
`institutional_thesis.pdf` (128 184 chars) reproducibly aborts the process with SIGTRAP during indexing. Extraction succeeds; `bert_1810.04805.pdf` (64 701 chars) indexes fine. This is precisely the thesis/seminar use case, and it violates §22.4 in the hardest way — a hard process abort rather than isolating the bad source.

---

## 5. Scope reinterpretation, stated explicitly

The owner chose **decision + orchestration layer only**, reusing ingestion, embeddings, `VectorStore` and chunking. Phase 5 as written assumed a new storage schema; under this scope it reduces to an adapter plus two additive type widenings (`scopeId` on `EvidenceItem`; the four computed-then-dropped fields on `ModeRetrievedChunk`). Recorded so Phase 5 does not read as skipped — it was **narrowed by decision**.

I also proposed re-ordering §25.3 to put `AnswerTrace` emission before surface migration. Two of three decision layers emit no structured artefact, so shadow mode and parity tests have nothing to diff. Without trace-first the migration is unverifiable — which is how previous attempts failed while passing their own tests.

---

## 6. What was built

`electron/context-intelligence/` — additive, no legacy file modified:

| File | Contents |
|------|----------|
| `contracts/types.ts` | `SourceType`, `ClaimType`, `TurnDecision`, `EvidenceItem`, `EvidenceScope`, `RetrievalPlan`, `freezeTurnDecision` (deep freeze) |
| `policies/source-authority-policy.ts` | `CLAIM_AUTHORITY` (exhaustive `Record<ClaimType,…>`), `filterByScopeAndVersion` |
| `policies/mode-policy-registry.ts` | All **eight** modes incl. `seminar`, typed `Record<ModeId, ModePolicy>` so a missing policy is a **compile error**; `resolveModePolicy` **fails closed** on an unknown id |
| `question/turn-classifier.ts` | Deterministic fast/grounded/verification decision; per-clause classification so MIXED questions split correctly |
| `retrieval/bm25.ts` | Okapi BM25 with legacy-parity tokenizer, normalised scoring for fusion |
| `observability/answer-trace.ts` | `AnswerTrace`, `redactTrace` (identity only, never content), `compareDecisions` for shadow mode |
| `__tests__/` | **66 tests, 66 pass, process exits cleanly** |

Two classifier bugs were found by its own tests and fixed rather than papered over:
- "How does TCP congestion control work?" was mis-detected as a *follow-up* because it begins with "how" — denying it the fast path. Fixed by bounding follow-up detection to short, subject-less questions.
- Mixed questions ("tell me about your WebRTC project **and** explain how WebRTC connects") lost their general half. Fixed by classifying **per clause** and unioning — which is what §3.7 claim-level grounding actually requires.

Verified at close: 66/66 module tests pass · 6593-test suite completes in 67 s · 30/30 gold labels verify · repro #7 still reproduces (4 fail by design) · **no new typecheck errors** (the single existing error is the pre-existing dirty-tree one in `RAGManager.ts`, owned by concurrent work).

---

## 7. Known limitations

1. **Six of eleven benchmark configs were never executed** — entity/heading (no isolable retriever exists), rerank (needs low-confidence bucketing), Profile Tree (set-retrieval, different metrics), Graph RAG (needs re-ingest with the flag set *at ingest time*), Hindsight (needs a live external server), legacy combined (returns a string, not candidates). Their components are marked `INSUFFICIENT EVIDENCE`, **not** remove candidates.
2. **The thesis is excluded from the corpus** because of F22 — so large-document retrieval is unmeasured.
3. `falseRetrievalRate = 100%` is an **artefact** of invoking the retriever directly; it establishes only that the retriever has no "should I run" concept, not that the product always retrieves.
4. **No provider-backed evaluation was run** — no answer-quality, naturalness, or over-disclosure numbers exist.
5. Phases 6–8 not started; no surface uses the new module.
6. **Everything lives in gitignored directories** (`docs/*`, `test-fixtures/`, `benchmarks/`). `electron/context-intelligence/` is tracked; the rest is not, and will not survive a clean checkout. Backups: `<scratchpad>/backup/*.tgz`.

---

## 8. Recommended next actions, in order

1. ~~Fix F21~~ **DONE.** Suite terminates; gates are measurable.
2. ~~Fill the §7.1 numeric baseline~~ **DONE** — 6593 / 6258 pass / 278 fail / 67 s.
3. ~~Fix the native-ABI split~~ **DONE, and it was worth more than expected.**

   | Runtime | pass | fail |
   |---------|------|------|
   | system node (`npm test`) | 6258 | **278** |
   | `ELECTRON_RUN_AS_NODE=1 electron` | **6427** | **121** |

   **+169 tests recovered; ABI failures went to zero.** `postinstall` builds native modules for Electron (NODE_MODULE_VERSION 148) while `npm test` runs under system node (141), so every DB-touching test failed on `ERR_DLOPEN_FAILED` alone — no test-code edit could ever have fixed them. Added as `npm run test:electron`.

   **Safety issue found while doing it:** a concurrently-added `test:electron` script had **no `NATIVELY_TEST_USERDATA` isolation**, so running it would open the user's **real** `natively.db` and let DB tests mutate live data. Duplicate JSON key resolved and isolation added. The remaining 121 failures are genuine, and none trace to files this mission changed.
4. **Fix F22** independently — a live P1 in the flagship document use case.
5. Retrofit `AnswerTrace` onto the legacy layers — the prerequisite for all parity work. The contract and the diffing function already exist (`observability/answer-trace.ts`).
6. Build config 11 on `EvidenceResolver` (its dependencies are already injected interfaces) and measure against the same corpus.
7. Then, and only then, begin surface migration.

**Do not begin Phase 9.** The unblock chain is in `11_LEGACY_REMOVAL_MATRIX.md` §4.

---

## 9. Standing hazards for whoever continues

- **The working tree is shared.** It drifted twice during this session without my involvement. Re-diff before touching any file; re-verify every line citation in these documents — file-and-symbol references are stable, line numbers are not.
- **Plain `grep` is unsafe in this repo.** Four files are misdetected as binary and silently produce false negatives, which has already caused false DEAD verdicts in prior audits. Use `/usr/bin/grep -ra`.
- **Type errors do not fail the build** — esbuild is transpile-only. `typecheck:electron` must be a separate gate.
- **Never default `contextIntelligenceV3` to `isInternalDevTestContext`.** That split is the disease this whole mission is treating.
