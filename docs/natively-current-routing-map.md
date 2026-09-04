# Natively current routing map, 2026-09-04

Phase 1 deliverable. This describes the path a turn actually takes today, derived from the code on branch `feat/extension-system` at commit `330717e5`. It is not derived from the campaign brief. Where the two disagree, this document records the code.

## The one thing to take away

The intent classifier is not the router. It never was.

Of the eleven axes the proposed `IntentFrame` carries, the classifier influences two, and owns neither outright. Almost every axis already has a named owner somewhere else in the codebase, and several of those owners describe themselves in their own headers as the canonical authority for that decision. A router that re-decides those axes will be a second opinion that the integration in PR 7 then has to reconcile against the first.

The real gap is not that the decisions are missing. It is that they are made in eight different places, at different times in the turn, by different mechanisms, and nothing carries them together.

## Axis to current owner

This is the table the later phases need. For each proposed `IntentFrame` axis, the single place that decides it today.

| IntentFrame axis | Decided today by | Mechanism | Notes |
|---|---|---|---|
| `dialogue_act` | nothing | not represented | No code anywhere assigns a dialogue act. The closest proxy is question extraction in `electron/llm/transcriptQuestionExtractor.ts`. |
| `needs_response` | the cloud LLM | prompt instruction | Every mode prompt carries a numbered decision hierarchy whose last branch is a silence string. Post hoc normalisation in `electron/IntelligenceEngine.ts:4696`. See the silence section. |
| `voice` | the mode prompt | prompt text | Fixed per mode in the `MODE_*_PROMPT` constants and their V2 equivalents. Not a per turn decision except in Lecture, where the prompt itself defines an `[ANSWER THIS]` flip. |
| `task` | `electron/llm/AnswerPlanner.ts` | `AnswerType` union, over 38 values | The classifier's `intent` is one input among many. `intent === 'coding'` is a hard override on the coding branch. |
| `secondary_tasks` | nothing | not representable | `AnswerType` is a single value. `multi_label` is `false` in the classifier. There is no path for a second simultaneous task. |
| `mode_intent` | split | two classifiers | Classifier A's eight labels on the live surface. Classifier B's `IntentType` on the manual knowledge surface. Neither is mode aware. |
| `answer_form` | `AnswerPlanner` plus `validateAnswerStructure` | plan then post hoc validation | The classifier's `answerShape` string is an advisory prompt fragment. The binding decision is the answer type and the structure validator. |
| `grounding` | `electron/llm/turnSourceDecision.ts` | persisted `ModeSourceContract` | Its own header calls it "the canonical AUTHORITY for what sources does this turn consume", read by every answer surface before any retrieval runs. This axis is fully owned and the router must feed it, not replace it. |
| `capabilities.screen` | `electron/llm/visionPolicy.ts` | settings enum plus data scope | Its own header calls it "ONE decision for may this screenshot leave, and where to". Fully owned. |
| `capabilities.web` | `premium/electron/knowledge/IntentClassifier.ts` | `needsCompanyResearch(question) && activeJD` at `KnowledgeOrchestrator.ts:1687` | Owned by classifier B, on the manual surface only, and only when a JD is loaded. The live surface has no web path. |
| `capabilities.retrieval` | `electron/llm/modeHybridEligibility.ts` plus the caller | eligibility predicate plus caller supplied file list | `ModeHybridRetriever.retrieve` takes `files` as a parameter. The retriever does not choose scope. |
| `current_information` | nothing | not represented | No freshness signal exists. The nearest thing is the company research gate above. |
| `confidence` per axis | nothing | not representable | One scalar exists, and it is a hardcoded constant on seven of ten regex rules. |
| `alternatives` | computed then discarded | `mapWorkerResult` reads index 0 only | The model produces a full ranking every call. It is thrown away. |
| `provenance` | nothing | not recorded | Which tier answered is logged but never returned. |

Four axes are unowned and unrepresented today: `dialogue_act`, `secondary_tasks`, `current_information` and per axis confidence. Two axes are strongly owned by modules that assert canonical authority: `grounding` and `capabilities.screen`. The remaining axes are owned, but by the answer planner rather than by anything that could be called a router.

## The live path, input to model

This is the "what to answer" surface, which is the one the classifier serves.

Audio arrives on two channels. The microphone is the user. The system loopback is the other party. Both are transcribed. Provider selection and the STT chain are out of scope here.

Each transcript line becomes a `TranscriptTurn` in `electron/llm/transcriptCleaner.ts:5`. The shape is `{ role, text, timestamp, punctuationSource? }` and `role` is the three value union `'interviewer' | 'user' | 'assistant'`. There is no mode on the turn and no channel on the turn beyond that role.

`cleanTranscript` strips fillers. `sparsifyTranscript` budgets turns with a floor of six for the interviewer role. `formatTranscriptForLLM` at `transcriptCleaner.ts:204` renders each turn as `[INTERVIEWER]: `, `[ME]: ` or `[ASSISTANT]: `. That mapping is unconditional. It does not consult the mode.

`IntelligenceEngine` then runs two things concurrently on the pre-stream path at `:1768` onward. One is `classifyIntent`, kicked as an unawaited promise at `:1794`. The other is mode context retrieval. The classifier receives `question || extractedQuestion.latestQuestion || lastInterviewerTurn`, the prepared transcript string, and the assistant response count. It does not receive the mode, the channel, the app state, or structured history.

The classifier returns `{ intent, confidence, answerShape }`. That is the whole surface.

`planAnswer` in `AnswerPlanner` then resolves an `AnswerType` from many signals, of which the intent is one. `turnSourceDecision` resolves what sources the turn may consume. `visionPolicy` resolves whether a screenshot may be used and where. `TurnPlanner` produces a `QuestionKind` bucket. Retrieval runs against a caller supplied file list. A prompt is composed. The model streams.

Post stream, `validateAnswerStructure` can rewrite the answer, `answerPolish` strips fabricated transcript preambles, and the silence sentinel check runs.

## Prompt composition, and a correction

The brief and several in-repo comments describe the `MODE_*_PROMPT` constants in `electron/llm/prompts.ts` as the live prompt path. That is stale.

`electron/intelligence/intelligenceFlags.ts:699` reads:

```
promptSystemV2: { env: 'NATIVELY_PROMPT_SYSTEM_V2', setting: 'promptSystemV2Enabled', default: true },
```

The default is `true`. The flag is on. The comment forty lines above it at `intelligenceFlags.ts:344` still says "Default OFF everywhere", and `electron/LLMHelper.ts:6078` still says "flag promptSystemV2, default OFF". Both comments are wrong. The live composer is `electron/llm/promptSystemV2.ts`, which builds core plus mode plus action plus optional custom instructions, in that order, so the cacheable prefix comes first.

The consequence for this campaign is that the mode contracts to verify are the V2 ones, and the `MODE_*_PROMPT` constants are the fallback path taken only when the flag is explicitly turned off. Both still exist and both still ship.

## The silence decision, in detail

Brief fault 4 asks whether the silence output is produced by the LLM or by a pre-check. The honest answer is that it is produced by the LLM, and then normalised by code, and the mechanism differs depending on the flag.

On the legacy path, each mode prompt ends its decision hierarchy with an explicit instruction to emit a fixed string. `prompts.ts:1291` for General, `:1414` and `:1618` and `:2048` for other surfaces, `:1833` and `:1867` and `:1891` and `:1938` for the Team Meet capture variants. The strings are `Nothing actionable right now.` and `Nothing to capture right now.`

On the V2 path the model emits a `[[NO_ACTION]]` sentinel instead, referenced at `IntelligenceEngine.ts:373` and `:4001`.

Either way the decision costs a full generation. The model has to receive the assembled prompt, the retrieved evidence and the transcript, and produce tokens, before the system learns that nothing was needed.

There is also a code path that manufactures the sentinel. `IntelligenceEngine.ts:4696` assigns `fullAnswer = 'Nothing actionable right now.'` after a false-no-content-claim discard, explicitly to normalise onto the same sentinel string the prompt produces. So the string in a log does not by itself tell you which mechanism fired.

The share of generations per session ending in a silence string is not measured. Phase 1 changes no behaviour, so nothing was instrumented. An estimate from the code alone would be a guess, and the brief forbids fabricated numbers. This is a founder ask: either opted-in transcripts, or permission to add a counter in a later PR.

## What is already independent

The brief asks which decisions are already independent of each other. Genuinely independent today, in the sense that each is resolved by its own module from its own inputs:

Source grounding is independent. `turnSourceDecision` resolves it from the persisted contract and the explicit switch allowlist, with no reference to intent.

Screen capability is independent. `visionPolicy` resolves it from the settings enum and the data scope, with no reference to intent.

Retrieval eligibility is independent. `modeHybridEligibility` plus the caller's file list decide it.

Tier and provider selection are independent. `ProviderRouter` and the deadline modules own them.

Not independent, and this is the coupling the campaign is right to attack: intent, answer type and answer form are one decision spread across three modules, and the coding branch collapses them entirely. A `coding` intent from a regex rule overrides the answer type, which selects the layer permissions, which decides whether the document grounded pipeline runs at all. One regex match on the word "tree" changes the retrieval policy. That is the strongest argument in the repo for separating the axes.

## Mode is a prior, never a router input

`electron/llm/modeProfiles.ts` is the only place the active mode influences routing. It supplies a fallback answer type for ambiguous turns, per mode, and its own header states the design rule: the mode is a prior, never an override, consulted only on the final classification fallthrough after every explicit pattern has had its chance.

For `technical-interview`, `looking-for-work` and `general` the prior is `NEUTRAL`, meaning no effect.

So the mode reaches routing only as a tiebreak on turns nothing else claimed, and for three of the nine modes it does not reach routing at all. The classifier itself never sees the mode.

## The web capability is a live cross-mode leak

The `capabilities.web` row above understates what is actually there, so it gets its own note.

Web search exists, through `premium/electron/knowledge/TavilySearchProvider.ts`. Its only gate is at `KnowledgeOrchestrator.ts:1687`:

```
if (needsCompanyResearch(question) && this.activeJD) {
```

`needsCompanyResearch` is a substring test against `COMPANY_RESEARCH_PATTERNS` in classifier B. That list includes the bare tokens `company`, `funding`, `reviews`, `competitor` and `competitors`. The second condition is only that a job description happens to be loaded, which persists across sessions and across modes.

The result is that a Sales turn containing the word "company", or a Team Meet turn containing "reviews", triggers an external web search whenever the user still has a JD attached from an earlier interview session. The mode is never consulted. Nothing about a sales call or a standup is checked before the query leaves the machine.

The same capability is unreachable from the live audio surface entirely, in every mode, because classifier B does not run there.

This is the clearest single argument in the repo for `capabilities` being an explicit, mode aware axis rather than an emergent property of a keyword list. It should be treated as a defect in its own right, not only as a routing observation, and it is worth confirming whether the founder wants it fixed ahead of the campaign or as part of PR 7.

## Two surfaces, two classifiers

The live surface runs through `IntelligenceEngine` and classifier A.

The manual knowledge surface runs through `premium/electron/knowledge/KnowledgeOrchestrator.ts` and classifier B, which is a different taxonomy with conversational stickiness and its own web search gate.

These two never consult each other. A question typed into the manual box and the same question heard on the system channel take different classifiers, get different labels, and reach the answer planner by different routes. Any router that replaces only classifier A leaves that asymmetry in place.

## Founder asks arising from this document

Confirm whether classifier B is in scope for the campaign. If it is, PR 8's shim doubles.

Provide opted-in transcripts, or approve a counting PR, so the silence share can be measured rather than estimated.

Confirm the stale comments about the `promptSystemV2` default should be corrected as part of PR 1, or left alone until the campaign touches those files.
