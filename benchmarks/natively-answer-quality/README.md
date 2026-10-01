# Natively answer quality (9 modes)

Measures and grades Natively's realtime answers across all nine modes on the real app, with a blind judge.
Built for the 2026-09-30 answer-quality work (merge `d327f6a8` on main; fixes on branch `fix/answer-quality-9modes`).

## Layout

```
dataset/
  AUTHORING-v2.md          brief the question authors followed (inputs only, no expected answers)
  categories.json          categories per mode
  pi/profiles.json         synthetic résumé + job-description profiles (PI-A, PI-B)
  dev/ holdout/ final/     authored sources (holdout and final written by agents that never saw dev)
  v1-annotations.json      needles / claim types for the frozen 848-question v1 set (sidecar; v1 unchanged)
  build.mjs                compiles sources into frozen, hashed dev.json / holdout.json / final.json
  dev.json holdout.json final.json   FROZEN partitions (run.mjs refuses a modified file)
lib/                       CDP driver, app driver (modes, reference files, PI seeding), objective metrics
run.mjs                    drives a real `npm run dev:agent` instance through the hotkey and typed paths
latency.mjs                paired A/B latency: same questions, two running instances, ABBA order
export-md.mjs              every question with every iteration's answer and timing, as one Markdown file
judge/
  CHARTER.md               the judge charter (dimensions, hard flags, caps, mode rules)
  JUDGE_TASK.md            instructions each judge subagent receives
  pack.mjs                 blind batches (no run ids; same item from two runs never in one batch)
  score.mjs                official overall = weighted dimensions + hard caps, computed in code
  batches/ maps/ out/      judge inputs, id maps (kept outside the batches), judge outputs
report/                    build.mjs (aggregate → data.json), render.mjs + content.mjs (report page)
docs/ARCHITECTURE.md       traced architecture of the answer engine at 04333d2d
results/<run>/             run.json header + natively_benchmark_full.jsonl rows (+ logs)
```

Not committed (kept locally, regenerable only by re-running): `results/*/natively_benchmark_wire.jsonl` and
`systems.json` (raw provider request/response captures, 31 MB), and aborted or superseded partial runs.

## Run

```sh
# 1. an isolated app instance from the checkout to measure (no .env in that checkout)
cd <checkout> && NATIVELY_E2E=1 NATIVELY_PROMPT_DEBUG=1 npm run dev:agent
# 2. a partition against it (reads DEEPSEEK_API_KEY from the repo .env; one key → deepseek-flash)
NATIVELY_ROOT=<checkout> node benchmarks/natively-answer-quality/run.mjs --partition dev --run-id <id>
#    --mode a,b   --id X,Y   --resume <id>   --plan
# 3. judge: pack blind batches, have isolated judges fill judge/out/<set>/, then score
node judge/pack.mjs --name <set> --runs results/<run>[,results/<run2>]
node judge/score.mjs --name <set>[,<set2>] --worst 10
```

Judge noise (60 items re-judged): mean |Δ| 0.46, severe-flag agreement 57/60, about ±0.1 on a 40-item mode mean.
Wrap long runs in `caffeinate -i` on macOS: a machine sleep drops the CDP connection mid-run.
