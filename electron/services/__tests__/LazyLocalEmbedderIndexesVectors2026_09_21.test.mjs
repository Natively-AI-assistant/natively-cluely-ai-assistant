// electron/services/__tests__/LazyLocalEmbedderIndexesVectors2026_09_21.test.mjs
//
// The bundled local embedder is registered LAZILY: the resolver assigns the
// provider but the ONNX model is not loaded until the first real embed(), and
// `LocalEmbeddingProvider.isLoaded()` deliberately reports false until then so
// a live QUERY can route to lexical instead of stalling on a 60s model load.
//
// That interacts badly with INDEXING, which is a background job where blocking
// briefly is fine. Two pipeline methods disagreed:
//
//   isReady()      = provider !== null && provider.isLoaded()   -> FALSE
//   waitForReady() = `if (this.provider) return;`               -> resolves at once
//
// so `__e2e__:reindex-embeddings` awaited waitForReady(), got an immediate
// resolve, then `indexFile` consulted isEmbeddingAvailable() -> isReady() ->
// false and wrote the file off as `lexical_only`. Nothing in the indexing path
// ever performs the embed that would load the model, so the retry path hits the
// same gate forever — a deadlock, not a race.
//
// REPRODUCED LIVE (2026-09-21) against a real Electron app with an isolated
// userData: six reference files uploaded, `reindex-embeddings` returned in
// 13-30ms, `embedded 0/9 chunks`, and the worker never logged "Loading
// feature-extraction model".
//
// Invariants pinned here:
//   1. A provider that is assigned-but-not-loaded must be LOADED for indexing,
//      not written off as lexical_only.
//   2. A provider that genuinely cannot load still degrades to lexical_only
//      (the outage path must not regress into a hang or a throw).
//   3. The QUERY path must NOT force a load — that stall is what isLoaded()
//      exists to prevent.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ModeHybridRetriever } = await import(pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js')).href);

const Database = require('better-sqlite3');
const LOCAL_SPACE = 'local:xenova/all-minilm-l6-v2:384';

const FILE = {
  id: 'f1', modeId: 'm1', fileName: 'billing.md',
  content: [
    '# Billing', '',
    '## Free tier',
    'The free tier caps a workspace at three active projects and 250 stored documents.', '',
    '## Revocation',
    'The reconciler clears the cached entitlement set when the paid period elapses.', '',
  ].join('\n'),
  createdAt: new Date().toISOString(),
};

/**
 * Models the real bundled provider: assigned immediately, `isReady()` false
 * until something actually triggers the load. `getActiveSpaceKey()` returns the
 * space even before the load, exactly as the real pipeline does
 * (`getActiveSpaceKey() { return this.provider?.space }`) — so `isReady()` is
 * the ONLY thing standing between indexing and a vector.
 */
function makeLazyLocalPipeline({ canLoad = true, loadDelayMs = 0 } = {}) {
  let loaded = false;
  const calls = { ensureLoaded: 0, batch: [], query: 0 };
  return {
    calls,
    isLoadedNow: () => loaded,
    isReady: () => loaded,
    getActiveSpaceKey: () => LOCAL_SPACE,
    getActiveProviderName: () => 'local',
    getActiveDimensions: () => 4,
    async waitForReady() { /* provider is assigned, so the real one resolves at once */ },
    async ensureProviderLoaded() {
      calls.ensureLoaded++;
      if (loadDelayMs) await new Promise((r) => setTimeout(r, loadDelayMs));
      if (!canLoad) return false;
      loaded = true;
      return true;
    },
    getEmbeddingForQuery: async () => { calls.query++; return [1, 0, 0, 0]; },
    getEmbedding: async () => [1, 0, 0, 0],
    getEmbeddings: async (texts) => { calls.batch.push(texts.length); return texts.map(() => [0.5, 0.5, 0, 0]); },
    getEmbeddingsWithFallback: async (texts) => {
      calls.batch.push(texts.length);
      return { embeddings: texts.map(() => [0.5, 0.5, 0, 0]), space: LOCAL_SPACE };
    },
  };
}

let db;
beforeEach(() => { db = new Database(':memory:'); });
const vectorStore = {};

const statusOf = () =>
  db.prepare('SELECT status, embedded_chunk_count FROM mode_reference_index_state WHERE file_id = ?').get('f1');

describe('a lazily-loaded local embedder still gets its vectors built', () => {
  test('indexFile LOADS the provider instead of writing the file off as lexical_only', async () => {
    const pipeline = makeLazyLocalPipeline();
    assert.equal(pipeline.isReady(), false, 'precondition: provider assigned but not loaded');

    await new ModeHybridRetriever(db, vectorStore, pipeline).indexFile(FILE);

    assert.ok(pipeline.calls.ensureLoaded > 0,
      'indexing must force the lazy load; without this the file is lexical_only forever');
    assert.ok(pipeline.calls.batch.length > 0, 'chunks must actually be embedded');

    const row = statusOf();
    assert.equal(row.status, 'ready', `expected ready, got ${row.status}`);
    assert.ok(row.embedded_chunk_count > 0, 'embedded_chunk_count must be > 0');

    const chunks = db.prepare('SELECT embedding FROM mode_reference_chunks WHERE file_id = ?').all('f1');
    assert.ok(chunks.length > 0);
    assert.ok(chunks.every((c) => c.embedding instanceof Buffer), 'every chunk carries a vector');
  });

  test('a provider that cannot load still degrades to lexical_only — no hang, no throw', async () => {
    const pipeline = makeLazyLocalPipeline({ canLoad: false });

    await new ModeHybridRetriever(db, vectorStore, pipeline).indexFile(FILE);

    assert.ok(pipeline.calls.ensureLoaded > 0, 'it should have TRIED');
    assert.equal(pipeline.calls.batch.length, 0, 'nothing embedded when the model cannot load');
    assert.equal(statusOf().status, 'lexical_only', 'outage path must still reach lexical_only');

    const chunks = db.prepare('SELECT id FROM mode_reference_chunks WHERE file_id = ?').all('f1');
    assert.ok(chunks.length > 0, 'chunk TEXT is still persisted so lexical retrieval works');
  });

  test('an already-loaded provider is not asked to load again', async () => {
    const pipeline = makeLazyLocalPipeline();
    await pipeline.ensureProviderLoaded();
    const before = pipeline.calls.ensureLoaded;

    await new ModeHybridRetriever(db, vectorStore, pipeline).indexFile(FILE);

    assert.equal(pipeline.calls.ensureLoaded, before, 'no redundant load for a ready provider');
    assert.equal(statusOf().status, 'ready');
  });

  test('a pipeline with no ensureProviderLoaded at all still works (older shape)', async () => {
    // Guards the optional-call wiring: a pipeline double without the method
    // must not throw, it must take the historical lexical_only path.
    const pipeline = makeLazyLocalPipeline();
    delete pipeline.ensureProviderLoaded;

    await new ModeHybridRetriever(db, vectorStore, pipeline).indexFile(FILE);
    assert.equal(statusOf().status, 'lexical_only');
  });
});

describe('the query path is unchanged — it must never stall on a model load', () => {
  test('retrieve() does NOT force a load; it falls back to lexical', async () => {
    const pipeline = makeLazyLocalPipeline();
    const hr = new ModeHybridRetriever(db, vectorStore, pipeline);

    const r = await hr.retrieve({
      query: 'how many projects on the free tier', modeId: 'm1', files: [FILE],
      tokenBudget: 1500, topK: 10, forceDocumentGrounding: true, allowRerank: false, meetingActive: false,
    });

    assert.equal(pipeline.calls.ensureLoaded, 0,
      'a live query must not trigger the 60s model load — that is why isLoaded() exists');
    assert.equal(r.usedHybrid, false, 'query degrades to lexical while the model is cold');
  });
});
