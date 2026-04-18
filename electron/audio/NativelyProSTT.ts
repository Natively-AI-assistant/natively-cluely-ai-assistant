import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES, EnglishVariant } from '../config/languages';

/**
 * NativelyProSTT
 *
 * Connects to the Natively API WebSocket transcription endpoint.
 * Forwards the user's selected accent/language to the server so
 * Deepgram / Google STT use the correct language model.
 *
 * Auth frame (first message after open):
 *   { key, sample_rate, language, language_alternates, audio_channels }
 *
 * All subsequent messages are binary LINEAR16 PCM audio.
 */
export class NativelyProSTT extends EventEmitter {
    private apiKey: string;
    private channel: string;  // 'system' | 'mic' — disambiguates concurrent streams per key
    private ws: WebSocket | null = null;
    private isActive           = false;
    private isConnected        = false;
    private isConnecting       = false;
    private intentionalClose   = false;  // set true before deliberate closeUpstream() to suppress auto-reconnect
    private sampleRate    = 16000;
    private audioChannels = 1;
    private buffer: Buffer[] = [];

    // Language state — updated via setRecognitionLanguage()
    private languageBcp47          = 'en-US';
    private languageAlternates: string[] = [];
    // The key the caller last configured (e.g. 'auto', 'english-us').
    // Preserved so stop() can reset languageBcp47 back to the configured value,
    // ensuring the next start() sends 'auto' again rather than a stale detected language.
    private configuredLanguageKey  = 'en-US';

    private reconnectAttempts = 0;
    private readonly MAX_RECONNECT   = 5;
    private readonly RECONNECT_BASE_MS = 1500;
    private reconnectTimer: NodeJS.Timeout | null = null;
    // Cleared only after 5 s of stable connection so backoff actually increases on rapid 1006 loops
    private stabilityTimer: NodeJS.Timeout | null = null;

    private readonly BACKEND_URL = 'wss://api.natively.software/v1/transcribe';

    // Static: stagger concurrent connections with the same key so both instances
    // don't hit the server (and its upstream Deepgram key rotation) simultaneously.
    private static readonly nextSlotByKey = new Map<string, number>();
    private static readonly SLOT_INTERVAL_MS = 3000;

    constructor(apiKey: string, channel: 'system' | 'mic' = 'system') {
        super();
        this.apiKey  = apiKey;
        this.channel = channel;
    }

    // ── Configuration setters ─────────────────────────────────

    public setSampleRate(rate: number): void {
        this.sampleRate = rate;
        console.log(`[NativelyProSTT:${this.channel}] Sample rate configured to ${rate}Hz`);
    }

    public setAudioChannelCount(count: number): void {
        this.audioChannels = count;
    }

    /**
     * Converts the internal language key (e.g. "english-us", "russian")
     * into BCP-47 codes and stores them for the next handshake.
     * If the stream is already active, reconnect so the new language takes effect.
     */
    public setRecognitionLanguage(key: string): void {
        this.configuredLanguageKey = key;  // remember for stop() reset

        // 'auto' is a sentinel — send it as-is so the backend does parallel batch detection.
        if (key === 'auto') {
            this.languageBcp47      = 'auto';
            this.languageAlternates = [];
            console.log('[NativelyProSTT] Language set to auto-detect mode');
        } else {
            const config = RECOGNITION_LANGUAGES[key];
            if (!config) {
                console.warn(`[NativelyProSTT] Unknown language key: ${key}`);
                return;
            }
            this.languageBcp47      = config.bcp47;
            this.languageAlternates = 'alternates' in config
                ? (config as EnglishVariant).alternates
                : [];
            console.log(`[NativelyProSTT] Language set: ${key} → ${this.languageBcp47}`,
                this.languageAlternates.length ? `(alts: ${this.languageAlternates.join(', ')})` : '');
        }

        // Reconnect with new language if already running.
        // Set intentionalClose=true so the ws.on('close') handler does NOT
        // also schedule a reconnect — we call connect() ourselves below.
        if (this.isActive && this.ws) {
            console.log('[NativelyProSTT] Language changed while active — reconnecting');
            this.reconnectAttempts = 0;  // reset counter so the new session starts fresh
            this.intentionalClose  = true;
            this.closeUpstream();
            // Small delay so the server processes the old socket's close event before
            // the new connection arrives — prevents concurrent_session_blocked race.
            setTimeout(() => { if (this.isActive) this.connect(); }, 250);
        }
    }

    /** No-op — Natively API server handles VAD internally */
    public notifySpeechEnded(): void {}

    public setCredentials(_path: string): void {}

    // ── Lifecycle ─────────────────────────────────────────────

    public start(): void {
        if (this.isActive) return;
        this.isActive         = true;
        this.reconnectAttempts = 0;
        this.connect();
    }

    public stop(): void {
        this.isActive         = false;
        this._chunksSent      = 0;
        this.intentionalClose = false;  // Reset so a subsequent start() can reconnect normally

        // Restore the configured language so the next start() uses the right handshake value.
        // Without this, a language_detected reconnect would leave languageBcp47 = 'fr-FR'
        // and the next meeting would start with French pinned instead of 'auto'.
        if (this.configuredLanguageKey === 'auto') {
            this.languageBcp47     = 'auto';
            this.languageAlternates = [];
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.stabilityTimer) {
            clearTimeout(this.stabilityTimer);
            this.stabilityTimer = null;
        }
        this.closeUpstream();
        this.buffer = [];
    }

    private _chunksSent = 0;

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.buffer.push(chunk);
            // Cap buffer to prevent unbounded memory growth
            if (this.buffer.length > 500) this.buffer.shift();
            // Log first few buffered chunks so we can tell if audio is arriving before connect
            if (this.buffer.length <= 3 || this.buffer.length % 100 === 0) {
                const wsState = this.ws ? ['CONNECTING','OPEN','CLOSING','CLOSED'][this.ws.readyState] || this.ws.readyState : 'null';
                console.log(`[NativelyProSTT:${this.channel}] Buffering chunk (buffer=${this.buffer.length}, isConnected=${this.isConnected}, ws=${wsState})`);
            }
            return;
        }

        this._chunksSent++;
        if (this._chunksSent <= 5 || this._chunksSent % 200 === 0) {
            console.log(`[NativelyProSTT:${this.channel}] Sent chunk #${this._chunksSent} (${chunk.length}B) to server`);
        }
        this.ws.send(chunk);
    }

    // ── Internal ──────────────────────────────────────────────

    private connect(skipStagger = false): void {
        if (this.isConnecting || !this.isActive) return;

        if (!skipStagger) {
            // Stagger connections for the same key to avoid concurrent server collisions.
            // If the server received two connections within SLOT_INTERVAL_MS, it (or its
            // upstream Deepgram key pool) can fail both with 1006.
            const now = Date.now();
            const reserved = NativelyProSTT.nextSlotByKey.get(this.apiKey) ?? 0;
            const staggerMs = Math.max(0, reserved - now);
            NativelyProSTT.nextSlotByKey.set(this.apiKey, Math.max(now, reserved) + NativelyProSTT.SLOT_INTERVAL_MS);

            if (staggerMs > 0) {
                this.isConnecting = true; // Hold the slot while waiting
                console.log(`[NativelyProSTT:${this.channel}] Staggering connection ${staggerMs}ms (concurrent key collision prevention)`);
                setTimeout(() => {
                    this.isConnecting = false;
                    if (this.isActive) this.connect(true);
                }, staggerMs);
                return;
            }
        }

        this.isConnecting = true;
        this.isConnected  = false;

        console.log(`[NativelyProSTT] Connecting (attempt ${this.reconnectAttempts + 1})...`);

        this.ws = new WebSocket(this.BACKEND_URL);

        this.ws.on('open', () => {
            if (!this.isActive) { this.ws?.close(); return; }

            // Build auth + config handshake.
            // When the key is the trial sentinel, swap it for the real trial token
            // in the trial_token field — the server validates that separately.
            const baseFrame: Record<string, unknown> = {
                sample_rate:         this.sampleRate,
                language:            this.languageBcp47,
                language_alternates: this.languageAlternates,
                audio_channels:      this.audioChannels,
                channel:             this.channel,
            };
            if (this.apiKey === '__trial__') {
                try {
                    const { CredentialsManager } = require('../services/CredentialsManager');
                    const trialToken = CredentialsManager.getInstance().getTrialToken();
                    if (trialToken) baseFrame.trial_token = trialToken;
                } catch { /* CredentialsManager unavailable — connection will be rejected by server */ }
            } else {
                baseFrame.key = this.apiKey;
            }

            this.ws!.send(JSON.stringify(baseFrame));
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());
                // Log every server message (excluding frequent interim transcripts)
                if (!msg.text || msg.is_final) {
                    console.log(`[NativelyProSTT:${this.channel}] Server msg:`, JSON.stringify(msg).slice(0, 120));
                }

                if (msg.error) {
                    console.error('[NativelyProSTT] Server error:', msg.error, msg.message || '');
                    this.emit('error', new Error(msg.error));
                    // Fatal errors — stop reconnecting entirely
                if (msg.error === 'auth_timeout' ||
                        msg.error === 'invalid_key_format' ||
                        msg.error === 'transcription_quota_exceeded') {
                    this.isActive = false;
                }
                // concurrent_session_blocked is NOT fatal — it means the intentional
                // reconnect (language/sample-rate change) arrived at the server before
                // the old socket's close event was processed. The server closes the WS
                // after sending this error, so ws.on('close') will fire and
                // scheduleReconnect() will retry after 1.5s by which time the old
                // session is guaranteed to be cleaned up.
                //
                // upstream_closed / upstream_error: server has already closed the WS,
                // the ws.on('close') handler will schedule a reconnect automatically.
                // Nothing to do here beyond the emit above.
                return;
                }

                if (msg.status === 'connected') {
                    this.isConnecting = false;
                    this.isConnected  = true;
                    console.log(`[NativelyProSTT] Connected via ${msg.provider}`);
                    // Delay resetting reconnectAttempts: only reset after 5 s of stability.
                    // An immediate reset means every rapid 1006 loop re-uses the minimum
                    // 1500 ms delay, causing an infinite tight reconnect storm.
                    if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
                    this.stabilityTimer = setTimeout(() => {
                        this.stabilityTimer = null;
                        this.reconnectAttempts = 0;
                    }, 5000);
                    this.flushBuffer();
                    return;
                }

                // Server detected language from the first audio batch (auto mode).
                // Reconnect the stream with the detected BCP-47 code so transcripts
                // are routed through the correct language model from here on.
                if (msg.language_detected) {
                    const detected: string = msg.language_detected;
                    console.log(`[NativelyProSTT] Auto-detected language: ${detected}`);
                    this.languageBcp47      = detected;
                    this.languageAlternates = [];
                    this.reconnectAttempts  = 0;  // fresh session — reset backoff counter
                    this.emit('languageDetected', detected);
                    if (this.isActive && this.ws) {
                        this.intentionalClose = true;
                        this.closeUpstream();
                        setTimeout(() => { if (this.isActive) this.connect(); }, 250);
                    }
                    return;
                }

                if (msg.text) {
                    this.emit('transcript', {
                        text:       msg.text,
                        isFinal:    msg.is_final    ?? false,
                        confidence: msg.confidence  ?? 1.0,
                    });
                }
            } catch (err) {
                console.error('[NativelyProSTT] Parse error:', err);
            }
        });

        this.ws.on('error', (err: Error) => {
            console.error('[NativelyProSTT] WebSocket error:', err.message);
            this.isConnecting = false;
            this.isConnected  = false;
            this.emit('error', err);
        });

        this.ws.on('close', (code: number) => {
            this.isConnecting = false;
            this.isConnected  = false;
            console.log(`[NativelyProSTT] Connection closed (code ${code})`);

            // Skip auto-reconnect if this close was intentional (e.g. language change)
            if (this.intentionalClose) {
                this.intentionalClose = false;
                return;
            }

            if (this.isActive) {
                this.scheduleReconnect();
            }
        });
    }

    private scheduleReconnect(): void {
        if (!this.isActive) return;
        this._chunksSent = 0;  // Reset per-session counter so chunk #N logs reflect the new session
        // Connection dropped before stability window — cancel the backoff reset
        if (this.stabilityTimer) { clearTimeout(this.stabilityTimer); this.stabilityTimer = null; }
        if (this.reconnectAttempts >= this.MAX_RECONNECT) {
            console.error('[NativelyProSTT] Max reconnect attempts reached — giving up');
            this.emit('error', new Error('NativelyProSTT: max reconnect attempts exceeded'));
            return;
        }

        const delay = this.RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;
        console.log(`[NativelyProSTT] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT})...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.isActive) this.connect();
        }, delay);
    }

    private flushBuffer(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        while (this.buffer.length > 0) {
            const chunk = this.buffer.shift();
            if (chunk) this.ws.send(chunk);
        }
    }

    private closeUpstream(): void {
        this.isConnected  = false;
        this.isConnecting = false;
        if (this.ws) {
            try { this.ws.close() } catch {}
            this.ws = null;
        }
    }
}
