# What the shadow run must show before the ROUTER flag flips, 2026-09-05

Updated 2026-09-05. The classifier removal that this document originally gated
has landed on different evidence: on the default V3 path the classifier's output
never reached a dispatched prompt, measured on the real engine. Nothing this
gate protects was implicated. What the gate still governs is the router's
needs_response decision on the speculative path, which is the one behaviour
change that can take an answer away from the user. The text below is unchanged
except for this note.

PR 11 removes MobileBERT and the legacy Answer Shape table. It is prepared on a
branch and deliberately not merged. This is the gate it has to clear, written
before the data exists so it cannot be adjusted to fit the data.

## Run it like this

    NATIVELY_ROUTER_SHADOW=1

Two weeks of ordinary use. The router flag stays OFF for the whole run. Shadow
logging and the router are separate flags precisely so the evidence can be
collected on a build that behaves exactly as today.

Then export the piTelemetry ring and run:

    node scripts/router-feedback/analyze-shadow.mjs --in <events.jsonl>

## The numbers that decide

The report gives four cells. Three of them are informational and one is a veto.

`router_would_silence` is the veto. Each of those turns is one the user received
an answer for today and would not receive. It must be under 2 percent of
compared turns overall, and under 5 percent in every individual mode. The per
mode floor exists because a single mode regressing badly does not move an
aggregate: at the volumes here a mode could be broken and the total would still
read healthy.

`agree_silent` is the payoff and it must be worth the change. Under 3 percent
means the router is not saving enough generations to justify replacing a working
component, whatever its benchmark numbers say. The measured silence share is 6.1
percent, so anything close to that is the expected outcome.

`router_would_speak` is not a veto. It only adds an answer where there was none,
which is a different and much smaller harm than removing one.

Minimum volume: 500 compared turns, and at least 30 in any mode whose per mode
number is quoted. Below that the percentages are noise and the honest report is
that the run was too short.

## What would make me stop rather than proceed

Any of these ends the run and sends the work back rather than lowering the bar.

A `router_would_silence` rate above 2 percent overall. A single mode above 5
percent with at least 30 turns behind it. A concentration of high confidence
disagreements, meaning the model is wrong in a way it does not know about, which
is worse than being uncertain. A crash or a poisoned load sentinel attributable
to the router worker.

## The legacy shim is a separate question

The shim's agreement rate with the shipped label decides whether the Answer
Shape table can go, and it is not the same decision as whether the router can be
switched on.

A high shim guess rate is an argument for removing the table rather than for
tuning the shim. The three collapsed pairs are not recoverable from the frame,
so a shim that agreed more would be one that guessed better, not one that knew
more. If the guess rate is high and the answers were still fine, that says the
distinction the table encodes was never load bearing.

## What PR 11 removes, once the gate is clear

`electron/llm/IntentClassifier.ts` tiers 1 and 2, the MobileBERT model files and
their download entry, `intentClassifierWorker.ts`, the `INTENT_ANSWER_SHAPES`
table, and the eight label `ConversationIntent` union.

`AnswerRelevanceChecker` uses the same worker through `classifyZeroShotRaw`, and
the audit already flagged that the brief does not account for it. Removing
MobileBERT removes that check unless it is rehomed first. That is a prerequisite
of PR 11, not a consequence of it.

## What is not covered by this gate

Windows. Every number in this campaign is from Apple Silicon. The ONNX worker
path exists on Windows and has been reviewed, not executed. The gate above is
necessary and it is not sufficient: a Windows run is a separate requirement
before the flag flips for anyone but the founder.
