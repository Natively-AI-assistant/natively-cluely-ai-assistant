/**
 * OpenAIStreamingSTT - WebSocket-first, REST-fallback Speech-to-Text for OpenAI
 *
 * Priority chain (automatic, with audio buffering during transitions):
 *   1. WebSocket Realtime API → gpt-4o-transcribe        (server VAD, noise reduction)
 *   2. WebSocket Realtime API → gpt-4o-mini-transcribe   (server VAD, noise reduction)
 *   3. REST API              → whisper-1                 (client VAD flush)
 *
 * Implements the same EventEmitter interface as all other STT providers:
 *   Events:  'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk), setSampleRate(), setAudioChannelCount(),
 *            setRecognitionLanguage(), setCredentials(), notifySpeechEnded()
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import axios from 'axios';
import FormData from 'form-data';
import { RECOGNITION_LANGUAGES } from '../config/languages';

// ─── Constants ────────────────────────────────────────────────────────────────

const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
const REST_ENDPOINT   = 'https://api.openai.com/v1/audio/transcriptions';

/** WebSocket model priority order */
const WS_MODELS = ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe'] as const;
type WsModel = typeof WS_MODELS[number];

/** Max consecutive WebSocket failures before advancing to next model / REST */
const MAX_WS_FAILURES_PER_MODEL = 3;

/** Exponential backoff reconnect delays */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS  = 30_000;

/** Keep-alive ping interval (ms) — prevents idle disconnects */
const KEEPALIVE_INTERVAL_MS = 20_000;

/** Rolling audio ring-buffer: max ~30 seconds at 24kHz mono 16-bit (WS path) */
const MAX_RING_BUFFER_BYTES = 24_000 * 2 * 30; // 1 440 000 bytes

/** REST safety-net flush interval when in REST fallback mode */
const REST_SAFETY_NET_MS = 10_000;

/** Minimum buffered bytes before attempting a REST upload */
const REST_MIN_UPLOAD_BYTES = 4_000;

/** WebSocket Audio Batching: Number of 24kHz samples to accumulate before sending to prevent rate limits (~250ms) */
const SEND_THRESHOLD_SAMPLES = 6000;

/** Silence RMS threshold — skip REST uploads for silent buffers */
const SILENCE_RMS_THRESHOLD = 50;

/** PCM parameters */
const WS_SAMPLE_RATE      = 24_000; // OpenAI Realtime API requires 24 kHz for pcm16
const REST_SAMPLE_RATE    = 16_000; // whisper-1 REST accepts 16 kHz
const BITS_PER_SAMPLE     = 16;
const NUM_CHANNELS        = 1;

// ─── State ────────────────────────────────────────────────────────────────────

type Mode = 'ws' | 'rest';

// ─── Class ────────────────────────────────────────────────────────────────────

export class OpenAIStreamingSTT extends EventEmitter {
    // Public config
    private apiKey: string;
    private languageKey = 'en';

    // Audio config (set from pipeline)
    private inputSampleRate = 16_000;
    private numChannels     = NUM_CHANNELS;

    // Lifecycle
    private isActive     = false;
    private isConnecting = false;
    private shouldReconnect = false;

    // WebSocket state
    private ws: WebSocket | null = null;
    private wsModelIndex = 0;           // index into WS_MODELS
    private wsFailures   = 0;           // consecutive failures for current WS model
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private keepAliveTimer: NodeJS.Timeout | null = null;
    private connectionTimeoutTimer: NodeJS.Timeout | null = null;
    private sessionSetupTimer: NodeJS.Timeout | null = null;
    private isSessionReady = false;     // set after transcription_session.created

    // Audio batching state
    private pcmAccumulator: Int16Array[] = [];
    private pcmAccumulatorLen = 0;

    // Mode
    private mode: Mode = 'ws';

    // Rolling pre-buffer: holds audio while connecting / transitioning
    // Used to avoid losing speech at the start of a WS session or during fallback
    private ringBuffer: Buffer[] = [];
    private ringBufferBytes = 0;

    // REST fallback state
    private restChunks: Buffer[]   = [];
    private restTotalBytes         = 0;
    private restSafetyTimer: NodeJS.Timeout | null = null;
    private restIsUploading        = false;
    private restFlushPending       = false;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
        console.log('[OpenAIStreaming] Initialized — WebSocket priority (gpt-4o-transcribe → gpt-4o-mini-transcribe → whisper-1 REST)');
    }

    // ─── Public Configuration (STTProvider interface) ─────────────────────────

    public setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
        console.log('[OpenAIStreaming] API key updated');
    }

    public setSampleRate(rate: number): void {
        if (this.inputSampleRate === rate) return;
        this.inputSampleRate = rate;
        console.log(`[OpenAIStreaming] Input sample rate set to ${rate}Hz`);
    }

    public setAudioChannelCount(count: number): void {
        if (this.numChannels === count) return;
        this.numChannels = count;
        console.log(`[OpenAIStreaming] Channel count set to ${count}`);
    }

    public setRecognitionLanguage(key: string): void {
        const prev = this.languageKey;
        this.languageKey = key;
        if (key !== prev && this.isActive && this.mode === 'ws') {
            console.log(`[OpenAIStreaming] Language changed to ${key} — restarting WS session`);
            this._closeWs(true);
            this._connectWs();
        }
    }

    /** No-op — no credential files needed */
    public setCredentials(_path: string): void {}

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    public start(): void {
        if (this.isActive) return;
        console.log('[OpenAIStreaming] Starting...');
        this.isActive       = true;
        this.shouldReconnect = true;
        this.wsModelIndex   = 0;
        this.wsFailures     = 0;
        this.reconnectAttempts = 0;
        this.mode           = 'ws';

        this._connectWs();
    }

    public stop(): void {
        if (!this.isActive) return;
        console.log('[OpenAIStreaming] Stopping...');
        this.isActive        = false;
        this.shouldReconnect = false;

        this._clearTimers();
        this._closeWs(false);
        this._stopRestTimer();

        this.restChunks     = [];
        this.restTotalBytes = 0;
        this.ringBuffer     = [];
        this.ringBufferBytes = 0;
        this.pcmAccumulator = [];
        this.pcmAccumulatorLen = 0;
    }

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (this.mode === 'ws') {
            // Always push to ring-buffer while not yet connected (pre-buffer)
            if (!this.isSessionReady) {
                this._ringBufferPush(chunk);
                // Trigger lazy connect if not already in progress
                if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                    this._connectWs();
                }
                return;
            }
            this._sendWsAudioChunk(chunk);
        } else {
            // REST mode — accumulate for batch upload
            this.restChunks.push(chunk);
            this.restTotalBytes += chunk.length;
        }
    }

    /**
     * Called by Rust native VAD when speech ends.
     * On WebSocket path: server handles VAD — this is a no-op.
     * On REST fallback path: triggers immediate flush.
     */
    public notifySpeechEnded(): void {
        if (!this.isActive) return;
        if (this.mode === 'rest') {
            console.log('[OpenAIStreaming][REST] Speech ended — flushing buffer');
            this._restFlushAndUpload();
        }
        // WebSocket path: server VAD handles this; nothing to do.
    }

    // ─── WebSocket Path ───────────────────────────────────────────────────────

    private _connectWs(): void {
        if (this.isConnecting || !this.shouldReconnect) return;
        this.isConnecting  = true;
        this.isSessionReady = false;

        const model: WsModel = WS_MODELS[this.wsModelIndex] ?? WS_MODELS[0];
        console.log(`[OpenAIStreaming] Connecting WebSocket (model=${model}, attempt=${this.reconnectAttempts + 1})...`);

        this.ws = new WebSocket(REALTIME_WS_URL, {
            headers: {
                Authorization:   `Bearer ${this.apiKey}`,
                'OpenAI-Beta':   'realtime=v1',
            },
        });

        // 10-second connection timeout to prevent hanging on dropped networks
        this.connectionTimeoutTimer = setTimeout(() => {
            console.warn(`[OpenAIStreaming] WebSocket connection timed out after 10s (attempt=${this.reconnectAttempts + 1})`);
            if (this.ws) {
                this.ws.removeAllListeners();
                this.ws.close();
                this.ws = null;
                this.isConnecting = false;
                this._handleWsClose(1006, Buffer.from('Connection Timeout'));
            }
        }, 10_000);

        this.ws.on('open', () => {
            if (this.connectionTimeoutTimer) {
                clearTimeout(this.connectionTimeoutTimer);
                this.connectionTimeoutTimer = null;
            }
            console.log(`[OpenAIStreaming] WebSocket open — sending session config (model=${model})`);
            this.isConnecting      = false;
            this.reconnectAttempts = 0;

            // Start 5-second timeout waiting for session.created
            this.sessionSetupTimer = setTimeout(() => {
                console.warn(`[OpenAIStreaming] Server accepted connection but failed to create session within 5s. Forcing disconnect...`);
                // Force a disconnect to trigger the fallback logic
                if (this.ws) {
                    this.ws.removeAllListeners();
                    this.ws.close();
                    this.ws = null;
                    this._handleWsClose(1008, Buffer.from('Session Setup Timeout'));
                }
            }, 5_000);

            // Configure the transcription session
            const lang = this.languageKey
                ? (RECOGNITION_LANGUAGES[this.languageKey]?.iso639 ?? '')
                : '';

            this.ws!.send(JSON.stringify({
                type: 'transcription_session.update',
                session: {
                    input_audio_format: 'pcm16',
                    input_audio_transcription: {
                        model,
                        prompt: '',
                        language: lang || '',
                    },
                    // Server VAD — offload voice activity detection entirely to the server
                    turn_detection: {
                        type:                'server_vad',
                        threshold:           0.5,
                        prefix_padding_ms:   300,
                        silence_duration_ms: 500,
                    },
                    // Server-side noise reduction
                    input_audio_noise_reduction: {
                        type: 'near_field',
                    },
                },
            }));
        });

        this.ws.on('message', (raw: WebSocket.Data) => {
            try {
                const msg = JSON.parse(raw.toString());
                this._handleWsMessage(msg);
            } catch (err) {
                console.error('[OpenAIStreaming] WS parse error:', err);
            }
        });

        this.ws.on('error', (err: Error) => {
            console.error(`[OpenAIStreaming] WS error: ${err.message}`);
            // The 'close' event will follow, so we handle reconnect there.
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
            this._handleWsClose(code, reason);
        });
    }

    private _handleWsClose(code: number, reason: Buffer): void {
        this.isConnecting   = false;
        this.isSessionReady = false;
        this._clearKeepAlive();
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
            this.connectionTimeoutTimer = null;
        }
        if (this.sessionSetupTimer) {
            clearTimeout(this.sessionSetupTimer);
            this.sessionSetupTimer = null;
        }
        console.log(`[OpenAIStreaming] WS closed (code=${code}, reason=${reason.toString() || 'none'})`);

        if (!this.shouldReconnect) return;

        // Count this as a failure
        this.wsFailures++;

        if (this.wsFailures >= MAX_WS_FAILURES_PER_MODEL) {
            // Advance to next WebSocket model
            this.wsModelIndex++;
            this.wsFailures = 0;

            if (this.wsModelIndex >= WS_MODELS.length) {
                // All WS models exhausted — fall back to REST
                console.warn('[OpenAIStreaming] All WebSocket models failed — falling back to whisper-1 REST');
                this._switchToRest();
            } else {
                const nextModel = WS_MODELS[this.wsModelIndex];
                console.warn(`[OpenAIStreaming] Switching to next WebSocket model: ${nextModel}`);
                this.reconnectAttempts = 0;
                this._scheduleWsReconnect();
            }
        } else {
            // Same model, retry with backoff (e.g. transient network error)
            this._scheduleWsReconnect();
        }
    }

    private _handleWsMessage(msg: Record<string, any>): void {
        switch (msg.type) {
            case 'transcription_session.created':
            case 'session.created':
                if (this.sessionSetupTimer) {
                    clearTimeout(this.sessionSetupTimer);
                    this.sessionSetupTimer = null;
                }
                console.log('[OpenAIStreaming] Session created — flushing ring buffer');
                this.isSessionReady = true;
                this.wsFailures     = 0; // Reset failures on successful session
                this._startKeepAlive();
                this._flushRingBuffer();
                break;

            case 'transcript.text.delta':
                if (msg.delta) {
                    this.emit('transcript', {
                        text:       msg.delta,
                        isFinal:    false,
                        confidence: 1.0,
                    });
                }
                break;

            case 'transcript.text.done':
                if (msg.text) {
                    console.log(`[OpenAIStreaming] Final: "${msg.text.substring(0, 60)}"`);
                    this.emit('transcript', {
                        text:       msg.text,
                        isFinal:    true,
                        confidence: 1.0,
                    });
                }
                break;

            // VAD events emitted by the server (informational — we don't need to act on them)
            case 'input_audio_buffer.speech_started':
                console.log('[OpenAIStreaming] Server VAD: speech started');
                break;
            case 'input_audio_buffer.speech_stopped':
                console.log('[OpenAIStreaming] Server VAD: speech stopped');
                break;
            case 'input_audio_buffer.committed':
                // Audio chunk committed for transcription
                break;

            case 'error': {
                const errMsg = msg.error?.message ?? JSON.stringify(msg);
                console.error(`[OpenAIStreaming] Server error: ${errMsg}`);
                this.emit('error', new Error(errMsg));
                break;
            }

            default:
                // Uncomment for verbose debugging:
                // console.log(`[OpenAIStreaming] Unhandled message type: ${msg.type}`);
                break;
        }
    }

    private _sendWsAudioChunk(pcmChunk: Buffer): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        // Downsample if necessary (e.g. 48kHz → 24kHz for Realtime API)
        const pcm16 = this._resamplePcm16(pcmChunk, WS_SAMPLE_RATE);

        const inputS16 = new Int16Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength / 2);
        
        this.pcmAccumulator.push(inputS16);
        this.pcmAccumulatorLen += inputS16.length;

        if (this.pcmAccumulatorLen >= SEND_THRESHOLD_SAMPLES) {
            // Combine accumulated chunks
            const combined = new Int16Array(this.pcmAccumulatorLen);
            let offset = 0;
            for (const arr of this.pcmAccumulator) {
                combined.set(arr, offset);
                offset += arr.length;
            }

            // Reset accumulator
            this.pcmAccumulator = [];
            this.pcmAccumulatorLen = 0;

            const base64 = Buffer.from(combined.buffer).toString('base64');

            try {
                this.ws.send(JSON.stringify({
                    type:  'input_audio_buffer.append',
                    audio: base64,
                }));
            } catch (err) {
                console.warn('[OpenAIStreaming] WS send failed:', err);
            }
        }
    }

    private _closeWs(graceful: boolean): void {
        if (!this.ws) return;
        try {
            if (graceful && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'session.close' }));
            }
        } catch { /* ignore */ }
        this.ws.removeAllListeners();
        this.ws.close();
        this.ws = null;
        this.isSessionReady = false;
        this.isConnecting = false; // Allow immediate reconnect (e.g. language change)
        this.pcmAccumulator = [];
        this.pcmAccumulatorLen = 0;
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
            this.connectionTimeoutTimer = null;
        }
        if (this.sessionSetupTimer) {
            clearTimeout(this.sessionSetupTimer);
            this.sessionSetupTimer = null;
        }
    }

    private _scheduleWsReconnect(): void {
        if (!this.shouldReconnect) return;
        const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_MS,
        );
        this.reconnectAttempts++;
        console.log(`[OpenAIStreaming] WS reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect && this.mode === 'ws') {
                this._connectWs();
            }
        }, delay);
    }

    // ─── Keep-alive ───────────────────────────────────────────────────────────

    /** 8 bytes of PCM silence (4 samples × 2 bytes) — safest keepalive for the Realtime API */
    private static readonly KEEPALIVE_AUDIO_B64 = Buffer.alloc(8).toString('base64');

    private _startKeepAlive(): void {
        this._clearKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                try {
                    // Send a minimal silent PCM frame to prevent idle disconnects.
                    // An empty string ('') can be rejected by some API versions; 8 zero-bytes is safe.
                    this.ws.send(JSON.stringify({
                        type:  'input_audio_buffer.append',
                        audio: OpenAIStreamingSTT.KEEPALIVE_AUDIO_B64,
                    }));
                } catch { /* ignore */ }
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    private _clearKeepAlive(): void {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    private _clearTimers(): void {
        this._clearKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
            this.connectionTimeoutTimer = null;
        }
        if (this.sessionSetupTimer) {
            clearTimeout(this.sessionSetupTimer);
            this.sessionSetupTimer = null;
        }
    }

    // ─── Ring Buffer (pre-buffer during connecting / transitions) ────────────

    private _ringBufferPush(chunk: Buffer): void {
        this.ringBuffer.push(chunk);
        this.ringBufferBytes += chunk.length;

        // Evict oldest chunks when over limit
        while (this.ringBufferBytes > MAX_RING_BUFFER_BYTES && this.ringBuffer.length > 0) {
            const evicted = this.ringBuffer.shift()!;
            this.ringBufferBytes -= evicted.length;
        }
    }

    /** Flush the ring buffer once the session is ready */
    private _flushRingBuffer(): void {
        if (this.ringBuffer.length === 0) return;
        console.log(`[OpenAIStreaming] Flushing ${this.ringBuffer.length} buffered chunks (${this.ringBufferBytes} bytes)`);
        const chunks = this.ringBuffer.splice(0);
        this.ringBufferBytes = 0;
        for (const chunk of chunks) {
            this._sendWsAudioChunk(chunk);
        }
    }

    // ─── REST Fallback Path ───────────────────────────────────────────────────

    private _switchToRest(): void {
        this.mode = 'rest';
        this._clearTimers();
        this._closeWs(false);

        // Transfer ring-buffer contents to the REST accumulator so buffered audio isn't lost
        if (this.ringBuffer.length > 0) {
            console.log(`[OpenAIStreaming][REST] Transferring ${this.ringBufferBytes} ring-buffer bytes to REST accumulator`);
            const chunks = this.ringBuffer.splice(0);
            this.ringBufferBytes = 0;
            for (const chunk of chunks) {
                this.restChunks.push(chunk);
                this.restTotalBytes += chunk.length;
            }
        }

        // Start safety-net timer
        this._startRestTimer();
        console.log('[OpenAIStreaming][REST] Switched to whisper-1 REST fallback');
    }

    private _startRestTimer(): void {
        this._stopRestTimer();
        this.restSafetyTimer = setInterval(() => {
            this._restFlushAndUpload();
        }, REST_SAFETY_NET_MS);
    }

    private _stopRestTimer(): void {
        if (this.restSafetyTimer) {
            clearInterval(this.restSafetyTimer);
            this.restSafetyTimer = null;
        }
    }

    private async _restFlushAndUpload(): Promise<void> {
        if (this.restChunks.length === 0 || this.restTotalBytes < REST_MIN_UPLOAD_BYTES) return;
        if (this.restIsUploading) {
            this.restFlushPending = true;
            return;
        }

        // Reset safety-net timer to prevent double-flush
        this._startRestTimer();

        const chunks = this.restChunks.splice(0);
        this.restTotalBytes = 0;

        const rawPcm = Buffer.concat(chunks);

        // Skip silent buffers
        if (this._isSilent(rawPcm)) {
            if (Math.random() < 0.1) {
                console.log(`[OpenAIStreaming][REST] Skipping silent buffer (${rawPcm.length} bytes)`);
            }
            return;
        }

        // Downsample to 16kHz mono before creating WAV (input may be 48kHz)
        const pcm16k = this._resamplePcm16(rawPcm, REST_SAMPLE_RATE);
        const wavBuffer = this._addWavHeader(pcm16k);
        this.restIsUploading = true;

        try {
            const transcript = await this._restUpload(wavBuffer);
            if (transcript && transcript.trim().length > 0) {
                console.log(`[OpenAIStreaming][REST] Transcript: "${transcript.substring(0, 60)}"`);
                this.emit('transcript', {
                    text:       transcript.trim(),
                    isFinal:    true,
                    confidence: 1.0,
                });
            }
        } catch (err) {
            console.error('[OpenAIStreaming][REST] Upload error:', err);
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        } finally {
            this.restIsUploading = false;
            if (this.restFlushPending) {
                this.restFlushPending = false;
                this._restFlushAndUpload();
            }
        }
    }

    private async _restUpload(wavBuffer: Buffer): Promise<string> {
        const form = new FormData();
        form.append('file', wavBuffer, {
            filename:    'audio.wav',
            contentType: 'audio/wav',
        });
        form.append('model', 'whisper-1');

        const lang = this.languageKey
            ? (RECOGNITION_LANGUAGES[this.languageKey]?.iso639 ?? '')
            : '';
        if (lang) form.append('language', lang);

        const response = await axios.post(REST_ENDPOINT, form, {
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                ...form.getHeaders(),
            },
            timeout: 30_000,
        });

        const data = response.data;
        if (typeof data === 'string') return data;
        return data?.text ?? '';
    }

    // ─── Audio Utilities ──────────────────────────────────────────────────────

    /**
     * Convert raw PCM buffer from the capture pipeline into 16-bit PCM at the given target rate.
     * The pipeline outputs Int16LE PCM, potentially at a higher sample rate (e.g. 48kHz).
     */
    private _resamplePcm16(chunk: Buffer, targetRate: number): Buffer {
        // Safe read from unaligned memory
        const numSamples = chunk.length / 2;
        const inputS16 = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            inputS16[i] = chunk.readInt16LE(i * 2);
        }

        if (this.inputSampleRate === targetRate && this.numChannels === 1) {
            return Buffer.from(inputS16.buffer);
        }

        // Mix down multi-channel to mono first, then downsample
        let monoS16: Int16Array;
        if (this.numChannels > 1) {
            const monoLength = Math.floor(inputS16.length / this.numChannels);
            monoS16 = new Int16Array(monoLength);
            for (let i = 0; i < monoLength; i++) {
                let sum = 0;
                for (let c = 0; c < this.numChannels; c++) {
                    sum += inputS16[i * this.numChannels + c];
                }
                monoS16[i] = Math.round(sum / this.numChannels);
            }
        } else {
            monoS16 = inputS16;
        }

        // Downsample
        if (this.inputSampleRate === targetRate) {
            return Buffer.from(monoS16.buffer);
        }

        const factor       = this.inputSampleRate / targetRate;
        const outputLength = Math.floor(monoS16.length / factor);
        const outputS16    = new Int16Array(outputLength);
        for (let i = 0; i < outputLength; i++) {
            outputS16[i] = monoS16[Math.floor(i * factor)];
        }
        return Buffer.from(outputS16.buffer);
    }

    private _isSilent(pcm: Buffer): boolean {
        let sum   = 0;
        let count = 0;
        const step = 20;
        for (let i = 0; i < pcm.length - 1; i += 2 * step) {
            const sample = pcm.readInt16LE(i);
            sum  += sample * sample;
            count++;
        }
        if (count === 0) return true;
        return Math.sqrt(sum / count) < SILENCE_RMS_THRESHOLD;
    }

    private _addWavHeader(samples: Buffer): Buffer {
        const buf = Buffer.alloc(44 + samples.length);
        buf.write('RIFF', 0);
        buf.writeUInt32LE(36 + samples.length, 4);
        buf.write('WAVE', 8);
        buf.write('fmt ', 12);
        buf.writeUInt32LE(16, 16);
        buf.writeUInt16LE(1, 20);                                                                   // PCM
        buf.writeUInt16LE(NUM_CHANNELS, 22);
        buf.writeUInt32LE(REST_SAMPLE_RATE, 24);
        buf.writeUInt32LE(REST_SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8), 28);
        buf.writeUInt16LE(NUM_CHANNELS * (BITS_PER_SAMPLE / 8), 32);
        buf.writeUInt16LE(BITS_PER_SAMPLE, 34);
        buf.write('data', 36);
        buf.writeUInt32LE(samples.length, 40);
        samples.copy(buf, 44);
        return buf;
    }
}
