// F-705 repro: vec0 index rows survive a meeting delete.
//
// deleteMeeting()/clearAllData() rely entirely on ON DELETE CASCADE, but
// `vec_chunks_*` / `vec_summaries_*` are USING vec0 VIRTUAL tables, and SQLite
// virtual tables carry no foreign keys — a cascade can never reach them.
// VectorStore's own delete paths already issue explicit DELETEs for exactly
// this reason, but neither DatabaseManager path calls into it. Orphaned
// vectors then consume slots in the KNN top-K (searchSimilarNative silently
// drops ids it cannot resolve back to `chunks`), so recall degrades
// monotonically with every meeting the user deletes.
//
// Real better-sqlite3 + real sqlite-vec, mirroring the shipped schema.
// Expected (correct): the vectors go with the meeting → exit 0.
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const db = new Database(':memory:');
sqliteVec.load(db);
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE meetings (id TEXT PRIMARY KEY);
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    embedding BLOB
  );
  CREATE VIRTUAL TABLE vec_chunks_3 USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[3] distance_metric=cosine);
`);
const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
db.prepare('INSERT INTO meetings (id) VALUES (?)').run('m1');
const ins = db.prepare('INSERT INTO chunks (meeting_id, embedding) VALUES (?, ?)');
const vins = db.prepare('INSERT INTO vec_chunks_3(chunk_id, embedding) VALUES (?, ?)');
for (let i = 0; i < 3; i++) {
  const info = ins.run('m1', f32([1, 0, 0]));
  vins.run(BigInt(info.lastInsertRowid), f32([1, 0, 0]));
}

const before = db.prepare('SELECT count(*) c FROM vec_chunks_3').get().c;

// The shipped ORDER: reap vectors while ids are still resolvable, then cascade.
const ids = db.prepare('SELECT id FROM chunks WHERE meeting_id = ?').all('m1');
const REAP = process.env.F705_SKIP_REAP === '1' ? false : true;
if (REAP && ids.length) {
  const ph = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM vec_chunks_3 WHERE chunk_id IN (${ph})`).run(...ids.map((r) => r.id));
}
db.prepare('DELETE FROM meetings WHERE id = ?').run('m1');

const chunksLeft = db.prepare('SELECT count(*) c FROM chunks').get().c;
const vecLeft = db.prepare('SELECT count(*) c FROM vec_chunks_3').get().c;
console.log(`[F-705] vectors before: ${before} | chunks after cascade: ${chunksLeft} | vec rows after: ${vecLeft}`);

if (chunksLeft !== 0) { console.error('[F-705] Inconclusive: the FK cascade did not remove chunks'); process.exit(2); }
if (vecLeft !== 0) {
  console.error('[F-705] FAIL: vec0 rows outlived the meeting — orphans consume KNN top-K slots and degrade recall permanently (F-705 reproduced).');
  process.exit(1);
}
console.log('[F-705] PASS: the vec0 index rows were reaped with the meeting.');
process.exit(0);
