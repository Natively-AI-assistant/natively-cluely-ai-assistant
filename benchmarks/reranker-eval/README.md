# Reranker Benchmark

This tool compares reranker candidates for Natively's interview-copilot retrieval path (`ModeHybridRetriever.ts`) on ranking quality (MRR / Recall@k / nDCG), latency (p50/p95), and memory (peak RSS), against a fixed fixture corpus of resumes/JDs and interview-style queries. It exists to inform whether to keep the current local reranker (`bge-reranker-base`), upgrade to a bigger local model (`bge-reranker-large`), or add a hosted reranker (Cohere) — a decision that needs real numbers, not guesses, since reranking sits on the live transcript answer path with a hard latency budget.

## Running it

From the repo root:

```
npm run benchmark:reranker        # full run: builds candidate pools, runs every candidate, then scores
npm run benchmark:reranker:run    # just runs the candidates and writes results/raw/*.json
npm run benchmark:reranker:score  # just re-scores existing results/raw/*.json into results/REPORT.md
```

`benchmark:reranker:run` builds `electron/` first (it loads the compiled `dist-electron` output for the real chunker and `LocalReranker`) and can take several minutes, since it actually loads and runs the local cross-encoder models. `benchmark:reranker:score` is fast (well under a second) — it only reads the already-written JSON in `results/raw/` and re-renders the report, so it's the one to re-run after any change to `score.mjs`'s scoring/rendering logic.

## `git add -f` is required for anything you add here

`benchmarks/` is gitignored repo-wide (see the top-level `.gitignore`), with no working carve-out for this directory. A `.gitignore` negation pattern (`!benchmarks/reranker-eval/`) was attempted and confirmed **not** to work, because of git's documented behavior that a file cannot be re-included if a parent directory is already excluded. Any new file under `benchmarks/reranker-eval/` — source, fixtures, tests — must be staged with:

```
git add -f benchmarks/reranker-eval/<path>
```

or it will silently fail to be tracked (no error, no warning — `git status` just won't show it, and it won't be in your commit). Always check `git status` after staging to confirm the files you expect are actually there.

`results/` is a deliberate exception: it is gitignored on its own (`benchmarks/reranker-eval/results/`), and that exclusion is intentional — see below. Do not `-f` anything under `results/`.

## Pre-warming `bge-reranker-large` before you run this

`bge-reranker-large` (~560MB) is **not** in `scripts/download-models.js`'s manifest — it is not part of the app's normal auto-downloaded model set, unlike `bge-reranker-base`. `LocalReranker.ts`'s hardcoded worker-init timeout (60s) cannot reliably cover a fresh download of a model that size on a typical network, so a first-time run attempting to lazily download it inline is likely to time out rather than succeed.

To avoid a confusing timeout, `runLocalReranker` (`lib/rerankers/local.mjs`) checks `isCached()` up front and fast-fails with an actionable error message if the model isn't already on disk, rather than burning the full timeout and failing with a generic worker error. If you see that error, pre-fetch the model's files under `resources/models/Xenova/bge-reranker-large/` (config.json, tokenizer.json, tokenizer_config.json, onnx/model_quantized.onnx — see `LocalReranker.ts`'s `resolveModelPath()` for the exact expected layout) before running the benchmark. The error message itself includes example `curl` commands for each file.

## Results are not committed

`benchmarks/reranker-eval/results/` is gitignored on purpose. Latency and peak-RSS numbers are machine-specific — checking them in would invite bogus cross-machine comparisons (a slower or busier dev machine would look like a regression that isn't one). If you need to share a result, paste `REPORT.md`'s content directly rather than committing the file.

## 2026-08-30 result summary

On a development machine (not representative of end-user hardware — no absolute latency/RSS number here should be read as what a user's machine will see):

- **`bge-reranker-large` won on ranking quality** — MRR 0.715 vs `bge-reranker-base`'s 0.539 and the cosine-only baseline's 0.483.
- **Neither local reranker cleared the live-path latency budget** (1200ms, matching `ModeHybridRetriever.ts`'s `RERANK_BUDGET_MS`): `bge-reranker-base` p95 was ~1958ms, `bge-reranker-large` was ~6489ms.
- Cohere's hosted reranker was **skipped** (no `COHERE_API_KEY` set in the environment this ran in) and remains unmeasured — the "no candidate clears the budget" conclusion above only covers the candidates that actually ran.
- A finding beyond raw ranking quality: `bge-reranker-base` (the current production model) picks a content-free chunk (a bare title or empty section heading with no body text) as its #1 answer for **7 of 28 queries (25%)**, versus **2 of 28 (7%)** for `bge-reranker-large` — see the "Content-free top-picks" line in `REPORT.md`, which is computed from the actual per-query data, not estimated.

See `results/REPORT.md` (regenerate with `npm run benchmark:reranker:score`) for the full current numbers, the per-query disagreement table, and the report's own methodology caveats section — in particular, note that `peakRssMb` includes the whole subprocess's overhead (not just model weights), that the `baseline` candidate is simpler than production's actual current (non-reranked) hybrid FTS+cosine ordering, and that this benchmark issues one `rerank()` call per query where production batches in groups of 6 — meaning production's real overhead is likely equal to or higher than what's measured here.
