// A calendar-linked 1:1 saved end to end through MeetingPersistence.processAndSaveMeeting:
// the notes are written from a NAMED copy of the transcript ("Priya:", first names), the
// stored transcript keeps its raw speakers, and the saved meeting keeps the
// event snapshot and the speaker labels. (Relinking later, and a rename the
// user made, are relinkSpeakerLabels in CalendarSessionMatch2026_09_27.)
//
// Executes the compiled code (a source grep once missed a missing branch). The
// V3 summarizer and mode auto-detect are switched off by their env flags so the
// single-call summary path runs against a fake LLM that records its input.
// Run under the electron runner (better-sqlite3's ABI):
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

let tmpDir;
let MeetingPersistence;
let Database;
const originalLoad = Module._load;

const SNAPSHOT = {
    id: 'evt-1on1',
    title: '1:1 with Priya',
    startTime: '2026-09-28T10:00:00.000Z',
    endTime: '2026-09-28T10:30:00.000Z',
    attendees: [{ email: 'priya@acme.com', name: 'Priya Nair', response: 'accepted' }],
    linkedBy: 'start',
};
const TRANSCRIPT = [
    { speaker: 'user', text: 'Can you send the pricing deck by Friday?', timestamp: 1000, origin: 'stt', final: true },
    { speaker: 'interviewer', text: 'Yes, I will send the pricing deck by Friday.', timestamp: 4000, origin: 'stt', final: true },
    { speaker: 'user', text: 'Great, and the renewal terms too.', timestamp: 8000, origin: 'stt', final: true },
    { speaker: 'interviewer', text: 'Sure, renewal terms as well.', timestamp: 12000, origin: 'stt', final: true },
];

function makePersistence(calls) {
    const llm = new Proxy({
        generateMeetingSummary: async (_prompt, context) => {
            calls.push(String(context));
            return JSON.stringify({ overview: 'Pricing deck and renewal terms by Friday.', keyPoints: ['Pricing deck by Friday'], actionItems: ['Send the pricing deck'] });
        },
    }, { get: (t, k) => (k in t ? t[k] : async () => '') });
    const session = new Proxy({}, { get: () => () => null });
    return new MeetingPersistence(session, llm);
}

function readMeeting(id) {
    const db = new Database(path.join(tmpDir, 'natively.db'), { readonly: true });
    try {
        const row = db.prepare('SELECT calendar_event_id, calendar_event_json, source, summary_json FROM meetings WHERE id = ?').get(id);
        const speakers = db.prepare('SELECT speaker FROM transcripts WHERE meeting_id = ? ORDER BY timestamp_ms').all(id).map((r) => r.speaker);
        return { row, speakers, detailed: JSON.parse(row?.summary_json || '{}').detailedSummary };
    } finally {
        db.close();
    }
}

describe('a calendar-linked 1:1, saved', () => {
    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-callinked-save-'));
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
        ({ MeetingPersistence } = require(path.join(REPO, 'dist-electron/electron/MeetingPersistence.js')));
        Database = require('better-sqlite3');
    });
    after(() => {
        Module._load = originalLoad;
        delete process.env.NATIVELY_MEETING_SUMMARY_V3;
        delete process.env.NATIVELY_MEETING_MODE_AUTODETECT;
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    const data = () => ({ transcript: TRANSCRIPT.map((s) => ({ ...s })), usage: [], startTime: Date.parse(SNAPSHOT.startTime), durationMs: 30 * 60_000, context: '', memoryEligibleCount: TRANSCRIPT.length });

    test('the notes see names; the stored transcript keeps raw speakers; the meeting keeps event and labels', async () => {
        const calls = [];
        const mp = makePersistence(calls);
        await mp.processAndSaveMeeting(data(), 'meet-1', { title: SNAPSHOT.title, calendarEventId: SNAPSHOT.id, calendarEvent: SNAPSHOT, source: 'calendar' }, null);

        assert.ok(calls.length >= 1, 'the summary was generated');
        assert.match(calls[0], /Priya:/, 'the model reads the other voice by first name');
        assert.doesNotMatch(calls[0], /Priya Nair:/, 'not the full calendar name');
        assert.doesNotMatch(calls[0], /interviewer:/, 'and not by its raw channel');

        const { row, speakers, detailed } = readMeeting('meet-1');
        assert.deepEqual(speakers, ['user', 'interviewer', 'user', 'interviewer'], 'the stored transcript keeps raw speakers');
        assert.equal(row.calendar_event_id, SNAPSHOT.id);
        assert.equal(row.source, 'calendar');
        assert.deepEqual(JSON.parse(row.calendar_event_json), SNAPSHOT);
        assert.equal(detailed.speakerLabels.speaker_1, 'Priya', 'saved as the meeting\'s speaker labels');
    });

    test('an unlinked meeting is written exactly as before', async () => {
        const calls = [];
        const mp = makePersistence(calls);
        await mp.processAndSaveMeeting(data(), 'meet-2', { title: 'Ad hoc' }, null);
        assert.doesNotMatch(calls[0], /Priya Nair/);
        const { row, detailed } = readMeeting('meet-2');
        assert.equal(row.calendar_event_id, null);
        assert.equal(row.calendar_event_json, null);
        assert.equal(detailed.speakerLabels, undefined);
    });

    test('a group call names nobody on the shared channel', async () => {
        const calls = [];
        const mp = makePersistence(calls);
        const group = { ...SNAPSHOT, id: 'evt-group', attendees: [...SNAPSHOT.attendees, { email: 'rob@acme.com', name: 'Rob Lane' }] };
        await mp.processAndSaveMeeting(data(), 'meet-3', { title: group.title, calendarEventId: group.id, calendarEvent: group, source: 'calendar' }, null);
        assert.doesNotMatch(calls[0], /Priya:|Rob:/);
        assert.equal(readMeeting('meet-3').detailed.speakerLabels?.speaker_1, undefined);
    });

    test('a snapshot for a different event than the id is not trusted', async () => {
        const calls = [];
        const mp = makePersistence(calls);
        await mp.processAndSaveMeeting(data(), 'meet-4', { title: 'x', calendarEventId: 'another-id', calendarEvent: SNAPSHOT, source: 'calendar' }, null);
        assert.doesNotMatch(calls[0], /Priya:/);
        assert.equal(readMeeting('meet-4').row.calendar_event_json, null);
    });

    test('with a connected calendar, an unlinked meeting still names the user', async () => {
        {
            const calls = [];
            const mp = makePersistence(calls);
            // The connected calendar account (CalendarManager is bundled into the build).
            mp.calendarUserName = () => 'Evin John';
            await mp.processAndSaveMeeting(data(), 'meet-5', { title: 'Ad hoc' }, null);
            assert.match(calls[0], /Evin:/, 'the notes read the mic by the user\'s first name');
            assert.doesNotMatch(calls[0], /Evin John:/, 'not the full account name');
            assert.doesNotMatch(calls[0], /Priya Nair/, 'no event: the other voice is not named');
            const { row, speakers, detailed } = readMeeting('meet-5');
            assert.equal(row.calendar_event_id, null);
            assert.deepEqual(detailed.speakerLabels, { me: 'Evin' });
            assert.deepEqual(speakers, ['user', 'interviewer', 'user', 'interviewer'], 'the stored transcript keeps raw speakers');
        }
    });
});
