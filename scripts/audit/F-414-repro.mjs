// F-414 repro: the LiveRAGIndexer "final flush" is a no-op when a tick is in
// flight, so the trailing transcript is discarded.
//
// stop() called tick() directly, and tick() returns IMMEDIATELY when
// isProcessing is true. A tick parked inside ForegroundGate.waitUntilIdle()
// (up to 30s while an answer streams) or getEmbeddingsWithFallback() (30s
// primary + 30s fallback) therefore made the flush do nothing — and stop()
// then zeroed allSegments/indexedSegmentCount, so everything spoken since that
// tick's slice point was never chunked and never embedded. "Ask a question,
// then stop the meeting" puts waitUntilIdle squarely in that window.
// MIN_NEW_SEGMENTS (3) also applied to the final flush, so a meeting ending
// with 1-2 unindexed segments always lost them.
//
// Drives the REAL LiveRAGIndexer with a controllable slow embed step.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../dist-electron/electron/rag/LiveRAGIndexer.js');
const { LiveRAGIndexer } = await import(pathToFileURL(dist).href);

// Minimal collaborators: record what actually reaches the vector store.
const stored = [];
let releaseEmbed;
const embedGate = new Promise((r) => { releaseEmbed = r; });

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
    await embedGate;                              // park the tick, like a slow provider
    return { embeddings: texts.map(() => new Float32Array([1, 0, 0])), provider: 'test', space: 'test:space:3', dim: 3 };
  },
};

const indexer = new LiveRAGIndexer(vectorStore, embeddingPipeline);
indexer.start('live-meeting-current');

// Enough segments to trip the first periodic tick.
indexer.feedSegments(Array.from({ length: 6 }, (_, i) => ({ text: `early sentence number ${i} with enough words to chunk`, speaker: 'them', timestamp: Date.now() })));

// Kick off one tick WITHOUT awaiting it — it parks inside the embed call,
// exactly as a real tick parks in ForegroundGate.waitUntilIdle() or the
// provider round-trip. (Awaiting here would deadlock the harness.)
const parkedTick = indexer['tick']().catch(() => {});
indexer['inFlightTick'] = parkedTick;   // what the interval wiring records
await new Promise((r) => setTimeout(r, 30));
const parked = indexer['isProcessing'] === true;

// While it is parked, the user keeps talking — this is the tail at risk.
indexer.feedSegments(Array.from({ length: 2 }, (_, i) => ({ text: `TAIL trailing sentence ${i} spoken while the tick was parked`, speaker: 'them', timestamp: Date.now() })));

// User stops the meeting. Let the parked provider finish shortly after.
setTimeout(() => releaseEmbed(), 50);
await indexer.stop();

const tailIndexed = stored.some((t) => String(t).includes('TAIL'));
console.log('[F-414] tick parked mid-flight:', parked, '| chunks stored:', stored.length, '| tail indexed:', tailIndexed);

if (!parked) { console.error('[F-414] Inconclusive: could not park a tick in flight'); process.exit(2); }
if (!tailIndexed) {
  console.error('[F-414] FAIL: the trailing transcript was discarded — the final flush no-opped behind the in-flight tick and stop() then cleared the buffer (F-414 reproduced).');
  process.exit(1);
}
console.log('[F-414] PASS: stop() awaited the in-flight tick and force-flushed the tail.');
process.exit(0);
