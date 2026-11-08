// electron/audio/whisper/moonshineTokenBudget.ts
//
// How many tokens a Moonshine pass may generate for a given amount of audio.
//
// transformers.js computes this itself when the caller does not:
//
//   const max_new_tokens = Math.floor(aud.length / sampling_rate) * 6;
//
// The floor is taken on WHOLE SECONDS, so anything under one second gets a
// budget of zero and comes back empty ("Yes", "Sounds good"), and a 1.9 second
// answer gets six tokens — about four words — and is cut off. Moonshine is the
// recommended default model, and the 400 ms streaming partials are all under
// one second, so this silently dropped short speech for most local users.
//
// The limit itself is the Moonshine paper's (quoted in the library source: "a
// heuristic limit of 6 output tokens per second of audio to avoid repeated
// output sequences"). This keeps that rate but applies it to the real
// duration, with a floor of three so a one-word answer can still finish.
//
// Measured 2026-10-14 on moonshine-base against crops of the 2.46 s
// known-phrase fixture ("The quick brown fox jumps over the lazy dog."):
//
//   audio    library budget -> text              this budget -> text
//   0.40 s   0  -> "The"                         3  -> "The quick."
//   0.99 s   0  -> "The"                         6  -> "The quick brown fox."
//   1.90 s   6  -> "The quick brown fox j"       12 -> "...jumps over the leaves."
//   2.46 s   12 -> full sentence                 15 -> full sentence
//
// A larger floor or extra headroom was tried and rejected: on a window that
// ends mid-word (every streaming partial does) the spare tokens are spent
// repeating the cut word ("The quick br br br br"), which is exactly what the
// limit exists to prevent.
//
// Pure module: no imports, safe in the worker thread and testable under plain
// node.

/** Tokens per second of audio — the Moonshine paper's repetition guard. */
export const MOONSHINE_TOKENS_PER_SECOND = 6;
/** Enough for a one-word answer and its punctuation on a very short clip. */
export const MOONSHINE_MIN_NEW_TOKENS = 3;

export function moonshineMaxNewTokens(sampleCount: number, sampleRate: number = 16000): number {
    if (!Number.isFinite(sampleCount) || sampleCount <= 0) return MOONSHINE_MIN_NEW_TOKENS;
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return MOONSHINE_MIN_NEW_TOKENS;
    const seconds = sampleCount / sampleRate;
    return Math.max(MOONSHINE_MIN_NEW_TOKENS, Math.ceil(seconds * MOONSHINE_TOKENS_PER_SECOND));
}
