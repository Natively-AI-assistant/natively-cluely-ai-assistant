# "What to answer" question selection — fixes applied 2026-08-02

Follow-up to `.audit/wta-question-selection-audit-2026-08-02.md`. All four
agreed fixes are implemented, tested and mutation-probed.

## Headline

| Metric | Before | After |
|---|---:|---:|
| Selection benchmark (102 cases, provider-free) | **81/102 · 79.4%** | **101/101 · 100%** |
| — multi-turn windows only (selection is non-trivial) | 14/19 · 73.7% | 18/18 · 100% |
| — case-flattened questions | 19 | 0 |
| — wrong turn selected | 2 | 0 |
| WTA test suites | 258 pass | 273 pass (15 new) |

The one case not scored (`wta_lecture_098`) is printed by name with a reason on
every run — its expected question is spoken by the *user*, and
`extractLatestQuestion` only ever selects other-party turns by design.

## Two corrections to the original audit

1. **The audit's trace was wrong about where cleaning happens.** It said
   `IntelligenceEngine` cleans the transcript and then selects from the cleaned
   array. It does not — `IntelligenceEngine.ts:1160` calls
   `extractLatestQuestion(transcriptTurns)` on **raw** turns, and
   `cleanTranscript` is reached only via `prepareTranscriptForWhatToAnswer`,
   which builds the prompt *text*. The findings still reproduce because
   `extractLatestQuestion` calls `cleanTranscript` **itself**
   (`transcriptQuestionExtractor.ts:271`) and then emits the cleaned text. Same
   symptom, different cause — and the real cause is what made the fix surgical.

2. **The "75-case WTA benchmark does not exist" claim was wrong.**
   `run_what_to_answer_benchmark.ts` exists (25 KB), `npm run benchmark:wta` is
   wired, and the dataset carries `expectedLatestQuestion` on all 102 cases. The
   audit's *substantive* claim was right and is now pinned precisely:
   `expectedLatestQuestion` was copied into the result record at line 306 and
   **never compared to anything**; the adjacent `extractedCorrectly` was
   `!!extracted.latestQuestion`, a truthiness check that passes on any non-empty
   string including a wrong one. Neither appeared among the nine
   `failures.push(...)` conditions.

## Fixes

### 1. F-1 — `_wtaQ` dropped the typed question (`IntelligenceEngine.ts`)

`_wtaQHoist` and `_wtaQ` derived the question as
`extractedQuestion.latestQuestion || lastInterviewerTurn`, omitting the
caller-supplied `question`, while `wtaTurnQuestion`/`canonicalTurn` preferred
it. The evidence and source-authority gates were therefore planned for the
*transcript's* question while the answer type, context route and prompt were
planned for the *typed* one. Both now use the canonical expression.

Pinned by a **source-level** test (the divergence cannot be observed without
booting the engine): all three derivations must share one expression and each
must start with `question ||`.

### 2. F-3/F-4/F-5/F-6 — the extractor (`transcriptQuestionExtractor.ts`)

- **Emit raw text, score on cleaned text.** `latestQuestion` is now the raw
  interviewer utterance; `scoringText` (cleaned) still drives
  `INTERROGATIVE_LEAD`, `classifyType`, follow-up detection and
  `SOCIAL_PLEASANTRY`. Cleaning is a *filter*, not a transformation of the
  output. Fixes case flattening (`PostgreSQL` → `postgresql` in the retrieval
  query and prompt) and the lost terminal `?` on tag questions
  ("…three years, right?" → confidence 0.4 → **0.8**).
  Scoring deliberately stays on cleaned text: `INTERROGATIVE_LEAD` is
  `^`-anchored, so raw "Um, so, what is your name?" would drop 0.95 → 0.8.
- **Answerability floor.** A turn with no `?`, no interrogative lead, no
  imperative ask and no explicit backward reference no longer clears the 0.6
  grounding gate, and no longer emits a `followUpTarget` guess.
  "Interesting, that sounds pretty solid." went from confidence 0.7 with
  `followUpTarget: "second."` — which queried the résumé with the fabricated
  **"Tell me about my second."** — to confidence 0.3 and no lookup.
- **`IMPERATIVE_ASK`** (non-anchored) added so the floor does not reject
  "One more question — tell me about levee." This was caught by the regression
  guard written for `campaign2 fix#5`, which the first version of the floor
  broke.
- **Timestamp collisions.** The raw-turn lookup keyed on `timestamp` alone while
  the dedup Set keyed on `(timestamp, role)`. Streaming STT emits several turns
  per millisecond, so the lookup returned the wrong turn and silently defeated
  the raw-text greeting guard. Replaced with an order-preserving index map
  (`rawIndexOfCleaned`), which is collision-proof.

### 3. Bare one-word follow-ups (`transcriptCleaner.ts`) — **new, not in the audit**

`isMeaningfulTurn` required `length >= 5` for interviewer turns, so **`"Why?"`
(4 chars) was discarded entirely** and selection fell back to a turn the
candidate had already answered. Every bare `"Why?" / "When?" / "How?" / "Where?"`
— extremely common interview follow-ups — was being dropped. Added a
shape-gated `SHORT_INTERROGATIVE` exemption. Short *non*-interrogative noise
("ok") is still dropped.

### 4. Question provenance into V3 (`engine-bridge.ts`, `orchestrator.ts`, `IntelligenceEngine.ts`)

`buildV3Prompt` hardcoded `manualQuestion: question`, and `resolveQuestion`
stamps manual input `source:'manual', confidence: 1`. A fragment the extractor
scored 0.3 arrived indistinguishable from a deliberately typed question.

- New `questionSource: 'manual' | 'transcript'` and `questionConfidence` on
  `BridgeInput`; the question is routed to the matching `AnswerRequest` field.
- `resolveQuestion` honours a caller-supplied confidence instead of the flat
  0.7 default (clamped to 0..1; unchanged when absent).
- The WTA call site now passes `questionSource`, `questionConfidence`,
  `isFollowUp` and `hasScreenContext` — the latter two were computed ~1300 lines
  earlier and simply never threaded, leaving `usePreviousSourceContinuity` dead
  for every live meeting turn.
- `scope.sessionId` is now set. Left unset it fell back to the literal
  `'engine'`, so **every WTA turn across every meeting shared one
  conversation-state key**. NOTE this is **narrowed, not closed**:
  `sessionId` is `meetingId ?? meetingMarker ?? undefined`, and `meetingMarker`
  is `currentSessionId ?? calendarEventId ?? undefined`, so a WTA press with no
  tracked session still falls back to `'engine'`. That path is no worse than
  before, but it is not fixed.

**All three `buildV3Prompt` call sites audited, not just WTA:**
- `runWhatShouldISay` (2463) — `'manual'` when the user typed, `'transcript'`
  otherwise, with the extractor's confidence.
- `buildV3ForTranscriptSurface` (4314, assist/clarify/brainstorm) — **also had
  this defect.** It resolves through `question-resolver.ts` and passes
  `resolved.resolvedQuestion`, which is live speech, but was being stamped
  manual/1.0. Now `'transcript'` with `resolved.confidence`. Also given a real
  `sessionId`.
- `runManualAnswer` (4774) — genuinely typed input; the `'manual'` default is
  correct and left alone.

Defaults preserve existing behaviour for every other caller
(`questionSource` defaults to `'manual'`).

### 4b. Sparsify budget forfeit (`transcriptCleaner.ts:149`) — found by the multi-question trace, 2026-08-02

`sparsifyTranscript` hard-capped interviewer speech at `slice(-6)` and handed the
other `maxTurns - 6` slots to `otherTurns` **unconditionally**. When one role
underfilled, its slots were forfeited rather than reallocated:

```
14 interviewer turns, maxTurns=12  ->  6 turns in the prompt   (half the budget discarded)
```

An interviewer asking several questions in a row while the candidate is still
thinking is exactly when earlier context matters, and it is exactly when this
fired. Replaced with a floor-plus-reallocation scheme that always spends the
full budget; `lastN()` guards `slice(-0)`, which returns the whole array.

```
14 interviewer turns, maxTurns=12  ->  12 turns in the prompt
```

**This also fixes a regression introduced by the `SHORT_INTERROGATIVE` exemption
above** (§3). Keeping `"Why?"`/`"When?"` pushed the interviewer count past the old
6-turn cap, and `slice(-6)` evicted from the *old* end — so two short turns cost
**three** substantive questions and the prompt got *shorter* (12 → 11 lines).
Probe-verified before and after:

```
before fix:  input=14  output=11   q1 ✗  q2 ✗  q3 ✗
after  fix:  input=14  output=12   q1 ✗  q2 ✗  q3 ✓
```

Q1/Q2 still drop — unavoidable at a 12-cap on 14 turns, and dropping the oldest
is the correct behaviour. The *extra* loss is gone. Pinned by 4 tests including
an explicit "adding turns must not SHRINK the prompt" guard; mutation-probed
(M6: revert → 2 fail).

### 5. Benchmarks

- **`benchmarks/profile-intelligence/run_selection_benchmark.mjs`** — new,
  provider-free, runs in ~1 s, exit 1 on failure so it is usable as a gate.
  **NOT COMMITTED — `benchmarks/` is gitignored (`.gitignore:363`).** Run it with
  `node benchmarks/profile-intelligence/run_selection_benchmark.mjs`. The
  `package.json` script was deliberately dropped so the repo does not ship a
  script pointing at an untracked file. To make the gate travel, either
  `git add -f` it or relocate it out of `benchmarks/`. Scores two dimensions separately:
  `turn_ok` (right utterance, compared on content words so normalisation cannot
  fail it) and `text_ok` (case + terminal `?` preserved).
- **`run_what_to_answer_benchmark.ts`** now fails a case on
  `wrong_question_selected` and `extractedCorrectly` reflects the real
  comparison. Threshold 0.5 content-word overlap, which tolerates the follow-up
  resolver legitimately expanding a fragment ("And SQL?" → "How have you used
  SQL?") while failing on a different utterance.

## Verification

**Mutation probes — every fix confirmed detectable** (mutate source, rebuild,
re-run, restore):

| Mutation | Result |
|---|---|
| M1 revert raw-text emission | 2 fail ✓ |
| M2 revert answerability floor | 3 fail ✓ |
| M3 revert short-interrogative exemption | 2 fail ✓ |
| M4 break `IMPERATIVE_ASK` | 1 fail ✓ |
| M5 revert F-1 on `_wtaQ` | 2 fail ✓ |
| M6 revert sparsify budget fix | 2 fail ✓ |

M2's **first** version was vacuous — 0 fail — because the `isAnswerable` guard
on `isFollowUp` already covered the "Interesting, that sounds pretty solid."
input. Rewritten against statements that `classifyType` labels non-`general`
("Your Python experience is impressive." → `profile_detail`), which the
`questionType !== 'general'` rule floors to 0.7, i.e. **above** the grounding
gate. Those are the inputs the floor actually exists for, and they are the worse
real-world case: an interviewer paying a compliment triggered a full
résumé-grounded answer.

**Suites:** 273 pass / 0 fail across 21 WTA suites; 30 context-intelligence
suites clean.

**Two pre-existing failures, not caused by this work** (verified by stashing all
changes and re-running):
- `StripPriorAssistantTurnsDedup2026_07_26` 1/3 — asserts on `ipcHandlers.ts`
  source, which fails at `HEAD` too (uncommitted migration work by another
  agent).
- `FlagAndAdapter` 25/2 — identical with and without these changes.

## Not done

- The audit's grade-8 item (one selector for WTA built to `question-resolver.ts`'s
  standard, `_wtaQ` deleted outright rather than aligned) is a larger
  refactor and was not attempted.
- `questionNeed.ts` and `sessionFollowupResolver.ts` remain orphaned (74 + 201
  lines, tested, zero production callers).
- `CanonicalTurnPrecedenceRule2026_07_25`'s vacuity (audit M5) is untouched —
  its headline rule still cannot be discriminated by its own tests.
- The speculative pre-fetch still burns a generation per interviewer partial.

## Changed files

```
electron/llm/transcriptQuestionExtractor.ts
electron/llm/transcriptCleaner.ts
electron/IntelligenceEngine.ts
electron/context-intelligence/orchestration/engine-bridge.ts
electron/context-intelligence/orchestration/orchestrator.ts
electron/llm/__tests__/WtaQuestionSelectionFixes2026_08_02.test.mjs   (new, 15 tests)
benchmarks/profile-intelligence/run_selection_benchmark.mjs            (new)
benchmarks/profile-intelligence/run_what_to_answer_benchmark.ts
package.json                                                          (benchmark:selection)
```

Nothing is committed.
