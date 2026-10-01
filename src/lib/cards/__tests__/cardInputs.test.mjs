// What the scheduler knows about the user, built from IPC reads (toaster
// policy Phase 2). Pure: App.tsx fetches, this maps. Each source is optional;
// a missing source leaves its fields out of the patch (never guessed).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardInputsFromSources, quotaPercent, quotaCycleEnd } from '../cardInputs.mjs';

test('no sources: an empty patch', () => {
  assert.deepEqual(cardInputsFromSources({}), {});
});

test('credentials: Natively key and own AI keys', () => {
  assert.deepEqual(cardInputsFromSources({ creds: { hasNativelyKey: true } }), { hasNativelyKey: true, hasOwnAiKey: false });
  for (const flag of ['hasGeminiKey', 'hasGroqKey', 'hasOpenaiKey', 'hasClaudeKey', 'hasDeepseekKey', 'hasNvidiaNimKey',
    'hasOpenrouterKey', 'hasFluxionKey', 'hasNinerouterKey', 'hasLitellmBaseURL']) {
    assert.equal(cardInputsFromSources({ creds: { [flag]: true } }).hasOwnAiKey, true, flag);
  }
  assert.equal(cardInputsFromSources({ creds: { hasDeepgramKey: true, hasSonioxKey: true } }).hasOwnAiKey, false, 'speech keys are not AI keys');
});

test('main\'s own-route answer wins (same rule as the Trial ended card: custom and cURL providers count)', () => {
  assert.equal(cardInputsFromSources({ creds: { hasOwnAiKey: true } }).hasOwnAiKey, true, 'a cURL provider alone');
  assert.equal(cardInputsFromSources({ creds: { hasOwnAiKey: false } }).hasOwnAiKey, false);
});

test('licence: premium and plan tier', () => {
  assert.deepEqual(cardInputsFromSources({ licence: { isPremium: false } }), { isPremium: false, planTier: 'free' });
  assert.equal(cardInputsFromSources({ licence: { isPremium: true, plan: 'pro' } }).planTier, 'pro');
  assert.equal(cardInputsFromSources({ licence: { isPremium: true, plan: 'Max' } }).planTier, 'max');
  assert.equal(cardInputsFromSources({ licence: { isPremium: true, plan: 'ultra' } }).planTier, 'ultra');
  assert.equal(cardInputsFromSources({ licence: { isPremium: true, plan: 'lifetime' } }).planTier, 'other');
  assert.equal(cardInputsFromSources({ licence: { isPremium: true } }).planTier, 'other');
});

test('profile: profile and job description', () => {
  assert.deepEqual(cardInputsFromSources({ profile: { hasProfile: true, jdFactsReady: true } }), { hasProfile: true, hasJD: true });
  assert.deepEqual(cardInputsFromSources({ profile: { hasProfile: true, jd_structured_extraction_complete: true } }), { hasProfile: true, hasJD: true });
  assert.deepEqual(cardInputsFromSources({ profile: { hasProfile: false } }), { hasProfile: false, hasJD: false });
});

test('trial: claimed and running', () => {
  assert.deepEqual(cardInputsFromSources({ trialLocal: { hasToken: false, trialClaimed: false } }), { trialClaimed: false, hasTrialToken: false });
  assert.deepEqual(cardInputsFromSources({ trialLocal: { hasToken: true, expired: false } }), { trialClaimed: true, hasTrialToken: true });
  assert.deepEqual(cardInputsFromSources({ trialLocal: { hasToken: true, expired: true } }), { trialClaimed: true, hasTrialToken: false });
  assert.deepEqual(cardInputsFromSources({ trialLocal: { hasToken: false, trialClaimed: true } }), { trialClaimed: true, hasTrialToken: false });
});

test('extension: connected or not', () => {
  assert.deepEqual(cardInputsFromSources({ extension: { extensionConnected: true } }), { extensionConnected: true });
  assert.deepEqual(cardInputsFromSources({ extension: {} }), { extensionConnected: false });
});

const meter = (used, limit) => ({ used, limit });
test('quotaPercent: the fullest metered meter; unmetered meters never count', () => {
  const quota = {
    ai: meter(80, 100), voice: meter(10, 100), research: meter(95, null),
    knowledge: { embedding: meter(900, 1000), reranker: meter(0, 0) },
  };
  assert.equal(quotaPercent({ ok: true, quota }), 90);
  assert.equal(quotaPercent({ ok: false }), 0);
  assert.equal(quotaPercent(undefined), 0);
});

test('usage feeds the quota percentage and the cycle end', () => {
  const usage = { ok: true, quota: { ai: meter(81, 100), resets_at: '2026-10-01T00:00:00.000Z' } };
  assert.deepEqual(cardInputsFromSources({ usage }), { nativelyQuotaPct: 81, nativelyQuotaResetsAt: Date.UTC(2026, 9, 1) });
  assert.deepEqual(cardInputsFromSources({ usage: { ok: false } }), { nativelyQuotaPct: 0, nativelyQuotaResetsAt: null });
});

test('quotaCycleEnd: the reset date as a timestamp, or undefined', () => {
  assert.equal(quotaCycleEnd({ ok: true, quota: { resets_at: '2026-10-01T00:00:00.000Z' } }), Date.UTC(2026, 9, 1));
  assert.equal(quotaCycleEnd({ ok: true, quota: { resets_at: 'soon' } }), undefined);
  assert.equal(quotaCycleEnd(undefined), undefined);
});

// Toaster policy Phase 3 (spec §6 row 18): the stored licence plan is never
// rewritten after a Pro → Max upgrade (the reconciler stops once premium is
// true), so a Max subscriber at 80 %+ still read as Pro and got the Max/Ultra
// upsell. The plan the Natively API reports with the usage is the fresh one.
test('planTier: the plan the usage reports wins over the stored licence plan', () => {
  const quota = { ai: meter(90, 100) };
  assert.equal(cardInputsFromSources({ licence: { isPremium: true, plan: 'pro' }, usage: { ok: true, plan: 'max', quota } }).planTier, 'max');
  assert.equal(cardInputsFromSources({ licence: { isPremium: true, plan: 'pro' }, usage: { ok: true, plan: 'Ultra', quota } }).planTier, 'ultra');
  assert.equal(cardInputsFromSources({ licence: { isPremium: true, plan: 'pro' }, usage: { ok: true, quota } }).planTier, 'pro', 'no usage plan: the licence');
  assert.equal(cardInputsFromSources({ licence: { isPremium: true, plan: 'pro' }, usage: { ok: false, plan: 'max' } }).planTier, 'pro', 'a failed usage read proves nothing');
  assert.equal(cardInputsFromSources({ licence: { isPremium: true, plan: 'lifetime' }, usage: { ok: true, plan: 'standard', quota } }).planTier, 'other');
  assert.equal(cardInputsFromSources({ licence: { isPremium: false }, usage: { ok: true, plan: 'max', quota } }).planTier, 'free', 'not paying: free, whatever the key says');
});
