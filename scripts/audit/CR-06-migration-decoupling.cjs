/**
 * CR-06 (code-review, 2026-08-21) — REAL SQLite, REAL migrations.
 *
 * The v28 page-count repair changes NO schema (pure UPDATE, documented
 * idempotent) but is gated on `user_version`, the SCHEMA counter. R-05 made a
 * failed v28 `return` so the version is not stamped past it — correct in
 * isolation, but it also blocked v29's vec0 cosine rebuild FOREVER on that
 * profile, while ensureVecTableForDim keeps creating every NEW dimension table
 * as cosine. One database, mixed metrics, read through a single
 * `similarity = 1 - distance` and one shared minSimilarity threshold.
 *
 * This drives the real DatabaseManager against a real natively.db.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cr06-db-'));
process.env.NATIVELY_TEST_USERDATA = userData;

const Module = require('module');
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'electron') {
    return { app: { isReady: () => true, getPath: () => userData, getVersion: () => '0.0.0-test' },
             safeStorage: { isEncryptionAvailable: () => false } };
  }
  return realLoad.apply(this, arguments);
};

const dist = (p) => path.join(__dirname, '../..', 'dist-electron/electron', p);
const { DatabaseManager } = require(dist('db/DatabaseManager.js'));
const Database = require(path.join(__dirname, '../..', 'node_modules/better-sqlite3'));

const dbPath = path.join(userData, 'natively.db');
const open = () => { DatabaseManager.instance = undefined; return DatabaseManager.getInstance(); };
const raw = () => {
  const db = new Database(dbPath);
  // Load sqlite-vec exactly as DatabaseManager does, so this connection can
  // CREATE a vec0 table (reading sqlite_master needs no extension, creating does).
  const sqliteVec = require(path.join(__dirname, '../..', 'node_modules/sqlite-vec'));
  let ext = sqliteVec.getLoadablePath().replace('app.asar', 'app.asar.unpacked').replace(/\.(dylib|so|dll)$/, '');
  db.loadExtension(ext);
  return db;
};

const vecMetric = (db) => {
  // Only the vec0 VIRTUAL tables carry a distance metric. vec0 also creates
  // shadow tables (_info, _chunks, _rowids, _vector_chunksNN) which never do —
  // matching those made an earlier run of this probe report a false FAIL.
  const rows = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE name LIKE 'vec_chunks_%' AND sql LIKE '%USING vec0%'"
  ).all();
  return rows.map((r) => ({ name: r.name, cosine: /distance_metric\s*=\s*cosine/i.test(r.sql || '') }));
};

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  → ' + detail : ''}`);
};

(function main() {
  // 1. Let the REAL manager build a REAL database at the current version.
  let mgr = open();
  if (!mgr.isAvailable()) { console.error('database did not open — cannot verify'); process.exit(2); }
  mgr.close();

  let db = raw();
  const startVersion = db.pragma('user_version', { simple: true });
  console.log(`fresh database is at user_version=${startVersion}`);

  // 2. Rewind to 27 and BREAK the v28 repair the way the review described (a row
  //    shape the repair's SQL cannot handle). Dropping the column the repair
  //    writes makes its UPDATE throw — a real failure, not a stubbed one.
  db.exec('ALTER TABLE mode_reference_files DROP COLUMN extracted_page_count');
  db.pragma('user_version = 27');
  // Put the vec tables back to the pre-v29 state so we can see whether v29 runs.
  for (const { name } of vecMetric(db)) db.exec(`DROP TABLE IF EXISTS ${name}`);
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks_768 USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[768])");
  db.prepare('DELETE FROM app_state WHERE key = ?').run('pending_page_count_repair_v28');
  const before = vecMetric(db);
  db.close();
  console.log(`rewound to user_version=27; vec tables before: ${JSON.stringify(before)}`);

  // 3. Re-open: v28 must FAIL, and v29 must still run.
  console.log('\n--- launch with a failing v28 repair ---');
  mgr = open();
  mgr.close();

  db = raw();
  const version = db.pragma('user_version', { simple: true });
  const pending = db.prepare('SELECT value FROM app_state WHERE key = ?').get('pending_page_count_repair_v28');
  const after = vecMetric(db);
  db.close();

  console.log(`  user_version after   : ${version}`);
  console.log(`  pending repair marker: ${JSON.stringify(pending)}`);
  console.log(`  vec tables after     : ${JSON.stringify(after)}`);

  check('the failed DATA repair recorded a pending marker', pending?.value === '1');
  check('the SCHEMA chain advanced past the failed data repair', version >= 29, `user_version=${version}`);
  check('v29 ran: vec0 tables are cosine, not L2',
    after.length > 0 && after.every((t) => t.cosine),
    JSON.stringify(after));

  // 4. Repair the schema and relaunch: the pending repair must retry and clear.
  console.log('\n--- next launch, with the repair able to succeed ---');
  db = raw();
  db.exec('ALTER TABLE mode_reference_files ADD COLUMN extracted_page_count INTEGER');
  db.close();

  mgr = open();
  mgr.close();

  db = raw();
  const pending2 = db.prepare('SELECT value FROM app_state WHERE key = ?').get('pending_page_count_repair_v28');
  const version2 = db.pragma('user_version', { simple: true });
  db.close();
  console.log(`  pending marker: ${JSON.stringify(pending2)}   user_version: ${version2}`);
  check('the deferred repair RETRIED on a later launch and cleared its marker', pending2 === undefined);
  check('the schema version did not regress', version2 >= 29);

  fs.rmSync(userData, { recursive: true, force: true });
  console.log(failures === 0
    ? '\nCR-06 verified: a failed data repair no longer blocks the schema chain, and still retries.'
    : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
