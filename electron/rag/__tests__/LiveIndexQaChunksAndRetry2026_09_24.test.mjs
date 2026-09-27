// Live meeting index: question/answer chunks and embedding retry (2026-09-24).
//
// 1. The chunker split at EVERY speaker change, so an interviewer's "How big
//    was the team?" and the user's "It was four engineers" became two chunks,
//    and a semantic search found the answer without the question that gives it
//    meaning. Chunk text also carried NO speaker labels, so the model could
//    not tell who said what — and the grounding rule that lets the user's own
//    spoken words evidence a personal fact reads the ME: label.
// 2. A failed (or not-yet-ready) embedding call was never retried: the chunks
//    were saved without vectors and the high-water mark moved on, so that
//    stretch of the meeting stayed invisible to semantic search until the
//    meeting ended. One call carried the whole backlog, so a burst could
//    exceed the 30 s embed timeout and fail as a unit.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (rel) => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag', rel)).href);
const { chunkTranscript } = await load('SemanticChunker.js');
const { preprocessTranscript } = await load('TranscriptPreprocessor.js');
const { LiveRAGIndexer } = await load('LiveRAGIndexer.js');

const T0 = 1_700_000_000_000;
const interview = [
  ['interviewer', 'Thanks for joining. Our core services are written in Elixir and our pain is write load on one Postgres primary.'],
  ['user', 'Great. At Brightline Freight I led the migration of our tracking API from REST to gRPC, and p99 went from about 900 milliseconds to 140.'],
  ['interviewer', 'Nice. And how big was the team on that?'],
  ['user', 'It was four engineers, and I owned the rollout plan and the load testing.'],
  ['interviewer', 'What did you use to measure the latency?'],
  ['user', 'Mostly Prometheus and Grafana, plus tracing on the critical paths.'],
  ['interviewer', 'One more thing about us: we deploy with Nomad, not Kubernetes.'],
  ['user', 'Good to know, that changes how I would stage a canary.'],
];
const raw = (rows, gapMs = 20_000) => rows.map(([speaker, text], i) => ({ speaker, text, timestamp: T0 + i * gapMs }));
const chunksOf = (rows, gapMs) => chunkTranscript('m1', preprocessTranscript(raw(rows, gapMs)));

describe('chunks keep a question with its answer', () => {
  const chunks = chunksOf(interview);

  test('the team-size question and its answer share a chunk', () => {
    assert.ok(chunks.some((c) => /how big was the team/i.test(c.text) && /four engineers/i.test(c.text)),
      chunks.map((c) => c.text).join('\n---\n'));
  });

  test('every turn carries its speaker label', () => {
    const all = chunks.map((c) => c.text).join('\n');
    // (the preprocessor strips fillers like "Nice.")
    assert.match(all, /^THEM: (?:Nice\. )?And how big was the team on that\?$/m);
    assert.match(all, /ME: It was four engineers/);
  });

  test('a short interview is a few chunks, not one per speaker turn', () => {
    assert.ok(chunks.length < interview.length / 2, `${chunks.length} chunks for ${interview.length} turns`);
  });

  test('no chunk ends on a question whose answer lives only in the next chunk', () => {
    for (let i = 0; i < chunks.length - 1; i++) {
      const lines = chunks[i].text.split('\n');
      const last = lines[lines.length - 1];
      if (/\?\s*$/.test(last)) {
        assert.ok(chunks[i + 1].text.includes(last), `question "${last}" was cut off from its answer`);
      }
    }
  });

  test('chunks stay bounded on a long meeting', () => {
    const long = Array.from({ length: 120 }, (_, i) => [i % 2 ? 'user' : 'interviewer',
      `Turn ${i} talks about the roadmap review, the hiring plan and the analytics migration in some detail so it has length.`]);
    const cs = chunksOf(long);
    for (const c of cs) assert.ok(c.tokenCount <= 480, `chunk of ${c.tokenCount} tokens`);
    assert.ok(cs.length >= 10 && cs.length <= 60, `${cs.length} chunks for 120 turns`);
  });
});

function harness({ failFirst = 0, readyAfter = 0, restampOnCall = -1 } = {}) {
  const rows = [];
  const embedded = new Map();
  const calls = [];
  let readyChecks = 0;
  const vectorStore = {
    saveChunks: (chunks) => chunks.map((c) => { rows.push(c.text); return rows.length; }),
    storeEmbedding: (id, v) => { embedded.set(id, v); },
    stampMeetingSpaceIfUnset: () => {},
    restampMeetingSpaceOnChange: () => {
      if (calls.length - 1 === restampOnCall) { embedded.clear(); return true; }
      return false;
    },
  };
  const embeddingPipeline = {
    isReady: () => (readyChecks++ >= readyAfter),
    getActiveSpaceKey: () => 'test:space:3',
    getEmbeddingsWithFallback: async (texts) => {
      calls.push(texts.length);
      if (calls.length <= failFirst) throw new Error('embedBatch() timed out after 30000ms');
      return { embeddings: texts.map(() => new Float32Array([1, 0, 0])), provider: 'test', space: 'test:space:3', dimensions: 3 };
    },
  };
  return { rows, embedded, calls, indexer: new LiveRAGIndexer(vectorStore, embeddingPipeline) };
}
const feed = (indexer, n, from = 0) => indexer.feedSegments(Array.from({ length: n }, (_, i) => ({
  speaker: (from + i) % 2 ? 'user' : 'interviewer',
  text: `Sentence ${from + i} about the migration plan, with enough words that it becomes its own line in a chunk.`,
  timestamp: T0 + (from + i) * 20_000,
})));

describe('a tick boundary between a question and its answer', () => {
  test('the answer\'s chunk carries the question asked at the end of the previous tick', async () => {
    const { rows, indexer } = harness();
    indexer.start('live-meeting-current');
    try {
      indexer.feedSegments([
        { speaker: 'interviewer', text: 'Let us talk about your last project and the migration you ran.', timestamp: T0 },
        { speaker: 'user', text: 'Sure, it was a REST to gRPC migration of the tracking API.', timestamp: T0 + 20_000 },
        { speaker: 'interviewer', text: 'How big was the team on that?', timestamp: T0 + 40_000 },
      ]);
      await indexer['tick']();
      indexer.feedSegments([
        { speaker: 'user', text: 'It was four engineers, and I owned the rollout plan.', timestamp: T0 + 60_000 },
        { speaker: 'interviewer', text: 'Great, thanks.', timestamp: T0 + 80_000 },
        { speaker: 'user', text: 'Happy to go deeper on any part of it.', timestamp: T0 + 100_000 },
      ]);
      await indexer['tick']();
      assert.ok(rows.some((t) => /How big was the team/.test(t) && /four engineers/.test(t)), rows.join('\n---\n'));
    } finally { await indexer.stop(); }
  });
});

describe('embedding is retried instead of dropped', () => {
  test('a failed batch is embedded on the next tick, with no new speech', async () => {
    const { rows, embedded, indexer } = harness({ failFirst: 1 });
    indexer.start('live-meeting-current');
    try {
      feed(indexer, 6);
      await indexer['tick']();
      assert.equal(embedded.size, 0, 'harness: the first call must fail');
      assert.equal(indexer.hasIndexedChunks(), false);
      await indexer['tick']();
      assert.equal(embedded.size, rows.length, 'every saved chunk has a vector after the retry');
      assert.equal(indexer.hasIndexedChunks(), true);
    } finally { await indexer.stop(); }
  });

  test('chunks saved while the pipeline was not ready are embedded once it is', async () => {
    const { rows, embedded, indexer } = harness({ readyAfter: 1 });
    indexer.start('live-meeting-current');
    try {
      feed(indexer, 6);
      await indexer['tick']();
      assert.equal(embedded.size, 0);
      await indexer['tick']();
      assert.equal(embedded.size, rows.length);
    } finally { await indexer.stop(); }
  });

  test('a backlog is embedded in small batches, so one burst cannot time out as a unit', async () => {
    const { rows, embedded, calls, indexer } = harness();
    indexer.start('live-meeting-current');
    try {
      feed(indexer, 400);
      await indexer['tick']();
      assert.ok(rows.length > 16, `harness: need a backlog, got ${rows.length} chunks`);
      assert.ok(Math.max(...calls) <= 16, `largest embed call carried ${Math.max(...calls)} chunks`);
      assert.equal(embedded.size, rows.length);
    } finally { await indexer.stop(); }
  });

  test('stop() gives pending chunks one last try', async () => {
    const { rows, embedded, indexer } = harness({ failFirst: 1 });
    indexer.start('live-meeting-current');
    feed(indexer, 6);
    await indexer['tick']();
    await indexer.stop();
    assert.equal(embedded.size, rows.length);
  });

  test('an embedding-space change re-queues the chunks whose vectors it discarded', async () => {
    const { rows, embedded, indexer } = harness({ restampOnCall: 1 });
    indexer.start('live-meeting-current');
    try {
      feed(indexer, 6);
      await indexer['tick']();
      const firstBatch = embedded.size;
      assert.ok(firstBatch > 0);
      feed(indexer, 6, 6);
      await indexer['tick']();        // this batch re-stamps the space: earlier vectors are gone
      await indexer['tick']();        // ...and are re-embedded here
      assert.equal(embedded.size, rows.length, 'every chunk has a vector in the new space');
    } finally { await indexer.stop(); }
  });
});
