// electron/rag/__tests__/LocalEmbeddingProviderRealModel.test.mjs
//
// REAL-MODEL smoke test for the worker-isolated LocalEmbeddingProvider
// (2026-07-05 SIGTRAP crash hardening). Loads the actual bundled
// all-MiniLM-L6-v2 ONNX model through the real worker_threads.Worker spawn
// path (electron/rag/providers/localEmbeddingWorker.js) — no mocking of
// Worker or transformers — and asserts embed()/embedBatch() still produce
// correct, semantically-sane vectors after being moved off the main thread.
//
// Mirrors electron/rag/__tests__/LocalRerankerModel.test.mjs's structure/skip
// posture: SKIPS (does not fail) when the model isn't present on disk.
//
// Run via: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const modelDir = path.join(repoRoot, 'resources/models/Xenova/all-MiniLM-L6-v2');
const MODEL_PRESENT = fs.existsSync(path.join(modelDir, 'tokenizer.json'));

// This suite runs under `ELECTRON_RUN_AS_NODE=1 electron --test`, where the
// real `electron` module's `app` is undefined (no app lifecycle in that
// mode). Mock a minimal `app` so LocalEmbeddingProvider's constructor-time
// `resolveModelPath()` (which reads `app.isPackaged` / `app.getAppPath()`)
// resolves to the real on-disk resources/models directory, matching how the
// provider behaves inside the real Electron main process.
const origModuleLoad = Module._load;
Module._load = function patched(request, parentModule, isMain) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: false,
        getAppPath: () => repoRoot,
      },
    };
  }
  return origModuleLoad.apply(this, arguments);
};

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function loadProvider() {
  const dist = path.resolve(repoRoot, 'dist-electron/electron/rag/providers/LocalEmbeddingProvider.js');
  return import(pathToFileURL(dist).href);
}

describe('LocalEmbeddingProvider — real bundled model, real Worker (no mocks)', () => {
  test(
    'embed() delegates to the actual worker_threads.Worker and produces normalized, semantically-sane vectors',
    { skip: !MODEL_PRESENT ? 'all-MiniLM-L6-v2 model not downloaded' : false },
    async () => {
      const { LocalEmbeddingProvider } = await loadProvider();
      const provider = new LocalEmbeddingProvider();

      const available = await provider.isAvailable();
      assert.equal(available, true, 'bundled embedder should load through the real worker');

      const catVec = await provider.embed('The cat sat on the mat.');
      const dogVec = await provider.embed('A dog rested on the rug.');
      const unrelatedVec = await provider.embed('Quarterly revenue grew by twelve percent.');

      assert.equal(catVec.length, 384);
      assert.equal(dogVec.length, 384);

      // normalize: true was requested — vectors should be unit-length.
      const norm = Math.sqrt(catVec.reduce((s, x) => s + x * x, 0));
      assert.ok(Math.abs(norm - 1) < 0.01, `embedding should be L2-normalized, got norm=${norm}`);

      // Semantically related sentences should be closer than an unrelated one.
      const simCatDog = cosineSim(catVec, dogVec);
      const simCatUnrelated = cosineSim(catVec, unrelatedVec);
      assert.ok(
        simCatDog > simCatUnrelated,
        `related sentences (cat/dog, sim=${simCatDog}) should be more similar than unrelated ones (sim=${simCatUnrelated})`,
      );
    },
  );

  test(
    'embedBatch() batches multiple texts through the same worker round-trip',
    { skip: !MODEL_PRESENT ? 'all-MiniLM-L6-v2 model not downloaded' : false },
    async () => {
      const { LocalEmbeddingProvider } = await loadProvider();
      const provider = new LocalEmbeddingProvider();

      const vectors = await provider.embedBatch(['one', 'two', 'three']);
      assert.equal(vectors.length, 3);
      for (const v of vectors) assert.equal(v.length, 384);
    },
  );
});
