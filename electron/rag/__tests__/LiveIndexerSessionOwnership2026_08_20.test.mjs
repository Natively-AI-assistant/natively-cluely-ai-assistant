// R-16b regression test. The session-token guard itself landed on main as CR-02;
// what is pinned here is that a parked batch cannot WRITE after losing ownership.
//
// R-03 added stillOwns()/stop() guards so a tick parked ~90s could not write
// into, or tear down, a meeting that started meanwhile. They keyed on
// `meetingId` — but the only production caller (main.ts:5940 →
// RAGManager.startLiveIndexing) passes the CONSTANT 'live-meeting-current' for
// every meeting. Two consecutive sessions therefore carried the same id, so
// `this.meetingId === meetingId` was always true and the guards were inert in
// exactly the race they were written for.
//
// The race is not hypothetical: main.ts:6206 awaits stopLiveIndexing() inside a
// BACKGROUND teardown IIFE, stop() parks on inFlightTick, and main.ts:6222
// already logs "New meeting started during cleanup".
//
// Measured on the unfixed build: meeting B inherited A's absolute
// indexedSegmentCount (40 against B's 5 segments), which drives newSegmentCount
// negative so every later tick early-returns; then A's late stop() ran the full
// reset and B was dead — isActive=false, meetingId=null, feed and tick no-ops
// forever. No test drove two sessions, which is why it shipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../../dist-electron/electron/rag/LiveRAGIndexer.js');
const { LiveRAGIndexer } = await import(pathToFileURL(dist).href);

const LIVE_ID = 'live-meeting-current';  // the constant every meeting is given

function harness() {
  const embedded = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const vectorStore = {
    saveChunks: (chunks) => chunks.map((_, i) => i + 1),
    storeEmbedding: (id) => { embedded.push(id); },
    stampMeetingSpaceIfUnset: () => {},
    restampMeetingSpaceOnChange: () => {},
  };
  const embeddingPipeline = {
    isReady: () => true,
    getEmbeddingsWithFallback: async (texts) => {
      await gate;
      return { embeddings: texts.map(() => new Float32Array([1, 0, 0])), provider: 'test', space: 'test:space:3', dimensions: 3 };
    },
  };
  return { embedded, release, indexer: new LiveRAGIndexer(vectorStore, embeddingPipeline) };
}

const seg = (t) => ({ text: t, speaker: 'them', timestamp: Date.now() });

/** Meeting A parked mid-tick, its teardown stop() parked behind it, then B starts. */
async function overlapSessions() {
  const h = harness();
  const { indexer } = h;

  indexer.start(LIVE_ID);                                   // meeting A
  indexer.feedSegments(Array.from({ length: 40 }, (_, i) => seg(`meeting A sentence ${i} with enough words to chunk`)));
  const parked = indexer['tick']().catch(() => {});
  indexer['inFlightTick'] = parked;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(indexer['isProcessing'], true, 'harness must actually park a tick');

  const teardown = indexer.stop();                          // main.ts:6206, un-awaited here
  await new Promise((r) => setTimeout(r, 10));

  indexer.start(LIVE_ID);                                   // meeting B, same constant id
  indexer.feedSegments(Array.from({ length: 5 }, (_, i) => seg(`meeting B sentence ${i} with enough words to chunk`)));

  h.release();                                              // A's parked tick resumes
  await parked;
  // Snapshot BEFORE the late stop() resumes. On the unfixed build that stop()
  // zeroes every counter as it tears meeting B down, which would mask the
  // cross-session write this snapshot exists to catch.
  const afterLateTick = {
    indexedSegmentCount: indexer['indexedSegmentCount'],
    indexedChunkCount: indexer['indexedChunkCount'],
  };
  await teardown;
  return { ...h, parked, afterLateTick };
}

/** The 30s indexing interval would otherwise hold the test runner's event loop open. */
function disposeTimer(indexer) {
  if (indexer['timer']) { clearInterval(indexer['timer']); indexer['timer'] = null; }
}

test("a previous session's parked tick cannot write into the new session", async () => {
  const { indexer, afterLateTick } = await overlapSessions();
  try {
    assert.equal(afterLateTick.indexedSegmentCount, 0,
      "meeting A's absolute high-water mark must not be written into meeting B — a "
      + 'positive value here drives newSegmentCount negative and B is never indexed again');
    assert.equal(afterLateTick.indexedChunkCount, 0,
      "meeting A's chunk count must not be credited to meeting B");
  } finally { disposeTimer(indexer); }
});

test("a previous session's late stop() cannot tear down the new session", async () => {
  const { indexer } = await overlapSessions();
  try {
    assert.equal(indexer['isActive'], true, 'meeting B must still be active');
    assert.equal(indexer['meetingId'], LIVE_ID, 'meeting B must still own the indexer');
    assert.equal(indexer['allSegments'].length, 5, "meeting B's buffered transcript must survive");

    // And B must still actually index — the teardown must not have left it inert.
    indexer.feedSegments(Array.from({ length: 4 }, (_, i) => seg(`meeting B later sentence ${i} with enough words`)));
    assert.equal(indexer['allSegments'].length, 9, 'feedSegments must still be accepted for meeting B');
  } finally { disposeTimer(indexer); }
});

test('the ownership guard does not key on the caller-supplied meeting id', async () => {
  // The whole defect was that two sessions are indistinguishable by id. Pin the
  // property directly so a future refactor cannot silently reintroduce it.
  const { indexer } = harness();
  indexer.start(LIVE_ID);
  const first = indexer['sessionToken'];
  indexer.start(LIVE_ID);
  try {
    assert.notEqual(indexer['sessionToken'], first,
      'a new start() with the SAME meeting id must still produce a distinct session identity');
  } finally { disposeTimer(indexer); }
});
