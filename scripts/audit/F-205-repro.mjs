// F-205 repro: a wedged whisper worker leaks the SHARED ONNX semaphore slot
// for the rest of the app session.
//
// LocalWhisperSTT.stop() deliberately keeps the worker alive when finals are
// still draining. From that point every release path is worker-reply-driven
// ('result' / 'error' / flushPending → beginWorkerTermination), and
// dispatchFinal() clears the streaming watchdog — so nothing bounds the
// drain. A worker wedged inside ONNX inference therefore never releases
// this.slotRelease, and acquireOnnxSlot() is an unbounded semaphore with no
// timeout: the NEXT meeting's spawnWorker awaits it forever, with no 'error'
// emitted and no banner, taking the local embedder / reranker / intent
// classifier down with it too.
//
// Harness: real LocalWhisperSTT from the dist bundle, a fake worker that
// never replies, and the drain bound shortened so the test is fast (the same
// real code path and timer).
//
// Expected (correct): the slot is released once the drain bound expires →
// exit 0. Bug (F-205): never released → exit 1.
import Module from 'node:module';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { isPackaged: false, getAppPath: () => '/tmp/fake', isReady: () => false, getPath: () => '/tmp' } };
  }
  if (request.endsWith('.node') || request.includes('native-module')) return {};
  return origLoad.apply(this, arguments);
};

const { LocalWhisperSTT } = await import(path.join(distRoot, 'LocalWhisperSTT.js'));

// Shorten the real bound (readonly is a TS-only annotation).
const BOUND = 400;
if ('DRAIN_WATCHDOG_MS' in LocalWhisperSTT) LocalWhisperSTT.DRAIN_WATCHDOG_MS = BOUND;

const stt = new LocalWhisperSTT('Xenova/whisper-tiny');
stt.on('error', () => {});

// A worker wedged in inference: accepts the job, never replies, and its
// terminate() is what the fix must eventually reach.
let terminated = false;
const wedged = new EventEmitter();
wedged.postMessage = () => {};
wedged.terminate = () => { terminated = true; };

let slotReleased = false;
stt.worker = wedged;
stt.slotRelease = () => { slotReleased = true; };
stt.isActive = true;
stt.vad = null;                    // skip VAD flush; drive the drain state directly
stt.isDrainingFinals = true;
stt.drainingFinalsInFlight = 1;    // a final is "in flight" inside the wedged worker
stt.pendingAudio = [];

stt.stop();

console.log('[F-205] immediately after stop(): slotReleased =', slotReleased, '(expected false — drain is legitimately in progress)');

await new Promise((r) => setTimeout(r, BOUND + 600));

console.log('[F-205] after the drain bound: slotReleased =', slotReleased, '| worker terminate scheduled =', stt.workerTerminateTimer !== null || terminated);

if (!slotReleased) {
  console.error('[F-205] FAIL: the shared ONNX slot was never released — the next meeting\'s spawnWorker would await it forever, with no error and no banner (F-205 reproduced).');
  process.exit(1);
}
console.log('[F-205] PASS: a wedged drain is bounded; the shared ONNX slot is released.');
process.exit(0);
