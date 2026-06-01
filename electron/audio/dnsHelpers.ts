import dns from 'dns';

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
    // Primary: use dns.lookup with IPv4 family — fast path when it works.
    // Fallback: dns.resolve4 if lookup fails. On some networks (e.g. routers
    // with link-local IPv6 DNS that intermittently drops A-record queries),
    // getaddrinfo returns ENOTFOUND even though A records exist. resolve4
    // queries the DNS authoritative server directly and is more reliable.
    //
    // Caveat: dns.resolve4 bypasses /etc/hosts, mDNS, and the OS resolver
    // cache (it talks to configured DNS servers directly). That's exactly what
    // we want for the public STT endpoints this helper serves, but it means a
    // future caller pointing this at a localhost/dev hostname won't get the
    // /etc/hosts override on the fallback path.
    dns.lookup(hostname, { ...options, family: 4 }, (err, addr, family) => {
        if (err) {
            dns.resolve4(hostname, (err4, addrs) => {
                if (err4) {
                    callback(err4);
                } else if (addrs && addrs.length > 0) {
                    callback(null, addrs[0], 4);
                } else {
                    // resolve4 returns either an error or a non-empty array, so
                    // this is a defensive edge. Emit a real Error (with .code)
                    // so consumers that do `err instanceof Error` or read
                    // err.stack behave consistently with the other error paths.
                    const e = new Error('No A records for ' + hostname) as NodeJS.ErrnoException;
                    e.code = 'ENOTFOUND';
                    callback(e);
                }
            });
        } else {
            callback(null, addr, family);
        }
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
