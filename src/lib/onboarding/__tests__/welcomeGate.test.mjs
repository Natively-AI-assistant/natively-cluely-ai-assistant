import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowWelcome, hasOnboardingHistory } from '../welcomeGate.mjs';

const fresh = { welcomeSeen: false, permsShown: false };

test('a fresh install sees the welcome', () => {
  assert.equal(shouldShowWelcome({ seenStartup: false, permsShown: false }, fresh), true);
});

test('dismissing it (either store) hides it for good', () => {
  assert.equal(shouldShowWelcome({ seenStartup: true, permsShown: false }, fresh), false);
  assert.equal(shouldShowWelcome({ seenStartup: false, permsShown: false }, { ...fresh, welcomeSeen: true }), false);
});

test('an install that already went through onboarding is not a first boot', () => {
  assert.equal(shouldShowWelcome({ seenStartup: false, permsShown: true }, fresh), false);
  assert.equal(shouldShowWelcome({ seenStartup: false, permsShown: false }, { ...fresh, permsShown: true }), false);
});

test('no flag store falls back to the local mirrors', () => {
  assert.equal(shouldShowWelcome(null, fresh), true);
  assert.equal(shouldShowWelcome(undefined, { ...fresh, welcomeSeen: true }), false);
});

test('an install whose legacy perms key was swept still counts as onboarded', () => {
  // persistence.mjs removes natively_perms_shown_v1 once anything is completed;
  // the completed map it leaves behind is the surviving local record.
  const swept = { ...fresh, onboarded: hasOnboardingHistory(JSON.stringify({ completed: { permissions: 1 } })) };
  assert.equal(shouldShowWelcome({ seenStartup: false, permsShown: false }, swept), false);
  assert.equal(shouldShowWelcome(null, swept), false);
});

test('onboarding history: only a non-empty completed map counts', () => {
  assert.equal(hasOnboardingHistory(null), false);
  assert.equal(hasOnboardingHistory(''), false);
  assert.equal(hasOnboardingHistory('not json'), false);
  assert.equal(hasOnboardingHistory('{}'), false);
  assert.equal(hasOnboardingHistory(JSON.stringify({ completed: {}, startupCount: 4 })), false);
  assert.equal(hasOnboardingHistory(JSON.stringify({ completed: { _turnCountAtQuietStart: 3 } })), false);
  assert.equal(hasOnboardingHistory(JSON.stringify({ completed: { modes_manager: 5 } })), true);
});
