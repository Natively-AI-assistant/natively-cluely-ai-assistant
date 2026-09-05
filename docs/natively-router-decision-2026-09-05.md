# The router model, chosen, 2026-09-05

The method is in `natively-router-decision-method-2026-09-05.md`. This is the
result.

## The answer

A single fine tuned MiniLM-L6 encoder with one linear head per axis, quantized
to int8 ONNX, running in its own worker. Provider id `head-minilm`, 22.8 MB on
disk, p95 12.2 ms.

Not the composite, and not the prototype variant. Both score identically on the
two axes the router owns and both cost more latency.

## The table

English held out split, 1,011 rows, macro F1 percent, p95 milliseconds measured
inside the worker on Apple Silicon.

    provider                 needs_resp  dialogue   legacy   p95ms
    head-minilm                   79.2      51.4     37.5     12.2
    composite-head-potion         79.2      51.4     37.5     16.0
    headproto-minilm              79.2      51.4     37.5     12.9
    head-tiny                     74.9      34.3     31.6      6.2
    proto-potion-centroid         65.7      35.6     30.1      0.1
    majority (floor)              35.6      12.2      0.0      0.0
    production (shipped)           0.0       0.0     15.7     49.0
    rules (tier 1 only)            0.0       0.0      6.0      0.0

## Reading it

On needs_response, the axis that gates whether the assistant speaks, the model
scores 79.2 against an always guessing floor of 35.6. That margin of 43.6 points
is the evidence that it learned the task rather than the prior.

The shipped classifier scores 0.0 there, and that is an absence rather than a
failure. It has no needs_response output. Beating it on that axis is satisfied
by anything that emits the axis, which is why the floor is in the table.

On legacy_intent, the eight label taxonomy the shipped classifier actually
produces, the model scores 37.5 against production's 15.7. That is the only
head to head comparison available, and it comes with a caveat that matters: the
model was trained on these labels and production was not, so the gap is
flattering to the model. The honest reading is that production is weak here, not
that the model is strong.

On latency the comparison is clean and needs no caveat. 12.2 ms against 49.0 ms,
four times faster, and the shipped classifier is itself twice the 25 ms bar the
campaign set for its replacement.

## Why not the composite

The composite doubles mode_intent, 15.5 against 38.3, for 3.8 ms. That would be
worth it if mode_intent were the router's. It is not. `AXIS_OWNER` in
`electron/llm/routing/IntentFrame.ts` assigns mode_intent to Context
Intelligence V3, and gives the router needs_response and dialogue_act only. On
those two the composite and the plain head are identical to the decimal.

So the extra machinery buys an improvement on an axis the router does not ship.

## Why not head-tiny

Half the latency, 6.2 ms against 12.2 ms, and 4.3 points worse on
needs_response. Both are far inside the budget, and the budget is not the
binding constraint at this end of the range. Accuracy on the deciding axis is.

If a slower hardware cell later makes 12.2 ms tight, head-tiny is the fallback
and the gap is known.

## dialogue_act, reported and not gated

51.4, and the number should not be read against the committed 0.80 without its
context. The axis has five classes and one of them, `interruption`, has 31 rows
in the whole corpus and 5 in the held out split. Macro F1 averages classes
equally, so a class that thin caps the axis regardless of the model. The report
names it and gives the average over adequately supported labels alongside.

## What was wrong with the first run of this table

Production first scored 10.1 on legacy_intent, and that number was wrong.

Tier 3 selects interviewer lines by matching `[INTERVIEWER`. The corpus marks
the other party `[SYSTEM]`, so the filter matched nothing, the last interviewer
line was empty, and the guard `''.length < 50` was trivially true. Combined with
passing the history length as the assistant message count, which clears the
`>= 2` gate, every tier 3 row returned `follow_up`.

The symptom was visible in the confusion table: production predicted `follow_up`
for 59 percent of rows labelled `general`, on a corpus where follow_up is 0.2
percent of real traffic. That is not a classifier being wrong, it is a harness
feeding it a format it cannot read.

After the fix production predicts `general` 54.3 percent against a corpus that
is 53 percent general, and `follow_up` 0.4 percent against a measured prior of
0.2 percent. The baseline is credible, and it is the more favourable of the two
readings, so the comparison is conservative.

## The defect this decision does not fix

The corpus has history on every row. Production's first turn has none. Measured
on this model, needs_response macro F1 falls from 78.5 to 68.3 when history is
stripped from the held out split.

That is recorded in `natively-router-coldstart-2026-09-05.md`. The augmentation
is written and tested but the retrain and re measurement are still to run, so
the 79.2 above describes a distribution that production only partly matches.

## Not measured

Nothing ran on Windows. Every number here is Apple Silicon. The acceptance bar
names an Intel Mac, a separate and slower cell that has not been run.
