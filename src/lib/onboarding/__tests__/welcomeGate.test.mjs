import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowWelcome } from '../welcomeGate.mjs';

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
