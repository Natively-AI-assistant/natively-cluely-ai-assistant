# Handoff: Natively answer-quality work on the evidence-rich benchmark

Written 2026-10-09 (updated the same day at 13:30 UTC after a second session and at 20:20 UTC after a third) for whoever continues this work, human or agent. It covers 2026-10-03 to 2026-10-09.

This one file holds everything: the current state, what Evin asked and decided, how the benchmark works, every iteration with its rule and verdict (kept and rejected), the scores per mode per round, every code and prompt change with its reason and its full diff, the complete experiment log, the investigation documents, and all 630 development questions with the answers that still exist.

Two things are left out on purpose:

- **The blind holdout's questions and answers.** Only its aggregates are printed, so the holdout stays blind for whoever optimises next.
- **API keys.** They are read in-process from `/Users/evin/natively-cluely-ai-assistant/.env` and never printed.

The earlier answer-quality loop (the frozen 9-mode benchmark, before 2026-10-03) has its own handoff: `benchmarks/natively-answer-quality/docs/HANDOFF-ASTRA.md`. The two benchmarks are never compared number for number.

This file is generated: `node evidence-rich/report/build-handoff.mjs` (from `benchmarks/natively-answer-quality/`) rebuilds it from `report/handoff-head.md`, git, the app source, the replay variants, the log and the runs. Edit the head or the log, then rebuild.

## Contents

| # | Section | What it answers |
|---|---|---|
| 1 | State in one screen | Where everything stands today |
| 2 | What Evin asked and decided | Every request and decision, in order, and what was done |
| 3 | The benchmark | What is measured, how it is scored, how a verdict is reached |
| 4 | How to resume | Commands and procedures |
| 5 | Traps that cost time | What went wrong before, so it does not again |
| 6 | Every iteration | What each tried, how it was measured, kept or rejected |
| 7 | Scores per mode, per round | The numbers |
| 8 | What changed in the code, and why | Each kept change: the problem seen, the fix, the evidence |
| 9 | What changed in the prompts | Every wording change, kept and rejected |
| 10 | Where the data is | Files and folders |
| 11 | Open decisions and next steps | What is Evin's to decide; what to try next |
| 12 | Commits on main | Hash, date, files |
| 13 | The fix-up pass | Its instructions on main and the full text of every variant tried |
| 14 | Blind holdout: aggregates only | Per question type and per flag |
| A | Appendix A: every landed change in full | Commit message and complete diff |
| B | Appendix B: the complete experiment log | Every rule as written, every data table, every verdict |
| C | Appendix C: the investigation documents | Context limits, truncation tests, ingestion limits, the first quality report |
| D | Appendix D: every development question | 630 questions with main's answers, drafts, E19 and E16b answers, scores |
| E | Appendix E: the supplementary questions | 109 counterfactual and isolation questions (their answers were lost on 2026-10-06) |

---

## 1. State in one screen

| Thing | State |
|---|---|
| App `main` (local = GitHub) | `4eb4b851` since 2026-10-09 about 19:40 UTC: three commits by another session (packaging of local models, a trial test, a model check) on top of `73b18d97`, none in the answer path (the diff over `electron/llm`, `electron/context-intelligence`, the engine, the modes and `premium` is empty). `73b18d97` holds every kept change of this work, including E16b and E19, and is the build every run of 2026-10-09 measured. |
| Last change landed | **E19** (`73b18d97`): landed on local main 2026-10-09 05:08 UTC on Evin's "do 1", pushed 09:05 UTC on his "push main to github". |
| Benchmark | Branch `bench/evidence-rich`, draft PR #638, worktree `.claude/worktrees/aq-fix`. Folder `benchmarks/natively-answer-quality/evidence-rich/`. |
| Benchmark branch on GitHub | **Behind.** GitHub has `df815379`; the local branch is ahead from `99001d3b` on, including everything of the second and third sessions of 2026-10-09. Pushing it was denied on 2026-10-08 and needs Evin's explicit yes. |
| Backup of run data | `~/natively-er-backup/` (run folders, judgments, calibrations, scripts, this file, the log). |
| Judge | gpt-6-astra only (through AgentRouter). Evin, 2026-10-05: do not judge with Claude Code (quota). |
| Score of main before E19, development set, Astra | 630 questions: **8.92**, 71 hard fails (11.3 %), 414 at 9.5 or above (main `f4cd986d`). |
| Score of main before E19, blind holdout, Astra | 180 questions: **8.84**, 23 hard fails (run `er-holdout-e16b3`). |
| E19 on top of that | Development, the 88 rows it changes: 8.29 → 8.68, hard fails 12 → 7. Blind holdout, 52 pooled pairs: 8.158 → 8.384, hard fails 9 → 8. |
| Main with E19, full run | **Run, not judged.** `er6-dev-main` + `er6-dev2-main` (630 answers, 2026-10-09 10:06–10:58 UTC, clean). The Astra window of 11:02 UTC was closed by a provider access block (HTTP 403) after 43 judgments. There is no score of main with E19. |
| Deterministic checks | Version **obj-3** (2026-10-09). obj-2: a string the mode's own loaded files state is not a profile leak (one development row was capped at 2 wrongly). obj-3: a needle that starts or ends with a digit matches only as a whole number. Under them the baseline of `f4cd986d` is **8.935, 70 hard fails** (8.923 / 71 as stored); no holdout score changes. |
| Unseen question sets | `challenge` (117, readable), `challenge-val` (54, never read, aggregates only), `code1` (36 coding items with executed tests), authored blind and frozen 2026-10-09. Main on them, judge-free: 94 / 117, 45 / 54, 34 / 36. Added in the third session: `prov1` (24, readable) and `prov1-val` (24, never read) on which employer, title or date a résumé fact belongs to; main 23 / 24 and 21 / 24. And `pack24`, a separate corpus of four packs of about 20,700 tokens (313 re-issued items, 48 new), for X2. |
| Where it started, blind holdout, Astra | 7.73, 42 hard fails (run `er-holdout-base`, the build before this work). |
| Targets set at the start | 9.2 mean, under 1 % hard fails. **Not met.** |
| Running or scheduled | Nothing of this work runs. A one-shot check-in inside the Claude session (02:06 UTC on 10 October; it dies with the session) probes Astra once and, only on a clean probe, judges the 587 missing baseline answers and then the fixed X2 sample. See section 4. |
| Declared experiments | None open. Third session: **X2** measured (realistic packs of 20,700 tokens: main 54.3 % right, read whole at a 24,000 threshold 87.0 %; nothing lands, section 11). **E23** (a derived résumé statement must be supported by the résumé text) not proposed under its rule: +6.8 points on 22 unseen rows, interval through 0. **E24 / E24b** (a notice when the job posting is the only document) closed: the posting is still told as the candidate's history. **E25** (the fix-up pass is shown the passages nearest each sentence) failed on unseen drafts. Earlier: E21 not proposed, E22 confirmed main's calculation notice, X1 measured. |
| Candidate branches kept as records | `cand/e23` `9bfff943` (the experience-pairing rule; not proposed, Evin may still want it as a correctness fix), `cand/e21` `298b2b5b` (not proposed), `exp/x1-whole-pack-threshold` `237bba1a` (experiment build only, used for X1 and X2). Local, never pushed. |

What is not verified: nothing in this work was executed on Windows, and no packaged build was made. Every change is shared TypeScript with no platform branch, run on macOS in the dev build through the benchmark.

The last three days, in order:

- **2026-10-07.** Baseline of main under Astra (630 rows). E19 written, replayed, judged and confirmed in the app. Its blind-holdout replay was run but the Astra pool closed before it could be judged.
- **2026-10-08.** Window of 02:07 UTC: calibration 38/38; 20 of 25 holdout pairs judged; five calls returned HTTP 403 (the provider's temporary content-policy block). Nothing was retried and no key or route was changed to get round it. The partial reading (8.335 → 8.276) was recorded as incomplete, not as a verdict.
- **2026-10-09, 02:02 UTC window.** Calibration 38/38, no block, no failed call. E19's blind-holdout check finished and both rules hold (section 7.6). Three ideas were tried without the judge and dropped; E20 failed its own rule before any judge call. Later that day E19 landed and was pushed.

- **2026-10-09, second session (10:00–13:30 UTC).** Started from this file on Evin's brief for a final optimisation round. Fresh run of main with E19 (630 answers). Astra opened at 11:02 UTC, calibration 38/38, then an HTTP 403 access block two minutes into judging: no score. The rest was judge-free: two defects of the deterministic checks fixed and versioned; a failure-cause map of the last judged baseline; E21 measured in four stages and not proposed; E22; the 12,000 / 24,000 / 48,000 threshold experiment (X1); three new question sets written blind.

- **2026-10-09, third session (18:05–20:20 UTC).** Evin's instructions: finish the 587 judgments when access legitimately returns, establish the baseline before any proposal, investigate a narrow source-aware provenance mechanism validated on unseen questions before any Astra call, evaluate realistic 24k packs; no E21, no broader calculation notice, no rewrite of the conflict instructions; everything off main. No Astra call was made (the window is at about 02:00 UTC). Found in the recorded prompts: the app's own derived résumé sections state wrong employers and dates (the benchmark runs the rule-based profile parser, because a DeepSeek-only user has no model for structured extraction), and three hard fails repeat them. E23 removes such statements; it holds on development rows and on rows it is not about, and its gain on 22 unseen rows is +6.8 points with an interval through 0, so it is not proposed. E24 and E25 failed. X2: four realistic packs of about 20,700 tokens; main answers 54.3 % of 361 questions right and delivers 48 % of the needed facts, the same build reading the pack whole 87.0 % and all of them, with a faster spoken first word, a slower typed one and the fix-up pass out of its budget on a quarter of its turns.

Evin's standing instructions that bind the next session:

- Astra is the only judge. When Astra is closed, do judge-free work and wait. No substitute judge.
- No reasoning on the answer model: "the point of natively is to answer fast".
- The awaited rerank on spoken turns stays as on main.
- Nothing lands on `main` without his word. He has given it for everything now on main.
- Nothing is pushed without his word. The benchmark branch push is still waiting for it.
- Rules are written and committed before measuring. A candidate that fails its rule is not kept, whatever else it shows.
- The frozen synthetic evidence corpus stays frozen. All benchmark content is synthetic.
- The blind holdout is read in aggregates only.
- One app at a time. No generator replay on the DeepSeek key while an app run is in progress. No large downloads.
- A provider's access block (HTTP 403) is not worked around: no key, route or content change to evade it, no repeated resubmission.

---

## 2. What Evin asked and decided

In order, dates in UTC. Quotes are his words, as typed. Plain "continue" messages, automated notices, scheduled prompts and subagent reports are not listed; the last three are not approvals.

| When | What Evin said | What was done |
|---|---|---|
| 2026-10-04 | "conintu eon cc opus 5.5 for now , after astra comeback rereview things" | Claude Opus 5.5 (through the Claude Code CLI) judged while Astra was closed, marked provisional. Astra re-reviewed the same runs when it returned. |
| 2026-10-04 | "werent you fixing something like this earlier after the e1 run , what was it" | Recalled the context-limit findings: six places where text was cut or altered before it reached the model (Appendix C, `CONTEXT-LIMITS.md`). |
| 2026-10-04 | "what are the best recommended options to fix each , im a layman , give me the options to choose for each" | Options written in plain words for each of the six. |
| 2026-10-04 | His picks: "Let it read everything." / "Don't touch typed text." / "Say it + raise the limit" / "Smarter stop + 48k." / "Fix search + keep more speech." / "Fix the scoring (Recommended), Fit what's picked (Recommended), Smart search for typed too." / "Test 24k and 48k first." | #1 the spoken repair reads the whole prompt (E10). #2 typed text reaches the model verbatim. #3 answers get 48,000 characters, a loop stop and a "cut off" notice. #4 older speech is recalled and the live window keeps more (E12). #5 scoring fixed, the retriever picks what the packer fits, typed questions use the embedding search (E11). #6 the 24k/48k whole-file threshold test has **not been started**. |
| 2026-10-04 | "do them one by one , along side ,gpt astra 6 should be back , along with the above work paralleing start judgjing the earlier runs" | Done one at a time, each with its own rule; Astra re-judged the earlier runs. |
| 2026-10-04 (about) | "since the claude code and astra are simmilar in judging continue with claude code as judge … you are on autopilot , optimise the answer engine , refernce files , retrival , embedding , etc to perfection" | A Claude Code judge series was run on 2026-10-04/05 (marked CC everywhere, never pooled with Astra). Superseded the next day. |
| 2026-10-04 (about) | "you can increase the questions per mode instead of 30 if needed , no cap" | A second development set was authored: `dev2`, 40 questions per mode, 360 in all. |
| 2026-10-04, 10-05 | "commit and push local main"; picked "Main + today's 8 fixes (Recommended)"; "commit and push the work till last round thats taken"; on 10-05 "commit and push to local and remote main" | The kept fixes landed on main and were pushed, each time after the round in progress had finished ("let this round completes"). |
| 2026-10-05 | "if astra is avaiable continue , dont use claude code as judge since we are low on quota" | Astra-only since. Judge-free work when Astra is closed. |
| 2026-10-05 | "can i close this session ? also cehck if its worktree and branch is safe to delete …" | Worktrees and branches checked for other sessions' work before anything was removed. |
| 2026-10-05 | "judge with astra as much as possible , how many iterations as you want as long as astra is avaiable"; "it will be back at 4:30 pm ist"; "parallleing run iterations , since we only get astra for so litlle time"; "dont stop until astra goes out" | Each Astra window is used in full: three streams of three calls, calibration once per window. |
| 2026-10-05 | "delete the worktree of old iterations which are not necessary any more , so we have space" | Old iteration worktrees deleted. |
| 2026-10-05 | "auto resume at 7:30 am ist …  gpt astra 6 would be live by then , maximum use it" | Resumed at the 02:00 UTC window. |
| 2026-10-06 | "why is techinal interview decreased ?" | Answered: three answers out of twenty, on unchanged prompts; the model's own errors, inside run-to-run variation (section 7.1). |
| 2026-10-06 | E16b: "Land and push (Recommended)". Benchmark: "open as a pr ? would that work " | E16b landed on main and pushed. The benchmark went up as draft PR #638. |
| 2026-10-07 | "what are the values of each mode after all the optimizations" | The per-mode tables of section 7. |
| 2026-10-07 | "can you write a handoff docummnet with all the questions , answers for all the iterations so far , how each iteration effected each round …" | The first version of this file. |
| 2026-10-08 | "chek the api keys both and see which one has credits left , use that one for agentrouter" | Both keys' balances were read in-process; the funded one is selected by the probe. No key value was printed. |
| 2026-10-08 | "continue at 4:30 ist"; "continue at 7:30 am" | Resumed at those windows. |
| 2026-10-09 | "do 1" (answering "Land E19 on main?") | E19 fast-forwarded onto local main (`73b18d97`). Not pushed at that point. |
| 2026-10-09 | "push main to github" | GitHub `main` moved `bce8e47a` → `73b18d97`. Only `main` was pushed. |
| 2026-10-09 | "write a handoff file with all the questions , resonses , chanegs you have made , observations , rejected changed , benchmark , why this change , code changes , prompt changes etc in to a single.md file , everything" | This file. |
| 2026-10-09 | A long written brief for a new session ("final answer-quality optimization"): measure main with E19 first; map the remaining failures by first cause; arithmetic, facts from several documents, inventions the pass misses, correct inference, Technical Interview code, follow-ups; run the 12k / 24k / 48k threshold test; build a new high-difficulty set with an untouched validation part; Astra only; deterministic checks outrank the judge; nothing merged or pushed without his word. | The second session of 2026-10-09 (sections 1, 6 and 11, and the log from "Session of 2026-10-09, 10:00 UTC onward"). |

Decisions he made that are easy to forget:

- **No reasoning on the answer model** (2026-10-02): measured at +1.3 s median and +4.8 s at the slow end to the first word. Do not propose first-word delays as quality fixes.
- **The awaited rerank stays** (2026-10-03): "keep as today".
- **E2 was kept at his word** (2026-10-04) although its first rule missed on one line.
- **The benchmark branch push** has not been approved. Neither has merging PR #638, which would put the blind holdout's questions on public main.

---

## 3. The benchmark

### 3.1 What it measures

When the truth is in the user's Reference Files or Profile Intelligence, does Natively find it and use it correctly? When it is deliberately absent, does Natively stay truthful and still useful?

Every case goes through the product's own paths. Files are uploaded through the app's upload hook, extracted, chunked and embedded by the app; a résumé and job description go through the app's profile ingestion. Nothing is injected as text, and the expected answer never reaches the app's prompt.

```
file on disk -> upload hook -> extract text (PDF / DOCX / text) -> mode reference files -> chunk + embed
             -> per-turn retrieval -> context packing -> prompt -> answer model -> repair and fix-up passes -> shown answer
```

### 3.2 The answer path under test

1. `decide()` classifies the turn and plans what to read.
2. Retrieval picks passages or whole files.
3. `packContext` fits them into the prompt budget.
4. `composePrompt` builds the prompt.
5. The answer model writes a draft: direct DeepSeek `deepseek-flash`, temperature 0.2, seed 7, thinking off.
6. Two passes may change the draft: the spoken "corrected answer" repair, and the fix-up pass (called the claim pass or claim verifier in the code, `electron/llm/claimVerifier.ts`), which removes claims the material does not support. Its budget is 3.5 s. It runs on 470 of the 630 development rows and is not deterministic.

### 3.3 The question sets

| Set | Questions | Use |
|---|---|---|
| `dev` | 270 (30 per mode) | Development: read freely |
| `dev2` | 360 (40 per mode) | Development: read freely |
| `holdout` | 180 (20 per mode) | **Blind.** Aggregates only; never read to design a change |
| `supp-counterfactual` (63), `supp-isolation` (46), `supp-oracle-sources` (223) | supplementary; listed in Appendix E | The same question under different evidence; leaks between modes and profiles; which source backs each oracle fact |

| `challenge` | 117 (13 per mode) | Readable. Harder questions on the same frozen documents, written blind on 2026-10-09: calculations from several sources, dates counted from rules, which value belongs to which thing, version conflicts, absent facts, follow-up chains. Every item is checkable by fixed strings or executed tests, so it is read without the judge. |
| `challenge-val` | 54 (6 per mode) | **Never read.** The validation part of `challenge`: aggregates only, like the holdout (`--blind`). |
| `code1` | 36 | Technical Interview coding questions with 485 executed tests. Readable. |

Nine modes: General, Sales, Recruiting, Team Meet, Looking for work, Lecture, Technical Interview, Seminar, Call Center.

Six question types (the `condition` field):

| Type | What it tests |
|---|---|
| `grounded_single` | The answer is in one document |
| `multi_source` | The answer needs facts from several documents |
| `conflict_stale` | Documents disagree, or one is outdated or a draft |
| `irrelevant_source` | A distracting document is loaded too |
| `missing_evidence` | The asked fact is deliberately absent |
| `followup` | The question depends on what was said before |

Each question is spoken by the other party (the user presses a hotkey) or typed privately by the user. The documents are 104 synthetic files; no real résumé, customer data or company policy is used. The corpus is frozen (`FREEZE.json` holds the hashes).

### 3.4 How an answer is scored

The judge is exact `gpt-6-astra` through AgentRouter. It reads the case (evidence with its status and authority, the conversation, an oracle written before any answer existed, deterministic check results) and the answer, and returns 13 dimension scores from 0 to 10 plus any hard-failure flags. The score is then computed in code (`judge/score-er.mjs`):

| Dimension | Weight | Dimension | Weight |
|---|---|---|---|
| correctness | 0.15 | direct_usefulness | 0.10 |
| evidence_fidelity | 0.13 | evidence_utilization | 0.08 |
| grounding | 0.12 | realtime_usability | 0.07 |
| role_fidelity | 0.10 | source_precedence | 0.06 |
| intent_fulfillment | 0.10 | naturalness | 0.04 |
| cognitive_load | 0.02 | continuity | 0.02 |
| mode_fit | 0.01 | | |

A **hard fail** is an answer carrying a flag that caps its score:

| Cap | Flags |
|---|---|
| 4 | major_factual_error, major_reasoning_error, stale_source_preferred, draft_source_preferred, arithmetic_error, pricing_error, code_incorrect, fabricated_behavioral_story, unsupported_company_claim, unsupported_policy_claim, unsafe_commitment, fabricated_meeting_history, role_confusion, speaker_confusion |
| 5 | unsupported_personal_claim |
| 3 in Seminar, 5 elsewhere | unsupported_research_claim |
| 2 | wrong_profile_used, cross_mode_reference_leak, pi_leak |

Flags that do not cap: source_conflict_ignored, missed_available_evidence, coaching_instead_of_answer, ai_epistemic_leak, important_question_unanswered, excessive_deferral, evidence_overload.

Deterministic checks (`objective.mjs`: arithmetic recomputed, strings matched, code executed) outrank the judge: a check that proves the answer wrong adds its flag.

### 3.5 How the judge is kept honest

- **Calibration** before every window: 38 pairs written for calibration only (not benchmark items), each with an obviously better answer; the judge must prefer it in at least 35, and every reply must come back as exact `gpt-6-astra`. A window that fails calibration judges nothing.
- **One answer at a time**: each answer is judged on its own against its case; the judge is never told which build or arm produced it. Holdout rows are judged with `--blind`, which prints nothing that identifies a row.
- **No substitution**: if Astra is closed (HTTP 402) the work waits. Scores from other judges exist from 2026-10-03/05 (Claude Opus 5.5, and a Claude Code series) and are marked as a different series everywhere; they are never pooled with Astra's.
- Astra has opened at about 02:00 UTC and 11:00 UTC (7:30 am and 4:30 pm IST) for about 70 minutes, roughly 900 judgments.

### 3.6 How a change is decided

1. The rule (the lines that must hold, with their bars) is written into the log and committed **before** the change is measured.
2. The change is measured: by replay where possible (the recorded prompts are sent again with one thing changed; exact, minutes, no app), then in the app.
3. Only the rows where the two arms show different text are judged, both sides.
4. If every line holds it is a keep candidate; the blind holdout is then checked in aggregates. If a line fails, it is not kept, whatever else it shows.
5. Evin decides whether it lands.

Run-to-run variation is large and sets how much a result can say: the same build on the same prompts moves a set of 180 by about ±0.16, one mode of 20 to 30 by about ±0.7, and single answers by several points.

---

## 4. How to resume

Work directory: `/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality`.

**If that folder is missing** (it was deleted once, on 2026-10-06, with everything git-ignored in it):

```
cd /Users/evin/natively-cluely-ai-assistant
git worktree add -f .claude/worktrees/aq-fix bench/evidence-rich
# run data and judgments that were not in git:
cp -R ~/natively-er-backup/results/*   .claude/worktrees/aq-fix/benchmarks/natively-answer-quality/evidence-rich/results/
cp ~/natively-er-backup/judge-out/*    .claude/worktrees/aq-fix/benchmarks/natively-answer-quality/evidence-rich/judge/out/base/
cp ~/natively-er-backup/cv/*           .claude/worktrees/aq-fix/benchmarks/natively-answer-quality/evidence-rich/results/.cv/
```

**App worktree for runs** (`.claude/worktrees/er-main`): `git worktree add`, clone `node_modules` and `resources/models` from the main folder with `cp -c -R`, then `git submodule update --init premium`, then `npm run build:electron`. Without the `premium` submodule the build fails on three unresolved imports.

**An Astra window.** Astra has opened at about 02:00 UTC and 11:00 UTC (7:30 am and 4:30 pm IST) and stayed open 65 to 76 minutes, about 900 judgments.

```
node astra/probe.mjs                         # one call per key; writes astra/probe-result.json
node ~/natively-er-backup/scripts/er-window-chain-20261009.mjs   # a whole window as ONE background script; copy and adapt
```

- Three processes of three calls each is reliable. Twelve calls at once gave "fetch failed" on a third of them.
- Calibration (38 pairs, about 7 minutes) runs once per window; 35 of 38 are needed.
- Background watchers and session crons die when the Claude Code session restarts. Re-check on every resume.
- Run a window as one chained background script: probe (exact `gpt-6-astra`, waits for the window, stops at once on HTTP 403), calibrate once, judge only what a saved plan still misses, write aggregates. `plan-pair.mjs` writes the plan (counts only); `report/pair-aggregate.mjs` reads it (aggregates only, no ids or text).
- HTTP 402 means the ration is closed: wait for the next window. HTTP 403 means the provider has blocked access for a while: stop, record it, do not retry the denied calls and do not change key, route or content.
- Do not run `astra-next5.sh` or the older `astra-next*.sh` blindly: their automatic commit lacks the current attribution line and their failure check covers 402 but not 403.

**What the next Astra window owes** (the flag `/tmp/er-access-block-20261008-1630.json` from the block of 2026-10-09 11:12 UTC is in place; remove it only after a clean probe by hand):

```
node astra/probe.mjs                                   # exact gpt-6-astra, HTTP 200, no 403
ER_SKIP_RUN_WAIT=1 node ~/natively-er-backup/scripts/window-er6.mjs   # calibration, then the 587 missing judgments of er6-dev-main + er6-dev2-main, then drafts
node evidence-rich/report/rescore-objective.mjs er6-dev-main,er6-dev2-main   # the score under the current checks
```

That gives the first judged score of main with E19, to set beside 8.935 / 70 hard fails for `f4cd986d` (obj-3). `window-e21.mjs` is no longer needed (E21 was not proposed).

**An app run.**

```
NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env \
node evidence-rich/supervise-er.mjs --root <app worktree> --runs dev:<run-id>,dev2:<run-id> --fresh-userdata \
     [--run-args "--id ID1,ID2"]
```

- One app at a time. No replay traffic on the DeepSeek key while an app run is in progress.
- Always `--fresh-userdata`; a stale profile once routed a run through AgentRouter.
- After a run: copy the run folder to `~/natively-er-backup/results/`, force-add `rows.jsonl`, and commit.

**Replays** (no app needed, minutes, exact):

- Fix-up pass: `evidence-rich/replay-claim-pass.mjs --cv results/.cv/cv-main-f4cd986d.mjs --runs … --name <arm> --cap 96000 --recorded-cap 96000 [--variant replay-variants/<file>.mjs]`. The rebuilt request must equal the recorded one (the tool prints the count).
- Generator: `evidence-rich/replay-generator.mjs --runs … --select all|<ids> --k 2 --name <arm>`.
- Judge only the rows where two arms show different text, both sides. Read pass timing only on arms replayed in the same hour.

---

## 5. Traps that cost time

1. **`.claude/worktrees/` was deleted on 2026-10-06** by something other than this work. Every run folder, judgment file and judge cache before that date is gone. Their numbers survive in `ITERATIONS-ER.md`; they can be cited, not recomputed. Since then rows and Astra judgments are committed, and run folders are copied to `~/natively-er-backup/`.
2. **History was rewritten on 2026-10-06** (`git filter-repo`, another session) to purge dev harness pages and `cluely-*` assets. Commit hashes in notes older than that date are pre-rewrite; find commits by message. A worktree's index kept the purged files, and the next commit there re-added them; before pushing any branch run `git diff --name-only main...<branch>` and check every path is intended.
3. **Old-history branches still on GitHub**: `fix/aq-astra`, `cand/e16b`, `cand/e15` (this work) and many `backup/*`. They keep the purged files reachable. Deleting them is Evin's call.
4. **The blind holdout**: read aggregates only. Never read its questions or answers to design a change.
5. **Run-to-run variation is large.** Same build, same prompts: a set of 180 moves by about ±0.16, one mode of 20 to 30 by about ±0.7, and single answers by several points. One run per build cannot decide a small effect; use replays with repetitions (E16c is the model).
6. **Two judges, never pooled.** Scores marked "Claude Code judge" or "Opus" are a different series from Astra's.
7. **A test may pin an earlier decision.** E19 tripped a test recording that a broader exemption had been tried and withdrawn on 2026-10-01. Read the note beside a failing test before changing it.
8. **`benchmarks/` is git-ignored** (`.gitignore:381`), on the benchmark branch too. A new file there needs `git add -f`; tracked files stage with `git add -u`. A run folder that is not force-added is not in git.
9. **Tests under plain `node --test`.** The test files import compiled output from `dist-electron/`, so run `npm run build:electron` first. Under plain Node (v25) the native modules built for Electron do not load: `electron/services` shows 122 failures of 5,730 with or without a change. Compare the failing-test names against the same suite on the commit before, or run through the project's `npm test`.
10. **Run every suite the landing procedure names, with a baseline, before the fast-forward.** E19 was fast-forwarded after two of the four suites; the other two were run afterwards and matched the baseline. Do it in the right order next time.
11. **The fix-up pass is not deterministic.** The same draft gets a different edit on a second call, so one replay shows one draw of which rows differ. For a holdout reading use two repetitions and pool them (E19 is the model).
12. **A 403 is not a 402.** On 2026-10-08 five judge calls returned HTTP 403 (a temporary content-policy block at the provider). The window was closed with a partial reading marked incomplete; the block did not recur the next day.
13. **Builds leave about 1.3 GB of `dist-electron` per worktree.** Delete your own build output after use, and check free disk before an app run.
14a. **Stop only your own app.** Another session may start a `dev:agent` app in the main checkout at any time. Check `ps` for `scripts/dev-agent.mjs` before starting one, and stop by the launcher whose working directory is your worktree (`lsof -a -p <pid> -d cwd`), never by name.
14b. **The limits probe needs `NATIVELY_ROOT`** set to the app worktree, or it looks for `agent-browser.json` in the current folder.
14c. **A question asked late in a session can be answered from the conversation.** In the threshold probe the list question came after seven turns that had each stated one of its facts; it scored 7 of 7 with 2 of 7 in the request. Ask it in a fresh session.
14d. **A clean result on rows you have read may not carry.** E21 held on the development rows twice (+11 points, interval above zero) and showed nothing on 37 unseen calculation questions. Check a candidate on `challenge` and `challenge-val` before any app run or judge call.
14e. **Needles are substrings.** "October 20" used to match "October 2026" (fixed in obj-3 for digits). Write date needles with their day spelled so that a longer number cannot contain them.
14. **The shared git stash.** Never use bare `git stash` or `git stash pop`: other sessions use the same stash.
15. **Other sessions' files.** The main checkout usually holds uncommitted work from other sessions. Never sweep it into a commit; stage by path.

---

## 6. Every iteration: what it tried, how it was measured, verdict

"Kept" means it is on main. Judges: A = gpt-6-astra, O = Claude Opus 5.5 (provisional, 2026-10-03/04), CC = Claude Code judge (2026-10-04/05).

| # | What it changes | Measured on | Result | Verdict |
|---|---|---|---|---|
| E1 | A reference pack that fits the prompt is read whole | dev + counterfactual, then blind holdout (O); re-reviewed by A | Holdout 7.73 → 8.59 (A), hard fails 42 → 18 | **Kept** (2026-10-03) |
| E2 | A résumé and job description that fit are handed over whole | dev (O), then blind holdout under a second rule | First rule missed on one line (+0.63 with a wide interval); holdout confirmed what it controls | **Kept** at Evin's word (2026-10-04) |
| E3 | A rail: a number the material states cannot be "unsupported" | offline (O) | Failed one line on four rows | Not kept |
| E4 | Skip the fix-up pass when the files are in the prompt | offline (O) | Raised the mean and let four more hard fails through | Not recommended |
| E5 | The fix-up pass is shown the whole prompt (was cut at 24,000 chars) | replay, app, holdout (O) | Every line held | **Kept** (2026-10-03) |
| E6 | Pass wording: a current document against an older one is not a conflict (two wordings) | replay, 333 rows (O) | +0.06 (±0.08); hard fails 32 → 27 | Not kept (mean gain not distinguishable from zero) |
| E7 | Date and version labels on reference files in the prompt | app run (O) | Failed its rule | Not kept, reverted |
| E8 | The loaded pack reaches every turn of its mode | app runs ×2, holdout (O) | Failed two lines; one part isolated | Not kept; part (a), the Recruiting job description, **kept** |
| E9 | Pass wording naming two shapes of invention | replay (O) | Pointed the right way, not conclusive | Nothing concluded |
| #2 | Typed text reaches the model verbatim | in-app probes | Typed text reaches the model unchanged | **Kept** (Evin's pick) |
| #3 | 48,000-character answers, a loop stop, a "cut off" notice | in-app probes | Works as designed | **Kept** (Evin's pick) |
| E10 | The spoken "corrected answer" repair reads the whole prompt (96,000) | replay, 131 turns ×2 | 8.08 → 8.87 (A), hard fails 29 → 17 | **Kept**, confirmed by A on 2026-10-06 |
| E11 | A named fact outranks common words; the retriever picks what the packer fits; typed questions use the embedding search | probes + dev (CC) | Typed multi-file misses 6 of 9 → 0 | **Kept**, with two corrections so spoken turns keep the awaited rerank |
| E12 | Older speech is recalled for long questions; the live window keeps more speech | probes + dev (CC) | 36 of 36 transcript facts recalled | **Kept** |
| E13 | A turn answered without retrieval still reads a pack that fits | dev (CC) | Delivery 204 → 209 rows; gained rows +3.0 | **Kept** |
| E14 | A pass edit may not add a figure | holdout (CC) | Mean up, one more hard fail | Not kept |
| E15 | A note in the prompt for typed questions (two wordings) | generator replay (CC) | Failed all three lines | Not kept |
| E16 | A retrieving turn plans the whole profile and pack when they fit | dev + dev2, 630 rows | Résumé missing 24 → 4, but delivery 490 → 488 | Not kept as built |
| E16b | E16 plus: a whole résumé or job description is not removed by the claim-authority gate | dev + dev2, one run per build | Gained rows +0.44 (CC), +0.36 (A); bar was +0.5 | Not kept on that measurement |
| E16c | E16b measured again on the 80 rows it changes, two replays per row and build | fresh runs on main, 320 drafts (A); then blind holdout pair (A) | Drafts 8.35 → 8.70, hard 17 → 14, rises 12 / falls 4; holdout safety rule held on 180 pairs | **Kept**: E16b landed 2026-10-06 |
| E17 | Pass wording: name a conflict only when the material does not settle it | replay, two samples (A) | Sample 1 missed one line; sample 2: conflict-ignored flags 1 → 5 | Not kept |
| E18 | Pass wording: say whether a conflict is settled or open | replay, two samples pooled (A) | Conflict-ignored flags 3 → 13; hard fails 27 → 34 | Not kept. **The conflict line of the pass is closed; do not re-propose a rewording.** |
| E19 | Pass wording: a statement that the material does NOT contain something is not a claim to remove | replay on 470 passes (A); in-app run of the 88 rows it changes (A); blind-holdout replay, two repetitions (A) | Development 8.29 → 8.68, hard fails 12 → 7, invention flags 11 → 6; in app 8.50 → 8.62; holdout 25 pairs 8.105 → 8.135, pooled 52 pairs 8.158 → 8.384, hard fails 9 → 8 | **Kept**: landed and pushed 2026-10-09 (`73b18d97`) |
| E20 | A rail on the pass's output, no wording change: when its CONFLICT line labels every value with a version or a date and it listed nothing unsupported, the edit is dropped and the draft stands | judge-free line on recorded pass outputs; no Astra call spent | In-sample 4 rows 6.35 → 9.71, but it changed a row whose oracle holds a true two-document conflict (1 of 3 on the second sample) | Not kept (line 3 of its rule). **The conflict line is closed to rails on its text as well.** |
| — | A "CHECK:" line in the pass: quote the material for each statement before listing anything (two wordings) | 52 drafts, judge-free | Finds the flagged detail on about two thirds of 24 capped drafts, and edits 12 of 28 drafts scored 9.5 or above; pass time p50 1.27 → 1.67 to 1.86 s | Dropped, never declared. Do not re-propose without a way to protect inference |
| — | A notice in the answer prompt: state the deciding fact before the verdict | the 13 self-contradicting rows, four samples each, judge-free | Fixed two rows in 4 of 4 samples; turned a third, right in 4 of 4, wrong in 4 of 4 | Dropped, never declared |
| — | One more pass sentence only on drafts that contain a denial | counted on the 21 hard fails flagged for missed evidence | The draft contains a denial on 1 to 4; they are omissions, not denials | Dropped before any call |
| — | A generator notice against multi-source omissions | counted on 126 rows | 20 rows miss a fact, each by a different mistake; at most +0.08 on the mean if every one were fixed; not measurable without the judge | Not pursued |
| — | A rail on edits that remove a fact the draft had | counted on 99 edited rows | 5 rows | Too few; not pursued |
| — | Inline component arithmetic (an idea of 2026-10-08) | — | Never declared, built or measured | Idea only |
| obj-2, obj-3 | Deterministic checks: a string the mode's own loaded files state is not a profile leak; a needle that starts or ends with a digit matches only as a whole number | Re-applied to every stored judgment without a judge call | One development row 2 → 10 (baseline 8.923 / 71 → 8.935 / 70); no holdout score changes | **In the benchmark** (2026-10-09) |
| E21 | The hidden calculation step on turns the word list does not reach. Stage 1: the notice hand-placed on the 59 calculation rows without it. Stage 2: main's wording on every document turn. Stage 3: a lighter wording (n3). Stage 4: the same on the unseen challenge sets | Generator replay, deterministic checks, 2 to 4 samples per row and arm | Stage 1: 73.3 → 84.7 % right. Stage 2: required strings 95.2 → 91.5 % on 387 turns that need no calculation (rejected). Stage 3: n3 costs nothing there (94.2 %) and keeps the gain (72.0 → 83.1 %). Stage 4: `challenge` 73.6 → 73.6 % on 37 calculation rows, forbidden-string samples 33 → 48 | **Not proposed** (stage 4, lines 1 and 4). Branch `cand/e21` kept as a record |
| E22 | Does main's own calculation notice earn its place on the rows its word list reaches? | Generator replay with and without it, 222 rows × 3, development and challenge sets | Calculation rows 79.2 → 89.2 % right (+8.1 on the unseen sets alone); other rows 91.7 → 91.2 % | **Main confirmed**, nothing changes |
| X1 | Whole-pack threshold 12,000 against 24,000 and 48,000 (Evin's pick #6) | Limits probe on an experiment build, synthetic files of 11,900 to 48,100 tokens, spoken and typed, 528 turns | 12,000: a whole-document question gets 2 or 3 of 7 facts just above it. 24,000: every line holds, no spoken first-word cost. 48,000: the fix-up pass (96,000-character cap) rewrote three right drafts wrong; typed first word +0.6 s | **Measured; nothing lands.** A proposal would be 24,000 with the pass's cap raised, after a quality run on realistic larger packs |

Lessons that hold across them:

- Retrieval is no longer the limit: every needed fact is in the prompt on 497 of 499 development questions that need one.
- The fix-up pass helps overall (Astra, 99 edited answers: 8.23 → 8.47, hard fails 22 → 11). It hurts when it removes honest statements of absence (E19 addresses that) and on a handful of follow-up turns.
- Every attempt to let the pass treat a document conflict as settled raised a worse error. Astra penalises the existing "given two ways" hedge least.
- Making the pass check each statement against the material (the "CHECK:" line) also removed correct inference: worked-out figures, conclusions drawn from stated numbers, honest statements of absence.
- The pass wrote "UNSUPPORTED: none" on 21 of the 34 development answers capped for an invented detail. It is a partial net, not a guarantee.
- Missing-evidence questions were the weakest type on main (8.04). E19 addresses them. After E19 no single cause covers more than about 1 % of rows.
- Of 792 required facts with fixed strings, 73 have no string in the prompt (70 rows); in 53 of those rows the answer has the value anyway because it is a computed figure. The 17 rows where it is also missing from the answer (mean 6.04, 6 hard fails) are mostly Sales pricing sums and deferrals.
- Of 71 hard fails on the development set, 57 are answers the pass never edited: the answer model misreading, miscalculating or mis-combining facts that are in the prompt (factual error 21, missed available evidence 20, reasoning 10, arithmetic 8, unsupported claims 26). That is the next lever, and it is hard to move without reasoning.
- The gist chip repeats the body's error; it is the lone error on 3 rows. Not a lever.
- A notice in the answer prompt is never free. Main's calculation notice on turns that need no calculation costs completeness; a lighter one changed what the model does with an absent fact on unseen questions. Where the question's wording asks for a quantity, the same notice is worth about ten points of right answers (E22), on unseen questions too.
- By first cause, the 71 hard fails of the last judged baseline are: invented company, policy, research or personal facts 22; unsupported inference 9; arithmetic or calendar count 7; right value on the wrong thing 6; document conflict 6; self-contradiction 6; a fact left out 5; inputs combined wrongly 2; wrong code 2; role 2; gist chip 2; one defective check. None lacked the evidence in the prompt.

---

## 7. Scores per mode, per round

Never compare across judges. Within one judge, a mode column moves by about ±0.7 between runs of the same build.

### 7.1 Blind holdout (20 questions per mode), gpt-6-astra

| Mode | main 2026-10-04 (`er-holdout-m1`) | + the 2026-10-05 fixes (`er-holdout-e13`) | main 2026-10-06 before E16b (`er-holdout-m3`) | main with E16b (`er-holdout-e16b3`) |
|---|---|---|---|---|
| Call Center | 7.68 | 8.30 | 8.68 | 7.71 |
| General | 8.91 | 9.31 | 9.41 | 9.13 |
| Lecture | 8.90 | 9.20 | 9.55 | 9.53 |
| Looking for work | 8.50 | 9.50 | 8.68 | 9.07 |
| Recruiting | 9.08 | 9.01 | 8.97 | 8.80 |
| Sales | 7.98 | 8.93 | 7.67 | 9.02 |
| Seminar | 9.54 | 9.42 | 9.42 | 9.03 |
| Team Meet | 8.92 | 9.26 | 9.32 | 9.03 |
| Technical Interview | 8.54 | 7.98 | 7.97 | 8.19 |
| **All 180** | **8.674** (28 hard) | **8.990** (19 hard) | **8.853** (22 hard) | **8.835** (23 hard) |

Earlier points on the same holdout under Astra, overall only: the build before this work 7.725 (42 hard fails); E1 alone 8.585 (18 hard fails).

How to read it: the first two columns are the same question set one day apart, before and after the eight fixes of 2026-10-05. The last two are a clean pair run on the same day (today's main with and without E16b). `er-holdout-e13` is the build just before the two E11 corrections; the difference between 8.990 and 8.853 is inside run-to-run variation plus other sessions' changes to main in between. The Technical Interview drop in column two was three answers out of twenty on unchanged prompts (the model's own errors).

### 7.2 Development set (70 questions per mode: dev 30 + dev2 40), main `f4cd986d`, gpt-6-astra

| Mode | Mean | Hard fails |
|---|---|---|
| General | 9.18 | 6 |
| Lecture | 9.10 | 8 |
| Looking for work | 9.02 | 7 |
| Technical Interview | 8.90 | 11 |
| Recruiting | 8.90 | 6 |
| Team Meet | 8.88 | 7 |
| Call Center | 8.85 | 6 |
| Seminar | 8.84 | 9 |
| Sales | 8.63 | 11 |
| **All 630** | **8.923** | **71** |

By question type: grounded in one document 9.16; irrelevant source present 9.12; conflicting or stale documents 9.02; several documents 8.84; follow-up 8.63; answer not in the documents 8.04. Spoken 8.92, typed 8.93.

### 7.3 Development set, the build of 2026-10-05 (`cand/e13b`), Claude Code judge (a different series)

| Mode | dev (30 each) | dev2 (40 each) |
|---|---|---|
| Call Center | 9.01 | 8.63 |
| General | 8.80 | 8.75 |
| Lecture | 9.16 | 9.37 |
| Looking for work | 8.18 | 8.57 |
| Recruiting | 9.17 | 9.12 |
| Sales | 8.81 | 8.14 |
| Seminar | 9.25 | 8.59 |
| Team Meet | 8.47 | 8.93 |
| Technical Interview | 8.74 | 8.41 |
| **All** | **8.843** (17 hard) | **8.722** (31 hard) |

Pooled 8.774 with 48 hard fails. E16b on the same judge: 8.774 → 8.820, hard fails 48 → 45.

### 7.4 Earlier rounds (Claude Opus 5.5 judge, 2026-10-03/04), overall only

The kept build at the start delivered only 51 % of needed facts and scored 7.44. After E1, E5 and E2 landed, main scored 8.58 on 513 development rows and the blind holdout went 7.40 → 8.54. Per-mode tables for those rounds are in `ITERATIONS-ER.md` (sections E1, E5, E2 and M1) and in `docs/` of the benchmark; their raw data is gone.

### 7.5 E19 on the development set (gpt-6-astra)

Replay of the fix-up pass on the 470 development rows where it runs (requests identical to the app's, bar the one sentence). Astra judged the 88 rows where the two wordings give different text, both sides.

| Reading | Rows | Before | With E19 | Hard fails | Invention flags |
|---|---|---|---|---|---|
| Replay, rows that differ | 88 | 8.29 | 8.68 | 12 → 7 | 11 → 6 |
| Of those, asked fact absent | 35 | 8.19 | 8.63 | | |
| In the app, same 88 questions (`er5-dev-e19`, `er5-dev2-e19`) | 88 | 8.50 | 8.62 | | |

Pass time at the slow end (p90): +224 ms, inside the 300 ms bar.

### 7.6 E19 on the blind holdout (replay, gpt-6-astra, aggregates only)

Both wordings were replayed on the recorded drafts of `er-holdout-e16b3` (132 passes per arm and repetition, requests identical to the app's). Astra judged only the rows where the arms give different text. A pair is one row in one repetition.

| Reading | Pairs | Control | New wording | Change (95 % half-width) | Hard fails | Invention rows | Up ≥ 1 / down ≥ 0.5 |
|---|---|---|---|---|---|---|---|
| Repetition 0 (rule of 2026-10-07) | 25 | 8.105 | 8.135 | +0.031 (±0.499) | 5 → 5 | 4 → 4 | 2 / 3 |
| Repetition 1 | 27 | 8.208 | 8.615 | +0.407 (±0.558) | 4 → 3 | 3 → 2 | 5 / 3 |
| Pooled (rule of 2026-10-09) | 52 | 8.158 | 8.384 | +0.226 (±0.376) | 9 → 8 | 7 → 6 | 7 / 6 |

Both rules hold. What that says and does not say: on the blind holdout the new wording did no measurable harm and probably a small good; the pooled interval still includes zero, so it is not a confirmed gain. The two repetitions share the same 132 drafts, so the 52 pairs are not 52 independent questions. Rows where the arms give the same text contribute no change, so the effect on all 180 holdout questions is about +0.03. Pass time p90 on repetition 1: +88 ms.

---

## 8. What changed in the code, and why

All of this is shared TypeScript in the answer path. None of it is platform-specific: no OS calls, paths, native modules or window code. It was run physically on macOS in the dev build through the benchmark. It has never been executed on Windows, and no packaged build was made for it.

Each entry gives the problem as it was measured, the change, and the result. Section 12 lists the files; Appendix A prints every commit message and diff in full. In the order it landed:

### 8.1 A reference pack that fits is read whole (E1, `803c7612`, 2026-10-03)

- **Problem seen:** every file parsed and indexed, yet the fact the answer needed was in the prompt on only 99 of 199 reference-file turns. A turn packed at most 8 passages (1,500 to 2,400 evidence tokens), and on 92 of the 111 turns that missed, the retriever had offered more candidates than were packed.
- **Change:** when a mode's files together are between 1,400 and 12,000 estimated tokens (`WHOLE_PACK_MAX_TOKENS`), a turn that reads the files gets each file entire and skips the embed and rerank round trip. The plan's item cap and evidence budget grow by the pack's size so the résumé, job description and meeting evidence keep their room.
- **Unchanged:** a larger corpus is retrieved as before. No prompt wording changed.
- **Result:** blind holdout 7.73 → 8.59 under Astra, hard fails 42 → 18.

### 8.2 Hidden working no longer leaks into the answer (`18d2603e`, 2026-10-03)

- **Problem seen:** once in 334 turns carrying the calculation notice, the answer model wrote its working as its own tool-call markup instead of the asked-for `[[CALC]]` form. The stream filter knew only that form, so the markup was shown.
- **Change:** the markup block is recognised and hidden like the asked-for form.
- **Result:** not reproducible on demand (0 of 24 replays), so it is covered by tests, not by a score.

### 8.3 The fix-up pass sees what the answer saw (E5, `948b0b3c`, 2026-10-03)

- **Problem seen:** the pass was shown only the first 24,000 characters of the prompt. With a pack handed over whole the prompt was longer than that on 302 of 384 passes, so the pass removed facts the files state because it could not see them.
- **Change:** the pass has its own cap, 96,000 characters. Regeneration and the document-grounded repair kept 24,000 at that point.
- **Result:** replayed on 251 recorded drafts, the effect of the pass went from −0.21 to +0.01, hard fails 33 → 32, every pass inside its 3.5 s budget.

### 8.4 Résumé and job description handed over whole (E2, `feea02a9`, 2026-10-04)

- **Problem seen:** a turn carried at most six profile passages out of about seventy. The fact a résumé or job-description question needed was in the prompt on 13 of 33 rows; with it the answers scored 9.5, without it 6.6.
- **Change:** when every registered résumé and job description has raw text and together they are at most 6,000 tokens, the plan makes room and each document arrives as one whole item instead of passages.
- **Result:** the first rule missed on one line (+0.63 with a wide interval); the blind holdout confirmed what it controls. Kept at Evin's word.

### 8.5 A mode's own file is not removed by the claim-authority gate (E8 part a, `4aabf0b4`, 2026-10-04)

- **Problem seen:** on a spoken Recruiting turn the claims needed are about the candidate, so the mode's own hiring job description was dropped from a pack otherwise handed over whole: 13 of 27 spoken Recruiting turns, including when the candidate asked about pay, travel or on-call.
- **Change:** a file of the mode handed over whole stays in the prompt. What an item may *support* is unchanged.
- **Result:** Recruiting +0.08 and +0.59 over two runs. The rest of E8 failed its rule and was not kept.

### 8.6 Typed text is not "cleaned" (Evin's pick #2, `c5e8d42c`, 2026-10-04)

- **Problem seen:** the speech filler stripper ran on typed questions too: "the right answer" became "the answer", and "basically", "I mean" and a repeated word were deleted from what the user typed.
- **Change:** typed chat skips the stripper. Speech keeps it.
- **Result:** verified in the app: typed text reaches the model unchanged.

### 8.7 Long answers (Evin's pick #3, `8ca5cac9`, 2026-10-04)

- **Problem seen:** a legitimate 900-line answer stopped mid-line at the 16,000-character cap and the overlay showed nothing about it. The cap had also caught a real 22,871-character runaway, which is why it could not simply be removed.
- **Change:** the cap is 48,000 characters. A repetition guard ends an answer whose tail is one block repeated five times after 3,000 characters. An answer stopped either way shows the existing "Answer cut off" notice with the reason, in English, Russian, Chinese, Japanese and Spanish.
- **Result:** verified in the app: the 900-line answer completes (20,951 characters); the notice shows under typed and spoken answers.

### 8.8 The spoken repair reads the whole prompt (E10, Evin's pick #1, `e1fe2d09`, 2026-10-04)

- **Problem seen:** the spoken "corrected answer" repair ran on about 20 % of spoken turns, was cut at 24,000 characters every time, and lacked a needed fact on 1 to 2 % of spoken turns.
- **Change:** it inherits the whole answer prompt (96,000), like the fix-up pass.
- **Result:** replay of 131 turns, twice: 8.08 → 8.87 under Astra, hard fails 29 → 17.

### 8.9 Retrieval ranking and fit (E11, Evin's pick #5, `7de6bc59` with corrections `2fa1cf7b` and `05ae494b`, 2026-10-04)

- **Problem seen:** typed, with six files of 2,100 tokens: the chunk holding the answer scored 0.07 against 0.24 for five wrong chunks, ranked fifth, and the packer fitted four. Common question words counted like the name being asked about, and an "overview" penalty fired because the word "summary" appeared near the chunk's start. (My first diagnosis blamed the typed keyword fallback. That was wrong; a hybrid run missed too.)
- **Change:** a named fact scores 0.15 per hit and other shared words 0.05; the overview penalty needs a real overview heading; the retriever picks only what the packer can fit; typed questions use the embedding search in a meeting too.
- **Two corrections, both my errors:** the new score also fed the confidence gate, and the embedding search was first switched on for spoken turns as well. Either way the awaited rerank stopped being awaited on spoken turns (hotkey-to-request median about 500 ms → 22 to 24 ms), against Evin's decision of 2026-10-03 to keep it. `2fa1cf7b` gives the gate its old score; `05ae494b` limits the embedding search to typed questions.
- **Result:** typed multi-file misses 6 of 9 → 0.

### 8.10 Older speech (E12, Evin's pick #4, `e47cb7e6`, 2026-10-04)

- **Problem seen:** a 20-line exchange had lost its first line (a 2,400-character window read from a rolling context evicted at 180 s). The live-transcript search admitted only the window holding the question itself, which scored 1.00 against the question it contains while the windows with the facts scored 0.15 to 0.16, under the 0.2 floor. "launching" never matched "launch".
- **Change:** the asked question's own line is removed before scoring and never returned as evidence; speech is matched on light word stems; the live window is 6,000 characters read from the durable transcript (600 s).
- **Result:** 36 of 36 transcript facts recalled.

### 8.11 Fast-route turns read a pack that fits (E13, `643ef204`, 2026-10-04)

- **Problem seen:** since packs are handed over whole, a turn the classifier answered from general knowledge read nothing from them: 10 of 333 turns ("Can both be had on Operations?" got "I'll confirm" with the integration matrix loaded and unread).
- **Change:** such a turn reads the pack.
- **Cost:** the pack's tokens on every such turn of a mode that has one.
- **Result:** needed facts delivered on 204 → 209 rows; the gained rows rose by 3.0 points (Claude Code judge).

### 8.12 Whole profile and pack planned on every retrieving turn (E16, `83d3962f`, 2026-10-04) and kept by the gate (E16b, `e9f5ceef`, 2026-10-05)

- **Problem seen:** spoken "How often are you carrying the pager these days?" was classified a document question, the résumé was not planned, and the answer gave another company's on-call checklist as the candidate's own (2.1 of 10). 19 profile-mode turns with a profile loaded had no résumé in the prompt. With E16 alone, the gate then removed one or both whole documents on nine turns.
- **Change:** a retrieving turn plans the whole profile and the whole pack when they fit, whatever the classifier named; a résumé or job description handed over whole is not removed by the claim-authority gate. Presence in the prompt only: a job description still cannot back a claim about the candidate.
- **Result:** E16 alone was not kept as built (résumé missing 24 → 4, but delivery 490 → 488). E16b first measured +0.36 under Astra against a bar of +0.5 and was not kept on that measurement. Measured again as E16c on the 80 rows it changes, two replays per row and build: 8.35 → 8.70, hard fails 17 → 14; the blind-holdout safety rule held on 180 pairs. Landed 2026-10-06.

### 8.13 A statement of absence is not a claim to remove (E19, `73b18d97`, landed 2026-10-09)

- **Problem seen:** asked for something the material does not hold, the draft said so, and the fix-up pass removed the sentence as "unsupported". "Nothing in the status notes or the risk register says legal has signed off" became a status report. "There is no cost per building anywhere in the material" and "I don't want to give you a number I haven't verified" went the same way. Questions whose answer is absent were the weakest type on main (8.04 against 8.92 overall).
- **Change:** one sentence of the pass's instructions. Its "never list these" list now names a statement that the material does not contain, state or settle something, and declining to give a figure that cannot be verified.
- **Why wording and not code:** the pass decides what to list; nothing in code can tell an honest "that isn't there" from an invention without reading the material as the pass does.
- **Why this is not the 2026-10-01 "honest limit" exemption again:** that wording was broader, was judged neutral and was withdrawn; a test pinned its absence. The E19 clause is narrower, and the test now pins it.
- **Result:** development replay on 470 passes, the 88 rows that differ: 8.29 → 8.68, hard fails 12 → 7, invention flags 11 → 6; where the asked fact is absent (35 rows) 8.19 → 8.63. In the app on the same 88 questions: 8.50 → 8.62. Blind holdout: section 7.6. Pass time at the slow end +224 ms on development and +88 ms on the holdout, inside the 300 ms bar.
- **Checked before landing** (fresh build, macOS, plain `node --test`): type check clean; 111 focused tests pass; `electron/llm` 6,036 pass and 0 fail; `electron/intelligence` and `electron/context-intelligence` 0 fail of 2,917; `electron/services` 122 fail of 5,730, identical on the commit before E19 (trap 9 in section 5).

---

## 9. What changed in the prompts

Almost every kept change is about *what reaches* the prompt (whole files, whole profile, more speech, the fix-up pass seeing the whole prompt), not its wording. The answer model's instructions were not reworded by this work.

One wording change is on main: E19, in the fix-up pass (`electron/llm/claimVerifier.ts`, constant `LIST_THEN_REWRITE`). Every other wording that was tried was rejected:

| Change | Text | Why tried | Status |
|---|---|---|---|
| E19 | The "Never list these" sentence gains: a statement that the material does NOT contain, state or settle something; and declining to give a figure they cannot verify | The pass removed honest statements of absence | **On main** (`73b18d97`) |
| E6 v1, v2 | CONFLICT line fires only for two sources of equal standing (two wordings) | The pass hedged between a current document and an outdated one | Not kept: +0.06 (±0.08), not distinguishable from zero |
| E9 | Names two shapes of invention when the asked fact is absent | On 7 of 11 rows that hard-failed with no document needed, the pass ran and left the invention in | Nothing concluded |
| E15 (two wordings) | A note in the answer prompt for typed questions | A privately typed question was answered as a line to say to the other person (10 of 91 typed rows) | Not kept: failed all three lines |
| E17 | CONFLICT line fires only when the material does not settle it; rule 3 forbids adding a second value | Same as E6 | Not kept: conflict-ignored flags 1 → 5 |
| E18 | CONFLICT line ends "settled: X" or "open"; settled → give the current value | Same as E6 | Not kept: conflict-ignored flags 3 → 13, hard fails 27 → 34 |
| "CHECK:" line (two wordings) | The pass quotes the material for each statement before listing | The pass wrote "UNSUPPORTED: none" on 21 of 34 answers capped for an invented detail | Dropped, never declared: it removed worked-out figures and honest conclusions from 12 of 28 drafts scored 9.5 or above |
| "Decide, then say it" notice | Beside "# Today" in the answer prompt: the deciding fact before the verdict | 13 answers contradict themselves | Dropped, never declared: fixed two rows, broke a third |

**Closed, do not re-propose:** any rewording of the pass's conflict line (E6, E17, E18), any rail on that line's text (E20), a per-statement check line, the "decide, then say it" notice, a pass sentence gated on denials, a generator notice for multi-source omissions, a rail on edits that drop a fact.

Section 13 prints the pass's instruction block as it is on main and the full text of every variant file, so a rejected wording is not re-proposed by accident.

---

## 10. Where the data is

| What | Where |
|---|---|
| Question sets | `evidence-rich/datasets/dev.json` (270), `dev2.json` (360), `holdout.json` (180, blind), three `supp-*.json` |
| Documents the questions rest on | `evidence-rich/evidence/files/` (104 synthetic files) and `evidence-rich/oracles/` |
| Experiment log | `evidence-rich/docs/ITERATIONS-ER.md` (printed in full as Appendix B) |
| Investigation documents | `evidence-rich/docs/` (printed in Appendix C, except the corpus index `EVIDENCE-CORPUS.md`) |
| Runs that still exist | `evidence-rich/results/`: `er4-dev-main`, `er4-dev2-main` (baseline of main), `er5-*` (E19 in app), `er3-*` (E16c), `er-holdout-m3`, `er-holdout-e16b3`; copies in `~/natively-er-backup/results/` |
| Astra judgments | `evidence-rich/judge/out/base/*.astra.jsonl` (committed) and `~/natively-er-backup/judge-out/` |
| Calibrations | `evidence-rich/judge/out/calibration/` and `~/natively-er-backup/calibration-astra-*.json` |
| Replay arms | `evidence-rich/results/replay/`: `e19-ctl`, `e19`, `e19h-ctl`, `e19h` (two repetitions), `e20`, `e20s-ctl`, `e20s`, `e20h`, `x20-*`, `gen-x20-*`, `gen-e16c3-*`; copies in `~/natively-er-backup/replay/` |
| Replay variants (every wording tried) | `evidence-rich/replay-variants/` |
| Rule checks | `evidence-rich/report/rule-e16.mjs`, `rule-e16c.mjs`, `rule-e17.mjs`, `rule-e19.mjs`, `rule-holdout-e16b.mjs`, `pair-aggregate.mjs` |
| Window scripts | `~/natively-er-backup/scripts/` (`er-window-chain-20261009.mjs`, `er-window-probe-20261008.mjs`, `er-access-guard-20261008.mjs`, `er-e19h-k1-20261009.mjs`) |
| Second session of 2026-10-09 | Runs `er6-dev-main`, `er6-dev2-main` (main with E19, unjudged bar 49 rows), `er7-chal-main`, `er7-code1-main`, `er7-chalval-main` (main on the new sets); replay arms `gen-e21-*`, `gen-e21b-*`, `gen-e21c-*`, `gen-e21d-*`, `gen-e21e-*`, `gen-e22-*`; threshold probe rows `results/x1/t12000|t24000|t48000/`; readers `report/rule-e21.mjs`, `report/x1-threshold.mjs`, `report/challenge-read.mjs`, `report/rescore-objective.mjs`; scripts in `~/natively-er-backup/scripts/` |
| This file's generator | `evidence-rich/report/build-handoff.mjs` with `report/handoff-head.md` |

---

## 11. Open decisions and next steps

**Open with Evin**

1. **Push the benchmark branch `bench/evidence-rich`?** GitHub has `df815379`; the local branch is ahead from `99001d3b` on. The push was denied on 2026-10-08 and must not be retried by any route without his explicit yes. Until then the commits exist only on this machine and in `~/natively-er-backup/`.
2. **Merge or close draft PR #638.** Merging puts the blind holdout's questions on public main.
3. **Delete the old-history branches on GitHub** (`fix/aq-astra`, `cand/e16b`, `cand/e15`)? They keep files purged on 2026-10-06 reachable.
4. **A judged score of main with E19.** The run exists (`er6-dev-main`, `er6-dev2-main`); Astra's window of 2026-10-09 11:02 UTC was closed by an access block after 43 of 630 judgments. The next window finishes it (section 4). A holdout run of `73b18d97` has not been made.
5. **Windows and a packaged build.** Nothing in this work has been executed on Windows or in a packaged app.
6. **The whole-pack threshold.** X1 (synthetic files) and now **X2 (realistic packs of about 20,700 tokens, 361 questions)**: main, which retrieves pieces above 12,000 tokens, is right on 54.3 % and puts 48 % of the needed facts in the request; reading the pack whole (24,000) is right on 87.0 %, with the spoken first word 0.76 s faster (no retrieval, no awaited rerank), the typed first word 0.43 s later, a request 3.6 times the size, and the fix-up pass settling late on 26.5 % of its turns instead of 16.4 %. Two of X2's seven lines fail on those costs, so it is reported as a gain with its price, not proposed. Arm A is the default configuration (bundled local embedding model: keyword search on spoken turns); a cloud embedding provider was not measured. His call whether to pursue "24,000 with the pass's cap and budget raised with it". A fixed sample of both arms is queued for Astra after the baseline.
7. **The provider's access block.** Two in three days (2026-10-08 02:07 UTC, five calls; 2026-10-09 11:12 UTC, three calls two minutes into judging, after a clean calibration). Nothing was retried. If it keeps happening the judge budget is the limit on this work, not ideas.
8. **Code verification is switched off app-wide** (`electron/llm/codeVerification/verificationEnabled.ts`, since 2026-07-18, no reason recorded in the commit). Main passes 34 of 36 coding questions of `code1` without it. Its correction is posted as a new message, which the benchmark harness does not capture, so it was not measured.
9. **E23 as a correctness fix.** `cand/e23` `9bfff943` stops a résumé's derived experience statements from being served as evidence when the résumé's own text shows one of them to be wrong (a title paired with the next employer on the page, a description line or a page marker as the employer). It did not meet its gain line on unseen questions (+6.8 points, interval through 0), so it is not proposed as a score change. The statements it removes are wrong on their face on both benchmark résumés. Land it or leave it is his call.
10. **A DeepSeek-only user's profile is extracted by rules, not by a model.** `generateContentStructured` answers "No reasoning model available" when DeepSeek is the only key, and the résumé falls to the rule-based parser, which is where the wrong pairings come from. Every profile row of this benchmark has run that way. Letting DeepSeek serve the structured extraction is a provider-routing decision.

**Next candidates, in the order the data suggests**

1. **Check any candidate on unseen questions first.** `challenge` (readable) and `challenge-val` (aggregates only) exist for that and cost a few minutes of replay and no judge call. E21 would have reached an app run and an Astra window without them.
2. The largest class has no handle yet: invented company, policy, research or personal facts (22 of the 71 hard fails). Two ways of making the pass stricter were measured and removed correct inference (the per-statement check) or would hit 30 answers of which 4 are real inventions (enforcing the pass's own list). A third attempt needs a signal that separates an invention from an honest inference; none is known at this model setting. Third session (2026-10-09): three source-aware mechanisms were measured for it. E23 (résumé statements the résumé text does not support) is real but small. E24 (a notice when the posting is the only document) does not stop the posting being told as the candidate's history; what is left there is not handing the posting over as evidence on a turn that asks only for the user's own record, which needs a classifier that separates "what do you do now" from "what is this team responsible for". E25 (the pass is shown the passages nearest each sentence) nearly doubles what the pass names on drafts Astra capped (12 → 23 of 60 samples, most clearly research claims) and on unseen drafts changes more answers that were right (13.2 → 17.8 %); the same sheet for Seminar turns only is the untested lead.
3. Version conflicts are the weakest kind on the readable challenge set (4 of 9 right on main). Every rewording of the pass's conflict line and a rail on it failed (E6, E17, E18, E20); the open idea is still the source identity of each value (`source_id` / `version_id`), which the pass's conflict line does not carry.
4. A hidden working step sets a sum up wrongly when a near-miss figure sits in the pack, and then trusts it (E21 stage four, `ER-C1-SALES-013`). A check of the working's INPUTS against the documents (not of its arithmetic, which is right) is untested and would have to run before the first visible word.
5. The larger-pack condition now exists (`pack24`, X2). What is not measured on it: a cloud embedding provider and the managed reranker (arm A ran the bundled local model), the pass with its cap and budget raised, and the pack placed where the provider can cache it (the question comes before the documents in the request, so 5,248 of 29,759 prompt tokens are cache hits).
6. Follow-up turns: the pass lowered 4 of them (8.11 → 6.41). Too few to act on; worth a look when more are judged.
7. One spoken turn still takes the fast route with no profile (`ER-D2-LFW-030`); `ER-D-REC-016` is a possible delivery gap too.

**To land a future candidate:** on a fresh build of its branch run the four suites (`electron/context-intelligence`, `electron/intelligence`, `electron/llm`, `electron/services`) *and the same suites on current main as a baseline*, before the fast-forward; rebase if main has moved; fast-forward; push only on Evin's word. The project `CLAUDE.md` rules apply to any code change (cross-platform contract, graph tools first, the validation labels).

---

