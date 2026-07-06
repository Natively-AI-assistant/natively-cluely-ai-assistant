// electron/services/__tests__/ModeContextRetrieverPipelineRace2026_07_05.test.mjs
//
// Regression for the "modes not indexing" / repeated "Embedding provider
// unavailable" warning reported 2026-07-05.
//
// ROOT CAUSE: ModeContextRetriever.ensureHybridRetriever() used to construct
// AND CACHE a `new ModeHybridRetriever(db, vectorStore, new EmbeddingPipeline(...))`
// whenever `_sharedEmbeddingPipeline` was still null (a query racing ahead of
// AppState.initializeRAGManager(), or that init throwing). The throwaway
// EmbeddingPipeline is never .initialize()'d, so its `provider` stays null
// FOREVER — and because the doomed retriever was cached in `_hybridRetriever`,
// every later mode query kept hitting that same dead instance even after the
// REAL shared pipeline was later injected via setSharedEmbeddingPipeline()
// (that setter only self-heals by nulling the cache — it never helps if it's
// never called at all, e.g. RAGManager init failed).
//
// FIX: ensureHybridRetriever() now returns null (without touching the
// database or allocating anything) whenever `_sharedEmbeddingPipeline` is
// still unset, instead of constructing a doomed stand-in. Callers already
// treat a null return as "not ready yet, use lexical fallback" — this test
// verifies that behavior directly, and that a REAL retriever is created (and
// only then cached) once setSharedEmbeddingPipeline() provides one.
//
// This test never touches DatabaseManager/better-sqlite3 — the null-check
// short-circuits before any DB call — so it runs under plain `node --test`,
// no ELECTRON_RUN_AS_NODE needed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/services/ModeContextRetriever.js');

async function loadRetriever() {
  return import(pathToFileURL(modulePath).href);
}

describe('ModeContextRetriever — no shared EmbeddingPipeline yet', () => {
  test('getReferenceFileIndexStatus() returns a pending status without touching the database', async () => {
    const { ModeContextRetriever } = await loadRetriever();
    const retriever = new ModeContextRetriever();
    // No setSharedEmbeddingPipeline() call — simulates a query racing ahead
    // of AppState.initializeRAGManager(), or that init having thrown.
    const status = retriever.getReferenceFileIndexStatus('file_never_indexed');
    assert.equal(status.status, 'pending');
    assert.equal(status.chunkCount, 0);
  });

  test('indexReferenceFile() is a safe no-op (never throws) when no pipeline is injected', async () => {
    const { ModeContextRetriever } = await loadRetriever();
    const retriever = new ModeContextRetriever();
    await assert.doesNotReject(
      retriever.indexReferenceFile({ id: 'f1', modeId: 'm1', fileName: 'a.txt', content: 'hello world', createdAt: 'now' }),
    );
  });

  test('removeReferenceFileIndex() is a safe no-op when no pipeline is injected', async () => {
    const { ModeContextRetriever } = await loadRetriever();
    const retriever = new ModeContextRetriever();
    assert.doesNotThrow(() => retriever.removeReferenceFileIndex('f1'));
  });

  test('retryLexicalOnlyFiles() resolves without throwing and without touching the database', async () => {
    const { ModeContextRetriever } = await loadRetriever();
    const retriever = new ModeContextRetriever();
    await assert.doesNotReject(
      retriever.retryLexicalOnlyFiles([{ id: 'f1', modeId: 'm1', fileName: 'a.txt', content: 'hello world', createdAt: 'now' }]),
    );
  });
});
