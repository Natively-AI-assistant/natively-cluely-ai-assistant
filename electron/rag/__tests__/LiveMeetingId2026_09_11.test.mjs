// getLiveMeetingId is the ONE answer to "are JIT chunks queryable, and under
// which id" (issue #552). Before it, ipcHandlers hard-coded
// 'live-meeting-current' next to a two-method gate, and the V3 surfaces had
// no way to ask at all — they scoped the meeting port by a metadata id that
// no normal meeting ever sets.
//
// RAGManager loads better-sqlite3 at import, so this file runs under the
// Electron runner (see package.json "test"). The method is exercised through
// the prototype with a fake liveIndexer so no database is needed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { RAGManager } = await import(
  pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron/rag/RAGManager.js')).href
);

const call = (liveIndexer) => RAGManager.prototype.getLiveMeetingId.call({ liveIndexer });

describe('RAGManager.getLiveMeetingId', () => {
  test('null when the live indexer is not running', () => {
    assert.equal(call({ isRunning: () => false, hasIndexedChunks: () => true, getActiveMeetingId: () => 'live-meeting-current' }), null);
  });
  test('null when running but nothing is embedded yet (the first minute of a meeting)', () => {
    assert.equal(call({ isRunning: () => true, hasIndexedChunks: () => false, getActiveMeetingId: () => 'live-meeting-current' }), null);
  });
  test('the active id once at least one chunk is queryable', () => {
    assert.equal(call({ isRunning: () => true, hasIndexedChunks: () => true, getActiveMeetingId: () => 'live-meeting-current' }), 'live-meeting-current');
  });
});
