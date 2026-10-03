// electron/intelligence/autoAnswer/__tests__/AutoAnswerPolicy.test.mjs
//
// Covers electron/intelligence/autoAnswer/AutoAnswerPolicy.ts — the compiled-in
// fallback Auto Answer thresholds (the module's only runtime export; the rest
// is a type).
//
// Runs against the compiled output in dist-electron/.
// Run: node --test electron/intelligence/autoAnswer/__tests__/AutoAnswerPolicy.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const policy = require(path.join(repoRoot, 'dist-electron/electron/intelligence/autoAnswer/AutoAnswerPolicy.js'));
const { DEFAULT_THRESHOLDS } = policy;

describe('DEFAULT_THRESHOLDS', () => {
  test('carries the documented fallback bars', () => {
    assert.deepEqual(DEFAULT_THRESHOLDS, { autoThreshold: 0.88, offerThreshold: 0.65, speculationThreshold: 0.82 });
  });

  test('every bar is a finite probability strictly between 0 and 1', () => {
    for (const [name, value] of Object.entries(DEFAULT_THRESHOLDS)) {
      assert.equal(typeof value, 'number', name);
      assert.ok(Number.isFinite(value), name);
      assert.ok(value > 0 && value < 1, `${name}=${value}`);
    }
  });

  test('the offer band sits below the auto bar, so an offer card can exist', () => {
    assert.ok(DEFAULT_THRESHOLDS.offerThreshold < DEFAULT_THRESHOLDS.autoThreshold);
  });

  test('speculation starts before the auto bar, never after it', () => {
    assert.ok(DEFAULT_THRESHOLDS.speculationThreshold <= DEFAULT_THRESHOLDS.autoThreshold);
  });

  test('speculation is not started for turns that would not even be offered', () => {
    assert.ok(DEFAULT_THRESHOLDS.speculationThreshold >= DEFAULT_THRESHOLDS.offerThreshold);
  });
});

describe('module surface', () => {
  test('exports the thresholds and no leftover score-based policy function', () => {
    assert.deepEqual(Object.keys(policy), ['DEFAULT_THRESHOLDS']);
  });
});
