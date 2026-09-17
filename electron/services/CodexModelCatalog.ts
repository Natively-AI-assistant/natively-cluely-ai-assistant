/**
 * Account-scoped Codex model discovery.
 *
 * The settings page reads cached provider data immediately, then explicitly
 * refreshes it after ChatGPT authentication is available. Other surfaces only
 * read the cache; opening Natively never triggers a model-catalogue request.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CodexOAuthService } from './CodexOAuthService';
import { CODEX_AUTH_FILE, readCodexCliAuth } from './CodexCliAuth';
import { CODEX_MODELS_CACHE_FILE, resolveCodexHome } from './CodexPaths';

export { CODEX_MODELS_CACHE_FILE, resolveCodexHome } from './CodexPaths';

export const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models';
// Protocol capability version, not the Natively app version. Bump only when
// Natively implements the corresponding Codex catalogue/request semantics.
export const CODEX_PROTOCOL_VERSION = '0.154.0';
export const NATIVELY_CODEX_MODELS_CACHE_FILE = 'codex-model-catalog.json';

export type CodexCatalogSource = 'provider-live' | 'provider-cache' | 'codex-cli-cache' | 'unavailable';
export type CodexCatalogError = 'not-signed-in' | 'network' | 'auth' | 'rate-limited' | 'provider' | 'invalid-response';

export interface CodexCatalogOption {
  id: string;
  name: string;
  description?: string;
}

export interface CodexCatalogModel {
  id: string;
  name: string;
  reasoningLevels: CodexCatalogOption[];
  defaultReasoningLevel?: string;
  serviceTiers: CodexCatalogOption[];
}

export interface CodexModelCatalog {
  source: CodexCatalogSource;
  models: CodexCatalogModel[];
  fetchedAt?: string;
  clientVersion?: string;
  refreshError?: CodexCatalogError;
}

export interface CodexCatalogCredential {
  source: 'natively' | 'codex-cli';
  accessToken: string;
  accountId?: string;
  email?: string;
}

type PathImpl = Pick<typeof path, 'join' | 'resolve'>;
type ParsedCatalog = Omit<CodexModelCatalog, 'source' | 'refreshError'>;

const SAFE_PROVIDER_VALUE = /^[a-z][a-z0-9_-]{0,63}$/i;
const CAPABILITIES_KEY = Symbol.for('natively.codexModelCapabilities');
type CapabilityMap = Map<string, Pick<CodexCatalogModel, 'reasoningLevels' | 'serviceTiers' | 'defaultReasoningLevel'>>;
interface CapabilityState { accountKey: string | null; models: CapabilityMap; generation: number }

function capabilityState(): CapabilityState {
  const root = globalThis as typeof globalThis & { [CAPABILITIES_KEY]?: CapabilityState };
  return root[CAPABILITIES_KEY] ??= { accountKey: null, models: new Map(), generation: 0 };
}

function cleanProviderOption(value: any): CodexCatalogOption | null {
  const id = typeof value === 'string'
    ? value.trim()
    : typeof value?.id === 'string'
      ? value.id.trim()
      : typeof value?.effort === 'string'
        ? value.effort.trim()
        : '';
  if (!SAFE_PROVIDER_VALUE.test(id)) return null;
  const name = (typeof value?.name === 'string' && value.name.trim()) || id;
  const description = typeof value?.description === 'string' && value.description.trim()
    ? value.description.trim()
    : undefined;
  return { id, name, ...(description ? { description } : {}) };
}

function normalizeOptions(values: unknown): CodexCatalogOption[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: CodexCatalogOption[] = [];
  for (const value of values) {
    const option = cleanProviderOption(value);
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    result.push(option);
  }
  return result;
}

function rememberCapabilities(models: CodexCatalogModel[], key: string | null, expectedGeneration?: number): boolean {
  const state = capabilityState();
  if (expectedGeneration !== undefined && state.generation !== expectedGeneration) return false;
  state.accountKey = key;
  state.models.clear();
  for (const model of models) {
    state.models.set(model.id, {
      reasoningLevels: model.reasoningLevels,
      serviceTiers: model.serviceTiers,
      defaultReasoningLevel: model.defaultReasoningLevel,
    });
  }
  state.generation++;
  return true;
}

export function activateCodexModelCatalog(models: CodexCatalogModel[]): void {
  rememberCapabilities(models, resolveCodexCatalogIdentity()?.key ?? null);
}

export function getCodexModelCapabilities(modelId: string): Pick<CodexCatalogModel, 'reasoningLevels' | 'serviceTiers' | 'defaultReasoningLevel'> | null {
  const state = capabilityState();
  const activeKey = resolveCodexCatalogIdentity()?.key ?? null;
  if (state.accountKey !== activeKey) return null;
  return state.models.get((modelId || '').trim()) ?? null;
}

/** Parse the schema written by the Codex CLI and returned by the provider. */
export function parseCodexModelsPayload(data: any): ParsedCatalog | null {
  if (!data || !Array.isArray(data.models)) return null;

  const listed = data.models
    .filter((model: any) => model && typeof model.slug === 'string' && model.slug.trim() && model.visibility === 'list')
    .map((model: any, index: number) => {
      const id = model.slug.trim() as string;
      const defaultReasoningLevel = typeof model.default_reasoning_level === 'string'
        && SAFE_PROVIDER_VALUE.test(model.default_reasoning_level.trim())
        ? model.default_reasoning_level.trim()
        : undefined;
      return {
        id,
        name: (typeof model.display_name === 'string' && model.display_name.trim()) || id,
        reasoningLevels: normalizeOptions(model.supported_reasoning_levels),
        ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}),
        serviceTiers: normalizeOptions(model.service_tiers),
        priority: Number.isFinite(model.priority) ? Number(model.priority) : Number.MAX_SAFE_INTEGER,
        index,
      };
    })
    .sort((a: any, b: any) => a.priority - b.priority || a.index - b.index);
  if (listed.length === 0) return null;

  const seen = new Set<string>();
  const models: CodexCatalogModel[] = [];
  for (const { priority: _priority, index: _index, ...model } of listed) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return {
    models,
    fetchedAt: typeof data.fetched_at === 'string' ? data.fetched_at : undefined,
    clientVersion: typeof data.client_version === 'string' ? data.client_version : undefined,
  };
}

export function parseCodexModelsCache(raw: string): ParsedCatalog | null {
  try {
    return parseCodexModelsPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

function jwtSubject(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'));
    return typeof payload?.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

function accountKey(credential: Pick<CodexCatalogCredential, 'source' | 'accessToken' | 'accountId' | 'email'>): string | null {
  const subject = jwtSubject(credential.accessToken);
  const identity = [credential.accountId, subject, credential.email].filter(Boolean).join(':');
  return identity ? crypto.createHash('sha256').update(identity).digest('hex') : null;
}

export async function resolveCodexCatalogCredential(): Promise<CodexCatalogCredential | null> {
  const oauth = CodexOAuthService.getInstance();
  if (oauth.getStatus().signedIn) {
    const token = await oauth.getAccessToken();
    const cached = oauth.getCachedTokens();
    if (token) {
      return { source: 'natively', accessToken: token, accountId: cached?.accountId, email: cached?.email };
    }
  }
  const cli = readCodexCliAuth();
  return cli.status === 'ok'
    ? { source: 'codex-cli', accessToken: cli.accessToken, accountId: cli.accountId, email: cli.email }
    : null;
}

function resolveCodexCatalogIdentity(): { source: 'natively' | 'codex-cli'; key: string | null } | null {
  const oauth = CodexOAuthService.getInstance();
  if (oauth.getStatus().signedIn) {
    const cached = oauth.getCachedTokens();
    if (!cached?.accessToken) return { source: 'natively', key: null };
    return { source: 'natively', key: accountKey({ source: 'natively', ...cached }) };
  }
  const cli = readCodexCliAuth();
  if (cli.status !== 'ok') return null;
  return { source: 'codex-cli', key: accountKey({ source: 'codex-cli', ...cli }) };
}

interface PersistedCatalog {
  schemaVersion: 1;
  accountKey: string;
  catalog: ParsedCatalog;
}

function parsePersistedCatalog(raw: string, expectedAccountKey: string): ParsedCatalog | null {
  try {
    const data = JSON.parse(raw) as PersistedCatalog;
    if (data?.schemaVersion !== 1 || data.accountKey !== expectedAccountKey || !Array.isArray(data.catalog?.models)) return null;
    const models = data.catalog.models
      .filter(model => !!model && typeof model.id === 'string' && model.id.trim() && typeof model.name === 'string')
      .map(model => {
        const defaultReasoningLevel = typeof model.defaultReasoningLevel === 'string'
          && SAFE_PROVIDER_VALUE.test(model.defaultReasoningLevel)
          ? model.defaultReasoningLevel
          : undefined;
        return {
          id: model.id.trim(),
          name: model.name.trim() || model.id.trim(),
          reasoningLevels: normalizeOptions(model.reasoningLevels),
          ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}),
          serviceTiers: normalizeOptions(model.serviceTiers),
        };
      });
    if (models.length === 0) return null;
    return { ...data.catalog, models };
  } catch {
    return null;
  }
}

export async function readCachedCodexModelCatalog(opts: {
  appCacheFile?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  pathImpl?: PathImpl;
  readFile?: (filePath: string) => Promise<string>;
  statFile?: (filePath: string) => Promise<{ mtimeMs: number }>;
  identity?: { source: 'natively' | 'codex-cli'; key: string | null } | null;
} = {}): Promise<CodexModelCatalog> {
  const identity = opts.identity === undefined ? resolveCodexCatalogIdentity() : opts.identity;
  const capabilityGeneration = capabilityState().generation;
  if (!identity) {
    rememberCapabilities([], null, capabilityGeneration);
    return { source: 'unavailable', models: [], refreshError: 'not-signed-in' };
  }
  const readFile = opts.readFile ?? ((file: string) => fs.promises.readFile(file, 'utf8'));

  if (opts.appCacheFile && identity.key) {
    try {
      const parsed = parsePersistedCatalog(await readFile(opts.appCacheFile), identity.key);
      if (parsed) {
        rememberCapabilities(parsed.models, identity.key, capabilityGeneration);
        return { source: 'provider-cache', ...parsed };
      }
    } catch {
      // Try the CLI cache when the active identity came from the CLI.
    }
  }

  const cli = readCodexCliAuth();
  const sameCliAccount = identity.source === 'codex-cli'
    || (cli.status === 'ok' && !!identity.key && identity.key === accountKey({ source: 'codex-cli', ...cli }));
  if (sameCliAccount) {
    const pathImpl = opts.pathImpl ?? path;
    const codexHome = resolveCodexHome(opts.env ?? process.env, opts.homeDir ?? os.homedir(), pathImpl);
    const cacheFile = pathImpl.join(codexHome, CODEX_MODELS_CACHE_FILE);
    const authFile = pathImpl.join(codexHome, CODEX_AUTH_FILE);
    try {
      const statFile = opts.statFile ?? ((file: string) => fs.promises.stat(file));
      const [cacheStat, authStat] = await Promise.all([statFile(cacheFile), statFile(authFile)]);
      // A login newer than the model file can belong to another account. Wait
      // for the CLI to refresh its catalogue before trusting it.
      if (cacheStat.mtimeMs < authStat.mtimeMs) return { source: 'unavailable', models: [] };
      const parsed = parseCodexModelsCache(await readFile(cacheFile));
      if (parsed) {
        rememberCapabilities(parsed.models, identity.key, capabilityGeneration);
        return { source: 'codex-cli-cache', ...parsed };
      }
    } catch {
      // No cache is a normal first-run state.
    }
  }
  rememberCapabilities([], identity.key, capabilityGeneration);
  return { source: 'unavailable', models: [] };
}

export async function fetchLiveCodexModels(opts: {
  credential?: CodexCatalogCredential | null;
  credentialProvider?: () => Promise<CodexCatalogCredential | null>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  clientVersion?: string;
  now?: () => Date;
} = {}): Promise<{ catalog: ParsedCatalog | null; credential: CodexCatalogCredential | null; error?: CodexCatalogError }> {
  const credential = opts.credential !== undefined
    ? opts.credential
    : await (opts.credentialProvider ?? resolveCodexCatalogCredential)();
  if (!credential) return { catalog: null, credential: null, error: 'not-signed-in' };

  const url = new URL(CODEX_MODELS_URL);
  const clientVersion = opts.clientVersion ?? CODEX_PROTOCOL_VERSION;
  url.searchParams.set('client_version', clientVersion);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${credential.accessToken}`,
    originator: 'codex_cli_rs',
    version: clientVersion,
  };
  if (credential.accountId) headers['chatgpt-account-id'] = credential.accountId;

  try {
    const response = await (opts.fetchFn ?? fetch)(url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
    });
    if (!response.ok) {
      const error: CodexCatalogError = response.status === 401 || response.status === 403
        ? 'auth'
        : response.status === 429
          ? 'rate-limited'
          : 'provider';
      return { catalog: null, credential, error };
    }
    const parsed = parseCodexModelsPayload(await response.json().catch(() => null));
    if (!parsed) return { catalog: null, credential, error: 'invalid-response' };
    return {
      catalog: {
        ...parsed,
        fetchedAt: parsed.fetchedAt || (opts.now ?? (() => new Date()))().toISOString(),
        clientVersion: parsed.clientVersion || clientVersion,
      },
      credential,
    };
  } catch {
    return { catalog: null, credential, error: 'network' };
  }
}

const refreshes = new Map<string, Promise<CodexModelCatalog>>();

export async function refreshCodexModelCatalog(opts: {
  appCacheFile?: string;
  clientVersion?: string;
  credential?: CodexCatalogCredential | null;
  credentialProvider?: () => Promise<CodexCatalogCredential | null>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  writeFile?: (filePath: string, data: string) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  unlink?: (filePath: string) => Promise<void>;
  platform?: NodeJS.Platform;
  readCached?: () => Promise<CodexModelCatalog>;
  now?: () => Date;
} = {}): Promise<CodexModelCatalog> {
  const credential = opts.credential !== undefined
    ? opts.credential
    : await (opts.credentialProvider ?? resolveCodexCatalogCredential)();
  const refreshKey = credential ? accountKey(credential) : null;
  if (refreshKey && refreshes.has(refreshKey)) return refreshes.get(refreshKey)!;
  const request: Promise<CodexModelCatalog> = (async (): Promise<CodexModelCatalog> => {
    const live = await fetchLiveCodexModels({ ...opts, credential });
    if (live.catalog && live.credential) {
      const key = accountKey(live.credential);
      const current = await (opts.credentialProvider
        ?? (opts.credential !== undefined ? async () => opts.credential ?? null : resolveCodexCatalogCredential))();
      if (!key || !current || accountKey(current) !== key) {
        return { source: 'unavailable', models: [], refreshError: 'auth' };
      }
      rememberCapabilities(live.catalog.models, key);
      if (opts.appCacheFile && key) {
        const temporary = `${opts.appCacheFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
        const payload: PersistedCatalog = { schemaVersion: 1, accountKey: key, catalog: live.catalog };
        try {
          await (opts.writeFile ?? ((file, data) => fs.promises.writeFile(file, data, { encoding: 'utf8', mode: 0o600 })))(temporary, JSON.stringify(payload));
          const activeBeforeCommit = await (opts.credentialProvider
            ?? (opts.credential !== undefined ? async () => opts.credential ?? null : resolveCodexCatalogCredential))();
          if (!activeBeforeCommit || accountKey(activeBeforeCommit) !== key) {
            try { await (opts.unlink ?? fs.promises.unlink)(temporary); } catch { /* best effort */ }
            return { source: 'unavailable', models: [], refreshError: 'auth' };
          }
          const rename = opts.rename ?? fs.promises.rename;
          try {
            await rename(temporary, opts.appCacheFile);
          } catch (error) {
            if ((opts.platform ?? process.platform) !== 'win32') throw error;
            const backup = `${opts.appCacheFile}.bak`;
            const unlink = opts.unlink ?? fs.promises.unlink;
            try { await unlink(backup); } catch { /* no previous backup */ }
            let movedExisting = false;
            try {
              await rename(opts.appCacheFile, backup);
              movedExisting = true;
            } catch { /* first write: destination did not exist */ }
            try {
              await rename(temporary, opts.appCacheFile);
              if (movedExisting) try { await unlink(backup); } catch { /* cleanup on next refresh */ }
            } catch (replacementError) {
              if (movedExisting) try { await rename(backup, opts.appCacheFile); } catch { /* preserve best effort */ }
              throw replacementError;
            }
          }
        } catch {
          try { await fs.promises.unlink(temporary); } catch { /* best effort */ }
        }
      }
      return { source: 'provider-live' as const, ...live.catalog };
    }
    const cached = opts.readCached ? await opts.readCached() : { source: 'unavailable' as const, models: [] };
    return { ...cached, refreshError: live.error };
  })().finally(() => { if (refreshKey) refreshes.delete(refreshKey); });
  if (refreshKey) refreshes.set(refreshKey, request);
  return request;
}

export function resetCodexCatalogRefreshForTest(): void {
  refreshes.clear();
  const state = capabilityState();
  state.accountKey = null;
  state.models.clear();
  state.generation++;
}
