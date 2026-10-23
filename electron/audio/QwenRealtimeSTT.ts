/** Direct Qwen ASR Realtime WebSocket provider for Beijing DashScope keys. */
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES } from '../config/languages';
import { RealtimeSilenceTail } from './realtimeSilenceTail';

const URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime';
const OUTPUT_RATE = 16_000;
const MAX_BUFFER_MS = 2_000;
const RECONNECT_COOLDOWN_MS = 30_000;
const SUPPORTED_LANGUAGES = new Set([
    'zh', 'yue', 'en', 'ja', 'de', 'ko', 'ru', 'fr', 'pt', 'ar', 'it', 'es',
    'hi', 'id', 'th', 'tr', 'uk', 'vi', 'cs', 'da', 'fil', 'fi', 'is', 'ms',
    'no', 'pl', 'sv',
]);

interface QwenEvent {
    type: string;
    text?: string;
    stash?: string;
    transcript?: string;
    error?: { code?: string; message?: string };
}

export class QwenRealtimeSTT extends EventEmitter {
    private socket: WebSocket | null = null;
    private active = false;
    private ready = false;
    private inputRate = 16_000;
    private channels = 1;
    private language: string | undefined;
    private queued: Buffer[] = [];
    private queuedBytes = 0;
    private reconnectAttempts = 0;
    private readyAt = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private sequence = 0;
    private terminalFailure = false;

    private readonly silenceTail = new RealtimeSilenceTail({
        tailMs: 800,
        format: () => ({ sampleRate: this.inputRate, channels: this.channels }),
        sink: (pcm) => this.sendAudio(pcm),
    });

    constructor(private readonly apiKey: string) { super(); }

    setSampleRate(rate: number): void {
        if (Number.isFinite(rate) && rate > 0) this.inputRate = rate;
    }

    setAudioChannelCount(count: number): void {
        if (Number.isInteger(count) && count > 0) this.channels = count;
    }

    setRecognitionLanguage(key: string): void {
        const iso = RECOGNITION_LANGUAGES[key]?.iso639?.split('-')[0];
        this.language = key === 'auto' || !iso || !SUPPORTED_LANGUAGES.has(iso)
            ? undefined : iso;
    }

    setCredentials(_path: string): void { /* API key is held in memory. */ }

    start(): void {
        if (this.active) return;
        this.active = true;
        this.terminalFailure = false;
        this.reconnectAttempts = 0;
        this.readyAt = 0;
        this.connect();
    }

    stop(): void {
        if (!this.active) return;
        this.active = false;
        this.ready = false;
        this.silenceTail.cancel();
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.queued = [];
        this.queuedBytes = 0;
        const ws = this.socket;
        this.socket = null;
        if (!ws) return;
        if (ws.readyState !== WebSocket.OPEN) {
            ws.terminate();
            return;
        }
        // A direct close discards Qwen's in-progress final transcript.
        const timeout = setTimeout(() => ws.terminate(), 2_000);
        timeout.unref?.();
        ws.on('message', (raw) => {
            try {
                if ((JSON.parse(raw.toString()) as QwenEvent).type === 'session.finished') {
                    clearTimeout(timeout);
                    ws.close();
                }
            } catch { /* The normal message listener reports protocol errors. */ }
        });
        try {
            ws.send(JSON.stringify({ event_id: this.eventId(), type: 'session.finish' }));
        } catch {
            clearTimeout(timeout);
            ws.terminate();
        }
    }

    write(chunk: Buffer): void {
        if (!this.active || chunk.length < 2) return;
        this.silenceTail.observe(chunk);
        this.sendAudio(chunk);
    }

    notifySpeechEnded(): void {
        if (this.active) this.silenceTail.start();
    }

    finalize(): void { this.notifySpeechEnded(); }

    private eventId(): string {
        return `natively_qwen_${Date.now()}_${++this.sequence}`;
    }

    private connect(): void {
        if (!this.active || this.socket || this.terminalFailure) return;
        const ws = new WebSocket(URL, {
            headers: { Authorization: `Bearer ${this.apiKey}` },
            handshakeTimeout: 10_000,
        });
        this.socket = ws;
        this.ready = false;

        ws.on('unexpected-response', (_request, response) => {
            if (response.statusCode === 401 || response.statusCode === 403) {
                this.terminalFailure = true;
            }
            if (this.active && this.socket === ws) {
                this.emit('error', new Error(`Qwen ASR returned HTTP ${response.statusCode}`));
            }
            ws.terminate();
        });

        ws.on('message', (raw) => {
            let event: QwenEvent;
            try { event = JSON.parse(raw.toString()) as QwenEvent; }
            catch { return; }

            if (event.type === 'session.created') {
                const session: Record<string, unknown> = {
                    input_audio_format: 'pcm',
                    sample_rate: OUTPUT_RATE,
                    turn_detection: {
                        type: 'server_vad', threshold: 0.0, silence_duration_ms: 400,
                    },
                };
                if (this.language) session.input_audio_transcription = { language: this.language };
                ws.send(JSON.stringify({ event_id: this.eventId(), type: 'session.update', session }));
            } else if (event.type === 'session.updated') {
                if (this.socket !== ws || !this.active) return;
                this.ready = true;
                this.readyAt = Date.now();
                const pending = this.queued;
                this.queued = [];
                this.queuedBytes = 0;
                for (const chunk of pending) this.appendAudio(ws, chunk);
            } else if (event.type === 'conversation.item.input_audio_transcription.text') {
                if (!this.active) return;
                const text = `${event.text ?? ''}${event.stash ?? ''}`.trim();
                if (text) this.emit('transcript', { text, isFinal: false, confidence: 1 });
            } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
                const text = event.transcript?.trim();
                if (text) this.emit('transcript', { text, isFinal: true, confidence: 1 });
            } else if (event.type === 'input_audio_buffer.speech_stopped') {
                if (this.active) this.emit('endpoint', { type: 'speech_final', confidence: 1 });
            } else if (event.type === 'error') {
                if (this.active && this.socket === ws) {
                    this.emit('error', new Error(event.error?.message || 'Qwen ASR rejected the request'));
                }
            }
        });

        ws.on('error', (error) => {
            if (this.active) this.emit('error', error);
        });

        ws.on('close', () => {
            if (this.socket !== ws) return;
            this.socket = null;
            this.ready = false;
            if (!this.active || this.terminalFailure) return;
            if (this.readyAt && Date.now() - this.readyAt > 30_000) {
                this.reconnectAttempts = 0;
            }
            this.readyAt = 0;
            if (++this.reconnectAttempts > 5) {
                this.reconnectTimer = setTimeout(() => {
                    this.reconnectTimer = null;
                    this.reconnectAttempts = 0;
                    this.connect();
                }, RECONNECT_COOLDOWN_MS);
                this.emit('error', new Error('Qwen ASR connection failed after retries'));
                return;
            }
            const delay = Math.min(1_000 * 2 ** (this.reconnectAttempts - 1), 10_000);
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect();
            }, delay);
        });
    }

    private sendAudio(chunk: Buffer): void {
        if (!this.active) return;
        const ws = this.socket;
        if (!this.ready || !ws || ws.readyState !== WebSocket.OPEN) {
            this.queued.push(Buffer.from(chunk));
            this.queuedBytes += chunk.length;
            const maxBytes = this.inputRate * this.channels * 2 * MAX_BUFFER_MS / 1_000;
            while (this.queuedBytes > maxBytes && this.queued.length) {
                this.queuedBytes -= this.queued.shift()!.length;
            }
            return;
        }
        this.appendAudio(ws, chunk);
    }

    private appendAudio(ws: WebSocket, chunk: Buffer): void {
        if (ws.readyState !== WebSocket.OPEN) return;
        const frames = Math.floor(chunk.length / (2 * this.channels));
        const outFrames = Math.floor(frames * OUTPUT_RATE / this.inputRate);
        if (outFrames < 1) return;
        const pcm = Buffer.allocUnsafe(outFrames * 2);
        for (let i = 0; i < outFrames; i++) {
            const position = i * this.inputRate / OUTPUT_RATE;
            const first = Math.min(Math.floor(position), frames - 1);
            const second = Math.min(first + 1, frames - 1);
            const fraction = position - first;
            let a = 0; let b = 0;
            for (let c = 0; c < this.channels; c++) {
                a += chunk.readInt16LE((first * this.channels + c) * 2);
                b += chunk.readInt16LE((second * this.channels + c) * 2);
            }
            pcm.writeInt16LE(Math.round((a + (b - a) * fraction) / this.channels), i * 2);
        }
        ws.send(JSON.stringify({
            event_id: this.eventId(), type: 'input_audio_buffer.append', audio: pcm.toString('base64'),
        }));
    }
}
