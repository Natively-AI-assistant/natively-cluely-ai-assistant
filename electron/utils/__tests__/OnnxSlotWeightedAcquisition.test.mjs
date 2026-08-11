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
});
