/**
 * The opt-in diagnostic report, device side (2026-11-18, #759).
 *
 * What a person agrees to when they click "Send diagnostic report": the
 * connection check's result and the tail of the app's own log, masked a second
 * time here. The text the preview shows IS the text that is sent.
 *
 * The log is free text, which is why this is not a funnel event: it has its own
 * route (natively-api diagnosticReports.js), its own click, a size cap and 30-day
 * retention. See PRIVACY.md "Diagnostic report".
 *
 * PURE ON PURPOSE: the log text is passed in, the network is injected, nothing
 * here touches an OS API or branches on the platform, so macOS and Windows run
 * the same cases. Type-erasable TypeScript only (the test imports this file
 * directly), so the credential masker is injected rather than imported.
 */
import { checkFunnelProps, CONNECT_VERDICTS } from '../../src/lib/funnel/funnelCatalog.mjs';

export const LOG_LIMITS = Object.freeze({ lines: 400, chars: 60_000 });

export interface DiagnosisInput {
  reason?: string;
  verdict?: string;
  report?: Record<string, unknown>;
}

export interface DiagnosticPayload {
  schema: 1;
  sent_by_user: true;
  install_id: string;
  app_version: string;
  platform: string;
  reason: 'key_saved' | 'pro_check' | 'api_call' | 'manual';
  verdict?: string;
  report?: Record<string, string | number | boolean>;
  log_text: string;
}

/** The newest lines, cut on a line boundary (one line longer than the limit is cut, not dropped). */
export function tailLog(text: string, limits: { lines: number; chars: number } = LOG_LIMITS): string {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let kept = lines.slice(-limits.lines);
  let joined = kept.join('\n');
  while (joined.length > limits.chars && kept.length > 1) {
    kept = kept.slice(1);
    joined = kept.join('\n');
  }
  return joined.length > limits.chars ? joined.slice(-limits.chars) : joined;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
// Full form, or a compressed one (it contains "::", which a clock time never does).
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?(?![0-9a-z_])/gi;
const BEARER_RE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
// A home folder name can hold a space ("John Smith"), so the name runs to the next
// separator, a quote or the end of the line, not to the first space. Windows paths
// appear with single backslashes, doubled ones (JSON-escaped), or forward slashes.
const MAC_HOME_RE = /(\/Users\/)[^/\r\n"'`<>|]+/g;
const LINUX_HOME_RE = /(\/home\/)[^/\r\n"'`<>|]+/g;
const WIN_HOME_RE = /([A-Za-z]:)?((?:\\{1,2}|\/)Users(?:\\{1,2}|\/))[^\\/\r\n"'`<>|:*?]+/gi;

/**
 * A second pass over a log that was already redacted as it was written: the
 * credential masker the app already uses (injected), then what a stranger
 * should not learn from a log: e-mail addresses, ids, network addresses and the
 * name of the person's home folder. What support needs stays: error codes, host
 * names, versions and the app's own words.
 */
export function maskLog(text: string, maskCredentials: (t: string) => string): string {
  let out = maskCredentials(String(text ?? ''));
  out = out.replace(BEARER_RE, '$1 …');
  out = out.replace(EMAIL_RE, '<email>');
  out = out.replace(UUID_RE, '<id>');
  out = out.replace(IPV4_RE, '<ip>');
  out = out.replace(IPV6_RE, '<ip>');
  out = out.replace(MAC_HOME_RE, '$1<user>').replace(LINUX_HOME_RE, '$1<user>').replace(WIN_HOME_RE, (_m, drive = '', sep) => `${drive}${sep}<user>`);
  return out;
}

export interface BuildInput {
  logText: string;
  installId: string;
  appVersion: string;
  platform: string;
  diagnosis?: DiagnosisInput;
  mask: (t: string) => string;
  /** Leave the log out: detailed logging was on, so it may hold meeting text. */
  omitLog?: boolean;
}

export function buildDiagnosticReport(input: BuildInput): { payload: DiagnosticPayload; preview: string } {
  const log_text = input.omitLog ? '' : maskLog(tailLog(input.logText, LOG_LIMITS), input.mask);

  const d = input.diagnosis;
  const reason = d?.reason === 'key_saved' || d?.reason === 'pro_check' || d?.reason === 'api_call' ? d.reason : 'manual';
  const verdict = d?.verdict && (CONNECT_VERDICTS as readonly string[]).includes(d.verdict) ? d.verdict : undefined;
  let report: Record<string, string | number | boolean> | undefined;
  if (d?.report) {
    const checked = checkFunnelProps('connect_diag', d.report);
    if (checked.ok) report = checked.props;
  }

  const payload: DiagnosticPayload = {
    schema: 1, sent_by_user: true, install_id: input.installId, app_version: input.appVersion, platform: input.platform,
    reason, ...(verdict ? { verdict } : {}), ...(report ? { report } : {}), log_text,
  };

  const preview = [
    'Natively diagnostic report',
    `App ${input.appVersion} · ${input.platform} · ${reason}${verdict ? ` · ${verdict}` : ''}`,
    report ? `Connection check: ${Object.entries(report).map(([k, v]) => `${k}=${v}`).join(', ')}` : 'Connection check: not available',
    '',
    ...(input.omitLog
      ? ['Log: left out, because detailed logging is switched on in Settings › General › Advanced and the log may hold what was said in your meetings. Switch it back to standard to include the log.']
      : [`Log (the last ${log_text ? log_text.split('\n').length : 0} lines, with keys, e-mail addresses, ids, network addresses and your user name hidden):`, log_text || '(the log is empty)']),
  ].join('\n');

  return { payload, preview };
}

export type SendOutcome =
  | { ok: true; ref: string }
  | { ok: false; error: 'network' | 'unavailable' | 'rate_limited' | 'rejected' };

/** Never throws. Each failure has one plain outcome the UI can word. */
export async function sendDiagnosticReport(opts: {
  payload: DiagnosticPayload;
  endpoint: string;
  headers: () => Promise<Record<string, string>>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<SendOutcome> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let identity: Record<string, string> = {};
  try { identity = await opts.headers(); } catch { /* the server answers 401, which is reported as rejected */ }
  try {
    // The timeout cancels the request: a send that is given up on must not still arrive and be stored twice.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Abort the request AND stop waiting for it: a fetch that ignores the signal must not hold the button forever.
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
    });
    let res: Response;
    try {
      res = await Promise.race([
        doFetch(opts.endpoint, { method: 'POST', headers: { ...identity, 'content-type': 'application/json' }, body: JSON.stringify(opts.payload), signal: controller.signal }),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 200 || res.status === 201) {
      const body = (await res.json().catch(() => null)) as { ref?: unknown } | null;
      return { ok: true, ref: typeof body?.ref === 'string' ? body.ref.slice(0, 16) : '' };
    }
    if (res.status === 429) return { ok: false, error: 'rate_limited' };
    if (res.status >= 500) return { ok: false, error: 'unavailable' };
    return { ok: false, error: 'rejected' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * What was previewed is what is sent. The log keeps growing while a person reads
 * the preview, so a send that rebuilt it would carry lines they never saw. The
 * preview is kept for ttlMs (a preview left open for an hour is stale, so it is
 * rebuilt); a failed send keeps it so the retry sends the same text; a successful
 * one clears it.
 */
export function createReportSession<T extends { payload: DiagnosticPayload; preview: string }>(deps: {
  build(): T;
  send(payload: T['payload']): Promise<SendOutcome>;
  now?(): number;
  ttlMs?: number;
}) {
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.ttlMs ?? 10 * 60_000;
  let held: { built: T; at: number } | null = null;
  const current = (): T => {
    if (!held || now() - held.at > ttl) held = { built: deps.build(), at: now() };
    return held.built;
  };
  return {
    /** Build (or reuse) the report and return what the person is shown. */
    async preview(): Promise<{ preview: string }> { return { preview: current().preview }; },
    async send(): Promise<SendOutcome> {
      const built = current();
      const outcome = await deps.send(built.payload);
      if (outcome.ok) held = null;
      return outcome;
    },
  };
}
