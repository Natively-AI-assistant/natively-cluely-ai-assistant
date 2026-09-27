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
