/**
 * Why can't this install reach Natively? (2026-11-18, #759)
 *
 * A key is pasted and Pro never activates; the log says "fetch failed" and the
 * customer cannot say more, because nothing on their side can. A stale Windows
 * certificate store, antivirus HTTPS scanning, a proxy-only network, a wrong
 * clock, DNS and a blocked host all end as that one sentence. This runs a few
 * small checks side by side, picks one verdict, and builds a report that
 * carries nothing but names from fixed lists (funnelCatalog connect_diag).
 *
 * PURE ON PURPOSE. Every probe is injected: no Electron, no OS API, no network,
 * no process.platform. macOS and Windows run the same orchestration and the
 * tests exercise all of it on either. The real probes are in
 * connectivityProbes.ts. Type-erasable TypeScript only (the test imports this
 * file directly).
 *
 * NEVER THROWS, never waits longer than the per-probe limit: it runs after a
 * failure, so it must not become a second one.
 */
import { CONNECT_CODES, CONNECT_INTERCEPTORS } from '../../src/lib/funnel/funnelCatalog.mjs';

export const TLS_CODES: readonly string[] = CONNECT_CODES;

export type Verdict = 'reachable' | 'stale_store' | 'interception' | 'clock' | 'proxy' | 'dns' | 'blocked' | 'offline';
export type CertList = 'builtin' | 'merged';

export interface TlsResult { ok: boolean; code?: string; /** CN of the certificate that signed what we were shown. Never reported as typed. */ issuer?: string }
export interface DiagnosisProbes {
  dns(host: string): Promise<{ ok: boolean; code?: string }>;
  /** A TLS handshake with the Node-shipped list ('builtin') or the list plus the OS's ('merged'). */
  tls(host: string, list: CertList): Promise<TlsResult>;
  http(host: string): Promise<{ status?: number }>;
  /** Two unrelated sites; serverTime is their Date header, ms since epoch. */
  control(): Promise<{ ok: boolean; serverTime?: number; /** The sites were not asked (Usage statistics off): neither "up" nor "down". */ unknown?: boolean }>;
  proxy(): Promise<'none' | 'system' | 'env'>;
  certStats(): { merged: number; dropped: number } | null;
  now(): number;
}

export interface DiagnosisOptions { reason: 'key_saved' | 'pro_check' | 'api_call'; timeoutMs?: number }
export interface Diagnosis {
  verdict: Verdict;
  /** What the app can do about it by itself. */
  heal?: 'drop_system_ca';
  /** Props for funnelCatalog connect_diag. */
  report: Record<string, string | number | boolean>;
  /** Plain words for the person, no host and no jargon beyond the product name. */
  userMessage: string;
}

const CERT_CODES = new Set([
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);
const DATE_CODES = new Set(['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID']);
const CLOCK_SKEW_MIN = 10;

/** Our own chain (Let's Encrypt and its roots) is "none": it says nothing about who interferes. */
const OURS = /let'?s encrypt|isrg|^(r|e|ye|yr)\d+$|^x\d+$/i;
const PRODUCTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/kaspersky/i, 'kaspersky'], [/\beset\b/i, 'eset'], [/\bavast\b/i, 'avast'], [/\bavg\b/i, 'avg'],
  [/bitdefender/i, 'bitdefender'], [/norton|symantec/i, 'norton'], [/mcafee/i, 'mcafee'], [/sophos/i, 'sophos'],
  [/trend\s*micro/i, 'trend_micro'], [/zscaler/i, 'zscaler'], [/netskope/i, 'netskope'], [/fortinet|fortigate/i, 'fortinet'],
  [/palo\s*alto/i, 'palo_alto'], [/umbrella|opendns/i, 'cisco_umbrella'],
];

/** Which product re-signed the connection, from the issuer name — always a name from the fixed list. */
export function classifyIssuer(issuer: string | undefined): string {
  const cn = typeof issuer === 'string' ? issuer.trim().slice(0, 200) : '';
  if (!cn) return 'none';
  for (const [re, name] of PRODUCTS) if (re.test(cn)) return name;
  if (OURS.test(cn)) return 'none';
  return 'other';
}

/** The report's spelling of an error code: lowercase, from the catalogue's list, else "other". */
function codeOf(code: unknown): string {
  const c = typeof code === 'string' ? code.toLowerCase() : '';
  return TLS_CODES.includes(c) ? c : 'other';
}

/** The answer, or the fallback when the probe throws or does not answer in time. */
function settle<T>(run: () => Promise<T>, fallback: T, ms: number): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
    const finish = (v: T) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    try { run().then(finish, () => finish(fallback)); } catch { finish(fallback); }
  });
}

function httpBucket(status: number | undefined): string {
  if (!status) return 'none';
  if (status >= 200 && status < 300) return '2xx';
  if (status === 401 || status === 403 || status === 429) return String(status);
  if (status >= 500) return '5xx';
  return 'other';
}

const MESSAGES: Record<Verdict, string> = {
  reachable: 'Natively\'s servers answered this check, so the connection is working now. If Pro is still not active, close and reopen Natively, or paste the key again.',
  stale_store: 'An out-of-date security certificate on this computer is blocking the connection to Natively. Close and reopen Natively, then try again. If it keeps happening, send the diagnostic report below.',
  interception: 'Something on this computer or network (antivirus web protection, or a company or school filter) is replacing the secure connection to Natively. Turn off its HTTPS or web scanning for Natively, or add Natively to its exceptions, then try again. If your date and time are wrong, set the clock to automatic first.',
  clock: 'This computer\'s date or time looks wrong, so secure connections are being refused. Set the clock to automatic in your system settings, then try again.',
  proxy: 'This computer uses a proxy that is not letting Natively through. Allow Natively through the proxy, or try another network.',
  dns: 'This network cannot look up Natively\'s address. Try another network or a different DNS server, such as 1.1.1.1 or 8.8.8.8.',
  blocked: 'The connection to Natively is being cut off. A firewall or network filter is probably blocking it. Try another network, such as a phone hotspot.',
  offline: 'This computer does not seem to be online. Check your internet connection, then try again.',
};

export async function diagnoseConnection(probes: DiagnosisProbes, host: string, opts: DiagnosisOptions): Promise<Diagnosis> {
  const ms = Math.max(5, opts.timeoutMs ?? 8000);
  const [dns, builtin, merged, http, control, proxy] = await Promise.all([
    settle(() => probes.dns(host), { ok: false, code: 'other' as string | undefined }, ms),
    settle(() => probes.tls(host, 'builtin'), { ok: false, code: 'ETIMEDOUT' as string | undefined } as TlsResult, ms),
    settle(() => probes.tls(host, 'merged'), { ok: false, code: 'ETIMEDOUT' as string | undefined } as TlsResult, ms),
    settle(() => probes.http(host), { status: undefined as number | undefined }, ms),
    settle(() => probes.control(), { ok: false, serverTime: undefined as number | undefined }, ms),
    settle(() => probes.proxy(), 'none' as 'none' | 'system' | 'env', ms),
  ]);
  let stats: { merged: number; dropped: number } | null = null;
  try { stats = probes.certStats(); } catch { /* unknown */ }
  let now = Date.now();
  try { now = probes.now(); } catch { /* wall clock */ }

  const skewMin = control.ok && typeof control.serverTime === 'number'
    ? Math.round(Math.abs(control.serverTime - now) / 60_000) : undefined;
  const failing = !builtin.ok ? builtin : merged;
  const interceptor = classifyIssuer(builtin.issuer ?? merged.issuer);

  const controlKnown = control.unknown !== true;
  const certFailure = CERT_CODES.has(String(failing.code));

  let verdict: Verdict;
  let heal: Diagnosis['heal'];
  if (builtin.ok && merged.ok) {
    verdict = 'reachable';
  } else if (builtin.ok && !merged.ok && certFailure) {
    // Node's own list connects, the list with the OS's merged in does not: the OS store is the problem.
    verdict = 'stale_store';
    heal = 'drop_system_ca';
  } else if (builtin.ok || merged.ok) {
    // One list works: what the app itself uses (the merged one) connects, or the failing one failed for a
    // passing reason. Either way the app can reach us; an interceptor, if any, is recorded below.
    verdict = 'reachable';
  } else if (certFailure) {
    // A certificate error means the connection was made, so the control sites and the proxy do not matter.
    verdict = DATE_CODES.has(String(failing.code)) && skewMin !== undefined && skewMin >= CLOCK_SKEW_MIN ? 'clock' : 'interception';
  } else if (proxy !== 'none') {
    // Checked before "offline": on a proxy-only network the direct control probe fails as well.
    verdict = 'proxy';
  } else if (controlKnown && !control.ok) {
    verdict = 'offline';
  } else if (!dns.ok) {
    verdict = 'dns';
  } else {
    verdict = 'blocked';
  }

  const report: Record<string, string | number | boolean> = {
    reason: opts.reason,
    verdict,
    tls_builtin: builtin.ok ? 'ok' : codeOf(builtin.code),
    tls_merged: merged.ok ? 'ok' : codeOf(merged.code),
    dns: dns.ok ? 'ok' : codeOf(dns.code),
    http: httpBucket(http.status),
    interceptor: CONNECT_INTERCEPTORS.includes(interceptor) ? interceptor : 'other',
    proxy,
  };
  if (controlKnown) report.control_ok = control.ok === true;
  if (skewMin !== undefined) report.clock_skew_min = Math.min(skewMin, 10_000_000);
  if (stats) { report.certs_merged = Math.max(0, stats.merged | 0); report.certs_dropped = Math.max(0, stats.dropped | 0); }

  return { verdict, ...(heal ? { heal } : {}), report, userMessage: MESSAGES[verdict] };
}
