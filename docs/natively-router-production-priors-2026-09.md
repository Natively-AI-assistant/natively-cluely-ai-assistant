# Production priors for the interaction-router campaign

Measured 2026-09-04 from `logs/telemetry.jsonl`, 554,813 lines, 0 malformed. Reproduce with `node scripts/intent-benchmark/analyze-telemetry.mjs`.

These are real numbers from the shipped classifier on real sessions. They are not estimates and they are not from the benchmark. The log is marker only: an enum label, a request id, a source. It carries no question text, no answer text and no transcript, so this reads real usage without reading anyone's content.

Phase 2 uses these to weight the dataset. Without them the category shares in the brief would be guesses, and a benchmark weighted by a guess measures the guess.

Three different denominators appear below, and they must not be combined. Invocations of `runWhatShouldISay` are 38,052, counted as one `what_to_answer_clicked` or `question_submitted` mark per call. Intent classifications are 32,919. Answer type selections are 31,943. The gap of 5,133 between invocations and intents, 13.5%, is turns where no intent was ever classified: a superseded turn, a cooldown gated return, or an abort before the mark at `IntelligenceEngine.ts:2443`. Intent and answer type shares are therefore shares OF CLASSIFIED TURNS, while the silence rate is a share OF ALL INVOCATIONS, because a silence can only occur on a turn that ran.

## Intent distribution, n=32,919

| Intent | Count | Share |
|---|---|---|
| `general` | 12,358 | 37.5% |
| `deep_dive` | 7,073 | 21.5% |
| `clarification` | 5,847 | 17.8% |
| `coding` | 2,440 | 7.4% |
| `behavioral` | 2,409 | 7.3% |
| `summary_probe` | 1,546 | 4.7% |
| `example_request` | 1,180 | 3.6% |
| `follow_up` | 66 | 0.2% |

Two things stand out.

`general` is the largest class at 37.5%, and `general` is the terminal default. Tier 3 returns it whenever nothing else matched. So the single most common outcome of classification is the absence of a classification.

`follow_up` is 66 events in 32,919. That is 0.2%, or roughly one every five hundred turns. The label is functionally dead. It has two producers: a regex requiring one of five fixed phrases, and a tier 3 branch requiring at least two prior assistant responses and a last interviewer line under fifty characters. Neither fires in practice. A live conversation is mostly follow ups, so this is not a rare phenomenon being correctly measured as rare. It is a label that does not detect the thing it names.

Any Phase 5 error analysis has to treat `follow_up` separately. A macro F1 computed over eight classes where one has a 0.2% prior will be dominated by that class's noise, and a per label F1 for it will be meaningless on a held out split of 300 rows, which would contain roughly one example.

## Answer type distribution, n=31,943

Top ten of the roughly 38 value union.

| Answer type | Count | Share |
|---|---|---|
| `general_meeting_answer` | 8,357 | 26.2% |
| `unknown_answer` | 6,671 | 20.9% |
| `project_followup_answer` | 3,423 | 10.7% |
| `experience_answer` | 1,898 | 5.9% |
| `dsa_question_answer` | 1,727 | 5.4% |
| `skill_experience_answer` | 1,293 | 4.0% |
| `jd_fit_answer` | 1,266 | 4.0% |
| `negotiation_answer` | 1,191 | 3.7% |
| `behavioral_interview_answer` | 1,113 | 3.5% |
| `lecture_answer` | 926 | 2.9% |

`general_meeting_answer` and `unknown_answer` together are 15,028 turns, 47.0% of classified turns. Both are fallthrough types. Nearly half of production traffic lands on a type that means the planner did not identify what was being asked.

## Silence share

This is the number the Phase 1 audit could not report.

2,313 turns ended in `nonanswer_sentinel_fallback`, against 38,052 total invocations of `runWhatShouldISay`. That is **6.1%**.

It is a floor, not the true rate. The sentinel branch only marks `fallback_answer_used` when `!isSpeculative`. The speculative branch returns null after emitting an engine level discard that never reaches this log, so speculative silence is entirely uncounted. The counter added in PR 1b covers both paths and will give the true figure.

Split by source, where `manual` means an explicit question was supplied and `what_to_answer` means the turn was inferred from the transcript:

| Source | Silences | Invocations | Rate |
|---|---|---|---|
| `what_to_answer` | 1,224 | 23,726 | 5.2% |
| `manual` | 1,089 | 14,326 | 7.6% |

The manual rate being the higher of the two is worth pausing on. A user typed or pressed for an answer, the system spent a full generation, and returned a non answer more often than on turns nobody asked for. That is the case the Phase 1 audit flagged from the code comments, now with a number attached.

### Where silence lands

| Answer type | Silences | Share of silences |
|---|---|---|
| `general_meeting_answer` | 1,129 | 48.8% |
| `unknown_answer` | 1,089 | 47.1% |
| everything else combined | 95 | 4.1% |

95.9% of all silences land on the two fallthrough answer types.

This is the strongest single argument in the data for the router's `needs_response` axis. The system is not discovering mid generation that there is nothing to say. It has already routed the turn to a type that means "I could not identify this", and then spends a full cloud generation to confirm it. The information needed to stay quiet is present before the model is called.

### The size of the prize, stated once

Three numbers describe this and they answer different questions, so they are set out together rather than reused.

6.1% is the share of all invocations that ended in silence. It is what the waste costs today, and it is a floor.

95.9% is the share of silences that landed on a fallthrough type. It says silence is concentrated, not diffuse, so a pre check has somewhere specific to look.

14.8% is the number that actually sizes the pre check's job. 15,028 turns routed to `general_meeting_answer` or `unknown_answer`, and 2,218 of those ended in silence. So within the population a `needs_response` gate would be asked to judge, roughly one turn in seven should be silent and six in seven should not. That is the discrimination task, and it is a much harder one than either of the other two numbers suggests.

A gate that fired on every fallthrough turn would suppress 2,218 wasted generations and also suppress 12,810 useful answers. Nothing in this data says the remaining signal is separable. It says where to look for it.

## What is not in this data

Mode is not usefully recorded. Nearly every `modeId` in the log is `mode_general_default`, with a small tail of test fixture ids. There is no per mode distribution to be had here, so the per mode dataset shares in the brief stay as specified rather than being reweighted.

Dialogue act, needs response, voice, grounding and capability are not recorded at all, because nothing computes them. That is the finding from Phase 1 restated as an absence in the data.

Nothing here describes the manual knowledge surface served by classifier B. `intent_classified` is emitted from `runWhatShouldISay` only. The `manual` source value on that event means an explicit question was passed to the live path, not that the typed knowledge chat ran.
