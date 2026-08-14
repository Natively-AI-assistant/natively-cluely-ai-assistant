// electron/rag/__tests__/ReindexDrainPhase.test.mjs
//
// HIGH — exercises the REAL compiled RAGManager._runReindex() Phase-2 drain rework.
// Phase 1 only QUEUES the meetings (their vectors are NULL → unsearchable). Phase 2
// polls getQueueStatus().pending and reports TRUE progress, only emitting
// reindex-complete{partial:false} once the queue is fully drained — so the UI never
// claims "complete" while past meetings are still unsearchable.
//
// Asserts:
//   - progress events reflect the real, decreasing pending depth (done = initial - pending)
//   - complete{partial:false} fires when pending reaches 0, NOT before
//   - complete{partial:true} fires when the poll cap is hit with pending>0
//   - _reindexInFlight resets in every termination path
//
// Built with Object.create(prototype) + stubbed collaborators — same approach as
// ReindexGuard.test.mjs. The drain delay (REINDEX_DRAIN_POLL_MS=2000) is shimmed to 0
// via a setTimeout patch so the 900-poll cap test runs instantly.
//
// Run under Electron ABI:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rmPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/RAGManager.js');
const { RAGManager } = await import(pathToFileURL(rmPath).href);

const SPACE_V2 = 'gemini:gemini-embedding-2:768';

// Build a manager whose getQueueStatus returns scripted pending values over successive
// calls. `pendingSequence` is consumed left-to-right; the final value sticks.
function makeManager({ meetingIds, pendingSequence }) {
  const mgr = Object.create(RAGManager.prototype);
  mgr._reindexInFlight = false;

  const events = [];
  let qIdx = 0;
  const nextPending = () => {
    const v = pendingSequence[Math.min(qIdx, pendingSequence.length - 1)];
    qIdx++;
    return v;
  };

  mgr.embeddingPipeline = {
    getActiveSpaceKey: () => SPACE_V2,
    requeueMeetingForReindex: async () => {},
    getQueueStatus: () => ({ pending: nextPending(), processing: 0, completed: 0, failed: 0 }),
  };
  mgr.vectorStore = {
    getIncompatibleSpaceCount: () => meetingIds.length,
    getMeetingIdsNeedingReindex: () => [...meetingIds],
  };
  mgr.liveIndexer = { isRunning: () => false };
  mgr._emitReindex = (channel, payload) => { events.push({ channel, payload }); };

  return { mgr, events, getQIdx: () => qIdx };
}

// Shim setTimeout to fire immediately so drain polling doesn't actually sleep 2s/poll.
function withInstantTimers(t) {
  const real = global.setTimeout;
  global.setTimeout = (fn) => real(fn, 0);
  t.after(() => { global.setTimeout = real; });
}

describe('RAGManager._runReindex Phase-2 drain (real compiled method)', () => {
  test('progress reflects real decreasing pending; complete{partial:false} at pending=0', async (t) => {
    withInstantTimers(t);
    // initialPending is read first (call #0), then each poll reads the queue again.
    // Sequence: initial=4, then 4,3,2,1,0  → drains to 0.
    const { mgr, events } = makeManager({
      meetingIds: ['a', 'b', 'c', 'd'],
      pendingSequence: [4, 4, 3, 2, 1, 0],
    });

    await mgr._runReindex();

    const progress = events.filter(e => e.channel === 'embedding:reindex-progress');
    assert.ok(progress.length >= 1, 'emits progress events');
    // done = initialPending(4) - pending; should be monotonic non-decreasing.
    const dones = progress.map(e => e.payload.done);
    for (let i = 1; i < dones.length; i++) {
      assert.ok(dones[i] >= dones[i - 1], `progress monotonic: ${dones}`);
    }
    // Last progress before completion should reach done=4 (pending=0).
    assert.equal(dones[dones.length - 1], 4, 'final progress reports all 4 done');
    assert.ok(progress.every(e => e.payload.total === 4), 'total = initialPending throughout');

    const complete = events.filter(e => e.channel === 'embedding:reindex-complete');
    assert.equal(complete.length, 1, 'exactly one complete event');
    assert.equal(complete[0].payload.partial, false, 'partial:false when fully drained');
    assert.equal(mgr._reindexInFlight, false, 'flag reset');
  });

  test('does NOT emit complete prematurely while pending > 0', async (t) => {
    withInstantTimers(t);
    // Stays at pending=2 for several polls, then drains. Complete must come ONLY after 0.
    const { mgr, events } = makeManager({
      meetingIds: ['a', 'b'],
      pendingSequence: [2, 2, 2, 2, 1, 0],
    });

    await mgr._runReindex();

    // No complete event should appear interleaved before the final pending=0.
    const channelsInOrder = events.map(e => e.channel);
    const completeIdx = channelsInOrder.indexOf('embedding:reindex-complete');
    const lastProgressIdx = channelsInOrder.lastIndexOf('embedding:reindex-progress');
    assert.ok(completeIdx > lastProgressIdx, 'complete fires AFTER the last progress, not before');
    const complete = events.find(e => e.channel === 'embedding:reindex-complete');
    assert.equal(complete.payload.partial, false);
  });

  test('drain poll cap: pending always > 0 → stops at REINDEX_MAX_DRAIN_POLLS, partial:true, flag resets', async (t) => {
    withInstantTimers(t);
    const { mgr, events, getQIdx } = makeManager({
      meetingIds: ['a'],
      pendingSequence: [5], // never drains — always 5 pending
    });

    await mgr._runReindex();

    const complete = events.filter(e => e.channel === 'embedding:reindex-complete');
    assert.equal(complete.length, 1, 'one complete event after cap');
    assert.equal(complete[0].payload.partial, true, 'partial:true when cap hit with pending>0');
    assert.equal(mgr._reindexInFlight, false, 'flag MUST reset on cap (finally)');

    // Sanity: it polled up to the cap (900) and stopped — did not loop forever.
    // qIdx = 1 (initial read) + 900 polls + 1 final stillPending read ≈ 902.
    const polls = getQIdx();
    assert.ok(polls >= 900 && polls <= 905, `polled ~900 times then stopped (got ${polls})`);

    // Progress should have been emitted on each poll (done stays 0 since pending never drops).
    const progress = events.filter(e => e.channel === 'embedding:reindex-progress');
    assert.equal(progress.length, 900, 'one progress emit per poll up to the cap');
    assert.ok(progress.every(e => e.payload.done === 0), 'done stays 0 — never falsely advances');
  });

  test('zero pending from the start → immediate complete{partial:false}, single progress', async (t) => {
    withInstantTimers(t);
    const { mgr, events } = makeManager({
      meetingIds: ['a'],
      pendingSequence: [0], // already drained (fast embedder / synchronous)
    });
    await mgr._runReindex();
    const complete = events.filter(e => e.channel === 'embedding:reindex-complete');
    assert.equal(complete.length, 1);
    assert.equal(complete[0].payload.partial, false);
    assert.equal(mgr._reindexInFlight, false);
  });

  test('queue GROWS mid-drain (new meeting ends): done clamps to 0, still completes when it finally drains', async (t) => {
    // Documents behavior: initialPending is captured ONCE. If a concurrent meeting ends
    // and enqueues more work, pending can EXCEED initialPending. done = max(0, initial-pending)
    // clamps to 0 (never negative), and total stays at the captured initialPending — so the
    // progress bar may appear to stall, but completion is still gated correctly on pending=0.
    const { mgr, events } = makeManager({
      meetingIds: ['a', 'b'],
      // initial=2, then a burst to 5 (new meeting), then drains 5..0.
      pendingSequence: [2, 5, 4, 3, 2, 1, 0],
    });
    await mgr._runReindex();

    const progress = events.filter(e => e.channel === 'embedding:reindex-progress');
    // While pending > initialPending, done must clamp to 0 (never negative).
    assert.ok(progress.every(e => e.payload.done >= 0), 'done never goes negative when queue grows');
    assert.ok(progress.every(e => e.payload.total === 2), 'total stays at captured initialPending (=2)');
    const complete = events.find(e => e.channel === 'embedding:reindex-complete');
    assert.equal(complete.payload.partial, false, 'still completes correctly once the (grown) queue fully drains');
  });

  test('requeue runs in Phase 1 for every meeting BEFORE drain polling begins', async (t) => {
    withInstantTimers(t);
    const requeued = [];
    const { mgr, events } = makeManager({
      meetingIds: ['m1', 'm2', 'm3'],
      pendingSequence: [3, 2, 1, 0],
    });
    mgr.embeddingPipeline.requeueMeetingForReindex = async (id) => { requeued.push(id); };
    await mgr._runReindex();
    assert.deepEqual(requeued, ['m1', 'm2', 'm3'], 'all meetings requeued in Phase 1');
    // total in complete event = meetingIds.length (Phase-1 total), not the queue depth.
    const complete = events.find(e => e.channel === 'embedding:reindex-complete');
    assert.equal(complete.payload.total, 3);
  });
});
