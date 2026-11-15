// A live (What to Answer / Auto Answer) answer whose provider broke off after
// the first words says "Answer cut off" under the text (pipeline forensics
// 2026-11-13, F-ACC-01). Before, main reported it as complete and the overlay
// had no mapping for the reason even when it arrived.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { liveAnswerStopFailure, ownStopFailure, directAssistNoticeView } from '../directAssistFailure.mjs';
import { answerFailureCause } from '../funnel/answerFailure.mjs';

describe('liveAnswerStopFailure', () => {
  test('a provider breaking off mid-answer reads as cut off: the rest stopped arriving', () => {
    const f = liveAnswerStopFailure('provider_failed_after_first_token');
    assert.deepEqual(f, { partial: true, code: 'OUTPUT_STALLED', provider: '' });
    const v = directAssistNoticeView({ failure: f, ended: true });
    assert.equal(v.tone, 'cutoff');
    assert.equal(v.headline, 'Answer cut off');
    assert.deepEqual(v.rows, [{ text: 'The rest of it stopped arriving' }]);
    assert.equal(v.fixable, false);
  });

  test("Natively's own stops map exactly as ownStopFailure does", () => {
    for (const r of ['output_cap_reached', 'output_repetition', 'stall_timeout', undefined, null, 'other']) {
      assert.deepEqual(liveAnswerStopFailure(r), ownStopFailure(r));
    }
  });

  test('is a cut-short answer, not a failure to answer, for the funnel', () => {
    assert.equal(answerFailureCause(liveAnswerStopFailure('provider_failed_after_first_token')), null);
  });
});
