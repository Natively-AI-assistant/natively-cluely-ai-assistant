// electron/audio/captureRecoveryLatch.mjs
//
// When a capture warning stops being true (2026-11-09).
//
// The overlay's audio banner ("Microphone Is Silent", "No audio from your
// microphone for 12s", "System audio capture gave up…") was cleared only by its
// ✕, so a channel that came back on its own kept saying it was dead for the
// rest of the meeting. Main now tells the overlay when a channel that was
// reported as not being heard (a `stuck` or `terminal` warning) is carrying
// real audio again: chunks with signal (peak-to-peak above the zero-fill
// floor) over at least `spanMs`. Zero-filled or missing chunks never count, so
// the warnings that describe exactly that cannot be cleared by it.
//
// A warning whose cause is not "no audio" (a speech-to-text provider that
// would not start, meeting audio playing on another device) is sent with
// `clearsOnRecovery: false` and does not arm the latch: audio flowing proves
// nothing about it.
//
// Pure: main feeds it the warnings it sends and, per chunk, whether the chunk
// carried signal. Platform-neutral (the chunk test is the same int16 PCM check
// on macOS and Windows).

/** Real audio must keep arriving for this long before a channel counts as healthy. */
export const CAPTURE_RECOVERY_SPAN_MS = 3_000;

/**
 * Whether a warning payload, as main sends it on `audio-capture-failed`, says
 * the channel is not being heard (so real audio later clears it).
 * @param {{ terminal?: boolean, stuck?: boolean, clearsOnRecovery?: boolean, recovered?: boolean }} payload
 */
export function warningArmsRecovery(payload) {
  if (!payload || payload.recovered) return false;
  if (payload.clearsOnRecovery === false) return false;
  return !!(payload.terminal || payload.stuck);
}

export class CaptureRecoveryLatch {
  /** @param {{ spanMs?: number }} [opts] */
  constructor(opts = {}) {
    this.spanMs = opts.spanMs ?? CAPTURE_RECOVERY_SPAN_MS;
    /** @type {Record<string, { firstSignalAtMs: number | null }>} */
    this._armed = {};
  }

  /**
   * A warning main is about to send. Arms (or re-arms: the problem is current
   * again) its channel when it says the channel is not heard.
   * @returns {boolean} armed
   */
  noteWarning(payload) {
    if (!warningArmsRecovery(payload)) return false;
    const channel = payload.channel === 'mic' ? 'mic' : 'system';
    this._armed[channel] = { firstSignalAtMs: null };
    return true;
  }

  /** Cheap gate for the data path: only an armed channel needs its chunks measured. */
  isArmed(channel) {
    return !!this._armed[channel];
  }

  /**
   * One chunk on `channel`. Returns true exactly once, when an armed channel
   * has carried signal from one chunk to another at least `spanMs` later; the
   * channel is then disarmed. Quiet chunks in between (pauses in speech) do
   * not restart the span.
   */
  noteAudio(channel, nowMs, hasSignal) {
    const armed = this._armed[channel];
    if (!armed || !hasSignal) return false;
    if (armed.firstSignalAtMs === null) {
      armed.firstSignalAtMs = nowMs;
      return false;
    }
    if (nowMs - armed.firstSignalAtMs < this.spanMs) return false;
    delete this._armed[channel];
    return true;
  }

  /** The meeting ended: nothing is armed for the next one. */
  reset() {
    this._armed = {};
  }
}
