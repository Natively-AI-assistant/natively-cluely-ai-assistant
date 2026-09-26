// T13 (RC12) — one transient embedding failure used to cost the whole session
// its embedding space.
//
// THE DAMAGE. `getEmbeddingForQuery` made ONE attempt. Any failure — a Gemini
// 429, a timeout, a network blip — fell straight through to MiniLM and PROMOTED
// it. Promotion rewrites the active space to `local:…:384`, which makes every
// persisted Gemini vector in the corpus unusable at a stroke: ~90 chunks must be
// re-embedded ephemerally inside a single timeout, and whatever does not make it
// degrades to FTS-only. `text-embedding-004` returning 404 partway through this
// investigation is a live demonstration of how ordinary that blip is.
//
// The startup probe had already solved this shape — EmbeddingProviderResolver's
// CLOUD_PROBE_ATTEMPTS/BACKOFF, whose docblock describes this exact thrash and
// the billed re-index it causes. The query path never had it.
//
// THE CONTRACT NOW, and each clause is asserted below:
//   • a transient failure changes nothing observable except latency;
//   • a burst degrades the TURN to lexical-only, with the space unchanged —
//     because degrading one turn is cheaper than flipping a session;
//   • only a SUSTAINED outage promotes, and it says so loudly;
//   • a promotion schedules its own demotion, so recovery is automatic.
//
// Timing is asserted by shape (attempt counts, ordering), never by sleeping —
// the backoff is seconds long and a test that waited for it would be a test that
// nobody runs.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);

const { EmbeddingPipeline } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/rag/EmbeddingPipeline.js'));

const VEC = [0.1, 0.2, 0.3];

function makeProvider(name, space, behaviour) {
  let calls = 0;
  return {
    name,
    space,
    dimensions: VEC.length,
    get calls() { return calls; },
    async embedQuery() {
      calls++;
      const outcome = typeof behaviour === 'function' ? behaviour(calls) : behaviour;
      if (outcome instanceof Error) throw outcome;
      return VEC;
    },
    async embed() { return VEC; },
  };
}

const rateLimit = () => Object.assign(new Error('429 Too Many Requests'), { status: 429, retryAfter: 0 });
const hardDown = () => new Error('ECONNREFUSED');

/** A pipeline with its DB and timers stubbed — only the query path is exercised. */
function makePipeline(primary, fallback) {
  const p = Object.create(EmbeddingPipeline.prototype);
  p.provider = primary;
  p.fallbackProvider = fallback;
  p.db = { prepare: () => ({ run: () => {} }) };
  p.queryFailureHistory = [];
  p.primaryReprobeTimer = null;
  // Real backoff is 1s + 3s per failed call — two minutes for this suite, which
  // is how a guard stops being run. The ORDERING and the attempt COUNTS are what
  // these tests assert; the wall-clock delay is not.
  p.queryRetryBackoffMs = [0, 0];
  return p;
}

describe('T13 — a transient failure costs latency, nothing else', () => {
  test('one failure then success: the primary answers, the space is untouched', async () => {
    const primary = makeProvider('gemini', 'gemini:v2:768', (n) => (n === 1 ? rateLimit() : VEC));
    const fallback = makeProvider('local', 'local:minilm:384', VEC);
    const p = makePipeline(primary, fallback);

    assert.deepEqual(await p.getEmbeddingForQuery('q'), VEC);
    assert.equal(primary.calls, 2, 'the primary must be retried in place');
    assert.equal(fallback.calls, 0, 'the fallback must not be consulted for a transient failure');
    assert.equal(p.provider, primary, 'the active provider — and so the embedding space — must not change');
  });

  test('a success CLEARS the streak — the bar is CONSECUTIVE failures', async () => {
    // Otherwise five failures spread over an afternoon, each recovered from,
    // would eventually promote for no reason.
    let mode = 'down';
    const primary = makeProvider('gemini', 'gemini:v2:768', () => (mode === 'down' ? hardDown() : VEC));
    const p = makePipeline(primary, makeProvider('local', 'local:minilm:384', VEC));

    for (let i = 0; i < 4; i++) await p.getEmbeddingForQuery('q').catch(() => {});
    assert.equal(p.queryFailureHistory.length, 4);

    mode = 'up';
    await p.getEmbeddingForQuery('q');
    assert.equal(p.queryFailureHistory.length, 0, 'one success must reset the streak');
  });
});

describe('T13 — a burst degrades the TURN, not the session', () => {
  test('below the promotion threshold the call THROWS and the space is unchanged', async () => {
    const primary = makeProvider('gemini', 'gemini:v2:768', hardDown());
    const fallback = makeProvider('local', 'local:minilm:384', VEC);
    const p = makePipeline(primary, fallback);

    await assert.rejects(() => p.getEmbeddingForQuery('q'), /ECONNREFUSED/);
    assert.equal(p.provider, primary, 'the active space must survive a burst');
    assert.equal(fallback.calls, 0,
      'MiniLM must NOT be queried: its vector lives in a space no persisted document shares, '
      + 'and cross-space cosine is guarded to 0 — confident nonsense instead of an honest miss');
  });

  test('the caller can tell degradation from success, so it can use its lexical arm', async () => {
    // The throw IS the signal. Returning a vector from the wrong space would be
    // indistinguishable from a good answer and silently wrong.
    const p = makePipeline(makeProvider('gemini', 'gemini:v2:768', hardDown()), null);
    await assert.rejects(() => p.getEmbeddingForQuery('q'));
  });
});

describe('T13 — only a sustained outage promotes, and it undoes itself', () => {
  test('the 5th consecutive hard failure promotes the fallback', async () => {
    const primary = makeProvider('gemini', 'gemini:v2:768', hardDown());
    const fallback = makeProvider('local', 'local:minilm:384', VEC);
    const p = makePipeline(primary, fallback);

    for (let i = 0; i < 4; i++) {
      await assert.rejects(() => p.getEmbeddingForQuery('q'));
      assert.equal(p.provider, primary, `still on the primary after ${i + 1} failures`);
    }

    assert.deepEqual(await p.getEmbeddingForQuery('q'), VEC, 'the 5th must be served by the fallback');
    assert.equal(p.provider, fallback, 'and the fallback becomes active');
    p.stopPrimaryReprobe();
  });

  test('a promotion schedules its own demotion', async () => {
    const primary = makeProvider('gemini', 'gemini:v2:768', hardDown());
    const p = makePipeline(primary, makeProvider('local', 'local:minilm:384', VEC));
    for (let i = 0; i < 5; i++) await p.getEmbeddingForQuery('q').catch(() => {});
    assert.ok(p.primaryReprobeTimer,
      'without a re-probe a two-minute outage costs the cloud space until the app restarts');
    p.stopPrimaryReprobe();
  });

  test('the recovery probe demotes and restores the primary space', async () => {
    let up = false;
    const primary = makeProvider('gemini', 'gemini:v2:768', () => (up ? VEC : hardDown()));
    const fallback = makeProvider('local', 'local:minilm:384', VEC);
    const p = makePipeline(primary, fallback);
    for (let i = 0; i < 5; i++) await p.getEmbeddingForQuery('q').catch(() => {});
    assert.equal(p.provider, fallback);

    // Drive the probe body directly rather than waiting a minute for the timer.
    up = true;
    p.promoteFallbackProvider(primary);
    assert.equal(p.provider, primary,
      'demotion restores the space the persisted vectors are ALREADY in — it ends a re-index, not starts one');
    p.stopPrimaryReprobe();
  });

  test('with no fallback configured, a sustained outage still never flips the space', async () => {
    const primary = makeProvider('gemini', 'gemini:v2:768', hardDown());
    const p = makePipeline(primary, null);
    for (let i = 0; i < 6; i++) await assert.rejects(() => p.getEmbeddingForQuery('q'));
    assert.equal(p.provider, primary);
  });
});

describe('T13 / D4.6 — ingestion never writes vectors into the wrong space', () => {
  // THE FAILURE THIS CLOSES. A rate-limit burst DURING INGESTION used to fall
  // straight to the fallback and promote it, so the file's vectors were written
  // with `space = local:…:384` and persisted that way. The query path's
  // hysteresis cannot help: by the time a query runs the wrong vectors are
  // already on disk, and cross-space cosine is guarded to 0, so the file simply
  // stops being retrievable — silently, and with no error anywhere.
  //
  // Note what the fix prefers: FAILING the batch. The caller already treats a
  // batch failure as "persist the chunk TEXT, mark the file for a later retry",
  // so the file stays lexically searchable and gets fixed on the next prewarm.
  // Lexical-until-the-primary-returns is strictly better than
  // permanently-wrong-space, because the second is invisible and never retried.
  function makeBatchPipeline(primary, fallback) {
    const p = Object.create(EmbeddingPipeline.prototype);
    p.provider = primary;
    p.fallbackProvider = fallback;
    p.db = { prepare: () => ({ run: () => {} }) };
    p.queryFailureHistory = [];
    p.primaryReprobeTimer = null;
    p.queryRetryBackoffMs = [0, 0];
    return p;
  }

  function batchProvider(name, space, behaviour) {
    let calls = 0;
    return {
      name, space, dimensions: VEC.length,
      get calls() { return calls; },
      async embedBatch(texts) {
        calls++;
        const outcome = typeof behaviour === 'function' ? behaviour(calls) : behaviour;
        if (outcome instanceof Error) throw outcome;
        return texts.map(() => VEC);
      },
      async embedQuery() { return VEC; },
    };
  }

  test('a transient burst is retried on the primary, and the space is preserved', async () => {
    const primary = batchProvider('gemini', 'gemini:v2:768', (n) => (n === 1 ? rateLimit() : null));
    const fallback = batchProvider('local', 'local:minilm:384', null);
    const p = makeBatchPipeline(primary, fallback);

    const out = await p.getEmbeddingsWithFallback(['a', 'b']);
    assert.equal(out.space, 'gemini:v2:768', 'vectors must be stamped with the PRIMARY space');
    assert.equal(primary.calls, 2, 'the primary must be retried in place');
    assert.equal(fallback.calls, 0);
  });

  test('below the streak the batch FAILS rather than writing to the fallback space', async () => {
    const primary = batchProvider('gemini', 'gemini:v2:768', hardDown());
    const fallback = batchProvider('local', 'local:minilm:384', null);
    const p = makeBatchPipeline(primary, fallback);

    await assert.rejects(() => p.getEmbeddingsWithFallback(['a']), /ECONNREFUSED/);
    assert.equal(fallback.calls, 0, 'no vectors may be written into a space the corpus is not in');
    assert.equal(p.provider, primary, 'the active space must be unchanged');
  });

  test('a sustained outage still promotes, so ingestion is never permanently blocked', async () => {
    const primary = batchProvider('gemini', 'gemini:v2:768', hardDown());
    const fallback = batchProvider('local', 'local:minilm:384', null);
    const p = makeBatchPipeline(primary, fallback);

    for (let i = 0; i < 4; i++) await assert.rejects(() => p.getEmbeddingsWithFallback(['a']));
    const out = await p.getEmbeddingsWithFallback(['a']);
    assert.equal(out.space, 'local:minilm:384');
    assert.equal(p.provider, fallback);
    p.stopPrimaryReprobe();
  });

  test('ingestion and query share ONE failure streak', async () => {
    // They are watching the same outage. Two counters would each need five
    // failures to agree on one fact, doubling the time spent degraded.
    const primary = batchProvider('gemini', 'gemini:v2:768', hardDown());
    primary.embedQuery = async () => { throw hardDown(); };
    const p = makeBatchPipeline(primary, batchProvider('local', 'local:minilm:384', null));

    await assert.rejects(() => p.getEmbeddingsWithFallback(['a']));
    assert.equal(p.queryFailureHistory.length, 1);
    await assert.rejects(() => p.getEmbeddingForQuery('q'));
    assert.equal(p.queryFailureHistory.length, 2, 'the query path must see the ingestion failure');
    assert.equal(p.queryFailureHistory[0].reason, 'ingest_embed_hard_failure');
  });
});
