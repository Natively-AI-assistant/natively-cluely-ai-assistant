// F-411 regression test (audit/autopilot-2026-08-18).
//
// The live-indexing meeting id is a CONSTANT ('live-meeting-current') and the
// only cleanup runs at meeting end, guarded by !isMeetingActive and
// deliberately skipped when a new meeting has already started. After a crash,
// a force-quit, or a start that overlaps the previous drain, the previous
// meeting's transcript chunks survived under the same id — and the live
// "ask about this meeting" surface filters only on meeting_id, so meeting A's
// transcript could be served as evidence for meeting B. There is no startup
// sweep anywhere, and `chunks` has no UNIQUE(meeting_id, chunk_index).
//
// Contract pinned here: startLiveIndexing purges the id BEFORE it recreates
// the meeting row / starts the indexer, so every new session starts clean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, '..', 'RAGManager.ts'), 'utf8');

function startLiveIndexingBody() {
  const i = src.indexOf('startLiveIndexing(meetingId: string): void {');
  assert.notEqual(i, -1, 'startLiveIndexing not found');
  const j = src.indexOf('\n    /**', i);
  return src.slice(i, j === -1 ? i + 3000 : j);
}

test('startLiveIndexing purges stale data for the id before starting', () => {
  const body = startLiveIndexingBody();
  const purge = body.indexOf('this.deleteMeetingData(meetingId)');
  const insert = body.indexOf('INSERT OR IGNORE INTO meetings');
  const start = body.indexOf('this.liveIndexer.start(meetingId)');
  assert.notEqual(purge, -1,
    'startLiveIndexing must purge the constant live id before indexing — otherwise a crashed or overlapped previous session leaks its transcript into the next meeting (F-411)');
  assert.notEqual(insert, -1);
  assert.notEqual(start, -1);
  assert.ok(purge < insert && purge < start,
    'the purge must run BEFORE the meeting row is recreated and before the indexer starts');
});

test('the purge cannot block a meeting from starting', () => {
  const body = startLiveIndexingBody();
  const purge = body.indexOf('this.deleteMeetingData(meetingId)');
  const before = body.slice(Math.max(0, purge - 300), purge);
  assert.ok(/try\s*\{/.test(before),
    'the purge must sit inside a try — a cleanup failure must not prevent the meeting from starting');
});
