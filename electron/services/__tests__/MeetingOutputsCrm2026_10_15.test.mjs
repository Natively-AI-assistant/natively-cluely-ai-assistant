// Granola parity round 2, outputs (2026-10-15): CRM notes (HubSpot, Attio,
// Affinity) matched by attendee email, and the one HTTP client every output
// uses (timeouts, size caps, https only, plain-words failures). Fake fetch only.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => require(path.join(REPO, 'dist-electron/electron/services/outputs', p));
const crm = dist('crm.js');
const http = dist('httpRequest.js');
const notes = dist('notesDocument.js');

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

describe('who gets looked up', () => {
    test('valid distinct emails only, minus the user and calendar rooms, case-insensitive', () => {
        const c = crm.crmCandidates([
            { email: 'Dana@Acme.com', name: 'Dana' },
            { email: 'dana@acme.com' },
            { email: 'me@natively.app' },
            { email: 'room-4@resource.calendar.google.com' },
            { email: 'not-an-email' },
            { email: 'lee@beta.io' },
        ], ['ME@natively.app']);
        assert.deepEqual(c, [{ email: 'dana@acme.com', name: 'Dana' }, { email: 'lee@beta.io' }]);
    });
    test('capped so one send is never a burst of lookups', () => {
        const many = Array.from({ length: 60 }, (_, i) => ({ email: `p${i}@x.com` }));
        assert.equal(crm.crmCandidates(many).length, crm.CRM_MAX_ATTENDEES);
    });
});

describe('matching by email', () => {
    test('HubSpot: contacts search on email EQ; only an exact (case-insensitive) email counts', async () => {
        const { calls, fetchImpl } = recorder(({ body }) => {
            const email = body.filterGroups[0].filters[0].value;
            if (email === 'dana@acme.com') return json(200, { results: [{ id: '501', properties: { email: 'Dana@Acme.com', firstname: 'Dana', lastname: 'Lee' } }] });
            return json(200, { results: [{ id: '9', properties: { email: 'someone-else@x.com' } }] });
        });
        const m = await crm.matchAttendees('hubspot', [{ email: 'dana@acme.com' }, { email: 'lee@beta.io' }], { token: 'pat', fetchImpl });
        assert.deepEqual(m, [{ email: 'dana@acme.com', record: { id: '501', name: 'Dana Lee' } }, { email: 'lee@beta.io' }]);
        assert.equal(calls[0].url, 'https://api.hubapi.com/crm/v3/objects/contacts/search');
        assert.deepEqual(calls[0].body.filterGroups[0].filters[0], { propertyName: 'email', operator: 'EQ', value: 'dana@acme.com' });
        assert.equal(calls[0].headers.Authorization, 'Bearer pat');
    });
    test('Attio: people query filtered by email_addresses', async () => {
        const { calls, fetchImpl } = recorder(() => json(200, { data: [{ id: { record_id: 'rec-1' }, values: { email_addresses: [{ email_address: 'Dana@acme.com' }], name: [{ full_name: 'Dana Lee' }] } }] }));
        const m = await crm.matchAttendees('attio', [{ email: 'dana@acme.com' }], { token: 'k', fetchImpl });
        assert.deepEqual(m[0].record, { id: 'rec-1', name: 'Dana Lee' });
        assert.equal(calls[0].url, 'https://api.attio.com/v2/objects/people/records/query');
        assert.deepEqual(calls[0].body.filter, { email_addresses: 'dana@acme.com' });
    });
    test('Affinity: persons search by term, Basic auth with the key as password, other emails ignored', async () => {
        const { calls, fetchImpl } = recorder(() => json(200, { persons: [
            { id: 7, first_name: 'Not', last_name: 'Her', primary_email: 'other@acme.com', emails: [] },
            { id: 8, first_name: 'Dana', last_name: 'Lee', primary_email: 'x@y.com', emails: ['DANA@acme.com'] },
        ] }));
        const m = await crm.matchAttendees('affinity', [{ email: 'dana@acme.com' }], { token: 'key', fetchImpl });
        assert.deepEqual(m[0].record, { id: '8', name: 'Dana Lee' });
        assert.equal(calls[0].url, 'https://api.affinity.co/persons?term=dana%40acme.com&page_size=10');
        assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from(':key').toString('base64')}`);
    });
});

describe('writing the note', () => {
    test('HubSpot: one note, HTML body, associated with every matched contact (type 202)', async () => {
        const { calls, fetchImpl } = recorder(() => json(201, { id: 'n1' }));
        const n = await crm.sendCrmNote('hubspot', doc, [{ id: '501' }, { id: '502' }], { token: 't', fetchImpl });
        assert.deepEqual(n, { sentIds: ['501', '502'], notesCreated: 1 });
        const b = calls[0].body;
        assert.equal(calls[0].url, 'https://api.hubapi.com/crm/v3/objects/notes');
        assert.equal(b.properties.hs_timestamp, '2026-10-14T15:00:00.000Z');
        assert.match(b.properties.hs_note_body, /^<p>Renewal call<\/p><p>Wednesday, October 14, 2026<\/p>.*<p>☐ Dana: Send contract<\/p>$/);
        assert.deepEqual(b.associations.map((a) => [a.to.id, a.types[0].associationTypeId]), [['501', 202], ['502', 202]]);
    });
    test('Attio: one Markdown note per person', async () => {
        const { calls, fetchImpl } = recorder(() => json(200, { data: {} }));
        const n = await crm.sendCrmNote('attio', doc, [{ id: 'r1' }, { id: 'r2' }], { token: 't', fetchImpl });
        assert.deepEqual(n, { sentIds: ['r1', 'r2'], notesCreated: 2 });
        assert.deepEqual(calls.map((c) => c.body.data.parent_record_id), ['r1', 'r2']);
        assert.equal(calls[0].body.data.format, 'markdown');
        assert.match(calls[0].body.data.content, /## Action items\n\n- \[ \] Dana: Send contract/);
        assert.ok(!calls[0].body.data.content.startsWith('# '), 'the note title is Attio\'s own field');
    });
    test('Affinity: one note on all matched persons, numeric ids', async () => {
        const { calls, fetchImpl } = recorder(() => json(200, { id: 1 }));
        await crm.sendCrmNote('affinity', doc, [{ id: '8' }, { id: '9' }], { token: 't', fetchImpl });
        assert.deepEqual(calls[0].body.person_ids, [8, 9]);
        assert.ok(calls[0].body.content.startsWith('Renewal call\n\n'));
    });
    test('HubSpot note body escapes markup from the notes', () => {
        const hostile = notes.buildNotesDocument({ id: 'h', title: '<b>x</b>', date: '2026-10-14T00:00:00Z', detailedSummary: { schemaVersion: 3, tldr: ['<script>1</script>'] } });
        const body = crm.crmNoteBody('hubspot', hostile);
        assert.ok(!body.includes('<script>') && !body.includes('<b>x'));
    });
    test('no matched records: nothing is sent', async () => {
        let called = false;
        assert.deepEqual(await crm.sendCrmNote('hubspot', doc, [], { token: 't', fetchImpl: async () => { called = true; } }), { sentIds: [], notesCreated: 0 });
        assert.equal(called, false);
    });
});

describe('HTTP client', () => {
    test('statuses become plain causes; no status or code in the sentence', async () => {
        const cases = [[401, 'auth'], [403, 'forbidden'], [404, 'not_found'], [429, 'rate_limited'], [503, 'server'], [400, 'invalid_input']];
        for (const [status, kind] of cases) {
            await assert.rejects(http.httpRequest('https://api.x.com/a', { fetchImpl: async () => json(status, '{}') }), (e) => e.kind === kind);
            const sentence = http.describeConnectionError(kind, 'HubSpot');
            assert.ok(!/\d{3}/.test(sentence), sentence);
            assert.ok(sentence.length > 10);
        }
    });
    test('only https; a network failure and a timeout are told apart', async () => {
        await assert.rejects(http.httpRequest('http://api.x.com/a', { fetchImpl: async () => json(200, '{}') }), (e) => e.kind === 'invalid_input');
        await assert.rejects(http.httpRequest('https://api.x.com/a', { fetchImpl: async () => { throw new TypeError('fetch failed'); } }), (e) => e.kind === 'network');
        const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        await assert.rejects(http.httpRequest('https://api.x.com/a', { fetchImpl: hang, timeoutMs: 30 }), (e) => e.kind === 'timeout');
    });
    test('the caller can abort', async () => {
        const ac = new AbortController();
        const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        const p = http.httpRequest('https://api.x.com/a', { fetchImpl: hang, signal: ac.signal, timeoutMs: 5000 });
        ac.abort();
        await assert.rejects(p, (e) => e.kind === 'network');
    });
    test('responses over the cap are refused, by header and while reading', async () => {
        await assert.rejects(http.httpRequest('https://api.x.com/a', { maxResponseBytes: 10, fetchImpl: async () => json(200, '{}', { 'content-length': '999' }) }), (e) => e.kind === 'too_large');
        const chunks = [new Uint8Array(8), new Uint8Array(8)];
        const streaming = async () => ({ ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }), cancel: async () => {} }) }, text: async () => '' });
        await assert.rejects(http.httpRequest('https://api.x.com/a', { maxResponseBytes: 10, fetchImpl: streaming }), (e) => e.kind === 'too_large');
    });
    test('requests over the cap are not sent', async () => {
        let sent = false;
        await assert.rejects(http.httpRequest('https://api.x.com/a', { json: { a: 'x'.repeat(http.MAX_REQUEST_BYTES) }, fetchImpl: async () => { sent = true; return json(200, '{}'); } }), (e) => e.kind === 'too_large');
        assert.equal(sent, false);
    });
    test('redirects are refused rather than followed', async () => {
        let init;
        await http.httpRequest('https://api.x.com/a', { fetchImpl: async (_u, i) => { init = i; return json(200, '{"ok":true}'); } });
        assert.equal(init.redirect, 'error');
    });
});
