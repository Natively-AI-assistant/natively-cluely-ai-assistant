/**
 * Dictation (2026-10-15): press the shortcut, speak, press it again; the
 * words, tidied, are on the clipboard for the user to paste.
 *
 *   idle ──press──▶ recording ──press / 2 min──▶ transcribing ──▶ idle
 *
 * Output goes to the CLIPBOARD ONLY. Natively never presses keys, pastes,
 * types or moves focus in another app: the notice tells the user which keys
 * paste. A press while a meeting runs is refused with a notice; the meeting's
 * capture is never touched. (Global shortcuts fire on press only, so this is
 * press-to-start, press-to-stop rather than hold-to-talk.)
 *
 * Pure: capture, transcription, model, clipboard and notices are injected,
 * so both OS branches are tested anywhere.
 */
import { LiveDictationSession, clipOf, pcmRmsOf, DICTATION_SPEECH_RMS, type DictationAudio, type LiveSessionOptions } from './dictationSession';
import { dictationNotice, DICTATION_MAX_MS, type DictationNotice, type DictationNoticeKind } from './dictationCopy';
import type { ReplayableStt, SpeechClip } from '../../audio/sttGapRecovery';

export type DictationState = 'idle' | 'starting' | 'recording' | 'transcribing';

export interface DictationCapture {
    stop(): Promise<void> | void;
}

export interface DictationAudioSink {
    onAudio(chunk: Buffer, sampleRate: number): void;
    onError(err: Error): void;
}

export interface DictationDeps {
    platform: string;
    /** The shortcut as saved (for the notice's "press … again"). */
    accelerator: () => string;
    isMeetingActive: () => boolean;
    /** A speech provider is chosen (not 'none'). */
    hasProvider: () => boolean;
    /** Opens the microphone; audio arrives on the sink until stop(). */
    startCapture: (sink: DictationAudioSink) => Promise<DictationCapture> | DictationCapture;
    /** A private instance of the user's provider for the live stream, or null to transcribe afterwards. */
    createLive: () => ReplayableStt | null;
    /** The audio transcribed afterwards by the next transcriber the user has (privacy plan applied). Throws when none could. */
    transcribeClip: (clip: SpeechClip) => Promise<string>;
    /** The cleanup (dictationFormatter.formatDictation). Never rejects in practice; the raw text on any failure. */
    format: (raw: string) => Promise<string>;
    /** The only output. */
    writeClipboard: (text: string) => void;
    notify: (notice: DictationNotice, kind: DictationNoticeKind) => void;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    maxMs?: number;
    live?: Partial<LiveSessionOptions>;
    /** The wait for the last words for the provider in use (liveTimingFor). */
    liveTiming?: () => Partial<LiveSessionOptions>;
    log?: (msg: string) => void;
}

export class DictationController {
    private state: DictationState = 'idle';
    private capture: DictationCapture | null = null;
    private live: LiveDictationSession | null = null;
    private audio: DictationAudio = { frames: [], totalMs: 0 };
    private heardSpeech = false;
    private startedAt = 0;
    private timer: unknown = null;
    private captureError: Error | null = null;
    private generation = 0;

    constructor(private readonly deps: DictationDeps) {}

    get current(): DictationState {
        return this.state;
    }

    private notify(kind: DictationNoticeKind): void {
        try {
            this.deps.notify(dictationNotice(kind, this.deps.platform, this.deps.accelerator()), kind);
        } catch { /* a notice never breaks dictation */ }
    }

    private log(msg: string): void {
        try { (this.deps.log ?? ((m: string) => console.log(`[Dictation] ${m}`)))(msg); } catch { /* ignore */ }
    }

    /** The shortcut was pressed. */
    async press(): Promise<void> {
        switch (this.state) {
            case 'idle': return this.start();
            case 'recording': return this.stop();
            case 'transcribing': this.notify('busy'); return;
            case 'starting': return;
        }
    }

    private async start(): Promise<void> {
        if (this.deps.isMeetingActive()) {
            this.notify('meeting-running');
            return;
        }
        if (!this.deps.hasProvider()) {
            this.notify('no-provider');
            return;
        }
        const gen = ++this.generation;
        this.state = 'starting';
        this.audio = { frames: [], totalMs: 0 };
        this.heardSpeech = false;
        this.captureError = null;
        this.startedAt = (this.deps.now ?? Date.now)();
        const maxMs = this.deps.maxMs ?? DICTATION_MAX_MS;
        // The wait for the last words follows the provider (dictationSession.liveTimingFor).
        let timing: Partial<LiveSessionOptions> = {};
        try { timing = this.deps.liveTiming?.() ?? {}; } catch { /* the defaults */ }
        this.live = new LiveDictationSession(() => this.deps.createLive(), { ...timing, ...(this.deps.live ?? {}) });
        const sink: DictationAudioSink = {
            onAudio: (chunk, rate) => {
                if (gen !== this.generation || this.state !== 'recording' || !chunk?.length || !(rate > 0)) return;
                const durMs = ((chunk.length >> 1) / rate) * 1000;
                // Kept for a replay, capped at the dictation's own limit.
                if (this.audio.totalMs + durMs <= maxMs + 5_000) {
                    this.audio.frames.push({ pcm: Buffer.from(chunk), rate });
                    this.audio.totalMs += durMs;
                }
                // The provider is opened at the first speech, with what came
                // before it: a dictation of silence never leaves the machine.
                if (!this.heardSpeech) {
                    if (pcmRmsOf(chunk) < DICTATION_SPEECH_RMS) return;
                    this.heardSpeech = true;
                    for (const f of this.audio.frames) this.live?.write(f.pcm, f.rate);
                    return;
                }
                this.live?.write(chunk, rate);
            },
            onError: (err) => {
                if (gen !== this.generation) return;
                this.captureError = err;
                this.log(`microphone error: ${err?.message}`);
            },
        };
        try {
            this.capture = await this.deps.startCapture(sink);
        } catch (err) {
            this.log(`microphone did not start: ${(err as Error)?.message}`);
            this.live.dispose();
            this.live = null;
            this.state = 'idle';
            this.notify('mic-failed');
            return;
        }
        if (gen !== this.generation) {
            // Cancelled while the microphone was opening.
            try { await this.capture?.stop(); } catch { /* ignore */ }
            this.capture = null;
            return;
        }
        this.state = 'recording';
        this.notify('recording');
        this.timer = (this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
            if (gen === this.generation && this.state === 'recording') void this.stop();
        }, maxMs);
    }

    private async stop(): Promise<void> {
        if (this.state !== 'recording') return;
        const gen = this.generation;
        this.state = 'transcribing';
        if (this.timer !== null) {
            (this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
            this.timer = null;
        }
        const capture = this.capture;
        this.capture = null;
        try { await capture?.stop(); } catch { /* the mic is closing anyway */ }
        const live = this.live;
        this.live = null;
        try {
            if (!this.audio.frames.length) {
                live?.dispose();
                this.notify(this.captureError ? 'mic-failed' : 'nothing-heard');
                return;
            }
            if (!this.heardSpeech) {
                // Nothing above the speech level: no audio leaves the machine for silence.
                live?.dispose();
                this.notify('nothing-heard');
                return;
            }
            let raw = '';
            try {
                if (!live) throw new Error('no live session');
                raw = await live.finish();
            } catch (liveErr) {
                this.log(`live transcription failed (${(liveErr as Error)?.message}); transcribing the recording instead`);
                const clip = clipOf(this.audio, this.startedAt);
                if (!clip) { this.notify('nothing-heard'); return; }
                try {
                    raw = await this.deps.transcribeClip(clip);
                } catch (err) {
                    this.log(`no transcriber could: ${(err as Error)?.message}`);
                    this.notify('transcribe-failed');
                    return;
                }
            }
            if (!raw.trim()) {
                this.notify('nothing-heard');
                return;
            }
            let text = raw.trim();
            try {
                const cleaned = await this.deps.format(text);
                if (typeof cleaned === 'string' && cleaned.trim()) text = cleaned.trim();
            } catch { /* the raw words */ }
            if (gen !== this.generation) return; // cancelled meanwhile: no output
            this.deps.writeClipboard(text);
            this.notify('copied');
        } finally {
            this.audio = { frames: [], totalMs: 0 };
            this.state = 'idle';
        }
    }

    /** Drops a dictation in progress without output (the setting turned off, the app quitting). */
    cancel(): void {
        this.generation++;
        if (this.timer !== null) {
            (this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
            this.timer = null;
        }
        const capture = this.capture;
        this.capture = null;
        try { void capture?.stop(); } catch { /* ignore */ }
        this.live?.dispose();
        this.live = null;
        this.audio = { frames: [], totalMs: 0 };
        if (this.state !== 'transcribing') this.state = 'idle';
    }
}
