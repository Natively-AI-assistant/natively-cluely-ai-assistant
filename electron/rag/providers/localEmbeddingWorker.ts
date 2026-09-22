// electron/rag/providers/localEmbeddingWorker.ts
//
// Worker-thread host for LocalEmbeddingProvider's ONNX inference. Mirrors the
// exact pattern the (since removed) intent classifier worker used.
//
// WHY (2026-07-05 SIGTRAP crash hardening): 9/9 real macOS crash reports
// showed the app crashing on the MAIN THREAD inside ONNX Runtime's BFC
// allocator during a live InferenceSession::Run() call — consistent with
// multiple ONNX sessions (Whisper STT worker + reranker worker +
// this local-embedding fallback) being concurrently active in-process. The
// embedding fallback was the only one of the three still running its
// pipeline()/inference DIRECTLY on the main process, so it is moved into its
// own worker_threads.Worker here, matching the isolation the other two
// already had. Also applies bounded intra/inter-op thread counts (see
// electron/utils/onnxThreadConfig.ts) to reduce native thread/memory
// pressure even when multiple sessions are concurrently active.
//
// Message protocol:
//   { type: 'init', requestId, isPackaged, localModelPath, cacheDir }
//     -> { type: 'ready', requestId } | { type: 'error', requestId, error }
//   { type: 'embed', requestId, texts: string[] }
//     -> { type: 'result', requestId, vectors: number[][] } | { type: 'error', requestId, error }

import { parentPort } from 'worker_threads';
import { getBoundedOnnxSessionOptions } from '../../utils/onnxThreadConfig';
import { classifyWorkerFailure } from '../../utils/workerStatus';
import { sliceEmbeddingTensor } from './embeddingTensorSlice';
import { BUNDLED_LOCAL_EMBEDDING } from '../bundledLocalEmbedding';

if (!parentPort) throw new Error('localEmbeddingWorker must be run as a Worker thread');

// Defaults only. The provider sends the full recipe on every init/embed, so
// these are reached only by a message that somehow omits it — and even then
// they name the model actually bundled, never a stale literal.
const MODEL_ID = BUNDLED_LOCAL_EMBEDDING.modelId;
const DIMENSIONS = BUNDLED_LOCAL_EMBEDDING.dimensions;

let pipe: any = null;
let loadingPromise: Promise<void> | null = null;
/** Recipe the currently-loaded pipe was built with. Defaults = the bundled model. */
let loadedModelId = MODEL_ID;
let loadedPooling: 'mean' | 'cls' = BUNDLED_LOCAL_EMBEDDING.pooling;

// @huggingface/transformers is ESM-only — must use a true dynamic import().
// `new Function` keeps this opaque to TypeScript's commonjs rewrite (which
// would otherwise turn `import()` into `require()` and fail for an ESM-only
// package). See LocalEmbeddingProvider.ts for the full explanation.
async function loadTransformers(): Promise<{ pipeline: any; env: any }> {
  return (new Function('return import("@huggingface/transformers")')()) as any;
}

async function ensureLoaded(msg: any): Promise<void> {
  if (pipe) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { pipeline, env } = await loadTransformers();

    env.allowRemoteModels = false;
    env.localModelPath = msg.modelPath;

    // LocalEmbeddingProvider always sends modelId/dtype/pooling (the bundled
    // recipe, or an experiment's). The fallbacks here are the bundled model's
    // own values, so a message missing them still loads the right model.
    loadedModelId = msg.modelId || MODEL_ID;
    loadedPooling = msg.pooling === 'cls' ? 'cls' : msg.pooling === 'mean' ? 'mean' : BUNDLED_LOCAL_EMBEDDING.pooling;

    console.log(`[LocalEmbeddingWorker] Loading feature-extraction model (${loadedModelId}, pooling=${loadedPooling})...`);
    pipe = await pipeline('feature-extraction', loadedModelId, {
      local_files_only: true,
      // dtype MUST be explicit on transformers.js v3. v2 defaulted to the
      // quantized variant; v3 ignores `quantized` and defaults to fp32, so a
      // bare pipeline() call asks for onnx/model.onnx — while the installer
      // ships onnx/model_quantized.onnx and NOTHING else (see
      // LocalFallbackAssets.ts and scripts/verify-packaged-local-assets.mjs).
      // In a packaged build that is local_files_only, so the load fails and the
      // feature silently degrades. scripts/download-models.js already documents
      // this trap for the DOWNLOAD side; these consumers were missed.
      // localRerankerWorker already passes `dtype: msg.dtype || 'q8'`.
      dtype: msg.dtype || BUNDLED_LOCAL_EMBEDDING.dtype,
      session_options: getBoundedOnnxSessionOptions(),
    });
    console.log('[LocalEmbeddingWorker] Feature-extraction model loaded successfully.');
    parentPort!.postMessage({ type: 'status', status: { type: 'ready', backend: 'onnx', modelPath: msg.modelPath } });
  })();

  try {
    await loadingPromise;
  } catch (e) {
    loadingPromise = null;
    pipe = null;
    const failure = classifyWorkerFailure(e);
    parentPort!.postMessage({
      type: 'status',
      status: {
        type: failure.recoverable ? 'degraded' : 'failed',
        backend: 'none',
        reason: failure.reason,
        message: failure.message,
        recoverable: failure.recoverable,
      },
    });
    throw e;
  }
}

parentPort.on('message', async (msg: any) => {
  try {
    if (msg.type === 'init') {
      await ensureLoaded(msg);
      parentPort!.postMessage({ type: 'ready', requestId: msg.requestId });
      return;
    }

    if (msg.type === 'embed') {
      if (!pipe) {
        await ensureLoaded(msg);
      }
      const texts: string[] = msg.texts;
      const output = await pipe(texts, { pooling: loadedPooling, normalize: true });

      // Width comes from the TENSOR, never from a constant. See
      // embeddingTensorSlice.ts for the measured reason this matters — it is
      // the difference between correct vectors and silent corruption on any
      // model wider than the bundled MiniLM. DIMENSIONS is only the fallback
      // for a tensor that reports no dims at all.
      const vectors = sliceEmbeddingTensor(output, texts.length, DIMENSIONS, loadedModelId);
      parentPort!.postMessage({
        type: 'result',
        requestId: msg.requestId,
        vectors,
        dimensions: vectors[0]?.length ?? DIMENSIONS,
      });
      return;
    }

    parentPort!.postMessage({
      type: 'error',
      requestId: msg.requestId,
      error: `Unknown message type: ${msg.type}`,
    });
  } catch (e: any) {
    parentPort!.postMessage({
      type: 'error',
      requestId: msg.requestId,
      error: e?.message || String(e),
    });
  }
});
