/**
 * Connection test for the OpenCode card.
 *
 * A GET-only probe is a FALSE GREEN here, for the same reason 9Router's is:
 * `GET /inference/v1/models` answers 200 **without a key** (verified live on
 * 2026-11-19), so a test built on it passes for an empty or invalid
 * credential. The probe therefore stages two calls:
 *
 *   1. GET the model list with the key. A 401/403 is a dead key. A 200 proves
 *      nothing about the *key* — only that the catalogue is reachable.
 *   2. POST an intentionally unroutable model id to Chat Completions. Auth is
 *      evaluated before model validation, so a 401/403 means the key is wrong
 *      and anything that reached model validation means it is accepted. No
 *      real model is named, so nothing billable runs.
 *
 * That mirrors `ninerouterProbe.ts`, whose live measurements established the
 * auth-before-validation ordering for its own server. For OpenCode the same
 * ordering is assumed: a real key was observed to pass this probe on
 * 2026-11-19, while the wrong-key branches are covered by unit tests only.
 */

import {
  OPENCODE_MODELS_URL,
  OPENCODE_PROBE_MODEL,
  OPENCODE_OPENAI_BASE,
} from './constants';
import { redactOpencodeSecrets } from './errors';

export type OpencodeProbeReason = 'auth' | 'billing' | 'unreachable' | 'unconfigured';

export interface OpencodeProbeResult {
  ok: boolean;
  reason?: OpencodeProbeReason;
  error?: string;
  /** The HTTP status, when one was received. Absent for transport failures. */
  status?: number;
}

export interface OpencodeProbeOptions {
  timeoutMs?: number;
  /** Injected in tests; production passes nothing and uses global fetch. */
  fetchImpl?: typeof fetch;
}

/** The provider's own message, redacted: it is relayed into the Settings card. */
async function readMessage(resp: Response): Promise<string> {
  try {
    const body: any = await resp.json();
    return redactOpencodeSecrets(String(body?.error?.message || body?.message || body?.error || ''));
  } catch {
    return '';
  }
}

export async function probeOpencode(
  apiKey: string,
  options: OpencodeProbeOptions = {},
): Promise<OpencodeProbeResult> {
  const key = (apiKey || '').trim();
  if (!key) {
    return {
      ok: false,
      reason: 'unconfigured',
      error: 'Paste your OpenCode API key first — create one in the Console → API keys.',
    };
  }

  const doFetch = options.fetchImpl || fetch;
  const timeout = options.timeoutMs ?? 8000;
  const headers = { Authorization: `Bearer ${key}` } as Record<string, string>;

  // ── 1. Catalogue read ────────────────────────────────────────────────────
  let catalogue: Response;
  try {
    catalogue = await doFetch(OPENCODE_MODELS_URL, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e: any) {
    const detail = e?.name === 'TimeoutError' || e?.name === 'AbortError'
      ? 'timed out'
      : (e?.cause?.code || e?.message || 'connection failed');
    return {
      ok: false,
      reason: 'unreachable',
      error: `Could not reach OpenCode (${detail}). Check your connection, then try again.`,
    };
  }

  if (catalogue.status === 401) {
    const message = await readMessage(catalogue);
    return {
      ok: false,
      reason: 'auth',
      status: 401,
      error: message
        ? `OpenCode rejected the API key (${message}).`
        : 'OpenCode rejected the API key. Create a new one in the Console → API keys.',
    };
  }
  if (catalogue.status === 403) {
    const message = await readMessage(catalogue);
    // 403 on a *read* is not the free-tier rule; it is a permission problem
    // (a service-account key without Models › Read is the documented cause).
    return {
      ok: false,
      reason: 'auth',
      status: 403,
      error: message
        ? `OpenCode refused the model list (${message}). A service-account key needs Models › Read.`
        : 'OpenCode refused the model list. A service-account key needs Models › Read.',
    };
  }
  if (catalogue.status >= 500) {
    return {
      ok: false,
      reason: 'unreachable',
      status: catalogue.status,
      error: `OpenCode returned ${catalogue.status} for the model list. Try again in a moment.`,
    };
  }

  // ── 2. Auth probe against the work route ─────────────────────────────────
  let resp: Response;
  try {
    resp = await doFetch(`${OPENCODE_OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENCODE_PROBE_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        // Belt and braces: if a future server resolved the probe id to
        // something real, this still cannot produce a billable generation.
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e: any) {
    const detail = e?.name === 'TimeoutError' || e?.name === 'AbortError'
      ? 'timed out'
      : (e?.cause?.code || e?.message || 'connection failed');
    return {
      ok: false,
      reason: 'unreachable',
      error: `Could not reach the OpenCode chat endpoint (${detail}). Check your connection, then try again.`,
    };
  }

  if (resp.status === 401 || resp.status === 403) {
    const message = await readMessage(resp);
    return {
      ok: false,
      reason: resp.status === 403 ? 'billing' : 'auth',
      status: resp.status,
      error: message
        ? `OpenCode rejected the request (${message}).`
        : resp.status === 403
          ? 'OpenCode refused the request (403). Check the balance or Go usage in the Console.'
          : 'OpenCode rejected the API key. Create a new one in the Console → API keys.',
    };
  }
  if (resp.status >= 500) {
    return {
      ok: false,
      reason: 'unreachable',
      status: resp.status,
      error: `OpenCode returned ${resp.status}. It is reachable but not healthy — try again in a moment.`,
    };
  }

  // 400/404/422 are the expected answers for an unroutable id: the request got
  // past authentication and reached model validation, which is exactly what
  // this probe needs to prove. A 200 would mean the id resolved, which is not
  // an error either (some gateways accept anything).
  return { ok: true, status: resp.status };
}
