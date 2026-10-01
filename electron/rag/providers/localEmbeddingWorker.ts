// electron/rag/providers/localEmbeddingWorker.ts
//
// Worker-thread host for LocalEmbeddingProvider. Supports:
// 1. ONNX models via @huggingface/transformers
// 2. GGUF models via node-llama-cpp (llama.cpp)
//
// Keeps heavy ML computation completely isolated from the Electron main thread.

import * as path from 'path';
import * as fs from 'fs';
import { parentPort } from 'worker_threads';
import { getBoundedOnnxSessionOptions } from '../../utils/onnxThreadConfig';
import { classifyWorkerFailure } from '../../utils/workerStatus';
import { finalizeGgufVector } from './ggufEmbeddingVector';
import { sliceEmbeddingTensor } from './embeddingTensorSlice';
import { BUNDLED_LOCAL_EMBEDDING } from '../bundledLocalEmbedding';
import { BUNDLED_CATALOG_ID } from '../embeddingModelCatalog';

if (!parentPort) throw new Error('localEmbeddingWorker must be run as a Worker thread');

let runtime: 'onnx' | 'gguf' = 'onnx';
let currentModelId = BUNDLED_CATALOG_ID;
let currentDimensions = 384;
let currentPooling: 'mean' | 'cls' | 'last' = 'mean';

// ONNX state
let pipe: any = null;

// GGUF state
let llama: any = null;
let ggufModel: any = null;
let ggufContext: any = null;

let loadingPromise: Promise<void> | null = null;
let lastConfig: any = null;
let idleTimer: NodeJS.Timeout | null = null;
const IDLE_UNLOAD_TIMEOUT_MS = 15 * 60 * 1000; // 15m idle timeout to free RAM/VRAM

function resetIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(async () => {
    console.log('[LocalEmbeddingWorker] Idle for 15 minutes. Unloading weights to free system memory.');
    await disposeAll();
  }, IDLE_UNLOAD_TIMEOUT_MS);
  if (idleTimer && typeof (idleTimer as any).unref === 'function') {
    (idleTimer as any).unref();
  }
}

async function loadTransformers(): Promise<{ pipeline: any; env: any }> {
  return (new Function('return import("@huggingface/transformers")')()) as any;
}

async function loadLlamaCpp(): Promise<any> {
  return (new Function('return import("node-llama-cpp")')()) as any;
}

async function disposeAll(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (ggufContext) {
    try { await ggufContext.dispose(); } catch { /* ignore */ }
    ggufContext = null;
  }
  if (ggufModel) {
    try { await ggufModel.dispose(); } catch { /* ignore */ }
    ggufModel = null;
  }
  if (pipe) {
    // Dropping the reference does not free the native ONNX session.
    try { await pipe.dispose?.(); } catch { /* ignore */ }
    pipe = null;
  }
  loadingPromise = null;
}

const GGUF_CONTEXT_SIZE = 2048;

/**
 * llama.cpp throws "Input is longer than the context size" for any input past
 * the context window, which failed the WHOLE batch. Embed the leading
 * window instead — the same truncation transformers.js applies on the ONNX
 * path at the model's max length.
 */
async function ggufEmbedOne(text: string): Promise<ArrayLike<number>> {
  const tokens = ggufModel.tokenize(text);
  const input = tokens.length > GGUF_CONTEXT_SIZE - 8
    ? tokens.slice(0, GGUF_CONTEXT_SIZE - 8)
    : text;
  const embedding = await ggufContext.getEmbeddingFor(input);
  return embedding.vector;
}

async function ensureLoaded(msg: any): Promise<void> {
  if (msg) lastConfig = { ...msg };
  const targetRuntime = msg.runtime === 'gguf' ? 'gguf' : 'onnx';
  const targetModelId = msg.modelId || BUNDLED_CATALOG_ID;

  if (targetRuntime === runtime && currentModelId === targetModelId) {
    if (runtime === 'onnx' && pipe) return;
    if (runtime === 'gguf' && ggufContext) return;
  } else if (pipe || ggufContext || ggufModel) {
    await disposeAll();
  }

  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    runtime = msg.runtime === 'gguf' ? 'gguf' : 'onnx';
    currentModelId = msg.modelId || BUNDLED_CATALOG_ID;
    currentDimensions = Number(msg.dimensions) || 384;
    currentPooling = msg.pooling || 'mean';

    if (runtime === 'gguf') {
      console.log(`[LocalEmbeddingWorker] Loading GGUF embedding model (${currentModelId}) from ${msg.modelPath}...`);
      const { getLlama } = await loadLlamaCpp();
      llama = await getLlama({ build: 'never', logLevel: 'error' });
      ggufModel = await llama.loadModel({ modelPath: msg.modelPath });
      ggufContext = await ggufModel.createEmbeddingContext({
        contextSize: GGUF_CONTEXT_SIZE,
      });
      console.log(`[LocalEmbeddingWorker] GGUF embedding model loaded successfully (${currentDimensions}d).`);
      parentPort!.postMessage({
        type: 'status',
        status: { type: 'ready', backend: 'gguf', modelPath: msg.modelPath },
      });
      return;
    }

    // ONNX via @huggingface/transformers
    const { pipeline, env } = await loadTransformers();
    env.allowRemoteModels = false;

    // Resolve local model directory or root
    const modelPath = msg.modelPath;
    let targetIdentifier: string;

    if (fs.existsSync(path.join(modelPath, 'config.json'))) {
      env.localModelPath = path.dirname(path.dirname(modelPath));
      targetIdentifier = modelPath;
    } else {
      env.localModelPath = modelPath;
      targetIdentifier = msg.hfModelId || BUNDLED_LOCAL_EMBEDDING.modelId;
    }

    console.log(`[LocalEmbeddingWorker] Loading ONNX embedding model (${currentModelId}) from ${modelPath}...`);
    pipe = await pipeline('feature-extraction', targetIdentifier, {
      local_files_only: true,
      dtype: 'q8',
      session_options: getBoundedOnnxSessionOptions(),
    });
    // Input-token cap (2026-09-22). transformers.js truncates at the tokenizer's
    // model_max_length, which is 8192 (Arctic L v2.0) or 131072 (Qwen3) for the
    // long-context models. One ~4 KB CSV row is ~1800-2400 tokens: measured, a
    // batch of four of them took 8s at 1024 tokens and SIGTRAPPED the process
    // uncapped (a native abort, which in the app takes the whole app down).
    const cap = Number(msg.maxInputTokens);
    if (Number.isFinite(cap) && cap > 0 && pipe.tokenizer) {
      const native = Number(pipe.tokenizer.model_max_length) || Infinity;
      pipe.tokenizer.model_max_length = Math.min(native, cap);
    }
    console.log(`[LocalEmbeddingWorker] ONNX embedding model loaded successfully (${currentDimensions}d${pipe.tokenizer?.model_max_length ? `, max ${pipe.tokenizer.model_max_length} tokens` : ''}).`);
    parentPort!.postMessage({
      type: 'status',
      status: { type: 'ready', backend: 'onnx', modelPath: msg.modelPath },
    });
  })();

  try {
    await loadingPromise;
  } catch (e) {
    await disposeAll();
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
      resetIdleTimer();
      parentPort!.postMessage({ type: 'ready', requestId: msg.requestId });
      return;
    }

    if (msg.type === 'dispose') {
      lastConfig = null;
      await disposeAll();
      parentPort!.postMessage({ type: 'disposed', requestId: msg.requestId });
      return;
    }

    if (msg.type === 'embed') {
      if ((runtime === 'onnx' && !pipe) || (runtime === 'gguf' && !ggufContext)) {
        await ensureLoaded(msg.modelPath ? msg : lastConfig);
      }
      resetIdleTimer();

      const texts: string[] = msg.texts;

      if (runtime === 'gguf') {
        const vectors: number[][] = [];
        for (const text of texts) {
          vectors.push(finalizeGgufVector(await ggufEmbedOne(text), currentDimensions));
        }
        parentPort!.postMessage({ type: 'result', requestId: msg.requestId, vectors });
        return;
      }

      // ONNX inference
      // The catalog says 'last' (the GGUF path's name); transformers.js calls
      // last-token pooling 'last_token' and THROWS on 'last'. Correct only with
      // left padding, which the Qwen3 tokenizer config declares and
      // transformers.js reads.
      const onnxPooling = currentPooling === 'last' ? 'last_token' : currentPooling;
      // Last-token (decoder, Qwen3-Embedding) models are embedded ONE TEXT PER
      // RUN. Measured 2026-09-22 on the q8 ONNX: a mixed-length batch gives each
      // text a different vector from the same text embedded alone (cosine
      // 0.934-0.957; identical-length texts: 1.00000), even for the unpadded
      // longest item, so it is not only pad positions. Indexing batches and
      // queries embed singly, so batching would put documents and queries in
      // inconsistent spaces. Enforced here so no caller's batch size can undo it.
      let vectors: number[][];
      if (onnxPooling === 'last_token' && texts.length > 1) {
        vectors = [];
        for (const text of texts) {
          const one = await pipe([text], { pooling: onnxPooling, normalize: true });
          vectors.push(sliceEmbeddingTensor(one, 1, currentDimensions, currentModelId)[0]);
        }
      } else {
        const output = await pipe(texts, { pooling: onnxPooling, normalize: true });
        // Width from the tensor, and batch x width ASSERTED (embeddingTensorSlice).
        // A hardcoded width once handed every 768-d vector the bytes of another
        // batch item; item 0 still looked perfect, so a first-vector check could
        // not see it.
        vectors = sliceEmbeddingTensor(output, texts.length, currentDimensions, currentModelId);
      }
      parentPort!.postMessage({ type: 'result', requestId: msg.requestId, vectors, dimensions: vectors[0]?.length });
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
