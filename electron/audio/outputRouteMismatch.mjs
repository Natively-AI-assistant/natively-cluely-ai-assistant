// Windows: the meeting is playing on an output device the system-audio loopback
// is not bound to.
//
// WASAPI loopback captures ONE render endpoint. Teams/Zoom/Discord play on the
// eCommunications default by default, and any meeting app can be pointed at a
// specific device in its own settings; when that differs from the endpoint we
// loop back, the interviewer's audio never reaches us and the capture looks
// exactly like a quiet meeting. Granola handles the same case by watching
// per-session peaks and re-targeting. Here main.ts polls each endpoint's output
// peak (getOutputDevicePeaks) once a second and feeds it to this detector.
//
// Evidence required before acting — this is what keeps a quiet meeting, a
// notification sound or a short clip on another device from moving the capture:
//   - the captured endpoint itself is not playing (if it is, the fault is not
//     routing), AND
//   - one other endpoint was playing in at least HITS_REQUIRED of the last
//     WINDOW_MS of observations, AND
//   - our captured stream has carried no real signal for long enough:
//       QUIET_MS if it has NEVER carried signal — the meeting was on another
//         device from the start, the case this exists for;
//       QUIET_AFTER_SIGNAL_MS if it has — it was demonstrably the right device,
//         and an interviewer is routinely silent for longer than QUIET_MS while
//         the candidate answers, so a ringtone or a clip elsewhere in that gap
//         must not move it.
//
// What it does with that evidence:
//   - 'switch' only when the capture has never carried signal, the user has
//     not picked an output device, and the playing endpoint is one of Windows'
//     role defaults (console or communications) — the documented VoIP case;
//     main.ts re-targets the capture.
//   - 'warn' otherwise (an explicit Settings choice is honored, a non-default
//     device is too ambiguous to follow silently, and a capture that has worked
//     is not moved on circumstantial evidence); main.ts shows a banner naming
//     both devices.
// A 'switch' to a device is not repeated for SWITCH_COOLDOWN_MS (no ping-pong);
// a 'warn' for a device is shown once per meeting.

export const MIN_PEAK = 0.02; // ≈ -34 dBFS: speech or music, not meter noise
export const QUIET_MS = 6_000;
export const QUIET_AFTER_SIGNAL_MS = 30_000;
export const WINDOW_MS = 5_000;
export const HITS_REQUIRED = 3;
export const SWITCH_COOLDOWN_MS = 60_000;

export class OutputRouteMismatchDetector {
  constructor() {
    this.reset();
  }

  reset() {
    /** @type {Map<string, number[]>} device id -> times it was seen playing */
    this.hits = new Map();
    /** @type {Map<string, number>} device id -> last 'switch' time */
    this.switchedAt = new Map();
    /** @type {Set<string>} devices already warned about this meeting */
    this.warned = new Set();
  }

  /**
   * @param {{
   *   nowMs: number,
   *   quietSinceMs: number,     // 0 = unknown (no chunk yet) — never acts
   *   heardSignal: boolean,     // this capture has carried real signal at least once
   *   capturedId: string,
   *   explicit: boolean,        // the user picked an output device in Settings
   *   defaultId: string,        // eConsole default render endpoint
   *   commsId: string,          // eCommunications default render endpoint
   *   peaks: { id: string, peak: number }[],
   * }} s
   * @returns {{ type: 'none' } | { type: 'switch' | 'warn', deviceId: string }}
   */
  observe(s) {
    const none = { type: 'none' };
    const since = s.nowMs - WINDOW_MS;
    for (const p of s.peaks) {
      if (p.id === s.capturedId || !(p.peak >= MIN_PEAK)) continue;
      const times = (this.hits.get(p.id) ?? []).filter((t) => t > since);
      times.push(s.nowMs);
      this.hits.set(p.id, times);
    }

    const quietNeeded = s.heardSignal ? QUIET_AFTER_SIGNAL_MS : QUIET_MS;
    const quiet = s.quietSinceMs > 0 && s.nowMs - s.quietSinceMs >= quietNeeded;
    const capturedPlaying = (s.peaks.find((p) => p.id === s.capturedId)?.peak ?? 0) >= MIN_PEAK;
    if (!quiet || !s.capturedId || capturedPlaying) return none;

    let best = null;
    for (const [id, times] of this.hits) {
      const recent = times.filter((t) => t > since).length;
      if (recent >= HITS_REQUIRED && (!best || recent > best.recent)) best = { id, recent };
    }
    if (!best) return none;

    const roleDefault = best.id === s.defaultId || best.id === s.commsId;
    if (!s.heardSignal && !s.explicit && roleDefault) {
      const last = this.switchedAt.get(best.id);
      if (last !== undefined && s.nowMs - last < SWITCH_COOLDOWN_MS) return none;
      this.switchedAt.set(best.id, s.nowMs);
      this.hits.delete(best.id);
      return { type: 'switch', deviceId: best.id };
    }
    if (this.warned.has(best.id)) return none;
    this.warned.add(best.id);
    return { type: 'warn', deviceId: best.id };
  }
}
