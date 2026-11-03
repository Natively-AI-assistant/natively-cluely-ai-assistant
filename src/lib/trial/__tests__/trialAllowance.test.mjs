import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldEndTrialForUsedAllowance, TRIAL_AI_ALLOWANCE_CODE } from '../trialAllowance.mjs';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const live = {
  code: 'ai_quota_exceeded',
  onTrial: true,
  hasTrialToken: true,
  holdsTrialKey: true,
  expiresAt: '2026-11-03T12:11:00Z',
  now: NOW,
};

test("the trial's AI allowance running out ends a live trial", () => {
  assert.equal(TRIAL_AI_ALLOWANCE_CODE, 'ai_quota_exceeded');
  assert.equal(shouldEndTrialForUsedAllowance(live), true);
});

test('another allowance does not end the trial', () => {
  for (const code of ['search_quota_exceeded', 'embedding_quota_exceeded', 'transcription_quota_exceeded', 'rate_limit', '', undefined]) {
    assert.equal(shouldEndTrialForUsedAllowance({ ...live, code }), false, String(code));
  }
});

test("a paid key's limit, a trial no longer held, or one already over is left alone", () => {
  assert.equal(shouldEndTrialForUsedAllowance({ ...live, onTrial: false }), false, 'refused on a paid key');
  assert.equal(shouldEndTrialForUsedAllowance({ ...live, hasTrialToken: false }), false, 'no token');
  assert.equal(shouldEndTrialForUsedAllowance({ ...live, holdsTrialKey: false }), false, 'a real key replaced the trial');
  assert.equal(shouldEndTrialForUsedAllowance({ ...live, expiresAt: '2026-11-03T12:00:00Z' }), false, 'ends exactly now');
  assert.equal(shouldEndTrialForUsedAllowance({ ...live, expiresAt: '2026-11-03T11:00:00Z' }), false, 'already over');
  assert.equal(shouldEndTrialForUsedAllowance({ ...live, expiresAt: null }), false, 'no expiry on record');
  assert.equal(shouldEndTrialForUsedAllowance({ ...live, expiresAt: 'not a date' }), false);
  assert.equal(shouldEndTrialForUsedAllowance(null), false);
  assert.equal(shouldEndTrialForUsedAllowance(undefined), false);
});

test('the allowance is low in its last quarter, and never guessed', async () => {
  const { isTrialAllowanceLow, TRIAL_ALLOWANCE_LOW_SHARE } = await import('../trialAllowance.mjs');
  assert.equal(TRIAL_ALLOWANCE_LOW_SHARE, 0.25);
  assert.equal(isTrialAllowanceLow({ used: 0, limit: 60_000 }), false);
  assert.equal(isTrialAllowanceLow({ used: 44_999, limit: 60_000 }), false, 'just over a quarter left');
  assert.equal(isTrialAllowanceLow({ used: 45_000, limit: 60_000 }), true, 'a quarter left');
  assert.equal(isTrialAllowanceLow({ used: 59_999, limit: 60_000 }), true);
  assert.equal(isTrialAllowanceLow({ used: 60_000, limit: 60_000 }), false, 'used up ends the trial; no warning');
  assert.equal(isTrialAllowanceLow({ used: 70_000, limit: 60_000 }), false);
  for (const bad of [null, undefined, {}, { used: 50_000 }, { limit: 60_000 }, { used: 'x', limit: 60_000 }, { used: 50_000, limit: 0 }, { used: -1, limit: 60_000 }, { used: null, limit: 60_000 }]) {
    assert.equal(isTrialAllowanceLow(bad), false, JSON.stringify(bad));
  }
});
