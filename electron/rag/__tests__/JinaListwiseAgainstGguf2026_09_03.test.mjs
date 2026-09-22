/**
 * The whole local path for jina-reranker-v3.5, against the real 378MB GGUF.
 *
 * JinaListwiseRerank pins the pieces against numbers taken from the published
 * model. This pins the thing they add up to: llama.cpp actually loading the
 * quantised weights, actually returning hidden states at the token positions
 * this code asks for, and actually ranking the way `jinaai/jina-reranker-v3.5`
 * ranks in fp32.
 *
 * It SKIPS when the model is not installed, because CI does not download 378MB
 * to run a unit suite. That is a real gap and worth naming: the sibling suite
 * cannot catch a regression in the one part of this that is private API —
 * `_decodeTokens` and `_ctx.getEmbedding` are internal to node-llama-cpp, and a
 * version bump that moves them would leave every other test green. Run this
 * after any node-llama-cpp upgrade:
 *
 *   NATIVELY_TEST_JINA_V35=1 node --test electron/rag/__tests__/JinaListwiseAgainstGguf2026_09_03.test.mjs
 *
 * Install the model first through Settings > Reranker, or:
 *   node -e "require('./dist-electron/electron/services/reranking/localModelInstaller.js')
 *     .installCatalogModel('jina-reranker-v3.5-q4km', ()=>{}, new AbortController().signal, {})"
 *
 * MEASURED when this was written (Q4_K_M, macOS arm64, Metal), against the fp32
 * reference's own rerank():
 *
 *   3 short passages          top-1 and full order identical, max |delta| 0.011
 *   8 realistic chunks        top-1 and full order identical, max |delta| 0.080
 *   12 realistic chunks       top-1 and top-3 set identical, tau 0.818
 *   5 chunks, 3 duplicated    full order identical, max |delta| 0.008
 *
 * The residual is quantisation plus the discarded sliding-window pattern; the
 * header of jinaListwiseRerank.ts has the split.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const REF = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures/jina-reranker-v3.5-reference.json'), 'utf8'));

const MODEL_DIR = path.join(
  os.homedir(), 'Library/Application Support/natively/local-models/jinaai/jina-reranker-v3.5-GGUF');
const WEIGHTS = path.join(MODEL_DIR, 'jina-reranker-v3.5-Q4_K_M.gguf');
const PROJECTOR = path.join(MODEL_DIR, 'projector.safetensors');

// Opt-in, not merely "run it if the model happens to be here". `npm test`
// globs electron/rag/__tests__/**, and this file loads a 378MB model into
// llama.cpp three times; on a developer machine that DOES have the model it
// turned a 30-file suite into a wedged process. The env var keeps the bulk run
// identical everywhere and makes this the deliberate post-upgrade check its
// header describes.
const installed = process.platform === 'darwin' && fs.existsSync(WEIGHTS) && fs.existsSync(PROJECTOR);
const skip = !process.env.NATIVELY_TEST_JINA_V35
  ? 'set NATIVELY_TEST_JINA_V35=1 to run this (loads a 378MB model); see this file\'s header'
  : installed ? false : 'jina-reranker-v3.5 is not installed (410MB); see this file\'s header';

test('the GGUF ranks the way the published fp32 model ranks', { skip }, async () => {
  const { GgufReranker } = require(path.join(repoRoot, 'dist-electron/electron/rag/GgufReranker.js'));
  const port = new GgufReranker(WEIGHTS, 'listwise', PROJECTOR);
  try {
    const order = await port.rerank(REF.query, REF.docs, null);
    assert.ok(order, 'the port returned null — the whole ranking was rejected');
    assert.equal(order.length, REF.docs.length);

    const scores = new Array(REF.docs.length);
    for (const o of order) scores[o.index] = o.score;
    assert.ok(scores.every(Number.isFinite), `unscored candidate: ${JSON.stringify(scores)}`);

    const ours = [...scores.keys()].sort((a, b) => scores[b] - scores[a]);
    const reference = [...REF.scores.keys()].sort((a, b) => REF.scores[b] - REF.scores[a]);
    assert.deepEqual(ours, reference, 'the local ranking diverged from the reference');

    // Q4_K_M against fp32, so agreement is on the order first and the magnitude
    // second. 0.05 is five times the 0.011 measured here — loose enough that
    // quantisation noise cannot red it, tight enough that reading the wrong
    // token position (which lands anywhere in [-1, 1]) cannot pass.
    for (let i = 0; i < scores.length; i++) {
      assert.ok(Math.abs(scores[i] - REF.scores[i]) < 0.05,
        `doc ${i}: ${scores[i]} vs reference ${REF.scores[i]}`);
    }
  } finally {
    await port.dispose();
  }
});

test('the private node-llama-cpp shape this depends on still exists', { skip }, async () => {
  // The two internals the worker reaches for. If a version bump removes or
  // renames either, this fails with a reason instead of the reranker quietly
  // scoring the wrong positions — the failure mode that has no error.
  const { getLlama } = await import('node-llama-cpp');
  const llama = await getLlama({ build: 'never', logLevel: 'error' });
  const model = await llama.loadModel({ modelPath: WEIGHTS });
  const context = await model.createContext({ sequences: 1, contextSize: 512, batchSize: 512, _embeddings: true });
  try {
    assert.equal(typeof context._decodeTokens, 'function',
      'LlamaContext._decodeTokens is gone — the per-position logits mask went with it');
    assert.equal(typeof context._ctx?.getEmbedding, 'function',
      'AddonContext.getEmbedding is gone — hidden states are no longer readable');
    assert.equal(typeof context._ctx?.disposeSequence, 'function',
      'AddonContext.disposeSequence is gone — blocks could not be isolated from each other');

    // And it must still return DIFFERENT vectors for different positions, which
    // is the property the whole approach rests on. A build that pooled them
    // would return the same vector for every position and rank everything equal.
    const sequence = context.getSequence();
    const tokens = Array.from(model.tokenize('Paris is the capital of France today.', true));
    const marks = [1, Math.floor(tokens.length / 2), tokens.length - 1];
    const seen = new Map();
    await context._decodeTokens(
      { sequenceId: sequence._sequenceId, firstTokenSequenceIndex: 0, tokens,
        logits: tokens.map((_, i) => marks.includes(i)), tokenMeter: sequence.tokenMeter },
      (batchIndex, tokenIndex) => { seen.set(tokenIndex, batchIndex); return null; },
    );
    const vectors = marks.map(i => Array.from(context._ctx.getEmbedding(seen.get(i) + 1, 8)).join(','));
    assert.equal(new Set(vectors).size, marks.length,
      'every marked position returned the same vector — this build pools embeddings');
  } finally {
    // llama too, not just the context and model: getLlama() starts native
    // threads, and leaving them running keeps the test RUNNER alive after the
    // last assertion. Under `electron --test` that presents as a wedged suite
    // at 0% CPU with no output at all, which is a miserable thing to debug.
    await context.dispose();
    await model.dispose();
    await llama.dispose?.();
  }
});

test('several blocks score without the KV cache leaking between them', { skip }, async () => {
  // The multi-block path failed loudly the first time — llama.cpp refuses a
  // decode starting at position 0 while the cache still holds the previous
  // block. It could just as easily have scored against a stale cache, so the
  // multi-block case is exercised rather than assumed.
  const { GgufReranker } = require(path.join(repoRoot, 'dist-electron/electron/rag/GgufReranker.js'));
  const filler = 'The build pipeline compiles the renderer with Vite and the main process with esbuild, '
    + 'emitting one bundle per entry point so a shared module is inlined into each. ';
  const docs = Array.from({ length: 9 }, (_, i) => `Passage ${i}. ` + filler.repeat(12));
  // A tight budget so this genuinely splits, whatever the default becomes.
  const port = new GgufReranker(WEIGHTS, 'listwise', PROJECTOR, 1024);
  try {
    const order = await port.rerank('How are bundles emitted?', docs, null);
    assert.ok(order, 'a multi-block rerank returned null');
    assert.equal(order.length, docs.length, 'every candidate must come back scored');
    assert.equal(new Set(order.map(o => o.index)).size, docs.length, 'indices must be unique');
    assert.ok(order.every(o => Number.isFinite(o.score)));
  } finally {
    await port.dispose();
  }
});
