# The router has never seen a cold start, 2026-09-05

Measured on the retrained MiniLM multi-head, English held out split, 1,011 rows.

    with history, as trained      needs_response macro F1  78.5
    history stripped, cold start  needs_response macro F1  68.3

A 10.2 point drop, on a case that happens at the start of every session.

## Why it was invisible

Every row in the 5,328 row corpus carries history. Not most of them. All of
them. The generator was asked for realistic turns in context and it produced
context every time, so the model was never shown an input with an empty history
field and its behaviour there was never measured.

Production has that input. The first turn a user speaks into a fresh session has
no prior turns to show the router, and the second and third have less history
than any training row. The router is out of distribution exactly when a session
starts, which is also when a wrong answer is most visible.

## What it looks like

The turn "so can you walk me through how you would shard that" in a technical
interview, arriving on the system channel from the interviewer.

    with history      needs_response=yes   dialogue_act=ask
    without history   needs_response=no    dialogue_act=statement

The model reads a direct question to the user as a statement needing no reply,
purely because nothing preceded it. In production that is the assistant sitting
silent through the first question of an interview.

## Why the benchmark did not catch it

Because the benchmark measures the corpus, and the corpus has the same blind
spot. Every held out row carries history too, so the held out score is a fair
measurement of a distribution that production only partly matches. The number is
not wrong. It answers a question that is narrower than the one that matters.

This is the general hazard of a generated corpus. A generator asked for
realistic examples produces the examples a describer thinks of, and the cases
nobody describes are absent from both the training set and the test set, so the
absence never shows up as a failure.

## The fix

History is a feature the model reads, so the fix is to teach it that the feature
can be empty rather than to hide the case. A fraction of training rows get a
history stripped copy carrying the same labels, because whether a turn needs a
response does not change when the transcript before it is unavailable. The
stripped copy stays in the same split as its source, for the same reason the
corpus split is grouped: the pair shares an input, and separating them would put
the answer on both sides of the boundary.

The held out set gets the same treatment, so the cold start case is measured
rather than assumed, and the two conditions are reported separately.

## What is not yet done

The augmentation is implemented but not yet run. The numbers above are from the
model as trained today, and the comparison against the shipped classifier is
scored on the corpus as it stands. Both will be re measured after the
augmentation, and both sets of numbers reported, because the difference between
them is the size of this defect.
