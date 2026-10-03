# Handoff — Natively 9-mode answer quality and speed (written 2026-10-03 06:20 UTC)

Read this first in a new session. It says where things stand, what Evin has decided, where every file is, and how
to run each tool. The long records it points to:

| File (all under `benchmarks/natively-answer-quality/` in the harness worktree) | What it is |
|---|---|
| `docs/REPORT-ASTRA.md` | The report: outcome, scores per mode, hard fails, validators, latency, verifier rates, 20 worst answers, weaknesses, next steps. Section 0 is the latest status. |
| `docs/ITERATIONS-ASTRA.md` | The log, in order: every change tried, its evidence, each rule written before the data, each verdict. 2,100 lines; the last 600 are 2026-10-02/03. |
| `docs/ITERATIONS-QA.md` | Every DEV question with the app's answer in each of 20 runs, the judge's score where judged, and what each iteration changed. Regenerate with `node tools/iterations-qa.mjs`. Dev only: the blind sets are never listed. |
| `docs/BLOCKERS-ASTRA.md` | The architectural items, each with measurements, a proposal, benefit and risk. |

## 1. Where things stand

* **Kept build: fix13 = app commit `e000db4a`, branch `fix/aq-astra-i5`. Not landed on main.** Nothing from this
  work is on main; landing is Evin's decision.
* **Scores, start → kept build, every answer judged on both sides (gpt-6-astra, charter v2):**
  dev 7.76 → 8.54 (+0.78 ±0.22), hard fails 89 → 37 of 360; holdout 7.92 → 8.47 (+0.55 ±0.25), 61 → 31 of 270.
* **The 9.5-per-mode target is not reachable this way.** Answers with no flagged failure average 9.28 (dev) and
  9.26 (holdout). No mode is at 9.5.
* **Every prompt-level candidate of the last round failed its pre-written rule.** Nothing new was built.
* **Evin's decisions (do not reopen without being asked):**
  1. Judge is gpt-6-astra only. A Fable-judge trial was withdrawn; its files (`abs-*-f1`, `*.judged-fable.jsonl`)
     are a record, never results.
  2. Generator stays on the DIRECT DeepSeek key (2026-10-02).
  3. No reasoning ("thinking") in the generator: "the point of natively is to answer fast" (2026-10-02).
  4. The awaited local rerank on heard turns stays: "keep as today" (2026-10-03).
  5. The discarded second reference lookup stays too: "Leave everything as it is" (2026-10-03).
* **Nothing is running.** No app, no judge chain armed, no scheduled wake. Free disk 6.8 GB at 06:10 UTC.

## 2. Rules the next session must keep

* **Keys.** Never print, log, commit or copy a key value, not even a prefix. Load by parsing the env file; never
  pass a key on a command line. Variable NAMES are fine.
* **Judge.** gpt-6-astra only. If it is not listed or is out of quota: stop and report, never substitute. The
  calibration gate (23 of 25) runs before any batch. A judgment from a key that was not calibrated in that batch is
  not pooled.
* **Holdout and the final set are blind.** Aggregates only; never print a holdout or final row or id. (Exception
  already made and logged: the final set's 116 Call Center rows were judged in aggregate for I29.)
* **Rules before data.** Write the keep/revert rule in `docs/ITERATIONS-ASTRA.md` and commit it before the rows
  are judged. Apply it as written. Objective validators outrank the judge.
* **Laptop.** One app at a time, never two. Before an app run: `pgrep -f scripts/dev-agent.mjs` must be empty and
  free disk at least 4 GB. After it: stop the app through its launcher (SIGTERM to the `dev-agent.mjs` process whose
  cwd is the app worktree), delete that worktree's `dist-electron` and `.agent/userdata`, remove any copied model
  weights. Other sessions' build output is theirs: list it for Evin, do not delete it. No large downloads.
* **Nothing lands on main without Evin.** Speed changes that alter behaviour go to Evin first (standing constraint
  from the performance audit: no behaviour changes, one fix at a time).
* **Project rules** (`CLAUDE.md`): macOS + Windows contract, completion-report format with the exact validation
  categories, graph tools before grep, `ctx7` for library docs. Commit trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 3. Models and keys

| Role | Model | Route | Key (variable NAME only) | Where the key is |
|---|---|---|---|---|
| Judge | `gpt-6-astra` | AgentRouter, `https://agentrouter.org/v1/chat/completions`, header `originator: codex_cli_rs` (approved by Evin) | `AGENTROUTER_API_KEY`, `AGENTROUTER_API_KEY_1` (the client fails over between them) | `/Users/evin/natively-cluely-ai-assistant/.env` (main repo root) |
| Generator (the app's answers, and replays) | `deepseek-flash`, temperature 0.2, `thinking: disabled` | DeepSeek's own API, `https://api.deepseek.com/chat/completions` | `DEEPSEEK_API_KEY` | same file |
| Claim verifier (the app's post-answer pass) | `deepseek-flash` | same | same | same |
| Reasoning timing study only | `deepseek-v4-flash` | AgentRouter `/v1/messages` (Anthropic format, streaming) | `AGENTROUTER_API_KEY_1` | same file |

* Judge charter: v2, id `c725615a54f6` (`astra/CHARTER.md`). Result sets: `astra/out/abs-dev-c2`,
  `abs-holdout-c2`, `abs-sb-c2`; replay judgments `results/replay/<name>.judged.jsonl`. Judge cache: `astra/cache/`.
* The judge is rationed: batches open at 02:00 and 11:00 UTC; `402 Budget pool quota has been exhausted` means the
  pool is spent until the next batch. A judgment costs about 3 units of the AgentRouter balance.
* On AgentRouter's DeepSeek route only `output_config: {effort: "low"}` shortens reasoning; `reasoning_effort` is
  ignored there.

## 4. Where the code is

| Worktree | Path | Branch / commit | Notes |
|---|---|---|---|
| Harness | `/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix` | `fix/aq-astra`, HEAD `34998ce7` (+ this file) | `benchmarks/natively-answer-quality/` is gitignored: new files need `git add -f` |
| App | `/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix2` | checked out on `fix/aq-astra-i5` (`e000db4a`), clean, no build output | `npm run dev:agent` rebuilds `dist-electron` (1.3 GB) from the working tree |
| Main checkout | `/Users/evin/natively-cluely-ai-assistant` | `main` at `e931e8ee`, with OTHER sessions' uncommitted changes | read-only for this work |

App branches (all unmerged):
* `fix/aq-astra-i5` = `e000db4a` — **the kept build** (fix13).
* `fix/aq-astra-i6` = `c399f399` — Looking-for-work fallback rule + Call Center and Sales no-document notices. Not
  kept (rules failed).
* `fix/aq-astra-i7` = `3b0c1a4f` — reasoning on typed Technical interview / Lecture turns. Not kept (rule failed, and
  Evin rejected reasoning). Its code comment and commit message cite the withdrawn Fable judge.

## 5. How each mode stands (kept build)

Judged means, start → kept build, paired, with hard fails; and the mean of answers with no flagged failure ("clean"),
which is the ceiling of fixing failures.

| Mode | Dev: start → kept | gain (95 %) | hard fails | Holdout: start → kept | gain (95 %) | hard fails | Clean mean dev / holdout |
|---|---:|---:|---:|---:|---:|---:|---:|
| General | 7.88 → 8.59 | +0.71 (±0.74) | 11 → 4 | 8.46 → 8.97 | +0.51 (±0.54) | 5 → 1 | 9.24 / 9.33 |
| Sales | 6.89 → 8.44 | +1.55 (±0.70) | 17 → 3 | 7.38 → 8.49 | +1.11 (±0.81) | 9 → 3 | 9.00 / 9.10 |
| Recruiting | 8.34 → 9.01 | +0.68 (±0.41) | 3 → 1 | 7.95 → 8.86 | +0.91 (±0.68) | 4 → 2 | 9.41 / 9.27 |
| Team Meet | 8.38 → 9.16 | +0.78 (±0.49) | 6 → 1 | 8.79 → 8.62 | −0.18 (±0.61) | 4 → 4 | 9.39 / 9.44 |
| Looking for work | 6.81 → 7.92 | +1.11 (±0.61) | 19 → 7 | 6.53 → 7.74 | +1.21 (±0.80) | 16 → 7 | 9.25 / 9.19 |
| Lecture | 8.81 → 8.89 | +0.08 (±0.50) | 3 → 4 | 8.87 → 8.80 | −0.07 (±0.59) | 2 → 3 | 9.53 / 9.49 |
| Technical interview | 7.50 → 8.21 | +0.71 (±0.87) | 9 → 9 | 7.86 → 8.46 | +0.60 (±0.95) | 7 → 3 | 9.55 / 9.26 |
| Seminar | 8.66 → 9.02 | +0.35 (±0.50) | 4 → 1 | 8.16 → 8.36 | +0.19 (±0.63) | 4 → 3 | 9.42 / 9.30 |
| Call Center | 6.56 → 7.63 | +1.06 (±0.79) | 17 → 7 | 7.24 → 7.93 | +0.69 (±0.89) | 10 → 5 | 8.54 / 8.94 |
| **All** | 7.76 → 8.54 | +0.78 (±0.22) | 89 → 37 | 7.92 → 8.47 | +0.55 (±0.25) | 61 → 31 | 9.28 / 9.26 |

What holds each mode back (dev hard-fail flags, kept build):
* **Looking for work** (7): invented personal claims and stories, questions only the user can answer. Needs stored
  personal answers, not a rule.
* **Call Center** (7): invented policy when no policy document exists; clean answers are also the lowest (8.54).
* **Technical interview** (9) and **Lecture** (4): the generator's own reasoning, arithmetic and complexity errors.
* **General** (4), **Sales** (3): arithmetic / unsupported company claims / a conflict in the material ignored.
* **Recruiting, Team Meet, Seminar** (1 each): an occasional invented personal or research claim.

Other measured facts about the kept build: first word unchanged against the start (about 0.87 s at the median in
the app); the settled answer comes 0.5–0.7 s later because of the claim pass, which replaces the shown text on
24–31 % of turns; on the answers it edits the pass lifts dev 6.58 → 7.72 and holdout 5.87 → 7.55 and clears most
hard fails.

## 6. The iterations

46 changes were tried; 26 are in the kept build, 20 were rejected, taken back or not built. Each one, with its
evidence, is in `docs/ITERATIONS-ASTRA.md` and summarised in section 3 of `docs/ITERATIONS-QA.md`.

**In the kept build (26):** I1 small corpus read whole · I2 hidden arithmetic scratch block · I3 the user's own
life is remembered, not checked · I4 the recruiting hotkey is the interviewer's spoken words · I5 own-life rule only
in the job modes · I6 a heard question about the user's own life is theirs to answer · I7 no product material → no
product facts · I8 claim verifier · I8b no-document product clause · I8c highlights kept, formatting-only edit is
no edit · I9 Recruiting heard turns never plan as coding · I10 Call Center states the rule, then verifies · I11
"Today" line · I13 Team Meet wording (superseded by I15) · I14 document freshness status · I15 spoken replies do
not open by reporting their notes · I16 no question handed back when something answers · I18 the verifier lists,
then rewrites; Team Meet and Recruiting verified · language rail · I21 every spoken General turn verified · I22
every Seminar turn verified · tidy edits · claim kinds · source-word rail · I25 Seminar study scope · I26 a typed
"shorter" / "simpler" / "another one" revises the previous reply.

**Rejected, taken back or not built (20):** conflict wording · past-event notice · "use the specifics" · I13
wording in the app · I17 removing the Today line · scratch-v2 · I19 technical second look · I20 missing-facts line ·
I23 "what to say instead" · I24 early stop · a larger generator · the general honest-limit exemption · "an older
version is not a conflict" · "keep every can't" in Call Center · gate-v2 · a Lecture voice rewrite · I28 reasoning
on typed Technical interview / Lecture turns · the Looking-for-work fallback rule · the Call Center "no policy on
file" notice (twice: the dev pair, then I29) · the Sales reply-shape notice.

## 7. What this session did (2026-10-02 → 10-03), in order

1. **Two AgentRouter keys.** `astra/client.mjs` fails over between them; `astra/probe.mjs` probes both;
   `astra/client-keys.test.mjs` (offline) covers it.
2. **Generator route.** DeepSeek through AgentRouter measured at about one judgment's cost per answer; Evin chose to
   keep the direct key.
3. **fix16 app run** (Call Center + Sales notices): clean, notice on exactly the heard no-document turns.
4. **Disk guard.** Free disk fell to 0.8 GB and later 0.29 GB during another session's build. `astra/store.mjs`
   (tolerant `.jsonl` reads, atomic cache writes); the client holds judge calls under 300 MB free
   (`AQ_DISK_FLOOR_MB`, up to 20 minutes), `queue3.mjs` stops on a full disk.
5. **The 11:00 UTC batch of 10-02.** Calibration 25 of 25. Four dev replay pairs judged, none met its rule:
   reasoning typed +0.18 (±0.25); Looking for work +0.15 (±0.33); Call Center +0.42 (±0.48); Sales +0.31 (±0.36).
   fix13 against fix12 on its re-run rows: +1.13 dev, +1.07 holdout (kept).
6. **Starting column judged in full** → the headline numbers in section 1. Report sections 0, 1, 3–7, 9, 10
   rebuilt (`astra/final-report.mjs`, `astra/paired.mjs`).
7. **Claim pass measured** on its edited rows (draft against shown), dev and holdout.
8. **Candidates' app rows judged** (reported only): they agree with the verdicts; the Sales notice reads negative in
   the app; the same code sampled twice differs by ±0.5 on 40 rows.
9. **I29.** The Call Center notice tested once more on the final set's 116 Call Center rows, split in halves, three
   samples per row, rule written first: decision half +0.67 (±0.42) pass, confirmation half +0.18 (±0.25) fail.
   Not promoted.
10. **Reasoning's time cost**, 431 prompts through AgentRouter DeepSeek: first answer token 1.17 s off, 2.49 s low
    effort, 3.69 s default; hard questions 1.24 / 3.12 / 4.46 s. Evin: not built.
11. **Speed.** On heard turns the app waits before it sends the request (about 0.2 s at the median, 0.3 s with a
    profile). Traced with the app's own stage traces to the bundled cross-encoder rerank (about 250 ms, one core,
    17 ms per passage on this M4, no GPU). With it off: heard first word 1.08 → 0.81 s, retrieved passages identical
    on 89 of 93 rows, app memory 1,110 → 936 MB. Evin: keep as today.
12. **Rig finding.** The default embedder's weights (`Xenova/multilingual-e5-small/onnx/model_quantized.onnx`) are
    missing in every checkout, so every benchmark run had failed query embeds and seeded profile entries. With the
    embedder working the judged score did not rise (120 dev rows: 8.38 → 8.24, −0.15 ±0.25), so the report's
    numbers stand.
13. **A second, discarded reference lookup** on V3 heard turns (`WhatToAnswerLLM.ts` builds the legacy packet, awaits
    the same rerank, about 190 ms, and throws it away; the heard path declares data scopes from it rather than from
    V3's `packedDataScopes`). Evin: leave everything as it is. Not changed.
14. **Observed, not investigated:** when DeepSeek stalls, a heard turn waits 12–16 s and shows "The model did not
    produce an answer in time, so I won't guess from your profile." (6 of 120 turns in one bad ten minutes).

## 8. The benchmark

| Set | Items | Role | File |
|---|---:|---|---|
| dev | 360 (40 per mode) | development; rows may be read | `dataset/dev.json` |
| holdout | 270 (30 per mode) | blind confirmation; aggregates only | `dataset/holdout.json` |
| supp-behavior | 72 | behaviour validators | `dataset/supp-behavior.json` |
| supp-quant | 32 | arithmetic validators | `dataset/supp-quant.json` |
| final | 1,038 (about 116 per mode) | regression read, objective only; its Call Center rows were judged in aggregate for I29 (`dataset/final-split-call-center.json`) | `dataset/final.json` |

* **Questions:** in the dataset files above (`items[].question`, with mode, surface `hotkey` = heard / `typed`,
  context and oracles).
* **Answers of every run:** `results/<run>/natively_benchmark_full.jsonl` (`raw_answer` = streamed draft,
  `rendered_answer` = shown after the claim pass; timings `ttft_ms`, `total_latency_ms`, `request_dispatch_ms`);
  the prompt sent: `natively_benchmark_wire.jsonl` + `systems.json`.
* **Runs:** dev `aq2-dev-cur` (start), `aq2-dev-fix1` … `fix16`; composites of the kept build `aq2-dev-fix13c`,
  `aq2-holdout-fix13c`; holdout start `aq-holdout-fix2`; final `aq-final-base`, `aq2-final-fix6`, `aq2-final-fix13`;
  speed runs `aq2-dev-emb1…4`, `aq2-dev-rron1`, `aq2-dev-rroff1` (not judged); replays in `results/replay/`.
* **Side by side:** `docs/ITERATIONS-QA.md` (dev questions × 20 runs).
* **Measurement limit:** a difference under about ±0.5 on 30–40 items is not a result. Deciding a +0.3 change needs
  about four times the items per mode or several samples per item (I29 did that for one mode).

## 9. How to run things (from `benchmarks/natively-answer-quality/`)

```
node astra/probe.mjs > /dev/null; node -e "…read astra/probe-result.json"   # is the judge open? statuses only
node astra/arm.mjs <tag> --not-before <ISO> --wait-ms 172800000 [--from-tier N]   # detached: probe, queue3, report
node astra/queue3.mjs [--from-tier N] [--all]        # tiers; calibration first; --all adds the long reported-only tail
node astra/decide.mjs ; node astra/promote.mjs       # the written rules on replay pairs / on candidates' app rows
node astra/paired.mjs <A.jsonl> <B.jsonl>            # per-mode paired difference with intervals
node astra/final-report.mjs --suffix -c2 --start aq2-dev-cur --kept aq2-dev-fix6 --final aq2-dev-fix13c \
     --holdout-start aq-holdout-fix2 --holdout-kept aq2-holdout-fix6 --holdout-final aq2-holdout-fix13c \
     --verifier tools/variants/_claimVerifier-fix12.mjs --worst 20
node astra/headroom.mjs astra/out/abs-dev-c2/aq2-dev-fix13c.jsonl
node astra/judge.mjs --set abs-dev-c2 --runs results/<run> --concurrency 8
node astra/judge-replay.mjs --replay results/replay/<name>.jsonl --run results/<source run> [--aggregate]
node tools/replay.mjs --run <run> --mode m1,m2 | --ids A,B --variant <file>|none --name <out> --n 1
node tools/verifier-replay.mjs --run <run> --module tools/variants/_claimVerifier-fix12.mjs --name <out> --answers <replay.jsonl>
node tools/replay-carry.mjs --run <run> --variant <file> --base <name> --from <name> --name <out>
node tools/iterations-qa.mjs                          # rebuild docs/ITERATIONS-QA.md
node tools/prompt-diff.mjs <run A> <run B> [--list]   # is the prompt / the retrieved passages the same in two runs
node tools/latency-reasoning.mjs --name <out> [--report]      # streaming timing through AgentRouter DeepSeek
node tools/local-model-cost.mjs --models <dir> --e5 <dir>      # reranker / embedder CPU and memory on this machine
node --test astra/*.test.mjs                          # 27 offline tests of the harness
```

An app run (one at a time):
```
NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env CODEX_HOME=<an empty dir> \
  [MEASURE_LATENCY=true] [NATIVELY_H4_STAGE_TRACE=1] SUPERVISE_LOG_DIR=<dir> \
  node tools/supervise.mjs --root <app worktree> --runs dev:<run-id>:<mode+mode> --fresh-userdata
```
Traps, each of which cost time once:
* `NATIVELY_ENV_FILE` must be set or `run.mjs` exits at once.
* `CODEX_HOME` must point at an empty directory: the app's AI Providers pane switches Codex on by itself when it
  finds a `codex login`, and profile extraction then goes through an LLM instead of the fixed path.
* In zsh, `$run:looking…` is a modifier — write `${run}:…`. zsh does not split unquoted variables. `pgrep -f X`
  also matches your own waiting shell if its command line contains X.
* For production-like retrieval copy the model weights in, and remove them afterwards: `rsync -a --ignore-existing`
  from the main checkout's `resources/models/`, plus the embedder from
  `~/Library/Application Support/natively/embedding-experiments/multilingual-e5-small/Xenova/multilingual-e5-small/onnx/model_quantized.onnx`.
* The app's own traces: `MEASURE_LATENCY=true` (`PI LATENCY TRACE`, `[LATENCY]` stages; "stage 3 truncation"
  actually contains the legacy reference retrieval), `NATIVELY_H4_STAGE_TRACE=1` (hybrid retriever stages), and the
  `[V3] {…}` line per turn (`retrievalMs`, sources, candidates).
* `NATIVELY_RAG_LOCAL_RERANK=0` switches the bundled rerank off (measurement only; Evin kept it on).
* A whole-run app comparison has about ±0.5 of re-run noise; carry unchanged rows (replay) or use several samples.
* Check the run for provider stalls before reading it (`finish_reason` null, first word over 5 s).

## 10. What is left, and whose it is

For Evin (decisions, in the report's section 10):
1. Land `fix/aq-astra-i5` (`e000db4a`)? It adds 0.5–0.7 s to the settled answer and swaps the shown text on
   24–31 % of turns, for +0.55 on holdout. Kill switch: `NATIVELY_CLAIM_VERIFIER=0`.
2. The personal answer bank (the only item that moves Looking for work toward 9).
3. Code verification gating the coding answer.
4. A larger dev set per mode, or samples per item, before any further round of small changes.

Not decided, noted only: the 12–16 s wait when the provider stalls.

Not verified: Windows (never executed), a packaged build, the text swap as a user sees it in the overlay.

## 11. Memory

The session memory for this work is
`~/.claude/projects/-Users-evin-natively-cluely-ai-assistant/memory/answer-quality-astra-loop-2026-09-30.md`
(indexed in `MEMORY.md`), with `feedback-answer-fast-no-reasoning.md` and `feedback-judge-gpt-6-astra-only.md`.
