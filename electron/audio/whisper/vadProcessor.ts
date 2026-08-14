/**
 * Energy-based Voice Activity Detection (VAD) at 16 kHz.
 *
 * Uses 30ms windows (480 samples), RMS threshold 0.008,
 * 700ms hangover (~23 frames), 250ms min speech duration (~8 frames),
 * and 15000ms max segment duration (force-flush).
 */

export interface SpeechSegment {
  samples: Float32Array;
  durationMs: number;
}

const WINDOW_SIZE = 480;       // 30ms at 16kHz
const RMS_THRESHOLD = 0.008;
const HANGOVER_FRAMES = 10;    // ~300ms — must be shorter than Rust SilenceSuppressor hangover (500ms)
const MIN_SPEECH_FRAMES = 4;   // ~120ms minimum to avoid transcribing tiny noise bursts
const MAX_SPEECH_MS = 15000;

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (end - start));
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

  push(samples: Float32Array): SpeechSegment[] {
    const segments: SpeechSegment[] = [];

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
      const isSpeech = energy >= RMS_THRESHOLD;

      if (isSpeech) {
        this.hangoverCount = HANGOVER_FRAMES;
        if (!this.inSpeech) {
          this.inSpeech = true;
          this.speechFrameCount = 0;
          this.speechDurationMs = 0;
          this.speechBuffer = [];
          this.segmentIdCounter++;
        }
      }

      if (this.inSpeech) {
        this.speechBuffer.push(window.slice());
        this.speechFrameCount++;
        this.speechDurationMs += 30;

        if (!isSpeech) {
          this.hangoverCount--;
        }

        // Force-flush on max duration
        if (this.speechDurationMs >= MAX_SPEECH_MS) {
          const seg = this.buildSegment();
          if (seg) segments.push(seg);
          this.resetSpeech();
        } else if (this.hangoverCount <= 0) {
          // End of speech
          if (this.speechFrameCount >= MIN_SPEECH_FRAMES) {
            const seg = this.buildSegment();
            if (seg) segments.push(seg);
          }
          this.resetSpeech();
        }
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
    return segments;
  }

  reset(): void {
    this.resetSpeech();
    this.buffer = [];
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
    this.speechFrameCount = 0;
    this.speechDurationMs = 0;
    this.speechBuffer = [];
  }
}
