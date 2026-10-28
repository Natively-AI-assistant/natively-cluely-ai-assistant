// Which folder a Parakeet model loads from, downloads into, and when Settings
// offers an Update — on a Mac that can use the Neural Engine and on every
// platform that cannot (Windows, Intel Mac).
//
// Guards the upgrade path for people already on the ONNX engine: on Apple
// Silicon the CoreML repo becomes the download target, but an ONNX install
// keeps working with no download, Settings offers the switch as an Update,
// and an update that is still running (or was interrupted) never hides the
// copy that works — the in-progress marker lives in the CoreML folder only.
//
// Both platform branches run on either OS through modelManager's injected
// platform seam (setParakeetBackendDepsForTesting), never process.platform.
//
// Run: npm run build:electron && node --test <this file>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../../../../dist-electron/electron/audio/whisper');
const mm = await import(pathToFileURL(path.join(dist, 'modelManager.js')).href);
const ane = await import(pathToFileURL(path.join(dist, 'parakeet/aneBackend.js')).href);
const { PARAKEET_TDT_REQUIRED_FILES } = await import(pathToFileURL(path.join(dist, 'parakeet/downloadFiles.js')).href);

const V2 = 'istupakov/parakeet-tdt-0.6b-v2-onnx';
const V2_COREML = 'FluidInference/parakeet-tdt-0.6b-v2-coreml';
const DTYPE = 'q8';

const NEURAL_ENGINE_MAC = { platform: 'darwin', arch: 'arm64', osRelease: () => '25.0.0', helperPath: '/h', isExecutable: () => true };
const PLATFORMS_WITHOUT = {
  'Windows x64': { platform: 'win32', arch: 'x64' },
  'Intel Mac': { platform: 'darwin', arch: 'x64', osRelease: () => '25.0.0', helperPath: '/h', isExecutable: () => true },
  'Apple Silicon, helper not built': { platform: 'darwin', arch: 'arm64', osRelease: () => '25.0.0', helperPath: null },
};

function cacheDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-repo-choice-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const installOnnx = (dir) => {
  for (const f of PARAKEET_TDT_REQUIRED_FILES) {
    const p = path.join(dir, ...V2.split('/'), f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
  }
};
const installCoreMl = (dir) => {
  for (const { path: rel } of ane.PARAKEET_CORE_ML_MODELS[V2].download.files) {
    const p = path.join(dir, ...V2_COREML.split('/'), rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
  }
};

function onPlatform(t, deps) {
  mm.setParakeetBackendDepsForTesting(deps);
  t.after(() => mm.setParakeetBackendDepsForTesting(null));
}

describe('Mac that can use the Neural Engine', () => {
  test('a fresh install downloads the CoreML repo and loads from it', (t) => {
    onPlatform(t, NEURAL_ENGINE_MAC);
    const dir = cacheDir(t);
    assert.equal(mm.getModelDownloadRepo(V2), V2_COREML);
    assert.equal(mm.resolveModelSourceRepo(V2, DTYPE, dir), V2_COREML);
    assert.equal(mm.isModelUpgradeAvailable(V2, DTYPE, dir), false);
  });

  test('an existing ONNX install keeps loading, and the switch is offered as an Update', (t) => {
    onPlatform(t, NEURAL_ENGINE_MAC);
    const dir = cacheDir(t);
    installOnnx(dir);
    assert.equal(mm.resolveModelSourceRepo(V2, DTYPE, dir), V2, 'no surprise download: the ONNX copy is used');
    assert.equal(mm.isModelUpgradeAvailable(V2, DTYPE, dir), true);
  });

  test('once the CoreML copy is installed it is preferred and no Update is offered', (t) => {
    onPlatform(t, NEURAL_ENGINE_MAC);
    const dir = cacheDir(t);
    installOnnx(dir);
    installCoreMl(dir);
    assert.equal(mm.resolveModelSourceRepo(V2, DTYPE, dir), V2_COREML);
    assert.equal(mm.isModelUpgradeAvailable(V2, DTYPE, dir), false);
  });

  test('an update in progress or interrupted never hides the working ONNX copy', (t) => {
    onPlatform(t, NEURAL_ENGINE_MAC);
    const dir = cacheDir(t);
    installOnnx(dir);
    installCoreMl(dir);
    mm.markModelDownloadStarted(V2, dir);
    assert.ok(fs.existsSync(path.join(dir, ...V2_COREML.split('/'), mm.DOWNLOAD_INCOMPLETE_MARKER)), 'the marker is in the CoreML folder');
    assert.equal(fs.existsSync(path.join(dir, ...V2.split('/'), mm.DOWNLOAD_INCOMPLETE_MARKER)), false);
    assert.equal(mm.resolveModelSourceRepo(V2, DTYPE, dir), V2, 'the half-written CoreML copy is skipped');
    assert.equal(mm.isModelUpgradeAvailable(V2, DTYPE, dir), true, 'and the Update stays on offer');
  });

  test('the startup sweep removes the ONNX copy only once the CoreML copy is fully installed', (t) => {
    onPlatform(t, NEURAL_ENGINE_MAC);
    const dir = cacheDir(t);
    const onnxDir = path.join(dir, ...V2.split('/'));
    installOnnx(dir);
    assert.deepEqual(mm.purgeObsoleteModelCaches(dir, DTYPE), [], 'no CoreML copy yet: the ONNX one is the model');
    installCoreMl(dir);
    mm.markModelDownloadStarted(V2, dir);
    assert.deepEqual(mm.purgeObsoleteModelCaches(dir, DTYPE), [], 'an update in progress never costs the working copy');
    mm.clearModelDownloadMarker(V2, dir);
    assert.deepEqual(mm.purgeObsoleteModelCaches(dir, DTYPE), [V2]);
    assert.equal(fs.existsSync(onnxDir), false);
    assert.equal(mm.resolveModelSourceRepo(V2, DTYPE, dir), V2_COREML, 'the CoreML copy is untouched');
  });

  test('download size is the CoreML files, not the ONNX export', (t) => {
    onPlatform(t, NEURAL_ENGINE_MAC);
    const coremlBytes = ane.PARAKEET_CORE_ML_MODELS[V2].download.files.reduce((sum, f) => sum + f.approxBytes, 0);
    assert.equal(ane.parakeetCoreMlSizeMb(V2), Math.round(coremlBytes / (1024 * 1024)));
    assert.equal(mm.getModelSizeBytes(V2), ane.parakeetCoreMlSizeMb(V2) * 1024 * 1024);
    assert.ok(mm.getModelSizeBytes(V2) < 661 * 1024 * 1024);
  });
});

for (const [name, deps] of Object.entries(PLATFORMS_WITHOUT)) {
  describe(name, () => {
    test('the ONNX files under the id are the model; no CoreML download, no Update', (t) => {
      onPlatform(t, deps);
      const dir = cacheDir(t);
      assert.equal(mm.getModelDownloadRepo(V2), V2);
      assert.equal(mm.resolveModelSourceRepo(V2, DTYPE, dir), V2);
      installOnnx(dir);
      assert.equal(mm.isModelUpgradeAvailable(V2, DTYPE, dir), false);
    });

    test('the ONNX copy is never swept, even next to a CoreML folder', (t) => {
      onPlatform(t, deps);
      const dir = cacheDir(t);
      installOnnx(dir);
      installCoreMl(dir);
      assert.deepEqual(mm.purgeObsoleteModelCaches(dir, DTYPE), []);
      assert.equal(mm.resolveModelSourceRepo(V2, DTYPE, dir), V2);
    });

    test('download size is the catalog ONNX size', (t) => {
      onPlatform(t, deps);
      assert.equal(mm.getModelSizeBytes(V2), 661 * 1024 * 1024);
    });
  });
}

test('models other than Parakeet are untouched by the Neural Engine choice', (t) => {
  onPlatform(t, NEURAL_ENGINE_MAC);
  assert.equal(mm.getModelDownloadRepo('onnx-community/moonshine-base-ONNX'), 'onnx-community/moonshine-base-ONNX');
  assert.equal(mm.getModelDownloadRepo('Xenova/whisper-small.en'), 'onnx-community/whisper-small.en');
});
