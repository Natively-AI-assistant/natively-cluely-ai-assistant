// R-21 regression test.
//
// F-415 made the live indexer re-stamp meetings.embedding_space when a later
// tick fell back to a different provider — but left every chunk embedded under
// the OLD space in place. The query-time filter is meeting-level, so after the
// re-stamp a same-dimension provider scored stale-space vectors against
// new-space queries, and a different-dimension one produced hidden orphans:
// the re-index sweep's `embedding_space IS NOT NULL AND != ?` is false once the
// row claims the new space. The queued path had always cleared first
// (EmbeddingPipeline.activateMeetingFallback → clearEmbeddingsForMeeting); only
// the live path lacked an equivalent.
//
// Ordering matters as much as the clear: the re-stamp now discards vectors, so
// it must run BEFORE the batch is stored, not after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const vs = fs.readFileSync(new URL('../VectorStore.ts', import.meta.url), 'utf8');
const ix = fs.readFileSync(new URL('../LiveRAGIndexer.ts', import.meta.url), 'utf8');

test('re-stamping discards the vectors embedded under the old space', () => {
  const i = vs.indexOf('restampMeetingSpaceOnChange(meetingId: string');
  assert.notEqual(i, -1, 'restampMeetingSpaceOnChange must still exist');
  const body = vs.slice(i, i + 1800);

  const clear = body.indexOf('clearEmbeddingsForMeeting');
  const update = body.indexOf('UPDATE meetings SET embedding_provider');
  assert.notEqual(clear, -1,
    'the old space\'s vectors must be cleared, or they are scored against new-space queries');
  assert.ok(clear < update,
    'clear BEFORE the UPDATE — clearEmbeddingsForMeeting nulls embedding_space, so clearing after would undo the re-stamp');
});

test('the live indexer re-stamps before storing, not after', () => {
  const i = ix.indexOf('private async runTick');
  assert.notEqual(i, -1);
  const body = ix.slice(i);

  const restamp = body.indexOf('restampMeetingSpaceOnChange');
  const store = body.indexOf('this.vectorStore.storeEmbedding(');
  assert.notEqual(restamp, -1, 'the live path must still settle the space on a provider change');
  assert.notEqual(store, -1);
  assert.ok(restamp < store,
    're-stamping now clears embeddings, so doing it after storeEmbedding would wipe the batch just written');
});

test('a re-stamp resets the queryable-chunk count', () => {
  const i = ix.indexOf('restampMeetingSpaceOnChange');
  const window = ix.slice(i, i + 400);
  assert.ok(/this\.indexedChunkCount = 0/.test(window),
    'every previously embedded chunk just lost its vector; hasIndexedChunks() must not keep claiming otherwise');
});
