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

export async function readCodexModelCatalog(opts: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  pathImpl?: PathImpl;
  readFile?: (filePath: string) => Promise<string>;
} = {}): Promise<CodexModelCatalog> {
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
