// electron/utils/__tests__/OnnxSlotBoundedWait2026_09_11.test.mjs
//
// Live-reproduced 2026-09-11 (isolated profile, per-channel local parakeet STT,
// local embedding + reranker loaded): the interviewer channel never logged
// "Cold-starting worker" and transcribed nothing for a 10-minute meeting.
// Cause: LocalWhisperSTT.spawnWorker awaited acquireOnnxSlot('high') with no
// deadline while the embedding and reranker workers held both slots of the
// default cap for the app lifetime. Nothing logged, nothing surfaced.
//
// acquireOnnxSlotWithin turns that into a rejection with an actionable message,
// and a slot arriving after the deadline is released at once so the abandoned
// waiter can never leak the gate.
//
// Run: ELECTRON_RUN_AS_NODE=1 electron --test (after npm run build:electron).

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/utils/onnxThreadConfig.js')
).href;
const { acquireOnnxSlot, acquireOnnxSlotWithin, describeOnnxGate, __resetOnnxGateForTests } = await import(MODULE_URL);

process.env.NATIVELY_ONNX_MAX_CONCURRENT_SESSIONS = '1';
// STT channels draw on their own budget; make it 1 so ONE high-priority holder
// fills it and the next high-priority request has to wait.
process.env.NATIVELY_ONNX_HIGH_PRIORITY_SESSIONS = '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('bounded ONNX slot acquisition', () => {
  beforeEach(() => { __resetOnnxGateForTests(); });

  test('rejects with an actionable message when the STT budget is already held', async () => {
    const releaseHolder = await acquireOnnxSlot('high', 1); // the other STT channel, in effect
    await assert.rejects(
      acquireOnnxSlotWithin('high', 1, 120, 'LocalWhisperSTT/system'),
      (err) => {
        assert.match(err.message, /LocalWhisperSTT\/system: no ONNX session slot became free within 120ms/);
        assert.match(err.message, /1\/1 high-priority \(STT\) sessions in use/);
        assert.match(err.message, /cloud STT provider/);
        return true;
      },
    );
    releaseHolder();
  });

  test('a slot freed after the deadline is released immediately — the abandoned waiter never leaks the gate', async () => {
    const releaseHolder = await acquireOnnxSlot('high', 1);
    await assert.rejects(acquireOnnxSlotWithin('high', 1, 80, 'late'));
    releaseHolder(); // the abandoned waiter would now be handed the slot
    await sleep(20);
    // If the late slot had been kept, this fresh request would hang past its deadline.
    const release = await acquireOnnxSlotWithin('high', 1, 300, 'fresh');
    assert.equal(typeof release, 'function');
    assert.match(describeOnnxGate(), /1\/1 high-priority \(STT\) sessions in use/);
    release();
    assert.match(describeOnnxGate(), /0\/1 high-priority \(STT\) sessions in use/);
  });

  test('a background holder does NOT block an STT channel: the pools are disjoint', async () => {
    const releaseEmbedder = await acquireOnnxSlot('normal', 1); // fills the background cap of 1
    const t0 = Date.now();
    const releaseStt = await acquireOnnxSlotWithin('high', 1, 1000, 'LocalWhisperSTT/mic');
    assert.ok(Date.now() - t0 < 200, 'the STT channel must be admitted immediately despite the full background cap');
    assert.match(describeOnnxGate(), /1\/1 background ONNX sessions and 1\/1 high-priority/);
    releaseStt();
    releaseEmbedder();
  });

  test('resolves promptly when a slot is free', async () => {
    const t0 = Date.now();
    const release = await acquireOnnxSlotWithin('high', 1, 1000, 'free');
    assert.ok(Date.now() - t0 < 200);
    release();
  });

  test('source: LocalWhisperSTT cold start uses the bounded acquire, never the unbounded one', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../audio/LocalWhisperSTT.ts'), 'utf8');
    assert.match(src, /acquireOnnxSlotWithin\(\s*'high',\s*1,\s*LocalWhisperSTT\.ONNX_SLOT_WAIT_MS/);
    assert.doesNotMatch(src, /\bacquireOnnxSlot\(/, 'an unbounded acquire would silently dead-end a channel again');
  });

  test('source: the Nemotron shared-worker cold start is bounded too', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../audio/whisper/nemotron/sharedWorkerRegistry.ts'), 'utf8');
    assert.match(src, /acquireOnnxSlotWithin\('high', 1, 20_000, 'sharedWorkerRegistry\/nemotron'\)/);
    assert.doesNotMatch(src, /await acquireOnnxSlot\(/, 'the bare unbounded await must be gone (prose mentions in comments are fine)');
  });
});
