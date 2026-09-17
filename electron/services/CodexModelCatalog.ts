/**
 * CodexModelCatalog — the model list of the user's installed Codex CLI.
 *
 * The Codex CLI keeps the catalogue it fetched from the ChatGPT Codex backend
 * (the same backend CodexCliService calls) in `$CODEX_HOME/models_cache.json`,
 * refreshing it on its own schedule. Reading that file lets the model picker
 * offer exactly what the user's Codex installation offers, instead of a
 * hardcoded list that drifts as OpenAI adds and retires models (issue #558).
 *
 * This reads the MODEL LIST only. The CLI's login in the same directory
 * (`auth.json`) is CodexCliAuth's business — read-only, never refreshed.
 *
 * The catalogue is NOT proof a model works with a ChatGPT sign-in: live on
 * 2026-09-11 it listed gpt-5.4-mini, which the backend rejects for a ChatGPT
 * account. Models the backend has rejected that way are filtered out here.
 *
 * No catalogue (CLI never installed or never run, unreadable or corrupt file)
 * is the common case, not an error: callers fall back to the built-in presets.
 *
 * CODEX_HOME resolution matches the CLI's: `$CODEX_HOME` when set, otherwise
 * `<home>/.codex` — `~/.codex` on macOS, `%USERPROFILE%\.codex` on Windows.
 * A packaged macOS app launched from Finder/Dock does not inherit a CODEX_HOME
 * exported in a shell profile, so such a user gets the presets.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

export const CODEX_MODELS_CACHE_FILE = 'models_cache.json';

/**
 * Live Codex model catalogue. Same backend the Codex CLI itself queries —
 * the provider is authoritative, so the picker never drifts as OpenAI adds
 * (gpt-6-astra, gpt-5.6-sol) or retires models.
 */
export const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models';

/**
 * Models the ChatGPT Codex backend rejects for a ChatGPT account — the only
 * auth Natively has — each with the backend's own answer, "The '<id>' model is
 * not supported when using Codex with a ChatGPT account." spark from a captured
 * CLI error (CodexCliService.test.mjs); the other three from live requests on
 * 2026-09-11 (issue #558). gpt-5.4 / gpt-5.3-codex were the shipped defaults and
 * sit in real settings files, so they are remapped on load, not just hidden.
 */
export const CHATGPT_UNSUPPORTED_CODEX_MODELS: ReadonlySet<string> = new Set([
  'gpt-5.3-codex-spark',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.4-mini',
]);

export function isChatGptUnsupportedCodexModel(modelId: string): boolean {
  return CHATGPT_UNSUPPORTED_CODEX_MODELS.has((modelId || '').trim().toLowerCase());
}

export interface CodexCatalogModel {
  id: string;
  name: string;
}

export interface CodexModelCatalog {
  /** 'codex-cli' = read from the installed CLI; 'unavailable' = use presets. */
  source: 'codex-cli' | 'unavailable';
  models: CodexCatalogModel[];
  /** When the CLI last fetched the catalogue (ISO string, from the file). */
  fetchedAt?: string;
  /** The CLI version that wrote the file. */
  clientVersion?: string;
}

type PathImpl = Pick<typeof path, 'join' | 'resolve'>;

export function resolveCodexHome(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  pathImpl: PathImpl = path,
): string {
  const override = env.CODEX_HOME?.trim();
  if (override) return pathImpl.resolve(override);
  return pathImpl.join(homeDir, '.codex');
}

/**
 * Parse the CLI's models_cache.json. Keeps the models the CLI itself shows in
 * its picker (`visibility: 'list'`), ordered by the CLI's `priority`. Returns
 * null when nothing usable is in the file.
 */
export function parseCodexModelsCache(raw: string): Omit<CodexModelCatalog, 'source'> | null {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.models)) return null;

  const listed = data.models
    .filter((m: any) => m && typeof m.slug === 'string' && m.slug.trim() && m.visibility === 'list'
      && !isChatGptUnsupportedCodexModel(m.slug))
    .map((m: any, index: number) => ({
      id: m.slug.trim() as string,
      name: (typeof m.display_name === 'string' && m.display_name.trim()) || (m.slug.trim() as string),
      priority: Number.isFinite(m.priority) ? (m.priority as number) : Number.MAX_SAFE_INTEGER,
      index,
    }))
    .sort((a: any, b: any) => a.priority - b.priority || a.index - b.index);
  if (listed.length === 0) return null;

  const seen = new Set<string>();
  const models: CodexCatalogModel[] = [];
  for (const m of listed) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    models.push({ id: m.id, name: m.name });
  }
  return {
    models,
    fetchedAt: typeof data.fetched_at === 'string' ? data.fetched_at : undefined,
    clientVersion: typeof data.client_version === 'string' ? data.client_version : undefined,
  };
}

/**
 * Parse a live `/backend-api/codex/models` response. Accepts both the CLI
 * cache shape (`{ models: [{ slug, display_name, visibility, priority }] }`)
 * and the API shape (`{ models: [{ id, name }] }` / `{ data: [...] }`).
 * `visibility` is honoured when present; when absent every entry with an id
 * is kept. Unsupported-for-ChatGPT ids are always dropped.
 */
export function parseCodexModelsResponse(data: any): Omit<CodexModelCatalog, 'source'> | null {
  if (!data || typeof data !== 'object') return null;
  const rawModels = Array.isArray(data.models) ? data.models : Array.isArray(data.data) ? data.data : null;
  if (!rawModels) return null;

  const listed = rawModels
    .filter((m: any) => {
      if (!m || typeof m !== 'object') return false;
      const slug = typeof m.slug === 'string' ? m.slug.trim() : typeof m.id === 'string' ? m.id.trim() : '';
      if (!slug) return false;
      if (typeof m.visibility === 'string' && m.visibility !== 'list') return false;
      return !isChatGptUnsupportedCodexModel(slug);
    })
    .map((m: any, index: number) => {
      const id = (typeof m.slug === 'string' ? m.slug.trim() : (m.id as string).trim()) as string;
      const name =
        (typeof m.display_name === 'string' && m.display_name.trim()) ||
        (typeof m.name === 'string' && m.name.trim()) ||
        id;
      return {
        id,
        name,
        priority: Number.isFinite(m.priority) ? (m.priority as number) : Number.MAX_SAFE_INTEGER,
        index,
      };
    })
    .sort((a: any, b: any) => a.priority - b.priority || a.index - b.index);
  if (listed.length === 0) return null;

  const seen = new Set<string>();
  const models: CodexCatalogModel[] = [];
  for (const m of listed) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    models.push({ id: m.id, name: m.name });
  }
  return {
    models,
    fetchedAt: typeof data.fetched_at === 'string' ? data.fetched_at : new Date().toISOString(),
    clientVersion: typeof data.client_version === 'string' ? data.client_version : undefined,
  };
}

/**
 * Fetch the live catalogue from the ChatGPT Codex backend using whichever
 * sign-in exists (Natively's own OAuth first, else the CLI's `codex login`
 * session read from disk). Lazy requires avoid a module cycle
 * (CodexCliAuth imports resolveCodexHome from here). Any failure — signed
 * out, offline, non-200, unexpected shape — returns null so callers fall
 * through to the CLI cache file, then presets.
 */
export async function fetchLiveCodexModels(opts: {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<Omit<CodexModelCatalog, 'source'> | null> {
  let accessToken = '';
  let accountId: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CodexOAuthService } = require('./CodexOAuthService') as typeof import('./CodexOAuthService');
    const oauth = CodexOAuthService.getInstance();
    if (oauth.getStatus().signedIn) {
      const token = await oauth.getAccessToken();
      if (token) {
        accessToken = token;
        accountId = oauth.getCachedTokens?.()?.accountId;
      }
    }
  } catch {
    // Test harness without an initialised OAuth store — fall through to CLI.
  }
  if (!accessToken) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readCodexCliAuth } = require('./CodexCliAuth') as typeof import('./CodexCliAuth');
      const cli = readCodexCliAuth();
      if (cli.status === 'ok') {
        accessToken = cli.accessToken;
        accountId = cli.accountId;
      }
    } catch {
      // No CLI session either.
    }
  }
  if (!accessToken) return null;

  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      originator: 'codex_cli_rs',
    };
    if (accountId) headers['chatgpt-account-id'] = accountId;
    const resp = await fetchFn(CODEX_MODELS_URL, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    return parseCodexModelsResponse(await resp.json().catch(() => null));
  } catch {
    return null;
  }
}

export async function readCodexModelCatalog(opts: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  pathImpl?: PathImpl;
  readFile?: (filePath: string) => Promise<string>;
  /** Skip the live fetch (tests, offline). Default: try live first. */
  skipLive?: boolean;
  fetchFn?: typeof fetch;
} = {}): Promise<CodexModelCatalog> {
  // 1. Live provider catalogue — authoritative, works with or without the CLI.
  if (!opts.skipLive) {
    try {
      const live = await fetchLiveCodexModels({ fetchFn: opts.fetchFn });
      if (live) return { source: 'codex-cli', ...live };
    } catch {
      // Fall through to the CLI cache file.
    }
  }
  // 2. Installed CLI's cache file (offline-friendly, same backend data).
  const pathImpl = opts.pathImpl ?? path;
  const codexHome = resolveCodexHome(opts.env ?? process.env, opts.homeDir ?? os.homedir(), pathImpl);
  const readFile = opts.readFile ?? ((p: string) => fs.promises.readFile(p, 'utf8'));
  try {
    const parsed = parseCodexModelsCache(await readFile(pathImpl.join(codexHome, CODEX_MODELS_CACHE_FILE)));
    if (parsed) return { source: 'codex-cli', ...parsed };
  } catch {
    // ENOENT (no CLI) is the normal case; EACCES/EISDIR etc. mean the same
    // thing to the picker — fall back to presets.
  }
  return { source: 'unavailable', models: [] };
}
