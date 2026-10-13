import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { groupWordsBySpeaker } from '../../audio/diarizedTranscript.ts';

describe('groupWordsBySpeaker', () => {
  test('groups contiguous words by speaker', () => {
    const words = [
      { word: 'Hello', speaker: 0 },
      { word: 'there', speaker: 0 },
      { word: 'Hi', speaker: 1 },
      { word: 'back', speaker: 1 },
    ];
    const segments = groupWordsBySpeaker(words, 'speaker');
    assert.equal(segments.length, 2);
    assert.equal(segments[0].speaker, 0);
    assert.equal(segments[0].text, 'Hello there');
    assert.equal(segments[1].speaker, 1);
    assert.equal(segments[1].text, 'Hi back');
  });

  test('uses speakerTag field when requested', () => {
    const words = [
      { word: 'One', speakerTag: 1 },
      { word: 'Two', speakerTag: 0 },
    ];
    const segments = groupWordsBySpeaker(words, 'speakerTag');
    assert.equal(segments.length, 2);
    assert.equal(segments[0].text, 'One');
    assert.equal(segments[0].speaker, 1);
    assert.equal(segments[1].text, 'Two');
    assert.equal(segments[1].speaker, 0);
  });

  test('prefers punctuated_word when present', () => {
    const words = [{ punctuated_word: 'Hello,', speaker: 0 }];
    const segments = groupWordsBySpeaker(words, 'speaker');
    assert.equal(segments[0].text, 'Hello,');
  });
});
