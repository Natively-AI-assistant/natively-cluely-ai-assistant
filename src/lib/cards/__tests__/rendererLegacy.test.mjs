// The launcher's pre-ledger card history (toaster policy Phase 1, spec §8).
// Read from a fake storage; the result feeds migrateLegacy (cardPolicy.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectRendererLegacy } from '../rendererLegacy.mjs';

const T0 = Date.UTC(2026, 8, 1);
const D = 86_400_000;
const storageOf = (map) => ({ getItem: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null) });

test('empty storage gives an empty history', () => {
  assert.deepEqual(collectRendererLegacy(storageOf({})), {});
});

test('orchestrator stages become one known showing each, at their last show time', () => {
  const legacy = collectRendererLegacy(storageOf({
    natively_onboarding_state_v1: JSON.stringify({
      startupCount: 12,
      completed: { permissions: T0 - 40 * D, browser_extension: T0 - 30 * D, support: T0 - 5 * D },
      lastShownTimes: { browser_extension: T0 - 31 * D, support: T0 - 6 * D, review_prompt: T0 - 2 * D },
    }),
  }));
  assert.equal(legacy.startupCount, 12);
  assert.equal(legacy.firstSeenAt, T0 - 40 * D, 'the earliest timestamp bounds the first launch');
  assert.deepEqual(legacy.stageShows, {
    browser_extension: { count: 1, lastShownAt: T0 - 31 * D },
    support: { count: 1, lastShownAt: T0 - 6 * D },
    review_prompt: { count: 1, lastShownAt: T0 - 2 * D },
  });
});

test('ad showings map to their cards; Natively API covers both variants', () => {
  const legacy = collectRendererLegacy(storageOf({
    last_shown_time_natively_api: String(T0 - 3 * D),
    last_shown_time_profile: String(T0 - 9 * D),
    last_shown_time_max_ultra_upgrade: 'soon',
  }));
  assert.deepEqual(legacy.stageShows, {
    natively_api_new: { count: 1, lastShownAt: T0 - 3 * D },
    natively_api_existing: { count: 1, lastShownAt: T0 - 3 * D },
    profile_ad: { count: 1, lastShownAt: T0 - 9 * D },
  });
});

test('dismissed campaigns and the trial claim carry over', () => {
  const legacy = collectRendererLegacy(storageOf({
    natively_dismissed_campaigns: JSON.stringify(['natively_api', 42, 'jd']),
    natively_trial_claimed: 'true',
  }));
  assert.deepEqual(legacy.dismissedAds, ['natively_api', 'jd']);
  assert.equal(legacy.trialClaimed, true);
});

test('garbage values are ignored, the rest is kept', () => {
  const legacy = collectRendererLegacy(storageOf({
    natively_onboarding_state_v1: '{not json',
    natively_dismissed_campaigns: '"profile"',
    last_shown_time_jd: String(T0),
  }));
  assert.equal(legacy.dismissedAds, undefined);
  assert.equal(legacy.startupCount, undefined);
  assert.deepEqual(legacy.stageShows, { jd_ad: { count: 1, lastShownAt: T0 } });
});

test('a storage that throws gives an empty history', () => {
  assert.deepEqual(collectRendererLegacy({ getItem: () => { throw new Error('denied'); } }), {});
});
