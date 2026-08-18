// F-414 regression test (audit/autopilot-2026-08-18).
//
// Two defects, one symptom: the trailing transcript of a meeting was silently
// never indexed.
//
//  1. stop()'s "final flush" called tick() directly, and tick() returns
//     IMMEDIATELY when isProcessing is true. A tick parked inside
//     ForegroundGate.waitUntilIdle() (up to 30s while an answer streams) or
//     getEmbeddingsWithFallback() (30s primary + 30s fallback) made the flush a
//     no-op, and stop() then zeroed the buffers. "Ask a question, then stop the
//     meeting" puts waitUntilIdle squarely in that window. MIN_NEW_SEGMENTS
//     also gated the final flush, so a 1-2 segment tail was always lost.
//
//  2. (found while reproducing #1, and worse) the tick advanced its high-water
//     mark to `this.allSegments.length` AT COMPLETION rather than to the slice
//     point it processed. Since feedSegments() keeps appending during the
//     ~90s a tick can be parked, everything spoken mid-tick was marked indexed
//     without ever being chunked — on EVERY periodic tick, not just at stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../../dist-electron/electron/rag/LiveRAGIndexer.js');
const { LiveRAGIndexer } = await import(dist);

function harness() {
  const stored = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const vectorStore = {
    saveChunks: (chunks) => {
      stored.push(...chunks.map((c) => c.text ?? c.content ?? ''));
      return chunks.map((_, i) => stored.length - chunks.length + i + 1);
    },
    storeEmbedding: () => {},
    stampMeetingSpaceIfUnset: () => {},
  };
  const embeddingPipeline = {
    isReady: () => true,
    getActiveSpaceKey: () => 'test:space:3',
    getEmbeddingsWithFallback: async (texts) => {
      await gate;
      return { embeddings: texts.map(() => new Float32Array([1, 0, 0])), provider: 'test', space: 'test:space:3', dim: 3 };
    },
  };
  return { stored, release, indexer: new LiveRAGIndexer(vectorStore, embeddingPipeline) };
}

const seg = (t) => ({ text: t, speaker: 'them', timestamp: Date.now() });

test('a tail spoken while a tick is parked is still indexed at stop()', async () => {
  const { stored, release, indexer } = harness();
  indexer.start('live-meeting-current');
  indexer.feedSegments(Array.from({ length: 6 }, (_, i) => seg(`early sentence number ${i} with enough words to chunk`)));

  // Park a tick inside the provider round-trip (do NOT await it).
  const parked = indexer['tick']().catch(() => {});
  indexer['inFlightTick'] = parked;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(indexer['isProcessing'], true, 'harness must actually park a tick');

  // The user keeps talking while the tick is parked.
  indexer.feedSegments(Array.from({ length: 2 }, (_, i) => seg(`TAIL trailing sentence ${i} spoken while the tick was parked`)));

  setTimeout(() => release(), 20);
  await indexer.stop();

  assert.ok(stored.some((t) => String(t).includes('TAIL')),
    'the trailing transcript must reach the vector store (F-414)');
});

test('the high-water mark advances to what was processed, not the live length', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../LiveRAGIndexer.ts'), 'utf8');
  const i = src.indexOf('const sliceStart = this.indexedSegmentCount');
  assert.notEqual(i, -1, 'the tick must capture its slice point (F-414)');
  assert.ok(/const processedUpTo = sliceStart \+ newSegments\.length/.test(src),
    'the tick must compute how far it actually processed');
  assert.ok(!/indexedSegmentCount = this\.allSegments\.length;/.test(src.slice(i)),
    'no advance site may jump to the LIVE array length — that marks mid-tick segments indexed without chunking them (F-414)');
});
