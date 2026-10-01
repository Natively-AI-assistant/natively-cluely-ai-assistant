// Names from the call itself (meetingDetection: callRoster, attributeSpeakers,
// nameCallLines, and MeetingPersistence's use of them). Everyone else in a call
// shares one audio channel; the Meet page says who was speaking when, and each
// other-side line takes the person speaking as it was said, only when that is
// clear. Run under the electron runner (better-sqlite3's ABI):
//   ELECTRON_RUN_AS_NODE=1 npx electron --test <this file>
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron', p);
const { CallRoster } = require(dist('services/meetingDetection/callRoster.js'));
const { attributeSpeakers } = require(dist('services/meetingDetection/attributeSpeakers.js'));
const { nameCallLines } = require(dist('services/meetingDetection/nameCallLines.js'));
const { meetingPeopleReport } = require(dist('services/meetingDetection/extensionMeetingTabs.js'));

const KEY = 'meet:abc-defg-hij';
// Reports every 250 ms from t=0: Priya speaks 0–6 s, Rob 7–12 s, Priya 13–18 s.
function scriptedRoster() {
    const roster = new CallRoster();
    for (let t = 0; t <= 20_000; t += 250) {
        const speaking = (t < 6000 && 'Priya Nair') || (t >= 7000 && t < 12_000 && 'Rob Lane') || (t >= 13_000 && t < 18_000 && 'Priya Nair') || null;
        roster.report(KEY, [{ name: 'Priya Nair', speaking: speaking === 'Priya Nair' }, { name: 'Rob Lane', speaking: speaking === 'Rob Lane' }], 1_000_000 + t);
    }
    return roster;
}
const at = (s) => 1_000_000 + s * 1000;

test('the roster keeps who was in the call and who spoke when', () => {
    const roster = scriptedRoster();
    const { participants, spans } = roster.snapshot(KEY, at(0), at(30));
    assert.deepEqual(participants, ['Priya Nair', 'Rob Lane']);
    assert.deepEqual(spans.map((s) => [s.name, (s.start - at(0)) / 1000, (s.end - at(0)) / 1000]), [['Priya Nair', 0, 6], ['Rob Lane', 7, 12], ['Priya Nair', 13, 18]]);
    assert.deepEqual(roster.snapshot(KEY, at(8), at(9)).spans.map((s) => [s.name, (s.end - s.start) / 1000]), [['Rob Lane', 1]], 'clipped to the window');
    assert.deepEqual(roster.snapshot('meet:zzz-zzzz-zzz', 0, Infinity), { participants: [], spans: [] });
});

test('a span still open when the page goes away closes at its last report', () => {
    const roster = new CallRoster();
    roster.report(KEY, [{ name: 'Priya Nair', speaking: true }], at(0));
    roster.report(KEY, [{ name: 'Priya Nair', speaking: true }], at(4));
    roster.end(KEY);
    assert.deepEqual(roster.snapshot(KEY, 0, Infinity).spans.map((s) => (s.end - s.start) / 1000), [4]);
});

test('each other-side line takes the person speaking as it was said; the mic is never touched', () => {
    const spans = scriptedRoster().snapshot(KEY, 0, Infinity).spans;
    // Final text arrives as the speaker finishes: Priya's at ~6 s, Rob's at ~12 s.
    const lines = [
        { speaker: 'interviewer', text: 'Hi everyone, this is Priya, let us go over the launch plan today', timestamp: at(6.2) },
        { speaker: 'user', text: 'Sounds good.', timestamp: at(6.8) },
        { speaker: 'interviewer', text: 'I will send the pricing deck by Friday', timestamp: at(12.3) },
        { speaker: 'interviewer', text: 'Any questions before we move on', timestamp: at(17.5) },
    ];
    const { ids, labels } = attributeSpeakers(lines, spans);
    assert.deepEqual([...ids.entries()], [[0, 'speaker_2'], [2, 'speaker_3'], [3, 'speaker_2']]);
    assert.deepEqual(labels, { speaker_2: 'Priya Nair', speaker_3: 'Rob Lane' }, 'ids from speaker_2, in order of first line');
});

test('an unclear line keeps the channel label', () => {
    // Both speaking the whole time: nobody clearly said it.
    const roster = new CallRoster();
    for (let t = 0; t <= 8000; t += 250) roster.report(KEY, [{ name: 'A', speaking: true }, { name: 'B', speaking: true }], at(t / 1000));
    const { ids } = attributeSpeakers([{ speaker: 'interviewer', text: 'who said this one', timestamp: at(8) }], roster.snapshot(KEY, 0, Infinity).spans);
    assert.equal(ids.size, 0);
    // Nobody speaking at all (a long silence in the reports): no guess either.
    assert.equal(attributeSpeakers([{ speaker: 'interviewer', text: 'late line', timestamp: at(40) }], scriptedRoster().snapshot(KEY, 0, Infinity).spans).ids.size, 0);
});

test('with the STT provider\'s own voice ids, each voice is named once, by majority', () => {
    const spans = scriptedRoster().snapshot(KEY, 0, Infinity).spans;
    const lines = [
        { speaker: 'interviewer', speakerId: 'speaker_0', text: 'hello there everyone this is me talking about launch', timestamp: at(5.9) },
        { speaker: 'interviewer', speakerId: 'speaker_4', text: 'pricing deck by Friday', timestamp: at(12.2) },
        // A line whose timing alone would say Rob (it overlaps his span) but whose voice is Priya's.
        { speaker: 'interviewer', speakerId: 'speaker_0', text: 'yes', timestamp: at(12.5) },
        { speaker: 'interviewer', speakerId: 'speaker_0', text: 'any questions before we move on then', timestamp: at(17.8) },
    ];
    const { ids, labels } = attributeSpeakers(lines, spans);
    assert.deepEqual(Object.values(labels).sort(), ['Priya Nair', 'Rob Lane']);
    const nameOf = (i) => labels[ids.get(i)];
    assert.equal(nameOf(2), 'Priya Nair', 'the voice decides, not the moment');
    assert.equal(nameOf(1), 'Rob Lane');
});

test('what the page sends is re-validated: bad keys refused, the user\'s own tile left out', () => {
    assert.equal(meetingPeopleReport({ key: 'https://evil', people: [] }), null);
    assert.equal(meetingPeopleReport({ key: KEY, people: 'x' }), null);
    const r = meetingPeopleReport({ key: KEY, people: [{ name: 'You', self: true, speaking: true }, { name: ' Priya\nNair ', speaking: true }, { name: 'Priya Nair' }, { name: 5 }, { name: 'x'.repeat(200) }] });
    assert.deepEqual(r.people.map((p) => [p.name.length > 60 ? 'long' : p.name, p.speaking]), [['Priya Nair', true], ['long', false]]);
    assert.equal(r.people[1].name.length, 80);
});

test('nameCallLines: the transcript with ids, the labels, who attended; nothing without a record', () => {
    const roster = scriptedRoster();
    const transcript = [{ speaker: 'interviewer', text: 'Hi everyone, this is Priya, let us go over the launch plan today', timestamp: at(6.2) }];
    const named = nameCallLines(transcript, KEY, at(0), 20_000, roster);
    assert.equal(named.transcript[0].speakerId, 'speaker_2');
    assert.deepEqual(named.labels, { speaker_2: 'Priya Nair' });
    assert.deepEqual(named.participants, ['Priya Nair', 'Rob Lane']);
    assert.equal(transcript[0].speakerId, undefined, 'the input is not mutated');
    assert.equal(nameCallLines(transcript, 'meet:zzz-zzzz-zzz', at(0), 20_000, roster), null);
});

// ── End to end: processAndSaveMeeting with the call's record ────────────────
describe('a Meet group call, saved', () => {
    let tmpDir;
    let MeetingPersistence;
    let Database;
    let DatabaseManager;
    const originalLoad = Module._load;
    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-callnames-save-'));
        process.env.NATIVELY_TEST_USERDATA = tmpDir;
        process.env.NATIVELY_MEETING_SUMMARY_V3 = 'false';
        process.env.NATIVELY_MEETING_MODE_AUTODETECT = 'false';
        const electronStub = {
            app: { getPath: () => tmpDir, isPackaged: false, getVersion: () => '0.0.0', on: () => {}, whenReady: () => Promise.resolve() },
            BrowserWindow: { getAllWindows: () => [] },
            safeStorage: { isEncryptionAvailable: () => false },
            shell: {}, ipcMain: { handle: () => {}, on: () => {} },
            Notification: class { static isSupported() { return false; } on() {} show() {} },
        };
        Module._load = function (request, parent, isMain) {
            if (request === 'electron') return electronStub;
            return originalLoad.call(this, request, parent, isMain);
        };
        ({ MeetingPersistence } = require(dist('MeetingPersistence.js')));
        ({ DatabaseManager } = require(dist('db/DatabaseManager.js')));
        Database = require('better-sqlite3');
    });
    after(() => {
        Module._load = originalLoad;
        delete process.env.NATIVELY_MEETING_SUMMARY_V3;
        delete process.env.NATIVELY_MEETING_MODE_AUTODETECT;
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    test('lines stored with their person, notes written from names, attendees kept; reads back', async () => {
        // The app's one roster (globalThis), as the Meet reader fills it.
        const roster = globalThis[Symbol.for('natively.callRoster')] ?? (require(dist('services/meetingDetection/callRoster.js')).callRoster);
        const start = Date.now();
        const t = (s) => start + s * 1000;
        for (let ms = 0; ms <= 20_000; ms += 250) {
            const speaking = (ms < 6000 && 'Priya Nair') || (ms >= 7000 && ms < 12_000 && 'Rob Lane') || null;
            roster.report(KEY, [{ name: 'Priya Nair', speaking: speaking === 'Priya Nair' }, { name: 'Rob Lane', speaking: speaking === 'Rob Lane' }], t(ms / 1000));
        }
        const calls = [];
        const llm = new Proxy({
            generateMeetingSummary: async (_p, context) => { calls.push(String(context)); return JSON.stringify({ overview: 'Launch plan', keyPoints: ['Deck by Friday'], actionItems: ['Send deck'] }); },
        }, { get: (o, k) => (k in o ? o[k] : async () => '') });
        const mp = new MeetingPersistence(new Proxy({}, { get: () => () => null }), llm);
        const transcript = [
            { speaker: 'interviewer', text: 'Hi everyone, this is Priya, let us go over the launch plan today', timestamp: t(6.2), origin: 'stt', final: true },
            { speaker: 'user', text: 'Sounds good to me.', timestamp: t(6.9), origin: 'stt', final: true },
            { speaker: 'interviewer', text: 'I will send the pricing deck by Friday', timestamp: t(12.3), origin: 'stt', final: true },
            { speaker: 'interviewer', speakerId: 'speaker_9', text: 'mumble', timestamp: t(19.5), origin: 'stt', final: true },
        ];
        await mp.processAndSaveMeeting({ transcript, usage: [], startTime: start, durationMs: 20_000, context: '', memoryEligibleCount: 4 }, 'group-1', { title: 'Launch sync', callKey: KEY }, null);

        assert.match(calls[0], /Priya Nair:/);
        assert.match(calls[0], /Rob Lane:/);
        const db = new Database(path.join(tmpDir, 'natively.db'), { readonly: true });
        const rows = db.prepare('SELECT speaker, speaker_id FROM transcripts WHERE meeting_id = ? ORDER BY timestamp_ms').all('group-1');
        const detailed = JSON.parse(db.prepare('SELECT summary_json FROM meetings WHERE id = ?').get('group-1').summary_json).detailedSummary;
        db.close();
        assert.deepEqual(rows.map((r) => [r.speaker, r.speaker_id]), [['interviewer', 'speaker_2'], ['user', null], ['interviewer', 'speaker_3'], ['interviewer', null]],
            'the channel stays; the person is the id; an unnamed provider id is not stored');
        assert.equal(detailed.speakerLabels.speaker_2, 'Priya Nair');
        assert.equal(detailed.speakerLabels.speaker_3, 'Rob Lane');
        assert.deepEqual(detailed.callParticipants, ['Priya Nair', 'Rob Lane']);

        const details = DatabaseManager.getInstance().getMeetingDetails('group-1');
        assert.deepEqual(details.transcript.map((l) => l.speakerId ?? null), ['speaker_2', null, 'speaker_3', null], 'read back with the ids');
    });
});
