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
import { streamingStttWsOptions } from './dnsHelpers';
import { OpenAITranscriptTurnCoalescer } from './openaiTranscriptTurnCoalescer';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_OPENAI_BASE = 'https://api.openai.com';
const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
const REST_ENDPOINT   = 'https://api.openai.com/v1/audio/transcriptions';

/** Derive REST transcription endpoint from a user-supplied base URL.
 *  Strips a trailing slash so we don't end up with `//v1/...`. Accepts both
 *  `https://my-host.tld` and `https://my-host.tld/v1` (the latter occurs in the wild). */
function deriveRestEndpoint(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    return /\/v\d+$/.test(trimmed)
        ? `${trimmed}/audio/transcriptions`
        : `${trimmed}/v1/audio/transcriptions`;
}

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

/** Rolling audio ring-buffer: sized for worst-case raw INPUT audio (48kHz stereo 16-bit × 30s).
 *  The ring buffer stores PRE-RESAMPLED chunks from write(), not the 24kHz WS output. */
const MAX_RING_BUFFER_BYTES = 48_000 * 2 * 2 * 30; // 5 760 000 bytes (48kHz stereo × 16-bit × 30s)

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
    private isSessionReady = false;     // set on inbound session.created

    // Audio batching state
    private pcmAccumulator: Int16Array[] = [];
    private pcmAccumulatorLen = 0;

    // Mode
    private mode: Mode = 'ws';

    // Rolling pre-buffer: holds audio while connecting / transitioning
    // Used to avoid losing speech at the start of a WS session or during fallback
    private ringBuffer: Buffer[] = [];
    private ringBufferBytes = 0;
    private ringEvictedThisSession = false;
    private ringEvictedBytes = 0;

    // Rate-limit warning de-dup: per-session set of rate-limit names we've
    // already surfaced an upstream warning for. Server emits rate_limits.updated
    // on every turn; we only warn once per crossing per session.
    private rateLimitWarned: Set<string> = new Set();

    // REST fallback state
    private restChunks: Buffer[]   = [];
    private restTotalBytes         = 0;
    private restSafetyTimer: NodeJS.Timeout | null = null;
    private restIsUploading        = false;
    private restFlushPending       = false;

    // Custom OpenAI-compatible endpoint (e.g. self-hosted Speaches). When set, the
    // WebSocket Realtime path is skipped — third-party servers don't implement it.
    private restEndpoint: string = REST_ENDPOINT;
    private isCustomEndpoint = false;

    // Coalesce word-level GA completed events into one final turn per utterance.
    private turnCoalescer = new OpenAITranscriptTurnCoalescer();

    // Suppress duplicate final emits (finalize flush + speech_stopped, etc.).
    private lastFinalEmitText = '';
    private lastFinalEmitAt = 0;
    private static readonly FINAL_DEDUPE_MS = 2500;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(apiKey: string, baseUrl?: string) {
        super();
        this.apiKey = apiKey;
        const effectiveBase = (baseUrl || '').trim();
        if (effectiveBase && effectiveBase !== DEFAULT_OPENAI_BASE) {
            this.restEndpoint = deriveRestEndpoint(effectiveBase);
            this.isCustomEndpoint = true;
            console.log(`[OpenAIStreaming] Initialized — custom endpoint (REST only): ${this.restEndpoint}`);
        } else {
            console.log('[OpenAIStreaming] Initialized — WebSocket priority (gpt-4o-transcribe → gpt-4o-mini-transcribe → whisper-1 REST)');
        }
    }

    // ─── Public Configuration (STTProvider interface) ─────────────────────────

    public setApiKey(apiKey: string): void {
        const changed = this.apiKey !== apiKey;
        this.apiKey = apiKey;
        console.log('[OpenAIStreaming] API key updated');
        // The WebSocket's Authorization header is sent in the handshake and cannot
        // be updated on an established connection. If we're already streaming, the
        // live socket would continue to authenticate with the previous key until
        // its next reconnect — which is the wrong behavior for a security-relevant
        // setter (e.g. rotation of a leaked key). Mirror setRecognitionLanguage's
        // close+reopen so a rotated key takes effect immediately.
        if (changed && this.isActive && this.mode === 'ws') {
            console.log('[OpenAIStreaming] Reconnecting WS to apply new API key');
            this._closeWs(true);
            this._connectWs();
        }
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
        this.ringEvictedThisSession = false;
        this.ringEvictedBytes = 0;
        this.rateLimitWarned.clear();
        // Defensive: if a prior stop() raced an in-flight REST upload, these
        // flags might be stale. Clean slate guarantees the first REST flush
        // after restart isn't surprise-deferred by an orphaned axios promise.
        this.restIsUploading  = false;
        this.restFlushPending = false;
        this.turnCoalescer.reset();

        // Custom endpoints (e.g. Speaches) don't implement OpenAI's Realtime WebSocket
        // protocol. Go straight to REST mode for them.
        if (this.isCustomEndpoint) {
            this.mode = 'rest';
            this._switchToRest();
            return;
        }

        this.mode = 'ws';
        this._connectWs();
    }

    public stop(): void {
        if (!this.isActive) return;
        console.log('[OpenAIStreaming] Stopping...');
        this._flushTurnCoalescer();
        this.isActive        = false;
        this.shouldReconnect = false;

        // Flush any remaining buffered audio to the WS before closing so we
        // don't silently drop up to ~250ms of speech at the end of a session.
        // Then commit the input buffer so the server transcribes the trailing
        // audio even if its VAD hasn't tripped on the silence yet.
        // Split append/commit into separate try blocks: a failed append must NOT
        // bypass the commit — the server still has buffered audio from prior
        // _sendWsAudioChunk calls that should be transcribed.
        if (this.mode === 'ws' && this.ws?.readyState === WebSocket.OPEN &&
            this.isSessionReady) {
            try {
                if (this.pcmAccumulatorLen > 0) {
                    const combined = new Int16Array(this.pcmAccumulatorLen);
                    let offset = 0;
                    for (const arr of this.pcmAccumulator) {
                        combined.set(arr, offset);
                        offset += arr.length;
                    }
                    this.ws.send(JSON.stringify({
                        type:  'input_audio_buffer.append',
                        audio: Buffer.from(combined.buffer).toString('base64'),
                    }));
                }
            } catch (err) {
                console.warn('[OpenAIStreaming][WS] Stop append failed (continuing to commit):', err);
            }
            try {
                this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                console.log('[OpenAIStreaming][WS] Stop — committed input buffer');
            } catch (err) {
                console.warn('[OpenAIStreaming][WS] Stop commit failed:', err);
            }
        }

        this._clearTimers();
        this._closeWs(false);
        this._stopRestTimer();

        this.restChunks     = [];
        this.restTotalBytes = 0;
        // Reset REST flush state too — without this, a `restFlushPending=true`
        // left over from an in-flight upload at stop time would cause the
        // finally re-entry in _restFlushAndUpload() to schedule another
        // upload that the new isActive guard at entry now correctly rejects,
        // but it's cleaner to flip the latch here so future readers don't
        // wonder why the entry guard exists at all.
        this.restFlushPending = false;
        // Note: restIsUploading is NOT reset to false synchronously — there
        // may be an in-flight axios POST whose finally needs to observe the
        // true value to take its early-return branch. The axios timeout caps
        // the wait at 30s in the worst case.
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

    public finalize(): void {
        if (!this.isActive) return;
        if (this.mode === 'rest') {
            console.log('[OpenAIStreaming][REST] Finalize — flushing buffer');
            this._restFlushAndUpload();
            return;
        }
        if (this.ws?.readyState !== WebSocket.OPEN || !this.isSessionReady) return;

        // Split append/commit into separate try blocks — a failed append must
        // not bypass the commit; server-buffered audio from earlier chunks
        // should still be transcribed.
        try {
            if (this.pcmAccumulatorLen > 0) {
                const combined = new Int16Array(this.pcmAccumulatorLen);
                let offset = 0;
                for (const arr of this.pcmAccumulator) {
                    combined.set(arr, offset);
                    offset += arr.length;
                }
                this.pcmAccumulator = [];
                this.pcmAccumulatorLen = 0;
                this.ws.send(JSON.stringify({
                    type:  'input_audio_buffer.append',
                    audio: Buffer.from(combined.buffer).toString('base64'),
                }));
            }
        } catch (err) {
            console.error('[OpenAIStreaming][WS] Finalize append failed (continuing to commit):', err);
        }
        try {
            this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            console.log('[OpenAIStreaming][WS] Finalize — committed input buffer');
        } catch (err) {
            console.error('[OpenAIStreaming][WS] Finalize commit failed:', err);
        }
        // Do not flush the coalescer here — commit triggers server VAD/transcription
        // and speech_stopped will emit one coalesced final. Flushing here duplicates
        // the same text as a second final turn downstream.
    }

    // ─── WebSocket Path ───────────────────────────────────────────────────────

    private _connectWs(): void {
        if (this.isConnecting || !this.shouldReconnect) return;
        this.isConnecting  = true;
        this.isSessionReady = false;

        // Defensive: ensure no stale timers from a previous connect attempt
        // remain armed against the next socket. _closeWs() should have cleared
        // these, but if _connectWs is ever called without a prior close (e.g.
        // future refactor), we don't want an orphaned 10s timer to kill the
        // new socket out of nowhere.
        this._clearConnectAndSessionTimers();

        const model: WsModel = WS_MODELS[this.wsModelIndex] ?? WS_MODELS[0];
        console.log(`[OpenAIStreaming] Connecting WebSocket (model=${model}, attempt=${this.reconnectAttempts + 1})...`);

        // streamingStttWsOptions: IPv4-only DNS + 15s handshake cap (dnsHelpers.ts).
        this.ws = new WebSocket(REALTIME_WS_URL, streamingStttWsOptions({
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            },
        }) as WebSocket.ClientOptions);

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

            // Start 5-second timeout waiting for session.created from server
            this.sessionSetupTimer = setTimeout(() => {
                console.warn(`[OpenAIStreaming] Server accepted connection but failed to create session within 5s. Forcing disconnect...`);
                // Force a disconnect to trigger the fallback logic. Mirror the
                // connectionTimeoutTimer callback by explicitly clearing
                // isConnecting — _handleWsClose will also clear it, but the
                // symmetry guards against a refactor that breaks one path.
                if (this.ws) {
                    this.ws.removeAllListeners();
                    this.ws.close();
                    this.ws = null;
                    this.isConnecting = false;
                    this._handleWsClose(1008, Buffer.from('Session Setup Timeout'));
                }
            }, 5_000);

            // Configure the transcription session
            // 'auto' key → empty string so Whisper/gpt-4o-transcribe auto-detects the language
            const lang = (this.languageKey && this.languageKey !== 'auto')
                ? (RECOGNITION_LANGUAGES[this.languageKey]?.iso639 ?? '')
                : '';

            const transcription: { model: string; language?: string } = { model };
            if (lang) transcription.language = lang;

            this.ws!.send(JSON.stringify({
                type: 'session.update',
                session: {
                    type: 'transcription',
                    audio: {
                        input: {
                            format: {
                                type: 'audio/pcm',
                                rate: WS_SAMPLE_RATE,
                            },
                            transcription,
                            noise_reduction: { type: 'near_field' },
                            turn_detection: {
                                type:                'server_vad',
                                threshold:           0.5,
                                prefix_padding_ms:   300,
                                // 1000ms reduces micro-turns that fragment one sentence into
                                // many word-sized completed events (overlay queue rows).
                                silence_duration_ms: 1000,
                            },
                        },
                    },
                },
            }));
        });

        this.ws.on('message', (raw: WebSocket.Data) => {
            try {
                // WebSocket.Data is `Buffer | ArrayBuffer | Buffer[]`. On fragmented
                // frames `ws` delivers an array of Buffers — calling `.toString()`
                // on the array would yield "buf1,buf2" (Array.prototype.toString),
                // failing JSON.parse silently. Normalize first.
                const text = Array.isArray(raw)
                    ? Buffer.concat(raw).toString('utf8')
                    : Buffer.isBuffer(raw)
                        ? raw.toString('utf8')
                        : raw instanceof ArrayBuffer
                            ? Buffer.from(raw).toString('utf8')
                            : String(raw);
                const msg = JSON.parse(text);
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
        // Tear down per-connect timers + keepalive. We deliberately leave
        // `reconnectTimer` alone here — the close path may want to (re-)arm it
        // a few lines down via _scheduleWsReconnect when shouldReconnect=true.
        this._clearKeepAlive();
        this._clearConnectAndSessionTimers();
        console.log(`[OpenAIStreaming] WS closed (code=${code}, reason=${reason.toString() || 'none'})`);

        if (!this.shouldReconnect) return;

        // Count this as a failure
        this.wsFailures++;

        if (this.wsFailures >= MAX_WS_FAILURES_PER_MODEL) {
            // Advance to next WebSocket model
            this.wsModelIndex++;
            this.wsFailures = 0;

            if (this.wsModelIndex >= WS_MODELS.length) {
                // All WS models exhausted — fall back to REST. Surface this to
                // upstream so main.ts's _consecutiveErrors counter advances on
                // sustained WS-layer outages (DNS/TLS/RST) that otherwise churn
                // silently — without this emit, the user would see no banner and
                // no transcripts, just dead air.
                const msg = 'All WebSocket transcription models failed — falling back to whisper-1 REST';
                console.warn(`[OpenAIStreaming] ${msg}`);
                this.emit('error', new Error(msg));
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
        // Late-arrival guard. The ws library can deliver a buffered server frame
        // (e.g. session.created) after we have called stop() but
        // before removeAllListeners() drained. Without this guard, the late
        // frame would set isSessionReady=true and call _startKeepAlive(), leaking
        // a 20s setInterval against a class the caller thinks is shut down.
        if (!this.isActive) return;
        switch (msg.type) {
            case 'session.created':
            case 'transcription_session.created':
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

            case 'conversation.item.input_audio_transcription.delta': {
                const partial = this.turnCoalescer.onDelta(msg.delta ?? '');
                if (partial) {
                    this._emitTranscript(partial, false);
                }
                break;
            }

            case 'conversation.item.input_audio_transcription.completed': {
                const preview = this.turnCoalescer.onCompleted(msg.transcript ?? '');
                if (preview) {
                    this._emitTranscript(preview, false);
                }
                break;
            }

            // Quota observability. OpenAI emits rate_limits.updated each turn
            // with { name, limit, remaining, reset_seconds } per limit type
            // (requests, tokens, ...). Surface a one-shot upstream warning per
            // limit name when remaining/limit drops below 10% — gives the user
            // a soft heads-up before hard 'error' events from the server.
            case 'rate_limits.updated': {
                const limits = Array.isArray(msg.rate_limits) ? msg.rate_limits : [];
                for (const entry of limits) {
                    if (!entry || typeof entry !== 'object') continue;
                    const name = String(entry.name ?? 'unknown');
                    const limit = Number(entry.limit);
                    const remaining = Number(entry.remaining);
                    if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) continue;
                    const ratio = remaining / limit;
                    if (ratio < 0.1 && !this.rateLimitWarned.has(name)) {
                        this.rateLimitWarned.add(name);
                        const resetSec = Number(entry.reset_seconds);
                        console.warn(
                            `[OpenAIStreaming] Rate limit low: ${name} ${remaining}/${limit} ` +
                            `(${(ratio * 100).toFixed(1)}%${Number.isFinite(resetSec) ? `, resets in ${resetSec}s` : ''})`
                        );
                        this.emit('warning', {
                            code: 'rate_limit_low',
                            message: `OpenAI ${name} quota near exhaustion`,
                            name,
                            limit,
                            remaining,
                            resetSeconds: Number.isFinite(resetSec) ? resetSec : undefined,
                        });
                    }
                }
                break;
            }

            // Server's ACK of our session.update. Useful for confirming the server
            // applied our requested config — log only, no behavior change required.
            case 'session.updated':
            case 'transcription_session.updated':
                console.log('[OpenAIStreaming] Session config applied by server');
                break;

            // VAD events emitted by the server (informational — we don't need to act on them)
            case 'input_audio_buffer.speech_started': {
                console.log('[OpenAIStreaming] Server VAD: speech started');
                const orphan = this.turnCoalescer.onSpeechStarted();
                if (orphan) {
                    this._emitTranscript(orphan, true);
                }
                break;
            }
            case 'input_audio_buffer.speech_stopped': {
                console.log('[OpenAIStreaming] Server VAD: speech stopped');
                const finalText = this.turnCoalescer.onSpeechStopped();
                if (finalText) {
                    console.log(`[OpenAIStreaming] Final transcript received`, { length: finalText.length });
                    this._emitTranscript(finalText, true);
                }
                break;
            }
            case 'input_audio_buffer.committed':
                // Audio chunk committed for transcription
                break;

            case 'error': {
                const rawErrMsg = msg.error?.message ?? JSON.stringify(msg);
                // Defensive scrub: if the server ever echoes back the Authorization
                // header (or any 'Bearer sk-…' string) inside an error body, do not
                // log or propagate the secret. Mirrors the STT key scrubbing posture
                // from the May 24 telemetry change.
                const errMsg = OpenAIStreamingSTT._scrubBearerTokens(rawErrMsg);
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

    private _emitTranscript(text: string, isFinal: boolean): void {
        const trimmed = text.trim();
        if (!trimmed) return;
        if (isFinal) {
            const now = Date.now();
            if (
                trimmed === this.lastFinalEmitText &&
                now - this.lastFinalEmitAt < OpenAIStreamingSTT.FINAL_DEDUPE_MS
            ) {
                return;
            }
            this.lastFinalEmitText = trimmed;
            this.lastFinalEmitAt = now;
        }
        this.emit('transcript', {
            text:       trimmed,
            isFinal,
            confidence: 1.0,
        });
    }

    private _flushTurnCoalescer(): void {
        const finalText = this.turnCoalescer.flush();
        if (finalText) {
            console.log(`[OpenAIStreaming] Flushed coalesced transcript`, { length: finalText.length });
            this._emitTranscript(finalText, true);
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
        // Tear down ALL pending timers before touching the socket:
        //   - keepAliveTimer: prevent stale-socket sends
        //   - reconnectTimer: prevent a 30s-pending reconnect from firing into a
        //     replacement socket (the phantom-reconnect bug after language change)
        //   - connectionTimeoutTimer / sessionSetupTimer: prevent the next
        //     connect from being killed by a previous connect's timer.
        this._clearTimers();
        if (!this.ws) return;
        // GA transcription intent has no client→server session.close — that event
        // only exists for the translation subresource. Sending it on intent=transcription
        // produces a server `error` (unknown_type) which would bubble as a meeting-end
        // error on every language change. TCP-level close is sufficient.
        // For a graceful tear-down (language change) we flush any pending PCM and
        // commit the input buffer before closing so server-buffered audio isn't dropped.
        if (graceful && this.ws.readyState === WebSocket.OPEN && this.isSessionReady) {
            try {
                if (this.pcmAccumulatorLen > 0) {
                    const combined = new Int16Array(this.pcmAccumulatorLen);
                    let offset = 0;
                    for (const arr of this.pcmAccumulator) {
                        combined.set(arr, offset);
                        offset += arr.length;
                    }
                    this.ws.send(JSON.stringify({
                        type:  'input_audio_buffer.append',
                        audio: Buffer.from(combined.buffer).toString('base64'),
                    }));
                }
            } catch (err) {
                console.warn('[OpenAIStreaming][WS] Graceful append failed:', err);
            }
            try {
                this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            } catch (err) {
                console.warn('[OpenAIStreaming][WS] Graceful commit failed:', err);
            }
        }
        this.ws.removeAllListeners();
        this.ws.close();
        this.ws = null;
        this.isSessionReady = false;
        this.isConnecting = false; // Allow immediate reconnect (e.g. language change)
        this.pcmAccumulator = [];
        this.pcmAccumulatorLen = 0;
        // Timers were already cleared at the top of this method via _clearTimers().
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

    /** Strip Bearer / sk-… tokens from any string we might log or propagate upstream.
     *  Case-insensitive: HTTP header names are case-insensitive and lowercased
     *  `bearer …` shows up in JSON-serialized error bodies from some proxies. */
    private static _scrubBearerTokens(s: string): string {
        return s
            .replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, 'Bearer [REDACTED]')
            .replace(/sk-[A-Za-z0-9_\-]{10,}/gi, 'sk-[REDACTED]');
    }

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

    /** Per-connect timers (10s handshake + 5s session-setup). Cleared in three
     *  places (start of `_connectWs`, after a synthetic close in `_handleWsClose`,
     *  and via `_clearTimers`) — factor so adding a new one means editing once. */
    private _clearConnectAndSessionTimers(): void {
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
            this.connectionTimeoutTimer = null;
        }
        if (this.sessionSetupTimer) {
            clearTimeout(this.sessionSetupTimer);
            this.sessionSetupTimer = null;
        }
    }

    private _clearTimers(): void {
        this._clearKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this._clearConnectAndSessionTimers();
    }

    // ─── Ring Buffer (pre-buffer during connecting / transitions) ────────────

    private _ringBufferPush(chunk: Buffer): void {
        this.ringBuffer.push(chunk);
        this.ringBufferBytes += chunk.length;

        // Evict oldest chunks when over limit
        let evictedBytesThisCall = 0;
        while (this.ringBufferBytes > MAX_RING_BUFFER_BYTES && this.ringBuffer.length > 0) {
            const evicted = this.ringBuffer.shift()!;
            this.ringBufferBytes -= evicted.length;
            evictedBytesThisCall += evicted.length;
        }

        if (evictedBytesThisCall > 0) {
            this.ringEvictedBytes += evictedBytesThisCall;
            // Log + emit a non-fatal warning once per session so upstream telemetry
            // can surface that leading speech was dropped while waiting for the WS
            // handshake. After the first hit we accumulate silently to avoid log spam.
            if (!this.ringEvictedThisSession) {
                this.ringEvictedThisSession = true;
                console.warn(
                    `[OpenAIStreaming] Ring buffer evicted ${evictedBytesThisCall} bytes ` +
                    `(cap=${MAX_RING_BUFFER_BYTES}). Session not yet ready — leading audio dropped.`
                );
                this.emit('warning', {
                    code: 'ring_buffer_eviction',
                    message: 'Leading audio dropped while waiting for STT session to become ready',
                    droppedBytes: evictedBytesThisCall,
                });
            }
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

    /** REST mode is terminal for this STT instance — once we fall back to
     *  whisper-1 REST, we don't try to climb back to WS within the same session.
     *  A user must call `stop()` and `start()` again to retry the WS path. */
    private _switchToRest(): void {
        this.mode = 'rest';
        // _closeWs() now routes through _clearTimers() (R3-1), so we don't
        // need a separate _clearTimers() call here.
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
        // Mirror the RestSTT.flushAndUpload guard (Issue 7). Without this, the
        // finally-re-entrancy at line ~970 (`if (this.restFlushPending)
        // this._restFlushAndUpload()`) can fire AFTER stop() has cleared
        // restChunks and the next meeting may already have started — and
        // the trailing in-flight upload would emit 'transcript' into the new
        // session. Same class of bug as RestSTT's leak; gating here closes
        // it on the OpenAI provider too.
        if (!this.isActive) return;

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
        const wavBuffer = this._addWavHeader(pcm16k, REST_SAMPLE_RATE);
        this.restIsUploading = true;

        try {
            const transcript = await this._restUpload(wavBuffer);
            if (transcript && transcript.trim().length > 0) {
                console.log(`[OpenAIStreaming][REST] Transcript received`, { length: transcript.trim().length });
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

        const lang = (this.languageKey && this.languageKey !== 'auto')
            ? (RECOGNITION_LANGUAGES[this.languageKey]?.iso639 ?? '')
            : '';
        if (lang) form.append('language', lang);

        const response = await axios.post(this.restEndpoint, form, {
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

    /** Build a WAV file header for mono 16-bit PCM at the given sample rate.
     *  The caller is responsible for passing the correct rate that matches `samples`. */
    private _addWavHeader(samples: Buffer, sampleRate: number): Buffer {
        const buf = Buffer.alloc(44 + samples.length);
        buf.write('RIFF', 0);
        buf.writeUInt32LE(36 + samples.length, 4);
        buf.write('WAVE', 8);
        buf.write('fmt ', 12);
        buf.writeUInt32LE(16, 16);
        buf.writeUInt16LE(1, 20);                                                                   // PCM
        buf.writeUInt16LE(NUM_CHANNELS, 22);
        buf.writeUInt32LE(sampleRate, 24);
        buf.writeUInt32LE(sampleRate * NUM_CHANNELS * (BITS_PER_SAMPLE / 8), 28);
        buf.writeUInt16LE(NUM_CHANNELS * (BITS_PER_SAMPLE / 8), 32);
        buf.writeUInt16LE(BITS_PER_SAMPLE, 34);
        buf.write('data', 36);
        buf.writeUInt32LE(samples.length, 40);
        samples.copy(buf, 44);
        return buf;
    }
}
