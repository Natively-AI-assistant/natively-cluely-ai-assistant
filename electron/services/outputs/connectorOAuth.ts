// Settings › Connectors › Connect, signed in with the service's own account
// instead of a pasted token: Slack, Notion, HubSpot, Salesforce and Attio.
//
// The client secrets cannot ship in an open-source app, so natively-api holds
// them (connectorOAuth.js there). The browser goes to natively-api, on to the
// provider's consent screen, back to natively-api, and from there to a loopback
// port this process opened (runLoopbackAuth, the helper Outlook Calendar uses).
// What reaches the loopback is a sealed blob, not the provider's code; it is
// redeemed with the PKCE verifier only this process holds, so a blob read off
// the URL is useless to anyone else.
//
// Tokens that expire (HubSpot, Salesforce, Notion when it issues a refresh
// token) are renewed through natively-api before use, and once more after an
// `auth` failure. A service natively-api has no client for reports
// not-configured, and Settings keeps the pasted-token form for it.

import { ConnectionError, describeConnectionError, errorKindOf, httpRequest, type FetchLike } from './httpRequest';
import type { ConnectionsStore, OAuthTokenService } from './connectionsStore';
import { isSlackWebhookUrl } from './slack';
import { normaliseSalesforceInstanceUrl } from './crm';
import { runLoopbackAuth } from '../calendar/providers/loopbackOAuth';
import type { ConnectorCallbackProvider } from '../oauth/callbackPage';
import type { OAuthConnectorService, OutputResult } from '../../../src/types/meetingOutputs';

export const OAUTH_CONNECTORS: readonly OAuthConnectorService[] = ['slack', 'notion', 'hubspot', 'salesforce', 'pipedrive', 'attio'];
export const isOAuthConnector = (v: unknown): v is OAuthConnectorService => typeof v === 'string' && (OAUTH_CONNECTORS as readonly string[]).includes(v);

const LABEL: Record<OAuthConnectorService, string> = { slack: 'Slack', notion: 'Notion', hubspot: 'HubSpot', salesforce: 'Salesforce', pipedrive: 'Pipedrive', attio: 'Attio' };

/** Renew this long before the provider's stated expiry, so a send never starts on a dying token. */
export const RENEW_MARGIN_MS = 2 * 60_000;
const SERVICES_CACHE_MS = 5 * 60_000;

export interface ConnectorOAuthDeps {
    apiBase: string;
    store: ConnectionsStore;
    fetchImpl?: FetchLike;
    now?: () => number;
}

// ── Which services sign in with the browser ─────────────────────────────

let servicesCache: { at: number; base: string; services: Record<OAuthConnectorService, boolean> } | null = null;
const NONE: Record<OAuthConnectorService, boolean> = { slack: false, notion: false, hubspot: false, salesforce: false, pipedrive: false, attio: false };

/** natively-api's answer, cached for five minutes. Unreachable means none: Settings shows the token forms. */
export async function oauthServices(deps: Pick<ConnectorOAuthDeps, 'apiBase' | 'fetchImpl' | 'now'>): Promise<Record<OAuthConnectorService, boolean>> {
    const now = deps.now?.() ?? Date.now();
    if (servicesCache && servicesCache.base === deps.apiBase && now - servicesCache.at < SERVICES_CACHE_MS) return servicesCache.services;
    try {
        const res = await httpRequest(`${deps.apiBase}/v1/connectors/oauth`, { fetchImpl: deps.fetchImpl, timeoutMs: 8_000 });
        const raw = res.data?.services || {};
        const services = Object.fromEntries(OAUTH_CONNECTORS.map((s) => [s, raw[s] === true])) as Record<OAuthConnectorService, boolean>;
        servicesCache = { at: now, base: deps.apiBase, services };
        return services;
    } catch {
        // Not cached, so the next open of Settings asks again.
        return { ...NONE };
    }
}

export function resetOAuthServicesCache(): void { servicesCache = null; }

// ── The server's answers ────────────────────────────────────────────────

interface Connection {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    instanceUrl?: string;
    account?: string;
    webhook?: { url?: string; channel?: string; team?: string };
}

/**
 * A ConnectionError's kind, recognised by name as well as by class: each file
 * is its own bundle in the test build, so `instanceof` alone misses an error
 * made by another file's copy of the class.
 */
function kindOf(err: unknown): ReturnType<typeof errorKindOf> {
    const e = err as { name?: unknown; kind?: unknown } | null;
    return e && e.name === 'ConnectionError' && typeof e.kind === 'string' ? e.kind as ReturnType<typeof errorKindOf> : errorKindOf(err);
}

/** The server's `error` field from a failed call, when its body was JSON. */
function serverError(err: unknown): string | undefined {
    const bodyStart = (err as { name?: unknown; bodyStart?: unknown } | null)?.name === 'ConnectionError' ? (err as { bodyStart?: unknown }).bodyStart : undefined;
    if (typeof bodyStart !== 'string' || !bodyStart) return undefined;
    try { return JSON.parse(bodyStart)?.error; } catch { return /"error"\s*:\s*"([a-z_]+)"/.exec(bodyStart)?.[1]; }
}

/** The sentence for a sign-in that did not finish, naming the service. */
export function signInFailure(service: OAuthConnectorService, err: unknown): string {
    const label = LABEL[service];
    if (err instanceof SignInError) return err.message;
    switch (serverError(err)) {
        case 'not_configured': return `Signing in with ${label} is not available right now. Use a token instead.`;
        case 'expired': return 'That sign-in took too long. Connect again.';
        case 'invalid_code':
        case 'invalid_verifier': return 'That sign-in belongs to a different attempt. Connect again.';
        case 'provider_error': return `${label} did not finish the sign-in. Connect again.`;
        case 'provider_unreachable': return `Could not reach ${label}. Try again in a minute.`;
        case 'rate_limited': return 'Too many sign-in attempts. Wait a few minutes and try again.';
        default: return describeConnectionError(kindOf(err), 'Natively');
    }
}

class SignInError extends Error {}

/** A Pipedrive company API host (`https://acme.pipedrive.com`), or null. */
export function pipedriveHost(raw: unknown): string | null {
    const s = String(raw ?? '').trim().replace(/\/+$/, '');
    return /^https:\/\/[a-z0-9-]+\.pipedrive\.com$/i.test(s) ? s.toLowerCase() : null;
}

/** Saves what a sign-in returned. Throws SignInError with the sentence to show. */
export function saveConnection(service: OAuthConnectorService, c: Connection, deps: Pick<ConnectorOAuthDeps, 'store' | 'now'>): void {
    const label = LABEL[service];
    const now = deps.now?.() ?? Date.now();
    if (service === 'slack') {
        const url = c.webhook?.url || '';
        if (!isSlackWebhookUrl(url)) throw new SignInError('Slack did not hand back a channel to post to. Connect again and pick a channel.');
        const channel = (c.webhook?.channel || 'Slack channel').trim();
        const name = c.webhook?.team ? `${channel} · ${c.webhook.team}` : channel;
        // The same channel twice (signed in again for it) is kept once, under its new webhook.
        const existing = deps.store.read().slack.webhooks.find((w) => w.label === name);
        if (existing) deps.store.removeSlackWebhook(existing.id);
        const added = deps.store.addSlackWebhook(name, url);
        if (!added) throw new SignInError('You have added as many Slack channels as Natively keeps. Remove one first.');
        return;
    }
    if (!c.accessToken) throw new SignInError(`${label} did not hand back access. Connect again.`);
    const grant = {
        token: c.accessToken,
        ...(c.refreshToken ? { refreshToken: c.refreshToken } : {}),
        ...(c.expiresIn ? { expiresAt: now + c.expiresIn * 1000 } : {}),
        ...(c.account ? { account: c.account } : {}),
    };
    if (service === 'pipedrive') {
        const instanceUrl = pipedriveHost(c.instanceUrl);
        if (!instanceUrl) throw new SignInError('Pipedrive did not say which company to use. Connect again.');
        deps.store.setOAuth('pipedrive', { ...grant, instanceUrl });
        return;
    }
    if (service === 'salesforce') {
        const instanceUrl = normaliseSalesforceInstanceUrl(c.instanceUrl);
        if (!instanceUrl) throw new SignInError('Salesforce did not say which org to use. Connect again.');
        deps.store.setOAuth('salesforce', { ...grant, instanceUrl });
        return;
    }
    deps.store.setOAuth(service, grant);
}

// ── Sign in ─────────────────────────────────────────────────────────────

export interface BrowserSignInDeps extends ConnectorOAuthDeps {
    openExternal(url: string): Promise<unknown> | unknown;
    platform: NodeJS.Platform;
    signal?: AbortSignal;
}

/** Runs the browser sign-in and saves the result. Resolves to the row's result. */
export async function connectWithBrowser(service: OAuthConnectorService, deps: BrowserSignInDeps): Promise<OutputResult> {
    const label = LABEL[service];
    try {
        await runLoopbackAuth({
            page: service as ConnectorCallbackProvider,
            platform: deps.platform,
            redirectHost: '127.0.0.1',
            label,
            signal: deps.signal,
            authUrl: (redirectUri, challenge, state) => `${deps.apiBase}/v1/connectors/oauth/${service}/start?${new URLSearchParams({
                return_to: `${redirectUri}/`, challenge, state,
            })}`,
            exchange: async (code, verifier) => {
                const res = await httpRequest(`${deps.apiBase}/v1/connectors/oauth/${service}/exchange`, {
                    method: 'POST', json: { code, verifier }, fetchImpl: deps.fetchImpl, timeoutMs: 20_000,
                });
                saveConnection(service, (res.data?.connection || {}) as Connection, deps);
            },
            openExternal: deps.openExternal,
            failureReason: (err) => signInFailure(service, err),
        });
    } catch (err: any) {
        if (deps.signal?.aborted) return { ok: false, kind: 'unknown', message: '' };
        return { ok: false, kind: 'auth', message: err?.message || `Could not connect ${label}. Try again.` };
    }
    const persisted = deps.store.isPersistent();
    return { ok: true, message: persisted ? `${label} is connected.` : describeConnectionError('storage_unavailable', label) };
}

// ── Fresh tokens ────────────────────────────────────────────────────────

const inFlight = new Map<OAuthTokenService, Promise<string | null>>();

/**
 * Renews through natively-api. Resolves to the new token, or null when it could
 * not (no refresh token, revoked, offline): the caller then uses what it has and
 * the provider's answer decides.
 */
export function renewToken(service: OAuthTokenService, deps: ConnectorOAuthDeps): Promise<string | null> {
    const running = inFlight.get(service);
    if (running) return running;
    const p = (async () => {
        const grant = deps.store.grant(service);
        if (!grant?.refreshToken) return null;
        try {
            const res = await httpRequest(`${deps.apiBase}/v1/connectors/oauth/${service}/refresh`, {
                method: 'POST', json: { refresh_token: grant.refreshToken }, fetchImpl: deps.fetchImpl, timeoutMs: 15_000,
            });
            const c = (res.data?.connection || {}) as Connection;
            if (!c.accessToken) return null;
            const now = deps.now?.() ?? Date.now();
            deps.store.setOAuth(service, {
                token: c.accessToken,
                ...(c.refreshToken ? { refreshToken: c.refreshToken } : {}),
                ...(c.expiresIn ? { expiresAt: now + c.expiresIn * 1000 } : {}),
                ...(service === 'salesforce' && normaliseSalesforceInstanceUrl(c.instanceUrl) ? { instanceUrl: normaliseSalesforceInstanceUrl(c.instanceUrl)! } : {}),
                ...(service === 'pipedrive' && pipedriveHost(c.instanceUrl) ? { instanceUrl: pipedriveHost(c.instanceUrl)! } : {}),
            }, { renewal: true });
            return c.accessToken;
        } catch {
            return null;
        }
    })().finally(() => inFlight.delete(service));
    inFlight.set(service, p);
    return p;
}

/** The token to use now: renewed first when a signed-in token is about to run out. */
export async function currentToken(service: OAuthTokenService, deps: ConnectorOAuthDeps): Promise<string | null> {
    const token = deps.store.token(service);
    if (!token) return null;
    const grant = deps.store.grant(service);
    const now = deps.now?.() ?? Date.now();
    if (grant?.refreshToken && grant.expiresAt && grant.expiresAt - RENEW_MARGIN_MS <= now) {
        return (await renewToken(service, deps)) ?? token;
    }
    return token;
}

/**
 * Runs `fn` with a current token. A signed-in token the provider refuses
 * (`auth`) is renewed once and the call tried again: Salesforce never says
 * when its sessions end, and any token can be cut short by an admin.
 */
export async function withCurrentToken<T>(service: OAuthTokenService, deps: ConnectorOAuthDeps, fn: (token: string) => Promise<T>): Promise<T> {
    const token = await currentToken(service, deps);
    if (!token) throw new ConnectionError('not_connected');
    try {
        return await fn(token);
    } catch (err) {
        if (kindOf(err) !== 'auth' || !deps.store.grant(service)?.refreshToken) throw err;
        const renewed = await renewToken(service, deps);
        if (!renewed || renewed === token) throw err;
        return fn(renewed);
    }
}

/** The `auth` sentence for a signed-in connection: connect again, not paste a token. */
export function reconnectMessage(service: OAuthConnectorService): string {
    return `${LABEL[service]} no longer accepts Natively's access. It may have been removed or expired. Connect it again in Settings, Connectors.`;
}
