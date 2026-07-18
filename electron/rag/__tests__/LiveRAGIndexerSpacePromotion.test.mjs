// electron/rag/__tests__/LiveRAGIndexerSpacePromotion.test.mjs
//
// Regression for live indexing when the primary embedding provider dies mid-tick.
// The old per-chunk path could store early chunks in the cloud space, promote the
// pipeline to local on a later chunk, then stamp the whole meeting as local —
// leaving the early cloud chunks permanently search-invisible.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const liPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/LiveRAGIndexer.js');
const esPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingSpace.js');

const { LiveRAGIndexer } = await import(pathToFileURL(liPath).href);
const { embeddingSpaceKey } = await import(pathToFileURL(esPath).href);

const SPACE_CLOUD = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 768 });
const SPACE_LOCAL = embeddingSpaceKey({ name: 'local', model: 'xenova/all-minilm-l6-v2', dimensions: 384 });

function vec(dim, fill) {
  return new Array(dim).fill(fill);
}

function makeVectorStore() {
  let nextId = 1;
  const chunks = [];
  const meetings = new Map();
  return {
    chunks,
    meetings,
    saveChunks(inputChunks) {
      const ids = [];
      for (const chunk of inputChunks) {
        const id = nextId++;
        ids.push(id);
        chunks.push({ id, ...chunk, embedding: null, embeddingSpace: null });
      }
      return ids;
    },
    storeEmbedding(chunkId, embedding) {
      const chunk = chunks.find(c => c.id === chunkId);
      if (!chunk) throw new Error(`missing chunk ${chunkId}`);
      chunk.embedding = embedding;
      // The test pipeline exposes the space that produced the most recent vector.
      chunk.embeddingSpace = this.currentProducedSpace;
    },
    stampMeetingSpaceIfUnset(meetingId, providerName, dimensions, space) {
      if (!meetings.has(meetingId)) meetings.set(meetingId, { providerName, dimensions, space });
    },
    searchableChunks(meetingId, space) {
      const meeting = meetings.get(meetingId);
      if (!meeting || meeting.space !== space) return [];
      return chunks.filter(c => c.meetingId === meetingId && c.embedding && c.embeddingSpace === space);
    },
  };
}

function makePipeline(vectorStore) {
  let activeSpace = SPACE_CLOUD;
  let singleCalls = 0;
  return {
    isReady: () => true,
    getActiveProviderName: () => activeSpace === SPACE_LOCAL ? 'local' : 'gemini',
    getActiveSpaceKey: () => activeSpace,
    getActiveDimensions: () => activeSpace === SPACE_LOCAL ? 384 : 768,

    // Legacy per-chunk path behavior: first chunk succeeds in cloud, then primary
    // dies and the pipeline promotes to local. If LiveRAGIndexer ever regresses
    // to per-chunk getEmbedding()+post-loop stamp, this fixture will recreate the
    // orphan: chunk 1 cloud-space, meeting local-space.
    async getEmbedding() {
      singleCalls++;
      if (singleCalls === 1) {
        vectorStore.currentProducedSpace = SPACE_CLOUD;
        return vec(768, 0.25);
      }
      activeSpace = SPACE_LOCAL;
      vectorStore.currentProducedSpace = SPACE_LOCAL;
      return vec(384, 0.75);
    },

    // Fixed path: a batch-level failure promotes the whole tick to local and
    // returns one coherent space label for every vector stored from the batch.
    async getEmbeddingsWithFallback(texts) {
      activeSpace = SPACE_LOCAL;
      vectorStore.currentProducedSpace = SPACE_LOCAL;
      return {
        embeddings: texts.map(() => vec(384, 0.75)),
        space: SPACE_LOCAL,
        provider: 'local',
        dimensions: 384,
      };
    },
  };
}

describe('LiveRAGIndexer provider promotion space coherence', () => {
  test('mid-tick primary failure falls back coherently: every stored live chunk is searchable in the stamped space', async () => {
    const meetingId = 'live-promotion-regression';
    const vectorStore = makeVectorStore();
    const pipeline = makePipeline(vectorStore);
    const indexer = new LiveRAGIndexer(vectorStore, pipeline);

    indexer.start(meetingId);
    indexer.feedSegments([
      { speaker: 'Alice', text: 'Alpha planning segment has enough useful words for indexing.', timestamp: 1000 },
      { speaker: 'Bob', text: 'Beta response segment also has enough useful words for indexing.', timestamp: 2000 },
      { speaker: 'Alice', text: 'Gamma followup segment keeps the live index multi chunk.', timestamp: 3000 },
    ]);

    await indexer.stop();

    const meeting = vectorStore.meetings.get(meetingId);
    assert.equal(meeting?.providerName, 'local');
    assert.equal(meeting?.dimensions, 384);
    assert.equal(meeting?.space, SPACE_LOCAL);

    assert.ok(vectorStore.chunks.length >= 2, 'test fixture should produce multiple live chunks');
    assert.ok(vectorStore.chunks.every(c => c.embedding), 'all live chunks should be embedded after fallback');
    assert.ok(vectorStore.chunks.every(c => c.embedding.length === 384), 'no pre-promotion cloud-dimension chunk should remain stored');
    assert.ok(vectorStore.chunks.every(c => c.embeddingSpace === SPACE_LOCAL), 'every stored vector should be produced in the stamped local space');

    const searchable = vectorStore.searchableChunks(meetingId, SPACE_LOCAL);
    assert.equal(searchable.length, vectorStore.chunks.length, 'every embedded chunk must be search-visible under the stamped local space');
  });
});
