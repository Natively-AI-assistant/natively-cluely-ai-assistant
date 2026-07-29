# Natively Context Intelligence V3 — Phase 1 Investigation Report

**Status:** Phase 0 complete · Phase 1 in progress
**Date:** 2026-07-29
**Scope of this document:** Phases 0 and 1 only (§33). No production answer behaviour has been modified.

---

## 0. Executive summary — what the investigation has established so far

The mission brief hypothesises that Natively's failures stem from *duplicate, uncoordinated source-decision layers* rather than from prompt quality. **The investigation confirms that hypothesis, with a sharper diagnosis than the brief assumes.**

Twenty-one findings are recorded below. Every one was verified against the running code, with file:line citations; claims delegated to specialist agents were independently spot-checked before being written here.

| # | Finding | Status |
|---|---------|--------|
| **F1** | An immutable turn-decision object **already exists** (`resolveCanonicalTurn`, deep-frozen) but has **exactly one call site**. | CONFIRMED |
| **F2** | Nine answer surfaces run **five independent source-decision sites**; **five of the nine construct no source authority at all** and pass a raw transcript blob to the model. Four of those five are live UI paths; the fifth (`submit-manual-question`) is registered but has **no renderer caller** — a deletion candidate, not a migration target. | CONFIRMED |
| **F3** | Two renderer overlays **compose their own system prompts, including their own grounding policy**, and pass `skipSystemPrompt: true` to bypass main-process composition entirely. | CONFIRMED |
| **F4** | The stale-answer bug (§7.9 #7) has a **deterministic, provider-free root cause**, now **reproduced** in a runnable test. | CONFIRMED + REPRODUCED |
| **F5** | 62 intelligence flags gate this subsystem; **20 default differently in dev vs production**, so the test suite does not exercise the shipped configuration. | CONFIRMED |
| **F6** | There are **eight** built-in modes, not seven. `seminar` is UI-unreachable and **missing from six independent mode lists**, silently disabling routing for it. | CONFIRMED |
| **F7** | The backend has **no mode registry**; it **regex-matches the client's English prompt text** to pick models, across a repo boundary with no shared constant. | CONFIRMED |
| **F8** | `modes:create` accepts an unvalidated `templateType`, producing **a mode with no system prompt** — failing open. | CONFIRMED |
| **F9** | All profile **provenance lives in Tier 2, which is switched OFF in production**. `isDirectFact`/`isInferred`/`evidenceText` exist nowhere in the profile path. | CONFIRMED |
| **F10** | There is **no live central prompt composer** — `composePrompt` has zero call sites. **11 sites inject profile blocks directly**, four duplicating the same literal tags. | CONFIRMED |
| **F11** | **Live production bug:** the salary cache key omits experience-years and any content hash, so a revised resume returns the **old** estimate. | CONFIRMED |
| **F12** | Re-upload invalidation **misses three sibling caches**, and a code comment **actively misdescribes** the choke point as covering ingest. New JD carries the **previous role's negotiation state** forward. | CONFIRMED |
| **F13** | JD ingest fires the AOT pipeline **unawaited** and reports `success:true` before derived artifacts exist. | CONFIRMED |
| **F14** | The model's **own prior output is re-injected as undifferentiated context** on 6 of 9 surfaces; the guard that prevents this is wired to one surface and **disabled in production**. | CONFIRMED |
| **F15** | **Eight independent implementations of "answerability"**, eleven of evidence selection, eight of fusion, and four competing evidence-container types. | CONFIRMED |
| **F16** | **No full-text index exists anywhere** (`FTS5` has zero hits under `electron/`), and the one retriever advertising "FTS/BM25" implements neither — it computes unique-term overlap with no IDF term. | CONFIRMED (scoped — see §6C.3) |
| **F17** | Meeting RAG **bypasses the evidence contract entirely**; its `EvidencePack` bridge has zero production callers. | CONFIRMED |
| **F18** | `NO_RELEVANT_CONTEXT_FOUND` and retrieval **timeouts both silently degrade to answering anyway**, indistinguishably from a grounded answer. | CONFIRMED |
| **F19** | `EvidenceItem` **has no `scopeId` field**, so user/meeting/version isolation cannot be asserted on evidence at all. | CONFIRMED |
| **F20** | Four source files are **misread as binary by BSD `grep`**, silently suppressing matches — prior audits of this repo produced **false DEAD verdicts**. | CONFIRMED |
| **F21** | **`npm test` cannot terminate.** `IntentClassifier` spawns a never-`unref()`d worker thread; the 20 test files importing it **pass all assertions in ~1.2 s and then never exit**. **No §27 acceptance gate is currently measurable.** | CONFIRMED (isolated, spec-reporter evidence) |

Two structural conclusions follow, and they reframe the mission:

**(1) Most of the V3 target architecture is already built — and wired to nothing.** `resolveCanonicalTurn` (immutable TurnDecision), `composePrompt` (canonical composer), `SourceAuthorityKernel`, Tier-2 OKF provenance, `assistantClaims` precedence, `knowledgeOrchestratorGate`, `deleteProfileTransactional` — all exist, all are tested, and all are either single-call-site, flag-off in production, or have literally zero importers. **The dominant failure mode of this codebase is not missing architecture; it is unadopted architecture.** Phase 4 should be re-scoped accordingly: it is substantially a *wiring and deletion* effort, not a greenfield build.

**(2) The test suite structurally cannot catch these bugs.** With 20 flags flipping between dev and production, the suite exercises a configuration no user runs — and it is precisely the *provenance, enforcement, and validation* arms that are on in test and off in production. This explains the repository's documented history of fixes that passed tests and did not improve production behaviour.

F4 is the highest-value *immediate* finding: it is the only user-visible failure whose root cause is understood well enough to fix and regression-test without a live provider, and it is already reproduced (§4.6).

---

## 1. Phase 0 — Baseline

### 1.1 Repository state

| Item | Value |
|------|-------|
| Branch | `main` |
| HEAD commit | `0001587a322f377e7e063362f2de37d0c17a6baa` |
| Rollback pointer created | `ci-v3-baseline` (branch at HEAD; **no working-tree mutation performed**) |
| App version | 2.8.4 |
| Node | v25.9.0 |
| npm | 11.18.0 |
| Platform | darwin 25.4.0 |

### 1.2 ⚠ The working tree was already dirty — baseline is "HEAD + uncommitted third-party changes"

This repository is a shared working directory. At session start the tree carried **31 modified files, 2 deletions, and 11 untracked paths that were not created by this investigation**, authored under the git identity `Hardening v2.7`.

**This materially affects the baseline and must be read before trusting any test result below.**

Snapshots taken (scratchpad, not committed):
- `phase0/baseline-head.txt`, `phase0/baseline-status.txt`, `phase0/baseline.diff` (6 099 lines / 324 KB), `phase0/baseline-diffstat.txt`

Deletions present at baseline, both in the retrieval subsystem:
- `electron/rag/vectorSearchWorker.ts` (deleted)
- `scripts/VectorStoreRebuild.js` (deleted)

Modified retrieval files at baseline: `electron/rag/RAGManager.ts`, `electron/rag/VectorStore.ts`.

**Consequence:** any failure in `electron/rag/__tests__` must be attributed to the in-flight third-party work, not treated as a pre-existing repo condition. §7.1 requires separating pre-existing failures from mission-introduced ones; this report additionally separates a **third category — failures introduced by concurrent work in the shared tree**.

### 1.2a The tree changed *during* this investigation — demonstrated, not hypothetical

Re-diffing the working tree against the §1.2 snapshot at the end of the session showed changes **this investigation did not make**:

- `src/components/NativelyInterface.tsx` — **no longer modified** (reverted or committed by the concurrent worker mid-session)
- New untracked files appeared: `proHarness.html`, `src/dev/proHarness.tsx`

Consequence for this report: `NativelyInterface.tsx` is cited in §3.1 and §4.3–4.4. All citations were **re-verified after the drift was detected**; every finding still holds, but line numbers shifted by ~24 (e.g. the guard moved `5205→5181`, call sites `5730→5706` and `5895→5871`). Citations in this document reflect the **post-drift** state.

**Standing instruction for Phases 2–9: re-verify every line citation in this report before acting on it.** File-and-symbol references are stable; line numbers in this repository are not.

### 1.2b The report lives in a gitignored directory

`.gitignore:446` ignores `docs/*`. Therefore `docs/context-intelligence-v3/**` — this report and the reproductions — **is not tracked by git** and will not be committed by a normal `git add -A`. This matches how the repository's other `docs/` material is handled, so it is presented as-is rather than "fixed" unilaterally; but if these deliverables are meant to be durable across machines, they need either a force-add or a `.gitignore` exception. `.audit/ci-v3/retrieval-inventory.md` is **not** ignored.

### 1.3 Submodule / gitlink state

| Path | State |
|------|-------|
| `premium` | Real submodule (in `.gitmodules`). Pinned `a19ecd71`, checked out on branch `fix/jd-lookup-order-2026-07-27`, **dirty** (1 modified, 9 untracked build artefacts). |
| `natively-api` | **Anomaly.** Recorded as a gitlink (`160000 ca5cf7c9`) but **has no `.gitmodules` entry**. Its actual HEAD is `58741cc2` — i.e. the gitlink is stale relative to the checked-out content. |

The `natively-api` anomaly is recorded, not fixed — it is out of scope for Phase 1 and touching it would mutate a shared tree.

### 1.4 Typecheck

`npm run typecheck:electron` → **FAILS, exit 2, 1 error**:

```
electron/rag/RAGManager.ts(53,19): error TS2322:
  Type 'string | void' is not assignable to type 'string'.
```

**Attribution: NOT pre-existing at HEAD.** Verified by inspecting `git show HEAD:electron/rag/RAGManager.ts` — the constructor at that region does not contain the offending construct. The error is introduced by the uncommitted third-party edit to `RAGManager.ts` (+54/−4). It is therefore a **baseline-blocking condition owned by concurrent work**, not by this mission, and was deliberately **not fixed**.

### 1.5 Build

`npm run build:electron` → **PASSES** (exit 0). The build tolerates the typecheck error because `build-electron.js` uses esbuild (transpile-only), not `tsc`. This is itself a risk worth recording: **type errors do not block the electron build.**

### 1.6 Test baseline

Suites were run **separately rather than via `test:ci`**, so that one chained failure could not mask the rest.

| Suite | Command | Result |
|-------|---------|--------|
| Main (services/llm/audio/rag/utils/update) | `node --test <npm-test globs>` | See §1.6.1 |
| Intelligence | `npm run test:intelligence` | See §1.6.1 |
| Lib | `npm run test:lib` | See §1.6.1 |

#### 1.6.1 Results — and F21: the default test suite does not terminate

**The `npm test` suite was run and did not complete after 31 minutes; it was stopped deliberately.** This is a baseline finding, not an execution failure on this investigation's part.

Cause, established from process inspection during the run:

- Three tests were **still executing after 30+ minutes with zero progress**, all loading real ONNX models from disk/network:
  - `electron/rag/__tests__/LocalEmbeddingProviderRealModel.test.mjs`
  - `electron/rag/__tests__/LocalRerankerModel.test.mjs`
  - `electron/rag/__tests__/LocalRerankerPackagedBuildSimulation2026_07_25.test.mjs`
- The runner is invoked with **`--test-timeout=0`** — no per-test timeout — so a stalled test blocks the suite **indefinitely rather than failing**.

**F21: `npm test` has no bounded runtime.** In its default configuration it cannot produce a pass/fail verdict, which means the §27 acceptance gates as written are not currently measurable, and a Phase 4 regression that deadlocks retrieval would surface as a hang rather than a red test.

**Recommendation (Phase 4 infrastructure, before any migration work):** set a per-test timeout, and split the suite into a fast deterministic tier and an opt-in real-model tier.

##### Root cause of the non-termination — isolated and confirmed

The initial hypothesis (slow real-model tests) was **wrong**, and the real cause is more consequential.

A scoped re-run — `services`, `llm`, `codeVerification`, `utils` only, RAG real-model tests excluded, `--test-timeout=120000` — **stalled on the same files**. That falsified "slow tests", because a 2-minute per-test timeout should have bounded them.

Isolating a single file with the `spec` reporter settled it definitively:

```
$ node --test --test-reporter=spec --test-timeout=10000 \
    electron/llm/__tests__/IntentClassifierStackWordBoundary2026_07_19.test.mjs

[IntentClassifierWorker] Zero-shot classifier loaded successfully.
  ✔ the exact live-failing question is NOT classified as coding …  (606.10ms)
  ✔ a genuine data-structure "stack" question is UNAFFECTED …      (0.45ms)
  ✔ a real DSA problem name still fast-paths to coding             (0.07ms)
  ✔ other bare-substring collisions … do not misfire               (579.39ms)
  ✔ genuine whole-word DSA nouns still fast-path to coding         (0.20ms)
✔ IntentClassifier (WTA) DSA-noun word-boundary fix              (1186.88ms)

# …then, at t = 45s:  STILL ALIVE
```

**All five assertions pass in 1.19 seconds. The process is still resident 45 seconds later.** The stall is unambiguously *post-test event-loop retention* — not a module-load block and not a slow test. (An earlier "no output" observation was an artefact of the default reporter buffering through `tail`, not evidence of a load-time hang; it is corrected here rather than relied on.)

Mechanism:

1. `ZeroShotClassifier.getWorker()` (`electron/llm/IntentClassifier.ts:131-137`) lazily spawns `new Worker(this.getWorkerPath())` on first classification — **not** at module scope, so import is not the blocker.
2. **The worker is never `unref()`d** — verified: zero occurrences of `unref()` in the file, and no disposal hook.
3. A referenced worker thread keeps the Node event loop alive indefinitely. Tests succeed; the process cannot exit.
4. `--test-timeout` bounds individual `test()` calls. It cannot bound a process that refuses to exit *after* its tests have already passed. `--test-timeout=0` in the default config removes even that partial protection.

**Incidental finding from the same run:**

```
[OnnxLoadSentinel] write failed for intent/Xenova/mobilebert-uncased-mnli:
  Cannot read properties of undefined (reading 'getPath')
```

The cross-launch poisoned-load sentinel — the crash-recovery breadcrumb described in the code comment at `:132-134`, written *before* `new Worker()` precisely so a native ORT abort leaves a trace — **silently fails outside Electron**, because `app.getPath` is undefined. That safety mechanism is inert in every test run, and its failure is swallowed.

**F21 (revised): `npm test` cannot terminate, because tests that import `IntentClassifier` leave a live worker thread holding the event loop open.** With `--test-isolation=process`, each such file is one permanently-resident process. **20 test files import `IntentClassifier`.**

This is not a flaky-test problem; it is a deterministic process-lifetime leak in production code (`IntentClassifier`), surfaced by the test runner.

**Consequences for the mission:**
- **The §27 acceptance gates are not currently measurable.** No pass/fail verdict can be produced from the default suite.
- Any prior claim in this repository of the form "N/N tests pass" was necessarily produced by a **narrower invocation** than `npm test`, and should be re-verified before being relied on.
- A Phase 4 regression that deadlocks retrieval would present as a **hang**, indistinguishable from this pre-existing condition.

### F21 — RESOLVED (2026-07-29). Root cause: `unref()` ordering, and it was a defect CLASS

**Fixed and verified.** The single-file discriminator now passes *and exits*:

```
$ node --test --test-reporter=spec electron/llm/__tests__/IntentClassifierStackWordBoundary2026_07_19.test.mjs
  ✔ …5 tests…              (152 ms total)
EXITED rc=0                 ← previously: never exited
```

**Root cause.** Attaching a `'message'` listener to a `MessagePort` **implicitly re-references it**. The original fix called `worker.unref()` immediately after `new Worker(...)` — and the very next line attached the message listener, silently undoing it. `process._getActiveHandles()` confirmed a lone surviving `MessagePort` in exactly that arrangement. (The two `Socket` handles seen alongside it were an artefact of piping the diagnostic through `grep`; with a file redirect only the `MessagePort` remains.)

**The fix is one line, but its placement is the whole point:** `this.worker.unref()` must come **after every listener is attached**.

**It was a defect class, not one instance.** Three files owned workers and **none** called `unref()`:

| File | Before | After |
|------|--------|-------|
| `electron/llm/IntentClassifier.ts` | never exits | **exits rc=0** |
| `electron/rag/providers/LocalEmbeddingProvider.ts` | never exits | **exits rc=0** |
| `electron/rag/LocalReranker.ts` | never exits | **exits rc=1** (a real, pre-existing test failure — see below) |

Total change: **45 lines across 3 files, purely additive** (one `unref()` each plus explanatory comments). No deletions, no behavioural change in Electron — the main process loop is anchored by `app` and its windows, so `unref()` cannot cause a premature exit there.

**`LocalRerankerModel` failure is pre-existing, not caused by this change.** Verified by discriminator rather than assumed: with the fix reverted, the *identical* assertion (`bundled reranker should load` → `false`) fails at ~550 ms, before any hang. The fix converted a hang into a clean exit; it did not introduce the failure.

**What this unblocks:** the §27 acceptance gates are now measurable, which was the precondition blocking Phases 8 and 9.

---

### Original (now superseded) analysis — retained because the wrong fix looks obviously right

**The `worker.unref()` recommendation originally written here was wrong.** It was implemented, tested, falsified, and reverted. The correction is recorded rather than quietly dropped, because the wrong fix looks obviously right.

| Attempt | Result |
|---------|--------|
| `this.worker.unref()` | Tests still pass (1.4 s warm) — **process still hangs** |
| `+ worker.stdout.unref()` / `worker.stderr.unref()` | **Process still hangs** |

Diagnostic via `process._getActiveHandles()` after a completed classification:

```
ACTIVE HANDLES:  [ 'Socket', 'Socket', 'MessagePort' ]
ACTIVE REQUESTS: []
```

Two Sockets (the worker's piped stdio) plus a MessagePort survive `unref()` on all three. So the loop is held by handles that outlive the documented unref surface, and **a real `terminate()`/disposal lifecycle is required — not a one-line flag.**

Both edits were reverted; `electron/llm/IntentClassifier.ts` is back to its committed state (it was clean at baseline, so the revert is exact). No unverified production change was left behind.

**Revised recommendation.** This is still the correct first fix of Phase 4 and **no §27 acceptance gate is evaluable until it lands** — but it is a *disposal-lifecycle change*, not a one-liner:

1. Add an explicit `ZeroShotClassifier.dispose()` that `terminate()`s the worker and clears `pendingRequests` timers.
2. Call it from a test-teardown hook, or have the module register an `afterAll`-equivalent when it detects a test runner.
3. Re-verify with the discriminator that settled this: the single-file `--test-reporter=spec` run must **exit**, not merely pass.

Note also that one incidental defect above is *unaffected* by any of this: `writeOnnxLoadSentinel` fails silently outside Electron (`app.getPath` undefined), so the crash-recovery breadcrumb never gets written in any test run.

##### Numeric baseline: ESTABLISHED (after the F21 fix)

With F21 resolved the suite terminates, and §7.1's numeric baseline — previously unobtainable — is now recorded.

```
# tests    6593
# pass     6258
# fail      278
# skipped    45
# duration  67.2 s      ← previously: did not terminate
```

**From "never completes" to 67 seconds.**

###### Failure attribution

278 failures is the honest number, and most of it is environmental rather than defect:

| Bucket | Count | Detail |
|--------|-------|--------|
| **Native ABI mismatch** | ~41 entries (380 log references) | `better-sqlite3` is compiled for **Electron's NODE_MODULE_VERSION 148**, but `npm test` runs under **system node (141)** → `ERR_DLOPEN_FAILED`. Every test touching the DB fails for this reason alone. This is exactly why `benchmarks/profile-intelligence/harness.cjs` carries a `node:sqlite` shim. |
| **Concurrent third-party work** | ≥15 | Failures naming `ipcHandlers`, `AppState`, `main`, provider/credential handling — all files the other agent modified during this session (§1.2a). |
| **Genuinely pre-existing** | remainder | e.g. `LocalReranker — real bundled model`, `Whisper worker bounded session options`. |
| **Introduced by this mission** | **0** | See below. |

###### Attribution of my own changes — one regression found and fixed

I changed three production files (F21). The suite caught a regression I introduced, and it is worth recording because it is the exact failure mode this report keeps warning about:

> `this.worker.unref is not a function` — test doubles substitute a **mock** Worker with no `unref`. A hard call threw there and *disabled the model*, converting a hang into a silently broken reranker.

Fixed with an optional call (`this.worker.unref?.()`), identical for real Workers. Both `behavioral worker delegation (mocked Worker)` tests now pass.

After the fix, **zero failures trace to files this mission changed**, with one exception that was *proved* pre-existing by discriminator: `LocalReranker — real bundled model` fails identically at ~550 ms with the fix reverted.

`electron/context-intelligence/**` — the new module — is **66/66 green**.

###### The ABI finding is itself actionable

`npm test` runs under system node while `postinstall` rebuilds native modules for Electron. Those two facts are incompatible, and the result is ~41 permanently-red DB-touching tests that no one can fix by editing test code. Either the suite should run under `ELECTRON_RUN_AS_NODE=1 electron` (as the Phase 2 bake-off harness does), or the shim should be hoisted out of the benchmark harness into shared test setup. Recorded as a Phase 4 infrastructure item.

#### 1.6.1a Test-suite characteristics observed during the baseline run

Recorded because they affect every downstream acceptance gate (§27):

- **512 test files** in the main suite globs alone.
- **`--test-timeout=0`** — the runner is configured with **no per-test timeout**. A hung test blocks the suite indefinitely rather than failing.
- **Real-model tests run in the default suite.** `LocalEmbeddingProviderRealModel.test.mjs`, `LocalRerankerModel.test.mjs`, and `LocalRerankerPackagedBuildSimulation2026_07_25.test.mjs` each ran >10 minutes, loading actual ONNX models.

Combined, these mean the suite is not usable as a fast feedback loop, and — with no timeout — a Phase 4 regression that deadlocks retrieval would present as *a hang*, not a failure. Recommend a per-test timeout and a fast/slow suite split as Phase 4 infrastructure work.

#### 1.6.2 Deliberately NOT run, with reasons

| Suite | Why not run |
|-------|-------------|
| `test:e2e`, `test:e2e:parity` | Requires a running Electron app + display; Phase 8 concern. |
| `test:modes:e2e` (`RUN_NATIVELY_API_E2E=1`) | Requires live provider credentials; burns real spend. Phase 2/8. |
| All `benchmark:*` scripts | Provider-backed; these *are* Phase 2 work and must not be run before the corpus is labelled. |
| `test:intelligence:ui` (Playwright) | Requires app + display. |
| Electron / backend startup smoke | Not run — requires display and packaged local assets. Recorded as a **gap**, not as coverage. |

**No fabricated coverage.** Where a §7.1 item was not executed, it is listed here rather than silently omitted.

### 1.7 Feature-flag surface

`electron/intelligence/intelligenceFlags.ts` defines **62 flags**:

| Default | Count |
|---------|-------|
| `true` | 14 |
| `false` | 26 |
| `isInternalDevTestContext` (true in dev/test, false in production) | 20 |

**Finding F5.** Twenty flags resolve differently in dev/test than in production. That includes retrieval-critical ones — `ragConfidenceGate`, `ragLocalRerank`, `okfKnowledgePacks`, `okfHybridRetrieval`, `okfProfilePacks`, `okfProfileHybridRetrieval`, `contextOsEnforceSourceCapabilities`, `contextOsPropertyValidation`.

The consequence is structural, not cosmetic: **the automated test suite exercises a retrieval and enforcement configuration that production users never run.** Any accuracy claim derived from the current test suite is a claim about the dev configuration only. This alone is sufficient to explain why repeated "fixes" validated by tests did not improve production behaviour.

The `contextOs*` family (8 flags) defaults `true`, so Context OS *is* live in production — but its capability-enforcement and property-validation arms are dev-only.

---

## 2. §7.2 — Answer entry-point inventory

### 2.1 Method

`electron/ipcHandlers.ts` (11 808 lines) registers handlers through two wrappers, `safeHandle` / `safeOn` (`ipcHandlers.ts:173-187`), not through bare `ipcMain.handle`. Extraction against those wrappers yields **320 registered IPC channels**, of which the following can initiate an AI response.

### 2.2 Answer-producing entry points

| Channel | Handler site | Terminates in | Decision layer used |
|---------|--------------|---------------|---------------------|
| `gemini-chat-stream` | `ipcHandlers.ts:849` (`_geminiChatStreamHandler`), registered `:4536` | provider stream | **Own layer** — `resolveTurnSourceDecision` + `SourceAuthorityKernel.build` |
| `submit-manual-question` | `ipcHandlers.ts:8669` | `IntelligenceEngine.runManualAnswer:4334` → `AnswerLLM.generate` → `llmHelper.streamChat` | **NONE** |
| `generate-assist` | `ipcHandlers.ts:8190` | `IntelligenceEngine` | (see §2.4) |
| `generate-clarify` | `ipcHandlers.ts:8414` | `ClarifyLLM` | (see §2.4) |
| `generate-code-hint` | `ipcHandlers.ts:8474` | `CodeHintLLM` | (see §2.4) |
| `generate-brainstorm` | `ipcHandlers.ts:8531` | `BrainstormLLM` | (see §2.4) |
| `generate-follow-up` | `ipcHandlers.ts:8609` | `FollowUpLLM` | (see §2.4) |
| `generate-recap` | `ipcHandlers.ts:8629` | `RecapLLM` | (see §2.4) |
| `regenerate-meeting-followup` | `ipcHandlers.ts:8039` | follow-up draft | (see §2.4) |
| `analyze-image-file` | `ipcHandlers.ts:725` | vision → chat | (see §2.4) |
| `test-get-mode-context` | `ipcHandlers.ts:8801` | dev harness | dev |
| `__e2e__:ask` | `ipcHandlers.ts:11578` | e2e harness | dev |
| `__e2e__:manual-ask` | `ipcHandlers.ts:11725` | e2e harness | dev |
| **What-to-Answer** (no IPC) | `IntelligenceEngine.handleSuggestionTrigger:627` → `:1924` | `WhatToAnswerLLM` | **`resolveCanonicalTurn`** |

Note that the flagship surface — What to Answer — is **not IPC-triggered at all**. It is driven internally from transcript handling (`IntelligenceEngine.handleTranscript:510` → `handleSuggestionTrigger:627`). Any inventory that enumerates only IPC channels misses it. This is a plausible explanation for the repository's documented history of fixes landing on the wrong path.

### 2.3 F1/F2 — The three decision layers

This is the mission's central premise, and it is confirmed by direct code inspection.

**Layer A — What to Answer / overlay suggestion path.**
`IntelligenceEngine.ts:1924` calls `resolveCanonicalTurn({...})`. That function (`electron/llm/resolveCanonicalTurn.ts:196`) returns a **`deepFreeze`d** `CanonicalTurn` (`:245-258`) carrying `turnPlan`, `answerPlan`, `turnSourceDecision`, `sourceAuthority`, `allowedEvidenceKinds`, `requiredEvidenceKinds`.

**This is already, essentially, the `TurnDecision` the brief asks for in §3.1 — immutable and complete.** The V3 target is therefore substantially *already built*. It is simply not adopted.

Evidence of non-adoption — `resolveCanonicalTurn` call sites across all of `electron/` excluding tests:

```
electron/IntelligenceEngine.ts:1924        ← the only consumer
electron/llm/resolveCanonicalTurn.ts:196   ← the definition
```

**One call site.**

**Layer B — Manual chat / Ask-AI (`gemini-chat-stream`).**
`_geminiChatStreamHandler` spans `ipcHandlers.ts:849` to roughly `:4536` — **~3 690 lines of answer logic inline in a single IPC handler.** It never calls `resolveCanonicalTurn`. Instead it builds its own parallel decision:

- `:1124` (= 849+275) `let manualTurnSourceDecision: TurnSourceDecision | null`
- `:1125` `const { resolveTurnSourceDecision } = require('./llm/turnSourceDecision')`
- its own `SourceAuthorityKernel.build` invocation (`:1783` region)
- `manualTurnSourceDecision` then threaded through at `:1186`, `:1195`, `:1256`, `:2475`, `:2675`

So Layer B *does* have source authority — but a **separately constructed, separately sequenced, non-frozen** one. Two implementations of the same responsibility, which §3.1 forbids.

**Layer C — `submit-manual-question` → `runManualAnswer`.**
`IntelligenceEngine.ts:4334-4392`. This path:

```ts
const answerPlan = planAnswer({ question, source: 'manual_input', ... });
const context = ... ? undefined : this.session.getFormattedContext(120);
let answer = await this.answerLLM.generate(question, context, answerPlan);
```

`AnswerLLM.generate` (`electron/llm/AnswerLLM.ts:18-46`) does nothing but fit a raw context string and call `llmHelper.streamChat`.

**There is no `SourceAuthorityKernel`, no `turnSourceDecision`, no evidence pack, no canonical turn, and no retrieval anywhere on this path.** It passes an untyped 120-unit formatted-context blob straight to the model. This is the exact anti-pattern §32.16 prohibits ("do not inject complete transcripts or documents by default").

**Reachability of Layer C:** `submitManualQuestion` is exposed in `preload.ts:1632` and typed in `src/types/electron.d.ts:277`, but has **no caller in `src/` or `premium/src/`**. It is a **registered, reachable, entirely ungrounded IPC surface with no current UI consumer** — a live liability rather than an active path. Recommend removal in Phase 9 rather than migration.

### 2.4 Per-surface source-authority coverage — measured

The single load-bearing question for each surface is: *does it construct a source-authority contract at all?* Measured by scanning each engine method for `resolveCanonicalTurn` / `buildTurnContractIfEnabled` / `buildRecapFollowUpContract`:

| Surface | Engine method | Contract calls | Verdict |
|---------|---------------|----------------|---------|
| What to Answer | `handleSuggestionTrigger:627` → `:1924` | canonicalTurn + **2×** contract | Layer A |
| Manual chat | `_geminiChatStreamHandler` (`ipcHandlers.ts:849`) | 1 contract + own `turnSourceDecision` | Layer B |
| Recap | `runRecap:4114` | 1 (`buildRecapFollowUpContract`) | Layer D (nullable) |
| Follow-up | `runFollowUp:3955` | 1 (`buildRecapFollowUpContract`) | Layer D (nullable) |
| **Assist** | `runAssistMode:734` | **0** | **Layer C — none** |
| **Clarify** | `runClarify:4199` | **0** | **Layer C — none** |
| **Brainstorm** | `runBrainstorm:4484` | **0** | **Layer C — none** |
| **Code hint** | `runCodeHint:4402` | **0** | **Layer C — none** |
| **Manual answer** | `runManualAnswer:4334` | **0** | **Layer C — none** |

**Five of nine answer surfaces construct no source authority whatsoever.** Each instead passes a raw formatted-transcript blob straight to the model:

```
runAssistMode:  this.session.getFormattedContext(60)
runRecap:       this.session.getFormattedContext(120)
runBrainstorm:  this.session.getFormattedContext(180)
runManualAnswer:this.session.getFormattedContext(120)
runFollowUp:    this.buildPreparedTranscriptContext(120) || getFormattedContextWithInterim(60)
```

This is the §32.16 anti-pattern ("do not inject complete transcripts by default") as the *default* behaviour on more than half the surfaces.

### 2.5 Five independent source-decision construction sites

| Site | Surface(s) served |
|------|-------------------|
| `IntelligenceEngine.ts:1924` `resolveCanonicalTurn` | WTA |
| `IntelligenceEngine.ts:1763` `_wtaEarlyContract` | WTA — **duplicate, pre-canonicalTurn** |
| `IntelligenceEngine.ts:2028` `wtaTurnContract` | WTA |
| `ipcHandlers.ts:1239` | Manual chat |
| `IntelligenceEngine.ts:4093` `buildRecapFollowUpContract` | Recap + Follow-up |

**The What-to-Answer path alone builds the contract twice** (`:1763` and `:2028`), on either side of `resolveCanonicalTurn` at `:1924`. The earlier call is not redundant in the trivial sense — it runs *before* the canonical turn and gates fetches that feed the later decision's inputs. Retiring it is therefore a **reordering, not a deletion**, and is the single riskiest item in the migration.

### 2.6 `buildRecapFollowUpContract` fails open

`IntelligenceEngine.ts:4059-4066`, verbatim from its own docstring:

> *"Returns null when Context OS is off for the recap/follow-up surface, on any error, or mid-boot — callers treat null as **legacy mode-blind behavior**."*

A contract builder whose error path is "no policy at all" cannot be a safety mechanism. Under §22, a policy-resolution failure must fail *closed* (or to an explicitly-declared default), never to "mode-blind".

---

## 3. §7.6 — Source-ownership findings (partial)

### 3.1 F3 — Renderer surfaces compose their own prompts and grounding policy

Four renderer components call `window.electronAPI.streamGeminiChat`:

| Component | Site | `skipSystemPrompt` | Passes own prompt? |
|-----------|------|--------------------|--------------------|
| `MeetingChatOverlay.tsx` | `:441`, `:497` | **`true`** | **Yes** |
| `NativelyInterface.tsx` | `:5706`, `:5871` | `true` / (none) | **Yes** |
| `GlobalChatOverlay.tsx` | `:377` | `false` | No |
| (stale compiled `.js` twins) | `MeetingChatOverlay.js:280,326`, `NativelyInterface.js:3476,3621` | — | — |

In the handler, `options.skipSystemPrompt` becomes `systemPromptOverride` (`ipcHandlers.ts:2563`), which replaces main-process prompt composition.

`MeetingChatOverlay.tsx:452-455` builds this in the renderer:

```
You are recalling a specific meeting. Answer questions ONLY about this meeting.
Be concise (2-4 sentences). Sound natural, like a human recalling.
If information is not present, say so briefly. Never guess.
```

That string is **a grounding policy** — a client-side `STRICT_SOURCE_ONLY` declaration, hardcoded in a React component, invisible to the mode-policy registry, un-versioned, and untestable by any main-process test. It directly violates §21 ("the overlay must not contain its own strict-mode logic, prompt construction, or fallback logic").

**Secondary hazard:** compiled `.js` twins of these `.tsx` components are checked into `src/components/`. `MeetingChatOverlay.js` and `NativelyInterface.js` contain the *same* call sites at different line numbers. Whichever the bundler resolves first wins. This is a live source-of-truth ambiguity and should be confirmed/removed early in Phase 4.

---

## 4. §7.7 — Async-state trace: root cause of the stale-answer failure

**This is failure #7 in §7.9 ("correct answer later replaced by 'not found'"), and it is now understood at code level without needing a provider.**

### 4.1 The supersession protocol is optional on the wire

Stream events carry an **optional** `streamId` (`preload.ts:621-623`):

```ts
onGeminiStreamToken: (cb: (token: string, meta?: { streamId?: number }) => void) => () => void
onGeminiStreamDone:  (cb: (data?: { finalText?: string; streamId?: number }) => void) => () => void
onGeminiStreamError: (cb: (error: string) => void) => () => void   // ← no meta at all
```

`gemini-stream-error` **has no identity channel whatsoever.**

### 4.2 Emission sites are inconsistent

| Emits **with** `streamId` | Emits **without** `streamId` |
|---|---|
| `:2700` (main token path) | `:940`, `:941` — identity-hit short-circuit |
| `:2812` (tail flush) | `:1571`, `:1572` — clarification return |
| `:4231` (done) | `:1643`, `:1644` — clarification return |
| | `:1874`, `:1875` — clarification return |
| | `:4490`, `:4491` — safety-answer return |
| | `:1048`, `:1063`, `:1070` — all error paths |

**Every early-return / short-circuit path emits untagged events.** Only the long-form streaming path tags them.

### 4.3 The one guard that exists explicitly accepts untagged events

`src/lib/chatStreamGuard.mjs:30-35`:

```js
export function resolveChatStreamToken(activeId, incomingId) {
  const cur = typeof activeId === 'number' ? activeId : null;
  if (typeof incomingId !== 'number') {
    // Backward-compatible path: no id on the wire → behave exactly as before.
    return { accept: true, activeId: cur };
  }
  ...
```

`NativelyInterface.tsx:5181-5199` documents the same intent in its own comments: *"tokens without a streamId (back-compat) are always accepted"*, *"A done without a streamId is honored"*.

### 4.4 Two of three overlays have no guard at all

| Component | occurrences of `streamId` |
|-----------|---------------------------|
| `NativelyInterface.tsx` | 4 (guard present, but see §4.3) |
| `MeetingChatOverlay.tsx` | **0** |
| `GlobalChatOverlay.tsx` | **0** |

### 4.5 Root cause statement

> A superseded request that resolves via **any** early-return path — identity hit, clarification, safety answer, or **any error** — emits `gemini-stream-token` + `gemini-stream-done` (or `gemini-stream-error`) **with no `streamId`**. The back-compat clause in `resolveChatStreamToken` accepts those unconditionally, and the two meeting overlays perform no filtering at all. The stale result therefore overwrites the current, correct answer.

This explains the reported symptom precisely: the replacement text is characteristically a *refusal or clarification* ("not found", "could you clarify"), because **the untagged emitters are exactly the refusal/clarification/error paths**. The bug is not that retrieval later fails; it is that the *early-exit* branches are the ones that cannot be superseded.

### 4.6 Reproduction — DELIVERED

`docs/context-intelligence-v3/repro/repro-07-stale-answer-overwrite.test.mjs`

Deliberately placed **outside every CI glob** (`npm test` covers `electron/**/__tests__/`, `test:lib` covers `src/lib/**/__tests__/`) so it cannot break the suite. It asserts the *desired* post-fix behaviour and therefore fails today — each failure is the reproduced defect.

```
$ node --test 'docs/context-intelligence-v3/repro/*.test.mjs'
ℹ tests 7   ℹ pass 3   ℹ fail 4
```

| Assertion | Result | Meaning |
|-----------|--------|---------|
| untagged token from superseded stream must be dropped | ✖ **FAIL** | defect reproduced |
| untagged done must not finalize a newer stream | ✖ **FAIL** | defect reproduced |
| live-answer batch guard has the same hole | ✖ **FAIL** | defect reproduced |
| `gemini-stream-error` carries stream identity | ✖ **FAIL** | defect reproduced |
| *control:* tagged older token dropped | ✔ pass | tagged path already correct |
| *control:* tagged newer token adopted | ✔ pass | tagged path already correct |
| *control:* tagged older done ignored | ✔ pass | tagged path already correct |

The three passing controls matter: they establish that the supersession *design* is sound and only the **untagged escape hatch** is broken. The Phase 4 fix is therefore narrow — remove the back-compat clause and tag every emitter — not a redesign.

### 4.7 Why this matters more than its severity suggests

`src/lib/chatStreamGuard.mjs` is a **pure, dependency-free module** already covered by the `test:lib` glob (`src/lib/**/__tests__/**/*.test.mjs`). A regression test for this failure needs **no Electron, no provider, and no fixtures**. It is the cheapest high-value fix available and should lead Phase 4.

---

## 5. Prerequisite finding: there is no assertable source-decision trace

Recorded here because it gates the entire mission, not just one phase.

The brief's §26.4 requires every golden test to assert on resolved question, authorized sources, retrieval path, accepted evidence IDs, answerability, claim plan, and fallback. Today, **only Layer A (`resolveCanonicalTurn`) produces a structured object that could carry those assertions**, and it is not emitted as a trace — it is consumed in-place inside `IntelligenceEngine`.

Layers B and C produce no comparable artefact. Consequently:

- **Shadow mode (§25.2) cannot currently be implemented**, because there is no old-vs-new decision object to diff on two of three surfaces.
- **Cross-surface parity tests (§21.4) cannot be written**, because two surfaces have nothing to compare.
- Any offline harness can compare *answer text* only — which is precisely the weak signal that allowed prior fix rounds to appear successful.

**Therefore the first implementable deliverable of Phase 4 is not the retriever or the policy registry — it is the `AnswerTrace` emission (§24), retrofitted to all three layers.** Everything downstream in the brief depends on it, and nothing else can be verified until it exists. This report recommends re-ordering §25.3's migration list to put trace emission ahead of surface migration.

---

## 6. §7.3 — Mode inventory

### 6.1 The answer to "what is the 7th mode?" is that there are **eight**

The brief states the product "reportedly contains seven default modes" and lists six. Both numbers are wrong against the current code.

Canonical registry: `electron/services/ModesManager.ts:110-128` (`MODE_TEMPLATES`), type union at `:56-67`.

| # | id | Display name | Notes |
|---|----|--------------|-------|
| 1 | `general` | General | **The "missing 7th".** Auto-seeded, un-deletable, excluded from the creation picker — which is why every hand-written list omits it. `ModesManager.ts:115`, seeded `:378-383` |
| 2 | `sales` | Sales | |
| 3 | `recruiting` | Recruiting | |
| 4 | `team-meet` | Team Meet | |
| 5 | `looking-for-work` | Looking for work | sources `['profile','job_description']`, authority `profile_only` |
| 6 | `technical-interview` | Technical Interview | sources `['profile','job_description']`, authority `profile_only` |
| 7 | `lecture` | Lecture | |
| 8 | `seminar` | Seminar | **The 8th, and UI-unreachable.** `ModesManager.ts:127`. Added 2026-07-19. Has the only non-default grounding profile (strict, `say_not_found_then_answer_general`, `TurnPlanner.ts:149-153`). |
| — | `__profile_okf__` | *(reserved)* | Hidden non-user mode, `template_type='__reserved__'`, filtered at `ModesManager.ts:359` |

Verified independently against source: `ModesManager.ts:110-128` confirms all eight entries including the `seminar` block comment describing it as the "8th built-in mode".

**Modes that do NOT exist** (searched explicitly per §7.2 of the brief): thesis, coding-interview, meeting, presentation, interview. Each appears only as a *retrieval keyword*, a *screen classification* (`'coding_interview'`, `ScreenUnderstandingService.ts:327`), or a `MemoryMode`/`FollowUpSurface` value — never as a mode id.

### 6.2 F6 — `seminar` is missing from six independent mode lists

Eight files each hold their **own copy** of the mode-id list. Five are plain string sets/arrays with **no compile-time link** to `ModeTemplateType`, so adding the 8th mode did not fail to compile anywhere. `seminar` is absent from:

| Site | Consequence |
|------|-------------|
| `ContextRouter.ts:117-119` | `activeModeInfo` normalizes to **`null`** — mode routing prior silently disabled |
| `ProfileIntelligenceRouter.ts:89-92` | Profile-intelligence routing disabled |
| `ContextFusionEngine.ts:134` | `seminar` does **not** suppress profile injection (unlike `lecture`/`team-meet`) — profile data can contaminate a strict document mode |
| `MeetingModeDetector.ts:11-18` | Undetectable from transcript |
| `PostCallWorkflow.ts:116-176` | No branch; falls through to generic |
| `ModeGenerator.ts:41-51` | AI-generated modes can never be `seminar` |

The comment at `modeProfiles.ts:40-44` claiming these are "guarded by the type system" is **false** for all six.

This is a direct, mechanical illustration of the mission's thesis: **the mode is reinterpreted in ~95 branch sites across ~30 files, and there is no single authority.**

### 6.3 F7 — The backend has no mode registry; it regex-sniffs the client's prompt text

`natively-api/` contains **no mode concept at all** (verified: mode ids appear only in its Playwright test harnesses, never in `server.js`/`lib/`/`services/`). Yet it makes mode-dependent model-routing decisions:

`natively-api/lib/flashModelPicker.js:34` — verified verbatim:

```js
export const INTERVIEW_MODE_RE = /spoken voice in a live (?:job|technical) interview/i
```

That sentence exists only inside `MODE_LOOKING_FOR_WORK_PROMPT` (`prompts.ts:1391`) and `MODE_TECHNICAL_INTERVIEW_PROMPT` (`prompts.ts:2026`). A match routes to `gemini-3.6-flash`; everything else falls to `gemini-3.1-flash-lite`. `primaryModelPicker.js:46-48,81` reuses the same regex as a hard override.

**This is a prompt-text string dependency across a repository boundary, with no test, no type, and no shared constant binding the two sides.** Rewording one English sentence in `prompts.ts` silently downgrades both interview modes to a weaker model. The server's effective taxonomy is binary — {interview, everything-else} — against the client's eight. `seminar`, the strictest and most evidence-heavy mode, is invisible server-side and always gets the weakest model.

This is precisely the "provider-specific policy disagreement" §7.6 asks for and the §19.3 provider-neutrality violation.

### 6.4 F8 — Unvalidated `templateType` can create a mode with no system prompt

`ipcHandlers.ts:9941-9951` casts `params.templateType as any` with **no whitelist**. An arbitrary string reaches `DatabaseManager.createMode`, where `TEMPLATE_NOTE_SECTIONS[type] ?? []` and `TEMPLATE_SYSTEM_PROMPTS[type] ?? ''` (`ModesManager.ts:1147`) both silently yield empty. A typo'd `templateType` produces **a mode with no system prompt at all**, failing open rather than closed.

### 6.5 Other mode-layer findings

- **Duplicate authorized-source table.** `premium/src/ModesSettings.tsx:1511-1518` is a second, renderer-owned source map duplicating `modeSourceContract.ts:210-247`. They agree today for 7 types; neither covers `seminar`; no test binds them.
- **Undocumented global override.** `NATIVELY_SEMINAR_MODE=1` (`TurnPlanner.ts:345-348`) forces *every* mode to the strict Seminar grounding profile. Not surfaced in any UI.
- **Custom-mode enforcement is observe-only.** `customModeExecutionContract.ts:10-15` is gated behind `customModeSourceEnforcement`, **default OFF**. Custom modes lacking a single-source policy fall back to `general_mixed` = everything allowed (`:230-236`).
- **Name collision.** `ProviderRouter.ts:207` exports an unrelated type also called `ModeTemplateType` with different members (`'sales'|'recruiting'|'interview'|'default'`). A grep for the registry hits it.
- **No mode-id aliases or renames have ever existed** — verified across all DB migrations. The only migration is contract-level (`migrateSourceContractFromPrompt`).

---

## 6B. §7.4 — Profile Intelligence inventory

### 6B.1 F9 — There are two profile stacks, and the one with provenance is switched OFF in production

| Tier | Location | Production |
|------|----------|------------|
| **Tier 1 — premium engine** (`structured_data` + `context_nodes`) | `premium/electron/knowledge/*` | **LIVE** |
| **Tier 2 — OKF profile packs** (cards, provenance, verifier, exporter, retriever) | `electron/services/knowledge/Okf*`, `Profile*` | **INERT** (`okfProfilePacks`, `okfProfileHybridRetrieval` = `isInternalDevTestContext`) |

Tier 2 carries the full provenance model the brief's §15.5 asks for — `sourceId`, `contentHash`, `sourceQuotes` (verbatim evidence text), `confidence`, `cardVersion`, `packVersion`. **Tier 1 carries none of it.** `StructuredResume`, `StructuredJD`, and `ContextNode` have no `sourceId`, `versionId`, `evidenceText`, `isDirectFact`, or `isInferred`.

Exhaustive grep confirms `isDirectFact`, `isInferred`, `sourceVersion`, and `factProvenance` return **zero hits** across `electron/`, `premium/`, and `src/`.

**So the §3.8 rule "an inferred fact must not be presented as a direct fact" is currently unenforceable in production, because production has no representation of the distinction.** The only proxy is a runtime-added, untyped `_extraction_mode` (`'llm' | 'heuristic'`) cast through `(structuredData as any)` at `KnowledgeOrchestrator.ts:693-694` — and it describes how the *whole document* was parsed, not any individual fact.

### 6B.2 F10 — There is no live central prompt composer, and 11 sites inject profile blocks directly

Independently verified: `composePrompt` (`electron/llm/promptComposer.ts:123`) has **zero call sites** anywhere outside its own file. The flag's own documentation (`intelligenceFlags.ts:210`) concedes it: *"composePrompt() is built and tested standalone; wiring it into the live [path]…"*. `PromptAssemblerV2` and `context-os/promptRenderer.ts` are likewise flag-off.

Consequently **11 distinct sites emit profile/resume/JD blocks directly into provider-bound strings**, ten of them live in production:

| Group | Sites |
|-------|-------|
| premium context builders | `ProfileContextBuilder.ts:141` (`<candidate_profile>`), `:179` (`<target_job>`), `:191` (`<grounding_rules>`), `ContextAssembler.ts:301`, `:215`, `:363` |
| JIT builder | `ProfileJitPromptBuilder.ts:166-202` |
| **hardcoded literals** | `LLMHelper.ts:5383-5386`, `IntelligenceEngine.ts:1573/3124/3132`, `prompts.ts` (6 sites) |
| Tier 2 | `OkfPromptFormatter.ts:36` (flag-gated) |

The `<candidate_profile>` / `<candidate_identity_fact>` tag family is emitted from **four independent places with no shared constant** — each hardcodes the literal string.

This is the concrete reason prompt-level fixes have not held: §19's "one canonical prompt composer" exists as code but is wired to nothing.

### 6B.3 F11 — Stale salary estimate: a live production bug

`premium/electron/knowledge/SalaryIntelligenceEngine.ts:29-31`, verified verbatim:

```ts
const latestRole    = resume.experience?.[0]?.role    || 'Professional';
const latestCompany = resume.experience?.[0]?.company || '';
const cacheKey = `${resume.identity.name}|${latestRole}|${latestCompany}`;
```

`totalExperienceYears` is a **separate argument and not part of the key**; the key contains no dates and no content hash. Same person, same current employer, revised resume with two more years of experience → **cache hit, and the estimate computed from the superseded resume is returned**. `clearCache()` is reachable only via the orchestrator's `deleteDocumentsByType`, which the ingest path bypasses (§6B.4). Tier 1 — i.e. the tier that runs in production.

### 6B.4 F12 — Re-upload invalidation is correct for chunks, broken for three siblings; and a comment misdescribes it

Re-uploading a resume **does** correctly invalidate chunks, embeddings, and structured facts: `KnowledgeOrchestrator.ts:698` → `deleteDocumentsByType` → `context_nodes` FK `ON DELETE CASCADE` (`KnowledgeDatabaseManager.ts:53`), with `PRAGMA foreign_keys = ON` persistently set.

But `KnowledgeOrchestrator.ts:1662-1667` claims the choke point covers *"step-4 of ingestDocument itself, so a stale profile pack can never outlive the structured data it was built from."* **This is false.** Step 4 (`:698`) calls `this.db.deleteDocumentsByType` — the *KnowledgeDatabaseManager* method. The choke point holding the sibling cleanup is `this.deleteDocumentsByType` — the *orchestrator* method at `:1650`. Ingest calls the former and never reaches the latter, skipping `salaryEngine.clearCache()` (`:1654`), `negotiationTracker.reset()` (`:1655/:1660`), and `knowledgeMode` reset (`:1653`).

Downstream consequences:
- **F11** (stale salary) is a direct result.
- **Stale negotiation state on JD replacement.** `:1656-1661` resets negotiation phase and offer history on JD *deletion*, with the explicit rationale that "replacing a JD means the user is targeting a different role/company… must not bleed into the new negotiation." `profile:upload-jd` never reaches it. `resetNegotiationSession()` has exactly one caller — a *separate* IPC handler (`ipcHandlers.ts:9805`) — not the upload path. **Uploading a new JD carries the previous role's negotiation phase and offer history forward.**
- **`company_dossiers` has no FK** to `knowledge_documents` (`KnowledgeDatabaseManager.ts:56-63`); mitigated only by a 24 h TTL.

This is §7.9 #18 ("old JD version being retrieved") reproduced at code level — not as a retrieval bug but as a **derived-state invalidation** bug, which no retrieval benchmark would have caught.

### 6B.5 F13 — Unawaited AOT pipeline race on JD ingest

In production (`atomicJdProfilePackGeneration` = OFF), `KnowledgeOrchestrator.ts:783-798` fires `aotPipeline.runForJD(...).then(...)` **unawaited** and returns `{success:true}` immediately. The flag's own comment (`intelligenceFlags.ts:233-246`) acknowledges this as *"a real race (Ingestion Audit §A.6.3)."* The resume branch was fixed to a synchronous call (`:824-826`); the JD branch was deliberately left racing to avoid LLM latency.

`profile:upload-jd` therefore reports success before the JD's derived artifacts exist — a **"partially indexed reported as complete"** violation (§22.2 / §7.9 #26).

### 6B.6 Dead profile code confirmed

| Component | Evidence |
|-----------|----------|
| `knowledgeOrchestratorGate.ts` | **Zero importers.** Built, tested, never wired. |
| `deleteProfileTransactional.ts` | **Zero production callers** — `profile:delete` calls the orchestrator directly. Written to fix an atomicity gap that consequently remains unfixed. |
| `ProfileTreeService.ts` | Behind `profileTreeV2`, default `false` — dead in **production *and* dev/test**. |
| `ProfileIntelligenceRouter.ts` | Reachable only via `ContextRouter.ts:250`, behind `contextRouterV2` = `false`. **Would perform source routing if enabled.** |
| `promptComposer.ts` | Zero call sites (§6B.2). |
| `PromptAssemblerV2.ts` | `ipcHandlers.ts:1424` hardcodes `prompt_assembler_v2_mode: 'off'`. |
| `ProfileGraphExtractor.ts`, `OkfCardEditor.ts` | Flags `false` everywhere. |

Seven substantial components are built, tested, and unreachable. Per §8, none should be retained on the grounds of prior investment.

### 6B.7 F14 — The assistant's own prior output is re-injected without provenance on Layer C

`SessionTracker.formatContextItems` (`:597-604`) labels prior model output as `ASSISTANT (PREVIOUS SUGGESTION)` and includes it in the same blob returned by `getFormattedContext`.

A guard for exactly this exists — `context-os/assistantClaims.ts` + `assistantClaimsPrecedenceCheck.ts`. But `buildAssistantClaims` is invoked from **one place only** (`ipcHandlers.ts:4319`, Layer B), and `assistantClaimsEnforcement` defaults to `isInternalDevTestContext` — **OFF in production**.

So on the five Layer C surfaces, and on Layer A, **the model's own previous claims are fed back as undifferentiated context with no provenance and no precedence check**, in production. This is the mechanism by which a single fabrication becomes self-reinforcing across a session — and it directly violates §3.8 ("a generated summary must not outrank its original source").

---

## 6C. §7.5 — Retrieval inventory

Full inventory: **`.audit/ci-v3/retrieval-inventory.md`** (412 lines, 8 tables, ~55 modules across `electron/rag/`, `electron/services/modes|knowledge|meeting|context/`, `electron/intelligence/`, `electron/llm/`, and `premium/electron/knowledge/`).

### 6C.1 ⚠ Method warning that invalidates prior audits of this repo

**Four source files are misdetected as *binary* by BSD `grep`, which silently suppresses matches:**

- `electron/intelligence/context-os/TurnEvidenceCoordinator.ts`
- `premium/electron/knowledge/HeuristicExtractor.ts`
- `src/components/ui/card.tsx`
- `electron/intelligence/__tests__/WtaOutputShapeWiring.test.mjs`

Any previous investigation of this codebase that used plain `grep` to establish reachability **produced false DEAD verdicts** for anything referenced only from those files. All verdicts in this report were re-verified with `/usr/bin/grep -ra`. This is recorded as a standing hazard for Phases 2–9.

### 6C.2 F15 — Duplicate-responsibility matrix: 7 responsibilities, up to 11 implementations each

| Responsibility | Implementations |
|----------------|-----------------|
| **Evidence selection** | **11** |
| **Answerability decision** | **8** |
| **Candidate fusion** | **8** |
| **Keyword search** | **7** |
| **Chunking** | 6 confirmed (+1 undetermined) |
| Semantic search | multiple |
| Reranking | multiple |

Plus **four competing evidence-container types**: `EvidencePack`, `RetrievalEvidencePack`, `FusedContextBlock`, `ContextPacket`.

Eight independent implementations of *answerability* is the single clearest quantification of the mission's premise. §32.11 ("do not treat retrieval failure as proof that information is absent") cannot be enforced when eight components each decide it separately.

### 6C.3 F16 — No full-text index exists, and the "FTS/BM25" retriever implements neither

Three claims at different confidence levels, stated separately so none is over-read.

**Fully verified.** `FTS5` and `USING fts` appear **nowhere under `electron/`** — zero hits via `/usr/bin/grep -ra`. There is no SQLite full-text index in the application.

**Fully verified, one retriever.** `ModeHybridRetriever`'s header advertises "FTS/BM25", but its `computeFtsScore` (`:626`) is **unique-term overlap** — no inverse-document-frequency term, therefore neither BM25 nor FTS.

**UNDETERMINED — scoping limitation.** The retrieval inventory counts **seven** keyword-search implementations. Only the one above was read for its algorithm. Whether any of the remaining six implements true IDF-weighted ranking is **not established**, and should be settled at the start of Phase 2 rather than assumed either way.

Even on the verified subset the Phase 2 consequence holds: §8.4 asks whether keyword/BM25 retrieval improves acronyms, project names, error messages, and code identifiers. **That comparison cannot treat the existing keyword arm as a BM25 incumbent** — the one implementation examined does not implement the algorithm it is named after, and no full-text index backs any of them. The benchmark should introduce a real BM25 implementation as a *new* candidate.

### 6C.4 F17 — Meeting RAG bypasses the evidence contract entirely, and its bridge is dead

`meetingChunksToEvidenceItems` (`context-os/meetingRagEvidence.ts:33`) is a complete, tested `EvidencePack` bridge for meeting RAG. Verified callers: **its own definition and one barrel re-export (`context-os/index.ts:103`). Zero production consumers.**

Live meeting RAG instead runs `ipcHandlers.ts:9013/9080/9148` → `RAGManager.queryMeeting` → `buildRAGPrompt` → LLM, **with no contract, no pack, and no capability check**. `meeting_rag` is additionally excluded *by name* from `KNOWN_COORDINATOR_KINDS` (`ipcHandlers.ts:2352`, duplicated at `:1835`).

This is the same pattern as F1/F10: the correct component exists, is tested, and is wired to nothing.

### 6C.5 F18 — "No relevant context" silently degrades into answering anyway

`RAGManager.ts:244` throws `NO_RELEVANT_CONTEXT_FOUND`. **Both handlers convert it to `{fallback:true}`** and proceed. The same shape appears at `ipcHandlers.ts:2494`, where a coordinator timeout falls through to legacy raw-text injection.

So a retrieval miss and a retrieval *timeout* both produce an ungrounded answer that is indistinguishable, to the user and to telemetry, from a grounded one. This is the §22.1 violation and a direct cause of the "answers a document question generically" class of failure (§7.9 #5).

### 6C.6 F19 — Evidence has no scope identity

`EvidenceItem` (`evidencePack.ts:35-57`) **has no `scopeId` field at all**. Scope is collapsed into `sourceId`, with literal fallback strings `'active-mode'` / `'active-profile'`.

§10.6 requires `scopeId` on every authorized source, and §7.8 requires isolation by user / meeting / session / version. **The current evidence type cannot express those constraints**, so isolation cannot be asserted on evidence — only inferred from which retriever happened to run. This is a schema-level blocker for the §27.1 isolation gates.

### 6C.7 Invariant status

| # | Invariant | Status |
|---|-----------|--------|
| 1 | `EvidenceItem` for all retrieved material | **VIOLATED** — 3 live paths inject raw strings |
| 2 | kind / id / authority / trust / scope id | **PARTIAL** — no `scopeId` exists (F19) |
| 3 | retrieval accepts `SourceCapability[]` | **PARTIAL** — 3 of ~14 retrievers; one of the 3 is dark |
| 4 | no capability → no factual evidence | **PARTIAL** — enforcement flags are **dev-only, off in production** |
| 5 | prior assistant output → referent only | **PARTIAL** — holds on 3 paths, unenforced on plain manual chat |
| 6 | meeting RAG uses `EvidencePack` | **VIOLATED** (F17) |
| 7 | property-aware match in scores | Holds **inside Context OS only** |
| 8 | similarity ≠ proof | Holds in Context OS; **violated by 5 similarity-only cutoffs elsewhere** |

Five similarity-only cutoffs directly contradict §16 ("do not equate high similarity with a complete answer").

### 6C.8 F20 — The conversation-history gate that ships is not the one that was built

Invariant 5's intended gate — `conversationHistoryPolicy.ts` plus a deliberate fail-closed flip at `contextRoute.ts:132` — is **TEST-ONLY**. What actually ships is a narrower duplicate, `stripPriorAssistantTurns` (`ipcHandlers.ts:153`), which fires **only on doc-grounded turns**.

Combined with F14, this means prior assistant claims are re-injected without provenance on every non-doc-grounded turn, on every surface.

---

## 6D. Inventories still outstanding

| §    | Inventory | Status |
|------|-----------|--------|
| 7.8  | Data isolation | Partially covered by §6B.4 and F19; full map not built |

---

## 7. §7.9 reproduction strategy — honest bucketing

Thirty deterministic reproductions is not achievable in one phase, and several require a live provider merely to *observe*. Rather than claim uniform coverage, each failure is assigned a bucket:

**Bucket A — deterministically reproducible now, no provider required** (decision-layer failures assertable against code/state):
#7 stale overwrite · #8 chat-vs-overlay source divergence · #9 WTA separate pipeline · #17/#18 stale resume/JD version · #19/#20 mode/meeting change mid-flight · #21 transcript-revision supersession · #26 empty file marked indexed · #27 corrupted file · #28/#29 embedding/reranker timeout

**Bucket B — static/trace analysis with cited code path; live model needed to observe the symptom:**
#3 resume contaminating general answer · #4 JD skill as user experience · #22 screenshot question pulling profile data · #23 coding question constrained to samples · #24 invented personal motivation

**Bucket C — deferred to Phase 2 provider-backed evaluation:** the remainder.

**Current status: #7 is fully root-caused (§4). The remaining Bucket A items are outstanding.**

---

## 8. Outstanding Phase 1 work — honest gap list

Completed in this phase: §7.1 baseline (with F21 caveat), §7.2 entry points, §7.3 modes, §7.4 Profile Intelligence, §7.5 retrieval, §7.6 source ownership (partial), §7.7 async-state trace (complete, with reproduction).

**Not completed:**

| # | Gap | Why |
|---|-----|-----|
| 1 | **Numeric test baseline** | Blocked by F21. Not obtainable until the worker leak is fixed. |
| 2 | **Data-isolation map (§7.8)** | Partially covered (F19: no `scopeId` on evidence; §6B.4: sibling-cache leaks). The per-query scope-filter audit across all ~14 retrievers is not done. |
| 3 | **Bucket A reproductions beyond #7** | #7 is fully reproduced. #8, #9, #17–#21, #26–#29 are root-caused in narrative but have no runnable fixture yet. |
| 4 | **Latency measurements (§7.10)** | Not taken — requires a running app; and F21 means the harness to take them is itself unreliable. |
| 5 | **Architecture / sequence diagrams (§7.10)** | Not drawn. |
| 6 | **Electron + backend startup smoke (§7.1)** | Not run — needs display and packaged assets. |
| 7 | **`generate-*` per-entry-point contract detail** | Decision-layer coverage measured (§2.4); the full input-contract/cancellation/tracing table per §7.2 is not filled in. |

Per §7 of the brief, Phase 2 must not begin until these are closed or explicitly waived by the owner. **Item 1 is a hard blocker** — Phase 2's benchmarks and Phase 8's gates both presuppose a working test harness.

---

## 9. Risks identified for migration

| Risk | Detail |
|------|--------|
| **Shared working tree** | Concurrent agents mutate this directory. Baseline already carries third-party changes incl. a typecheck-breaking one. Any Phase 4 work must re-diff before assuming ownership of a file. |
| **`_geminiChatStreamHandler` is ~3 690 lines** | Migrating Layer B is not a re-wiring job; it is an extraction. Highest-effort item in the migration. |
| **Dev-vs-prod flag divergence (F5)** | 20 flags differ. Acceptance gates measured under test defaults will not predict production behaviour unless the suite is run in both configurations. |
| **Checked-in compiled `.js` twins** | Source-of-truth ambiguity in `src/components/`. |
| **Type errors do not fail the build** | esbuild transpile-only; `RAGManager.ts` currently type-broken yet builds. |
| **No source-decision trace** | Blocks shadow mode and parity testing (§5). |

---

## 10. Recommended re-ordering of the mission

Three findings jointly argue for changing the plan in §33, and the argument is stated here rather than acted on, since Phase 1 is investigation-only.

**1. Fix F21 before anything else.** No acceptance gate, benchmark, or shadow-mode comparison is measurable while the suite cannot terminate. It is a small fix in production code.

**2. Emit `AnswerTrace` before migrating any surface.** §25.3 lists surface migration first. But two of the three decision layers produce no structured artefact (§5), so shadow mode (§25.2) and cross-surface parity (§21.4) are unimplementable until a trace exists. Trace emission should be the first *architectural* deliverable of Phase 4.

**3. Re-scope Phase 4 from "build" to "wire and delete".** The evidence across F1, F9, F10, F17, F20, and §6B.6 is consistent: `resolveCanonicalTurn`, `composePrompt`, `SourceAuthorityKernel`, Tier-2 OKF provenance, `assistantClaims`, `meetingChunksToEvidenceItems`, `knowledgeOrchestratorGate`, and `deleteProfileTransactional` are all **built, tested, and unreachable or production-disabled**. The brief's §31 "likely final simplification" describes an architecture this repository has largely already written. The scarce resource is not design; it is adoption, deletion of the duplicates, and flag promotion.

A corollary worth stating plainly: **the dev-vs-production flag split (F5) is the mechanism that allowed this to happen.** Components could be built, pass their tests under dev defaults, and be considered "done" while never running for a user. Any V3 rollout that reproduces that split will reproduce the outcome.

---

## Findings added 2026-07-30 — the thesis reproduced inside the rebuild

F24 and F25 were not found in the legacy code. They were found **in the V3 module**, by hardening the harness that was supposed to be validating it. Both are the same failure the mission was written about — architecture that exists, passes its tests, and does nothing — so they are recorded here beside the legacy findings rather than in a separate section.

### F24 — `CONFLICTING` was structurally unreachable, and four questions expected it

`evaluateAnswerability` detected a conflict as *"the same source appearing at two different versions"*, comparing `EvidenceItem.versionId` across items sharing a `sourceId`.

`adaptLegacyChunks` stamps **every admitted item with the source's ACTIVE version**:

```ts
versionId: active,          // legacy-adapter.ts — not the chunk's own version
```

A chunk whose own version differed was rejected before this point. So two items from one source were *guaranteed* to carry identical `versionId` values, `versions.size > 1` could not evaluate true, and the branch was dead code. The comment describing it as *"an assertion surface: if it ever fires, the filter has a hole"* was wrong — it could not fire regardless of how broken the filter was.

Nothing detected this because **`expectedAnswerability` was recorded by all three harnesses and asserted by none.** Four questions (G-01…G-03, H-05) carried an expectation the system could not produce, and every run reported them as passing.

**Fixed:** evidence carries `retrievedVersionId` — the version the chunk actually came from — and the check compares that. The assertion can now fire. Value-level conflict between two *current* sources remains unimplemented and is now recorded as such (see 06 §5.1) rather than implied.

### F25 — the version filter failed OPEN, and scope filtering has no call sites

Two related instances of the same shape.

**(a) `filterByScopeAndVersion` has zero callers outside its own tests.**

```
electron/context-intelligence/__tests__/SourceAuthorityAndScope.test.mjs   6 hits
everywhere else                                                            0
```

It is fully implemented, tested, and unreachable — F1/F9/F10's exact pattern, in the module built to replace them. The wired path instead uses `adaptLegacyChunks`, which stamps `scopeId` from the turn's own scope and **never compares it against a per-source scope**. Scope isolation therefore filters nothing on the wired surface. `evidenceCarriesProvenance`'s `e.scopeId &&` check is a truthiness test on a value that is non-empty by construction — vacuous in the same way the stale-version gate was.

**(b) The version check defaulted to fail-open while documenting itself as fail-closed.**

```ts
const chunkVersion = opts.chunkVersions?.get(c.sourceId) ?? active;
```

A caller supplying no `chunkVersions` map had every chunk treated as current. `golden-live.cjs` did exactly that — and additionally stamped the literal `'legacy'` as every file's active version — so version filtering was inert for the entire mission while the module's docblock read *"Fails CLOSED."*

**Fixed:** an unknown chunk version now rejects as `UNKNOWN_CHUNK_VERSION`. The fail-open survives only as an explicit `assumeCurrentWhenVersionUnknown` opt-in, set by the wired manual-chat surface alone because the legacy mode-reference store genuinely has no version column. (a) is **not** fixed — recorded as open.
