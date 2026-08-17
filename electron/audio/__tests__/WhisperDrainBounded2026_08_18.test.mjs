// F-205 regression test (audit/autopilot-2026-08-18).
//
// stop() keeps the whisper worker alive while finals drain. Every release
// path from there is worker-reply-driven, and dispatchFinal() clears the
// streaming watchdog — so nothing bounded the drain. A worker wedged in ONNX
// inference kept this.slotRelease held forever; acquireOnnxSlot is an
// unbounded semaphore with no timeout, so the next meeting's spawnWorker
// awaited it for the rest of the app session with no 'error' and no banner,
// taking the local embedder / reranker / intent classifier down with it.
// Reproduced in scripts/audit/F-205-repro.mjs (slot never released pre-fix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { isPackaged: false, getAppPath: () => '/tmp/fake', isReady: () => false, getPath: () => '/tmp' } };
  }
  if (request.endsWith('.node') || request.includes('native-module')) return {};
  return origLoad.apply(this, arguments);
};

const { LocalWhisperSTT } = await import(path.join(distRoot, 'LocalWhisperSTT.js'));

function wedgedDrain() {
  const stt = new LocalWhisperSTT('Xenova/whisper-tiny');
  stt.on('error', () => {});
  const worker = new EventEmitter();
  worker.postMessage = () => {};
  worker.terminate = () => {};
  const state = { released: false };
  stt.worker = worker;
  stt.slotRelease = () => { state.released = true; };
  stt.isActive = true;
  stt.vad = null;
  stt.isDrainingFinals = true;
  stt.drainingFinalsInFlight = 1;
  stt.pendingAudio = [];
  return { stt, state };
}

test('a wedged final drain is bounded and releases the shared ONNX slot', async () => {
  const prev = LocalWhisperSTT.DRAIN_WATCHDOG_MS;
  assert.equal(typeof prev, 'number', 'DRAIN_WATCHDOG_MS bound must exist (F-205)');
  LocalWhisperSTT.DRAIN_WATCHDOG_MS = 200;
  try {
    const { stt, state } = wedgedDrain();
    stt.stop();
    assert.equal(state.released, false, 'the slot must NOT be dropped while the drain is legitimately in progress');
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(state.released, true,
      'a worker that never replies must not hold the shared ONNX slot forever — the next meeting would await it for the whole session (F-205)');
  } finally {
    LocalWhisperSTT.DRAIN_WATCHDOG_MS = prev;
  }
});
