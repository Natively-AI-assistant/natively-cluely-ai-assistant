import { SpeechClient } from '@google-cloud/speech';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { RECOGNITION_LANGUAGES, EnglishVariant, googleAutoDetectAlternates } from '../config/languages';

/**
 * GoogleSTT
 * 
 * Manages a bi-directional streaming connection to Google Speech-to-Text.
 * Mirrors the logic previously in Swift:
 * - Handles infinite stream limits by restarting periodically (though less critical for short calls).
 * - Manages authentication via GOOGLE_APPLICATION_CREDENTIALS.
 * - Parses intermediate and final results.
 */
export class GoogleSTT extends EventEmitter {
    private client: SpeechClient;
    private stream: any = null; // Stream type is complex in google-cloud libs
    private isStreaming = false;
    private isActive = false;
    private isFatalError = false;
    private label = 'default';
    private writeCount = 0;

    // Diagnostic raw-PCM dump. Opt-in via NATIVELY_STT_DUMP=1. Captures the
    // EXACT bytes forwarded to Google's gRPC stream (post keepalive-drop), so
    // we can play the file back and hear what Google actually receives —
    // settling "is the audio garbled or is Google misconfigured?" empirically
    // rather than by inference. One raw file per channel; convert with:
    //   ffmpeg -f s16le -ar <rate> -ac 1 -i google_stt_<label>.raw out.wav
    private dumpStream: fs.WriteStream | null = null;
    private dumpBytes = 0;

    // gRPC permanent failure codes — retrying these is pointless.
    //   3  = INVALID_ARGUMENT (config the server will never accept)
    //   7  = PERMISSION_DENIED (API not enabled / wrong project / no IAM)
    //   16 = UNAUTHENTICATED (bad/expired credentials)
    private static readonly PERMANENT_GRPC_CODES = new Set([3, 7, 16]);

    // Config
    private encoding = 'LINEAR16' as const;
    private sampleRateHertz = 16000;
    private audioChannelCount = 1; // Default to Mono
    private languageCode = 'en-US';
    private alternativeLanguageCodes: string[] = ['en-IN', 'en-GB']; // Default fallbacks

    // Auto-detect mode: Google identifies the language per utterance, but
    // primary-language recognition is faster and more accurate than the
    // alternativeLanguageCodes path. Track the per-result languageCode and
    // re-pin the primary once the speaker has clearly switched languages.
    private autoMode = false;
    private languageMismatchStreak = 0;
    private static readonly LANGUAGE_REPIN_FINALS = 2;

    constructor(label?: string) {
        super();
        if (label) this.label = label;
        // ... (credentials setup) ...

        // Note: In production, credentials are set by main.ts via process.env.GOOGLE_APPLICATION_CREDENTIALS
        // or passed explicitly to setCredentials(). We do not load .env files here to avoid ASAR path issues.
        const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (!credentialsPath) {
            console.error(`[GoogleSTT/${this.label}] Missing GOOGLE_APPLICATION_CREDENTIALS in environment. Checked CWD:`, process.cwd());
        } else {
            console.log(`[GoogleSTT/${this.label}] Using credentials from: ${credentialsPath}`);
        }

        this.client = new SpeechClient({
            keyFilename: credentialsPath
        });
    }

    public setCredentials(keyFilePath: string): void {
        console.log(`[GoogleSTT/${this.label}] Updating credentials to: ${keyFilePath}`);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFilePath;
        this.client = new SpeechClient({
            keyFilename: keyFilePath
        });
    }

    public setSampleRate(rate: number): void {
        if (this.sampleRateHertz === rate) return;
        console.log(`[GoogleSTT/${this.label}] Updating Sample Rate to: ${rate}Hz`);
        this.sampleRateHertz = rate;
        if (this.isStreaming || this.isActive) {
            console.warn(`[GoogleSTT/${this.label}] Config changed while active. Restarting stream...`);
            this.stop();
            this.start();
        }
    }

    /**
     * No-op for GoogleSTT — Google handles VAD server-side.
     * This method exists for interface consistency with RestSTT so that
     * main.ts can call notifySpeechEnded() without type-casting to `any`.
     */
    public notifySpeechEnded(): void {
        // Intentionally empty. Google STT detects speech boundaries server-side.
    }

    public setAudioChannelCount(count: number): void {
        if (this.audioChannelCount === count) return;
        console.log(`[GoogleSTT/${this.label}] Updating Channel Count to: ${count}`);
        this.audioChannelCount = count;
        if (this.isStreaming || this.isActive) {
            console.warn(`[GoogleSTT/${this.label}] Config changed while active. Restarting stream...`);
            this.stop();
            this.start();
        }
    }

    private pendingLanguageChange?: NodeJS.Timeout;

    public setRecognitionLanguage(key: string): void {
        // Debounce to prevent rapid restarts (e.g. scrolling through list)
        if (this.pendingLanguageChange) {
            clearTimeout(this.pendingLanguageChange);
        }

        this.pendingLanguageChange = setTimeout(() => {
            if (key === 'auto') {
                // Google STT v1 supports up to 3 alternativeLanguageCodes.
                // Use en-US as primary with the user's OS preferred languages
                // as alternates (fr/es/de only as fill when none match).
                let preferred: string[] = [];
                try {
                    preferred = require('electron').app.getPreferredSystemLanguages();
                } catch { /* unavailable in tests / before app ready */ }
                this.languageCode = 'en-US';
                this.alternativeLanguageCodes = googleAutoDetectAlternates(preferred);
                this.autoMode = true;
                this.languageMismatchStreak = 0;
                console.log(`[GoogleSTT/${this.label}] Language set to auto-detect (en-US + ${this.alternativeLanguageCodes.join('/')} alternates)`);
            } else {
                const config = RECOGNITION_LANGUAGES[key];
                if (!config) {
                    console.warn(`[GoogleSTT/${this.label}] Unknown language key: ${key}`);
                    return;
                }

                console.log(`[GoogleSTT/${this.label}] Updating recognition language to: ${key} (${config.bcp47})`);
                this.languageCode = config.bcp47;
                this.autoMode = false;
                this.languageMismatchStreak = 0;

                if ('alternates' in config) {
                    this.alternativeLanguageCodes = (config as EnglishVariant).alternates;
                } else {
                    this.alternativeLanguageCodes = [];
                }

                console.log(`[GoogleSTT/${this.label}] Primary:`, this.languageCode);
                if (this.alternativeLanguageCodes.length > 0) {
                    console.log(`[GoogleSTT/${this.label}] Alternates:`, this.alternativeLanguageCodes.join(', '));
                }
            }

            // Restart if active. swapStream (not stop()+start()) so the old
            // stream flushes the final of whatever was being said when the
            // language changed instead of destroying it mid-flight.
            if (this.isActive) {
                console.log(`[GoogleSTT/${this.label}] Language changed while active. Swapping stream...`);
                this.swapStream();
            }

            this.pendingLanguageChange = undefined;
        }, 250);
    }

    public start(): void {
        if (this.isActive) return;
        this.isActive = true;
        this.isFatalError = false;
        this.writeCount = 0;

        this.openDumpStream();

        console.log(`[GoogleSTT/${this.label}] Starting recognition stream (rate=${this.sampleRateHertz}Hz, ch=${this.audioChannelCount})...`);
        this.startStream();
    }

    /** Opt-in diagnostic: open a raw-PCM dump of the exact bytes sent to Google. */
    private openDumpStream(): void {
        if (process.env.NATIVELY_STT_DUMP !== '1' || this.dumpStream) return;
        try {
            const file = path.join(os.homedir(), `google_stt_${this.label}_${this.sampleRateHertz}hz.raw`);
            this.dumpStream = fs.createWriteStream(file);
            this.dumpBytes = 0;
            console.log(`[GoogleSTT/${this.label}] 🎙️  PCM dump OPEN → ${file} (play: ffmpeg -f s16le -ar ${this.sampleRateHertz} -ac ${this.audioChannelCount} -i "${file}" out.wav)`);
        } catch (e) {
            console.error(`[GoogleSTT/${this.label}] Failed to open PCM dump:`, e);
        }
    }

    private closeDumpStream(): void {
        if (!this.dumpStream) return;
        try { this.dumpStream.end(); } catch { /* ignore */ }
        console.log(`[GoogleSTT/${this.label}] 🎙️  PCM dump CLOSED (${this.dumpBytes} bytes ≈ ${(this.dumpBytes / 2 / Math.max(1, this.sampleRateHertz)).toFixed(1)}s @ ${this.sampleRateHertz}Hz)`);
        this.dumpStream = null;
    }

    public stop(): void {
        if (!this.isActive) return;

        console.log(`[GoogleSTT/${this.label}] Stopping stream (wrote ${this.writeCount} chunks total)...`);
        this.isActive = false;
        this.isStreaming = false;

        if (this.proactiveRestartTimer) {
            clearTimeout(this.proactiveRestartTimer);
            this.proactiveRestartTimer = null;
        }

        // Clear any in-flight 250ms language-change debounce. Without this,
        // a user who changes language right before clicking Stop would have
        // the debounce body fire ~250ms after endMeeting() — the body would
        // see isStreaming=false and isActive=false (so it skips the
        // stop()+start() restart), BUT the timer's libuv slot survives, and
        // more importantly the closed-over `key` lock could leak the
        // language alternates into a NEXT session if start() runs before the
        // timer fires. Cancelling here keeps the next meeting's language
        // state clean.
        if (this.pendingLanguageChange) {
            clearTimeout(this.pendingLanguageChange);
            this.pendingLanguageChange = undefined;
        }

        if (this.stream) {
            this.stream.end();
            this.stream.destroy();
            this.stream = null;
        }

        this.closeDumpStream();
    }

    public finalize(): void {
        if (!this.isActive || !this.stream) return;
        console.log(`[GoogleSTT/${this.label}] Finalize — ending gRPC stream to flush final transcript`);
        try {
            this.stream.end();
        } catch (err) {
            console.error(`[GoogleSTT/${this.label}] Finalize end() failed:`, err);
        }
        this.isStreaming = false;
        this.stream = null;
    }

    private buffer: Buffer[] = [];
    private isConnecting = false;
    private lastConnectAttempt = 0;

    // Google's streamingRecognize hard-kills any stream after 305 seconds.
    // We proactively restart at 4:30 (270s) to prevent the forced close from
    // causing a 1-second gap in transcription during long interviews.
    private proactiveRestartTimer: NodeJS.Timeout | null = null;
    private static readonly PROACTIVE_RESTART_MS = 270_000; // 4 min 30 sec

    /**
     * True only if every byte of the chunk is zero (a Rust-DSP keepalive frame).
     * Scans the whole buffer — never strided — so a chunk containing even one
     * non-zero sample of real audio is never misclassified as silence and dropped.
     * Chunks are ≤5760 bytes and arrive every 20–60ms, so a full scan is cheap.
     */
    private isAllZeroChunk(buf: Buffer): boolean {
        if (buf.length === 0) return true;
        for (let i = 0; i < buf.length; i++) {
            if (buf[i] !== 0) return false;
        }
        return true;
    }

    public write(audioData: Buffer): void {
        if (!this.isActive || this.isFatalError) {
            // Only log occasionally to avoid spam
            if (this.writeCount === 0) console.warn(`[GoogleSTT/${this.label}] write() called but isActive=false — data dropped`);
            return;
        }

        // Drop pure zero-fill keepalive frames injected by the Rust DSP
        // (FrameAction::SendSilence → vec![0u8; chunk_size*2]). For system audio
        // the suppressor runs with VAD disabled and a permissive RMS floor, so it
        // oscillates between real low-amplitude Send frames and these silent
        // keepalives. Google's streamingRecognize (unlike Deepgram/Natively, which
        // endpoint cleanly on silence) hallucinates tiny interim fragments —
        // "he", "heh", "hehehe" — when real audio is interleaved with zero frames.
        // Google holds the gRPC stream open on its own (10s idle timeout) and
        // write() lazily reconnects on the next real chunk, so the keepalive serves
        // no purpose here and only corrupts recognition. Real audio is never
        // bit-exactly zero (noise floor/dither), so an all-zero chunk is
        // unambiguously a keepalive.
        if (this.isAllZeroChunk(audioData)) return;

        // Diagnostic: capture the exact non-keepalive bytes handed to Google.
        if (this.dumpStream) {
            try { this.dumpStream.write(audioData); this.dumpBytes += audioData.length; } catch { /* ignore */ }
        }

        this.writeCount++;

        if (!this.isStreaming || !this.stream) {
            // Buffer if we are in connecting state, just started, or closed
            this.buffer.push(audioData);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size

            if (!this.isConnecting) {
                if (Date.now() - this.lastConnectAttempt > 1000) {
                    console.log(`[GoogleSTT/${this.label}] Stream not ready (write #${this.writeCount}). Lazy connecting on new audio...`);
                    this.startStream();
                }
            }
            return;
        }

        // Safety check to prevent "write after destroyed" error
        if (this.stream.destroyed) {
            this.isStreaming = false;
            this.stream = null;
            this.buffer.push(audioData);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size

            if (!this.isConnecting) {
                if (Date.now() - this.lastConnectAttempt > 1000) {
                    console.log(`[GoogleSTT/${this.label}] Stream destroyed (write #${this.writeCount}). Lazy reconnecting...`);
                    this.startStream();
                }
            }
            return;
        }

        try {
            // Log first 5 writes always, then every ~50th
            if (this.writeCount <= 5 || Math.random() < 0.02) {
                console.log(`[GoogleSTT/${this.label}] Writing ${audioData.length} bytes to stream (write #${this.writeCount}, isStreaming=${this.isStreaming})`);
            }

            if (this.stream.writable) {
                this.stream.write(audioData);
            } else {
                console.warn(`[GoogleSTT/${this.label}] Stream not writable! (write #${this.writeCount})`);
            }
        } catch (err) {
            console.error(`[GoogleSTT/${this.label}] Safe write failed:`, err);
            this.isStreaming = false;
        }
    }

    private flushBuffer(): void {
        if (!this.stream) return;

        while (this.buffer.length > 0) {
            if (!this.stream.writable) {
                console.warn(`[GoogleSTT/${this.label}] flushBuffer: stream not writable — ${this.buffer.length} chunks re-queued`);
                break; // Leave remaining chunks in buffer for next stream
            }
            const data = this.buffer.shift();
            if (data) {
                try {
                    this.stream.write(data);
                } catch (e) {
                    console.error(`[GoogleSTT/${this.label}] Failed to flush buffer chunk:`, e);
                    break;
                }
            }
        }
    }

    /**
     * Auto mode: when consecutive FINAL results come back in a non-primary
     * language, the speaker has switched — re-pin the stream so the detected
     * language becomes primary (the old primary joins the alternates).
     * Alternates are kept so a later switch back re-pins again.
     */
    private maybeRepinLanguage(rawDetected?: string): void {
        if (!this.autoMode || !rawDetected) return;
        // Google returns lowercase codes (e.g. 'ru-ru') — canonicalize against
        // our language table; anything unknown is ignored.
        const detected = Object.values(RECOGNITION_LANGUAGES)
            .find(l => l.bcp47.toLowerCase() === rawDetected.toLowerCase())?.bcp47;
        if (!detected) return;

        if (detected === this.languageCode) {
            this.languageMismatchStreak = 0;
            return;
        }
        if (++this.languageMismatchStreak < GoogleSTT.LANGUAGE_REPIN_FINALS) return;
        this.languageMismatchStreak = 0;

        const alternates = [this.languageCode, ...this.alternativeLanguageCodes]
            .filter(l => l !== detected)
            .slice(0, 3);
        console.log(`[GoogleSTT/${this.label}] Auto mode: re-pinning primary language ${this.languageCode} → ${detected} (alternates: ${alternates.join('/')})`);
        this.languageCode = detected;
        this.alternativeLanguageCodes = alternates;
        this.swapStream();
    }

    /**
     * Replace the live gRPC stream without dropping the tail: end() the old
     * stream (no destroy) so Google flushes its pending finals — the stale
     * guards in the event handlers keep those late events from clobbering the
     * new stream's state — and start the new stream immediately; audio that
     * arrives during the swap is buffered and flushed by startStream().
     */
    private swapStream(): void {
        const old = this.stream;
        this.stream = null;
        this.isStreaming = false;
        if (old) {
            try { old.end(); } catch { /* flush-only — old stream is abandoned either way */ }
        }
        if (this.isActive) this.startStream();
    }

    private startStream(): void {
        this.lastConnectAttempt = Date.now();
        this.isStreaming = true;
        this.isConnecting = true;

        console.log(`[GoogleSTT/${this.label}] Creating gRPC stream (rate=${this.sampleRateHertz}Hz, ch=${this.audioChannelCount}, lang=${this.languageCode})...`);

        // Captured so each handler can tell whether it belongs to the CURRENT
        // stream. Without this guard, the old stream's async 'close'/'end'
        // events fire AFTER a restart has already created the new stream and
        // null out this.stream — audio then buffers until the lazy reconnect
        // in write() (throttled to 1/s) fires, losing 1s+ of transcription on
        // every language change and every 4:30 proactive restart.
        const s = this.client
            .streamingRecognize({
                config: {
                    encoding: this.encoding,
                    sampleRateHertz: this.sampleRateHertz,
                    audioChannelCount: this.audioChannelCount,
                    languageCode: this.languageCode,
                    enableAutomaticPunctuation: true,
                    model: 'latest_long',
                    useEnhanced: true,
                    alternativeLanguageCodes: this.alternativeLanguageCodes,
                },
                interimResults: true,
            })
            .on('error', (err: Error) => {
                if (this.stream !== s) {
                    // Stale event from a stream already replaced by swapStream()/
                    // restart — the abandoned stream erroring out (e.g. CANCELLED)
                    // must not clobber the new stream's state or alarm main.ts.
                    return;
                }
                this.isConnecting = false;
                this.isStreaming = false;
                this.stream = null;

                const grpcCode = (err as any)?.code;

                // Google's streamingRecognize closes the stream with code 11
                // ("Audio Timeout Error: Long duration elapsed without audio")
                // after ~10s of silence. The lazy-reconnect path in write()
                // recovers automatically on the next chunk, so this is benign
                // and recurs every silent stretch. Log a single warn line and
                // do NOT re-emit as an error — bubbling it up trips the
                // consecutive-error counter in main.ts and spams the renderer
                // with reconnecting/failed STT status updates during normal
                // silence.
                const isIdleTimeout = grpcCode === 11
                    || /Audio Timeout Error/i.test(err.message || '');
                if (isIdleTimeout) {
                    console.warn(`[GoogleSTT/${this.label}] Stream idle-timed-out (Google's 10s no-audio limit), reconnecting on next chunk.`);
                    return;
                }

                console.error(`[GoogleSTT/${this.label}] Stream error:`, err);

                if (typeof grpcCode === 'number' && GoogleSTT.PERMANENT_GRPC_CODES.has(grpcCode)) {
                    // Permanent failure — stop the write()-driven reconnect loop. Without this
                    // guard, a misconfigured Google project (e.g. Speech API not enabled →
                    // PERMISSION_DENIED) loops forever at ~1 reconnect/sec for the whole
                    // session. See issue #171.
                    console.error(
                        `[GoogleSTT/${this.label}] Permanent gRPC error (code ${grpcCode}) — ` +
                        `disabling STT for this session. No further retries.`
                    );
                    this.isFatalError = true;
                    if (this.proactiveRestartTimer) {
                        clearTimeout(this.proactiveRestartTimer);
                        this.proactiveRestartTimer = null;
                    }
                }

                this.emit('error', err);
            })
            .on('end', () => {
                if (this.stream !== s) return; // stale — a newer stream owns the state
                console.log(`[GoogleSTT/${this.label}] Stream ended server-side (idle timeout)`);
                this.isConnecting = false;
                this.isStreaming = false;
                this.stream = null;
            })
            .on('close', () => {
                if (this.stream !== s) return; // stale — a newer stream owns the state
                console.log(`[GoogleSTT/${this.label}] Stream closed server-side`);
                this.isConnecting = false;
                this.isStreaming = false;
                this.stream = null;
            })
            .on('data', (data: any) => {
                if (data.results[0] && data.results[0].alternatives[0]) {
                    const result = data.results[0];
                    const alt = result.alternatives[0];
                    const transcript = alt.transcript;
                    const isFinal = result.isFinal;

                    if (transcript) {
                        console.log(`[GoogleSTT/${this.label}] Transcript received`, { final: isFinal, length: transcript.length });
                        // Late finals from an abandoned stream are still real
                        // speech (the tail from before a swap) — always forward.
                        this.emit('transcript', {
                            text: transcript,
                            isFinal,
                            confidence: alt.confidence
                        });
                    }

                    // Only the CURRENT stream may trigger a language re-pin —
                    // a stale stream's finals describe pre-swap speech.
                    if (isFinal && this.stream === s) {
                        this.maybeRepinLanguage(result.languageCode);
                    }
                }
            });

        this.stream = s;

        // gRPC streams are writable immediately — no handshake needed.
        const bufferedCount = this.buffer.length;
        this.isConnecting = false;
        this.flushBuffer();

        console.log(`[GoogleSTT/${this.label}] Stream created. Flushed ${bufferedCount} buffered chunks. Waiting for events...`);

        // Schedule proactive restart before Google's 305-second hard limit.
        // Without this, the server closes the stream at 305s causing up to 1s of
        // lost audio until the lazy reconnect in write() fires.
        if (this.proactiveRestartTimer) clearTimeout(this.proactiveRestartTimer);
        this.proactiveRestartTimer = setTimeout(() => {
            this.proactiveRestartTimer = null;
            if (!this.isActive) return;
            console.log(`[GoogleSTT/${this.label}] Proactive stream restart at 4:30 to preempt Google's 305s limit`);
            // swapStream (end without destroy) lets the old stream flush its
            // pending finals instead of killing them mid-flight; the stale
            // guards keep its late events away from the new stream's state.
            this.swapStream();
        }, GoogleSTT.PROACTIVE_RESTART_MS);
    }
}
