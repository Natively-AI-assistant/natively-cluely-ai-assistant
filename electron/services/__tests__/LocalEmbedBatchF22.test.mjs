// F22 regression — the LOCAL ONNX embedder needs a small indexing batch.
//
// A cloud batch of 100 is one HTTP request and is right there. The local
// provider instead runs all 100 forward passes inside a single worker message,
// so the ONNX arena grows across every one without the worker returning to its
// event loop. On a large document that reliably aborts the process with SIGTRAP
// — a NATIVE abort, so the fault-tolerant try/catch around each sub-batch cannot
// catch it, and the file is simply never indexed.
//
// Measured on test-fixtures/modes-corpus/thesis/institutional_thesis.pdf
// (66 pages, 128 184 chars):
//     batch 100 -> SIGTRAP, process dead, file unindexed
//     batch  16 -> indexes cleanly
//
// This asserts the BATCH SIZE rather than re-indexing the thesis, which takes
// minutes. The end-to-end proof is recorded in 10_BENCHMARK_RESULTS.md.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const { ModeHybridRetriever } = await import(
  path.resolve(process.cwd(), 'dist-electron/electron/services/modes/ModeHybridRetriever.js')
);

/** Records the size of every batch handed to the embedder. */
function makeHarness(providerName) {
  const batchSizes = [];
  const pipeline = {
    isReady: () => true,
    getActiveProviderName: () => providerName,
    getActiveSpaceKey: () => 'local:test:384',
    async getEmbeddingsWithFallback(slice) {
      batchSizes.push(slice.length);
      return { embeddings: slice.map(() => new Array(384).fill(0)), space: 'local:test:384' };
    },
    async getEmbeddingForQuery() { return new Array(384).fill(0); },
  };

  const db = { exec() {}, prepare() { return { run() {}, get() { return null; }, all() { return []; } }; } };

  const hr = new ModeHybridRetriever(db, null, pipeline);
  // Neutralise persistence and bookkeeping — this test is only about batch size.
  hr.persistChunks = () => {};
  hr.updateIndexState = () => {};
  hr.getIndexState = () => null;
  hr.ensureIndexTable = () => {};
  return { hr, batchSizes };
}

// Realistic prose, ~14k words -> ~150 chunks, well past any batch boundary.
//
// NOTE: a synthetic doc built from a tiny repeated vocabulary does NOT chunk —
// chunkText's tabular/section detectors treat the regular structure as one unit
// and return a single chunk, which silently made an earlier version of this test
// vacuous. Varied sentence text is required for it to mean anything.
const sentence = (i) => `The system processed record ${i} and stored the resulting value `
  + 'in the ledger for later reconciliation.';
const BIG_DOC = Array.from({ length: 300 }, (_, i) =>
  `${sentence(i * 3)} ${sentence(i * 3 + 1)} ${sentence(i * 3 + 2)}`,
).join('\n\n');

describe('F22 — indexing batch is provider-aware', () => {
  test('the LOCAL provider is batched small enough to survive', async () => {
    const { hr, batchSizes } = makeHarness('local');
    await hr.indexFile({ id: 'f1', fileName: 'big.txt', content: BIG_DOC });

    assert.ok(batchSizes.length > 1, 'a large document must be split into multiple batches');
    const max = Math.max(...batchSizes);
    assert.ok(max <= 16,
      `local batches must stay <= 16 to bound ONNX arena growth; saw ${max}. `
      + 'A batch of 100 aborts the process with SIGTRAP on a 66-page PDF.');
  });

  test('a CLOUD provider keeps the large batch — this is not a batching problem in general', async () => {
    const { hr, batchSizes } = makeHarness('gemini');
    await hr.indexFile({ id: 'f2', fileName: 'big.txt', content: BIG_DOC });

    const max = Math.max(...batchSizes);
    assert.ok(max > 16,
      `cloud batching must stay efficient (one request per batch); saw max ${max}. `
      + 'Shrinking it would multiply request count for no benefit.');
  });

  test('every chunk is still embedded — batching is not truncation', async () => {
    const { hr, batchSizes } = makeHarness('local');
    await hr.indexFile({ id: 'f3', fileName: 'big.txt', content: BIG_DOC });
    const total = batchSizes.reduce((a, b) => a + b, 0);
    assert.ok(total > 100, `expected the whole document to be embedded, saw ${total} chunks`);
  });
});
