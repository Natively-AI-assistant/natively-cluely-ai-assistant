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

**NEXT ACTION (superseded — see below)**: ~~Wait for the 3 dispatched subagents...~~ — completed; see ITERATION 2.

## ITERATION 2 (2026-07-16, continued) — Phase 0 Golden Trace + Phase 1 fix #1 (H3, JD-only evidence gate)

All 3 subagents returned (summarized in §ITERATION 1 findings, confirmed independently). Proceeded directly to the Golden Trace (loop.md §2.1) using the pre-existing `tests/e2e-modes/_ks_realfixture_verify.mjs` pattern as a template, extended with 8 new live-path trace scripts under `traces/`. Full writeup: **`traces/forensic-report.md`**.

### Summary of what was found and fixed

- **Golden Trace — reference-file grounding (founder symptom #1, H1/H6): REFUTED for the tested scenario.** 5 sub-traces (single ref-file attach + immediate/delayed ask, on Gemini AND real MiniMax-M3, on both governed and production-flag-forced-off paths) all grounded correctly. Does not mean the underlying symptom is dead — only scripted single-question `__e2e__:ask` calls were tested, not true live-transcript auto-trigger conditions. Flagged as PARTIALLY REFUTED, needs retest under real meeting conditions in a later iteration.
- **Golden Trace — mode+JD grounding (founder symptom #3, H3): CONFIRMED, root cause pinned, FIX LANDED AND VERIFIED LIVE.**
  - Root cause: `electron/IntelligenceEngine.ts`'s `wtaDecisionAllowsCandidateProfile` gate (2 occurrences) checked `allowedEvidenceKinds.includes('profile_resume') || .includes('projects')` but never `'profile_jd'`, so a JD-only-granted turn (`outcome:'explicit_granted'`, `allowedEvidenceKinds:['profile_jd']`) always computed `false`, blocking ALL candidate/JD evidence fetch on the **live WTA/meeting-overlay path** (as opposed to manual chat, which was already fixed for this exact gap on 2026-07-11 per its own code comment in `ipcHandlers.ts`). Confirmed via temporary tagged trace logs (`[TRACE:jd-turnsourcedecision]`, `[TRACE:jd-outer-gate]`, `[TRACE:jd-groundable-gate]`) added, rebuilt, fired live, then stripped once the fix was proven (R3/R10 compliant).
  - Effect: for `jd_requirements_answer`/`jd_summary_answer`/`jd_fact_answer` question types the model received the correct answer-shape instructions (`requiredContextLayers: jd`) but ZERO real JD text, and confidently fabricated plausible-but-wrong requirements ("distributed systems," "API design," "cloud infrastructure" — none of which appear in the real 3-line fixture JD about an "AI Product Engineer @ Helio Labs... LLM prompt engineering, streaming UIs, Postgres"). This is a confirmed R5 violation (zero-hallucination) that was silent — no refusal, no error, just a wrong answer delivered with full confidence.
  - Fix: added `|| _wtaTurnSourceDecision.allowedEvidenceKinds.includes('profile_jd')` to both occurrences (the initial-fetch gate ~line 1108 and the profile-repair gate ~line 2013), mirroring the already-proven `ipcHandlers.ts` pattern verbatim. 2-line surgical change, both instances now consistent.
  - Verified live (`traces/golden-trace-jd-console-capture.mjs`, `-jd-fix-verify.mjs`): post-fix, the same question now correctly cites Helio Labs, LLM prompt engineering, streaming UIs, and Postgres — genuinely from the real JD, zero fabrication. Re-verified AGAIN after a concurrent session's edits landed on the same file (see below) — fix intact and still firing correctly.
  - `npm run typecheck:electron` clean before AND after the fix.
  - **This fix is now COMMITTED** — see "Concurrent workspace" note below. Commit hash: `d8aef52` ("campaign2 iter1: Phase 0 forensics — golden trace + 2 pinned root causes" — committed by a concurrent session, but includes my exact diff verbatim in `electron/IntelligenceEngine.ts`, confirmed via `git show d8aef52 -- electron/IntelligenceEngine.ts` showing both `profile_jd` additions).
- **Secondary finding, NOT yet fixed (logged for a future iteration):** R6 exact-refusal-phrase compliance wasn't tested with a truly-unanswerable fact; the one unanswerable question tried, the model inferred a defensible-but-not-exact answer instead of the literal safe-refusal string. Needs a dedicated benchmark case.
- **False positive investigated and cleared:** a same-session two-question sequence (JD-fit then JD-requirements) reproducibly returned an empty second answer. Traced to `reason: 'cooldown'` — a deliberate anti-spam gate in `handleSuggestionTrigger`, NOT a bug. My test script fired questions faster than a real meeting's natural pacing. Not a defect; test-harness timing artifact only.

### ANTI-THRASH LEDGER UPDATE

| # | Hypothesis | Verdict | Evidence | Fix commit | Status |
|---|---|---|---|---|---|
| 1 | H3 — WTA/live-overlay `wtaDecisionAllowsCandidateProfile` gate missing `profile_jd` (2 occurrences in `IntelligenceEngine.ts`) | CONFIRMED, FIXED | `traces/golden-trace-jd-console-capture.mjs` before/after; `traces/forensic-report.md` §3 | `d8aef52` (swept in by concurrent session, diff verified identical) | **DONE — verified live, do not re-fix this pattern in IntelligenceEngine.ts again.** If it recurs, the pin was wrong — go back to forensics, don't patch on top. |
| 2 | H1/H6 reference-file grounding (single-file, scripted ask) | PARTIALLY REFUTED | `traces/golden-trace-refdoc*.mjs`, `-resume-as-refdoc.mjs` | n/a | Retest under true live-transcript auto-trigger before declaring dead. |
| 3 | "Second question empty" nondeterminism | REFUTED (not a bug) | `traces/golden-trace-second-question-empty.mjs` — `reason:'cooldown'` | n/a | Cleared, deliberate behavior. |

### CONCURRENT WORKSPACE NOTE (important — read before any future git operation in this session)

Six `claude --dangerously-skip-permissions` processes are confirmed running with this EXACT SAME working directory (not worktrees, same inode) — this is a live instance of the [[shared-workspace-branch-hazard-2026-07-11]] memory pattern, and per explicit user instruction this is EXPECTED and I should continue normally, NOT try to isolate/stop other sessions.

Concretely observed: another session ("campaign2", working on a DIFFERENT investigation — long-session/H6 recall degradation, branch `fix/longsession-campaign`, log file `campaign2-log.md`, traces dir `traces2/`) ran `git checkout -b fix/longsession-campaign` from `fix/grounding-campaign` (my branch) partway through my iteration 2. Since checkouts in a shared working directory move EVERY process's HEAD, this silently moved my session onto their branch too. Shortly after, that session committed (`d8aef52`) with ALL then-uncommitted changes in the working tree — including my two `profile_jd` fixes in `IntelligenceEngine.ts` and my own `campaign-log.md`/`traces/forensic-report.md`/`loop.md` files (verified: `git show d8aef52 --stat` lists both `campaign-log.md` and `campaign2-log.md` as separate files, and my `traces/golden-trace-jd-*.mjs` scripts alongside their `traces2/golden-longctx-*.txt` — no filename collisions, both sessions' work coexists cleanly in that one commit).

**Practical implications for the rest of this session:**
- My branch `fix/grounding-campaign` still exists (`git branch --list` confirms) but is now BEHIND current HEAD (which is `fix/longsession-campaign`, one commit ahead of where I branched). Do NOT `git checkout fix/grounding-campaign` — that would move the other session's HEAD too and could disrupt their in-progress work (git status shows they have their own uncommitted changes accumulating right now on `electron/LLMHelper.ts`, `electron/SessionTracker.ts`, `electron/ipcHandlers.ts`, etc.).
- My fix is already safely committed (verified via `git show d8aef52`), so no further action needed to protect it.
- Going forward: commit my own verified fixes PROMPTLY (don't let them sit uncommitted for long — the longer they sit, the more likely a concurrent commit sweeps them up unpredictably or a concurrent edit clobbers the same lines). Before any `git checkout`/`git branch`/`git reset`, re-check `git branch --show-current` and `git status` FIRST since they may have changed underneath me. Never assume the branch I last set is still current.
- Both my `campaign-log.md`/`loop.md`/`traces/` AND their `campaign2-log.md`/`loop2.md`/`traces2/` naming avoided collision by luck/convention (both sessions apparently chose non-conflicting file names independently) — continue using unsuffixed names since I was first, but stay alert for a THIRD future collision.

### QUOTA

QUOTA (iteration 2 end, 2026-07-16 ~23:2x local): Account 1 90% / Account 2 51% (session, refreshed since iteration 1's 5h window rolled over). Both healthy, well above thresholds.

**NEXT ACTION (superseded)**: ~~investigate H1 under true live-transcript conditions~~ — done, see ITERATION 3.

## ITERATION 3 (2026-07-16/17, continued) — H1 retest (refuted again) + H8 confirmed (deferred fix)

Asked user whether to keep going autonomously given the chaotic shared-workspace situation; user said keep going. Continued.

### H1 retest under more realistic conditions
`traces/golden-trace-live-transcript-race.mjs`: built a realistic multi-turn prior transcript (3 turns of interviewer/candidate small talk) before attaching a reference doc, then asked the very next question at t+4ms after attach. **Correctly grounded** (mentioned both facts asked about, no refusal). Further refutes H1/H6 for this scenario class. Still not tested under a TRUE live microphone / real-time STT pipeline — that remains the one gap for fully closing out symptom #1.

### H8 (double execution / desync) — CONFIRMED, root cause pinned, fix DEFERRED (not rushed)
Fired 3 distinct fact-specific questions in overlapping flight (`traces/golden-trace-rapidfire-desync.mjs` + `-console.mjs` for the mechanism trace). Reproduced the founder's exact "answers a completely different question" symptom: only 1 of 3 questions produced any answer (the other 2 hit the auto-trigger's `cooldown` gate, which is itself correct/intended behavior), but that ONE answer was delivered as the response to a DIFFERENT question's promise than the one that generated it.

Root cause: `IntelligenceEngine.ts`'s final `emit('suggested_answer', finalWtaAnswer, question, confidence)` (~line 2439) is deliberately "UNGATED" against the method's own `currentGenerationId` supersession-check machinery (per its own code comment) — a documented earlier fix for a DIFFERENT bug ("What to answer stops responding after a few messages"). Confirmed this is reachable in real production (not just my E2E harness): `ipcHandlers.ts`'s manual-press handler (`generate-what-to-say`) explicitly passes `skipCooldown: true` so a user's manual button press can genuinely race an in-flight auto-triggered generation for a different question, and the renderer's `finalizeStreamingByIntentMessages` has no per-answer question/generationId check — only cross-INTENT clobbering is guarded, not cross-QUESTION-within-the-same-intent.

**Deliberately did NOT rush a fix this iteration.** A naive fix (gate the emit on generation match, drop stale answers) would very likely reintroduce the exact "app goes silent" regression the ungating was originally added to fix — R2 anti-thrash forbids re-fixing an already-fixed pattern by breaking it a different way. The right fix needs the emit to carry generation/question identity through to the renderer so the renderer can render a superseded-but-still-real answer as ITS OWN correctly-labeled turn (never silently dropped, never misattached to a different question's row) — a coordinated 2-3 file change (engine emit signature → preload/IPC channel → renderer finalize logic) that deserves its own focused iteration.

### Ledger update

| # | Hypothesis | Verdict | Evidence | Fix commit | Status |
|---|---|---|---|---|---|
| 4 | H8 — `emit('suggested_answer', ...)` ungated vs `currentGenerationId` | REVISED: real code pattern exists but NOT reachable via any live UI path (see iteration 4 correction) | `traces/golden-trace-rapidfire-desync.mjs` exercised `handleSuggestionTrigger`, which has exactly ONE caller in the whole codebase — the `__e2e__:manual-ask` test handler. Real UI's `handleWhatToSay()` has an airtight single-in-flight guard (`tryBeginOverlayAction`/`overlayActionInFlightRef`) blocking concurrent presses; confirmed via code-review-graph `callers_of` + direct read of all 5 real call sites. | n/a — not pinned, not fixed, logged as Phase 4 defense-in-depth candidate only | **CLOSED as non-issue for Phase 1. Do NOT re-open without a NEW live-reachable repro (e.g. through the real `generate-what-to-say` IPC channel, not `__e2e__:manual-ask`/`handleSuggestionTrigger`).** |

### QUOTA
QUOTA (iteration 3, ~00:0x local Jul 17): Account 1 90% / Account 2 ~40% session. Both healthy.

**NEXT ACTION (superseded)**: ~~design/implement H8 fix~~ — CORRECTED, see ITERATION 4: H8 is not reachable via any live UI path, so no fix is needed for it in Phase 1. Closed as non-issue.

## ITERATION 4 (2026-07-17) — H8 correction + move to Phase 2 (test harness)

User asked for "one more round" then to continue reviewing + other phases. Used the round to properly verify iteration 3's H8 finding before building anything on top of it — and found iteration 3 had overclaimed.

### H8 correction (important process lesson)
Before designing the H8 fix, traced the REAL (non-`__e2e__`) call graph for `handleSuggestionTrigger` using `mcp__code-review-graph__query_graph_tool(callers_of)`: it has exactly ONE caller anywhere in the codebase — `ipcHandlers.ts:10883`, itself inside the `__e2e__:manual-ask` test-only handler. The real production trigger (`renderer's handleWhatToSay()` → `generateWhatToSay` → `generate-what-to-say` IPC → `runWhatShouldISay` directly) never goes through `handleSuggestionTrigger` at all, and is protected by a real, airtight single-in-flight guard (`tryBeginOverlayAction`/`overlayActionInFlightRef`, confirmed at all 5 real call sites of `handleWhatToSay`) that blocks a second press while a prior one streams. My rapid-fire repro (3 concurrent `__e2e__:ask` calls) was actually racing 3 concurrent `im.reset()` calls (each `__e2e__:ask` calls `reset()` before triggering) feeding a code path only the test harness reaches — not a defect a real user can hit through the shipped UI.

**Correction applied**: `traces/forensic-report.md` §6b revised in place (not deleted — kept as a documented false-positive with the full reasoning, since a future session hitting the same trace pattern should see why it was closed). Ledger updated to CLOSED. No fix attempted or needed. Logged as a Phase 4 defense-in-depth item only (the emit SHOULD carry generation identity for robustness against a hypothetical future caller, but nothing today needs it).

**Process lesson for future iterations, self-recorded**: before pinning any root cause found via an `__e2e__:*`/test-only handler, ALWAYS trace the real (non-test) call graph for the method being exercised first. An E2E harness existing for a method is not proof a real user can reach it the same way.

### Moving to Phase 2 (test harness)

Per user instruction ("continue reviewing the rest and continue with other phases"), and per loop.md's own Phase 3 loop structure (benchmark → biggest failure cluster → fix → repeat), the campaign needs the actual C1-C8 category benchmark harness before further fixing makes sense — otherwise further hypothesis-hunting is unguided. Per §0's finding, `test/harness/` should REUSE existing infrastructure rather than duplicate it:
- `tests/context-os-real-backend/` already has: a real-Electron+real-MiniMax runner (`run-200q-benchmark.mjs`), an LLM-judge (`llm-judge.mjs`, `judge-score.mjs`), and a 200-question thesis-document fixture with expected-facts manifest (`fixtures/sample-thesis/`). This covers C1/C2/C5 (verbatim/synthesis/refusal) for REFERENCE-DOCUMENT grounding but has ZERO resume/JD fixtures.
- `tests/e2e-modes/_ks_realfixture_verify.mjs` covers a single resume+JD smoke case but has no manifest/scoring, just one hardcoded assertion set.
- Need to add: C3/C4 (mode+resume, mode+JD grounding) fixtures+questions, C6 (adversarial/prompt-injection) fixtures, C7 (race/immediate-ask, already partially covered by this session's golden-trace-*.mjs scripts) and C8 (rapid-fire desync — NOW KNOWN to need to go through the REAL `generate-what-to-say`-equivalent path, not `handleSuggestionTrigger`, given the iteration 4 correction) as their own harness categories.

### QUOTA
QUOTA (iteration 4 start, 2026-07-17 ~01:2x local): Account 1 100% session (fresh window) / Account 2 92% session. Both healthy.

**NEXT ACTION (superseded)**: ~~build test/harness~~ — DONE, see below.

### Phase 2 harness built + first run + 1 more fix landed (same iteration 4, continued)

Built `test/harness/` (fixtures/manifest.json + run-benchmark.mjs), committed as `951e3a3`. First run (`run-001`, 10 cases, real MiniMax-M3) scored 8/10 and surfaced 2 NEW confirmed defects (NEW-1, NEW-2) plus verified adversarial-injection resistance holds (NEW-3, positive finding). Full detail in `traces/forensic-report.md` §6c.

**NEW-1 FIXED AND VERIFIED THIS ITERATION**: `AnswerPlanner.ts`'s coding-pattern regex `\bin\s?order\b` (meant for "in-order traversal") false-positived on the ordinary English phrase "in order" (e.g. "worked at, in order?"), misrouting résumé questions to `coding_question_answer` — which forbids the resume context layer per spec, so the model fabricated a fictional employment history instead of grounding correctly. Fixed with a narrow co-occurrence guard (order-word variants now require an explicit tree/traversal-adjacent term), mirroring the file's own existing `class`/`method` narrowing pattern. Verified: standalone regex tests (false positives gone, all genuine DSA phrasings still match), `npm run typecheck:electron` clean, `AnswerPlannerValidator.test.mjs` 12/12 pass, full `electron/llm/__tests__` suite 2483/2543 pass (the 60 failures are all pre-existing, unrelated, dated files — none mention "in order"/"traversal"/coding patterns), and a LIVE re-run of the exact failing benchmark case now passes with the correct 4-employer answer.

**NEW-2 (negotiation-classified questions get zero grounding on the WTA path) remains OPEN** — needs a design decision, not a quick patch, per the reasoning in `traces/forensic-report.md` §6c. Deferred to next iteration.

### Ledger update
See `traces/forensic-report.md` §6c for the full NEW-1/NEW-2/NEW-3 ledger rows (already written there in detail); campaign-log.md tracks the short version:
- #5 (NEW-1): DONE, verified live.
- #6 (NEW-2): OPEN, pinned, needs design work.
- #7 (NEW-3, adversarial injection resistance): confirmed holding, no action needed.

### QUOTA
QUOTA (iteration 4, continued, ~08:2x local Jul 17): Account 1 100% session (fresh window) / Account 2 26% session. Both healthy — 9Router fails over automatically; only pause if BOTH drop below 10%.

**NEXT ACTION**: Design and implement the NEW-2 fix (distinguish a pure factual JD/document lookup — safe to ground — from genuine negotiation-coaching — the gated case — likely by consulting `AnswerPlanner`'s own `answerType` alongside `transcriptQuestionExtractor`'s cruder `negotiation` classification in `IntelligenceEngine.ts`'s `groundable` gate, rather than trusting either classifier alone). Verify live via `test/harness/run-benchmark.mjs` C4-002 before considering it done. After that, expand the harness with more cases per category (currently only 1-4 cases each) for better statistical confidence, and consider adding C8 properly once/if a renderer-driving harness exists. Re-check git branch/status and L9 quota before starting (shared workspace).
