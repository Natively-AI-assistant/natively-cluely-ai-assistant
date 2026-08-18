// Campaign 2 client tests — the durable usage outbox (§35 BYOK / sessions).
//
// Runs against the REAL compiled DatabaseManager and a REAL SQLite file, not a
// stand-in. The whole point of this queue is that it survives restarts, crashes
// and offline periods, and an in-memory fake cannot demonstrate any of that —
// it would test the mock's memory rather than the durability being claimed.
//
// Run: npm test   (the ELECTRON runner; this file needs better-sqlite3 built
// against Electron's ABI, and NATIVELY_TEST_USERDATA to redirect the DB path)

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DBM_PATH = path.join(REPO, 'dist-electron/electron/db/DatabaseManager.js');

const HAVE_BUILD = fs.existsSync(DBM_PATH);

describe('usage outbox (v27)', { skip: HAVE_BUILD ? false : 'run `npm run build:electron` first' }, () => {
  let tmpDir;
  let db;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-outbox-test-'));
    process.env.NATIVELY_TEST_USERDATA = tmpDir;
    const { DatabaseManager } = require(DBM_PATH);
    db = DatabaseManager.getInstance();
  });

  after(() => {
    try { db?.close?.(); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  beforeEach(() => {
    // Not a truncate helper on the class: the runtime deliberately has no way to
    // wipe this table, so the test reaches past the public API rather than
    // adding a destructive method that production code could call by accident.
    try { db.__rawForTests?.(); } catch { /* ignore */ }
    const raw = db;
    try {
      // eslint-disable-next-line no-underscore-dangle
      raw.compactUsageOutbox(0);
      const rows = raw.claimUsageOutboxBatch(100000, Date.now() + 10 ** 12);
      if (rows.length) raw.dropUsageEvents(rows.map((r) => r.event_id));
    } catch { /* ignore */ }
  });

  // ── Row cap: the cap must never destroy undelivered events ────────────────
  //
  // REGRESSION (code review, 2026-08-14). `total` counts EVERY row, but the
  // eviction only ever targeted `status != 'delivered'`. Delivered rows are
  // retained for a 7-day support window and compaction runs on a 6-hour timer,
  // so in a normal session the table fills with delivered rows — and the cap
  // then destroyed the live events while every delivered row survived. Once
  // ALL rows were delivered there was no victim at all and the incoming event
  // was dropped BEFORE the INSERT, permanently, for every later event.
  describe('row cap eviction order', () => {
    test('a table full of DELIVERED rows never costs an undelivered event', () => {
      const MAX = 10;
      // 9 delivered + 1 pending == MAX. The next enqueue must reclaim a
      // delivered row and keep BOTH undelivered events.
      const delivered = [];
      for (let i = 0; i < 9; i++) {
        const id = `cap-delivered-${i}`;
        assert.equal(db.enqueueUsageEvent(id, 'telemetry', { i }, { maxRows: MAX }), 'queued');
        delivered.push(id);
      }
      db.markUsageEventsDelivered(delivered);
      assert.equal(db.enqueueUsageEvent('cap-live-1', 'ledger', { keep: 1 }, { maxRows: MAX }), 'queued');

      const before = db.getUsageOutboxStats();
      assert.equal(before.pending, 1, 'the live event should be queued');

      assert.equal(db.enqueueUsageEvent('cap-live-2', 'ledger', { keep: 2 }, { maxRows: MAX }), 'queued');

      const pending = db.claimUsageOutboxBatch(1000, Date.now() + 10 ** 12).map((r) => r.event_id);
      assert.ok(pending.includes('cap-live-1'), 'the earlier undelivered event must survive — a delivered row should have been evicted instead');
      assert.ok(pending.includes('cap-live-2'), 'the incoming undelivered event must be stored');
      assert.ok(db.getUsageOutboxStats().total <= MAX, 'the cap must still bound the table');
    });

    test('a table of ONLY delivered rows still accepts the incoming event', () => {
      const MAX = 5;
      const ids = [];
      for (let i = 0; i < MAX; i++) {
        const id = `cap-all-delivered-${i}`;
        assert.equal(db.enqueueUsageEvent(id, 'telemetry', { i }, { maxRows: MAX }), 'queued');
        ids.push(id);
      }
      db.markUsageEventsDelivered(ids);
      // Previously: victim query found nothing (every row delivered) and the
      // method returned 'dropped' before the INSERT — the event was gone.
      assert.equal(db.enqueueUsageEvent('cap-after-full', 'ledger', { keep: true }, { maxRows: MAX }), 'queued');
      const pending = db.claimUsageOutboxBatch(1000, Date.now() + 10 ** 12).map((r) => r.event_id);
      assert.ok(pending.includes('cap-after-full'), 'the incoming event must not be dropped when only delivered rows occupy the cap');
    });
  });

  test('the v27 migration ran and the table exists', () => {
    assert.equal(db.isAvailable(), true, db.getInitError()?.message ?? 'db unavailable');
    const stats = db.getUsageOutboxStats();
    assert.equal(typeof stats.pending, 'number');
    assert.equal(typeof stats.total, 'number');
  });

  test('an event is persisted to disk before any network attempt', () => {
    assert.equal(db.enqueueUsageEvent('e-1', 'ledger', { event_id: 'e-1', event_type: 'feature_completed' }), 'queued');
    const batch = db.claimUsageOutboxBatch(10);
    assert.equal(batch.length, 1);
    assert.equal(batch[0].event_id, 'e-1');
    assert.deepEqual(batch[0].payload.event_type, 'feature_completed');
    // The file itself, not just the handle — this is the durability claim.
    assert.ok(fs.existsSync(path.join(tmpDir, 'natively.db')));
  });

  test('enqueuing the same event twice is a no-op', () => {
    assert.equal(db.enqueueUsageEvent('dup-1', 'ledger', { a: 1 }), 'queued');
    assert.equal(db.enqueueUsageEvent('dup-1', 'ledger', { a: 2 }), 'duplicate');
    assert.equal(db.claimUsageOutboxBatch(10).length, 1);
  });

  test('queued events survive a DatabaseManager restart (app restart)', () => {
    db.enqueueUsageEvent('survive-1', 'ledger', { event_type: 'feature_completed' });
    db.checkpoint();

    // Re-open the same file through a fresh singleton — what a relaunch does.
    const { DatabaseManager } = require(DBM_PATH);
    DatabaseManager.instance = null;
    const reopened = DatabaseManager.getInstance();
    const batch = reopened.claimUsageOutboxBatch(10);
    assert.ok(batch.some((b) => b.event_id === 'survive-1'), 'event must outlive the process');
    db = reopened;
  });

  test('a delivered event is not re-sent', () => {
    db.enqueueUsageEvent('done-1', 'ledger', {});
    db.markUsageEventsDelivered(['done-1']);
    assert.equal(db.claimUsageOutboxBatch(10).some((b) => b.event_id === 'done-1'), false);
  });

  test('a delivered row lingers so a late duplicate enqueue is still caught', () => {
    db.enqueueUsageEvent('linger-1', 'ledger', {});
    db.markUsageEventsDelivered(['linger-1']);
    // The row is gone from the queue but still present as a tombstone, so an
    // enqueue of the same id inside the compaction window cannot re-send it.
    assert.equal(db.enqueueUsageEvent('linger-1', 'ledger', {}), 'duplicate');
  });

  test('compaction removes delivered rows once they are old enough', () => {
    db.enqueueUsageEvent('old-1', 'ledger', {});
    db.markUsageEventsDelivered(['old-1'], Date.now() - 8 * 24 * 3600 * 1000);
    const removed = db.compactUsageOutbox(7 * 24 * 3600 * 1000);
    assert.ok(removed >= 1);
    assert.equal(db.enqueueUsageEvent('old-1', 'ledger', {}), 'queued', 'id is reusable after compaction');
  });

  test('a failed delivery backs off instead of spinning', () => {
    db.enqueueUsageEvent('retry-1', 'ledger', {});
    const future = Date.now() + 60_000;
    db.markUsageEventsFailed(['retry-1'], future, 'network');

    assert.equal(db.claimUsageOutboxBatch(10).some((b) => b.event_id === 'retry-1'), false,
      'must not be claimable before next_retry_at');
    assert.ok(db.claimUsageOutboxBatch(10, future + 1).some((b) => b.event_id === 'retry-1'),
      'must be claimable once the backoff elapses');
  });

  test('attempt_count increments so an exhausted event can be given up on', () => {
    db.enqueueUsageEvent('att-1', 'ledger', {});
    for (let i = 0; i < 3; i++) db.markUsageEventsFailed(['att-1'], 0, 'boom');
    const row = db.claimUsageOutboxBatch(10).find((b) => b.event_id === 'att-1');
    assert.equal(row.attempt_count, 3);
  });

  test('a server-rejected event is dropped, not retried forever', () => {
    db.enqueueUsageEvent('poison-1', 'ledger', {});
    db.dropUsageEvents(['poison-1']);
    assert.equal(db.claimUsageOutboxBatch(10).some((b) => b.event_id === 'poison-1'), false);
  });

  test('the queue is bounded — the oldest undelivered event is dropped at the cap', () => {
    for (let i = 0; i < 12; i++) db.enqueueUsageEvent(`cap-${i}`, 'ledger', { i });
    // Cap of 10 with 12 enqueued: the two oldest are evicted.
    const r = db.enqueueUsageEvent('cap-new', 'ledger', {}, { maxRows: 10 });
    assert.equal(r, 'queued');
    const stats = db.getUsageOutboxStats();
    assert.ok(stats.total <= 12, `bounded, got ${stats.total}`);
    const ids = db.claimUsageOutboxBatch(1000).map((b) => b.event_id);
    assert.ok(ids.includes('cap-new'), 'the newest event survives');
    assert.ok(!ids.includes('cap-0'), 'the oldest undelivered event is the one evicted');
  });

  test('a long offline period queues many events without unbounded growth', () => {
    for (let i = 0; i < 200; i++) db.enqueueUsageEvent(`off-${i}`, 'ledger', { i }, { maxRows: 50 });
    const stats = db.getUsageOutboxStats();
    assert.ok(stats.total <= 51, `expected the cap to hold, got ${stats.total}`);
    assert.ok(stats.oldestPendingAgeMs !== null);
  });

  test('queue depth is observable — the §20 health metric', () => {
    db.enqueueUsageEvent('depth-1', 'ledger', {});
    db.enqueueUsageEvent('depth-2', 'ledger', {});
    db.markUsageEventsDelivered(['depth-2']);
    const s = db.getUsageOutboxStats();
    assert.equal(s.pending, 1);
    assert.ok(s.delivered >= 1);
  });

  test('a crash mid-flush loses nothing — undelivered rows stay claimable', () => {
    db.enqueueUsageEvent('crash-1', 'ledger', {});
    db.enqueueUsageEvent('crash-2', 'ledger', {});
    // Simulate: batch claimed and sent, process dies before the ACK is recorded.
    db.claimUsageOutboxBatch(10);
    db.checkpoint();
    const { DatabaseManager } = require(DBM_PATH);
    DatabaseManager.instance = null;
    const reopened = DatabaseManager.getInstance();
    const ids = reopened.claimUsageOutboxBatch(10).map((b) => b.event_id);
    assert.ok(ids.includes('crash-1') && ids.includes('crash-2'),
      'claiming is not consuming — an un-ACKed batch is redelivered, never lost');
    db = reopened;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature-lifecycle semantics (§42) — pure, no database needed
// ─────────────────────────────────────────────────────────────────────────────

describe('feature instrumentation', () => {
  const INSTR_PATH = path.join(REPO, 'dist-electron/electron/services/usageInstrumentation.js');
  const have = fs.existsSync(INSTR_PATH);

  test('a custom mode is never reported as a named feature', { skip: have ? false : 'needs build' }, () => {
    const { featureForMode, FEATURE } = require(INSTR_PATH);
    // A user can rename any mode. Only BUILT-INS map to named features (§31).
    assert.equal(featureForMode({ templateType: 'technical-interview', is_builtin: 0 }), FEATURE.MODE_EXECUTION);
    assert.equal(featureForMode({ templateType: 'technical-interview', is_builtin: 1 }), FEATURE.TECHNICAL_INTERVIEW);
    // F6 (code-review 2026-08-14): the LIVE call site passes
    // ModesManager.getActiveMode() output, whose Mode type carries CAMELCASE
    // `isBuiltin` — raw-row fixtures alone masked that builtin detection was
    // always false in production. Pin the Mode-shaped input too.
    assert.equal(featureForMode({ templateType: 'technical-interview', isBuiltin: true }), FEATURE.TECHNICAL_INTERVIEW);
    assert.equal(featureForMode({ templateType: 'technical-interview', isBuiltin: false }), FEATURE.MODE_EXECUTION);
    assert.equal(featureForMode(null), FEATURE.MODE_EXECUTION);
    assert.equal(featureForMode({ templateType: 'something-invented', is_builtin: 1 }), FEATURE.MODE_EXECUTION);
  });

  test('failures are categorised, never passed through as raw messages', { skip: have ? false : 'needs build' }, () => {
    const { classifyFailure } = require(INSTR_PATH);
    assert.deepEqual(classifyFailure(new Error('Request timed out')), { failure_origin: 'timeout', failure_code: 'TIMEOUT' });
    assert.deepEqual(classifyFailure(new Error('429 rate limit exceeded')), { failure_origin: 'provider', failure_code: 'PROVIDER_RATE_LIMIT' });
    assert.deepEqual(classifyFailure(new Error('fetch failed')), { failure_origin: 'network', failure_code: 'NETWORK_UNAVAILABLE' });
    const abort = new Error('The operation was aborted'); abort.name = 'AbortError';
    assert.deepEqual(classifyFailure(abort), { failure_origin: 'user_cancelled', failure_code: 'USER_CANCELLED' });

    // An uncategorised error blames US, not the provider. A dispute report must
    // never imply a provider was at fault when the truth is we could not tell.
    assert.deepEqual(classifyFailure(new Error('something odd')), { failure_origin: 'natively', failure_code: 'RUNTIME_ERROR' });

    // And it never leaks the message itself.
    const secret = classifyFailure(new Error('failed for user alice@example.com asking about salary'));
    assert.equal(JSON.stringify(secret).includes('alice'), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runTracked — the ONE code path all nine instrumented handlers share (§42)
//
// Asserted against the REAL outbox and a REAL SQLite file, not a stubbed
// recorder. Two reasons: a stub restored in a `finally` misses everything the
// awaited work emits, and esbuild inlines modules PER ENTRY BUNDLE — so the
// `usageOutbox` reachable from usageInstrumentation.js is not necessarily the
// same object a test can monkey-patch through UsageOutbox.js. Reading the rows
// back out of the queue sidesteps both and proves the stronger claim: that
// instrumentation actually reaches durable storage.
// ─────────────────────────────────────────────────────────────────────────────

describe('runTracked outcome classification', () => {
  const INSTR_PATH = path.join(REPO, 'dist-electron/electron/services/usageInstrumentation.js');
  const have = fs.existsSync(INSTR_PATH);
  let tdir;
  let tdb;

  before(() => {
    if (!have) return;
    tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-tracked-test-'));
    process.env.NATIVELY_TEST_USERDATA = tdir;
    process.env.NATIVELY_USAGE_OUTBOX_ENABLED = '1';
    const { DatabaseManager } = require(DBM_PATH);
    DatabaseManager.instance = null;
    tdb = DatabaseManager.getInstance();
  });

  after(() => {
    delete process.env.NATIVELY_USAGE_OUTBOX_ENABLED;
    try { tdb?.close?.(); } catch { /* ignore */ }
    try { fs.rmSync(tdir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  /** Every event emitted since the last drain, oldest first. */
  function drain() {
    const rows = tdb.claimUsageOutboxBatch(1000, Date.now() + 10 ** 12);
    if (rows.length) tdb.dropUsageEvents(rows.map((r) => r.event_id));
    return rows.map((r) => r.payload);
  }

  test('a normal return is one started + one completed', { skip: have ? false : 'needs build' }, async () => {
    const { runTracked } = require(INSTR_PATH);
    drain();
    const out = await runTracked('mode_execution', async () => ({ answer: 'ok' }));
    assert.deepEqual(out, { answer: 'ok' });
    const ev = drain();
    assert.deepEqual(ev.map((e) => e.event_type), ['feature_started', 'feature_completed']);
    assert.equal(ev[1].event_status, 'completed');
    assert.equal(ev[0].feature_session_id, ev[1].feature_session_id, 'both events share one feature session');
  });

  test('an error-object return is FAILED, not completed', { skip: have ? false : 'needs build' }, async () => {
    // The bug a review caught in generate-what-to-say: a handler that returns
    // `{ answer: null, error }` instead of throwing looked like a success.
    const { runTracked } = require(INSTR_PATH);
    drain();
    await runTracked('technical_interview', async () => ({ answer: null, error: 'Invalid image path' }));
    const ev = drain();
    assert.deepEqual(ev.map((e) => e.event_type), ['feature_started', 'feature_failed']);
    assert.equal(ev[1].event_status, 'failed');
    // And the raw message never leaves the machine.
    assert.equal(JSON.stringify(ev[1]).includes('Invalid image path'), false);
  });

  test('a throw is FAILED and the error still reaches the caller', { skip: have ? false : 'needs build' }, async () => {
    const { runTracked } = require(INSTR_PATH);
    drain();
    const boom = new Error('upstream 429 rate limit');
    let caught = null;
    await runTracked('meeting_copilot', async () => { throw boom; }).catch((e) => { caught = e; });
    assert.equal(caught, boom, 'instrumentation must never alter control flow');
    const ev = drain();
    assert.equal(ev[1].event_type, 'feature_failed');
    assert.equal(ev[1].failure_code, 'PROVIDER_RATE_LIMIT');
    assert.equal(JSON.stringify(ev[1]).includes('upstream 429'), false, 'raw messages are never shipped');
  });

  test('a null primary result is FAILED when the handler says so', { skip: have ? false : 'needs build' }, async () => {
    // generate-clarify returns { clarification: null } without throwing when it
    // could not produce anything. That is a non-delivery, not a completion.
    const { runTracked } = require(INSTR_PATH);
    drain();
    await runTracked('mode_execution', async () => ({ clarification: null }),
      { failedIf: (r) => !r || r.clarification === null });
    const ev = drain();
    assert.equal(ev[1].event_type, 'feature_failed');
  });

  test('exactly ONE terminal event is emitted per execution', { skip: have ? false : 'needs build' }, async () => {
    const { runTracked } = require(INSTR_PATH);
    drain();
    await runTracked('mode_execution', async () => ({ ok: true }));
    const terminals = drain().filter((e) => e.event_type !== 'feature_started');
    assert.equal(terminals.length, 1, 'a double terminal would inflate every count derived from it');
  });

  test('a throwing failedIf predicate cannot decide the outcome', { skip: have ? false : 'needs build' }, async () => {
    const { runTracked } = require(INSTR_PATH);
    drain();
    const result = await runTracked('mode_execution', async () => ({ ok: true }),
      { failedIf: () => { throw new Error('bad predicate'); } });
    assert.deepEqual(result, { ok: true }, 'the handler result is returned regardless');
    assert.equal(drain()[1].event_type, 'feature_completed');
  });

  test('a duration is recorded on the terminal event', { skip: have ? false : 'needs build' }, async () => {
    const { runTracked } = require(INSTR_PATH);
    drain();
    await runTracked('jd_analysis', async () => { await new Promise((r) => setTimeout(r, 15)); return { ok: true }; });
    const ev = drain();
    assert.ok(Number.isInteger(ev[1].reported_duration_ms));
    assert.ok(ev[1].reported_duration_ms >= 10, `expected >=10ms, got ${ev[1].reported_duration_ms}`);
  });

  test('events carry pseudonymous context and no content', { skip: have ? false : 'needs build' }, async () => {
    const { runTracked } = require(INSTR_PATH);
    drain();
    await runTracked('technical_interview', async () => ({ ok: true }));
    const ev = drain();
    assert.equal(ev[1].feature, 'technical_interview');
    assert.equal(ev[1].platform, process.platform);
    assert.ok(ev[1].app_session_id, 'app session id present (§16)');
    assert.ok(ev[1].client_event_ts, 'client claim present; the server still stamps its own time');
    for (const banned of ['prompt', 'answer', 'transcript', 'resume', 'content', 'license_id', 'email']) {
      assert.equal(Object.keys(ev[1]).includes(banned), false, `${banned} must never be emitted`);
    }
  });
});
