# JD / Resume JIT Pipeline Investigation — read-only tracers

Investigation-only tooling. **None of these scripts write to the DB, call a
provider, or mutate production behavior.** They read the real knowledge DB in
`readonly` mode and drive the *real compiled* `planAnswer` classifier to produce
ground-truth evidence for `docs/JD_RESUME_JIT_PIPELINE_INVESTIGATION_REPORT.md`.

## Why `.mjs` and not `.ts`

The repo has no `tsx`/`ts-node` installed, and the native `better-sqlite3` ABI is
built for Electron — so DB scripts must run under the Electron node runtime
(`ELECTRON_RUN_AS_NODE=1`), exactly like the project's `*.test.mjs` suites. Plain
`.ts` files could not execute here; `.mjs` scripts run against the real data.

## Prerequisites

- A compiled electron bundle at `dist-electron/electron/llm/AnswerPlanner.js`
  (present in this working tree; rebuild with the project's electron build if stale).
- The user's real DB at `~/Library/Application Support/natively/natively.db`
  (auto-discovered). Override with `NATIVELY_DB=/abs/path`.

## Running

Classifier-only scripts run under bare node:

```bash
node tools/jd-resume-jit-investigation/trace-classification.mjs
node tools/jd-resume-jit-investigation/trace-aot-jit-bypasses.mjs
node tools/jd-resume-jit-investigation/trace-prior-answer-contamination.mjs
```

DB scripts need the Electron node runtime (native better-sqlite3):

```bash
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron tools/jd-resume-jit-investigation/trace-jd-storage.mjs
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron tools/jd-resume-jit-investigation/trace-jd-question-flow.mjs
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron tools/jd-resume-jit-investigation/trace-resume-jd-evidence.mjs
```

## Scripts

| Script | What it proves | Runtime |
|--------|----------------|---------|
| `trace-jd-storage.mjs` | JD/resume are stored, active JD id, structured keys/counts, AOT artifacts tied to active JD, schema has **no raw-text column**. | Electron node |
| `trace-classification.mjs` | Drives the **real** `planAnswer` over the benchmark questions; prints answerType + effective layers; flags every question that drops the JD/resume layer it needs. | bare node |
| `trace-jd-question-flow.mjs` | **Reconciliation**: joins real classifier × real DB → `JD_PRESENT_BUT_NOT_ROUTED` verdicts. The core proof that the JD is on disk yet the routing drops it. | Electron node |
| `trace-resume-jd-evidence.mjs` | Attributes each suspicious token (analyst/ETL/R/BI/Python…) to JD vs resume vs AOT-intro → disproves "hallucination"/"stale JD". | Electron node |
| `trace-aot-jit-bypasses.mjs` | Static: confirms the 5 AOT→final-answer bypass emit sites are live and that `FinalAnswerGenerationPolicy` enforcement is **never called**. | bare node |
| `trace-prior-answer-contamination.mjs` | Static: confirms the prior-assistant strip fires only for doc-grounded custom modes, so a normal JD session's prior "analyst" answer survives into the next prompt. | bare node |
| `verify-jd-routing.mjs` | **Fix verifier**: drives the real compiled `planAnswer` over 26 generalized paraphrases and asserts JD-only questions route the `jd` layer, resume+JD route both, and resume-only/coding cases are unregressed. | bare node |
| `verify-jd-evidence.mjs` | **Fix verifier**: end-to-end `planAnswer → selectManualProfileEvidence → buildProfileJitPrompt` over synthetic fixtures; asserts source-tagged JD (and resume) evidence renders in `<target_job_evidence>`/`<candidate_resume_evidence>` and salary absence is honest. | bare node |

## Fix verifiers (post-implementation)

After the `fix/jd-resume-jit-pipeline` branch, the two `verify-*.mjs` scripts
prove the fix on the real compiled pipeline with generalized fixtures (no prod
strings, no DB, no provider):

```bash
node tools/jd-resume-jit-investigation/verify-jd-routing.mjs   # 26/26
node tools/jd-resume-jit-investigation/verify-jd-evidence.mjs  # 6/6
```

The repo-level regression tests are
`electron/llm/__tests__/JdResumeJitPipeline2026_07_07.test.mjs` (37) and
`electron/llm/__tests__/ActiveProfileContext2026_07_07.test.mjs` (6).

## Headline result (captured 2026-07-07 against the user's live DB)

- Active JD **id=32**, `title="Data Analyst"`, `technologies=[SQL,Python,R,Tableau,Power BI]`,
  `keywords=[ETL,data-visualization,business-intelligence,…]`, 6 requirements, 15
  responsibilities. The JD **is** stored, active, structured, non-degenerate.
- **8 JD questions** classified such that the `jd` layer is dropped **before any
  prompt is built** — `JD_PRESENT_BUT_NOT_ROUTED`. The JD is not missing or stale;
  it is never routed.
- All "analyst / ETL / R / BI / data analyst" tokens are **JD-SOURCED** (real JD
  content), not hallucinated. The "EstroTech … Python and Java … sharpened SQL"
  narrative is the **AOT intro string**, served verbatim.
- **5/5** AOT final-answer bypass sites live; `FinalAnswerGenerationPolicy`
  enforcement wired: **NO**.

See the report for the full analysis and the fix plan for staged remediation.
