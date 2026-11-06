// The local API that personal API keys open (Settings › Connectors › API keys):
// a small read-only JSON server for the user's own scripts. Natively keeps notes
// on this computer, so instead of Granola's cloud API this answers on
// http://127.0.0.1:<port>/v1, and only while at least one active key exists.
//
// Routes (GET only):
//   /v1/notes?limit=&cursor=      newest first; limit 1–100 (default 20)
//   /v1/notes/:id                 notes: summary Markdown, sections, action items, attendees
//   /v1/notes/:id/transcript      the transcript, one line per utterance
//   /v1/search?q=&limit=          meetings whose transcript mentions the words
//
// Safety, as the MCP server (mcpServer.ts): bound to 127.0.0.1 only (never a
// configurable host); a Host that is not loopback or any browser Origin is
// refused, so a web page cannot reach it by DNS rebinding; no CORS headers, so
// a page cannot read an answer either; every request needs
// "Authorization: Bearer nat_…" checked in constant time; nothing can be
// written. Keys and request contents are never logged.

import * as http from 'http';
import type { LocalApiStatus } from '../../../src/types/connectors';
import { buildNotesDocument, notesToMarkdown, plainTitle, type NotesDocument } from './notesDocument';
import { MCP_SCAN_MEETINGS, isLoopbackHost, randomMcpPort, type MeetingSource } from './mcpServer';
import { CONNECTORS_PRO_HTTP, checkAllowed } from './connectorAccess';

export const LOCAL_API_HOST = '127.0.0.1';
export const LOCAL_API_PREFIX = '/v1';
export const LOCAL_API_DEFAULT_LIMIT = 20;
export const LOCAL_API_MAX_LIMIT = 100;
export const LOCAL_API_SEARCH_DEFAULT_LIMIT = 10;
/** Transcript lines one answer carries at most. */
export const LOCAL_API_TRANSCRIPT_MAX_LINES = 50_000;
const SEARCH_MATCHES_PER_NOTE = 5;
/** New meetings that may land at the top between two page reads and still keep a cursor exact. */
const CURSOR_SLACK = 50;
const PORT_ATTEMPTS = 6;
/** The longest wait before re-checking for keys that ran out. */
const EXPIRY_RECHECK_MAX_MS = 6 * 3600 * 1000;

/** What the API reads. `attendeeCount` is an optional cheap count; without it the list reads each meeting on the page. */
export interface LocalApiSource extends MeetingSource {
    attendeeCount?(id: string): number;
}

export interface LocalApiOptions {
    port: number;
    /** True for an active personal API key. */
    verify: (rawKey: string) => boolean;
    source: LocalApiSource;
    selfName?: () => string | undefined;
    /** Called after a refused key, so the owner can stop the server when no active key remains. */
    onRefused?: () => void;
    /**
     * Connectors are Pro or trial (connectorAccess.ts), asked per request after
     * the key check. False answers 403 pro_required. Absent: always allowed.
     */
    allowed?: () => boolean;
}

export interface RunningLocalApi {
    port: number;
    close(): Promise<void>;
}

class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const NOT_FOUND_ROUTE = () => new ApiError(404, 'not_found', 'There is nothing at this address. The routes are /v1/notes, /v1/notes/{id}, /v1/notes/{id}/transcript and /v1/search.');
const NOT_FOUND_NOTE = () => new ApiError(404, 'not_found', 'No note has this id. It may have been deleted.');

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(Buffer.byteLength(text)),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
    });
    res.end(text);
}

const sendError = (res: http.ServerResponse, e: ApiError, headers: Record<string, string> = {}) => send(res, e.status, { error: e.code, message: e.message }, headers);

/** The key in "Authorization: Bearer <key>", or null. */
export function bearerKey(header: string | undefined): string | null {
    if (typeof header !== 'string') return null;
    const m = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
    return m ? m[1] : null;
}

function limitParam(raw: string | null, def: number): number {
    if (raw === null || raw === '') return def;
    if (!/^\d+$/.test(raw.trim())) throw new ApiError(400, 'invalid_request', '"limit" must be a whole number from 1 to 100.');
    return Math.max(1, Math.min(LOCAL_API_MAX_LIMIT, Number(raw)));
}

/** "30:00" or "1:02:03" in seconds; null when the meeting has no length saved. */
export function durationSeconds(raw: unknown): number | null {
    const parts = String(raw ?? '').trim().split(':');
    if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
    const n = parts.map(Number);
    const s = n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1];
    return s > 0 ? s : null;
}

// Cursors are opaque to callers: the last id of a page and its position.
function encodeCursor(id: string, offset: number): string {
    return Buffer.from(JSON.stringify({ i: id, o: offset }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): { id: string; offset: number } {
    try {
        const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        if (typeof v?.i === 'string' && v.i.length <= 200 && Number.isInteger(v?.o) && v.o >= 0 && v.o <= 1_000_000) return { id: v.i, offset: v.o };
    } catch { /* fall through */ }
    throw new ApiError(400, 'invalid_request', '"cursor" is not one this API gave out. Start again without it.');
}

function words(query: string): string[] {
    return query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 1).slice(0, 8);
}

function excerpt(text: string, term: string, width = 200): string {
    const i = text.toLowerCase().indexOf(term);
    if (i < 0) return text.slice(0, width);
    const start = Math.max(0, i - Math.floor(width / 3));
    return `${start > 0 ? '…' : ''}${text.slice(start, start + width).replace(/\s+/g, ' ').trim()}${start + width < text.length ? '…' : ''}`;
}

function attendeesOf(doc: NotesDocument): Array<{ name?: string; email?: string }> {
    if (doc.attendees.length) return doc.attendees.map((a) => ({ ...(a.name ? { name: a.name } : {}), email: a.email }));
    return doc.participants.map((name) => ({ name }));
}

// ── Routes ───────────────────────────────────────────────────────────────

interface RouteContext {
    source: LocalApiSource;
    selfName?: string;
}

function listNotes(ctx: RouteContext, params: URLSearchParams): unknown {
    const limit = limitParam(params.get('limit'), LOCAL_API_DEFAULT_LIMIT);
    const rawCursor = params.get('cursor');
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    const want = (cursor ? cursor.offset + CURSOR_SLACK : 0) + limit + 1;
    const all = ctx.source.listMeetings(want);
    let start = 0;
    if (cursor) {
        // The id first, so meetings added since the last page do not repeat; its position when it was deleted.
        const at = all.findIndex((m) => m.id === cursor.id);
        start = at >= 0 ? at + 1 : cursor.offset;
    }
    const page = all.slice(start, start + limit);
    const more = all.length > start + limit;
    const notes = page.map((m) => {
        let attendeeCount = 0;
        try {
            if (ctx.source.attendeeCount) attendeeCount = ctx.source.attendeeCount(m.id);
            else {
                const full = ctx.source.getMeeting(m.id);
                if (full) attendeeCount = attendeesOf(buildNotesDocument(full)).length;
            }
        } catch { attendeeCount = 0; }
        return { id: m.id, title: plainTitle(m.title), date: m.date, durationSeconds: durationSeconds(m.duration), attendeeCount };
    });
    const last = page[page.length - 1];
    return { notes, nextCursor: more && last ? encodeCursor(last.id, start + page.length) : null };
}

function loadNote(ctx: RouteContext, id: string): NotesDocument & { durationSeconds: number | null } {
    const m = ctx.source.getMeeting(id);
    if (!m) throw NOT_FOUND_NOTE();
    return { ...buildNotesDocument(m, { selfName: ctx.selfName }), durationSeconds: durationSeconds(m.duration) };
}

function getNote(ctx: RouteContext, id: string): unknown {
    const doc = loadNote(ctx, id);
    return {
        id: doc.meetingId,
        title: doc.title,
        date: doc.dateIso,
        durationSeconds: doc.durationSeconds,
        attendees: attendeesOf(doc),
        summaryMarkdown: notesToMarkdown(doc, { includeTitle: false }),
        sections: doc.sections.map((s) => ({ heading: s.heading, ...(s.paragraph ? { paragraph: s.paragraph } : {}), bullets: s.bullets })),
        actionItems: doc.actionItems.map((a) => ({ text: a.text, ...(a.owner ? { owner: a.owner } : {}), ...(a.deadline ? { deadline: a.deadline } : {}), done: a.done })),
        userNotes: doc.userNotes ?? null,
    };
}

function getTranscript(ctx: RouteContext, id: string): unknown {
    const doc = loadNote(ctx, id);
    const lines = doc.transcript.slice(0, LOCAL_API_TRANSCRIPT_MAX_LINES);
    return {
        id: doc.meetingId,
        title: doc.title,
        lines: lines.map((l) => ({ speaker: l.speaker, text: l.text, offsetMs: l.offsetMs })),
        truncated: doc.transcript.length > lines.length,
    };
}

function search(ctx: RouteContext, params: URLSearchParams): unknown {
    const q = (params.get('q') || '').slice(0, 500).trim();
    const ts = words(q);
    if (!ts.length) throw new ApiError(400, 'invalid_request', 'Add words to look for, like /v1/search?q=budget. Each word needs two or more letters.');
    const limit = limitParam(params.get('limit'), LOCAL_API_SEARCH_DEFAULT_LIMIT);
    const byId = new Map(ctx.source.listMeetings(MCP_SCAN_MEETINGS).map((m) => [m.id, m]));
    const hits = new Map<string, { score: number; matches: Array<{ speaker: string; text: string }> }>();
    for (const line of ctx.source.searchTranscript(ts, 2000)) {
        if (!byId.has(line.meetingId)) continue;
        const low = String(line.content || '').toLowerCase();
        const found = ts.filter((t) => low.includes(t));
        if (!found.length) continue;
        const h = hits.get(line.meetingId) || { score: 0, matches: [] };
        h.score += found.length;
        if (h.matches.length < SEARCH_MATCHES_PER_NOTE) {
            // The same speaker names the notes use ("Me" or the user's name, "Speaker 1", …).
            const speaker = buildNotesDocument({ id: line.meetingId, transcript: [{ speaker: line.speaker, text: 'x' }] }, { selfName: ctx.selfName }).transcript[0]?.speaker || 'Speaker';
            h.matches.push({ speaker, text: excerpt(String(line.content || ''), found[0]) });
        }
        hits.set(line.meetingId, h);
    }
    const results = [...hits.entries()]
        .sort((a, b) => b[1].score - a[1].score || Date.parse(byId.get(b[0])!.date) - Date.parse(byId.get(a[0])!.date))
        .slice(0, limit)
        .map(([id, h]) => ({ id, title: plainTitle(byId.get(id)!.title), date: byId.get(id)!.date, matches: h.matches }));
    return { query: q, results };
}

/** Routes an authorised GET. Throws ApiError for a bad request or an unknown address. */
export function routeLocalApi(pathname: string, params: URLSearchParams, ctx: RouteContext): unknown {
    const p = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    if (p === `${LOCAL_API_PREFIX}/notes`) return listNotes(ctx, params);
    if (p === `${LOCAL_API_PREFIX}/search`) return search(ctx, params);
    const m = /^\/v1\/notes\/([^/]+)(\/transcript)?$/.exec(p);
    if (m) {
        let id: string;
        try { id = decodeURIComponent(m[1]); } catch { throw NOT_FOUND_NOTE(); }
        if (!id || id.length > 200) throw NOT_FOUND_NOTE();
        return m[2] ? getTranscript(ctx, id) : getNote(ctx, id);
    }
    throw NOT_FOUND_ROUTE();
}

// ── HTTP ─────────────────────────────────────────────────────────────────

export function createLocalApiListener(opts: LocalApiOptions & { boundPort: () => number }): http.RequestListener {
    return (req, res) => {
        // Bodies are never read; a request that sends one is answered, then its connection dropped.
        const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined;
        const closeAfter: Record<string, string> = hasBody ? { Connection: 'close' } : {};
        if (hasBody) res.on('finish', () => req.destroy());
        else req.resume();

        const port = opts.boundPort();
        // Any Origin is refused, loopback ones too: only a browser sends one, and no web page should read notes.
        if (!isLoopbackHost(req.headers.host, port) || req.headers.origin !== undefined) {
            return sendError(res, new ApiError(403, 'forbidden', 'This API answers only programs on this computer, not web pages.'), closeAfter);
        }
        const key = bearerKey(req.headers.authorization);
        if (!key || !opts.verify(key)) {
            try { opts.onRefused?.(); } catch { /* never affects the answer */ }
            return sendError(res, new ApiError(401, 'unauthorized', 'Send an active personal API key as "Authorization: Bearer nat_…". Make one in Natively, Settings, Connectors, API keys.'), { 'WWW-Authenticate': 'Bearer', ...closeAfter });
        }
        if (opts.allowed && !checkAllowed(opts.allowed)) {
            return sendError(res, new ApiError(CONNECTORS_PRO_HTTP.status, CONNECTORS_PRO_HTTP.code, CONNECTORS_PRO_HTTP.message), closeAfter);
        }
        if (req.method !== 'GET') {
            return sendError(res, new ApiError(405, 'method_not_allowed', 'This API only reads. Use GET.'), { Allow: 'GET', ...closeAfter });
        }
        let url: URL;
        try { url = new URL(req.url || '/', `http://${LOCAL_API_HOST}:${port}`); } catch { return sendError(res, NOT_FOUND_ROUTE(), closeAfter); }
        try {
            return send(res, 200, routeLocalApi(url.pathname, url.searchParams, { source: opts.source, selfName: opts.selfName?.() }), closeAfter);
        } catch (err) {
            if (err instanceof ApiError) return sendError(res, err, closeAfter);
            return sendError(res, new ApiError(500, 'server_error', 'Your notes could not be read just now. Try again in a moment.'), closeAfter);
        }
    };
}

/**
 * Starts the server on 127.0.0.1:`port`. Rejects with the listen error
 * (EADDRINUSE when the port is taken, EACCES for a port Windows reserves), so
 * the caller can pick another. The server never keeps the app alive, and
 * close() drops open connections, so quitting is never held up on either system.
 */
export function startLocalApiServer(opts: LocalApiOptions): Promise<RunningLocalApi> {
    return new Promise((resolve, reject) => {
        let bound = opts.port;
        const server = http.createServer(createLocalApiListener({ ...opts, boundPort: () => bound }));
        server.requestTimeout = 30_000;
        server.headersTimeout = 10_000;
        server.keepAliveTimeout = 5_000;
        server.maxHeadersCount = 50;
        const onError = (err: Error) => { server.removeListener('listening', onListening); reject(err); };
        const onListening = () => {
            server.removeListener('error', onError);
            const addr = server.address();
            bound = typeof addr === 'object' && addr ? addr.port : opts.port;
            server.unref();
            server.on('error', (err) => console.warn('[LocalApi] server error:', (err as any)?.code || 'unknown'));
            resolve({
                port: bound,
                close: () => new Promise<void>((done) => {
                    try { server.closeAllConnections(); } catch { /* older runtimes */ }
                    server.close(() => done());
                }),
            });
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ host: LOCAL_API_HOST, port: opts.port, exclusive: true });
    });
}

export function localApiBaseUrl(port: number): string {
    return `http://${LOCAL_API_HOST}:${port}${LOCAL_API_PREFIX}`;
}

// ── Lifecycle ────────────────────────────────────────────────────────────

/** The parts of ApiKeyStore the server needs. */
export interface LocalApiKeys {
    hasActiveKeys(): boolean;
    verify(rawKey: string): boolean;
    nextExpiry(): number | null;
    port(): number | undefined;
    setPort(port: number): void;
}

export interface LocalApiControllerDeps {
    keys: LocalApiKeys;
    source: LocalApiSource;
    selfName?: () => string | undefined;
    /** Pro or trial, passed to the server (LocalApiOptions.allowed). */
    allowed?: () => boolean;
    /** A port in 49152–65535; tests pass their own. */
    randomPort?: () => number;
    now?: () => number;
}

/**
 * Runs the server exactly while at least one active key exists: sync() starts
 * it when a key is made and stops it when the last one is revoked or runs out.
 * Calls are queued, so a create and a revoke pressed together cannot race.
 */
export class LocalApiController {
    private server: RunningLocalApi | null = null;
    private error: string | undefined;
    private queue: Promise<void> = Promise.resolve();
    private expiryTimer: ReturnType<typeof setTimeout> | null = null;
    private stopped = false;

    constructor(private readonly deps: LocalApiControllerDeps) {}

    status(): LocalApiStatus {
        if (this.server) return { running: true, baseUrl: localApiBaseUrl(this.server.port) };
        return { running: false, ...(this.error && this.deps.keys.hasActiveKeys() ? { error: this.error } : {}) };
    }

    /** At launch, or again after stop(): from now on the server follows the keys. */
    start(): Promise<void> {
        this.stopped = false;
        return this.sync();
    }

    /** Starts or stops the server to match the keys (does nothing after stop()). Never throws. */
    sync(): Promise<void> {
        this.queue = this.queue.then(() => this.syncNow()).catch(() => {});
        return this.queue;
    }

    /** At quit (both systems): stop listening and drop open connections. Never blocks the quit for long. */
    stop(): Promise<void> {
        this.stopped = true;
        this.queue = this.queue.then(() => this.close()).catch(() => {});
        return this.queue;
    }

    private async syncNow(): Promise<void> {
        if (this.stopped) return;
        const want = this.deps.keys.hasActiveKeys();
        if (!want) { this.error = undefined; await this.close(); return; }
        if (!this.server) await this.open();
        this.scheduleExpiryCheck();
    }

    private async open(): Promise<void> {
        const random = this.deps.randomPort ?? (() => randomMcpPort());
        const saved = this.deps.keys.port();
        const tried = new Set<number>();
        let candidate = saved || random();
        for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
            tried.add(candidate);
            try {
                this.server = await startLocalApiServer({
                    port: candidate,
                    verify: (k) => this.deps.keys.verify(k),
                    source: this.deps.source,
                    selfName: this.deps.selfName,
                    ...(this.deps.allowed ? { allowed: this.deps.allowed } : {}),
                    onRefused: () => { if (!this.deps.keys.hasActiveKeys()) void this.sync(); },
                });
                this.error = undefined;
                if (this.server.port !== saved) this.deps.keys.setPort(this.server.port);
                console.log('[LocalApi] Listening on loopback');
                return;
            } catch (err: any) {
                if (err?.code !== 'EADDRINUSE' && err?.code !== 'EACCES') {
                    this.error = 'The local API could not start. Quit Natively and open it again.';
                    return;
                }
                let guard = 0;
                do { candidate = random(); guard += 1; } while (tried.has(candidate) && guard < 100);
            }
        }
        this.error = 'The local API could not find a free port. Try again in a moment.';
    }

    private async close(): Promise<void> {
        if (this.expiryTimer) { clearTimeout(this.expiryTimer); this.expiryTimer = null; }
        const s = this.server;
        this.server = null;
        if (s) {
            await s.close().catch(() => {});
            console.log('[LocalApi] Stopped');
        }
    }

    /** Re-checks when the soonest key runs out, so the server stops with the last one. */
    private scheduleExpiryCheck(): void {
        if (this.expiryTimer) { clearTimeout(this.expiryTimer); this.expiryTimer = null; }
        if (!this.server) return;
        const next = this.deps.keys.nextExpiry();
        if (next === null) return;
        const wait = Math.max(1000, Math.min(EXPIRY_RECHECK_MAX_MS, next - (this.deps.now ?? Date.now)() + 1000));
        this.expiryTimer = setTimeout(() => { this.expiryTimer = null; void this.sync(); }, wait);
        this.expiryTimer.unref?.();
    }
}
