// Outlook calendars through Microsoft Graph (2026-10-15).
//
// A public client (no secret) signed in with the authorization code flow and
// PKCE on a loopback redirect, tenant "common". These tests drive the real
// compiled provider: they catch the sign-in URL it opens, answer its loopback
// server the way Microsoft's redirect does, and inspect every request it sends
// to a mocked fetch. No request leaves the machine.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services/calendar/providers');
const graph = require(path.join(dist, 'microsoftGraph.js'));
const { MicrosoftCalendarProvider, OUTLOOK_TOKEN_FILE, outlookFailureReason } = require(path.join(dist, 'MicrosoftCalendarProvider.js'));
const { pkcePair, base64Url } = require(path.join(dist, 'loopbackOAuth.js'));

const tempDirs = [];
after(() => { for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true }); });

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const CONFIG = { clientId: CLIENT_ID, tenant: 'common' };
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

// ─── Configuration ──────────────────────────────────────────────────────────

test('client ID: from the build or env, validated; tenant defaults to common', () => {
    // With no env, the ID the BUILD baked in (scripts/build-electron.js reads
    // .env): none on CI, Natively's own on a machine whose .env has one.
    const baked = graph.microsoftClientConfig({});
    assert.equal(baked.tenant, 'common');
    assert.ok(baked.clientId === '' || /^[A-Za-z0-9-]{8,64}$/.test(baked.clientId), `baked ID: ${baked.clientId}`);
    assert.deepEqual(graph.microsoftClientConfig({ MICROSOFT_CALENDAR_CLIENT_ID: ` ${CLIENT_ID} ` }), CONFIG);
    assert.equal(graph.microsoftClientConfig({ MICROSOFT_CALENDAR_CLIENT_ID: CLIENT_ID, MICROSOFT_CALENDAR_TENANT: 'contoso.onmicrosoft.com' }).tenant, 'contoso.onmicrosoft.com');
    assert.equal(graph.microsoftClientConfig({ MICROSOFT_CALENDAR_CLIENT_ID: CLIENT_ID, MICROSOFT_CALENDAR_TENANT: 'bad/tenant?x' }).tenant, 'common');
    assert.equal(graph.microsoftClientConfig({ MICROSOFT_CALENDAR_CLIENT_ID: 'x y "z"' }).clientId, '');
});

test('no client ID: the row is "unconfigured" and Connect says so in plain words', async () => {
    const { deps } = makeDeps(async () => { throw new Error('no request expected'); });
    const p = new MicrosoftCalendarProvider(deps, 'darwin', () => ({ clientId: '', tenant: 'common' }));
    p.init();
    assert.deepEqual(p.status(), { id: 'outlook', state: 'unconfigured' });
    await assert.rejects(p.connect(), { message: 'Outlook sign-in isn’t available in this version of Natively yet.' });
    assert.equal(deps.opened.length, 0, 'no browser opened');
});

test('sign-in URL: common tenant, the three scopes, S256 PKCE, account picker', () => {
    const url = new URL(graph.microsoftAuthUrl(CONFIG, 'http://localhost:51234', 'CHALLENGE', 'STATE'));
    assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    const q = Object.fromEntries(url.searchParams);
    assert.deepEqual(q, {
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: 'http://localhost:51234',
        response_mode: 'query',
        scope: 'Calendars.Read offline_access User.Read',
        code_challenge: 'CHALLENGE',
        code_challenge_method: 'S256',
        state: 'STATE',
        prompt: 'select_account',
    });
});

test('PKCE pair: a 43-character verifier and its SHA-256 challenge', () => {
    const { verifier, challenge } = pkcePair();
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge, base64Url(crypto.createHash('sha256').update(verifier).digest()));
    assert.notEqual(pkcePair().verifier, verifier);
});

// ─── Event mapping ──────────────────────────────────────────────────────────

const ME = 'me@contoso.com';
function graphEvent(extra = {}) {
    return {
        id: 'AAMk-single',
        iCalUId: '040000008200E00074C5B7101A82E008',
        subject: 'Pricing review',
        start: { dateTime: '2026-11-04T15:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-11-04T15:30:00.0000000', timeZone: 'UTC' },
        isAllDay: false,
        isCancelled: false,
        type: 'singleInstance',
        originalStartTimeZone: 'Pacific Standard Time',
        isOrganizer: false,
        organizer: { emailAddress: { name: 'Dana Ruiz', address: 'dana@contoso.com' } },
        responseStatus: { response: 'accepted' },
        attendees: [
            { type: 'required', status: { response: 'accepted' }, emailAddress: { name: 'Dana Ruiz', address: 'dana@contoso.com' } },
            { type: 'optional', status: { response: 'tentativelyAccepted' }, emailAddress: { name: 'Ken Ito', address: 'ken@fabrikam.com' } },
            { type: 'required', status: { response: 'none' }, emailAddress: { name: 'Me', address: 'ME@contoso.com' } },
            { type: 'resource', status: { response: 'accepted' }, emailAddress: { name: 'Room 12', address: 'room12@contoso.com' } },
        ],
        body: { contentType: 'html', content: '<p>Numbers for <b>Q4</b>&nbsp;pricing.</p>' },
        location: { displayName: 'Room 12' },
        locations: [],
        ...extra,
    };
}

test('mapping: a single meeting', () => {
    const ev = graph.mapGraphEvent(graphEvent(), { selfEmail: ME });
    assert.equal(ev.id, 'outlook:AAMk-single');
    assert.equal(ev.source, 'outlook');
    assert.equal(ev.title, 'Pricing review');
    assert.equal(ev.startTime, '2026-11-04T15:00:00.000Z');
    assert.equal(ev.endTime, '2026-11-04T15:30:00.000Z');
    assert.deepEqual(ev.attendees.map((a) => [a.email, a.name, a.response]), [
        ['dana@contoso.com', 'Dana Ruiz', 'accepted'],
        ['ken@fabrikam.com', 'Ken Ito', 'tentative'],
    ], 'the user and the room are not attendees');
    assert.ok(ev.attendees.every((a) => a.photoUrl.startsWith('https://gravatar.com/avatar/')));
    assert.equal(ev.selfResponse, 'accepted');
    assert.deepEqual(ev.organizer, { email: 'dana@contoso.com', name: 'Dana Ruiz' });
    assert.equal(ev.description, 'Numbers for Q4 pricing.');
    assert.equal(ev.timeZone, 'America/Los_Angeles');
    assert.equal(ev.iCalUID, '040000008200E00074C5B7101A82E008');
    assert.equal(ev.recurringEventId, undefined);
    assert.equal(ev.link, undefined);
});

test('mapping: an occurrence of a series carries seriesMasterId as its series', () => {
    const ev = graph.mapGraphEvent(graphEvent({ id: 'AAMk-occ-1', type: 'occurrence', seriesMasterId: 'AAMk-master' }), { selfEmail: ME });
    assert.equal(ev.id, 'outlook:AAMk-occ-1');
    assert.equal(ev.recurringEventId, 'outlook:AAMk-master');
});

test('mapping: a Teams meeting joins from onlineMeeting.joinUrl; a Zoom link in the body is also a key', () => {
    const teams = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC123%40thread.v2/0?context=%7b%7d';
    const ev = graph.mapGraphEvent(graphEvent({
        onlineMeeting: { joinUrl: teams },
        body: { contentType: 'text', content: 'Backup: https://us02web.zoom.us/j/81234567890?pwd=abc' },
    }), { selfEmail: ME });
    assert.equal(ev.link, teams);
    assert.deepEqual(ev.meetingKeys, ['teams:19:meeting_ABC123@thread.v2', 'zoom:81234567890']);

    const inLocation = graph.mapGraphEvent(graphEvent({ location: { displayName: 'https://meet.google.com/abc-defg-hij' } }));
    assert.equal(inLocation.link, 'https://meet.google.com/abc-defg-hij');
    assert.deepEqual(inLocation.meetingKeys, ['meet:abc-defg-hij']);
});

test('mapping: all-day, cancelled and too-short events are skipped; declined is kept as declined', () => {
    assert.equal(graph.mapGraphEvent(graphEvent({ isAllDay: true })), null);
    assert.equal(graph.mapGraphEvent(graphEvent({ isCancelled: true })), null);
    assert.equal(graph.mapGraphEvent(graphEvent({ end: { dateTime: '2026-11-04T15:02:00', timeZone: 'UTC' } })), null);
    assert.equal(graph.mapGraphEvent({ subject: 'no id' }), null);
    const declined = graph.mapGraphEvent(graphEvent({ responseStatus: { response: 'declined' } }), { selfEmail: ME });
    assert.equal(declined.selfResponse, 'declined');
    const mine = graph.mapGraphEvent(graphEvent({ isOrganizer: true, organizer: { emailAddress: { name: 'Me', address: ME } }, responseStatus: { response: 'organizer' } }), { selfEmail: ME });
    assert.equal(mine.selfResponse, 'accepted');
    assert.equal(mine.organizer.self, true);
});

test('times: UTC, an explicit offset, and a Windows zone name all land on the right instant', () => {
    assert.equal(graph.graphTimeToEpoch({ dateTime: '2026-11-04T15:00:00.0000000', timeZone: 'UTC' }), Date.parse('2026-11-04T15:00:00Z'));
    assert.equal(graph.graphTimeToEpoch({ dateTime: '2026-11-04T15:00:00+01:00' }), Date.parse('2026-11-04T14:00:00Z'));
    assert.equal(graph.graphTimeToEpoch({ dateTime: '2026-11-04T09:00:00.0000000', timeZone: 'Pacific Standard Time' }), Date.parse('2026-11-04T17:00:00Z'));
    assert.ok(Number.isNaN(graph.graphTimeToEpoch({})));
});

test('calendarView request: the window, paging size, fields, soonest first', () => {
    const url = new URL(graph.calendarViewUrl(Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-11-08T00:00:00Z')));
    assert.equal(url.origin + url.pathname, 'https://graph.microsoft.com/v1.0/me/calendarView');
    assert.equal(url.searchParams.get('startDateTime'), '2026-11-01T00:00:00.000Z');
    assert.equal(url.searchParams.get('endDateTime'), '2026-11-08T00:00:00.000Z');
    assert.equal(url.searchParams.get('$top'), '100');
    assert.equal(url.searchParams.get('$orderby'), 'start/dateTime');
    for (const f of ['seriesMasterId', 'onlineMeeting', 'iCalUId', 'responseStatus', 'originalStartTimeZone']) {
        assert.ok(url.searchParams.get('$select').split(',').includes(f), f);
    }
});

// ─── The provider ───────────────────────────────────────────────────────────

function makeDeps(fetchImpl, { now = Date.parse('2026-11-01T00:00:00Z') } = {}) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-test-outlook-'));
    tempDirs.push(userDataDir);
    const clock = { now };
    const opened = [];
    const changes = [];
    const calls = [];
    const deps = {
        userDataDir,
        safeStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (s) => Buffer.from(s).reverse(),
            decryptString: (b) => Buffer.from(b).reverse().toString(),
        },
        openExternal: (u) => { opened.push(u); },
        fetch: async (url, init = {}) => { calls.push({ url: String(url), init }); return fetchImpl(String(url), init); },
        now: () => clock.now,
        onConnectionChanged: () => changes.push('changed'),
        knownSelfEmails: () => [],
        opened,
    };
    return { deps, clock, changes, calls };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function hitRedirect(redirectUri, params) {
    const u = new URL(redirectUri);
    const qs = new URLSearchParams(params).toString();
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: u.port, path: `/?${qs}` }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}

async function waitFor(predicate, ms = 3000) {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > ms) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 10));
    }
}

/** Signs a provider in through its real loopback server; returns what was sent. */
async function signIn({ tokenBody = { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 }, token, me = { displayName: 'Mia Chen', mail: ME } } = {}) {
    const ctx = makeDeps(async (url, init) => {
        if (url === TOKEN_URL) return token ? token() : json(tokenBody);
        if (url.startsWith('https://graph.microsoft.com/v1.0/me?')) return json(me);
        throw new Error(`unexpected ${url}`);
    });
    const p = new MicrosoftCalendarProvider(ctx.deps, 'win32', () => CONFIG);
    p.init();
    assert.deepEqual(p.status(), { id: 'outlook', state: 'disconnected' });
    const connecting = p.connect();
    // Rejects while the redirect is still being answered; awaited below.
    connecting.catch(() => {});
    await waitFor(() => ctx.deps.opened.length === 1);
    const auth = new URL(ctx.deps.opened[0]);
    const redirectUri = auth.searchParams.get('redirect_uri');
    const page = await hitRedirect(redirectUri, { code: 'THE-CODE', state: auth.searchParams.get('state') });
    try {
        await connecting;
    } catch (err) {
        err.page = page;
        throw err;
    }
    return { ...ctx, p, auth, redirectUri, page };
}

test('connect: loopback redirect on localhost, code exchanged with the PKCE verifier and no secret, tokens encrypted', async () => {
    const { p, auth, redirectUri, page, calls, changes, deps } = await signIn();
    assert.match(redirectUri, /^http:\/\/localhost:\d+$/);
    assert.equal(page.status, 200);
    assert.match(page.body, /<html/i);

    const tokenCall = calls.find((c) => c.url === TOKEN_URL);
    const form = Object.fromEntries(new URLSearchParams(tokenCall.init.body));
    assert.equal(tokenCall.init.method, 'POST');
    assert.deepEqual(Object.keys(form).sort(), ['client_id', 'code', 'code_verifier', 'grant_type', 'redirect_uri', 'scope']);
    assert.equal(form.grant_type, 'authorization_code');
    assert.equal(form.code, 'THE-CODE');
    assert.equal(form.redirect_uri, redirectUri);
    assert.equal(form.client_id, CLIENT_ID);
    assert.equal(base64Url(crypto.createHash('sha256').update(form.code_verifier).digest()), auth.searchParams.get('code_challenge'));

    assert.deepEqual(p.status(), { id: 'outlook', state: 'connected', account: 'Mia Chen', detail: ME });
    assert.deepEqual(p.identity(), { email: ME, name: 'Mia Chen' });
    assert.deepEqual(changes, ['changed']);
    const stored = fs.readFileSync(path.join(deps.userDataDir, OUTLOOK_TOKEN_FILE)).toString();
    assert.ok(!stored.includes('RT1') && !stored.includes('AT1'), 'tokens are not stored as plain text');

    const again = new MicrosoftCalendarProvider(deps, 'win32', () => CONFIG);
    again.init();
    assert.equal(again.isConnected(), true);
});

test('connect: a wrong state is refused before any exchange; a grant without refresh token is refused', async () => {
    const ctx = makeDeps(async () => { throw new Error('no exchange expected'); });
    const p = new MicrosoftCalendarProvider(ctx.deps, 'darwin', () => CONFIG);
    const connecting = p.connect();
    connecting.catch(() => {});
    await waitFor(() => ctx.deps.opened.length === 1);
    const redirect = new URL(ctx.deps.opened[0]).searchParams.get('redirect_uri');
    await hitRedirect(redirect, { code: 'X', state: 'forged' });
    await assert.rejects(connecting, { message: 'That sign-in was for a different attempt. Connect again.' });
    assert.equal(ctx.calls.length, 0);

    await assert.rejects(signIn({ tokenBody: { access_token: 'AT1', expires_in: 3600 } }),
        { message: 'Natively needs to stay signed in to read your calendar. Connect again and allow it.' });
});

test('fetch: refreshes an expired token, keeps the rotated refresh token, follows Graph pages only', async () => {
    const ctx = await signIn();
    const { p, calls, clock, deps } = ctx;
    const page1 = { value: [graphEvent({ id: 'A', start: { dateTime: '2026-11-05T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-11-05T10:30:00', timeZone: 'UTC' } })], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=P2' };
    const page2 = { value: [graphEvent({ id: 'B' }), graphEvent({ id: 'allday', isAllDay: true })], '@odata.nextLink': 'https://evil.example/steal' };
    const tokenForms = [];
    deps.fetch = async (url, init = {}) => {
        url = String(url);
        calls.push({ url, init });
        if (url === TOKEN_URL) {
            tokenForms.push(Object.fromEntries(new URLSearchParams(init.body)));
            return json({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 });
        }
        if (url.includes('$skiptoken=P2')) return json(page2);
        if (url.startsWith('https://graph.microsoft.com/v1.0/me/calendarView?')) return json(page1);
        throw new Error(`unexpected ${url}`);
    };
    clock.now += 2 * 3600_000; // past expiry
    const events = await p.fetchEvents(Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-11-08T00:00:00Z'));
    assert.deepEqual(events.map((e) => e.id), ['outlook:B', 'outlook:A'], 'mapped, all-day dropped, soonest first');
    assert.deepEqual(tokenForms.map((f) => [f.grant_type, f.refresh_token]), [['refresh_token', 'RT1']]);
    assert.ok(!calls.some((c) => c.url.startsWith('https://evil.example')), 'a foreign nextLink is not followed');
    const graphCalls = calls.filter((c) => c.url.includes('/me/calendarView'));
    assert.equal(graphCalls.length, 2);
    for (const c of graphCalls) {
        assert.equal(c.init.headers.Authorization, 'Bearer AT2');
        assert.match(c.init.headers.Prefer, /outlook\.timezone="UTC"/);
    }
    // The rotated refresh token is what is stored now.
    const reloaded = new MicrosoftCalendarProvider(deps, 'win32', () => CONFIG);
    reloaded.init();
    deps.fetch = async (url, init = {}) => {
        if (String(url) === TOKEN_URL) { tokenForms.push(Object.fromEntries(new URLSearchParams(init.body))); return json({ access_token: 'AT3', expires_in: 3600 }); }
        return json({ value: [] });
    };
    clock.now += 2 * 3600_000;
    await reloaded.fetchEvents(0, 1);
    assert.equal(tokenForms.at(-1).refresh_token, 'RT2');
});

test('fetch: a 401 refreshes once and retries the page', async () => {
    const { p, deps } = await signIn();
    let graphHits = 0;
    let refreshes = 0;
    deps.fetch = async (url) => {
        url = String(url);
        if (url === TOKEN_URL) { refreshes++; return json({ access_token: 'AT2', expires_in: 3600 }); }
        graphHits++;
        return graphHits === 1 ? json({ error: { code: 'InvalidAuthenticationToken' } }, 401) : json({ value: [graphEvent()] });
    };
    const events = await p.fetchEvents(0, Date.parse('2027-01-01T00:00:00Z'));
    assert.equal(events.length, 1);
    assert.equal(refreshes, 1);
    assert.equal(graphHits, 2);
});

test('refresh: a dead grant disconnects and deletes the tokens; a network failure keeps them', async () => {
    const offline = await signIn();
    offline.deps.fetch = async () => { throw new TypeError('fetch failed'); };
    offline.clock.now += 2 * 3600_000;
    assert.equal(await offline.p.fetchEvents(0, 1), null);
    assert.equal(offline.p.isConnected(), true, 'offline is not signed out');

    const revoked = await signIn();
    revoked.deps.fetch = async () => json({ error: 'invalid_grant', error_description: 'AADSTS70000: The grant was revoked.\r\nTrace ID: abc' }, 400);
    revoked.clock.now += 2 * 3600_000;
    assert.equal(await revoked.p.fetchEvents(0, 1), null);
    assert.equal(revoked.p.isConnected(), false);
    assert.equal(fs.existsSync(path.join(revoked.deps.userDataDir, OUTLOOK_TOKEN_FILE)), false);
    assert.deepEqual(revoked.changes, ['changed', 'changed']);
    assert.deepEqual(revoked.p.status(), { id: 'outlook', state: 'disconnected' });
});

test('refresh: a response that comes back after Disconnect is thrown away, never saved', async () => {
    const ctx = await signIn();
    let answer;
    ctx.deps.fetch = async (url) => {
        if (url === TOKEN_URL) return new Promise((resolve) => { answer = () => resolve(json({ access_token: 'AT9', refresh_token: 'RT9', expires_in: 3600 })); });
        return json({ value: [] });
    };
    ctx.clock.now += 2 * 3600_000;
    const pending = ctx.p.fetchEvents(0, 1);
    await waitFor(() => typeof answer === 'function');
    await ctx.p.disconnect();
    answer();
    assert.equal(await pending, null);
    assert.equal(ctx.p.isConnected(), false, 'the old refresh does not reconnect the account');
    assert.equal(fs.existsSync(path.join(ctx.deps.userDataDir, OUTLOOK_TOKEN_FILE)), false, 'and writes no tokens');
});

test('failed sign-in: the sentence in Settings and on the callback page has no AADSTS code, trace id or HTTP status', async () => {
    const cases = [
        [() => json({ error: 'invalid_request', error_description: 'AADSTS50011: The redirect URI does not match.\r\nTrace ID: 1-2-3\r\nCorrelation ID: 4' }, 400), 'The redirect URI does not match.'],
        [() => json({ error: 'invalid_grant', error_description: 'AADSTS70008: The provided authorization code has expired.' }, 400), 'Microsoft didn’t accept the sign-in code. It may have expired.'],
        [() => { throw new TypeError('fetch failed'); }, 'Natively couldn’t finish signing in. Check your connection and try again.'],
    ];
    for (const [token, sentence] of cases) {
        const err = await signIn({ token }).then(() => null, (e) => e);
        assert.ok(err, 'connect rejected');
        assert.equal(err.message, sentence);
        assert.equal(outlookFailureReason(err), sentence, 'Settings shows the same sentence');
        // escapeHtml leaves the typographic apostrophe as it is.
        assert.ok(err.page.body.includes(sentence), 'the callback page says it too');
        assert.doesNotMatch(err.page.body, /AADSTS|Trace ID|Correlation ID|HTTP 400/);
    }
});

test('disconnect forgets the account', async () => {
    const { p, deps, changes } = await signIn();
    await p.disconnect();
    assert.equal(p.isConnected(), false);
    assert.equal(p.identity(), null);
    assert.equal(fs.existsSync(path.join(deps.userDataDir, OUTLOOK_TOKEN_FILE)), false);
    assert.deepEqual(changes, ['changed', 'changed']);
    assert.equal(await p.fetchEvents(0, 1), null);
});
