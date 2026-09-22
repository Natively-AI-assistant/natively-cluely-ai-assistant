# Natively summary-model benchmark — DeepSeek V4.1 Flash vs GPT-5.6 Luna

Benchmark id `natively-summary-models-2026-09-17` · generated 2026-09-16T21:00:02.673Z · 185 summary runs used (13 excluded as infra failures, 0 retries used) · 11 conversations × 6 configurations × 3 runs

# Executive Summary

**No GPT-5.6 Luna configuration should replace DeepSeek V4.1 Flash for Natively summaries.** On the real Natively pipeline, every Luna effort level fails the stated requirement of being "significantly cheaper". Each is also more than twice as slow, and each non-max level retains measurably fewer facts.

| | Current: DS V4.1 Flash, thinking off | Luna none | Luna low | Luna medium | Luna max |
|---|---|---|---|---|---|
| Cost per summary (cold cache, DS blended peak/off-peak) | **$0.0324** | $0.0486 (1.50×) | $0.0442 (1.37×) | $0.0499 (1.54×) | $0.2281 (7.05×) |
| P50 / P90 end-to-end pipeline | **41 s / 62 s** | 98 s / 157 s | 95 s / 146 s | 107 s / 156 s | 598 s / 909 s |
| Weighted fact retention (judge vs gold facts) | 93.1% | 87.4% | 86.7% | 87.5% | 96.1%* |
| Paired Δ vs current [95% CI] | — | −5.8 pp [−9.8, −2.0] | −6.7 pp [−10.1, −3.1] | −6.0 pp [−9.3, −2.2] | +2.8 pp [−0.8, +7.3]* |
| Runs that would breach a production deadline (→ Gemini fallback) | **0/33** | 33/33 | 33/33 | 33/33 | 20/20 |

\*Luna max: 20 of 33 runs, because the OpenAI account ran out of credits mid-benchmark. Its paired Δ covers the 8 conversations it has. On the 8 conversations every configuration shares, the ordering is unchanged: none/low/medium are −3.8 to −4.9 pp and worse in 7 of 8 conversations; max is +2.8 pp.

1. **Cost goes the wrong way.** Luna lists at $0.20 input and $1.20 output per million tokens. DeepSeek V4.1 Flash is $0.15/$0.60 off-peak and $0.30/$1.20 peak. The summary pipeline is output-heavy: ~28-30k visible output tokens per meeting, because chunk extraction emits dense JSON. Luna therefore costs about the same as DeepSeek's *peak* price and roughly 2× its off-peak price even at `none`. Reasoning adds more on top: `max` averaged 121k reasoning tokens per summary. *Caveat:* at OpenAI's half-price **Flex** tier ($0.10/$0.60, slower, occasionally unavailable; latency not measured here), Luna none/low/medium would be 0.68-0.77× the current cost. That is 23-32% cheaper at blended DeepSeek pricing, 7-17% cheaper than DeepSeek off-peak, with the same lower retention and even slower responses (see Actual Cost).
2. **Latency.** Luna generated ~140-150 output tokens/s on large chunk calls; DeepSeek non-thinking generated ~320. Since output volume is similar, Luna none/low/medium land at 2.3-2.6× DeepSeek's end-to-end time. Luna max takes ~10 minutes per meeting. **No configuration, including the current one, meets the 8-15 s target.** The pipeline makes ~11 LLM calls, and extraction alone needs 20-35 s of generation for a long meeting on the fastest model.
3. **Quality.** On gold-fact retention, Luna none/low/medium lose about 5-7 points to the current config, and the confidence intervals exclude zero. The losses concentrate on timeline (67-72% vs 87%), entities (73-78% vs 91%), numbers (82-88% vs 93%) and correction-heavy conversations. Luna max and DeepSeek-thinking retain slightly *more* than the current config (differences not statistically significant), at 7× and 1.9× the cost and 14× and 2.7× the latency.
4. **DeepSeek thinking does not change the decision.** It adds +1.5 pp retention (CI includes zero) for 1.87× cost and 2.75× latency, and 29 of 33 runs breach production deadlines. The current `thinking: disabled` choice is correct for this workload.
5. **Pipeline problems matter as much as the model choice.** The same issues hit every model:
   - **Overview polish discarded.** The "no new tokens" polish gate throws away the LLM overview in 79-94% of runs, and the LLM summary in 30-70%. The rejected tokens are dominated by formatting variants of values the notes contain (possessives, thousands separators, decimals, hyphens), so users mostly see the mechanical fallback prose.
   - **Superseded values survive.** Per-chunk map-reduce keeps corrected values (0.8-1.3 superseded values reported per summary, every model).
   - **Epoch timestamps in the prompt.** The chunk prompt renders epoch timestamps as `TIME RANGE: 29824680:16 - …`, which DeepSeek once copied into JSON. The resulting repair payload then exceeded the 25k-char gate and would have been routed to Gemini.

See "Requirements Screening" and "Failure Analysis" for detail. The overall 1-10 judge score is **not** a useful discriminator here: every configuration scores 4.5-5.2, dominated by model-independent duplication, "Speaker N" labels and superseded values. Use fact retention for decisions.

# Current Natively Configuration

**Natively currently generates post-meeting summaries with DeepSeek V4.1 Flash with thinking explicitly DISABLED.** The request contains `thinking: {"type": "disabled"}`, so DeepSeek's thinking-by-default does not apply. Natively does not use any reasoning today.

| Question | Answer | Evidence |
|---|---|---|
| Model | `deepseek-v4-flash`. DeepSeek now serves this legacy id with **DeepSeek-V4.1-Flash** and responds with `"model": "deepseek-flash"` | `natively-api/lib/deepseekProvider.js:43` (`DEEPSEEK_MODEL`); DeepSeek pricing page (checked 2026-09-17): "`deepseek-flash` → DeepSeek-V4.1-Flash; legacy names accepted: `deepseek-v4-flash`". Every benchmark response for this model reported `deepseek-flash`. |
| Provider / endpoint | DeepSeek, `POST https://api.deepseek.com/chat/completions`, non-streaming | `deepseekProvider.js:48`, `server.js:4460` (`buildDeepSeekBody(..., { stream: false })`) |
| Reasoning used? | **No.** Thinking is explicitly disabled on every request | `deepseekProvider.js:129` `thinking: { type: 'disabled' }`. The module header explains the choice (parity with Gemini's minimal thinking, and avoiding empty answers). |
| If not explicit, what's the default? | It *is* explicit. For reference, DeepSeek's API default is thinking **enabled** (`thinking.type` default `enabled`; `reasoning_effort` default `high`) | DeepSeek chat-completion API reference. A live probe that dropped the `thinking` param returned `reasoning_tokens: 106` on a small prompt, while the production body returned 0. |
| Other request parameters | `max_tokens: 384000` (the model ceiling), no `temperature`/`top_p` (API defaults; in non-thinking mode top_p is fixed at 1.0), `stream: false`, messages = `[system, user]` | `deepseekProvider.js:67,120-133` |
| Exact body that reached DeepSeek (captured on the wire in this benchmark) | `{"model":"deepseek-v4-flash","messages":[{"role":"system",…},{"role":"user","content":"Context:\n…"}],"max_tokens":384000,"thinking":{"type":"disabled"},"stream":false}` | `benchmark/raw/wire/ds-flash-prod.jsonl` (`production_request_params`, `upstream_request_params`; message text omitted) |
| Observed reasoning tokens | **0 on every production-config call**. The thinking-enabled diagnostic config consumed thousands per summary | `results/runs.jsonl` → `reasoning_tokens`, `verify_reasoning_ok` |

**How a summary is actually produced (the traced production path)**

1. **Trigger.** `MeetingPersistence.stopMeeting` hands off to `processAndSaveMeeting` (background, after the meeting ends). It snapshots the active mode and loads the mode's note sections (`TEMPLATE_NOTE_SECTIONS` or the user's DB sections). It also builds a summary-safe mode context block containing custom context plus retrieved reference snippets, never raw file bodies. `electron/MeetingPersistence.ts:404-600`.
2. **Transcript representation.** `TranscriptSegment[]` (`speaker`, `speakerId?`, `text`, `timestamp` epoch-ms, `final`, `origin`). The mic is `user` → "Me"; system audio is `interviewer`, or the diarized `speaker_N` → "Speaker N". `electron/SessionTracker.ts:39`.
3. **V3 pipeline** (flag `meetingSummaryV3`, default ON). `MeetingContextAssembler.assembleSummary` (`electron/services/meeting/MeetingContextAssembler.ts`):
   - **Preprocessing.** `TranscriptNormalizer` drops AI-assistant turns, strips fillers ("um", "you know"), collapses repeated words, drops interim noise and consecutive duplicates, and maps speakers to canonical ids.
   - **Chunking.** `TranscriptChunker` builds ~3,000-token chunks (chars/4) with ~300-token / ≤6-segment overlap. A transcript under 1,500 tokens becomes a single chunk. No truncation: coverage is the whole transcript.
   - **Per-chunk structured extraction.** `ChunkSummaryGenerator` runs up to 3 chunks concurrently. It uses a large system prompt (mode sections + density rules + grounding rules) plus a JSON shape hint, with the chunk text as the user message. The ladder is `generateStructured`: extract JSON (fence-strip / first-{…last-}) → validate/coerce (`MeetingSummarySchemaValidator`) → **one repair retry** that sends the bad output back → drop the chunk. Call options are `purpose:'extraction'` and a 60s timeout.
   - **Reduce (deterministic, no LLM).** `MeetingSummaryReducer` merges and dedupes decisions, actions, questions and risks, routes findings into the mode's pre-declared sections only, and builds the timeline, the deterministic TLDR and overview, and the recipes. Then `validateMeetingSummaryV3` repairs and clamps (240 chars per bullet, ≤40 items, etc.).
   - **LLM polish (flag `meetingSummaryLlmPolish`, default ON).** Two parallel calls, one rewriting the Summary bullets and one writing the whole-meeting Overview. They see only already-extracted notes, never the transcript. A hard **"no new significant tokens" gate** (`newSignificantTokens`) rejects any output containing a capitalised word, number or date absent from the notes, and the deterministic text is kept instead.
   - **Follow-up draft (flag `followUpDraftV2`, default ON).** One call over the note content, with a deterministic fallback.
4. **Title.** `generateTitleFromSummaryWithSource` makes one call over the finished notes, followed by `cleanMeetingTitle` and the answer-fragment guards.
5. **Post-processing.** `buildPostCallEnhancements` adds coaching insights and structured actions, then the result is saved to SQLite.
6. **No RAG, no tools, no caching, no streaming, no temperature** on this path. The only "retrieval" is the optional mode reference snippets, which were empty in this benchmark (built-in modes without reference files).

**Client routing (Electron, `LLMHelper.generateMeetingSummary`, `electron/LLMHelper.ts:11602`).** The rungs are tried in order:
1. The user's custom/cURL provider, if one is selected.
2. **Natively API** (`POST {NATIVELY_API_URL}/v1/chat`, body `{messages:[{role:'user',content:'Context:\n'+context}], system, language:'auto', purpose?}`).
3. Codex CLI.
4. Antigravity.
5. Groq.
6. Gemini Flash-Lite ×3.
7. Gemini Flash ×3.
8. Gemini Pro ×5.
9. Ollama.

For a Natively-API user, rung 2 serves everything.

**Server routing (natively-api `routeChat`, `server.js:4737`).**
- **Language.** `injectLanguagePrompt` prepends a `[LANGUAGE INSTRUCTION — HIGHEST PRIORITY]` block (language `auto`).
- **Chunk extraction and chunk-JSON repair** (`purpose:'extraction'`) go **DeepSeek first only if system+messages ≤ 25,000 chars** (`EXTRACTION_DEEPSEEK_MAX_CHARS`, `server.js:2450`), with a 45s cap. Otherwise, or on failure, they go to Gemini `gemini-3.1-flash-lite` → `gemini-3.8-flash`, rotating keys.
- **Polish, overview, follow-up and title** use the default DeepSeek-primary cascade (`deepseekIsDefaultPrimary`; these prompts are not "live interview" mode), with a **10s cap** (`DEEPSEEK_TTFT_CAP_MS`, applied to the whole non-streaming call). The fallback order is Gemini Flash → MiniMax-M3 → Gemini Pro.
- **Global limit.** The server-wide undici dispatcher has `headersTimeout: 30_000` (`server.js:210`), which bounds any non-streaming call whose provider withholds headers until completion.

# Benchmark Corpus

| ID | Type | Mode | Length | Duration | Words | Tokens (chars/4) | Speakers | Source |
|---|---|---|---|---|---|---|---|---|
| SALES-S | sales | sales | short | 8.5 min | 1,183 | 1,573 | 3 | synthetic |
| TEAM-S | team_meeting | team-meet | short | 7.4 min | 1,020 | 1,380 | 5 | synthetic |
| INT-M | interview | looking-for-work | medium | 27.1 min | 3,778 | 5,073 | 3 | synthetic |
| CASUAL-M | casual_mixed | general | medium | 28.3 min | 3,726 | 4,919 | 3 | synthetic |
| TEAM-M | team_meeting | team-meet | long | 49.3 min | 6,738 | 9,154 | 6 | synthetic |
| INT-TECH-L | interview | recruiting | long | 52.8 min | 7,357 | 10,328 | 3 | synthetic |
| SALES-DISC-L | sales | sales | long | 60.5 min | 8,411 | 11,493 | 5 | synthetic |
| TECH-DISC-L | technical_discussion | general | long | 53.7 min | 7,522 | 10,714 | 5 | synthetic |
| REAL-LECT-L | lecture | lecture | long | 65.4 min | 8,518 | 12,251 | 1 | [YouTube](https://www.youtube.com/watch?v=Uihjety2d5M) |
| LECT-VL | lecture | lecture | very_long | 98.9 min | 14,053 | 19,500 | 5 | synthetic |
| REAL-LECT-VL | lecture | lecture | very_long | 90.2 min | 11,692 | 15,800 | 1 | [YouTube](https://www.youtube.com/watch?v=dYorCZaF8ag) |

Measured provider input tokens per summary (all calls, DeepSeek tokenizer, current config): see Token Usage. Full per-conversation metadata: `benchmark/manifest.json`.

**11 conversations:** 9 authored to a written spec, plus 2 real public lectures. By length:
- **Short:** 2 conversations, 7-9 min.
- **Medium:** 2 conversations, 27-28 min.
- **Long:** 5 conversations, 49-65 min.
- **Very long:** 2 conversations, 90-99 min.

**What the synthetic transcripts contain.** They use Natively's real channel model: mic = "Me", system audio diarized into "Speaker N", so names appear only when spoken. They include light STT artifacts. Each also deliberately plants:
- important facts distributed across the whole call (≥25% of critical facts only in the final third)
- 4-11 corrections per conversation, both explicit ("sorry, 140 not 120") and implicit (the discussion simply lands elsewhere)
- similar names (Jon/Joan, Maya/Mia, Devin/Devon, two Alexes)
- false assumptions that are later corrected
- ideas floated but not decided
- small talk, jokes and tangents

**SALES-DISC-L** is the requested distributed-information test:
- budget $50,000 (early)
- CFO approval above $40,000, with the CFO as the real buyer (middle to late)
- go-live moved from Q4 to Q3 because the incumbent's contract ends Aug 31 (final 10%)
- seats corrected from 120 to 140

**Real lectures.** REAL-LECT-L (IPPCR 2016 research ethics, 65 min) and REAL-LECT-VL (IPPCR 2015 survival analysis, 90 min) are NIH VideoCast lectures by federal employees. They use human-authored captions; see the manifest for preprocessing and limitations.

**Gold fact sheets.** 28-90 atomic facts each (715 total), labelled critical / important / minor, with line references, corrections, non-decisions and distractors. Line references were machine-verified.

**Transcription is not part of this benchmark.**

# Model Configuration

| Config id | Model | Effort | Thinking | Provider | API surface |
|---|---|---|---|---|---|
| ds-flash-prod | deepseek-v4-flash | — | disabled (explicit thinking:{type:'disabled'} from buildDeepSeekBody) | DeepSeek | POST api.deepseek.com/chat/completions (production body) |
| ds-flash-thinking | deepseek-v4-flash | — | enabled (thinking param removed -> API default enabled, default effort) | DeepSeek | POST api.deepseek.com/chat/completions (production body) |
| luna-max | gpt-5.6-luna | max | reasoning | OpenAI | POST api.openai.com/v1/responses |
| luna-medium | gpt-5.6-luna | medium | reasoning | OpenAI | POST api.openai.com/v1/responses |
| luna-low | gpt-5.6-luna | low | reasoning | OpenAI | POST api.openai.com/v1/responses |
| luna-none | gpt-5.6-luna | none | none | OpenAI | POST api.openai.com/v1/responses |

Only model and reasoning differ. Every configuration receives the identical production request built by natively-api (the same system prompt, including the language directive; the same `Context:\n…` user message; the same chunk boundaries). The provider-specific translations:
- **DeepSeek:** the production body is forwarded as-is. The thinking diagnostic removes the `thinking` field only.
- **Luna:** messages → Responses `input`; `reasoning.effort` set; `max_tokens: 384000` → `max_output_tokens: 128000` (Luna's ceiling); `thinking` dropped because OpenAI has no such field; `store: false`. The Responses API is used because Chat Completions rejects `max` for this model.

# Verification

| Config | Runs | Response model as expected | Reasoning setting reached provider | No Electron fallback | Runs with blocked server fallback | Summary failures |
|---|---|---|---|---|---|---|
| DS Flash (current) | 33 | 33/33 | 33/33 | 31/33 | 2 | 0 |
| DS Flash thinking | 33 | 33/33 | 33/33 | 33/33 | 0 | 0 |
| Luna max | 20 | 20/20 | 20/20 | 20/20 | 0 | 0 |
| Luna medium | 33 | 33/33 | 33/33 | 32/33 | 1 | 0 |
| Luna low | 33 | 33/33 | 33/33 | 33/33 | 0 | 0 |
| Luna none | 33 | 33/33 | 33/33 | 32/33 | 1 | 0 |

Checks the post-run checklist asked for, from `results/runs.jsonl` and the provider wire logs:
- **Every run exists.** 11 conversations × 6 configs × 3 runs = 198 outputs, 0 crashes. **13 Luna max runs were excluded as infra failures.** The OpenAI account ran out of credits around 20:40 UTC (`429 You have no credits remaining`). The later natively-api breaker cool-down then routed the remaining calls away, as it would in production. These runs could not be retried because the account still has no credits. No other runs were excluded, and no retries were used.
- **Intended model on every call.**
  - Every DeepSeek response reported `model: deepseek-flash` (V4.1 Flash; the request sent the production id `deepseek-v4-flash`).
  - Every OpenAI response reported `gpt-5.6-luna`.
  - 2,047 model calls in total; 0 hit `finish_reason: length` or Responses `incomplete`.
- **Reasoning configuration reached the provider.**
  - Every Luna response echoed back the requested `reasoning.effort`.
  - Every current-config DeepSeek call carried `thinking: {type: disabled}` and returned 0 reasoning tokens (0 total across 33 runs).
  - The thinking diagnostic sent no `thinking` field and consumed 912,378 reasoning tokens across 33 runs.
- **No silent provider fallback produced text.**
  - Server-side, every non-candidate AI host was blocked and logged.
  - "Runs with blocked server fallback" (2 for current DS, 1 each for Luna medium/none) are all the same mechanism. A chunk returned invalid JSON; the repair payload exceeded natively-api's 25,000-char DeepSeek gate; production would have sent that repair to Gemini. The call was blocked, the chunk dropped, and the loss is counted against that model.
  - The "No Electron fallback" misses (31/33, 32/33) are the same 4 events cascading to the client's fallback rungs, which were also blocked.
- **No hidden reasoning stored.** The shim deletes DeepSeek `reasoning_content` before natively-api sees it, and extracts only `output_text` from OpenAI. Only token counts are kept.
- **No secrets in benchmark files.** 671 files were scanned against every value in both `.env` files (97 values, including each line of multi-line values): 0 matches. A separate key-shaped-pattern scan matched 5 times in 2 files (`outputs/ds-flash-thinking/SALES-DISC-L/run1.json` ×4, `reports/human-review/SALES-DISC-L.md` ×1). All 5 were inspected, and all are the summary text "the incumbent Zende**sk-Queue**wise…", not a key.
- **Judge coverage.** 167 of the 185 selected runs were judged. The judge key's Gemini prepaid credits ran out during judging, and the last 18 runs (spread across configs; see "Judged runs") were left unjudged rather than scored by a different judge. Judge-to-judge noise (re-judging) could not be measured for the same reason.

# Latency

Production summary calls are non-streaming (`stream:false`), so no first-token event exists on this path: **TTFT is N/A for every configuration** (reported as such, not approximated). "E2E" = full post-meeting pipeline: chunk extraction → reduce → validate → 2 polish calls → follow-up draft → title → post-call enhancements. "V3 ready" = summary object ready before title generation.

| Model | TTFT | P50 E2E | P90 E2E | Mean E2E | Max E2E | P50 V3 ready | P50 chunk phase | P50 slowest single call |
|---|---|---|---|---|---|---|---|---|
| DS Flash (current) | N/A | 41.3s | 62.4s | 43.3s | 72.4s | 40.6s | 33.1s | 20.5s |
| DS Flash thinking | N/A | 113.6s | 157.2s | 109.8s | 190.5s | 112.5s | 78.5s | 43.3s |
| Luna max | N/A | 597.8s | 909.0s | 637.4s | 945.9s | 594.9s | 488.6s | 310.6s |
| Luna medium | N/A | 106.8s | 155.6s | 107.6s | 175.6s | 105.4s | 87.4s | 52.4s |
| Luna low | N/A | 94.6s | 146.2s | 94.6s | 157.1s | 93.2s | 76.0s | 44.5s |
| Luna none | N/A | 97.7s | 156.6s | 99.9s | 220.4s | 96.3s | 80.3s | 52.3s |

**P50 end-to-end by transcript length**

| Model | short P50 | medium P50 | long P50 | very_long P50 | short P90 | medium P90 | long P90 | very_long P90 |
|---|---|---|---|---|---|---|---|---|
| DS Flash (current) | 24.5s | 26.7s | 50.2s | 64.5s | 26.2s | 28.7s | 58.5s | 72.1s |
| DS Flash thinking | 76.3s | 64.6s | 129.3s | 156.4s | 79.9s | 85.4s | 148.9s | 176.3s |
| Luna max | 447.7s | 451.0s | 665.5s | 908.1s | 474.9s | 503.7s | 760.4s | 934.5s |
| Luna medium | 57.5s | 77.3s | 115.2s | 153.2s | 64.6s | 89.4s | 143.1s | 173.4s |
| Luna low | 52.2s | 60.1s | 95.2s | 146.2s | 56.4s | 114.5s | 116.1s | 153.4s |
| Luna none | 53.7s | 56.4s | 104.8s | 159.0s | 57.4s | 58.7s | 121.5s | 203.9s |

**Production deadline compliance** (deadlines were lifted during measurement so every configuration produced output; this counts calls that would have hit a real production limit and been replaced by the Gemini fallback or failed)

| Model | Runs with ≥1 violation | Mean violating calls / run | of which undici 30s headers timeout | Runs routed away by 25k-char size gate |
|---|---|---|---|---|
| DS Flash (current) | 0/33 | 0.00 | 0.00 | 2/33 |
| DS Flash thinking | 29/33 | 2.45 | 0.00 | 0/33 |
| Luna max | 20/20 | 9.05 | 6.40 | 0/20 |
| Luna medium | 33/33 | 4.64 | 4.55 | 1/33 |
| Luna low | 33/33 | 3.88 | 3.79 | 0/33 |
| Luna none | 33/33 | 4.27 | 4.21 | 1/33 |

**Why it is slow for everyone.** One post-meeting summary is ~11 LLM calls: one extraction call per ~3,000-token chunk (up to 3 concurrent), 2 parallel polish calls (plus a repair call when the polish gate rejects), a follow-up draft and a title. The chunk-extraction prompt demands dense JSON (5-12 evidence-bearing findings per section), so the chunk calls are **output-bound**: 5-9k output tokens each. Latency is therefore set by output token speed × output volume:
- **Output speed** on calls with >2k output tokens (p50): DeepSeek V4.1 Flash non-thinking **319 tok/s**; thinking 286 tok/s; Luna none 144, low 148, medium 140, max 124 tok/s.
- **Output volume** per summary is similar across DeepSeek non-thinking and Luna none/low/medium (26-31k visible tokens). Luna none/low/medium land at 2.3-2.6× DeepSeek's time; Luna max adds ~121k reasoning tokens and takes ~10 min.

**Against the 8 s / 10-15 s / 20 s / 30 s+ targets:** no configuration is close. The current production config is 24 s p50 for a 7-9 minute meeting and 65 s p50 for a 90-minute lecture. Every Luna level is ≥52 s p50 even for short meetings. The largest latency lever is the pipeline's output volume and call structure, not the choice between these models.

**Production deadlines.** Measured against the deadlines in the code today:
- **Current DeepSeek:** never breached one.
- **DeepSeek thinking:** breached in 29/33 runs, mostly the 10 s cap on non-extraction calls (polish/follow-up/title) and the 45 s extraction cap.
- **Every Luna level:** breached in every run. Most breaches are the server-wide undici `headersTimeout: 30 s`: OpenAI's non-streaming Responses API sends headers only when the response is complete, while DeepSeek sends headers in ~300 ms. As deployed, Natively would silently replace most Luna calls with Gemini, so adopting Luna would also require streaming or new deadlines.

**TTFT** does not exist on this non-streaming path, so it is reported as N/A rather than approximated.

# Token Usage

Mean per summary (all LLM calls in one post-meeting pipeline). Reasoning tokens are a subset of output tokens.

| Model | Input | Cached | Output | Reasoning | Visible output | LLM calls | Repair calls |
|---|---|---|---|---|---|---|---|
| DS Flash (current) | 66,666 | 16,357 | 27,960 | 0 | 27,960 | 10.7 | 2.03 |
| DS Flash thinking | 79,175 | 17,373 | 63,654 | 27,648 | 36,006 | 10.7 | 1.97 |
| Luna max | 86,669 | 14,153 | 175,611 | 121,218 | 54,392 | 11.1 | 2.20 |
| Luna medium | 62,170 | 16,746 | 31,221 | 2,050 | 29,171 | 10.5 | 1.82 |
| Luna low | 58,728 | 16,746 | 27,072 | 749 | 26,323 | 10.5 | 1.79 |
| Luna none | 63,023 | 16,746 | 29,959 | 0 | 29,959 | 10.5 | 1.82 |

**Input tokens are 5-14× the transcript size.** The ~6,500-char chunk system prompt (mode sections, density rules, grounding rules, JSON shape) is re-sent for every chunk. The polish, follow-up and title prompts then carry the extracted notes, which are themselves large.

**Cached tokens** (~14-17k per summary) come mostly from benchmark repeats and shared prompt prefixes. Real meetings would cache less, so cost below is priced cold.

**Output is dominated by chunk extraction JSON** (~28k tokens per summary for the current config).

**Reasoning spend per summary:**
- **Luna:** none 0; low ~0.7k; medium ~2k; max ~121k. Max spends 2.2× more reasoning than visible output.
- **DeepSeek thinking:** ~28k.

**Repair calls** (~1.8-2.2 per summary) are mostly polish re-tries after the "no new tokens" gate rejects the first polish. Chunk-JSON repairs are rare (0-0.12 per run).

# Actual Cost

Computed from each call's provider-reported usage × current list price (https://api-docs.deepseek.com/quick_start/pricing/, https://developers.openai.com/api/docs/models/gpt-5.6-luna; checked 2026-09-17). **Primary metric = cold-cache price** (all input billed as uncached): every real meeting is unique, whereas benchmark repeats of the same transcript hit provider prompt caches. DeepSeek blended = 20.8% peak / 79.2% off-peak (uniform traffic across the week).

| Model | $/summary (blended) | $/1k | $/10k | $/100k | $/1M | Median $/summary | P90 $/summary |
|---|---|---|---|---|---|---|---|
| DS Flash (current) | $0.03235 | $32.35 | $323.54 | $3,235.44 | $32,354.42 | $0.02838 (off-peak) | $0.04402 (off-peak) |
| DS Flash thinking | $0.06050 | $60.50 | $605.00 | $6,049.98 | $60,499.76 | $0.05243 (off-peak) | $0.08301 (off-peak) |
| Luna max | $0.22807 | $228.07 | $2,280.66 | $22,806.65 | $228,066.49 | $0.22716 | $0.38338 |
| Luna medium | $0.04990 | $49.90 | $498.99 | $4,989.91 | $49,899.12 | $0.05303 | $0.08497 |
| Luna low | $0.04423 | $44.23 | $442.31 | $4,423.15 | $44,231.49 | $0.04637 | $0.07691 |
| Luna none | $0.04856 | $48.56 | $485.56 | $4,855.56 | $48,555.64 | $0.04957 | $0.08865 |

| Model | Cold off-peak $/summary | Cold peak $/summary | As billed in this benchmark (with cache hits) | Cost vs current DS Flash (blended) |
|---|---|---|---|---|
| DS Flash (current) | $0.02678 | $0.05355 | $0.02437 | 1.00× |
| DS Flash thinking | $0.05007 | $0.10014 | $0.04751 | 1.87× |
| Luna max | $0.22807 | $0.22807 | $0.22552 | 7.05× |
| Luna medium | $0.04990 | $0.04990 | $0.04688 | 1.54× |
| Luna low | $0.04423 | $0.04423 | $0.04122 | 1.37× |
| Luna none | $0.04856 | $0.04856 | $0.04554 | 1.50× |

**Why Luna is not cheaper here.** Per million tokens:
- **Input:** Luna $0.20, vs DeepSeek $0.15 off-peak / $0.30 peak.
- **Output:** Luna $1.20, vs DeepSeek $0.60 off-peak / $1.20 peak.

This workload spends most of its money on output (~28-30k output vs ~60-65k input tokens per summary), so Luna at `none` costs about the same as DeepSeek during DeepSeek's peak window and ~1.8× DeepSeek's off-peak price. Weighted by the weekly peak share (20.8%), the current config costs **$0.032 per summary ($32k per million summaries)**. Luna comes to $44k (low), $49k (none), $50k (medium) and $228k (max) per million.

Luna `none` is not cheaper than `low`: Luna low produced slightly *less* output in total. Its tiny reasoning budget (~0.7k tokens) was more than offset by ~3k fewer visible output tokens.

**Assumptions.**
- List prices only (no batch discounts, no negotiated rates).
- Cold cache (every meeting unique).
- DeepSeek peak/off-peak weighted by hours, assuming uniform traffic. Natively's real traffic shape would move the DeepSeek number between $0.027 (all off-peak) and $0.054 (all peak).
- Luna `cache_write_tokens` are billed as normal input.

**As billed in this benchmark**, with cache hits and all runs in DeepSeek off-peak hours: $0.024 per summary for the current config.

**Pricing-tier caveat: OpenAI Flex.** OpenAI also sells Luna under Flex processing (`service_tier: "flex"`, supported on the Responses API) and the Batch API. Both are exactly half price: $0.10 input / $0.01 cached / $0.60 output. Applying that to the measured token usage:

| Luna at Flex rates | $/summary | vs current DS (blended) | vs DS off-peak | $/1M summaries |
|---|---|---|---|---|
| none | $0.0243 | 0.75× | 0.91× | $24.3k |
| low | $0.0221 | 0.68× | 0.83× | $22.1k |
| medium | $0.0249 | 0.77× | 0.93× | $25.0k |
| max | $0.1140 | 3.52× | 4.26× | $114.0k |

So Luna none/low/medium on Flex would be **23-32% cheaper than the current config at blended DeepSeek pricing, and 7-17% cheaper than DeepSeek off-peak.** That saving comes with three costs:
- **Latency:** Flex was **not measured** here (no OpenAI credits remained). OpenAI documents it as slower, with occasional resource unavailability, on a path that is already 95-107 s p50 against 41 s.
- **Quality:** the 5.8-6.7 pp fact-retention deficit is unchanged.
- **Batch:** the 24-hour Batch API does not fit post-meeting notes a user opens right after the call.

Flex is the only way Luna meets the "cheaper" requirement, and not by the "significantly cheaper" margin while quality is lower.

**Total provider spend** for all benchmark runs was about $12.45 (DeepSeek ≈ $2.37, OpenAI ≈ $10.08).

# Quality

Judge: `gemini-3.1-pro-preview` (neither candidate family), blind (opaque ids; no model/effort/price/latency), temperature 0, given the numbered transcript + gold fact sheet + one candidate. Scores 1–10. "Fact retention" = judge per-fact verdicts vs the gold fact sheet (present = 1, partial = 0.5), importance-weighted critical 3 / important 2 / minor 1. 95% CIs bootstrap over conversations.

| Model | Judged runs | Overall | Accuracy | Retention (judge) | Fact retention (weighted) | Critical facts | Hallucination control | Actions | Decisions | Structure |
|---|---|---|---|---|---|---|---|---|---|---|
| DS Flash (current) | 32/33 | 4.69 | 6.56 | 8.63 | 93.1% | 94.6% | 8.41 | 8.44 | 8.66 | 4.06 |
| DS Flash thinking | 31/33 | 4.48 | 7.03 | 9.13 | 94.9% | 94.3% | 8.94 | 8.94 | 9.10 | 4.19 |
| Luna max | 15/20 | 4.60 | 7.27 | 9.07 | 96.1% | 97.2% | 8.87 | 9.07 | 8.87 | 4.93 |
| Luna medium | 29/33 | 5.21 | 6.41 | 8.21 | 87.5% | 90.5% | 7.83 | 8.34 | 7.93 | 5.90 |
| Luna low | 31/33 | 4.84 | 6.52 | 8.26 | 86.7% | 90.1% | 7.71 | 8.52 | 8.42 | 4.74 |
| Luna none | 29/33 | 4.48 | 6.59 | 8.28 | 87.4% | 89.3% | 8.31 | 8.21 | 8.34 | 4.10 |

**All judge dimensions (mean)**

| Model | speaker_attribution | numeric_accuracy | entity_retention | timeline_accuracy | conclusion_accuracy | conciseness | readability |
|---|---|---|---|---|---|---|---|
| DS Flash (current) | 8.50 | 7.75 | 9.09 | 7.88 | 7.47 | 2.44 | 4.00 |
| DS Flash thinking | 8.81 | 7.94 | 9.42 | 8.29 | 7.58 | 1.90 | 3.74 |
| Luna max | 9.00 | 8.33 | 9.27 | 8.33 | 8.67 | 2.07 | 3.87 |
| Luna medium | 7.90 | 7.38 | 8.72 | 7.86 | 7.34 | 2.86 | 4.55 |
| Luna low | 8.16 | 7.68 | 8.52 | 7.55 | 7.23 | 2.58 | 4.19 |
| Luna none | 7.83 | 7.52 | 8.69 | 7.69 | 7.28 | 2.14 | 3.83 |

**Uncertainty and paired comparison vs current DeepSeek config** (per-conversation means; paired difference = config − DS Flash current, bootstrap 95% CI over conversations)

| Model | Overall [95% CI] | Δ overall vs current [95% CI] | Fact retention [95% CI] | Δ fact retention vs current [95% CI] | Δ critical-fact retention [95% CI] |
|---|---|---|---|---|---|
| DS Flash (current) | 4.65 [4.05, 5.21] | — | 93.2% [90.0%, 96.0%] | — | — |
| DS Flash thinking | 4.53 [3.88, 5.30] | -0.12 [-0.62, 0.44] | 94.7% [91.6%, 97.4%] | 1.5 pp [-2.8, 5.1] | -1.2 pp [-9.4, 5.4] |
| Luna max | 4.77 [4.15, 5.38] | -0.02 [-0.90, 0.73] | 95.6% [94.2%, 97.1%] | 2.8 pp [-0.8, 7.3] | 1.9 pp [-2.7, 8.2] |
| Luna medium | 5.21 [4.36, 6.12] | 0.56 [-0.03, 1.20] | 87.2% [84.6%, 89.8%] | -6.0 pp [-9.3, -2.2] | -4.4 pp [-8.8, 1.1] |
| Luna low | 4.82 [4.17, 5.67] | 0.17 [-0.44, 0.85] | 86.5% [83.3%, 89.4%] | -6.7 pp [-10.1, -3.1] | -5.0 pp [-9.9, -0.3] |
| Luna none | 4.53 [3.85, 5.24] | -0.12 [-0.53, 0.30] | 87.4% [84.7%, 89.9%] | -5.8 pp [-9.8, -2.0] | -5.3 pp [-12.3, 0.7] |

**Robustness check — common conversation set** (the 8 conversations where every configuration has ≥1 judged run: INT-M, INT-TECH-L, LECT-VL, REAL-LECT-VL, SALES-DISC-L, SALES-S, TEAM-S, TECH-DISC-L). Luna max lost 13 runs to OpenAI credit exhaustion, leaving it with no judged run of CASUAL-M or TEAM-M, two conversations where the other Luna configurations performed worst; this table removes that coverage bias.

| Model | Runs (judged) | Fact retention (weighted) | Critical facts | Overall | Contradicted facts | P50 E2E | Δ fact retention vs current | Conversations worse than current |
|---|---|---|---|---|---|---|---|---|
| DS Flash (current) | 24 (24) | 92.9% | 94.4% | 4.79 | 0.42 | 45.0s | — | — |
| DS Flash thinking | 24 (23) | 96.4% | 96.8% | 4.77 | 0.50 | 116.5s | 3.5 pp | 1/8 |
| Luna max | 18 (15) | 95.6% | 96.4% | 4.77 | 0.75 | 641.9s | 2.8 pp | 3/8 |
| Luna medium | 24 (21) | 88.0% | 92.0% | 5.50 | 1.25 | 109.2s | -4.9 pp | 7/8 |
| Luna low | 24 (23) | 88.1% | 92.7% | 4.94 | 0.75 | 95.9s | -4.8 pp | 7/8 |
| Luna none | 24 (21) | 89.1% | 93.1% | 4.73 | 0.33 | 100.9s | -3.8 pp | 7/8 |

**Summary-specific failure counts (mean per summary)**

| Model | Contradicted facts | Critical errors | Hallucinations | Superseded value reported | Suggestion reported as decision | Distractors included | Correction final-value retention |
|---|---|---|---|---|---|---|---|
| DS Flash (current) | 0.41 | 2.19 | 0.75 | 1.31 | 0.44 | 2.59 | 93.6% |
| DS Flash thinking | 0.77 | 1.74 | 0.55 | 1.19 | 0.48 | 3.39 | 89.4% |
| Luna max | 0.67 | 0.80 | 0.60 | 0.80 | 0.00 | 1.40 | 92.9% |
| Luna medium | 1.55 | 2.14 | 0.76 | 1.34 | 0.38 | 0.86 | 84.5% |
| Luna low | 1.23 | 1.81 | 1.10 | 1.13 | 0.42 | 0.58 | 85.7% |
| Luna none | 1.14 | 1.79 | 0.86 | 1.21 | 0.34 | 1.14 | 83.5% |

**Retention by fact type**

| Model | numbers | actions | decisions | timeline | entities | customer | risks_questions | concepts |
|---|---|---|---|---|---|---|---|---|
| DS Flash (current) | 93.1% | 92.7% | 96.8% | 86.5% | 91.0% | 90.0% | 99.6% | 92.7% |
| DS Flash thinking | 93.9% | 95.0% | 96.0% | 89.3% | 94.7% | 93.7% | 98.5% | 94.2% |
| Luna max | 98.1% | 92.6% | 100.0% | 83.5% | 91.0% | 97.1% | 100.0% | 97.2% |
| Luna medium | 83.7% | 88.6% | 95.6% | 71.9% | 77.7% | 84.9% | 97.0% | 81.0% |
| Luna low | 81.8% | 91.8% | 96.6% | 70.9% | 73.1% | 83.6% | 94.2% | 84.8% |
| Luna none | 88.3% | 91.7% | 92.8% | 66.8% | 77.2% | 83.8% | 96.8% | 87.9% |

**Distributed-information test: retention of critical+important facts by position in the transcript**

| Model | Early third | Middle third | Final third |
|---|---|---|---|
| DS Flash (current) | 93.3% | 93.4% | 94.2% |
| DS Flash thinking | 98.0% | 93.1% | 95.1% |
| Luna max | 96.6% | 97.0% | 97.1% |
| Luna medium | 87.9% | 89.0% | 90.5% |
| Luna low | 85.8% | 87.3% | 91.3% |
| Luna none | 86.6% | 85.9% | 92.1% |

**Pipeline behaviour per model (same prompts, same code)**

| Model | Summary-polish rejected by "no new tokens" gate | Overview-polish rejected | Runs with dropped chunks | Chunk-JSON repair calls / run | Section bullets | Action items | Decisions |
|---|---|---|---|---|---|---|---|
| DS Flash (current) | 69.7% | 87.9% | 2/33 | 0.12 | 171.5 | 21.4 | 11.4 |
| DS Flash thinking | 51.5% | 93.9% | 0/33 | 0.00 | 226.3 | 25.1 | 16.0 |
| Luna max | 35.0% | 85.0% | 0/20 | 0.00 | 326.7 | 26.5 | 15.9 |
| Luna medium | 30.3% | 78.8% | 1/33 | 0.03 | 183.2 | 20.2 | 11.7 |
| Luna low | 45.5% | 87.9% | 0/33 | 0.00 | 168.5 | 21.2 | 11.6 |
| Luna none | 57.6% | 93.9% | 1/33 | 0.03 | 202.2 | 22.1 | 11.8 |

**How to read this section.** The most reliable signal is the per-fact verdicts against the gold fact sheets, aggregated as importance-weighted fact retention and compared **paired by conversation**. The 1-10 "overall", "structure", "conciseness" and "readability" scores are compressed into 1.9-5.9 for every configuration, and mostly measure model-independent pipeline behaviour:
- The deterministic reducer duplicates the same items across mode sections and structured blocks. Natively's copy/export repeats them too.
- Notes can only say "Speaker 1"/"Me".
- Superseded values from earlier chunks survive the merge (see Failure Analysis).

Treat those scores as descriptive, not decisive.

**Findings**
1. **Luna none/low/medium retain fewer facts than the current config.** Paired Δ is −5.8 to −6.7 pp with CIs excluding zero on all 11 conversations, and −3.8 to −4.9 pp (worse in 7/8 conversations) on the common set. The losses concentrate on:
   - timeline facts (67-72% vs 87%)
   - entities/people (73-78% vs 91%)
   - numbers (82-88% vs 93%)
   - concepts (81-88% vs 93%)

   Decisions, risks and open questions are near-equal (93-100%). Luna also contradicts more facts: 1.1-1.6 per summary vs 0.4, typically by stating a superseded or wrong value.
2. **Luna produces more selective notes.** It includes fewer distractors (0.6-1.1 vs 2.6 per summary). The judge scores Luna medium a little higher on overall (+0.56, CI [−0.03, +1.20], not significant) and on structure (5.9 vs 4.1). Selectivity is the flip side of its lower fact retention: it drops background specifics the gold sheets count.
3. **Luna max and DeepSeek-thinking retain slightly more than the current config.** They reach 96.1% / 94.9% vs 93.1%, with paired CIs including zero. Luna max had the fewest critical errors (0.8 vs 2.2) and no suggestions reported as decisions, but only 15 judged runs.
4. **Hallucination is low for every model** (0.55-1.10 flagged items per summary). The main accuracy failure is not invention; it is keeping a value that was later corrected.

# Quality by Conversation Type

Mean over judged runs; cells with fewer than 3 judged runs show n.

| Model | sales overall | team_meeting overall | interview overall | casual_mixed overall | technical_discussion overall | lecture overall | sales fact ret. | team_meeting fact ret. | interview fact ret. | casual_mixed fact ret. | technical_discussion fact ret. | lecture fact ret. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DS Flash (current) | 5.33 | 5.00 | 4.33 | 3.50 (n=2) | 4.33 | 4.67 | 89.2% | 91.9% | 89.9% | 98.3% (n=2) | 97.4% | 95.9% |
| DS Flash thinking | 5.60 | 4.83 | 4.17 | 3.00 (n=2) | 3.67 | 4.44 | 97.2% | 93.2% | 92.2% | 82.5% (n=2) | 98.8% | 98.2% |
| Luna max | 5.00 | 6.00 (n=1) | 4.67 | — (n=0) | 6.00 (n=1) | 3.60 | 98.3% | 93.0% (n=1) | 93.2% | — (n=0) | 95.6% (n=1) | 96.3% |
| Luna medium | 6.67 | 5.60 | 4.20 | 3.00 (n=2) | 3.67 | 5.63 | 91.7% | 82.5% | 82.5% | 82.5% (n=2) | 89.1% | 91.1% |
| Luna low | 6.33 | 5.20 | 4.33 | 3.33 | 4.00 | 4.75 | 89.6% | 83.3% | 82.7% | 79.8% | 89.1% | 91.5% |
| Luna none | 6.00 | 4.80 | 4.40 | 2.67 | 3.33 | 4.67 | 91.2% | 85.2% | 85.7% | 77.7% | 87.6% | 91.0% |

Most cells have 3 judged runs; cells with fewer are marked. Differences within a type are noisy at this sample size, so read these for direction only:
- **Sales:** Luna none/low/medium match the current config (89.6-91.7% vs 89.2%). The current config's sales mean is pulled down by one run that dropped 2 chunks (SALES-DISC-L run 2; see Failure Analysis). DeepSeek-thinking and Luna max score 97-98%.
- **Team meetings and interviews:** Luna none/low/medium lose 4-9 pp (82.5-85.7% vs 89.9-91.9%). These conversations carry many owners, dates and owner changes.
- **Casual/mixed (CASUAL-M):** the largest Luna gap (77.7-82.5% vs 98.3%, current config n=2). Luna repeatedly kept superseded trip dates, cost split and booking owner. DeepSeek-thinking also dropped to 82.5% on the same traps.
- **Technical discussion:** 87.6-89.1% for Luna none/low/medium vs 97.4% current.
- **Lectures** (1 synthetic + 2 real): 91.0-91.5% for Luna none/low/medium vs 95.9% current; 96-98% for thinking/max.

# Quality by Transcript Length

Mean over judged runs; cells with fewer than 3 judged runs show n. Buckets: short = SALES-S, TEAM-S (7-9 min); medium = INT-M, CASUAL-M (27-28 min); long = TEAM-M, INT-TECH-L, SALES-DISC-L, TECH-DISC-L, REAL-LECT-L (49-65 min); very long = LECT-VL, REAL-LECT-VL (90-99 min).

| Model | short overall | medium overall | long overall | very_long overall | short fact ret. | medium fact ret. | long fact ret. | very_long fact ret. | short critical | medium critical | long critical | very_long critical |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DS Flash (current) | 5.67 | 3.40 | 4.80 | 4.50 | 96.5% | 93.6% | 90.5% | 95.6% | 100.0% | 96.5% | 90.8% | 97.2% |
| DS Flash thinking | 6.40 | 3.20 | 4.33 | 4.33 | 97.7% | 87.4% | 95.1% | 98.3% | 100.0% | 77.9% | 96.4% | 98.1% |
| Luna max | 5.25 | 4.00 (n=1) | 5.20 | 3.60 | 96.7% | 93.8% (n=1) | 95.8% | 96.3% | 98.4% | 90.0% (n=1) | 97.8% | 97.1% |
| Luna medium | 7.80 | 3.40 | 4.79 | 5.60 | 89.4% | 82.1% | 87.3% | 91.4% | 95.0% | 83.9% | 90.5% | 92.7% |
| Luna low | 7.00 | 3.83 | 4.57 | 4.20 | 89.6% | 81.0% | 86.1% | 91.9% | 95.8% | 83.5% | 88.6% | 95.4% |
| Luna none | 6.00 | 3.00 | 4.54 | 4.33 | 89.5% | 81.1% | 86.9% | 92.1% | 95.0% | 76.0% | 89.6% | 94.8% |

**Quality does not degrade with transcript length, for any configuration.** The current config retains 96.5% (short), 93.6% (medium), 90.5% (long) and 95.6% (very long). The ~90-99 minute lectures are among the best-retained inputs for every model. This follows from the pipeline design: V3 never summarizes a long prefix in one pass. It extracts per ~3,000-token chunk and reduces deterministically, so each model call sees the same amount of text regardless of meeting length.

The distributed-information test shows no "recency bias" either. Retention of critical+important facts is flat across the early, middle and final thirds. Luna none/low retain final-third facts ~4-6 pp better than earlier ones, the opposite of lost-in-the-middle. The corresponding weakness is **cross-chunk supersession**: when a value set early is corrected later, each chunk reports its own local truth, and the reducer keeps both.

What *does* grow with length is latency. The current config goes from 24 s p50 (short) to 65 s (very long); Luna none/low/medium from 52-58 s to 146-159 s; Luna max from 448 s to 908 s.

# Per-conversation results

| Conversation | DS Flash (current) | DS Flash thinking | Luna max | Luna medium | Luna low | Luna none |
|---|---|---|---|---|---|---|
| SALES-S | 5.7 · 96.8% · 23.4s | 7.5 · 100.0% · 77.9s | 5.0 · 98.0% · 469.5s | 8.3 · 93.4% · 57.3s | 8.3 · 91.1% · 51.0s | 7.0 · 93.1% · 55.8s |
| TEAM-S | 5.7 · 96.2% · 24.8s | 5.7 · 96.2% · 74.8s | 6.0 · 93.0% · 402.3s | 7.0 · 83.3% · 57.8s | 5.7 · 88.0% · 53.7s | 5.3 · 87.1% · 49.8s |
| INT-M | 3.3 · 90.4% · 25.7s | 3.3 · 90.8% · 61.9s | 4.0 · 93.8% · 464.7s | 3.7 · 81.8% · 86.9s | 4.3 · 82.2% · 63.0s | 3.5 · 86.2% · 58.5s |
| CASUAL-M | 3.5 · 98.3% · 27.1s | 3.0 · 82.5% · 79.5s | — · — · 386.5s | 3.0 · 82.5% · 68.0s | 3.3 · 79.8% · 55.5s | 2.7 · 77.7% · 54.8s |
| TEAM-M | 4.3 · 87.7% · 59.7s | 4.0 · 90.1% · 151.9s | — | 4.7 · 82.0% · 120.2s | 4.5 · 76.2% · 96.7s | 4.0 · 82.3% · 112.5s |
| INT-TECH-L | 5.3 · 89.5% · 39.2s | 5.0 · 93.5% · 136.9s | 5.0 · 92.9% · 665.5s | 5.0 · 83.5% · 107.2s | 4.3 · 83.1% · 96.6s | 5.0 · 85.5% · 103.0s |
| SALES-DISC-L | 5.0 · 81.6% · 56.0s | 4.3 · 95.3% · 119.4s | 5.0 · 98.8% · 760.6s | 5.0 · 90.1% · 128.2s | 4.3 · 88.2% · 111.7s | 5.0 · 89.4% · 120.6s |
| TECH-DISC-L | 4.3 · 97.4% · 50.2s | 3.7 · 98.8% · 131.0s | 6.0 · 95.6% · 577.5s | 3.7 · 89.1% · 111.3s | 4.0 · 89.1% · 94.6s | 3.3 · 87.6% · 98.7s |
| REAL-LECT-L | 5.0 · 96.5% · 41.3s | 4.7 · 98.0% · 91.1s | — · — · 556.4s | 5.7 · 90.6% · 106.8s | 5.7 · 90.8% · 86.8s | 5.3 · 88.9% · 94.2s |
| LECT-VL | 3.0 · 97.6% · 71.9s | 4.3 · 97.5% · 162.2s | 3.7 · 95.5% · 908.1s | 5.3 · 91.5% · 171.1s | 4.0 · 92.8% · 149.8s | 3.7 · 93.5% · 156.6s |
| REAL-LECT-VL | 6.0 · 93.6% · 60.6s | 4.3 · 99.1% · 133.4s | 3.5 · 97.5% · 900.5s | 6.0 · 91.3% · 145.7s | 4.5 · 90.5% · 146.1s | 5.0 · 90.6% · 187.3s |

Cell = mean overall score (judged runs) · mean weighted fact retention (judged runs) · median E2E latency (all selected runs; Luna max has 1-3).

# Failure Analysis

Examples are taken verbatim from the blind judge's flagged items or from the pipeline logs. All are reproducible from `benchmark/evaluations/` and `benchmark/outputs/`.

### Failures shared by every model (pipeline architecture, not model choice)
1. **Superseded values survive the map-reduce.** Every configuration reported ~0.8-1.3 superseded values per summary. Chunk extraction sees only its own ~12k chars, so an early chunk records a value and a later chunk records the correction, and `MeetingSummaryReducer` merges both. Examples:
   - **INT-M.** The salary band was corrected from $128k-$146k to $148k-$172k. Every model, including current DeepSeek, Luna max and Luna medium, still reported "$155k target above the $128k-$146k band" as an open risk.
   - **CASUAL-M.** Trip dates moved from Oct 16-19 to Oct 23-26, and the cabin booking moved from Priya to Dan. The superseded version appears in current-DeepSeek, DeepSeek-thinking and all Luna runs.
   - **LECT-VL.** The homework due date moved from Friday Oct 9 to Monday Oct 12. Luna max reported Oct 9.
2. **Chunk-boundary artifacts written as facts.** When a topic straddles a chunk boundary, models write notes about the chunk rather than the meeting:
   - current DeepSeek, INT-M: "Maya asked about benefits and **the chunk ends there**"
   - DeepSeek-thinking, INT-M: "not covered **in this chunk**"
   - Luna max, INT-TECH-L: "**The chunk ends before** Marcus answers…"
   - Luna none: "what was provided **in this chunk**"

   The reducer then keeps these as open questions even though the meeting answered them later ("resolved issues listed as open questions" is the most common critical error for every model).
3. **Duplication and "Speaker N".** The same decision/action appears in the mode section and the structured blocks, and people can only be named if a speaker says the name. These drive structure 4-6/10, conciseness 2-3/10 and readability 4-5/10 for all six configurations.

### DeepSeek V4.1 Flash — current config (thinking off)
- **Invalid JSON → dropped chunks.** 4 of 156 chunk outputs were unparseable.
  - **Cause (REAL-LECT-VL run 2).** The model copied the prompt's `TIME RANGE: 29824680:16 - …` into `"timeRange": {"startMs": 29824680:16, …}`. That value comes from `formatMs()` applied to epoch-ms timestamps.
  - **Why it dropped the chunk.** The one-shot repair payload re-sends the ~24k-char bad output, which exceeds natively-api's 25,000-char `EXTRACTION_DEEPSEEK_MAX_CHARS`. That routes the repair to Gemini, which was blocked here, so the chunk was dropped. In production, Gemini would have repaired it.
  - **Impact (SALES-DISC-L run 2).** 2 chunks were lost, so that run missed the CFO's $40k approval threshold, the $45→$39 pricing and the "don't phase the rollout" decision. Its fact retention for SALES-DISC-L was 81.6%, versus 95%+ in the other two runs.
- **Most distractors included** (2.6 per summary), e.g. passing suggestions such as "Mia will handle the card and flowers" written as action items.
- **Small factual slips**, e.g. INT-M: "offsite around November 16th" (it is the week of Nov 9th).

### DeepSeek V4.1 Flash — thinking ON
- Best numbers/entities/timeline retention among the non-max configs, and zero invalid JSON. It still fails the same supersession traps: CASUAL-M "$285 each, four people" instead of the final $380 each for three.
- 2.75× the latency. Non-extraction calls routinely exceed the production 10 s cap, 29/33 runs.
- One truncated sentence in a Summary bullet (INT-M run 2: "presented a $128K–$14").

### GPT-5.6 Luna — none / low / medium
- **Money direction reversed.** CASUAL-M: "Dan ('Me') owes Priya $190 and needs to send it tonight". Priya owes Dan. This came up in Luna low runs 2 and 3 and Luna medium run 1.
- **Timeline errors.** "The final trip dates (Oct 23-26) are the weekend before Maya's Oct 21 birthday" (Luna low; it is the weekend after). Timeline retention is 67-72% vs 87% for current DeepSeek.
- **Lower specificity on background and entities.** On critical CASUAL-M action F16, "Dan books the cabin, taking over from Priya", current DeepSeek is 100% present while Luna none/low/medium manage 13%, with 7 contradictions. Other gaps: TECH-DISC-L's outage date (Tue Sep 8), 33% vs 100%; INT-M's four-session final loop, 31% vs 100%.
- **Unfounded absence claims** (Luna medium, INT-M): "The benefits package was not discussed because the call ended…"; "The next hiring step was not specified".
- More contradicted facts (1.1-1.6 vs 0.4 per summary). Fewer distractors (0.6-1.1).

### GPT-5.6 Luna — max
- Highest retention and fewest critical errors (0.8), but ~10 minutes per meeting and 7× the cost.
- **Action-item pollution** (INT-TECH-L run 1): past events and facts listed as action items with deadlines ("Marcus committed to ship the reconciliation alert during the rollout"; "Project Tally is targeted for…").
- **Heaviest chunk meta-commentary** of any config (INT-TECH-L run 3: three "the chunk/transcript ends before…" items).
- Many mid-run OpenAI 429s, all "no credits remaining": an account billing event, not model behaviour (13 runs excluded).

# Cost / Quality / Latency Tradeoff

| Model | Overall | Fact retention | P50 E2E | P90 E2E | $/summary (blended) | $/1M summaries | Cost vs current |
|---|---|---|---|---|---|---|---|
| DS Flash (current) | 4.69 | 93.1% | 41.3s | 62.4s | $0.03235 | $32,354.42 | 1.00× |
| DS Flash thinking | 4.48 | 94.9% | 113.6s | 157.2s | $0.06050 | $60,499.76 | 1.87× |
| Luna max | 4.60 | 96.1% | 597.8s | 909.0s | $0.22807 | $228,066.49 | 7.05× |
| Luna medium | 5.21 | 87.5% | 106.8s | 155.6s | $0.04990 | $49,899.12 | 1.54× |
| Luna low | 4.84 | 86.7% | 94.6s | 146.2s | $0.04423 | $44,231.49 | 1.37× |
| Luna none | 4.48 | 87.4% | 97.7s | 156.6s | $0.04856 | $48,555.64 | 1.50× |

**At standard OpenAI pricing, current DeepSeek beats Luna none, low and medium on all three axes at once.** It is cheaper (Luna costs 1.37-1.54× more), faster (Luna's p50 is 2.3-2.6× longer) and retains more facts (+5.8 to +6.7 pp, significant). At OpenAI Flex pricing, Luna none/low/medium become 23-32% cheaper, but still slower (Flex adds latency, not measured here) and less accurate. The trade becomes about 25% lower cost for ~6 pp less fact retention and more than 2× the latency.

Only two configurations score higher than the current one on quality, and neither difference is statistically significant with this corpus:

| Upgrade over current | Δ fact retention | Extra cost | Extra latency (p50) | Production deadline breaches |
|---|---|---|---|---|
| DeepSeek V4.1 Flash, thinking ON | +1.5 pp [−2.8, +5.1] | 1.87× | 2.75× (114 s) | 29/33 runs |
| GPT-5.6 Luna max | +2.8 pp [−0.8, +7.3] (8 conversations) | 7.05× | 14.5× (598 s) | 20/20 runs |

If Natively later decides a few points of retention are worth paying for, DeepSeek-thinking is the far cheaper and faster way to get them. Neither is justified by this data for a high-volume default.

# Requirements Screening

| Requirement | DS Flash current | DS Flash thinking | Luna max | Luna medium | Luna low | Luna none |
|---|---|---|---|---|---|---|
| ≥70% of DS V4.1 Flash capability (screen) | baseline | pass | pass (103% of current retention) | pass (94%) | pass (93%) | pass (94%) |
| Significantly cheaper than DS V4.1 Flash (standard pricing) | baseline | **fail** (1.87×) | **fail** (7.05×) | **fail** (1.54×) | **fail** (1.37×) | **fail** (1.50×) |
| …at OpenAI Flex pricing (latency unmeasured, slower) | — | — | fail (3.52×) | marginal (0.77×) | marginal (0.68×) | marginal (0.75×) |
| Normal summary latency (~8 s good; 10-15 s acceptable; 20 s tolerable for long; 30 s+ undesirable) | fails target (41 s p50; 24 s short, 65 s very long) | fail (114 s) | **clear fail** (598 s; ~10 min) | fail (107 s) | fail (95 s) | fail (98 s) |
| Quality more important than a few seconds | — | ≈ current | ≈ current or slightly better | **worse** (−6.0 pp) | **worse** (−6.7 pp) | **worse** (−5.8 pp) |
| High volume ($ per 1M summaries) | $32k | $60k | $228k | $50k | $44k | $49k |
| Works with production deadlines as deployed | yes (0/33 breaches) | no (29/33) | no (20/20) | no (33/33) | no (33/33) | no (33/33) |

**Configurations that clearly fail the stated requirements:**
- **Luna max:** 7× cost, ~10 minutes per summary.
- **Luna medium, low and none:** each is more expensive, slower and less accurate than the current config.

The 70% capability screen is not the binding constraint. Every configuration passes it; cost and latency eliminate Luna. On OpenAI Flex, Luna low/none/medium would clear the cost bar by 23-32% (7-17% vs DeepSeek off-peak), but they would still be slower than today (Flex latency unmeasured) and retain 5.8-6.7 pp fewer facts. The saving buys a quality loss, not a like-for-like replacement.

# Does the current Natively prompt cause model-specific differences?

Yes. The prompts were deliberately *not* changed for this benchmark; these are observations for a follow-up. Several parts of the current Natively pipeline interact with model behaviour and change results per model:

1. **The polish "no new tokens" gate rejects mostly correct rewrites, at model-dependent rates.**
   - **Where.** `SummaryPolisher.newSignificantTokens` strips punctuation from each output token but normalizes the grounded notes differently.
   - **Effect.** "Maya's" becomes `Mayas`, "$1,140" becomes `$1140`, "$31.16" becomes `$3116`, and "16–19" / "Kaplan-Meier" keep their punctuation. None of them matches the notes, so the rewrite is rejected.
   - **Scale.** Across the 185 runs the gate rejected the LLM **overview** 79-94% of the time and the LLM **summary** 30-70% of the time. 776 rejected tokens were logged: 515 number-like, 256 capitalized, 5 other. The logged tokens are dominated by formatting variants of values the notes do contain (e.g. `$3116`, `$1140`, `Priyas`, `Kaplan-Meier`, `16–19`). A per-token presence check was not run, so the exact false-positive share is unmeasured.
   - **Model dependence.** Rejection rates depend on each model's formatting habits. Summary polish was rejected 70% of the time for current DeepSeek but 30% for Luna medium, so part of the judge's structure and readability differences come from this gate, not from the model's writing.
2. **Epoch timestamps leak into the chunk prompt.**
   - **Where.** Production transcript timestamps are `Date.now()` (`electron/main.ts:3505`). `ChunkSummaryGenerator.formatMs` renders them as minutes:seconds, giving `TIME RANGE: 29824680:16 - 29824692:12`, while the JSON shape hint shows raw epoch-ms numbers. Every segment line also carries `[1789588342s]`.
   - **Effect.** DeepSeek non-thinking copied the mm:ss form into a JSON number (invalid JSON). Other models tolerated it.
3. **The 25,000-char extraction size gate applies to repair calls.** A repair re-sends the model's own ~24k-char output, so any invalid chunk from a verbose model is routed away from the primary model. Currently it goes to Gemini.
4. **The density contract makes extraction output-bound.** "Aim for 5-12 findings per section per chunk" produces ~28-30k output tokens per summary for current DeepSeek and Luna none/low/medium, and ~54k visible (175k total) for Luna max (327 section bullets on average). Output volume, not input size, sets latency on every model and pushes conciseness to 2-3/10.
5. **Per-chunk framing ("CHUNK: n of N", "TIME RANGE") invites chunk meta-commentary** ("the chunk ends before…"), most often from Luna max. Combined with no cross-chunk reconciliation in the reducer, answered questions and superseded values persist.
6. **Production deadlines are tuned to DeepSeek's non-streaming behaviour.** The 10 s non-extraction cap and the 30 s undici `headersTimeout` hold for DeepSeek, which sends headers immediately. They are breached on every Luna run, because the OpenAI Responses API withholds headers until completion.

None of these were fixed in this work. They would need their own reproduce-then-fix change.

# Method, Fairness and Limitations

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

# Files

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

