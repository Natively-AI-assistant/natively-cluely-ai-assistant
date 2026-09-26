# Does the classifier earn its place at all, 2026-09-05

Evin asked the question the candidate matrix never included: what happens with
no classifier? If the product works without one, every model in the matrix is
complexity being justified after the fact.

It is the right question and the answer is not the one the campaign assumed.

## The measurement

Two constants, both trivial by design. `always answer` never stays silent.
`always general` gives every turn the same answer shape. A candidate that cannot
beat a constant is not earning the worker thread it runs in.

Legacy intent, the axis that selects the Answer Shape prompt fragment. English
held out split, 1,367 rows. Production weighted is the share of real traffic the
candidate gets right, using the label shares measured over 32,919 live turns.

    candidate                    macro F1   production weighted
    no classifier, always general     8.6                 37.5%
    production, the shipped one      15.2                 29.4%
    head-minilm, the new router      38.7                 49.1%

## The shipped classifier is worse than nothing

29.4 percent against 37.5 percent. Three tiers, ten regex rules, a 121 MB
MobileBERT in a worker thread with a poison sentinel and a concurrency slot, and
it picks the answer shape less accurately than a constant string does.

This is a stronger result than the campaign was arguing for. The brief's premise
was that the taxonomy is wrong for eight of the nine modes and the classifier is
weak. The measurement says something blunter: on real traffic it is a net
negative, and deleting it without replacing it would improve answer shape
selection by 8.1 points.

Macro F1 disagrees, 15.2 against 8.6, and both numbers are true. Macro F1
averages classes equally, so a constant is punished correctly for never
producing the seven rarer labels. Production weighted asks how often the answer
shape was right on the traffic that actually occurs. For a product decision the
second question is the one that matters, and for a modelling decision the first
is. The disagreement between them is itself the finding: the shipped classifier
buys coverage of rare labels and pays for it with the common case.

## The router does earn its place, on this axis

49.1 percent against the constant's 37.5 percent, so 11.6 points of real traffic
where the answer shape is right and would not have been. That is the argument
for the router, and it is a different argument from the one the campaign opened
with.

## On needs_response the router buys cost, not correctness

This needs saying plainly because the headline number invites the wrong reading.

    no classifier, always answer   36.0 macro F1
    head-minilm                    78.2 macro F1

That gap looks decisive and it does not mean what it appears to. Today, with no
router, a speculative turn that should be silent still generates, the model
returns the mode's silence string, and the sentinel branch discards it before
anything reaches the screen. The user already sees the correct thing. What the
6.1 percent costs is compute, latency and tokens, not a wrong answer.

So on this axis the router is an optimisation, not a correction. And it carries a
risk the constant does not: every turn it wrongly silences is an answer the user
received today and would not receive, on the speculative path where they never
learn it was suppressed. That is why PR 7 gates at 0.90 confidence, why PR 9
reports `router_would_silence` as a separate cell rather than folding it into an
accuracy, and why PR 11's gate vetoes on it.

## What follows

Three things, and they are separable.

Delete the shipped classifier. It is worse than the constant on the axis it
exists to decide, and that conclusion does not depend on the router shipping.
PR 11 already stages this, gated on the shadow run, and the gate should now
record that the floor to beat is the constant rather than the shipped model.

Ship the router for answer shape. 49.1 against 37.5 is the honest case for it.

Treat needs_response separately and conservatively. It is a cost saving with a
correctness risk attached, the two are not the same kind of change, and the
shadow run is what decides whether the saving is worth the risk.

## What this does not say

The constant was not tested against user satisfaction, only against labels. A
generic answer shape may read worse than a specific one even when the specific
one is chosen wrongly, and nothing here measures that. The shadow run's
regenerate and dismiss signals would, and those signals do not exist yet.
