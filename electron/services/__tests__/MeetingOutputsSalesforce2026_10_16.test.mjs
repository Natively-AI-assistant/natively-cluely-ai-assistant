// Granola parity round 3 (2026-10-16): Salesforce CRM notes. People are found
// with SOQL on Contact.Email at the user's own org host (instanceUrl), and the
// meeting is logged as a completed Task on each matched contact. A pasted
// access token plus the instance URL is enough; no OAuth app is required. Fake
// fetch only; no network.
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
const crm = dist('crm.js');
const notes = dist('notesDocument.js');
const { ConnectionsStore } = dist('connectionsStore.js');

const json = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

function recorder(route) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
        calls.push(call);
        return route(call);
    };
    return { calls, fetchImpl };
}

const doc = notes.buildNotesDocument({
    id: 'm', title: 'Renewal call', date: '2026-10-14T15:00:00.000Z',
    detailedSummary: { schemaVersion: 3, tldr: ['Renewal agreed'], sectionsV3: [], actionItemsV3: [{ text: 'Send contract', owner: 'Dana', status: 'open' }] },
});
const INSTANCE = 'https://acme.my.salesforce.com';

describe('instance URL', () => {
    test('accepts a bare host, a full URL, and strips path / trailing slash', () => {
        assert.equal(crm.normaliseSalesforceInstanceUrl('acme.my.salesforce.com'), INSTANCE);
        assert.equal(crm.normaliseSalesforceInstanceUrl('https://acme.my.salesforce.com/'), INSTANCE);
        assert.equal(crm.normaliseSalesforceInstanceUrl('https://acme.my.salesforce.com/services/data'), INSTANCE);
        assert.equal(crm.normaliseSalesforceInstanceUrl('  https://ACME.my.salesforce.com  '), INSTANCE);
        assert.equal(crm.normaliseSalesforceInstanceUrl('https://na1.salesforce.com'), 'https://na1.salesforce.com');
    });
    test('rejects http, non-Salesforce hosts, and junk', () => {
        assert.equal(crm.normaliseSalesforceInstanceUrl('http://acme.my.salesforce.com'), null);
        assert.equal(crm.normaliseSalesforceInstanceUrl('https://evil.example.com'), null);
        assert.equal(crm.normaliseSalesforceInstanceUrl('https://acme.my.salesforce.com.evil.com'), null);
        assert.equal(crm.normaliseSalesforceInstanceUrl(''), null);
        assert.equal(crm.normaliseSalesforceInstanceUrl('not a url'), null);
    });
});

describe('matching by email (SOQL on Contact.Email)', () => {
    test('queries at the instance host with a bearer token; takes the exact-email contact', async () => {
        const { calls, fetchImpl } = recorder(() => json(200, { records: [
            { attributes: {}, Id: '003AAA', Name: 'Dana Lee', Email: 'Dana@Acme.com' },
            { attributes: {}, Id: '003ZZZ', Name: 'Someone Else', Email: 'other@acme.com' },
        ] }));
        const m = await crm.matchAttendees('salesforce', [{ email: 'dana@acme.com' }], { token: 'tok', instanceUrl: INSTANCE, fetchImpl });
        assert.deepEqual(m[0].record, { id: '003AAA', name: 'Dana Lee' });
        assert.ok(calls[0].url.startsWith(`${INSTANCE}/services/data/${crm.SALESFORCE_API_VERSION}/query/?q=`));
        assert.match(decodeURIComponent(calls[0].url), /SELECT Id, Name, Email FROM Contact WHERE Email = 'dana@acme\.com' LIMIT 5/);
        assert.equal(calls[0].headers.Authorization, 'Bearer tok');
    });
    test('no match when the email is not in the org', async () => {
        const { fetchImpl } = recorder(() => json(200, { records: [] }));
        const m = await crm.matchAttendees('salesforce', [{ email: 'nobody@acme.com' }], { token: 'tok', instanceUrl: INSTANCE, fetchImpl });
        assert.equal(m[0].record, undefined);
    });
    test('without an instance URL the lookup throws (never falls back to another host)', async () => {
        await assert.rejects(() => crm.findCrmRecord('salesforce', 'dana@acme.com', { token: 'tok', fetchImpl: async () => json(200, {}) }));
    });
});

describe('logging the meeting as a Task', () => {
    test('one completed Task per contact: Subject, Description, WhoId, ActivityDate, TaskSubtype', async () => {
        const { calls, fetchImpl } = recorder(() => json(201, { id: '00TAAA', success: true }));
        const outcome = await crm.sendCrmNote('salesforce', doc, [{ id: '003AAA', name: 'Dana' }, { id: '003BBB', name: 'Lee' }], { token: 'tok', instanceUrl: INSTANCE, fetchImpl });
        assert.deepEqual(outcome.sentIds, ['003AAA', '003BBB']);
        assert.equal(outcome.notesCreated, 2);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].url, `${INSTANCE}/services/data/${crm.SALESFORCE_API_VERSION}/sobjects/Task`);
        assert.equal(calls[0].method, 'POST');
        assert.equal(calls[0].headers.Authorization, 'Bearer tok');
        assert.equal(calls[0].body.Subject, 'Renewal call');
        assert.equal(calls[0].body.WhoId, '003AAA');
        assert.equal(calls[0].body.Status, 'Completed');
        assert.equal(calls[0].body.TaskSubtype, 'Call');
        assert.equal(calls[0].body.ActivityDate, '2026-10-14');
        assert.match(calls[0].body.Description, /Renewal agreed/);
        assert.equal(calls[1].body.WhoId, '003BBB');
    });
    test('a mid-way failure reports who already has theirs', async () => {
        let n = 0;
        const { fetchImpl } = recorder(() => (++n === 1 ? json(201, { id: 'x' }) : json(500, 'server error')));
        const outcome = await crm.sendCrmNote('salesforce', doc, [{ id: '003AAA' }, { id: '003BBB' }], { token: 'tok', instanceUrl: INSTANCE, fetchImpl });
        assert.deepEqual(outcome.sentIds, ['003AAA']);
        assert.equal(outcome.notesCreated, 1);
        assert.equal(outcome.error, 'server');
    });
    test('without an instance URL nothing is sent', async () => {
        const outcome = await crm.sendCrmNote('salesforce', doc, [{ id: '003AAA' }], { token: 'tok' });
        assert.deepEqual(outcome.sentIds, []);
        assert.equal(outcome.error, 'not_connected');
    });
    test('the Task body is plain text, capped at 32k', () => {
        const big = notes.buildNotesDocument({ id: 'b', title: 'T', date: '2026-10-14T15:00:00.000Z', detailedSummary: { schemaVersion: 3, tldr: [Array(40000).fill('x').join('')], sectionsV3: [], actionItemsV3: [] } });
        const body = crm.crmNoteBody('salesforce', big);
        assert.ok(body.length <= 32000);
        assert.ok(!/</.test(body), 'plain text, not HTML');
    });
});

describe('test connection', () => {
    test('hits the org limits endpoint with the token', async () => {
        const { calls, fetchImpl } = recorder(() => json(200, {}));
        await crm.testCrm('salesforce', { token: 'tok', instanceUrl: INSTANCE, fetchImpl });
        assert.equal(calls[0].url, `${INSTANCE}/services/data/${crm.SALESFORCE_API_VERSION}/limits`);
        assert.equal(calls[0].headers.Authorization, 'Bearer tok');
    });
    test('throws without an instance URL', async () => {
        await assert.rejects(() => crm.testCrm('salesforce', { token: 'tok', fetchImpl: async () => json(200, {}) }));
    });
});

describe('activity date', () => {
    test('YYYY-MM-DD from the meeting date, today for a bad date', () => {
        assert.equal(crm.salesforceActivityDate('2026-10-14T15:00:00.000Z'), '2026-10-14');
        assert.equal(crm.salesforceActivityDate('not-a-date', () => Date.parse('2026-01-02T00:00:00Z')), '2026-01-02');
    });
});

describe('connections store', () => {
    const fakeSafe = () => {
        return {
            isEncryptionAvailable: () => true,
            encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
            decryptString: (b) => b.toString('utf8').replace(/^enc:/, ''),
        };
    };
    const freshStore = () => {
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nat-sf-'));
        return { store: new ConnectionsStore({ userDataDir, safeStorage: fakeSafe() }), userDataDir };
    };

    test('saves the token and instance URL together, reads them back, and survives a reload', () => {
        const { store, userDataDir } = freshStore();
        assert.equal(store.setSalesforce('sftok', INSTANCE), true);
        assert.equal(store.token('salesforce'), 'sftok');
        assert.equal(store.salesforceInstanceUrl(), INSTANCE);
        const reopened = new ConnectionsStore({ userDataDir, safeStorage: fakeSafe() });
        assert.equal(reopened.token('salesforce'), 'sftok');
        assert.equal(reopened.salesforceInstanceUrl(), INSTANCE);
    });

    test('a salesforce entry with no instance URL is dropped on read', () => {
        const { store, userDataDir } = freshStore();
        fs.writeFileSync(path.join(userDataDir, 'connections.enc'), fakeSafe().encryptString(JSON.stringify({ slack: { webhooks: [] }, salesforce: { token: 'x' } })));
        const reopened = new ConnectionsStore({ userDataDir, safeStorage: fakeSafe() });
        assert.equal(reopened.token('salesforce'), null);
        assert.equal(reopened.salesforceInstanceUrl(), null);
    });

    test('disconnect removes both', () => {
        const { store } = freshStore();
        store.setSalesforce('sftok', INSTANCE);
        store.clear('salesforce');
        assert.equal(store.token('salesforce'), null);
        assert.equal(store.salesforceInstanceUrl(), null);
    });
});
