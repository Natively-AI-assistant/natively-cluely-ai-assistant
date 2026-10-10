# Authoring addendum — `challenge`: a harder supplementary set (2026-10-09)

Read `AUTHORING-ER.md` first (sections 0, 3, 5, 6 and 8) and `AUTHORING-ER-DEV2.md`. Everything there still holds:
the documents and their truth are frozen, facts are referenced as `<FILE-ID>#F<n>`, only existing configs are used,
and you stay blind to the product. This addendum only says what is different.

## Why this set exists
The development sets are mostly answered well. What is left is a thin spread of mistakes of a few kinds, too few of
each to measure a fix. This set concentrates those kinds so that one run shows how often each goes wrong. Nothing in
it may be easy: a question a careful person answers by reading one sentence does not belong here.

Every item must be checkable WITHOUT a judge. That is the point of the set:

* every required fact has `answer_needles` that a correct answer contains and a wrong answer does not;
* every calculation has a `calculation_oracle` computed twice, with `accepted_forms` (every way a person would say or
  write the result) and `wrong_results_common` (the results the likely mistakes give, each a string a wrong answer
  would contain and a right answer would not);
* every trap has a `forbidden_claims` entry WITH `answer_needles` where a wrong answer has a nameable string (the
  other plan's price, the outdated value, the other entity's figure, the invented thing a careless reader would say).

## What you write, for ONE mode
1. `evidence-rich/authoring/<mode-key>/challenge.json`: 12 items, ids `ER-C1-<PFX>-001` … `-012`
2. `evidence-rich/authoring-holdout/<mode-key>/challenge-val.json`: 6 items, ids `ER-CV1-<PFX>-001` … `-006`

Both: `{ "mode": "<mode-key>", "items": [ … ] }`, schema of `AUTHORING-ER.md` section 6. The second file is the
untouched validation part: the engineer never reads it. Write it to the same standard and with the same mix, on
DIFFERENT facts and different question shapes from your 12, so that it tests whether a fix generalises.

### The 12 items of `challenge.json`
| Count | Kind | What makes it hard | `condition` |
|---|---|---|---|
| 3 | Calculation from two or more documents | Each input is in a different document, or one input is said in `prior_transcript`. At least one item has a near-miss input sitting in the pack (another plan's price, last year's rate, a one-time fee next to a monthly one, a monthly figure where the question wants a year). | `multi_source` |
| 2 | Date or time counted from document rules | A deadline, a last day, a start date, a length of service, business days, a time-zone conversion: whatever this mode's documents really support. The weekday must be right. Give the result's date in every spoken and written form in `accepted_forms`, and the off-by-one dates in `wrong_results_common`. If the mode's documents support no date arithmetic at all, write 2 more calculation items instead and say so in your report. | `grounded_single` or `multi_source` |
| 2 | Which value belongs to which thing | The pack states the same kind of value for several things (plans, people, sites, versions, studies, tiers). The question asks about one, or compares two. `forbidden_claims` needles are the other things' values. | `grounded_single` or `multi_source` |
| 2 | Version conflict | One where a current document replaces an outdated or draft one (the right answer is the current value; the forbidden needle is the old value given as the answer). One where two current documents really disagree and nothing settles it (the right answer names both; `known_conflicts` filled). | `conflict_stale` |
| 2 | Absent policy, company fact or personal fact | The question invites a specific answer the loaded material does not hold, and a neighbouring fact makes an invention tempting. The right answer says what is known and does not supply the missing thing. Put the tempting inventions in `forbidden_claims`, with needles where a string can catch them. At least one uses the mode's empty config or a config that leaves the deciding file out. | `missing_evidence` |
| 1 | Follow-up chain of two turns | Turn 2 cannot be answered without turn 1 ("and what would that come to for the year?", "why that one and not the other?", "are you sure about the second figure?"). Counts as ONE of the 12 only if you write both turns as two items sharing a `conversation_id`; then the table above has 11 other items and this chain's two. | `followup` |

Technical Interview only: replace the two "which value belongs to which thing" items with two coding items that have
a `code_oracle` (section 6): a function with a tie-breaking or edge-case rule stated in the question, at least 8 tests
including empty input, ties and the largest case the statement allows, written so that the usual almost-right
solution fails at least two tests. Compute every expected output by hand and again by running a reference solution.

### The 6 items of `challenge-val.json`
2 calculation (one of them a date or time), 1 which-value, 1 version conflict, 1 absent fact, 1 single-turn follow-up
that carries its earlier turn in `prior_transcript`. Technical Interview: the which-value item is a coding item.

### Counterfactual pair (one per mode, inside the 12)
Two of your 12 items must ask the SAME question under two existing configs that make the right answer different
(for example the full pack against a config that drops or swaps the deciding file). Give both the same
`"cf_pair": "<short label>"`. The lint warning "same question text already used in this mode" is expected for that
pair only.

### Surfaces and profile states
About 70 % `hotkey` in the live modes, about 50 % in general and lecture. Looking for work and Technical Interview:
use at least three different `pi_state` values across the 12.

## New questions only
Read this mode's `dev.json`, `dev2.json` and `authoring-holdout/<mode-key>/holdout.json` so you do not repeat them.
Do not copy, quote or describe any holdout item, or any item of your own `challenge-val.json`, in what you report.

## Stay blind to the product
Do not read anything under `evidence-rich/results/`, `evidence-rich/judge/`, `evidence-rich/docs/`,
`evidence-rich/limits/`, `evidence-rich/report/`, `evidence-rich/replay-variants/` or the benchmark's `docs/` folder.

## Check your work
From `benchmarks/natively-answer-quality` run `node evidence-rich/build.mjs lint`. Look at the lines that start with
your `ER-C1-<PFX>-` ids, and at `authoring-holdout/<mode-key>/lint-challenge-val.txt` for the validation file. Fix
until there is no error for your items. Never run `freeze`, `evidence` or `verify`. Then, by hand for all 18 items:
recompute every calculation and every date (check the weekday against a calendar you compute, not from memory);
confirm each needle is something a correct answer contains; confirm each forbidden needle is not; confirm every
`missing_evidence` fact is really absent from everything its config loads.

## Report back
One short message: the two files written, counts per kind, how many calculation and date items, the lint result for
your ids (errors 0, warnings quoted), and anything you could not do. No content of `challenge-val.json`.
