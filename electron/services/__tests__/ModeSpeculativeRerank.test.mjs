// electron/services/__tests__/ModeSpeculativeRerank.test.mjs
//
// Phase 3 (smart-retrieval rollout) — rerank on the LIVE transcript path,
// prewarmed + budget-guarded.
//
// Two contracts:
//   (A) BEHAVIORAL: the live callers (IntelligenceEngine prefetch, WhatToAnswerLLM
//       inline) pass allowRerank=true ONLY when ragSpeculativeRerank is on, and
//       the rerank itself still runs inside the existing raceWithBudget envelope
//       — so when the flag is off the live path is byte-for-byte unchanged.
//   (B) SOURCE-GUARD: the live callsites are wired to the speculative flag and
//       forward allowRerank into the hybrid builder. Source guards catch a
//       refactor that silently drops the wiring (the behavioral path is hard to
//       exercise end-to-end without the full streaming stack).
//
// The reranker is injected on the ModeHybridRetriever so no ONNX model loads.

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadRetriever() {
  try {
    const distPath = path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js');
    return await import(pathToFileURL(distPath).href);
  } catch {
    return await import(pathToFileURL(path.resolve(__dirname, '../modes/ModeHybridRetriever.ts')).href);
  }
}

function mockDeps() {
  const mockDb = {
    prepare: mock.fn(() => ({ get: mock.fn(() => null), all: mock.fn(() => []), run: mock.fn() })),
    exec: mock.fn(() => {}),
    transaction: mock.fn((fn) => fn),
  };
  const mockVectorStore = { searchSimilar: mock.fn(() => Promise.resolve([])), hasEmbeddings: mock.fn(() => false) };
  const mockEmbeddingPipeline = {
    isReady: mock.fn(() => false),
    getEmbedding: mock.fn(() => Promise.resolve([0.1, 0.2, 0.3, 0.4])),
    getEmbeddingForQuery: mock.fn(() => Promise.resolve([0.1, 0.2, 0.3, 0.4])),
    getActiveProviderName: mock.fn(() => 'test'),
    getActiveSpaceKey: mock.fn(() => null),
  };
  return { mockDb, mockVectorStore, mockEmbeddingPipeline };
}

const RERANK = 'NATIVELY_RAG_LOCAL_RERANK';
const SPEC = 'NATIVELY_RAG_SPECULATIVE_RERANK';

function multiChunkFile() {
  const filler = (w) => new Array(140).fill(w).join(' ');
  const content = [filler('intro'), filler('payload'), filler('appendix')].join(' ');
  return [{ id: 'fileA', modeId: 'mode1', fileName: 'doc.txt', content, createdAt: new Date().toISOString() }];
}

describe('Phase 3: live-path speculative rerank', () => {
  let prevRerank, prevSpec;
  beforeEach(() => { prevRerank = process.env[RERANK]; prevSpec = process.env[SPEC]; });
  afterEach(() => {
    if (prevRerank === undefined) delete process.env[RERANK]; else process.env[RERANK] = prevRerank;
    if (prevSpec === undefined) delete process.env[SPEC]; else process.env[SPEC] = prevSpec;
  });

  // (A) BEHAVIORAL — the retriever honors allowRerank exactly as the live caller
  // would pass it. (The live caller computes allowRerank = speculative-flag.)
  test('allowRerank=true (flag on) + reranker available → live path reranks', async () => {
    process.env[RERANK] = '1';
    const { ModeHybridRetriever } = await loadRetriever();
    const { mockDb, mockVectorStore, mockEmbeddingPipeline } = mockDeps();
    const retriever = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);

    // The rerank decision is normally score-distribution dependent. This test
    // exercises the live-caller contract after that gate has opened.
    retriever.computeConfidence = () => ({ lowConfidence: true });
    let observed = null;
    retriever.__setRerankerForTests({
      rerank: async (_q, passages) => {
        observed = passages;
        return passages
          .map((p, i) => ({ index: i, score: p.includes('payload') ? 10 : (passages.length - i) * 0.01 }))
          .sort((a, b) => b.score - a.score);
      },
    });

    const result = await retriever.retrieve({
      query: 'intro payload appendix', modeId: 'mode1', files: multiChunkFile(),
      tokenBudget: 4000, topK: 6, allowRerank: true, // live caller passes this when speculative flag on
      forceDocumentGrounding: true,
    });
    assert.ok(observed, 'reranker consulted on the live path when allowRerank true');
    assert.ok(result.chunks[0].text.includes('payload'), 'payload chunk promoted');
  });

  test('allowRerank=false (speculative flag off) → live path never reranks', async () => {
    process.env[RERANK] = '1'; // reranker itself enabled …
    const { ModeHybridRetriever } = await loadRetriever();
    const { mockDb, mockVectorStore, mockEmbeddingPipeline } = mockDeps();
    const retriever = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);

    let called = false;
    retriever.__setRerankerForTests({ rerank: async () => { called = true; return null; } });

    // … but allowRerank=false (the speculative flag was off) → no rerank.
    await retriever.retrieve({
      query: 'intro payload appendix', modeId: 'mode1', files: multiChunkFile(),
      tokenBudget: 4000, topK: 6, allowRerank: false,
    });
    assert.equal(called, false, 'live path must not rerank when allowRerank is false');
  });

  test('a stalled optional reranker cannot consume the manual-answer deadline', async () => {
    process.env[RERANK] = '1';
    const { ModeHybridRetriever } = await loadRetriever();
    const { mockDb, mockVectorStore, mockEmbeddingPipeline } = mockDeps();
    const retriever = new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);
    retriever.__setRerankerForTests({ rerank: async () => new Promise(() => {}) });

    const result = await Promise.race([
      retriever.retrieve({
        query: 'intro payload appendix', modeId: 'mode1', files: multiChunkFile(),
        tokenBudget: 4000, topK: 6, allowRerank: true,
        forceDocumentGrounding: true,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('rerank did not respect its latency budget')), 1800)),
    ]);

    assert.ok(result.chunks.length > 0, 'the lexical candidates remain usable when reranking stalls');
  });

  // (B) SOURCE-GUARDS — the live callsites forward the speculative flag.
  describe('live callsites are wired to the speculative flag (source guard)', () => {
    test('IntelligenceEngine prefetch gates allowRerank on isRagSpeculativeRerankEnabled', () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
      assert.match(src, /isRagSpeculativeRerankEnabled/);
      // The hybrid builder call in IntelligenceEngine must forward an allowRerank arg.
      assert.match(src, /buildRetrievedActiveModeContextBlockHybrid\([\s\S]*?allowRerank[\s\S]*?\)/);
    });

    test('WhatToAnswerLLM inline path gates allowRerank on isRagSpeculativeRerankEnabled', () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../../llm/WhatToAnswerLLM.ts'), 'utf8');
      assert.match(src, /isRagSpeculativeRerankEnabled/);
      assert.match(src, /buildRetrievedActiveModeContextBlockHybrid\([\s\S]*?allowRerank[\s\S]*?\)/);
    });

    test('rerank stays inside the existing raceWithBudget envelope (no new unbounded await)', () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../../llm/WhatToAnswerLLM.ts'), 'utf8');
      // The hybrid call must still be wrapped by raceWithBudget(...) — the
      // safety guarantee for first-token latency.
      assert.match(src, /raceWithBudget\([\s\S]*?buildRetrievedActiveModeContextBlockHybrid/);
    });
  });

  // Prewarm gating: ModesManager warms the reranker only when ragLocalRerank is on.
  describe('mode-activation prewarm gates on the reranker flag (source guard)', () => {
    test('prewarmModeReferenceIndex prewarms the reranker only when enabled', () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../ModesManager.ts'), 'utf8');
      const fn = src.slice(src.indexOf('prewarmModeReferenceIndex'));
      const body = fn.slice(0, 2200);
      assert.match(body, /isRagLocalRerankEnabled/, 'prewarm must check the reranker flag');
      assert.match(body, /reranker\.prewarm/, 'prewarm must call reranker.prewarm()');
    });
  });
});
