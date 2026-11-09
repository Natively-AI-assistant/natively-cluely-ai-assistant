// 2026-11-07. Pro packs (Light $5 = 2 h within 7 days, Heavy $10 = 5 h within
// 14 days) are sold as meeting hours and unlock Pro. The app reports live
// meeting time to natively-api /v1/pack/meeting-tick once a minute, whatever
// transcribes the meeting. These tests pin the clock: what it bills, what it
// re-sends, when it stops, and that sleep is never billed.
//
// The clock is pure (every dependency injected), so the same tests exercise the
// behaviour both platforms get: powerMonitor's suspend/resume exist on macOS and
// Windows alike, and the per-tick gap cap is what makes the two platforms'
// different monotonic clocks (mach_absolute_time stops in sleep; Windows QPC
// does not) bill the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPackMeetingClock, TICK_INTERVAL_MS, MAX_GAP_MS, MAX_PENDING,
} from '../packs/PackMeetingClock.ts';

const KEY = 'natively_sk_' + 'a'.repeat(40);

function world(over = {}) {
  let now = 1_000_000;
  let key = 'key' in over ? over.key : KEY;
  let ids = 0;
  const timers = [];
  const sent = [];
  const ended = [];
  const states = [];
  const renewed = [];
  const probes = [];
  // Each answer is { status, body } or 'throw'; the last one repeats.
  const answers = [...(over.answers ?? [{ status: 200, body: { ok: true, metered: true, pack: { ended: false } } }])];
  const clock = createPackMeetingClock({
    getApiKey: () => key,
    postTick: async (k, body) => {
      const a = answers.length > 1 ? answers.shift() : answers[0];
      sent.push({ key: k, ...body, outcome: a === 'throw' ? 'throw' : a.status });
      if (a === 'throw') throw new Error('offline');
      return a;
    },
    now: () => now,
    every: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return () => { t.live = false; }; },
    newMeetingId: () => `mtg_test${String(++ids).padStart(4, '0')}`,
    onPackEnded: (info) => ended.push(info),
    onPackState: (p) => states.push(p),
    ...(over.isKeyLive ? { isKeyLive: async (k) => { probes.push(k); return over.isKeyLive(k); } } : {}),
    onPackRenewed: () => renewed.push(now),
    log: { log() {}, warn() {} },
  });
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    clock, sent, ended, states, timers, renewed, probes,
    advance: (ms) => { now += ms; },
    setKey: (k) => { key = k; },
    /** Let `ms` pass and fire the live timer once. */
    async tick(ms = TICK_INTERVAL_MS) {
      now += ms;
      for (const t of timers) if (t.live) t.fn();
      await settle(); await settle();
    },
    settle,
  };
}

test('a live meeting bills one tick per minute with increasing seq', async () => {
  const w = world();
  w.clock.meetingStarted();
  assert.equal(w.timers[0].ms, TICK_INTERVAL_MS);
  await w.tick(); await w.tick(); await w.tick();
  assert.deepEqual(w.sent.map((s) => [s.meeting_id, s.seq, s.seconds]),
    [['mtg_test0001', 0, 60], ['mtg_test0001', 1, 60], ['mtg_test0001', 2, 60]]);
  assert.equal(w.clock.snapshot().pending.length, 0);
});

test('stopping a meeting bills the last partial minute and stops the timer', async () => {
  const w = world();
  w.clock.meetingStarted();
  await w.tick();
  w.advance(25_400);
  await w.clock.meetingEnded();
  assert.deepEqual(w.sent.map((s) => s.seconds), [60, 25]);
  assert.equal(w.timers[0].live, false);
  assert.equal(w.clock.snapshot().live, false);
});

test('sub-second remainders carry over instead of being lost each minute', async () => {
  const w = world();
  w.clock.meetingStarted();
  for (let i = 0; i < 4; i++) await w.tick(60_400);
  // 4 x 60.4 s = 241.6 s → 60, 60, 61, 60 (the carried 0.4 s add up).
  assert.equal(w.sent.reduce((a, s) => a + s.seconds, 0), 241);
});

test('no key (or a trial) → nothing runs and nothing is sent', async () => {
  const w = world({ key: null });
  w.clock.meetingStarted();
  assert.equal(w.timers.length, 0);
  await w.tick();
  assert.equal(w.sent.length, 0);
});

test('a key that is not a pack costs one request per meeting, then the clock stops', async () => {
  const w = world({ answers: [{ status: 200, body: { ok: true, metered: false } }] });
  w.clock.meetingStarted();
  await w.tick();
  await w.tick();
  assert.equal(w.sent.length, 1);
  assert.equal(w.timers[0].live, false);
  // The next meeting on the same key is not metered at all.
  w.clock.meetingStarted();
  assert.equal(w.timers.length, 1);
  // A different key is tried again.
  w.setKey('natively_sk_' + 'b'.repeat(40));
  w.clock.meetingStarted();
  assert.equal(w.timers.length, 2);
});

test('SLEEP (macOS and Windows): time between suspend and resume is never billed', async () => {
  const w = world();
  w.clock.meetingStarted();
  w.advance(20_000);
  w.clock.suspend();              // 20 s accrued, then asleep
  w.advance(3 * 3600_000);        // three hours asleep
  w.clock.resume();
  await w.tick(40_000);           // 40 s awake
  // The 20 s before sleep and the 40 s after: one minute in all, not three hours.
  assert.deepEqual(w.sent.map((s) => s.seconds), [20, 40]);
  assert.equal(w.clock.snapshot().suspended, false);
});

test('SLEEP without a suspend event: one tick never claims more than MAX_GAP_MS', async () => {
  // Windows' monotonic clock keeps counting through sleep; a missed suspend
  // event, a late timer or a hung main thread all look like this.
  const w = world();
  w.clock.meetingStarted();
  await w.tick(5 * 3600_000);
  assert.deepEqual(w.sent.map((s) => s.seconds), [Math.floor(MAX_GAP_MS / 1000)]);
  assert.ok(MAX_GAP_MS / 1000 <= 90, 'within the server clamp');
});

test('suspend and resume outside a meeting, or twice, are harmless', async () => {
  const w = world();
  w.clock.suspend(); w.clock.resume();
  w.clock.meetingStarted();
  w.clock.resume();               // not suspended: no effect
  w.advance(10_000);
  w.clock.suspend(); w.clock.suspend();
  w.advance(60_000);
  w.clock.resume(); w.clock.resume();
  await w.clock.meetingEnded();
  assert.deepEqual(w.sent.map((s) => s.seconds), [10]);
});

test('a tick that fails is kept and re-sent with the SAME seq (the server applies it once)', async () => {
  const ok = { status: 200, body: { ok: true, metered: true } };
  const w = world({ answers: ['throw', { status: 503, body: {} }, ok] });
  w.clock.meetingStarted();
  await w.tick();                 // seq 0 → offline
  await w.tick();                 // seq 0 again → 503; seq 1 queued behind it
  await w.tick();                 // seq 0, 1, 2 → ok
  assert.deepEqual(w.sent.map((s) => [s.seq, s.outcome]),
    [[0, 'throw'], [0, 503], [0, 200], [1, 200], [2, 200]]);
  assert.equal(w.clock.snapshot().pending.length, 0);
});

test('a tick left over from a meeting that ended offline goes out when the next one starts', async () => {
  const ok = { status: 200, body: { ok: true, metered: true } };
  const w = world({ answers: ['throw', ok] });
  w.clock.meetingStarted();
  w.advance(30_000);
  await w.clock.meetingEnded();   // offline
  assert.equal(w.clock.snapshot().pending.length, 1);
  w.clock.meetingStarted();
  await w.settle(); await w.settle();
  assert.deepEqual(w.sent.map((s) => [s.meeting_id, s.seq, s.outcome]),
    [['mtg_test0001', 0, 'throw'], ['mtg_test0001', 0, 200]]);
});

test('the queue is bounded through a long outage', async () => {
  const w = world({ answers: ['throw'] });
  w.clock.meetingStarted();
  for (let i = 0; i < MAX_PENDING + 5; i++) await w.tick();
  assert.equal(w.clock.snapshot().pending.length, MAX_PENDING);
  assert.equal(w.clock.snapshot().pending[0].seq, 5, 'the oldest are dropped');
});

test('hours used up: the counted tick says ended → Pro is re-checked once and the meeting pauses', async () => {
  const w = world({ answers: [
    { status: 200, body: { ok: true, metered: true, pack: { ended: false, seconds_left: 30 } } },
    { status: 200, body: { ok: true, metered: true, pack: { ended: true, ended_reason: 'hours_used' } } },
  ] });
  w.clock.meetingStarted();
  await w.tick(); await w.tick(); await w.tick(); await w.tick();
  assert.deepEqual(w.ended, [{ reason: 'hours_used' }]);
  assert.equal(w.sent.length, 2, 'nothing is billed while paused');
  assert.equal(w.states.length, 2);
  assert.equal(w.clock.snapshot().paused, true);
  assert.equal(w.clock.snapshot().pending.length, 0);
  // With nothing to ask whether hours came back, the end of the meeting bills nothing more.
  w.advance(30_000);
  await w.clock.meetingEnded();
  assert.equal(w.sent.length, 2);
  assert.equal(w.timers[0].live, false);
});

test('a finished pack refused by the server (403 pack_ended) re-checks Pro', async () => {
  const w = world({ answers: [{ status: 403, body: { ok: false, error: 'subscription_inactive', reason: 'pack_ended', pack_ended_reason: 'window_closed' } }] });
  w.clock.meetingStarted();
  await w.tick();
  assert.deepEqual(w.ended, [{ reason: 'window_closed' }]);
  assert.equal(w.clock.snapshot().paused, true);
  assert.equal(w.clock.snapshot().pending.length, 0);
});

test('a key refused for another reason stops the clock without claiming the pack ended', async () => {
  const w = world({ answers: [{ status: 401, body: { ok: false, error: 'invalid_key_format' } }] });
  w.clock.meetingStarted();
  await w.tick();
  assert.deepEqual(w.ended, []);
  assert.equal(w.clock.snapshot().live, false);
});

test('a malformed tick (400) is dropped, the rest still go out', async () => {
  const ok = { status: 200, body: { ok: true, metered: true } };
  const w = world({ answers: [{ status: 400, body: { message: 'bad' } }, ok] });
  w.clock.meetingStarted();
  await w.tick(); await w.tick();
  assert.deepEqual(w.sent.map((s) => [s.seq, s.outcome]), [[0, 400], [1, 200]]);
  assert.equal(w.clock.snapshot().pending.length, 0);
});

test('meeting ids are valid for the server (8-80 chars of [A-Za-z0-9_-])', () => {
  const w = world();
  w.clock.meetingStarted();
  assert.match(w.clock.snapshot().meetingId, /^[A-Za-z0-9_-]{8,80}$/);
});

// 2026-11-09: a top-up during a meeting. The webhook adds the hours to the same
// key, so the meeting is metered again from the minute the clock sees them. The
// minutes in between (no pack, no Pro) are never billed.
const ENDED = { status: 200, body: { ok: true, metered: true, pack: { ended: true, ended_reason: 'hours_used' } } };
const LIVE = { status: 200, body: { ok: true, metered: true, pack: { ended: false, seconds_left: 3600 } } };

test('TOP-UP mid-meeting: metering resumes from the minute the hours are seen, same meeting, next seq', async () => {
  let live = false;
  const w = world({ answers: [ENDED, LIVE], isKeyLive: () => live });
  w.clock.meetingStarted();
  await w.tick();                       // seq 0 → ended
  assert.equal(w.clock.snapshot().paused, true);
  await w.tick(); await w.tick();       // paused: asks, not yet
  assert.equal(w.probes.length, 2);
  assert.equal(w.sent.length, 1);
  live = true;                          // the top-up lands
  await w.tick();                       // asks → live, metering from now
  assert.equal(w.renewed.length, 1);
  assert.equal(w.clock.snapshot().paused, false);
  assert.equal(w.sent.length, 1, 'the paused minutes are not billed');
  await w.tick();                       // the first metered minute after the top-up
  assert.equal(w.sent.length, 2);
  assert.equal(w.sent[1].meeting_id, w.sent[0].meeting_id);
  assert.equal(w.sent[1].seq, 1);
  assert.equal(w.sent[1].seconds, 60);
});

test('TOP-UP: a pack that ends again in the same meeting is reported again', async () => {
  let live = false;
  const w = world({ answers: [ENDED, ENDED], isKeyLive: () => live });
  w.clock.meetingStarted();
  await w.tick();
  live = true;
  await w.tick();                       // renewed
  live = false;
  await w.tick();                       // that minute's tick: ended again
  assert.deepEqual(w.ended, [{ reason: 'hours_used' }, { reason: 'hours_used' }]);
  assert.equal(w.clock.snapshot().paused, true);
});

test('TOP-UP: waking from sleep while paused does not start billing', async () => {
  const w = world({ answers: [ENDED], isKeyLive: () => false });
  w.clock.meetingStarted();
  await w.tick();
  w.clock.suspend();
  w.advance(600_000);
  w.clock.resume();
  await w.tick(); await w.tick();
  assert.equal(w.sent.length, 1);
  assert.equal(w.clock.snapshot().paused, true);
  await w.clock.meetingEnded();
  assert.equal(w.sent.length, 1);
});

test('TOP-UP: a new pack key pasted mid-meeting is metered under its own meeting id from seq 0', async () => {
  const OTHER = 'natively_sk_' + 'b'.repeat(40);
  const w = world({ answers: [ENDED, LIVE], isKeyLive: (k) => k === OTHER });
  w.clock.meetingStarted();
  await w.tick();
  await w.tick();                       // old key still ended
  assert.equal(w.renewed.length, 0);
  w.setKey(OTHER);
  await w.tick();                       // new key live
  await w.tick();
  assert.equal(w.renewed.length, 1);
  assert.equal(w.sent[1].key, OTHER);
  assert.equal(w.sent[1].seq, 0);
  assert.notEqual(w.sent[1].meeting_id, w.sent[0].meeting_id);
});

test('TOP-UP: a failed check counts as not yet, and checks never overlap', async () => {
  let calls = 0;
  let release;
  const w = world({ answers: [ENDED], isKeyLive: () => { calls++; if (calls === 1) throw new Error('offline'); return new Promise((r) => { release = r; }); } });
  w.clock.meetingStarted();
  await w.tick();
  await w.tick();                       // throws → still paused
  assert.equal(w.clock.snapshot().paused, true);
  await w.tick();                       // hangs
  await w.tick();                       // must not start a second check
  assert.equal(calls, 2);
  release(false);
  await w.settle();
  assert.equal(w.clock.snapshot().paused, true);
});
