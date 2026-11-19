/**
 * Energy-based Voice Activity Detection (VAD) at 16 kHz.
 *
 * Uses 30ms windows (480 samples), an RMS threshold that follows the noise
 * floor (see thresholdFor), 600ms hangover (20 frames; 1.2s for a phrase
 * under 1.5s), 120ms min speech
 * duration (4 frames), 300ms pre-roll and 15000ms max segment duration
 * (force-flush). The hangover is wall time: the native gate's keepalive zero
 * frames count for the time they stand for (see KEEPALIVE_CREDIT_MAX_MS).
 */

export interface SpeechSegment {
  samples: Float32Array;
  durationMs: number;
}

const WINDOW_SIZE = 480;       // 30ms at 16kHz
// The threshold is 3x the quietest window of the last ~2 s (minimum
// statistics: speech always has gaps between syllables, so the minimum is the
// room, not the talker), clamped to [MIN, MAX]. A fixed 0.008 (-42 dBFS) cut a
// quiet mic or a low call volume into sub-second fragments, and Whisper fills
// those with invented words (2026-11-18: JFK clip at -30 dB came back as "I know
// my fellow men. your country."). MAX keeps a noisy room exactly as strict as
// before; the native gate has already dropped the silence (keepalive zeros).
const RMS_THRESHOLD_MIN = 0.002;
const RMS_THRESHOLD_MAX = 0.008;
const NOISE_FLOOR_FRAMES = 67; // ~2 s
// Windows kept from before speech opens. Soft consonants and the rise of the
// first syllable sit under the threshold, and dropping them clipped first words.
const PRE_ROLL_FRAMES = 10;    // ~300ms
// ~600ms. 300ms split a sentence at every natural pause, and a lone word
// ("not") came back as another ("Knock!"). Measured 2026-11-18, Whisper Base
// EN, JFK clip at -30 dB: 4.5% WER at 300ms, 0% at 600ms. The hangover is meant
// in wall time, but once the native gate closes it sends a 20ms zero frame per
// 100ms: counted as audio, 600ms would take ~3 s (and a short phrase's extra
// hangover another ~3 s, ~4 s from the end of speech to the final). push()
// therefore credits the wall time those keepalives stand for (see
// KEEPALIVE_CREDIT_MAX_MS).
const HANGOVER_FRAMES = 20;
const FRAME_MS = 30;
// The most wall time one all-zero push can stand for: a keepalive is 100ms apart,
// so 250ms keeps a stalled event loop or a device that hands over a burst of
// zeros late from closing a segment on time that was never silent.
const KEEPALIVE_CREDIT_MAX_MS = 250;
const SAMPLES_PER_MS = 16;
// A phrase with under ~1.5 s of voiced audio gets one more hangover before it
// closes. Cut off alone, a two-word lead-in has no context and the model
// guesses: quiet JFK's "Ask not." came back "As not." while the same worker
// given the whole clip got it right (Moonshine Tiny, 2026-11-18).
const SHORT_PHRASE_FRAMES = 50;
const MIN_SPEECH_FRAMES = 4;   // ~120ms minimum to avoid transcribing tiny noise bursts
const MAX_SPEECH_MS = 15000;

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (end - start));
}

function isAllZero(samples: Float32Array): boolean {
  for (let i = 0; i < samples.length; i++) if (samples[i] !== 0) return false;
  return true;
}

export function thresholdFor(noiseFloor: number): number {
  return Math.min(RMS_THRESHOLD_MAX, Math.max(RMS_THRESHOLD_MIN, noiseFloor * 3));
}

export class VadProcessor {
  private buffer: Float32Array[] = [];
  private speechBuffer: Float32Array[] = [];
  private hangoverCount = 0;
  private inSpeech = false;
  private speechFrameCount = 0;
  private speechDurationMs = 0;
  // Monotonic counter incremented every time a new speech segment opens.
  // Allows callers to detect segment transitions even when push() opens-and-
  // closes (or closes-and-reopens) within a single buffer — boolean
  // edge-detection on isInSpeech() can miss those cases.
  private segmentIdCounter = 0;
  private recentLevels: number[] = [];
  private preRoll: Float32Array[] = [];
  private shortPhraseExtended = false;
  // Wall time of the previous push, and wall time the native gate swallowed
  // that is still owed to the hangover (see KEEPALIVE_CREDIT_MAX_MS).
  private lastPushAt: number | null = null;
  private owedMs = 0;

  /** `now` is the wall clock in ms; injectable so tests can drive keepalive timing. */
  constructor(private readonly now: () => number = () => performance.now()) {}

  push(samples: Float32Array): SpeechSegment[] {
    const segments: SpeechSegment[] = [];
    const pushedAt = this.now();
    const wallGapMs = this.lastPushAt === null ? 0 : pushedAt - this.lastPushAt;
    this.lastPushAt = pushedAt;

    // Prepend any sub-window remainder carried from the previous call
    let input = samples;
    if (this.buffer.length > 0) {
      const totalLen = this.buffer.reduce((acc, f) => acc + f.length, 0) + samples.length;
      const merged = new Float32Array(totalLen);
      let pos = 0;
      for (const f of this.buffer) { merged.set(f, pos); pos += f.length; }
      merged.set(samples, pos);
      input = merged;
      this.buffer = [];
    }

    // Process in WINDOW_SIZE chunks
    let offset = 0;
    while (offset + WINDOW_SIZE <= input.length) {
      const window = input.subarray(offset, offset + WINDOW_SIZE);
      offset += WINDOW_SIZE;

      const energy = rms(window, 0, window.length);
      this.recentLevels.push(energy);
      if (this.recentLevels.length > NOISE_FLOOR_FRAMES) this.recentLevels.shift();
      const isSpeech = energy >= thresholdFor(Math.min(...this.recentLevels));

      if (isSpeech) {
        this.hangoverCount = HANGOVER_FRAMES;
        this.shortPhraseExtended = false;
        this.owedMs = 0;
        if (!this.inSpeech) {
          this.inSpeech = true;
          this.speechFrameCount = 0;
          this.speechBuffer = this.preRoll;
          this.speechDurationMs = this.preRoll.length * 30;
          this.preRoll = [];
          this.segmentIdCounter++;
        }
      } else if (!this.inSpeech) {
        this.preRoll.push(window.slice());
        if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
      }

      if (this.inSpeech) {
        this.speechBuffer.push(window.slice());
        this.speechDurationMs += 30;

        // Only voiced frames count toward MIN_SPEECH_FRAMES. Counting the
        // hangover too made every closed segment at least 11 frames long, so
        // the minimum never rejected a noise burst.
        if (isSpeech) {
          this.speechFrameCount++;
        } else {
          this.hangoverCount--;
        }

        // Force-flush on max duration
        if (this.speechDurationMs >= MAX_SPEECH_MS) {
          const seg = this.buildSegment();
          if (seg) segments.push(seg);
          this.resetSpeech();
        } else if (this.hangoverCount <= 0) {
          this.endOfSpeech(segments);
        }
      }
    }

    // All zeros is the native gate's keepalive: 20ms of audio standing for the
    // ~100ms since the last one. Count the rest of that time toward the
    // hangover. Real audio (even digital silence at real-time pace) has no gap
    // between its length and the wall clock, so it earns nothing.
    if (this.inSpeech && samples.length > 0 && isAllZero(samples)) {
      const missingMs = wallGapMs - samples.length / SAMPLES_PER_MS;
      this.owedMs += Math.min(KEEPALIVE_CREDIT_MAX_MS, Math.max(0, missingMs));
      while (this.inSpeech && this.owedMs >= FRAME_MS) {
        this.owedMs -= FRAME_MS;
        if (--this.hangoverCount <= 0) this.endOfSpeech(segments);
      }
    }

    // Remainder goes into the carry buffer for next call
    if (offset < input.length) {
      this.buffer.push(input.subarray(offset).slice());
    }

    return segments;
  }

  /**
   * Returns the audio accumulated in the currently-open speech segment
   * WITHOUT closing it. Used by the streaming inference loop to run
   * partial Whisper passes while the user is still speaking.
   * Returns null when no segment is open or the buffer is empty.
   *
   * IMPORTANT: the returned `samples` Float32Array is freshly allocated
   * and OWNED by the caller — they may transfer / mutate it freely. (No
   * caching today; if a cache is reintroduced, callers must `.slice()`
   * before any postMessage transfer to avoid detaching the cached buffer.)
   */
  peekOpenSegment(): { samples: Float32Array; durationMs: number } | null {
    if (!this.inSpeech || this.speechBuffer.length === 0) return null;
    const totalLen = this.speechBuffer.reduce((acc, f) => acc + f.length, 0);
    if (totalLen === 0) return null;
    const combined = new Float32Array(totalLen);
    let pos = 0;
    for (const frame of this.speechBuffer) {
      combined.set(frame, pos);
      pos += frame.length;
    }
    return { samples: combined, durationMs: this.speechDurationMs };
  }

  /**
   * Soft-commit: emits the currently-open segment as a closed segment AND
   * carries the last ~SOFT_COMMIT_TAIL_FRAMES (300ms) of audio forward so
   * the next segment has acoustic context across the cut. Without the tail
   * keep, Whisper's first words on the post-commit segment frequently miss
   * because there's no audio overlap and no decoder conditioning.
   */
  softCommit(): SpeechSegment | null {
    if (!this.inSpeech) return null;
    const seg = this.buildSegment();

    // Carry forward up to ~300ms of trailing audio (10 frames) into a fresh
    // open segment so the post-commit transcript starts with continuity.
    const TAIL_FRAMES = Math.min(10, this.speechBuffer.length);
    const tail = TAIL_FRAMES > 0 ? this.speechBuffer.slice(-TAIL_FRAMES) : [];

    this.resetSpeech();

    if (tail.length > 0) {
      this.inSpeech = true;
      this.speechBuffer = tail;
      // The tail comes from a segment that already passed the minimum, so it
      // counts in full: a short word right after the cut is still sent.
      this.speechFrameCount = tail.length;
      this.speechDurationMs = tail.length * 30;
      this.hangoverCount = HANGOVER_FRAMES;
      // Tail-keep starts a NEW logical segment (caller should re-stamp any
      // per-segment timers) — bump the id so callers detect the boundary.
      this.segmentIdCounter++;
    }
    return seg;
  }

  isInSpeech(): boolean {
    return this.inSpeech;
  }

  /**
   * Monotonic id of the currently-open speech segment. Increments each time
   * a new segment opens. Stable while a segment is open; equals the most
   * recent open's id immediately after that segment closes (until the next
   * one opens). Use this to detect "the open segment is no longer the same
   * one we were tracking" without relying on isInSpeech() boolean edges.
   */
  currentSegmentId(): number {
    return this.segmentIdCounter;
  }

  flush(): SpeechSegment[] {
    const segments: SpeechSegment[] = [];
    if (this.inSpeech && this.speechFrameCount >= MIN_SPEECH_FRAMES) {
      const seg = this.buildSegment();
      if (seg) segments.push(seg);
    }
    this.resetSpeech();
    this.buffer = [];
    this.preRoll = [];
    return segments;
  }

  reset(): void {
    this.resetSpeech();
    this.buffer = [];
    this.preRoll = [];
    this.recentLevels = [];
    this.lastPushAt = null;
  }

  // The hangover has run out: give a short phrase its one extension, else close.
  private endOfSpeech(segments: SpeechSegment[]): void {
    if (this.speechFrameCount >= MIN_SPEECH_FRAMES
      && this.speechFrameCount < SHORT_PHRASE_FRAMES && !this.shortPhraseExtended) {
      this.hangoverCount = HANGOVER_FRAMES;
      this.shortPhraseExtended = true;
      return;
    }
    if (this.speechFrameCount >= MIN_SPEECH_FRAMES) {
      const seg = this.buildSegment();
      if (seg) segments.push(seg);
    }
    this.resetSpeech();
  }

  private buildSegment(): SpeechSegment | null {
    if (this.speechBuffer.length === 0) return null;
    const totalLen = this.speechBuffer.reduce((acc, f) => acc + f.length, 0);
    const combined = new Float32Array(totalLen);
    let pos = 0;
    for (const frame of this.speechBuffer) {
      combined.set(frame, pos);
      pos += frame.length;
    }
    return { samples: combined, durationMs: this.speechDurationMs };
  }

  private resetSpeech(): void {
    this.inSpeech = false;
    this.hangoverCount = 0;
    this.shortPhraseExtended = false;
    this.owedMs = 0;
    this.speechFrameCount = 0;
    this.speechDurationMs = 0;
    this.speechBuffer = [];
  }
}
