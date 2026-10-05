**Why it is slow for everyone.** One post-meeting summary is ~11 LLM calls: one extraction call per ~3,000-token chunk (up to 3 concurrent), 2 parallel polish calls (plus a repair call when the polish gate rejects), a follow-up draft and a title. The chunk-extraction prompt demands dense JSON (5-12 evidence-bearing findings per section), so the chunk calls are **output-bound**: 5-9k output tokens each. Latency is therefore set by output token speed × output volume:
- **Output speed** on calls with >2k output tokens (p50): DeepSeek V4.1 Flash non-thinking **319 tok/s**; thinking 286 tok/s; Luna none 144, low 148, medium 140, max 124 tok/s.
- **Output volume** per summary is similar across DeepSeek non-thinking and Luna none/low/medium (26-31k visible tokens). Luna none/low/medium land at 2.3-2.6× DeepSeek's time; Luna max adds ~121k reasoning tokens and takes ~10 min.

**Against the 8 s / 10-15 s / 20 s / 30 s+ targets:** no configuration is close. The current production config is 24 s p50 for a 7-9 minute meeting and 65 s p50 for a 90-minute lecture. Every Luna level is ≥52 s p50 even for short meetings. The largest latency lever is the pipeline's output volume and call structure, not the choice between these models.

**Production deadlines.** Measured against the deadlines in the code today:
- **Current DeepSeek:** never breached one.
- **DeepSeek thinking:** breached in 29/33 runs, mostly the 10 s cap on non-extraction calls (polish/follow-up/title) and the 45 s extraction cap.
- **Every Luna level:** breached in every run. Most breaches are the server-wide undici `headersTimeout: 30 s`: OpenAI's non-streaming Responses API sends headers only when the response is complete, while DeepSeek sends headers in ~300 ms. As deployed, Natively would silently replace most Luna calls with Gemini, so adopting Luna would also require streaming or new deadlines.

**TTFT** does not exist on this non-streaming path, so it is reported as N/A rather than approximated.
