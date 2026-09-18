**What ran.** Each summary run executes the real production code, bundled from this repo's source with the same esbuild options as `scripts/build-electron.js` (`benchmark/build/pipeline.cjs`, sha256 prefix `48a85f51891adcb6`). It runs under Electron-as-Node (same Node ABI as the app) and replicates `MeetingPersistence.processAndSaveMeeting`'s V3 branch step by step, minus the DB write, IPC and telemetry. LLM calls go through the real `LLMHelper.generateMeetingSummary` → `generateWithNatively` → an **unmodified local natively-api** (`node server.js`, local-test auth). There, the real `routeChat` / `buildDeepSeekBody` / `callDeepSeek` build the production request. **No production source file was modified.**

**The only substitution** is a transport shim (`benchmark/harness/provider-shim.mjs`) preloaded with `node --import`. It intercepts the `fetch` to `api.deepseek.com/chat/completions` that natively-api makes, and per configuration:
- **`ds-flash-prod`**: forwards the production body byte-for-byte (`thinking: disabled`).
- **`ds-flash-thinking`**: removes only the `thinking` field (API default = enabled, default effort).
- **`luna-*`**: sends the same system and user messages to the OpenAI **Responses API** with `reasoning.effort` = max|medium|low|none, `max_output_tokens` = min(production 384,000, Luna's 128,000 ceiling) = 128,000, and `store:false`. The visible text is reshaped into the chat-completion JSON that `callDeepSeek` parses. Everything upstream and downstream (prompts, chunking, parsing, validation, repair, reduce, polish gate, title) is identical.

**Documented provider differences**
1. **API surface.** OpenAI's Chat Completions rejects `reasoning_effort:"max"` for `gpt-5.6-luna` (400: "Supported values are none, low, medium, high, xhigh"). The Responses API accepts it and echoes `reasoning.effort` back. All four Luna configs therefore use the Responses API, so they differ only in effort.
2. **Max output.** DeepSeek gets 384,000; Luna gets 128,000, its hard limit. No run approached either ceiling (see `finish_reason` / `response_status` in the wire logs).
3. **Sampling.** Neither path sets temperature or top_p, which matches production. Both providers are therefore nondeterministic, hence 3 runs.
4. **System role.** Sent as `role:"system"` to both providers.

**Deadlines.** Production deadlines would have replaced slow outputs with a Gemini fallback, contaminating the comparison. They were therefore lifted for measurement:
- **Server** (via env): `DEEPSEEK_TIMEOUT_MS`, `DEEPSEEK_TTFT_CAP_MS`, `AI_ROUTE_BUDGET_MS`, `EXTRACTION_DEEPSEEK_TIMEOUT_MS`, `EXTRACTION_ROUTE_BUDGET_MS`.
- **Client:** the timeout argument of `generateWithNatively` / `withTimeout`.
- **Shim:** its own undici agent with long timeouts.

Each call's elapsed time is still checked against the real production limits and reported as "production deadline compliance".

**Fallback isolation.**
- **Server side:** every non-candidate AI host (Gemini, MiniMax, Groq, OpenRouter, OpenAI outside the shim) is blocked and logged by the shim.
- **Client side:** the Codex / Antigravity / Groq / Gemini / Ollama rungs are disabled on the harness `LLMHelper` instance, and any attempt is recorded.

No summary text in this benchmark came from a non-candidate model. When production routing *would* have used Gemini (see Failure Analysis: the 25k-char size gate on JSON repair), the call was blocked and the chunk was dropped. That is counted against the model whose invalid JSON triggered it.

**Isolation from production systems.**
- **Environment:** natively-api ran with `SUPABASE_URL` pointed at a closed local port, all ledgers, watchdogs and telemetry disabled, and Telegram, PostHog, Axiom, Sentry and Resend keys blanked, all for the child process only. `.env` was not modified.
- **Keys:** read from the existing `.env` files and never printed or written. The OpenAI key lives in the repo-root `.env`; natively-api's `.env` has none.
- **Server ports:** 18701-18706 (conversations other than LECT-VL) and 18801-18806 (LECT-VL, a second orchestrator started when that transcript finished authoring).

**Fairness.**
- **Inputs:** identical transcript, segment ordering, mode, mode sections, prompts and code for every configuration.
- **Modes:** mode per conversation (sales→`sales`, interview→`recruiting` / `looking-for-work`, meeting→`team-meet`, lecture→`lecture`, technical & casual→`general`); canonical built-in template sections, no custom context or reference files, language `auto`.
- **Scheduling:** 3 runs per pair; job order shuffled with a fixed seed (20260917); concurrency capped per config.
- **No tuning:** no prompt was changed and no output was edited. The only exclusions are the 13 infra-failed Luna max runs listed in `results/runs-excluded.json` (OpenAI credit exhaustion). Model-attributable failures stay in.
- **Retries:** only infra failures (crash / candidate-provider HTTP or network error) are eligible for retry, and retried runs are flagged. Model-attributable failures (invalid JSON, dropped chunks) are never retried.

**Evaluation.**
- **Judge:** blind LLM judge `gemini-3.1-pro-preview` (neither candidate family), temperature 0, JSON output.
- **Inputs:** the line-numbered transcript with the speaker labels the note-taker saw plus a cast list, the gold fact sheet, and ONE candidate rendered to Markdown in the app's order: title, overview, Summary, mode sections, then structured actions, decisions, questions and risks, then the follow-up draft.
- **Outputs:** 14 dimension scores, per-fact verdicts, critical errors, hallucinations, superseded values, suggestions-as-decisions, and included distractors.
- **Derived metrics:** fact retention (importance-weighted) and positional / type breakdowns are computed from the per-fact verdicts. CIs bootstrap over conversations.

**Corpus.** 9 synthetic conversations were authored to a written spec, `benchmark/transcripts/CORPUS_SPEC.md`. It plants distributed facts, explicit and implicit corrections, distractors, similar names, and suggestions vs decisions, and each conversation comes with a line-referenced gold fact sheet. There are also 2 real public lectures (NIH VideoCast, US-government works, human-authored captions). Line references in all 11 fact sheets were machine-verified.

**Limitations**
- **Judge noise.** The judge is a single LLM. Fact-level verdicts are more stable than the 1-10 scores, but not human-verified. A blind human-review bundle is provided.
- **Synthetic content.** The synthetic transcripts are cleaner than real STT (light artifacts only). The two real lectures are single-channel (no diarization) and sentence-cased from all-caps captions.
- **Transcription.** Transcription was not benchmarked: no Natively STT run, no audio downloaded (the disk had <500 MB free).
- **Caching.** Repeated runs of the same transcript can hit provider prompt caches. Cost is therefore reported cold-cache, and latency may be slightly optimistic for runs 2-3.
- **Latency conditions.** Latency is from one machine in one region (India → provider APIs), at the concurrency used here (≤ ~20 simultaneous provider calls), on 2026-09-16 between 20:04 and 20:48 UTC (01:34-02:18 IST). That window is DeepSeek off-peak.
- **Concurrent edits.** Other sessions edited this checkout during the benchmark. Seminar/call-center edits in `ModesManager.ts`, `MeetingModeDetector.ts` and `MeetingSummaryReducer.ts` predate the 01:20 IST bundle build and are in the bundle, but they don't touch the six modes or any prompt used here. About 15 more files (including `LLMHelper.ts`, `CredentialsManager.ts`, `ProcessingHelper.ts`) were modified at 02:33-02:37 IST. That is after all 198 runs had finished (last run 02:17 IST) and after the bundle was built, so no run could have used them. Every run used the same bundle.
