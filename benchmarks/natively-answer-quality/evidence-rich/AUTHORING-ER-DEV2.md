# Authoring addendum — `dev2`: 40 more development items per mode (2026-10-04)

Read `AUTHORING-ER.md` first (sections 0, 3, 5, 6 and 8). Everything there still holds. This addendum only says what
is different for `dev2`.

## What you write
ONE file for ONE mode: `evidence-rich/authoring/<mode-key>/dev2.json`

```json
{ "mode": "<mode-key>", "items": [ /* 40 items, schema of AUTHORING-ER.md section 6 */ ] }
```

* Ids: `ER-D2-<PFX>-001` … `ER-D2-<PFX>-040` (same prefixes as the brief: GEN, SALES, REC, TEAM, LFW, LEC, TI, SEM, CC).
* Counts, exactly: 15 `grounded_single`, 8 `multi_source`, 7 `conflict_stale`, 4 `irrelevant_source`,
  4 `missing_evidence` (at least one with the mode's empty config), 2 `followup` (one two-turn chain).
* At least 6 items need arithmetic or a date computed from document values (`requires_calculation` with a
  `calculation_oracle`, computed twice), where the mode allows it.
* Surfaces as in the brief: about 70 % `hotkey` in the live modes, about 50 % in general and lecture.
* Looking for work and Technical Interview: spread `pi_state` and `pi_condition` over all their values, with no value
  used for more than 9 of the 40 items.

## What you must NOT change
The documents and their truth are frozen. Do not edit or add anything in `manifest.json`, `src/`, `variants.json`,
`configs.json`, `dev.json`, `cf.json`, or anything under `authoring-holdout/`. Use only:
* facts that already exist in this mode's `manifest.json` (and, for the two profile modes, in
  `authoring/profiles/`), referenced as `<FILE-ID>#F<n>`; `"CONVERSATION"` for a fact you put in `prior_transcript`;
* evidence configs that already exist in this mode's `configs.json`.
If a question you would like needs a value that is in a document but is not a manifest fact, do not ask it.

## New questions, not rewrites
* Read this mode's `dev.json` and `authoring-holdout/<mode-key>/holdout.json` so you do not repeat them. A `dev2` item
  must not ask the same thing as an existing item with other words. Prefer facts no existing item uses; when you
  reuse a fact, the question must need something else from it (another angle, a calculation, a combination).
* Do not copy, quote or describe any holdout item in what you report back. It is a blind set.
* Keep the spread of the brief: easy lookups, near-miss traps (another plan's price, last year's number), questions
  that need two documents, questions the material deliberately cannot answer, and questions the material should NOT
  be dragged into.

## Stay blind to the product
Do not read anything under `evidence-rich/results/`, `evidence-rich/judge/`, `evidence-rich/docs/`,
`evidence-rich/limits/`, `evidence-rich/report/` or the benchmark's `docs/` folder. They hold the product's answers
and the engineer's analysis; items written with them in view would be tailored. You need only the brief, this
addendum, and the mode's authoring folder.

## Check your work
From `benchmarks/natively-answer-quality` run:

```
node evidence-rich/build.mjs lint
```

It prints errors and warnings for every mode; look at the lines that start with your `ER-D2-<PFX>-` ids and at the
`<mode-key> dev2:` count warnings. Fix until there is no error for your items and the counts match. Never run
`freeze`, `evidence` or `verify`. Then go through section 8 of the brief by hand for your 40 items (needles are
substrings a correct answer would contain; an outdated value's needle is not something a correct answer contains;
every calculation recomputed; every `missing_evidence` fact really absent from everything the config loads).

## Report back
One short message: the file you wrote, the item count per condition, how many calculation items, the lint result for
your ids (errors 0, any warnings quoted), and anything you could not do. No holdout content.
