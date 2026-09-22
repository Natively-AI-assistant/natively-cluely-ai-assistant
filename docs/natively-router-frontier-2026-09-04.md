# The escalation ladder does not survive a p95 bar

Interim Phase 4 finding, 2026-09-04, held-out split, English, n=377.

## The measurement

| Candidate | escalation rate | needs_response macro F1 | p50 | p95 |
|---|---|---|---|---|
| Model2Vec alone | none | 50.8% | 0.06ms | 0.08ms |
| hybrid, margin 0.01 | 17.0% | 52.2% | 0.07ms | 24.69ms |
| hybrid, margin 0.03 | 44.0% | 52.8% | 0.17ms | 25.17ms |
| hybrid, margin 0.05 | 59.7% | 52.6% | 24.50ms | 26.22ms |
| hybrid, margin 0.10 | 82.5% | 59.3% | 24.64ms | 25.58ms |
| hybrid, margin 0.25 | 96.8% | 64.0% | 25.00ms | 26.52ms |
| fine-tuned head alone | n/a | 67.7% | 25.00ms | 26.28ms |

## What it says

The brief's architecture is a fast primary with an escalation model behind it, gated on confidence and bounded by a deadline. That is a sound design for a MEAN latency budget. The acceptance bar is p95, and against p95 it does not work.

The reason is arithmetic rather than anything to do with these particular models. p95 asks what the slowest one turn in twenty costs. Any escalation rate above five percent guarantees that the slowest five percent of turns are escalated turns, so p95 becomes the escalation model's latency no matter how rare escalation is. The table shows exactly that: at a 17% escalation rate the median turn still costs 0.07ms, and p95 has already jumped to 24.69ms, within two milliseconds of running the escalation on everything.

So under a p95 bar the ladder offers a choice between two poor options. Escalate under five percent of the time and accuracy stays essentially at the primary's, 52.2% against 50.8%, which is not worth the second model. Or escalate enough to matter and pay the escalation's p95 anyway, at which point the primary is dead weight.

## What follows

The critical path is not a ladder. It is making the accurate model fast enough to run on every turn.

The fine-tuned head is at 26.3ms p95 on Apple Silicon in fp32, against a 25ms bar specified on the Intel Mac. Two levers are untried and both are ordinary: int8 quantization, which currently fails on the multi-output graph with a symbolic shape inference error and is a solvable tooling problem rather than a modelling one, and a smaller encoder, which is the distilled-student row of the candidate matrix.

The hybrid rows should still be reported in Phase 5, because a negative result that was measured is worth more than an assumption that was not. But they should be reported as ruled out on p95 grounds, not as a live option.

## A caveat on the measurement

These numbers come from the fine-tuned head in fp32 with external weights, because quantization has not yet succeeded. If quantization lands and the head drops to, say, 8ms, the whole table changes and the ladder becomes less necessary rather than more: a fast enough accurate model removes the reason for a primary at all.

## The bug this exposed first

Before the temperature fix, every hybrid variant escalated on 100% of rows and all four collapsed into "the escalation model, plus overhead". The cause was the primary's confidence, not its accuracy. Cosine similarities against different centroids cluster tightly, around 0.55, 0.54, 0.53, and squashing them through a softmax at temperature 10 left the top-two gap with a median of 0.011. Every threshold from 0.10 to 0.50 sat above the entire distribution.

Fitting the temperature on the training split, by minimising calibration error, moved expected calibration error from 0.202 to 0.013 and left accuracy unchanged, which is what a temperature change should do. Only after that did the escalation rate respond to the threshold at all.

That failure is worth recording because it is invisible from the accuracy column. A hybrid that silently escalates everything still produces a plausible accuracy number: the escalation model's. It looks like a working ladder and is a slower way to run one model.
