// F-410 repro: vec0 returns L2 distance but VectorStore reads it as COSINE.
//
// The vec0 tables were created with no distance_metric, and sqlite-vec
// defaults to L2. VectorStore computes `similarity = 1 - vecRow.distance` and
// every consumer thresholds that as a cosine in [-1,1] (minSimilarity 0.25,
// MEETING_MIN_SIMILARITY 0.3, ...). For unit vectors L2 = sqrt(2-2cos), so a
// 0.25 floor silently demands cos >= 0.719; for NON-unit vectors a chunk whose
// direction is IDENTICAL to the query scores 0.0 and is dropped outright.
// Ranking order is unchanged for normalized vectors, which is why this
// degraded recall silently. Every existing test forces the JS path, so the
// shipped native path was uncovered.
//
// This uses the REAL DDL emitted by DatabaseManager.ensureVecTableForDim,
// extracted from source, so it tracks the fix rather than a copy of it.
//
// Expected (correct): 1 - distance equals true cosine → exit 0.
// Bug (F-410): it equals 1 - L2 and drops same-direction vectors → exit 1.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const root = path.resolve(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'electron/db/DatabaseManager.ts'), 'utf8');
const usesCosine = /CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks_\$\{dim\} USING vec0\([\s\S]{0,200}?distance_metric=cosine/.test(src);
console.log('[F-410] DatabaseManager DDL declares distance_metric=cosine:', usesCosine);

const db = new Database(':memory:');
sqliteVec.load(db);
const dim = 3;
db.exec(`CREATE VIRTUAL TABLE vt USING vec0(id INTEGER PRIMARY KEY, embedding float[${dim}]${usesCosine ? ' distance_metric=cosine' : ''});`);
const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
const ins = db.prepare('INSERT INTO vt(id, embedding) VALUES (?, ?)');
// id2 has the SAME direction as the query but twice the magnitude → true cosine 1.0
const vectors = { 1: [1, 0, 0], 2: [2, 0, 0], 3: [0.7071, 0.7071, 0], 4: [0, 1, 0] };
for (const [id, v] of Object.entries(vectors)) ins.run(BigInt(id), f32(v));

const query = [1, 0, 0];
const cosine = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb));
};
const rows = db.prepare('SELECT id, distance FROM vt WHERE embedding MATCH ? ORDER BY distance LIMIT 4').all(f32(query));

const MIN_SIMILARITY = 0.25; // VectorStore default
let bad = false;
for (const r of rows) {
  const codeSimilarity = 1 - r.distance;          // exactly what VectorStore.ts computes
  const trueCos = cosine(query, vectors[r.id]);
  const keptNative = codeSimilarity >= MIN_SIMILARITY;
  const keptTrue = trueCos >= MIN_SIMILARITY;
  console.log(`  id${r.id}: 1-distance=${codeSimilarity.toFixed(4)}  trueCosine=${trueCos.toFixed(4)}  kept(native)=${keptNative}  kept(true)=${keptTrue}`);
  if (Math.abs(codeSimilarity - trueCos) > 0.01) bad = true;
  if (keptNative !== keptTrue) bad = true;
}
if (bad) {
  console.error('[F-410] FAIL: `1 - distance` does not equal cosine similarity, and chunks that pass the true-cosine floor are dropped (F-410 reproduced).');
  process.exit(1);
}
console.log('[F-410] PASS: `1 - distance` is the true cosine similarity; retention matches.');
process.exit(0);
