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
    
    private buffer: Buffer[] = [];
    private isConnecting = false;

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
        this.isConnecting = false;
        this.configSent = false;
        this.pendingFinalText = '';
        this.buffer = [];
        console.log('[SonioxStreaming] Stopped');
    }

    // =========================================================================
    // Audio Data
    // =========================================================================

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.configSent) {
            this.buffer.push(chunk);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size

            if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                console.log('[SonioxStreaming] WS not ready. Lazy connecting on new audio...');
                this.connect();
            }
            return;
        }

        this.ws.send(chunk);
    }

    public finalize(): void {
        if (!this.isActive || !this.ws || !this.configSent) return;

        if (this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({ type: 'finalize' }));
                console.log('[SonioxStreaming] Sent manual finalize message');
            } catch (err) {
                console.error('[SonioxStreaming] Failed to send finalize:', err);
            }
        }
    }

    // =========================================================================
    // WebSocket Connection
    // =========================================================================

    private connect(): void {
        if (this.isConnecting) return;
        this.isConnecting = true;
        
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
                enable_endpoint_detection: true,
            };

            if (this.languageCode) {
                config.language_hints = [this.languageCode];
            }

            try {
                this.ws!.send(JSON.stringify(config));
                this.configSent = true;
                this.isConnecting = false;
                console.log('[SonioxStreaming] Config sent');
                
                // Flush buffer after config is sent
                while (this.buffer.length > 0) {
                    const chunk = this.buffer.shift();
                    if (chunk && this.ws?.readyState === WebSocket.OPEN) {
                        this.ws.send(chunk);
                    }
                }
            } catch (err) {
                console.error('[SonioxStreaming] Failed to send config:', err);
                this.isConnecting = false;
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

                let currentFinalText = '';
                let nonFinalText = '';

                for (const token of tokens) {
                    if (!token.text) continue;

                    if (token.text === '<fin>') {
                        console.log('[SonioxStreaming] Received <fin> manual finalization marker');
                        continue;
                    }

                    if (token.text === '<end>') {
                        console.log('[SonioxStreaming] Received <end> endpoint detection marker');
                        continue;
                    }

                    if (token.is_final) {
                        currentFinalText += token.text;
                    } else {
                        nonFinalText += token.text;
                    }
                }

                // 1. Emit final tokens immediately
                if (currentFinalText) {
                    this.emit('transcript', {
                        text: currentFinalText,
                        isFinal: true,
                        confidence: 1.0,
                    });
                }

                // 2. Emit non-final tokens as interim (live preview)
                if (nonFinalText) {
                    this.emit('transcript', {
                        text: nonFinalText,
                        isFinal: false,
                        confidence: 1.0,
                    });
                }

                // Session finished
                if (msg.finished) {
                    console.log('[SonioxStreaming] Session finished');
                    // We don't stop entirely, just clear WS so it can lazily reconnect on next audio
                    if (this.ws) {
                        this.ws.close();
                        this.ws = null;
                        this.configSent = false;
                    }
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
            // Do not force isActive=false; let write() trigger reconnect if isActive is still true
            this.isConnecting = false;
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
            this.reconnectTimer = null;
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
