# evidence-rich-v1 — session log (2026-10-03)

In order. Times are UTC. Each entry says what was observed, not what was expected.

## 12:11 — start; state taken over

* Read `docs/HANDOFF-ASTRA.md`, `BLOCKERS-ASTRA.md`, `ARCHITECTURE.md`, the judge charter and client.
* The prompt for this session says the kept build is "not landed on main". The handoff says it was landed on LOCAL
  main on 2026-10-03 (merge `98caa240`, not pushed). The baseline here still runs on `e000db4a` itself, in the app
  worktree `aq-fix2`; the merged main was never measured and is not what is measured here.

## 12:13 — judge availability

* `astra/probe.mjs`: both keys list `gpt-6-astra`; the chat step answers 402 "Budget pool quota has been exhausted" on
  `AGENTROUTER_API_KEY` and on `AGENTROUTER_API_KEY_1`. No reset or retry-after value was returned. The handoff's
  observed batch openings are about 02:00 and 11:00 UTC (a hint, not an API fact).
* AgentRouter's model list for these keys: `claude-opus-4-8`, `claude-opus-5`, `deepseek-v4-flash`, `gpt-6-astra`.
  There is no Claude Opus 5.5 on AgentRouter, so the fallback named in the prompt (AgentRouter → Claude Opus 5.5)
  cannot be used as written; neither other Claude id was used.
* Evin, during the session: "use claude codes opus 5.5 not agent routers", then "use claude code as judge, with the
  judge charcter". The fallback judge is therefore Claude Opus 5.5 through the headless Claude Code CLI
  (`AQ_JUDGE=opus`, the route built on 2026-10-03 for the second-judge check). Every judgment carries
  `judge_provider: claude-code-cli`, `judge_family: claude-opus-5.5`, `judge_status: provisional`.

## 12:20 — generator route

* Requested first: AgentRouter → DeepSeek. Observed: the build under test has no AgentRouter provider
  (`setAgentRouterApiKey` occurs 0 times in `aq-fix2/electron/preload.ts`; it exists only on main). Failure class:
  unsupported in the build, deterministic; not retried. Getting the route would mean merging main into the build
  under test, which changes the build, so it was not done.
* Used: direct DeepSeek (`DEEPSEEK_API_KEY`), model `deepseek-flash`, thinking off. Every row records
  `generator_provider`, `generator_model`, `generator_fallback: true`, `fallback_reason`.
* The 20–30 case paired route check (section 85) cannot run through the real app for the same reason. Not done.

## 12:25–13:50 — rig and corpus

* How the product ingests: reference files through `ingestModeReferenceFile` → `extractSafeDocumentText`
  (pdf-parse / mammoth / text); the E2E hook `__e2e__:upload-reference-file-from-path` calls exactly that and only
  accepts paths under `NATIVELY_E2E_REFERENCE_ROOT`. Résumé and JD through `KnowledgeOrchestrator.ingestDocument`
  (`__e2e__:ingest-profile-doc`, a file path). The older `__e2e__:add-reference-file`, which the 9-mode runner uses,
  takes text and skips parsing; it is not used here.
* New runner, build/lint/freeze, funnel and deterministic checks, judge charter, envelope, calibration: see
  `README.md`. Commits `a9533912`, `e82fe1e1`, `088aae8c`, `e66e92a7` on `fix/aq-astra`.
* Smoke (9 cases, scratch) 12:42; rehearsal (21 cases, seven packs, scratch) 13:05: 58 files uploaded, all `ready`,
  1,785 of 1,785 recorded fact strings present in the text the app extracted. Rehearsal numbers are not results.
* Corpus: nine packs authored to `AUTHORING-ER.md` by separate authors, then each checked item by item against its
  documents by a second reviewer. The reviewers found no wrong fact, calculation or authority ruling; they tightened
  match strings, moved a few required facts to optional, fixed two ambiguous questions and three mislabelled
  counterfactual variants. No document was changed in review. One invented name collided across packs (a hotel
  called like a profile employer) and was renamed before the freeze.
* Freeze 13:52: manifest `8aa245098a93`, dev 270, holdout 180, counterfactual 63, isolation 46; 76 documents + 28
  variants. Calibration (Opus 5.5, charter `er1-ebec3e9a021e`): 38 of 38.

## 13:54 — the first launch of the baseline failed (rig, not product)

* The app refused to start: `better_sqlite3.node` and `keytar.node` "built x64, need arm64". The app worktree's
  `node_modules` was a symlink to the main checkout's, and another session's packaging run rebuilt those two modules
  for Intel there at 13:11 (a `release/` folder appeared in the main checkout; the rehearsal at 13:05 had still
  started fine).
* The shared folder was not touched. The worktree got its own copy-on-write clone of `node_modules`
  (`cp -Rc`, no extra disk until files change) and the two arm64 binaries were restored inside the clone from the
  copies that packaging keeps in `bin/darwin-arm64-148/`. `scripts/verify-native-arch.js`: both OK.
* Relaunched 13:56: app up in 24 s, 56 base files uploaded and `ready`.

## 13:56–14:51 — baseline runs on `e000db4a`

* dev 270 (13:56–14:20), counterfactual 63 (–14:28), isolation 46 (–14:34), holdout 180 (–14:51): 559 rows, every
  row answered, no provider failure line, no timeout, no row left with unverified state. Generator on every row:
  `deepseek-direct / deepseek-flash`.
* Judging with the provisional judge started at 14:20 while the later sets were still running in the app, so only
  the dev run's latency is quoted anywhere.
* Baseline read (provisional judge): see `EVIDENCE-RICH-QUALITY.md`. In one line: dev 7.47 overall; 8.98 where the
  needed evidence was in the prompt (101 rows) and 5.69 where it was not (111 rows); holdout 7.40, 8.95 and 5.60.

## 14:45–15:05 — three checks added (rules in `BASELINE-PLAN.md`, committed `86e31940` before they ran)

* `supp-oracle-sources`: 223 dev cases asked again with only the files their oracle names (run 14:52–15:17).
* Drafts: the streamed text of every row whose shown text was replaced by the claim pass, judged (105 rows).
* A leak is counted only when the other text was in the prompt.

## 15:12–15:44 — the app and the supervisor were stopped from outside, three times

* 15:12 and 15:14: the app quit with `[Lifecycle] before-quit reason=user-quit` during the oracle-sources run; the
  supervisor restarted it and the run resumed (223 rows complete at 15:17).
* 15:33: the app quit the same way during the E1 dev run at 189 of 270 rows; at about 15:35 the supervisor process
  itself ended with exit 137 (killed). Not caused by this session: another session's packaging run was active on
  the machine (two `7za` processes at 100 % CPU from the main checkout's `node_modules`, a Playwright Chromium, load
  average 5–7). The run was resumed at 15:45; rows already written are kept.
* Consequence: the E1 runs did not have the machine to themselves. Their latency is reported with that caveat and
  cannot be held against the baseline dev run as strictly as rule 6 of E1 intended.

## 14:57–16:38 — candidate E1 (`fix/er-pack-whole`, `bab77f33`), and what was measured about the claim pass

* Rule committed `da60373d` at 14:57, before the branch's app was started. Worktree `er-fix1`, own clone of
  `node_modules` (same arm64 repair), model weights copied in.
* Runs on E1: dev 270 (15:20–16:02 with the interruptions above), counterfactual 63, holdout 180 (16:08–16:25),
  isolation 46 (–16:31). 559 rows, every row answered, none unverified, generator direct DeepSeek on every row.
* Dev + counterfactual: all six rule lines hold (data committed `1ba9036e`, 16:15). Holdout judged blind after that:
  evidence-required rows +1.01 (±0.49), hard fails 39 → 15. **E1 kept on its branch; not on main.**
* The streamed draft of every replaced row was judged on both builds (baseline dev + counterfactual 86; E1 dev +
  counterfactual 113, holdout 57), so "claim pass off" is exact per row.
* E3 (a rail on the claim pass), rule committed `1ba9036e` before its effect was computed: fails its third line;
  not kept. E4 (skip the claim pass when reference files are in the prompt), rule committed `cb41785f` before any
  E1 holdout row was judged: raises the holdout mean by +0.39 (±0.23) and lets four more hard fails through; fails
  its second line; not recommended as specified. Neither was implemented in the app.
* `supp-oracle-sources` paired with the baseline: rows that had missed 5.63 → 7.54 (+1.91 ±0.52), under the 8.5 /
  +2.0 line set for it; rows already delivered +0.16 (±0.29).

## 16:38–16:50 — report, figures re-derived

* `EVIDENCE-RICH-QUALITY.md` written. Its figures were recomputed from the row files before the commit; five that
  had been carried from notes were wrong and were corrected (total rows 1,341 not 1,541; recorded facts 1,776 not
  3,300; outdated-value-only cases with E1 1 of 68, not 0; two slice means that mixed sets).
* gpt-6-astra: still not judged anything in this benchmark. The chain (`judge/astra-chain.mjs`) is left armed for
  the next batch window; its output goes to `judge/out/*/…astra.jsonl` and is never pooled with the Opus files.
* Verdict stated by the rule committed before the data: A (answer engine), on both sets and on both of A's
  conditions. The first draft of the report had called it "mixed"; that was my reading, not the rule's output, and
  it is now a separate, labelled paragraph.
* The scripts behind the report's tables moved from the session's scratch folder into `report/`, with
  `ER_JUDGE=opus|astra`. The chain now also judges the streamed drafts.

## 17:05–17:15 — Evin's decisions; E1 landed on local main

* Evin chose: land E1 now on local main; redesign the claim pass then measure; raise the 24,000-character cut and
  measure; the app labels dates in the prompt; find the cause of the streamed tool-call markup and fix it.
* E1 cherry-picked onto main in a temporary worktree (`75eb98d6` → `9fce990b`), `typecheck:electron` clean,
  `test:intelligence` 2,858 pass / 0 fail of 2,869, then `git merge --ff-only` in the main checkout; another
  session's uncommitted files there were untouched (status identical before and after). Not pushed. The temporary
  worktree was removed.

## 17:15–19:15 — the four follow-ups Evin chose (branch `fix/er-followups` in `er-fix1`, nothing landed)

* **Root cause of the claim-pass loss found (17:20).** The pass is shown only the first 24,000 characters of the
  answer's prompt on both surfaces, not only on the typed one as first reported. Offline harness built
  (`replay-claim-pass.mjs`, `replay-judge.mjs`): it rebuilds the app's own request (equal to the recorded one on
  every replay) and its system prompt (the recorder kept only a hash; the app's language suffix was recovered from
  a recorded answer prompt and the rebuilt prompt matches the hash on every row).
* **Markup defect (17:40).** No tool was declared on the request. The prompt's calculation notice asks for hidden
  working inside `[[CALC]]`; once in 334 such turns the model wrote it as its own tool-call markup, which the stream
  filter did not know. 24 replays of the recorded request: 0 reproductions. Fixed in the filter with tests
  (`d503ae4f`); on 783 recorded answers the fixed filter changes only that one.
* **E5 (cap 96,000 for the claim pass): offline pass (18:05), commit `441ed80a`.**
* **E6 (CONFLICT step): fails its first line (18:20); not built.** Some replays timed out during a slow spell of
  the provider and were run again once.
* **E7 (date / version labels), commit `9b8c99fa`: failed in the app (18:30) and reverted (`742a7170`).** A holdout
  run of that build had been started early and was stopped at 32 rows, unjudged; its folder was deleted.
* **E5 in the app (run `s3`): dev + counterfactual pass (19:15).** The dev run was killed from outside at 130 rows
  (load average above 20, memory pressure from another session's build) and resumed. A launcher process left over
  from that restart was stopped by hand before the holdout run.
* The machine was shared with another session's builds throughout; latency figures of `s2` / `s3` carry that.

## 19:15–19:55 — holdout of `s3`, verdict

* Holdout 19:14–19:30 (180 rows, none unverified), judged blind. E5's holdout lines hold: the pass's effect
  −0.37 → 0.00, hard fails 15 → 15. **E5 kept on `fix/er-followups`; not on main.**
* Tests on the branch head `742a7170`: `test:intelligence` 2,806 pass / 0 fail of 2,817; `node --test
  electron/llm/__tests__/*.test.mjs` 5,472 pass / 0 fail of 5,490; `typecheck:electron` clean.
* Cherry-pick check against main in a throwaway worktree (removed): the markup fix applies cleanly; E5 conflicts in
  `LLMHelper.replayAnswerCall`, where main has a later change to the same lines. Nothing was landed.
* The gpt-6-astra chain was re-armed with the `s3` runs and their drafts added (`results/astra-chain.log`).

## 19:55–20:45 — Evin's second answers; E2 built and measured

* Evin: land the two fixes after gpt-6-astra confirms (rule written, see `ITERATIONS-ER.md`); leave E6 out; nothing
  in the product for outdated files; build and measure E2.
* The fixes were prepared and tested on top of main as branch `fix/er-followups-on-main` (`be676d88` on `6f00e104`),
  in a throwaway worktree that was removed. Not landed.
* Isolation control `er-iso-s3` run on `742a7170` (20:00) before any E2 edit.
* E2 on branch `fix/er-profile-whole` (`fea39964`): intelligence suites 2,822 pass / 0 fail, llm suite 5,472 pass /
  0 fail, typecheck clean. First cut let the port decide by itself and broke five existing retrieval tests whose
  small fixtures now fit; the plan decides instead (`retrievalPlan.wholeProfile`), and those tests pass unchanged.
* Run `s4` 20:12–20:25 (two profile modes on dev + counterfactual, isolation whole). E2 fails line 4 of its rule
  (profile-fact rows +0.63 ±1.13); delivery, isolation, latency and the other judged lines hold. Holdout not run.
* The gpt-6-astra chain was re-armed at 19:45 with the holdout of `s3` and its drafts moved up to right after the
  baseline / E1 holdout pair.

## 20:50–21:40 — E2 on the blind holdout (Evin's choice), second rule

* Rule committed `b60f4f31` before the run. `er-holdout-s4` (40 rows of the two profile modes), judged blind with
  drafts. All five lines hold; outside them, rows that need no profile fact −0.31 (±0.60), hard fails 3 → 5.
  E2 stays on `fix/er-profile-whole`, not landed.
* A one-shot check was scheduled in this session for 09:43 local on 4 October to apply the "after Astra confirms"
  rule; it exists only while this session is open.

## 2026-10-04 02:00–03:10 UTC — gpt-6-astra's first batch

* Calibration 38 / 38, agreement sample 45, baseline holdout 180, E1 holdout 106 of 180, then 402. The `s3`
  holdout was not reached: no landing decision. Re-armed for the next batch (not before 10:00 UTC); the session's
  scheduled check moved to 18:47 local.
* E1 under gpt-6-astra on the 106 finished pairs: +1.13 (±0.51), hard fails 23 → 6. Judges agree at r 0.84–0.96.

## 2026-10-04 03:10–03:20 UTC — Evin: continue on the provisional judge; the two fixes landed

* gpt-6-astra probed at 03:10: 402 on both keys. The chain was re-armed to probe from now on (14 h).
* On Evin's word the markup fix and E5 were fast-forwarded onto local main (`6f00e104` → `be676d88`), not pushed.
  The session's scheduled task at 18:47 local is now a re-review with gpt-6-astra, not a landing.

## 2026-10-04 03:30 UTC — E2 landed on local main

* First attempt (`3540ed27` on `be676d88`) was refused: main had moved to `ac97c043` (another session, renderer CSS)
  in the seconds between the check and the merge. I had already written "landed" into the docs and memory from a
  truncated command output; corrected. Re-applied on `ac97c043`, re-tested, fast-forwarded to `73a2f89f` and
  verified with `git merge-base --is-ancestor`. Not pushed. Other sessions' uncommitted files untouched.
* Local main now carries E1 (`9fce990b`), the markup fix (`be5b9edd`), E5 (`be676d88`) and E2 (`73a2f89f`).

## 2026-10-04 04:00–05:00 UTC — main measured (M1)

* Fresh worktree `er-main` at `54606ef2` (cloned dependencies, premium from main's pinned commit, model weights).
  dev 04:03–04:24, counterfactual –04:33, holdout 04:38–04:56. 513 rows, all answered, none unverified.
* Every M1 line holds on dev + counterfactual and on the holdout (the holdout's hard fails at the limit).
* The gpt-6-astra chain now takes main's holdout and E2's holdout right after the baseline / E1 pair; the session's
  18:47 task reports on all four landed changes and on main, and reverts nothing.
* Disk fell to 4.1 GB during the dev run (other sessions) and recovered to 16 GB; the run was not paused.

## 2026-10-04 06:00–09:20 UTC — E8, run-to-run variation, E8 (a) landed

* E8 built on branch `fix/er-pack-always` from main `54606ef2`; runs `m2` (paused and resumed at Evin's request),
  `m1r` (the control again), `m2r` (the candidate again), `er-holdout-m2`. Failed its first rule on run-to-run
  variation and its second on line 3 by 0.10.
* `m1r` structured some profile documents with the model (model call timing out at 45 s, then retried): the only
  such run; reason not established.
* 60 holdout judgments failed with "organization has disabled Claude subscription access for Claude Code"; retried
  minutes later without error.
* On Evin's word only (a) landed: `efc126a9` on local main, not pushed.
