// electron/rag/localRerankerWorker.ts
//
// Worker-thread host for LocalReranker's cross-encoder ONNX inference.
// Mirrors electron/llm/intentClassifierWorker.ts and
// electron/rag/providers/localEmbeddingWorker.ts.
//
// WHY (2026-07-05 SIGTRAP crash hardening): see localEmbeddingWorker.ts for
// the full crash-forensics writeup. LocalReranker had the identical unsafe
// main-thread ONNX load/inference pattern (it is currently inert — no
// packaged reranker model is bundled yet — but is fixed now while inert
// rather than waiting for it to go live and hit the same crash surface).
//
// Message protocol:
//   { type: 'init', requestId, modelId, modelPath, isPackaged, dtype }
//     -> { type: 'ready', requestId } | { type: 'error', requestId, error }
//   { type: 'rerank', requestId, query, passages: string[] }
//     -> { type: 'result', requestId, scores: number[] } | { type: 'error', requestId, error }

import { parentPort } from 'worker_threads';
import { getBoundedOnnxSessionOptions } from '../utils/onnxThreadConfig';

if (!parentPort) throw new Error('localRerankerWorker must be run as a Worker thread');

let model: any = null;
let tokenizer: any = null;
let loadingPromise: Promise<void> | null = null;

// @huggingface/transformers is ESM-only — must use a true dynamic import().
// `new Function` keeps this opaque to TypeScript's commonjs rewrite. See
// LocalEmbeddingProvider.ts for the full explanation of this trick.
async function loadTransformers(): Promise<{ AutoModelForSequenceClassification: any; AutoTokenizer: any; env: any }> {
  return (new Function('return import("@huggingface/transformers")')()) as any;
}

async function ensureLoaded(msg: any): Promise<void> {
  if (model && tokenizer) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { AutoModelForSequenceClassification, AutoTokenizer, env } = await loadTransformers();

    const isPackaged = !!msg.isPackaged;
    if (isPackaged) {
      env.allowRemoteModels = false;
      env.localModelPath = msg.modelPath;
    } else {
      env.allowRemoteModels = true;
      env.cacheDir = msg.modelPath;
    }

    console.log(`[LocalRerankerWorker] Loading cross-encoder (${msg.modelId})...`);
    const loadedTokenizer = await AutoTokenizer.from_pretrained(msg.modelId, {
      local_files_only: isPackaged,
    });
    const loadedModel = await AutoModelForSequenceClassification.from_pretrained(msg.modelId, {
      local_files_only: isPackaged,
      dtype: msg.dtype || 'q8',
      session_options: getBoundedOnnxSessionOptions(),
    } as any);
    tokenizer = loadedTokenizer;
    model = loadedModel;
    console.log('[LocalRerankerWorker] Cross-encoder loaded successfully.');
  })();

  try {
    await loadingPromise;
  } catch (e) {
    loadingPromise = null;
    model = null;
    tokenizer = null;
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

    if (msg.type === 'rerank') {
      if (!model || !tokenizer) {
        await ensureLoaded(msg);
      }
      const { query, passages } = msg as { query: string; passages: string[] };
      const inputs = await tokenizer(
        new Array(passages.length).fill(query),
        { text_pair: passages, padding: true, truncation: true },
      );
      const output = await model(inputs);
      const logits = output?.logits;
      const data: Float32Array | number[] | undefined = logits?.data ?? logits?.ort_tensor?.data;
      const scores = data ? Array.from(data as any).map(Number) : [];
      parentPort!.postMessage({ type: 'result', requestId: msg.requestId, scores });
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
