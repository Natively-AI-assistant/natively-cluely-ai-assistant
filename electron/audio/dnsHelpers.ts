import dns from 'dns';

// TTL-based IP cache for WebSocket DNS lookups.
// Railway sets a 1-second TTL on their DNS records, so without this every WS
// reconnect does a fresh resolver call. If the resolver hiccups for even 2-3
// seconds, the reconnect storm produces a wall of ENOTFOUND even though the
// server IP hasn't changed. The cache survives that window by serving the last
// known IP (even if the cache entry is expired — stale-on-error path below).
const _dnsCache = new Map<string, { addr: string; expires: number }>();
const DNS_CACHE_TTL_MS = 60_000;

/**
 * IPv4-only DNS resolver for STT WebSocket connections.
 *
 * Why this exists: on macOS, Node's default `getaddrinfo(AF_UNSPEC)` lookup on
 * dual-stack hosts can return a hard `ENOTFOUND` for IPv4-only CNAME chains
 * (e.g. api.natively.software → *.up.railway.app → 66.33.22.108) when the
 * machine has a link-local IPv6 address (fe80::…) but no real v6 path.
 * curl/libcurl handles this gracefully by falling back to v4; libuv on Darwin
 * sometimes does not. Symptom: `nslookup` and `curl` resolve fine from the
 * same machine, but every `new WebSocket('wss://…')` fires
 * `error: getaddrinfo ENOTFOUND <host>` — never reaching the server, so
 * transcripts never start.
 *
 * Forcing family=4 mirrors curl's effective behavior: skip IPv6 entirely.
 * Streaming STT endpoints (Natively, ElevenLabs, Soniox, OpenAI Realtime) are
 * effectively IPv4-only at the edge today, so we lose nothing by pinning the
 * resolver here. If a vendor later moves to IPv6-only or v6-preferred, swap
 * to family=0 (AF_UNSPEC) with a custom v6→v4 fallback.
 */
export const ipv4OnlyLookup = (hostname: string, options: any, callback?: any): void => {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    const cacheKey = hostname;
    const cached = _dnsCache.get(cacheKey);

    // Serve from cache if still fresh — avoids hitting the resolver entirely.
    if (cached && Date.now() < cached.expires) {
        return callback(null, cached.addr, 4);
    }

    const store = (addr: string) => {
        _dnsCache.set(cacheKey, { addr, expires: Date.now() + DNS_CACHE_TTL_MS });
        callback(null, addr, 4);
    };

    // Primary: use dns.lookup with IPv4 family — fast path when it works.
    // Fallback 1: dns.resolve4 if lookup fails (bypasses OS resolver, queries
    //   authoritative DNS directly — more reliable on some networks).
    // Fallback 2 (stale-on-error): if both fail but a cached entry exists
    //   (even expired), serve the old IP rather than propagating ENOTFOUND.
    //   The server at that IP is almost certainly still alive; only the DNS
    //   resolver is having a moment (Railway's 1s TTL flap pattern).
    dns.lookup(hostname, { ...options, family: 4 }, (err, addr) => {
        if (!err) return store(addr);

        dns.resolve4(hostname, (err4, addrs) => {
            if (!err4 && addrs?.length > 0) return store(addrs[0]);

            // Both resolver paths failed — serve stale cache if available.
            if (cached) {
                console.warn(`[dnsHelpers] resolver failed for ${hostname}, serving stale IP ${cached.addr}`);
                return callback(null, cached.addr, 4);
            }

            const e = new Error('No A records for ' + hostname) as NodeJS.ErrnoException;
            e.code = 'ENOTFOUND';
            callback(e);
        });
    });
};

/**
 * Standard `ws` options for every streaming-STT WebSocket. Adds:
 *   - lookup: ipv4OnlyLookup        (avoids the macOS dual-stack ENOTFOUND)
 *   - family: 4                     (defense-in-depth — `ws` forwards this to
 *                                    https.request → tls.connect)
 *   - handshakeTimeout: 15000       (caps how long we wait for the TLS+upgrade
 *                                    handshake before giving up; without this
 *                                    a stuck handshake hangs on the kernel TCP
 *                                    keepalive timer, which can be minutes)
 */
export function streamingStttWsOptions(extra?: Record<string, unknown>): Record<string, unknown> {
    return {
        lookup: ipv4OnlyLookup,
        family: 4,
        handshakeTimeout: 15_000,
        ...(extra || {}),
    };
}
