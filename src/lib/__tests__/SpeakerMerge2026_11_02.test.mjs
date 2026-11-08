// src/lib/__tests__/SpeakerMerge2026_11_02.test.mjs
//
// After a Resume, someone on the microphone who talks again comes back under a
// new number; the meeting page offers "Same as Lars?" and one click joins them
// (src/lib/speakerMerge.ts). Same name = one person on the Speakers row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinSpeakers, mergeOffers, renameSpeaker, speakerChips } from '../speakerMerge.ts';

const merges = [{ id: 'speaker_3', candidates: ['speaker_2'] }];

test('the new voice is offered the person from the first part; one click names it after them', () => {
    const labels = { speaker_2: 'Lars' };
    const chips = speakerChips(['me', 'speaker_2', 'speaker_3'], labels);
    assert.deepEqual(chips.map((c) => c.ids), [['me'], ['speaker_2'], ['speaker_3']]);
    const s3 = chips[2];
    assert.deepEqual(mergeOffers(s3, merges, labels), ['speaker_2']);
    const next = joinSpeakers(labels, s3, chips[1], 'Lars');
    assert.deepEqual(next, { speaker_2: 'Lars', speaker_3: 'Lars' });
    const after = speakerChips(['me', 'speaker_2', 'speaker_3'], next);
    assert.deepEqual(after.map((c) => c.ids), [['me'], ['speaker_2', 'speaker_3']], 'one chip for Lars');
    assert.deepEqual(mergeOffers(after[1], merges, next), [], 'the offer is gone');
});

test('joining someone never named keeps them one person through a later rename', () => {
    const chips = speakerChips(['speaker_2', 'speaker_3'], {});
    const next = joinSpeakers({}, chips[1], chips[0], 'Speaker 2');
    assert.deepEqual(next, { speaker_2: 'Speaker 2', speaker_3: 'Speaker 2' });
    const one = speakerChips(['speaker_2', 'speaker_3'], next);
    assert.equal(one.length, 1);
    assert.deepEqual(renameSpeaker(next, one[0], 'Priya'), { speaker_2: 'Priya', speaker_3: 'Priya' });
    assert.deepEqual(renameSpeaker(next, one[0], '  '), {}, 'clearing the name clears both');
});

test('a voice the user named themselves is not offered anything; the user is never joined', () => {
    assert.deepEqual(mergeOffers({ id: 'speaker_3', ids: ['speaker_3'] }, merges, { speaker_3: 'Ana' }), []);
    assert.deepEqual(mergeOffers({ id: 'speaker_3', ids: ['speaker_3'] }, undefined, {}), []);
    assert.deepEqual(speakerChips(['me', 'speaker_2'], { me: 'Evin', speaker_2: 'evin' }).length, 2);
    assert.deepEqual(joinSpeakers({ a: 'x' }, { id: 'b', ids: ['b'] }, { id: 'a', ids: ['a'] }, ' '), { a: 'x' }, 'no name: no change');
});
