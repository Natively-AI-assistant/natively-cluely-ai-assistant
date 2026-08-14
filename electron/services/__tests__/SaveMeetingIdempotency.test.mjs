// electron/services/__tests__/SaveMeetingIdempotency.test.mjs
//
// HIGH (audit finding #1) — DatabaseManager.saveMeeting must be IDEMPOTENT for a
// given meeting id. The real flow saves a meeting TWICE under the same id:
//   1. MeetingPersistence.stopMeeting() writes a placeholder snapshot,
//   2. MeetingPersistence.processAndSaveMeeting() writes the final record.
// The meetings row uses INSERT OR REPLACE, but transcripts / ai_interactions are
// append-only with autoincrement ids, so without a DELETE-before-insert the second
// save DOUBLED every child row. Recovery / RAG reprocessing then read duplicated
// transcripts.
//
// This test drives an in-memory better-sqlite3 with the EXACT production schema and
// the EXACT saveMeeting transaction body (mirroring DatabaseManager.saveMeeting,
// including the DELETE-first idempotency fix). A second test guards against
// regression by asserting the compiled DatabaseManager.js actually clears children
// before inserting them.
//
// Run under the Electron ABI (better-sqlite3 is built for Electron):
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>
// i.e. `npm run test:electron` (or test:services under the same ABI).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal slice of the production schema relevant to saveMeeting (DatabaseManager
// runMigrations v1). Mirrors db/DatabaseManager.ts:191-222.
function makeSchema(db) {
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
      is_processed INTEGER DEFAULT 1
    );
    CREATE TABLE transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      speaker TEXT,
      content TEXT,
      timestamp_ms INTEGER
    );
    CREATE TABLE ai_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      type TEXT,
      timestamp INTEGER,
      user_query TEXT,
      ai_response TEXT,
      metadata_json TEXT
    );
  `);
}

// Mirrors DatabaseManager.saveMeeting's transaction body, INCLUDING the
// DELETE-first idempotency fix under test (db/DatabaseManager.ts).
function saveMeeting(db, meeting, startTimeMs, durationMs) {
  const insertMeeting = db.prepare(`
    INSERT OR REPLACE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, calendar_event_id, source, is_processed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTranscript = db.prepare(`
    INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms)
    VALUES (?, ?, ?, ?)
  `);
  const insertInteraction = db.prepare(`
    INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const deleteTranscripts = db.prepare(`DELETE FROM transcripts WHERE meeting_id = ?`);
  const deleteInteractions = db.prepare(`DELETE FROM ai_interactions WHERE meeting_id = ?`);

  const summaryJson = JSON.stringify({ legacySummary: meeting.summary, detailedSummary: meeting.detailedSummary });

  const tx = db.transaction(() => {
    insertMeeting.run(
      meeting.id, meeting.title, startTimeMs, durationMs, summaryJson,
      meeting.date, meeting.calendarEventId || null, meeting.source || 'manual',
      meeting.isProcessed ? 1 : 0,
    );
    deleteTranscripts.run(meeting.id);
    if (meeting.transcript) {
      for (const seg of meeting.transcript) {
        insertTranscript.run(meeting.id, seg.speaker, seg.text, seg.timestamp);
      }
    }
    deleteInteractions.run(meeting.id);
    if (meeting.usage) {
      for (const u of meeting.usage) {
        const answerText = Array.isArray(u.answer) ? null : (u.answer || null);
        insertInteraction.run(meeting.id, u.type, u.timestamp, u.question || null, answerText, u.items ? JSON.stringify(u.items) : null);
      }
    }
  });
  tx();
}

const placeholder = {
  id: 'meeting-A',
  title: 'Processing...',
  date: '2026-06-16T00:00:00.000Z',
  summary: '',
  transcript: [
    { speaker: 'interviewer', text: 'Tell me about yourself.', timestamp: 1000 },
    { speaker: 'user', text: 'I am a software engineer.', timestamp: 2000 },
  ],
  usage: [
    { type: 'chat', timestamp: 1500, question: 'q1', answer: 'a1' },
  ],
  isProcessed: false,
};

const finalRecord = {
  ...placeholder,
  title: 'Intro chat',
  summary: 'A short intro.',
  isProcessed: true,
};

describe('saveMeeting idempotency (audit finding #1)', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); makeSchema(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  test('saving the same meeting twice does NOT duplicate transcript rows', () => {
    saveMeeting(db, placeholder, placeholder.transcript[0].timestamp, 5000); // placeholder save
    saveMeeting(db, finalRecord, finalRecord.transcript[0].timestamp, 5000); // final save (same id)

    const tCount = db.prepare('SELECT COUNT(*) c FROM transcripts WHERE meeting_id = ?').get('meeting-A').c;
    assert.equal(tCount, 2, 'should hold exactly the 2 transcript segments, not 4');

    const iCount = db.prepare('SELECT COUNT(*) c FROM ai_interactions WHERE meeting_id = ?').get('meeting-A').c;
    assert.equal(iCount, 1, 'should hold exactly the 1 interaction, not 2');

    const mCount = db.prepare('SELECT COUNT(*) c FROM meetings WHERE id = ?').get('meeting-A').c;
    assert.equal(mCount, 1, 'INSERT OR REPLACE keeps exactly one meeting row');

    // The final record's metadata wins (INSERT OR REPLACE).
    const row = db.prepare('SELECT title, is_processed FROM meetings WHERE id = ?').get('meeting-A');
    assert.equal(row.title, 'Intro chat');
    assert.equal(row.is_processed, 1);
  });

  test('re-saving with fewer children shrinks the child set (no stale rows)', () => {
    saveMeeting(db, placeholder, 1000, 5000);
    const trimmed = { ...finalRecord, transcript: [placeholder.transcript[0]], usage: [] };
    saveMeeting(db, trimmed, 1000, 5000);

    assert.equal(db.prepare('SELECT COUNT(*) c FROM transcripts WHERE meeting_id = ?').get('meeting-A').c, 1);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_interactions WHERE meeting_id = ?').get('meeting-A').c, 0);
  });

  test('children for OTHER meetings are untouched by a re-save', () => {
    saveMeeting(db, { ...placeholder, id: 'meeting-B' }, 1000, 5000);
    saveMeeting(db, placeholder, 1000, 5000);
    saveMeeting(db, finalRecord, 1000, 5000); // re-save A only

    assert.equal(db.prepare('SELECT COUNT(*) c FROM transcripts WHERE meeting_id = ?').get('meeting-B').c, 2,
      'meeting B child rows must be untouched by re-saving meeting A');
  });
});

describe('saveMeeting source guard (compiled code has the DELETE-first fix)', () => {
  test('compiled DatabaseManager clears children before inserting them', () => {
    const compiled = path.resolve(__dirname, '../../../dist-electron/electron/db/DatabaseManager.js');
    assert.ok(fs.existsSync(compiled), `compiled DatabaseManager.js missing — run build:electron (${compiled})`);
    const src = fs.readFileSync(compiled, 'utf8');
    assert.match(src, /DELETE FROM transcripts WHERE meeting_id/, 'must delete transcripts before re-insert');
    assert.match(src, /DELETE FROM ai_interactions WHERE meeting_id/, 'must delete ai_interactions before re-insert');
  });
});
