// F-ACC-06 (live-pipeline forensics, 2026-11-13): in keyless or local-embedder
// meetings cosine contributed nothing, and the retriever still said "hybrid".
//
// Why cosine contributes nothing, by case (stub embedders only; no local model runs):
//   - no embedder at all: there is nothing to compare. Reported as
//     'embedding_unavailable' (unchanged).
//   - bundled local embedder, heard turn in a meeting: keyword search by the
//     owner's 2026-10-03/10-04 decision (keeps the awaited rerank). Pinned by
//     LocalEmbedderVectorsOutsideMeeting2026_09_19 and left as it is; the
//     non-document-grounded return still reported usedHybrid: true for it.
//   - an embedder, but no chunk of the corpus has a vector in the active space
//     yet (more than QUERY_EPHEMERAL_EMBED_MAX missing, so none are embedded on
//     the hot path): every chunk scored lexically while the turn reported hybrid.
//   - the query embed threw: lexical, and the non-grounded return said hybrid.
// Each now reports usedHybrid: false with its reason, and the all-vectorless
// case says so in a log line. When vectors exist, the turn is hybrid as before.
//
// Run: npm run build:electron && NATIVELY_RAG_LOCAL_RERANK=off node --test electron/services/__tests__/HybridReportsLexicalHonestly2026_11_13.test.mjs

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', p)).href);
const { ModeHybridRetriever, QUERY_EPHEMERAL_EMBED_MAX } = await dist('services/modes/ModeHybridRetriever.js');

const SMALL = ['# Notes', '', '## Retention', '', 'Audit logs are retained for 400 days; debug logs for 21 days.', '', '## Expenses', '', 'Employees may expense up to 85 euros per month for home internet.', ''].join('\n');
const para = (i) => `## Topic ${i}\n\n` + `Paragraph ${i} describes the service area number ${i}, its owners, its runbook and its quarterly review cadence in detail. `.repeat(6) + (i === 17 ? 'Audit logs are retained for 400 days. ' : '') + '\n';
const BIG = '# Handbook\n\n' + Array.from({ length: 80 }, (_, i) => para(i)).join('\n');
const file = (content) => [{ id: 'f', modeId: 'm', fileName: 'notes.md', content, createdAt: new Date().toISOString() }];

function retriever(provider, { queryThrows = false } = {}) {
  const embeds = { query: 0, batch: 0 };
  const hr = new ModeHybridRetriever(
    { prepare: mock.fn(() => ({ get: mock.fn(() => null), all: mock.fn(() => []), run: mock.fn() })), exec: mock.fn(() => {}) },
    { searchSimilar: async () => [], hasEmbeddings: () => false },
    { isReady: () => true, getActiveProviderName: () => provider, getActiveSpaceKey: () => `${provider}:x:4`,
      getEmbeddingForQuery: async () => { embeds.query++; if (queryThrows) throw new Error('offline'); return [1, 0, 0, 0]; },
      getEmbedding: async () => [1, 0, 0, 0],
      getEmbeddingsWithFallback: async (t) => { embeds.batch++; return { embeddings: t.map(() => [0.9, 0.1, 0, 0]), space: `${provider}:x:4` }; } });
  hr.indexFile = async () => {}; // the background re-index is not under test
  return { hr, embeds };
}
const ask = (hr, files, extra = {}) => hr.retrieve({ query: 'how long are audit logs kept', modeId: 'm', files, tokenBudget: 1500, topK: 20, allowRerank: false, ...extra });
async function withWarnings(fn) {
  const seen = []; const orig = console.warn;
  console.warn = (...a) => { seen.push(a.map(String).join(' ')); };
  try { return { r: await fn(), seen }; } finally { console.warn = orig; }
}

describe('vectors exist: the turn is hybrid, as before', () => {
  for (const forceDocumentGrounding of [false, true]) {
    test(`hosted provider, small corpus (forceDocumentGrounding=${forceDocumentGrounding})`, async () => {
      const { hr, embeds } = retriever('natively');
      const r = await ask(hr, file(SMALL), { forceDocumentGrounding });
      assert.equal(r.usedHybrid, true); assert.equal(r.degradedReason, undefined);
      assert.ok(embeds.query > 0 && embeds.batch > 0);
      assert.ok(r.chunks.some((c) => c.vectorScore > 0), 'cosine contributed');
    });
  }
});

describe('no chunk has a vector yet: lexical, and it says so', () => {
  for (const forceDocumentGrounding of [false, true]) {
    test(`hosted provider, ${'>'}${QUERY_EPHEMERAL_EMBED_MAX} un-indexed chunks (forceDocumentGrounding=${forceDocumentGrounding})`, async () => {
      const { hr } = retriever('natively');
      const { r, seen } = await withWarnings(() => ask(hr, file(BIG), { forceDocumentGrounding }));
      assert.ok(r.chunks.length > 0);
      assert.ok(r.chunks.every((c) => !c.vectorScore), 'no cosine this turn');
      assert.equal(r.usedHybrid, false);
      assert.equal(r.degradedReason, 'no_chunk_vectors');
      assert.ok(seen.some((l) => /lexical-only/i.test(l) && /no chunk/i.test(l)), seen.join('\n'));
      assert.ok(r.chunks.some((c) => /400 days/.test(c.text)), 'the answer is still retrieved');
    });
  }
});

describe('lexical by policy or failure: never reported as hybrid', () => {
  test('local embedder, forced keyword-only in a meeting, not document-grounded', async () => {
    // Heard turns query the vectors since 2026-11-14; keyword-only is now the
    // NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL=1 escape hatch.
    process.env.NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL = '1';
    try {
      const { hr, embeds } = retriever('local');
      const r = await ask(hr, file(SMALL), { meetingActive: true, rerankSurface: 'live' });
      assert.equal(embeds.query, 0);
      assert.equal(r.usedHybrid, false);
      assert.equal(r.degradedReason, 'local_lexical');
    } finally { delete process.env.NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL; }
  });
  test('local embedder, heard turn in a meeting: hybrid (owner 2026-11-14)', async () => {
    const { hr, embeds } = retriever('local');
    const r = await ask(hr, file(SMALL), { meetingActive: true, rerankSurface: 'live' });
    assert.ok(embeds.query > 0);
    assert.equal(r.usedHybrid, true);
    assert.equal(r.degradedReason, undefined);
  });
  test('the query embed throws, not document-grounded', async () => {
    const { hr } = retriever('natively', { queryThrows: true });
    const r = await ask(hr, file(SMALL));
    assert.equal(r.usedHybrid, false);
    assert.equal(r.degradedReason, 'hybrid_threw');
    assert.ok(r.chunks.length > 0);
  });
});
