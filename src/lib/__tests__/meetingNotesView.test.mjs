// Transcript turns and the quiet source-quality notes on the meeting-notes page
// (meetingNotesView.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { groupTranscriptTurns, isHiddenQualityNote, TURN_GAP_MS } = await import('../meetingNotesView.mjs');

const T0 = 1_790_000_000_000;
const line = (speaker, text, sec) => ({ speaker, text, timestamp: T0 + sec * 1000 });

test('turns: a speaker\'s consecutive fragments read as one paragraph', () => {
    const turns = groupTranscriptTurns([
        line('interviewer', 'So, um, the plan is', 13.4),
        line('interviewer', 'about twenty minutes of system design and then', 15.6),
        line('interviewer', 'twenty on a coding question in CoderPad.', 17.9),
        line('user', 'Sounds good.', 19.5),
    ]);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].text, 'So, um, the plan is about twenty minutes of system design and then twenty on a coding question in CoderPad.');
    assert.deepEqual([turns[0].first, turns[0].last], [0, 2]);
    assert.equal(turns[0].timestamp, T0 + 13_400);
    assert.deepEqual([turns[1].speaker, turns[1].first, turns[1].last], ['user', 3, 3]);
});

test('turns: a fragment that starts with an apostrophe continues the word before it', () => {
    const [turn] = groupTranscriptTurns([
        line('interviewer', 'It’s what we', 22.1),
        line('interviewer', '’ll share code in.', 24.3),
        line('interviewer', "'s fine", 25.0),
    ]);
    assert.equal(turn.text, 'It’s what we’ll share code in.\'s fine');
});

test('turns: never merged across the other speaker, even mid-sentence', () => {
    const turns = groupTranscriptTurns([
        line('interviewer', 'jump right into this interview. I', 19.8),
        line('user', 'Yeah, answer button is here.', 20.9),
        line('interviewer', "'m just curious: are you familiar with CoderPad?", 21.4),
    ]);
    assert.deepEqual(turns.map(t => t.speaker), ['interviewer', 'user', 'interviewer']);
    assert.equal(turns[2].text, "'m just curious: are you familiar with CoderPad?");
});

test('turns: a pause longer than the gap starts a new turn', () => {
    const turns = groupTranscriptTurns([
        line('user', 'First thought.', 0),
        line('user', 'Right after.', TURN_GAP_MS / 1000),
        line('user', 'After a long pause.', TURN_GAP_MS / 1000 * 2 + 1),
    ]);
    assert.deepEqual(turns.map(t => t.text), ['First thought. Right after.', 'After a long pause.']);
});

test('turns: blank fragments add nothing, missing timestamps still group', () => {
    const turns = groupTranscriptTurns([
        { speaker: 'user', text: '  ' },
        { speaker: 'user', text: 'Hello' },
        { speaker: 'user', text: '' },
        { speaker: 'user', text: 'there.' },
    ]);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].text, 'Hello there.');
    assert.deepEqual([turns[0].first, turns[0].last], [0, 3]);
    assert.deepEqual(groupTranscriptTurns([]), []);
});

test('quality notes: housekeeping, speaker-label quality and transcript gaps are not shown', () => {
    // TranscriptNormalizer's exact wording, both plural forms.
    assert.equal(isHiddenQualityNote('Removed 5 empty, duplicate, or interim transcript segments.'), true);
    assert.equal(isHiddenQualityNote('Excluded 11 AI-assistant turns from meeting-notes evidence.'), true);
    assert.equal(isHiddenQualityNote('Excluded 1 AI-assistant turn from meeting-notes evidence.'), true);
    assert.equal(isHiddenQualityNote('Speaker labels are incomplete or mixed; evidence may be less precise.'), true);
    assert.equal(isHiddenQualityNote('Speaker labels are low quality; verify owners and quotes before sharing.'), true);
    assert.equal(isHiddenQualityNote('Detected 1 long transcript gap; note coverage may be incomplete.'), true);
    assert.equal(isHiddenQualityNote('Detected 2 long transcript gaps; note coverage may be incomplete.'), true);
});

test('quality notes: anything else still shows', () => {
    assert.equal(isHiddenQualityNote('No summary atoms were produced; notes may be incomplete.'), false);
    assert.equal(isHiddenQualityNote('Rendered from a legacy summary format.'), false);
});
