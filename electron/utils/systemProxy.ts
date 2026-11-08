// electron/utils/systemProxy.ts
//
// Lets the local-model download workers use the system's proxy.
//
// WHY: every local speech model is downloaded with Node's built-in fetch
// inside a worker thread (transformers.js' hub client, and the Nemotron and
// Parakeet file fetchers). Node's fetch does not read the operating system's
// proxy settings. The rest of the app goes through Chromium's network stack,
// which does — so on a work or school network that requires a proxy, sign-in
// and every cloud feature worked while each model download failed with
// "fetch failed", and nothing in the app could fix it.
//
// HOW: Chromium already knows the answer on both platforms (macOS System
// Settings, Windows proxy settings, PAC scripts): session.resolveProxy(). The
// main process asks it, and a download worker is started with that proxy in
// its environment plus NODE_USE_ENV_PROXY=1, which makes Node's fetch honour
// HTTP(S)_PROXY. Verified 2026-10-14 on this app's runtime (Electron 43 /
// Node 24.21): a worker created with that env sent `CONNECT huggingface.co:443`
// to the proxy; without the opt-in it went direct.
//
// When no proxy applies, no env is passed and nothing changes for anyone.
//
// Not covered: SOCKS proxies (Node's env proxy speaks HTTP CONNECT only) and
// proxies that demand a username and password.
//
// The resolver is injectable so both the "proxy" and the "direct" answers, in
// the exact strings Chromium returns on either OS, are tested without Electron.

/** The host every local STT model is fetched from. */
const DOWNLOAD_PROBE_URL = 'https://huggingface.co/';

/**
 * Chromium's answer is a PAC-style list: "DIRECT", "PROXY host:port",
 * "HTTPS host:port", "SOCKS5 host:port", joined with ";". Returns the first
 * entry Node's env proxy can use as a URL, or null for direct / unusable.
 */
export function proxyUrlFromChromiumList(list: string | null | undefined): string | null {
    for (const raw of String(list ?? '').split(';')) {
        const entry = raw.trim();
        if (!entry) continue;
        const [kind, hostPort] = entry.split(/\s+/, 2);
        const scheme = kind.toUpperCase();
        // Chromium tries the entries in order. DIRECT first means "no proxy".
        if (scheme === 'DIRECT') return null;
        if (!hostPort) continue;
        if (scheme === 'PROXY') return `http://${hostPort}`;
        if (scheme === 'HTTPS') return `https://${hostPort}`;
        // SOCKS / SOCKS4 / SOCKS5 / QUIC: not something HTTP CONNECT can use.
    }
    return null;
}

/**
 * The `env` to construct a download Worker with, or undefined to leave the
 * worker's environment untouched.
 *
 * A proxy the user already configured through the standard variables wins
 * over the system's — it only needs the opt-in to take effect.
 */
export function workerEnvForProxy(
    systemProxyUrl: string | null,
    baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv | undefined {
    const configured = baseEnv.HTTPS_PROXY || baseEnv.https_proxy || baseEnv.HTTP_PROXY || baseEnv.http_proxy;
    if (configured) return { ...baseEnv, NODE_USE_ENV_PROXY: '1' };
    if (!systemProxyUrl) return undefined;
    return {
        ...baseEnv,
        NODE_USE_ENV_PROXY: '1',
        HTTPS_PROXY: systemProxyUrl,
        HTTP_PROXY: systemProxyUrl,
    };
}

let cachedProxyUrl: string | null = null;

/** The last proxy the system reported for model downloads, or null for direct. */
export function getCachedSystemProxy(): string | null {
    return cachedProxyUrl;
}

type ProxyResolver = (url: string) => Promise<string>;

function electronResolver(): ProxyResolver | null {
    try {
        const { session } = require('electron');
        const s = session?.defaultSession;
        if (!s || typeof s.resolveProxy !== 'function') return null;
        return (url: string) => s.resolveProxy(url);
    } catch {
        return null;
    }
}

/**
 * Ask the system which proxy applies to model downloads and remember it.
 * Never rejects and never takes longer than `timeoutMs`: a download must not
 * be held up, or fail, because the proxy lookup did. On any failure the
 * previous answer is kept.
 */
export async function refreshSystemProxy(
    resolver: ProxyResolver | null = electronResolver(),
    timeoutMs: number = 1500,
): Promise<string | null> {
    if (!resolver) return cachedProxyUrl;
    try {
        const TIMED_OUT = Symbol('proxy-lookup-timed-out');
        let timer: NodeJS.Timeout | null = null;
        const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
            timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
            (timer as any).unref?.();
        });
        const answer = await Promise.race([resolver(DOWNLOAD_PROBE_URL), timeout]);
        if (timer) clearTimeout(timer);
        if (answer === TIMED_OUT) return cachedProxyUrl;
        cachedProxyUrl = proxyUrlFromChromiumList(answer);
    } catch {
        // keep the previous answer
    }
    return cachedProxyUrl;
}

/** Test-only: forget the remembered proxy. */
export function __resetSystemProxyForTests(): void {
    cachedProxyUrl = null;
}
