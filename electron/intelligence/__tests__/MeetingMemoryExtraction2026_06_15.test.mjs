// electron/intelligence/__tests__/MeetingMemoryExtraction2026_06_15.test.mjs
//
// Phase 9 (task 2026-06-15, bug #4): the meeting structured-memory extractor was missing
// the natural meeting phrasings — "Decision: …" / "Action: …" / "Risk: …" label prefixes
// and ownership phrasing ("Mark owns X", "Anu will do Y by Friday"). The task's own sample
// transcript produced EMPTY decisions/actionItems. This pins the fix against compiled code.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { MeetingMemoryService } from '../../../dist-electron/electron/intelligence/MeetingMemoryService.js';

const SAMPLE = [
  { speaker: 'Mark', text: 'Mark owns Redis migration by Friday.' },
  { speaker: 'Anu', text: 'Anu owns landing page copy.' },
  { speaker: 'Lead', text: 'Decision: beta launches next Tuesday.' },
  { speaker: 'Lead', text: 'Risk: Deepgram cost may exceed budget.' },
];

describe('MeetingMemoryService — the task sample transcript extracts structured memory', () => {
  const rec = new MeetingMemoryService().buildMeetingRecord({
    meetingId: 'm1', segments: SAMPLE, mode: 'team-meeting', startedAt: 0, endedAt: 1000,
  });

  test('action items capture ownership ("Mark owns…", "Anu owns…")', () => {
    const joined = rec.actionItems.join(' | ');
    assert.match(joined, /Mark owns Redis migration/);
    assert.match(joined, /Anu owns landing page copy/);
  });

  test('decisions capture the "Decision:" label line', () => {
    assert.match(rec.decisions.join(' | '), /beta launches next Tuesday/);
  });

  test('risks capture the "Risk:" label line', () => {
    assert.match(rec.risks.join(' | '), /Deepgram cost/);
  });

  test('a risk line is NOT double-counted as an action', () => {
    assert.doesNotMatch(rec.actionItems.join(' | '), /Deepgram/);
  });

  test('topics include Redis (the dominant subject)', () => {
    assert.ok(rec.topics.some((t) => /redis/i.test(t)));
  });

  test('participants are captured', () => {
    assert.ok(rec.participants.includes('Mark'));
    assert.ok(rec.participants.includes('Anu'));
  });
});

describe('MeetingMemoryService — varied phrasings', () => {
  const cases = [
    { text: 'We decided to use Postgres for the ledger.', field: 'decisions', re: /Postgres/ },
    { text: 'Action: ship the API docs by EOD.', field: 'actionItems', re: /API docs/ },
    { text: 'TODO: review the auth flow.', field: 'actionItems', re: /auth flow/ },
    { text: 'Sarah is responsible for the migration script.', field: 'actionItems', re: /migration script/ },
    { text: 'Blocker: the staging env is down.', field: 'risks', re: /staging env/ },
    { text: 'Concern: we might miss the deadline.', field: 'risks', re: /deadline/ },
  ];
  for (const c of cases) {
    test(`"${c.text}" → ${c.field}`, () => {
      const rec = new MeetingMemoryService().buildMeetingRecord({
        meetingId: 'x', segments: [{ speaker: 'S', text: c.text }], startedAt: 0, endedAt: 1,
      });
      assert.match(rec[c.field].join(' | '), c.re, `expected ${c.field} to contain ${c.re}`);
    });
  }
});

describe('MeetingMemoryService — safety', () => {
  test('empty transcript → all-empty record, no throw', () => {
    const rec = new MeetingMemoryService().buildMeetingRecord({ meetingId: 'e', segments: [], startedAt: 0, endedAt: 1 });
    assert.deepEqual(rec.decisions, []);
    assert.deepEqual(rec.actionItems, []);
    assert.deepEqual(rec.risks, []);
  });

  test('schema includes the new risks field', () => {
    const rec = new MeetingMemoryService().buildMeetingRecord({ meetingId: 'e', segments: SAMPLE, startedAt: 0, endedAt: 1 });
    assert.ok(Array.isArray(rec.risks), 'risks is a first-class array field');
  });
});
