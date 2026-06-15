import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES, EnglishVariant } from '../config/languages';
import { TRIAL_SENTINEL_KEY } from '../config/constants';
import { streamingStttWsOptions } from './dnsHelpers';
import {
    resolveRelaySession as defaultResolveRelaySession,
    buildFallbackChain,
    getCachedSession,
    setCachedSession,
    clearCachedSession,
    getRelayLatencyProbes,
    type RelaySessionConfig,
    type ResolveRelaySessionOpts,
} from './relaySession';

/**
 * Optional flag/telemetry/resolver injection so the class stays testable.
 * Defaults wire to the real SettingsManager / telemetryService / resolver.
 */
export interface NativelyProSTTFlags {
    /** Master switch + deterministic per-key rollout gate (see SettingsManager). */
    isRelayEnabled(apiKey: string | undefined): boolean;
    /** Forced region hint passed as region_hint to session-create, or null. */
    getForceRegion(): 'us' | 'asia' | null;
    /** When false, the Railway URL is NOT appended to the fallback chain. */
    isRailwayFallbackEnabled(): boolean;
    getMaxSampleRate(): number;
    getMaxChannels(): number;
    getAllowDualStream(): boolean;
}

export interface NativelyProSTTTelemetry {
    event(name: string, properties?: Record<string, unknown>): void;
}

export interface NativelyProSTTDeps {
    controlPlaneBaseUrl?: string;
    appVersion?: string;
    platform?: string;
    resolveSession?: (opts: ResolveRelaySessionOpts) => Promise<RelaySessionConfig | null>;
    flags?: NativelyProSTTFlags;
    telemetry?: NativelyProSTTTelemetry;
}

/** Discriminates which auth-frame shape a given WS URL needs. */
type TargetKind = 'relay' | 'alternate' | 'railway';

interface ResolvedTarget {
    /** Ordered WS URLs to try, relay→alternate→railway. */
    chain: string[];
    /** Index into `chain` of the URL we're currently dialing. */
    index: number;
    /** The relay session config (null when flag off / resolve failed). */
    config: RelaySessionConfig | null;
    /** Same-URL connect failures since the last advance (for the ×2 rule). */
    sameUrlFailures: number;
    /** True once we've walked all the way to Railway (no flap-back). */
    onRailway: boolean;
}

/**
 * NativelyProSTT
 *
 * Connects to the Natively API WebSocket transcription endpoint.
 *
 * TWO auth-frame shapes (Phase 7/8 additive):
 *   LEGACY (Railway, unchanged): { key | trial_token, sample_rate, language,
 *                                  language_alternates, audio_channels, channel }
 *   RELAY (regional relay):      { session_token, sample_rate, audio_channels,
 *                                  language, language_alternates, channel,
 *                                  app_version, platform }
 * buildAuthFrame(url) picks the right shape: relay frame when the URL is a relay
 * target AND we hold a session token; legacy frame for the Railway URL (always)
 * and whenever the relay flag is off.
 *
 * When `regionalSttRelayEnabled` is OFF, behavior is byte-for-byte identical to
 * before this phase: no session-create call, BACKEND_URL is used, legacy frame.
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

    // ── Regional STT relay state (Phase 7/8 — all additive, flag-gated off) ──
    // Deps default to the real implementations; tests inject fakes.
    private readonly deps: NativelyProSTTDeps;
    private readonly controlPlaneBaseUrl: string;
    private readonly appVersion: string;
    private readonly platform: string;
    // The resolved connection target: ordered URL chain + active session config.
    // null until the first connect of a session resolves it (or stays null when
    // the flag is off — in which case connect() falls back to BACKEND_URL).
    private target: ResolvedTarget | null = null;
    // Guards against re-resolving while a resolve is already in flight or while
    // the session has already been resolved this start() cycle.
    private targetResolved = false;
    private resolveInFlight = false;
    // First-connect latency measurement (telemetry only).
    private connectStartedAtMs = 0;
    private firstTranscriptEmitted = false;
    private loggedFlagOffOnce = false;

    constructor(
        apiKey: string,
        channel: 'system' | 'mic' = 'system',
        deps: NativelyProSTTDeps = {},
    ) {
        super();
        this.apiKey  = apiKey;
        this.channel = channel;
        this.deps    = deps;
        // Derive the control-plane base from the same host as the legacy WS URL
        // (https equivalent of wss://api.natively.software). Overridable via deps.
        this.controlPlaneBaseUrl = deps.controlPlaneBaseUrl ?? this.deriveControlPlaneBase();
        this.appVersion = deps.appVersion ?? '';
        this.platform   = deps.platform ?? '';
    }

    /** https://api.natively.software derived from the wss BACKEND_URL host. */
    private deriveControlPlaneBase(): string {
        try {
            const u = new URL(this.BACKEND_URL);          // wss://api.natively.software/v1/transcribe
            return `https://${u.host}`;                    // https://api.natively.software
        } catch {
            return 'https://api.natively.software';
        }
    }

    // ── Relay deps resolution (lazy; SettingsManager/telemetry are main-only) ─

    private getFlags(): NativelyProSTTFlags | null {
        if (this.deps.flags) return this.deps.flags;
        try {
            // Lazy require: SettingsManager throws if app not ready, and unit
            // tests that don't inject flags shouldn't pull in electron. A throw
            // here simply means "no flags available" → relay disabled.
            const { SettingsManager } = require('../services/SettingsManager');
            const sm = SettingsManager.getInstance();
            return {
                isRelayEnabled: (apiKey: string | undefined) => sm.isRegionalSttRelayEnabledForKey(apiKey),
                getForceRegion: () => sm.getForceSttRelayRegion(),
                isRailwayFallbackEnabled: () => sm.getSttRailwayFallbackEnabled(),
                getMaxSampleRate: () => sm.getSttMaxSampleRate(),
                getMaxChannels: () => sm.getSttMaxChannels(),
                getAllowDualStream: () => sm.getSttAllowDualStream(),
            };
        } catch {
            return null;
        }
    }

    private getTelemetry(): NativelyProSTTTelemetry {
        if (this.deps.telemetry) return this.deps.telemetry;
        try {
            const { telemetryService } = require('../services/telemetry/TelemetryService');
            return {
                event: (name: string, properties?: Record<string, unknown>) =>
                    telemetryService.record(name, properties),
            };
        } catch {
            return { event: () => { /* telemetry unavailable — no-op */ } };
        }
    }

    private emitTelemetry(name: string, properties?: Record<string, unknown>): void {
        try { this.getTelemetry().event(name, properties); } catch { /* never throw on the audio path */ }
    }

    private get resolveSessionImpl(): (opts: ResolveRelaySessionOpts) => Promise<RelaySessionConfig | null> {
        return this.deps.resolveSession ?? defaultResolveRelaySession;
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
        // Fresh session: forget any previously-resolved relay target so the
        // first connect of THIS session re-evaluates the flag and (if on)
        // re-resolves / reuses a cached session. A target left over from a
        // prior meeting would dial a possibly-expired token or dead relay.
        this.target = null;
        this.targetResolved = false;
        this.resolveInFlight = false;
        this.firstTranscriptEmitted = false;
        this.connectStartedAtMs = 0;
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
        // Forget the resolved relay target for the next session. We intentionally
        // do NOT clear the per-channel session cache here — a quick stop()/start()
        // within the token TTL legitimately reuses the cached session (the cache
        // has its own 15s-skew expiry). A relay-level HARD failure clears it
        // separately (see maybeAdvanceTarget()).
        this.target = null;
        this.targetResolved = false;
        this.resolveInFlight = false;
        this.firstTranscriptEmitted = false;
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

        // ── Relay pre-flight (Phase 7/8) ──────────────────────────────────
        // SEAM: when the regional-relay flag is on AND we have not yet resolved
        // a target for this session, kick off the async session-create and
        // re-enter connect() once it completes. When the flag is off this is a
        // pure no-op (maybeResolveRelayTarget returns false synchronously) and
        // the code below uses BACKEND_URL exactly as before. resolveInFlight
        // guards against double-resolves; targetResolved short-circuits on
        // every subsequent reconnect within the session.
        if (this.maybeResolveRelayTarget()) {
            // Resolution started (async). connect() will be called again from
            // the resolver continuation. Do NOT proceed to open a socket now.
            return;
        }

        this.isConnecting = true;
        this.isConnected  = false;

        // Pick the URL for THIS attempt: the current fallback-chain target when
        // the relay flag resolved one, else the hardcoded Railway URL (flag-off
        // path — byte-for-byte unchanged).
        const connectUrl = this.connectUrl();
        this.connectStartedAtMs = Date.now();

        console.log(`[NativelyProSTT] Connecting (attempt ${this.reconnectAttempts + 1})...`);

        // streamingStttWsOptions sidesteps Node's macOS dual-stack DNS bug for
        // IPv4-only CNAME chains and caps the TLS+upgrade handshake at 15s.
        // See dnsHelpers.ts for the full why.
        const ws = new WebSocket(connectUrl, streamingStttWsOptions() as any);
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

            // Build the auth + config handshake for THIS url. buildAuthFrame
            // returns the RELAY frame (session_token, no key) for a relay target
            // when we hold a token, or the LEGACY frame (key|trial_token, no
            // token) for the Railway URL / flag-off path — preserving the exact
            // legacy shape the server has always validated.
            const baseFrame = this.buildAuthFrame(connectUrl);
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

                    // RELAY token-fatal carve-out (Phase 7/8): on a RELAY url an
                    // `invalid_key_format` means a bad/expired SESSION TOKEN, not
                    // a bad user key (the relay maps expired/forged session tokens
                    // onto `invalid_key_format` — docs/05 §2.4). That must NOT kill
                    // the whole session: clear the cached session and advance to
                    // the next rung (alternate relay → Railway), where legacy auth
                    // re-validates the real key. We let the socket close naturally
                    // and the close handler walk the ladder.
                    if (msg.error === 'invalid_key_format' && this.isOnRelayTarget(connectUrl)) {
                        console.warn(`[NativelyProSTT:${this.channel}] Relay token rejected (invalid_key_format on relay) — advancing to next fallback rung.`);
                        clearCachedSession(this.channel);
                        this.forceAdvanceTarget(connectUrl, 'token_fatal');
                        // NOT fatal: leave isActive true so the close handler's
                        // scheduleReconnect() reconnects against the advanced url.
                        return;
                    }

                    // Fatal errors — stop reconnecting entirely.
                    // trial_expired must be here: without it the client retries every 1.5-30s
                    // forever, hammering auth DB calls while the server rejects every attempt.
                    // (On the Railway url, invalid_key_format remains fatal exactly as today.)
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
                    // Relay telemetry: a successful auth on the current rung. We
                    // reset the per-url failure counter so a later blip starts the
                    // ×2 advance rule fresh from this (now-proven) url.
                    if (this.target) {
                        const kind = this.kindForUrl(connectUrl);
                        const firstConnectMs = this.connectStartedAtMs ? Math.max(0, Date.now() - this.connectStartedAtMs) : 0;
                        this.target.sameUrlFailures = 0;
                        this.emitTelemetry('relay_connected', { kind, region: this.target.config?.selectedRegion ?? 'railway', firstConnectMs });
                    }
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
                    // First-transcript latency bucket (telemetry only; never the
                    // text itself). Measured from this attempt's socket open.
                    if (!this.firstTranscriptEmitted && this.connectStartedAtMs) {
                        this.firstTranscriptEmitted = true;
                        const ms = Math.max(0, Date.now() - this.connectStartedAtMs);
                        this.emitTelemetry('first_transcript_latency_bucket', {
                            bucket: latencyBucket(ms),
                            kind: this.target ? this.kindForUrl(connectUrl) : 'railway',
                        });
                    }
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
                // Fallback-ladder advance (Phase 7/8): a non-intentional close is
                // a failure of THIS rung. maybeAdvanceTarget() bumps the per-url
                // failure count and, after the relay's same-url retry has failed
                // twice, advances target.index to the next chain entry (relay →
                // alternate → railway). When the flag is off / chain is a single
                // Railway url, this is a no-op and scheduleReconnect() behaves
                // exactly as today. We DO NOT touch scheduleReconnect itself —
                // it just dials connectUrl() (the advanced url) on its next tick.
                this.maybeAdvanceTarget(connectUrl, code);
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

    // ── Regional STT relay helpers (Phase 7/8) ──────────────────────────────

    /**
     * If the relay flag is on and we haven't resolved a target this session,
     * resolve one (reusing a cached session for this channel if still valid)
     * and re-enter connect() when done. Returns true if a resolve was started
     * (caller must NOT proceed to open a socket); false if the flag is off /
     * already resolved (caller proceeds with the legacy/established path).
     *
     * SAFETY: the moment the flag is off this returns false synchronously and
     * the resolver is never even constructed — guaranteeing the flag-off path
     * is byte-for-byte the legacy direct-Railway behavior.
     */
    private maybeResolveRelayTarget(): boolean {
        if (this.targetResolved || this.resolveInFlight) return false;

        const flags = this.getFlags();
        // Trial sentinel uses CredentialsManager.getTrialToken() for the WS frame;
        // for the rollout gate we hash the channel+sentinel deterministically.
        const enabled = !!flags && flags.isRelayEnabled(this.apiKey === TRIAL_SENTINEL_KEY ? undefined : this.apiKey);
        if (!enabled) {
            // Mark resolved so we don't re-check every reconnect. Emit the
            // flag-off telemetry exactly once per session.
            this.targetResolved = true;
            if (!this.loggedFlagOffOnce) {
                this.loggedFlagOffOnce = true;
                this.emitTelemetry('stt_relay_disabled_flag_off', { channel: this.channel });
            }
            return false;
        }

        // Reuse a cached session for this channel if it's still inside its TTL
        // (avoids hammering /v1/stt/session on a transient 1006 blip).
        const cached = getCachedSession(this.channel);
        if (cached) {
            this.installTarget(cached);
            this.targetResolved = true;
            return false; // synchronously ready — proceed with the established chain
        }

        // No cache → async resolve. Block this connect; re-enter on completion.
        this.resolveInFlight = true;
        this.resolveRelayTarget(flags!)
            .catch((): void => { /* resolve failure → installTarget(null) already ran or null target → Railway */ })
            .finally(() => {
                this.resolveInFlight = false;
                this.targetResolved = true;
                // Re-enter connect() now that a target (or null → Railway) is set.
                if (this.isActive) this.connect();
            });
        return true;
    }

    /** Performs the actual session-create + installs the resulting target. */
    private async resolveRelayTarget(flags: NativelyProSTTFlags): Promise<void> {
        const isTrial = this.apiKey === TRIAL_SENTINEL_KEY;
        let trialToken: string | undefined;
        let apiKey: string | undefined;
        if (isTrial) {
            try {
                const { CredentialsManager } = require('../services/CredentialsManager');
                trialToken = CredentialsManager.getInstance().getTrialToken();
            } catch { /* no trial token available — resolver returns null → Railway */ }
        } else {
            apiKey = this.apiKey;
        }

        const config = await this.resolveSessionImpl({
            apiKey,
            trialToken,
            channel: this.channel,
            language: this.languageBcp47,
            languageAlternates: this.languageAlternates,
            // Echo client-side caps; the server re-clamps and is authoritative.
            sampleRate: Math.min(this.sampleRate, flags.getMaxSampleRate()),
            audioChannels: Math.min(this.audioChannels, flags.getMaxChannels()),
            appVersion: this.appVersion,
            platform: this.platform,
            controlPlaneBaseUrl: this.controlPlaneBaseUrl,
            regionHint: flags.getForceRegion(),
            // Best-effort relay round-trip hints (cached, never blocks — null on the
            // first call before the background probe lands). The server honors them
            // only when STT_RELAY_ALLOW_CLIENT_LATENCY_PROBES is on, else ignores.
            latencyProbes: getRelayLatencyProbes() ?? undefined,
        });

        if (config) {
            setCachedSession(this.channel, config);
            this.emitTelemetry('relay_session_resolved', {
                region: config.selectedRegion,
                hadFallback: config.fallbackRelayWsUrl != null,
            });
        }
        this.installTarget(config);
    }

    /**
     * Builds the ordered URL chain from a resolved config (or null → Railway-only)
     * and stores it as the active target. Respects sttRailwayFallbackEnabled:
     * when false, the Railway url is stripped from the chain (QA isolation). The
     * resulting first url is what connect() will dial.
     */
    private installTarget(config: RelaySessionConfig | null): void {
        let chain = buildFallbackChain(config);
        const flags = this.getFlags();
        if (flags && !flags.isRailwayFallbackEnabled()) {
            const filtered = chain.filter(u => u !== this.BACKEND_URL && (!config || u !== config.railwayFallbackWsUrl));
            // Never let the chain go empty — if stripping Railway leaves nothing
            // (shouldn't, when config has relay urls), keep the original.
            if (filtered.length > 0) chain = filtered;
        }
        this.target = {
            chain,
            index: 0,
            config,
            sameUrlFailures: 0,
            onRailway: false,
        };
        const firstKind = this.kindForUrl(chain[0]);
        this.emitTelemetry('relay_selected', {
            kind: firstKind,
            region: config?.selectedRegion ?? 'railway',
        });
    }

    /** The url connect() should dial right now. Falls back to BACKEND_URL. */
    private connectUrl(): string {
        if (this.target && this.target.chain.length > 0) {
            return this.target.chain[Math.min(this.target.index, this.target.chain.length - 1)];
        }
        return this.BACKEND_URL;
    }

    /** Classifies a url within the current chain as relay | alternate | railway. */
    private kindForUrl(url: string): TargetKind {
        if (!this.target || !this.target.config) {
            return 'railway';
        }
        const c = this.target.config;
        if (url === c.relayWsUrl) return 'relay';
        if (c.fallbackRelayWsUrl && url === c.fallbackRelayWsUrl) return 'alternate';
        // Railway hardcoded url or the server-provided railway fallback url.
        return 'railway';
    }

    /** True when `url` is a relay/alternate target AND we hold a session token. */
    private isOnRelayTarget(url: string): boolean {
        if (!this.target || !this.target.config || !this.target.config.sessionToken) return false;
        const kind = this.kindForUrl(url);
        return kind === 'relay' || kind === 'alternate';
    }

    /**
     * Returns the auth frame for `url`:
     *   - RELAY frame  (session_token, app_version, platform; NO key) when `url`
     *     is a relay/alternate target and we have a token.
     *   - LEGACY frame (key | trial_token; NO token) for the Railway url and for
     *     the entire flag-off path — exactly the shape the server has always
     *     validated.
     */
    private buildAuthFrame(url: string): Record<string, unknown> {
        if (this.isOnRelayTarget(url)) {
            const token = this.target!.config!.sessionToken;
            return {
                session_token:       token,
                sample_rate:         this.sampleRate,
                audio_channels:      this.audioChannels,
                language:            this.languageBcp47,
                language_alternates: this.languageAlternates,
                channel:             this.channel,
                app_version:         this.appVersion,
                platform:            this.platform,
            };
        }
        return this.buildLegacyAuthFrame();
    }

    /**
     * The unchanged legacy auth frame. Extracted verbatim from the original
     * 'open' handler so the Railway / flag-off path is byte-for-byte identical:
     *   { sample_rate, language, language_alternates, audio_channels, channel,
     *     key | trial_token }
     */
    private buildLegacyAuthFrame(): Record<string, unknown> {
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
        return baseFrame;
    }

    /**
     * Fallback-ladder advance on a failed connection close. Increments the
     * per-url failure count; after the SAME relay url has failed twice, advances
     * target.index to the next chain entry. Once on Railway we stay there (no
     * flap-back). No-op when there is no multi-entry chain (flag off).
     *
     * `failedUrl` is the url that was being dialed; we only advance when it is
     * still the head of the chain we're walking (guards against stale closes).
     */
    private maybeAdvanceTarget(failedUrl: string, closeCode?: number): void {
        const t = this.target;
        if (!t || t.chain.length <= 1) return;        // nothing to advance to
        if (t.onRailway) return;                       // terminal rung — stay
        if (failedUrl !== t.chain[t.index]) return;    // stale close — ignore

        const fromKind = this.kindForUrl(failedUrl);
        this.emitTelemetry('relay_failed', { kind: fromKind, closeCode: closeCode ?? null, reason: 'close' });

        t.sameUrlFailures++;
        // Same-relay retry budget: 2 failures on the current url before advancing.
        if (t.sameUrlFailures < 2) return;

        this.advance(failedUrl, fromKind);
    }

    /**
     * Token-fatal advance: a relay rejected our session token. Skip the ×2 retry
     * budget and advance immediately (the token won't self-heal on retry).
     */
    private forceAdvanceTarget(failedUrl: string, reason: string): void {
        const t = this.target;
        if (!t || t.chain.length <= 1 || t.onRailway) {
            // No relay rung to advance to — let normal fatal handling apply.
            return;
        }
        if (failedUrl !== t.chain[t.index]) return;
        const fromKind = this.kindForUrl(failedUrl);
        this.emitTelemetry('relay_failed', { kind: fromKind, closeCode: null, reason });
        this.advance(failedUrl, fromKind);
    }

    /** Shared advance: bump index, reset per-url counter, emit fallback_used. */
    private advance(failedUrl: string, fromKind: TargetKind): void {
        const t = this.target!;
        if (t.index < t.chain.length - 1) {
            t.index++;
            t.sameUrlFailures = 0;
            const toKind = this.kindForUrl(t.chain[t.index]);
            if (toKind === 'railway') t.onRailway = true;
            this.reconnectAttempts = 0; // fresh rung — don't inherit prior backoff
            console.warn(`[NativelyProSTT:${this.channel}] Advancing fallback rung: ${fromKind} → ${toKind} (${t.chain[t.index]})`);
            this.emitTelemetry('relay_fallback_used', { fromKind, toKind });
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

/** Buckets a latency (ms) into the telemetry buckets (<500/<1000/<2000/<4000/>=4000). */
function latencyBucket(ms: number): string {
    if (ms < 500) return '<500';
    if (ms < 1000) return '<1000';
    if (ms < 2000) return '<2000';
    if (ms < 4000) return '<4000';
    return '>=4000';
}
