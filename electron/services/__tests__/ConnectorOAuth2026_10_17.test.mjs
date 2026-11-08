// Settings › Connectors › Connect signs in with the service's own account
// (connectorOAuth.ts): the loopback round trip, what is saved for each service,
// and renewing tokens that expire. natively-api is a fake fetch; the browser is
// a plain HTTP GET to the loopback port. No network.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => require(path.join(REPO, 'dist-electron/electron/services/outputs', p));
const oauth = dist('connectorOAuth.js');
const { ConnectionsStore } = dist('connectionsStore.js');
const { ConnectionError } = dist('httpRequest.js');

const API = 'https://api.example.test';
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });

function makeStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-connector-oauth-'));
    const safeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s, 'utf8'),
        decryptString: (b) => b.toString('utf8'),
    };
    return { store: new ConnectionsStore({ userDataDir: dir, safeStorage }), dir, safeStorage };
}

function fakeApi(routes) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
        const route = routes[url.replace(API, '')];
        if (!route) return json(404, { error: 'not_found' });
        return typeof route === 'function' ? route(init) : route;
    };
    return { calls, fetchImpl };
}

const get = (url) => new Promise((resolve, reject) => {
    http.get(url, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
});

test('a browser sign-in is saved with its renewal details and survives a restart; a pasted token replaces it', () => {
    const { store, dir, safeStorage } = makeStore();
    store.setOAuth('hubspot', { token: 'at-1', refreshToken: 'rt-1', expiresAt: 5_000, account: 'acme.com' });
    const again = new ConnectionsStore({ userDataDir: dir, safeStorage });
    assert.equal(again.token('hubspot'), 'at-1');
    assert.deepEqual(again.grant('hubspot'), { refreshToken: 'rt-1', expiresAt: 5_000, account: 'acme.com', via: 'oauth' });

    // A renewal keeps the refresh token and account it did not replace.
    again.setOAuth('hubspot', { token: 'at-2', expiresAt: 9_000 }, { renewal: true });
    assert.deepEqual(again.grant('hubspot'), { refreshToken: 'rt-1', expiresAt: 9_000, account: 'acme.com', via: 'oauth' });

    again.setToken('hubspot', 'pat-pasted');
    assert.equal(again.grant('hubspot'), null, 'a pasted token is not a sign-in');
});

test('Notion keeps its chosen parent on a renewal, not on a new sign-in', () => {
    const { store } = makeStore();
    store.setOAuth('notion', { token: 'ntn_1', refreshToken: 'nrt_1' });
    store.setNotionParent({ type: 'page', id: 'abc', title: 'Meetings' });
    store.setOAuth('notion', { token: 'ntn_2' }, { renewal: true });
    assert.equal(store.read().notion.parent.title, 'Meetings');
    store.setOAuth('notion', { token: 'ntn_3' });
    assert.equal(store.read().notion.parent, undefined);
});

test('OAuth tokens longer than 512 characters are kept whole', () => {
    const { store, dir, safeStorage } = makeStore();
    const long = 'x'.repeat(900);
    store.setOAuth('hubspot', { token: long });
    assert.equal(new ConnectionsStore({ userDataDir: dir, safeStorage }).token('hubspot'), long);
});

test('Slack: the channel from the sign-in becomes a webhook; the same channel again replaces it', () => {
    const { store } = makeStore();
    const hook = (url) => ({ webhook: { url, channel: '#notes', team: 'Acme' } });
    oauth.saveConnection('slack', hook('https://hooks.slack.com/services/T/B/one'), { store });
    oauth.saveConnection('slack', hook('https://hooks.slack.com/services/T/B/two'), { store });
    const hooks = store.read().slack.webhooks;
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].label, '#notes · Acme');
    assert.equal(hooks[0].url, 'https://hooks.slack.com/services/T/B/two');
    assert.throws(() => oauth.saveConnection('slack', hook('https://evil.example/hook'), { store }), /did not hand back a channel/);
});

test('Salesforce needs a real org host from the sign-in', () => {
    const { store } = makeStore();
    assert.throws(() => oauth.saveConnection('salesforce', { accessToken: 'a', instanceUrl: 'https://evil.example' }, { store }), /which org/);
    oauth.saveConnection('salesforce', { accessToken: 'a', refreshToken: 'r', instanceUrl: 'https://acme.my.salesforce.com' }, { store });
    assert.equal(store.salesforceInstanceUrl(), 'https://acme.my.salesforce.com');
    assert.equal(store.grant('salesforce').refreshToken, 'r');
});

test('expiring tokens are renewed before use, and only then', async () => {
    const { store } = makeStore();
    let now = 1_000_000;
    store.setOAuth('hubspot', { token: 'old', refreshToken: 'rt', expiresAt: now + 10 * 60_000 });
    const { calls, fetchImpl } = fakeApi({ '/v1/connectors/oauth/hubspot/refresh': json(200, { ok: true, connection: { accessToken: 'new', expiresIn: 1800 } }) });
    const deps = { apiBase: API, store, fetchImpl, now: () => now };
    assert.equal(await oauth.currentToken('hubspot', deps), 'old');
    assert.equal(calls.length, 0);
    now += 9 * 60_000; // inside the renewal margin
    assert.equal(await oauth.currentToken('hubspot', deps), 'new');
    assert.deepEqual(calls[0].body, { refresh_token: 'rt' });
    assert.equal(store.grant('hubspot').expiresAt, now + 1800 * 1000);
    assert.equal(store.grant('hubspot').refreshToken, 'rt', 'kept when the server sends none');
});

test('a refused signed-in token is renewed once and the call retried; a pasted one is not', async () => {
    const { store } = makeStore();
    store.setOAuth('salesforce', { token: 'stale', refreshToken: 'rt', instanceUrl: 'https://acme.my.salesforce.com' });
    const { calls, fetchImpl } = fakeApi({ '/v1/connectors/oauth/salesforce/refresh': json(200, { ok: true, connection: { accessToken: 'fresh', instanceUrl: 'https://acme.my.salesforce.com' } }) });
    const used = [];
    const result = await oauth.withCurrentToken('salesforce', { apiBase: API, store, fetchImpl }, async (t) => {
        used.push(t);
        if (t === 'stale') throw new ConnectionError('auth');
        return 'sent';
    });
    assert.equal(result, 'sent');
    assert.deepEqual(used, ['stale', 'fresh']);
    assert.equal(calls.length, 1);

    store.setToken('attio', 'pasted');
    await assert.rejects(oauth.withCurrentToken('attio', { apiBase: API, store, fetchImpl }, async () => { throw new ConnectionError('auth'); }), (e) => e.kind === 'auth');
    assert.equal(calls.length, 1, 'no renewal for a pasted token');
});

test('concurrent renewals share one request', async () => {
    const { store } = makeStore();
    store.setOAuth('notion', { token: 'old', refreshToken: 'nrt', expiresAt: 1 });
    let hits = 0;
    const { fetchImpl } = fakeApi({ '/v1/connectors/oauth/notion/refresh': async () => { hits++; await new Promise((r) => setTimeout(r, 20)); return json(200, { ok: true, connection: { accessToken: 'new', refreshToken: 'nrt2' } }); } });
    const deps = { apiBase: API, store, fetchImpl };
    const [a, b] = await Promise.all([oauth.currentToken('notion', deps), oauth.currentToken('notion', deps)]);
    assert.equal(a, 'new');
    assert.equal(b, 'new');
    assert.equal(hits, 1);
    assert.equal(store.grant('notion').refreshToken, 'nrt2', 'Notion rotates its refresh token');
});

test('which services sign in with the browser: natively-api says, unreachable means none', async () => {
    oauth.resetOAuthServicesCache();
    const { fetchImpl } = fakeApi({ '/v1/connectors/oauth': json(200, { services: { slack: true, notion: true, hubspot: false } }) });
    assert.deepEqual(await oauth.oauthServices({ apiBase: API, fetchImpl }), { slack: true, notion: true, hubspot: false, salesforce: false, pipedrive: false, attio: false });
    oauth.resetOAuthServicesCache();
    const down = async () => { throw new Error('offline'); };
    assert.deepEqual(await oauth.oauthServices({ apiBase: API, fetchImpl: down }), { slack: false, notion: false, hubspot: false, salesforce: false, pipedrive: false, attio: false });
});

test('the whole round trip: browser to natively-api, back to the loopback port, exchanged with the verifier', async () => {
    const { store } = makeStore();
    let started;
    const { calls, fetchImpl } = fakeApi({
        '/v1/connectors/oauth/notion/exchange': json(200, { ok: true, connection: { accessToken: 'ntn_ok', workspace: 'x', account: 'Team space' } }),
    });
    const res = await oauth.connectWithBrowser('notion', {
        apiBase: API, store, fetchImpl, platform: process.platform,
        openExternal: async (url) => {
            started = new URL(url);
            // natively-api would bounce through Notion and come back here.
            const back = new URL(started.searchParams.get('return_to'));
            back.searchParams.set('code', 'sealed-blob');
            back.searchParams.set('state', started.searchParams.get('state'));
            await get(back.toString());
        },
    });
    assert.equal(res.ok, true, res.message);
    assert.equal(started.origin + started.pathname, `${API}/v1/connectors/oauth/notion/start`);
    assert.match(started.searchParams.get('return_to'), /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.match(started.searchParams.get('challenge'), /^[A-Za-z0-9_-]{43}$/);
    const ex = calls.find((c) => c.url.endsWith('/exchange'));
    assert.equal(ex.body.code, 'sealed-blob');
    assert.match(ex.body.verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(store.token('notion'), 'ntn_ok');
    assert.equal(store.grant('notion').account, 'Team space');
});

test('a refusal on the consent screen comes back as a sentence; nothing is saved', async () => {
    const { store } = makeStore();
    const res = await oauth.connectWithBrowser('hubspot', {
        apiBase: API, store, fetchImpl: fakeApi({}).fetchImpl, platform: process.platform,
        openExternal: async (url) => {
            const u = new URL(url);
            const back = new URL(u.searchParams.get('return_to'));
            back.searchParams.set('error', 'access_denied');
            back.searchParams.set('state', u.searchParams.get('state'));
            await get(back.toString());
        },
    });
    assert.equal(res.ok, false);
    assert.match(res.message, /declined/);
    assert.equal(store.token('hubspot'), null);
});

test('Cancel stops waiting, with no message to show', async () => {
    const { store } = makeStore();
    const ctl = new AbortController();
    const res = await oauth.connectWithBrowser('slack', {
        apiBase: API, store, fetchImpl: fakeApi({}).fetchImpl, platform: process.platform, signal: ctl.signal,
        openExternal: () => { setTimeout(() => ctl.abort(), 10); },
    });
    assert.deepEqual(res, { ok: false, kind: 'unknown', message: '' });
});

test('failed exchanges are worded, never shown as codes', () => {
    const err = (error) => new ConnectionError('invalid_input', 'status 400', 400, JSON.stringify({ ok: false, error }));
    assert.match(oauth.signInFailure('notion', err('expired')), /took too long/);
    assert.match(oauth.signInFailure('hubspot', err('not_configured')), /Use a token instead/);
    assert.match(oauth.signInFailure('slack', err('invalid_verifier')), /different attempt/);
    for (const e of ['expired', 'not_configured', 'invalid_verifier', 'provider_error']) assert.doesNotMatch(oauth.signInFailure('attio', err(e)), /_|\d{3}/);
});

// ── Pipedrive (a fifth CRM) ──────────────────────────────────────────────
const crm = dist('crm.js');

test('Pipedrive: a sign-in keeps the company host; a pasted token uses api.pipedrive.com', () => {
    const { store } = makeStore();
    assert.throws(() => oauth.saveConnection('pipedrive', { accessToken: 'a', instanceUrl: 'https://evil.example' }, { store }), /which company/);
    oauth.saveConnection('pipedrive', { accessToken: 'pd', refreshToken: 'r', expiresIn: 3600, instanceUrl: 'https://Acme.pipedrive.com/' }, { store, now: () => 0 });
    assert.equal(store.pipedriveInstanceUrl(), 'https://acme.pipedrive.com');
    assert.equal(store.grant('pipedrive').expiresAt, 3_600_000);
    store.setToken('pipedrive', 'pasted');
    assert.equal(store.pipedriveInstanceUrl(), null, 'a pasted token drops the sign-in host');
});

test('Pipedrive: people are found by exact email and each gets a note', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
        if (url.includes('/persons/search')) return json(200, { data: { items: [
            { item: { id: 7, name: 'Ana Ruiz', emails: ['ana@acme.com'] } },
            { item: { id: 8, name: 'Other', emails: ['ana@acme.co'] } },
        ] } });
        return json(201, { success: true, data: { id: 1 } });
    };
    const signedIn = { token: 'pd', instanceUrl: 'https://acme.pipedrive.com', fetchImpl };
    const rec = await crm.findCrmRecord('pipedrive', 'ana@acme.com', signedIn);
    assert.deepEqual(rec, { id: '7', name: 'Ana Ruiz' });
    assert.match(calls[0].url, /^https:\/\/acme\.pipedrive\.com\/api\/v1\/persons\/search\?term=ana%40acme\.com&fields=email&exact_match=true/);
    assert.equal(calls[0].headers.Authorization, 'Bearer pd');

    const pasted = { token: 'tok', fetchImpl };
    await crm.findCrmRecord('pipedrive', 'ana@acme.com', pasted);
    assert.match(calls[1].url, /^https:\/\/api\.pipedrive\.com\/v1\/persons\/search/);
    assert.equal(calls[1].headers['x-api-token'], 'tok');

    const doc = { meetingId: 'm', title: 'Acme <demo>', dateIso: '2026-10-17T10:00:00Z', dateLabel: '', attendees: [], participants: [], sections: [{ heading: 'Decisions', bullets: ['Ship it'] }], actionItems: [], transcript: [] };
    const out = await crm.sendCrmNote('pipedrive', doc, [{ id: '7' }, { id: '9' }], signedIn);
    assert.deepEqual(out.sentIds, ['7', '9']);
    const notes = calls.filter((c) => c.url.endsWith('/notes'));
    assert.equal(notes.length, 2);
    assert.equal(notes[0].body.person_id, 7);
    assert.match(notes[0].body.content, /^<p><b>Acme demo<\/b><\/p>/, 'the title is in the note, without markup');
    assert.match(notes[0].body.content, /Ship it/);
});
