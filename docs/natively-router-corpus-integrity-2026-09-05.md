# Router corpus integrity, 2026-09-05

Five defects in the benchmark harness, found while preparing the corpus the
model decision will be made on. Four of them delete data silently. None of them
throws. All five are fixed and guarded.

The reason to write this down is that every one of them would have shown up as a
bad model rather than a bad harness. A benchmark that quietly discards its
hardest rows still produces a ranking, and the ranking looks fine.

## 1. A label-blind dedupe key deleted every adversarial pair

The `trap` category exists to produce pairs of turns that are near-identical in
wording and carry different labels, so that a keyword matcher gets one of them
wrong. The disambiguator is the mode, the channel and the recent history, all of
which the provider text puts in front of the model.

Three layers deduplicated those rows, and all three keyed on the input alone.

The realism gate rejected the cell for exceeding a 2 percent duplicate ceiling.
The generator's writer key was `mode::input`, so a pair that cleared the gate
lost a member on the way to disk. The finalize merge built the same key by hand
a third time.

This is why the corpus contained no same-mode input collisions at all. Not
because the generator never produced them, but because they were counted as
duplicates and thrown away.

There is now one `dedupeKey` in the schema lib, keyed on mode, normalised input
and the label signature, used by all three call sites. Rows agreeing on all
three are still repeats and are still dropped.

Measured on the v2 corpus, of 54 colliding input strings, 13 carried different
labels and all 13 were separable from the context the model sees. The other 41
were same-label repeats. So the ceiling for `trap` moved to 0.20 rather than
being removed, and a label-aware check in the generator catches the laziness the
old ceiling was catching.

## 2. Three categories rejected every cell

`fragment`, `ambiguous` and `trap` are 32 percent of the corpus by design and
were rejecting at 100 percent. Losing them skews the holdout toward
`no_response` and `normal_request`, which makes every headline number easier
than production.

`fragment` is defined by length and its brief never said so. It now asks for two
thirds of turns at five words or fewer.

`ambiguous` failed a 5 percent repair floor that is unhittable exactly at a
batch of 24, where the reachable values are 4.17 and 8.33 percent. The brief now
asks for restarts in roughly one turn in six, which clears the floor with margin
instead of landing on it.

`trap` is defect 1.

## 3. The ambiguous brief asked for a label the schema rejects

`needs_response` collapsed to yes or no when `optional` was migrated away, and
line 63 of the prompt says so plainly. The `ambiguous` brief three lines later
still instructed the generator to use `needs_response="optional"`, and one
required trap did too.

`validateRow` rejects that value. The entire calibration category would have
been generated, paid for, and dropped as schema-invalid an hour downstream.

The brief now expresses borderline-ness inside the binary taxonomy: pick the
answer you would defend, and record in notes the reason you nearly chose the
other one. A test reads every brief and every required trap and checks the
`needs_response` values they ask for against the schema.

## 4. The trainer and the server built the text independently

The multi-head model is fine-tuned in Python and served in Node. Each side built
the string the encoder sees from its own copy of the same format, in a different
language, with no guard between them.

They agree today, verified byte for byte over 200 real rows. If they ever stop
agreeing the model trains on one format and predicts on another, nothing throws,
and the accuracy drop reads as a bad model. There is now a test that runs both
and diffs them. Removing one field from the Node side turns it red.

## 5. A top-up would have been deleted by the merge

`--continue-from` takes one path and seeds both the per-mode id sequence and the
cross-batch dedupe from it. Seeding a top-up from the original baseline restarts
ids at that baseline's maxima, which the expansion has already run past, so
every top-up id collides with an expansion id. The merge drops colliding ids and
reads the expansion first, so the whole top-up disappears.

Measured before the fix: all twelve modes collide. The chain now builds its
sequence baseline from the entire corpus generated so far and asserts a zero
collision count before continuing.

## Every trained head on disk is stale twice over

`minilm`, `tiny`, `deberta` and `modernbert` were all fitted on the old split, so
each has seen part of the new holdout. All four also carry the old three-class
`needs_response` of no, optional and yes, from before the taxonomy collapsed
optional into no.

Neither problem is visible in a score. Both make a score meaningless. No number
from any of these four artifacts may be reported against the new corpus, and the
old exports are moved aside rather than overwritten so the replacement is
provable.

## What is not measured here

No model was scored for this document. The corpus was still generating while it
was written. The benchmark numbers and the model decision are a separate report.
