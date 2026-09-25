// node:test — Settings → Intelligence → "Speaker labels".
//
// The switch promises the names you give speakers reach your notes and action
// items. Notes are written once at meeting end with the default names ("Me",
// "Speaker 1"), and a rename used to change only the transcript until the user
// found Regenerate. SpeakerLabelService.applyRenamesToSummary now carries a
// rename into the saved notes; these tests pin what it may and may not touch.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { SpeakerLabelService } = await import('../../../dist-electron/electron/services/meeting/SpeakerLabelService.js');
const svc = new SpeakerLabelService();

const notes = () => ({
  tldr: ['Speaker 1 wants the deck by Friday.', 'Speaker 10 was not in this meeting.'],
  overview: 'Me and Speaker 1 agreed on the rollout. Speaker 1s comment was noted.',
  actionItems: [
    { text: 'Send the deck', owner: 'Speaker 1' },
    { text: 'Book the room', owner: 'Me' },
  ],
  decisions: [{ text: 'Ship Friday', evidence: [{ quote: 'Speaker 1 said ship it', timestampMs: 1000 }] }],
  crossMeeting: { openFromBefore: [{ text: 'Speaker 1 still owes the budget' }] },
  speakerLabels: {},
  mode: { selectedModeName: 'Speaker 1' },
});

describe('applyRenamesToSummary', () => {
  test('a default name becomes the new name, whole-word only', () => {
    const out = svc.applyRenamesToSummary(notes(), {}, { speaker_1: 'John' });
    assert.equal(out.tldr[0], 'John wants the deck by Friday.');
    assert.equal(out.tldr[1], 'Speaker 10 was not in this meeting.', '"Speaker 1" must not match inside "Speaker 10"');
    assert.equal(out.overview, 'Me and John agreed on the rollout. Speaker 1s comment was noted.',
      'no match inside a longer token');
    assert.equal(out.actionItems[0].owner, 'John');
  });

  test('"Me" changes only where an owner is exactly "Me"', () => {
    const out = svc.applyRenamesToSummary(notes(), {}, { me: 'Evin' });
    assert.equal(out.actionItems[1].owner, 'Evin');
    assert.ok(out.overview.startsWith('Me and'), '"Me" inside a sentence is left alone');
  });

  test('verbatim quotes, other-meeting recall and metadata are untouched', () => {
    const out = svc.applyRenamesToSummary(notes(), {}, { speaker_1: 'John' });
    assert.equal(out.decisions[0].evidence[0].quote, 'Speaker 1 said ship it');
    assert.equal(out.crossMeeting.openFromBefore[0].text, 'Speaker 1 still owes the budget');
    assert.equal(out.mode.selectedModeName, 'Speaker 1');
  });

  test('a second rename replaces the previous name, and clearing restores the default', () => {
    const once = svc.applyRenamesToSummary(notes(), {}, { speaker_1: 'John' });
    const twice = svc.applyRenamesToSummary(once, { speaker_1: 'John' }, { speaker_1: 'Johnny' });
    assert.equal(twice.actionItems[0].owner, 'Johnny');
    const cleared = svc.applyRenamesToSummary(twice, { speaker_1: 'Johnny' }, {});
    assert.equal(cleared.actionItems[0].owner, 'Speaker 1');
  });

  test('swapping two names in one save does not cascade', () => {
    const base = { tldr: ['Ann spoke to Bob.'], actionItems: [{ owner: 'Ann' }, { owner: 'Bob' }] };
    const out = svc.applyRenamesToSummary(base, { speaker_1: 'Ann', speaker_2: 'Bob' }, { speaker_1: 'Bob', speaker_2: 'Ann' });
    assert.equal(out.tldr[0], 'Bob spoke to Ann.');
    assert.deepEqual(out.actionItems.map((a) => a.owner), ['Bob', 'Ann']);
  });

  test('no change → the same object back; the input is never mutated', () => {
    const n = notes();
    assert.equal(svc.applyRenamesToSummary(n, {}, {}), n);
    const before = JSON.stringify(n);
    svc.applyRenamesToSummary(n, {}, { speaker_1: 'John' });
    assert.equal(JSON.stringify(n), before);
  });
});
