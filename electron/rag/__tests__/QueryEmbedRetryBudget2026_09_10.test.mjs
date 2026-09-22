// A live turn's query embedding must not out-wait the turn (2026-09-10).
//
// Measured with the hosted embed route slow: getEmbeddingForQuery ran its
// full ladder — 3 s timeout, 1.1 s backoff, 3 s, 3.2 s, 3 s = 13.3 s — inside
// a retrieval the V3 orchestrator plans at 1200 ms, before the model was asked.
// The ladder is right for ingestion and for a manual chat with an 8 s budget;
// on a live turn the lexical arm makes a retry pointless. The caller now
// passes `retryBudgetMs` and a retry runs only when its backoff plus its own
// timeout still fit. Attempt counts are asserted by shape, never by sleeping:
// the fake provider's backoff is zeroed, so the budget arithmetic alone decides.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { EmbeddingPipeline } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/rag/EmbeddingPipeline.js'));

const VEC = [0.1, 0.2, 0.3];
function makeProvider(name, space, behaviour) {
  let calls = 0;
  return {
    name, space, dimensions: VEC.length,
    get calls() { return calls; },
    async embedQuery() { calls++; const outcome = typeof behaviour === 'function' ? behaviour(calls) : behaviour; if (outcome instanceof Error) throw outcome; return VEC; },
    async embed() { return VEC; },
  };
}
function makePipeline(primary, fallback) {
  const p = Object.create(EmbeddingPipeline.prototype);
  p.provider = primary; p.fallbackProvider = fallback;
  p.db = { prepare: () => ({ run: () => {} }) };
  p.queryFailureHistory = []; p.primaryReprobeTimer = null;
  p.queryRetryBackoffMs = [0, 0];
  return p;
}
const down = () => new Error('embedQuery() timed out after 3000ms');

describe('query-embed retries respect the caller\'s budget', () => {
  test('a 1200 ms live budget allows exactly ONE attempt — the 3 s retry cannot fit', async () => {
    const primary = makeProvider('natively', 'natively:voyage-4:2048', down());
    const p = makePipeline(primary, makeProvider('local', 'local:minilm:384', VEC));
    await assert.rejects(() => p.getEmbeddingForQuery('q', { retryBudgetMs: 1200 }), /timed out/);
    assert.equal(primary.calls, 1, 'no retry may start when backoff + 3000 ms exceeds the budget');
    assert.equal(p.provider, primary, 'one bounded failure never changes the space');
  });

  test('a generous budget keeps the full ladder', async () => {
    const primary = makeProvider('natively', 'natively:voyage-4:2048', down());
    const p = makePipeline(primary, makeProvider('local', 'local:minilm:384', VEC));
    await assert.rejects(() => p.getEmbeddingForQuery('q', { retryBudgetMs: 20_000 }));
    assert.equal(primary.calls, 3, 'three attempts fit in 20 s');
  });

  test('no budget means the historical ladder (ingest / manual callers are untouched)', async () => {
    const primary = makeProvider('natively', 'natively:voyage-4:2048', down());
    const p = makePipeline(primary, makeProvider('local', 'local:minilm:384', VEC));
    await assert.rejects(() => p.getEmbeddingForQuery('q'));
    assert.equal(primary.calls, 3);
  });

  test('a first-attempt success under a budget is just a success', async () => {
    const primary = makeProvider('natively', 'natively:voyage-4:2048', VEC);
    const p = makePipeline(primary, null);
    assert.deepEqual(await p.getEmbeddingForQuery('q', { retryBudgetMs: 1200 }), VEC);
    assert.equal(primary.calls, 1);
    assert.equal(p.queryFailureHistory.length, 0);
  });
});
