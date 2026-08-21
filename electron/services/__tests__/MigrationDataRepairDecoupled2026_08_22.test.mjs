// CR-06 (code-review, 2026-08-21) — REAL SQLite, REAL migrations.
//
// The v28 page-count repair changes NO schema (pure UPDATE over
// mode_reference_files, documented idempotent) but was gated on `user_version`,
// the SCHEMA counter. R-05 correctly made a failed v28 `return` so the version is
// not stamped past it — but that also blocked v29's vec0 cosine rebuild FOREVER
// on that profile, while ensureVecTableForDim keeps creating every NEW dimension
// table as cosine. One database, mixed metrics, all read through a single
// `similarity = 1 - distance` against one shared minSimilarity threshold — the
// exact hazard v29 exists to remove, reached through a different door.
//
// Schema version and data repair are now separate: the version advances, and the
// repair records its own app_state marker and retries until it succeeds.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../..');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cr06-'));
process.env.NATIVELY_TEST_USERDATA = userData;

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => userData, getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { DatabaseManager } = require(path.join(root, 'dist-electron/electron/db/DatabaseManager.js'));
const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const sqliteVec = require(path.join(root, 'node_modules/sqlite-vec'));

const MARKER = 'pending_page_count_repair_v28';
const dbPath = path.join(userData, 'natively.db');

const openManager = () => { DatabaseManager.instance = undefined; return DatabaseManager.getInstance(); };
const raw = () => {
  const db = new Database(dbPath);
  db.loadExtension(sqliteVec.getLoadablePath().replace('app.asar', 'app.asar.unpacked').replace(/\.(dylib|so|dll)$/, ''));
  return db;
};
// Only vec0 VIRTUAL tables carry a metric; the shadow tables (_info, _rowids,
// _vector_chunksNN) never do, and matching them produced a false FAIL once.
const vecTables = (db) => db.prepare(
  "SELECT name, sql FROM sqlite_master WHERE name LIKE 'vec_chunks_%' AND sql LIKE '%USING vec0%'"
).all().map((r) => ({ name: r.name, cosine: /distance_metric\s*=\s*cosine/i.test(r.sql || '') }));

let available = true;
let afterFailedRepair, afterRetry;

before(() => {
  const mgr = openManager();
  // better-sqlite3 is built against Electron's ABI; if it did not load, every
  // assertion below would be vacuous. Say so rather than passing.
  available = mgr.isAvailable();
  if (!available) { mgr.close?.(); return; }
  mgr.close();

  // Rewind to v27 and make the v28 repair genuinely fail: drop the column it
  // writes, so its UPDATE throws. A real failure, not a stubbed one.
  let db = raw();
  db.exec('ALTER TABLE mode_reference_files DROP COLUMN extracted_page_count');
  db.pragma('user_version = 27');
  for (const { name } of vecTables(db)) db.exec(`DROP TABLE IF EXISTS ${name}`);
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks_768 USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[768])');
  db.prepare('DELETE FROM app_state WHERE key = ?').run(MARKER);
  assert.equal(vecTables(db).every((t) => !t.cosine), true, 'precondition: the vec table must start at L2');
  db.close();

  openManager().close();                       // launch with a FAILING v28
  db = raw();
  afterFailedRepair = {
    version: db.pragma('user_version', { simple: true }),
    marker: db.prepare('SELECT value FROM app_state WHERE key = ?').get(MARKER)?.value,
    vec: vecTables(db),
  };
  db.exec('ALTER TABLE mode_reference_files ADD COLUMN extracted_page_count INTEGER');
  db.close();

  openManager().close();                       // next launch, repair can succeed
  db = raw();
  afterRetry = {
    version: db.pragma('user_version', { simple: true }),
    marker: db.prepare('SELECT value FROM app_state WHERE key = ?').get(MARKER)?.value,
  };
  db.close();
});

after(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch {} });

describe('a failed DATA repair must not block the SCHEMA chain', () => {
  test('better-sqlite3 actually loaded (otherwise everything here is vacuous)', () => {
    assert.equal(available, true, 'native module failed to load — run npm run rebuild:native');
  });

  test('the failed repair is recorded as pending rather than forgotten', () => {
    assert.equal(afterFailedRepair.marker, '1', "R-05's requirement: a failed repair must retry");
  });

  test('the schema version advances past it', () => {
    assert.ok(afterFailedRepair.version >= 29,
      `user_version stalled at ${afterFailedRepair.version}; v29 is blocked and the database keeps mixed vec0 metrics`);
  });

  test('v29 ran: the vec0 tables were rebuilt to cosine', () => {
    assert.ok(afterFailedRepair.vec.length > 0, 'no vec0 tables found — the check would be vacuous');
    assert.equal(afterFailedRepair.vec.every((t) => t.cosine), true,
      `mixed metrics remain: ${JSON.stringify(afterFailedRepair.vec)}`);
  });
});

describe('the deferred repair still runs eventually', () => {
  test('it retries on a later launch and clears its marker', () => {
    assert.equal(afterRetry.marker, undefined, 'the repair must clear its marker once it succeeds');
  });

  test('the schema version does not regress', () => {
    assert.ok(afterRetry.version >= 29);
  });
});
