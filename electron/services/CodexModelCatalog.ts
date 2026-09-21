/**
 * Authenticated Codex model discovery.
 *
 * Settings explicitly refreshes after ChatGPT authentication. Other surfaces
 * read only the process-memory cache, so app startup never contacts the model
 * endpoint and no Codex CLI installation is required.
 */

import { CodexOAuthService } from './CodexOAuthService';
import { readCodexCliAuth } from './CodexCliAuth';

export const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models';
// Protocol capability version, not the Natively app version.
export const CODEX_PROTOCOL_VERSION = '0.154.0';

export type CodexCatalogSource = 'provider-live' | 'memory-cache' | 'unavailable';
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

type ParsedCatalog = Omit<CodexModelCatalog, 'source' | 'refreshError'>;
type ModelCapabilities = Pick<CodexCatalogModel, 'reasoningLevels' | 'serviceTiers' | 'defaultReasoningLevel'>;

const SAFE_PROVIDER_VALUE = /^[a-z][a-z0-9_-]{0,63}$/i;
const STATE_KEY = Symbol.for('natively.codexModelCatalog');
interface CatalogState {
  catalogs: Map<string, ParsedCatalog>;
  capabilities: Map<string, ModelCapabilities>;
  refreshes: Map<string, Promise<CodexModelCatalog>>;
  activeIdentity: string | null;
  testIdentity: string | null;
}
const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: CatalogState };
const state = globalState[STATE_KEY] ??= {
  catalogs: new Map(), capabilities: new Map(), refreshes: new Map(), activeIdentity: null, testIdentity: null,
};

function cleanOption(value: any): CodexCatalogOption | null {
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

function cleanOptions(values: unknown): CodexCatalogOption[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  return values.flatMap(value => {
    const option = cleanOption(value);
    if (!option || seen.has(option.id)) return [];
    seen.add(option.id);
    return [option];
  });
}

export function parseCodexModelsPayload(data: any): ParsedCatalog | null {
  if (!data || !Array.isArray(data.models)) return null;
  const rows = data.models
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
        reasoningLevels: cleanOptions(model.supported_reasoning_levels),
        ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}),
        serviceTiers: cleanOptions(model.service_tiers),
        priority: Number.isFinite(model.priority) ? Number(model.priority) : Number.MAX_SAFE_INTEGER,
        index,
      };
    })
    .sort((a: any, b: any) => a.priority - b.priority || a.index - b.index);
  const seen = new Set<string>();
  const models: CodexCatalogModel[] = [];
  for (const { priority: _priority, index: _index, ...model } of rows) {
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

function jwtSubject(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'));
    return typeof payload?.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

function identityOf(credential: CodexCatalogCredential): string | null {
  return credential.accountId || jwtSubject(credential.accessToken) || credential.email || null;
}

function activeCredentialIdentity(): string | null {
  const oauth = CodexOAuthService.getInstance();
  if (oauth.getStatus().signedIn) {
    const token = oauth.getCachedTokens();
    return token?.accessToken ? identityOf({ source: 'natively', ...token }) : null;
  }
  const cli = readCodexCliAuth();
  return cli.status === 'ok' ? identityOf({ source: 'codex-cli', ...cli }) : null;
}

export async function resolveCodexCatalogCredential(): Promise<CodexCatalogCredential | null> {
  const oauth = CodexOAuthService.getInstance();
  if (oauth.getStatus().signedIn) {
    const accessToken = await oauth.getAccessToken();
    const token = oauth.getCachedTokens();
    if (accessToken) return { source: 'natively', accessToken, accountId: token?.accountId, email: token?.email };
  }
  const cli = readCodexCliAuth();
  return cli.status === 'ok'
    ? { source: 'codex-cli', accessToken: cli.accessToken, accountId: cli.accountId, email: cli.email }
    : null;
}

function activate(identity: string, catalog: ParsedCatalog): void {
  state.activeIdentity = identity;
  state.capabilities.clear();
  for (const model of catalog.models) {
    state.capabilities.set(model.id, {
      reasoningLevels: model.reasoningLevels,
      serviceTiers: model.serviceTiers,
      defaultReasoningLevel: model.defaultReasoningLevel,
    });
  }
}

export function getCodexModelCapabilities(modelId: string): ModelCapabilities | null {
  const currentIdentity = state.testIdentity ?? activeCredentialIdentity();
  return state.activeIdentity === currentIdentity ? state.capabilities.get(modelId.trim()) ?? null : null;
}

export async function readCachedCodexModelCatalog(identity = activeCredentialIdentity()): Promise<CodexModelCatalog> {
  if (!identity) return { source: 'unavailable', models: [], refreshError: 'not-signed-in' };
  const catalog = state.catalogs.get(identity);
  if (!catalog) return { source: 'unavailable', models: [] };
  activate(identity, catalog);
  return { source: 'memory-cache', ...catalog };
}

export async function fetchLiveCodexModels(opts: {
  credential?: CodexCatalogCredential | null;
  credentialProvider?: () => Promise<CodexCatalogCredential | null>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
} = {}): Promise<{ catalog: ParsedCatalog | null; credential: CodexCatalogCredential | null; error?: CodexCatalogError }> {
  const credential = opts.credential !== undefined
    ? opts.credential
    : await (opts.credentialProvider ?? resolveCodexCatalogCredential)();
  if (!credential) return { catalog: null, credential: null, error: 'not-signed-in' };
  const url = `${CODEX_MODELS_URL}?client_version=${encodeURIComponent(CODEX_PROTOCOL_VERSION)}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${credential.accessToken}`,
    originator: 'codex_cli_rs',
    version: CODEX_PROTOCOL_VERSION,
  };
  if (credential.accountId) headers['chatgpt-account-id'] = credential.accountId;
  try {
    const response = await (opts.fetchFn ?? fetch)(url, {
      method: 'GET', headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
    });
    if (!response.ok) {
      const error: CodexCatalogError = response.status === 401 || response.status === 403
        ? 'auth' : response.status === 429 ? 'rate-limited' : 'provider';
      return { catalog: null, credential, error };
    }
    const parsed = parseCodexModelsPayload(await response.json().catch(() => null));
    if (!parsed) return { catalog: null, credential, error: 'invalid-response' };
    return {
      catalog: {
        ...parsed,
        fetchedAt: parsed.fetchedAt || (opts.now ?? (() => new Date()))().toISOString(),
        clientVersion: parsed.clientVersion || CODEX_PROTOCOL_VERSION,
      },
      credential,
    };
  } catch {
    return { catalog: null, credential, error: 'network' };
  }
}

export async function refreshCodexModelCatalog(opts: Parameters<typeof fetchLiveCodexModels>[0] = {}): Promise<CodexModelCatalog> {
  const credential = opts.credential !== undefined
    ? opts.credential
    : await (opts.credentialProvider ?? resolveCodexCatalogCredential)();
  const identity = credential ? identityOf(credential) : null;
  if (!identity) return { source: 'unavailable', models: [], refreshError: 'not-signed-in' };
  const running = state.refreshes.get(identity);
  if (running) return running;
  const request = (async (): Promise<CodexModelCatalog> => {
    const result = await fetchLiveCodexModels({ ...opts, credential });
    if (!result.catalog) {
      const cached = await readCachedCodexModelCatalog(identity);
      return { ...cached, refreshError: result.error };
    }
    const current = await (opts.credentialProvider
      ?? (opts.credential !== undefined ? async () => opts.credential ?? null : resolveCodexCatalogCredential))();
    if (!current || identityOf(current) !== identity) {
      return { source: 'unavailable', models: [], refreshError: 'auth' };
    }
    state.catalogs.set(identity, result.catalog);
    activate(identity, result.catalog);
    return { source: 'provider-live', ...result.catalog };
  })().finally(() => state.refreshes.delete(identity));
  state.refreshes.set(identity, request);
  return request;
}

export function resetCodexCatalogForTest(): void {
  state.catalogs.clear();
  state.capabilities.clear();
  state.refreshes.clear();
  state.activeIdentity = null;
  state.testIdentity = null;
}

export function activateCodexModelCatalogForTest(models: CodexCatalogModel[], identity = activeCredentialIdentity()): void {
  if (!identity) return;
  state.testIdentity = identity;
  const catalog = { models };
  state.catalogs.set(identity, catalog);
  activate(identity, catalog);
}
