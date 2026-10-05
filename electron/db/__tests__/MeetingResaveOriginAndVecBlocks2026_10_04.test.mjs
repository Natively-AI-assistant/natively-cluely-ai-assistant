// Three faults found on a copy of a live database, 2026-10-04. All three are
// behavioural tests against a real SQLite file.
//
// 1. saveMeeting used INSERT OR REPLACE. REPLACE deletes the existing row, and
//    with foreign_keys ON that cascades: every re-save of a meeting (the normal
//    placeholder -> final flow) deleted the chunks search had just indexed.
// 2. The saved transcript had no record of where a line came from, so typed
//    chat and the assistant's answers were re-read as meeting speech.
// 3. vec0 tables were created with the default 1,024-vector block (12.6 MB at
//    3,072 dimensions for a single vector), and the rebuild that re-creates
//    them inserted from inside an iterate() loop — which better-sqlite3
//    rejects — swallowing the error and leaving the index empty.
//
// Run under `ELECTRON_RUN_AS_NODE=1 electron --test` (native ABI).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');

let dbMgr;
let tmp;

function open() {
  process.env.NATIVELY_TEST_USERDATA = tmp;
  try { delete require.cache[DB_PATH]; } catch {}
  dbMgr = require(DB_PATH).DatabaseManager.getInstance();
  return dbMgr;
}
function close() {
  try { dbMgr?.close?.(); } catch {}
  try { delete require.cache[DB_PATH]; } catch {}
}

const meeting = (over = {}) => ({
  id: 'm1', title: 'Processing...', date: '2026-10-04T10:00:00.000Z', duration: '0:05', summary: '',
  detailedSummary: { actionItems: [], keyPoints: [] },
  transcript: [{ speaker: 'user', text: 'we agreed to ship on friday', timestamp: 1000, origin: 'stt' }],
  usage: [], isProcessed: false, ...over,
});

describe('saved meetings (2026-10-04)', () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resave-origin-vec-')); open(); });
  afterEach(() => { close(); delete process.env.NATIVELY_TEST_USERDATA; try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('re-saving a meeting keeps the chunks and summary indexed in between', () => {
    if (!dbMgr.isAvailable()) return; // native binding not loadable in this env
    const db = dbMgr.getDb();
    dbMgr.saveMeeting(meeting(), 1000, 5000);
    db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, cleaned_text, token_count) VALUES ('m1', 0, 'we agreed to ship on friday', 6)`).run();
    db.prepare(`INSERT INTO chunk_summaries (meeting_id, summary_text) VALUES ('m1', 'ship friday')`).run();
    db.prepare(`UPDATE meetings SET embedding_provider = 'gemini', embedding_space = 'gemini:x:3072' WHERE id = 'm1'`).run();

    dbMgr.saveMeeting(meeting({ title: 'Ship date', isProcessed: true, summaryStatus: 'completed' }), 1000, 5000);

    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE meeting_id = 'm1'`).get().n;
    assert.equal(count('chunks'), 1, 'the final save must not delete the indexed chunks');
    assert.equal(count('chunk_summaries'), 1, 'nor the searchable summary');
    assert.equal(count('transcripts'), 1, 'the transcript is rewritten, not duplicated');
    const row = db.prepare(`SELECT title, is_processed, summary_status, embedding_provider, embedding_space FROM meetings WHERE id = 'm1'`).get();
    assert.deepEqual(row, { title: 'Ship date', is_processed: 1, summary_status: 'completed', embedding_provider: 'gemini', embedding_space: 'gemini:x:3072' });
  });

  test('deleting a meeting still cascades to its chunks', () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();
    dbMgr.saveMeeting(meeting(), 1000, 5000);
    db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, cleaned_text, token_count) VALUES ('m1', 0, 'x y z', 3)`).run();
    db.prepare(`DELETE FROM meetings WHERE id = 'm1'`).run();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM chunks WHERE meeting_id = 'm1'`).get().n, 0);
  });

  test("each line's origin is saved and read back; an unknown value is stored as NULL", () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();
    dbMgr.saveMeeting(meeting({ transcript: [
      { speaker: 'user', text: 'spoken', timestamp: 1, origin: 'stt' },
      { speaker: 'user', text: 'typed', timestamp: 2, origin: 'manual_chat' },
      { speaker: 'assistant', text: 'reply', timestamp: 3, origin: 'assistant', chatReply: true },
      { speaker: 'assistant', text: 'suggestion', timestamp: 4, origin: 'assistant' },
      { speaker: 'user', text: 'legacy', timestamp: 5 },
      { speaker: 'user', text: 'bogus', timestamp: 6, origin: 'made-up' },
    ] }), 1000, 5000);
    assert.deepEqual(
      db.prepare(`SELECT origin FROM transcripts WHERE meeting_id = 'm1' ORDER BY timestamp_ms`).all().map(r => r.origin),
      ['stt', 'manual_chat', 'assistant_chat', 'assistant', null, null],
    );
    assert.deepEqual(
      dbMgr.getMeetingDetails('m1').transcript.map(t => [t.text, t.origin ?? null, t.chatReply ?? null]),
      [['spoken', 'stt', null], ['typed', 'manual_chat', null], ['reply', 'assistant', true], ['suggestion', 'assistant', null], ['legacy', null, null], ['bogus', null, null]],
    );
  });

  test('a row written before the column existed reads back with no origin', () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();
    dbMgr.saveMeeting(meeting({ transcript: [] }), 1000, 5000);
    db.prepare(`INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms) VALUES ('m1', 'user', 'old line', 7)`).run();
    assert.deepEqual(dbMgr.getMeetingDetails('m1').transcript.map(t => 'origin' in t), [false]);
  });
});

describe('vec0 block size (2026-10-04)', () => {
  const DIM = 16; // small, so the test file stays small; the rule is per table, not per size
  const vec = (seed) => Buffer.from(new Float32Array(Array.from({ length: DIM }, (_, i) => Math.sin(seed + i))).buffer);

  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resave-origin-vec-')); open(); });
  afterEach(() => { close(); delete process.env.NATIVELY_TEST_USERDATA; try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

  const hasVec = () => {
    try { dbMgr.getDb().prepare(`SELECT vec_version()`).get(); return true; } catch { return false; }
  };
  const ddl = (name) => dbMgr.getDb().prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(name)?.sql || '';
  const SETTLED_KEY = 'vec_block_shrink_settled_v1';
  const settled = () => dbMgr.getDb().prepare(`SELECT value FROM app_state WHERE key = ?`).get(SETTLED_KEY)?.value === '1';
  // The fresh database opened in beforeEach has nothing stale, so it is already
  // marked settled. An install from before this build carries no such mark.
  const asOldInstall = () => dbMgr.getDb().prepare(`DELETE FROM app_state WHERE key = ?`).run(SETTLED_KEY);
  // Default-block tables for DIM with `chunks` chunk vectors and one summary vector.
  const seedOldTables = (chunks) => {
    const db = dbMgr.getDb();
    db.exec(`CREATE VIRTUAL TABLE vec_chunks_${DIM} USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${DIM}] distance_metric=cosine)`);
    db.exec(`CREATE VIRTUAL TABLE vec_summaries_${DIM} USING vec0(summary_id INTEGER PRIMARY KEY, embedding float[${DIM}] distance_metric=cosine)`);
    db.prepare(`INSERT INTO meetings (id, title, start_time, duration_ms) VALUES ('m1', 't', 1, 1)`).run();
    const insChunk = db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, cleaned_text, token_count, embedding) VALUES ('m1', ?, 'text', 1, ?)`);
    const insVec = db.prepare(`INSERT INTO vec_chunks_${DIM}(chunk_id, embedding) VALUES (?, ?)`);
    for (let i = 0; i < chunks; i++) insVec.run(BigInt(insChunk.run(i, vec(i)).lastInsertRowid), vec(i));
    const sumId = db.prepare(`INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('m1', 's', ?)`).run(vec(9)).lastInsertRowid;
    db.prepare(`INSERT INTO vec_summaries_${DIM}(summary_id, embedding) VALUES (?, ?)`).run(BigInt(sumId), vec(9));
    asOldInstall();
  };
  // `open()` drops the module from the require cache, so the budget has to be
  // set on the class that the NEXT open will construct from.
  const reopenWithBudget = (bytes) => {
    close();
    process.env.NATIVELY_TEST_USERDATA = tmp;
    const cls = require(DB_PATH).DatabaseManager;
    cls.vecRebuildBudgetBytes = bytes;
    dbMgr = cls.getInstance();
  };

  test('a new table is created with 64-vector blocks', () => {
    if (!dbMgr.isAvailable() || !hasVec()) return;
    dbMgr.ensureVecTableForDim(DIM);
    assert.match(ddl(`vec_chunks_${DIM}`), /chunk_size\s*=\s*64/);
    assert.match(ddl(`vec_summaries_${DIM}`), /chunk_size\s*=\s*64/);
    assert.match(ddl(`vec_chunks_${DIM}`), /distance_metric=cosine/, 'the cosine metric must survive the DDL change');
  });

  test('a table created with the default block size is rebuilt on the next launch, with its vectors', () => {
    if (!dbMgr.isAvailable() || !hasVec()) return;
    let db = dbMgr.getDb();
    // An old-shape install: default block size, vectors in both the BLOB column and the vec0 table.
    db.exec(`CREATE VIRTUAL TABLE vec_chunks_${DIM} USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${DIM}] distance_metric=cosine)`);
    db.exec(`CREATE VIRTUAL TABLE vec_summaries_${DIM} USING vec0(summary_id INTEGER PRIMARY KEY, embedding float[${DIM}] distance_metric=cosine)`);
    db.prepare(`INSERT INTO meetings (id, title, start_time, duration_ms) VALUES ('m1', 't', 1, 1)`).run();
    const insChunk = db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, cleaned_text, token_count, embedding) VALUES ('m1', ?, 'text', 1, ?)`);
    for (let i = 0; i < 5; i++) {
      const id = insChunk.run(i, vec(i)).lastInsertRowid;
      db.prepare(`INSERT INTO vec_chunks_${DIM}(chunk_id, embedding) VALUES (?, ?)`).run(BigInt(id), vec(i));
    }
    const sumId = db.prepare(`INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('m1', 's', ?)`).run(vec(9)).lastInsertRowid;
    db.prepare(`INSERT INTO vec_summaries_${DIM}(summary_id, embedding) VALUES (?, ?)`).run(BigInt(sumId), vec(9));
    // An orphan: a vector whose chunk row is gone (what the cascading re-save left behind).
    db.prepare(`INSERT INTO vec_chunks_${DIM}(chunk_id, embedding) VALUES (?, ?)`).run(999n, vec(42));
    const knn = () => dbMgr.getDb().prepare(`SELECT chunk_id FROM vec_chunks_${DIM} WHERE embedding MATCH ? AND k = 3`).all(vec(2)).map(r => Number(r.chunk_id));
    const before = knn();
    asOldInstall();

    close(); open(); db = dbMgr.getDb();          // next launch

    assert.match(ddl(`vec_chunks_${DIM}`), /chunk_size\s*=\s*64/, 'the stale table must be rebuilt');
    assert.match(ddl(`vec_summaries_${DIM}`), /chunk_size\s*=\s*64/);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM vec_chunks_${DIM}`).get().n, 5, 'every stored vector is re-inserted (and the orphan is gone)');
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM vec_summaries_${DIM}`).get().n, 1);
    assert.deepEqual(knn(), before, 'search returns the same nearest chunks after the rebuild');

    close(); open();                               // and the launch after that changes nothing
    assert.equal(dbMgr.getDb().prepare(`SELECT COUNT(*) AS n FROM vec_chunks_${DIM}`).get().n, 5);
  });

  // The rebuild is synchronous and runs before the first window, so what one
  // launch copies is capped (2026-10-05). DIM 16 = 64 bytes a vector.
  //
  // Measured on an M-series laptop under load, 3,072-dimension vectors, whole
  // database open including the rebuild and the file rewrite, three runs each:
  //       3 vectors            30-50 ms   (24.5 MB file -> 2.0 MB)
  //     600 vectors (7 MB)   170-350 ms   (31.8 MB -> 16.1 MB)
  //   1,360 vectors (16 MB)  345-420 ms   (53.1 MB -> 34.4 MB)   <- the budget
  //   1,400 vectors            7-13 ms    left as it is (complete and exact)
  //  12,000 vectors (141 MB)    10 ms     left as it is (complete and exact)
  // A large table that is WRONG (old metric, missing or left-over vectors) is
  // not left: see VecRebuildBoundedAndDeferred2026_10_05.test.mjs.
  // and 1-4 ms on every later launch. Before the cap the 12,000-vector case
  // copied all 141 MB before the first window.
  // Worst seen: one earlier run, straight after a build on a busier machine,
  // took 1,822 ms at 600 vectors and 3,229 ms at 1,360. The cap bounds the
  // work, not the disk it waits on.
  test('a fresh database is marked settled and is not checked again', () => {
    if (!dbMgr.isAvailable() || !hasVec()) return;
    assert.equal(settled(), true);
  });

  test('a table holding more than the budget is left as it is; the small one beside it is rebuilt', () => {
    if (!dbMgr.isAvailable() || !hasVec()) return;
    seedOldTables(10);                              // 640 bytes of chunk vectors, 64 of summary
    reopenWithBudget(200);

    assert.doesNotMatch(ddl(`vec_chunks_${DIM}`), /chunk_size/, 'the large table keeps its default blocks');
    assert.match(ddl(`vec_summaries_${DIM}`), /chunk_size\s*=\s*64/, 'the small table is rebuilt');
    const db = dbMgr.getDb();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM vec_chunks_${DIM}`).get().n, 10, 'the large table keeps every vector');
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM vec_summaries_${DIM}`).get().n, 1);
    assert.equal(settled(), true, 'nothing is left waiting, so the check ends');

    // New vectors still go into the table that was left alone.
    dbMgr.ensureVecTableForDim(DIM);
    db.prepare(`INSERT INTO vec_chunks_${DIM}(chunk_id, embedding) VALUES (?, ?)`).run(5000n, vec(77));
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM vec_chunks_${DIM}`).get().n, 11);
  });

  test('tables that fit but exceed the budget together are spread over launches, smallest first', () => {
    if (!dbMgr.isAvailable() || !hasVec()) return;
    seedOldTables(3);                               // 192 bytes of chunk vectors, 64 of summary
    reopenWithBudget(200);                          // each fits alone; together 256 > 200

    assert.match(ddl(`vec_summaries_${DIM}`), /chunk_size\s*=\s*64/, 'the smaller table goes first');
    assert.doesNotMatch(ddl(`vec_chunks_${DIM}`), /chunk_size/, 'the other waits for the next launch');
    assert.equal(settled(), false, 'a table is still waiting');

    reopenWithBudget(200);
    assert.match(ddl(`vec_chunks_${DIM}`), /chunk_size\s*=\s*64/);
    assert.equal(dbMgr.getDb().prepare(`SELECT COUNT(*) AS n FROM vec_chunks_${DIM}`).get().n, 3);
    assert.equal(settled(), true);
  });

  test('the re-insert loop does not read with an open iterator', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/db/DatabaseManager.ts'), 'utf8');
    const start = src.indexOf('private reinsertVectorsFromBlobs(');
    assert.notEqual(start, -1);
    const body = src.slice(start, start + 2200);
    assert.ok(body.includes('page.all('), 'rows are read in pages');
    assert.ok(!/\.iterate\(/.test(body), 'better-sqlite3 rejects any other statement while an iterator is open');
    assert.ok(!/SELECT id, embedding FROM chunks[^`]*`\s*\)\.iterate/.test(src), 'the v30 rebuild must use the same helper');
  });
});
