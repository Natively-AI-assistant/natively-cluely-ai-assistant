/**
 * CR-02 (code-review HIGH #2): the R-03 session-identity guard in
 * LiveRAGIndexer.stop() compares meetingId VALUES, but the only production
 * caller passes the literal constant 'live-meeting-current'
 * (electron/main.ts:5992). An overlapping start() therefore sets meetingId to a
 * string EQUAL to the captured one, the guard cannot fire, and the stale stop()
 * flushes into and then tears down the freshly started session.
 *
 * Repro: park a tick inside the embedding call, call stop() WITHOUT awaiting
 * (exactly what start() does), start a new session, then release the parked
 * tick so stop() resumes and evaluates its guard.
 */
const path = require('path');
const { LiveRAGIndexer } = require(path.resolve(__dirname, '../..', 'dist-electron/electron/rag/LiveRAGIndexer.js'));

const LIVE_ID = 'live-meeting-current'; // electron/main.ts:5992 — the ONLY caller

let release;
const parked = new Promise((r) => { release = r; });

const vectorStore = {
  saveChunks: (chunks) => chunks.map((_, i) => `c${i}`),
  storeEmbedding: () => {},
  updateEmbedding: () => {}, updateChunkEmbedding: () => {}, saveEmbedding: () => {},
  stampMeetingSpaceIfUnset: () => {}, restampMeetingSpaceOnChange: () => {},
  deleteMeeting: () => {}, purgeMeeting: () => {}, removeMeetingChunks: () => {},
};
const embeddingPipeline = {
  isReady: () => true,
  getEmbeddingsWithFallback: async (t) => {
    await parked;               // stands in for ForegroundGate + provider latency (~90s in prod)
    return { embeddings: t.map(() => [0.1, 0.2]), space: 'stub', provider: 'stub', dimensions: 2 };
  },
  getEmbeddings: async (t) => { await parked; return t.map(() => [0.1, 0.2]); },
  getProviderInfo: () => ({ provider: 'stub', dimensions: 2, space: 'stub' }),
  getActiveProvider: () => 'stub',
};

const seg = (i) => ({
  speaker: i % 2 ? 'interviewer' : 'user',
  text: `This is transcript segment number ${i}, long enough to survive preprocessing and chunking.`,
  timestamp: Date.now() + i * 1000,
});

(async () => {
  const ix = new LiveRAGIndexer(vectorStore, embeddingPipeline);

  // --- Meeting A ---
  ix.start(LIVE_ID);
  ix.feedSegments(Array.from({ length: 8 }, (_, i) => seg(i)));
  const tickA = ix.tick(true);                 // parks inside the embedding call
  await new Promise((r) => setImmediate(r));

  // Meeting A ends. Production calls stop() WITHOUT awaiting it (start() -> stop()).
  const stoppingA = ix.stop();

  // --- Meeting B starts while A's stop() is still parked ---
  ix.start(LIVE_ID);
  ix.feedSegments(Array.from({ length: 8 }, (_, i) => seg(100 + i)));
  const activeAfterStartB = ix.isRunning();

  // A's parked tick completes; A's stop() resumes and evaluates its guard.
  release();
  await tickA.catch(() => {});
  await stoppingA.catch(() => {});
  await new Promise((r) => setTimeout(r, 50));

  const activeB = ix.isRunning();
  console.log(`session B running immediately after start()      : ${activeAfterStartB}`);
  console.log(`session B running after A's stale stop() resumed : ${activeB}`);

  if (activeAfterStartB && !activeB) {
    console.log("\nREPRODUCED: the stale stop() tore down the live session — the identity guard never fired.");
    process.exit(0);
  }
  console.log('\nNOT reproduced: session B survived A\'s stale stop().');
  process.exit(3);
})();
