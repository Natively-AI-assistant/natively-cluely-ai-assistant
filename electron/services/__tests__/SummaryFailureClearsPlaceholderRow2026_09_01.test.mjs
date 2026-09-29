// A hard summary failure must clear the placeholder row (2026-09-01).
//
// THE BUG THIS PINS: when processAndSaveMeeting throws, saveMeeting is never
// reached, so the placeholder row endMeeting wrote keeps title "Processing..."
// and legacySummary "Generating summary..." forever. The old catch flipped
// summary_status to 'failed' and nothing else, so the meeting read as
// perpetually in-flight — the notes screen showed "Notes couldn't be generated"
// under a heading that said "Processing..." — and the stale blurb leaked into
// exported PDFs (pdfGenerator), global-search snippets (searchGlobalMeetings)
// and the text RAGManager indexes when a meeting has no overview.
//
// THE FIX: DatabaseManager.markSummaryGenerationFailed lands the best name the
// pipeline reached, clears the blurb, and sets the failed status in one write —
// while leaving is_processed at 0 so recoverUnprocessedMeetings still retries
// the meeting at the next app start.
//
// Behavioural, against a real sqlite file rather than a source-text pin: the
// four invariants below (title replaced, blurb cleared, is_processed preserved,
// user rename preserved) are exactly the ones a future refactor could silently
// break. Run under `ELECTRON_RUN_AS_NODE=1 electron --test` (native ABI) or
// `node --test` after `npm run build:electron`.

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

// Exactly what MeetingPersistence.endMeeting writes for a meeting still being
// summarised. If these drift, this test is pinning the wrong thing.
const PLACEHOLDER_TITLE = 'Processing...';
const PLACEHOLDER_SUMMARY = 'Generating summary...';

let DatabaseManager;
let dbMgr;

/** Insert a placeholder row shaped like the one endMeeting persists. */
const seedPlaceholder = (db, id, { userTitled = 0, title = PLACEHOLDER_TITLE, summaryJson } = {}) => {
  db.prepare(
    `INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, is_processed, summary_status, user_titled)
     VALUES (?, ?, ?, ?, ?, 0, 'queued', ?)`,
  ).run(
    id,
    title,
    Date.now(),
    60_000,
    summaryJson ?? JSON.stringify({ legacySummary: PLACEHOLDER_SUMMARY, detailedSummary: { actionItems: [], keyPoints: [] } }),
    userTitled,
  );
};

const readRow = (db, id) =>
  db.prepare('SELECT title, summary_json, is_processed, summary_status FROM meetings WHERE id = ?').get(id);

describe('summary hard failure clears the placeholder row (2026-09-01)', () => {
  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-failure-test-'));
    process.env.NATIVELY_TEST_USERDATA = tmp;
    try { delete require.cache[DB_PATH]; } catch { /* first load */ }
    DatabaseManager = require(DB_PATH).DatabaseManager;
    dbMgr = DatabaseManager.getInstance();
  });

  afterEach(() => {
    try { dbMgr?.close?.(); } catch { /* already closed */ }
    try { delete require.cache[DB_PATH]; } catch { /* nothing cached */ }
    delete process.env.NATIVELY_TEST_USERDATA;
  });

  test('the placeholder title and blurb are replaced, and the status goes failed', () => {
    if (!dbMgr.isAvailable()) return; // native binding not loadable in this env
    const db = dbMgr.getDb();
    seedPlaceholder(db, 'fail-1');

    assert.equal(dbMgr.markSummaryGenerationFailed('fail-1', 'Untitled Session'), true);

    const row = readRow(db, 'fail-1');
    assert.equal(row.title, 'Untitled Session', 'the placeholder title must not survive a failure');
    assert.notEqual(row.title, PLACEHOLDER_TITLE);
    assert.equal(row.summary_status, 'failed');
    assert.equal(
      JSON.parse(row.summary_json).legacySummary,
      '',
      'the "Generating summary..." blurb feeds PDF export, search snippets and RAG — it must be cleared',
    );
  });

  test('is_processed stays 0 so recoverUnprocessedMeetings still retries the meeting', () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();
    seedPlaceholder(db, 'fail-2');

    dbMgr.markSummaryGenerationFailed('fail-2', 'Untitled Session');

    assert.equal(readRow(db, 'fail-2').is_processed, 0, 'a failed summary must remain recoverable at next app start');
    const ids = dbMgr.getUnprocessedMeetings().map((m) => m.id);
    assert.ok(ids.includes('fail-2'), 'the meeting must still be picked up by getUnprocessedMeetings');
  });

  test('a user rename survives — the fallback title never overwrites it', () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();
    seedPlaceholder(db, 'fail-3', { userTitled: 1, title: 'Budget review with Ana' });

    dbMgr.markSummaryGenerationFailed('fail-3', 'Untitled Session');

    const row = readRow(db, 'fail-3');
    assert.equal(row.title, 'Budget review with Ana', 'user_titled must win over the fallback name');
    assert.equal(row.summary_status, 'failed', 'the status still has to land for a renamed meeting');
  });

  test('the fallback title is NOT stamped as the user\'s, so a later real title replaces it', () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();
    seedPlaceholder(db, 'fail-4');

    dbMgr.markSummaryGenerationFailed('fail-4', 'Untitled Session');

    const flag = db.prepare('SELECT COALESCE(user_titled, 0) AS ut FROM meetings WHERE id = ?').get('fail-4').ut;
    assert.equal(flag, 0, 'writing the fallback via updateMeetingTitle would stamp user_titled and freeze the placeholder name');
  });

  test('an unparseable summary_json still gets the status and title, and is left intact', () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();
    seedPlaceholder(db, 'fail-5', { summaryJson: '{not json' });

    assert.equal(dbMgr.markSummaryGenerationFailed('fail-5', 'Untitled Session'), true);

    const row = readRow(db, 'fail-5');
    assert.equal(row.summary_status, 'failed');
    assert.equal(row.title, 'Untitled Session');
    assert.equal(row.summary_json, '{not json', 'a blob we could not read must be left alone, not overwritten');
  });

  test('a missing meeting is a no-op rather than a throw', () => {
    if (!dbMgr.isAvailable()) return;
    assert.equal(dbMgr.markSummaryGenerationFailed('does-not-exist', 'Untitled Session'), false);
  });

  // The behavioural tests above all pass 'Untitled Session' explicitly, so they
  // would stay green if the catch were "simplified" to hardcode that literal —
  // silently discarding the calendar event name for every meeting matched to one,
  // and the generated title when the throw lands late. Pin that the catch hands
  // over the `title` variable it actually computed. Whitespace-normalised and
  // anchored on the call expression alone, so reformatting or a nearby comment
  // edit cannot fail it falsely.
  test('the failure catch passes the computed title, not a hardcoded placeholder', () => {
    const source = fs
      .readFileSync(path.resolve(__dirname, '../../MeetingPersistence.ts'), 'utf8')
      .replace(/\s+/g, ' ');
    assert.match(
      source,
      /markSummaryGenerationFailed\(\s*meetingId\s*,\s*title\s*\)/,
      'the catch must forward the pipeline\'s `title` (calendar name / generated title / default), not a literal',
    );
  });
});
