// electron/audio/__tests__/PreloadRepairsDamagedModel2026_10_14.test.mjs
//
// A model whose files were damaged by an interrupted download (before the
// in-progress marker existed) still counts as installed. The launch preload is
// the first thing to load it and so the first to find out — and it used to
// record a five-minute cooldown and walk away. The model stayed "installed",
// and the user met the failure at the start of their next meeting, which then
// had no transcription.
//
// Found on a real profile, 2026-10-14: whisper-tiny ("Protobuf parsing
// failed") and whisper-small.en (a 2.1 MB encoder), both listed as installed.
//
// Now the preload removes the damaged files and starts the download again, at
// launch — and ONLY for damaged files: a load that failed for lack of memory
// or network must not delete a good download.
//
// EXECUTED against the built preloader with a stand-in Worker and a temp
// profile. File removal is a plain fs.rm on a path built with path.join; the
// removal waits for the worker's exit because Windows cannot delete a file a
// thread still has open. Not executed on Windows.
//
// Run: npm run build:electron && node --test electron/audio/__tests__/PreloadRepairsDamagedModel2026_10_14.test.mjs

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
  constructor(file) { super(); this.file = file; this.posted = []; this.terminated = 0; FakeWorker.instances.push(this); }
  postMessage(msg) { this.posted.push(msg); }
  terminate() { this.terminated++; return Promise.resolve(1); }
  of(type) { return this.posted.filter((m) => m?.type === type); }
}
FakeWorker.instances = [];

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'preload repair-')); // a space in the path on purpose
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { getPath: (k) => (k === 'userData' ? userData : os.tmpdir()), isReady: () => true }, BrowserWindow: { getAllWindows: () => [] } };
  }
  if (request === 'worker_threads') return { ...origLoad.apply(this, arguments), Worker: FakeWorker };
  return origLoad.apply(this, arguments);
};

const dist = path.resolve(__dirname, '../../../dist-electron/electron');
const { modelPreloader } = await import(pathToFileURL(path.join(dist, 'audio/whisper/modelPreloader.js')).href);
const { LocalModelDownloadService } = await import(pathToFileURL(path.join(dist, 'services/LocalModelDownloadService.js')).href);
const gate = await import(pathToFileURL(path.join(dist, 'utils/onnxThreadConfig.js')).href);

const MODEL = 'Xenova/whisper-tiny.en';
const modelDir = path.join(userData, 'whisper-models', 'Xenova', 'whisper-tiny.en');
const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));

let downloads;
beforeEach(() => {
  FakeWorker.instances = [];
  downloads = [];
  gate.__resetOnnxGateForTests();
  modelPreloader.recentFailures = new Map();
  modelPreloader.warmWorker = null; modelPreloader.warmModelId = null;
  modelPreloader.loadingWorker = null; modelPreloader.pendingModelId = null; modelPreloader.loading = false;
  fs.rmSync(modelDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(modelDir, 'onnx'), { recursive: true });
  fs.writeFileSync(path.join(modelDir, 'onnx', 'encoder_model.onnx'), Buffer.alloc(2048, 7)); // a truncated download
  LocalModelDownloadService.__resetForTests();
  LocalModelDownloadService.getInstance().registerProvider({
    name: 'whisper',
    isModelCached: () => false,
    deletePartial: () => {},
    preflightCheck: () => null,
    spawnWorker: () => { downloads.push(MODEL); return new FakeWorker('download'); },
    buildInitMessage: (modelId) => ({ type: 'init', modelId }),
  });
});

async function preloadThenFail(message) {
  modelPreloader.preload(MODEL);
  await tick();
  const w = FakeWorker.instances[0];
  assert.ok(w, 'the preload spawned a worker');
  w.emit('message', { type: 'error', message });
  await tick();
  return w;
}

test('damaged files found at launch are removed and downloaded again', async () => {
  const w = await preloadThenFail(
    `Failed to load model: Load model from ${path.join(modelDir, 'onnx', 'encoder_model.onnx')} failed:Protobuf parsing failed.`,
  );
  assert.equal(w.of('shutdown').length, 1, 'the failed worker is asked to exit');
  assert.equal(w.terminated, 0);
  assert.equal(fs.existsSync(modelDir), true, 'not yet: on Windows a file the worker still has open cannot be removed');
  assert.deepEqual(downloads, []);

  w.emit('exit', 0);
  await tick(60);
  assert.equal(fs.existsSync(modelDir), false, 'BUG: the damaged model stayed "installed" until a meeting failed on it');
  assert.deepEqual(downloads, [MODEL], 'and it is fetched again in the background, without the user opening Settings');
  assert.equal(modelPreloader.recentFailures.has(MODEL), false, 'the repaired model does not sit out the failure cooldown');
});

for (const [why, message] of [
  ['out of memory', 'Failed to load model: bad allocation'],
  ['no network', 'Failed to load model: fetch failed'],
  ['unsupported macOS', 'Failed to load model: Symbol not found: __ZNSt3__18to_charsEPcS0_d'],
  ['missing Windows runtime', 'Failed to load model: The specified module could not be found.\n\\\\?\\C:\\x\\onnxruntime_binding.node'],
]) {
  test(`a load that failed for another reason (${why}) keeps the files and downloads nothing`, async () => {
    const w = await preloadThenFail(message);
    w.emit('exit', 0);
    await tick(60);
    assert.equal(fs.existsSync(path.join(modelDir, 'onnx', 'encoder_model.onnx')), true,
      'BUG: a good download deleted because the machine was short of memory or offline');
    assert.deepEqual(downloads, []);
    assert.equal(modelPreloader.recentFailures.has(MODEL), true, 'the ordinary cooldown still applies');
  });
}
