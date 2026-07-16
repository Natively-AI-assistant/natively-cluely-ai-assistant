# Long-Session Campaign 2 Log

Branch: `fix/longsession-campaign` (created off the dirty tree of `fix/grounding-campaign`
per explicit founder decision at campaign start — carries over Campaign 1's
in-progress uncommitted work; see ITERATION 1 notes). Loop doc: `loop2.md`
(kept separate from Campaign 1's `loop.md`/`campaign-log.md`, which remain
untouched and may still be active in a separate session).

## ANTI-THRASH LEDGER
(pinned root causes + fixes; never re-fix the same pattern — if a symptom returns, the pin was wrong, go back to forensics)

| # | Hypothesis | Verdict | Evidence | Fix commit | Status |
|---|---|---|---|---|---|
| 1 | H3 — follow-up misclassification: `FOLLOW_UP_MARKERS` requires ≤14 words, so realistic long callback questions ("going back to X you mentioned earlier...") are silently NOT flagged `isFollowUp` | CONFIRMED (live trace, 2 runs) | traces2/golden-longctx-18.txt: `"isFollowUp":false` for a 26-word unambiguous follow-up | pending | pinned, not yet fixed |
| 2 | H6 — long-range recall only covers proper-noun entities (sessionFollowupResolver memory model), not free-text topics/incidents | CONFIRMED (live trace, 2 runs, real MiniMax-M3) | run2: model itself says "the transcript does not contain that story"; run1: same root cause manifests as a silent null via the sentinel guard | pending | pinned, not yet fixed |
| 3 | Amplifier — `isNonAnswerSentinel` discard (IntelligenceEngine.ts:2199) has NO fallback message; any model "nothing actionable" on a REAL press = completely silent null, greeting-failure-shaped UX | CONFIRMED (live trace, run 1) | traces2/golden-longctx-18.txt run1: `chars:29` provider response, `answer preview: (null)` | pending | pinned, not yet fixed |
| 4 | H7 — `SessionTracker.getContext(180)` is actually hard-capped at 120s regardless of caller's requested window (`contextWindowDuration=120` in `evictOldEntries`) | CONFIRMED (code read), not yet proven as direct cause of a live failure at this script's turn density | SessionTracker.ts:426-429 vs :698-706 | logged only, not yet a fix priority | logged |
| 5 | H1 (question lost in prompt assembly under token-budget eviction) | REFUTED for realistic session lengths — sparsifyTranscript caps transcript at 12 turns BEFORE the 2000+-token assembler budget is ever approached (totalTokensUsed 433-566 of budget ~2300-2450, on a 128k-ctx cloud model) | traces2/golden-longctx-*.txt, all 4 presses: `answerPlanQuestionSurvivesInPrompt: true` | N/A | refuted |
| 6 | H2 (system prompt eviction/dilution) | REFUTED same reasoning as H1 — systemPromptChars byte-identical (29961) across all 4 presses | traces2/golden-longctx-*.txt | N/A | refuted |
| 7 | H8 (tokenization/counting drift) | REFUTED for cloud tier — `fitContextForCurrentModel` is a no-op when maxContextTokens>=100k | LLMHelper.ts:1141 | N/A | refuted |

## SCORE HISTORY
(benchmark run # / timestamp / greeting-failures / hallucination flags / question-extraction acc / answer quality / long-range recall)

| Run | Timestamp | Greeting failures | Halluc. flags | Extraction acc | Answer quality | Long-range recall | Notes |
|---|---|---|---|---|---|---|---|
| - | (Phase 2 harness not yet built — no benchmark run yet, only Phase 0 golden-trace presses) | | | | | | |

## QUOTA CHECK METHOD
Confirmed working (same as Campaign 1's documented method): the reference script in loop2.md §1.5 works as-is.
`curl -s http://localhost:20128/api/providers` → filter `provider=="claude"` → `curl -s http://localhost:20128/api/usage/{id}` → `.quotas."session (5h)".remainingPercentage`.

QUOTA (iteration 1, 2026-07-16 ~23:1x local): Account1 (0bc80676…) 65% session / 73% weekly. Account2 (ead3018a…) 4% session / 80% weekly — low but 9Router fails over automatically; Account1 well above the 25%-pre-expensive-op and 10%-pause thresholds, so continuing normally per §1.5 ("pause ONLY when one account is fully out AND the other is <=10%").

## ITERATION 1 (2026-07-16) — Phase 0 preflight + Golden Trace + Forensic Report

**Setup**: Read Campaign 1's `campaign-log.md` (read-only, per R2 cross-campaign
anti-thrash) — its own forensics were mid-flight (waiting on subagents), no fixes
landed there yet, no overlap risk. Created branch `fix/longsession-campaign` off the
dirty `fix/grounding-campaign` tree per founder's explicit decision (carries over
in-progress work). Confirmed `natively-api` backend already running locally on
`:3000` (pid 9605) with `NATIVELY_FORCE_PRIMARY_GEN=minimax` support in
`server.js` — real MiniMax-M3 path available (R4 satisfiable).

**Phase 0 preflight**: Used the code-review-graph MCP tools (per CLAUDE.md) plus
direct reads to trace the live answer-button path:
`ipcHandlers.ts:7542 generate-what-to-say` → `IntelligenceManager.runWhatShouldISay`
→ `IntelligenceEngine.runWhatShouldISay` → `extractLatestQuestion()`
(`electron/llm/transcriptQuestionExtractor.ts`) → `WhatToAnswerLLM.generateStream()`
→ `PromptAssembler.assemble()` → `LLMHelper.streamChat()` → `natively-api /v1/chat`.
Inventoried every truncation/eviction site (SessionTracker 120s hard-cap,
sparsifyTranscript 12-turn cap, PromptAssembler.enforceTokenBudget,
fitContextForCurrentModel) — full table in `traces2/forensic-report.md`.

Found substantial EXISTING long-session eval infrastructure at
`benchmarks/profile-intelligence/{generate_long_session.cjs, run_long_session_eval.ts,
long_session_scenarios.json, long_session_report.md}` — 100 scenarios, 100% pass as
of the 2026-06-07c release, BUT that harness tests `SessionMemory`/`planAnswer`
resolution logic DETERMINISTICALLY (no real LLM call) — it does NOT drive the real
answer-button → prompt-assembly → MiniMax-M3 path this campaign's founder-reported
bug lives in. Decided NOT to reuse it directly for the Golden Trace (wrong layer),
but it (and `test/harness-longsession/` I created) may be reusable scaffolding for
Phase 2's 30-minute harness — revisit then.

**Added temporary `[TRACE:LONGCTX]` instrumentation** (gated behind
`NATIVELY_TRACE_LONGCTX=1`, zero-cost otherwise, R10-compliant):
1. `electron/IntelligenceEngine.ts` after `extractLatestQuestion()` call (~line 930).
2. `electron/llm/WhatToAnswerLLM.ts` after `PromptAssembler.assemble()` (~line 596) —
   dumps full prompt composition + whether the question survives.
3. `electron/IntelligenceEngine.ts` at the `isNonAnswerSentinel` discard branch
   (~line 2199) — added AFTER the first driver run surfaced a live failure there,
   to capture the raw pre-discard model answer.

Ran `npm run build:electron` after each instrumentation change (clean, no errors).

**Built `test/harness-longsession/golden-trace-driver.cjs`** — reuses the proven
electron-stub / node:sqlite-shim bootstrap pattern from
`benchmarks/profile-intelligence/harness.cjs` (touches least code per resolution
rules), drives the REAL compiled `LLMHelper`/`SessionTracker`/`IntelligenceEngine`
against the REAL local `natively-api` backend with the project's real
`NATIVELY_API_KEY`, model=`natively` (routes through MiniMax-M3 per backend config).
Scripted a ~25-minute two-channel interview transcript (software-engineer interview,
no résumé/JD attached — Phase 0 only needs real transcript/prompt-assembly behavior,
doc-grounded retrieval correctness is a separate concern) with 4 probe presses at
simulated minutes 2, 10, 18, 24. Clock is fast-forwarded via a `Date.now()`
monkeypatch (no real sleeping).

**Ran the Golden Trace TWICE against the real backend** (both runs' full logs
preserved at `/tmp/golden-trace-run1.log` / `run2.log`; per-press dumps in
`traces2/golden-longctx-{2,10,18,24}.txt` are from run 1, overwritten then
re-verified consistent by run 2 for minutes 2/10/24).

**RESULT — 2 pinned root causes + 1 amplifier, all live-proven on the real MiniMax-M3
backend, full detail + evidence in `traces2/forensic-report.md`:**
1. **H3 CONFIRMED**: `FOLLOW_UP_MARKERS` regex path requires the question be ≤14
   words to be classified `isFollowUp` — a realistic 26-word spoken callback
   question ("going back to the memory leak you mentioned earlier — how long did it
   take...") is silently mis-typed as a fresh standalone question.
2. **H6 CONFIRMED**: `sessionFollowupResolver`'s long-range memory model only tracks
   explicitly-noted proper-noun ENTITIES (skills/projects/companies), never free-text
   topics/incidents. A behavioral-answer topic (a bug/incident described in prose)
   mentioned once early in a session is invisible to recall. Confirmed on the REAL
   backend two ways: run 2's raw model answer literally says "the transcript does
   not contain that story"; run 1's same underlying gap manifests as a silent null
   via finding #3.
3. **Amplifier CONFIRMED**: `isNonAnswerSentinel()` discard (IntelligenceEngine.ts)
   has no fallback message — when the model itself emits "nothing actionable right
   now" on a REAL (non-speculative) press, the entire response collapses to `null`
   with zero UI output. This is the live-proven, real-backend instance of the
   "greeting-failure-shaped" defect class the campaign names, though the specific
   text is not literally "Hi, how can I help?" — the SHAPE (real question, no
   answer shown) matches.
4. **H1/H2 REFUTED for realistic session lengths** on the current design — the
   12-turn sparsifier caps transcript growth well before the ~2300-2450 token
   assembler budget is ever approached on the 128k-ctx cloud tier
   (totalTokensUsed 433-566 in every press). A founder-reported "20+ minute"
   degradation is therefore NOT simple prompt-budget eviction on this architecture
   — it's the recall/classification gap above.
5. Logged (not yet prioritized): H7 — `getContext(180)` is actually hard-capped at
   120s by `evictOldEntries`'s fixed `contextWindowDuration`, ignoring the caller's
   requested window. Real discrepancy, not yet proven as the direct cause of an
   observed failure at this script's turn density.

**Quota check** (§1.5, end-of-Phase-0 mandatory checkpoint): Account1 65% session /
73% weekly, Account2 4% session / 80% weekly. Continuing normally (Account1 well
above both the 25% pre-expensive-op and 10% pause thresholds).

**Committed**: this iteration's work as a checkpoint (R7) — instrumentation +
driver + forensic report, no product-behavior fix yet (Phase 0 is diagnosis-only
per R1).

**NEXT ACTION**: Begin Phase 1 (loop2.md §3) on the pinned causes, highest-impact
first. Start with the AMPLIFIER (#3 above — cheapest fix, directly matches the
F-H1 pattern loop2.md already prescribes: give the non-answer-sentinel discard path
a visible, honest fallback message instead of a silent null, mirroring the existing
`liveDeadlineFired` fallback pattern already in the same file at ~line 1820). Then
H3 (#1 — relax or contextualize the ≤14-word cap on FOLLOW_UP_MARKERS detection so
realistic long callback questions are still flagged as follow-ups). Then investigate
H6 (#2 — likely the largest single fix; may need its own sub-investigation into how
to extend `sessionFollowupResolver`'s memory model to cover free-text topics, not
just proper-noun entities, without over-triggering false-positive recalls). For each
fix: state the pin + trace quote, make the minimal live-path change, show the
`[FIX:*]` log firing by re-running the exact failing press (minute 18) against the
real backend, run a skeptic pass, verify a short-session smoke suite stays green
(none exists yet for this campaign — build a minimal one alongside the first fix),
then commit with the fix + a note in this ledger. Do NOT build the full Phase 2
30-minute 3-script harness yet — that's after the Phase 1 pinned-cause fixes land,
per loop2.md's phase ordering.
