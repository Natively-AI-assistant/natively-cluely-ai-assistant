/**
 * Ticket 03 / commercial-surface-strip — trial UI chrome strip.
 * Source-contract style matches DonationClusterStrip / EngagementAdsReviewStrip.
 *
 * Run: node --test electron/services/__tests__/TrialUiChromeStrip.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shouldShowToaster } from '../../../src/lib/onboarding/orchestrator.mjs';
import { STAGES } from '../../../src/lib/onboarding/stageCatalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

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
  isV2_8_OrNewer: true,
};

function makeCtx(overrides = {}) {
  return {
    startupCount: 10,
    totalUsageMs: 60 * 60 * 1000,
    turnCount: 20,
    homepageMountedFor: 15_000,
    appInForeground: true,
    homepageCurrentlyMounted: true,
    meetingActive: false,
    userState: { ...DEFAULT_USER_STATE },
    completed: { modes_manager: 1 },
    skipped: new Set(),
    lastShownTimes: {},
    now: Date.now(),
    ...overrides,
  };
}

const stageById = Object.fromEntries(STAGES.map((s) => [s.id, s]));

test('trial_promo stage is permanently skipped (never schedules)', () => {
  const trial = stageById.trial_promo;
  assert.ok(trial, 'trial_promo must remain registered (permanent skip, not silent delete)');

  // Even with every eligibility gate satisfied, trial promo must not fire.
  assert.equal(shouldShowToaster(trial, makeCtx()), false);
  assert.equal(
    shouldShowToaster(trial, makeCtx({
      userState: { ...DEFAULT_USER_STATE, isPremium: false, hasNativelyKey: false, hasTrialToken: false },
    })),
    false,
  );
});

test('App never mounts FreeTrialBanner / FreeTrialModal or polls trial upgrade flows', () => {
  const app = read('src/App.tsx');

  assert.doesNotMatch(app, /<\s*FreeTrialBanner\b/);
  assert.doesNotMatch(app, /<\s*FreeTrialModal\b/);
  assert.doesNotMatch(app, /import\s+\{\s*FreeTrialBanner\b/);
  assert.doesNotMatch(app, /import\s+\{\s*FreeTrialModal\b/);
  assert.doesNotMatch(app, /getTrialStatus/);
  assert.doesNotMatch(app, /getLocalTrial/);
  assert.doesNotMatch(app, /onTrialEnded/);
  assert.doesNotMatch(app, /wipeTrialProfileData/);
  assert.doesNotMatch(app, /showTrialExpiredModal/);
  assert.doesNotMatch(app, /setActiveTrial/);
});

test('OrchestratedToasterHost never mounts TrialPromoToaster', () => {
  const host = read('src/components/onboarding/OrchestratedToasterHost.tsx');

  assert.doesNotMatch(host, /<\s*TrialPromoToaster\b/);
  assert.doesNotMatch(host, /import\s+\{\s*TrialPromoToaster\b/);
  assert.doesNotMatch(host, /startTrial/);
});

test('trial UI component files are gone, or remaining ones have no Dodo PLAN_ checkout', () => {
  const banner = 'src/components/trial/FreeTrialBanner.tsx';
  const modal = 'src/components/trial/FreeTrialModal.tsx';
  const promo = 'src/components/trial/TrialPromoToaster.tsx';

  for (const rel of [banner, modal, promo]) {
    if (!exists(rel)) continue;
    const src = read(rel);
    assert.doesNotMatch(src, /PLAN_(STANDARD|PRO|MAX|ULTRA)_URL/);
    assert.doesNotMatch(src, /checkout\.dodopayments\.com/);
  }

  // Preferred outcome: all three deleted.
  assert.equal(exists(banner), false, 'FreeTrialBanner should be deleted');
  assert.equal(exists(modal), false, 'FreeTrialModal should be deleted');
  assert.equal(exists(promo), false, 'TrialPromoToaster should be deleted');
});

test('settings has no start-free-trial / trial status upsell card', () => {
  const api = read('src/components/settings/NativelyApiSettings.tsx');
  assert.doesNotMatch(api, /Start 10-Minute Free Trial|Free Trial Active|start free trial/i);
  assert.doesNotMatch(api, /FreeTrialModal|FreeTrialBanner/);
  assert.doesNotMatch(api, /getTrialStatus|startTrial/);
});
