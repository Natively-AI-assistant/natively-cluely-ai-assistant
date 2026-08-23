// src/lib/onboarding/__tests__/persistence.test.mjs
//
// Unit tests for the persistence layer. Polyfills localStorage/performance
// since this runs under `node --test`, not a browser.
//
// Run with: node --test src/lib/onboarding/__tests__/*.test.mjs
//
// These tests are intentionally minimal — they verify the legacy-key migration
// (the most subtle piece) and basic save/load round-trips. The orchestrator's
// decision engine is tested separately in orchestrator.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill localStorage for Node test runner (Node 22+ has built-in but
// requires --localstorage-file=... CLI flag; this polyfill makes the suite
// runnable with bare `node --test`).
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
}

import {
  loadState,
  saveState,
  buildDefaultState,
  _clearAllForTests,
} from '../persistence.mjs';

const LEGACY = {
  permsShown:           'natively_perms_shown_v1',
  seenModesOnboarding:  'natively_seen_modes_onboarding_v5',
  seenProfileOnboarding:'natively_seen_profile_onboarding_v1',
  launchCount:          'natively_launch_count_v2.7',
  appOpensCount:        'natively_app_opens_count',
  trialPromoTs:         'natively_trial_promo_ts',
  adsHistory:           'natively_ads_shown_history',
};

function clearAll() {
  for (const key of Object.values(LEGACY)) {
    try { localStorage.removeItem(key); } catch {}
  }
  _clearAllForTests();
}

// ─── Tests ─────────────────────────────────────────────────────────

test('loadState returns defaults when storage is empty', () => {
  clearAll();
  const state = loadState();
  assert.equal(state.startupCount, 0);
  assert.equal(state.totalUsageMs, 0);
  assert.equal(state.turnCount, 0);
  assert.equal(state.activeToasterId, null);
  assert.deepEqual(state.completed, {});
  assert.equal(state.skipped.size, 0);
  assert.equal(state.queue.length, 0);
});

test('saveState then loadState round-trips correctly', () => {
  clearAll();
  const original = buildDefaultState();
  original.startupCount = 7;
  original.turnCount = 3;
  original.totalUsageMs = 600_000;
  // activeToasterId is null on a clean round-trip (a non-null value would
  // be cleared by crash recovery). Test the round-trip without it set.
  original.completed['permissions'] = 1_700_000_000_000;
  original.skipped.add('support');
  original.queue = ['browser_extension', 'profile_intelligence'];

  saveState(original);
  const loaded = loadState();

  assert.equal(loaded.startupCount, 7);
  assert.equal(loaded.turnCount, 3);
  assert.equal(loaded.totalUsageMs, 600_000);
  assert.equal(loaded.activeToasterId, null);
  assert.equal(loaded.completed['permissions'], 1_700_000_000_000);
  assert.ok(loaded.skipped.has('support'));
  assert.deepEqual(loaded.queue, ['browser_extension', 'profile_intelligence']);
});

test('hydrates completed.permissions from natively_perms_shown_v1', () => {
  clearAll();
  localStorage.setItem(LEGACY.permsShown, '1');
  const state = loadState();
  assert.ok(state.completed['permissions'], 'expected permissions in completed log');
  assert.ok(typeof state.completed['permissions'] === 'number');
});

test('hydrates completed.modes_manager from natively_seen_modes_onboarding_v5', () => {
  clearAll();
  localStorage.setItem(LEGACY.seenModesOnboarding, 'true');
  const state = loadState();
  assert.ok(state.completed['modes_manager'], 'expected modes_manager in completed');
});

test('hydrates completed.profile_intelligence from natively_seen_profile_onboarding_v1', () => {
  clearAll();
  localStorage.setItem(LEGACY.seenProfileOnboarding, 'true');
  const state = loadState();
  assert.ok(state.completed['profile_intelligence']);
});

test('migrates dead natively_trial_promo_ts to completed.trial_promo', () => {
  clearAll();
  const legacyTs = 1_700_000_000_000;
  localStorage.setItem(LEGACY.trialPromoTs, legacyTs.toString());
  const state = loadState();
  assert.equal(state.completed['trial_promo'], legacyTs);
});

test('hydrates startupCount as max of legacy launch + app opens counters', () => {
  clearAll();
  localStorage.setItem(LEGACY.launchCount, '12');
  localStorage.setItem(LEGACY.appOpensCount, '5');
  const state = loadState();
  assert.equal(state.startupCount, 12);

  localStorage.setItem(LEGACY.launchCount, '8');
  localStorage.setItem(LEGACY.appOpensCount, '15');
  const state2 = loadState();
  assert.equal(state2.startupCount, 15);
});

test('hydrates ad-history into lastShownTimes', () => {
  clearAll();
  const adHistory = ['promo', 'profile', 'jd'];
  localStorage.setItem(LEGACY.adsHistory, JSON.stringify(adHistory));
  const state = loadState();
  assert.ok(state.lastShownTimes['promo']);
  assert.ok(state.lastShownTimes['profile']);
  assert.ok(state.lastShownTimes['jd']);
});

test('handles malformed ad history gracefully', () => {
  clearAll();
  localStorage.setItem(LEGACY.adsHistory, 'not-valid-json{');
  // Should not throw
  const state = loadState();
  assert.deepEqual(state.lastShownTimes, {});
});

test('Skipped Set survives round-trip via Array', () => {
  clearAll();
  const original = buildDefaultState();
  original.skipped.add('a');
  original.skipped.add('b');
  original.skipped.add('c');
  saveState(original);

  const loaded = loadState();
  assert.ok(loaded.skipped.has('a'));
  assert.ok(loaded.skipped.has('b'));
  assert.ok(loaded.skipped.has('c'));
});

test('multiple legacy keys hydrate together', () => {
  clearAll();
  localStorage.setItem(LEGACY.permsShown, '1');
  localStorage.setItem(LEGACY.seenModesOnboarding, 'true');
  localStorage.setItem(LEGACY.seenProfileOnboarding, 'true');
  localStorage.setItem(LEGACY.launchCount, '4');
  localStorage.setItem(LEGACY.trialPromoTs, '1700000000000');

  const state = loadState();
  assert.ok(state.completed['permissions']);
  assert.ok(state.completed['modes_manager']);
  assert.ok(state.completed['profile_intelligence']);
  assert.ok(state.completed['trial_promo']);
  assert.equal(state.startupCount, 4);
});

test('crash recovery: stale activeToasterId is auto-completed and cleared', () => {
  clearAll();
  // Simulate a previous session that crashed while showing 'permissions'
  const prior = buildDefaultState();
  prior.activeToasterId = 'permissions';
  prior.startupCount = 2;
  saveState(prior);

  const recovered = loadState();
  assert.equal(recovered.activeToasterId, null, 'stale active should be cleared');
  assert.ok(recovered.completed['permissions'], 'stale active should be auto-completed');
  // startupCount preserved
  assert.equal(recovered.startupCount, 2);
});

test('crash recovery: queue + other completed entries preserved', () => {
  clearAll();
  const prior = buildDefaultState();
  prior.activeToasterId = 'browser_extension';
  prior.completed['permissions'] = 1_700_000_000_000;
  prior.queue = ['profile_intelligence', 'modes_manager', 'trial_promo'];
  saveState(prior);

  const recovered = loadState();
  assert.equal(recovered.activeToasterId, null);
  assert.ok(recovered.completed['permissions']);
  assert.ok(recovered.completed['browser_extension']);
  assert.deepEqual(recovered.queue, ['profile_intelligence', 'modes_manager', 'trial_promo']);
});