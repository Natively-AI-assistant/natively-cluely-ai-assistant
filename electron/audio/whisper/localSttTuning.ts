/**
 * Per-platform tuning for the local STT pipeline: the VAD's thresholds and
 * hangover, and the Whisper worker's low-confidence floor.
 *
 * Windows has the values PR #764 tuned against the live Windows pipeline
 * (2026-11-18). macOS keeps the values it shipped with before that PR: the PR's
 * numbers were never tuned or measured on a Mac, and a live run on macOS
 * (2026-11-19, Whisper Base EN, real worker, the native gate's frame pattern
 * emulated) showed two costs there:
 *   - the one-word answers "Yes", "No", "Yeah" and "Okay" were recognised
 *     correctly and then dropped by the -4 floor (mean log-probability -4.5 to
 *     -7.6);
 *   - a phrase under 1.5 s of voiced audio reached its final 4.4-4.6 s after
 *     the last word (0.7-0.8 s before), because the 600 ms hangover and its
 *     extension are counted in audio time while the native gate sends one 20 ms
 *     zero frame per 100 ms once it closes.
 * macOS can move to the Windows values once they are re-tuned on a Mac.
 *
 * The platform is an argument so both branches are testable from either OS; an
 * unsupported platform throws rather than borrowing another platform's numbers.
 */
import { LOGPROB_FLOOR } from './whisperSilenceGuard';

export type VadThreshold =
  /** One fixed RMS gate. */
  | { kind: 'fixed'; rms: number }
  /**
   * `multiplier` x the quietest window of the last `frames` windows (minimum
   * statistics: speech has gaps between syllables, so the minimum is the room,
   * not the talker), clamped to [min, max].
   */
  | { kind: 'noise-floor'; min: number; max: number; frames: number; multiplier: number };

export interface VadTuning {
  threshold: VadThreshold;
  /** Silent 30 ms windows that close a segment. */
  hangoverFrames: number;
  /**
   * A phrase with fewer voiced windows than this gets the hangover once more
   * before it closes. null: no extension.
   */
  shortPhraseFrames: number | null;
  /** Windows kept from before speech opens. 0: none. */
  preRollFrames: number;
}

export interface LocalSttTuning {
  vad: VadTuning;
  /**
   * Mean log-probability per token below which a Whisper final is dropped as
   * invented text. null: no floor (the log-probability is not even computed).
   */
  logprobFloor: number | null;
}

/** What macOS shipped with before PR #764 (electron/audio/whisper/vadProcessor.ts on main). */
export const DARWIN_TUNING: LocalSttTuning = {
  vad: {
    threshold: { kind: 'fixed', rms: 0.008 },
    hangoverFrames: 10, // ~300 ms
    shortPhraseFrames: null,
    preRollFrames: 0,
  },
  logprobFloor: null,
};

/**
 * PR #764, tuned on Windows.
 *  - The threshold follows the noise floor. A fixed 0.008 (-42 dBFS) cut a quiet
 *    mic or a low call volume into sub-second fragments, and Whisper fills those
 *    with invented words (JFK clip at -30 dB came back as "I know my fellow men.
 *    your country."). The maximum keeps a noisy room exactly as strict as
 *    before; the native gate has already dropped the silence (keepalive zeros).
 *  - Pre-roll: soft consonants and the rise of the first syllable sit under the
 *    threshold, and dropping them clipped first words.
 *  - Hangover ~600 ms: 300 ms split a sentence at every natural pause, and a
 *    lone word ("not") came back as another ("Knock!"). Whisper Base EN, JFK
 *    clip at -30 dB: 4.5% WER at 300 ms, 0% at 600 ms.
 *  - A phrase with under ~1.5 s of voiced audio gets one more hangover. Cut off
 *    alone, a two-word lead-in has no context and the model guesses: quiet JFK's
 *    "Ask not." came back "As not." while the same worker given the whole clip
 *    got it right (Moonshine Tiny).
 *  - The log-probability floor sits between real speech (-0.22 to -2.55 on
 *    Distil Small EN) and the invented words (-4.76 to -10.36); see
 *    whisperSilenceGuard.ts.
 */
export const WIN32_TUNING: LocalSttTuning = {
  vad: {
    threshold: { kind: 'noise-floor', min: 0.002, max: 0.008, frames: 67 /* ~2 s */, multiplier: 3 },
    hangoverFrames: 20, // ~600 ms
    shortPhraseFrames: 50, // ~1.5 s
    preRollFrames: 10, // ~300 ms
  },
  logprobFloor: LOGPROB_FLOOR,
};

export function localSttTuningFor(platform: NodeJS.Platform): LocalSttTuning {
  switch (platform) {
    case 'darwin':
      return DARWIN_TUNING;
    case 'win32':
      return WIN32_TUNING;
    default:
      throw new Error(`Local STT tuning: unsupported platform ${platform}`);
  }
}
