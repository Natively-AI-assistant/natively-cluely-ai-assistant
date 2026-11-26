// Client for the Natively API's repo brief endpoints (#781).
//
//   POST /v1/repo-brief  {url, github_login?}  → job
//   GET  /v1/repo-brief?id=<job id | cache key> → job
//
// A job is {id, status: queued|running|ready|failed, stage, repo, error?, result?}.
// The server reads the repository from GitHub and writes the brief; the app
// never clones anything. Injectable fetch so tests run without a network.

export interface RepoBriefIndexSymbol {
  name: string;
  qualified?: string;
  kind: string;
  path: string;
  start: number;
  end: number;
  score?: number;
}

export interface RepoBriefRoute {
  method?: string;
  path?: string;
  handlers?: string[];
  file?: string;
  line?: number;
  [k: string]: unknown;
}

export interface RepoBriefResult {
  repo: { owner: string; name: string; sha: string; url?: string; description?: string | null; fork?: boolean };
  tier: 'small' | 'medium' | 'huge';
  coverage: Record<string, number>;
  brief: string;
  index: {
    files: Array<{ path: string; lines: number; language?: string }>;
    symbols: RepoBriefIndexSymbol[];
    routes: RepoBriefRoute[];
  };
  citations?: number;
  rawBaseUrl: string;
  generatedAt: string;
  model?: string;
}

export interface RepoBriefJob {
  id: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  stage?: string | null;
  repo?: string;
  error?: { code: string; message: string };
  result?: RepoBriefResult;
}

/** A refusal or failure the user can act on, with the server's code. */
export class RepoBriefApiError extends Error {
  readonly isRepoBriefApiError = true;
  /** @param retryAfterMs when the server says when to come back (GitHub's hourly allowance). */
  constructor(readonly code: string, message: string, readonly status: number = 0, readonly retryAfterMs: number | null = null) {
    super(message);
  }
  /** Worth trying again later without the user changing anything. */
  get transient(): boolean {
    return isTransient(this);
  }
}

/**
 * By shape, not instanceof: the build bundles every file on its own, so a class
 * from one bundle is not the class another bundle checks against.
 */
export function asRepoBriefApiError(e: unknown): RepoBriefApiError | null {
  const x = e as any;
  return x && x.isRepoBriefApiError === true && typeof x.code === 'string' ? x as RepoBriefApiError : null;
}

export function isTransient(e: { code: string; status: number }): boolean {
  return e.status === 0 || e.status >= 500 || e.code === 'busy' || e.code === 'github_rate_limited';
}

export interface RepoBriefClientOptions {
  baseUrl: string;
  getKey: () => string | undefined | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createRepoBriefClient({ baseUrl, getKey, fetchImpl = globalThis.fetch, timeoutMs = 20_000 }: RepoBriefClientOptions) {
  const base = baseUrl.replace(/\/+$/, '');

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<RepoBriefJob> {
    const key = getKey();
    if (!key) throw new RepoBriefApiError('no_key', 'Add a Natively key to build repository briefs');
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { 'x-natively-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: any) {
      throw new RepoBriefApiError('unreachable', `Could not reach Natively (${e?.name || 'error'})`);
    }
    let data: any = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok) {
      // 404 with no code is the endpoint itself missing (switched off on the server).
      const code = typeof data?.error === 'string' ? data.error : res.status === 404 ? 'unavailable' : `http_${res.status}`;
      const message = typeof data?.message === 'string' ? data.message : messageForCode(code);
      const retryAfterSec = Number(data?.retry_after);
      throw new RepoBriefApiError(code, message, res.status, Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : null);
    }
    if (!data || typeof data.id !== 'string' || typeof data.status !== 'string') {
      throw new RepoBriefApiError('bad_response', 'Natively sent an unexpected reply', res.status);
    }
    return data as RepoBriefJob;
  }

  return {
    request(url: string, githubLogin?: string | null): Promise<RepoBriefJob> {
      return call('POST', '/v1/repo-brief', { url, ...(githubLogin ? { github_login: githubLogin } : {}) });
    },
    status(id: string): Promise<RepoBriefJob> {
      return call('GET', `/v1/repo-brief?id=${encodeURIComponent(id)}`);
    },
  };
}

export type RepoBriefClient = ReturnType<typeof createRepoBriefClient>;

export function messageForCode(code: string): string {
  switch (code) {
    case 'no_key': return 'Add a Natively key to build repository briefs';
    case 'paid_key_required': return 'Repository briefs need a paid Natively key';
    case 'unavailable':
    case 'not_found': return 'Repository briefs are not available yet';
    case 'repo_not_found': return 'Repository not found. Is it public?';
    case 'repo_private': return 'This repository is private. Only public repositories can be read';
    case 'repo_empty': return 'This repository is empty';
    case 'no_source': return 'No source files were found in this repository';
    case 'daily_limit': return 'Daily limit reached. Try again tomorrow';
    case 'busy': return 'Natively is busy';
    case 'github_rate_limited': return 'GitHub is limiting requests';
    case 'build_timeout': return 'The repository took too long to read';
    case 'invalid_repo_url': return 'Expected a link like github.com/owner/repo';
    case 'unauthorized':
    case 'invalid_key': return 'Your Natively key was not accepted';
    default: return 'Could not build the brief';
  }
}
