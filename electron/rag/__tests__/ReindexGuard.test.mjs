// electron/rag/__tests__/ReindexGuard.test.mjs
//
// HIGH — exercises the REAL compiled RAGManager._runReindex() to prove:
//   1. The _reindexInFlight guard makes concurrent entry (auto setTimeout + manual IPC)
//      a no-op — no double-clear / double-queue.
//   2. The capped live-meeting pause (REINDEX_MAX_LIVE_WAITS) bails cleanly AND resets
//      _reindexInFlight via the finally block, so the next launch can retry.
//   3. The happy path requeues every meeting exactly once and resets the flag.
//
// We invoke the actual method on an instance built with Object.create(prototype) to
// skip the provider-heavy constructor while still testing the genuine method body.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rmPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/RAGManager.js');
const { RAGManager } = await import(pathToFileURL(rmPath).href);

const SPACE_V2 = 'gemini:gemini-embedding-2:768';

// Build a RAGManager instance without running its constructor, then attach the
// collaborators _runReindex actually touches.
function makeManager({ meetingIds, liveRunningSequence = [] }) {
  const mgr = Object.create(RAGManager.prototype);
  mgr._reindexInFlight = false;

  const requeued = [];
  let liveCallIdx = 0;

  mgr.embeddingPipeline = {
    getActiveSpaceKey: () => SPACE_V2,
    requeueMeetingForReindex: async (id) => { requeued.push(id); },
    // Phase-2 drain poll: report an already-drained queue so _runReindex completes
    // immediately (this suite exercises the requeue/guard/bail logic, not draining).
    getQueueStatus: () => ({ pending: 0, processing: 0, completed: 0, failed: 0 }),
  };
  mgr.vectorStore = {
    getIncompatibleSpaceCount: () => meetingIds.length,
    getMeetingIdsNeedingReindex: () => [...meetingIds],
  };
  mgr.liveIndexer = {
    // Returns the scripted value for each successive call; defaults to false (not live).
    isRunning: () => {
      const v = liveRunningSequence[liveCallIdx] ?? false;
      liveCallIdx++;
      return v;
    },
  };
  mgr._emitReindex = () => {}; // swallow IPC

  return { mgr, requeued };
}

describe('RAGManager._runReindex guard + bail (real compiled method)', () => {
  test('happy path: every meeting requeued once, flag reset', async () => {
    const { mgr, requeued } = makeManager({ meetingIds: ['a', 'b', 'c'] });
    await mgr._runReindex();
    assert.deepEqual(requeued, ['a', 'b', 'c']);
    assert.equal(mgr._reindexInFlight, false, 'flag must reset after completion');
  });

  test('concurrent entry is a no-op (in-flight guard)', async () => {
    const { mgr, requeued } = makeManager({ meetingIds: ['a', 'b'] });

    // Make requeue slow so the first _runReindex is still mid-flight when the
    // second is invoked — exactly the auto(setTimeout) + manual(IPC) race.
    let release;
    const gate = new Promise(r => { release = r; });
    mgr.embeddingPipeline.requeueMeetingForReindex = async (id) => {
      requeued.push(id);
      await gate; // block until released
    };

    const first = mgr._runReindex();   // auto path enters, sets flag, awaits gate
    await Promise.resolve();                // let first run synchronously up to the await
    const second = mgr._runReindex();  // manual path — must see flag=true and bail
    await second;                           // resolves immediately (guard returned)

    assert.equal(requeued.length, 1, 'second call must NOT have started any requeue');
    release();
    await first;
    assert.deepEqual(requeued, ['a', 'b'], 'first call completes all meetings');
    assert.equal(mgr._reindexInFlight, false);
  });

  test('capped live-meeting pause bails AND resets flag (no forever-stuck)', async (t) => {
    // Force isRunning() to always report a live meeting → the pause loop spins until
    // REINDEX_MAX_LIVE_WAITS, then bails. Stub the recheck delay to 0 so it's instant.
    const { mgr, requeued } = makeManager({
      meetingIds: ['a'],
      liveRunningSequence: Array(100).fill(true), // always live
    });

    // Patch the static recheck interval to 0 via a setTimeout shim so the test is fast.
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => realSetTimeout(fn, 0);
    t.after(() => { global.setTimeout = realSetTimeout; });

    await mgr._runReindex();

    assert.equal(requeued.length, 0, 'no meeting requeued — bailed before processing');
    assert.equal(mgr._reindexInFlight, false, 'flag MUST reset on bail (finally), else stuck forever');
  });

  test('no active space → early return, flag never set', async () => {
    const { mgr } = makeManager({ meetingIds: ['a'] });
    mgr.embeddingPipeline.getActiveSpaceKey = () => undefined;
    await mgr._runReindex();
    assert.equal(mgr._reindexInFlight, false);
  });
});
