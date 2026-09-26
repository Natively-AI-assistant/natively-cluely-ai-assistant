// The query path must never re-embed a corpus (2026-09-10).
//
// After an embedding-provider promotion (five hosted failures) or a Settings
// switch, NO persisted vector matches the active space, so every chunk of
// every attached file is "missing". performHybridRetrieval handed all of them
// to ONE getEmbeddingsWithFallback() call: 629 chunks of a 420 KB reference
// pack went through the local ONNX worker as a single batch and the process
// died with SIGTRAP in onnxruntime::MatMul → CPUAllocator::Alloc
// (Electron-2026-09-10-215850.ips; the user's own Electron-2026-09-08-143050
// has the same frames). The ingest path bounds its batches (F22); this was
// the one unbounded batch left. Above QUERY_EPHEMERAL_EMBED_MAX the chunks
// score lexically for the turn and the background re-index persists them.

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ModeHybridRetriever, QUERY_EPHEMERAL_EMBED_MAX } = await import(pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js')).href);

function harness() {
  const batches = [];
  const pipeline = {
    isReady: mock.fn(() => true),
    getActiveProviderName: mock.fn(() => 'gemini'),
    getActiveSpaceKey: mock.fn(() => 'gemini:v2:4'),
    getEmbeddingForQuery: mock.fn(() => Promise.resolve([0.1, 0.2, 0.3, 0.4])),
    getEmbeddingsWithFallback: mock.fn((texts) => { batches.push(texts.length); return Promise.resolve({ embeddings: texts.map(() => [0.1, 0.2, 0.3, 0.4]), space: 'gemini:v2:4' }); }),
    getEmbedding: mock.fn(() => Promise.resolve([0.1, 0.2, 0.3, 0.4])),
  };
  const db = { prepare: mock.fn(() => ({ get: mock.fn(() => null), all: mock.fn(() => []), run: mock.fn() })), exec: mock.fn(() => {}) };
  const hr = new ModeHybridRetriever(db, { searchSimilar: mock.fn(() => Promise.resolve([])), hasEmbeddings: mock.fn(() => false) }, pipeline);
  const reindexed = [];
  hr.indexFile = mock.fn(async (file) => { reindexed.push(file.id); });
  return { hr, batches, reindexed };
}

// Varied prose so the chunker actually splits it (a repeated-vocabulary doc
// collapses to one chunk — see LocalEmbedBatchF22.test.mjs).
const sentence = (i) => `Incident ${i} was traced to the dispatch service where the retry policy `
  + `applied backoff ${i * 7} milliseconds before the ledger reconciled record ${i * 13}.`;
const BIG = Array.from({ length: 120 }, (_, i) => `${sentence(i * 3)} ${sentence(i * 3 + 1)} ${sentence(i * 3 + 2)}`).join('\n\n');
const SMALL = Array.from({ length: 4 }, (_, i) => sentence(i)).join('\n\n');

describe('query-time ephemeral embedding is capped', () => {
  test(`a corpus with more than ${QUERY_EPHEMERAL_EMBED_MAX} vectorless chunks is NOT batch-embedded on the hot path`, async () => {
    const { hr, batches, reindexed } = harness();
    const files = [{ id: 'big', modeId: 'm', fileName: 'pack.md', content: BIG, createdAt: new Date().toISOString() }];
    const result = await hr.retrieve({ query: 'what backoff did the retry policy apply before the ledger reconciled', modeId: 'm', files, tokenBudget: 1800, topK: 6 });
    assert.equal(batches.length, 0, `no ephemeral batch may run above the cap; saw batches ${JSON.stringify(batches)}`);
    assert.deepEqual(reindexed, ['big'], 'the file is re-indexed in the background (bounded sub-batches) instead');
    assert.ok(result.chunks.length > 0, 'the turn still answers from the lexical arm');
  });

  test('a small vectorless set (a file uploaded a moment ago) is still embedded for this turn', async () => {
    const { hr, batches } = harness();
    const files = [{ id: 'small', modeId: 'm', fileName: 'note.md', content: SMALL, createdAt: new Date().toISOString() }];
    await hr.retrieve({ query: 'what backoff did the retry policy apply', modeId: 'm', files, tokenBudget: 1800, topK: 6 });
    assert.equal(batches.length, 1, 'one ephemeral batch for a handful of fresh chunks');
    assert.ok(batches[0] <= QUERY_EPHEMERAL_EMBED_MAX);
  });
});
