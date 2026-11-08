// Granola parity round 4 (2026-10-16): attendee enrichment. A title and
// company looked up by email in Clearbit, offered as People-page suggestions.
// Opt-in, on an explicit action only; a result never applies itself. Fake
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
const en = dist('enrichment.js');
const { ConnectionsStore } = dist('connectionsStore.js');

const json = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
function recorder(route) {
    const calls = [];
    const fetchImpl = async (url, init) => { const call = { url, method: init.method, headers: init.headers }; calls.push(call); return route(call); };
    return { calls, fetchImpl };
}
const DANA = { name: { fullName: 'Dana Lee', givenName: 'Dana', familyName: 'Lee' }, employment: { title: 'Head of Sales', name: 'Acme' } };

describe('parsing a person record', () => {
    test('name, title and company are read; missing pieces are left out', () => {
        assert.deepEqual(en.parseEnrichedPerson(DANA, 'dana@acme.com'), { email: 'dana@acme.com', name: 'Dana Lee', title: 'Head of Sales', company: 'Acme' });
        assert.deepEqual(en.parseEnrichedPerson({ name: { givenName: 'Lee' } }, 'x@y.com'), { email: 'x@y.com', name: 'Lee' });
        assert.deepEqual(en.parseEnrichedPerson(null, 'x@y.com'), { email: 'x@y.com' });
    });
    test('values are one line and capped', () => {
        const long = 'x'.repeat(200);
        const p = en.parseEnrichedPerson({ employment: { title: `  Head\n of ${long}` } }, 'x@y.com');
        assert.ok(p.title.length <= 80);
        assert.ok(!/\n/.test(p.title));
    });
});

describe('looking people up', () => {
    test('GET the person API by email with a bearer key', async () => {
        const { calls, fetchImpl } = recorder(() => json(200, DANA));
        const p = await en.lookupPerson('Dana@Acme.com', { token: 'sk_test', fetchImpl });
        assert.equal(p.title, 'Head of Sales');
        assert.equal(calls[0].url, 'https://person.clearbit.com/v2/people/find?email=dana%40acme.com');
        assert.equal(calls[0].headers.Authorization, 'Bearer sk_test');
    });
    test('a 404 means "not in the directory": an empty result, not a failure', async () => {
        const { fetchImpl } = recorder(() => json(404, { error: { type: 'unknown_record' } }));
        assert.deepEqual(await en.lookupPerson('nobody@acme.com', { token: 'k', fetchImpl }), { email: 'nobody@acme.com' });
    });
    test('a refused key throws so the caller can word it', async () => {
        const { fetchImpl } = recorder(() => json(401, 'unauthorized'));
        await assert.rejects(() => en.lookupPerson('dana@acme.com', { token: 'bad', fetchImpl }));
    });
    test('an invalid email is skipped without a request', async () => {
        const { calls, fetchImpl } = recorder(() => json(200, DANA));
        assert.deepEqual(await en.lookupPerson('not-an-email', { token: 'k', fetchImpl }), { email: 'not-an-email' });
        assert.equal(calls.length, 0);
    });
    test('attendees are looked up one by one, de-duplicated, capped, and stop at the first real failure', async () => {
        let n = 0;
        const { calls, fetchImpl } = recorder(() => (++n <= 2 ? json(200, DANA) : json(500, 'down')));
        const r = await en.lookupAttendees(['a@x.com', 'A@x.com', 'b@x.com', 'c@x.com', 'd@x.com'], { token: 'k', fetchImpl });
        assert.equal(calls.length, 3);
        assert.equal(r.people.length, 2);
        assert.equal(r.error, 'server');
        const many = Array.from({ length: 40 }, (_, i) => `p${i}@x.com`);
        const { fetchImpl: ok } = recorder(() => json(404, {}));
        const capped = await en.lookupAttendees(many, { token: 'k', fetchImpl: ok });
        assert.equal(capped.people.length, en.ENRICH_MAX_ATTENDEES);
    });
});

describe('testing a key', () => {
    test('uses a fixed public address, never user data; 404 counts as accepted', async () => {
        const { calls, fetchImpl } = recorder(() => json(404, {}));
        await en.testEnrichment({ token: 'k', fetchImpl });
        assert.match(calls[0].url, /email=hello%40clearbit\.com$/);
    });
    test('a refused key fails the test', async () => {
        const { fetchImpl } = recorder(() => json(401, 'no'));
        await assert.rejects(() => en.testEnrichment({ token: 'bad', fetchImpl }));
    });
});

describe('suggestions', () => {
    test('one per known field, each quoting where it came from', () => {
        assert.deepEqual(en.enrichmentFacts({ email: 'd@a.com', title: 'Head of Sales', company: 'Acme' }), [
            { kind: 'title', value: 'Head of Sales', quote: 'Clearbit: Head of Sales at Acme' },
            { kind: 'company', value: 'Acme', quote: 'Clearbit: Acme' },
        ]);
        assert.deepEqual(en.enrichmentFacts({ email: 'd@a.com', title: 'CTO' }), [{ kind: 'title', value: 'CTO', quote: 'Clearbit: CTO' }]);
        assert.deepEqual(en.enrichmentFacts({ email: 'd@a.com' }), []);
    });
});

describe('company description (round 5)', () => {
    test('GET the company API by domain; name and description read; 404 is empty', async () => {
        const { calls, fetchImpl } = recorder(() => json(200, { name: 'Acme Inc', description: 'Acme makes anvils for cartoon coyotes.' }));
        const c = await en.lookupCompany('Acme.com', { token: 'k', fetchImpl });
        assert.deepEqual(c, { domain: 'acme.com', name: 'Acme Inc', description: 'Acme makes anvils for cartoon coyotes.' });
        assert.equal(calls[0].url, 'https://company.clearbit.com/v2/companies/find?domain=acme.com');
        assert.equal(calls[0].headers.Authorization, 'Bearer k');
        const { fetchImpl: nf } = recorder(() => json(404, {}));
        assert.deepEqual(await en.lookupCompany('nobody.io', { token: 'k', fetchImpl: nf }), { domain: 'nobody.io' });
    });
    test('a bad domain is skipped without a request; the description is capped', async () => {
        const { calls, fetchImpl } = recorder(() => json(200, {}));
        assert.deepEqual(await en.lookupCompany('not a domain', { token: 'k', fetchImpl }), { domain: 'not a domain' });
        assert.equal(calls.length, 0);
        const long = en.parseEnrichedCompany({ description: 'x'.repeat(2000) }, 'a.io');
        assert.ok(long.description.length <= 600);
    });
});

describe('connections store', () => {
    const fakeSafe = () => ({ isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => b.toString('utf8').replace(/^enc:/, '') });
    test('the Clearbit key is saved like the other tokens and survives a reload', () => {
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nat-en-'));
        const store = new ConnectionsStore({ userDataDir, safeStorage: fakeSafe() });
        assert.equal(store.setToken('clearbit', 'sk_live'), true);
        assert.equal(new ConnectionsStore({ userDataDir, safeStorage: fakeSafe() }).token('clearbit'), 'sk_live');
        store.clear('clearbit');
        assert.equal(store.token('clearbit'), null);
    });
});
