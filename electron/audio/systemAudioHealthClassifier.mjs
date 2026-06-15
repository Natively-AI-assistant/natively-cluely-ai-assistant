const DEFAULT_WATCHDOG_MS = 12_000;
const DEFAULT_ZERO_OBSERVATION_MS = 12_000;
const DEFAULT_MEANINGFUL_PEAK_TO_PEAK = 100;
const DEFAULT_INTER_CHUNK_GAP_LOG_MS = 2_000;

function peakToPeakInt16LE(chunk) {
  if (!Buffer.isBuffer(chunk) || chunk.length < 2) return 0;

  let min = 32767;
  let max = -32768;
  const stride = Math.max(2, (chunk.length >> 5) & ~1);
  for (let i = 0; i + 1 < chunk.length; i += stride) {
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
    this.interChunkGapLogMs = options.interChunkGapLogMs ?? DEFAULT_INTER_CHUNK_GAP_LOG_MS;
    this.reset();
  }

  reset() {
    this.startedAtMs = null;
    this.stopped = false;
    this.chunkCount = 0;
    this.firstChunkAtMs = null;
    this.lastChunkAtMs = null;
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
      this.hasMeaningfulSignal = true;
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
