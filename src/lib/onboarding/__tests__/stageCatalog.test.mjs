// src/lib/onboarding/__tests__/stageCatalog.test.mjs
//
// Decision-engine tests for the stage catalog. Validates each stage's
// shouldShowToaster behavior against fixture contexts.
//
// Run: node --test src/lib/onboarding/__tests__/stageCatalog.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldShowToaster } from '../orchestrator.mjs';
import { STAGES } from '../stageCatalog.mjs';

// ─── Fixtures ──────────────────────────────────────────────────────

const DEFAULT_USER_STATE = {
  isPremium: false,
  hasProfile: false,
  hasNativelyKey: false,
  hasTrialToken: false,
  extensionConnected: false,
  extensionSupported: true,
  permsShown: false,
  macTCCBlocked: false,
  seenProfileOnboarding: false,
  seenModesOnboarding: false,
  activeModeSet: false,
  donationShouldShow: false,
  isV2_8_OrNewer: true,
};

function makeCtx(overrides = {}) {
  return {
    startupCount: 0,
    totalUsageMs: 0,
    turnCount: 0,
    homepageMountedFor: 0,
    appInForeground: true,
    homepageCurrentlyMounted: true,
    meetingActive: false,
    userState: { ...DEFAULT_USER_STATE },
    completed: {},
    skipped: new Set(),
    lastShownTimes: {},
    now: Date.now(),
    ...overrides,
  };
}

const stageById = Object.fromEntries(STAGES.map((s) => [s.id, s]));

function show(id, ctx) {
  return shouldShowToaster(stageById[id], ctx);
}

// ─── Permissions ──────────────────────────────────────────────────

test('permissions: fires on first launch when perms not yet shown', () => {
  assert.equal(show('permissions', makeCtx({ homepageMountedFor: 3_000 })), true);
});

test('permissions: skipped when perms shown AND no TCC block', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, permsShown: true, macTCCBlocked: false },
    homepageMountedFor: 3_000,
  });
  assert.equal(show('permissions', ctx), false);
});

test('permissions: re-fires when mac TCC is blocked (returning user)', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, permsShown: true, macTCCBlocked: true },
    homepageMountedFor: 3_000,
  });
  assert.equal(show('permissions', ctx), true);
});

test('permissions: blocked by homepage duration < 2s', () => {
  assert.equal(show('permissions', makeCtx({ homepageMountedFor: 1_500 })), false);
});

// ─── Browser extension ────────────────────────────────────────────

test('browser_extension: skipped on linux (no extension support)', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, extensionSupported: false },
    completed: { permissions: 1 },
    homepageMountedFor: 6_000,
  });
  assert.equal(show('browser_extension', ctx), false);
});

test('browser_extension: skipped when extension already connected', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, extensionConnected: true },
    completed: { permissions: 1 },
    homepageMountedFor: 6_000,
  });
  assert.equal(show('browser_extension', ctx), false);
});

test('browser_extension: blocked by permissions prerequisite', () => {
  const ctx = makeCtx({ homepageMountedFor: 6_000 });
  assert.equal(show('browser_extension', ctx), false);
});

test('browser_extension: fires after permissions + 5s homepage + connected=false', () => {
  const ctx = makeCtx({
    completed: { permissions: 1 },
    homepageMountedFor: 6_000,
  });
  assert.equal(show('browser_extension', ctx), true);
});

// ─── Profile intelligence ─────────────────────────────────────────

test('profile_intelligence: skipped when hasProfile', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, hasProfile: true },
    completed: { permissions: 1, browser_extension: 2 },
    homepageMountedFor: 5_000,
  });
  assert.equal(show('profile_intelligence', ctx), false);
});

test('profile_intelligence: skipped when isPremium', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, isPremium: true },
    completed: { permissions: 1, browser_extension: 2 },
    homepageMountedFor: 5_000,
  });
  assert.equal(show('profile_intelligence', ctx), false);
});

test('profile_intelligence: blocked by missing browser_extension prerequisite', () => {
  const ctx = makeCtx({
    completed: { permissions: 1 },
    homepageMountedFor: 5_000,
  });
  assert.equal(show('profile_intelligence', ctx), false);
});

test('profile_intelligence: fires after prereqs + 4s homepage', () => {
  const ctx = makeCtx({
    completed: { permissions: 1, browser_extension: 2 },
    homepageMountedFor: 5_000,
  });
  assert.equal(show('profile_intelligence', ctx), true);
});

// ─── Modes manager ────────────────────────────────────────────────

test('modes_manager: skipped when seenModesOnboarding', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, seenModesOnboarding: true },
    completed: { permissions: 1, browser_extension: 2, profile_intelligence: 3 },
    homepageMountedFor: 5_000,
  });
  assert.equal(show('modes_manager', ctx), false);
});

test('modes_manager: skipped when activeModeSet', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, activeModeSet: true },
    completed: { permissions: 1, browser_extension: 2, profile_intelligence: 3 },
    homepageMountedFor: 5_000,
  });
  assert.equal(show('modes_manager', ctx), false);
});

// ─── Trial promo ──────────────────────────────────────────────────

test('trial_promo: skipped when hasNativelyKey', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, hasNativelyKey: true },
    completed: { permissions: 1, browser_extension: 2, profile_intelligence: 3, modes_manager: 4 },
    homepageMountedFor: 7_000,
  });
  assert.equal(show('trial_promo', ctx), false);
});

test('trial_promo: skipped when hasTrialToken', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, hasTrialToken: true },
    completed: { permissions: 1, browser_extension: 2, profile_intelligence: 3, modes_manager: 4 },
    homepageMountedFor: 7_000,
  });
  assert.equal(show('trial_promo', ctx), false);
});

test('trial_promo: skipped when isPremium', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, isPremium: true },
    completed: { permissions: 1, browser_extension: 2, profile_intelligence: 3, modes_manager: 4 },
    homepageMountedFor: 7_000,
  });
  assert.equal(show('trial_promo', ctx), false);
});

// ─── Support ──────────────────────────────────────────────────────

test('support: skipped when !donationShouldShow', () => {
  const ctx = makeCtx({
    completed: { quiet_window: 1 },
    turnCount: 15,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('support', ctx), false);
});

test('support: skipped when isPremium', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, isPremium: true, donationShouldShow: true },
    completed: { quiet_window: 1 },
    turnCount: 15,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('support', ctx), false);
});

test('support: requires quiet_window prerequisite', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, donationShouldShow: true },
    turnCount: 15,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('support', ctx), false);
});

test('support: requires turnCount >= 10', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, donationShouldShow: true },
    completed: { quiet_window: 1 },
    turnCount: 5,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('support', ctx), false);
});

test('support: fires with quiet_window + 10 turns + 10s homepage', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, donationShouldShow: true },
    completed: { quiet_window: 1 },
    turnCount: 15,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('support', ctx), true);
});

// ─── Ads ──────────────────────────────────────────────────────────

test('ads: requires startupCount >= 4', () => {
  const ctx = makeCtx({
    completed: { support: 1 },
    startupCount: 3,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('ads', ctx), false);
});

test('ads: requires support prerequisite', () => {
  const ctx = makeCtx({
    startupCount: 5,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('ads', ctx), false);
});

test('ads: skipped when isPremium', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, isPremium: true },
    completed: { support: 1 },
    startupCount: 5,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('ads', ctx), false);
});

// ─── Review prompt ────────────────────────────────────────────────

test('review_prompt: requires startupCount >= 6 AND totalUsageMs >= 45min', () => {
  const ctx = makeCtx({
    completed: { ads: 1 },
    startupCount: 6,
    totalUsageMs: 44 * 60 * 1000,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('review_prompt', ctx), false);
});

test('review_prompt: fires when both gates met', () => {
  const ctx = makeCtx({
    completed: { ads: 1 },
    startupCount: 6,
    totalUsageMs: 46 * 60 * 1000,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('review_prompt', ctx), true);
});

// ─── Backgrounding / meeting ──────────────────────────────────────

test('any stage with requiresMeetingInactive: blocked when meetingActive', () => {
  const ctx = makeCtx({
    meetingActive: true,
    homepageMountedFor: 5_000,
  });
  assert.equal(show('permissions', ctx), false);
  assert.equal(show('browser_extension', ctx), false);
});

test('any stage with requiresForeground: blocked when !appInForeground', () => {
  const ctx = makeCtx({
    appInForeground: false,
    homepageMountedFor: 5_000,
  });
  assert.equal(show('permissions', ctx), false);
});

// ─── Cooldown ─────────────────────────────────────────────────────

test('cooldown blocks re-fire within cooldown window', () => {
  const config = stageById['browser_extension'];
  const ctx = makeCtx({
    completed: { permissions: 1 },
    homepageMountedFor: 6_000,
    lastShownTimes: { browser_extension: Date.now() - 1000 }, // 1s ago
  });
  assert.equal(show('browser_extension', ctx), false);
});

test('cooldown allows re-fire after window elapses', () => {
  const config = stageById['browser_extension'];
  const ctx = makeCtx({
    completed: { permissions: 1 },
    homepageMountedFor: 6_000,
    lastShownTimes: { browser_extension: Date.now() - 8 * 24 * 60 * 60 * 1000 }, // 8 days ago
  });
  assert.equal(show('browser_extension', ctx), true);
});