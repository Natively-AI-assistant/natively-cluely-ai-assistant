// The calculations behind chart artifacts. A model never supplies computed
// numbers: it names a calculation and gives inputs, and these functions produce
// the values. So these tests are the chart's arithmetic contract.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALC_VERSION,
  roundTo,
  compoundGrowth,
  growthWithChurn,
  percentageChange,
  percentagePointChange,
  stageConversion,
  cumulativeNet,
  breakEven,
  weightedPipeline,
  compileExpression,
  evaluateFunction,
  runCompute,
  formatNumber,
  periodLabels,
} from '../chartCompute.mjs';

describe('the sales projection fixture', () => {
  // "Assume revenue is $10,000 per month now. Show the next three months if net
  // monthly revenue growth stays at 5%."  R(t) = R(0) × (1 + g)^t
  const fixture = { baseline: 10000, ratePercent: 5, period: 'month', periods: 3 };

  test('the three projected months are 10,500, 11,025 and 11,576.25', () => {
    const r = compoundGrowth(fixture);
    assert.equal(r.ok, true);
    assert.deepEqual(r.values, [10000, 10500, 11025, 11576.25]);
    assert.deepEqual(r.labels, ['Now', 'Month 1', 'Month 2', 'Month 3']);
    assert.equal(r.formula, 'R(t) = R(0) × (1 + g)^t');
  });

  test('they are monthly values, not a running total', () => {
    const r = compoundGrowth(fixture);
    assert.notEqual(r.values[3], 10500 + 11025 + 11576.25);
    assert.ok(r.values[3] < 12000);
  });

  test('the baseline is the one observed point; everything after it is projected', () => {
    assert.equal(compoundGrowth(fixture).projectedFrom, 1);
    assert.deepEqual(compoundGrowth({ ...fixture, includeBaseline: false }).values, [10500, 11025, 11576.25]);
    assert.equal(compoundGrowth({ ...fixture, includeBaseline: false }).projectedFrom, 0);
  });

  test('"change growth to 3%" changes only that input', () => {
    const r = compoundGrowth({ ...fixture, ratePercent: 3 });
    assert.deepEqual(r.values, [10000, 10300, 10609, 10927.27]);
    assert.deepEqual(r.inputs, { baseline: 10000, ratePercent: 3, period: 'month', periods: 3 });
  });

  test('the summary says what was assumed, in words', () => {
    assert.equal(compoundGrowth(fixture).summary, 'Constant 5% net growth per month from 10,000 over 3 months.');
  });
});

describe('a forecast is refused, not invented, when an input is missing', () => {
  test('no baseline', () => {
    const r = compoundGrowth({ ratePercent: 5, period: 'month', periods: 3 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'missing_input');
    assert.deepEqual(r.missing, ['a starting value']);
    assert.match(r.message, /needs a starting value/);
  });

  test('no rate, no period, no horizon: each is named', () => {
    const r = compoundGrowth({ baseline: 10000 });
    assert.equal(r.code, 'missing_input');
    assert.equal(r.missing.length, 3);
    assert.match(r.message, /the number of periods/);
    assert.match(r.message, /a growth rate/);
    assert.match(r.message, /the period the rate applies to/);
  });

  test('a null, a string or NaN is not a number', () => {
    for (const bad of [null, '10000', NaN, undefined, Infinity]) {
      assert.equal(compoundGrowth({ baseline: bad, ratePercent: 5, period: 'month', periods: 3 }).ok, false, String(bad));
    }
  });
});

describe('ambiguity is refused rather than resolved silently', () => {
  test('monthly steps with an annual rate', () => {
    const r = compoundGrowth({ baseline: 10000, ratePercent: 60, period: 'month', periods: 12, ratePeriod: 'year' });
    assert.equal(r.code, 'rate_period_mismatch');
    assert.match(r.message, /per year but the steps are per month/);
  });

  test('a net rate given together with churn', () => {
    const r = compoundGrowth({ baseline: 10000, ratePercent: 5, churnPercent: 2, period: 'month', periods: 3 });
    assert.equal(r.code, 'rate_already_net');
  });

  test('growth and churn given separately use their own stated recurrence', () => {
    const r = growthWithChurn({ baseline: 1000, growthPercent: 8, churnPercent: 3, period: 'month', periods: 2 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.values, [1000, 1050, 1102.5]);
    assert.equal(r.formula, 'R(t+1) = R(t) × (1 + g − c)');
    assert.equal(growthWithChurn({ baseline: 1000, growthPercent: 8, period: 'month', periods: 2 }).code, 'missing_input');
  });

  test('"rate: 5" (5% or 500%?) is refused; a decimal fraction is accepted', () => {
    assert.equal(compoundGrowth({ baseline: 100, rate: 5, period: 'month', periods: 2 }).code, 'ambiguous_rate');
    assert.deepEqual(compoundGrowth({ baseline: 100, rate: 0.05, period: 'month', periods: 2 }).values, [100, 105, 110.25]);
  });

  test('a fractional or absurd number of periods', () => {
    assert.equal(compoundGrowth({ baseline: 100, ratePercent: 5, period: 'month', periods: 2.5 }).code, 'bad_periods');
    assert.equal(compoundGrowth({ baseline: 100, ratePercent: 5, period: 'month', periods: 0 }).code, 'bad_periods');
    assert.equal(compoundGrowth({ baseline: 100, ratePercent: 5, period: 'month', periods: 5000 }).code, 'bad_periods');
  });

  test('a decline is a valid rate; losing everything is not a projection', () => {
    assert.deepEqual(compoundGrowth({ baseline: 100, ratePercent: -10, period: 'month', periods: 2 }).values, [100, 90, 81]);
    assert.equal(compoundGrowth({ baseline: 100, ratePercent: -100, period: 'month', periods: 2 }).code, 'bad_rate');
  });
});

describe('rounding', () => {
  test('half away from zero, without binary-float drift', () => {
    assert.equal(roundTo(1.005, 2), 1.01);
    assert.equal(roundTo(2.675, 2), 2.68);
    assert.equal(roundTo(-2.5, 0), -3);
    assert.equal(roundTo(11576.250000000002, 2), 11576.25);
    assert.equal(Object.is(roundTo(-0.001, 2), -0), false);
  });

  test('numbers are grouped and never use the locale', () => {
    assert.equal(formatNumber(11576.25), '11,576.25');
    assert.equal(formatNumber(-1234567), '-1,234,567');
    assert.equal(formatNumber(10000), '10,000');
    assert.equal(formatNumber(0.5), '0.5');
    assert.equal(formatNumber(12.3456, 1), '12.3');
  });
});

describe('percentage change', () => {
  test('a change from zero is undefined, not infinite and not zero', () => {
    const r = percentageChange({ from: 0, to: 50 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'zero_denominator');
  });

  test('up and down', () => {
    assert.equal(percentageChange({ from: 80, to: 100 }).percent, 25);
    assert.equal(percentageChange({ from: 100, to: 80 }).percent, -20);
    assert.equal(percentageChange({ from: -50, to: -25 }).percent, 50);
  });

  test('percentage POINTS are a different thing from percent', () => {
    // 20% → 25% is +5 points, and +25 percent.
    assert.equal(percentagePointChange({ fromPercent: 20, toPercent: 25 }).points, 5);
    assert.equal(percentageChange({ from: 20, to: 25 }).percent, 25);
  });
});

describe('stage conversion', () => {
  const stages = [{ label: 'Leads', count: 200 }, { label: 'Qualified', count: 120 }, { label: 'Won', count: 40 }];

  test('step rates and the overall rate', () => {
    const r = stageConversion({ stages });
    assert.deepEqual(r.steps.map((s) => s.ratePercent), [60, 33.3]);
    assert.equal(r.overallPercent, 20);
    assert.deepEqual(r.notes, []);
  });

  test('a stage larger than the one before is reported, and its rate left empty', () => {
    const r = stageConversion({ stages: [{ label: 'Applied', count: 50 }, { label: 'Screened', count: 70 }, { label: 'Hired', count: 5 }] });
    assert.equal(r.steps[0].ratePercent, null);
    assert.match(r.notes[0], /not one cohort, or people re-enter/);
    assert.equal(r.overallPercent, 10);
  });

  test('an empty stage has no conversion out of it (no divide by zero)', () => {
    const r = stageConversion({ stages: [{ label: 'A', count: 10 }, { label: 'B', count: 0 }, { label: 'C', count: 0 }] });
    assert.equal(r.steps[0].ratePercent, 0);
    assert.equal(r.steps[1].ratePercent, null);
    assert.match(r.notes[0], /undefined/);
  });

  test('a missing count is not zero', () => {
    assert.equal(stageConversion({ stages: [{ label: 'A', count: 10 }, { label: 'B' }] }).code, 'missing_input');
    assert.equal(stageConversion({ stages: [{ label: 'A', count: 10 }] }).code, 'missing_input');
    assert.equal(stageConversion({ stages: [{ label: 'A', count: 10 }, { label: 'B', count: -1 }] }).code, 'negative_count');
  });
});

describe('cumulative savings and break-even', () => {
  test('a constant saving pays back an up-front cost', () => {
    const r = breakEven({ initialCost: 12000, periodSaving: 2500, period: 'month', periods: 6 });
    assert.deepEqual(r.values, [-12000, -9500, -7000, -4500, -2000, 500, 3000]);
    assert.equal(r.breakEvenPeriod, 5);
    assert.equal(r.outcome, 'Paid back in month 5.');
  });

  test('not paid back within the horizon is said, not extrapolated', () => {
    const r = breakEven({ initialCost: 12000, periodSaving: 1000, period: 'month', periods: 6 });
    assert.equal(r.breakEvenPeriod, null);
    assert.equal(r.outcome, 'Not paid back within 6 months.');
    assert.equal(r.values.length, 7);
  });

  test('needs the cost, the saving and the horizon', () => {
    const r = breakEven({ initialCost: 12000 });
    assert.equal(r.code, 'missing_input');
    assert.deepEqual(r.missing, ['the saving per period', 'the number of periods to look at']);
  });

  test('uneven period values', () => {
    assert.deepEqual(cumulativeNet({ initialCost: 100, periodValues: [40, 40, 40], period: 'quarter' }).values, [-100, -60, -20, 20]);
    assert.equal(cumulativeNet({ initialCost: 100, periodValues: [40, null] }).code, 'missing_input');
  });
});

describe('weighted pipeline', () => {
  test('uses the stated probability of each stage', () => {
    const r = weightedPipeline({ stages: [{ label: 'Proposal', amount: 100000, probabilityPercent: 40 }, { label: 'Negotiation', amount: 50000, probabilityPercent: 70 }] });
    assert.equal(r.weightedTotal, 75000);
    assert.equal(r.total, 150000);
  });

  test('there is no default win probability', () => {
    const r = weightedPipeline({ stages: [{ label: 'Proposal', amount: 100000 }] });
    assert.equal(r.ok, false);
    assert.match(r.message, /no default probability/);
    assert.equal(weightedPipeline({ stages: [{ label: 'x', amount: 1, probabilityPercent: 140 }] }).code, 'bad_input');
  });
});

describe('function plots never evaluate text as code', () => {
  test('arithmetic in one variable', () => {
    const f = compileExpression('2x^2 - 3x + 1');
    assert.equal(f(2), 3);
    assert.equal(compileExpression('sin(pi/2) + e^0')(0), 2);
    assert.equal(compileExpression('-(x + 1)(x - 1)')(3), -8);
    assert.equal(compileExpression('2^3^2')(0), 512, 'power is right-associative');
  });

  test('anything that is not arithmetic is refused', () => {
    for (const bad of ['process.exit(1)', 'x; alert(1)', 'constructor', 'constructor(1)', '__proto__', 'toString(x)', 'x = 1', 'require("fs")', '`x`', 'x => x', 'eval(x)', '', '((((', 'y + 1']) {
      assert.equal(compileExpression(bad), null, bad);
    }
  });

  test('an over-long expression is refused', () => {
    assert.equal(compileExpression(`${'x+'.repeat(200)}1`), null);
  });

  test('a point where the function is undefined is a gap, never zero', () => {
    const r = evaluateFunction({ expression: '1/x', min: -1, max: 1, samples: 3 });
    assert.deepEqual(r.xs, [-1, 0, 1]);
    assert.deepEqual(r.ys, [-1, null, 1]);
    assert.equal(evaluateFunction({ expression: 'sqrt(x)', min: -4, max: -1, samples: 4 }).code, 'undefined_function');
  });

  test('the sample count is bounded', () => {
    assert.equal(evaluateFunction({ expression: 'x', min: 0, max: 1, samples: 100000 }).xs.length, 240);
    assert.equal(evaluateFunction({ expression: 'x', min: 1, max: 0 }).code, 'bad_input');
  });
});

describe('runCompute', () => {
  test('dispatches by name and refuses a calculation it does not have', () => {
    assert.equal(runCompute({ kind: 'compound_growth', baseline: 1, ratePercent: 1, period: 'year', periods: 1 }).ok, true);
    assert.equal(runCompute({ kind: 'monte_carlo', runs: 1000 }).code, 'unknown_calculation');
    assert.equal(runCompute(null).ok, false);
    assert.equal(runCompute('compound_growth').ok, false);
  });

  test('the rule set is versioned', () => {
    assert.equal(CALC_VERSION, 1);
    assert.deepEqual(periodLabels('quarter', 2), ['Now', 'Quarter 1', 'Quarter 2']);
  });
});

// ── found in review (2026-10-01) ─────────────────────────────────────────────
describe('rounding does not depend on the size of the number', () => {
  test('large values keep their digits', () => {
    assert.equal(roundTo(6000000000000, 2), 6000000000000);
    assert.equal(roundTo(6300000000000.0001, 2), 6300000000000);
    assert.equal(formatNumber(750000000.5), '750,000,000.5');
    assert.equal(formatNumber(881842349.6), '881,842,349.6');
    assert.equal(formatNumber(6e15), '6,000,000,000,000,000');
  });

  test('half still rounds away from zero, at every size and sign', () => {
    for (const [value, places, want] of [[1.005, 2, 1.01], [2.675, 2, 2.68], [-1.005, 2, -1.01], [0.125, 2, 0.13], [10927.2675, 2, 10927.27], [1e-7, 2, 0], [-0.004, 2, 0], [123456789.125, 2, 123456789.13]]) {
      assert.equal(roundTo(value, places), want, `${value} @ ${places}`);
    }
    assert.equal(Object.is(roundTo(-0.001, 2), 0), true, 'never negative zero');
  });
});

describe('a calculation does only what it says', () => {
  test('an up-front cost that is not a number is refused, never read as zero', () => {
    const r = cumulativeNet({ initialCost: '5,000', periodSaving: 500, periods: 4, period: 'month' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ['the up-front cost']);
  });

  test('a break-even takes one saving per period, and is judged on exact totals', () => {
    assert.equal(breakEven({ initialCost: 100, periodSaving: 50, periods: 2, periodValues: [1, 1, 1] }).ok, false);
    const close = breakEven({ initialCost: 100, periodSaving: 33.2, periods: 3, decimals: 0, period: 'month' });
    assert.equal(close.breakEvenPeriod, null, '−0.40 is not paid back, whatever it rounds to');
    assert.match(close.outcome, /Not paid back within 3 months/);
    const free = breakEven({ initialCost: 0, periodSaving: 0, periods: 3, period: 'month' });
    assert.equal(free.outcome, 'There is no up-front cost to pay back.');
    assert.equal(breakEven({ initialCost: 12000, periodSaving: 2500, periods: 8, period: 'month' }).outcome, 'Paid back in month 5.');
  });

  test('a rate given two ways that disagree, or as a bare 1, is ambiguous', () => {
    const base = { baseline: 100, period: 'month', periods: 2 };
    assert.equal(compoundGrowth({ ...base, ratePercent: 5, rate: 0.5 }).code, 'ambiguous_rate');
    assert.equal(compoundGrowth({ ...base, rate: 1 }).code, 'ambiguous_rate');
    assert.equal(compoundGrowth({ ...base, ratePercent: 5, rate: 0.05 }).ok, true);
    assert.equal(compoundGrowth({ ...base, rate: 0.05 }).values[1], 105);
  });

  test('no calculation returns a number it cannot state', () => {
    assert.equal(runCompute({ kind: 'compound_growth', baseline: 1e300, ratePercent: 5, period: 'month', periods: 3 }).code, 'too_large');
    assert.equal(runCompute({ kind: 'break_even', initialCost: 1e308, periodSaving: 1e308, periods: 3 }).code, 'too_large');
    assert.equal(runCompute([]).ok, false);
  });
});

describe('the expression parser reads what was meant, and refuses typos', () => {
  const at = (expression, x) => compileExpression(expression)?.(x);

  test('a variable is not a function: x(1-x) is a product', () => {
    assert.equal(at('x(1-x)', 0.25), 0.1875);
    assert.equal(at('(x)(1-x)', 0.25), 0.1875);
    assert.equal(at('pi(x)', 2), Math.PI * 2);
    assert.equal(at('sin(x)', 0), 0);
  });

  test('the minus, times and divide signs people paste are understood', () => {
    assert.equal(at('x − 1', 3), 2);
    assert.equal(at('2 × x ÷ 4', 6), 3);
  });

  test('a number beside a number is a typo, not a product', () => {
    assert.equal(compileExpression('1.2.3x'), null);
    assert.equal(compileExpression('10 000 x'), null);
    assert.equal(at('2x', 3), 6);
    assert.equal(at('3(x+1)', 1), 6);
  });

  test('the two branches of 1/x are not joined through the pole', () => {
    const r = evaluateFunction({ expression: '1/x', min: -3, max: 3, samples: 60 });
    assert.equal(r.ok, true);
    const firstPositive = r.ys.findIndex((y) => y !== null && y > 0);
    assert.equal(r.ys[firstPositive - 1], null, 'a gap separates the branches');
    const smooth = evaluateFunction({ expression: 'x^3', min: -2, max: 2, samples: 41 });
    assert.ok(smooth.ys.every((y) => y !== null), 'a sign change without a pole stays a line');
    assert.ok(evaluateFunction({ expression: 'sin(x)', min: -7, max: 7, samples: 61 }).ys.every((y) => y !== null));
  });

  test('a range too narrow to step through is refused', () => {
    assert.equal(evaluateFunction({ expression: 'x', min: 1, max: 1.0000000000000002 }).ok, false);
  });
});
