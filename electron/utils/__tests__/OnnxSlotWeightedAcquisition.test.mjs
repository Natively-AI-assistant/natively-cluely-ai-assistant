// electron/utils/__tests__/OnnxSlotWeightedAcquisition.test.mjs
//
// Regression coverage for the weighted ONNX slot semaphore (Task 10 fix
// round 1). NemotronEngine opens 3 concurrent onnxruntime-node sessions
// (encoder/decoder/joint) per worker, but every existing acquireOnnxSlot()
// call site — including the pre-fix Nemotron path — acquired exactly ONE
// slot per session. Against the default cap of 2, a plain
// "current + weight <= cap" admission check can never satisfy weight=3 and
// would deadlock forever. The fix treats a request whose OWN weight exceeds
// the cap as exclusive: admit only when nothing else is in flight, then let
// it hold the gate alone until release.
//
// Task 10 fix round 2 adds: a bounded-wait timeout, applied ONLY to
// exclusive-mode (weight > cap) acquisitions. `LocalWhisperSTT` holds its
// slot for a worker's ENTIRE session lifetime (a whole meeting), so a second
// dual-Nemotron channel that loses the exclusive-mode race previously waited
// on a promise that would never resolve until the first channel's meeting
// ended — never rejecting, never surfacing an error, silently stalling every
// tick forever. The fix rejects after readExclusiveTimeoutMs() (default
// 15000ms, overridable via NATIVELY_ONNX_EXCLUSIVE_TIMEOUT_MS) so the
// caller's existing error path (LocalWhisperSTT.spawnWorker() -> start()'s
// .catch() -> emit('error')) can engage instead of hanging forever. Ordinary
// weight<=cap queuing (embeddings/reranker/intent classifier waiting behind
// a busy gate) is NOT subject to this timeout and must keep waiting
// indefinitely, exactly as before.
//
// Run: npm test (globs electron/utils/__tests__/**/*.test.mjs via
// `npm run build:electron && ... electron --test`), or directly:
// ELECTRON_RUN_AS_NODE=1 electron --test electron/utils/__tests__/OnnxSlotWeightedAcquisition.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/utils/onnxThreadConfig.js')
).href;

const { acquireOnnxSlot, __resetOnnxGateForTests } = await import(MODULE_URL);

// Pin the cap explicitly so this suite doesn't depend on ambient env state.
process.env.NATIVELY_ONNX_MAX_CONCURRENT_SESSIONS = '2';
// Shrink the exclusive-mode timeout so the reject-on-timeout tests below run
// in milliseconds instead of hand-waiting the real 15s default.
const TEST_EXCLUSIVE_TIMEOUT_MS = 200;
process.env.NATIVELY_ONNX_EXCLUSIVE_TIMEOUT_MS = String(TEST_EXCLUSIVE_TIMEOUT_MS);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sentinel used with Promise.race to prove a promise is STILL PENDING after
// a short delay, without waiting for a real (and flaky) long timeout.
const STILL_PENDING = Symbol('still-pending');
async function isStillPending(promise, delayMs = 150) {
  const result = await Promise.race([
    promise.then(() => 'resolved'),
    sleep(delayMs).then(() => STILL_PENDING),
  ]);
  return result === STILL_PENDING;
}

describe('weighted ONNX slot acquisition', () => {
  beforeEach(() => {
    __resetOnnxGateForTests();
  });

  test('a weight:3 acquisition against cap=2 succeeds when nothing else is in flight (no deadlock)', async () => {
    // The exact deadlock this fix prevents: current(0) + weight(3) > cap(2)
    // would hang forever under the old plain-sum check.
    const release = await acquireOnnxSlot('high', 3);
    assert.equal(typeof release, 'function');
    release();
  });

  test('while a weight:3 holder is in flight, a concurrent weight:1 request stays pending until release', async () => {
    const releaseHeavy = await acquireOnnxSlot('high', 3);

    const lightP = acquireOnnxSlot('high', 1);
    assert.equal(
      await isStillPending(lightP),
      true,
      'weight:1 request must NOT resolve while the exclusive weight:3 holder is live',
    );

    releaseHeavy();
    const releaseLight = await lightP;
    assert.equal(typeof releaseLight, 'function');
    releaseLight();
  });

  test('two concurrent weight:3 acquisitions serialize (second waits for the first to release)', async () => {
    const releaseFirst = await acquireOnnxSlot('high', 3);

    const secondP = acquireOnnxSlot('high', 3);
    assert.equal(
      await isStillPending(secondP),
      true,
      'a second weight:3 acquisition must not proceed while the first is live',
    );

    releaseFirst();
    const releaseSecond = await secondP;
    assert.equal(typeof releaseSecond, 'function');
    releaseSecond();
  });

  test('regression: plain weight:1 (default) behaves exactly as before', async () => {
    // Two concurrent weight-1 'high' acquisitions against cap=2 both succeed
    // immediately.
    const releaseA = await acquireOnnxSlot('high');
    const releaseB = await acquireOnnxSlot('high', 1);

    // A third should block until one of the first two releases.
    const thirdP = acquireOnnxSlot('high');
    assert.equal(
      await isStillPending(thirdP),
      true,
      'a third weight:1 acquisition must block while the cap (2) is full',
    );

    releaseA();
    const releaseThird = await thirdP;
    assert.equal(typeof releaseThird, 'function');

    releaseB();
    releaseThird();
  });

  // ── Bounded-wait timeout (Task 10 fix round 2) ──────────────────────────

  test('a weight:3 acquisition against cap=2 REJECTS once the exclusive timeout elapses while another exclusive holder is active', async () => {
    // This is the dual-Nemotron-channel self-deadlock: two session-length
    // weight:3 holders racing for one exclusive slot. Before this fix, the
    // second acquisition's promise never rejected and never resolved — it
    // just sat pending until the first holder released (i.e. until the
    // meeting ended). It must now reject within the (test-shrunk) bound
    // instead of hanging.
    const releaseFirst = await acquireOnnxSlot('high', 3);

    const start = Date.now();
    await assert.rejects(
      () => acquireOnnxSlot('high', 3),
      /timed out/i,
      'a second exclusive-mode acquisition must reject, not hang, once another exclusive holder is active',
    );
    const elapsed = Date.now() - start;
    assert.ok(
      elapsed >= TEST_EXCLUSIVE_TIMEOUT_MS - 20,
      `rejection fired too early (after ${elapsed}ms, expected >= ~${TEST_EXCLUSIVE_TIMEOUT_MS}ms)`,
    );

    releaseFirst();
  });

  test('a weight:1 (default, <= cap) acquisition does NOT reject even when it waits past the exclusive timeout window', async () => {
    // Confirms the timeout is scoped to exclusive-mode (weight > cap) only —
    // ordinary normal-priority queuing under contention (embeddings,
    // reranker, intent classifier waiting behind a busy gate) must keep
    // waiting indefinitely, exactly as before this fix.
    const releaseA = await acquireOnnxSlot('high', 1);
    const releaseB = await acquireOnnxSlot('high', 1);

    const thirdP = acquireOnnxSlot('high', 1);

    // Wait well past the (test-shrunk) exclusive timeout window — the
    // weight:1 request must still be pending, not rejected.
    await new Promise((r) => setTimeout(r, TEST_EXCLUSIVE_TIMEOUT_MS + 100));
    assert.equal(
      await isStillPending(thirdP, 10),
      true,
      'a weight:1 acquisition must still be pending (not rejected) after the exclusive-timeout window elapses',
    );

    releaseA();
    const releaseThird = await thirdP;
    assert.equal(typeof releaseThird, 'function', 'the weight:1 request must eventually resolve normally, never having thrown');

    releaseB();
    releaseThird();
  });

  test('a timeout-rejected exclusive waiter does not leave a stale high-priority queue entry that blocks normal-priority admission', async () => {
    // cap=2, one weight:1 high holder -> current=1, one unit still free.
    const releaseA = await acquireOnnxSlot('high', 1);

    // weight:3 > cap -> exclusive -> blocked by current>0 -> times out and
    // rejects. Its resolver MUST be removed from waitersHigh (removeFromQueue),
    // not left behind — release() is never called on this holder, so the only
    // way a stale entry gets cleared is the timeout path itself doing it.
    await assert.rejects(() => acquireOnnxSlot('high', 3), /timed out/i);

    // No release has happened. A normal-priority weight:1 fits under the cap
    // (1+1<=2) and must be admitted immediately — canAcquireNow's
    // normal-priority branch only refuses when `waitersHigh.length !== 0`, so
    // the ONLY thing that could block this acquisition is a stale entry left
    // behind in waitersHigh by the timed-out weight:3 request above. Without
    // removeFromQueue, this hangs; with it, it resolves immediately.
    const releaseB = await Promise.race([
      acquireOnnxSlot('normal', 1),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('normal-priority acquisition blocked — stale waiter left in waitersHigh')), 300),
      ),
    ]);
    assert.equal(typeof releaseB, 'function');

    releaseB();
    releaseA();
  });
});
