import { SpeechClient } from '@google-cloud/speech';
import { EventEmitter } from 'events';
import * as path from 'path';
import { RECOGNITION_LANGUAGES, EnglishVariant } from '../config/languages';

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
    private label = 'default';
    private writeCount = 0;

    // Config
    private encoding = 'LINEAR16' as const;
    private sampleRateHertz = 16000;
    private audioChannelCount = 1; // Default to Mono
    private languageCode = 'en-US';
    private alternativeLanguageCodes: string[] = ['en-IN', 'en-GB']; // Default fallbacks

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
                // Use en-US as primary with the most common languages as alternates.
                this.languageCode = 'en-US';
                this.alternativeLanguageCodes = ['fr-FR', 'es-ES', 'de-DE'];
                console.log(`[GoogleSTT/${this.label}] Language set to auto-detect (en-US + fr/es/de alternates)`);
            } else {
                const config = RECOGNITION_LANGUAGES[key];
                if (!config) {
                    console.warn(`[GoogleSTT/${this.label}] Unknown language key: ${key}`);
                    return;
                }

                console.log(`[GoogleSTT/${this.label}] Updating recognition language to: ${key} (${config.bcp47})`);
                this.languageCode = config.bcp47;

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

            // Restart if active
            if (this.isStreaming || this.isActive) {
                console.log(`[GoogleSTT/${this.label}] Language changed while active. Restarting stream...`);
                this.stop();
                this.start();
            }

            this.pendingLanguageChange = undefined;
        }, 250);
    }

    public start(): void {
        if (this.isActive) return;
        this.isActive = true;
        this.writeCount = 0;

        console.log(`[GoogleSTT/${this.label}] Starting recognition stream (rate=${this.sampleRateHertz}Hz, ch=${this.audioChannelCount})...`);
        this.startStream();
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

        if (this.stream) {
            this.stream.end();
            this.stream.destroy();
            this.stream = null;
        }
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

    public write(audioData: Buffer): void {
        if (!this.isActive) {
            // Only log occasionally to avoid spam
            if (this.writeCount === 0) console.warn(`[GoogleSTT/${this.label}] write() called but isActive=false — data dropped`);
            return;
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

    private startStream(): void {
        this.lastConnectAttempt = Date.now();
        this.isStreaming = true;
        this.isConnecting = true;

        console.log(`[GoogleSTT/${this.label}] Creating gRPC stream (rate=${this.sampleRateHertz}Hz, ch=${this.audioChannelCount}, lang=${this.languageCode})...`);

        this.stream = this.client
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
                console.error(`[GoogleSTT/${this.label}] Stream error:`, err);
                this.emit('error', err);
                this.isConnecting = false;
                this.isStreaming = false;
                this.stream = null;
            })
            .on('end', () => {
                console.log(`[GoogleSTT/${this.label}] Stream ended server-side (idle timeout)`);
                this.isConnecting = false;
                this.isStreaming = false;
                this.stream = null;
            })
            .on('close', () => {
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
                        console.log(`[GoogleSTT/${this.label}] Transcript (${isFinal ? 'final' : 'interim'}): "${transcript.substring(0, 60)}..."`);
                        this.emit('transcript', {
                            text: transcript,
                            isFinal,
                            confidence: alt.confidence
                        });
                    }
                }
            });

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
            if (this.stream) {
                this.stream.end();
                this.stream.destroy();
                this.stream = null;
            }
            this.isStreaming = false;
            this.startStream();
        }, GoogleSTT.PROACTIVE_RESTART_MS);
    }
}
