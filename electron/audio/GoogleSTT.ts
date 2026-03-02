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

    // Config
    private encoding = 'LINEAR16' as const;
    private sampleRateHertz = 16000;
    private audioChannelCount = 1; // Default to Mono
    private languageCode = 'en-US';
    private alternativeLanguageCodes: string[] = ['en-IN', 'en-GB']; // Default fallbacks

    constructor() {
        super();
        // ... (credentials setup) ...

        // Note: In production, credentials are set by main.ts via process.env.GOOGLE_APPLICATION_CREDENTIALS
        // or passed explicitly to setCredentials(). We do not load .env files here to avoid ASAR path issues.
        const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (!credentialsPath) {
            console.error('[GoogleSTT] Missing GOOGLE_APPLICATION_CREDENTIALS in environment. Checked CWD:', process.cwd());
        } else {
            console.log(`[GoogleSTT] Using credentials from: ${credentialsPath}`);
        }

        this.client = new SpeechClient({
            keyFilename: credentialsPath
        });
    }

    public setCredentials(keyFilePath: string): void {
        console.log(`[GoogleSTT] Updating credentials to: ${keyFilePath}`);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFilePath;
        this.client = new SpeechClient({
            keyFilename: keyFilePath
        });
    }

    public setSampleRate(rate: number): void {
        if (this.sampleRateHertz === rate) return;
        console.log(`[GoogleSTT] Updating Sample Rate to: ${rate}Hz`);
        this.sampleRateHertz = rate;
        if (this.isStreaming) {
            console.warn('[GoogleSTT] Config changed while streaming. Restarting stream...');
            this.stop();
            this.start();
        }
    }

    public setAudioChannelCount(count: number): void {
        if (this.audioChannelCount === count) return;
        console.log(`[GoogleSTT] Updating Channel Count to: ${count}`);
        this.audioChannelCount = count;
        if (this.isStreaming) {
            console.warn('[GoogleSTT] Config changed while streaming. Restarting stream...');
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
            const config = RECOGNITION_LANGUAGES[key];
            if (!config) {
                console.warn(`[GoogleSTT] Unknown language key: ${key}`);
                return;
            }

            console.log(`[GoogleSTT] Updating recognition language to: ${key} (${config.bcp47})`);

            // Update state
            this.languageCode = config.bcp47;
            
            // Handle variants (English specifically)
            if ('alternates' in config) {
                this.alternativeLanguageCodes = (config as EnglishVariant).alternates;
            } else {
                this.alternativeLanguageCodes = [];
            }

            console.log('[GoogleSTT] Primary:', this.languageCode);
            if (this.alternativeLanguageCodes.length > 0) {
                console.log('[GoogleSTT] Alternates:', this.alternativeLanguageCodes.join(', '));
            }

            // Restart if streaming
            if (this.isStreaming) {
                console.log('[GoogleSTT] Language changed while streaming. Restarting stream...');
                this.stop();
                this.start();
            }

            this.pendingLanguageChange = undefined;
        }, 250);
    }

    public start(): void {
        if (this.isStreaming) return;

        console.log('[GoogleSTT] Starting recognition stream...');
        this.startStream();
    }

    public stop(): void {
        if (!this.isStreaming) return;

        console.log('[GoogleSTT] Stopping stream...');
        this.isStreaming = false;
        if (this.stream) {
            this.stream.end();
            this.stream.destroy();
            this.stream = null;
        }
    }

    private buffer: Buffer[] = [];
    private isConnecting = false;

    public write(audioData: Buffer): void {
        if (!this.isStreaming || !this.stream) {
            // Buffer if we are in connecting state or just started
            if (this.isConnecting || this.isStreaming) {
                // console.log(`[GoogleSTT] Buffering ${audioData.length} bytes (Stream not ready)`);
                this.buffer.push(audioData);
            }
            return;
        }

        // Safety check to prevent "write after destroyed" error
        if (this.stream.destroyed) {
            this.isStreaming = false;
            this.stream = null;
            return;
        }

        try {
            // Debug log every ~50th write to avoid spam
            if (Math.random() < 0.02) {
                console.log(`[GoogleSTT] Writing ${audioData.length} bytes to stream`);
            }

            if (this.stream.command && this.stream.command.writable) {
                this.stream.write(audioData);
            } else if (this.stream.writable) {
                this.stream.write(audioData);
            } else {
                console.warn('[GoogleSTT] Stream not writable!');
            }
        } catch (err) {
            console.error('[GoogleSTT] Safe write failed:', err);
            this.isStreaming = false;
        }
    }

    private flushBuffer(): void {
        if (!this.stream) return;

        while (this.buffer.length > 0) {
            const data = this.buffer.shift();
            if (data) {
                try {
                    this.stream.write(data);
                } catch (e) {
                    console.error('[GoogleSTT] Failed to flush buffer chunk:', e);
                }
            }
        }
    }

    private startStream(): void {
        this.isStreaming = true;
        this.isConnecting = true;

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
                console.error('[GoogleSTT] Stream error:', err);
                this.emit('error', err);
                this.isConnecting = false;
            })
            .on('data', (data: any) => {
                // ... (existing data handler)
                if (data.results[0] && data.results[0].alternatives[0]) {
                    const result = data.results[0];
                    const alt = result.alternatives[0];
                    const transcript = alt.transcript;
                    const isFinal = result.isFinal;

                    if (transcript) {
                        this.emit('transcript', {
                            text: transcript,
                            isFinal,
                            confidence: alt.confidence
                        });
                    }
                }
            });

        // Initialize writeable check or wait for 'open'? 
        // gRPC streams are usually writeable immediately.
        // We can flush immediately after creation.
        this.isConnecting = false;
        this.flushBuffer();

        console.log('[GoogleSTT] Stream created. Waiting for events...');
    }
}
