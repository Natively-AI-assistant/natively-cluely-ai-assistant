# How the router model is chosen, 2026-09-05

This document is the method. The numbers are a separate section, added when the
run finishes, and nothing here quotes a result.

## The bar is the shipped classifier, not the committed thresholds

The campaign brief committed three acceptance thresholds before anything had
been measured: 0.85 macro F1 on needs_response, 0.80 on dialogue_act, 0.70 on
mode_intent. Nothing in six phases came close, and more data was not going to
close a gap that size.

Evin chose a different bar. The question is whether a candidate beats the
classifier that ships today, because replacing something that does not work is
the actual goal. The committed thresholds are still reported, so the gap stays
visible, but they do not decide anything.

## What the shipped classifier is, exactly

`electron/llm/IntentClassifier.ts`, all three tiers, run by calling the real
`classifyIntent` out of the compiled bundle rather than a reconstruction of it.

Tier one is ten regex rules, first match wins. Tier two is MobileBERT zero shot
in the production worker, entered only when tier one returned nothing and the
turn is longer than five characters, and discarded when the top score is under
0.35. Tier three is a context heuristic that cannot decline.

Running this outside Electron takes one deliberate step. The zero shot tier
resolves its model directory from `process.resourcesPath`, which only Electron
sets. Without it the path collapses to a relative string, the worker fails to
load, and tier two silently never fires. The provider sets it. A baseline
missing its model tier would understate production and flatter every candidate
measured against it.

Tier two genuinely contributes. Over eight probes chosen to miss the regex
rules, it cleared its own 0.35 threshold on four.

## The shipped classifier has no needs_response output

Not a weak one. None. Nothing in the ten rules, the eight hypotheses or the
context heuristic is about whether the assistant should speak at all.

This is the finding the campaign rests on, and it has a concrete face. The turn
"mhm right right" is a backchannel that needs no response. The shipped pipeline
scores it at 0.359, clears its threshold, and assigns it an answering intent.

It also means a candidate beating production on needs_response proves nothing,
because anything that emits the axis beats an absence. So a second baseline
exists.

## The floor is always guessing

The `majority` provider always predicts the training split majority class, per
axis, fitted on train only. A majority class is a parameter and one read off the
test set is a leak like any other.

On a skewed axis a model can post a respectable accuracy having learned nothing,
and only the comparison with always guessing shows it. Macro F1 punishes the
constant guesser correctly, which is why the campaign reports macro F1, but the
floor belongs in the table so the margin is visible rather than asserted.

## Which axis decides

needs_response, plus latency.

needs_response is the axis that gates behaviour. It decides whether the
assistant speaks, and production telemetry puts 6.1 percent of live generations
on turns where there was nothing to say. dialogue_act is reported honestly
alongside and does not get a veto.

That is Evin's decision, and there is a measurement reason behind it.
dialogue_act carries five classes, one of which, `interruption`, has 31 rows in
the whole corpus and 5 in the held out split. Macro F1 averages classes equally,
so that one starved class caps the axis regardless of model quality. A reader
comparing the number to a threshold cannot see that from the number.

So every axis now reports the same average over adequately supported labels
alongside the headline, with the thin classes named, and never instead of it.
Dropping a thin class is a way to make a number look better, so both travel
together. On mode_intent this matters more than anywhere else: 75 of its 77
labels sit under 15 held out rows, so the global figure for that axis is not a
measurement and the per mode breakdown is the only meaningful reading.

## The corpus

5,328 rows. 4,254 train, 1,074 held out, grouped so that rows sharing a
normalised input cannot straddle the boundary. Zero held out rows share an exact
input with train, against 7.9 percent in the first version. Zero prompt example
copies. Within mode duplicates at 0.3 percent.

Code switched rows are 136 Hinglish and 161 Manglish. They are reported as
separate slices and are never gated on, because every fitted candidate is fitted
on English rows only, so those slices measure transfer rather than fit.

## What every candidate had to have rebuilt

Every trained head on disk was unscoreable against this corpus, twice over. Each
was fitted on the previous split, so each had already seen part of the new held
out set. Each also carried the old three class needs_response, from before
`optional` was migrated away.

Neither problem shows up in a score. Both make a score meaningless. So the heads
are retrained on the new split before anything is measured, and the old exports
are moved aside rather than overwritten, so scoring a stale one fails loudly
instead of quietly returning a number.

## The epoch count is no longer a guess

The trainer used to run a fixed number of epochs and save whatever the last one
produced, which made the epoch count an unvalidated hyperparameter. Selecting on
the held out split would have answered it by leaking it.

A dev slice is now carved out of train, 15 percent of it, grouped by normalised
input for the same reason the corpus split is grouped. Every epoch scores dev
macro F1 on needs_response and the best epoch is restored before saving. The
choice is recorded in `heads.json` so it can be audited.

## What is not measured

Nothing here has been run on Windows. Every number in the results section comes
from Apple Silicon. The acceptance bar names an Intel Mac, which is a separate
and slower hardware cell that has not been run either.

The ONNX worker path exists on Windows and was reviewed, not executed. That does
not block the model choice, and it does block calling the feature done.
