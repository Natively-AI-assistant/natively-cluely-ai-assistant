// electron/services/__tests__/ModeRetrievalConfidence.test.mjs
//
// Phase 0 (smart-retrieval rollout) — OBSERVE-ONLY retrieval-confidence signal.
//
// These tests pin three contracts:
//   (1) Flag OFF (default) → result is byte-for-byte the legacy shape: NO
//       `confidence` field at all. This is the no-regression guarantee.
//   (2) Flag ON → `confidence` is attached and `lowConfidence`/`reasons` are
//       derived correctly from the combined-score distribution.
//   (3) The signal NEVER changes which chunks are returned — same chunks/order
//       with the flag on vs off.
//
// The flag is env-driven (NATIVELY_RAG_CONFIDENCE_GATE) and read FRESH on every
// call (no cache), so toggling process.env mid-test is sufficient.

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadRetriever() {
  // Prefer the built bundle (matches how the app ships); fall back to source.
  try {
    const distPath = path.resolve(
      __dirname,
      '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js'
    );
    return await import(pathToFileURL(distPath).href);
  } catch {
    const srcPath = path.resolve(__dirname, '../modes/ModeHybridRetriever.ts');
    return await import(pathToFileURL(srcPath).href);
  }
}

function mockDeps() {
  const mockDb = {
    prepare: mock.fn(() => ({
      get: mock.fn(() => null),
      all: mock.fn(() => []),
      run: mock.fn(),
    })),
    exec: mock.fn(() => {}),
    transaction: mock.fn((fn) => fn),
  };
  const mockVectorStore = {
    searchSimilar: mock.fn(() => Promise.resolve([])),
    hasEmbeddings: mock.fn(() => false),
  };
  const mockEmbeddingPipeline = {
    // Default: provider UNAVAILABLE → lexical path. Individual tests flip this.
    isReady: mock.fn(() => false),
    getEmbedding: mock.fn(() => Promise.resolve([0.1, 0.2, 0.3, 0.4])),
    getEmbeddingForQuery: mock.fn(() => Promise.resolve([0.1, 0.2, 0.3, 0.4])),
    getActiveProviderName: mock.fn(() => 'test-provider'),
    getActiveSpaceKey: mock.fn(() => null),
  };
  return { mockDb, mockVectorStore, mockEmbeddingPipeline };
}

const FLAG = 'NATIVELY_RAG_CONFIDENCE_GATE';

describe('Phase 0: retrieval-confidence signal (observe only)', () => {
  let prevFlag;

  beforeEach(() => {
    prevFlag = process.env[FLAG];
  });
  afterEach(() => {
    if (prevFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prevFlag;
  });

  test('flag OFF (default): result has NO confidence field — legacy shape preserved', async () => {
    delete process.env[FLAG];
    const { ModeHybridRetriever } = await loadRetriever();
    const { mockDb, mockVectorStore, mockEmbeddingPipeline } = mockDeps();
    const retriever = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);

    const files = [{
      id: 'file1', modeId: 'mode1', fileName: 'tips.txt',
      content: 'The project manager scheduled the meeting for Tuesday afternoon.',
      createdAt: new Date().toISOString(),
    }];
    const result = await retriever.retrieve({
      query: 'When is the meeting scheduled?',
      modeId: 'mode1', files, tokenBudget: 1000, topK: 3,
    });

    assert.ok(result.chunks.length > 0, 'sanity: should still retrieve');
    assert.equal('confidence' in result, false, 'confidence field must be absent when flag OFF');
  });

  test('flag ON: confidence field present with the documented shape', async () => {
    process.env[FLAG] = '1';
    const { ModeHybridRetriever } = await loadRetriever();
    const { mockDb, mockVectorStore, mockEmbeddingPipeline } = mockDeps();
    const retriever = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);

    const files = [{
      id: 'file1', modeId: 'mode1', fileName: 'tips.txt',
      content: 'The project manager scheduled the meeting for Tuesday afternoon.',
      createdAt: new Date().toISOString(),
    }];
    const result = await retriever.retrieve({
      query: 'When is the meeting scheduled?',
      modeId: 'mode1', files, tokenBudget: 1000, topK: 3,
    });

    assert.ok(result.confidence, 'confidence must be present when flag ON');
    const c = result.confidence;
    assert.equal(typeof c.topScore, 'number');
    assert.equal(typeof c.margin, 'number');
    assert.equal(typeof c.clearedCount, 'number');
    assert.equal(typeof c.candidateCount, 'number');
    assert.equal(typeof c.lowConfidence, 'boolean');
    assert.ok(Array.isArray(c.reasons), 'reasons must be an array');
  });

  test('signal does not change which chunks are returned (flag ON vs OFF identical)', async () => {
    const { ModeHybridRetriever } = await loadRetriever();

    const files = [{
      id: 'file1', modeId: 'mode1', fileName: 'tips.txt',
      content: 'The project manager scheduled the meeting for Tuesday afternoon. Bring the roadmap.',
      createdAt: new Date().toISOString(),
    }];
    const query = 'When is the meeting scheduled?';

    delete process.env[FLAG];
    {
      const { mockDb, mockVectorStore, mockEmbeddingPipeline } = mockDeps();
      const r1 = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);
      var off = await r1.retrieve({ query, modeId: 'mode1', files, tokenBudget: 1000, topK: 3 });
    }
    process.env[FLAG] = '1';
    {
      const { mockDb, mockVectorStore, mockEmbeddingPipeline } = mockDeps();
      const r2 = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);
      var on = await r2.retrieve({ query, modeId: 'mode1', files, tokenBudget: 1000, topK: 3 });
    }

    assert.equal(off.formattedContext, on.formattedContext, 'formattedContext must be identical regardless of flag');
    assert.deepEqual(
      off.chunks.map(c => `${c.sourceId}:${c.chunkIndex}`),
      on.chunks.map(c => `${c.sourceId}:${c.chunkIndex}`),
      'selected chunk identity/order must be identical regardless of flag'
    );
  });

  test('unrelated query → no candidates clear threshold → low confidence, reason no_candidates', async () => {
    process.env[FLAG] = '1';
    const { ModeHybridRetriever } = await loadRetriever();
    const { mockDb, mockVectorStore, mockEmbeddingPipeline } = mockDeps();
    const retriever = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);

    const files = [{
      id: 'file1', modeId: 'mode1', fileName: 'tips.txt',
      content: 'The project manager scheduled the meeting for Tuesday afternoon.',
      createdAt: new Date().toISOString(),
    }];
    const result = await retriever.retrieve({
      // No query token appears in the file.
      query: 'xyzzqxq nonsenseword bogusterm',
      modeId: 'mode1', files, tokenBudget: 1000, topK: 3,
    });

    assert.equal(result.chunks.length, 0, 'sanity: unrelated query retrieves nothing');
    assert.ok(result.confidence, 'confidence present');
    assert.equal(result.confidence.lowConfidence, true);
    assert.ok(result.confidence.reasons.includes('no_candidates'), 'should flag no_candidates');
  });

  test('lexical fallback on a content query flags lexical_degraded', async () => {
    process.env[FLAG] = '1';
    const { ModeHybridRetriever } = await loadRetriever();
    const { mockDb, mockVectorStore, mockEmbeddingPipeline } = mockDeps();
    // Provider unavailable → usedFallback true.
    mockEmbeddingPipeline.isReady = mock.fn(() => false);
    const retriever = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);

    const files = [{
      id: 'file1', modeId: 'mode1', fileName: 'tips.txt',
      content: 'The project manager scheduled the meeting for Tuesday afternoon. Bring the roadmap and milestones.',
      createdAt: new Date().toISOString(),
    }];
    const result = await retriever.retrieve({
      query: 'meeting scheduled roadmap milestones',
      modeId: 'mode1', files, tokenBudget: 1000, topK: 3,
    });

    assert.equal(result.usedFallback, true, 'sanity: should be lexical fallback');
    assert.ok(result.confidence, 'confidence present');
    assert.ok(
      result.confidence.reasons.includes('lexical_degraded'),
      'lexical fallback on a >=3-token query must flag lexical_degraded'
    );
  });

  test('empty files → no confidence (not an escalation candidate)', async () => {
    process.env[FLAG] = '1';
    const { ModeHybridRetriever } = await loadRetriever();
    const { mockDb, mockVectorStore, mockEmbeddingPipeline } = mockDeps();
    const retriever = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);

    const result = await retriever.retrieve({
      query: 'anything', modeId: 'mode1', files: [], tokenBudget: 1000, topK: 3,
    });
    assert.equal('confidence' in result, false, 'no-files early return must not attach confidence');
  });

  test('zero-token query → no confidence (short-circuit unchanged)', async () => {
    process.env[FLAG] = '1';
    const { ModeHybridRetriever } = await loadRetriever();
    const { mockDb, mockVectorStore, mockEmbeddingPipeline } = mockDeps();
    const retriever = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);

    const files = [{
      id: 'file1', modeId: 'mode1', fileName: 'tips.txt',
      content: 'The project manager scheduled the meeting.',
      createdAt: new Date().toISOString(),
    }];
    // All words <=2 chars → queryWords.size === 0 → existing short-circuit.
    const result = await retriever.retrieve({
      query: 'a an to of', modeId: 'mode1', files, tokenBudget: 1000, topK: 3,
    });
    assert.equal('confidence' in result, false, 'zero-token short-circuit must not attach confidence');
  });
});
