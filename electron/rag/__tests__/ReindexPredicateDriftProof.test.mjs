// electron/rag/__tests__/ReindexPredicateDriftProof.test.mjs
//
// DRIFT-PROOFING for VectorStore.REINDEX_PREDICATE (round-5 change #4).
//
// The trigger (getIncompatibleSpaceCount) and the worklist (getMeetingIdsNeedingReindex)
// are documented to share ONE static SQL body so they can NEVER diverge. If they ever
// disagreed, the count would say "N to reindex" while a DIFFERENT set actually got
// requeued — silent under-/over-indexing.
//
// Every other test in this suite that touches these two methods either STUBS them
// (ReindexGuard) or re-implements the predicate as a VERBATIM COPY (EmbeddingSpaceMigration,
// SearchSpaceFilter). NONE drive the REAL compiled VectorStore methods together and
// assert count === worklist.length. So if someone edited the real REINDEX_PREDICATE such
// that the two helpers no longer agreed (e.g. accidentally inlined a different body into
// one of them, or changed the parameter binding), no existing test would fail.
//
// This test exercises the REAL compiled VectorStore.getIncompatibleSpaceCount and
// .getMeetingIdsNeedingReindex against many randomized + hand-picked DB shapes and asserts:
//   getIncompatibleSpaceCount(active) === getMeetingIdsNeedingReindex(active).length
// for EVERY shape. Edit the predicate so the two disagree → this test fails.
//
// Run under Electron ABI:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vsPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/VectorStore.js');
const { VectorStore } = await import(pathToFileURL(vsPath).href);

const SPACE_V1 = 'gemini:gemini-embedding-001:768';
const SPACE_V2 = 'gemini:gemini-embedding-2:768';
const SPACE_OPENAI = 'openai:text-embedding-3-small:1536';

function makeSchema(db) {
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_processed INTEGER DEFAULT 1,
      embedding_provider TEXT,
      embedding_dimensions INTEGER,
      embedding_space TEXT
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      cleaned_text TEXT,
      embedding BLOB
    );
    CREATE TABLE chunk_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      summary_text TEXT,
      embedding BLOB
    );
  `);
}

const blob = () => Buffer.alloc(768 * 4);

// Seed one meeting with a precise shape.
//  space:          embedding_space value (string | null)
//  isProcessed:    is_processed flag (0/1)
//  chunkEmbedded:  number of chunks WITH a non-null embedding
//  chunkBare:      number of chunks with NULL embedding
//  summaryEmbedded:whether a summary row with non-null embedding exists
//  summaryBare:    whether a summary row with NULL embedding exists
let seq = 0;
function seedMeeting(db, { space = null, isProcessed = 1, chunkEmbedded = 0, chunkBare = 0, summaryEmbedded = false, summaryBare = false } = {}) {
  const id = `m${seq++}`;
  db.prepare('INSERT INTO meetings (id, is_processed, embedding_space) VALUES (?,?,?)').run(id, isProcessed, space);
  for (let i = 0; i < chunkEmbedded; i++) db.prepare('INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES (?,?,?)').run(id, `c${i}`, blob());
  for (let i = 0; i < chunkBare; i++) db.prepare('INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES (?,?,NULL)').run(id, `b${i}`);
  if (summaryEmbedded) db.prepare('INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES (?,?,?)').run(id, 'sum', blob());
  if (summaryBare) db.prepare('INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES (?,?,NULL)').run(id, 'sum');
  return id;
}

describe('VectorStore REINDEX_PREDICATE drift-proof (real compiled methods)', () => {
  let db, vs;
  beforeEach(() => {
    db = new Database(':memory:');
    makeSchema(db);
    vs = new VectorStore(db, ':memory:', '/nonexistent-ext'); // useNativeVec=false → pure SQL
  });
  afterEach(() => db.close());

  // The core invariant, checked against many shapes.
  function assertAgreement(active, ctx) {
    const count = vs.getIncompatibleSpaceCount(active);
    const ids = vs.getMeetingIdsNeedingReindex(active);
    assert.equal(
      count, ids.length,
      `DRIFT: getIncompatibleSpaceCount=${count} but getMeetingIdsNeedingReindex.length=${ids.length} [${ctx}]`,
    );
    // Worklist must contain no duplicates (would also make count != length meaningfully wrong).
    assert.equal(new Set(ids).size, ids.length, `worklist has duplicates [${ctx}]`);
    return { count, ids };
  }

  test('hand-picked matrix of every documented row population', () => {
    // KNOWN-INCOMPATIBLE: space set, != active
    seedMeeting(db, { space: SPACE_V1, chunkEmbedded: 2, summaryEmbedded: true });        // qualifies
    seedMeeting(db, { space: SPACE_OPENAI, chunkEmbedded: 1 });                            // qualifies (diff dims space)
    // COMPATIBLE: space == active → never reindex
    seedMeeting(db, { space: SPACE_V2, chunkEmbedded: 3, summaryEmbedded: true });         // excluded
    // UNKNOWN-SPACE-WITH-EMBEDDINGS: NULL space + has embedded chunk → qualifies
    seedMeeting(db, { space: null, chunkEmbedded: 2 });                                    // qualifies
    // UNKNOWN-SPACE-WITH-EMBEDDINGS via SUMMARY only (no chunks) → qualifies (the OR arm)
    seedMeeting(db, { space: null, summaryEmbedded: true });                               // qualifies
    // NULL space, only BARE chunks (no embedding) → NOT a candidate (nothing to trust/distrust)
    seedMeeting(db, { space: null, chunkBare: 4 });                                        // excluded
    // NULL space, only BARE summary → excluded
    seedMeeting(db, { space: null, summaryBare: true });                                   // excluded
    // NULL space, nothing at all → excluded
    seedMeeting(db, { space: null });                                                      // excluded
    // is_processed = 0 but otherwise-qualifying (incompatible space w/ embeddings) → EXCLUDED by the is_processed=1 arm
    seedMeeting(db, { space: SPACE_V1, isProcessed: 0, chunkEmbedded: 2 });                // excluded
    // is_processed = 0, NULL space w/ embeddings → excluded
    seedMeeting(db, { space: null, isProcessed: 0, chunkEmbedded: 1 });                    // excluded

    const { count, ids } = assertAgreement(SPACE_V2, 'hand-picked matrix');
    // Sanity: the four qualifying rows are exactly the ones counted.
    assert.equal(count, 4, `expected 4 qualifying meetings, got ${count} (ids: ${ids.join(',')})`);
  });

  test('agreement holds when ACTIVE space itself is the legacy / openai / unknown one', () => {
    seedMeeting(db, { space: SPACE_V1, chunkEmbedded: 1 });
    seedMeeting(db, { space: SPACE_V2, chunkEmbedded: 1 });
    seedMeeting(db, { space: SPACE_OPENAI, chunkEmbedded: 1 });
    seedMeeting(db, { space: null, chunkEmbedded: 1 });
    for (const active of [SPACE_V1, SPACE_V2, SPACE_OPENAI, 'something:never:seen:0']) {
      assertAgreement(active, `active=${active}`);
    }
  });

  test('agreement holds on an empty DB and a single-row DB', () => {
    assertAgreement(SPACE_V2, 'empty');
    assert.equal(vs.getIncompatibleSpaceCount(SPACE_V2), 0, 'empty DB → 0');
    seedMeeting(db, { space: SPACE_V1, chunkEmbedded: 1 });
    const { count } = assertAgreement(SPACE_V2, 'single row');
    assert.equal(count, 1);
  });

  test('randomized fuzz: 60 DBs of mixed shapes all agree', () => {
    const spaces = [SPACE_V1, SPACE_V2, SPACE_OPENAI, null];
    const rnd = (n) => Math.floor(Math.random() * n);
    for (let iter = 0; iter < 60; iter++) {
      const fdb = new Database(':memory:');
      makeSchema(fdb);
      const fvs = new VectorStore(fdb, ':memory:', '/nonexistent-ext');
      const rows = rnd(12);
      seq = 0;
      for (let r = 0; r < rows; r++) {
        seedMeeting(fdb, {
          space: spaces[rnd(spaces.length)],
          isProcessed: rnd(2),
          chunkEmbedded: rnd(3),
          chunkBare: rnd(3),
          summaryEmbedded: rnd(2) === 1,
          summaryBare: rnd(2) === 1,
        });
      }
      const active = spaces[rnd(3)]; // never null (active space is always defined)
      const count = fvs.getIncompatibleSpaceCount(active);
      const ids = fvs.getMeetingIdsNeedingReindex(active);
      assert.equal(count, ids.length, `DRIFT on fuzz iter ${iter}: count=${count} length=${ids.length} active=${active}`);
      assert.equal(new Set(ids).size, ids.length, `dup ids on fuzz iter ${iter}`);
      fdb.close();
    }
  });

  test('worklist is the EXACT set the count promises (not just same cardinality)', () => {
    // Stronger than count===length: prove the IDs are the qualifying ones and ordered.
    seq = 0;
    const a = seedMeeting(db, { space: SPACE_V1, chunkEmbedded: 1 });      // qualifies
    const b = seedMeeting(db, { space: SPACE_V2, chunkEmbedded: 1 });      // excluded (active)
    const c = seedMeeting(db, { space: null, summaryEmbedded: true });    // qualifies
    const ids = vs.getMeetingIdsNeedingReindex(SPACE_V2);
    assert.deepEqual([...ids].sort(), [a, c].sort(), 'worklist must be exactly {incompatible, unknown-with-embeddings}');
    assert.ok(!ids.includes(b), 'active-space meeting must never appear in the worklist');
    assert.equal(vs.getIncompatibleSpaceCount(SPACE_V2), ids.length);
  });
});
