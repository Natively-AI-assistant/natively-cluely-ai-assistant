// electron/audio/__tests__/OnnxWorkerCooperativeShutdown2026_10_14.test.mjs
//
// THE CRASH THIS PINS (2.9.2 user crash report, then reproduced on macOS
// against the real worker on 2026-10-14, both mid-inference and mid-load):
//
//   libc++abi: terminating due to uncaught exception of type Napi::Error
//   Electron exited with signal SIGABRT
//
// worker.terminate() on a worker that is inside a native onnxruntime call
// aborts the WHOLE app. Every "fix" before this one put a timer in front of
// the terminate(), which only narrows the window. The rule now is: an ONNX
// worker is never terminated, it is asked to exit, and it exits itself at its
// next idle point.
//
// What runs here:
//   - the REAL built worker scripts — local STT, embeddings, reranker, router —
//     are each asked to shut down and must exit 0 (no model needed: the
//     contract is the message, not the inference);
//   - no ONNX host file may contain a terminate() call at all, and each must
//     register its workers so the quit path can stop them;
//   - the registry and the quit-time stop, against stand-in workers.
//
// What cannot run here: the abort itself needs a real model mid-inference.
// That was executed by hand (Moonshine Base, eight timings from 30 ms to
// 700 ms into a load and into a 12 s inference: terminate() -> SIGABRT every
// time; shutdown -> exit code 0 every time, main process alive).
//
// Platform note: plain worker_threads messaging, identical on macOS and
// Windows. The abort lives in the N-API binding, not the OS. Not executed on
// Windows.
//
// Run: npm run build:electron && node --test electron/audio/__tests__/OnnxWorkerCooperativeShutdown2026_10_14.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const dist = path.join(repo, 'dist-electron/electron');

const {
  retireOnnxWorker,
  retireOnnxWorkerAndWait,
  retireAllOnnxWorkers,
  trackOnnxWorker,
  liveOnnxWorkerCount,
  ONNX_WORKER_SHUTDOWN_MESSAGE,
  __resetOnnxWorkerRegistryForTests,
} = await import(pathToFileURL(path.join(dist, 'utils/onnxWorkerShutdown.js')).href);

test('retireOnnxWorker posts the shutdown message and nothing else', () => {
  const posted = [];
  let terminated = 0;
  retireOnnxWorker({ postMessage: (m) => posted.push(m), terminate: () => { terminated++; } });
  assert.deepEqual(posted, [{ type: 'shutdown' }]);
  assert.deepEqual({ ...ONNX_WORKER_SHUTDOWN_MESSAGE }, { type: 'shutdown' });
  assert.equal(terminated, 0, 'BUG: terminate() on an ONNX worker can abort the whole app');
});

test('retiring a worker that is already gone, or absent, never throws', () => {
  assert.doesNotThrow(() => retireOnnxWorker({ postMessage: () => { throw new Error('worker is dead'); } }));
  assert.doesNotThrow(() => retireOnnxWorker(null));
  assert.doesNotThrow(() => retireOnnxWorker(undefined));
});

// Every worker script that can hold an onnxruntime-node session. Each is asked
// to shut down while idle (no model is loaded — the contract under test is the
// message, and none of them needs a model to answer it).
for (const [name, rel] of [
  ['local STT (whisper / Moonshine / Parakeet / Nemotron)', 'audio/whisper/whisperWorker.js'],
  ['local embeddings', 'rag/providers/localEmbeddingWorker.js'],
  ['local reranker', 'rag/localRerankerWorker.js'],
  ['router model', 'llm/routing/routerWorker.js'],
]) {
  test(`the REAL ${name} worker answers shutdown by exiting itself with code 0`, async () => {
    const workerPath = path.join(dist, rel);
    assert.ok(fs.existsSync(workerPath), 'run `npm run build:electron` first');
    const w = trackOnnxWorker(new Worker(workerPath));
    const errors = [];
    w.on('error', (e) => errors.push(e));
    await new Promise((resolve) => w.once('online', resolve));
    const before = liveOnnxWorkerCount();
    const codeSeen = new Promise((resolve) => w.once('exit', resolve));
    const gone = await retireOnnxWorkerAndWait(w, 15_000);
    assert.equal(gone, true, 'the worker did not exit within 15s of being asked to');
    assert.equal(await codeSeen, 0, 'a requested stop is a clean exit, not a crash (hosts treat non-zero as a load failure)');
    assert.deepEqual(errors, []);
    assert.equal(liveOnnxWorkerCount(), before - 1, 'and it is no longer counted as alive');
  });
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');
}

for (const rel of [
  'electron/audio/LocalWhisperSTT.ts',
  'electron/audio/whisper/modelPreloader.ts',
  'electron/audio/whisper/nemotron/sharedWorkerRegistry.ts',
  'electron/services/LocalModelDownloadService.ts',
  'electron/rag/providers/LocalEmbeddingProvider.ts',
  'electron/rag/LocalReranker.ts',
  'electron/llm/routing/RouterModel.ts',
]) {
  test(`${rel} never calls terminate() on a worker`, () => {
    const code = stripComments(fs.readFileSync(path.join(repo, rel), 'utf8'));
    assert.doesNotMatch(
      code,
      /\.terminate\s*\(/,
      'BUG: an ONNX worker must be stopped with retireOnnxWorker(). terminate() while it is inside a native ' +
      'run() or session load aborts the whole app, and a timer in front of it does not make it safe.',
    );
    assert.match(code, /retireOnnxWorker(AndWait)?\(/, 'the file must stop its workers through the cooperative helper');
    assert.match(code, /trackOnnxWorker\(\s*(env \? )?new Worker\(/, 'and register each one at spawn, or the quit path cannot find it');
  });
}

for (const rel of [
  'electron/rag/providers/localEmbeddingWorker.ts',
  'electron/rag/localRerankerWorker.ts',
  'electron/llm/routing/routerWorker.ts',
]) {
  test(`${rel} exits on shutdown before it looks at any other message`, () => {
    const src = fs.readFileSync(path.join(repo, rel), 'utf8');
    const handler = src.slice(src.indexOf("parentPort.on('message'"));
    const shutdown = handler.indexOf("if (msg?.type === 'shutdown') {");
    assert.ok(shutdown > -1 && shutdown < 200, 'the shutdown check must be the first thing in the message listener');
    assert.match(handler.slice(shutdown, shutdown + 1400), /process\.exit\(0\);/);
  });
}

// ── The live-worker registry and the quit path ─────────────────────────────

/** A worker that exits `afterMs` after being asked to, or never when `afterMs` is null (inside a native call). */
function fakeWorker(afterMs = 5) {
  const w = new EventEmitter();
  w.shutdownRequests = 0;
  w.terminated = 0;
  w.terminate = () => { w.terminated++; };
  w.postMessage = (msg) => {
    if (msg?.type !== 'shutdown') return;
    w.shutdownRequests++;
    if (afterMs !== null) setTimeout(() => w.emit('exit', 0), afterMs);
  };
  return w;
}

test('a tracked worker counts as alive until it exits', () => {
  __resetOnnxWorkerRegistryForTests();
  const a = trackOnnxWorker(fakeWorker());
  const b = trackOnnxWorker(fakeWorker());
  assert.strictEqual(trackOnnxWorker(a), a, 'tracking twice is harmless and returns the same worker');
  assert.equal(liveOnnxWorkerCount(), 2);
  a.emit('exit', 0);
  assert.equal(liveOnnxWorkerCount(), 1);
  b.emit('exit', 1);
  assert.equal(liveOnnxWorkerCount(), 0, 'a crash is an exit too');
});

test('a stand-in with no exit event is returned untouched and never counted', () => {
  __resetOnnxWorkerRegistryForTests();
  const plain = { postMessage() {} };
  assert.strictEqual(trackOnnxWorker(plain), plain);
  assert.equal(liveOnnxWorkerCount(), 0);
});

test('retireOnnxWorkerAndWait resolves true when the worker has gone', async () => {
  __resetOnnxWorkerRegistryForTests();
  const w = trackOnnxWorker(fakeWorker(10));
  assert.equal(await retireOnnxWorkerAndWait(w, 2000), true);
  assert.equal(w.shutdownRequests, 1);
  // Already gone: no second 'exit' will ever fire, so this must not wait for one.
  const started = Date.now();
  assert.equal(await retireOnnxWorkerAndWait(w, 5000), true);
  assert.ok(Date.now() - started < 500);
});

test('a worker still inside a native call is reported alive at the deadline — and is NOT killed', async () => {
  __resetOnnxWorkerRegistryForTests();
  const busy = trackOnnxWorker(fakeWorker(null));
  assert.equal(await retireOnnxWorkerAndWait(busy, 60), false);
  assert.equal(busy.terminated, 0, 'BUG: a hard kill at the deadline is the abort itself');
  assert.equal(liveOnnxWorkerCount(), 1, 'it is still alive, and still counted');
});

test('the quit path asks EVERY live worker to exit and reports the ones that did not', async () => {
  __resetOnnxWorkerRegistryForTests();
  assert.deepEqual(await retireAllOnnxWorkers(1000), { asked: 0, stillAlive: 0 }, 'nothing loaded: nothing to wait for');
  const idle = [trackOnnxWorker(fakeWorker(5)), trackOnnxWorker(fakeWorker(20))];
  const busy = trackOnnxWorker(fakeWorker(null));
  const started = Date.now();
  const r = await retireAllOnnxWorkers(150);
  assert.deepEqual(r, { asked: 3, stillAlive: 1 });
  assert.ok(Date.now() - started < 1000, 'bounded by the deadline, not by the busy worker');
  for (const w of [...idle, busy]) {
    assert.equal(w.shutdownRequests, 1);
    assert.equal(w.terminated, 0);
  }
});

test('every bundle shares one registry (globalThis, not module scope)', () => {
  __resetOnnxWorkerRegistryForTests();
  trackOnnxWorker(fakeWorker());
  assert.equal(globalThis.__nativelyOnnxWorkerRegistryV1__.live.size, 1);
});

test('the worker handles shutdown before anything else and exits its own thread', () => {
  const src = fs.readFileSync(path.join(repo, 'electron/audio/whisper/whisperWorker.ts'), 'utf8');
  const handler = src.slice(src.indexOf("parentPort.on('message', async (msg: any) => {"));
  const first = handler.slice(0, handler.indexOf("if (msg.type === 'init') {"));
  assert.match(first, /if \(msg\.type === 'shutdown'\) \{[\s\S]*process\.exit\(0\);/);
});

test('a retired worker keeps an error listener until it has really exited', () => {
  // A Worker 'error' with no listener is an uncaught exception in the main process.
  const whisper = fs.readFileSync(path.join(repo, 'electron/audio/LocalWhisperSTT.ts'), 'utf8');
  const tail = whisper.slice(whisper.indexOf('this.expectedWorkerExits.add(w);'));
  assert.match(tail.slice(0, 900), /w\.removeAllListeners\('error'\);[\s\S]*w\.on\('error', \(\) => \{/);
});
