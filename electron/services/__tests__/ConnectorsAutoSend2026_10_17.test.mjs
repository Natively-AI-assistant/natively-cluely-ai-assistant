// Settings › Connectors › Automatic sending (autoSend.ts): rules that send a
// meeting's notes to Slack, Notion or a CRM once they are ready. Covers once
// per meeting per rule, the folder match, failures and skips on the row, one
// send at a time, input checks and the JSON file. The sender is a fake; no
// network. Temp userData under os.tmpdir().
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { AutoSendRules, AUTOSEND_FILE, SENT_MEMORY, parseDestination } = require(path.join(REPO, 'dist-electron/electron/services/outputs/autoSend.js'));

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'natively-autosend-'));

function make(opts = {}) {
    const dir = opts.dir || tempDir();
    const sent = [];
    let active = 0;
    let maxActive = 0;
    const reply = opts.reply || (() => ({ ok: true }));
    const rules = new AutoSendRules({
        userDataDir: dir,
        send: async (destination, meetingId) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setImmediate(r));
            sent.push({ destination, meetingId });
            active--;
            return reply(destination, meetingId);
        },
        foldersOfMeeting: (id) => (opts.folders || {})[id] || [],
        meetingTitle: (id) => `Meeting ${id}`,
        now: () => 1_000,
    });
    return { rules, dir, sent, maxActive: () => maxActive };
}

const SLACK = { kind: 'slack', webhookId: 'wh1' };
const NOTION = { kind: 'notion' };
const HUBSPOT = { kind: 'crm', service: 'hubspot' };

test('a meeting goes out once per rule, even when its notes are generated again', async () => {
    const { rules, sent } = make();
    assert.equal(rules.create({ destination: SLACK, folderId: null }).ok, true);
    assert.equal(rules.create({ destination: NOTION, folderId: null }).ok, true);
    await rules.onNotesReady('m1');
    await rules.onNotesReady('m1');
    assert.deepEqual(sent.map((s) => [s.destination.kind, s.meetingId]), [['slack', 'm1'], ['notion', 'm1']]);
    await rules.onNotesReady('m2');
    assert.equal(sent.length, 4);
    const row = rules.list()[0];
    assert.deepEqual(row.lastDelivery, { at: 1_000, status: 'success', meetingTitle: 'Meeting m2' });
    assert.equal(row.sentMeetingIds, undefined, 'the sent list stays in the main process');
});

test('two calls at once for the same meeting still send it once, one send at a time', async () => {
    const { rules, sent, maxActive } = make();
    rules.create({ destination: SLACK, folderId: null });
    rules.create({ destination: HUBSPOT, folderId: null });
    await Promise.all([rules.onNotesReady('m1'), rules.onNotesReady('m1'), rules.onNotesReady('m2')]);
    assert.equal(sent.length, 4);
    assert.equal(maxActive(), 1, 'sequential');
});

test('a folder rule only sends meetings in that folder', async () => {
    const { rules, sent } = make({ folders: { m1: ['sales'], m2: ['hiring'] } });
    rules.create({ destination: SLACK, folderId: 'sales' });
    rules.create({ destination: NOTION, folderId: null });
    await rules.onNotesReady('m1');
    await rules.onNotesReady('m2');
    await rules.onNotesReady('m3');
    assert.deepEqual(sent.map((s) => `${s.destination.kind}:${s.meetingId}`), ['slack:m1', 'notion:m1', 'notion:m2', 'notion:m3']);
});

test('a failed send is recorded with its sentence and tried again next time; a throwing sender never escapes', async () => {
    let mode = 'fail';
    const { rules, sent } = make({
        reply: () => {
            if (mode === 'fail') return { ok: false, message: 'Slack could not find where to send this.' };
            if (mode === 'throw') throw new Error('boom with secret-ish detail');
            return { ok: true };
        },
    });
    const { rule } = rules.create({ destination: SLACK, folderId: null });
    await rules.onNotesReady('m1');
    let row = rules.list().find((r) => r.id === rule.id);
    assert.deepEqual(row.lastDelivery, { at: 1_000, status: 'failed', message: 'Slack could not find where to send this.', meetingTitle: 'Meeting m1' });

    mode = 'throw';
    await assert.doesNotReject(rules.onNotesReady('m1'));
    row = rules.list()[0];
    assert.equal(row.lastDelivery.status, 'failed');
    assert.equal(row.lastDelivery.message, 'Could not send the notes to Slack.');
    assert.doesNotMatch(row.lastDelivery.message, /boom|secret/);

    mode = 'ok';
    await rules.onNotesReady('m1');
    assert.equal(rules.list()[0].lastDelivery.status, 'success');
    assert.equal(sent.length, 3, 'not marked sent until it worked');
    await rules.onNotesReady('m1');
    assert.equal(sent.length, 3);
});

test('a CRM skip (nobody matched) leaves the row as it was and is not marked sent', async () => {
    let skip = true;
    const { rules, sent } = make({ reply: () => (skip ? { ok: false, skipped: true, message: 'Nobody in this meeting is in HubSpot.' } : { ok: true }) });
    rules.create({ destination: HUBSPOT, folderId: null });
    await rules.onNotesReady('m1');
    assert.equal(rules.list()[0].lastDelivery, undefined);
    skip = false;
    await rules.onNotesReady('m1');
    assert.equal(sent.length, 2);
    assert.equal(rules.list()[0].lastDelivery.status, 'success');
});

test('disabled rules send nothing; update and delete work and check their inputs', async () => {
    const { rules, sent } = make({ folders: { m1: ['f2'] } });
    const { rule } = rules.create({ destination: NOTION, folderId: null });
    assert.equal(rules.update(rule.id, { enabled: false }).ok, true);
    await rules.onNotesReady('m1');
    assert.equal(sent.length, 0);
    assert.equal(rules.update(rule.id, { enabled: 'no' }).ok, false);
    assert.equal(rules.update(rule.id, { folderId: 5 }).ok, false);
    assert.equal(rules.update('nope', { enabled: true }).kind, 'not_found');
    assert.equal(rules.update(rule.id, { enabled: true, folderId: 'f2' }).ok, true);
    assert.equal(rules.list()[0].folderId, 'f2');
    await rules.onNotesReady('m1');
    assert.equal(sent.length, 1);
    assert.equal(rules.remove(rule.id).ok, true);
    assert.equal(rules.list().length, 0);
});

test('destinations, folders, duplicates and the cap of 50 are checked', () => {
    assert.equal(parseDestination({ kind: 'crm', service: 'zoho' }), null);
    assert.equal(parseDestination({ kind: 'slack' }), null);
    assert.equal(parseDestination({ kind: 'slack', webhookId: 'x'.repeat(201) }), null);
    assert.equal(parseDestination('notion'), null);
    assert.deepEqual(parseDestination({ kind: 'notion', extra: 'dropped' }), { kind: 'notion' });

    const { rules } = make();
    assert.equal(rules.create(null).ok, false);
    assert.equal(rules.create({ destination: NOTION, folderId: {} }).ok, false);
    assert.equal(rules.create({ destination: NOTION, folderId: null }).ok, true);
    const dup = rules.create({ destination: { kind: 'notion' }, folderId: null });
    assert.equal(dup.ok, false);
    assert.equal(dup.message, 'Notes already go to Notion for these meetings.');
    assert.equal(rules.create({ destination: NOTION, folderId: 'f1' }).ok, true, 'another folder is another rule');
    for (let i = 0; i < 48; i++) assert.equal(rules.create({ destination: { kind: 'slack', webhookId: `wh${i}` }, folderId: null }).ok, true);
    const over = rules.create({ destination: HUBSPOT, folderId: null });
    assert.equal(over.ok, false);
    assert.match(over.message, /up to 50/);
});

test('rules and their sent meetings survive a restart; the sent list keeps the last 500', async () => {
    const dir = tempDir();
    const first = make({ dir });
    first.rules.create({ destination: SLACK, folderId: 'f1' });
    first.rules.create({ destination: NOTION, folderId: null });
    for (let i = 0; i < SENT_MEMORY + 5; i++) await first.rules.onNotesReady(`m${i}`);
    const file = path.join(dir, AUTOSEND_FILE);
    assert.equal(path.basename(file), 'connector-rules.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.version, 1);
    const notion = saved.rules.find((r) => r.destination.kind === 'notion');
    assert.equal(notion.sentMeetingIds.length, SENT_MEMORY);
    assert.equal(notion.sentMeetingIds[0], 'm5', 'the oldest are forgotten first');

    const again = make({ dir });
    assert.deepEqual(again.rules.list().map((r) => [r.destination.kind, r.folderId]), [['slack', 'f1'], ['notion', null]]);
    await again.rules.onNotesReady(`m${SENT_MEMORY + 4}`);
    assert.equal(again.sent.length, 0, 'already sent before the restart');
    await again.rules.onNotesReady('m0');
    assert.equal(again.sent.length, 1, 'forgotten, so it goes again');
});

test('a damaged rules file is set aside, not overwritten, and the rules start empty', () => {
    const dir = tempDir();
    const file = path.join(dir, AUTOSEND_FILE);
    fs.writeFileSync(file, '{"version":1,"rules":[');
    const { rules } = make({ dir });
    assert.deepEqual(rules.list(), []);
    assert.equal(fs.readFileSync(`${file}.bad`, 'utf8'), '{"version":1,"rules":[');
    assert.equal(rules.create({ destination: NOTION, folderId: null }).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).rules.length, 1);
});

test('rows from a file with odd entries are cleaned on read', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, AUTOSEND_FILE), JSON.stringify({
        version: 1,
        rules: [
            { id: 'ok', destination: { kind: 'notion' }, folderId: null, enabled: true, createdAt: 1, sentMeetingIds: ['a', 7] },
            { id: 'bad', destination: { kind: 'fax' }, folderId: null, enabled: true, createdAt: 1, sentMeetingIds: [] },
            null,
        ],
    }));
    const { rules } = make({ dir });
    assert.deepEqual(rules.list().map((r) => r.id), ['ok']);
});
