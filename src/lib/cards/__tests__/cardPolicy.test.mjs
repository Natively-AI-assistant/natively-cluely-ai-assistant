// Card policy rules (toaster policy Phase 1,
// docs/superpowers/specs/2026-09-26-toaster-policy-design.md §2–§4, §8).
// Expected values are written out by hand; nothing here is computed by the
// module under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY_MS, CARDS, emptyLedger, entryOf, applyOutcome, isCardAvailable,
  promoBudgetOpen, dayOneOver, pickPromotional, migrateLegacy,
} from '../cardPolicy.mjs';

const T0 = Date.UTC(2026, 8, 1); // 2026-09-01
const D = 86_400_000;

test('DAY_MS is one day', () => assert.equal(DAY_MS, D));

test('card classes and priorities match the spec', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(CARDS).map(([id, c]) => [id, [c.cls, c.priority]])),
    {
      browser_extension: ['onboarding', null],
      trial_promo: ['onboarding', null],
      natively_api_new: ['onboarding', null],
      max_ultra: ['promo', 1],
      natively_api_existing: ['promo', 2],
      profile_ad: ['promo', 3],
      jd_ad: ['promo', 4],
      review_prompt: ['promo', 5],
      support: ['promo', 6],
    },
  );
});

test('a fresh ledger starts at the first launch with no cards', () => {
  assert.deepEqual(emptyLedger(T0), { version: 1, firstLaunchAt: T0, launchCount: 0, lastPromoShownAt: null, imported: {}, cards: {} });
});

test('entryOf gives defaults for a card never seen', () => {
  assert.deepEqual(entryOf(emptyLedger(T0), 'support'), {
    shows: 0, strikes: 0, nextEligibleAt: null, retired: false, retiredReason: null,
    retiredUntil: null, lastShownAt: null, followUpPending: false,
  });
});

// ── outcomes ─────────────────────────────────────────────────────────────
const after = (ledger, id, ...steps) => steps.reduce((l, [o, t, meta]) => applyOutcome(l, id, o, t, meta), ledger);

test('shown: counts the showing; a promo also spends the budget', () => {
  const l = after(emptyLedger(T0), 'support', ['shown', T0 + 5]);
  assert.equal(entryOf(l, 'support').shows, 1);
  assert.equal(entryOf(l, 'support').lastShownAt, T0 + 5);
  assert.equal(l.lastPromoShownAt, T0 + 5);
  const o = after(emptyLedger(T0), 'browser_extension', ['shown', T0 + 5]);
  assert.equal(o.lastPromoShownAt, null, 'onboarding cards do not spend the promo budget');
});

test('later: 1st waits 7 days, 2nd waits 21 days, 3rd retires', () => {
  let l = after(emptyLedger(T0), 'profile_ad', ['later', T0]);
  assert.equal(entryOf(l, 'profile_ad').strikes, 1);
  assert.equal(entryOf(l, 'profile_ad').nextEligibleAt, T0 + 7 * D);
  l = after(l, 'profile_ad', ['later', T0 + 10 * D]);
  assert.equal(entryOf(l, 'profile_ad').strikes, 2);
  assert.equal(entryOf(l, 'profile_ad').nextEligibleAt, T0 + 31 * D);
  l = after(l, 'profile_ad', ['later', T0 + 40 * D]);
  assert.equal(entryOf(l, 'profile_ad').strikes, 3);
  assert.equal(entryOf(l, 'profile_ad').retired, true);
  assert.equal(entryOf(l, 'profile_ad').retiredReason, 'strikes');
});

test('never retires at once', () => {
  const l = after(emptyLedger(T0), 'review_prompt', ['never', T0]);
  assert.equal(entryOf(l, 'review_prompt').retired, true);
  assert.equal(entryOf(l, 'review_prompt').retiredReason, 'never');
});

test('acted retires a generic card', () => {
  const l = after(emptyLedger(T0), 'support', ['acted', T0]);
  assert.equal(entryOf(l, 'support').retired, true);
  assert.equal(entryOf(l, 'support').retiredReason, 'acted');
});

test('browser extension: acted gets one follow-up after 7 days, then retires', () => {
  let l = after(emptyLedger(T0), 'browser_extension', ['acted', T0]);
  assert.equal(entryOf(l, 'browser_extension').retired, false);
  assert.equal(entryOf(l, 'browser_extension').followUpPending, true);
  assert.equal(entryOf(l, 'browser_extension').nextEligibleAt, T0 + 7 * D);
  const viaLater = after(l, 'browser_extension', ['later', T0 + 8 * D]);
  assert.equal(entryOf(viaLater, 'browser_extension').retired, true);
  assert.equal(entryOf(viaLater, 'browser_extension').retiredReason, 'acted');
  const viaActed = after(l, 'browser_extension', ['acted', T0 + 8 * D]);
  assert.equal(entryOf(viaActed, 'browser_extension').retired, true);
});

test('max/ultra: acted retires until the given cycle end', () => {
  const l = after(emptyLedger(T0), 'max_ultra', ['acted', T0, { until: T0 + 20 * D }]);
  assert.equal(entryOf(l, 'max_ultra').retired, false);
  assert.equal(entryOf(l, 'max_ultra').retiredUntil, T0 + 20 * D);
  assert.equal(isCardAvailable(l, 'max_ultra', T0 + 19 * D), false);
  assert.equal(isCardAvailable(l, 'max_ultra', T0 + 20 * D), true);
});

test('interrupted changes nothing', () => {
  const l0 = after(emptyLedger(T0), 'jd_ad', ['shown', T0]);
  assert.deepEqual(applyOutcome(l0, 'jd_ad', 'interrupted', T0 + 1), l0);
});

test('applyOutcome does not mutate its input', () => {
  const l0 = emptyLedger(T0);
  applyOutcome(l0, 'support', 'later', T0);
  assert.deepEqual(l0, emptyLedger(T0));
});

test('an unknown card or outcome is rejected', () => {
  assert.throws(() => applyOutcome(emptyLedger(T0), 'nope', 'later', T0), /unknown card/);
  assert.throws(() => applyOutcome(emptyLedger(T0), 'support', 'meh', T0), /unknown outcome/);
});

// ── availability, budget, day one, priority ──────────────────────────────
test('isCardAvailable honours retirement and the waiting period', () => {
  const l = after(emptyLedger(T0), 'jd_ad', ['later', T0]);
  assert.equal(isCardAvailable(l, 'jd_ad', T0 + 7 * D - 1), false);
  assert.equal(isCardAvailable(l, 'jd_ad', T0 + 7 * D), true);
  assert.equal(isCardAvailable(after(l, 'jd_ad', ['never', T0]), 'jd_ad', T0 + 99 * D), false);
});

test('promo budget: one per 72 hours; a clock set backwards only delays', () => {
  const l = after(emptyLedger(T0), 'support', ['shown', T0 + 10 * D]);
  assert.equal(promoBudgetOpen(emptyLedger(T0), T0), true);
  assert.equal(promoBudgetOpen(l, T0 + 13 * D - 1), false);
  assert.equal(promoBudgetOpen(l, T0 + 13 * D), true);
  assert.equal(promoBudgetOpen(l, T0 + 5 * D), false, 'now before the last show (clock moved back)');
});

test('day one: promos wait 24 hours after the first launch', () => {
  assert.equal(dayOneOver(emptyLedger(T0), T0 + D - 1), false);
  assert.equal(dayOneOver(emptyLedger(T0), T0 + D), true);
});

test('pickPromotional takes the highest priority available promo', () => {
  const now = T0 + 5 * D;
  const all = ['support', 'jd_ad', 'max_ultra', 'profile_ad', 'browser_extension'];
  assert.equal(pickPromotional(all, emptyLedger(T0), now), 'max_ultra');
  const ultraWaiting = after(emptyLedger(T0), 'max_ultra', ['later', now - D]);
  assert.equal(pickPromotional(all, ultraWaiting, now), 'profile_ad');
  assert.equal(pickPromotional(['browser_extension'], emptyLedger(T0), now), null, 'onboarding cards are not promos');
});

test('pickPromotional returns null on day one or with the budget spent', () => {
  assert.equal(pickPromotional(['support'], emptyLedger(T0), T0 + 1000), null, 'day one');
  const spent = after(emptyLedger(T0), 'jd_ad', ['shown', T0 + 4 * D]);
  assert.equal(pickPromotional(['support'], spent, T0 + 5 * D), null, 'budget spent 1 day ago');
});

// ── legacy migration ─────────────────────────────────────────────────────
test('migration retires what users already answered', () => {
  const l = migrateLegacy(emptyLedger(T0), {
    reviewed: true, donated: true, trialClaimed: true, dismissedAds: ['natively_api', 'jd'],
  }, T0);
  for (const id of ['review_prompt', 'support', 'trial_promo', 'natively_api_new', 'natively_api_existing', 'jd_ad']) {
    assert.equal(entryOf(l, id).retired, true, id);
    assert.equal(entryOf(l, id).retiredReason, 'migrated', id);
  }
  assert.equal(entryOf(l, 'profile_ad').retired, false);
});

test('migration: review "never" also retires the review prompt', () => {
  assert.equal(entryOf(migrateLegacy(emptyLedger(T0), { reviewNever: true }, T0), 'review_prompt').retired, true);
});

test('migration: past showings become strikes, capped at 2, with the matching wait', () => {
  const l = migrateLegacy(emptyLedger(T0), {
    stageShows: { browser_extension: { count: 5, lastShownAt: T0 - 3 * D }, support: { count: 1, lastShownAt: T0 - D } },
  }, T0);
  assert.equal(entryOf(l, 'browser_extension').strikes, 2);
  assert.equal(entryOf(l, 'browser_extension').nextEligibleAt, T0 - 3 * D + 21 * D);
  assert.equal(entryOf(l, 'support').strikes, 1);
  assert.equal(entryOf(l, 'support').nextEligibleAt, T0 - D + 7 * D);
});

test('migration: donation showings count as support strikes', () => {
  const l = migrateLegacy(emptyLedger(T0), { donationShows: 4, donationLastShownAt: T0 - 2 * D }, T0);
  assert.equal(entryOf(l, 'support').strikes, 2);
  assert.equal(entryOf(l, 'support').nextEligibleAt, T0 - 2 * D + 21 * D);
});

test('migration: first launch and launch count take the earliest and the largest', () => {
  const l = migrateLegacy({ ...emptyLedger(T0), launchCount: 2 }, { firstSeenAt: T0 - 30 * D, startupCount: 9 }, T0);
  assert.equal(l.firstLaunchAt, T0 - 30 * D);
  assert.equal(l.launchCount, 9);
});

test('migration never overwrites real ledger data', () => {
  const real = after(emptyLedger(T0), 'support', ['later', T0]);
  const l = migrateLegacy(real, { stageShows: { support: { count: 2, lastShownAt: T0 - 50 * D } } }, T0);
  assert.equal(entryOf(l, 'support').strikes, 1);
  assert.equal(entryOf(l, 'support').nextEligibleAt, T0 + 7 * D);
});

test('migration ignores garbage fields and keeps the rest', () => {
  const l = migrateLegacy(emptyLedger(T0), {
    dismissedAds: 'jd', stageShows: { support: { count: 'x', lastShownAt: 'y' }, nope: { count: 3, lastShownAt: T0 } },
    firstSeenAt: 'yesterday', startupCount: -4, reviewed: true,
  }, T0);
  assert.equal(entryOf(l, 'jd_ad').retired, false);
  assert.equal(entryOf(l, 'support').strikes, 0);
  assert.equal(l.cards.nope, undefined);
  assert.equal(l.firstLaunchAt, T0);
  assert.equal(l.launchCount, 0);
  assert.equal(entryOf(l, 'review_prompt').retired, true);
});
