# Hard-case taxonomy (Phase 1, step 2)

Derived from three sources:
- every rule in `JUDGE_PROMPT_RULES` (`AutoAnswerJudge.ts`, written as P-n in order);
- the dated Auto Answer tests;
- the open and fixed failures in `docs/autopilot/decider-forensics.md` (F-#).

Each tag says which label it usually produces. The generator is **steered** to produce the
tag; the teacher decides the label. Examples here are NEW wording, written for this file: no
judge-eval text, paraphrase or near-duplicate (the leakage check enforces this on the data
anyway).

| tag | expected | source | what it looks like |
|---|---|---|---|
| `direct_question` | answer | P "answerability 0.9–1.0" | plain question to the user, any length |
| `short_yes_no` | answer | P "INCLUDING short or yes/no" | "ever used Kafka?", "familiar with gRPC?" |
| `declarative_task` | answer | P-1; F-7, F-10 | "your job today is to build a URL shortener", "we need a schema for orders" |
| `produce_directive` | answer | P-6 | "go ahead and write the parser", "walk me through the code" (only once the task is stated) |
| `experience_question` | answer | P action rule | "tell me about a conflict you handled", "why did you leave your last role?" |
| `report_shaped_ask` | answer | ReportShapedPrefetch2026_09_27; F-65 | a sales pain point or an error message read out, with an implied "how do we fix this" |
| `followup_probe` | answer | F-51, F-52 | "and why?", "what if it doubles?", "are you sure about that?" (a challenge, not rhetoric) |
| `multi_part_question` | answer | P "question_text the WHOLE ask" | two or three questions in one breath, all for the user |
| `merged_second_voice` | answer | P-4; F-15, F-20 | a question, then ANOTHER participant's short reply in the same candidate; still open for the user |
| `logistics_check` | answer | P-5, P action "small logistics" | "can you hear me?", "ready to start?" (the user must respond) |
| `rhetorical_self_answered` | silent | P-3, P-4(a) | "why cache it? because reads dominate." from one voice |
| `explanation_with_question_words` | silent | P-2 | rules or demo narration: "you have to figure out which cells are mines" |
| `comprehension_check_tag` | silent | P-4(b), P-12; F-8 | a recap ending in "…right?" / "…okay?", or "is that correct? correct." |
| `paraphrase_of_user` | silent | P-7; F-28 | "so you're saying we partition by tenant" |
| `granting_permission` | silent | P-6; F-27 | "feel free to look things up", "you can skip auth" |
| `session_logistics` | silent | P-6; F-31, F-32, F-41, F-62 | "share your screen", "we have ten minutes", a homework due date, a transition before any task exists |
| `deferral` | silent | P-6; F-27 | "we'll come back to scaling later" |
| `agenda_or_setup` | silent / wait | F-53, F-54 | an agenda for the session, or a hypothetical setup whose question hasn't come yet |
| `statement_needs_ack` | silent | P-13 | "the backlog is getting long, we should prioritize" |
| `speaker_narration` | silent | P-14 | "I'm sending you a link now", "the endpoint returns JSON" |
| `audience_directed` | silent | P-11 | "for everyone watching, let me explain", lecture asides to the class |
| `addressed_to_other` | silent | JudgeKnowsUserName2026_09_27; F-59, F-61 | "Priya, can you update the doc?" when the user is not Priya, including after Priya answers |
| `addressed_to_user_slip` | answer | JudgeKnowsUserName2026_09_27; F-60 | the user's name with an STT slip ("Jordon", "Jordy") before the ask |
| `user_own_voice` | silent | P-10 | the user's question leaking onto the system channel: "can I use Python?", "are inputs sorted?", reasoning aloud |
| `restatement_answered` | silent | P "Already answered" block; F-14, F-21 | the answered ask restated, or its details added |
| `new_requirement_after_answer` | answer | P "a changed requirement counts" | a genuinely changed constraint after an answer |
| `announced_structure` | wait | P-9; F-23 | "three things I want you to handle: first…" with only one delivered |
| `mid_sentence_fragment` | wait | P-8, P-11; F-11, F-12, F-19, F-22, F-30 | ends on a conjunction or preposition ("…and the", "…so you"), "your task is—", a dash or an ellipsis |
| `stalled_interim_clipped` | answer / wait | SttStallCap2026_09_27; F-63 | `transcript_lagging: true`, last word cut ("…how would you shard the ord"); the ask is clear, so answer |
| `backchannel` | silent | NEVER_CONSULT acts | "mm-hm", "right, right", "okay cool" |
| `no_punctuation` | (any) | STT providers without punctuation | the same phenomena with all punctuation and casing stripped. **50% of records** |
| `stt_noise` | (any) | F-5, F-39 | duplicated words, mid-word cuts, homophones, a mis-heard name |

## Quotas

The generator plans each transcript so that, across the whole corpus:

- every tag reaches at least **300 candidates**, except `no_punctuation`, which is a 50%
  property and not a quota;
- every (tag, mode) pair marked ✓ below reaches at least **20 candidates**;
- labels land around 25% answer, 60% silent and 15% wait. That mirrors the gold sets' 36 asks
  in 187, with silent dominant (127 + 24 none). Answer is oversampled a little so recall has
  enough signal.

Applicability (✓ = the tag occurs naturally in this mode):

| tag | general | tech-int | lfw | sales | recruit | team | lecture | seminar | call-ctr |
|---|---|---|---|---|---|---|---|---|---|
| direct_question, short_yes_no, followup_probe, multi_part_question, merged_second_voice, logistics_check, rhetorical_self_answered, statement_needs_ack, speaker_narration, restatement_answered, mid_sentence_fragment, stalled_interim_clipped, backchannel, stt_noise | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| declarative_task, produce_directive | ✓ | ✓ | ✓ | | | ✓ | ✓ | ✓ | |
| experience_question | ✓ | ✓ | ✓ | | ✓ | | | | |
| report_shaped_ask | ✓ | | | ✓ | | ✓ | | | ✓ |
| explanation_with_question_words, comprehension_check_tag, audience_directed | ✓ | ✓ | | ✓ | | | ✓ | ✓ | |
| paraphrase_of_user | ✓ | ✓ | ✓ | ✓ | ✓ | | | | ✓ |
| granting_permission, deferral, session_logistics, agenda_or_setup | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| addressed_to_other, addressed_to_user_slip | ✓ | | | ✓ | | ✓ | ✓ | ✓ | |
| user_own_voice | ✓ | ✓ | ✓ | ✓ | | | | | ✓ |
| announced_structure | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | |
| new_requirement_after_answer | ✓ | ✓ | ✓ | ✓ | | ✓ | | | ✓ |

Speakers per transcript: 2 to 4 OTHERS voices, all on the one OTHERS channel. **No
diarization labels reach the model**: `main.ts` `ingest()` passes no `speakerId` today, so
production candidates and context never carry `OTHERS/speaker_N`, and the segmenter matches
that. If diarization is wired later, regenerate with labels on. The user's name appears in
about 40% of transcripts. Team-meet, lecture and seminar always have named participants.
