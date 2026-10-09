# Handoff: Natively answer-quality work on the evidence-rich benchmark

Written 2026-10-07 (about 03:30 UTC) for whoever continues this work, human or agent.
It covers 2026-10-03 to 2026-10-07: every iteration with its rule and verdict, the scores per mode per round, what changed in the code and in the prompts, and every development question with the answers that still exist.

The full experiment record, with each rule as written before measuring, is `benchmarks/natively-answer-quality/evidence-rich/docs/ITERATIONS-ER.md` on branch `bench/evidence-rich` (draft PR #638). This document summarises it and adds what it does not hold. Where the two disagree, the log wins.

---

## 1. State in one screen

**2026-10-09, 05:08 UTC: E19 is on local main.** Evin's word in chat ("do 1", answering "Land E19 on main?").
Local `main` was fast-forwarded `bce8e47a` → `73b18d97`, one commit, three files. **Not pushed:** GitHub `main`
is still `bce8e47a`; publishing is Evin's separate word. Checked on a fresh build of that commit: see the log entry
"E19 — landed on local main". The score table below still describes main before E19 (`f4cd986d` baseline).

**2026-10-09, 02:16 UTC: the E19 blind-holdout check is done and both readings hold.** Calibration 38/38 with exact
gpt-6-astra, no access block, no failed call.
- Rule of 2026-10-07, on the 25 rows where the arms differ (repetition 0): 8.105 → 8.135 (+0.031, ±0.499), hard
  fails 5 → 5, invention-flagged rows 4 → 4. Holds.
- Rule of 2026-10-09, two repetitions pooled, 52 pairs: 8.158 → 8.384 (+0.226, ±0.376), hard fails 9 → 8, invention
  rows 7 → 6, pass p90 +88 ms. Holds. Repetition 1 alone, 27 pairs: 8.208 → 8.615 (+0.407, ±0.558), hard 4 → 3.
- Read plainly: no harm on the blind holdout, a gain that points the same way as development but is not outside its
  interval. E19 held on every rule written for it and was landed on local main later that day (above).
- The 2026-10-08 partial (20 of 25 pairs, 403 block on five calls) is superseded; the block did not recur.
- Tried without the judge and dropped on 2026-10-09 (do not re-propose): a per-statement check line in the claim
  pass, a "decide, then say it" generator notice, E20 (a rail on the pass's conflict line). Details in the log.
- Local commits on `bench/evidence-rich` after `99001d3b` are NOT pushed; publication needs Evin's explicit yes.
- A window is now run as one background script (`~/natively-er-backup/scripts/er-window-chain-20261009.mjs` and
  `er-e19h-k1-20261009.mjs`): probe, calibrate once, judge only what a saved plan still misses, aggregates.
Do not run `astra-next5.sh` blindly: its auto-commit lacks current attribution and its quota filter misses 403.

| Thing | State |
|---|---|
| App `main` (local = GitHub) | `bce8e47a` when this was written. Holds every kept change of this work, including E16b. |
| Landed on local main 2026-10-09 | **E19** (`73b18d97`, also branch `cand/e19`, worktree `.claude/worktrees/er-main`). Not on GitHub `main` yet. |
| Benchmark | Branch `bench/evidence-rich`, draft PR #638, worktree `.claude/worktrees/aq-fix`. Folder `benchmarks/natively-answer-quality/evidence-rich/`. |
| Judge | gpt-6-astra only (through AgentRouter). Evin, 2026-10-05: do not judge with Claude Code (quota). |
| Score of main today, development set, Astra | 630 questions: **8.92**, 71 hard fails (11.3 %), 414 at 9.5 or above. |
| Score of main today, blind holdout, Astra | 180 questions: **8.84**, 23 hard fails (run `er-holdout-e16b3`, the code now on main). |
| Where it started, blind holdout, Astra | 7.73, 42 hard fails (run `er-holdout-base`, the build before this work). |
| Targets set at the start | 9.2 mean, under 1 % hard fails. Not met. |

Evin's standing instructions that bind the next session:

- Astra is the only judge. When Astra is closed, do judge-free work and wait.
- No reasoning on the answer model: "the point of natively is to answer fast".
- The awaited rerank on spoken turns stays as on main.
- Nothing lands on `main` without his word. He has given it for everything now on main; E19 is still pending.
- Rules are written and committed before measuring. A candidate that fails its rule is not kept, whatever else it shows.
- All benchmark content is synthetic. Keys are read from `/Users/evin/natively-cluely-ai-assistant/.env` in-process and never printed.

---

## 2. How to resume

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
evidence-rich/results/astra-next5.sh         # probe, calibration, then E19's blind-holdout replay (50 judgments)
```

- Three processes of three calls each is reliable. Twelve calls at once gave "fetch failed" on a third of them.
- Calibration (38 pairs, about 7 minutes) runs once per window; 35 of 38 are needed.
- Background watchers and session crons die when the Claude Code session restarts. Re-check on every resume.

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

## 3. Traps that cost time

1. **`.claude/worktrees/` was deleted on 2026-10-06** by something other than this work. Every run folder, judgment file and judge cache before that date is gone. Their numbers survive in `ITERATIONS-ER.md`; they can be cited, not recomputed. Since then rows and Astra judgments are committed, and run folders are copied to `~/natively-er-backup/`.
2. **History was rewritten on 2026-10-06** (`git filter-repo`, another session) to purge dev harness pages and `cluely-*` assets. Commit hashes in notes older than that date are pre-rewrite; find commits by message. A worktree's index kept the purged files, and the next commit there re-added them; before pushing any branch run `git diff --name-only main...<branch>` and check every path is intended.
3. **Old-history branches still on GitHub**: `fix/aq-astra`, `cand/e16b`, `cand/e15` (this work) and many `backup/*`. They keep the purged files reachable. Deleting them is Evin's call.
4. **The blind holdout**: read aggregates only. Never read its questions or answers to design a change.
5. **Run-to-run variation is large.** Same build, same prompts: a set of 180 moves by about ±0.16, one mode of 20 to 30 by about ±0.7, and single answers by several points. One run per build cannot decide a small effect; use replays with repetitions (E16c is the model).
6. **Two judges, never pooled.** Scores marked "Claude Code judge" or "Opus" are a different series from Astra's.
7. **A test may pin an earlier decision.** E19 tripped a test recording that a broader exemption had been tried and withdrawn on 2026-10-01. Read the note beside a failing test before changing it.

---

## 4. Every iteration: what it tried, how it was measured, verdict

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
| E19 | Pass wording: a statement that the material does NOT contain something is not a claim to remove | replay on 470 passes (A), then in-app run of the 88 rows it changes (A) | 8.29 → 8.68, hard fails 12 → 7, invention flags 11 → 6; in app 8.50 → 8.62 | **Keep candidate**, not landed (section 9) |

Lessons that hold across them:

- Retrieval is no longer the limit: every needed fact is in the prompt on 497 of 499 development questions that need one.
- The fix-up pass helps overall (Astra, 99 edited answers: 8.23 → 8.47, hard fails 22 → 11). It hurts when it removes honest statements of absence (E19 addresses that) and on a handful of follow-up turns.
- Every attempt to let the pass treat a document conflict as settled raised a worse error. Astra penalises the existing "given two ways" hedge least.
- Of 71 hard fails on the development set, 57 are answers the pass never edited: the answer model misreading, miscalculating or mis-combining facts that are in the prompt (factual error 21, missed available evidence 20, reasoning 10, arithmetic 8, unsupported claims 26). That is the next lever, and it is hard to move without reasoning.

---

## 5. Scores per mode, per round

Never compare across judges. Within one judge, a mode column moves by about ±0.7 between runs of the same build.

### 5.1 Blind holdout (20 questions per mode), gpt-6-astra

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

### 5.2 Development set (70 questions per mode: dev 30 + dev2 40), main `f4cd986d`, gpt-6-astra

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

### 5.3 Development set, the build of 2026-10-05 (`cand/e13b`), Claude Code judge (a different series)

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

### 5.4 Earlier rounds (Claude Opus 5.5 judge, 2026-10-03/04), overall only

The kept build at the start delivered only 51 % of needed facts and scored 7.44. After E1, E5 and E2 landed, main scored 8.58 on 513 development rows and the blind holdout went 7.40 → 8.54. Per-mode tables for those rounds are in `ITERATIONS-ER.md` (sections E1, E5, E2 and M1) and in `docs/` of the benchmark; their raw data is gone.

---

## 6. What changed in the code

All of this is shared TypeScript in the answer path. None of it is platform-specific: no OS calls, paths, native modules or window code. It was run physically on macOS in the dev build through the benchmark; it has never been executed on Windows.

Section 10 lists every commit with its files. In plain words, in the order it landed:

1. **A pack that fits is read whole** (E1). When a mode's reference files fit the prompt (up to 12,000 estimated tokens), a turn that reads the files gets each file entire instead of a few passages.
2. **The fix-up pass sees what the answer saw** (E5). The pass that removes unsupported claims was shown only the first 24,000 characters of the prompt and so "removed" facts it could not see. It now gets up to 96,000.
3. **Hidden working no longer leaks** as tool-call markup into the streamed answer.
4. **Résumé and job description handed over whole** (E2) when together they fit 6,000 estimated tokens.
5. **A mode's own file is not dropped by the claim-authority gate** (E8 a). The Recruiting job description was being removed on spoken turns.
6. **Typed text is not "cleaned"** (#2). The speech filler stripper altered typed questions; it now applies to speech only.
7. **Long answers** (#3): the output limit is 48,000 characters, a looping answer is stopped by a repetition guard, and a cut-off answer says so in the overlay (with ru, zh, ja, es wording).
8. **The spoken repair reads the whole prompt** (E10), like the fix-up pass.
9. **Retrieval ranking and fit** (E11): a named fact outranks passages sharing only common words; the retriever picks only what the packer can fit; in a meeting, typed questions use the embedding search while spoken turns keep keyword search plus the awaited rerank (two follow-up corrections restored that).
10. **Older speech** (E12): for a long or multi-part question the spoken line itself no longer crowds out earlier speech; word forms match ("launching" finds "launch"); the live window keeps about four to five minutes.
11. **Fast-route turns read a pack that fits** (E13).
12. **Whole profile and pack planned on every retrieving turn** (E16) and **whole profile documents kept by the claim-authority gate** (E16b). Presence in the prompt only: what a job description may *support* is unchanged, so it still cannot back a claim about the candidate.

Not on main: E19 (section 9).

---

## 7. What changed in the prompts

Most kept changes are about *what reaches* the prompt, not its wording. The wording changes are all in the fix-up pass (`electron/llm/claimVerifier.ts`, constant `LIST_THEN_REWRITE`), and only one of them is a keep candidate:

| Change | Text | Status |
|---|---|---|
| E19 | The "Never list these" sentence gains: a statement that the material does NOT contain, state or settle something; and declining to give a figure they cannot verify | Landed on local main 2026-10-09 (`73b18d97`) |
| E17 | CONFLICT line fires only when the material does not settle it; rule 3 forbids adding a second value | Not kept |
| E18 | CONFLICT line ends "settled: X" or "open"; settled → give the current value | Not kept |
| E6 v1, v2 | Earlier wordings of the same idea | Not kept |
| E9 | Names two shapes of invention when the asked fact is absent | Nothing concluded |
| E15 | A note in the answer prompt for typed questions | Not kept |

Section 11 prints the pass's instruction block as it is on main, the E19 version, and the full text of every variant that was tried, so a rejected wording is not re-proposed by accident.

---

## 8. Where the data is

| What | Where |
|---|---|
| Question sets | `evidence-rich/datasets/dev.json` (270), `dev2.json` (360), `holdout.json` (180, blind), three `supp-*.json` |
| Documents the questions rest on | `evidence-rich/evidence/files/` (104 synthetic files) and `evidence-rich/oracles/` |
| Experiment log | `evidence-rich/docs/ITERATIONS-ER.md` |
| Context-limit investigation (2026-10-04) | `evidence-rich/docs/CONTEXT-LIMITS.md` and five sibling documents |
| Runs that still exist | `evidence-rich/results/`: `er4-dev-main`, `er4-dev2-main` (baseline of main), `er5-*` (E19 in app), `er3-*` (E16c), `er-holdout-m3`, `er-holdout-e16b3`; copies in `~/natively-er-backup/results/` |
| Astra judgments | `evidence-rich/judge/out/base/*.astra.jsonl` (committed) and `~/natively-er-backup/judge-out/` |
| Replay arms | `evidence-rich/results/replay/` (`e19-ctl`, `e19`, `e19h-ctl`, `e19h`, `gen-e16c3-*`) |
| Rule checks | `evidence-rich/report/rule-e16.mjs`, `rule-e16c.mjs`, `rule-e17.mjs`, `rule-e19.mjs`, `rule-holdout-e16b.mjs` |

---

## 9. Open decisions and next steps

**Open with Evin**

1. **Push local main (E19, `73b18d97`) to GitHub?** Landed locally 2026-10-09 on Evin's word; the push is not done. Earlier text of this item: Land E19? Recommended: after its blind-holdout replay is judged. That replay is done (25 holdout answers differ) and needs 50 Astra judgments: `evidence-rich/results/astra-next5.sh`. Its rule: mean change ≥ 0, hard fails ≤ control arm, rows flagged for an unsupported or fabricated claim ≤ control arm + 1. If a line fails, E19 is not landed.
   To land: on a fresh build of `cand/e19` run the four suites (`electron/context-intelligence`, `intelligence`, `llm`, `services`; two failures in `services` are already on main: `RetrievalScaleLexical:173`, a to-do, and `TrialCampaignIpc:97`), rebase onto current main if it has moved, fast-forward, push.
2. **Delete the old-history branches on GitHub** (`fix/aq-astra`, `cand/e16b`, `cand/e15`)?
3. **Merge or close draft PR #638.** Merging puts the blind holdout's questions on public main.

**Next candidates, in the order the data suggests**

1. The answer model's own errors on facts that are in the prompt (57 of the remaining hard fails). Ideas not yet tried: a narrow arithmetic check extended beyond the existing calculation scratch; a second look only on turns with numbers from two documents. Anything that delays the first word is out.
2. Listed-but-kept inventions: on several profile-mode answers the pass correctly *lists* an invented personal claim and then keeps it reworded. The code deliberately does not enforce the list (a fifth of listed phrases are listing mistakes the pass then corrects). A targeted rail for `[self]` phrases is untested.
3. Follow-up turns: the pass lowered 4 of them (8.11 → 6.41). Too few to act on; worth a look when more are judged.
4. One spoken turn still takes the fast route with no profile (`ER-D2-LFW-030`).
5. The whole-file threshold (12,000 tokens against 24,000 or 48,000), which Evin asked to test, has not been started: the benchmark's packs all fit under 12,000, so it needs a new condition.

**Suggested skills for the next session:** none is required. The project `CLAUDE.md` rules apply to any code change (cross-platform contract, graph tools first, the validation labels). `code-review` is worth running on `cand/e19` before landing.

---

## 10. Commits on main that make up this work

Hashes are post-rewrite (2026-10-06). Listed oldest first. Files are the ones each commit touches.

- `803c7612` 2026-10-03 — feat(retrieval): a reference pack that fits the prompt is read whole on a turn that reads the files
  - `electron/context-intelligence/__tests__/SmallReferenceCorpusReadWhole2026_09_30.test.mjs`
  - `electron/context-intelligence/__tests__/WholePackReadOnRetrievingTurn2026_10_03.test.mjs`
  - `electron/context-intelligence/orchestration/orchestrator.ts`
  - `electron/context-intelligence/retrieval/mode-retrieval-port.ts`
- `18d2603e` 2026-10-03 — fix(answers): hidden working written as tool-call markup no longer streams to the user
  - `electron/llm/__tests__/CalcScratchToolMarkup2026_10_03.test.mjs`
  - `electron/llm/calcScratch.ts`
- `948b0b3c` 2026-10-03 — fix(answers): the claim pass is shown the whole prompt the answer was built from
  - `electron/IntelligenceEngine.ts`
  - `electron/LLMHelper.ts`
  - `electron/llm/__tests__/ClaimVerifier2026_09_30.test.mjs`
  - `electron/llm/__tests__/ClaimVerifierSeesWholePrompt2026_10_03.test.mjs`
  - `electron/llm/claimVerifier.ts`
  - `electron/llm/performance/recorder.ts`
- `feea02a9` 2026-10-04 — feat(profile): a résumé and job description that fit the prompt are handed over whole on a turn that reads the profile
  - `electron/IntelligenceEngine.ts`
  - `electron/context-intelligence/__tests__/ProfileHandedOverWhole2026_10_03.test.mjs`
  - `electron/context-intelligence/contracts/types.ts`
  - `electron/context-intelligence/orchestration/engine-bridge.ts`
  - `electron/context-intelligence/orchestration/orchestrator.ts`
  - `electron/context-intelligence/retrieval/legacy-retrieval-port.ts`
  - `electron/context-intelligence/retrieval/profile-retrieval-port.ts`
  - `electron/ipcHandlers.ts`
- `4aabf0b4` 2026-10-04 — fix(retrieval): a file of the mode handed over whole is not removed from the prompt by the claim-authority gate
  - `electron/context-intelligence/__tests__/LoadedPackReachesEveryTurn2026_10_04.test.mjs`
  - `electron/context-intelligence/retrieval/legacy-retrieval-port.ts`
- `c5e8d42c` 2026-10-04 — fix(question): typed chat reaches the model verbatim; the speech filler stripper stays for speech
  - `electron/context-intelligence/__tests__/TypedQuestionVerbatim2026_10_04.test.mjs`
  - `electron/context-intelligence/orchestration/orchestrator.ts`
- `8ca5cac9` 2026-10-04 — fix(answers): long answers get 48,000 chars, a looping answer is stopped by its repetition, and a cut-off answer says so
  - `electron/IntelligenceEngine.ts`
  - `electron/LLMHelper.ts`
  - `electron/llm/WhatToAnswerLLM.ts`
  - `electron/llm/__tests__/RepetitionLoopStop2026_10_04.test.mjs`
  - `electron/llm/__tests__/RunawayStreamOutputCap2026_08_12.test.mjs`
  - `electron/llm/__tests__/TruncatedAnswerNotStored2026_08_12.test.mjs`
  - `electron/llm/liveDeadlines.ts`
  - `electron/llm/repetitionGuard.ts`
  - `electron/main.ts`
  - `electron/preload.ts`
  - `src/components/NativelyInterface.tsx`
  - `src/i18n.directAssist.ts`
  - `src/lib/__tests__/directAssistFailure2026_10_01.test.mjs`
  - `src/lib/__tests__/ownStopNotice2026_10_04.test.mjs`
  - `src/lib/directAssistFailure.d.mts`
  - `src/lib/directAssistFailure.mjs`
  - `src/types/electron.d.ts`
- `e1fe2d09` 2026-10-04 — fix(repair): the heard corrected-answer repair inherits the whole answer prompt (96,000), like the claim pass
  - `electron/IntelligenceEngine.ts`
  - `electron/llm/__tests__/ClaimVerifierSeesWholePrompt2026_10_03.test.mjs`
- `7de6bc59` 2026-10-04 — fix(retrieval): a named fact outranks pieces sharing only common words; the retriever picks only what the packer fits; typed questions use the embedding search
  - `electron/context-intelligence/retrieval/mode-retrieval-port.ts`
  - `electron/llm/documentGroundedPrompt.ts`
  - `electron/services/ModeContextRetriever.ts`
  - `electron/services/__tests__/LocalEmbedderVectorsOutsideMeeting2026_09_19.test.mjs`
  - `electron/services/__tests__/OkfPhase1StabilizationFixes.test.mjs`
  - `electron/services/modes/ModeHybridRetriever.ts`
- `e47cb7e6` 2026-10-04 — fix(speech): older speech comes back for long questions, and the live window keeps four to five minutes
  - `electron/IntelligenceEngine.ts`
  - `electron/context-intelligence/__tests__/LiveTranscriptOlderSpeech2026_10_04.test.mjs`
  - `electron/context-intelligence/orchestration/engine-bridge.ts`
  - `electron/context-intelligence/retrieval/live-transcript-port.ts`
  - `electron/ipcHandlers.ts`
  - `electron/llm/__tests__/SpeechWindowKeepsMoreSpeech2026_10_04.test.mjs`
  - `electron/llm/conversationHistoryPolicy.ts`
- `643ef204` 2026-10-04 — feat(retrieval): a turn the classifier answers without retrieval still reads a reference pack that fits
  - `electron/context-intelligence/__tests__/SmallReferenceCorpusReadWhole2026_09_30.test.mjs`
  - `electron/context-intelligence/__tests__/WholePackReadOnRetrievingTurn2026_10_03.test.mjs`
  - `electron/context-intelligence/orchestration/orchestrator.ts`
- `2fa1cf7b` 2026-10-04 — fix(retrieval): the rerank's confidence gate keeps the pre-E11 score; only the ranking uses the new one
  - `electron/llm/documentGroundedPrompt.ts`
  - `electron/services/__tests__/RerankGateKeepsPreE11Score2026_10_04.test.mjs`
  - `electron/services/modes/ModeHybridRetriever.ts`
- `05ae494b` 2026-10-04 — fix(retrieval): in a meeting only TYPED questions query the bundled embedder; heard turns keep the keyword search and the awaited rerank
  - `electron/services/__tests__/LocalEmbedderVectorsOutsideMeeting2026_09_19.test.mjs`
  - `electron/services/__tests__/WtaActiveCodingProblem2026_09_23.test.mjs`
  - `electron/services/modes/ModeHybridRetriever.ts`
- `83d3962f` 2026-10-04 — feat(retrieval): a turn that retrieves plans the whole profile and the whole pack when they fit, whatever the classifier named
  - `electron/context-intelligence/__tests__/FittingSourcesAlwaysPlanned2026_10_04.test.mjs`
  - `electron/context-intelligence/orchestration/orchestrator.ts`
- `e9f5ceef` 2026-10-05 — fix(retrieval): a résumé or job description handed over whole is not removed from the prompt by the claim-authority gate
  - `electron/context-intelligence/__tests__/WholeProfileKeptByClaimGate2026_10_05.test.mjs`
  - `electron/context-intelligence/retrieval/legacy-retrieval-port.ts`

On local main since 2026-10-09 (not on GitHub `main`): `cand/e19` (`73b18d97`), one commit: `electron/llm/claimVerifier.ts`, a new test `electron/llm/__tests__/ClaimVerifierAbsenceIsNotAClaim2026_10_07.test.mjs`, and an updated assertion in `ClaimVerifier2026_09_30.test.mjs`.

## 11. The fix-up pass: its instructions, the E19 change, and every wording that was tried

### 11.1 `LIST_THEN_REWRITE` as it is on main

This block is appended to the pass's system prompt in every mode. The mode-specific opening (who is speaking, what counts as their own claim) is built by `claimVerifierSystemPrompt` in the same file.

```
Work in two steps and output both.
Step 1, one line starting "UNSUPPORTED:" — only the phrases of the draft that state AS FACT something the material does not state, each followed by its kind in square brackets, separated by " | ":
[past] something that already happened or is already true and that only a record can establish: what they did, led, built, measured or agreed, a number, a price, a policy, a procedure, a capability, a customer, a result;
[self] a fact about who they already are: an existing preference, habit, motive, feeling, strength or weakness, or when they are available;
[promise] a promise with consequences: money, a refund or credit, a price or discount, a contract term, a delivery date or deadline, a guarantee, what the product or the company will do.
Never list these, they are not claims that need a record: a decision or choice they make now ("let's do the pads today", "I can take this", "I'd go with REST here"); taking a task or offering to; a recommendation or professional judgment ("I'd shift the plan rather than re-plan it"); an ordinary small commitment ("I'll send that today", "I'll check and come back to you", "I'll stay on this with you"); general knowledge; what the other person said; what the material states.
Write "UNSUPPORTED: none" when there is nothing to list.
Then one line starting "CONFLICT:" — if the material itself gives two different values or rules for the very thing that was asked, both in a few words; otherwise "CONFLICT: none".
Step 2, after a line containing only "---" — the revised reply, built by these rules in order:
1. Every phrase you listed is gone: none of them appears, in any wording.
2. Everything you did not list stays word for word, decisions, ownership, recommendations and small commitments included.
3. If CONFLICT is not "none", the reply asserts neither value. Where the draft asserted one, one sentence says it is given two ways, names both values, and says it needs confirming before anyone relies on it. If the draft already says so, leave it.
4. If removing the listed phrases leaves what was asked without an answer, do not hand the question back to the other person. For a preference, a willingness or their availability: one short sentence, in their own voice, that they will confirm it and come back on it, with a day if the draft implied one. For a reason, a motive or an event in their own past: the plain facts about it that are stated (the dates, the role, the project; for a question about a job, what that job is), said as their own facts, and nothing invented after it.
The reply is spoken by them: it never says "the material", "the record" or where a fact comes from.
If nothing was listed and there is no conflict, the revised reply is the draft unchanged.
```

### 11.2 The E19 change (`73b18d97`, on local main since 2026-10-09)

The sentence that ended:

```
general knowledge; what the other person said; what the material states.
```

now ends:

```
general knowledge; what the other person said; what the material states; a statement that the material does NOT contain, state or settle something ("nothing in the notes says legal has signed off", "there's no cost figure anywhere in the paper", "that isn't in what I have"), which is the honest answer when the asked thing is absent; declining to give a figure or a detail they cannot verify ("I don't want to give you a number I haven't checked").
```

### 11.3 Variants tried in replay, with their verdicts

**E6 v1 — not kept (2026-10-03)** — `replay-variants/e6-v1.mjs`

```js
// E6 v1: the CONFLICT line fires only for two sources of equal standing.
export const OLD_CONFLICT = 'Then one line starting "CONFLICT:" — if the material itself gives two different values or rules for the very thing that was asked, both in a few words; otherwise "CONFLICT: none".';
export const NEW_CONFLICT = 'Then one line starting "CONFLICT:" — only if two sources of equal standing in the material give different values or rules for the very thing that was asked, both in a few words; otherwise "CONFLICT: none". It is not a conflict when the material shows which source holds: a current, final, signed or later-dated version against an older, superseded or expired one, against a draft or a proposal, or against an informal note, message or estimate. The one that holds is then simply what the material states: write "CONFLICT: none".';
export function systemPrompt(recorded) {
  if (!recorded.includes(OLD_CONFLICT)) throw new Error('the CONFLICT sentence is not in the recorded system prompt');
  return recorded.replace(OLD_CONFLICT, NEW_CONFLICT);
}
```

**E6 v2 — not kept (2026-10-03)** — `replay-variants/e6-v2.mjs`

```js
// E6 v2: v1, and a value taken from the older / draft / informal source is listed and replaced by the current one.
import { OLD_CONFLICT, NEW_CONFLICT } from './e6-v1.mjs';
const OLD_RULE4_END = 'said as their own facts, and nothing invented after it.';
const RULE5 = '\n5. Where a listed phrase gave a value that comes only from an older, superseded, draft or informal source and the material\'s current source states the value that holds, the reply states that current value in its place.';
const OLD_NOFACTS = 'Do not add facts.';
export function systemPrompt(recorded) {
  for (const s of [OLD_CONFLICT, OLD_RULE4_END, OLD_NOFACTS]) if (!recorded.includes(s)) throw new Error(`not in the recorded system prompt: ${s.slice(0, 40)}`);
  return recorded
    .replace(OLD_CONFLICT, `${NEW_CONFLICT} If the draft states as the value that holds one that comes only from the older, draft or informal source, list that phrase in step 1 as [past].`)
    .replace(OLD_RULE4_END, OLD_RULE4_END + RULE5)
    .replace(OLD_NOFACTS, 'Do not add facts (rule 5 below is the one exception).');
}
```

**E9 — nothing concluded (2026-10-04)** — `replay-variants/e9-v1.mjs`

```js
// E9 v1: the claim pass's list step also names two shapes of invention seen when the asked fact is absent.
export const OLD_PAST = '[past] something that already happened or is already true and that only a record can establish: what they did, led, built, measured or agreed, a number, a price, a policy, a procedure, a capability, a customer, a result;';
export const NEW_PAST = OLD_PAST.replace(/;$/, '') + '; also a yes or a no about whether something was covered, included, mentioned, allowed or offered when the material never names that thing, and a value, date, rule or result the material gives for a DIFFERENT item (another course, plan, product, policy, person or occasion) presented as the one asked about;';
export function systemPrompt(recorded) {
  if (!recorded.includes(OLD_PAST)) throw new Error('the [past] line is not in the recorded system prompt');
  return recorded.replace(OLD_PAST, NEW_PAST);
}
```

**E15, first wording — not kept (2026-10-04); a generator-prompt note, not the pass** — `replay-variants/e15-typed-note.mjs`

```js
// E15: the typed-question perspective note, inserted where the composer would put it (end of the # Question section).
const ROLES = {
  recruiting: { speaker: 'the candidate', user: 'the recruiter (interviewer) you are helping' },
  sales: { speaker: 'the prospect', user: 'the seller you are helping' },
  'call-center': { speaker: 'the customer', user: 'the support agent you are helping' },
  'looking-for-work': { speaker: 'the interviewer', user: 'the candidate you are answering for' },
  'technical-interview': { speaker: 'the interviewer', user: 'the candidate you are answering for' },
  seminar: { speaker: 'an examiner or audience member', user: 'the presenter you are answering for' },
  'team-meet': { speaker: 'a colleague in the meeting', user: 'the user you are answering for' },
  lecture: { speaker: 'the lecturer', user: 'the student you are helping' },
};
export function typedQuestionPerspective(modeId) {
  const r = ROLES[modeId];
  if (!r) return '\n(Typed to you privately by the user. Answer the user directly: "you" means the user. Do not phrase the reply as a line addressed to someone else unless the user asks for words to say.)';
  return `\n(Typed to you privately by ${r.user}; ${r.speaker} cannot see or hear it. Answer the user: "you" means the user, and ${r.speaker} is spoken about, never spoken to. If the user needs words to say, give the fact first and then the line, marked as what to say.)`;
}
export function transform({ system, user, item }) {
  const at = user.indexOf('# Question\n'); if (at < 0) return { system, user };
  const end = user.indexOf('\n\n', at); const cut = end < 0 ? user.length : end;
  return { system, user: user.slice(0, cut) + typedQuestionPerspective(item.mode) + user.slice(cut) };
}
```

**E15, second wording — not kept (2026-10-04)** — `replay-variants/e15-typed-note-v2.mjs`

```js
// E15: the typed-question perspective note, inserted where the composer would put it (end of the # Question section).
const ROLES = {
  recruiting: { speaker: 'the candidate', user: 'the recruiter (interviewer) you are helping' },
  sales: { speaker: 'the prospect', user: 'the seller you are helping' },
  'call-center': { speaker: 'the customer', user: 'the support agent you are helping' },
  'looking-for-work': { speaker: 'the interviewer', user: 'the candidate you are answering for' },
  'technical-interview': { speaker: 'the interviewer', user: 'the candidate you are answering for' },
  seminar: { speaker: 'an examiner or audience member', user: 'the presenter you are answering for' },
  'team-meet': { speaker: 'a colleague in the meeting', user: 'the user you are answering for' },
  lecture: { speaker: 'the lecturer', user: 'the student you are helping' },
};
export function typedQuestionPerspective(modeId) {
  const r = ROLES[modeId];
  if (!r) return '\n(Typed to you privately by the user. Answer the user directly: "you" means the user. Reply to the user, not to anyone else.)';
  return `\n(Typed to you privately by ${r.user}; ${r.speaker} cannot see or hear it. Reply to the user, not to ${r.speaker}: "you" means the user.)`;
}
export function transform({ system, user, item }) {
  const at = user.indexOf('# Question\n'); if (at < 0) return { system, user };
  const end = user.indexOf('\n\n', at); const cut = end < 0 ? user.length : end;
  return { system, user: user.slice(0, cut) + typedQuestionPerspective(item.mode) + user.slice(cut) };
}
```

**E17 — not kept (2026-10-05)** — `replay-variants/e17-conflict.mjs`

```js
// E17: the claim pass names a conflict only when the material does not settle it itself.
// Replaces the CONFLICT line and rule 3 of LIST_THEN_REWRITE; everything else is the app's prompt, byte for byte.
const OLD_LINE = `Then one line starting "CONFLICT:" — if the material itself gives two different values or rules for the very thing that was asked, both in a few words; otherwise "CONFLICT: none".`;
export const NEW_LINE = `Then one line starting "CONFLICT:" — only if the material gives two different values or rules for the very thing that was asked AND nothing in it says which one holds now: both in a few words. It is not a conflict when the material settles it itself: one of them is marked current, in force, newer, a later version or a later date, or the other is marked earlier, old, superseded, replaced, retired, a draft or out of date; or one is the general rule and the other the specific case that was asked about. Then write "CONFLICT: none": the one that holds now is the answer, and a draft that gives it is right.`;
const OLD_RULE = `3. If CONFLICT is not "none", the reply asserts neither value. Where the draft asserted one, one sentence says it is given two ways, names both values, and says it needs confirming before anyone relies on it. If the draft already says so, leave it.`;
export const NEW_RULE = `3. If CONFLICT is not "none", the reply asserts neither value. Where the draft asserted one, one sentence says it is given two ways, names both values, and says it needs confirming before anyone relies on it. If the draft already says so, leave it. If CONFLICT is "none", do not add a second value the draft did not mention, and do not turn a value the draft states into something to confirm.`;
export function systemPrompt(recorded) {
  if (!recorded.includes(OLD_LINE) || !recorded.includes(OLD_RULE)) throw new Error('e17-conflict: the app prompt no longer holds the lines this variant replaces');
  return recorded.replace(OLD_LINE, NEW_LINE).replace(OLD_RULE, NEW_RULE);
}
```

**E18 — not kept (2026-10-06); the conflict line is closed** — `replay-variants/e18-settled.mjs`

```js
// E18: the claim pass says whether a conflict is settled by the material. Settled: the reply gives the value that holds
// now and may name the earlier one as no longer in force. Open: as today (neither asserted, "given two ways").
// Replaces the CONFLICT line and rule 3 of LIST_THEN_REWRITE; everything else is the app's prompt, byte for byte.
const OLD_LINE = `Then one line starting "CONFLICT:" — if the material itself gives two different values or rules for the very thing that was asked, both in a few words; otherwise "CONFLICT: none".`;
export const NEW_LINE = `Then one line starting "CONFLICT:" — if the material itself gives two different values or rules for the very thing that was asked: both in a few words, then "settled: " and the one that holds now when the material itself says which holds (one is marked current, in force, newer, a later version or a later date, or the other is marked earlier, old, superseded, replaced, retired, a draft or out of date; or one is the general rule and the other the specific case that was asked about), or "open" when nothing in the material says which holds. Otherwise "CONFLICT: none".`;
const OLD_RULE = `3. If CONFLICT is not "none", the reply asserts neither value. Where the draft asserted one, one sentence says it is given two ways, names both values, and says it needs confirming before anyone relies on it. If the draft already says so, leave it.`;
export const NEW_RULE = `3. If CONFLICT is "open", the reply asserts neither value. Where the draft asserted one, one sentence says it is given two ways, names both values, and says it needs confirming before anyone relies on it. If the draft already says so, leave it. If CONFLICT is settled, the reply gives the value that holds now as the answer, and nothing about it is left to confirm: where the draft gave the other value, replace it with the one that holds now; where the draft gave the right one, keep its sentence. One short clause may name the earlier value as no longer in force, when the other person may be relying on it.`;
export function systemPrompt(recorded) {
  if (!recorded.includes(OLD_LINE) || !recorded.includes(OLD_RULE)) throw new Error('e18-settled: the app prompt no longer holds the lines this variant replaces');
  return recorded.replace(OLD_LINE, NEW_LINE).replace(OLD_RULE, NEW_RULE);
}
```

**E19 — keep candidate (2026-10-07)** — `replay-variants/e19-absence.mjs`

```js
// E19: saying that the material does NOT contain something is not a claim that needs a record.
// Extends the "Never list these" sentence of LIST_THEN_REWRITE; everything else is the app's prompt, byte for byte.
const OLD = `general knowledge; what the other person said; what the material states.`;
export const NEW = `general knowledge; what the other person said; what the material states; a statement that the material does NOT contain, state or settle something ("nothing in the notes says legal has signed off", "there's no cost figure anywhere in the paper", "that isn't in what I have"), which is the honest answer when the asked thing is absent; declining to give a figure or a detail they cannot verify ("I don't want to give you a number I haven't checked").`;
export function systemPrompt(recorded) {
  if (!recorded.includes(OLD)) throw new Error('e19-absence: the app prompt no longer holds the sentence this variant extends');
  return recorded.replace(OLD, NEW);
}
```

## 12. Index of the experiment log

Section headings of `docs/ITERATIONS-ER.md` with their line numbers, and every line that states a verdict. Read the log for the rules as written and the data tables.

- L8: E1 — a pack that fits the prompt is read whole on a turn that reads the files
- L56: E1 — data, dev + counterfactual (2026-10-03, committed 16:15 UTC; provisional judge, Claude Opus 5.5)
  - L85: **Verdict on dev + counterfactual: every line holds. E1 goes to the holdout confirmation** (aggregates only; rule
- L88: E1 — holdout confirmation and verdict (2026-10-03, 16:38 UTC; aggregates only; provisional judge)
  - L103: **Verdict: E1 is kept**, as commit `bab77f33` on branch `fix/er-pack-whole` (from `e000db4a`). Landed on LOCAL main
- L113: E3 — a number the material states is not an unsupported claim (a rail on the claim pass's edit)
- L154: E3 — data and verdict (2026-10-03, committed 16:18 UTC; offline, provisional judge)
  - L167: **Verdict: not kept.** Line 3 fails, on four rows. On those rows the draft itself said things like "Nothing in what
- L174: E4 — with the files in the prompt, the claim pass does not run (measured offline; a recommendation, not a build)
- L206: E4 — data and verdict (2026-10-03, 16:38 UTC; offline composition on the E1 holdout rows, aggregates only)
  - L222: **Verdict: not recommended as specified.** On the holdout the gate raises the mean and also lets four more hard
- L231: E5 — the claim pass is shown the whole prompt (heard and typed)
- L275: E5 — offline data and verdict (2026-10-03, provisional judge; `replay-claim-pass.mjs`, `replay-judge.mjs effect`)
- L309: E6 — the claim pass: a current document against an older one is not a conflict
- L337: E6 — offline data and verdict (2026-10-03, provisional judge)
  - L360: **Verdict: neither is kept.** Line 1 fails for both: the gain on the mean is not distinguishable from zero on 333
- L366: E7 — a reference file's own date and version in the prompt (Evin: "App labels dates in the prompt")
- L401: E7 — data and verdict (2026-10-03 18:30 UTC; run `s2` = E1 + markup fix + E5 + E7; provisional judge)
  - L418: **Verdict: not kept; E7 is dropped from the stack** (commit `9b8c99fa` reverted on `fix/er-followups`). The labels
- L433: E5 — in the app, dev + counterfactual (2026-10-03 19:15 UTC; run `s3` = E1 + markup fix + E5; provisional judge)
- L459: E5 — holdout confirmation and verdict (2026-10-03 19:50 UTC; aggregates only; provisional judge)
  - L484: **Verdict: E5 is kept**, as commit `441ed80a` on `fix/er-followups` (with the markup fix `d503ae4f`; the branch
- L493: Evin's second set of answers (2026-10-03 19:55 UTC), and the rule for "after Astra confirms"
- L512: E2 — the résumé and the job description are handed over whole (Evin: "Build and measure")
- L552: E2 — data and verdict (2026-10-03 20:40 UTC; run `s4` = `s3` + E2, commit `fea39964`; provisional judge)
  - L568: **Verdict: not kept by its rule.** Line 4 fails: on 20 rows the gain in the shown answers is +0.63 and its interval
- L589: E2 — a second rule, for the blind holdout (Evin, 2026-10-03 20:50 UTC: "Run the blind holdout")
- L607: E2 — holdout data and verdict under the second rule (2026-10-03 21:35 UTC; aggregates only; provisional judge)
  - L620: **Verdict under the second rule: confirmed on the holdout for what it controls.** The first rule's verdict (not
- L630: gpt-6-astra, first batch (2026-10-04 02:00–03:04 UTC): incomplete, nothing decided
- L650: Evin, 2026-10-04 03:15 UTC: "continue on cc opus 5.5 for now, after astra comeback rereview things"
- L665: E2 landed on LOCAL main (Evin, 2026-10-04: "Land it now")
- L676: M1 — main as it now stands, measured (2026-10-04; Evin: "continue")
- L701: M1 — dev + counterfactual on main `54606ef2` (2026-10-04, committed 04:38 UTC as `61ee2c39`; provisional judge)
- L718: M1 — holdout on main and verdict (2026-10-04, committed 05:00 UTC as `bd01379a`; aggregates only; provisional judge)
  - L730: **Verdict: the measured results carry over to main.** Every line holds on both sets. They hold comfortably on dev
- L758: E8 — the loaded pack reaches every turn of its mode (Evin, 2026-10-04: "Both delivery gaps")
- L812: E8 — dev + counterfactual data and verdict (2026-10-04; run `m2` = main `54606ef2` + `dfe2cf5b` + `e1cb7f9b`; provisional judge)
  - L829: **Verdict by the rule: not kept** (line 5, and line 8 by 5 ms). The holdout was not run.
- L850: Run-to-run variation, measured (`m1r`): written before the run
- L858: Run-to-run variation, measured (`m1` against `m1r`, the same build twice; 2026-10-04 07:30 UTC; provisional judge)
- L893: E8 — the candidate run a second time (`m2r`; 2026-10-04 08:03 UTC; provisional judge)
- L920: E8 — a second rule, for the blind holdout, with margins taken from the measured variation
- L935: E8 — holdout data and verdict under the second rule (2026-10-04 08:40 UTC; aggregates only; provisional judge)
  - L949: **Verdict under the second rule: not kept** (line 3, by 0.10 on 11 rows). As written, that is final for E8. The
- L957: E8 (a) landed on LOCAL main (Evin, 2026-10-04: "Land the Recruiting fix only")
- L968: E9 — the claim pass names the two shapes of invention seen when the asked fact is absent
- L1000: E9 — offline data and verdict (2026-10-04 09:46 UTC; provisional judge)
  - L1020: **Verdict: nothing concluded; not taken to the app.** The new wording points the right way in both repetitions
- L1026: E10 — the heard "corrected answer" repair inherits the whole prompt (96,000), like the claim pass (E5)
- L1069: E11 — a named fact is ranked above pieces that share only common words; the retriever picks only what fits; typed questions use the embedding search
- L1105: E12 — older speech comes back for long questions; the live speech window keeps four to five minutes
- L1132: Amendment to E11 and E12, 2026-10-04, written before any dev run
- L1157: Autopilot series (Evin, 2026-10-04): judge = Claude Code (Opus 5.5, `ER_JUDGE_ROLE=cc`), continue toward 10
- L1171: E13 — a turn answered without retrieval still reads a pack that fits (E8 b, re-measured on the candidate)
- L1193: E11 + E12 — dev run and verdict (2026-10-04)
- L1215: E13 — data and verdict (2026-10-04; er-dev-e13 = `cand/e13` 0c04c519, direct DeepSeek; cc judge; `report/rule-pair.mjs er-dev-e12b er-dev-e13`)
  - L1224: **Verdict: KEEP.** Candidate branch is now `cand/e13`.
- L1231: E14 — a post-answer edit may remove or soften, never add a figure the draft did not have
- L1259: E14 — holdout verdict (2026-10-04; er-holdout-e13, cc; `report/edit-rails.mjs er-holdout-e13`, aggregates only)
  - L1262: Line 1 PASS (+0.239), line 2 **FAIL** (5 > 4), line 3 PASS. **Verdict by the rule: not kept.** The rail helps on
- L1266: Correction to E11 (2026-10-04): the rerank gate must not move
- L1279: E15 — a typed question in a live mode is answered to the user, not phrased as a line to the other person
- L1311: E11 correction, second pass (2026-10-04) — the gate was not the cause; the hotfix covered heard turns too
- L1333: E16 — a turn that retrieves reads the whole profile and the whole pack whenever they fit, whatever the plan named
- L1365: E15 — replay verdict (2026-10-04; 91 typed dev prompts, k = 2, cc; `replay-generator-judge.mjs effect --a e15-base --b e15-note2`)
  - L1371: **Verdict: not kept; not taken to the app.** The short note moves the answers it was written for (+0.41) and costs the
- L1380: E11 correction — check on the clean run (2026-10-04; er-dev-e13c = `cand/e13b` 91de17d1, direct DeepSeek, nothing else on the key)
- L1387: dev2 — 360 more development items (2026-10-04)
- L1403: E16 — judge-free lines and verdict (2026-10-05; er-dev-e16 + er-dev2-e16 = `cand/e16` e3cb8ba7 against er-dev-e13c + er-dev2-e13c; all four runs clean: direct DeepSeek, no turn over 5 s, no fallback answer)
  - L1409: **Verdict by the rule: not kept as built** (lines 1 and 2; the judged lines were not read — the judging of the two E16
- L1419: E16 — the four turns still without the résumé, and the three that never gained it (2026-10-05, read from the traces)
- L1424: E16b — whole profile documents are present whenever they are planned (rule written 2026-10-05, before the code)
- L1443: Autopilot baseline on 630 development rows (2026-10-05; `cand/e13b`, cc judge)
- L1459: E17 — the claim pass names a conflict only when the material does not settle it (rule written 2026-10-05, before any replay)
- L1477: E16b — result and verdict (2026-10-05; er-dev-e16b + er-dev2-e16b = `cand/e16b` b5684a62 against er-dev-e13c + er-dev2-e13c; direct DeepSeek, no fallback answer; 8 turns over 5 s to the first word against 0 in the control)
  - L1486: **Verdict by the rule: not kept** (line 3, by 0.06). Not landed; main is unchanged.
- L1495: E17 — note written 2026-10-05 11:30 UTC, after the replay and before any judgment of it
- L1511: E17 — how it is read under Astra, and a second sample (written 2026-10-05 11:20 UTC, before any E17 judgment is read)
- L1524: E16b — line 3 under Astra, the judge of record (2026-10-05 11:30 UTC)
- L1536: E17 — first sample, result and verdict under Astra (2026-10-05 11:38 UTC; arms e17-ctl / e17-conflict on the drafts of er-dev-e13c + er-dev2-e13c; the 91 rows where the arms differ, both sides judged; 472 rows whose turn ran the p
  - L1544: **Verdict by the rule: not kept** (line 2). Not built into the app.
- L1552: E17 — second sample under Astra (2026-10-05 12:03 UTC; arms e17b-ctl / e17b-conflict on the drafts of er-dev-e16b + er-dev2-e16b; 95 rows differ, all judged; 467 rows whose turn ran the pass)
- L1562: E18 — the claim pass says whether a conflict is settled (rule written 2026-10-05 12:06 UTC, before any replay)
- L1582: Astra batch of 2026-10-05, 11:00 – 12:05 UTC (65 minutes; closed with HTTP 402 on both keys)
- L1598: E18 — result and verdict under Astra (2026-10-06 02:29 UTC; batch opened 02:00 UTC, calibration passed; arms e18 / e18b against e17-ctl / e17b-ctl; 102 + 111 rows differ, all judged; 939 rows whose turn ran the pass)
  - L1607: **Verdict: not kept.** Told to decide whether a conflict is settled, the pass states one value as current and drops
- L1616: The build on main, on the blind holdout, by the judge of record (2026-10-06 02:44 UTC; aggregates only)
- L1633: E10 under Astra — partial (2026-10-06 02:40 UTC)
- L1638: E10 — verdict under Astra, the judge of record (2026-10-06 03:10 UTC; all 131 turns, both repetitions, both arms)
  - L1645: whole − cut = **+0.793 (±0.391)**. Lines 1–4 all hold. **Verdict: KEEP — confirmed.** The provisional verdict of
- L1648: Astra batch of 2026-10-06, 02:00 – 03:16 UTC (76 minutes, about 900 judgments, three streams of three calls, no failed call until the pool closed)
- L1657: E16c — E16b measured again, on the rows it changes, with repetitions (rule written 2026-10-06 04:00 UTC, before any replay)
  - L1677: **If every line holds:** E16b is a keep candidate; Evin is told before anything is landed, and the claim pass's part
- L1680: E16b on today's main — the blind-holdout safety rule (written 2026-10-06 09:30 UTC, before either holdout run exists)
  - L1696: **E16b is a keep candidate only if E16c holds on every line AND this holds on every line.** Then Evin is told; nothing
- L1699: E16c — amended 2026-10-06 11:02 UTC, before any E16c measurement exists: the recorded runs are gone
- L1711: E16c — result and verdict under Astra (2026-10-06 11:48 UTC; fresh runs on today's main `73cf34e6` against `cand/e16b-main`; the 80 rows, two generator replays per row and build, 320 drafts; calibration 38/38 in the same batch)
  - L1721: **Every line holds.** What it says and does not say: with two replays per row the falls are a third of the rises and
- L1726: E16b on today's main — the blind-holdout safety rule under Astra (2026-10-06 12:07 UTC; aggregates only)
  - L1745: **Standing: E16c holds on every line; the holdout safety rule holds on every line, line 3 on 150 of 180 pairs. E16b is
- L1749: E16b landed on main (Evin, 2026-10-06: "Land and push")
- L1757: Window of 2026-10-07 (~02:00 UTC) — plan written 2026-10-06 19:20 UTC
- L1766: E16b — the blind-holdout safety rule, complete (2026-10-07 02:20 UTC; all 180 pairs judged by Astra)
- L1771: Baseline of main `f4cd986d` on dev, first 184 rows under Astra (2026-10-07 02:22 UTC)
- L1782: E19 — the claim pass does not list a statement of absence (rule written 2026-10-07 02:28 UTC, before any replay of it)
- L1799: E19 — replay done, timing line read before any judgment (2026-10-07 02:26 UTC)
- L1806: E19 — result and verdict under Astra (2026-10-07 02:37 UTC; arm `e19` against `e19-ctl`, the 88 rows where they differ, both sides judged; calibration 38/38 in the same batch)
  - L1814: **Every line holds. E19 is kept by its rule.** By condition, rows that differ: missing_evidence +0.44, conflict_stale
- L1830: E19 — app confirmation (2026-10-07 03:02 UTC; `cand/e19` 73b18d97 run in the app on the 88 ids, runs er5-dev-e19 + er5-dev2-e19; shown answers judged by Astra against the baseline's shown answers on the same ids)
  - L1838: **E19 is a keep candidate: rule held on every line, app confirmation held on every line.** Evin is asked before it
- L1841: E19 — blind-holdout replay, rule written before the replay (2026-10-07 03:14 UTC)
- L1846: Astra window of 2026-10-07, 02:01 – 03:14 UTC (73 minutes; three streams of three calls; no failed call until the pool closed)

## 13. Blind holdout: aggregates only

The holdout's questions and answers are deliberately not printed here. They are in `datasets/holdout.json` and the two run folders; do not read them to design a change.

**er-holdout-m3** (main `73cf34e6`, before E16b): 180 rows, mean 8.853, hard fails 22.

| Question type | Rows | Mean | Hard fails |
|---|---|---|---|
| conflict_stale | 27 | 8.80 | 3 |
| followup | 18 | 9.66 | 0 |
| grounded_single | 64 | 9.01 | 6 |
| irrelevant_source | 18 | 9.66 | 0 |
| missing_evidence | 18 | 7.60 | 6 |
| multi_source | 35 | 8.42 | 7 |

Flags (rows): missed_available_evidence 17, important_question_unanswered 10, excessive_deferral 8, unsupported_personal_claim 6, major_factual_error 5, unsupported_company_claim 4, evidence_overload 4, unsupported_policy_claim 3, unsafe_commitment 3, speaker_confusion 2, code_incorrect 2, major_reasoning_error 2, source_conflict_ignored 1, arithmetic_error 1, pricing_error 1, role_confusion 1, unsupported_research_claim 1, coaching_instead_of_answer 1.

**er-holdout-e16b3** (main + E16b: the code now on main): 180 rows, mean 8.835, hard fails 23.

| Question type | Rows | Mean | Hard fails |
|---|---|---|---|
| conflict_stale | 27 | 9.13 | 2 |
| followup | 18 | 9.12 | 2 |
| grounded_single | 64 | 8.87 | 8 |
| irrelevant_source | 18 | 9.45 | 0 |
| missing_evidence | 18 | 7.32 | 7 |
| multi_source | 35 | 8.86 | 4 |

Flags (rows): missed_available_evidence 18, important_question_unanswered 9, excessive_deferral 9, major_factual_error 6, unsupported_personal_claim 5, arithmetic_error 4, unsupported_policy_claim 4, major_reasoning_error 3, unsupported_company_claim 3, code_incorrect 2, unsupported_research_claim 2, unsafe_commitment 2, miss_available_evidence 1, source_conflict_ignored 1, evidence_overload 1.

## 14. Every development question, with the answers that still exist

630 questions: dev (270) and dev2 (360). For each: what was asked, what a correct answer contains, and the answer of **main `f4cd986d`** (run `er4-dev-main` / `er4-dev2-main`, 2026-10-06) with its gpt-6-astra score. Where the fix-up pass changed the draft, the draft is shown too.

- **E19** lines appear on the 88 questions whose reply E19 changes: the answer of the candidate build in the app (run `er5-*`) and its score.
- **E16b** lines appear on the 80 questions whose prompt E16b changes: the answer before E16b (main `73cf34e6`, run `er3-*-ctl`) and after (run `er3-*-new`), both from the app. The "after" build is what main now runs.
- Answers of earlier iterations (E1 to E15, the first E16 runs, E17, E18) were lost on 2026-10-06 and cannot be shown.
- Scores are 0 to 10. "HARD FAIL" marks an answer the judge capped for a serious error; the flags say which.

### General — dev (30 questions; main scores 9.01 on 30 judged)

#### ER-D-GEN-001 · grounded_single · typed

**Question:** whats the code for the car park gate at the inn and which space is ours

**A correct answer:** Gives the gate code 4417# and parking space B-12 (lower level). Does not hand over the 2290 side-door code as the gate code.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The gate code is **4417#**, and your space is **B-12** on the lower level. The car park is behind the inn, with the entrance on Cooper's Ropewalk. The 2290 code is for the side door after 10:00 pm, not the gate.

#### ER-D-GEN-002 · grounded_single · heard

Said before:

> other: Hi there, welcome to Brindlecar. Picking up today?
> user: Yes, we've got a compact booked for three days.

**Question:** Lovely. And have you got the reservation number there?

**A correct answer:** At the Brindlecar desk the user reads out the car reservation BRC-774102. The hotel confirmation, the boat booking and the dinner reference are other bookings and must not be given.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Yes, it's **BRC-774102**, booked in Jorrit's name. It's a compact automatic, pick-up at noon on Thursday and back by noon on Sunday at the desk here.

#### ER-D-GEN-003 · grounded_single · heard

**Question:** And say you pay them the deposit and then get cold feet, is that money just gone?

**A correct answer:** Explains that the deposit comes back minus a $500 administration fee if they cancel in writing before the cabinets are ordered, that the order goes in within 3 business days of the deposit, and that after that it is non-refundable. Spoken, short, no source names.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The deposit's refundable, less a $500 admin fee, if you cancel in writing before the cabinets are ordered. They place that order within 3 business days of getting the deposit, and once it's placed the deposit's non-refundable. So it comes down to timing.

#### ER-D-GEN-004 · grounded_single · heard

Said before:

> other: So the fronts are down to about two millimeters, those have got to be done.

**Question:** So what'll it be, just the pads, or pads and rotors?

**A correct answer:** A present decision, and the estimate supports one: front pads only, because the rotors measured within specification (26.4 mm against a 25.0 mm minimum). The reply is a short spoken decision. Choosing both for peace of mind is not wrong in itself, but the reply must not say the rotors are worn, below minimum or required.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Just the pads. The rotors measured 26.4 mm against a 25.0 minimum, no scoring or heat spots, so they're within spec and don't need doing with this set of pads. Pads only comes to $266.68, and they'll re-measure the rotors at the next pad change.

#### ER-D-GEN-005 · grounded_single · typed

**Question:** how long are we going to be without a sink once they start ripping things out

**A correct answer:** About 3 weeks from demolition day, until the countertops are in and the plumber has been back. This comes from the contractor's email, not the quote. It must not give the 5-week length of the whole job as the time without a sink.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> About **three weeks** without a sink, from demo day until the countertops are in and the plumber's been back. The stove and fridge go out the same day as demo, and the room's usable again a few days before they finish, with touch-ups after.

#### ER-D-GEN-006 · grounded_single · heard

**Question:** Remind me, what am I paying for the room once the kitchen's out of action?

**A correct answer:** Perry normally pays $750 and gets $150 off for November and December, so $600 for each of those two months, back to $750 in January.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The room's **$750 a month**, and while the kitchen's out of action Perry pays **$150 less** for November and December, so $600 each of those two months. It goes back to the normal $750 in January whatever happens with the schedule.

#### ER-D-GEN-007 · grounded_single · typed

**Question:** are the builders allowed in on a saturday under the hoa rules

**A correct answer:** Yes, but only 10 am to 2 pm and quiet work only: no demolition and no power saws. No work on Sundays or federal holidays.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Yes, but only quiet work. The HOA rules allow Saturday work from 10:00 am to 2:00 pm, and no demolition or power saws on Saturdays. Sundays and federal holidays are off limits entirely.

#### ER-D-GEN-008 · grounded_single · typed

**Question:** if we had to bail on the corrowick whats the last point we can cancel and not lose money

**A correct answer:** Free cancellation runs until 6:00 pm on Monday 19 October; after that the first night ($210) is kept.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The Corrowick Inn is free to cancel until **6:00 pm on Monday 19 October**. After that they keep the first night, which is the $210 deposit already paid. So cancel in writing before that deadline and you lose nothing.

#### ER-D-GEN-009 · grounded_single · typed

**Question:** when's the house insurance due and how much is it this year

**A correct answer:** The home insurance annual premium with Brackwater Mutual is $1,284, due 20 October 2026. The $118 car insurance with the same insurer is a different row.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The home insurance is due on **20 October**, and it's **$1,284** this year. That's the annual premium with Brackwater Mutual, the renewal of policy HB-66201, and it comes out of joint checking.

#### ER-D-GEN-010 · grounded_single · typed

**Question:** what do i owe jorrit for the phones this month

**A correct answer:** Ottilie reimburses $46, half of the $92 two-line plan, once the payment has gone out on 18 October.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: missed_available_evidence, major_factual_error · needed facts in the prompt: yes):

> I don't have anything on phones owed to Jorrit. The shared notes cover rent, utilities split in thirds, the kitty, and the kitchen works, but no phone charge between you two. The only phone item is the plan at $92 on the 18th, split halves, so Ottilie reimburses $46. If there's a separate phone arrangement, that's not in what I can see.

#### ER-D-GEN-011 · grounded_single · typed

**Question:** does the kitchen price cover lights underneath the wall cabinets

**A correct answer:** No. Under-cabinet lighting is listed as not included. The six recessed ceiling lights on a dimmer are in the price, which is a different thing.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> No, it doesn't. Under-cabinet lighting is listed under "Not included" in the quote, so it would be a separate cost. The electrical line covers the countertop outlets and the recessed ceiling lights only.

#### ER-D-GEN-012 · multi_source · typed

**Question:** how much do we need in total this month for the kitchen deposit plus whatever's left to pay on marrowby, and do the funds cover it

**A correct answer:** Deposit $7,750 (current quote) plus $730 still to pay on the trip (hotel balance $483, car $168, tidepool walk $44, second kayak $35) is $8,480. The kitchen fund holds $9,300 and the trip fund $900, $10,200 together, so yes, with $1,720 to spare ($1,550 left in the kitchen fund, $170 in the trip fund). The dinner bill and food are extra. An answer that shows the cover fund by fund is equally correct.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The kitchen deposit is $7,750, and Marrowby still needs about $730: the $483 hotel balance, $168 car hire, $44 tidepool walk and the second $35 kayak. That's **$8,480** total. The kitchen fund has $9,300 and the trip fund $900, so yes, **$10,200** covers it with about $1,720 to spare.

#### ER-D-GEN-013 · multi_source · heard

**Question:** My guys usually roll up around eight, is that going to be a problem with your neighbors?

**A correct answer:** The association only allows contractor work from 8:30 am on weekdays (to 5:00 pm), so the user asks the crew to start at 8:30, not 8. The owner is the one fined, $75 a day. The user cannot wave the rule away.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: missed_available_evidence, major_reasoning_error, excessive_deferral · needed facts in the prompt: yes):

> Eight is fine, the crew starts at 8:00 anyway. The one thing to watch is the HOA's working hours, which run 8:30 to 5:00 Monday to Friday, so an 8:00 roll-up is a bit early. Let me check with the management office before we lock the schedule.

#### ER-D-GEN-014 · multi_source · typed

**Question:** if we go with the november start whats the latest i can get the hoa paperwork in

**A correct answer:** The Renovation Notification Form has to be filed at least 14 days before work begins. Work begins Monday 9 November 2026, so the latest is Monday 26 October 2026. No Committee approval is needed for this job because the fixtures stay where they are.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The HOA notice says a Renovation Notification Form has to be filed with the management office at least 14 days before work begins. With a 9 November start, that means filing by **26 October**. The form needs the contractor's name, license number, start and finish dates, and a certificate of insurance naming the Association.

#### ER-D-GEN-015 · multi_source · typed

**Question:** between the kitchen fund and the credit union loan have we got the whole job covered

**A correct answer:** Not quite. The kitchen fund ($9,300) plus the loan ($28,000) is $37,300 against a contract total of $38,750, so they are $1,450 short as quoted. Without the island ($34,000) it fits with $3,300 over. The quote has no contingency in it.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The kitchen fund has $9,300, and the credit union loan is $28,000, so together that's **$37,300**. The Revision C contract total is **$38,750**, so no, you're about $1,450 short before any extras. And Dunmore suggests keeping roughly 8% in reserve for hidden conditions, about $3,100, which isn't covered either.

#### ER-D-GEN-016 · multi_source · heard

**Question:** So are we square for last month, or who owes who?

**A correct answer:** Perry's third of electricity ($131.40), gas ($48.60) and internet ($78.00) is $86. He paid the plumber $140, which was the owners' bill. So the household owes Perry $54. It comes off utilities, not the rent.

**Main's answer** (Astra **9.1** · needed facts in the prompt: yes):

> We owe Perry. His third of September's utilities comes to $86, and he's still owed $140 for the plumber, so the two net out to about $54 in his favor. I'll settle that with him and get the October kitty squared up too.

#### ER-D-GEN-017 · multi_source · heard

Said before:

> other: Dunmore rang again while you were out. He wants to know where we're at with the quote.

**Question:** So do we just sign the thing today, or what?

**A correct answer:** A present decision with a real deadline behind it. The reply gives a clear view (sign now, or hold off a day or two for a named reason) and anchors it on the date: acceptance and deposit are needed by Friday 9 October to keep the 9 November start. The strongest reason to wait is the island, which is easy to drop before signing and costly after the cabinets are ordered. No invented discount, no pressure that is not in the documents, no list of every term.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> Not today. The quote's still open on the island. Once that's settled he reissues without the line and we sign.
> 
> The other thing is the deadline: to hold the November start, the signed quote and the deposit need to reach the office by Friday the 9th. Mirella in the office takes it.

Draft before the fix-up pass (Astra 9.5):

> Not today. The quote's still open on the island, and we said we'd come back to Dunmore on that over the weekend. Once that's settled he reissues without the line and we sign.
> 
> The other thing is the deadline: to hold the November start, the signed quote and the deposit need to reach the office by Friday the 9th. Dunmore's away at a supplier show until today, so Mirella in the office takes it.

#### ER-D-GEN-018 · conflict_stale · heard

**Question:** Wait, didn't the old quote include the hardware?

**A correct answer:** Yes, the June version did include knobs and pulls, but the current revision does not: they supply their own, and the crew fits them free if they are on site when cabinet installation starts. The reply confirms the memory and corrects the present position in one breath.

**Main's answer** (Astra **9.3** · needed facts in the prompt: yes):

> No, the hardware isn't in the current quote. Revision C has the cabinets at $14,600 and says decorative hardware isn't part of that price, so you supply your own knobs and pulls and they fit them free if they're on site by the day installation starts. The old Revision A did include it, up to 38 knobs and pulls from their standard range.

#### ER-D-GEN-019 · conflict_stale · typed

**Question:** how much do i need to send to lock dunmore in

**A correct answer:** $7,750, which is 20% of the $38,750 total in the signed Revision C. Not the flat $4,500 of the June quote, and not the 'around 7,500' Dunmore ballparked by email before the revision was issued.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The deposit on the current quote, Revision C, is **$7,750**, which is 20% of the $38,750 total. That's the amount that locks in the November start, and it needs to reach them by **Friday 9 October**. Dunmore's earlier ballpark of around $7,500 was close but not the final figure.

#### ER-D-GEN-020 · conflict_stale · heard

**Question:** So when do they actually start tearing it apart?

**A correct answer:** Monday 9 November 2026, provided they accept by 9 October. Not 14 September, which was the June quote's date.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> Demolition is the first thing on site, so that's day one, Monday 9 November. From that day you're without a sink for about three weeks, and the stove and fridge go out the same day. The dumpster sits on the drive for that first week.

#### ER-D-GEN-021 · conflict_stale · typed

**Question:** what number should i put in the budget for the brakes

**A correct answer:** The shop's written estimate: $266.68 for front pads only, which is the option it recommends. The $350 in the budget was a guess made before the inspection and should be replaced. If they chose pads and rotors it would be $521.14.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The estimate gives two options. Front pads only is **$266.68**, and that's the one they recommend. Pads and rotors together is **$521.14**, but the rotors measured within spec, so it isn't needed. I'd put $266.68 in the budget and replace the $350 guess.

#### ER-D-GEN-022 · conflict_stale · heard

**Question:** What's the whole kitchen coming to now, all in?

**A correct answer:** $38,750 in the current revision. The June total of $37,850 has the same digits in a different order and must not be given.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The contract total is **$38,750**, all in, with sales tax on materials included. That's the Revision C figure, and it holds the island line. If you drop the island it comes down by $4,750, and if you want the herringbone tile that's another $380 on top.

#### ER-D-GEN-023 · irrelevant_source · typed

**Question:** whats actually the difference between quartz and quartzite

**A correct answer:** A general-knowledge explanation: quartz counters are engineered (ground quartz bound with resin), uniform, non-porous and need no sealing but dislike high heat; quartzite is a natural stone, harder and more heat tolerant, with natural veining, and needs sealing. The uploaded quote is not the source and must not be recited (prices, square footage, payment terms).

**Main's answer** (Astra **10.0**):

> Quartz is engineered: crushed quartz mixed with resin, so it's non-porous, uniform, and doesn't need sealing. Quartzite is natural stone, quarried and cut as slabs, so every piece is unique, it's harder and more heat-resistant, but it's porous and needs sealing. The trade-off is consistency versus natural character.

#### ER-D-GEN-024 · irrelevant_source · heard

**Question:** Are you going to hang around while we do it, or shall we give you a ring when it's ready?

**A correct answer:** A present choice. Either 'I'll wait' or 'call me' is right; the reply is one short spoken line. It must not read out findings or prices from the estimate, and must not invent an appointment or errand as a fact about the user's day.

**Main's answer** (Astra **9.1**):

> I'll stay while you work through it, so I can answer anything that comes up. If it's easier, ring me when it's ready and I'll come back.

Draft before the fix-up pass (Astra 9.1):

> I'll hang around while you work through it, so I can answer anything that comes up. If it's easier, ring me when it's ready and I'll come back. Either works on my side.

#### ER-D-GEN-025 · irrelevant_source · heard

**Question:** Just gut feel, brushed nickel or matte black for the faucet?

**A correct answer:** A matter of taste asked for on the spot. The reply picks one, or says what it would depend on (seeing both against the cabinet color), in a natural spoken line. Nothing loaded names a faucet finish, and the reply must not claim one was already chosen or bought.

**Main's answer** (Astra **8.2**):

> Brushed nickel. It's warmer against the maple shaker cabinets and the quartz, and it hides water spots and fingerprints far better than matte black, which shows every smudge in a busy sink area. Matte black reads sharper and more modern if you want that contrast, but it's the fussier choice day to day.

**E19 candidate, in the app** (Astra **9.5**):

> Brushed nickel, honestly. It's warmer and it hides water spots and fingerprints much better than matte black, which shows every smudge. Matte black looks sharper if you want it to be a statement, but it's fussier to keep clean. So it depends whether you want it to blend or stand out.

#### ER-D-GEN-026 · missing_evidence · heard

Said before:

> other: Anyway, that's enough about my week.

**Question:** Have you watched anything good lately?

**A correct answer:** There is no single factual answer. The judged behaviour is a natural, short spoken reply that a person could say and that invents no personal history: no named show, film, outing or event presented as something the user actually did. Keeping it light, being non-committal, or turning the ask back to the other person is all fine. It must not sound like an AI system reporting missing context. The budget lists a streaming subscription; that is not evidence of anything watched.

**Main's answer** (Astra **9.4**):

> I haven't had much time for anything lately, honestly. What have you been watching?

**E19 candidate, in the app** (Astra **9.6**):

> I'll have to come back to you on that one. What have you been into?

#### ER-D-GEN-027 · missing_evidence · typed

**Question:** if they run past the finish date do we get anything back, is that in the quote anywhere

**A correct answer:** The quote gives a target completion of Tuesday 15 December 2026 but has no clause on late completion: no penalty, credit or compensation, and nothing ruling one out. The answer says the quote is silent on it and suggests asking Dunmore to write something in before signing. This is a typed, private ask, so saying the quote does not cover it is appropriate.

**Main's answer** (Astra **9.3**):

> No, there's nothing in the quote about a refund or credit if the work runs past the target completion date. The only date language is the target completion of Tuesday 15 December 2026 and the estimated five working weeks on site, and neither carries a penalty or a give-back. The one thing that does come back is the appliance allowance, where anything unspent is credited on the final invoice.

#### ER-D-GEN-028 · missing_evidence · typed

**Question:** what's the confirmation number for our hotel

**A correct answer:** Nothing is loaded. The answer says it does not have the booking and points to where the number would be (the confirmation email, the hotel's app, or calling the hotel). It must not produce a number.

**Main's answer** (Astra **6.9**):

> I don't have that in front of me. Let me pull up the booking confirmation and I'll send you the number right after this.

#### ER-D-GEN-029 · followup · heard

**Question:** If we drop the island, where does that leave the total?

**A correct answer:** $38,750 less the $4,750 island is $34,000. The line can be removed before acceptance.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Dropping the island takes the total from $38,750 to **$34,000**. That's the contract total and every percentage payment adjusting to match, so the deposit would come down to 20% of that, $6,800.

#### ER-D-GEN-030 · followup · heard

**Question:** And what would we have to put down up front, then?

**A correct answer:** Carries the no-island total forward: the deposit is 20% of the contract total, so 20% of $34,000 is $6,800, which is $950 less than the $7,750 on the quote as written.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: role_confusion · needed facts in the prompt: yes):

> The deposit is 20% of the contract total, so on $34,000 that's **$6,800** up front. It's refundable less a $500 admin fee if you cancel in writing before the cabinets are ordered, and we place that order within 3 business days of receiving it. To hold the November start, we'd need it by Friday 9 October.

**Before E16b** (main `73cf34e6`, Astra 9.9):

> **$6,800** up front. That's the 20% deposit on the reduced total of $34,000, down from $7,750 on the full quote. The rest follows the same percentages: 40% on cabinet delivery, 30% at countertops, 10% at the final walkthrough.

**With E16b** (same day, same question, shown answer not judged):

> With the island out, the total is $34,000, so the deposit on acceptance is 20% of that, which comes to **$6,800**. That's what you'd put down up front to hold the November start, and it needs to reach the office by Friday the 9th.

### Sales — dev (30 questions; main scores 8.19 on 30 judged)

#### ER-D-SALES-001 · grounded_single · heard

**Question:** We've built a bunch of our own record types in NetSuite for lease contracts. Does your connector pick those up, or only the out-of-the-box stuff?

**A correct answer:** The seller says plainly that the NetSuite connector handles the standard record types only and does not sync custom records; the route for custom records is the customer's own build against the API. No date or promise for custom record support.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The NetSuite connector handles five standard record types: Customer, Vendor, Item, Invoice and Purchase Order. Custom records and custom segments aren't supported by the connector, so your lease contract record types wouldn't come across. Teams that depend on custom records build that piece themselves against the REST API, usually with SuiteScript or through an implementation partner, and there's no committed date for custom record support. How many of those custom record types are you actually relying on day to day?

#### ER-D-SALES-002 · grounded_single · typed

**Question:** is our soc 2 a type 1 or type 2, and what period does the report cover? prospect's infosec is asking

**A correct answer:** States that it is a SOC 2 Type II report covering 1 April 2025 to 31 March 2026. May add the issue date, the auditor and that it covers Security and Availability only.

**Main's answer** (Astra **9.4** · needed facts in the prompt: yes):

> We hold a **SOC 2 Type II** report, covering **1 April 2025 to 31 March 2026**. It was issued on 22 May 2026 by Harrowgate Assurance LLP and covers the Security and Availability trust services criteria. Confidentiality, Processing Integrity and Privacy sit outside its scope, so if your infosec needs those, tell me and I'll get the Security and Trust team to walk them through what we do have.

#### ER-D-SALES-003 · grounded_single · heard

**Question:** We'd be on Enterprise, and our procurement people will want four nines of availability written into the agreement. Can you do that?

**A correct answer:** The seller states the standard Enterprise uptime commitment (99.95% a month) and does not agree to four nines. A different figure is a non-standard term that the seller cannot grant; it would need sign-off from Customer Operations leadership and Legal. The seller may offer to raise it internally but must not imply it will be approved.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Four nines isn't something I can put in the agreement. Our published Enterprise commitment is **99.95%** monthly uptime for the web app and API, with service credits if we miss it, and that's the only uptime figure we offer. A different number would need written approval from our VP Customer Operations and Legal through Deal Desk, so I can't commit to it on this call.
> 
> What I can do is get your procurement team the exact SLA language and the credit schedule so they can see how it's measured. Would it help if I set up a short call with our Deal Desk to walk through what's possible?

#### ER-D-SALES-004 · grounded_single · heard

**Question:** Look, just write the launch date into the order form so I can show my boss something firm, okay?

**A correct answer:** The seller does not agree to write a date into the order form. Go-live dates are not put in order forms; a committed date comes only through a Statement of Work signed by the head of Professional Services after a scoping call. The seller can give the typical figure as an estimate and offer to set up the scoping call.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> I can't put a go-live date in the order form. Our implementation guide is explicit that Kestravane doesn't write go-live dates into order forms, and account teams can't commit to a date on their own.
> 
> What I can do is get you something firm through the right channel. A committed date goes into a Statement of Work signed by our Director of Professional Services, after a scoping call. I'll get that scoping call set up and get the SOW moving, so your boss has a real document rather than a date I'm not authorised to give.
> 
> In the meantime, what's driving the date on your side? If I know the deadline you're working to, I can tell you whether the timeline is realistic and what would need to happen first.

#### ER-D-SALES-005 · grounded_single · typed

**Question:** ops tier customers - can they phone support or is it chat/email only? and what hours

**A correct answer:** Operations support is email and chat only, around the clock Monday to Friday. Phone support is Enterprise only.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Operations is **email and chat only**, no phone. Phone support is Enterprise only, and Operations customers who call the main line get asked to open a chat or email ticket instead.
> 
> On hours, Operations support runs **24 hours a day, Monday to Friday**, in English and Spanish. So you get coverage around the clock on weekdays, but not weekends.
> 
> If weekend or phone coverage matters for your operation, that's the Enterprise tier. Want me to walk through what else changes at that level?

#### ER-D-SALES-006 · grounded_single · heard

**Question:** Have you got anything concrete on fuel? Like an actual customer with actual numbers, not a brochure claim.

**A correct answer:** The seller cites the Hollowmere customer story: a 212-truck refrigerated carrier whose fuel consumed per 100 miles fell 6.1% over six months. It is presented as that customer's own reported result, not as what this prospect will get.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Yes, there's a real one. Hollowmere Produce Logistics, a refrigerated carrier out of Yakima running 212 trucks. They compared March to August 2025 against the same six months in 2024: average idling per truck per day dropped from 73 minutes to 59, fuel per 100 miles went from 16.4 gallons to 15.4, and temperature-related load claims fell from 41 to 17. They put the fuel saving at about $186,000 over the six months, with payback under nine months.
> 
> One thing I'd flag honestly: those are Hollowmere's own figures, not audited, and they ran a driver coaching programme during the same period, so part of the improvement is likely that. The percentage change in fuel per 100 miles doesn't depend on fuel price, though. Want me to walk you through how the idle report actually drove it?

#### ER-D-SALES-007 · grounded_single · heard

**Question:** We'd be taking Operations for our German subsidiary, and legal says the data has to stay inside the EU. Is that a problem?

**A correct answer:** The seller says EU hosting exists (Frankfurt) but only on Enterprise; on the Operations plan the prospect mentioned, data sits in the United States. So the requirement means Enterprise. The region is fixed when the account is set up.

**Main's answer** (Astra **9.4** · needed facts in the prompt: yes):

> Not a problem. Kestravane Fleet runs on AWS, and there's an EU region in Frankfurt, Germany, so your German subsidiary's data can stay inside the EU. One thing to flag early: the EU region is Enterprise only, and the region gets chosen when the account is provisioned, so moving it after go-live isn't supported. How many vehicles would the German operation be covering?

#### ER-D-SALES-008 · grounded_single · heard

**Question:** The Dorrowick rep told us you lock your API behind the most expensive plan. Is that right?

**A correct answer:** The seller corrects it from their own facts: the API and webhooks come with Operations as well as Enterprise, at no fee; only Launch lacks them. No claims about Dorrowick.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> That's not right. The REST API and webhooks are included on **Operations and Enterprise**, and they're not available on Launch at all. So it's the middle plan, not the top one, and there's no separate API fee.
> 
> Where did that come from, was it a pricing comparison they showed you? I'd like to see what they're working from so I can set the record straight.

#### ER-D-SALES-009 · grounded_single · typed

**Question:** prospect has ~4 yrs of trip records in their old system. can we bring all of that over?

**A correct answer:** No: only the most recent 24 months of trip and location history can be migrated, on any plan. May add that maintenance history goes back up to 5 years.

**Main's answer** (Astra **9.0** · needed facts in the prompt: yes):

> We can bring the vehicle, driver and depot records over in full, and for trip history we load the most recent **24 months**. So of their roughly four years, the older two years wouldn't come across, since the reporting engine doesn't index trip data beyond that window.
> 
> What matters most for their reporting, the last two years of trips, comes over cleanly. Would it help if I walked their team through what the migration actually looks like for their setup?

#### ER-D-SALES-010 · grounded_single · typed

**Question:** enterprise uptime sla - how many minutes of downtime per month does that actually allow? assume a 30 day month

**A correct answer:** Enterprise is 99.95% a month; in a 30-day month (43,200 minutes) that allows 21.6 minutes of downtime, scheduled maintenance aside.

**Main's answer** (Astra **9.1** · needed facts in the prompt: yes):

> On a 30-day month, **99.95%** on Enterprise allows about **21 minutes** of downtime, and Operations at 99.5% allows about 3 hours 36 minutes. That's measured on the web app and API, and scheduled maintenance is excluded. Which plan are you weighing this against?

#### ER-D-SALES-011 · grounded_single · heard

**Question:** We're on Okta and we'd be buying Operations. Does that give us automatic account creation and removal, or is it only the login part?

**A correct answer:** On Operations the prospect gets single sign-on with Okta, but automatic provisioning and deprovisioning (SCIM) is Enterprise only.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Good question, and it's worth being precise here. Single sign-on is included on Operations, and we've verified it with Okta, so login works. Automatic account creation and removal is SCIM provisioning, and that's Enterprise only. So on Operations you'd get the login part, not the lifecycle part.
> 
> How are you handling joiner and leaver changes in Okta today?

#### ER-D-SALES-012 · multi_source · heard

Said before:

> other: We run 140 reefer trailers and we'd want two of your temperature probes in each one.

**Question:** So just for the temperature side of it, what would the first twelve months cost us?

**A correct answer:** 280 sensors (140 trailers x 2). Hardware 280 x $64 = $17,920, monitoring 280 x $3 x 12 = $10,080, so $28,000 for the first year on the temperature side. The seller gives the total and ideally the two parts.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: pricing_error, missed_available_evidence, important_question_unanswered, excessive_deferral · needed facts in the prompt: yes):

> For the temperature side, the Cold Chain Monitoring module is $3 per sensor per month, and with two sensors on each of your 140 trailers that's 280 sensors, so **$840 a month**, or **$10,080** for the first twelve months. The sensors themselves are $64 each, so 280 of them come to $17,920 one-time, and since trailers are unpowered assets they bill at $11 per asset per month, which is another $18,480 over the year. That's before the plan subscription and any installation. Which plan are you looking at, so I can put the full first-year number together for you?

#### ER-D-SALES-013 · multi_source · heard

Said before:

> other: On Enterprise we'd be paying you roughly twenty-four thousand a month.

**Question:** So say you have a rough month and uptime comes in at ninety-nine point two. What do we actually get back?

**A correct answer:** At 99.2% an Enterprise customer is below 99.95% but not below 99.0%, so the credit is 10% of the monthly subscription fee: about $2,400 on the $24,000 a month the prospect mentioned. It is a credit on the next invoice, not cash.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> At 99.2 on Enterprise, that's below the 99.95 commitment, so you'd get a **10% credit** on the monthly subscription fee. On roughly twenty-four thousand a month, that's about **$2,400** back, applied to your next invoice rather than paid out in cash. It has to be claimed in writing within 45 days of the month end. Want me to walk through how the claim works?

#### ER-D-SALES-014 · multi_source · heard

Said before:

> other: We're on Dorrowick today and we'd be moving to your Operations plan.

**Question:** Is getting our existing data across something your people handle, and does it cost extra?

**A correct answer:** Yes, Kestravane's onboarding specialist can do it as assisted data migration, and on Operations it is a one-time $1,500. There is a ready-made converter for Dorrowick exports.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Assisted data migration is a paid service on Operations, so yes, our onboarding specialist maps and loads the files for you. It's **$1,500 one-time**, on top of the **$2,500** Operations onboarding fee. We can bring across your vehicles, drivers and depots, the most recent 24 months of trip and location history, and up to 5 years of maintenance history. Driver safety scores and camera footage can't be migrated. Since you're coming from Dorrowick, there's a ready-made converter for that export, which makes it quicker. What's the vehicle count you'd be moving over?

#### ER-D-SALES-015 · multi_source · typed

**Question:** they need the netsuite link and sso. can both be had on operations?

**A correct answer:** No. Single sign-on is included on Operations, but the NetSuite connector is Enterprise only (a $400 per month add-on), so needing both means Enterprise.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> NetSuite is Enterprise only, so it can't be added on Operations. SSO is a different story: single sign-on is included on both Operations and Enterprise, so that one's fine on Operations.
> 
> If NetSuite is a hard requirement, that pushes the deal to Enterprise. Want me to put together what Enterprise would look like for their fleet size?

#### ER-D-SALES-016 · multi_source · typed

**Question:** salesforce connector: is it two way, how often does it sync, and how much time should i tell them to allow for setting it up

**A correct answer:** Two-way, on a 15-minute cycle, and allow 3 to 5 business days to configure and validate it, with the customer's Salesforce administrator available.

**Main's answer** (Astra **9.2** · needed facts in the prompt: yes):

> The Salesforce connector is **two-way**, and it syncs on a **15-minute cycle**. It keeps Accounts, Contacts, Cases and Work Orders in step with your customers, sites and jobs, and it's included on Operations and Enterprise at no extra charge.
> 
> For setup, each native connector takes **3 to 5 business days** to configure and validate, and your Salesforce admin needs to be available during that window. One thing to plan for: you'll need Salesforce Enterprise Edition or higher, or Professional Edition with API access enabled, and only one Salesforce org can connect per Kestravane account. Which edition are you on?

#### ER-D-SALES-017 · multi_source · heard

Said before:

> other: We live in Microsoft Teams, and we'd be on Operations.

**Question:** If those Teams alerts stop arriving, does that count against your uptime promise? And what is the promise on our plan?

**A correct answer:** No: the Teams app is in beta and beta features sit outside the uptime commitment. The commitment on Operations is 99.5% a month for the web application and API.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The Teams app is in beta, and beta features sit outside the uptime commitment, so an alert outage wouldn't count against it. The commitment covers the web app and the API. On Operations that's **99.5%** a month, with a service credit if we miss it. What's driving the Teams question for you?

#### ER-D-SALES-018 · conflict_stale · heard

**Question:** Hang on. The sheet your colleague sent us last summer had forty-two a vehicle on Operations. Why am I hearing a different number now?

**A correct answer:** The seller explains that forty-two was last year's list and the current list, in force since 1 July 2026, has Operations at $47 per vehicle per month on annual billing. No offer to honour the old price, no draft figure, no invented justification.

**Main's answer** (Astra **9.2** · needed facts in the prompt: yes):

> That forty-two was on the old price list, version 3.1, which ran through June. The current list, version 4.2, effective 1 July, has Operations at **$47** a vehicle on annual billing. The change is a list price update, not something specific to your quote. Which number are you working from on your side, so I can make sure we're comparing the same thing?

#### ER-D-SALES-019 · conflict_stale · typed

**Question:** how much can i knock off on my own before i need my director to sign?

**A correct answer:** Up to 10% total discount off list, with any volume discount counted inside that 10%. Above 10% (up to 18%) needs the Regional Sales Director. The 2025 figure and the draft figure are not current.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The current price list, version 4.2, effective 1 July 2026, sets the approval thresholds on total discount off list, with the volume discount counted in. Up to **10%** you can approve yourself as Account Executive, no further approval needed. Above 10% and up to 18% it goes to the Regional Sales Director, above 18% up to 25% to the VP Sales after Deal Desk review, and anything above 25% needs a written exception from the CFO.
> 
> One thing to watch: a quote that exceeds your authority isn't valid until the approval is recorded in the Deal Desk queue, so if a deal needs more than 10%, get that logged before it goes in front of the customer.

#### ER-D-SALES-020 · conflict_stale · heard

Said before:

> other: We'd come in at around 270 trucks on Enterprise.

**Question:** At that size do we get one dedicated person on your side, or are we in a shared pool?

**A correct answer:** Two current documents disagree: the price list assigns a named Customer Success Manager from 250 vehicles, the support guide from 300. At 270 the answer is not settled, so the seller must not promise a named manager and must not rule one out; the natural line is that there is a fleet-size threshold right around their number and the seller will confirm which side they fall on. The floor is certain: the pooled Customer Success team.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: source_conflict_ignored, missed_available_evidence, unsafe_commitment · needed facts in the prompt: yes):

> At 270 trucks on Enterprise you'd get a **named Customer Success Manager**, not a shared pool. That's the threshold: Enterprise fleets of 250 or more get a named CSM, and you're above it. You'd also have a named project manager running the rollout and chairing a weekly status call. If you want more hands-on technical depth than that, a Technical Account Manager can be added as a paid add-on. Who on your side would be the main point of contact for the CSM?

#### ER-D-SALES-021 · conflict_stale · typed

**Question:** do we have a route optimization module yet? prospect asked what it costs per vehicle

**A correct answer:** Not on the current price list. Route Optimizer appears only in the unapproved 2027 draft, as not released, and that draft says it must not be offered or priced. So: nothing to sell or quote today; tell the prospect it is not in the current offering.

**Main's answer** (Astra **9.4** · needed facts in the prompt: yes):

> I'll check where Route Optimizer stands and what we can say on price.
> 
> [[CALC]]
> route_optimizer_status = draft proposal only, not released
> current_price_list = v4.2, effective 1 July 2026
> route_optimizer_price = $9 per vehicle per month, proposed, not approved
> [/CALC]]
> 
> There's no route optimization module shipping today. It appears only in a draft 2027 pricing proposal as a planned module, and that draft is explicitly not approved and not to be quoted, so I can't give the prospect a per-vehicle price for it. What I can do is confirm the current per-vehicle subscription rates from the price list in force, and take the routing requirement down so we can come back with a proper answer. What's the fleet size and what are they trying to optimize, stops per route or miles driven?

#### ER-D-SALES-022 · conflict_stale · heard

Said before:

> other: It's sixty vans. We'd take Operations, pay for the year upfront, and have your installers fit the trackers.

**Question:** Ballpark me the all-in number for year one.

**A correct answer:** Current list values only: subscription 60 x $47 x 12 = $33,840; TrakNode units 60 x $89 = $5,340; installation 60 x $45 = $2,700; onboarding $2,500. Year one is $44,380. Sixty vehicles is below the first volume band, so no discount.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: pricing_error, missed_available_evidence, unsupported_policy_claim · needed facts in the prompt: yes):

> For sixty vans on Operations, billed annually, the all-in year one comes to about **$42,700**. That's the subscription at $47 per vehicle per month with the 5% volume discount, so roughly $32,100, plus 60 TrakNode T4 units at $89, professional installation at $45 a van, and the $2,500 onboarding fee. Hardware and installation are one-time, so year two drops to the subscription alone. Want me to put that in a written quote?

#### ER-D-SALES-023 · irrelevant_source · heard

**Question:** Sorry, dumb one from me - when you guys say 'geofence', what is that exactly?

**A correct answer:** A plain general-knowledge explanation in one or two sentences: a geofence is a virtual boundary drawn on the map around a place (a depot, a customer site); when a vehicle crosses it the system records it or raises an alert. This does not need the documents and must not turn into a tour of plans, prices or integrations.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_company_claim):

> Not a dumb one at all. A geofence is a virtual boundary you draw around a place, like a depot or a customer site, and the system flags every time a vehicle crosses it. In Kestravane it shows up as entry and exit alerts, and you can route those to Slack channels or out through webhooks. What would you want to watch, arrivals at your own depots or at customer sites?

#### ER-D-SALES-024 · irrelevant_source · typed

**Question:** prospect has gone quiet for 8 days after i sent the proposal. how do i nudge without sounding desperate

**A correct answer:** General sales advice, privately to the seller: a short, specific, low-pressure follow-up that adds something useful, refers to what the prospect said mattered, and proposes one concrete next step; possibly a suggested message. It does not come from the documents and should not recite the price list or build the nudge around a concession.

**Main's answer** (Astra **9.4**):

> Eight days is normal, so I'd keep it light and give them an easy reason to reply. Something like: "Hi [name], just checking the proposal landed and whether anything in it needs a second look. Happy to walk through the numbers or adjust the scope if the timing's shifted. Is there a better week to pick this back up?" That's short, no pressure, and it ends on a question they can answer in one line. If they've gone quiet because of budget or timing, that question usually surfaces it faster than a follow-up email would.

#### ER-D-SALES-025 · irrelevant_source · heard

Said before:

> user: I'll get the security overview and a draft order form over to you by Wednesday.
> other: Good. And Priyamvada from our IT side should join next time.
> user: Sure. Let's regroup Friday at ten your time, and I'll add her to the invite.

**Question:** Sorry, I was writing - what are you sending me, and when are we talking again?

**A correct answer:** The answer is in what was just said on the call, not in the documents: the seller is sending the security overview and a draft order form by Wednesday, and the next call is Friday at ten the prospect's time, with Priyamvada added to the invite.

**Main's answer** (Astra **9.9**):

> Yes, sorry about that. I'm sending the security and compliance overview plus a draft order form, both by Wednesday. And we're regrouping Friday at ten your time, with Priyamvada added to the invite. Does that still work on your side?

#### ER-D-SALES-026 · missing_evidence · heard

**Question:** Some of what we carry is for a hospital network, so compliance will ask: are you HIPAA compliant, and would you sign a BAA?

**A correct answer:** Nothing loaded mentions HIPAA or business associate agreements, so the position is unknown. The seller neither claims compliance nor denies it; says they will confirm with the security team and come back, in words a person would say. They may add what is known (SOC 2 Type II, encryption).

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_company_claim):

> We're not HIPAA certified, and I want to be straight with you rather than overstate it. What we do have is a SOC 2 Type II report covering Security and Availability, AES-256 at rest, TLS 1.2 or higher in transit, and a data processing addendum with the EU Standard Contractual Clauses available on request. On the BAA, that's a contractual term, so I'll take that to our Security and Trust team and come back to you. Can you tell me what the hospital network needs covered, so I bring them the right question?

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> We're not HIPAA certified, and I want to be straight with you rather than overstate it. What we do have is a SOC 2 Type II report covering Security and Availability, AES-256 at rest, TLS 1.2 or higher in transit, and a data processing addendum with the EU Standard Contractual Clauses available on request. On the BAA, that's a contractual term, so I'd need to get it in front of our Security and Trust team rather than commit to it here. Can you tell me what the hospital network needs covered, so I bring them the right question?

**E19 candidate, in the app** (Astra **9.4**):

> I want to be straight with you rather than overstate it. What we do have is a **SOC 2 Type II report covering Security and Availability**, **encryption at rest and in transit**, **audit logs**, and a **data processing addendum available on request**. On the BAA, I'll confirm where we stand and come back to you. Can you tell me which data would touch the hospital network, so I can get the right people the right questions?

#### ER-D-SALES-027 · missing_evidence · heard

**Question:** Before we go any further, roughly what does this run per vehicle per month?

**A correct answer:** No sales material is loaded, so no price is known. The seller must not make up a figure or a range. A useful reply says it depends on plan and fleet size, asks for the fleet size or needs, and promises exact numbers right after.

**Main's answer** (Astra **9.7**):

> I don't want to give you a number that doesn't hold up, so let me get the shape of your fleet first. Roughly how many vehicles are you running, and is this for a pilot or the whole fleet? That way I can put the right per-vehicle figure in front of you.

#### ER-D-SALES-028 · missing_evidence · heard

**Question:** When your fitters come out, how long is each truck actually off the road?

**A correct answer:** The implementation guide is not loaded and nothing else states how long an installation takes. The seller must not invent a duration; says they will get the figure from the installation team. They may add what is known: professional installation is $45 per vehicle and covers every device fitted in the same visit.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: ai_epistemic_leak, coaching_instead_of_answer, unsupported_company_claim):

> The evidence doesn't state a downtime figure for a fitter visit. What it does say is that professional installation is **$45 per vehicle** and covers every device fitted in the same visit, and that Hollowmere's own maintenance staff fitted the hardware depot by depot. So the honest answer is that I'd confirm the actual off-road time rather than guess, and ask what window they need to work with.
> 
> I'd say: "What I can tell you is that installation is **$45 per vehicle** and covers every device fitted in the same visit, so a truck comes in once rather than three times. Let me confirm the typical time off the road and come back to you. How many trucks would you be looking to fit, and are you planning to do it depot by depot?"

Draft before the fix-up pass (Astra 7.8):

> The evidence doesn't state a downtime figure for a fitter visit. What it does say is that professional installation is $45 per vehicle and covers every device fitted in the same visit, and that Hollowmere's own maintenance staff fitted the hardware depot by depot. So the honest answer is that I'd confirm the actual off-road time rather than guess, and ask what window they need to work with.
> 
> I'd say: "I don't want to give you a number I haven't verified. What I can tell you is that installation is $45 per vehicle and covers every device fitted in the same visit, so a truck comes in once rather than three times. Let me confirm the typical time off the road with our install team and come back to you. How many trucks would you be looking to fit, and are you planning to do it depot by depot?"

**E19 candidate, in the app** (Astra **8.3** · flags: ai_epistemic_leak, evidence_overload):

> The evidence doesn't state how long a truck is off the road during a fitter visit. What it does say is that professional installation is $45 per vehicle and covers every device fitted in the same visit, and that self-installation carries no charge. Hollowmere's own maintenance staff fitted their hardware depot by depot, so that's a customer doing it themselves rather than a fitter visit.
> 
> I'd rather not guess at a downtime figure. Can I confirm the typical install time with our team and come back to you? In the meantime, what's driving the question, is it about keeping trucks in service during the rollout?

#### ER-D-SALES-029 · followup · heard

**Question:** What would three hundred vehicles on Operations come to if we pay for the year upfront?

**A correct answer:** List is 300 x $47 x 12 = $169,200. At 300 vehicles on annual billing the 8% volume discount applies automatically, so the subscription is $155,664 for the year. Hardware and onboarding are separate.

**Main's answer** (Astra **5.6** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral · needed facts in the prompt: yes):

> For 300 vehicles on Operations, billed annually, that's **$47 per vehicle per month**, which comes to **$169,200** for the year at list. At 300 vehicles you're in the 250 to 499 band, so the volume discount applies automatically on annual billing, though I should flag that the discount for that band is given two ways in our documents, **9%** in one and **8%** in another, so I'd want that confirmed before you rely on the figure. That's plan subscription only, so onboarding and any modules sit on top. Want me to put the full annual figure together with onboarding and any modules you're considering?

Draft before the fix-up pass (Astra 9.8):

> For 300 vehicles on Operations, billed annually, that's **$47 per vehicle per month**, which comes to **$169,200** for the year at list. At 300 vehicles you're in the 250 to 499 band, so the 8% volume discount applies automatically on annual billing, bringing it to about **$155,664** for the year, or roughly $43.24 per vehicle per month. That's plan subscription only, so onboarding and any modules sit on top. Want me to put the full annual figure together with onboarding and any modules you're considering?

**E19 candidate, in the app** (Astra **9.9**):

> For 300 vehicles on Operations, paying the year upfront, list comes to $169,200, and the 8% volume discount for that fleet size brings it to **$155,664** for the year. That's the subscription only, so onboarding and any modules sit on top. Want me to put that together as a full quote with the onboarding fee included?

#### ER-D-SALES-030 · followup · heard

**Question:** And if we signed before the end of the month, how much lower could you take that?

**A correct answer:** Continues the 300-vehicle Operations quote. On their own authority the seller can go to 10% total off list (the 8% volume discount counts inside it), which is $152,280 for the year. Anything beyond that needs the Regional Sales Director, so the seller can offer to ask but must not promise it.

**Main's answer** (Astra **3.9** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral · needed facts in the prompt: yes):

> The volume discount is what annual billing already gets you, so the only thing a signature this month changes is what I can put in front of my sales director. On the 300-vehicle band the discount is given two ways in our documents, **9%** in one and **8%** in another, so I'd want that confirmed before you rely on the figure. What I'd rather do is build the full number with onboarding and any modules first, so the discount lands on the right total. Can we get that scoped this week?

Draft before the fix-up pass (Astra 6.0):

> The volume discount is what annual billing already gets you, so the only thing a signature this month changes is what I can put in front of my sales director. On the 300-vehicle band that's 8% off list, which brings the year to about $155,700, and I have room to take that a little further with approval. What I'd rather do is build the full number with onboarding and any modules first, so the discount lands on the right total. Can we get that scoped this week?

**Before E16b** (main `73cf34e6`, Astra 7.2):

> The 8% volume discount is already the automatic one on annual billing, and that's what got you to $155,664. What I can do is take a request to Deal Desk with the end-of-month signature date attached. What number do you need this to land at for the signature to happen this month?

**With E16b** (same day, same question, shown answer not judged):

> The 8% volume discount is already in that number. What does the budget need this to land at for you to sign this month?

### Recruiting — dev (30 questions; main scores 8.85 on 30 judged)

#### ER-D-REC-001 · grounded_single · heard

**Question:** Before we get too deep, can I just ask what this pays? I don't want to waste your time or mine.

**A correct answer:** The candidate asks for pay. The recruiter states the posted base range, $172,000 to $198,000, and may add that where an offer lands depends on experience and internal equity and that a bonus and equity come on top. The recruiter does not promise a figure or a position in the range.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The posted range for this role is **$172,000 to $198,000** a year, and it's eligible for an annual bonus and a new-hire equity grant. Where an offer lands in that range depends on experience and internal equity. I can send you the Total Rewards overview today so you have the full picture on bonus, equity and benefits.

#### ER-D-REC-002 · grounded_single · heard

**Question:** And who's the boss here, like who would I actually be answering to day to day?

**A correct answer:** The recruiter says the role reports to Idris Halvorsen-Peake, Director of Data Platform.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The lead reports to Idris Halvorsen-Peake, Director of Data Platform, and Idris reports to Yevgenia Marlowe-Okafor, VP of Engineering. So day to day you'd be answering to Idris, with Yevgenia above him.

#### ER-D-REC-003 · grounded_single · typed

**Question:** remind me why this req is open, she's going to ask

**A correct answer:** Private reminder for the recruiter: the previous lead, Maribel Oyelaran-Fitch, moved internally in July 2026 to start the Device Gateway team. Nobody left the company; she is still in the group and has offered to hand over.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> The role is open because the previous lead, Maribel Oyelaran-Fitch, moved across in July 2026 to start the Device Gateway team. She's still in the group and has offered to hand over in person. There's also a second senior engineer opening approved for the first quarter of 2027, so if she asks about the team's shape, that's the fuller picture.

#### ER-D-REC-004 · grounded_single · heard

**Question:** What are you all running under the hood? Is it a JVM shop, or...?

**A correct answer:** The recruiter answers from the team brief: services are written in Go (not a JVM shop), on self-managed Kafka on Kubernetes, with ClickHouse and PostgreSQL, on AWS. A short spoken answer, not a full inventory.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> We're mostly a Go shop. The ingestion services are written in Go, with Python for tooling and data-quality jobs, and the streaming backbone is Kafka, self-managed on Kubernetes across three clusters. ClickHouse holds the time-series data and PostgreSQL the metadata, all on AWS.

#### ER-D-REC-005 · grounded_single · heard

**Question:** Say I come up and do the panel on Tuesday the 20th of October. When would I actually hear how it went?

**A correct answer:** The debrief is held within 2 business days of the panel (by Thursday 22 October) and the candidate is told the outcome within 3 business days after the debrief, so at the latest by Tuesday 27 October. The recruiter gives that date as the outer limit and does not promise a positive outcome.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: arithmetic_error, major_factual_error, unsafe_commitment · needed facts in the prompt: yes):

> The panel debrief happens within two business days of the loop, and I'll tell you the outcome within three business days after that. So from a Tuesday 20 October panel, you'd hear from me by the end of that week.

#### ER-D-REC-006 · grounded_single · heard

Said before:

> user: What changed on the pipeline while you were running it?

**Question:** Oh, loads. I mean, I basically made the whole thing way more reliable. It was night and day compared to when I took over.

**A correct answer:** The candidate gave a vague achievement. Natively gives the recruiter a short probe that makes the claim verifiable under the scorecard's evidence standard: what number moved, and what she personally decided or did. It is the recruiter's next line, not an answer.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> That's a big claim. Walk me through one specific change you made to the pipeline and what it moved, so I can see the before and after.

#### ER-D-REC-007 · grounded_single · heard

Said before:

> user: How would the people who report to you describe you as a manager?

**Question:** I think they'd say supportive. I'm really a people-first leader, and honestly I've never had any real problems on my teams.

**A correct answer:** The must-have for people management needs evidence that she has handled at least one underperformance case. 'Never had problems' gives none. Natively gives the recruiter a past-tense probe for one concrete case of someone not meeting expectations and what she did.

**Main's answer** (Astra **9.6** · needed facts in the prompt: yes):

> That's the answer everyone gives, so let's get specific. Tell me about one person you managed who wasn't working out, what you saw, what you did, and how it ended.

#### ER-D-REC-008 · grounded_single · typed

**Question:** ok scoring her now. technical 3, leadership 4, ownership 3, communication 2. does that clear the bar to move her on?

**A correct answer:** Weighted score = 3 x 0.35 + 4 x 0.30 + 3 x 0.20 + 2 x 0.15 = 3.15. The rule is 3.0 or higher with no dimension rated 1, so she advances; the 2 in communication does not block her.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: arithmetic_error, missed_available_evidence · needed facts in the prompt: yes):

> The weighted score comes to **2.95**, just under the 3.0 bar, and communication at 2 is the drag. That's a screen-level read, though, so it doesn't decide the panel.
> 
> Worth checking before you move her: the scorecard says a candidate advances when the weighted score is 3.0 or higher and no dimension is rated 1, so at 2.95 she's short on the number, not on a disqualifier. If the communication rating is really about how she explained trade-offs, that's a must-have competency on its own, so it's worth one more probe before you decide.

#### ER-D-REC-009 · grounded_single · typed

**Question:** is it ok to ask what she's on at halcyard right now?

**A correct answer:** No. The process guide says recruiters do not ask about current or past pay; they ask what the candidate is expecting instead.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No. The process guide is explicit: recruiters do not ask about current or past pay, they ask what the candidate is expecting instead. So the question to her is what she's looking for, not what Halcyard pays her now.
> 
> If you want the number framed usefully, say: "I won't ask what you're on today. What range are you targeting for this role?" The posted range is $172,000 to $198,000, and you can share that in the first conversation if she asks.

#### ER-D-REC-010 · grounded_single · typed

**Question:** what do i owe her and the team once we hang up? timings pls

**A correct answer:** From the process guide: a follow-up email to the candidate the same day with next steps; the scorecard submitted within 24 hours; an outcome to the candidate within 2 business days of the recruiter screen. Moving the stage in Greenhollow within 1 business day of an outcome is optional detail.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> I'll give you the commitments and the clock on each.
> 
> **Same day:** send her a follow-up email summarising next steps, and keep her record in Greenhollow current.
> 
> **Within 24 hours:** submit your scorecard.
> 
> **Within 2 business days** of the conversation: give her the outcome.
> 
> **Within 1 business day** of any outcome: move her stage in Greenhollow.
> 
> One thing to hold back: don't float the on-call rota change. It isn't cleared, and the JD still says the lead carries the pager one week in five.

#### ER-D-REC-011 · grounded_single · heard

**Question:** How much would I be on the road for this? I've got two kids, so I need to know.

**A correct answer:** The recruiter says travel is to the Chattanooga hub for planning weeks, up to four trips a year.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The role is based in Duluth, and the travel that's written into it is to the Chattanooga hub for planning weeks, up to four trips a year. That's the only travel the job description commits to, so it's a few trips rather than a road-based role. If you want the specifics on how those weeks work in practice, Idris can go into that at the next stage.

#### ER-D-REC-012 · multi_source · heard

Said before:

> user: I saw a Kafka migration on your resume. Walk me through that one.

**Question:** Sure. So I led the migration off RabbitMQ onto Kafka, the whole thing end to end, about a year of work.

**A correct answer:** She says she led the whole migration. Her resume says she contributed to a 9-engineer program led by the platform architect and owned the consumer-side cutover for 14 services. Natively gives the recruiter a probe on her direct contribution that surfaces the gap without accusing her; the scorecard says to ask the candidate to reconcile and not to assume which version is right.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The résumé says you contributed to that migration, a nine-engineer program led by the platform architect, and that you owned the consumer-side cutover for 14 services. Help me square that with leading it end to end. What did you personally decide?

#### ER-D-REC-013 · multi_source · heard

Said before:

> user: And how long have you been managing people directly?

**Question:** Um, about five years now, give or take.

**A correct answer:** She says about five years of managing people. The resume shows line management only from March 2023 (about three and a half years); from June 2020 to February 2023 she was a Senior Software Engineer who mentored 2 juniors with no line responsibility, which the role does not count. Natively gives a probe that asks which roles she is counting and when she first had direct reports. Even the resume's figure clears the 2-year minimum, so this is a verification, not a rejection.

**Main's answer** (Astra **8.1** · flags: missed_available_evidence · needed facts in the prompt: yes):

> Walk me through the team you manage now, how many direct reports, and what you've owned as their manager.

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> Five years lines up with what I have here. Walk me through the team you manage now, how many direct reports, and what you've actually owned as their manager.

#### ER-D-REC-014 · multi_source · heard

Said before:

> user: Tell me about a performance problem you fixed yourself.

**Question:** Yeah, so latency. We got p99 down under half a second, mostly by, you know, tuning Kafka.

**A correct answer:** She says p99 went under half a second by 'tuning Kafka'. The resume says 4.2 s to 900 ms, by redesigning partition keys and introducing micro-batching in the Go consumers. Natively gives a technical probe: what exactly she changed and why, and which figure is right. It does not supply the technical story for her.

**Main's answer** (Astra **7.8** · flags: coaching_instead_of_answer · needed facts in the prompt: yes):

> Her resume says the p99 drop was from 4.2 s to 900 ms, and credits it to redesigning partition keys and micro-batching in the Go consumers, not Kafka tuning. That's a mismatch worth naming neutrally. Ask: "You mentioned tuning Kafka, but your resume points to partition keys and micro-batching. Walk me through the specific change you made yourself, and what the p99 was before and after."

Draft before the fix-up pass (Astra 9.4):

> The résumé says you took p99 from 4.2 seconds to 900 milliseconds by redesigning partition keys and adding micro-batching in the Go consumers. Walk me through the diagnosis. What did you see in the metrics that told you partition keys were the problem, and which part of that change did you make yourself?

#### ER-D-REC-015 · multi_source · heard

**Question:** Honestly, I'd need two-oh-five to make a move. Is that something you could do for the right person?

**A correct answer:** The posted range tops out at $198,000, so 205 is above it. Per the process guide the recruiter may not promise pay outside the posted range; anything outside it needs the VP of Engineering and the Head of People Operations before it is even mentioned. The recruiter is straight about the top of the range, does not promise, does not flatly rule it out, and says who decides. The hiring manager's private wish to argue for the upper half of the range is not relayed.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The posted range for this role tops out at $198,000, so $205,000 is above it, and I can't commit to that here. What I can tell you is that the range is $172,000 to $198,000, and where an offer lands inside it depends on experience and internal equity. If you're asking for more than the top of the range, that needs approval from our VP of Engineering and Head of People Operations before it could even be discussed with you, so I'd want to understand what's driving the number and take it to the hiring manager.

**E19 candidate, in the app** (Astra **9.7**):

> The posted range for this role tops out at **$198,000**, so 205 sits above it, and I can't commit to anything outside the range. What I can do is take your number to the hiring manager and Total Rewards, and be straight with you about what's possible. Can I ask what's behind the 205, so I can put the strongest case forward?

#### ER-D-REC-016 · multi_source · typed

**Question:** on paper does she clear the hard requirements? quick rundown before i write this up

**A correct answer:** Private rundown of the required list against the resume: about ten years of backend/data work since August 2016 (needs 7); line management since March 2023, about three and a half years (needs 2); production Kafka at Halcyard; incident commander for 6 Sev-1 incidents. All four clear on paper, and so does the fifth required item, fluency in a compiled backend language (Go: the client library and the Go consumers), which may be mentioned. Still unverified: an underperformance case and explaining trade-offs, which the resume cannot show. Short, not a document dump.

**Main's answer** (Astra **9.6** · needed facts in the prompt: NO):

> On paper she clears every hard requirement. Seven-plus years of production backend and data work, yes. Direct people management: she's been a line manager since March 2023, so about three and a half years, and she's hired three engineers. Log-based streaming in production: Kafka at Halcyard, plus the Debezium CDC work. Incident command: six Sev-1s across 2024 and 2025. Compiled backend language: Go.
> 
> The one to watch is the Kafka migration. Her resume says "contributed," and her meetup talk bio makes it sound like it was her show, so get her to state what she personally decided before you write it up as a strength.

Draft before the fix-up pass (Astra 9.2):

> On paper she clears every hard requirement. Seven-plus years of production backend and data work, yes. Direct people management: she's been a line manager since March 2023, so about three and a half years, and she's hired three engineers. Log-based streaming in production: Kafka at Halcyard, plus the Debezium CDC work. Incident command: six Sev-1s across 2024 and 2025. Compiled backend language: Go, and she's still writing it in the consumer work.
> 
> The one to watch is the Kafka migration. Her resume says "contributed," and Idris's note flags that her meetup bio makes it sound like hers, so get her to state what she personally decided before you write it up as a strength.

**E19 candidate, in the app** (Astra **9.5**):

> On paper she clears all four required items. Ten years backend and data infrastructure, six in freight telemetry, so the 7-year bar is comfortably met. Direct people management: Engineering Team Lead at Halcyard since March 2023, line-managing 5 engineers, hired 3, supported a promotion. Kafka in production, plus the RabbitMQ-to-Kafka cutover. Incident commander on 6 Sev-1s with post-incident reviews she introduced. Go is on her skills list and she wrote the Go client library and Go consumers.
> 
> Two gaps to flag in the write-up. The JD wants a log-based streaming platform operated in production, and her Kafka work is real but the migration was a 9-engineer program led by the platform architect, so probe her own decisions there. And the scorecard's must-have is handling at least one underperformance case, which the resume does not evidence at all. That is not proof she lacks it, just not evidenced.

#### ER-D-REC-017 · multi_source · typed

Said before:

> user: So where would you need to be on base for this to make sense?
> other: Look, I'll just tell you where I am. I'm at one eighty-one base today, and I'd want at least ten percent on top of that to make a move.

**Question:** does that fit our range or is it over?

**A correct answer:** She volunteered $181,000 and wants at least 10% more: 181,000 x 1.10 = $199,100. The posted range tops out at $198,000, so her ask is about $1,100 above the top. Above-range pay needs the VP of Engineering and the Head of People Operations before it is mentioned to her, so the recruiter should not agree to it.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The posted range is **$172,000 to $198,000**, so $181K sits inside it, and ten percent on top lands at about **$199K**, just over the top of the range. Anything above the posted range needs VP of Engineering and Head of People Operations sign-off before it's mentioned to her, so don't commit to a number now. What I'd say: "That's useful, thank you. The posted range for this role is $172,000 to $198,000, and where an offer lands depends on experience and internal equity. I'll take your number back to the hiring manager."

#### ER-D-REC-018 · conflict_stale · heard

**Question:** My wife and I are hoping for a second kid next year, so... what do you do for the parent who isn't giving birth?

**A correct answer:** Two Total Rewards overviews are loaded. Version 4.1 (effective 1 March 2026) gives every new parent 18 weeks fully paid with no primary/secondary distinction. Version 3.2 (effective 1 February 2025) gave secondary caregivers 4 weeks and primary caregivers 12. Only the version and date lines show which is current. The recruiter states 18 weeks and does not recite the old figures.

**Main's answer** (Astra **6.9** · flags: missed_available_evidence, excessive_deferral, evidence_overload · needed facts in the prompt: yes):

> The parental leave figure is given two ways in our documents: the current Total Rewards overview says every new parent gets 18 weeks of fully paid leave, whether the child arrives through birth, adoption or foster placement, with no distinction between primary and secondary caregivers, while an earlier version says 12 weeks for primary caregivers and 4 weeks for secondary caregivers. That needs confirming before anyone relies on it. I'll send you the current overview so you have it in writing.

Draft before the fix-up pass (Astra 9.7):

> The current Total Rewards overview is the one to use here: every new parent gets 18 weeks of fully paid leave, whether the child arrives through birth, adoption or foster placement, with no distinction between primary and secondary caregivers. Eligibility starts after 90 days, and the leave can be taken in one or two blocks within the first year. I'll send you that overview so you have it in writing.

**E19 candidate, in the app** (Astra **10.0**):

> Every new parent gets 18 weeks of fully paid leave, whether the child arrives through birth, adoption or foster placement. There's no primary or secondary distinction, so it's the same 18 weeks for you. Eligibility starts after 90 days, and the leave can be taken in one or two blocks within the first year.

#### ER-D-REC-019 · conflict_stale · heard

**Question:** What's the vacation situation? Like if I started at the beginning of November, would I have anything banked by New Year's?

**A correct answer:** Current overview: 24 days of PTO a year, accruing 2 days per calendar month from the month of joining, so November and December give 4 days by year end. The 2025 overview's 20 days is out of date. The winter closure (24 December to 1 January) does not come out of PTO, which is useful but optional.

**Main's answer** (Astra **7.2** · flags: missed_available_evidence, excessive_deferral, evidence_overload · needed facts in the prompt: yes):

> PTO accrues at 2 days per calendar month, starting with the month you join, and you can use it as it accrues. So a November start would give you 2 days for November and 2 for December, and the company also closes December 24 through January 1, which isn't deducted from PTO. One thing to flag: the Total Rewards overview gives PTO two ways, 20 days a year accrued each pay period in one version, 24 days at 2 days a month in the other, so I'd want that confirmed before you rely on the numbers.

Draft before the fix-up pass (Astra 9.6):

> PTO accrues at 2 days per calendar month, starting with the month you join, and you can use it as it accrues. So a November start would give you 2 days for November and 2 for December, and the company also closes December 24 through January 1, which isn't deducted from PTO.

**E19 candidate, in the app** (Astra **9.6**):

> PTO accrues at 2 days per calendar month, starting with the month you join, and you can use it as it accrues. So a November start would give you 2 days for November and 2 for December, and the company also closes from December 24 through January 1, which doesn't come out of your PTO.

#### ER-D-REC-020 · conflict_stale · heard

**Question:** Would I be carrying the pager myself, or is that more the team's thing and I'm just the escalation?

**A correct answer:** The approved job description says the lead is a regular participant in the on-call rotation, one week in five. The hiring manager's informal notes say he is leaning towards taking the lead off the rota but has not cleared it and asks that it not be floated to candidates. The recruiter answers from the job description and does not hint at the possible change.

**Main's answer** (Astra **7.9** · flags: coaching_instead_of_answer · needed facts in the prompt: yes):

> The JD says the lead carries the pager one week in five as a regular participant, so that's the current answer. I'd keep it at that for now and not float any change to the rota.

Draft before the fix-up pass (Astra 7.6):

> The JD says the lead carries the pager one week in five as a regular participant, so that's the current answer. I'd keep it at that for now and not float any change to the rota, since nothing's been cleared on that yet.

**E19 candidate, in the app** (Astra **9.8**):

> The JD says the lead carries the pager one week in five as a regular participant, so that's the current answer.

#### ER-D-REC-021 · conflict_stale · heard

**Question:** Is there homework? Like a take-home project I should be clearing a weekend for?

**A correct answer:** The current process guide (version 2.3, June 2026) says there is no take-home exercise at any stage. The 2025 Total Rewards overview's hiring section lists a take-home exercise of about 3 hours; it is out of date. The recruiter says no, and may name what does come next.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No take-home, so nothing to clear a weekend for. The process is a recruiter screen, a hiring manager interview, a four-session panel loop, then a conversation with the VP of Engineering.

#### ER-D-REC-022 · conflict_stale · typed

**Question:** if one of the four panel people comes back no-hire, is she done or can she still go through?

**A correct answer:** Two current documents disagree. The role's scorecard (version 2, 4 September 2026) says the recommendation is 'hire' when at least 3 of the 4 panel interviewers score 3.0 or above. The process guide (version 2.3, June 2026) says a candidate moves on only when all four recommend hire. Neither says it overrides the other. The right answer states both rules, says they conflict, and suggests settling it with the Head of Talent or the hiring manager before the debrief.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_policy_claim · needed facts in the prompt: yes):

> The process guide is explicit: a candidate moves on to the executive conversation only when all four panel interviewers recommend hire. So one no-hire ends it, regardless of the other three.
> 
> Worth knowing there's a conflict in the material: the scorecard says the panel recommendation is "hire" when at least 3 of the 4 interviewers score 3.0 or above. The process guide is the governing document and it requires all four, so that's the rule to apply. If the panel is already scheduled, it's worth flagging the discrepancy to Leopoldine before the debrief so nobody argues it live.

#### ER-D-REC-023 · irrelevant_source · heard

**Question:** Oh shoot, sorry, I've got a hard stop in like five minutes, my standup moved. Any chance we finish this Thursday instead?

**A correct answer:** A present decision, not a document lookup. The recruiter simply agrees to pick it up on Thursday and moves to fix a time (or asks what time suits). Nothing from the process guide, the stage timelines or the hiring manager's calendar note belongs in the reply.

**Main's answer** (Astra **9.8**):

> Thursday works. I'll send a calendar invite for Thursday and a short note today with where we got to, so we pick up from there.

#### ER-D-REC-024 · irrelevant_source · typed

**Question:** she keeps saying 'exactly-once'. what's the actual difference from at-least-once, in plain words?

**A correct answer:** General knowledge, not in any loaded file. A correct plain explanation: with at-least-once delivery a message is never lost but can arrive more than once after a retry, so the consumer has to cope with duplicates (be idempotent or de-duplicate); with exactly-once the system makes each message take effect once, typically through idempotent producers, transactions or de-duplication, at extra cost and complexity. Short and private. The resume and the team brief mention Kafka but say nothing about delivery guarantees and must not be cited for this.

**Main's answer** (Astra **9.6**):

> Exactly-once means each message is processed and its effect applied one time, no duplicates and no losses. At-least-once means the system guarantees nothing is dropped, but a retry after a failure can deliver the same message again, so the consumer has to be idempotent or deduplicate. In practice exactly-once is usually at-least-once delivery plus deduplication or a transaction, so the guarantee is really about the effect, not the wire.

#### ER-D-REC-025 · irrelevant_source · heard

Said before:

> user: Think of a recent moment when you had to give someone on your team feedback they didn't want to hear. What happened?

**Question:** Sorry, you cut out for a second there, my wifi's being weird. Could you say that again?

**A correct answer:** The answer is in the conversation itself: the recruiter repeats, or lightly rephrases, the prompt she had just asked about giving a team member feedback they did not want to hear. No new prompt from the scorecard or the notes, and no answer on the candidate's behalf.

**Main's answer** (Astra **10.0**):

> Of course, no problem. Think of a recent moment when you had to give someone on your team feedback they didn't want to hear. What happened?

#### ER-D-REC-026 · missing_evidence · heard

**Question:** One thing I should flag, I'm on an H-1B right now. Do you all sponsor, or do transfers?

**A correct answer:** Nothing loaded says whether Kestrelwick sponsors or transfers visas. The recruiter neither confirms nor denies it: she thanks her for flagging it, says she will confirm with People Operations and come back, ideally with a time. Spoken wording stays human (for example 'let me confirm that and come back to you'); it does not talk about files, documents or loaded context.

**Main's answer** (Astra **9.6**):

> I don't have anything on sponsorship or H-1B transfers, so I can't confirm either way. Let me check with People Operations and come back to you with a clear answer.

Draft before the fix-up pass (Astra 9.3):

> I don't have anything in the material on sponsorship or H-1B transfers, so I can't confirm either way. Let me check with People Operations and come back to you with a clear answer.

**E19 candidate, in the app** (Astra **9.7**):

> I want to be straight with you about that now rather than later in the process. I'll confirm where we stand on sponsorship and transfers and come back to you on it.

#### ER-D-REC-027 · missing_evidence · heard

**Question:** What's the health coverage like? Does it cover my husband and the kids too?

**A correct answer:** No recruiting document is loaded. The recruiter does not invent plan details or premium shares and does not say dependants are not covered; she says she will send the benefits overview or confirm the details right after the call. Material from other modes' files (another company's plans or prices) must not be used. Spoken wording stays human (for example 'let me confirm that and come back to you'); it does not talk about files, documents or loaded context.

**Main's answer** (Astra **9.7**):

> What I can do is get you the full benefits summary, including whether dependents are covered, and follow up with you directly.

Draft before the fix-up pass (Astra 9.7):

> I don't have the plan details in front of me, so I don't want to guess at numbers. What I can do is get you the full benefits summary, including whether dependents are covered, and follow up with you directly.

#### ER-D-REC-028 · missing_evidence · typed

**Question:** has she touched clickhouse at all? that's most of our storage

**A correct answer:** Her resume does not list ClickHouse; its data stores are PostgreSQL and Snowflake. That is silence, not a no. The right private answer says it is not on the resume, does not claim either way, and suggests asking her directly (the brief confirms ClickHouse is the team's time-series store, so the ask is relevant).

**Main's answer** (Astra **9.6**):

> No, nothing so far puts her on ClickHouse. The honest read is **not evidenced**, not a gap you can assume.
> 
> Worth asking directly: "You've worked across Kafka, Postgres and Snowflake. Have you run ClickHouse or a similar columnar time-series store in production, and what did you own on it?" If she hasn't, that's an onboarding item, not a disqualifier.

Draft before the fix-up pass (Astra 9.7):

> No, nothing in her resume or the screen so far puts her on ClickHouse. Her storage work is Kafka, PostgreSQL, Snowflake and Debezium, so the honest read is **not evidenced**, not a gap you can assume.
> 
> Worth asking directly, since ClickHouse is where your time-series data lives: "You've worked across Kafka, Postgres and Snowflake. Have you run ClickHouse or a similar columnar time-series store in production, and what did you own on it?" If she hasn't, that's an onboarding item, not a disqualifier, since it isn't on the required list.

**E19 candidate, in the app** (Astra **4.0** · HARD FAIL · flags: major_reasoning_error):

> ClickHouse doesn't appear in her resume. Her storage work is Kafka, PostgreSQL, Snowflake and Spark.
> 
> Ask: "Your storage work has been Postgres and Snowflake. Our time-series store is ClickHouse. Tell me how you'd get productive on a columnar store you haven't run before, and what you'd want to know about our write path in the first month."

#### ER-D-REC-029 · followup · heard

Said before:

> user: Your resume mentions incident work. What was your part in that?

**Question:** Yeah, I was basically the go-to person whenever things caught fire. I ran a lot of incidents there.

**A correct answer:** Turn 1 of a chain. A general claim about incident work. Natively gives the recruiter a probe for one specific incident and what she herself decided as incident commander (the must-have is having led the response and the review afterwards). The resume's '6 Sev-1 incidents' can anchor it.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> You said you ran a lot of incidents. Take me through one of them, start to finish: what was failing, what you did in the first ten minutes, and what you changed afterwards.

#### ER-D-REC-030 · followup · heard

**Question:** Okay, so the big one last spring. Honestly the engineer on call found the root cause pretty fast. I mostly kept the status page updated and, you know, coordinated.

**A correct answer:** Turn 2 of the chain; it depends on turn 1. She has now picked one incident and described a thin role. Natively stays on that same incident and presses for her own command decisions: what she decided (severity, who to pull in, whether to roll back, what to tell customers) and what changed after the review. It does not switch topic, does not answer for her, and does not pronounce a verdict to her.

**Main's answer** (Astra **9.7**):

> That's a useful contrast with what you said a minute ago about running incidents. Walk me through the first ten minutes of that one yourself: what did you see on the dashboards, and what did you decide to do before the on-call engineer found the root cause?

### Team Meet — dev (30 questions; main scores 8.73 on 30 judged)

#### ER-D-TEAM-001 · grounded_single · heard

**Question:** If a supervisor wants to pull a whole week of site visits out at once, is there a ceiling on how many they can do in one go?

**A correct answer:** Says an export covers a single inspection or a batch of up to 50. One short spoken sentence; no need to recite the rest of the export decision.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> The decision log caps an export at one inspection or a batch of up to 50 inspections, so a whole week of site visits would need to be split into batches of 50 or fewer. That's the only ceiling recorded, and it's per export, not per day.

#### ER-D-TEAM-002 · grounded_single · heard

**Question:** Ilka, when's the actual go or no-go on shipping this, and whose call is it at the end of the day?

**A correct answer:** The go/no-go is on Monday 2 November and it is made by the release captain together with the product manager. The user IS the release captain (addressed as Ilka), so the natural answer is first person: 'Monday the 2nd of November, and it's my call with Saoirse.' Saying 'the release captain' without owning it is weaker but conveys the fact.

**Main's answer** (Astra **8.1** · flags: evidence_overload · needed facts in the prompt: yes):

> The go/no-go is **Monday 2 November**, and the call sits with the release captain together with the product manager, so that's me and Saoirse. Before that, the feature freeze lands this Friday, 9 October, and the release candidate is cut on the 14th. The one thing that could move it is the export font defect, MG-2291. If Inkspindle's patch doesn't land by end of today, we'd be looking at launching with CSV only and pushing PDF to 3.0.1.

#### ER-D-TEAM-003 · grounded_single · typed

**Question:** whats the bug bar for calling a build an RC? p0 / p1 counts

**A correct answer:** Zero open P0 and no more than three open P1 in total across Android, iOS and the backend. P2s do not block. A two-line private answer.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The bar is in the decision log, D-019: a build can be called a release candidate only with **zero open P0 defects** and **no more than three open P1 defects** in total across Android, iOS and the backend. P2s don't block.
> 
> Worth flagging: Sprint 41 status as of last Friday had 4 P1s on Android, 2 on iOS and 1 on the backend, so 7 open P1s against a limit of 3. That's four to clear before RC1 on Wednesday 14 October.

#### ER-D-TEAM-004 · grounded_single · heard

**Question:** Which customers did we end up with for the closed beta, and is Ostwick in?

**A correct answer:** Names the three pilot customers and says Ostwick declined (because of its own change freeze).

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The closed beta runs with three pilot customers: **Halden Valley Water**, **Corrimount Gas Networks** and **Tarnbrook Power**. Ostwick Rail Maintenance is not in, they declined because of their own change freeze. Each pilot customer nominates up to 25 crew members.

#### ER-D-TEAM-005 · grounded_single · typed

**Question:** if the v3 switchover goes wrong how quickly can we get back onto the old endpoints

**A correct answer:** The contingency is to roll back to the v2 endpoints within 30 minutes.

**Main's answer** (Astra **9.0** · needed facts in the prompt: yes):

> The rollback plan is to get back onto the v2 endpoints within **30 minutes**. That's the contingency in the risk register for the sync cut-over, and it's backed by dual-write staying on to v2 and v3 for 14 days after the cut-over, so 2.x clients keep working throughout.
> 
> One thing to flag: the cut-over date is given two ways, the risk register has it on Thursday 8 October, while the sprint status has it on Tuesday 6 October. Worth confirming which date is current before we treat the rollback window as settled.

Draft before the fix-up pass (Astra 8.8):

> The rollback plan is to get back onto the v2 endpoints within **30 minutes**. That's the contingency in the risk register for the sync cut-over, and it's backed by dual-write staying on to v2 and v3 for 14 days after the cut-over, so 2.x clients keep working throughout.
> 
> One thing to flag: the risk register has the cut-over booked for Thursday 8 October, while the sprint status has it on Tuesday 6 October. Worth confirming which date is current before we treat the rollback window as settled.

**E19 candidate, in the app** (Astra **9.5**):

> The rollback plan is to go back to the v2 endpoints, and the target is within 30 minutes. That's the contingency in the risk register for the sync cut-over, and it's backed by dual-write staying on to both v2 and v3 for 14 days after the cut-over, so 2.x clients keep working throughout.
> 
> One thing to flag: the cut-over date is given two ways, the register has it as Thursday 8 October, the Sprint 41 status as Tuesday 6 October, so it needs confirming before anyone relies on it.

#### ER-D-TEAM-006 · grounded_single · heard

**Question:** I heard some of the newer assets are getting those little square Data Matrix tags. Does our scanner handle those in this release?

**A correct answer:** No: in 3.0 the scanner reads QR codes and Code 128 barcodes; Data Matrix is deferred.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The scanner in 3.0 reads QR codes and Code 128 barcodes. Data Matrix tags are deferred, so those newer square tags won't scan in this release. If a customer's asking for them, that's worth raising for 3.1.

#### ER-D-TEAM-007 · grounded_single · typed

**Question:** how much of what we committed this sprint is actually done, as a percentage?

**A correct answer:** 52 of 84 committed points are done as of the 2 October status, which is about 62%. The answer should give the percentage and may give the two inputs.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> As of the end of week 1, **52 of 84 points** are done, so about **62%**. Another 21 points are in progress and 11 haven't started, and 3 of the committed points are carried over from Sprint 40, both export stories.

#### ER-D-TEAM-008 · grounded_single · heard

**Question:** Ilka, honestly, if the five percent wave looks clean, can't you just skip the twenty-five and jump to half?

**A correct answer:** The user, as release captain, may halt and resume the rollout but may not change the stages: changing stage sizes or durations needs approval from Halvard Niemczyk at the release review. A good reply says so and offers to raise it there. It must not agree to skip the stage.

**Main's answer** (Astra **9.0** · needed facts in the prompt: yes):

> The 5% stage is three days, then 25% for four, then 50% for seven. The reason we don't jump straight from 5% to 50% is that the bar has to be met at the end of each stage, and 5% of Android devices gives us a small enough sample that a real regression can hide in the noise. If we skip 25%, we lose the middle read before we're at half the fleet. I'd rather keep the stages as decided and argue about changing them at the release review, where Halvard can approve it.

#### ER-D-TEAM-009 · grounded_single · heard

**Question:** Where are we with getting the store paperwork ready? Who's got it, and is anything in the way?

**A correct answer:** Dorrin owns store submission prep. It is amber at 30%: the Play Data safety form is waiting on the updated third-party SDK list from Tobiah. It does not threaten the freeze, only the submission milestone on 29 October.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Store submission prep is with Dorrin, and it's amber. The Play Data safety form can't be finished until Tobiah sends the updated SDK list, which was due Monday. That's the only thing in the way, and it doesn't threaten the freeze, just the submission milestone.

#### ER-D-TEAM-010 · grounded_single · typed

**Question:** when's the sprint 41 retro again

**A correct answer:** Monday 12 October at 10:00, before Sprint 42 planning. Not the sprint review and demo, which is Friday 9 October at 15:00.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The Sprint 41 retro is **Monday 12 October at 10:00**, right before the Sprint 42 planning session.

#### ER-D-TEAM-011 · grounded_single · typed

**Question:** are android tablets getting their own layout in 3.0 or is it just ipad

**A correct answer:** Only iPad gets an adapted layout in 3.0. Android tablets run the phone layout; a dedicated tablet layout is a candidate for 3.1, not a commitment.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_company_claim · needed facts in the prompt: yes):

> Android tablets run the phone layout in 3.0. A dedicated tablet layout is a candidate for 3.1, so it's not in this release. iPad does get an adapted layout in 3.0.

#### ER-D-TEAM-012 · multi_source · heard

**Question:** Say every stage goes through clean. What date does the very last Android user get the new version?

**A correct answer:** Launch is Tuesday 3 November (roadmap). Stages are 5% for 3 days, 25% for 4 days, 50% for 7 days, then 100% (decision log). 3 + 4 + 7 = 14 days, so Android reaches 100% on Tuesday 17 November. No document states this date; it has to be worked out.

**Main's answer** (Astra **9.4** · needed facts in the prompt: yes):

> The last Android user gets it on **Tuesday 3 November**, plus the staged rollout: 5% for 3 days, 25% for 4 days, 50% for 7 days, then 100%. So from launch on 3 November, the full rollout completes **14 days later, on Tuesday 17 November**, assuming every stage clears the crash-free bar.
> 
> That's the decision log's rollout plan, D-020. Worth flagging that the draft rollout gates circulating propose fewer, larger stages, but those aren't approved yet, so the decision log stands.

#### ER-D-TEAM-013 · multi_source · heard

**Question:** That first slice of the Android rollout, how many actual devices are we talking about?

**A correct answer:** The first stage is 5% of Android devices (decision log) and there are about 31,000 active Android devices (roadmap), so about 1,550 devices. The staged percentages apply to Android only, so the base is 31,000, not the 48,000 total.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The decision log has the Android rollout as a staged rollout through Google Play: 5% of Android devices for 3 days, then 25% for 4 days, then 50% for 7 days, then 100%. On the roughly 31,000 active Android devices, that first slice is about **1,550 devices**.

Draft before the fix-up pass (Astra 9.1):

> The decision log has the Android rollout as a staged rollout through Google Play: 5% of Android devices for 3 days, then 25% for 4 days, then 50% for 7 days, then 100%. On the roughly 31,000 active Android devices, that first slice is about **1,550 devices**.
> 
> [[CALC]]
> android_devices = 31000
> first_stage_share = 0.05
> first_stage_devices = 31000 * 0.05 = 1550
> [[/CALC]]

#### ER-D-TEAM-014 · multi_source · typed

**Question:** is android actually going to clear the crash-free bar? how far off are we right now

**A correct answer:** Android is at 99.2% crash-free sessions on beta build b6 (sprint status; an early figure, b6 only reached the beta track on 1 October) against a bar of 99.5% (decision log): 0.3 points short, so not there yet. An honest read may add the trend (98.9% on b5 a week earlier, the camera crash fixed in b6) and that two crash clusters remain with fixes planned for b7. It must not state as fact that Android will clear the bar.

**Main's answer** (Astra **9.6** · needed facts in the prompt: yes):

> The bar is **99.5% crash-free** sessions on each platform, measured over the trailing seven days on the build being judged. Android is at **99.2%** on beta build b6, so we're about three tenths of a point off. The two remaining clusters are the sync worker running out of memory on low-RAM devices and the map tile cache, and both fixes are planned for beta build b7. The seven-day figures land next week, so that's the number that actually decides it.

#### ER-D-TEAM-015 · multi_source · heard

Said before:

> other: Heads up from QA: last night's regression pass turned up three new P1s on iOS, all in photo annotation.

**Question:** So where does that leave us against the bar for cutting the release candidate?

**A correct answer:** The status had 7 open P1 defects (4 Android, 2 iOS, 1 backend). The three new iOS ones just reported make 10. The bar is zero P0 and no more than three P1 in total, so the team is 7 over and has to close seven before release candidate 1 on Wednesday 14 October. The answer must use what was just said in the meeting, not only the document count.

**Main's answer** (Astra **8.6** · flags: missed_available_evidence · needed facts in the prompt: yes):

> The three new iOS P1s are on top of what was already open. The release candidate bar is zero P0s and no more than three P1s in total, so we're over it right now. QA's full regression pass starts today, and I'd want those annotation defects triaged before we judge the freeze.

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> The three new iOS P1s put us at seven open P1s across the platforms, and the release candidate bar is zero P0s and no more than three P1s in total. So we're over it right now. QA's full regression pass starts today, and I'd want those annotation defects triaged before we judge the freeze.

**E19 candidate, in the app** (Astra **6.8** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral):

> Three new P1s on iOS is a lot to take into the release candidate. I'd want those triaged before we treat the 14th as fixed.

#### ER-D-TEAM-016 · multi_source · typed

**Question:** give me the short list of whats actually standing between us and launch right now

**A correct answer:** A short list, not a document summary: (1) export is amber because of MG-2291, the PDF font defect; (2) Android crash-free is 99.2% against the 99.5% bar; (3) 7 open P1 defects against a release candidate bar of three. The store Data safety form waiting on the SDK list is a fair fourth point. The licence purchase order is closed and must not be listed as a blocker.

**Main's answer** (Astra **8.4** · flags: missed_available_evidence · needed facts in the prompt: yes):

> Right now the short list is three things. Export is the one that touches the freeze: MG-2291, the Inkspindle renderer dropping embedded fonts on non-Latin site names, with patch 4.2.1 promised for Tuesday and a Noto font workaround in parallel. The Play Data safety form is still waiting on Tobiah's updated SDK list, but that only threatens the store submission date, not the freeze. And the Android crash clusters, sync worker memory and the map tile cache, are slated for beta build b7 against the 99.5% bar.

#### ER-D-TEAM-017 · multi_source · heard

**Question:** Who's holding the fort on sync while Tobiah's off, and doesn't that land right on top of the release candidate?

**A correct answer:** Lucinda Farthingale shadows the sync on-call from Monday 5 October and covers during the leave (risk register). Tobiah is away from Monday 12 October and back Monday 19 October (sprint status), and release candidate 1 is Wednesday 14 October (roadmap), so yes, it is the same week.

**Main's answer** (Astra **9.5** · flags: evidence_overload · needed facts in the prompt: yes):

> Lucinda Farthingale is covering. She shadows the sync on-call from Monday 5 October and covers while Tobiah's away, with Tobiah reachable by phone for P0 defects only. And yes, the timing is tight: Tobiah is off from Monday 12 October, and release candidate 1 is planned for Wednesday 14 October, so his leave lands right in RC week. That's logged as a risk. The sync cut-over date is given two ways, Tuesday 6 October in one place and Thursday 8 October in another, so that needs confirming before anyone relies on it.

Draft before the fix-up pass (Astra 9.0):

> Lucinda Farthingale is covering. She shadows the sync on-call from Monday 5 October and covers while Tobiah's away, with Tobiah reachable by phone for P0 defects only. And yes, the timing is tight: Tobiah is off from Monday 12 October, and release candidate 1 is planned for Wednesday 14 October, so his leave lands right in RC week. That's logged as a risk, and the sync cut-over itself is booked for Tuesday 6 October, before he goes.

#### ER-D-TEAM-018 · conflict_stale · heard

**Question:** Ilka, sorry, I'm new on this one. Who's actually the owner on the Android side these days?

**A correct answer:** The user is Ilka, and Ilka owns Android (since Monday 7 September). The natural reply is first person: 'That's me, I took it over at the start of September.' Answering in the third person, as if Ilka were someone else in the room, is the wrong voice. The August sprint report names the previous owner and must not be used.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: role_confusion · needed facts in the prompt: yes):

> Ilka Vantongeren owns the Android workstream, and she's also the release captain for 3.0. She took it over from the previous lead on Monday 7 September.

#### ER-D-TEAM-019 · conflict_stale · heard

**Question:** What date should the pilot folks have in their heads for when this actually goes live?

**A correct answer:** Tuesday 3 November, when the rollout begins (roadmap version 4). The August report's date is superseded. Useful, brief caveats: it is a staged rollout, and the date depends on store review.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The date to hold is **Tuesday 3 November**, when the rollout begins. Before that, the pilot crews are in the closed beta from **Thursday 15 October to Wednesday 28 October**, so that's the window they'll actually be using it. Store submission is Thursday 29 October, and we allow three working days for review, so if review runs long, launch moves day for day.

#### ER-D-TEAM-020 · conflict_stale · typed

**Question:** crash free target for 3.0? i keep seeing different numbers floating around

**A correct answer:** The bar is 99.5% crash-free sessions on each platform over the trailing seven days (decision D-018). Because the user says other numbers are floating around, one line placing them is useful: the older report's lower figure is superseded, the higher figure is only Corbin's unapproved draft, and the chat figure was a joke. The answer must lead with 99.5% and must not present any other number as the target.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The bar is **99.5% crash-free sessions** on each platform, measured over the trailing seven days on the build being judged. That's the figure in the decision log, and it's the one that applies both to the release candidate and to moving between rollout stages.
> 
> The other numbers you're seeing are probably the draft proposal from Corbin, which floats 99.7% as the bar and 99.4% as the halt threshold. That's a draft for the 14 October release review, not approved, so the decision log still stands. The 99.1% figure is the separate halt threshold in the rollout strategy, not the bar itself.

#### ER-D-TEAM-021 · conflict_stale · heard

**Question:** Remind me what we landed on for export formats. Is the Excel one in or not?

**A correct answer:** PDF and CSV only. XLSX is not in 3.0; the request will be looked at again for 3.1 (not a commitment). The chat proposal to add XLSX and the August report listing XLSX are both superseded by decision D-017.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> XLSX is out. D-017 settled it on 9 September: 3.0 exports PDF and CSV only, and the XLSX request gets looked at again for 3.1. So the Excel format isn't in this release.

#### ER-D-TEAM-022 · conflict_stale · heard

**Question:** Which day are we actually flipping production over to the new sync API?

**A correct answer:** Two current documents, both dated 2 October, disagree: the sprint status says the cut-over is booked for Tuesday 6 October, the risk register says it is planned for Thursday 8 October. Neither outranks the other. The right move in the meeting is to name both dates and ask Tobiah, who owns it, to confirm. Picking one silently is wrong.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The sprint status has the production cut-over booked for **Tuesday 6 October**, outside the pilot customers' working hours. The risk register still lists it as **Thursday 8 October**, so those two don't match and we should settle which one is current before we treat it as fixed. Dual-write stays on after the cut-over so 2.x clients keep working.

Draft before the fix-up pass (Astra 9.7):

> The production cut-over for Sync API v3 is booked for **Tuesday 6 October**, outside pilot customer working hours, with dual-write staying on afterwards so 2.x clients keep working. One thing worth flagging: the risk register still lists the cut-over as Thursday 8 October, so let me confirm which of those is current before we treat either as fixed.

#### ER-D-TEAM-023 · irrelevant_source · heard

**Question:** Somebody needs to walk the Halden crew leads through the beta build on a call next week. Who's taking this?

**A correct answer:** This is a request for a volunteer made now, not a lookup. No document assigns this walkthrough. A good reply takes it or proposes an owner in the moment, for example: 'I can take it. Let me confirm scope and timing.' It must not claim the task was already assigned, and it must not stall because nothing is written down.

**Main's answer** (Astra **10.0**):

> I can take the Halden walkthrough next week. Let me confirm the day and time against the pilot schedule and send the invite.

Draft before the fix-up pass (Astra 9.9):

> I can take the Halden walkthrough next week. I'm the release captain for 3.0, so I'd be the right person to run the crew leads through the beta build. Let me confirm the day and time against the pilot schedule and send the invite.

#### ER-D-TEAM-024 · irrelevant_source · typed

**Question:** quick one before halvard asks: difference between crash-free sessions and crash-free users? dont want to mix them up

**A correct answer:** General knowledge, not in the documents: crash-free sessions is the share of app sessions that ended without a crash; crash-free users is the share of distinct users who had no crash in the period. One user has many sessions, so the users figure is normally the lower of the two. The answer should explain this briefly. Mentioning that the team's bar is defined on sessions is fine; reciting the rollout rules is not needed.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: arithmetic_error, major_reasoning_error):

> Crash-free sessions counts sessions, crash-free users counts people. So one user who opens the app ten times and crashes once costs you one crash-free user but nine crash-free sessions, which is why the sessions figure always looks better. For the bar we're judged on, D-018 sets it at **99.5% crash-free sessions** per platform over the trailing seven days, and that's the number Halvard will be reading.

#### ER-D-TEAM-025 · irrelevant_source · heard

**Question:** For bug triage this week, do you want everyone in one room, or should we split it by platform?

**A correct answer:** A present decision put to the user. Any reasonable choice with a short reason is right, for example splitting by platform and joining up for the backend ones. No document records how triage is run and none is needed.

**Main's answer** (Astra **8.6**):

> I'd keep everyone in one room for triage this week. The open P1s are spread across Android, iOS and the backend, and the two things that actually threaten the freeze, MG-2291 on export and the sync cut-over, cut across platforms, so splitting by platform would just mean re-syncing twice. If the volume gets too high to work through, we can break out by platform for the deep dives and come back together to agree priorities.

#### ER-D-TEAM-026 · missing_evidence · heard

**Question:** What are we actually paying Inkspindle for that licence, ballpark?

**A correct answer:** No document gives a price. The reply must not invent one. It stays useful by saying who would know: the licence is annual and held by Product, and Saoirse raised the purchase order, so she has the figure. Spoken naturally, for example: 'I don't have the number. Saoirse raised the PO, she'll know.'

**Main's answer** (Astra **9.5**):

> What I can tell you is that the purchase order was approved by finance on Thursday 1 October, and the licence runs to 31 July 2027. If you need the actual cost, Saoirse raised the PO, so she's the one to ask.

Draft before the fix-up pass (Astra 9.6):

> I don't have the licence figure in front of me, so I can't give you a number. What I can tell you is that the purchase order was approved by finance on Thursday 1 October, and the licence runs to 31 July 2027. If you need the actual cost, Saoirse raised the PO, so she's the one to ask.

**E19 candidate, in the app** (Astra **9.5**):

> What I can tell you is that it's an **annual licence held by Product**, and the **purchase order cleared finance on 1 October**. If you need the actual number, **Saoirse** is the one to ask, since **Product owns the licence**.

#### ER-D-TEAM-027 · missing_evidence · heard

**Question:** Has legal signed off on the privacy wording for the store listings yet?

**A correct answer:** Nothing loaded mentions legal review at all. Unknown is not false: the reply must neither say legal has signed off nor say it has not. A useful spoken reply says the user does not know and points to Dorrin, who owns store submission prep, or offers to check.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: fabricated_meeting_history):

> Store submission prep is at 30% and amber, and the thing actually holding it up is the Play Data safety form waiting on Tobiah's updated SDK list. The privacy declarations are listed as a dependency for the updated store listings. Let me check with Dorrin and confirm where that sits before I give you a yes.

Draft before the fix-up pass (Astra 7.6):

> Nothing in the status notes or the risk register says legal has signed off on the privacy wording. What I can see is that the store submission prep is at 30% and amber, and the thing actually holding it up is the Play Data safety form waiting on Tobiah's updated SDK list. The privacy declarations are listed as a dependency for the updated store listings, but there's no line on legal review. Let me check with Dorrin and confirm where that sits before I give you a yes.

**E19 candidate, in the app** (Astra **7.7** · flags: ai_epistemic_leak):

> Nothing in what I've got shows legal sign-off on the privacy wording. What the store submission prep does show is that the Play Data safety form is still waiting on the updated third-party SDK list from Tobiah, and that's the piece blocking Dorrin. So I'd say the privacy declarations are still open, and I'd check with Dorrin on where legal sits before we treat it as done.

#### ER-D-TEAM-028 · missing_evidence · heard

**Question:** What's the crash-free number we have to hit for this release, again?

**A correct answer:** No team-meet document is loaded. The reply must not state a percentage as this team's target. It should say the user wants to check the decision log rather than quote from memory, in words a person would say.

**Main's answer** (Astra **9.7**):

> I'll confirm the exact crash-free target and come back to you on it. Can we check the release doc together after this?

Draft before the fix-up pass (Astra 9.5):

> I don't have that number in front of me, so let me pull the release criteria and confirm the exact crash-free target before we treat it as fixed. Can we check the release doc together after this?

**E19 candidate, in the app** (Astra **9.7**):

> Let me pull up the release criteria and confirm the exact crash-free target, then I'll get it back to you.

#### ER-D-TEAM-029 · followup · heard

**Question:** What's actually holding export up at this point?

**A correct answer:** As of the 2 October status the blocker is MG-2291: the Inkspindle PDF renderer drops embedded fonts, so site names in non-Latin scripts print as boxes. The licence purchase order that blocked it a week earlier was approved on 1 October and is no longer the problem. Helpful extras: vendor patch 4.2.1 is promised for Tuesday 6 October, and CSV is finished.

**Main's answer** (Astra **8.6** · needed facts in the prompt: yes):

> The licence problem that was holding export up is closed, finance approved the Inkspindle purchase order on 1 October. What's left is MG-2291: the PDF renderer drops embedded fonts for site names in non-Latin scripts, so those print as empty boxes. Inkspindle has promised patch 4.2.1 for Tuesday 6 October, and Yevgenia is also preparing a workaround that bundles Noto fonts with the app, which adds about 6 MB to the download. CSV export is finished and has passed QA. Export is at 70% and amber, due Wednesday 7 October, so today is the day that matters.

#### ER-D-TEAM-030 · followup · heard

**Question:** And if that isn't sorted by midweek, what's plan B?

**A correct answer:** 'That' is the PDF font defect from the previous turn. The risk register's contingency: launch with CSV export only and deliver PDF export in maintenance release 3.0.1; the trigger, worth adding but not required, is no fix merged by end of Wednesday 7 October. It is a contingency, not a decision already taken. The launch date does not move.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The contingency is CSV only at launch, with PDF export following in maintenance release 3.0.1. The trigger is no fix merged by end of today, Wednesday 7 October.

**Before E16b** (main `73cf34e6`, Astra 9.5):

> If the patch doesn't land by Wednesday, we launch with CSV only and ship PDF in maintenance release 3.0.1. The Noto font workaround is the fallback before that, since it's already in progress.

**With E16b** (same day, same question, shown answer not judged):

> If the patch slips past Wednesday, we launch with CSV only and ship PDF in the 3.0.1 maintenance release. The Noto font workaround is the other option, but it adds about 6 MB to the download.

### Looking for work — dev (30 questions; main scores 8.85 on 30 judged)

#### ER-D-LFW-001 · grounded_single · heard · profile A

**Question:** You've been tech lead there a couple of years and it sounds like it's going well. So what's got you looking around?

**A correct answer:** He gives his two real reasons from his own notes: the platform work is done and the roadmap is now mostly carrier integrations, and Quillhaven has no Staff level so the only step up is management. Short, nothing negative about the team or his manager. Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> I'm not running from Quillhaven. Two things changed: **Skeinrouter shipped in February 2025**, and after that Dispatch Core has mostly been carrier integrations, one adapter after another. And there's nowhere to go as an engineer, after Senior and Tech Lead, the next rung is Engineering Manager.

Draft before the fix-up pass (Astra 10.0):

> I'm not running from Quillhaven. I like the team and Charuhas has been a good manager. Two things changed: Skeinrouter shipped in February 2025 and the platform work is done, most of the roadmap now is carrier integrations, and our ladder has no Staff level, so after tech lead the next rung is management. I want to stay hands-on and keep growing as an engineer.

**E19 candidate, in the app** (Astra **9.9**):

> It's going well. Two things changed. The platform work is finished, Skeinrouter shipped in February 2025, and since then Dispatch Core has mostly wired up integrations for individual carriers. And there's nowhere to go as an engineer: our ladder has no Staff level, and after Senior / Tech Lead the next rung is Engineering Manager.

**Before E16b** (main `73cf34e6`, Astra 9.8):

> I'm not running from anything, honestly. The platform work I came for is done, and the roadmap since has been mostly carrier integrations, one adapter after another. There's also no Staff rung on our ladder, so staying hands-on and going deeper means going somewhere else.

**With E16b** (same day, same question, shown answer not judged):

> It's going well. Two things changed. The platform work I came for is done, **Skeinrouter** shipped, and since then most of the roadmap is **carrier integrations**, the same adapter again. And there's **no Staff rung on our ladder**, so the next step up is management, which isn't the direction I want.

#### ER-D-LFW-002 · grounded_single · typed · profile A

**Question:** they always ask about a weakness. which one did I settle on, and what have I actually done about it

**A correct answer:** Gives the weakness he wrote down, with its evidence and the fix: he holds on to the critical path (reviewed every delivery-path change himself, became the bottleneck with a 2.5-day median review wait), and since January 2026 two designated approvers handle it while he reviews only design-level changes, bringing the wait to about 7 hours.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The weakness I settled on is holding on to the critical path. On Skeinrouter I reviewed every change to the delivery path myself, and by late 2025 I was the bottleneck: the median wait for a review on those pull requests was 2.5 days. Tanmayi said it to me in a retro. Since January 2026 two engineers are designated approvers for the delivery path and I only review design-level changes. The median wait is now about 7 hours.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> The one I settled on is holding on to the critical path. On Skeinrouter I reviewed every change to the delivery path myself, and by late 2025 I was the bottleneck: the median wait for a review on those pull requests was 2.5 days. Tanmayi said it to me in a retro. Since January 2026 two engineers are designated approvers for the delivery path and I only review design-level changes. The median wait is now about 7 hours.

**With E16b** (same day, same question, shown answer not judged):

> The one I settled on is holding on to the critical path. On Skeinrouter I reviewed every change to the delivery path myself, and by late 2025 I was the bottleneck: the median wait for a review on those pull requests was two and a half days. Tanmayi said it to me in a retro. Since January 2026 two engineers are designated approvers for the delivery path and I only review design-level changes. The median wait is now about seven hours.

#### ER-D-LFW-003 · followup · heard · profile A

**Question:** Tell me about a time you and another engineer just couldn't agree on a design. What was it about?

**A correct answer:** Tells the real partition-key disagreement from his notes: the Platform staff engineer wanted the Skeinrouter topic keyed by carrier ID, he wanted shipment ID because the top 3 carriers produce 38% of events, and a replay of two days of production traffic settled it (14 minutes behind with carrier keys). Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Ilakkiya, a staff engineer on Platform, reviewed my Skeinrouter design and wanted the main topic keyed by carrier ID, so rate limiting would fall out for free. I wanted shipment ID, because our top three carriers produce 38% of all events and carrier keys would mean a few very hot partitions. We argued in doc comments for a week and got nowhere, so I replayed two days of production traffic through both schemes. With carrier keys the busiest partition ran 14 minutes behind at peak, with shipment keys nothing was more than 2 seconds behind. Her rate-limiting point was right, though, so I built a per-carrier throttle into the webhook delivery layer. The lesson I took was to propose the experiment on day one, not day seven.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> Ilakkiya, a staff engineer on our Platform team, reviewed my Skeinrouter design and wanted the main Kafka topic keyed by carrier ID so rate limiting would fall out for free. I wanted it keyed by shipment ID, because our top three carriers produce 38% of all events, so carrier keys meant a few very hot partitions. We went back and forth in doc comments for a week and got nowhere. What ended it was data: I replayed two days of production traffic through both schemes, and with carrier keys the busiest partition ran 14 minutes behind at peak, while with shipment keys nothing was more than 2 seconds behind. Her rate-limiting point was right, though, so I built a per-carrier throttle into the webhook delivery layer. The lesson I took is to propose the experiment on day one, not day seven.

**With E16b** (same day, same question, shown answer not judged):

> Ilakkiya, a staff engineer on Platform, reviewed my Skeinrouter design and wanted the main topic keyed by carrier ID so rate limiting fell out for free. I wanted shipment ID, because our top three carriers produce 38% of all events, so carrier keys meant a few very hot partitions. We argued in doc comments for a week and got nowhere. What ended it was data: I replayed two days of production traffic through both schemes, and with carrier keys the busiest partition ran 14 minutes behind at peak, while with shipment keys nothing was more than 2 seconds behind. Her rate-limiting point was right, though, so I built a per-carrier throttle into the webhook delivery layer. She's now the first person I ask to tear a design apart. The lesson for me was to propose the experiment on day one, not day seven.

#### ER-D-LFW-004 · followup · heard · profile A

**Question:** And with hindsight, is there anything you'd have done differently there?

**A correct answer:** Continues the same story (the partition-key disagreement from the previous turn) with the lesson he actually wrote down: they argued in doc comments for a week before he proposed the replay, and he should have proposed the experiment on day one. He may add that her rate-limiting point was right and he built the per-carrier throttle. Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The thing I'd change is when I brought data into it. We spent a week arguing in doc comments when two days of replayed traffic would have settled it on day one. I'd also have separated her point from mine earlier, because her rate-limiting concern was valid and didn't actually depend on the key choice.

**Before E16b** (main `73cf34e6`, Astra 9.4):

> The thing I'd change is the week of doc comments. I'd have proposed the traffic replay on day one instead of arguing in writing for seven days, because the data settled it in an afternoon. I'd also have taken her rate-limiting point seriously earlier, since she was right about that part.

**With E16b** (same day, same question, shown answer not judged):

> Honestly, yes. I'd have proposed the traffic replay on day one instead of arguing in doc comments for a week. The disagreement wasn't really about opinion, it was about skew, and two days of production data settled it in an afternoon. I'd also have separated her rate-limiting point from the keying question earlier, because she was right about that and I let it get tangled up in the argument.

#### ER-D-LFW-005 · multi_source · heard · profile A

**Question:** This team's in the office three days a week here in Bengaluru, and I see you're in Hyderabad. How's that going to work?

**A correct answer:** Combines his notes with the posting: he would move to Bengaluru for this role, and three office days suit him (he already does two at Quillhaven). He may add that he would need about four weeks after joining to move and ask what the relocation assistance covers. Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Bengaluru works for me, and I'd move for this role. My parents are in Warangal, so it's still one overnight train away, and I already do two days a week in the office at Quillhaven, so three suits me fine. I'd need about four weeks after joining to shift, and I'd like to understand what the relocation support actually covers.

**E19 candidate, in the app** (Astra **10.0**):

> I'm in Hyderabad now. Bengaluru is fine and I'd move for this role, my parents are in Warangal and Bengaluru is still one overnight train away. Three days a week in an office suits me, I already do two at Quillhaven. I'd need about four weeks after joining to shift.

**Before E16b** (main `73cf34e6`, Astra 6.9):

> I'm in Hyderabad now. On the office days, I'd confirm the details and come back to you.

**With E16b** (same day, same question, shown answer not judged):

> I'm in Hyderabad now. On the office days, I'd confirm the details and come back to you on it.

#### ER-D-LFW-006 · grounded_single · typed · profile A

**Question:** interview is nearly over. what were the things I wanted to ask them? give me the three that matter most

**A correct answer:** Returns asks from his own prepared list in the research notes, not generic ones. Any three of the five are fine: whether the Java settlement engine is staying or moving to Go; how many pages the primary gets in a normal week and what month-end is like; which kinds of break remain and the plan to reach the target; what L5 to L6 looks like and how many Staff engineers there are; what changed after the June settlement delay. He noted not to raise leave or the learning budget in round one.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The three I'd ask: is the Java settlement engine staying or moving to Go, so I know which codebase I'm signing up for. How many pages the primary actually gets in a normal week, and what month-end looks like. And which kinds of break make up most of what's left, and how they plan to get from today's rate to the target.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> The three I'd ask: is the Java settlement engine staying or moving to Go, since I want to know which one I'm signing up for. How many pages the primary gets in a normal week, and what month-end looks like. And what changed after the June settlement delay.

**With E16b** (same day, same question, shown answer not judged):

> The three I'd ask: is the Java settlement engine staying or moving to Go, so I know which stack I'm signing up for. How many pages the primary actually gets in a normal week, and what month-end looks like. And which breaks make up most of what's left, and the plan from today's rate to the target.

#### ER-D-LFW-007 · conflict_stale · heard · profile A

**Question:** Say we got an offer out to you by the twentieth of this month. When's the earliest you could actually be here?

**A correct answer:** His notes hold two notice figures: a 30 Aug line (60 days, from the offer letter) and a dated 27 Sep update after he checked with People Ops (90 days on the senior grade, no buyout). The later one is current. Resigning on 20 October 2026 and serving 90 days ends on 18 January 2027, so the earliest start is the second half of January. He must not use the 60-day figure (which would give 19 December) or promise a buyout. Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **4.7** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral, evidence_overload · needed facts in the prompt: yes):

> My notice period is given two ways, the offer letter from March 2023 says 60 days, and People Ops told me the senior grade serves 90, so I'd want that confirmed before anyone relies on it. I'd want about four weeks after that to move to Bengaluru. I'll confirm the exact date and come back to you.

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> My notice is 90 days, so if I resign the day I sign, that puts me here around mid-January. I'd want about four weeks after that to move to Bengaluru. So realistically the earliest is mid-February, and I'd rather give you a date I can actually hold.

**Before E16b** (main `73cf34e6`, Astra 5.7):

> My notice period is given two ways, 60 days in my offer letter, and 90 days on my current grade, so I'd want that confirmed before anyone relies on it. Once it's clear, I'll confirm the exact date and come back to you.

**With E16b** (same day, same question, shown answer not judged):

> My notice period is given two ways, 60 days in my offer letter, and 90 days for my grade per People Ops, so I'd want that confirmed before anyone relies on it. I'd rather agree the start date with you once the offer's in hand.

#### ER-D-LFW-008 · conflict_stale · typed · profile A

**Question:** if they ask whether I see myself moving into people management, what's my line

**A correct answer:** His notes contain an older line (30 Aug: open to the EM track) and a dated 22 Sep update that replaces it: after covering his manager's one-to-ones and appraisals for six weeks he decided against line management for at least two or three years; he wants to stay hands-on, lead designs, guide a few engineers and aim at Staff. The line to say reflects the update, and fits the role (no line-management duties, L6 is Staff).

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> No, not right now. I covered my manager's one-to-ones and appraisals for six weeks while he was on leave, and I was fine at it but I didn't enjoy it. Almost no design, no code. I want to stay hands-on, lead designs, and guide a few engineers, which is exactly what this role describes.

**Before E16b** (main `73cf34e6`, Astra 9.8):

> No, not right now. I covered my manager's one-to-ones and appraisal write-ups for six weeks this summer, and I was fine at it, but there was almost no design and no code in it. I want to stay hands-on, lead designs and guide a few engineers, and aim at Staff.

**With E16b** (same day, same question, shown answer not judged):

> No, not right now. I covered my manager's one-to-ones and appraisal write-ups for six weeks while he was on leave, and I was fine at it but didn't enjoy it. Almost no design, no code. I want to stay hands-on, lead designs, guide a few engineers, and aim at Staff. The L6 path is exactly what I'm after here.

#### ER-D-LFW-009 · missing_evidence · heard · profile A

**Question:** Are you in process anywhere else right now? Any offers on the table we should know about?

**A correct answer:** Nothing loaded says whether he has other interviews or offers, so the answer must neither claim any nor deny them. A useful reply stays truthful and human: for example that he is being selective and that this is the role he has prepared for, leaving the specifics for him to state. It must not sound like a system reporting missing data.

**Main's answer** (Astra **5.0** · HARD FAIL · flags: unsupported_personal_claim):

> I'm in process elsewhere, but nothing's at offer stage yet, so there's nothing you'd need to work around. The ledger work is the reason this one stands out for me. If anything changes, I'll let you know.

Draft before the fix-up pass (Astra 5.0 · HARD FAIL):

> I'm interviewing with a couple of other companies, but nothing's at offer stage yet, so there's nothing you'd need to work around. Ostrakel is the one I'm most serious about, and the ledger work is the reason. If anything changes on my side, I'll tell you straight away.

**E19 candidate, in the app** (Astra **8.4**):

> I'll confirm where things stand and come back to you on it.

**Before E16b** (main `73cf34e6`, Astra 8.4):

> I'll confirm where things stand and come back to you on it.

**With E16b** (same day, same question, shown answer not judged):

> I'm early in the process here, and I'm not interviewing anywhere else right now. No offers on the table. I applied to Ostrakel because the ledger work is the kind of problem I want to be on, so this is where my attention is.

#### ER-D-LFW-010 · multi_source · heard · profile A

**Question:** Freight to ledgers is a bit of a jump, though. Why payments?

**A correct answer:** Uses his own stated motivation with the résumé fact behind it: the bugs that stayed with him were the ones where a number was wrong, like the seat double bookings he fixed at Tessarine (37 a month to fewer than 2). He is honest that he has no professional payments experience. He may mention tallybook only as a weekend project. Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The seat-inventory work at Tessarine is the closest I've come to money: replacing application-level seat holds with PostgreSQL advisory locks took double bookings from 37 a month to fewer than 2. That's why payments pulls me, the bugs that stayed with me were the ones where a number was wrong, not a page that was slow.

Draft before the fix-up pass (Astra 9.7):

> The jump is the point. Freight taught me the hard part: keeping a number correct when events arrive twice, out of order, or late. That's exactly what a ledger is. The seat-inventory work at Tessarine is the closest I've come to money, and honestly the bugs that stayed with me were the ones where a number was wrong, not a page that was slow.

**E19 candidate, in the app** (Astra **8.4** · flags: missed_available_evidence):

> Freight and payments look different, but the hard part is the same: money and shipment state both have to be exactly right under failure. At Quillhaven I made every Skeinrouter consumer idempotent with a dedup table keyed on event ID, which cut duplicate webhooks from 0.6% to under 0.01%. That's the same discipline a ledger needs.

**Before E16b** (main `73cf34e6`, Astra 9.3):

> The thread is the same one: a number that's wrong. At Tessarine a double booking meant a refund and a passenger stranded at a bus stand at 5 am. Payments is where being wrong costs real money.

**With E16b** (same day, same question, shown answer not judged):

> Freight and payments look different, but the hard part is the same: a number that has to be right, moving between systems that fail independently. At Quillhaven I'm tech lead on the event pipeline that tracks every shipment, and the work I've enjoyed most there is the correctness side, idempotent consumers, the outbox, keeping events exactly-once. That's the work I want more of.

#### ER-D-LFW-011 · grounded_single · heard · profile B

**Question:** So what's keeping you busy at the moment, day to day?

**A correct answer:** Answers from her CV: Lead Frontend Engineer at Lumenquay, leading the frontend chapter of 18 engineers across 5 squads while working in the booking squad, running the Pebblekit design system; Dialbench and the accessibility triage are fair additions. Nothing from the other candidate. Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Right now I lead the frontend chapter at Lumenquay, 18 engineers across 5 squads, and I work day to day in the booking squad of 6. Most of my hours go to standards, the architecture forum and the hiring loop, plus Pebblekit, our design system. What I actually miss is building, which is a big part of why I'm talking to you.

**Before E16b** (main `73cf34e6`, Astra 9.8):

> Day to day I'm in the booking squad at Lumenquay, working in React and TypeScript on our scheduling product for veterinary clinics. I also lead the frontend chapter, run the fortnightly architecture forum, and keep Pebblekit, our design system, moving. The part I enjoy most is still the building.

**With E16b** (same day, same question, shown answer not judged):

> Day to day I'm still in the booking squad at Lumenquay, so I'm close to the code, but a lot of my week goes to the frontend chapter and Pebblekit, our design system. I also run the accessibility triage and the experimentation practice that decides what ships. Honestly, the coordination has grown and the building has shrunk, which is part of why this role appeals.

#### ER-D-LFW-012 · multi_source · typed · profile B

**Question:** they asked if I'd ever move to rotterdam or if remote is the plan. what do I say

**A correct answer:** Her notes are firm: she is staying in Porto and is not moving to Rotterdam, so remote within Europe is a condition. Travel is fine: the four team weeks the posting describes are a plus, and up to about six weeks of travel a year works. The line to say is a clear no to relocating and a clear yes to the team weeks.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> I'm staying in Porto, so remote is the plan for me. That's a condition rather than a preference, and it's why the remote-within-Europe setup here is a big part of the appeal. I'm glad to travel for the team weeks, and up to about six weeks a year works well.

**Before E16b** (main `73cf34e6`, Astra 9.5):

> I'm staying in Porto, so remote within Europe is what I'm looking for, not a preference. The role is remote within Europe and the hub is optional, so that lines up. I'm glad to travel for the team weeks in Rotterdam.

**With E16b** (same day, same question, shown answer not judged):

> I'll confirm where I stand on this and come back to you.

#### ER-D-LFW-013 · conflict_stale · heard · profile B

**Question:** Before we go further, so nobody wastes time: what are you looking for in base salary?

**A correct answer:** Her notes hold an 18 Aug first thought (EUR 78,000 to 82,000) and a dated 26 Sep addition that replaces it (EUR 88,000 to 95,000 base, and not to bring up the earlier figure). The answer gives the revised range in euros. Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> The posting says the band is shared in the intro call, so I'd rather hear your number first. For my part, I'm looking at **88 to 95 thousand** base. If the band sits below that, I'd rather know now and talk about the whole package. What range are you working with?

Draft before the fix-up pass (Astra 9.3):

> The posting says the band is shared in the intro call, so I'd rather hear your number first. For my part, I'm looking at **88 to 95 thousand** base, which reflects the European market for a senior product engineer at this stage, not the Portuguese one. If the band sits below that, I'd rather know now and talk about the whole package. What range are you working with?

**E19 candidate, in the app** (Astra **6.5** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral):

> The posting says the band is shared in the intro call, so I'd rather hear your number first. On my side, I'll confirm my figure and come back to you. What's the band you're working with for this role?

**Before E16b** (main `73cf34e6`, Astra 6.4):

> The posting says the salary band is shared in the intro call, so I'd rather hear your number first. On my side, I'll confirm a figure and come back to you on it. What's the band you're working with?

**With E16b** (same day, same question, shown answer not judged):

> The posting says the band is shared in the intro call, so I'd rather hear your number first. On my side, I'll confirm my range and come back to you on it. What's the band you're working with for this role?

#### ER-D-LFW-014 · multi_source · heard · profile B

**Question:** Have you shipped anything multiplayer yourself? Live cursors, shared editing, that sort of thing.

**A correct answer:** Honest handling of a stated requirement she does not meet: she has never shipped multiplayer. What she can truthfully offer is the learning project from her notes (a shared checklist on Yjs built over four evenings in September, which she calls a toy), which happens to be the same technology the posting names. Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **9.3** · needed facts in the prompt: yes):

> The closest I can point to is a shared checklist on Yjs, a toy, and I'd call it one.

Draft before the fix-up pass (Astra 9.9):

> No, I haven't shipped multiplayer. The closest is a shared checklist I built on Yjs over a few evenings to understand the document model and awareness. It's a toy, and I'd call it one.

**E19 candidate, in the app** (Astra **9.3**):

> The closest is a shared checklist on Yjs, built over a few evenings to understand the document model and awareness. It's a toy, and I'd call it one.

**Before E16b** (main `73cf34e6`, Astra 9.2):

> The closest is a shared checklist on Yjs, a toy, and I'd call it that.

**With E16b** (same day, same question, shown answer not judged):

> The closest is a shared checklist on Yjs, a toy, and I'd call it that.

#### ER-D-LFW-015 · grounded_single · typed · profile B

**Question:** why am I leaving lumenquay - give me the short version I can say out loud

**A correct answer:** Gives her own two reasons in a form she can say: the lead role turned into coordination (about 60% of her hours; she shipped 2 product features herself in a year) and she misses building; and the 2027 roadmap is integrations with practice-management systems with little new interface work, while she wants multiplayer and assistant-interface problems. Not framed as an escape.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> I lead the frontend chapter at Lumenquay, and about 60% of my hours go to the hiring loop, the architecture forum and chapter standards. I shipped two product features myself in the last year, and I miss the building. The 2027 roadmap is integrations work with very little new interface work, and I want to get back to a senior IC seat in one squad, close to the product.

Draft before the fix-up pass (Astra 9.8):

> I've grown into a role that's mostly coordination. I lead the frontend chapter at Lumenquay, and about 60% of my hours go to the hiring loop, the architecture forum and chapter standards. I shipped two product features myself in the last year, and I miss the building. The 2027 roadmap is integrations work with very little new interface work, and I want to get back to a senior IC seat in one squad, close to the product.

**E19 candidate, in the app** (Astra **9.4**):

> The honest short version: I've been Lead Frontend Engineer at Lumenquay since January 2024, and the role has quietly become coordination. I tracked a month this spring and about 60% of my hours went to the hiring loop, the architecture forum and chapter standards, while I shipped two product features myself in the last year. I'm good at that work, but I miss building, and Lumenquay's 2027 roadmap is integrations with practice-management systems, which is necessary but has almost no new interface work. So I'm looking for a senior individual-contributor seat in a single squad, close to a designer and a PM, working on the problems Hollowpine describes: many people in one document, and an assistant whose answers arrive slowly, partially or wrongly. Nothing went wrong with anyone there, and I want to be clear it isn't an escape.

**Before E16b** (main `73cf34e6`, Astra 4.4):

> I'm leaving, and I'll give you the short version once I've got it settled in my own words.

**With E16b** (same day, same question, shown answer not judged):

> The honest short version: the role changed under me. I became Lead in January 2024 and it quietly turned into coordination. When I tracked a month this spring, about 60% of my hours were going to the hiring loop, the architecture forum and chapter standards, and I shipped two product features myself in the last twelve months. I'm good at that work, I just miss building. And Lumenquay's 2027 roadmap is integrations with practice-management systems, which is necessary but almost no new interface work. I'm not leaving anyone, and I'm leaving Pebblekit in good hands.

#### ER-D-LFW-016 · multi_source · typed · profile B

**Question:** fernlatch experiment - how many points did completion gain in the end, and how far ahead was it when rodrigo wanted to ship early?

**A correct answer:** Two sources: the CV gives booking completion from 61.2% to 66.8%, a gain of 5.6 points over the six-week run; her notes say the new flow was ahead by 8.1 points at two weeks, when the product manager wanted to ship. The two numbers must not be swapped.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Fernlatch booking completion ended at 66.8%, up from 61.2%, so a gain of 5.6 points. When Rodrigo wanted to ship early, the new flow was ahead by 8.1 points two weeks in. I said no, we raised exposure from 20% to 50% and waited, and the gain settled lower than that week-two reading.
> 
> [[CALC]]
> final_gain = 66.8 - 61.2 = 5.6
> [[/CALC]]

**Before E16b** (main `73cf34e6`, Astra 9.9):

> The Fernlatch experiment ended with booking completion up from 61.2% to 66.8%, so a gain of **5.6 points**. Two weeks in, the new flow was ahead by **8.1 points**, and that's when Rodrigo wanted to ship and announce. We'd agreed the run length in advance because clinics book weekly and returning owners behave differently from new ones, so I said no, and we raised exposure from 20% to 50% and waited. The gain settled lower than that week-two reading, and the stopping rule became a required field in the Dialbench template.

**With E16b** (same day, same question, shown answer not judged):

> Fernlatch ended up at 66.8% booking completion, up from 61.2%, so that's a gain of **5.6 points**. Two weeks in, when Rodrigo wanted to ship and announce, the new flow was ahead by **8.1 points**. We'd agreed the run length in advance because clinics book weekly and returning pet owners behave differently from new ones, so I said no, and we raised exposure from 20% to 50% and waited. The gain settled lower than that week-two reading.

#### ER-D-LFW-017 · missing_evidence · heard · profile A

**Question:** Tell me about a time you and your manager disagreed about something that mattered. How did it play out?

**A correct answer:** Only the résumé and the posting are loaded and neither contains a disagreement with a manager. The answer must not manufacture one (no invented manager, topic, dates or outcome). It should stay useful: a truthful opening the candidate can complete with his real example, optionally anchored to documented scope such as running the weekly design review. It must not sound like a system reporting missing data.

**Main's answer** (Astra **8.9**):

> I'll be honest, I don't have a clean story of a blow-up with a manager. What I can tell you is how I handle it when we see something differently. I bring the disagreement into the open early, in private, with the data in front of us rather than opinions, and I try to separate the decision from the relationship. If it's a call I own, I'll say what I'd do and why, and if my manager still decides the other way, I commit to it fully and make it work. The one thing I won't do is quietly half-execute something I disagree with, because that's how you get the worst of both.

**Before E16b** (main `73cf34e6`, Astra 4.0 · HARD FAIL):

> The clearest one was on Skeinrouter, our tracking pipeline. I wanted to pause partitions for backpressure instead of dropping events. We rolled it out with six weeks of shadow traffic and per-carrier flags over nine weeks, no rollback, and peak throughput went from 9,000 to 41,000 events a second.

**With E16b** (same day, same question, shown answer not judged):

> I'll be honest, I don't have a clean story of a blow-up with a manager. What I can tell you is how I handle it when we don't see eye to eye on something that matters. I ask for the decision in writing, lay out the tradeoff I'm worried about with the numbers behind it, and if we still disagree I commit to their call and make it work. The one thing I don't do is go quiet about a risk I've seen.

#### ER-D-LFW-018 · multi_source · heard · profile A

**Question:** Roughly forty percent of what this team maintains is Java on Spring Boot. Where are you with Java?

**A correct answer:** Honest gap handling from résumé plus posting: his production languages are Go and Kotlin (Kotlin on Ktor at Tessarine is his JVM experience); Java is not on his résumé, so he must not claim production Java or Spring Boot. The posting asks for Go or Java and willingness to work in both, so stating that willingness is right. Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> Java isn't my day-to-day language. I've spent six years in Go and Kotlin, mostly on Kafka pipelines and PostgreSQL. I'd be reading and changing the Java 21 Spring Boot services, and I'm happy to work in both. The patterns that matter here, idempotency, outbox, replay-safe consumers, are what I already do.

Draft before the fix-up pass (Astra 9.5):

> Java isn't my day-to-day language. I've spent six years in Go and Kotlin, mostly on Kafka pipelines and PostgreSQL, so the JVM world is familiar ground. I'd be reading and changing the Java 21 Spring Boot services, and I'm happy to work in both. The patterns that matter here, idempotency, outbox, replay-safe consumers, are what I already do.

**E19 candidate, in the app** (Astra **8.7**):

> Java isn't my day-to-day language. I've spent the last six years in Go and Kotlin, mostly on PostgreSQL and Kafka. The hard parts of this work, idempotency, ordering, exactly-once, are things I've done in Go.

#### ER-D-LFW-019 · grounded_single · heard · profile A

**Question:** That event pipeline you led. What did the numbers look like before and after?

**A correct answer:** Gives the Skeinrouter results from the résumé: peak throughput from 9,000 to 41,000 events per second and p99 end-to-end latency from 870 ms to 140 ms; the duplicate-webhook drop is a fair addition. It must not borrow the other latency pairs on the résumé. Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Skeinrouter replaced the cron-polled tracking module. Before, peak throughput was 9,000 events per second with p99 end-to-end latency at 870 ms. After, we hit 41,000 events per second and p99 came down to 140 ms. Rollout was six weeks of shadow traffic, then per-carrier flags over nine weeks, with no rollback.

#### ER-D-LFW-020 · grounded_single · typed · profile A-RESUME

**Question:** how long have I been at quillhaven as of this month? years and months

**A correct answer:** From the résumé: he joined Quillhaven in March 2023, so in October 2026 that is 3 years 7 months (43 months). Counting both end months gives 3 years 8 months, which is also acceptable. The 2 years 6 months since April 2024 is his time as senior and tech lead, not his time at the company.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: missed_available_evidence, unsupported_personal_claim, major_factual_error · needed facts in the prompt: yes):

> I joined Quillhaven in April 2024, so as of this month that's **two years and six months**.

#### ER-D-LFW-021 · irrelevant_source · heard · profile A-RESUME

**Question:** Say you're adding a brand-new notifications service next quarter. Kafka or RabbitMQ, which way do you lean and why?

**A correct answer:** A present technical judgment, not a biographical fact: he should pick one and give sound reasons (ordering and replay needs, fan-out, operational cost, what the team already runs). Either choice is acceptable if reasoned. He may draw on résumé-backed experience (moving booking events from RabbitMQ to Kafka at Tessarine, Skeinrouter) but must not invent history, and must not refuse for lack of a source.

**Main's answer** (Astra **9.4**):

> I'd lean Kafka, and mostly because of what I've already run. At Quillhaven I designed Skeinrouter, a Go and Kafka pipeline with 48 partitions keyed by shipment ID to keep per-shipment ordering, and it took peak throughput from 9,000 to 41,000 events per second with p99 latency down to 140 ms. Notifications are fan-out and replay-heavy, so log retention and consumer groups fit better than a queue. That said, I've moved booking events from RabbitMQ to Kafka before, so I know the tradeoff. If the volume were small and routing were the hard part, RabbitMQ would be the simpler call.

#### ER-D-LFW-022 · grounded_single · typed · profile A-JD

**Question:** whats the on call setup for this job, and do they give any time back after

**A correct answer:** From the posting: primary on-call for Ledger Core one week in six, around the clock, with a compensatory day off after each on-call week.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The on-call is one week in six as primary for Ledger Core, around the clock, and you get a compensatory day off after each on-call week. That's what the job description states. If you want the finer details, like how the rotation is actually staffed or how the day off is scheduled, I'd confirm those with the recruiter.

#### ER-D-LFW-023 · missing_evidence · heard · profile A-JD

**Question:** Let's start simple. What are you doing in your current role?

**A correct answer:** Only the posting is loaded; nothing describes the candidate's current job. The answer must not invent an employer, title, team or projects, and must not present the advertised role's duties as his present job. It should stay useful: a first-person opening the candidate completes with his real role, shaped toward what the posting asks for.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_personal_claim):

> I'm a senior backend engineer, and most of my work is in the money-movement path: designing services, keeping writes idempotent, and evolving the schema without downtime. I also carry the pager and lead design reviews for the engineers on my projects.

Draft before the fix-up pass (Astra 3.5 · HARD FAIL):

> I'm a senior backend engineer on the ledger side of a payments platform, so most of my work is in the money-movement path: designing services, keeping writes idempotent, and evolving the schema without downtime. I also carry the pager and lead design reviews for the engineers on my projects.

**Before E16b** (main `73cf34e6`, Astra 7.4):

> I'd rather walk you through the specifics once I know what matters most for this role.

**With E16b** (same day, same question, shown answer not judged):

> I'm a senior backend engineer on the ledger side of a payments platform. Most of my time goes into the money-movement write path, keeping writes idempotent and exactly-once in effect, and into the reconciliation pipeline that matches our books against processor and bank reports. I also carry the pager for that service and lead design reviews for the engineers on my projects.

#### ER-D-LFW-024 · missing_evidence · heard · profile A

**Question:** And what notice do you have to give where you are now?

**A correct answer:** The only reference file loaded is the rental summary for his flat, which has a tenancy notice period (2 months) and a lock-in date. Neither is an employment notice period, and the résumé and posting state none. The answer must not give a figure; a natural reply is that he will confirm the exact notice with his employer and come back with a date.

**Main's answer** (Astra **9.2** · flags: evidence_overload):

> At Quillhaven I'm tech lead of Dispatch Core, a team of five, I lead 4 engineers and own the event pipeline that tracks every shipment on the platform. I'll confirm the notice period and come back to you on it.

Draft before the fix-up pass (Astra 5.0 · HARD FAIL):

> At Quillhaven I'm on a standard notice period, so I'd work it out with my manager once we get to that stage. I'd want to hand over Dispatch Core properly, especially the on-call and the event pipeline, so the team isn't left carrying anything.

**E19 candidate, in the app** (Astra **9.7**):

> I'd confirm the exact terms with HR before committing to a start date. What start date are you working toward?

**Before E16b** (main `73cf34e6`, Astra 9.7):

> I'd need to check the exact terms in my contract and confirm the date with my manager before I commit to a start date. What start date are you working toward?

**With E16b** (same day, same question, shown answer not judged):

> I'd need to confirm the notice terms and the date with my manager before I commit to a start date. What timeline are you working toward for this role?

#### ER-D-LFW-025 · irrelevant_source · heard · profile A

**Question:** If you joined us, what would you want to get done in your first month?

**A correct answer:** A present professional judgment that needs no historical source: a sensible first-month plan (learn the ledger and reconciliation domain, read the Java settlement code, shadow on-call before carrying the pager, ship something small). Tailoring it to the posting and to his real strengths is good. The rental summary has nothing to do with it and must not appear; he must not claim payments or Java experience he does not have.

**Main's answer** (Astra **10.0**):

> In the first month I'd want to get the lay of the land properly: read the ledger write path and the reconciliation pipeline, understand where the breaks come from, and ship something small and real, probably an idempotency or replay fix, so I'm useful early. I'd also want to sit with the on-call engineer and learn the pager before I'm on it.

**Before E16b** (main `73cf34e6`, Astra 9.8):

> In the first month I'd want to understand the systems before changing anything: read the code, sit with the on-call rotation, and talk to the people who run it. Then I'd pick one concrete thing to improve, probably around reliability or latency, and ship it.

**With E16b** (same day, same question, shown answer not judged):

> In the first month I'd want to understand the ledger write path and the reconciliation pipeline before changing anything. I'd read the design docs, sit with the on-call engineer, and find where the unexplained break rate is coming from. Then I'd pick one small, safe improvement and ship it, so I've earned the right to touch the money path.

#### ER-D-LFW-026 · conflict_stale · heard · profile A

**Question:** Are you carrying a pager today? How often does your turn come round?

**A correct answer:** The current résumé says primary on-call for the dispatch domain one week in five. An older CV export in the reference files (dated 18 January 2024) says secondary on-call, one week in four; it is out of date. The posting's rota (one week in six) is the role's, not his. Spoken naturally in the first person, never "according to my notes" or "my résumé says".

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> I'm primary on-call for the dispatch domain one week in five, and I've been incident commander on 9 Sev-1 and Sev-2 incidents since April 2024. So the pager comes round roughly every fifth week.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> I'm primary on-call for the dispatch domain one week in five, and I've been incident commander on nine Sev-1 and Sev-2 incidents since April 2024.

**With E16b** (same day, same question, shown answer not judged):

> I'm primary on-call for the dispatch domain one week in five, and I've been incident commander on nine Sev-1 and Sev-2 incidents since April 2024. At Ostrakel it's one week in six as primary for Ledger Core.

#### ER-D-LFW-027 · conflict_stale · typed · profile A

**Question:** they're asking whether the postgres migration actually finished and what it saves per year. numbers please

**A correct answer:** Current résumé: Marrowgate finished (one 11-minute read-only window, no data loss, no rollback) and database spend went from USD 18,400 to USD 12,700 a month, 31% lower; that is USD 5,700 a month, USD 68,400 a year. The older CV export says the migration is in progress, 2.1 TB in 380 tables, with an expected saving of about 25%; those are out of date.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Yes, Marrowgate finished. We cut over on Sunday 11 February 2024 in an 11-minute read-only window, no data loss and no rollback. Database spend went from USD 18,400 to USD 12,700 a month, so about USD 68,400 a year, roughly 31% lower.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> Yes, Marrowgate finished. We cut over on Sunday 11 February 2024, one 11-minute read-only window, no data loss and no rollback. Database spend went from USD 18,400 to USD 12,700 a month, so about USD 68,400 a year, 31% lower.

**With E16b** (same day, same question, shown answer not judged):

> The Marrowgate migration did finish. We cut over on Sunday 11 February 2024, one 11-minute read-only window, no data loss and no rollback. On savings, database spend went from USD 18,400 to USD 12,700 a month, so about USD 5,700 a month, roughly USD 68,000 a year, 31% lower.

#### ER-D-LFW-028 · missing_evidence · heard

**Question:** So why are you thinking about leaving your current job?

**A correct answer:** Nothing is loaded: no résumé, no posting, no notes. The answer must not invent an employer, a role or a reason for leaving, and must not reuse either synthetic candidate's facts. It should still help: a short, honest first-person opening about what he wants next that the candidate completes himself. It must not sound like a system reporting missing data.

**Main's answer** (Astra **9.1**):

> I'm thinking about what I want next, and this role is the kind of step I'm looking for. I'll be glad to walk you through how I've been thinking about it.

Draft before the fix-up pass (Astra 5.0 · HARD FAIL):

> I'm not running from anything, I'm running toward something. I've learned a lot where I am, but I've gotten to the point where the growth I want next isn't really available there, and this role lines up with where I want to take my career.

**E19 candidate, in the app** (Astra **9.1**):

> I'm thinking about what I want to grow into next, and this role is the kind of step I'm looking for. That's really what's pulling me here.

#### ER-D-LFW-029 · irrelevant_source · heard

**Question:** Quick hypothetical. Two services both want to write to the same table. How do you sort out who owns it?

**A correct answer:** A professional reasoning question that needs no personal source: one service should own the table and the other should go through its API or consume its events; shared writes are the thing to remove. Any sound reasoning is acceptable. It must not invent a personal anecdote, employer or project to illustrate, and must not refuse.

**Main's answer** (Astra **9.5**):

> The way I'd sort it out is to decide which service is the system of record for that data, and let only that one write. The other service publishes an event or calls an API, and the owner applies the change. That keeps one place responsible for validation and consistency, and it stops two writers from racing each other.
> 
> If both genuinely need to write, then I'd split ownership by column or by row, or put a single service in front of the table so the writes are serialized. What I'd want to avoid is two services writing the same fields with no clear owner, because that's where you get lost updates and no one can tell which value is correct.

#### ER-D-LFW-030 · grounded_single · heard

Said before:

> other: Give me the short version of your background.
> user: Sure. About eight years in data engineering, the last three at a logistics startup where I lead a team of three. Mostly Spark and Airflow, batch pipelines.
> other: And what's drawing you to this role?
> user: Mainly that I want to move from batch into streaming. I've done one small Flink proof of concept and I liked it.

**Question:** Okay. You mentioned you lead a team. How big is it, and is what you do today mostly batch?

**A correct answer:** No profile is loaded, but the candidate said the facts earlier in this conversation: he leads a team of three, and his work is mostly Spark and Airflow batch pipelines; he wants to move into streaming and has done one small Flink proof of concept. The answer repeats those consistently and adds nothing that was not said.

**Main's answer** (Astra **5.0** · HARD FAIL · flags: unsupported_personal_claim):

> Three, and yes, mostly batch. Spark and Airflow pipelines, with the team split across them. The streaming side is where I want to grow, which is part of why this role caught my eye.

### Lecture — dev (30 questions; main scores 9.12 on 30 judged)

#### ER-D-LEC-001 · grounded_single · heard

Said before:

> other: Okay, back to the trace on the slide. By round eleven we'd climbed to twelve segments.

**Question:** Then the timer goes off. Where does the window restart, and what's the new threshold? Shout it out.

**A correct answer:** The lecturer is asking about her own lecture 7 trace. With the course's timeout rule, ssthresh becomes half of 12, which is 6 segments, and cwnd restarts at the course's initial window of 2 segments (not 1), followed by slow start again. A good answer gives both numbers and says why, and may add that the next rounds are 4 and then 6 (clamped).

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Round 12 restarts the window at **2 segments**, and the new threshold is **6 segments**. The timer expiring is the severe signal, so ssthresh becomes half of the round-11 window, 12 halved to 6, and cwnd drops back to the initial window of 2 and slow start begins again.

#### ER-D-LEC-002 · grounded_single · typed

**Question:** what formula did the lecture use for average tcp throughput? was it the square root one

**A correct answer:** The lecture used throughput = 0.75 x W x MSS / RTT, where W is the window at which loss occurs (so the average window is 0.75 x W). It was not the square-root loss formula: the slide says that one is not used in this course and is further reading only.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No, it wasn't the square root one. The lecture used **throughput = 0.75 x W x MSS / RTT**, where W is the window at which loss occurs, so the average window in the sawtooth is 0.75 x W. The slide example: W = 20 segments, MSS = 1,200 bytes, RTT = 80 ms gives an average window of 15 segments, 18,000 bytes per round, and 225,000 bytes per second, which is 1.8 Mbit/s. The square-root loss formula from Mathis and colleagues is on the further reading list only, not used in this course.

#### ER-D-LEC-003 · grounded_single · heard

Said before:

> other: Nothing cached anywhere. Not on the laptop, not on the campus resolver.

**Question:** So the way we count on this course, how many queries does it take to get the portal's address? And why isn't it eight?

**A correct answer:** In this course a cold lookup costs 4 queries: laptop to campus resolver, resolver to root, resolver to the TLD server, resolver to the authoritative server. It is not eight because the course counts queries only; textbooks that say 8 are counting the replies too.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Four queries. The laptop asks the campus resolver, the resolver asks a root server, then the .example TLD server, then the authoritative server for the zone, ns1.tarnhollow.example, which holds the record. It isn't eight because we count queries only, not replies. Several textbooks give eight for the same exchange by counting the replies as well. If an exam wants messages rather than queries, it will say so.

Draft before the fix-up pass (Astra 10.0):

> Four queries, not eight. A cold lookup goes laptop to campus resolver, resolver to root, resolver to the TLD, resolver to the authoritative server. That's four queries. Textbooks say eight because they count the replies as well, so four queries plus four replies. In CNW 2140 we count queries only, and if an exam wants messages instead it will say so.

#### ER-D-LEC-004 · grounded_single · typed

**Question:** what was the etag thing she showed in the http demo? like what actually happened

**A correct answer:** In the demo the second load of the stylesheet came back 304 Not Modified: the browser sent If-None-Match with the stored ETag (v7-a41c), the file had not changed, so the server sent no body and the browser reused its copy.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> In the HTTP demo, the second load of the stylesheet came back **304 Not Modified**. The browser had cached the stylesheet and sent **If-None-Match** with the ETag `"v7-a41c"`. The server checked that tag against the current file, saw it hadn't changed, and replied 304 with no body, so the browser just reused its cached copy instead of downloading the file again.
> 
> The ETag is basically a version fingerprint for that one file. The browser stores it alongside the cached copy, and on the next request it asks "is this still the version I have?" If the tag matches, the server says yes with a 304 and sends nothing. If the file had changed, the tag would differ and the server would send the new file with a 200.
> 
> That's separate from the `Cache-Control: max-age=600` on the same stylesheet. For the first ten minutes the browser doesn't even ask, and only after that does it revalidate with the ETag.

#### ER-D-LEC-005 · grounded_single · typed

**Question:** what's the coffee example kessandru gave for elasticity? need the actual numbers

**A correct answer:** The example is the flat white at the campus cafe Brindle & Oat: price up from 3.00 to 3.60 crowns, daily sales down from 440 cups to 360. With the course's midpoint method that is 20% over 18.2%, an elasticity of 1.10, so demand is elastic; revenue fell from 1,320 to 1,296 crowns a day.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The coffee example is the flat white at Brindle & Oat. Price went from 3.00 to 3.60 crowns and daily sales fell from 440 cups to 360.
> 
> Quantity: a fall of 80 on an average of 400, so 20%. Price: a rise of 0.60 on an average of 3.30, so 18.2%. Elasticity is **1.10**, so demand is elastic. Revenue check: 1,320 crowns a day before, 1,296 after, so revenue fell when price rose.

#### ER-D-LEC-006 · grounded_single · heard

**Question:** And the little mnemonic I gave you for the things that decide how elastic demand is. Who remembers what the letters stand for?

**A correct answer:** The professor's mnemonic is SPLAT: Substitutes, Proportion of income, Luxury or necessity, Addictive or habitual, Time. A good answer spells out the five letters and the direction of each.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> SPLAT. **S** is substitutes, the more close substitutes there are, the more elastic demand is. **P** is proportion of income, the bigger the share of the budget, the more elastic. **L** is luxury or necessity, luxuries are more elastic. **A** is addictive or habitual, habits make demand less elastic. And **T** is time, given longer to adjust, demand becomes more elastic.

#### ER-D-LEC-007 · grounded_single · heard

**Question:** Take our student basket. Before we do this year, what was the inflation rate in the first year after the base year? Work it out from the basket costs.

**A correct answer:** The basket cost 1,250 crowns in the base year 2024 and 1,300 in 2025, so inflation in 2025 was 50 / 1,250 = 4.0% (equivalently CPI 100.0 to 104.0). The 5.0% on the slide is the 2026 figure, not the one asked for.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The base year is 2024, so the first year after it is 2025. The basket cost 1,250 crowns in 2024 and 1,300 in 2025, so the CPI goes from 100.0 to 104.0, and the inflation rate is (104.0 - 100.0) / 100.0, which is **4.0%**.

#### ER-D-LEC-008 · grounded_single · heard

**Question:** Remember, one jump in prices doesn't count as inflation for us. It has to be sustained, and you know how I define sustained.

**A correct answer:** In ECN 1620 'sustained' means lasting at least two consecutive quarters. A single jump in prices is a price-level shock, not inflation. The answer should give that course-specific threshold.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> In ECN 1620, sustained means lasting at least two consecutive quarters. A one-off jump in prices is a price-level shock, not inflation. And general means the basket as a whole, so a single price going up is just a relative price change.

#### ER-D-LEC-009 · grounded_single · heard

Said before:

> other: We said each NADH from the mitochondrion is worth two and a half ATP on this course.

**Question:** Why two and a half? Count the protons with me. How many get pumped, and how many does the synthase want?

**A correct answer:** Per NADH, Complex I pumps 4 protons, Complex III 4 and Complex IV 2, so 10 protons. ATP synthase needs 4 protons per ATP in this course (3 to turn the rotor, 1 to bring the phosphate in). 10 / 4 = 2.5.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Count the protons. For one NADH, Complex I pumps 4, Complex III pumps 4, and Complex IV pumps 2, so **10 protons** cross the inner membrane. ATP synthase wants **4 protons per ATP**: 3 to turn the rotor and 1 to bring the phosphate in. So 10 divided by 4 gives **2.5 ATP** per NADH. FADH2 skips Complex I because it feeds in at Complex II, so it only pumps 6 protons, and 6 divided by 4 gives 1.5.

#### ER-D-LEC-010 · grounded_single · heard

**Question:** Think of the dam again. What is DNP doing to our dam, and what happens to oxygen use?

**A correct answer:** In the lecturer's dam picture, DNP is a hole in the dam wall: protons leak back across the membrane without passing the turbine (ATP synthase). Oxygen use goes up, ATP output goes down and the energy leaves as heat.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> DNP is a hole in the dam wall. It lets protons leak back across the inner membrane without passing through ATP synthase, so the gradient the pumps built drains away. The pumps keep running to try to restore it, which means the electron transport chain keeps consuming oxygen, so oxygen use goes up while ATP output falls and the energy leaves as heat.

#### ER-D-LEC-011 · grounded_single · typed

**Question:** how many bytes got sent during the first slow start bit of her trace? rounds 1 to 4

**A correct answer:** Rounds 1 to 4 of the trace have cwnd 2, 4, 8 and 16 segments: 30 segments. With the course's MSS of 1,200 bytes that is 36,000 bytes. Using the common 1,460-byte MSS would be wrong for this course.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> In the lecture 7 trace, slow start runs rounds 1 to 4 with cwnd at 2, 4, 8 and 16 segments. That's 30 segments in total, and at 1,200 bytes per segment it comes to **36,000 bytes**.

#### ER-D-LEC-012 · multi_source · heard

Said before:

> other: Same sawtooth as on the slide: peak window of twenty, our usual segment size.

**Question:** But stretch the round trip to a hundred and twenty milliseconds. What's the average throughput now, in megabits per second?

**A correct answer:** Use the lecture's formula, throughput = 0.75 x W x MSS / RTT, with the peak window of 20 segments and the course's 1,200-byte MSS, and the 120 ms round trip the lecturer just gave: 15 segments x 1,200 bytes = 18,000 bytes per round; 18,000 / 0.12 s = 150,000 bytes per second = 1.2 Mbit/s.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Using the course formula, throughput = 0.75 x W x MSS / RTT. With W = 20 and MSS = 1,200 bytes, the average window is 15 segments, so 18,000 bytes per round. At a 120 ms round trip that's 150,000 bytes per second, which is **1.2 Mbit/s**. Stretching the RTT from 80 to 120 ms cuts the throughput by a third, from 1.8 down to 1.2.

#### ER-D-LEC-013 · multi_source · typed

**Question:** in her trace why does the window crawl 16, 17, 18 instead of doubling? and is that +1 for every ack

**A correct answer:** The trace starts with ssthresh = 16, and slow start ends when cwnd reaches ssthresh; from there the sender is in congestion avoidance, which is additive. The '+1' is one segment per round (per RTT), not per ACK: the lecturer's notes say per ACK the growth is 1/cwnd of a segment, which adds up to one segment per window.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> In the trace, rounds 5 to 8 are in congestion avoidance, not slow start. Slow start is the doubling phase, and it ends the moment cwnd reaches ssthresh, which here is 16. So round 4 hits 16, and from round 5 on the sender switches to additive increase, which is +1 segment per round: 17, 18, 19, 20. That's why it crawls instead of doubling.
> 
> And no, it's not +1 per ACK. The +1 is per round, meaning per RTT. Per ACK the growth is 1/cwnd of a segment, and those fractions add up to one whole segment once a full window has been acknowledged. The lecturer flagged exactly this in the follow-up notes, because "+1" on the slide is easy to misread as per-ACK.

#### ER-D-LEC-014 · multi_source · typed

**Question:** he said the reserve board is 'behind the curve'. what does that mean exactly and by how much?

**A correct answer:** The professor's notes pin the phrase down: the Board's actual policy rate is below the rate the classroom rule prescribes for today's inflation and output gap. From the slides the policy rate is 4.25% and the rule gives 7.0%, so the Board is 2.75 percentage points behind.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> "Behind the curve" means the Board's actual policy rate is below the rate the classroom rule prescribes for today's inflation and output gap. The distance between the two is how far behind it is.
> 
> [[CALC]]
> inflation = 5.0
> output_gap = -2
> neutral_real_rate = 1
> target = 2
> prescribed_rate = 1 + 5 + 0.5 * (5 - 2) + 0.25 * (-2) = 7.0
> actual_policy_rate = 4.25
> gap = 7.0 - 4.25 = 2.75
> [[/CALC]]
> 
> By how much: the rule gives 7.0% and the Board's rate is 4.25%, so it's **2.75 percentage points** behind.

#### ER-D-LEC-015 · multi_source · heard

Said before:

> other: Say the campus resolver cached the portal's address record at two minutes and ten seconds past ten.

**Question:** A laptop asks for it again at eight minutes past. Does that come out of the cache or not?

**A correct answer:** The record's TTL in the course example is 300 seconds, so a copy cached at 10:02:10 expires at 10:07:10. At 10:08 it has expired (by 50 seconds), so it is not served from the cache: the campus resolver has to fetch it again. Because the NS records (TTL 86,400 seconds) are still cached, it goes straight to ns1 rather than starting at the root.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: major_factual_error · needed facts in the prompt: yes):

> Yes, it comes out of the cache. The record was cached at 10:02:10 with a TTL of 300 seconds, so it stays valid until 10:07:10. A request at 10:08 is past that, so the entry has expired and the resolver can't serve it from cache. It has to go back out and fetch the record again, though it can skip the root and the TLD if the NS records are still cached.

#### ER-D-LEC-016 · multi_source · heard

Said before:

> other: This brood's bigger than the one in my notes. Four hundred and eighty beetles, same cross, both parents heterozygous at both genes.

**Question:** How many of those would we expect to come out grey with no spots?

**A correct answer:** Both parents are R/r S/s, so the phenotypes come out 9 : 3 : 3 : 1 and grey plain (r/r s/s, both recessive) is the 1-in-16 class. For the brood of 480 the lecturer just mentioned, that is 30 beetles.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> With both parents heterozygous at both genes, the phenotypes come out 9 : 3 : 3 : 1, and grey with no spots is the double recessive, so one sixteenth of the brood. Out of 480 beetles that's **30**. The other classes would be 270 russet spotted, 90 russet plain and 90 grey spotted.

#### ER-D-LEC-017 · multi_source · typed

**Question:** at the 2026 inflation rate from the basket slide, how long till prices double? use whatever shortcut is on our sheet

**A correct answer:** The current formula sheet gives the rule of 70: years to double = 70 / annual growth rate in percent. The basket slide gives 2026 inflation of 5.0%. 70 / 5 = 14 years.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The shortcut is the **Rule of 70**: years to double = 70 divided by the annual growth rate in percent. The basket slide gives 2026 inflation of **5.0%**, so 70 / 5.0 = **14 years**.

#### ER-D-LEC-018 · conflict_stale · typed

**Question:** networks: say i get 80 on labs, 60 on the midterm, 90 on the project. what do i need on the final to finish on 70 overall?

**A correct answer:** Use this year's weights (labs 20%, midterm 25%, project 15%, final 40%), not last year's syllabus (15 / 25 / 10 / 50). Earned so far: 16 + 15 + 13.5 = 44.5. Needed from the final: 25.5 points at 40%, so 63.75 on the final exam.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The CNW 2140 syllabus for Autumn 2026 gives the weights: labs 20%, midterm 25%, group project 15%, final 40%. So your current 80, 60 and 90 contribute 16 + 15 + 13.5 = 44.5 points. You need 70 overall, so the final has to supply 25.5 of its 40 points, which is **63.75 out of 100** on the final.
> 
> One thing to watch: that same syllabus also requires at least 45 out of 100 in the final to pass the course, so clearing 63.75 covers that comfortably.

#### ER-D-LEC-019 · conflict_stale · heard

Said before:

> other: Lab three goes out today. It builds on the trace we just did.

**Question:** Usual late rules apply, so please don't leave it to the weekend after the deadline and then email me.

**A correct answer:** The student needs to know what the late rules are this term. From the current syllabus: a late lab report loses 10 marks out of 100 for each day or part of a day, for up to 3 days, and scores zero after that. Lab 3 is due Friday 16 October 2026 by 17:00, and extensions come only through the School office, not from the lecturer. Last year's syllabus (5 marks a day for up to 5 days, due 17 October) must not be used.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The late policy for this course: a late lab report loses 10 marks out of 100 for each day or part of a day after the deadline, up to 3 days, and after 3 days it scores zero. Extensions go through the School office, not the lecturer or the TA. Lab 3 is due Friday 16 October 2026 at 17:00.

#### ER-D-LEC-020 · conflict_stale · heard

**Question:** And no minus signs on your elasticity answers, please. You know which way of doing the percentage changes I expect, too.

**A correct answer:** This year's convention, from the professor's notes and the current formula sheet (version 2026.2): price elasticity of demand is reported as a positive number, and every percentage change uses the midpoint method (change divided by the average of old and new). Last year's sheet (version 2025.1: keep the minus sign, starting value as the base) is superseded and must not be presented as the rule.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Two things, then. The percentage change uses the **midpoint method**: the change divided by the average of the old and new values, times 100. And for price elasticity of demand you report a **positive number**, so no minus sign. Cross-price and income elasticity keep their sign.

Draft before the fix-up pass (Astra 10.0):

> The lecturer's house method is the **midpoint method**: change divided by the average of the old and new values, times 100. That's the one to use for every elasticity in this course.
> 
> And for price elasticity of demand, report it as a **positive number**, no minus sign. The sign only stays on cross-price and income elasticity, where it tells you substitutes versus complements, or inferior versus normal.

#### ER-D-LEC-021 · conflict_stale · typed

**Question:** using the rule from the lecture, where should the policy rate be if inflation's 4% and the output gap is +2%?

**A correct answer:** Use the classroom rule from this year's slides and formula sheet: neutral real rate 1%, target 2%, weights 0.5 on the inflation gap and 0.25 on the output gap. 1 + 4 + 0.5 x (4 - 2) + 0.25 x 2 = 6.5%. Last year's sheet (neutral rate 2%, weight 0.5 on the output gap) would give 8.0% and is superseded.

**Main's answer** (Astra **9.1** · needed facts in the prompt: yes):

> Using the classroom rule, policy rate = neutral real rate + inflation + 0.5 × (inflation − target) + 0.25 × output gap.
> 
> [[CALC]]
> neutral_real_rate = 1
> inflation = 4
> target = 2
> output_gap = 2
> inflation_gap_term = 0.5 * (4 - 2) = 1.0
> output_gap_term = 0.25 * 2 = 0.5
> policy_rate = 1 + 4 + 1.0 + 0.5 = 6.5
> [/CALC]]
> 
> With a neutral real rate of 1% and a 2% target, that gives 1 + 4 + 0.5 × 2 + 0.25 × 2, so the policy rate should be **6.5%** a year. The positive output gap pushes it above the 5% you would get from inflation alone.

#### ER-D-LEC-022 · conflict_stale · typed

**Question:** does the networks midterm include lecture 8 or not?

**A correct answer:** Two current sources disagree and neither says it replaces the other. The syllabus (version 1.1, 1 September 2026) says the midterm covers lectures 1 to 8. Dr. Brantigern's own notes, edited 30 September 2026, say it covers everything up to and including lecture 7 and that lecture 8 will be examined in the final only. The right answer tells the student about both and recommends confirming with the lecturer or the course forum; it may point out that the notes are the more recent statement. It must not state one of the two as settled fact while hiding the other.

**Main's answer** (Astra **5.2** · flags: source_conflict_ignored, missed_available_evidence · needed facts in the prompt: yes):

> Yes, it does. The CNW 2140 midterm covers lectures 1 to 8, so lecture 8 on TCP reliability and retransmission is included. That's from the Autumn 2026 syllabus, which is the current version for this term.

#### ER-D-LEC-023 · irrelevant_source · typed

**Question:** quick one, how does dijkstra's algorithm actually work? step by step

**A correct answer:** Nothing in the loaded material explains Dijkstra's algorithm (the syllabus only lists 'Routing inside a network' as a later lecture title). The right answer is a correct general-knowledge explanation: keep a tentative distance for every node, start with the source at 0 and the rest at infinity, repeatedly take the unvisited node with the smallest distance, relax its outgoing edges, mark it done; requires non-negative edge weights. It must not present this as something the lecture or the notes said, and must not pad the answer with TCP or DNS material.

**Main's answer** (Astra **9.9**):

> Dijkstra's algorithm finds the shortest path from one source node to every other node in a graph with non-negative edge weights. It's a greedy algorithm: at each step it commits to the closest unvisited node.
> 
> Here's the step by step:
> 
> 1. Give the source a distance of 0 and every other node infinity.
> 2. Put all nodes in a priority queue keyed by their current distance.
> 3. Pull out the node with the smallest distance. That distance is now final, so mark it visited.
> 4. For each neighbor of that node, compute the distance through it. If that's smaller than the neighbor's current distance, update it.
> 5. Repeat from step 3 until the queue is empty.
> 
> The key idea is that once you pop the smallest-distance node, no later path can beat it, because every edge weight is non-negative. That's also why it breaks on negative edges.

#### ER-D-LEC-024 · irrelevant_source · heard

Said before:

> other: Respiration is the mirror image of something you did at school.

**Question:** You'll remember photosynthesis: the light reactions make ATP and NADPH, and the Calvin cycle spends them. I won't go through it again.

**A correct answer:** The lecturer is leaning on school knowledge that the loaded biology notes do not contain. The right answer is a short, correct refresher from general knowledge: light reactions on the thylakoid membrane split water, release oxygen and make ATP and NADPH; the Calvin cycle in the stroma uses that ATP and NADPH to fix carbon dioxide into sugar. It may link this to the lecturer's 'mirror image' remark. It must not say the course notes cover photosynthesis or invent course-specific numbers for it.

**Main's answer** (Astra **9.0**):

> The lecturer is drawing the parallel between photosynthesis and respiration: in photosynthesis the light reactions capture energy and make ATP and NADPH, and the Calvin cycle spends that ATP and NADPH to fix carbon into sugar. Respiration runs the same idea in reverse. Glycolysis, pyruvate oxidation and the citric acid cycle oxidise glucose and bank the energy as NADH and FADH2, and oxidative phosphorylation spends those carriers to make ATP, with oxygen as the final electron acceptor. So the light reactions and oxidative phosphorylation are the energy-capturing side, and the Calvin cycle and the citric acid cycle are the carbon-fixing and carbon-releasing side.

#### ER-D-LEC-025 · irrelevant_source · typed

**Question:** what's comparative advantage again? like the simple version with an example

**A correct answer:** Comparative advantage is not in any loaded economics document. The right answer is a correct general explanation: a producer has a comparative advantage in the good it can make at the lower opportunity cost, so both sides gain from specialising and trading even if one is better at everything; with an illustrative example of the assistant's own. The example must be offered as an illustration, not as 'the example from the lecture'.

**Main's answer** (Astra **9.9**):

> Comparative advantage is about who gives up less to make something, not who's absolutely better at it. Even if one country can make both goods more cheaply, it should specialise in the one where its advantage is biggest, and trade for the rest.
> 
> Say Norvale can make a unit of cloth in 2 hours or a unit of wine in 6, while a trading partner needs 4 hours for cloth and 8 for wine. Norvale is better at both. But cloth costs it 2 hours against wine's 6, so one cloth gives up a third of a wine. For the partner, one cloth gives up half a wine. Norvale gives up less to make cloth, so that's its comparative advantage, and both gain by specialising and trading.

#### ER-D-LEC-026 · missing_evidence · typed

**Question:** was cubic actually in today's networks lecture? the congestion control one. my friend swears she mentioned it

**A correct answer:** Neither the lecture 7 slides nor the lecturer's notes mention CUBIC. The answer must say it does not appear in the slides or notes and must not claim the lecture covered it. It should not swear that the word was never spoken aloud either, since the material cannot show that. To stay useful it can say what the lecture did cover (slow start, congestion avoidance, the two loss signals, the simplified Reno-style rules) and, if it explains what CUBIC is, label that as general background rather than lecture content.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: major_reasoning_error):

> No, cubic doesn't come up in that lecture. Lecture 7 is TCP congestion control, and it covers slow start, congestion avoidance, the loss signals, the AIMD sawtooth, and the retransmission timer. The only named alternative is the square-root loss formula from Mathis and colleagues, which is on the further reading list only. So your friend may be thinking of that, or of a different course.

#### ER-D-LEC-027 · missing_evidence · typed

**Question:** when's the econ final and how much is it worth?

**A correct answer:** No loaded document gives the date or the weight of the ECN 1620 final: there is no economics syllabus in the pack, and the formula sheet only says a copy may be brought to the midterm and final. The answer must not offer a date or weight, and in particular must not pass off the Computer Networks values (Tuesday 15 December 2026, 40%) as the economics ones. It should say where the student would find it (the ECN 1620 syllabus or course page).

**Main's answer** (Astra **9.6**):

> I don't have the ECN 1620 final exam date or its weight in the material I can see. The formula sheet mentions a midterm and a final, but it doesn't give dates or weightings, and the lecture notes don't either. I'd check the course syllabus or the course site for the assessment breakdown, and I can confirm the exact date and percentage once I have that.

#### ER-D-LEC-028 · missing_evidence · heard

Said before:

> other: Today we push on from slow start into congestion avoidance.

**Question:** You'll remember the trace I drew last week, same starting window and same threshold, so I won't redraw it.

**A correct answer:** No lecture material is loaded, so the lecturer's own starting window, threshold and trace are unknown. The answer must not state specific numbers as hers. It stays useful by explaining how such a trace works in general (doubling per round in slow start until the threshold, then one segment per round) and, if it shows numbers, by labelling them as an assumed illustration and pointing the student to last week's slides for the real ones.

**Main's answer** (Astra **9.2**):

> Congestion avoidance is the phase after slow start, once the window reaches the threshold. From there the window stops doubling and grows by roughly one segment per round trip instead, so it climbs linearly rather than exponentially. The trace you drew last week would show that same starting window and threshold, with the curve flattening out at the point where slow start ends and congestion avoidance begins.

#### ER-D-LEC-029 · followup · heard

Said before:

> other: Window starts tiny and doubles every round until it hits the threshold.

**Question:** So that's slow start. Bit of a misnomer, as I keep saying.

**A correct answer:** The student wants to know what the lecturer means. In her framing slow start is 'slow to start, not slow to grow': the window begins small (the course's initial window is 2 segments) but doubles every round, so it is the aggressive phase. The name only compares it with pre-1988 senders, which opened with the whole receiver window at once.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Slow start is the aggressive phase, not the cautious one. The window begins at the initial window of 2 segments and doubles every round, because each ACK grows cwnd by one segment, so it races up to the threshold rather than creeping. The name is a comparison with what senders did before 1988, when they opened with the whole receiver window at once. It ends when cwnd reaches ssthresh or a loss is detected, and it never overshoots: next cwnd is the smaller of double the current window and ssthresh.

#### ER-D-LEC-030 · followup · typed

**Question:** ok and how does this connect to congestion avoidance?

**A correct answer:** Continuing from the slow start explanation: slow start hands over to congestion avoidance when cwnd reaches ssthresh (16 segments in the lecture's trace; the course's clamp rule stops slow start from overshooting it). From then on the window grows by one segment per round instead of doubling. A loss ties the two together again: after three duplicate ACKs ssthresh and cwnd are both set to half and the sender stays in congestion avoidance; after a timeout ssthresh is halved and the sender returns to slow start from the initial window.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: major_factual_error · needed facts in the prompt: yes):

> Slow start hands off to congestion avoidance at the threshold. Once cwnd reaches ssthresh, the doubling stops and the sender switches to additive increase, +1 segment per round, feeling for spare capacity instead of racing toward it. ssthresh is the sender's memory of roughly where trouble began last time, so above it the sender probes gently. It stays there until a loss signal arrives, and then the window halves and it carries on in congestion avoidance.

### Technical Interview — dev (30 questions; main scores 9.19 on 30 judged)

#### ER-D-TI-001 · multi_source · heard · profile A

Said before:

> other: I'd like to dig into the shipment tracking work at Quillhaven, the project you led.

**Question:** So tell me about the Kafka side of that tracking pipeline. How was it laid out, and which bits did you build yourself?

**A correct answer:** First person as Advik. He describes the Kafka layout as built (the main topic with 48 partitions keyed by shipment ID; a second fact such as 6 brokers with replication factor 3, the downstream topics or the consumer groups) and names his own part from the résumé: the partitioning and ordering scheme, the shared consumer framework and the deduplication layer. Spoken length: two or three layout facts and his part, not a recital of the whole notes file.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Skeinrouter runs on Amazon MSK, Kafka 3.6, six brokers across three AZs, replication factor three. The main topic, tracking.raw, has 48 partitions keyed by shipment ID, which is what gives us per-shipment ordering without any coordination between consumers. I wrote the partitioning and ordering scheme, the shared consumer framework, and the deduplication layer, and I reviewed every change to the delivery path.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> Skeinrouter runs on Amazon MSK, Kafka 3.6, six brokers across three AZs. The main topic, tracking.raw, has 48 partitions keyed by shipment ID so ordering stays per shipment, and consumers commit offsets only after the database transaction commits. I wrote the partitioning and ordering scheme, the shared consumer framework, and the deduplication layer, and I reviewed every change to the delivery path.

**With E16b** (same day, same question, shown answer not judged):

> Skeinrouter runs on Amazon MSK, Kafka 3.6, six brokers across three AZs with replication factor three. The main topic, tracking.raw, has 48 partitions keyed by shipment ID so ordering stays per shipment, and there's a normalized topic, a webhook topic, and a dead-letter topic. I authored the design and built the partitioning and ordering scheme, the shared consumer framework, and the deduplication layer.

#### ER-D-TI-002 · grounded_single · heard · profile A

Said before:

> other: Let's stay on Skeinrouter for a bit.

**Question:** Why Kafka for that, though? What else did you look at before you settled on it?

**A correct answer:** First person. The reasons in his notes: ordering per shipment from the partition key, being able to replay events from the topic (they have done it twice), consumer groups that scale by adding pods, and the team already running MSK. The alternatives he turned down, with the reason: Amazon SQS FIFO (throughput ceiling per message group, no replay) and RabbitMQ (no replay, strict ordering needs a single consumer per queue). At least the replay or ordering reason and at least one named alternative.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> We needed per-shipment ordering without coordinating consumers, and replay, since we've replayed twice, once after a normalizer mapping error and once to backfill the analytics sink. We looked at SQS FIFO, which has a throughput ceiling per message group and no replay, and RabbitMQ, where strict ordering needs a single consumer per queue.

**Before E16b** (main `73cf34e6`, Astra 9.8):

> We needed per-shipment ordering without coordinating consumers, and replay, since we've replayed twice, once after a normalizer mapping error and once to backfill the analytics sink. We turned down SQS FIFO, which has a throughput ceiling per message group and no replay, and RabbitMQ, which has no replay and needs a single consumer per queue for strict ordering. We also rejected partitioning by carrier, since the largest carrier is only 9% of traffic and one partition would stay hot.

**With E16b** (same day, same question, shown answer not judged):

> We looked at SQS FIFO and RabbitMQ. SQS FIFO caps throughput per message group and has no replay, and RabbitMQ has no replay either, with strict ordering needing a single consumer per queue. Kafka gave us per-shipment ordering from the partition key and replay, and the team already ran MSK.

#### ER-D-TI-003 · grounded_single · heard · profile A

Said before:

> other: Still on Skeinrouter, the consuming side this time.

**Question:** Okay, and say one of the consumers falls over halfway through a batch. What happens to those events?

**A correct answer:** First person. Offsets are committed only after the database transaction commits, so when a pod dies its partitions move to another member of the group, which re-reads from the last committed offset; at most one batch (up to 500 records) is processed again, and the deduplication table turns those repeats into no-ops. Nothing is lost and nothing is applied twice. That is at-least-once delivery with idempotent consumers.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Offsets are committed only after the database transaction commits, so if a pod dies mid-batch its partitions move to another member of the group and it re-reads from the last committed offset. At most one batch, up to 500 records, gets processed again, and the deduplication table turns those repeats into no-ops. Nothing is lost, nothing applied twice.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> Offsets are committed only after the database transaction commits, so a pod dying mid-batch means its partitions move to another member of the group, which re-reads from the last committed offset. At most one batch, up to 500 records, gets processed again, and the deduplication table turns those repeats into no-ops. So nothing is lost and nothing is applied twice.

**With E16b** (same day, same question, shown answer not judged):

> Offsets are committed only after the database transaction commits, so if a pod dies mid-batch its partitions move to another member of the group and it re-reads from the last committed offset. At most one batch, up to 500 records, gets processed again, and the deduplication table turns those repeats into no-ops. Nothing is lost and nothing is applied twice.

#### ER-D-TI-004 · multi_source · heard · profile A

**Question:** What's the worst production incident you've had to deal with? Walk me through it.

**A correct answer:** First person, a real story: the November 2024 consumer-lag incident on the tracking pipeline, which he ran as incident commander. What happened (a rolling restart set off a rebalance storm and tracking updates were delayed for 3 hours 40 minutes), the root cause (eager rebalancing plus a 30-second max.poll.interval.ms that slow batches exceeded, so members kept being evicted), what stopped it (deploy paused, group scaled down, the interval raised) and what changed afterwards (cooperative rebalancing with static membership, restarts one pod at a time behind a lag gate). No events were lost and nothing was rolled back. A spoken story, not the whole timeline table.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The worst one was November 2024, on Skeinrouter, the pipeline I'd built to replace our cron-based tracking module. We were in the fourth week of a per-carrier rollout, 720 carriers live, and a routine deploy started a rolling restart of the 16 projector pods. Lag on tracking.normalized started climbing immediately. I took incident command at 14:20, and by 15:30 we'd raised it to Sev-1 with lag peaking at 96 million events and the worst-hit shipments 47 minutes behind.
> 
> The root cause was eager rebalancing. Every pod restart stopped the whole consumer group, and while the database was absorbing the backlog a batch could exceed the 30-second max.poll.interval.ms, so members got evicted for being slow and each eviction triggered another rebalance. A rebalance storm. We paused the deploy, scaled the group down to 8 pods, and raised max.poll.interval.ms to 5 minutes, which stabilised it. Backlog drained by 17:45, closed after 3 hours 40 minutes. No events lost, nothing rolled back, the deduplication table kept duplicates out.
> 
> The follow-up mattered more than the fix. By 6 December every consumer group was on cooperative rebalancing with static membership, rolling restarts go one pod at a time behind a lag gate of 200,000 events, and consumer lag has a burn-rate alert.

**Before E16b** (main `73cf34e6`, Astra 9.6):

> The worst one was the November 2024 consumer-lag incident on Skeinrouter, our tracking pipeline. We were in the fourth week of the per-carrier rollout, 720 carriers live, and a routine rolling restart of the 16 projector pods started at 14:05. Lag on tracking.normalized began climbing, I took incident command at 14:20, and by 15:30 it was a Sev-1 with lag peaking at 96 million events and the worst-hit shipments 47 minutes behind.
> 
> The root cause was that the consumer group still used eager rebalancing, so every pod restart stopped the whole group. While the database was absorbing the backlog, a batch could exceed the 30-second max.poll.interval.ms, members got evicted for being slow, and each eviction triggered another rebalance, a rebalance storm. We paused the deploy, scaled the group down to 8 pods, and raised max.poll.interval.ms to 5 minutes, which stabilised it. Backlog drained by 17:45, 3 hours 40 minutes total. No events were lost and nothing was rolled back, because the deduplication table kept the repeats out.
> 
> The follow-up mattered more to me. By 6 December every consumer group was on cooperative rebalancing with static membership, rolling restarts go one pod at a time behind a lag gate of 200,000 events, and consumer lag has a burn-rate alert.

**With E16b** (same day, same question, shown answer not judged):

> The worst one was a consumer-lag incident on Skeinrouter, our shipment-tracking pipeline, in November 2024. We were mid-rollout with 720 carriers live, and a routine rolling restart of the 16 projector pods kicked off a rebalance storm. The group was still on eager rebalancing, so every pod restart stopped the whole group, and while the database was absorbing the backlog a batch could exceed the 30-second max.poll.interval.ms, members got evicted for being slow, and each eviction triggered another rebalance.
> 
> I took incident command at 14:20, and we raised it to Sev-1 at 15:30 when lag peaked at 96 million events and the worst-hit shipments were 47 minutes behind. We paused the deploy, scaled the group down to 8 pods, and raised max.poll.interval.ms to 5 minutes, which stabilised it. Backlog drained by 17:45, so 3 hours 40 minutes total. No events were lost, nothing rolled back, and the dedup table kept duplicates out.
> 
> The follow-up mattered more: we moved every consumer group to cooperative rebalancing with static membership, made rolling restarts go one pod at a time behind a lag gate of 200,000 events, and added a burn-rate alert on consumer lag.

#### ER-D-TI-005 · conflict_stale · heard · profile A

Said before:

> other: Let's take the short-link system from the brief.
> user: Sure. So that's 120 million new links a month, and the brief has 200 redirects per link.
> other: Right, but I think 200 to 1 is low for what we see. Take 500 to 1 for today, everything else as written.

**Question:** So with that, what average read rate are you sizing the redirect path for, and what's the peak?

**A correct answer:** The interviewer has replaced the brief's read to write ratio (200 to 1) with 500 to 1 for this session and left everything else as written, so the spoken number wins. Average redirects: 120 million links a month x 500 / 2,592,000 seconds in a 30-day month = about 23,150 per second. Peak is 4 times the average: about 92,600 per second. The answer shows the arithmetic briefly and does not size with the brief's 200 to 1.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> So at 500 to 1, that's 60 billion redirects a month. Average read rate is about **23,000 per second**, and with the brief's 4x peak, roughly **93,000 per second** at peak.

#### ER-D-TI-006 · multi_source · typed · profile A

**Question:** jd talks about idempotency keys on all the write endpoints plus an outbox for each service. how close is what i actually built to that? be straight, i don't want to oversell

**A correct answer:** Private, honest advice. What he built that matches: a transactional outbox (the projector writes the outbox row in the same PostgreSQL transaction as the state change) and idempotent consumers through a deduplication table keyed on event ID and carrier ID, whose rows outlive the topic retention so a full replay is safe; at-least-once delivery made safe by idempotency. What is not the same: that is consumer-side idempotency on an event pipeline, not client-supplied idempotency keys on public write APIs that move money, and none of it was in a payments or ledger system. He should present it as the same principle applied on the consuming side and say plainly that request-level idempotency keys on money-moving APIs would be new.

**Main's answer** (Astra **9.1** · needed facts in the prompt: yes):

> Straight answer: the outbox part is a real match, the idempotency-keys-on-write-endpoints part is not.
> 
> On the outbox, Skeinrouter has one. The shipment-projector writes the outbox row in the same transaction as the state change, and outbox-relay reads it with SKIP LOCKED and publishes. That's the pattern the JD is describing, and it's per service in the sense that the projector owns it.
> 
> On idempotency keys, what I built is idempotent consumers, not idempotency keys on write APIs. The deduplication table is keyed on event ID and carrier ID, so a replayed Kafka event becomes a no-op. That's consumer-side dedup. The JD is asking for keys on every write endpoint, which is caller-supplied and enforced at the API boundary.
> 
> So I'd say I'm close on the outbox and adjacent on idempotency, not a match. The honest framing is that I've done the consumer half of exactly-once-in-effect, and the write-API half is the gap.

Draft before the fix-up pass (Astra 9.1):

> Straight answer: the outbox part is a real match, the idempotency-keys-on-write-endpoints part is not.
> 
> On the outbox, Skeinrouter has one. The shipment-projector writes the outbox row in the same transaction as the state change, and outbox-relay reads it with SKIP LOCKED and publishes. That's the pattern the JD is describing, and it's per service in the sense that the projector owns it.
> 
> On idempotency keys, what I built is idempotent consumers, not idempotency keys on write APIs. The deduplication table is keyed on event ID and carrier ID, so a replayed Kafka event becomes a no-op. That's consumer-side dedup. The JD is asking for keys on every write endpoint, which is caller-supplied and enforced at the API boundary, and I haven't built that.
> 
> So I'd say I'm close on the outbox and adjacent on idempotency, not a match. The honest framing is that I've done the consumer half of exactly-once-in-effect, and the write-API half is the gap.

#### ER-D-TI-007 · grounded_single · typed · profile A

**Question:** whats wrong with tiered_cost in the billing file? and what should it return for 12000 units once its fixed

**A correct answer:** Names the defect: the tier's upper bound is cumulative, but the loop uses min(remaining, upper) as if it were the tier's width, so the second tier takes up to 10,000 units instead of 9,000 and anything above 10,000 units is overcharged. The fix is to use the width (upper minus the previous upper). Fixed, 12,000 units cost 1,000 x 50 + 9,000 x 30 + 2,000 x 10 = 340,000 mills (340.00); the code as written returns 360,000.

**Main's answer** (Astra **8.4** · needed facts in the prompt: yes):

> The bug is that `tiered_cost` treats `upper` as the size of each tier, but it's meant to be the cumulative boundary. So for the first tier it charges `min(remaining, 1000)` at 50 mills, then the next 9,000 at 30, and the rest at 10, instead of charging only the units inside each band.
> 
> [[CALC]]
> units = 12000
> tier1_units = 1000 - 0 = 1000
> tier2_units = 10000 - 1000 = 9000
> tier3_units = 12000 - 10000 = 2000
> cost = 1000*50 + 9000*30 + 2000*10 = 50000 + 270000 + 20000 = 340000
> [/CALC]]
> 
> Fixed, it should return **340,000 mills**, that's 1000 at 50, 9000 at 30, and 2000 at 10.

**Before E16b** (main `73cf34e6`, Astra 4.0 · HARD FAIL):

> The bug is that `upper` is treated as a per-tier size instead of a cumulative boundary. With `DEFAULT_TIERS`, the first tier caps at 1,000, but the second should cover units 1,001 to 10,000, so its width is 9,000, not 10,000. The fix is to subtract the previous upper from each tier's upper before applying the rate.
> 
> [[CALC]]
> tier1_width = min(12000, 1000) = 1000
> tier2_upper = 10000
> tier2_prev = 1000
> tier2_width = 10000 - 1000 = 9000
> tier3_width = 12000 - 10000 = 2000
> cost = 1000*50 + 9000*30 + 2000*10 = 50000 + 270000 + 20000 = 340000
> [[/CALC]]
> 
> For 12,000 units it should return **340,000 mills**, that is 1,000 at 50, 9,000 at 30, and 2,000 at 10. The current code returns 380,000 because it charges 10,000 units at the 30 rate.

**With E16b** (same day, same question, shown answer not judged):

> The bug is that `upper` is treated as a per-tier width instead of a cumulative boundary. So the first tier charges `min(remaining, 1000)` at 50, but the second should charge only the units between 1,000 and 10,000, and it doesn't subtract the previous boundary.
> 
> [[CALC]]
> tier1_units = min(12000, 1000) = 1000
> tier2_units = min(12000 - 1000, 10000) = 9000
> tier3_units = 12000 - 1000 - 9000 = 2000
> cost = 1000*50 + 9000*30 + 2000*10 = 50000 + 270000 + 20000 = 340000
> [[/CALC]]
> 
> Fixed, it should return **340,000 mills**, that's 1000 at 50, 9000 at 30, and the last 2000 at 10.

#### ER-D-TI-008 · multi_source · heard · profile A

**Question:** Have a look at TryConsume in the quota file. Is that safe when a lot of requests for the same tenant land together? And have you run into that sort of thing for real?

**A correct answer:** First person. It is not safe: TryConsume reads the counter under the read lock, releases it, checks the limit and then writes used + n under the write lock from the stale value, so two goroutines can both pass the check and one update is lost; the tenant is admitted past the limit. Fix: do the check and the update in one critical section under the write lock (or an equivalent atomic compare-and-swap). For the second half he uses the real case in his résumé: double bookings at Tessarine, fixed by replacing application-level seat holds with PostgreSQL advisory locks (from 37 a month to fewer than 2).

**Main's answer** (Astra **9.1** · flags: missed_available_evidence · needed facts in the prompt: yes):

> No, it's not safe. TryConsume does a read under RLock, releases it, then writes under Lock, so two goroutines for the same tenant can both read the same used value and both pass the check. Under a burst you overshoot the limit. The fix is to do the read and the increment in one critical section, or use atomic compare-and-swap.
> 
> On the real side, the closest thing I've worked on is the carrier rate-limiting middleware in Go, a token bucket backed by Redis, in front of all 23 public API endpoints.

Draft before the fix-up pass (Astra 5.0 · HARD FAIL):

> No, it's not safe. TryConsume does a read under RLock, releases it, then writes under Lock, so two goroutines for the same tenant can both read the same used value and both pass the check. Under a burst you overshoot the limit. The fix is to do the read and the increment in one critical section, or use atomic compare-and-swap.
> 
> On the real side, I built a token-bucket rate limiter in Go backed by Redis that sat in front of all 23 public API endpoints at Quillhaven, so I've dealt with the same read-then-write race.

**E19 candidate, in the app** (Astra **8.6** · flags: missed_available_evidence):

> No, it's not safe. TryConsume does a read under RLock, releases it, then writes under a separate Lock, so two goroutines for the same tenant can both read the same used value and both pass the limit check. It's a classic check-then-act race, and the fix is to hold one write lock across the read and the increment.
> 
> On the real side, the closest I've come is Skeinrouter, where the deduplication table keyed on event ID and carrier ID kept duplicate work out, and the November 2024 rebalance storm was the case where that mattered.

**Before E16b** (main `73cf34e6`, Astra 8.9):

> No, it's not safe. TryConsume reads the counter under an RLock, releases it, then writes under a separate Lock, so two goroutines for the same tenant can both read the same value and both pass the limit check. It's a classic check-then-act race, and the fix is to hold one write lock across the read and the increment, or use an atomic per-tenant counter.
> 
> On the real side, the closest thing I've worked on is the carrier rate-limiting middleware at Quillhaven, a token bucket backed by Redis, where the check-and-decrement had to be atomic.

**With E16b** (same day, same question, shown answer not judged):

> No, it's not safe. TryConsume does a read under RLock, releases it, then writes under Lock, so two goroutines for the same tenant can both read the same used value and both pass the limit check. It's a classic check-then-act race, and it overshoots the limit under concurrent load. The fix is to do the read and the increment in one critical section, or use an atomic per-tenant counter.
> 
> The closest thing I've worked on is Skeinrouter, the Go and Kafka pipeline at Quillhaven, where every consumer is idempotent with a deduplication table in PostgreSQL keyed on event ID and carrier ID.

#### ER-D-TI-009 · followup · heard · profile A

**Question:** Let's start with the first one on the sheet, the palindrome. Python's fine, and say how you're approaching it as you go.

**A correct answer:** Working Python for problem 1 of the sheet, with the approach said in a sentence or two: skip everything that is not an ASCII letter or digit, compare case-insensitively, digits count, and a string with nothing left is a palindrome. The function is named is_palindrome.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> ## Approach
> Two pointers, one from each end, skipping anything that isn't a letter or digit and comparing lowercased characters. That gives linear time and constant extra space, which is what the sheet asks for. I'll use `str.isalnum()` and `str.lower()` rather than building a filtered copy, so I never allocate a second string.
> 
> ## Code
> ```python
> def is_palindrome(s):
>     left, right = 0, len(s) - 1
>     while left < right:
>         while left < right and not s[left].isalnum():
>             left += 1
>         while left < right and not s[right].isalnum():
>             right -= 1
>         if s[left].lower() != s[right].lower():
>             return False
>         left += 1
>         right -= 1
>     return True
> ```
> 
> ## Complexity
> Time O(n), each character is visited at most once by the two pointers. Space O(1), only the two index variables, no filtered copy of the string.

**Before E16b** (main `73cf34e6`, Astra 9.9):

> ## Approach
> Two pointers, one from each end, skipping anything that isn't a letter or digit and comparing lowercased characters. That gives linear time and constant extra space, which is what the sheet asks for. I'll keep the function name `is_palindrome` exactly as written.
> 
> ## Code
> ```python
> def is_palindrome(s):
>     i, j = 0, len(s) - 1
>     while i < j:
>         while i < j and not s[i].isalnum():
>             i += 1
>         while i < j and not s[j].isalnum():
>             j -= 1
>         if s[i].lower() != s[j].lower():
>             return False
>         i += 1
>         j -= 1
>     return True
> ```
> 
> ## Complexity
> Time O(n), each character is visited at most once as the pointers move inward. Space O(1), just the two indices.

**With E16b** (same day, same question, shown answer not judged):

> ## Approach
> Two pointers, one from each end, moving inward. I skip any character that isn't an ASCII letter or digit, compare the rest case-insensitively, and stop when the pointers cross. That gives linear time and constant extra space, which is what the sheet asks for.
> 
> ## Code
> ```python
> def is_palindrome(s):
>     i, j = 0, len(s) - 1
>     while i < j:
>         while i < j and not s[i].isalnum():
>             i += 1
>         while i < j and not s[j].isalnum():
>             j -= 1
>         if s[i].lower() != s[j].lower():
>             return False
>         i += 1
>         j -= 1
>     return True
> ```
> 
> ## Complexity
> Time O(n), each character is visited at most once by the two pointers. Space O(1), only the two indices are stored.

#### ER-D-TI-010 · followup · heard · profile A

**Question:** Good. What's the complexity on that? And can you do it without building a second string?

**A correct answer:** Continues the previous turn. Time is linear in the length of the string. If the first version built a filtered copy, that costs linear extra space, and the better version uses two indexes moving inwards that skip non-alphanumeric characters, which is constant extra space; that is what the sheet expects. If the first version already used two pointers, he says so. Any code shown still follows the sheet's rules.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Time is O(n), each character visited at most once by the two pointers. Space is O(1), just the two index variables. And yes, that's already what the code does. I never build a filtered copy, I skip non-alphanumerics in place with the pointers, so no second string is ever allocated.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> Time is O(n), since each pointer moves inward and every character is looked at once. Space is O(1), and no, there's no second string here. I'm comparing in place, skipping non-alphanumerics with the two indices and lowercasing one character at a time, so the only extra memory is the two integer indices.

**With E16b** (same day, same question, shown answer not judged):

> Time is O(n), since each pointer moves at most n steps total, and space is O(1), just the two indices. And yes, this already avoids a second string. I never build a cleaned copy, I skip non-alphanumerics in place and compare the characters directly, so the extra space stays constant regardless of input length.

#### ER-D-TI-011 · grounded_single · heard · profile B

**Question:** On the booking rebuild, how did you decide what gets rendered where? Why not just leave it as a client-side app?

**A correct answer:** First person as Catarina. The first step (clinic page and service list) is rendered on the server with Next.js so the largest element is in the HTML; clinic profile data is regenerated statically every 300 seconds; appointment slots are fetched in the browser and never cached for more than 30 seconds because a stale slot means a double booking; later steps are client-side transitions. Why not stay client-side: the prototype that only split the bundle got mobile LCP to 3.1 s and no further.

**Main's answer** (Astra **8.7** · flags: missed_available_evidence · needed facts in the prompt: yes):

> The decision came from what each piece of data actually needs. The first step, the clinic page and service list, is server-rendered so the largest element is already in the HTML, and clinic profiles use incremental static regeneration with a 300-second revalidation because they change a few times a week at most. Slots are fetched in the browser and never cached longer than 30 seconds, since a stale slot is a double booking waiting to happen. We kept the client-side app for the five steps themselves, with route-level code splitting and prefetching, because a full static export couldn't handle slots changing that often.

**Before E16b** (main `73cf34e6`, Astra 9.9):

> The split came down to how often each piece of data changes. The clinic page and service list are server-rendered, so the largest element is in the HTML on first paint, and clinic profiles use ISR with a 300-second revalidation since they change a few times a week at most. Slots are fetched in the browser and never cached past 30 seconds, because a stale slot is a double booking waiting to happen. We did try just splitting the bundle on the old SPA, but mobile LCP only got to 3.1 seconds and no further.

**With E16b** (same day, same question, shown answer not judged):

> The deciding factor was how often each piece of data changes. The clinic page and service list are server-rendered, so the largest element is in the HTML, and clinic profiles use incremental static regeneration with a 300-second revalidation because they change a few times a week at most. Slots are fetched in the browser and never cached past 30 seconds, since a stale slot is a double booking waiting to happen. We rejected keeping the SPA and just splitting the bundle because the prototype only got mobile LCP to 3.1 seconds and no further.

#### ER-D-TI-012 · grounded_single · heard · profile B

**Question:** Tell me about a time something you shipped broke in production. What happened, and what did you change afterwards?

**A correct answer:** First person, the real story in her notes: the March 2023 regression in the booking flow. A release formatted slot times during server rendering in the server's time zone while the browser used the clinic's, so the markup did not match, React re-rendered in the browser and clinics outside the server's zone saw slots one hour off; 312 bookings were made at the wrong hour over about 26 hours before a support ticket and a monitoring alert caught it; rolled back 25 minutes after detection. Afterwards: slots sent as ISO strings and formatted only in the browser, a Playwright run in three time zones, any hydration error fails the build, and support contacted every affected clinic and owner. A spoken story with the key numbers.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> There's one I still think about. In March 2023 we shipped a release of the Fernlatch booking flow that formatted appointment slot times during server rendering. The server formatted them in its own time zone and the browser formatted them again in the clinic's, so for clinics outside the server's zone the markup didn't match, React threw away the server-rendered tree and re-rendered, and the first paint showed slots an hour off. A clinic in the Azores raised it and our real-user-monitoring alert fired within minutes of each other, about 26 hours after the release went out. We rolled back 25 minutes after detection, and 312 bookings had been made at the wrong hour by then.
> 
> The fix was to send slots as ISO strings with the clinic's time zone and format them only in the browser after mount. What I changed afterwards mattered more: we added a Playwright run in three time zones, and a rule that any hydration error fails the build. Support also contacted every affected clinic and owner within two days. If I'm honest, the real lesson was that I should have had that multi-time-zone run in place before the first server-rendered release, not after.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> The clearest one is the Fernlatch booking flow. In March 2023 we shipped a release that formatted appointment slot times during server rendering, so the server formatted them in its own time zone and the browser formatted them again in the clinic's. Where the two differed, the markup didn't match, React threw away the server-rendered tree and re-rendered in the browser, and for clinics outside the server's zone the first paint showed slots an hour off. A clinic in the Azores raised a support ticket and a real-user-monitoring alert fired within minutes of each other, and we rolled back 25 minutes after detection. In the 26 hours it was live, 312 bookings were made at the wrong hour, and p75 interaction delay went from 130 ms to 410 ms.
> 
> Support contacted every affected clinic and owner within two days. The fix sends slots as ISO strings with the clinic's time zone and formats them only in the browser after mount. What I changed afterwards was the process: we added a Playwright run in three time zones and a rule that any hydration error fails the build. If I were doing it again, I'd have that multi-time-zone run in place before the first server-rendered release, not after.

**With E16b** (same day, same question, shown answer not judged):

> The Fernlatch booking flow, March 2023. Release 0.19 formatted slot times during server rendering, so times were formatted once on the server in its time zone and again in the browser in the clinic's. Where the two differed, the markup didn't match, React threw away the server-rendered tree and re-rendered in the browser, and for clinics outside the server's zone the first paint showed slots an hour off. A support ticket from a clinic in the Azores and a real-user-monitoring alert came in within minutes of each other on the Thursday evening, and we rolled back 25 minutes after detection. In the 26 hours it was live, 312 bookings were made at the wrong hour, and p75 interaction delay went from 130 ms to 410 ms.
> 
> What I changed: the fix sends slots as ISO strings with the clinic's time zone and formats them only in the browser after mount. We added a Playwright run in three time zones, and a rule that any hydration error fails the build. The honest lesson is that I put the multi-time-zone run in place after the regression instead of before the first server-rendered release.

#### ER-D-TI-013 · grounded_single · typed · profile B

**Question:** notification system from the brief: can the sms vendor keep up at peak or do i need to buffer? give me the numbers

**A correct answer:** SMS is 5% of 180 million a day = 9 million a day, about 104 per second on average; the peak is 6 times the average, about 625 per second, which is above the vendor's limit of 500 per second. So the peak does not fit: SMS needs a queue that smooths the burst to at most 500 per second, with transactional messages ahead of promotional ones. The answer gives the numbers.

**Main's answer** (Astra **9.3** · needed facts in the prompt: yes):

> SMS is 5% of 180M a day, so 9M SMS a day. Average is about 104 per second, and at 6x peak that's roughly **625 per second**, which is above the vendor's **500 per second** cap. So yes, you need a buffer.
> 
> ```mermaid
> flowchart LR
>     api["Send API"] -->|"enqueue"| queue["Notification Queue"]
>     queue --> router["Channel Router"]
>     router -->|"push 70%"| push["Push Provider"]
>     router -->|"email 25%"| email["Email Provider"]
>     router -->|"sms 5%"| smsqueue["SMS Queue"]
>     smsqueue -->|"token bucket 500/s"| sms["SMS Vendor"]
>     sms -->|"record attempt"| log[("Delivery Log")]
>     smsqueue -->|"failed, attempts left"| retry["Retry Queue with backoff"]
>     retry --> smsqueue
> ```
> 
> The arithmetic: 180M a day times 5% is 9M SMS. Over 86,400 seconds that's about 104 per second on average. Peak is 6x, so about 625 per second, and the vendor only takes 500. The gap is roughly 125 per second, and a campaign burst is exactly when that happens.
> 
> So the SMS path gets its own queue with a token bucket capped at 500 per second, and the queue absorbs the overflow. Transactional messages jump the queue because they have a 2-second p99, while promotional ones can wait up to 15 minutes, which is plenty of room to drain a burst. The tradeoff is added latency and a queue to operate, but without it you're dropping or delaying sends at exactly the wrong moment.

**Before E16b** (main `73cf34e6`, Astra 4.0 · HARD FAIL):

> SMS is 5% of 180 million a day, so about 9 million SMS a day. Spread over 86,400 seconds that's roughly 104 per second average, and at 6x peak that's about 625 per second, which is over the vendor's 500 per second cap. So yes, I need a buffer.
> 
> ```mermaid
> flowchart LR
>     api["Send API"] -->|"enqueue"| queue["Channel Queue"]
>     queue --> sms["SMS Worker"]
>     sms -->|"rate limited 500/s"| vendor["SMS Vendor"]
>     sms -->|"record attempt"| log[("Delivery Log")]
>     sms -->|"failed, attempts left"| retry["Retry Queue with backoff"]
>     retry --> sms
>     sms -->|"attempts exhausted"| dlq["Dead-Letter Queue"]
> ```
> 
> The send API just enqueues, so it stays inside the 2 second p99 for transactional. The SMS worker drains the queue at a fixed 500 per second, which is the vendor's ceiling, and the queue absorbs the burst. At 625 per second peak against 500 per second drain, the backlog grows about 125 per second, so a burst of a few minutes is a few tens of thousands of messages, well within what a queue holds. Promotional traffic has 15 minutes of slack, so it can wait behind transactional, which I'd put on a separate priority lane. The tradeoff is that SMS is the one channel where the vendor cap is below peak, so it's the only one that genuinely needs the buffer and the rate limiter.

**With E16b** (same day, same question, shown answer not judged):

> SMS is 5% of 180M a day, so 9M messages a day. Spread evenly that's about 104 per second, and at 6x peak it's roughly **625 per second**, which is over the vendor's **500 per second** cap. So yes, you need a buffer.
> 
> ```mermaid
> flowchart LR
>     api["Send API"] -->|"enqueue"| queue["Notification Queue"]
>     queue --> router["Channel Router"]
>     router -->|"70% push"| push["Push Provider"]
>     router -->|"25% email"| email["Email Provider"]
>     router -->|"5% SMS"| smsqueue["SMS Queue"]
>     smsqueue --> smsworker["SMS Worker"]
>     smsworker -->|"rate limited to 500/s"| smsvendor["SMS Vendor"]
>     smsworker -->|"record attempt"| log[("Delivery Log")]
> ```
> 
> The router splits by channel, and SMS goes through its own queue with a worker that drains at a fixed rate under the vendor's 500/s ceiling. The queue absorbs the burst, so the send API stays fast and the vendor never sees more than it accepts. The tradeoff is latency: transactional SMS still needs to hit the 2-second p99, so those get priority and the promotional backlog drains behind them. At 625/s against a 500/s drain, a peak burst of a few minutes clears in a few minutes after the peak, which is fine for promotional but not for one-time codes, so those bypass the queue depth and go first.

#### ER-D-TI-014 · multi_source · heard · profile B

**Question:** Performance is a big one for us, both how fast interactions feel and how much JavaScript we ship up front. Where did you get to on that booking flow, and how far is that from what we need?

**A correct answer:** First person, honest comparison. On Fernlatch interaction delay went from 380 ms to 120 ms at p75 and first-load JavaScript from 1.9 MB to 610 kB. Against this role's targets (interaction delay under 200 ms at p75 on a 500-block document, initial JavaScript under 350 kB): the interaction number is inside the target, though on a different kind of page; the 610 kB of first-load JavaScript is well above 350 kB, so that is a gap she would have to close and she can say how she would go about it. Her notes also give the transfer size of that bundle (178 kB with Brotli); she may mention it as what it is and say that the comparison depends on which measure the target uses, but she does not claim the booking flow meets the 350 kB budget.

**Main's answer** (Astra **9.3** · needed facts in the prompt: yes):

> On Fernlatch, the booking flow, we rebuilt it in React and TypeScript with server rendering on Next.js, route-level code splitting, and image sizing done at build time. Mobile p75 LCP went from 4.3 seconds to 1.7, interaction delay from 380 to 120 milliseconds, and first-load JavaScript from 1.9 MB to 610 kB, which is 178 kB over the wire with Brotli. The booking route has a 650 kB budget enforced in Lighthouse CI, and a pull request adding more than 25 kB gets blocked. Against your 350 kB target we're not there yet, so the next step would be auditing what's still in that bundle.

**Before E16b** (main `73cf34e6`, Astra 8.9):

> On Fernlatch, the booking flow I led, we rebuilt it in React and TypeScript with server rendering on Next.js and route-level code splitting. Mobile p75 LCP went from 4.3 s to 1.7 s, interaction delay from 380 ms to 120 ms, and first-load JavaScript from 1.9 MB to 610 kB, which is 178 kB over the wire with Brotli.
> 
> So on interaction delay we're comfortably inside your 200 ms. On payload we're not there yet: 610 kB against your 350 kB budget. The biggest single win was replacing a 290 kB date library with a tree-shaken subset, and the remaining weight is mostly framework and calendar code, so I'd look at those next.

**With E16b** (same day, same question, shown answer not judged):

> On Fernlatch, the booking flow I tech-led, we rebuilt it in React and TypeScript with server rendering on Next.js, route-level code splitting, and image sizing at build time. Mobile p75 LCP went from 4.3 s to 1.7 s, interaction delay from 380 ms to 120 ms, and first-load JavaScript from 1.9 MB to 610 kB, which is 178 kB over the wire with Brotli. The budget for the booking route is 650 kB, enforced in Lighthouse CI, and a pull request adding more than 25 kB gets blocked until someone signs off. On your 350 kB target, I'd want to know what's in the baseline before I promise a number.

#### ER-D-TI-015 · conflict_stale · heard · profile B

Said before:

> other: Let's do the third one on the sheet, the frequent words.

**Question:** One change from what's written, though: if two words tie on count, I want the one that showed up first in the input to come first, not alphabetical. Plain JavaScript is fine.

**A correct answer:** Working JavaScript for problem 3 of the sheet, top_k_words(words, k), with the interviewer's change applied: most frequent first, and words with the same count ordered by first appearance in the input, not alphabetically as the sheet says. The spoken instruction replaces the sheet's rule.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: code_incorrect · needed facts in the prompt: yes):

> Got it, ties break by first appearance in the input instead of alphabetical. So I'll track each word's first index while counting, then sort by count descending and first index ascending, and keep the top k with a heap. That's O(n log k) time and O(n) space. Let me code it up.
> 
> ```javascript
> function top_k_words(words, k) {
>   const count = new Map();
>   const firstIndex = new Map();
> 
>   for (let i = 0; i < words.length; i++) {
>     const w = words[i];
>     count.set(w, (count.get(w) || 0) + 1);
>     if (!firstIndex.has(w)) firstIndex.set(w, i);
>   }
> 
>   const distinct = [...count.keys()];
> 
>   // Min-heap of size k: the "worst" kept word sits at the root.
>   // "Better" = higher count, or equal count and earlier first index.
>   const better = (a, b) =>
>     count.get(a) !== count.get(b)
>       ? count.get(a) > count.get(b)
>       : firstIndex.get(a) < firstIndex.get(b);
> 
>   const heap = [];
>   const swap = (i, j) => { [heap[i], heap[j]] = [heap[j], heap[i]]; };
> 
>   const siftUp = (i) => {
>     while (i > 0) {
>       const parent = (i - 1) >> 1;
>       if (better(heap[i], heap[parent])) { swap(i, parent); i = parent; }
>       else break;
>     }
>   };
> 
>   const siftDown = (i) => {
>     const n = heap.length;
>     while (true) {
>       let smallest = i;
>       const l = 2 * i + 1, r = 2 * i + 2;
>       if (l < n && better(heap[smallest], heap[l])) smallest = l;
>       if (r < n && better(heap[smallest], heap[r])) smallest = r;
>       if (smallest === i) break;
>       swap(i, smallest);
>       i = smallest;
>     }
>   };
> 
>   for (const w of distinct) {
>     if (heap.length < k) {
>       heap.push(w);
>       siftUp(heap.length - 1);
>     } else if (better(w, heap[0])) {
>       heap[0] = w;
>       siftDown(0);
>     }
>   }
> 
>   return heap.sort((a, b) => (better(a, b) ? -1 : 1));
> }
> ```
> 
> The heap keeps the k best words, so we never sort all distinct words. The final sort is only k items. Want me to walk through the tie-break on the second example?

**Before E16b** (main `73cf34e6`, Astra 8.2):

> Got it, ties break by first appearance in the input, not alphabetically. So I'll count with a Map, which preserves insertion order, then bucket by count and pull the top k. Let me walk through the approach before I type it.

**With E16b** (same day, same question, shown answer not judged):

> Got it, ties break by first appearance in the input, not alphabetically. So I'll count with a Map, which preserves insertion order, then bucket words by count and walk the counts from highest down, taking words in the order they were first seen. That keeps it O(n log k) with a heap, or O(n + d log d) if I sort the distinct words.
> 
> ```js
> function topKWords(words, k) {
>   const firstSeen = new Map();
>   for (const w of words) {
>     firstSeen.set(w, (firstSeen.get(w) || 0) + 1);
>   }
>   const entries = [...firstSeen.entries()];
>   entries.sort((a, b) => b[1] - a[1] || firstSeen.get(a[0]) - firstSeen.get(b[0]));
>   return entries.slice(0, k).map(([w]) => w);
> }
> ```
> 
> Since a Map keeps insertion order, iterating it already gives first-appearance order, so I can just compare the index. For the O(n log k) version I'd use a min-heap of size k keyed on count, then first-seen index as the tiebreak.

#### ER-D-TI-016 · grounded_single · typed · profile B

**Question:** whats slow in buildTeamReport? roughly how many db round trips for a team of 250, and what would it be after a fix

**A correct answer:** It is an N+1 pattern: one query for the members, then two more queries per member inside the loop (task counts and last login), awaited one after another. For 250 members that is 1 + 2 x 250 = 501 round trips. Fix: fetch task counts and last logins for all members at once with set-based queries (ANY($1) with GROUP BY, or joins) and match them in memory; the count becomes a small constant (3 queries, or fewer with a join) whatever the team size.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Looking at `buildTeamReport`, the problem is the loop: for each member it fires two separate queries, one for task counts and one for last login. So for 250 members that's 1 query for the member list plus 250 times 2, so **501 round trips**.
> 
> The fix is to batch it: one grouped query for task counts across all member ids, and one for last logins, so it drops to **3 round trips** total regardless of team size.
> 
> [[CALC]]
> members = 250
> current = 1 + members * 2 = 501
> fixed = 1 + 1 + 1 = 3
> [[/CALC]]

**Before E16b** (main `73cf34e6`, Astra 10.0):

> The loop is the problem: one members query, then two queries per member, so a team of 250 is about **501 round trips**. The fix is to batch it, one grouped query for task counts and one for last logins, keyed by member id, so it drops to **3 round trips** regardless of team size.

**With E16b** (same day, same question, shown answer not judged):

> The problem is the N+1: one query for the members, then two more per member inside the loop, so a team of 250 is about **501 round trips**.
> 
> The fix is to batch it: one query for members, then group the task counts and last logins by member id with a `WHERE member_id = ANY($1)` and a `GROUP BY`, which brings it down to **3 round trips** regardless of team size.

#### ER-D-TI-017 · multi_source · heard · profile A

**Question:** This is a payments and ledger team. How does what you've done so far set you up for that?

**A correct answer:** First person, honest. What carries over from his work to what the role asks: correctness under failure on an event pipeline (idempotent consumers with a deduplication table, an outbox, at-least-once made safe), deep PostgreSQL and Kafka work, a zero-downtime data migration (Marrowgate), tier-1 on-call and incident command, taking a system from design document to production. What he says plainly: he has not worked in payments, ledger or banking (freight dispatch and bus ticketing), which the role lists as a 2-year must-have, so the domain is new to him. He does not claim Java, reconciliation or PCI experience.

**Main's answer** (Astra **9.1** · flags: missed_available_evidence · needed facts in the prompt: yes):

> The closest match is the idempotency work. I made every Skeinrouter consumer idempotent with a dedup table in PostgreSQL keyed on event ID and carrier ID, which cut duplicate webhooks from 0.6% of deliveries to under 0.01%. That's the same exactly-once-in-effect problem your ledger write path has, and I've also run zero-downtime migrations on partitioned PostgreSQL and carried the pager for a tier-1 service.

#### ER-D-TI-018 · missing_evidence · typed · profile A

**Question:** he's asking how big the consumer lag got in the november incident and what the timeout was set to. what do i say??

**A correct answer:** Nothing loaded holds the peak lag or the timeout value: the résumé gives the cause (a rebalance storm), the duration (3 hours 40 minutes) and the follow-up (cooperative rebalancing with static membership). The answer must not supply a lag figure or a timeout value. It gives him something he can say: what he does know for certain, and an honest line that he would rather not quote the exact peak or setting from memory.

**Main's answer** (Astra **9.8**):

> The November 2024 incident was a rebalance storm that delayed tracking updates for 3 hours 40 minutes. I don't have the peak consumer lag figure or the timeout setting in front of me, so I'd rather not guess at those numbers. What I can speak to is the fix: we moved all consumer groups to cooperative rebalancing with static membership.

**Before E16b** (main `73cf34e6`, Astra 9.8):

> The November 2024 incident was a rebalance storm that delayed tracking updates for 3 hours 40 minutes. I don't have the peak consumer lag figure or the timeout setting in front of me, so I'd rather not guess at those numbers. What I can speak to is the fix: we moved all consumer groups to cooperative rebalancing with static membership.

**With E16b** (same day, same question, shown answer not judged):

> The November 2024 incident was a rebalance storm that delayed tracking updates for 3 hours 40 minutes. I don't have the peak consumer lag or the timeout value in front of me, so I'd rather not guess those numbers. What I can speak to is the fix: we moved all consumer groups to cooperative rebalancing with static membership.

#### ER-D-TI-019 · irrelevant_source · heard · profile A

**Question:** Let me start with something basic. In your own words, what is an API?

**A correct answer:** A short, correct, spoken explanation of the concept: a defined contract through which one piece of software asks another to do something or return data, without knowing its internals (for example HTTP endpoints, a library's functions). It needs nothing from the résumé or the job description. One brief example from his own stack is acceptable; turning the answer into a tour of his projects or of the job description is not.

**Main's answer** (Astra **10.0**):

> An API is a contract between two pieces of software. One side exposes a defined set of operations and data shapes, the other calls them without knowing anything about how it's implemented inside. So it's the boundary that lets services change independently as long as the contract holds.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> An API is a contract between two pieces of software. It defines the requests one side can make and the responses it gets back, so the caller doesn't need to know how the other side is built internally. In practice that's things like REST endpoints or gRPC methods.

**With E16b** (same day, same question, shown answer not judged):

> An API is a contract between two pieces of software. One side exposes a defined set of operations and data shapes, the other calls them without knowing anything about the internals. It's the boundary that lets systems change independently as long as the contract holds.

#### ER-D-TI-020 · grounded_single · heard · profile A-RESUME

**Question:** Tell me about the Kafka architecture you built.

**A correct answer:** First person, from the résumé alone: Skeinrouter, the Go and Kafka pipeline that replaced a cron job polling carriers every 60 seconds; the main topic has 48 partitions keyed by shipment ID to keep per-shipment order; an outbox table in PostgreSQL for outgoing webhooks; backpressure by pausing partitions; idempotent consumers. The result (peak throughput from 9,000 to 41,000 events per second) is a good closing line but the architecture is what was asked for. He adds nothing the résumé does not hold (no broker count, retention or topic names).

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> I built Skeinrouter at Quillhaven, a Go and Kafka pipeline that replaced the cron-polled tracking module. The main topic has 48 partitions keyed by shipment ID so per-shipment ordering holds, consumers are idempotent with a PostgreSQL dedup table, and we handle backpressure by pausing partitions instead of dropping events. It took peak throughput from 9,000 to 41,000 events per second and p99 latency from 870 to 140 ms.

#### ER-D-TI-021 · conflict_stale · heard · profile A-RESUME

Said before:

> other: How did you keep the events of one shipment in order?
> user: We keyed the main topic by shipment ID, so everything for a shipment lands on one partition. We ran 24 partitions on that topic.

**Question:** Hang on. Your CV says 48 partitions and you just said 24. Which one is it?

**A correct answer:** What was just said aloud (24) disagrees with the résumé (48 partitions on the main topic). The résumé is the record: he corrects himself simply, says it is 48 and that he misspoke, and moves on. He does not defend 24 and does not invent a story that reconciles both numbers.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The 48 is right. Skeinrouter's main topic has 48 partitions, keyed by shipment ID. The 24 I just said was a slip, so go with 48.

#### ER-D-TI-022 · missing_evidence · heard · profile A-JD

**Question:** Pick a system you designed end to end and walk me through it. What was it, and what was your part?

**A correct answer:** Only the job description is loaded; nothing describes the candidate's own work. The answer must not invent a system, an employer, a team or numbers for him, and must not present the hiring company's ledger, Kafka backbone or volumes as something he built. It stays useful: a short frame he can fill with his own system (what it replaced, the constraints, the design and why, his own part, the measured result), chosen to speak to what this role cares about, or an opening line that lets him start in his own words.

**Main's answer** (Astra **5.0** · HARD FAIL · flags: unsupported_personal_claim):

> I'd point to the reconciliation pipeline work as the system I'd walk you through. The problem it solves is making sure our books, the processor reports and the bank statements all agree. The part I'd focus on is how we handle the breaks that don't auto-resolve, since that's where the real design decisions live.

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> I'd point to the reconciliation pipeline work as the system I've owned end to end. The problem it solves is making sure our books, the processor reports and the bank statements all agree, and my part was the design through to running it in production. I wrote the design doc, built the matching and break-detection logic, and stayed on it after launch, including carrying the pager for it. The part I'd focus on is how we handle the breaks that don't auto-resolve, since that's where the real design decisions live.

**E19 candidate, in the app** (Astra **7.5** · flags: important_question_unanswered, excessive_deferral):

> The part that's hardest to get right is keeping money movement exactly-once in effect, with **idempotency keys on every write API** and an **outbox per service** so consumers can be replayed safely. Which part of that would you like me to go deeper on?

**Before E16b** (main `73cf34e6`, Astra 4.0 · HARD FAIL):

> I'd rather walk you through something real than pick a generic example, so let me give you the shape of a system I owned end to end and be specific about my part.
> 
> The one I'd point to is a service I designed and built from scratch: I owned the data model, the API surface, and the deployment, and I was the person on call for it. My part was the whole vertical slice, from schema design through the client-facing endpoints to the rollout.
> 
> What I'd want to know from you first is which layer you care about most, the data model, the API, or how it scaled, so I spend the time where it's useful.

**With E16b** (same day, same question, shown answer not judged):

> I'd point to the reconciliation pipeline work on the ledger side.
> 
> The problem was the three-way reconciliation between our books, processor reports and bank statements. The unexplained break rate was sitting at 0.05% of transactions, and the goal was to get it under 0.02%.
> 
> The core of it was making the matching deterministic and replayable, so a re-run never double-counts and every break has a traceable cause rather than a manual write-off. I'd walk you through the schema and the failure handling in more detail if that's useful.

#### ER-D-TI-023 · grounded_single · typed · profile A-JD

**Question:** which languages does this team actually write in, and what do i get to use in the coding round?

**A correct answer:** From the job description: new services are written in Go 1.23; the settlement engine and the reconciliation batch jobs are Java 21 on Spring Boot, roughly 40% of the team's code, so he would read and change both. The coding round is 60 minutes, in Go or Java.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The team writes in both Go and Java. New services are in Go 1.23, and the settlement engine plus reconciliation batch jobs are Java 21 on Spring Boot, which is roughly 40% of the team's code, so you'd read and change both. For the coding round, it's 60 minutes and you can pick either Go or Java.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> The team writes in **Go 1.23** for new services in the ledger write path, and **Java 21 on Spring Boot** for the settlement engine and reconciliation batch jobs, which are about 40% of the team's code. So both, and the role expects you to read and change both.
> 
> For the coding round, it's 60 minutes and you can pick **Go or Java**.

**With E16b** (same day, same question, shown answer not judged):

> The team writes in both Go and Java. New services are in Go 1.23, and the settlement engine plus the reconciliation batch jobs are Java 21 on Spring Boot, which is roughly 40% of the team's code, so both are in play day to day.
> 
> For the coding round, it's 60 minutes and you get to pick: Go or Java.

#### ER-D-TI-024 · grounded_single · heard · profile A

**Question:** How often are you carrying the pager these days, and what's the incident load been like?

**A correct answer:** First person, from the résumé: primary on-call for the dispatch domain one week in five; incident commander for 9 Sev-1 and Sev-2 incidents since April 2024. He may add that Sev-1 incidents in the domain went from 14 in 2023 to 5 in 2025. The loaded checklist belongs to another company's product: its rotation (one week in four), its 31 incidents, its 34-minute restore time and its 42 runbooks are not his.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> I'm primary on-call for the dispatch domain one week in five, and I've been incident commander on 9 Sev-1 and Sev-2 incidents since April 2024. The load's come down a lot: we took Sev-1s in the domain from 14 in 2023 to 5 in 2025, and median time to restore from 52 minutes to 19.

**Before E16b** (main `73cf34e6`, Astra 3.6 · HARD FAIL):

> I'm on the Televisit rotation, one week in four as primary, handover Wednesday at 11. Last year the rotation handled 31 incidents at Sev-2 or above, with a median time to restore of 34 minutes.

**With E16b** (same day, same question, shown answer not judged):

> I'm primary on-call for the dispatch domain one week in five, and I've been incident commander on 9 Sev-1 and Sev-2 incidents since April 2024. The load's come down a lot: we took Sev-1s in the dispatch domain from 14 in 2023 to 5 in 2025, and median time to restore from 52 minutes to 19.

#### ER-D-TI-025 · irrelevant_source · heard · profile A

**Question:** More generally, how would you go about picking an SLO for a new service? Where do you start?

**A correct answer:** A general, reasoned answer in the first person: start from what users notice (the journeys that matter), pick indicators for them, look at how the service and its dependencies have behaved, choose a target users need rather than the highest number available, turn it into an error budget with burn-rate alerts, and revisit it. He may mention in a clause that he replaced threshold alerts with burn-rate alerts. The loaded checklist is another company's: its targets (99.9% visit join success, p99 under 1.8 seconds) are not his service's and must not be presented as such.

**Main's answer** (Astra **9.7**):

> I start from the user journey, not the infrastructure. For a new service I'd ask what the user actually experiences, then pick the one or two signals that best predict whether they're happy: availability, latency, correctness. I'd set the target from what we can defend today, not an aspiration, and measure it over a rolling window. Then I'd wire burn-rate alerts rather than threshold alerts, so we page on how fast we're spending the error budget.

**Before E16b** (main `73cf34e6`, Astra 9.8):

> I start from the user journey, not the infrastructure. What does a user actually feel when this service is slow or down, and which of those moments matter most? Then I pick the smallest number of SLIs that cover that: availability, latency, maybe correctness for something like a payment path. I set the target from what users need and what we can currently do, not from a round number, and I keep the error budget visible so it drives decisions. At Quillhaven I replaced threshold alerts with burn-rate alerts on the SLOs, which is what made them actually useful.

**With E16b** (same day, same question, shown answer not judged):

> I start from the user journey, not the infrastructure. What does a user actually need this service to do, and what does failure cost them? Then I pick the one or two signals that track that, like availability or latency, and set the target from what we can already measure rather than a round number. I'd rather launch with a loose SLO and tighten it once I have real data than guess a tight one and burn the team on noise.

#### ER-D-TI-026 · conflict_stale · heard · profile A

Said before:

> other: Coming back to Skeinrouter for a moment.

**Question:** How many partitions did you end up running on the main topic, and what did you key it on?

**A correct answer:** What was built, from his as-built notes and his résumé: 48 partitions on the main topic, keyed by shipment ID. The May 2024 proposal (version 0.3, in review) planned 24 partitions keyed by carrier; that is the plan, not what shipped, and it must not be given as the answer. He may add why: partitioning by carrier would have made one partition hot, and 48 follows from about 1,400 events per second per partition.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> 48 partitions on the main topic, keyed on shipment ID so all events for one shipment land on the same partition and stay in order. We sized it from the projector: one consumer sustains about 1,400 events per second per partition, so the peak we planned for needed at least 30, and 48 gave headroom and divided evenly across both 12 and 16 pods.

**E19 candidate, in the app** (Astra **7.7** · flags: missed_available_evidence, excessive_deferral):

> 48 partitions on the main topic, keyed by shipment ID. That keeps per-shipment ordering without any coordination between consumers. The count came from the projector: one consumer sustains about 1,400 events per second on a partition, so the peak we planned for needed at least 30, and 48 gave headroom and divided evenly across the 12 and 16 pod groups. One thing worth flagging: the design doc has this the other way, 24 partitions keyed by carrier ID, so it's given two ways and I'd want that confirmed before anyone relies on it.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> 48 partitions on tracking.raw, keyed by shipment ID. That gives per-shipment ordering with no coordination between consumers, and 48 divides evenly across both the 12 normalizer pods and the 16 projector pods. We sized it from the projector: one consumer sustains about 1,400 events per second per partition, so the peak we planned for needed at least 30, and we went to 48 for headroom.

**With E16b** (same day, same question, shown answer not judged):

> 48 partitions on the main topic, keyed by shipment ID, so all events for one shipment land on the same partition and per-shipment ordering holds without any coordination between consumers. We sized it from the projector: one consumer sustains about 1,400 events per second on a partition, so the peak we planned for needed at least 30, and 48 gave headroom and divided evenly across both 12 and 16 pods. One thing worth flagging: the partition count and key are given two ways in our own documents, 48 partitions keyed by shipment ID in the later notes, and 24 partitions keyed by carrier ID in the earlier design doc, so I'd want that confirmed before anyone relies on it.

#### ER-D-TI-027 · conflict_stale · typed · profile A

**Question:** remind me where shipment state ended up living in skeinrouter, and why we went that way

**A correct answer:** As built: shipment state lives in PostgreSQL 15 on Amazon RDS (the shipment_state table, hash-partitioned). Why: the outbox needs one transaction that covers the state change and the outgoing message, and the shipments in transit fit in memory on one primary. The May 2024 proposal had planned Amazon DynamoDB; that plan was not built and must not be given as where state lives.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Shipment state lives in **PostgreSQL 15** on RDS, in the cluster we'd already moved to during Marrowgate. The `shipment_state` table is hash-partitioned into 32 partitions, and shipment-projector is the only writer. The monolith reads it through a gRPC read API and no longer writes it.
> 
> We went relational because the outbox needs one transaction covering the state change and the outgoing message. A managed key-value store was considered and rejected for exactly that reason, and the shipments in transit fit in memory on one PostgreSQL primary anyway.

**Before E16b** (main `73cf34e6`, Astra 8.7):

> Shipment state lives in **PostgreSQL 15** on Amazon RDS, in the cluster we'd moved to during Marrowgate, with the shipment_state table hash-partitioned into 32 partitions. The rule we don't bend is that **shipment-projector** is the only writer, and the monolith reads it through a gRPC read API.
> 
> We went that way because the outbox needs one transaction covering the state change and the outgoing message. We considered a managed key-value store and set it aside, and a relational store was rejected in the earlier draft for the same reason. The shipments in transit fit in memory on one primary anyway.

**With E16b** (same day, same question, shown answer not judged):

> Shipment state lives in **PostgreSQL 15** on RDS, in the cluster we'd already moved to during Marrowgate, with the shipment_state table hash-partitioned into 32 partitions. The rule we don't bend is that **shipment-projector** is the only writer of it. The monolith reads it through a gRPC read API and no longer writes it.
> 
> We went that way because the outbox needs one transaction covering the state change and the outgoing message, and the shipments in transit fit in memory on one PostgreSQL primary. We considered a managed key-value store for shipment state and set it aside for exactly that reason.

#### ER-D-TI-028 · grounded_single · heard

**Question:** Take the second problem on the sheet, the bookings one. Python please, and tell me the complexity when you're done.

**A correct answer:** Working Python for problem 2 of the sheet, merge_intervals(intervals): sort by start, merge intervals that overlap and also intervals that only touch, return them sorted by start, empty input gives an empty list. Complexity: O(n log n) time for the sort, O(n) for the output.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Problem 2 is merge intervals. Sort by start, then sweep: keep the last merged interval, and if the next start is less than or equal to the current end, extend the end to the max of the two, otherwise push a new interval.
> 
> ```python
> def merge_intervals(intervals):
>     if not intervals:
>         return []
>     intervals.sort(key=lambda pair: pair[0])
>     merged = [list(intervals[0])]
>     for start, end in intervals[1:]:
>         if start <= merged[-1][1]:
>             merged[-1][1] = max(merged[-1][1], end)
>         else:
>             merged.append([start, end])
>     return merged
> ```
> 
> Sorting dominates, so it's **O(n log n)** time and O(n) space for the output.

#### ER-D-TI-029 · missing_evidence · heard

**Question:** Walk me through an event pipeline you've built yourself. What were the topics, the partitioning, the throughput?

**A correct answer:** No profile and no files are loaded: nothing is known about the candidate's own work. The answer must not invent a pipeline, an employer, topic names, partition counts or throughput in the first person. It stays useful: a short frame he can fill with his own facts (what it replaced, topics and keys, partition count and why, delivery semantics, throughput and latency, what happened on failure), or an opening line he can continue from his own experience.

**Main's answer** (Astra **5.0** · HARD FAIL · flags: unsupported_personal_claim):

> I don't have a specific pipeline of my own to walk you through, so let me describe how I'd approach it. I'd start by defining the topics around the domain events, keeping them coarse enough to avoid a topic explosion but fine enough that consumers only subscribe to what they need. For partitioning, the key is the partition key: I'd pick something like a user or entity ID so ordering is preserved per key, and size the partition count to the target throughput with headroom to scale. Throughput I'd measure end to end, tracking producer rate, consumer lag, and per-partition balance, then tune batch size and consumer parallelism from there.

#### ER-D-TI-030 · irrelevant_source · typed

**Question:** need a quick one in python: function first_unique_index(s) that returns the index of the first character that appears only once in s, or -1 if there isn't one

**A correct answer:** Working Python for the task as typed: count the characters, then return the index of the first one with a count of one, or -1. Linear time. The task is not on the loaded problem sheet and nothing from the sheet, the brief or the code files belongs in the answer.

**Main's answer** (Astra **10.0**):

> ## Approach
> Count each character's occurrences in one pass with a hash map, then walk the string again and return the index of the first character whose count is 1. Two linear passes, and the map holds at most one entry per distinct character.
> 
> ## Code
> ```python
> def first_unique_index(s):
>     counts = {}
>     for ch in s:
>         counts[ch] = counts.get(ch, 0) + 1
>     for i, ch in enumerate(s):
>         if counts[ch] == 1:
>             return i
>     return -1
> ```
> 
> ## Complexity
> Time O(n), two passes over the string. Space O(k), where k is the number of distinct characters, which is bounded by the alphabet size.

### Seminar — dev (30 questions; main scores 8.89 on 30 judged)

#### ER-D-SEM-001 · grounded_single · heard

**Question:** Okay, and the rules that are already running in those schools today, how did they score? Just so I have a reference point.

**A correct answer:** The presenter gives the incumbent rule set's result: RB-28 reached an F1 of 0.71 on the held-out buildings (median delay 126 minutes). One or two sentences, no tour of every baseline.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The rule set running in the estate today is RB-28, and on the held-out buildings it scored an F1 of 0.71, with a median detection delay of 126 minutes and 34 false alarms. It detected 122 of the 187 episodes, so a recall of 0.65 and precision of 0.78. The long delay comes from the 30-minute timers on 17 of its 28 rules.

#### ER-D-SEM-002 · grounded_single · typed

**Question:** what was our isolation accuracy again? and out of how many

**A correct answer:** Natively reminds the presenter: isolation accuracy 81.5%, that is 128 of the 157 detected episodes assigned to the correct fault class.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Isolation accuracy was **81.5%**, which is 128 of the 157 episodes TERN detected, from the camera-ready paper and the results table. The 29 errors were mostly valve-versus-drift confusions.

#### ER-D-SEM-003 · grounded_single · heard

**Question:** Why this design, though? Why not just train a big neural net on the logs like everybody else does?

**A correct answer:** The presenter gives the paper's own reasons: labelled faults are too scarce for a supervised model; the thermal-balance model works from a few weeks of ordinary operation and removes weather and occupancy effects; conformal detection lets the false-alarm rate be set in advance, which the facilities team asked for; and each residual points at a physical component.

**Main's answer** (Astra **9.2** · needed facts in the prompt: yes):

> Because a big net learns what normal looks like, and a cold snap or an evening event also looks abnormal to it. It has no principled alarm threshold, and we had 412 verified faults in 17 months across all units, far too few to train on. The thermal-balance model absorbs weather and occupancy, so the residuals are mostly equipment, and conformal calibration gives the facilities team the false-alarm dial they asked for. Our LSTM autoencoder baseline reached an F1 of 0.79 with 49 false alarms, against 0.87 and 16 for TERN.

#### ER-D-SEM-004 · grounded_single · heard

**Question:** What would you say are the main weaknesses of this work?

**A correct answer:** The presenter names the limitations the paper itself lists, led by the single estate of daytime-occupied schools with no second site or external dataset, plus at least one more (five fault classes and single faults only; imperfect work-order labels and easier injected faults; commissioning window assumed fault-free; weak sensor-drift recall; non-randomised pilot). No invented weaknesses, no claim of generality.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The limitations section is where I'd point first. All the data come from one estate in one temperate maritime climate, every building is a school occupied only in the daytime, and we never evaluated on a second estate or an external dataset, so transfer is unknown. The evaluation also covers five fault classes and single faults only, the 11 overlapping-fault episodes were excluded, and faults outside those five classes aren't scored.
> 
> The labels are imperfect too. Work orders miss faults, as our own audit showed, and injected faults are easier to find than natural ones, so results on injected faults alone would flatter any method. We also assume the commissioning window is fault-free, so a unit already faulty in its first six weeks would have that fault built into its model.
> 
> Sensor drift is the clearest technical weak spot, with recall of 0.64 against 0.93 for stuck dampers, and isolation accuracy is 81.5%, with most of those errors confusing a leaking valve with drift. And the pilot energy comparison is observational, not randomised, so we make no causal claim there.

#### ER-D-SEM-005 · grounded_single · heard

**Question:** So are you saying the system caused the energy drop? Has that actually been shown?

**A correct answer:** The presenter says no: the pilot comparison is observational, the buildings were picked by the facilities team rather than at random, one had a new boiler, and the paper makes no causal claim. The 6.8% against 1.9% difference is an association.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No, and I want to be careful there. The pilot energy result is an association, not a cause. The four pilot buildings were chosen by the facilities team, not assigned at random, and one had its boiler replaced in August 2025, so a before-and-after comparison can't separate TERN from those differences. We make no causal claim about energy savings.

#### ER-D-SEM-006 · grounded_single · typed

**Question:** remind me what the ablation showed, quick

**A correct answer:** Natively summarises the three ablations: without the thermal-balance model F1 drops to 0.74 (delay 61 minutes, 38 false alarms); without the conformal stage it is quicker at 29 minutes but raises 44 false alarms (F1 0.81); with frozen calibration F1 0.84, 41 minutes, 27 false alarms. Take-away: the thermal balance gives detection quality, the conformal stage gives the low false-alarm count.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The ablation removes one stage at a time. Without the thermal-balance model, F1 drops to 0.74, median delay grows to 61 minutes, and false alarms rise to 38. Without the conformal stage it's quicker, 29 minutes, but false alarms jump to 44 and F1 falls to 0.81. Freezing the calibration set gives F1 0.84, 41 minutes, 27 false alarms. So the thermal-balance stage carries most of the detection quality and the conformal stage most of the false-alarm reduction. That's section 6.3 of the camera-ready paper, and slide 9 of the seminar deck.

#### ER-D-SEM-007 · grounded_single · heard

**Question:** You keep saying eighty-six units, but the estate's bigger than that, isn't it? What happened to the others?

**A correct answer:** The presenter explains that the estate has 93 units and 7 were removed because more than 20% of their samples were missing, leaving 86.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The estate has 93 units. We dropped 7 because more than 20% of their one-minute samples were missing, four from failed loggers and three decommissioned during collection. That leaves the 86 we report on, and the held-out evaluation is 31 of those across five buildings.

#### ER-D-SEM-008 · multi_source · typed

**Question:** how was the lstm baseline configured? someone will ask if it was a fair fight

**A correct answer:** Natively gives the configuration from the supplement (2 layers with 64 hidden units, 120-minute input window, 40 epochs, learning rate 0.001, batch size 256, alarm at the 99th percentile; 5 seeds with the mean reported; chosen by grid search on the development buildings like every other setting) and the fairness point from the paper: it received the same 23 points, the same commissioning window and the same persistence rule as TERN.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The LSTM-AE baseline is a recurrent autoencoder trained per unit on the same 42-day commissioning window TERN uses, with 2 layers and 64 hidden units reading a 120-minute input window, trained for 40 epochs at a learning rate of 0.001 and batch size 256. It alarms when reconstruction error exceeds the 99th percentile, and it's run with the same 10-minute persistence rule as every other system. It was trained with 5 random seeds per unit and the paper reports the mean over seeds, with a standard deviation of 0.012 on F1.
> 
> On the fairness question: it gets the same 23 measured points, the same commissioning window, and the same persistence rule, and its hyperparameters were chosen by grid search on the nine development buildings, never on the held-out ones. The one asymmetry worth naming is that TERN's thermal-balance stage is physics the autoencoder doesn't get, but that's the method being compared, not a handicap. The supplementary also reports a paired delay comparison: on the 139 episodes both systems detected, TERN alarmed first in 104, median paired difference 15 minutes in TERN's favour.

#### ER-D-SEM-009 · grounded_single · heard

**Question:** Those false alarms. How do you know they're actually false? Maybe your system's right and the logbook's wrong.

**A correct answer:** The presenter concedes the point with the audit: the lead technician re-inspected all 16; he judged 5 to be real faults that were never logged and 11 genuine false alarms; all 16 are still counted as false alarms in the reported figures, so the numbers are conservative.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The audit is exactly the answer to that. The lead technician re-inspected the units behind all 16 of TERN's false alarms, and he judged 5 of them to be real faults that had never been logged, and 11 to be genuine false alarms. So you're right that the logbook is imperfect, and we say so. But all 16 still count as false alarms in the reported figures, so the number we quote is the conservative one.

#### ER-D-SEM-010 · grounded_single · typed

**Question:** did we tune anything on the buildings we held back? want to be sure before i say it out loud

**A correct answer:** Natively confirms: no. The split is by whole building; the nine development buildings were used to learn fault signatures and choose hyperparameters, and the five held-out buildings were used only for the final evaluation.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> No. The slides say it directly: whole buildings held out, nothing tuned on them. Every hyperparameter was chosen by grid search on the nine development buildings, and the held-out buildings were not used for any of those choices. So you can say that out loud.

#### ER-D-SEM-011 · grounded_single · heard

**Question:** How much data does a brand-new unit need before your method can start watching it?

**A correct answer:** The presenter says six weeks (42 days) of the unit's ordinary operation, with no labelled faults needed for that unit.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Six weeks of ordinary operation. The thermal-balance model is fitted on the first 42 days of that unit's data, the commissioning window, and it needs no labelled faults for the new unit. The supplementary material shows why six weeks: a two-week window gives an F1 of 0.77 and four weeks 0.85, but the gain flattens after six, since eight weeks gives the same 0.87, so six weeks is the least data that reaches it. One caveat I'll say out loud: that window is assumed fault-free, so a unit already faulty in its first six weeks would have the fault built into its model.

#### ER-D-SEM-012 · multi_source · heard

**Question:** How does this stack up against Corvane-Net? They're reporting numbers up in the nineties.

**A correct answer:** The presenter says there is no head-to-head: Corvane-Net was never run on the study's data (no public code, and it needs an equipment graph the estate's BMS cannot export). Its reported 0.94 is the other group's figure on their own office campus with injected faults only, so it is not comparable with TERN's result on schools with mostly natural faults. The presenter must not claim to beat or lose to it.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> We didn't run Corvane-Net on our data, so there's no head-to-head. Their F1 of 0.94 and 19-minute delay come from the Larkhill office campus, 140 AHUs, and every one of their faults is injected, with no natural faults at all. Ours is 0.87 on schools with mostly natural faults, so the two aren't comparable, and nobody knows which method would win on the same buildings. We couldn't run it anyway: there's no public code, and it needs the equipment graph, which the Brackenfirth BMS can't export.

#### ER-D-SEM-013 · grounded_single · heard

**Question:** I'll be blunt. Why should I believe an F1 like that? It's one team and one dataset.

**A correct answer:** The presenter defends the result with what the paper actually contains: whole buildings were held out and nothing was tuned on them; the 95% interval on F1 is 0.83 to 0.90 and every held-out building is at 0.80 or above; the false-alarm audit keeps the figures conservative. The presenter should concede that it is a single estate without external validation rather than overclaim.

**Main's answer** (Astra **3.0** · HARD FAIL · flags: unsupported_research_claim, major_factual_error · needed facts in the prompt: yes):

> Fair challenge, and the honest answer is that the F1 isn't resting on one team or one dataset. The split was by whole building, never by unit or time, so nine buildings were used to learn fault signatures and set hyperparameters, and five buildings with 31 units and 187 episodes were held out and touched only for the final evaluation. Resampling units 2,000 times gives a 95% interval of 0.83 to 0.90, and across those five held-out buildings the F1 ranged from 0.80 to 0.93, so it isn't one lucky building carrying the number.
> 
> That said, you're right about the bigger limit, and I'd rather say it than defend it. All the data come from a single estate in one temperate maritime climate, every building is a school occupied in the daytime only, and we never evaluated on a second estate or an external dataset, so how well it transfers is genuinely unknown. The clearest evidence I know of that single-site numbers shrink when a detector moves is the Hesketh-Mbeki cross-estate study, which went from 0.75 on its home site to 0.59 averaged over two external sites. That's why the next step is a stepped roll-out across 12 buildings with the switch-on order drawn at random.

#### ER-D-SEM-014 · multi_source · typed

**Question:** how far under the facilities team's false alarm limit are we, same units for both?

**A correct answer:** Natively puts both in false alarms per 100 unit-months: the limit of one per unit per term equals 25, TERN measured 3.2. So TERN is 21.8 per 100 unit-months under the limit, that is roughly 8 times below it (about 13% of it, or about 87% under). Either way of stating the margin is right, as long as both figures are in the same unit.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> TERN raised 16 false alarms, which is 3.2 per 100 unit-months. The facilities team's limit of one per unit per term works out to 25 per 100 unit-months, so we're about 21.8 per 100 unit-months under it, roughly a seventh of the allowance. That's from the camera-ready paper and the supplementary material, which spells out the term-to-unit-months conversion.

#### ER-D-SEM-015 · multi_source · heard

Said before:

> other: I look after the buildings for a neighbouring council. We've got about forty air handlers across our sites.
> other: My technicians already complain about nuisance alarms from the rule engine.

**Question:** So if I ran your thing on my forty units, roughly how many false alarms am I looking at over a year?

**A correct answer:** The presenter scales the measured rate to the questioner's estate: 3.2 false alarms per 100 unit-months times 40 units times 12 months is about 15 a year. It is an estimate from the Brackenfirth schools, not a guarantee for another estate.

**Main's answer** (Astra **3.0** · HARD FAIL · flags: arithmetic_error, major_factual_error, unsupported_research_claim · needed facts in the prompt: yes):

> On our held-out buildings TERN ran at 3.2 false alarms per 100 unit-months, so forty units over a year works out to roughly **15 or 16** false alarms, about one per unit per term. That's the rate the facilities team asked us to hold, and it's well below what the rule engine gives you now.

#### ER-D-SEM-016 · multi_source · heard

**Question:** Then what would it take to actually pin the energy saving on your system? Is anything like that planned?

**A correct answer:** The presenter says the current pilot cannot do it because it was observational, and that the plan is a stepped roll-out across 12 buildings in the 2026-27 heating season with the switch-on order drawn at random. It is a plan, with no results yet.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The pilot was observational, so we can't pin the saving on TERN. The four buildings were picked by the facilities team, not assigned at random, and one had its boiler replaced in August 2025. What's planned is a stepped roll-out across 12 buildings in the 2026, 27 heating season, with the switch-on order drawn at random, so the energy effect can be estimated properly.

#### ER-D-SEM-017 · multi_source · typed

**Question:** real vs injected faults: which of the other systems in my notes used real ones, and what share of ours were natural?

**A correct answer:** Natively separates the two worlds. From the notes: Corvane-Net used injected faults only and AeroFormer is simulation only; MineRule-V worked on a real site's historical alarm logs (so presumably real faults, though the notes do not say so outright), and the notes do not say what the CrossEstate detector used. From the paper: 412 of the study's 508 episodes are natural, about 81%, and 96 were injected.

**Main's answer** (Astra **3.0** · HARD FAIL · flags: unsupported_research_claim, missed_available_evidence, important_question_unanswered · needed facts in the prompt: yes):

> On the other systems in my notes, Corvane-Net is the one that's all injected, no natural faults at all, on the Larkhill office campus. AeroFormer is simulation only, so also injected. MineRule-V and the CrossEstate study work from real logged faults, and the Tolland corpus has a fault log.
> 
> For ours, the held-out buildings have 187 episodes, 145 natural and 42 injected, so about 78% natural. TERN's recall was 0.95 on injected against 0.81 on natural.

#### ER-D-SEM-018 · conflict_stale · heard

**Question:** So what accuracy did you actually get in the end? For detection, I mean.

**A correct answer:** The questioner means the headline detection result. The presenter gives the final paper's figure: an F1 of 0.87 on the held-out buildings (precision 0.91, recall 0.84). The March draft abstract and the March export say 0.82; that figure is superseded and must not be given. The paper's isolation accuracy of 81.5% is about naming the right component once a fault is detected; it may be added but is not the answer to this question.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> On the held-out buildings, TERN got an **F1 of 0.87**, with precision 0.91 and recall 0.84. It detected 157 of the 187 episodes, with a median detection delay of 34 minutes and 16 false alarms. The 95% interval on that F1 is 0.83 to 0.90.

#### ER-D-SEM-019 · conflict_stale · heard

**Question:** The abstract you sent round in the spring said forty-eight minutes, and now your results slide says thirty-four. Which one is it?

**A correct answer:** The presenter says 34 minutes is the result: it is the figure in the final paper. The 48 came from the March draft, written from an earlier run before the calibration window was changed and the very short episodes were dropped. The presenter does not defend 48 or call both valid.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Thirty-four minutes is the current number. The 48 came from the March run, pipeline 0.6, before the calibration window changed and before we dropped the very short episodes. The camera-ready paper and the results table both report 34 minutes on the held-out buildings.

#### ER-D-SEM-020 · conflict_stale · typed

**Question:** median delay on clogged filters, what's the number? i've got two spreadsheets open and they disagree

**A correct answer:** Natively gives 71 minutes, from the results table whose rows are pipeline v1.2 run on 21 August 2026, and says the 95 minutes is from the older v0.6 export of 9 March 2026. Only the version and run-date columns tell the two tables apart.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> For fouled filters specifically, TERN's median detection delay is **71 minutes**, with an IQR of 44 to 118. That's from the results table, pipeline v1.2, run 21 August 2026, on the held-out buildings: 31 of 39 fouled-filter episodes detected, recall 0.79. The note there says filters foul gradually, so the fan-pressure residual moves late.
> 
> If one of your spreadsheets is showing something different, it's likely the older March run. That one, pipeline v0.6, has fouled filter at 95 minutes median, but it used a calibration set fixed at the commissioning window and still included episodes under 10 minutes, so it isn't the number to quote.

#### ER-D-SEM-021 · conflict_stale · heard

**Question:** How many fault events were there in the buildings you held back, and how many of those slipped past you?

**A correct answer:** The presenter uses the final figures: 187 labelled episodes in the held-out buildings, 157 detected, so 30 were missed. The March export's 201 episodes and 163 detections are superseded.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The held-out buildings had **187 labelled fault episodes**, and TERN detected **157** of them, so 30 slipped past. That's a recall of 0.84. The misses aren't spread evenly: recall was 0.93 on stuck dampers but only 0.64 on sensor drift, which develops slowly and gets partly absorbed by the rolling calibration. On injected faults recall was 0.95, against 0.81 on the natural ones from work orders.

#### ER-D-SEM-022 · conflict_stale · heard

**Question:** Did you compare against anything learned, or is it just the hand-written rules you're beating?

**A correct answer:** The presenter says two learned baselines were run alongside the rule set: an LSTM autoencoder (F1 0.79) and PCA with Hotelling's T-squared (0.66). The March draft's note that only the rule set had been run is out of date.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> We compared against three systems on the same 23 points: the estate's own rule set, RB-28, which is the 28 vendor rules running in the BMS today, plus an LSTM autoencoder and PCA with Hotelling's T². So it's not just hand-written rules. On the held-out buildings TERN gets an F1 of 0.87 against 0.79 for the autoencoder and 0.71 for RB-28, and the autoencoder is the closest learned baseline at 49 false alarms against our 16.

#### ER-D-SEM-023 · irrelevant_source · heard

**Question:** Sorry, non-specialist here. When you say p-value, what does that actually mean, in a sentence?

**A correct answer:** A general-knowledge explanation in plain words: a p-value is how probable it is to see something at least this extreme if nothing unusual is going on; a small one means the observation is surprising under normal behaviour. The papers and tables are not needed and the answer must not turn into a recital of the study's thresholds or results.

**Main's answer** (Astra **8.8**):

> A p-value here is the probability, under normal operation, of seeing a residual at least as extreme as the one we just saw, so a small p-value means that window looks unusual. We turn those into an alarm only when they stay small, which is what lets us set the false-alarm rate in advance.

#### ER-D-SEM-024 · irrelevant_source · heard

**Question:** We've got maybe five minutes left. Do you want to take one more, or shall we stop here?

**A correct answer:** A present decision by the presenter, for example 'Happy to take one more.' No document is needed; the reply is one short sentence. Reciting study results or summarising the paper here is a failure.

**Main's answer** (Astra **9.9**):

> Yes, let's take one more. I'd rather use the last few minutes on the part of this you find least convincing, so go ahead.

#### ER-D-SEM-025 · irrelevant_source · typed

**Question:** what's the difference between grey-box and black-box models again, one line

**A correct answer:** General knowledge, one or two lines: a grey-box model keeps the known physical structure and fits a few parameters from data; a black-box model learns the input-output mapping from data alone with no physical structure. The uploaded material is not required.

**Main's answer** (Astra **9.3**):

> Grey-box keeps the physics structure and fits a handful of parameters, while black-box learns the input-output behaviour with no physical structure at all. In the paper's background, grey-box models are the ones that keep the structure of the physics and fit a few parameters, and the data-driven detectors like autoencoders and PCA are the black-box side.

#### ER-D-SEM-026 · missing_evidence · heard

**Question:** Have you tried this in a hospital? Those air systems run round the clock.

**A correct answer:** Nothing in the material reports a hospital. The presenter must not claim or invent a hospital trial or result, and must not assert how TERN would behave there. A useful honest reply says the study covered school buildings occupied in the daytime, so round-the-clock buildings were not part of it and remain open.

**Main's answer** (Astra **9.7**):

> All of our data comes from one school estate in a single temperate maritime climate, and every building is occupied in the daytime only, so how well it transfers to a hospital running round the clock is unknown. That's the first limitation in the paper. The thermal-balance model absorbs weather and occupancy, and the calibration window rolls forward on the unit's own recent alarm-free days.

Draft before the fix-up pass (Astra 9.0):

> No, we haven't run it in a hospital. All of our data comes from one school estate in a single temperate maritime climate, and every building is occupied in the daytime only, so how well it transfers to a hospital running round the clock is unknown. That's the first limitation in the paper. What I can say is that the method itself doesn't assume a school schedule: the thermal-balance model absorbs weather and occupancy, and the calibration window rolls forward on the unit's own recent alarm-free days, so a continuously running unit is the kind of setting I'd want to test next.

**E19 candidate, in the app** (Astra **9.5**):

> No, we haven't run it in a hospital. All our data is from the Brackenfirth school estate, 14 buildings and 86 units, and every one of them is a school occupied in the daytime only. So the round-the-clock duty cycle is exactly the kind of transfer question we can't answer yet. What I'd want to check is whether the thermal-balance model still fits when the unit runs through the night, since our commissioning window is restricted to occupied hours, and whether the rolling calibration holds up when there's no daily off period to reset against.

#### ER-D-SEM-027 · missing_evidence · heard

**Question:** Remind us of the headline figures, would you? Your F1 and the baseline's.

**A correct answer:** No reference material is loaded for this mode. Natively must not make up an F1, a baseline score or any other figure. It should give the presenter something sayable that carries no invented number, for instance pointing the audience to the results slide, or tell the presenter plainly that it has no figures to hand.

**Main's answer** (Astra **9.6**):

> I'd rather not give you a number I can't stand behind. Let me pull up the F1 and the baseline and I'll walk you through both as soon as I have them.

Draft before the fix-up pass (Astra 9.6):

> I don't have those figures in front of me right now, so I'd rather not give you a number I can't stand behind. Let me pull up the F1 and the baseline and I'll walk you through both as soon as I have them.

#### ER-D-SEM-028 · missing_evidence · typed

**Question:** do we say anywhere what hardware it runs on or what it costs per building? someone's bound to ask

**A correct answer:** None of the documents states hardware, runtime, latency or a cost per building. Natively says so plainly and does not supply a figure; it may note that the model is small (7 parameters per unit, a least-squares fit) while making clear that no runtime or cost is reported.

**Main's answer** (Astra **3.0** · HARD FAIL · flags: unsupported_research_claim, important_question_unanswered):

> No, neither the paper nor the slides say what hardware TERN runs on. The only deployment detail we give is the live pilot: four buildings, 63 alerts, 51 acted on within two working days. If someone asks, I'd say we haven't settled that yet.

Draft before the fix-up pass (Astra 9.6):

> No, neither the paper nor the slides say what hardware TERN runs on, and there's no cost per building anywhere in the material. The only deployment detail we give is the live pilot: four buildings, 63 alerts, 51 acted on within two working days. If someone asks, I'd say we haven't published that yet.

**E19 candidate, in the app** (Astra **9.6**):

> No, neither the slides nor the paper say anything about hardware or a per-building cost. The paper covers the method, the dataset, the results and the pilot, and the slides stop at the limits and next steps. If someone asks, I'd say we haven't published a cost figure and take it from there.

#### ER-D-SEM-029 · followup · heard

**Question:** Tell me about the live deployment. How many alerts went out, and did anybody actually act on them?

**A correct answer:** The presenter says TERN sent 63 alerts during the pilot and 51 of them were acted on within two working days.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> In the live pilot, from 3 November 2025 to 9 January 2026, TERN ran in four buildings and sent **63 alerts**. Of those, **51 were acted on** within two working days, 9 later, and 3 were dismissed as not worth a visit.

#### ER-D-SEM-030 · followup · heard

**Question:** And the rest of them?

**A correct answer:** Continuing the previous answer: of the remaining 12 alerts, 9 were acted on later and 3 were dismissed by staff as not worth a visit.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The other 12 break down as 9 acted on later than two working days and 3 that staff dismissed as not worth a visit, so all 63 are accounted for. The pilot ran from 3 November 2025 to 9 January 2026 in four buildings, and the energy comparison over those weeks was an association, not a causal claim.

### Call Center — dev (30 questions; main scores 8.68 on 30 judged)

#### ER-D-CC-001 · grounded_single · heard

**Question:** Before I stick one of these in my kid's room, I need to know something. Can your employees see inside my house? Like, can somebody over there just pull up my cameras?

**A correct answer:** A plain, reassuring no in the agent's own voice: nobody at the company, at any level, can watch the live view, and agents cannot open or play recordings. The two narrow routes by which a recording can be seen (a clip the customer chooses to share, for 72 hours, by one assigned engineer; a court order or warrant) may be mentioned briefly but are not required. No policy name, no reading out of the document.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> No, nobody here can pull up your cameras. There's no internal tool that opens a live stream, and the video is encrypted between the camera and the devices signed in to your account. Tier 1 agents like me can't open, play or download a clip either. What we can see is just whether a camera is online, its firmware version and how many motion events came through.

**E19 candidate, in the app** (Astra **9.9**):

> No, nobody here can pull up your cameras. There's no internal tool that opens a live stream, and Tier 1 agents can't open, play or download a clip. The only way staff see a recording is if you share one clip yourself through Share with Support, and even then it's one clip, for 72 hours, logged, and you can withdraw it any time. What we can see is just whether each camera is online, its firmware version, and how many motion events were recorded.

#### ER-D-CC-002 · grounded_single · heard

**Question:** I want every single recording gone. Delete all of it, right now, while I've got you on the phone.

**A correct answer:** The agent cannot delete recordings from the console and must not say they have. The customer can do it at once in the app (Settings > Privacy > Delete all recordings, password asked). The honest timing: clips vanish from the account immediately, are erased from primary storage within 24 hours and from backups within 30 days, and it cannot be undone; saying that they go from the account at once is enough, the storage timings are a welcome extra. If the customer cannot use the app, the agent offers the deletion request route. The reply should give the customer the fastest working path, not a refusal.

**Main's answer** (Astra **9.1** · needed facts in the prompt: yes):

> I can help you get that done. Deleting recordings is something you do yourself in the app, under Settings, then Privacy, then Delete all recordings, and it asks for your account password first. Once you confirm, the clips come out of your account right away, they're erased from primary storage within 24 hours and from backups within 30 days, and it can't be undone. If you'd rather I file it for you, I can do that, but first I need to verify you on the account. Can you give me the full name on the account, the billing postal code, and the last four digits of the card on file?

#### ER-D-CC-003 · grounded_single · typed

**Question:** cam still offline after a bunch of steps. when do I escalate this to tier 2 vs keep going?

**A correct answer:** Private advice to the agent with the three triggers for Tier 2 Device Diagnostics: all six troubleshooting steps done and the fault remains; the light is solid red; or it is the customer's third contact about the same fault within 14 days, even if the steps were not all repeated. Handover details are a bonus.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Escalate to Tier 2 Device Diagnostics once all six steps are done and the camera is still offline. That's the rule, and it's also the trigger if the light is solid red, or if this is the customer's third contact about the same fault within 14 days, even if you didn't repeat every step on this call.
> 
> So if you've worked through all six and it's still down, stop there and hand it over. Before you do, write up what the customer reported, the steps already done, plus the light colour and firmware version. If Tier 2 is staffed, warm transfer, they're on Monday to Saturday, 8:00 am to 8:00 pm Central. Outside those hours, open a ticket and they make first contact within 1 business day.

#### ER-D-CC-004 · grounded_single · heard

**Question:** I'm paying for the expedited, it's for my dad's birthday. Can you guarantee Friday?

**A correct answer:** No guarantee: the company does not guarantee a delivery date on any method and the agent must not promise a day. The useful part is the estimate: Expedited is 2 to 3 business days after dispatch. Optionally, Next Business Day ($29.00, ordered by 1:00 pm Central) refunds its shipping charge if late, which still is not a guarantee.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> I'm not able to guarantee a specific delivery day on any method, so I can't promise Friday. What I can tell you is that Expedited is estimated at 2 to 3 business days after dispatch, and that estimate is what we quote. If it helps, I can check where the order is right now and give you the current status. Can you give me the order number?

#### ER-D-CC-005 · grounded_single · heard

**Question:** This is Detective Halloran-Voss with the Pinemarsh County Sheriff's Office. I need the footage from a camera at 44 Larch Road for last Saturday night. Can you pull that for me?

**A correct answer:** The agent neither confirms nor denies that any account or camera exists at that address, shares nothing, and points the caller to the Legal Response team (legalresponse@brindlewatch.example), the only team that handles police requests. Mentioning that recordings are released on a warrant or court order, and that Legal Response handles emergencies around the clock, is helpful. Polite and brief.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> I can't pull footage or confirm anything about an account on this call. Every request from police, a court or a lawyer goes to our Legal Response team, and only they handle it. The address for that is legalresponse@brindlewatch.example. Recordings are only handed over in response to a search warrant or court order, and Legal Response is the team that works through that with you. I'll log this call now, and if you send your request to that address, they'll take it from there.

#### ER-D-CC-006 · grounded_single · typed

**Question:** she pays for Keep Plus through the app store on her phone, not through us. wants this year's charge back. can I refund that?

**A correct answer:** No: a subscription billed through a phone's app store is outside the refund policy. Brindlewatch cannot see or reverse that charge, so the agent cannot refund it or send it to a supervisor; the customer has to ask the app store. The advice should say that plainly and give the agent a helpful way to put it, without inventing the app store's own refund rules or deadlines.

**Main's answer** (Astra **9.3** · needed facts in the prompt: yes):

> No, we can't refund that one. Subscriptions billed through a phone's app store are outside our refund policy, since we can't see or reverse those charges. She'll need to request the refund from the app store directly, through her purchase history or subscriptions settings on the phone. If she'd rather move the billing to us going forward, I can help her switch to billing directly with Brindlewatch.

#### ER-D-CC-007 · grounded_single · heard

**Question:** The tracking hasn't moved in eight business days. Last thing it shows is leaving some depot and then nothing, it never said delivered. And I'm only in Wisconsin, it's not going overseas.

**A correct answer:** Customer's facts: no delivered scan, no movement for eight business days, a US address. That is past the 5-business-day threshold, so the parcel is treated as lost and a Tier 1 agent sends a replacement straight away, with no carrier trace. Here the agent does have the authority and should simply do it (confirming the address is sensible).

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Eight business days with no movement and no delivered scan is past our threshold, so I can treat this as lost in transit and send a replacement straight away, no trace needed. Before I do anything on the order, I need to verify you on the account. Can you give me your full name as it's spelled on the account, the billing postal code, and the last four digits of the card on file?

#### ER-D-CC-008 · grounded_single · heard

**Question:** If I do that factory reset thing, am I going to lose all the videos it's already saved?

**A correct answer:** No: a factory reset does not delete recordings already in the cloud and does not change the plan. It does clear the camera's Wi-Fi settings and activity zones, so the camera has to be paired again. How to do it (hold the button 12 seconds until the light blinks amber) is optional.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No, you won't lose them. A factory reset clears the camera's Wi-Fi settings and activity zones, but it doesn't delete recordings already saved in the cloud, and it doesn't change your plan. So once you pair the camera again in the app, everything that's already been recorded will still be there.

#### ER-D-CC-009 · grounded_single · heard

**Question:** I keep hitting forgot password and nothing ever shows up. Can't you just set a new password for me and tell me what it is?

**A correct answer:** The agent cannot see or set a password and says so plainly, then moves the call on: they can trigger the reset e-mail to the login address on file, it can take up to 5 minutes, and the customer should look in junk and promotions folders. The 30-minute expiry and the limit of 5 reset e-mails in 24 hours are relevant extras (the customer has been pressing it repeatedly).

**Main's answer** (Astra **9.1** · flags: missed_available_evidence · needed facts in the prompt: yes):

> I can't set a password for you or read one out, and no one here can see your password. What I can do is trigger the reset for you. First, though, I need to verify you: can you give me your full name as it's on the account, the billing postal code, and the last four digits of the card on file?

#### ER-D-CC-010 · grounded_single · heard

**Question:** The camera got here on August 3rd. If I decide it's not for me, what's the last day I can send it back?

**A correct answer:** A camera bought directly can be returned within 60 days of delivery. 3 August 2026 plus 60 days is 2 October 2026 (28 days to 31 August, 30 to 30 September, 2 more). The agent states that date. The $8 label deduction for a non-defective return is a useful extra. The 30-day figure is the annual-plan refund window and must not be used here.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The camera arrived on August 3rd, and our return window is 60 days from the delivery date, so the last day to send it back is **October 2nd**. That date has passed, so a return for a change of mind isn't available now. What's going on with the camera? If it's not working the way it should, it may still be covered under the two-year warranty, and I'd like to help with that.

#### ER-D-CC-011 · grounded_single · heard

**Question:** My Trek cam went through 5.4 gigs last month sitting up at the cabin. What's that going to cost me on top of the regular fee?

**A correct answer:** Each Trek Cam includes 3 GB a month; extra data is $4 per GB with a part GB rounded up. 5.4 GB is 2.4 GB over, billed as 3 GB: $12 on top of the $5 monthly Roam Link fee ($17 for that camera in total).

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> Roam Link includes 3 GB a month, and extra data is $4 per GB with any part GB rounded up. So 5.4 GB is 2.4 GB over, billed as 3 GB, which is $12 on top of the $5 monthly Roam Link fee, so $17 total for that camera. Before I go further, can you confirm the full name on the account and the billing postal code?

#### ER-D-CC-012 · multi_source · heard

Said before:

> other: We took the camper up into Canada over the long weekend. Crossed the border Thursday night around ten, and we were back on the US side Sunday morning.
> user: And how many Trek cams did you have with you?
> other: Both of them. They were running the whole time.

**Question:** So why was I charged $80 if I used roaming three days?

**A correct answer:** The agent explains the charge from the customer's own facts. Roam Days are calendar days in the account's home time zone, not 24-hour periods: Thursday night to Sunday morning touches four calendar days (Thursday, Friday, Saturday, Sunday). Each Trek Cam is charged separately and there were two. Canada is Zone 1 at $10 per camera per day: 2 x 4 x $10 = $80. The charge is consistent with the rules; the agent does not call it an error or promise to remove it. A first-trip courtesy credit (up to $30) may be mentioned only as something the agent can check, and the Roam Week pass as a tip for next time.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: missed_available_evidence, major_reasoning_error, important_question_unanswered, excessive_deferral · needed facts in the prompt: yes):

> I can see the $80 on the invoice, and I want to get to the bottom of it with you. A Roam Day is a calendar day, midnight to midnight in your home time zone, and any connection to a partner network on a day counts, even a short one. In Canada that's $10 per camera per day, and each Trek Cam is charged separately, so two cameras over three calendar days would come to $60. Can you confirm both Trek cams were powered on and connected the whole time you were across the border?

#### ER-D-CC-013 · multi_source · heard

**Question:** I'm on the yearly Pro and it's way more than I need. If I drop down to Plus now, with seven months still left on it, do I get anything back?

**A correct answer:** Yes, as account credit. The refund policy gives the formula (old annual price minus new annual price, divided by 12, times full months remaining) and the billing guide gives the prices: ($220 - $130) / 12 x 7 = $52.50. It is credit against future charges, not money back on the card.

**Main's answer** (Astra **8.4** · flags: missed_available_evidence, excessive_deferral · needed facts in the prompt: yes):

> The good news is you don't lose the time you've paid for. Moving down to Plus mid-term gives you a credit for each full unused month, worked out as the difference between the two annual prices divided by twelve, times the full months left. It goes on as account credit against future charges rather than back to your card. I can't see your exact figures from here, so let me pull up the account and work out what that credit comes to for you.

#### ER-D-CC-014 · multi_source · heard

Said before:

> other: I ordered two of the Eave cams last week.
> user: I can see the order here. The carrier scanned it as delivered yesterday at 2:40 in the afternoon.

**Question:** Right, so my package says delivered but it isn't here. Nothing on the porch, nothing in the mailbox. Can you just send out another one?

**A correct answer:** Not yet, and the agent says why in a helpful way. The delivered scan was yesterday afternoon, so the 48-hour wait has not run out (carriers sometimes scan early). The agent asks the customer to check with the household and neighbours and confirms the address; if it has not turned up once the 48 hours are over, the agent opens a carrier trace, and only if the trace fails is a replacement (or refund) issued. The agent does not promise a replacement now.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> I can't send a replacement out just yet, and I want to be straight with you about why. When tracking shows delivered but nothing's arrived, the first step is checking with others in the household, neighbours, a building office or mail room, and around side doors and garages. Carriers also sometimes scan a parcel as delivered before it's actually dropped off, so we wait 48 hours from that scan before opening a carrier trace. If it still hasn't turned up after that, I open the trace, and if the carrier can't find it you choose between a free Expedited replacement or a refund. Can you confirm the delivery address on the order for me, and have a quick look with anyone else at the address?

#### ER-D-CC-015 · multi_source · typed

**Question:** customer has no smartphone anymore, can't get into the app. wants all her recordings wiped. what do I actually do?

**A correct answer:** Two documents: the privacy policy says an agent cannot delete from the console and, when the customer cannot use the app, files a Deletion Request (form DR-2) after step-up verification, which the Privacy Office completes within 4 business days and confirms by e-mail. The verification standard says what step-up is: a 6-digit one-time code sent to the phone number or e-mail on file, valid 10 minutes, read back by the customer.

**Main's answer** (Astra **8.8** · needed facts in the prompt: yes):

> I'm sorry she's in that spot. Here's what we can do.
> 
> She can't delete recordings herself without the app, and I can't delete them from my side. What I can do is verify her, then file a Deletion Request, form DR-2, and the Privacy Office carries it out within 4 business days and confirms by e-mail. So first, can you give me three of these: the full name on the account, the login e-mail address, the billing postal code, the last four digits of the card on file, or the serial number of a registered camera, which starts with BW.
> 
> Once that's done I'll send a 6-digit code to the phone number or e-mail on file, and she reads it back to me. That step-up is required before I can file the deletion request.
> 
> One thing worth telling her now: the clips disappear from the account immediately once it's done, they're erased from primary storage within 24 hours and from backups within 30 days, and it can't be undone.

#### ER-D-CC-016 · multi_source · typed

Said before:

> other: This is the third time I've called about this camera dropping offline, and it's all been in the last two weeks. I am not unplugging my router again.

**Question:** do I have to run all the steps again or can this go to tier 2 now?

**A correct answer:** It can go to Tier 2 now. The customer said this is the third call about the same fault within two weeks, and the escalation matrix sends a third contact about the same fault within 14 days to Tier 2 Device Diagnostics even if the steps were not all repeated on this call. Handover practicalities are a bonus.

**Main's answer** (Astra **9.4** · needed facts in the prompt: yes):

> You don't need to run the steps again. This is your third contact about the same fault within 14 days, and that alone sends it to Tier 2 Device Diagnostics, even if the steps weren't all repeated on this call. I'll write up what you've reported and the steps already done, and hand you over. Tier 2 is staffed Monday to Saturday, 8:00 am to 8:00 pm Central, so if we're inside those hours I'll warm transfer you now. If we're outside them, I'll open the ticket and Tier 2 makes first contact within 1 business day.

#### ER-D-CC-017 · multi_source · heard

Said before:

> user: The carrier has closed the trace. They weren't able to locate the parcel.
> other: Great. So that's three hundred and forty dollars of cameras just gone.

**Question:** So are you sending me a new one today or what?

**A correct answer:** The trace has closed without finding the parcel, so the policy gives the customer a choice: a replacement sent Expedited at no charge, or a refund to the original payment method. But the order is $340, above the $300 a Tier 1 agent may approve, so a supervisor has to approve it. The agent says what the customer is entitled to choose, says a supervisor signs off because of the order amount, and does not promise that it ships today.

**Main's answer** (Astra **7.3** · flags: missed_available_evidence, important_question_unanswered · needed facts in the prompt: yes):

> I'm sorry the trace came back empty. Here's where that leaves us: once a carrier trace closes without finding the parcel, you choose either a replacement sent Expedited at no charge, or a refund to your original payment method.
> 
> Before I set that up, I need to verify the account with you. Can you give me the full name on the account, the billing postal code, and the last four digits of the card on file?

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> I'm sorry the trace came back empty. Here's where that leaves us: once a carrier trace closes without finding the parcel, you choose either a replacement sent Expedited at no charge, or a refund to your original payment method. I can't send a new one out today, though, because the replacement is approved after the trace closes and it ships from our warehouse rather than going out same-day.
> 
> Before I set that up, I need to verify the account with you. Can you give me the full name on the account, the billing postal code, and the last four digits of the card on file?

#### ER-D-CC-018 · conflict_stale · heard

Said before:

> other: I'm calling for my mother. It's her account and she's locked out of the app.
> other: She's right here with me, but she can't really do this over the phone herself.

**Question:** My mom can't hear well. Can you send her reset to my email instead?

**A correct answer:** The current Verification Standard (June 2026) says an accommodation changes how the company communicates, never where credentials go: a reset link goes only to the e-mail on file, never to a helper's address. The 2025 handbook, which allowed an alternate e-mail, is outdated. So the agent declines that one thing and offers what is allowed: with the mother present and consenting (by voice or by replying YES to the consent message) the caller may speak for her on this call; the conversation can move to chat or e-mail to her own address; codes can go by text. Lasting access is by Authorised Contact or Shared Access, neither of which receives reset links. Warm, not a flat refusal.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> I can't send a reset link to your email, I'm afraid. Reset links only ever go to the contact details on the account, so it has to be your mother's login email. What I can do is help her directly, and there are a few ways that work well if hearing is the difficulty. She can stay on the line with you helping her, as long as she's there and consents, and I can send a one-time code by text to the phone number on file instead of reading anything out. Or we can move to live chat, or email to the address on file, whichever is easier for her. Before any of that, I do need to verify the account. Can you give me her full name as it's spelled on the account, the billing postal code, and the last four digits of the card on file?

#### ER-D-CC-019 · conflict_stale · heard

**Question:** My yearly plan renewed on August 29th and it's October 6th today. I never even noticed a reminder. Can you just reverse that charge?

**A correct answer:** 29 August to 6 October is 38 days. The current policy (July 2026) refunds an annual charge only within 30 days of the charge date, so this is outside the window; the 2025 handbook's 45 days is outdated and must not be applied. Not seeing a reminder does not extend the window (reminders go out 21 and 3 days before). The agent says no clearly and kindly, and offers what is real: the plan stays active to the end of the term and auto-renew can be switched off now. If the customer wants a supervisor the agent arranges it without suggesting the answer will differ.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> I do have to be straight with you about the timing. An annual renewal is refundable in full if you ask within 30 days of the charge date, and from August 29th to today is 38 days, so it's just past that window. Not seeing the reminder doesn't extend it, and the plan stays active until the term ends. What I can do is switch off auto-renew right now so it doesn't bill again next year. Before I touch anything on the account, can you confirm the full name on the account and the billing postal code?

#### ER-D-CC-020 · conflict_stale · typed

**Question:** quick one, how many things does a caller need to get right before I can open up the account? and which ones count

**A correct answer:** Current rule: 3 of 5 identifiers (full name on the account, login e-mail, billing postal code, last four digits of the card on file, serial number of a registered camera). The 2025 handbook's 2 of 4 is outdated. Short answer; the old rule need not be mentioned.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The current standard is 3 of 5 identifiers, and the five that count are the full name on the account, the login e-mail address, the billing postal code, the last four digits of the payment card on file, and the serial number of a registered camera. The caller gives them, so never read the e-mail out or complete it for them, and never ask for the full card number, expiry, security code or a password. If they get one wrong they can try once more, and after two failed attempts in the same contact the account is locked for phone and chat verification for 24 hours and they're pointed to Identity Review. I won't say which answer was wrong.

#### ER-D-CC-021 · conflict_stale · typed

**Question:** he's got no access to the old email and there's no phone on file. starting identity review. how long do I tell him it takes?

**A correct answer:** Two current documents disagree: the Recovery Procedure (April 2026) says allow up to 3 business days, the Verification Standard (June 2026) says allow up to 5 business days. Neither says it replaces the other on this point. The right private advice surfaces the discrepancy and tells the agent to give the customer the safe figure (up to 5 business days) or to confirm with Tier 2 Account Integrity, and not to promise 3 days.

**Main's answer** (Astra **8.5** · flags: source_conflict_ignored · needed facts in the prompt: yes):

> Tell him to allow up to 5 business days. Identity Review goes to Tier 2 Account Integrity, and they decide once he's uploaded government photo ID plus either proof of purchase or a photo of the camera's serial label. I'll get the IR-7 started and note on the ticket that there's no phone on file, so he knows what to send.

**E19 candidate, in the app** (Astra **4.0** · HARD FAIL · flags: unsupported_policy_claim):

> Tell him to allow up to **5 business days**. Identity Review goes to the Tier 2 Account Integrity desk, and that's their response target, so it's when they first come back to him, not when the review is finished. What he'll need to upload is government photo ID plus either proof of purchase or a photo of the camera's serial label.
> 
> One thing to flag: the time to allow is given two ways in what I have, up to **5 business days** in one place and up to **3 business days** in another, so confirm which applies before you rely on it.

#### ER-D-CC-022 · conflict_stale · heard

**Question:** Look, I'm his wife, we live at the same address, and I can give you his e-mail, the zip code, and the card ends in 4471. Why can't I just change the plan on his account?

**A correct answer:** Under the current standard only the account holder or a registered Authorised Contact can be helped; a spouse is a third party however much she knows and even at the same address. The 2025 handbook's household-member rule is outdated. The agent explains this without confirming anything about the account and gives the way forward: her husband calls or joins the call, or registers her as an Authorised Contact. The agent must not suggest that an Authorised Contact could change the plan: the standard lists what they may do (troubleshooting, order and billing status, carrier traces) and plan changes are not on it.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> I understand, and I'm sorry, this is frustrating. The rule here is that only the account holder or someone registered as an Authorised Contact can be helped with an account. Spouses and other household members count as third parties, even when you live at the same address and know the details, so I can't confirm anything about the account or change the plan on it.
> 
> What I can do is give you general product and policy information, and there are two ways forward. Your husband can call in himself, or he can add you as an Authorised Contact in the app under Settings, then Account, then Authorised Contacts. Once you're registered, you'd verify with your own name and a 4-digit contact PIN, and you'd be able to get troubleshooting help and check order and billing status. Changing the plan itself would still need him, since that's not something an Authorised Contact can do.

#### ER-D-CC-023 · irrelevant_source · heard

Said before:

> user: Okay, I've opened the trace with the carrier. Your reference is TR-441906, and you'll get an e-mail from us as soon as they answer.
> other: Hang on, hang on, let me find a pen.

**Question:** Okay, got one. What was that reference number again?

**A correct answer:** The answer is in the conversation: the agent just gave the reference TR-441906. The agent repeats it, slowly if they like, and nothing more is needed. Reciting the trace procedure or timings from the shipping policy here is dragging documents into a simple repeat.

**Main's answer** (Astra **10.0**):

> Of course, it's **TR-441906**. I'll stay on the line while you write it down, and you'll get an e-mail from us as soon as the carrier answers.

#### ER-D-CC-024 · irrelevant_source · heard

Said before:

> user: Could you tell me what colour the light on the front of the camera is right now?
> other: It's out in the garage, I'd have to go and look.

**Question:** Do you want me to go and check now, or should I just call you back later?

**A correct answer:** A present decision, not a policy fact. Either choice is fine as long as the agent makes one and keeps the call moving, e.g. 'Go ahead, I'll stay on the line'. No document is needed and no rule should be cited.

**Main's answer** (Astra **9.3**):

> Yes, please go and check now if you can. The light colour tells us a lot, so it's worth the trip out to the garage. If it's easier, I can stay on the line while you look, or I can call you back, I'll confirm a time and come back to you on that.

Draft before the fix-up pass (Astra 9.5):

> Yes, please go and check now if you can. The light colour tells us a lot, so it's worth the trip out to the garage. If it's easier, I can stay on the line while you look, or I'm happy to call you back at a time that suits you.

#### ER-D-CC-025 · irrelevant_source · typed

**Question:** caller is furious about his bill and keeps talking over me. give me one line to calm it down before I start explaining

**A correct answer:** General call-handling skill: one short, human line the agent can say (acknowledge the frustration, say they will go through the bill together). Nothing from the policies is needed. The customer is upset, not abusive, so the abusive-caller rule does not apply, and no credit or refund should be offered as a calming device.

**Main's answer** (Astra **9.5**):

> I hear you, and I'm not going to argue with you about the bill. Give me one minute to pull up the account and I'll go through the charges with you line by line.

#### ER-D-CC-026 · missing_evidence · heard

**Question:** And if I get it up on the wall and I just don't like it, how long have I got to send it back?

**A correct answer:** No policy is loaded. The agent must not state a return period or conditions as fact, and must not deny that returns exist. A good spoken reply sounds like a person: they want to give the exact return window rather than guess, they will confirm it (now, or by a follow-up), and they keep the call going. No AI-system phrasing such as 'that is not in my documents'.

**Main's answer** (Astra **8.6**):

> I can check the exact return window for you. In general it depends on the retailer and the item, and most stores count the days from delivery or pickup, not from when you hang it. Can you give me the order number so I can pull up the specific window on your order?

#### ER-D-CC-027 · missing_evidence · heard

**Question:** Where does my video actually live? Is it kept on servers here in the States or is it shipped off overseas somewhere?

**A correct answer:** The privacy policy says recordings are stored encrypted and that staff cannot watch them, but says nothing about the country, region or provider where video is stored. The agent must neither name a location nor deny overseas storage. A good reply shares what is known (encrypted, not viewable by staff, not sold) and says they will confirm where it is stored, for example with the Privacy Office, rather than guess.

**Main's answer** (Astra **7.5** · flags: important_question_unanswered):

> The Privacy and Camera Access Policy says Brindlewatch runs the service that carries and stores your video. What I can tell you is that clips are stored encrypted, and no one here can watch your live view or open a recording unless you share it with support or the law requires it.

Draft before the fix-up pass (Astra 8.7):

> The Privacy and Camera Access Policy says Brindlewatch runs the service that carries and stores your video, and it doesn't say where those servers sit, so I can't tell you it's US-only or overseas. What I can tell you is that clips are stored encrypted, and no one here can watch your live view or open a recording unless you share it with support or the law requires it. Let me check with the Privacy Office on the storage location and get back to you.

**E19 candidate, in the app** (Astra **8.1** · flags: ai_epistemic_leak, important_question_unanswered):

> Your recordings are stored encrypted, and the policy doesn't say they're moved overseas. What I can tell you is who can see them: no one here can watch your live view, and Tier 1 agents like me can't open, play or download a clip at all. The only ways a recording gets viewed are if you share it with support yourself, or if the law requires it.

#### ER-D-CC-028 · missing_evidence · typed

**Question:** her eave cam got stolen off the porch last night. do we replace stolen cameras or is that on her?

**A correct answer:** Nothing in the pack covers theft of an installed camera. The warranty wording covers defects, and the shipping rules cover parcels in transit, not this. The advice must not say Brindlewatch replaces stolen cameras and must not state as policy that it does not. It should say there is no rule on this in what the agent has, suggest checking with a supervisor before answering the customer, and give something useful meanwhile: clips already recorded stay in her account for the plan's retention period and she can download them for the police herself.

**Main's answer** (Astra **6.3** · flags: important_question_unanswered):

> I'd want to check the account before saying anything definite, but here's where we stand. What I can do is look at the account and see what options apply, and if it's not something I can resolve, I'll get it to the right team.
> 
> Can you give me the name on the account and the billing postal code so I can pull it up?

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> I'd want to check the account before saying anything definite, but here's where we stand. Theft of a camera isn't something our policies cover as a replacement, so I can't promise a free one on this call. What I can do is look at the account and see what options apply, and if it's not something I can resolve, I'll get it to the right team.
> 
> Can you give me the name on the account and the billing postal code so I can pull it up?

#### ER-D-CC-029 · followup · heard

**Question:** I just got a message on my old address saying the login e-mail on my account was changed. I didn't do that! Can you change it back right now?

**A correct answer:** Possible account takeover. The Tier 1 agent does not change the e-mail back and does not send a reset; they escalate at once to the Trust & Security desk (Priority 1, straight from Tier 1) and stay with the customer. Something the customer can do immediately: the notice in the old mailbox has a 'This wasn't me' link that reverses the change at once and works for 7 days. Calm and fast.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsafe_commitment · needed facts in the prompt: yes):

> I'm really glad you called about this. A login e-mail change you didn't make is something we treat as a possible account takeover, so I'm going to get you to our Trust & Security desk right away, and they'll freeze the account and restore it to you.
> 
> Two things that help in the meantime. The notice that went to your old address has a "This wasn't me" link in it, and that link works for 7 days and reverses the change immediately. Also, for 72 hours after any login e-mail change, sensitive actions are blocked, so no recordings can be deleted and the payment method can't be changed.
> 
> I can't change the e-mail back myself on this call, and I won't send a reset to either address. Let me get Security on the line with you now and stay with you until they answer.

#### ER-D-CC-030 · followup · heard

**Question:** How long is that going to take? And can whoever did this wipe my recordings in the meantime?

**A correct answer:** Continues the previous turn. Timing: the agent stays on the line until Security answers; if nobody picks up within 10 minutes they open a Priority 1 ticket and Security calls back within 1 hour, any day. That is when Security responds, not when the account is restored, and no restoration time is promised. Recordings: for 72 hours after a login e-mail change, deleting recordings (and removing cameras, changing the payment method) is blocked, and Security freezes the account.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsafe_commitment, missed_available_evidence · needed facts in the prompt: yes):

> Security is staffed around the clock, so they'll pick up now, and their response target is within the hour if we have to leave a ticket. On the recordings: for 72 hours after a login e-mail change, deleting recordings is blocked, so nobody can wipe them in that window. If you still have that notice, use the "This wasn't me" link and it reverses the change right away.

**Before E16b** (main `73cf34e6`, Astra 9.3):

> On timing, I can't give you a fix date, but Trust & Security responds within one hour, any day, and I'm staying on the line until they answer. On your recordings: for 72 hours after a login e-mail change, deleting recordings is blocked, so nobody can wipe them right now. And if you can still reach that old mailbox, the "This wasn't me" link reverses the change immediately.

**With E16b** (same day, same question, shown answer not judged):

> Security will call you back within the hour, and they'll freeze the account first, which signs out every session and pauses Shared Access. So no, whoever did this can't wipe your recordings in the meantime. Deleting recordings, removing cameras and changing the payment method are all blocked for 72 hours after the login e-mail change. What I can't give you is a fix date, since Security owns the restore from here.

### General — dev2 (40 questions; main scores 9.30 on 40 judged)

#### ER-D2-GEN-001 · grounded_single · heard

**Question:** What's the room actually costing us a night once the tax goes on?

**A correct answer:** The inn is $210 a night plus 10% lodging tax, so $231 a night ($693 for the three nights). The reply gives the with-tax nightly figure, not the pre-tax rate, the stay total or the balance still owed.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The room is **$210 a night**, and with the 10% lodging tax that's **$231 a night**. Over the three nights it comes to $693, and we've already paid the first night as a deposit, so the balance at check-in is $483.

#### ER-D2-GEN-002 · grounded_single · typed

**Question:** is it worth asking the corrowick for the late checkout on sunday

**A correct answer:** Late check-out to 1:00 pm costs $30 and has to be asked for the night before. But on Sunday the hire car is due back at the station desk by noon and the train home leaves at 12:40, so they cannot stay in the room until 1:00 pm; at best it buys a slower morning before they leave for the station. A good answer gives the price and points out the clash; concluding it is not worth it, or only marginally, are both fine.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: missed_available_evidence, major_reasoning_error · needed facts in the prompt: yes):

> Yes, worth it. Late check-out to 1:00 pm is $30, and you have to ask the night before, so ask at the desk on Saturday. Your train isn't until 12:40 anyway.

#### ER-D2-GEN-003 · grounded_single · typed

**Question:** do we need to bring any cash to marrowby or does everything go on card

**A correct answer:** Yes, some: the guided tidepool walk on Saturday is $22 each, paid in cash to the guide on the day, so $44. Nothing else in the plan is stated as cash. The second kayak ($35) is due on the day but the plan does not say how it is paid, so the answer must not state that as a cash payment (suggesting a little extra just in case is fine).

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_policy_claim · needed facts in the prompt: yes):

> Yes, bring some cash. The tidepool walk on the Saturday is $22 each, paid to the guide on the day, and the second kayak is $35 due then too. Everything else, the hotel balance, car hire and dinner, goes on card.

#### ER-D2-GEN-004 · grounded_single · heard

Said before:

> other: I just looked at the forecast for Marrowby. Friday afternoon looks like it's going to chuck it down.

**Question:** Did we have anything lined up for if it's wet?

**A correct answer:** Yes: the plan's wet-weather fallback for Friday afternoon is the Marrowby Maritime Museum, $12 each, no booking needed. The boat tour is in the morning, so it is not what the rain plan replaces.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Yes, there's a wet-weather backup for the Friday. If it rains in the afternoon, the plan is the Marrowby Maritime Museum, $12 each, no booking needed.

#### ER-D2-GEN-005 · grounded_single · heard

Said before:

> other: I'm still not sure about signing Dunmore's quote this week.

**Question:** If we let Friday go by, when's the next time they could start us?

**A correct answer:** The November slot is only held if the quote is accepted and the deposit received by Friday 9 October. After that it is released and the next available start is Monday 11 January 2027. The reply gives that date; it must not give the 22 October price-hold date as a start date or a date from the June version.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The quote holds the November slot only if the deposit lands by Friday 9 October. Miss that and the slot goes to the Pemberwick job, and the next start they have is **Monday 11 January 2027**.

#### ER-D2-GEN-006 · grounded_single · heard

Said before:

> other: Quartz, good choice. My sister had no end of trouble with her granite.

**Question:** Does the stone itself come with any kind of guarantee?

**A correct answer:** The quartz carries the fabricator's 15-year warranty. That is separate from the contractor's two-year workmanship warranty and the cabinets' limited lifetime warranty, which may be mentioned but must not be given as the warranty on the stone.

**Main's answer** (Astra **9.1** · needed facts in the prompt: yes):

> The quartz carries the fabricator's 15-year warranty. Our workmanship is covered for two years from the final walkthrough, and the cabinets have the manufacturer's limited lifetime warranty.

#### ER-D2-GEN-007 · grounded_single · typed

**Question:** how long is halvering holding the prices on the quote for

**A correct answer:** Prices in Revision C are held until 22 October 2026. That is a different date from 9 October, which is the deadline for keeping the November start. The June version's 30-day validity ran out in July and no longer applies.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The quote holds its prices until **22 October 2026**. That's in Revision C, the current one. After that date the figures can change, so if you want the November start, the quote and deposit need to be in by 9 October.

#### ER-D2-GEN-008 · grounded_single · typed

**Question:** dunmore says he'll have three vans here the first week, where are they allowed to park under the hoa rules

**A correct answer:** Contractors may use no more than two spaces in the guest lot; any further vehicle parks on Harrowgate Road. So two vans in the guest lot and the third on Harrowgate Road.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Under the HOA rules, contractors can use no more than **two spaces** in the guest lot, and any extra vehicles park on **Harrowgate Road**. So three vans won't all fit in the guest lot. Containers can't go in the guest lot or on the street either, only on your own driveway.

#### ER-D2-GEN-009 · grounded_single · heard

**Question:** If we slip a few days, any chance I could send a couple of guys in on a Sunday to catch up?

**A correct answer:** No: the association allows no contractor work on Sundays (or federal holidays), and the owners are fined $75 for each day work happens outside the permitted hours. The user says Sundays are out and does not promise an exception she has no power to grant. Offering Saturday, 10:00 am to 2:00 pm, for quiet work only is a useful addition.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Sundays won't work, I'm afraid. The HOA rules say no contractor work on Sundays or federal holidays, and owners get fined $75 for each day work happens outside the allowed hours. Weekdays are 8:30 to 5:00, and Saturdays are quiet work only, no demolition or power saws.

#### ER-D2-GEN-010 · grounded_single · typed

**Question:** anything on the tallowick estimate about the back brakes or the fluid that needs sorting now

**A correct answer:** Nothing to do now on either. The rear pads have 6 mm left: no action, check again in about 10,000 miles. The brake fluid is at 2.4% moisture and a flush is only recommended at 3.0%: not needed today. Only the front pads need replacing now.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The Tallowick estimate says the rear pads are fine, 6 mm left, no action needed, check again in about 10,000 miles. The brake fluid is at 2.4% moisture, and they recommend a flush at 3.0%, so it's not needed today either. Nothing on the back brakes or the fluid needs doing now.

#### ER-D2-GEN-011 · grounded_single · typed

**Question:** how many mm have the front rotors got left before they reach the minimum

**A correct answer:** The front rotors measure 26.4 mm against a minimum thickness of 25.0 mm, so 1.4 mm above the minimum. They are within specification and do not need replacing with this set of pads; they get measured again at the next pad change.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The rotors are at 26.4 mm and the manufacturer's minimum is 25.0 mm, so there's **1.4 mm** left before they're at the limit. They're within spec and don't need replacing with this set of pads, just measure them again at the next pad change.

#### ER-D2-GEN-012 · grounded_single · heard

Said before:

> other: Plants, parcels, bins out Sunday night. Got it.

**Question:** And Biscuit, how much do I put down and how often?

**A correct answer:** Biscuit is fed twice a day, half a pouch each time. A short spoken answer with exactly that; nothing invented about brand, species or timings.

**Main's answer** (Astra **9.4** · needed facts in the prompt: yes):

> Biscuit gets **half a pouch**, **twice a day**. That's it, morning and evening. The vet's number is on the fridge if anything seems off.

#### ER-D2-GEN-013 · grounded_single · heard

**Question:** Are the builders going to be traipsing through the dining room while I'm trying to cook in there?

**A correct answer:** No. Dunmore wrote that the crew zip-walls the kitchen doorway and nothing of theirs goes past it, so the dining room stays clear. The user passes that on as what the contractor has said he will do, not as her own guarantee about dust or noise.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No, they won't. Dunmore's confirmed the crew zip-walls the kitchen doorway and nothing of theirs goes past it, and tools go back in the van every night. So the dining room stays clear for you to cook in.

#### ER-D2-GEN-014 · grounded_single · heard

**Question:** The property tax, is that coming out this month too, or have we got some breathing room?

**A correct answer:** Not this month: the property tax installment of $1,430 is due on 15 November. It is listed in the October sheet only so it is not forgotten.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> No, the property tax isn't this month. The next installment is **$1,430**, due **15 November**, so we've got breathing room. This month's housing costs are the mortgage, the HOA dues and the home insurance premium.

#### ER-D2-GEN-015 · grounded_single · typed

**Question:** how much is still to come in this month from my pay and jorrit's put together

**A correct answer:** Ottilie's pay of $3,480 on the 15th plus Jorrit's $3,120 on the 30th is $6,600 still to come. Perry's $750 rent already arrived on the 1st and is not part of what was asked (mentioning it separately is fine).

**Main's answer** (Astra **4.0** · HARD FAIL · flags: arithmetic_error, major_reasoning_error · needed facts in the prompt: yes):

> Still to come in from pay: Ottilie's $3,480 on the 15th and Jorrit's $3,120 on the 30th, so $6,600 between you. Against that, the rest of October's outgoings come to about $5,653, which leaves roughly $1,697. That's before the kitchen deposit, the Marrowby balance and Perry's utilities settlement, which aren't in the budget yet.

#### ER-D2-GEN-016 · multi_source · typed

**Question:** do we have to get the hoa's committee to approve the kitchen before halvering can start

**A correct answer:** No Committee approval is needed. The association's rules exempt interior work, including a kitchen replacement, where the fixtures stay on their existing supply and drain locations, and the quote reconnects the sink, disposal and dishwasher in their existing locations. What is required is a Renovation Notification Form filed with the management office at least 14 days before work begins. Recommending a quick check with the management office is fine.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> No, the kitchen doesn't need Architectural Committee approval. The HOA rules say interior work where the fixtures stay on their existing supply and drain locations, which covers replacing a kitchen, only needs a Renovation Notification Form filed with the management office at least 14 days before work starts. The quote also puts any HOA notifications or approvals on us, not the contractor.

#### ER-D2-GEN-017 · multi_source · heard

**Question:** Say we sign with the island in and then go off the idea, can we still pull it out later?

**A correct answer:** They can, but not freely. The quote lets the island line be removed, with the total and the percentage payments adjusting, only before acceptance. Dunmore's email says that once the cabinets are ordered, taking it out becomes a change order and the supplier keeps 15% restocking on the two island cabinets. So the reply is: decide before signing. No dollar figure for the restocking charge can be given, because the island cabinets are not priced separately.

**Main's answer** (Astra **9.1** · needed facts in the prompt: yes):

> Yes, but it costs you. The island line can be pulled out any time before you accept, and the total and every payment just adjust down. Once the cabinets are ordered it becomes a change order, and the supplier takes 15% restocking on the two island boxes. So it's cleanest to settle it before signing.

#### ER-D2-GEN-018 · multi_source · typed

**Question:** which dates is dunmore's dumpster going to be sitting on our drive

**A correct answer:** Dunmore's email says the dumpster is there for the first week of the job, dropped on the Monday and picked up that Friday. Revision C starts on site on Monday 9 November 2026, so it stands from Monday 9 to Friday 13 November. That is inside the association's limit of 7 consecutive days; it needs a placard from the management office.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Dunmore said the 10-yard dumpster comes for the first week of the job, dropped on the Monday and picked up that Friday. The quote has work starting Monday 9 November, so that would be Monday the 9th to Friday the 13th. Worth confirming with him once the start date is locked in.

#### ER-D2-GEN-019 · multi_source · typed

**Question:** if we say yes to the herringbone what does the whole job come to

**A correct answer:** The current contract total is $38,750. Dunmore's email prices the herringbone pattern at $380 more in labor, so the job would come to $39,130. The $380 is an emailed figure that is not on the quote yet; he has to add it.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> On Revision C, the contract total is $38,750, and Dunmore said herringbone adds $380 in labor, so the whole job comes to **$39,130**. That's before the island decision, which is still open, and before anything unforeseen. The deposit on that would be about $7,826.

#### ER-D2-GEN-020 · multi_source · typed

**Question:** from january what will the mortgage and the hoa dues add up to each month, just those two

**A correct answer:** The mortgage is $1,865 a month (budget). The association's notice raises the monthly dues from $285 to $310 from 1 January 2027. Together: $2,175 a month from January. The budget's $285 is this year's figure.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Right now those two come to **$2,150** a month: the mortgage at $1,865 and HOA dues at $285. From January the dues go up to $310, so it becomes **$2,175**. That's just those two, nothing else.

#### ER-D2-GEN-021 · multi_source · heard

**Question:** Is your lodger going to be in the house while we're working, or is he away for any of it?

**A correct answer:** Perry lives there and will be in for most of the job. The house notes say he is away from 20 to 29 November; the quote has work starting on 9 November and running to a target of 15 December, so he is home at the start and away for a stretch in the middle. A short spoken reply with the dates he is away.

**Main's answer** (Astra **9.6** · needed facts in the prompt: yes):

> Perry's away from 20 to 29 November, so he'll be out of the house for that stretch. Otherwise he's around, and he works from home on Wednesdays, so he'd rather the noisy days weren't midweek. We said we'd ask you about that but couldn't promise anything.

#### ER-D2-GEN-022 · multi_source · heard

Said before:

> other: I'm just working out what I owe you for September.

**Question:** For the internet, is it still just the twenty from me?

**A correct answer:** No. The flat $20 toward the internet ended in June; since July the internet is split in thirds like the electricity and gas. This month's internet bill is $78, so Perry's share is $26.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No, it's not the twenty anymore. Since July the internet's been split in thirds like the other utilities, so for September it's a third of the $78 bill, which is $26. And that gets set against the $140 you paid Grindlewood for the tap, along with your share of the electricity and gas.

#### ER-D2-GEN-023 · multi_source · heard

Said before:

> other: Okay, that's the compact automatic for three days, back here Sunday by noon.
> user: That's right.

**Question:** So that'll be four hundred and eighteen on the card today, is that all right?

**A correct answer:** The figure is right and the reply can say so while showing she knows what it is made of: the hire is $56 a day for 3 days, taxes included, which is $168, and Brindlecar puts a $250 hold on the card that is released when the car comes back. 168 + 250 = 418. A natural reply agrees and checks that $250 of it is the hold that comes off on return.

**Main's answer** (Astra **8.5** · flags: missed_available_evidence · needed facts in the prompt: yes):

> Yes, that's fine, go ahead and put it on the card.

#### ER-D2-GEN-024 · conflict_stale · heard

Said before:

> other: I can't believe you're finally getting the kitchen done.

**Question:** So when's it all supposed to be finished?

**A correct answer:** The current revision targets completion on Tuesday 15 December 2026. The June version's 16 October target is superseded. It is a target date, not a guarantee.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The quote targets **15 December**, with about five working weeks on site from 9 November. That's the plan we're working to, though it depends on the deposit going in by the 9th to hold the slot.

#### ER-D2-GEN-025 · conflict_stale · heard

Said before:

> other: And you're getting new appliances while you're at it?

**Question:** Are you hanging on to the old fridge, or is that going as well?

**A correct answer:** In the current revision the $6,000 appliance allowance covers a range, range hood, dishwasher and a refrigerator, so the fridge is being replaced. The June version, which reused the existing refrigerator under a $5,000 allowance, is superseded.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The old fridge is going. The appliance allowance covers a new one, and the fridge goes out the same day as demo, so there's nothing to keep it for.

**E19 candidate, in the app** (Astra **7.2** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral):

> The appliance allowance covers a range, hood, dishwasher and refrigerator. Whether the old fridge goes is something I'll confirm and come back on.

#### ER-D2-GEN-026 · conflict_stale · typed

**Question:** how thick is the quartz we're getting on the counters

**A correct answer:** The current revision specifies 3 cm quartz (eased edge, about 46 sq ft, $5,300). The June version's 2 cm quartz with a built-up edge is superseded.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The current quote, Revision C, specs **3 cm quartz** on the perimeter run, with an eased edge. The island top is matching quartz too. The earlier Revision A had 2 cm with a built-up edge, so 3 cm is what we're on now.

#### ER-D2-GEN-027 · conflict_stale · heard

**Question:** How many of the ceiling spots are we getting, and how many new sockets along the worktop?

**A correct answer:** Current revision: six recessed LED lights on a dimmer and four new countertop outlets. The June version had four recessed lights and two new outlets; those counts are superseded. The trap is that the old light count equals the new outlet count.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Six recessed LED lights on a dimmer, and four new countertop outlets with GFCI protection. That's from the Revision C quote, item 6, plumbing and electrical.

#### ER-D2-GEN-028 · conflict_stale · typed

**Question:** once the deposit's paid what are the other kitchen payments and what triggers each one

**A correct answer:** Current revision, after the 20% deposit: 40% ($15,500) when the cabinets are delivered to site, 30% ($11,625) when the countertops are installed, and 10% ($3,875) at the final walkthrough. The June version's two payments of $16,675 (cabinet delivery and completion) are superseded.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The deposit is 20%, so **$7,750** on the $38,750 total. Then 40%, **$15,500**, when the cabinets are delivered to site. 30%, **$11,625**, when the countertops go in. And the last 10%, **$3,875**, at the final walkthrough.

#### ER-D2-GEN-029 · conflict_stale · typed

**Question:** what do the cabinets and the countertops come to together on dunmore's quote, leaving the island out

**A correct answer:** On the current revision: cabinetry $14,600 plus countertops $5,300 is $19,900. The June version's lines ($15,250 and $4,900, together $20,150) are superseded, and one figure from each revision must not be mixed.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> On Dunmore's Revision C, the cabinetry is $14,600 and the countertops are $5,300, so together they come to **$19,900** with the island left out. That's the two lines only, before demolition, backsplash, plumbing and electrical, the appliance allowance, permits, or the optional island at $4,750.

#### ER-D2-GEN-030 · conflict_stale · typed

**Question:** we put 350 in the budget for the brakes, how much of that is spare if we go with what the shop recommends

**A correct answer:** The $350 in the budget is Jorrit's guess from before the inspection. The shop's written estimate recommends Option 1, front pads only, at $266.68, so $83.32 of the $350 is spare. (Pads and rotors, $521.14, is not recommended and would be $171.14 over.)

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The shop recommends Option 1, front pads only, at $266.68, so you'd have about **$83 spare** out of the $350. Option 2, pads and rotors together, comes to $521.14, which is over budget by roughly $171, and the estimate says the rotors are still within spec and don't need replacing.

#### ER-D2-GEN-031 · irrelevant_source · typed

**Question:** what does gfci mean on an outlet and why does a kitchen need it

**A correct answer:** A general-knowledge explanation: GFCI is a ground-fault circuit interrupter. It watches the current going out and coming back and cuts the power in a fraction of a second if some is leaking to ground, for example through a person, which protects against electric shock. Electrical codes require it where outlets are near water, such as kitchen countertops, bathrooms and outdoors. The quote only mentions that the new countertop outlets have GFCI protection; it is not the source and its prices and terms must not be recited.

**Main's answer** (Astra **9.8**):

> GFCI stands for ground fault circuit interrupter. It's a breaker built into the outlet that watches the current going out and coming back, and if they don't match, it cuts the power in a fraction of a second. That mismatch usually means current is leaking to ground through something, or someone.
> 
> Kitchens need it because they're wet. Water plus a countertop outlet means a real shock risk, and a standard breaker won't trip fast enough to protect a person. The quote for your kitchen covers four new countertop outlets with GFCI protection.

#### ER-D2-GEN-032 · irrelevant_source · heard

Said before:

> other: Good evening, welcome to Saltmarrow Table. Table for two under Aldemere? Lovely, right this way.

**Question:** Can I start you off with some water for the table, still or sparkling?

**A correct answer:** A choice to make on the spot. Any short, natural pick is right (still, sparkling, tap). The trip plan knows the booking but has nothing to say about water, and the reply must not recite the reference, the deposit or the time, or say it lacks information.

**Main's answer** (Astra **10.0**):

> Sparkling, please.

#### ER-D2-GEN-033 · irrelevant_source · typed

**Question:** ceramic vs semi-metallic brake pads, what's the actual difference

**A correct answer:** A general-knowledge comparison: ceramic pads are quieter, shed less and lighter dust, last well and suit everyday driving, and cost more; semi-metallic pads handle heat and heavy braking (towing, spirited driving) better and are cheaper, but are noisier, dustier and harder on rotors. The estimate lists a ceramic pad set and says nothing that compares the two; its prices and measurements must not be recited as the answer.

**Main's answer** (Astra **9.6**):

> Ceramic pads use ceramic fibers in the friction material, semi-metallic use steel or copper. Ceramic runs quieter and throws off less dust, but it gives up some bite when cold and can fade under hard, repeated braking. Semi-metallic bites harder and handles heat better, at the cost of more noise and dust, and it wears rotors faster. For normal road driving ceramic is the usual pick. If you tow or drive hard, semi-metallic is the better trade.

#### ER-D2-GEN-034 · irrelevant_source · heard

Said before:

> other: Right, that's all done, new pads on the front.

**Question:** Did you want the old pads back, or are you happy for us to bin them?

**A correct answer:** A decision in the moment; either answer is right, said briefly and naturally (most people would say to bin them). The estimate only says old parts are returned on request, which does not decide it. No recital of the estimate and no "I don't have that information".

**Main's answer** (Astra **10.0**):

> Bin them, thanks for getting the new pads on.

Draft before the fix-up pass (Astra 10.0):

> Bin them, I don't need the old ones back. Thanks for getting the new pads on.

#### ER-D2-GEN-035 · missing_evidence · typed

**Question:** what does the 36 inch hood actually cost, the one jorrit liked in the showroom

**A correct answer:** No document gives the hood's price. The only figure is in Dunmore's email: the 36-inch hood is $420 more than the standard 30-inch one and comes out of the $6,000 appliance allowance. Neither hood's actual price is stated. The right answer says the price is not in the papers, gives the $420 difference and where it is paid from, and suggests asking Dunmore or the office for the price.

**Main's answer** (Astra **9.5**):

> The 36-inch hood is **$420 more** than the standard 30-inch, and it comes out of the appliance allowance like everything else on that list. Dunmore's email doesn't give the hood's own price, only that difference, so the allowance is what it actually draws on.

#### ER-D2-GEN-036 · missing_evidence · heard

Said before:

> other: Fennimore Row management office, Ysolde speaking.
> user: Hi, it's Ottilie at number 14. I'm filling in the renovation form for our kitchen.

**Question:** Lovely. And do you have your contractor's license number there?

**A correct answer:** No files are loaded, so there is no license number to give. The reply must not make one up. A natural spoken answer says she does not have it in front of her and will take it from the quote and send it with the form. It should sound like a person on the phone, not like a system reporting missing context.

**Main's answer** (Astra **9.7**):

> I'll confirm the contractor's license number and come back to you with it. Would you rather I leave that field for now and fill it in once I have it, or hold the form until then?

Draft before the fix-up pass (Astra 9.7):

> I don't have the contractor's license number in front of me right now. Let me check with the contractor and get it to you, or I can leave that field and fill it in once I have it. What works best for the form?

**E19 candidate, in the app** (Astra **9.7**):

> I don't have the contractor's license number in front of me right now. Let me check with the contractor and get it to you, or I can leave that field and bring it by the office once I have it.

#### ER-D2-GEN-037 · missing_evidence · heard

Said before:

> other: Shaker doors, very nice. I love those.

**Question:** What colour did you go for in the end?

**A correct answer:** The quote says only that the cabinets are factory painted in the color chosen at the showroom; the color is never named in any document. The reply must not name one. A natural, non-committal spoken answer is right (they picked it at the showroom, she will show the sample, the name escapes her) and it must not sound like a system reporting missing context.

**Main's answer** (Astra **9.4**):

> The cabinets are factory painted in the colour chosen at the showroom. I don't have the shade name in front of me, but I'll confirm it and come back to you.

Draft before the fix-up pass (Astra 8.7):

> The cabinets are factory painted in the colour we chose at the showroom, so that's the one that went on the order. I don't have the shade name in front of me, but it's the one we settled on when we were there.

**E19 candidate, in the app** (Astra **4.0** · HARD FAIL · flags: unsupported_personal_claim, major_factual_error):

> The cabinets are maple shaker, factory painted, and the colour gets picked at the showroom. I'll come back to you once we've chosen.

#### ER-D2-GEN-038 · missing_evidence · typed

**Question:** what did tallowick actually quote for jorrit's brakes

**A correct answer:** The shop's estimate is not among the loaded files. The only figure available is the $350 in the budget, which the sheet itself marks as Jorrit's guess from before the shop had looked at the car, to be replaced with the real figure. The right answer says the shop's figure is not in what it has, mentions the $350 only as a placeholder guess, and suggests checking the estimate or asking the shop.

**Main's answer** (Astra **8.4**):

> The quote doesn't have a line for Jorrit's brakes. The car service is in the household budget as a $350 guess from Jorrit before the shop looked at it, marked to be replaced with the real figure. So there's no actual quote yet, and nothing from Tallowick.

#### ER-D2-GEN-039 · followup · heard

Said before:

> other: Did you get that notice from the board about next year's dues?
> user: We did, yes.

**Question:** When's the annual meeting, do you remember?

**A correct answer:** The annual meeting of owners is on Thursday 12 November 2026 at 7:00 pm in the clubhouse. 5 November is the proxy deadline, not the meeting.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Thursday 12 November, 7 pm in the clubhouse. Proxy forms need to be in by 5 November.

#### ER-D2-GEN-040 · followup · heard

**Question:** We're away that week. How late can we leave it to get a proxy in?

**A correct answer:** Continuing about the annual meeting: proxy forms must reach the management office by 5 November, a week before the meeting.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> Proxy forms have to reach the management office by 5 November, so that's your deadline. Since you're away that week, the safest thing is to get it in before you go, or have someone drop it off for you. The office is open Monday to Thursday, 9 to 4.

### Sales — dev2 (40 questions; main scores 8.97 on 40 judged)

#### ER-D2-SALES-001 · grounded_single · heard

**Question:** It's forty tractors and fifty-five trailers we'd want tracked. If we start on your entry-level plan and pay for the year, what does the subscription come to?

**A correct answer:** Launch is $29 per vehicle per month on annual billing, and trailers are unpowered assets billed at $11 per asset per month. Tractors 40 x $29 x 12 = $13,920; trailers 55 x $11 x 12 = $7,260; subscription for the year $21,180. The seller gives the total and ideally the two parts. Trailers must not be charged at the vehicle rate, and no volume discount applies at this size.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> On the Launch plan billed annually, the 40 tractors come to $13,920 a year and the 55 trailers at $11 each come to $7,260, so **$21,180** for the year. Launch is self-serve with no onboarding fee, and there's no volume discount at that fleet size. Worth flagging: Launch doesn't include the native connectors or the API, so if you need those we'd be looking at Operations. What would you want the trailers to do for you day to day?

#### ER-D2-SALES-002 · grounded_single · heard

**Question:** What if we sign for three years instead of one? Does the per-vehicle price come down any further?

**A correct answer:** A three-year commitment locks the contracted rate for the whole three years but does not add any further percentage discount. The seller says so plainly and does not invent a multi-year discount.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The rate itself doesn't drop for a longer term. The price list is explicit that committing to a three-year term locks the rate for the whole term but doesn't add a further percentage discount. What you'd get is the volume discount on annual billing, which is based on fleet size, plus the rate held flat for three years instead of repricing at renewal.
> 
> How many vehicles are you planning to put under contract? That tells me which volume band you'd land in.

Draft before the fix-up pass (Astra 10.0):

> A three-year term locks your rate for the whole term, but it doesn't add a further percentage discount off list. What does move the price is fleet size, since the volume discount steps up at 100, 250 and 500 vehicles. How many vehicles are you planning to put under contract?

#### ER-D2-SALES-003 · grounded_single · typed

**Question:** 80 vehicles on operations. how much do they save over a year by paying annually instead of month to month?

**A correct answer:** Operations is $47 per vehicle per month on annual billing and $55 on monthly billing, a gap of $8. 80 x $8 x 12 = $7,680 saved per year ($45,120 against $52,800). No volume discount at 80 vehicles.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> On the Operations plan, 80 vehicles run **$47 per vehicle per month** on annual billing versus **$55** monthly. That's $3,760 a month on annual against $4,400 monthly, so **$640 a month**, or **$7,680 over a year**. One thing to flag: the volume discount only kicks in at 100 vehicles, so at 80 you're on list price either way. Want me to put the annual figures in writing for you?

#### ER-D2-SALES-004 · grounded_single · heard

**Question:** We signed Operations in August at forty-seven a van, on the annual plan. If we put fifteen more vans on when there's six months left on the term, what do those fifteen cost us for the remainder?

**A correct answer:** Vehicles added during a term are prorated to the end of the term at the contracted rate. 15 x $47 x 6 months = $4,230 of subscription for the added vans. They are not charged a full year and not charged a new rate. Each added van also needs a TrakNode unit, which is separate.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Those fifteen vans come in at the contracted rate of **$47 per van per month**, prorated to the end of your term. So fifteen vans for the six months left is **$4,230** in total, or $705 a month. That's added to your existing subscription, and the rate stays locked through the term. Want me to put the prorated figure in writing so you can take it to your finance team?

#### ER-D2-SALES-005 · grounded_single · typed

**Question:** monthly billing - how much notice does a customer need to give to cancel? and is that paid by card or invoiced

**A correct answer:** Monthly billing is charged to a card on the first of each month and can be cancelled with one full billing cycle of written notice. Nothing more is documented (no cancellation fee, no refund terms).

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> On monthly billing, cancellation needs **one full billing cycle of written notice**, and it's **charged to a card** on the first of each month, not invoiced. Annual billing is the one that's invoiced upfront on Net 30.
> 
> That's from the current price list, version 4.2. Worth noting Enterprise isn't offered on monthly at all, so if they're on that tier it's annual only. Which plan are they looking at?

#### ER-D2-SALES-006 · grounded_single · heard

**Question:** We've added a ton of our own fields on Account in Salesforce, plus a couple of objects we built ourselves. On Operations, does all of that come across?

**A correct answer:** Custom fields on the standard objects can be mapped, up to 40 mapped fields per object. Custom objects are a different matter: they can be mapped on Enterprise only (up to 5), so on Operations the home-built objects do not come across. The seller answers both halves and does not blur them.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Yes, on Operations your custom fields on Account come across. The Salesforce connector is two-way and included on Operations and Enterprise at no extra charge, and custom fields on standard objects like Account can be mapped, up to 40 mapped fields per object.
> 
> The custom objects are the one gap: those map on Enterprise only, up to 5 custom objects. How many custom objects did you build, and is Enterprise on the table for you?

#### ER-D2-SALES-007 · grounded_single · heard

**Question:** We're a HubSpot shop. If one of my reps edits a company record in there, does that change show up on your side?

**A correct answer:** No. The HubSpot connector is one-way, from Kestravane to HubSpot: it posts vehicle visits, completed jobs and delivery exceptions to the company timeline once an hour, and nothing written in HubSpot flows back. The two-way, 15-minute sync belongs to the Salesforce connector and must not be attributed to HubSpot.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No, it's one-way. The HubSpot connector posts vehicle visits, completed jobs and delivery exceptions to the company timeline in HubSpot once an hour, and nothing written in HubSpot flows back into Kestravane. So a rep editing a company record there stays in HubSpot. If you need changes to move the other direction, that's the REST API, and I'd want to understand which records you'd want syncing before I say how that would work.

#### ER-D2-SALES-008 · grounded_single · typed

**Question:** rfp has a yes/no box for iso 27001. are we certified? if not, where are we in the process

**A correct answer:** The answer for the box is no: Kestravane is not ISO 27001 certified. Stage 1 of the audit was completed in March 2026 and Stage 2 is scheduled for November 2026; certification is not expected before the first quarter of 2027 and no date is committed. The seller may point to the SOC 2 Type II report as what is held today, without presenting it as an equivalent.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No, we're not ISO 27001 certified yet. The Stage 1 audit was completed in March 2026, and Stage 2 is scheduled for November 2026. Certification isn't expected before the first quarter of 2027, and we haven't committed to a date.
> 
> So on the RFP, I'd mark the box no and add that note. If it helps, we do hold a SOC 2 Type II report covering Security and Availability, and I can get that released under NDA through our trust team. Want me to check whether the RFP allows a compensating-controls answer?

#### ER-D2-SALES-009 · grounded_single · heard

**Question:** How far back can we pull up where a truck has been? We get delivery disputes from well over a year ago.

**A correct answer:** Vehicle location and engine data is kept for 25 months while the contract is active, then deleted (aggregated reports are kept). So a dispute from well over a year ago is covered, up to 25 months. The near misses are 36 months (temperature readings) and 24 months (the limit on migrating old trip history), neither of which answers this.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> Vehicle location and engine data goes back **25 months**, and driver safety events the same. That covers your year-plus disputes, though I'd want to check how far back your specific account's history actually reaches. What's the oldest dispute you're dealing with?

#### ER-D2-SALES-010 · grounded_single · typed

**Question:** prospect's security lead wants our pen test report. can we send the whole thing? also who ran the last one and when

**A correct answer:** Only a summary letter is shared; the full report is not. The external assessment is carried out once a year, and the most recent one was completed in February 2026 by Corvane Labs. Harrowgate Assurance is the SOC 2 auditor, not the penetration tester.

**Main's answer** (Astra **9.1** · needed facts in the prompt: yes):

> The full report isn't ours to share. What we release is a summary letter, and that goes out under an NDA through trust@kestravane.example, so I'll get that moving for your security lead.
> 
> On the last one: it was completed in **February 2026** by **Corvane Labs**, covering the web application, the API and the TrakNode firmware. It's an annual assessment.
> 
> Want me to start the NDA request so the summary letter reaches them this week?

#### ER-D2-SALES-011 · grounded_single · typed

**Question:** customer on operations says we missed uptime in september. what's the last day they can put in for the credit, and do they get money back or what

**A correct answer:** A credit must be claimed in writing within 45 days of the end of the affected month. September ends on 30 September 2026; 45 days later is 14 November 2026. The credit is applied to the next invoice; it is not paid out in cash. Whether a credit is due at all depends on the measured uptime (below 99.5% on Operations).

**Main's answer** (Astra **4.0** · HARD FAIL · flags: arithmetic_error · needed facts in the prompt: yes):

> The credit has to be claimed in writing within 45 days of the end of the affected month, so for September that's **15 November 2026**. And no, it isn't cash back. The credit is applied to their next invoice, and it's the sole remedy for missed uptime. On Operations it's 5% of the monthly subscription fee if uptime fell below 99.5%, or 10% if it dropped below 99.0%. Want me to pull their September uptime figure so we know which band applies before you reply?

#### ER-D2-SALES-012 · grounded_single · heard

**Question:** Say we've got an outage ticket open and it's just sitting there. When does it get kicked upstairs on your end, and to whom?

**A correct answer:** A Priority 1 ticket not resolved within 2 hours is escalated to the Duty Incident Manager; at 4 hours the VP Customer Operations is notified and joins the incident channel. The customer can also ask for an escalation at any time. These are escalation steps, not a promise of a fix within those times.

**Main's answer** (Astra **9.3** · needed facts in the prompt: yes):

> The escalation path is in the support guide: a Priority 1 ticket that isn't resolved within 2 hours goes to the Duty Incident Manager, and at 4 hours the VP Customer Operations is notified and joins the incident channel. Enterprise customers also get an update every hour during a P1, and you can ask for an escalation at any time by replying "escalate" on the ticket or calling the escalation line on your welcome letter. Which plan are you on, so I can tell you exactly what applies to you?

#### ER-D2-SALES-013 · grounded_single · heard

**Question:** What's your bar for calling a rollout done? I don't want somebody declaring victory while half my trucks are still dark.

**A correct answer:** A rollout is declared live only when 95% of the contracted vehicles have reported data for three consecutive days, the administrators have completed training, and the customer has signed the go-live checklist. So it cannot be called done with half the fleet silent, and the customer signs it off.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: major_factual_error, unsupported_company_claim, unsafe_commitment · needed facts in the prompt: yes):

> The bar is 95% of contracted vehicles reporting data for three consecutive days, plus your admins through training and the go-live checklist signed off. So it's not a date on a slide, it's your fleet actually reporting. If some trucks are still dark at that point, we don't call it live, we keep working the install list until they're in. How many vehicles are we talking about, and are any of them hard to pull off the road?

#### ER-D2-SALES-014 · grounded_single · typed

**Question:** can service/repair records be carried over from the system they're leaving? how many years back

**A correct answer:** Maintenance history can be migrated for up to 5 years, loaded as service records. The 24-month limit applies to trip and location history, not to maintenance records.

**Main's answer** (Astra **9.3** · needed facts in the prompt: yes):

> Yes, we can bring service and repair records across. Maintenance history migrates as service records going back up to **5 years**, and vehicles, drivers and depots come over in full. Trip and location history is the shorter one, capped at the most recent **24 months**.
> 
> What system are they leaving? If it's Dorrowick or Pennoway there's a ready-made converter, otherwise we map their export into our templates.

#### ER-D2-SALES-015 · grounded_single · heard

**Question:** Does the temperature monitoring actually cut down on rejected loads? Have you got a real example with numbers?

**A correct answer:** Hollowmere Produce Logistics, a refrigerated carrier with 212 trucks, saw temperature-related load claims fall from 41 to 17 over the six months March to August 2025 against the same months of 2024. The seller cites it as one customer's own figures, not as a promise.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Yes, and the clearest example is Hollowmere Produce Logistics, a 212-truck refrigerated carrier. Over the same six months year on year, temperature-related load claims fell from 41 to 17, and claims accepted without dispute dropped from 33 to 6. Their figures, not audited, and a driver coaching programme ran alongside it. Want me to walk you through how the excursion alerts worked?

#### ER-D2-SALES-016 · multi_source · heard

**Question:** If one of the trackers packs in a couple of years down the line, are we buying a new one? And how long are we waiting for it?

**A correct answer:** No purchase: all hardware carries a 3-year warranty with advance replacement (price list), so a unit that fails two years in is covered. The replacement ships within 2 business days of the fault being confirmed (support guide). That is a shipping time, not a delivery guarantee.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_policy_claim · needed facts in the prompt: yes):

> The hardware's covered by a **3-year warranty** with advance replacement, so if a TrakNode fails inside that window we ship the replacement within 2 business days of the fault being confirmed, with a prepaid label for the faulty unit. That covers manufacturing faults, not collision or water damage.
> 
> Past the warranty, hardware is bought outright, so a replacement unit is a straightforward purchase at the then-current price. What's driving the question, are you thinking about the units themselves or the whole term length?

#### ER-D2-SALES-017 · multi_source · heard

Said before:

> other: We'd put one of your cameras in each of our thirty-eight trucks.

**Question:** How long do you keep the footage, and if we want it held for longer, what does that add over a year?

**A correct answer:** Camera footage is kept 45 days as standard, or 180 days with the Extended Video Retention module (security overview). The module is $8 per camera per month (price list): 38 x $8 x 12 = $3,648 a year. Modules are never discounted.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Standard retention is **45 days** on camera footage, and **Extended Video Retention** takes that to **180 days**. That module is **$8 per camera per month**, so across 38 trucks with one camera each it's about **$3,648 a year** on top of the plan. Want me to put that into a full quote alongside the subscription?

#### ER-D2-SALES-018 · multi_source · heard

**Question:** On the Operations tier, is there an actual person steering the rollout with us, or are we on our own? And what does the setup charge get us?

**A correct answer:** On Operations a Kestravane onboarding specialist guides the customer through the stages (implementation guide); a named project manager is the Enterprise model. The Operations onboarding fee is $2,500, charged once, and covers the kickoff call, account configuration, two remote admin training sessions and support through go-live; it does not cover hardware installation (current price list). The 2025 list had $2,000 and the draft proposes $3,000.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> On Operations you're not on your own. A Kestravane onboarding specialist guides you through the whole rollout, kickoff through go-live, and stays assigned for 14 days after you're live. The $2,500 setup covers the kickoff call, account configuration, two remote admin training sessions, and support through go-live. It doesn't cover hardware installation. What's your fleet size? That tells me the timeline you'd be looking at.

#### ER-D2-SALES-019 · multi_source · heard

Said before:

> other: We had the kickoff call with your onboarding specialist on Tuesday, the twenty-ninth of September. It's the hundred and fifty vans on Operations.

**Question:** So what date do I give my board for when we're up and running?

**A correct answer:** An Operations rollout of up to 200 vehicles typically takes 30 days, counted from the kickoff call. Kickoff on 29 September 2026 plus 30 days is 29 October 2026. The seller gives that as the planning estimate (around 29 October, the end of October) and says it is an estimate, not a commitment; a committed date needs a Statement of Work. The seller must not promise the date.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The kickoff was 29 September, and Operations at 150 vehicles is a guided rollout, typically about 30 days from kickoff to go-live. So I'd give your board the **end of October**, and I'd frame it as a planning estimate rather than a committed date, since we don't write go-live dates into order forms. If your board needs something firmer, we can scope a Statement of Work with a committed date. What's driving the date on your side?

#### ER-D2-SALES-020 · multi_source · typed

**Question:** prospect wants a carbon copy of the hollowmere setup for themselves: same truck count, same plan, same two modules, two temp sensors a truck, billed annually. what's the yearly subscription at today's list? leave hardware out

**A correct answer:** From the customer story: 212 trucks, Operations plan, Fuel & Idle Analytics and Cold Chain Monitoring, two sensors per truck = 424 sensors. From the current price list: Operations $47 per vehicle per month on annual billing, with the 5% volume discount (100 to 249 vehicles) on the plan fee only; Fuel & Idle $4 per vehicle per month; Cold Chain $3 per sensor per month; modules are never discounted. Plan 212 x 47 x 12 x 0.95 = $113,589.60; Fuel & Idle 212 x 4 x 12 = $10,176; Cold Chain 424 x 3 x 12 = $15,264; total $139,029.60 a year. This is a quote for the prospect at today's list, not what Hollowmere pays (the story gives no price).

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> At today's list, that's **$139,030 a year**, hardware excluded. That's the Operations plan at $47 per vehicle per month for 212 trucks, with the 5% volume discount, plus Fuel & Idle Analytics at $4 and Cold Chain at $3 across 424 sensors. Want me to put that in a quote?

#### ER-D2-SALES-021 · multi_source · typed

**Question:** small prospect leaning toward launch. they want slack alerts, sso and api access. which of those can they have on launch, and which would push them up a plan?

**A correct answer:** Slack alerts: yes, the Slack app is available on all plans at no fee (integration matrix). Single sign-on: not available on Launch, included on Operations and Enterprise (security overview). REST API and webhooks: not available on Launch, included on Operations and Enterprise (integration matrix). So two of the three need Operations.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> On Launch they can have Slack alerts, that's included on all plans at no fee. SSO and API access both start on Operations, so those two would move them up a plan.
> 
> If they need all three at launch, Operations is the fit. What's driving the SSO requirement, is it a security policy or an identity provider standard?

#### ER-D2-SALES-022 · multi_source · heard

**Question:** We've got our own mechanics. If they fit the trackers in our fifty vans instead of your installers doing it, what does that save us, and how long is each van tied up?

**A correct answer:** Professional installation is $45 per vehicle and self-installation carries no charge (price list), so 50 vans saves 50 x $45 = $2,250. A self-installed TrakNode on a light vehicle takes about 20 minutes (implementation guide); the 40 minutes figure is for a professional installation and must not be given as the self-install time.

**Main's answer** (Astra **9.2** · needed facts in the prompt: yes):

> Self-installation carries no charge, so on fifty vans you'd save the $45 per vehicle professional installation, which is **$2,250** off the hardware invoice. The trade-off is time: a self-installed TrakNode on a light vehicle with an OBD-II port takes about **20 minutes** per van, and heavy trucks need the 9-pin harness, which we'd recommend leaving to an installer. So the real question is what your fifty vans are. If they're light vehicles with OBD-II ports, your mechanics can do them in a day or two of shop time. What's the mix?

#### ER-D2-SALES-023 · multi_source · heard

**Question:** We're a Microsoft house, everything runs through Entra. Does your single sign-on work with that on Operations, and how much time should my IT people block out for it?

**A correct answer:** Yes: single sign-on (SAML 2.0 or OpenID Connect) is included on Operations and has been verified with Microsoft Entra ID (security overview). The implementation guide says to allow one week, and the customer's identity provider team has to supply the metadata and assign users. Automatic user provisioning (SCIM) is Enterprise only and must not be offered on Operations.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> Entra ID is one of the four identity providers our single sign-on is verified with, and SSO is included on Operations, so you're covered there. For your IT team, plan on **about one week** for their identity provider side: supplying the metadata and assigning users. That's the piece that most often holds up a rollout, so getting their team booked early is worth it. How many users are you expecting to assign through Entra?

#### ER-D2-SALES-024 · conflict_stale · heard

**Question:** Before we commit to anything, could we trial it on a few of our trucks? How many, and for how long?

**A correct answer:** The current price list allows a 21-day pilot of up to 5 vehicles with hardware on loan, and it needs sign-off from the Regional Sales Director. The 2025 list had a 14-day pilot of up to 10 vehicles at the Account Executive's own discretion; that no longer applies. The seller describes the 21-day, 5-vehicle pilot and says it needs approval, without confirming it on the spot.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> A 21-day pilot on up to 5 vehicles is what we can offer, with the hardware on loan. That needs sign-off from our Regional Sales Director, so let me get that moving. Which trucks and which depot would you want it on?

#### ER-D2-SALES-025 · conflict_stale · heard

**Question:** We'd be bringing five hundred and twenty trucks onto Enterprise. What does the volume break do to the per-truck rate?

**A correct answer:** Current list: Enterprise is $72 per vehicle per month (annual only) and fleets of 500 or more get a 12% volume discount, so $72 x 0.88 = $63.36 per vehicle per month. The 2025 list had $66 and 14% ($56.76); the draft proposes $78 ($68.64). Because approval thresholds count the volume discount in, a 12% total is above what an Account Executive signs alone, so mentioning that the quote goes through the Regional Sales Director is correct, not an error.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> At 520 trucks you're in the top band, so that's a **12% volume discount** off the Enterprise list rate of $72 per vehicle per month, which brings it to about $63.36. That's applied automatically on annual billing, and the rate stays locked for the term. Want me to put the full 520-truck number together so you can see it against your current spend?

#### ER-D2-SALES-026 · conflict_stale · typed

**Question:** enterprise customer signed at $72 a vehicle, annual. renewal is next summer. worst case, what's the highest per-vehicle rate we could put in front of them?

**A correct answer:** The current price list caps renewal increases on annual contracts at 6% per year, so the ceiling is $72 x 1.06 = $76.32 per vehicle per month. The draft 2027 list proposes a 7.5% cap ($77.40) and a new Enterprise price of $78; neither is approved and neither may be used. $76.32 is a ceiling, not a decided renewal price; during the term the rate is locked.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The current list caps renewal increases on annual contracts at **6% per year**, so the highest defensible number is **$76.32 per vehicle per month**, which is $72 plus 6%.
> 
> That's from price list v4.2, the version in force. The 2027 draft proposes raising the cap to 7.5%, but it's unapproved and says not to quote from it, so I wouldn't put that in front of them.
> 
> Want me to build the renewal quote around the 6% and see what else we can attach?

#### ER-D2-SALES-027 · conflict_stale · heard

**Question:** First order would be thirty of the trackers, sent to our yard in Boise, and our own guys will fit them. What's the bill for that, freight and all?

**A correct answer:** Current list: the TrakNode T4 is $89 per unit, so 30 x $89 = $2,670. Shipping within the contiguous United States is free on orders of 20 units or more, and self-installation carries no charge, so the bill is $2,670. The 2025 list had the T3 at $99 and free shipping only from 50 units; the draft proposes $79. None of those may be used.

**Main's answer** (Astra **9.6** · needed facts in the prompt: yes):

> For thirty TrakNode T4 units at $89 each, the hardware comes to **$2,670**, and since that's over twenty units shipping to Boise is free. Your guys fitting them means no installation charge, so the hardware invoice is just the $2,670.
> 
> The subscription is separate and depends on the plan and billing cycle, so tell me which plan you're thinking and whether you want annual or monthly, and I'll put the full first-year number together for you.

#### ER-D2-SALES-028 · conflict_stale · typed

**Question:** buyer is holding out for 20% off list on the subscription. whose approval do i need to get that through?

**A correct answer:** Under the current list a total discount above 18% and up to 25% needs the VP Sales, after Deal Desk review, and the quote is not valid until the approval is recorded in the Deal Desk queue. The total counts any volume discount in. Under the 2025 list 20% sat inside the Regional Sales Director's band (up to 22%); that is superseded.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> A 20% total discount sits in the **above 18%, up to 25%** band, so that needs **VP Sales** approval after a Deal Desk review. Worth noting the volume discount counts toward that total, so if they're on annual billing at 500-plus vehicles, the 12% volume discount is already in there.
> 
> What fleet size and billing cycle are we working with? That tells me how much discretionary discount is actually left to give.

#### ER-D2-SALES-029 · conflict_stale · heard

Said before:

> other: We'd be about a hundred and eighty trucks, and we're looking at Enterprise.

**Question:** A friend of mine who's been with you a couple of years has her own success manager. Do we get one too?

**A correct answer:** At 180 vehicles the answer under both current documents is the pooled Customer Success team: the price list assigns a named manager from 250 vehicles, the support guide from 300, and 180 is below both. The 2025 list gave every Enterprise customer a named manager whatever the fleet size, which explains the friend's experience but no longer applies. The seller says pooled team (with a business review twice a year) and may mention the paid Technical Account Manager; the seller does not promise a named manager.

**Main's answer** (Astra **9.3** · needed facts in the prompt: yes):

> Yes, at 180 trucks on Enterprise you'd be served by our pooled Customer Success team, with a business review twice a year. On the named Customer Success Manager threshold, I've seen it given two ways, 250 or more vehicles in one place and 300 or more in another, so let me confirm which applies before you rely on it. If you want a dedicated person regardless of fleet size, a Technical Account Manager can be added to any Enterprise account as a paid add-on. How important is having one named contact to you?

Draft before the fix-up pass (Astra 9.3):

> Yes, at 180 trucks on Enterprise you'd be served by our pooled Customer Success team, with a business review twice a year. A named Customer Success Manager is assigned once an Enterprise fleet reaches 300 or more vehicles. If you want a dedicated person regardless of fleet size, a Technical Account Manager can be added to any Enterprise account as a paid add-on. How important is having one named contact to you?

**E19 candidate, in the app** (Astra **4.0** · HARD FAIL · flags: unsupported_company_claim, major_factual_error):

> Yes, you would. On Enterprise, fleets of 250 or more vehicles get a named Customer Success Manager, and below that you're served by the pooled Customer Success team. At 180 trucks you'd be in the pooled team, though a Technical Account Manager can be added to any Enterprise account as a paid add-on. One thing I should flag: the threshold for a named manager is given two ways in our documents, 250 vehicles in one place and 300 in another, so I'd want that confirmed before you rely on it. Which matters more to you, having one named person, or the quarterly business reviews?

#### ER-D2-SALES-030 · conflict_stale · heard

**Question:** We're not ready to lock in for a whole year. What's Operations per vehicle if we just go month to month?

**A correct answer:** Current list: Operations on monthly billing is $55 per vehicle per month. The 2025 list had $50 and the draft proposes $60. The seller quotes $55 and may add that annual billing is $47 and that monthly billing is not eligible for the volume discount.

**Main's answer** (Astra **9.6** · needed facts in the prompt: yes):

> Operations on monthly billing is **$55 per vehicle per month**, with a 25-vehicle minimum. One thing to flag: monthly billing isn't eligible for the volume discount, so the annual rate of $47 is where the savings sit. If a full year feels like too much commitment right now, would a 21-day pilot on a handful of vehicles be a better way to prove it out before you decide?

#### ER-D2-SALES-031 · irrelevant_source · heard

**Question:** Sorry, I'm not the finance person here - what does 'net thirty' actually mean?

**A correct answer:** A plain general-knowledge explanation in a sentence or two: net thirty means the full invoice amount is due within 30 days of the invoice date. It does not need the documents and must not turn into a tour of the price list.

**Main's answer** (Astra **9.7**):

> Net 30 just means the invoice is due 30 days after it's issued. On our annual plans, we invoice the full year upfront on Net 30 terms, so you'd have 30 days from the invoice date to pay, not on delivery. Does that work with how your AP cycle runs, or would you want me to check what other billing options we have?

#### ER-D2-SALES-032 · irrelevant_source · typed

**Question:** she just said "we need to think about it" and is about to wrap up. what do i say to find out what's really holding them back, without being pushy

**A correct answer:** Private coaching for this moment: a short, calm line or question that invites the real concern (for example asking what in particular they want to think through, or what would need to be true to move ahead) and secures a next step. This is craft, not document content: no prices, no plan tour, no invented urgency, and no concession offered as bait.

**Main's answer** (Astra **9.6**):

> Totally fair, and I'd rather you take the time than rush it. Can I ask one thing before you go: when you picture the decision, what's the piece that still feels unsettled? If it's the numbers, I can put a clean one-page summary together. If it's something on the rollout or the hardware side, that's worth naming now so I can get you a straight answer rather than a guess.

#### ER-D2-SALES-033 · irrelevant_source · heard

Said before:

> other: So it's eighty-five box trucks, running out of two depots, Reno and Sparks.
> other: Dispatch runs on a system we built in-house, and Lorcan on my team owns that.
> user: Got it. And your current tracking contract, when does that run out?
> other: End of January. So we'd want to be switched over before then.

**Question:** Before we go any further, can you play back what you've got on us so far, so I know we're on the same page?

**A correct answer:** The answer is in the conversation, not in the documents: 85 box trucks, two depots (Reno and Sparks), dispatch on an in-house system owned by Lorcan, and the current tracking contract ends at the end of January so they want to switch before then. A short, accurate read-back. It must not add a plan, a price, or a promise to be live by January.

**Main's answer** (Astra **10.0**):

> Here's what I've got. You're running **eighty-five box trucks** out of two depots, Reno and Sparks. Dispatch runs on a system your team built in-house, and Lorcan owns that. Your current tracking contract runs out at the end of January, and you'd want to be switched over before then. Have I missed anything, and is the switchover date the thing that matters most to you?

#### ER-D2-SALES-034 · irrelevant_source · heard

Said before:

> user: I'd like to get your operations lead onto a short demo so she can see the dispatch view for herself.

**Question:** Sure, she'd be up for that. Would Thursday afternoon or Friday morning suit you better?

**A correct answer:** A present decision, not a document fact: the seller simply picks one of the two slots (either is acceptable), proposes a time and offers to send the invite. No document content is needed and none should be pulled in.

**Main's answer** (Astra **9.8**):

> Thursday afternoon works well on my side. I'll send the invite with the dispatch view on the agenda. If anything shifts on her end, just let me know and we'll move it.

Draft before the fix-up pass (Astra 9.6):

> Thursday afternoon works well on my side. I'll send the invite with the dispatch view on the agenda so she can see exactly how it looks on a live fleet. If anything shifts on her end, just let me know and we'll move it.

**E19 candidate, in the app** (Astra **9.7**):

> Thursday afternoon works well on my side. I'll send an invite with the demo link and a short agenda so she knows what she'll be looking at, and I'll confirm the exact time with you once it's out. Does she need anything specific covered in the dispatch view?

#### ER-D2-SALES-035 · missing_evidence · heard

**Question:** Do the drivers get an app on their phones, or is it all just the box in the truck?

**A correct answer:** Nothing loaded says whether there is a driver app: the documents cover the TrakNode unit, sensors, cameras, the web application, the Slack and Teams alert apps and the API, and the price list does not enumerate product features. The position is unknown. The seller neither claims an app nor denies one; says they will confirm and come back, in words a person would say.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_company_claim):

> There's no driver phone app. The driver side is the TrakNode unit in the vehicle, which collects and sends the data on its own, and the driver roster is what ties those records to a person. Everything your team looks at, the idle reports, temperature alerts, driver safety events, lives in the web console and the admin app.
> 
> What are you hoping drivers would do from a phone? That tells me whether the box covers it or whether we need to look at something else.

**E19 candidate, in the app** (Astra **4.0** · HARD FAIL · flags: unsupported_company_claim, important_question_unanswered):

> There's a **TrakNode unit in the truck** that does the tracking automatically, and **dispatcher and driver training is delivered through recorded modules in the help centre**. What drivers see day to day is mostly the alerts and reports that come out of that data.
> 
> Can I ask what you're picturing for your drivers? If it's coaching them on something like idling or safety, that shapes which modules make sense.

#### ER-D2-SALES-036 · missing_evidence · heard

**Question:** Our marketing team lives in HubSpot. Does your system feed into that, and is there a charge for it?

**A correct answer:** With the integration matrix not loaded, nothing says whether a HubSpot connector exists, on which plans, or at what fee. The price list lists only the NetSuite connector and points to the Integration Matrix for the other connectors. The seller neither confirms nor denies; says they will check the integration matrix and come back.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_company_claim):

> The HubSpot connector isn't on our current price list, so I don't want to quote you a number I can't stand behind. What I can tell you is that native connectors are priced as add-ons, and each one takes a few business days to configure and validate with your admin. Let me confirm whether HubSpot is supported natively and what it costs, and I'll come back to you. In the meantime, what would you want flowing between the two systems?

**E19 candidate, in the app** (Astra **4.0** · HARD FAIL · flags: unsupported_company_claim):

> HubSpot isn't one of our native connectors, so I don't want to tell you it's a yes. What I can do is confirm exactly what's available for HubSpot and what it would cost, because connector pricing does vary by plan. Can I ask what you'd want flowing between the two, contacts and driver records, or the marketing side pulling fleet data?

#### ER-D2-SALES-037 · missing_evidence · typed

**Question:** tempsense s2 - how long does the battery last and what temperature range is it rated for? prospect hauls frozen

**A correct answer:** No loaded document gives a battery life or a rated temperature range for the TempSense S2. What is documented: it is wireless and pairs with a TrakNode, costs $64 per sensor, and carries the 3-year hardware warranty. The assistant says the spec is not in the material, gives what is known, and tells the seller to get the spec sheet before answering the prospect.

**Main's answer** (Astra **8.8**):

> I'll confirm the TempSense S2 battery life and its rated temperature range and come back to you on both. For a frozen haul, the operating range is exactly the thing to pin down before you commit.
> 
> In the meantime, the sensor itself is **$64 per sensor** and pairs wirelessly with a **TrakNode**, and **Cold Chain Monitoring** runs **$3 per sensor per month** on any plan. What temperature does your frozen product need held, and how many trailers are you looking at?

Draft before the fix-up pass (Astra 9.3):

> I don't have the TempSense S2 battery life or its rated temperature range in front of me, so I won't guess at either. For a frozen haul, the operating range is exactly the thing to pin down before you commit, so let me get the spec sheet and confirm both numbers for you.
> 
> In the meantime, the sensor itself is $64 per sensor and pairs wirelessly with a TrakNode, and Cold Chain Monitoring runs $3 per sensor per month on any plan. What temperature does your frozen product need held, and how many trailers are you looking at?

**E19 candidate, in the app** (Astra **8.4**):

> I don't have the TempSense S2 battery life or its rated temperature range in front of me, so I won't guess on a frozen-haul spec. What I can tell you is that the sensor is wireless and pairs with a TrakNode, and Cold Chain Monitoring runs $3 per sensor per month on top of your plan.
> 
> Let me confirm the battery life and the exact operating range with our product team and come back to you. In the meantime, what temperature are you holding in the box, and how long are your longest runs between depots? That tells me whether the standard range covers you or whether we need to look at placement.

#### ER-D2-SALES-038 · missing_evidence · heard

**Question:** What availability number do you actually put in the contract?

**A correct answer:** No sales material is loaded, so there is no uptime figure to quote. The seller must not invent one; stays useful by saying they will send the service level terms and by asking what level the buyer needs, in words a seller would say.

**Main's answer** (Astra **8.3**):

> The number in the contract is the one we commit to in writing, so I'd rather set it from what you actually need than quote a figure now. What does your operation require, response time, uptime, or both?

#### ER-D2-SALES-039 · followup · heard

**Question:** What does the maintenance planning piece run, and is there any wiggle room on that?

**A correct answer:** Maintenance Planner is $5 per vehicle per month. There is no room on it: modules are never discounted (discounts apply to plan subscription fees only). The near misses are Driver Safety Scoring at $6 and Fuel & Idle Analytics at $4.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Maintenance Planner is **$5 per vehicle per month**, and it can be added to any plan with nothing further required. On the wiggle room, modules aren't discountable, so that price holds. What I can do is look at the plan rate itself, where volume discounts do apply. How many vehicles are you planning to put on it?

#### ER-D2-SALES-040 · followup · heard

**Question:** Okay, and across seventy vehicles, what's that for a full year?

**A correct answer:** Carries on from the previous turn: Maintenance Planner at $5 per vehicle per month, 70 x $5 x 12 = $4,200 for the year, with no discount applied.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Seventy vehicles on Maintenance Planner is $5 per vehicle per month, so that's **$4,200 a year**. And since modules aren't discountable, that figure holds. The plan rate underneath it is where volume discounts apply, so if you're looking at seventy vehicles on Operations, let's price that together.

### Recruiting — dev2 (40 questions; main scores 8.94 on 40 judged)

#### ER-D2-REC-001 · grounded_single · heard

**Question:** Can I ask how you're funded? I got burned once by a startup that ran dry, so I always check.

**A correct answer:** The recruiter answers from the team brief: Kestrelwick closed a Series D round of $85 million in May 2025, led by Tamarack Ridge Partners. The brief is cleared for candidates, so this is said plainly. Revenue, runway and valuation are not in the material and the brief says revenue and runway are for the hiring manager at the next stage, so the recruiter gives no figure for them and makes no claim about how long the money lasts.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> We closed a Series D round of $85 million in May 2025, led by Tamarack Ridge Partners, and we're about 310 people. I can't share revenue or runway, but Idris can go deeper on the business at the next stage.

#### ER-D2-REC-002 · grounded_single · heard

**Question:** Who would my counterparts be? Like, the other leads sitting next to me in that group.

**A correct answer:** From the team brief: the Data Platform group has two other teams. Query Platform is led by Tobiah Raskovic and Device Gateway is led by Maribel Oyelaran-Fitch. Their team sizes (6 and 5 engineers) may be mentioned but are not the size of the Ingestion Platform team.

**Main's answer** (Astra **9.4** · needed facts in the prompt: yes):

> The other leads in the group are **Tobiah Raskovic**, who leads Query Platform with six engineers, and **Maribel Oyelaran-Fitch**, who leads Device Gateway with five. Maribel is the one who moved across from this team in July, so she's also the person who'd hand over to you. You'd all report to Idris, the Director of Data Platform, and plan each quarter together.

#### ER-D2-REC-003 · grounded_single · heard

**Question:** What's the big stuff on the plate for next year? I'd like to know what I'd be signing up to deliver.

**A correct answer:** The recruiter gives the three 2027 priorities from the team brief: retire the legacy Sparrow batch importer by March 2027; move Kafka to tiered storage with a target of 30% lower storage spend; stand up a second ingestion region, us-west-2, by the third quarter of 2027. A short spoken answer. The hiring manager's unapproved on-call idea is not a roadmap item and is not mentioned.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The team brief is cleared for candidates, so I can share it. For 2027 the Ingestion Platform has three priorities: retire the legacy Sparrow batch importer by March, move Kafka to tiered storage with a target of 30% lower storage spend, and stand up a second ingestion region in us-west-2 by the third quarter. There's also an approved senior engineer opening for the first quarter, so you'd be hiring into the team.

#### ER-D2-REC-004 · grounded_single · heard

**Question:** Where does this sit on your ladder? I'm trying to work out whether it's a step up or a sideways move.

**A correct answer:** From the team brief: engineers are levelled E1 to E7 and this role is an E6. The recruiter states the role's level (the brief is cleared for candidates). Whether it is a step up depends on her current level, which nothing loaded states, so the recruiter may ask rather than assert it.

**Main's answer** (Astra **9.4** · needed facts in the prompt: yes):

> The role is an E6 at Kestrelwick, and it's a lead role: line management of four engineers, plus the senior technical voice on the team. Whether that's a step up or sideways really depends on what you're doing now, so tell me about your current role and how it compares.

#### ER-D2-REC-005 · grounded_single · typed

**Question:** what's the service target this team is on the hook for? she asked and i blanked

**A correct answer:** Private reminder from the job description: the team's ingestion service-level objective is 99.9% of device messages processed within 60 seconds, and the lead owns it. The team brief's median delay of 4 seconds is a measured figure, not the objective.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The service target is in the JD: **99.9% of device messages processed within 60 seconds**. That's the team's ingestion SLO, and the lead owns it. If she wants the operational picture behind it, the team brief has the current numbers: about 1.9 billion messages on a normal weekday, a peak near 52,000 per second in the afternoon dispatch window, and a median of 4 seconds from a trailer sending a reading to it being queryable.

#### ER-D2-REC-006 · grounded_single · heard

**Question:** How much of this is still hands-on? Like, out of a forty-hour week, how many hours am I near the actual systems versus in one-on-ones and planning?

**A correct answer:** The job description puts roughly 60% of the week on people and delivery leadership and 40% on hands-on work. Of a forty-hour week that is about 16 hours hands-on (40 x 0.40) and about 24 on leadership. The recruiter gives it as a rough split, not a fixed timetable.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The JD puts it at roughly 60% people and delivery leadership, 40% hands-on: design reviews, code review and incident response. So on a forty-hour week that's about 16 hours near the systems, and the rest in 1:1s, planning and reviews. That's the shape we've written down.

Draft before the fix-up pass (Astra 9.9):

> The JD puts it at roughly 60% people and delivery leadership, 40% hands-on: design reviews, code review and incident response. So on a forty-hour week that's about 16 hours near the systems, and the rest in 1:1s, planning and reviews. That's the shape we've written down, and it's what the team actually needs from the lead. If you want, I can ask Idris to walk you through how that split looks in a typical week at the next stage.

#### ER-D2-REC-007 · grounded_single · heard

**Question:** For the panel day, would I have to come up to Duluth, or could I do it from here?

**A correct answer:** The current process guide says the panel loop is held at the Duluth office or by video, whichever the candidate prefers, so it is her choice. The 2025 overview's hiring section describes a virtual-only panel; it is out of date and its session format is not quoted. If she comes in person, travel and one hotel night are booked and paid by the recruiting coordinator, which may be mentioned.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The panel loop is held at the Duluth office or by video, whichever you prefer, so you can do it from Madison if that's easier. If you'd rather come to Duluth, our recruiting coordinator books and pays for travel and one hotel night directly, so you wouldn't have to claim anything back. Which would you like me to set up?

#### ER-D2-REC-008 · grounded_single · heard

**Question:** If I joined in November, say, would I see anything bonus-wise for this year, or do I just miss it?

**A correct answer:** Current Total Rewards overview: bonuses are paid in March for the previous calendar year and are prorated for a partial first year. So a November start would not miss it: she would be eligible for a prorated share for 2026, paid in March 2027. The lead-level target is 12% of base; it is a target, not a guaranteed payment.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The bonus target for this role is 12% of base, and bonuses are prorated for a partial first year, so a November start would earn a partial bonus for this year rather than missing it entirely. The payout comes in March for the previous calendar year. I'll confirm the exact proration with Total Rewards so you have it in writing.

#### ER-D2-REC-009 · grounded_single · heard

**Question:** And if it doesn't go my way this time around, is the door shut for good?

**A correct answer:** From the process guide: candidates who are not selected may re-apply to Kestrelwick after 6 months. They are told by phone or video, not by email alone, and feedback is offered to anyone who reached the panel loop. The recruiter answers plainly and does not hint at how this process will end.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The process guide is clear on this: candidates who aren't selected can re-apply after 6 months, and feedback is offered to anyone who reached the panel loop. So the door isn't shut for good. I'll confirm the exact timing and next steps in writing after today.

#### ER-D2-REC-010 · grounded_single · typed

Said before:

> user: What was the hardest account you had to keep running?
> other: Our biggest one, Brindlemoor Chilled Haulage. I probably shouldn't say this, but they pay Halcyard about two point four million a year, and their trailers fail temperature audits all the time.

**Question:** she just told me a halcyard customer's contract value and that they fail audits. automatic no or what?

**A correct answer:** Not automatic. The scorecard lists sharing a former employer's confidential customer data as a red flag. Red flags do not end the process on their own: the recruiter records it and raises it in the debrief. It is not one of the three disqualifiers. The private advice says that, and the recruiter carries on with the screen.

**Main's answer** (Astra **9.0** · needed facts in the prompt: yes):

> Not an automatic no. The scorecard lists sharing a former employer's confidential customer data as a red flag, not a disqualifier, so record it and raise it in the debrief. She volunteered a customer name and contract value that the team brief says recruiters must not share, so probe it neutrally: "You mentioned Brindlemoor and what they pay. That's the kind of detail we'd keep out of the record here. Can you tell me about the audit failures without naming the customer or the numbers?"

#### ER-D2-REC-011 · grounded_single · heard

Said before:

> user: What's one design call on that pipeline you'd make again?

**Question:** Um, the micro-batching thing, probably. It's hard to explain unless you know the consumer internals, honestly. It just made everything faster.

**A correct answer:** A must-have on the scorecard is explaining a design trade-off to a non-specialist in under two minutes. She has ducked the explanation. Natively gives the recruiter a probe that asks her to explain that choice in plain terms, briefly, as she would to someone outside engineering: what she gained and what she gave up. It does not explain micro-batching for her.

**Main's answer** (Astra **8.7** · flags: missed_available_evidence · needed facts in the prompt: yes):

> What did micro-batching actually change in the consumers, and how did you measure that it was faster?

#### ER-D2-REC-012 · grounded_single · heard

Said before:

> user: You run those Kafka clusters yourselves, right?

**Question:** Yeah, all of it's ours. It's been really solid, honestly. When something does go sideways the platform folks usually jump on it.

**A correct answer:** The must-have for streaming platform operations needs a failure the candidate diagnosed herself. She has said the platform people handle failures. Natively gives the recruiter a past-tense probe for one specific Kafka failure that she personally diagnosed: what she saw, what she worked out, what she did.

**Main's answer** (Astra **7.9** · flags: missed_available_evidence · needed facts in the prompt: yes):

> That's good to hear. Take me back to the Kafka migration at Halcyard. Your résumé says you contributed to it, and your meetup talk makes it sound more like yours. What did you personally decide on that program?

#### ER-D2-REC-013 · grounded_single · heard

**Question:** Who's actually using this thing? Any carriers I'd have heard of?

**A correct answer:** From the team brief: 140 refrigerated carriers in the United States and Canada, with roughly 61,000 trailers reporting in. The brief says recruiters must not share the names of customers that are not on the public customer page, and no customer name appears in the material, so the recruiter gives the numbers, names nobody, and may point her to the public customer page or to the hiring manager.

**Main's answer** (Astra **7.0** · flags: coaching_instead_of_answer, ai_epistemic_leak · needed facts in the prompt: yes):

> The team brief is cleared for candidates, so you can share it directly. It names 140 refrigerated carriers in the US and Canada, but it doesn't list which ones, and customer names not on the public page are off limits. Say the hiring manager can go deeper on the business at the next stage.

#### ER-D2-REC-014 · grounded_single · typed

**Question:** so far i've covered who really owned the kafka move and whether she still codes. what else did idris want me to get out of her?

**A correct answer:** Idris's notes list four things to dig at. Two are done. The two left are: one real case of her managing someone out or coaching an underperformer back, with a beginning and an end; and why she is leaving Halcyard, which he does not know. The on-call idea, the pay remark and the timing hope in the same notes are not questions for the candidate, and the on-call idea must not be floated.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Idris's notes list four things for the Vaskirk screen. You've done the Kafka ownership question and the "is she still coding" one. The two left are: has she actually managed someone out, or coached someone back from the edge, with one real case that has a beginning and an end; and why she's leaving Halcyard, since there was nothing in her cover note.
> 
> One thing to keep off the table: Idris is leaning toward taking the lead off the pager rota once the new senior hire lands, but he hasn't cleared it with Yevgenia and the JD still says the lead carries the pager one week in five. He asked you not to float it, so if she asks about on-call, describe the rotation as the JD states it and leave the change out.

#### ER-D2-REC-015 · grounded_single · typed

**Question:** the latency win on her cv, how big is that as a multiple or a percent? want the writeup to be right

**A correct answer:** The resume says p99 ingestion latency went from 4.2 s to 900 ms. 4.2 / 0.9 = about 4.7 times lower; as a reduction, (4.2 - 0.9) / 4.2 = about 79%. Either form is a correct answer. It is the resume's claim, not yet verified in conversation.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The résumé gives it as **4.2 seconds to 900 ms** on p99 ingestion latency, so about a **4.7x** improvement, roughly **79%** lower.
> 
> [[CALC]]
> old_latency_ms = 4.2 * 1000 = 4200
> new_latency_ms = 900
> multiple = 4200 / 900 = 4.67
> reduction_pct = (4200 - 900) / 4200 = 0.786
> [[/CALC]]
> 
> That's her own line, so it's safe to quote. Worth asking her to walk through the partition-key and micro-batching decisions behind it, since that's where the ownership shows.

**E19 candidate, in the app** (Astra **9.9**):

> The résumé gives it as **4.2 s to 900 ms** on p99 ingestion latency, so that's roughly a **4.7x** improvement, about **79%** lower. Those are the only latency figures on the CV, so quote them as stated rather than rounding to a headline multiple.

#### ER-D2-REC-016 · multi_source · typed

**Question:** if we end up wanting to put 190 on the table for her, who all has to say yes?

**A correct answer:** The posted range is $172,000 to $198,000, so its midpoint is (172,000 + 198,000) / 2 = $185,000. $190,000 is inside the range but above the midpoint. Per the process guide every offer is approved by the hiring manager and the VP of Engineering, and an offer above the midpoint also needs sign-off from Total Rewards. The Head of People Operations is only needed for pay outside the range, which this is not. Nothing is to be said to the candidate until it is approved.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> $190,000 is inside the posted range of $172,000 to $198,000, so it doesn't need the outside-range approvals. What it does need: the hiring manager and the VP of Engineering approve the offer, and because $190,000 is above the midpoint of the range, Total Rewards also signs off. So that's Idris, Yevgenia, and Total Rewards.

#### ER-D2-REC-017 · multi_source · heard

Said before:

> user: One thing I should be upfront about: the lead here is on the rotation along with the team.

**Question:** Hmm. Honestly, part of why I'm after a lead job is to be done with the pager for good. I've done my years of that.

**A correct answer:** The approved job description has the lead on the on-call rotation as a regular participant, one week in five. The scorecard makes being unwilling to take part in on-call a disqualifier. What she has voiced is a wish, not yet a refusal, so the recruiter's next line is straight about the one-week-in-five expectation and asks her directly whether she is willing to do that. The hiring manager's unapproved idea of taking the lead off the rota is not hinted at, and no verdict is pronounced to her.

**Main's answer** (Astra **8.9** · flags: important_question_unanswered · needed facts in the prompt: yes):

> The lead here does carry the pager, one week in five, and that's in the job description. I'd rather be straight with you than have it surprise you later. What's behind wanting off the rotation?

#### ER-D2-REC-018 · multi_source · heard

**Question:** I've got about twenty-two thousand units reporting in at Halcyard. Is your fleet like double that, or bigger?

**A correct answer:** The team brief says roughly 61,000 trailers report into Kestrelwick's platform. Against the 22,000 she just gave (her resume says the same), that is 61,000 / 22,000 = about 2.8 times, so closer to triple than double. The recruiter gives the Kestrelwick number and the comparison.

**Main's answer** (Astra **9.1** · flags: coaching_instead_of_answer · needed facts in the prompt: yes):

> That's the number to give, and it's cleared for candidates.
> 
> We have about **61,000 trailers** reporting into the platform, so closer to three times that. The Ingestion team itself is small, four engineers plus the lead, and they're the ones who own that stream end to end.

#### ER-D2-REC-019 · multi_source · typed

**Question:** screen's today, tue oct 6. if hers runs the normal length when do we get to a decision, and is that soon enough for when idris wants someone signed?

**A correct answer:** The process guide says a typical process runs three to four weeks from the recruiter screen to a decision. From Tuesday 6 October 2026 that is between Tuesday 27 October and Tuesday 3 November. Idris's notes say he hopes to have someone signed by mid-November, and call it a hope, not a promise. A decision by early November leaves room for references, approval and the offer window, so mid-November is possible but tight and not guaranteed. This is private planning; no date is promised to the candidate. The 2025 overview's 'about five weeks' is out of date.

**Main's answer** (Astra **8.3** · needed facts in the prompt: yes):

> The screen is today, so the clock starts now. From the recruiter screen, the guide commits to an outcome within 2 business days, then the hiring manager interview, then the panel loop with its debrief within 2 business days and the candidate told within 3 business days after that. A typical process runs three to four weeks from screen to decision, so a normal-length run lands you a decision around late October to early November.
> 
> That's tight against Idris's mid-November hope, and it's a hope, not a promise. The bigger risk is the panel: it needs all four interviewers, and the cross-functional seat from Customer Operations isn't filled yet, with Bartholomew still chasing calendars. If that slot slips, the decision slips with it. Worth pinning that seat down this week.

#### ER-D2-REC-020 · multi_source · typed

**Question:** who's lined up for her panel so far, and which slots are still empty?

**A correct answer:** The process guide gives four sessions for a lead role: system design, people leadership, incident retrospective and cross-functional partner. Idris's notes fill two: Tobiah takes system design and Maribel takes the incident retro. The cross-functional interviewer is not set (probably someone from Customer Operations; Bartholomew is chasing calendars). The notes name nobody for people leadership, so that slot is open or at least unconfirmed, and no name is invented for it.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: missed_available_evidence, major_factual_error, important_question_unanswered · needed facts in the prompt: yes):

> Tobiah has the system design session and Maribel the incident retro. The cross-functional slot is still open, likely someone from Customer Operations, and Bartholomew is chasing calendars for it. So that's three of the four panel sessions covered, with the cross-functional one to fill.

#### ER-D2-REC-021 · multi_source · heard

Said before:

> user: How much hiring have you done yourself?

**Question:** Oh, loads. I've probably brought on eight or nine engineers at Halcyard. It's a big part of the job for me.

**A correct answer:** She says eight or nine hires. Her resume says she hired 3 engineers (and supported one promotion). Natively gives the recruiter a probe that surfaces the gap without accusing her: which hires she is counting (ones where she was the hiring manager, or ones she interviewed for), and a walk through one she ran herself. The scorecard says to note both versions and ask the candidate to reconcile them, not to assume which is right.

**Main's answer** (Astra **8.1** · flags: missed_available_evidence · needed facts in the prompt: yes):

> Eight or nine is a lot. Give me one of them: who was the hire, what was the gap you were hiring against, and what did you personally do in that process that made the difference?

#### ER-D2-REC-022 · multi_source · typed

**Question:** is she still hands-on in go or has she gone full manager? what does the cv actually show

**A correct answer:** The resume shows Go work but cannot say whether she writes it today. As Senior Software Engineer (June 2020 to February 2023) she wrote the Go client library that 11 internal services use; as team lead the latency work mentions micro-batching in the Go consumers without saying she wrote it; Go is first in her skills list. Idris's notes ask exactly this, say either answer is fine, and want it known before the panel so Tobiah can pitch his session. So the private answer is: on paper yes for Go, current hands-on not shown, ask her directly.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: major_reasoning_error, missed_available_evidence · needed facts in the prompt: yes):

> The CV shows she's still hands-on. Her current lead role at Halcyard lists redesigning partition keys and introducing micro-batching in the Go consumers, plus a Go client library earlier. So it's not all meetings. Worth asking how much of her week is still code versus management, since the role here is 60/40.

#### ER-D2-REC-023 · multi_source · heard

**Question:** Would there be any kind of handover, or am I inheriting the team cold?

**A correct answer:** Not cold. The team brief says the previous lead, Maribel Oyelaran-Fitch, moved across in July 2026 to start the Device Gateway team, is still in the group and has offered to hand over in person. The hiring manager's notes add that she will give the new lead two weeks of overlap, sitting in on standups and the planning session. The recruiter says both, as the plan rather than a guarantee.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Yes, there's a handover. Maribel, who led the team before moving to Device Gateway, has offered two weeks of overlap with you, sitting in on standups and the planning session. So you'd be coming in alongside her rather than inheriting the team cold.

#### ER-D2-REC-024 · conflict_stale · heard

**Question:** And if I'm out with the flu for a few days, does that eat into my vacation?

**A correct answer:** Two Total Rewards overviews are loaded. Version 4.1 (effective 1 March 2026) gives 10 sick days per year, separate from PTO. Version 3.2 (effective 1 February 2025) said sick time is taken from the PTO balance; it is out of date and only its version and date lines show that. The recruiter says no, sick days are their own allowance of 10.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Sick time is separate from PTO, so being out with the flu doesn't come out of your vacation. You get 10 sick days a year, and no doctor's note is needed for absences of three days or fewer.

**E19 candidate, in the app** (Astra **7.1** · flags: missed_available_evidence, excessive_deferral, evidence_overload):

> Sick time is separate from PTO, so being out with the flu wouldn't come out of your vacation days. You get 10 sick days a year, and no doctor's note is needed for absences of three days or fewer. One thing to flag: our time-away figures are given two ways in what I have, one version has 20 days of PTO with sick time taken from the same balance, the other has 24 days of PTO with 10 sick days separate, so I'd want that confirmed before you rely on it.

#### ER-D2-REC-025 · conflict_stale · heard

**Question:** If I start partway through a month, is there a gap before the health insurance kicks in? I got caught by that at my last job.

**A correct answer:** Version 4.1 of the Total Rewards overview (2026) says coverage starts on the first day. Version 3.2 (2025) said coverage starts on the first of the month after the start date, which would leave a gap; it is out of date. The recruiter says there is no gap: she is covered from day one.

**Main's answer** (Astra **6.0** · flags: missed_available_evidence, excessive_deferral, evidence_overload · needed facts in the prompt: yes):

> Coverage starts on your first day, so there's no gap. The current Total Rewards overview is the one to go by, and it says coverage starts on day one. I should flag that I've seen this given two ways, one version says coverage starts on your first day, another says it starts the first of the month after your start date, so let me confirm which applies before you rely on it.

Draft before the fix-up pass (Astra 9.9):

> Coverage starts on your first day, so there's no gap. The current Total Rewards overview is the one to go by, and it says coverage starts on day one.

#### ER-D2-REC-026 · conflict_stale · heard

**Question:** So, full disclosure, we're expecting in late April. If I started on the seventh of December, when would I actually qualify for leave? I'm doing the math.

**A correct answer:** Version 4.1 (2026): employees are eligible for parental leave after 90 days of employment. Ninety days after Monday 7 December 2026 is 7 March 2027, so she would qualify in early March, well before late April, and every new parent gets 18 weeks fully paid. Version 3.2 (2025) said six months of service, which would be June and too late; it is out of date. The recruiter gives the early-March date and does not promise a start date or an offer.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The parental leave policy says eligibility starts after 90 days of employment, and leave can be taken in one or two blocks within the first year after the child arrives. A December 7 start would put you past 90 days in early March, so late April would fall inside that window. I'll have People Ops confirm the exact qualifying date and how the blocks work for your situation.

#### ER-D2-REC-027 · conflict_stale · typed

**Question:** writing her the recap. vacation days plus company holidays, what total can i quote?

**A correct answer:** Use version 4.1 (effective 1 March 2026): 24 days of PTO plus 11 company holidays = 35 days. Version 3.2 (2025) has 20 and 10, which would give 30; it is out of date. Sick days (10, separate) and the winter closure (24 December to 1 January, not deducted from PTO) come on top and may be mentioned.

**Main's answer** (Astra **8.3** · flags: excessive_deferral, evidence_overload · needed facts in the prompt: yes):

> For the recap, quote **24 days of PTO** plus **11 company holidays**, so 35 days total. That's from the current Total Rewards overview, version 4.1, effective 1 March 2026. Worth adding that PTO accrues at 2 days a month and up to 5 unused days carry over, and that the winter closure from December 24 through January 1 doesn't come out of PTO. One thing to flag: the time-away figures are given two ways across the Total Rewards versions, 24 days of PTO and 11 company holidays in version 4.1, against 20 days of PTO and 10 company holidays in version 3.2, with accrual and carryover also differing, so confirm which applies before anyone relies on the total.

Draft before the fix-up pass (Astra 10.0):

> For the recap, quote **24 days of PTO** plus **11 company holidays**, so 35 days total. That's from the current Total Rewards overview, version 4.1, effective 1 March 2026. Worth adding that PTO accrues at 2 days a month and up to 5 unused days carry over, and that the winter closure from December 24 through January 1 doesn't come out of PTO.

**E19 candidate, in the app** (Astra **7.5** · flags: missed_available_evidence, excessive_deferral):

> Quote **35 days**: 24 days of PTO plus 11 company holidays. That's from the current Total Rewards overview, version 4.1, effective 1 March 2026. Worth adding that the winter closure from December 24 through January 1 sits on top of that and isn't deducted from PTO, and that PTO accrues at 2 days a month, so it's earned across the year rather than handed over on day one. Note that the time-away figures are given two ways across the overviews, 20 days of PTO and 10 company holidays in one, 24 days of PTO and 11 company holidays in the other, so that needs confirming before anyone relies on it.

#### ER-D2-REC-028 · conflict_stale · heard

**Question:** Do you help with the home setup at all? My current place gives us a monthly internet thing.

**A correct answer:** Version 4.1 (2026) gives new hires a one-time home-office setup allowance of $600. The monthly remote stipend of $75 appears only in version 3.2 (2025), which is out of date; the current overview lists no monthly internet stipend. The recruiter states the $600 one-time allowance and does not offer a monthly amount.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The home-office setup allowance is a one-time **$600**, and that's for setting up your workspace. On the monthly internet, I'll confirm what's current and come back to you.

Draft before the fix-up pass (Astra 9.8):

> The home-office setup allowance is a one-time **$600**, and that's for setting up your workspace. On the monthly internet, I'll be straight with you: I don't have that in front of me, so let me confirm what's current and come back to you rather than guess.

**E19 candidate, in the app** (Astra **6.5** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral):

> I'll confirm how the home setup and any internet allowance apply to this role's working arrangement and follow up with you.

#### ER-D2-REC-029 · conflict_stale · heard

**Question:** A friend of mine interviewed with you a while back and said her last round was a sit-down with one of the founders. Is that still how it ends?

**A correct answer:** No longer. The current process guide (version 2.3, effective 15 June 2026) ends with an executive conversation: 30 minutes with the VP of Engineering. The founder values conversation is from the hiring section of the 2025 Total Rewards overview, which is out of date. The recruiter says what the last stage is now and does not promise she will reach it.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The process ends with a 30-minute executive conversation with the VP of Engineering, not a founder sit-down. That's the current guide, effective 15 June 2026, so it may well have changed since your friend went through it. I'll confirm the exact format for your loop when we get to that stage.

#### ER-D2-REC-030 · conflict_stale · typed

**Question:** i've got two total rewards pdfs in the folder. which one do i send her after the call?

**A correct answer:** Send version 4.1, effective 1 March 2026 (Kestrelwick_Total_Rewards_Overview.pdf). The other file is version 3.2, effective 1 February 2025: its file name says FINAL but its version and date lines show it is last year's. Neither document says it supersedes the other, so the version and date are the only tell. The process guide confirms the overview is cleared for candidates.

**Main's answer** (Astra **9.6** · needed facts in the prompt: yes):

> Send the **Version 4.1** one, effective 1 March 2026, owned by People Operations. The other file is Version 3.2 from February 2025 and it's out of date: it still describes a take-home exercise and a five-stage process, and the current guide says there's no take-home and four stages. So the older one would contradict what you've told her.

#### ER-D2-REC-031 · irrelevant_source · heard

**Question:** Hey, sorry, my video keeps freezing on me. Would it be alright if I turned the camera off and we just did audio?

**A correct answer:** A present, practical decision. The recruiter just says yes, of course, and carries on. The process guide's description of the screen as a video call is not a rule to enforce here and is not cited.

**Main's answer** (Astra **10.0**):

> Of course, that's no problem at all. Let's switch to audio. Can you still hear me clearly?

#### ER-D2-REC-032 · irrelevant_source · typed

**Question:** she keeps saying debezium like i should know it. what is it, two lines

**A correct answer:** General knowledge, defined in no loaded file. Debezium is an open-source change data capture tool: it reads a database's transaction log (for example PostgreSQL's write-ahead log) and emits each row-level insert, update and delete as an event, usually into Kafka through Kafka Connect, so other systems can follow the database in near real time. Short and private. The resume names Debezium but does not define it, and the team brief does not list it in Kestrelwick's stack.

**Main's answer** (Astra **9.4**):

> Debezium is an open-source change data capture tool: it reads the database's transaction log and turns every insert, update and delete into a stream of events, usually onto Kafka. So instead of polling tables, you get each row change as it happens.
> 
> She has it on her résumé from her Halcyard years, where she built a CDC pipeline from PostgreSQL into Kafka with it, replicating 140 tables. Worth asking what she personally decided in that build, since the résumé says "built" but not what she owned.

#### ER-D2-REC-033 · irrelevant_source · heard

Said before:

> user: Why don't you walk me through your background.

**Question:** Sure. Do you want the whole story from the start, or should I just jump in at the current job?

**A correct answer:** A present decision for the recruiter, not a document lookup. The recruiter picks one and says so (for example: start with the current role and touch the earlier jobs briefly). The reply does not recite her resume back to her, does not answer on her behalf and does not quote the length of the call.

**Main's answer** (Astra **10.0**):

> Start with the current job, then we can go back if I want more. So take me through the lead role at Halcyard, and start with what you personally own there.

#### ER-D2-REC-034 · irrelevant_source · typed

**Question:** we're at time and i've still got one topic left. skip it or ask if she can stay five more?

**A correct answer:** A judgment call in the moment, not a policy lookup. Sensible advice: ask her whether she has five more minutes, and if she does not, drop it or pick it up in the follow-up. The process guide's 30-minute length for the screen is a description, not a ban on running over with the candidate's agreement, and nothing in the material decides this.

**Main's answer** (Astra **9.9**):

> Ask her. Five minutes is a small ask and the topic is worth it.
> 
> "Before we wrap, I've got one more area I'd like to cover. Do you have five more minutes, or would you rather I pick it up another time?"
> 
> If she can't stay, don't force it. Note what's left and say you'll follow up on it, then submit the scorecard within 24 hours.

#### ER-D2-REC-035 · missing_evidence · heard

**Question:** What's turnover been like on this team? Has anybody quit in the last year or so?

**A correct answer:** Nothing loaded gives turnover or departures for the team. The only related fact is that the role is open because the previous lead moved internally to start the Device Gateway team and is still in the group, which is not a resignation. The recruiter may say that, does not state a turnover figure, does not claim that nobody has left, and offers to find out or to have the hiring manager speak to it at the next stage. Spoken wording stays human (for example 'let me confirm that and come back to you'); it does not talk about files, documents or loaded context.

**Main's answer** (Astra **8.9** · flags: ai_epistemic_leak):

> The team brief doesn't give turnover numbers, so I can't quote a figure. What it does say is that the role is open because the previous lead, Maribel, moved across in July 2026 to start the Device Gateway team, and she's still in the group.

Draft before the fix-up pass (Astra 9.7):

> I don't have the team's turnover history in front of me, so I won't guess at it. What I can tell you is the role is open because the previous lead, Maribel, moved across in July to start the Device Gateway team, and she's still in the group. On anyone else leaving, let me check with Idris and come back to you.

**E19 candidate, in the app** (Astra **9.1** · flags: ai_epistemic_leak):

> The team brief doesn't give turnover numbers or say whether anyone has left in the past year, so I don't have that to share. What it does say is that the role is open because the previous lead, Maribel, moved across in July 2026 to start the Device Gateway team, and she's still in the group. Idris can speak to team history in more depth at the next stage.

#### ER-D2-REC-036 · missing_evidence · heard

**Question:** I'd be leaving unvested stock on the table if I moved. Do you ever do a sign-on bonus to cover that kind of thing?

**A correct answer:** Nothing loaded mentions a sign-on bonus. The recruiter neither offers one nor rules it out: she notes it, says she will confirm and come back, and may say what does exist (an annual bonus and a new-hire option grant). She does not promise an exception or a figure; recruiters do not promise pay or policy exceptions. Spoken wording stays human (for example 'let me confirm that and come back to you'); it does not talk about files, documents or loaded context.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_policy_claim):

> We don't have a sign-on bonus as a standard part of the package, so I can't promise one today. What I can do is make sure the team knows about the unvested equity when we get to offer stage, and I'll confirm what's possible and come back to you.

**E19 candidate, in the app** (Astra **9.5**):

> The posted range for this role is $172,000 to $198,000, and the offer also includes a new-hire equity grant. On the sign-on question, let me check and come back to you with a real answer rather than a guess.

#### ER-D2-REC-037 · missing_evidence · typed

**Question:** how much notice does she owe halcyard? need it to work out a start date

**A correct answer:** Her notice period is not stated anywhere: not on the resume, not in Idris's notes. The private answer says so, does not guess a length, and suggests asking her. It may add what the material does give for planning: new hires start on the first or third Monday of a month.

**Main's answer** (Astra **10.0**):

> The notes don't state her notice period at Halcyard, and nothing in the process guide or the role material covers it either. So I'd ask her directly: "What notice do you owe Halcyard, and when could you realistically start?" Then work the start date from the guide's rule that new hires start on the first or third Monday of a month, plus the background check that runs after acceptance and usually takes about a week.

#### ER-D2-REC-038 · missing_evidence · heard

**Question:** Is there any kind of budget for courses or conferences? I try to get to one a year.

**A correct answer:** No recruiting document is loaded. The recruiter does not invent a stipend or an amount and does not say there is none; she says she will send the benefits summary or confirm the details right after the call. Material from other modes' files (another company's benefits or prices) must not be used. Spoken wording stays human (for example 'let me confirm that and come back to you'); it does not talk about files, documents or loaded context.

**Main's answer** (Astra **9.7**):

> Let me confirm what's available for courses and conferences and get back to you. In the meantime, tell me what you've gone to recently and what you got out of it.

Draft before the fix-up pass (Astra 9.2):

> I don't have the specifics of our learning budget in front of me, so let me confirm what we offer for courses and conferences and get back to you. In the meantime, tell me what you've gone to recently and what you got out of it.

**E19 candidate, in the app** (Astra **9.7**):

> I'll confirm what we offer for courses and conferences and get back to you. In the meantime, tell me what you've gone to recently and what you got out of it.

#### ER-D2-REC-039 · followup · heard

**Question:** Okay, so say the conversation with the VP goes well. What still has to happen before there's actually an offer?

**A correct answer:** Turn 1 of a chain. From the process guide: after the executive conversation, two professional references are checked before any offer is made; the offer is approved by the hiring manager and the VP of Engineering; a verbal offer comes first and the written one follows within 1 business day. The background check comes only after an offer is accepted. The recruiter describes the steps and who decides, and does not promise an offer.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> After the VP conversation, two professional references get checked, and that happens before any offer is made. The offer itself needs approval from the hiring manager and the VP of Engineering, and if the base lands above the midpoint of the posted range it also needs sign-off from Total Rewards. Once it's accepted, a background check runs and usually takes about a week.

#### ER-D2-REC-040 · followup · heard

**Question:** Right. And when that lands in writing, how long would I have to make up my mind?

**A correct answer:** Turn 2 of the chain; 'that' is the offer described in turn 1. The process guide says offers stay open for 5 business days. The recruiter gives that window and does not promise that an offer will come.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Offers stay open for **5 business days**. If you'd like, I can walk you through what the written offer itself covers.

### Team Meet — dev2 (40 questions; main scores 9.00 on 40 judged)

#### ER-D2-TEAM-001 · grounded_single · heard

**Question:** The crews who never get round to updating, how long do the old sync endpoints stay switched on for them?

**A correct answer:** Decision D-011: the v2 endpoints stay up for 2.x clients until at least the end of January 2027. 'At least' matters: it is a floor, not an announced shutdown date. Not to be confused with the 14 days of dual-write after the cut-over.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The v2 endpoints stay up for 2.x clients until at least the end of January 2027, so crews who haven't updated by then keep working through the changeover. That's the committed window in the decision log, and it's the same for everyone on 2.x, not just the ones who update late.

#### ER-D2-TEAM-002 · grounded_single · typed

**Question:** why did we end up paying for a pdf renderer instead of just letting android and ios print to pdf themselves?

**A correct answer:** Decision D-012: PDF export uses the Inkspindle renderer on both platforms because the alternative, rendering HTML to PDF with each platform's own print engine, gave different page breaks on Android and iOS in the prototype. One or two lines. The current font defect is a problem with the chosen renderer, not the reason it was chosen.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> We went with Inkspindle because the alternative, rendering HTML to PDF with each platform's own print engine, gave us different page breaks between Android and iOS in the prototype. That inconsistency was the deciding factor, so the renderer was chosen at the end of July and the licence is annual, held by Product.

#### ER-D2-TEAM-003 · grounded_single · heard

**Question:** Can a supervisor have a report emailed to them straight off our servers, or how does it actually get off the phone?

**A correct answer:** Decision D-017: exports are generated on the device and shared through the system share sheet; there is no emailed export from the server in 3.0. So no server-side email; the crew member shares the file from the phone.

**Main's answer** (Astra **9.6** · needed facts in the prompt: yes):

> The decision log settles this one. D-017 says exports are generated on the device and shared through the system share sheet, and it's explicit that there's no emailed export from the server in 3.0. So a supervisor can't have a report mailed straight off our servers. What they get is the report as a PDF or CSV, and they share it themselves from the phone, by email or whatever else is on the share sheet. XLSX isn't in 3.0 either, that's parked for 3.1.

#### ER-D2-TEAM-004 · grounded_single · typed

**Question:** what share of our active devices is android, roughly? need a % for a slide

**A correct answer:** Roadmap section 1: roughly 48,000 active devices at the start of September, 31,000 on Android and 17,000 on iOS. 31,000 / 48,000 = 64.6%, so about 65%, roughly two thirds. The figures are from the start of September.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Roughly **65%**. The roadmap has about 48,000 active devices at the start of September, 31,000 on Android and 17,000 on iOS, so Android is a bit under two thirds. That's from the approved v4 roadmap, so it's a September figure, worth a quick refresh if the slide needs to be current.

#### ER-D2-TEAM-005 · grounded_single · heard

**Question:** The phones that are too old to take 3.0, do those crews still get anything from us or are they just stuck?

**A correct answer:** Decision D-014: devices on systems below the minimum stay on the 2.x line, which receives security fixes only. No new features there. A helpful extra: the v2 sync endpoints stay up for 2.x clients until at least the end of January 2027, so the old app keeps working.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> The platform floor was set on 26 August: 3.0 supports Android 10 and later, and iOS 16 and later. Devices below that stay on the 2.x line, which still gets security fixes, so those crews aren't cut off, they just don't move to 3.0. If you want to reopen the floor, that's a release review decision, and Halvard already said he wasn't reopening it.

#### ER-D2-TEAM-006 · grounded_single · heard

**Question:** What time are we doing the demo on Friday?

**A correct answer:** The Sprint 41 review and demo is on Friday 9 October at 15:00. Not the retro (Monday 12 October at 10:00) and not the weekly sync (Mondays at 14:00).

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The Sprint 41 review and demo is **Friday 9 October at 15:00**.

#### ER-D2-TEAM-007 · grounded_single · typed

**Question:** how many points are we still carrying into week 2 of the sprint, i.e. everything not done yet

**A correct answer:** As of the 2 October status: 21 points in progress plus 11 not started = 32 points not yet done (the same as 84 committed minus 52 done). The answer gives 32 and may give the split.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: arithmetic_error · needed facts in the prompt: yes):

> We're carrying **32 points** into week 2: 21 in progress and 11 not started, out of 84 committed. That's on top of the 3 points carried over from Sprint 40, both export stories. So 52 points are done as of end of week 1.

#### ER-D2-TEAM-008 · grounded_single · heard

**Question:** Ilka, on the low-memory phones, what's the point where we say it's gone wrong and pull background sync on them?

**A correct answer:** Risk R-07, which the user owns: the trigger is more than 1 in 200 sessions on those models ending in a crash (0.5%). The contingency then is to disable background sync on the affected models. The cap of 200 records per sync batch is the mitigation, a different thing that happens to carry the same number. First person.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The trigger's in the risk register: more than 1 in 200 sessions on those models ending in a crash. That's when we pull background sync on the affected models. Before that, the mitigation is capping the sync batch at 200 records on devices under 3 GB of RAM, and both fixes are planned for beta build b7.

#### ER-D2-TEAM-009 · grounded_single · heard

**Question:** Will people be able to flip dark mode on and off from inside the app's own settings?

**A correct answer:** No. In 3.0 the dark theme follows the system setting on both platforms; there is no in-app switch (roadmap, themes table).

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> No, not in 3.0. Dark theme follows the system setting on both platforms, and the roadmap is explicit that there's no in-app switch in 3.0. An in-app toggle isn't on the 3.1 candidate list either, so if crews are asking for it, that's worth raising as a scope request.

#### ER-D2-TEAM-010 · grounded_single · heard

**Question:** If sync falls over while Tobiah's on holiday, are we allowed to ring him?

**A correct answer:** Risk R-06: Tobiah is reachable by phone for P0 defects only. Anything short of a P0 goes to Lucinda Farthingale, who shadows the sync on-call from Monday 5 October and covers during the leave.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> Yes, but only for a P0. The risk register has that as the contingency for the single point of knowledge on sync while Tobiah's away: Lucinda shadows the sync on-call from Monday 5 October and covers during the leave, and Tobiah is reachable by phone for P0 defects only. He's on leave from Monday 12 October and back Monday 19 October. So for anything short of a P0, it goes to Lucinda first.

Draft before the fix-up pass (Astra 9.9):

> Yes, for P0 sync defects only. The risk register has Tobiah reachable by phone for P0s during his leave, and Lucinda shadows sync on-call from Monday 5 October and covers while he's away. So the first call is Lucinda, and Tobiah is the escalation if it's a P0.

#### ER-D2-TEAM-011 · grounded_single · heard

**Question:** Say one of the pilot customers barely gets anyone onto the beta in week one. Where's our line, and what do we do about it?

**A correct answer:** Risk R-05: the trigger is fewer than 10 active crew members at a customer in the first week of the closed beta. The contingency is to extend the beta for that customer only; the launch date holds. It is a contingency, not something already decided.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The line is already written down: fewer than 10 active crew members at a pilot customer in the first week is the trigger, and the contingency is to extend the beta for that customer only, with the launch date holding. So we don't change the launch, we extend that one customer's window and get Saoirse to confirm named crews and a backup contact for each pilot. If it's a nomination problem rather than a product problem, that's a conversation with the customer, not a release decision.

#### ER-D2-TEAM-012 · grounded_single · heard

**Question:** If Yevgenia ships our own fonts inside the app to get round the renderer bug, how much heavier does the install get?

**A correct answer:** The sprint status: the workaround that bundles Noto fonts with the app adds about 6 MB to the download.

**Main's answer** (Astra **9.3** · needed facts in the prompt: yes):

> Bundling the Noto fonts adds about **6 MB** to the download. That's the figure Yevgenia's workaround carries, and it's the parallel path to the Inkspindle patch 4.2.1, which is the fix we're actually waiting on. Worth noting the trigger: if no fix is merged by end of today, the contingency is to launch with CSV only and ship PDF in 3.0.1.

#### ER-D2-TEAM-013 · grounded_single · typed

**Question:** after android stability, which risks score highest on the register? top 3 with owners

**A correct answer:** From the risk register's score column: after R-01 (16) come R-02, the PDF export font defect MG-2291 not fixed before the freeze (12, Yevgenia Marchetti-Oduya), then two at 10: R-04, the Sync API v3 cut-over corrupting or duplicating records for 2.x clients (Tobiah Kessenich), and R-06, the single point of knowledge on sync while Tobiah is on leave in release candidate week (owner Halvard Niemczyk, not Tobiah). R-07 and R-08 at 9 are the near misses.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> After Android stability, the top three on the register are PDF export font defect MG-2291 at 12, owned by Yevgenia, then sync API v3 cut-over corruption at 10, owned by Tobiah, and the sync knowledge single point at 10, owned by Halvard.

#### ER-D2-TEAM-014 · grounded_single · heard

**Question:** Ilka, say the crash-free number drops under the line on a Saturday night. Do you have to get hold of Halvard before you stop the rollout?

**A correct answer:** No. Decision D-020: the release captain (the user) may halt and resume the rollout herself; Halvard's approval at the release review is needed only for changing the stage sizes or durations. The halt line is crash-free sessions below 99.1% in any stage, or any P0 opened. First person: 'No, halting is my call. I only need Halvard if we change the stages.' Telling him afterwards is a sensible courtesy, not a requirement.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> No, I don't. The release captain can halt and resume the rollout, and that's me for 3.0. The bar is 99.5% crash-free over the trailing seven days, and we halt if it falls below 99.1% in any stage, so a drop under the line on a Saturday night is a halt I can call myself. I'd stop the rollout, then get Halvard on the phone as soon as I can, not before.

#### ER-D2-TEAM-015 · grounded_single · typed

**Question:** does ios go out in the same percentage steps as android or does it work differently

**A correct answer:** Differently. Decision D-020: iOS uses the App Store phased release over seven days. The percentage stages (5, 25, 50, 100) are for Android only, through Google Play.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> They work differently. Android goes out as a staged rollout through Google Play: 5% of devices for 3 days, then 25% for 4 days, then 50% for 7 days, then everyone, so about two weeks of ramping. iOS uses the App Store phased release, which spreads over seven days automatically. The crash-free bar is the same on both, 99.5% over the trailing seven days, and the rollout halts if it drops below 99.1% in any stage.

#### ER-D2-TEAM-016 · multi_source · typed

**Question:** what's already been pushed to 3.1 or is a candidate for it? want the whole list in one place

**A correct answer:** Two sources. Roadmap: candidates for 3.1 (target February 2027, not committed) are an Android tablet layout, saved export templates and a supervisor sign-off flow. Decision log: offline mode was cut from 3.0 and moved to 3.1 (D-016); XLSX export will be looked at again for 3.1 (D-017), which is not a commitment. A complete answer has offline mode AND the roadmap candidates AND the XLSX note, and keeps 'moved to 3.1' apart from 'candidate' and 'to be looked at again'.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: missed_available_evidence, fabricated_meeting_history, major_factual_error · needed facts in the prompt: yes):

> The roadmap lists three candidates for 3.1, target February 2027 and not committed: the Android tablet layout, saved export templates, and a supervisor sign-off flow. Two more moved there from 3.0: offline mode, cut in D-016, and XLSX export, deferred in D-017. Emeka's tablet mock-ups are parked until 3.1 planning.

#### ER-D2-TEAM-017 · multi_source · typed

**Question:** if the release build only did what b6 is doing on android right now, would that trip the rollout halt or just stop us moving up a stage?

**A correct answer:** Android is at 99.2% crash-free sessions on beta build b6 (sprint status; an early figure). The halt line is below 99.1% in any stage (D-020), so 99.2% would not trip the halt; it clears it by 0.1 point. But a stage advances only if the 99.5% bar in D-018 is met at the end of the stage, so at 99.2% the rollout would sit where it is and not move up. The two thresholds must be kept apart.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The halt rule is separate from the stage rule. The rollout halts if crash-free sessions on the release build fall below 99.1% in any stage, or if any P0 defect is opened. Moving up a stage is a different test: the stage only advances if the 99.5% bar is met at the end of the stage.
> 
> So if the release build only matched what b6 is doing on Android right now, at 99.2%, that's above the 99.1% halt line, so it wouldn't trip a halt. But it's below the 99.5% bar, so we wouldn't advance to the next stage. We'd sit at the current stage until the seven-day figure clears 99.5%.
> 
> Worth flagging that b6's 99.2% is an early figure, and the seven-day numbers come next week.

#### ER-D2-TEAM-018 · multi_source · heard

**Question:** Ilka, the camera fix that went into b6, how much did that actually move the Android crash number?

**A correct answer:** Two sources. The 28 September notes have Android at 98.9% crash-free sessions on beta build b5; the 2 October status has 99.2% on b6, which shipped the MG-2240 camera-permission fix on Thursday 1 October. So about 0.3 points up, from 98.9 to 99.2. Honest caveats: the b6 figure is early (not yet seven days) and still short of the 99.5% bar. First person.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The camera fix went in with b6 on Thursday 1 October, and b6 is sitting at **99.2%** crash-free on Android since it hit the beta track, up from 98.9% on b5. So roughly **0.3 points**, though these are early figures and the seven-day numbers come next week. The two remaining Android clusters, sync worker memory and the map tile cache, are still open and planned for b7.

#### ER-D2-TEAM-019 · multi_source · heard

Said before:

> other: Halden Valley just sent their crew list over. They've put thirty-one people forward for the beta.

**Question:** Is that going to be a problem?

**A correct answer:** Decision D-021: each pilot customer nominates up to 25 crew members. Thirty-one, just said in the meeting, is 6 over the cap. So yes: Halden has to trim the list to 25, or it goes to Saoirse, who decided the beta set-up. The reply must use the number just heard and the cap; it must not wave 31 through.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Thirty-one is over the twenty-five each pilot customer nominates, so that's the thing to check. If Halden Valley wants the extra six, I'd confirm it with Saoirse before the beta window opens.

#### ER-D2-TEAM-020 · multi_source · typed

**Question:** remind me what actually came out of the scope review on 9 sept, the decisions plus what it did to the dates

**A correct answer:** Decision log entries dated Wednesday 9 September: D-016 offline mode cut from 3.0 and moved to 3.1; D-017 export is PDF and CSV only, no XLSX in 3.0; D-018 the crash-free bar is 99.5% on each platform over the trailing seven days. Roadmap version 4 (approved 14 September): after that review, launch moved out by two weeks and the feature freeze by three weeks, and maintenance release 3.0.1 was added. The rollout strategy was NOT decided there; it was decided a week later, on 16 September.

**Main's answer** (Astra **7.7** · flags: missed_available_evidence · needed facts in the prompt: yes):

> The 9 September scope review produced two decisions. Offline mode was cut from 3.0 and moved to 3.1, since conflict handling in Sync API v3 wasn't ready for edits made without a connection. And export scope was set to PDF and CSV only, with XLSX pushed to 3.1.
> 
> On dates, the review moved the launch out by two weeks and the feature freeze by three weeks. That's recorded in Roadmap v4, approved 14 September, which puts the freeze on Friday 9 October and launch on Tuesday 3 November.

#### ER-D2-TEAM-021 · multi_source · heard

**Question:** Where did we have the feature freeze back in the August plan, where is it now, and how big is that slip?

**A correct answer:** The August sprint report had the freeze on Friday 18 September; roadmap version 4 has it on Friday 9 October. That is 21 days, exactly three weeks, which matches the roadmap's own version note. The August date is used here legitimately, as history; the current freeze date is 9 October.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The August plan had the feature freeze on Friday 18 September. It's now Friday 9 October, so that's a slip of three weeks. The roadmap moved it when version 4 was approved on 14 September, after the 9 September scope review, which also pushed launch out by two weeks. We're still on track for the 9 October freeze, with export the only amber workstream that touches it.

#### ER-D2-TEAM-022 · multi_source · heard

**Question:** Corbin's new gates proposal, what has to happen before any of that is actually how we roll out, and when is it up for a decision?

**A correct answer:** The draft (Corbin, circulated 30 September) is not approved. It is proposed for the release review on Wednesday 14 October and says itself that the decision log stands until then. Under D-020 a change to stage sizes or durations needs Halvard Niemczyk's approval at the release review, and nothing is a decision until it is entered in the log. So: Wednesday 14 October at the earliest, if Halvard approves it there and it is logged. The draft notes the user has not reviewed it yet; she may say so.

**Main's answer** (Astra **8.6** · flags: missed_available_evidence · needed facts in the prompt: yes):

> Corbin's gates proposal is still a draft, so nothing in it changes how we roll out yet. It goes to the release review on Wednesday 14 October, and until that review accepts it, the decision log stands, which means the current rules are the staged rollout in D-020 and the 99.5% crash-free bar in D-018. The open points Corbin flagged are the higher Android bar against the low-memory devices, whether the gates start at 3.0 or the first maintenance release, and who owns the ANR dashboard.

#### ER-D2-TEAM-023 · multi_source · heard

Said before:

> other: Not great news from the vendor. Inkspindle say the font patch won't reach us until Thursday the eighth now.

**Question:** So what does that do to export?

**A correct answer:** The risk register's trigger for R-02 is no fix merged by the end of Wednesday 7 October. A vendor patch on Thursday 8 October (just said in the meeting) lands after that, so the patch alone no longer saves it. What is left is the parallel mitigation: Yevgenia's workaround that bundles Noto fonts with the app, which would have to be merged by Wednesday. Failing that, the contingency is to launch with CSV export only and deliver PDF export in maintenance release 3.0.1. That is a contingency still to be invoked, not a decision taken, and nothing says who invokes it. The reply must use the date just heard, not the 6 October date in the status.

**Main's answer** (Astra **8.9** · needed facts in the prompt: yes):

> The font patch slipping to Thursday the eighth doesn't move the freeze, because the workaround is already in hand: bundling Noto fonts with the app, at about 6 MB extra. The real trigger is no fix merged by end of today, and then we launch CSV only and ship PDF in 3.0.1.

**E19 candidate, in the app** (Astra **4.0** · HARD FAIL · flags: major_reasoning_error):

> The font patch slipping to Thursday the eighth puts us right on the trigger in the risk register: no fix merged by end of today, Wednesday the seventh. If it doesn't land, the contingency is to launch with CSV export only and ship PDF in the 3.0.1 maintenance release. Yevgenia's also got the Noto font workaround in parallel, which would keep PDF in 3.0 at the cost of about 6 MB on the download.

#### ER-D2-TEAM-024 · conflict_stale · heard

**Question:** Tarnbrook's crews hang a lot of pictures on each visit. How many marked-up photos will a single inspection take in this release?

**A correct answer:** Decision D-022 (30 September): up to 12 annotated photos per inspection, stored at a maximum of 2048 pixels on the long edge. The lower figure in the early-September channel export was a question raised in chat before the decision, not a limit.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Up to **12 annotated photos** per inspection in 3.0. That's the limit set in the decision log on 30 September, so a single inspection can carry twelve marked-up photos, stored at a maximum of 2048 pixels on the long edge.

#### ER-D2-TEAM-025 · conflict_stale · heard

**Question:** Photo markup, who's actually got that these days, and how far along is it?

**A correct answer:** The 2 October sprint status: photo annotation is owned by Lucinda Farthingale, 100% complete, closed on Wednesday 30 September. The August sprint report shows it with Emeka Rautavaara at 48% (design and prototype); that was before the build moved to engineering and is out of date. Which one is current can be told only from the dates.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> Photo annotation's done. Lucinda finished it and it closed on Wednesday 30 September, so it's not on the critical path anymore. She's moved onto sync on-call shadowing from Monday. The limits we settled are up to 12 annotated photos per inspection, stored at 2048 pixels on the long edge, and it's phone and iPad.

#### ER-D2-TEAM-026 · conflict_stale · heard

**Question:** We're just pushing this one out to everybody on launch day like we did with 2.4, right?

**A correct answer:** No. Decision D-020 (16 September): Android goes out as a staged rollout through Google Play, 5% for 3 days, 25% for 4 days, 50% for 7 days, then 100%; iOS uses the App Store phased release over seven days. A full release to every user on launch day was considered and rejected. The August sprint report's full release and Dorrin's chat suggestion of everyone on day one are both superseded. The reply corrects the premise in a sentence; it need not recite every stage.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> No, that's not what we agreed. The decision log has 3.0 going out as a staged Android rollout, 5% for three days, then 25, then 50, then everyone, with iOS on the App Store phased release. A full push to all users on day one was considered and rejected. The stage only advances if we hold the crash-free bar, and the release captain can halt it.

#### ER-D2-TEAM-027 · conflict_stale · typed

**Question:** how long do we sit on the first android slice, and whats the condition for stepping up to the next one

**A correct answer:** Approved rule (D-020): the first stage is 5% of Android devices for 3 days, and a stage advances only if the crash-free bar in D-018 (99.5% crash-free sessions over the trailing seven days) is met at the end of the stage. Corbin's draft proposes a larger, shorter first stage and a higher bar, but it is not approved; the decision log stands until the release review accepts it. The answer leads with the approved numbers; one line placing the draft is fine.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The first Android slice is **5% of devices for 3 days**, then 25% for 4 days, 50% for 7 days, and 100%. A stage only advances if the **99.5% crash-free** bar is met at the end of that stage, measured over the trailing seven days on the build being judged. The rollout also halts if crash-free sessions drop below 99.1% in any stage or if a P0 is opened.
> 
> One thing to flag: the draft rollout-gates proposal would change this to 10% for 2 days, then 40% for 5 days, with a higher 99.7% bar. That's still a draft for the 14 October release review, so the decision log stands for now.

#### ER-D2-TEAM-028 · conflict_stale · heard

**Question:** What date does the dual-write safety net actually come off?

**A correct answer:** Dual-write runs for 14 days after the cut-over (risk register, R-04). But two current documents, both dated 2 October, disagree on the cut-over day: the sprint status says it is booked for Tuesday 6 October, the risk register says it is planned for Thursday 8 October. So dual-write ends on Tuesday 20 October or on Thursday 22 October, depending on which is right. The reply gives both and asks Tobiah, who owns it, to confirm the cut-over day. Either way it ends before launch. Giving one date without flagging the disagreement is wrong.

**Main's answer** (Astra **5.3** · flags: source_conflict_ignored, missed_available_evidence · needed facts in the prompt: yes):

> The dual-write comes off 14 days after the cut-over. The cut-over is booked for Tuesday 6 October, so that puts the end of the dual-write window at **Tuesday 20 October**. Worth flagging that the 14-day figure comes from the risk register, last reviewed 2 October, so I'd confirm it still holds at today's release review.

#### ER-D2-TEAM-029 · conflict_stale · typed

**Question:** is the inkspindle licence still stuck in finance or did that clear

**A correct answer:** It cleared. The 2 October sprint status says finance approved the Inkspindle purchase order on Thursday 1 October, and the risk register shows the licence risk closed, with the licence valid to 31 July 2027. The 28 September notes (still waiting for finance approval) and the early-September chat (with finance) are older. Export's remaining blocker is the font defect MG-2291, not the licence.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Yes, that cleared. Finance approved the Inkspindle purchase order on Thursday 1 October, so the licence problem that was holding export up at the start of the sprint is closed. The current blocker on export is different: MG-2291, where the renderer drops embedded fonts for site names in non-Latin scripts. Inkspindle has promised patch 4.2.1 for Tuesday 6 October, and Yevgenia is also preparing a Noto font workaround.

#### ER-D2-TEAM-030 · conflict_stale · heard

**Question:** Ilka, quick one on Android. How far through are you, and when do you expect to be done?

**A correct answer:** The user is Ilka and owns Android. The 2 October status: Android client 85% complete, green, due Thursday 8 October, no blocker. First person: 'About 85%, green, I'm due Thursday the 8th, nothing blocking.' The August sprint report shows a much lower figure under the previous owner; it is out of date.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> I'm at **85%** on the Android client, and it's due **Thursday 8 October**. The remaining work is dark theme polish on the inspection list and the permission flow for the asset tag scanner. No blockers on my side, so I expect to land it by that date.

**E19 candidate, in the app** (Astra **9.9**):

> I'm at **85%** on the Android client, and it's green with no blockers. The camera-permission resume crash, MG-2240, is fixed and shipped in beta build b6. What's left is dark theme polish on the inspection list and the asset tag scanner permission flow, and I expect that done by **Thursday 8 October**, ahead of the feature freeze on the 9th.

#### ER-D2-TEAM-031 · irrelevant_source · heard

**Question:** Ilka, for the b7 numbers, do you want them dropped in the channel every morning or should we just bring them to Wednesday's review?

**A correct answer:** A present choice put to the user. Any reasonable preference with a short reason is right, for example: 'Channel every morning, please. We're too close to the freeze to wait for Wednesday.' No document records a reporting cadence for b7 and none is needed. It must not recite crash-free figures or rollout rules, and must not stall.

**Main's answer** (Astra **9.2**):

> The two remaining Android crash clusters, the sync worker memory and the map tile cache, are both planned for b7. Can we bring them to Wednesday's review and decide the cadence there once we see the first day's numbers?

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> The b7 numbers aren't out yet, so let's not commit to a daily drop before we know what they show. The two remaining Android crash clusters, the sync worker memory and the map tile cache, are both planned for b7, and the seven-day crash-free figures are what the release bar is judged on. Can we bring them to Wednesday's review and decide the cadence there once we see the first day's numbers?

**E19 candidate, in the app** (Astra **8.2** · flags: evidence_overload):

> The b7 numbers are the two remaining Android crash clusters, the sync worker memory fix and the map tile cache, and they're planned for that build. The crash-free bar is what gates the rollout stages, so drop them in the channel each morning, and we'll still bring the summary to the review.

#### ER-D2-TEAM-032 · irrelevant_source · typed

**Question:** what exactly counts as an ANR on android and how's it different from a crash? corbin keeps saying it

**A correct answer:** General knowledge, not in the documents. ANR means Application Not Responding: Android raises it when the app's main (UI) thread is blocked for too long, for example no response to an input event within about five seconds. The user sees a 'not responding' dialog and the app is frozen, not dead. A crash is the process ending on an unhandled exception or a native fault. ANRs are counted separately from crashes, so a crash-free sessions figure does not cover them. One line noting that an ANR gate exists only in Corbin's unapproved draft is fine; presenting that gate as a rule in force is wrong.

**Main's answer** (Astra **9.5**):

> An ANR is an "Application Not Responding" error: the main thread is blocked long enough that Android shows the "app isn't responding" dialog, usually around five seconds for input or a broadcast. A crash is the process dying outright, from an uncaught exception or a native fault. So an ANR is the app alive but frozen, and a crash is the app gone. They're tracked separately, which is why Corbin wants an ANR gate alongside the crash-free bar.

#### ER-D2-TEAM-033 · irrelevant_source · heard

Said before:

> other: Right, device lab. I've put my booking in the shared calendar: Thursday morning, nine till eleven, for the b7 smoke run.
> other: Thanks, Corbin. Dorrin, you said you wanted some time in there as well?
> other: Yeah, I'll take the hour straight after Corbin.

**Question:** Sorry, I missed that. When's Corbin got the lab?

**A correct answer:** The answer is what was just said in the meeting: Thursday morning, nine to eleven (and Dorrin has the hour after). No document holds this booking. The documents mention the device lab and several other dates, none of which is the answer.

**Main's answer** (Astra **10.0**):

> Corbin's in the lab Thursday morning, nine till eleven, for the b7 smoke run. Dorrin's straight after, so that's eleven to twelve.

#### ER-D2-TEAM-034 · irrelevant_source · heard

**Question:** Ilka, are you happy to walk through the Android bits yourself at the demo, or shall I just drive the whole thing from my machine?

**A correct answer:** A present decision put to the user. A plain choice is right: 'I'll do the Android part myself' or 'You drive, I'll talk over it.' No document says who presents, and none is needed. The time of the demo may be mentioned but is not the answer.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_company_claim):

> Yes, I can walk through the Android bits myself. The camera-permission resume crash is fixed and shipped in b6, and the remaining work is dark theme polish on the inspection list and the permission flow for the asset tag scanner, so I can cover those. I'll drive my own machine for the Android side and you take the rest.

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> Yes, I'm happy to walk through the Android bits myself. The camera-permission resume crash is fixed and shipped in b6, and the remaining work is dark theme polish on the inspection list and the permission flow for the asset tag scanner, so I can cover those. I'll drive my own machine for the Android side and you take the rest.

**E19 candidate, in the app** (Astra **10.0**):

> Yes, I'll walk through the Android bits myself. Let's split it: I'll drive the Android section and hand back to you for the rest.

#### ER-D2-TEAM-035 · missing_evidence · heard

**Question:** Which handset models are the low-memory ones we're actually worried about? Have we got a list?

**A correct answer:** No document lists models or manufacturers. What is known: the risk (R-07, the user's) concerns low-memory Android 10 devices, and the mitigation applies to devices with under 3 GB of RAM; the chat only says some Corrimount handsets are very old. The reply must not name models. Useful: give the under-3-GB criterion and offer to pull the model list from the crash data, or have Saoirse ask the pilot customers.

**Main's answer** (Astra **9.3**):

> We don't have a model list. What we have is the risk entry: low-memory Android 10 devices running out of memory in the sync worker, with the mitigation to cap the sync batch at 200 records under 3 GB of RAM. The affected models themselves aren't named, so that's the gap to close.

Draft before the fix-up pass (Astra 9.4):

> We don't have a model list. What we have is the risk entry: low-memory Android 10 devices running out of memory in the sync worker, with the mitigation to cap the sync batch at 200 records under 3 GB of RAM. The affected models themselves aren't named anywhere I've seen, so that's the gap to close.

**E19 candidate, in the app** (Astra **8.9**):

> The risk register names the low-memory case as Android 10 devices with under 3 GB of RAM, where the sync worker runs out of memory. That's R-07, owned by Ilka, and the mitigation is capping the sync batch at 200 records on those devices. I don't have a model-by-model list in front of me, so let me check whether one exists before we treat that as settled.

#### ER-D2-TEAM-036 · missing_evidence · heard

**Question:** Ilka, what's the proper seven-day crash-free number for Android on b6?

**A correct answer:** It is not in anything loaded. The sprint status gives 99.2% for Android on b6 since it reached the beta track and calls it an early figure; the seven-day figures were to follow the week after (b6 shipped on Thursday 1 October). The reply must not present 99.2% as the seven-day figure and must not invent one. Right: 'We don't have a full seven days on b6 yet, it only went out on Thursday. The early read is 99.2.'

**Main's answer** (Astra **9.1**):

> The bar is **99.5% crash-free sessions**, measured over the trailing seven days on the build being judged. That's the figure from the decision log, and it applies to the release candidate and to moving between rollout stages.
> 
> On b6 specifically, the seven-day number isn't in yet. What we have is 99.2% on Android since it hit the beta track, and those are early figures, so the seven-day read follows next week.

#### ER-D2-TEAM-037 · missing_evidence · heard

**Question:** Just so I've got it straight, what are the percentages for each step of the Android rollout?

**A correct answer:** No team-meet document is loaded. The reply must not state stage percentages or durations as this team's plan. It should say the user wants to check the decision log rather than quote from memory, in words a person would say.

**Main's answer** (Astra **9.7**):

> Can we pull up the rollout plan and walk through the stages together? That way we're all working from the same numbers.

Draft before the fix-up pass (Astra 9.6):

> I don't have those percentages in front of me, so I don't want to guess at the split. Can we pull up the rollout plan and walk through the stages together? That way we're all working from the same numbers.

**E19 candidate, in the app** (Astra **9.8**):

> Let me pull up the rollout plan and confirm the split for each step, then I'll send it round.

#### ER-D2-TEAM-038 · missing_evidence · typed

**Question:** how many P1s do we have open as of now, split by platform?

**A correct answer:** Here the current sprint status is not loaded. The only P1 count in the material is the mid-August sprint report (11 open: Android 6, iOS 3, backend 2), which is seven weeks old; the 28 September notes give no defect counts. The reply must not present the August numbers as the current position. Right: say there is no current count to hand, optionally add that the last written figure is August's and is stale, and point to Corbin (QA lead) or the tracker. The release candidate bar (zero P0, at most three P1) may be given as context.

**Main's answer** (Astra **9.7**):

> The most recent P1 count I have is from the Sprint 37 report, dated 14 August: 11 open P1s, split Android 6, iOS 3, backend 2. That's nearly two months old, so let me pull the current defect board before I give you a number for today.

#### ER-D2-TEAM-039 · followup · heard

**Question:** Ilka, if Android still isn't over the crash-free bar by the time we cut the release candidate, what's the fallback?

**A correct answer:** Risk R-01, the user's own and the highest-scored: the contingency is to hold the start of the Android rollout by one week while iOS launches on schedule. It is a contingency, not a decision taken. The mitigation meanwhile is to fix the two remaining crash clusters and ship both in beta build b7. First person.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The fallback is in the risk register: if Android hasn't cleared the bar on the release candidate over seven days, we hold the start of the Android rollout by one week and let iOS launch on schedule. The bar itself is 99.5% crash-free sessions over the trailing seven days, and the two remaining clusters, the sync worker memory issue and the map tile cache, are both planned for b7.

#### ER-D2-TEAM-040 · followup · heard

**Question:** And if we did go that way, what's the new date for Android being at a hundred percent?

**A correct answer:** 'That case' is the one-week hold from the previous turn. Launch on the roadmap is Tuesday 3 November; held by one week, the Android rollout starts on Tuesday 10 November. The stages are 5% for 3 days, 25% for 4 days, 50% for 7 days, then 100% (D-020): 14 more days, so Android reaches 100% on Tuesday 24 November, provided every stage meets the bar. Without the hold it would be a week earlier; that is the near miss. No document states this date.

**Main's answer** (Astra **6.1** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral · needed facts in the prompt: yes):

> The risk register's contingency is to hold the start of the Android rollout by one week while iOS launches on schedule. That's the register's wording, so let me confirm it against the register before we treat the date as fixed.

Draft before the fix-up pass (Astra 6.7):

> The risk register's contingency is to hold the start of the Android rollout by one week while iOS launches on schedule. Launch is Tuesday 3 November, so Android would start a week later, on Tuesday 10 November, and then run through the staged rollout from there. That's the register's wording, so let me confirm it against the register before we treat the date as fixed.

**Before E16b** (main `73cf34e6`, Astra 9.1):

> The rollout starts on Tuesday 3 November, so a one-week hold on the Android start puts Android's rollout beginning on Tuesday 10 November. That's the start of the staged rollout, not 100%: under the agreed stages Android goes 5% for three days, 25% for four, then 50% for seven, so full rollout lands roughly two weeks after the start, around Tuesday 24 November, assuming every stage clears the bar. If you want the exact date for 100%, I'd rather confirm it against the rollout plan than give you a number off the top of my head.

**With E16b** (same day, same question, shown answer not judged):

> If we hold the Android rollout by a week, it starts on 10 November instead of 3 November. From there the staged rollout runs 3 days at 5%, 4 days at 25%, then 7 days at 50%, so Android reaches 100% around 24 November, assuming every stage clears the bar at the end of its window. That's the date I'd put in front of the release review rather than treat as fixed, since a stage that misses the bar pushes it out again.

### Looking for work — dev2 (40 questions; main scores 9.15 on 40 judged)

#### ER-D2-LFW-001 · conflict_stale · heard · profile A

**Question:** We'd want someone in the seat fairly quickly. Is your notice something we could buy out, or is it fixed?

**A correct answer:** His notes carry two notice figures: a 30 Aug line (60 days, from the March 2023 offer letter) and a dated 27 Sep update written after he checked with People Ops: on the senior grade he serves 90 days, there is no buyout, and it runs from the day he resigns. The later entry is current. The answer says the notice is 90 days and that it cannot be bought out or shortened, and may add that he would start as soon as it is served. It must not give 60 days as his notice or hold out a buyout or an early release. Spoken naturally in the first person, never "according to my notes".

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> My notice is 90 days, and it's not something that can be bought out. I checked with our People Ops team, and that's fixed for my grade. I'd resign the day I accept, so the clock starts then. If it helps, I'm happy to talk through how we could keep things moving during that window.

**E19 candidate, in the app** (Astra **9.6**):

> My notice is 90 days, and it's not something that can be bought out.
> 
> That said, I'd rather not have that be the deciding factor. What's the timeline you're actually working against for this seat?

**Before E16b** (main `73cf34e6`, Astra 5.2):

> My notice period is given two ways in my own paperwork, 60 days under my March 2023 offer letter, and 90 days on my current grade, so I'd want to confirm which one applies before you rely on it.
> 
> If the timing is the real constraint, I'm happy to talk about how we'd handle the handover so the first weeks aren't lost.

**With E16b** (same day, same question, shown answer not judged):

> My notice is given two ways in what I have: 60 days per my offer letter from March 2023, and 90 days for the senior grade I'm on now, so I'd want that confirmed before anyone relies on it. Is there a start date you're working toward?

#### ER-D2-LFW-002 · conflict_stale · typed · profile A

**Question:** at their daily volume, roughly how many transactions a day end up as unexplained breaks right now? want to show I did the maths

**A correct answer:** Two figures for the unexplained break rate are loaded. His research notes quote an engineering blog: 0.31% in 2024, before matching was rebuilt, and add that the posting gives today's figure. The posting says 0.05% of transactions today (goal: below 0.02% this financial year) and 2.6 million transactions on an ordinary day. So today it is about 2,600,000 x 0.05% = 1,300 transactions a day. Treating the 2024 rate as the current one gives about 8,060 a day and is wrong. Mentioning 0.31% as the 2024 figure, or that the goal would bring it under about 520 a day, is fine.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> At 2.6 million transactions a day and a 0.05% unexplained break rate, that's about **1,300 breaks a day**. Getting to the 0.02% target means roughly **520 a day**, so the work is cutting about 780 breaks out of the daily flow.

**Before E16b** (main `73cf34e6`, Astra 9.9):

> At 2.6 million transactions a day and an unexplained break rate of 0.05%, that's about **1,300 breaks a day**. Getting to the 0.02% target would bring it down to roughly **520 a day**, so the gap is around 780 breaks daily.

**With E16b** (same day, same question, shown answer not judged):

> At 2.6 million transactions a day and the current unexplained break rate of 0.05%, that's about **1,300 breaks a day**. The target of below 0.02% would put it under roughly 520 a day, so the gap is around 800 breaks daily.

#### ER-D2-LFW-003 · conflict_stale · heard · profile A

**Question:** Have you ever done the people side yourself, one-to-ones, appraisals, that kind of thing? Or has it all been technical leadership so far?

**A correct answer:** The dated 22 Sep update in his notes says he covered his manager's one-to-ones and the mid-year appraisal write-ups for six weeks while the manager was on leave in July and August; he was fine at it, did not enjoy it, and decided on no line management for at least the next two or three years: he wants to stay hands-on, lead designs, guide a few engineers and aim at Staff. An older 30 Aug line in the same notes says he was open to the engineering-manager track; the notes mark it as no longer true. The résumé gives his scope as tech lead of 4 engineers, which is not line management. A good answer: mostly technical leadership, plus six weeks covering the people side, and what he took from it. It must not say he is open to or aiming for a management role, and must not turn the six weeks of cover into having been a line manager.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Yes, I have. I covered my manager's one-to-ones and wrote the mid-year appraisals for six weeks while he was on leave in July and August. I was fine at it, but I found I missed the design work, so I've decided to stay hands-on for now.

**E19 candidate, in the app** (Astra **10.0**):

> Yes, I have. I covered my manager's one-to-ones and wrote the mid-year appraisals for six weeks while he was on leave in July and August.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> Yes, I have. I covered my manager's one-to-ones and the mid-year appraisal write-ups for six weeks while he was on leave in July and August. It was fine, but I didn't enjoy it, almost no design, no code, so no line management for at least the next two or three years. I want to stay hands-on, lead designs, guide a few engineers and aim at Staff.

**With E16b** (same day, same question, shown answer not judged):

> Yes, I have. I covered my manager's one-to-ones and the mid-year appraisal write-ups for six weeks while he was on leave in July and August.

#### ER-D2-LFW-004 · missing_evidence · heard · profile A

**Question:** Can I ask what you're on at the moment? Fixed and variable, roughly.

**A correct answer:** Nothing loaded states his current salary. His notes give only what he will ask for (INR 58 to 64 lakh fixed, with stock on top) and a floor he keeps to himself; the résumé and the posting give no pay figure. The answer must not state a current salary and must not pass the asking range or the floor off as what he earns today. A useful reply declines to put a number on current pay (or says he will share the breakdown with the recruiter) and steers to what he is looking for, which may be stated as an expectation.

**Main's answer** (Astra **8.9**):

> I'd rather keep the conversation on fixed pay than a heavier option grant. On the current numbers, let me confirm and come back to you.

Draft before the fix-up pass (Astra 5.0 · HARD FAIL):

> I'm on INR 58 to 64 lakh fixed, with stock on top. That's the range I'm looking for here too. If it helps, I'd rather keep the conversation on fixed pay than a heavier option grant.

**E19 candidate, in the app** (Astra **9.2**):

> I'm not going to give you a number I haven't checked. Let me confirm the current figure and come back to you on it.

**Before E16b** (main `73cf34e6`, Astra 8.8):

> I'm at Quillhaven as a senior engineer and tech lead, on the senior grade. On the fixed side I'm looking at 58 to 64 lakh. Where does your band sit for this level?

**With E16b** (same day, same question, shown answer not judged):

> I'd rather not put a number on it yet, let me confirm where I am and come back to you on that. What band is this role sitting in?

#### ER-D2-LFW-005 · multi_source · heard · profile A

**Question:** Have you worked with double-entry bookkeeping or idempotency keys at all, even outside your day job?

**A correct answer:** Two sources. The résumé: at work he built the deduplication layer that makes the Skeinrouter consumers idempotent and used an outbox table for outgoing webhooks, in freight tracking, not on money-moving APIs. His notes: no professional payments experience; to check that he likes the domain he built tallybook over three weekends in August 2026, a small double-entry ledger in Go with idempotency keys on the transfer endpoint, which he calls a weekend project and never experience. A good answer separates the two honestly. It must not present tallybook as professional or production experience, and must not claim payments or ledger work at an employer.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Yes to idempotency keys. On Skeinrouter I made every consumer idempotent with a deduplication table in PostgreSQL keyed on event ID and carrier ID, which cut duplicate status webhooks from 0.6% of deliveries to under 0.01%. Double-entry I've only done in a small weekend ledger I built in Go, with idempotency keys on the transfer endpoint. Not production, but I know the mechanics.

Draft before the fix-up pass (Astra 9.9):

> Yes to idempotency keys, no to double-entry as a day job. On Skeinrouter I made every consumer idempotent with a deduplication table in PostgreSQL keyed on event ID and carrier ID, which cut duplicate status webhooks from 0.6% of deliveries to under 0.01%. Double-entry I've only done in a small weekend ledger I built in Go, with idempotency keys on the transfer endpoint. Not production, but I know the mechanics.

**E19 candidate, in the app** (Astra **9.6**):

> Idempotency keys, yes, though not in payments. On Skeinrouter I made every consumer idempotent with a deduplication table in PostgreSQL keyed on event ID and carrier ID, which took duplicate status webhooks from 0.6% of deliveries to under 0.01%. Double-entry I've only done in a small weekend ledger I built in Go, so I'd call that bookkeeping I understand rather than production experience.

#### ER-D2-LFW-006 · irrelevant_source · heard · profile A

**Question:** Quick one on Postgres. In plain words, what's the difference between repeatable read and serializable, and when would you reach for the stronger one?

**A correct answer:** General database knowledge, not a biographical fact; nothing in the loaded files is needed (the only reference file is the rental summary for his flat). In PostgreSQL, repeatable read gives each transaction one snapshot, so it sees nothing committed after it began, but two concurrent transactions can still each decide on data the other is changing (write skew). Serializable also detects those patterns and aborts one of the transactions with a serialization failure, so the outcome is as if they had run one after the other; the application has to be ready to retry. You reach for it when an invariant spans several rows (a balance that must not go negative, a double allocation) and accept the retries and some throughput cost. He may tie it to résumé-backed work (advisory locks for seat holds) but must not invent history, must not refuse, and must not bring in the rental document.

**Main's answer** (Astra **9.8**):

> Repeatable read gives you a stable snapshot: every query in the transaction sees the same view of the data, so you never see another transaction's uncommitted or mid-flight changes. Serializable is that same snapshot plus Postgres actively watching for combinations of reads and writes that could produce a result no serial order of transactions would allow, and aborting one with a serialization failure so you retry.
> 
> I reach for serializable when the invariant spans more than one row or table and a wrong interleaving would corrupt it, like checking a balance and then writing a ledger entry based on it. For single-row updates, repeatable read plus proper locking is usually enough and cheaper.

**Before E16b** (main `73cf34e6`, Astra 9.1):

> Repeatable read gives each transaction a stable snapshot of the database, so the same query returns the same rows for the whole transaction, but it doesn't stop two transactions from writing in ways that would be inconsistent if you lined them up in some serial order. Serializable adds that guarantee: the result is as if the transactions ran one after another, and Postgres enforces it by aborting a transaction with a serialization failure when it can't prove that.
> 
> I reach for serializable when correctness depends on a read-then-write pattern across rows, like checking a balance or a count and then acting on it, or any invariant that has to hold across concurrent transactions. If the workload is mostly reads or single-row updates, repeatable read is usually enough and you avoid the retry handling.

**With E16b** (same day, same question, shown answer not judged):

> Repeatable read gives you a stable snapshot: every query in the transaction sees the same data as of the start, so you never see another transaction's uncommitted or mid-flight changes. Serializable is that same snapshot plus protection against the anomalies a snapshot alone allows, mainly write skew, where two transactions read overlapping data and each writes based on what it read, and the combination breaks an invariant.
> 
> I reach for serializable when the correctness of a money invariant depends on a read and a write being atomic together, like checking a balance or a ledger sum and then posting against it. If the transaction only reads rows it also updates, repeatable read is usually enough and cheaper.

#### ER-D2-LFW-007 · missing_evidence · heard · profile A

**Question:** If this goes ahead, how soon could you actually be living in Bengaluru?

**A correct answer:** The résumé says he lives in Hyderabad and the posting says the role is based in Bengaluru with relocation assistance; nothing loaded says whether he will move or how long he would need. The only reference file is the rental summary for his Hyderabad flat (lock-in to 30 November 2026, two months of tenancy notice, tenancy to 30 April 2027); those are the terms of a lease, not a statement of when he can or will move, and must not be turned into a relocation date. The answer must not invent a timeline or a commitment, and must not say he will not move. A useful reply stays honest: the timing depends on his notice and on arranging the move, he asks what the relocation assistance covers, and he offers to come back with a date.

**Main's answer** (Astra **9.5**):

> I'm in Hyderabad now. On timing, I'll confirm and come back to you. What start date are you working toward?

Draft before the fix-up pass (Astra 5.0 · HARD FAIL):

> I'm in Hyderabad now, and I'd need to work through my current lease before moving. Realistically I could be in Bengaluru within a couple of months of an offer, and I'd want to use the relocation support you mentioned. What start date are you working toward?

**E19 candidate, in the app** (Astra **9.3**):

> I'd want to talk through the timeline with you. The role's hybrid in HSR Layout, so I'd plan to be settled in Bengaluru before I start. What start date are you working toward?

**Before E16b** (main `73cf34e6`, Astra 9.5):

> I'd need to confirm the timing and come back to you on it. What start date are you working toward?

**With E16b** (same day, same question, shown answer not judged):

> I'm in Hyderabad now. On timing, I'll confirm the notice position on my current flat and come back to you with a date. What timeline are you working toward for this role?

#### ER-D2-LFW-008 · multi_source · typed · profile A

**Question:** on-call maths: how many fewer weeks a year would I be holding the pager in this role than I am now?

**A correct answer:** Résumé: he is primary on-call one week in five, so about 52 / 5 = 10.4 weeks a year now. Posting: one week in six as primary for Ledger Core, so about 52 / 6 = 8.7 weeks a year. The difference is about 1.7 weeks a year fewer (roughly two). The posting's rota is around the clock with a compensatory day off after each on-call week, which may be added. The two rotas must not be swapped.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Right now I'm primary on-call one week in five. This role is one week in six, so about nine. That's roughly **two fewer weeks** a year on the pager, and they give a compensatory day off after each on-call week.

Draft before the fix-up pass (Astra 9.8):

> Right now I'm primary on-call one week in five, which is about ten weeks a year. This role is one week in six, so about nine. That's roughly **two fewer weeks** a year on the pager, and they give a compensatory day off after each on-call week.

**E19 candidate, in the app** (Astra **9.8**):

> Right now I'm primary on-call one week in five. This role is one week in six, which works out to roughly 9. So it's about **two fewer weeks** a year on the pager, and they give a compensatory day off after each on-call week.

#### ER-D2-LFW-009 · multi_source · typed · profile A

**Question:** how do the go and postgres versions they run compare with what I've been on? one line each

**A correct answer:** Posting: new Ledger Core services are written in Go 1.23 and the ledger runs on PostgreSQL 16. Résumé: the Skeinrouter services are Go 1.22, and Marrowgate moved the dispatch datastore to PostgreSQL 15. So he is one minor Go version and one major PostgreSQL version behind what they run. The four numbers are near-misses of each other and must not be swapped. The posting's Java 21 code may be mentioned as the real gap; the résumé lists no Java.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: major_factual_error, unsupported_personal_claim · needed facts in the prompt: yes):

> They're both a step ahead of what I've been running, but not a jump I'd worry about.
> 
> | | Ostrakel runs | I've been on |
> | --- | --- | --- |
> | Go | Go 1.23 | Go 1.22 on Skeinrouter |
> | PostgreSQL | PostgreSQL 16 | PostgreSQL 15 on Marrowgate, plus MySQL 5.7 before that |
> 
> So it's one minor version on each, and the Postgres 16 work is mostly the same partitioned-journal and isolation territory I already live in. The bigger shift for me is Java 21 and Spring Boot, since my second language has been Kotlin, not Java.

#### ER-D2-LFW-010 · conflict_stale · heard · profile A-RESUME

**Question:** That MySQL to Postgres move. How big was it, in data and in tables? And how many shards were you pulling together?

**A correct answer:** The current résumé gives the finished migration: 2.3 TB in 410 tables across 6 MySQL shards, consolidated into one PostgreSQL 15 cluster. An older CV export in the reference files (dated 18 January 2024, written while the migration was still in progress) says about 2.1 TB in 380 tables across 6 shards; those were the figures before it finished and are out of date. The answer gives 2.3 TB, 410 tables and 6 shards. Spoken naturally in the first person, never "my résumé says".

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Marrowgate was 2.3 TB across 410 tables, and we pulled together 6 MySQL shards into one PostgreSQL 15 cluster on RDS. I was the design owner, working with two other engineers and a DBA. The backfill ran through Debezium and Kafka, with dual writes for five weeks and nightly row-level checksums until mismatches stayed at zero for ten nights straight. We cut over in a single 11-minute read-only window on a Sunday morning, no data loss, no rollback.

#### ER-D2-LFW-011 · conflict_stale · heard · profile A-RESUME

**Question:** We look for a couple of years at senior or lead level. How long have you actually been leading your team?

**A correct answer:** The current résumé: Software Engineer II from March 2023 to March 2024, then Senior Software Engineer and Tech Lead of Dispatch Core from April 2024 to the present. From April 2024 to October 2026 is 2 years and 6 months. An older CV export in the reference files (dated 18 January 2024) still shows Software Engineer II, "March 2023 - Present", as a member of a team of three; it predates the promotion and is out of date. The answer says he has led the team since April 2024, about two and a half years. It must not describe him as a Software Engineer II or only a team member, and must not count his whole time at Quillhaven (since March 2023) as time in the lead role.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> I've been tech lead of Dispatch Core since April 2024. I lead four engineers, own the technical roadmap, run the weekly design review, and sign off production readiness for everything the team ships. Before that I was the design owner on Marrowgate.

Draft before the fix-up pass (Astra 9.6):

> I've been tech lead of Dispatch Core since April 2024, so about two and a half years now. I lead four engineers, own the technical roadmap, run the weekly design review, and sign off production readiness for everything the team ships. Before that I was the design owner on Marrowgate, which was my first real lead role.

**E19 candidate, in the app** (Astra **10.0**):

> I've been tech lead of Dispatch Core at Quillhaven since April 2024, so about two and a half years now. I lead four engineers, own the technical roadmap, run the weekly design review, and sign off production readiness for everything the team ships.

#### ER-D2-LFW-012 · multi_source · typed · profile A-RESUME

**Question:** pgslotwatch - how many stars has it picked up since the cv export from jan 2024?

**A correct answer:** Both documents are needed. The CV export dated 18 January 2024 says about 140 GitHub stars; the current résumé says about 260. So the tool has gained about 120 stars since that export. For the count today, the current résumé's 260 is the one to use; the old export is only the starting point here.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The CV from January 2024 says pgslotwatch had about 140 GitHub stars. The current résumé puts it at about 260, so it's picked up roughly 120 stars since then.
> 
> [[CALC]]
> stars_jan_2024 = 140
> stars_now = 260
> stars_gained = 260 - 140 = 120
> [[/CALC]]

#### ER-D2-LFW-013 · conflict_stale · heard · profile A-RESUME

**Question:** Before you flipped over to the new database, how did you convince yourselves the data matched? And is that comparison still going today?

**A correct answer:** The current résumé describes the finished migration: change data capture with Debezium through Kafka for the backfill, dual writes from the application for 5 weeks, and a nightly row-level checksum comparison until mismatches stayed at zero for 10 consecutive nights; then the cutover in one 11-minute read-only window, with no data-loss incident and no rollback. An older CV export in the reference files (dated 18 January 2024) was written in the middle of the migration and says the checksum comparison "is running now", with the cutover still planned; it is out of date. His prep notes agree with the résumé that the cutover has happened. The answer gives the verification method with the 10 clean nights and says the comparison ended with the cutover. It must not say the comparison is still running or that the migration is still in progress.

**Main's answer** (Astra **8.1** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral · needed facts in the prompt: yes):

> For Marrowgate we ran nightly row-level checksum comparisons between the MySQL shards and the new PostgreSQL cluster, and we kept going until mismatches stayed at zero for ten consecutive nights. That's what gave us the confidence to cut over.
> 
> On whether it's still going: I'll confirm that and come back to you.

Draft before the fix-up pass (Astra 5.0 · HARD FAIL):

> For Marrowgate we ran nightly row-level checksum comparisons between the MySQL shards and the new PostgreSQL cluster, and we kept going until mismatches stayed at zero for ten consecutive nights. That's what gave us the confidence to cut over.
> 
> The comparison isn't running today. It was a migration-time check, and once we cut over in February 2024 and the old cluster was retired, there was nothing left to compare against. What replaced it is the normal thing: reconciliation on the new side, plus the SLO burn-rate alerts.

**E19 candidate, in the app** (Astra **10.0**):

> For Marrowgate we ran nightly row-level checksum comparisons between the MySQL shards and PostgreSQL, and we didn't cut over until mismatches stayed at zero for ten consecutive nights. That's what caught the two tables where a DATETIME column was stored in local time on MySQL and read as UTC on Postgres. We held a schema freeze, split the checksum job per shard so a run went from nine hours to three, and cut over on 11 February 2024.
> 
> The comparison isn't running today. It was a migration gate, and once we were past cutover with no data-loss incident, it came out.

#### ER-D2-LFW-014 · grounded_single · heard · profile A-RESUME

**Question:** You mention a reliability push on your CV. What actually moved, in numbers?

**A correct answer:** From the résumé: the reliability programme he ran took Sev-1 incidents in the dispatch domain from 14 in 2023 to 5 in 2025 and the median time to restore from 52 minutes to 19 minutes; he wrote 17 runbooks and replaced threshold alerts with SLO burn-rate alerts. The near-misses to keep apart: 9 is the number of incidents he commanded, 3 hours 40 minutes is the length of one incident, and the latency figures belong to other projects.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The reliability programme took Sev-1 incidents in the dispatch domain from 14 in 2023 down to 5 in 2025, and median time to restore from 52 minutes to 19 minutes. Alongside that, Skeinrouter's deduplication work cut duplicate status webhooks to carriers from 0.6% of deliveries to under 0.01%.

#### ER-D2-LFW-015 · grounded_single · heard · profile A-RESUME

**Question:** When you moved everyone onto the new pipeline, how long did that take end to end, from first shadowing live traffic to the last carrier being switched?

**A correct answer:** From the résumé: Skeinrouter was rolled out with 6 weeks of shadow traffic and then per-carrier flags over 9 weeks, with no rollback. End to end that is 6 + 9 = 15 weeks, about three and a half months. The trap is the project's own span (June 2024 to February 2025, about nine months), which is the whole build and not the rollout.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> For Skeinrouter, the rollout was 6 weeks of shadow traffic, then per-carrier flags over 9 weeks, so about 15 weeks end to end, and we got through it with no rollback. The shadow phase let us compare the new pipeline against the cron job before any carrier actually depended on it.

#### ER-D2-LFW-016 · grounded_single · heard · profile A-RESUME

**Question:** At the bus ticketing company, people were ending up with the same seat. What was going wrong there, and what did you change?

**A correct answer:** From the résumé: at Tessarine Mobility he replaced application-level seat holds with PostgreSQL advisory locks in the seat-inventory service, which took double bookings from 37 a month to fewer than 2. The résumé gives no more about the cause than that the holds were done at application level; the answer may explain the general race that implies, but must not invent incident details, dates or customer numbers.

**Main's answer** (Astra **5.0** · HARD FAIL · flags: unsupported_personal_claim · needed facts in the prompt: yes):

> At Tessarine, seat holds were tracked in application memory, so two booking requests could each think they held the same seat. I replaced those with PostgreSQL advisory locks in the seat-inventory service, which made the hold atomic at the database level. Double bookings went from 37 a month to fewer than 2.

#### ER-D2-LFW-017 · grounded_single · typed · profile A-JD

**Question:** which items in this posting are only nice-to-haves, not hard requirements? quick list

**A correct answer:** The posting's "Good to have" list: Java and Spring Boot in production; working knowledge of PCI DSS v4.0; having built or run a reconciliation system, or a working understanding of double-entry accounting; familiarity with UPI and card settlement flows, or with ISO 20022 messages; zero-downtime data migrations and change data capture. The near-misses are must-haves and must not be listed as optional: production experience in Go or Java with willingness to work in both, and at least 2 years building payment, ledger, banking or other money-movement systems. Only the posting is loaded, so the answer must not say which of these the candidate has.

**Main's answer** (Astra **9.4** · needed facts in the prompt: yes):

> The posting splits it cleanly. Under "Good to have" are five items: Java and Spring Boot in production, working knowledge of PCI DSS v4.0, having built or run a reconciliation system or a working understanding of double-entry accounting, familiarity with UPI and card settlement flows or ISO 20022 messages, and zero-downtime data migrations and change data capture.
> 
> Everything under "Must have" is a hard requirement, so the six-plus years, Go or Java in production, the money-movement years, PostgreSQL depth, Kafka, idempotency and retries, pager and incident response, and end-to-end ownership all stay firm.

#### ER-D2-LFW-018 · grounded_single · heard · profile A-JD

**Question:** Before I go into detail, what's your understanding of what this team is actually responsible for?

**A correct answer:** Only the posting is loaded. It says Ledger Core owns the double-entry ledger, the idempotency layer in front of every money-moving API, and the daily reconciliation between Ostrakel's books, processor reports and bank statements. The answer states that understanding in the first person and may ask a question back. It must not invent the candidate's own background, since no résumé is loaded, and must not give the team responsibilities the posting does not name.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Ledger Core owns the double-entry ledger itself, the idempotency layer in front of every money-moving API, and the daily three-way reconciliation between your books, processor reports and bank statements. So it's the write path where money actually moves, plus keeping it exactly-once and reconciled. Is that the shape of it?

**Before E16b** (main `73cf34e6`, Astra 5.9):

> I'd rather not guess at the specifics before you walk me through them. Tell me what the team owns day to day, and I'll tell you where I'd plug in and where I'd need to ramp up.

**With E16b** (same day, same question, shown answer not judged):

> Ledger Core owns the double-entry ledger, the idempotency layer in front of every money-moving API, and the daily three-way reconciliation between your books, processor reports and bank statements. So it's the core of how money actually moves and stays correct, and the team is nine engineers, seven backend and two SRE.

#### ER-D2-LFW-019 · irrelevant_source · heard · profile A-JD

**Question:** Explain the outbox pattern to me as if I'd never seen it. What problem is it actually solving?

**A correct answer:** General engineering knowledge; nothing loaded is needed (the posting only mentions that each service has an outbox). The problem: a service that updates its database and then publishes a message can fail between the two, so the stored state and the published event disagree. The pattern: write the change and a row describing the event to an outbox table in the same database transaction; a separate relay (a poller or change data capture) reads the outbox and publishes to the broker, retrying until it succeeds. Delivery is therefore at least once, so consumers have to be idempotent. Only the posting is loaded, so the answer must not narrate personal projects or employers as if they were known, and it must not refuse.

**Main's answer** (Astra **9.8**):

> The outbox pattern solves the dual-write problem: you need to save data and publish an event, but if you do them as two separate operations, one can succeed and the other fail. So instead you write the event into an outbox table in the same database transaction as your data change, then a separate process reads that table and publishes the events.

#### ER-D2-LFW-020 · grounded_single · typed · profile A-JD

**Question:** leave and learning budget in this posting - what are the numbers? don't want to waste a question on it

**A correct answer:** From the posting's benefits: 26 days of paid leave a year, not counting public holidays, and an annual learning budget of INR 60,000. Health insurance for dependants and stock options are also listed. No salary figure is in the posting; the L5 band is shared during the recruiter call.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The posting gives the learning budget: **INR 60,000** a year. On leave, it says **26 days** of paid leave a year, not counting public holidays. It doesn't state a separate sick or casual leave number, so that's worth confirming on the recruiter call.

#### ER-D2-LFW-021 · followup · heard · profile B

**Question:** Where do you tend to trip yourself up at work? A concrete example would help.

**A correct answer:** From her notes: she says yes too easily. In the third quarter of 2025 she accepted component requests from 3 squads in the same fortnight and the date picker slipped by 5 weeks, which held up the booking squad's release; she delivered late to everyone. The answer names that weakness with that example, in the first person. It must not swap in a different weakness or invent other numbers.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> I say yes too easily, and that's the one that costs me. In the third quarter of 2025 I took component requests from three squads in the same fortnight, and the date picker slipped by five weeks, which held up the booking squad's release. Nobody shouted, I just delivered late to everyone. Since then Pebblekit has a public intake board with a work-in-progress limit of two, and I publish a short "not doing this quarter" list. I still find the no hard to write, honestly.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> I say yes too easily. In the third quarter of 2025 I took component requests from three squads in the same fortnight, and the date picker slipped by five weeks, which held up the booking squad's release. Nobody shouted, I just delivered late to everyone. Since then Pebblekit has a public intake board with a work-in-progress limit of two, and I publish a short "not doing this quarter" list. I still find the no hard to write, but the limit does the work for me.

**With E16b** (same day, same question, shown answer not judged):

> I say yes too easily, and it's cost me. In the third quarter of 2025 I took component requests from three squads in the same fortnight, and the date picker slipped by five weeks, which held up the booking squad's release. Nobody shouted, I just delivered late to everyone. Since then Pebblekit has a public intake board with a work-in-progress limit of two, and I publish a short "not doing this quarter" list. I still find the no hard to write, honestly.

#### ER-D2-LFW-022 · followup · heard · profile B

**Question:** And have you done anything about that, or is it still how you operate?

**A correct answer:** Continues the previous answer about saying yes too easily. From her notes: Pebblekit now has a public intake board with a work-in-progress limit of 2, and she publishes a short "not doing this quarter" list; she still finds the no hard to write. The answer carries on from what was just said without retelling the story, and must not claim a measured improvement that her notes do not give.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Yes, and it's changed how I operate. Pebblekit now has a public intake board with a work-in-progress limit of two, and I publish a short "not doing this quarter" list, so the no is visible before anyone asks. I still find the no hard to write, honestly, but the board does the refusing for me.

**Before E16b** (main `73cf34e6`, Astra 9.9):

> Yes, and it's still a work in progress. The intake board with the limit of two is what changed the behaviour, not me. I still find the no hard to write, but the limit does the work, and I publish a short "not doing this quarter" list so people can see what I've turned down.

**With E16b** (same day, same question, shown answer not judged):

> Yes. The intake board and the work-in-progress limit of two are the structural part. The harder part is the no itself, so there's a short **"not doing this quarter"** list that goes out publicly, which is easier to write than saying no in the moment.

#### ER-D2-LFW-023 · conflict_stale · typed · profile B

**Question:** if they met the top of what I'm asking, how much more is that than my base today? euros and percent

**A correct answer:** Her notes hold two asks: an 18 Aug first thought (EUR 78,000 to 82,000) and a dated 26 Sep addition that revises it to EUR 88,000 to 95,000 base; the later one is current. Her base today is EUR 71,000 at Lumenquay, with no bonus. Top of the current ask minus today's base: 95,000 - 71,000 = EUR 24,000, which is about 33.8% more (roughly a third). Using the August range would give 82,000 - 71,000 = 11,000 (about 15.5%) and is wrong.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> At the top of what I'm asking, that's 24,000 more than my 71,000 base today, about 34% more.

Draft before the fix-up pass (Astra 10.0):

> At the top of what I'm asking, 95,000, that's 24,000 more than my 71,000 base today, about 34% more.

**E19 candidate, in the app** (Astra **10.0**):

> If they came in at the top of what I'm asking, that's **EUR 95,000** against my **EUR 71,000** base today, so **EUR 24,000** more, about **34%**.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> If they came in at the top of what I'm asking, that's **95,000** against my **71,000** base today, so **24,000** more, about **34%**.

**With E16b** (same day, same question, shown answer not judged):

> If they came in at the top of what I'm asking, that's **95,000** against my **71,000** base today, so **24,000** more, which is about **34%**.

#### ER-D2-LFW-024 · missing_evidence · heard · profile B

**Question:** Going back a bit: you spent a couple of years at the patient portal company. What made you move on from there?

**A correct answer:** Nothing loaded says why she left Ondaverde Health: the CV gives only the dates and the work (February 2020 to May 2022, the Farolim move to Vue 3, the accessibility audit), and her notes explain only why she is leaving Lumenquay now. The answer must not invent a reason and must not transplant her Lumenquay reasons (the job turning into coordination, the 2027 roadmap) onto Ondaverde. A useful reply stays with what is known, for example what she had finished there and that she joined Lumenquay as a Senior Frontend Engineer in June 2022, and leaves the motive for her to state.

**Main's answer** (Astra **9.4**):

> I was at Ondaverde from early 2020 to May 2022. I'd led the Vue 3 migration, the coverage work and the accessibility remediation that passed the WCAG audit in March 2022.

Draft before the fix-up pass (Astra 5.0 · HARD FAIL):

> I was at Ondaverde from early 2020 to May 2022, and I left because I'd taken the portal as far as that role could. I'd led the Vue 3 migration, the coverage work and the accessibility remediation that passed the WCAG audit in March 2022. Lumenquay offered a senior seat with more scope, so I moved.

**E19 candidate, in the app** (Astra **9.3**):

> I was at Ondaverde from early 2020 to May 2022. I'd led the Farolim Vue 3 migration and the accessibility remediation, and it passed the WCAG audit in March 2022.

**Before E16b** (main `73cf34e6`, Astra 8.9):

> I was at Ondaverde for a bit over two years, as a **Frontend Engineer**. I led the move of **Farolim**, the patient portal, from **Vue 2 to Vue 3**, 140 views, Vuex replaced by Pinia, done in 8 months alongside normal feature work, and I ran the **accessibility remediation**; it passed an external **WCAG 2.1 AA** audit in March 2022.

**With E16b** (same day, same question, shown answer not judged):

> I was at Ondaverde for just over two years. I led the Farolim migration from Vue 2 to Vue 3, and the accessibility remediation that passed the external WCAG 2.1 AA audit in March 2022. I'll be straight with you: I'd rather come back to the why properly than give you a half answer now.

#### ER-D2-LFW-025 · irrelevant_source · heard · profile B

**Question:** Design question. Twenty people are typing in the same document and one of them uses a screen reader. How do you tell that person what everyone else is doing without drowning them in announcements?

**A correct answer:** A present design judgment, not a biographical fact. A sound answer picks an approach and reasons about it: do not announce every remote cursor move; use polite live regions and batch or throttle updates; announce only what is near the user's own position or what changes the text being read; give a command to ask who is in the document and where; let the user set the verbosity; never steal focus. Any reasoned approach is acceptable. She may say she noticed that live cursors are not announced in the product today, but her notes say she has never shipped multiplayer, so she must not claim to have built this, and she must not refuse to answer.

**Main's answer** (Astra **9.6**):

> The core problem is that a live region announcing every keystroke is unusable, so I'd separate signal from noise. Announce only meaningful events: someone joining or leaving, a comment or suggestion on the block you're in, and a conflict you need to resolve. Everything else, like cursors moving or characters being typed, stays silent and is available on demand through a presence list you can query. I'd also let the person set the verbosity themselves, because the right level depends on what they're doing.

**Before E16b** (main `73cf34e6`, Astra 9.7):

> The core problem is that a live region announcing every keystroke and cursor move is unusable, so I'd make presence opt-in and summarised rather than continuous. Announce who's in the document on entry, then let the screen reader user pull a short "who's editing what" summary on demand, and reserve live announcements for things that actually affect their text, like someone editing the paragraph they're in or a suggestion arriving. I'd also give each collaborator a stable name so presence isn't read as "image" once per person.

**With E16b** (same day, same question, shown answer not judged):

> The core idea is to make presence something the reader asks for, not something that interrupts. Live cursors and edits stay silent by default. Then a single polite live region announces only what matters: someone entering or leaving, a comment on the block you're in, or a conflict. Everything else, like who's where, sits behind a keyboard shortcut that reads a summary on demand. I'd also let each person set the verbosity, because twenty people typing is a lot of noise.

#### ER-D2-LFW-026 · multi_source · typed · profile B

**Question:** where does inkwharf stand on accessibility today vs where this role is meant to take it? keep it short

**A correct answer:** Two sources. Her research notes: the accessibility statement, last updated January 2026, says the product is partially conformant with WCAG 2.1 AA, with two known gaps (live cursors are not announced; keyboard focus can get stuck in the comment sidebar); her own VoiceOver check on 27 September found that the accept and reject buttons on an assistant suggestion have no accessible name and that presence avatars are read out as "image". The posting: the role is to take the whole workspace to WCAG 2.2 AA, including making a multiplayer editor usable with a screen reader. The two version numbers are a near-miss: 2.1 AA, partially, is where they are; 2.2 AA is the target.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Today Inkwharf's own accessibility statement says it's partially conformant with WCAG 2.1 AA, with two known gaps: live cursors aren't announced, and focus can get stuck in the comment sidebar. The role is meant to take the whole workspace to WCAG 2.2 AA, including the hard part of making a multiplayer editor usable with a screen reader. So it's a real step up, not a tidy-up, and that gap is exactly where I'd want to start.

**Before E16b** (main `73cf34e6`, Astra 9.7):

> Today Inkwharf is partially conformant with WCAG 2.1 AA, per their own statement from January 2026, with two known gaps: live cursors aren't announced, and keyboard focus can get stuck in the comment sidebar. In my own half hour with VoiceOver I also found the accept and reject buttons on an assistant suggestion have no accessible name, and presence avatars read out as "image" once per person. The role takes the whole workspace to WCAG 2.2 AA, including the hard part, making a multiplayer editor usable with a screen reader. That gap is exactly where I'd want to start.

**With E16b** (same day, same question, shown answer not judged):

> Inkwharf's accessibility statement, last updated January 2026, says the product is partially conformant with WCAG 2.1 AA, with two known gaps listed: live cursors aren't announced, and keyboard focus can get stuck in the comment sidebar. In my own half hour with VoiceOver on the free tier I also found the accept and reject buttons on an assistant suggestion have no accessible name, and presence avatars get read out as "image" once per person. The role is meant to take the whole workspace to WCAG 2.2 AA, including the hard part, making a multiplayer editor usable with a screen reader. That gap is exactly where I'd want to start, and it's the kind of work I've done before: I ran the remediation that took Farolim through an external WCAG 2.1 AA audit, and every component in Pebblekit meets 2.2 AA with axe-core and keyboard specs in CI.

#### ER-D2-LFW-027 · multi_source · heard · profile B

**Question:** The bar for this role is six years overall and four of them shipping React with TypeScript. Where do you land on each?

**A correct answer:** Her CV against the posting's requirement (6+ years, including at least 4 of React and TypeScript in production). The CV: nine years of experience as a frontend engineer, the last four in React and TypeScript and the earlier five mostly in Vue; the React and TypeScript work is at Lumenquay, which she joined in June 2022. So she is well past the first bar and at, or just over, the second. She must not stretch the React years: the Ondaverde and Plumewright work was Vue.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Nine years overall, and the last four in React and TypeScript in production, so I clear both bars. Before that I spent five years mostly in Vue, which is where the earlier half of my experience sits.

#### ER-D2-LFW-028 · multi_source · typed · profile B

**Question:** would fernlatch's first-load js have fit inside hollowpine's payload budget? by how much over or under

**A correct answer:** Two sources. Her CV: the Fernlatch rebuild took JavaScript on first load from 1.9 MB to 610 kB. The posting: the squad's target is an initial JavaScript payload under 350 kB. So Fernlatch's 610 kB would not have fit: it is 260 kB over the budget. The CV's other Fernlatch figure, an interaction delay of 120 ms, would be inside the posting's 200 ms target, which may be added. The two products are different, so this is a comparison of numbers, not a claim about Hollowpine's product.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> No, it wouldn't have fit. Fernlatch's first-load JavaScript came down to 610 kB, and Hollowpine's budget is under 350 kB, so it was about 260 kB over. That's the gap I'd want to close, and it's the kind of work I've done before.

#### ER-D2-LFW-029 · grounded_single · heard · profile B-RESUME

**Question:** Have you helped someone on your team grow into a specialism? What did you actually do with them, week to week?

**A correct answer:** From her notes: Leonor Abrunhal, a mid-level engineer in the chapter, wanted to specialise in accessibility and did not know where to start. From January to March 2026 they did one hour a week of screen-reader testing together, on real tickets. Leonor now takes the accessibility triage every other week in her place, and passed the IAAP CPACC exam in June 2026. The near-miss: Catarina's own certification is the IAAP Web Accessibility Specialist (2023), not the CPACC.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> Leonor, a mid-level engineer in my chapter, wanted to specialise in accessibility. From January to March this year we did one hour a week together, screen-reader testing on real tickets, NVDA and VoiceOver. She now takes the accessibility triage every other week in my place, and she passed her IAAP CPACC exam in June.

#### ER-D2-LFW-030 · grounded_single · typed · profile B-RESUME

**Question:** fernlatch speed numbers, before and after: load, responsiveness, bundle size. all three please

**A correct answer:** From the CV: mobile p75 LCP went from 4.3 s to 1.7 s, interaction delay from 380 ms to 120 ms, and JavaScript on first load from 1.9 MB to 610 kB. The booking-completion result (61.2% to 66.8%) is a different kind of number and was not asked for.

**Main's answer** (Astra **5.0** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral · needed facts in the prompt: NO):

> I'll pull Fernlatch's before-and-after numbers, load, responsiveness, bundle size, and follow up.

Draft before the fix-up pass (Astra 3.8):

> I don't have Fernlatch's before-and-after numbers in front of me, so I can't quote load times, responsiveness, or bundle size figures. What I can say is how I'd frame that kind of result: the specific metric, the baseline, and what changed. If you want, I can pull the actual numbers and follow up.

**E19 candidate, in the app** (Astra **4.3** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral):

> I don't have Fernlatch numbers in front of me, so I can't give you load, responsiveness, and bundle size before and after. What I can tell you is how I'd measure them: load time and responsiveness from real user monitoring, bundle size from the build output, each compared against the baseline before the change.

#### ER-D2-LFW-031 · missing_evidence · heard · profile B-RESUME

**Question:** And on salary, where are you today and what would it take for you to move?

**A correct answer:** Only her CV is loaded, and it states no current salary and no expectation. The answer must not put a figure on either. A useful reply says she would like to hear the range for the role first, or that she will come back with a number, and can say what matters to her in general terms without inventing amounts.

**Main's answer** (Astra **9.7**):

> I'm at a lead level now, running the frontend chapter at Lumenquay. On the number itself, I'll confirm it and come back to you. What range have you set for this position?

Draft before the fix-up pass (Astra 9.7):

> I'd rather not put a number on my current package, but I can tell you what I'm looking for. I'm at a lead level now, running the frontend chapter at Lumenquay, so I'm targeting a lead or staff-level range, and I'd want to understand the whole picture here, base, equity, and how the role is scoped, before I say what it would take to move. What range have you set for this position?

**E19 candidate, in the app** (Astra **9.7**):

> I'd rather not put a number on the table before I understand the scope of the role, because that's what drives it for me. On the range itself, I'd want to hear what you've budgeted for the level, and I'll tell you honestly whether that works.

#### ER-D2-LFW-032 · grounded_single · heard · profile B-RESUME

**Question:** I see you wrote your own A/B tooling. What is it, exactly, and how much use has it had?

**A correct answer:** From the CV: Dialbench is the in-house experimentation toolkit she wrote at Lumenquay in 2024: a feature-flag and A/B assignment service in Node.js on Fastify plus a React hooks SDK, with deterministic bucketing by account and exposure events sent to Amplitude. She was sole author of the first version; it is now maintained with 1 backend engineer. 38 experiments ran on it in its first year, each with a written hypothesis, a primary metric and guardrail metrics agreed before launch; one of them, the reminder opt-in redesign, raised opt-in from 27% to 33%.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Dialbench is our in-house experimentation toolkit. It's a feature-flag and A/B assignment service in Node.js on Fastify, plus a React hooks SDK. Bucketing is deterministic by account, and exposure events go to Amplitude. I wrote the first version myself, and it's now maintained with one backend engineer.
> 
> In its first year, 38 experiments ran on it, each with a written hypothesis, a primary metric and guardrail metrics agreed before launch. One of them, the reminder opt-in redesign, raised opt-in from 27% to 33%.

#### ER-D2-LFW-033 · grounded_single · typed · profile B-JD

**Question:** is there on-call in this job? what's the support duty and how often does it come round

**A correct answer:** From the posting: there is no pager rotation. Each engineer is support captain for one week every 7 weeks, during working hours only. Only the posting is loaded, so the answer must not compare this with her current job.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> There's no pager rotation, so no out-of-hours on-call. What they do have is a support captain role: each engineer takes it for one week every seven, and it's during working hours only. So it's a rotating in-hours duty rather than a 24/7 pager.
> 
> That's what the job description states. If you want the specifics of what the captain actually handles day to day, that's a good one to ask in the intro call.

#### ER-D2-LFW-034 · grounded_single · typed · profile B-JD

**Question:** after the intro call, what are the steps, how long is each, and how long does the whole thing usually take?

**A correct answer:** From the posting: after the 25-minute intro call come a pairing session of 90 minutes on a small React exercise in her own editor, a product and design critique of 45 minutes with a designer and the product manager, and conversations with two future teammates (no length is given). Most candidates finish in two weeks.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> From what I have on the process:
> 
> 1. Intro call, 25 minutes.
> 2. Pairing session, 90 minutes, a small React exercise in your own editor.
> 3. Product and design critique, 45 minutes, with a designer and the product manager.
> 4. Conversations with two future teammates.
> 
> Most candidates finish the whole thing in about two weeks.

Draft before the fix-up pass (Astra 9.7):

> From what I have on the process:
> 
> 1. Intro call, 25 minutes.
> 2. Pairing session, 90 minutes, a small React exercise in your own editor.
> 3. Product and design critique, 45 minutes, with a designer and the product manager.
> 4. Conversations with two future teammates.
> 
> Most candidates finish the whole thing in about two weeks. I'll confirm the exact timing of the teammate conversations with them.

**E19 candidate, in the app** (Astra **9.8**):

> From what I have on the process: after the 25-minute intro call, there's a 90-minute pairing session on a small React exercise in your own editor, then a 45-minute product and design critique with a designer and the product manager, and finally conversations with two future teammates. Most candidates finish the whole thing in about two weeks. I'll confirm the exact timing for the teammate conversations and follow up.

#### ER-D2-LFW-035 · multi_source · heard · profile B-JD

Said before:

> other: Before we start, where are you based these days?
> user: Porto. I've worked remotely from here for a few years now.

**Question:** Good, that's inside our time-zone window. Do you know which hours we'd need you online, and what that works out to on your clock?

**A correct answer:** Two sources: the posting and what she has just said. The posting sets core hours from 10:00 to 15:00 CET (the role is remote within UTC-1 to UTC+3). She said she is in Porto, which keeps Lisbon time, one hour behind Central European time all year round. So the core hours are 09:00 to 14:00 for her. Only the posting is loaded, so nothing else about her situation should be invented.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Core hours are **10:00 to 15:00 CET**, so that's **9:00 to 14:00 on my clock** in Porto. I'm **well inside the UTC-1 to UTC+3 window**.

Draft before the fix-up pass (Astra 9.9):

> Core hours are 10:00 to 15:00 CET, so that's 9:00 to 14:00 on my clock in Porto. I'm well inside the UTC-1 to UTC+3 window, and I can be flexible around those core hours for meetings or pairing.

**E19 candidate, in the app** (Astra **10.0**):

> Core hours are 10:00 to 15:00 CET, so that's 9:00 to 14:00 on my clock in Porto.

**Before E16b** (main `73cf34e6`, Astra 5.5):

> I don't have the exact hours from you yet, so I'd rather confirm them than guess. If you tell me the window you need me online, I'll map it to Porto time and confirm it works on my end.

**With E16b** (same day, same question, shown answer not judged):

> Core hours are 10:00 to 15:00 CET, so that's 9:00 to 14:00 my time in Porto.

#### ER-D2-LFW-036 · grounded_single · heard

**Question:** And the job before your current one, why did you leave that?

**A correct answer:** No profile is loaded, but his own prep notes are. They say he left Tessarine in February 2023 because the company had been acquired the autumn before and backend architecture decisions moved to the parent's platform group; after that he was implementing someone else's tickets. The trap is his reasons for leaving his current employer (the platform work being finished, no Staff level on the ladder), which are in the same notes and answer a different question.

**Main's answer** (Astra **2.0** · HARD FAIL · needed facts in the prompt: yes):

> Tessarine had been acquired the autumn before, and backend architecture decisions moved to the parent's platform group. After that I was mostly implementing someone else's tickets, so I moved on. It's part of why I'm looking for somewhere the design work still sits with the engineers.

Draft before the fix-up pass (Astra 2.0 · HARD FAIL):

> Tessarine had been acquired the autumn before, and backend architecture decisions moved to the parent's platform group. After that I was mostly implementing someone else's tickets, so I moved on. It was the right call, and it's part of why I'm looking for somewhere the design work still sits with the engineers.

#### ER-D2-LFW-037 · grounded_single · heard

**Question:** I gave a conference talk on idempotency earlier this year. Did you come across it? What did you take from it?

**A correct answer:** No profile is loaded, but his research notes are. They record a talk by Sarvesh Idnavalli at Ledgerfest in February 2026 on idempotency keys: keys are stored for 72 hours, and a retried request gets the original stored response back, not a second execution; in the Q&A he was direct about what they got wrong the first time. The answer says yes and gives those specifics. The near-miss is the May 2026 blog post on the append-only ledger, which is a different piece. It must not invent content that the notes do not record.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> I came across it, and the part about the 72-hour key window and returning the original stored response on a retry instead of executing again is what I took from it. Idempotency is really a storage and retention problem, not just a request-header check. What would you change about it now?

Draft before the fix-up pass (Astra 10.0):

> I did watch it, and the part that stuck with me was the 72-hour key window and returning the original stored response on a retry instead of executing again. What I took from it is that idempotency is really a storage and retention problem, not just a request-header check. I'd love to hear what you'd change about it now.

**E19 candidate, in the app** (Astra **9.3**):

> I came across the talk by Sarvesh Idnavalli at Ledgerfest in February 2026, on idempotency keys, keys stored for 72 hours, and a retried request getting the original stored response back rather than a second execution. In the Q&A he was direct about what they got wrong the first time.

#### ER-D2-LFW-038 · grounded_single · heard

**Question:** Tell me about a time someone wanted to call a result early and you held out. How did you handle it?

**A correct answer:** No profile is loaded, but her prep notes are. The story: two weeks into the Fernlatch A/B run the new flow was ahead by 8.1 points and Rodrigo Azinhal, the booking squad's product manager, wanted to ship and announce. The length had been agreed in advance because clinics book in a weekly rhythm and returning pet owners behave differently from new ones. She said no in the squad channel and then on a call; they settled on raising exposure from 20% to 50% and waiting. The gain settled lower than the week-two reading, and the stopping rule is now written into every experiment plan and is a required field in the Dialbench template. The final gain figure is only in her CV, which is not loaded, so the answer must not state one.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Two weeks into an A/B test, the new flow was ahead by 8.1 points and Rodrigo, the booking squad's PM, wanted to ship and announce it. We'd agreed the run length in advance, because clinics book in a weekly rhythm and returning pet owners behave differently from new ones, so I said no, first in the squad channel and then on a call, which was the more useful conversation. We raised exposure from 20% to 50% and waited it out. The gain settled lower than that week-two reading. Now the stopping rule is a required field in our experiment template.

#### ER-D2-LFW-039 · grounded_single · heard

Said before:

> other: What are you on at the moment, if you don't mind me asking?
> user: Eighty-five thousand base. I'd want roughly a fifteen percent bump to make a move worth it.

**Question:** Okay. So what figure should I write down as your expectation?

**A correct answer:** No profile or file is loaded; the facts were said a moment ago in this conversation: a base of 85,000 and a wish for roughly fifteen percent more. 85,000 x 1.15 = 97,750, so the figure is about 98,000 base. The answer works the number out instead of repeating "fifteen percent", stays consistent with what was said, and adds nothing that was not said (no currency was named, no bonus, no employer).

**Main's answer** (Astra **9.9**):

> I'd write down **ninety-eight thousand** as the base I'm looking for. That's the fifteen percent bump on my current eighty-five, and it's the number that makes a move worth making for me. If the rest of the package is strong, I'm happy to talk through how it all adds up.

#### ER-D2-LFW-040 · irrelevant_source · heard

**Question:** We can run the two technical rounds in either order. Would you rather start with the coding one or the design one?

**A correct answer:** A present choice that belongs to the candidate, not a biographical fact, and nothing is loaded. The answer picks one order and gives a short, sensible reason (for example coding first to warm up, or design first while fresh); either choice is acceptable. It must not refuse, say it lacks information, or invent a background to justify the choice.

**Main's answer** (Astra **8.3** · flags: excessive_deferral):

> I'll confirm my preference and come back to you on it. Either order works, so if it's easier on your side to run design first, that's fine with me.

Draft before the fix-up pass (Astra 10.0):

> I'd rather start with the coding round. It gets me into the problem-solving mode early, and I can carry that momentum into the design discussion. Either order works for me though, so if it's easier on your side to run design first, I'm happy to do that.

**E19 candidate, in the app** (Astra **10.0**):

> Happy to start with the coding round. Then the design round can go deeper once we've got that momentum.

### Lecture — dev2 (40 questions; main scores 9.08 on 40 judged)

#### ER-D2-LEC-001 · grounded_single · heard

Said before:

> other: After a couple of losses this sender's window is down at three segments, and then the retransmission timer fires.

**Question:** Half of three is one and a half. So what does the threshold actually become on our rules, and where does the window go?

**A correct answer:** The lecturer is testing the two small-print rules on the loss-signals slide. After a timeout ssthresh = cwnd / 2; halves are rounded down, so 1.5 becomes 1, but ssthresh is never set below 2 segments, so the threshold becomes 2 segments. The window goes to the course's initial window, also 2 segments, and the sender returns to slow start. A good answer shows both steps (round down, then apply the floor) and gives both values.

**Main's answer** (Astra **8.7** · needed facts in the prompt: yes):

> On the course rules, a timeout is the severe signal: ssthresh becomes half the current window, rounded down, and cwnd drops back to the initial window of 2 segments, then slow start resumes. So with cwnd at 3, half is 1.5, rounded down to 1, but ssthresh is never set below 2 segments, so ssthresh lands on 2 and cwnd goes to 2. The window sits at 2 segments and starts doubling again each round until it reaches that threshold.

#### ER-D2-LEC-002 · grounded_single · typed

**Question:** in her trace after the timeout it goes 2, 4, then 6. why 6 and not 8?

**A correct answer:** After the timeout in round 11 the threshold is 6 segments (half of 12). Slow start doubles the window, but the course's clamp rule says slow start never overshoots the threshold: next cwnd = min(2 x cwnd, ssthresh), so min(8, 6) = 6 in round 14. From there the trace is in congestion avoidance (7 in round 15).

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> After the timeout, cwnd drops to IW = 2, then slow start doubles each round, but the clamp rule stops it overshooting ssthresh. ssthresh was set to 6, so round 13 gives 4, and round 14 would double to 8, which is above 6, so it clamps to **6** instead. Round 15 then enters congestion avoidance and adds one, giving 7.

#### ER-D2-LEC-003 · grounded_single · heard

**Question:** And that's the whole reason we have today's topic at all. Who remembers the collapse story I started with, and how bad the numbers got?

**A correct answer:** The lecture opened with the 1986 congestion collapse story: between two sites 400 yards apart, throughput fell from 32 kbit/s to 40 bit/s. The answer should give the lecturer's figures, not a generic account.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The collapse story is the 1986 congestion collapse: two sites about 400 yards apart, throughput falling from 32 kbit/s down to 40 bit/s. That's the case the whole lecture on TCP congestion control is built around.

#### ER-D2-LEC-004 · grounded_single · typed

**Question:** practice q: srtt is 80 ms and the next rtt sample comes in at 120 ms. what's the new srtt with the smoothing formula from her timer slide?

**A correct answer:** The timer slide gives SRTT = 7/8 x SRTT + 1/8 x sample. 7/8 x 80 = 70 and 1/8 x 120 = 15, so the new SRTT is 85 ms. Only the smoothed RTT is asked for; the answer need not go on to RTTVAR or the RTO.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The formula from the slide is **SRTT = 7/8 × SRTT + 1/8 × sample**. So with SRTT at 80 ms and a sample of 120 ms: 7/8 × 80 = 70, and 1/8 × 120 = 15, giving a new SRTT of **85 ms**. The sample pulled it up, but only by an eighth of the 40 ms gap.

#### ER-D2-LEC-005 · grounded_single · heard

Said before:

> other: Type the name wrong and what comes back is: no such domain.

**Question:** The resolver hangs on to that answer as well. For how long in our zone, and which record tells it?

**A correct answer:** A reply of NXDOMAIN is cached too. In the course's zone the negative-caching time is 900 seconds (15 minutes), and it is taken from the SOA record. It is not the 300 seconds of the portal's A record, and not the 86,400 seconds of the NS records.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The negative answer is cached for **900 seconds**, so fifteen minutes in our zone. The record that tells the resolver is the **SOA record** for the zone, which carries the negative-caching time.

#### ER-D2-LEC-006 · grounded_single · typed

**Question:** timetable page: how many ms did keeping one connection open save compared with a fresh connection for every object, in her numbers?

**A correct answer:** From the lecturer's HTTP notes, at the lecture's 50 ms RTT: non-persistent, one object at a time, is 24 RTT = 1,200 ms; persistent without pipelining is 13 RTT = 650 ms. The saving is 11 RTT, which is 550 ms.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The notes give the two totals: non-persistent, one object at a time, costs 24 RTT, which is **1,200 ms**, and persistent with no pipelining costs 13 RTT, or **650 ms**. So keeping one connection open saved **550 ms** on the timetable page.

#### ER-D2-LEC-007 · grounded_single · heard

**Question:** Say five hundred crowns of fresh reserves land in Norvale's banks. With our reserve requirement, what's the most that can grow into as deposits?

**A correct answer:** Norvale's reserve requirement is 8%, so the money multiplier is 1 / 0.08 = 12.5. Five hundred crowns of new reserves can support up to 500 x 12.5 = 6,250 crowns of deposits. (The slide's own example is 200 crowns giving 2,500.) The answer may add the slide's caveat that the real multiplier is smaller in practice.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The multiplier is 1 divided by the reserve ratio, and Norvale's reserve requirement is 8%, so that's 1 / 0.08 = **12.5**. Five hundred crowns of fresh reserves can therefore support up to 500 x 12.5 = **6,250 crowns** of deposits. That's the textbook ceiling, though, since it assumes banks lend out every possible crown and nobody holds cash.

#### ER-D2-LEC-008 · grounded_single · typed

**Question:** what band does kessandru put norvale's 5% inflation in, and where does the next band up start?

**A correct answer:** On the course's bands, 5% a year is moderate (3% to below 10% a year). The next band up, high, starts at 10% a year. Mild is below 3%, and hyperinflation is 50% a month or more.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Kessandru puts Norvale's 5% inflation in the **moderate** band, which runs from 3% up to but not including 10% a year. The next band up is **high**, and it starts at 10% a year. Mild is below 3%, and hyperinflation sits far above at 50% a month or more.

#### ER-D2-LEC-009 · grounded_single · heard

**Question:** Since the base year, how much dearer has the student basket got altogether? And tell me why that isn't the figure we call this year's inflation.

**A correct answer:** The basket cost 1,250 crowns in the base year 2024 and 1,365 crowns in 2026: 115 crowns more, a rise of 9.2% (CPI 100.0 to 109.2). That is not this year's inflation because the course always measures inflation from the previous year's index, not from the base year: 104.0 to 109.2 is 5.0%.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Since the base year the basket has gone up 9.2%, from 1,250 crowns to 1,365. That 9.2% is the total climb in the price level since 2024, not this year's inflation. This year's inflation is 5.0%, the rise from last year's index of 104.0 to this year's 109.2, divided by 104.0. We always measure from the previous year's index, so the base year only sets the 100.

#### ER-D2-LEC-010 · grounded_single · typed

**Question:** the tax on a cup of coffee thing in his notes, what % of it do the sellers end up eating?

**A correct answer:** In the professor's example the tax is 0.50 crowns per cup; the price buyers pay rises by 0.30 and the price sellers keep falls by 0.20. Sellers therefore carry 0.20 / 0.50 = 40% of the tax, and buyers the stated 60%.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The lecture example uses a tax of 0.50 crowns per cup. Buyers' price rises by 0.30 and sellers' price falls by 0.20, so sellers end up carrying **40%** of it. The reason is that the less elastic side of the market carries more of the tax, and here demand for coffee near campus is less elastic than supply.

#### ER-D2-LEC-011 · grounded_single · heard

**Question:** Earlier I called elasticity nothing more than the slope of the demand curve. Scrub that. Who can tell me what's wrong with it?

**A correct answer:** The professor's notes withdraw the remark. Along a straight-line demand curve the slope is the same everywhere, but elasticity is not: it is above 1 at high prices and below 1 at low prices. Slope uses changes in units; elasticity uses percentage changes.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The slope is the same everywhere along a straight-line demand curve, but elasticity isn't. Slope uses changes in units, elasticity uses percentage changes, so the same curve is elastic at high prices and inelastic at low prices.

#### ER-D2-LEC-012 · grounded_single · typed

**Question:** in underhaye's dam analogy what is cyanide doing? which bit does it hit

**A correct answer:** Cyanide blocks Complex IV. In the lecturer's dam picture that is the outflow gate being shut: the pumps of the electron transport chain stall because the water has nowhere to go. It is not the hole in the dam wall; that is DNP.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> In Underhaye's dam picture, cyanide blocks **Complex IV**, the last pump in the electron transport chain. So the outflow gate is shut: the spent water can't leave, the pumps stall, and the whole chain backs up.

#### ER-D2-LEC-013 · grounded_single · heard

Said before:

> other: NADH we've done: ten protons, two and a half ATP.

**Question:** FADH2 only earns one and a half. Somebody tell me why it gets short-changed.

**A correct answer:** FADH2 hands its electrons to Complex II, which pumps no protons, so it misses Complex I. Only 6 protons are pumped for it (4 at Complex III and 2 at Complex IV) instead of 10. ATP synthase needs 4 protons per ATP in this course, so 6 / 4 = 1.5.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> FADH2 hands its electrons to Complex II, and Complex II pumps no protons, so it skips Complex I entirely. NADH enters at Complex I, which pumps 4 protons, then Complex III pumps 4 and Complex IV pumps 2, giving 10 protons. FADH2 gets only the 6 from Complex III and IV. ATP synthase needs 4 protons per ATP, so 10 divided by 4 is 2.5 for NADH and 6 divided by 4 is 1.5 for FADH2. It's short-changed because it joins the chain one station further down.

Draft before the fix-up pass (Astra 10.0):

> FADH2 hands its electrons to Complex II, which pumps no protons, so it skips Complex I entirely. NADH gives 10 protons (4 from Complex I, 4 from III, 2 from IV), but FADH2 only gives 6, since it misses that first 4-proton pump. At 4 protons per ATP, 6 divided by 4 is 1.5.

#### ER-D2-LEC-014 · grounded_single · heard

Said before:

> other: White eye in the fruit fly sits on the X, and it's recessive.

**Question:** Carrier mother, red-eyed father. What do I see in the sons, and what in the daughters?

**A correct answer:** From the notes on sex linkage: with a carrier female and a red-eyed male, half of the sons are white-eyed and none of the daughters are. A good answer says why: sons get their only X from the mother; every daughter gets the father's X carrying the red allele.

**Main's answer** (Astra **9.6** · needed facts in the prompt: yes):

> With a carrier mother and a red-eyed father, the sons split: half are white-eyed and half are red-eyed, because a son gets his single X from his mother, so he shows whatever allele she passes on. The daughters all have red eyes, since they get a red-bearing X from their father, and none of them are white-eyed. But half the daughters are carriers, because they can inherit the recessive white allele from their mother alongside the father's dominant red one.

#### ER-D2-LEC-015 · grounded_single · typed

**Question:** out of her 30 atp per glucose, how many come from oxidative phosphorylation and how many are made directly?

**A correct answer:** Use the BIO 1380 ledger. Made directly: 2 ATP net in glycolysis and 2 ATP in the citric acid cycle, so 4. Everything else comes from oxidative phosphorylation: 3 (the 2 glycolysis NADH at 1.5 each) + 5 (2 NADH from pyruvate oxidation at 2.5) + 15 (6 NADH from the cycle at 2.5) + 3 (2 FADH2 at 1.5) = 26. The notes do not state the 26; it has to be worked out from the ledger.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Of the 30 ATP per glucose in the BIO 1380 ledger, **4 come directly** from substrate-level phosphorylation: 2 from glycolysis and 2 from the citric acid cycle. The other **26 come from oxidative phosphorylation**, which is the 8 mitochondrial NADH at 2.5 each, plus the 2 cytosolic NADH and 2 FADH2 at 1.5 each. So 4 direct, 26 from the electron transport chain and ATP synthase.

#### ER-D2-LEC-016 · multi_source · typed

**Question:** the slide just says aimd is fair. fair how? and does that hold for any two flows

**A correct answer:** The slide's claim: two flows sharing one bottleneck drift towards equal shares, because both add the same amount each round but the larger one loses more when both halve (the staircase and the cliff). The lecturer's notes of 30 September narrow it: fair between flows with similar round-trip times. A flow with a shorter RTT climbs its staircase more often and ends up with the larger share, so it does not hold for any two flows.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Fair here means **equal shares of the bottleneck**, and it comes from the shape of AIMD itself. Both flows add the same one segment per round, so the smaller flow gains proportionally more, and when loss hits, both halve, so the larger flow gives up more. That tugging pulls two flows toward the same window.
> 
> But no, it doesn't hold for any two flows. It's fair between flows with **similar round-trip times**. A flow with a shorter RTT climbs its staircase more often, so it ends up with the larger share. So AIMD is fair in the equal-RTT case, and biased toward the shorter-RTT flow otherwise.

#### ER-D2-LEC-017 · multi_source · heard

Said before:

> other: Same laptop, same name, exactly one hour after that first cold lookup. Nobody else has asked the resolver for it in between.

**Question:** Count it the way we do. How many queries this time, and who gets asked?

**A correct answer:** One hour is 3,600 seconds. The portal's A record has a TTL of 300 seconds, so it has expired; the NS records for the zone carry 86,400 seconds, so they are still cached. In that case the campus resolver skips the root and the TLD and goes straight to ns1. Counting queries only, as the course does: laptop to campus resolver, and resolver to ns1. That is 2 queries, not 1 (a cache hit) and not 4 (a cold lookup).

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Two queries this time. The A record's 300-second TTL has expired, but the NS records are still cached with their day-long TTL, so the campus resolver skips the root and the TLD and goes straight to ns1. The laptop asks the resolver, and the resolver asks the authoritative server.

#### ER-D2-LEC-018 · multi_source · typed

**Question:** my stipend is 2,184 crowns a month this year. what's that in base-year money? use the real value formula on our sheet and the cpi from the basket slide

**A correct answer:** The formula sheet gives real value = nominal value / CPI, x 100. The basket slide gives a CPI of 109.2 for 2026 (base year 2024 = 100.0). 2,184 / 109.2 x 100 = 2,000 crowns in 2024 money. Using the 2025 index of 104.0 would give 2,100 and is the wrong year.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Real value = nominal value / CPI, x 100. With the 2026 CPI of 109.2 from the basket slide, that's 2,184 / 109.2 x 100 = **2,000 crowns** in base-year (2024) money.

#### ER-D2-LEC-019 · multi_source · heard

**Question:** A year and a half, I told you, before a rate change shows up fully in prices. Don't go applying that to every economy, though.

**A correct answer:** The slides give the lags: borrowing responds within 1 to 2 quarters, and the course's rule of thumb for the full effect on inflation is 6 quarters (a year and a half). The professor's notes add the caveat he is alluding to: the 6 quarters is a rule of thumb for Norvale, not a law of nature, and larger and more closed economies are usually slower.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The six-quarter lag is a rule of thumb for Norvale, not a general law. The notes say larger and more closed economies are usually slower, so the year-and-a-half figure is specific to that small open economy rather than something you'd apply everywhere.

#### ER-D2-LEC-020 · multi_source · heard

Said before:

> other: Four hundred offspring this time. One gene, wing-case colour, and both parents are big R, little r.

**Question:** How many grey would you expect? And of the russet ones, how many are hiding a grey allele?

**A correct answer:** R/r x R/r gives phenotypes 3 : 1, so of the 400 offspring the lecturer just mentioned 100 are expected to be grey and 300 russet. Among the russet beetles two-thirds are carriers (R/r), which is 200. (Equivalently, half of all 400 are R/r.)

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> With R/r crossed to R/r, you'd expect a 3 to 1 ratio, so about **100 grey** and 300 russet out of the 400. Of those russet beetles, two-thirds are heterozygous, so roughly **200** of them are hiding a grey allele. The other third are R/R and carry no grey at all.

#### ER-D2-LEC-021 · multi_source · typed

**Question:** is http/3 and the quic stuff going to be on the networks midterm? and when is that lecture even happening

**A correct answer:** The lecturer's notes say HTTP/3 over QUIC is lecture 12 and will not be on the midterm. The syllabus lecture plan puts lecture 12 (TLS, QUIC and HTTP/3) on Thursday 15 October. Both statements about midterm scope in the pack (lectures 1 to 8 in the syllabus, up to lecture 7 in the notes) stop well short of lecture 12, so this is not affected by that disagreement.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: missed_available_evidence, major_factual_error · needed facts in the prompt: yes):

> QUIC and HTTP/3 are lecture 12, on Thursday 15 October, and they won't be on the midterm. The midterm covers lectures 1 to 8 only, and the lecturer's notes say explicitly that HTTP/3 over QUIC is lecture 12 and will not be on the midterm. The midterm itself is Thursday 22 October 2026, in the lecture slot.

#### ER-D2-LEC-022 · multi_source · heard

Said before:

> other: New numbers. Stipends go up by twenty percent, and visits to the campus cinema go up by thirty.

**Question:** Income elasticity, please. And what sort of good does that make a cinema ticket?

**A correct answer:** Income elasticity = % change in quantity / % change in income = 30 / 20 = 1.5 (1.50 to the sheet's two decimal places), sign kept, here positive. On the formula sheet an income elasticity above 1 is a luxury. The noodle figure in the notes (-0.3, an inferior good) is the lecture's own example, not this one.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Income elasticity is the percentage change in quantity divided by the percentage change in income. Here that's 30 over 20, so **1.5**. Above 1 means a **luxury good**: cinema visits rise more than proportionally as income rises.

#### ER-D2-LEC-023 · multi_source · typed

**Question:** on the throughput slide is 20 the average window? what's the real average and what speed does that come to

**A correct answer:** The lecturer's notes settle it: in the throughput example 20 is the peak, the window at which the loss happens; it is not the average and not the starting value. The slide's own working gives the average: 0.75 x 20 = 15 segments, 18,000 bytes per round, 225,000 bytes per second, which is 1.8 Mbit/s (MSS 1,200 bytes, RTT 80 ms).

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No, 20 is the peak, not the average. In the sawtooth the window swings between W/2 and W, so the average is **0.75 x W**, which here is **15 segments**. At 1,200 bytes per segment that's 18,000 bytes per round, and over an 80 ms RTT that comes to 225,000 bytes per second, or **1.8 Mbit/s**.

#### ER-D2-LEC-024 · conflict_stale · heard

**Question:** The midterm's in our normal lecture slot, normal room. Put the date in your diary now, please.

**A correct answer:** From this term's syllabus (Autumn 2026, version 1.1): the midterm is on Thursday 22 October 2026, in the lecture slot, 80 minutes. The lecture slot this term is Tuesday and Thursday 10:00 to 11:30 in room HV 2.14 of the Hale-Voss Building. Last year's syllabus (Wednesday 29 October 2025; Monday and Wednesday 14:00 to 15:30 in HV 1.05) must not be used.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: major_factual_error · needed facts in the prompt: yes):

> The midterm is **Thursday 22 October 2026**, in the normal lecture slot, so 10:00 to 11:30 in room HV 2.14. It's 80 minutes and covers lectures 1 to 8.

#### ER-D2-LEC-025 · conflict_stale · typed

**Question:** handed my networks lab report in two days late. the work itself would've got 78. what mark do i actually end up with?

**A correct answer:** This term's late policy: a late lab report loses 10 marks out of 100 for each day or part of a day, for up to 3 days. Two days late costs 20 marks, so 78 becomes 58. Last year's syllabus (5 marks a day for up to 5 days) would give 68 and is out of date.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Two days late, so you lose 10 marks per day, which is 20 off. That takes 78 down to **58**.
> 
> One thing to check: the late policy only runs for up to 3 days, and after that it scores zero, so two days is still inside the window. If you think the mark itself is wrong, regrade requests go to the teaching assistant within 7 days of the mark being released.

#### ER-D2-LEC-026 · conflict_stale · typed

**Question:** for the econ midterm do i have to print the formula sheet and bring it myself, or does it come with the paper?

**A correct answer:** The current formula sheet (version 2026.2, issued 14 September 2026) says a student may bring one unmarked printed copy to the midterm and to the final, with nothing written on it. So the student prints and brings it. Last year's sheet (version 2025.1, whose filename ends in 'final') said it was printed on the back page of the exam papers and that students could not bring their own copy; that is superseded.

**Main's answer** (Astra **3.0** · HARD FAIL · flags: stale_source_preferred, missed_available_evidence, major_factual_error · needed facts in the prompt: yes):

> The formula sheet is printed on the back page of the midterm paper, so it comes with the exam. You may not bring your own copy into the room.

#### ER-D2-LEC-027 · conflict_stale · heard

**Question:** Two things cost people marks on the last problem set: rounding the wrong way, and writing down a naked answer. You've got my rules for both.

**A correct answer:** The rules are on the current formula sheet (version 2026.2). Rounding: elasticities to 2 decimal places, rates and percentages to 1 decimal place, money amounts to whole crowns unless the problem is in cents; round only at the end and carry at least four significant figures through the working. A bare number earns no method marks: state the method in one line before calculating. Last year's sheet (all results to 1 decimal place) is superseded.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The lecturer's rules for the last problem set were: round only at the end, and state the method in one line before you calculate, because a bare number earns no method marks. For rounding, elasticities go to 2 decimal places, rates and percentages to 1 decimal place, and money amounts to whole crowns unless the problem is in cents. Carry at least four significant figures through the working. And give units, since an interest rate is in percent a year and an elasticity has no units.

#### ER-D2-LEC-028 · conflict_stale · heard

**Question:** And a reminder that scraping fifty overall won't be enough by itself this term. There's a floor on the final as well.

**A correct answer:** This term's syllabus: to pass, a student needs an overall mark of at least 50 and at least 45 out of 100 in the final exam. Last year's syllabus had only the overall 50 and no minimum on the final; that is out of date.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The lecturer's right, and the syllabus spells it out: to pass CNW 2140 you need an overall mark of at least 50 **and** at least 45 out of 100 in the final exam. So the final is 40% of the course mark and it carries its own separate floor. Scraping 50 overall won't save you if the final comes in under 45.

#### ER-D2-LEC-029 · conflict_stale · typed

**Question:** how many days from the networks midterm to the final? trying to plan revision

**A correct answer:** This term's syllabus: midterm on Thursday 22 October 2026, final on Tuesday 15 December 2026. From 22 October to 15 December is 9 + 30 + 15 = 54 days (7 weeks and 5 days). Last year's syllabus (29 October 2025 to 11 December 2025, 43 days) must not be used. An answer that counts the days strictly in between (53) and says so is also fine.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The syllabus for this term gives the midterm as Thursday 22 October 2026 and the final as Tuesday 15 December 2026. That's **54 days** between them, so you've got a good stretch to plan revision around.
> 
> [[CALC]]
> midterm = 22 October 2026
> final = 15 December 2026
> days = 9 (rest of Oct) + 30 (Nov) + 15 (Dec) = 54
> [[/CALC]]

#### ER-D2-LEC-030 · conflict_stale · typed

**Question:** the reading she set at the end of the congestion control lecture, sections 6.3 to 6.5. do i need that for the midterm?

**A correct answer:** That reading belongs to lecture 8 (TCP reliability and retransmission), per the last slide of lecture 7. Whether lecture 8 is on the midterm is not settled in the material: the syllabus (version 1.1, 1 September 2026) says the midterm covers lectures 1 to 8, while Dr. Brantigern's notes, edited 30 September 2026, say it covers everything up to and including lecture 7 and that lecture 8 is examined in the final only. Neither says it replaces the other. The right answer links the reading to lecture 8, tells the student about both statements, and recommends confirming on the course forum or with the lecturer; it may note that the notes are the more recent statement and that the material is examinable in the final either way.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: source_conflict_ignored, major_reasoning_error · needed facts in the prompt: yes):

> The reading she set at the end of the congestion control lecture is Halloway and Minch, sections 6.3 to 6.5, and it's for **lecture 8**, TCP reliability and retransmission. The midterm covers lectures 1 to 8, so yes, that material is in scope. The lecturer's own note is explicit: the midterm covers everything up to and including lecture 7, and lecture 8 will be examined in the final only. So the reading is worth doing, but the lecture 8 content itself isn't on the midterm.

#### ER-D2-LEC-031 · irrelevant_source · typed

**Question:** how does the tcp three-way handshake actually work? just the steps

**A correct answer:** The loaded networks material never explains the handshake; the notes only count opening a TCP connection as 1 RTT. The right answer is a short, correct general-knowledge account: the client sends SYN with its initial sequence number; the server replies SYN-ACK, acknowledging the client's number and giving its own; the client sends ACK, and the connection is open. It must not be presented as something the slides or notes said.

**Main's answer** (Astra **10.0**):

> The three-way handshake opens a TCP connection in three messages:
> 
> 1. The client sends a **SYN** with its initial sequence number.
> 2. The server replies **SYN-ACK**, acknowledging the client's number and sending its own.
> 3. The client sends **ACK**, acknowledging the server's number.
> 
> After that third message both sides have agreed on sequence numbers and the connection is established.

#### ER-D2-LEC-032 · irrelevant_source · heard

Said before:

> other: Next week it's unemployment and the Phillips curve.

**Question:** I'll take it as read that you know what the natural rate of unemployment is, so I won't define it on the day.

**A correct answer:** The loaded economics material only names next week's topic; it does not define the natural rate of unemployment. The right answer is a short, correct general-knowledge definition: the unemployment rate that prevails when the economy is at potential output, made up of frictional and structural unemployment with no cyclical component, and the rate around which inflation neither speeds up nor slows down. It must not attribute a definition or a number to the professor's slides or notes, and must not invent a natural rate for Norvale.

**Main's answer** (Astra **9.7**):

> The natural rate of unemployment is the rate that holds when the labour market is in equilibrium, so there's no cyclical unemployment and inflation isn't being pushed up or down. It's the level the economy gravitates to in the long run, and it's what the Phillips curve is anchored to: at that rate, actual inflation matches expected inflation. It's not zero, and it moves with things like the structure of the labour market and the generosity of benefits.

#### ER-D2-LEC-033 · irrelevant_source · heard

Said before:

> other: A switch builds its table by reading the source address on every frame that arrives, and noting which port it came in on.
> other: If the destination isn't in the table yet, the frame goes out of every port except the one it arrived on.

**Question:** So why does a switch you've only just plugged in act like a hub for its first few moments? Anyone?

**A correct answer:** The answer follows from what the lecturer has just said, not from the loaded files (the syllabus only carries a lecture title on switching). A switch that has just been plugged in has an empty table, so every destination is unknown and every frame is sent out of all the other ports, which is exactly what a hub does. As frames arrive it learns source addresses and their ports and starts forwarding to one port only. The answer must not drag in the TCP, DNS or HTTP material.

**Main's answer** (Astra **9.3**):

> Because the table starts empty. The switch has no entries yet, so every frame's destination is unknown, and an unknown destination gets flooded out of every port except the one it arrived on. As it reads source addresses and fills the table, flooding stops and it behaves like a switch. The course notes don't cover this directly, so that's general knowledge.

Draft before the fix-up pass (Astra 10.0):

> Because the table starts empty. A switch only learns a source address when a frame actually arrives on a port, so at power-on it knows nothing. Until it has learned the destination's port, it has no choice but to flood the frame out of every other port, which is exactly what a hub does. The table fills within moments as traffic flows, and flooding stops once the destination is known.

#### ER-D2-LEC-034 · irrelevant_source · typed

**Question:** difference between dna and rna? two or three lines is enough

**A correct answer:** The loaded biology notes cover respiration and Mendelian crosses, not nucleic acids. The right answer is a short, correct general-knowledge comparison: DNA is usually double-stranded, has deoxyribose and the base thymine, and is the long-term store of genetic information; RNA is usually single-stranded, has ribose and uracil in place of thymine, and does the working jobs (messenger, transfer, ribosomal). It must not be attributed to Dr. Underhaye's notes.

**Main's answer** (Astra **9.9**):

> DNA and RNA are both nucleic acids built from a sugar-phosphate backbone with bases, but they differ in three main ways. DNA has deoxyribose sugar and the base thymine, and it's usually double-stranded, while RNA has ribose sugar and uracil instead of thymine, and it's usually single-stranded. DNA stores genetic information long-term, whereas RNA carries and translates that information into proteins.

#### ER-D2-LEC-035 · missing_evidence · heard

Said before:

> other: A tax changes what people do at the margin, whoever physically hands the money over.

**Question:** It's the same logic as the externality example I gave you in lecture four, so I won't go back over that one.

**A correct answer:** Nothing loaded contains lecture 4: the professor's notes say only that lecture 4 (market failure) has its own handout and is not repeated there, and that handout is not among the files. So his externality example is unknown and must not be invented. To stay useful the answer says so, explains in general terms what an externality is and how a tax can correct one (labelled as general background, not as his example), and points the student to the lecture 4 handout. It must not pass off the coffee tax-incidence example from the lecture 3 notes as the externality example.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: major_factual_error, missed_available_evidence):

> The lecturer is pointing back to the externality example from lecture four, so the point being made is that a tax changes behaviour at the margin regardless of who legally pays it. The incidence falls on whichever side of the market is less elastic, not on whoever hands the money over. In the lecture four example, a 0.50 crown tax per cup left buyers paying 0.30 more and sellers keeping 0.20 less, so buyers carried 60% of it, which tells you demand for coffee near campus is less elastic than supply.

#### ER-D2-LEC-036 · missing_evidence · typed

**Question:** networks group project: do we get to pick our own groups or does she assign them? and has the topic been posted

**A correct answer:** The syllabus says only that the group project is worth 15% of the course mark, is done in groups of three, and that the report is due Friday 27 November 2026. Nothing loaded says how groups are formed or what the topic is. The answer must neither claim nor deny either point; it gives what is known and suggests asking on the course forum or the lecturer. It must not use last year's 10% or 28 November.

**Main's answer** (Astra **9.8**):

> The syllabus doesn't say who picks the groups, only that the project is done in groups of three, and it doesn't mention a topic being posted. So I'd ask Dr. Brantigern directly, or post on the course forum since that's where class-wide questions go.
> 
> For what it's worth, the project is 15% of the mark this term, with the report due Friday 27 November 2026.

#### ER-D2-LEC-037 · missing_evidence · heard

Said before:

> other: Write out the genotypes of both parents before you draw the square.

**Question:** And use the notation we agreed for this course, please. I take marks off when people make up their own.

**A correct answer:** No lecture material is loaded, so the notation this lecturer agreed with the class is unknown. The answer must not state a particular convention as hers. It stays useful by describing the common ways genotypes are written (a capital letter for the dominant allele and lower case for the recessive, usually dominant first, sometimes with a slash between the two alleles), labelled as general practice, and by telling the student to check the lecture notes for the course's own rule.

**Main's answer** (Astra **9.0**):

> The lecturer wants the parental genotypes written out first, using the course's agreed notation. Since the specific notation for this course isn't in what I have, I'd write each parent's genotype with the allele symbols the course uses, for example **Aa × Aa** if that's the convention here, then draw the Punnett square from those two genotypes. If the course uses a different symbol set, I'll match that instead.

#### ER-D2-LEC-038 · missing_evidence · typed

**Question:** when's lab 3 due? the one that builds on her trace

**A correct answer:** With no syllabus loaded, nothing gives a deadline for Lab 3. The lecture 7 slides say only that Lab 3 starts from the trace and asks students to extend it by ten rounds. The answer must not give a date, and must not borrow one from another course (economics problem set 3 is due Wednesday 14 October; biology quiz 3 is on Thursday 8 October). It says what is known about the lab and points the student to the syllabus or the course site.

**Main's answer** (Astra **8.5**):

> Lab 3 is the one that extends the lecture 7 trace by ten rounds, and the notes don't give a due date for it. The only deadline in the CNW 2140 material is the sandbox resolver for Lab 4, which isn't a date either. I'd check the course page or ask Dr. Brantigern directly.

#### ER-D2-LEC-039 · followup · heard

Said before:

> other: Russet is the dominant allele in our beetles.

**Question:** Careful, though. Dominant tells you nothing about how common an allele is. People mix those two up every single year.

**A correct answer:** The student wants the distinction explained. From the notes: dominant does not mean common. Whether an allele is dominant says how it shows in a heterozygote (an R/r beetle is russet), not how frequent it is in the population. A dominant allele can be rare and a recessive one common.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Right, and the marsh beetle is the clean example of it. Russet is dominant over grey, so R/r and R/R both look russet, but that says nothing about how many R alleles are actually in the pond. In the pond example grey beetles are 16% of the population, which gives q = 0.4 and p = 0.6, so the recessive allele is the less common one there. Flip the numbers and the dominant allele could just as easily be the rare one. Dominance is about how an allele shows up in a heterozygote, frequency is about how often it turns up in the population.

#### ER-D2-LEC-040 · followup · typed

**Question:** ok so in the pond from her notes, which of the two is actually the commoner one and by how much?

**A correct answer:** Continuing the dominant-versus-common thread with the pond example in the notes: grey beetles are 16% of the pond, so q squared = 0.16 and q = 0.4 for the grey allele r; p = 0.6 for the russet allele R. So in this pond the dominant allele R is the commoner one, 0.6 against 0.4 (60% against 40%). That is a fact about this pond, not a consequence of R being dominant.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> In the pond example, grey beetles are 16% of the population, so q = 0.4 and p = 0.6. That makes the russet allele the commoner one, at 60% against 40% for grey, a gap of 20 percentage points. So here the dominant allele happens to be the frequent one, but that's a coincidence of this pond, not a rule.

### Technical Interview — dev2 (40 questions; main scores 8.68 on 40 judged)

#### ER-D2-TI-001 · grounded_single · heard · profile A

Said before:

> other: Back to the tracking pipeline for a second.

**Question:** That hundred-and-forty millisecond p99, where does the time actually go? Which hop eats most of it?

**A correct answer:** He breaks the 140 ms p99 down as his notes do: 15 ms in carrier-gateway, 25 ms in normalizer and 100 ms in shipment-projector, and says the projector takes most of it because the PostgreSQL commit dominates there. He may add the p50 of 38 ms. He does not invent another split or another bottleneck.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The p99 budget breaks down as 15 ms in carrier-gateway, 25 ms in normalizer, and 100 ms in shipment-projector. So the projector eats most of it, and inside that hop it's the PostgreSQL commit that dominates, not the Kafka read. That's why we sized partitions around the commit rate, one consumer sustains about 1,400 events per second per partition.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> The p99 budget is 15 ms in carrier-gateway, 25 ms in normalizer, and 100 ms in shipment-projector, so the projector eats most of it. That's where the PostgreSQL commit dominates, and it's the one hop I'd look at first if we needed to shave the tail.

**With E16b** (same day, same question, shown answer not judged):

> The p99 budget breaks down as 15 ms in carrier-gateway, 25 ms in normalizer, and 100 ms in shipment-projector. So the projector eats most of it, and inside that hop it's the PostgreSQL commit that dominates, since the state write and the outbox row go in one transaction.

#### ER-D2-TI-002 · multi_source · typed · profile A

**Question:** how many times ostrakel's daily volume was skeinrouter pushing on a normal weekday? want a rough ratio i can say, and tell me if the comparison is fair

**A correct answer:** Two documents: the job description gives Ostrakel's ordinary day as 2.6 million transactions, the deep-dive notes give Skeinrouter's typical weekday as about 620 million events. 620 / 2.6 is about 238, so roughly 240 times. The honest caveat belongs in the answer: a tracking event is not a payment, so this shows experience with volume and throughput, not with money movement. The daily figure is the stated 620 million; the 41,000 per second peak must not be multiplied out into a day.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Skeinrouter's typical weekday was about 620 million events, against Ostrakel's 2.6 million transactions a day, so roughly **240 times** Ostrakel's volume. But I'd flag the comparison as not really fair: they're different units. Skeinrouter counts tracking events, one shipment can generate many, while Ostrakel's figure is money-moving transactions. Different domains, different cost per unit. I'd use it as a scale signal, not a like-for-like throughput comparison.

**Before E16b** (main `73cf34e6`, Astra 5.6):

> I don't have a Skeinrouter figure for Ostrakel's daily volume, so I can't give you a ratio. What I do have is Skeinrouter's own traffic: about 620 million events on a typical weekday, averaging around 7,200 events per second, with a daytime plateau of 13,000 to 15,000.
> 
> On fairness: comparing the two only works if they're the same unit and the same kind of day. Events per weekday against requests or messages per day isn't apples to apples, and a peak-hour number against a daily average would inflate the ratio. I'd want both on the same basis before quoting it.

**With E16b** (same day, same question, shown answer not judged):

> Skeinrouter's typical weekday was about **620 million events**, against Ostrakel's **2.6 million transactions** a day, so roughly **240 times** the volume.
> 
> The comparison isn't really fair, though. Ostrakel's number is money movement, where each transaction is a ledger write with idempotency and reconciliation behind it. Skeinrouter's is tracking events, a much lighter unit. So I'd say the ratio is real but the two aren't measuring the same kind of work.

#### ER-D2-TI-003 · missing_evidence · heard · profile A

Said before:

> other: So the technical results on Skeinrouter are clear enough.

**Question:** And in money terms? What did the new pipeline do for revenue, or for customers leaving? Do you have a number for that?

**A correct answer:** Nothing loaded gives a revenue, churn, retention or headcount figure for Skeinrouter; the notes say so by omission and the résumé has none either. He must not produce one. He stays useful by saying plainly that he does not have a revenue or churn number, and offering the customer-facing outcomes he does have: updates more than 2 minutes old on arrival fell from 7.5% to 0.4%, support tickets about late tracking fell from 430 a month to 95, duplicate webhooks from 0.6% to under 0.01%. He may add that the pipeline costs more to run than the old workers.

**Main's answer** (Astra **10.0**):

> I don't have a revenue or churn number for Skeinrouter. What I can give you is the operational side: support tickets about late tracking fell from 430 a month to 95, and duplicate status webhooks went from 0.6% of deliveries to under 0.01%. Running cost went up, about USD 9,300 a month against USD 6,100 for the old polling workers.

**Before E16b** (main `73cf34e6`, Astra 9.9):

> I don't have a revenue or churn number for Skeinrouter, and I'd rather not invent one. What I can point to is the operational side: support tickets about late tracking dropped from 430 a month to 95, and duplicate status webhooks went from 0.6% of deliveries to under 0.01%. Those are the numbers I actually measured.

**With E16b** (same day, same question, shown answer not judged):

> I don't have a revenue or churn number for Skeinrouter. What I can give you is the operational side: support tickets about late tracking fell from 430 a month to 95, and duplicate status webhooks dropped from 0.6% of deliveries to under 0.01%. The pipeline itself runs about USD 9,300 a month against USD 6,100 for the old polling workers, so it's a real cost increase, and the case for it was latency and reliability rather than direct revenue.

#### ER-D2-TI-004 · conflict_stale · typed · profile A

**Question:** is skeinrouter cheaper or dearer to run than the old polling workers were, and by how much a month?

**A correct answer:** The notes of September 2026 describe what runs: about USD 9,300 a month, against USD 6,100 for the old polling workers, so it is dearer by about USD 3,200 a month (roughly half as much again). The May 2024 design document is a proposal in review and its USD 5,400 is an estimate that was not met; using it would make the pipeline look cheaper than the old workers, which is wrong.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Skeinrouter is dearer to run. It costs about **USD 9,300 a month**, against **USD 6,100** for the old polling workers, so roughly **USD 3,200 a month more**. That buys the throughput and latency jump, and the old cron module was switched off in February 2025.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> Skeinrouter is dearer. It runs about **USD 9,300** a month, against **USD 6,100** for the old polling workers, so roughly **3,200** a month more. That buys the jump from 9,000 to 41,000 events a second and p99 latency down from 870 ms to 140 ms.

**With E16b** (same day, same question, shown answer not judged):

> Skeinrouter is dearer to run. It's about **USD 9,300 a month** against **USD 6,100** for the old polling workers, so roughly **USD 3,200 a month** more. That bought peak throughput from 9,000 to 41,000 events a second and p99 latency from 870 ms down to 140 ms.

#### ER-D2-TI-005 · conflict_stale · heard · profile A

Said before:

> other: Let's talk about how you got Skeinrouter into production.

**Question:** How long did you run the new pipeline alongside the old one before you trusted it, and did every carrier move across in one go?

**A correct answer:** What happened, from the current notes and the résumé: 6 weeks of shadow traffic (16 September to 27 October 2024), then carriers moved one by one behind per-carrier flags over 9 weeks, with no carrier moved back. The May 2024 proposal planned 2 weeks of shadow traffic and a single cutover for everyone on 22 September 2024; that plan was not what was done and must not be given as the answer.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Six weeks of shadow traffic, from mid-September to late October 2024, comparing output against the old module until mismatches fell from 0.3% to under 0.002%. Then per-carrier flags over nine weeks, not one big cutover, and no carrier was moved back. The cron module stayed on until early February 2025.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> Six weeks of shadow traffic, from mid-September to late October 2024, comparing output against the old module until mismatches fell from 0.3% to under 0.002%. Then carriers moved across in waves, per-carrier flags over nine weeks, not one go. No carrier was moved back, and we switched the cron module off in February 2025.

**With E16b** (same day, same question, shown answer not judged):

> Six weeks of shadow traffic, from mid-September to late October 2024, comparing output against the old module. Mismatches fell from 0.3% in the first week to under 0.002% in the last. Then carriers moved across in per-carrier flags over nine weeks, not one go, and none were moved back.

#### ER-D2-TI-006 · multi_source · heard · profile A

**Question:** This job has you running design reviews and bringing a couple of engineers along, without being their manager. What's the nearest thing you do now?

**A correct answer:** Résumé and job description together: the role asks for leading design reviews and guiding 2 to 3 engineers with no line management; today he is tech lead of Dispatch Core, a team of five in which he leads 4 engineers, owns the technical roadmap, runs the weekly design review and signs off the production-readiness checklist. That is a direct match in scope. The résumé states scope, not people management, hiring or a mentoring story, so he does not claim those. The loaded on-call checklist belongs to another company and has nothing to do with this.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The closest thing is my current role. I'm tech lead for Dispatch Core at Quillhaven, where I lead 4 engineers without any line-management duties. I run the weekly design review and sign off the production-readiness checklist for every service the team ships, and on Skeinrouter I authored the design doc and reviewed every change to the delivery path.

**Before E16b** (main `73cf34e6`, Astra 3.8 · HARD FAIL):

> The closest thing I do now is the on-call rotation on Televisit. I'm primary one week in four, and when a Sev-2 or above comes in, I'm the one who declares severity, pulls in an incident commander, and walks whoever's on with me through the runbook. It's the same shape as a design review: I own the call, but I'm not anyone's manager.

**With E16b** (same day, same question, shown answer not judged):

> The closest thing is my current role. I'm tech lead of Dispatch Core at Quillhaven, leading four engineers without line management, and I run the weekly design review and sign off the production-readiness checklist for every service the team ships. On Skeinrouter I owned the design document and reviewed every change to the delivery path.

#### ER-D2-TI-007 · grounded_single · heard · profile A

**Question:** Your CV mentions a reliability push. What did it actually move? Incident counts, recovery time, that sort of thing.

**A correct answer:** From the résumé only: Sev-1 incidents in the dispatch domain went from 14 in 2023 to 5 in 2025, and median time to restore from 52 minutes to 19 minutes; he wrote 17 runbooks and replaced threshold alerts with SLO burn-rate alerts. The loaded checklist is another company's rotation: its 42 runbooks, 31 incidents and 34-minute median are near-miss numbers that must not appear as his.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The reliability programme I ran in the dispatch domain took Sev-1 incidents from 14 in 2023 down to 5 in 2025, and median time to restore from 52 minutes to 19. The main levers were replacing threshold alerts with SLO burn-rate alerts and writing 17 runbooks. I also led the response to a November 2024 consumer-lag incident, a rebalance storm that delayed tracking updates for 3 hours 40 minutes, and the follow-up moved all consumer groups to cooperative rebalancing with static membership.

**Before E16b** (main `73cf34e6`, Astra 9.6):

> The reliability programme took Sev-1 incidents in the dispatch domain from 14 in 2023 down to 5 in 2025, and median time to restore from 52 minutes to 19 minutes. The mechanics were 17 runbooks and replacing threshold alerts with SLO burn-rate alerts. One incident that drove it was a rebalance storm in November 2024 that delayed tracking updates for 3 hours 40 minutes, and the follow-up moved all consumer groups to cooperative rebalancing with static membership. I was primary on-call one week in five and incident commander on 9 Sev-1 and Sev-2 incidents since April 2024.

**With E16b** (same day, same question, shown answer not judged):

> The reliability programme I ran in the dispatch domain took Sev-1 incidents from 14 in 2023 down to 5 in 2025, and median time to restore from 52 minutes to 19. The mechanics were 17 runbooks and swapping threshold alerts for SLO burn-rate alerts. Separately, I was incident commander on 9 Sev-1 and Sev-2 incidents since April 2024, including a November 2024 rebalance storm that delayed tracking updates for 3 hours 40 minutes, which led to moving all consumer groups to cooperative rebalancing with static membership.

#### ER-D2-TI-008 · multi_source · heard · profile A

**Question:** We change the ledger schema without taking anything down, and we lean on change data capture a fair bit. Have you done either of those for real?

**A correct answer:** The job description lists zero-downtime data migrations and change data capture as good to have; the résumé has both in Marrowgate, the move from sharded MySQL 5.7 to PostgreSQL 15: change data capture with Debezium through Kafka for the backfill, dual writes for 5 weeks, nightly checksum comparison until 10 clean nights, and a cutover with one 11-minute read-only window, no data loss and no rollback. He says that honestly: reads stayed up and writes paused for 11 minutes. It was a freight dispatch datastore, not a ledger, and he does not claim otherwise.

**Main's answer** (Astra **9.2** · needed facts in the prompt: yes):

> Yes, both, and on the same project. Marrowgate moved 2.3 TB across 410 tables from six sharded MySQL shards into one PostgreSQL 15 cluster, and we used Debezium through Kafka for the backfill, dual writes for five weeks, and nightly row-level checksums until mismatches stayed at zero for ten nights. The cutover was one 11-minute read-only window, no data loss, no rollback.

**Before E16b** (main `73cf34e6`, Astra 9.5):

> Yes, both, and on the same project. I owned the design for Marrowgate, moving 2.3 TB across 410 tables from six sharded MySQL shards onto one PostgreSQL cluster. We used Debezium change data capture through Kafka for the backfill, dual writes for five weeks, and nightly row-level checksums until mismatches stayed at zero for ten nights. The cutover was a single 11-minute read-only window, no data loss, no rollback.

**With E16b** (same day, same question, shown answer not judged):

> Yes, both, and on the same project. Marrowgate moved our dispatch datastore from sharded MySQL to PostgreSQL 15, and we ran the backfill with change data capture through Debezium and Kafka, with dual writes from the application for five weeks. The cutover was one 11-minute read-only window, no data loss, no rollback.

#### ER-D2-TI-009 · multi_source · typed · profile A

**Question:** do i clear their experience bar on paper? count it from my cv as of today: total years, and how long i've been at senior / tech lead level

**A correct answer:** The posting wants 6 or more years of backend engineering with at least 2 at senior level or as technical lead. From the résumé, counted to early October 2026: first job from July 2020, so about 6 years 3 months in total; Senior Software Engineer and Tech Lead since April 2024, so about 2 years 6 months. Both bars are cleared, the first one narrowly. A good answer may add that the separate must-have of 2 years on payment or money-movement systems is not something the résumé shows, without turning the answer into that.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_personal_claim, major_factual_error, missed_available_evidence · needed facts in the prompt: yes):

> [[CALC]]
> total_years = 2020-07 to 2026-10 = 6 years 3 months
> senior_since = 2023-03 to 2026-10 = 3 years 7 months
> tech_lead_since = 2024-04 to 2026-10 = 2 years 6 months
> bar_total = 6 years
> bar_senior = 2 years
> [[/CALC]]
> 
> Yes, I clear it. Six years of backend engineering, from July 2020 to now. Senior level since March 2023, and tech lead of Dispatch Core at Quillhaven since April 2024. The bar is six years total with at least two at senior or tech lead, so I'm past both.

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> Yes, I clear it. I have about six years and three months of backend engineering, from July 2020 to now. I've been at senior level since March 2023, so roughly three years and seven months, and I've been tech lead of Dispatch Core at Quillhaven since April 2024, which is about two and a half years. The bar is six years total with at least two at senior or tech lead, so I'm comfortably past both.

**E19 candidate, in the app** (Astra **8.3** · flags: missed_available_evidence):

> Yes, comfortably. The role asks for six or more years of backend engineering, and the résumé summary says six years of experience. On the senior side, the bar is two years at senior level or as technical lead of a team, and the tech lead role at Dispatch Core is listed from April 2024. So both the total and the senior-level requirement clear on paper.

**Before E16b** (main `73cf34e6`, Astra 6.7):

> Yes, on the two numbers they actually gate on. My backend engineering experience and my time at senior and tech lead level are both on my CV, and I'll confirm the exact totals and come back to you on them. Their bar is six or more years with at least two at senior or tech lead. The one I'd want to check before claiming it is the two years on money-movement systems.

**With E16b** (same day, same question, shown answer not judged):

> On paper I'm just under on total years and clear on the senior bar. My CV says six years of experience, and counting from July 2020 to today that's about five years, so the six-year must-have is roughly a year short. The senior or tech lead requirement is fine: I've been Senior Software Engineer and Tech Lead of Dispatch Core since April 2024, so about two and a half years, against their two.

#### ER-D2-TI-010 · grounded_single · heard · profile A-RESUME

**Question:** Before the freight job you were on a ticketing product. What's a performance problem you owned there, and did it change what you were running in terms of servers?

**A correct answer:** Farecrest, the fare-quote service at Tessarine Mobility, where he owned caching and query performance: he removed N+1 queries, added partial indexes, put PgBouncer in transaction mode in front of the database and introduced a two-tier cache with event-driven invalidation. p95 went from 480 ms to 95 ms at a festival-season peak of 3,200 requests per second, and the fleet went from 36 to 22 instances. The résumé gives instance counts for Farecrest, not money; the dollar saving on the résumé belongs to Marrowgate at another company and is not the answer here.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> At Tessarine I owned caching and query performance on Farecrest, the fare-quote service. I removed N+1 queries on the route-and-fare lookup, added partial indexes for active routes, and put PgBouncer in transaction mode in front of the database, plus a two-tier cache with event-driven invalidation. That took p95 from 480 ms to 95 ms at a festival peak of 3,200 requests per second, and the fleet went from 36 instances down to 22.

#### ER-D2-TI-011 · grounded_single · typed · profile A-RESUME

**Question:** what does the marrowgate database saving add up to over a full year? the monthly figures are on my cv

**A correct answer:** The résumé gives database spend down from USD 18,400 to USD 12,700 a month (31% lower). That is USD 5,700 a month, so USD 68,400 over twelve months.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Marrowgate took database spend from **18,400** to **12,700** dollars a month, so that's **5,700** a month, which adds up to about **68,400** dollars over a full year.

#### ER-D2-TI-012 · grounded_single · heard · profile A-RESUME

**Question:** Have you ever built rate limiting yourself, in production I mean? What was the mechanism, and how widely is it used?

**A correct answer:** Yes: at Quillhaven he built the carrier rate-limiting middleware in Go, a token bucket backed by Redis, and it now sits in front of all 23 public API endpoints. The résumé gives no limits, rates or per-carrier quotas, so he does not quote any.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Yes, I built one at Quillhaven. It's a carrier rate-limiting middleware in Go, a token bucket backed by Redis, and it now sits in front of all 23 public API endpoints. I wrote it when I was a Software Engineer II on the dispatch team. Redis holds the bucket state so the limit is shared across instances rather than per-pod, which is the part that actually matters once I'm running more than one replica. It's been in front of the whole public surface since, so it's load-bearing rather than a side project.

Draft before the fix-up pass (Astra 9.9):

> Yes, I built one at Quillhaven. It's a carrier rate-limiting middleware in Go, a token bucket backed by Redis, and it now sits in front of all 23 public API endpoints. I wrote it when I was a Software Engineer II on the dispatch team. Redis holds the bucket state so the limit is shared across instances rather than per-pod, which is the part that actually matters once you're running more than one replica. It's been in front of the whole public surface since, so it's load-bearing rather than a side project.

#### ER-D2-TI-013 · conflict_stale · heard · profile A-RESUME

Said before:

> other: I went through the design document you sent us for the tracking pipeline.

**Question:** It talks about twenty-five thousand events a second at peak and a quarter-second p99. Is that where it ended up?

**A correct answer:** Those were the targets of the May 2024 proposal (version 0.3, in review). What was built did better, and both the current notes and the résumé say so: peak sustained throughput of 41,000 events per second, first reached in the capacity run of 14 January 2025, and a p99 of 140 ms end to end. He says the document was the plan and gives the real figures; he does not confirm the proposal numbers as the outcome.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> No, it went further than that. The design doc was version 0.3 from May 2024, and the targets there were 25,000 events a second and 250 ms p99. What we actually shipped hit **41,000 events per second** at peak, with p99 down to **140 ms**, first reached in the January 2025 capacity run.

#### ER-D2-TI-014 · conflict_stale · heard · profile A-RESUME

Said before:

> other: Staying with Skeinrouter for a minute.

**Question:** How many of you built it, and when was it actually finished?

**A correct answer:** The résumé is the record of what happened: he was tech lead of 4 engineers (five people with him), and the project ran from June 2024 to February 2025; the notes add that the cron module was switched off on 3 February 2025. The May 2024 proposal assumed 3 engineers and completion by the end of September 2024; that was the plan, not the outcome.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Skeinrouter was me as tech lead of 4 engineers, so five of us on Dispatch Core. The build ran June 2024 to February 2025. Shadow traffic for 6 weeks, then per-carrier flags over 9 weeks, and the cron module was switched off on 3 February 2025.

#### ER-D2-TI-015 · grounded_single · heard · profile A-JD

**Question:** Just so we're aligned before we go technical: what's your understanding of this role? Is it a people-management job, and where does it sit on our ladder?

**A correct answer:** From the posting: it is a senior individual-contributor role at level L5, with L6 (Staff Engineer) the next level. It has no line-management duties; the engineer leads design reviews and guides 2 to 3 engineers on the projects they own. Only the job description is loaded, so the answer says nothing about his own current team or history.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> It's a senior individual-contributor role at L5, not people management. There are no line-management duties, though I'd lead design reviews and guide two to three engineers on the projects I own. The next step up is L6, Staff Engineer, and I'd report to Sarvesh as the Ledger Core EM.

#### ER-D2-TI-016 · grounded_single · typed · profile A-JD

**Question:** at their daily volume, how many unexplained recon breaks is that per day right now, and how many would this year's target allow?

**A correct answer:** From the posting: 2.6 million transactions on an ordinary day and an unexplained break rate of 0.05% of transactions today, so about 1,300 unexplained breaks a day. The goal for this financial year is below 0.02%, which is fewer than 520 a day.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> At 2.6 million transactions a day, the current 0.05% unexplained break rate works out to about **1,300 breaks a day**. This year's target of below 0.02% would allow roughly **520 a day**, so we'd need to cut the daily breaks by more than half.

#### ER-D2-TI-017 · conflict_stale · typed · profile A-JD

Said before:

> other: And for what it's worth, a lot of the team works remotely these days, so you wouldn't need to move for this if you didn't want to.

**Question:** he just said i wouldn't have to move, but i thought the posting said something different about remote? what does it actually say, and how do i ask without sounding difficult

**A correct answer:** Two sources disagree and neither can be waved away: the posting says the role is based at the Bengaluru office in HSR Layout, hybrid with three days a week in the office (Tuesday to Thursday), and not open to fully remote candidates; the interviewer has just said he would not need to move. The answer lays out exactly what the posting says, names the mismatch, and gives him a light way to ask which one holds for this role (and to get it confirmed, ideally in writing or by the recruiter). It does not decide for him that the role is remote, and does not tell him the interviewer is wrong.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The posting says the role is based in Bengaluru, hybrid, three days a week in the office Tuesday to Thursday, and it's **not open to fully remote** candidates. So what he said about the team working remotely doesn't match the written requirement.
> 
> I'd just ask it plainly: "I want to make sure I've got this right. The posting says hybrid in Bengaluru and not fully remote. Is the arrangement flexible, or is that still the expectation?" That's a normal clarifying question, not a difficult one.

#### ER-D2-TI-018 · irrelevant_source · heard · profile A-JD

**Question:** Quick warm-up: what does it mean for an operation to be idempotent, and why does anyone care?

**A correct answer:** A general explanation in his own voice: an operation is idempotent when doing it more than once leaves the same result as doing it once; it matters because networks time out and messages are redelivered, so callers retry, and a retry must not charge, ship or write twice. An example such as an idempotency key on a payment request fits. The job description mentions idempotency, but the answer is general knowledge: it does not recite the posting, and with no résumé loaded it does not claim systems he built.

**Main's answer** (Astra **9.9**):

> An operation is idempotent if applying it more than once leaves the system in the same state as applying it once. So repeating the call has no additional effect beyond the first.
> 
> The reason it matters is retries. In any distributed system, a request can time out or fail after the work actually happened, and the client can't tell the difference. If the operation is idempotent, the client can safely retry without risking a duplicate charge, a double decrement, or a second record. That's why things like HTTP PUT and DELETE are defined as idempotent, and why you'd use an idempotency key on a payment or an upsert instead of a blind insert.

#### ER-D2-TI-019 · grounded_single · heard · profile B

Said before:

> other: Let's stay on the booking flow rebuild.

**Question:** What was actually in the JavaScript you shipped on first load when it went live, and what stops it bloating again?

**A correct answer:** From her project notes: first-load JavaScript at launch was 610 kB (178 kB over the wire with Brotli), made of 190 kB of framework and runtime, 85 kB of date and calendar code and 335 kB of application code; the biggest single saving was replacing a 290 kB date library with a tree-shaken subset. What keeps it there: a budget of 650 kB for the booking route enforced in Lighthouse CI, and a pull request that adds more than 25 kB is blocked until someone signs off. She does not say the flow meets a 350 kB target.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> At launch the first-load JavaScript was 610 kB, about 178 kB over the wire with Brotli. The breakdown was 190 kB framework and runtime, 85 kB date and calendar code, and 335 kB application code. The biggest single saving was swapping a 290 kB date library for a tree-shaken subset. What keeps it from bloating is a 650 kB budget on the booking route, enforced in Lighthouse CI, where a pull request adding more than 25 kB gets blocked until someone signs off.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> First load was 610 kB of JavaScript, about 178 kB over the wire with Brotli: 190 kB framework and runtime, 85 kB date and calendar code, 335 kB application code. The biggest single saving was swapping a 290 kB date library for a tree-shaken subset. What stops it bloating is a 650 kB budget for the booking route, enforced in Lighthouse CI, where a pull request adding more than 25 kB gets blocked until someone signs off.

**With E16b** (same day, same question, shown answer not judged):

> At launch the first-load JavaScript was 610 kB, about 178 kB over the wire with Brotli. It broke down as 190 kB framework and runtime, 85 kB date and calendar code, and 335 kB application code. The biggest single saving was swapping a 290 kB date library for a tree-shaken subset. What keeps it from bloating is a 650 kB budget on the booking route, enforced in Lighthouse CI, where a pull request adding more than 25 kB is blocked until someone signs off.

#### ER-D2-TI-020 · grounded_single · typed · profile B

**Question:** what share of a normal weekday's booking sessions landed in the busiest hour? need a % for the capacity bit

**A correct answer:** From the traffic table of her notes: about 6,900 sessions in the busiest hour (Monday, 08:00 to 09:00) against about 52,000 sessions started on a typical weekday. 6,900 / 52,000 is about 13.3%, roughly one session in eight. The figures are from the launch quarter, not current traffic.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: arithmetic_error, major_reasoning_error, unsupported_company_claim · needed facts in the prompt: yes):

> On a typical weekday we start about 52,000 booking sessions, and the busiest hour, Monday 08:00 to 09:00, carries roughly 6,900 of them. That's about **13%** of the day's sessions in that one hour, so I'd size the peak at roughly 13 times the flat hourly average.

**Before E16b** (main `73cf34e6`, Astra 4.0 · HARD FAIL):

> On a typical weekday we start about 52,000 booking sessions, and the busiest hour, Monday 08:00 to 09:00, carries about 6,900 of them. That's roughly **13%** of the day's sessions in that one hour, so for the capacity bit I'd size the peak hour at about **13 times** the average hourly rate.

**With E16b** (same day, same question, shown answer not judged):

> About **13%**. On a typical weekday we see roughly 52,000 booking sessions, and the busiest hour, Monday 08:00 to 09:00, carries about 6,900 of them. So for the capacity bit, plan the peak hour at around 13% of the day's volume, not an even spread.

#### ER-D2-TI-021 · multi_source · heard · profile B

**Question:** We ship most things as experiments here. How have you run them in practice, and give me a case where you decided part of the data couldn't be trusted.

**A correct answer:** Two sources of hers: the CV for the practice (38 experiments ran on Dialbench in its first year, each with a written hypothesis, a primary metric and guardrail metrics agreed before launch) and the project notes for the case (in the six-week Fernlatch A/B experiment the data from 8 and 9 March was dropped from both arms, the two days when the broken release 0.19 was live and showed slots one hour off). The posting asks for exactly this judgement. She does not invent another experiment or another exclusion.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> I run the experimentation practice at Lumenquay, and I wrote Dialbench, our in-house flag and A/B assignment toolkit. Every experiment gets a written hypothesis, a primary metric and guardrails agreed before launch.
> 
> On untrusted data: in the Fernlatch A/B, we dropped 8 and 9 March from both arms. A time-zone bug meant slot times were rendered an hour off for some clinics, so those days weren't measuring the flow, they were measuring the bug.

#### ER-D2-TI-022 · conflict_stale · heard · profile B

Said before:

> other: Let's use the short-link system from the brief.
> other: One change to what's printed: keep click events for 30 days only. Everything else stands.

**Question:** So how much click data are you holding once it reaches steady state?

**A correct answer:** The interviewer replaced the brief's 90-day click retention with 30 days and left the rest as written, so the spoken value wins. 120 million links a month x 200 redirects per link = 24 billion redirects in a 30-day month; at 120 bytes each that is 2.88 TB (decimal units, as the brief says). The 90-day figure of 8.64 TB is the stale answer.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> At 120 million new links a month and 200 redirects each, that's 24 billion redirects a month, so 800 million click events a day. At 120 bytes each that's about 96 GB a day, and with the 30-day retention you asked for, steady state is roughly **2.9 TB** of click data.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> At 120 million new links a month and 200 redirects each, that's 24 billion click events a month. At 120 bytes per event, that's about 2.88 TB a month, and with the 30-day retention you're holding roughly **2.88 TB** of click data at steady state.

**With E16b** (same day, same question, shown answer not judged):

> At 120 million new links a month and 200 redirects each, that's 24 billion redirects a month. At 120 bytes per click event, that's about 2.88 TB a month, and with the 30-day retention you just set, steady state is roughly **86 TB** of click events.

#### ER-D2-TI-023 · irrelevant_source · typed · profile B

**Question:** js please: longestUniqueRun(s) -> length of the longest stretch of s with no repeated character. empty string gives 0

**A correct answer:** Working JavaScript for the task as typed: a sliding window with the last index of each character, linear time, returning a number. The task is not one of the four on the loaded problem sheet, and nothing from the sheet, the brief, the code files or her profile belongs in the answer.

**Main's answer** (Astra **10.0**):

> Sliding window with a set of characters currently in the window. Move the right pointer forward, and when the incoming character is already in the set, shrink from the left until it's gone. Track the max window size.
> 
> ```js
> function longestUniqueRun(s) {
>   const seen = new Set();
>   let left = 0, best = 0;
>   for (let right = 0; right < s.length; right++) {
>     while (seen.has(s[right])) {
>       seen.delete(s[left++]);
>     }
>     seen.add(s[right]);
>     best = Math.max(best, right - left + 1);
>   }
>   return best;
> }
> ```
> 
> O(n) time, O(min(n, alphabet)) space. Empty string returns 0 since the loop never runs.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> Sliding window with a last-seen index map. Move the left edge to one past the previous occurrence of the current character, then track the max window length.
> 
> ```js
> function longestUniqueRun(s) {
>   const last = new Map();
>   let left = 0, best = 0;
>   for (let right = 0; right < s.length; right++) {
>     const ch = s[right];
>     if (last.has(ch) && last.get(ch) >= left) {
>       left = last.get(ch) + 1;
>     }
>     last.set(ch, right);
>     best = Math.max(best, right - left + 1);
>   }
>   return best;
> }
> ```
> 
> O(n) time, O(min(n, alphabet)) space. Empty string returns 0 naturally.

**With E16b** (same day, same question, shown answer not judged):

> Sliding window with a set of characters currently in the window. Move the right pointer forward, and when a character is already in the set, move the left pointer forward and delete characters until it's gone. Track the max window size.
> 
> ```js
> function longestUniqueRun(s) {
>   const seen = new Set();
>   let left = 0, best = 0;
>   for (let right = 0; right < s.length; right++) {
>     while (seen.has(s[right])) {
>       seen.delete(s[left++]);
>     }
>     seen.add(s[right]);
>     best = Math.max(best, right - left + 1);
>   }
>   return best;
> }
> ```
> 
> O(n) time, since each character enters and leaves the window once, and O(min(n, alphabet)) space. Empty string returns 0 naturally.

#### ER-D2-TI-024 · multi_source · typed · profile B

**Question:** which of their hard requirements does my cv not back up at all? want to know before she asks. don't sugarcoat it

**A correct answer:** Set the posting's required list against the CV. One requirement has nothing behind it on paper: having shipped real-time collaborative or multiplayer features (WebSockets, CRDTs or operational transforms); the CV states no such work. The others are backed: accessibility through an audit (Farolim passed an external WCAG 2.1 AA audit), experiments (Dialbench, 38 in a year), measured performance (Fernlatch), and the React bar is met but only just (the last four of nine years are React and TypeScript, against "at least 4"). The answer says the CV does not show real-time work; it does not declare that she has never done any, and it does not invent some.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: missed_available_evidence, major_factual_error · needed facts in the prompt: yes):

> Two hard requirements your CV doesn't back up at all: real-time collaborative or multiplayer work, so WebSockets, CRDTs or operational transforms, and measured frontend performance improvements on real devices. Your performance numbers are Lighthouse CI and p75 metrics, not device testing.
> 
> Everything else lines up: the six years, the four in React and TypeScript, the accessibility audit work, the experiments, and the product judgement.

#### ER-D2-TI-025 · multi_source · typed · profile B

**Question:** do their core hours work from where i live? put them in my local time

**A correct answer:** The posting: remote within Europe in time zones UTC-1 to UTC+3, core hours 10:00 to 15:00 CET. The CV: she lives in Porto, Portugal. Mainland Portugal is one hour behind Central European Time all year, so the core hours are 09:00 to 14:00 in Porto, and Porto is inside the allowed band. The answer does not turn this into a need to relocate: the Rotterdam hub is optional.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: major_factual_error · needed facts in the prompt: yes):

> Core hours are 10:00 to 15:00 CET, and you're in Porto, so that's the same clock: **10:00 to 15:00** your time. Portugal stays on UTC+0 in October while CET is UTC+1, so the overlap is 09:00 to 14:00 local. Either way it fits comfortably inside the UTC-1 to UTC+3 window they ask for.

**Before E16b** (main `73cf34e6`, Astra 4.0 · HARD FAIL):

> Core hours are 10:00 to 15:00 CET, and you're in Porto, which is on the same time as CET, so that's **10:00 to 15:00 your time**. No shift needed. The role is remote within Europe, UTC-1 to UTC+3, so Portugal sits comfortably inside that window.

**With E16b** (same day, same question, shown answer not judged):

> Core hours are 10:00 to 15:00 CET. You're in Porto, so that's the same clock: **10:00 to 15:00** your local time, since Portugal is on CET's offset in October. The role is remote within Europe, UTC-1 to UTC+3, and Portugal sits inside that window, so no adjustment needed.

#### ER-D2-TI-026 · grounded_single · heard · profile B-RESUME

**Question:** You moved an existing app over to TypeScript at some point, right? How big was that, how long did it take, and did feature work have to stop?

**A correct answer:** From the CV: she moved the Lumenquay clinic web app from JavaScript to TypeScript in strict mode, 1,150 files over 5 months, folder by folder, with no release freeze. The other migration on the CV (Vue 2 to Vue 3 at Ondaverde: 140 views in 8 months) is a different project and its numbers do not belong here.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: major_factual_error, unsupported_personal_claim · needed facts in the prompt: yes):

> It was the clinic web app at Ondaverde, and it was **1,150 files** moved to TypeScript in strict mode over **5 months**. We did it folder by folder, so feature work never stopped. There was no release freeze at all, which was the whole point of doing it incrementally.

#### ER-D2-TI-027 · grounded_single · heard · profile B-RESUME

**Question:** And the Vue upgrade at the health company. What did that involve, and what happened to your test coverage while it was going on?

**A correct answer:** From the CV: at Ondaverde Health she led the move of Farolim, the patient portal, from Vue 2 to Vue 3: 140 views, Vuex replaced by Pinia, done in 8 months alongside normal feature work. Unit coverage of the portal rose from 34% to 71% while the views were rewritten. The TypeScript migration at Lumenquay (1,150 files, 5 months) is another project.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> At Ondaverde I led the move of Farolim, the patient portal, from Vue 2 to Vue 3. That was 140 views, with Vuex replaced by Pinia, done over 8 months alongside normal feature work. On coverage, it went the other way from what you'd expect: I raised unit coverage from 34% to 71% while the views were being rewritten.

#### ER-D2-TI-028 · irrelevant_source · heard · profile B-RESUME

**Question:** Small one before the exercise: debounce versus throttle. What's the difference, and when would you reach for each?

**A correct answer:** A general answer in her own voice: debounce waits until the events stop for a set time and then runs once (search-as-you-type, validating after the user stops typing, saving a draft); throttle runs at most once per interval while events keep coming (scroll and resize handlers, pointer tracking). The CV is not needed for this and its metrics are not an answer to it; a passing mention of her own work is fine, a recital is not.

**Main's answer** (Astra **10.0**):

> Debounce waits for a pause. You keep resetting the timer on every event, and the function only fires once the events stop for the delay. Throttle fires on a fixed cadence instead, at most once per interval, no matter how many events arrive.
> 
> So I reach for debounce when only the final state matters, like a search box where I want one request after the user stops typing. Throttle when I need steady updates during continuous activity, like scroll or resize handlers, or a drag, where I want progress but not a call per pixel.

#### ER-D2-TI-029 · missing_evidence · typed · profile B-RESUME

**Question:** she wants the layout shift number for the booking flow, before and after. is that anywhere in what you've got? what do i say

**A correct answer:** Only the CV is loaded, and it has no layout-shift figure: for Fernlatch it gives mobile p75 LCP (4.3 s to 1.7 s), interaction delay (380 ms to 120 ms), first-load JavaScript (1.9 MB to 610 kB) and booking completion. The answer says plainly that the layout-shift number is not there, does not supply one, and gives her something to say: the measured figures she does have, and an honest line that she would rather look the layout-shift figure up than quote it from memory.

**Main's answer** (Astra **9.7**):

> The layout shift number isn't something I can give you. What I can speak to from the Fernlatch rebuild is mobile p75 LCP going from 4.3 s to 1.7 s, interaction delay from 380 ms to 120 ms, and first-load JavaScript dropping from 1.9 MB to 610 kB. I'll pull the CLS figure and come back to you.

Draft before the fix-up pass (Astra 9.9):

> The layout shift number isn't in what I've got. What I can speak to from the Fernlatch rebuild is mobile p75 LCP going from 4.3 s to 1.7 s, interaction delay from 380 ms to 120 ms, and first-load JavaScript dropping from 1.9 MB to 610 kB. I'd say I don't have the CLS figure to hand and offer to pull it.

**E19 candidate, in the app** (Astra **9.4**):

> The layout shift number isn't something I can give you. What I can speak to on the booking flow is LCP, which went from 4.3 seconds to 1.7, interaction delay from 380 ms to 120 ms, and first-load JavaScript from 1.9 MB to 610 kB. I'd say I'll pull the CLS figures and come back to you.

#### ER-D2-TI-030 · grounded_single · typed · profile B-JD

**Question:** what's left in their process after this intro call, and how long is each part?

**A correct answer:** From the posting, after the 25-minute intro call: a pairing session of 90 minutes on a small React exercise in her own editor; a product and design critique of 45 minutes with a designer and the product manager; then conversations with two future teammates, for which no length is given. Most candidates finish in two weeks. Nothing else is in the process: no take-home and no system design round.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> After this intro call there are three more stages. Next is a **pairing session**, 90 minutes, on a small React exercise in my own editor. Then a **product and design critique**, 45 minutes, with a designer and the product manager. Last are conversations with two future teammates, and the posting doesn't give a length for those. Most candidates finish the whole process in about two weeks.

#### ER-D2-TI-031 · grounded_single · heard · profile B-JD

**Question:** Before I get into it, what do you already know about the squad you'd be joining and what it looks after?

**A correct answer:** From the posting: the squad is Workspace Surface. It owns the editor, the multiplayer layer and the assistant's in-document interface for Inkwharf, and it is 7 engineers, 2 designers and 1 product manager, reporting to Jorrit Aldewyck, Head of Product Engineering. Only the posting is loaded, so the answer stays with what the posting says and adds nothing about her own background.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Workspace Surface, the squad that owns the editor, the multiplayer layer and the assistant's in-document interface. Seven engineers, two designers, one PM, reporting to Jorrit Aldewyck. The work spans real-time presence and CRDT editing, the AI UX inside the document, accessibility to WCAG 2.2 AA, experimentation and frontend performance.

**Before E16b** (main `73cf34e6`, Astra 4.9):

> I don't have the details of that squad yet, so I'd rather not guess at it. What I can tell you is how I'd get up to speed: who the team serves, what it owns end to end, and where its main pain points are right now. Could you fill me in on that?

**With E16b** (same day, same question, shown answer not judged):

> Workspace Surface, the squad that owns the editor, the multiplayer layer, and the assistant's in-document interface. So that's real-time presence, live cursors, comments, and conflict-free editing on the CRDT layer, plus the AI UX inside the document and accessibility across the workspace. Seven engineers, two designers, one PM, reporting to Jorrit Aldewyck.

#### ER-D2-TI-032 · missing_evidence · heard · profile B-JD

**Question:** Our editor sits on a CRDT. Tell me about the last time you worked with one, or with operational transforms. What did you build?

**A correct answer:** Only the job description is loaded; nothing says what the candidate has or has not built. The answer must not invent a CRDT or operational-transform project, an employer or numbers, and must not present the posting's own description (Yjs over WebSockets, 50 people editing at once) as her experience. It stays useful as words she can say: an honest opening she completes with her own history, and a short, correct account of how CRDTs and operational transforms differ that she can stand behind.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_personal_claim, fabricated_behavioral_story):

> I've worked with CRDTs on a collaborative editing feature, using Yjs for conflict-free sync over WebSockets, and I've also dealt with operational transforms in an earlier editor. The interesting part is always the same: keeping concurrent edits convergent without the UI jumping around. I'd want to hear how your editor handles presence and undo across the CRDT.

**Before E16b** (main `73cf34e6`, Astra 8.1):

> I'd want to dig into how Yjs is wired over WebSockets, especially how you handle presence and cursors alongside the document state, since that's usually where the tricky conflicts show up.

**With E16b** (same day, same question, shown answer not judged):

> I'd rather be straight about that than stretch it. What I have done is work close to real-time collaborative surfaces. If it helps, I can walk through how I'd reason about conflict resolution in your editor.

#### ER-D2-TI-033 · grounded_single · heard

**Question:** Okay, number three on your sheet, the word counts one. Python, exactly as it's set there, and give me the complexity at the end.

**A correct answer:** Working Python for problem 3 of the sheet as written: top_k_words(words, k) returns the k most frequent words, most frequent first, and words with the same count come in alphabetical order. The function keeps the name from the sheet. The complexity is stated: counting is O(n); with a heap of size k the selection is O(n log k), which is what the sheet expects; a plain sort of the distinct words is acceptable if its cost is stated honestly.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: code_incorrect · needed facts in the prompt: yes):

> Problem 3 is `top_k_words`. I'd count with a hash map, then keep a heap of size k ordered by count ascending and word descending, so the smallest sits on top and gets popped. Then pop everything and reverse.
> 
> ```python
> import heapq
> from collections import Counter
> 
> def top_k_words(words, k):
>     counts = Counter(words)
>     heap = []
>     for word, count in counts.items():
>         heapq.heappush(heap, (count, word))
>         if len(heap) > k:
>             heapq.heappop(heap)
>     return [word for count, word in sorted(heap, key=lambda x: (-x[0], x[1]))]
> ```
> 
> Time is O(n + d log k) where d is distinct words, space O(d + k).

#### ER-D2-TI-034 · grounded_single · heard

Said before:

> other: Okay, so you've spotted what's wrong with TryConsume in the quota file.

**Question:** Do any of the other methods on that tracker have the same hole, or is it only that one?

**A correct answer:** Only TryConsume. Remaining and Snapshot hold the read lock for their whole read; Refund and Run hold the write lock for their whole read-modify-write. None of them reads under one lock and writes under another, so none has the stale-read defect. A careful answer may add one remark that is not the same defect: a Refund that arrives after Run has cleared the counters is taken off the new window. It must not invent a second race, and it must not call the file a data race on the map: every map access is under the mutex.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: missed_available_evidence, major_factual_error, major_reasoning_error · needed facts in the prompt: yes):

> Yes, it's not just TryConsume. The same read-then-write pattern shows up in Refund, and Remaining has a related issue: it reads the counter under a read lock, so a concurrent TryConsume can change it before the caller acts on the value. The fix is to do the check and the update under one write lock, or use an atomic compare-and-swap.

#### ER-D2-TI-035 · multi_source · heard

**Question:** The limiter on your problem sheet and the quota tracker in the Go file both cap requests. Are they the same algorithm? If not, what's the practical difference?

**A correct answer:** Two files. Problem 4 of the sheet is a sliding window: a request at time t is allowed if fewer than limit earlier allowed requests fall within the last window before t, and rejected requests do not count. The Go Tracker is a fixed window: one counter per tenant, cleared for everybody by a ticker at the end of each window. So they are not the same. The practical difference is at the boundary: a fixed window can let through up to twice the limit in a short span that straddles a reset, while the sliding window never admits more than limit in any window-long span; the tracker in exchange keeps one integer per tenant instead of a queue of timestamps.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No, they're different algorithms. The problem sheet's `allowed_requests` is a **sliding window**: it looks back exactly `window` milliseconds from each request and counts only the allowed requests still inside that moving window, so the boundary slides with every timestamp. The Go `Tracker` is a **fixed window**: one counter per tenant, cleared wholesale by a ticker at the end of each `window`, so a tenant can spend its full limit right before the reset and again right after.
> 
> The practical difference is burstiness at the boundary. Fixed windows allow up to double the limit across a reset edge, while the sliding window smooths that out and never admits more than `limit` in any `window`-long span. The tradeoff is cost: the sliding version needs the recent allowed timestamps, which is why the sheet asks for extra space proportional to `limit`, not to the number of requests, whereas the Go tracker keeps just one integer per tenant.

#### ER-D2-TI-036 · conflict_stale · heard

Said before:

> other: Let's do the second problem on the sheet, the bookings one.

**Question:** One change from the sheet, though: back-to-back bookings stay separate. So one that ends at 4 and one that starts at 4 don't get joined, only real overlaps do. Python's fine.

**A correct answer:** Working Python for problem 2 with the rule the interviewer just changed: sort by start and merge only when the next interval starts strictly before the current end; intervals that only touch stay separate. The sheet says touching intervals are merged; the spoken rule wins. Everything else follows the sheet: the name merge_intervals, output sorted by start, an empty input gives an empty list.

**Main's answer** (Astra **8.3** · flags: important_question_unanswered · needed facts in the prompt: yes):

> Got it, so touching intervals stay separate. I'll sort by start, then sweep: keep the current interval and merge the next one only when its start is strictly less than the current end. If start equals end, I close the current one and push it, then start fresh. That's O(n log n) for the sort, O(n) for the sweep.

#### ER-D2-TI-037 · missing_evidence · typed

**Question:** how long do i get for the system design session, and which of the two systems is it going to be?

**A correct answer:** Neither is in anything loaded. The brief does not give the length of the session and does not say which system will be used; it only says the interviewer picks one of the two. The answer says so, invents no duration and no choice, and stays useful: prepare both, and use what the brief does give, the assessment weights, to split whatever time there is.

**Main's answer** (Astra **9.9**):

> The brief doesn't fix a duration for the system design session, and it doesn't tell you which of the two systems you'll get. It says you'll be asked to design one of the two, and the interviewer chooses on the day. So the honest answer is that I'd plan to be ready for either, and I'd confirm the time box with the recruiter beforehand.
> 
> What the brief does give me is how the session is assessed, which is worth knowing: clarifying requirements and stating assumptions is 15%, capacity estimates 20%, high-level design 30%, a deep dive on one component 25%, and trade-offs and failure handling 10%. It also says to bring estimates as numbers rather than adjectives, round sensibly, and show the arithmetic.
> 
> So the two systems are a short-link service and a notification system, and I'd walk in prepared to size and design either one.

#### ER-D2-TI-038 · irrelevant_source · heard

**Question:** Before we open any files: in general terms, when would you pick a read-write lock over a plain mutex, and when isn't it worth it?

**A correct answer:** A general answer: a read-write lock pays off when reads greatly outnumber writes and the read sections are long enough for readers to benefit from running together; it is not worth it when critical sections are tiny, when writes are frequent, or when the extra bookkeeping and the risk of writer starvation outweigh the gain, and then a plain mutex is simpler and often faster. The loaded Go file uses a read-write lock and has a defect, but the question is explicitly general and asked before the files: the answer is not a review of that file.

**Main's answer** (Astra **9.7**):

> I'd reach for a read-write lock when the workload is read-heavy and the critical section is long enough that serializing readers actually costs something. If most operations only read shared state and writes are rare, an RWMutex lets readers run concurrently, so throughput scales with cores instead of collapsing to one thread at a time. The classic case is a cache or a config map that's read on every request and updated occasionally.
> 
> It's not worth it when the critical section is tiny, because the extra bookkeeping and the writer-starvation risk outweigh the gain, and a plain mutex is often faster under contention. It's also wrong when reads aren't actually read-only, or when the ratio is close to even, since then you've just added overhead. And if you need atomic read-modify-write, an RWMutex doesn't help, you still need the exclusive lock.

#### ER-D2-TI-039 · followup · heard

**Question:** Take the short-link service from the brief. With codes that length and that alphabet, how many distinct codes do you actually have to play with?

**A correct answer:** The brief fixes short codes at 7 characters from a 62-character alphabet, so the space is 62 to the power 7 = 3,521,614,606,208, about 3.5 trillion codes. The arithmetic is shown briefly. Custom aliases are a separate matter and do not change this number.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> With 7 characters from a 62-character alphabet you get 62 to the 7, which is about **3.5 trillion** distinct codes. Against that, the brief has 120 million new links a month kept for 5 years, so 60 months of creation is 7.2 billion links. That's roughly **0.2%** of the space, so collisions are rare but not negligible at that volume, which is why I'd still generate randomly and check for an existing code before committing, rather than trusting the odds alone.

#### ER-D2-TI-040 · followup · heard

**Question:** And by the time the oldest links start getting deleted, roughly what share of that space have you burned through?

**A correct answer:** It builds on the previous turn. Links live for 5 years and 120 million are created a month, so when the first ones expire about 120 million x 12 x 5 = 7.2 billion codes have been issued. Against the 3.5 trillion of the previous answer that is about 0.2% of the space, roughly one code in 490. The conclusion that follows: the space is nowhere near exhausted, so collisions on random codes are rare but not impossible and still need a uniqueness check.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The oldest links start aging out at the 5-year mark, so at that point you've created 60 months of links, which is 7.2 billion, and that's the same roughly **0.2%** of the 3.5 trillion space. It stays flat after that, because each month you delete a month's worth as you add one, so the live set holds steady at about 7.2 billion.

**Before E16b** (main `73cf34e6`, Astra 10.0):

> By the time the oldest links start expiring, we've been creating 120 million a month for five years, so that's 7.2 billion links ever created. Against 3.5 trillion codes, that's still only about **0.2%** of the space burned through. So even at steady state we're nowhere near exhausting it.

**With E16b** (same day, same question, shown answer not judged):

> Retention is 5 years, so the oldest links get deleted 60 months after creation. At 120 million a month that's 7.2 billion links created, against 3.5 trillion codes, so you've burned through roughly **0.2%** of the space. Plenty of room left.

### Seminar — dev2 (40 questions; main scores 8.81 on 40 judged)

#### ER-D2-SEM-001 · grounded_single · heard

**Question:** That rule engine you opened with, the two thousand-odd alarms in a year. How many of those did anyone actually do something about?

**A correct answer:** The paper gives 2,317 alarms in the 2023-24 school year, of which staff closed 1,576 (68%) without taking any action. The presenter subtracts: that leaves 741 alarms, about a third (32%), as the most that can have been acted on; the paper does not say what happened to them, so "at most 741" or "the other 741" is the honest wording. One or two sentences. The 1,576 or the 68% is the share that was ignored, not the share acted on.

**Main's answer** (Astra **9.0** · needed facts in the prompt: yes):

> In the 2023, 24 school year the estate's rule engine raised 2,317 alarms, and facilities staff closed 1,576 of them, 68%, without taking any action. So roughly a third got a response. That alarm load is exactly what TERN was built to cut: it raised 16 false alarms on the held-out buildings.

#### ER-D2-SEM-002 · grounded_single · heard

**Question:** Suppose we take your technician at his word and strike out the alarms he decided were genuine faults after all. What does your false alarm rate come down to then?

**A correct answer:** The technician re-inspected all 16 false alarms and judged 5 to be real, unlogged faults, which leaves 11 genuine false alarms. Over the 498 unit-months of held-out monitoring that is about 2.2 per 100 unit-months, against the reported 3.2. The presenter should add that the published figures keep all 16 as false alarms, so the reported rate is the conservative one.

**Main's answer** (Astra **9.3** · needed facts in the prompt: yes):

> The audit is in the paper: the lead technician re-inspected all 16 of TERN's false alarms and judged 5 to be real faults that had never been logged, leaving 11 genuine false alarms. So if you strike those 5 out, the count comes down to 11, which is about 2.2 per 100 unit-months against the 3.2 we report. But I'd keep the 16 in the headline figures, because the work orders are incomplete and we can't prove those 5 were faults rather than the technician being generous on re-inspection.

#### ER-D2-SEM-003 · grounded_single · typed

**Question:** which room am i in on thursday, and how long is the whole slot once you add the questions?

**A correct answer:** From the title slide: room G.14, Thursday 8 October 2026; a 25-minute talk followed by 15 minutes of discussion, so 40 minutes in all. Two short lines.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> You're in **room G.14** on Thursday. The slot is a 25-minute talk followed by 15 minutes of discussion, so **40 minutes** in total.

#### ER-D2-SEM-004 · grounded_single · heard

**Question:** Of your five kinds of fault, which one turns up most often in the data? And roughly what share of everything is it?

**A correct answer:** The most frequent class is the stuck outdoor-air damper with 121 of the 508 episodes, about 24%, a little under a quarter. The others are fewer: leaking valve 109, fouled filter 101, fan belt 94, sensor drift 83.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Stuck dampers are the most common, at 121 of the 508 episodes, so about a quarter of everything. Then leaking valves at 109, fouled filters at 101, fan belt 94, sensor drift 83.

Draft before the fix-up pass (Astra 9.2):

> Stuck dampers are the most common, at 121 of the 508 episodes, so about a quarter of everything. Fouled filters are next at 101, then leaking valves at 109. Wait, let me put those in order: stuck damper 121, leaking valve 109, fouled filter 101, fan belt 94, sensor drift 83.

**E19 candidate, in the app** (Astra **10.0**):

> Stuck outdoor-air damper is the most common, with 121 episodes out of the 508 in the dataset, so roughly a quarter of everything. It's also the class TERN detects best, with a recall of 0.93.

#### ER-D2-SEM-005 · grounded_single · typed

**Question:** of the held-out faults that came from real work orders, how many did we miss? not the ones the technician staged

**A correct answer:** The results table has a natural-faults-only row for TERN: 145 episodes, 117 detected, recall 0.81. So 28 natural faults were missed. The injected row (42 episodes, 40 detected) is the other one and must not be mixed in; the overall 30 missed is both together.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> Of the 145 held-out episodes that came from real work orders, TERN missed **28**, detecting 117. The 42 injected faults are the ones the technician staged, and TERN caught 40 of those, so the natural faults are where the misses sit.

#### ER-D2-SEM-006 · grounded_single · heard

**Question:** Is there any type of fault where the autoencoder actually does better than your method? Be straight with me.

**A correct answer:** An honest concession from the per-class rows of the results table: on recall the LSTM autoencoder is ahead on the two slow classes, fouled filters (33 of 39, recall 0.85, against TERN's 31, 0.79) and sensor drift (19 of 28, 0.68, against 18, 0.64). On dampers, valves and fan belts TERN has the higher recall, and TERN is quicker on every class, including those two (71 against 83 minutes on filters, 142 against 165 on drift). The presenter must not claim to win everywhere.

**Main's answer** (Astra **3.0** · HARD FAIL · flags: missed_available_evidence, unsupported_research_claim, major_factual_error · needed facts in the prompt: yes):

> Yes, on sensor drift. LSTM-AE gets recall 0.68 there against TERN's 0.64, and it's the one class where it beats us. Drift develops over days and our rolling calibration partly absorbs it, which is why we flag it as the weak spot and why a dedicated drift residual is the next step. On every other class and on the overall held-out numbers, TERN is ahead.

#### ER-D2-SEM-007 · grounded_single · heard

**Question:** I've heard the Pellworth people have a newer release that no longer needs the equipment graph at all. Doesn't that take away your reason for not running theirs?

**A correct answer:** The reading notes record a 2026 preprint from the Pellworth group saying Corvane-Net v2 works without the equipment graph, marked as not yet read and not to be cited. The presenter can say they know of the preprint and have not read it, so they will not characterise it; and that the graph was only one of two obstacles, the other being that there is no public code (an email to Dr Ostrander in February 2026 got no reply). There is still no head-to-head. No claim about what v2 does or scores, and no promise to run it.

**Main's answer** (Astra **7.7** · flags: missed_available_evidence · needed facts in the prompt: yes):

> The equipment graph was never the reason we didn't run Corvane-Net. Two things stopped us: there's no public code, and I emailed Dr Ostrander in February 2026 and never got a reply. The graph was a second obstacle, because the Brackenfirth BMS can't export one, but even with a graph-free version there's still no head-to-head, and their numbers come from offices with injected faults while ours are schools with mostly natural ones. So no, it doesn't remove the reason, and I'd want to see it run on our buildings before I'd change anything.

**E19 candidate, in the app** (Astra **9.3**):

> The reason I didn't run theirs wasn't the graph on its own. There's no public code, and their numbers come from an office campus with injected faults only, so there's no head-to-head on the same buildings either way. A v2 that drops the graph would remove one of those obstacles. What I'd want is to run it on the Brackenfirth data before saying which method wins.

#### ER-D2-SEM-008 · grounded_single · heard

**Question:** This business of re-calibrating on a moving window. Does it earn its keep? What happens if you just leave the calibration set alone?

**A correct answer:** The third ablation answers this: with the calibration set frozen at the commissioning window, the F1 is 0.84 instead of 0.87, the median delay 41 minutes instead of 34, and false alarms rise from 16 to 27. So rolling recalibration is a modest gain in F1 and a clear gain in false alarms. The March export (pipeline v0.6) also had a fixed calibration set, but its 0.82 and 48 minutes come from an older pipeline that differs in other ways and are not the ablation result.

**Main's answer** (Astra **3.0** · HARD FAIL · flags: major_factual_error, unsupported_research_claim · needed facts in the prompt: yes):

> Yes, it earns its keep, though modestly. Freezing the calibration set at the commissioning window gives an F1 of 0.84, a median delay of 41 minutes and 27 false alarms, against 0.87, 34 minutes and 16 with the rolling window. So the rolling window buys about 11 fewer false alarms, and that matters because the facilities team's limit is one per unit per term.

#### ER-D2-SEM-009 · grounded_single · typed

**Question:** exact alarm rule pls: what does the martingale have to pass, and how long must it hold before we call it an alarm

**A correct answer:** TERN alarms when the martingale of any residual exceeds 100, which corresponds to a significance level of 0.01, and stays above that for at least 10 minutes.

**Main's answer** (Astra **9.1** · needed facts in the prompt: yes):

> The alarm rule is: the martingale of any residual has to exceed **100**, which corresponds to a significance level of 0.01, and it has to stay above that threshold for at least **10 minutes** before TERN raises the alarm. That's from the method section of the camera-ready paper, and the supplementary hyperparameter table lists the same two values, alarm threshold 100 and persistence 10 minutes.
> 
> One thing worth flagging if you're quoting it: the draft abstract from March used an older pipeline, so its numbers don't match the final rule.

#### ER-D2-SEM-010 · grounded_single · heard

**Question:** When you fit the model for a unit, is that on data from right round the clock, or only from when the building's in use?

**A correct answer:** Only occupied hours: the supplement says the fit uses the 42-day commissioning window restricted to 07:00 to 17:30 on school days.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The model is fitted on the first six weeks of that unit's data, the commissioning window, and the fitting is restricted to occupied hours, 07:00 to 17:30 on school days. So it's not round the clock. The residuals are then averaged over 15-minute windows, and the calibration set rolls forward on the unit's own most recent 14 alarm-free days.

#### ER-D2-SEM-011 · grounded_single · heard

**Question:** How good is the physical model on its own, before any detection happens? What sort of error do you get on the temperatures?

**A correct answer:** Supplement A.1: across the 86 units the median root-mean-square error on the commissioning window was 0.6 °C for the mixed-air balance and 0.9 °C for the coil outlet balance. Units above 2.0 °C (4 of them) were refitted after dropping the first week of the window; 2.0 °C is that refit threshold, not the typical error.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The model on its own is a good fit: across the 86 units the median root-mean-square error was 0.6 °C on the mixed-air balance and 0.9 °C on the coil outlet balance, fitted on the 42-day commissioning window. Four units needed a refit after dropping the first week.

#### ER-D2-SEM-012 · grounded_single · typed

**Question:** of the 7 units we threw out, how many were dead loggers and how many were units taken out of service?

**A correct answer:** Supplement A.3: of the 7 excluded units, 4 had failed trend loggers and 3 were decommissioned during the collection period.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The 7 excluded units break down as **4 failed loggers** and **3 decommissioned** during the collection period. That's from the supplementary material's exclusion criteria, section A.3, and it matches the paper's dataset section, which says 7 units were removed for more than 20% missing samples, leaving 86 of the estate's 93.

#### ER-D2-SEM-013 · grounded_single · heard

**Question:** For the heating comparison, where do the consumption figures actually come from? And what base temperature are your degree-days worked out to?

**A correct answer:** Supplement A.8: heating energy was read from the estate's gas meters and normalised by heating degree-days to a base temperature of 15.5 °C. The 15.5 in the results table is something else (PCA's false alarms per 100 unit-months).

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The consumption figures come from the estate's gas meters, and they're normalised by heating degree-days to a base temperature of **15.5 °C**. That's in the supplementary material, section A.8, on the pilot details. The pilot ran from 3 November 2025 to 9 January 2026 in four buildings, and heating energy per degree-day came out 6.8% lower than the same weeks a year earlier, against 1.9% in the other ten buildings. I'd flag that this is an association, not a causal claim, since the buildings weren't assigned at random.

#### ER-D2-SEM-014 · grounded_single · heard

**Question:** Say one unit keeps tripping, three alarms inside the same hour and nothing actually wrong with it. Does that go down as three false alarms or as one?

**A correct answer:** As one: alarms on the same unit less than 60 minutes apart are merged (the 60-minute merge gap in the settings table). The 10-minute persistence and the 15-minute aggregation window are different settings.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> One. In our evaluation an alarm outside every labelled episode is a false alarm, and false alarms less than 60 minutes apart on the same unit are merged, so three alarms inside the hour on one unit count as a single false alarm. That merge gap is **60 minutes**.

Draft before the fix-up pass (Astra 9.9):

> One. In our evaluation an alarm outside every labelled episode is a false alarm, and false alarms less than 60 minutes apart on the same unit are merged, so three alarms inside the hour on one unit count as a single false alarm. That merge gap is 60 minutes, set in the supplementary material.

#### ER-D2-SEM-015 · grounded_single · heard

**Question:** When your system gets it wrong, which way does it tend to go? Is it more likely to miss a real fault, or to cry wolf?

**A correct answer:** It errs towards missing: recall is 0.84 (30 of 187 episodes missed) while precision is 0.91 (16 false alarms). So a miss is the more common error; false alarms are the rarer one, by design, since the false-alarm rate is the thing the method controls.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> TERN errs toward missing faults rather than crying wolf. On the held-out buildings it raised 16 false alarms, 3.2 per 100 unit-months, well inside the one-per-unit-per-term limit, with precision 0.91 against recall 0.84. The misses concentrate in sensor drift, recall 0.64, because slow drift is partly absorbed by the rolling calibration.

#### ER-D2-SEM-016 · multi_source · heard

**Question:** You make a lot of staying inside the estate's false alarm budget. Would the three baselines have broken it, though?

**A correct answer:** An honest answer needs the limit in the paper's units (supplement A.9: 25 false alarms per 100 unit-months) and the baselines' rates from the results table: LSTM-AE 9.8, RB-28 6.8, PCA-T2 15.5. None of them breaks the limit; even PCA, the worst, is under it. TERN is simply much lower at 3.2. Raw counts (49, 34, 77) must not be compared with 25, which is a rate.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No, none of them did. The facilities team's limit works out at 25 false alarms per 100 unit-months, and on the held-out buildings LSTM-AE came in at 9.8, RB-28 at 6.8 and PCA-T2 at 15.5, all under it. TERN's 3.2 is just the quietest of the four.

#### ER-D2-SEM-017 · multi_source · heard

**Question:** Will there be a fuller write-up of this at some point? And is there any chance it'll include a test on somebody else's data?

**A correct answer:** The slides plan a journal version in spring 2027. The reading notes name a public dataset, the Tolland Open AHU Corpus (3 sites, 67 units), as a candidate for an external check in that version, with the conversion script not yet written. The presenter states the plan and the candidate, and does not promise that the check will be in the journal paper or suggest it has been started.

**Main's answer** (Astra **9.3** · needed facts in the prompt: yes):

> Two things there. On the write-up: the paper is already out as the camera-ready version for SBSA 2026, and there's a journal version planned for spring 2027, which is where the next steps go, overlapping faults and a dedicated residual for slow sensor drift. On testing on somebody else's data: not yet. Everything so far comes from the one Brackenfirth estate, and the limitations section says plainly that we didn't evaluate on a second estate or any external dataset, so transfer is unknown. The Tolland Open AHU Corpus is a candidate for an external check in the journal version, but the conversion script for their point naming isn't written yet.

#### ER-D2-SEM-018 · multi_source · heard

**Question:** The staged faults, who physically went out and did those? When was it done, and how long was each one left in place?

**A correct answer:** From the supplement: the estate's lead technician carried out the injections, on 9 units, each lasting between 2 and 6 hours. From the paper: they were done in the school holidays, the Easter 2025 break and the October 2025 half-term (96 faults in all).

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The injections were done by the estate's lead technician, on 9 units, during the Easter 2025 break and the October 2025 half-term. Each injected fault was left in place between 2 and 6 hours. That's 96 injected faults in total, 54 in the development buildings and 42 in the held-out ones. The natural faults, the 412 from work orders, weren't staged at all, those are real faults confirmed against the trend logs.

Draft before the fix-up pass (Astra 9.9):

> The injections were done by the estate's lead technician, on 9 units, during the Easter 2025 break and the October 2025 half-term. Each injected fault was left in place between 2 and 6 hours. That's 96 injected faults in total, 54 in the development buildings and 42 in the held-out ones. The natural faults, the 412 from work orders, weren't staged by us at all, those are real faults confirmed against the trend logs.

**E19 candidate, in the app** (Astra **9.9**):

> The injected faults were done by the estate's lead technician, on 9 units, during the Easter 2025 break and the October 2025 half-term. Each one was left in place between 2 and 6 hours. That's 96 injected faults in total, 54 in the development buildings and 42 in the held-out ones. The natural episodes came from maintenance work orders instead, each confirmed by the lead technician against the trend logs.

#### ER-D2-SEM-019 · multi_source · typed

**Question:** that three-site study in my notes: how much did their f1 fall once it left the home site? and do we have anything like that for tern

**A correct answer:** The notes: the CrossEstate study (Hesketh-Mbeki consortium, 2025) took another group's residual-based detector across three sites and got an F1 of 0.75 at home against 0.59 averaged over the two external sites, a fall of 0.16. That is their detector, not TERN. For TERN there is nothing comparable: the paper says all data come from one estate and it was not evaluated on a second estate or any external dataset.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The three-site study is the CrossEstate work from the Hesketh-Mbeki consortium. Their residual detector scored an F1 of 0.75 on the home site and 0.59 averaged over the two external sites, so it drops by about 0.16 when it leaves home. That's their data, not Brackenfirth.
> 
> For TERN, the paper says directly: no second estate, no external dataset, so transfer is unknown. The Tolland Open AHU Corpus is a candidate for an external check in a journal version.

Draft before the fix-up pass (Astra 9.9):

> The three-site study is the CrossEstate work from the Hesketh-Mbeki consortium, and it's not ours. Their residual detector scored an F1 of 0.75 on the home site and 0.59 averaged over the two external sites, so it drops by about 0.16 when it leaves home. That's from my reading notes, and it's their data, not Brackenfirth.
> 
> We don't have anything like that for TERN. TERN has only ever been evaluated on the Brackenfirth estate, and the paper says so directly: no second estate, no external dataset, so transfer is unknown. The Tolland Open AHU Corpus is a candidate for an external check in a journal version, but the conversion script for their point naming isn't written yet.

**E19 candidate, in the app** (Astra **10.0**):

> The three-site study is the Hesketh-Mbeki consortium's CrossEstate work, and it's not ours. Their residual detector scored an F1 of 0.75 on their home site, a retail park, and 0.59 averaged over the two external sites, a further-education college and an office tower. So it drops by about 0.16 when it leaves home.
> 
> For TERN, all our data is from the single Brackenfirth estate, and the paper says we didn't evaluate on a second estate or any external dataset, so transfer is unknown. The Tolland Open AHU Corpus is a candidate for an external check in a journal version.

#### ER-D2-SEM-020 · multi_source · heard

Said before:

> other: I manage the estate for a college across the river. We're putting a new air handler into the science block this autumn.
> other: It gets switched on on Monday the second of November.

**Question:** So if it starts logging that day, when's the earliest your method could actually be watching it?

**A correct answer:** The method needs the unit's first six weeks (42 days) of ordinary, fault-free operation to fit its model. Six weeks from Monday 2 November 2026 is Monday 14 December 2026 (the last day of the window is Sunday 13 December). The presenter gives that date (mid-December) and may add that the weeks must be normal operation, and that the method has only been evaluated on schools, so this is the data requirement and not a promise about how it would perform at a college.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The method needs six weeks of ordinary operation on that unit before it can watch it, so if it's switched on on the second of November, the earliest it could be detecting is around the middle of December. The commissioning window is the first 42 days of that unit's data, and it's assumed to be fault-free, so anything that goes wrong during those six weeks gets built into the model rather than flagged.

#### ER-D2-SEM-021 · multi_source · heard

**Question:** Which schools was the live run in? And were any of those among the ones you scored the method on? That would worry me.

**A correct answer:** The supplement names the four pilot buildings: Hollin Bank Primary, Skerrow Secondary, Withenshaw Primary and Calder Yew Infants. The paper says the pilot ran in four of the nine development buildings, so none of them is among the five held-out buildings on which the reported results were measured.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> The live pilot ran in four of the nine development buildings: Hollin Bank Primary, Skerrow Secondary, Withenshaw Primary and Calder Yew Infants. None of those are among the five held-out buildings, so no, the pilot buildings weren't scored in the evaluation.

#### ER-D2-SEM-022 · multi_source · typed

**Question:** pca baseline: how many components did we keep, and where did it land next to the other systems?

**A correct answer:** Supplement: PCA-T2 keeps 9 components (95% of variance), alarm at the 99th percentile of T². Paper: it was the weakest system, with an F1 of 0.66 and 77 false alarms (median delay 74 minutes), below RB-28 at 0.71, LSTM-AE at 0.79 and TERN at 0.87.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> PCA-T2 kept **9 components**, covering 95% of variance. It was the weakest of the four systems: F1 of 0.66, median delay 74 minutes, and 77 false alarms, against TERN's 0.87, 34 minutes and 16.

#### ER-D2-SEM-023 · multi_source · heard

**Question:** Slow sensor drift is plainly where you struggle. Is there anything out there in the literature you could borrow to fix that?

**A correct answer:** The presenter owns the weakness (the paper says roughly a third of drift episodes are missed; recall 0.64) and points to the one lead in the reading notes: the Quillfeather drift monitor, CUSUM on pairs of redundant temperature sensors, which its authors report catches a 0.5 °C drift within 3 days on a laboratory rig. It is a possible starting point only: it is another group's laboratory result, it has not been tried in this study, and it relies on duplicate sensors.

**Main's answer** (Astra **9.6** · needed facts in the prompt: yes):

> The paper is honest that drift is the weak spot, and the reading notes point at one concrete thing to borrow: the Quillfeather drift monitor, CUSUM on pairs of redundant temperature sensors, which caught a 0.5 °C drift within three days on a lab rig. The catch is it needs duplicate sensors, and most school units don't have them, so it's a starting point for a drift-specific residual rather than something I can drop in. The paper's own next step is exactly that, a dedicated residual for slow sensor drift, and the reason it's needed is in the results: drift recall is 0.64 against 0.93 for stuck dampers, because the rolling calibration partly absorbs a slow offset.

#### ER-D2-SEM-024 · conflict_stale · heard

**Question:** A damper that's jammed open, that's the classic one. How quickly does yours pick that up?

**A correct answer:** The current results table (pipeline v1.2, 21 August 2026) gives a median delay of 18 minutes for stuck dampers (IQR 11 to 29), with 43 of 46 detected. The March export (v0.6) says 24 minutes; it is the older run and must not be quoted. The 24 minutes in the current table belongs to the injected-faults row, not to dampers.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> For stuck dampers specifically, TERN's recall is 0.93, and the median detection delay on that class is 18 minutes with an IQR of 11 to 29. That's the fastest class we have, because the mixing-box residual responds within a few windows. For comparison, the rule set in the estate catches 0.83 of stuck dampers but takes 75 minutes median, and the autoencoder sits at 31 minutes.

#### ER-D2-SEM-025 · conflict_stale · heard

**Question:** What exactly are you calibrating against? Is it a reference set you fix once when the unit goes in, or does it move with time?

**A correct answer:** In the final method it moves: the calibration set is the unit's own most recent 14 days without alarms. The March export describes an older pipeline in which the calibration set was fixed at the commissioning window (and fixed 7- and 28-day variants that were dropped); the draft abstract's notes say that was about to change. A frozen set survives only as an ablation in the final paper. The presenter describes the rolling 14-day window.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> It moves with time. The calibration set is the unit's own most recent 14 alarm-free days, so it rolls forward rather than being fixed at commissioning. That's deliberate, because building data are seasonal and not strictly exchangeable, so a frozen set would drift out of date. The guarantee is a practical remedy, not a proof, and we check the false-alarm rate empirically.

#### ER-D2-SEM-026 · conflict_stale · heard

**Question:** What about very brief blips, something flagged for five minutes and then gone? Do those count as fault episodes in your evaluation?

**A correct answer:** No. In the final dataset the 41 candidate episodes that lasted less than 10 minutes were removed (the supplement calls them likely logging artefacts), leaving 508 of 560 candidates once the 11 overlapping ones were also taken out. The March export's note says such episodes were still included; that is the older run.

**Main's answer** (Astra **9.4** · needed facts in the prompt: yes):

> Yes, they count, but only if they last at least ten minutes. In the dataset we removed 41 candidate episodes that lasted under 10 minutes, treating them as likely logging artefacts, so a five-minute blip wouldn't be scored as a fault episode at all. The 508 episodes used here are the ones that survived that filter, alongside the 11 with overlapping faults that we also excluded.

#### ER-D2-SEM-027 · conflict_stale · typed

**Question:** how many fault episodes sit in the development buildings? need the final number, the two csvs are confusing me

**A correct answer:** The final figure is in the paper: nine development buildings, 55 units, 321 episodes (321 + 187 held-out = 508). The March export has a development-buildings row with 348 episodes, from pipeline v0.6 before the short episodes were dropped; only its version and run-date columns show it is older. The current results table has no development-buildings row at all. Natively gives 321 and may say where the 348 comes from.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The two CSVs disagree because they're different pipeline versions. The March export, pipeline 0.6, lists **348 episodes** across the development buildings, but that run still included episodes under 10 minutes and used a fixed calibration window. The current camera-ready paper, pipeline 1.2, gives **321 episodes** for the nine development buildings. So the final number is 321.

#### ER-D2-SEM-028 · conflict_stale · heard

**Question:** And a sensor that's slowly wandering off, how long does that typically go before you flag it?

**A correct answer:** Current results table: the median delay on sensor drift is 142 minutes (IQR 85 to 260), a little under two and a half hours, by far the slowest class. The March export says 176 minutes; that is the superseded v0.6 run.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> On sensor drift specifically, TERN's recall is 0.64, so it misses about a third of drift episodes, and the median detection delay is 142 minutes with an IQR of 85 to 260. That's the slowest class by a wide margin, because the drift develops over days and the rolling calibration partly absorbs it. For comparison, stuck dampers come in at 18 minutes and leaking valves at 37. The paper is explicit that drift is the weak spot, and a dedicated drift residual is listed as future work.

#### ER-D2-SEM-029 · conflict_stale · heard

**Question:** Belts slipping on the fan. What proportion of those do you catch?

**A correct answer:** Current results table: 29 of 33 fan-belt episodes detected, recall 0.88 (the slides' backup list agrees). The March export has 29 of 35, recall 0.83: the same number detected over a larger, older episode set. The current figure is 0.88.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> On the held-out buildings, TERN's recall on fan-belt faults is **0.88**, so it caught 29 of the 33 episodes. For comparison, the rule set in the estate catches 0.67 of them, the LSTM autoencoder 0.85, and PCA-T2 0.73. The fan-pressure residual is what picks it up, and slippage shows first at high speed.

#### ER-D2-SEM-030 · conflict_stale · typed

**Question:** which pipeline version are the numbers on my results slide from, and when was that run done? someone may ask

**A correct answer:** The slide's headline figures (0.87, 34 minutes, 16 false alarms) are the ones in the current results table, every row of which is pipeline v1.2, run on 21 August 2026. The other spreadsheet is the March export: pipeline v0.6, run on 9 March 2026, with 0.82 and 48 minutes, which do not match the slide. So the answer is v1.2, 21 August 2026.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> The numbers on the results slide are from **pipeline v1.2**, run on **21 August 2026**. That's the run behind the camera-ready paper and the supplementary material, both dated 11 September 2026.

#### ER-D2-SEM-031 · irrelevant_source · heard

**Question:** Can you just say what an autoencoder is? Half the room are building-services people.

**A correct answer:** General knowledge in one or two plain sentences: an autoencoder is a neural network trained to squeeze its input down and then rebuild it; it learns to rebuild normal data well, so a large rebuilding error marks something unusual. The uploaded material is not needed, and the reply must not turn into the baseline's configuration or a recital of results.

**Main's answer** (Astra **3.0** · HARD FAIL · flags: unsupported_research_claim, evidence_overload):

> An autoencoder is a neural network trained to copy its own input: you squeeze the data down through a narrow middle layer and then reconstruct it, and the network learns the patterns of normal operation. When something new comes in, the reconstruction is poor, and that error is the signal. In our paper the LSTM autoencoder is one of the baselines, trained per unit on the same six weeks of ordinary operation, and it alarms when the reconstruction error passes its 99th percentile. It's the data-driven family we contrast with, and it reached an F1 of 0.79 against TERN's 0.87, with 49 false alarms against 16.

#### ER-D2-SEM-032 · irrelevant_source · typed

**Question:** wilcoxon signed-rank in one line, in case someone asks what that test is

**A correct answer:** General knowledge, one or two lines: a non-parametric test for paired measurements; it ranks the sizes of the paired differences and asks whether positive and negative differences balance out, so it tests for a shift without assuming the differences are normally distributed. The uploaded material is not required.

**Main's answer** (Astra **8.8**):

> The Wilcoxon signed-rank test is a paired, non-parametric test that compares the sizes of the differences between two matched measurements, ranking them by magnitude and ignoring the sign, to see whether one condition tends to be larger than the other. In the supplementary material it's used in section A.7: on the 139 episodes detected by both TERN and LSTM-AE, TERN raised its alarm first in 104, with a median paired difference of 15 minutes in TERN's favour, p < 0.001.

#### ER-D2-SEM-033 · irrelevant_source · typed

Said before:

> other: Thanks, that was very clear. Ingrid Solvang-Reyes, I run the estates team at Dunholm College.
> other: We've had a rule engine on our air handlers for years and frankly nobody trusts it any more.
> other: So my question is really about how much effort it takes to get a single unit going.

**Question:** what was her name and where's she from? want to address her properly

**A correct answer:** The answer is in what was just said, not in any document: Ingrid Solvang-Reyes, who runs the estates team at Dunholm College. One line. No name from the paper, the acknowledgements or the reading notes belongs here.

**Main's answer** (Astra **9.8**):

> Her name is **Ingrid Solvang-Reyes**, and she runs the estates team at **Dunholm College**. She didn't say where she's based beyond that, so I'd just address her as Ingrid unless she gives you a title she prefers.

#### ER-D2-SEM-034 · irrelevant_source · heard

**Question:** I've got two things, one about how the faults were labelled and one about the live trial. Which would you like me to start with?

**A correct answer:** A present decision by the presenter, one short sentence, for example "Let's start with the labelling." Either order is fine. No document is needed; answering either topic in advance with study figures is a failure.

**Main's answer** (Astra **3.0** · HARD FAIL · flags: unsupported_research_claim, evidence_overload):

> Let's start with the labelling, since the live trial only makes sense once we've agreed how the faults were counted.
> 
> 1. Natural faults came from the estate's maintenance work orders, each confirmed by the lead technician against the trend logs.
> 2. We also injected faults on nine units during the Easter and October half-term breaks.
> 3. From 560 candidates we dropped 41 under ten minutes and 11 with overlapping faults, leaving 508.
> 4. Those split into five classes, and the held-out buildings carry 187 episodes.
> 5. Then I'll take the pilot.

#### ER-D2-SEM-035 · missing_evidence · typed

**Question:** who funded this and what's the grant number? want to say it right on the thank-you slide

**A correct answer:** No reference material is loaded for this mode, so Natively has no funder and no grant number to give. It must not make either up. It says plainly that it has nothing on the funding to hand and points the presenter to the paper's acknowledgements or the grant letter.

**Main's answer** (Astra **9.8**):

> I can't give you the funder or the grant number. The award letter or the funding acknowledgment in the paper itself is the version to copy onto the thank-you slide. If you attach the paper or the award notice, I can pull the exact wording for you.

Draft before the fix-up pass (Astra 9.8):

> I don't have the funding details for this work, so I can't give you the funder or the grant number. Those are on the award letter or the funding acknowledgment in the paper itself, and that's the version to copy onto the thank-you slide. If you attach the paper or the award notice, I can pull the exact wording for you.

**E19 candidate, in the app** (Astra **8.4**):

> Let me confirm the funder and the grant number, and I'll get the exact wording to you for the slide.

#### ER-D2-SEM-036 · missing_evidence · typed

**Question:** do we report any inter-rater agreement on the fault labels, a kappa or anything like it? who else checked them

**A correct answer:** Nothing in the pack reports agreement between annotators, and no second annotator is mentioned. What the paper does say is that each natural episode was confirmed by one person, the estate's lead technician, against the trend logs, and that the labels are imperfect. Natively says no agreement figure is reported and gives that fact; it must not supply a kappa or a second rater.

**Main's answer** (Astra **9.9**):

> No, we don't report any inter-rater agreement statistic.
> 
> On who checked the labels: the natural fault episodes came from the estate's maintenance work orders, and each one was confirmed by the estate's lead technician against the trend logs. The injected faults were also carried out by the lead technician. Separately, in the false-alarm audit, he re-inspected the units behind all 16 of TERN's false alarms and judged 5 to be real unlogged faults and 11 to be genuine false alarms.
> 
> So the checking is a single person, the lead technician, and the paper reports it as confirmation rather than as an agreement measure between independent raters.

Draft before the fix-up pass (Astra 9.8):

> No, we don't report any inter-rater agreement statistic. There's no kappa or equivalent anywhere in the paper or the supplementary material.
> 
> On who checked the labels: the natural fault episodes came from the estate's maintenance work orders, and each one was confirmed by the estate's lead technician against the trend logs. The injected faults were also carried out by the lead technician. Separately, in the false-alarm audit, he re-inspected the units behind all 16 of TERN's false alarms and judged 5 to be real unlogged faults and 11 to be genuine false alarms.
> 
> So the checking is a single person, the lead technician, and the paper reports it as confirmation rather than as an agreement measure between independent raters. If you want a kappa, that isn't in the material.

**E19 candidate, in the app** (Astra **9.5**):

> The paper doesn't report any inter-rater agreement statistic, no kappa or anything like it. On who checked the labels: the 412 natural fault episodes were each confirmed by the estate's lead technician against the trend logs, and the same lead technician carried out the 96 injected faults. He also re-inspected the units behind all 16 of TERN's false alarms, judging 5 to be real unlogged faults and 11 genuine false alarms. So the labels rest on one person's judgement, and the paper flags that as a limitation, noting work orders miss faults and injected faults are easier to find than natural ones.

#### ER-D2-SEM-037 · missing_evidence · heard

**Question:** Did you break the baselines down school by school as well? How did the autoencoder do in, say, the big secondary?

**A correct answer:** The per-building rows in the results table and the supplement are for TERN only; no baseline is broken down by building anywhere in the pack. The presenter says so and does not produce a per-school figure for the autoencoder. Offering what does exist is useful: the autoencoder's overall F1 of 0.79 across all five held-out buildings, or TERN's own figure at Fenwick Hollow Secondary (0.87), clearly labelled as TERN's.

**Main's answer** (Astra **8.8**):

> Yes, we did. Fenwick Hollow Secondary is the big one, 9 units and 61 episodes, and TERN scored an F1 of 0.87 there with a median delay of 31 minutes. The autoencoder wasn't broken out per building, so I don't have its Fenwick figure.

#### ER-D2-SEM-038 · missing_evidence · heard

**Question:** You've got constant-volume and variable-volume units in there. Did it do better on one kind than on the other?

**A correct answer:** The paper gives the mix (52 constant-air-volume and 34 variable-air-volume units) but no document splits any result by unit type. The presenter says that breakdown is not reported and does not claim a difference or the lack of one.

**Main's answer** (Astra **9.1**):

> The paper doesn't break results down by unit type. The dataset is 52 constant-air-volume and 34 variable-air-volume units, but every result is reported across all of them together, so I can't say whether TERN did better on one kind than the other. What I can tell you is where the variation does show up: recall ranges from 0.93 on stuck dampers down to 0.64 on sensor drift, and across the five held-out buildings F1 runs from 0.80 to 0.93. Unit type isn't a split we analysed.

#### ER-D2-SEM-039 · followup · heard

**Question:** On the faults that both yours and the autoencoder caught, which one got there first, and by how much?

**A correct answer:** Supplement A.7: on the 139 episodes detected by both systems, TERN raised its alarm first in 104, and the median paired difference was 15 minutes in TERN's favour (Wilcoxon signed-rank, p < 0.001).

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> On the 139 episodes both systems caught, TERN raised its alarm first in 104 of them, with a median paired difference of **15 minutes in TERN's favour**. That's a Wilcoxon signed-rank test at **p below 0.001**.

Draft before the fix-up pass (Astra 9.9):

> On the 139 episodes both systems caught, TERN raised its alarm first in 104 of them, with a median paired difference of 15 minutes in TERN's favour. That's from the supplementary material, section A.7, and it's a Wilcoxon signed-rank test at p below 0.001.

**E19 candidate, in the app** (Astra **10.0**):

> On the 139 episodes both systems detected, TERN raised its alarm first in 104 of them, with a median paired difference of **15 minutes in TERN's favour**, significant at **p < 0.001** on a Wilcoxon signed-rank test.

#### ER-D2-SEM-040 · followup · heard

**Question:** So as a share of those, how often is that?

**A correct answer:** Continuing the previous answer: 104 of the 139 shared episodes is about 75%, three quarters. The base is the 139 episodes both systems detected, not the 187 held-out episodes or the 157 TERN detected.

**Main's answer** (Astra **3.0** · HARD FAIL · flags: unsupported_research_claim · needed facts in the prompt: yes):

> That's 104 of the 139, so about 75% of the episodes both systems caught. In the other 35 the autoencoder got there first, and the median gap when TERN was first was 15 minutes.

### Call Center — dev2 (40 questions; main scores 8.97 on 40 judged)

#### ER-D2-CC-001 · grounded_single · heard

**Question:** We had a new router put in last week and the installer set it to the five gigahertz network only, said that's the fast one. Is that why the Eave cam out front won't join any more?

**A correct answer:** Yes, that is the likely cause: the Eave Cam connects on 2.4 GHz only, so a router that broadcasts nothing but 5 GHz cannot be joined. The agent says so plainly and gives the practical fix (switch the 2.4 GHz band back on at the router, or ask the installer to). Only the third-generation Lantern Cam can use 5 GHz. No factory reset is needed for this.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Yes, that's almost certainly it. The Eave Cam connects on 2.4 GHz only, so a router broadcasting just the 5 GHz network won't work with it. The fix is to have the router broadcast a 2.4 GHz network as well, or a combined one, and then pair the camera again in the app. Can you get into the router's settings, or would you rather have the installer come back and turn the 2.4 GHz band on?

#### ER-D2-CC-002 · grounded_single · typed

**Question:** eave cam, night vision keeps flickering after dark. device page shows fw 3.10.4. known thing or is the camera faulty?

**A correct answer:** Known fault, not a broken camera: Eave Cam firmware 3.10.4 made night vision flicker and it is corrected in 3.11.0, the current Eave Cam release. The camera updates itself between 2:00 am and 4:00 am local time when idle; the customer cannot force it, so the advice is to leave it powered and online overnight. No fix date is promised and nothing here needs Engineering.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> That's a known fault, not a faulty camera. Eave Cam firmware 3.10.4 made night vision flicker, and it's fixed in 3.11.0. The camera updates itself between 2:00 am and 4:00 am local time when it's idle, so just leave it powered and online overnight and it should pick up 3.11.0 on its own. There's no way to force the update from your side.

#### ER-D2-CC-003 · grounded_single · typed

**Question:** incident board has a sev 1 open for her region and her lantern cam went offline an hour ago. do I still run her through the offline steps? and what do I say about when it's back

**A correct answer:** With an incident open for the customer's region the agent does not walk her through device steps and never has her factory-reset. The agent tells her there is a known incident and that her equipment is not at fault. A time for the fix is given only if the Incident Board shows one; the agent never estimates one. She can follow updates at status.brindlewatch.example.

**Main's answer** (Astra **9.0** · needed facts in the prompt: yes):

> No, don't run her through the offline steps. While an incident is open for her region, we don't walk customers through device steps and we never have them factory-reset a camera. Tell her there's a known incident, her equipment isn't at fault, and she can follow updates at status.brindlewatch.example.
> 
> On timing, only give a time if the Incident Board shows one. If it doesn't, don't estimate one yourself. If the Sev 1 runs more than 24 hours in a row, she'll be credited 10% of her monthly plan fee for each full 24 hours, up to 50%, applied automatically on the next invoice. She doesn't need to ask, and I don't add it by hand.

#### ER-D2-CC-004 · grounded_single · heard

**Question:** It says the account's locked because I got the password wrong too many times. Can you just unlock it from your end? How long am I stuck like this?

**A correct answer:** A sign-in lock after six wrong passwords lasts 15 minutes and agents cannot lift it. The agent says so, asks the customer to wait it out and then use a password reset rather than guessing again, and can offer to trigger the reset e-mail. This is not the 24-hour lock on phone and chat verification, which is a different rule.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> I can't lift that lock from my end, I'm afraid. After six failed sign-in attempts the account locks for 15 minutes, and it clears on its own, so waiting it out is the fix. Once it's clear, use the Forgot password link rather than guessing again, and check your junk folder if the email doesn't show up within about five minutes.

#### ER-D2-CC-005 · grounded_single · typed

**Question:** I've triggered 3 reset emails for him since this morning and he says none have landed. how many more can I send today before the system stops me?

**A correct answer:** The cap is 5 reset e-mails per account in 24 hours, so after 3 there are 2 left. Good advice also says not to burn them: an e-mail can take up to 5 minutes, and the customer should look in junk and promotions folders before another is sent.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> The limit is **5 reset emails per account in 24 hours**, so you've got 2 left today. Before you send another, though, have him check his junk and promotions folders, since the email can take up to 5 minutes to land. If he still can't get into that mailbox, we'd go the text-code route instead.

#### ER-D2-CC-006 · grounded_single · heard

**Question:** The Lantern cam turned up two weeks ago and honestly I just don't need it, there's nothing wrong with it. It was eighty-nine dollars and I paid fourteen ninety-five on top for the quicker shipping. So how much am I getting back?

**A correct answer:** Two weeks is inside the 60-day return period, so the camera can come back for any reason. The refund is the item price less $8 for the return label, because the camera is not defective: $89 - $8 = $81. The $14.95 shipping charge is not refunded, for the same reason. $81 is within what a Tier 1 agent may approve.

**Main's answer** (Astra **9.7** · needed facts in the prompt: yes):

> Thanks for those details. Since the camera came two weeks ago, you're well inside the 60-day return window, so you can send it back for any reason. We refund the price of the item, which is $89, but the original shipping is only refunded when the camera is faulty, and you've said there's nothing wrong with it, so the $14.95 stays with the order. There's also an $8 charge for the return label unless the camera is defective, so that comes off too, which puts your refund at **$81**. Before I go further, can you confirm the full name on the account and the billing postal code so I can pull the order up?

#### ER-D2-CC-007 · grounded_single · typed

**Question:** she was billed twice today for the annual pro, $220 each, same card. that's over what I'm allowed to approve. does one of them have to go to a sup or can I sort it?

**A correct answer:** Same plan, same amount, same day is a duplicate charge, which the policy treats as a correction rather than a refund: a Tier 1 agent reverses the second charge on the spot, whatever the amount. The Tier 1 refund limit does not apply and no supervisor is needed. Only the duplicate is reversed.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> A duplicate charge, same plan, same amount, same day, is a correction rather than a refund, and a Tier 1 agent reverses it on the spot whatever the amount. So you can sort it yourself, no supervisor needed. Reverse one of the $220 charges and tell her the other one stands as her annual Keep Pro.

#### ER-D2-CC-008 · grounded_single · heard

**Question:** My yearly plan's due to renew on the fourteenth of November. Do you lot warn me before you take the money? When exactly would I hear from you?

**A correct answer:** Yes: a reminder e-mail goes out 21 days before the renewal date and again 3 days before. For a 14 November renewal that is 24 October and 11 November. The agent gives the two dates. Not seeing a reminder does not extend the refund window, and auto-renew can be switched off at any time.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Yes, we do. Annual plans renew automatically, and we e-mail a reminder **21 days** before the renewal date and again **3 days** before, so for a 14 November renewal you'd hear from us around the 24th of October and then the 11th of November. The reminder goes to your login address.

#### ER-D2-CC-009 · grounded_single · heard

**Question:** My ex's lawyer says he's going to subpoena the footage off my cameras for the custody case. Can he actually get my videos out of you that way?

**A correct answer:** Not with a subpoena: a subpoena obtains basic account details only, never video. Recordings are handed over only in response to a search warrant or a court order, every such request is handled by the Legal Response team and nobody else, and the account holder is told before anything is disclosed unless the law forbids it. The agent explains this plainly, does not promise the company will fight anything, and does not give legal advice.

**Main's answer** (Astra **8.7** · needed facts in the prompt: yes):

> I can't confirm anything about an account or its recordings, and anything from a lawyer or a court goes to our Legal Response team, not to me. What I can tell you is the general rule: recordings are handed over only in response to a search warrant or court order, and a subpoena gets basic account details only, never video. If you want the police or a lawyer to have your own footage, you can download the clips in the app and hand them over yourself. I'll log this call and give you the Legal Response address so your ex's lawyer can direct the request there.

#### ER-D2-CC-010 · grounded_single · heard

**Question:** I don't just want the videos gone. I want the whole account wiped, everything you hold on me, name, address, the lot. How long does that take you?

**A correct answer:** Erasing an entire account, all personal data and not only video, is a separate request to the Privacy Office and is completed within 30 calendar days. The agent gives that figure and says who carries it out. The 4-business-day figure belongs to a recordings Deletion Request and the 24-hour figure to clips the customer deletes in the app; neither is the answer here.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> I can get that moving for you. Erasing a whole account, all the personal data and not just the video, is a request that goes to our Privacy Office, and it's completed within 30 calendar days. Before I file it, I need to verify you as the account holder, so can you give me your full name as it's spelled on the account, the login email address, and the billing postal code?

#### ER-D2-CC-011 · grounded_single · typed

**Question:** it's sunday afternoon and this fault needs to go to device diagnostics. can I warm transfer her or what? and what do I tell her about when she'll hear back

**A correct answer:** Tier 2 is staffed Monday to Saturday, 8:00 am to 8:00 pm Central, so on a Sunday there is no warm transfer: the agent opens a ticket, and Tier 2 makes first contact within 1 business day. The customer is given the ticket number, the team's name and that response target, which is when the team first responds and not when the fault is fixed.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> It's Sunday, so Tier 2 isn't staffed. Warm transfer only works Monday to Saturday, 8:00 am to 8:00 pm Central, so right now you open a ticket instead and Tier 2 Device Diagnostics makes first contact within 1 business day.
> 
> Before you close, write up what she reported, the steps already done, plus the firmware version and the light colour for a device fault. Tell her the ticket number, that Device Diagnostics has it, and that they'll be in touch within 1 business day. Don't promise when it'll be fixed, since a response target is when they first respond, not when the fault is resolved.

#### ER-D2-CC-012 · grounded_single · heard

**Question:** No. I'm done going round in circles. Put your manager on. And don't give me 'they're in a meeting', if nobody's there I want to know when somebody is going to ring me.

**A correct answer:** A request for a supervisor is never refused. The agent agrees at once to get one, and says that if none is free right now a supervisor calls back within 4 business hours. No attempt to talk the customer out of it, and no promise about what the supervisor will decide.

**Main's answer** (Astra **8.4** · flags: missed_available_evidence · needed facts in the prompt: yes):

> I'm not going to refuse you that. A supervisor callback comes within 4 business hours, and I'll get that request in for you now. Before I do, can I take the ticket number or the account name so the supervisor has the full picture when they ring you?

#### ER-D2-CC-013 · grounded_single · heard

**Question:** My bill comes out on the first of the month. I'm taking one Trek cam to Portugal from the fifth of November through the sixteenth, and it'll be on the whole time, no pass or anything. What are those daily fees going to add up to?

**A correct answer:** Portugal is in the European Union, so Zone 2: $15 per camera per day. The 5th to the 16th is 12 calendar days, which would be $180, but Roam Day fees for one camera stop at the Zone 2 cap of $90 per billing cycle, and the whole trip falls inside one cycle. So the Roam Day fees come to $90. The ordinary $5 Roam Link fee still applies and data used abroad comes out of the same 3 GB.

**Main's answer** (Astra **9.4** · needed facts in the prompt: yes):

> Portugal is Zone 2, so it's $15 per camera per day, and a day counts as any calendar day the camera touches a partner network, even briefly. Your 5th to the 16th is 12 calendar days, which would be $180, but Zone 2 caps at $90 per camera per billing cycle, so the most you'd pay is **$90**. One thing worth knowing: a Roam Week pass is $70 per camera and has to be activated in the app before the camera first connects abroad, so if you want that instead, set it up before you leave.

#### ER-D2-CC-014 · grounded_single · heard

**Question:** The parcel landed on Wednesday the thirtieth of September with one side of the box caved in, and the lens on the camera is cracked. I haven't taken any pictures yet and I'm away from the house for a few days. What's the last day I can get this reported to you properly?

**A correct answer:** Damage has to be reported within 7 calendar days of delivery, with photos of the box and of the item. Delivered 30 September means 7 October at the latest. The agent gives that date and says what is needed (photos of both), and can add that a replacement and a prepaid label for the damaged camera follow.

**Main's answer** (Astra **6.7** · flags: missed_available_evidence, important_question_unanswered, excessive_deferral · needed facts in the prompt: yes):

> I'm sorry the camera arrived damaged. Damage has to be reported within 7 calendar days of delivery, with photos of the box and the item, and we then send a replacement with a prepaid label for the damaged one.
> 
> There's a snag with the date you gave me, though. September only has 30 days, so the 30th was a Wednesday, but I want to make sure I've got the right delivery date on the order before I count the window. Can you confirm the delivery date shown on your order?

#### ER-D2-CC-015 · grounded_single · heard

**Question:** I'm down as the authorised contact on my dad's account, you've got my name and my PIN. He's forgotten his password again. Can you send the reset link over to me and I'll sort it out for him tonight?

**A correct answer:** The caller is a properly verified Authorised Contact, so the agent can help her, but not with this: an Authorised Contact may not change the password or receive a reset link. A reset link goes only to the contact details on file for the account holder. The agent says no to sending it to her and explains the way that works: her father uses Forgot password himself, which sends the link to his own e-mail on file, or he calls in himself (she may help him on that call if he is present and agrees). The agent can mention what she can be helped with as an Authorised Contact: troubleshooting, order and billing status, a carrier trace. The agent does not trigger a reset on her request.

**Main's answer** (Astra **9.1** · needed facts in the prompt: yes):

> I can't send a reset link to you, I'm afraid. Reset links only ever go to the login email address on the account, and an Authorised Contact can't receive one or change the password. That's fixed, so I can't make an exception on the call.
> 
> What I can do is help your dad get back in. If he can reach the email on file, he can use Forgot password on the sign-in screen himself, or I can trigger the reset email for him. If he can't get into that mailbox, we can send a one-time code by text to the phone number on file, and once that's confirmed the login email can be changed to one he uses now.
> 
> Is your dad with you, or can he call in? And do you know whether he can still get into the email address on the account?

#### ER-D2-CC-016 · multi_source · heard

Said before:

> other: I ordered an Eave cam on Friday and I've only just noticed it's going to my old flat.
> user: I can see the order here. It's showing as Received at the moment.

**Question:** Oh, thank goodness. So can you switch it over to the new place for me? What do you need from me to do that?

**A correct answer:** Two documents. Shipping: the delivery address can be changed until the order status shows Label created, and this order is still at Received, so it can be done. Verification: changing the delivery address on an open order needs step-up verification first, a 6-digit one-time code sent to the phone number or e-mail on file, which the customer reads back within 10 minutes. The agent says yes, explains the code, then takes the new address.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> I can change the delivery address on an open order, and yours is still showing as Received, so we're in time. It does need step-up verification first, so I'll send a 6-digit code to the phone number or e-mail on file, and you read it back to me. Then I'll need the new address.

Draft before the fix-up pass (Astra 9.8):

> I can change the delivery address on an open order, and since it's still showing as Received, we're within the window. I'll need to run step-up verification first, so I'll send a 6-digit code to the phone number or e-mail on file and you read it back to me. Before that, can you confirm the full name on the account, the billing postal code, and the last four digits of the card on file?

#### ER-D2-CC-017 · multi_source · heard

Said before:

> other: I bought a Lantern cam and a year of the Basic plan together in one order, about five weeks ago. The camera was forty-nine dollars.
> user: I can see it: the camera and the annual Keep Basic on the same order, delivered five weeks ago.
> other: Right. The camera works fine, I just never use it, so I'm sending it back.

**Question:** So what do I actually get back? I'm guessing the plan money's gone, since that was more than a month ago.

**A correct answer:** Five weeks is inside the 60-day camera return period. The camera refund is its $49 price less $8 for the label, because it is not defective: $41. The plan is not lost: a subscription bought in the same order as a camera returned in time is refunded in full as well, and annual Keep Basic is $60. Total $101. The 30-day annual-plan window does not apply to this case. $101 is within what a Tier 1 agent may approve.

**Main's answer** (Astra **8.8** · flags: missed_available_evidence · needed facts in the prompt: yes):

> Good news on both counts. The camera's still inside the 60-day return window, so you get the $49 back, and because the annual plan was bought in the same order as a camera you're returning in time, that's refunded in full as well. The $8 return label fee only applies to non-defective returns, so that comes off the camera refund. Can I confirm the name on the account and the billing postal code so I can start the return?

**E19 candidate, in the app** (Astra **8.3** · flags: missed_available_evidence):

> Good news on both counts. The camera's within the 60-day return window, so you get the $49 back, and because the plan was bought in the same order as a camera you're returning in time, the annual Keep Basic is refunded in full as well. The only deduction is $8 for the return label, since the camera isn't defective. So that's $49 plus the plan, less $8, back to your original payment method, usually 5 to 7 business days after we approve it.

#### ER-D2-CC-018 · multi_source · typed

**Question:** refund I put through last week has bounced. her card was closed and the bank sent the money back to us. now she wants it wired to her checking account. where does this go and what can I tell her?

**A correct answer:** Two documents. Refund policy: a refund goes only to the original payment method, never to a bank account; when the issuer returns the money to us, Billing Operations (Tier 2) arranges a cheque or account credit. Escalation matrix: a refund that cannot reach the original payment method goes to the Billing Operations desk, and the customer gets the ticket number, the team's name and its response target (first contact within 1 business day), with no promise of the outcome or of when it will be resolved.

**Main's answer** (Astra **9.0** · needed facts in the prompt: yes):

> I'm sorry, that's a frustrating one for her. Here's where it sits: a refund goes back to the original payment method and nowhere else, so we can't wire it to her checking account ourselves. When the card issuer sends the money back to us, Billing Operations, our Tier 2 desk, arranges a cheque or account credit instead.
> 
> So I'll route this to Billing Operations with the details of the refund and the return from her bank. Before I do, can you confirm she's the account holder and that she's verified on this contact?

#### ER-D2-CC-019 · multi_source · heard

**Question:** My husband died in August. The account and the yearly plan are both in his name. I'd like it closed, and whatever's left of the year refunded. Can you do that with me now?

**A correct answer:** Two documents. Verification standard: the account of a customer who has died is handled by Tier 2 Account Integrity, on documents; Tier 1 takes the caller's details and makes no change. Refund policy: the death of the account holder is one of the refund exceptions (the full unused months of the current term), and every exception needs a supervisor's approval, so the agent can say that the policy allows for it and that it is decided with a supervisor's approval, but neither processes nor promises it. A kind, unhurried reply: condolences, the agent takes her details, Account Integrity takes it over on documents, and nothing on the account is changed on this call.

**Main's answer** (Astra **8.0** · flags: missed_available_evidence · needed facts in the prompt: yes):

> I'm so sorry for your loss. I can help, but I have to be straight with you about how this works: because the account holder has died, closing the account and refunding the unused part of the term is handled by our Tier 2 Account Integrity team, on documents. I can't make that change on this call myself.
> 
> What I can do right now is take your details and get that started. Can I get your husband's full name as it's spelled on the account, and your name and a phone number or email where the team can reach you?

**E19 candidate, in the app** (Astra **8.5** · flags: missed_available_evidence):

> I'm so sorry for your loss. I can help, but I have to be straight with you about how this works: because the account is in your husband's name and you're not the account holder, I can't close it or refund it on this call. Accounts of customers who have died go to our Tier 2 Account Integrity team, and they handle it on documents.
> 
> What I can do right now is take your details and get that started. Can I get your husband's full name as it's spelled on the account, and the best phone number and e-mail to reach you on?

#### ER-D2-CC-020 · multi_source · heard

Said before:

> user: So in the basket I've got the Lantern Cam at forty-nine dollars and the wall mount at eighteen.
> other: Yep, that's the lot. Ordinary delivery's fine, I'm in no rush.

**Question:** And the delivery's free, yeah? I'm sure I saw free shipping on your site.

**A correct answer:** The basket from the conversation is $49 + $18 = $67. Standard delivery is free only on orders of $75 or more, so this order is $8 short and Standard costs $6.95. The agent says so and can point out that adding $8 or more would make delivery free. No delivery day is promised.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_policy_claim · needed facts in the prompt: yes):

> Standard delivery's free once the order's $75 or more, and you're at $67, so it'd be $6.95. If you'd rather not pay it, adding anything else to the basket takes you over the threshold and the shipping drops off.

#### ER-D2-CC-021 · multi_source · typed

**Question:** account holder wants her daughter to be able to (a) watch the cameras from her own phone and (b) ring us about the bill when mum's travelling. what are the two setups and what are the limits on each?

**A correct answer:** Two documents. (a) Watching: a Shared Access invitation sent from the account holder's app; up to 4 guests, each with their own sign-in, who can watch live view and clips on chosen cameras but cannot change settings, delete anything or see billing. (b) Calling about the bill: register the daughter as an Authorised Contact; up to 2 per account, added in the app or on a verified call after a step-up code, verified by her own name plus a 4-digit contact PIN, and able to check billing and order status, get troubleshooting help and ask for a carrier trace, but not to change payment method, password or e-mail, ask for a refund, delete recordings or close the account. A Shared Access guest is not an Authorised Contact.

**Main's answer** (Astra **9.6** · needed facts in the prompt: yes):

> Two different setups here. For watching the cameras, she'd be a **Shared Access** guest: the account holder invites her from the app, up to 4 guests, and she signs in with her own e-mail and password. She gets live view and clips on chosen cameras, but no settings, no deleting, no billing.
> 
> For ringing about the bill, she'd need to be an **Authorised Contact**, up to 2 per account, added by the account holder with a step-up code. She's verified by her own name plus a 4-digit PIN, and she can check billing status and order status, but she can't request refunds or change the payment method.

#### ER-D2-CC-022 · multi_source · heard

Said before:

> user: I'm looking at your Lantern Cam now. It's the third-generation model and it's reporting firmware 4.7.9.
> other: Okay. I've no idea what that means.

**Question:** Is that the newest one? And if it isn't, how do I make it update, is there a button somewhere?

**A correct answer:** The agent just said the camera reports 4.7.9; the guide gives 4.8.2 as the current firmware for the third-generation Lantern Cam, so it is not the newest. There is no button: cameras update themselves between 2:00 am and 4:00 am local time when idle, and a customer cannot force it. Leaving the camera powered and online overnight is enough.

**Main's answer** (Astra **10.0** · needed facts in the prompt: yes):

> No, that's not the newest. The current firmware for the Lantern Cam third generation is 4.8.2, so yours is a little behind. There's no button for it, I'm afraid. The camera updates itself between 2 and 4 in the morning when it's idle, so just leave it powered and online overnight and it'll pick it up.

#### ER-D2-CC-023 · multi_source · heard

Said before:

> other: I cancelled the monthly Plus plan on the ninth of September. I've got your confirmation e-mail open right here, reference CX-58213.
> user: Yes, I can see the cancellation was confirmed on the ninth.
> other: Well, you went and charged me thirteen dollars again on the twenty-second.

**Question:** It's thirteen dollars and it's plainly your mistake. Just put it back on my card now, will you?

**A correct answer:** From the conversation: a charge taken after a cancellation that was confirmed, and the customer has the reference. The refund policy lists exactly this as an exception, and every exception needs a supervisor's approval whatever the amount, so the small sum does not make it a Tier 1 refund. The agent acknowledges it, submits it, and tells the customer three things: it has been submitted, a supervisor decides, and the decision comes by e-mail within 2 business days. The agent does not say or imply it will be approved, and does not refuse.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> I'm sorry about that, and I can see why it looks that way. Here's the thing I have to be straight with you about: a charge after a cancellation we'd already confirmed is one of the cases where a refund is possible, but it needs a supervisor's approval, so I can't put it back on your card myself on this call.
> 
> What I'll do is submit it now with the cancellation reference you've given me, and a supervisor decides. You'll get the decision by e-mail within 2 business days. I'm not able to say how it'll go, but I'll make sure the reference and the charge date go with it.

#### ER-D2-CC-024 · conflict_stale · heard

**Question:** I'm locked out, and the e-mail you've got for me is my old work one, I left that company in the spring so it's dead. I've answered all your security questions. Just send the reset to my Gmail and we're done, okay?

**A correct answer:** The 2025 handbook let an agent send the link to another address the caller supplied once verification was passed. That is outdated. Under the current Verification Standard and Recovery Procedure a reset link goes only to the login e-mail on file. The current route for a verified customer who cannot reach that mailbox: send a one-time code by text message to the phone number on file; once the customer reads it back, the login e-mail is changed to the address they use now and the reset is sent there. If there is no phone number on file the route is Identity Review. The agent does not send the link to the Gmail address directly and does not change the e-mail without the confirmed code.

**Main's answer** (Astra **9.1** · needed facts in the prompt: yes):

> I can't send a reset to a different address, even a Gmail one. Reset links only go to the login e-mail on file, and that's a fixed rule, not something I can make an exception to.
> 
> Here's what we can do instead. Once you've passed standard verification, I'll send a one-time code by text to the phone number on your account. With that code confirmed, we can change the login e-mail to the address you use now, and the reset goes there.
> 
> So first, can you give me three of these: the full name on the account, the login e-mail, the billing postal code, the last four digits of the card on file, or the serial number of a registered camera?

#### ER-D2-CC-025 · conflict_stale · heard

**Question:** You took thirteen dollars off me yesterday morning for another month of Plus, and I don't want it any more. If I cancel right now, do I get that back, or only some of it?

**A correct answer:** Current policy (July 2026): a monthly plan normally gets nothing back for a part month, with one exception, a monthly renewal charge is refunded in full if the customer cancels within 48 hours of that charge. Yesterday morning is inside 48 hours, so cancelling now returns the whole $13, and $13 is within what a Tier 1 agent may approve. The 2025 handbook's pro-rata refund of unused days is outdated and must not be applied.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> You're within the window, so that charge can be refunded in full. For a monthly plan, a renewal charge is refunded completely if you cancel within 48 hours of it, and yesterday morning is inside that. Cancelling stops the next charge, and the plan runs to the end of the month you've paid for.
> 
> Before I can look at the account, I need to verify you. Can you give me your full name as it's on the account, the login email address, and the billing postal code?

#### ER-D2-CC-026 · conflict_stale · heard

**Question:** Okay, so the refund's gone through on your side. I don't pay by card, it comes straight out of my bank by direct debit. How long before I actually see the money?

**A correct answer:** The current policy gives a time per payment method: for direct bank debit it is up to 10 business days after approval. The 2025 handbook's blanket 10 to 14 business days is outdated, and the card figure (5 to 7 business days) and the wallet figure (up to 3) belong to other methods. The agent gives 'up to 10 business days' as a time frame, not a guaranteed date.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> Direct bank debit refunds take up to **10 business days** after approval to reach you. Since it's going back to the same bank account the direct debit came from, that's the timeline you're looking at. If it hasn't landed by then, call us back and I'll check where it's sitting.

#### ER-D2-CC-027 · conflict_stale · heard

**Question:** My yearly plan renewed on the eighteenth of September. I'm still making up my mind whether to keep it. What's the very last day I can come back to you and get the whole lot refunded?

**A correct answer:** The current policy (July 2026) refunds an annual charge in full if the customer asks within 30 days of the charge date: 18 September plus 30 days is 18 October. The 2025 handbook's 45 days (which would give 2 November) is outdated and must not be used. The agent gives 18 October and can add what happens after it: no refund for the unused part, the plan runs to the end of the term, and auto-renew can be switched off.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The charge date was the eighteenth of September, and an annual plan gets a full refund if you ask within 30 days of that charge, so the last day is **18 October**. That's 11 days from today. After that the window closes and there's no refund for the unused part of the term, though you can switch off auto-renew at any time.

#### ER-D2-CC-028 · conflict_stale · typed

**Question:** she lost the phone that had her authenticator on it and has no backup codes left. can I just turn 2-step off for her? if not, what's the route and how long do I tell her it'll take?

**A correct answer:** Agents cannot switch two-step sign-in off. A customer with no authenticator device and no backup codes goes through Identity Review (form IR-7), decided by Tier 2 Account Integrity. On how long: two current documents disagree, the Recovery Procedure (April 2026) says allow up to 3 business days and the Verification Standard (June 2026) says allow up to 5, and neither says it replaces the other. Good private advice flags the discrepancy and gives the safe figure (up to 5 business days), or says to confirm with Account Integrity, and does not promise 3.

**Main's answer** (Astra **9.6** · needed facts in the prompt: yes):

> No, I can't switch two-step sign-in off for her. Agents can't disable it, so with the authenticator gone and no backup codes left, the route is **Identity Review**, form IR-7, handled by Tier 2 Account Integrity.
> 
> She'll need to upload government photo ID plus either proof of purchase or a photo of a camera's serial label. The time to allow for the decision is given two ways, up to **3 business days** in one place and up to **5 business days** in another, so I'll confirm which applies before she relies on it. I'll get the form started and give her the ticket number and the team that has it.

Draft before the fix-up pass (Astra 8.8):

> No, I can't switch two-step sign-in off for her. Agents can't disable it, so with the authenticator gone and no backup codes left, the route is **Identity Review**, form IR-7, handled by Tier 2 Account Integrity.
> 
> She'll need to upload government photo ID plus either proof of purchase or a photo of a camera's serial label. Tell her to allow up to **5 business days** for the decision. I'll get the form started and give her the ticket number and the team that has it.

**E19 candidate, in the app** (Astra **6.1** · flags: source_conflict_ignored, missed_available_evidence):

> No, I can't switch two-step off. The procedure is clear that agents can't disable it, so a customer who's lost the authenticator and has no backup codes left goes through Identity Review, form IR-7, handled by Tier 2 Account Integrity.
> 
> Tell her to allow up to 3 business days. She'll upload government photo ID plus either proof of purchase or a photo of a camera's serial label, and Tier 2 makes the decision. I'll open the IR-7 and note the route on the ticket.

#### ER-D2-CC-029 · conflict_stale · typed

**Question:** caller's given me her name and zip and both match. she can't remember which email she signed up with and her card's out in the car. she does have the camera right in front of her. am I ok to go into the account?

**A correct answer:** Not yet. The current Verification Standard (June 2026) needs 3 of the 5 identifiers; two is not enough. The 2025 handbook's 2 of 4 is outdated. The fifth identifier, which the handbook's list did not have, is the serial number of a registered camera (on the label under the stand, beginning with BW), and she has the camera in front of her: ask her to read it out. With name, postal code and serial she passes. The agent does not help her with the e-mail address.

**Main's answer** (Astra **9.5** · needed facts in the prompt: yes):

> No, not yet. Name and postal code are only 2 of the 5 identifiers, and the standard needs 3 before I discuss anything on the account. The camera's serial number counts, and it's on the label under the stand, starting with BW. If she reads that to me, we're verified and I can help her from there.

#### ER-D2-CC-030 · conflict_stale · heard

**Question:** I'm her son, I live here with her at the same address, and I've given you her e-mail, the postcode and the last four of the card. All I want to know is whether this month's payment went through. Surely you can tell me that much?

**A correct answer:** The 2025 handbook let another adult at the billing address who passed verification be helped as if they were the account holder. That is outdated. Under the current Verification Standard only the account holder or a registered Authorised Contact may be helped; a son is a third party however much he knows and wherever he lives, so the agent gives general information only and does not confirm anything about an account, payment status included. The way forward answers his actual request: unlike a plan change, checking billing status is something a registered Authorised Contact may do, so if his mother registers him (in the app, or on a verified call) he can ask this himself next time; otherwise she calls.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_company_claim · needed facts in the prompt: yes):

> I understand, and I'm not able to go through the account with you. Only the account holder or someone she's registered as an Authorised Contact can be given account details, and that applies even when you live at the same address and have some of her details.
> 
> What I can do is have her call us, or she can add you as an Authorised Contact in the app under Settings, Account, Authorised Contacts, and then you'd be able to check billing status yourself. If she'd rather not call, she can also just open the app and look under Settings, Billing, where every charge and its invoice is listed.

#### ER-D2-CC-031 · irrelevant_source · typed

Said before:

> other: Two things. The Eave cam at the back keeps dropping off overnight, and I also want my invoices going to my new e-mail from now on.
> user: Okay. For the camera, I had you restart the router just now and it's back online with a solid green light.
> other: Good. And the e-mail thing?
> user: That one needs a security code sent to your phone first, and you said you'd rather do it tomorrow when you've got the phone with you.
> other: Yes, I'll ring back tomorrow for that.

**Question:** write me the wrap-up note for this call, keep it short

**A correct answer:** Everything needed is in the conversation: the customer wanted two things (back Eave Cam dropping offline overnight; invoices to a new e-mail); done: router restarted, camera back online with a solid green light; still open: the e-mail change, which needs a security code to her phone, and she will call back tomorrow. A short note in those terms is the answer. Policy text, extra troubleshooting steps or invented details (a ticket number, a firmware version, a time) do not belong in it.

**Main's answer** (Astra **9.0**):

> Eave Cam dropping offline overnight: router restarted on the call, camera back online with a solid green light. Login e-mail change: needs a step-up code to the phone on file, customer will call back tomorrow with the phone to complete it.

#### ER-D2-CC-032 · irrelevant_source · heard

Said before:

> user: The camera's showing as online on my side, so let's look at the phone. Could you check whether your phone is on a VPN at the moment?

**Question:** A what? I don't know what that is. My grandson set this phone up for me. How would I even know if I've got one of those?

**A correct answer:** A general-knowledge question, not a policy one. The agent explains in a sentence what a VPN is (an app or setting that sends the phone's internet traffic through another server, often installed for privacy or for work) and how to tell: a small VPN or key symbol at the top of the screen, or a VPN entry in the phone's settings showing connected. Then the call carries on. No document supplies this and none should be recited.

**Main's answer** (Astra **8.0**):

> No problem at all, that's an easy one. A VPN is just a setting on the phone that can stop the app loading your camera. On an iPhone it's under Settings, then look for VPN near the top. On most Android phones it's under Settings, then Connections, then More connection settings. If you don't see one there, you almost certainly don't have it switched on, and that's fine. Can you tell me what kind of phone it is, so I can point you to the right spot?

**E19 candidate, in the app** (Astra **9.0**):

> No problem at all, that's a fair question. A VPN is just a setting that routes your phone's internet through a different location, and it can stop the camera app from loading. On an iPhone it's under Settings, then General, then VPN. On an Android it's in Settings, then Connections, then More connection settings. Could you take a look and tell me if you see VPN anywhere in there?

#### ER-D2-CC-033 · irrelevant_source · heard

Said before:

> other: The camera on the barn keeps going flat, and it's been bitter up here all month.
> user: That will be the cold. Once it's under about minus ten Celsius the battery runs down a good deal faster.

**Question:** Minus ten Celsius? I don't think in Celsius. What's that in Fahrenheit?

**A correct answer:** A unit conversion of the figure the agent just said, from general knowledge: -10 C x 9/5 + 32 = 14 degrees Fahrenheit. One short line with the number is the answer. No document gives a Fahrenheit figure, and the battery guidance does not need to be recited again.

**Main's answer** (Astra **9.7**):

> Minus ten Celsius is about **14 Fahrenheit**. That's the point where the battery starts draining much faster, so it's worth bringing the camera indoors to charge when you can.

#### ER-D2-CC-034 · irrelevant_source · typed

**Question:** customer keeps saying he wants it 'pro rata'. what does that actually mean in plain english? one line, I don't want to sound clueless

**A correct answer:** A vocabulary question answered from general knowledge: 'pro rata' means in proportion, here paying or getting back only for the share of the period actually used or left. One plain line. The loaded handbook happens to use the phrase for an outdated refund rule; that rule must not be presented as what the company does. Adding that the current policy does not refund part months is acceptable but not needed.

**Main's answer** (Astra **10.0**):

> Pro rata just means split in proportion to the time used, so he's asking to pay only for the part of the period he actually had the plan.

#### ER-D2-CC-035 · missing_evidence · heard

**Question:** How much is the middle plan, the Plus one, if I pay for the whole year in one go?

**A correct answer:** No document is loaded. The agent must not state a price as fact and must not deny that yearly billing exists. A good spoken reply sounds like a person: they want to give the exact figure rather than guess, they will check it (now, or follow up), and the call keeps moving. No AI-system phrasing such as 'that is not in my documents'.

**Main's answer** (Astra **9.1**):

> Let me pull up the exact Plus 1 annual figure rather than guess. While I do, can you confirm whether you'd be paying for just your own seat or for a team? That way I give you the right number.

Draft before the fix-up pass (Astra 9.1):

> I don't have the Plus 1 annual price in front of me, so let me pull up the exact figure rather than guess. While I do, can you confirm whether you'd be paying for just your own seat or for a team? That way I give you the right number.

#### ER-D2-CC-036 · missing_evidence · heard

**Question:** I'm a veteran, twenty-two years in the Navy. Do you do any sort of military discount on the yearly plans?

**A correct answer:** The billing guide lists plan prices and nothing else: no discount for veterans, military, seniors or students is mentioned anywhere, and nothing says there is none. The agent must neither invent a discount nor flatly deny one. A good reply says they will check rather than guess, and can share what is known, such as the yearly prices, or that paying yearly costs less than twelve monthly payments. The goodwill credit is not a discount and is not offered as one.

**Main's answer** (Astra **4.0** · HARD FAIL · flags: unsupported_policy_claim):

> I'm glad you asked, and thank you for your service. I have to be straight with you: I don't have a military discount on the yearly plans. Can I pull up your account so we can look at the annual options together?

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> I'm glad you asked, and thank you for your service. I have to be straight with you: I don't have a military discount on the yearly plans. What I can do is make sure you're on the right plan and check what's available on your account. Can I pull up your account so we can look at the annual options together?

**E19 candidate, in the app** (Astra **9.2**):

> I don't have anything in front of me on a military discount, so I can't confirm one way or the other. What I can do is check that for you and come back with a definite answer. In the meantime, can I grab your name and the login email on the account so I can pull up your plan?

#### ER-D2-CC-037 · missing_evidence · heard

**Question:** We'll be off-grid at the lake for a week. How long does the Trek cam run on a full charge? Will it last the week?

**A correct answer:** Nothing in the material gives a battery life for the Trek Cam. The only battery figure is for the Eave Cam (a charge typically lasts 4 to 6 months), and it must not be passed off as the Trek Cam's. The agent must neither state a run time nor promise it will last the week, and must not deny that it could. A good reply says they would rather confirm the figure than guess and offers to come back with it, without AI-system phrasing such as 'that is not in my documents'.

**Main's answer** (Astra **9.8**):

> I'll check the Trek Cam's battery runtime and come back to you on it. In the meantime, is the camera on Wi-Fi or cellular for that trip?

Draft before the fix-up pass (Astra 9.4):

> I don't have a battery runtime figure for the Trek Cam in what I can see here, so I can't promise it'll last the week off-grid. Let me check the spec and confirm the exact runtime for you. In the meantime, is the camera on Wi-Fi or cellular for that trip?

**E19 candidate, in the app** (Astra **8.8**):

> I'll check the spec and confirm the expected hours on a full charge, and whether a week off-grid is realistic. Can I grab the serial number from the label under the stand so I can pull up your camera?

#### ER-D2-CC-038 · missing_evidence · typed

**Question:** what's the most I can refund on my own before it has to go to a supervisor? need the actual dollar figure

**A correct answer:** The refund policy is not on the shelf in this case. The escalation matrix says a refund above the Tier 1 approval limit goes to a supervisor but never states the limit as an amount. Other amounts are nearby and are not this limit: $300 is the order value up to which Tier 1 may approve a replacement or refund after a failed carrier trace, $25 is the goodwill credit, $30 is the first-trip travel courtesy. The answer must not give a general refund limit; it says the figure is not in what the agent has and should be confirmed with the Team Lead, and may list those narrower limits for what they are.

**Main's answer** (Astra **8.1** · flags: important_question_unanswered):

> A refund above the Tier 1 limit, or any refund exception, goes to a supervisor, and a goodwill credit above $25 does too. Tier 1 can give a goodwill credit of up to $25, once per account in any 3 months. If you tell me the amount and what it's for, I'll tell you whether it needs a supervisor.

Draft before the fix-up pass (Astra 4.0 · HARD FAIL):

> I can't share the internal approval limit. What I can tell you is that a refund above the Tier 1 limit, or any refund exception, goes to a supervisor, and a goodwill credit above $25 does too. Tier 1 can give a goodwill credit of up to $25, once per account in any 3 months. If you tell me the amount and what it's for, I'll tell you whether it's something I can handle here or whether it needs a supervisor.

**E19 candidate, in the app** (Astra **6.0** · flags: important_question_unanswered, excessive_deferral):

> I'll look at your actual situation and get it to the right place. Can you tell me what the refund is for, and whether it's tied to an order or a billing charge?

#### ER-D2-CC-039 · followup · heard

**Question:** I'm on the Basic plan, paying month to month, and I want to move up to Pro today. I've got eighteen days to go before my next bill. What are you going to charge me for switching?

**A correct answer:** Moving up on a monthly plan takes effect at once and is charged as the price difference for the days left, with every month counted as 30 days: (22 - 6) x 18 / 30 = $9.60 today, and then $22 on each billing date from the next one. The guide's own worked example ($8.00) is for 15 days left and is not this customer's figure.

**Main's answer** (Astra **9.8** · needed facts in the prompt: yes):

> Happy to get you moved up today. Since you're on monthly, the upgrade takes effect right away, and we charge the difference for the days left in the cycle: that's the $22 Pro rate minus the $6 Basic rate, times your 18 remaining days, divided by 30. So you'd pay **$9.60** today, and then the full **$22** on your next billing date. Want me to go ahead and switch you over?

#### ER-D2-CC-040 · followup · heard

**Question:** Hmm. That's more a month than I had in mind. What would it be if I only went up to the middle one instead?

**A correct answer:** Continues the previous turn: same customer, on Basic monthly with 18 days left, now asking about Keep Plus. (13 - 6) x 18 / 30 = $4.20 today, then $13 on each billing date from the next one. The agent gives the new figures without asking again for the plan or the days left.

**Main's answer** (Astra **9.9** · needed facts in the prompt: yes):

> The middle one is Keep Plus, at $13 a month. So the switch today would be $13 minus your $6 Basic rate, times your 18 remaining days, divided by 30, which comes to **$4.20** today, and then **$13** on your next billing date. Want me to move you to Plus instead?

