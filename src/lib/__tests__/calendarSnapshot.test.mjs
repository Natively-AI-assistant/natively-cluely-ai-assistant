import test from 'node:test';
import assert from 'node:assert/strict';
import {
  noteUpcomingEvents,
  readCalendarSnapshot,
  resetCalendarSnapshotForTests,
  unfinishedEvents,
  warmCalendarSnapshot,
  writeCalendarSnapshot,
} from '../calendarSnapshot.mjs';

const ev = (id, startMin, endMin, now = 0) => ({
  id,
  title: id,
  startTime: new Date(now + startMin * 60_000).toISOString(),
  endTime: new Date(now + endMin * 60_000).toISOString(),
});

function fakeApi({ status = { connected: true, email: 'a@b.c' }, events = [ev('a', 10, 40)], calendars = [{ id: 'primary', name: 'a@b.c', primary: true }] } = {}) {
  const calls = { status: 0, events: 0, calendars: 0 };
  return {
    calls,
    getCalendarStatus: async () => { calls.status++; return status; },
    getUpcomingEvents: async () => { calls.events++; if (events instanceof Error) throw events; return events; },
    getSyncedCalendars: async () => { calls.calendars++; return calendars; },
  };
}

test('empty until warmed', () => {
  resetCalendarSnapshotForTests();
  assert.deepEqual(readCalendarSnapshot(), { status: null, events: null, calendars: null });
});

test('warm-up fills status, meetings and calendars while connected', async () => {
  resetCalendarSnapshotForTests();
  const api = fakeApi();
  await warmCalendarSnapshot(api);
  const s = readCalendarSnapshot();
  assert.equal(s.status.connected, true);
  assert.equal(s.events.length, 1);
  assert.equal(s.calendars[0].id, 'primary');
});

test('warm-up while disconnected fetches no meetings', async () => {
  resetCalendarSnapshotForTests();
  const api = fakeApi({ status: { connected: false } });
  await warmCalendarSnapshot(api);
  assert.equal(api.calls.events, 0);
  assert.deepEqual(readCalendarSnapshot(), { status: { connected: false }, events: null, calendars: null });
});

test('a failed meetings request keeps the last list', async () => {
  resetCalendarSnapshotForTests();
  await warmCalendarSnapshot(fakeApi());
  await warmCalendarSnapshot(fakeApi({ events: new Error('offline') }));
  assert.equal(readCalendarSnapshot().events.length, 1);
});

test('concurrent warm-ups share one request', async () => {
  resetCalendarSnapshotForTests();
  const api = fakeApi();
  await Promise.all([warmCalendarSnapshot(api), warmCalendarSnapshot(api)]);
  assert.equal(api.calls.status, 1);
});

test('a warm-up in flight does not undo a newer write (disconnect)', async () => {
  resetCalendarSnapshotForTests();
  let release;
  const api = fakeApi();
  api.getCalendarStatus = () => new Promise((r) => { release = () => r({ connected: true }); });
  const warming = warmCalendarSnapshot(api);
  writeCalendarSnapshot({ status: { connected: false }, events: null, calendars: null });
  release();
  await warming;
  assert.equal(readCalendarSnapshot().status.connected, false);
});

test("the Launcher's poll updates meetings only while connected", () => {
  resetCalendarSnapshotForTests();
  noteUpcomingEvents([ev('x', 1, 2)]);
  assert.equal(readCalendarSnapshot().events, null);
  writeCalendarSnapshot({ status: { connected: true }, events: [], calendars: [] });
  noteUpcomingEvents([ev('x', 1, 2)]);
  assert.equal(readCalendarSnapshot().events.length, 1);
});

test('meetings that ended since the snapshot are dropped', () => {
  const now = Date.UTC(2026, 8, 27, 12);
  const list = [ev('ended', -60, -1, now), ev('running', -10, 20, now), ev('later', 30, 60, now)];
  assert.deepEqual(unfinishedEvents(list, now).map((e) => e.id), ['running', 'later']);
  assert.equal(unfinishedEvents(null, now), null);
});
