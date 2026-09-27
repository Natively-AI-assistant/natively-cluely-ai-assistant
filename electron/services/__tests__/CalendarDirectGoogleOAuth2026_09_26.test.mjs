// Calendar sync talks to Google directly (2026-09-26).
//
// The token exchange used to be proxied through natively-api, which since
// 2026-08-02 requires a paid x-natively-key the desktop never sent, so every
// connect ended in "exchange_failed status=401 auth_required" and every
// refresh silently disconnected. The app now runs the installed-app flow
// itself: a loopback redirect on 127.0.0.1, PKCE, and the token endpoint.
//
// These tests drive the REAL compiled CalendarManager: they catch the Google
// URL it opens, answer its loopback server the way Google's redirect would,
// and inspect the token request it sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const compiled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services/CalendarManager.js');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLIENT_ID = 'test-desktop-client.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-desktop-secret';
const CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const LIST_SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const ALL_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile', EVENTS_SCOPE, LIST_SCOPE];

/** An id_token as Google's token endpoint returns it (the signature is not checked: it arrives over TLS from Google). */
function idToken(claims) {
    const part = (o) => b64url(Buffer.from(JSON.stringify(o)));
    return `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: 'https://accounts.google.com', sub: '1234', ...claims })}.c2ln`;
}

/**
 * A timed Google event starting `inMins` after tomorrow, lasting 30 minutes.
 * Past 24h on purpose: CalendarManager arms a real "starting soon" reminder
 * timer for anything within 24h, and that timer would hold the test process
 * open until it fired.
 */
function gEvent(id, inMins, extra = {}) {
    const start = new Date(Date.now() + (25 * 60 + inMins) * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    return { id, summary: id, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, ...extra };
}

function b64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Loads a fresh CalendarManager against a stubbed electron + fetch. */
function setup({ tokenResponse, savedTokens, calendarList, eventsByCalendar, envOverrides = true } = {}) {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-oauth-'));
    const opened = [];
    const fetchCalls = [];
    const originalLoad = Module._load;
    const originalFetch = globalThis.fetch;
    const previousEnv = {
        id: process.env.GOOGLE_CALENDAR_CLIENT_ID,
        secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    };
    if (envOverrides) {
        process.env.GOOGLE_CALENDAR_CLIENT_ID = CLIENT_ID;
        process.env.GOOGLE_CALENDAR_CLIENT_SECRET = CLIENT_SECRET;
    } else {
        delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
        delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    }

    Module._load = function (request, ...args) {
        if (request === 'electron') return {
            app: { getPath: () => userData, isPackaged: false },
            safeStorage: {
                isEncryptionAvailable: () => true,
                encryptString: (s) => Buffer.from(`enc:${s}`),
                decryptString: (b) => b.toString().slice(4),
            },
            shell: { openExternal: async (u) => { opened.push(u); } },
            net: {},
            Notification: class { on() {} show() {} },
        };
        return originalLoad.call(this, request, ...args);
    };

    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        fetchCalls.push({ url: u, init });
        if (u === TOKEN_URL) {
            const r = typeof tokenResponse === 'function' ? tokenResponse(init) : tokenResponse;
            if (r instanceof Error) throw r;
            return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
        }
        if (u.startsWith(CALENDAR_LIST_URL)) {
            const r = calendarList ?? { status: 200, body: { items: [{ id: 'me@example.com', primary: true, selected: true }] } };
            return new Response(JSON.stringify(r.body), { status: r.status });
        }
        const events = u.match(/^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/]+)\/events\?/);
        if (events) {
            const id = decodeURIComponent(events[1]);
            const items = eventsByCalendar?.[id] ?? [];
            return new Response(JSON.stringify({ items }), { status: 200 });
        }
        throw new Error(`unexpected fetch ${u}`);
    };

    if (savedTokens) {
        fs.writeFileSync(path.join(userData, 'calendar_tokens.enc'), Buffer.from(`enc:${JSON.stringify(savedTokens)}`));
    }

    delete require.cache[require.resolve(compiled)];
    const { CalendarManager } = require(compiled);
    const cm = CalendarManager.getInstance();
    cm.init();

    const restore = async () => {
        // A test that fails mid-connect leaves the flow waiting on its loopback
        // server and 5-minute timeout, which holds the process open. Answer it
        // the way Google does when the user cancels, so it closes now.
        const pending = opened.at(-1);
        if (pending) {
            const auth = new URL(pending);
            await hitRedirect(auth.searchParams.get('redirect_uri'), { error: 'access_denied', state: auth.searchParams.get('state') }).catch(() => {});
        }
        Module._load = originalLoad;
        globalThis.fetch = originalFetch;
        for (const [k, v] of [['GOOGLE_CALENDAR_CLIENT_ID', previousEnv.id], ['GOOGLE_CALENDAR_CLIENT_SECRET', previousEnv.secret]]) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        delete require.cache[require.resolve(compiled)];
    };
    return { cm, opened, fetchCalls, userData, restore };
}

async function waitFor(predicate, ms = 3000) {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > ms) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 10));
    }
}

/** Plays Google's redirect back to the app's loopback server. */
function hitRedirect(redirectUri, params) {
    const target = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    return new Promise((resolve, reject) => {
        http.get(target, (res) => {
            let body = '';
            res.on('data', (d) => { body += d; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}

test('connect: PKCE + state + 127.0.0.1 loopback, and the code goes straight to Google', async () => {
    const env = setup({ tokenResponse: { status: 200, body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 } } });
    try {
        const flow = env.cm.startAuthFlow();
        await waitFor(() => env.opened.length === 1);
        const auth = new URL(env.opened[0]);

        assert.equal(auth.origin + auth.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
        assert.equal(auth.searchParams.get('client_id'), CLIENT_ID);
        assert.deepEqual(auth.searchParams.get('scope').split(' '), ALL_SCOPES,
            'identity + events + the calendar list, and nothing broader: calendar.readonly would also grant calendar settings and sharing, and calendar.calendars.readonly adds nothing a calendar-list entry lacks');
        assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
        assert.match(auth.searchParams.get('code_challenge') || '', /^[A-Za-z0-9_-]{43}$/);
        const state = auth.searchParams.get('state');
        assert.ok(state && state.length >= 16, 'state must be a random value');
        const redirectUri = auth.searchParams.get('redirect_uri');
        assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/, 'Google\'s installed-app loopback form, not localhost');

        const page = await hitRedirect(redirectUri, { code: 'auth-code-1', state });
        await flow;
        assert.equal(page.status, 200);

        const tokenCalls = env.fetchCalls.filter((c) => c.url === TOKEN_URL);
        assert.equal(tokenCalls.length, 1);
        assert.equal(env.fetchCalls.some((c) => c.url.includes('natively.software')), false, 'natively-api is no longer in the path');
        const form = new URLSearchParams(String(tokenCalls[0].init.body));
        assert.equal(form.get('grant_type'), 'authorization_code');
        assert.equal(form.get('code'), 'auth-code-1');
        assert.equal(form.get('client_id'), CLIENT_ID);
        assert.equal(form.get('client_secret'), CLIENT_SECRET);
        assert.equal(form.get('redirect_uri'), redirectUri, 'must match the authorize request exactly');
        const verifier = form.get('code_verifier');
        assert.equal(b64url(crypto.createHash('sha256').update(verifier).digest()), auth.searchParams.get('code_challenge'));

        assert.equal(env.cm.getConnectionStatus().connected, true);
        const saved = fs.readFileSync(path.join(env.userData, 'calendar_tokens.enc')).toString();
        assert.match(saved, /"refreshToken":"rt-1"/);
    } finally {
        await env.restore();
    }
});

test('connect: a callback with the wrong state is refused and no code is exchanged', async () => {
    const env = setup({ tokenResponse: { status: 200, body: { access_token: 'x', expires_in: 3600 } } });
    try {
        const flow = env.cm.startAuthFlow();
        const settled = flow.then(() => 'resolved', (e) => e);
        await waitFor(() => env.opened.length === 1);
        const redirectUri = new URL(env.opened[0]).searchParams.get('redirect_uri');

        await hitRedirect(redirectUri, { code: 'stolen-code', state: 'forged' });
        const outcome = await settled;
        assert.ok(outcome instanceof Error, 'the flow must fail');
        assert.match(outcome.message, /state/i);
        assert.equal(env.fetchCalls.filter((c) => c.url === TOKEN_URL).length, 0);
        assert.equal(env.cm.getConnectionStatus().connected, false);
    } finally {
        await env.restore();
    }
});

test('connect: Google\'s error comes back as a readable failure', async () => {
    const env = setup({ tokenResponse: { status: 400, body: { error: 'invalid_client', error_description: 'The OAuth client was not found.' } } });
    try {
        const flow = env.cm.startAuthFlow();
        const settled = flow.then(() => 'resolved', (e) => e);
        await waitFor(() => env.opened.length === 1);
        const auth = new URL(env.opened[0]);
        await hitRedirect(auth.searchParams.get('redirect_uri'), { code: 'c', state: auth.searchParams.get('state') });
        const outcome = await settled;
        assert.ok(outcome instanceof Error);
        assert.match(outcome.message, /invalid_client/);
        assert.equal(env.cm.getConnectionStatus().connected, false);
    } finally {
        await env.restore();
    }
});

test('refresh: goes to Google with the stored refresh token and the client credentials', async () => {
    const env = setup({
        savedTokens: { accessToken: 'old', refreshToken: 'rt-keep', expiryDate: Date.now() - 1000 },
        tokenResponse: { status: 200, body: { access_token: 'fresh', expires_in: 3600 } },
    });
    try {
        await env.cm.getUpcomingEvents(true);
        const tokenCalls = env.fetchCalls.filter((c) => c.url === TOKEN_URL);
        assert.ok(tokenCalls.length >= 1);
        const form = new URLSearchParams(String(tokenCalls.at(-1).init.body));
        assert.equal(form.get('grant_type'), 'refresh_token');
        assert.equal(form.get('refresh_token'), 'rt-keep');
        assert.equal(form.get('client_id'), CLIENT_ID);
        assert.equal(form.get('client_secret'), CLIENT_SECRET);
        assert.equal(env.fetchCalls.some((c) => c.url.includes('natively.software')), false);
        assert.equal(env.cm.getConnectionStatus().connected, true);
        const saved = fs.readFileSync(path.join(env.userData, 'calendar_tokens.enc')).toString();
        assert.match(saved, /"accessToken":"fresh"/);
        assert.match(saved, /"refreshToken":"rt-keep"/, 'Google omits refresh_token on refresh; the stored one is kept');
    } finally {
        await env.restore();
    }
});

test('refresh: a revoked grant disconnects and deletes the stored tokens', async () => {
    const env = setup({
        savedTokens: { accessToken: 'old', refreshToken: 'rt-revoked', expiryDate: Date.now() - 1000 },
        tokenResponse: { status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } },
    });
    try {
        await env.cm.getUpcomingEvents(true);
        assert.equal(env.cm.getConnectionStatus().connected, false);
        assert.equal(fs.existsSync(path.join(env.userData, 'calendar_tokens.enc')), false);
    } finally {
        await env.restore();
    }
});

test('refresh: a network failure keeps the connection and the stored tokens', async () => {
    const env = setup({
        savedTokens: { accessToken: 'old', refreshToken: 'rt-keep', expiryDate: Date.now() - 1000 },
        tokenResponse: new TypeError('fetch failed'),
    });
    try {
        await env.cm.getUpcomingEvents(true);
        assert.equal(env.cm.getConnectionStatus().connected, true, 'an offline laptop must not lose its calendar');
        assert.equal(fs.existsSync(path.join(env.userData, 'calendar_tokens.enc')), true);
    } finally {
        await env.restore();
    }
});

/** Runs the connect flow to completion against the given token response. */
async function connect(env) {
    const flow = env.cm.startAuthFlow();
    const settled = flow.then(() => 'resolved', (e) => e);
    await waitFor(() => env.opened.length === 1);
    const auth = new URL(env.opened[0]);
    await hitRedirect(auth.searchParams.get('redirect_uri'), { code: 'c', state: auth.searchParams.get('state') });
    return settled;
}

test('identity: the id_token names the connected account, and it survives a restart', async () => {
    const env = setup({ tokenResponse: { status: 200, body: {
        access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: ALL_SCOPES.join(' '),
        id_token: idToken({ email: 'evin@example.com', name: 'Evin John' }),
    } } });
    try {
        assert.equal(await connect(env), 'resolved');
        assert.deepEqual(env.cm.getConnectionStatus(), { connected: true, email: 'evin@example.com', name: 'Evin John' });

        // A fresh process reads the account back from the encrypted token file.
        delete require.cache[require.resolve(compiled)];
        const again = require(compiled).CalendarManager.getInstance();
        again.init();
        assert.equal(again.getConnectionStatus().email, 'evin@example.com');
    } finally {
        await env.restore();
    }
});

test('granular consent: unticking event access fails the connect with a readable reason', async () => {
    const env = setup({ tokenResponse: { status: 200, body: {
        access_token: 'at', refresh_token: 'rt', expires_in: 3600,
        scope: ALL_SCOPES.filter((s) => s !== EVENTS_SCOPE).join(' '),
    } } });
    try {
        const outcome = await connect(env);
        assert.ok(outcome instanceof Error, 'connected without the one permission sync needs');
        assert.match(outcome.message, /calendar events/i);
        assert.equal(env.cm.getConnectionStatus().connected, false);
        assert.equal(fs.existsSync(path.join(env.userData, 'calendar_tokens.enc')), false, 'the useless grant is not stored');
    } finally {
        await env.restore();
    }
});

test('events: merged from every calendar ticked in Google Calendar, soonest first, one copy per meeting', async () => {
    const shared = { iCalUID: 'standup@example.com' };
    const env = setup({
        savedTokens: { accessToken: 'at', refreshToken: 'rt', expiryDate: Date.now() + 3_600_000 },
        calendarList: { status: 200, body: { items: [
            { id: 'me@example.com', primary: true, selected: true },
            { id: 'work#team@group.calendar.google.com', selected: true },
            { id: 'unticked@group.calendar.google.com', selected: false },
            { id: 'gone@group.calendar.google.com', selected: true, deleted: true },
        ] } },
        eventsByCalendar: {
            'me@example.com': [gEvent('primary-later', 120), gEvent('standup', 30, shared)],
            'work#team@group.calendar.google.com': [gEvent('work-soonest', 10, { attendees: [{ email: ' Ana.Ruiz@Example.com ', displayName: 'Ana Ruiz' }, { email: 'me@example.com', self: true }] }), gEvent('standup', 30, shared)],
            'unticked@group.calendar.google.com': [gEvent('should-not-appear', 5)],
        },
    });
    try {
        const events = await env.cm.getUpcomingEvents(true);
        assert.deepEqual(events.map((e) => e.title), ['work-soonest', 'standup', 'primary-later']);
        // Gravatar by the SHA-256 of the trimmed, lowercased email; the
        // user's own entry (self) is not listed. Only the hash leaves the app.
        const hash = crypto.createHash('sha256').update('ana.ruiz@example.com').digest('hex');
        assert.deepEqual(events[0].attendees.map((a) => a.photoUrl), [`https://gravatar.com/avatar/${hash}?s=64&d=404`]);
        assert.equal(events[0].attendees[0].photoUrl.includes('example.com'), false, 'the address itself never goes to Gravatar');
        const fetched = env.fetchCalls.map((c) => c.url).filter((u) => u.includes('/events?'));
        assert.equal(fetched.some((u) => u.includes('unticked')), false, 'a calendar hidden in Google Calendar is not synced');
        assert.equal(fetched.some((u) => u.includes(encodeURIComponent('work#team@group.calendar.google.com'))), true, 'calendar ids are URL-encoded');
    } finally {
        await env.restore();
    }
});

test('events: without calendar-list access, sync falls back to the primary calendar', async () => {
    const env = setup({
        savedTokens: { accessToken: 'at', refreshToken: 'rt', expiryDate: Date.now() + 3_600_000 },
        calendarList: { status: 403, body: { error: { code: 403, message: 'Request had insufficient authentication scopes.' } } },
        eventsByCalendar: { primary: [gEvent('from-primary', 15)] },
    });
    try {
        const events = await env.cm.getUpcomingEvents(true);
        assert.deepEqual(events.map((e) => e.title), ['from-primary']);
    } finally {
        await env.restore();
    }
});

test('settings: the synced calendars are listed by name, primary first; without list access, just the primary', async () => {
    const env = setup({
        savedTokens: { accessToken: 'at', refreshToken: 'rt', expiryDate: Date.now() + 3_600_000, email: 'evin@example.com' },
        calendarList: { status: 200, body: { items: [
            { id: 'work@group.calendar.google.com', summary: 'Work', selected: true, backgroundColor: '#9fe1e7' },
            { id: 'evin@example.com', summary: 'evin@example.com', summaryOverride: 'Personal', primary: true, selected: true },
            { id: 'hidden@group.calendar.google.com', summary: 'Hidden', selected: false },
        ] } },
    });
    try {
        assert.deepEqual(await env.cm.getSyncedCalendars(), [
            { id: 'evin@example.com', name: 'Personal', primary: true },
            { id: 'work@group.calendar.google.com', name: 'Work', primary: false, color: '#9fe1e7' },
        ]);
    } finally {
        await env.restore();
    }

    const noList = setup({
        savedTokens: { accessToken: 'at', refreshToken: 'rt', expiryDate: Date.now() + 3_600_000, email: 'evin@example.com' },
        calendarList: { status: 403, body: {} },
    });
    try {
        assert.deepEqual(await noList.cm.getSyncedCalendars(), [{ id: 'primary', name: 'evin@example.com', primary: true }]);
    } finally {
        await noList.restore();
    }
});

test('packaged build: with no env overrides, connect still opens Google with the committed client ID', async () => {
    // A packaged app never loads .env. Reading the ID from the environment is
    // how every release before 2026-09-26 shipped the "YOUR_CLIENT_ID_HERE"
    // placeholder and refused to connect.
    const env = setup({ envOverrides: false, tokenResponse: { status: 400, body: { error: 'invalid_grant' } } });
    try {
        const flow = env.cm.startAuthFlow();
        flow.catch(() => {});
        await waitFor(() => env.opened.length === 1);
        const clientId = new URL(env.opened[0]).searchParams.get('client_id');
        assert.match(clientId, /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
        assert.notEqual(clientId, CLIENT_ID, 'this must be the committed default, not the test override');
    } finally {
        await env.restore();
    }
});
