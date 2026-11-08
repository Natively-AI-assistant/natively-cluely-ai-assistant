// Share as link (2026-10-16): the payload the app sends (names, never an email
// address), the size check, the record store (a plain JSON file in userData)
// and the two server calls through a fake fetch. Nothing here touches the
// network or Electron.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => require(path.join(REPO, 'dist-electron/electron/services/outputs', p));
const share = dist('shareLink.js');
const notes = dist('notesDocument.js');

const T0 = Date.UTC(2026, 9, 14, 15, 0, 0);
function meeting(over = {}) {
    return {
        id: 'm1',
        title: 'Q4 pricing review',
        date: '2026-10-14T15:00:00.000Z',
        duration: '45:10',
        detailedSummary: {
            schemaVersion: 3,
            tldr: ['Agreed to hold **list price** flat'],
            sectionsV3: [{ id: 's1', title: 'Pricing', order: 1, bullets: [{ text: 'Annual plans get `2 months` free' }] }],
            actionItemsV3: [{ text: 'Send the new price sheet', owner: 'Dana', deadline: 'Friday', status: 'open' }, { text: 'Update CRM', status: 'done' }],
            speakerLabels: { speaker_2: 'Priya' },
            callParticipants: ['Dana', 'Priya'],
        },
        transcript: [
            { speaker: 'user', text: 'Let us hold the price.', timestamp: T0 },
            { speaker: 'speaker_2', text: 'Agreed.', timestamp: T0 + 65_000 },
        ],
        calendarEvent: { attendees: [{ email: 'dana@acme.com', name: 'Dana Li' }, { email: 'priya@acme.com' }] },
        ...over,
    };
}
const doc = (over) => notes.buildNotesDocument(meeting(over), { selfName: 'Evin', locale: 'en-GB', timeZone: 'UTC' });

// A fetch stand-in: answers in order, records what was sent.
function fakeFetch(answers) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        const next = answers.shift();
        if (next instanceof Error) throw next;
        const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {});
        return { ok: next.status < 400, status: next.status, headers: { get: () => null }, text: async () => body };
    };
    return { fetchImpl, calls };
}
const OPTS = (fetchImpl, extra = {}) => ({ apiBase: 'https://api.example.test', fetchImpl, timeoutMs: 1000, ...extra });

describe('sharePayload', () => {
    test('sends the notes with names only: an attendee without a name is left out, never shown by email', () => {
        const p = share.sharePayload(doc(), { includeTranscript: false });
        assert.equal(p.title, 'Q4 pricing review');
        assert.equal(p.dateIso, '2026-10-14T15:00:00.000Z');
        assert.equal(p.dateLabel, 'Wednesday, 14 October 2026');
        assert.equal(p.durationLabel, '45 min');
        assert.deepEqual(p.people, ['Dana Li']);
        assert.deepEqual(p.sections, [
            { heading: 'Summary', bullets: ['Agreed to hold **list price** flat'] },
            { heading: 'Pricing', bullets: ['Annual plans get `2 months` free'] },
        ]);
        assert.deepEqual(p.actionItems, [
            { text: 'Send the new price sheet', owner: 'Dana', deadline: 'Friday', done: false },
            { text: 'Update CRM', done: true },
        ]);
        assert.equal('transcript' in p, false);
        assert.equal(JSON.stringify(p).includes('@'), false, 'no email address anywhere in the payload');
    });
    test('without any named attendee the people the transcript heard are used; the transcript goes only when asked', () => {
        const p = share.sharePayload(doc({ calendarEvent: { attendees: [{ email: 'x@acme.com' }] } }), { includeTranscript: true });
        assert.deepEqual(p.people, ['Dana', 'Priya']);
        assert.deepEqual(p.transcript, [
            { speaker: 'Evin', text: 'Let us hold the price.', offsetMs: 0 },
            { speaker: 'Priya', text: 'Agreed.', offsetMs: 65_000 },
        ]);
        assert.equal(JSON.stringify(p).includes('@'), false);
    });
    test('the size check counts the body as sent', () => {
        const p = share.sharePayload(doc(), { includeTranscript: false });
        assert.equal(share.payloadBytes(p), Buffer.byteLength(JSON.stringify({ notes: p })));
        assert.equal(share.SHARE_MAX_BYTES, 1024 * 1024);
    });
});

describe('ShareLinkStore', () => {
    const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'natively-shares-'));
    const REC = { id: 'AbCdEfGhIjKl', url: 'https://heynatively.com/s/AbCdEfGhIjKl', revokeToken: 'tok-123', createdAt: 1700000000000, includeTranscript: true };
    test('round-trips a record through the file, keeps the token out of the renderer view, and forgets on remove', () => {
        const d = dir();
        const s = new share.ShareLinkStore(d);
        assert.equal(s.get('m1'), null);
        s.set('m1', REC);
        assert.deepEqual(new share.ShareLinkStore(d).get('m1'), REC);
        assert.deepEqual(share.publicShareInfo(REC), { url: REC.url, createdAt: REC.createdAt, includeTranscript: true });
        if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(d, share.SHARE_LINKS_FILE)).mode & 0o777, 0o600);
        assert.equal(fs.readdirSync(d).some((f) => f.endsWith('.tmp')), false, 'no temp file left behind');
        s.remove('m1');
        assert.equal(new share.ShareLinkStore(d).get('m1'), null);
        s.remove('m1');
    });
    test('a damaged file is set aside under another name, never overwritten; bad records read as nothing shared', () => {
        const d = dir();
        fs.writeFileSync(path.join(d, share.SHARE_LINKS_FILE), '{not json');
        assert.equal(new share.ShareLinkStore(d).get('m1'), null);
        const aside = fs.readdirSync(d).filter((f) => f.startsWith(`${share.SHARE_LINKS_FILE}.unreadable-`));
        assert.equal(aside.length, 1);
        assert.equal(fs.readFileSync(path.join(d, aside[0]), 'utf8'), '{not json', 'kept as it was, for recovery');
        fs.writeFileSync(path.join(d, share.SHARE_LINKS_FILE), JSON.stringify({
            m1: { id: 'bad id!', url: REC.url, revokeToken: 't' },
            m2: { id: REC.id, url: 'http://not-https.example/s/x', revokeToken: 't' },
            m3: { id: REC.id, url: REC.url, revokeToken: '' },
            m4: { id: REC.id, url: REC.url, revokeToken: 't', createdAt: 'yesterday', includeTranscript: 'yes' },
        }));
        const s = new share.ShareLinkStore(d);
        assert.equal(s.get('m1'), null);
        assert.equal(s.get('m2'), null);
        assert.equal(s.get('m3'), null);
        assert.deepEqual(s.get('m4'), { id: REC.id, url: REC.url, revokeToken: 't', createdAt: 0, includeTranscript: false });
    });
    test('a store under a path that is not a directory fails loudly on save', () => {
        const d = dir();
        const file = path.join(d, 'file');
        fs.writeFileSync(file, 'x');
        const s = new share.ShareLinkStore(path.join(file, 'inside'));
        assert.throws(() => s.set('m1', REC));
    });
});

describe('createShareLink', () => {
    const payload = share.sharePayload(doc(), { includeTranscript: false });
    test('posts the notes with the install id and hands back the id, link and token', async () => {
        const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { ok: true, id: 'AbCdEfGhIjKl', url: 'https://heynatively.com/s/AbCdEfGhIjKl', revokeToken: 'tok' } }]);
        const res = await share.createShareLink(payload, OPTS(fetchImpl, { installId: 'uuid-1' }));
        assert.deepEqual(res, { ok: true, id: 'AbCdEfGhIjKl', url: 'https://heynatively.com/s/AbCdEfGhIjKl', revokeToken: 'tok' });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'https://api.example.test/v1/share');
        assert.equal(calls[0].init.method, 'POST');
        assert.equal(calls[0].init.headers['x-install-id'], 'uuid-1');
        assert.deepEqual(JSON.parse(calls[0].init.body), { notes: payload });
    });
    test('the caller is named: the API key wins, else the trial token, never both (server needs one since 2026-10-17)', async () => {
        const ok = { status: 200, body: { ok: true, id: 'AbCdEfGhIjKl', url: 'https://heynatively.com/s/AbCdEfGhIjKl', revokeToken: 'tok' } };
        let f = fakeFetch([ok]);
        await share.createShareLink(payload, OPTS(f.fetchImpl, { installId: 'uuid-1', apiKey: 'natively_sk_abc', trialToken: 'trial_xyz' }));
        assert.equal(f.calls[0].init.headers['x-natively-key'], 'natively_sk_abc');
        assert.equal(f.calls[0].init.headers['x-trial-token'], undefined);
        assert.equal(f.calls[0].init.headers['x-install-id'], 'uuid-1');
        f = fakeFetch([ok]);
        await share.createShareLink(payload, OPTS(f.fetchImpl, { trialToken: 'trial_xyz' }));
        assert.equal(f.calls[0].init.headers['x-trial-token'], 'trial_xyz');
        assert.equal(f.calls[0].init.headers['x-natively-key'], undefined);
        assert.equal(f.calls[0].init.headers['x-install-id'], undefined);
        assert.deepEqual(share.callerHeaders({}), {});
    });
    test('a 401 from the server is told as a missing plan or trial, in words', async () => {
        const r = await share.createShareLink(payload, OPTS(fakeFetch([{ status: 401, body: { ok: false, error: 'share_auth_required' } }]).fetchImpl));
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'auth');
        assert.match(r.message, /Natively plan or trial/);
        assert.doesNotMatch(r.message, /401|share_auth_required/);
    });
    test('each failure is a plain sentence: too long, rate limited, offline, server trouble, odd answer', async () => {
        let r = await share.createShareLink(payload, OPTS(fakeFetch([{ status: 413, body: { ok: false, error: 'too_long' } }]).fetchImpl));
        assert.equal(r.ok, false); assert.equal(r.kind, 'too_large'); assert.match(r.message, /too long to share as a link/);
        r = await share.createShareLink(payload, OPTS(fakeFetch([{ status: 429, body: { error: 'rate_limited' } }]).fetchImpl));
        assert.equal(r.kind, 'rate_limited'); assert.match(r.message, /Too many links/);
        r = await share.createShareLink(payload, OPTS(fakeFetch([new TypeError('fetch failed')]).fetchImpl));
        assert.equal(r.kind, 'network'); assert.match(r.message, /could not reach its server/);
        r = await share.createShareLink(payload, OPTS(fakeFetch([{ status: 503, body: { ok: false, error: 'unavailable' } }]).fetchImpl));
        assert.equal(r.kind, 'server'); assert.match(r.message, /could not be made right now/);
        r = await share.createShareLink(payload, OPTS(fakeFetch([{ status: 200, body: { ok: true } }]).fetchImpl));
        assert.equal(r.kind, 'server');
        for (const m of [r.message]) { assert.doesNotMatch(m, /\b[45]\d\d\b/, 'no status number on screen'); }
    });
    test('a payload over the server limit is refused before anything is sent', async () => {
        const { fetchImpl, calls } = fakeFetch([]);
        const big = { ...payload, transcript: Array.from({ length: 600 }, () => ({ speaker: 'A', text: 'x'.repeat(1900), offsetMs: 0 })) };
        const r = await share.createShareLink(big, OPTS(fetchImpl));
        assert.equal(r.ok, false); assert.equal(r.kind, 'too_large');
        assert.equal(calls.length, 0);
    });
});

describe('revokeShareLink', () => {
    test('sends the token as a header; a link the server no longer knows counts as off', async () => {
        const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { ok: true } }, { status: 404, body: { ok: false, error: 'not_found' } }]);
        assert.deepEqual(await share.revokeShareLink('AbCdEfGhIjKl', 'tok', OPTS(fetchImpl)), { ok: true });
        assert.equal(calls[0].url, 'https://api.example.test/v1/share/AbCdEfGhIjKl');
        assert.equal(calls[0].init.method, 'DELETE');
        assert.equal(calls[0].init.headers['x-share-revoke'], 'tok');
        assert.deepEqual(await share.revokeShareLink('AbCdEfGhIjKl', 'tok', OPTS(fetchImpl)), { ok: true });
    });
    test('a wrong token, a server fault or no connection leaves the link on and says so', async () => {
        let r = await share.revokeShareLink('AbCdEfGhIjKl', 'tok', OPTS(fakeFetch([{ status: 403, body: { ok: false } }]).fetchImpl));
        assert.equal(r.ok, false); assert.match(r.message, /stays on/);
        r = await share.revokeShareLink('AbCdEfGhIjKl', 'tok', OPTS(fakeFetch([{ status: 503, body: {} }]).fetchImpl));
        assert.equal(r.ok, false); assert.match(r.message, /could not be turned off right now/);
        r = await share.revokeShareLink('AbCdEfGhIjKl', 'tok', OPTS(fakeFetch([new TypeError('fetch failed')]).fetchImpl));
        assert.equal(r.ok, false); assert.equal(r.kind, 'network');
    });
});


// ── Reviews of #657 (Greptile, then /code-review, 2026-10-16). The rule: the
// app never loses the token of a link that may still be public.
const atomic = dist('atomicFile.js');
const observersMod = require(path.join(REPO, 'dist-electron/electron/db/meetingDeleteObservers.js'));
const apiBaseMod = require(path.join(REPO, 'dist-electron/electron/services/nativelyApiBase.js'));

// A fake server that can go offline and can be held mid-request.
function fakeServer() {
    const state = { online: true, created: 0, revoked: new Set(), calls: [], hold: null };
    const fetchImpl = async (url, init) => {
        state.calls.push(`${init.method} ${url.replace('https://api.example.test', '')}`);
        if (state.hold) await state.hold;
        if (!state.online) throw new TypeError('fetch failed');
        if (init.method === 'POST') {
            const id = `Link${String(++state.created).padStart(8, '0')}`;
            return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true, id, url: `https://heynatively.com/s/${id}`, revokeToken: `tok-${id}` }) };
        }
        state.revoked.add(url.split('/').pop());
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{"ok":true}' };
    };
    return { state, api: () => ({ apiBase: 'https://api.example.test', fetchImpl, timeoutMs: 1000 }) };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'natively-shares-'));
const unwritable = () => { const d = tmp(); fs.writeFileSync(path.join(d, 'file'), 'x'); return path.join(d, 'file', 'inside'); };
const PAYLOAD = () => share.sharePayload(doc(), { includeTranscript: false });
const locked = (code = 'EBUSY') => Object.assign(new Error(`${code}: resource busy or locked`), { code });
const noWait = () => {};
// A delete as DatabaseManager runs it: observers told, then settled by whether rows went.
const deleteMeeting = (target, rowsDeleted) => observersMod.runObservedMeetingDelete(target, () => ({ changes: rowsDeleted }), (r) => r.changes > 0);
const waitFor = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setImmediate(r)); };

describe('item 3: big meetings are trimmed to the server limits, never refused', () => {
    test('people, labels, headings, paragraphs, bullets and action items fit the caps', () => {
        const L = share.SHARE_LIMITS;
        const big = doc({
            title: 'T'.repeat(400),
            calendarEvent: { attendees: Array.from({ length: 60 }, (_, i) => ({ email: `p${i}@x.com`, name: `Person ${i} ${'n'.repeat(130)}` })) },
            detailedSummary: {
                schemaVersion: 3,
                tldr: Array.from({ length: 250 }, (_, i) => `point ${i} ${'b'.repeat(2100)}`),
                sectionsV3: Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, title: `H${i} ${'h'.repeat(250)}`, order: i, bullets: [{ text: 'x' }] })),
                actionItemsV3: Array.from({ length: 220 }, (_, i) => ({ text: `do ${i}`, owner: 'o'.repeat(150), status: 'open' })),
            },
        });
        const p = share.sharePayload(big, { includeTranscript: false });
        assert.equal(p.title.length, L.title);
        assert.ok(p.title.endsWith('…'));
        assert.equal(p.people.length, L.people);
        assert.ok(p.people.every((n) => n.length <= L.label));
        assert.equal(p.sections.length, L.sections);
        assert.ok(p.sections.every((s) => s.heading.length <= L.heading && s.bullets.length <= L.bullets && s.bullets.every((b) => b.length <= L.text)));
        assert.equal(p.actionItems.length, L.actionItems);
        assert.ok(p.actionItems.every((a) => a.owner.length <= L.label));
        const legacy = doc({ detailedSummary: { overview: 'o'.repeat(9000) } });
        const lp = share.sharePayload(legacy, { includeTranscript: false });
        assert.equal(lp.sections[0].paragraph.length, L.paragraph);
    });
    test('a long transcript line is split at spaces, not refused and not cut; the speaker and time carry over', () => {
        const words = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ');
        const d = doc({ transcript: [{ speaker: 'speaker_2', text: words, timestamp: T0 + 5000 }] });
        const p = share.sharePayload(d, { includeTranscript: true });
        assert.ok(p.transcript.length > 1);
        assert.ok(p.transcript.every((l) => l.text.length <= share.SHARE_LIMITS.text && l.speaker === 'Priya'));
        assert.equal(p.transcript.map((l) => l.text).join(' '), words, 'nothing lost');
        assert.deepEqual(share.splitLine('x'.repeat(4500), 2000).map((s) => s.length), [2000, 2000, 500], 'no space: hard cut');
        assert.equal(share.clip('ab😀cd', 3), 'ab…', 'never half an emoji');
    });
    test('"too long" names the transcript only when one was sent', async () => {
        const with413 = () => OPTS(fakeFetch([{ status: 413, body: { ok: false, error: 'too_long' } }]).fetchImpl);
        const withT = await share.createShareLink(share.sharePayload(doc(), { includeTranscript: true }), with413());
        // No switch to turn the transcript off any more (2026-10-17), so no advice to.
        assert.match(withT.message, /and the transcript are too long/);
        assert.doesNotMatch(withT.message, /Leave out/);
        const without = await share.createShareLink(share.sharePayload(doc(), { includeTranscript: false }), with413());
        assert.doesNotMatch(without.message, /transcript/);
        assert.match(without.message, /Share them as a file/);
    });
});

describe('ShareLinks', () => {
    test('create saves the link and offers it; a second create hands back the same one without the network', async () => {
        const srv = fakeServer();
        const links = new share.ShareLinks(new share.ShareLinkStore(tmp()), srv.api, () => 42);
        const res = await links.create('m1', PAYLOAD(), true);
        assert.deepEqual(res, { ok: true, link: { url: 'https://heynatively.com/s/Link00000001', createdAt: 42, includeTranscript: true } });
        assert.deepEqual(links.info('m1'), res.link);
        assert.deepEqual((await links.create('m1', PAYLOAD(), false)).link, res.link);
        assert.equal(srv.state.created, 1);
    });
    test('a store with more than 5,000 links keeps every one after a restart', () => {
        const d = tmp();
        const many = {};
        for (let i = 0; i < 5003; i++) many[`m${i}`] = { id: `Abc${String(i).padStart(9, '0')}`, url: `https://heynatively.com/s/x${i}`, revokeToken: `t${i}` };
        fs.writeFileSync(path.join(d, share.SHARE_LINKS_FILE), JSON.stringify(many));
        const s = new share.ShareLinkStore(d);
        assert.equal(s.entries().length, 5003);
        assert.equal(s.get('m5002').revokeToken, 't5002');
    });
    test('Stop sharing that fails leaves the link on and offered; one that works forgets it', async () => {
        const srv = fakeServer();
        const links = new share.ShareLinks(new share.ShareLinkStore(tmp()), srv.api);
        await links.create('m1', PAYLOAD(), false);
        srv.state.online = false;
        assert.equal((await links.revoke('m1')).ok, false);
        assert.ok(links.info('m1'));
        srv.state.online = true;
        assert.deepEqual(await links.revoke('m1'), { ok: true });
        assert.equal(links.info('m1'), null);
    });
    test('a link that could not be saved is turned off (awaited) before the user is told so', async () => {
        const srv = fakeServer();
        const links = new share.ShareLinks(new share.ShareLinkStore(unwritable(), { sleepSync: noWait }), srv.api);
        const res = await links.create('m1', PAYLOAD(), false);
        assert.equal(res.kind, 'storage_unavailable');
        assert.match(res.message, /turned off again/);
        assert.deepEqual(srv.state.calls, ['POST /v1/share', 'DELETE /v1/share/Link00000001']);
    });
    test('when that turn-off fails too, the user is told the link is still on and it is retried this session', async () => {
        const srv = fakeServer();
        const store = new share.ShareLinkStore(unwritable(), { sleepSync: noWait });
        const api = srv.api();
        let n = 0;
        const flaky = async (url, init) => { if (++n === 2) throw new TypeError('fetch failed'); return api.fetchImpl(url, init); };
        const links = new share.ShareLinks(store, () => ({ ...api, fetchImpl: flaky }));
        const res = await links.create('m1', PAYLOAD(), false);
        assert.match(res.message, /could not be turned off yet/);
        assert.equal(links.info('m1'), null, 'a link being turned off is not offered');
        assert.equal(await links.retryPending(), 0);
        assert.ok(srv.state.revoked.has('Link00000001'));
    });
    test('a meeting whose old link is still pending gets that one off before a new one is made', async () => {
        const srv = fakeServer();
        const store = new share.ShareLinkStore(tmp());
        const links = new share.ShareLinks(store, srv.api);
        await links.create('m1', PAYLOAD(), false);
        store.markPending('m1');
        srv.state.online = false;
        let res = await links.create('m1', PAYLOAD(), false);
        assert.match(res.message, /still being turned off/);
        assert.equal(srv.state.created, 1, 'no second link while the first is still public');
        srv.state.online = true;
        res = await links.create('m1', PAYLOAD(), false);
        assert.equal(res.link.url, 'https://heynatively.com/s/Link00000002');
        assert.ok(srv.state.revoked.has('Link00000001'));
    });
    test('a link marked pending during a retry run is picked up by a queued second run', async () => {
        const srv = fakeServer();
        const store = new share.ShareLinkStore(tmp());
        const links = new share.ShareLinks(store, srv.api);
        await links.create('m1', PAYLOAD(), false);
        await links.create('m2', PAYLOAD(), false);
        store.markPending('m1');
        const first = links.retryPending();
        store.markPending('m2');
        const second = links.retryPending();
        assert.equal(await first, 1);
        assert.equal(await second, 0);
        assert.equal(store.entries().length, 0);
    });
});

describe('items 4, 7, 9: deletes, through meetingDeleteObservers', () => {
    function wired(dir = tmp()) {
        const srv = fakeServer();
        const store = new share.ShareLinkStore(dir);
        const links = new share.ShareLinks(store, srv.api);
        const stop = observersMod.observeMeetingDeletes((target) => links.beginForget(target));
        return { srv, store, links, dir, stop };
    }
    test('deleting a shared meeting while offline keeps its link pending on disk; the next retry online turns it off', async () => {
        const w = wired();
        try {
            await w.links.create('m1', PAYLOAD(), false);
            w.srv.state.online = false;
            deleteMeeting({ ids: ['m1'] }, 1);
            assert.equal(new share.ShareLinkStore(w.dir).get('m1').pendingRevoke, true, 'on disk before the delete returned');
            await waitFor(() => w.srv.state.calls.includes('DELETE /v1/share/Link00000001'));
            w.srv.state.online = true;
            const after = new share.ShareLinks(new share.ShareLinkStore(w.dir), w.srv.api);
            assert.equal(await after.retryPending(), 0, 'a restart picks it up');
            assert.ok(w.srv.state.revoked.has('Link00000001'));
        } finally { w.stop(); }
    });
    test('item 7: a delete that fails (or finds nothing) leaves the link on and not pending', async () => {
        const w = wired();
        try {
            await w.links.create('m1', PAYLOAD(), false);
            deleteMeeting({ ids: ['m1'] }, 0);
            assert.throws(() => observersMod.runObservedMeetingDelete({ ids: ['m1'] }, () => { throw new Error('SQLITE_BUSY'); }, () => true), /SQLITE_BUSY/);
            await new Promise((r) => setImmediate(r));
            assert.ok(w.links.info('m1'), 'still shared');
            assert.equal(w.store.get('m1').pendingRevoke, undefined);
            assert.equal(new share.ShareLinkStore(w.dir).get('m1').pendingRevoke, undefined, 'unmarked on disk too');
            assert.equal(w.srv.state.revoked.size, 0);
        } finally { w.stop(); }
    });
    test('Clear all data turns off every link once the wipe held; a failed wipe leaves them all on', async () => {
        const w = wired();
        try {
            await w.links.create('m1', PAYLOAD(), false);
            await w.links.create('m2', PAYLOAD(), false);
            assert.throws(() => observersMod.runObservedMeetingDelete('all', () => { throw new Error('disk full'); }, () => true));
            assert.equal(w.store.entries().filter(([, r]) => r.pendingRevoke).length, 0);
            observersMod.runObservedMeetingDelete('all', () => true, () => true);
            await waitFor(() => w.store.entries().length === 0);
            assert.equal(w.srv.state.revoked.size, 2);
            assert.equal(w.store.entries().length, 0);
        } finally { w.stop(); }
    });
    test('item 4: a meeting deleted while its link is being created does not leave that link public', async () => {
        const w = wired();
        try {
            let release;
            w.srv.state.hold = new Promise((r) => { release = r; });
            const creating = w.links.create('m1', PAYLOAD(), false);
            await waitFor(() => w.srv.state.calls.length === 1);
            deleteMeeting({ ids: ['m1'] }, 1);
            w.srv.state.hold = null;
            release();
            const res = await creating;
            assert.equal(res.ok, false);
            assert.match(res.message, /deleted while its link was being made/);
            await waitFor(() => w.srv.state.revoked.has('Link00000001'));
            assert.ok(w.srv.state.revoked.has('Link00000001'));
            assert.equal(w.store.get('m1'), null);
        } finally { w.stop(); }
    });
    test('item 4: two creates at once make one link, and both get it', async () => {
        const w = wired();
        try {
            const [a, b] = await Promise.all([w.links.create('m1', PAYLOAD(), false), w.links.create('m1', PAYLOAD(), false)]);
            assert.equal(w.srv.state.created, 1);
            assert.deepEqual(a, b);
        } finally { w.stop(); }
    });
    test('item 9: an observer that throws is skipped and never stops the delete', () => {
        const stop = observersMod.observeMeetingDeletes(() => { throw new Error('observer broke'); });
        try {
            const r = observersMod.runObservedMeetingDelete({ ids: ['x'] }, () => ({ changes: 1 }), (x) => x.changes > 0);
            assert.equal(r.changes, 1);
        } finally { stop(); }
    });
    test('item 9: every meetings delete in the app goes through runObservedMeetingDelete', () => {
        const src = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
        const dbm = src('electron/db/DatabaseManager.ts');
        const rag = src('electron/rag/RAGManager.ts');
        for (const [name, text] of [['DatabaseManager', dbm], ['RAGManager', rag]]) {
            const deletes = text.split('\n').filter((l) => /DELETE FROM meetings\b/.test(l));
            assert.ok(deletes.length > 0, name);
            for (const l of deletes) {
                const i = text.indexOf(l);
                // The delete is built as a transaction just above or inside the call that runs it.
                const before = text.slice(Math.max(0, i - 3000), i + 1500);
                assert.match(before, /runObservedMeetingDelete\(/, `${name}: ${l.trim()}`);
            }
        }
        const ipc = src('electron/ipcHandlers.ts');
        assert.doesNotMatch(ipc, /revokeShareForMeeting|turnOffShareForDeletedMeeting|revokeAllShares/, 'no share special case left at a caller');
    });
});

describe('items 5 and 6: the links file on a busy or broken disk', () => {
    const REC = { id: 'AbCdEfGhIjKl', url: 'https://heynatively.com/s/AbCdEfGhIjKl', revokeToken: 'tok', createdAt: 1, includeTranscript: false };
    test('item 5: a file that cannot be read is never overwritten, and is read again once it can be', async () => {
        const d = tmp();
        fs.writeFileSync(path.join(d, share.SHARE_LINKS_FILE), JSON.stringify({ old: REC }));
        let busy = true;
        const store = new share.ShareLinkStore(d, { sleepSync: noWait, readText: (f) => { if (busy) throw locked('EBUSY'); return fs.readFileSync(f, 'utf8'); } });
        assert.throws(() => store.get('old'), (e) => e instanceof share.ShareStoreUnreadable);
        const srv = fakeServer();
        const links = new share.ShareLinks(store, srv.api);
        const res = await links.create('new', PAYLOAD(), false);
        assert.equal(res.ok, false);
        assert.equal(res.message, share.STORE_UNREADABLE);
        assert.equal(srv.state.created, 0, 'no link made while its token could not be kept');
        assert.equal((await links.revoke('old')).message, share.STORE_UNREADABLE);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, share.SHARE_LINKS_FILE), 'utf8')), { old: REC }, 'untouched');
        busy = false;
        assert.deepEqual(store.get('old'), REC);
    });
    test('item 5: a delete while the file cannot be read is owed, and applied once it can be', async () => {
        const d = tmp();
        fs.writeFileSync(path.join(d, share.SHARE_LINKS_FILE), JSON.stringify({ m1: REC }));
        let busy = true;
        const store = new share.ShareLinkStore(d, { sleepSync: noWait, readText: (f) => { if (busy) throw locked('EPERM'); return fs.readFileSync(f, 'utf8'); } });
        const srv = fakeServer();
        const links = new share.ShareLinks(store, srv.api);
        const stop = observersMod.observeMeetingDeletes((t) => links.beginForget(t));
        try {
            deleteMeeting({ ids: ['m1'] }, 1);
            assert.equal(await links.retryPending(), 1, 'still owed');
            busy = false;
            assert.equal(await links.retryPending(), 0);
            assert.ok(srv.state.revoked.has('AbCdEfGhIjKl'));
        } finally { stop(); }
    });
    test('item 6: a rename blocked by a brief Windows lock is retried; a lasting one fails with no temp file left', () => {
        const d = tmp();
        const file = path.join(d, 'f.json');
        let blocks = 2;
        const waits = [];
        atomic.writeFileAtomicSync(file, '{"a":1}', { sleepSync: (ms) => waits.push(ms), rename: (a, b) => { if (blocks-- > 0) throw locked('EPERM'); fs.renameSync(a, b); } });
        assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}');
        assert.deepEqual(waits, atomic.LOCK_RETRY_WAITS_MS.slice(0, 2));
        assert.throws(() => atomic.writeFileAtomicSync(file, '{"a":2}', { sleepSync: noWait, rename: () => { throw locked('EBUSY'); } }), /EBUSY/);
        assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}', 'the old file stands');
        assert.deepEqual(fs.readdirSync(d), ['f.json'], 'no temp file left behind');
        assert.throws(() => atomic.writeFileAtomicSync(file, 'x', { sleepSync: noWait, rename: () => { throw locked('ENOSPC'); } }), /ENOSPC/, 'other errors are not retried');
    });
    test('item 6: a read blocked by a brief lock is retried; a missing file is "missing", not an error', () => {
        const d = tmp();
        const file = path.join(d, 'f.json');
        assert.deepEqual(atomic.readTextFileSync(file), { state: 'missing' });
        fs.writeFileSync(file, 'hi');
        let blocks = 1;
        assert.deepEqual(atomic.readTextFileSync(file, { sleepSync: noWait, readText: (f) => { if (blocks-- > 0) throw locked('EBUSY'); return fs.readFileSync(f, 'utf8'); } }), { state: 'read', text: 'hi' });
    });
});

describe('item 10: one API address for the whole app', () => {
    test('NATIVELY_API_URL wins, trailing slashes go, production otherwise', () => {
        assert.equal(apiBaseMod.nativelyApiBase({}), 'https://api.natively.software');
        assert.equal(apiBaseMod.nativelyApiBase({ NATIVELY_API_URL: 'http://localhost:3000//' }), 'http://localhost:3000');
    });
    test('no module keeps its own copy of the lookup', () => {
        const hits = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); }
                else if (p.endsWith('.ts') && /process\.env\.NATIVELY_API_URL\s*\|\|/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(REPO, p));
            }
        };
        walk(path.join(REPO, 'electron'));
        assert.deepEqual(hits, [], 'only services/nativelyApiBase.ts reads NATIVELY_API_URL');
    });
});
