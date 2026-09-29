// The calendar as last seen by this window: the connection, the next 7 days of
// meetings and the synced calendars. Settings › Calendar opens from it at once
// and refreshes in the background, instead of folding open behind "Loading your
// meetings…" on every visit. The Launcher warms it once after startup and keeps
// the meetings current on its minute poll.

/** @type {{ status: any, events: any[] | null, calendars: any[] | null }} */
let snapshot = { status: null, events: null, calendars: null };
// Bumped by every write except a warm-up's own, so a warm-up that was already
// in flight when Settings wrote newer state (a disconnect) does not undo it.
let generation = 0;
/** @type {Promise<void> | null} */
let warming = null;

export function readCalendarSnapshot() {
  return snapshot;
}

export function writeCalendarSnapshot(patch) {
  generation += 1;
  snapshot = { ...snapshot, ...patch };
}

/** The Launcher's poll: new meetings, kept only while the snapshot says connected. */
export function noteUpcomingEvents(events) {
  if (!snapshot.status?.connected || !Array.isArray(events)) return;
  snapshot = { ...snapshot, events };
}

/** Meetings in the snapshot that have not ended by `now` (a snapshot can be minutes old). */
export function unfinishedEvents(events, now) {
  if (!Array.isArray(events)) return null;
  return events.filter((ev) => {
    const end = new Date(ev?.endTime ?? ev?.startTime).getTime();
    return !Number.isFinite(end) || end > now;
  });
}

/**
 * Fetch the connection, and while connected the meetings and calendars, into
 * the snapshot. One at a time; a failed request keeps what was there.
 */
export function warmCalendarSnapshot(api) {
  if (warming) return warming;
  const startedAt = generation;
  warming = (async () => {
    const status = await api?.getCalendarStatus?.().catch(() => null);
    if (!status) return;
    let patch = { status, events: null, calendars: null };
    if (status.connected) {
      const [events, calendars] = await Promise.all([
        api.getUpcomingEvents?.().catch(() => null),
        api.getSyncedCalendars?.().catch(() => null),
      ]);
      patch = {
        status,
        events: Array.isArray(events) ? events : snapshot.events,
        calendars: Array.isArray(calendars) ? calendars : snapshot.calendars,
      };
    }
    if (generation !== startedAt) return;
    snapshot = { ...snapshot, ...patch };
  })().finally(() => { warming = null; });
  return warming;
}

/** Tests only. */
export function resetCalendarSnapshotForTests() {
  snapshot = { status: null, events: null, calendars: null };
  generation = 0;
  warming = null;
}
