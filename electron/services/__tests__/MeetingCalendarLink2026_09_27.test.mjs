// A meeting keeps the calendar event it was linked to (DatabaseManager:
// calendar_event_json, setMeetingCalendarEvent, getCalendarEventSnapshot).
// saveMeeting is INSERT OR REPLACE, and the placeholder, zero-content and
// recovery saves carry no metadata, so these pin that a link survives every
// later save, that "not a calendar meeting" can still be recorded, and that a
// follow-up written after the call still finds the attendees.
//
// Real DatabaseManager against a temp userData dir; run under the electron
// runner (better-sqlite3's ABI): npm test, or
//   ELECTRON_RUN_AS_NODE=1 npx electron --test <this file>
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let tmpDir;
let db;

const EVENT = {
    id: 'evt-q2',
    title: 'Q2 Product Roadmap Review',
    startTime: '2026-09-28T10:00:00.000Z',
    endTime: '2026-09-28T10:45:00.000Z',
    link: 'https://meet.google.com/abc',
    attendees: [{ email: 'priya@acme.com', name: 'Priya Nair', response: 'accepted' }],
    linkedBy: 'start',
};

const meeting = (id, extra = {}) => ({
    id,
    title: 'Processing...',
    date: '2026-09-28T10:46:00.000Z',
    duration: '45:00',
    summary: '',
    detailedSummary: { actionItems: [], keyPoints: [] },
    transcript: [{ speaker: 'user', text: 'hello', timestamp: 1 }],
    usage: [],
    isProcessed: false,
    ...extra,
});
const START = Date.parse('2026-09-28T10:00:00.000Z');

describe('a meeting keeps its calendar event', () => {
    before(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-callink-'));
        process.env.NATIVELY_TEST_USERDATA = tmpDir;
        const mod = await import(pathToFileURL(path.join(REPO, 'dist-electron/electron/db/DatabaseManager.js')).href);
        const DatabaseManager = mod.DatabaseManager ?? mod.default?.DatabaseManager;
        db = DatabaseManager.getInstance();
    });
    after(() => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    test('the final save stores the snapshot, and getMeetingDetails returns it', () => {
        db.saveMeeting(meeting('m1'), START, 45 * 60_000); // placeholder, no metadata
        db.saveMeeting(meeting('m1', { title: EVENT.title, isProcessed: true, calendarEventId: EVENT.id, calendarEvent: EVENT, source: 'calendar' }), START, 45 * 60_000);
        const details = db.getMeetingDetails('m1');
        assert.equal(details.calendarEventId, EVENT.id);
        assert.equal(details.source, 'calendar');
        assert.deepEqual(details.calendarEvent, EVENT);
    });

    test('a later save that names no event keeps the link (recovery, zero-content)', () => {
        db.saveMeeting(meeting('m1', { title: 'Recovered', isProcessed: true }), START, 45 * 60_000);
        const details = db.getMeetingDetails('m1');
        assert.equal(details.calendarEventId, EVENT.id);
        assert.equal(details.source, 'calendar');
        assert.deepEqual(details.calendarEvent, EVENT);
    });

    test('a follow-up after the call finds the attendees by event id', () => {
        assert.deepEqual(db.getCalendarEventSnapshot(EVENT.id)?.attendees, EVENT.attendees);
        assert.equal(db.getCalendarEventSnapshot('no-such-event'), undefined);
    });

    test('unlinking is recorded, and a later save does not bring it back', () => {
        assert.equal(db.setMeetingCalendarEvent('m1', null), true);
        let details = db.getMeetingDetails('m1');
        assert.equal(details.calendarEventId, null);
        assert.equal(details.calendarEvent, undefined);
        assert.equal(details.source, 'manual');
        db.saveMeeting(meeting('m1', { title: 'Again', isProcessed: true }), START, 45 * 60_000);
        details = db.getMeetingDetails('m1');
        assert.equal(details.calendarEventId, null);
        assert.equal(details.calendarEvent, undefined);
    });

    test('relinking takes the event title, unless the user renamed the meeting', () => {
        db.saveMeeting(meeting('m2', { title: 'Generated title', isProcessed: true }), START, 30 * 60_000);
        assert.equal(db.setMeetingCalendarEvent('m2', { ...EVENT, linkedBy: 'user' }), true);
        assert.equal(db.getMeetingDetails('m2').title, EVENT.title);

        db.saveMeeting(meeting('m3', { title: 'Generated', isProcessed: true }), START, 30 * 60_000);
        db.updateMeetingTitle('m3', 'My own name');
        db.setMeetingCalendarEvent('m3', { ...EVENT, linkedBy: 'user' });
        const m3 = db.getMeetingDetails('m3');
        assert.equal(m3.title, 'My own name');
        assert.equal(m3.calendarEvent.linkedBy, 'user');
    });

    test('a malformed stored snapshot reads as none', () => {
        db.saveMeeting(meeting('m4', { title: 't', isProcessed: true, calendarEventId: 'x', calendarEvent: { id: 'x' } }), START, 1000);
        assert.equal(db.getMeetingDetails('m4').calendarEvent, undefined, 'no attendees array: not a snapshot');
    });

    test('getMeetingTimes gives the window the notes search for candidate events', () => {
        assert.deepEqual(db.getMeetingTimes('m1'), { startMs: START, durationMs: 45 * 60_000 });
        assert.equal(db.getMeetingTimes('nope'), null);
    });
});
