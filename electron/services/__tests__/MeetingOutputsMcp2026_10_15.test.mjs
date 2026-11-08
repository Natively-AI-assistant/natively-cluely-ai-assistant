// Granola parity round 2, outputs (2026-10-15): the local read-only MCP server.
// JSON-RPC handlers (initialize, tools/list, tools/call), the four tools over a
// fake meeting source, and the HTTP transport: loopback-only bind, bearer auth
// rejection, Host / Origin checks, body cap, and a close that does not wait on
// open connections. The server binds 127.0.0.1 on an OS-chosen port here; no
// other network is used.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mcp = require(path.join(REPO, 'dist-electron/electron/services/outputs/mcpServer.js'));

const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);
const MEETINGS = {
    a: { id: 'a', title: 'Pricing review', date: '2026-10-14T15:00:00.000Z', duration: '30:00', detailedSummary: { schemaVersion: 3, tldr: ['Hold list price'], actionItemsV3: [{ text: 'Send sheet', owner: 'Dana', status: 'open' }] }, transcript: [
        { speaker: 'user', text: 'Start', timestamp: T0 },
        { speaker: 'interviewer', text: 'Budget is tight', timestamp: T0 + 90_000 },
        { speaker: 'user', text: 'Wrap up', timestamp: T0 + 600_000 },
    ], calendarEvent: { attendees: [{ email: 'dana@acme.com', name: 'Dana' }] } },
    b: { id: 'b', title: 'Hiring sync', date: '2026-10-02T10:00:00.000Z', duration: '20:00', detailedSummary: { schemaVersion: 3, tldr: ['Two offers out'] }, transcript: [] },
    c: { id: 'c', title: 'Old planning', date: '2026-09-01T10:00:00.000Z', detailedSummary: { overview: 'Roadmap' }, transcript: [{ speaker: 'user', text: 'the budget again', timestamp: T0 }] },
};
const source = {
    listMeetings: (limit) => Object.values(MEETINGS).slice(0, limit).map((m) => ({ id: m.id, title: m.title, date: m.date, duration: m.duration, notesText: JSON.stringify(m.detailedSummary) })),
    getMeeting: (id) => MEETINGS[id] || null,
    searchTranscript: (terms) => Object.values(MEETINGS).flatMap((m) => (m.transcript || []).filter((l) => terms.some((t) => l.text.toLowerCase().includes(t))).map((l) => ({ meetingId: m.id, speaker: l.speaker, content: l.text, timestampMs: l.timestamp }))),
};
const info = { version: '9.9.9', selfName: 'Evin' };
const call = (name, args) => mcp.handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, source, info);

describe('JSON-RPC', () => {
    test('initialize echoes a supported protocol version, falls back otherwise, and declares tools only', () => {
        const r = mcp.handleMcpMessage({ jsonrpc: '2.0', id: 'x', method: 'initialize', params: { protocolVersion: '2025-03-26' } }, source, info);
        assert.equal(r.result.protocolVersion, '2025-03-26');
        assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
        assert.equal(r.result.serverInfo.version, '9.9.9');
        const r2 = mcp.handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, source, info);
        assert.equal(r2.result.protocolVersion, mcp.MCP_DEFAULT_VERSION);
    });
    test('tools/list: exactly the four read-only tools', () => {
        const r = mcp.handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, source, info);
        assert.deepEqual(r.result.tools.map((t) => t.name), ['list_meetings', 'get_meeting_notes', 'get_transcript', 'search_meetings']);
        for (const t of r.result.tools) assert.equal(t.annotations.readOnlyHint, true);
    });
    test('notifications get no response; unknown methods and tools are errors; batches refused', () => {
        assert.equal(mcp.handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, source, info), null);
        assert.equal(mcp.handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, source, info).error.code, mcp.RPC.METHOD_NOT_FOUND);
        assert.equal(call('delete_meeting', {}).error.code, mcp.RPC.INVALID_PARAMS);
        assert.equal(mcp.handleMcpMessage([{ jsonrpc: '2.0', id: 1, method: 'ping' }], source, info).error.code, mcp.RPC.INVALID_REQUEST);
        assert.equal(mcp.handleMcpMessage({ id: 1, method: 'ping' }, source, info).error.code, mcp.RPC.INVALID_REQUEST);
        assert.deepEqual(mcp.handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'ping' }, source, info).result, {});
    });
});

describe('tools', () => {
    const text = (r) => r.result.content[0].text;
    test('list_meetings: newest first, date range inclusive of a whole "to" day, query on title and notes, limit', () => {
        const all = JSON.parse(text(call('list_meetings', {})));
        assert.deepEqual(all.meetings.map((m) => m.id), ['a', 'b', 'c']);
        const oct = JSON.parse(text(call('list_meetings', { from: '2026-10-01', to: '2026-10-14' })));
        assert.deepEqual(oct.meetings.map((m) => m.id), ['a', 'b']);
        assert.deepEqual(JSON.parse(text(call('list_meetings', { query: 'offers' }))).meetings.map((m) => m.id), ['b']);
        assert.equal(JSON.parse(text(call('list_meetings', { limit: 1 }))).count, 1);
        const bad = call('list_meetings', { from: 'last tuesday' });
        assert.equal(bad.result.isError, true);
        assert.match(text(bad), /not a date/);
    });
    test('get_meeting_notes: Markdown with date, attendees and action items; unknown id is a tool error', () => {
        const t = text(call('get_meeting_notes', { id: 'a' }));
        assert.match(t, /^Meeting id: a\nDate: 2026-10-14T15:00:00.000Z\nAttendees: Dana <dana@acme.com>/);
        assert.match(t, /## Summary\n\n- Hold list price/);
        assert.match(t, /- \[ \] Dana: Send sheet/);
        const missing = call('get_meeting_notes', { id: 'zzz' });
        assert.equal(missing.result.isError, true);
        assert.equal(call('get_meeting_notes', {}).result.isError, true);
    });
    test('get_transcript: whole, or only a time range in seconds from the start', () => {
        const whole = text(call('get_transcript', { id: 'a' }));
        assert.match(whole, /\[0:00\] Evin: Start\n\[1:30\] Speaker 1: Budget is tight\n\[10:00\] Evin: Wrap up/);
        const part = text(call('get_transcript', { id: 'a', from_seconds: 60, to_seconds: 120 }));
        assert.ok(part.includes('Budget is tight') && !part.includes('Start') && !part.includes('Wrap up'));
        assert.match(text(call('get_transcript', { id: 'b' })), /no transcript/);
        assert.equal(call('get_transcript', { id: 'a', from_seconds: 'soon' }).result.isError, true);
    });
    test('search_meetings: title, notes and transcript hits ranked, with excerpts', () => {
        const r = JSON.parse(text(call('search_meetings', { query: 'budget' })));
        assert.deepEqual(r.meetings.map((m) => m.id).sort(), ['a', 'c']);
        assert.ok(r.meetings[0].excerpts.length >= 1);
        const p = JSON.parse(text(call('search_meetings', { query: 'pricing' })));
        assert.equal(p.meetings[0].id, 'a');
        assert.equal(call('search_meetings', { query: 'a' }).result.isError, true);
    });
});

describe('auth and origin checks', () => {
    test('bearer compared exactly; missing, wrong scheme or wrong token refused', () => {
        assert.equal(mcp.bearerMatches('Bearer s3cret', 's3cret'), true);
        assert.equal(mcp.bearerMatches('bearer s3cret', 's3cret'), true);
        assert.equal(mcp.bearerMatches('Bearer s3cre', 's3cret'), false);
        assert.equal(mcp.bearerMatches('Basic s3cret', 's3cret'), false);
        assert.equal(mcp.bearerMatches(undefined, 's3cret'), false);
        assert.equal(mcp.bearerMatches('Bearer ', ''), false);
    });
    test('Host and Origin must be this machine on this port', () => {
        assert.equal(mcp.isLoopbackHost('127.0.0.1:5000', 5000), true);
        assert.equal(mcp.isLoopbackHost('localhost:5000', 5000), true);
        assert.equal(mcp.isLoopbackHost('evil.com:5000', 5000), false);
        assert.equal(mcp.isLoopbackHost('127.0.0.1:5001', 5000), false);
        assert.equal(mcp.isAllowedOrigin(undefined, 5000), true);
        assert.equal(mcp.isAllowedOrigin('http://localhost:5000', 5000), true);
        assert.equal(mcp.isAllowedOrigin('https://evil.com', 5000), false);
        assert.equal(mcp.isAllowedOrigin('null', 5000), false);
    });
    test('tokens are long and random; ports fall in the dynamic range', () => {
        const a = mcp.newMcpToken();
        assert.ok(a.length >= 40 && a !== mcp.newMcpToken());
        assert.equal(mcp.randomMcpPort(() => 0), 49152);
        assert.ok(mcp.randomMcpPort(() => 0.9999) <= 65535);
    });
    test('client snippets carry the loopback URL and the token; Claude Desktop keeps spaces out of args', () => {
        const s = mcp.mcpClientSnippets(51234, 'tok');
        assert.equal(s.url, 'http://127.0.0.1:51234/mcp');
        assert.match(s.claudeCode, /--transport http natively http:\/\/127\.0\.0\.1:51234\/mcp --header "Authorization: Bearer tok"/);
        assert.deepEqual(JSON.parse(s.cursor).mcpServers.natively.headers, { Authorization: 'Bearer tok' });
        const desk = JSON.parse(s.claudeDesktop).mcpServers.natively;
        assert.ok(desk.args.every((a) => !a.includes(' ')));
        assert.equal(desk.env.NATIVELY_AUTH, 'Bearer tok');
        assert.equal(s.codex, '[mcp_servers.natively]\nurl = "http://127.0.0.1:51234/mcp"\nhttp_headers = { Authorization = "Bearer tok" }');
    });
    test('the address is the same with or without the token, and Settings gets it while the server is off', () => {
        assert.equal(mcp.mcpUrl(51234), mcp.mcpClientSnippets(51234, 'tok').url);
        const fs = require('node:fs');
        const ipc = fs.readFileSync(path.join(REPO, 'electron/services/outputs/outputsIpc.ts'), 'utf8');
        const body = ipc.slice(ipc.indexOf('function mcpStatus()'), ipc.indexOf('async function startMcp()'));
        // url hangs on the port alone; the token and setups still need the server
        // enabled, and Pro or a trial (connectors are Pro, 2026-11-07).
        assert.match(body, /\.\.\.\(port \? \{ port, url: mcpUrl\(port\) \} : \{\}\)/);
        assert.match(body, /\.\.\.\(s\.token && s\.enabled && unlocked \? \{ token: s\.token \} : \{\}\)/);
        // A port is picked and kept the first time, so a never-enabled install has an address too.
        assert.match(body, /if \(!st\.mcpSettings\(\)\.port\) st\.setMcp\(\{ port: randomMcpPort\(\)/);
    });
});

describe('HTTP transport', () => {
    let server;
    let token = 'tok-123';
    const post = (body, extra = {}, { method = 'POST', rawBody } = {}) => new Promise((resolve, reject) => {
        const data = rawBody ?? (body === undefined ? '' : JSON.stringify(body));
        const { __path, ...headers } = extra;
        const req = http.request({
            host: '127.0.0.1', port: server.port, path: __path || '/mcp', method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
        }, (res) => {
            let text = '';
            res.on('data', (c) => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: text ? (() => { try { return JSON.parse(text); } catch { return undefined; } })() : undefined }));
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });

    before(async () => {
        server = await mcp.startMcpServer({ port: 0, token: () => token, source, version: '1.0.0' });
    });
    after(async () => { await server?.close(); });

    test('binds 127.0.0.1 only (loopback), never all interfaces', async () => {
        assert.equal(mcp.MCP_HOST, '127.0.0.1');
        assert.ok(server.port > 0);
        const res = await post({ jsonrpc: '2.0', id: 1, method: 'ping' });
        assert.equal(res.status, 200);
        assert.deepEqual(res.json, { jsonrpc: '2.0', id: 1, result: {} });
    });
    test('no token, a wrong token: 401 with WWW-Authenticate, and nothing is read', async () => {
        const none = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: '' });
        assert.equal(none.status, 401);
        assert.equal(none.headers['www-authenticate'], 'Bearer');
        assert.equal(none.json.result, undefined);
        const wrong = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_meeting_notes', arguments: { id: 'a' } } }, { Authorization: 'Bearer nope' });
        assert.equal(wrong.status, 401);
        assert.ok(!wrong.text.includes('Hold list price'));
    });
    test('a rotated token stops the old one at once', async () => {
        const old = token;
        token = 'rotated';
        assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${old}` })).status, 401);
        assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 200);
    });
    test('a browser Origin or a foreign Host is refused (DNS rebinding)', async () => {
        assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example' })).status, 403);
        assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Host: `evil.example:${server.port}` })).status, 403);
    });
    test('GET is 405 (no event stream), other paths 404, non-JSON 415, bad JSON a parse error', async () => {
        const get = await post(undefined, {}, { method: 'GET' });
        assert.equal(get.status, 405);
        assert.equal(get.headers.allow, 'POST');
        assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { __path: '/other' })).status, 404);
        assert.equal((await post(undefined, { 'Content-Type': 'text/plain' }, { rawBody: 'hi' })).status, 415);
        const bad = await post(undefined, {}, { rawBody: '{nope' });
        assert.equal(bad.status, 400);
        assert.equal(bad.json.error.code, mcp.RPC.PARSE);
    });
    test('a notification is accepted with 202 and no body', async () => {
        const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        assert.equal(res.status, 202);
        assert.equal(res.text, '');
    });
    test('bodies over the cap are refused', async () => {
        const res = await post(undefined, {}, { rawBody: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', pad: 'x'.repeat(mcp.MCP_MAX_BODY_BYTES) }) });
        assert.equal(res.status, 413);
    });
    test('a full tools/call over HTTP', async () => {
        const res = await post({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_meeting_notes', arguments: { id: 'a' } } });
        assert.equal(res.status, 200);
        assert.match(res.json.result.content[0].text, /Hold list price/);
    });
});

describe('lifecycle', () => {
    test('close() returns promptly even with a keep-alive client connected', async () => {
        const s = await mcp.startMcpServer({ port: 0, token: () => 't', source, version: '1' });
        const agent = new http.Agent({ keepAlive: true });
        await new Promise((resolve) => {
            const req = http.request({ host: '127.0.0.1', port: s.port, path: '/mcp', method: 'POST', agent, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' } }, (res) => { res.resume(); res.on('end', resolve); });
            req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
        });
        const started = Date.now();
        await s.close();
        assert.ok(Date.now() - started < 1000, 'closed without waiting for the client');
        agent.destroy();
    });
    test('a taken port rejects with EADDRINUSE so the caller can pick another', async () => {
        const s = await mcp.startMcpServer({ port: 0, token: () => 't', source, version: '1' });
        await assert.rejects(mcp.startMcpServer({ port: s.port, token: () => 't', source, version: '1' }), (e) => e.code === 'EADDRINUSE');
        await s.close();
    });
});
