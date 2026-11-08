// electron/audio/__tests__/LocalSttSpeechDuringLoad2026_10_14.test.mjs
//
// Three ways the start of a meeting lost speech or corrupted a model, all on a
// machine that has just installed Natively and picked a local model:
//
//  1. NEMOTRON DROPPED EVERYTHING SAID WHILE IT LOADED. dispatchFinal returned
//     at `if (!this.worker) return;`, and for Nemotron `this.worker` is only
//     set once the whole shared worker is up. Every other model queued.
//
//  2. STOPPING DURING THAT LOAD LEAKED THE WORKER. The stopped instance still
//     took its hold on the shared worker when the load finished, and never
//     gave it back — the registry's refcount could not reach zero again.
//
//  3. A MEETING STARTED A SECOND DOWNLOAD OF THE SAME MODEL. The launch-time
//     auto-download (or a click in Settings) was already fetching it; the
//     meeting spawned its own worker, which fetched the same files into the
//     same paths. Now there is one download owner and the meeting waits for it.
//
// EXECUTED, not grepped: the built LocalWhisperSTT runs against a stand-in
// Worker, so no model is loaded or downloaded. The logic is platform-neutral
// (worker_threads messaging and timers); not executed on Windows.
//
// Run: npm run build:electron && node --test electron/audio/__tests__/LocalSttSpeechDuringLoad2026_10_14.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { EventEmitter } from 'events';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = '64';

class FakeWorker extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.posted = [];
    this.terminated = 0;
    FakeWorker.instances.push(this);
  }
  postMessage(msg) { this.posted.push(msg); }
  terminate() { this.terminated++; return Promise.resolve(1); }
  of(type) { return this.posted.filter((m) => m?.type === type); }
}
FakeWorker.instances = [];

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-during-load-'));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return {
      app: { getPath: (k) => (k === 'userData' ? userData : os.tmpdir()), isReady: () => true },
      BrowserWindow: { getAllWindows: () => [] },
    };
  }
  if (request === 'worker_threads') return { ...origLoad.apply(this, arguments), Worker: FakeWorker };
  return origLoad.apply(this, arguments);
};

const dist = path.resolve(__dirname, '../../../dist-electron/electron');
const { LocalWhisperSTT, LOCAL_STT_UNAVAILABLE_CODE } = await import(pathToFileURL(path.join(dist, 'audio/LocalWhisperSTT.js')).href);
const { LocalModelDownloadService } = await import(pathToFileURL(path.join(dist, 'services/LocalModelDownloadService.js')).href);
const registry = await import(pathToFileURL(path.join(dist, 'audio/whisper/nemotron/sharedWorkerRegistry.js')).href);
const gate = await import(pathToFileURL(path.join(dist, 'utils/onnxThreadConfig.js')).href);

const NEMOTRON = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';
const MOONSHINE = 'onnx-community/moonshine-base-ONNX';
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const speech = () => new Float32Array(16000); // one second at 16 kHz

beforeEach(() => {
  FakeWorker.instances = [];
  registry.__resetSharedNemotronWorkerForTests();
  gate.__resetOnnxGateForTests();
  LocalModelDownloadService.__resetForTests();
});

function begin(modelId, channel = 'mic') {
  const lws = new LocalWhisperSTT(modelId);
  lws.setChannel(channel);
  const errors = [];
  lws.on('error', (e) => errors.push(e));
  lws.start();
  return { lws, errors };
}

test('Nemotron: speech that closes while the shared worker is still loading is queued, then transcribed', async () => {
  const { lws, errors } = begin(NEMOTRON);
  await tick();
  const w = FakeWorker.instances.at(-1);
  assert.ok(w, 'the registry spawned the shared worker');
  assert.equal(w.of('init')[0]?.channelId, 'mic');
  assert.equal(lws['worker'], null, 'fixture: for Nemotron there is no worker on the instance until the load ends');

  lws['dispatchFinal'](speech());
  lws['dispatchFinal'](speech());
  assert.equal(lws['pendingAudio'].length, 2, 'BUG: everything said during the load was thrown away');
  assert.equal(lws.finalize(), true, 'the Answer/Stop tail wait must see the queued finals');

  w.emit('message', { type: 'ready', channelId: 'mic' });
  await tick();
  const sent = w.of('transcribe');
  assert.equal(sent.length, 2, 'the queued segments are sent as soon as the model is up');
  assert.ok(sent.every((m) => m.streaming === false && m.channelId === 'mic'));
  assert.equal(sent[0].nemotronReset, true, 'the first queued segment still starts a clean decode');
  assert.equal(lws['pendingAudio'].length, 0);
  assert.deepEqual(errors, []);
  lws.stop();
});

test('Nemotron: stop() during the load drops the queue and gives the worker back when it arrives', async () => {
  const { lws, errors } = begin(NEMOTRON);
  await tick();
  const w = FakeWorker.instances.at(-1);
  lws['dispatchFinal'](speech());
  assert.equal(lws['pendingAudio'].length, 1);

  lws.stop();
  assert.equal(lws['pendingAudio'].length, 0, 'BUG: audio queued for a stopped meeting would be replayed into the next one');

  w.emit('message', { type: 'ready', channelId: 'mic' }); // the load finishes after the meeting ended
  await tick();
  assert.equal(lws['worker'], null, 'a stopped instance must not adopt the worker');
  assert.equal(w.of('transcribe').length, 0);
  assert.equal(w.of('shutdown').length, 1, 'BUG: the stopped instance kept its hold, so the shared worker could never be released');
  assert.equal(w.terminated, 0, 'and it is asked to exit, never terminated');
  assert.deepEqual(errors, []);
});

test('Nemotron: a normal stop asks the shared worker to exit — no timer, no terminate()', async () => {
  const { lws } = begin(NEMOTRON);
  await tick();
  const w = FakeWorker.instances.at(-1);
  w.emit('message', { type: 'ready', channelId: 'mic' });
  await tick();
  assert.strictEqual(lws['worker'], w);
  lws.stop();
  assert.equal(w.of('shutdown').length, 1, 'requested immediately; the worker exits at its next idle point');
  assert.equal(w.terminated, 0, 'BUG: terminate() while the worker is in a native ONNX run aborts the whole app');
});

test('a model that is not downloaded yet: the meeting joins the ONE download and does not start its own', async () => {
  let cached = false;
  const prepared = [];
  const svc = LocalModelDownloadService.getInstance();
  svc.registerProvider({
    name: 'whisper',
    isModelCached: () => cached,
    deletePartial: () => {},
    preflightCheck: () => null,
    prepareDownload: (id) => prepared.push(id),
    spawnWorker: () => new FakeWorker('download'),
    buildInitMessage: (modelId) => ({ type: 'init', modelId }),
  });

  const { lws, errors } = begin(MOONSHINE);
  await tick();
  assert.equal(FakeWorker.instances.length, 1, 'BUG: a second worker downloading the same files into the same paths');
  const download = FakeWorker.instances[0];
  assert.equal(download.file, 'download', 'the only worker is the download service\'s');
  assert.deepEqual(prepared, [MOONSHINE], 'the download is marked in progress on disk before it starts');

  lws['dispatchFinal'](speech());
  assert.equal(lws['pendingAudio'].length, 1, 'speech during the download is kept');

  download.emit('message', { type: 'progress', modelId: MOONSHINE, progress: 60 });
  await tick();
  assert.equal(FakeWorker.instances.length, 1, 'still waiting while it downloads');

  cached = true;
  download.emit('message', { type: 'ready' });
  await tick(60);
  assert.equal(FakeWorker.instances.length, 2, 'now, and only now, the meeting starts its own worker');
  const own = FakeWorker.instances[1];
  assert.equal(own.of('init')[0]?.modelId, MOONSHINE);
  assert.equal(download.of('shutdown').length, 1, 'the download worker is asked to exit');
  assert.equal(download.terminated, 0);

  own.emit('message', { type: 'ready' });
  await tick();
  assert.equal(own.of('transcribe').length, 1, 'the speech queued during the download is transcribed');
  assert.deepEqual(errors, []);
  lws.stop();
});

test('a download that fails surfaces ONE terminal error, and no worker is started on half a model', async () => {
  const svc = LocalModelDownloadService.getInstance();
  svc.registerProvider({
    name: 'whisper',
    isModelCached: () => false,
    deletePartial: () => {},
    preflightCheck: () => null,
    describeError: () => 'The local model could not be downloaded. Check the internet connection, then install it again in Settings → Audio.',
    spawnWorker: () => new FakeWorker('download'),
    buildInitMessage: (modelId) => ({ type: 'init', modelId }),
  });

  const { lws, errors } = begin(MOONSHINE);
  await tick();
  lws['dispatchFinal'](speech());
  FakeWorker.instances[0].emit('message', { type: 'error', message: 'Failed to load model: fetch failed' });
  await tick(60);

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, LOCAL_STT_UNAVAILABLE_CODE, 'BUG: a bare Error reads as "STT reconnecting" for the whole meeting');
  assert.match(errors[0].message, /could not be downloaded/);
  assert.equal(FakeWorker.instances.length, 1, 'no STT worker is spawned for a model that is not there');
  assert.equal(lws['isActive'], false, 'the instance tears down cleanly');
  assert.equal(lws['pendingAudio'].length, 0);
});

test('stop() while waiting for a download neither errors nor spawns a worker later', async () => {
  let cached = false;
  const svc = LocalModelDownloadService.getInstance();
  svc.registerProvider({
    name: 'whisper',
    isModelCached: () => cached,
    deletePartial: () => {},
    preflightCheck: () => null,
    spawnWorker: () => new FakeWorker('download'),
    buildInitMessage: (modelId) => ({ type: 'init', modelId }),
  });
  const { lws, errors } = begin(MOONSHINE);
  await tick();
  lws.stop();
  cached = true;
  FakeWorker.instances[0].emit('message', { type: 'ready' }); // the download carries on for the next meeting
  await tick(60);
  assert.equal(FakeWorker.instances.length, 1, 'a stopped meeting must not spawn an orphan worker when the download ends');
  assert.deepEqual(errors, []);
  assert.equal(svc.getState('whisper', MOONSHINE).status, 'complete', 'the download itself was not cancelled');
});

test('with no download provider registered the instance behaves exactly as before', async () => {
  // Unit-test contexts and any code path that never registered a provider.
  const { lws, errors } = begin(MOONSHINE);
  await tick();
  assert.equal(FakeWorker.instances.length, 1, 'cold start spawns its own worker straight away');
  assert.equal(FakeWorker.instances[0].of('init')[0]?.modelId, MOONSHINE);
  assert.deepEqual(errors, []);
  lws.stop();
});
