// scripts/intent-benchmark/__tests__/metrics.test.mjs
//
// These numbers decide which model ships, so the tests target the conventions
// that quietly change a verdict rather than the arithmetic that obviously works.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  perLabelScores, macroF1, accuracy, expectedCalibrationError,
  secondaryTaskRecall, percentile, latencyStats, weightedAccuracy, confusionMatrix,
} from '../lib/metrics.mjs';

const P = (actual, predicted) => ({ actual, predicted });

describe('per-label scores', () => {
  test('computes precision, recall and F1 on a known case', () => {
    // a: 2 actual, 1 correct + 1 wrong -> recall .5 ; predicted twice, 1 right -> precision .5
    const pairs = [P('a', 'a'), P('a', 'b'), P('b', 'a'), P('b', 'b')];
    const s = perLabelScores(pairs);
    assert.equal(s.a.precision, 0.5);
    assert.equal(s.a.recall, 0.5);
    assert.equal(s.a.f1, 0.5);
    assert.equal(s.a.support, 2);
  });

  test('a label that is predicted but never actual has support 0', () => {
    const s = perLabelScores([P('a', 'z'), P('a', 'a')]);
    assert.equal(s.z.support, 0);
    assert.equal(s.z.precision, 0, 'predicted once, never right');
  });
});

describe('macro F1 and zero-support labels', () => {
  test('EXCLUDES zero-support labels rather than scoring them 0', () => {
    // The follow_up case. It fires on 0.2% of production turns, so a 300-row
    // held-out split can contain none. Scoring an absent label 0 would drag
    // every candidate down by 1/8 for a label nobody was asked about, and would
    // reward a corpus that quietly dropped hard labels.
    const pairs = [P('a', 'a'), P('b', 'b')];
    const all = ['a', 'b', 'follow_up'];
    const r = macroF1(pairs, all);
    assert.equal(r.macroF1, 1, 'perfect on the labels that exist');
    assert.equal(r.labelsScored, 2);
    assert.deepEqual(r.excludedLabels, ['follow_up']);
  });

  test('reports how many labels the average is over', () => {
    const r = macroF1([P('a', 'a')], ['a', 'b', 'c']);
    assert.equal(r.labelsScored, 1, 'the caller must be able to say "over 1 of 3"');
  });

  test('macro differs from accuracy when classes are imbalanced', () => {
    // 9 of class a all correct, 1 of class b wrong. Accuracy .9, macro much lower.
    const pairs = [...Array(9)].map(() => P('a', 'a')).concat([P('b', 'a')]);
    assert.equal(accuracy(pairs), 0.9);
    const r = macroF1(pairs);
    assert.ok(r.macroF1 < 0.6, `macro should punish the missed rare class, got ${r.macroF1}`);
  });

  test('returns null macro rather than NaN on an empty set', () => {
    const r = macroF1([]);
    assert.equal(r.macroF1, null);
  });
});

describe('calibration', () => {
  test('a perfectly calibrated set has near-zero ECE', () => {
    // 10 items at confidence 0.9, exactly 9 correct.
    const items = [...Array(10)].map((_, i) => ({ confidence: 0.9, correct: i < 9 }));
    const r = expectedCalibrationError(items);
    assert.ok(r.ece < 0.02, `expected near 0, got ${r.ece}`);
  });

  test('an overconfident set has high ECE', () => {
    const items = [...Array(10)].map((_, i) => ({ confidence: 0.95, correct: i < 3 }));
    const r = expectedCalibrationError(items);
    assert.ok(r.ece > 0.5, `expected large, got ${r.ece}`);
  });

  test('FLAGS a degenerate confidence distribution', () => {
    // Seven of the ten legacy regex rules return a hardcoded confidence, so the
    // control's ECE measures a constant rather than a belief. The number is
    // still computed; the flag has to travel with it or the report lies.
    const items = [...Array(10)].map((_, i) => ({ confidence: 0.9, correct: i < 9 }));
    assert.equal(expectedCalibrationError(items).degenerate, true);

    const varied = [{ confidence: 0.3, correct: false }, { confidence: 0.9, correct: true }];
    assert.equal(expectedCalibrationError(varied).degenerate, false);
  });

  test('handles a confidence of exactly 1.0 without an out-of-range bin', () => {
    const r = expectedCalibrationError([{ confidence: 1, correct: true }]);
    // 1.0 is clamped to 0.999999 so it lands in the last bin rather than an
    // index-out-of-range one. That leaves a 1e-6 residual, which is the clamp
    // showing through and not a calibration error.
    assert.ok(r.ece < 1e-5, `expected ~0, got ${r.ece}`);
    assert.equal(r.bins.length, 1);
    assert.equal(r.bins[0].hi, 1);
  });

  test('returns null when nothing carries a confidence', () => {
    assert.equal(expectedCalibrationError([{ correct: true }]).ece, null);
  });
});

describe('secondary task recall', () => {
  test('EXCLUDES rows with no secondary tasks from the denominator', () => {
    // Otherwise a model that never predicts a secondary task scores ~1.0 on a
    // corpus where 92% of rows have none.
    const pairs = [
      { actual: [], predicted: [] },
      { actual: [], predicted: [] },
      { actual: ['create'], predicted: [] },
    ];
    const r = secondaryTaskRecall(pairs);
    assert.equal(r.rowsWithAny, 1);
    assert.equal(r.recall, 0, 'the one row that mattered was missed');
  });

  test('scores partial recall correctly', () => {
    const r = secondaryTaskRecall([{ actual: ['create', 'explain'], predicted: ['create'] }]);
    assert.equal(r.recall, 0.5);
  });

  test('returns null when no row has any secondary task', () => {
    assert.equal(secondaryTaskRecall([{ actual: [], predicted: [] }]).recall, null);
  });
});

describe('latency', () => {
  test('percentile uses nearest-rank', () => {
    assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
    assert.equal(percentile([10], 95), 10);
    assert.equal(percentile([], 50), null);
  });

  test('p95 is not diluted by a long tail of fast calls', () => {
    const s = [...Array(95)].map(() => 5).concat([...Array(5)].map(() => 500));
    const r = latencyStats(s);
    assert.equal(r.p50, 5);
    assert.equal(r.p95, 5, 'rank 95 of 100 is still the fast value');
    assert.equal(r.max, 500);
  });
});

describe('production re-weighting', () => {
  test('re-weights a balanced corpus to a production distribution', () => {
    // Balanced corpus: 2 of each. Model is perfect on `general`, wrong on the
    // rare class. Balanced accuracy .5; production-weighted much higher,
    // because `general` is 37.5% of real traffic and follow_up is 0.2%.
    const pairs = [
      P('general', 'general'), P('general', 'general'),
      P('follow_up', 'general'), P('follow_up', 'general'),
    ];
    assert.equal(accuracy(pairs), 0.5);
    const w = weightedAccuracy(pairs, { general: 0.375, follow_up: 0.002 });
    assert.ok(w.weightedAccuracy > 0.99, `expected near 1, got ${w.weightedAccuracy}`);
  });

  test('reports labels missing from the weight table instead of silently dropping them', () => {
    const w = weightedAccuracy([P('a', 'a'), P('zzz', 'zzz')], { a: 1 });
    assert.deepEqual(w.missingFromWeights, ['zzz']);
  });
});

describe('confusion matrix', () => {
  test('counts actual -> predicted', () => {
    const m = confusionMatrix([P('a', 'b'), P('a', 'b'), P('a', 'a')]);
    assert.equal(m.get('a').get('b'), 2);
    assert.equal(m.get('a').get('a'), 1);
  });
});
