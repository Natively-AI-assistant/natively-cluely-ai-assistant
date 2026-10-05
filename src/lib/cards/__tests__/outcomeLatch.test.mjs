// One showing, one outcome (toaster policy Phase 2). A card can fire several
// callbacks as it closes (a primary action, then the component's own close);
// only the first definite outcome of a showing may reach the ledger, and a
// showing that ends with no outcome (the app yanked it) records nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createShowingRecorder } from '../outcomeLatch.mjs';

function recorder() {
  const calls = [];
  return { calls, rec: createShowingRecorder((card, outcome, meta) => calls.push(meta ? [card, outcome, meta] : [card, outcome])) };
}

test('a showing records shown, then its first outcome only', () => {
  const { calls, rec } = recorder();
  rec.start('profile_ad');
  rec.outcome('acted');
  rec.outcome('later');
  assert.deepEqual(calls, [['profile_ad', 'shown'], ['profile_ad', 'acted']]);
});

test('a plain close is a "later"', () => {
  const { calls, rec } = recorder();
  rec.start('support');
  rec.outcome('later');
  assert.deepEqual(calls, [['support', 'shown'], ['support', 'later']]);
});

test('a showing that ends without an outcome records nothing more', () => {
  const { calls, rec } = recorder();
  rec.start('jd_ad');
  rec.end();
  rec.outcome('later');
  assert.deepEqual(calls, [['jd_ad', 'shown']]);
});

test('starting the same card again is not a second showing', () => {
  const { calls, rec } = recorder();
  rec.start('jd_ad');
  rec.start('jd_ad');
  assert.deepEqual(calls, [['jd_ad', 'shown']]);
});

test('a new card starts a new showing', () => {
  const { calls, rec } = recorder();
  rec.start('jd_ad');
  rec.outcome('never');
  rec.start('support');
  rec.outcome('later');
  assert.deepEqual(calls, [['jd_ad', 'shown'], ['jd_ad', 'never'], ['support', 'shown'], ['support', 'later']]);
});

test('an outcome with nothing showing is ignored', () => {
  const { calls, rec } = recorder();
  rec.outcome('acted');
  assert.deepEqual(calls, []);
});

test('meta travels with the outcome (Max/Ultra cycle end)', () => {
  const { calls, rec } = recorder();
  rec.start('max_ultra');
  rec.outcome('acted', { until: 123 });
  assert.deepEqual(calls[1], ['max_ultra', 'acted', { until: 123 }]);
});
