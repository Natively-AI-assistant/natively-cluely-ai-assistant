/**
 * Transcript gap recovery (2026-10-15).
 *
 * A streaming transcriber that drops or stalls leaves a hole in the meeting
 * transcript. Each provider keeps ~10 s of audio while its socket is down
 * (500 chunks of 20 ms) and flushes it on reconnect; anything older, and any
 * audio sent into a socket that died without saying so, was lost. This module
 * closes those holes, provider-agnostic, above capture:
 *
 *   1. A rolling ring buffer of the raw PCM per source (mic and system apart),
 *      capped at 120 s each. Audio is copied in on the capture path; nothing
 *      on that path waits.
 *   2. An outage opens when the provider reports a retryable error, or when
 *      the stall watchdog sees speech going in and nothing coming out for a
 *      while (it then asks main to reconnect that channel). It closes on the
 *      first transcript after it: the connection is back.
 *   3. Some seconds later (so the provider's own buffered flush has landed),
 *      the outage's audio is cut into speech clips and each clip goes to a
 *      recovery transcriber: a fresh instance of the same provider fed faster
 *      than real time, else another transcriber the user configured, else a
 *      local model. A user on local-only transcription never has audio sent
 *      to a cloud provider (planRecoveryTranscribers).
 *   4. A recovered line whose words the live transcript already has is
 *      dropped; the rest go back to main with their ORIGINAL time and the
 *      marker 'recovered', and are inserted in time order.
 *
 * Recovery runs one clip at a time, one outage at a time, after the live
 * path, so it never delays a live answer.
 *
 * Platform: capture on macOS (CoreAudio tap / ScreenCaptureKit) and Windows
 * (WASAPI) both end in the same native DSP (native-module/src/lib.rs), which
 * emits 16-bit little-endian mono PCM, normally at 16 kHz and at the native
 * rate when the resampler is unavailable. Every frame here carries its own
 * rate and a clip never spans two rates, so nothing assumes 16 kHz.
 */

export type SttSource = 'mic' | 'system';

export interface PcmFrame {
    pcm: Buffer;
    sampleRate: number;
    /** Wall time the frame's first sample was captured (arrival minus duration). */
    startMs: number;
    durMs: number;
    /** RMS of the int16 samples. */
    rms: number;
}

export interface SpeechClip {
    pcm: Buffer;
    sampleRate: number;
    startMs: number;
    endMs: number;
    speechMs: number;
}

export interface RecoveredSegment {
    source: SttSource;
    text: string;
    /** Original capture time of the clip's first audio. */
    timestamp: number;
    endTimestamp: number;
    marker: 'recovered';
    transcriberId: string;
    reason: OutageReason;
}

export type OutageReason = 'error' | 'stall';

export interface Outage {
    id: number;
    source: SttSource;
    reason: OutageReason;
    startMs: number;
    recoveredAtMs: number | null;
    /** Audio of this outage the ring had to drop (older than its cap). */
    droppedMs: number;
}

export const GAP_DEFAULTS = {
    /** Ring buffer per source. */
    capMs: 120_000,
    /** An error opens the outage this far back: audio already sent into a dying socket is lost too. */
    errorPrerollMs: 3_000,
    /** Stall: no transcript this long… */
    stallMs: 15_000,
    /** …while at least this much speech-level audio went in. */
    stallSpeechMs: 4_000,
    /** Repeated stalls with no transcript between them back off to this. */
    maxStallBackoffMs: 120_000,
    /** Frame RMS that counts as speech (the native VAD's start level, VAD_START_RMS). */
    speechRms: 185,
    /** Wait after recovery before transcribing, so the provider's own flush lands first. */
    settleMs: 8_000,
    /** Live finals kept for de-duplication. */
    liveFinalsKeepMs: 600_000,
} as const;

export type GapOptions = { -readonly [K in keyof typeof GAP_DEFAULTS]: number };

// ── PCM helpers ──────────────────────────────────────────────────────────

/** RMS of int16 LE samples, sampling every `stride`-th sample (cheap on the capture path). */
export function pcmRms(chunk: Buffer, stride: number = 4): number {
    const samples = chunk.length >> 1;
    if (samples === 0) return 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < samples; i += stride) {
        const s = chunk.readInt16LE(i << 1);
        sum += s * s;
        n++;
    }
    return Math.sqrt(sum / n);
}

/** Duration of int16 mono PCM at `sampleRate`. */
export function pcmDurationMs(bytes: number, sampleRate: number): number {
    return sampleRate > 0 ? ((bytes >> 1) / sampleRate) * 1000 : 0;
}

// ── Ring buffer ──────────────────────────────────────────────────────────

/** Audio of one source, newest last, at most `capMs` of it. */
export class PcmRingBuffer {
    private frames: PcmFrame[] = [];
    private head = 0;
    private totalMs = 0;

    constructor(readonly capMs: number) {}

    /** Adds a frame; returns the frames evicted to stay under the cap, oldest first. */
    push(frame: PcmFrame): PcmFrame[] {
        this.frames.push(frame);
        this.totalMs += frame.durMs;
        const evicted: PcmFrame[] = [];
        while (this.totalMs > this.capMs && this.head < this.frames.length - 1) {
            const old = this.frames[this.head++];
            this.totalMs -= old.durMs;
            evicted.push(old);
        }
        // Compact now and then rather than shifting on every push.
        if (this.head > 1024 && this.head * 2 > this.frames.length) {
            this.frames = this.frames.slice(this.head);
            this.head = 0;
        }
        return evicted;
    }

    /** Frames whose audio overlaps [fromMs, toMs], in order. */
    range(fromMs: number, toMs: number): PcmFrame[] {
        const out: PcmFrame[] = [];
        for (let i = this.head; i < this.frames.length; i++) {
            const f = this.frames[i];
            if (f.startMs + f.durMs <= fromMs) continue;
            if (f.startMs > toMs) break;
            out.push(f);
        }
        return out;
    }

    durationMs(): number { return this.totalMs; }
    size(): number { return this.frames.length - this.head; }
    oldestStartMs(): number | null { return this.size() ? this.frames[this.head].startMs : null; }

    clear(): void {
        this.frames = [];
        this.head = 0;
        this.totalMs = 0;
    }
}

// ── Speech clips ─────────────────────────────────────────────────────────

export interface ClipOptions {
    speechRms: number;
    /** A clip with less speech than this is noise, not worth a request. */
    minSpeechMs: number;
    /** Silence that ends a clip. */
    breakSilenceMs: number;
    /** No clip longer than this (Whisper-style models take 30 s windows). */
    maxClipMs: number;
    /** Quiet audio kept before and after the speech. */
    padMs: number;
    /** A gap between frames bigger than this ends a clip (capture restarted). */
    maxFrameGapMs: number;
}

export const CLIP_DEFAULTS: ClipOptions = {
    speechRms: GAP_DEFAULTS.speechRms,
    minSpeechMs: 400,
    breakSilenceMs: 800,
    maxClipMs: 25_000,
    padMs: 300,
    maxFrameGapMs: 500,
};

/** Cuts frames into speech clips: one rate per clip, silence and noise left out. */
export function splitIntoSpeechClips(frames: readonly PcmFrame[], opts: Partial<ClipOptions> = {}): SpeechClip[] {
    const o = { ...CLIP_DEFAULTS, ...opts };
    const clips: SpeechClip[] = [];
    let cur: { frames: PcmFrame[]; speechMs: number; silenceRunMs: number; lastEnd: number } | null = null;
    let pre: PcmFrame[] = [];

    const close = () => {
        if (!cur) return;
        // Trim trailing silence beyond the pad.
        let trailing = cur.silenceRunMs;
        while (trailing > o.padMs && cur.frames.length > 1) {
            const last = cur.frames[cur.frames.length - 1];
            if (trailing - last.durMs < o.padMs) break;
            cur.frames.pop();
            trailing -= last.durMs;
        }
        if (cur.speechMs >= o.minSpeechMs) {
            const first = cur.frames[0];
            const last = cur.frames[cur.frames.length - 1];
            clips.push({
                pcm: Buffer.concat(cur.frames.map((f) => f.pcm)),
                sampleRate: first.sampleRate,
                startMs: first.startMs,
                endMs: last.startMs + last.durMs,
                speechMs: cur.speechMs,
            });
        }
        cur = null;
        pre = [];
    };

    for (const f of frames) {
        const speech = f.rms >= o.speechRms;
        if (cur) {
            const first = cur.frames[0];
            if (f.sampleRate !== first.sampleRate || f.startMs - cur.lastEnd > o.maxFrameGapMs) close();
        }
        if (pre.length) {
            const lastPre = pre[pre.length - 1];
            if (f.sampleRate !== lastPre.sampleRate || f.startMs - (lastPre.startMs + lastPre.durMs) > o.maxFrameGapMs) pre = [];
        }
        if (!cur) {
            if (!speech) {
                pre.push(f);
                let preMs = pre.reduce((a, p) => a + p.durMs, 0);
                while (pre.length > 1 && preMs - pre[0].durMs >= o.padMs) preMs -= pre.shift()!.durMs;
                continue;
            }
            cur = { frames: [...pre], speechMs: 0, silenceRunMs: 0, lastEnd: f.startMs };
            pre = [];
        }
        cur.frames.push(f);
        cur.lastEnd = f.startMs + f.durMs;
        if (speech) {
            cur.speechMs += f.durMs;
            cur.silenceRunMs = 0;
        } else {
            cur.silenceRunMs += f.durMs;
        }
        const clipMs = cur.lastEnd - cur.frames[0].startMs;
        if (cur.silenceRunMs >= o.breakSilenceMs || clipMs >= o.maxClipMs) close();
    }
    close();
    return clips;
}

// ── De-duplication against the live transcript ───────────────────────────

function words(text: string): string[] {
    return text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}']+/gu, ' ').trim().split(' ').filter(Boolean);
}

/**
 * True when the live transcript already holds this text: the provider's own
 * buffered flush on reconnect, or audio that never really went missing.
 * Word pairs, not single words, so common words cannot make a new sentence
 * look covered.
 */
export function isCoveredByLive(text: string, liveTexts: readonly string[], threshold: number = 0.5): boolean {
    const w = words(text);
    if (w.length === 0) return true;
    const live = liveTexts.map(words);
    if (w.length === 1) return live.some((lw) => lw.includes(w[0]));
    const liveBigrams = new Set<string>();
    for (const lw of live) for (let i = 0; i + 1 < lw.length; i++) liveBigrams.add(`${lw[i]} ${lw[i + 1]}`);
    let hit = 0;
    for (let i = 0; i + 1 < w.length; i++) if (liveBigrams.has(`${w[i]} ${w[i + 1]}`)) hit++;
    return hit / (w.length - 1) >= threshold;
}

/** Inserts by timestamp, after any entry with the same time, so the list stays in time order. */
export function insertSortedByTimestamp<T extends { timestamp: number }>(list: T[], item: T): number {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].timestamp <= item.timestamp) lo = mid + 1;
        else hi = mid;
    }
    list.splice(lo, 0, item);
    return lo;
}

// ── Stall watchdog ───────────────────────────────────────────────────────

export interface StallInput {
    nowMs: number;
    /** Last transcript, or the start of listening, or the last stall: whichever is latest. */
    quietSinceMs: number;
    /** Speech-level audio that went in since quietSinceMs. */
    speechMsSinceQuiet: number;
    stallMs: number;
    stallSpeechMs: number;
}

/**
 * Speech is going in, nothing is coming out: the connection is stalled. Also
 * true during an error outage that is not getting better: a provider whose own
 * reconnect gave up stays dead until something restarts it.
 */
export function shouldDeclareStall(s: StallInput): boolean {
    if (s.nowMs - s.quietSinceMs < s.stallMs) return false;
    return s.speechMsSinceQuiet >= s.stallSpeechMs;
}

/** Wait before the next stall after `consecutive` stalls with no transcript between them. */
export function stallBackoffMs(consecutive: number, stallMs: number, maxMs: number): number {
    return Math.min(maxMs, stallMs * Math.pow(2, Math.max(0, consecutive)));
}

// ── Per-source tracker ───────────────────────────────────────────────────

interface LiveFinal { text: string; atMs: number }

/** One source's audio, live finals and current outage. */
export class SttGapTracker {
    readonly ring: PcmRingBuffer;
    outage: Outage | null = null;
    private liveFinals: LiveFinal[] = [];
    private quietSinceMs: number | null = null;
    private speechMsSinceQuiet = 0;
    private consecutiveStalls = 0;
    private dropWarned = false;

    constructor(
        readonly source: SttSource,
        private readonly opts: GapOptions,
        private readonly nextId: () => number,
        private readonly log: GapLogger,
    ) {
        this.ring = new PcmRingBuffer(opts.capMs);
    }

    /** Capture path. Returns true when the watchdog declares a stall. */
    onAudio(chunk: Buffer, sampleRate: number, nowMs: number, watchdog: boolean): boolean {
        if (!chunk || chunk.length < 2 || !(sampleRate > 0)) return false;
        const durMs = pcmDurationMs(chunk.length, sampleRate);
        const frame: PcmFrame = { pcm: Buffer.from(chunk), sampleRate, startMs: nowMs - durMs, durMs, rms: pcmRms(chunk) };
        const evicted = this.ring.push(frame);
        if (this.outage && evicted.length) {
            const lost = evicted.filter((f) => f.startMs + f.durMs > this.outage!.startMs);
            if (lost.length) {
                this.outage.droppedMs += lost.reduce((a, f) => a + f.durMs, 0);
                if (!this.dropWarned) {
                    this.dropWarned = true;
                    this.log('warn', `[SttGap] ${this.source}: outage longer than ${Math.round(this.opts.capMs / 1000)} s, its oldest audio is dropped and cannot be recovered`);
                }
            }
        }
        if (this.quietSinceMs === null) this.quietSinceMs = frame.startMs;
        if (frame.rms >= this.opts.speechRms) this.speechMsSinceQuiet += durMs;
        if (!watchdog) return false;

        const stallMs = stallBackoffMs(this.consecutiveStalls, this.opts.stallMs, this.opts.maxStallBackoffMs);
        if (!shouldDeclareStall({
            nowMs,
            quietSinceMs: this.quietSinceMs,
            speechMsSinceQuiet: this.speechMsSinceQuiet,
            stallMs,
            stallSpeechMs: this.opts.stallSpeechMs,
        })) return false;

        // A stall during an open outage keeps that outage (its start is the hole's start).
        if (!this.outage) this.openOutage('stall', this.quietSinceMs);
        this.consecutiveStalls++;
        this.quietSinceMs = nowMs;
        this.speechMsSinceQuiet = 0;
        return true;
    }

    /** A retryable provider error: the outage starts a little before it. */
    onProviderError(nowMs: number): void {
        if (this.outage) return;
        this.openOutage('error', nowMs - this.opts.errorPrerollMs);
    }

    /** Any transcript proves the connection works. Returns the outage it closed, if any. */
    onTranscript(text: string, isFinal: boolean, nowMs: number): Outage | null {
        this.quietSinceMs = nowMs;
        this.speechMsSinceQuiet = 0;
        this.consecutiveStalls = 0;
        if (isFinal && text.trim()) {
            this.liveFinals.push({ text, atMs: nowMs });
            const cutoff = nowMs - this.opts.liveFinalsKeepMs;
            if (this.liveFinals.length > 2000 || (this.liveFinals.length && this.liveFinals[0].atMs < cutoff)) {
                this.liveFinals = this.liveFinals.filter((f) => f.atMs >= cutoff).slice(-2000);
            }
        }
        if (!this.outage) return null;
        const closed = this.outage;
        closed.recoveredAtMs = nowMs;
        this.outage = null;
        this.dropWarned = false;
        return closed;
    }

    liveFinalsBetween(fromMs: number, toMs: number): string[] {
        return this.liveFinals.filter((f) => f.atMs >= fromMs && f.atMs <= toMs).map((f) => f.text);
    }

    reset(): void {
        this.ring.clear();
        this.outage = null;
        this.liveFinals = [];
        this.quietSinceMs = null;
        this.speechMsSinceQuiet = 0;
        this.consecutiveStalls = 0;
        this.dropWarned = false;
    }

    private openOutage(reason: OutageReason, startMs: number): void {
        const oldest = this.ring.oldestStartMs();
        this.outage = {
            id: this.nextId(),
            source: this.source,
            reason,
            startMs: oldest !== null ? Math.max(startMs, oldest) : startMs,
            recoveredAtMs: null,
            droppedMs: 0,
        };
        this.log('warn', `[SttGap] ${this.source}: transcript outage (${reason}); keeping its audio for recovery`);
    }
}

// ── Recovery transcribers and the privacy plan ───────────────────────────

export type RecoveryTranscriberKind = 'same-provider' | 'cloud' | 'local';

export interface RecoveryTranscriber {
    id: string;
    kind: RecoveryTranscriberKind;
    /** Text of the clip ('' for no speech). Throws when the transcriber failed. */
    transcribe(clip: SpeechClip): Promise<string>;
    /** Called once the outage's clips are done. */
    dispose?(): void;
}

export interface RecoveryPlanInput {
    /** The provider id in Settings. */
    primaryProvider: string;
    /** The provider actually running (several branches fall back to Google). */
    effectiveProvider: string;
    /** The user keeps transcription on this machine. */
    localOnly: boolean;
    /** Cloud providers with a saved transcription key. */
    configuredCloud: readonly string[];
    /** A local model is on disk, ready to load. */
    localModelAvailable: boolean;
}

export interface RecoveryPlanEntry { id: string; kind: RecoveryTranscriberKind }

/** Providers that run on this machine. */
export const LOCAL_STT_PROVIDERS: ReadonlySet<string> = new Set(['local-whisper', 'apple-speech']);

/**
 * Providers a second, separate instance can be opened for, fed the missed
 * audio faster than real time. Not Natively: its server keys a session by
 * key and channel, so a second one for the same channel would collide with
 * the live one (concurrent_session_blocked).
 */
export const REPLAY_CAPABLE_PROVIDERS: ReadonlySet<string> = new Set([
    'deepgram', 'soniox', 'qwen', 'elevenlabs', 'openai', 'nvidia_nim', 'google', 'groq', 'azure', 'ibmwatson',
]);

/** Order tried for another configured provider (fast batch first). */
const CLOUD_FALLBACK_ORDER = ['groq', 'openai', 'deepgram', 'soniox', 'qwen', 'elevenlabs'];

/**
 * Which transcribers may hear the missed audio, in order. Privacy first: a
 * user on a local provider, or in local-only mode, gets local transcribers
 * only — never a cloud one, whatever keys are saved.
 */
export function planRecoveryTranscribers(i: RecoveryPlanInput): RecoveryPlanEntry[] {
    const localOnly = i.localOnly || LOCAL_STT_PROVIDERS.has(i.primaryProvider) || LOCAL_STT_PROVIDERS.has(i.effectiveProvider);
    const plan: RecoveryPlanEntry[] = [];
    if (!localOnly) {
        if (REPLAY_CAPABLE_PROVIDERS.has(i.effectiveProvider)) plan.push({ id: i.effectiveProvider, kind: 'same-provider' });
        for (const id of CLOUD_FALLBACK_ORDER) {
            if (id === i.effectiveProvider) continue;
            if (i.configuredCloud.includes(id)) plan.push({ id, kind: 'cloud' });
        }
    }
    if (i.localModelAvailable) plan.push({ id: 'local-whisper', kind: 'local' });
    return plan;
}

/** The surface every provider class shares (STTProvider in main.ts). */
export interface ReplayableStt {
    on(event: 'transcript', fn: (s: { text: string; isFinal: boolean }) => void): unknown;
    on(event: 'error', fn: (e: Error) => void): unknown;
    removeAllListeners?(event?: string): unknown;
    setSampleRate(rate: number): void;
    setAudioChannelCount?(count: number): void;
    start(): void;
    write(chunk: Buffer): void;
    notifySpeechEnded?(): void;
    finalize?(): unknown;
    stop(): void;
}

export interface ReplayOptions {
    /** Times real time the audio is fed at. */
    speed: number;
    sliceMs: number;
    /** Silence appended so the provider's endpointing fires. */
    tailSilenceMs: number;
    /** Done after this long with no new transcript once the audio is in. */
    idleMs: number;
    /** Hard limit beyond the feeding time. */
    timeoutPadMs: number;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    /** One instance for all of an outage's clips (a local model loads once), closed by dispose(). */
    reuseInstance: boolean;
}

export const REPLAY_DEFAULTS: ReplayOptions = {
    speed: 2,
    sliceMs: 100,
    tailSilenceMs: 1_200,
    idleMs: 3_000,
    timeoutPadMs: 20_000,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    reuseInstance: false,
};

/**
 * A transcriber that opens a fresh, private instance of a provider for each
 * clip, feeds it the clip faster than real time, collects its finals, and
 * closes it. The instance is never wired to the live transcript.
 */
export function createReplayTranscriber(
    id: string,
    kind: RecoveryTranscriberKind,
    create: () => ReplayableStt | null,
    opts: Partial<ReplayOptions> = {},
): RecoveryTranscriber {
    const o = { ...REPLAY_DEFAULTS, ...opts };
    // The instance in use and where its events go for the clip being fed.
    let held: ReplayableStt | null = null;
    let heldRate = 0;
    let sink: { finals: string[]; lastEventAt: number; lastError: Error | null } | null = null;
    const close = (stt: ReplayableStt) => {
        try { stt.stop(); } catch { /* closing a private instance never matters */ }
        try { stt.removeAllListeners?.('transcript'); } catch { /* ignore */ }
    };
    const open = (rate: number): ReplayableStt => {
        if (held) return held;
        const stt = create();
        if (!stt) throw new Error(`${id}: not available`);
        stt.on('transcript', (s) => {
            if (!sink) return;
            sink.lastEventAt = o.now();
            if (s?.isFinal && typeof s.text === 'string' && s.text.trim()) sink.finals.push(s.text.trim());
        });
        stt.on('error', (e) => { if (sink) sink.lastError = e instanceof Error ? e : new Error(String(e)); });
        stt.setSampleRate(rate);
        stt.setAudioChannelCount?.(1);
        if (o.reuseInstance) { held = stt; heldRate = rate; }
        stt.start();
        return stt;
    };
    return {
        id,
        kind,
        async transcribe(clip: SpeechClip): Promise<string> {
            // A reused instance keeps its rate; a clip at another rate gets a fresh one.
            if (held && heldRate !== clip.sampleRate) { close(held); held = null; }
            const mine = { finals: [] as string[], lastEventAt: o.now(), lastError: null as Error | null };
            sink = mine;
            const stt = open(clip.sampleRate);
            try {
                const sliceBytes = Math.max(2, Math.round((clip.sampleRate * o.sliceMs) / 1000) * 2);
                const feedStart = o.now();
                for (let off = 0; off < clip.pcm.length; off += sliceBytes) {
                    stt.write(clip.pcm.subarray(off, Math.min(clip.pcm.length, off + sliceBytes)));
                    await o.sleep(o.sliceMs / o.speed);
                }
                const tail = Buffer.alloc(Math.round((clip.sampleRate * o.tailSilenceMs) / 1000) * 2);
                for (let off = 0; off < tail.length; off += sliceBytes) {
                    stt.write(tail.subarray(off, Math.min(tail.length, off + sliceBytes)));
                    await o.sleep(o.sliceMs / o.speed);
                }
                try { stt.notifySpeechEnded?.(); } catch { /* optional */ }
                try { stt.finalize?.(); } catch { /* optional */ }
                mine.lastEventAt = Math.max(mine.lastEventAt, o.now());
                const deadline = feedStart + (clip.endMs - clip.startMs) / o.speed + o.timeoutPadMs;
                while (o.now() - mine.lastEventAt < o.idleMs && o.now() < deadline) {
                    await o.sleep(Math.min(250, o.idleMs));
                }
            } finally {
                sink = null;
                if (!o.reuseInstance) close(stt);
            }
            if (!mine.finals.length && mine.lastError) {
                // A failed reused instance is not trusted with the next clip.
                if (held === stt) { close(stt); held = null; }
                throw mine.lastError;
            }
            return mine.finals.join(' ');
        },
        dispose(): void {
            if (held) { close(held); held = null; }
        },
    };
}

// ── Coordinator ──────────────────────────────────────────────────────────

export type GapLogger = (level: 'info' | 'warn', message: string) => void;

export interface SttGapRecoveryDeps {
    /** Transcribers allowed right now for this source, in order (privacy decided by the caller's plan). */
    transcribers: (source: SttSource) => RecoveryTranscriber[];
    onRecovered: (segment: RecoveredSegment) => void;
    /** Reconnect a stalled channel (main: stop() then start() on its STT). */
    restartStt: (source: SttSource) => void;
    /** Whether the stall watchdog runs for this source (streaming providers only). */
    watchdogEnabled: (source: SttSource) => boolean;
    now?: () => number;
    schedule?: (fn: () => void, ms: number) => unknown;
    cancel?: (handle: unknown) => void;
    log?: GapLogger;
    clipOptions?: Partial<ClipOptions>;
}

/** Both sources' trackers, the recovery queue and its single worker. */
export class SttGapRecoveryCoordinator {
    private readonly opts: GapOptions;
    private readonly trackers: Record<SttSource, SttGapTracker>;
    private readonly now: () => number;
    private readonly schedule: (fn: () => void, ms: number) => unknown;
    private readonly cancel: (handle: unknown) => void;
    private readonly log: GapLogger;
    private active = false;
    private generation = 0;
    private outageSeq = 0;
    private queue: Outage[] = [];
    private timers = new Set<unknown>();
    private worker: Promise<void> | null = null;

    constructor(private readonly deps: SttGapRecoveryDeps, opts: Partial<GapOptions> = {}) {
        this.opts = { ...GAP_DEFAULTS, ...opts };
        this.now = deps.now ?? (() => Date.now());
        this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
        this.cancel = deps.cancel ?? ((h) => clearTimeout(h as NodeJS.Timeout));
        this.log = deps.log ?? ((level, msg) => (level === 'warn' ? console.warn(msg) : console.log(msg)));
        const nextId = () => ++this.outageSeq;
        this.trackers = {
            mic: new SttGapTracker('mic', this.opts, nextId, this.log),
            system: new SttGapTracker('system', this.opts, nextId, this.log),
        };
    }

    startMeeting(): void {
        this.reset();
        this.active = true;
    }

    endMeeting(): void {
        const open = (['mic', 'system'] as SttSource[]).filter((s) => this.trackers[s].outage);
        if (open.length) this.log('warn', `[SttGap] meeting ended during an outage (${open.join(', ')}); that audio is not recovered`);
        this.reset();
        this.active = false;
    }

    isActive(): boolean { return this.active; }

    onAudio(source: SttSource, chunk: Buffer, sampleRate: number): void {
        if (!this.active) return;
        let stalled = false;
        try {
            stalled = this.trackers[source].onAudio(chunk, sampleRate, this.now(), this.deps.watchdogEnabled(source));
        } catch { return; }
        if (stalled) {
            this.log('warn', `[SttGap] ${source}: speech going in, no transcript coming out; reconnecting`);
            try { this.deps.restartStt(source); } catch (e: any) { this.log('warn', `[SttGap] ${source}: reconnect failed: ${e?.message ?? e}`); }
        }
    }

    onProviderError(source: SttSource): void {
        if (!this.active) return;
        this.trackers[source].onProviderError(this.now());
    }

    onTranscript(source: SttSource, text: string, isFinal: boolean): void {
        if (!this.active) return;
        const closed = this.trackers[source].onTranscript(text ?? '', !!isFinal, this.now());
        if (!closed) return;
        const gen = this.generation;
        const handle = this.schedule(() => {
            this.timers.delete(handle);
            if (gen !== this.generation) return;
            this.queue.push(closed);
            this.kick();
        }, this.opts.settleMs);
        this.timers.add(handle);
    }

    getOutage(source: SttSource): Outage | null { return this.trackers[source].outage; }
    getTracker(source: SttSource): SttGapTracker { return this.trackers[source]; }

    /** Resolves when the queue is empty and no job runs (tests). */
    async whenIdle(): Promise<void> {
        while (this.worker) await this.worker;
    }

    private reset(): void {
        this.generation++;
        for (const h of this.timers) { try { this.cancel(h); } catch { /* ignore */ } }
        this.timers.clear();
        this.queue = [];
        this.trackers.mic.reset();
        this.trackers.system.reset();
    }

    private kick(): void {
        if (this.worker) return;
        const run = async () => {
            while (this.queue.length) {
                const outage = this.queue.shift()!;
                try { await this.recover(outage); } catch (e: any) {
                    this.log('warn', `[SttGap] ${outage.source}: recovery failed: ${e?.message ?? e}`);
                }
            }
        };
        this.worker = run().finally(() => { this.worker = null; });
    }

    private async recover(outage: Outage): Promise<void> {
        const gen = this.generation;
        const tracker = this.trackers[outage.source];
        const endMs = outage.recoveredAtMs ?? this.now();
        const clips = splitIntoSpeechClips(tracker.ring.range(outage.startMs, endMs), this.deps.clipOptions);
        if (!clips.length) return;
        const transcribers = this.deps.transcribers(outage.source);
        if (!transcribers.length) {
            this.log('warn', `[SttGap] ${outage.source}: ${clips.length} missed clip(s), but no transcriber is allowed to recover them`);
            return;
        }
        let recovered = 0;
        try {
            recovered = await this.recoverClips(outage, clips, transcribers, gen);
        } finally {
            for (const t of transcribers) { try { t.dispose?.(); } catch { /* ignore */ } }
        }
        this.log('info', `[SttGap] ${outage.source}: outage ${outage.id} (${outage.reason}) recovered ${recovered} line(s) from ${clips.length} clip(s)`);
    }

    private async recoverClips(outage: Outage, clips: SpeechClip[], transcribers: RecoveryTranscriber[], gen: number): Promise<number> {
        const tracker = this.trackers[outage.source];
        let recovered = 0;
        for (const clip of clips) {
            if (gen !== this.generation) return recovered;
            // Behind anything the live path has queued.
            await new Promise<void>((r) => setImmediate(r));
            let text = '';
            let usedId = '';
            for (const t of transcribers) {
                try {
                    text = (await t.transcribe(clip)).trim();
                    usedId = t.id;
                    break;
                } catch (e: any) {
                    this.log('warn', `[SttGap] ${outage.source}: ${t.id} could not transcribe a missed clip: ${e?.message ?? e}`);
                }
            }
            if (gen !== this.generation) return recovered;
            if (!text || !usedId) continue;
            const live = tracker.liveFinalsBetween(outage.startMs - 5_000, this.now());
            if (isCoveredByLive(text, live)) continue;
            recovered++;
            try {
                this.deps.onRecovered({
                    source: outage.source,
                    text,
                    timestamp: clip.startMs,
                    endTimestamp: clip.endMs,
                    marker: 'recovered',
                    transcriberId: usedId,
                    reason: outage.reason,
                });
            } catch (e: any) {
                this.log('warn', `[SttGap] ${outage.source}: inserting a recovered line failed: ${e?.message ?? e}`);
            }
        }
        return recovered;
    }
}
