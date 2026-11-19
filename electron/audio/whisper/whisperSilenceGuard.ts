/**
 * Whisper's own guards against transcribing silence and noise, which
 * transformers.js 3.8.1 does not implement: it accepts no_speech_threshold,
 * logprob_threshold and compression_ratio_threshold and ignores all three
 * (none of them appears in the library). Measured 2026-11-18: pure noise came
 * back as "you know." and "[? [? [? [? [? [ [ [.........".
 */
import { deflateSync } from 'zlib';

// Whisper's defaults (openai/whisper transcribe.py).
export const NO_SPEECH_THRESHOLD = 0.6;
export const COMPRESSION_RATIO_THRESHOLD = 2.4;

// Mean log-probability per token below which a final is dropped. Distil's
// no-speech probability stays at 0.06-0.10 on clicks and coughs, so it alone
// let "You", "Oh", "Whoa." through. Measured 2026-11-18 (teacher-forced, see
// whisperWorker meanLogprob): real speech -0.22 to -2.55 on Distil Small EN,
// -0.38 to -1.69 on Whisper Tiny even where its transcript was wrong; the
// invented words -5.94 to -10.36 on Distil Small, -4.76 to -5.29 on Distil
// Medium ("You're" x8 from clicks), -2.1 to -4.98 on Tiny (those above -4 were
// already dropped as no speech). Tightest margin: Distil Medium's -4.76.
export const LOGPROB_FLOOR = -4;

/**
 * P(<|nospeech|>) at the first decoder step after <|startoftranscript|>, how
 * openai/whisper computes no_speech_prob. Null when the model has no such token.
 */
export function noSpeechProbability(logits: ArrayLike<number>, noSpeechId: number | undefined): number | null {
  if (noSpeechId === undefined || !(noSpeechId >= 0 && noSpeechId < logits.length)) return null;
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) sum += Math.exp(logits[i] - max);
  return Math.exp(logits[noSpeechId] - max) / sum;
}

/** Text that compresses like a loop ("thank you. thank you. thank you...") or noise ("[? [? [?"). */
export function looksLikeLoop(text: string): boolean {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length < 24) return false;
  return bytes.length / deflateSync(bytes).length > COMPRESSION_RATIO_THRESHOLD;
}

/** The token Whisper predicts for no speech: <|nocaptions|> before v3, <|nospeech|> from v3. */
export function noSpeechTokenId(tokenizer: any): number | undefined {
  const ids: Map<string, number> | undefined = tokenizer?.model?.tokens_to_ids;
  return ids?.get('<|nospeech|>') ?? ids?.get('<|nocaptions|>');
}

/**
 * Token budget for one Whisper pass. transformers.js lets every pass run to
 * Whisper's 448-token window, so a repetition loop on a 5 s partial ran ~30 s
 * on Whisper Small and held every final behind it (Hindi, 2026-11-18; the loop
 * was dropped, but only after the time was spent). 40 tokens a second is ~4x
 * fast Hindi or Japanese speech, the most token-dense languages here.
 * The decoder's 448 positions also hold the start tokens and any prompt, so
 * those are left out of the budget (8 covers <|startofprev|> and the
 * start-of-transcript sequence).
 */
export function whisperMaxNewTokens(samples: number, sampleRate = 16000, promptTokens = 0): number {
  const seconds = Number.isFinite(samples) && samples > 0 ? samples / sampleRate : 0;
  return Math.max(1, Math.min(448 - 8 - promptTokens, 32 + Math.ceil(seconds * 40)));
}
