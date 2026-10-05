// src/lib/onboarding/__tests__/stageCatalog.test.mjs
//
// Decision-engine tests for the stage catalog. Validates each stage's
// shouldShowToaster behavior against fixture contexts.
//
// Run: node --experimental-strip-types --test src/lib/onboarding/__tests__/stageCatalog.test.mjs
// (--experimental-strip-types is required: this file imports stageCatalog.ts
// directly, see the drain-loop invariant below.)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldShowToaster } from '../orchestrator.mjs';
import {
  STAGES,
  QUIET_WINDOW_STAGE,
  REVIEW_PROMPT_MIN_SESSIONS,
  REVIEW_PROMPT_MIN_USAGE_MS,
} from '../stageCatalog.mjs';
import { STAGES as STAGES_TS, QUIET_WINDOW_STAGE as QUIET_WINDOW_STAGE_TS } from '../stageCatalog.ts';

// ─── Drain-loop safety invariant ────────────────────────────────────
// A gate-only stage is auto-completed inside evaluateAndDispatch()'s
// `do { … } while (progressMade && !activeToasterId)` loop. completeToaster()
// records completion, but shouldShowToaster() only suppresses a completed stage
// when `onceEver` is set. So a gate-only stage WITHOUT onceEver stays eligible
// after completing, keeps setting progressMade=true, and the loop spins
// synchronously forever — pegging the renderer main thread and OOM-crashing it
// (the 2026-07-19 quiet_window regression: RSS → ~9 GB, exitCode-5 crash).
// This invariant makes that misconfiguration a failing test, not a field crash.
//
// Checked against BOTH catalogs: stageCatalog.mjs is a hand-maintained mirror
// used only so this suite can run under `node --test` without a build step —
// stageCatalog.ts is what the app actually ships. A test that only checked
// the .mjs mirror could stay green while the real .ts catalog regresses.
function assertEveryGateOnlyStageIsOnceEver(stages, label) {
  for (const s of stages) {
    if (s.isGateOnly) {
      assert.equal(
        s.onceEver, true,
        `[${label}] gate-only stage "${s.id}" must set onceEver:true or evaluateAndDispatch spins forever`,
      );
    }
  }
}

test('INVARIANT: every gate-only stage is onceEver — stageCatalog.mjs (test mirror)', () => {
  assertEveryGateOnlyStageIsOnceEver([...STAGES, QUIET_WINDOW_STAGE], 'stageCatalog.mjs');
});

test('INVARIANT: every gate-only stage is onceEver — stageCatalog.ts (production)', () => {
  assertEveryGateOnlyStageIsOnceEver([...STAGES_TS, QUIET_WINDOW_STAGE_TS], 'stageCatalog.ts');
});

// ─── Fixtures ──────────────────────────────────────────────────────

const DEFAULT_USER_STATE = {
  isPremium: false,
  hasProfile: false,
  hasNativelyKey: false,
  hasTrialToken: false,
  extensionConnected: false,
  extensionSupported: true,
  permsShown: false,
  permissionsNeedAttention: false,
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

test('permissions: stays quiet once shown while every permission is fine', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, permsShown: true, permissionsNeedAttention: false },
    homepageMountedFor: 3_000,
  });
  assert.equal(show('permissions', ctx), false);
});

test('permissions: comes back for a returning user when a permission needs attention', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, permsShown: true, permissionsNeedAttention: true },
    homepageMountedFor: 3_000,
  });
  assert.equal(show('permissions', ctx), true);
});

// The permissions rule, checked on BOTH twins: the .ts catalog the app ships
// and the .mjs one the decision-engine tests above run. Hand-written truth
// table: first launch always shows; afterwards only a permission that needs
// attention brings the card back.
for (const [label, stages] of [['stageCatalog.mjs', STAGES], ['stageCatalog.ts', STAGES_TS]]) {
  const perms = stages.find((s) => s.id === 'permissions');
  for (const [permsShown, permissionsNeedAttention, wantSkip] of [
    [false, false, false],
    [false, true, false],
    [true, false, true],
    [true, true, false],
  ]) {
    test(`${label} permissions: shown=${permsShown} needsAttention=${permissionsNeedAttention} → ${wantSkip ? 'quiet' : 'eligible'}`, () => {
      const userState = { ...DEFAULT_USER_STATE, permsShown, permissionsNeedAttention };
      assert.equal(perms.skipWhen(userState), wantSkip);
      assert.equal(perms.reEligibility(userState, {}), permissionsNeedAttention);
    });
  }
}

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

test('support: skipped when isPremium', () => {
  const ctx = makeCtx({
    userState: { ...DEFAULT_USER_STATE, isPremium: true, donationShouldShow: true },
    completed: { quiet_window: 1 },
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

// ─── Review prompt ────────────────────────────────────────────────

// Engagement is "sessions OR usage", matching the review ledger
// (electron/services/ReviewPromptLogic.ts). It previously read
// requiresStartupCount: 6 + requiresTotalUsageMs: 45min in `triggers`, but the
// orchestrator ANDs triggers — so the catalog demanded BOTH, a strictly harder
// gate than the ledger's OR, and the ledger's own thresholds never bound.

test('review_prompt: enough sessions alone qualifies, even with little usage', () => {
  const ctx = makeCtx({
    completed: { ads: 1 },
    startupCount: REVIEW_PROMPT_MIN_SESSIONS,
    totalUsageMs: 60 * 1000, // one minute — nowhere near the usage gate
    homepageMountedFor: 11_000,
  });
  assert.equal(show('review_prompt', ctx), true);
});

test('review_prompt: enough usage alone qualifies, even on first session', () => {
  const ctx = makeCtx({
    completed: { ads: 1 },
    startupCount: 1,
    totalUsageMs: REVIEW_PROMPT_MIN_USAGE_MS,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('review_prompt', ctx), true);
});

test('review_prompt: withheld until at least one engagement gate is met', () => {
  const ctx = makeCtx({
    completed: { ads: 1 },
    startupCount: REVIEW_PROMPT_MIN_SESSIONS - 1,
    totalUsageMs: REVIEW_PROMPT_MIN_USAGE_MS - 1,
    homepageMountedFor: 11_000,
  });
  assert.equal(show('review_prompt', ctx), false);
});

test('review_prompt: engagement does not bypass the other triggers', () => {
  // Fully engaged, but not yet 10 s on the home screen.
  const ctx = makeCtx({
    startupCount: 99,
    totalUsageMs: 99 * 60 * 1000,
    homepageMountedFor: 5_000,
  });
  assert.equal(show('review_prompt', ctx), false);
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

// The generic cooldown mechanism (card stages now wait via the card ledger).
const COOLDOWN_STAGE = { id: 'cooldown_probe', order: 1, triggers: {}, cooldownMs: () => 7 * 24 * 60 * 60 * 1000 };

test('cooldown blocks re-fire within cooldown window', () => {
  const ctx = makeCtx({ lastShownTimes: { cooldown_probe: Date.now() - 1000 } }); // 1s ago
  assert.equal(shouldShowToaster(COOLDOWN_STAGE, ctx), false);
});

test('cooldown allows re-fire after window elapses', () => {
  const ctx = makeCtx({ lastShownTimes: { cooldown_probe: Date.now() - 8 * 24 * 60 * 60 * 1000 } }); // 8 days ago
  assert.equal(shouldShowToaster(COOLDOWN_STAGE, ctx), true);
});
