// scripts/intent-benchmark/providers/embeddingWorker.mjs
//
// Sentence-embedding worker, shared by every prototype candidate
// (all-MiniLM-L6-v2, bge-small-en-v1.5, and any other encoder).
//
// Batched by design. A prototype provider embeds the whole training split
// before it can classify anything, and one call per row would make the build
// step dominate the measurement it exists to support.

import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('embeddingWorker must be run as a Worker thread');

let pipe = null;

async function ensureLoaded() {
  if (pipe) return;
  const { pipeline, env } = await import('@huggingface/transformers');
  if (workerData.localOnly) {
    env.allowRemoteModels = false;
    env.localModelPath = workerData.modelPath;
  } else {
    env.allowRemoteModels = true;
    env.cacheDir = workerData.cacheDir;
  }
  const t0 = performance.now();
  pipe = await pipeline('feature-extraction', workerData.modelId, {
    local_files_only: !!workerData.localOnly,
    dtype: workerData.dtype ?? 'q8',
  });
  parentPort.postMessage({ type: 'loaded', ms: performance.now() - t0 });
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'init') { await ensureLoaded(); parentPort.postMessage({ type: 'ok', id: msg.id }); return; }
    if (msg.type === 'embed') {
      await ensureLoaded();
      const t0 = performance.now();
      // Mean pooling + L2 normalisation, so cosine similarity is a dot product
      // and the centroid of a set of unit vectors is itself meaningful.
      const out = await pipe(msg.texts, { pooling: 'mean', normalize: true });
      const dims = out.dims;
      const data = Array.from(out.data);
      parentPort.postMessage({ type: 'vectors', id: msg.id, data, dims, ms: performance.now() - t0 });
      return;
    }
    parentPort.postMessage({ type: 'error', id: msg.id, error: `unknown message ${msg.type}` });
  } catch (e) {
    parentPort.postMessage({ type: 'error', id: msg?.id, error: e?.message ?? String(e) });
  }
});
