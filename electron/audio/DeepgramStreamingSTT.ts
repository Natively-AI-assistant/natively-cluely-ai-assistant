/**
 * DeepgramStreamingSTT - SDK-based streaming Speech-to-Text using Deepgram Nova-3
 *
 * Uses @deepgram/sdk v3 (listen.live) instead of raw WebSocket.
 * Implements the same EventEmitter interface as GoogleSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk), setSampleRate(), setAudioChannelCount()
 */

import { EventEmitter } from 'events';
import { RECOGNITION_LANGUAGES } from '../config/languages';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;
const KEEPALIVE_INTERVAL_MS = 8000;

export class DeepgramStreamingSTT extends EventEmitter {
    private apiKey: string;
    private live: any = null;
    private isActive = false;
    private shouldReconnect = false;
    private isOpen = false; // tracks whether SDK connection is in OPEN state

    private sampleRate = 16000;
    private numChannels = 1;
    private languageCode = 'en';

    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    // 5s post-connect timer that resets reconnectAttempts so a clean
    // session doesn't inherit the prior session's backoff counter. The
    // setTimeout used to be untracked — its handle was thrown away —
    // which meant stop() could not cancel it. If stop()/restart fired
    // within the 5s window, the orphan timer would fire on the NEXT
    // session and clobber its reconnectAttempts to 0, defeating the
    // exponential backoff cap on a rapid-reconnect storm.
    private stabilityTimer: NodeJS.Timeout | null = null;
    private keepAliveInterval: NodeJS.Timeout | null = null;
    private buffer: Buffer[] = [];
    private isConnecting = false;
    // Opt-in provider diarization (#3). When on, Deepgram returns a per-word `speaker`
    // index; we surface it as a canonical speakerId on the transcript event so multiple
    // remote speakers can be distinguished. Default OFF — must never destabilize the
    // realtime path for users who don't enable it.
    private diarize = false;

    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }

    /** Enable/disable provider diarization. Restarts the stream if active (it's a connect param). */
    public setDiarization(enabled: boolean): void {
        if (this.diarize === enabled) return;
        this.diarize = enabled;
        console.log(`[DeepgramStreaming] Diarization ${enabled ? 'enabled' : 'disabled'}`);
        if (this.isActive) this.restartStream();
    }

    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        this.sampleRate = rate;
        console.log(`[DeepgramStreaming] Sample rate set to ${rate}`);
        if (this.isActive) this.restartStream();
    }

    public setAudioChannelCount(count: number): void {
        if (this.numChannels === count) return;
        this.numChannels = count;
        console.log(`[DeepgramStreaming] Channel count set to ${count}`);
        if (this.isActive) this.restartStream();
    }

    public setRecognitionLanguage(key: string): void {
        if (key === 'auto') {
            if (this.languageCode === 'multi') return;
            this.languageCode = 'multi';
            console.log('[DeepgramStreaming] Language set to multilingual (multi)');
            if (this.isActive) this.restartStream();
            return;
        }
        const config = RECOGNITION_LANGUAGES[key];
        if (config && this.languageCode !== config.iso639) {
            this.languageCode = config.iso639;
            console.log(`[DeepgramStreaming] Language set to ${this.languageCode}`);
            if (this.isActive) this.restartStream();
        }
    }

    public setCredentials(_path: string): void { }

    private restartStream(): void {
        console.log('[DeepgramStreaming] Restarting due to config change...');
        this.stop();
        this.start();
    }

    public start(): void {
        if (this.isActive) return;
        this.isActive = true;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.connect();
    }

    public stop(): void {
        this.shouldReconnect = false;
        this.clearTimers();

        if (this.live) {
            try {
                this.live.requestClose();
            } catch {
                // ignore errors during shutdown
            }
            this.live = null;
        }

        this.isActive = false;
        this.isConnecting = false;
        this.isOpen = false;
        this.buffer = [];
        console.log('[DeepgramStreaming] Stopped');
    }

    public finalize(): void {
        if (!this.isActive || !this.isOpen || !this.live) return;
        try {
            this.live.finalize();
            console.log('[DeepgramStreaming] Sent Finalize to flush server buffer');
        } catch (err: any) {
            console.error('[DeepgramStreaming] Finalize failed:', err?.message);
        }
    }

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.isOpen) {
            this.buffer.push(chunk);
            if (this.buffer.length > 500) this.buffer.shift();

            if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                this.connect();
            }
            return;
        }

        try {
            this.live.send(chunk);
        } catch (err: any) {
            console.error('[DeepgramStreaming] Send error:', err?.message);
        }
    }

    private connect(): void {
        if (this.isConnecting) return;
        this.isConnecting = true;

        console.log(`[DeepgramStreaming] Connecting (rate=${this.sampleRate}, ch=${this.numChannels}, lang=${this.languageCode})...`);

        try {
            const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

            const deepgram = createClient(this.apiKey);

            this.live = deepgram.listen.live({
                model: 'nova-3',
                language: this.languageCode,
                smart_format: true,
                interim_results: true,
                encoding: 'linear16',
                sample_rate: this.sampleRate,
                channels: this.numChannels,
                endpointing: 300,
                utterance_end_ms: 1000,
                vad_events: true,
                // Opt-in: ask Deepgram to tag each word with a speaker index.
                ...(this.diarize ? { diarize: true } : {}),
            });

            this.live.on(LiveTranscriptionEvents.Open, () => {
                this.isConnecting = false;
                this.isOpen = true;
                console.log('[DeepgramStreaming] Connected');

                // Register Transcript inside Open per SDK README pattern
                this.live.on(LiveTranscriptionEvents.Transcript, (data: any) => {
                    try {
                        const alt = data.channel?.alternatives?.[0];
                        const transcript = alt?.transcript;
                        const isFinal = data.is_final ?? false;
                        console.log(`[DeepgramStreaming] Transcript event`, { final: isFinal, length: transcript?.length ?? 0 });
                        if (!transcript) return;
                        // Opt-in diarization: derive the dominant speaker index across the words
                        // in this result and surface it as a canonical id (speaker_<n+1>). Only
                        // emitted when diarize is on AND a numeric speaker index is present, so
                        // the default payload shape is byte-for-byte unchanged for everyone else.
                        let speakerId: string | undefined;
                        if (this.diarize) {
                            const idx = dominantSpeakerIndex(alt?.words);
                            if (idx !== undefined) speakerId = `speaker_${idx + 1}`;
                        }
                        this.emit('transcript', {
                            text: transcript,
                            isFinal,
                            confidence: alt?.confidence ?? 1.0,
                            ...(speakerId ? { speakerId } : {}),
                        });
                    } catch (err) {
                        console.error('[DeepgramStreaming] Parse error:', err);
                    }
                });

                // Flush buffered audio
                const buffered = this.buffer.splice(0);
                for (const chunk of buffered) {
                    try { this.live?.send(chunk); } catch { }
                }
                if (buffered.length > 0) {
                    console.log(`[DeepgramStreaming] Flushed ${buffered.length} buffered chunks`);
                }

                // SDK keepAlive() every 8s prevents idle timeout (per Deepgram docs)
                this.keepAliveInterval = setInterval(() => {
                    if (this.isOpen) {
                        try { this.live?.keepAlive(); } catch { }
                    }
                }, KEEPALIVE_INTERVAL_MS);

                // Reset backoff only after 5s of stable connection.
                // Tracked on this.stabilityTimer so stop()/clearTimers() can
                // cancel it; otherwise the orphan would fire inside the next
                // session and reset reconnectAttempts mid-backoff.
                if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
                this.stabilityTimer = setTimeout(() => {
                    this.stabilityTimer = null;
                    if (this.isOpen) this.reconnectAttempts = 0;
                }, 5000);
            });

            this.live.on(LiveTranscriptionEvents.Error, (err: any) => {
                console.error('[DeepgramStreaming] Error:', err);
                this.emit('error', err instanceof Error ? err : new Error(String(err)));
            });

            this.live.on(LiveTranscriptionEvents.Close, (event: any) => {
                const code = event?.code ?? 'unknown';
                const reason = event?.reason || '(empty)';
                console.log(`[DeepgramStreaming] Closed (code=${code}, reason=${reason})`);

                this.isOpen = false;
                this.isConnecting = false;
                this.clearTimers();

                if (this.shouldReconnect && code !== 1000) {
                    this.scheduleReconnect();
                }
            });

        } catch (err: any) {
            console.error('[DeepgramStreaming] Initialization error:', err?.message);
            this.isConnecting = false;
            if (this.shouldReconnect) this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;

        // Discard stale buffered audio — replaying seconds-old audio on reconnect
        // overwhelms Deepgram's real-time endpoint and causes EPIPE storms.
        this.buffer = [];

        if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            console.error(`[DeepgramStreaming] Max reconnect attempts reached — giving up`);
            this.emit('error', new Error('DeepgramStreamingSTT: max reconnect attempts exceeded'));
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_DELAY_MS
        );
        this.reconnectAttempts++;

        console.log(`[DeepgramStreaming] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) this.connect();
        }, delay);
    }

    private clearTimers(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.stabilityTimer) {
            clearTimeout(this.stabilityTimer);
            this.stabilityTimer = null;
        }
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
    }
}

// Pick the most-frequent speaker index across a Deepgram result's words. Deepgram emits a
// per-word integer `speaker` when diarize=true. Returns undefined when no numeric index is
// present (diarization off, or pre-diarization SDK shape) so the caller omits speakerId.
function dominantSpeakerIndex(words: any): number | undefined {
    if (!Array.isArray(words) || words.length === 0) return undefined;
    const counts = new Map<number, number>();
    for (const w of words) {
        const s = w?.speaker;
        if (typeof s === 'number' && Number.isFinite(s) && s >= 0) counts.set(s, (counts.get(s) || 0) + 1);
    }
    if (counts.size === 0) return undefined;
    let best = -1; let bestCount = -1;
    for (const [idx, c] of counts) if (c > bestCount) { best = idx; bestCount = c; }
    return best >= 0 ? best : undefined;
}
