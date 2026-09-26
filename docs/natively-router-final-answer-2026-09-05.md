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

## Landed, 2026-09-05

The removal is in. What went: `electron/llm/IntentClassifier.ts` and its worker,
the MobileBERT model from every manifest and download script, the asarUnpack
entry, the poison sentinel wiring in main.ts, the Answer Shape table, and the
`<intent_and_shape>` block in WhatToAnswerLLM. `ConversationIntent` and
`IntentResult` survive as types in PlannerDecision.ts because three consumers
still carry them, and `classifyIntent` survives as a function that returns
`general`, so no call site moved.

The planner now answers by default. Its old gate passed on seven of eight labels
and its terminal tier could not produce the eighth except by heuristic, so this
is the behaviour it already had on 98.3 percent of held out rows, made explicit.

`hasQuestionSignal` is one exported definition, shared by the planner and the
speculation gate, tuned on the train split of the router corpus and reported on
the held out split: recall 38.0 to 51.4 percent, false positive 10.0 to 14.0
percent. What it still misses are statements that need a response, which is the
router's needs_response axis and not a regex's job.

`checkAnswerRelevance` returns null. The enforcing arm of that guard was default
off because validation run-032 found the classifier could not separate real
from hallucinated answers, so nothing shipped is lost and the test that pinned
the opt in regeneration now pins the pass through instead.

One regression found and fixed on the way. PR 7's pre check awaited the router
on every speculative turn even with the flag off, which lagged the run's
observable state by a microtask and broke a test that reads it synchronously.
Availability is now checked synchronously first, so a disabled router adds no
async hop.

The five other failures in the wide suite are the four known red tests recorded
at the campaign baseline plus their parent suite, reproduced with these changes
stashed. Wide suite otherwise: 8,679 passing.

The router stays flagged off, and the shadow run remains the gate for turning it
on. That gate was always about the router's needs_response decisions, not about
the classifier, whose removal rests on the finding that its output was
unreachable.

## Code review, 2026-09-05, and what it caught

A /code-review pass over the branch confirmed 27 findings. Ten were mine and are
fixed; three belong to the vision chain work in commit e079cd4a and are reported
rather than touched, because that is another session's live work in this same
checkout.

The one that matters most is a verification failure of mine. I ran `npx tsc -p
tsconfig.json` and called the tree clean. The gate CI runs is `npm run
typecheck:electron`, which is `electron/tsconfig.json` under TypeScript 7, and it
was red at HEAD with two errors from the classifier removal: a double quoted
`import { IntentResult } from "./IntentClassifier"` in WhatToAnswerLLM.ts that my
single quote grep never saw, and an orphaned `scoreChunk` still calling the
removed `classifyZeroShotRaw`. esbuild elided both, so every local test passed.
The stale compiled `IntentClassifier.js` from before the deletion also sat in
dist-electron, because the build has no clean step, and two tests plus three
harness scripts kept importing it and passing. One of those was the real engine
harness whose "classifier said" column I have been quoting today. The column was
the old bundle. The dispatch and V3 measurements were not, because those go
through the rebuilt engine, and they stand.

Fixed: both type errors; the stale artifacts deleted and the importing tests and
scripts repointed or retired; the coding detection regression, where the removed
regex tier had been the only thing catching "give me an example of a React
component in TypeScript", now carried by CODING_PATTERNS with an object required
so a behavioral "example of a conflict in your team" stays out; the empty grant
gate, which I had fixed at one of its two assignment sites while the second
silently undid it; the "nothing uploaded" wording, which is a different fact from
"not enabled here"; the phone mirror clarification call; and four router defects
that only bite with the flag on: a slot wait with no deadline, a poison sentinel
consumed during the router's own load, a warmup nothing called, and session
options copied two fields at a time with the arena setting dropped.

Not fixed and reported: the vision chain budget is non binding on every cloud
rung but Natively and Ollama, the manual chat screenshot deadline stayed at 7
seconds after WTA moved to a vision aware one, and a provider error string is
committed as a first token. All three are in e079cd4a. Also left: the router's
model directory is in no download or verify list, so a clean checkout ships the
worker without its model and the flag path returns null; the shadow run's
legacy_agrees field compares two different label vocabularies and is constant;
and `classifyIntent` survives as an awaited constant threaded through five
modules.
