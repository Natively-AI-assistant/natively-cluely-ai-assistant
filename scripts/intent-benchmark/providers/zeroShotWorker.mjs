// scripts/intent-benchmark/providers/zeroShotWorker.mjs
//
// Generic zero-shot NLI worker, shared by every NLI candidate (MobileBERT
// baseline, DeBERTa-v3 xsmall/small/base, ModernBERT).
//
// One worker file rather than one per model, because the only thing that
// differs between those candidates is the model id and the dtype. Duplicating
// the worker per model would mean five copies of the ONNX lifecycle to keep in
// sync, and the repo already has a documented problem with drifting copies.
//
// LATENCY IS MEASURED HERE, INSIDE THE WORKER. The parent also records the
// round trip. Both are reported: the in-worker number is the model's cost, the
// round trip is what production would actually pay, and quoting only the first
// would flatter every candidate equally but mislead about the deadline budget.

import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('zeroShotWorker must be run as a Worker thread');

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
  pipe = await pipeline('zero-shot-classification', workerData.modelId, {
    local_files_only: !!workerData.localOnly,
    // Explicit dtype for the same reason every other loader in this repo pins
    // it: transformers.js v3 defaults to fp32 and asks for onnx/model.onnx,
    // while the shipped trees carry onnx/model_quantized.onnx and nothing else.
    dtype: workerData.dtype ?? 'q8',
  });
  parentPort.postMessage({ type: 'loaded', ms: performance.now() - t0 });
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'init') { await ensureLoaded(); parentPort.postMessage({ type: 'ok', id: msg.id }); return; }
    if (msg.type === 'classify') {
      await ensureLoaded();
      const t0 = performance.now();
      const out = await pipe(msg.text, msg.labels, {
        multi_label: !!msg.multiLabel,
        ...(msg.hypothesisTemplate ? { hypothesis_template: msg.hypothesisTemplate } : {}),
      });
      parentPort.postMessage({
        type: 'result', id: msg.id,
        labels: out.labels, scores: out.scores,
        ms: performance.now() - t0,
      });
      return;
    }
    parentPort.postMessage({ type: 'error', id: msg.id, error: `unknown message ${msg.type}` });
  } catch (e) {
    parentPort.postMessage({ type: 'error', id: msg?.id, error: e?.message ?? String(e) });
  }
});
