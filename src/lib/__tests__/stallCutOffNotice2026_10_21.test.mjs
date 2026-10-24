// An answer the inter-token stall deadline cut off says so (#644).
// Measured in the issue's log: a What to answer turn ended with
// terminationReason "stall_timeout" after 514 visible characters, mid code
// fence, and the overlay showed it as a finished answer. Main now sends
// stopReason "stall_timeout"; this is the notice the renderer shows for it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ownStopFailure, directAssistNoticeView, DIRECT_ASSIST_PHRASES } from '../directAssistFailure.mjs';
import { DIRECT_ASSIST_RU, DIRECT_ASSIST_ZH, DIRECT_ASSIST_JA, DIRECT_ASSIST_ES } from '../../i18n.directAssist.ts';

describe('a stalled answer', () => {
  test('stall_timeout maps to its own code', () => {
    assert.deepEqual(ownStopFailure('stall_timeout'), { partial: true, code: 'OUTPUT_STALLED', provider: '' });
  });
  test('it shows the cut-off notice with the reason', () => {
    const v = directAssistNoticeView({ failure: ownStopFailure('stall_timeout'), ended: true });
    assert.equal(v.tone, 'cutoff');
    assert.equal(v.headline, 'Answer cut off');
    assert.deepEqual(v.rows, [{ text: 'The answer stopped arriving' }]);
    assert.equal(v.fixable, false);
  });
  test('the sentence is translated in every table', () => {
    assert.ok(DIRECT_ASSIST_PHRASES.includes('The answer stopped arriving'));
    for (const table of [DIRECT_ASSIST_RU, DIRECT_ASSIST_ZH, DIRECT_ASSIST_JA, DIRECT_ASSIST_ES]) {
      assert.ok(table['The answer stopped arriving']);
    }
  });
});
