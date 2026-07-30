# Context Intelligence V3 — Final Report

**Status:** PARTIAL — Phases 0–5 complete; Phase 6 wired on manual-chat behind an off-by-default flag; **Phase 8 measured, including a provider-backed run**; Phase 7 architecture done, UI swap deliberately not done; Phase 9 **blocked by design**.
**Date:** 2026-07-29, **revised 2026-07-30**.
**Run:** unattended overnight continuation, then a second continuation.

This report is accurate about where the work stopped. Nothing below is estimated, and no result appears that was not produced by an executed run.

> **READ §13 FIRST.** Sections 0–9 were written on 2026-07-29 and several of their claims are **superseded**: a surface *is* wired, the golden suite and a provider-backed evaluation *have* run, and the finding count is 25 rather than 22. §13 records the 2026-07-30 continuation and takes precedence wherever it conflicts with an earlier section.

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
| 1 — Investigation | **COMPLETE** | `01_INVESTIGATION_REPORT.md` — **25** findings + reproduction (F24, F25 added 2026-07-30) |
| 2 — Benchmarks | **PARTIAL** | `02_RETRIEVAL_BENCHMARK.md`, `03_KEEP_REMOVE_MATRIX.md` — 5 of 11 configs executed |
| 3 — Contracts | **COMPLETE** | `04`–`08` |
| 4 — Core implementation | **SUBSTANTIALLY COMPLETE** | contracts · source authority + scope filter · mode registry · turn classifier · BM25 · AnswerTrace · **context packer · prompt composer · conversation state** · **120 tests** |
| 5 — Ingestion migration | **DONE** (scope-reduced by decision) | `retrieval/legacy-adapter.ts` — scopeId + the dropped signals |
| 6 — Surface integration | **PARTIAL** — manual-chat wired as a flag-gated short-circuit (`ipcHandlers.ts`); WTA, recap/follow-up and the proactive surfaces not wired | `orchestration/orchestrator.ts` · §13 |
| 7 — UI simplification | **NOT STARTED** | — |
| 8 — Full verification | **PARTIAL** — suite runs (6593 tests, 67 s); golden suite run against the LIVE stack; provider-backed §26.5 run on MiniMax-M3 with all three behavioural gates passing | `09_TEST_MATRIX.md` §10 · `10_BENCHMARK_RESULTS.md` §8 |
| 9 — Legacy removal | **BLOCKED, deliberately not executed** | `11_LEGACY_REMOVAL_MATRIX.md` |
| 10 — Rollout | **PLAN ONLY** | `12_ROLLOUT_AND_ROLLBACK.md` |
| 11 — Final report | **COMPLETE** | this document |

**Production answer behaviour is changed only behind an off-by-default flag.** Beyond the three F21 `unref?.()` calls (§0), `ipcHandlers.ts` now contains a V3 short-circuit for manual chat, gated on `NATIVELY_CONTEXT_INTELLIGENCE_V3` whose default is `false` **identically in dev, test and production** — the F5 split is deliberately not reproduced. Two legacy retrieval defects (F22, F23) were also fixed at defaults, since both silently zeroed retrieval for keyless installs. See §13.

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
| `contracts/flag.ts` | One flag, `DEFAULT_ENABLED=false`, **identical in dev/test/prod** — tested against every `isInternalDevTestContext` condition |
| `retrieval/legacy-adapter.ts` | Stamps `scopeId`; carries `answerabilityScore`/`rerankScore` the legacy type drops; **fails closed** on unknown type/version |
| `orchestration/orchestrator.ts` | One frozen decision; injected retrieval; answerability by **claim authority, not similarity** |
| `generation/context-packer.ts` | Deterministic, budgeted, dedup'd; **XML-escapes evidence** so retrieved text cannot forge a tag |
| `generation/prompt-composer.ts` | THE composer. Safety rules first; realtime instructions contained in a self-limiting tag |
| `question/conversation-state.ts` | Size-bounded, scope-keyed, **resets on meeting change**; prior assistant output is a referent, never evidence |
| `__tests__/` | **120 tests, 120 pass, process exits cleanly** |

**Four bugs were found by these tests and fixed rather than papered over** — each in code written minutes earlier, and each of a kind that fails silently in production:

- `SKILL_RE` required "experience **with** X", so *"Tell me about your Kubernetes experience"* classified as `AMBIGUOUS` with **no claims** — no source required, fabrication permitted.
- `extractEntities` captured sentence-initial capitals, so *"Tell me about the Cassandra migration"* set `activeTopic = "Tell"` and the next pronoun resolved against a verb.
- A hard `worker.unref()` threw against the **mock** Worker in test doubles, silently disabling the model.
- And the two classifier bugs below.


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
5. Retrofit `AnswerTrace` onto the legacy layers — the prerequisite for all parity work. The contract, the redactor and the decision-diffing function already exist (`observability/answer-trace.ts`).
6. Build config 11 on `EvidenceResolver` (its dependencies are already injected interfaces) and measure against the same corpus. The orchestrator's `RetrievalPort` is the seam.
7. Wire the first surface (developer harness → Manual Chat) behind `contextIntelligenceV3`, comparing traces before switching anything.

**The 121 remaining suite failures are NOT on this list, deliberately.** A clean-worktree run at my own commit shows **181** failures, versus **121** with the other agent's uncommitted work applied — their in-flight branch *adds* ~450 tests and *fixes* ~60 failures. Those failures are neither mine nor theirs to hand off; they are pre-existing and partly already being fixed. Fixing them from here would collide with active work.

**Do not begin Phase 9.** The unblock chain is in `11_LEGACY_REMOVAL_MATRIX.md` §4.

---

## 9. Standing hazards for whoever continues

- **The working tree is shared.** It drifted twice during this session without my involvement. Re-diff before touching any file; re-verify every line citation in these documents — file-and-symbol references are stable, line numbers are not.
- **Plain `grep` is unsafe in this repo.** Four files are misdetected as binary and silently produce false negatives, which has already caused false DEAD verdicts in prior audits. Use `/usr/bin/grep -ra`.
- **Type errors do not fail the build** — esbuild is transpile-only. `typecheck:electron` must be a separate gate.
- **Never default `contextIntelligenceV3` to `isInternalDevTestContext`.** That split is the disease this whole mission is treating.

---

## 12. Phase 7 — the user-facing control, and what is deliberately left undone

### 12.1 The selector collapses to two options

§6 requires removing the Knowledge Source selector (Resume / JD / reference files / Profile Intelligence / Combined / Automatic) and replacing it with an understandable answer-policy control.

The shadow run explains why that selector existed at all: **the legacy source decision is a pure function of the mode and never looks at the question** (§8.1 of `02_…`). Something had to be user-steerable, because the system could not decide for itself.

With mode policy authorizing sources, classification determining required ones, and retrieval selecting relevant evidence, the only thing genuinely left to a user is **fallback** — what happens when the references do not cover the question. That is a real product decision. *Which retriever ran* is not.

```
Answer policy
○ Use references when relevant      → SOURCE_FIRST
○ Only answer from references       → STRICT_SOURCE_ONLY
```

`policies/answer-policy.ts`, 13 tests. Enforced properties:

- **Exactly two options.** `OPEN_KNOWLEDGE` and `ASK_BEFORE_FALLBACK` are unreachable from the control — the first is a mode default, the second is unsuitable for a live meeting, and exposing either puts architecture back in front of the user.
- **The control cannot widen authorization.** Asserted across all eight modes: choosing a policy never changes which sources a mode allows.
- **No internal vocabulary can leak into a label** — `retriev*`, `embedding`, `vector`, `rag`, `chunk`, `bm25`, `rerank`, `knowledge source`, `okf`, `index` are all asserted absent, so the rule is enforced rather than merely documented.
- **The control is only offered where it binds to something** — a mode with no reference files gets no "only answer from references" toggle, since it could only make the answer worse. Asserted against the registry so the two cannot drift, which is how the old selector came to offer sources a mode never allowed.
- **Any developer diagnostic override is passed per call and never read from settings**, satisfying §6's requirement that it never become persisted production state.

### 12.2 The UI edit itself is NOT done, and the reason is not caution

The two surfaces that render the old control are:

| Surface | Location | Status |
|---------|----------|--------|
| Per-mode source-owner dots | `premium/src/ModesSettings.tsx` | **not edited** |
| "Profile Mode" toggle | `src/components/SettingsPopup.tsx` | **not edited** |

`premium` is a **git submodule on a different branch** (`fix/jd-lookup-order-2026-07-27`) with `src/ModesSettings.tsx` **already modified** by concurrent work. Editing it would mean committing into someone else's in-flight branch in a separate repository — a merge conflict in a place neither agent can see the other.

The architecture is the part that was actually missing, and it is done. The UI swap is a thin presentation change that should land in the submodule, on its own branch, when that work settles. Recorded here so Phase 7 is not read as complete.

---

# 13. Continuation — 2026-07-30

Commits `a4b0dd24`, `fa35408b`, `fdcf9312`, `97b7277c`, `cdd3e88b`, `94b16c88`, `0b82ca93`.

## 13.1 Headline: the harness was measuring almost nothing

Four acceptance gates could not fail. Each reported a clean pass, and the pass was an artifact.

| Gate | Why it could not fail |
|---|---|
| `noStaleVersionAccepted` | Tested `!/resume_v1/.test(documentTitle)` against a corpus that **never ingested `resume_v1`** |
| version filtering generally | `golden-live` stamped the literal `'legacy'` as every file's active version and passed **no `chunkVersions`**, so the filter compared a value with itself |
| `answerabilityMatchesExpected` | **Did not exist.** `expectedAnswerability` was recorded by all three harnesses and asserted by none |
| `evidenceCarriesProvenance` | `e.scopeId &&` is a truthiness test on a field the adapter always populates from the turn's own scope. **Still vacuous** — F25a |

Two fixtures underpinning 8 questions — `resume_v1_2023.md` and `meeting_transcript_previous.txt` — were **ingested by no harness at all**, and the two harness corpora had drifted to 13 files versus 10.

## 13.2 Two findings, both inside the rebuild

**F24 — `CONFLICTING` was unreachable.** `adaptLegacyChunks` stamps every admitted item with the source's *active* version, so two items from one source could not differ and the branch was dead code. Four questions expected that state. Evidence now carries `retrievedVersionId` so the check can fire.

**F25 — scope filtering has no callers, and version filtering failed open.** `filterByScopeAndVersion` is fully implemented, tested, and has **zero call sites** outside its own tests; the wired path never compares `scopeId` against a per-source scope. Separately, `chunkVersions?.get(id) ?? active` admitted any unregistered chunk as current while the docblock read *"Fails CLOSED"*. The fail-open is now an explicit opt-in that only the wired surface sets. **F25a remains open.**

Both are the mission's own central thesis — built, tested, unreachable — reproducing in the module written to replace it. That is the single most important thing in this report.

## 13.3 The corpus was contaminated, and it broke the headline result

`lfw_resume.txt` is **Evin J**; `resume_v1/v2` are **Priya Raghunathan**. Both are `RESUME`. Merged, "the candidate" became two people and Priya's résumé — which lists Kubernetes and PostgreSQL — answered the probes asserting those terms appear **nowhere** in the résumé.

That includes **C-02, the canonical JD-as-experience result**, which was passing *contaminated*.

Fixed by splitting retrieval into `base` and `versioned` groups, each ingested into its own mode. Deliberately **not** done with `scopeId`, which filters nothing here (F25a). Discriminating check: superseded-rejection turns fell **25 → 6**, confirming the stale résumé had been a candidate on every résumé question.

## 13.4 Measured

**Golden suite, live stack** (`09_TEST_MATRIX.md` §10):

| Gate | Result |
|---|---|
| `noProhibitedSourceInEvidence` | 42/42 |
| `promptLabelsEvidenceUntrusted` | 42/42 |
| `noStaleVersionAccepted` | 42/42 — **now exercised**, on 6 of the 7 versioned questions |
| `retrievalPath` | 41/42 |
| `answerabilityMatchesExpected` | **33/42** — newly measured, never previously asserted |

`answerabilityMatchesExpected` moved 29 → 32 → 33 as two decision-layer defects were fixed: **subject-level satisfaction** (several claim types for one clause are alternatives, not a conjunction — requiring all made `PARTIAL` unavoidable) and **light stemming** (`graduate` ≠ `graduated` under exact token comparison).

**Provider-backed §26.5** (`10_BENCHMARK_RESULTS.md` §8) — on **MiniMax-M3**, because `gemini-3.1-flash-lite` is unreachable:

| Gate | Result | Target |
|---|---|---|
| Forbidden-claim rate | **0.0%** | 0% ✅ |
| Over-refusal on general questions | **0.0%** | 0% ✅ |
| Unsupported-claim disclosure | **100%** (4/4) | ✅ |
| Judged factual grounding | 80–83% | — |
| §20 boilerplate · over-long · length | **0.0%** · 2.4% · p50 34 / p95 80 words | — |

## 13.5 The instruments were wrong more often than the system

Recorded because it is the through-line of the whole continuation.

- Exact-string grounding read 33.3% while 16 of 20 "misses" were correct answers in different formatting.
- The disclosure detector read 0%, then 50%, while the model disclosed correctly — `doesn't cover` and `don't tell` both missed because the negation branches had drifted apart.
- The mangling detector read **0 mangled** while two of four fabrication probes were cut mid-sentence.
- Judged grounding read 62.1% because MiniMax-M3 splits its answer across the closing think tag; eliminating that artifact moved it to 83.3% on the same corpus and prompt.

**A metric that under-reports good behaviour is as dangerous as one that over-reports it.** Four separate instances, and each produced a plausible number that would have been published.

## 13.6 What is still open

| Item | State |
|---|---|
| **F25a — scope filtering unwired** | Open. `filterByScopeAndVersion` has no callers; `evidenceCarriesProvenance` is vacuous until it does |
| **Six answerability failures** | Diagnosed per stage, not guessed: 2 retrieval misses (A-03, G-02), 2 claim-type misclassifications (A-06, A-12), 2 leniency (D-01, F-06), plus G-03's path |
| **§26.5 on `gemini-3.1-flash-lite`** | Blocked on billing, not engineering. Every available Gemini key reports depleted prepayment credits, including a key added on 2026-07-30 — this is a **project billing** condition, so a new key on the same project cannot clear it |
| **Value-level conflict detection** | Not implemented (06 §5.1). No corpus fixture exists for it either |
| **Phase 7 UI swap** | Architecture done; the two rendering surfaces deliberately untouched (§12.2) |
| **Phase 9 legacy removal** | Correctly still blocked: the flag has never been on for a real user |

**The honest summary:** the decision layer's safety properties are now measured against a real corpus on a real model and they hold. Its *precision* is measured for the first time and is 33/42. Nothing here authorises Phase 9.
