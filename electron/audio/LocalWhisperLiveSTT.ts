/**
 * LocalWhisperLiveSTT - local WebSocket Speech-to-Text adapter for WhisperLive.
 *
 * Implements the same EventEmitter interface as the cloud STT providers:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk), setSampleRate(), setAudioChannelCount()
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES } from '../config/languages';

export type LocalSttAdapter = 'whisperlive-ws';
export type LocalSttAudioFormat = 'float32' | 'pcm_s16le';

export interface LocalSttConfig {
    adapter: LocalSttAdapter;
    url: string;
    model: string;
    useVad: boolean;
    audioFormat: LocalSttAudioFormat;
    sendLastNSegments: number;
    noSpeechThreshold: number;
}

export const DEFAULT_LOCAL_STT_CONFIG: LocalSttConfig = {
    adapter: 'whisperlive-ws',
    url: 'ws://127.0.0.1:9090',
    model: 'small',
    useVad: true,
    audioFormat: 'float32',
    sendLastNSegments: 10,
    noSpeechThreshold: 0.45,
};

const TARGET_SAMPLE_RATE = 16_000;
const MAX_BUFFER_SECONDS = 8;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;

interface WhisperLiveSegment {
    start?: number | string;
    end?: number | string;
    text?: string;
    completed?: boolean;
}

interface WhisperLiveMessage {
    uid?: string;
    status?: 'WAIT' | 'ERROR' | 'WARNING' | string;
    message?: string;
    backend?: string;
    language?: string;
    language_prob?: number;
    segments?: WhisperLiveSegment[];
}

export class LocalWhisperLiveSTT extends EventEmitter {
    private config: LocalSttConfig;
    private readonly channel: 'system' | 'mic';
    private ws: WebSocket | null = null;
    private uid = randomUUID();

    private isActive = false;
    private shouldReconnect = false;
    private isConnecting = false;
    private isReady = false;

    private sampleRate = 16000;
    private numChannels = 1;
    private languageCode: string | null = 'en';

    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private connectTimeout: NodeJS.Timeout | null = null;

    private buffer: Buffer[] = [];
    private bufferedBytes = 0;
    private emittedFinalKeys = new Set<string>();
    private finalKeyOrder: string[] = [];
    private lastInterimText = '';

    constructor(config?: Partial<LocalSttConfig>, channel: 'system' | 'mic' = 'system') {
        super();
        this.config = normalizeLocalSttConfig(config);
        this.channel = channel;
    }

    public setSampleRate(rate: number): void {
        if (!Number.isFinite(rate) || rate <= 0 || this.sampleRate === rate) return;
        this.sampleRate = rate;
        console.log(`[LocalWhisperLiveSTT:${this.channel}] Sample rate set to ${rate}`);
    }

    public setAudioChannelCount(count: number): void {
        if (!Number.isFinite(count) || count <= 0 || this.numChannels === count) return;
        this.numChannels = Math.max(1, Math.floor(count));
        console.log(`[LocalWhisperLiveSTT:${this.channel}] Channel count set to ${this.numChannels}`);
    }

    public setRecognitionLanguage(key: string): void {
        if (key === 'auto') {
            this.languageCode = null;
            console.log(`[LocalWhisperLiveSTT:${this.channel}] Language set to auto`);
            return;
        }

        const config = RECOGNITION_LANGUAGES[key];
        if (config) {
            this.languageCode = config.iso639;
            console.log(`[LocalWhisperLiveSTT:${this.channel}] Language set to ${this.languageCode}`);
        }
    }

    public setCredentials(_path: string): void { }

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

        if (this.ws) {
            try {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send('END_OF_AUDIO');
                }
            } catch {
                // Ignore shutdown send failures.
            }

            try { this.ws.close(1000); } catch { }
            this.ws = null;
        }

        this.isActive = false;
        this.isConnecting = false;
        this.isReady = false;
        this.buffer = [];
        this.bufferedBytes = 0;
        this.lastInterimText = '';
        console.log(`[LocalWhisperLiveSTT:${this.channel}] Stopped`);
    }

    public write(chunk: Buffer): void {
        if (!this.isActive || chunk.length === 0) return;

        const payload = this.prepareAudioPayload(chunk);
        if (!payload || payload.length === 0) return;

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isReady) {
            this.pushBuffered(payload);
            if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                this.connect();
            }
            return;
        }

        this.sendPayload(payload);
    }

    public notifySpeechEnded(): void {
        // WhisperLive handles streaming segmentation server-side. Keep the method for interface parity.
    }

    public finalize(): void {
        // WhisperLive has no lightweight finalize message; END_OF_AUDIO ends the session.
    }

    private connect(): void {
        if (this.isConnecting || !this.shouldReconnect) return;

        let url: URL;
        try {
            url = new URL(this.config.url);
            if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
                throw new Error('Local STT URL must use ws:// or wss://');
            }
        } catch (err: any) {
            console.warn(`[LocalWhisperLiveSTT:${this.channel}] Invalid local STT URL: ${err?.message || err}`);
            this.scheduleReconnect();
            return;
        }

        this.uid = randomUUID();
        this.isConnecting = true;
        this.isReady = false;
        this.lastInterimText = '';

        console.log(`[LocalWhisperLiveSTT:${this.channel}] Connecting to ${url.toString()}...`);

        this.ws = new WebSocket(url.toString());
        const ws = this.ws;

        this.connectTimeout = setTimeout(() => {
            if (this.ws !== ws) return;
            console.warn(`[LocalWhisperLiveSTT:${this.channel}] Connection timed out`);
            try { ws.terminate(); } catch { }
        }, 15000);

        ws.on('open', () => {
            if (!this.shouldReconnect || !this.isActive || this.ws !== ws) {
                try { ws.close(1000); } catch { }
                return;
            }

            this.isConnecting = false;
            this.reconnectAttempts = 0;
            console.log(`[LocalWhisperLiveSTT:${this.channel}] Connected, sending config`);
            this.sendInitialConfig(ws);
        });

        ws.on('message', (data: WebSocket.Data) => {
            if (this.ws !== ws) return;
            this.handleMessage(data);
        });

        ws.on('error', (err: Error) => {
            console.warn(`[LocalWhisperLiveSTT:${this.channel}] WebSocket error: ${err.message}`);
        });

        ws.on('close', (code: number, reason: Buffer) => {
            if (this.ws === ws) this.ws = null;
            this.isConnecting = false;
            this.isReady = false;
            this.clearConnectTimeout();

            console.warn(`[LocalWhisperLiveSTT:${this.channel}] Closed (code=${code}, reason=${reason.toString() || 'empty'})`);

            if (this.shouldReconnect && code !== 1000) {
                this.scheduleReconnect();
            }
        });
    }

    private sendInitialConfig(ws: WebSocket): void {
        const configMessage = {
            uid: this.uid,
            language: this.languageCode,
            task: 'transcribe',
            model: this.config.model,
            use_vad: this.config.useVad,
            send_last_n_segments: this.config.sendLastNSegments,
            no_speech_thresh: this.config.noSpeechThreshold,
            clip_audio: false,
            same_output_threshold: 10,
            enable_translation: false,
            target_language: 'en',
        };

        try {
            ws.send(JSON.stringify(configMessage));
        } catch (err: any) {
            console.warn(`[LocalWhisperLiveSTT:${this.channel}] Failed to send config: ${err?.message || err}`);
        }
    }

    private handleMessage(data: WebSocket.Data): void {
        let msg: WhisperLiveMessage;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            return;
        }

        if (msg.uid && msg.uid !== this.uid) return;

        if (msg.status) {
            this.handleStatus(msg);
            return;
        }

        if (msg.message === 'SERVER_READY') {
            this.clearConnectTimeout();
            this.isReady = true;
            console.log(`[LocalWhisperLiveSTT:${this.channel}] Server ready (${msg.backend || 'unknown backend'})`);
            this.flushBuffer();
            return;
        }

        if (msg.message === 'DISCONNECT') {
            console.warn(`[LocalWhisperLiveSTT:${this.channel}] Server requested disconnect`);
            return;
        }

        if (msg.language) {
            this.emit('languageDetected', msg.language);
        }

        if (Array.isArray(msg.segments)) {
            this.handleSegments(msg.segments);
        }
    }

    private handleStatus(msg: WhisperLiveMessage): void {
        if (msg.status === 'ERROR') {
            console.warn(`[LocalWhisperLiveSTT:${this.channel}] Server error: ${msg.message || 'unknown error'}`);
            return;
        }

        if (msg.status === 'WAIT') {
            console.warn(`[LocalWhisperLiveSTT:${this.channel}] Server is full; waiting (${msg.message ?? 'unknown wait'})`);
            return;
        }

        if (msg.status === 'WARNING') {
            console.warn(`[LocalWhisperLiveSTT:${this.channel}] Server warning: ${msg.message || 'warning'}`);
        }
    }

    private handleSegments(segments: WhisperLiveSegment[]): void {
        let latestIncomplete = '';

        for (const segment of segments) {
            const text = normalizeTranscriptText(segment.text);
            if (!text) continue;

            if (segment.completed === true) {
                const key = segmentKey(segment, text);
                if (this.emittedFinalKeys.has(key)) continue;

                this.emittedFinalKeys.add(key);
                this.finalKeyOrder.push(key);
                if (this.finalKeyOrder.length > 200) {
                    const oldest = this.finalKeyOrder.shift();
                    if (oldest) this.emittedFinalKeys.delete(oldest);
                }

                this.lastInterimText = '';
                this.emit('transcript', {
                    text,
                    isFinal: true,
                    confidence: 1.0,
                });
            } else {
                latestIncomplete = text;
            }
        }

        if (latestIncomplete && latestIncomplete !== this.lastInterimText) {
            this.lastInterimText = latestIncomplete;
            this.emit('transcript', {
                text: latestIncomplete,
                isFinal: false,
                confidence: 1.0,
            });
        }
    }

    private prepareAudioPayload(chunk: Buffer): Buffer {
        const pcm16k = this.to16kMonoPcm(chunk);
        if (this.config.audioFormat === 'pcm_s16le') {
            return pcm16k;
        }

        const sampleCount = Math.floor(pcm16k.length / 2);
        const floatBuffer = Buffer.allocUnsafe(sampleCount * 4);
        for (let i = 0; i < sampleCount; i++) {
            const sample = pcm16k.readInt16LE(i * 2);
            floatBuffer.writeFloatLE(sample / 32768, i * 4);
        }
        return floatBuffer;
    }

    private to16kMonoPcm(raw: Buffer): Buffer {
        const sampleCount = Math.floor(raw.length / 2);
        if (sampleCount === 0) return Buffer.alloc(0);

        const frameCount = Math.floor(sampleCount / this.numChannels);
        const mono = new Int16Array(frameCount);

        for (let frame = 0; frame < frameCount; frame++) {
            let sum = 0;
            for (let ch = 0; ch < this.numChannels; ch++) {
                const sampleIndex = frame * this.numChannels + ch;
                sum += raw.readInt16LE(sampleIndex * 2);
            }
            mono[frame] = Math.round(sum / this.numChannels);
        }

        if (this.sampleRate === TARGET_SAMPLE_RATE) {
            return int16ArrayToBuffer(mono);
        }

        const ratio = this.sampleRate / TARGET_SAMPLE_RATE;
        const outLength = Math.max(1, Math.floor(mono.length / ratio));
        const output = Buffer.allocUnsafe(outLength * 2);

        for (let i = 0; i < outLength; i++) {
            const sourceIndex = Math.min(mono.length - 1, Math.floor(i * ratio));
            output.writeInt16LE(mono[sourceIndex], i * 2);
        }

        return output;
    }

    private pushBuffered(payload: Buffer): void {
        this.buffer.push(payload);
        this.bufferedBytes += payload.length;

        const maxBytes = TARGET_SAMPLE_RATE * 4 * MAX_BUFFER_SECONDS;
        while (this.bufferedBytes > maxBytes && this.buffer.length > 0) {
            const dropped = this.buffer.shift();
            this.bufferedBytes -= dropped?.length ?? 0;
        }
    }

    private flushBuffer(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isReady) return;

        const buffered = this.buffer.splice(0);
        this.bufferedBytes = 0;
        for (const payload of buffered) {
            this.sendPayload(payload);
        }

        if (buffered.length > 0) {
            console.log(`[LocalWhisperLiveSTT:${this.channel}] Flushed ${buffered.length} buffered audio chunks`);
        }
    }

    private sendPayload(payload: Buffer): void {
        try {
            this.ws?.send(payload);
        } catch (err: any) {
            console.warn(`[LocalWhisperLiveSTT:${this.channel}] Send error: ${err?.message || err}`);
        }
    }

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;

        if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            console.warn(`[LocalWhisperLiveSTT:${this.channel}] Max reconnect attempts reached`);
            this.emit('error', new Error('LocalWhisperLiveSTT: local endpoint unavailable'));
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_DELAY_MS
        );
        this.reconnectAttempts++;

        this.clearTimers();
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
        this.clearConnectTimeout();
    }

    private clearConnectTimeout(): void {
        if (this.connectTimeout) {
            clearTimeout(this.connectTimeout);
            this.connectTimeout = null;
        }
    }
}

export function normalizeLocalSttConfig(config?: Partial<LocalSttConfig>): LocalSttConfig {
    const merged = { ...DEFAULT_LOCAL_STT_CONFIG, ...(config || {}) };

    return {
        adapter: merged.adapter === 'whisperlive-ws' ? 'whisperlive-ws' : 'whisperlive-ws',
        url: typeof merged.url === 'string' && merged.url.trim()
            ? merged.url.trim()
            : DEFAULT_LOCAL_STT_CONFIG.url,
        model: typeof merged.model === 'string' && merged.model.trim()
            ? merged.model.trim()
            : DEFAULT_LOCAL_STT_CONFIG.model,
        useVad: merged.useVad !== false,
        audioFormat: merged.audioFormat === 'pcm_s16le' ? 'pcm_s16le' : 'float32',
        sendLastNSegments: clampInteger(merged.sendLastNSegments, 1, 50, DEFAULT_LOCAL_STT_CONFIG.sendLastNSegments),
        noSpeechThreshold: clampNumber(merged.noSpeechThreshold, 0, 1, DEFAULT_LOCAL_STT_CONFIG.noSpeechThreshold),
    };
}

function int16ArrayToBuffer(samples: Int16Array): Buffer {
    const buffer = Buffer.allocUnsafe(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
        buffer.writeInt16LE(samples[i], i * 2);
    }
    return buffer;
}

function normalizeTranscriptText(text?: string): string {
    return (text || '').replace(/\s+/g, ' ').trim();
}

function segmentKey(segment: WhisperLiveSegment, text: string): string {
    return `${segment.start ?? ''}:${segment.end ?? ''}:${text}`;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}
