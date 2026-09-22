# Natively summary-model benchmark (2026-09-16/17)

Compares DeepSeek V4.1 Flash (current Natively config and a thinking-on diagnostic) with GPT-5.6 Luna at reasoning effort max, medium, low and none. Every configuration runs through **Natively's real post-meeting summary pipeline**: the production `electron/` meeting-notes V3 code and an unmodified local `natively-api`.

**Read first:** [`reports/REPORT.md`](reports/REPORT.md) · blind human review: [`reports/HUMAN_REVIEW_INDEX.md`](reports/HUMAN_REVIEW_INDEX.md)

## Provenance
- Repo commit at start: `15ab97e655ef15d8442da28c4dffa2ed335d9778` on branch `fix/profile-pack-fk-and-gap-analysis`.
- The working tree had uncommitted UI/CSS edits from before this session. During the session, another session committed `d516c50c` and left uncommitted seminar/call-center edits in `ModesManager.ts`, `MeetingModeDetector.ts` and `MeetingSummaryReducer.ts`. None of these touch the six modes or the prompts used here.
- natively-api submodule: `0adab92` at start. Unrelated reconciler commits (`a179c37..08b33a6`) landed mid-run; `server.js` doesn't import them.
- Pipeline bundle: `build/pipeline.cjs`, sha256 `48a85f51891adcb6…`, built 2026-09-17 01:20 IST by `harness/build.cjs` using the same esbuild options as `scripts/build-electron.js`.
- **No production source file, `.env`, routing, or key was modified.**

## How it works (one run)
```
transcripts/<ID>.segments.json         (Natively TranscriptSegment[])
  → harness/run-pipeline.cjs            (Electron-as-Node; replicates MeetingPersistence.processAndSaveMeeting V3 branch)
      MeetingContextAssembler → ChunkSummaryGenerator/generateStructured → Reducer → Validator
      → SummaryPolisher ×2 → FollowUpDraftGenerator → generateTitleFromSummaryWithSource → buildPostCallEnhancements
      LLM seam: real LLMHelper.generateMeetingSummary → generateWithNatively → POST /v1/chat
  → local natively-api (node --import harness/provider-shim.mjs server.js)
      real routeChat → buildDeepSeekBody → callDeepSeek → fetch(api.deepseek.com)
      shim: per config, forward the production body (DeepSeek) / drop `thinking` / translate to OpenAI Responses (Luna, reasoning.effort)
            record wire metadata; block every non-candidate AI host
  → outputs/<config>/<conversation>/run<N>.json
```

## Reproduce
```bash
node benchmark/harness/build.cjs                              # bundle production modules
node benchmark/harness/convert-transcript.mjs <IDs...>        # authored transcripts → segments
node benchmark/harness/build-manifest.mjs
node benchmark/harness/orchestrator.mjs                        # all runs (resumable)
node benchmark/harness/orchestrator.mjs --retry-failed --configs luna-max   # retry infra failures (needs OpenAI credits)
node benchmark/harness/judge.mjs --concurrency 8               # blind judge (needs Gemini credits)
node benchmark/harness/analyze.mjs && node benchmark/harness/common-subset.mjs
node benchmark/harness/review-bundle.mjs && node benchmark/harness/report.mjs
```
Keys are read from the existing `.env` files and never printed or written. `natively-api` runs with production Supabase, telemetry and alerts disconnected, for the child process only.

## Status / open items
- **13 Luna max runs excluded.** The OpenAI account ran out of credits (HTTP 429 "no credits remaining") around 20:40 UTC. Once credits are added, rerun: `orchestrator.mjs --retry-failed --configs luna-max`, then the judge, analysis and report. Estimated cost ≈ $3. **Decision (2026-09-17): finalized as-is.** No OpenAI top-up; the shared OpenRouter key was not used, because natively-api also uses it for /v1/embed and /v1/rerank.
- **Disk space:** the boot volume was ~177 MB free (99% full) at the end of the session. A retry plus re-judge writes ~20-30 MB, so free space first to avoid ENOSPC.
- **18 selected runs unjudged.** The judge key's Gemini prepaid credits were depleted. `judge.mjs` resumes from where it stopped. Finalized as-is (Gemini not topped up).

## Layout
| Path | Contents |
|---|---|
| `config.json` | configurations, pricing (with sources), production deadlines, deadline overrides |
| `manifest.json` | corpus metadata (source, duration, words, token estimate, transcript method, preprocessing) |
| `transcripts/` | `CORPUS_SPEC.md`; `src/*.txt` authored/caption transcripts; `*.segments.json` Natively segments |
| `references/` | gold fact sheets (facts, corrections, non-decisions, distractors) |
| `outputs/` | full pipeline results per run (summary object, per-call timings, gzip raw visible model output, events) |
| `evaluations/` | blind judge JSON per run |
| `raw/` | wire logs (no text / keys / reasoning), server logs, orchestrator + judge logs, job specs, YouTube caption files, smoke-test archive |
| `results/` | `runs.jsonl`/`runs.csv` (every run), `runs-selected.jsonl`, `runs-excluded.json`, `aggregates.json`, `common-subset.json`, `runs-index.jsonl` |
| `reports/` | `REPORT.md`, human-review bundle, review key, narrative sections |
| `harness/` | all benchmark code |
