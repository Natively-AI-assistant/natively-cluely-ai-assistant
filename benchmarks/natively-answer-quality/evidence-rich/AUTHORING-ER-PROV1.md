# Authoring addendum — `prov1`: whose fact is it, and where does it come from (2026-10-09)

Read `AUTHORING-ER.md` first (sections 0, 3, 5, 6 and 8), `AUTHORING-ER-DEV2.md` and `AUTHORING-ER-CHALLENGE.md`.
Everything there still holds: the documents and their truth are frozen, facts are referenced as `<FILE-ID>#F<n>`,
only existing configs and `pi_state` values are used, and you stay blind to the product. This addendum only says what
is different. It is for the two modes that use the candidate's profile: `looking-for-work` and `technical-interview`.

## Why this set exists
A fact on a résumé belongs to one employer, one job title and one period. A job posting says what an employer wants;
it says nothing about what the candidate has done. This set asks questions that are only answered correctly when
that is kept straight. Every item must be checkable WITHOUT a judge wherever a string can do it.

## What you write, for ONE mode
1. `evidence-rich/authoring/<mode-key>/prov1.json`: 12 items, ids `ER-PV1-<PFX>-001` … `-012`
2. `evidence-rich/authoring-holdout/<mode-key>/prov1-val.json`: 12 items, ids `ER-PVV1-<PFX>-001` … `-012`

Both: `{ "mode": "<mode-key>", "items": [ … ] }`, schema of `AUTHORING-ER.md` section 6. The second file is the
untouched validation part: the engineer never reads it. Same standard and same mix, on DIFFERENT facts and question
shapes from your first 12. Use both profiles (A and B) in each file, about half each.

### The 12 items of each file
| Count | Kind | What it asks | Checks |
|---|---|---|---|
| 4 | Which employer, which title | The résumé is loaded. Where or under which job title did a named piece of work happen (a project, a migration, an achievement, a number)? Or the other way round: what did they do at employer X, in role Y? At least two of the four are about an employer where the résumé shows MORE THAN ONE job title, or about the job right before or after a change of employer. | `required_facts` needle: the right employer or title. `forbidden_claims` (`fabrication`) needles: the résumé's OTHER employers or titles, where naming them would be the wrong answer. Make sure a correct answer has no reason to mention the forbidden name. |
| 3 | A length of time from the résumé's dates | How long at an employer in total (across its job titles), how long at a given title or level, how long between two events, counted to October 2026 where the job is current. Say in the question how to count if it is ambiguous ("years and months"). | `calculation_oracle` computed twice, `accepted_forms` with every way to say it ("3 years 7 months", "3 years and 7 months", "43 months", "about three and a half years" only if the question allows rounding), and `wrong_results_common`: what you get from the neighbouring date (the promotion date instead of the joining date, the previous job's end date, the wrong year). |
| 3 | Their own history, with only the posting loaded | `pi_state` `A-JD` or `B-JD` and a config without other candidate documents. The question asks for something only the candidate's own record could hold: their current job, a past project of the kind the posting describes, the size of their team, how many years they have done something. Right behaviour: do not invent it and do not hand the posting's content back as their own experience; stay useful in the first person. | `condition` `missing_evidence`. `forbidden_claims` with needles for what CAN be caught by a string: the real employer and project names of that profile's résumé (not loaded here), the OTHER profile's names, and any number or name from the posting that would only appear if the posting were retold as their history AND that a correct answer has no reason to say. Where no string can catch the invention, leave `answer_needles` empty and describe it in `claim`. |
| 2 | A fact of the posting, with only the posting loaded | Same `pi_state` as above; the answer IS in the posting and must be given plainly (what the team owns, the interview steps, the level, the stack). These make sure a careful system does not become shy. | `condition` `grounded_single`. `required_facts` with needles. |

Looking for work: spoken items are the interviewer speaking (`hotkey` / `other`), typed items are the candidate
asking the assistant (`typed` / `user`). About 60 % spoken. Technical Interview: the same.

## New questions only
Read this mode's `dev.json`, `dev2.json`, `challenge.json` and the files under
`authoring-holdout/<mode-key>/` so you do not repeat them. Do not copy, quote or describe any holdout item, or any
item of your own `prov1-val.json`, in what you report.

## Stay blind to the product
Do not read anything under `evidence-rich/results/`, `evidence-rich/judge/`, `evidence-rich/docs/`,
`evidence-rich/limits/`, `evidence-rich/report/`, `evidence-rich/replay-variants/`, `evidence-rich/pack24/` or the
benchmark's `docs/` folder.

## Check your work
From `benchmarks/natively-answer-quality` run `node evidence-rich/build.mjs lint`. Look at the lines that start with
your `ER-PV1-<PFX>-` ids, and at `authoring-holdout/<mode-key>/lint-prov1-val.txt` for the validation file. Fix until
there is no error for your items. Never run `freeze`, `evidence` or `verify`. Then, by hand for all 24 items:
recompute every length of time from the résumé's own dates; confirm the employer and title of every "which
employer" item against the résumé source, line by line; confirm each needle is something a correct answer contains
and each forbidden needle is not; confirm every `missing_evidence` fact is really absent from everything its config
and `pi_state` load.

## Report back
One short message: the two files written, counts per kind and per profile, the lint result for your ids (errors 0,
warnings quoted), and anything you could not do. No content of `prov1-val.json`.
