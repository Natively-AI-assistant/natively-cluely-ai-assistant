// The stage catalog under the toaster policy (Phase 2,
// docs/superpowers/specs/2026-09-26-toaster-policy-design.md §3, §6).
//
// Order, card links and each card's eligibility predicate. The ledger rules
// (strikes, budget, day one, per-launch caps) are the orchestrator's and are
// pinned in orchestratorCardGates.test.mjs; here only "is this card relevant
// to this user at all".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STAGES } from '../stageCatalog.ts';
import { DEFAULT_USER_STATE } from '../orchestrator.ts';
import { emptyLedger, applyOutcome } from '../../cards/cardPolicy.mjs';

const byId = Object.fromEntries(STAGES.map((s) => [s.id, s]));
const NOW = Date.now();

function ctx(user = {}, counters = {}) {
  return {
    startupCount: 0, totalUsageMs: 0, turnCount: 0, homepageMountedFor: 0,
    appInForeground: true, homepageCurrentlyMounted: true, meetingActive: false,
    completed: {}, skipped: new Set(), lastShownTimes: {}, now: NOW,
    ...counters,
    userState: { ...DEFAULT_USER_STATE, cardLedger: emptyLedger(NOW), adsAvailable: true, ...user },
  };
}
const eligible = (id, user, counters) => byId[id].customPredicate(ctx(user, counters));

test('catalog order and card links', () => {
  assert.deepEqual(
    [...STAGES].sort((a, b) => a.order - b.order).map((s) => [s.id, s.order, s.card ?? null]),
    [
      ['permissions', 1, null],
      ['trial_promo', 2, 'trial_promo'],
      ['natively_api_new', 3, 'natively_api_new'],
      ['browser_extension', 4, 'browser_extension'],
      ['profile_intelligence', 5, null],
      ['modes_manager', 6, null],
      ['max_ultra', 10, 'max_ultra'],
      ['natively_api_existing', 11, 'natively_api_existing'],
      ['profile_ad', 12, 'profile_ad'],
      ['jd_ad', 13, 'jd_ad'],
      ['review_prompt', 14, 'review_prompt'],
      ['support', 15, 'support'],
    ],
  );
});

test('onboarding cards wait for permissions; promos wait for nothing', () => {
  for (const id of ['trial_promo', 'natively_api_new', 'browser_extension']) {
    assert.deepEqual(byId[id].requiresStages, ['permissions'], id);
  }
  for (const id of ['max_ultra', 'natively_api_existing', 'profile_ad', 'jd_ad', 'review_prompt', 'support']) {
    assert.equal(byId[id].requiresStages, undefined, id);
  }
});

test('every card stage decides eligibility by predicate, never by a persisted skip', () => {
  for (const s of STAGES.filter((x) => x.card)) {
    assert.equal(typeof s.customPredicate, 'function', s.id);
    assert.equal(s.skipWhen, undefined, s.id);
    assert.equal(s.cooldownMs, undefined, `${s.id}: waits come from the card ledger`);
  }
});

const table = (id, rows) => {
  for (const [name, user, counters, want] of rows) {
    test(`${id}: ${name} → ${want ? 'eligible' : 'not eligible'}`, () => {
      assert.equal(eligible(id, user, counters), want);
    });
  }
};

table('trial_promo', [
  ['no keys, nothing claimed', {}, {}, true],
  ['has a Natively key', { hasNativelyKey: true }, {}, false],
  ['has an own AI key', { hasOwnAiKey: true }, {}, false],
  ['paying', { isPremium: true }, {}, false],
  ['trial already claimed', { trialClaimed: true }, {}, false],
  ['trial running', { hasTrialToken: true }, {}, false],
]);

const trialRetired = applyOutcome(emptyLedger(NOW), 'trial_promo', 'never', NOW);
table('natively_api_new', [
  ['no keys, trial used', { trialClaimed: true }, {}, true],
  ['no keys, trial promo retired', { cardLedger: trialRetired }, {}, true],
  ['no keys, trial still on offer', {}, {}, false],
  ['own AI key', { trialClaimed: true, hasOwnAiKey: true }, {}, false],
  ['Natively key', { trialClaimed: true, hasNativelyKey: true }, {}, false],
  ['paying', { trialClaimed: true, isPremium: true }, {}, false],
  ['trial running', { trialClaimed: true, hasTrialToken: true }, {}, false],
]);

table('browser_extension', [
  ['not connected', {}, {}, true],
  ['connected', { extensionConnected: true }, {}, false],
  ['not supported', { extensionSupported: false }, {}, false],
]);

table('max_ultra', [
  ['Pro at 80 %', { planTier: 'pro', nativelyQuotaPct: 80 }, {}, true],
  ['Pro at 79 %', { planTier: 'pro', nativelyQuotaPct: 79 }, {}, false],
  ['free at 95 %', { planTier: 'free', nativelyQuotaPct: 95 }, {}, false],
  ['Max already', { planTier: 'max', nativelyQuotaPct: 95 }, {}, false],
  ['Pro at 90 % during a trial', { planTier: 'pro', nativelyQuotaPct: 90, hasTrialToken: true }, {}, false],
]);

table('natively_api_existing', [
  ['own keys, no Natively key', { hasOwnAiKey: true }, {}, true],
  ['already has a Natively key', { hasOwnAiKey: true, hasNativelyKey: true }, {}, false],
  ['no own keys', {}, {}, false],
  ['paying', { hasOwnAiKey: true, isPremium: true }, {}, false],
  ['during a trial', { hasOwnAiKey: true, hasTrialToken: true }, {}, false],
]);

table('profile_ad', [
  ['free, no profile', {}, {}, true],
  ['has a profile', { hasProfile: true }, {}, false],
  ['paying', { isPremium: true }, {}, false],
  ['during a trial', { hasTrialToken: true }, {}, false],
]);

table('jd_ad', [
  ['free, profile, no JD', { hasProfile: true }, {}, true],
  ['has a JD', { hasProfile: true, hasJD: true }, {}, false],
  ['no profile yet', {}, {}, false],
  ['paying', { hasProfile: true, isPremium: true }, {}, false],
]);

const launches = (n) => ({ ...emptyLedger(NOW), launchCount: n });
table('review_prompt', [
  ['3 launches', { cardLedger: launches(3) }, {}, true],
  ['2 launches, 30 min of use', { cardLedger: launches(2) }, { totalUsageMs: 30 * 60_000 }, true],
  ['2 launches, 29 min of use', { cardLedger: launches(2) }, { totalUsageMs: 29 * 60_000 }, false],
  ['during a trial', { cardLedger: launches(9), hasTrialToken: true }, {}, false],
  ['Ultra subscriber', { cardLedger: launches(9), planTier: 'ultra' }, {}, false],
]);

table('support', [
  ['10 AI questions', {}, { turnCount: 10 }, true],
  ['10 launches', { cardLedger: launches(10) }, {}, true],
  ['9 and 9', { cardLedger: launches(9) }, { turnCount: 9 }, false],
  ['paying', { isPremium: true }, { turnCount: 20 }, false],
]);

test('ad cards need the premium module; without it they never schedule', () => {
  const noPremium = { adsAvailable: false };
  assert.equal(eligible('natively_api_new', { ...noPremium, trialClaimed: true }), false);
  assert.equal(eligible('natively_api_existing', { ...noPremium, hasOwnAiKey: true }), false);
  assert.equal(eligible('profile_ad', noPremium), false);
  assert.equal(eligible('jd_ad', { ...noPremium, hasProfile: true }), false);
  assert.equal(eligible('max_ultra', { ...noPremium, planTier: 'pro', nativelyQuotaPct: 95 }), false);
  // Cards that live in this repo are unaffected.
  assert.equal(eligible('trial_promo', noPremium), true);
  assert.equal(eligible('browser_extension', noPremium), true);
});

test('ads default to unavailable until the app says otherwise', () => {
  assert.equal(DEFAULT_USER_STATE.adsAvailable, false);
});
