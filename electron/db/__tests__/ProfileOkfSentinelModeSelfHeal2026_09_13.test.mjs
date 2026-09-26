// The reserved '__profile_okf__' mode row must exist on EVERY boot (2026-09-13).
//
// THE BUG THIS PINS: `knowledge_sources.mode_id` and `knowledge_packs.mode_id`
// carry an FK to `modes(id)`, and profile Knowledge Packs hang off a reserved
// sentinel mode row, '__profile_okf__', inserted by migration v23. That INSERT
// sat inside `if (version < 23)`. A live profile was observed at user_version 31
// carrying v23's `pii` column but NOT the sentinel row — so the gate could never
// run again and the row could never come back. Every profile pack write then
// failed with "FOREIGN KEY constraint failed", and because
// ProfilePackBuilder.generateForProfile deliberately swallows its own errors
// (the OKF layer must never fail an ingest), ingest kept logging success while
// the profile card layer silently persisted nothing. Zero profile packs, ever.
//
// THE FIX: the `INSERT OR IGNORE` moved out of the version gate into
// DatabaseManager.ensureProfileOkfSentinelMode(), run unconditionally from
// runMigrations on every boot. It is idempotent by construction — the same
// reasoning already written into the meetings.user_titled ALTER — so it must not
// depend on a counter that a one-shot can strand, and running it every boot
// self-heals any database already in the broken state.
//
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/db/__tests__/ProfileOkfSentinelModeSelfHeal2026_09_13.test.mjs
//      (or `node --test <same path>` after the same build)

import { test, describe, before, after } from 'node:test';
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

const SENTINEL_ID = '__profile_okf__';

/** Fresh module instance → fresh singleton → one simulated app boot. */
function boot() {
  try { delete require.cache[DB_PATH]; } catch { /* first load */ }
  const { DatabaseManager } = require(DB_PATH);
  return DatabaseManager.getInstance();
}

const countSentinel = (db) =>
  db.prepare('SELECT COUNT(*) AS n FROM modes WHERE id = ?').get(SENTINEL_ID).n;

/** The exact write ProfilePackBuilder.generateForProfile makes for a resume. */
function insertProfileSource(db, id) {
  db.prepare(`
    INSERT INTO knowledge_sources
      (id, type, file_id, mode_id, file_name, source_checksum, content_hash, indexed_at, index_version)
    VALUES (?, 'profile_resume', NULL, ?, 'Candidate Resume', 'hash', 'hash', datetime('now'), 'profile_pack_v1')
  `).run(id, SENTINEL_ID);
}

describe('DatabaseManager — reserved __profile_okf__ mode is ensured on every boot', () => {
  let userData;

  before(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-okf-sentinel-'));
    process.env.NATIVELY_TEST_USERDATA = userData;
  });

  after(() => {
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  test('a fresh database gets the sentinel, and a profile source can be written', () => {
    const dbMgr = boot();
    const db = dbMgr.getDb();
    assert.ok(db, 'database should have opened');

    assert.equal(db.pragma('foreign_keys', { simple: true }), 1,
      'the FK that makes the sentinel load-bearing must actually be enforced');
    assert.equal(countSentinel(db), 1, 'fresh install must carry the sentinel row');

    insertProfileSource(db, 'psrc_fresh');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM knowledge_sources WHERE mode_id = ?').get(SENTINEL_ID).n,
      1,
    );
  });

  test('without the sentinel the profile pack write fails exactly as it did live', () => {
    const db = boot().getDb();
    db.prepare('DELETE FROM knowledge_sources WHERE mode_id = ?').run(SENTINEL_ID);
    db.prepare('DELETE FROM modes WHERE id = ?').run(SENTINEL_ID);
    assert.equal(countSentinel(db), 0);

    assert.throws(
      () => insertProfileSource(db, 'psrc_broken'),
      /FOREIGN KEY constraint failed/,
      'this is the error the live log reported on every ingest',
    );

    // Leave the database in the broken state for the next test, which is the
    // whole point: the next boot has to repair it.
    boot().close();
  });

  test('the next boot restores the sentinel on an already-broken database', () => {
    const versionBefore = (() => {
      const db = boot().getDb();
      return db.pragma('user_version', { simple: true });
    })();
    assert.ok(versionBefore >= 23,
      'the repair has to work on a database already stamped past the v23 gate');

    const db = boot().getDb();
    assert.equal(countSentinel(db), 1, 'the boot must have restored the sentinel row');

    // And the write that failed above now succeeds.
    insertProfileSource(db, 'psrc_healed');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM knowledge_sources WHERE id = ?').get('psrc_healed').n,
      1,
    );
  });

  test('the ensure is idempotent — repeated boots neither duplicate nor throw', () => {
    for (let i = 0; i < 3; i++) boot();
    const db = boot().getDb();
    assert.equal(countSentinel(db), 1);
    assert.equal(
      db.prepare('SELECT template_type FROM modes WHERE id = ?').get(SENTINEL_ID).template_type,
      '__reserved__',
      'the restored row must stay filtered out of the user-visible mode list',
    );
  });
});
