#!/usr/bin/env node
/**
 * R-03 repro — F-414's stop()-flush mechanism never fires, and its high-water
 * mark poisons the NEXT meeting.
 *
 * (1a) The interval assigned `inFlightTick` for EVERY tick, including the ones
 *      that return instantly at the `isProcessing` guard. That no-op promise's
 *      completion nulled the ref while the real tick was still parked, so
 *      stop() awaited nothing and its "final flush" hit the same isProcessing
 *      guard — the exact no-op F-414 was written to eliminate. Transcript
 *      spoken after the parked tick's slice point is discarded by stop()'s reset.
 *
 * (1b) The parked tick then resumes AFTER stop() and the next start(), and
 *      writes its absolute `processedUpTo` into the NEW meeting's
 *      indexedSegmentCount. newSegmentCount goes negative, every later tick
 *      early-returns, and the new meeting is never live-indexed at all.
 *      Baseline's `= this.allSegments.length` self-clamped and recovered, so
 *      this is a REGRESSION, not merely an unfixed bug.
 *
 * Runs the REAL built LiveRAGIndexer with a stub VectorStore and an embedding
 * pipeline parked long enough to straddle an interval boundary.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-03-repro.cjs
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { LiveRAGIndexer } = require(path.join(REPO, 'dist-electron', 'electron', 'rag', 'LiveRAGIndexer.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Shrink the 30s interval so the test runs in seconds. The defect is about the
// RELATIONSHIP between park duration and interval, not the absolute values.
const INTERVAL = 300;
const PARK = 900;      // a tick parks for 3 interval periods

const savedChunks = [];
const vectorStore = {
  saveChunks: (chunks) => { savedChunks.push(...chunks); return chunks.map((_, i) => savedChunks.length - chunks.length + i + 1); },
  storeEmbedding: () => {},
  stampMeetingSpaceIfUnset: () => {},
  restampMeetingSpaceOnChange: () => {},
};
let parkCount = 0;
const embeddingPipeline = {
  isReady: () => true,
  getEmbeddingsWithFallback: async (texts) => {
    parkCount++;
    await sleep(PARK);
    return { embeddings: texts.map(() => new Float32Array(3)), space: 's', provider: 'p', dimensions: 3 };
  },
};

// ForegroundGate is require()d lazily inside the tick; stub it in the cache.
const fgPath = require.resolve(path.join(REPO, 'dist-electron', 'electron', 'services', 'ForegroundGate.js'));
require.cache[fgPath] = { id: fgPath, filename: fgPath, loaded: true, exports: { ForegroundGate: { waitUntilIdle: async () => {} } } };

const seg = (i) => ({ speaker: 'A', text: `segment number ${i} with enough words to survive preprocessing and chunking`, timestamp: Date.now() });

(async () => {
  const idx = new LiveRAGIndexer(vectorStore, embeddingPipeline);
  // Retarget the interval without touching the source constant.
  const realSetInterval = global.setInterval;
  global.setInterval = (fn) => realSetInterval(fn, INTERVAL);

  idx.start('meeting-A');
  idx.feedSegments([seg(1), seg(2), seg(3), seg(4), seg(5)]);

  await sleep(INTERVAL + 100);            // tick 1 fires and parks in embeddings
  idx.feedSegments([seg(6), seg(7), seg(8), seg(9), seg(10)]);  // spoken while parked
  await sleep(INTERVAL * 2);              // two more no-op ticks fire and settle

  const t0 = Date.now();
  await idx.stop();                       // must WAIT for the parked tick, then flush
  const stopMs = Date.now() - t0;
  const chunksAfterA = savedChunks.length;

  console.log(`[R-03] embedding calls during A : ${parkCount}`);
  console.log(`[R-03] stop() took             : ${stopMs}ms (0ms => it awaited nothing)`);
  console.log(`[R-03] chunk batches saved for A: ${chunksAfterA}`);

  // --- meeting B: the parked tick must not poison it ---
  idx.start('meeting-B');
  idx.feedSegments([seg(11), seg(12), seg(13), seg(14), seg(15)]);
  await sleep(PARK + INTERVAL * 3);       // let any orphaned tick land, then tick B
  await idx.stop();

  const chunksForB = savedChunks.filter((c) => c.meetingId === 'meeting-B').length;
  const chunksForA = savedChunks.filter((c) => c.meetingId === 'meeting-A').length;
  global.setInterval = realSetInterval;

  console.log(`[R-03] chunks indexed for A     : ${chunksForA}`);
  console.log(`[R-03] chunks indexed for B     : ${chunksForB} (expected > 0)`);

  let failures = 0;
  if (stopMs < PARK / 2) {
    console.error(`[R-03] FAIL(1a): stop() returned in ${stopMs}ms without awaiting the parked tick — the final flush is a no-op and the trailing transcript is dropped.`);
    failures++;
  }
  if (chunksForA < 2) {
    console.error(`[R-03] FAIL(1a): meeting A indexed ${chunksForA} chunks; the segments spoken while the tick was parked were never chunked.`);
    failures++;
  }
  if (chunksForB === 0) {
    console.error('[R-03] FAIL(1b): meeting B was never live-indexed — a dead session\'s absolute high-water mark drove newSegmentCount negative.');
    failures++;
  }
  if (failures) process.exit(1);
  console.log('[R-03] PASS: stop() awaited the parked tick, A\'s trailing transcript was indexed, and B indexed normally.');
  process.exit(0);
})();
