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
//
// Three scoring modes, because "reranker" is three different protocols:
//   'rank'     llama.cpp's own ranking path (a model with a classification head)
//   'yes-no'   a causal LM asked a yes/no question (Qwen3-Reranker)
//   'listwise' jina-reranker-v3.5 — see jinaListwiseRerank.ts

import { parentPort } from 'worker_threads';

if (!parentPort) throw new Error('ggufRerankerWorker must be run as a Worker thread');

let llama: any = null;
let model: any = null;
let context: any = null;
let loadingPromise: Promise<void> | null = null;

/**
 * Context window to allocate for scoring, in tokens.
 *
 * llama.cpp defaults a context to the model's FULL trained length, and it sizes
 * the KV cache and compute buffers from that — even though a reranker only ever
 * sees one query/passage pair at a time. Qwen3-Reranker-0.6B trains at 40,960
 * tokens, and the default cost that:
 *
 *   MEASURED 2026-09-03, Qwen3-Reranker-0.6B Q4_K_M, macOS arm64, clean process
 *   (RSS delta for createContext alone, after the model was already loaded):
 *
 *     contextSize        RSS cost
 *     40960 (default)    4291 MB
 *      4096 (this)        452 MB
 *      2048               227 MB
 *
 * ~3.8 GB to hold a window nothing here can fill. A passage IS one chunk, and
 * the chunker emits 140 words with 30 overlap (ModeContextRetriever
 * CHUNK_WORDS/CHUNK_OVERLAP; the fine path is 45). At even 2 tokens/word that
 * is ~280 tokens, plus the Qwen prompt template and the query — comfortably
 * inside 4096, with better than 10x headroom. Sizing matters: a passage that
 * did not fit would be truncated, and a truncated passage scores differently
 * with no error anywhere. Clamped to the model's own trained length so a
 * smaller model is never asked for a window it does not have.
 */
const RERANK_CONTEXT_SIZE = 4096;

function boundedContextSize(): number {
  const trained = Number(model?.trainContextSize);
  return Number.isFinite(trained) && trained > 0
    ? Math.min(RERANK_CONTEXT_SIZE, trained)
    : RERANK_CONTEXT_SIZE;
}

/**
 * Set when the model has NO ranking head and must be scored as a causal LM
 * instead — Qwen3-Reranker is the case this exists for. Carries the sequence
 * and the two token ids whose probabilities become the score.
 */
let yesNo: { sequence: any; yesToken: number; noToken: number } | null = null;

/**
 * Set for jina-reranker-v3.5, which is scored from per-position hidden states
 * and a projector that does not live in the GGUF. See jinaListwiseRerank.ts for
 * why this is reachable at all, and why the block budget is a correctness
 * boundary rather than a tuning knob.
 */
let listwise: { projector: any; sequence: any; blockBudget: number } | null = null;

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

    if (msg.scoring === 'listwise') {
      // An EMBEDDING context, not a ranking one: what is read back is the last
      // layer's hidden state at chosen token positions, which llama.cpp only
      // computes when the context is in embedding mode.
      //
      // The context is sized to the block budget, not to the model's 131,072
      // trained length. That is not only a memory decision (see
      // boundedContextSize) — a block is never allowed to exceed the budget,
      // so a larger window could hold nothing this path would ever put in it.
      const { loadJinaProjector, BLOCK_TOKEN_BUDGET } =
        require('./jinaListwiseRerank') as typeof import('./jinaListwiseRerank');
      if (!msg.projectorPath) {
        throw new Error('listwise scoring needs projector.safetensors; none was provided');
      }
      const projector = loadJinaProjector(msg.projectorPath);
      const blockBudget = Number(msg.blockBudget) > 0 ? Number(msg.blockBudget) : BLOCK_TOKEN_BUDGET;
      const contextSize = Math.min(blockBudget, Number(model.trainContextSize) || blockBudget);
      context = await model.createContext({
        sequences: 1,
        contextSize,
        batchSize: contextSize,
        _embeddings: true,
      });
      // ONE sequence, held for the life of the worker. getSequence() ALLOCATES,
      // and the context is created with sequences: 1 — calling it per block
      // exhausted the pool on the second block with "No sequences left".
      listwise = { projector, sequence: context.getSequence(), blockBudget };
      return;
    }

    if (msg.scoring === 'yes-no') {
      // A causal LM asked a yes/no question. No ranking head, so
      // createRankingContext() would refuse — see qwenRerankPrompt.ts.
      const yesToken = singleToken(model, 'yes');
      const noToken = singleToken(model, 'no');
      context = await model.createContext({ sequences: 1, contextSize: boundedContextSize() });
      yesNo = { sequence: context.getSequence(), yesToken, noToken };
      return;
    }

    // Refused for a model with no ranking head. That is a real answer, not a
    // defect: jina-reranker-v3.5 is a qwen3-architecture GGUF with no rank
    // metadata, and llama.cpp cannot score it this way.
    context = await model.createRankingContext({ contextSize: boundedContextSize() });
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

/**
 * Run ONE block and return the projected passage and query embeddings.
 *
 * The whole trick is here. node-llama-cpp's public embedding API
 * (`getEmbeddingFor`) reads exactly one vector — the last token's — which is
 * useless for a listwise reranker that needs N+1 of them at specific
 * positions. But the layer underneath takes a per-token `logits` mask saying
 * WHICH positions to compute outputs for, and `getEmbedding(batchIndex + 1)`
 * reads `llama_get_embeddings_ith` at that batch index. Marking every special
 * token gives every hidden state in one forward pass.
 *
 * Private API, deliberately: `_decodeTokens` and `_ctx` are internal to
 * node-llama-cpp. That is a real maintenance cost, taken because the
 * alternative is a model that cannot run at all. The shape is pinned by
 * JinaListwiseAgainstReference — if a version bump moves it, that test fails
 * with a clear reason instead of this silently scoring the wrong positions.
 */
async function embedBlock(prompt: string, docCount: number): Promise<{
  docs: Float32Array[]; query: Float32Array;
} | null> {
  const { projector, sequence } =
    listwise as { projector: import('./jinaListwiseRerank').JinaProjector; sequence: any };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DOC_EMBED_TOKEN_ID, QUERY_EMBED_TOKEN_ID, project } =
    require('./jinaListwiseRerank') as typeof import('./jinaListwiseRerank');

  // `true` = prepend the model's BOS if it has one. The reference tokenises
  // with the HF tokenizer, whose Qwen3 config adds none; llama.cpp agrees, and
  // the round-trip check below would catch it if it did not.
  const tokens: number[] = Array.from(model.tokenize(prompt, true));

  const wanted: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === DOC_EMBED_TOKEN_ID || tokens[i] === QUERY_EMBED_TOKEN_ID) wanted.push(i);
  }

  // The prompt puts one embed token after each passage and one rerank token in
  // the query block. Anything else means the tokeniser did not recognise the
  // control tokens — in which case they were split into ordinary text and every
  // position read below would be the wrong one. Refusing beats scoring noise.
  if (wanted.length !== docCount + 1) {
    throw new Error(
      `expected ${docCount + 1} special-token positions in the block, found ${wanted.length}`
      + ' — the model\'s tokeniser did not recognise <|embed_token|>/<|rerank_token|>',
    );
  }
  if (tokens[wanted[wanted.length - 1]] !== QUERY_EMBED_TOKEN_ID) {
    throw new Error('the last special token in the block is not the query token');
  }

  // Wipe this sequence's KV entries before every block. Each block is an
  // independent forward pass over its own prompt, starting at position 0.
  //
  // NOT sequence.clearHistory(): that clears the JS wrapper's bookkeeping, and
  // this path decodes through _decodeTokens directly, so the wrapper's
  // nextTokenIndex is still 0 and clearHistory has nothing it believes it needs
  // to do. The native cache meanwhile still holds the previous block, and
  // llama.cpp then refuses the next decode outright:
  //   "the last position stored in the memory module ... is X = 995
  //    the tokens for sequence 0 in the input batch have a starting position
  //    of Y = 0 ... positions must remain consecutive"
  // A loud refusal, which is the good case — it surfaced on the first
  // multi-block query rather than silently scoring against a stale cache.
  //
  // disposeSequence is llama_memory_seq_rm for this sequence. It frees the KV
  // entries WITHOUT returning the id to node-llama-cpp's pool, so the id stays
  // valid for the next block; calling getSequence() again instead exhausts a
  // context created with sequences: 1 on the second block.
  try { context._ctx.disposeSequence(sequence._sequenceId); } catch { /* nothing cached yet */ }

  const wantedSet = new Set(wanted);
  const logits = tokens.map((_: number, i: number) => wantedSet.has(i));
  const batchIndexByToken = new Map<number, number>();
  await context._decodeTokens(
    { sequenceId: sequence._sequenceId, firstTokenSequenceIndex: 0, tokens, logits,
      tokenMeter: sequence.tokenMeter },
    (batchLogitIndex: number, tokenIndex: number) => {
      batchIndexByToken.set(tokenIndex, batchLogitIndex);
      return null;
    },
  );

  const read = (tokenIndex: number): Float32Array => {
    const batchIndex = batchIndexByToken.get(tokenIndex);
    if (batchIndex == null) throw new Error(`no output was computed for token ${tokenIndex}`);
    const raw = context._ctx.getEmbedding(batchIndex + 1);
    const hidden = Float32Array.from(raw as ArrayLike<number>);
    // A hidden state of all zeros means the position was not actually an
    // output row — the failure mode this whole approach risks. It scores as a
    // perfectly ordinary cosine, so it has to be caught here.
    let nonZero = false;
    for (let i = 0; i < hidden.length; i++) if (hidden[i] !== 0) { nonZero = true; break; }
    if (!nonZero) throw new Error(`the hidden state at token ${tokenIndex} came back empty`);
    return hidden;
  };

  const docs = wanted.slice(0, -1).map(i => project(projector, read(i)));
  const query = project(projector, read(wanted[wanted.length - 1]));
  return { docs, query };
}

/** Score every passage listwise, in blocks that each fit the SWA window. */
async function scoreListwise(query: string, passages: string[]): Promise<number[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { planBlocks, fuseAndScore } =
    require('./jinaListwiseRerank') as typeof import('./jinaListwiseRerank');

  const countTokens = (prompt: string): number => model.tokenize(prompt, true).length;
  const blocks = planBlocks(query, passages, countTokens, listwise!.blockBudget);

  const embedded = [];
  for (const block of blocks) {
    const out = await embedBlock(block.prompt, block.indices.length);
    if (!out) throw new Error('a block produced no embeddings');
    embedded.push({ docs: out.docs, query: out.query, indices: block.indices });
  }

  return fuseAndScore(embedded, passages.length);
}

async function disposeAll(): Promise<void> {
  // Ordered inner-to-outer; each guarded, because a failed teardown must not
  // mask the error that caused it.
  for (const [name, obj] of [['context', context], ['model', model], ['llama', llama]] as const) {
    try { await obj?.dispose?.(); } catch { /* best effort */ }
    void name;
  }
  context = null; model = null; llama = null; yesNo = null; listwise = null;
}

/**
 * Serial message queue.
 *
 * Node delivers worker messages as they arrive; an `async` listener that awaits
 * does NOT delay the next delivery. So a `dispose` arriving mid-rerank used to
 * run `disposeAll()` — freeing context, model and llama — while
 * `context.rankAll()` was still executing inside the native addon. Chaining
 * every message onto one promise makes teardown wait its turn behind whatever
 * is already running, which is also what makes the client's graceful
 * dispose-then-terminate handshake meaningful.
 *
 * llama.cpp's context is not safe for concurrent rankAll calls anyway, so
 * serialising costs nothing the previous shape was legitimately providing.
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
      await ensureLoaded(msg);
      const { query, passages } = msg as { query: string; passages: string[] };

      // `rankAll`, not `rankAndSort`: the caller needs scores in INPUT order so
      // it can map them back to its own candidates. rankAndSort returns the
      // DOCUMENTS in ranked order, and matching those back by text would pair a
      // score with the wrong candidate wherever two passages are identical —
      // which happens in this corpus.
      if (listwise) {
        const scores = await scoreListwise(query, passages);
        // One unscorable passage invalidates the whole ranking, the same rule
        // the yes-no path follows: a missing score would sink that chunk below
        // every chunk the reranker never saw.
        const complete = scores.length === passages.length && scores.every(s => Number.isFinite(s));
        parentPort!.postMessage({
          type: 'result', requestId: msg.requestId, scores: complete ? scores : null,
        });
        return;
      }

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
}
