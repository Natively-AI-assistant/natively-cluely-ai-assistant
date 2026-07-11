// Foreign-key cascade enforcement on the shared connection (2026-07-10).
//
// THE BUG THIS PINS: several delete paths (deleteMeeting, deleteMode,
// deleteKnowledgePack) do a bare parent-row DELETE and rely ENTIRELY on
// `ON DELETE CASCADE` to reap child rows (transcripts, ai_interactions, chunks,
// chunk_summaries). SQLite ships with `foreign_keys` OFF per-connection, so
// those cascades are INERT unless the pragma is enabled. Historically the only
// code that enabled it was the *premium* KnowledgeDatabaseManager constructor —
// so FK enforcement silently depended on the premium submodule loading. If
// premium failed to load (source-available build / packaging regression), every
// meeting/mode/pack delete would orphan its children (unreclaimable disk growth).
//
// THE FIX: DatabaseManager.initialize() now runs `PRAGMA foreign_keys = ON`
// directly on the shared connection, with NO dependency on premium.
//
// This test constructs a bare DatabaseManager (premium is NOT loaded in this
// runner) and asserts (a) the pragma is ON and (b) a parent delete cascades to
// children. Run under `ELECTRON_RUN_AS_NODE=1 electron --test` (native ABI) or
// `node --test` after `npm run build:electron`.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');

let DatabaseManager;
let dbMgr;

describe('DatabaseManager — foreign_keys cascade without premium (2026-07-10)', () => {
  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cascade-test-'));
    process.env.NATIVELY_TEST_USERDATA = tmp;
    try { delete require.cache[DB_PATH]; } catch {}
    DatabaseManager = require(DB_PATH).DatabaseManager;
    dbMgr = DatabaseManager.getInstance();
  });

  afterEach(() => {
    try { dbMgr?.close?.(); } catch {}
    try { delete require.cache[DB_PATH]; } catch {}
    delete process.env.NATIVELY_TEST_USERDATA;
  });

  test('PRAGMA foreign_keys is ON on the shared connection (no premium)', () => {
    if (!dbMgr.isAvailable()) return; // native binding not loadable in this env
    const db = dbMgr.getDb();
    assert.ok(db, 'shared connection should exist');
    const fk = db.pragma('foreign_keys', { simple: true });
    assert.equal(fk, 1, 'foreign_keys must be enabled without the premium module');
  });

  test('a bare parent delete cascades to child rows', () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();

    const meetingId = 'fk-test-meeting-1';
    db.prepare(
      `INSERT INTO meetings (id, title, start_time, duration_ms) VALUES (?, ?, ?, ?)`
    ).run(meetingId, 'FK test', Date.now(), 1000);

    db.prepare(
      `INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms) VALUES (?, ?, ?, ?)`
    ).run(meetingId, 'user', 'hello', Date.now());
    db.prepare(
      `INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response) VALUES (?, ?, ?, ?, ?)`
    ).run(meetingId, 'answer', Date.now(), 'q', 'a');
    db.prepare(
      `INSERT INTO chunks (meeting_id, chunk_index, cleaned_text, token_count) VALUES (?, ?, ?, ?)`
    ).run(meetingId, 0, 'chunk text', 2);
    db.prepare(
      `INSERT INTO chunk_summaries (meeting_id, summary_text) VALUES (?, ?)`
    ).run(meetingId, 'summary text');

    const childCount = () =>
      db.prepare(`SELECT COUNT(*) AS n FROM transcripts WHERE meeting_id = ?`).get(meetingId).n +
      db.prepare(`SELECT COUNT(*) AS n FROM ai_interactions WHERE meeting_id = ?`).get(meetingId).n +
      db.prepare(`SELECT COUNT(*) AS n FROM chunks WHERE meeting_id = ?`).get(meetingId).n +
      db.prepare(`SELECT COUNT(*) AS n FROM chunk_summaries WHERE meeting_id = ?`).get(meetingId).n;

    assert.equal(childCount(), 4, 'precondition: 4 child rows inserted');

    // Bare parent delete — the exact shape deleteMeeting uses. With FK ON this
    // MUST cascade; with FK OFF (the pre-fix bug) the children would be orphaned.
    db.prepare(`DELETE FROM meetings WHERE id = ?`).run(meetingId);

    assert.equal(childCount(), 0, 'all child rows must be cascaded away by the parent delete');
  });
});
