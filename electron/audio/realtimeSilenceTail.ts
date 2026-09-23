/**
 * RealtimeSilenceTail — keep a streaming STT socket's audio clock in step with
 * the wall clock for a bounded window after the local VAD says speech ended.
 *
 * WHY (2026-09-23). The native DSP (native-module/src/silence_suppression.rs)
 * streams full frames while speech is live and for a hangover after it (600 ms
 * system audio, 500 ms microphone), then drops to ONE 20 ms zero frame per
 * 100 ms keepalive (`FrameAction::SendSilence`, lib.rs). From that point the
 * provider receives 20 ms of audio per 100 ms of real time: its audio clock
 * runs at 1/5 speed.
 *
 * Every server-side endpointer counts silence in AUDIO time. Any silence window
 * longer than the hangover therefore stretches ~5× in real time:
 *   - OpenAI server_vad silence_duration_ms 1000 → final ~3 s after speech end
 *   - Soniox max_endpoint_delay_ms (default 2000) → up to ~7.5 s
 *   - Deepgram UtteranceEnd 1000 ms → ~2.6 s
 *   - Riva's default endpointing → same shape
 * The suppression exists to save bandwidth and per-second billing during long
 * silences, and that is still right. What is wrong is starving the endpointer
 * during the one second that decides when the transcript becomes final.
 *
 * WHAT. After `start()` (wired to the provider's notifySpeechEnded), a timer
 * tops the stream up with zero PCM so that audio delivered since the speech
 * end tracks elapsed wall time, until `tailMs` of audio has been delivered.
 * It only fills the DEFICIT: every chunk the provider receives is reported
 * through `observe()` and counted, so the stream becomes contiguous and
 * real-time, exactly as if suppression were off for that window. The first
 * non-silent chunk (speech resumed, or noise above the gate) ends the window —
 * from there the native side is streaming real time again on its own.
 * `lagAllowanceMs` keeps normal delivery jitter (the native side batches up to
 * 3 frames / 100 ms per callback) from ever being mistaken for a gap.
 *
 * Silence is all-zero PCM, byte-identical to the native keepalive frames the
 * provider already receives, so no provider sees a new kind of input. (Google
 * STT drops all-zero chunks on purpose — GoogleSTTDropsKeepaliveSilence — and
 * therefore gets no tail.)
 *
 * Platform: pure arithmetic over PCM byte counts, with injectable time and
 * timers — identical on darwin and win32. Both platforms' native DSP use the
 * same suppressor and keepalive cadence.
 */

export interface SilenceTailClock {
    now(): number;
    setInterval(fn: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

const systemClock: SilenceTailClock = {
    now: () => Date.now(),
    setInterval: (fn, ms) => {
        const h = setInterval(fn, ms);
        // Never keep the process alive for a silence top-up.
        (h as any)?.unref?.();
        return h;
    },
    clearInterval: (h) => clearInterval(h as any),
};

export interface RealtimeSilenceTailOptions {
    /** Real-time silence to guarantee after speech end, in ms. <= 0 disables. */
    tailMs: number;
    /** Current input format — read at every tick, so a mid-session rate change is honoured. */
    format: () => { sampleRate: number; channels: number };
    /** Where injected silence goes: the provider's own send path, NOT its public write(). */
    sink: (pcm: Buffer) => void;
    clock?: SilenceTailClock;
    /** Tick period. 40 ms keeps each injected block small. */
    tickMs?: number;
    /** Delivery lag tolerated before a gap is filled. */
    lagAllowanceMs?: number;
    /** How long after start() a non-silent chunk is still treated as the hangover's tail. */
    resumeGraceMs?: number;
}

function isAllZero(buf: Buffer): boolean {
    for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) return false;
    return true;
}

export class RealtimeSilenceTail {
    private readonly tailMs: number;
    private readonly format: RealtimeSilenceTailOptions['format'];
    private readonly sink: RealtimeSilenceTailOptions['sink'];
    private readonly clock: SilenceTailClock;
    private readonly tickMs: number;
    private readonly lagAllowanceMs: number;
    private readonly resumeGraceMs: number;

    private timer: unknown = null;
    private startedAt = 0;
    private deliveredBytes = 0;
    /** Bytes this tail injected in its current run (diagnostics and tests). */
    public injectedBytes = 0;

    constructor(opts: RealtimeSilenceTailOptions) {
        this.tailMs = Math.max(0, opts.tailMs);
        this.format = opts.format;
        this.sink = opts.sink;
        this.clock = opts.clock ?? systemClock;
        this.tickMs = opts.tickMs ?? 40;
        this.lagAllowanceMs = opts.lagAllowanceMs ?? 120;
        this.resumeGraceMs = opts.resumeGraceMs ?? 150;
    }

    get active(): boolean {
        return this.timer !== null;
    }

    /** Local VAD reported the end of speech. Restarts the window if one is running. */
    start(): void {
        if (this.tailMs <= 0) return;
        this.stopTimer();
        this.startedAt = this.clock.now();
        this.deliveredBytes = 0;
        this.injectedBytes = 0;
        this.timer = this.clock.setInterval(() => this.tick(), this.tickMs);
    }

    /**
     * Every chunk the capture hands the provider. Counts toward the window.
     *
     * A chunk that is not all-zero means the native gate reopened — speech
     * resumed, or noise crossed the gate — and real-time audio is flowing
     * again (with a fresh hangover and, later, a fresh speech end that
     * restarts this window). The tail stops there: topping up past that point
     * would slip zeros BETWEEN real speech frames. Chunks inside the first
     * `resumeGraceMs` still count but never stop it: the native side batches up
     * to 100 ms per callback and its speech-end edge travels on a separate
     * callback, so the last hangover batch can land just after start().
     */
    observe(chunk: Buffer): void {
        if (this.timer === null) return;
        this.deliveredBytes += chunk.length;
        if (this.clock.now() - this.startedAt > this.resumeGraceMs && !isAllZero(chunk)) {
            this.stopTimer();
        }
    }

    /** Provider stopping, reconnecting or force-finalizing: drop the window. */
    cancel(): void {
        this.stopTimer();
    }

    private stopTimer(): void {
        if (this.timer !== null) {
            this.clock.clearInterval(this.timer);
            this.timer = null;
        }
    }

    private tick(): void {
        const { sampleRate, channels } = this.format();
        const frameBytes = 2 * Math.max(1, channels | 0);
        const bytesPerMs = (sampleRate * frameBytes) / 1000;
        if (!(bytesPerMs > 0)) { this.stopTimer(); return; }

        const elapsed = this.clock.now() - this.startedAt;
        const dueMs = Math.min(elapsed - this.lagAllowanceMs, this.tailMs);
        const dueBytes = Math.floor((dueMs * bytesPerMs) / frameBytes) * frameBytes;
        const deficit = dueBytes - this.deliveredBytes;
        if (deficit >= frameBytes) {
            this.deliveredBytes += deficit;
            this.injectedBytes += deficit;
            try { this.sink(Buffer.alloc(deficit)); } catch { /* the provider's send path owns its own errors */ }
        }
        const tailBytes = Math.floor((this.tailMs * bytesPerMs) / frameBytes) * frameBytes;
        if (this.deliveredBytes >= tailBytes || elapsed >= this.tailMs + this.lagAllowanceMs + this.tickMs) {
            this.stopTimer();
        }
    }
}
