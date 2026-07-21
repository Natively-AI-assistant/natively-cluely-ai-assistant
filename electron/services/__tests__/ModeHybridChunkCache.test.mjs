// electron/services/__tests__/ModeHybridChunkCache.test.mjs
//
// MEDIUM (audit finding #8) — ModeHybridRetriever.getModeFileChunks() re-chunked
// file.content on EVERY query even when the content was unchanged and persisted
// chunks already existed. This drives the REAL compiled ModeHybridRetriever and
// asserts that repeated queries against an unchanged file chunk the content only
// once, re-chunk when the content changes, and re-chunk after cache invalidation
// (removeFileIndex / removeFile).
//
// Run under the Electron ABI (better-sqlite3 built for Electron):
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mhrPath = path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js');
const { ModeHybridRetriever } = await import(pathToFileURL(mhrPath).href);

// Stubs: the cache lives entirely in getModeFileChunks (lexical pre-stage), so a
// not-ready embedding pipeline keeps retrieve() on the deterministic lexical path.
const stubVectorStore = {};
const stubEmbeddingPipeline = {
  isReady: () => false,
  getActiveSpaceKey: () => null,
  getEmbeddingForQuery: async () => { throw new Error('not ready'); },
  getEmbeddings: async () => { throw new Error('not ready'); },
};

function makeFile(id, content) {
  return { id, modeId: 'mode-1', fileName: `${id}.txt`, content, createdAt: '2026-06-16T00:00:00Z' };
}

describe('ModeHybridRetriever chunk cache (audit finding #8)', () => {
  let db;
  let retriever;
  let chunkCalls;

  beforeEach(() => {
    db = new Database(':memory:');
    retriever = new ModeHybridRetriever(db, stubVectorStore, stubEmbeddingPipeline);
    // Spy on the private chunkText to count how often chunking actually runs.
    chunkCalls = new Map();
    const realChunk = retriever.chunkText.bind(retriever);
    retriever.chunkText = (content) => {
      chunkCalls.set(content, (chunkCalls.get(content) || 0) + 1);
      return realChunk(content);
    };
  });

  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  test('repeated queries against an unchanged file chunk the content only once', async () => {
    const content = 'The quick brown fox jumps over the lazy dog. '.repeat(20);
    const files = [makeFile('f1', content)];

    await retriever.retrieve({ query: 'fox jumps', modeId: 'mode-1', files });
    await retriever.retrieve({ query: 'lazy dog', modeId: 'mode-1', files });
    await retriever.retrieve({ query: 'quick brown', modeId: 'mode-1', files });

    assert.equal(chunkCalls.get(content.trim()), 1,
      'unchanged content must be chunked exactly once across 3 queries');
  });

  test('changed content (new hash) is re-chunked', async () => {
    const v1 = 'Version one content about apples and oranges. '.repeat(20);
    const v2 = 'Version two content about bananas and grapes. '.repeat(20);

    await retriever.retrieve({ query: 'apples', modeId: 'mode-1', files: [makeFile('f1', v1)] });
    await retriever.retrieve({ query: 'bananas', modeId: 'mode-1', files: [makeFile('f1', v2)] });
    // Querying v1 again would re-chunk v1 (cache now holds v2).
    await retriever.retrieve({ query: 'apples', modeId: 'mode-1', files: [makeFile('f1', v1)] });

    assert.equal(chunkCalls.get(v1.trim()), 2, 'v1 chunked on first use and again after v2 evicted it');
    assert.equal(chunkCalls.get(v2.trim()), 1, 'v2 chunked once');
  });

  test('removeFileIndex invalidates the cache → next query re-chunks', async () => {
    const content = 'Cache invalidation is one of the two hard problems. '.repeat(20);
    const files = [makeFile('f1', content)];

    await retriever.retrieve({ query: 'hard problems', modeId: 'mode-1', files });
    retriever.removeFileIndex('f1');
    await retriever.retrieve({ query: 'hard problems', modeId: 'mode-1', files });

    assert.equal(chunkCalls.get(content.trim()), 2,
      'after removeFileIndex the file must be re-chunked');
  });

  test('removeFile invalidates the cache → next query re-chunks', async () => {
    const content = 'Another reference document about deployment pipelines. '.repeat(20);
    const files = [makeFile('f1', content)];

    await retriever.retrieve({ query: 'deployment', modeId: 'mode-1', files });
    retriever.removeFile('f1');
    await retriever.retrieve({ query: 'pipelines', modeId: 'mode-1', files });

    assert.equal(chunkCalls.get(content.trim()), 2,
      'after removeFile the file must be re-chunked');
  });
});
