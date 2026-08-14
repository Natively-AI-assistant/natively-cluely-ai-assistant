// electron/services/__tests__/ModeBatchEmbedding.test.mjs
//
// Regression for FIX-003: ModeHybridRetriever used to call
// EmbeddingPipeline.getEmbedding(text) once per chunk in a sequential
// `for await` loop. With OpenAI/Gemini providers the per-chunk latency
// dominates the answer flow on cold-start (one HTTP round-trip per chunk).
//
// The fix: prefer `EmbeddingPipeline.getEmbeddings(texts)` which routes
// through `provider.embedBatch(texts)` — a single batched call. For
// pipelines without `getEmbeddings` (old tests, mocks), fall back to
// `Promise.all(map(getEmbedding))` so we still get concurrency, never the
// old sequential path.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hybridMod = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js')).href
);
const { ModeHybridRetriever } = hybridMod;

function makeDbStub() {
  return {
    exec: () => {},
    prepare: () => ({ get: () => null, run: () => {}, all: () => [] }),
  };
}

const FILES_LONG = (() => {
  // Produce a single file long enough to force chunking — CHUNK_WORDS=140,
  // so >280 words yields ≥2 overlapping chunks.
  const words = Array(700).fill('lorem ipsum dolor sit amet consectetur adipiscing elit').join(' ');
  return [
    {
      id: 'big-file',
      modeId: 'mode_x',
      fileName: 'big.md',
      content: `${words} unique-sentinel-token-12345`,
      createdAt: '2026-05-15T00:00:00.000Z',
    },
  ];
})();

describe('FIX-003: ModeHybridRetriever batches chunk embeddings', () => {
  test('calls getEmbeddings(texts[]) once for all chunks when the provider supports it', async () => {
    const calls = { batch: 0, single: 0, totalBatchTexts: 0 };
    const pipeline = {
      isReady: () => true,
      getEmbedding: async () => { calls.single++; return [0.1, 0.1, 0.1]; },
      getEmbeddings: async (texts) => {
        calls.batch++;
        calls.totalBatchTexts += texts.length;
        return texts.map(() => [0.1, 0.1, 0.1]);
      },
      getEmbeddingForQuery: async () => [0.1, 0.1, 0.1],
    };
    const r = new ModeHybridRetriever(makeDbStub(), {}, pipeline);
    await r.retrieve({
      query: 'lorem ipsum unique sentinel token',
      modeId: 'mode_x',
      files: FILES_LONG,
    });
    assert.equal(calls.single, 0, 'Sequential per-chunk getEmbedding must NOT be called on the batch path');
    assert.equal(calls.batch, 1, 'getEmbeddings (batch) must be called exactly once for all chunks');
    assert.ok(calls.totalBatchTexts >= 2, `Expected batch to receive multiple chunks (got ${calls.totalBatchTexts})`);
  });

  test('falls back to Promise.all(map(getEmbedding)) when pipeline lacks getEmbeddings', async () => {
    const calls = { single: 0, batch: 0 };
    const pipeline = {
      isReady: () => true,
      // No getEmbeddings on purpose — exercises the compat path.
      getEmbedding: async () => { calls.single++; return [0.1, 0.1, 0.1]; },
      getEmbeddingForQuery: async () => [0.1, 0.1, 0.1],
    };
    const r = new ModeHybridRetriever(makeDbStub(), {}, pipeline);
    await r.retrieve({
      query: 'lorem ipsum unique sentinel token',
      modeId: 'mode_x',
      files: FILES_LONG,
    });
    assert.equal(calls.batch, 0);
    assert.ok(calls.single >= 2, `Expected per-chunk getEmbedding to be called for fallback. Got ${calls.single} calls.`);
  });

  test('parallel fallback: getEmbedding calls overlap (Promise.all) rather than serializing', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const pipeline = {
      isReady: () => true,
      getEmbedding: async () => {
        concurrent++;
        if (concurrent > maxConcurrent) maxConcurrent = concurrent;
        // Yield to the event loop so concurrent calls actually overlap.
        await new Promise(r => setImmediate(r));
        concurrent--;
        return [0.1, 0.1, 0.1];
      },
      getEmbeddingForQuery: async () => [0.1, 0.1, 0.1],
    };
    const r = new ModeHybridRetriever(makeDbStub(), {}, pipeline);
    await r.retrieve({
      query: 'lorem ipsum unique sentinel token',
      modeId: 'mode_x',
      files: FILES_LONG,
    });
    assert.ok(maxConcurrent >= 2, `Compat path must run getEmbedding calls in parallel. Observed max concurrency ${maxConcurrent}.`);
  });

  test('batch result length mismatch is handled gracefully (warns, does not crash)', async () => {
    const pipeline = {
      isReady: () => true,
      // Return fewer vectors than texts — simulates a buggy provider.
      getEmbeddings: async (texts) => texts.slice(0, Math.max(0, texts.length - 1)).map(() => [0.1, 0.1, 0.1]),
      getEmbedding: async () => [0.1, 0.1, 0.1],
      getEmbeddingForQuery: async () => [0.1, 0.1, 0.1],
    };
    const r = new ModeHybridRetriever(makeDbStub(), {}, pipeline);
    let threw = false;
    try {
      await r.retrieve({ query: 'lorem ipsum sentinel', modeId: 'mode_x', files: FILES_LONG });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'Length-mismatch must not crash the retriever — must degrade gracefully');
  });

  test('batch failure degrades to lexical-only (not whole-mode loss)', async () => {
    // Pre-FIX-003 a sequential per-chunk loop swallowed a single bad chunk's
    // error and carried on. Batch semantics changed that to "all or nothing"
    // and the old code threw, losing the entire mode's retrieval. The fix
    // catches the batch failure and degrades to lexical-only.
    const pipeline = {
      isReady: () => true,
      getEmbeddings: async () => { throw new Error('synthetic batch failure (e.g. one bad chunk)'); },
      getEmbedding: async () => { throw new Error('should not be called on batch path'); },
      getEmbeddingForQuery: async () => [0.1, 0.1, 0.1],
    };
    const r = new ModeHybridRetriever(makeDbStub(), {}, pipeline);
    const result = await r.retrieve({
      query: 'unique-sentinel-token-12345 lorem ipsum',
      modeId: 'mode_x',
      files: FILES_LONG,
    });
    // The query should still match via FTS — vector path is degraded to 0
    // but the lexical signal carries the relevance.
    assert.ok(result.chunks.length > 0, 'Batch failure must degrade to lexical-only, not lose the whole mode');
    // Every chunk's vectorScore must be 0 because the batch failed.
    for (const c of result.chunks) {
      assert.equal(c.vectorScore, 0, 'Failed-batch chunks must have vectorScore=0 (vector path degraded)');
      assert.ok(c.ftsScore > 0, 'FTS score must still drive relevance after batch failure');
    }
  });

  test('hybrid result still includes chunks (sanity: batching does not break the happy path)', async () => {
    const pipeline = {
      isReady: () => true,
      getEmbeddings: async (texts) => texts.map(() => [0.5, 0.5, 0.5]),
      getEmbeddingForQuery: async () => [0.5, 0.5, 0.5],
      getEmbedding: async () => [0.5, 0.5, 0.5],
    };
    const r = new ModeHybridRetriever(makeDbStub(), {}, pipeline);
    const result = await r.retrieve({
      query: 'unique-sentinel-token-12345 lorem ipsum',
      modeId: 'mode_x',
      files: FILES_LONG,
    });
    assert.ok(result.usedHybrid, 'usedHybrid must be true when embeddings are available');
    assert.ok(result.chunks.length > 0, 'Hybrid retrieval must produce at least one chunk');
  });
});
