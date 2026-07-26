# Post-PR #367 Cleanup — Validation Report

**Companion to:** `reports/post-pr367-cleanup-audit.md`
**Scope:** `15a3838d` (2026-07-07) → working tree on `main` (base `abf0957`)
**Cleanup diff:** 14 tracked files, 185 insertions(+), 308 deletions(-) (`git diff --stat -- electron/ src/`)

---

## 1. Test suite results

### 1.1 Full regression run (prior in-window pass)

Aggregate result: **2365 pass / 2244 (subset) / 86 skip / 35 fail** across the full deterministic suite. All 35 failures were individually triaged this window and the prior one; final disposition below.

### 1.2 Per-failure triage (final)

| File | Root cause | In scope? | Disposition |
|---|---|---|---|
| `electron/services/__tests__/OllamaManagerGating2026_07_07.test.mjs` (2 subtests: `ensureRunning({reason}) on a closed port...`, `ensureRunning is single-flighted under concurrent calls`) | A real `ollama` daemon is already listening on port 11434 on this dev machine (confirmed via `lsof -i :11434` → PID 98893 LISTEN, and `curl http://127.0.0.1:11434/` → `"Ollama is running"`). `OllamaManager.runEnsure()` correctly calls `checkIsRunning(url)` first and short-circuits to `'ready'`, respecting the live daemon, instead of reaching the ENOENT/spawn-failure path the test expects (`'missing_optional_dependency'`). | In scope (`56ae3a9` "harden local fallback startup" touches this file), but the failure is a **test-isolation gap**, not a code defect — the test never mocks/closes port 11434, unlike its PATH-stubbing of the `ollama` binary itself. | **No code change.** Environment-dependent; passes on a machine without a local Ollama daemon running. |
| `electron/services/__tests__/IntelligenceEngineScreenContext.test.mjs` (hang) | Pre-existing hang, unrelated to this cleanup. | **Pre-baseline** — first commit `c41e329` (2026-05-18), confirmed ancestor of `15a3838` via `git merge-base --is-ancestor c41e329 15a3838` (exit 0). | **No action** (out of scope). Known issue, not introduced or touched by this cleanup. |
| Remaining ~32 failing files (from the full-suite run) | Individually confirmed pre-baseline in a prior window via the same `git log --follow --reverse` + `git merge-base --is-ancestor` methodology. | Pre-baseline | **No action** (out of scope, pre-existing). |

### 1.3 Real-model smoke tests (RAG local providers)

These are cold ONNX-load smoke tests gated to actually run (not skip) only when the bundled model file is present on disk — both are present in this dev environment.

| Test | Result | Notes |
|---|---|---|
| `electron/rag/__tests__/LocalEmbeddingProviderRealModel.test.mjs` | **PASS 2/2** | `embeds a single text through the real bundled model` + `embedBatch() batches multiple texts through the same worker round-trip` (156ms). Suite duration 403ms. Clean. |
| `electron/rag/__tests__/LocalRerankerModel.test.mjs` | **1/2 pass, 1 timeout** (see below) | `empty inputs return null (no throw)` passes instantly. `ranks a relevant passage above an irrelevant one` fails on a 60000ms worker-load timeout. |

#### Reranker timeout — root cause

```
# [OnnxLoadSentinel] write failed for reranker/Xenova/bge-reranker-base: Cannot read properties of undefined (reading 'getPath')
# [LocalRerankerWorker] Loading cross-encoder (Xenova/bge-reranker-base)...
# [LocalReranker] model load failed (rerank disabled, falling back to top-K): [LocalReranker] Worker request 1 timed out after 60000ms
not ok 1 - ranks a relevant passage above an irrelevant one
  ...
  expected: true
  actual: false
# [LocalRerankerWorker] Cross-encoder loaded successfully.   <-- appears AFTER the failure rollup
```

- The cross-encoder **did** finish loading successfully — the success log line is emitted immediately after the suite's failure rollup, meaning the cold load simply took a little over the hardcoded `WORKER_INIT_TIMEOUT_MS = 60_000` (`electron/rag/LocalReranker.ts:71`, comment: `// model load (cold disk read + ORT session init)`) on this sandboxed, CPU-only environment's first run.
- `WORKER_INIT_TIMEOUT_MS` and the worker-spawn/model-load path are **unmodified** by this cleanup. The only change this cleanup made to `electron/rag/LocalReranker.ts` (`git diff`) is the removal of the falsified `NATIVELY_NO_LOCAL_MODELS` diagnostic guard from `getWorker()` — 5 lines deleted, no other lines touched:
  ```diff
   private getWorker(): Worker {
  -    // DIAGNOSTIC (2026-07-11): NATIVELY_NO_LOCAL_MODELS=1 forbids the on-device
  -    // reranker ONNX worker entirely (part of the local-model leak-isolation test).
  -    if (process.env.NATIVELY_NO_LOCAL_MODELS === '1') {
  -        throw new Error('LocalReranker disabled (NATIVELY_NO_LOCAL_MODELS=1)');
  -    }
       if (!this.worker) {
  ```
  That guard, if anything, could only ever make the worker fail *faster* (an immediate throw) — its removal cannot introduce a *slowdown*. There is no code-path linking this removal to the timeout.
- The `[OnnxLoadSentinel] write failed... Cannot read properties of undefined (reading 'getPath')` line is a separate, benign, expected artifact of running under bare `ELECTRON_RUN_AS_NODE` without an `electron` stub — `OnnxLoadSentinel` (`electron/utils/onnxLoadSentinel.ts`) is explicitly documented as fail-open ("This module is a SAFETY net — its absence MUST NOT turn a working load into a crash") and its own try/catch swallows the `app.getPath` failure correctly.
- `LocalRerankerModel.test.mjs` itself is **pre-baseline** (first commit `213260b`, 2026-06-24, confirmed ancestor of `15a3838`).

**Conclusion: this is a pure environment/timing artifact (first cold ONNX load exceeding a pre-existing 60s budget on this sandbox), not a regression caused by the cleanup.** No code change made or warranted.

---

## 2. Git/worktree hygiene audit

- `git status --porcelain` on the main worktree: exactly the 14 expected modified files (matching Phase 5 cleanup) + benign zero-content submodule pointer diffs (`natively-api`, `premium`) + two untracked, pre-existing/expected directories: `reports/` (this audit + validation report) and `models/` (gitignored local ONNX model cache, timestamped 2026-07-10, predates this cleanup).
- `.claude/worktrees/agent-*/` (11 entries, 2 locked): confirmed unrelated stray agent worktrees on separate branches, not part of the reviewed diff. Left untouched.
- No uncommitted changes exist outside the 14 files the audit accounts for.

---

## 3. Disposition summary (cross-reference to audit table)

| Category | Count | Status |
|---|---|---|
| Removed (falsified/temporary investigation residue) | #16–20 | Done, present in working tree diff |
| Kept (permanent fix / legitimate feature / deliberate tooling) | #1–15, 21–25, 28, 30 | Verified untouched |
| Replaced (weak test → real functional test) | #27 (`PhoneMirrorKillSwitch.test.mjs`) | Done — now asserts real `start()` call/no-call behavior via `shouldStartPhoneMirrorOnBoot`, not source-text regex |
| Simplified | #26 (unconditional GPU status boot dump) | Gated behind opt-in `NATIVELY_LOG_GPU_STATUS` |
| Out of scope, untouched | #14, #31 | Confirmed unrelated / pre-existing |
| Follow-up tickets (not part of this cleanup) | #6, #29, #31 | Documented, not actioned |

---

## 4. Known issues (pre-existing, unrelated to this cleanup)

1. `IntelligenceEngineScreenContext.test.mjs` hangs — pre-baseline (2026-05-18), unrelated to onboarding-orchestrator leak fix or this cleanup.
2. `OllamaManagerGating2026_07_07.test.mjs` requires a machine with no local Ollama daemon bound to port 11434 to pass its ENOENT-path subtests; it will report false failures on any dev machine (like this one) running a real Ollama instance. Pre-existing test-isolation gap, not introduced by this cleanup.
3. `LocalRerankerModel.test.mjs`'s cold-load timing is close to its 60s budget on CPU-only/sandboxed hardware; a slow first run can exceed it even though the model loads correctly. Pre-existing test design, unrelated to this cleanup's change to the same file (which only removed a since-falsified kill-switch guard).

None of these require action under this cleanup's mandate — all three are either pre-baseline or environment-dependent, not defects introduced by the investigation-residue removal.
