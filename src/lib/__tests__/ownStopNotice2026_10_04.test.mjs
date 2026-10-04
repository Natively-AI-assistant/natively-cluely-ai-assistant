// An answer Natively stopped itself says so (2026-10-04, owner's decision).
// Measured in the real app: a long typed answer stopped at the output cap,
// mid-line, and the overlay showed nothing — main sent `incomplete: true` with
// the reason and the renderer ignored it. The answer now carries the existing
// "Answer cut off" notice with the reason: the length limit, or repetition.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ownStopFailure, directAssistNoticeView, DIRECT_ASSIST_PHRASES } from '../directAssistFailure.mjs';
import { DIRECT_ASSIST_JA } from '../../i18n.directAssist.ts';

describe('ownStopFailure', () => {
  test('the output cap and repetition map to their own codes', () => {
    assert.deepEqual(ownStopFailure('output_cap_reached'), { partial: true, code: 'OUTPUT_LIMIT', provider: '' });
    assert.deepEqual(ownStopFailure('output_repetition'), { partial: true, code: 'OUTPUT_REPETITION', provider: '' });
  });
  test('any other reason is not reported here', () => {
    assert.equal(ownStopFailure('provider_failed_after_first_token'), null);
    assert.equal(ownStopFailure(undefined), null);
  });
});

describe('the notice for an answer Natively stopped', () => {
  test('length limit', () => {
    const v = directAssistNoticeView({ failure: ownStopFailure('output_cap_reached'), ended: true });
    assert.equal(v.tone, 'cutoff');
    assert.equal(v.headline, 'Answer cut off');
    assert.deepEqual(v.rows, [{ text: 'It reached the length limit' }]);
    assert.equal(v.fixable, false, 'nothing in AI Providers fixes it');
  });
  test('repetition', () => {
    const v = directAssistNoticeView({ failure: ownStopFailure('output_repetition'), ended: true });
    assert.deepEqual(v.rows, [{ text: 'It started repeating itself' }]);
  });
  test('the sentences are translated', () => {
    assert.ok(DIRECT_ASSIST_PHRASES.includes('It reached the length limit'));
    assert.ok(DIRECT_ASSIST_PHRASES.includes('It started repeating itself'));
    const t = (s) => DIRECT_ASSIST_JA[s] ?? s;
    const v = directAssistNoticeView({ failure: ownStopFailure('output_cap_reached'), ended: true }, t);
    assert.equal(v.rows[0].text, '長さの上限に達しました');
  });
});
