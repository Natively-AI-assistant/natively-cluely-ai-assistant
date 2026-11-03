// The trial's AI allowance, said and counted (2026-11-03).
//
// Three gaps left after the trial began ending with its allowance:
//  - Direct Assist read the refusal as "rate limited, try again";
//  - nothing warned before the answers stopped, only five minutes before the clock;
//  - trial_expired could not say which of the two ended a trial.
// These pin the renderer and catalogue halves; the main halves are pinned in
// electron/llm/__tests__/TrialAllowanceSignalsMain2026_11_03.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { directAssistNoticeView, directAssistFailureText } from '../directAssistFailure.mjs';
import { answerFailureCause } from '../funnel/answerFailure.mjs';
import { checkFunnelProps, TRIAL_END_REASONS } from '../funnel/funnelCatalog.mjs';

test('a Direct Assist trial or plan refusal reads as such, never as a rate limit', () => {
  const ended = { code: 'TRIAL_ENDED', message: 'Your free trial has ended.', retryable: false, provider: 'Natively API' };
  const view = directAssistNoticeView({ failure: ended, ended: true });
  assert.equal(view.headline, 'Your free trial has ended');
  assert.equal(view.fixable, false, 'AI Providers is not the fix');
  assert.equal(directAssistFailureText(ended), 'Your free trial has ended.');
  assert.equal(answerFailureCause(ended), 'trial_ended');

  const plan = { code: 'PLAN_LIMIT', message: "You've reached your Natively plan's limit.", retryable: false, provider: 'Natively API' };
  assert.equal(directAssistNoticeView({ failure: plan, ended: true }).headline, "You've reached your Natively plan's limit");
  assert.equal(answerFailureCause(plan), 'plan_limit');
});

test('a trial refusal on one rung of several reads as the trial, not as a rate limit', () => {
  const natively = { provider: 'Natively API', code: 'TRIAL_ENDED', status: 429, detail: 'Natively API stream HTTP 429', waitedMs: 300 };
  const openai = { provider: 'OpenAI', code: 'AUTH_FAILED', status: 401, waitedMs: 200 };
  // Natively first: its own sentence is the headline (unchanged path).
  const first = directAssistNoticeView({ failure: { code: 'TRIAL_ENDED', message: 'Your free trial has ended.', provider: 'Natively API', attempts: [natively, openai] }, ended: true });
  assert.equal(first.headline, 'Your free trial has ended');
  // Another provider first, Natively later on the ladder: Natively's row.
  const failed = directAssistNoticeView({ failure: { ...openai, message: 'The selected provider rejected its credentials.', attempts: [openai, natively] }, ended: true });
  assert.equal(failed.headline, 'None of your providers could answer');
  assert.deepEqual(failed.rows.map((r) => r.text), ['OpenAI rejected your key or sign-in', 'Your free trial has ended']);
  assert.equal(failed.fixable, true, 'the OpenAI key is still fixable');
  // A hop while the next provider is being asked.
  const trying = directAssistNoticeView({ fallbackNotice: { hops: [{ ...natively, code: 'PLAN_LIMIT', next: 'OpenAI' }] } });
  assert.deepEqual(trying.rows.map((r) => r.text), ["You've reached your Natively plan's limit"]);
  assert.equal(trying.fixable, false);
  assert.ok(!JSON.stringify([first, failed, trying]).includes('rate limiting'));
});

test('trial_expired and trial_notice carry what ended the trial (the server twin: funnelCatalogParity)', () => {
  assert.deepEqual([...TRIAL_END_REASONS], ['clock', 'allowance']);
  for (const check of [checkFunnelProps]) {
    assert.deepEqual(check('trial_expired', { reason: 'allowance' }), { ok: true, props: { reason: 'allowance' } });
    assert.deepEqual(check('trial_expired', { reason: 'clock' }), { ok: true, props: { reason: 'clock' } });
    assert.equal(check('trial_expired', {}).ok, true, 'older builds send none');
    assert.equal(check('trial_expired', { reason: 'server' }).ok, false);
    assert.equal(check('trial_notice', { state: 'ending', action: 'shown', reason: 'allowance' }).ok, true);
    assert.equal(check('trial_notice', { state: 'ended', action: 'plans', reason: 'clock' }).ok, true);
    assert.equal(check('trial_notice', { state: 'ended', action: 'plans', reason: 'tokens' }).ok, false);
  }
});
