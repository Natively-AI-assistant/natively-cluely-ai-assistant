// scripts/intent-benchmark/lib/restoreWorker.mjs
//
// The punctuation-restoration model, hosted in its own worker thread.
//
// The worker is not optional and not ceremony. Natively already hit fatal
// ORT BFCArena::Extend aborts on macOS from running multiple ONNX sessions on
// one thread, and every local-model loader in the app (IntentClassifier,
// LocalEmbeddingProvider, LocalReranker, Whisper) is built this way as a
// result. A benchmark harness that broke the rule would be measuring a
// configuration that can never ship.

import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('restoreWorker must be run as a Worker thread');

let pipe = null;

async function ensureLoaded() {
  if (pipe) return;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = workerData.modelPath;
  pipe = await pipeline('token-classification', workerData.modelId, {
    local_files_only: true,
    // dtype MUST be explicit. transformers.js v3 ignores the v2 `quantized`
    // option and defaults to fp32, which asks for onnx/model.onnx — and the
    // export script deliberately ships ONLY onnx/model_quantized.onnx, because
    // the fp32 graph carries a 265MB external-weights sidecar. Without this
    // line the load fails and the feature degrades silently, which is the exact
    // trap already documented in intentClassifierWorker.ts.
    dtype: 'q8',
  });
  parentPort.postMessage({ type: 'ready' });
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'init') { await ensureLoaded(); parentPort.postMessage({ type: 'ok', id: msg.id }); return; }
    if (msg.type === 'restore') {
      await ensureLoaded();
      const started = performance.now();
      const out = await pipe(msg.text);
      parentPort.postMessage({
        type: 'result', id: msg.id,
        tokens: out.map((o) => ({ word: o.word, entity: o.entity, score: o.score })),
        ms: performance.now() - started,
      });
      return;
    }
    parentPort.postMessage({ type: 'error', id: msg.id, error: `unknown message ${msg.type}` });
  } catch (e) {
    parentPort.postMessage({ type: 'error', id: msg?.id, error: e?.message ?? String(e) });
  }
});
