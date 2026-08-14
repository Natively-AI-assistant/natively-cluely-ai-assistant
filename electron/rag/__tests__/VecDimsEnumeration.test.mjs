// electron/rag/__tests__/VecDimsEnumeration.test.mjs
//
// Mandate #3: getExistingVecDims() must enumerate EVERY vec_chunks_<N> table that
// actually exists on disk and UNION it with the static KNOWN_DIMS [768,1536,3072],
// so the delete/clear loops in VectorStore (clearEmbeddingsForMeeting,
// deleteEmbeddingsForSpace, deleteChunksForMeeting) cover runtime-provisioned dims
// (e.g. a future 1024d model) and never orphan vec0 rows.
//
// We invoke the REAL compiled DatabaseManager.getExistingVecDims() via Object.create
// (its body only touches this.db + the static KNOWN_DIMS — no electron app needed).
// Because the sqlite-vec extension can't be loaded in this test env, we stand in PLAIN
// tables named `vec_chunks_<N>`; getExistingVecDims reads sqlite_master with a LIKE +
// regex, so it does not care whether they are real vec0 virtual tables — only the NAME.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dmPath = path.resolve(__dirname, '../../../dist-electron/electron/db/DatabaseManager.js');
const { DatabaseManager } = await import(pathToFileURL(dmPath).href);

function makeDM(db) {
  const dm = Object.create(DatabaseManager.prototype);
  dm.db = db;
  dm.ensuredDims = new Set();
  return dm;
}

describe('getExistingVecDims — enumeration + union (real compiled method)', () => {
  let db, dm;

  beforeEach(() => {
    db = new Database(':memory:');
    dm = makeDM(db);
  });

  afterEach(() => db.close());

  test('with NO vec tables, returns exactly KNOWN_DIMS', () => {
    const dims = dm.getExistingVecDims().sort((a, b) => a - b);
    assert.deepEqual(dims, [768, 1536, 3072]);
  });

  test('novel dims 1024 and 999 are enumerated and UNIONed with KNOWN_DIMS', () => {
    db.exec('CREATE TABLE vec_chunks_1024 (chunk_id INTEGER PRIMARY KEY, embedding BLOB)');
    db.exec('CREATE TABLE vec_chunks_999 (chunk_id INTEGER PRIMARY KEY, embedding BLOB)');
    const dims = dm.getExistingVecDims().sort((a, b) => a - b);
    assert.deepEqual(dims, [768, 999, 1024, 1536, 3072]);
  });

  test('a duplicate of a KNOWN dim (vec_chunks_768) does not produce a duplicate entry (Set dedupes)', () => {
    db.exec('CREATE TABLE vec_chunks_768 (chunk_id INTEGER PRIMARY KEY, embedding BLOB)');
    const dims = dm.getExistingVecDims();
    assert.equal(dims.filter(d => d === 768).length, 1, '768 must appear exactly once');
  });

  test('malformed table name vec_chunks_abc is IGNORED (regex requires \\d+)', () => {
    db.exec('CREATE TABLE vec_chunks_abc (x INTEGER)');
    const dims = dm.getExistingVecDims().sort((a, b) => a - b);
    assert.deepEqual(dims, [768, 1536, 3072], 'non-numeric suffix must not be enumerated');
  });

  test('vec_chunks_1024_extra (trailing junk) is IGNORED (regex is anchored ^...$)', () => {
    db.exec('CREATE TABLE vec_chunks_1024_extra (x INTEGER)');
    const dims = dm.getExistingVecDims().sort((a, b) => a - b);
    assert.deepEqual(dims, [768, 1536, 3072], 'anchored regex must reject trailing-suffix names');
  });

  test('vec_summaries_<N> tables are NOT counted (LIKE filters on vec_chunks_ only)', () => {
    db.exec('CREATE TABLE vec_summaries_2048 (summary_id INTEGER PRIMARY KEY, embedding BLOB)');
    const dims = dm.getExistingVecDims().sort((a, b) => a - b);
    assert.deepEqual(dims, [768, 1536, 3072], 'only vec_chunks_ tables drive dim enumeration');
  });

  test('the enumerated dims are exactly what the delete/clear loops will iterate (coverage proof)', () => {
    // This is the behavioral guarantee: a clear loop does
    //   for (const dim of getExistingVecDims()) DELETE FROM vec_chunks_${dim} ...
    // so a 1024d vec0 row provisioned at runtime IS reachable for deletion.
    db.exec('CREATE TABLE vec_chunks_1024 (chunk_id INTEGER PRIMARY KEY, embedding BLOB)');
    db.exec("INSERT INTO vec_chunks_1024 (chunk_id, embedding) VALUES (1, x'00')");
    const dims = dm.getExistingVecDims();
    assert.ok(dims.includes(1024), '1024 must be in the delete worklist');

    // Simulate the exact clear-loop the VectorStore runs and confirm it reaches 1024.
    let deletedFrom = [];
    for (const dim of dims) {
      try {
        const info = db.prepare(`DELETE FROM vec_chunks_${dim} WHERE chunk_id IN (1)`).run();
        if (info.changes > 0) deletedFrom.push(dim);
      } catch { /* table for that dim doesn't exist — exactly what the real loop swallows */ }
    }
    assert.deepEqual(deletedFrom, [1024], 'the runtime 1024d row was actually deleted by the loop');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM vec_chunks_1024').get().c, 0);
  });

  test('getExistingVecDims tolerates a closed/broken db handle (falls back to KNOWN_DIMS, never throws)', () => {
    const closedDb = new Database(':memory:');
    const dm2 = makeDM(closedDb);
    closedDb.close();
    // The method has a try/catch that falls back to KNOWN_DIMS on query failure.
    const dims = dm2.getExistingVecDims().sort((a, b) => a - b);
    assert.deepEqual(dims, [768, 1536, 3072], 'must degrade to KNOWN_DIMS, not throw');
  });
});
