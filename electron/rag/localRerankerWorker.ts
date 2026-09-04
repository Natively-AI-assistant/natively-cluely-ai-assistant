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

import * as path from 'path';
import { parentPort } from 'worker_threads';
import { getBoundedOnnxSessionOptions } from '../utils/onnxThreadConfig';
import {
  hasSentenceTransformerHead, loadSentenceTransformerHead, scoreWithHead,
  type SentenceTransformerHead,
} from './sentenceTransformerHead';

if (!parentPort) throw new Error('localRerankerWorker must be run as a Worker thread');

let model: any = null;
let tokenizer: any = null;
let loadingPromise: Promise<void> | null = null;
/**
 * Set when the model keeps its scoring head OUTSIDE the ONNX graph, as
 * `cross-encoder/ettin-reranker-*` does. Null for an ordinary cross-encoder
 * whose graph already emits `logits`.
 */
let stHead: SentenceTransformerHead | null = null;

// @huggingface/transformers is ESM-only — must use a true dynamic import().
// `new Function` keeps this opaque to TypeScript's commonjs rewrite. See
// LocalEmbeddingProvider.ts for the full explanation of this trick.
async function loadTransformers(): Promise<{
  AutoModelForSequenceClassification: any; AutoModel: any; AutoTokenizer: any; env: any;
}> {
  return (new Function('return import("@huggingface/transformers")')()) as any;
}

async function ensureLoaded(msg: any): Promise<void> {
  if (model && tokenizer) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { AutoModelForSequenceClassification, AutoModel, AutoTokenizer, env } = await loadTransformers();

    const isPackaged = !!msg.isPackaged;
    if (isPackaged) {
      env.allowRemoteModels = false;
      env.localModelPath = msg.modelPath;
    } else {
      env.allowRemoteModels = true;
      env.cacheDir = msg.modelPath;
    }

    // Some rerankers export only the transformer body and keep the scoring head
    // beside it as a Sentence-Transformers module chain. Those must be loaded
    // with AutoModel (which yields last_hidden_state); asking
    // AutoModelForSequenceClassification for them yields an undefined `logits`
    // and a rerank that silently returns nothing.
    const modelDir = path.join(msg.modelPath, ...String(msg.modelId).split('/'));
    let head: SentenceTransformerHead | null = null;
    if (hasSentenceTransformerHead(modelDir)) {
      head = loadSentenceTransformerHead(modelDir);
      console.log(
        `[LocalRerankerWorker] ${msg.modelId} keeps its scoring head outside the graph; `
        + `loaded ${head.modules.length} module(s).`,
      );
    }

    console.log(`[LocalRerankerWorker] Loading cross-encoder (${msg.modelId})...`);
    const loadedTokenizer = await AutoTokenizer.from_pretrained(msg.modelId, {
      local_files_only: isPackaged,
    });
    const loader = head ? AutoModel : AutoModelForSequenceClassification;
    const loadedModel = await loader.from_pretrained(msg.modelId, {
      local_files_only: isPackaged,
      dtype: msg.dtype || 'q8',
      session_options: getBoundedOnnxSessionOptions(),
    } as any);
    tokenizer = loadedTokenizer;
    model = loadedModel;
    stHead = head;
    console.log('[LocalRerankerWorker] Cross-encoder loaded successfully.');
  })();

  try {
    await loadingPromise;
  } catch (e) {
    loadingPromise = null;
    model = null;
    tokenizer = null;
    stHead = null;
    throw e;
  }
}

/**
 * Release the ONNX sessions this worker holds.
 *
 * `PreTrainedModel.dispose()` returns "an array of promises, one for each ONNX
 * session that is being disposed" — it is the library's own release path, and
 * terminating the thread skipped it entirely.
 */
async function disposeAll(): Promise<void> {
  try { await model?.dispose?.(); } catch { /* best effort */ }
  model = null; tokenizer = null; stHead = null; loadingPromise = null;
}

/**
 * Serial message queue.
 *
 * Node delivers worker messages as they arrive, and an `async` listener that
 * awaits does NOT delay the next delivery — so a `dispose` arriving mid-rerank
 * would release the sessions while `model(inputs)` was still executing inside
 * the native addon. Chaining every message onto one promise makes teardown wait
 * its turn, which is also what makes the host's dispose-then-terminate
 * handshake meaningful. Same shape as ggufRerankerWorker.
 */
let queue: Promise<void> = Promise.resolve();

parentPort.on('message', (msg: any) => {
  queue = queue.then(() => handleMessage(msg)).catch(() => { /* handled below */ });
});

async function handleMessage(msg: any): Promise<void> {
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

      if (stHead) {
        // last_hidden_state is [batch, tokens, width]; each sequence is scored
        // from its own CLS vector through the module chain.
        const hidden = output?.last_hidden_state;
        const raw: Float32Array | undefined = hidden?.data ?? hidden?.ort_tensor?.data;
        const dims: number[] | undefined = hidden?.dims ?? hidden?.ort_tensor?.dims;
        if (!raw || !dims || dims.length !== 3) {
          throw new Error('the backbone returned no usable last_hidden_state');
        }
        const [batch, tokens, width] = dims;
        const perSequence = tokens * width;
        const headScores: number[] = [];
        for (let b = 0; b < batch; b++) {
          headScores.push(scoreWithHead(stHead, raw.subarray(b * perSequence, (b + 1) * perSequence) as Float32Array, width));
        }
        parentPort!.postMessage({ type: 'result', requestId: msg.requestId, scores: headScores });
        return;
      }

      const logits = output?.logits;
      const data: Float32Array | number[] | undefined = logits?.data ?? logits?.ort_tensor?.data;
      const scores = data ? Array.from(data as any).map(Number) : [];
      parentPort!.postMessage({ type: 'result', requestId: msg.requestId, scores });
      return;
    }

    if (msg.type === 'dispose') {
      await disposeAll();
      parentPort!.postMessage({ type: 'ready', requestId: msg.requestId });
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
}
