All paths are relative to the repo root.

| What | Path |
|---|---|
| This report | `benchmark/reports/REPORT.md` |
| Blind human review (per conversation, run 1 of each config, shuffled letters) | `benchmark/reports/HUMAN_REVIEW_INDEX.md`, `benchmark/reports/human-review/*.md`; letter key `benchmark/reports/review-key.json` |
| Per-run metrics (all runs incl. retries) | `benchmark/results/runs.jsonl`, `benchmark/results/runs.csv` |
| Runs used in aggregates | `benchmark/results/runs-selected.jsonl` |
| Aggregates, CIs | `benchmark/results/aggregates.json` |
| Orchestrator job index | `benchmark/results/runs-index.jsonl`, `benchmark/raw/orchestrator.log` |
| Full pipeline outputs (summary object, per-call timings, compressed raw model output, events) | `benchmark/outputs/<config>/<conversation>/run<N>.json` |
| Judge evaluations | `benchmark/evaluations/<config>/<conversation>/run<N>.json` |
| Provider wire logs (params, usage, model, latency; no text, no keys, no reasoning) | `benchmark/raw/wire/<config>.jsonl` |
| natively-api server logs | `benchmark/raw/server-logs/<config>.log` |
| Transcripts (authored/caption source + Natively segments) | `benchmark/transcripts/src/*.txt`, `benchmark/transcripts/*.segments.json` |
| Gold fact sheets | `benchmark/references/*.json` |
| Corpus manifest / config / pricing | `benchmark/manifest.json`, `benchmark/config.json` |
| Harness (shim, worker, orchestrator, judge, analysis, report) | `benchmark/harness/` |
| Smoke-test artefacts (excluded from results) | `benchmark/raw/smoke-archive/` |
