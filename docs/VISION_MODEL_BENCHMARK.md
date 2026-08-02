# Vision Model Benchmark

`Vision Model Benchmark` is an internal screenshot-to-answer benchmark for Natively's Gemini path. It is a CLI-only developer tool. The benchmark is isolated from normal chat, screenshot capture, prompt selection, and provider fallback behavior.

The benchmark originally shipped with a developer-only Settings tab. That surface was removed on 2026-08-01: its main-process handlers were never registered, so the tab never functioned, and the renderer's unconditional `vision-benchmark:info` probe logged a `No handler registered` error on every launch. The CLI is the supported entry point.

## Architecture

- `electron/visionBenchmark/` contains shared configuration, prompt selection, in-memory image processing, Gemini streaming, metrics, statistics, cancellation, quality checks, IPC, and report export.
- `electron/visionBenchmark/cli.ts` is the entry point, built to `dist-electron/electron/visionBenchmark/cli.js`.
- `vision-benchmark.models.json` is the benchmark-only fallback model configuration.
- `electron/visionBenchmark/__tests__/VisionBenchmark.test.mjs` uses mocked streams. Normal tests make no paid API calls.

The runner uses the production `@google/genai` dependency and the production `v1alpha` API version. It imports prompt constants directly from `electron/services/screen/visionPrompts.ts` and `electron/llm/prompts.ts`; it does not keep a duplicate shortened Natively prompt.

The supplied master-prompt repository was compared with the checked-in prompt sources. After removing the Markdown code fences and section separators, its `electron/llm/prompts.ts` and `electron/services/screen/visionPrompts.ts` sections match the repository files byte-for-byte. No production prompt was changed.

## Developer gate

None is needed. The benchmark is not reachable from the running app at all — it has no IPC surface and no renderer code. It runs only when a developer explicitly invokes the CLI (see **CLI** below).

## Credentials and secrets

The benchmark uses only `GEMINI_API_KEY_1`. It does not fall back to `CredentialsManager`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or another stored provider credential. The CLI loads the repository-root `.env` through the existing `dotenv` dependency. `.env` is ignored by Git and excluded from packaged files.

Secrets, authorization headers, environment-variable values, and image base64 are never included in traces or reports. Provider errors pass through a secret redactor. Reports store the selected image's basename and metadata, not its source path or bytes. The screenshot is copied only when **Include screenshot in export** or `--include-screenshot` is explicitly selected.

## Model resolution

Resolution follows the requested precedence for each label:

1. repository model registry;
2. environment variable;
3. `vision-benchmark.models.json`.

| Label | Current resolved ID | Source |
| --- | --- | --- |
| Gemini 3.6 Flash | `gemini-3.6-flash` | repository |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | repository |
| Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` | benchmark config |

Environment names:

- `NATIVELY_BENCHMARK_GEMINI_36_FLASH_MODEL`
- `NATIVELY_BENCHMARK_GEMINI_31_FLASH_LITE_MODEL`
- `NATIVELY_BENCHMARK_GEMINI_35_FLASH_LITE_MODEL`

Because repository IDs have first precedence, an environment value applies only when that label is absent from the repository registry. An unavailable ID is never replaced: its run fails as `invalid_model`, the rejected ID stays visible, and the remaining models continue.

## Run settings

Supply a PNG, JPEG, or WebP screenshot, then select models, a prompt source, a Natively mode, and the run settings. Provider-reported input usage is the authoritative token count after a request; no approximate tokenizer is presented as exact.

Defaults are 10 measured runs, 2 warm-ups, minimal thinking, temperature 0, high resolution, sequential execution, warm client reuse, and randomized model order. Sequential execution reduces cross-request network distortion.

Automated checks are deterministic hygiene checks only; they do not claim semantic correctness. The seven 1–5 manual quality ratings remain in the run schema and can be filled in after a run, but there is no longer an interactive surface for entering them. A judge-model interface can be added without changing the run schema; no judge calls are made by default.

## CLI

Build and run:

```bash
npm run benchmark:vision -- \
  --image "/absolute/path/to/screenshot.png" \
  --models "gemini-3.6-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite" \
  --mode technical-interview \
  --question "Read the visible problem and give the exact answer I should say aloud." \
  --runs 10 \
  --warmups 2 \
  --thinking minimal \
  --resolution high \
  --temperature 0 \
  --execution sequential \
  --connection warm
```

When `--image` is omitted, a native picker is available only when the runner is hosted by Electron. Plain Node CLI use must provide an absolute image path. Other options include `--prompt`, `--max-output-tokens`, `--timeout`, `--delay`, `--randomize-order=false`, `--output`, and `--include-screenshot`.

Live calls are explicitly opt-in:

```bash
NATIVELY_RUN_LIVE_BENCHMARKS=true npm run benchmark:vision:live -- --image "/absolute/path/to/screenshot.png" --runs 1 --warmups 0
```

## Timing definitions

Durations use `performance.now()`.

- Provider-event latency: request dispatched to the first streaming event of any kind.
- Reasoning latency: request dispatched to the first non-empty reasoning part.
- Request TTFT: request dispatched to the first non-empty visible answer part.
- End-to-end TTFT: run started to the first non-empty visible answer part.
- Total response latency: request dispatched to stream completion.
- End-to-end latency: run started to run completion.

Metadata, empty deltas, usage, and reasoning do not count as visible TTFT. Image timing separately records file read, resize, JPEG encoding, and their total. Request assembly is also separate.

Output tokens per second uses provider visible-output tokens divided by time from first visible answer text to stream completion. Characters per second uses visible answer characters over the same interval. Missing or zero durations produce no rate.

## Warm-ups, connections, and statistics

Warm-ups execute and are recorded but excluded from every reported distribution. Warm mode reuses one SDK client and its keep-alive pools. `fresh-client` constructs a new SDK client per run; it is not described as fully cold because DNS, TLS, provider infrastructure, and OS caches are not controlled.

Statistics include count, min, mean, median/P50, P75, P90, P95, max, and population standard deviation. Percentiles use linear interpolation between closest ranks (R-7, the method used by Excel `PERCENTILE.INC`). Failed runs are excluded from latency/rate distributions but remain in reliability.

The balanced score is configurable in code and currently uses:

```text
normalized latency × 0.45 + normalized manual quality × 0.45 + reliability × 0.10
```

Until manual ratings exist, quality is neutral (0.5), not inferred from automated checks.

## Cancellation and errors

Cancellation uses `AbortController`, aborts the active SDK stream, prevents later runs, preserves completed results, marks the current run cancelled, and leaves the partial session exportable. Timeout also aborts the stream. Latency runs are not retried automatically.

Errors are classified as `invalid_model`, `authentication`, `rate_limit`, `timeout`, `network`, `provider_error`, `invalid_image`, `cancelled`, `configuration`, or `unknown`. `Retry-After` is recorded when exposed, but it does not trigger a hidden retry.

## Reports

Reports are written under:

```text
benchmark-results/<timestamp>-<session-id>/
  summary.md
  summary.csv
  runs.csv
  results.json
  config.json
  environment.json
  responses/
  traces/
```

They include application/runtime/git metadata, configuration, actual model IDs, prompt builder/hash, image metadata, execution order, per-run results, statistics, errors, checks, and ratings.

## Known limitations

- Gemini may expose reasoning token usage without streaming reasoning text; in that case reasoning latency is absent while the usage count may exist.
- Provider usage arrives at provider discretion, so token rates can be absent.
- The production image path uses 1536px JPEG at quality 80. Benchmark `high` matches it; other resolutions intentionally test alternate payload sizes.
- A fresh SDK client does not guarantee a new DNS/TLS/provider connection.
- Automated checks are mechanical and cannot establish screenshot-reading or factual correctness.
- Model availability is account- and date-dependent. In particular, the benchmark-configured 3.5 Flash-Lite label must be validated against the user's Gemini project and is never silently substituted.
