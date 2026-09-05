# Repair, upgrade, or remove the classifier, 2026-09-05

The answer is remove, and the reason is stronger than any accuracy number in
this campaign: on the default production path the classifier's output never
reaches the model.

## Measured on the real engine, not a reconstruction

Every earlier ablation injected the answer shape into a prompt I wrote. This one
drives the real IntelligenceEngine, SessionTracker, ModesManager and the real
three-tier classifier under ELECTRON_RUN_AS_NODE, feeds a real captioned
interview, and records the prompt handed to the provider at the one seam
WhatToAnswerLLM dispatches through, `llmHelper.streamChatWithOutcome`.

Default mode, Context Intelligence V3 default ON, fourteen interviewer turns.

    turns                                  14
    provider dispatches                    14
    prompts composed by V3                 14
    dispatches carrying the classifier's
    intent or answer shape                  0

The classifier ran on every turn. Its labels were general, coding, follow_up,
example_request. None of them reached a prompt.

## Why, in the code

`intentContext`, which carries the `<intent_and_shape>` block, feeds only the
v2 turn envelope and the legacy v1 packet. When V3 composes a turn,
`_wtaUserMessage = _v3p.user` and the system prompt is V3's. Both legacy
carriers are discarded. Nothing under `electron/context-intelligence/` reads
`intentResult` or `answerShape`. V3 has been default ON since 2026-07-30.

So the classifier's surviving effects on the default path are two. The planner
gate `intentSupportsAnswer`, which passes on seven of eight labels and matched a
hardcoded `general` on 98.3 percent of 1,011 held out rows. And an OR against a
regex in AnswerPlanner's coding detection, where the classifier scores 18.3 F1
on coding.

## What this does to every earlier number

Every with-intent condition measured in this campaign is a condition production
does not run. The 64 to 73 result on real conversation, the 22 to 10 on isolated
questions, the 49.1 percent router versus 37.5 percent constant on answer
shape, all compared prompts the shipped app never sends. They were measurements
of the legacy path, which is the fallback.

The label accuracy numbers stand as measurements of the classifier. They do not
bear on the product, because the product does not consume the label.

## Repair or upgrade

Neither. Repairing a classifier whose output is unread improves nothing the user
sees. Upgrading it to the router this campaign built, which is measurably better
at the label (78.2 needs_response against a 36.0 floor, 12.2 ms against 52.6),
would make it better at producing a value nothing reads. The three harness
defects that each produced a confident wrong number in this campaign all came
from reconstructing what production feeds a component instead of reading the
function that feeds it. This finding is the same lesson applied to the
classifier itself.

## What the field does, for the two axes separately

Answer shape and intent. The 2026 pattern is a structured-output call to the
LLM that is already reading the conversation, or a small fast LLM for the
classification step when cost forces a split, not a separate encoder guessing
from one line. For five to thirty clearly defined intents a structured-output
LLM matches or beats a fine-tuned encoder out of the box, and dedicated
classifiers remain justified only under tight latency or cost. Natively's answer
model already sees thirteen inputs including the full transcript. Handing it a
verdict formed from one unpunctuated line is the anti-pattern the field moved
away from.

Whether to speak at all. This is the one axis where a small local model is
standard practice, under the names turn detection and addressee detection. The
LiveKit turn detector runs CPU-only on ONNX Runtime in under 500 MB, Pipecat
Smart Turn v2 adds about 20 ms over voice activity detection, and addressee
detection layers exist specifically so side conversations and the agent's own
audio never trigger a response. Natively's needs_response axis is this problem,
and the router built here is the right shape of tool for it. What differs is the
input. The field runs these on audio, before STT, with prosody available. The
router here runs on text after STT, which is why prosody features were in the
brief and why a text-only model was measured at 78.2 rather than higher.

## The recommendation

Remove the classifier. MobileBERT, the ten regex rules, the worker, the poison
sentinel and the Answer Shape table. Replace the planner's `intentResult` with
the constant `general` and fix `hasQuestionSignal`, which cannot recognise a
question in unpunctuated STT and is the real reason a naive deletion silences
72 percent of turns. That defect has been hiding behind the classifier's
constant-true gate.

Do not ship the router as a replacement for what was removed. Nothing consumed
the old output, so there is nothing to replace.

Keep the router for exactly one job, if the shadow run earns it: deciding
whether to speak, on the speculative path, gated at high confidence, as PR 7
wires it. That is the axis the field runs small local models on, and it is the
axis where the 6.1 percent of wasted generations live. Feed it the transcript
format production actually emits, `[INTERVIEWER]:` and `[ME]:`, which two
harnesses in this campaign got wrong.

## A V3 defect found on the way

With the technical-interview mode active and no profile attached, V3 returned
answerability NONE with fallback DOCUMENT_FACT_NOT_FOUND for a plain interview
question, and the engine answered "This mode only answers from your uploaded
material" without any provider call. That is a real question receiving a
refusal. It is outside this campaign and it deserves its own investigation.

## Not covered

Windows, on every number here. The recruiting mode, which produced no usable
real fixture. Human judgement of any answer.
