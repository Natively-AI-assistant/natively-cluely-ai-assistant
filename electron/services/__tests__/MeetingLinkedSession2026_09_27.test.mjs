// The meeting the user is in beats the clock. A browser's meeting tab (reported
// by the Companion extension as a key, see meetingLinks.ts) links the session to
// the event with the same meeting link: at start, or when the tab turns up
// later. It never overrides the user's own choice or a start made for a
// specific event, and a call that is provably another meeting rules its
// time-overlapping events out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = (p) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services', p);
const { matchEventByMeetingKeys, withoutOtherMeetings, matchEventForSession } = require(dist('calendar/calendarSessionMatch.js'));
const { LiveMeetings } = require(dist('meetingDetection/liveMeetings.js'));
const { meetingTabsToLive, wireExtensionMeetingTabs } = require(dist('meetingDetection/extensionMeetingTabs.js'));
const linker = require(dist('calendar/SessionCalendarLinker.js'));

const NOW = Date.now();
const at = (min) => new Date(NOW + min * 60_000).toISOString();
const ev = (id, fromMin, toMin, keys, extra = {}) => ({ id, title: `Meeting ${id}`, startTime: at(fromMin), endTime: at(toMin), attendees: [{ email: 'p@acme.com', name: 'Priya Nair' }], ...(keys ? { meetingKeys: keys } : {}), ...extra });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('an exact meeting link settles what time left ambiguous', () => {
    const events = [ev('a', 0, 30, ['meet:aaa-aaaa-aaa']), ev('b', 0, 30, ['zoom:81234567890'])];
    assert.equal(matchEventForSession(events, NOW + 60_000).kind, 'ambiguous', 'by time: a tie');
    assert.equal(matchEventByMeetingKeys(events, ['zoom:81234567890'], NOW + 60_000)?.id, 'b');
});

test('a recurring series shares its link: today\'s instance, and only around now', () => {
    const k = ['meet:abc-defg-hij'];
    const series = [ev('yesterday', -24 * 60, -24 * 60 + 30, k), ev('today', 5, 35, k), ev('tomorrow', 24 * 60, 24 * 60 + 30, k)];
    assert.equal(matchEventByMeetingKeys(series, k, NOW)?.id, 'today');
    assert.equal(matchEventByMeetingKeys([ev('later', 45, 75, k)], k, NOW), null, 'more than 30 min before it');
    assert.equal(matchEventByMeetingKeys([ev('overran', -60, -20, k)], k, NOW)?.id, 'overran', 'up to 30 min after its end');
    assert.equal(matchEventByMeetingKeys([ev('long-gone', -120, -40, k)], k, NOW), null);
    assert.equal(matchEventByMeetingKeys([ev('declined', 0, 30, k, { selfResponse: 'declined' })], k, NOW), null);
});

test('keys come best first; the first that matches wins', () => {
    const events = [ev('old-tab', -20, 10, ['meet:aaa-aaaa-aaa']), ev('the-call', 0, 30, ['zoom:81234567890'])];
    assert.equal(matchEventByMeetingKeys(events, ['zoom:81234567890', 'meet:aaa-aaaa-aaa'], NOW)?.id, 'the-call');
});

test('a call in progress rules out events that are other meetings, not ones without a link', () => {
    const events = [ev('other-zoom', 0, 30, ['zoom:99999999999']), ev('in-person', 0, 30), ev('this', 0, 30, ['meet:abc-defg-hij'])];
    assert.deepEqual(withoutOtherMeetings(events, ['meet:abc-defg-hij']).map((e) => e.id), ['in-person', 'this']);
    assert.deepEqual(withoutOtherMeetings(events, []).map((e) => e.id), ['other-zoom', 'in-person', 'this'], 'no call: nothing ruled out');
});

test('live meetings: the union of every source, sound first, change only on a real change', () => {
    const live = new LiveMeetings();
    let changes = 0;
    live.on('change', () => changes++);
    live.set('chrome', [{ key: 'meet:aaa-aaaa-aaa', provider: 'meet', via: 'browser', seenAt: 1 }]);
    live.set('arc', [{ key: 'zoom:81234567890', provider: 'zoom', via: 'browser', audible: true, seenAt: 2 }]);
    assert.deepEqual(live.keys(), ['zoom:81234567890', 'meet:aaa-aaaa-aaa']);
    assert.equal(changes, 2);
    live.set('arc', [{ key: 'zoom:81234567890', provider: 'zoom', via: 'browser', audible: true, seenAt: 99 }]);
    assert.equal(changes, 2, 'a re-report of the same thing is not a change');
    live.set('arc', null);
    assert.deepEqual(live.keys(), ['meet:aaa-aaaa-aaa']);
    live.clearAll();
    assert.deepEqual(live.keys(), []);
    assert.equal(changes, 4);
});

test('what a browser sends is re-validated: malformed keys dropped, titles cleaned, a bounded list', () => {
    const live = meetingTabsToLive([
        { key: 'meet:abc-defg-hij', title: 'Meet –\u0007 Weekly\n sync', audible: true, active: false },
        { key: 'https://evil.example/j/1', title: 'x' },
        { key: 'zoom:81234567890', provider: 'meet', title: 'y'.repeat(500) },
        'not an object',
        { key: 'teams:19:meeting_ABC@thread.v2' },
    ], 7);
    assert.deepEqual(live.map((m) => [m.key, m.provider]), [['meet:abc-defg-hij', 'meet'], ['zoom:81234567890', 'zoom'], ['teams:19:meeting_ABC@thread.v2', 'teams']], 'the provider comes from the key, never the sender');
    assert.equal(live[0].title, 'Meet – Weekly sync');
    assert.equal(live[0].audible, true);
    assert.equal(live[1].title.length, 120);
    assert.equal(meetingTabsToLive(Array.from({ length: 30 }, () => ({ key: 'meet:abc-defg-hij' })), 0).length, 8);
    assert.deepEqual(meetingTabsToLive('nope', 0), []);
});

test('each browser socket is its own source; a closed one takes its tabs along', () => {
    const live = new LiveMeetings();
    let listener = null;
    let wanted = null;
    wireExtensionMeetingTabs({ onMeetingTabs: (l) => { listener = l; }, setMeetingTabsWanted: (on) => { wanted = on; } }, true, live);
    assert.equal(wanted, true, 'the browsers are asked for their tabs');
    const chrome = {};
    const edge = {};
    listener(chrome, [{ key: 'meet:abc-defg-hij' }]);
    listener(edge, [{ key: 'zoom:81234567890' }]);
    assert.equal(live.keys().length, 2);
    listener(chrome, null);
    assert.deepEqual(live.keys(), ['zoom:81234567890']);
    listener(null, null);
    assert.deepEqual(live.keys(), [], 'the server stopped: every browser forgotten');
});

// ── The linker, with a fake calendar and fake live meetings ─────────────────
const cal = { cache: [] };
const calendar = { getConnectionStatus: () => ({ connected: true }), getCachedEvents: () => cal.cache, getUpcomingEvents: async () => cal.cache };

test('at start: the meeting tab picks the event exactly', () => {
    linker.cancelSessionCalendarLink();
    const live = new LiveMeetings();
    live.set('chrome', [{ key: 'zoom:81234567890', provider: 'zoom', via: 'browser', audible: true, seenAt: 1 }]);
    cal.cache = [ev('a', 0, 30, ['meet:aaa-aaaa-aaa']), ev('b', 0, 30, ['zoom:81234567890'])];
    const metadata = {};
    linker.linkSessionToCalendar(metadata, () => true, calendar, live);
    assert.equal(metadata.calendarEventId, 'b');
    assert.equal(metadata.calendarEvent.linkedBy, 'link');
    assert.equal(metadata.title, 'Meeting b');
    linker.cancelSessionCalendarLink();
});

test('at start: an ad-hoc call is not linked to the other meeting on at the same time', () => {
    linker.cancelSessionCalendarLink();
    const live = new LiveMeetings();
    live.set('chrome', [{ key: 'meet:zzz-zzzz-zzz', provider: 'meet', via: 'browser', audible: true, seenAt: 1 }]);
    cal.cache = [ev('scheduled-zoom', 0, 30, ['zoom:81234567890'])];
    const metadata = {};
    linker.linkSessionToCalendar(metadata, () => true, calendar, live);
    assert.equal(metadata.calendarEventId, undefined, 'time alone would have linked it');
    linker.cancelSessionCalendarLink();
});

// 'real' starts in 25 min: outside time matching's 10-min lead, inside the
// meeting link's 30 (people join early).
test('mid-session: the tab that turns up relinks a time guess, and its title follows; the user\'s title stays', async () => {
    linker.cancelSessionCalendarLink();
    const live = new LiveMeetings();
    cal.cache = [ev('guess', 0, 30), ev('real', 25, 55, ['meet:abc-defg-hij'])];
    const metadata = {};
    linker.linkSessionToCalendar(metadata, () => true, calendar, live);
    assert.equal(metadata.calendarEventId, 'guess', 'by time first');
    live.set('chrome', [{ key: 'meet:abc-defg-hij', provider: 'meet', via: 'browser', seenAt: 2 }]);
    await wait(10);
    assert.equal(metadata.calendarEventId, 'real');
    assert.equal(metadata.calendarEvent.linkedBy, 'link');
    assert.equal(metadata.title, 'Meeting real', 'the title the linker set moves with the link');

    linker.cancelSessionCalendarLink();
    const named = { title: 'My own name' };
    const live2 = new LiveMeetings();
    linker.linkSessionToCalendar(named, () => true, calendar, live2);
    live2.set('chrome', [{ key: 'meet:abc-defg-hij', provider: 'meet', via: 'browser', seenAt: 3 }]);
    await wait(10);
    assert.equal(named.calendarEventId, 'real');
    assert.equal(named.title, 'My own name');
    linker.cancelSessionCalendarLink();
});

test('mid-session: never over a start made for a specific event, and never after the meeting', async () => {
    linker.cancelSessionCalendarLink();
    const live = new LiveMeetings();
    cal.cache = [ev('chosen', 0, 30), ev('real', 25, 55, ['meet:abc-defg-hij'])];
    const fromNotification = { calendarEventId: 'chosen', title: 'Meeting chosen', source: 'calendar' };
    linker.linkSessionToCalendar(fromNotification, () => true, calendar, live);
    live.set('chrome', [{ key: 'meet:abc-defg-hij', provider: 'meet', via: 'browser', seenAt: 1 }]);
    await wait(10);
    assert.equal(fromNotification.calendarEventId, 'chosen');

    linker.cancelSessionCalendarLink();
    const live2 = new LiveMeetings();
    const ended = {};
    let active = true;
    cal.cache = [ev('real', 25, 55, ['meet:abc-defg-hij'])];
    linker.linkSessionToCalendar(ended, () => active, calendar, live2);
    active = false;
    linker.cancelSessionCalendarLink();
    live2.set('chrome', [{ key: 'meet:abc-defg-hij', provider: 'meet', via: 'browser', seenAt: 1 }]);
    await wait(10);
    assert.equal(ended.calendarEventId, undefined);
    assert.equal(live2.listenerCount('change'), 0, 'the watch ends with the meeting');
});

test('the session notes the call it is in (for names), with or without a calendar', async () => {
    linker.cancelSessionCalendarLink();
    const live = new LiveMeetings();
    live.set('chrome', [{ key: 'meet:abc-defg-hij', provider: 'meet', via: 'browser', seenAt: 1 }]);
    const offline = { getConnectionStatus: () => ({ connected: false }), getCachedEvents: () => null, getUpcomingEvents: async () => [] };
    const metadata = {};
    linker.linkSessionToCalendar(metadata, () => true, offline, live);
    assert.equal(metadata.callKey, 'meet:abc-defg-hij', 'no calendar needed');
    live.set('chrome', [{ key: 'zoom:81234567890', provider: 'zoom', via: 'browser', audible: true, seenAt: 2 }]);
    await wait(5);
    assert.equal(metadata.callKey, 'zoom:81234567890', 'follows the call as it changes');
    linker.cancelSessionCalendarLink();
    live.set('chrome', [{ key: 'meet:zzz-zzzz-zzz', provider: 'meet', via: 'browser', seenAt: 3 }]);
    await wait(5);
    assert.equal(metadata.callKey, 'zoom:81234567890', 'never after the meeting');
});
