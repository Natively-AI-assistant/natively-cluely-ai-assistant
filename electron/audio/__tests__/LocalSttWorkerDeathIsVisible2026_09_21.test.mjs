// electron/audio/__tests__/LocalSttWorkerDeathIsVisible2026_09_21.test.mjs
//
// Reproduced 2026-09-21 on a real worker (death simulated by terminating the
// worker from outside a healthy, idle session): three further utterances over
// 110s produced 0 transcripts AND 0 errors. isActive stayed true, workerReady
// false, `worker` a dead handle — every segment queued for a 'ready' that could
// never arrive, and the exit handler only spoke up `if (hadInFlight)`.
//
// Scope, stated honestly: the death was SIMULATED. This pins that a death is
// VISIBLE and leaves a clean instance; it does not claim workers die in the
// field, and it deliberately does not add auto-respawn.
//
// Executes the compiled handlers with a fake worker (plain main-thread JS, no
// ONNX). Platform-independent: worker_threads semantics, no OS API on this path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { EventEmitter } from 'events';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-death-'));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { getPath: (k) => (k === 'userData' ? userData : os.tmpdir()), isReady: () => true } };
  }
  return origLoad.apply(this, arguments);
};
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const { LocalWhisperSTT, LOCAL_STT_UNAVAILABLE_CODE } = await import(pathToFileURL(path.join(distRoot, 'LocalWhisperSTT.js')).href);

const fakeWorker = () => { const w = new EventEmitter(); w.terminate = () => Promise.resolve(1); w.postMessage = () => {}; return w; };
function live({ inFlight = false } = {}) {
  const lws = new LocalWhisperSTT('Xenova/whisper-tiny.en');
  lws.setChannel('system');
  const errors = [];
  lws.on('error', (e) => errors.push(e));
  const w = fakeWorker();
  lws['isActive'] = true;
  lws['worker'] = w;
  lws['workerReady'] = true;
  lws['attachWorkerListeners']();
  if (inFlight) { lws['streamingTaskInFlight'] = true; lws['streamingTaskId'] = 's1'; }
  return { lws, w, errors };
}

for (const inFlight of [false, true]) {
  test(`a worker that dies with ${inFlight ? 'a task in flight' : 'NOTHING in flight (idle, between utterances)'} is reported once, terminally`, () => {
    const { lws, w, errors } = live({ inFlight });
    w.emit('exit', 1);
    assert.equal(errors.length, 1, inFlight ? 'exactly one error, not two' : 'BUG: an idle worker death was completely silent');
    assert.equal(errors[0].code, LOCAL_STT_UNAVAILABLE_CODE, 'nothing restarts the worker, so "reconnecting" would be a lie');
    const msg = String(errors[0].message);
    assert.match(msg, /system channel/);
    assert.match(msg, /restart the meeting|smaller local model|cloud STT provider/i);
    assert.doesNotMatch(msg, /internet|network|reconnect/i, 'a local engine has no connection to check');
    assert.doesNotMatch(msg, /unavailable/i, 'sttErrorMapper titles that "Service Unavailable ... Trying to reconnect"');
    // Clean inactive no-op, like every other terminal path:
    assert.equal(lws['isActive'], false);
    assert.equal(lws['worker'], null, 'must not keep a dead handle that makes dispatchFinal queue forever');
    assert.equal(lws['vad'], null);
    assert.equal(lws['pendingAudio'].length, 0);
    assert.doesNotThrow(() => lws.write(Buffer.alloc(3200)));
    assert.doesNotThrow(() => lws.stop());
  });
}

test('a death on a session that is no longer active says nothing (and cannot throw into a listener-less emitter)', () => {
  const { lws, w } = live();
  lws['isActive'] = false;
  lws.removeAllListeners();                 // what main.ts does after stop()
  assert.doesNotThrow(() => w.emit('exit', 1), 'an unhandled "error" event would be an uncaughtException in main');
});
