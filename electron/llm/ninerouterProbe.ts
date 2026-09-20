/**
 * Connection test for a 9Router instance.
 *
 * Its own module, rather than a closure in ipcHandlers, because the thing it
 * has to get right is not obvious from the call site and is worth testing
 * directly: 9Router's auth is split by HTTP VERB.
 *
 * Verified live against a running instance on 2026-09-20:
 *
 *   GET  /api/health              -> 200 {"ok":true}            no key
 *   GET  /v1/models               -> 200, 47 models             no key
 *   GET  /v1/models/embedding     -> 200                        no key
 *   POST /v1/messages/count_tokens-> 200                        no key
 *   POST /v1/chat/completions     -> 401 "Missing API key"      key REQUIRED
 *   POST /v1/embeddings           -> 401 "Missing API key"      key REQUIRED
 *
 * Every other gateway in this app tests its connection with `GET /v1/models`.
 * Doing that here would report SUCCESS for a configuration that cannot answer a
 * single question, because the read routes answer openly while the routes that
 * do work do not. That is the failure shape from
 * elevenlabs-probe-false-green-2026-09-09: a probe that fires on connect rather
 * than on work green-lights credentials that are already dead.
 *
 * So the probe POSTs — and POSTs a deliberately invalid model id, because auth
 * is evaluated BEFORE model validation. That ordering is proven rather than
 * assumed: a POST carrying no `model` field at all still returns 401, so the
 * credential check cannot be downstream of the model check. The result:
 *
 *   401                -> the key is missing or wrong
 *   anything else      -> the request got past auth, so the credential works
 *
 * and no upstream provider is ever called, because no real model is named.
 */

/**
 * Deliberately not a routable id. 9Router catalogue ids are `alias/model`
 * (`openai/gpt-5`, `cc/claude-opus-5`); this has no slash, so it cannot
 * resolve to an upstream even if the validation order ever changed.
 */
export const NINEROUTER_PROBE_MODEL = '__natively_connection_probe__';

export type NinerouterProbeReason = 'auth' | 'unreachable' | 'unconfigured';

export interface NinerouterProbeResult {
  ok: boolean;
  reason?: NinerouterProbeReason;
  error?: string;
  /** The HTTP status, when one was received. Absent for transport failures. */
  status?: number;
}

export interface NinerouterProbeOptions {
  timeoutMs?: number;
  /** Injected in tests; production passes nothing and uses global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Normalise whatever the user pasted into the chat-completions URL.
 *
 * 9Router's dashboard hands out `http://localhost:20128/v1`, but users paste
 * the root just as often, and a tunnel URL may carry a trailing slash. All of
 * them must end up with exactly one `/v1`.
 */
function chatCompletionsUrl(baseURL: string): string {
  const root = baseURL.trim().replace(/\/+$/, '');
  return /\/v1$/.test(root) ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
}

export async function probeNinerouter(
  baseURL: string,
  apiKey: string,
  options: NinerouterProbeOptions = {},
): Promise<NinerouterProbeResult> {
  const trimmedURL = (baseURL || '').trim();
  if (!trimmedURL) {
    return { ok: false, reason: 'unconfigured', error: 'Enter your 9Router base URL first (for example http://localhost:20128/v1).' };
  }

  const doFetch = options.fetchImpl || fetch;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Sent only when present: a stock instance runs with REQUIRE_API_KEY=false,
  // and an empty Bearer header is worse than none on the instances that care.
  if ((apiKey || '').trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`;

  let resp: Response;
  try {
    resp = await doFetch(chatCompletionsUrl(trimmedURL), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: NINEROUTER_PROBE_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        // Belt and braces: if a future 9Router ever resolved the probe id to
        // something real, this still cannot produce a billable generation.
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });
  } catch (e: any) {
    // Transport failure — the instance is not running, the tunnel is down, or
    // the URL is wrong. Explicitly NOT an auth problem, because telling a user
    // to check their key when their server is stopped sends them to the wrong
    // screen entirely.
    const detail = e?.name === 'TimeoutError' || e?.name === 'AbortError'
      ? 'timed out'
      : (e?.cause?.code || e?.message || 'connection failed');
    return {
      ok: false,
      reason: 'unreachable',
      error: `Could not reach 9Router at ${trimmedURL} (${detail}). Check that it is running — \`9router\` starts it on port 20128 by default.`,
    };
  }

  if (resp.status === 401 || resp.status === 403) {
    // The one case the GET-based probe could never see.
    let message = '';
    try {
      const body: any = await resp.json();
      message = body?.error?.message || '';
    } catch { /* body may not be JSON */ }
    return {
      ok: false,
      reason: 'auth',
      status: resp.status,
      error: message
        ? `9Router rejected the API key (${message}). Copy it from the dashboard at ${trimmedURL.replace(/\/v1\/?$/, '')}/dashboard → Keys.`
        : `9Router rejected the API key. Copy it from the dashboard → Keys.`,
    };
  }

  // Anything else means the request got PAST authentication, which is the only
  // thing this probe set out to establish. A 400 (invalid model format) is the
  // expected success signal; a 404 or even a 200 from some future build is
  // equally proof that the credential was accepted, so none of them is treated
  // as a failure.
  return { ok: true, status: resp.status };
}
