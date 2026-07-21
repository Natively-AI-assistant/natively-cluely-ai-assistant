/**
 * relaySession.ts — Phase 7/8 STT relay pre-flight session resolver.
 *
 * Pure-ish, UI-free, testable. Resolves a regional STT relay session by
 * calling the control-plane endpoint `POST {controlPlaneBaseUrl}/v1/stt/session`
 * (contract: docs/03-relay-session-token.md §2). It NEVER opens a WebSocket and
 * NEVER touches Electron windows — it returns a plain config object (or null)
 * that NativelyProSTT consumes to build its connection fallback chain.
 *
 * Design contract (docs/01 §5, §1.3 fallback ladder):
 *   1. Client POSTs /v1/stt/session with key|trial_token + channel + hints.
 *   2. Server returns the selected relay URL, an alternate relay URL, the
 *      always-present Railway emergency URL, a short-lived HMAC session token,
 *      and the clamped STT config + limits.
 *   3. The client builds an ordered fallback chain:
 *        [relayWsUrl, fallbackRelayWsUrl, railwayFallbackWsUrl]
 *      and walks it on connection failure (relay → alternate → railway).
 *   4. On ANY resolver failure (non-2xx, timeout, network, malformed body,
 *      missing token, 402 quota) → return null. The caller then falls back to
 *      the legacy direct-Railway path (the unchanged emergency rung), so the
 *      relay is never required for service.
 *
 * Security:
 *   - The session token is NEVER logged. Only its presence/length-class and the
 *     selected region/expiry are logged.
 *   - The API key / trial token are sent in the request body over HTTPS but are
 *     never logged here.
 */

// ── Public types ──────────────────────────────────────────────────────────

export type RelayRegion = 'us' | 'asia' | 'railway';

export interface RelaySttConfig {
    sampleRate: number;
    audioChannels: number;
    language: string;
    languageAlternates: string[];
    channel: string;
}

export interface RelaySessionLimits {
    maxSampleRate: number;
    maxChannels: number;
    allowDualStream: boolean;
    maxSessionSeconds: number;
    maxBytesPerSession: number;
}

export interface RelaySessionConfig {
    sessionId: string;
    sessionToken: string;
    relayWsUrl: string;
    fallbackRelayWsUrl: string | null;
    railwayFallbackWsUrl: string;
    selectedRegion: string;
    sttConfig: RelaySttConfig;
    limits: RelaySessionLimits;
    quotaRemaining: number;
    /** Epoch milliseconds at which the session token expires (admission only). */
    expiresAt: number;
}

export interface ResolveRelaySessionOpts {
    /** API key (paid) — mutually exclusive with trialToken at the wire level. */
    apiKey?: string;
    /** Trial token — used when there is no paid key. */
    trialToken?: string;
    channel: string;
    language: string;
    languageAlternates: string[];
    sampleRate: number;
    audioChannels: number;
    appVersion: string;
    platform: string;
    /** Base URL of the Railway control plane, e.g. https://api.natively.software */
    controlPlaneBaseUrl: string;
    /** Optional forced/coarse region hint ('us' | 'asia') or ISO-3166 alpha-2. */
    regionHint?: string | null;
    /** Optional client-measured RTTs per region, ms. */
    latencyProbes?: Record<string, number> | null;
    /** Injectable fetch for tests; defaults to the global fetch (Electron main). */
    fetchImpl?: typeof fetch;
    /** Request timeout, default 4000ms. */
    timeoutMs?: number;
    /** Optional intent passthrough (currently unused server-side). */
    intent?: string;
}

const DEFAULT_TIMEOUT_MS = 4000;
const HARDCODED_RAILWAY_URL = 'wss://api.natively.software/v1/transcribe';

// ── Resolver ───────────────────────────────────────────────────────────────

/**
 * Calls POST {controlPlaneBaseUrl}/v1/stt/session and parses the response into
 * a RelaySessionConfig. Returns null on ANY failure so the caller falls back to
 * the legacy direct-Railway path. NEVER throws.
 */
export async function resolveRelaySession(
    opts: ResolveRelaySessionOpts,
): Promise<RelaySessionConfig | null> {
    const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    if (typeof fetchImpl !== 'function') {
        console.warn('[relaySession] No fetch implementation available — falling back to direct Railway.');
        return null;
    }
    if (!opts.controlPlaneBaseUrl) {
        console.warn('[relaySession] No controlPlaneBaseUrl — falling back to direct Railway.');
        return null;
    }
    if (!opts.apiKey && !opts.trialToken) {
        // No credential to authenticate the session-create call.
        return null;
    }

    const url = joinUrl(opts.controlPlaneBaseUrl, '/v1/stt/session');
    const body: Record<string, unknown> = {
        // key OR trial_token — never both meaningfully; server branches on key first.
        ...(opts.apiKey ? { key: opts.apiKey } : { trial_token: opts.trialToken }),
        region_hint: opts.regionHint ?? undefined,
        latency_probes: opts.latencyProbes ?? undefined,
        app_version: opts.appVersion,
        platform: opts.platform,
        language: opts.language,
        language_alternates: opts.languageAlternates ?? [],
        sample_rate: opts.sampleRate,
        audio_channels: opts.audioChannels,
        channel: opts.channel,
        intent: opts.intent ?? 'meeting',
    };

    const timeoutMs = typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
        res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (err) {
        // Network error, abort/timeout, DNS — all collapse to "use the fallback".
        const code = (err as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network';
        console.warn(`[relaySession] session-create ${code} — falling back to direct Railway.`);
        return null;
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        // 402 = quota exceeded. We deliberately return null (NOT a thrown error):
        // the legacy WS path will re-surface the real quota error to the user
        // exactly as today (server replies transcription_quota_exceeded on the
        // WS auth frame). We only log a discriminable reason here — never the body.
        if (res.status === 402) {
            console.warn('[relaySession] session-create 402 quota_exceeded — falling back to direct Railway (WS path surfaces the real quota error).');
        } else {
            console.warn(`[relaySession] session-create non-2xx (${res.status}) — falling back to direct Railway.`);
        }
        return null;
    }

    let parsed: unknown;
    try {
        parsed = await res.json();
    } catch {
        console.warn('[relaySession] session-create malformed JSON — falling back to direct Railway.');
        return null;
    }

    const config = parseSessionResponse(parsed);
    if (!config) {
        console.warn('[relaySession] session-create response missing required fields — falling back to direct Railway.');
        return null;
    }

    // Token presence/region/expiry only — NEVER the token itself.
    console.log(
        `[relaySession] resolved region=${config.selectedRegion} ` +
        `hasAlternate=${config.fallbackRelayWsUrl != null} expiresInMs=${Math.max(0, config.expiresAt - Date.now())}`,
    );
    return config;
}

/**
 * Minimal, defensive parse + camelCase mapping of the docs/03 §2.3 response.
 * Returns null if `session_token` or `relay_ws_url` are missing/empty.
 */
function parseSessionResponse(raw: unknown): RelaySessionConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;

    const sessionToken = asStr(o.session_token);
    const relayWsUrl = asStr(o.relay_ws_url);
    // Required shape: token + a relay URL to dial. Without either, the relay
    // path is unusable → fall back.
    if (!sessionToken || !relayWsUrl) return null;

    const stt = (o.stt_config && typeof o.stt_config === 'object') ? o.stt_config as Record<string, unknown> : {};
    const lim = (o.limits && typeof o.limits === 'object') ? o.limits as Record<string, unknown> : {};

    const railwayFallbackWsUrl = asStr(o.railway_fallback_ws_url) ?? HARDCODED_RAILWAY_URL;
    const fallbackRelayWsUrl = asStr(o.fallback_relay_ws_url) ?? null;

    return {
        sessionId: asStr(o.session_id) ?? '',
        sessionToken,
        relayWsUrl,
        fallbackRelayWsUrl,
        railwayFallbackWsUrl,
        selectedRegion: asStr(o.selected_region) ?? 'us',
        sttConfig: {
            sampleRate: asNum(stt.sample_rate, 16000),
            audioChannels: asNum(stt.audio_channels, 1),
            language: asStr(stt.language) ?? 'en-US',
            languageAlternates: asStrArr(stt.language_alternates),
            channel: asStr(stt.channel) ?? 'default',
        },
        limits: {
            maxSampleRate: asNum(lim.max_sample_rate, 16000),
            maxChannels: asNum(lim.max_channels, 1),
            allowDualStream: lim.allow_dual_stream === true,
            maxSessionSeconds: asNum(lim.max_session_seconds, 14400),
            maxBytesPerSession: asNum(lim.max_bytes_per_session, 0),
        },
        quotaRemaining: asNum(o.quota_remaining, 0),
        expiresAt: parseExpiry(o.expires_at),
    };
}

// ── Fallback chain builder ──────────────────────────────────────────────────

/**
 * Ordered list of WS URLs to try, in priority order:
 *   [relayWsUrl, fallbackRelayWsUrl, railwayFallbackWsUrl]
 * Nulls dropped, duplicates removed (preserving first occurrence). When `config`
 * is null (resolver failed / flag off) → just the hardcoded Railway URL.
 *
 * The returned chain ALWAYS terminates at a Railway URL (unless a caller
 * deliberately strips it via sttRailwayFallbackEnabled=false), so the legacy
 * emergency path remains the final rung.
 */
export function buildFallbackChain(config: RelaySessionConfig | null): string[] {
    if (!config) return [HARDCODED_RAILWAY_URL];
    const ordered = [config.relayWsUrl, config.fallbackRelayWsUrl, config.railwayFallbackWsUrl];
    const seen = new Set<string>();
    const chain: string[] = [];
    for (const u of ordered) {
        if (!u) continue;
        if (seen.has(u)) continue;
        seen.add(u);
        chain.push(u);
    }
    // Defensive: never return an empty chain.
    if (chain.length === 0) chain.push(HARDCODED_RAILWAY_URL);
    return chain;
}

/** The compile-time hardcoded Railway URL — exported so callers can compare. */
export function getHardcodedRailwayUrl(): string {
    return HARDCODED_RAILWAY_URL;
}

// ── In-memory per-channel session cache ──────────────────────────────────────

// Reusing a still-valid session token across a transient 1006 blip avoids
// hammering /v1/stt/session on every reconnect. We expire 15s BEFORE the token's
// real `expiresAt` (clock-skew + in-flight handshake safety). A relay-level hard
// failure (the relay itself died, not a network blip) MUST clear the cache so
// the next attempt re-resolves and gets routed to a healthy relay/alternate.
const CACHE_SKEW_MS = 15_000;

interface CacheEntry {
    config: RelaySessionConfig;
    /** Effective expiry = config.expiresAt - skew. */
    validUntil: number;
}

const _sessionCache = new Map<string, CacheEntry>();

/**
 * Returns a cached config for `channel` if it has not yet entered the skew
 * window, else null (and evicts the stale entry).
 */
export function getCachedSession(channel: string): RelaySessionConfig | null {
    const entry = _sessionCache.get(channel);
    if (!entry) return null;
    if (Date.now() >= entry.validUntil) {
        _sessionCache.delete(channel);
        return null;
    }
    return entry.config;
}

/** Caches `config` for `channel` with expiry = expiresAt - 15s skew. */
export function setCachedSession(channel: string, config: RelaySessionConfig): void {
    if (!config) return;
    _sessionCache.set(channel, {
        config,
        validUntil: config.expiresAt - CACHE_SKEW_MS,
    });
}

/** Clears the cached session for one channel (call on a relay-level hard failure). */
export function clearCachedSession(channel: string): void {
    _sessionCache.delete(channel);
}

/** Clears all cached sessions (test isolation / global reset). */
export function clearAllCachedSessions(): void {
    _sessionCache.clear();
}

// ── Client-side relay latency probes (best-effort, OFF the connect path) ──────
//
// The control plane honors `latency_probes` only when
// STT_RELAY_ALLOW_CLIENT_LATENCY_PROBES is on; when present it picks the lowest
// healthy relay (docs/01 §8). We measure each relay's HTTPS /healthz round-trip
// once and CACHE it for PROBE_TTL_MS so we never add latency to session-create:
// resolveRelaySession reads whatever is cached (possibly nothing on the very
// first call) and a background refresh runs fire-and-forget. A probe failure
// just omits that region (the server then falls back to geo routing).
//
// Health URL derivation mirrors the relay (wss://host/path → https://host/healthz).

/** Known relay health endpoints. Derived from the production relay hostnames; the
 *  control plane remains authoritative for routing — these are only hints. */
const RELAY_HEALTH_URLS: Record<'us' | 'asia', string> = {
    us: 'https://us-relay.natively.software/healthz',
    asia: 'https://asia-relay.natively.software/healthz',
};

const PROBE_TTL_MS = 5 * 60_000;       // re-measure at most every 5 min
const PROBE_TIMEOUT_MS = 1500;         // a slow probe is worse than no probe
let _probeCache: { at: number; probes: Record<string, number> } | null = null;
let _probeInFlight: Promise<void> | null = null;

/** Convert a relay wss:// URL to its https /healthz URL (exported for tests). */
export function deriveHealthUrl(wsUrl: string): string | null {
    try {
        const u = new URL(wsUrl);
        const scheme = u.protocol === 'wss:' ? 'https:' : 'http:';
        return `${scheme}//${u.host}/healthz`;
    } catch {
        return null;
    }
}

/**
 * Returns cached relay latencies if fresh, else null. NEVER blocks: if the cache
 * is stale/empty it kicks off a background refresh and returns whatever it has
 * (null on the first ever call). Safe to call on every session-create.
 */
export function getRelayLatencyProbes(
    fetchImpl?: typeof fetch,
    now: () => number = Date.now,
): Record<string, number> | null {
    const fresh = _probeCache && now() - _probeCache.at < PROBE_TTL_MS;
    if (!fresh && !_probeInFlight) {
        // Fire-and-forget refresh; the result lands in the cache for NEXT time.
        _probeInFlight = refreshRelayLatencyProbes(fetchImpl, now).then(() => {}, () => {}).finally(() => { _probeInFlight = null; });
    }
    return _probeCache && Object.keys(_probeCache.probes).length > 0 ? _probeCache.probes : null;
}

/** Measures each relay's /healthz round-trip and updates the probe cache. */
export async function refreshRelayLatencyProbes(
    fetchImpl?: typeof fetch,
    now: () => number = Date.now,
): Promise<Record<string, number>> {
    const f = fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    const probes: Record<string, number> = {};
    if (typeof f !== 'function') return probes;

    await Promise.all((Object.keys(RELAY_HEALTH_URLS) as Array<'us' | 'asia'>).map(async (region) => {
        const url = RELAY_HEALTH_URLS[region];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        const start = now();
        try {
            const res = await f(url, { method: 'GET', signal: controller.signal });
            if (res.ok) probes[region] = Math.round(now() - start);
        } catch {
            // omit this region — server falls back to geo routing
        } finally {
            clearTimeout(timer);
        }
    }));

    _probeCache = { at: now(), probes };
    return probes;
}

/** Test helper: reset the probe cache. */
export function clearRelayLatencyProbes(): void {
    _probeCache = null;
    _probeInFlight = null;
}

// ── Small coercion helpers ──────────────────────────────────────────────────

function asStr(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNum(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asStrArr(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string');
}

function parseExpiry(v: unknown): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v; // already epoch ms
    if (typeof v === 'string') {
        const t = Date.parse(v);
        if (Number.isFinite(t)) return t;
    }
    // Unknown/absent expiry → treat as immediately-expiring so the cache never
    // serves a token of unknown lifetime (forces re-resolve next time).
    return Date.now();
}

function joinUrl(base: string, pathSeg: string): string {
    const b = base.endsWith('/') ? base.slice(0, -1) : base;
    const p = pathSeg.startsWith('/') ? pathSeg : `/${pathSeg}`;
    return `${b}${p}`;
}
