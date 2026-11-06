// Connectors are a Natively Pro feature (2026-11-06). The code stays in the open
// repo; the main process decides access (outputs/connectorAccess.ts: Pro or an
// unexpired trial, through the premium LicenseManager a source build lacks).
//
// Locked, nothing is connected, sent, or read: connect / save-token / send /
// rules / webhooks / Gmail send and briefs / API keys / the MCP server and the
// local API all refuse with kind "pro_required" (403 over HTTP). Status, list,
// disconnect, remove and delete always work, so a free user can clear what an
// earlier Pro or trial left. The same calls pass with access.
//
// Electron-free (a stub for `electron`, fake safeStorage, loopback HTTP only),
// with no platform branch, so the same assertions hold on macOS and Windows
// runners.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test <this file>
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import http from 'node:http';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(REPO, 'dist-electron/electron/services/outputs');
const access = require(path.join(OUT, 'connectorAccess.js'));
const deliveryIpc = require(path.join(OUT, 'connectorsDeliveryIpc.js'));
const gmailIpc = require(path.join(OUT, 'gmailIpc.js'));
const localApiIpc = require(path.join(OUT, 'localApiIpc.js'));
const localApi = require(path.join(OUT, 'localApi.js'));
const mcp = require(path.join(OUT, 'mcpServer.js'));

const dirs = [];
function tmpDir() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pro-gate-'));
    dirs.push(d);
    return d;
}
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const fakeSafeStorage = () => ({
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`ENC1${Buffer.from(s, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (b) => Buffer.from(b.toString('utf8').slice(4), 'base64').toString('utf8'),
});
const source = {
    listMeetings: () => [{ id: 'm1', title: 'Pricing', date: '2026-11-01T09:00:00.000Z' }],
    getMeeting: () => null,
    searchTranscript: () => [],
    attendeeCount: () => 0,
};
/** Records handlers; the guard lets everything through (the launcher check is covered elsewhere). */
function harness() {
    const handlers = new Map();
    return {
        handlers,
        safeHandle: (ch, fn) => { handlers.set(ch, fn); },
        guard: (_fallback, fn) => async (event, ...args) => fn(event, ...args),
        call: (ch, ...args) => handlers.get(ch)({ sender: {} }, ...args),
    };
}
const isPro = (res) => res && res.ok === false && res.kind === 'pro_required' && /Natively Pro/.test(res.message);

// ── The gate itself ──────────────────────────────────────────────────────

describe('connectorAccess', () => {
    test('requirePro runs the body only with access; a throwing check reads as no access', async () => {
        let ran = 0;
        const body = async () => { ran++; return { ok: true }; };
        assert.deepEqual(await access.requirePro(() => true, body)(), { ok: true });
        assert.ok(isPro(await access.requirePro(() => false, body)()));
        assert.ok(isPro(await access.requirePro(() => { throw new Error('licence read failed'); }, body)()));
        assert.equal(ran, 1);
    });
    test('isProRequired spots the refusal, nothing else', () => {
        assert.equal(access.isProRequired(access.PRO_REQUIRED), true);
        assert.equal(access.isProRequired({ ok: false, kind: 'forbidden' }), false);
        assert.equal(access.isProRequired(null), false);
    });
    test('without the premium licence and with no trial (a source build), connectors read as locked', () => {
        // The default check never throws, whatever is missing; under plain test
        // Node there is neither a licence nor a trial token.
        assert.equal(typeof access.connectorsAllowed(), 'boolean');
    });
});

// ── Webhooks, Zapier and automatic rules ─────────────────────────────────

describe('webhooks and automatic sending', () => {
    // The shape notesDocument builds (as ConnectorsWebhooks uses).
    const DOC = {
        meetingId: 'm1', title: 'Pricing', dateIso: '2026-11-01T09:00:00.000Z', dateLabel: 'Sunday, 1 November 2026', durationLabel: '30 min',
        attendees: [], participants: [], sections: [{ heading: 'Summary', bullets: ['Held list price.'] }], actionItems: [], transcript: [],
    };
    function register(allowedRef, fetchCalls, sent, opts = {}) {
        const h = harness();
        deliveryIpc.registerConnectorsDeliveryIpc({
            safeHandle: h.safeHandle,
            guard: h.guard,
            userDataDir: tmpDir(),
            safeStorage: fakeSafeStorage(),
            loadDoc: async (id) => ({ ...DOC, meetingId: id }),
            foldersOfMeeting: () => [],
            listFolders: () => [],
            autoSendSender: async (d, id) => { sent.push([d.kind, id]); return { ok: true }; },
            connectorsAllowed: () => allowedRef.on,
            fetchImpl: async () => {
                const status = (opts.statuses || [200])[Math.min(fetchCalls.n, (opts.statuses || [200]).length - 1)];
                fetchCalls.n++;
                return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => '' };
            },
            wait: opts.wait ?? (async () => {}),
            timers: opts.timers ?? { setTimeout: () => 0, clearTimeout: () => {} },
        });
        return h;
    }
    const hook = { kind: 'webhook', label: 'CI', url: 'https://hooks.example.com/natively', events: ['note.generated'], folderId: null, includeTranscript: false };

    test('locked: nothing is made, tested or sent; list and delete still work', async () => {
        const allowed = { on: true };
        const fetchCalls = { n: 0 };
        const sent = [];
        const h = register(allowed, fetchCalls, sent);
        // Made while Pro (or a trial)…
        const made = await h.call('connectors:webhook-create', hook);
        assert.equal(made.ok, true, made.message);
        const rule = await h.call('connectors:autosend-create', { destination: { kind: 'notion' }, folderId: null });
        // …then the trial runs out.
        allowed.on = false;
        fetchCalls.n = 0;
        assert.ok(isPro(await h.call('connectors:webhook-create', hook)));
        assert.ok(isPro(await h.call('connectors:webhook-update', made.endpoint.id, { label: 'Ops' })));
        assert.ok(isPro(await h.call('connectors:webhook-test', made.endpoint.id)));
        assert.ok(isPro(await h.call('connectors:webhook-rotate', made.endpoint.id)));
        assert.ok(isPro(await h.call('connectors:autosend-create', { destination: { kind: 'notion' }, folderId: null })));
        if (rule?.ok && rule.rule) assert.ok(isPro(await h.call('connectors:autosend-update', rule.rule.id, { enabled: false })));

        await deliveryIpc.connectorsDelivery.notesReady('m1');
        deliveryIpc.connectorsDelivery.notesEdited('m1');
        assert.equal(fetchCalls.n, 0, 'no webhook fired');
        assert.deepEqual(sent, [], 'no rule sent');

        assert.equal((await h.call('connectors:webhooks-list')).length, 1, 'still listed');
        assert.ok(Array.isArray(await h.call('connectors:autosend-list')));
        assert.equal((await h.call('connectors:webhook-delete', made.endpoint.id)).ok, true, 'delete always works');
        assert.equal((await h.call('connectors:webhooks-list')).length, 0);
    });
    test('an edit timer that fires after Pro or the trial ends sends nothing', async () => {
        const allowed = { on: true };
        const fetchCalls = { n: 0 };
        const armed = [];
        const h = register(allowed, fetchCalls, [], { timers: { setTimeout: (fn) => { armed.push(fn); return armed.length; }, clearTimeout: () => {} } });
        assert.equal((await h.call('connectors:webhook-create', { ...hook, events: ['note.edited'] })).ok, true);
        fetchCalls.n = 0;
        deliveryIpc.connectorsDelivery.notesEdited('m1');
        assert.equal(armed.length, 1, 'armed while Pro');
        allowed.on = false;
        armed[0]();
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(fetchCalls.n, 0, 'the timer sent nothing after the lapse');
    });
    test('a retry wait that ends after Pro or the trial ends stops the delivery', async () => {
        const allowed = { on: true };
        const fetchCalls = { n: 0 };
        const h = register(allowed, fetchCalls, [], { statuses: [503, 200], wait: async () => { allowed.on = false; } });
        assert.equal((await h.call('connectors:webhook-create', hook)).ok, true);
        fetchCalls.n = 0;
        await deliveryIpc.connectorsDelivery.notesReady('m1');
        assert.equal(fetchCalls.n, 1, 'one try, then no retry once locked');
    });
    test('with access: webhooks fire when notes are ready', async () => {
        const fetchCalls = { n: 0 };
        const h = register({ on: true }, fetchCalls, []);
        assert.equal((await h.call('connectors:webhook-create', hook)).ok, true);
        await deliveryIpc.connectorsDelivery.notesReady('m1');
        assert.ok(fetchCalls.n >= 1, 'the webhook was called');
    });
});

// ── Gmail ────────────────────────────────────────────────────────────────

describe('Gmail', () => {
    after(() => gmailIpc.resetGmailServiceForTests());
    function register(allowedRef) {
        const h = harness();
        let opened = 0;
        gmailIpc.registerGmailIpc({
            safeHandle: h.safeHandle,
            guard: h.guard,
            userDataDir: tmpDir(),
            safeStorage: fakeSafeStorage(),
            openExternal: () => { opened++; },
            platform: 'darwin',
            client: () => ({ id: 'client-id', secret: 'client-secret' }),
            grantShared: () => false,
            fetchImpl: async () => { throw new Error('no network in this test'); },
            connectorsAllowed: () => allowedRef.on,
        });
        return { ...h, opened: () => opened };
    }
    test('locked: no sign-in, no send, briefs cannot be turned on; status says locked, disconnect works', async () => {
        const h = register({ on: false });
        assert.ok(isPro(await h.call('connectors:gmail-connect')));
        assert.equal(h.opened(), 0, 'no browser opened');
        assert.ok(isPro(await h.call('connectors:gmail-send-followup', { meetingId: 'm1', to: ['a@b.com'], subject: 's', body: 'b' })));
        const s = await h.call('connectors:gmail-set-briefs', true);
        assert.equal(s.briefsEnabled, false);
        assert.equal(s.locked, true);
        assert.equal((await h.call('connectors:gmail-status')).locked, true);
        assert.equal((await h.call('connectors:gmail-disconnect')).ok, true);
        assert.deepEqual(await gmailIpc.gmailBriefContext(['a@b.com']), []);
    });
    test('with access: status is not locked, and connect gets past the gate', async () => {
        const h = register({ on: true });
        assert.equal((await h.call('connectors:gmail-status')).locked, undefined);
        // Past the gate the browser sign-in starts (and is cancelled at once), not refused for Pro.
        const pending = h.call('connectors:gmail-connect');
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(h.opened(), 1, 'the browser sign-in opened');
        await h.call('connectors:gmail-cancel');
        const res = await pending;
        assert.notEqual(res?.kind, 'pro_required');
    });
});

// ── Personal API keys and the local API ──────────────────────────────────

function get(port, pathName, key) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: pathName, method: 'GET', headers: { Host: `127.0.0.1:${port}`, ...(key ? { Authorization: `Bearer ${key}` } : {}) } }, (res) => {
            let text = '';
            res.on('data', (c) => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() }));
        });
        req.on('error', reject);
        req.end();
    });
}

describe('API keys and the local API', () => {
    test('locked: no new key; listing and revoking still work', async () => {
        const allowed = { on: true };
        const h = harness();
        localApiIpc.registerLocalApiIpc({
            safeHandle: h.safeHandle, guard: h.guard, userDataDir: tmpDir(), safeStorage: fakeSafeStorage(), source,
            connectorsAllowed: () => allowed.on,
        });
        const made = await h.call('connectors:apikey-create', { description: 'script', expiresInDays: 30 });
        assert.equal(made.ok, true, made.message);
        allowed.on = false;
        assert.ok(isPro(await h.call('connectors:apikey-create', { description: 'another', expiresInDays: 30 })));
        assert.equal((await h.call('connectors:apikeys-list')).keys.length, 1);
        assert.equal((await h.call('connectors:apikey-revoke', made.info.id)).ok, true);
        await localApiIpc.stopLocalApi();
    });
    test('the server answers 403 pro_required to a valid key while locked, 401 to a bad key, 200 with access', async () => {
        let on = false;
        const server = await localApi.startLocalApiServer({ port: 0, verify: (k) => k === 'nat_good', source, allowed: () => on });
        try {
            assert.equal((await get(server.port, '/v1/notes', 'nat_bad')).status, 401, 'the key check comes first');
            const locked = await get(server.port, '/v1/notes', 'nat_good');
            assert.equal(locked.status, 403);
            assert.equal(locked.json.error, 'pro_required');
            on = true;
            assert.equal((await get(server.port, '/v1/notes', 'nat_good')).status, 200);
        } finally {
            await server.close();
        }
    });
});

// ── MCP ──────────────────────────────────────────────────────────────────

describe('MCP server', () => {
    test('403 pro_required after the token check while locked; answers again with access', async () => {
        let on = false;
        const server = await mcp.startMcpServer({ port: 0, token: () => 'tok', source, version: '1', allowed: () => on });
        const post = (token) => new Promise((resolve, reject) => {
            const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
            const req = http.request({ host: '127.0.0.1', port: server.port, path: mcp.MCP_PATH, method: 'POST', headers: { Host: `127.0.0.1:${server.port}`, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }, (res) => {
                let text = '';
                res.on('data', (c) => { text += c; });
                res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() }));
            });
            req.on('error', reject);
            req.end(body);
        });
        try {
            assert.equal((await post('wrong')).status, 401);
            const locked = await post('tok');
            assert.equal(locked.status, 403);
            assert.equal(locked.json.code, 'pro_required');
            on = true;
            assert.equal((await post('tok')).status, 200);
        } finally {
            await server.close();
        }
    });
});

// ── Settings › Connectors and the Share menu (outputsIpc) ────────────────

describe('outputsIpc', () => {
    const originalLoad = Module._load;
    const handlers = new Map();
    const SENDER = { id: 1 };
    const allowed = { on: false };
    let tmp;
    before(() => {
        tmp = tmpDir();
        process.env.NATIVELY_TEST_USERDATA = tmp;
        const electronStub = {
            app: { getPath: () => tmp, isPackaged: false, isReady: () => true, getVersion: () => '0.0.0', getLocale: () => 'en-US', on: () => {}, once: () => {}, whenReady: () => Promise.resolve(), focus: () => {} },
            BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
            safeStorage: { isEncryptionAvailable: () => false },
            dialog: {}, shell: { openExternal: async () => {} }, clipboard: { writeText: () => {} }, ipcMain: { handle: () => {}, on: () => {} },
            Notification: class { static isSupported() { return false; } on() {} show() {} },
        };
        Module._load = function (request, parent, isMain) {
            if (request === 'electron') return electronStub;
            return originalLoad.call(this, request, parent, isMain);
        };
        const ipc = require(path.join(OUT, 'outputsIpc.js'));
        const appState = {
            getWindowHelper: () => ({ getLauncherWindow: () => ({ isDestroyed: () => false, webContents: SENDER }) }),
            getUndetectable: () => false,
            processingHelper: { getLLMHelper: () => null },
        };
        ipc.registerOutputsIpc(appState, (ch, fn) => handlers.set(ch, fn), { connectorsAllowed: () => allowed.on });
    });
    after(() => { Module._load = originalLoad; });
    const call = (ch, ...args) => handlers.get(ch)({ sender: SENDER }, ...args);

    test('locked: the pane is told, every connect and send refuses, disconnect and remove still work', async () => {
        allowed.on = false;
        const status = await call('outputs:get-connections');
        assert.equal(status.pro, false);
        for (const [ch, args] of [
            ['outputs:oauth-connect', ['notion']],
            ['outputs:slack-add', ['#ops', 'https://hooks.slack.com/services/T/B/x']],
            ['outputs:slack-test', ['nope']],
            ['outputs:save-token', ['hubspot', 'pat-123']],
            ['outputs:test', ['hubspot']],
            ['outputs:notion-search', ['']],
            ['outputs:notion-set-parent', [{ type: 'page', id: '0123456789abcdef0123456789abcdef', title: 'x' }]],
            ['outputs:slack-compose', ['m1', {}]],
            ['outputs:slack-send', [{ webhookId: 'w', meetingId: 'm1', text: 'hi' }]],
            ['outputs:notion-send', ['m1', {}]],
            ['outputs:notion-resume', ['m1']],
            ['outputs:enrich-attendees', ['m1']],
            ['outputs:crm-send', ['m1', 'hubspot', ['a@b.com']]],
        ]) {
            assert.ok(isPro(await call(ch, ...args)), `${ch} refuses without Pro`);
        }
        const preview = await call('outputs:crm-preview', 'm1', 'hubspot');
        assert.equal(preview.kind, 'pro_required');
        assert.deepEqual(preview.attendees, []);

        assert.equal((await call('outputs:disconnect', 'hubspot')).ok, true);
        assert.equal((await call('outputs:slack-remove', 'nope')).ok, true);

        const mcpOn = await call('outputs:mcp-set-enabled', true);
        assert.equal(mcpOn.enabled, false, 'the MCP server is not turned on');
        assert.match(mcpOn.error, /Natively Pro/);
        assert.equal((await call('outputs:mcp-set-enabled', false)).enabled, false, 'off always works');
    });
    // Every channel this registers is either listed here as free on purpose, or
    // refuses without Pro before reading its arguments. A new connector handler
    // added with the plain guard fails this test until it is gated or listed.
    const FREE = new Set([
        // Not connectors: export, share link, writing style, follow-up edits.
        'outputs:export-pdf', 'outputs:share-link-get', 'outputs:share-link-create', 'outputs:share-link-revoke',
        'outputs:style-get', 'outputs:style-get-for-meeting', 'outputs:style-list', 'outputs:style-add', 'outputs:style-remove',
        'outputs:style-record-followup', 'outputs:style-refresh', 'outputs:followup-save', 'outputs:open-notion-page',
        // Status, and clearing what is there.
        'outputs:get-connections', 'outputs:oauth-services', 'outputs:oauth-cancel', 'outputs:slack-remove', 'outputs:disconnect',
        'outputs:mcp-reset-token', 'connectors:list-folders', 'connectors:webhooks-list', 'connectors:webhook-delete',
        'connectors:autosend-list', 'connectors:autosend-delete', 'connectors:gmail-status', 'connectors:gmail-cancel',
        'connectors:gmail-disconnect', 'connectors:apikeys-list', 'connectors:apikey-revoke',
        // Gated by their argument (on refused, off allowed): asserted above.
        'outputs:mcp-set-enabled', 'connectors:gmail-set-briefs',
    ]);
    test('locked: every registered channel is gated or free on purpose', async () => {
        allowed.on = false;
        const ungated = [];
        for (const ch of handlers.keys()) {
            if (FREE.has(ch)) continue;
            const res = await call(ch);
            if (res?.kind !== 'pro_required') ungated.push(ch);
        }
        assert.deepEqual(ungated, [], 'gate these with proGuard, or add them to FREE with a reason');
        for (const ch of FREE) assert.ok(handlers.has(ch), `${ch} is still registered`);
    });
    test('with access: the pane is told Pro, and calls get past the gate', async () => {
        allowed.on = true;
        assert.equal((await call('outputs:get-connections')).pro, true);
        // Past the gate it fails for its own reason (nothing connected), not for Pro.
        const res = await call('outputs:test', 'hubspot');
        assert.equal(res.ok, false);
        assert.equal(res.kind, 'not_connected');
    });
});
