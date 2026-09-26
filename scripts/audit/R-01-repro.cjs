#!/usr/bin/env node
/**
 * R-01 repro — F-705's deleteVectorsForMeeting() deletes NOTHING.
 *
 * `chunk_summaries` is keyed per-MEETING (id, meeting_id UNIQUE, summary_text,
 * embedding, created_at). It has no `chunk_id` column and no migration adds one.
 * The summary lookup in deleteVectorsForMeeting JOINs on `cs.chunk_id`, so
 * better-sqlite3 throws at prepare() time. That prepare sits OUTSIDE the
 * per-dim loop and INSIDE the single outer try, so the throw unwinds past the
 * per-dim catches into the outer catch, which only console.warn()s. The chunk
 * vector deletes are never reached and every vector is orphaned — silently.
 *
 * This harness extracts the summary-lookup SQL verbatim from the source file so
 * it can only pass once the source itself is correct, then executes the real
 * delete against a real sqlite-vec database and asserts zero orphans remain.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-01-repro.cjs
 * Expect BEFORE the fix: FAIL (prepare throws / orphans survive)
 * Expect AFTER  the fix: PASS
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const REPO = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO, 'electron', 'db', 'DatabaseManager.ts');

// --- 1. Pull the summary-lookup SQL straight out of the function under test ---
const src = fs.readFileSync(SRC, 'utf8');
const fnStart = src.indexOf('public deleteVectorsForMeeting(');
if (fnStart < 0) throw new Error('deleteVectorsForMeeting not found in source');
const fnBody = src.slice(fnStart, fnStart + 2200);
const sqlMatch = fnBody.match(/'(SELECT[^']*chunk_summaries[^']*)'/);
if (!sqlMatch) throw new Error('summary-lookup SQL not found in deleteVectorsForMeeting');
const SUMMARY_SQL = sqlMatch[1];
console.log('[R-01] summary lookup SQL under test:\n        ' + SUMMARY_SQL);

// --- 2. Real schema, real sqlite-vec, real rows ---
const db = new Database(':memory:');
db.loadExtension(sqliteVec.getLoadablePath());
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT);
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL,
    content TEXT,
    embedding BLOB,
    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
  );
  CREATE TABLE chunk_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL UNIQUE,
    summary_text TEXT NOT NULL,
    embedding BLOB,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
  );
  CREATE VIRTUAL TABLE vec_chunks_768 USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[3] distance_metric=cosine);
  CREATE VIRTUAL TABLE vec_summaries_768 USING vec0(summary_id INTEGER PRIMARY KEY, embedding float[3] distance_metric=cosine);
`);

const vec = (a) => { const b = Buffer.alloc(12); a.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };

db.prepare('INSERT INTO meetings (id, title) VALUES (?,?)').run('m1', 'target');
db.prepare('INSERT INTO meetings (id, title) VALUES (?,?)').run('m2', 'bystander');
for (const [mid, n] of [['m1', 3], ['m2', 2]]) {
  for (let i = 0; i < n; i++) {
    const info = db.prepare('INSERT INTO chunks (meeting_id, content, embedding) VALUES (?,?,?)')
      .run(mid, `text ${i}`, vec([1, 0, 0]));
    db.prepare('INSERT INTO vec_chunks_768(chunk_id, embedding) VALUES (?,?)')
      .run(BigInt(info.lastInsertRowid), vec([1, 0, 0]));
  }
  const s = db.prepare('INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES (?,?,?)')
    .run(mid, `summary of ${mid}`, vec([0, 1, 0]));
  db.prepare('INSERT INTO vec_summaries_768(summary_id, embedding) VALUES (?,?)')
    .run(BigInt(s.lastInsertRowid), vec([0, 1, 0]));
}

const count = (t) => db.prepare(`SELECT count(*) c FROM ${t}`).get().c;
console.log(`[R-01] seeded: vec_chunks=${count('vec_chunks_768')} vec_summaries=${count('vec_summaries_768')}`);

// --- 3. Replay deleteVectorsForMeeting's control flow faithfully ---
let warned = null;
try {
  const chunkIds = db.prepare('SELECT id FROM chunks WHERE meeting_id = ?').all('m1');
  const summaryIds = db.prepare(SUMMARY_SQL).all('m1');   // <-- throws pre-fix
  for (const dim of [768]) {
    if (chunkIds.length) {
      const ph = chunkIds.map(() => '?').join(',');
      try { db.prepare(`DELETE FROM vec_chunks_${dim} WHERE chunk_id IN (${ph})`).run(...chunkIds.map(r => r.id)); } catch (_) {}
    }
    if (summaryIds.length) {
      const ph = summaryIds.map(() => '?').join(',');
      try { db.prepare(`DELETE FROM vec_summaries_${dim} WHERE summary_id IN (${ph})`).run(...summaryIds.map(r => r.id)); } catch (_) {}
    }
  }
} catch (e) {
  warned = e.message;                       // the real code only console.warn()s here
  console.log(`[R-01] deleteVectorsForMeeting failed (non-fatal): ${e.message}`);
}

// --- 4. Parent delete (FK cascade clears chunks; virtual tables never cascade) ---
db.prepare('DELETE FROM meetings WHERE id = ?').run('m1');

const orphanChunks = db.prepare(
  'SELECT count(*) c FROM vec_chunks_768 WHERE chunk_id NOT IN (SELECT id FROM chunks)').get().c;
const orphanSummaries = db.prepare(
  'SELECT count(*) c FROM vec_summaries_768 WHERE summary_id NOT IN (SELECT id FROM chunk_summaries)').get().c;
const survivingM2Chunks = db.prepare(
  "SELECT count(*) c FROM vec_chunks_768 WHERE chunk_id IN (SELECT id FROM chunks WHERE meeting_id='m2')").get().c;
const survivingM2Summaries = db.prepare(
  "SELECT count(*) c FROM vec_summaries_768 WHERE summary_id IN (SELECT id FROM chunk_summaries WHERE meeting_id='m2')").get().c;

console.log(`[R-01] ORPHANED vec_chunks_768    : ${orphanChunks} (expected 0)`);
console.log(`[R-01] ORPHANED vec_summaries_768 : ${orphanSummaries} (expected 0)`);
console.log(`[R-01] bystander m2 chunks kept   : ${survivingM2Chunks} (expected 2)`);
console.log(`[R-01] bystander m2 summaries kept: ${survivingM2Summaries} (expected 1)`);

const ok = !warned && orphanChunks === 0 && orphanSummaries === 0
  && survivingM2Chunks === 2 && survivingM2Summaries === 1;
if (!ok) {
  console.error('[R-01] FAIL: vectors for the deleted meeting were orphaned'
    + (warned ? ` (lookup threw: ${warned})` : '') + ', or a bystander meeting was damaged.');
  process.exit(1);
}
console.log('[R-01] PASS: the deleted meeting\'s vectors were reaped and m2 was untouched.');
