# Natively modes as implemented, 2026-09-04

Phase 1 deliverable. The campaign brief's mode table, corrected against the code on branch `feat/extension-system` at commit `330717e5`. Where the brief and the code disagree, the code is recorded and the disagreement is named.

## Corrected mode table

The nine built-in templates are enumerated in `electron/services/builtinModes.ts:29` as `BUILTIN_MODE_LABELS`. The tenth row, custom, is not a template. `ModesManager.isCustomMode` at `electron/services/ModesManager.ts:346` defines a custom mode as one whose `templateType` is `general` and whose name is not `General`. A custom mode is therefore a General mode with a different name, not a separate template.

| Mode id | User is | System channel carries | Output voice | Seeded source authority | Silence output |
|---|---|---|---|---|---|
| `general` | anyone | anyone | adapts, by prompt only | `reference_files_primary` | `Nothing actionable right now.` |
| `technical-interview` | candidate | interviewer | first person script | `profile_only` | none |
| `looking-for-work` | candidate | interviewer | first person script | `profile_only` | none |
| `sales` | seller | prospect | first person script | `reference_files_primary` | none |
| `recruiting` | interviewer | candidate | third person observer | `reference_files_primary` | none |
| `team-meet` | participant | others | capture, or first person when called on | `reference_files_primary` | `Nothing to capture right now.` |
| `lecture` | student | professor | study partner, third person | `reference_files_primary` | none |
| `seminar` | presenter | audience or panel | first person presenter | `reference_files_primary` | none |
| `call-center` | agent | customer | first person script | `reference_files_primary` | none |
| custom | per prompt | per prompt | per prompt | `reference_files_primary` | as general |

### Corrections to the brief's table

The brief says General's grounding source is "none by default". That is wrong. `defaultSourceContractForNewMode` in `electron/services/modeSourceContract.ts:275` seeds every template except `looking-for-work` and `technical-interview` with `sourceAuthority: 'reference_files_primary'` and `defaultOwner: 'reference_files'`. General is in that majority. Only the two interview prep modes are seeded `profile_only`.

This inverts the brief's assumption in a way that matters for the router. The proposed per mode `default_grounding` config would be `mode_files` for seven of nine built-ins out of the box, and `profile` for exactly two. The brief's table implies the opposite distribution.

The brief says Technical Interview grounds on "profile for behavioral; screen for problems". The seed is `profile_only`, and `reference_files` was added to its `allowedExplicitSwitches` on 2026-08-28 precisely so a user can opt in. The comment at `modeSourceContract.ts:287` records why: a user attaching reference files to Technical Interview previously got materially weaker retrieval than the same files in General, because half the retrieval window and the whole answerability scoring path are gated on document grounding. The seed was deliberately left alone, on the principle that an upload is not consent and a switch is.

The brief says Lecture "flips to first-person under `[ANSWER THIS]:`". In the code `[ANSWER THIS]` is an output marker the model emits, not an input marker anything reads. `prompts.ts:1963` puts it inside `<student_questions>` as the shape to produce when the lecturer asks the class a question, and `:1997` repeats it in the mode's `<output_contract>` as one of five permitted output shapes. Nothing parses it back. There is no input trigger.

The brief's "Grounding source" column is described as listing defaults. Two of its rows do not match the seeded defaults, so the column should be read as an intent rather than as an observation.

## Per mode detail

### general

Trigger is the default active mode. Prompt is `MODE_GENERAL_PROMPT` at `prompts.ts:1272` on the legacy path, and the `general` mode contract in `promptSystemV2.ts` on the live path.

Adaptive sensing is prompt only. The `<context_sensing>` block at `prompts.ts:1290` lists five scenarios and instructs the model to infer which applies. No code senses the scenario. `modeProfiles.ts` gives General a `NEUTRAL` prior, meaning it contributes nothing to routing. This answers audit question 1 directly. The brief's premise that General "senses" is a prompt instruction with no runtime counterpart, which is exactly why the proposed router needs `mode_intent` to carry a sensed scenario for this mode.

The decision hierarchy at `prompts.ts:1285` is four numbered branches, evaluated by the model. Branch 4 is the silence branch.

The classifier is consulted, on the live surface, exactly as in every other mode.

### technical-interview

Prompt is `MODE_TECHNICAL_INTERVIEW_PROMPT` at `prompts.ts:2026`. It composes `SHARED_CODING_RULES` and `HUMAN_SPOKEN_ANSWER_CONTRACT`.

The six section DSA contract is not in this prompt. It lives in `electron/llm/codingContract.ts` as `CODING_CONTRACT`, `CODING_CONTRACT_TINY` and `CODING_CONTRACT_IMPL`, and it is appended by `promptSystemV2` whenever the caller flags `codingTask`, regardless of mode. The V2 header states this explicitly: a coding question in General, Lecture or a custom mode gets the same contract. So the six section shape is a turn property, not a mode property.

Which contract is chosen is a second decision, and it is only half wired. `promptSystemV2.ts:629` reads `input.codingTaskKind ?? 'dsa'` and picks `CODING_CONTRACT_IMPL` for `'impl'`, otherwise the six section walkthrough. The producer is real: `codingPromptSignals.ts:348` and `:371` resolve `'impl'` from `isBuildTask(question)` and `codingTaskKindFor(answerType, question)`. But four fallback branches hardcode the discriminator to `'dsa'` before the producer runs, at `LLMHelper.ts:3077`, `LLMHelper.ts:6113`, `ipcHandlers.ts:1489` and `WhatToAnswerLLM.ts:282`, and `IntelligenceEngine.ts:3283` defaults to `'dsa'` on promotion. So a build task ("write a React stopwatch") reaching the prompt through any of those branches is handed the DSA interview walkthrough.

This matters for Phase 5. A `coding` label that is correct at the intent layer can still produce the wrong answer shape, so those turns will present as classifier errors in the error analysis when the defect is downstream. That is the "should never have been classified" and "overlapping labels" boundary the brief asks to be categorised, and it needs to be separated from genuine label error before any taxonomy conclusion is drawn.

Enforcement is post hoc as well as prompt side. `validateAnswerStructure` is called at `ipcHandlers.ts:3970` and `IntelligenceEngine.ts:3749`, and can rewrite a streamed answer that does not conform. This is the only answer contract in the product with a post processing enforcer.

Seeded `profile_only`. Contributes `NEUTRAL` to the mode prior.

### looking-for-work

Prompt is `MODE_LOOKING_FOR_WORK_PROMPT` at `prompts.ts:1391`. First person candidate voice.

The no overclaim preamble is prompt side. There is no post processing enforcer for it. The nearest post processing is `electron/llm/profileEvidenceValidator.ts` and `profileOutputValidator.ts`, which validate profile grounded claims, and `sanitizeCandidateAnswer` plus `detectAssistantVoiceMisfire` in the answer polish chain.

Seeded `profile_only`. Contributes `NEUTRAL` to the mode prior.

### sales

Prompt is `MODE_SALES_PROMPT` at `prompts.ts:1596`. First person seller voice.

Contributes `sales_answer` as the mode prior for ambiguous turns, which carries layer permissions that forbid resume, JD and negotiation sources.

### recruiting

Prompt is `MODE_RECRUITING_PROMPT` at `prompts.ts:1713`. The `<mode_definition>` is explicit that the output is third person observation for the interviewer, who is the user, and that the model must not speak as the candidate.

This is where the channel inversion bites, and it is worse than the brief describes.

`TranscriptTurn.role` in `electron/llm/transcriptCleaner.ts:6` is the union `'interviewer' | 'user' | 'assistant'`. `formatTranscriptForLLM` at `:204` maps `interviewer` to the literal label `INTERVIEWER` and `user` to `ME`, unconditionally, with no mode parameter in scope. In Recruiting the person on the system channel is the candidate, and the person on the microphone is the interviewer. So the transcript handed to the model labels the candidate `[INTERVIEWER]` and labels the actual interviewer `[ME]`.

The role vocabulary itself is the problem, not just the label. There is no `user_channel` config anywhere in the codebase. `grep` for the term returns nothing. The system channel is called the interviewer channel at the type level, in every mode.

This also breaks the classifier's tier 3. `detectIntentByContext` at `IntentClassifier.ts:634` filters on `l.includes('[INTERVIEWER')`, so in Recruiting it measures the candidate's turn length and infers a follow up probe from it. The heuristic is not merely mode blind, it is inverted for this mode.

That is the concrete evidence for brief faults 1 and 2, and it confirms the brief's asymmetry warning. The router's `user_channel` config is necessary, and it is not sufficient on its own, because the three value role union and its two hardcoded labels would also have to change.

Contributes `general_meeting_answer` as the mode prior, explicitly including for manual turns, so a recruiting session does not dump the user's own profile.

### team-meet

Prompt is `MODE_TEAM_MEET_PROMPT` at `prompts.ts:1815`. Two jobs, capture and respond, both described in one prompt.

The emoji capture tags are prompt side, defined at `tinyPrompts.ts:221` as clipboard for action items, check for decisions and warning for risks. They are not validated post hoc. They are, however, parsed back out: `electron/llm/ConversationSummarizer.ts:133` matches the clipboard emoji to recover action items. So the tags are a real interchange format between two prompts, held together only by two string literals in different files.

Silence output is `Nothing to capture right now.`, instructed at `prompts.ts:1833`, `:1867`, `:1891` and `:1938`, which is four separate prompt sites for one behaviour.

Contributes `general_meeting_answer` as the mode prior for both live and manual.

### lecture

Prompt is `MODE_LECTURE_PROMPT` at `prompts.ts:1918`. Third person study partner voice.

The `<context_routing>` block at `prompts.ts:1993` states that reference files are primary and that resume and JD must be ignored. That is prompt side. The binding version of the same rule is the seeded `reference_files_primary` authority resolved by `turnSourceDecision`, which is what actually prevents the profile from reaching the prompt.

`<output_contract>` names five permitted output shapes and says never to mix them. None of the five is validated post hoc.

Contributes `lecture_answer` as the mode prior.

### seminar

Prompt is `MODE_SEMINAR_PROMPT` at `prompts.ts:2503`.

The in file and off file citation contract is prompt side and unusually specific. The prompt requires the exact string `This isn't in your reference files — from general knowledge: ` as a prefix for off file answers. Nothing validates that the prefix was emitted, and nothing validates that an answer claimed as on file actually came from a file.

The brief correctly flags that seminar's in file versus off file distinction is provisional at the router. It is worth adding that the distinction is currently not resolved anywhere at all, at any stage. The Evidence Probe is the first place it could be.

Contributes a lecture floor as the mode prior. Strictness is owned by the contract's grounding profile, not by an answer type.

### call-center

Prompt is `MODE_CALL_CENTER_PROMPT` at `prompts.ts:2536`. Ninth built-in, added 2026-08-23.

The policy boundary is prompt side. The prompt forbids promising a refund, credit, timeline or engineering change the context does not authorise. Nothing validates that.

Seeded `reference_files_primary`. No entry in the mode prior table, so it falls through to the neutral default.

### custom

Not a template. A `general` template row with a non `General` name.

Consequence: a custom mode inherits General's prompt, General's `NEUTRAL` mode prior, General's decision hierarchy and General's silence string, unless the user supplies custom instructions, which `promptSystemV2` renders as an escaped block capped at 1,200 characters.

The brief's proposal that custom modes inherit General's sensed scenario label set is therefore already how the system behaves, by accident of the template sharing rather than by design.

## Reference files change the answer for every mode

The brief states this as a rule the router must honour, and it is correct, but the mechanism is stricter than the brief implies.

Attaching a file does not widen a mode's authority. `modeSourceContract.ts:295` states the principle: an upload is not consent, a switch is. For the two `profile_only` modes, a user must explicitly change the primary knowledge source control before attached files become readable, and `reference_files` only appeared in their allowed switch list in August 2026.

For the seven `reference_files_primary` modes, files are already the default owner, so attaching one takes effect immediately.

`ActiveModeInfo.hasReferenceFiles` exists at `modeProfiles.ts:60` and is populated by `ModesManager.getActiveModeInfo()`. So the live signal the router needs is already available and already cached. The router does not need a new plumb for it.

There is a second flag worth knowing about before the router touches this area. `documentGroundedCustomModeActive` and `strictDocumentGroundedActive` are two different questions, split deliberately on 2026-08-01. The broad flag means source isolation and is true for every template seeded mode. The strict flag means knowledge suppression and is true only when strictness was actually chosen. `ModesManager.ts:318` records that conflating them made a stock Team Meet session with zero files run the strict refusal pipeline. A router emitting `grounding = mode_files` must not be read as choosing strictness.

## STT punctuation and casing

Audit question 6. The brief expects Parakeet CTC to output neither.

`electron/llm/punctuationProvenance.ts` already answers this properly. It defines four provenance values, `provider_final`, `provider_interim`, `model_inherent` and `unavailable`, and it lists which providers actually guarantee punctuation. Deepgram requests it through `smart_format`. Google requests it through `enableAutomaticPunctuation`, confirmed at `electron/audio/GoogleSTT.ts:377`. NVIDIA NIM requests it at `electron/audio/NvidiaNimStreamingSTT.ts:234`. The local models are recorded as emitting it inconsistently, so their provenance is `unavailable` and absence of a question mark must be treated as neutral rather than as evidence of a non question.

`TranscriptTurn.punctuationSource` at `transcriptCleaner.ts:13` already carries this per turn, and is optional, so legacy writers fall through to legacy scoring.

The module header states that stripping punctuation and casing roughly doubles dialogue act segmentation error, and it explicitly anticipates a later punctuation restoration stage that must never overwrite raw text. Candidate P in Phase 4 should extend this module rather than sit beside it, and the dataset's `input_punctuated` field should carry a provenance value alongside the text.

The practical consequence for the benchmark: punctuation availability is a per provider property, not a per model property, so the "with and without restoration" comparison has to be run against realistic provider mixes rather than against a single stripped corpus.

## Answer contracts, prompt versus post processing

Audit question 5, answered directly.

| Contract | Prompt side | Post processing enforcer |
|---|---|---|
| Six section DSA | `codingContract.ts`, appended by `promptSystemV2` on any coding turn in any mode | yes, `validateAnswerStructure` at `ipcHandlers.ts:3970` and `IntelligenceEngine.ts:3749` |
| Emoji capture tags | `tinyPrompts.ts:221` | no validation, but parsed back by `ConversationSummarizer.ts:133` |
| `[ANSWER THIS]` | `prompts.ts:1963` and `:1997` | none |
| Seminar citation preamble | `prompts.ts:2513` | none |
| Looking-for-work no overclaim | `prompts.ts:1391` block | none specific, general profile validators only |
| Silence strings | every mode prompt | normalised at `IntelligenceEngine.ts:4696`, detected by `isNonAnswerSentinel` |

One contract of six has a real enforcer. The rest are prompt instructions the model may or may not follow, and nothing measures how often it does.

## Which decisions are already independent

Covered in full in the routing map. In summary: source grounding, screen capability, retrieval eligibility, and tier selection are each owned by a dedicated module and are independent of intent. Intent, answer type and answer form are a single tangled decision, and the coding branch collapses them completely.
