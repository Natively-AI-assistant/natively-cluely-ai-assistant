/**
 * SonioxStreamingSTT - WebSocket-based streaming Speech-to-Text using Soniox
 *
 * Implements the same EventEmitter interface as GoogleSTT / DeepgramStreamingSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk), setSampleRate(), setAudioChannelCount()
 *
 * Connects to wss://stt-rt.soniox.com/transcribe-websocket
 * Sends raw PCM (linear16, 16-bit LE) over WebSocket.
 * Receives token-based transcription results with is_final flags.
 *
 * Key features:
 *   - 60+ language auto-detection
 *   - Language hints for multilingual accuracy
 *   - Endpoint detection for auto-finalization on speech pauses
 *   - Up to 8000-token structured context for domain-specific terms
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES } from '../config/languages';

const SONIOX_WEBSOCKET_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const KEEPALIVE_INTERVAL_MS = 15000;

export class SonioxStreamingSTT extends EventEmitter {
    private apiKey: string;
    private ws: WebSocket | null = null;
    private isActive = false;
    private shouldReconnect = false;
    private configSent = false;

    private sampleRate = 16000;
    private numChannels = 1;

    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private keepAliveTimer: NodeJS.Timeout | null = null;

    // Accumulated final tokens for building transcript text
    private pendingFinalText = '';

    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }

    // =========================================================================
    // Configuration (match GoogleSTT / DeepgramStreamingSTT interface)
    // =========================================================================

    public setSampleRate(rate: number): void {
        this.sampleRate = rate;
        console.log(`[SonioxStreaming] Sample rate set to ${rate}`);
    }

    public setAudioChannelCount(count: number): void {
        this.numChannels = count;
        console.log(`[SonioxStreaming] Channel count set to ${count}`);
    }

    private languageCode?: string;

    /** Set recognition language hint using ISO-639-1 code */
    public setRecognitionLanguage(key: string): void {
        const config = RECOGNITION_LANGUAGES[key];
        if (config) {
            this.languageCode = config.iso639;
            console.log(`[SonioxStreaming] Language hint set to ${this.languageCode}`);

            if (this.isActive) {
                console.log('[SonioxStreaming] Language changed while active. Restarting...');
                this.stop();
                this.start();
            }
        } else if (key === 'auto') {
            this.languageCode = undefined;
            console.log(`[SonioxStreaming] Language hint set to auto`);
        }
    }

    /** No-op — no Google credentials needed */
    public setCredentials(_path: string): void { }

    /**
     * No-op for keywords — Soniox uses structured context instead.
     * Context is set via the initial config message.
     */
    public setKeywords(_keywords: string[]): void { }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    public start(): void {
        if (this.isActive) return;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.connect();
    }

    public stop(): void {
        this.shouldReconnect = false;
        this.clearTimers();

        if (this.ws) {
            try {
                // Send empty string to signal end-of-audio
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send('');
                }
            } catch {
                // Ignore send errors during shutdown
            }
            this.ws.close();
            this.ws = null;
        }

        this.isActive = false;
        this.configSent = false;
        this.pendingFinalText = '';
        console.log('[SonioxStreaming] Stopped');
    }

    // =========================================================================
    // Audio Data
    // =========================================================================

    /**
     * Write raw PCM audio data (linear16, 16-bit LE).
     * Do NOT include a WAV header — Soniox WebSocket expects raw PCM.
     */
    public write(chunk: Buffer): void {
        if (!this.isActive || !this.ws || !this.configSent) return;

        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(chunk);
        }
    }

    // =========================================================================
    // WebSocket Connection
    // =========================================================================

    private connect(): void {
        console.log(`[SonioxStreaming] Connecting (rate=${this.sampleRate}, ch=${this.numChannels})...`);

        this.configSent = false;
        this.pendingFinalText = '';
        this.ws = new WebSocket(SONIOX_WEBSOCKET_URL);

        this.ws.on('open', () => {
            this.isActive = true;
            this.reconnectAttempts = 0;
            console.log('[SonioxStreaming] Connected, sending config...');

            // Send initial configuration as first message
            const config: any = {
                api_key: this.apiKey,
                model: 'stt-rt-v4',
                audio_format: 'pcm_s16le',
                sample_rate: this.sampleRate,
                num_channels: this.numChannels,
                enable_language_identification: true,
            };

            if (this.languageCode) {
                config.languages = [this.languageCode];
            }

            try {
                this.ws!.send(JSON.stringify(config));
                this.configSent = true;
                console.log('[SonioxStreaming] Config sent');
            } catch (err) {
                console.error('[SonioxStreaming] Failed to send config:', err);
            }

            // Start keep-alive pings
            this.startKeepAlive();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());

                // Error from server
                if (msg.error_code) {
                    console.error(`[SonioxStreaming] Server error: ${msg.error_code} - ${msg.error_message}`);
                    this.emit('error', new Error(`Soniox: ${msg.error_code} - ${msg.error_message}`));
                    return;
                }

                // Parse tokens from response
                const tokens = msg.tokens;
                if (!tokens || !Array.isArray(tokens) || tokens.length === 0) return;

                // Separate final and non-final tokens
                let newFinalText = '';
                let nonFinalText = '';

                for (const token of tokens) {
                    if (!token.text) continue;

                    if (token.is_final) {
                        newFinalText += token.text;
                    } else {
                        nonFinalText += token.text;
                    }
                }

                // Accumulate final text
                if (newFinalText) {
                    this.pendingFinalText += newFinalText;
                }

                // Emit non-final (interim) transcript for live display
                if (nonFinalText.trim()) {
                    const interimText = (this.pendingFinalText + nonFinalText).trim();
                    if (interimText) {
                        this.emit('transcript', {
                            text: interimText,
                            isFinal: false,
                            confidence: 1.0,
                        });
                    }
                }

                // On endpoint detection (all tokens finalized), emit the final transcript
                // Soniox signals endpoint when all pending tokens become final
                // We detect this when we get final tokens and no non-final tokens remain
                if (this.pendingFinalText.trim() && !nonFinalText) {
                    this.emit('transcript', {
                        text: this.pendingFinalText.trim(),
                        isFinal: true,
                        confidence: 1.0,
                    });
                    this.pendingFinalText = '';
                }

                // Session finished
                if (msg.finished) {
                    // Flush any remaining final text
                    if (this.pendingFinalText.trim()) {
                        this.emit('transcript', {
                            text: this.pendingFinalText.trim(),
                            isFinal: true,
                            confidence: 1.0,
                        });
                        this.pendingFinalText = '';
                    }
                    console.log('[SonioxStreaming] Session finished');
                }
            } catch (err) {
                console.error('[SonioxStreaming] Parse error:', err);
            }
        });

        this.ws.on('error', (err: Error) => {
            console.error('[SonioxStreaming] WebSocket error:', err.message);
            this.emit('error', err);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
            this.isActive = false;
            this.configSent = false;
            this.clearKeepAlive();
            console.log(`[SonioxStreaming] Closed (code=${code}, reason=${reason.toString()})`);

            // Auto-reconnect on unexpected close
            if (this.shouldReconnect && code !== 1000) {
                this.scheduleReconnect();
            }
        });
    }

    // =========================================================================
    // Reconnection
    // =========================================================================

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;

        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_DELAY_MS
        );
        this.reconnectAttempts++;

        console.log(`[SonioxStreaming] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

        this.reconnectTimer = setTimeout(() => {
            if (this.shouldReconnect) {
                this.connect();
            }
        }, delay);
    }

    // =========================================================================
    // Keep-alive
    // =========================================================================

    private startKeepAlive(): void {
        this.clearKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                try {
                    this.ws.ping();
                } catch {
                    // Ignore errors
                }
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    private clearKeepAlive(): void {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    private clearTimers(): void {
        this.clearKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
