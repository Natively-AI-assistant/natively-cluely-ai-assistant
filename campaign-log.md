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

**NEW-2 FIXED AND VERIFIED THIS ITERATION — turned out to be 4 stacked bugs, not 1.** Chasing the single false-refusal symptom required fixing, in order:
1. `IntelligenceEngine.ts`'s `groundable` gate excluding all `negotiation`-classified questions (added a narrow widen via new exported `isJdFactualLookupNotNegotiationAdvice` helper in `AnswerPlanner.ts`).
2. `KnowledgeOrchestrator.processQuestion`'s `factualRecall` gate ALSO by-design excluding NEGOTIATION intent — fixed via an early carve-out that returns the existing `maybeGroundedOnlyResult` (clean JD-only grounding, no coaching leak) for the JD-fact-not-advice shape specifically.
3. `IntentClassifier.ts`'s `IDENTITY_DIRECT_PATTERNS` bare `'what company'`/`'which company'` match false-positiving on JD-framed questions ("what company IS THIS ROLE at" vs "what company do YOU work at"), forcing INTRO intent before scoring even ran — fixed with a `JD_ROLE_FRAME_RE` disqualifier.
4. `ProfileContextBuilder.ts`'s `buildTargetJobBlock` never rendering the extracted `compensation_hint` field at all — fixed by adding it to the rendered sections.

All 4 verified together live: "What company is this role at, and what's the compensation range?" now correctly answers "This role is at Helio Labs. The compensation range is 175,000 to 200,000 base salary plus meaningful equity." Full detail + reasoning for why each was necessary in `traces/forensic-report.md` §6c.

Full regression check: `npm run typecheck:electron` clean; `electron/llm/__tests__` full suite 2483/2543 pass (same pre-existing unrelated failures as before, zero new regressions from any of the 4 changes).

### Ledger update
See `traces/forensic-report.md` §6c for the full NEW-1/NEW-2/NEW-3 ledger rows; campaign-log.md tracks the short version:
- #5 (NEW-1): DONE, verified live.
- #6 (NEW-2): DONE (4 stacked sub-fixes), verified live.
- #7 (NEW-3, adversarial injection resistance): confirmed holding, no action needed.

### QUOTA
QUOTA (iteration 4, continued, ~08:5x local Jul 17): Account 1 90% session / Account 2 0% session (fully out, resets ~07:00 UTC). 9Router auto-fails-over to Account 1 — continuing normally per L9 (only pause if BOTH drop below 10%).

**NEXT ACTION (superseded)**: ~~commit 4 fixes~~ — done (commits `5f37eee` + submodule `be0cc4d`). ~~run full regression~~ — done, 10/10 clean (`run-002-full-regression`). ~~run existing 200q thesis benchmark~~ — done, see below.

## ITERATION 5 (2026-07-17) — Ran the pre-existing 200-question thesis benchmark for the first time this session (C1/C2/C5 coverage)

User asked "all phases done?" — answer was no (Phase 3/4 + final report all still open). User said keep going. Ran `tests/context-os-real-backend/run-200q-benchmark.mjs` against the `development` split (140 cases, real Electron + real MiniMax-M3, manual-chat surface) for the first time this session — `test-results/context-os-real-backend/` didn't exist before this run.

**Result: 119/140 deterministic (85.0%), 124/140 two-tier after LLM judge (88.6%).** Matches a prior session's memory (`ctxos-prodready-session2-2026-07-13.md`: "114→119/140 det") almost exactly — this specific benchmark's score has been STABLE since 2026-07-13, unaffected by any of this session's H3/NEW-1/NEW-2 fixes (expected: those all targeted the WTA/live-overlay path, not this benchmark's manual-chat `EvidenceResolver` path).

**Triaged all 16 two-tier failures individually against the source document** (not just trusting the scorer) — this took real effort and materially changed the picture:
- 8 genuine false refusals (fact IS in the document, retrieval isn't surfacing it) — real open H1/H6 gaps.
- 1 CONFIRMED entity-substitution hallucination: Mercury X1's hardware-spec-table "Control System: NVIDIA Jetson Xavier" question got answered with a different-but-also-real Mercury X1 fact (the AutoGen/LLaMA software framework) instead — genuine table-vs-prose retrieval-precision confusion.
- 7 turned out to be PRE-EXISTING BENCHMARK RUBRIC ARTIFACTS, not live defects: several "name two X" questions hardcode one specific valid pair when the source lists 4-5 valid options, and the model's (different, equally correct) answer got scored as wrong. Confirmed via direct source-document search, not assumed. This is NOT a live grounding bug — do not attempt to "fix" the app to produce one specific hardcoded subset.

Full writeup with per-case citations in `traces/forensic-report.md` §6d.

### Ledger update
- #8 (H6 — table vs prose entity confusion on Mercury X1): OPEN, confirmed, not yet fixed. Different code path than this session's WTA fixes.
- #9 (H1/H6 — 8 genuine false refusals on thesis benchmark): OPEN, confirmed, not yet root-caused. Real work for next iteration.
- #10 (benchmark rubric rigidity): flagged as a fixture limitation, explicitly NOT something to "fix" in the app.

### QUOTA
QUOTA (iteration 5, ~03:2x local Jul 17): Account 1 74% session / Account 2 0% (fully out, 9Router auto-fails-over). Continuing per L9 — only pause if BOTH drop below 10%.

**NEXT ACTION (superseded)**: ~~pick 2-3 false-refusal cases, golden trace~~ — DONE, root cause PINNED, see below.

## ITERATION 6 (2026-07-17) — Golden trace pins H6 root cause: EvidenceResolver's answer-shape cap drops answer-bearing chunks

Did a full 3-step golden trace on THESIS-079 and THESIS-094 (both confirmed false refusals from iteration 5):
1. Raw retrieval inspection (`__e2e__:inspect-retrieval`, bypasses `EvidenceResolver`) — CONFIRMED the answer-bearing text ("Logitech C920", "480") IS retrievable.
2. Full manual-chat path trace (same `streamGeminiChat` surface the real benchmark uses) — found the model still refuses, and the actual `docContextBlock` used for generation is dramatically smaller than what step 1 found (2661/6779 chars vs 15936/16296 chars) — meaning something AFTER retrieval, but BEFORE generation, is discarding content.
3. Temporary tagged trace (`[TRACE:evidence-selection]`, added to `evidenceSufficiency.ts`, then FULLY REVERTED after confirming) pinned the exact mechanism: `EvidenceResolver.finalizePack` → `selectSmallestSufficientEvidence` caps the surviving chunk count by `answerShape` — 6 for comparison, 5 for list, **3 for everything else including 'numeric'**. THESIS-094's question had `eligibleAfterFilter: 6` chunks but only the top 3 by composite relevance score survived — and the answer-bearing chunk didn't make that cut.

**Root cause PINNED but NOT fixed this iteration** — deliberately, per R2: changing a hardcoded cap number without understanding why it was originally chosen, and without a full before/after regression on the 140-case benchmark, is exactly the kind of quick-patch this campaign's anti-thrash discipline exists to prevent. This is the single most concrete, well-evidenced Phase 1 candidate going into the next iteration.

Cleaned up all 3 temporary diagnostic logs before finishing — carefully, since `electron/ipcHandlers.ts` had substantial UNRELATED concurrent-session work mixed into its working-tree diff at the time (the other session appears to be wiring `TurnEvidenceCoordinator` into production — the exact dead-code module iteration 1's forensic report flagged). Removed only my own added lines by exact context match, never a blanket revert of the file, to avoid destroying their in-progress work.

### Ledger update
- #11 (H1/H6 — EvidenceResolver's per-answer-shape cap too aggressive): OPEN, root cause pinned precisely, needs a careful fix + full regression next iteration.

### QUOTA
QUOTA (iteration 6, ~04:0x local Jul 17): Account 1 66% session / Account 2 0% (9Router auto-fails-over). Continuing per L9.

**NEXT ACTION (superseded)**: ~~design the cap fix~~ — DONE, verified, see below.

## ITERATION 7 (2026-07-17) — Cap fix landed and verified via full 140-case regression; PAUSING for quota

Checked `git log -p`/`git blame` on the cap line first, per R1/R2: the 3/5/6 numbers were the ORIGINAL values from the function's introduction, never separately tuned later. A subsequent commit (`be7d7e0`) diagnosed this EXACT symptom class and fixed the ranking algorithm while deliberately leaving the cap itself alone — confirming raising the cap now is a legitimate untried step, not a re-fix.

**Fix**: raised the default/`'numeric'` cap in `selectSmallestSufficientEvidence` (`electron/intelligence/context-os/evidenceSufficiency.ts`) from 3 to 5, matching the existing `'list'` cap. `'comparison'` (6) and `'list'` (5) untouched. Updated the one pinned unit test asserting the old cap value.

**Full regression run** (`dev-run-002-capfix`, 140 cases): raw deterministic score held flat at 119/140, but a case-by-case diff showed the REAL story — exactly one flip each way. THESIS-094 (the pinned target) flipped fail→pass: fixed for real. THESIS-026 flipped pass→fail, investigated immediately: its new answer is factually identical to the old one, just reformatted as a bulleted list instead of a joined phrase — a scorer-rigidity artifact (same class as iteration 5's findings), confirmed by the second-tier LLM judge upgrading it right back to a pass. **Two-tier pass rate genuinely improved: 124/140 (88.6%) → 126/140 (90.0%)**. `electron/intelligence/__tests__` full suite: 838/857, the 10 failures confirmed pre-existing and unrelated (different files, different subsystem).

THESIS-079 (a `'list'`-shaped case with 6 eligible chunks against an unchanged cap of 5) remains open — deliberately not touched this round to keep the fix narrow and independently verifiable.

### Ledger update
- #11 (H1/H6 — EvidenceResolver cap): DONE for numeric/default bucket, verified via full regression. List-shape residual gap (THESIS-079) logged as a smaller, separate open item.

### PAUSING FOR QUOTA
Both accounts hit the pause threshold simultaneously: Account 1 dropped to 10% session (right at the pause floor), Account 2 fully out (0%, reset ~07:00 UTC). Per L9: pause when one account is out AND the other is ≤10%. Both conditions now hold.

QUOTA: Account 1 10% / Account 2 0% (session). Resets: Account 2 at 2026-07-17T07:00:00Z. Using that as the resume target (+2min buffer per L9 pause procedure) since it's the account that's fully dead; Account 1 should also refresh soon given its own 5h window.

**NEXT ACTION (superseded)**: ~~re-check quota, commit cap fix~~ — cap fix commit landed (bundled into concurrent commit `c4ac05d`, confirmed present via grep/content check, not lost). See ITERATION 8.

## ITERATION 8 (2026-07-17) — Resume after quota pause; found TurnEvidenceCoordinator now wired live

Resumed after the L9 pause. Account 1 (Claude session) hit 0%, but Account 2 recovered to 48% (past its reset) — 9Router fails over automatically, so per L9 this is a "continue normally" state, not a further pause.

While reviewing the shared working tree during the pause window (no model calls needed for this), discovered the concurrent session has wired `TurnEvidenceCoordinator` — the exact module iteration 1's forensic report flagged as "well-tested but dead code" — into `ipcHandlers.ts`'s manual-chat path, dated "CONTEXT OS (2026-07-17)" in its own comments, behind a new `contextOsMultiFamilyEvidenceEnabled` flag. This directly resolves that iteration-1 finding. Documented in `traces/forensic-report.md` §5's wiring table, explicitly flagged as NOT independently verified live by me — found by reading code during a pause, not via a live trace, per this campaign's own evidence-before-edits discipline (R1/R3). A future iteration should confirm it actually fires and helps before counting it as done.

### QUOTA
QUOTA (iteration 8, resume ~07:3x local): Account 1 0% / Account 2 48% (recovered). Continuing per L9 (at least one account healthy, 9Router fails over).

**NEXT ACTION (superseded)**: chose (b) — wrote `traces/final-report.md`, see below.

## ITERATION 9 (2026-07-17) — Wrote traces/final-report.md (honest, not claiming L4 exit)

Wrote the first `traces/final-report.md`, consolidating all 8 iterations of findings: 4 verified fixes with commit references (H3, NEW-1, NEW-2's 4-sub-fix chain, H6-cap), confirmed-holding items (adversarial injection resistance, H1/H2/H5 refuted, H8 corrected), the newly-discovered `TurnEvidenceCoordinator` wiring (logged, not independently verified), confirmed-open gaps (list-cap residual, Mercury X1 entity confusion, 6-7 untraced false refusals, H4 untested, C8 untestable without a renderer harness), and an honest "what's left to reach 95%" section rather than overclaiming L4 exit.

**Explicitly NOT claiming the loop.md L4 exit condition is met.** The campaign has real, live-verified progress (4 solid fixes, 2 benchmark improvements) but has not run two consecutive full passes at ≥95%/≥90%-per-category/zero-hallucination/≤2%-false-refusal. The final report says so plainly in its opening line, per this campaign's own L5 ("premature success is the failure mode").

Also captured 5 process lessons in the final report's closing section (verify real reachability before pinning a test-only-handler-found root cause; a scorer failure isn't automatically a live defect; check git history before changing a hardcoded constant; multiple uncoordinated classifiers is a systemic risk; commit promptly/narrowly in a shared workspace) — these are reusable across future sessions on this repo, not just this campaign.

### QUOTA
QUOTA (iteration 9, ~08:0x local Jul 17): Account 1 0% / Account 2 reports "Usage API requires admin permissions" (treated as healthy/unknown per L9, since it's actively serving requests). Continuing normally.

**NEXT ACTION (superseded)**: ~~continue picking off items from final-report.md §6~~ — picked "golden-trace the remaining 6-7 unexplained false refusals" (item 2). See ITERATION 10.

## ITERATION 10 (2026-07-17) — Golden-traced all 6 remaining thesis-benchmark false refusals; THREE new distinct root causes found, none fixed yet

Wrote `traces/golden-trace-thesis-batch2.mjs` (same proven 2-step methodology as THESIS-079/094: raw retrieval inspection, then full manual-chat path) covering THESIS-072, 088, 091, 093, 129, 131 — the 6 cases from `dev-run-001` never individually traced before this iteration.

**First checked whether this iteration's own trace harness was even comparable to the rest of the campaign**: `golden-trace-thesis-batch2.mjs` sets `NODE_ENV=development`, and the newly-discovered `contextOsMultiFamilyEvidenceEnabled` flag (iteration 8's finding) defaults ON in dev/test contexts. Confirmed via code read that this flag only gates the NEW `TurnEvidenceCoordinator` path for profile/JD-bearing turns — these 6 questions are pure reference-file lookups, so they route through the existing (already-fixed) `EvidenceResolver` doc-grounded path regardless, unaffected by that flag. Comparable to prior iterations' traces — no methodology gap.

Deep-verified all 6 against the real source PDF text (`tests/context-os-real-backend/fixtures/sample-thesis/pages.json`) and, for the most informative 3, against the EXACT provider payload (main-process `app.evaluate()` reading `__contextOsProviderPayloadCapture` — the renderer's `w.evaluate()` cannot see this global, a mistake caught and corrected mid-iteration by comparing against how `golden-trace-jd-payload-capture.mjs` does it correctly).

**Results: 2 refuted (genuine retrieval-recall misses, not new bugs), 3 confirmed as new, mutually-distinct root causes, 1 not fully pinned:**

- **THESIS-072/088**: raw retrieval genuinely lacks the answer-bearing text (confirmed via substring grep — zero hits for "3GPP" or "Open X-Embodiment insufficiency" reasoning in the retrieved block, despite both being in the source PDF). Matches the pre-existing "genuine retrieval miss" category from iteration 9's final-report §5 — not a new bug, not investigated further.
- **THESIS-093 (NEW finding A — ranking tie-break bug)**: instrumented `selectSmallestSufficientEvidence` directly (temporary trace, proven firing, fully reverted after). The CORRECT chunk (apple/orange, "no interaction is performed with them") IS in the retrieval pool and survives the cap, but LOSES a near-tie in `answerRelevanceScore` to a lexically-similar WRONG chunk from a different section that happens to contain the question's literal phrase "never interacted with" (about banana/grapes in an unrelated benchmark). The model then confidently fabricated a plausible narrative around the wrong chunk it was given — a "had the right evidence available in the pool, ranking picked the wrong one" bug, structurally different from the already-fixed cap-drops-it-entirely issue.
- **THESIS-129/131 (NEW finding B — OKF-card lossy-extraction, no fallback)**: added a small permanent diagnostic handler (`__e2e__:dump-okf-cards`) to inspect `KnowledgeManager`'s extracted OKF cards directly. Confirmed NO OKF card contains the "Gemma 3 12B... third-person camera" passage at all — the OKF extractor split it across a "Framework summary" card (compressed to one line, drops both facts) and a same-topic-different-content "Self-awareness capabilities" card (a different section entirely, benchmark #3 results). Raw hybrid retrieval DOES find the correct passage, but `EvidenceResolver.resolveFromOkf` runs FIRST and has no fallback-to-hybrid-chunks when its own OKF cards are answer-deficient — a third, previously-unexamined evidence-resolution strategy with its own false-refusal failure mode.
- **THESIS-091 (NEW finding C — query-dependent recall gap, not fully pinned)**: the correct template-example passage is retrievable under THESIS-093's query phrasing but NOT under THESIS-091's different phrasing of a question about the same passage — confirmed via cross-checking both raw pools. Logged as a distinct, real gap; root cause not pinned past "query formulation affects recall for this passage" (would need embedding-space inspection, out of scope for a golden-trace pass).

**Explicit anti-thrash check (R2)**: confirmed all 3 new findings are structurally DIFFERENT from the H6-cap fix already landed (iteration 7) — cap-fix only helps when the chunk is in the eligible pool but trimmed by cap size; finding A shows a chunk that survives the cap but loses a scoring tie-break; finding B is a wholly different evidence-resolution strategy (OKF cards, no cap involved); finding C is a chunk that never enters the pool at all for this query. None would be fixed by touching the cap again.

**Nothing fixed this iteration** — all 3 new findings are logged with full evidence in `traces/forensic-report.md` §6f, none yet has a designed/attempted fix. This iteration was pure investigation, per the NEXT ACTION carried over from iteration 9.

**Cleanup (R10)**: the temporary `[TRACE:evidence-selection]` instrumentation in `EvidenceResolver.ts` was fully reverted (confirmed zero diff via `git diff`). The new `__e2e__:dump-okf-cards` handler is KEPT (E2E-gated, read-only, same pattern as existing `__e2e__:inspect-retrieval`/`__e2e__:context-os-prompt-audit`, ongoing diagnostic value). 8 new golden-trace scripts added to `traces/` (batch2, thesis093-detail, thesis093-rawpool, thesis129-detail, thesis129-full, thesis129-rawpool, thesis131-full, thesis091-full, okfcards-dump) — all safe to keep per existing precedent (§7 diagnostic artifacts).

### Ledger update
- #12 (THESIS-093 — ranking tie-break on literal-phrase overlap): OPEN, root cause pinned, not yet fixed.
- #13 (THESIS-129/131 — OKF-card lossy extraction, no hybrid fallback): OPEN, root cause pinned, not yet fixed.
- #14 (THESIS-091 — query-dependent recall gap): OPEN, partially pinned (not root-caused past "query-dependent").
- THESIS-072/088: REFUTED as new findings — genuine pre-existing retrieval-recall misses, matches iteration 9's known-gap category.

### QUOTA
QUOTA (iteration 10, ~09:0x local Jul 17): not re-checked this iteration (no model-provider calls made beyond the real MiniMax-M3 backend already in use for traces — this iteration was investigation/instrumentation, same call volume as prior traces). Will check before starting the next fix-design work.

**NEXT ACTION (superseded)**: ~~design and land fixes for #12 and #13~~ — BOTH landed and live-verified this iteration. See ITERATION 11.

## ITERATION 11 (2026-07-17) — Landed and verified fixes for #13 (OKF entity-scoping) and #12 (evidence-selection early-stop); full benchmark re-running

Quota healthy at start (Account 1: 80% session remaining) — no pause needed.

### Fix #13 — OKF distinctive-term gate must be ENTITY-SCOPED, not pooled (THESIS-129/131)

Before touching anything, re-derived the exact mechanism live: added a permanent `entities`/`tags`/`sourceSections` field to the existing `__e2e__:dump-okf-cards` handler and dumped the full 61-card OKF pack for the thesis document. Confirmed precisely: the 2026-07-13 "salient distinctive term" gate (`resolveFromOkf` in `EvidenceResolver.ts`, added by `81517be`) checks whether a salient term appears **anywhere across the pooled set of selected cards** — not whether it co-occurs with the question's named entity in the SAME card. For "What model is the visual backbone for the Self-Awareness Tool?" (entity: "Self-Awareness Tool", salient term: "backbone"), the pooled check was satisfied because an unrelated "OpenVLA" card mentions "backbone" — OpenVLA's OWN backbone, not the Self-Awareness Tool's — so the gate wrongly let OKF answer from cards that never actually named the target entity's architecture. Same root cause for THESIS-131 ("perspective").

**Fix**: when the question names a target entity, require the SAME card to carry both the salient term AND the entity (reusing the existing `supportsEntity` helper from `evidenceSufficiency.ts`, now exported for reuse) — not just any card in the pool for each independently. Falls back to the prior pooled check when the question names no entity, so the existing "working voltage" tests (which don't name a target-entity-scoped salient-term scenario in this way) are unaffected.

**Verified**: added a 4th regression test to `EvidenceResolver.test.mjs` reproducing the exact real-document pattern (entity-named card with the fact but not the salient word, vs. a different-entity's card with the salient word but not the fact) — passes, and the 3 pre-existing tests in that describe block still pass unchanged. Live-traced THESIS-129 and THESIS-131 fresh (`golden-trace-thesis129-full.mjs`, `-thesis131-full.mjs`): both now correctly answer ("Gemma 3 12B from Google DeepMind", "third-person camera perspective") instead of falsely refusing.

### Fix #12 — evidence-selection early-stop must require one item with STRONG coverage, not just pooled union coverage (THESIS-093)

Re-derived the exact live mechanism (temporarily reinstrumenting `EvidenceResolver.finalizePack`, then fully reverting after — same discipline as prior iterations). Real numbers from the live manual-chat path (differ from the earlier `inspect-retrieval`-based reconstruction, which uses a different retrieval call — the resolver's real numbers are the ones that matter): composite-ranked pool has the WRONG chunk (139, "the second fruit was never interacted with" — about banana/grapes in an unrelated benchmark) at rank #1, two generic "objects visible" filler chunks at ranks #2/#3, and the CORRECT chunk (93, "an apple and an orange are visible... but no interaction is performed with them") at rank #4 — one slot past the `floor=3` early-stop.

Root cause, precisely: `selectSmallestSufficientEvidence`'s dynamic early-stop (`evidenceSufficiency.ts`, from `be7d7e0`) tracks covered distinctive terms as a **union across all selected items** — rank #1 covers {never, interacted}, ranks #2/#3 each cover {objects, visible}; together these 3 individually-weak, mutually-unrelated chunks "cover" all 4 distinctive terms and the floor(3) stop fires, one slot before rank #4 (the chunk that actually answers the question, using different wording — "no interaction is performed with them" vs. the question's "never interacted with" — so it doesn't share the same 2 terms as rank #1).

**Fix**: require at least one SELECTED item to individually reach strict-majority distinctive-term coverage (reusing the exact "covered * 2 > distinctive.length" pattern the codebase already uses in `isAnswerRelevantWithoutEntity`) before the union-based early-stop is allowed to fire. Several weak partial matches can no longer masquerade as sufficient evidence.

**Verified**: added a 6th regression test to `EvidenceSufficiency.test.mjs` reproducing the exact real-document pattern (5 items: a phrase-decoy, two generic-filler decoys, the correct answer, one more filler — none individually covering a strict majority) — passes, and the 5 pre-existing tests in that file still pass unchanged (including the "dynamic stop... bounded by cap" test, whose assertion is `<=3` not `===3`, so it tolerates the new item surviving). Live-traced THESIS-093 THREE times fresh (`golden-trace-thesis093-detail.mjs`) — all 3 runs now correctly answer "apple and orange", up from the pre-fix 3-of-3 mix of hallucination/refusal/hallucination (the pre-fix nondeterminism itself was interesting: identical evidence selection every time, but MiniMax-M3 nondeterministically hallucinated a plausible-but-wrong answer from the wrong chunk vs. correctly refusing — now moot since the correct chunk is in the pack).

### Regression checks (both fixes together)

- `npx tsc --noEmit` clean.
- `electron/intelligence/__tests__/EvidenceResolver.test.mjs` + `EvidenceSufficiency.test.mjs`: 17/17 pass (both new tests included).
- Full `electron/intelligence/__tests__/**` suite (75 files, run via `ELECTRON_RUN_AS_NODE=1 electron --test`): 840/859 (2 more tests than before from my additions), same **10 pre-existing, confirmed-unrelated failures** (`ProfileIdentityBaseline.test.mjs`, `IntelligenceOsE2E.test.mjs` — different subsystem, unrelated to `evidenceSufficiency.ts`/`EvidenceResolver.ts`) as every prior iteration's regression check.
- Live-verified THESIS-129, THESIS-131, THESIS-093 (3x) all fixed and stable after both changes landed together, not just individually.
- Full 140-case thesis benchmark (`dev-run-004-okf-and-093fix`) launched in background for the definitive before/after comparison; result pending at time of this writeup.

### Anti-thrash / discipline notes

- Checked `git log --all -p` on both touched functions before changing anything: `resolveFromOkf`'s salient-term gate traced to `81517be`; `selectSmallestSufficientEvidence`'s floor traced to `be7d7e0`. Neither fix re-touches a prior fix's already-resolved symptom (the H6-cap fix from iteration 7 raised the CAP; these two fixes touch the EARLY-STOP and the OKF ENTITY-SCOPING respectively — distinct mechanisms, confirmed in iteration 10's writeup).
- All temporary trace instrumentation (re-added in `EvidenceResolver.ts` to derive ground-truth numbers for the #12 design) was fully reverted after use — confirmed via `git diff --stat` showing only the intended fix diff remains, no stray `console.log`/`TRACE:` lines.
- Extended the existing `__e2e__:dump-okf-cards` E2E-only diagnostic handler (added last iteration) with `entities`/`tags`/`sourceSections` fields — kept permanently, same precedent as before.

### Ledger update
- #12 (THESIS-093 — evidence-selection early-stop): **FIXED AND LIVE-VERIFIED.** Full benchmark regression pending.
- #13 (THESIS-129/131 — OKF entity-scoped salient-term gate): **FIXED AND LIVE-VERIFIED.** Full benchmark regression pending.
- #14 (THESIS-091 — query-dependent recall gap): still OPEN, not attempted this iteration (lower priority, not yet root-caused past "query-dependent").

### QUOTA
QUOTA (iteration 11, ~14:3x local Jul 17): Account 1 50% session remaining. Continuing normally, no pause needed.

**NEXT ACTION (superseded)**: ~~wait for dev-run-004, compare vs dev-run-003~~ — done below, WITH AN IMPORTANT SELF-CAUGHT LABELING CORRECTION.

## ITERATION 12 (2026-07-17) — Benchmark comparison completed; caught and corrected a mislabeled baseline

`dev-run-004-okf-and-093fix` finished all 140 cases (09:32-09:36 UTC): deterministic 123/140, vs. the `dev-run-003-okffix` figure I'd been treating as "pre-fix" (121/140).

**Before accepting this as the final number, investigated the flip list and found something that didn't add up**: THESIS-129/131 already showed `pass: true` via `hybrid_rag` strategy in `dev-run-003-okffix` — but I hadn't landed the OKF fix until partway through THAT SAME iteration, and `dev-run-003-okffix` was launched only ~37 minutes after committing iteration 10 (before the OKF fix existed). Cross-checked against `dev-run-001` and `dev-run-002-capfix` (both genuinely pre-either-fix, hours earlier): both show THESIS-129/131 failing via `okf_exact`/`okf_property`, consistently. Reconstructing my own action sequence this iteration confirmed the actual order was: (1) design + land the OKF entity-scoping fix (#13) and rebuild, (2) launch `dev-run-003-okffix` — mislabeling it as a "pre-fix" baseline when it was actually already running against the OKF-fix build, (3) only then investigate and land the evidence-selection fix (#12).

**Corrected comparison, using `dev-run-002-capfix` (genuinely pre-both-fixes) as the true baseline against `dev-run-004-okf-and-093fix` (genuinely both-fixes-landed):**

- **Deterministic: 119/140 → 123/140.**
- Flipped fail→pass: **THESIS-093, THESIS-129, THESIS-131** (the 3 targeted fixes) **+ THESIS-042** (a bonus — see below).
- Flipped pass→fail: **none.**

**THESIS-042 bonus finding, investigated before accepting it as a real win**: this is the exact "Mercury X1 hardware-spec-table vs. AI-framework-layer entity confusion" case (H6) flagged as an open, unfixed gap in `final-report.md` §5 (paired with THESIS-060). It now correctly answers "ALOHA" (required fact) instead of "Mercury X1" (the wrong-but-plausible entity). Checked whether H6 is now fully resolved by testing its paired case, THESIS-060 — **it is NOT**: THESIS-060 still fails identically before and after both fixes (same entity-confusion pattern, different specific fact). So the entity-scoping/strong-match generalization in both fixes incidentally resolved ONE of the two known H6 instances as a side effect, but H6 itself remains a real, open, only-partially-mitigated gap — not claiming it as fixed.

**THESIS-100 apparent regression, investigated and cleared as NOT a regression**: `dev-run-003-okffix` (the noisy intermediate run) showed THESIS-100 passing, but it fails in BOTH `dev-run-002-capfix` (true pre-fix) and `dev-run-004` (both fixes) — meaning THESIS-100 was never actually flipped by either fix; it's a pre-existing rubric-rigidity near-miss (source text: "RGB images... Joint angles for both arms (14-dimensional vector)"; the model's stable answer across repeated fresh traces: "images... 14-dimensional joint states array" — same facts, different wording, correctly failing the strict deterministic substring rubric both before and after). Live re-traced twice fresh to confirm this is a STABLE near-miss, not one-off nondeterminism: both fresh runs gave the same paraphrase-mismatch answer. Not a regression; not touched.

**Process lesson (adding to the running list)**: label benchmark run IDs and directories at LAUNCH time based on the actual git/build state at that moment, not based on what fix is "in flight" or "about to land" — a run started between two fix-landing points is neither a clean before nor a clean after, and treating it as either without re-deriving the true baseline from an independently-verified earlier run risks over- or under-counting a fix's real impact. Caught this only by noticing an inconsistency (THESIS-129 passing in a run I'd labeled pre-fix) and cross-checking against two independent, unambiguously-earlier runs rather than trusting the label.

### Final, honest scorecard for this iteration's 2 fixes (#12, #13)
- Deterministic thesis-benchmark score: **119/140 (85.0%) → 123/140 (87.9%)**, zero regressions, +1 unplanned bonus fix (THESIS-042, one of two H6 instances).
- Both fixes independently unit-tested (10 new/existing tests across 2 files, all passing) and live-verified via fresh golden traces before AND after the full-benchmark comparison.

### Ledger update
- #12 (THESIS-093): CONFIRMED FIXED against the correct baseline.
- #13 (THESIS-129/131): CONFIRMED FIXED against the correct baseline.
- THESIS-042 (H6, one of two instances): fixed as a side effect, logged, NOT claimed as full H6 resolution (THESIS-060, the other H6 instance, still fails).
- THESIS-100: investigated, confirmed a pre-existing, unaffected rubric-rigidity near-miss — not a regression, not touched.

### QUOTA
QUOTA (iteration 12, ~15:1x local Jul 17): not re-checked (no new provider-heavy work beyond the 2 confirmatory golden-traces + reading existing benchmark JSONL files). Will check before the next fix-design work.

**NEXT ACTION (superseded by iteration 13 quota pause)**: Commit both fixes (`EvidenceResolver.ts`, `evidenceSufficiency.ts`, their 2 test files) plus the updated `campaign-log.md`/`forensic-report.md` — re-check git branch/status first (shared workspace). Then decide next: attempt #14 (THESIS-091, lower priority, not yet root-caused), investigate H6/THESIS-060 further (now that THESIS-042 unexpectedly resolved, the remaining instance may share a nearby, findable cause), or move to other `final-report.md` §6 items (harness expansion, TurnEvidenceCoordinator verification, production-default decision, two-consecutive-clean-runs requirement for the L4 exit bar).

## ITERATION 13 (2026-07-17) — Mandatory quota pause before the next fix/benchmark

No product code or benchmark work was started in this wakeup. The persisted `loop.md`, `campaign-log.md`, and `traces/final-report.md` already exist; L4 is **not** satisfied (the latest full thesis result is 123/140 deterministic, below the campaign threshold, and the two required green `test/harness/reports/` runs do not exist).

### QUOTA
**CORRECTION (2026-07-17T11:01Z):** The prior Claude-account quota check was irrelevant to this session. The active session uses the 9Router **Codex** account, not the Claude accounts. Verified with `GET /api/providers` then `GET /api/usage/a84101b5-eecb-4c3e-8037-fdecc958250b`: Codex Plus session quota is **49% remaining** (51/100 used), `limitReached:false`, reset `2026-07-23T04:16:35Z`. The previous quota pause was therefore invalid and is canceled. Future campaign quota checks must use this Codex provider usage endpoint unless the active routing configuration changes.

**NEXT ACTION (superseded by iteration 14)**: Resume immediately. Re-check current shared branch/status, commit only the campaign-owned iteration-12 fixes and reports if still uncommitted, then trace H6/THESIS-060 before choosing a minimal, live-verified fix. Do not gate work on Claude-account quotas.

## ITERATION 14 (2026-07-17) — Resumed under Codex quota; H6/THESIS-060 forensics in progress

- Confirmed the active 9Router Codex Plus account has **49%** session quota remaining (51/100 used), `limitReached:false`, reset `2026-07-23T04:16:35Z`. Claude-provider quotas are intentionally ignored for this session.
- Re-checked shared workspace before work: branch is currently `fix/longsession-campaign`; only `traces/golden-trace-okfcards-dump.mjs` is modified among campaign paths, so no unrelated campaign fix/report was committed or reverted.
- Reconfirmed the open target precisely: THESIS-060 asks **“What main control system is listed for Mercury X1?”**, whose source table says **“NVIDIA Jetson Xavier (main), Jetson Nano (aux)”** (`tests/context-os-real-backend/fixtures/sample-thesis/pages.json`, page 17). Existing reports establish that THESIS-042 was incidentally fixed while THESIS-060 remains the unpinned H6 table-vs-prose/entity-confusion case.
- Began a read-only retrieval-evidence forensic pass against the real manual-chat `EvidenceResolver` route. No product code changed and no benchmark was launched pending a precise live-path diagnosis. Graph search initially did not surface the resolver by broad keyword but its file summary/callee graph confirms `resolve()` chooses OKF before hybrid retrieval.
- The first delegated forensic pass failed due to a **Claude-subagent 429**, not a product failure; it produced no finding and is not being treated as evidence. Continued without relying on it.
- Created `traces/golden-trace-thesis060-detail.mjs`, modeled on the prior proven manual-chat THESIS-093 trace: fresh Electron mode + real document indexing + raw `__e2e__:inspect-retrieval` + real `streamGeminiChat` request + Context OS prompt/benchmark audit + main-process provider-payload capture + temporary existing evidence-selection logging.
- **Harness-only launch failure:** the initial wrapper used the zsh-reserved variable name `status`; it failed before Node/Electron launched (`read-only variable: status`). No product path ran and this is not a runtime/product signal. The unchanged trace was then launched with a zsh-safe wrapper.
- **First real runtime result (live manual chat, fresh mode, real provider): H6 root cause is now pinned.** Raw hybrid inspection contained the exact Table 1 row `Control System NVIDIA Jetson Xavier (main), Jetson Nano (aux)` (chunk 48). But the actual typed `evidence_pack` sent to the model contained only two `okf_document_card` items: a teleoperation card mentioning ROS/ROS# and an AgenticVLA/AutoGen/LLaMA 3.2 7B card. It excluded the table row entirely while declaring `answer_policy="answer"` and `requested_property="processor_or_controller"`; the model consequently answered ROS + LLaMA 3.2 7B. This is **not** raw retrieval, embedding, cap, or model failure: it is the OKF-first resolver accepting cards whose generic controller vocabulary satisfies `textCanProveProperty()` even though they do not prove the requested *main control system* value.
- Code evidence corroborates the live trace: `EvidenceResolver.resolveFromOkf` accepts any selected card with generic `processor_or_controller` vocabulary (`EvidenceResolver.ts:374-414`) before the distinctive-term gate; the property evidence rule treats words such as `controller`, `control system`, and `controlled by` as sufficient (`requestedProperty.ts:157-176`). This allows ROS/AutoGen cards to pass without the `Control System` table row. It is structurally distinct from the prior #12/#13 fixes.
- The second live trace with `__e2e__:dump-okf-cards` confirmed the table-bearing OKF card **does exist** in the 61-card pack (`Technical Specifications`, literal `Control System NVIDIA Jetson Xavier...`) but `queryOkfCards` selects ROS/AutoGen cards instead. Thus extraction is not lossy here; the unsafe short-circuit is exactly selection + broad property validation.
- Implemented the smallest generic boundary in the live `EvidenceResolver`: when the question explicitly asks for a `main`/`primary control system`, a candidate must contain the literal `control system` field label in addition to the existing broad `processor_or_controller` evidence vocabulary. This retains normal "what controller" questions while preventing generic VR/agent controller language from falsely proving a field-value lookup. Applied equivalently to both OKF and hybrid item property stamping.
- Added a focused regression to `EvidenceResolver.test.mjs`: selected ROS/AutoGen controller decoys for a named main-control-system query must fall through to the hybrid `Control System NVIDIA Jetson Xavier` row. `npm run build:electron` completed and the focused resolver suite passed **13/13**, including the new regression.
- `npm run typecheck:electron` is currently red only in concurrently modified **premium** files, not the touched resolver path: 6 errors in `premium/electron/knowledge/{KnowledgeOrchestrator.ts,NegotiationCoachEngine.ts,negotiationCoachEvidence.ts}` (implicit anys/conflicting imports/missing exports/field). The resolver build/test result is green; this campaign will neither claim full typecheck clean nor edit the unrelated concurrent premium work.
- **Live-path proof passed after the minimal fix.** Fresh Electron/manual-chat trace answered exactly: `The main control system listed for the Mercury X1 is the NVIDIA Jetson Xavier.` The actual typed evidence pack now uses `mode_reference_chunk` hybrid evidence and contains the literal Table 1 `Control System NVIDIA Jetson Xavier (main), Jetson Nano (aux)` row; the unsafe ROS/AutoGen OKF cards are no longer selected. This proves the predicted stage change and closes the remaining THESIS-060 H6 instance without relaxing grounding.
- The permanent H6 pin is therefore: **broad controller category vocabulary caused an OKF-first false-positive; named field queries require their matching field label before an OKF card may short-circuit hybrid table retrieval.** This is distinct from prior cap, pooled-entity, and early-stop fixes. Targeted resolver tests: 13/13 pass. Full Electron typecheck remains blocked only by the documented unrelated premium errors.

**NEXT ACTION**: Re-check current shared branch/status and stage only campaign-owned `EvidenceResolver.ts`, `EvidenceResolver.test.mjs`, `golden-trace-thesis060-detail.mjs`, `campaign-log.md`, and the relevant forensic/final-report updates; commit narrowly. Then check active Codex quota. If >=20%, run the pre-existing full 140-case thesis benchmark on the committed build and compare against true baseline `dev-run-004-okf-and-093fix` (123/140); otherwise schedule a Codex quota pause. Do not call this fix fully benchmark-verified until that run finishes.
