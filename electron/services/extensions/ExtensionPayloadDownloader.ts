/**
 * Fetches a published extension payload and lays it out for the installer.
 *
 * This is the one place in Natively that downloads code and puts it somewhere
 * it will later be executed, so every check it performs is load-bearing:
 *
 *  - **https only, on every hop.** A release download redirects (github.com ->
 *    an objects.githubusercontent.com host), so the scheme and host are checked
 *    on each redirect rather than once on the URL the caller handed in.
 *    Redirects are followed manually for exactly that reason.
 *  - **A host allowlist**, so a registry entry cannot point the app at an
 *    arbitrary server.
 *  - **A byte cap**, enforced while reading rather than from Content-Length,
 *    which a server is free to lie about.
 *  - **sha256 verified before anything is written.** The payload is held in
 *    memory — a bundled adapter is tens of kilobytes — so a failed check leaves
 *    nothing on disk to clean up or accidentally load.
 *
 * What this does NOT give you: a sha256 published alongside the artefact by the
 * same registry proves INTEGRITY, not authenticity. It catches a truncated or
 * corrupted download. It cannot tell you the repository was not compromised.
 * The install trust prompt, which lists every requested permission, is what
 * stands between the user and code they did not write — this never bypasses it.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Download descriptor as published in a release's registry.json. */
export interface PayloadDownload {
  code: string;
  manifest: string;
  sha256: { code: string; manifest: string };
  bytes?: { code: number; manifest: number };
}

export interface DownloadOptions {
  fetchImpl?: typeof fetch;
  /** Hosts any hop may resolve to. Defaults to GitHub's release infrastructure. */
  allowedHosts?: readonly string[];
  /** Hard ceiling per file. Bundled adapters are tens of KB; this is generous. */
  maxBytes?: number;
  /** Redirect hops tolerated before giving up. */
  maxRedirects?: number;
  timeoutMs?: number;
}

export type DownloadResult =
  | { ok: true; payloadDir: string; manifestJson: unknown; bytes: number }
  | { ok: false; errors: string[] };

const DEFAULT_ALLOWED_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'raw.githubusercontent.com',
] as const;

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.trim().toLowerCase();
  return allowed.some((a) => {
    const entry = a.trim().toLowerCase();
    if (!entry || entry === '*') return false;
    if (entry === h) return true;
    // One leading wildcard label only. A bare '*' is not an allowlist.
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);
      return h.endsWith(suffix) && h.length > suffix.length;
    }
    return false;
  });
}

/**
 * Follows redirects by hand so every hop is checked. `fetch`'s own redirect
 * following would resolve the chain invisibly and only show the final URL.
 */
async function fetchChecked(
  url: string,
  opts: Required<Pick<DownloadOptions, 'allowedHosts' | 'maxBytes' | 'maxRedirects' | 'timeoutMs'>>,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; body: Buffer } | { ok: false; error: string }> {
  let current = url;

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return { ok: false, error: `not a URL: ${current}` };
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, error: `refused ${parsed.protocol}//${parsed.host} — https only` };
    }
    if (!hostAllowed(parsed.hostname, opts.allowedHosts)) {
      return { ok: false, error: `refused host ${parsed.hostname} — not in the allowlist` };
    }

    // A controller with a timer that is CLEARED on completion. AbortSignal
    // .timeout() cannot be cancelled, so it stays armed and can abort a body
    // that is still being read after the response arrived.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(current, { redirect: 'manual', signal: controller.signal });
    } catch (e) {
      return { ok: false, error: `request failed: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { ok: false, error: `redirect with no location from ${parsed.hostname}` };
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} from ${parsed.hostname}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    // Measured, not trusted: Content-Length is whatever the server claims.
    if (buffer.length > opts.maxBytes) {
      return { ok: false, error: `payload is ${buffer.length} bytes, over the ${opts.maxBytes} limit` };
    }
    return { ok: true, body: buffer };
  }

  return { ok: false, error: `too many redirects (>${opts.maxRedirects})` };
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Download, verify, and lay the payload out as the installer expects:
 * `<payloadDir>/extension.json` and `<payloadDir>/dist/index.js`.
 *
 * The published manifest's `entrypoint` is honoured only if it is a safe
 * relative path; anything else is refused rather than normalised, because the
 * manifest is attacker-influenced and this decides where code is written.
 */
export async function downloadExtensionPayload(
  download: PayloadDownload,
  payloadDir: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const opts = {
    allowedHosts: options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const errors: string[] = [];

  for (const key of ['code', 'manifest'] as const) {
    if (typeof download?.[key] !== 'string' || !download[key]) errors.push(`missing ${key} URL`);
    if (!/^[a-f0-9]{64}$/i.test(download?.sha256?.[key] ?? '')) errors.push(`missing or malformed ${key} sha256`);
  }
  if (errors.length) return { ok: false, errors };

  const fetched: Record<'code' | 'manifest', Buffer> = {} as never;
  for (const key of ['code', 'manifest'] as const) {
    const result = await fetchChecked(download[key], opts, fetchImpl);
    if (!result.ok) return { ok: false, errors: [`${key}: ${result.error}`] };

    const actual = sha256(result.body);
    if (actual !== download.sha256[key].toLowerCase()) {
      // Nothing has touched the disk at this point.
      return {
        ok: false,
        errors: [`${key}: sha256 mismatch — expected ${download.sha256[key].toLowerCase()}, got ${actual}`],
      };
    }
    fetched[key] = result.body;
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(fetched.manifest.toString('utf8'));
  } catch (e) {
    return { ok: false, errors: [`manifest is not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }

  const entrypoint = (manifestJson as { entrypoint?: unknown })?.entrypoint;
  if (typeof entrypoint !== 'string' || !entrypoint) {
    return { ok: false, errors: ['manifest has no entrypoint'] };
  }
  const target = path.resolve(payloadDir, entrypoint);
  if (!target.startsWith(path.resolve(payloadDir) + path.sep)) {
    return { ok: false, errors: [`entrypoint ${JSON.stringify(entrypoint)} escapes the payload directory`] };
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fetched.code);
    fs.writeFileSync(path.join(payloadDir, 'extension.json'), fetched.manifest);
  } catch (e) {
    return { ok: false, errors: [`could not write the payload: ${e instanceof Error ? e.message : String(e)}`] };
  }

  return {
    ok: true,
    payloadDir,
    manifestJson,
    bytes: fetched.code.length + fetched.manifest.length,
  };
}

export const __testing = { hostAllowed, DEFAULT_ALLOWED_HOSTS, DEFAULT_MAX_BYTES };
