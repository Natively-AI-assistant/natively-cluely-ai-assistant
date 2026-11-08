// Gmail in Settings › Connectors: recent threads with a meeting's attendees for
// the brief before it (gmail.readonly), and the follow-up sent from the user's
// own Gmail on press (gmail.send).
//
// Local-first like Calendar: Google is called straight from the main process
// with Calendar's Google client (CalendarManager.calendarOAuthClient), the
// installed-app loopback flow with PKCE (calendar/providers/loopbackOAuth),
// and the tokens live in userData/gmail_tokens.enc, encrypted with
// safeStorage (Keychain on macOS, DPAPI on Windows). Mail never passes
// through Natively's servers. Neither tokens nor mail content are logged.
//
// No platform branches: the only OS-shaped parts (the browser, the encrypted
// file, the callback page's close keys) come in through GmailDeps.

import { runLoopbackAuth } from '../calendar/providers/loopbackOAuth';
import { loadSecretJson, removeSecretFile, saveSecretJson } from '../calendar/providers/secureFile';
import type { ConnectionErrorKind } from '../../../src/types/meetingOutputs';
import type { GmailStatus } from '../../../src/types/connectors';
import type { FetchLike } from './httpRequest';

export const GMAIL_TOKEN_FILE = 'gmail_tokens.enc';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
/*
  Each scope has a use, which is what Google's verification checks:
    openid + email   the id_token that names the connected address
    gmail.readonly   threads with the attendees, for the brief before a meeting
    gmail.send       the follow-up, sent from the user's Gmail on press
*/
export const GMAIL_SCOPES = ['openid', 'email', GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE];
// Broader grants the same Google client may already hold cover the narrow ones.
const READ_COVERED_BY = new Set([GMAIL_READ_SCOPE, 'https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/']);
const SEND_COVERED_BY = new Set([GMAIL_SEND_SCOPE, 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/']);

/** Renew this long before the access token runs out. */
export const REFRESH_MARGIN_MS = 2 * 60_000;
const TOKEN_TIMEOUT_MS = 15_000;
const API_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
/** Token-endpoint errors that mean the stored grant is dead and connecting again is the only fix. */
const DEAD_GRANT_ERRORS = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client', 'deleted_client']);

export const MAX_RECIPIENTS = 50;
export const MAX_SUBJECT_CHARS = 400;
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_THREADS = 8;
const MAX_QUERY_PEOPLE = 20;

const RECONNECT = 'Gmail access has ended. Connect Gmail again in Settings, Connectors.';
const MISSING_SCOPES = 'Natively needs permission to read and send your email. Connect again and leave both Gmail boxes ticked.';

export class GmailError extends Error {
    constructor(public readonly kind: ConnectionErrorKind, message: string) {
        super(message);
        this.name = 'GmailError';
    }
}

/** What the encrypted file holds. */
export interface GmailTokenState {
    accessToken: string;
    refreshToken: string;
    /** ms since epoch. */
    expiresAt: number;
    account?: string;
    scopes: string[];
    briefsEnabled: boolean;
    connectedAt: number;
}

export interface GmailDeps {
    userDataDir: string;
    safeStorage: {
        isEncryptionAvailable(): boolean;
        encryptString(plain: string): Buffer;
        decryptString(encrypted: Buffer): string;
    };
    /** Calendar's Google client: empty id or secret means Gmail is unavailable in this build. */
    client(): { id: string; secret: string };
    openExternal(url: string): Promise<unknown> | unknown;
    platform: NodeJS.Platform;
    fetchImpl?: FetchLike;
    now?(): number;
    /**
     * True when another part of Natively (Google Calendar) holds a grant for
     * this Google account from the same client. Google revokes the combined
     * grant as a whole, so Disconnect then forgets the Gmail tokens here
     * without revoking, and Calendar keeps working.
     */
    grantShared?(account: string | undefined): boolean;
}

export interface GmailThread {
    threadId: string;
    subject: string;
    from: string;
    date: string;
    snippet: string;
    url: string;
}

// ── Pure helpers ─────────────────────────────────────────────────────────

/** Strict enough to keep a header or a search query from being bent by an address. */
const ADDRESS = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** The address, trimmed and lower-cased, or null when it is not a plain email address. */
export function normaliseAddress(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (!v || v.length > 254 || !ADDRESS.test(v)) return null;
    if (v.split('@')[0].length > 64 || v.includes('..')) return null;
    return v.toLowerCase();
}

/** The Gmail search for threads with any of these people within `sinceDays`. Null when no address is usable. */
export function buildThreadsQuery(emails: unknown, sinceDays = 90): string | null {
    const seen = new Set<string>();
    for (const e of Array.isArray(emails) ? emails : []) {
        const n = normaliseAddress(e);
        if (n) seen.add(n);
        if (seen.size >= MAX_QUERY_PEOPLE) break;
    }
    if (seen.size === 0) return null;
    const days = Math.min(365, Math.max(1, Math.floor(Number(sinceDays) || 90)));
    const terms = [...seen].flatMap((e) => [`from:${e}`, `to:${e}`]);
    return `(${terms.join(' OR ')}) newer_than:${days}d -in:chats`;
}

export function base64Url(value: Buffer | string): string {
    return (typeof value === 'string' ? Buffer.from(value, 'utf8') : value).toString('base64url');
}

/** A header value with no line breaks (header injection) and no control characters. */
function headerSafe(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

/** RFC 2047: plain when ASCII, otherwise UTF-8 B encoded words of at most 75 characters, folded. */
export function encodeHeaderWord(value: string): string {
    const clean = headerSafe(value);
    if (/^[\x20-\x7e]*$/.test(clean)) return clean;
    const words: string[] = [];
    let chunk = '';
    for (const ch of clean) {
        // 45 bytes encode to 60 base64 characters: "=?UTF-8?B?" + 60 + "?=" is 72.
        if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
            words.push(chunk);
            chunk = '';
        }
        chunk += ch;
    }
    if (chunk) words.push(chunk);
    return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/** The RFC 2822 message: UTF-8 plain text, base64 body in 76-character lines, CRLF throughout. */
export function buildMimeMessage(input: { to: string[]; subject: string; body: string }): string {
    const body = String(input.body).replace(/\r\n|\r|\n/g, '\r\n');
    const encoded = Buffer.from(body, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
    const headers = [
        `To: ${input.to.join(', ')}`,
        `Subject: ${encodeHeaderWord(input.subject)}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
    ];
    return `${headers.join('\r\n')}\r\n\r\n${encoded}`;
}

/** Checks a follow-up before anything is sent. Throws GmailError with a plain sentence. */
export function validateOutgoing(input: { to: unknown; subject: unknown; body: unknown }): { to: string[]; subject: string; body: string } {
    if (!Array.isArray(input.to) || input.to.length === 0) throw new GmailError('invalid_input', 'Add at least one recipient.');
    if (input.to.length > MAX_RECIPIENTS) throw new GmailError('invalid_input', `Gmail sends to at most ${MAX_RECIPIENTS} people at once from Natively.`);
    const to: string[] = [];
    for (const raw of input.to) {
        const n = normaliseAddress(raw);
        if (!n) throw new GmailError('invalid_input', `“${String(raw).slice(0, 80)}” is not an email address.`);
        if (!to.includes(n)) to.push(n);
    }
    const subject = typeof input.subject === 'string' ? headerSafe(input.subject) : '';
    if (!subject) throw new GmailError('invalid_input', 'Add a subject.');
    if (subject.length > MAX_SUBJECT_CHARS) throw new GmailError('invalid_input', 'The subject is too long.');
    const body = typeof input.body === 'string' ? input.body : '';
    if (!body.trim()) throw new GmailError('invalid_input', 'The email is empty.');
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new GmailError('too_large', 'This email is too long to send from Natively.');
    return { to, subject, body };
}

/** The address an id_token names. Not signature-checked: it comes straight from Google over TLS and only labels the row. */
export function emailFromIdToken(idToken: unknown): string | undefined {
    if (typeof idToken !== 'string') return undefined;
    try {
        const claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
        return typeof claims?.email === 'string' && claims.email.includes('@') ? claims.email : undefined;
    } catch {
        return undefined;
    }
}

/** True when the granted scopes cover both reading and sending. */
export function hasGmailScopes(scopes: string[]): boolean {
    return scopes.some((s) => READ_COVERED_BY.has(s)) && scopes.some((s) => SEND_COVERED_BY.has(s));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Gmail's snippets come HTML-escaped. */
export function decodeSnippet(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value
        .replace(/&#(\d+);/g, (_m, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
        .replace(/&#x([0-9a-f]+);/gi, (_m, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
        .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
        .replace(/\s+/g, ' ')
        .trim();
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export function gmailWebUrl(account: string | undefined, view: 'all' | 'sent', id: string): string {
    const who = account ? encodeURIComponent(account) : '0';
    return `https://mail.google.com/mail/u/${who}/#${view}/${encodeURIComponent(id)}`;
}

/** One thread from threads.get (format=metadata), as the brief reads it. */
export function parseThread(raw: any, account: string | undefined, fallbackSnippet?: string): GmailThread | null {
    const id = typeof raw?.id === 'string' ? raw.id : '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    const messages: any[] = Array.isArray(raw?.messages) ? raw.messages : [];
    const header = (m: any, name: string): string => {
        const hs: any[] = Array.isArray(m?.payload?.headers) ? m.payload.headers : [];
        const h = hs.find((x) => typeof x?.name === 'string' && x.name.toLowerCase() === name.toLowerCase());
        return typeof h?.value === 'string' ? headerSafe(h.value) : '';
    };
    const first = messages[0];
    const last = messages[messages.length - 1];
    const internal = Number(last?.internalDate);
    const date = Number.isFinite(internal) && internal > 0 ? new Date(internal).toISOString() : header(last, 'Date');
    return {
        threadId: id,
        subject: clip(header(first, 'Subject') || '(no subject)', 200),
        from: clip(header(last, 'From'), 200),
        date,
        snippet: clip(decodeSnippet(last?.snippet ?? fallbackSnippet ?? ''), 300),
        url: gmailWebUrl(account, 'all', id),
    };
}

// ── The service ──────────────────────────────────────────────────────────

class TokenEndpointError extends Error {
    constructor(public readonly status: number, public readonly code: string) {
        super(`token endpoint ${code}`);
        this.name = 'TokenEndpointError';
    }
}

interface GoogleResponse { status: number; ok: boolean; data: any }

export class GmailService {
    private state: GmailTokenState | null = null;
    private loaded = false;
    private refreshing: Promise<string> | null = null;

    constructor(private readonly deps: GmailDeps) {}

    private now(): number {
        return this.deps.now ? this.deps.now() : Date.now();
    }

    private fetch(): FetchLike {
        return this.deps.fetchImpl || (globalThis.fetch as unknown as FetchLike);
    }

    available(): boolean {
        try {
            const c = this.deps.client();
            return !!c?.id && !!c?.secret;
        } catch {
            return false;
        }
    }

    private load(): GmailTokenState | null {
        if (!this.loaded) {
            this.loaded = true;
            const saved = loadSecretJson<GmailTokenState>(this.deps, GMAIL_TOKEN_FILE);
            if (saved && typeof saved.refreshToken === 'string' && saved.refreshToken) {
                this.state = {
                    accessToken: typeof saved.accessToken === 'string' ? saved.accessToken : '',
                    refreshToken: saved.refreshToken,
                    expiresAt: Number(saved.expiresAt) || 0,
                    ...(typeof saved.account === 'string' ? { account: saved.account } : {}),
                    scopes: Array.isArray(saved.scopes) ? saved.scopes.filter((s) => typeof s === 'string') : [],
                    briefsEnabled: saved.briefsEnabled !== false,
                    connectedAt: Number(saved.connectedAt) || 0,
                };
            }
        }
        return this.state;
    }

    /** Saved encrypted; without encryption it lives for this session only, as Calendar's tokens do. */
    private save(next: GmailTokenState): void {
        this.state = next;
        this.loaded = true;
        try { saveSecretJson(this.deps, GMAIL_TOKEN_FILE, next); } catch (err: any) { console.warn('[Gmail] Could not save the connection:', err?.code || err?.name || 'error'); }
    }

    private forget(): void {
        this.state = null;
        this.loaded = true;
        this.refreshing = null;
        removeSecretFile(this.deps, GMAIL_TOKEN_FILE);
    }

    status(): GmailStatus {
        const s = this.load();
        return {
            available: this.available(),
            connected: !!s,
            ...(s?.account ? { account: s.account } : {}),
            briefsEnabled: !!s && s.briefsEnabled,
        };
    }

    setBriefsEnabled(enabled: boolean): GmailStatus {
        const s = this.load();
        if (s && s.briefsEnabled !== enabled) this.save({ ...s, briefsEnabled: enabled });
        return this.status();
    }

    /** The browser sign-in. Resolves once the tokens are saved; rejects with a plain sentence. */
    async connect(opts: { signal?: AbortSignal } = {}): Promise<{ account?: string }> {
        if (!this.available()) throw new GmailError('not_connected', 'Gmail is not available in this version of Natively.');
        const client = this.deps.client();
        let account: string | undefined;
        await runLoopbackAuth({
            page: 'gmail',
            platform: this.deps.platform,
            redirectHost: '127.0.0.1',
            label: 'Gmail',
            signal: opts.signal,
            openExternal: this.deps.openExternal,
            authUrl: (redirectUri, challenge, state) => {
                const params = new URLSearchParams({
                    client_id: client.id,
                    redirect_uri: redirectUri,
                    response_type: 'code',
                    scope: GMAIL_SCOPES.join(' '),
                    code_challenge: challenge,
                    code_challenge_method: 'S256',
                    state,
                    access_type: 'offline',
                    prompt: 'consent',
                    include_granted_scopes: 'true',
                });
                return `${GOOGLE_AUTH_URL}?${params.toString()}`;
            },
            exchange: async (code, verifier, redirectUri) => {
                const data = await this.tokenRequest({
                    grant_type: 'authorization_code',
                    code,
                    code_verifier: verifier,
                    redirect_uri: redirectUri,
                    client_id: client.id,
                    client_secret: client.secret,
                });
                const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : [];
                // People can untick either Gmail box on the consent screen. Half a
                // connection would fail later in a way that is hard to explain, so
                // nothing is kept.
                if (!hasGmailScopes(scopes)) throw new GmailError('forbidden', MISSING_SCOPES);
                if (typeof data.refresh_token !== 'string' || !data.refresh_token) {
                    throw new GmailError('auth', 'Google did not let Natively stay signed in. Connect again.');
                }
                account = emailFromIdToken(data.id_token) ?? await this.userInfoEmail(data.access_token);
                this.save({
                    accessToken: data.access_token,
                    refreshToken: data.refresh_token,
                    expiresAt: this.now() + (Number(data.expires_in) > 0 ? Number(data.expires_in) * 1000 : 3600_000),
                    ...(account ? { account } : {}),
                    scopes,
                    briefsEnabled: true,
                    connectedAt: this.now(),
                });
            },
            failureReason: (err) => (err instanceof GmailError ? err.message : 'Google did not finish the sign-in. Try connecting again.'),
        });
        console.log('[Gmail] Connected');
        return { ...(account ? { account } : {}) };
    }

    /** Revokes at Google (best effort, and not when Calendar shares the grant) and deletes the file. */
    async disconnect(): Promise<void> {
        const s = this.load();
        this.forget();
        if (!s) return;
        let shared = false;
        try { shared = !!this.deps.grantShared?.(s.account); } catch { shared = false; }
        if (shared) return;
        try {
            await this.fetch()(GOOGLE_REVOKE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token: s.refreshToken }).toString(),
                signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
            });
        } catch {
            // Offline: the tokens are gone from this computer either way.
        }
    }

    /** The access token, renewed first when it runs out within two minutes (or `force`). */
    async accessToken(force = false): Promise<string> {
        const s = this.load();
        if (!s) throw new GmailError('not_connected', 'Gmail is not connected. Connect it in Settings, Connectors.');
        if (!force && s.accessToken && s.expiresAt - REFRESH_MARGIN_MS > this.now()) return s.accessToken;
        if (!this.refreshing) {
            this.refreshing = this.refresh(s).finally(() => { this.refreshing = null; });
        }
        return this.refreshing;
    }

    private async refresh(s: GmailTokenState): Promise<string> {
        const client = this.deps.client();
        let data: any;
        try {
            data = await this.tokenRequest({
                grant_type: 'refresh_token',
                refresh_token: s.refreshToken,
                client_id: client.id,
                client_secret: client.secret,
            });
        } catch (err) {
            if (err instanceof TokenEndpointError && DEAD_GRANT_ERRORS.has(err.code)) {
                console.warn('[Gmail] The saved access was refused; disconnected');
                this.forget();
                throw new GmailError('auth', RECONNECT);
            }
            throw err instanceof GmailError ? err : new GmailError('network', 'Could not reach Google. Check your internet connection and try again.');
        }
        // A grant still alive may have lost a scope (the user removed it in their Google account).
        const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : s.scopes;
        // Disconnect (or a new sign-in) while the renewal was out: it no longer applies.
        const current = this.state;
        if (!current || current.refreshToken !== s.refreshToken) throw new GmailError('not_connected', 'Gmail is not connected. Connect it in Settings, Connectors.');
        const next: GmailTokenState = {
            ...current,
            accessToken: data.access_token,
            refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : current.refreshToken,
            expiresAt: this.now() + (Number(data.expires_in) > 0 ? Number(data.expires_in) * 1000 : 3600_000),
            scopes,
        };
        this.save(next);
        return next.accessToken;
    }

    private async tokenRequest(form: Record<string, string>): Promise<any> {
        let res: Awaited<ReturnType<FetchLike>>;
        try {
            res = await this.fetch()(GOOGLE_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: new URLSearchParams(form).toString(),
                signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
            });
        } catch {
            throw new GmailError('network', 'Could not reach Google. Check your internet connection and try again.');
        }
        let body: any = {};
        try { body = JSON.parse(await res.text()); } catch { body = {}; }
        if (!res.ok) {
            throw new TokenEndpointError(res.status, typeof body?.error === 'string' && body.error ? body.error : 'token_request_failed');
        }
        if (typeof body?.access_token !== 'string' || !body.access_token) throw new TokenEndpointError(res.status, 'token_request_failed');
        return body;
    }

    private async userInfoEmail(accessToken: string): Promise<string | undefined> {
        try {
            const res = await this.get(GOOGLE_USERINFO_URL, accessToken, 8_000);
            return res.ok && typeof res.data?.email === 'string' ? res.data.email : undefined;
        } catch {
            return undefined;
        }
    }

    private async get(url: string, token: string, timeoutMs: number, signal?: AbortSignal): Promise<GoogleResponse> {
        return this.request(url, { method: 'GET', token, timeoutMs, signal });
    }

    private async request(url: string, opts: { method: 'GET' | 'POST'; token: string; json?: unknown; timeoutMs: number; signal?: AbortSignal }): Promise<GoogleResponse> {
        const timeout = AbortSignal.timeout(opts.timeoutMs);
        const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
        let res: Awaited<ReturnType<FetchLike>>;
        try {
            res = await this.fetch()(url, {
                method: opts.method,
                headers: {
                    Authorization: `Bearer ${opts.token}`,
                    Accept: 'application/json',
                    ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(opts.json !== undefined ? { body: JSON.stringify(opts.json) } : {}),
                signal,
                redirect: 'error',
            });
        } catch {
            if (timeout.aborted) throw new GmailError('timeout', 'Gmail took too long to answer. Check your connection and try again.');
            throw new GmailError('network', 'Could not reach Gmail. Check your internet connection and try again.');
        }
        const text = await res.text().catch(() => '');
        if (text.length > MAX_RESPONSE_CHARS) throw new GmailError('too_large', 'Gmail sent back more than Natively reads.');
        let data: any;
        try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
        return { status: res.status, ok: res.ok, data };
    }

    /** A Gmail API call with the current token, renewed and retried once when Google refuses it. */
    private async api(path: string, opts: { method?: 'GET' | 'POST'; json?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<any> {
        const call = async (token: string) => this.request(`${GMAIL_API}${path}`, { method: opts.method ?? 'GET', token, json: opts.json, timeoutMs: opts.timeoutMs ?? API_TIMEOUT_MS, signal: opts.signal });
        let res = await call(await this.accessToken());
        if (res.status === 401) res = await call(await this.accessToken(true));
        if (res.ok) return res.data;
        throw gmailApiError(res);
    }

    /**
     * Recent threads with these people, for the brief before a meeting. Only
     * when the brief switch is on. At most `max` (8) thread reads.
     */
    async threadsWithPeople(emails: string[], opts: { sinceDays?: number; max?: number; signal?: AbortSignal; perRequestTimeoutMs?: number } = {}): Promise<GmailThread[]> {
        const s = this.load();
        if (!s || !s.briefsEnabled) return [];
        const q = buildThreadsQuery(emails, opts.sinceDays ?? 90);
        if (!q) return [];
        const max = Math.min(MAX_THREADS, Math.max(1, Math.floor(Number(opts.max) || MAX_THREADS)));
        const timeoutMs = opts.perRequestTimeoutMs ?? 6_000;
        const list = await this.api(`/threads?${new URLSearchParams({ q, maxResults: String(max) }).toString()}`, { timeoutMs, signal: opts.signal });
        const items: Array<{ id: string; snippet?: string }> = (Array.isArray(list?.threads) ? list.threads : [])
            .filter((t: any) => typeof t?.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(t.id))
            .slice(0, max);
        const meta = new URLSearchParams({ format: 'metadata' });
        for (const h of ['Subject', 'From', 'Date']) meta.append('metadataHeaders', h);
        const account = this.state?.account;
        const threads = await Promise.all(items.map(async (t) => {
            try {
                const raw = await this.api(`/threads/${encodeURIComponent(t.id)}?${meta.toString()}`, { timeoutMs, signal: opts.signal });
                return parseThread(raw, account, t.snippet);
            } catch (err) {
                if (err instanceof GmailError && err.kind === 'auth') throw err;
                return null;
            }
        }));
        return threads.filter((t): t is GmailThread => !!t).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    }

    /** Sends a plain-text email from the user's Gmail. Only on press. */
    async sendMessage(input: { to: unknown; subject: unknown; body: unknown }): Promise<{ id: string; threadId?: string; url: string }> {
        const ok = validateOutgoing(input);
        if (!this.load()) throw new GmailError('not_connected', 'Gmail is not connected. Connect it in Settings, Connectors.');
        const raw = base64Url(buildMimeMessage(ok));
        const data = await this.api('/messages/send', { method: 'POST', json: { raw }, timeoutMs: 20_000 });
        const id = typeof data?.id === 'string' ? data.id : '';
        if (!id) throw new GmailError('unknown', 'Gmail did not confirm the email was sent. Check your Sent folder before trying again.');
        const threadId = typeof data?.threadId === 'string' ? data.threadId : undefined;
        return { id, ...(threadId ? { threadId } : {}), url: gmailWebUrl(this.state?.account, 'sent', threadId || id) };
    }
}

/** A refused Gmail API call, worded. Google's reason picks between "not allowed" and "not switched on". */
export function gmailApiError(res: { status: number; data?: any }): GmailError {
    const err = res.data?.error;
    const reasons: string[] = [
        ...(Array.isArray(err?.errors) ? err.errors.map((e: any) => e?.reason) : []),
        ...(Array.isArray(err?.details) ? err.details.map((d: any) => d?.reason) : []),
        err?.status,
    ].filter((r): r is string => typeof r === 'string');
    const has = (...names: string[]) => reasons.some((r) => names.includes(r));
    if (res.status === 401) return new GmailError('auth', RECONNECT);
    if (res.status === 403 && has('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
        return new GmailError('forbidden', MISSING_SCOPES);
    }
    if (res.status === 403 && has('accessNotConfigured', 'SERVICE_DISABLED')) {
        return new GmailError('forbidden', 'Gmail is not switched on for Natively yet. Try again later.');
    }
    if (res.status === 429 || has('rateLimitExceeded', 'userRateLimitExceeded', 'RESOURCE_EXHAUSTED')) {
        return new GmailError('rate_limited', 'Gmail is asking Natively to slow down. Wait a minute and try again.');
    }
    if (res.status === 403) return new GmailError('forbidden', 'Gmail did not allow this. Check the account you connected.');
    if (res.status === 400) return new GmailError('invalid_input', 'Gmail did not accept this email. Check the recipients and try again.');
    if (res.status === 404) return new GmailError('not_found', 'Gmail could not find that.');
    if (res.status >= 500) return new GmailError('server', 'Gmail is having trouble right now. Try again in a few minutes.');
    return new GmailError('unknown', 'Something went wrong talking to Gmail. Try again.');
}
