#!/usr/bin/env node
/**
 * R-08 / R-13 repro — the v28 vec0 rebuild.
 *
 * R-08: both v28 loops iterated DatabaseManager.KNOWN_DIMS = [768, 1536, 3072].
 *       LocalEmbeddingProvider.dimensions is 384 (all-MiniLM-L6-v2) — the
 *       OFFLINE FALLBACK provider — so vec_chunks_384 is a real, shipped table
 *       on any install that has ever embedded locally. It was never dropped,
 *       and the later re-create is `CREATE VIRTUAL TABLE IF NOT EXISTS`, a
 *       silent no-op on a surviving table. Its persisted DDL therefore kept no
 *       distance_metric, leaving the database with MIXED metrics under one
 *       shared `similarity = 1 - distance` and one shared threshold. On unit
 *       vectors L2 = sqrt(2-2cos), so a 0.25 similarity floor silently demanded
 *       cos >= 0.719 — on precisely the provider used when the cloud is down.
 *
 * R-13: v28 was not transactional. A crash after the drop loop but during the
 *       backfill left the tables EXISTING BUT EMPTY, which both
 *       detectVecSupport and hasVecExtension probe successfully — a silent,
 *       total RAG blackout with no error anywhere.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-08-repro.cjs
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const REPO = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO, 'electron', 'db', 'DatabaseManager.ts');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`[R-08] ${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual} (expected ${expected})`);
};

// --- Which dimension list does v28 actually drive from? -------------------
const src = fs.readFileSync(SRC, 'utf8');
const v28Start = src.indexOf("Applying migration v27 \u2192 v28");
if (v28Start < 0) { console.error('[R-08] FAIL: v28 migration block not found in source'); process.exit(1); }
const v28End = src.indexOf("user_version = 28", v28Start);
if (v28End < 0) { console.error('[R-08] FAIL: v28 end marker not found after its start'); process.exit(1); }
const v28 = src.slice(v28Start, v28End);
check('v28 enumerates EXISTING dims       ', /getExistingVecDims\(\)/.test(v28), true);
check('v28 does not iterate KNOWN_DIMS    ', /for \(const dim of DatabaseManager\.KNOWN_DIMS\)/.test(v28), false);
check('v28 wraps the rebuild in a tx      ', /this\.db\.transaction\(/.test(v28), true);

// --- The metric consequence, measured on a real 384-d table ---------------
const db = new Database(':memory:');
db.loadExtension(sqliteVec.getLoadablePath());
const vec = (a) => { const b = Buffer.alloc(a.length * 4); a.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };

// A 384-d table created the way the pre-v28 code did: no distance_metric => L2.
db.exec('CREATE VIRTUAL TABLE vec_l2 USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[3]);');
db.exec('CREATE VIRTUAL TABLE vec_cos USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[3] distance_metric=cosine);');

// Two UNIT vectors 60 degrees apart: true cosine = 0.5.
const q = [1, 0, 0];
const target = [0.5, Math.sqrt(3) / 2, 0];
for (const t of ['vec_l2', 'vec_cos']) {
  db.prepare(`INSERT INTO ${t}(chunk_id, embedding) VALUES (?, ?)`).run(BigInt(1), vec(target));
}
const dist = (t) => db.prepare(`SELECT distance FROM ${t} WHERE embedding MATCH ? AND k = 1`).get(vec(q)).distance;
const simL2 = 1 - dist('vec_l2');
const simCos = 1 - dist('vec_cos');
console.log(`[R-08] true cosine 0.50 -> reported similarity: L2 table ${simL2.toFixed(3)}, cosine table ${simCos.toFixed(3)}`);
check('cosine table reports the real 0.50 ', Number(simCos.toFixed(2)), 0.5);
check('L2 table is BELOW the 0.25 floor   ', simL2 < 0.25, true);

// --- R-13: a crash mid-rebuild must not leave empty-but-present tables ----
db.exec('CREATE VIRTUAL TABLE vec_rb USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[3]);');
for (let i = 1; i <= 3; i++) db.prepare('INSERT INTO vec_rb(chunk_id, embedding) VALUES (?,?)').run(BigInt(i), vec([1, 0, 0]));
const rows = () => { try { return db.prepare('SELECT count(*) c FROM vec_rb').get().c; } catch { return -1; } };
try {
  db.transaction(() => {
    db.exec('DROP TABLE IF EXISTS vec_rb;');
    throw new Error('crash during backfill');
  })();
} catch (_) { /* expected */ }
check('vec0 DROP rolls back on abort      ', rows(), 3);

if (failures) {
  console.error('[R-08] FAIL: v28 leaves a shipped dimension on L2, or is not crash-safe.');
  process.exit(1);
}
console.log('[R-08] PASS: v28 rebuilds every existing dimension, transactionally.');
