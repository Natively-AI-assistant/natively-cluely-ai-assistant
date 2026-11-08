// Issue #644: a "What to answer" stopped by the stall guard mid-answer read as
// finished. Main now sends `stopReason: 'stall_timeout'` with the final answer
// (IntelligenceEngine); the overlay maps it with ownStopFailure, like the
// output cap and repetition (ownStopNotice2026_10_04.test.mjs).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ownStopFailure, directAssistNoticeView, DIRECT_ASSIST_PHRASES } from '../directAssistFailure.mjs';
import { answerFailureCause } from '../funnel/answerFailure.mjs';
import { DIRECT_ASSIST_JA, DIRECT_ASSIST_RU } from '../../i18n.directAssist.ts';

describe('a stalled answer', () => {
  test('maps to its own stop code', () => {
    assert.deepEqual(ownStopFailure('stall_timeout'), { partial: true, code: 'OUTPUT_STALLED', provider: '' });
  });

  test('shows "Answer cut off" with the reason, and nothing to fix in AI Providers', () => {
    const v = directAssistNoticeView({ failure: ownStopFailure('stall_timeout'), ended: true });
    assert.equal(v.tone, 'cutoff');
    assert.equal(v.headline, 'Answer cut off');
    assert.deepEqual(v.rows, [{ text: 'The rest of it stopped arriving' }]);
    assert.equal(v.fixable, false);
  });

  test('the sentence is translated', () => {
    assert.ok(DIRECT_ASSIST_PHRASES.includes('The rest of it stopped arriving'));
    const ja = directAssistNoticeView({ failure: ownStopFailure('stall_timeout'), ended: true }, (s) => DIRECT_ASSIST_JA[s] ?? s);
    assert.equal(ja.rows[0].text, '続きが届かなくなりました');
    assert.equal(DIRECT_ASSIST_RU['The rest of it stopped arriving'], 'Продолжение ответа перестало приходить');
  });

  test('is a cut-short answer, not a failure to answer, for the funnel', () => {
    assert.equal(answerFailureCause(ownStopFailure('stall_timeout')), null);
  });

  test('a provider breaking off is still not reported through this path', () => {
    assert.equal(ownStopFailure('provider_failed_after_first_token'), null);
  });
});
