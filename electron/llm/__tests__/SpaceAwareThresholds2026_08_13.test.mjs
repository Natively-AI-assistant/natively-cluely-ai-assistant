// electron/llm/__tests__/SpaceAwareThresholds2026_08_13.test.mjs
//
// Phase 3 of the semantic-retrieval repair: space-aware thresholds +
// observe-only telemetry. Pins:
//   1. resolveMinSimilarity: every space resolves to the LEGACY 0.25 (this
//      phase is plumbing, not retuning) and the env override works,
//   2. RAGRetriever hands the resolved value to VectorStore.searchSimilar
//      (behavioral, via a capturing stub — both the per-meeting and global
//      paths),
//   3. [SemanticAdmission] telemetry: one line per getRelevantNodes call with
//      (spaceKey, cosine, boostSum, admitted) per candidate, emitted in
//      observe mode (flag OFF) and never changing what is returned.
//
// Run with:
//   npm run build:electron
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/llm/__tests__/SpaceAwareThresholds2026_08_13.test.mjs

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron', p)).href;

const { resolveMinSimilarity } = await import(dist('electron/llm/semanticAdmissionGate.js'));
const { RAGRetriever } = await import(dist('electron/rag/RAGRetriever.js'));
const { getRelevantNodes } = await import(dist('premium/electron/knowledge/HybridSearchEngine.js'));

afterEach(() => {
  delete process.env.NATIVELY_MIN_SIMILARITY_BY_SPACE;
  delete process.env.NATIVELY_SEMANTIC_ADMISSION_GATE;
});

// ── 1. resolveMinSimilarity ─────────────────────────────────────────────────

test('every space resolves to the legacy 0.25 by default (plumbing, not retuning)', () => {
  assert.equal(resolveMinSimilarity('gemini:gemini-embedding-2:768'), 0.25);
  assert.equal(resolveMinSimilarity('local:Xenova/all-MiniLM-L6-v2:384'), 0.25);
  assert.equal(resolveMinSimilarity(undefined), 0.25);
  assert.equal(resolveMinSimilarity(null), 0.25);
});

test('NATIVELY_MIN_SIMILARITY_BY_SPACE overrides one space without touching others', () => {
  process.env.NATIVELY_MIN_SIMILARITY_BY_SPACE = JSON.stringify({ 'gemini:gemini-embedding-2:768': 0.2 });
  assert.equal(resolveMinSimilarity('gemini:gemini-embedding-2:768'), 0.2);
  assert.equal(resolveMinSimilarity('local:Xenova/all-MiniLM-L6-v2:384'), 0.25);
});

test('malformed override falls back to defaults', () => {
  process.env.NATIVELY_MIN_SIMILARITY_BY_SPACE = 'not-json{';
  assert.equal(resolveMinSimilarity('gemini:gemini-embedding-2:768'), 0.25);
});

// ── 2. RAGRetriever threads the resolved value ──────────────────────────────

function makeRetrieverCapture() {
  const captured = [];
  const vectorStore = {
    searchSimilar: async (_q, options) => { captured.push(options); return []; },
    searchSummaries: async () => [],
  };
  const embeddingPipeline = {
    getEmbeddingForQuery: async () => [1, 0],
    getEmbedding: async () => [1, 0],
    getActiveSpaceKey: () => 'gemini:gemini-embedding-2:768',
    isReady: () => true,
  };
  return { retriever: new RAGRetriever(vectorStore, embeddingPipeline), captured };
}

test('RAGRetriever passes the space-resolved minSimilarity to searchSimilar (both paths)', async () => {
  process.env.NATIVELY_MIN_SIMILARITY_BY_SPACE = JSON.stringify({ 'gemini:gemini-embedding-2:768': 0.19 });
  const { retriever, captured } = makeRetrieverCapture();
  await retriever.retrieve('what was decided?', 'meeting-1').catch(() => {});
  await retriever.retrieveGlobal?.('what was decided across meetings?')?.catch?.(() => {});
  assert.ok(captured.length >= 1, 'searchSimilar must have been called');
  for (const options of captured) {
    assert.equal(options.minSimilarity, 0.19,
      'the env-overridden per-space value must reach VectorStore');
    assert.equal(options.spaceKey, 'gemini:gemini-embedding-2:768');
  }
});

test('RAGRetriever default is byte-identical to legacy (0.25)', async () => {
  const { retriever, captured } = makeRetrieverCapture();
  await retriever.retrieve('what was decided?', 'meeting-1').catch(() => {});
  assert.ok(captured.length >= 1);
  assert.equal(captured[0].minSimilarity, 0.25);
});

// ── 3. [SemanticAdmission] observe-only telemetry ───────────────────────────

const atCosine = (c) => [c, Math.sqrt(1 - c * c)];
const NODE = {
  id: 'n1', source_type: 'resume', category: 'experience',
  title: 'Zebra Quantum', organization: 'Xylophone',
  text_content: 'body', tags: [], duration_months: 24, end_date: null,
  embedding: atCosine(0.7),
};

async function captureTelemetry(runFn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => { const s = args.join(' '); if (s.startsWith('[SemanticAdmission] ')) lines.push(s); orig(...args); };
  try { return { result: await runFn(), lines }; } finally { console.log = orig; }
}

test('telemetry fires in OBSERVE mode (flag OFF) with per-candidate cosine/boostSum/admitted', async () => {
  delete process.env.NATIVELY_SEMANTIC_ADMISSION_GATE;
  const { result, lines } = await captureTelemetry(() =>
    getRelevantNodes('tell me things', [NODE], async () => [1, 0], {
      embeddingSpaceKey: 'gemini:gemini-embedding-2:768',
    }));
  assert.equal(lines.length, 1, 'exactly one telemetry line per retrieval call');
  const payload = JSON.parse(lines[0].slice('[SemanticAdmission] '.length));
  assert.equal(payload.spaceKey, 'gemini:gemini-embedding-2:768');
  assert.equal(payload.enforced, false, 'flag OFF → observe mode');
  assert.equal(payload.candidateCount, 1);
  const c = payload.candidates[0];
  assert.ok(Math.abs(c.cosine - 0.7) < 1e-4, `cosine logged (${c.cosine})`);
  // legacy blended: 0.6·0.7 + duration 0.1 + recency 0.1 = 0.62 → boostSum 0.2
  assert.ok(Math.abs(c.boostSum - 0.2) < 1e-4, `boostSum logged (${c.boostSum})`);
  assert.equal(c.admitted, true, '0.62 > 0.55 admitted under legacy predicate');
  // Observe mode must not change what is returned.
  assert.equal(result.length, 1);
});

test('telemetry reflects enforcement when the gate is ON', async () => {
  process.env.NATIVELY_SEMANTIC_ADMISSION_GATE = 'on';
  const { lines } = await captureTelemetry(() =>
    getRelevantNodes('tell me things', [NODE], async () => [1, 0], {
      embeddingSpaceKey: 'gemini:gemini-embedding-2:768',
    }));
  const payload = JSON.parse(lines[0].slice('[SemanticAdmission] '.length));
  assert.equal(payload.enforced, true);
  assert.equal(payload.floor, 0.55);
  assert.equal(payload.candidates[0].admitted, true, 'cosine 0.7 ≥ floor 0.55');
});
