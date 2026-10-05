// electron/llm/__tests__/triggerGate.test.mjs
//
// Unit tests for electron/llm/triggerGate.ts (shouldThrottleTrigger) — the pure
// predicate behind the "What to answer" trigger cooldown. Explicit user intent
// (images, skipCooldown) and the speculative pre-fetch are never throttled;
// everything else is throttled strictly inside the cooldown window.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/triggerGate.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { shouldThrottleTrigger } = require(path.join(repoRoot, 'dist-electron', 'electron', 'llm', 'triggerGate.js'));

// A plain automatic, non-speculative call 1s after the last trigger, 3s cooldown.
const base = Object.freeze({
  hasImages: false,
  isSpeculative: false,
  skipCooldown: false,
  now: 101_000,
  lastTriggerTime: 100_000,
  triggerCooldown: 3_000,
});

describe('shouldThrottleTrigger', () => {
  test('throttles a plain call that lands inside the cooldown window', () => {
    assert.equal(shouldThrottleTrigger({ ...base }), true);
  });

  test('does not throttle once the cooldown has fully elapsed', () => {
    assert.equal(shouldThrottleTrigger({ ...base, now: 110_000 }), false);
  });

  test('boundary: exactly one cooldown later is allowed, 1ms earlier is throttled', () => {
    assert.equal(shouldThrottleTrigger({ ...base, now: 103_000 }), false);
    assert.equal(shouldThrottleTrigger({ ...base, now: 102_999 }), true);
  });

  test('a call at the same instant as the last trigger is throttled', () => {
    assert.equal(shouldThrottleTrigger({ ...base, now: 100_000 }), true);
  });

  test('attached images always bypass the cooldown', () => {
    assert.equal(shouldThrottleTrigger({ ...base, hasImages: true }), false);
  });

  test('the speculative pre-fetch is never blocked here', () => {
    assert.equal(shouldThrottleTrigger({ ...base, isSpeculative: true }), false);
  });

  test('skipCooldown (manual hotkey / button) bypasses the cooldown', () => {
    assert.equal(shouldThrottleTrigger({ ...base, skipCooldown: true }), false);
  });

  test('every bypass flag wins even at the instant of the last trigger', () => {
    for (const flag of ['hasImages', 'isSpeculative', 'skipCooldown']) {
      assert.equal(shouldThrottleTrigger({ ...base, now: 100_000, [flag]: true }), false, flag);
    }
  });

  test('a zero cooldown never throttles', () => {
    assert.equal(shouldThrottleTrigger({ ...base, now: 100_000, triggerCooldown: 0 }), false);
  });

  test('first ever trigger (lastTriggerTime 0) is not throttled at a real timestamp', () => {
    assert.equal(shouldThrottleTrigger({ ...base, now: 1_700_000_000_000, lastTriggerTime: 0 }), false);
  });

  test('does not mutate its input', () => {
    const input = { ...base };
    shouldThrottleTrigger(input);
    assert.deepEqual(input, { ...base });
  });
});
