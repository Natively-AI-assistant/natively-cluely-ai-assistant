# Authoring addendum — `pack24`: a realistic larger reference pack (2026-10-09)

Read `AUTHORING-ER.md` first (sections 0, 2, 3 and 6) and `AUTHORING-ER-CHALLENGE.md` (the part "Every item must be
checkable WITHOUT a judge"). Everything there still holds. This addendum says what is different.

## Why this set exists
The frozen packs are 9,000 to 10,000 tokens each. A real user often loads two to three times that: the price list AND
the contract AND the release notes AND a second case study. This set makes four of the packs that size by ADDING
documents of the same fictional world, so that the existing questions can be asked again with the larger pack
loaded, and a few new questions can be asked that need the added documents.

You work on ONE mode. Your folder is `evidence-rich/pack24/authoring/<mode-key>/`. It already holds:

* `manifest.json` and `src/`: the frozen documents of this mode, copied. **Do not change any of them.**
* `configs.json`: one config, `<mode-key>-p24`, listing the frozen files.
* `p24.json`: the existing development questions of this mode, re-issued for the larger pack. Read it, never edit it.

## What you write
1. **4 to 6 new documents** in `src/`, each with an entry appended to `manifest.json` `files` (schema of
   `AUTHORING-ER.md` section 3, facts with `doc_needles` included), and each id appended to the `files` of the one
   config in `configs.json`. File ids `<PFX>-REF-<SLUG>` that do not exist yet.
2. **`p24-new.json`**: `{ "mode": "<mode-key>", "items": [ … ] }`, 12 items, ids `ER-P24-<PFX>-N-001` … `-012`,
   `evidence_config` `<mode-key>-p24`, `pi_state` `"none"`, schema of `AUTHORING-ER.md` section 6.

Write nothing anywhere else.

### Size (this is the point of the set, so measure it)
After your additions, the source files of the pack must total **82,000 to 90,000 characters**
(`cat evidence-rich/pack24/authoring/<mode-key>/src/* | wc -c`). The frozen files are about 38,000 of that, so you
add 44,000 to 52,000 characters, roughly 7,000 to 8,000 words. Never above 90,000.
At least one new document is long: 11,000 to 15,000 characters (a contract, a handbook chapter, a full set of
notes, a report). The others 5,000 to 11,000 each.

### What the new documents are
Documents the same person would really also have loaded: same company, product, course, study, people and dates as
the frozen pack (read the `world` line of the manifest and every frozen source first). They cover ADJACENT subject
matter, in the same voice and with the same level of detail, distractors and near-miss values as the frozen ones
(hard rules 1, 3, 4 and 9 of `AUTHORING-ER.md`). Mix the formats a real user would have (`pdf`, `docx`, `md`, `txt`,
`csv`). Mark status and dates as real documents do.

### What the new documents must NOT do (the existing questions must keep their answers)
1. **No existing fact is restated, updated, widened, narrowed or contradicted.** Do not repeat a frozen fact's value.
   Write about other things: if the frozen price list has the plan prices, your contract refers to "the fees in the
   Order Form" and never prints a price of a plan.
2. **Stay silent where the frozen pack is silent on purpose.** Go through `p24.json`: for every item with condition
   `missing_evidence` or `irrelevant_source`, for every `forbidden_claims` entry of kind `fabrication`,
   `false_denial` or `unauthorized_promise`, and for every `must_not_infer` line of the frozen manifest: your
   documents must not state, imply or deny that thing. (If an item asks whether the product is HIPAA compliant and
   the right answer is "not established", no new document may mention HIPAA.)
3. **No new version of a frozen document.** Nothing you write supersedes, amends or is superseded by a frozen file.
   Version pairs (current against outdated, or two current documents that disagree) are welcome BETWEEN two of your
   own new documents, declared in `intentional_conflicts`.
4. **No number collisions.** Run
   `node evidence-rich/pack24/check-noninterference.mjs <mode-key>` from `benchmarks/natively-answer-quality`.
   It lists every frozen needle (a fact's `doc_needles`, an existing item's required or forbidden
   `answer_needles`) that occurs in one of your documents. A listed needle that contains a digit must be removed
   from your document (choose another number). A listed needle without a digit is allowed only when it is an
   ordinary word or a name used for something else, and never when your sentence is about the same fact.

### The 12 new items (`p24-new.json`)
Every item needs at least one of your new documents. Every item is checkable without a judge: `answer_needles` on
every required fact, `calculation_oracle` with `accepted_forms` and `wrong_results_common` on every calculation,
`forbidden_claims` with `answer_needles` on every trap.

| Count | Kind | What makes it hard | `condition` |
|---|---|---|---|
| 3 | Needs the whole pack | The right answer needs facts from three or more documents, at least one frozen and at least one new: everything that applies to one case, a count across documents, a total with one part in each. | `multi_source` |
| 2 | Calculation across old and new | One input in a frozen document, one in a new one. A near-miss input sits somewhere in the pack. | `multi_source` |
| 2 | A fact deep in the long document | The fact is in the last third of your long document; a near-miss (another tier's, another year's, another person's value) is in its first third. | `grounded_single` |
| 2 | Version conflict between two new documents | One where the current one replaces an outdated one (forbidden needle: the old value given as the answer). One where two current documents disagree and nothing settles it (`known_conflicts` filled, both values required). | `conflict_stale` |
| 2 | Absent | The question invites a specific answer no loaded document holds; a neighbouring fact in a new document makes an invention tempting. Tempting inventions go in `forbidden_claims` with needles. | `missing_evidence` |
| 1 | Which value belongs to which thing | A new document states the same kind of value for several things; the question asks about one. Forbidden needles: the others' values. | `grounded_single` |

About 60 % `hotkey` / `other` (live speech), the rest `typed` / `user`. Questions paraphrase (hard rule 2).

## Stay blind to the product
Do not read anything under `evidence-rich/results/`, `evidence-rich/judge/`, `evidence-rich/docs/`,
`evidence-rich/limits/`, `evidence-rich/report/`, `evidence-rich/replay-variants/`, `evidence-rich/authoring-holdout/`,
`evidence-rich/pack24/results/` or the benchmark's `docs/` folder. You do not need to know how the product works.

## Check your work
From `benchmarks/natively-answer-quality`:

```
ER_AUTH_DIR=evidence-rich/pack24/authoring ER_EVID_DIR=evidence-rich/pack24/evidence ER_BENCH_DIR=evidence-rich/pack24 \
  ER_APP_ROOT=/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/er-main node evidence-rich/build.mjs lint
node evidence-rich/pack24/check-noninterference.mjs <mode-key>
```

The lint always prints three errors per mode about missing `dev.json`, `cf.json` and `holdout.json`: ignore those.
Fix until there is no other error for your file ids and your `ER-P24-<PFX>-N-` ids. Never run `evidence`, `freeze`
or `verify`. Then by hand: recompute every calculation and date; confirm each needle is in a correct answer and each
forbidden needle is not; confirm every absent fact is absent from ALL documents of the pack, frozen ones included.

## Report back
One short message: the new files with their character counts and the pack total; the 12 items by kind; the lint
result for your ids; the output of the non-interference check and what you did about each line; which
`missing_evidence` items and `must_not_infer` lines of the frozen pack you checked your documents against; anything
you could not do.
