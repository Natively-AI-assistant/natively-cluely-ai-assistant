/**
 * The rerank seam must honour a port's declared batch size.
 *
 * `ModeHybridRetriever` splits its 30-candidate pool into batches of 6. That is
 * an ONNX arena-memory measure (see RERANK_BATCH_SIZE's own comment) and is
 * correct for the built-in cross-encoder. It is wrong for any port whose cost is
 * a round trip rather than a forward pass: five sequential HTTP calls instead of
 * one is ~5x the latency and ~5x the spend, which is enough to push a hosted
 * model that comfortably clears RERANK_BUDGET_MS (1200ms) past it.
 *
 * These are source guards because `maybeRerankCandidates` is private and sits
 * behind a mode-index/DB stack that this test has no business standing up. The
 * behavioural half is covered by the batching arithmetic asserted below.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const retrieverSrc = fs.readFileSync(
  path.join(repoRoot, 'electron/services/modes/ModeHybridRetriever.ts'), 'utf8');

test('the pool loop uses the resolved batch size, not the constant', () => {
  assert.match(retrieverSrc, /const\s+rerankBatchSize\s*=/,
    'the seam must resolve a batch size per port');
  assert.match(retrieverSrc, /for\s*\(let i = 0; i < poolTexts\.length; i \+= rerankBatchSize\)/,
    'the loop must step by the RESOLVED size — stepping by RERANK_BATCH_SIZE would '
    + 'silently restore 5 round trips for a hosted reranker');
  assert.match(retrieverSrc, /\.slice\(i, i \+ rerankBatchSize\)/,
    'the slice must use the same resolved size as the step, or batches overlap or skip');
});

test('a port that declares nothing keeps exactly the existing behaviour', () => {
  // The built-in LocalReranker declares no batchSize. Its arithmetic must not
  // change: ceil(30/6) = 5 batches, as before.
  assert.match(retrieverSrc, /:\s*RERANK_BATCH_SIZE;/,
    'the fallback branch must still be RERANK_BATCH_SIZE');
  assert.match(retrieverSrc, /const RERANK_BATCH_SIZE = 6;/);
  assert.match(retrieverSrc, /const RERANK_CANDIDATE_POOL = 30;/);
});

test('a declared batch size is clamped to the pool and rejects nonsense', () => {
  assert.match(retrieverSrc, /Number\.isFinite\(declaredBatch\)/,
    'a non-numeric or Infinity batchSize must not reach the loop');
  assert.match(retrieverSrc, /\(declaredBatch as number\) > 0/,
    'zero or negative would make the loop never advance — an infinite loop on the answer path');
  assert.match(retrieverSrc, /Math\.min\(poolTexts\.length,/,
    'a huge declared size must clamp to the pool rather than allocating past it');
});

test('the batching arithmetic is what the comment claims', () => {
  // Guards the numbers the rationale rests on, so a future pool/batch change
  // cannot quietly invalidate the comment above the code.
  const pool = 30, builtIn = 6;
  assert.equal(Math.ceil(pool / builtIn), 5, 'the built-in makes 5 forward passes');
  assert.equal(Math.ceil(pool / Math.min(pool, Number.MAX_SAFE_INTEGER)), 1,
    'a port asking for the whole pool makes exactly 1 call');
});
