// Folders, tags, people and companies tables (2026-10-15): created on an empty
// profile and on an existing one, idempotent, outside PRAGMA user_version (the
// counter parallel branches race), cascading from `meetings`, and emptied by
// "clear all data".
//
// Real SQLite files through the real DatabaseManager. Nothing here branches on
// the platform: the schema is plain SQL and the profile folder comes from
// os.tmpdir() + path.join, so the same assertions hold on macOS and Windows.
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
const { ensureOrganiseSchema, ORGANISE_TABLES, ORGANISE_SCHEMA_VERSION_KEY } = require(path.join(repoRoot, 'dist-electron/electron/db/organiseSchema.js'));

let Sqlite = null;
try { Sqlite = require('better-sqlite3'); new Sqlite(':memory:').close(); } catch { Sqlite = null; }
const NO_SQLITE = 'better-sqlite3 is not loadable here (run under ELECTRON_RUN_AS_NODE=1 electron --test)';

let userData;
let dbMgr;

function open() {
  process.env.NATIVELY_TEST_USERDATA = userData;
  try { delete require.cache[DB_PATH]; } catch {}
  dbMgr = require(DB_PATH).DatabaseManager.getInstance();
  return dbMgr.getDb();
}
function close() {
  try { dbMgr?.close?.(); } catch {}
  try { delete require.cache[DB_PATH]; } catch {}
  dbMgr = null;
}
const tables = (db) => new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name));
const n = (db, sql, ...a) => db.prepare(sql).get(...a).n;

function addMeeting(db, id) {
  db.prepare(`INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, source, is_processed)
    VALUES (?, ?, 1000, 60000, '{}', '2026-10-15T10:00:00.000Z', 'manual', 1)`).run(id, `Meeting ${id}`);
}

function fillOrganise(db, meetingId) {
  const ts = Date.now();
  db.prepare(`INSERT INTO folders (id, name, created_at, updated_at) VALUES ('f1', 'Customers', ?, ?)`).run(ts, ts);
  db.prepare(`INSERT INTO folder_rules (folder_id, kind, value, created_at) VALUES ('f1', 'attendee', 'acme.com', ?)`).run(ts);
  db.prepare(`INSERT INTO meeting_folders (meeting_id, folder_id, added_at) VALUES (?, 'f1', ?)`).run(meetingId, ts);
  db.prepare(`INSERT INTO tags (name, created_at) VALUES ('renewal', ?)`).run(ts);
  db.prepare(`INSERT INTO meeting_tags (meeting_id, tag_id, added_at) VALUES (?, 1, ?)`).run(meetingId, ts);
  db.prepare(`INSERT INTO people (id, email, name, name_key, created_at, updated_at) VALUES ('p1', 'dana@acme.com', 'Dana Fox', 'dana fox', ?, ?)`).run(ts, ts);
  db.prepare(`INSERT INTO person_meetings (person_id, meeting_id) VALUES ('p1', ?)`).run(meetingId);
  db.prepare(`INSERT INTO person_facts (person_id, meeting_id, kind, value, quote, created_at) VALUES ('p1', ?, 'title', 'Head of Sales', 'I lead sales at Acme', ?)`).run(meetingId, ts);
  db.prepare(`INSERT INTO organise_indexed (meeting_id, indexed_at) VALUES (?, ?)`).run(meetingId, ts);
  db.prepare(`INSERT INTO companies (domain, name, created_at, updated_at) VALUES ('acme.com', 'Acme', ?, ?)`).run(ts, ts);
}

describe('organise tables', () => {
  beforeEach(() => { userData = fs.mkdtempSync(path.join(os.tmpdir(), 'organise-schema-')); });
  afterEach(() => {
    close();
    delete process.env.NATIVELY_TEST_USERDATA;
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  });

  test('an empty profile gets every table and the schema marker', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = open();
    const have = tables(db);
    for (const name of ORGANISE_TABLES) assert.ok(have.has(name), `${name} exists`);
    assert.equal(db.prepare('SELECT value FROM app_state WHERE key = ?').get(ORGANISE_SCHEMA_VERSION_KEY)?.value, '1');
  });

  test('not behind user_version: running it again changes neither the counter nor the data', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = open();
    addMeeting(db, 'm1');
    fillOrganise(db, 'm1');
    const before = db.pragma('user_version', { simple: true });
    assert.equal(ensureOrganiseSchema(db), true);
    assert.equal(ensureOrganiseSchema(db), true);
    assert.equal(db.pragma('user_version', { simple: true }), before, 'the shared counter is untouched');
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM folders'), 1);
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM person_facts'), 1);
  });

  test('an existing profile from before the feature gets the tables at the next launch, meetings kept', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    let db = open();
    addMeeting(db, 'old');
    // The state of a profile written by the previous release: none of these tables, no marker.
    db.exec('PRAGMA foreign_keys = OFF');
    for (const name of ORGANISE_TABLES) db.exec(`DROP TABLE IF EXISTS ${name}`);
    db.prepare('DELETE FROM app_state WHERE key = ?').run(ORGANISE_SCHEMA_VERSION_KEY);
    const version = db.pragma('user_version', { simple: true });
    close();

    db = open();
    const have = tables(db);
    for (const name of ORGANISE_TABLES) assert.ok(have.has(name), `${name} came back`);
    assert.equal(n(db, `SELECT COUNT(*) AS n FROM meetings WHERE id = 'old'`), 1, 'the meeting is still there');
    assert.equal(db.pragma('user_version', { simple: true }), version);
    // And usable at once: a folder for the old meeting.
    fillOrganise(db, 'old');
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM meeting_folders'), 1);
  });

  test('deleting a meeting takes its folder links, tags, people links and facts; folders, people and companies stay', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = open();
    addMeeting(db, 'm1');
    fillOrganise(db, 'm1');
    assert.equal(dbMgr.deleteMeeting('m1'), true);
    for (const table of ['meeting_folders', 'meeting_tags', 'person_meetings', 'person_facts', 'organise_indexed']) {
      assert.equal(n(db, `SELECT COUNT(*) AS n FROM ${table}`), 0, `${table} emptied by the cascade`);
    }
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM folders'), 1);
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM folder_rules'), 1);
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM people'), 1);
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM companies'), 1);
  });

  test('clear all data empties every organise table', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = open();
    addMeeting(db, 'm1');
    fillOrganise(db, 'm1');
    assert.equal(dbMgr.clearAllData(), true);
    for (const table of ORGANISE_TABLES) assert.equal(n(db, `SELECT COUNT(*) AS n FROM ${table}`), 0, `${table} is empty`);
  });

  test('a plain SQLite file with only a meetings table can hold the schema too (no DatabaseManager)', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = new Sqlite(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, start_time INTEGER, duration_ms INTEGER, summary_json TEXT, created_at TEXT, source TEXT, is_processed INTEGER DEFAULT 1)`);
    assert.equal(ensureOrganiseSchema(db), true);
    const have = tables(db);
    for (const name of ORGANISE_TABLES) assert.ok(have.has(name), `${name} exists`);
    db.close();
  });
});
