// Settings › Connectors › Gmail (outputs/gmail.ts, outputs/gmailIpc.ts) and the
// brief's "Recent emails with these people" (assist/meetingBrief.ts,
// AssistService). Google is a fake fetch; the browser is a plain HTTP GET to
// the loopback port; userData is a temp folder; safeStorage is a pass-through.
// No network, no Electron, no model.
//
// Nothing here branches on the platform: the callback page's close keys are
// the one platform-shaped output, and the sign-in runs with both 'darwin' and
// 'win32' below.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => require(path.join(REPO, 'dist-electron/electron/services', p));
const gmail = dist('outputs/gmail.js');
const gmailIpc = dist('outputs/gmailIpc.js');
const briefMod = dist('assist/meetingBrief.js');
const svcMod = dist('assist/AssistService.js');

const CLIENT = { id: 'client-123.apps.googleusercontent.com', secret: 'shh' };
const READ = 'https://www.googleapis.com/auth/gmail.readonly';
const SEND = 'https://www.googleapis.com/auth/gmail.send';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const idToken = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

function userData() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-gmail-'));
    const safeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s, 'utf8'),
        decryptString: (b) => b.toString('utf8'),
    };
    return { dir, safeStorage, file: path.join(dir, 'gmail_tokens.enc') };
}

/** A fake Google: routes by URL without the query; records every call. */
function fakeGoogle(routes) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
        const u = new URL(url);
        const key = `${init.method || 'GET'} ${u.origin}${u.pathname}`;
        calls.push({ url, key, init, form: typeof init.body === 'string' && init.headers?.['Content-Type']?.includes('urlencoded') ? Object.fromEntries(new URLSearchParams(init.body)) : undefined, json: typeof init.body === 'string' && init.headers?.['Content-Type'] === 'application/json' ? JSON.parse(init.body) : undefined });
        const route = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1];
        if (!route) return res(404, { error: { code: 404 } });
        return typeof route === 'function' ? route(url, init, calls) : route;
    };
    return { calls, fetchImpl };
}

const get = (url) => new Promise((resolve, reject) => {
    http.get(url, (r) => { let body = ''; r.on('data', (c) => { body += c; }); r.on('end', () => resolve({ status: r.statusCode, body })); }).on('error', reject);
});

function service(over = {}) {
    const u = over.userData ?? userData();
    const svc = new gmail.GmailService({
        userDataDir: u.dir,
        safeStorage: u.safeStorage,
        client: () => over.client ?? CLIENT,
        openExternal: over.openExternal ?? (() => {}),
        platform: over.platform ?? 'darwin',
        fetchImpl: over.fetchImpl,
        now: over.now,
        grantShared: over.grantShared,
    });
    return { svc, ...u };
}

/** Plays the browser: reads the auth URL, then sends Google's redirect back to the loopback port. */
function browser(params, seen) {
    return (url) => {
        const u = new URL(url);
        seen.push(u);
        const back = new URL(u.searchParams.get('redirect_uri'));
        for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
        back.searchParams.set('state', u.searchParams.get('state'));
        // The sign-in settles as the page is sent; tests await the page itself.
        seen.done = get(back.toString()).then((page) => { seen.page = page; });
        return seen.done;
    };
}

const TOKEN = 'POST https://oauth2.googleapis.com/token';
const granted = (scope, extra = {}) => res(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope, id_token: idToken({ email: 'me@acme.com' }), ...extra });

function saveTokens(u, over = {}) {
    fs.writeFileSync(u.file, JSON.stringify({ accessToken: 'at-old', refreshToken: 'rt-1', expiresAt: 10_000_000, account: 'me@acme.com', scopes: [READ, SEND], briefsEnabled: true, connectedAt: 1, ...over }));
}

describe('connect', () => {
    for (const platform of ['darwin', 'win32']) {
        test(`the auth URL asks for both Gmail scopes offline with PKCE, and the tokens are saved (${platform})`, async () => {
            const seen = [];
            const { calls, fetchImpl } = fakeGoogle({ [TOKEN]: granted(`openid https://www.googleapis.com/auth/userinfo.email ${READ} ${SEND}`) });
            const { svc, file } = service({ fetchImpl, platform, openExternal: browser({ code: 'the-code' }, seen) });
            const out = await svc.connect();
            assert.equal(out.account, 'me@acme.com');

            const u = seen[0];
            assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
            assert.deepEqual(u.searchParams.get('scope').split(' '), ['openid', 'email', READ, SEND]);
            assert.equal(u.searchParams.get('access_type'), 'offline');
            assert.equal(u.searchParams.get('prompt'), 'consent');
            assert.equal(u.searchParams.get('include_granted_scopes'), 'true');
            assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
            assert.equal(u.searchParams.get('response_type'), 'code');
            assert.equal(u.searchParams.get('client_id'), CLIENT.id);
            assert.equal(u.searchParams.get('login_hint'), null);
            assert.match(u.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+$/);

            const ex = calls.find((c) => c.key === TOKEN).form;
            assert.equal(ex.grant_type, 'authorization_code');
            assert.equal(ex.code, 'the-code');
            assert.equal(ex.redirect_uri, u.searchParams.get('redirect_uri'));
            assert.equal(ex.client_secret, CLIENT.secret);
            const challenge = crypto.createHash('sha256').update(ex.code_verifier).digest('base64url');
            assert.equal(challenge, u.searchParams.get('code_challenge'), 'the verifier matches the challenge');

            await seen.done;
            assert.equal(seen.page.status, 200);
            assert.match(seen.page.body, /Gmail connected/);
            assert.match(seen.page.body, /briefs can now use Gmail/);
            assert.match(seen.page.body, platform === 'darwin' ? /⌘W/ : /Ctrl\+W/);

            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            assert.equal(saved.refreshToken, 'rt-1');
            assert.equal(saved.briefsEnabled, true);
            assert.deepEqual(svc.status(), { available: true, connected: true, account: 'me@acme.com', briefsEnabled: true });
        });
    }

    test('without an id_token the address comes from userinfo', async () => {
        const seen = [];
        const { fetchImpl } = fakeGoogle({
            [TOKEN]: granted(`${READ} ${SEND}`, { id_token: undefined }),
            'GET https://www.googleapis.com/oauth2/v3/userinfo': res(200, { email: 'other@acme.com' }),
        });
        const { svc } = service({ fetchImpl, openExternal: browser({ code: 'c' }, seen) });
        assert.equal((await svc.connect()).account, 'other@acme.com');
    });

    test('an unticked Gmail box keeps nothing and says why in plain words', async () => {
        const seen = [];
        const { fetchImpl } = fakeGoogle({ [TOKEN]: granted(`openid ${READ}`) });
        const { svc, file } = service({ fetchImpl, openExternal: browser({ code: 'c' }, seen) });
        await assert.rejects(svc.connect(), (e) => /read and send your email/.test(e.message));
        assert.equal(fs.existsSync(file), false);
        assert.equal(svc.status().connected, false);
        await seen.done;
        assert.match(seen.page.body, /read and send your email/);
    });

    test('a refusal on the consent screen is a sentence; nothing is saved', async () => {
        const { svc, file } = service({ fetchImpl: fakeGoogle({}).fetchImpl, openExternal: browser({ error: 'access_denied' }, []) });
        await assert.rejects(svc.connect(), /declined/);
        assert.equal(fs.existsSync(file), false);
    });

    test('Cancel stops waiting', async () => {
        const ctl = new AbortController();
        const { svc } = service({ fetchImpl: fakeGoogle({}).fetchImpl, openExternal: () => { setTimeout(() => ctl.abort(), 10); } });
        await assert.rejects(svc.connect({ signal: ctl.signal }), /cancelled/);
    });

    test('a build without the Google client is unavailable and never opens the browser', async () => {
        let opened = false;
        const { svc } = service({ client: { id: 'x', secret: '' }, openExternal: () => { opened = true; } });
        assert.equal(svc.status().available, false);
        await assert.rejects(svc.connect(), (e) => e.name === 'GmailError' && /not available/.test(e.message));
        assert.equal(opened, false);
    });
});

describe('tokens', () => {
    test('renewed two minutes before they run out, and only then; the refresh token is kept', async () => {
        const u = userData();
        saveTokens(u, { expiresAt: 1_000_000 + 5 * 60_000 });
        let now = 1_000_000;
        const { calls, fetchImpl } = fakeGoogle({ [TOKEN]: res(200, { access_token: 'at-new', expires_in: 3600 }) });
        const { svc } = service({ userData: u, fetchImpl, now: () => now });
        assert.equal(await svc.accessToken(), 'at-old');
        assert.equal(calls.length, 0);
        now += 3.5 * 60_000; // inside the margin
        assert.equal(await svc.accessToken(), 'at-new');
        assert.equal(calls[0].form.grant_type, 'refresh_token');
        assert.equal(calls[0].form.refresh_token, 'rt-1');
        const saved = JSON.parse(fs.readFileSync(u.file, 'utf8'));
        assert.equal(saved.accessToken, 'at-new');
        assert.equal(saved.refreshToken, 'rt-1');
        assert.equal(saved.expiresAt, now + 3600_000);
    });

    test('concurrent renewals share one request', async () => {
        const u = userData();
        saveTokens(u, { expiresAt: 0 });
        let hits = 0;
        const { fetchImpl } = fakeGoogle({ [TOKEN]: async () => { hits++; await new Promise((r) => setTimeout(r, 20)); return res(200, { access_token: 'at-new', expires_in: 3600 }); } });
        const { svc } = service({ userData: u, fetchImpl });
        const [a, b] = await Promise.all([svc.accessToken(), svc.accessToken()]);
        assert.equal(a, 'at-new');
        assert.equal(b, 'at-new');
        assert.equal(hits, 1);
    });

    test('a refused token is renewed once and the call retried', async () => {
        const u = userData();
        saveTokens(u, { expiresAt: Date.now() + 3600_000 });
        const used = [];
        const { calls, fetchImpl } = fakeGoogle({
            [TOKEN]: res(200, { access_token: 'at-fresh', expires_in: 3600 }),
            'POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send': (_url, init) => {
                used.push(init.headers.Authorization);
                return init.headers.Authorization === 'Bearer at-old' ? res(401, { error: { code: 401 } }) : res(200, { id: 'm1', threadId: 't1' });
            },
        });
        const { svc } = service({ userData: u, fetchImpl });
        const sent = await svc.sendMessage({ to: ['a@b.com'], subject: 'Hi', body: 'Hello' });
        assert.equal(sent.id, 'm1');
        assert.deepEqual(used, ['Bearer at-old', 'Bearer at-fresh']);
        assert.equal(calls.filter((c) => c.key === TOKEN).length, 1);
    });

    test('invalid_grant disconnects with a plain message and deletes the file', async () => {
        const u = userData();
        saveTokens(u, { expiresAt: 0 });
        const { fetchImpl } = fakeGoogle({ [TOKEN]: res(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }) });
        const { svc } = service({ userData: u, fetchImpl });
        await assert.rejects(svc.accessToken(), (e) => e.name === 'GmailError' && e.kind === 'auth' && /Connect Gmail again/.test(e.message) && !/invalid_grant|\d{3}/.test(e.message));
        assert.equal(fs.existsSync(u.file), false);
        assert.equal(svc.status().connected, false);
    });

    test('the brief switch is kept with the tokens', () => {
        const u = userData();
        saveTokens(u);
        const { svc } = service({ userData: u });
        assert.equal(svc.setBriefsEnabled(false).briefsEnabled, false);
        assert.equal(JSON.parse(fs.readFileSync(u.file, 'utf8')).briefsEnabled, false);
        assert.equal(service({ userData: u }).svc.status().briefsEnabled, false, 'after a restart');
        assert.equal(service().svc.setBriefsEnabled(true).briefsEnabled, false, 'not connected: off');
    });
});

describe('disconnect', () => {
    test('revokes at Google and deletes the file', async () => {
        const u = userData();
        saveTokens(u);
        const { calls, fetchImpl } = fakeGoogle({ 'POST https://oauth2.googleapis.com/revoke': res(200, {}) });
        const { svc } = service({ userData: u, fetchImpl });
        await svc.disconnect();
        assert.equal(calls[0].form.token, 'rt-1');
        assert.equal(fs.existsSync(u.file), false);
        assert.equal(svc.status().connected, false);
    });

    test('offline still forgets the tokens', async () => {
        const u = userData();
        saveTokens(u);
        const { svc } = service({ userData: u, fetchImpl: async () => { throw new Error('offline'); } });
        await svc.disconnect();
        assert.equal(fs.existsSync(u.file), false);
    });

    test('Calendar on the same Google account: no revoke, which would end Calendar too', async () => {
        const u = userData();
        saveTokens(u);
        const { calls, fetchImpl } = fakeGoogle({ 'POST https://oauth2.googleapis.com/revoke': res(200, {}) });
        const asked = [];
        const { svc } = service({ userData: u, fetchImpl, grantShared: (a) => { asked.push(a); return true; } });
        await svc.disconnect();
        assert.deepEqual(asked, ['me@acme.com']);
        assert.equal(calls.length, 0);
        assert.equal(fs.existsSync(u.file), false);
    });
});

describe('threads with the attendees', () => {
    test('the search names each address both ways, escapes nothing it should not, and drops bad input', () => {
        assert.equal(gmail.buildThreadsQuery(['Priya@Client.com', 'rob@client.com', 'priya@client.com']),
            '(from:priya@client.com OR to:priya@client.com OR from:rob@client.com OR to:rob@client.com) newer_than:90d -in:chats');
        assert.equal(gmail.buildThreadsQuery(['a@b.com'], 30), '(from:a@b.com OR to:a@b.com) newer_than:30d -in:chats');
        for (const bad of ['a@b.com) OR (x', 'a b@c.com', '"q"@c.com', 'a@b', 'x{y}@c.com', 'a@b.com\nBcc: z@z.com', 42, null]) {
            assert.equal(gmail.normaliseAddress(bad), null, String(bad));
        }
        assert.equal(gmail.buildThreadsQuery(['nope', '']), null);
        assert.equal(gmail.buildThreadsQuery('a@b.com'), null);
    });

    const threadsRoutes = (n) => ({
        'GET https://gmail.googleapis.com/gmail/v1/users/me/threads': res(200, { threads: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, snippet: `list ${i}` })) }),
        'GET https://gmail.googleapis.com/gmail/v1/users/me/threads/*': (url) => {
            const id = new URL(url).pathname.split('/').pop();
            return res(200, {
                id,
                messages: [
                    { id: `${id}a`, internalDate: '1760000000000', snippet: 'first', payload: { headers: [{ name: 'Subject', value: `Pilot ${id}` }, { name: 'From', value: 'Priya <priya@client.com>' }] } },
                    { id: `${id}b`, internalDate: String(1760000000000 + Number(id.slice(1)) * 1000), snippet: 'It&#39;s ready &amp; signed', payload: { headers: [{ name: 'From', value: 'Rob <rob@client.com>' }, { name: 'Date', value: 'x' }] } },
                ],
            });
        },
    });

    test('lists, reads at most eight threads as metadata, and parses them newest first', async () => {
        const u = userData();
        saveTokens(u, { expiresAt: Date.now() + 3600_000 });
        const { calls, fetchImpl } = fakeGoogle(threadsRoutes(12));
        const { svc } = service({ userData: u, fetchImpl });
        const out = await svc.threadsWithPeople(['priya@client.com'], { max: 50 });
        const list = new URL(calls[0].url);
        assert.equal(list.searchParams.get('q'), '(from:priya@client.com OR to:priya@client.com) newer_than:90d -in:chats');
        assert.equal(list.searchParams.get('maxResults'), '8');
        const gets = calls.slice(1);
        assert.equal(gets.length, 8);
        const one = new URL(gets[0].url);
        assert.equal(one.searchParams.get('format'), 'metadata');
        assert.deepEqual(one.searchParams.getAll('metadataHeaders'), ['Subject', 'From', 'Date']);
        assert.equal(out.length, 8);
        assert.equal(out[0].threadId, 't7');
        assert.deepEqual(out[0], {
            threadId: 't7', subject: 'Pilot t7', from: 'Rob <rob@client.com>', date: new Date(1760000007000).toISOString(),
            snippet: 'It\'s ready & signed', url: 'https://mail.google.com/mail/u/me%40acme.com/#all/t7',
        });
    });

    test('brief switch off, or no usable address: no call at all', async () => {
        const u = userData();
        saveTokens(u, { briefsEnabled: false });
        const { calls, fetchImpl } = fakeGoogle(threadsRoutes(2));
        assert.deepEqual(await service({ userData: u, fetchImpl }).svc.threadsWithPeople(['a@b.com']), []);
        const v = userData();
        saveTokens(v);
        assert.deepEqual(await service({ userData: v, fetchImpl }).svc.threadsWithPeople(['bad']), []);
        assert.equal(calls.length, 0);
    });
});

describe('the message', () => {
    test('UTF-8 subject as RFC 2047 words, CRLF everywhere, base64 body; base64url for the API', () => {
        const subject = 'Suivi de la réunion: prochaines étapes pour le pilote 🚀 avec Zoë';
        const mime = gmail.buildMimeMessage({ to: ['a@b.com', 'c@d.com'], subject, body: 'Bonjour,\nMerci ! ça marche.\n\nÀ bientôt' });
        assert.doesNotMatch(mime.replace(/\r\n/g, ''), /[\r\n]/, 'no bare CR or LF');
        const [head, body] = mime.split('\r\n\r\n');
        const lines = head.split('\r\n');
        assert.equal(lines[0], 'To: a@b.com, c@d.com');
        assert.ok(lines.includes('Content-Type: text/plain; charset="UTF-8"'));
        assert.ok(lines.includes('Content-Transfer-Encoding: base64'));
        assert.ok(lines.includes('MIME-Version: 1.0'));
        const subj = head.slice(head.indexOf('Subject: ') + 9, head.indexOf('\r\nMIME-Version'));
        const words = subj.split('\r\n ');
        assert.ok(words.length > 1, 'folded');
        for (const w of words) {
            assert.match(w, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
            assert.ok(w.length <= 75);
        }
        const decoded = words.map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('');
        assert.equal(decoded, subject);
        assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Bonjour,\r\nMerci ! ça marche.\r\n\r\nÀ bientôt');
        for (const l of body.split('\r\n')) assert.ok(l.length <= 76);
        const raw = gmail.base64Url(mime);
        assert.doesNotMatch(raw, /[+/=]/);
        assert.equal(Buffer.from(raw, 'base64url').toString('utf8'), mime);
    });

    test('an ASCII subject stays plain; line breaks cannot add headers', () => {
        assert.equal(gmail.encodeHeaderWord('Weekly sync'), 'Weekly sync');
        const mime = gmail.buildMimeMessage({ to: ['a@b.com'], subject: 'Hi\r\nBcc: evil@x.com', body: 'x' });
        assert.doesNotMatch(mime, /\r\nBcc:/);
        assert.equal(gmail.validateOutgoing({ to: ['a@b.com'], subject: 'Hi\nBcc: e@x.com', body: 'x' }).subject, 'Hi Bcc: e@x.com');
    });

    test('validation: recipients, subject and size', () => {
        const bad = (input, re) => assert.throws(() => gmail.validateOutgoing(input), (e) => e.name === 'GmailError' && re.test(e.message));
        bad({ to: [], subject: 's', body: 'b' }, /at least one/);
        bad({ to: Array.from({ length: 51 }, (_, i) => `p${i}@x.com`), subject: 's', body: 'b' }, /at most 50/);
        bad({ to: ['Priya <priya@client.com>'], subject: 's', body: 'b' }, /not an email address/);
        bad({ to: ['a@b.com'], subject: '  ', body: 'b' }, /subject/);
        bad({ to: ['a@b.com'], subject: 's', body: '   ' }, /empty/);
        bad({ to: ['a@b.com'], subject: 's', body: 'x'.repeat(256 * 1024 + 1) }, /too long/);
        assert.deepEqual(gmail.validateOutgoing({ to: ['A@b.com', 'a@B.com', 'c@d.com'], subject: 's', body: 'b' }).to, ['a@b.com', 'c@d.com']);
    });

    test('send: one POST of the raw message; the Sent link names the account', async () => {
        const u = userData();
        saveTokens(u, { expiresAt: Date.now() + 3600_000 });
        const { calls, fetchImpl } = fakeGoogle({ 'POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send': res(200, { id: 'm9', threadId: 't9' }) });
        const { svc } = service({ userData: u, fetchImpl });
        const sent = await svc.sendMessage({ to: ['priya@client.com'], subject: 'Next steps', body: 'Thanks for today.' });
        assert.deepEqual(sent, { id: 'm9', threadId: 't9', url: 'https://mail.google.com/mail/u/me%40acme.com/#sent/t9' });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].init.headers.Authorization, 'Bearer at-old');
        const mime = Buffer.from(calls[0].json.raw, 'base64url').toString('utf8');
        assert.match(mime, /^To: priya@client\.com\r\nSubject: Next steps\r\n/);
    });

    test('send failures are worded, never codes', async () => {
        const u = userData();
        saveTokens(u, { expiresAt: Date.now() + 3600_000 });
        const cases = [
            [res(403, { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }], status: 'PERMISSION_DENIED' } }), /read and send your email/],
            [res(403, { error: { code: 403, errors: [{ reason: 'accessNotConfigured' }] } }), /not switched on/],
            [res(429, { error: { code: 429 } }), /slow down/],
            [res(500, 'oops'), /trouble/],
        ];
        for (const [answer, re] of cases) {
            const { svc } = service({ userData: u, fetchImpl: fakeGoogle({ 'POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send': answer }).fetchImpl });
            await assert.rejects(svc.sendMessage({ to: ['a@b.com'], subject: 's', body: 'b' }), (e) => re.test(e.message) && !/\d{3}|_/.test(e.message));
        }
        const { svc } = service({ fetchImpl: fakeGoogle({}).fetchImpl });
        await assert.rejects(svc.sendMessage({ to: ['a@b.com'], subject: 's', body: 'b' }), (e) => e.kind === 'not_connected');
    });
});

describe('IPC and the brief context', () => {
    function register(over = {}) {
        const handlers = {};
        const u = over.userData ?? userData();
        gmailIpc.registerGmailIpc({
            safeHandle: (ch, fn) => { handlers[ch] = fn; },
            guard: (fallback, fn) => async (event, ...args) => (event?.fromLauncher === false ? fallback : fn(event, ...args)),
            userDataDir: u.dir,
            safeStorage: u.safeStorage,
            openExternal: () => {},
            platform: 'win32',
            client: () => CLIENT,
            grantShared: () => false,
            fetchImpl: over.fetchImpl ?? fakeGoogle({}).fetchImpl,
            loadFollowUpContext: over.loadFollowUpContext,
            // Connectors are Pro (2026-11-06); these tests are the Pro path. ConnectorsProGate covers the locked one.
            connectorsAllowed: () => true,
        });
        return { handlers, ...u };
    }

    test('every channel is registered; a window other than the launcher gets the fallback', async () => {
        const { handlers } = register();
        assert.deepEqual(Object.keys(handlers).sort(), Object.values(gmailIpc.GMAIL_CHANNELS).sort());
        assert.deepEqual(await handlers['connectors:gmail-status']({ fromLauncher: false }), { available: false, connected: false, briefsEnabled: false });
        assert.equal((await handlers['connectors:gmail-send-followup']({ fromLauncher: false }, {})).kind, 'forbidden');
        assert.deepEqual(await handlers['connectors:gmail-status']({}), { available: true, connected: false, briefsEnabled: false });
    });

    test('send-followup validates its input and the meeting before anything goes out', async () => {
        const u = userData();
        saveTokens(u, { expiresAt: Date.now() + 3600_000 });
        const { calls, fetchImpl } = fakeGoogle({ 'POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send': res(200, { id: 'm1', threadId: 't1' }) });
        const { handlers } = register({ userData: u, fetchImpl, loadFollowUpContext: (id) => (id === 'm-1' ? { title: 'Weekly' } : null) });
        const send = (input) => handlers['connectors:gmail-send-followup']({}, input);
        assert.equal((await send(null)).ok, false);
        assert.match((await send({ meetingId: 'm-1', to: 'a@b.com', subject: 's', body: 'b' })).message, /recipient/);
        assert.match((await send({ meetingId: 'm-1', to: ['nope'], subject: 's', body: 'b' })).message, /not an email address/);
        assert.equal((await send({ meetingId: 'gone', to: ['a@b.com'], subject: 's', body: 'b' })).kind, 'not_found');
        assert.equal(calls.length, 0);
        const ok = await send({ meetingId: 'm-1', to: ['a@b.com'], subject: 's', body: 'b' });
        assert.deepEqual(ok, { ok: true, messageUrl: 'https://mail.google.com/mail/u/me%40acme.com/#sent/t1' });
        assert.deepEqual((await handlers['connectors:gmail-set-briefs']({}, false)).briefsEnabled, false);
        assert.deepEqual((await handlers['connectors:gmail-set-briefs']({}, 'yes')).briefsEnabled, false, 'non-boolean ignored');
        const disc = await handlers['connectors:gmail-disconnect']({});
        assert.equal(disc.ok, true);
        assert.equal(fs.existsSync(u.file), false);
    });

    test('gmailBriefContext: [] when not registered, not connected, switched off or failing; the threads otherwise', async () => {
        gmailIpc.resetGmailServiceForTests();
        assert.deepEqual(await gmailIpc.gmailBriefContext(['a@b.com']), []);

        register();
        assert.deepEqual(await gmailIpc.gmailBriefContext(['a@b.com']), [], 'not connected');

        const u = userData();
        saveTokens(u, { expiresAt: Date.now() + 3600_000 });
        register({ userData: u, fetchImpl: async () => { throw new Error('offline'); } });
        assert.deepEqual(await gmailIpc.gmailBriefContext(['a@b.com']), [], 'failing');

        const v = userData();
        saveTokens(v, { expiresAt: Date.now() + 3600_000 });
        register({ userData: v, fetchImpl: fakeGoogle({ [TOKEN]: res(400, { error: 'invalid_grant' }), 'GET https://gmail.googleapis.com/gmail/v1/users/me/threads': res(401, {}) }).fetchImpl });
        assert.deepEqual(await gmailIpc.gmailBriefContext(['a@b.com']), [], 'access ended');

        const w = userData();
        saveTokens(w, { expiresAt: Date.now() + 3600_000 });
        register({ userData: w, fetchImpl: fakeGoogle({
            'GET https://gmail.googleapis.com/gmail/v1/users/me/threads': res(200, { threads: [{ id: 'abc' }] }),
            'GET https://gmail.googleapis.com/gmail/v1/users/me/threads/abc': res(200, { id: 'abc', messages: [{ internalDate: '1760000000000', snippet: 'See attached', payload: { headers: [{ name: 'Subject', value: 'SOW' }, { name: 'From', value: 'Priya <priya@client.com>' }] } }] }),
        }).fetchImpl });
        assert.deepEqual(await gmailIpc.gmailBriefContext(['priya@client.com']), [
            { subject: 'SOW', from: 'Priya <priya@client.com>', date: new Date(1760000000000).toISOString(), snippet: 'See attached' },
        ]);
        assert.deepEqual(await gmailIpc.gmailBriefContext('priya@client.com'), [], 'not a list');
        gmailIpc.resetGmailServiceForTests();
    });
});

describe('meeting brief: recent emails', () => {
    const brief = (over = {}) => ({
        eventId: 'e1', title: 'Acme weekly', startTime: '2026-10-17T10:00:00Z', people: [], lastTime: null,
        yourOpenItems: [], talkingPoints: [], talkingPointsFrom: 'notes', generatedAt: 0, ...over,
    });

    test('the prompt has the email block only when there are emails', () => {
        const without = briefMod.briefPromptInput(brief());
        assert.doesNotMatch(without, /Recent emails/);
        const withMail = briefMod.briefPromptInput(brief({ recentEmails: [{ subject: 'SOW draft', from: 'Priya <priya@client.com>', date: '2026-10-10T08:00:00.000Z', snippet: 'x'.repeat(500) }] }));
        assert.match(withMail, /Recent emails with these people:\n- "SOW draft" from Priya <priya@client\.com> \(2026-10-10\): x+…/);
        assert.ok(withMail.split('\n').pop().length < 300, 'snippet trimmed');
        assert.doesNotMatch(briefMod.briefPromptInput(brief({ recentEmails: [] })), /Recent emails/);
    });

    const ME = { names: ['Evin John'], emails: ['evin@acme.com'] };
    function deps(over = {}) {
        const kv = new Map();
        const calls = { model: [], emails: [] };
        return {
            calls,
            deps: {
                loadMeetings: () => [],
                kvGet: (k) => kv.get(k) ?? null,
                kvSet: (k, v) => kv.set(k, v),
                identity: () => ME,
                setting: () => undefined,
                meetingActive: () => false,
                modelAllowed: () => true,
                generateTalkingPoints: async (system, user, shape, validate) => { calls.model.push(user); return validate({ talkingPoints: ['Ask about the SOW'] }).data; },
                broadcast: () => {},
                now: () => Date.parse('2026-10-17T09:00:00Z'),
                ...over,
            },
        };
    }
    const event = { id: 'e1', title: 'Acme weekly', startTime: '2026-10-17T10:00:00Z', attendees: [{ email: 'evin@acme.com' }, { email: 'Priya@client.com', name: 'Priya' }] };

    test('without recentEmails the brief is unchanged: no field, no model call for an unknown meeting', async () => {
        const { deps: d, calls } = deps();
        const out = await new svcMod.AssistService(d).getMeetingBrief(event);
        assert.equal('recentEmails' in out, false);
        assert.equal(calls.model.length, 0);
    });

    test('with recentEmails: asked with the attendees (not the user), attached, and in the talking-points prompt', async () => {
        const asked = [];
        const { deps: d, calls } = deps({ recentEmails: async (emails) => { asked.push(emails); return [{ subject: 'SOW draft', from: 'Priya', date: '2026-10-10T08:00:00Z', snippet: 'Attached the draft', extra: 'dropped' }]; } });
        const out = await new svcMod.AssistService(d).getMeetingBrief(event);
        assert.deepEqual(asked, [['Priya@client.com']]);
        assert.deepEqual(out.recentEmails, [{ subject: 'SOW draft', from: 'Priya', date: '2026-10-10T08:00:00Z', snippet: 'Attached the draft' }]);
        assert.equal(calls.model.length, 1);
        assert.match(calls.model[0], /Recent emails with these people:\n- "SOW draft" from Priya \(2026-10-10\): Attached the draft/);
        assert.equal(out.talkingPointsFrom, 'model');
    });

    test('a failing or empty recentEmails is the same as none', async () => {
        for (const recentEmails of [async () => { throw new Error('x'); }, async () => [], async () => 'junk']) {
            const { deps: d, calls } = deps({ recentEmails });
            const out = await new svcMod.AssistService(d).getMeetingBrief(event);
            assert.equal('recentEmails' in out, false);
            assert.equal(calls.model.length, 0);
        }
    });
});
