// electron/services/__tests__/UserTitledMeetingRename2026_08_21.test.mjs
//
// RC-7 regression from live shadow session C (2026-08-21): a user rename of a
// meeting was silently overwritten TWICE by generated titles —
//   A. saveMeeting()'s final write (INSERT OR REPLACE) clobbered a rename made
//      during the "Processing…" placeholder window AND wiped the user_titled
//      stamp with it;
//   B. replaceDetailedSummary() overwrote the title UNCONDITIONALLY whenever
//      the deferred V3 summary landed — even a rename made after the meeting
//      ended was reverted.
// Live symptom: generated titles like "Here's the C++ implementation" and
// "cpp" replacing whatever the user set.
//
// Fix: meetings.user_titled (migration v27→v28), stamped by
// updateMeetingTitle; both generated-title writers yield to it.
//
// Following the SaveMeetingIdempotency pattern: an in-memory better-sqlite3
// with the production schema + the EXACT production SQL, plus source pins on
// the compiled DatabaseManager.js so the mirrored SQL cannot drift.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiled = fs.readFileSync(
  path.resolve(__dirname, '../../../dist-electron/electron/db/DatabaseManager.js'), 'utf8');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      title TEXT,
      start_time INTEGER,
      duration_ms INTEGER,
      summary_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      calendar_event_id TEXT,
      source TEXT,
      is_processed INTEGER DEFAULT 1,
      summary_status TEXT DEFAULT 'completed',
      user_titled INTEGER DEFAULT 0
    );
  `);
  return db;
}

// The three production statements, verbatim from DatabaseManager.ts.
const RENAME_SQL = 'UPDATE meetings SET title = ?, user_titled = 1 WHERE id = ?';
const SUMMARY_TITLE_SQL = 'UPDATE meetings SET summary_json = ?, title = CASE WHEN COALESCE(user_titled, 0) = 1 THEN title ELSE ? END, summary_status = ? WHERE id = ?';
const SAVE_SQL = `INSERT OR REPLACE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, calendar_event_id, source, is_processed, summary_status, user_titled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const READ_USER_TITLE_SQL = 'SELECT title, COALESCE(user_titled, 0) AS user_titled FROM meetings WHERE id = ?';

// Mirror of the production saveMeeting title logic (pinned below).
function saveMeeting(db, id, generatedTitle) {
  const existing = db.prepare(READ_USER_TITLE_SQL).get(id);
  const userTitled = existing?.user_titled === 1;
  db.prepare(SAVE_SQL).run(
    id,
    userTitled && existing?.title ? existing.title : generatedTitle,
    1, 1000, '{}', '2026-08-21', null, 'manual', 1, 'completed',
    userTitled ? 1 : 0,
  );
}

describe('RC-7: user renames survive every generated-title writer', () => {
  test('mechanism A: rename during the Processing… window survives the final save', () => {
    const db = makeDb();
    saveMeeting(db, 'm1', 'Processing...');
    db.prepare(RENAME_SQL).run('Backend interview — Google', 'm1');
    // final save arrives with a generated title
    saveMeeting(db, 'm1', "Here's the C++ implementation");
    const row = db.prepare('SELECT title, user_titled FROM meetings WHERE id = ?').get('m1');
    assert.equal(row.title, 'Backend interview — Google');
    assert.equal(row.user_titled, 1, 'the stamp must survive INSERT OR REPLACE');
  });

  test('mechanism B: rename after the meeting survives the deferred summary title', () => {
    const db = makeDb();
    saveMeeting(db, 'm2', 'Generated title');
    db.prepare(RENAME_SQL).run('My final round', 'm2');
    db.prepare(SUMMARY_TITLE_SQL).run('{}', 'cpp', 'completed', 'm2');
    const row = db.prepare('SELECT title FROM meetings WHERE id = ?').get('m2');
    assert.equal(row.title, 'My final round');
  });

  test('no rename: generated titles still apply on both paths', () => {
    const db = makeDb();
    saveMeeting(db, 'm3', 'Processing...');
    saveMeeting(db, 'm3', 'System design screen');
    assert.equal(db.prepare('SELECT title FROM meetings WHERE id = ?').get('m3').title, 'System design screen');
    db.prepare(SUMMARY_TITLE_SQL).run('{}', 'Rate limiter deep-dive', 'completed', 'm3');
    assert.equal(db.prepare('SELECT title FROM meetings WHERE id = ?').get('m3').title, 'Rate limiter deep-dive');
  });

  test('a second rename still wins over a later summary', () => {
    const db = makeDb();
    saveMeeting(db, 'm4', 'Generated');
    db.prepare(RENAME_SQL).run('First rename', 'm4');
    db.prepare(RENAME_SQL).run('Second rename', 'm4');
    db.prepare(SUMMARY_TITLE_SQL).run('{}', 'Generated again', 'completed', 'm4');
    assert.equal(db.prepare('SELECT title FROM meetings WHERE id = ?').get('m4').title, 'Second rename');
  });
});

describe('RC-7: the compiled DatabaseManager carries the guards (drift pins)', () => {
  test('updateMeetingTitle stamps user_titled', () => {
    assert.match(compiled, /UPDATE meetings SET title = \?, user_titled = 1 WHERE id = \?/);
  });
  test('replaceDetailedSummary yields to user_titled', () => {
    assert.match(compiled, /title = CASE WHEN COALESCE\(user_titled, 0\) = 1 THEN title ELSE \? END/);
  });
  test('saveMeeting pre-reads the flag and writes the user_titled column', () => {
    assert.match(compiled, /SELECT title, COALESCE\(user_titled, 0\) AS user_titled FROM meetings WHERE id = \?/);
    assert.match(compiled, /is_processed, summary_status, user_titled/);
  });
  test('the user_titled ALTER is applied UNCONDITIONALLY, not version-gated (live incident 2026-08-23)', () => {
    // Shipped as `if (version < 28) { ALTER … }` while the live DB already
    // sat at user_version 30 (stamped by a parallel branch build) WITHOUT the
    // column — the gate never ran and every saveMeeting threw, silently
    // losing meetings and their summaries. An additive nullable column is
    // idempotent by construction and must not depend on a version counter
    // concurrent branches can race: the ALTER must execute BEFORE any
    // version-28 gate is consulted.
    const alterIdx = compiled.indexOf('ALTER TABLE meetings ADD COLUMN user_titled INTEGER DEFAULT 0');
    const gateIdx = compiled.indexOf('version < 28');
    assert.ok(alterIdx >= 0, 'the ALTER must exist');
    assert.ok(gateIdx >= 0, 'the version stamp must still advance');
    assert.ok(alterIdx < gateIdx, 'the ALTER must run unconditionally, before the version-28 gate');
    assert.match(compiled, /user_version = 28/);
  });
});
