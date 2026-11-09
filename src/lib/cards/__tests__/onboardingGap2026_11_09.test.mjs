// L4 (2026-11-09): onboarding cards come at least 24 h apart, across launches.
// Promotional cards keep their own rules (day one, the 72 h budget) and are not
// held by it.
//
// Run: node --test src/lib/cards/__tests__/onboardingGap2026_11_09.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLedger, applyOutcome, msUntilCardAllowed, lastOnboardingShownAt, ONBOARDING_GAP_MS, DAY_MS, PROMO_BUDGET_MS,
} from '../cardPolicy.mjs';

const NOW = 1_800_000_000_000;
const H = 3_600_000;
const mature = () => emptyLedger(NOW - 10 * DAY_MS);

test('the gap is 24 hours', () => {
  assert.equal(ONBOARDING_GAP_MS, DAY_MS);
});

test('lastOnboardingShownAt: the latest onboarding showing, promos ignored', () => {
  let l = mature();
  assert.equal(lastOnboardingShownAt(l), null);
  l = applyOutcome(l, 'plans', 'shown', NOW - 30 * H);
  l = applyOutcome(l, 'demo_video', 'shown', NOW - 5 * H);
  l = applyOutcome(l, 'profile_ad', 'shown', NOW - 1 * H);
  assert.equal(lastOnboardingShownAt(l), NOW - 5 * H);
});

test('an onboarding card waits 24 h after the last onboarding card, whichever it was', () => {
  const l = applyOutcome(mature(), 'plans', 'shown', NOW - 5 * H);
  assert.equal(msUntilCardAllowed(l, 'demo_video', NOW), 19 * H);
  assert.equal(msUntilCardAllowed(l, 'browser_extension', NOW), 19 * H);
  assert.equal(msUntilCardAllowed(l, 'demo_video', NOW + 19 * H), 0);
});

test('with no onboarding card shown yet, an onboarding card may show now (day one included)', () => {
  assert.equal(msUntilCardAllowed(emptyLedger(NOW), 'plans', NOW), 0);
});

test('a promo is not held by the onboarding gap', () => {
  const l = applyOutcome(mature(), 'plans', 'shown', NOW - 1 * H);
  assert.equal(msUntilCardAllowed(l, 'profile_ad', NOW), 0);
});

test('a promo does not start the onboarding gap; the promo budget still holds', () => {
  const l = applyOutcome(mature(), 'profile_ad', 'shown', NOW - 1 * H);
  assert.equal(msUntilCardAllowed(l, 'plans', NOW), 0);
  assert.equal(msUntilCardAllowed(l, 'jd_ad', NOW), PROMO_BUDGET_MS - H);
});

test('a strike wait longer than the gap still wins', () => {
  let l = applyOutcome(mature(), 'demo_video', 'shown', NOW - 1 * H);
  l = applyOutcome(l, 'demo_video', 'later', NOW - 1 * H);
  assert.equal(msUntilCardAllowed(l, 'demo_video', NOW), 7 * DAY_MS - H);
});

test('a clock set backwards only delays', () => {
  const l = applyOutcome(mature(), 'plans', 'shown', NOW + 2 * H);
  assert.equal(msUntilCardAllowed(l, 'demo_video', NOW), 26 * H);
});
