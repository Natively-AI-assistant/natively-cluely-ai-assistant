// Keyless embedding deadlock regression (2026-09-12).
//
// The lazy LocalEmbeddingProvider only loads its ONNX model on the first real
// embed() call — but indexFileInner used to gate ingest on isReady(), which is
// false until that first embed. Nothing on the reference-file path ever
// embedded, so keyless installs marked every file lexical_only forever and
// every retry path (prewarm, retryAllLexicalOnlyFiles, the boot scheduler) hit
// the same gate. Live-verified against the running app: 3 uploads, 0 embedded
// chunks, unchanged after __e2e__:reindex-embeddings.
//
// The contract now: ingest gates on "a provider with an active space is
// ASSIGNED", not on isReady() — background indexing pays the cold load (each
// sub-batch has its own timeout + retry). The strict isReady() gate remains on
// the per-query retrieval path, which this file does not touch.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { ModeHybridRetriever } = await import(pathToFileURL(
  path.resolve(process.cwd(), 'dist-electron/electron/services/modes/ModeHybridRetriever.js')).href);

const DOC = Array.from({ length: 30 }, (_, i) =>
  `Section ${i} explains how the service handled request ${i} and stored the outcome for audit purposes.`,
).join('\n\n');

function makeRetriever(pipeline) {
  const db = { exec() {}, prepare() { return { run() {}, get() { return null; }, all() { return []; } }; } };
  const hr = new ModeHybridRetriever(db, null, pipeline);
  const calls = { persisted: [], states: [] };
  let lastVectorCount = 0;
  hr.persistChunks = (fileId, chunks, embeddings, space) => {
    calls.persisted.push({ chunkCount: chunks.length, embeddings, space });
    lastVectorCount = Array.isArray(embeddings) ? embeddings.filter(Boolean).length : 0;
    return true;
  };
  hr.countPersistedVectors = () => lastVectorCount;
  hr.updateIndexState = (fileId, hash, chunkCount, status, space, embeddedCount) => {
    calls.states.push({ status, embeddedCount, space });
  };
  hr.getIndexState = () => null;
  hr.ensureIndexTable = () => {};
  return { hr, calls };
}

describe('keyless ingest cold-load deadlock', () => {
  test('a lazily-assigned provider (isReady=false) is still used for ingest', async () => {
    let embedCalls = 0;
    const pipeline = {
      // The deadlock shape: provider assigned, model not loaded yet.
      isReady: () => false,
      getActiveProviderName: () => 'local',
      getActiveSpaceKey: () => 'local:test:384',
      async getEmbeddingsWithFallback(slice) {
        embedCalls += 1; // this call is what triggers the lazy model load
        return { embeddings: slice.map(() => new Array(384).fill(0)), space: 'local:test:384' };
      },
      async getEmbeddingForQuery() { return new Array(384).fill(0); },
    };
    const { hr, calls } = makeRetriever(pipeline);
    await hr.indexFile({ id: 'f1', fileName: 'doc.txt', content: DOC });

    assert.ok(embedCalls > 0, 'ingest must call the embedder even before isReady() — that call IS the lazy load');
    const final = calls.states.at(-1);
    assert.equal(final?.status, 'ready', `file must index ready, got ${final?.status}`);
    assert.ok(final?.embeddedCount > 0, 'chunks must carry vectors');
    assert.ok(calls.persisted.some((p) => Array.isArray(p.embeddings)), 'vectors must be persisted');
  });

  test('no assigned provider still degrades to lexical_only (prewarm retries later)', async () => {
    let embedCalls = 0;
    const pipeline = {
      isReady: () => false,
      getActiveProviderName: () => undefined, // pipeline not initialized yet
      getActiveSpaceKey: () => null,
      async getEmbeddingsWithFallback() { embedCalls += 1; return { embeddings: [], space: 'x' }; },
    };
    const { hr, calls } = makeRetriever(pipeline);
    await hr.indexFile({ id: 'f2', fileName: 'doc.txt', content: DOC });

    assert.equal(embedCalls, 0, 'no provider: nothing to embed with');
    assert.equal(calls.states.at(-1)?.status, 'lexical_only');
  });
});
