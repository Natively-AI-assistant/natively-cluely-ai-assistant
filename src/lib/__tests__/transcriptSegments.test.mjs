import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TRANSCRIPT_FINAL_LIMIT,
  createInitialTranscriptState,
  transcriptSegmentsReducer,
} from '../transcriptSegments.mjs';

function transcriptEvent(speaker, text, final, timestamp) {
  return {
    type: 'transcript-event',
    event: { speaker, text, final, timestamp },
  };
}

test('partial updates are latest-wins per speaker while preserving their first identity and ordering fields', () => {
  let state = createInitialTranscriptState();

  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('interviewer', '  First   words  ', false, 10),
  );
  const firstPartial = state.partials.interviewer;

  assert.ok(firstPartial);
  assert.equal(firstPartial.text, 'First words');
  assert.equal(firstPartial.status, 'partial');
  assert.equal(state.nextSequence, 1);
  assert.equal(state.contentRevision, 1);
  assert.equal(state.commitRevision, 0);

  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('interviewer', 'Second words', false, 20),
  );

  assert.deepEqual(state.partials.interviewer, {
    ...firstPartial,
    text: 'Second words',
  });
  assert.equal(state.partials.user, null);
  assert.equal(state.nextSequence, 1);
  assert.equal(state.contentRevision, 2);
  assert.equal(state.commitRevision, 0);
});

test('a final reuses its same-speaker partial once and clears that partial', () => {
  let state = createInitialTranscriptState();
  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('user', 'draft answer', false, 100),
  );
  const partial = state.partials.user;

  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('user', 'final answer', true, 150),
  );

  assert.deepEqual(state.finals, [
    {
      id: partial.id,
      speaker: 'user',
      text: 'final answer',
      status: 'final',
      timestamp: partial.timestamp,
      arrivalSequence: partial.arrivalSequence,
    },
  ]);
  assert.equal(state.partials.user, null);
  assert.equal(state.lastCommittedId, partial.id);
  assert.equal(state.nextSequence, 1);
  assert.equal(state.contentRevision, 2);
  assert.equal(state.commitRevision, 1);

  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('user', 'next answer', true, 160),
  );
  const nextFinal = state.finals.find(({ text }) => text === 'next answer');

  assert.ok(nextFinal);
  assert.notEqual(nextFinal.id, partial.id);
  assert.equal(nextFinal.timestamp, 160);
  assert.equal(nextFinal.arrivalSequence, 1);
});

test('a final without a partial uses its own timestamp', () => {
  const state = transcriptSegmentsReducer(
    createInitialTranscriptState(),
    transcriptEvent('interviewer', 'standalone final', true, 321),
  );

  assert.equal(state.finals.length, 1);
  assert.equal(state.finals[0].timestamp, 321);
  assert.equal(state.finals[0].arrivalSequence, 0);
  assert.equal(state.nextSequence, 1);
  assert.equal(state.contentRevision, 1);
  assert.equal(state.commitRevision, 1);
});

test('distinct repeated finals are preserved even when text and timestamps match', () => {
  let state = transcriptSegmentsReducer(
    createInitialTranscriptState(),
    transcriptEvent('interviewer', 'Sim', true, 1_000),
  );

  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('interviewer', '  sim  ', true, 1_000),
  );
  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('interviewer', 'SIM', true, 1_500),
  );

  assert.equal(state.finals.length, 3);
  assert.deepEqual(state.finals.map(({ text }) => text), ['Sim', 'sim', 'SIM']);
  assert.equal(state.contentRevision, 3);
  assert.equal(state.commitRevision, 3);
});

test('speaker channels keep independent partials and finals sort by timestamp then arrival sequence', () => {
  let state = createInitialTranscriptState();
  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('interviewer', 'interviewer draft', false, 20),
  );
  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('user', 'user draft', false, 10),
  );
  const userPartial = state.partials.user;

  assert.ok(state.partials.interviewer);
  assert.ok(userPartial);

  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('interviewer', 'interviewer final', true, 30),
  );
  assert.strictEqual(state.partials.user, userPartial);
  assert.equal(state.partials.interviewer, null);

  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('user', 'user final', true, 40),
  );
  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('interviewer', 'same timestamp final', true, 20),
  );

  assert.deepEqual(
    state.finals.map(({ text, timestamp, arrivalSequence }) => ({
      text,
      timestamp,
      arrivalSequence,
    })),
    [
      { text: 'user final', timestamp: 10, arrivalSequence: 1 },
      { text: 'interviewer final', timestamp: 20, arrivalSequence: 0 },
      { text: 'same timestamp final', timestamp: 20, arrivalSequence: 2 },
    ],
  );
});

test('invalid, empty, unknown-speaker, and non-finite events preserve state identity', () => {
  const state = transcriptSegmentsReducer(
    createInitialTranscriptState(),
    transcriptEvent('user', 'active words', false, 10),
  );
  const invalidActions = [
    transcriptEvent('user', '   ', false, 11),
    transcriptEvent('narrator', 'unknown speaker', false, 11),
    transcriptEvent('user', 'not a number', false, Number.NaN),
    transcriptEvent('user', 'positive infinity', false, Number.POSITIVE_INFINITY),
    transcriptEvent('user', 'negative infinity', false, Number.NEGATIVE_INFINITY),
    transcriptEvent('user', null, false, 11),
    transcriptEvent('user', 'not boolean', 'false', 11),
    { type: 'unknown' },
    null,
  ];

  for (const action of invalidActions) {
    assert.strictEqual(transcriptSegmentsReducer(state, action), state);
  }
});

test('finals retain the newest 100 while active partials remain intact', () => {
  assert.equal(TRANSCRIPT_FINAL_LIMIT, 100);

  let state = transcriptSegmentsReducer(
    createInitialTranscriptState(),
    transcriptEvent('user', 'still listening', false, 5_000),
  );
  const activePartial = state.partials.user;

  for (let index = 0; index <= TRANSCRIPT_FINAL_LIMIT; index += 1) {
    state = transcriptSegmentsReducer(
      state,
      transcriptEvent('interviewer', `Final ${index}`, true, index),
    );
  }

  assert.equal(state.finals.length, TRANSCRIPT_FINAL_LIMIT);
  assert.equal(state.finals[0].text, 'Final 1');
  assert.equal(state.finals.at(-1).text, 'Final 100');
  assert.strictEqual(state.partials.user, activePartial);
  assert.equal(state.nextSequence, 102);
  assert.equal(state.contentRevision, 102);
  assert.equal(state.commitRevision, 101);
  assert.equal(state.lastCommittedId, state.finals.at(-1).id);
});

test('reset returns a fresh initial state', () => {
  let state = transcriptSegmentsReducer(
    createInitialTranscriptState(),
    transcriptEvent('user', 'active partial', false, 10),
  );
  state = transcriptSegmentsReducer(
    state,
    transcriptEvent('interviewer', 'committed final', true, 20),
  );

  const resetState = transcriptSegmentsReducer(state, { type: 'reset' });
  const anotherInitialState = createInitialTranscriptState();

  assert.deepEqual(resetState, anotherInitialState);
  assert.notStrictEqual(resetState, anotherInitialState);
  assert.notStrictEqual(resetState.finals, anotherInitialState.finals);
  assert.notStrictEqual(resetState.partials, anotherInitialState.partials);
});
