# WTA multi-question / multi-part trace — 2026-08-02

Branch `ci-v3-phase0-4`, dirty working tree. All probes run against
`dist-electron/` built 03:57 from the current working tree (verified: contains
`IMPERATIVE_ASK`, `rawIndexOfCleaned`, `SHORT_INTERROGATIVE`). Probe scripts:
`scratchpad/probe{1..5}.cjs`. No source file was modified; `dist-electron` was
read-only (`require` only, never mutated).

## Headline

**Selection is single-question by construction and there is no multi-question or
multi-clause awareness anywhere on the live WTA path.** The recency rule is the
right call and I am not proposing reverting it. The real gaps are four
*different* things:

1. The prompt tells the model to answer exactly one turn (`<current_turn>`)
   while showing it a transcript containing every other unanswered question —
   with nothing marking which of those are still open.
2. `sparsifyTranscript` silently under-fills its own budget and can evict
   interviewer questions while leaving 6 of 12 slots unused.
3. A multi-part question gets ONE label from two *different* classifiers that
   *disagree*, and one of them misroutes on the word "stack".
4. The two answer-side guards that could notice an incomplete answer are both
   gated off for exactly the cases that need them.

Two corrections to the premises I was handed, both load-bearing — see
"Premise corrections" at the end.

---

# What actually happens

## 1. Multiple separate questions inside the 180s window

### 1a. Q1 and Q2 in consecutive interviewer turns, no candidate turn between

Selection: `extractLatestQuestion` (`electron/llm/transcriptQuestionExtractor.ts:338-359`)
walks the cleaned array backwards and `break`s at the first non-greeting
interviewer turn (`:356-358`). There is no counter, no "unanswered set", no
carry-forward. Q1 is dropped from selection unconditionally.

```
S1a — Q1, Q2 back-to-back, no candidate turn between
--- PROMPT (3 lines) ---
  [INTERVIEWER]: thanks for joining. can you walk me through your last project?
  [INTERVIEWER]: before that — what is your experience with kubernetes?
  [INTERVIEWER]: and how many years have you been writing go?
--- SELECTED: "And how many years have you been writing Go?" [type=general conf=0.8 followUp=false]
--- PER-TURN PRESENCE IN PROMPT ---
           in-prompt : "Thanks for joining. Can you walk me through your last project?"
           in-prompt : "Actually before that — what is your experience with Kubernetes?"
  SELECTED in-prompt : "And how many years have you been writing Go?"
```

So in the *short* case Q1 and Q2 are still visible to the model — they are just
not marked. **The crux is what the prompt says about scope.** Ships-today
(`promptSystemV2` default `true`, `intelligenceFlags.ts:577`), the user message is
built by `buildTurnContentV2` (`electron/llm/promptSystemV2.ts`), reached via
`WhatToAnswerLLM.ts:785-805` and selected at `:812`
(`_wtaUserMessage = _v3p?.user ?? _v2TurnUser ?? packet.userMessage`). Real output:

```
--- buildTurnContentV2 output (SHIPS TODAY, promptSystemV2 default:true) ---
  <recent_transcript>
  [INTERVIEWER]: a few things.
  [INTERVIEWER]: tell me about your last project, why you chose that stack, ...
  </recent_transcript>

  <current_turn>
  Tell me about your last project, why you chose that stack, ...
  </current_turn>

  <task>
  Respond to the current turn according to the active mode and action.
  </task>
```

**The prompt and the selector do not disagree — they agree, and that is the
problem.** `<task>` says "Respond to the current turn", `<current_turn>` is the
single selected question, and `<recent_transcript>` contains Q1 and Q2 with no
answered/unanswered marking. Nothing anywhere tells the model "there was also an
earlier question the candidate never answered." **Q1 is lost silently.**
[ships-today]

Note the legacy fallback is *worse*: `assembler.assemble({...})`
(`WhatToAnswerLLM.ts:607`) accepts no `question` parameter at all — the param
list at `electron/services/context/PromptAssembler.ts:200-230` is
transcript/modeTemplateType/screenContext/domContext/modeContext/customContext/
meetingHistory/priorResponses/intentContext/retrievedModeContext/
pinnedModeInstructions/candidateProfile/tokenBudget/systemPrompt. On that path
the selected question never enters the prompt in any form. It is reached
whenever `answerPlan?.question?.trim()` is empty (`WhatToAnswerLLM.ts:785`) —
which is exactly scenario 4 below.

### 1b. Long window — sparsify actually evicts

`sparsifyTranscript` (`transcriptCleaner.ts:149-176`) only engages above
`maxTurns`. When it does, `interviewerTurns.slice(-6)` (`:165`) hard-caps
interviewer turns at six. Exact eviction ledger by timestamp identity:

```
S1e — 14 CONSECUTIVE interviewer questions, zero candidate turns
raw=14  cleaned=14  sparsified=6
SELECTED: "What is your experience with chaos engineering at scale?"
  interviewer EVICTED      "What is your experience with message queues at scale?"
  interviewer EVICTED      "What is your experience with database indexing at scale?"
  interviewer EVICTED      "What is your experience with caching at scale?"
  interviewer EVICTED      "What is your experience with observability at scale?"
  interviewer EVICTED      "What is your experience with CI pipelines at scale?"
  interviewer EVICTED      "What is your experience with incident response at scale?"
  interviewer EVICTED      "What is your experience with API versioning at scale?"
  interviewer EVICTED      "What is your experience with cost control at scale?"
  interviewer IN-PROMPT    "What is your experience with schema migration at scale?"
  ... (5 more IN-PROMPT)
  => 8 turns evicted from prompt, of which 8 are INTERVIEWER QUESTIONS
```

`maxTurns` was 12. **The result has 6 turns.** `remainingSlots = 12 - 6 = 6`
(`:168`) is spent on `otherTurns`, and when there are no other turns those six
slots are simply forfeited. Eight interviewer questions were discarded with six
slots free. This is a plain budget bug, not a policy tradeoff. [ships-today]

The realistic mixed case still evicts, just less:

```
S1f — 7 answered pairs + 2 NEW back-to-back unanswered questions
raw=16  cleaned=16  sparsified=12
SELECTED: "And separately, how would you test that under load?" [follow_up conf=0.8]
  => 4 turns evicted from prompt, of which 3 are INTERVIEWER QUESTIONS
  (both NEW unanswered questions survived; Topic 1-3 evicted)
```

Here the behaviour is defensible — the evicted questions were already answered.
The failure mode is that eviction is **recency-ordered, not answered-ordered**:
nothing distinguishes "already answered, safe to drop" from "still open".

---

## 2. Multi-part question in ONE turn

Question: `"Tell me about your last project, why you chose that stack, and what
you'd do differently."`

**Not split. Nowhere. One label per classifier, and the two classifiers disagree.**

```
### classifyType (extractor) vs planAnswer (router) on the SAME multi-part turn
  extractor.questionType : jd_alignment
  planAnswer.answerType  : dsa_question_answer
```

- `classifyType` (`transcriptQuestionExtractor.ts:205-249`) is first-match-wins
  over the whole string. It returns `jd_alignment` because the JD branch
  (`:230`) contains the alternative `why you` — which matches "**why you** chose
  that stack" — and that branch is tested *before* the `profile_detail` branch
  at `:240` that would have matched "projects". A project question is labelled
  role-fit. [ships-today]
- `planAnswer` returns `dsa_question_answer`, a **coding** answer type
  (`isCodingAnswerType === true`). Isolated the trigger:

```
### Is "stack" the trigger for dsa_question_answer? ###
  answerType=dsa_question_answer      coding=true  :: "...why you chose that stack, and what you'd do differently."
  answerType=project_answer           coding=false :: "...why you chose that technology, and what you'd do differently."
  answerType=project_answer           coding=false :: "Tell me about your last project."
  answerType=dsa_question_answer      coding=true  :: "Tell me about your last project and why you chose that stack."
  answerType=dsa_question_answer      coding=true  :: "Why did you choose that stack?"
  answerType=project_answer           coding=false :: "...the tradeoffs you made, and what you'd change."
```

The word **"stack"** — meant as *tech stack*, read as *the data structure* — flips
a behavioural project question onto the DSA/coding route. Swap in "technology"
and it is `project_answer`. [ships-today]

Per-clause, the three clauses would have routed three different ways:

```
  answerType=project_answer         :: "Tell me about your last project"
  answerType=dsa_question_answer    :: "why you chose that stack"
  answerType=general_meeting_answer :: "what you'd do differently"
```

### Does anything notice an incomplete answer on the LIVE path?

**No. Confirmed, definitively.**

- `hasMultipleSubQuestions` has **no caller outside its own module**. The only
  references are `documentGroundedPrompt.ts:472`, `:506`, and
  `MultiPartQuestionDetection2026_07_23.test.mjs`. The premise I was handed is
  correct.
- `detectIncompleteSubQuestionAnswer` callers: `ipcHandlers.ts:4358`, `:4608`
  (manual doc-grounded chat) and `documentGroundedPrompt.ts:861` inside
  `validateDocumentGroundedAnswer`. That validator *is* called on the WTA path
  at `IntelligenceEngine.ts:3156` — but only inside the doc-grounded branch,
  with `answerPlan.answerType as DocumentQuestionShape`. A live interview
  question never reaches it.
- The live guard is `checkAnswerRelevance` (`IntelligenceEngine.ts:3684`). Its
  implementation (`electron/llm/AnswerRelevanceChecker.ts`) is a **single scalar
  topicality score** — `scoreChunk(q, a)`, or `max(headScore, tailScore)` for
  long answers. There is no clause enumeration and no coverage term. An answer
  covering only clause 1 of 3 is fully on-topic and scores clean.

**Compounding:** for *this exact question* the relevance guard does not run at
all. The gate at `IntelligenceEngine.ts:3676-3682` requires
`!isCodingAnswerType(answerPlan.answerType)` — and the "stack" misroute made it
`dsa_question_answer`, which *is* a coding type. So the multi-part project
question is (a) misrouted to coding, (b) answered as one clause, and (c) exempt
from the only guard that runs. **Confirmed: a live multi-part question can be
answered with a single clause and nothing notices.** [ships-today]

---

## 3. Linked / elaborating questions

### Which resolver runs — pinned empirically

`resolveLiveSessionMemoryConfig` under a forced production posture
(`NODE_ENV=production`, no `BENCHMARK_MODEL`/`NATIVELY_INTERNAL`/`NATIVELY_DEV`):

```
### WHICH RESOLVER SHIPS TODAY? ###
  sessionId="sess-abc" -> enabled=true reason=default_on pct=null bucket=null
  sessionId="sess-xyz" -> enabled=true reason=default_on pct=null bucket=null
  sessionId=""         -> enabled=true reason=default_on pct=null bucket=null
```

`reason=default_on`, not a percentage bucket — so this is **deterministic, not
session-dependent**. The `IntelligenceEngine.ts:1297` branch
(`resolveLiveFollowup` → `sessionFollowupResolver`) is what ships;
`:1305` (`resolveFollowUpOrClarify`, single-prior-turn) is the fallback only
under kill-switch/env/settings/rollout-0. Source: `liveSessionMemoryConfig.ts:176-182`.

### 3b. Bare inheriting follow-up — this works well

```
S3b — "How strong are you with Python?" / answer / "And SQL?"
extractor latestQuestion : "And SQL?"  isFollowUp=false conf=0.8
resolveFollowUpOrClarify -> {"resolvedQuestion":"What is your experience with sql?", conf:0.6, "topic_shift_skill_weak"}
resolveLiveFollowup (SHIPS TODAY) -> {"resolvedQuestion":"What is your experience with sql?",
    "resolvedAnswerType":"skill_experience_answer","confidence":0.9,"reason":"topic_shift_skill",
    "recalledEntity":"Python","recalledAgeSeconds":10,"resolvedVia":"session_memory"}
  >> preserves "SQL"? true
```

Confidence 0.9 clears the `>= 0.7` gate at `IntelligenceEngine.ts:1330`, so
`extractedQuestion.latestQuestion` is overwritten in place at `:1331` with a
complete standalone question. Correct behaviour, and note the shipping resolver
(0.9) is materially better than the fallback (0.6, which would *not* clear the
gate). [ships-today]

### 3a. Narrowing follow-up — this breaks, and it breaks silently

```
S3a — "What's your experience with Kafka?" then "I mean specifically consumer groups."
extractor  latestQuestion : "I mean specifically consumer groups."
extractor  isFollowUp/conf: false / 0.3
priorInterviewer computed : "What's your experience with Kafka?"
resolveFollowUpOrClarify  -> {"resolvedQuestion":"","confidence":0,"reason":"not_a_followup"}
resolveLiveFollowup (SHIPS TODAY) -> {"resolvedQuestion":"","confidence":0,"reason":"not_a_followup",
    "recalledEntity":"Kafka","recalledAgeSeconds":5,"resolvedVia":"none"}
WOULD OVERWRITE latestQuestion? false
```

Trace it through:

1. Selection takes the narrowing turn (recency, correct).
2. `isAnswerable` (`transcriptQuestionExtractor.ts:411-414`) is false — no `?`,
   no `^`-anchored interrogative lead, no `IMPERATIVE_ASK`, no strong marker.
   Confidence floored to 0.3 (`:479-482`).
3. `isFollowUp` is **false**, so the long-range lexical recall at
   `IntelligenceEngine.ts:1363` (gated `extractedQuestion.isFollowUp`) never fires.
4. Both resolvers return `not_a_followup`, so the `:1330` gate fails and
   `:1331` never runs.
5. **`resolveLiveFollowup` recalled the entity `"Kafka"` and it was thrown
   away** — `recalledEntity:"Kafka"` is right there in the result, but because
   `resolvedQuestion` is `""` and confidence is 0, the engine discards the whole
   object. The system *had* the missing topic and dropped it.
6. `<current_turn>` becomes `"I mean specifically consumer groups."` — the topic
   is gone.
7. Confidence 0.3 fails `extractedQuestion.confidence >= 0.6` at
   `IntelligenceEngine.ts:3678`, so the answer-relevance guard is **also** skipped.

**A narrowing clause discards the thing being narrowed, and every downstream
guard is disarmed by the same low confidence.** The prior turn *is* still in
`<recent_transcript>`, so the model may recover — but nothing in the system
ensures it. [ships-today]

Answering the question as posed: the follow-up resolver overwriting
`latestQuestion` in place at `:1331` **preserves** the narrowing clause when it
fires (3b: "sql" survives). The defect is that for the *narrowing* shape it does
not fire at all, and what is discarded is the **broad topic**, not the narrowing
clause.

---

## 4. The 180s boundary

`getContext(180)` at `IntelligenceEngine.ts:1069` filters `contextItems` by
timestamp (`SessionTracker.ts:509-511`). Retention was raised 120→180 at
`SessionTracker.ts:99` so the window is genuinely 180s.

```
S4 — question asked OUTSIDE the 180s window
  t-240s interviewer: "Walk me through the hardest system design problem..."   <-- EVICTED
  t-200s user: "So the hardest one was a multi-region write path..."           <-- EVICTED
  t-150s user: "We ended up using a leader-per-shard model with a fencing token..."
  t-60s  user: "That let us tolerate a full region loss without a split brain..."
--- extractLatestQuestion(windowed) ---
  latestQuestion : ""
  detectedSpeaker: unknown
  confidence     : 0
--- prepared prompt from windowed ---
  [ME]: we ended up using a leader-per-shard model with a fencing token on every write.
  [ME]: that let us tolerate a full region loss without a split brain during failover.
```

Plainly: **the question is gone from selection, and nothing brings it back.**

- `lastInterviewerTurn` is not a rescue — `getLastInterviewerTurn`
  (`SessionTracker.ts:637-644`) iterates the **same** 180s-evicted `contextItems`
  and also returns null.
- The empty-input guard at `IntelligenceEngine.ts:1203-1213` does **not** fire,
  because `preparedTranscript` is non-empty (the candidate's own turns). So the
  turn proceeds with an empty question.
- `answerPlan.question` is `""` → the `WhatToAnswerLLM.ts:785` gate
  (`answerPlan?.question?.trim()`) fails → falls back to `packet.userMessage`,
  which has **no question field at all**. The model receives only the candidate
  mid-answer and must infer the question from the answer.
- The follow-up block at `:1239` is gated on `extractedQuestion.latestQuestion`
  being truthy — skipped.
- Long-range lexical recall at `:1363` is gated on `isFollowUp` — skipped.
- `getDurableContext` (`SessionTracker.ts:539`) *does* still hold the t-240s
  question, and `recallLongRangeContext` reads it — but that path prepends to
  `preparedTranscript` (`:1391`), i.e. **context only, never selection**, and it
  is unreachable here anyway.

**A slow-turn interview where the interviewer asked 4 minutes ago and is waiting
is the worst-supported case in the system:** no question, no rescue from the
durable store, no guard, and the weakest of the three prompt shapes. [ships-today]

---

# Retrieval layers, disentangled (#5)

| Layer | file:line | Retrieves over | Method | Query input | Can it change WHICH question is answered? |
|---|---|---|---|---|---|
| Mode/reference hybrid retrieval | `IntelligenceEngine.ts:1152-1155` → `ModesManager.buildRetrievedActiveModeContextBlockHybrid` | **Uploaded mode documents / reference files** — NOT the meeting transcript | Hybrid: embeddings + lexical (+ optional rerank, `ragSpeculativeRerank` default OFF) | `preparedTranscript` — the **sparsified transcript blob**, passed twice (`:1153`), *not* the selected question | **No.** Evidence only. But see note below. |
| WTA-internal retrieval | `WhatToAnswerLLM.ts:375, 392, 404, 410` | Mode documents / OKF knowledge | Hybrid | `answerPlan?.question?.trim() \|\| cleanedTranscript` — the selected question, falling back to transcript | **No.** Evidence only. |
| Profile / résumé grounding | `IntelligenceEngine.ts:1589` `toCandidateFraming(extracted.latestQuestion)` → KnowledgeOrchestrator | **Uploaded résumé / profile facts** | Structured lookup + intent routing | The **selected question**, pronoun-normalised | **No.** Evidence only — but it is grounded on the *already-chosen* question, so a wrong selection produces confidently wrong evidence. |
| Session memory follow-up recall | `IntelligenceEngine.ts:1297` `resolveLiveFollowup` → `sessionFollowupResolver` | **Meeting transcript**, wide window via `getDurableContext` | Deterministic entity extraction — **no LLM, no embeddings** | Selected question + memory turns | **YES — the only layer that can.** Overwrites `latestQuestion` in place at `:1331` when confidence ≥ 0.7. |
| Long-range lexical recall | `IntelligenceEngine.ts:1363-1391` `recallLongRangeContext` | **Meeting transcript**, `getDurableContext` (2h) | **Bounded lexical keyword overlap — no LLM, no embeddings** | Selected question | **No.** Prepends a text block to `preparedTranscript` (`:1391`). Gated on `isFollowUp && !entityRecallSucceeded`. |

**The user's "RAG" belief is half right, and wrong in the way that matters.**
There *is* a real embedding-based hybrid retriever on every WTA press — but it
searches **uploaded mode documents, not the older meeting chat**. Retrieval over
the *older meeting transcript* is done by two layers and **both are
lexical/deterministic with no embeddings at all**. And only one layer — session
memory follow-up recall, which is not RAG — can change *which question gets
answered*. Everything else only attaches evidence to an already-chosen question.

**Sharp consequence of the query choice:** the mode retriever's query is
`preparedTranscript`, the whole sparsified blob (`IntelligenceEngine.ts:1153`).
In a two-question window the retrieved evidence is a *blend* of Q1 and Q2. So
retrieval cannot change which question is answered, but it can silently attach
evidence for the question that was **not** selected — pulling the answer
off-target without ever appearing in any selection trace.

---

# Where it breaks — ranked

### 1. Multi-part question answered by one clause, guard disarmed by a misroute [ships-today]
Trigger: `"Tell me about your last project, why you chose that stack, and what you'd do differently."`
Silent: **yes, completely.** `hasMultipleSubQuestions` exists and is never called
on this path (`documentGroundedPrompt.ts:430`, callers `:472`/`:506` only).
`checkAnswerRelevance` measures topicality, not coverage. And the "stack"→
`dsa_question_answer` misroute trips the `!isCodingAnswerType` exclusion at
`IntelligenceEngine.ts:3679`, so even that guard is skipped. Three independent
failures stacked on one sentence.

### 2. "stack" routes a behavioural project question to the DSA/coding path [ships-today]
Trigger: any question containing "stack" in the tech-stack sense — `"Why did you
choose that stack?"` alone is enough. Silent: **yes.** Changes answer type,
scaffolding, and disables the relevance guard. Highest-value single fix: the
word is unambiguous in context (`tech stack`, `chose that stack`, `stack we
used`) versus the data structure (`a stack and a queue`, `push/pop`).

### 3. Narrowing follow-up drops the topic while holding it in hand [ships-today]
Trigger: `"What's your experience with Kafka?"` / `"I mean specifically consumer groups."`
Silent: **yes.** `resolveLiveFollowup` returns `recalledEntity:"Kafka"` and the
engine discards it because `resolvedQuestion` is empty (`IntelligenceEngine.ts:1330`).
Confidence 0.3 then also disables the relevance guard (`:3678`).

### 4. `sparsifyTranscript` forfeits 6 of 12 slots and evicts questions anyway [ships-today]
Trigger: >12 turns with few or no candidate turns (rapid-fire questioning, or a
one-sided panel). Probe: 14 interviewer questions → **6** turns in the prompt, 8
questions dropped, 6 slots unused. Silent: **yes** — `transcriptCleaner.ts:165-169`.
Pure budget bug; fixing it is a 3-line backfill. **This is also the root cause of
the regression below — fixing it fixes both.**

### 4b. REGRESSION I INTRODUCED: `SHORT_INTERROGATIVE` displaces the two oldest questions [ships-today]
Trigger: >12 turns where the interviewer adds bare interrogatives (`"Why?"`,
`"How?"`) on top of 6+ substantive questions. Probed: Q1 and Q2 evicted post-fix,
retained pre-fix. Silent: **yes.** Net still an improvement over the bug the
exemption fixed, and it is subsumed by fixing #4. Full detail and probe output in
the section above.

### 5. Question older than 180s → no question at all, weakest prompt shape [ships-today]
Trigger: long candidate answer to a question asked >180s ago. Silent: **yes** —
the empty-input guard at `IntelligenceEngine.ts:1203` does not fire because the
transcript is non-empty, and `answerPlan.question === ''` silently downgrades the
prompt to the legacy assembler which carries **no question field**
(`WhatToAnswerLLM.ts:785`, `PromptAssembler.ts:200`).

### 6. Two classifiers disagree on the same turn [ships-today]
`classifyType` → `jd_alignment` (via the over-broad `why you` alternative at
`transcriptQuestionExtractor.ts:230`, ordered before `profile_detail` at `:240`);
`planAnswer` → `dsa_question_answer`. One drives grounding, the other drives
answer type. Silent: yes.

### 7. Retrieval query is the transcript blob, not the question [ships-today]
`IntelligenceEngine.ts:1153` passes `preparedTranscript` as both query
arguments. In a multi-question window the evidence is a blend across questions.
Silent: yes — invisible in any selection trace.

### Stale doc (not a defect, but actively misleading)
`liveSessionMemoryConfig.ts:21-25` states "**DEFAULT OFF in production**". The
code at `:176-182` returns `default_on`. Probe confirms `reason=default_on`.
Anyone reasoning about which resolver ships from the header comment gets it
backwards.

### REGRESSION I INTRODUCED — `SHORT_INTERROGATIVE` displaces substantive questions [ships-today]

My first check used a 5-turn transcript, which is under `maxTurns` — so
`sparsifyTranscript` was a no-op (`transcriptCleaner.ts:153`) and the check could
not see the interaction at all. Re-probed above the cap. **It reproduces.**

```
REGRESSION PROBE — 6 substantive Q interleaved with answers, then "Why?" + "How?"

--- POST-FIX (exemption keeps "Why?"/"How?") ---
raw=14 cleaned=14 sparsified=12
interviewer turns entering sparsify: 8
EVICTED interviewer questions (2): ["Q1: how did you handle scaling concern number 1 in production?",
                                    "Q2: how did you handle scaling concern number 2 in production?"]

--- PRE-FIX SIMULATION (short turns absent, as the length floor dropped them) ---
raw=12 cleaned=12 sparsified=12
interviewer turns entering sparsify: 6
EVICTED interviewer questions (0): []

### VERDICT ###
Substantive questions evicted POST-FIX but retained PRE-FIX: 2
   REGRESSION: "Q1: how did you handle scaling concern number 1 in production?"
   REGRESSION: "Q2: how did you handle scaling concern number 2 in production?"
```

Mechanism: pre-fix, `"Why?"` and `"How?"` (4 chars) failed
`cleanedText.length >= 5` at `transcriptCleaner.ts:103` and never entered
`interviewerTurns`. The `SHORT_INTERROGATIVE` exemption (`:44`, `:98-100`) now
keeps them, taking `interviewerTurns` from 6 to 8. `slice(-6)` (`:165`) keeps the
**most recent six**, so the two bare interrogatives displace **the two oldest
substantive questions**. My earlier reasoning — "it only evicts turns that
previously were not in the prompt at all" — was wrong: `slice(-6)` drops from the
*old* end, not the newly-kept recent end.

Severity is bounded by the fact that the exemption fixes a worse bug (the bare
follow-up being dropped entirely, which made selection lock onto a stale
already-answered turn — dataset `wta_projfu_089`). Net it is still an
improvement. But it is a real multi-question regression and it is **silent**.
It disappears entirely once finding #4 (the sparsify budget forfeit) is fixed:
with backfill, 8 interviewer turns and 6 candidate turns both fit inside a
12-turn budget with room to spare. **Fix #4 and this regression goes away as a
side effect** — that is the cheapest remediation.

`IMPERATIVE_ASK` is clean: it feeds only `isAnswerable` (`:411-414`) and cannot
move which turn is chosen — selection `break`s at `:358` before any shape test.

---

# What a correct design would do

1. **Mark open questions instead of hiding them.** Selection stays
   recency-first. Add an `openQuestions: string[]` to `ExtractedQuestion` — the
   interviewer turns after the last candidate turn that pass `isAnswerable`.
   Render them in the envelope as a distinct `<unanswered_questions>` block
   alongside `<current_turn>`, and let `<task>` say "answer the current turn;
   if earlier listed questions are still open, cover them briefly." Cheap,
   deterministic, no new model call.
2. **Fix the sparsify budget.** In `transcriptCleaner.ts:165-169`, backfill
   unused slots: take `slice(-6)` interviewer turns, fill `remainingSlots` from
   other turns, then **re-fill any leftover slots with older interviewer turns**
   before returning. Never return fewer than `min(maxTurns, turns.length)`.
3. **Disambiguate "stack" in `planAnswer`.** Require a data-structure context
   (`push`, `pop`, `queue`, `implement a stack`, `stack overflow`) before
   `dsa_question_answer`; treat `tech stack` / `chose that stack` / `stack we
   used` as `project_answer`. This one word is the whole bug.
4. **Consume the recalled entity even when resolution fails.** At
   `IntelligenceEngine.ts:1330`, when `resolvedQuestion` is empty but
   `recalledEntity` is present and the selected turn failed `isAnswerable`,
   compose `"<recalledEntity> — <narrowing clause>"` rather than discarding.
   Covers the Kafka/consumer-groups shape with no new machinery.
5. **Make coverage a first-class check on the live path.** Call the existing
   `hasMultipleSubQuestions` on `answerPlan.question`; when true, run
   `detectIncompleteSubQuestionAnswer` against the final answer regardless of
   answer type. The code already exists and is tested — it is simply not wired
   to this surface.
6. **Decouple the guards from confidence and answer type.** Low extractor
   confidence means the selection is *doubtful*, which is when validation is
   most needed, yet `:3678` disables it. Gate the relevance check on
   "we produced an answer", not on "we were confident about the question".
7. **Selection should be allowed to reach past 180s for an unanswered
   question.** When the 180s window yields no interviewer turn, fall back to the
   most recent `isAnswerable` interviewer turn in `getDurableContext` rather than
   proceeding with an empty question. The durable store already holds it.
8. **Retrieve on the question, not the blob.** Pass
   `answerPlan.question || preparedTranscript` at `IntelligenceEngine.ts:1153`,
   matching what `WhatToAnswerLLM.ts:410` already does.

---

# Premise corrections

Two of the premises I was handed are wrong on this tree, and both change conclusions:

1. **`promptSystemV2` is default `true`, not off** (`intelligenceFlags.ts:577`),
   and the *resolver* agrees, not just the `default:` field. Probed under a
   forced production posture (`NODE_ENV=production`, no `BENCHMARK_MODEL` /
   `NATIVELY_INTERNAL` / `NATIVELY_DEV`):
   `isIntelligenceFlagEnabled('promptSystemV2') -> true`. That is the exact
   predicate `isPromptSystemV2Enabled` delegates to (`promptSystemV2.ts:821-828`),
   which gates `resolveV2SystemPrompt` (`:870`). Note the doc comment at
   `promptSystemV2.ts:818` still says "default OFF" — stale, same class of error
   as the `liveSessionMemoryConfig.ts:21-25` comment.
   My prior note said DEFAULT OFF. This matters: the shipping prompt is the V2
   envelope, which *does* carry the selected question in `<current_turn>`. Had
   the flag been off, the shipping prompt would carry **no question at all**
   (`PromptAssembler.assemble` has no question parameter) — a strictly worse
   story. The legacy path is still reachable whenever `answerPlan.question` is
   empty (scenario 4).
2. **`resolveSessionFollowup` IS called.** The prior evidence that it is
   "exported but never called" is wrong: `liveSessionMemory.ts:151` calls it,
   reached from `IntelligenceEngine.ts:1297`, and `resolveLiveSessionMemoryConfig`
   returns `enabled=true reason=default_on` under a forced production posture.
   The session-memory resolver is what ships; the single-prior-turn
   `resolveFollowUpOrClarify` is the fallback. Confirmed empirically, not read.

The 180s premise **is** correct — `SessionTracker.ts:99` raised retention
120→180 specifically so `getContext(180)` is not silently truncated. I checked
because a comment at `IntelligenceEngine.ts:~1275` still describes the old 120s
behaviour.

---

# Method / verification status

- **Probe-verified:** all of scenarios 1-4 selection + prompt output, the
  resolver results, `planAnswer`/`classifyType` labels, the "stack" trigger, the
  sparsify eviction ledger (exact timestamp identity, not fuzzy matching), the
  `resolveLiveSessionMemoryConfig` default, and the `buildTurnContentV2` envelope.
- **Transcript provenance chain (read-traced end to end, no gap):** the string
  whose eviction ledger is shown above is the same string the provider receives.
  `IntelligenceEngine.ts:1096` `preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns, 12)`
  → passed as arg 1 at `:2552` `whatToAnswerLLM.generateStream(preparedTranscript, ...)`
  → received as `cleanedTranscript` (`WhatToAnswerLLM.ts:123`)
  → `workingTranscript = fitContextForCurrentModel(cleanedTranscript, reservedForFit)` (`:513`)
  → `let transcriptForPrompt = workingTranscript` (`:570`)
  → `buildTurnContentV2({ recentTranscript: transcriptForPrompt, ... })` (`:803`).
  There is **no second cleaning or sparsify pass** — `fitContextForCurrentModel`
  is a token-budget trim only. Two caveats: that trim can shorten the transcript
  further under budget pressure (making eviction *worse*, never better), and
  `transcriptForPrompt` is reset to `''` at `:599` when a reference-file-governed
  turn owns the sources, in which case the transcript is withheld entirely.
- **Read-traced (file:line cited, not executed):** the `IntelligenceEngine`
  branch structure — the empty-input guard, the `:1330` overwrite gate, the
  relevance-guard exclusions at `:3671-3682`, and the doc-grounded validator
  gating at `:3156`. Instantiating `IntelligenceEngine` needs app/session/provider
  wiring, so these are traced by reading the branch conditions against
  probe-verified inputs.
- Pre-existing unrelated failures noted and not investigated:
  `StripPriorAssistantTurnsDedup2026_07_26` (2), `FlagAndAdapter` (2).
- No source file modified. `dist-electron` read via `require` only, never mutated.
