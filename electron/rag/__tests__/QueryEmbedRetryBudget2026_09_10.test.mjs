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
const { EmbeddingPipeline, planQueryEmbedRetry } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/rag/EmbeddingPipeline.js'));

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
  // REVISED 2026-09-30. This test used to pin "a 1200 ms live budget allows
  // exactly ONE attempt", because the guard added each retry's FULL 3000 ms
  // timeout to the budget arithmetic — which a 1200 ms budget can never fit, so
  // a live query embed was never retried and one transient 5xx sent the turn to
  // lexical-only retrieval. A FAST failure now gets one short retry whose
  // timeout is clipped to what the budget has left; a slow failure still gets
  // none (next test). The space stays untouched either way.
  test('a 1200 ms live budget: a FAST failure gets exactly one short retry', async () => {
    const primary = makeProvider('natively', 'natively:voyage-4:2048', down());
    const p = makePipeline(primary, makeProvider('local', 'local:minilm:384', VEC));
    await assert.rejects(() => p.getEmbeddingForQuery('q', { retryBudgetMs: 1200 }), /timed out/);
    assert.equal(primary.calls, 2, 'one in-budget retry, never the full ladder');
    assert.equal(p.provider, primary, 'one bounded failure never changes the space');
  });

  test('a 1200 ms live budget: a transient first failure is RESCUED by the retry', async () => {
    const primary = makeProvider('natively', 'natively:voyage-4:2048', (n) => (n === 1 ? new Error('503 Service Unavailable') : VEC));
    const p = makePipeline(primary, makeProvider('local', 'local:minilm:384', VEC));
    assert.deepEqual(await p.getEmbeddingForQuery('q', { retryBudgetMs: 1200 }), VEC);
    assert.equal(primary.calls, 2);
  });

  test('a 1200 ms live budget: a SLOW failure that spent the budget is not retried', async () => {
    let calls = 0;
    const slow = {
      name: 'natively', space: 'natively:voyage-4:2048', dimensions: VEC.length,
      async embedQuery() { calls++; await new Promise((r) => setTimeout(r, 900)); throw new Error('502 Bad Gateway'); },
      async embed() { return VEC; },
    };
    const p = makePipeline(slow, makeProvider('local', 'local:minilm:384', VEC));
    await assert.rejects(() => p.getEmbeddingForQuery('q', { retryBudgetMs: 1200 }), /502/);
    assert.equal(calls, 1, 'at most ~300 ms would remain — under the 500 ms attempt floor');
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

describe('planQueryEmbedRetry — the budget arithmetic (2026-09-30)', () => {
  const base = { backoffBaseMs: 1000, jitter: 0 };
  test('V3 1200 ms budget, fast first failure: one short retry clipped to the remaining budget', () => {
    const plan = planQueryEmbedRetry({ ...base, attempt: 0, elapsedMs: 120, budgetMs: 1200 });
    assert.equal(plan.retry, true);
    assert.ok(plan.waitMs <= 250, `short backoff, got ${plan.waitMs}`);
    assert.ok(120 + plan.waitMs + plan.timeoutMs <= 1200, 'the retry never outruns the plan');
    assert.ok(plan.timeoutMs >= 500);
  });
  test('the old guard never fit: 0 ms elapsed + 1000 ms backoff + 3000 ms timeout > 1200 ms', () => {
    // Under the pre-2026-09-30 rule this was ALWAYS "no retry" for a 1200 ms plan.
    assert.ok(0 + 1000 + 3000 > 1200);
    assert.equal(planQueryEmbedRetry({ ...base, attempt: 0, elapsedMs: 0, budgetMs: 1200 }).retry, true);
  });
  test('a budgeted call takes at most one SHORT retry', () => {
    assert.equal(planQueryEmbedRetry({ ...base, attempt: 1, elapsedMs: 300, budgetMs: 1200 }).retry, false);
  });
  test('no retry when under 500 ms would remain', () => {
    assert.equal(planQueryEmbedRetry({ ...base, attempt: 0, elapsedMs: 700, budgetMs: 1200 }).retry, false);
    assert.equal(planQueryEmbedRetry({ ...base, attempt: 0, elapsedMs: 3000, budgetMs: 1200 }).retry, false, 'a 3 s timeout has already spent the budget');
  });
  test('a provider Retry-After is honoured, never shortened — and skipped when it does not fit', () => {
    const fits = planQueryEmbedRetry({ ...base, attempt: 0, elapsedMs: 100, budgetMs: 2400, retryAfterMs: 400 });
    assert.equal(fits.retry, true); assert.equal(fits.waitMs, 400);
    assert.equal(planQueryEmbedRetry({ ...base, attempt: 0, elapsedMs: 100, budgetMs: 1200, retryAfterMs: 1000 }).retry, false);
  });
  test('generous and absent budgets keep the historical ladder', () => {
    const g = planQueryEmbedRetry({ ...base, attempt: 1, elapsedMs: 4000, budgetMs: 20_000 });
    assert.deepEqual([g.retry, g.timeoutMs], [true, 3000]);
    const u = planQueryEmbedRetry({ ...base, attempt: 1, elapsedMs: 4000 });
    assert.deepEqual([u.retry, u.waitMs, u.timeoutMs], [true, 1000, 3000]);
    assert.equal(planQueryEmbedRetry({ ...base, attempt: 2, elapsedMs: 0 }).retry, false, 'attempts exhausted');
  });
});
