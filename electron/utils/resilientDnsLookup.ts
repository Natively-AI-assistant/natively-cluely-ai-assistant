// electron/utils/resilientDnsLookup.ts
//
// A process-wide `dns.lookup` that survives a stalled resolver.
//
// WHY (measured 2026-09-10, MacBook on an iPhone hotspot — an IPv6/NAT64
// network whose DNS forwarder intermittently stops answering):
//
//   c-ares  dns.resolve4('api.natively.software')   8,009 ms
//   system  dns.lookup  ('api.natively.software')      11 ms
//
// main.ts used to override `dns.lookup` so that api.natively.software went
// through c-ares `resolve4` FIRST (a 2026 workaround for a macOS getaddrinfo
// ENOTFOUND on the Railway CNAME chain). c-ares queries the resolvers in
// /etc/resolv.conf directly, with no cache and no bound; when the first of
// them is a dead link-local hotspot address every Natively request waited
// ~8 s in name resolution, blew the 4 s connect budget, was classified as a
// provider stall, retried, hedged, regenerated — and the user read "The model
// did not produce an answer in time" while curl reached the same host in
// 0.45 s. The same resolver hang starved getaddrinfo for every OTHER host on
// the libuv threadpool, so Gemini's own key failed with "fetch failed" too.
//
// WHAT THIS DOES, for every hostname:
//   1. serve a fresh cache entry (60 s) without touching a resolver;
//   2. otherwise run the SYSTEM lookup (getaddrinfo — honours /etc/hosts,
//      mDNS, VPN split DNS, NAT64 synthesis) raced against a short timer;
//   3. a STALE entry (≤ 30 min) is served at once and refreshed in the
//      background (the server's address almost never changed — only the
//      resolver is having a moment), so a hang costs the caller nothing;
//   4. with no entry at all: the bounded system lookup, then bounded c-ares
//      resolve4 — the original ENOTFOUND workaround, kept as a fallback
//      instead of the primary path;
//   5. otherwise report the system lookup's own error.
//
// Pure Node `dns` API — identical on macOS and Windows. Injectable so the
// contract is unit-tested without a resolver.

import dns from 'dns';

export interface ResilientLookupDeps {
  lookup?: typeof dns.lookup;
  resolve4?: typeof dns.resolve4;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  /** Fresh-for window per hostname. */
  ttlMs?: number;
  /** How long a stale entry may still be served when the resolver fails. */
  staleMaxMs?: number;
  /** Bound on ONE resolver attempt (system lookup, then c-ares). */
  attemptTimeoutMs?: number;
  log?: (message: string) => void;
  /** Test hook: how a callback is deferred (default process.nextTick). */
  defer?: (fn: () => void) => void;
}

interface CacheEntry {
  address: string;
  family: 4 | 6;
  all: Array<{ address: string; family: 4 | 6 }>;
  storedAt: number;
}

export const DNS_CACHE_TTL_MS = 60_000;
export const DNS_STALE_MAX_MS = 30 * 60_000;
export const DNS_ATTEMPT_TIMEOUT_MS = 2_500;

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void;

export function createResilientLookup(deps: ResilientLookupDeps = {}) {
  const lookup = deps.lookup ?? dns.lookup;
  const resolve4 = deps.resolve4 ?? dns.resolve4;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const ttlMs = deps.ttlMs ?? DNS_CACHE_TTL_MS;
  const staleMaxMs = deps.staleMaxMs ?? DNS_STALE_MAX_MS;
  const attemptTimeoutMs = deps.attemptTimeoutMs ?? DNS_ATTEMPT_TIMEOUT_MS;
  const log = deps.log ?? ((m: string) => console.warn(m));
  const cache = new Map<string, CacheEntry>();
  let lastSystemError: unknown = null;

  // ALWAYS call back asynchronously. Node's own dns.lookup never calls back
  // in the same tick (IP literals are deferred to nextTick), and net.connect's
  // happy-eyeballs path relies on that: when a cache hit called back
  // synchronously, `emitLookup → internalConnectMultiple` ran INSIDE the
  // lookup call, a network flap made every connect() fail at once, and the
  // AggregateError [EHOSTUNREACH] surfaced as an uncaughtException that took
  // the main process down (measured 2026-09-11, 68 minutes into a run).
  const defer = deps.defer ?? ((fn: () => void) => process.nextTick(fn));
  const reply = (cb: LookupCallback, entry: CacheEntry, options: any) => {
    defer(() => {
      if (options && options.all) cb(null, entry.all.map((a) => ({ address: a.address, family: a.family })));
      else cb(null, entry.address, entry.family);
    });
  };

  const cacheKey = (hostname: string, options: any) => {
    const family = options && typeof options.family === 'number' ? options.family : 0;
    return `${hostname.toLowerCase()}|${family}`;
  };

  /** Run one resolver attempt, bounded. Resolves `null` on error/timeout. */
  const attemptSystem = (hostname: string, options: any): Promise<CacheEntry | null> => new Promise((resolve) => {
    let settled = false;
    const timer = setTimer(() => { if (!settled) { settled = true; resolve(null); } }, attemptTimeoutMs);
    try {
      // Always ask for every address so one attempt can serve both the
      // `all:true` and the single-address shape from the same cache entry.
      lookup(hostname, { ...(options || {}), all: true }, (err: any, addresses: any) => {
        if (settled) return;
        settled = true; clearTimer(timer);
        const list = Array.isArray(addresses) ? addresses.filter((a) => a && typeof a.address === 'string') : [];
        if (err || list.length === 0) { lastSystemError = err; resolve(null); return; }
        resolve({ address: list[0].address, family: list[0].family === 6 ? 6 : 4, all: list.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 })), storedAt: now() });
      });
    } catch (e) { if (!settled) { settled = true; clearTimer(timer); lastSystemError = e; resolve(null); } }
  });

  const attemptCares = (hostname: string): Promise<CacheEntry | null> => new Promise((resolve) => {
    let settled = false;
    const timer = setTimer(() => { if (!settled) { settled = true; resolve(null); } }, attemptTimeoutMs);
    try {
      resolve4(hostname, (err: any, addresses: any) => {
        if (settled) return;
        settled = true; clearTimer(timer);
        const list = Array.isArray(addresses) ? addresses.filter((a) => typeof a === 'string' && a) : [];
        if (err || list.length === 0) { resolve(null); return; }
        resolve({ address: list[0], family: 4, all: list.map((a) => ({ address: a, family: 4 as const })), storedAt: now() });
      });
    } catch { if (!settled) { settled = true; clearTimer(timer); resolve(null); } }
  });

  const refreshing = new Set<string>();
  const refreshInBackground = (key: string, hostname: string, options: any): void => {
    if (refreshing.has(key)) return;
    refreshing.add(key);
    void attemptSystem(hostname, options).then((fresh) => {
      refreshing.delete(key);
      if (fresh) { cache.set(key, fresh); return; }
      const entry = cache.get(key);
      if (entry) log(`[dns] system lookup for ${hostname} failed or exceeded ${attemptTimeoutMs}ms; still serving the address from ${Math.round((now() - entry.storedAt) / 1000)}s ago`);
    });
  };

  const resilientLookup = function (hostname: string, options: any, callback?: any): void {
    if (typeof options === 'function') { callback = options; options = {}; }
    const cb: LookupCallback = callback;
    if (typeof hostname !== 'string' || !hostname) { lookup(hostname as any, options, cb as any); return; }
    // Literal IPs and localhost never need a resolver; let Node handle them.
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':') || hostname === 'localhost') { lookup(hostname, options, cb as any); return; }

    const key = cacheKey(hostname, options);
    const cached = cache.get(key);
    const t = now();
    if (cached && t - cached.storedAt < ttlMs) { reply(cb, cached, options); return; }
    // Stale-while-revalidate. A known address is served IMMEDIATELY and the
    // resolver is asked again in the background; waiting the attempt bound
    // first cost the caller 2.5 s of its own budget on every resolver hang
    // (measured: a 3 s query-embed timeout left with 0.5 s). The server's
    // address is far more stable than the resolver's mood.
    if (cached && t - cached.storedAt < staleMaxMs) {
      reply(cb, cached, options);
      refreshInBackground(key, hostname, options);
      return;
    }

    void (async () => {
      const fresh = await attemptSystem(hostname, options);
      if (fresh) { cache.set(key, fresh); reply(cb, fresh, options); return; }
      const viaCares = await attemptCares(hostname);
      if (viaCares) {
        log(`[dns] system lookup for ${hostname} failed; resolved via c-ares`);
        cache.set(key, viaCares); reply(cb, viaCares, options); return;
      }
      const err: NodeJS.ErrnoException = lastSystemError instanceof Error
        ? lastSystemError
        : Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname });
      defer(() => cb(err));
    })();
  } as typeof dns.lookup;

  return {
    lookup: resilientLookup,
    /** Test/diagnostic access. */
    cacheSize: () => cache.size,
    clear: () => cache.clear(),
  };
}

/** Install the resilient lookup as the process-wide `dns.lookup`. Idempotent. */
export function installResilientDnsLookup(deps: ResilientLookupDeps = {}): void {
  const g = globalThis as any;
  if (g.__nativelyResilientDnsInstalled__) return;
  const original = dns.lookup;
  const resilient = createResilientLookup({ lookup: original, ...deps });
  (dns as any).lookup = resilient.lookup;
  g.__nativelyResilientDnsInstalled__ = true;
}
