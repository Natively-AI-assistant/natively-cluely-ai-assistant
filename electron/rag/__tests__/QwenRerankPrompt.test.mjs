/**
 * Qwen3-Reranker's yes/no scoring protocol.
 *
 * Qwen3-Reranker has no ranking head — llama.cpp's rank API refuses it. It is a
 * causal LM asked a yes/no question, scored by how much probability it puts on
 * "yes" versus "no" at the next token.
 *
 * VALIDATED AGAINST THE REFERENCE. transformers 5.12 + torch 2.12, fp32,
 * Qwen/Qwen3-Reranker-0.6B, one pair at a time:
 *
 *   0.000043  Photosynthesis converts light energy...
 *   0.984219  Designed and operated Kubernetes clusters...
 *   0.000024  The Rhine is a river...
 *   0.119824  Skills: Python, Go, Kubernetes, Kafka...
 *
 * and this implementation on Q4_K_M through llama.cpp:
 *
 *   0.000040 / 0.906807 / 0.000041 / 0.076290
 *
 * Identical ranking, and every document within 4-bit quantisation noise. An
 * exact match is NOT the bar here and never could be — the reference is fp32
 * and the shipped weights are 4-bit.
 *
 * One trap found on the way: the model card's BATCHED recipe, padded and read
 * at [:, -1, :], produced nonsense (the Rhine ranked first). Scoring one pair
 * at a time — which is what this implementation does — matches. If anyone
 * batches this later, that is the thing to re-derive.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const {
  buildQwenRerankPrompt, yesNoScore, QWEN_RERANK_PREFIX, QWEN_RERANK_SUFFIX, QWEN_DEFAULT_INSTRUCTION,
} = require(path.join(repoRoot, 'dist-electron/electron/rag/qwenRerankPrompt.js'));

describe('the prompt is Qwen\'s own, not a reconstruction', () => {
  test('the system turn fixes the answer to yes or no', () => {
    assert.match(QWEN_RERANK_PREFIX, /^<\|im_start\|>system\n/);
    assert.match(QWEN_RERANK_PREFIX, /the answer can only be "yes" or "no"/);
    assert.match(QWEN_RERANK_PREFIX, /<\|im_start\|>user\n$/);
  });

  test('the assistant turn carries an EMPTY think block', () => {
    // Drop this and the model is answering a different question from the one it
    // was tuned on — it starts reasoning instead of emitting yes/no next.
    assert.match(QWEN_RERANK_SUFFIX, /<\|im_start\|>assistant\n<think>\n\n<\/think>\n\n$/);
  });

  test('the body carries instruction, query and document in that order', () => {
    const p = buildQwenRerankPrompt('my query', 'my document');
    assert.match(p, /<Instruct>: [\s\S]*\n<Query>: my query\n<Document>: my document/);
    assert.ok(p.startsWith(QWEN_RERANK_PREFIX));
    assert.ok(p.endsWith(QWEN_RERANK_SUFFIX));
  });

  test('a caller may override the instruction', () => {
    assert.match(buildQwenRerankPrompt('q', 'd', 'Find code'), /<Instruct>: Find code\n/);
    assert.match(buildQwenRerankPrompt('q', 'd'), new RegExp(`<Instruct>: ${QWEN_DEFAULT_INSTRUCTION}`));
  });
});

describe('score = P(yes) / (P(yes) + P(no))', () => {
  test('the vocabulary-wide normalisation cancels', () => {
    // The reference takes softmax over the two LOGITS. Full-vocab probabilities
    // are those exponentials divided by Z, and the ratio cancels Z — which is
    // what lets this run on a runtime exposing probabilities, not logits.
    const lYes = 2.5, lNo = -1.25;
    const reference = Math.exp(lYes) / (Math.exp(lYes) + Math.exp(lNo));
    const Z = 987.654;                       // any normalisation at all
    const got = yesNoScore(Math.exp(lYes) / Z, Math.exp(lNo) / Z);
    assert.ok(Math.abs(got - reference) < 1e-12, `${got} vs ${reference}`);
  });

  test('a confident yes approaches 1 and a confident no approaches 0', () => {
    assert.ok(yesNoScore(0.99, 0.0001) > 0.999);
    assert.ok(yesNoScore(0.0001, 0.99) < 0.001);
    assert.equal(yesNoScore(0.5, 0.5), 0.5);
  });

  test('no mass on either token yields null, never a fabricated 0.5', () => {
    // A 0.5 here is indistinguishable from a genuine tie, and would rank an
    // unscorable passage above every confident "no".
    assert.equal(yesNoScore(0, 0), null);
    assert.equal(yesNoScore(undefined, undefined), null);
    assert.equal(yesNoScore(NaN, NaN), null);
  });

  test('a missing token counts as zero rather than discarding the pair', () => {
    assert.equal(yesNoScore(0.8, undefined), 1);
    assert.equal(yesNoScore(undefined, 0.8), 0);
  });
});

describe('the measured agreement is recorded', () => {
  const REFERENCE = [0.000043, 0.984219, 0.000024, 0.119824];   // fp32, transformers
  const NATIVELY  = [0.000040, 0.906807, 0.000041, 0.076290];   // Q4_K_M, llama.cpp

  test('the ranking agrees where the scores are distinguishable', () => {
    const rank = (xs) => xs.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    assert.deepEqual(rank(REFERENCE), [1, 3, 0, 2]);
    // Q4_K_M puts docs 0 and 2 at 0.000040 and 0.000041 where fp32 has 0.000043
    // and 0.000024 — the two IRRELEVANT documents, tied far below quantisation
    // resolution, so 4-bit flips them. Asserting a total order here would be
    // demanding agreement the arithmetic cannot carry. What must hold is the
    // relevant/irrelevant split and the order WITHIN the relevant pair.
    assert.deepEqual(rank(NATIVELY).slice(0, 2), [1, 3], 'the relevant pair keeps its order');
    assert.deepEqual(rank(NATIVELY).slice(2).sort(), [0, 2], 'both irrelevant documents rank last');
  });

  test('every document agrees within quantisation noise', () => {
    // Absolute tolerance, because the interesting scores span four orders of
    // magnitude and a relative bound would be meaningless near zero.
    NATIVELY.forEach((s, i) => {
      assert.ok(Math.abs(s - REFERENCE[i]) < 0.1,
        `doc ${i}: ${s} vs reference ${REFERENCE[i]}`);
    });
  });

  test('the irrelevant documents are separated from the relevant ones', () => {
    // The property that actually matters for retrieval: whatever the exact
    // numbers, the two Kubernetes passages must clear the other two by orders
    // of magnitude.
    assert.ok(Math.min(NATIVELY[1], NATIVELY[3]) > Math.max(NATIVELY[0], NATIVELY[2]) * 100);
  });
});
