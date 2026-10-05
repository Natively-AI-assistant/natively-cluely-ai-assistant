# Does the answer shape improve the answer, 2026-09-05

Every earlier number in this campaign is label agreement. None of it says a
correctly labelled turn produces a better answer, and that is the question that
decides whether the classifier is worth having at all.

Run against a LOCAL natively-api on 127.0.0.1, not production, because the
operational note forbids load testing the live API.

## Method

32 questions drawn from the held out split, spread across all eight legacy
intents, generated four ways through the real `/v1/chat` endpoint with the real
answer shape strings copied verbatim from IntentClassifier.ts.

    oracle      the ground truth label's shape. The ceiling.
    none        always `general`. This is deleting the classifier.
    production  the shape the shipped three-tier classifier picks.
    router      the shape the new MiniLM head picks.

## The shape does what it says

On the six held out coding questions, whether a runnable code block came back:

    oracle      6 of 6
    router      6 of 6
    none        3 of 6
    production  2 of 6

The `coding` shape works. Told to produce a full implementation the model
produces one, and told to respond conversationally it produces code about half
the time on real transcript questions.

Worth recording that an earlier run of this same test on eight hand written
questions showed none at 5 of 5, which flattered the no classifier case. Those
questions were unmistakable code requests. Real transcript lines are subtler,
and the convenience sample hid the difference the corpus reveals.

## And the answer is still worse

Blind pairwise, both answers presented in a randomised order, judged on
usefulness to a candidate reading the answer while speaking in a live interview:

    none versus oracle       21 to 11 for none
    none versus production   20 to 12 for none
    none versus router       22 to 10 for none

Deleting the classifier beats a PERFECT classifier about two to one, and beats
the router this campaign built by more than that.

## Why both are true

Mean answer length on coding questions:

    router      3921
    oracle      3072
    production  1995
    none        1509

The `coding` shape asks for "a FULL, complete, working and production-ready code
implementation". It gets one. Nearly four thousand characters is the correct
response to that instruction and the wrong artifact for someone reading a screen
while talking.

So the shape is not broken. It is aimed at the wrong target. It was written for
a candidate typing into a shared editor and it is being served to a candidate
speaking out loud.

That is a product defect in the answer shapes, not an accuracy defect in the
classifier, and no improvement to classification fixes it. A better classifier
selects the wrong instruction more reliably.

## What this means for the campaign

Repairing or upgrading the classifier is not worth it. The router is measurably
better at picking the label, 49.1 percent against production's 29.4, and picking
the label better makes the answer worse, because the labels point at
instructions that do not suit the surface.

Deleting the classifier is defensible on this evidence and it gives up
something real: three of six coding questions lose their code block.

The third option is the one the evidence actually points at. Keep a router,
because knowing a turn is a coding turn is genuinely useful, and rewrite the
answer shapes for the surface they are served on. A `coding` shape that asked
for the approach in two sentences followed by a short code block would plausibly
beat all four conditions here, and nothing in this campaign has tested it.

## Limits, which are not small

One judge, and it is the same model family that generated the answers, so a self
preference cannot be excluded.

The judging criterion names usefulness while speaking, which favours brevity by
construction. A coding interview conducted in a shared editor would plausibly
invert the result, and Natively serves both.

32 questions and a single run per condition. The direction is consistent across
all three comparisons and the margin is roughly two to one, which is more than
sampling noise at this size, but it is one experiment.

No human judged any of it.
