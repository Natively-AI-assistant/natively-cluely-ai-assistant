/**
 * One dictation's audio and its live transcription.
 *
 * The audio streams into a private instance of the user's speech provider as
 * it is spoken (so the text is ready a moment after the second press), and
 * is also kept here, so a provider that fails mid-way can be replaced by the
 * next transcriber the user has, fed the same audio afterwards
 * (sttGapRecovery's replay transcribers). The instance is never wired to a
 * meeting's transcript.
 *
 * Pure: the provider instance, clock and sleep are injected.
 */
import type { ReplayableStt, SpeechClip } from '../../audio/sttGapRecovery';
import { providerHasPendingWork, sttTailTimingFor } from '../../audio/sttTailTiming';

export interface DictationAudio {
    frames: Array<{ pcm: Buffer; rate: number }>;
    totalMs: number;
}

export interface LiveSessionOptions {
    /** Silence appended so the provider's endpointing fires. */
    tailSilenceMs: number;
    /** Done after this long with no new transcript once the audio is in. */
    idleMs: number;
    /** Hard limit for the wait after the last audio. */
    timeoutMs: number;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
}

export const LIVE_SESSION_DEFAULTS: LiveSessionOptions = {
    tailSilenceMs: 800,
    idleMs: 1_500,
    timeoutMs: 12_000,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
};

/**
 * How long each kind of provider may take for its last words. A streaming
 * provider answers as the audio arrives; a batch one (Groq, Azure, IBM, OpenAI
 * on a custom endpoint) only after the whole upload; a local model may still
 * be running inference, or loading.
 */
export function liveTimingFor(providerId: string, opts: { openAiCustomEndpoint?: boolean } = {}): Pick<LiveSessionOptions, 'idleMs' | 'timeoutMs'> {
    // One table for dictation and the meeting-end drain of a stand-in (audio/sttTailTiming.ts).
    return sttTailTimingFor(providerId, opts);
}

/** Frame RMS that counts as speech (the native VAD's start level, as gap recovery uses). */
export const DICTATION_SPEECH_RMS = 185;

export function pcmRmsOf(chunk: Buffer, stride: number = 4): number {
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

/** The dictation's audio as one clip at the rate most of its time was captured at. */
export function clipOf(audio: DictationAudio, startMs: number): SpeechClip | null {
    if (!audio.frames.length) return null;
    const byRate = new Map<number, number>();
    for (const f of audio.frames) byRate.set(f.rate, (byRate.get(f.rate) ?? 0) + (f.pcm.length >> 1) / f.rate); // seconds
    let rate = audio.frames[0].rate;
    let most = 0;
    for (const [r, n] of byRate) if (n > most) { rate = r; most = n; }
    const pcm = Buffer.concat(audio.frames.filter((f) => f.rate === rate).map((f) => f.pcm));
    const durMs = rate > 0 ? ((pcm.length >> 1) / rate) * 1000 : 0;
    return { pcm, sampleRate: rate, startMs, endMs: startMs + durMs, speechMs: durMs };
}

export class LiveDictationSession {
    private readonly o: LiveSessionOptions;
    private stt: ReplayableStt | null = null;
    private rate = 0;
    private finals: string[] = [];
    private lastEventAt = 0;
    private error: Error | null = null;
    private opened = false;
    private closed = false;
    /** A final the provider said is still coming (a local model's finalize() returns true). */
    private finalPending = false;

    constructor(private readonly create: () => ReplayableStt | null, opts: Partial<LiveSessionOptions> = {}) {
        this.o = { ...LIVE_SESSION_DEFAULTS, ...opts };
    }

    /** Whether the provider failed (or could not be opened); its audio then goes to a replay. */
    get failed(): boolean {
        return this.error !== null;
    }

    write(chunk: Buffer, rate: number): void {
        if (this.closed || this.error) return;
        if (!this.opened) {
            this.opened = true;
            try {
                const stt = this.create();
                if (!stt) throw new Error('provider not available');
                stt.on('transcript', (s) => {
                    this.lastEventAt = this.o.now();
                    if (s?.isFinal) this.finalPending = false;
                    if (s?.isFinal && typeof s.text === 'string' && s.text.trim()) this.finals.push(s.text.trim());
                });
                stt.on('error', (e) => { this.error = e instanceof Error ? e : new Error(String(e)); });
                stt.setSampleRate(rate);
                stt.setAudioChannelCount?.(1);
                stt.start();
                this.stt = stt;
                this.rate = rate;
            } catch (e) {
                this.error = e instanceof Error ? e : new Error(String(e));
                return;
            }
        }
        if (!this.stt) return;
        if (rate !== this.rate) {
            this.rate = rate;
            try { this.stt.setSampleRate(rate); } catch { /* the provider keeps its rate */ }
        }
        try { this.stt.write(chunk); } catch (e) { this.error = e instanceof Error ? e : new Error(String(e)); }
    }

    /**
     * Ends the audio and waits for the last words. Resolves with the text;
     * rejects when the provider failed and gave nothing, so the caller can
     * replay the audio to another transcriber.
     */
    async finish(): Promise<string> {
        this.closed = true;
        const stt = this.stt;
        if (!stt) {
            if (this.error) throw this.error;
            return '';
        }
        try {
            if (!this.error && this.rate > 0) {
                const tail = Buffer.alloc(Math.round((this.rate * this.o.tailSilenceMs) / 1000) * 2);
                const slice = Math.max(2, Math.round(this.rate / 10) * 2);
                for (let off = 0; off < tail.length; off += slice) stt.write(tail.subarray(off, Math.min(tail.length, off + slice)));
            }
            try { stt.notifySpeechEnded?.(); } catch { /* optional */ }
            try { if ((stt as { finalize?: () => unknown }).finalize?.() === true) this.finalPending = true; } catch { /* optional */ }
            const start = this.o.now();
            this.lastEventAt = Math.max(this.lastEventAt, start);
            // A provider that can say so reports work still on its way: an
            // upload in flight or queued (Groq, Azure, IBM Watson, OpenAI in
            // REST mode), a final being transcribed by a local model. Without
            // that, a final it announced at finalize() counts.
            const canSay = typeof (stt as { hasPendingWork?: unknown }).hasPendingWork === 'function';
            const busy = (): boolean => (canSay ? providerHasPendingWork(stt) : this.finalPending);
            // Until the provider has nothing on its way and has gone quiet for
            // its own idle time; never past its hard limit.
            while (
                !this.error
                && this.o.now() - start < this.o.timeoutMs
                && (busy() || this.o.now() - this.lastEventAt < this.o.idleMs)
            ) {
                await this.o.sleep(Math.max(1, Math.min(200, this.o.idleMs)));
            }
        } finally {
            this.dispose();
        }
        // A provider that failed mid-way may have lost words after its last
        // final: the whole recording goes to the replay instead.
        if (this.error) throw this.error;
        return this.finals.join(' ');
    }

    /** Closes the provider without waiting (a cancelled dictation). */
    dispose(): void {
        this.closed = true;
        const stt = this.stt;
        this.stt = null;
        if (!stt) return;
        try { stt.stop(); } catch { /* closing a private instance never matters */ }
        // The error listener stays: an EventEmitter 'error' with no listener throws.
        try { stt.removeAllListeners?.('transcript'); } catch { /* ignore */ }
    }
}
