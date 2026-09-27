// SessionCalendarLinker: links a starting session's metadata to its calendar
// event. Pins that it decides at once from a fresh cache, finishes a stale-cache
// start with a fetch only while the meeting is still this one, re-checks an
// early start when the next meeting's window opens, and never writes into a
// meeting that has ended (or a newer one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const compiled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services/calendar/SessionCalendarLinker.js');

// A CalendarManager stand-in, passed as the linker's calendar source.
const cal = { connected: true, cache: null, fetched: null, fetchDelayMs: 0, fetches: 0 };
const fake = {
    getConnectionStatus: () => ({ connected: cal.connected }),
    getCachedEvents: () => cal.cache,
    getUpcomingEvents: () => { cal.fetches++; return new Promise((r) => setTimeout(() => r(cal.fetched ?? []), cal.fetchDelayMs)); },
};
const mod = require(compiled);
const cancelSessionCalendarLink = mod.cancelSessionCalendarLink;
const linkSessionToCalendar = (metadata, isActive) => mod.linkSessionToCalendar(metadata, isActive, fake);

const mins = (m) => new Date(Date.now() + m * 60_000).toISOString();
const ev = (id, fromMin, toMin, extra = {}) => ({ id, title: `Meeting ${id}`, startTime: mins(fromMin), endTime: mins(toMin), attendees: [{ email: 'priya@acme.com', name: 'Priya Nair' }], ...extra });
const reset = () => { cancelSessionCalendarLink(); Object.assign(cal, { connected: true, cache: null, fetched: null, fetchDelayMs: 0, fetches: 0 }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a fresh cache links at once, filling in id, snapshot, source and title', () => {
    reset();
    cal.cache = [ev('q2', -2, 43)];
    const metadata = { audio: {} };
    linkSessionToCalendar(metadata, () => true);
    assert.equal(metadata.calendarEventId, 'q2');
    assert.equal(metadata.source, 'calendar');
    assert.equal(metadata.title, 'Meeting q2');
    assert.equal(metadata.calendarEvent.linkedBy, 'start');
    assert.deepEqual(metadata.calendarEvent.attendees, [{ email: 'priya@acme.com', name: 'Priya Nair' }]);
    assert.equal(cal.fetches, 0, 'no network on the start path');
});

test('a title the start already had is kept', () => {
    reset();
    cal.cache = [ev('q2', 0, 45)];
    const metadata = { title: 'My own title' };
    linkSessionToCalendar(metadata, () => true);
    assert.equal(metadata.title, 'My own title');
    assert.equal(metadata.calendarEventId, 'q2');
});

test('a tie links nothing', () => {
    reset();
    cal.cache = [ev('a', 0, 30), ev('b', 0, 30)];
    const metadata = {};
    linkSessionToCalendar(metadata, () => true);
    assert.equal(metadata.calendarEventId, undefined);
});

test('the notification start keeps its event and gains the snapshot', () => {
    reset();
    cal.cache = [ev('q2', 0, 45), ev('other', 0, 45)];
    const metadata = { title: 'Meeting q2', calendarEventId: 'q2', source: 'calendar' };
    linkSessionToCalendar(metadata, () => true);
    assert.equal(metadata.calendarEventId, 'q2');
    assert.equal(metadata.calendarEvent.linkedBy, 'notification');
});

test('no calendar: nothing happens', () => {
    reset();
    cal.connected = false;
    cal.cache = [ev('q2', 0, 45)];
    const metadata = {};
    linkSessionToCalendar(metadata, () => true);
    assert.deepEqual(metadata, {});
});

test('a stale cache is finished by a fetch, while the meeting is still this one', async () => {
    reset();
    cal.fetched = [ev('q2', 0, 45)];
    cal.fetchDelayMs = 20;
    const metadata = {};
    linkSessionToCalendar(metadata, () => true);
    assert.equal(metadata.calendarEventId, undefined, 'not yet');
    await wait(60);
    assert.equal(cal.fetches, 1);
    assert.equal(metadata.calendarEventId, 'q2');
});

test('a fetch that lands after the meeting ended writes nothing', async () => {
    reset();
    cal.fetched = [ev('q2', 0, 45)];
    cal.fetchDelayMs = 30;
    const metadata = {};
    linkSessionToCalendar(metadata, () => true);
    cancelSessionCalendarLink(); // the meeting ended
    await wait(70);
    assert.equal(metadata.calendarEventId, undefined);
});

test('a fetch for an older start never writes into the newer meeting', async () => {
    reset();
    cal.fetched = [ev('q2', 0, 45)];
    cal.fetchDelayMs = 30;
    const first = {};
    linkSessionToCalendar(first, () => true);
    cal.cache = [];
    const second = {};
    linkSessionToCalendar(second, () => true); // a new start spends the first token
    await wait(70);
    assert.equal(first.calendarEventId, undefined);
    assert.equal(second.calendarEventId, undefined);
});

test('an early start re-checks when the next meeting reaches its window', async (t) => {
    reset();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    try {
        cal.cache = [ev('later', 20, 50)]; // 20 min out: not yet in its 10-min window
        const metadata = {};
        linkSessionToCalendar(metadata, () => true);
        assert.equal(metadata.calendarEventId, undefined);
        t.mock.timers.tick(10 * 60_000 + 1_500); // the window opens
        await Promise.resolve(); await Promise.resolve();
        assert.equal(metadata.calendarEventId, 'later');
        assert.equal(metadata.calendarEvent.linkedBy, 'late');
    } finally {
        t.mock.timers.reset();
    }
});

test('an early start that ends first never links', async (t) => {
    reset();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    try {
        cal.cache = [ev('later', 20, 50)];
        const metadata = {};
        linkSessionToCalendar(metadata, () => true);
        cancelSessionCalendarLink();
        t.mock.timers.tick(20 * 60_000);
        await Promise.resolve(); await Promise.resolve();
        assert.equal(metadata.calendarEventId, undefined);
    } finally {
        t.mock.timers.reset();
    }
});
