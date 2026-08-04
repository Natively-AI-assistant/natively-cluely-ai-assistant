/**
 * Ticket 05 / commercial-surface-strip — engagement strip (ads + review).
 * Source-contract style matches TrialBackendHardDisable.test.mjs (prior art).
 *
 * Run: node --test electron/services/__tests__/EngagementAdsReviewStrip.test.mjs
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

function handlerSlice(source, channel, nextChannel) {
  const start = source.search(new RegExp(`safeHandle\\(['"]${channel}['"]`));
  assert.ok(start >= 0, `${channel} handler should exist`);
  const end = nextChannel
    ? source.search(new RegExp(`safeHandle\\(['"]${nextChannel}['"]`), start + 1)
    : source.length;
  assert.ok(end > start, `next channel after ${channel} should exist`);
  return source.slice(start, end);
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
    completed: { quiet_window: 1, ads: 1 },
    skipped: new Set(),
    lastShownTimes: {},
    now: Date.now(),
    ...overrides,
  };
}

const stageById = Object.fromEntries(STAGES.map((s) => [s.id, s]));

test('ads and review_prompt stages are permanently skipped (never show)', () => {
  const ads = stageById.ads;
  const review = stageById.review_prompt;
  assert.ok(ads, 'ads stage must remain registered (permanent skip, not silent delete)');
  assert.ok(review, 'review_prompt stage must remain registered');

  // Even with every eligibility gate satisfied, commercial engagement stages must not fire.
  assert.equal(shouldShowToaster(ads, makeCtx({ completed: { quiet_window: 1 } })), false);
  assert.equal(
    shouldShowToaster(review, makeCtx({ completed: { ads: 1 } })),
    false,
  );
  // Premium or not — still skipped.
  assert.equal(
    shouldShowToaster(ads, makeCtx({
      completed: { quiet_window: 1 },
      userState: { ...DEFAULT_USER_STATE, isPremium: true },
    })),
    false,
  );
});

test('ReviewPromptHost is not mounted on product App / orchestrator host paths', () => {
  const app = read('src/App.tsx');
  const host = read('src/components/onboarding/OrchestratedToasterHost.tsx');

  assert.doesNotMatch(app, /<\s*ReviewPromptHost\b/);
  assert.doesNotMatch(host, /<\s*ReviewPromptHost\b/);
  // Import alone is fine only if unused; prefer no product-path import either.
  assert.doesNotMatch(app, /import\s+ReviewPromptHost\b/);
  assert.doesNotMatch(host, /import\s+ReviewPromptHost\b/);
});

test('review:* IPC handlers do not call Natively reviews API or ReviewService network', () => {
  const source = read('electron/ipcHandlers.ts');
  const channels = [
    ['review:get-prompt-state', 'review:record-session'],
    ['review:record-session', 'review:flush-session'],
    ['review:flush-session', 'review:mark-shown'],
    ['review:mark-shown', 'review:dismiss-later'],
    ['review:dismiss-later', 'review:dismiss-forever'],
    ['review:dismiss-forever', 'review:submit'],
    ['review:submit', 'review:update-testimonial'],
    ['review:update-testimonial', 'trial:end-byok'],
  ];

  for (const [channel, next] of channels) {
    const body = handlerSlice(source, channel, next);
    assert.doesNotMatch(body, /api\.natively\.software/, `${channel} must not reference Natively API host`);
    assert.doesNotMatch(body, /\/api\/reviews/, `${channel} must not hit reviews endpoints`);
    assert.doesNotMatch(body, /ReviewService/, `${channel} must not load ReviewService on product path`);
    assert.doesNotMatch(body, /submitReview|reportUsage|reportEvent|getPromptState|syncWithBackend/, `${channel} must not call review network helpers`);
    assert.match(body, /disabled|review_disabled|ok:\s*false|eligible:\s*false/i, `${channel} should return a safe inactive/disabled shape`);
  }
});

test('ReviewService network helpers are hard no-ops (no /api/reviews fetch)', () => {
  const source = read('electron/services/ReviewService.ts');
  // Live phone-home looks like fetch(`${NATIVELY_API_URL}/api/reviews...`).
  assert.doesNotMatch(
    source,
    /fetch\s*\(\s*[`'"]\$\{?NATIVELY_API_URL\}?\/api\/reviews/,
    'ReviewService must not fetch Natively /api/reviews',
  );
  assert.doesNotMatch(
    source,
    /fetch\s*\(\s*[`'"].*\/api\/reviews/,
    'ReviewService must not fetch any /api/reviews URL',
  );
});

test('main process does not phone home via ReviewService on boot/quit', () => {
  const main = read('electron/main.ts');
  assert.doesNotMatch(main, /syncWithBackend\s*\(/);
  assert.doesNotMatch(main, /reportUsage\s*\(/);
});

test('premium useAdCampaigns stub remains no-op (skip-premium)', () => {
  const premium = read('src/premium/index.tsx');
  assert.match(premium, /activeAd:\s*null/);
  assert.match(premium, /nullAdCampaigns/);
  // Must not reintroduce a hard import of premium/src/useAdCampaigns as a required module.
  assert.doesNotMatch(premium, /from\s+['"].*premium\/src\/useAdCampaigns/);
});
