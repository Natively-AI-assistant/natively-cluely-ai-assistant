/**
 * Mid-meeting transcription failover (2026-10-15).
 *
 * Gap recovery (sttGapRecovery.ts) puts back what an outage missed once the
 * provider is back, but while it is down the live transcript stands still:
 * no lines, no answers. When the live cloud provider of one channel (mic or
 * system) keeps failing past main's reconnect policy (the point main would
 * otherwise declare the channel failed), this switches that channel's live
 * stream to the next transcriber the user has set up, until the primary
 * recovers:
 *
 *   - Which ones may stand in is gap recovery's own plan
 *     (planRecoveryTranscribers, minus the failing provider itself): another
 *     cloud provider the user has a key for, else a local model already on
 *     disk; a user on local-only transcription never has audio sent to a
 *     cloud provider.
 *   - Main keeps feeding the primary, so its own reconnect and revival logic
 *     (sttReconnectPolicy.mjs) keeps trying; every `probeMs` the primary is
 *     also restarted, for providers that latch off. Its first final with text
 *     means it is back: the stand-in is stopped and the primary leads again.
 *     That first line, and for a few seconds the ones after it, are dropped
 *     when the stand-in already said every word of them (the primary flushes
 *     the audio it buffered while down); a new question that only shares
 *     its frame with a stand-in line goes through (F-ACC-09).
 *   - A stand-in that fails too (repeated errors, or a key that is refused)
 *     hands over to the next one; with none left the channel is reported
 *     failed as before.
 *   - Never on an authentication error of the primary: main treats those as
 *     terminal and never calls engage() for them.
 *
 * Gap recovery keeps working: the stand-in's text reaches the same transcript
 * handler, which closes the open outage, and the audio between the failure
 * and the stand-in's first line is replayed as before.
 *
 * Platform-neutral: providers are the same classes on macOS and Windows; the
 * clock and timers are injected for the tests.
 */

import { repeatsLiveText, type SttSource } from './sttGapRecovery';
import { providerHasPendingWork, sttTailTimingFor, type SttTailTiming } from './sttTailTiming';

/** The provider surface used here (main's STTProvider shares it). */
export interface LiveStt {
    on(event: 'transcript', fn: (s: LiveSegment) => void): unknown;
    on(event: 'error', fn: (e: Error) => void): unknown;
    removeAllListeners?(event?: string): unknown;
    setSampleRate(rate: number): void;
    setAudioChannelCount?(count: number): void;
    start(): void;
    write(chunk: Buffer): void;
    notifySpeechEnded?(): void;
    stop(): void;
}

export interface LiveSegment {
    text: string;
    isFinal: boolean;
    confidence?: number;
    speakerId?: string;
}

export type FailoverPhase = 'primary' | 'fallback';

export interface FailoverStatus {
    source: SttSource;
    phase: FailoverPhase;
    primary: string;
    /** The stand-in running now (phase 'fallback'). */
    fallback: string | null;
    /** Why the channel went back to its primary (phase 'primary'). */
    reason?: 'recovered' | 'exhausted';
}

export interface SttFailoverDeps {
    source: SttSource;
    /** The provider actually running for this channel (main's effectiveSttId). */
    primary: string;
    /** Stand-ins in the order allowed, never the primary. Read at each switch. */
    candidates: () => string[];
    /** A fresh instance of `id`, or null when it is not set up. */
    create: (id: string) => LiveStt | null;
    /** A stand-in's segment, into the live transcript handler. */
    onTranscript: (seg: LiveSegment, providerId: string) => void;
    onStatus: (status: FailoverStatus) => void;
    /** Reconnects the primary from scratch (stop, then start). */
    restartPrimary: () => void;
    /** The last-words wait for a stand-in at the meeting's end (default sttTailTimingFor). */
    tailTiming?: (id: string) => SttTailTiming;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    setInterval?: (fn: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
    log?: (line: string) => void;
}

export interface SttFailoverOptions {
    /** How often a primary that is down is restarted while a stand-in leads. */
    probeMs?: number;
    /** A stand-in failing this many times in a row hands over to the next. */
    fallbackMaxErrors?: number;
    /** A stand-in's finals kept for the switch-back de-duplication. */
    recentFinalsMs?: number;
    /** After every stand-in failed (or none is set up), wait this long before trying again. */
    retryAfterMs?: number;
    /**
     * After the hand-back, the primary's finals are still checked against the
     * stand-in's for this long: its flush of the audio it buffered while down
     * can hold several lines the stand-in already said.
     */
    handbackDedupeMs?: number;
}

/** User-facing provider names for the notice. */
export const STT_PROVIDER_NAMES: Record<string, string> = {
    deepgram: 'Deepgram',
    soniox: 'Soniox',
    qwen: 'Qwen ASR',
    elevenlabs: 'ElevenLabs',
    openai: 'OpenAI',
    groq: 'Groq',
    azure: 'Azure',
    ibmwatson: 'IBM Watson',
    google: 'Google',
    natively: 'Natively',
    nvidia_nim: 'NVIDIA NIM',
    'local-whisper': 'the local model',
    'apple-speech': 'Apple Speech',
};

export function sttProviderName(id: string): string {
    return STT_PROVIDER_NAMES[id] ?? id;
}

/** Why the primary handed over: 'quota' when its provider refused the key for credit or quota. */
export type FailoverCause = 'quota' | 'other';

/** Providers whose key the user brings, so "your key" and its credit limit are theirs to check. */
const KEYLESS_STT_PROVIDERS = new Set(['natively', 'local-whisper', 'apple-speech']);

/**
 * "Transcribing with Deepgram while Soniox is down." — or, when the provider
 * stopped the user's own key for quota, what happened and where to look.
 * "Is down" for a quota stop read as the provider being broken: a user whose
 * ElevenLabs key was cut off ~16 s into every session (restricted key, credit
 * limit) reported it as both providers failing (user log 2026-11-03, Windows).
 */
export function failoverNotice(primary: string, fallback: string, cause: FailoverCause = 'other'): string {
    const p = sttProviderName(primary);
    const f = sttProviderName(fallback);
    if (cause === 'quota' && !KEYLESS_STT_PROVIDERS.has(primary)) {
        const lead = f.charAt(0).toUpperCase() + f.slice(1);
        return `${p} stopped your key: it is out of quota. Check the key's credit limit in your ${p} account. ${lead} is transcribing until then.`;
    }
    return `Transcribing with ${f} while ${p} is down.`;
}

/**
 * Errors no retry fixes: a refused key or account, or a local model that could
 * not start. The same classes main treats as terminal for the primary.
 */
export function isTerminalSttError(err: unknown): boolean {
    const e = err as { message?: string; code?: unknown; response?: { status?: number } } | null;
    const msg = String(e?.message ?? '').toLowerCase();
    return e?.response?.status === 401
        || msg.includes('auth_timeout')
        || msg.includes('invalid_key')
        || msg.includes('invalid api')
        || msg.includes('authentication')
        || e?.code === 'google_stt_credentials_unavailable'
        || e?.code === 'local_stt_unavailable';
}

/**
 * Stops a stand-in for good. Its text is no longer wanted, but its errors
 * still are caught: a batch upload (Groq, Azure…) or a socket can fail after
 * stop(), and an 'error' event with no listener would throw in main. The
 * swallowing listener is never removed.
 */
export function retireStandIn(stt: LiveStt): void {
    try { stt.removeAllListeners?.('transcript'); } catch { /* gone */ }
    try { stt.removeAllListeners?.('error'); } catch { /* gone */ }
    try { stt.on('error', () => { /* retired: a late failure means nothing now */ }); } catch { /* gone */ }
    try { stt.stop(); } catch { /* gone */ }
}

export class SttFailover {
    private phase: FailoverPhase = 'primary';
    private fallback: { id: string; stt: LiveStt; errors: number } | null = null;
    /** Stand-ins that failed during this outage. */
    private tried = new Set<string>();
    private probe: unknown = null;
    private rate: number | null = null;
    private channels: number | null = null;
    private recentFinals: Array<{ text: string; at: number }> = [];
    private readonly now: () => number;
    private readonly probeMs: number;
    private readonly fallbackMaxErrors: number;
    private readonly recentFinalsMs: number;
    private readonly retryAfterMs: number;
    private exhaustedAt: number | null = null;
    private readonly handbackDedupeMs: number;
    /** Until when the primary's finals are checked against the stand-in's (after a recovery). */
    private handbackUntil = 0;

    constructor(private readonly deps: SttFailoverDeps, options: SttFailoverOptions = {}) {
        this.now = deps.now ?? Date.now;
        this.probeMs = options.probeMs ?? 60_000;
        this.fallbackMaxErrors = options.fallbackMaxErrors ?? 3;
        this.recentFinalsMs = options.recentFinalsMs ?? 60_000;
        this.retryAfterMs = options.retryAfterMs ?? 120_000;
        this.handbackDedupeMs = options.handbackDedupeMs ?? 10_000;
    }

    get active(): boolean {
        return this.phase === 'fallback';
    }

    get fallbackId(): string | null {
        return this.fallback?.id ?? null;
    }

    /**
     * The primary is down past the reconnect policy: switch to a stand-in.
     * True when one is running (already, or now); false when none is set up.
     */
    engage(): boolean {
        if (this.phase === 'fallback') return true;
        // Every stand-in just failed, or none is set up: not on every error.
        if (this.exhaustedAt !== null && this.now() - this.exhaustedAt < this.retryAfterMs) return false;
        this.tried.clear();
        if (!this.startNextFallback()) {
            this.exhaustedAt = this.now();
            return false;
        }
        this.exhaustedAt = null;
        this.startProbe();
        return true;
    }

    /**
     * A segment from the primary. True: it goes into the transcript as usual.
     * While a stand-in leads, the primary's partials are held back, and its
     * first final with text means it is back.
     */
    acceptPrimary(seg: LiveSegment): boolean {
        const text = (seg.text ?? '').trim();
        if (this.phase !== 'fallback') {
            // Just handed back: the rest of the primary's flush may repeat the
            // stand-in too (F-ACC-09 D8). Only a line whose every word the
            // stand-in already said is dropped, so a new question goes through.
            if (!seg.isFinal || !text || this.handbackUntil === 0) return true;
            if (this.now() > this.handbackUntil) {
                this.handbackUntil = 0;
                this.recentFinals = [];
                return true;
            }
            return !repeatsLiveText(text, this.recentTexts());
        }
        if (!seg.isFinal || !text) return false;
        const recent = this.recentTexts();
        this.disengage('recovered');
        // Kept for the flush that follows (above).
        this.recentFinals = recent.map((t) => ({ text: t, at: this.now() }));
        this.handbackUntil = this.now() + this.handbackDedupeMs;
        // F-ACC-09 D1: half the word pairs in common is not a repeat: "…with
        // Kafka?" after "…with Redis?" is a new question.
        return !repeatsLiveText(text, recent);
    }

    write(chunk: Buffer): void {
        if (this.fallback) {
            try { this.fallback.stt.write(chunk); } catch { /* its error event decides */ }
        }
    }

    setSampleRate(rate: number): void {
        this.rate = rate;
        if (this.fallback) {
            try { this.fallback.stt.setSampleRate(rate); } catch { /* applied at next start */ }
        }
    }

    setAudioChannelCount(count: number): void {
        this.channels = count;
        if (this.fallback) {
            try { this.fallback.stt.setAudioChannelCount?.(count); } catch { /* mono default */ }
        }
    }

    notifySpeechEnded(): void {
        if (this.fallback) {
            try { this.fallback.stt.notifySpeechEnded?.(); } catch { /* optional */ }
        }
    }

    /**
     * The meeting is ending while a stand-in leads: its audio is over, so it
     * is told so and its last words are waited for (an upload in flight, a
     * local final being transcribed, or until it has gone quiet for its own
     * idle time; never past its hard limit), with its text still reaching the
     * transcript. Resolves at once when no stand-in is running, so a normal
     * meeting end is not delayed. stop() comes after.
     */
    async drain(): Promise<void> {
        const fb = this.fallback;
        if (!fb || this.phase !== 'fallback') return;
        const timing = (this.deps.tailTiming ?? ((id: string) => sttTailTimingFor(id)))(fb.id);
        const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
        let lastEventAt = this.now();
        let finalAnnounced = false;
        let finalSeen = false;
        const onSeg = (seg: LiveSegment) => {
            lastEventAt = this.now();
            if (seg?.isFinal) finalSeen = true;
        };
        fb.stt.on('transcript', onSeg);
        try {
            try { fb.stt.notifySpeechEnded?.(); } catch { /* optional */ }
            try { finalAnnounced = (fb.stt as { finalize?: () => unknown }).finalize?.() === true; } catch { /* optional */ }
            const start = this.now();
            const canSay = typeof (fb.stt as { hasPendingWork?: unknown }).hasPendingWork === 'function';
            const busy = () => (canSay ? providerHasPendingWork(fb.stt) : finalAnnounced && !finalSeen);
            while (
                this.fallback === fb
                && this.now() - start < timing.timeoutMs
                && (busy() || this.now() - lastEventAt < timing.idleMs)
            ) {
                await sleep(Math.max(1, Math.min(200, timing.idleMs)));
            }
        } finally {
            try { (fb.stt as { removeListener?: (e: string, f: unknown) => unknown }).removeListener?.('transcript', onSeg); } catch { /* retired */ }
        }
    }

    /** The channel is torn down (meeting end, reconfigure): back to idle. */
    stop(): void {
        if (this.phase === 'fallback') this.disengage('stopped');
    }

    private recentTexts(): string[] {
        const cutoff = this.now() - this.recentFinalsMs;
        this.recentFinals = this.recentFinals.filter((f) => f.at >= cutoff);
        return this.recentFinals.map((f) => f.text);
    }

    private startNextFallback(): boolean {
        this.handbackUntil = 0;
        let ids: string[] = [];
        try { ids = this.deps.candidates(); } catch { ids = []; }
        for (const id of ids) {
            if (id === this.deps.primary || this.tried.has(id)) continue;
            this.tried.add(id);
            let stt: LiveStt | null = null;
            try { stt = this.deps.create(id); } catch (e) { this.deps.log?.(`${this.deps.source}: ${id} could not be created: ${(e as Error)?.message}`); }
            if (!stt) continue;
            const entry = { id, stt, errors: 0 };
            stt.on('transcript', (seg: LiveSegment) => {
                if (this.fallback !== entry) return;
                const text = (seg.text ?? '').trim();
                if (seg.isFinal && text) {
                    entry.errors = 0;
                    this.recentFinals.push({ text, at: this.now() });
                }
                this.deps.onTranscript(seg, id);
            });
            stt.on('error', (err: Error) => {
                if (this.fallback !== entry) return;
                entry.errors++;
                if (isTerminalSttError(err) || entry.errors >= this.fallbackMaxErrors) {
                    this.deps.log?.(`${this.deps.source}: stand-in ${id} failed (${isTerminalSttError(err) ? 'refused' : `${entry.errors} errors`}), trying the next`);
                    this.dropFallback();
                    if (!this.startNextFallback()) this.disengage('exhausted');
                }
            });
            try {
                if (this.rate) stt.setSampleRate(this.rate);
                if (this.channels) stt.setAudioChannelCount?.(this.channels);
                stt.start();
            } catch (e) {
                this.deps.log?.(`${this.deps.source}: ${id} did not start: ${(e as Error)?.message}`);
                retireStandIn(stt);
                continue;
            }
            this.fallback = entry;
            this.phase = 'fallback';
            this.deps.log?.(`${this.deps.source}: transcribing with ${id} while ${this.deps.primary} is down`);
            this.deps.onStatus({ source: this.deps.source, phase: 'fallback', primary: this.deps.primary, fallback: id });
            return true;
        }
        return false;
    }

    private dropFallback(): void {
        const fb = this.fallback;
        this.fallback = null;
        if (fb) retireStandIn(fb.stt);
    }

    private startProbe(): void {
        if (this.probe !== null) return;
        const set = this.deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
        this.probe = set(() => {
            if (this.phase !== 'fallback') return;
            try { this.deps.restartPrimary(); } catch { /* next probe */ }
        }, this.probeMs);
    }

    private stopProbe(): void {
        if (this.probe === null) return;
        (this.deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>)))(this.probe);
        this.probe = null;
    }

    private disengage(reason: 'recovered' | 'exhausted' | 'stopped'): void {
        const wasActive = this.phase === 'fallback';
        this.dropFallback();
        this.stopProbe();
        this.phase = 'primary';
        this.recentFinals = [];
        this.handbackUntil = 0;
        this.exhaustedAt = reason === 'exhausted' ? this.now() : null;
        this.deps.log?.(`${this.deps.source}: back to ${this.deps.primary} (${reason})`);
        // A teardown reports nothing: the channel is going away.
        if (wasActive && reason !== 'stopped') this.deps.onStatus({ source: this.deps.source, phase: 'primary', primary: this.deps.primary, fallback: null, reason });
    }
}
