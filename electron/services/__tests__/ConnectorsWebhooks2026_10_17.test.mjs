// Settings › Connectors › Webhooks and Zapier (webhooks.ts) and the IPC that
// fronts it (connectorsDeliveryIpc.ts): Standard Webhooks signatures checked
// with an independent HMAC, URL checks, folder and event filters, retries on a
// fake clock, plain failure wording, the test event, secret rotation, the edit
// debounce and the encrypted file. Fake fetch, fake safeStorage, temp userData
// under os.tmpdir(); no network, no waiting.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => require(path.join(REPO, 'dist-electron/electron/services/outputs', p));
const wh = dist('webhooks.js');
const ipc = dist('connectorsDeliveryIpc.js');

const HOOK = 'https://hooks.example.com/natively';
const ZAP = 'https://hooks.zapier.com/hooks/catch/123/abc/';

// A safeStorage stand-in that really scrambles, so "the URL is not in the file" means something.
const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').toString('base64').split('').reverse().join(''), 'utf8'),
    decryptString: (b) => Buffer.from(b.toString('utf8').split('').reverse().join(''), 'base64').toString('utf8'),
};

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'natively-webhooks-'));

const DOC = {
    meetingId: 'm1',
    title: 'Weekly sync',
    dateIso: '2026-10-17T09:00:00.000Z',
    dateLabel: 'Saturday, 17 October 2026',
    durationLabel: '30 min',
    attendees: [{ email: 'ana@acme.com', name: 'Ana' }],
    participants: [],
    sections: [{ heading: 'Summary', bullets: ['Shipped **webhooks**.'] }],
    actionItems: [{ text: 'Write the docs', owner: 'Ana', deadline: 'Friday', done: false }],
    transcript: [{ speaker: 'Ana', text: 'Hello there.', offsetMs: 1500 }],
};

/** statuses: a list of numbers (HTTP status) or 'throw' (network failure); the last repeats. */
function fakeFetch(statuses = [200]) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const s = statuses[Math.min(calls.length, statuses.length - 1)];
        calls.push({ url, headers: init.headers, body: init.body, json: JSON.parse(init.body) });
        if (s === 'throw') throw new TypeError('fetch failed');
        return { ok: s >= 200 && s < 300, status: s, headers: { get: () => null }, text: async () => '' };
    };
    return { calls, fetchImpl };
}

function fakeTimers() {
    const pending = new Map();
    let n = 0;
    return {
        pending,
        setTimeout: (fn, ms) => { const id = ++n; pending.set(id, { fn, ms }); return id; },
        clearTimeout: (id) => { pending.delete(id); },
        runAll() { for (const [id, t] of [...pending]) { pending.delete(id); t.fn(); } },
    };
}

async function until(cond, label = 'condition') {
    for (let i = 0; i < 200; i++) {
        if (cond()) return;
        await new Promise((r) => setImmediate(r));
    }
    assert.fail(`timed out waiting for ${label}`);
}

function make(opts = {}) {
    const dir = opts.dir || tempDir();
    const f = opts.fetch || fakeFetch(opts.statuses);
    const waits = [];
    let now = opts.now ?? 1_760_000_000_000;
    const folders = opts.folders || {};
    const timers = opts.timers || fakeTimers();
    const hooks = new wh.Webhooks({
        userDataDir: dir,
        safeStorage: opts.safeStorage || safeStorage,
        loadDoc: async (id) => (id === 'gone' ? null : { ...DOC, meetingId: id }),
        foldersOfMeeting: (id) => folders[id] || [],
        fetchImpl: f.fetchImpl,
        now: () => now,
        wait: async (ms) => { waits.push(ms); now += ms; },
        timers,
    });
    return { hooks, dir, calls: f.calls, waits, timers, tick: (ms) => { now += ms; } };
}

const baseInput = (over = {}) => ({ kind: 'webhook', label: 'My hook', url: HOOK, events: ['note.generated'], folderId: null, includeTranscript: false, ...over });

/** Verifies a delivery the way a receiver following the Standard Webhooks spec would. */
function verify(call, secret) {
    const id = call.headers['webhook-id'];
    const ts = call.headers['webhook-timestamp'];
    const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
    const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${call.body}`).digest('base64');
    const given = call.headers['webhook-signature'].split(' ').map((s) => s.split(',')).filter(([v]) => v === 'v1').map(([, sig]) => sig);
    return given.some((sig) => crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) );
}

test('a delivery carries the note and a Standard Webhooks signature that verifies independently', async () => {
    const { hooks, calls } = make();
    const created = hooks.create(baseInput());
    assert.equal(created.ok, true);
    assert.match(created.secret, /^whsec_[A-Za-z0-9+/]{32}$/, '24 random bytes in base64');
    assert.equal(created.endpoint.urlHost, 'hooks.example.com');

    await hooks.dispatchEvent('note.generated', 'm1');
    assert.equal(calls.length, 1);
    const c = calls[0];
    assert.equal(c.url, HOOK);
    assert.match(c.headers['webhook-id'], /^msg_[0-9a-f]{32}$/);
    assert.equal(c.headers['webhook-timestamp'], String(Math.floor(1_760_000_000_000 / 1000)));
    assert.match(c.headers['webhook-signature'], /^v1,[A-Za-z0-9+/]+=*$/);
    assert.ok(verify(c, created.secret), 'signature verifies');
    assert.ok(!verify({ ...c, body: c.body.replace('Weekly', 'Weakly') }, created.secret), 'a changed body fails');

    assert.equal(c.json.type, 'note.generated');
    assert.equal(c.json.timestamp, new Date(1_760_000_000_000).toISOString());
    const d = c.json.data;
    assert.equal(d.meeting_id, 'm1');
    assert.equal(d.title, 'Weekly sync');
    assert.equal(d.date, DOC.dateIso);
    assert.equal(d.duration, '30 min');
    assert.deepEqual(d.attendees, [{ email: 'ana@acme.com', name: 'Ana' }]);
    assert.match(d.summary_markdown, /## Summary\n\n- Shipped \*\*webhooks\*\*\./);
    assert.match(d.summary_markdown, /- \[ \] Ana: Write the docs \(by Friday\)/);
    assert.deepEqual(d.sections, [{ heading: 'Summary', bullets: ['Shipped **webhooks**.'] }]);
    assert.deepEqual(d.action_items, [{ text: 'Write the docs', owner: 'Ana', deadline: 'Friday', done: false }]);
    assert.equal(d.transcript, undefined, 'no transcript unless asked for');
    assert.equal(d.test, undefined);

    const list = hooks.list();
    assert.equal(list[0].lastDelivery.status, 'success');
    assert.equal(list[0].lastDelivery.meetingTitle, 'Weekly sync');
});

test('the transcript goes only to endpoints that asked for it', async () => {
    const { hooks, calls } = make();
    hooks.create(baseInput({ includeTranscript: true }));
    await hooks.dispatchEvent('note.generated', 'm1');
    assert.deepEqual(calls[0].json.data.transcript, [{ speaker: 'Ana', text: 'Hello there.', offset_ms: 1500 }]);
});

test('URLs must be https on a public host; Zapier URLs must be on hooks.zapier.com', () => {
    const bad = [
        'http://hooks.example.com/x',
        'https://localhost/x',
        'https://LOCALHOST./x',
        'https://127.0.0.1/x',
        'https://2130706433/x', // 127.0.0.1 written as one number
        'https://10.1.2.3/x',
        'https://192.168.1.20/x',
        'https://172.16.0.1/x',
        'https://172.31.255.255/x',
        'https://169.254.169.254/latest',
        'https://0.0.0.0/x',
        'https://[::1]/x',
        'https://[::ffff:127.0.0.1]/x',
        'https://[fd00::1]/x',
        'https://[fe80::1]/x',
        'https://printer.local/x',
        'https://intranet/x',
        'https://user:pass@hooks.example.com/x',
        'not a url',
        '',
        42,
    ];
    for (const url of bad) {
        const r = wh.checkWebhookUrl(url, 'webhook');
        assert.equal(r.ok, false, `refused: ${url}`);
        assert.doesNotMatch(r.message, /\b\d{3}\b/, 'no codes in the sentence');
    }
    for (const url of ['https://hooks.example.com/x', 'https://172.32.0.1/x', 'https://8.8.8.8/x', 'https://[2606:4700::1111]/x']) {
        assert.equal(wh.checkWebhookUrl(url, 'webhook').ok, true, `accepted: ${url}`);
    }
    assert.equal(wh.checkWebhookUrl(HOOK, 'zapier').ok, false);
    assert.match(wh.checkWebhookUrl('https://zapier.com.evil.example/hooks', 'zapier').message, /hooks\.zapier\.com/);
    assert.equal(wh.checkWebhookUrl(ZAP, 'zapier').ok, true);
    assert.equal(wh.checkWebhookUrl(ZAP, 'webhook').ok, true, 'a plain webhook may point at Zapier too');

    const { hooks } = make();
    const r = hooks.create(baseInput({ kind: 'zapier', url: HOOK }));
    assert.equal(r.ok, false);
    assert.equal(hooks.list().length, 0);
    const z = hooks.create(baseInput({ kind: 'zapier', url: ZAP, label: '' }));
    assert.equal(z.ok, true);
    assert.equal(z.endpoint.label, 'Zapier');
});

test('inputs from the renderer are checked: kind, events, folder, label, duplicates and the cap of 20', () => {
    const { hooks } = make();
    assert.equal(hooks.create(null).ok, false);
    assert.equal(hooks.create(baseInput({ kind: 'ftp' })).ok, false);
    assert.equal(hooks.create(baseInput({ events: [] })).ok, false);
    assert.equal(hooks.create(baseInput({ events: ['note.deleted'] })).ok, false);
    assert.equal(hooks.create(baseInput({ events: 'note.generated' })).ok, false);
    assert.equal(hooks.create(baseInput({ folderId: 7 })).ok, false);
    assert.equal(hooks.create(baseInput({ label: { evil: true } })).ok, false);
    assert.equal(hooks.create(baseInput()).ok, true);
    assert.match(hooks.create(baseInput()).message, /already added/);
    for (let i = 1; i < 20; i++) assert.equal(hooks.create(baseInput({ url: `${HOOK}/${i}` })).ok, true);
    const over = hooks.create(baseInput({ url: `${HOOK}/21` }));
    assert.equal(over.ok, false);
    assert.match(over.message, /up to 20/);
    const id = hooks.list()[0].id;
    assert.equal(hooks.update(id, { enabled: 'yes' }).ok, false);
    assert.equal(hooks.update(id, { events: [] }).ok, false);
    assert.equal(hooks.update(id, { label: '   ' }).ok, false);
    assert.equal(hooks.update('nope', { enabled: false }).kind, 'not_found');
    assert.equal(hooks.update(id, { label: 'Renamed', folderId: 'f1', includeTranscript: true, events: ['note.edited', 'note.generated'] }).ok, true);
    const row = hooks.list().find((r) => r.id === id);
    assert.equal(row.label, 'Renamed');
    assert.equal(row.folderId, 'f1');
    assert.deepEqual(row.events, ['note.generated', 'note.edited']);
});

test('folder and event filters pick the endpoints; disabled ones get nothing', async () => {
    const { hooks, calls } = make({ folders: { m1: ['f1'], m2: ['f2'] } });
    hooks.create(baseInput({ url: `${HOOK}/all`, events: ['note.generated'] }));
    hooks.create(baseInput({ url: `${HOOK}/f1`, events: ['note.generated', 'note.edited'], folderId: 'f1' }));
    hooks.create(baseInput({ url: `${HOOK}/f2`, folderId: 'f2' }));
    const off = hooks.create(baseInput({ url: `${HOOK}/off` }));
    hooks.update(off.endpoint.id, { enabled: false });

    await hooks.dispatchEvent('note.generated', 'm1');
    assert.deepEqual(calls.map((c) => c.url).sort(), [`${HOOK}/all`, `${HOOK}/f1`]);
    calls.length = 0;
    await hooks.dispatchEvent('note.edited', 'm1');
    assert.deepEqual(calls.map((c) => c.url), [`${HOOK}/f1`]);
    assert.equal(calls[0].json.type, 'note.edited');
    calls.length = 0;
    await hooks.dispatchEvent('note.generated', 'm3');
    assert.deepEqual(calls.map((c) => c.url), [`${HOOK}/all`], 'a meeting in no folder reaches only the all-meetings endpoint');
    calls.length = 0;
    await hooks.dispatchEvent('note.generated', 'gone');
    assert.equal(calls.length, 0, 'a meeting that is gone sends nothing');
});

test('a failing receiver is tried again after 30 s and 2 min with the same message id; success is recorded', async () => {
    const { hooks, calls, waits } = make({ statuses: [500, 'throw', 200] });
    const { secret } = hooks.create(baseInput());
    await hooks.dispatchEvent('note.generated', 'm1');
    assert.equal(calls.length, 3);
    assert.deepEqual(waits, [30_000, 120_000]);
    assert.equal(new Set(calls.map((c) => c.headers['webhook-id'])).size, 1, 'one message, three tries');
    assert.notEqual(calls[0].headers['webhook-timestamp'], calls[2].headers['webhook-timestamp'], 'each try signed at its own time');
    for (const c of calls) assert.ok(verify(c, secret));
    assert.equal(hooks.list()[0].lastDelivery.status, 'success');
});

test('after three failed tries the row says why in plain words', async () => {
    const { hooks, calls, waits } = make({ statuses: ['throw'] });
    hooks.create(baseInput());
    await hooks.dispatchEvent('note.generated', 'm1');
    assert.equal(calls.length, 3);
    assert.equal(waits.length, 2);
    const last = hooks.list()[0].lastDelivery;
    assert.equal(last.status, 'failed');
    assert.equal(last.meetingTitle, 'Weekly sync');
    assert.equal(last.message, 'Could not reach hooks.example.com. Check your internet connection. Tried 3 times.');

    const server = make({ statuses: [503] });
    server.hooks.create(baseInput({ kind: 'zapier', url: ZAP }));
    await server.hooks.dispatchEvent('note.generated', 'm1');
    const msg = server.hooks.list()[0].lastDelivery.message;
    assert.match(msg, /^Zapier is having trouble right now\./);
    assert.doesNotMatch(msg, /\b\d{3}\b|status|error code/i, 'never a status code');
});

test('a receiver that refuses the request is not tried again', async () => {
    const { hooks, calls, waits } = make({ statuses: [404] });
    hooks.create(baseInput());
    await hooks.dispatchEvent('note.generated', 'm1');
    assert.equal(calls.length, 1);
    assert.equal(waits.length, 0);
    const last = hooks.list()[0].lastDelivery;
    assert.equal(last.status, 'failed');
    assert.equal(last.message, 'hooks.example.com says this address does not exist any more. Check the URL, or add a new one.');
});

test('an endpoint turned off between tries is not tried again', async () => {
    const f = fakeFetch([500]);
    let hooksRef;
    const dir = tempDir();
    const hooks = new wh.Webhooks({
        userDataDir: dir, safeStorage, loadDoc: async () => DOC, foldersOfMeeting: () => [],
        fetchImpl: f.fetchImpl, wait: async () => { hooksRef.update(hooksRef.list()[0].id, { enabled: false }); },
    });
    hooksRef = hooks;
    hooks.create(baseInput());
    await hooks.dispatchEvent('note.generated', 'm1');
    assert.equal(f.calls.length, 1);
    assert.equal(hooks.list()[0].lastDelivery.status, 'pending');
});

test('Send test delivers a sample note.generated once, with no retries, and leaves the row alone', async () => {
    const { hooks, calls, waits } = make({ statuses: [200] });
    const { endpoint, secret } = hooks.create(baseInput({ includeTranscript: true }));
    assert.deepEqual(await hooks.test(endpoint.id), { ok: true });
    assert.equal(calls.length, 1);
    assert.ok(verify(calls[0], secret));
    assert.equal(calls[0].json.type, 'note.generated');
    assert.equal(calls[0].json.data.test, true);
    assert.equal(calls[0].json.data.title, 'Sample meeting from Natively');
    assert.ok(Array.isArray(calls[0].json.data.transcript));
    assert.equal(hooks.list()[0].lastDelivery, undefined);

    const failing = make({ statuses: ['throw'] });
    const e = failing.hooks.create(baseInput()).endpoint;
    const r = await failing.hooks.test(e.id);
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'network');
    assert.equal(r.message, 'Could not reach hooks.example.com. Check your internet connection.');
    assert.equal(failing.calls.length, 1);
    assert.equal(failing.waits.length, 0);
    assert.equal((await failing.hooks.test('nope')).kind, 'not_found');
});

test('rotating the secret signs the next delivery with the new one only', async () => {
    const { hooks, calls } = make();
    const { endpoint, secret: oldSecret } = hooks.create(baseInput());
    const rotated = hooks.rotateSecret(endpoint.id);
    assert.equal(rotated.ok, true);
    assert.match(rotated.secret, /^whsec_/);
    assert.notEqual(rotated.secret, oldSecret);
    await hooks.dispatchEvent('note.generated', 'm1');
    assert.ok(verify(calls[0], rotated.secret));
    assert.ok(!verify(calls[0], oldSecret));
    assert.equal(hooks.rotateSecret('nope').ok, false);
});

test('edits are sent once, a minute after the last change; regenerated notes cancel a pending edit', async () => {
    const timers = fakeTimers();
    const { hooks, calls } = make({ timers });
    hooks.create(baseInput({ events: ['note.generated', 'note.edited'] }));
    hooks.noteEdited('m1');
    hooks.noteEdited('m1');
    hooks.noteEdited('m1');
    hooks.noteEdited('m2');
    assert.equal(timers.pending.size, 2, 'one timer per meeting');
    assert.ok([...timers.pending.values()].every((t) => t.ms === 60_000));
    assert.equal(calls.length, 0);
    timers.runAll();
    await until(() => calls.length === 2, 'two edit deliveries');
    assert.deepEqual(calls.map((c) => [c.json.type, c.json.data.meeting_id]).sort(), [['note.edited', 'm1'], ['note.edited', 'm2']]);

    calls.length = 0;
    hooks.noteEdited('m1');
    await hooks.dispatchEvent('note.generated', 'm1');
    assert.equal(timers.pending.size, 0, 'the pending edit was dropped');
    assert.deepEqual(calls.map((c) => c.json.type), ['note.generated']);

    hooks.noteEdited('m1');
    hooks.dispose();
    assert.equal(timers.pending.size, 0);
});

test('endpoints survive a restart in an encrypted file; the URL and secret never come back to the renderer', () => {
    const dir = tempDir();
    const first = make({ dir });
    const { endpoint, secret } = first.hooks.create(baseInput({ folderId: 'f1', includeTranscript: true }));
    const file = path.join(dir, wh.WEBHOOKS_FILE);
    assert.equal(path.basename(file), 'webhooks.enc');
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes('hooks.example.com') && !raw.includes(secret.slice(6)), 'nothing readable on disk');

    const again = make({ dir });
    const list = again.hooks.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, endpoint.id);
    assert.equal(list[0].folderId, 'f1');
    assert.equal(list[0].includeTranscript, true);
    const shown = JSON.stringify(list);
    assert.ok(!shown.includes(HOOK) && !shown.includes(secret) && !shown.includes('whsec_'), 'host only');

    assert.equal(again.hooks.remove(endpoint.id).ok, true);
    assert.equal(make({ dir }).hooks.list().length, 0);
});

test('a file that cannot be read is never overwritten', () => {
    const dir = tempDir();
    const file = path.join(dir, wh.WEBHOOKS_FILE);
    fs.writeFileSync(file, 'not what safeStorage wrote');
    const { hooks } = make({ dir });
    assert.deepEqual(hooks.list(), []);
    const r = hooks.create(baseInput());
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'storage_unavailable');
    assert.equal(fs.readFileSync(file, 'utf8'), 'not what safeStorage wrote');
});

test('without OS encryption a webhook is kept for this session, and the user is told', () => {
    const dir = tempDir();
    const noKeyring = { ...safeStorage, isEncryptionAvailable: () => false };
    const { hooks } = make({ dir, safeStorage: noKeyring });
    const r = hooks.create(baseInput());
    assert.equal(r.ok, true);
    assert.match(r.message, /kept until Natively quits/);
    assert.equal(hooks.list().length, 1);
    assert.equal(fs.existsSync(path.join(dir, wh.WEBHOOKS_FILE)), false, 'nothing written in plain text');
});

test('the IPC registers every channel, checks inputs, and connectorsDelivery reaches webhooks and rules', async () => {
    const handlers = new Map();
    const f = fakeFetch([200]);
    const sent = [];
    const dir = tempDir();
    const { webhooks: hooks } = ipc.registerConnectorsDeliveryIpc({
        safeHandle: (channel, fn) => { handlers.set(channel, fn); },
        guard: (_fallback, fn) => async (event, ...args) => fn(event, ...args),
        userDataDir: dir,
        safeStorage,
        loadDoc: async (id) => ({ ...DOC, meetingId: id }),
        foldersOfMeeting: () => [],
        listFolders: () => [{ id: 'f1', name: 'Sales', position: 0, rules: [] }, { bogus: true }],
        autoSendSender: async (destination, meetingId) => { sent.push([destination.kind, meetingId]); return { ok: true }; },
        // Connectors are Pro (2026-11-06); this is the Pro path. ConnectorsProGate covers the locked one.
        connectorsAllowed: () => true,
        fetchImpl: f.fetchImpl,
        wait: async () => {},
        timers: fakeTimers(),
    });
    assert.deepEqual([...handlers.keys()].sort(), [...ipc.CONNECTORS_DELIVERY_CHANNELS].sort());
    const call = (ch, ...args) => handlers.get(ch)({ sender: {} }, ...args);

    assert.deepEqual(await call('connectors:list-folders'), [{ id: 'f1', name: 'Sales' }]);
    assert.equal((await call('connectors:webhook-create', 'junk')).ok, false);
    const created = await call('connectors:webhook-create', baseInput());
    assert.equal(created.ok, true);
    assert.equal((await call('connectors:webhooks-list')).length, 1);
    assert.equal((await call('connectors:webhook-update', created.endpoint.id, { label: 'Ops' })).ok, true);
    assert.equal((await call('connectors:webhook-test', created.endpoint.id)).ok, true);
    assert.match((await call('connectors:webhook-rotate', created.endpoint.id)).secret, /^whsec_/);
    assert.equal((await call('connectors:autosend-create', { destination: { kind: 'notion' }, folderId: null })).ok, true);
    assert.equal((await call('connectors:autosend-create', { destination: { kind: 'email' }, folderId: null })).ok, false);
    assert.equal((await call('connectors:autosend-list')).length, 1);

    f.calls.length = 0;
    await ipc.connectorsDelivery.notesReady('m9');
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].json.data.meeting_id, 'm9');
    assert.deepEqual(sent, [['notion', 'm9']]);
    const rule = (await call('connectors:autosend-list'))[0];
    assert.equal(rule.lastDelivery.status, 'success');
    assert.equal(rule.lastDelivery.meetingTitle, 'Weekly sync');

    assert.equal((await call('connectors:autosend-update', rule.id, { enabled: false })).ok, true);
    assert.equal((await call('connectors:autosend-delete', rule.id)).ok, true);
    assert.equal((await call('connectors:webhook-delete', created.endpoint.id)).ok, true);
    assert.equal(hooks.list().length, 0);
    ipc.connectorsDelivery.dispose();
});
