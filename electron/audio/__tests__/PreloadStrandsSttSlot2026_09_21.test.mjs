// electron/audio/__tests__/PreloadStrandsSttSlot2026_09_21.test.mjs
//
// Live-reproduced 2026-09-21 on a real-worker, single-bundle harness (two
// channels, real ONNX, real speech): a meeting that starts while the
// launch-time preload is STILL LOADING loses its system-audio channel for the
// whole meeting.
//
//   preload()            -> loading worker takes high slot 1/2
//   mic.start()          -> takeWarmWorker() === null (only a FINISHED load is
//                           handed off) -> cold start takes slot 2/2
//   system.start()       -> takeWarmWorker() === null -> waits on the gate
//   preload finishes     -> goes warm and keeps slot 1 FOREVER: both channels
//                           are already past takeWarmWorker, nobody will claim it
//   +20s                 -> system: "no ONNX session slot became free" -> failed
//
// The invariant: a worker the preloader holds that no live channel has claimed
// must never outrank a live channel that is starving for a slot. It yields ONLY
// when the STT budget is actually exhausted — in per-channel mode the system
// channel can start first, and killing the warm mic-model worker then would
// throw away a good warm start for nothing.
//
// Executes the REAL gate (globalThis semaphore, shared across bundles by design)
// and the REAL preloader. Platform-independent: worker_threads + a JS semaphore,
// no OS API on this path, so macOS and Windows run identical code here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { EventEmitter } from 'events';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'preload-strand-'));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { getPath: (k) => (k === 'userData' ? userData : os.tmpdir()), isReady: () => true } };
  }
  return origLoad.apply(this, arguments);
};

const dist = path.resolve(__dirname, '../../../dist-electron/electron');
const { modelPreloader } = await import(pathToFileURL(path.join(dist, 'audio/whisper/modelPreloader.js')).href);
const gate = await import(pathToFileURL(path.join(dist, 'utils/onnxThreadConfig.js')).href);

const MODEL = 'onnx-community/moonshine-base-ONNX';

function fakeWorker() {
  const w = new EventEmitter();
  w.terminated = 0;
  w.terminate = () => { w.terminated++; return Promise.resolve(1); };
  return w;
}

/** Put the preloader in the state preload() leaves it in, holding a REAL slot. */
async function preloaderHolds(state /* 'loading' | 'warm' */, modelId = MODEL) {
  gate.__resetOnnxGateForTests();
  modelPreloader.recentFailures = new Map();
  modelPreloader.warmWorker = null; modelPreloader.warmModelId = null;
  modelPreloader.loadingWorker = null; modelPreloader.pendingModelId = null; modelPreloader.loading = false;
  modelPreloader.unwantedLoadingWorker = null;
  const release = await gate.acquireOnnxSlot('high', 1);
  const w = fakeWorker();
  let held = release;
  w.__slotRelease = () => { if (held) { held(); held = null; } };
  // The preloader's own listeners, as preload() attaches them: a non-zero exit
  // is recorded as a LOAD FAILURE (5-minute persisted cooldown).
  w.on('exit', (code) => { if (code !== 0) modelPreloader.recordLoadFailure(modelId); w.__slotRelease(); });
  if (state === 'loading') { modelPreloader.loadingWorker = w; modelPreloader.pendingModelId = modelId; modelPreloader.loading = true; }
  else { modelPreloader.warmWorker = w; modelPreloader.warmModelId = modelId; }
  return w;
}

test('RED STATE: an unclaimed preload worker + one live channel exhausts the STT budget, and the next channel starves', async () => {
  await preloaderHolds('loading');
  const mic = await gate.acquireOnnxSlot('high', 1);           // the mic channel's cold start
  assert.equal(gate.isHighPriorityOnnxBudgetExhausted(), true, 'preload(1) + mic(1) = the whole default budget of 2');
  await assert.rejects(
    gate.acquireOnnxSlotWithin('high', 1, 150, 'system'),
    /no ONNX session slot became free/,
    'this is the 20s failure the system channel hit live',
  );
  mic();
});

test('MODEL SWITCH: a starving live channel makes the preloader yield its idle WARM worker at once', async () => {
  const w = await preloaderHolds('warm');
  const mic = await gate.acquireOnnxSlot('high', 1);
  assert.equal(modelPreloader.yieldUnclaimedWorkerIfStarving(), 'yielded');
  assert.equal(w.terminated, 1, 'an idle warm worker has never run a transcribe: safe to terminate');
  assert.equal(gate.isHighPriorityOnnxBudgetExhausted(), false, 'its slot is released immediately, not on a later exit event');
  const system = await gate.acquireOnnxSlotWithin('high', 1, 150, 'system'); // no longer starves
  assert.equal(modelPreloader.isWarm(MODEL), false);
  // terminate() exits non-zero. A teardown we asked for is NOT a model load failure:
  w.emit('exit', 1);
  assert.equal(modelPreloader.recentFailures.has(MODEL), false, 'BUG: a requested yield armed the 5-minute preload cooldown');
  mic(); system();
});

test('PRELOAD RACE: a LOADING worker is NEVER terminated — that aborted the whole app (SIGABRT) on real workers', async () => {
  // The first version of this fix called terminate() here. Every fake-worker
  // test passed; the real-worker run died with Napi::Error -> SIGABRT because
  // the worker was inside the native ONNX session create. Do not "simplify"
  // this back: a fake worker cannot show you the crash.
  const w = await preloaderHolds('loading');
  const mic = await gate.acquireOnnxSlot('high', 1);
  assert.equal(modelPreloader.yieldUnclaimedWorkerIfStarving(), 'deferred');
  assert.equal(w.terminated, 0, 'BUG: terminate() during a native model load kills the Electron process');
  assert.equal(gate.isHighPriorityOnnxBudgetExhausted(), true, 'it keeps its slot while loading, so the cap on concurrent native sessions still holds');
  assert.strictEqual(modelPreloader.unwantedLoadingWorker, w, 'marked for release when its load finishes');
  assert.strictEqual(modelPreloader.loadingWorker, w, 'still tracked as loading');
  assert.equal(modelPreloader.yieldUnclaimedWorkerIfStarving(), 'deferred', 'asking again (second channel) is idempotent');
  assert.equal(w.terminated, 0);
  mic(); w.__slotRelease();
});

test('the deferred release happens from the preloader\'s own ready handler (source assertion; executed on the real-worker harness)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../whisper/modelPreloader.ts'), 'utf8');
  const ready = src.slice(src.indexOf("if (msg.type === 'ready') {"), src.indexOf('console.log(`[ModelPreloader] Worker warm for'));
  assert.match(ready, /if \(this\.unwantedLoadingWorker === w\) \{/);
  assert.match(ready, /this\.disposeIdleWorker\(w\);\s*return;/, 'must not go warm: a warm worker nobody can take is the original bug');
  assert.match(ready, /this\.loading = false;/, 'a later preload() must not be blocked by a stale loading flag');
});

test('it does NOT yield while the budget still has room (per-channel mode: system starts first, mic still wants its warm worker)', async () => {
  const w = await preloaderHolds('warm');
  assert.equal(gate.isHighPriorityOnnxBudgetExhausted(), false, 'preload(1) alone leaves one slot');
  assert.equal(modelPreloader.yieldUnclaimedWorkerIfStarving(), 'none');
  assert.equal(w.terminated, 0, 'the warm worker survives');
  assert.strictEqual(modelPreloader.takeWarmWorker(MODEL), w, 'and the mic channel can still take it');
});

test('it is a no-op when the preloader holds nothing (worker already handed off)', async () => {
  const w = await preloaderHolds('warm');
  assert.strictEqual(modelPreloader.takeWarmWorker(MODEL), w);
  const other = await gate.acquireOnnxSlot('high', 1);
  assert.equal(gate.isHighPriorityOnnxBudgetExhausted(), true);
  assert.equal(modelPreloader.yieldUnclaimedWorkerIfStarving(), 'none', 'a handed-off worker belongs to its channel now');
  assert.equal(w.terminated, 0, 'must never terminate a worker a live channel owns');
  other(); w.__slotRelease();
});

test('a slot that arrives AFTER its worker was given up goes straight back (no permanently lost STT slot)', async () => {
  // Written with the fix: the old code had no seam to call. It documents the
  // contract: the acquisition resolves asynchronously, so a worker can be
  // released (yielded / cancelled / crashed) while its slot is still queued.
  gate.__resetOnnxGateForTests();
  const a = await gate.acquireOnnxSlot('high', 1);
  const b = await gate.acquireOnnxSlot('high', 1);           // budget full: the preload's acquire must queue
  const w = fakeWorker();
  modelPreloader.attachSlotToWorker(w, gate.acquireOnnxSlot('high', 1));
  w.__slotRelease();                                          // given up BEFORE the slot arrived
  a();                                                        // now the queued acquire resolves
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(gate.isHighPriorityOnnxBudgetExhausted(), false, 'BUG: the late slot was attached to a dead worker and held forever');
  const next = await gate.acquireOnnxSlotWithin('high', 1, 150, 'next-meeting');
  b(); next();
});

test('WIRING (source assertion, behaviour is covered above + by the live harness): the cold path yields before it waits', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../LocalWhisperSTT.ts'), 'utf8');
  const cold = src.slice(src.indexOf('const generation = ++this.spawnGeneration;'), src.indexOf('Cold-starting worker for'));
  const iYield = cold.indexOf('modelPreloader.yieldUnclaimedWorkerIfStarving()');
  const iWait = cold.indexOf('acquireOnnxSlotWithin(');
  assert.ok(iYield >= 0, 'the cold start must ask the preloader to yield');
  assert.ok(iYield < iWait, 'and it must do so BEFORE waiting on the gate, or the wait still times out');
});
