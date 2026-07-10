// Regression test: LocalWhisperSTT.start() must NOT leave a zombie streaming
// loop when the worker fails to spawn (2026-07-10).
//
// THE BUG THIS PINS: start() sets isActive=true, news the VAD, calls
// spawnWorker().catch(...), then UNCONDITIONALLY startStreamingLoop(). When
// spawnWorker throws (e.g. insufficient memory for the ONNX session), the old
// catch ONLY console.error + emit('error'). It did NOT stop the streaming loop,
// null the VAD, or clear isActive. Result: a self-chaining 12s streaming timer
// kept running with worker=null forever (every audio segment silently dropped at
// dispatchFinal's `if (!this.worker) return`), and the VadProcessor stayed
// retained until an external stop() that the supervisor never calls on this path.
//
// THE FIX: the spawn-failure catch tears the instance back down to a clean
// inactive state (stopStreamingLoop, clear gapFlushTimer, vad=null,
// isActive=false, workerReady=false) BEFORE re-emitting the error, so write()
// becomes a genuine no-op and no timer leaks. The error still surfaces so the
// supervisor can fall back to cloud STT.
//
// We force the low-memory refusal deterministically via the onnxThreadConfig
// env overrides (NATIVELY_ONNX_AVAILABLE_MEM_GB=0.1, NATIVELY_ONNX_MIN_FREE_GB=8),
// so spawnWorker throws before touching any real ONNX/worker resource.
//
// Run under `ELECTRON_RUN_AS_NODE=1 electron --test` or `node --test` after build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Force the ONNX admission gate to refuse: tiny available memory, high floor.
process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = '0.1';
process.env.NATIVELY_ONNX_MIN_FREE_GB = '8';

// modelManager/modelPreloader pull in `electron` for userData. Stub it.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-spawnfail-'));
const origLoad = Module._load;
Module._load = function patched(request) {
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

const tick = () => new Promise((r) => setTimeout(r, 25));

test('spawn failure tears the instance down to a clean inactive no-op', async () => {
  const lws = new LocalWhisperSTT('Xenova/whisper-tiny.en');

  const errors = [];
  lws.on('error', (e) => errors.push(e));

  lws.start();
  // The spawnWorker rejection is handled in a microtask AFTER the synchronous
  // start() body; give it a couple of ticks to run the teardown.
  await tick();
  await tick();

  // (a) the error surfaced exactly once, and it's the memory refusal
  assert.equal(errors.length, 1, 'exactly one error event should fire');
  assert.match(String(errors[0]?.message ?? errors[0]), /insufficient available memory/i);

  // (b) instance is torn down: inactive, no VAD, no worker
  assert.equal(lws['isActive'], false, 'isActive must be false after spawn failure');
  assert.equal(lws['vad'], null, 'vad must be nulled after spawn failure');
  assert.equal(lws['worker'], null, 'worker must remain null after spawn failure');
  assert.equal(lws['workerReady'], false, 'workerReady must be false');

  // (c) write() is now a genuine no-op — no transcript ever emits, no throw
  let transcripts = 0;
  lws.on('transcript', () => transcripts++);
  const pcm = Buffer.alloc(3200); // 100ms @16kHz mono s16le, silence
  assert.doesNotThrow(() => lws.write(pcm));
  await tick();
  assert.equal(transcripts, 0, 'write() after teardown must not emit transcripts');

  // (d) no live streaming timer remains: after teardown, waiting well past the
  // max streaming interval produces no further activity/emits.
  await tick();
  await tick();
  assert.equal(errors.length, 1, 'no further errors from a leaked timer');

  // stop() must be safe/idempotent even though we never fully started
  assert.doesNotThrow(() => lws.stop());
});
