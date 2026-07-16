# Grounding Campaign Log

Branch: `fix/grounding-campaign` (created from a DIRTY working tree per explicit user decision — see ITERATION 1 notes).

## ANTI-THRASH LEDGER
(pinned root causes + fixes; never re-fix the same pattern — if a symptom returns, the pin was wrong, go back to forensics)

| # | Hypothesis | Verdict | Evidence | Fix commit | Status |
|---|---|---|---|---|---|
| - | (none pinned yet) | | | | |

## SCORE HISTORY
(benchmark run # / timestamp / overall % / per-category / hallucination flags / false-refusal rate)

| Run | Timestamp | Overall | Halluc. flags | False-refusal rate | Notes |
|---|---|---|---|---|---|
| - | (no benchmark run yet) | | | | |

## QUOTA CHECK METHOD
Confirmed working: the reference script in loop.md Section 1.5 works as-is.
`curl -s http://localhost:20128/api/providers` → filter `provider=="claude"` → `curl -s http://localhost:20128/api/usage/{id}` → `.quotas."session (5h)".remainingPercentage`.

QUOTA (iteration 1, 2026-07-16 ~22:2x local): Account 1 (priority 1) 83% session / 77% weekly. Account 2 (priority 2) 68% session / 86% weekly. Both session resets ~21:00 UTC today. Both healthy, well above the 20% pre-check threshold. Minimax connection also `active` (2 keys pooled, priority 1 + 2).

## ITERATION 1 (2026-07-16) — Preflight + reconnaissance (NOT a clean-slate start)

**Important deviation from a naive Phase 0**: this repo's working tree was ALREADY dirty when the campaign began, with substantial uncommitted work directly relevant to this campaign's hypotheses:

- Modified: `electron/LLMHelper.ts` (+231/-?), `electron/main.ts` (+48), `electron/intelligence/context-os/{finalPromptValidation.ts, generationContext.ts, index.ts}`, `electron/services/CodexCliService.ts`, `electron/services/screen/VisionProviderRegistry.ts`, `src/components/ProfileIntelligenceSettings.tsx` (+321).
- New untracked: `electron/intelligence/context-os/TurnEvidenceCoordinator.ts` (202 lines — implements `allocateRequiredEvidenceFamilies`, whose own docstring says it "prevents document top-K from starving résumé/JD evidence" — this is EXACTLY campaign hypothesis H3), `electron/intelligence/__tests__/TurnEvidenceCoordinator2026_07_16.test.mjs`, `electron/llm/providerPayloadCapture.ts` (likely golden-trace infra), `electron/utils/__tests__/UnhandledRejectionDbSurvival2026_07_11.test.mjs` (likely unrelated).
- 11 new `AUDIT_*.md` files + `PRODUCTION_HARDENING_FINAL_REPORT.md` at repo root — appear to be from an EARLIER, separate 11-phase "production-hardening" campaign dated 2026-07-11, NOT this grounding campaign, EXCEPT `AUDIT_AI_CONTEXT_OWNERSHIP.md` which IS directly relevant (see findings below).
- Untracked `tests/context-os-real-backend/` and `tests/e2e-modes/_ks_realfixture_verify.mjs` — may already be a real-backend benchmark harness partially satisfying Phase 2.
- Recent commits already landed on `main` today (`41edd51`, `5d8096e`, `6e7dd97`, `5188f6d`): a "Knowledge Source canonical gate" repair series touching `SourceAuthorityKernel.ts`, `promptRenderer.ts` + new `renderedEvidenceManifest.ts`, `ModesManager.ts`, phone-mirror IPC threading `turnSourceDecision`. Per my own memory (`knowledge_source_canonical_gate_2026_07_15.md`), this closed 4 named failures with 47 new passing tests, "PARTIALLY VERIFIED → VERIFIED".

**Decision**: per hard rule R2 (anti-thrash) and R1 (evidence before edits), I must NOT redo forensics as if none of this exists — that would risk re-fixing already-fixed patterns or, worse, "fixing" code that's mid-flight and breaking it. I dispatched 3 parallel research subagents (not yet returned as of this log entry) to build ground truth before the Golden Trace:
  1. Summarize all 12 AUDIT_*.md / PRODUCTION_HARDENING_FINAL_REPORT.md files, mapped to H1-H10.
  2. Read the FULL diffs of every modified/new file in the dirty tree (LLMHelper.ts, main.ts, context-os plumbing, ProfileIntelligenceSettings.tsx, the two new test files, providerPayloadCapture.ts) and answer the single most important question: **is TurnEvidenceCoordinator.resolve() actually wired into the live call path, or is it dead code?**
  3. Investigate `tests/context-os-real-backend/` and `tests/e2e-modes/_ks_realfixture_verify.mjs` (read-only, no execution — may cost real API money) to determine if Phase 2's harness requirement is already partially met.

**Preflight findings so far (independent of the subagents):**
- MiniMax key confirmed present: `.env` and `natively-api/.env` both have `MINIMAX_API_KEY`, `MINIMAX_API_KEY_1`, `MINIMAX_API_KEY_2`. Model string: `MINIMAX_M3_MODEL = 'MiniMax-M3'` defined in `natively-api/lib/minimaxProvider.js:19`. Backend cascade (`natively-api/server.js`) routes: Groq fast → Gemini Flash → **MiniMax-M3** → Gemini Pro → Groq Scout, with a `minimaxTierEligible`/forced-primary path that tries MiniMax-M3 ahead of the whole cascade for COMPLEX+CODING tier. So the real MiniMax path exists and is live in the backend, confirming R4 is satisfiable.
- `npm run typecheck:electron` (`tsc -p electron/tsconfig.json --noEmit`) passes CLEAN on the current dirty tree. This is a good sign the in-flight uncommitted work is at least type-safe, not a half-finished mid-edit mess.
- Feature flags of interest (`electron/intelligence/intelligenceFlags.ts`): `okfKnowledgePacks` and `okfHybridRetrieval` default to `isInternalDevTestContext()` (true only under `NODE_ENV=test/development`, `BENCHMARK_MODEL` env, or `NATIVELY_INTERNAL`/`NATIVELY_DEV`=1) — i.e. **OFF by default in production/live overlay use**, ON only in test/benchmark contexts. `docGroundedStrictIsolation` defaults `true` unconditionally. This is a critical H9/H7 data point: if OKF packs are dev/test-only by default, the live overlay a real user hits may never exercise the OKF-cards-first evidence priority (R6) at all — worth confirming with a trace whether production builds set `NATIVELY_INTERNAL`.
- Existing fixture/benchmark infrastructure ALREADY exists at repo root (not under `test/harness/` — note singular/plural difference from campaign spec): `benchmarks/profile-intelligence/` (extensive — 1000-question benchmarks, WTA benchmark, multimode, followup, long-session evals, all real `run_*.ts` scripts wired to `BENCHMARK_MODEL` env), `scripts/benchmark-thesis-doc-grounded-retrieval.js`, `tests/context-os-real-backend/run-200q-benchmark.mjs`, `tests/e2e-modes/context-os-real-custom-mode-benchmark.mjs`, `natively-api/tests/custom-benchmark.mjs` + `fullsystem-benchmark-report.md`. Fixture PDFs already present: `Sample thesis for testing.pdf`, `evinresume.pdf`, `test-fixtures/profiles/p01..p10/resume.pdf`, `profileresume/Job-Description---Data-Analyst-Sample.pdf`, `test-fixtures/modes-corpus/thesis/*.pdf`. **Phase 2 (build a harness) may be largely redundant with what exists — pending subagent #3's verdict**, need to decide: extend/reuse existing harness vs building `test/harness/` fresh. Reuse is strongly preferred per "touches the least code" resolution rule.
- Quota confirmed healthy (see QUOTA section above).

**NEXT ACTION**: Wait for the 3 dispatched subagents to return, synthesize their findings into `traces/forensic-report.md` §H3/H9 sections with concrete verdicts (especially: is TurnEvidenceCoordinator wired live or dead code — this determines whether iteration 2 is "finish wiring an in-flight fix" or "start the Golden Trace from scratch"), then proceed to the Golden Trace (loop.md §2.1) using whichever harness entry point is confirmed real. Do not commit anything yet — no code has been changed this iteration, only new files (`loop.md`, `campaign-log.md`, empty `traces/` and `test/harness/{fixtures,reports}` dirs) which are safe to commit as a checkpoint once the forensic report lands.
