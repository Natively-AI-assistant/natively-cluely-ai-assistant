# "What to Answer" — question selection & context selection audit

**Date:** 2026-08-02
**Branch:** `ci-v3-phase0-4` (working tree, dirty)
**Scope:** which utterance out of a live rolling meeting transcript the system decides to answer, and with what context.
**Method:** source read + empirical probes against the compiled `dist-electron` modules + mutation-probing the load-bearing tests.

### Review basis (important — tree is mid-migration)

| File | State reviewed | Does the diff change a finding? |
|---|---|---|
| `electron/IntelligenceEngine.ts` | **working tree** (modified vs HEAD) | No — the WTA selection chain (`extractLatestQuestion` → `_wtaQ` → `wtaTurnQuestion` → `canonicalTurn`) is present in both. |
| `electron/intelligence/intelligenceFlags.ts` | **working tree** (modified) | **Yes.** `promptSystemV2` does not exist at HEAD; in the working tree it is added with `default: true`. Findings touching the v2 turn envelope are labelled accordingly. |
| `electron/context-intelligence/question/turn-classifier.ts`, `conversation-state.ts` | working tree (modified) | No — neither is on the WTA question-*selection* path (see F-2). |
| `transcriptQuestionExtractor.ts`, `transcriptCleaner.ts`, `resolveCanonicalTurn.ts`, `questionNeed.ts`, `question-resolver.ts` | clean = HEAD | n/a |

### Flag state that actually ships today

| Flag | Default | Source | Effect on this subsystem |
|---|---|---|---|
| `contextIntelligenceV3` | **ON** | `electron/context-intelligence/contracts/flag.ts:108` (`DEFAULT_ENABLED = true`, flipped 2026-07-30) | V3 composes the WTA system+user prompt; legacy assembly is bypassed. |
| `promptSystemV2` | **ON** (working tree only) | `intelligenceFlags.ts:577` | Only reached when V3 returns null. |
| `contextOsEvidencePackEnabled` | ON | `intelligenceFlags.ts:531` | Only governs doc-grounded custom modes. |
| `liveTranscriptBrain` | OFF | `intelligenceFlags.ts:408` | Shadow only. |
| `turnIdentityV2` | dev/test only | `intelligenceFlags.ts:557` | Not a selection gate. |

Everything below is tagged **[ships-today]** or **[flag-gated]**.

---

## 1. How it actually works

A numbered trace of one manual "What to answer" press (`Cmd+Enter` → `ipcHandlers.ts:9220`) or one speculative auto-fire.

1. **Transcript window.** `SessionTracker.getContext(180)` — `SessionTracker.ts:509`. Time-based: `timestamp >= now - 180_000`. Write-side eviction is also 180 s with a 500-item cap (`SessionTracker.ts:99-100`). So the window is **seconds, not turns or characters** — 180 s hard.
   Called at `IntelligenceEngine.ts:1069`.
2. **Interim injection.** The latest non-final interviewer partial is appended as a real turn unless it dupes the last item by text or is within 1000 ms of it — `IntelligenceEngine.ts:1073-1088`.
3. **Cleaning.** `cleanTranscript(turns)` — `transcriptCleaner.ts:108`. Per turn: `text.toLowerCase()` (`:42`), repeated-word collapse, unconditional removal of `FILLER_WORDS ∪ ACKNOWLEDGEMENTS` (23 tokens, `:14-24`) with `CONTENT_AMBIGUOUS` (13 tokens, `:36`) protected only mid-sentence, then punctuation collapse. Turns survive if interviewer & `len >= 5`, else `>= 3 words && len >= 10` (`:83-101`).
4. **Selection.** `extractLatestQuestion(turns)` — `transcriptQuestionExtractor.ts:251`. Walks the cleaned array **backwards**, takes the **first** `role === 'interviewer'` turn that is non-empty and not `GREETING_ONLY`. Recency wins outright; question-shape is *not* a selection criterion (deliberate, `:286-301`). `latestQuestion = chosen.text.trim()` — i.e. the **cleaned, lowercased** text (`:332`).
5. **Shape scoring.** `hasMark = /\?/`, `hasLead = INTERROGATIVE_LEAD` (`:71-72`). Follow-up = `DEMONSTRATIVE_FOLLOW_UP` ∨ `STRONG_FOLLOW_UP_MARKERS` ∨ (`WEAK_FOLLOW_UP_MARKERS` ∧ ≤14 words), and a prior turn exists (`:343-347`). `classifyType` is 10 regex families → 8 labels (`:198-243`). Confidence: 0.95 / 0.8 / 0.7 / 0.4 (`:388-401`).
6. **Follow-up rewrite (mutates the selection).** `IntelligenceEngine.ts:1239-1341`, only when no typed question. Either `resolveLiveFollowup` (SessionMemory, over `getDurableContext(7200)`) or `resolveFollowUpOrClarify`. On `confidence >= 0.7` it **overwrites** `extractedQuestion.latestQuestion = fr.resolvedQuestion` (`:1331`). This is a second question authority, in place.
7. **Long-range lexical recall.** `recallLongRangeContext` prepends a block to `preparedTranscript` when `isFollowUp` and entity recall missed — `IntelligenceEngine.ts:1363-1408`.
8. **Grounding lookup.** Gated on `detectedSpeaker === 'interviewer' && confidence >= 0.6 && questionType ∈ {identity, profile_detail, behavioral, jd_alignment, general, follow_up}` (`:1540-1548`). `lookupQ = toCandidateFraming(latestQuestion)`, or `"Tell me about my ${followUpTarget}"` for follow-ups (`:1582-1585`). 2000 ms budget.
9. **Duplicate plan A — `_wtaPlan`.** `IntelligenceEngine.ts:1686`: `_wtaQ = extractedQuestion.latestQuestion || lastInterviewerTurn || ''` — **the caller-supplied `question` is ignored here**. `planAnswer({question: _wtaQ, ...})` at `:1707` drives `_wtaContract` (`:1767`), `resolveSourceOwnership` (`:1788`), `buildTurnContractIfEnabled` (`:1809`) — i.e. the **evidence/source gates**.
10. **Plan B — `canonicalTurn`.** `IntelligenceEngine.ts:1970`: `resolveCanonicalTurn({ answerInput: { question: question || extractedQuestion.latestQuestion || lastInterviewerTurn, ... } })` — **prefers the caller-supplied question**. Calls `planAnswer` a second time (`resolveCanonicalTurn.ts:197`). Its `answerPlan` is what reaches `generateStream` and the prompt.
11. **Turn question C — `wtaTurnQuestion`.** `IntelligenceEngine.ts:2071`: `question || extractedQuestion.latestQuestion || lastInterviewerTurn || ''`. Feeds V3.
12. **V3 composition [ships-today].** `buildV3Prompt({ surface:'what-to-answer', question: wtaTurnQuestion, conversationSummary: conversationWindow(90), retrieval: port })` — `IntelligenceEngine.ts:2445-2487`. Inside, `orchestrator.resolveQuestion` (`orchestrator.ts:83-88`) treats it as `manualQuestion` → **`source:'manual', confidence: 1`, verbatim**. Retrieval plan, claim requirements and prompt are composed from it.
13. **Substitution.** `WhatToAnswerLLM.ts:812`: `_wtaUserMessage = _v3p?.user ?? _v2TurnUser ?? packet.userMessage`. When V3 returned a prompt, the entire legacy assembly (`packet`) is discarded.
14. **Stream** → `llmHelper.streamChat` (`WhatToAnswerLLM.ts:821`).

**Answer to "is there a single canonical resolver?"** No. There are **four** places a question string is derived, and they are not the same expression:

| # | Symbol | Expression | Consumes |
|---|---|---|---|
| A | `extractedQuestion.latestQuestion` | cleaned transcript, mutated at `:1331` | grounding lookup, follow-up, `_wtaQ` |
| B | `_wtaQ` (`:1686`) | `extracted ‖ lastInterviewerTurn` — **drops typed `question`** | source contract, ownership, Context-OS contract |
| C | `canonicalTurn.answerPlan.question` (`:1971`) | `question ‖ extracted ‖ lastInterviewerTurn` | answer type, context route, prompt |
| D | `wtaTurnQuestion` (`:2071`) | same as C | V3 prompt + retrieval |

B vs C/D **provably diverge** whenever a typed question is present and differs from the transcript (see F-1).

There is a **fifth, correctly-designed resolver that the WTA path does not use** — see F-2.

---

## 2. Ways it takes the wrong question

Ranked by likelihood × impact. All reproduced empirically against `dist-electron` unless noted.

### F-1 [CRITICAL, ships-today] Typed question and transcript question drive different halves of the same turn
`IntelligenceEngine.ts:1686` vs `:1971`/`:2071`.

`_wtaQ` deliberately omits the caller's `question`. So on the manual chat/typed path — and on any press where the typed text differs from the last interviewer utterance — the **source-authority contract, ownership decision and Context-OS turn contract are computed for the transcript's question**, while the **answer type, context route and V3 prompt are computed for the typed question**.

Concrete trigger: interviewer's last turn is "what salary are you expecting?"; user types "reverse a linked list in python". `_wtaPlan.answerType = negotiation_answer` → `_wtaContract`/`resolveSourceOwnership` provision a negotiation/profile evidence universe; `canonicalTurn.answerPlan.answerType = dsa_question_answer` → the route *forbids* the resume layer. Two authorities, one turn, no tie-break. The `var` hoisting comments at `:1690-1706` and `:1731-1736` show this block has already silently mis-fired twice from scope bugs.

Note this is not the "duplicate pure computation" case: `planAnswer` is pure, but it is called with **different inputs**.

### F-2 [HIGH, ships-today] On the primary surface, V3 is handed the weak extractor's output and told it was typed by the user
The strong STT-aware guards live in `electron/context-intelligence/question/question-resolver.ts` — 177 lines against a written spec (§12.1/§12.2): the priority ladder, a **60 s recency window** (`:145`), an **abandoned-question guard** (`:89-94`), an **assistant-echo guard** (`:148`), an STT **stutter deduper** (`:57-65`). Its production caller is `IntelligenceEngine.ts:4264` — `buildV3ForTranscriptSurface`, i.e. assist / clarify / brainstorm, the surfaces that receive raw speech with no question selected yet.

**This is not a wiring omission, and "just call it from WTA" would be wrong.** That module's own contract (`:16-23`) says manual input wins outright and a transcript extractor that overrides typed text is a bug; it also expects *raw* turns, which WTA has already cleaned and mutated by step 6. WTA reaches V3 with a question already chosen, so `manualQuestion` is the structurally correct field, and `orchestrator.ts:83-88` (a different, deliberately narrow `resolveQuestion` of the same name) is right to pass it through.

The defect is **upstream and provenance-shaped**: the thing WTA pre-resolves with is `extractLatestQuestion` — the 12-regex legacy extractor whose failure modes are F-3 through F-9 — and once it crosses into V3 as `manualQuestion`, **nothing downstream can tell it apart from text the user typed**. `orchestrator.ts:85` stamps `source:'manual', confidence: 1`. Verified: those two fields are computed at `:83-88` and **never read anywhere in `orchestrator.ts`** — only `q.resolved` is consumed (`:142`, `:166`, `:189`). So V3's own question-provenance signal is dead code, and a fragment the extractor scored 0.4 (F-3, F-4, F-6) arrives indistinguishable from a deliberate typed question, with no answerability floor between them.

Corollaries at the same call site (`IntelligenceEngine.ts:2450-2470`):
- `isFollowUp` is **never passed**, so `orchestrator.ts:144` sees `false` and `retrievalPlan.usePreviousSourceContinuity` (`:172`) is dead for every live meeting turn — even though `extractedQuestion.isFollowUp` was computed 800 lines earlier.
- `hasScreenContext` is never passed either, despite `options.screenContext` existing.
- `scope` carries no `sessionId`, so `engine-bridge.ts:149` falls back to the literal `'engine'` — **all WTA turns across all meetings share one conversation-state key** (`conversation-state-store.ts:40`). `recordAnswerSummary` is only ever called with a renderer `senderId` (`ipcHandlers.ts:1272`), never `'engine'`, so the WTA branch of conversation state is written and never completed.

### F-3 [HIGH, ships-today] A non-question interviewer statement becomes "the question", and drags a garbage grounding lookup with it
Recency-wins (`:302-325`) has no answerability floor, and confidence is not a gate anywhere in `runWhatShouldISay`.

Reproduced:
```
interviewer: "Tell me about your distributed systems work."
user:        "Sure, I built a sharded event bus handling 40k events per second."
interviewer: "Interesting, that sounds pretty solid."
→ latestQuestion: "interesting, that sounds pretty solid."
  questionType:   follow_up      confidence: 0.7
  followUpTarget: "second."
```
`confidence 0.7 >= 0.6` and `follow_up` is in the groundable set (`:1547`), so `lookupQ` becomes **`"Tell me about my second."`** (`:1584`) and the résumé orchestrator is queried with it. The 0.7 comes from `:391` — `questionType !== 'general'` floors it at 0.7, and the follow-up label was itself derived from the bare word "that". `followUpTarget` "second." is the `pickSalientToken` fallback: last word longer than 4 chars from the prior turn (`:366-367`).

### F-4 [HIGH, ships-today] The cleaner destroys the '?' that the extractor's own confidence heuristic reads
`transcriptCleaner.ts:20-24` puts `right` in `ACKNOWLEDGEMENTS`; `:57-58` strips leading/trailing filler runs including its punctuation.

```
interviewer: "So you were at Google for three years, right?"
→ latestQuestion: "you were at google for three years,"
  questionType: general   confidence: 0.4
```
A genuine confirmation question — one of the most common interview shapes — is stripped to a fragment and scored 0.4, below the 0.6 grounding gate and below the 0.75 live speculative gate. It still becomes the question string sent to the model, now shorn of its interrogative force.

### F-5 [HIGH, ships-today] Named entities are lowercased before retrieval and prompting
`transcriptCleaner.ts:42` (`text.toLowerCase()`) → `transcriptQuestionExtractor.ts:332` → B/C/D above → `WhatToAnswerLLM.ts:375` (`retrievalQuery = answerPlan.question`), `:804` (`currentTurn` in the v2 envelope), and `orchestrator.ts:166` (`queries: [q.resolved]`).

```
in:  "So, um, tell me about the PostgreSQL migration you did at Stripe. Actually, how did you handle Kafka backpressure?"
out: "tell me about the postgresql migration you did at stripe. how did you handle kafka backpressure?"
     questionType: behavioral
```
Two problems. (a) `PostgreSQL`→`postgresql`, `Stripe`→`stripe`, `Kafka`→`kafka` — the lexical/FTS half of hybrid retrieval and every capitalisation-sensitive router (this repo has documented `GENERIC_TECH_CAPS` product-name routing) lose their strongest signal. `question-resolver.ts` deliberately does *not* lowercase; the legacy path does, and nothing documents it as intentional. (b) the multi-clause turn is typed `behavioral` because `"how did you handle"` is in `BEHAVIORAL` (`:228`) — a Kafka backpressure question is routed to STAR.

### F-6 [MEDIUM-HIGH, ships-today] Timestamp-collision defeats the greeting guard
`transcriptQuestionExtractor.ts:272` builds the dedup key as `` `${timestamp}:${role}` `` (two fields), but `:317`, `:363` and `:374` look up the raw turn with `turns.find(t => t.timestamp === turn.timestamp)` — **one field**. Streaming STT routinely emits mic and system-audio turns in the same millisecond.

Reproduced:
```
interviewer @T-2000: "What is your name?"
user        @T:      "My name is Evin and I work on distributed systems."
interviewer @T:      "Nice to meet you"        ← same ms as the user turn
→ latestQuestion: "to meet you"   confidence: 0.4
```
`cleanText` turns "Nice to meet you" into "to meet you" (leading `nice` is an acknowledgement), so the greeting regex misses; the raw-text fallback at `:317` is supposed to catch it, but it resolves to the **user's** turn instead, so `GREETING_ONLY` misses again and a meaningless fragment becomes the question. The same one-field lookup feeds `pickSalientToken` at `:363`/`:374`, so follow-up targets can be mined from the wrong speaker's words.

### F-7 [MEDIUM, ships-today] Multi-part questions are never split
`MultiPartQuestionDetection2026_07_23.test.mjs` (11 tests, all pass) exercises `hasMultipleSubQuestions` — which lives in `electron/llm/documentGroundedPrompt.ts:430` and is called **only** from `:472`, `:479` and `:506`, all inside the **document-grounded** prompt/validator path. It is **not** wired into WTA selection.

```
"What is your experience with Kubernetes? And how would you design a rate limiter?"
→ one string, questionType: profile_detail
```
Both clauses reach the model, but the routing (`profile_detail` → résumé grounding), the retrieval query and the answer-type contract are all resolved against the first clause only.

### F-8 [MEDIUM, ships-today] No recency decay inside the 180 s window
`extractLatestQuestion` has no time check at all — the only bound is the caller's `getContext(180)`. If the candidate has been talking for two minutes, the latest interviewer turn is still returned at full confidence:
```
interviewer: "Tell me about your last project."
user: (3 long turns)
→ latestQuestion: "tell me about your last project."  confidence: 0.8
```
Sometimes that is what the user wants; there is no mechanism to distinguish. Contrast `question-resolver.ts:145`, which uses a 60 s window for exactly this reason and is not on this path.

### F-9 [MEDIUM, ships-today] Diarization failure modes
- **Single channel / everything tagged `user`:** `extractLatestQuestion` returns the empty result (`:327-330`). The `lastInterviewerTurn` fallback also yields null — `SessionTracker.getLastInterviewerTurn()` (`:637-644`) scans `contextItems` for `role === 'interviewer'` with no fallback. (Side note: that fallback returns **raw** text, so `_wtaQ`'s primary branch is lowercased and its fallback branch is not — the same variable carries two different normalisations.) So `_wtaQ` and `wtaTurnQuestion` become `''`; `buildV3Prompt` returns null at `engine-bridge.ts:129`; the governed-input guard at `IntelligenceEngine.ts:1205` does *not* fire because `preparedTranscript` is non-empty. Net: a full provider round-trip with **no question at all**, answered from the raw transcript.
- **Assistant output mislabelled as interviewer:** there is no assistant-echo guard in the legacy extractor. The model's own previous answer, re-transcribed through the speaker, becomes `latestQuestion` at confidence 0.4. (`question-resolver.ts:148` has the guard; F-2 explains why it is not reached.)

---

### Latent — not reachable in today's build, fires the moment the auto-trigger is reconnected

Both items below share one root cause: **`handleSuggestionTrigger` has no production caller.** Its only call sites are `IntelligenceManager.ts:169` (pass-through) and `ipcHandlers.ts:12678` (offline harness IPC); the renderer-facing `native-audio-suggestion` channel (`preload.ts:1532`) has no subscriber in `src/`. Nothing in §2 above depends on these.

### F-10 [LATENT — high severity if re-wired] Jaccard cross-question reuse
`IntelligenceEngine.ts:665-672` reuses a speculative answer when `jaccardSimilarity(speculativeText, trigger.lastQuestion) >= 0.75` (`:221`). `jaccardSimilarity` (`:477-487`) is bag-of-words with a `containment * 0.9` floor. Measured:

| A | B | score | verdict |
|---|---|---|---|
| "Tell me about your Levee project" | "Tell me about your Tinroof project" | **0.750** | REUSE |
| "What did you do at Stripe?" | "What did you do at Google?" | **0.750** | REUSE |
| "tell me about that" | "tell me about that project in more detail" | 0.900 | REUSE |
| "How would you scale it?" | "How would you shard it?" | 0.720 | restart |

The metric is exactly wrong for this job: the discriminating token is one proper noun, which bag-of-words dilutes to nothing. **This does not fire in the current build** — see the subsection header. It is listed because it is a one-line reconnection away from serving the Levee answer to the Tinroof question, at exactly the gate value.

### F-11 [MEDIUM, ships-today — wasted cost, not wrong answers] The speculative pre-fetch is dead LLM spend
`maybeSpeculate` (`:496-524`) fires `runWhatShouldISay(..., {speculative:true})` on any interim interviewer partial with ≥ `SPECULATIVE_MIN_WORDS`, confidence ≥ threshold, and `hasQuestionSignal` (`:489-492`, an 18-keyword regex). The full answer is generated (`:3775-3780` returns it), never streamed (`:2583` "speculative prefetch never streams to UI"), and its only reader is the dead `handleSuggestionTrigger`. It also stamps `lastTriggerTime`, which is the exact hazard `triggerGate.ts` was written to neutralise.

---

## 3. Ways it takes the wrong context for a correctly-chosen question

### C-1 [HIGH, ships-today] The transcript the model sees is not the transcript the question came from
`generateStream` receives `preparedTranscript` = `prepareTranscriptForWhatToAnswer(transcriptTurns, 12)` (`:1096`) — `cleanTranscript` → `sparsifyTranscript(12)` → format. `sparsifyTranscript` (`transcriptCleaner.ts:131-158`) keeps **the last 6 interviewer turns** plus `12 - 6 = 6` recent other turns, re-sorted by timestamp. On a normal 180 s window with dense back-and-forth, the candidate's own answers are the ones dropped — which is precisely the material needed to resolve "that", "it", "the one you mentioned".

Under V3 [ships-today] the effect is larger: V3 gets only `conversationWindow(90)` as `conversationSummary` (`:2468`), explicitly labelled *referent, not evidence*, and `preparedTranscript` is discarded along with the whole legacy `packet` at `WhatToAnswerLLM.ts:812`.

### C-2 [MEDIUM, ships-today] `followUpTarget` can overwrite a good grounding query with a stopword-adjacent noun
`:1583-1585` replaces the entire lookup with `"Tell me about my ${followUpTarget}"`. `followUpTarget` comes from `pickSalientToken` (`:171-196`) — last CamelCase token, else last non-stopword capitalised non-sentence-initial word — with a fallback to *the last word longer than 4 characters* (`:366-367`). F-3 shows that fallback producing `"second."`. The source comment at `:97-101` already acknowledges this class ("a bogus followUpTarget can overwrite a perfectly good identity/technical query").

### C-3 [MEDIUM, ships-today] Prior assistant answers enter the prompt; the WTA path has no strip
`temporalContext.previousResponses` is passed as `priorResponses` (`WhatToAnswerLLM.ts:612`) and again as evidence `kind:'other', source:'prior_assistant_responses'` in the v2 envelope (`:798-799`). `stripPriorAssistantTurns` (`conversationHistoryPolicy.ts:55`) is called only from `ipcHandlers.ts:2565` and `:12010` — the manual-chat and phone-mirror paths. WTA has no equivalent. The exposure is bounded (labelled block, 10-item history cap at `SessionTracker.ts:451`) and assistant messages do **not** re-enter `contextItems`, so this is drift-amplification rather than the phantom-memory class.

### C-4 [LOW-MEDIUM, ships-today] Long-range recall splices old turns above the recent window
`recallLongRangeContext` prepends its block to `preparedTranscript` (`:1391`), reading `getDurableContext(7200)`. It is gated on `extractedQuestion.isFollowUp` — which F-3/F-6 show is set by the bare word "that" on a short turn. A false follow-up therefore splices 2-hour-old transcript above the live window. The negotiation mode-boundary gate at `:1374-1382` is a genuinely good guard on the one leak class that matters most.

### C-5 [LOW, ships-today] Cross-meeting conversation-state key
Per F-2: WTA advances V3 conversation state under the literal key `'engine'`. `clearConversationState()` is called on a global reset (`ipcHandlers.ts:11143`) and per-`senderId` (`:1337`) — neither clears `'engine'` on a meeting or mode switch. The store is `globalThis`-anchored (`conversation-state-store.ts:28-38`), which correctly handles the esbuild per-bundle-inlining hazard; the defect is the key, not the storage.

### Determinism & races

- **Not deterministic given the same transcript.** `triggerGate.ts:41` (`now - lastTriggerTime < cooldown`) and `:662` (`Date.now() > speculativeTextExpiry`) are wall-clock. Two identical transcripts at different offsets take different branches.
- **Mutable state on the selection path:** `extractedQuestion` is mutated in place at `:1331`; `this.speculativeText` / `speculativeTextExpiry` / `lastTriggerTime` / `currentGenerationId` are instance-level.
- **esbuild singleton hazard:** correctly handled where it matters. `conversation-state-store.ts` anchors on `globalThis` with an explicit comment (`:13-16`); `engine-bridge.ts:186-189` explicitly refuses to cache the scope policy for the same reason. **No WTA cache was found exposed to the stale-bundle failure mode.** Credit where due.
- **Supersession is well built.** `whatToAnswerCancellationToken` + `generationId` + `isWtaSuperseded()` (`:861-877`) with `AbortSignal` threaded to the provider is a genuinely correct design, and `WhatToAnswerRequestSnapshot` freezing the mode at t0 closes a real mid-request-switch race.

---

## 4. Test coverage reality check

All suites pass as committed (`ELECTRON_RUN_AS_NODE=1 npx electron --test`):
`TranscriptQuestionExtractor` 51/51, `WhatToAnswerDeterministic` 25/25, `WhatToAnswerContract` 27/27, `CanonicalTurnPrecedenceRule2026_07_25` 11/11, `ResolveCanonicalTurnParity` 14/14, `QuestionNeed2026_07_25` 9/9, `MultiPartQuestionDetection2026_07_23` 11/11, `WtaV3PromptSubstitution` 3/3.

### Mutation probes

Source assertion was broken in the compiled `dist-electron` module, the suite re-run, then the module restored byte-for-byte from backup.

| # | Mutation | Result | Read |
|---|---|---|---|
| M1 | Invert recency: pick the **oldest** interviewer turn | **5 fail** / 46 pass | Real pin. |
| M2 | Delete the `SOCIAL_PLEASANTRY` confidence cap (`:400`) | **7 fail** / 44 pass | Real pin. |
| M3 | Delete the greeting guard's raw-turn fallback (`GREETING_ONLY.test(original)`, `:318`) | **1 fail** / 50 pass | Thin but real. |
| M4 | Remove the lowercasing (`transcriptCleaner.ts:42`) | **0 fail, 51/51 pass** | **Unpinned in both directions.** No test knows the question is lowercased. F-5 is undetected by the suite and a fix would also be undetected. |
| M5 | Invert the canonical precedence rule — always use `mapAnswerTypeToQuestionKind(answerPlan.answerType)` instead of `turnPlan.questionKind` (`resolveCanonicalTurn.ts:239-241`) | **0 fail, 34/34 pass** across all three canonical suites | **VACUOUS on the headline claim.** |
| M6 | `deriveQuestionNeed` always returns `'general_knowledge'` | **7 fail** / 2 pass | Real pin — on dead code (see below). |
| M7 | Disable V3 prompt substitution (`_v3p?.user ?? …` → drop `_v3p`) | **1 fail** / 2 pass | Real, minimal. |

**M5 in detail.** `CanonicalTurnPrecedenceRule2026_07_25.test.mjs` exists to protect one rule: *`turnPlan.questionKind` wins whenever `planTurn` succeeds*. Its two discriminating tests are `:84` `assert.equal(turn.resolvedQuestionKind, turn.turnPlan.questionKind)` — tautological under the mutation — and `:92`, the "previously-buggy `technical_concept_answer` case … resolves to `coding_question` via turnPlan, not general". But the suite's own `:48` asserts `mapAnswerTypeToQuestionKind('technical_concept_answer') === 'coding_question'`: **both branches produce the same value**, so the test cannot discriminate the source it claims to test.

I swept 14 realistic questions for a disagreeing case and found exactly one — `"What are the research questions in the paper?"` → `turnPlan: doc_question` vs `mapped: general`. The rule is real (1/14 disagreement rate); **the test suite contains no case that exercises it.**

### Coverage holes (absence, which is stronger than a weak test)

- **No test pins case/punctuation preservation of `latestQuestion`.** Every assertion in `TranscriptQuestionExtractor.test.mjs` uses `/…/i`.
- **No test for the F-1 `_wtaQ` vs `canonicalTurn` divergence.** No test constructs a typed question differing from the transcript and asserts both plans agree.
- **No test that the WTA path resolves questions through `question-resolver.ts`** — because it doesn't. The module's 60 s window, abandoned-question and assistant-echo guards are tested in isolation and unreachable from the primary surface.
- **No test for timestamp collisions** in the extractor (F-6).
- **No test asserting `isFollowUp`/`hasScreenContext` are threaded into `buildV3Prompt`.**
- **`electron/llm/questionNeed.ts` has zero production callers.** 74 lines, 9 tests, a real mutation pin — protecting dead code. Same for `sessionFollowupResolver.resolveSessionFollowup` (201 lines, exported from `llm/index.ts:93`, never called; the live path uses `resolveLiveFollowup`).
- **The "75-case WTA benchmark" does not exist as a runnable harness.** `benchmarks/profile-intelligence/` contains `expand_wta_dataset.cjs` (a generator) and committed result JSON/markdown; there is no WTA-specific case matrix or runner. The live matrices that do exist (`final_300_*`, `followup_stability_*`, `benchmarks/prompt-v2-vs-legacy/`) are answer-quality benchmarks — none of them assert **which question was selected**.

---

## 5. Verdict

Per-component, graded 1–10, with confidence.

| Component | Grade | Confidence | Judgement |
|---|---|---|---|
| `question-resolver.ts` (V3, §12.1) | **8** | high | Genuinely engineered. Written against a numbered spec, non-negotiable priority ladder, explicit guards for the exact failure modes real STT produces, refuses to clean manual input on principle. Correctly scoped to the surfaces that receive unresolved speech; it is not the module WTA should be calling. |
| Supersession / snapshot / cancellation (`turnIdentity.ts`, `whatToAnswerRequestSnapshot.ts`, `triggerGate.ts`, generationId) | **8** | high | Small, pure, tested, correct. `triggerGate.ts` is 42 lines with a 15-line comment explaining a real P0. This is the best code in the subsystem. |
| `resolveCanonicalTurn.ts` | **6** | high | Sound design (freeze once, one try/catch for all consumers, explicit precedence with a stated rule). Undermined by a vacuous test on its headline rule (M5) and by being *additional to* rather than *replacing* `_wtaPlan`. |
| `transcriptCleaner.ts` | **3** | high | Two hand-maintained token sets (36 tokens) with a mid-sentence exemption list. Lowercases everything with no test and no comment. Destroys `?` on tag questions (F-4). |
| `transcriptQuestionExtractor.ts` | **4** | high | This is the actual selector on the shipping path and it is the weakest link. **12 hand-written regexes + 2 stopword sets** in the selection path: `GREETING_ONLY`, `SOCIAL_PLEASANTRY` (~380 chars, 9 alternations of literal small-talk topics), `INTERROGATIVE_LEAD`, `WEAK`/`STRONG_FOLLOW_UP_MARKERS`, `DEMONSTRATIVE_FOLLOW_UP`, `INTRO_IDIOM`, 10 `classifyType` families, `CAPITALIZED_STOPWORDS` (44 entries), `FOLLOW_UP_WORD_CAP = 14`. Every threshold (0.4/0.7/0.8/0.95/0.6/0.75, 14 words, 12 chars, 5 chars, 3 words) is a bare literal. Just outside any of them the behaviour is a cliff, and F-3/F-4/F-6 are those cliffs. |
| `IntelligenceEngine.runWhatShouldISay` (WTA orchestration, ~1700 lines) | **3** | high | Four question derivations, two `planAnswer` calls with different inputs, in-place mutation of the extraction result, `var`-hoisting to escape try-scopes (with comments documenting that the previous `const` silently disabled governance **twice**), and dead paths (speculative prefetch, `handleSuggestionTrigger`) still wired. |
| **Subsystem overall** | **4.5 / 10** | high | |

**Engineered or vibe-coded?** Neither, cleanly — and the honest answer is more specific than the question.

The **contract layers are engineered**. `question-resolver.ts`, `resolveCanonicalTurn.ts`, `questionNeed.ts`, the V3 orchestrator and the source-authority kernel are written against numbered specs on disk (`docs/context-rebuild/04_TARGET_ARCHITECTURE.md` §0/§3, `docs/context-os/`, `docs/answer-pipeline-rebuild/`), they state their invariants, they distinguish labels from gates, and they say out loud what they refuse to do. Somebody thought hard about this.

The **selection layer is accreted**, and the git history says so directly. `git log --follow transcriptQuestionExtractor.ts` is a list of forensic patches — `campaign2 fix#5: latest-turn selection ignores question-shape (extraction bug)`, `campaign2 fix#2: split follow-up markers into weak/strong tiers (H3)` — each one a regex added or split after a real trace showed the previous regex misfiring. That is not vibe-coding; it is empirically-driven patching, which is *better* than vibe-coding and *worse* than a spec. The tell is that the comments are excellent and the abstractions never moved: after every fix, the mechanism is still "walk backwards, match regexes, assign a magic-number confidence."

The failure that actually costs the product is **provenance, not implementation**: the primary surface still selects with the accreted extractor, and the moment that output crosses into the engineered layer it is stamped `source:'manual', confidence: 1` (`orchestrator.ts:85`) — two fields that are then never read. So a fragment scored 0.4 by the extractor that produced it is, from V3's perspective, identical to a question the user deliberately typed. The good contracts are downstream of the weak selector and are given no signal that would let them defend against it. Nothing in the test suite can see this, because no test asserts *which* question was selected.

(The genuinely-orphaned-module pattern `conversation-state-store.ts:6-11` describes — *"shipped complete and tested with ZERO production callers … The module worked; nothing fed it"* — does recur here, but in `questionNeed.ts` and `sessionFollowupResolver.ts`, not in `question-resolver.ts`, which has a caller and a correct scope.)

**What would have to be true for the grade to rise:**

1. **8+:** One selector for WTA, built to `question-resolver.ts`'s standard (recency window, answerability floor, abandoned/echo guards, no lowercasing) and run on *raw* turns before cleaning; `_wtaQ` deleted in favour of the canonical turn's question; the selection's real confidence and provenance carried into `AnswerRequest` instead of being flattened to `manual/1.0` and discarded; and one test asserting every downstream consumer reads the same string.
2. **7:** F-1, F-3, F-4, F-5, F-6 fixed, with a regression test each. Specifically: an answerability floor before a turn can become the question; stop lowercasing; keep the trailing `?` before stripping "right"; make the raw-turn lookup key `(timestamp, role)`.
3. **6:** M5's vacuity closed — the precedence suite must contain the `doc_question` vs `general` disagreement case, or the rule should be deleted as untestable. `questionNeed.ts` and `sessionFollowupResolver.ts` either wired or removed with their tests.
4. **5.5:** A case matrix that asserts *which question was selected* (not answer quality) over realistic STT input — no punctuation, no capitals, stutters, overlapping speech, timestamp collisions, tag questions, multi-part turns. None of the existing benchmarks test selection.
5. Independent of grade: delete the speculative pre-fetch or reconnect `handleSuggestionTrigger`. Today it burns a full generation per interviewer partial and throws the result away. If it is reconnected, replace Jaccard first — F-10 shows it reuses the Levee answer for the Tinroof question at exactly the gate value.
