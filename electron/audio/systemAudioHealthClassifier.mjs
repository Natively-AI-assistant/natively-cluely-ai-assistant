const DEFAULT_WATCHDOG_MS = 12_000;
const DEFAULT_ZERO_OBSERVATION_MS = 12_000;
const DEFAULT_MEANINGFUL_PEAK_TO_PEAK = 100;
const DEFAULT_INTER_CHUNK_GAP_LOG_MS = 2_000;

/**
 * How many above-threshold chunks are required before we conclude the capture
 * is carrying real audio.
 *
 * This is NOT redundant with the amplitude threshold. `hasMeaningfulSignal` is
 * a one-way latch (cleared only by `reset()` on capture-started), so whatever
 * sets it disables silence reporting for the rest of the capture. A single
 * chunk is too weak a basis for that: one driver glitch, a DC step on device
 * switch, or a click from a dead-but-not-silent mic would permanently suppress
 * the "this capture is producing nothing" diagnostic.
 *
 * Counted cumulatively rather than consecutively on purpose — real speech is
 * intermittent, and requiring a run would make quiet or gappy input fail to
 * latch. At 50 chunks/sec any genuine audio clears 3 almost immediately, while
 * an isolated transient never does.
 */
const DEFAULT_MEANINGFUL_CHUNK_COUNT = 3;

/**
 * Peak-to-peak (max - min) amplitude of an int16 little-endian PCM chunk.
 *
 * Peak-to-peak rather than abs-peak (B10): a muted-but-DC-biased mic reads
 * abs-peak 10..50 while carrying no signal, which false-latched the detector
 * and permanently disabled it. (max - min) is DC-offset invariant.
 *
 * EVERY sample is scanned. A previous version strided through ~32 points per
 * chunk, which aliased: any tone whose period divides the stride lands on an
 * identical phase every time and measures 0 despite full amplitude. Captures
 * emit 20ms at the emitted rate (native lib.rs: `chunk_size = emitted_rate/1000
 * * 20`), i.e. 320 samples / 640 bytes at 16kHz, so the stride was 10 samples
 * and 1600/3200/8000 Hz all read as silence; batched chunks stride wider and
 * alias at more frequencies still (533/1067/1600/2667/3200/5333/8000 Hz at
 * 1920 bytes). It aliased identically on every chunk, so the observation
 * window never cleared, and on the mic path that surfaced a false "TCC denial
 * or device-mute suspected" banner.
 *
 * The full scan costs ~2us per 1920-byte chunk, i.e. well under 1ms per second
 * of audio across both capture streams. `readInt16LE` is used rather than an
 * Int16Array view so the result never depends on host endianness or on the
 * Buffer's byteOffset alignment.
 */
function peakToPeakInt16LE(chunk) {
  if (!Buffer.isBuffer(chunk) || chunk.length < 2) return 0;

  let min = 32767;
  let max = -32768;
  for (let i = 0; i + 1 < chunk.length; i += 2) {
    const sample = chunk.readInt16LE(i);
    if (sample < min) min = sample;
    if (sample > max) max = sample;
  }
  return max - min;
}

export class SystemAudioHealthClassifier {
  static supportedEventKinds = Object.freeze([
    'capture-started',
    'capture-stopped',
    'chunk',
    'watchdog-tick',
    'same-device-route-detected',
  ]);

  constructor(options = {}) {
    this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
    this.zeroObservationMs = options.zeroObservationMs ?? DEFAULT_ZERO_OBSERVATION_MS;
    this.meaningfulPeakToPeak = options.meaningfulPeakToPeak ?? DEFAULT_MEANINGFUL_PEAK_TO_PEAK;
    this.meaningfulChunkCount = options.meaningfulChunkCount ?? DEFAULT_MEANINGFUL_CHUNK_COUNT;
    this.interChunkGapLogMs = options.interChunkGapLogMs ?? DEFAULT_INTER_CHUNK_GAP_LOG_MS;
    this.reset();
  }

  reset() {
    this.startedAtMs = null;
    this.stopped = false;
    this.chunkCount = 0;
    this.firstChunkAtMs = null;
    this.lastChunkAtMs = null;
    this.loudChunkCount = 0;
    this.hasMeaningfulSignal = false;
    this.sameDeviceWarningEmitted = false;
    this.noChunkLogEmitted = false;
    this.zeroValuedLogEmitted = false;
  }

  handle(event) {
    switch (event.kind) {
      case 'capture-started':
        this.reset();
        this.startedAtMs = event.nowMs;
        return { type: 'none' };
      case 'capture-stopped':
        this.stopped = true;
        return { type: 'none' };
      case 'same-device-route-detected':
        return this.handleSameDeviceRoute(event);
      case 'watchdog-tick':
        return this.handleWatchdogTick(event);
      case 'chunk':
        return this.handleChunk(event);
      default:
        return { type: 'none' };
    }
  }

  handleSameDeviceRoute(event) {
    if (this.sameDeviceWarningEmitted) return { type: 'none' };
    this.sameDeviceWarningEmitted = true;
    return {
      type: 'warn-user',
      reason: 'same-device-input-output',
      device: event.device,
      terminal: false,
      stuck: true,
    };
  }

  handleWatchdogTick(event) {
    if (this.stopped || this.chunkCount > 0 || this.noChunkLogEmitted) return { type: 'none' };
    const startedAtMs = this.startedAtMs ?? event.nowMs;
    if (event.nowMs - startedAtMs < this.watchdogMs) return { type: 'none' };

    this.noChunkLogEmitted = true;
    return {
      type: 'log',
      level: 'warn',
      reason: 'initial-silence-no-chunks',
      message: `SystemAudioCapture produced 0 chunks in ${Math.round(this.watchdogMs / 1000)}s — treating as initial silence unless another capture health signal fails.`,
    };
  }

  handleChunk(event) {
    if (this.stopped) return { type: 'none' };

    const previousChunkAtMs = this.lastChunkAtMs;
    this.chunkCount++;
    if (this.firstChunkAtMs == null) this.firstChunkAtMs = event.nowMs;
    this.lastChunkAtMs = event.nowMs;

    const peakToPeak = peakToPeakInt16LE(event.chunk);
    if (peakToPeak > this.meaningfulPeakToPeak) {
      this.loudChunkCount++;
      // Only latch once enough chunks agree — see DEFAULT_MEANINGFUL_CHUNK_COUNT.
      // A chunk that is loud but has not yet reached the count still returns
      // here rather than falling through to the silence check: it is evidence
      // against silence even before it is enough to settle the question.
      if (this.loudChunkCount >= this.meaningfulChunkCount) this.hasMeaningfulSignal = true;
      return this.maybeInterChunkGapLog(previousChunkAtMs, event.nowMs);
    }

    const zeroObservationStartMs = this.firstChunkAtMs ?? event.nowMs;
    if (!this.hasMeaningfulSignal && !this.zeroValuedLogEmitted && event.nowMs - zeroObservationStartMs >= this.zeroObservationMs) {
      this.zeroValuedLogEmitted = true;
      return {
        type: 'log',
        level: 'warn',
        reason: 'sustained-zero-valued-silence',
        message: `SystemAudio chunks stayed zero-valued (peak-to-peak <= ${this.meaningfulPeakToPeak}) for ${Math.round(this.zeroObservationMs / 1000)}s — treating as silence unless another capture health signal fails.`,
      };
    }

    return this.maybeInterChunkGapLog(previousChunkAtMs, event.nowMs);
  }

  maybeInterChunkGapLog(previousChunkAtMs, nowMs) {
    if (previousChunkAtMs == null) return { type: 'none' };
    const gapMs = nowMs - previousChunkAtMs;
    if (gapMs <= this.interChunkGapLogMs) return { type: 'none' };
    return {
      type: 'log',
      level: 'warn',
      reason: 'inter-chunk-gap',
      gapMs,
      message: `SystemAudio chunk gap ${gapMs}ms — likely transient route change. Resuming.`,
    };
  }
}

export { peakToPeakInt16LE };
