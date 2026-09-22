# Embedding / retrieval benchmark harness

Reproducible scripts behind `docs/embedding-benchmark-report.md` and
`docs/reranking-benchmark.md`. Results in `results/*.json`.

**Credentials come from env/.env only — never committed.** Scripts read
`NATIVELY_API_KEY` from `natively-api/.env` and `OPENROUTER_API_KEY` from `.env`.

| script | phase | what it does |
|---|---|---|
| `corpus.mjs` | 22 | corpus + question generator with EXACT ground truth (4 difficulty tiers) |
| `run.mjs` | 22 | 440-question retrieval benchmark across 4 corpus sizes |
| `ksweep.mjs` | 21 | sweeps retrieval K to locate the reranker's ceiling |
| `rerank_bakeoff.mjs` | 30 | hosted vs local rerankers, local driven through its real worker |
| `phase1_limits.mjs` | 3/17 | where input truncation actually happens (identical-prefix probe) |
| `phase25_chaos.mjs` | 25 | 429/500/502/503/504/400/hang against a stub upstream |
| `measure.mjs` | 23 | one real Electron session: upload → index → question |
| `measure_concurrent.mjs` | 24/35 | three concurrent real clients; fairness |
| `e2e_session.mjs` | — | launch/attach helpers for the Electron drivers |

## Running the Electron drivers

Launch and measurement are **decoupled on purpose** — a launch failure must not
be able to masquerade as a benchmark result.

```bash
npm run build:electron
UD=/tmp/nat-e2e; mkdir -p $UD
cp ~/Library/Application\ Support/Natively/{credentials.enc,settings.json,Preferences} $UD/
NATIVELY_E2E=1 NATIVELY_E2E_REFERENCE_ROOT=benchmarks/fixtures NATIVELY_TEST_USERDATA=$UD \
  node_modules/.bin/electron dist-electron/electron/main.js \
  --remote-debugging-port=9441 --user-data-dir=$UD &
node benchmarks/measure.mjs 9441
```

`NATIVELY_E2E=1` is what registers the `__e2e__:*` handlers and the `e2eInvoke`
bridge; both are absent from shipped builds.

## Safety

These drive **production** `api.natively.software`. Requests are paced to ~1.5/s,
under the 120/min per-key limit. Bulk runs also consume the OpenRouter project's
12M tokens/min ceiling, so a 429 spike during benchmarking is self-inflicted and
should not be read as a customer-facing outage rate.

Fixtures are generated, not committed: `node -e "..."` in the report, or re-run
`corpus.mjs`'s `buildCorpus`.
