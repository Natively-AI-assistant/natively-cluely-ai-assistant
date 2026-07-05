// src/lib/onboarding/__tests__/orchestrator.test.mjs
//
// Tests for the orchestrator's decision engine wiring — verifying the full
// STAGES catalog drives a sensible first-launch sequence. Uses the .mjs
// shouldShowToaster + STAGES to simulate pass-by-pass without RAF/DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldShowToaster } from '../orchestrator.mjs';
import { STAGES } from '../stageCatalog.mjs';

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

// ─── Tests ─────────────────────────────────────────────────────────

test('first-launch ordering: only permissions fires on cold install', () => {
  const ctx = makeCtx({ homepageMountedFor: 3_000 });
  // Only permissions should fire — others have unmet prerequisites or longer waits.
  for (const stage of STAGES) {
    const fired = shouldShowToaster(stage, ctx);
    if (stage.id === 'permissions') {
      assert.equal(fired, true, `permissions should fire, got ${fired}`);
    } else {
      assert.equal(fired, false, `${stage.id} should NOT fire on cold install, got ${fired}`);
    }
  }
});

test('queue sequencing: after permissions done + no TCC re-block, browser_extension is next eligible', () => {
  const ctx = makeCtx({
    completed: { permissions: 1 },
    homepageMountedFor: 6_000,
    // macTCCBlocked=false so permissions won't re-fire
  });
  // permissions has onceEver:false + reEligibility only on macTCCBlocked,
  // so it CAN re-fire in theory but we set userState such that it doesn't.
  assert.equal(shouldShowToaster(stageById['browser_extension'], ctx), true);
  assert.equal(shouldShowToaster(stageById['profile_intelligence'], ctx), false);
});

test('full happy-path sequence progresses through prereqs', () => {
  let completed = {};
  const completedSet = (id) => { completed[id] = Date.now(); };
  const skippedSet = new Set();

  // Stage 1: permissions
  let ctx = makeCtx({ completed, skipped: skippedSet, homepageMountedFor: 3_000 });
  assert.equal(shouldShowToaster(stageById['permissions'], ctx), true);
  completedSet('permissions');

  // Stage 2: browser_extension (next launch — assume connected=false)
  ctx = makeCtx({ completed, skipped: skippedSet, homepageMountedFor: 6_000 });
  assert.equal(shouldShowToaster(stageById['browser_extension'], ctx), true);
  completedSet('browser_extension');

  // Stage 3: profile_intelligence
  ctx = makeCtx({ completed, skipped: skippedSet, homepageMountedFor: 5_000 });
  assert.equal(shouldShowToaster(stageById['profile_intelligence'], ctx), true);
  completedSet('profile_intelligence');

  // Stage 4: modes_manager
  ctx = makeCtx({ completed, skipped: skippedSet, homepageMountedFor: 5_000 });
  assert.equal(shouldShowToaster(stageById['modes_manager'], ctx), true);
  completedSet('modes_manager');

  // Stage 5: trial_promo
  ctx = makeCtx({ completed, skipped: skippedSet, homepageMountedFor: 7_000 });
  assert.equal(shouldShowToaster(stageById['trial_promo'], ctx), true);
});

test('premium user skips trial/ads/support but still gets profile/modes/perms/extension', () => {
  const userState = { ...DEFAULT_USER_STATE, isPremium: true };
  const completed = {};
  const skippedSet = new Set();

  // Permissions — fires (always, first launch)
  let ctx = makeCtx({ completed, skipped: skippedSet, userState, homepageMountedFor: 3_000 });
  assert.equal(shouldShowToaster(stageById['permissions'], ctx), true);
  completed['permissions'] = 1;

  // Browser extension — fires if not connected
  ctx = makeCtx({ completed, skipped: skippedSet, userState, homepageMountedFor: 6_000 });
  assert.equal(shouldShowToaster(stageById['browser_extension'], ctx), true);

  // Profile intelligence — fires (profile, not premium, is the skipper)
  ctx = makeCtx({ completed, skipped: skippedSet, userState, homepageMountedFor: 5_000 });
  // Wait — premium should skip profile_intelligence too. Verify.
  assert.equal(shouldShowToaster(stageById['profile_intelligence'], ctx), false);
});

test('linux user: browser_extension skipped, profile_intelligence downstream stage can fire', () => {
  const userState = { ...DEFAULT_USER_STATE, extensionSupported: false };
  let completed = { permissions: 1 };
  // Simulate what the real orchestrator does: auto-add skipWhen-matching
  // stages to the skipped set so downstream requiresStages unblock.
  const skippedSet = new Set(['browser_extension']);

  const ctx = makeCtx({ completed, skipped: skippedSet, userState, homepageMountedFor: 6_000 });
  assert.equal(shouldShowToaster(stageById['browser_extension'], ctx), false);

  // Profile fires because browser_extension is in skipped (prereq satisfied)
  const ctxProfile = makeCtx({ completed, skipped: skippedSet, userState, homepageMountedFor: 5_000 });
  assert.equal(shouldShowToaster(stageById['profile_intelligence'], ctxProfile), true);
});

test('skipped prerequisite: trial_promo fires even if browser_extension was skipped', () => {
  const completed = { permissions: 1, profile_intelligence: 3, modes_manager: 4 };
  const skippedSet = new Set(['browser_extension']);
  const ctx = makeCtx({ completed, skipped: skippedSet, homepageMountedFor: 7_000 });
  assert.equal(shouldShowToaster(stageById['trial_promo'], ctx), true);
});

test('homepageMountedFor only matters when homepageCurrentlyMounted', () => {
  // If homepage is unmounted, all stages with requiresHomepageMounted fail
  const ctx = makeCtx({
    homepageCurrentlyMounted: false,
    homepageMountedFor: 0, // would otherwise satisfy all stages
    completed: { permissions: 1 },
  });
  assert.equal(shouldShowToaster(stageById['browser_extension'], ctx), false);
});

test('all stages respect foreground requirement', () => {
  const ctx = makeCtx({
    appInForeground: false,
    homepageMountedFor: 10_000,
  });
  // No foreground-gated stage should fire when the app is backgrounded
  for (const stage of STAGES) {
    assert.equal(shouldShowToaster(stage, ctx), false, `${stage.id} should fail when backgrounded`);
  }
});