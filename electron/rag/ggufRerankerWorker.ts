// electron/rag/ggufRerankerWorker.ts
//
// Worker-thread host for GGUF reranking via node-llama-cpp (llama.cpp).
//
// WHY A WORKER, not the main process: this is the same reasoning that moved
// the ONNX reranker off the main thread after the 2026-07-05 SIGTRAP crashes
// (see localRerankerWorker.ts). llama.cpp is a native addon doing its own
// allocation and its own aborts; a failure there takes down whatever thread it
// runs on. Off the main thread that is a recoverable rerank failure, on it is
// the app disappearing.
//
// Message protocol mirrors localRerankerWorker.ts:
//   { type: 'init', requestId, modelPath }
//     -> { type: 'ready', requestId } | { type: 'error', requestId, error }
//   { type: 'rerank', requestId, query, passages: string[] }
//     -> { type: 'result', requestId, scores: number[] } | { type: 'error', ... }

import { parentPort } from 'worker_threads';

if (!parentPort) throw new Error('ggufRerankerWorker must be run as a Worker thread');

let llama: any = null;
let model: any = null;
let context: any = null;
let loadingPromise: Promise<void> | null = null;

// node-llama-cpp is ESM-only. `new Function` keeps the dynamic import opaque to
// TypeScript's commonjs rewrite — the same trick LocalEmbeddingProvider uses
// for @huggingface/transformers, and for the same reason.
async function loadLlamaCpp(): Promise<any> {
  return (new Function('return import("node-llama-cpp")')()) as any;
}

async function ensureLoaded(msg: any): Promise<void> {
  if (context) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { getLlama } = await loadLlamaCpp();

    // `build: 'never'` — a packaged app must never try to compile llama.cpp on
    // a user's machine. If the prebuilt binary for this platform is missing,
    // failing here is the correct outcome; a silent source build is not.
    llama = await getLlama({ build: 'never', logLevel: 'error' });
    model = await llama.loadModel({ modelPath: msg.modelPath });

    // Refused for a model with no ranking head. That is a real answer, not a
    // defect: jina-reranker-v3.5 and qwen3-reranker are qwen3-architecture
    // GGUFs with no rank metadata, and llama.cpp cannot score them this way.
    context = await model.createRankingContext();
  })();

  try {
    await loadingPromise;
  } catch (e) {
    loadingPromise = null;
    await disposeAll();
    throw e;
  }
}

async function disposeAll(): Promise<void> {
  // Ordered inner-to-outer; each guarded, because a failed teardown must not
  // mask the error that caused it.
  for (const [name, obj] of [['context', context], ['model', model], ['llama', llama]] as const) {
    try { await obj?.dispose?.(); } catch { /* best effort */ }
    void name;
  }
  context = null; model = null; llama = null;
}

parentPort.on('message', async (msg: any) => {
  try {
    if (msg.type === 'init') {
      await ensureLoaded(msg);
      parentPort!.postMessage({ type: 'ready', requestId: msg.requestId });
      return;
    }

    if (msg.type === 'rerank') {
      await ensureLoaded(msg);
      const { query, passages } = msg as { query: string; passages: string[] };

      // `rankAll`, not `rankAndSort`: the caller needs scores in INPUT order so
      // it can map them back to its own candidates. rankAndSort returns the
      // DOCUMENTS in ranked order, and matching those back by text would pair a
      // score with the wrong candidate wherever two passages are identical —
      // which happens in this corpus.
      const scores: number[] = await context.rankAll(query, passages);
      parentPort!.postMessage({ type: 'result', requestId: msg.requestId, scores });
      return;
    }

    if (msg.type === 'dispose') {
      await disposeAll();
      parentPort!.postMessage({ type: 'ready', requestId: msg.requestId });
      return;
    }

    parentPort!.postMessage({
      type: 'error', requestId: msg.requestId, error: `unknown message type ${String(msg?.type)}`,
    });
  } catch (e: any) {
    parentPort!.postMessage({
      type: 'error', requestId: msg?.requestId, error: e?.message || String(e),
    });
  }
});
