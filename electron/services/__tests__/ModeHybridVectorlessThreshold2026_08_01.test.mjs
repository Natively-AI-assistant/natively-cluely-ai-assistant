// Defect F-C (2026-08-01): a chunk degraded to lexical-only INSIDE the hybrid
// path (batch embed failure / mid-query embedding-space flip) was still
// filtered against the COMBINED-scale floor: combined = FTS_WEIGHT * fts, so
// the lexical arm had to clear a bar calibrated for both arms together. F23
// fixed the explicit lexical branches only; on the transition turn after an
// embedding-provider failure the hybrid path returned ZERO chunks for
// questions whose answers were in the corpus — a mid-session "the résumé
// disappeared" symptom in Recruiting.

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadRetriever() {
  const distPath = path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js');
  return await import(pathToFileURL(distPath).href);
}

describe('ModeHybridRetriever — vectorless chunks judged on the lexical scale', () => {
  test('batch-embed failure mid-hybrid still admits partial lexical matches', async () => {
    const { ModeHybridRetriever } = await loadRetriever();

    const mockDb = {
      prepare: mock.fn(() => ({ get: mock.fn(() => null), all: mock.fn(() => []), run: mock.fn() })),
      exec: mock.fn(() => {}),
    };
    const mockVectorStore = { searchSimilar: mock.fn(() => Promise.resolve([])), hasEmbeddings: mock.fn(() => false) };
    const mockEmbeddingPipeline = {
      isReady: mock.fn(() => true),
      // The QUERY embeds fine — the degradation hits the chunk batch, exactly
      // the shape of a provider dying between the query call and the batch.
      getEmbeddingForQuery: mock.fn(() => Promise.resolve([0.1, 0.2, 0.3, 0.4])),
      getEmbeddingsWithFallback: mock.fn(() => Promise.reject(new Error('provider 429 — promoted to fallback'))),
      getEmbedding: mock.fn(() => Promise.reject(new Error('provider 429'))),
      getActiveProviderName: mock.fn(() => 'test-provider'),
    };

    const retriever = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);

    // The chunk shares SOME query vocabulary (a real partial match) but not
    // enough to clear the combined-scale floor on its lexical arm alone.
    const files = [{
      id: 'file_resume',
      modeId: 'mode1',
      fileName: 'candidate-resume.txt',
      content: 'Maya built the QueueFlow distributed job queue at Streamline with exactly-once delivery semantics.',
      createdAt: new Date().toISOString(),
    }];

    const result = await retriever.retrieve({
      query: 'how many retailers did the QueueFlow platform integration ultimately cover overall',
      modeId: 'mode1',
      files,
      tokenBudget: 1000,
      topK: 3,
    });

    assert.ok(result.chunks.length > 0,
      'a vectorless partial lexical match must survive the floor on the lexical scale — pre-fix this returned zero chunks');
  });
});
