// benchmarks/reranker-eval/__tests__/metrics.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reciprocalRank, recallAtK, ndcgAtK, aggregateMetrics } from '../lib/metrics.mjs';

describe('reciprocalRank', () => {
  test('gold at rank 0 → 1.0', () => {
    assert.equal(reciprocalRank([true, false, false]), 1);
  });
  test('gold at rank 2 (0-indexed) → 1/3', () => {
    assert.equal(reciprocalRank([false, false, true]), 1 / 3);
  });
  test('no gold in list → 0', () => {
    assert.equal(reciprocalRank([false, false, false]), 0);
  });
  test('multiple golds → uses the FIRST one', () => {
    assert.equal(reciprocalRank([false, true, true]), 1 / 2);
  });
});

describe('recallAtK', () => {
  test('gold within k → 1', () => {
    assert.equal(recallAtK([false, true, false], 3), 1);
  });
  test('gold outside k → 0', () => {
    assert.equal(recallAtK([false, false, true], 2), 0);
  });
  test('k larger than list → still correct', () => {
    assert.equal(recallAtK([true], 10), 1);
  });
});

describe('ndcgAtK', () => {
  test('single gold at rank 0 → nDCG 1.0 (perfect)', () => {
    assert.equal(ndcgAtK([true, false, false], 3), 1);
  });
  test('single gold at rank 0 out of one relevant item total → still 1.0', () => {
    assert.equal(ndcgAtK([true], 10), 1);
  });
  test('gold pushed to rank 1 scores lower than gold at rank 0', () => {
    const dcgRank0 = ndcgAtK([true, false], 2);
    const dcgRank1 = ndcgAtK([false, true], 2);
    assert.ok(dcgRank1 < dcgRank0, `expected ${dcgRank1} < ${dcgRank0}`);
  });
  test('two golds ranked at the top scores higher than one gold at the top plus one buried', () => {
    const bothTop = ndcgAtK([true, true, false, false], 4);
    const oneBuried = ndcgAtK([true, false, false, true], 4);
    assert.ok(bothTop > oneBuried, `expected ${bothTop} > ${oneBuried}`);
  });
  test('no gold at all → 0', () => {
    assert.equal(ndcgAtK([false, false], 2), 0);
  });
});

describe('aggregateMetrics', () => {
  test('averages each field independently across queries', () => {
    const agg = aggregateMetrics([
      { mrr: 1, recallAt1: 1, recallAt3: 1, ndcg: 1 },
      { mrr: 0, recallAt1: 0, recallAt3: 0, ndcg: 0 },
    ]);
    assert.equal(agg.mrr, 0.5);
    assert.equal(agg.recallAt1, 0.5);
    assert.equal(agg.recallAt3, 0.5);
    assert.equal(agg.ndcg, 0.5);
  });
  test('empty input → all zeros, never NaN or throw', () => {
    const agg = aggregateMetrics([]);
    assert.deepEqual(agg, { mrr: 0, recallAt1: 0, recallAt3: 0, ndcg: 0 });
  });
});
