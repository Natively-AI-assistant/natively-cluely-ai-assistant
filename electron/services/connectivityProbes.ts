/**
 * The real checks behind connectivityDiagnosis (2026-11-18, #759): a DNS lookup,
 * a TLS handshake with each certificate list, one HTTPS request, a look at two
 * unrelated sites, and the proxy setting. Node's own APIs only — the same on
 * macOS and Windows; the only OS-specific input (the system proxy) arrives as an
 * injected resolveProxy, so tests need no Electron.
 *
 * WHAT LEAVES THIS COMPUTER: an ordinary connection to Natively (the same one
 * that just failed) and a HEAD request to two public connectivity-check
 * endpoints. No key, no header, no body.
 */
import * as nodeTls from 'tls';
import * as nodeDns from 'dns';
import * as nodeHttps from 'https';
import { CONNECT_CODES } from '../../src/lib/funnel/funnelCatalog.mjs';
import type { DiagnosisProbes, CertList, TlsResult } from './connectivityDiagnosis';

type CaApi = { getCACertificates?: (type?: 'default' | 'system' | 'bundled' | 'extra') => string[] };

export interface RealProbeOptions {
  /** The API's port. 443 outside tests. */
  port?: number;
  /** The certificates each list trusts. undefined → Node's default. */
  caLists?: { builtin: () => string[] | undefined; merged: () => string[] | undefined };
  controlUrls?: string[];
  env?: Record<string, string | undefined>;
  resolveProxy?: (url: string) => Promise<string>;
  /** For the API request; the page under test is /v1/usage. */
  fetchImpl?: typeof fetch;
  certStats?: () => { merged: number; dropped: number } | null;
  now?: () => number;
  timeoutMs?: number;
}

const DEFAULT_CONTROL = ['https://cp.cloudflare.com/generate_204', 'https://www.google.com/generate_204'];

function nodeCaLists(): NonNullable<RealProbeOptions['caLists']> {
  const api = nodeTls as unknown as CaApi;
  const read = (t: 'default' | 'bundled' | 'extra') => { try { return api.getCACertificates?.(t); } catch { return undefined; } };
  return {
    // What Node ships, without the OS's certificates.
    builtin: () => { const b = read('bundled'); return b ? [...b, ...(read('extra') ?? [])] : undefined; },
    // What requests use right now.
    merged: () => read('default'),
  };
}

function codeFrom(e: any): string {
  const c = typeof e === 'string' ? e : e?.code ?? e?.cause?.code;
  return typeof c === 'string' && CONNECT_CODES.includes(c.toLowerCase()) ? c : 'other';
}

export function createRealProbes(opts: RealProbeOptions = {}): DiagnosisProbes {
  const port = opts.port ?? 443;
  const lists = opts.caLists ?? nodeCaLists();
  const env = opts.env ?? process.env;
  const timeout = opts.timeoutMs ?? 7000;
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  return {
    dns: async (host) => {
      try { await nodeDns.promises.lookup(host); return { ok: true }; } catch (e) { return { ok: false, code: codeFrom(e) }; }
    },

    // One handshake that never refuses: it records whether the list verified the
    // chain, why not, and who signed what was presented.
    tls: (host: string, list: CertList) => new Promise<TlsResult>((resolve) => {
      let ca: string[] | undefined;
      try { ca = list === 'builtin' ? lists.builtin() : lists.merged(); } catch { ca = undefined; }
      let settled = false;
      const done = (r: TlsResult) => { if (!settled) { settled = true; resolve(r); } };
      let socket: nodeTls.TLSSocket;
      try {
        socket = nodeTls.connect({ host, port, servername: host, ...(ca ? { ca } : {}), rejectUnauthorized: false, timeout });
      } catch (e) { return done({ ok: false, code: codeFrom(e) }); }
      socket.once('secureConnect', () => {
        const err = socket.authorizationError as unknown;
        let issuer: string | undefined;
        try { const cn = socket.getPeerCertificate()?.issuer?.CN as unknown; issuer = Array.isArray(cn) ? String(cn[0]) : cn ? String(cn) : undefined; } catch { /* unknown */ }
        socket.destroy();
        done(socket.authorized ? { ok: true } : { ok: false, code: codeFrom(typeof err === 'string' ? err : (err as any)?.code), issuer });
      });
      socket.once('error', (e) => { socket.destroy(); done({ ok: false, code: codeFrom(e) }); });
      socket.once('timeout', () => { socket.destroy(); done({ ok: false, code: 'ETIMEDOUT' }); });
    }),

    http: async (host) => {
      try {
        const res = await doFetch(`https://${host}${port === 443 ? '' : `:${port}`}/v1/usage`, { signal: AbortSignal.timeout(timeout) });
        return { status: res.status };
      } catch { return { status: undefined }; }
    },

    // Reachability and the other side's clock, so certificates are NOT checked:
    // an interceptor must not make "the internet is down" out of "I distrust its
    // certificate". Nothing is sent but the request line.
    control: async () => {
      const urls = opts.controlUrls ?? DEFAULT_CONTROL;
      if (urls.length === 0) return { ok: false, unknown: true };
      const results = await Promise.all(urls.map((u) => new Promise<{ ok: boolean; serverTime?: number }>((resolve) => {
        try {
          const req = nodeHttps.request(u, { method: 'HEAD', rejectUnauthorized: false, timeout }, (res) => {
            const t = Date.parse(String(res.headers.date ?? ''));
            res.resume();
            resolve({ ok: true, serverTime: Number.isFinite(t) ? t : undefined });
          });
          req.once('timeout', () => { req.destroy(); resolve({ ok: false }); });
          req.once('error', () => resolve({ ok: false }));
          req.end();
        } catch { resolve({ ok: false }); }
      })));
      const ok = results.find((r) => r.ok && r.serverTime !== undefined) ?? results.find((r) => r.ok);
      return ok ?? { ok: false };
    },

    proxy: async () => {
      if (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy) return 'env';
      try {
        const answer = await opts.resolveProxy?.('https://api.natively.software');
        return answer && !/^\s*DIRECT\s*$/i.test(answer) ? 'system' : 'none';
      } catch { return 'none'; }
    },

    certStats: opts.certStats ?? (() => null),
    now: opts.now ?? (() => Date.now()),
  };
}
