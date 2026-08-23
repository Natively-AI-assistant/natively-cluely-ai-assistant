# Natively Auto Answer V2 — Implementation Specification

## Objective

Rebuild Natively's Auto Answer feature into a robust, low-latency, speaker-aware, question-opportunity pipeline.

The goal is **not** merely to detect `?` or wait 900 ms after an STT final.

The feature must correctly determine:

1. whether the interviewer has actually finished a conversational turn,
2. what the complete interviewer utterance/question is,
3. whether it is an answerable question rather than normal speech, social chatter, a rhetorical question, a pause request, or a backchannel,
4. whether it is a new question or a revision/continuation of an existing question,
5. when it is safe to dispatch an answer,
6. whether an answer is already running for the same semantic question,
7. whether a speculative answer can be reused instead of regenerated.

The resulting architecture should resemble:

```text
STT partial/final events
        ↓
AutoAnswerTurnManager
        ↓
question/utterance reconstruction
        ↓
LiveTranscriptBrain / transcriptQuestionExtractor
        ↓
answer-opportunity decision
        ↓
deduplication + state machine + queue
        ↓
speculative answer reuse / fresh answer
        ↓
What-To-Answer
```

Do NOT throw away the existing transcript intelligence. Reuse it and make Auto Answer a first-class consumer of it.

---

# 1. Important repository facts

Current main already contains:

- `electron/SessionTracker.ts`
- `electron/IntelligenceManager.ts`
- `electron/IntelligenceEngine.ts`
- `electron/llm/transcriptQuestionExtractor.ts`
- `electron/llm/questionShapes.ts`
- `electron/llm/IntentClassifier.ts`
- `electron/intelligence/LiveTranscriptBrain.ts`
- `electron/intelligence/autoAnswerGate.ts`

PR #497 currently wires Auto Answer by:

```ts
if (segment.isFinal && speaker === 'interviewer') {
    this.scheduleAutoAnswer();
}
```

and eventually calls:

```ts
this.intelligenceManager.handleSuggestionTrigger({
    context: this.intelligenceManager.getFormattedContext(120),
    lastQuestion,
    confidence: 0.9,
});
```

This is insufficient.

`segment.isFinal` means an STT segment is finalized; it does NOT necessarily mean the complete utterance/thought is finished. Deepgram's own streaming docs explicitly distinguish `is_final` from `speech_final`, and state that multiple finalized segments can belong to one utterance.

Also, Pluely's current public Auto Response documentation describes the desired product behavior closely: local question detection even without question marks, waiting for a real quiet window, skipping short remarks, deduplicating repeated questions, and queueing responses rather than overlapping them.

---

# 2. Do not solve this by adding more debounce

Do NOT simply change:

```ts
AUTO_ANSWER_DEBOUNCE_MS = 900
```

to another number and call the feature fixed.

The debounce is only one signal.

We need to distinguish:

```text
STT segment final
speech endpoint
utterance endpoint
semantic thought completion
answer opportunity
```

These are different concepts.

---

# 3. New architecture

Create a dedicated Auto Answer subsystem:

```text
electron/intelligence/autoAnswer/
    AutoAnswerTurnManager.ts
    AutoAnswerDetector.ts
    AutoAnswerDecision.ts
    AutoAnswerQuestion.ts
    AutoAnswerQueue.ts
    AutoAnswerTypes.ts
```

Do not put all logic in `AppState`.

`AppState` should own wiring/lifecycle only.

`IntelligenceEngine` should own generation/answering only.

The new Auto Answer subsystem should own:

- turn accumulation,
- endpoint reasoning,
- question reconstruction,
- answerability,
- deduplication,
- question identity,
- queueing,
- trigger decisions.

---

# 4. Create `AutoAnswerTypes.ts`

Define:

```ts
export type AutoAnswerState =
    | 'idle'
    | 'listening'
    | 'possible_question'
    | 'question_complete'
    | 'speculating'
    | 'queued'
    | 'answering';

export type AutoAnswerDialogueAct =
    | 'answerable_question'
    | 'follow_up_question'
    | 'coding_question'
    | 'behavioral_question'
    | 'technical_question'
    | 'general_question'
    | 'statement'
    | 'backchannel'
    | 'social'
    | 'rhetorical'
    | 'pause_request'
    | 'confirmation'
    | 'incomplete';

export type AutoAnswerEndpointSource =
    | 'provider'
    | 'speech_final'
    | 'utterance_end'
    | 'vad'
    | 'quiet_window'
    | 'semantic';

export interface AutoAnswerQuestion {
    id: string;
    text: string;

    confidence: number;
    answerability: number;
    completionConfidence: number;

    dialogueAct: AutoAnswerDialogueAct;

    isFollowUp: boolean;
    followUpTarget: string;

    startedAt: number;
    lastUpdatedAt: number;
    committedAt?: number;

    endpointSource?: AutoAnswerEndpointSource;

    sourceSegments: number[];
}

export interface AutoAnswerDecision {
    action:
        | 'ignore'
        | 'wait'
        | 'speculate'
        | 'answer'
        | 'queue';

    reason: string;

    question?: AutoAnswerQuestion;
}
```

Use a stable `id` per conversational question, not the raw question string.

---

# 5. Create `AutoAnswerTurnManager.ts`

This is the most important new component.

Responsibilities:

### Input

It receives every interviewer transcript event:

```ts
ingest(segment)
```

including both:

```text
final
partial
```

when available.

Also expose:

```ts
onSpeechStarted(timestamp)
onSpeechEnded(timestamp)
onProviderEndpoint(timestamp)
```

where the STT provider supports them.

### Internal state

Maintain:

```ts
currentCandidateText: string
currentCandidateSegments: TranscriptSegment[]
currentCandidateStartedAt: number
lastSpeechAt: number
lastTranscriptUpdateAt: number
lastEndpointAt: number
```

Also:

```ts
candidateGeneration: number
```

Every meaningful revision increments generation.

---

# 6. Reconstruct complete utterances

Never treat each `isFinal` segment as an independent Auto Answer candidate.

Example:

```text
final:
"What was the hardest"

final:
"technical problem"

final:
"you had to solve?"
```

must become:

```text
"What was the hardest technical problem you had to solve?"
```

before a question is committed.

Deepgram explicitly documents the need to concatenate finalized segments until the utterance endpoint.

Build a provider-independent normalized event interface if necessary:

```ts
interface TranscriptEndpointEvent {
    type:
        | 'segment_final'
        | 'speech_final'
        | 'utterance_end'
        | 'speech_started'
        | 'partial';

    timestamp: number;
}
```

Do not make Auto Answer depend directly on Deepgram-specific names.

---

# 7. Provider endpoint integration

Inspect all existing STT providers and normalize their endpoint signals.

Where available, capture:

- Deepgram `speech_final`
- Deepgram `UtteranceEnd`
- provider speech-started events
- provider-specific end-of-utterance events

Deepgram documents `speech_final` as the utterance-end signal and recommends combining endpointing with interim results. It also recommends reconstructing complete utterances from `is_final` chunks rather than treating `is_final` alone as the full utterance.

Do not require every provider to support every signal.

Auto Answer should work with degraded signals.

---

# 8. Add adaptive quiet-window endpointing

Do not hardcode one global Auto Answer delay.

Create:

```ts
export type AutoAnswerPace =
    | 'fast'
    | 'balanced'
    | 'relaxed';
```

Initial defaults:

```ts
FAST = 700
BALANCED = 1100
RELAXED = 1800
```

These are starting points only.

Make them constants.

The endpoint timer should:

1. start when meaningful interviewer speech stops,
2. restart when new interviewer speech/partial arrives,
3. commit only when the timer expires AND semantic checks do not strongly indicate incompleteness.

Pluely currently exposes roughly 1s / 1.5s / 2.5s pacing and explicitly waits for a real quiet window before responding. Use this only as a product benchmark, not as an implementation dependency.

Keep Natively's defaults slightly more latency-sensitive because this is interview assistance.

---

# 9. Create `AutoAnswerDetector.ts`

The detector should NOT directly call the answer LLM.

It should answer:

```text
What did the interviewer just ask?
Is it actually an answer opportunity?
How confident are we?
Should we wait?
```

Signature:

```ts
detect(params: {
    currentQuestionCandidate: string;
    recentTurns: TranscriptContextItem[];
    endpointSource?: AutoAnswerEndpointSource;
    punctuationSource?: string;
}): AutoAnswerDecision
```

---

# 10. Reuse `transcriptQuestionExtractor.ts`

Do NOT duplicate all the regex logic.

The repository already has a sophisticated extractor handling:

- explicit question marks,
- interrogative leads,
- imperative asks,
- punctuation-unavailable providers,
- follow-ups,
- social pleasantries,
- pause requests,
- answerability,
- question type.

Use:

```ts
extractLatestQuestion(...)
```

as the canonical deterministic question interpretation layer.

Do not create a competing second question extractor.

Instead, transform its result into the Auto Answer decision model.

For example:

```ts
const extracted = extractLatestQuestion(...);

const questionFeatures = {
    latestQuestion: extracted.latestQuestion,
    questionType: extracted.questionType,
    isFollowUp: extracted.isFollowUp,
    followUpTarget: extracted.followUpTarget,
    confidence: extracted.confidence,
};
```

---

# 11. Use `LiveTranscriptBrain` as the canonical live read surface

Do not use:

```ts
session.getLastInterviewerTurn()
```

as the primary Auto Answer question source.

Use the existing:

```ts
LiveTranscriptBrain
```

and specifically:

```ts
getCurrentQuestion()
getHotWindow()
getLiveAnswerContext()
```

where appropriate.

The purpose is to have exactly one canonical interpretation of the current interviewer question across WTA and Auto Answer.

If the existing `LiveTranscriptBrain` constructor/dependency injection is awkward, refactor minimally so Auto Answer can depend on it without creating circular dependencies.

Do NOT create another parallel transcript interpretation service.

---

# 12. Introduce explicit answerability scoring

Do not use a binary `isQuestion`.

Create these scores:

```ts
questionConfidence
completionConfidence
answerability
```

The answerability score should combine:

```text
question shape
+ question extractor confidence
+ endpoint confidence
+ dialogue context
+ interviewer-directedness
+ question type
- social chatter
- rhetorical likelihood
- pause request likelihood
- incompleteness
```

Initial policy:

```text
>= 0.85
    answer/speculate

0.65–0.849
    wait for additional evidence

< 0.65
    ignore
```

Do not treat these as statistically calibrated probabilities yet.

Put them behind constants so they can be tuned later.

---

# 13. Remove the hardcoded `confidence: 0.9`

In current Auto Answer wiring, do not do:

```ts
confidence: 0.9
```

Instead:

```ts
confidence: decision.question.confidence
```

and propagate:

```ts
answerability
completionConfidence
dialogueAct
```

where useful.

A final interviewer statement such as:

```text
"Interesting."
```

must not enter the planner as a fake `0.9` confidence question.

---

# 14. Add a lightweight ambiguity classifier

Do not call a cloud LLM to decide whether something is a question.

The first layer must stay local and cheap.

For ambiguous cases only, add a small local classifier with labels:

```text
question
statement
backchannel
rhetorical
incomplete
pause_request
social
```

Reuse the existing ONNX infrastructure in `IntentClassifier.ts` rather than introducing an entirely separate heavyweight runtime.

If the local model cannot load, gracefully fall back to deterministic heuristics.

Never make Auto Answer unavailable because the classifier asset is missing.

---

# 15. Do NOT immediately fine-tune or download a new model

For this implementation pass:

1. build the deterministic/stateful system,
2. build the replay harness,
3. collect evaluation data,
4. measure failure modes,
5. only then decide whether a dedicated turn model is necessary.

Do not add a new model dependency merely because it sounds theoretically better.

The architecture must work extremely well without it.

---

# 16. Question opportunity classes

Map the detected turn into:

```ts
answerable_question
follow_up_question
coding_question
behavioral_question
technical_question
general_question
statement
backchannel
social
rhetorical
pause_request
confirmation
incomplete
```

Examples:

```text
"Tell me about your last project."
→ answerable_question / behavioral_question

"How would you scale that?"
→ answerable_question / technical_question

"Interesting."
→ statement

"Give me one second."
→ pause_request

"Can you hear me?"
→ confirmation

"Wouldn't that be nice?"
→ rhetorical

"How would you..."
→ incomplete

"Yeah, exactly."
→ backchannel
```

---

# 17. Add interviewer-directedness

The system must estimate:

```ts
directedAtCandidate: number
```

Signals:

- interviewer speaker identity,
- second-person pronouns,
- candidate-directed imperatives,
- conversational position after candidate speech,
- known interview question patterns,
- follow-up relationship.

Do not answer generic interviewer exposition.

Example:

```text
"Companies often use Kafka when..."
```

should not trigger.

Whereas:

```text
"Why did you choose Kafka?"
```

should.

---

# 18. Build a state machine

The Auto Answer state machine should be explicit:

```text
IDLE
 ↓
LISTENING
 ↓
POSSIBLE_QUESTION
 ↓
QUESTION_COMPLETE
 ↓
SPECULATING
 ↓
ANSWERING
```

Allow:

```text
POSSIBLE_QUESTION → LISTENING
QUESTION_COMPLETE → POSSIBLE_QUESTION
SPECULATING → POSSIBLE_QUESTION
ANSWERING → QUEUED
```

based on new transcript evidence.

Every question candidate must have a generation number.

New transcript evidence must invalidate stale speculation.

---

# 19. Speculative generation

Use the existing speculative What-to-Answer infrastructure.

Do NOT duplicate answer generation.

When the question becomes highly likely but not yet fully committed:

```text
questionConfidence >= speculativeThreshold
```

allow speculative preparation:

```text
profile retrieval
context assembly
prompt preparation
answer generation
```

but do not emit/commit the answer yet.

Suggested initial speculative threshold:

```ts
SPECULATION_THRESHOLD = 0.82
```

Commit threshold:

```ts
ANSWER_THRESHOLD = 0.88
```

If new transcript text changes the question:

```text
cancel stale generation
increment candidate generation
replace speculative candidate
```

---

# 20. Question IDs

Every committed candidate gets:

```ts
questionId
```

Use a meeting-local sequence plus generation:

```text
meetingGeneration-questionSequence
```

Example:

```text
42-q17
```

Do not use the raw question text as identity.

The same question can be revised by additional transcript tokens.

---

# 21. Semantic question deduplication

Current exact-string logic such as:

```ts
question === lastAnsweredQuestion
```

is necessary but insufficient.

Add three layers:

### Layer 1
normalized string equality

### Layer 2
token similarity / Jaccard

### Layer 3
optional lightweight embedding similarity for ambiguous pairs

Examples that should generally deduplicate:

```text
"What was your hardest technical problem?"

"What was the most difficult technical challenge you faced?"
```

Do not embed every transcript turn.

Only embed candidates that survive the cheap filters.

---

# 22. Answer queue

Create:

```ts
AutoAnswerQueue
```

with:

```ts
enqueue(question)
dequeue()
replace(questionId, question)
remove(questionId)
peek()
```

Rules:

1. never run two Auto Answers concurrently,
2. a newer revision of the same question replaces the old candidate,
3. a genuinely new question can queue,
4. stale questions are discarded,
5. if the user manually triggers What-to-Answer, manual behavior takes priority,
6. manual answer generation must not be killed by an automatic trigger.

This last requirement preserves the reason `canAutoAnswer()` was added in PR #497.

Pluely publicly describes the desired non-overlapping behavior: if a new trigger arrives while an answer is streaming, it queues rather than running in parallel.

---

# 23. Manual-answer precedence

The current `canAutoAnswer()` mode/cooldown logic is valuable.

Keep it, but move its semantic purpose into the new policy layer.

Rules:

```text
manual answer currently streaming
    → do not start automatic answer

automatic answer currently streaming
    → new real question may queue

meeting stopped
    → cancel timers, speculation, queue

meeting restarted
    → clear stale candidates
```

Do not let Auto Answer supersede an answer explicitly requested by the user.

---

# 24. Replace the current AppState trigger

Current pattern:

```ts
if (segment.isFinal && speaker === 'interviewer') {
    this.scheduleAutoAnswer();
}
```

must be replaced.

New pattern:

```ts
if (speaker === 'interviewer') {
    this.autoAnswerController.ingestTranscript(segment);
}
```

The controller decides whether anything should happen.

`AppState` should not know about:

- question confidence,
- regexes,
- queue policy,
- deduplication,
- endpoint scoring.

---

# 25. AppState integration

In `AppState`:

### Add

```ts
private autoAnswerController: AutoAnswerController | null = null;
```

Initialize it once.

Inject dependencies:

```ts
session
liveTranscriptBrain
intelligenceManager
```

and a clock/timer abstraction for tests if practical.

Replace:

```text scheduleAutoAnswer()
cancelAutoAnswer()
```

with controller lifecycle methods.

AppState should provide:

```ts
onMeetingStart()
onMeetingStop()
onTranscript(segment)
onSpeechStarted()
onSpeechEnded()
onProviderEndpoint()
```

---

# 26. Keep `IntelligenceEngine.handleSuggestionTrigger()`

Do not delete the existing suggestion generation path.

The new Auto Answer system should eventually call it only after the question has passed the Auto Answer policy.

However, extend the trigger type if necessary so it can carry:

```ts
{
    questionId,
    question,
    confidence,
    answerability,
    dialogueAct,
    isFollowUp,
    endpointSource
}
```

Do not break existing manual callers.

Make new fields optional for backwards compatibility.

---

# 27. Use `LiveTranscriptBrain.getLiveAnswerContext()`

When committing the automatic answer, prefer one canonical snapshot:

```ts
const answerContext =
    liveTranscriptBrain.getLiveAnswerContext(180);
```

Use:

```text
window
currentQuestion
questionType
isFollowUp
rollingSummary
```

instead of independently reconstructing them from several subsystems.

This prevents race conditions where the question detector and answer generator see different transcript states.

---

# 28. Generation guards

Every speculative/automatic answer must carry:

```ts
questionId
candidateGeneration
meetingGeneration
```

Before emitting/committing answer output verify:

```text
meeting is still active
questionId is still current
candidateGeneration still matches
mode is compatible
```

If any guard fails:

```text
abort/ignore stale result
```

This is more robust than only comparing question strings.

---

# 29. Telemetry

Add Auto Answer-specific structured telemetry.

Do NOT log full transcript text by default.

Record:

```text
auto_answer_candidate
auto_answer_endpoint
auto_answer_decision
auto_answer_ignored
auto_answer_speculative
auto_answer_committed
auto_answer_queued
auto_answer_deduplicated
auto_answer_cancelled
auto_answer_completed
```

Fields:

```text
meeting generation
question id
provider
question type
dialogue act
question confidence
completion confidence
answerability
endpoint source
candidate word count
time from last speech to decision
time from decision to first answer token
queue depth
skip reason
```

Sensitive transcript content must not be included in normal telemetry.

---

# 30. Skip reasons must be explicit

Never silently drop without a machine-readable reason.

Use:

```ts
type AutoAnswerSkipReason =
    | 'disabled'
    | 'meeting_inactive'
    | 'not_interviewer'
    | 'incomplete'
    | 'not_question'
    | 'social'
    | 'backchannel'
    | 'rhetorical'
    | 'pause_request'
    | 'low_answerability'
    | 'duplicate'
    | 'manual_answer_active'
    | 'cooldown'
    | 'stale_generation'
    | 'queue_full'
```

These reasons must be visible in verbose/debug logging and test outputs.

---

# 31. Replay/evaluation harness

Create:

```text
electron/intelligence/autoAnswer/__tests__/fixtures/
```

and:

```text
electron/intelligence/autoAnswer/__tests__/AutoAnswerReplay.test.mjs
```

Build a replay format:

```json
{
  "name": "fragmented_behavioral_question",
  "events": [
    {
      "at": 0,
      "speaker": "interviewer",
      "final": false,
      "text": "Tell me about the hardest"
    },
    {
      "at": 450,
      "speaker": "interviewer",
      "final": true,
      "text": "Tell me about the hardest"
    },
    {
      "at": 900,
      "speaker": "interviewer",
      "final": true,
      "text": "technical problem"
    },
    {
      "at": 1400,
      "speaker": "interviewer",
      "final": true,
      "text": "you solved?"
    }
  ]
}
```

Expected:

```json
{
  "shouldAnswer": true,
  "question": "Tell me about the hardest technical problem you solved?"
}
```

---

# 32. Required adversarial tests

Create tests for all of the following.

## Positive

```text
Tell me about your last project.

Walk me through the architecture.

Why did you choose PostgreSQL?

How would you scale this to ten million users?

Tell me about a time you disagreed with your manager.

Going back to what you mentioned earlier, why did you choose Kafka?

One more question — tell me about your biggest failure.

Solve this using a hash map.
```

## Fragmented positive

```text
What was the hardest
technical problem
you had to solve?
```

must trigger once, not three times.

## No punctuation

```text
how would you design this system
```

must trigger when punctuation provenance is unavailable.

## Negative

```text
Interesting.

Okay.

Yeah, exactly.

That makes sense.

Give me one second.

Let me think.

I think that's the main reason.

We usually use Kafka.

Wouldn't that be nice?

Can you hear me?
```

must not produce a normal generated interview answer.

## Continuation

```text
How would you design
...
the system if traffic increased 100x?
```

must not answer after the first fragment.

## Dedup

```text
What was your hardest technical problem?

What was the most difficult technical problem you faced?
```

should generally result in one answer.

## Follow-up

```text
Why did you choose Redis?

Candidate answers.

And why?
```

must detect the second question as a follow-up.

## Question followed by continued speech

```text
How would you scale this if...
Actually, before that, let me give you some context...
```

must not prematurely answer.

## Manual precedence

Start Auto Answer speculation, then manually trigger What-to-Answer.

Manual answer must win.

## Stop/restart

Stop the meeting while an Auto Answer timer or generation is pending.

No stale answer may appear after stop.

Restart meeting.

Old question must not leak into the new meeting.

---

# 33. Add a deterministic fake clock where necessary

Timer-heavy code is difficult to test.

Prefer injecting:

```ts
interface Clock {
    now(): number;
    setTimeout(...): Timer;
    clearTimeout(...): void;
}
```

or use the repository's existing timer/test infrastructure if one exists.

Do not make tests depend on real 900/1100/1800 ms sleeps.

---

# 34. Test invariants, not implementation details

Important invariants:

1. A single conversational question generates at most one Auto Answer.
2. A finalized segment alone never guarantees an answer.
3. A question can span multiple finalized segments.
4. New transcript evidence can invalidate an incomplete candidate.
5. A stop event invalidates all pending work.
6. Manual answer has priority over automatic answer.
7. Two Auto Answers never stream concurrently.
8. Duplicate questions do not create duplicate answers.
9. Social/backchannel speech does not trigger.
10. Punctuation absence does not automatically make a real question invisible.
11. Provider differences do not change high-level Auto Answer semantics.

---

# 35. Add benchmark metrics

Create an offline evaluator that reports:

```text
question_precision
question_recall
answer_opportunity_precision
answer_opportunity_recall
false_trigger_rate
duplicate_trigger_rate
premature_trigger_rate
question_reconstruction_accuracy
median_endpoint_to_decision_ms
p95_endpoint_to_decision_ms
median_decision_to_first_token_ms
```

Prioritize:

```text
false_trigger_rate
premature_trigger_rate
```

over maximizing raw recall.

The product should prefer missing an occasional question over confidently answering something that was not a question.

---

# 36. Do not add a huge LLM classifier

The question gate must remain local and cheap.

Do NOT implement:

```text
every transcript
    ↓
Gemini/GPT
    ↓
"is this a question?"
```

Cloud LLM calls are for answer generation, not turn detection.

Use:

```text
deterministic heuristics
+
existing local question extractor
+
optional tiny local model for ambiguity
```

---

# 37. Future-ready architecture for a learned turn predictor

Do not implement a new neural turn-prediction model in this PR unless the repository already has a suitable runtime/model.

But design the interfaces so that later we can add:

```ts
interface TurnPredictor {
    predict(input: {
        partialTranscript: string;
        recentTranscript: TranscriptContextItem[];
        speechDurationMs: number;
        silenceMs: number;
    }): {
        pContinuation: number;
        pEndpoint: number;
        pQuestionComplete: number;
        estimatedRemainingSpeechMs?: number;
    };
}
```

The controller should be able to use this later without rewriting the rest of the system.

This is important because modern endpointing research increasingly treats turn completion as a prediction problem, not simply a fixed silence threshold.

---

# 38. Keep deterministic rules as fallback

If the learned classifier fails:

```text
Auto Answer must still work.
```

Fallback ordering:

```text
provider endpoint
+
deterministic question extractor
+
quiet window
```

must be enough to produce a reasonable answer.

Never make Auto Answer dependent on a model asset that can fail to load.

---

# 39. Preserve backwards compatibility

Do not break:

- manual What-to-Answer
- speculative WTA
- existing planner
- existing transcript storage
- existing mode system
- existing session lifecycle
- existing STT providers
- existing `autoAnswerGate.ts` tests unless superseded by better tests

Refactor rather than duplicate.

---

# 40. `autoAnswerGate.ts`

Do not blindly delete the current file.

Either:

1. evolve it into the final policy layer, or
2. replace it with a more capable `AutoAnswerPolicy.ts`.

The pure decision function is valuable and should remain pure/testable.

It should eventually accept something like:

```ts
interface AutoAnswerPolicyInput {
    enabled: boolean;
    meetingActive: boolean;
    generationValid: boolean;

    question: AutoAnswerQuestion | null;

    engineAccepting: boolean;
    manualAnswerActive: boolean;

    duplicate: boolean;
    queueDepth: number;
}
```

and return:

```ts
{
    action:
        | 'ignore'
        | 'wait'
        | 'speculate'
        | 'answer'
        | 'queue';

    reason: string;
}
```

---

# 41. Do not hardcode a universal 900 ms trigger anymore

The old:

```ts
AUTO_ANSWER_DEBOUNCE_MS = 900
```

should no longer be the primary decision mechanism.

It may remain as a balanced quiet-window default, but the actual decision must combine:

```text
new speech?
final transcript?
provider endpoint?
silence duration?
semantic completeness?
question confidence?
answerability?
duplicate?
current answer state?
```

---

# 42. Exact AppState behavior

The interviewer transcript path should conceptually become:

```ts
if (speaker === 'interviewer') {
    this.autoAnswerController?.ingest(segment);
}
```

When controller decides:

```ts
const decision = controller.evaluate();
```

then:

```ts
if (decision.action === 'speculate') {
    intelligenceManager.startSpeculativeWhatToAnswer(...)
}

if (decision.action === 'answer') {
    intelligenceManager.handleSuggestionTrigger(...)
}

if (decision.action === 'queue') {
    controller.enqueue(...)
}
```

Do not directly invoke generation from the transcript event callback.

---

# 43. Exact IntelligenceManager additions

Add narrow APIs such as:

```ts
getLiveAnswerContext()
getLastInterviewerTurn()
canAutoAnswer()
```

where already appropriate.

Add:

```ts
getAutoAnswerContext()
```

only if the existing APIs are insufficient.

Do not expose internal `SessionTracker` state broadly.

---

# 44. Exact IntelligenceEngine additions

Add an internal method if needed:

```ts
runAutoAnswer(question: AutoAnswerQuestion)
```

which delegates to existing WTA generation.

It should not create a separate generation stack.

It should:

1. verify meeting/mode state,
2. verify question generation,
3. reuse speculative answer if compatible,
4. otherwise invoke `runWhatShouldISay`,
5. record question identity,
6. update deduplication state.

---

# 45. Speculative reuse

Current speculative answer reuse uses similarity matching.

Keep that.

Improve the key from:

```text question string similarity
```

to:

```text questionId / candidateGeneration
+
semantic similarity
```

A speculative answer generated for:

```text
"What was the hardest technical problem..."
```

should be reusable when the final becomes:

```text
"What was the hardest technical problem you solved?"
```

if the semantic identity is clearly the same.

---

# 46. Avoid stale-question answers

Before committing any automatic answer, verify:

```text
current meeting generation
==
candidate meeting generation

current question id
==
answer question id

candidate generation
==
answer generation
```

If not:

```text
drop output silently
```

This is mandatory.

The worst Auto Answer failure is:

> interviewer asks Q2, Natively answers Q1.

---

# 47. UI

Do not redesign the UI in this pass.

Only expose useful state if existing UI infrastructure permits it:

```text
Auto Answer: Listening
Auto Answer: Waiting
Auto Answer: Answering
```

Do not create a noisy UI.

The internal telemetry is more important.

---

# 48. Validation workflow

Before finalizing:

1. run all Auto Answer unit tests,
2. run transcript extractor tests,
3. run IntelligenceEngine planner tests,
4. run the full test suite,
5. run renderer/electron typechecking,
6. run production build,
7. run replay fixtures,
8. inspect for regressions in manual WTA,
9. test at least one streaming STT provider live.

Do not claim the live wiring is verified unless it was actually exercised.

---

# 49. Acceptance criteria

The implementation is considered successful only if all of the following are true.

### False positives

These do not trigger a generated answer:

```text
Interesting.
Okay.
Yeah.
Sounds good.
Give me one second.
Let me think.
That's interesting.
I think that's right.
Wouldn't that be nice?
Can you hear me?
```

### Positives

These do trigger:

```text
Tell me about your projects.
Walk me through your architecture.
Why did you choose PostgreSQL?
How would you scale this?
Tell me about a time you disagreed with a manager.
Going back to what you mentioned earlier, why did you choose Kafka?
```

### Fragmentation

A question spanning multiple final STT segments generates exactly one answer.

### Incompleteness

The system does not answer:

```text
How would you...
```

until the question is completed.

### Continuation

If the interviewer resumes speech during the quiet window, the pending automatic answer is cancelled/revised.

### Deduplication

Repeated versions of the same question do not create multiple answers.

### Queueing

A second genuine question does not cause two concurrent answer streams.

### Manual priority

A manual What-to-Answer request cannot be killed by a concurrent auto trigger.

### Lifecycle

Meeting stop cancels timers, speculation, and queue entries.

Meeting restart starts clean.

### Latency

Measure rather than guess. The system should add as little latency beyond the true end of interviewer speech as possible.

---

# 50. Important implementation principle

Do not rewrite large unrelated portions of Natively.

Make the smallest architectural change that creates this pipeline:

```text
STT event
   ↓
AutoAnswerController
   ↓
TurnManager
   ↓
LiveTranscriptBrain
   ↓
QuestionExtractor
   ↓
AnswerabilityPolicy
   ↓
Queue/Dedup
   ↓
existing WTA generation
```

The current repo already contains most of the intelligence needed. The major problem is that those pieces are currently optimized for manual WTA/speculative WTA and are not composed into a single Auto Answer decision engine.

---

# 51. Deliverables expected from Codex

Implement:

```text
electron/intelligence/autoAnswer/AutoAnswerTypes.ts
electron/intelligence/autoAnswer/AutoAnswerTurnManager.ts
electron/intelligence/autoAnswer/AutoAnswerDetector.ts
electron/intelligence/autoAnswer/AutoAnswerQueue.ts
```

plus the minimum required modifications to:

```text
electron/main/AppState.ts
electron/IntelligenceManager.ts
electron/IntelligenceEngine.ts
electron/SessionTracker.ts
electron/intelligence/LiveTranscriptBrain.ts
electron/llm/transcriptQuestionExtractor.ts
```

Do not modify unrelated provider/UI files unless endpoint normalization genuinely requires it.

Add tests under:

```text
electron/intelligence/autoAnswer/__tests__/
```

and replay fixtures under:

```text
electron/intelligence/autoAnswer/__tests__/fixtures/
```

---

# 52. Final instruction to Codex

Do not just implement the design mechanically.

First inspect the current `main` branch implementation and existing tests.

Identify exact current call paths for:

```text
AppState transcript ingestion
SessionTracker
IntelligenceManager
IntelligenceEngine.handleSuggestionTrigger
LiveTranscriptBrain
transcriptQuestionExtractor
speculative WTA
manual WTA
```

Then implement the architecture above with minimal disruption.

Before changing any behavior, write down the existing call graph in comments/notes if useful.

Do not duplicate existing functionality.

Reuse existing abstractions wherever they already satisfy the requirement.

The most important product invariant is:

> **Natively must never confidently answer something the interviewer did not actually ask, and it must never answer the previous question after the interviewer has moved to a new one.**

The second most important invariant is:

> **When the interviewer really has asked a question, Natively should recognize and answer it with the minimum possible delay after the actual end of the question.**

Optimize the implementation for those two invariants first.