# Campaign 2 — Phase 0 Forensic Report (2026-07-16, iteration 1)

## Method

Built `test/harness-longsession/golden-trace-driver.cjs`, a headless driver that:
- Loads the REAL compiled `dist-electron` modules (`LLMHelper`, `SessionTracker`,
  `IntelligenceEngine`) — same code the packaged app runs.
- Routes through the REAL `natively-api` backend already running locally on
  `localhost:3000` (confirmed healthy, `NATIVELY_FORCE_PRIMARY_GEN=minimax` in
  `server.js`), using the project's real `NATIVELY_API_KEY`. Every press in this
  report shows `serverModel: 'MiniMax-M3'` in the raw provider logs — R4 satisfied.
- Feeds a scripted ~25-minute two-channel interview transcript into
  `SessionTracker.addTranscript()` (the exact function STT output calls) via a
  monkeypatched `Date.now()` clock so simulated time advances without sleeping.
- At simulated minutes 2, 10, 18, 24, calls `IntelligenceEngine.runWhatShouldISay()`
  — the exact function `ipcHandlers.ts:7542` (`generate-what-to-say`, the real
  answer-button IPC handler) calls.
- Two temporary `[TRACE:LONGCTX]` tagged logs were added (gated behind
  `NATIVELY_TRACE_LONGCTX=1`, zero-cost otherwise) at the two points the campaign
  doc's Phase 0 preflight identified as the code path:
  1. `IntelligenceEngine.ts` right after `extractLatestQuestion()` — dumps transcript
     window size + extraction result.
  2. `WhatToAnswerLLM.ts` right after `PromptAssembler.assemble()` — dumps the
     COMPLETE final prompt composition, per-block trust levels/sizes, and whether
     the extracted question text survives into the assembled `userMessage`.
  3. (added after the first run surfaced a real failure) `IntelligenceEngine.ts` at
     the `isNonAnswerSentinel` discard branch — dumps the raw pre-discard answer.
- Two full runs were captured (`/tmp/golden-trace-run1.log`,
  `/tmp/golden-trace-run2.log`); the four per-press dumps in this directory are from
  run 1. Run 2 confirmed the run-1 findings are reproducible (not a one-off), with
  one press (minute 18) landing on a different failure mode across the two runs due
  to real model nondeterminism — both failure modes are documented below.

## Preflight (§2.0)

- MiniMax key confirmed: `.env` + `natively-api/.env` both have `MINIMAX_API_KEY(_1/_2)`.
  `natively-api/lib/minimaxProvider.js:19` → `MiniMax-M3`, 1M ctx. `server.js`
  supports `NATIVELY_FORCE_PRIMARY_GEN=minimax` to force it ahead of the cascade.
- Backend reachable locally: `curl localhost:3000/health` → `{"status":"ok",...}`.
  Already running (pid 9605, likely left over from the concurrent grounding
  campaign on `fix/grounding-campaign`) — used as-is, no restart needed.
- Live-path code chain confirmed by graph traversal + reading:
  `ipcHandlers.ts:7542 generate-what-to-say IPC` → `IntelligenceManager.runWhatShouldISay`
  (facade) → `IntelligenceEngine.runWhatShouldISay` → `extractLatestQuestion()`
  (electron/llm/transcriptQuestionExtractor.ts, deterministic, no LLM) →
  `WhatToAnswerLLM.generateStream()` → `PromptAssembler.assemble()` →
  `LLMHelper.streamChat()` → `natively-api /v1/chat` → MiniMax-M3.
- Truncation/windowing site inventory:
  - `SessionTracker.contextItems` hard-evicted every write to **120 seconds**
    (`evictOldEntries()`, `contextWindowDuration = 120`), REGARDLESS of the
    `lastSeconds` argument callers pass to `getContext()`. `IntelligenceEngine`
    calls `this.session.getContext(180)` believing it gets a 180s window — it
    silently gets at most 120s. This is a real bug (see H1/H2 refuted-but-adjacent
    note below) but was not the direct cause of the minute-18 failure in this
    campaign's scripted script (turns are dense enough that ~120s still covers 4-6
    turns at each probe).
  - `SessionTracker.getDurableContext()` reads `fullTranscript` (not hard-evicted
    until >1800 segments) — this is the correct long-range source, but it is only
    consulted when `isLiveSessionMemoryEnabled()` gates the live-session-memory
    follow-up-resolution branch (see H6 below).
  - `transcriptQuestionExtractor.extractLatestQuestion(turns, windowTurns=6)` — the
    `windowTurns` param only bounds the BACKGROUND context string
    (`relevantTranscriptWindow`), not the question search itself (that walks the
    full `cleaned` array backwards). Not implicated in the observed failures.
  - `prepareTranscriptForWhatToAnswer(turns, maxTurns=12)` (transcriptCleaner.ts)
    sparsifies to the last 6 interviewer + up to 6 other turns — this becomes
    `cleanedTranscript` → `workingTranscript` (after `fitContextForCurrentModel`,
    a no-op for cloud tier since `maxContextTokens >= 100_000`) → the `transcript`
    block in `PromptAssembler.assemble()`.
  - `PromptAssembler.enforceTokenBudget()` truncates lowest-trust-level blocks
    first when over budget (`TRUST_LEVEL_ORDER`: system→mode→developer→user→
    trusted_profile→assistant_history→screen→**transcript**→reference→meeting_history).
    **Never observed to fire in any of the 4 presses** — `assemblerBudget` (2276–2459)
    was never approached by the actual content (`totalTokensUsedByAssembler` 433–566
    of a `maxContextTokens: 128000` cloud budget). H1/H2 (question/system-prompt
    eviction under budget pressure) could not be exercised by this script because a
    ~25-minute, 12-turn-capped-per-press transcript never comes close to the
    2000+-token assembler budget on a cloud-tier (128k ctx) model. **This refutes
    H1/H2 for realistic session lengths on the current sparsify-to-12-turns design**
    — the sparsifier caps transcript growth BEFORE token budget ever becomes the
    bottleneck. A founder-reported failure at "20+ minutes" is therefore NOT
    explained by prompt-budget eviction; it must come from a different mechanism
    (H3/H6, confirmed below) or from very long RAW sessions where `fullTranscript`
    itself grows past the `compactTranscriptIfNeeded` 1800-segment epoch-summary
    threshold (not exercised by this ~50-segment script — flagged as untested,
    see "Not Yet Tested" below).

## Golden Trace: minute 2 vs minute 24 diff

Both extract clean, high-confidence questions (0.8 / 0.95). Both assemble prompts
where `answerPlanQuestionSurvivesInPrompt: true` — the extracted question text is
verbatim present in the final `userMessage` sent to the provider, at the END of the
transcript block (recency-favorable position — this already matches the
recommended F-H1/H2 fix direction "question last"). Both produce full, on-topic,
first-person answers. **No degradation observed between minute 2 and minute 24 on
these two presses** — refuting the founder's core "short sessions work, minute-24
doesn't" pattern IF the only failure mode were budget/eviction-driven. The actual
failures below are content-dependent (does the question reference something distant
enough to need real recall / can the model itself go quiet), not simple-linear
session-duration-driven.

## Hypothesis verdicts

**H1 (question lost in assembly): REFUTED for this design.** In all 4 presses (2 runs
× partial overlap), `answerPlanQuestionSurvivesInPrompt: true`. The question is
placed at the tail of the transcript block, which itself is one of the last blocks
before token-budget enforcement — and enforcement never fired because the sparsifier
already caps the transcript at ~12 turns. The question cannot currently be evicted on
a normal (non-multi-hour) session.

**H2 (system prompt eviction/dilution): REFUTED for this design**, same reasoning —
`systemPromptChars: 29961` was byte-identical across all 4 presses (the system
prompt is a `const`, built once per call, never subject to `enforceTokenBudget`
truncation in the observed runs since budget was never exceeded).

**H3 (extraction degradation on rolling transcript): CONFIRMED — real bug, live-proven.**
The minute-18 question — *"going back to the memory leak you mentioned earlier — how
long did it take your team to ship the fix after finding the root cause?"* (26 words)
— is a genuine, unambiguous follow-up referencing content from ~16 minutes earlier.
`transcriptQuestionExtractor.ts`'s `FOLLOW_UP_MARKERS` regex correctly matches
"mentioned" and "earlier" in this text, BUT the follow-up classification additionally
requires `latestQuestion.split(/\s+/).length <= 14` (transcriptQuestionExtractor.ts:289)
for the marker-based rule to fire (only the separate, narrower
`DEMONSTRATIVE_FOLLOW_UP` regex — "explain/elaborate/expand on that/this/it" — bypasses
the word-count cap). This question is 26 words, so **`isFollowUp` is classified
`false`** (confirmed in the live trace:
`"isFollowUp":false` for the minute-18 press in `golden-longctx-18.txt`). A real,
unambiguous follow-up is silently mis-typed as a fresh, standalone question purely
because it is verbose — a realistic pattern for spoken interviewer language ("going
back to X you mentioned, how long did Y take" is a completely normal way to phrase a
callback question, and is far more than 14 words).

**H4 (history/state bloat): N/A in this script.** `previousResponses: 0` at every
press (the driver never calls the assistant-history-populating path since each press
starts a fresh generation) — not exercised. Flagged for a follow-up script with
repeated presses feeding back into `session.addAssistantMessage`.

**H5 (latency-induced races): N/A observed.** All 4 presses completed in 1–8s
(simulated-clock-only "latency" logged by the driver is not real wall time; the
`totalStreamMs` from the real `NativelyAPI stream completed` logs ranged 1843–7616ms
across both runs) — well under any timeout in `WhatToAnswerLLM.ts`
(`HYBRID_RETRIEVAL_BUDGET_MS=1500`, `GROUNDING_BUDGET_MS=2000` — neither retrieval nor
grounding ran since no mode/resume was active in this driver). Not implicated.

**H6 (recall/RAG misfire at scale): CONFIRMED — real bug, live-proven, root cause
of the minute-18 failure.** Two independent live runs against the real MiniMax-M3
backend both failed the minute-18 press, in two different observable ways:
  - **Run 1**: the model's raw answer was matched by `IntelligenceEngine
    .isNonAnswerSentinel()` (`"nothing actionable right now"` / `"nothing to capture
    right now"`, exact-match after trim/lowercase/punctuation-strip) — this
    collapses the ENTIRE response to `null` with **zero fallback message**, so the
    real interviewer question got no UI output at all. This is a real, live-proven
    instance of the campaign's named "greeting-failure-adjacent" defect class: not a
    literal "Hi, how can I help?" but the same failure SHAPE — a real question, a
    well-formed prompt, and a completely empty user-facing result.
  - **Run 2**: the model instead answered honestly that it could not find the
    referenced story: *"Interviewer is probing for concrete details about the
    earlier memory leak story that has not been established in the transcript, and
    the candidate may not have the specifics loaded... Confirm which memory leak
    incident the interviewer is referring to, since the transcript does not contain
    that story."* This is the ROOT CAUSE made visible: **the memory-leak content
    from minute ~2-3 genuinely never reached the minute-18 prompt.**

  Root cause of the recall gap: the long-range memory subsystem
  (`resolveLiveSessionMemoryConfig` → `isLiveSessionMemoryEnabled` → default **ON**
  in production per `liveSessionMemoryConfig.ts` "PI v3, W6d" — confirmed this
  driver run used defaults, i.e. production behavior, since `NODE_ENV`,
  `BENCHMARK_MODEL`, `NATIVELY_INTERNAL` were all unset) DOES run on every
  `!question` press via `resolveLiveFollowup()` /
  `SessionTracker.getDurableContext()`. But that subsystem's memory model
  (`electron/llm/sessionFollowupResolver.ts`) only recalls ENTITIES it explicitly
  noted via `mem.note(kind, value, ...)` — proper nouns (skills, projects,
  companies, decision-owners). A free-text incident description like "a memory leak
  in a long-running consumer process" is never captured as a notable entity (no
  CamelCase token, no cued proper noun, no skill/company match), so when the
  minute-18 question references it by paraphrase ("the memory leak you mentioned
  earlier") there is nothing in the entity memory to recall, and the DURABLE
  transcript window (`getDurableContext`) is consulted by `resolveLiveFollowup`
  only for entity matching, not as a raw fallback context block appended to the
  prompt. Compounding H3: even if a longer durable window were injected, H3 means
  this specific question wasn't even flagged `isFollowUp`, so parts of the
  follow-up-resolution branch that depend on that flag (none currently gate
  `resolveLiveFollowup` itself — it runs on ALL `!question` presses regardless of
  `isFollowUp` — but downstream repair/prompt-injection logic keyed off `isFollowUp`
  in other branches may still be affected; not fully traced in this pass).

**H7 (memory/buffer defects): partially confirmed, not the minute-18 cause.**
Confirmed at the code level (not exercised live in this driver): `SessionTracker
.getContext(lastSeconds)` — `IntelligenceEngine` calls `getContext(180)` believing
it gets a 180-second window, but `contextItems` is unconditionally evicted to the
last **120 seconds** by `evictOldEntries()` on every write regardless of the caller's
requested window (`SessionTracker.ts:426-429` vs `:698-706`). This is a real
discrepancy between the documented/intended 180s WTA answer window and the actual
~120s hard cap — worth fixing even though it wasn't the direct cause of the observed
minute-18 failure (the sparsifier's 12-turn cap dominates before the 120s/180s gap
matters at this script's turn density).

**H8 (tokenization drift): REFUTED in this design for cloud tier.**
`fitContextForCurrentModel` short-circuits to a no-op for any model with
`maxContextTokens >= 100_000` (`LLMHelper.ts:1141`) — MiniMax/natively cloud tier
never exercises the char/4 token-estimate truncation path at all. Not implicated.

**H9 (provider-side degradation): CANNOT BE PINNED** — H3/H6 are confirmed root
causes with a well-formed-but-recall-incomplete prompt; the model's minute-18
behavior in run 2 (admitting it lacks the story) is in fact CORRECT behavior given
what it was actually sent — this is not a model quality problem, it's a missing-
evidence problem. Run 1's "nothing actionable" sentinel match is arguably ALSO
correct model behavior for a question the model has no evidence to answer well —
the bug is that the app's `isNonAnswerSentinel` guard turns that honest non-answer
into a completely silent `null` instead of a visible, honest "I don't have that in
what's loaded" message (which several OTHER paths in the same file already do, e.g.
line ~1820's `liveDeadlineFired` fallback, or the assistant-voice-misfire guard).

**H10 (session lifecycle reset): N/A observed** — no reconnect/reinit occurred in
this ~25-minute simulated single-process run.

## Truncation-site inventory (§2.0, consolidated)

| Site | File:approx line | Behavior | Implicated? |
|---|---|---|---|
| `SessionTracker.contextItems` eviction | SessionTracker.ts:698-706 | Hard-caps to 120s regardless of caller's requested window | H7 (real bug, not yet root-cause of observed failure) |
| `SessionTracker.getDurableContext` | SessionTracker.ts:456-468 | Survives 120s eviction; caps at >1800-segment epoch compaction | Correct long-range source but under-consulted (H6) |
| `sparsifyTranscript` (maxTurns=12) | transcriptCleaner.ts:131-158 | Keeps last 6 interviewer + 6 other turns | Caps transcript growth BEFORE budget ever matters — refutes H1/H2 for this session length |
| `PromptAssembler.enforceTokenBudget` | PromptAssembler.ts:487-536 | Truncates lowest-trust blocks first when over budget | Never fired in any observed press (budget headroom huge on cloud tier) |
| `fitContextForCurrentModel` | LLMHelper.ts:1137-1151 | No-op for maxContextTokens≥100k (cloud tier) | Not implicated (H8 refuted) |
| `sessionFollowupResolver` entity memory | sessionFollowupResolver.ts | Only recalls explicitly-noted proper-noun entities, not free-text topics | ROOT CAUSE of H6 |
| `extractLatestQuestion` FOLLOW_UP_MARKERS word cap | transcriptQuestionExtractor.ts:289 | `<=14` words required for marker-based follow-up detection | ROOT CAUSE of H3 |
| `isNonAnswerSentinel` discard | IntelligenceEngine.ts:2199-2227 | Exact-match "nothing actionable/to capture right now" → silent `null`, no fallback | Amplifies H6 into a full greeting-failure-shaped UX defect |

## Prompt composition table (tokens per section, all 4 presses)

| Press | systemPromptChars | userMessageChars | transcriptChars | assemblerBudget | totalTokensUsed | answerPlanQuestionSurvives |
|---|---|---|---|---|---|---|
| minute 2 | 29961 | 1968 | 506 | 2351 | 492 | true |
| minute 10 | 29961 | 2009 | 491 | 2365 | 502 | true |
| minute 18 | 29961 | 1731 | 569 | 2276 | 433 | true |
| minute 24 | 29961 | 2261 | 369 | 2459 | 566 | true |

System prompt is byte-identical across all presses (29961 chars, ~7491 tokens) —
confirms it is never truncated. `maxContextTokens: 128000` for the `natively`
(cloud/MiniMax) model — total usage (433-566 tokens) is ~0.4% of budget. There is
enormous unused headroom; the sparsifier is the binding constraint, not the token
budget.

## Pinned root causes (ranked by impact)

1. **[PINNED, HIGH] H3 — follow-up misclassification on long/verbose callback
   questions.** `FOLLOW_UP_MARKERS`-based detection requires ≤14 words; realistic
   spoken callback questions ("going back to X you mentioned earlier, how long did
   Y take") routinely exceed that. Silent mis-typing as a standalone question loses
   the follow-up-resolution machinery's intent signal.
2. **[PINNED, HIGH] H6 — long-range recall only covers proper-noun entities, not
   free-text topics/incidents.** A behavioral-answer topic mentioned once early in
   a session (a bug, an incident, a decision rationale — anything that isn't a
   product/company/skill name) is invisible to `sessionFollowupResolver`'s memory
   model. When a later question references it, the model either (a) is caught by
   the non-answer sentinel and produces a silent `null` (greeting-failure-shaped),
   or (b) honestly reports it lacks the context — both are user-visible failures on
   a real, answerable-in-principle follow-up.
3. **[PINNED, MEDIUM] Amplifier — `isNonAnswerSentinel` has no fallback message.**
   Independent of root cause, ANY time the model emits "nothing actionable right
   now" on a real (non-speculative) press, the user sees literally nothing — not
   even the honest "I don't have that in what's loaded" the codebase already uses
   elsewhere. This is the cheapest, highest-leverage fix (F-H1 in loop2.md already
   specifies exactly this pattern: "assembly-time assertion... ABORT the call and
   emit a visible retry state instead of letting the model greet" — the same
   principle applies post-hoc to this discard branch).
4. **[LOGGED, LOW-for-now] H7 — `getContext(180)` is actually capped at 120s.**
   Real discrepancy between intended and actual window size. Not yet proven to
   cause a user-visible failure at this script's turn density, but worth fixing for
   correctness and because it will bite harder in a genuinely dense/rapid-fire
   transcript (many turns within a tighter time window).

## Not yet tested (deferred to next iteration / Phase 2 harness)

- Sessions with real doc-grounded retrieval / an active custom mode (this driver ran
  with NO active mode — `modeContextBlockChars: 0` in every press). The
  `enforceTokenBudget` truncation path (H1/H2) may still fire in a real session with
  a mode's reference files pulling in a large `modeContextBlock`.
- Sessions dense enough to approach the `compactTranscriptIfNeeded` 1800-segment
  epoch-summary threshold (H10-adjacent — behavior when `fullTranscript` itself gets
  compacted mid-session).
- Sessions with `previousResponses` populated (repeated real presses feeding back
  into assistant history) — H4 not exercised.
- Desync / latest-question-wins under concurrent/rapid presses (H5, G6) — this
  driver presses serially and awaits each fully before advancing.
- The `getContext(180)` vs 120s-actual-cap discrepancy (H7) under a transcript with
  turns spaced closer than the 120s/180s gap (e.g. rapid back-and-forth).

## NEXT ACTION

Proceed to Phase 1 (loop2.md §3) — fix the two pinned HIGH causes plus the amplifier,
highest impact first: **(a)** raise or contextualize the `FOLLOW_UP_MARKERS` word cap
so `<=14` doesn't silently disqualify realistic long callback questions (H3),
**(b)** give the non-answer sentinel discard a visible fallback message instead of a
silent null (the amplifier — cheapest fix, directly matches the F-H1 pattern the
campaign doc already prescribes), then **(c)** investigate widening
`sessionFollowupResolver`'s memory model to cover free-text topic recall, not just
proper-noun entities (H6 — likely the largest single fix, may need its own
sub-investigation before committing to an approach). After each fix: live-path proof
re-running the exact minute-18 press, skeptic pass, short-session smoke, commit.
