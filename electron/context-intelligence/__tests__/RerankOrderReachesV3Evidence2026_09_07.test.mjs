// The reranker's ORDER must survive into V3 evidence (2026-09-07).
//
// THE DEFECT, measured on a real 23-turn session (General mode, six attached
// reference files, Voyage rerank-2.5-lite selected): telemetry showed one
// billed, HTTP 200 rerank per grounded turn, yet every CONTEXT_DEBUG_TURN
// printed `rerankScore: null` and a `finalScore` equal to the hybrid
// lexical+vector(+answerability) value. ModeHybridRetriever computed the
// cross-encoder score, SELECTED the pool by it, and dropped it at its public
// `ModeRetrievedChunk` boundary; the V3 mode port then mapped `score` (the
// hybrid value) to `finalScore`, and both the legacy port's accepted-slice
// fill and the context packer's rank() re-sorted the evidence by it. The
// reranker chose WHICH chunks; the hybrid score chose their ORDER — and the
// order is what the model reads first.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { createModeRetrievalPort } = await load('retrieval/mode-retrieval-port.js');
const { decide } = await load('orchestration/orchestrator.js');

const FILES = [
  { id: 'f-anchors', fileName: '04_exact_retrieval_anchors.md', content: '# RETRIEVAL ANCHOR SHEET\nANCHOR-A25: API p99 regression after change is 640 ms.' },
  { id: 'f-large', fileName: '05_large_technical_reference.md', content: '## TECH-00099 — BM25\nKey considerations: latency budget, correctness.' },
  { id: 'f-debug', fileName: '03_debugging_scenarios.md', content: 'PERFORMANCE-301:\nAfter change: p50 78 ms, p95 181 ms, p99 640 ms.' },
];

// Hybrid `score` ranks the padding chunk FIRST; the reranker ranks it LAST.
const RERANKED = [
  { sourceId: 'f-large', fileName: FILES[1].fileName, chunkIndex: 98, text: FILES[1].content, score: 0.91, ftsScore: 0.3, vectorScore: 0.6, rerankScore: 0.12 },
  { sourceId: 'f-anchors', fileName: FILES[0].fileName, chunkIndex: 0, text: FILES[0].content, score: 0.36, ftsScore: 0.13, vectorScore: 0.25, rerankScore: 0.88 },
  { sourceId: 'f-debug', fileName: FILES[2].fileName, chunkIndex: 1, text: FILES[2].content, score: 0.27, ftsScore: 0.06, vectorScore: 0.27, rerankScore: 0.71 },
  // The un-pooled tail: selected, never scored by the reranker.
  { sourceId: 'f-large', fileName: FILES[1].fileName, chunkIndex: 97, text: 'TECH-00098 — HNSW. Explain tradeoffs.', score: 0.25, ftsScore: 0.1, vectorScore: 0.2 },
];

function portOver(chunks) {
  return createModeRetrievalPort({
    modesManager: { retrieveHybridRaw: async () => ({ chunks, formattedContext: '', usedFallback: false, usedHybrid: true }) },
    modeInfo: { id: 'general' },
    files: FILES,
    tokenBudget: 3600,
    userId: 'u',
    rerankSurface: 'manual',
  });
}

const decision = () => decide({
  requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId: 'general',
  scope: { userId: 'u', modeId: 'general' }, sessionId: 's',
  manualQuestion: 'What was the p99 after the regression?',
  hasAttachedDocuments: true, attachedFileNames: FILES.map((f) => f.fileName),
});

describe('a reranked pool is ordered by the reranker, not the hybrid score', () => {
  test('finalScore is the rerank score and the evidence comes back in rerank order', async () => {
    const { evidence, attempts } = await portOver(RERANKED).retrieve({ decision: decision() });
    assert.equal(evidence.length, 4, `dropped: ${JSON.stringify(attempts[0]?.rejections)}`);
    const order = evidence.map((e) => `${e.sourceId}#${e.chunkIndex}`);
    assert.deepEqual(order, ['f-anchors#0', 'f-debug#1', 'f-large#98', 'f-large#97'], order.join(' > '));
    assert.equal(evidence[0].finalScore, 0.88);
    assert.equal(evidence[0].rerankerScore, 0.88, 'the debug event reads rerankerScore — it must not be null on a reranked turn');
    assert.equal(evidence[2].finalScore, 0.12, 'the padding chunk keeps its (low) rerank score, not its 0.91 hybrid score');
  });

  test('the un-pooled tail sinks just below the lowest reranked chunk and carries no rerank score', async () => {
    const { evidence } = await portOver(RERANKED).retrieve({ decision: decision() });
    const tail = evidence.find((e) => e.chunkIndex === 97);
    assert.ok(tail);
    assert.equal(tail.rerankerScore, undefined);
    assert.ok(tail.finalScore < 0.12, `tail ${tail.finalScore} must sort below every reranked chunk`);
  });

  test('hybrid scores are still carried for the debug event', async () => {
    const { evidence } = await portOver(RERANKED).retrieve({ decision: decision() });
    assert.equal(evidence[0].semanticScore, 0.25);
    assert.equal(evidence[0].keywordScore, 0.13);
  });
});

describe('a pool the reranker never touched is unchanged', () => {
  test('finalScore stays the hybrid score and rerankerScore stays absent', async () => {
    const plain = RERANKED.map(({ rerankScore: _r, ...c }) => c);
    const { evidence } = await portOver(plain).retrieve({ decision: decision() });
    assert.equal(evidence.length, 4);
    assert.deepEqual(evidence.map((e) => e.finalScore), [0.91, 0.36, 0.27, 0.25]);
    assert.ok(evidence.every((e) => e.rerankerScore === undefined));
  });
});
