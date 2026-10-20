// "Fetch models" for OpenAI-compatible endpoints (Settings › AI Providers).
// Runs in the main process only — the renderer never sees the API key — but
// imports nothing from electron so it is testable as plain compiled JS.
// Never logs and never returns error objects: a transport error's message can
// contain the key or host details (fetch errors echo the URL, some proxies
// echo headers), so raw causes are dropped and callers get a coarse code.
//
// Key choice: the freshly typed key wins; the stored key is used only when
// the request targets the same origin it was saved for, so editing the Base
// URL can never leak the stored key to a different host.

/** http(s) URL check shared by `openai-compat:save` and `fetchCompatModels`. */
export function isValidCompatBaseURL(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export type FetchCompatModelsError =
  | 'invalid'
  | 'unauthorized'
  | 'not_found'
  | 'timeout'
  | 'network'
  | 'http'
  | 'bad_response';

export type FetchCompatModelsResult =
  | { success: true; models: string[] }
  | { success: false; error: FetchCompatModelsError; status?: number };

export interface FetchCompatModelsRequest {
  /** Base URL as typed in the editor (may have a trailing slash). */
  baseURL: string;
  /** Freshly typed key, when the user entered one. */
  apiKey?: string;
  /** Saved endpoint config; its key is used only for the same origin. */
  stored?: { baseURL: string; apiKey?: string };
}

/**
 * GET `{baseURL}/models` and return the sorted, deduped model ids.
 * Never throws — every failure becomes a `FetchCompatModelsError` code.
 * An empty id list is still `success: true`.
 */
export async function fetchCompatModels(
  req: FetchCompatModelsRequest,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<FetchCompatModelsResult> {
  if (!isValidCompatBaseURL(req.baseURL)) return { success: false, error: 'invalid' };

  let key = req.apiKey?.trim();
  if (!key && req.stored?.apiKey) {
    try {
      // Origin guard: an edited Base URL never receives the stored key.
      if (new URL(req.stored.baseURL).origin === new URL(req.baseURL).origin) key = req.stored.apiKey;
    } catch {
      // Stored baseURL unparseable — send no key.
    }
  }

  const url = `${req.baseURL.trim().replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  let resp: Response;
  try {
    resp = await (opts.fetchImpl ?? fetch)(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch (e: unknown) {
    // Raw cause dropped — it may contain the key (see header comment).
    const name = e instanceof Error ? e.name : '';
    return { success: false, error: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
  }

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) return { success: false, error: 'unauthorized', status: resp.status };
    if (resp.status === 404) return { success: false, error: 'not_found', status: resp.status };
    return { success: false, error: 'http', status: resp.status };
  }

  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    return { success: false, error: 'bad_response' };
  }
  const rows = (data as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return { success: false, error: 'bad_response' };

  const ids = rows
    .map((m: unknown) => (m as { id?: unknown } | null)?.id)
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  return { success: true, models: [...new Set(ids)].sort((a, b) => a.localeCompare(b)) };
}
