// A local, read-only MCP server so Claude Desktop, Cursor or Claude Code can read
// the user's meetings. Off by default; the user turns it on in Settings,
// Connectors.
//
// Transport: MCP "Streamable HTTP", the plain-JSON form. Every request is a
// POST of one JSON-RPC message to /mcp and is answered with one JSON response
// (or 202 for a notification). The server never opens an event stream, so a
// GET is refused with 405, which the spec allows. Written here rather than with
// @modelcontextprotocol/sdk, which this project does not depend on: the read-only
// surface is four tools over initialize, tools/list and tools/call.
//
// Safety: bound to 127.0.0.1 only (never a configurable host), every request
// needs the bearer token shown in Settings (compared in constant time), a
// browser-sent Origin or a Host that is not loopback is refused (DNS
// rebinding), bodies are capped, and no tool can write anything.

import * as http from 'http';
import * as crypto from 'crypto';
import { buildNotesDocument, formatOffset, notesToMarkdown, plainTitle, type MeetingLike } from './notesDocument';
import { CONNECTORS_PRO_HTTP, checkAllowed } from './connectorAccess';

export const MCP_HOST = '127.0.0.1';
export const MCP_PATH = '/mcp';
export const MCP_MAX_BODY_BYTES = 1024 * 1024;
export const MCP_SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const MCP_DEFAULT_VERSION = '2025-06-18';
const TRANSCRIPT_MAX_CHARS = 200_000;
/** Meetings a list or search looks through, newest first. Bounded: the read is synchronous in the main process. */
export const MCP_SCAN_MEETINGS = 1000;
const NOTES_MAX_CHARS = 100_000;

export interface MeetingListItem { id: string; title: string; date: string; duration?: string; notesText?: string }

/** What the server reads. DatabaseManager backs it in the app; tests pass a fake. */
export interface MeetingSource {
    /** Newest first. */
    listMeetings(limit: number): MeetingListItem[];
    getMeeting(id: string): MeetingLike | null;
    searchTranscript(terms: string[], limit: number): Array<{ meetingId: string; speaker: string; content: string; timestampMs: number }>;
}

// ── Tools ────────────────────────────────────────────────────────────────

export const MCP_TOOLS = [
    {
        name: 'list_meetings',
        title: 'List meetings',
        description: 'List meetings recorded in Natively, newest first. Optionally limit to a date range and to meetings whose title or notes contain a word or phrase.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Earliest meeting date, ISO 8601 (e.g. 2026-10-01).' },
                to: { type: 'string', description: 'Latest meeting date, ISO 8601. A date alone includes that whole day.' },
                query: { type: 'string', description: 'Only meetings whose title or notes contain this text.' },
                limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Most meetings to return (default 20).' },
            },
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
        name: 'get_meeting_notes',
        title: 'Get meeting notes',
        description: 'The notes of one meeting as Markdown: summary, sections and action items, with its date and attendees.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Meeting id from list_meetings or search_meetings.' } },
            required: ['id'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
        name: 'get_transcript',
        title: 'Get meeting transcript',
        description: 'The transcript of one meeting, one line per utterance with its time from the start. Optionally only part of it, in seconds from the start.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Meeting id.' },
                from_seconds: { type: 'number', minimum: 0, description: 'Start of the range, in seconds from the start of the meeting.' },
                to_seconds: { type: 'number', minimum: 0, description: 'End of the range, in seconds from the start of the meeting.' },
            },
            required: ['id'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
        name: 'search_meetings',
        title: 'Search meetings',
        description: 'Find meetings whose title, notes or transcript mention the given words. Returns matching meetings with short excerpts.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Words to look for.' },
                limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Most meetings to return (default 10).' },
            },
            required: ['query'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
] as const;

class ToolInputError extends Error {}

function str(v: unknown, name: string, required = false): string | undefined {
    if (v === undefined || v === null || v === '') {
        if (required) throw new ToolInputError(`"${name}" is required.`);
        return undefined;
    }
    if (typeof v !== 'string') throw new ToolInputError(`"${name}" must be a string.`);
    return v.slice(0, 500);
}

function int(v: unknown, name: string, def: number, max: number): number {
    if (v === undefined || v === null) return def;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ToolInputError(`"${name}" must be a number.`);
    return Math.max(1, Math.min(max, Math.floor(n)));
}

/** A date bound in ms; a date with no time covers its whole day at `to`. */
export function parseDateBound(v: string | undefined, end: boolean): number | undefined {
    if (!v) return undefined;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) throw new ToolInputError(`"${v}" is not a date. Use ISO 8601, like 2026-10-01.`);
    return dateOnly && end ? ms + 24 * 3600 * 1000 - 1 : ms;
}

function terms(query: string): string[] {
    return query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 1).slice(0, 8);
}

function excerpt(text: string, term: string, width = 160): string {
    const i = text.toLowerCase().indexOf(term);
    if (i < 0) return text.slice(0, width);
    const start = Math.max(0, i - Math.floor(width / 3));
    return `${start > 0 ? '…' : ''}${text.slice(start, start + width).replace(/\s+/g, ' ').trim()}${start + width < text.length ? '…' : ''}`;
}

export function runTool(source: MeetingSource, name: string, args: Record<string, unknown>, selfName?: string): string {
    if (name === 'list_meetings') {
        const from = parseDateBound(str(args.from, 'from'), false);
        const to = parseDateBound(str(args.to, 'to'), true);
        const q = str(args.query, 'query')?.toLowerCase().trim();
        const limit = int(args.limit, 'limit', 20, 100);
        const out: Array<{ id: string; title: string; date: string; duration?: string }> = [];
        for (const m of source.listMeetings(MCP_SCAN_MEETINGS)) {
            const t = Date.parse(m.date);
            if (from !== undefined && !(t >= from)) continue;
            if (to !== undefined && !(t <= to)) continue;
            if (q && !(`${m.title}\n${m.notesText || ''}`.toLowerCase().includes(q))) continue;
            out.push({ id: m.id, title: plainTitle(m.title), date: m.date, ...(m.duration ? { duration: m.duration } : {}) });
            if (out.length >= limit) break;
        }
        return JSON.stringify({ meetings: out, count: out.length }, null, 2);
    }
    if (name === 'get_meeting_notes') {
        const id = str(args.id, 'id', true)!;
        const m = source.getMeeting(id);
        if (!m) throw new ToolInputError(`No meeting has the id "${id}".`);
        const doc = buildNotesDocument(m, { selfName });
        const people = doc.attendees.length ? doc.attendees.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)) : doc.participants;
        const head = `Meeting id: ${doc.meetingId}\nDate: ${doc.dateIso}${people.length ? `\nAttendees: ${people.join(', ')}` : ''}`;
        const body = notesToMarkdown(doc);
        const notes = body.trim() ? body : `# ${doc.title}\n\nThis meeting has no notes yet.`;
        return `${head}\n\n${notes}${doc.userNotes ? `\n\n## The user's own notes\n${doc.userNotes}` : ''}`.slice(0, NOTES_MAX_CHARS);
    }
    if (name === 'get_transcript') {
        const id = str(args.id, 'id', true)!;
        const m = source.getMeeting(id);
        if (!m) throw new ToolInputError(`No meeting has the id "${id}".`);
        const fromS = args.from_seconds === undefined ? undefined : Number(args.from_seconds);
        const toS = args.to_seconds === undefined ? undefined : Number(args.to_seconds);
        if ((fromS !== undefined && !Number.isFinite(fromS)) || (toS !== undefined && !Number.isFinite(toS))) {
            throw new ToolInputError('"from_seconds" and "to_seconds" must be numbers.');
        }
        const doc = buildNotesDocument(m, { selfName });
        const lines = doc.transcript.filter((l) => (fromS === undefined || l.offsetMs >= fromS * 1000) && (toS === undefined || l.offsetMs <= toS * 1000));
        if (!lines.length) return doc.transcript.length ? 'No transcript lines fall in that time range.' : 'This meeting has no transcript.';
        let text = '';
        for (const l of lines) {
            const line = `[${formatOffset(l.offsetMs)}] ${l.speaker}: ${l.text}\n`;
            if (text.length + line.length > TRANSCRIPT_MAX_CHARS) { text += '[Transcript cut short here. Ask for a later time range for the rest.]\n'; break; }
            text += line;
        }
        return `${doc.title}\n\n${text}`.trimEnd();
    }
    if (name === 'search_meetings') {
        const query = str(args.query, 'query', true)!;
        const limit = int(args.limit, 'limit', 10, 50);
        const ts = terms(query);
        if (!ts.length) throw new ToolInputError('"query" needs at least one word of two or more letters.');
        const all = source.listMeetings(MCP_SCAN_MEETINGS);
        const byId = new Map(all.map((m) => [m.id, m]));
        const hits = new Map<string, { score: number; excerpts: string[] }>();
        const hit = (id: string, score: number, ex?: string) => {
            if (!byId.has(id)) return;
            const h = hits.get(id) || { score: 0, excerpts: [] };
            h.score += score;
            if (ex && h.excerpts.length < 3) h.excerpts.push(ex);
            hits.set(id, h);
        };
        for (const m of all) {
            const hay = `${m.title}\n${m.notesText || ''}`;
            const low = hay.toLowerCase();
            const found = ts.filter((t) => low.includes(t));
            if (found.length) hit(m.id, found.length * 3 + (m.title.toLowerCase().includes(ts[0]) ? 2 : 0), excerpt(hay, found[0]));
        }
        for (const line of source.searchTranscript(ts, 2000)) {
            hit(line.meetingId, 1, `${line.speaker}: ${excerpt(line.content, ts.find((t) => line.content.toLowerCase().includes(t)) || ts[0])}`);
        }
        const ranked = [...hits.entries()]
            .sort((a, b) => b[1].score - a[1].score || Date.parse(byId.get(b[0])!.date) - Date.parse(byId.get(a[0])!.date))
            .slice(0, limit)
            .map(([id, h]) => ({ id, title: plainTitle(byId.get(id)!.title), date: byId.get(id)!.date, excerpts: h.excerpts }));
        return JSON.stringify({ meetings: ranked, count: ranked.length }, null, 2);
    }
    throw new ToolInputError(`There is no tool named "${name}".`);
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: unknown;
    error?: { code: number; message: string };
}

export const RPC = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 } as const;

const rpcError = (id: JsonRpcResponse['id'], code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * One JSON-RPC message in, one response out; null for a notification or a
 * client's response (the transport answers those with 202).
 */
export function handleMcpMessage(
    msg: unknown,
    source: MeetingSource,
    info: { version: string; selfName?: string },
): JsonRpcResponse | null {
    if (Array.isArray(msg)) return rpcError(null, RPC.INVALID_REQUEST, 'Batches are not supported.');
    if (!msg || typeof msg !== 'object' || (msg as any).jsonrpc !== '2.0') return rpcError(null, RPC.INVALID_REQUEST, 'Not a JSON-RPC 2.0 message.');
    const m = msg as { id?: unknown; method?: unknown; params?: any };
    const hasId = typeof m.id === 'string' || typeof m.id === 'number';
    if (typeof m.method !== 'string') return hasId ? rpcError(m.id as any, RPC.INVALID_REQUEST, 'Missing method.') : null;
    if (!hasId) return null; // notifications/initialized, notifications/cancelled, …
    const id = m.id as string | number;

    switch (m.method) {
        case 'initialize': {
            const asked = typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : '';
            const protocolVersion = (MCP_SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_DEFAULT_VERSION;
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion,
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: 'natively', title: 'Natively meetings', version: info.version },
                    instructions: 'Read-only access to the meetings recorded in Natively on this computer: list and search them, read their notes and transcripts. Nothing can be changed through this server.',
                },
            };
        }
        case 'ping':
            return { jsonrpc: '2.0', id, result: {} };
        case 'tools/list':
            return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
        case 'tools/call': {
            const name = m.params?.name;
            const args = m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {};
            if (typeof name !== 'string' || !MCP_TOOLS.some((t) => t.name === name)) {
                return rpcError(id, RPC.INVALID_PARAMS, `Unknown tool: ${String(name)}`);
            }
            try {
                const text = runTool(source, name, args, info.selfName);
                return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: false } };
            } catch (err) {
                // A bad argument is the tool's answer, so the model can correct itself.
                const message = err instanceof ToolInputError ? err.message : 'The meeting could not be read.';
                return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: message }], isError: true } };
            }
        }
        default:
            return rpcError(id, RPC.METHOD_NOT_FOUND, `Method not found: ${m.method}`);
    }
}

// ── HTTP transport ───────────────────────────────────────────────────────

/** Constant-time check of "Authorization: Bearer <token>". */
export function bearerMatches(header: string | undefined, token: string): boolean {
    if (!token || typeof header !== 'string') return false;
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!m) return false;
    const a = crypto.createHash('sha256').update(m[1]).digest();
    const b = crypto.createHash('sha256').update(token).digest();
    return crypto.timingSafeEqual(a, b);
}

/** A Host or Origin naming this machine's loopback, so a web page cannot reach the server by DNS rebinding. */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
    if (!host) return false;
    return host === `${MCP_HOST}:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
    if (origin === undefined) return true; // desktop clients send none
    try {
        const u = new URL(origin);
        return (u.protocol === 'http:' || u.protocol === 'https:') && isLoopbackHost(u.host, port);
    } catch {
        return false;
    }
}

export function newMcpToken(): string {
    return crypto.randomBytes(32).toString('base64url');
}

/** A port in the dynamic range, chosen once and kept, so the pasted config keeps working. */
export function randomMcpPort(random: () => number = Math.random): number {
    return 49152 + Math.floor(random() * (65535 - 49152));
}

export interface RunningMcpServer {
    port: number;
    close(): Promise<void>;
}

export interface McpServerOptions {
    port: number;
    token: () => string;
    /**
     * Connectors are Pro or trial (connectorAccess.ts), asked per request after
     * the token check. False answers 403 pro_required. Absent: always allowed
     * (this transport alone; outputsIpc passes the real gate).
     */
    allowed?: () => boolean;
    source: MeetingSource;
    version: string;
    selfName?: () => string | undefined;
}

function send(res: http.ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'Cache-Control': 'no-store',
        ...headers,
    });
    res.end(text);
}

export function createMcpRequestListener(opts: McpServerOptions & { boundPort: () => number }): http.RequestListener {
    return (req, res) => {
        const port = opts.boundPort();
        const url = (req.url || '').split('?')[0];
        if (url !== MCP_PATH) return send(res, 404, { error: 'Not found' });
        if (!isLoopbackHost(req.headers.host, port) || !isAllowedOrigin(req.headers.origin, port)) {
            return send(res, 403, { error: 'Forbidden' });
        }
        if (!bearerMatches(req.headers.authorization, opts.token())) {
            return send(res, 401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
        }
        if (opts.allowed && !checkAllowed(opts.allowed)) {
            return send(res, CONNECTORS_PRO_HTTP.status, { error: CONNECTORS_PRO_HTTP.message, code: CONNECTORS_PRO_HTTP.code });
        }
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
        if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
            return send(res, 415, { error: 'Send application/json' });
        }
        // Too large: answer, then drop the connection (marked close, so no client reuses it).
        const refuseTooLarge = () => {
            res.on('finish', () => req.destroy());
            send(res, 413, { error: 'Too large' }, { Connection: 'close' });
        };
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > MCP_MAX_BODY_BYTES) return refuseTooLarge();

        const chunks: Buffer[] = [];
        let total = 0;
        let aborted = false;
        req.on('data', (chunk: Buffer) => {
            if (aborted) return;
            total += chunk.length;
            if (total > MCP_MAX_BODY_BYTES) {
                aborted = true;
                refuseTooLarge();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (aborted) return;
            let msg: unknown;
            try {
                msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
                return send(res, 400, rpcError(null, RPC.PARSE, 'Parse error'));
            }
            let reply: JsonRpcResponse | null;
            try {
                reply = handleMcpMessage(msg, opts.source, { version: opts.version, selfName: opts.selfName?.() });
            } catch {
                reply = rpcError((msg as any)?.id ?? null, RPC.INTERNAL, 'Internal error');
            }
            if (reply === null) return send(res, 202);
            return send(res, 200, reply);
        });
        req.on('error', () => { aborted = true; });
    };
}

/**
 * Starts the server on 127.0.0.1:`port`. Rejects with the listen error
 * (EADDRINUSE when the port is taken), so the caller can pick another.
 * The server never keeps the app alive, and close() drops open connections,
 * so quitting is never held up by a connected client on either system.
 */
export function startMcpServer(opts: McpServerOptions): Promise<RunningMcpServer> {
    return new Promise((resolve, reject) => {
        let bound = opts.port;
        const server = http.createServer(createMcpRequestListener({ ...opts, boundPort: () => bound }));
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
            server.on('error', (err) => console.warn('[MCP] server error:', (err as any)?.code || err.message));
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
        server.listen({ host: MCP_HOST, port: opts.port, exclusive: true });
    });
}

/** The ready-to-paste client setups shown in Settings. */
/** The server's address. The port is kept, so this is the same on or off. */
export function mcpUrl(port: number): string {
    return `http://${MCP_HOST}:${port}${MCP_PATH}`;
}

export function mcpClientSnippets(port: number, token: string): { url: string; claudeCode: string; cursor: string; claudeDesktop: string; codex: string } {
    const url = mcpUrl(port);
    return {
        url,
        claudeCode: `claude mcp add --transport http natively ${url} --header "Authorization: Bearer ${token}"`,
        cursor: JSON.stringify({ mcpServers: { natively: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
        // Claude Desktop reaches HTTP servers through the mcp-remote bridge. The
        // header goes through an env var with no space in the arg: Claude Desktop
        // on Windows does not escape spaces inside args when it runs npx.
        claudeDesktop: JSON.stringify({
            mcpServers: {
                natively: {
                    command: 'npx',
                    args: ['-y', 'mcp-remote', url, '--allow-http', '--header', 'Authorization:${NATIVELY_AUTH}'],
                    env: { NATIVELY_AUTH: `Bearer ${token}` },
                },
            },
        }, null, 2),
        // Codex reads ~/.codex/config.toml; http_headers is an inline TOML table.
        codex: `[mcp_servers.natively]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
    };
}
