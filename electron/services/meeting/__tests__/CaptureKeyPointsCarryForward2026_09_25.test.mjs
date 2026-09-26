// node:test — Settings → Intelligence → "Capture key points" (meetingMemoryV2).
//
// The switch promises: "Saves each meeting's decisions and open items, and
// carries them forward." Until 2026-09-25 CrossMeetingRecall carried only open
// questions and risks — never an unfinished action item or an earlier decision —
// and priorFromDetailedSummary dropped a prior meeting that had only decisions or
// action items. These tests pin the carry-forward of both.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { CrossMeetingRecall, priorFromDetailedSummary } = await import(
  '../../../../dist-electron/electron/services/meeting/CrossMeetingRecall.js'
);

const prior = (over = {}) => ({ id: 'm1', title: 'Budget review', date: '', openQuestions: [], risks: [], ...over });

test('an action item already on a recent meeting is carried forward as still to do', () => {
  const r = new CrossMeetingRecall().compute(
    { openQuestions: [], risks: [], actionItems: [{ text: 'Send the revised budget to finance' }] },
    [prior({ actionItems: ['Send revised budget to finance team'] })],
  );
  assert.equal(r.carriedActionItems.length, 1);
  assert.ok(r.stillOpen.some((l) => l.startsWith('Still to do from "Budget review"')));
});

test('an earlier decision on something discussed now is surfaced, verbatim', () => {
  const r = new CrossMeetingRecall().compute(
    { openQuestions: [{ text: 'Should we ship the rollout on Friday?' }], risks: [], decisions: [] },
    [prior({ decisions: ['Ship the rollout on Friday'] })],
  );
  assert.equal(r.earlierDecisions.length, 1);
  assert.equal(r.earlierDecisions[0].text, 'Ship the rollout on Friday');
  assert.ok(r.stillOpen.includes('Decided in "Budget review": Ship the rollout on Friday'));
});

test('unrelated items carry nothing', () => {
  const r = new CrossMeetingRecall().compute(
    { openQuestions: [{ text: 'Who owns the hiring plan?' }], risks: [], actionItems: [{ text: 'Book the offsite venue' }] },
    [prior({ actionItems: ['Renew the SSL certificate'], decisions: ['Adopt Postgres 17'] })],
  );
  assert.deepEqual(r.stillOpen, []);
});

test('a prior meeting with only decisions or action items is still comparable', () => {
  const onlyDecisions = priorFromDetailedSummary({ id: 'a', title: 'A', date: '', detailedSummary: { decisions: [{ text: 'd1' }] } });
  assert.deepEqual(onlyDecisions.decisions, ['d1']);
  const v3Actions = priorFromDetailedSummary({ id: 'b', title: 'B', date: '', detailedSummary: { actionItemsV3: [{ text: 'a1', owner: 'Me' }], actionItems: ['a1'] } });
  assert.deepEqual(v3Actions.actionItems, ['a1'], 'the structured V3 list wins over its string bridge');
  const legacy = priorFromDetailedSummary({ id: 'c', title: 'C', date: '', detailedSummary: { actionItems: ['legacy a'] } });
  assert.deepEqual(legacy.actionItems, ['legacy a']);
});

test('older stored priors without the new fields still work (questions and risks)', () => {
  const r = new CrossMeetingRecall().compute(
    { openQuestions: [{ text: 'When does the vendor contract renew?' }], risks: [] },
    [{ id: 'old', title: 'Old', date: '', openQuestions: ['When does vendor contract renew'], risks: [] }],
  );
  assert.equal(r.carriedOpenQuestions.length, 1);
});
