// PR #652 review fixes (2026-10-15), main-process side. One describe per fix:
//   2. CRM partial success is reported and a retry writes only the rest
//   4. the template follow-up draft (NATIVELY_FOLLOWUP_DRAFT_V2=0) makes no style-profile call
//   5. one CRM person gets one note, however many of their emails were picked
//   6. a half-made Notion page keeps its link; the rest goes to the SAME page
//   7. Slack drafts over the limit are refused, never cut
//   8. People are indexed past the first batch, in yielding batches, lists refreshed per batch
// Fake fetch and scratch SQLite only.
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
const dist = (p) => require(path.join(REPO, 'dist-electron/electron', p));
const crm = dist('services/outputs/crm.js');
const notion = dist('services/outputs/notion.js');
const slack = dist('services/outputs/slack.js');
const notes = dist('services/outputs/notesDocument.js');
const style = dist('services/outputs/writingStyle.js');
const http = dist('services/outputs/httpRequest.js');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const doc = notes.buildNotesDocument({
    id: 'm', title: 'Renewal', date: '2026-10-14T15:00:00.000Z',
    detailedSummary: { schemaVersion: 3, tldr: ['Agreed'], actionItemsV3: [] },
});

describe('2. CRM partial success', () => {
    test('Attio: the notes written before a failure are reported, not thrown away', async () => {
        const calls = [];
        const fetchImpl = async (url, init) => {
            const body = JSON.parse(init.body);
            calls.push(body.data.parent_record_id);
            return body.data.parent_record_id === 'r2' ? json(503, {}) : json(200, {});
        };
        const out = await crm.sendCrmNote('attio', doc, [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }], { token: 't', fetchImpl });
        assert.deepEqual(out, { sentIds: ['r1'], notesCreated: 1, error: 'server' });
        assert.deepEqual(calls, ['r1', 'r2'], 'stops at the failure');
    });
    test('HubSpot and Affinity: one request for everyone, so a failure means nobody, reported (not thrown)', async () => {
        for (const service of ['hubspot', 'affinity']) {
            const out = await crm.sendCrmNote(service, doc, [{ id: '1' }, { id: '2' }], { token: 't', fetchImpl: async () => json(429, {}) });
            assert.deepEqual(out, { sentIds: [], notesCreated: 0, error: 'rate_limited' }, service);
        }
    });
    test('a retry in the same session sends only the records still without the note', async () => {
        const session = new crm.CrmSendSession();
        session.markSent('m', 'attio', ['r1']);
        const todo = crm.remainingRecords([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }], session.sentFor('m', 'attio'));
        assert.deepEqual(todo.map((r) => r.id), ['r2', 'r3']);
        assert.equal(session.sentFor('m', 'hubspot').size, 0, 'per CRM');
        assert.equal(session.sentFor('other', 'attio').size, 0, 'per meeting');
        const calls = [];
        await crm.sendCrmNote('attio', doc, todo, { token: 't', fetchImpl: async (u, init) => { calls.push(JSON.parse(init.body).data.parent_record_id); return json(200, {}); } });
        assert.deepEqual(calls, ['r2', 'r3'], 'r1 is not written twice');
    });
    test('the summary counts partial success in plain words, with no status code', () => {
        const s = crm.crmSendSummary('attio', { sentIds: ['r1'], notesCreated: 1, error: 'server' }, 3, http.describeConnectionError);
        assert.equal(s.ok, false);
        assert.equal(s.remaining, 2);
        assert.match(s.message, /^The note is on 1 of 3 people in Attio\./);
        assert.match(s.message, /Send again to add it for the other 2 people; the ones done already are skipped\./);
        assert.ok(!/\b\d{3}\b/.test(s.message));
        assert.equal(crm.crmSendSummary('attio', { sentIds: ['a'], notesCreated: 1 }, 1, http.describeConnectionError).ok, true);
    });
    test('the handler sends only what this session has not written, and records what landed', () => {
        const src = read('electron/services/outputs/outputsIpc.ts');
        assert.match(src, /const todo = remainingRecords\(records, crmSession\.sentFor\(mid, service\)\);/);
        assert.match(src, /crmSession\.markSent\(mid, service, outcome\.sentIds\);/);
    });
});

describe('5. one person, one note', () => {
    test('repeated records collapse by id before writing', async () => {
        assert.deepEqual(crm.uniqueRecords([{ id: 'p1', name: 'A' }, { id: 'p1', name: 'A again' }, { id: 'p2' }]).map((r) => r.id), ['p1', 'p2']);
        const calls = [];
        const out = await crm.sendCrmNote('attio', doc, [{ id: 'p1' }, { id: 'p1' }], { token: 't', fetchImpl: async (u, init) => { calls.push(JSON.parse(init.body).data.parent_record_id); return json(200, {}); } });
        assert.deepEqual(calls, ['p1']);
        assert.equal(out.notesCreated, 1);
        let assoc;
        await crm.sendCrmNote('hubspot', doc, [{ id: '9' }, { id: '9' }], { token: 't', fetchImpl: async (u, init) => { assoc = JSON.parse(init.body).associations; return json(201, {}); } });
        assert.equal(assoc.length, 1);
    });
    test('the handler dedupes the matched records', () => {
        assert.match(read('electron/services/outputs/outputsIpc.ts'), /records = uniqueRecords\(matches\.map\(\(m\) => m\.record\)/);
    });
});

describe('4. template draft makes no style call', () => {
    test('with the LLM draft off, no model call even when the profile is stale', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-style-gate-'));
        try {
            const svc = new style.WritingStyleService({ dir });
            svc.addSample('Hi Sam,\n\nQuick note on the plan. I will send it Friday.\n\nThanks,\nEvin', 'pasted');
            let calls = 0;
            const call = async () => { calls += 1; return {}; };
            assert.equal(await style.styleGuideForDraft(svc, false, call), undefined);
            assert.equal(calls, 0);
            assert.ok((await style.styleGuideForDraft(svc, true, call)).startsWith("WRITE IN THE SENDER'S OWN VOICE"));
            assert.equal(calls, 1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    test('MeetingPersistence reads the flag once and uses it for both the profile and the draft', () => {
        const src = read('electron/MeetingPersistence.ts');
        assert.match(src, /const llmDraft = isIntelligenceFlagEnabled\('followUpDraftV2'\);/);
        assert.match(src, /const svc = getWritingStyleService\(modeId\);\s*const guide = await styleGuideForDraft\(svc, llmDraft, styleModelCall\(llmHelper\)\);/);
        assert.match(src, /followUpVoice\(styleModeId, tone, styleGuideReader\(llmDraft, this\.llmHelper\)\)/);
        assert.match(src, /deterministicOnly: !llmDraft,/);
    });
});

describe('6. half-made Notion pages', () => {
    const blocks = Array.from({ length: 250 }, () => ({ object: 'block', type: 'divider', divider: {} }));
    test('a failed append returns the page and the batches still to add', async () => {
        const fetchImpl = async (url) => (url.endsWith('/pages')
            ? json(200, { id: 'pg', url: 'https://www.notion.so/pg' })
            : json(502, {}));
        const res = await notion.createNotionPage({ parent: { type: 'page', id: 'aaaaaaaabbbbccccddddeeeeeeeeeeee', title: 'P' }, title: 'T', blocks }, { token: 't', fetchImpl });
        assert.equal(res.partial, true);
        assert.equal(res.pageId, 'pg');
        assert.equal(res.url, 'https://www.notion.so/pg');
        assert.deepEqual(res.remaining.map((b) => b.length), [100, 50]);
    });
    test('adding the rest appends to the SAME page, from where it stopped, and never creates one', async () => {
        const urls = [];
        let fail = true;
        const fetchImpl = async (url) => {
            urls.push(url);
            if (fail) { fail = false; return json(200, {}); }
            return json(200, {});
        };
        const remaining = await notion.appendNotionBatches('pg', [[{ a: 1 }], [{ b: 2 }]], { token: 't', fetchImpl });
        assert.deepEqual(remaining, []);
        assert.ok(urls.every((u) => u.endsWith('/blocks/pg/children')));
        assert.ok(!urls.some((u) => u.endsWith('/pages')));
        let n = 0;
        const stillFailing = await notion.appendNotionBatches('pg', [[{ a: 1 }], [{ b: 2 }]], { token: 't', fetchImpl: async () => (++n === 2 ? json(500, {}) : json(200, {})) });
        assert.deepEqual(stillFailing, [[{ b: 2 }]], 'what is left is kept for the next try');
    });
    test('the session remembers the half-made page per meeting', () => {
        const p = new notion.NotionPartialPages();
        p.set('m1', { pageId: 'pg', url: 'u', remaining: [[1]] });
        assert.equal(p.get('m1').pageId, 'pg');
        assert.equal(p.get('m2'), null);
        p.clear('m1');
        assert.equal(p.get('m1'), null);
    });
    test('a new send is refused while a half-made page waits, unless the user starts over', () => {
        const src = read('electron/services/outputs/outputsIpc.ts');
        assert.match(src, /if \(pending && opts\?\.startOver !== true\) \{\s*return \{ ok: false, kind: 'unknown', partial: true, url: pending\.url, message: PARTIAL_PAGE \};/);
        assert.match(src, /safeHandle\('outputs:notion-resume'/);
        assert.match(src, /appendNotionBatches\(pending\.pageId, pending\.remaining/);
    });
});

describe('7. Slack drafts over the limit', () => {
    test('refused with the length, never cut', () => {
        const big = 'word '.repeat(9000); // 45,000 characters
        const res = slack.checkSlackDraft('T', 'D', big);
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'too_long');
        assert.equal(res.max, slack.SLACK_DRAFT_MAX);
        assert.match(slack.slackDraftMessage(res), /characters longer than one Slack message can be/);
        assert.throws(() => slack.slackPayloadFromDraft('T', 'D', big), (e) => e.kind === 'too_large');
        assert.equal(slack.checkSlackDraft('T', 'D', '   ').reason, 'empty');
    });
    test('a draft at the limit goes whole: every character reaches Slack', () => {
        const paras = [];
        while (paras.join('\n\n').length < slack.SLACK_DRAFT_MAX - 600) paras.push(`Point ${paras.length}: ${'detail '.repeat(70)}`.trim());
        const draft = paras.join('\n\n');
        const res = slack.checkSlackDraft('T', 'D', draft);
        assert.equal(res.ok, true);
        assert.equal(res.payload.blocks.slice(2).map((b) => b.text.text).join('\n\n'), draft);
    });
    test('a hard split never breaks an escape like &amp;', () => {
        const line = `${'a'.repeat(2998)}&&&&`;
        const pieces = slack.splitForSlack(slack.escapeSlackText(line));
        for (const p of pieces) {
            assert.ok(p.length <= slack.SLACK_SECTION_MAX);
            assert.ok(!/&(?:a|am|amp)?$/.test(p), `no half escape at the end: ${p.slice(-6)}`);
        }
        assert.equal(pieces.join(''), slack.escapeSlackText(line));
    });
    test('the composer and main share one limit', () => {
        assert.equal(slack.SLACK_DRAFT_MAX, 40000);
        assert.match(read('src/types/meetingOutputs.ts'), /export const SLACK_DRAFT_MAX_CHARS = 40_000;/);
        assert.match(read('src/components/meeting/ShareMenu.tsx'), /!limit\.empty && limit\.over === 0 && !!target/);
    });
});

describe('8. People index past the first batch', () => {
    const Sqlite = require('better-sqlite3');
    const { ensureOrganiseSchema } = dist('db/organiseSchema.js');
    const { OrganiseStore } = dist('services/organise/OrganiseStore.js');
    const organise = dist('services/organise/organiseService.js');
    function dbWith(n) {
        const db = new Sqlite(':memory:');
        db.pragma('foreign_keys = ON');
        db.exec(`CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, start_time INTEGER, duration_ms INTEGER, summary_json TEXT,
          created_at TEXT, calendar_event_id TEXT, source TEXT, is_processed INTEGER DEFAULT 1, summary_status TEXT, calendar_event_json TEXT)`);
        ensureOrganiseSchema(db);
        const ins = db.prepare(`INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, source, is_processed, calendar_event_json) VALUES (?, ?, ?, 1800000, ?, ?, 'manual', 1, ?)`);
        for (let i = 0; i < n; i += 1) {
            const ev = { id: `ev${i}`, title: `M${i}`, startTime: '2026-10-15T14:00:00Z', endTime: '2026-10-15T15:00:00Z', attendees: [{ email: `p${i % 40}@acme.com`, name: `Person ${i % 40}` }] };
            ins.run(`m${i}`, `M${i}`, 1_700_000_000_000 + i, JSON.stringify({ detailedSummary: {} }), new Date(1_700_000_000_000 + i).toISOString(), JSON.stringify(ev));
        }
        return db;
    }
    test('every old meeting is indexed, a batch at a time, yielding between batches and reporting each', async () => {
        const db = dbWith(730);
        const store = new OrganiseStore(db);
        const batches = [];
        let pauses = 0;
        const total = await organise.syncPeopleIndexInBatches(store, { batchSize: 100, onBatch: (n) => batches.push(n), pause: async () => { pauses += 1; }, user: null });
        assert.equal(total, 730);
        assert.deepEqual(batches, [100, 200, 300, 400, 500, 600, 700, 730]);
        assert.equal(pauses, 8);
        assert.equal(store.unindexedMeetingIds(1000).length, 0);
        assert.equal(store.listPeople().length, 40);
    });
    test('a meeting that cannot be indexed does not loop forever', async () => {
        const db = dbWith(5);
        const store = new OrganiseStore(db);
        const stuck = { ...store, unindexedMeetingIds: (limit) => ['ghost', ...store.unindexedMeetingIds(limit)].slice(0, limit), meetingSnapshot: (id) => (id === 'ghost' ? null : store.meetingSnapshot(id)), indexMeetingPeople: (...a) => store.indexMeetingPeople(...a) };
        const total = await organise.syncPeopleIndexInBatches(stuck, { batchSize: 2, pause: async () => {}, user: null });
        assert.equal(total, 6, 'five meetings and the unreadable one, once');
    });
    test('the first page shows a batch now; the rest runs in the background and refreshes the lists', () => {
        const ipc = read('electron/services/organise/organiseIpc.ts');
        assert.match(ipc, /if \(syncPeopleIndex\(store\) >= PEOPLE_INDEX_BATCH\) void indexRemainingPeopleInBackground\(store, broadcastPeopleIndexed\);/);
        assert.equal((ipc.match(/syncPeopleThenContinue\(store\);/g) || []).length, 2, 'People and Companies');
        // The People and Companies lists that refreshed on it came off the launcher (2026-10-17).
        assert.match(read('electron/preload.ts'), /ipcRenderer\.on\('organise:people-indexed', subscription\)/);
    });
});
