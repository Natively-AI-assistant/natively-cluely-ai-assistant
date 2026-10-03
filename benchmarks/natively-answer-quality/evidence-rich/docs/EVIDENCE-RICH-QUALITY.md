# Evidence-rich benchmark v1 — how close Natively gets when it has the right information

2026-10-03. Build under test: `e000db4a` (fix13, the kept build). One fix was built, measured and kept on its own
branch (`bab77f33`, not on main). Every score in this report is from the **provisional judge, Claude Opus 5.5**
through Claude Code, under the new charter `er1-ebec3e9a021e` (calibration 38 of 38). gpt-6-astra, the canonical
judge, was closed all day (402 on both keys); a chain is armed to re-judge when its batch opens. No Opus number
here may be pooled or compared with the earlier gpt-6-astra series.

Method in one paragraph: 72 synthetic reference files and two résumé + job-description pairs, built as real PDF,
DOCX, Markdown, CSV, text and code files, were uploaded through the product's own upload and profile paths (nothing
injected as text). Every mode kept its whole pack loaded at once, as a user would. Each case has an oracle written
before any answer existed. Whether the needed fact was in the prompt is measured by code from the prompt that was
sent, so "retrieval" and "generation" are separated without a judge.

## 1. The answer

**If users give Natively realistic Reference Files and Profile Intelligence, the kept build answers correctly
about half the time, and the reason is not the answer model.** Every file is ingested without loss, but only about
half of the facts a question needs are put into the prompt. When the fact is there, answers average 8.9; when it is
not, 5.7. A one-constant change that hands a pack that fits over whole raised the share of needed facts in the
prompt from 51 % to 96 % and the score from 7.4 to 8.2 on the blind set, with a faster first word on heard turns.
Past that, the remaining loss is in the answer engine: the claim pass removes facts the files state, outdated
files are sometimes treated as live, and the résumé is still served six passages at a time.

| | Baseline `e000db4a` | With the fix `bab77f33` |
|---|---:|---:|
| Dev + counterfactual (333 rows) | 7.46 | 8.26 (+0.80 ±0.28) |
| Holdout (180 rows, blind) | 7.40 | 8.17 (+0.77 ±0.41) |
| Needed fact in the prompt (reference files) | 51 % | 96 % (dev + counterfactual 232 / 244, holdout 132 / 135) |
| Hard fails, dev + counterfactual / holdout | 61 / 39 | 38 / 15 |
| Heard first word, median / p90 (dev) | 2,249 / 3,552 ms | 1,826 / 2,507 ms |

**Target check** (rows whose needed evidence was in the prompt; target mean ≥ 9.2, 10th percentile ≥ 8.5, critical
hard fails < 1 %):

| | n | Mean | p10 | Critical |
|---|---:|---:|---:|---:|
| Baseline, dev + counterfactual + holdout | 195 | 8.91 (±0.22) | 6.9 | 3.1 % |
| With the fix, dev + counterfactual + holdout | 365 | 8.48 (±0.20) | 4.3 | 4.1 % |

The targets are not met by either build. With the fix, four times as many rows have their evidence and the mean on
them is lower than the baseline's delivered mean, because the baseline's delivered rows were the easy ones
(single-file facts: 9.28) and because the claim pass now edits many more correct answers (section 6).

## 2. Verdict (the frame written before the data)

The rule in `BASELINE-PLAN.md` names the bottleneck from D (mean with the evidence in the prompt), N (mean
without), and s (share delivered).

| | D | N | s | Hard fails where the needed evidence was not in the prompt (reference or profile) |
|---|---:|---:|---:|---:|
| Dev + counterfactual | 8.89 (±0.27) | 5.70 (±0.42) | 50 % | 44 of 61 |
| Holdout | 8.95 (±0.40) | 5.60 (±0.54) | 46 % | 30 of 39 |

* By the letter of the rule this is **A (answer engine)**: D is under 9.0 on both sets. It is under by 0.11 and
  0.05, inside its own interval. Every other condition of **B (retrieval)** holds: s is far under 90 %, N is more
  than three points below D, and 74 of the 100 hard fails trace to evidence that never reached the prompt.
* The two added checks make it a measurement. With the question held fixed and only its own files loaded, the
  rows that had missed went 5.63 → 7.54 (+1.91 ±0.52), short of the 8.5 / +2.0 line I had set, because a long
  single file is still served in passages (58 of 106 delivered). With the whole pack in the prompt (the fix) the
  rows that had missed went 5.70 → 7.83 (+2.13 ±0.51) on dev + counterfactual and 5.60 → 7.79 (+2.19 ±0.67) on
  holdout, and the rows that were already delivered did not move (0.00 ±0.33; holdout −0.36 ±0.57).
* **So: D, mixed, and in this order.** Retrieval / context selection first (about two thirds of the loss). Then the
  answer engine with the evidence in hand (claim pass, precedence, arithmetic). Then missing knowledge, which is
  small in this corpus by construction and where Natively is mostly safe (7.45).

## 3. Scores by mode (dev + counterfactual + holdout, 57 rows per mode)

Baseline `e000db4a`:

| Mode | Overall | ±95 % | Evidence in the prompt (n) | Evidence not in the prompt (n) | Missing evidence (n) | Conflict / stale (n) | Hard fails |
|---|---:|---:|---:|---:|---:|---:|---:|
| General | 6.86 | 0.72 | 9.05 (21) | 4.55 (24) | 6.86 (7) | 4.96 (9) | 17 |
| Sales | 6.60 | 0.65 | 8.73 (17) | 5.20 (28) | 6.57 (7) | 5.02 (9) | 14 |
| Recruiting | 7.17 | 0.61 | 7.79 (20) | 5.53 (24) | 8.90 (7) | 5.87 (10) | 7 |
| Team Meet | 7.30 | 0.66 | 9.08 (25) | 4.60 (20) | 7.94 (7) | 7.30 (9) | 13 |
| Looking for work | 7.56 | 0.58 | 8.99 (17) | 6.32 (24) | 6.84 (9) | 5.51 (8) | 9 |
| Lecture | 8.83 | 0.47 | 9.38 (36) | 7.43 (9) | 7.53 (7) | 8.69 (9) | 3 |
| Technical Interview | 7.65 | 0.65 | 9.13 (19) | 6.38 (26) | 6.83 (7) | 6.28 (8) | 13 |
| Seminar | 8.07 | 0.64 | 9.35 (23) | 6.53 (22) | 7.59 (7) | 7.91 (10) | 9 |
| Call Center | 6.94 | 0.64 | 8.09 (17) | 5.47 (28) | 8.13 (7) | 5.36 (8) | 15 |
| **All (513)** | **7.44** | 0.21 | **8.91 (195)** | **5.66 (205)** | 7.45 (65) | 6.36 (80) | 100 |

With the fix `bab77f33`:

| Mode | Overall | ±95 % | Evidence in the prompt (n) | Evidence not in the prompt (n) | Missing evidence (n) | Conflict / stale (n) | Hard fails |
|---|---:|---:|---:|---:|---:|---:|---:|
| General | 8.27 | 0.57 | 8.70 (42) | 4.75 (3) | 7.47 (7) | 8.10 (9) | 5 |
| Sales | 7.08 | 0.67 | 7.16 (43) | 3.22 (2) | 6.23 (7) | 5.01 (9) | 13 |
| Recruiting | 8.47 | 0.48 | 8.48 (37) | 7.27 (7) | 9.24 (7) | 7.73 (10) | 5 |
| Team Meet | 8.40 | 0.47 | 8.60 (44) | 7.75 (1) | 8.38 (7) | 9.37 (9) | 3 |
| Looking for work | 8.11 | 0.54 | 8.77 (29) | 6.23 (12) | 7.49 (9) | 7.32 (8) | 6 |
| Lecture | 8.92 | 0.52 | 9.45 (45) | – | 5.54 (7) | 9.45 (9) | 6 |
| Technical Interview | 8.26 | 0.57 | 8.94 (35) | 6.64 (10) | 6.19 (7) | 8.23 (8) | 9 |
| Seminar | 8.74 | 0.40 | 8.62 (45) | – | 9.07 (7) | 8.66 (10) | 0 |
| Call Center | 7.84 | 0.51 | 7.76 (45) | – | 7.31 (7) | 7.63 (8) | 6 |
| **All (513)** | **8.23** | 0.18 | **8.48 (365)** | 6.30 (35) | 7.44 (65) | 7.96 (80) | 53 |

A per-mode, per-condition cell holds 7–45 rows. Differences under about ±0.7 between two modes are not results.

## 4. Scores by evidence condition (all modes pooled, dev + counterfactual + holdout)

| Condition | Baseline (n) | With the fix (n) |
|---|---:|---:|
| Single source, in the prompt | 9.28 (111) | 8.80 (182) |
| Multi-source, in the prompt | 8.67 (31) | 8.22 (75) |
| Conflict / stale, in the prompt | 7.81 (36) | 8.19 (75) |
| Single source, all rows | 7.71 (198) | 8.59 (198) |
| Multi-source, all rows | 6.94 (89) | 8.02 (89) |
| Conflict / stale, all rows | 6.36 (80) | 7.96 (80) |
| Follow-up chains | 7.55 (36) | 8.09 (36) |
| Missing evidence (deliberately absent) | 7.45 (65) | 7.44 (65) |
| Irrelevant source (files must not be dragged in) | 9.08 (45) | 8.79 (45) |
| Profile fact needed and in the prompt | 8.14 (11) | 9.21 (13) |
| Profile fact needed, not in the prompt | 6.65 (22) | 6.58 (20) |
| Nothing loaded in the mode at all | 8.35 (20) | 8.25 (20) |

Counterfactual families (the same question under 3–4 evidence states, 18 families): every variant right in 3 of 18
on both builds. The answers do change with the evidence when the evidence arrives; a family fails on its hardest
variant, usually the conflict or the absent one.

## 5. The evidence pipeline (judge-free; detail in `REFERENCE-EVIDENCE-REPORT.md`, `PI-EVIDENCE-REPORT.md`)

| Stage | Baseline | With the fix |
|---|---:|---:|
| Uploaded, parsed, same bytes as frozen | 100 % (495 uploads) | 100 % |
| Recorded fact strings surviving the parser (PDF / DOCX / CSV / text / code) | 15,958 / 15,958 | same |
| Indexed (`ready`) | 100 % | 100 % |
| Every needed file in the prompt | 84.5 % | 96 % (366 / 381) |
| **Every needed reference fact in the prompt** | **50.9 % (196 / 385)** | **96 % (dev + counterfactual 232 / 244, holdout 132 / 135)** |
| Outdated value in the prompt and the current one not (conflict cases) | 16 of 68 | 1 of 68 |
| Profile loaded and structured (heuristic extraction) | 100 % of 33 loads | same |
| Every needed profile fact in the prompt | 39 % (16 / 41; 11 of 33 on dev + counterfactual + holdout) | path unchanged (13 of 33) |
| File of another mode in a prompt | 0 of 559 rows | 0 of 559 |
| Profile evidence in a mode that may not use it | 0 of 8 probes, 0 of 559 rows | 0 |
| Other profile's strings in a prompt or an answer after a switch | 0 | 0 |

## 6. Why delivered evidence still falls short of 9.2: the claim pass

The kept build's claim pass re-reads each spoken answer against the material and replaces it when it finds
unsupported claims. Every replaced row's streamed draft was judged, so its effect is exact:

| Build, sets | Rows replaced | Shown − draft on replaced rows | … where the evidence was in the prompt | Whole effect on the mean | Hard fails without / with the pass |
|---|---:|---:|---:|---:|---:|
| Baseline, dev + counterfactual | 86 | +0.02 (±0.36) | −1.20 (±0.85, 18 rows) | 0.00 (±0.09) | 79 / 61 |
| With the fix, dev + counterfactual | 113 | | | −0.23 (±0.14) | 40 / 38 |
| With the fix, holdout | 57 | | | −0.37 (±0.24) | 21 / 15 |
| With the fix, all three sets | 170 | −0.85 (±0.35) | −1.50 (±0.44, 113 rows) | | 61 / 53 |

On the baseline the pass earns its place: it removes 18 capped failures, almost all on turns where the evidence had
not arrived and the draft had invented. Once the evidence is in the prompt it has little to remove and it deletes
what the files state: a reservation number in the loaded trip plan became "I'll pull up the reservation number"; a
go / no-go date in the decision log became "I'll confirm and come back to you"; twice it replaced the current value
with the outdated file's. With the fix, the 79 edits that drop a number the prompt states cost 1.86 (±0.54) each; the 89 edits that drop no number
cost nothing (+0.02 ±0.40).
Also measured: on the typed surface the pass reads only the first 24,000 characters of the material, which is less
than a whole pack; on 17 of 39 such rows the fact the answer rested on was past the cut.

Two repairs were tried by rule and neither is kept (section 9). This component was Evin's decision to keep; what to
do with it now is his.

## 7. The mode questions

All figures: dev + counterfactual + holdout, both builds; (n; how many had the needed fact in the prompt).

**Looking for work:**

| | Baseline | With the fix |
|---|---:|---:|
| Answer rests on résumé / JD only | 6.59 (12; 3 of 12) | 6.92 (12; 4 of 12) |
| Answer rests on the candidate's own notes | 7.77 (29; 14 of 29) | 8.49 (29; 25 of 29) |
| Missing personal evidence | 6.84 (9) | 7.49 (9) |
| … notes loaded but silent on it | 5.70 (4) | 7.83 (4) |
| … no notes loaded | 7.75 (5) | 7.22 (5) |

Candidate-authored notes do answer the behavioural and motivation questions when they are read. The relocation
family on the kept build, with the notes loaded: 9.3 (yes), 9.5 (no), 9.8 (only two cities), and 7.8 with no notes.
With the fix the same four scored 9.1, 5.7, 9.5 and 8.4, so one variant got worse. The résumé itself is the weak
point: its facts reach the prompt in a third of the cases on either build, and the answers then say "I'll confirm
the figures and come back to you" about the candidate's own project.

**Technical Interview:**

| | Baseline | With the fix |
|---|---:|---:|
| Generic technical / coding, no source needed | 9.70 (5) | 9.65 (5) |
| Coding asks with executable tests | 8.31 (8; 1 of 7 tested answers failed) | 8.63 (8; 0 of 7 failed) |
| Answer rests on résumé / JD only | 7.19 (7; 2 of 7) | 7.18 (7; 2 of 7) |
| Answer rests on project, design or code files | 7.68 (37; 16 of 37) | 8.62 (37; 32 of 37) |
| Missing evidence | 6.83 (7) | 6.19 (7) |

**Sales:**

| | Baseline | With the fix |
|---|---:|---:|
| Pack loaded, the answer rests on it | 6.91 (36; 15 of 36) | 7.48 (36; 34 of 36) |
| Conflicting or outdated sources involved | 5.02 (9) | 5.01 (9; hard fails 4 → 6) |
| The fact is absent from the pack | 6.16 (6) | 5.69 (6) |
| Files not needed (general knowledge, present decision) | 7.24 (5) | 9.08 (5) |
| Nothing loaded | 9.06 (1) | 9.49 (1) |

Sales is the mode the fix helps least: its failures are prices and discount limits taken from the outdated or draft
sheet, authority overstated, and arithmetic, with the right sheet in the prompt.

**Call Center:**

| | Baseline | With the fix |
|---|---:|---:|
| Pack loaded, the answer rests on it | 6.69 (37; 14 of 37) | 7.79 (37; 37 of 37) |
| Conflicting policy involved | 5.36 (8) | 7.63 (8) |
| The fact is absent from the handbook | 8.07 (5) | 6.78 (5) |
| Files not needed | 9.64 (5) | 9.27 (5) |
| Nothing loaded | 8.26 (2) | 8.64 (2) |

With the handbook actually in the prompt Call Center moves from 6.9 to 7.8 overall, not to 9. On dev +
counterfactual the claim pass costs it more than any other mode (−0.65 ±0.46).

## 8. Comparison with the kept benchmark (not number for number)

The 9-mode benchmark and this one differ in questions, charter, dimensions and judge, so their means are not
comparable. What can be said:

* There, every attached file was a single page of 245–652 words, which the kept build reads whole. Retrieval was
  therefore never the limit, and the measured weaknesses were invented personal facts (Looking for work), invented
  policy with no document (Call Center) and generation errors (Technical Interview, Lecture).
* Here, with realistic packs, the first limit is that half the needed facts are not in the prompt. That weakness
  was invisible in the kept benchmark because its documents were too small to trigger it.
* The hypotheses of the brief, tested: Call Center with a complete handbook does not jump to 9 (6.9; 7.8 with the
  fix). Looking for work with résumé, JD and the candidate's own notes: 7.6; 8.1 with the fix, 8.5 on
  notes-backed questions. Seminar with paper and slides: 8.1; 8.7 with the fix and no hard fail. Team Meet with a
  decision log: 7.3; 8.4 with the fix. Lecture was already strong (8.8) and stays there.

## 9. Changes attempted

| | What | Result | Status |
|---|---|---|---|
| **E1** | A pack up to 12,000 tokens is handed over whole on a turn that reads the files (`mode-retrieval-port.ts`, `orchestrator.ts`; no prompt wording changed) | Dev + counterfactual: evidence-required rows +1.06 (±0.33), all six rule lines hold. Holdout: +1.01 (±0.49), hard fails 39 → 15 | **Kept** on `fix/er-pack-whole` = `bab77f33`. Not on main |
| E2 | Hand the résumé and JD over whole (about 2,700 tokens) | Not built: the profile port carries tuned ranking and absence logic that a switch would bypass | Proposal |
| E3 | A rail: reject a claim-pass edit that removes a number the material states | Offline on 333 rows: 45 edits rejected, +1.25 (±0.57) on them; fails its third line (−0.54 on 4 rows that need no document) | **Not kept** |
| E4 | Skip the claim pass on turns with reference files in the prompt | Offline: dev + counterfactual +0.24, hard fails equal; holdout +0.39 (±0.23) but hard fails 15 → 19 | **Not recommended as specified**; a decision for Evin |

E1's costs: input tokens per turn 8,216 → 15,127 at the median on these packs; typed first word +123 ms; more
answers that attach a neighbouring fact to a question whose own fact is absent (hard fails on rows that need no
document, dev + counterfactual 10 → 14; Lecture's missing-evidence rows fell from 7.5 to 5.5).

## 10. Performance (dev run of each build; median / 90th percentile)

| | Baseline | With the fix |
|---|---:|---:|
| First word, heard turns | 2,249 / 3,552 ms | 1,826 / 2,507 ms |
| First word, typed turns | 924 / 1,379 ms | 1,047 / 1,561 ms |
| Request sent after the hotkey (all turns) | 677 / 2,363 ms | 324 / 1,215 ms |
| Retrieval inside that | 464 / 1,206 ms | 1 / 311 ms |
| Turns with profile evidence: first word; request sent | 1,643 / 2,401; 645 / 1,242 ms | 1,418 / 2,239; 380 / 985 ms |
| Settled answer | 3,139 / 5,610 ms | 2,965 / 5,260 ms |
| From the last streamed token to the settled text (the claim pass) | 1,155 / 3,141 ms | 1,250 / 3,354 ms |
| Shown text replaced after streaming | 66 of 270 | 91 of 270 |
| First word over 3 s / 5 s / 10 s; timeouts | 46 / 0 / 0; 0 | 3 / 0 / 0; 0 |

Against the kept benchmark's one-file runs (first word about 0.87 s), realistic packs cost the kept build about
1.4 s on heard turns, almost all of it local retrieval and rerank before the request is sent. The fix removes that
step for packs that fit. Provider stalls: none in the dev runs; across all nine runs (1,341 rows) 3 first words over
5 s, 1 over 10 s, no timeout, no provider-failure line. The fix's runs shared the machine with another session's
packaging build; its latency is if anything overstated.

## 11. The twenty-two questions

1. **With the correct Reference File?** 8.9 when the fact reaches the prompt, 5.7 when it does not; it reaches the
   prompt half the time (kept build).
2. **Each mode with complete evidence?** Section 3: from 6.6 (Sales) to 8.8 (Lecture) on the kept build; 7.1 to 8.9
   with the fix.
3. **Reference ingestion?** No loss: 495 of 495 uploads, 15,958 of 15,958 fact strings, every format.
4. **Retrieval?** The right file in the prompt 85 %, the needed fact 51 %. With the fix 96 %.
5. **Freshness handling?** Weak. Conflict / stale rows 6.36; in 16 of 68 cases the prompt held the outdated value
   and not the current one. With both in the prompt: 8.19, with outdated values still preferred on some turns and
   the claim pass presenting a superseded file as a live conflict.
6. **Conflicts detected?** Genuine (unresolved) conflicts are surfaced when both sides are in the prompt; the
   commoner error is the reverse, treating current-versus-outdated as unresolved ("I'm seeing it given two ways").
7. **Each mode keeps its references isolated?** Yes: 0 of 559 prompts held another mode's file, on both builds.
8. **PI-A into PI-B?** No leak: 0 prompts and 0 answers with the other profile's strings, across 5 overwrites; the
   stored profile was clean after each. Two answers after a switch were wrong for a different reason (the needed
   résumé passage was not in the prompt, and the answer filled the gap).
9. **PI into modes where it is forbidden?** No: 0 of 8 probes, 0 of 559 rows.
10. **Résumé + JD improves Looking for work?** Only when the fact arrives: 8.99 with it in the prompt, 6.32
    without; it arrives 39 % of the time.
11. **Candidate-authored notes solve behavioural questions?** Yes when read: 7.77 on the kept build (half
    delivered), 8.49 with the fix.
12. **PI in Technical Interview?** Same pattern: project and design files 7.68 → 8.62 with the fix; résumé-only
    questions stay at 7.2.
13. **Sales with proper files?** Not reliably: 6.6 → 7.1. Outdated and draft price lists are the main remaining
    cause.
14. **Call Center with a complete handbook?** 6.9 → 7.8. Not 9.
15. **Seminar with paper and slides?** 8.1 → 8.7, no hard fail with the fix. Not near-perfect.
16. **Team Meet uses the decision log?** Yes when it is in the prompt: 9.08; overall 7.3 → 8.4.
17. **General uses files without becoming mode-dependent?** 6.9 → 8.3; no profile use, no cross-mode use.
18. **What fails with the evidence in the prompt?** The claim pass deleting stated facts; outdated / draft values
    preferred; arithmetic over several values; an answer addressed to the wrong party on typed turns.
19. **Answer-model limits?** Arithmetic and multi-step reasoning (calculation rows 6.80 → 8.03, 12 of 87 still hard fails), and attaching a
    nearby fact to a question whose own fact is absent.
20. **Retrieval limits?** The 8-passage / 2,400-token cap against 2,300–9,800-token packs; the profile's
    6-passage cap; packs above 12,000 tokens remain on retrieval after the fix (not measured here).
21. **Missing-user-data limits?** Small in this corpus: missing-evidence rows 7.45, mostly safe, weakest where a
    neighbouring fact tempts (Lecture, Sales).
22. **What should users upload?** Section 12.

## 12. What Natively should ask users to provide (from the measured gains)

| Mode | Provide | Measured |
|---|---|---|
| Looking for work | Résumé, JD, and their own notes: reasons for moving, relocation, notice, salary, a weakness, three or four real stories | Notes-backed questions 7.8 → 8.5 with the fix; without notes these questions cannot be answered truthfully |
| Technical Interview | Résumé, JD, a deep-dive note on the main project, the design brief | Project questions 7.7 → 8.6 |
| Sales | Current price list, integration matrix, security brief, SLA guide, implementation guide, and **remove or clearly mark old and draft price lists** | Outdated and draft sheets are the main cause of Sales hard fails |
| Call Center | Current policy set; **retire the old handbook** | Conflicting-policy cases 5.4 → 7.6 once the current policy is in the prompt |
| Team Meet | Decision log, current sprint status, roadmap | Decision-log facts 9.1 when delivered |
| Seminar | The final paper, slides, appendix, results table; keep drafts out | 8.7, no hard fail |
| Recruiting | JD, résumé, scorecard, team brief, current benefits, process guide | 7.2 → 8.5 |
| General, Lecture | The documents the conversation is about; current syllabus, not last year's | 6.9 → 8.3; 8.8 → 8.9 |

Two product points follow from the same data: a pack should stay under what the prompt can hold whole (about
12,000 tokens with the fix), and the product needs a way to mark a file as superseded, because it does not reliably
infer that from dates.

## 13. Synthetic corpus and benchmark

* Reference files: 72 (General 8, Sales 8, Recruiting 8, Team Meet 8, Looking for work 6, Lecture 9, Technical
  Interview 9, Seminar 7, Call Center 9), plus 28 counterfactual variants. Formats of the 76 documents: 33 PDF,
  19 DOCX, 11 Markdown, 6 text, 4 CSV, 3 code. 1,776 recorded facts (2,604 with the variants).
* Profiles: 2 (résumé A as PDF, résumé B as DOCX; JD A as DOCX, JD B as text); candidate interview notes: 2
  (Looking-for-work reference files).
* Datasets: dev 270, holdout 180, counterfactual 63 (18 families), isolation 46; addendum oracle-sources 223.
* Each pack was authored to one brief and checked item by item by a second reviewer; frozen (hashes in
  `FREEZE.json`) before the first run. Known item defect: ER-ISO-015's leak strings are generic terms.

## 14. What is not established

* Every score is from the provisional judge. gpt-6-astra has judged nothing in this benchmark yet.
* The model-based profile structuring (a user who uploads a résumé with a provider already configured) was not
  measured; all profile loads used the built-in parser.
* The AgentRouter → DeepSeek generator route could not run (the build has no such provider); all 1,341 rows are
  direct DeepSeek, recorded per row. The 20–30 case route comparison was not possible.
* Packs larger than 12,000 tokens, where retrieval still governs after the fix, were not built.
* Windows, a packaged build, and the text swap as a user sees it: not tested.
* E1 ran while another session's packaging build was using the machine; the app and the supervisor were stopped
  from outside three times and resumed. No row was lost; latency comparability is weakened.
