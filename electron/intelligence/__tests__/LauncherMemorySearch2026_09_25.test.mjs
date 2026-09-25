// node:test — Launcher search pill → "Memory" rows (search:memories).
//
// Long-term memory (Hindsight) saved each meeting, but nothing the user could see read
// it back: live recall never reaches the default answer path, and the Launcher dropped
// the `hindsight:` hits of search:global-meetings. The pill now shows matching memories,
// linked to the meeting they were saved from when the memory carries that meeting's
// `meeting:<id>` tag.
//
// The tags come back ONLY when a caller asks (includeProvenance). The live-answer recall
// renders tags into its provenance block, so returning them by default would change
// answer prompts — the first test pins that. (The A/B in tests/answer-engine-ab proves
// the same end to end against the real handlers.)
//
// Run under Electron's Node (better-sqlite3 needs its ABI):
//   ELECTRON_RUN_AS_NODE=1 npx electron --test electron/intelligence/__tests__/LauncherMemorySearch2026_09_25.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { HindsightClientAdapter } = await import('../../../dist-electron/electron/intelligence/memory/HindsightClientAdapter.js');
const { LongTermMemoryService } = await import('../../../dist-electron/electron/intelligence/memory/LongTermMemoryService.js');
const { linkMemoriesToMeetings, meetingIdsFromMemories } = await import('../../../dist-electron/electron/intelligence/memory/memorySearch.js');

const MEETING = 'a0b1c2d3-0000-4000-8000-00000000ab01';
const RESULTS = [
  { text: 'The budget cap is 40k.', type: 'world', tags: ['user:local', `meeting:${MEETING}`, 'source:meeting_summary'], mentioned_at: '2026-09-20T10:00:00Z' },
  { text: 'Acme and Globex are shortlisted.', type: 'world' },
];
const fakeClient = () => ({ retain: async () => ({}), recall: async () => ({ results: RESULTS }) });

describe('recall provenance is opt-in', () => {
  test('without includeProvenance a recalled memory carries no tags or date (the answer path)', async () => {
    const svc = new LongTermMemoryService(new HindsightClientAdapter({ baseUrl: 'http://x' }, fakeClient()));
    const out = await svc.recallRelevantMemory('budget', { userId: 'local' }, { timeoutMs: 500, maxResults: 3 });
    assert.equal(out.length, 2);
    for (const m of out) {
      assert.equal(m.tags, undefined, 'tags would change the live-recall provenance block');
      assert.equal(m.date, undefined);
    }
  });

  test('with includeProvenance the tags and date come through (the search pill)', async () => {
    const svc = new LongTermMemoryService(new HindsightClientAdapter({ baseUrl: 'http://x' }, fakeClient()));
    const out = await svc.recallRelevantMemory('budget', { userId: 'local' }, { timeoutMs: 500, maxResults: 3, includeProvenance: true });
    assert.deepEqual(out[0].tags, RESULTS[0].tags);
    assert.equal(out[0].date, '2026-09-20T10:00:00Z');
    assert.equal(out[1].tags, undefined, 'an untagged fact stays untagged');
  });
});

describe('linkMemoriesToMeetings', () => {
  const memories = [
    { text: 'The budget cap is 40k.', tags: [`meeting:${MEETING}`] },
    { text: '  The budget   cap is 40k. ', tags: [`meeting:${MEETING}`] },
    { text: 'Acme and Globex are shortlisted.', date: '2026-09-01T00:00:00Z' },
    { text: 'From a deleted meeting.', tags: ['meeting:gone-meeting'] },
    { text: '' },
  ];
  const meetings = [{ id: MEETING.toUpperCase(), title: 'Budget review', date: '2026-09-20T10:00:00.000Z' }];

  test('links a tagged memory to its meeting, case-insensitively', () => {
    const hits = linkMemoriesToMeetings(memories, meetings, 5);
    assert.deepEqual(hits[0], { text: 'The budget cap is 40k.', meetingId: MEETING.toUpperCase(), meetingTitle: 'Budget review', date: '2026-09-20T10:00:00.000Z' });
  });

  test('duplicates collapse, empty text drops, unknown meetings stay unlinked', () => {
    const hits = linkMemoriesToMeetings(memories, meetings, 5);
    assert.deepEqual(hits.map((h) => h.text), ['The budget cap is 40k.', 'Acme and Globex are shortlisted.', 'From a deleted meeting.']);
    assert.deepEqual(hits[1], { text: 'Acme and Globex are shortlisted.', date: '2026-09-01T00:00:00Z' });
    assert.equal(hits[2].meetingId, undefined, 'a deleted meeting must not produce a row that opens nothing');
  });

  test('respects the limit', () => {
    assert.equal(linkMemoriesToMeetings(memories, meetings, 1).length, 1);
  });

  test('meetingIdsFromMemories lists each tagged meeting once', () => {
    assert.deepEqual(meetingIdsFromMemories(memories), [MEETING, 'gone-meeting']);
  });
});

describe('DatabaseManager.getMeetingHeadlines (real SQL)', () => {
  let Database = null;
  try { Database = createRequire(import.meta.url)('better-sqlite3'); new Database(':memory:').close(); } catch { Database = null; }

  test('title + date for the asked ids only, matched case-insensitively', { skip: Database ? false : 'better-sqlite3 needs the Electron ABI — run under ELECTRON_RUN_AS_NODE=1 electron --test' }, async () => {
    const { DatabaseManager } = await import('../../../dist-electron/electron/db/DatabaseManager.js');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, created_at TEXT, summary_json TEXT)');
    const ins = db.prepare('INSERT INTO meetings (id, title, created_at, summary_json) VALUES (?, ?, ?, ?)');
    ins.run(MEETING, 'Budget review', '2026-09-20T10:00:00.000Z', '{"huge":"not loaded"}');
    ins.run('other', 'Other', '2026-09-21T10:00:00.000Z', '{}');
    const headlines = (ids) => DatabaseManager.prototype.getMeetingHeadlines.call({ db }, ids);
    assert.deepEqual(headlines([MEETING.toUpperCase(), 'missing']), [{ id: MEETING, title: 'Budget review', date: '2026-09-20T10:00:00.000Z' }]);
    assert.deepEqual(headlines([]), []);
    db.close();
  });
});
