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

## 16:38–16:45 — report, figures re-derived

* `EVIDENCE-RICH-QUALITY.md` written. Its figures were recomputed from the row files before the commit; five that
  had been carried from notes were wrong and were corrected (total rows 1,341 not 1,541; recorded facts 1,776 not
  3,300; outdated-value-only cases with E1 1 of 68, not 0; two slice means that mixed sets).
* gpt-6-astra: still not judged anything in this benchmark. The chain (`judge/astra-chain.mjs`) is left armed for
  the next batch window; its output goes to `judge/out/*/…astra.jsonl` and is never pooled with the Opus files.
