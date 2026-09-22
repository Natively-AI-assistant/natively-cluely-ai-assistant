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
