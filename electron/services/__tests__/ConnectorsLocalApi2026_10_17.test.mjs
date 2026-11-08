// Settings › Connectors › API keys (2026-10-17): personal API keys and the local
// read-only API they open. The key store (shown once, only its hash saved,
// expiry, revoke, the 25-key cap, the lastUsed write throttle), and the server
// over a fake meeting source: loopback-only bind, 401 without a valid key,
// Host / Origin refusal, routes, the limit cap, stopping with the last key and
// keeping its port. The server binds 127.0.0.1 only; no other network is used.
// Electron-free (fake safeStorage), so the same assertions hold on macOS and
// Windows runners.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(REPO, 'dist-electron/electron/services/outputs');
const keysMod = require(path.join(OUT, 'apiKeys.js'));
const apiMod = require(path.join(OUT, 'localApi.js'));
const ipcMod = require(path.join(OUT, 'localApiIpc.js'));

const DAY = 24 * 3600 * 1000;
const dirs = [];
function tmpDir() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-apikeys-'));
    dirs.push(d);
    return d;
}
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** Reversible stand-in for Electron's safeStorage. */
const fakeSafeStorage = (available = true) => ({
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`ENC1${Buffer.from(s, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (b) => Buffer.from(b.toString('utf8').slice(4), 'base64').toString('utf8'),
});
const readStored = (dir) => JSON.parse(fakeSafeStorage().decryptString(fs.readFileSync(path.join(dir, keysMod.API_KEYS_FILE))));

function clock(t = Date.UTC(2026, 9, 17, 9, 0, 0)) {
    const c = { t, now: () => c.t };
    return c;
}
const newStore = (dir, c, safeStorage = fakeSafeStorage()) => new keysMod.ApiKeyStore({ userDataDir: dir, safeStorage, now: c.now, sleepSync: () => {} });

// ── Fake meetings ────────────────────────────────────────────────────────

const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);
const MEETINGS = [];
for (let i = 0; i < 130; i++) {
    MEETINGS.push({
        id: `m${String(i).padStart(3, '0')}`,
        title: i === 0 ? 'Pricing review' : `Meeting ${i}`,
        date: new Date(Date.UTC(2026, 9, 16) - i * DAY).toISOString(),
        duration: i === 0 ? '30:00' : '0:00',
        detailedSummary: i === 0
            ? { schemaVersion: 3, tldr: ['Hold list price'], sectionsV3: [{ title: 'Budget', bullets: ['Tight this quarter'], order: 1 }], actionItemsV3: [{ text: 'Send sheet', owner: 'Dana', status: 'open' }] }
            : { schemaVersion: 3, tldr: [`Point ${i}`] },
        transcript: i === 0
            ? [{ speaker: 'user', text: 'Shall we start', timestamp: T0 }, { speaker: 'interviewer', text: 'The budget is tight', timestamp: T0 + 90_000 }]
            : [],
        calendarEvent: i === 0 ? { attendees: [{ email: 'dana@acme.com', name: 'Dana' }, { email: 'lee@acme.com' }] } : null,
    });
}
const byId = new Map(MEETINGS.map((m) => [m.id, m]));
const source = {
    listMeetings: (limit) => MEETINGS.slice(0, limit).map((m) => ({ id: m.id, title: m.title, date: m.date, duration: m.duration, notesText: '' })),
    getMeeting: (id) => byId.get(id) || null,
    searchTranscript: (terms) => MEETINGS.flatMap((m) => m.transcript.filter((l) => terms.some((t) => l.text.toLowerCase().includes(t))).map((l) => ({ meetingId: m.id, speaker: l.speaker, content: l.text, timestampMs: l.timestamp }))),
};

// ── HTTP helpers ─────────────────────────────────────────────────────────

function request(port, urlPath, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers, agent: false }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}
const portOf = (baseUrl) => Number(/^http:\/\/127\.0\.0\.1:(\d+)\/v1$/.exec(baseUrl)[1]);
const freePort = () => new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const isListening = (port) => new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
});

function registerFake({ dir, c, randomPort } = {}) {
    const handlers = {};
    const launcher = { sender: 'launcher' };
    ipcMod.registerLocalApiIpc({
        safeHandle: (ch, fn) => { handlers[ch] = fn; },
        guard: (fallback, fn) => async (e, ...a) => (e?.sender === 'launcher' ? fn(e, ...a) : fallback),
        userDataDir: dir,
        safeStorage: fakeSafeStorage(),
        source,
        selfName: () => 'Evin',
        // Connectors are Pro (2026-11-06); these tests are the Pro path. ConnectorsProGate covers the locked one.
        connectorsAllowed: () => true,
        now: c?.now,
        randomPort,
    });
    const call = (ch, ...a) => handlers[ch](launcher, ...a);
    return { handlers, call, other: (ch, ...a) => handlers[ch]({ sender: 'overlay' }, ...a) };
}

// ── The key store ────────────────────────────────────────────────────────

describe('ApiKeyStore', () => {
    test('the key is shown once; the file holds only its SHA-256 and metadata', () => {
        const dir = tmpDir();
        const c = clock();
        const store = newStore(dir, c);
        const made = store.create({ description: '  Weekly   export\nscript ', expiresInDays: 30 });
        assert.equal(made.ok, true);
        assert.match(made.key, /^nat_[A-Za-z0-9_-]{43}$/);
        assert.equal(made.info.description, 'Weekly export script');
        assert.equal(made.info.status, 'active');
        assert.equal(made.info.expiresAt, c.t + 30 * DAY);
        assert.equal(made.info.lastUsedAt, null);
        assert.equal('key' in made.info, false);

        const raw = fs.readFileSync(path.join(dir, keysMod.API_KEYS_FILE));
        assert.equal(raw.includes(made.key), false);
        const stored = readStored(dir);
        assert.equal(JSON.stringify(stored).includes(made.key), false);
        assert.equal(JSON.stringify(stored).includes(made.key.slice(4)), false);
        assert.equal(stored.keys.length, 1);
        assert.equal(stored.keys[0].hash, crypto.createHash('sha256').update(made.key).digest('hex'));
        assert.deepEqual(Object.keys(stored.keys[0]).sort(), ['createdAt', 'description', 'expiresAt', 'hash', 'id', 'lastUsedAt', 'revokedAt']);

        // Listing never returns it, and a second store on the same file still verifies it.
        assert.equal(JSON.stringify(store.list()).includes(made.key), false);
        assert.equal(newStore(dir, c).verify(made.key), true);
    });

    test('verify: right key only; expired and revoked keys fail and stay listed', () => {
        const dir = tmpDir();
        const c = clock();
        const store = newStore(dir, c);
        const a = store.create({ description: 'Day key', expiresInDays: 1 });
        const b = store.create({ description: 'Never', expiresInDays: null });
        assert.equal(b.info.expiresAt, null);
        assert.equal(store.verify(a.key), true);
        assert.equal(store.verify(`${a.key.slice(0, -1)}${a.key.endsWith('A') ? 'B' : 'A'}`), false);
        assert.equal(store.verify('nat_short'), false);
        assert.equal(store.verify(''), false);
        assert.equal(store.verify(undefined), false);

        c.t += DAY;
        assert.equal(store.verify(a.key), false);
        assert.equal(store.list().find((k) => k.id === a.info.id).status, 'expired');
        assert.equal(store.verify(b.key), true);

        assert.deepEqual(store.revoke(b.info.id), { ok: true });
        assert.equal(store.verify(b.key), false);
        assert.equal(store.list().find((k) => k.id === b.info.id).status, 'revoked');
        assert.deepEqual(store.revoke(b.info.id), { ok: true });
        assert.equal(store.revoke('nope').kind, 'not_found');
        assert.equal(store.revoke(42).ok, false);
        assert.equal(store.list().length, 2);
        assert.equal(store.hasActiveKeys(), false);
        assert.equal(newStore(dir, c).list().find((k) => k.id === b.info.id).status, 'revoked');
    });

    test('input is checked: description required and at most 80 characters; expiry one of the offered choices', () => {
        const store = newStore(tmpDir(), clock());
        assert.equal(store.create({ description: '   ', expiresInDays: 30 }).kind, 'invalid_input');
        assert.equal(store.create({ description: 'x'.repeat(81), expiresInDays: 30 }).kind, 'invalid_input');
        assert.equal(store.create({ description: 'x'.repeat(80), expiresInDays: 30 }).ok, true);
        assert.equal(store.create({ description: 'ok', expiresInDays: 2 }).kind, 'invalid_input');
        assert.equal(store.create({ description: 'ok', expiresInDays: '30' }).kind, 'invalid_input');
        assert.equal(store.create({ description: 'ok', expiresInDays: undefined }).kind, 'invalid_input');
        for (const d of [1, 7, 30, 90, 180, 365, null]) assert.equal(store.create({ description: `d${d}`, expiresInDays: d }).ok, true);
        for (const r of [store.create({ description: 'x', expiresInDays: 400 })]) assert.doesNotMatch(r.message, /\d{3}/);
    });

    test('no secure storage: no key is made', () => {
        const store = newStore(tmpDir(), clock(), fakeSafeStorage(false));
        const r = store.create({ description: 'x', expiresInDays: null });
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'storage_unavailable');
    });

    test('25 keys at most, counting expired but not revoked ones', () => {
        const c = clock();
        const store = newStore(tmpDir(), c);
        const made = [];
        for (let i = 0; i < 24; i++) made.push(store.create({ description: `k${i}`, expiresInDays: null }));
        made.push(store.create({ description: 'short', expiresInDays: 1 }));
        c.t += 2 * DAY; // the last one is now expired and still counts
        const over = store.create({ description: 'one too many', expiresInDays: null });
        assert.equal(over.ok, false);
        assert.match(over.message, /25/);
        store.revoke(made[0].info.id);
        assert.equal(store.create({ description: 'room again', expiresInDays: null }).ok, true);
        assert.equal(store.create({ description: 'over again', expiresInDays: null }).ok, false);
        assert.equal(store.list().length, 26);
    });

    test('lastUsedAt is saved at most once a minute', () => {
        const dir = tmpDir();
        const c = clock();
        const store = newStore(dir, c);
        const { key, info } = store.create({ description: 'script', expiresInDays: null });
        const file = path.join(dir, keysMod.API_KEYS_FILE);
        const t1 = c.t + 1000;
        c.t = t1;
        assert.equal(store.verify(key), true);
        assert.equal(readStored(dir).keys[0].lastUsedAt, t1);
        const before = fs.readFileSync(file);
        c.t = t1 + 30_000;
        for (let i = 0; i < 20; i++) assert.equal(store.verify(key), true);
        assert.deepEqual(fs.readFileSync(file), before, 'no write within the minute');
        assert.equal(store.list().find((k) => k.id === info.id).lastUsedAt, t1);
        c.t = t1 + keysMod.LAST_USED_WRITE_MS;
        assert.equal(store.verify(key), true);
        assert.equal(readStored(dir).keys[0].lastUsedAt, c.t);
        assert.equal(store.list()[0].lastUsedAt, c.t);
    });

    test('an undecryptable file reads as no keys rather than failing', () => {
        const dir = tmpDir();
        fs.writeFileSync(path.join(dir, keysMod.API_KEYS_FILE), 'garbage');
        const store = newStore(dir, clock());
        assert.deepEqual(store.list(), []);
        assert.equal(store.create({ description: 'fresh', expiresInDays: null }).ok, true);
    });
});

// ── Routes, without a server ─────────────────────────────────────────────

describe('routes', () => {
    const route = (p, q = '') => apiMod.routeLocalApi(p, new URLSearchParams(q), { source, selfName: 'Evin' });

    test('GET /v1/notes: newest first, 20 by default, limit capped at 100, cursor pages through', () => {
        const first = route('/v1/notes');
        assert.equal(first.notes.length, 20);
        assert.deepEqual(first.notes[0], { id: 'm000', title: 'Pricing review', date: MEETINGS[0].date, durationSeconds: 1800, attendeeCount: 2 });
        assert.equal(first.notes[1].durationSeconds, null);
        assert.equal(route('/v1/notes', 'limit=1000').notes.length, 100);
        assert.equal(route('/v1/notes', 'limit=0').notes.length, 1);
        assert.throws(() => route('/v1/notes', 'limit=abc'), (e) => e.status === 400);
        assert.throws(() => route('/v1/notes', 'cursor=bogus'), (e) => e.status === 400);

        const seen = [];
        let cursor = null;
        do {
            const page = route('/v1/notes', `limit=50${cursor ? `&cursor=${cursor}` : ''}`);
            seen.push(...page.notes.map((n) => n.id));
            cursor = page.nextCursor;
        } while (cursor);
        assert.deepEqual(seen, MEETINGS.map((m) => m.id));
    });

    test('GET /v1/notes/:id: notes as Markdown, sections, action items, attendees', () => {
        const n = route('/v1/notes/m000');
        assert.equal(n.id, 'm000');
        assert.equal(n.title, 'Pricing review');
        assert.equal(n.durationSeconds, 1800);
        assert.deepEqual(n.attendees, [{ name: 'Dana', email: 'dana@acme.com' }, { email: 'lee@acme.com' }]);
        assert.match(n.summaryMarkdown, /## Summary\n\n- Hold list price/);
        assert.match(n.summaryMarkdown, /## Action items\n\n- \[ \] Dana: Send sheet/);
        assert.deepEqual(n.sections.map((s) => s.heading), ['Summary', 'Budget']);
        assert.deepEqual(n.actionItems, [{ text: 'Send sheet', owner: 'Dana', done: false }]);
        assert.equal(n.userNotes, null);
        assert.throws(() => route('/v1/notes/nope'), (e) => e.status === 404 && e.code === 'not_found');
        assert.throws(() => route('/v1/notes/%E0%A4%A'), (e) => e.status === 404);
    });

    test('GET /v1/notes/:id/transcript and /v1/search', () => {
        const t = route('/v1/notes/m000/transcript');
        assert.deepEqual(t.lines, [
            { speaker: 'Evin', text: 'Shall we start', offsetMs: 0 },
            { speaker: 'Speaker 1', text: 'The budget is tight', offsetMs: 90_000 },
        ]);
        assert.equal(t.truncated, false);
        const s = route('/v1/search', 'q=Budget');
        assert.deepEqual(s.results.map((r) => r.id), ['m000']);
        assert.deepEqual(s.results[0].matches, [{ speaker: 'Speaker 1', text: 'The budget is tight' }]);
        assert.deepEqual(route('/v1/search', 'q=nothinghere').results, []);
        assert.throws(() => route('/v1/search'), (e) => e.status === 400);
        assert.throws(() => route('/v1/search', 'q=a'), (e) => e.status === 400);
        assert.throws(() => route('/v1/meetings'), (e) => e.status === 404);
    });
});

// ── The server through IPC ───────────────────────────────────────────────

describe('local API server', () => {
    after(async () => { await ipcMod.stopLocalApi(); });

    test('starts with the first key, answers only a valid key from this computer, stops with the last key, keeps its port', async () => {
        const dir = tmpDir();
        const { call, other } = registerFake({ dir });
        const C = ipcMod.LOCAL_API_CHANNELS;

        const empty = await call(C.list);
        assert.deepEqual(empty, { keys: [], server: { running: false } });
        assert.equal((await other(C.create, { description: 'x', expiresInDays: null })).kind, 'forbidden');
        assert.deepEqual(await other(C.list), { keys: [], server: { running: false } });
        assert.equal((await call(C.create, null)).kind, 'invalid_input');
        assert.equal((await call(C.create, 'text')).kind, 'invalid_input');

        const made = await call(C.create, { description: 'CLI', expiresInDays: 90 });
        assert.equal(made.ok, true);
        assert.match(made.key, /^nat_/);
        const listed = await call(C.list);
        assert.equal(listed.keys.length, 1);
        assert.equal(JSON.stringify(listed).includes(made.key), false);
        assert.equal(listed.server.running, true);
        const port = portOf(listed.server.baseUrl);
        assert.ok(port >= 1024);
        assert.equal(readStored(dir).port, port, 'port saved with the keys');
        const auth = { Authorization: `Bearer ${made.key}` };

        // Auth
        const none = await request(port, '/v1/notes');
        assert.equal(none.status, 401);
        assert.equal(none.body.error, 'unauthorized');
        assert.equal(typeof none.body.message, 'string');
        assert.doesNotMatch(none.body.message, /\b401\b/);
        assert.equal((await request(port, '/v1/notes', { headers: { Authorization: 'Bearer nat_wrongwrongwrongwrongwrongwrongwrongwrongwro' } })).status, 401);
        assert.equal((await request(port, '/v1/notes', { headers: { Authorization: made.key } })).status, 401);
        const ok = await request(port, '/v1/notes?limit=2', { headers: auth });
        assert.equal(ok.status, 200);
        assert.deepEqual(ok.body.notes.map((n) => n.id), ['m000', 'm001']);
        assert.equal(typeof ok.body.nextCursor, 'string');
        assert.equal(ok.headers['access-control-allow-origin'], undefined);
        assert.match(ok.headers['content-type'], /application\/json/);
        assert.equal((await call(C.list)).keys[0].lastUsedAt !== null, true);

        // DNS rebinding and browsers
        assert.equal((await request(port, '/v1/notes', { headers: { ...auth, Host: `evil.example:${port}` } })).status, 403);
        assert.equal((await request(port, '/v1/notes', { headers: { ...auth, Host: `127.0.0.1:${port + 1}` } })).status, 403);
        assert.equal((await request(port, '/v1/notes', { headers: { ...auth, Host: `localhost:${port}` } })).status, 200);
        const fromPage = await request(port, '/v1/notes', { headers: { ...auth, Origin: 'https://evil.example' } });
        assert.equal(fromPage.status, 403);
        assert.equal(fromPage.body.error, 'forbidden');
        assert.equal((await request(port, '/v1/notes', { headers: { ...auth, Origin: `http://127.0.0.1:${port}` } })).status, 403);
        assert.equal((await request(port, '/v1/notes', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } })).status, 403);

        // Methods, routes, limits
        const post = await request(port, '/v1/notes', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(post.status, 405);
        assert.equal(post.body.error, 'method_not_allowed');
        assert.equal((await request(port, '/v1/notes/m000', { method: 'DELETE', headers: auth })).status, 405);
        assert.equal((await request(port, '/v1/nothing', { headers: auth })).status, 404);
        const missing = await request(port, '/v1/notes/nope', { headers: auth });
        assert.equal(missing.status, 404);
        assert.deepEqual(Object.keys(missing.body).sort(), ['error', 'message']);
        assert.equal((await request(port, '/v1/notes?limit=500', { headers: auth })).body.notes.length, 100);
        assert.equal((await request(port, '/v1/notes?limit=-1', { headers: auth })).status, 400);
        assert.equal((await request(port, '/v1/notes/m000', { headers: auth })).body.title, 'Pricing review');
        assert.equal((await request(port, '/v1/notes/m000/transcript', { headers: auth })).body.lines.length, 2);
        assert.deepEqual((await request(port, '/v1/search?q=budget', { headers: auth })).body.results.map((r) => r.id), ['m000']);

        // Revoke the only key: the server stops.
        const second = await call(C.create, { description: 'Second', expiresInDays: null });
        assert.equal((await call(C.revoke, made.info.id)).ok, true);
        assert.equal((await request(port, '/v1/notes', { headers: auth })).status, 401, 'revoked key refused at once');
        assert.equal((await call(C.list)).server.running, true, 'another key is still active');
        assert.equal((await call(C.revoke, 'nope')).kind, 'not_found');
        assert.equal((await call(C.revoke, { id: 1 })).ok, false);
        assert.equal((await call(C.revoke, second.info.id)).ok, true);
        const off = await call(C.list);
        assert.deepEqual(off.server, { running: false });
        assert.deepEqual(off.keys.map((k) => k.status), ['revoked', 'revoked']);
        assert.equal(await isListening(port), false);

        // A new key brings it back on the same port; so does the next launch.
        const third = await call(C.create, { description: 'Third', expiresInDays: 7 });
        assert.equal(portOf((await call(C.list)).server.baseUrl), port);
        await ipcMod.stopLocalApi();
        assert.equal(await isListening(port), false);
        registerFake({ dir });
        await ipcMod.startLocalApiIfKeys();
        assert.equal(portOf(ipcMod.localApiStatus().baseUrl), port);
        assert.equal((await request(port, '/v1/notes?limit=1', { headers: { Authorization: `Bearer ${third.key}` } })).status, 200);
        await ipcMod.stopLocalApi();
    });

    test('a taken port is skipped and the new one is kept', async () => {
        const dir = tmpDir();
        const taken = net.createServer();
        await new Promise((r) => taken.listen(0, '127.0.0.1', r));
        const busy = taken.address().port;
        const spare = await freePort();
        const ports = [busy, spare];
        const { call } = registerFake({ dir, randomPort: () => ports.shift() ?? spare });
        await call(ipcMod.LOCAL_API_CHANNELS.create, { description: 'x', expiresInDays: null });
        const status = ipcMod.localApiStatus();
        assert.equal(status.running, true);
        assert.equal(portOf(status.baseUrl), spare);
        assert.equal(readStored(dir).port, spare);
        await ipcMod.stopLocalApi();
        await new Promise((r) => taken.close(r));
    });

    test('the server stops once the last key has run out', async () => {
        const dir = tmpDir();
        const c = clock();
        const { call } = registerFake({ dir, c });
        const made = await call(ipcMod.LOCAL_API_CHANNELS.create, { description: 'day', expiresInDays: 1 });
        const port = portOf(ipcMod.localApiStatus().baseUrl);
        c.t += DAY + 1;
        assert.equal((await request(port, '/v1/notes', { headers: { Authorization: `Bearer ${made.key}` } })).status, 401);
        for (let i = 0; i < 50 && ipcMod.localApiStatus().running; i++) await new Promise((r) => setTimeout(r, 20));
        assert.equal(ipcMod.localApiStatus().running, false);
        assert.equal(await isListening(port), false);
        assert.deepEqual((await call(ipcMod.LOCAL_API_CHANNELS.list)).keys.map((k) => k.status), ['expired']);
    });
});
