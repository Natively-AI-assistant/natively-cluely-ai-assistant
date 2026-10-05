// A vector that is all zeros, or holds a NaN or an infinity, cannot be
// searched. sqlite-vec stores it anyway and returns a NULL distance for it, and
// `1 - null` is 1 — so such a row came back from the native search as a perfect
// match (2026-10-05). The searches skip a row with no distance (covered in
// electron/db/__tests__/VecRebuildBoundedAndDeferred2026_10_05.test.mjs); this
// file covers the cause: the vector is refused before it is stored, the queue
// treats that as final for the one item, and it is never used as a query.
//
// Run under Electron ABI (better-sqlite3):
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = (p) => pathToFileURL(path.resolve(root, 'dist-electron/electron/rag', p)).href;
const { describeUnusableVector, describeUnusableVectorBlob } = await import(dist('embeddingVectorHealth.js'));
const { VectorStore } = await import(dist('VectorStore.js'));
const { EmbeddingPipeline } = await import(dist('EmbeddingPipeline.js'));

const blob = (values) => Buffer.from(new Float32Array(values).buffer);
const GOOD = [0.5, -0.25, 0.1, 0.8];
const ZERO = [0, 0, 0, 0];
const NAN = [0.5, NaN, 0.1, 0.8];
const INF = [0.5, Infinity, 0.1, 0.8];
const SPACE = 'test:space:4';

describe('which vectors can be searched', () => {
  test('an ordinary vector can; zeros, NaN, infinity and empty cannot', () => {
    assert.equal(describeUnusableVector(GOOD), null);
    assert.equal(describeUnusableVector([0, 0, 1e-9, 0]), null, 'small is not zero');
    assert.match(describeUnusableVector(ZERO), /zero/);
    assert.match(describeUnusableVector(NAN), /value 1 is not a finite number/);
    assert.match(describeUnusableVector(INF), /not a finite number/);
    assert.match(describeUnusableVector([-Infinity]), /not a finite number/);
    assert.match(describeUnusableVector([]), /empty/);
    assert.match(describeUnusableVector(null), /empty/);
    assert.match(describeUnusableVector(['0.5', 1]), /not a finite number/);
  });

  test('the same for a vector as it is stored, whatever its byte alignment', () => {
    assert.equal(describeUnusableVectorBlob(blob(GOOD)), null);
    assert.match(describeUnusableVectorBlob(blob(ZERO)), /zero/);
    assert.match(describeUnusableVectorBlob(blob(NAN)), /not a finite number/);
    assert.match(describeUnusableVectorBlob(Buffer.alloc(0)), /empty/);
    assert.match(describeUnusableVectorBlob(Buffer.alloc(7)), /whole number of floats/);
    // A slice that starts on an odd byte, as a driver may hand one over.
    const padded = Buffer.concat([Buffer.from([9]), blob(GOOD)]);
    assert.equal(describeUnusableVectorBlob(padded.subarray(1)), null);
    const paddedBad = Buffer.concat([Buffer.from([9]), blob(NAN)]);
    assert.match(describeUnusableVectorBlob(paddedBad.subarray(1)), /not a finite number/);
  });
});

function schema(db) {
  db.exec(`
    CREATE TABLE meetings (id TEXT PRIMARY KEY, embedding_provider TEXT, embedding_dimensions INTEGER, embedding_space TEXT);
    CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, chunk_index INTEGER, speaker TEXT,
      start_timestamp_ms INTEGER, end_timestamp_ms INTEGER, cleaned_text TEXT, token_count INTEGER, embedding BLOB);
    CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT UNIQUE, summary_text TEXT, embedding BLOB);
    CREATE TABLE embedding_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, chunk_id INTEGER, status TEXT,
      retry_count INTEGER DEFAULT 0, error_message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, processed_at TEXT,
      UNIQUE(meeting_id, chunk_id));
  `);
}
const quiet = async (fn) => {
  const log = console.log, warn = console.warn, error = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

describe('the store', () => {
  let db, store, chunkId;
  beforeEach(async () => {
    db = new Database(':memory:');
    schema(db);
    store = await quiet(() => new VectorStore(db, ':memory:', '/nonexistent-ext'));   // no vec0 here: the BLOB path
    db.prepare(`INSERT INTO meetings (id, embedding_space) VALUES ('m1', ?)`).run(SPACE);
    chunkId = Number(db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count) VALUES ('m1', 0, 'Me', 1, 2, 'text', 1)`).run().lastInsertRowid);
    db.prepare(`INSERT INTO chunk_summaries (meeting_id, summary_text) VALUES ('m1', 'summary')`).run();
  });
  afterEach(() => db.close());
  const stored = () => db.prepare('SELECT embedding AS e FROM chunks WHERE id = ?').get(chunkId).e;
  const storedSummary = () => db.prepare(`SELECT embedding AS e FROM chunk_summaries WHERE meeting_id = 'm1'`).get().e;

  for (const [label, vector] of [['all zeros', ZERO], ['a NaN', NAN], ['an infinity', INF], ['nothing', []]]) {
    test(`refuses a chunk vector that is ${label}, and writes nothing`, () => {
      assert.throws(() => store.storeEmbedding(chunkId, vector), (e) => e.name === 'UnusableEmbeddingError' && e.unusableEmbedding === true);   // not instanceof: each compiled file carries its own copy of the class
      assert.equal(stored(), null);
    });
    test(`refuses a summary vector that is ${label}, and writes nothing`, () => {
      assert.throws(() => store.storeSummaryEmbedding('m1', vector), (e) => e.unusableEmbedding === true);
      assert.equal(storedSummary(), null);
    });
  }

  test('a vector that only becomes unusable as float32 is refused too', () => {
    // 1e-60 is not zero as a double and is zero in the four bytes that are stored;
    // 1e60 is finite as a double and infinity as float32.
    assert.throws(() => store.storeEmbedding(chunkId, [1e-60, 0, 0, 0]), (e) => e.unusableEmbedding === true && /zero/.test(e.message));
    assert.throws(() => store.storeEmbedding(chunkId, [1e60, 0.5, 0, 0]), (e) => e.unusableEmbedding === true && /finite/.test(e.message));
    assert.equal(stored(), null);
  });

  test('a usable vector is stored as before', () => {
    store.storeEmbedding(chunkId, GOOD);
    store.storeSummaryEmbedding('m1', GOOD);
    assert.deepEqual(Buffer.from(stored()), blob(GOOD));
    assert.deepEqual(Buffer.from(storedSummary()), blob(GOOD));
  });

  test('a refused vector does not replace the good one already stored', () => {
    store.storeEmbedding(chunkId, GOOD);
    assert.throws(() => store.storeEmbedding(chunkId, ZERO));
    assert.deepEqual(Buffer.from(stored()), blob(GOOD));
  });

  test('a query that points nowhere finds nothing, on either search', async () => {
    store.storeEmbedding(chunkId, GOOD);
    store.storeSummaryEmbedding('m1', GOOD);
    assert.equal((await store.searchSimilar(GOOD, { minSimilarity: 0, spaceKey: SPACE })).length, 1, 'precondition');
    // A stored vector with no direction has no score on the JS path either.
    db.prepare(`INSERT INTO meetings (id, embedding_space) VALUES ('m2', ?)`).run(SPACE);
    db.prepare(`INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('m2', 'bad', ?)`).run(blob(ZERO));
    assert.deepEqual((await store.searchSummaries(GOOD, 5, SPACE)).map(r => r.meetingId), ['m1']);
    for (const query of [ZERO, NAN, INF]) {
      assert.deepEqual(await quiet(() => store.searchSimilar(query, { minSimilarity: -1, spaceKey: SPACE })), []);
      assert.deepEqual(await quiet(() => store.searchSummaries(query, 5, SPACE)), []);
    }
  });

  test('stored vectors that cannot be searched are found and cleared, a page at a time', () => {
    const add = (index, vector) => Number(db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding) VALUES ('m1', ?, 'Me', 1, 2, 'text', 1, ?)`).run(index, blob(vector)).lastInsertRowid);
    const good = add(1, GOOD);
    const zero = add(2, ZERO);
    const nan = add(3, NAN);
    db.prepare(`INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('m1', ?, 'completed')`).run(zero);

    const first = store.clearUnusableStoredEmbeddings('chunks', 0, 2);            // the first chunk has no vector, so it is not read
    assert.equal(first.lastId, zero, 'two embedded rows read');
    assert.equal(first.cleared, 1);
    assert.deepEqual(first.meetingIds, ['m1']);
    const second = store.clearUnusableStoredEmbeddings('chunks', first.lastId, 2);
    assert.equal(second.cleared, 1);
    assert.equal(store.clearUnusableStoredEmbeddings('chunks', second.lastId, 2).lastId, null);

    const embedding = (id) => db.prepare('SELECT embedding AS e FROM chunks WHERE id = ?').get(id).e;
    assert.deepEqual(Buffer.from(embedding(good)), blob(GOOD), 'a good vector is left alone');
    assert.equal(embedding(zero), null);
    assert.equal(embedding(nan), null);
    // Cleared and queued in the same transaction: the old 'completed' row is
    // replaced by a pending one, so a crash cannot leave the chunk with neither.
    assert.deepEqual(db.prepare('SELECT status FROM embedding_queue WHERE chunk_id = ?').all(zero), [{ status: 'pending' }]);
    assert.deepEqual(db.prepare('SELECT status FROM embedding_queue WHERE chunk_id = ?').all(nan), [{ status: 'pending' }]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM embedding_queue WHERE chunk_id = ?').get(good).n, 0);
  });
});

describe('the queue', () => {
  let db, store, pipeline, fellBack;
  const provider = (answers) => ({
    name: 'fake', dimensions: 4, space: SPACE,
    async embed(text) { return answers[text]; },
  });
  beforeEach(async () => {
    db = new Database(':memory:');
    schema(db);
    store = await quiet(() => new VectorStore(db, ':memory:', '/nonexistent-ext'));
    pipeline = new EmbeddingPipeline(db, store);
    fellBack = false;
    pipeline.activateMeetingFallback = async () => { fellBack = true; };
    pipeline.fallbackProvider = { name: 'fallback', dimensions: 4, space: 'fallback:space:4', async embed() { return GOOD; } };
    db.prepare(`INSERT INTO meetings (id) VALUES ('m1')`).run();
    for (const [i, text] of ['bad text', 'good text'].entries()) {
      const id = db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count) VALUES ('m1', ?, 'Me', 1, 2, ?, 1)`).run(i, text).lastInsertRowid;
      db.prepare(`INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('m1', ?, 'pending')`).run(id);
    }
  });
  afterEach(() => db.close());

  test('an unusable vector is retried, then given up on for that one item; the meeting is never moved to the fallback', async () => {
    let calls = 0;
    const p = provider({ 'bad text': ZERO, 'good text': GOOD });
    const embed = p.embed.bind(p);
    p.embed = async (text) => { calls++; return embed(text); };
    pipeline.provider = p;
    pipeline.delay = async () => {};                      // the back-off between attempts

    await quiet(() => pipeline.processQueue());

    const rows = db.prepare(`SELECT c.cleaned_text AS text, q.status, q.retry_count AS retries, q.error_message AS error, c.embedding IS NOT NULL AS embedded
                             FROM embedding_queue q JOIN chunks c ON c.id = q.chunk_id ORDER BY c.chunk_index`).all();
    // Out of retries the way every exhausted item is: pending at the limit,
    // which the queue no longer selects and the status count reports as failed.
    assert.equal(rows[0].status, 'pending');
    assert.equal(rows[0].retries, 3);
    assert.match(rows[0].error, /cannot be searched \(every value is zero\)/);
    assert.equal(rows[0].embedded, 0);
    assert.equal(rows[1].status, 'completed');
    assert.equal(rows[1].embedded, 1);
    assert.equal(calls, 4, 'three attempts at the bad one, one at the good one');
    assert.equal(fellBack, false, 'one chunk the provider cannot embed is not an outage');
    assert.equal(pipeline.getQueueStatus().failed, 1);
    assert.equal(db.prepare(`SELECT embedding_space AS s FROM meetings WHERE id = 'm1'`).get().s, SPACE, 'the meeting is stamped by its good chunk');
  });

  test('a one-off bad vector is recovered by the retry', async () => {
    let badCalls = 0;
    pipeline.provider = { name: 'fake', dimensions: 4, space: SPACE, async embed(text) { return text === 'bad text' && badCalls++ === 0 ? NAN : GOOD; } };
    pipeline.delay = async () => {};
    await quiet(() => pipeline.processQueue());
    assert.deepEqual(db.prepare(`SELECT status FROM embedding_queue ORDER BY id`).all().map(r => r.status), ['completed', 'completed']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE embedding IS NOT NULL').get().n, 2);
    assert.equal(fellBack, false);
  });
});

describe('wiring', () => {
  const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
  test('the live indexer skips a refused vector instead of retrying the batch behind it', () => {
    const src = read('electron/rag/LiveRAGIndexer.ts');
    assert.match(src, /if \(!storeErr\?\.unusableEmbedding\) throw storeErr;/);
  });
  test('the one-time clean-up runs with the launch backfill', () => {
    const src = read('electron/rag/RAGManager.ts');
    assert.match(src, /await this\.requeueUnusableStoredVectors\(\);/);
    assert.match(src, /vector_health_scan_cursor_v1/);
  });
});
