import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES, EnglishVariant } from '../config/languages';
import { TRIAL_SENTINEL_KEY } from '../config/constants';
import { streamingStttWsOptions } from './dnsHelpers';

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
    // Soft cap: at 48 kHz stereo / 20 ms frames a chunk is ~3.8 KB, so 500 chunks
    // ≈ 10 s of audio. Above this, the disconnect window has clearly exceeded
    // what live transcription can usefully recover, and continuing to grow risks
    // unbounded memory under a long network outage. We emit an event so the UI
    // can surface the loss; we log a single rate-limited warning per session so
    // operators can correlate with reconnect storms.
    private readonly BUFFER_MAX_CHUNKS = 500;
    private bufferOverflowReported = false;
    private bufferDroppedChunks = 0;

    // Language state — updated via setRecognitionLanguage()
    private languageBcp47          = 'en-US';
    private languageAlternates: string[] = [];
    // The key the caller last configured (e.g. 'auto', 'english-us').
    // Preserved so stop() can reset languageBcp47 back to the configured value,
    // ensuring the next start() sends 'auto' again rather than a stale detected language.
    private configuredLanguageKey  = 'en-US';

    private reconnectAttempts = 0;
    private readonly RECONNECT_BASE_MS = 1500;
    // Cap exponential backoff so a long disconnect doesn't push the delay into
    // multi-minute territory. Without this, attempt #10 would sleep
    // 1500 × 2^9 ≈ 13 minutes before the next try — by which time the user has
    // long since given up. 30s is the standard ceiling for streaming services.
    private readonly MAX_BACKOFF_MS    = 30_000;
    // Soft warning threshold — when reconnect attempts cross this, surface a
    // "still trying to reconnect" UI signal so the user knows the issue is
    // network/server side, not their app.
    private readonly RECONNECT_WARN_AFTER = 5;
    private readonly DNS_RETRY_MS     = 10_000;  // fixed delay for ENOTFOUND — don't burn backoff on DNS blips
    private isDnsFailure = false;  // true when last error was a DNS resolution failure
    private reconnectTimer: NodeJS.Timeout | null = null;
    // Cleared only after 5 s of stable connection so backoff actually increases on rapid 1006 loops
    private stabilityTimer: NodeJS.Timeout | null = null;
    // The three 250ms reconnect setTimeouts in setSampleRate, setRecognitionLanguage,
    // and the language_detected handler used to be untracked. If stop() then start()
    // ran within that 250ms window, the orphan timer fired against the NEW session
    // and triggered a duplicate connect — one ws would lose the race, emit close, and
    // kick off a reconnect cascade that briefly dropped transcripts. Track them so
    // start()/stop() can cancel any in-flight inline timer.
    private pendingConnectTimer: NodeJS.Timeout | null = null;

    private readonly BACKEND_URL = 'wss://api.natively.software/v1/transcribe';

    constructor(apiKey: string, channel: 'system' | 'mic' = 'system') {
        super();
        this.apiKey  = apiKey;
        this.channel = channel;
    }

    // ── Configuration setters ─────────────────────────────────

    public setSampleRate(rate: number): void {
        if (rate === this.sampleRate) return;
        const previousRate = this.sampleRate;
        this.sampleRate = rate;
        console.log(`[NativelyProSTT:${this.channel}] Sample rate ${previousRate}Hz → ${rate}Hz`);

        // Mid-stream rate change requires reconnection — but ONLY if the
        // server has already confirmed the handshake (`isConnected === true`).
        // Once the auth frame is committed at the old rate, the server feeds
        // its upstream STT bytes-as-old-rate; switching the actual rate of the
        // bytes without reconnecting produces sped-up/slowed-down garbage
        // transcripts.
        //
        // The pre-handshake states do NOT need a reconnect:
        //   - this.ws === null:           still in stagger or never started.
        //                                 connect()'s open handler will read
        //                                 the (now-updated) this.sampleRate.
        //   - ws.readyState === CONNECTING: WS open, but auth frame not sent
        //                                   yet (we send it in 'open'). Same
        //                                   thing — the open handler reads the
        //                                   updated rate.
        // Reconnecting in either of these states tears down a connection that
        // was about to use the right value anyway, costs us a fresh TLS
        // handshake round-trip, and surfaces an unsightly "WebSocket was
        // closed before the connection was established" error in the logs.
        // The system-channel STT was hitting this on every meeting start
        // because Rust publishes its real device rate (48kHz on macOS
        // CoreAudio Tap) ~5-7s after start(), which is exactly when the first
        // chunk arrives — long before the server has confirmed the
        // handshake.
        if (this.isActive && this.isConnected) {
            console.log(`[NativelyProSTT:${this.channel}] Rate changed mid-stream — reconnecting WS so server uses the new declared rate.`);
            this.reconnectAttempts = 0;     // fresh session — reset backoff
            this.intentionalClose  = true;  // don't re-trigger via close handler
            this.closeUpstream();
            // Same 250ms gap pattern as setRecognitionLanguage to avoid the
            // server's concurrent_session_blocked race.
            if (this.pendingConnectTimer) clearTimeout(this.pendingConnectTimer);
            this.pendingConnectTimer = setTimeout(() => {
                this.pendingConnectTimer = null;
                if (this.isActive) this.connect();
            }, 250);
        }
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
            const config = RECOGNITION_LANGUAGES.auto;
            this.languageBcp47      = 'auto';
            this.languageAlternates = config.alternates ?? [];
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
        // Same gating as setSampleRate: only reconnect when the handshake has
        // committed (isConnected). If we're still mid-connect, the upcoming
        // 'open' handler will use the just-updated language fields.
        if (this.isActive && this.isConnected) {
            console.log('[NativelyProSTT] Language changed while active — reconnecting');
            this.reconnectAttempts = 0;  // reset counter so the new session starts fresh
            this.intentionalClose  = true;
            this.closeUpstream();
            // Small delay so the server processes the old socket's close event before
            // the new connection arrives — prevents concurrent_session_blocked race.
            if (this.pendingConnectTimer) clearTimeout(this.pendingConnectTimer);
            this.pendingConnectTimer = setTimeout(() => {
                this.pendingConnectTimer = null;
                if (this.isActive) this.connect();
            }, 250);
        }
    }

    /** No-op — Natively API server handles VAD internally */
    public notifySpeechEnded(): void {}

    /** No-op — Natively API server finalizes via VAD; no client-side flush available */
    public finalize(): void {}

    public setCredentials(_path: string): void {}

    // ── Lifecycle ─────────────────────────────────────────────

    public start(): void {
        if (this.isActive) return;
        this.isActive         = true;
        this.reconnectAttempts = 0;
        // Defense in depth: the fatal-error branch at L353 (auth_timeout /
        // invalid_key_format / trial_expired / transcription_quota_exceeded)
        // flips isActive=false WITHOUT going through stop(), so it never clears
        // these counters. Reset on start so a session that follows a fatal
        // error doesn't inherit stale overflow state.
        this.bufferDroppedChunks = 0;
        this.bufferOverflowReported = false;
        // Cancel any orphan inline reconnect timer left over from a prior
        // setSampleRate/setRecognitionLanguage/language_detected that closed
        // the upstream and scheduled a 250 ms reconnect. Without this, the
        // orphan would fire inside the new session and double-connect.
        if (this.pendingConnectTimer) {
            clearTimeout(this.pendingConnectTimer);
            this.pendingConnectTimer = null;
        }
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
            const config = RECOGNITION_LANGUAGES.auto;
            this.languageBcp47      = 'auto';
            this.languageAlternates = config.alternates ?? [];
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.stabilityTimer) {
            clearTimeout(this.stabilityTimer);
            this.stabilityTimer = null;
        }
        // Cancel orphan inline reconnect timer so it doesn't fire and call
        // connect() while the stream is meant to be torn down. The 'isActive'
        // check inside the timer would also catch it, but cancelling is cheaper
        // than letting a setTimeout sit in libuv's queue for 250 ms.
        if (this.pendingConnectTimer) {
            clearTimeout(this.pendingConnectTimer);
            this.pendingConnectTimer = null;
        }
        this.closeUpstream();
        this.buffer = [];
        // Reset overflow counters so the next session's logs reflect its own
        // outage state, not stale numbers from the prior session — otherwise a
        // brand-new reconnect prints e.g. "47 chunks dropped during outage"
        // referring to an outage from a meeting that already ended.
        this.bufferDroppedChunks = 0;
        this.bufferOverflowReported = false;
    }

    private _chunksSent = 0;

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.buffer.push(chunk);
            // Cap buffer to prevent unbounded memory growth. Beyond BUFFER_MAX_CHUNKS
            // we drop the oldest chunk — speech earlier than ~10 s back is not useful
            // for live transcription anyway, but the loss must NOT be silent.
            if (this.buffer.length > this.BUFFER_MAX_CHUNKS) {
                this.buffer.shift();
                this.bufferDroppedChunks++;
                if (!this.bufferOverflowReported) {
                    this.bufferOverflowReported = true;
                    console.warn(`[NativelyProSTT:${this.channel}] Buffer overflow — dropping oldest chunks. Reconnect taking too long; transcript will have a gap.`);
                    this.emit('buffer-overflow', { channel: this.channel });
                }
            }
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

    private connect(_skipStagger = false): void {
        if (this.isConnecting || !this.isActive) return;

        // Per-key stagger removed (was 3000 ms between any two connects on the
        // same apiKey). It was added under the assumption the server serialised
        // by API key — it does not. Server-side concurrency is project-quota
        // based (HTTP 429 on overflow), and the system + mic channels are
        // explicitly supported as concurrent streams disambiguated by the
        // `channel` field in the auth frame. Re-introducing any per-key serial
        // gate here will reintroduce the 3–8 s mic-activation regression.
        // The `_skipStagger` parameter is kept for ABI stability with existing
        // callers (250 ms reconnect debounces in setSampleRate /
        // setRecognitionLanguage / language_detected); it is now a no-op.

        this.isConnecting = true;
        this.isConnected  = false;

        console.log(`[NativelyProSTT] Connecting (attempt ${this.reconnectAttempts + 1})...`);

        // streamingStttWsOptions sidesteps Node's macOS dual-stack DNS bug for
        // IPv4-only CNAME chains and caps the TLS+upgrade handshake at 15s.
        // See dnsHelpers.ts for the full why.
        const ws = new WebSocket(this.BACKEND_URL, streamingStttWsOptions() as any);
        this.ws = ws;

        // CRITICAL: every handler below captures `ws` locally and gates on
        // `ws === this.ws`. Without this, a delayed event from a previously-
        // closed WebSocket (e.g. the 'connected' status frame that's already
        // in libuv's queue when we call closeUpstream() during a
        // language_detected reconnect) can mutate `this.isConnected` /
        // `this.isConnecting` / fire scheduleReconnect against the new ws's
        // state, leaving us in the impossible "isConnected=true, ws=null"
        // shape that breaks the auth handshake on the new connection. Manifest
        // symptom: ja-JP auto-detect produces ONE final transcript and then
        // silence — server-side state thinks our second auth was a duplicate
        // session because our first ws never sent its real close.
        const guard = (handler: () => void) => {
            if (ws !== this.ws) return;
            handler();
        };

        ws.on('open', () => guard(() => {
            if (!this.isActive) { ws.close(); return; }

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
            if (this.apiKey === TRIAL_SENTINEL_KEY) {
                try {
                    const { CredentialsManager } = require('../services/CredentialsManager');
                    const trialToken = CredentialsManager.getInstance().getTrialToken();
                    if (trialToken) baseFrame.trial_token = trialToken;
                } catch { /* CredentialsManager unavailable — connection will be rejected by server */ }
            } else {
                baseFrame.key = this.apiKey;
            }

            ws.send(JSON.stringify(baseFrame));
        }));

        ws.on('message', (data: WebSocket.Data) => guard(() => {
            try {
                const msg = JSON.parse(data.toString());
                if (!msg.text || msg.is_final) {
                    console.log(`[NativelyProSTT:${this.channel}] Server msg`, {
                        type: msg.type,
                        final: Boolean(msg.is_final),
                        hasText: Boolean(msg.text),
                        textLength: typeof msg.text === 'string' ? msg.text.length : 0,
                    });
                }

                if (msg.error) {
                    console.error('[NativelyProSTT] Server error:', msg.error, msg.message || '');
                    this.emit('error', new Error(msg.error));
                    // Fatal errors — stop reconnecting entirely.
                    // trial_expired must be here: without it the client retries every 1.5-30s
                    // forever, hammering auth DB calls while the server rejects every attempt.
                if (msg.error === 'auth_timeout' ||
                        msg.error === 'invalid_key_format' ||
                        msg.error === 'trial_expired' ||
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
                    this.emit('connected', { provider: msg.provider, channel: this.channel });
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
                        if (this.pendingConnectTimer) clearTimeout(this.pendingConnectTimer);
                        this.pendingConnectTimer = setTimeout(() => {
                            this.pendingConnectTimer = null;
                            if (this.isActive) this.connect();
                        }, 250);
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
        }));

        ws.on('error', (err: Error & { code?: string }) => guard(() => {
            // ENOTFOUND = DNS resolution failure (transient — router hiccup, network change,
            // negative DNS cache). Do NOT burn the exponential backoff counter on these;
            // instead use a fixed DNS_RETRY_MS delay and keep retrying indefinitely while active.
            this.isDnsFailure = err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN';
            if (this.isDnsFailure) {
                console.warn(`[NativelyProSTT:${this.channel}] DNS failure (${err.code}) — will retry in ${this.DNS_RETRY_MS / 1000}s without burning backoff`);
            } else {
                console.error('[NativelyProSTT] WebSocket error:', err.message);
            }
            this.isConnecting = false;
            this.isConnected  = false;
            this.emit('error', err);
            if (this.isDnsFailure && this.isActive) {
                this.scheduleReconnect();
            }
        }));

        ws.on('close', (code: number) => guard(() => {
            this.isConnecting = false;
            this.isConnected  = false;
            if (this.ws === ws) this.ws = null;
            console.log(`[NativelyProSTT] Connection closed (code ${code})`);

            // Skip auto-reconnect if this close was intentional (e.g. language change)
            if (this.intentionalClose) {
                this.intentionalClose = false;
                return;
            }

            if (this.isActive) {
                this.scheduleReconnect();
            }
        }));
    }

    private scheduleReconnect(): void {
        if (!this.isActive || this.reconnectTimer) return;
        this._chunksSent = 0;  // Reset per-session counter so chunk #N logs reflect the new session
        // Connection dropped before stability window — cancel the backoff reset
        if (this.stabilityTimer) { clearTimeout(this.stabilityTimer); this.stabilityTimer = null; }

        // DNS failures (ENOTFOUND / EAI_AGAIN) are transient network blips — the hostname
        // is valid and the server is healthy. Don't consume the exponential backoff counter;
        // just wait a fixed DNS_RETRY_MS and retry. This keeps retrying indefinitely while
        // isActive is true, which is safe since the user explicitly started the session.
        if (this.isDnsFailure) {
            this.isDnsFailure = false;  // clear so the next non-DNS error uses normal backoff
            console.warn(`[NativelyProSTT] DNS retry in ${this.DNS_RETRY_MS / 1000}s...`);
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                if (this.isActive) this.connect();
            }, this.DNS_RETRY_MS);
            return;
        }

        // Capped exponential backoff with jitter. Streaming STT is meeting-critical;
        // giving up after N attempts strands the user with no transcript. Better to
        // keep retrying indefinitely at MAX_BACKOFF_MS — by then the cause is
        // network or server, both of which heal eventually, and the user can read
        // the "reconnecting" banner if the wait is unacceptable.
        const exp = this.RECONNECT_BASE_MS * Math.pow(2, Math.min(this.reconnectAttempts, 6));
        const capped = Math.min(this.MAX_BACKOFF_MS, exp);
        // ±20% jitter so concurrent reconnects don't thunder-herd the server.
        const jitter = Math.floor((Math.random() - 0.5) * capped * 0.4);
        const delay = Math.max(this.RECONNECT_BASE_MS, capped + jitter);
        this.reconnectAttempts++;
        console.log(`[NativelyProSTT:${this.channel}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

        // Surface a soft UI signal once we cross the warning threshold so the
        // user knows the connection problem is sustained, not a momentary blip.
        // Don't repeat — the renderer keeps the banner up until next 'connected'.
        if (this.reconnectAttempts === this.RECONNECT_WARN_AFTER) {
            this.emit('persistent-reconnect', { attempts: this.reconnectAttempts });
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.isActive) this.connect();
        }, delay);
    }

    private flushBuffer(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        // Snapshot + clear, then iterate. Previous version called shift() in a loop
        // which is O(n²) — every shift on a large buffer re-indexes every remaining
        // element. With 500 chunks the snapshot+iterate version is O(n) and runs in
        // a single tight loop instead of 500 array reallocations.
        const pending = this.buffer;
        this.buffer = [];
        if (this.bufferDroppedChunks > 0) {
            console.warn(`[NativelyProSTT:${this.channel}] Reconnected — flushing ${pending.length} buffered chunks; ${this.bufferDroppedChunks} were dropped during outage`);
        }
        this.bufferDroppedChunks = 0;
        this.bufferOverflowReported = false;
        for (const chunk of pending) {
            this.ws.send(chunk);
        }
    }

    private closeUpstream(): void {
        this.isConnected  = false;
        this.isConnecting = false;

        // Clear every owned timer here, not just at stop()/start() boundaries.
        // Any path that tears down the upstream connection (intentional close,
        // setSampleRate, setRecognitionLanguage, language_detected, fatal-error
        // branch) used to leave reconnectTimer / stabilityTimer alive — they
        // would then fire against a torn-down session and either call
        // connect() (orphan reconnect) or clobber reconnectAttempts on the
        // next session (stability timer surviving across sessions). The 250ms
        // inline reconnect paths immediately re-assign pendingConnectTimer
        // AFTER calling closeUpstream(), so clearing it here is safe — they
        // intentionally overwrite it.
        if (this.reconnectTimer)     { clearTimeout(this.reconnectTimer);     this.reconnectTimer = null; }
        if (this.stabilityTimer)     { clearTimeout(this.stabilityTimer);     this.stabilityTimer = null; }
        if (this.pendingConnectTimer) { clearTimeout(this.pendingConnectTimer); this.pendingConnectTimer = null; }

        if (this.ws) {
            const dying = this.ws;
            this.ws = null;
            // Strip every JS-side listener BEFORE close(). The libuv socket can
            // still deliver 'message'/'close' events that were already in
            // flight from the kernel — without removeAllListeners() they would
            // bubble up to handlers that mutate state on `this` and corrupt
            // the new connection. The handler-side `guard(ws === this.ws)`
            // makes this safe even if removeAllListeners() somehow misses
            // anything, but doing both is the production-grade pattern.
            try { dying.removeAllListeners(); } catch {}
            try { dying.close(); } catch {}
        }
    }
}
