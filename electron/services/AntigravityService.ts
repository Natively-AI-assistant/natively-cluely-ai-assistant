/**
 * Google Antigravity OAuth and Code Assist transport.
 *
 * This is deliberately self contained.  The Android Voice-app is the wire
 * reference; Electron only replaces its intent callback and token store with
 * a loopback HTTP server and CredentialsManager.
 */

import { EventEmitter } from 'events';
import * as http from 'http';
import * as crypto from 'crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { shell } from 'electron';
import type { CredentialsManager } from './CredentialsManager';

export const ANTIGRAVITY_CLIENT_ID =
  '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
// This is the installed client's public OAuth credential from the reference
// app.  It is not a user's bearer token and is required by Google's exchange.
export const ANTIGRAVITY_CLIENT_SECRET = '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';
export const ANTIGRAVITY_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const ANTIGRAVITY_REDIRECT_URI = 'http://localhost:51121/oauth-callback';
export const ANTIGRAVITY_CALLBACK_PATH = '/oauth-callback';
export const ANTIGRAVITY_CALLBACK_PORT = 51121;
export const ANTIGRAVITY_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
] as const;
export const GOOGLE_API_USER_AGENT = 'google-api-nodejs-client/9.15.1';
export const ANTIGRAVITY_SETUP_CLIENT = 'google-cloud-sdk vscode_cloudshelleditor/0.1';
export const ANTIGRAVITY_PROD_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
export const ANTIGRAVITY_DAILY_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com';
export const ANTIGRAVITY_REFRESH_LEAD_MS = 60_000;
export const ANTIGRAVITY_STREAM_URL =
  `${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:streamGenerateContent?alt=sse`;

export type AntigravityErrorCode =
  | 'cancelled'
  | 'browser'
  | 'callback'
  | 'token_exchange'
  | 'token_refresh'
  | 'auth_required'
  | 'auth_revoked'
  | 'setup'
  | 'models'
  | 'request'
  | 'response'
  | 'storage';

export class AntigravityError extends Error {
  public readonly code: AntigravityErrorCode;
  public readonly status?: number;

  constructor(code: AntigravityErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AntigravityError';
    this.code = code;
    this.status = status;
  }
}

export interface AntigravityOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  projectId: string;
}

export interface AntigravityModel {
  id: string;
  label: string;
}

export interface AntigravityStatus {
  signedIn: boolean;
  inProgress: boolean;
  expiresAt?: number;
  projectId?: string;
  error?: string;
}

export interface AntigravityImage {
  mimeType: string;
  data: string;
}

export interface AntigravityStreamInput {
  model: string;
  userPrompt: string;
  systemPrompt?: string;
  images?: readonly AntigravityImage[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export function resolveAntigravityWireModel(model: string): string {
  const normalized = model.toLowerCase().replace(/^models\//, '');
  if (normalized.startsWith('gemini-3.7-flash')) return 'gemini-3.7-flash-tiered';
  if (normalized.startsWith('gemini-3.6-flash')) return 'gemini-3.6-flash-tiered';
  if (normalized === 'gemini-3.1-pro-high' || normalized === 'gemini-3.1-pro') {
    return 'gemini-pro-agent';
  }
  return normalized;
}

export function generateAntigravityPkce(): {
  verifier: string;
  challenge: string;
  state: string;
} {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, state: crypto.randomUUID() };
}

export function buildAntigravityAuthorizationUrl(
  pkce: { challenge: string; state: string },
): string {
  const params: Array<[string, string]> = [
    ['client_id', ANTIGRAVITY_CLIENT_ID],
    ['response_type', 'code'],
    ['redirect_uri', ANTIGRAVITY_REDIRECT_URI],
    ['scope', ANTIGRAVITY_SCOPES.join(' ')],
    ['code_challenge', pkce.challenge],
    ['code_challenge_method', 'S256'],
    ['state', pkce.state],
    ['access_type', 'offline'],
    ['prompt', 'consent'],
  ];
  return `${ANTIGRAVITY_AUTHORIZE_URL}?${new URLSearchParams(params)}`;
}

function metadata(ideType: 'ANTIGRAVITY' | 'IDE_UNSPECIFIED'): Record<string, string> {
  return { ideType, platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' };
}

export function antigravitySetupHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': GOOGLE_API_USER_AGENT,
    'X-Goog-Api-Client': ANTIGRAVITY_SETUP_CLIENT,
    'Client-Metadata': JSON.stringify(metadata('IDE_UNSPECIFIED')),
  };
}

const ANTIGRAVITY_USER_AGENT = `antigravity/1.23.2 ${process.platform}/${process.arch}`;

export function buildAntigravityRequestPayload(input: {
  projectId: string;
  model: string;
  userPrompt: string;
  systemPrompt?: string;
  images?: readonly AntigravityImage[];
  maxOutputTokens?: number;
}): Record<string, unknown> {
  const projectId = input.projectId.trim();
  if (!projectId) throw new AntigravityError('request', 'Google account setup has no project yet. Sign in again.');

  const contents: Array<Record<string, unknown>> = [
    {
      role: 'user',
      parts: [{ text: `System instruction: ${input.systemPrompt || ''}` }],
    },
  ];
  const parts: Array<Record<string, unknown>> = [{ text: input.userPrompt }];
  for (const image of input.images || []) {
    if (image.mimeType && image.data) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
  }
  contents.push({ role: 'user', parts });

  const wireModel = resolveAntigravityWireModel(input.model);
  const generationConfig: Record<string, unknown> = {
    candidateCount: 1,
    maxOutputTokens: Math.max(1, Math.floor(input.maxOutputTokens || 192)),
    temperature: 0.45,
  };
  if (wireModel.startsWith('gemini')) {
    generationConfig.thinkingConfig = wireModel.startsWith('gemini-2.5')
      ? { thinkingBudget: 0 }
      : { thinkingLevel: wireModel.includes('3.7') ? 'low' : 'minimal' };
  }

  return {
    model: wireModel,
    userAgent: 'antigravity',
    requestType: 'agent',
    project: projectId,
    requestId: `agent-${crypto.randomUUID()}`,
    request: { contents, generationConfig },
  };
}

export function parseAntigravityModels(value: unknown): AntigravityModel[] {
  const models = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).models
    : undefined;
  if (!models || typeof models !== 'object' || Array.isArray(models)) return [];

  const result: AntigravityModel[] = [];
  for (const [id, raw] of Object.entries(models as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const label = typeof item.displayName === 'string' ? item.displayName.trim() : '';
    const quota = item.quotaInfo && typeof item.quotaInfo === 'object'
      ? (item.quotaInfo as Record<string, unknown>).remainingFraction
      : undefined;
    if (!label || item.isInternal === true || !id || id.startsWith('gemini-3.5-flash')) continue;
    if (id.toLowerCase().includes('image') || label.toLowerCase().includes('flash lite')) continue;
    if (typeof quota !== 'number' || !Number.isFinite(quota) || quota <= 0) continue;
    result.push({ id, label });
  }
  return result.sort((a, b) => {
    const rank = (id: string) => id === 'gemini-3.6-flash-low' ? 0
      : id === 'gemini-3-flash' ? 1
        : id.includes('flash') ? 2 : 3;
    return rank(a.id) - rank(b.id) || a.id.localeCompare(b.id);
  });
}

export function parseAntigravityEvent(data: string): string {
  let response: any;
  try { response = JSON.parse(data)?.response; } catch { throw new AntigravityError('response', 'Google returned malformed streaming data.'); }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new AntigravityError('response', 'Google returned an invalid streaming response.');
  }
  if (!Array.isArray(response.candidates) || !response.candidates.length) return '';
  const candidate = response.candidates[0];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new AntigravityError('response', 'Google returned an invalid candidate.');
  }
  const parts = candidate.content?.parts;
  if (parts !== undefined && !Array.isArray(parts)) {
    throw new AntigravityError('response', 'Google returned invalid response parts.');
  }
  return (parts || []).map((part: any) => part?.thought !== true && typeof part?.text === 'string' ? part.text : '').join('');
}

function parseAntigravitySse(buffer: string, final = false): { events: string[]; remainder: string } {
  if (buffer.length > 2 * 1024 * 1024) throw new AntigravityError('response', 'Google returned an oversized streaming response.');
  const records = buffer.split(/\r?\n\r?\n/);
  const remainder = final ? '' : records.pop()!;
  const events = records.map(record => record.split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^ /, '')).join('\n').trim()).filter(Boolean);
  return { events, remainder };
}

// Voice-app parity: UnknownHostException retries are 4 normally and 12 for
// model discovery, using 250/500/1000/2000 ms backoff. HTTP errors are not retried.
function isDnsError(error: unknown): boolean {
  let current: any = error;
  for (let i = 0; i < 5 && current; i += 1) {
    const code = typeof current.code === 'string' ? current.code : '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL') return true;
    if (typeof current.message === 'string' && /\b(?:ENOTFOUND|EAI_AGAIN|EAI_FAIL)\b/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

export function dnsRetryDelayMillis(remainingRetries: number): number {
  return 250 << Math.max(0, Math.min(3, 4 - remainingRetries));
}

const ANTIGRAVITY_FETCH_TIMEOUT_MS = 30_000;
const ANTIGRAVITY_STREAM_TIMEOUT_MS = 60_000;

async function fetchWithDnsRetry(
  url: string,
  init: RequestInit,
  remainingRetries: number,
  timeoutMs = ANTIGRAVITY_FETCH_TIMEOUT_MS,
): Promise<Response> {
  let retries = remainingRetries;
  const externalSignal = init.signal ?? undefined;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = externalSignal
    ? AbortSignal.any([externalSignal, timeoutSignal])
    : timeoutSignal;
  const requestInit = { ...init, signal: requestSignal };
  while (true) {
    try {
      return await fetch(url, requestInit);
    } catch (error) {
      if (externalSignal?.aborted) throw new AntigravityError('cancelled', 'Google request cancelled.');
      if (timeoutSignal.aborted) throw new AntigravityError('request', 'Google request timed out.');
      if (!isDnsError(error) || retries <= 0) throw error;
      try {
        await wait(dnsRetryDelayMillis(retries), undefined, { signal: requestSignal });
      } catch (waitError) {
        if (timeoutSignal.aborted) throw new AntigravityError('request', 'Google request timed out.');
        throw waitError;
      }
      retries -= 1;
    }
  }
}

async function responseJson(response: Response, phase: AntigravityErrorCode): Promise<any> {
  // fetchWithDnsRetry's AbortSignal deadline also covers consuming the body.
  const body = await response.text();
  if (!response.ok) {
    const status = response.status;
    let oauthError: unknown;
    try { oauthError = JSON.parse(body)?.error; } catch { /* Non-JSON errors are transient session failures. */ }
    const permanent = phase === 'token_refresh' && (status === 400 || status === 401) && oauthError === 'invalid_grant';
    const message = permanent
      ? 'Google session expired. Sign in again.'
      : status === 401
        ? 'Google access was rejected. Refresh the session or sign in again.'
        : status === 403
          ? 'This Google account is not permitted to use Antigravity.'
        : status === 429
          ? 'Google quota is exhausted or temporarily limited. Try again later.'
          : status >= 500
            ? 'Google is temporarily unavailable. Try again shortly.'
            : `${phase === 'models' ? 'Google model discovery' : 'Google request'} failed (HTTP ${status}).`;
    throw new AntigravityError(
      permanent ? 'auth_revoked' : phase,
      message,
      status,
    );
  }
  try { return JSON.parse(body); } catch { throw new AntigravityError(phase, 'Google returned invalid JSON.'); }
}

interface CallbackServer {
  portReady: Promise<void>;
  callback: Promise<{ code?: string; state?: string; error?: string }>;
  close(reason?: Error): void;
}

function startCallbackServer(): CallbackServer {
  let resolveCallback!: (value: { code?: string; state?: string; error?: string }) => void;
  let rejectCallback!: (error: Error) => void;
  let settled = false;
  const callback = new Promise<{ code?: string; state?: string; error?: string }>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  // A bind failure can close the server before startLogin awaits the callback;
  // keep that cleanup rejection from becoming an unhandled promise rejection.
  void callback.catch(() => undefined);
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET' });
      response.end('Method Not Allowed');
      return;
    }
    const host = (request.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1') {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Invalid callback host');
      return;
    }
    let url: URL;
    try { url = new URL(request.url || '/', 'http://localhost'); } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Invalid callback');
      return;
    }
    // Absolute HTTP request targets can disagree with Host; validate both.
    if (url.protocol !== 'http:' || (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') ||
      (url.port && url.port !== String(ANTIGRAVITY_CALLBACK_PORT))) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Invalid callback origin');
      return;
    }
    if (url.pathname !== ANTIGRAVITY_CALLBACK_PATH) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Natively</title><p>You can close this tab and return to Natively.</p>');
    if (settled) return;
    settled = true;
    resolveCallback({
      code: url.searchParams.get('code') || undefined,
      state: url.searchParams.get('state') || undefined,
      error: url.searchParams.get('error') || undefined,
    });
  });
  const portReady = new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(ANTIGRAVITY_CALLBACK_PORT, '127.0.0.1');
  });
  return {
    portReady,
    callback,
    close(reason) {
      if (!settled) {
        settled = true;
        rejectCallback(reason || new AntigravityError('cancelled', 'Google sign-in cancelled.'));
      }
      try { (server as any).closeAllConnections?.(); } catch { /* noop */ }
      try { server.close(); } catch { /* already closed */ }
    },
  };
}

function extractProjectId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return undefined;
}

async function discoverProject(accessToken: string, signal: AbortSignal): Promise<string> {
  const headers = antigravitySetupHeaders(accessToken);
  const loadResponse = await fetchWithDnsRetry(
    `${ANTIGRAVITY_PROD_ENDPOINT}/v1internal:loadCodeAssist`,
    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata: metadata('ANTIGRAVITY') }), signal },
    4,
  );
  const loaded = await responseJson(loadResponse, 'setup');
  const existing = extractProjectId(loaded?.cloudaicompanionProject);
  if (existing) return existing;

  let tierId = 'legacy-tier';
  if (Array.isArray(loaded?.allowedTiers)) {
    const tier = loaded.allowedTiers.find((item: any) => item?.isDefault === true && typeof item?.id === 'string' && item.id.trim());
    if (tier) tierId = tier.id.trim();
  }
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const onboardResponse = await fetchWithDnsRetry(
      `${ANTIGRAVITY_PROD_ENDPOINT}/v1internal:onboardUser`,
      { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ tierId, metadata: metadata('ANTIGRAVITY') }), signal },
      4,
    );
    const onboarded = await responseJson(onboardResponse, 'setup');
    const project = onboarded?.done === true
      ? extractProjectId(onboarded?.response?.cloudaicompanionProject) : undefined;
    if (project) return project;
    if (attempt < 5) await wait(1_500, undefined, { signal });
  }
  throw new AntigravityError('setup', 'Google account setup did not finish. Try signing in again.');
}

export class AntigravityService extends EventEmitter {
  private cachedTokens: AntigravityOAuthTokens | null = null;
  private cachedModels: AntigravityModel[] | null = null;
  private refreshInFlight: Promise<AntigravityOAuthTokens | null> | null = null;
  private refreshController: AbortController | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private activeLogin: { generation: number; server: CallbackServer; controller: AbortController } | null = null;
  private requestControllers = new Set<AbortController>();
  private generation = 0;
  private signedOut = false;
  private backgroundRefreshFailures = 0;
  private lastError: string | undefined;

  private constructor() { super(); }

  public static getInstance(): AntigravityService {
    const global = globalThis as unknown as Record<string, AntigravityService | undefined>;
    if (!global.__nativelyAntigravityServiceV1__) global.__nativelyAntigravityServiceV1__ = new AntigravityService();
    return global.__nativelyAntigravityServiceV1__;
  }

  public initialize(): void {
    this.signedOut = false;
    this.backgroundRefreshFailures = 0;
    this.stopRefreshTimer();
    this.cachedTokens = this.loadFromStorage();
    this.lastError = undefined;
    this.scheduleRefresh();
    this.emit('status-changed', this.getStatus());
  }

  public dispose(): void {
    this.generation += 1;
    this.stopRefreshTimer();
    this.activeLogin?.controller.abort();
    this.activeLogin?.server.close(new AntigravityError('cancelled', 'Google sign-in cancelled.'));
    this.activeLogin = null;
    this.refreshController?.abort();
    this.refreshController = null;
    for (const controller of this.requestControllers) controller.abort();
    this.requestControllers.clear();
    this.refreshInFlight = null;
  }

  public getStatus(): AntigravityStatus {
    const tokens = this.signedOut ? null : (this.cachedTokens || this.loadFromStorage());
    return {
      signedIn: Boolean(tokens?.accessToken && tokens.refreshToken && tokens.projectId),
      inProgress: Boolean(this.activeLogin),
      ...(tokens ? { expiresAt: tokens.expiresAt, projectId: tokens.projectId } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  public cancelLogin(): boolean {
    if (!this.activeLogin) return false;
    this.generation += 1;
    const active = this.activeLogin;
    active.controller.abort();
    active.server.close(new AntigravityError('cancelled', 'Google sign-in cancelled.'));
    this.activeLogin = null;
    this.lastError = 'Google sign-in cancelled.';
    this.emit('status-changed', this.getStatus());
    return true;
  }

  public async startLogin(): Promise<AntigravityOAuthTokens> {
    if (this.activeLogin) throw new AntigravityError('callback', 'Google sign-in is already in progress.');
    const generation = ++this.generation;
    this.signedOut = false;
    const server = startCallbackServer();
    const controller = new AbortController();
    const active = { generation, server, controller };
    this.activeLogin = active;
    this.lastError = undefined;
    this.emit('status-changed', this.getStatus());
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      try {
        await server.portReady;
      } catch (error) {
        if ((error as any)?.code === 'EADDRINUSE') {
          throw new AntigravityError('callback', 'Google sign-in callback port is busy. Close the other sign-in window and try again.');
        }
        throw error;
      }
      this.assertGeneration(generation);
      const pkce = generateAntigravityPkce();
      await shell.openExternal(buildAntigravityAuthorizationUrl(pkce)).catch(() => {
        throw new AntigravityError('browser', 'Could not open the Google sign-in page.');
      });
      const callback = await new Promise<{ code?: string; state?: string; error?: string }>((resolve, reject) => {
        timeout = setTimeout(() => reject(new AntigravityError('callback', 'Google sign-in timed out.')), 5 * 60_000);
        server.callback.then(resolve, reject);
      });
      this.assertGeneration(generation);
      if (callback.error) throw new AntigravityError('callback', 'Google sign-in was denied.');
      if (callback.state !== pkce.state) throw new AntigravityError('callback', 'Google sign-in state did not match. Start again.');
      if (!callback.code?.trim()) throw new AntigravityError('callback', 'Google returned no authorization code.');

      const exchanged = await this.exchangeCode(callback.code, pkce.verifier, controller.signal);
      this.assertGeneration(generation);
      const projectId = await discoverProject(exchanged.accessToken, controller.signal);
      this.assertGeneration(generation);
      const tokens = { ...exchanged, projectId };
      if (!this.saveToStorage(tokens)) throw new AntigravityError('storage', 'Google sign-in could not be saved. Check credential storage and try again.');
      this.cachedTokens = tokens;
      this.cachedModels = null;
      this.lastError = undefined;
      this.scheduleRefresh();
      this.emit('status-changed', this.getStatus());
      return tokens;
    } catch (error) {
      const normalized = this.normalizeError(error, 'Google sign-in failed.');
      if (generation === this.generation) {
        this.lastError = normalized.message;
        this.emit('status-changed', this.getStatus());
      }
      throw normalized;
    } finally {
      if (timeout) clearTimeout(timeout);
      controller.abort();
      server.close();
      if (this.activeLogin === active) this.activeLogin = null;
      this.emit('status-changed', this.getStatus());
    }
  }

  public signOut(): { success: boolean; error?: string } {
    this.generation += 1;
    this.signedOut = true;
    this.stopRefreshTimer();
    this.refreshController?.abort();
    this.refreshController = null;
    this.activeLogin?.controller.abort();
    this.activeLogin?.server.close(new AntigravityError('cancelled', 'Google sign-in cancelled.'));
    this.activeLogin = null;
    for (const controller of this.requestControllers) controller.abort();
    this.requestControllers.clear();
    this.cachedTokens = null;
    this.cachedModels = null;
    const persisted = this.clearStorage();
    this.lastError = persisted ? undefined : 'Google credentials could not be cleared from secure storage.';
    this.emit('models-changed', []);
    this.emit('status-changed', this.getStatus());
    return persisted ? { success: true } : { success: false, error: this.lastError };
  }

  public async getAccessToken(): Promise<string | null> {
    if (this.signedOut) return null;
    const tokens = this.cachedTokens || this.loadFromStorage();
    if (!tokens?.refreshToken) return null;
    if (tokens.accessToken && tokens.expiresAt - Date.now() > ANTIGRAVITY_REFRESH_LEAD_MS) return tokens.accessToken;
    return (await this.refreshTokens())?.accessToken || null;
  }

  public async refreshTokens(): Promise<AntigravityOAuthTokens | null> {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (this.signedOut) return null;
    const generation = this.generation;
    const controller = new AbortController();
    this.refreshController = controller;
    const run = (async () => {
      const previous = this.signedOut ? null : (this.cachedTokens || this.loadFromStorage());
      if (!previous?.refreshToken) return null;
      let response: Response;
      try {
        response = await fetchWithDnsRetry(ANTIGRAVITY_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': GOOGLE_API_USER_AGENT },
          body: new URLSearchParams({
            client_id: ANTIGRAVITY_CLIENT_ID,
            client_secret: ANTIGRAVITY_CLIENT_SECRET,
            refresh_token: previous.refreshToken.trim(),
            grant_type: 'refresh_token',
          }).toString(),
          signal: controller.signal,
        }, 4);
      } catch (error) {
        throw this.normalizeError(error, 'Google token refresh failed.');
      }
      let bundle: any;
      try { bundle = await responseJson(response, 'token_refresh'); } catch (error) {
        if (error instanceof AntigravityError && error.code === 'auth_revoked' && generation === this.generation) {
          this.markSignedOut(error.message);
        }
        throw error;
      }
      if (generation !== this.generation) throw new AntigravityError('cancelled', 'Google request cancelled.');
      if (typeof bundle?.access_token !== 'string' || !bundle.access_token) {
        throw new AntigravityError('token_refresh', 'Google token refresh returned no access token.');
      }
      const refreshToken = typeof bundle.refresh_token === 'string' && bundle.refresh_token.trim()
        ? bundle.refresh_token.trim() : previous.refreshToken;
      const expiresIn = typeof bundle.expires_in === 'number' && Number.isFinite(bundle.expires_in)
        ? bundle.expires_in : 3600;
      if (expiresIn <= 0) throw new AntigravityError('token_refresh', 'Google returned an expired access token.');
      const next = {
        accessToken: bundle.access_token,
        refreshToken,
        expiresAt: Date.now() + expiresIn * 1000,
        projectId: previous.projectId,
      };
      if (!this.saveToStorage(next)) throw new AntigravityError('storage', 'Google token refresh could not be saved.');
      if (generation !== this.generation) throw new AntigravityError('cancelled', 'Google request cancelled.');
      this.cachedTokens = next;
      this.signedOut = false;
      this.backgroundRefreshFailures = 0;
      this.lastError = undefined;
      this.scheduleRefresh();
      this.emit('status-changed', this.getStatus());
      return next;
    })();
    let wrapped!: Promise<AntigravityOAuthTokens | null>;
    const handled = run.catch((error) => {
      const normalized = this.normalizeError(error, 'Google token refresh failed.');
      if (generation === this.generation && normalized.code !== 'cancelled') {
        this.lastError = normalized.message;
        this.emit('status-changed', this.getStatus());
      }
      throw normalized;
    });
    wrapped = handled.finally(() => {
      if (this.refreshInFlight === wrapped) this.refreshInFlight = null;
      if (this.refreshController === controller) this.refreshController = null;
    });
    this.refreshInFlight = wrapped;
    return wrapped;
  }

  private async authenticatedFetch(url: string, init: RequestInit, token: string, retries: number, timeoutMs = ANTIGRAVITY_FETCH_TIMEOUT_MS): Promise<Response> {
    const generation = this.generation;
    const send = (accessToken: string) => fetchWithDnsRetry(url, {
      ...init, headers: { 'Content-Type': 'application/json', 'User-Agent': ANTIGRAVITY_USER_AGENT,
        ...init.headers, Authorization: `Bearer ${accessToken}` },
    }, retries, timeoutMs);
    try {
      init.signal?.throwIfAborted();
      const response = await send(token);
      if (response.status !== 401) return response;
      try { await response.body?.cancel(); } catch { /* noop */ }
      this.assertGeneration(generation);
      init.signal?.throwIfAborted();
      const refreshed = await this.refreshTokens();
      this.assertGeneration(generation);
      init.signal?.throwIfAborted();
      if (!refreshed) throw new AntigravityError('auth_required', 'Sign in with Google Antigravity first.');
      return await send(refreshed.accessToken);
    } catch (error) { throw this.normalizeError(error, 'Google request failed.'); }
  }

  public async getModels(force = false): Promise<AntigravityModel[]> {
    if (this.signedOut) throw new AntigravityError('auth_required', 'Sign in with Google Antigravity first.');
    if (!force && this.cachedModels) return this.cachedModels.map(model => ({ ...model }));
    const generation = this.generation;
    const token = await this.getAccessToken();
    this.assertGeneration(generation);
    if (!token) throw new AntigravityError('auth_required', this.lastError || 'Sign in with Google Antigravity first.');
    const projectId = this.cachedTokens?.projectId || this.loadFromStorage()?.projectId;
    if (!projectId) throw new AntigravityError('setup', 'Google account setup has no project. Sign in again.');
    const request = this.registerRequest();
    try {
      const response = await this.authenticatedFetch(`${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:fetchAvailableModels`, {
        method: 'POST', body: JSON.stringify({ project: projectId }), signal: request.signal,
      }, token, 12);
      const catalog = await responseJson(response, 'models');
      if (generation !== this.generation || this.signedOut) throw new AntigravityError('cancelled', 'Google request cancelled.');
      const models = parseAntigravityModels(catalog);
      this.cachedModels = models;
      this.emit('models-changed', models.map(model => ({ ...model })));
      return models.map(model => ({ ...model }));
    } finally {
      request.dispose();
    }
  }

  public async *stream(input: AntigravityStreamInput): AsyncGenerator<string, void, unknown> {
    if (this.signedOut) throw new AntigravityError('auth_required', 'Sign in with Google Antigravity first.');
    const generation = this.generation;
    const token = await this.getAccessToken();
    this.assertGeneration(generation);
    if (!token) throw new AntigravityError('auth_required', this.lastError || 'Sign in with Google Antigravity first.');
    const projectId = this.cachedTokens?.projectId || this.loadFromStorage()?.projectId || '';
    const payload = buildAntigravityRequestPayload({ ...input, projectId });
    const request = this.registerRequest(input.signal);
    let streamTimedOut = false;
    const streamDeadline = setTimeout(() => { streamTimedOut = true; request.abort(); }, 60_000);
    (streamDeadline as any).unref?.();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const response = await this.authenticatedFetch(ANTIGRAVITY_STREAM_URL, {
        method: 'POST', headers: { Accept: 'text/event-stream', 'x-request-source': 'local' },
        body: JSON.stringify(payload), signal: request.signal,
      }, token, 4, ANTIGRAVITY_STREAM_TIMEOUT_MS);
      if (!response.ok) {
        const status = response.status;
        const message = status === 401
          ? 'Google access was rejected. Refresh the session or sign in again.'
          : status === 403
            ? 'This Google account is not permitted to use Antigravity.'
          : status === 429
            ? 'Google quota is exhausted or temporarily limited. Try again later.'
            : `Google request failed (HTTP ${status}).`;
        const error = new AntigravityError('request', message, status);
        throw error;
      }
      if (!response.body) throw new AntigravityError('response', 'Google returned an empty response.');

      // The Voice-app reference also accepts a single JSON Code Assist response.
      if (response.headers.get('content-type')?.includes('application/json')) {
        const text = parseAntigravityEvent(await response.text());
        this.assertGeneration(generation);
        if (!text) throw new AntigravityError('response', 'Google returned no answer.');
        yield text;
        return;
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let emitted = false;
      streamLoop: while (true) {
        const item = await reader.read();
        this.assertGeneration(generation);
        if (request.signal.aborted) throw new AntigravityError('cancelled', 'Google request cancelled.');
        buffer += item.done ? decoder.decode() : decoder.decode(item.value, { stream: true });
        const parsed = parseAntigravitySse(buffer, item.done);
        buffer = parsed.remainder;
        for (const data of parsed.events) {
          if (data === '[DONE]') break streamLoop;
          const text = parseAntigravityEvent(data);
          if (text) { emitted = true; yield text; }
        }
        if (item.done) break;
      }
      if (generation !== this.generation || this.signedOut) throw new AntigravityError('cancelled', 'Google request cancelled.');
      if (!emitted) throw new AntigravityError('response', 'Google returned no answer.');
    } catch (error) {
      if (error instanceof AntigravityError && error.code === 'auth_revoked') throw error;
      if (input.signal?.aborted || (request.signal.aborted && !streamTimedOut && this.generation !== generation)) {
        throw new AntigravityError('cancelled', 'Google request cancelled.');
      }
      if (streamTimedOut) throw new AntigravityError('request', 'Google request timed out.');
      throw this.normalizeError(error, 'Google returned malformed streaming data.');
    } finally {
      try { await reader?.cancel(); } catch { /* noop */ }
      try { reader?.releaseLock(); } catch { /* noop */ }
      clearTimeout(streamDeadline);
      request.dispose();
    }
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) throw new AntigravityError('cancelled', 'Google request cancelled.');
  }

  private normalizeError(error: unknown, fallback: string): AntigravityError {
    if (error instanceof AntigravityError) return error;
    if ((error as any)?.name === 'AbortError') return new AntigravityError('cancelled', 'Google request cancelled.');
    return new AntigravityError('request', fallback);
  }

  private registerRequest(externalSignal?: AbortSignal): {
    signal: AbortSignal;
    abort: () => void;
    dispose: () => void;
  } {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    this.requestControllers.add(controller);
    return {
      signal: controller.signal,
      abort: () => controller.abort(),
      dispose: () => {
        externalSignal?.removeEventListener('abort', forwardAbort);
        this.requestControllers.delete(controller);
      },
    };
  }

  private markSignedOut(message: string): void {
    this.generation += 1;
    this.signedOut = true;
    this.cachedTokens = null;
    this.cachedModels = null;
    this.stopRefreshTimer();
    for (const controller of this.requestControllers) controller.abort();
    this.lastError = message;
    this.clearStorage();
    this.emit('models-changed', []);
    this.emit('status-changed', this.getStatus());
  }

  private getCredentialsManager(): CredentialsManager {
    // CredentialsManager reads app.getPath at module load; LLMHelper is also
    // imported outside Electron, so defer that side effect until storage is used.
    return (require('./CredentialsManager') as typeof import('./CredentialsManager')).CredentialsManager.getInstance();
  }

  private loadFromStorage(): AntigravityOAuthTokens | null {
    return this.getCredentialsManager().getAntigravityOAuthTokens();
  }

  private saveToStorage(tokens: AntigravityOAuthTokens): boolean {
    return this.getCredentialsManager().setAntigravityOAuthTokens(tokens);
  }

  private clearStorage(): boolean {
    return this.getCredentialsManager().clearAntigravityOAuthTokens();
  }

  private scheduleRefresh(retryDelay?: number): void {
    this.stopRefreshTimer();
    const tokens = this.signedOut ? null : (this.cachedTokens || this.loadFromStorage());
    if (!tokens) return;
    const delay = retryDelay ?? Math.max(1_000, tokens.expiresAt - Date.now() - ANTIGRAVITY_REFRESH_LEAD_MS);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshTokens().catch(() => {
        // A temporary outage should get a few bounded retries, while a revoked
        // account is already cleared by refreshTokens(). Never create a hot loop.
        if (!this.signedOut && this.cachedTokens && this.backgroundRefreshFailures < 3) {
          this.backgroundRefreshFailures += 1;
          this.scheduleRefresh(Math.min(30_000 * (2 ** (this.backgroundRefreshFailures - 1)), 120_000));
        }
      });
    }, delay);
    (this.refreshTimer as any).unref?.();
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private async exchangeCode(code: string, verifier: string, signal: AbortSignal): Promise<Omit<AntigravityOAuthTokens, 'projectId'>> {
    let response: Response;
    try {
      response = await fetchWithDnsRetry(ANTIGRAVITY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': GOOGLE_API_USER_AGENT },
        body: new URLSearchParams({
          client_id: ANTIGRAVITY_CLIENT_ID,
          client_secret: ANTIGRAVITY_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: ANTIGRAVITY_REDIRECT_URI,
          code_verifier: verifier,
        }).toString(),
        signal,
      }, 4);
    } catch (error) { throw this.normalizeError(error, 'Google token exchange failed.'); }
    const bundle = await responseJson(response, 'token_exchange');
    if (typeof bundle?.access_token !== 'string' || !bundle.access_token) {
      throw new AntigravityError('token_exchange', 'Google token exchange returned no access token.');
    }
    if (typeof bundle.refresh_token !== 'string' || !bundle.refresh_token.trim()) {
      throw new AntigravityError('token_exchange', 'Google did not return a refresh token. Sign in again.');
    }
    const expiresIn = typeof bundle.expires_in === 'number' && Number.isFinite(bundle.expires_in)
      ? bundle.expires_in : 3600;
    if (expiresIn <= 0) throw new AntigravityError('token_exchange', 'Google returned an expired access token.');
    return {
      accessToken: bundle.access_token,
      refreshToken: bundle.refresh_token.trim(),
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }
}
