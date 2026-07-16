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
| 1 | H3 — follow-up misclassification: `FOLLOW_UP_MARKERS` requires ≤14 words, so realistic long callback questions ("going back to X you mentioned earlier...") are silently NOT flagged `isFollowUp` | CONFIRMED (live trace, 2 runs) | traces2/golden-longctx-18.txt: `"isFollowUp":false` for a 26-word unambiguous follow-up | `4b41e1d` | **FIXED** — split WEAK/STRONG marker tiers; first-draft STRONG tier was itself over-broad (skeptic pass caught 7 false-positive cases: bare "earlier", open-object "going back to", "the previous <career noun>"), narrowed to require explicit recall-phrase/conversation-shaped object. 49 unit tests + 189 consumer tests green. Live-reverified on real backend post-narrowing. |
| 2 | H6 — long-range recall only covers proper-noun entities (sessionFollowupResolver memory model), not free-text topics/incidents | CONFIRMED (live trace, 2 runs, real MiniMax-M3) | run2: model itself says "the transcript does not contain that story"; run1: same root cause manifests as a silent null via the sentinel guard | `9c3b79b` | **FIXED** — new bounded lexical-recall fallback (`electron/llm/longRangeTranscriptRecall.ts`) fires only when isFollowUp && entity-recall empty. Skeptic pass found 2 real problems in the first draft (HIGH: no mode-boundary awareness, could leak comp figures into non-negotiation answers; MEDIUM: single-keyword scoring risked wrong-turn misattribution) — both fixed (comp value-gate mirroring SessionMemory's own gate; MIN_MATCH_SCORE raised 1→2). 13 unit tests, 263 consumer tests green, live-reverified twice on real backend post-narrowing. |
| 3 | Amplifier — `isNonAnswerSentinel` discard (IntelligenceEngine.ts:2199) has NO fallback message; any model "nothing actionable" on a REAL press = completely silent null, greeting-failure-shaped UX | CONFIRMED (live trace, run 1) | traces2/golden-longctx-18.txt run1: `chars:29` provider response, `answer preview: (null)` | `77deb1e` | **FIXED** — manual (non-speculative) presses now get an honest, non-misleading fallback message instead of silent null; speculative path unchanged. Skeptic-approved (1 required test update applied). Live-reverified on real backend (fix fired: `[FIX:longsession-nonanswer-fallback]`). |
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

QUOTA (iteration 1 continued, 2026-07-17 ~00:4x local, after fix#1 + fix#2): Account1 49% session / 70% weekly. Account2 0% session / 80% weekly (fully out, but 9Router routes to Account1). Continuing per §1.5.

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

## ITERATION 1 continued — Fix #1 (amplifier) + Fix #2 (H3) landed, both skeptic-verified

**Fix #1 (amplifier, commit `77deb1e`)**: Manual (non-speculative) presses hitting
`isNonAnswerSentinel` now get an honest fallback message ("I don't have enough from
the conversation to answer that specific point yet.") instead of a silent null.
Speculative path untouched (verified byte-identical via diff + tests). Skeptic pass
(code-reviewer subagent) approved with one required follow-up: updated 3 stale tests
in `IntelligenceEngineSentinel.test.mjs` that asserted the old silent-null contract.
Live-proof: re-ran the exact minute-18 press twice against the real
natively-api/MiniMax-M3 backend; `[FIX:longsession-nonanswer-fallback]` fired and the
user-visible answer changed from `(null)` to the honest fallback string. R8 smoke
suite built (`test/harness-longsession/short-session-smoke.cjs`, 11 checks) — green.

**Fix #2 (H3, commit `4b41e1d`)**: Split `FOLLOW_UP_MARKERS` into `WEAK_FOLLOW_UP_MARKERS`
(still word-capped at 14) and `STRONG_FOLLOW_UP_MARKERS` (unambiguous regardless of
length). CRITICAL: the skeptic pass on the FIRST draft caught a serious regression —
the initial `STRONG_FOLLOW_UP_MARKERS` regex matched bare "earlier" and an open-object
"going back to" ANYWHERE in a sentence, misclassifying common non-callback interview
phrasing ("I graduated earlier than my cohort", "going back to the office three days
a week", "the previous role I held") as follow-ups. This corrupted downstream
grounding lookups (a bogus `followUpTarget` can overwrite an otherwise-correct
identity/technical query) and let small talk escape the `SOCIAL_PLEASANTRY` confidence
down-weight — a NEW and arguably worse failure class than the one being fixed.
Narrowed every STRONG alternative to require the actual recall-verb phrase or an
explicit conversation-shaped object, not a bare co-occurring word. Verified all 7 of
the skeptic's false-positive cases now correctly classify `false`, the original bug
case and a genuine callback correctly classify `true`, added as 9 new permanent
regression tests (49 total in the file, 0 failures). Ran the full consumer-test
surface the skeptic identified (189 tests across 8 files) — all green. Live-reverified
on the real backend post-narrowing: minute 18 correctly resolves
`isFollowUp:true`/`questionType:follow_up`; minutes 2/10/24 unaffected. R8 smoke green.

**Anti-thrash note**: this is exactly the scenario R2 warns about — a first-draft fix
for a pinned cause can introduce its own new bug. The skeptic-pass step caught it
BEFORE commit, which is why that step is mandatory per loop2.md §3, not optional.

**Quota check** (post-fix#1, post-fix#2): Account1 49% session / 70% weekly (still
well above 25% threshold). Account2 fully out (0% session) but 9Router routes around
it automatically — continuing per §1.5.

## ITERATION 1 continued — Fix #3 (H6) landed, skeptic-verified after 1 narrowing round

**Fix #3 (H6, commit `9c3b79b`)**: New `electron/llm/longRangeTranscriptRecall.ts` —
a bounded, deterministic, no-LLM keyword-overlap search over
`SessionTracker.getDurableContext()` that fires as a FALLBACK only when the
extractor already flagged `isFollowUp` (fix#2) but entity-based recall
(`resolveLiveFollowup`) found nothing — the exact gap H6 identified (a free-text
incident like "a memory leak in a long-running consumer process" is never captured
by `transcriptEntityExtractor.ts`, which only extracts proper nouns/CamelCase/a
fixed CS-topic list). Wired into `IntelligenceEngine.ts`: prepends a small
`<earlier_context>` block (real transcript text, verbatim, capped at 500 chars) to
`preparedTranscript` when a match is found.

**Skeptic pass found 2 real problems in the first draft, both fixed before commit**:
1. **HIGH severity — mode-boundary bypass.** `SessionMemory.recall()` enforces
   documented, tested mode-aware boundaries (comp gated to `negotiation` mode only).
   The new lexical fallback had ZERO such awareness — it operated on raw transcript
   text. Skeptic reproduced concretely: a coding-mode follow-up sharing keywords
   with an earlier salary-figure turn would inject that comp figure into an
   unrelated technical answer, bypassing the codebase's own "no salary leakage
   outside comp Qs" hardening principle. FIXED: threaded the effective mode (via
   the same `planAnswer`/`answerType` derivation already computed above for the
   entity-recall path) into `recallLongRangeContext`, added a value-level comp
   guard (`COMP_VALUE_RE`, mirrors `SessionMemory.add()`'s own `SALARY_VALUE_RE`)
   that excludes any comp-looking candidate turn unless the effective mode is
   `negotiation`.
2. **MEDIUM severity — wrong-turn misattribution.** `MIN_MATCH_SCORE = 1` (a
   single shared 5+-char word) was too weak in a topic-diverse transcript —
   skeptic constructed two unrelated turns each sharing one incidental word with a
   follow-up question; the fallback confidently picked one as "the most relevant
   earlier turn" when neither was what the interviewer meant. Zero-fabrication
   (R5) held, zero-misattribution did not. FIXED: raised `MIN_MATCH_SCORE` to 2.
3. LOW — stopword list had golden-trace-sentence-specific entries ("cause",
   "after", "finding"); removed, replaced with generic short filler words after
   lowering `MIN_KEYWORD_LEN` to 4 (the real discriminator was "leak", 4 letters,
   previously excluded by the 5-char minimum).

After the round-1 fixes: strengthened 2 existing tests whose fixtures only had
1-keyword overlap, added 4 new permanent regression tests for the skeptic findings
— 13 total, all pass. Full consumer-test surface: 263 tests across 12 files, 0
failures. Live-reverified TWICE on the real natively-api/MiniMax-M3 backend after
narrowing: minute-18's `[TRACE:LONGCTX] long_range_recall_fired` marker fires
consistently (`matchCount:1, bestAgeSeconds:933`, identical across both post-fix
runs), does NOT fire for minutes 2/10/24 (fresh/unrelated questions). R8 smoke:
11/11 green before and after narrowing.

**Anti-thrash note (2nd instance this iteration)**: the mandatory skeptic-pass step
caught a real, would-have-shipped regression on a first-draft fix for the SECOND
time this iteration (fix#2's H3 false-positives, now fix#3's H6 mode-boundary
bypass). Both times the fix's own narrow unit tests passed cleanly; only an
adversarial, independently-reasoning pass surfaced the problem. Treat the
skeptic-pass step as load-bearing for every remaining fix in this campaign.

**Quota check** (post-fix#3): Account1 ~38% session (still above the 25%
threshold). Account2 fully out but 9Router routes around it. Continuing per §1.5.

**STATUS: all 3 pinned Phase 0 root causes are now fixed, skeptic-verified, and
live-proven on the real backend.**

**NEXT ACTION**: Decide between two paths, favoring (a) unless quota/context runs
thin:
(a) **Continue Phase 1 discipline on the logged-but-lower-priority H7 finding**
    (`SessionTracker.getContext(180)` is actually hard-capped at 120s by
    `evictOldEntries`'s fixed `contextWindowDuration`, ignoring the caller's
    requested window — logged in forensic-report.md, not yet proven as the direct
    cause of an observed failure at this script's turn density, but a real
    discrepancy worth closing before Phase 2 in case a denser/longer real session
    exposes it). If pursued: read `SessionTracker.ts`'s `getContext`/
    `getContextWithInterim`/`evictOldEntries`, decide whether
    `contextWindowDuration` should become a per-call parameter (so
    `getContext(180)` truly returns 180s) or whether the 180s call sites should be
    corrected to 120s to match actual behavior (check which is the
    ACTUALLY-INTENDED contract), same fix discipline (pin+trace+live-proof+
    skeptic+smoke+commit).
(b) **Proceed to Phase 2** (loop2.md §4): spawn the test-engineer agent to build
    the full 30-minute, 3-script (Script A: SWE interview w/ resume+JD, Script B:
    technical deep-dive w/ reference PDF, Script C: adversarial/messy) benchmark
    harness at `test/harness-longsession/` with the G1-G8 grading rubric (question
    extraction >=98%, greeting failures=0, answer quality >=95%, hallucination=0,
    long-range recall >=90%, desync=0, injection-resistant, latency curve). This
    is the mandatory precursor to Phase 3's exit-condition loop (L4: two
    consecutive green full-benchmark runs). NOTE:
    `test/harness-longsession/golden-trace-driver.cjs` and
    `short-session-smoke.cjs` already built this iteration are reusable
    scaffolding (electron-stub/sqlite-shim bootstrap, real-backend wiring,
    clock-fast-forward pattern) — the Phase 2 harness should reuse that bootstrap
    rather than rebuilding it, per "touch least code."
Either way: quota check before starting (§1.5, pre-check at 25% before an
expensive full-benchmark run), and update this log's ANTI-THRASH LEDGER + SCORE
HISTORY tables before ending the iteration.
