// What one What to answer press gave (2026-11-19). Pure: same on macOS and Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAnswerPress, answerPressProps, ANSWER_PRESS_KINDS } from '../answerPress.mjs';
import { FUNNEL_CATALOG } from '../funnelCatalog.mjs';

test('answered: text came back and an answer was recorded while the press ran', () => {
  assert.equal(classifyAnswerPress({ answersBefore: 3, answersAfter: 4, answer: 'x' }), 'answered');
});

test('an answer recorded by something else meanwhile (Auto Answer) never makes an empty or failed press an answer', () => {
  assert.equal(classifyAnswerPress({ answersBefore: 3, answersAfter: 4, answer: null }), 'empty');
  assert.equal(classifyAnswerPress({ answersBefore: 3, answersAfter: 4, answer: null, error: 'boom' }), 'failed');
  assert.equal(classifyAnswerPress({ answersBefore: 3, answersAfter: 4, threw: true }), 'failed');
});

test('text with no answer recorded is a message, not an answer', () => {
  assert.equal(classifyAnswerPress({ answersBefore: 3, answersAfter: 3, answer: 'Please configure your API Keys in Settings to use this feature.' }), 'message');
});

test('nothing back is empty; an error or a throw is failed', () => {
  assert.equal(classifyAnswerPress({ answersBefore: 0, answersAfter: 0, answer: null }), 'empty');
  assert.equal(classifyAnswerPress({ answer: '   ' }), 'empty');
  assert.equal(classifyAnswerPress({ answer: null, error: 'Invalid image path payload' }), 'failed');
  assert.equal(classifyAnswerPress({ threw: true }), 'failed');
  // Unknown counts never claim an answer.
  assert.equal(classifyAnswerPress({ answer: null }), 'empty');
});

test('props: nothing without a press; counts, waiting and the oldest wait in whole seconds', () => {
  const zero = { answered: 0, message: 0, empty: 0, failed: 0 };
  assert.deepEqual(answerPressProps(zero, [], 1_000), {});
  assert.deepEqual(answerPressProps({ ...zero, answered: 2, empty: 1 }, [], 1_000), {
    presses: 3, presses_answered: 2, presses_message: 0, presses_empty: 1, presses_failed: 0, presses_waiting: 0,
  });
  const p = answerPressProps(zero, [100_000, 60_000], 100_500);
  assert.equal(p.presses, 2);
  assert.equal(p.presses_waiting, 2);
  assert.equal(p.wait_secs, 40);
  assert.equal(answerPressProps(zero, [200], 100).wait_secs, 0, 'a clock step back is not a negative wait');
});

test('every field the props can carry is in the catalogue, as a count', () => {
  const ended = FUNNEL_CATALOG.meeting_ended;
  const all = answerPressProps({ answered: 1, message: 1, empty: 1, failed: 1 }, [0], 5_000);
  for (const k of Object.keys(all)) assert.equal(ended[k], 'int', k);
  assert.deepEqual([...ANSWER_PRESS_KINDS], ['answered', 'message', 'empty', 'failed']);
});
