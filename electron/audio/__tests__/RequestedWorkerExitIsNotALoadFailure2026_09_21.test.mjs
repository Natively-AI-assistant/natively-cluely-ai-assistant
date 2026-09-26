// electron/audio/__tests__/RequestedWorkerExitIsNotALoadFailure2026_09_21.test.mjs
//
// Live-reproduced 2026-09-21 (real worker): an idle, clean stop() with nothing in
// flight and zero errors wrote a persisted MODEL LOAD FAILURE 5 seconds later,
// and the next launch logged "Skipping preload ... recent failure cooldown".
//
//   stop() -> beginWorkerTermination() keeps the 'exit' listener and, after a 5s
//   grace, calls worker.terminate(). node:worker_threads reports exit code 1 for
//   ANY terminated worker, and the exit handler treated every non-zero code as a
//   crash: recordLoadFailure() -> userData/whisper-recent-failures.json (5 min).
//
// So every normal meeting end cost the next launch its warm start. The same late
// exit also ran the crash cleanup against whatever session was CURRENT by then:
// it released `this.slotRelease` and cleared `workerReady`, which after a
// restart within those 5s belong to the NEW worker.
//
// Observable used here is the real one: the persisted cooldown file. Executes
// the compiled exit handler with a fake worker (no ONNX needed — the handler is
// plain main-thread JS). Platform-independent: worker_threads semantics, no OS API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { EventEmitter } from 'events';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'requested-exit-'));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { getPath: (k) => (k === 'userData' ? userData : os.tmpdir()), isReady: () => true } };
  }
  return origLoad.apply(this, arguments);
};

// Read once at import: lets the give-up path below run for real in ~60ms.
process.env.NATIVELY_LOCAL_STT_READY_TIMEOUT_MS = '60';

const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const { LocalWhisperSTT } = await import(pathToFileURL(path.join(distRoot, 'LocalWhisperSTT.js')).href);

const MODEL = 'Xenova/whisper-tiny.en';
const cooldownFile = path.join(userData, 'whisper-recent-failures.json');
const cooldownHas = (id) => {
  try { return Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(cooldownFile, 'utf8')), id); } catch { return false; }
};
const fakeWorker = () => { const w = new EventEmitter(); w.terminate = () => Promise.resolve(1); w.postMessage = () => {}; return w; };

/** An instance wired to a fake worker exactly as spawnWorker leaves it. */
function live() {
  try { fs.unlinkSync(cooldownFile); } catch {}
  const lws = new LocalWhisperSTT(MODEL);
  const errors = [];
  lws.on('error', (e) => errors.push(e));
  const w = fakeWorker();
  lws['isActive'] = true;
  lws['worker'] = w;
  lws['workerReady'] = true;
  lws['attachWorkerListeners']();
  return { lws, w, errors };
}

test('a termination WE requested is not a model load failure, and is not an error', () => {
  const { lws, w, errors } = live();
  lws['beginWorkerTermination'](w);     // what stop() does
  w.emit('exit', 1);                    // what terminate() produces
  assert.equal(cooldownHas(MODEL), false, 'BUG: a clean stop armed the persisted 5-minute preload cooldown');
  assert.equal(errors.length, 0);
});

test('an UNREQUESTED worker death is still recorded (the guard must not swallow real crashes)', () => {
  const { w } = live();
  w.emit('exit', 1);                    // nobody asked for this
  assert.equal(cooldownHas(MODEL), true, 'a real crash must still arm the cooldown');
});

test('a late requested exit does not tear down the session that replaced it', () => {
  const { lws, w } = live();
  lws['beginWorkerTermination'](w);
  // Restart on the same instance within the 5s terminate grace:
  const next = fakeWorker();
  let newSlotReleased = 0;
  lws['worker'] = next;
  lws['workerReady'] = true;
  lws['slotRelease'] = () => { newSlotReleased++; };
  w.emit('exit', 1);                    // the OLD worker finally exits
  assert.equal(newSlotReleased, 0, "BUG: the old worker's exit released the NEW session's ONNX slot");
  assert.equal(lws['workerReady'], true, "BUG: the old worker's exit marked the NEW session not ready");
});

test('a model that never finishes loading is STILL recorded, on purpose now rather than by accident', async () => {
  const { lws, w, errors } = live();
  lws['workerReady'] = false;                 // still loading
  lws['armWorkerReadyDeadline']();
  await new Promise((r) => setTimeout(r, 160)); // past the 60ms deadline
  assert.equal(errors.length, 1, 'the give-up surfaces exactly one error');
  assert.equal(errors[0].code, 'local_stt_unavailable');
  w.emit('exit', 1);                          // its requested terminate() lands
  assert.equal(cooldownHas(MODEL), true, 'REGRESSION: a model that outran the whole load deadline would be preloaded again at next launch');
  assert.equal(errors.length, 1, 'and the requested exit adds no second error');
});
