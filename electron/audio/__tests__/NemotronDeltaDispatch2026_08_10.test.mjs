// electron/audio/__tests__/NemotronDeltaDispatch2026_08_10.test.mjs
//
// Task 10 fix round 1: LocalWhisperSTT's streaming loop was written for
// stateless models (Whisper/Moonshine) — every tick re-sends the ENTIRE
// cumulative open-segment buffer. NemotronEngine (Task 7) is stateful:
// pushAudio() appends to an internal ring buffer and advances RNNT
// encoder/decoder cache state monotonically. Re-sending the same prefix
// every tick meant the SAME audio got pushed through the cache-aware
// encoder repeatedly — duplicated/garbled transcript text and O(N^2) cost.
//
// This test pins the delta-dispatch fix directly on the compiled class,
// following the same private-field/private-method access pattern as
// LocalWhisperStuckWorker.test.mjs (compiled JS has no real privacy, and
// LocalWhisperSTT can't be driven end-to-end here without a real worker /
// downloaded model). Non-Nemotron models are asserted unaffected (still
// send the full cumulative buffer every tick) as a regression guard.
//
// Run: npm test (globs electron/audio/__tests__/**/*.test.mjs), or directly:
// ELECTRON_RUN_AS_NODE=1 electron --test electron/audio/__tests__/NemotronDeltaDispatch2026_08_10.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// LocalWhisperSTT pulls in `electron` transitively via modelManager /
// modelPreloader for getModelsDir() / app.getPath('userData').
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nemotron-delta-'));
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (k) => (k === 'userData' ? userData : os.tmpdir()),
        isReady: () => true,
      },
    };
  }
  return origLoad.apply(this, arguments);
};

const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const { LocalWhisperSTT } = await import(
  pathToFileURL(path.join(distRoot, 'LocalWhisperSTT.js')).href
);

const NEMOTRON_MODEL_ID = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';

/** Minimal fake VAD stub — only the surface streamingTick()/dispatchFinal() touch. */
function makeFakeVad(samples) {
  return {
    isInSpeech: () => true,
    peekOpenSegment: () => ({
      samples,
      durationMs: (samples.length / 16000) * 1000,
    }),
  };
}

/** Minimal fake worker — only postMessage, collecting every call. */
function makeFakeWorker() {
  const posted = [];
  return {
    posted,
    postMessage: (msg) => posted.push(msg),
  };
}

function wireActive(lws, worker, vad) {
  lws['isActive'] = true;
  lws['workerReady'] = true;
  lws['worker'] = worker;
  lws['vad'] = vad;
}

// armStreamingWatchdog() schedules a real 30s setTimeout on the instance.
// Clear it after each test so the test process can exit promptly.
function cleanupWatchdog(lws) {
  lws['clearStreamingWatchdog']();
}

describe('Nemotron delta-dispatch (Task 10 fix round 1)', () => {
  let lws;

  afterEach(() => {
    if (lws) cleanupWatchdog(lws);
  });

  test('first streamingTick of a segment sends the FULL buffer with nemotronReset=true', () => {
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    assert.equal(lws['isNemotronModel'], true, 'model id must be classified as Nemotron');

    const samples = new Float32Array(9000).fill(0.1);
    const worker = makeFakeWorker();
    wireActive(lws, worker, makeFakeVad(samples));

    lws['streamingTick']();

    assert.equal(worker.posted.length, 1);
    const msg = worker.posted[0];
    assert.equal(msg.type, 'transcribe');
    assert.equal(msg.streaming, true);
    assert.equal(msg.nemotronReset, true, 'first tick of a segment must set nemotronReset');
    assert.equal(msg.audio.length, samples.length, 'first tick must send the full buffer');
    assert.equal(lws['nemotronSentSamples'], samples.length);
  });

  test('second streamingTick sends only the DELTA with nemotronReset=false', () => {
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    const worker = makeFakeWorker();

    // Tick 1: segment has 9000 samples.
    const tick1Samples = new Float32Array(9000).fill(0.1);
    wireActive(lws, worker, makeFakeVad(tick1Samples));
    lws['streamingTick']();
    lws['streamingTaskInFlight'] = false; // simulate the worker having replied

    // Tick 2: the open segment has grown to 18000 samples (9000 new).
    const tick2Samples = new Float32Array(18000).fill(0.2);
    lws['vad'] = makeFakeVad(tick2Samples);
    lws['streamingTick']();

    assert.equal(worker.posted.length, 2);
    const secondMsg = worker.posted[1];
    assert.equal(secondMsg.nemotronReset, false, 'second tick must NOT reset');
    assert.equal(
      secondMsg.audio.length,
      tick2Samples.length - tick1Samples.length,
      'second tick must send only the delta (9000 new samples), not the cumulative 18000',
    );
    assert.equal(lws['nemotronSentSamples'], tick2Samples.length);
  });

  test('dispatchFinal sends only the untick\'d tail and resets the cursor to 0', () => {
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    const worker = makeFakeWorker();

    // Simulate tick 1 having already sent 9000 samples.
    const tick1Samples = new Float32Array(9000).fill(0.1);
    wireActive(lws, worker, makeFakeVad(tick1Samples));
    lws['streamingTick']();
    lws['streamingTaskInFlight'] = false;

    // VAD closes the segment at 12000 total samples (3000 samples beyond
    // what streaming already sent).
    const fullSegment = new Float32Array(12000).fill(0.3);
    lws['dispatchFinal'](fullSegment);

    assert.equal(worker.posted.length, 2, 'dispatchFinal must post exactly one more transcribe message');
    const finalMsg = worker.posted[1];
    assert.equal(finalMsg.streaming, false);
    assert.equal(finalMsg.nemotronReset, false, 'mid-segment final must not reset (tick 1 already reset)');
    assert.equal(
      finalMsg.audio.length,
      fullSegment.length - tick1Samples.length,
      'dispatchFinal must send only the tail beyond what streaming already sent',
    );
    assert.equal(lws['nemotronSentSamples'], 0, 'cursor must reset to 0 at the segment boundary');
  });

  test('a short segment closed before any streaming tick sends the WHOLE segment with nemotronReset=true', () => {
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    const worker = makeFakeWorker();
    lws['isActive'] = true;
    lws['workerReady'] = true;
    lws['worker'] = worker;

    const shortSegment = new Float32Array(4000).fill(0.4);
    lws['dispatchFinal'](shortSegment);

    assert.equal(worker.posted.length, 1);
    const msg = worker.posted[0];
    assert.equal(msg.nemotronReset, true, 'nemotronSentSamples was 0, so this is effectively a fresh segment');
    assert.equal(msg.audio.length, shortSegment.length);
    assert.equal(lws['nemotronSentSamples'], 0);
  });

  test('regression: non-Nemotron models keep sending the FULL cumulative buffer every tick (unchanged)', () => {
    lws = new LocalWhisperSTT('Xenova/whisper-tiny.en');
    assert.equal(lws['isNemotronModel'], false);
    const worker = makeFakeWorker();

    const tick1Samples = new Float32Array(20000).fill(0.1);
    wireActive(lws, worker, makeFakeVad(tick1Samples));
    lws['streamingTick']();
    lws['streamingTaskInFlight'] = false;

    const tick2Samples = new Float32Array(40000).fill(0.2);
    lws['vad'] = makeFakeVad(tick2Samples);
    lws['streamingTick']();

    assert.equal(worker.posted.length, 2);
    const firstMsg = worker.posted[0];
    const secondMsg = worker.posted[1];
    // Non-Nemotron messages must not carry a truthy nemotronReset, and each
    // tick must carry the FULL cumulative buffer (not a delta).
    assert.ok(!firstMsg.nemotronReset);
    assert.ok(!secondMsg.nemotronReset);
    assert.equal(firstMsg.audio.length, tick1Samples.length);
    assert.equal(secondMsg.audio.length, tick2Samples.length, 'non-Nemotron ticks must still send the full cumulative buffer');
  });
});
