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
import { EventEmitter } from 'events';
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

// The engine's fixed audio window. Imported from the built melFrontend rather
// than hardcoded, so these expectations track the real constant if it ever
// changes with a different export.
const { CHUNK_SAMPLES } = await import(
  pathToFileURL(path.join(distRoot, 'whisper/nemotron/melFrontend.js')).href
);

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

/**
 * Real EventEmitter-backed fake worker for tests that need
 * attachWorkerListeners()'s actual 'message'/'error'/'exit' handlers wired
 * up (e.g. to trigger the error-branch cursor rewind below).
 */
function makeEmitterFakeWorker() {
  const w = new EventEmitter();
  w.posted = [];
  w.postMessage = (msg) => w.posted.push(msg);
  w.removeAllListeners = EventEmitter.prototype.removeAllListeners.bind(w);
  return w;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

    // Deliberately NOT a multiple of CHUNK_SAMPLES — real VAD segments never
    // are, and the ragged remainder is the whole point of the alignment rule.
    const samples = new Float32Array(9000).fill(0.1);
    const worker = makeFakeWorker();
    wireActive(lws, worker, makeFakeVad(samples));

    lws['streamingTick']();

    assert.equal(worker.posted.length, 1);
    const msg = worker.posted[0];
    assert.equal(msg.type, 'transcribe');
    assert.equal(msg.streaming, true);
    assert.equal(msg.nemotronReset, true, 'first tick of a segment must set nemotronReset');
    // The payload is truncated to whole engine chunks. Shipping the ragged
    // 40-sample remainder too would be a no-op the engine just buffers, while
    // still costing a full worker round-trip that blocks the next dispatch.
    assert.equal(msg.audio.length, CHUNK_SAMPLES, 'first tick must send exactly one whole chunk, not the ragged buffer');
    assert.equal(msg.audio.length % CHUNK_SAMPLES, 0, 'payload must always be chunk-aligned');
    assert.equal(lws['nemotronSentSamples'], CHUNK_SAMPLES, 'cursor advances by what was SENT, so the remainder is retained');
  });

  test('a delta shorter than one engine chunk is HELD, not dispatched as a no-op', () => {
    // The regression this guards: gating on open.durationMs (the whole segment)
    // while sending a delta meant that once a segment passed the duration
    // threshold, every later tick fired with whatever sliver had accrued —
    // zero chunks processed, zero tokens returned, one wasted round-trip.
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    const worker = makeFakeWorker();

    const tick1 = new Float32Array(CHUNK_SAMPLES * 2).fill(0.1);
    wireActive(lws, worker, makeFakeVad(tick1));
    lws['streamingTick']();
    lws['streamingTaskInFlight'] = false;
    assert.equal(worker.posted.length, 1);

    // Segment grew, but by less than one chunk since the cursor.
    const grown = new Float32Array(CHUNK_SAMPLES * 2 + 500).fill(0.1);
    lws['vad'] = makeFakeVad(grown);
    lws['streamingTick']();

    assert.equal(worker.posted.length, 1, 'sub-chunk delta must not be dispatched');
    assert.equal(lws['nemotronSentSamples'], CHUNK_SAMPLES * 2, 'cursor must not advance on a held tick');
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
    // Still a DELTA, never the cumulative buffer — that is the invariant this
    // test exists for. It is now also chunk-aligned: tick 1 consumed one whole
    // chunk of the 9000 available, so 18000 - 8960 = 9040 is pending, of which
    // one whole chunk goes out and 80 samples stay behind the cursor.
    assert.ok(
      secondMsg.audio.length < tick2Samples.length,
      'second tick must send a delta, not the cumulative buffer',
    );
    assert.equal(secondMsg.audio.length, CHUNK_SAMPLES, 'second tick sends one whole chunk');
    assert.equal(lws['nemotronSentSamples'], CHUNK_SAMPLES * 2);
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
    // The tail is everything the streaming loop never sent — which now includes
    // the ragged remainder the alignment rule held back (9000 - 8960 = 40),
    // so 12000 - 8960 = 3040. Every sample reaches the engine exactly once:
    // none dropped, none sent twice.
    assert.equal(
      finalMsg.audio.length,
      fullSegment.length - CHUNK_SAMPLES,
      'dispatchFinal must send exactly the samples streaming left behind, including the held-back remainder',
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

  // ── Self-healing cursor rewind (fix round 1, advisor-flagged gap) ──────
  //
  // The delta scheme is NOT self-healing like the old cumulative one: if a
  // dispatched delta never reaches (or never returns from) the engine — a
  // wedged worker (this repo has a whole test file about that failure mode:
  // LocalWhisperStuckWorker.test.mjs) or a worker-side 'error' on the
  // in-flight streaming task — nemotronSentSamples has already been
  // optimistically advanced past audio the engine never actually decoded.
  // Without a rewind, every subsequent tick's delta silently starts past a
  // gap of lost audio. Both recovery paths (watchdog force-clear, matching-
  // taskId error) must reset the cursor to 0 so the next tick resends the
  // full open segment with nemotronReset:true.

  test('watchdog force-clear rewinds nemotronSentSamples to 0', async () => {
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    lws['nemotronSentSamples'] = 5000;
    lws['streamingTaskInFlight'] = true;
    lws['streamingTaskId'] = 's1';
    // The watchdog-fire path emits('error', ...) on this EventEmitter
    // subclass — Node throws synchronously on an 'error' emit with zero
    // listeners, so a real consumer's listener must be present (matches
    // production: LocalWhisperSTT.start()'s caller always listens).
    lws.on('error', () => {});
    // Speed the real 30s watchdog up for the test — it's a plain mutable
    // static field on the compiled class (TS `readonly`/`private` are
    // erased at runtime).
    const ctor = lws.constructor;
    const original = ctor.STREAMING_WATCHDOG_MS;
    ctor.STREAMING_WATCHDOG_MS = 10;
    try {
      lws['armStreamingWatchdog']();
      await sleep(60);
      assert.equal(lws['nemotronSentSamples'], 0, 'watchdog fire must rewind the cursor');
      assert.equal(lws['streamingTaskInFlight'], false);
    } finally {
      ctor.STREAMING_WATCHDOG_MS = original;
    }
  });

  test('a worker error on the in-flight streaming task rewinds nemotronSentSamples to 0', () => {
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    const worker = makeEmitterFakeWorker();
    lws['isActive'] = true;
    lws['workerReady'] = true;
    lws['worker'] = worker;
    lws['attachWorkerListeners']();

    lws['nemotronSentSamples'] = 7000;
    lws['streamingTaskInFlight'] = true;
    lws['streamingTaskId'] = 's7';

    worker.emit('message', { type: 'error', taskId: 's7', message: 'simulated worker fault' });

    assert.equal(lws['nemotronSentSamples'], 0, 'a streaming-task error must rewind the cursor');
    assert.equal(lws['streamingTaskInFlight'], false);
    assert.equal(lws['streamingTaskId'], null);
  });

  test('regression: non-Nemotron models are unaffected by the rewind paths (no such field to reset)', async () => {
    lws = new LocalWhisperSTT('Xenova/whisper-tiny.en');
    lws['streamingTaskInFlight'] = true;
    lws['streamingTaskId'] = 's1';
    lws.on('error', () => {}); // see the previous test's comment
    const ctor = lws.constructor;
    const original = ctor.STREAMING_WATCHDOG_MS;
    ctor.STREAMING_WATCHDOG_MS = 10;
    try {
      lws['armStreamingWatchdog']();
      await sleep(60);
      // Non-Nemotron: nemotronSentSamples stays at its default 0 the whole
      // time (never advanced in the first place) — nothing to regress.
      assert.equal(lws['nemotronSentSamples'], 0);
      assert.equal(lws['streamingTaskInFlight'], false);
    } finally {
      ctor.STREAMING_WATCHDOG_MS = original;
    }
  });

  // ── pendingAudio drop-oldest reset-flag desync (Task 10 fix round 2) ────
  //
  // dispatchFinal's not-yet-ready branch queues finals in `pendingAudio`
  // (a 500-item cap). When full, the oldest item is dropped (shift()) before
  // the new one is pushed. If the dropped item carried nemotronReset:true —
  // the segment-boundary signal that would have re-synced NemotronEngine's
  // cache state before replaying the backlog — losing it silently means
  // flushPending() would later decode against stale cache state for a
  // segment the engine never actually reset for. The fix carries a dropped
  // reset flag forward onto the new head instead of discarding it.
  //
  // Pre-filling `pendingAudio` directly via bracket access (rather than
  // driving 500 real dispatchFinal calls) follows this file's own seam
  // pattern (LocalWhisperStuckWorker.test.mjs's private-field access) and
  // keeps the test fast and deterministic.

  test('dispatchFinal drop-oldest path carries a dropped nemotronReset:true flag forward onto the new head', () => {
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    const worker = makeFakeWorker();
    lws['isActive'] = true;
    lws['worker'] = worker;
    // workerReady stays false (default) — dispatchFinal must take the
    // pendingAudio queueing branch, not send to the worker directly.

    const MAX_PENDING = 500;
    const pending = [];
    for (let i = 0; i < MAX_PENDING; i++) {
      // Only the OLDEST item (index 0, about to be shift()'d off) carries
      // the reset signal.
      pending.push({ audio: new Float32Array(1), nemotronReset: i === 0 });
    }
    lws['pendingAudio'] = pending;
    // Simulate streaming already having sent some samples, so THIS final's
    // own (freshly computed) nemotronReset is false — isolating the
    // assertion below to the carried-forward flag, not a coincidental true
    // from this dispatch itself.
    lws['nemotronSentSamples'] = 5;

    const newSegment = new Float32Array(20).fill(0.5);
    lws['dispatchFinal'](newSegment);

    assert.equal(worker.posted.length, 0, 'worker must not receive anything directly while not ready — the item stays queued');
    assert.equal(lws['pendingAudio'].length, MAX_PENDING, 'queue must stay capped at MAX_PENDING');
    assert.equal(
      lws['pendingAudio'][0].nemotronReset,
      true,
      'the dropped item\'s nemotronReset:true must be carried forward onto the new head, not lost',
    );
    const last = lws['pendingAudio'][MAX_PENDING - 1];
    assert.equal(last.nemotronReset, false, 'the newly queued final\'s own reset flag is unaffected (computed independently)');
    assert.equal(last.audio.length, newSegment.length - 5, 'the newly queued final still carries only its own delta tail');
  });

  test('dispatchFinal drop-oldest path is a no-op on the new head when the dropped item did not carry a reset flag', () => {
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    const worker = makeFakeWorker();
    lws['isActive'] = true;
    lws['worker'] = worker;

    const MAX_PENDING = 500;
    const pending = [];
    for (let i = 0; i < MAX_PENDING; i++) {
      pending.push({ audio: new Float32Array(1), nemotronReset: false });
    }
    lws['pendingAudio'] = pending;
    lws['nemotronSentSamples'] = 5;

    const newSegment = new Float32Array(20).fill(0.5);
    lws['dispatchFinal'](newSegment);

    assert.equal(lws['pendingAudio'].length, MAX_PENDING);
    assert.equal(
      lws['pendingAudio'][0].nemotronReset,
      false,
      'no reset flag was dropped, so the new head must not be spuriously flipped to true',
    );
  });

  test('regression: non-Nemotron drop-oldest path is unaffected (nemotronReset is always false for other models)', () => {
    lws = new LocalWhisperSTT('Xenova/whisper-tiny.en');
    const worker = makeFakeWorker();
    lws['isActive'] = true;
    lws['worker'] = worker;

    const MAX_PENDING = 500;
    const pending = [];
    for (let i = 0; i < MAX_PENDING; i++) {
      pending.push({ audio: new Float32Array(1), nemotronReset: false });
    }
    lws['pendingAudio'] = pending;

    const newSegment = new Float32Array(20).fill(0.5);
    lws['dispatchFinal'](newSegment);

    assert.equal(lws['pendingAudio'].length, MAX_PENDING);
    assert.equal(lws['pendingAudio'][0].nemotronReset, false);
    assert.equal(
      lws['pendingAudio'][MAX_PENDING - 1].audio.length,
      newSegment.length,
      'non-Nemotron finals still queue the FULL segment (no delta slicing)',
    );
  });
});
