// node:test — Settings → Intelligence → "Search past meetings" (globalSearchV2).
//
// Promise: "Search all your saved meetings by keyword and jump to the moment."
// Until 2026-09-25 the search read titles and summaries only — never what was
// said — so it could not jump anywhere. It now searches transcript lines
// (DatabaseManager.searchTranscriptLines) and keeps the best line per meeting
// (bestTranscriptLinePerMeeting), whose timestamp the meeting opens at.
//
// The SQL test runs the REAL method against an in-memory SQLite database, so it
// needs Electron's Node ABI for better-sqlite3:
//   ELECTRON_RUN_AS_NODE=1 npx electron --test electron/intelligence/__tests__/SearchPastMeetingsTranscript2026_09_25.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { bestTranscriptLinePerMeeting } = await import('../../../dist-electron/electron/intelligence/SearchOrchestrator.js');

describe('bestTranscriptLinePerMeeting', () => {
  const rows = [
    { meetingId: 'a', content: 'we should move the ledger migration to Q3', timestampMs: 90_000 },
    { meetingId: 'a', content: 'the ledger migration rollback plan', timestampMs: 30_000 },
    { meetingId: 'a', content: 'the ledger team is hiring', timestampMs: 10_000 },
    { meetingId: 'b', content: 'unrelated standup chatter', timestampMs: 5_000 },
  ];

  test('keeps the line with the most terms, then the exact phrase', () => {
    const best = bestTranscriptLinePerMeeting(rows, ['ledger', 'migration'], 'ledger migration');
    assert.equal(best.get('a').timestampMs, 30_000, 'both lines have both terms + phrase; the earlier one wins');
    assert.equal(best.get('a').score, 1);
    assert.equal(best.has('b'), false, 'a meeting with no matching line has no moment');
  });

  test('a partial match still counts, below a full one', () => {
    const best = bestTranscriptLinePerMeeting(rows, ['ledger', 'hiring'], 'ledger hiring');
    assert.equal(best.get('a').content, 'the ledger team is hiring');
  });

  test('no terms → nothing', () => {
    assert.equal(bestTranscriptLinePerMeeting(rows, [], '').size, 0);
  });
});

describe('DatabaseManager.searchTranscriptLines (real SQL)', () => {
  let Database = null;
  try { Database = createRequire(import.meta.url)('better-sqlite3'); new Database(':memory:').close(); } catch { Database = null; }

  test('finds lines across meetings, case-insensitively, with LIKE wildcards escaped', { skip: Database ? false : 'better-sqlite3 needs the Electron ABI — run under ELECTRON_RUN_AS_NODE=1 electron --test' }, async () => {
    const { DatabaseManager } = await import('../../../dist-electron/electron/db/DatabaseManager.js');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE transcripts (id INTEGER PRIMARY KEY, meeting_id TEXT, speaker TEXT, content TEXT, timestamp_ms INTEGER)');
    const ins = db.prepare('INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms) VALUES (?, ?, ?, ?)');
    ins.run('m1', 'interviewer', 'The Ledger migration slipped', 1000);
    ins.run('m2', 'user', 'we hit 50% of the target', 2000);
    ins.run('m2', 'user', 'we hit 500 of the target', 3000);
    ins.run('m3', 'user', 'nothing relevant', 4000);
    const search = (terms) => DatabaseManager.prototype.searchTranscriptLines.call({ db }, terms);
    assert.deepEqual(search(['ledger']).map((r) => r.meetingId), ['m1'], 'case-insensitive');
    assert.deepEqual(search(['50%']).map((r) => r.timestampMs), [2000], '"50%" is literal, not "50 then anything"');
    assert.equal(search(['a']).length, 0, 'one-character terms are ignored');
    assert.deepEqual(search(['ledger', 'target']).map((r) => r.meetingId).sort(), ['m1', 'm2', 'm2']);
    db.close();
  });
});
