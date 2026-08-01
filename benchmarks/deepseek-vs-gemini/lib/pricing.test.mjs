import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PRICING, costFor, estimateRunCost } from './pricing.mjs';

describe('costFor', () => {
  test('deepseek-v4-flash cache-miss: 1M in / 1M out', () => {
    const cost = costFor('deepseek-v4-flash', 1_000_000, 1_000_000);
    assert.ok(Math.abs(cost - (0.14 + 0.28)) < 1e-9);
  });

  test('deepseek-v4-flash cache-hit uses discounted input rate', () => {
    const cost = costFor('deepseek-v4-flash', 1_000_000, 0, { cacheHit: true });
    assert.ok(Math.abs(cost - 0.028) < 1e-9);
  });

  test('gemini-3.6-flash: 1M in / 1M out', () => {
    const cost = costFor('gemini-3.6-flash', 1_000_000, 1_000_000);
    assert.ok(Math.abs(cost - (1.50 + 7.50)) < 1e-9);
  });

  test('gemini-3.1-flash-lite: 1M in / 1M out', () => {
    const cost = costFor('gemini-3.1-flash-lite', 1_000_000, 1_000_000);
    assert.ok(Math.abs(cost - (0.25 + 1.50)) < 1e-9);
  });

  test('unknown model throws', () => {
    assert.throws(() => costFor('not-a-model', 100, 100), /No pricing entry/);
  });

  test('zero tokens costs zero', () => {
    assert.equal(costFor('deepseek-v4-flash', 0, 0), 0);
  });
});

describe('estimateRunCost', () => {
  test('sums cost across models and prompts', () => {
    const total = estimateRunCost(
      ['deepseek-v4-flash', 'gemini-3.1-flash-lite'],
      10,
      1000,
      500,
    );
    const expected =
      10 * costFor('deepseek-v4-flash', 1000, 500) +
      10 * costFor('gemini-3.1-flash-lite', 1000, 500);
    assert.ok(Math.abs(total - expected) < 1e-9);
  });

  test('PRICING has all three benchmark models', () => {
    for (const id of ['deepseek-v4-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite']) {
      assert.ok(PRICING[id], `missing pricing for ${id}`);
    }
  });
});
