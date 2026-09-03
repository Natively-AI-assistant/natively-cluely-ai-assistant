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

/**
 * Set when the model has NO ranking head and must be scored as a causal LM
 * instead — Qwen3-Reranker is the case this exists for. Carries the sequence
 * and the two token ids whose probabilities become the score.
 */
let yesNo: { sequence: any; yesToken: number; noToken: number } | null = null;

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

    if (msg.scoring === 'yes-no') {
      // A causal LM asked a yes/no question. No ranking head, so
      // createRankingContext() would refuse — see qwenRerankPrompt.ts.
      const yesToken = singleToken(model, 'yes');
      const noToken = singleToken(model, 'no');
      context = await model.createContext({ sequences: 1 });
      yesNo = { sequence: context.getSequence(), yesToken, noToken };
      return;
    }

    // Refused for a model with no ranking head. That is a real answer, not a
    // defect: jina-reranker-v3.5 is a qwen3-architecture GGUF with no rank
    // metadata, and llama.cpp cannot score it this way.
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

/**
 * The single token id for a word.
 *
 * Refuses a multi-token result rather than silently taking the first piece: if
 * "yes" does not tokenise to one token in this vocabulary, the whole scoring
 * protocol is wrong for this model and a plausible number would be worse than
 * an error.
 */
function singleToken(m: any, word: string): number {
  const tokens = m.tokenize(word, false, 'trimLeadingSpace');
  if (!Array.isArray(tokens) || tokens.length !== 1) {
    throw new Error(`"${word}" is not a single token in this model's vocabulary (got ${tokens?.length})`);
  }
  return tokens[0];
}

/** Score one prompt by how much mass sits on "yes" versus "no" next. */
async function scoreYesNo(prompt: string): Promise<number | null> {
  const { sequence, yesToken, noToken } = yesNo!;
  // Each pair is scored independently: the KV cache must not carry the previous
  // document into this one.
  await sequence.clearHistory();

  const tokens = model.tokenize(prompt, true);
  const input = tokens.map((t: number, i: number) => (
    i === tokens.length - 1 ? [t, { generateNext: { probabilities: true } }] : t
  ));

  // controlledEvaluate, not evaluate: this reads the distribution at the last
  // position WITHOUT generating anything.
  const out = await sequence.controlledEvaluate(input);
  const probabilities = out[out.length - 1]?.next?.probabilities;
  if (!probabilities) return null;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { yesNoScore } = require('./qwenRerankPrompt') as typeof import('./qwenRerankPrompt');
  return yesNoScore(probabilities.get(yesToken), probabilities.get(noToken));
}

async function disposeAll(): Promise<void> {
  // Ordered inner-to-outer; each guarded, because a failed teardown must not
  // mask the error that caused it.
  for (const [name, obj] of [['context', context], ['model', model], ['llama', llama]] as const) {
    try { await obj?.dispose?.(); } catch { /* best effort */ }
    void name;
  }
  context = null; model = null; llama = null; yesNo = null;
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
      if (yesNo) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { buildQwenRerankPrompt } = require('./qwenRerankPrompt') as typeof import('./qwenRerankPrompt');
        const out: number[] = [];
        for (const passage of passages) {
          const score = await scoreYesNo(buildQwenRerankPrompt(query, passage, msg.instruction));
          // One unscorable passage invalidates the whole ranking: a missing
          // score sinks that chunk below every chunk the reranker never saw.
          if (score == null) {
            parentPort!.postMessage({ type: 'result', requestId: msg.requestId, scores: null });
            return;
          }
          out.push(score);
        }
        parentPort!.postMessage({ type: 'result', requestId: msg.requestId, scores: out });
        return;
      }

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
