// Deterministic calculations behind chart artifacts.
//
// A model never supplies computed numbers. It names one of the calculations
// below and gives its INPUTS; this module produces the values. That is what
// makes a forecast reproducible, lets "make it 3%" change exactly one input,
// and keeps an invented output array from ever reaching a chart.
//
// Every function here is pure, synchronous and total: bad or missing input
// returns { ok: false, code, message, missing } and never throws, never
// guesses a default for a number nobody gave, and never evaluates text as code
// (the function plotter has its own tiny expression parser).
//
// CALC_VERSION is stored with a saved chart. Change a formula or a rounding
// rule here and bump it, so an old answer can say which rules produced it.

export const CALC_VERSION = 1;

export const CALC_LIMITS = Object.freeze({
  // Past this, a double no longer holds the cents (and the axis the digits).
  maxMagnitude: 1e15,
  maxPeriods: 120,
  maxStages: 12,
  maxSamples: 240,
  maxExpressionChars: 160,
});

const PERIODS = Object.freeze(['day', 'week', 'month', 'quarter', 'year']);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Round half away from zero at `decimals` places, without binary-float drift. */
export function roundTo(value, decimals = 2) {
  if (!isNum(value)) return value;
  const places = Number.isInteger(decimals) ? Math.max(0, Math.min(12, decimals)) : 2;
  // Round the DECIMAL the number prints as, not its binary value: 1.005 * 100
  // is 100.49999999999999, but "1.005e2" is exactly 100.5. (The earlier
  // relative nudge grew with the number and turned 6,000,000,000,000 into
  // 6,000,000,000,000.01.)
  const shown = String(value);
  if (/e/i.test(shown)) {
    // Exponent form: either too large to have decimals, or tiny.
    if (Math.abs(value) >= 1e21) return value;
    const fixed = Number(value.toFixed(places));
    return fixed === 0 ? 0 : fixed;
  }
  const shifted = Number(`${shown}e${places}`);
  if (!Number.isFinite(shifted) || Math.abs(shifted) >= 2 ** 53) return value;
  const rounded = Math.sign(shifted) * Math.round(Math.abs(shifted));
  const out = Number(`${rounded}e-${places}`);
  return out === 0 ? 0 : out;
}

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function missingInputs(input, required) {
  return required.filter(([key]) => !isNum(input?.[key])).map(([, label]) => label);
}

const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/** "Now", "Month 1", … for a run of `periods` steps. */
export function periodLabels(period, periods, includeBaseline = true) {
  const unit = cap(PERIODS.includes(period) ? period : 'period');
  const labels = includeBaseline ? ['Now'] : [];
  for (let t = 1; t <= periods; t += 1) labels.push(`${unit} ${t}`);
  return labels;
}

/** A percent given as `ratePercent: 5` (5%). A bare `rate` is accepted only as a decimal fraction. */
function readPercent(input, percentKey, decimalKey) {
  const hasPercent = isNum(input?.[percentKey]);
  const hasDecimal = isNum(input?.[decimalKey]);
  // Both given and saying different things: do not pick one.
  if (hasPercent && hasDecimal && Math.abs(input[percentKey] / 100 - input[decimalKey]) > 1e-9) return { ok: false, ambiguous: true };
  if (hasPercent) return { ok: true, fraction: input[percentKey] / 100, percent: input[percentKey] };
  if (hasDecimal) {
    const r = input[decimalKey];
    // 1 could be 1% or 100%; anything larger is plainly a percentage written in the wrong field.
    if (Math.abs(r) < 1) return { ok: true, fraction: r, percent: roundTo(r * 100, 6) };
    return { ok: false, ambiguous: true };
  }
  return { ok: false, ambiguous: false };
}

/**
 * Constant net growth: R(t) = R(0) × (1 + g)^t for integer t.
 *
 * `ratePercent` is the NET rate per `period`. A separate churn figure is not
 * silently netted against it — that is a different model (growthWithChurn).
 */
export function compoundGrowth(input = {}) {
  const missing = missingInputs(input, [['baseline', 'a starting value'], ['periods', 'the number of periods']]);
  const rate = readPercent(input, 'ratePercent', 'rate');
  if (!rate.ok && !rate.ambiguous) missing.push('a growth rate');
  if (!PERIODS.includes(input.period)) missing.push('the period the rate applies to (day, week, month, quarter or year)');
  if (missing.length) return fail('missing_input', `This forecast needs ${listOf(missing)}.`, { missing });
  if (rate.ambiguous) return fail('ambiguous_rate', 'The growth rate is ambiguous: give it as a percentage, for example ratePercent 5 for 5%.');
  if (isNum(input.churnPercent) || isNum(input.churn)) {
    return fail('rate_already_net', 'A net growth rate already includes churn. Give either a net rate, or separate growth and churn rates with the growth-with-churn model.');
  }
  if (input.ratePeriod && input.ratePeriod !== input.period) {
    return fail('rate_period_mismatch', `The rate is per ${input.ratePeriod} but the steps are per ${input.period}. State the rate for the same period as the steps.`);
  }
  const periods = Math.trunc(input.periods);
  if (periods < 1 || periods > CALC_LIMITS.maxPeriods || periods !== input.periods) {
    return fail('bad_periods', `The number of periods must be a whole number from 1 to ${CALC_LIMITS.maxPeriods}.`);
  }
  if (rate.fraction <= -1) return fail('bad_rate', 'A growth rate of -100% or lower leaves nothing to project.');
  const decimals = Number.isInteger(input.decimals) ? Math.max(0, Math.min(6, input.decimals)) : 2;
  const includeBaseline = input.includeBaseline !== false;
  const values = includeBaseline ? [roundTo(input.baseline, decimals)] : [];
  for (let t = 1; t <= periods; t += 1) values.push(roundTo(input.baseline * (1 + rate.fraction) ** t, decimals));
  return {
    ok: true,
    kind: 'compound_growth',
    values,
    labels: periodLabels(input.period, periods, includeBaseline),
    /** Which values are projected (everything after the baseline). */
    projectedFrom: includeBaseline ? 1 : 0,
    formula: 'R(t) = R(0) × (1 + g)^t',
    inputs: { baseline: input.baseline, ratePercent: rate.percent, period: input.period, periods },
    summary: `Constant ${formatPercent(rate.percent)} net growth per ${input.period} from ${formatNumber(input.baseline)} over ${periods} ${plural(input.period, periods)}.`,
  };
}

/**
 * Gross growth and churn given separately: R(t+1) = R(t) × (1 + g − c).
 * Both rates are per `period` and apply to the value at the start of the period.
 */
export function growthWithChurn(input = {}) {
  const missing = missingInputs(input, [['baseline', 'a starting value'], ['periods', 'the number of periods']]);
  const growth = readPercent(input, 'growthPercent', 'growth');
  const churn = readPercent(input, 'churnPercent', 'churn');
  if (!growth.ok) missing.push('a gross growth rate');
  if (!churn.ok) missing.push('a churn rate');
  if (!PERIODS.includes(input.period)) missing.push('the period the rates apply to');
  if (missing.length) return fail('missing_input', `This model needs ${listOf(missing)}.`, { missing });
  const periods = Math.trunc(input.periods);
  if (periods < 1 || periods > CALC_LIMITS.maxPeriods || periods !== input.periods) {
    return fail('bad_periods', `The number of periods must be a whole number from 1 to ${CALC_LIMITS.maxPeriods}.`);
  }
  const net = growth.fraction - churn.fraction;
  if (net <= -1) return fail('bad_rate', 'Churn exceeds growth by 100% or more; nothing is left to project.');
  const decimals = Number.isInteger(input.decimals) ? Math.max(0, Math.min(6, input.decimals)) : 2;
  const values = [roundTo(input.baseline, decimals)];
  let current = input.baseline;
  for (let t = 1; t <= periods; t += 1) {
    current *= 1 + net;
    values.push(roundTo(current, decimals));
  }
  return {
    ok: true,
    kind: 'growth_with_churn',
    values,
    labels: periodLabels(input.period, periods, true),
    projectedFrom: 1,
    formula: 'R(t+1) = R(t) × (1 + g − c)',
    inputs: { baseline: input.baseline, growthPercent: growth.percent, churnPercent: churn.percent, period: input.period, periods },
    summary: `${formatPercent(growth.percent)} gross growth and ${formatPercent(churn.percent)} churn per ${input.period} from ${formatNumber(input.baseline)} over ${periods} ${plural(input.period, periods)}.`,
  };
}

/** (to − from) / |from|, as a percentage. A zero starting value has no percentage change. */
export function percentageChange(input = {}) {
  const missing = missingInputs(input, [['from', 'the starting value'], ['to', 'the ending value']]);
  if (missing.length) return fail('missing_input', `A percentage change needs ${listOf(missing)}.`, { missing });
  if (input.from === 0) return fail('zero_denominator', 'A percentage change from zero is undefined; show the absolute change instead.');
  const percent = roundTo(((input.to - input.from) / Math.abs(input.from)) * 100, 2);
  return { ok: true, kind: 'percentage_change', percent, absolute: roundTo(input.to - input.from, 6), formula: '(to − from) ÷ |from| × 100', inputs: { from: input.from, to: input.to } };
}

/** The difference between two percentages, in percentage POINTS (not percent). */
export function percentagePointChange(input = {}) {
  const missing = missingInputs(input, [['fromPercent', 'the starting percentage'], ['toPercent', 'the ending percentage']]);
  if (missing.length) return fail('missing_input', `A percentage-point change needs ${listOf(missing)}.`, { missing });
  return { ok: true, kind: 'percentage_point_change', points: roundTo(input.toPercent - input.fromPercent, 2), formula: 'to% − from%', inputs: { fromPercent: input.fromPercent, toPercent: input.toPercent } };
}

/**
 * Stage-to-stage and overall conversion for ordered stage counts of ONE cohort.
 * A stage larger than the one before is reported, not hidden: it means re-entry
 * or mixed cohorts, and the rate for that step is left empty.
 */
export function stageConversion(input = {}) {
  const stages = Array.isArray(input.stages) ? input.stages : [];
  if (stages.length < 2) return fail('missing_input', 'Conversion needs counts for at least two stages.', { missing: ['counts for at least two stages'] });
  if (stages.length > CALC_LIMITS.maxStages) return fail('too_large', `At most ${CALC_LIMITS.maxStages} stages can be compared.`);
  const counts = stages.map((s) => (isNum(s?.count) ? s.count : isNum(s?.value) ? s.value : null));
  if (counts.some((c) => c === null)) return fail('missing_input', 'Every stage needs a count.', { missing: ['a count for every stage'] });
  if (counts.some((c) => c < 0)) return fail('negative_count', 'A stage count cannot be negative.');
  const notes = [];
  const steps = [];
  for (let i = 1; i < counts.length; i += 1) {
    const from = counts[i - 1];
    const to = counts[i];
    let rate = null;
    if (from === 0) notes.push(`"${labelOf(stages[i - 1])}" has no entries, so its conversion to "${labelOf(stages[i])}" is undefined.`);
    else if (to > from) notes.push(`"${labelOf(stages[i])}" is larger than "${labelOf(stages[i - 1])}": the stages are not one cohort, or people re-enter.`);
    else rate = roundTo((to / from) * 100, 1);
    steps.push({ from: labelOf(stages[i - 1]), to: labelOf(stages[i]), ratePercent: rate });
  }
  const overall = counts[0] > 0 && counts[counts.length - 1] <= counts[0] ? roundTo((counts[counts.length - 1] / counts[0]) * 100, 1) : null;
  return { ok: true, kind: 'stage_conversion', steps, overallPercent: overall, notes, formula: 'next stage ÷ previous stage × 100', inputs: { stages: stages.map((s, i) => ({ label: labelOf(s), count: counts[i] })) } };
}

/**
 * Cumulative net position over time: −initialCost, then + each period's value.
 * Period values are `periodValues` as given, or `periodSaving` repeated `periods` times.
 */
export function cumulativeNet(input = {}) {
  // "5,000" is not a number, and reading it as no cost at all drew a chart
  // that started from zero.
  if (input.initialCost !== undefined && input.initialCost !== null && !isNum(input.initialCost)) {
    return fail('missing_input', 'The up-front cost is not a number.', { missing: ['the up-front cost'] });
  }
  const initialCost = isNum(input.initialCost) ? input.initialCost : 0;
  let perPeriod = null;
  if (Array.isArray(input.periodValues) && input.periodValues.length > 0) {
    if (!input.periodValues.every(isNum)) return fail('missing_input', 'Every period needs a value.', { missing: ['a value for every period'] });
    perPeriod = input.periodValues;
  } else if (isNum(input.periodSaving) && isNum(input.periods)) {
    const periods = Math.trunc(input.periods);
    if (periods < 1 || periods > CALC_LIMITS.maxPeriods || periods !== input.periods) {
      return fail('bad_periods', `The number of periods must be a whole number from 1 to ${CALC_LIMITS.maxPeriods}.`);
    }
    perPeriod = Array.from({ length: periods }, () => input.periodSaving);
  } else {
    return fail('missing_input', 'A cumulative total needs a value per period and the number of periods.', { missing: ['a value per period', 'the number of periods'] });
  }
  if (perPeriod.length > CALC_LIMITS.maxPeriods) return fail('too_large', `At most ${CALC_LIMITS.maxPeriods} periods can be shown.`);
  const decimals = Number.isInteger(input.decimals) ? Math.max(0, Math.min(6, input.decimals)) : 2;
  const values = [roundTo(-initialCost, decimals)];
  const exact = [-initialCost];
  let running = -initialCost;
  for (const v of perPeriod) {
    running += v;
    exact.push(running);
    values.push(roundTo(running, decimals));
  }
  const period = PERIODS.includes(input.period) ? input.period : 'period';
  return { ok: true, kind: 'cumulative_net', exact, values, labels: periodLabels(period, perPeriod.length, true), projectedFrom: 1, formula: 'cumulative(t) = −initial cost + Σ period values', inputs: { initialCost, periodValues: perPeriod, period } };
}

/**
 * When a constant saving per period pays back an up-front cost, within a stated
 * horizon. Reports "not within the horizon" rather than extrapolating past it.
 */
export function breakEven(input = {}) {
  const missing = missingInputs(input, [['initialCost', 'the up-front cost'], ['periodSaving', 'the saving per period'], ['periods', 'the number of periods to look at']]);
  if (missing.length) return fail('missing_input', `Break-even needs ${listOf(missing)}.`, { missing });
  if (input.initialCost < 0) return fail('bad_input', 'The up-front cost cannot be negative.');
  // One model: a constant saving per period. A list of period values is a
  // different calculation (cumulative_net), and describing it as "saving X per
  // month" would describe a calculation that was not run.
  if (Array.isArray(input.periodValues)) {
    return fail('bad_input', 'A break-even takes one saving per period. For a different value each period, use the cumulative total.');
  }
  const net = cumulativeNet(input);
  if (!net.ok) return net;
  // First period whose cumulative position is no longer negative — judged on
  // the exact running total, never on the rounded figure that is displayed
  // (−0.40 rounds to 0 and used to read as "paid back").
  const nothingToRepay = input.initialCost === 0;
  const index = nothingToRepay ? 0 : net.exact.findIndex((v, i) => i > 0 && v >= 0);
  const period = PERIODS.includes(input.period) ? input.period : 'period';
  const { exact: _exact, ...shown } = net;
  if (nothingToRepay) {
    return { ...shown, kind: 'break_even', breakEvenPeriod: 0, formula: 'first period where −initial cost + saving × t ≥ 0', summary: `No up-front cost, saving ${formatNumber(input.periodSaving)} per ${period}, over ${net.values.length - 1} ${plural(period, net.values.length - 1)}.`, outcome: 'There is no up-front cost to pay back.', inputs: { initialCost: 0, periodSaving: input.periodSaving, periods: net.values.length - 1, period } };
  }
  return {
    ...shown,
    kind: 'break_even',
    breakEvenPeriod: index === -1 ? null : index,
    formula: 'first period where −initial cost + saving × t ≥ 0',
    summary: `Up-front cost ${formatNumber(input.initialCost)}, saving ${formatNumber(input.periodSaving)} per ${period}, over ${net.values.length - 1} ${plural(period, net.values.length - 1)}.`,
    outcome:
      index === -1
        ? `Not paid back within ${net.values.length - 1} ${plural(period, net.values.length - 1)}.`
        : `Paid back in ${period} ${index}.`,
    inputs: { initialCost: input.initialCost, periodSaving: input.periodSaving, periods: net.values.length - 1, period },
  };
}

/** Σ amount × probability. Every stage must carry its own stated probability: there is no default. */
export function weightedPipeline(input = {}) {
  const stages = Array.isArray(input.stages) ? input.stages : [];
  if (stages.length === 0) return fail('missing_input', 'A weighted forecast needs the amount and probability of each stage.', { missing: ['stage amounts', 'stage probabilities'] });
  if (stages.length > CALC_LIMITS.maxStages) return fail('too_large', `At most ${CALC_LIMITS.maxStages} stages can be weighted.`);
  const rows = [];
  for (const stage of stages) {
    const probability = isNum(stage?.probabilityPercent) ? stage.probabilityPercent / 100 : null;
    if (!isNum(stage?.amount) || probability === null) {
      return fail('missing_input', 'Every stage needs an amount and its own stated win probability. There is no default probability.', { missing: ['a win probability for every stage'] });
    }
    if (probability < 0 || probability > 1) return fail('bad_input', 'A probability must be between 0% and 100%.');
    rows.push({ label: labelOf(stage), amount: stage.amount, probabilityPercent: stage.probabilityPercent, weighted: roundTo(stage.amount * probability, 2) });
  }
  return {
    ok: true,
    kind: 'weighted_pipeline',
    rows,
    total: roundTo(rows.reduce((sum, r) => sum + r.amount, 0), 2),
    weightedTotal: roundTo(rows.reduce((sum, r) => sum + r.weighted, 0), 2),
    formula: 'Σ amount × stated probability',
    inputs: { stages: rows.map((r) => ({ label: r.label, amount: r.amount, probabilityPercent: r.probabilityPercent })) },
  };
}

// ── function plots ──────────────────────────────────────────────────────────
//
// A recursive-descent parser for arithmetic in one variable. Nothing is ever
// evaluated as JavaScript: identifiers are looked up in the two tables below
// and anything else is a syntax error.

// Maps, not object literals: a name such as "constructor" must not resolve to
// something inherited from Object.prototype.
const FUNCTIONS = new Map([
  ['sin', Math.sin], ['cos', Math.cos], ['tan', Math.tan], ['exp', Math.exp], ['sqrt', Math.sqrt], ['abs', Math.abs],
  ['ln', Math.log], ['log', Math.log10], ['log2', Math.log2], ['floor', Math.floor], ['ceil', Math.ceil],
]);
const CONSTANTS = new Map([['pi', Math.PI], ['e', Math.E]]);

function tokenise(text) {
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/^(),]))/gy;
  let pos = 0;
  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) {
      if (/^\s*$/.test(text.slice(pos))) break;
      return null;
    }
    if (m[1] !== undefined) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2] });
    else tokens.push({ t: 'op', v: m[3] === '**' ? '^' : m[3] });
    pos = re.lastIndex;
  }
  return tokens;
}

/** Compile `expression` in `variable` to a plain function, or null when it is not valid arithmetic. */
export function compileExpression(expression, variable = 'x') {
  // The signs people actually type and paste: − × ÷ · are − * / *.
  const text = String(expression ?? '').trim().replace(/[\u2212\u2013]/g, '-').replace(/[\u00d7\u00b7\u22c5]/g, '*').replace(/\u00f7/g, '/');
  if (!text || text.length > CALC_LIMITS.maxExpressionChars) return null;
  const tokens = tokenise(text);
  if (!tokens || tokens.length === 0) return null;
  let i = 0;
  let depth = 0;
  const peek = () => tokens[i];
  const take = (v) => (peek() && peek().t === 'op' && peek().v === v ? (i += 1, true) : false);

  function primary() {
    const tok = peek();
    if (!tok) throw new Error('end');
    if (tok.t === 'num') {
      i += 1;
      return () => tok.v;
    }
    if (tok.t === 'id') {
      i += 1;
      const name = tok.v.toLowerCase();
      // Only a function name takes an argument: "x(1-x)" is x times (1-x).
      const isValue = tok.v === variable || CONSTANTS.has(name);
      if (!isValue && take('(')) {
        const fn = FUNCTIONS.get(name);
        if (!fn) throw new Error('function');
        const arg = expr();
        if (!take(')')) throw new Error('paren');
        return (x) => fn(arg(x));
      }
      if (tok.v === variable) return (x) => x;
      if (CONSTANTS.has(name)) {
        const value = CONSTANTS.get(name);
        return () => value;
      }
      throw new Error('identifier');
    }
    if (take('(')) {
      depth += 1;
      if (depth > 24) throw new Error('depth');
      const inner = expr();
      if (!take(')')) throw new Error('paren');
      depth -= 1;
      return inner;
    }
    throw new Error('token');
  }
  function unary() {
    if (take('-')) {
      const operand = unary();
      return (x) => -operand(x);
    }
    if (take('+')) return unary();
    return power();
  }
  function power() {
    const base = primary();
    if (take('^')) {
      const exponent = unary(); // right-associative
      return (x) => base(x) ** exponent(x);
    }
    return base;
  }
  function term() {
    let left = unary();
    for (;;) {
      if (take('*')) {
        const l = left;
        const r = unary();
        left = (x) => l(x) * r(x);
      } else if (take('/')) {
        const l = left;
        const r = unary();
        left = (x) => l(x) / r(x);
      } else if (peek() && (peek().t === 'num' || peek().t === 'id' || (peek().t === 'op' && peek().v === '('))) {
        // implicit multiplication: 2x, 3(x+1) — but never number beside number:
        // "1.2.3x" and "10 000 x" are typos, not products.
        if (peek().t === 'num' && tokens[i - 1] && tokens[i - 1].t === 'num') throw new Error('juxtaposed numbers');
        const l = left;
        const r = unary();
        left = (x) => l(x) * r(x);
      } else return left;
    }
  }
  function expr() {
    let left = term();
    for (;;) {
      if (take('+')) {
        const l = left;
        const r = term();
        left = (x) => l(x) + r(x);
      } else if (take('-')) {
        const l = left;
        const r = term();
        left = (x) => l(x) - r(x);
      } else return left;
    }
  }
  try {
    const fn = expr();
    if (i !== tokens.length) return null;
    return fn;
  } catch {
    return null;
  }
}

/** Sample y = f(x) on [min, max]. Points where f is undefined are gaps (null), never zero. */
export function evaluateFunction(input = {}) {
  const fn = compileExpression(input.expression, input.variable || 'x');
  if (!fn) return fail('bad_expression', 'The expression is not plain arithmetic in one variable (numbers, + − × ÷ ^, parentheses, sin, cos, tan, exp, ln, log, sqrt, abs).');
  const missing = missingInputs(input, [['min', 'the start of the range'], ['max', 'the end of the range']]);
  if (missing.length) return fail('missing_input', `A function plot needs ${listOf(missing)}.`, { missing });
  if (!(input.max > input.min)) return fail('bad_input', 'The end of the range must be greater than its start.');
  if (!(input.max - input.min > Math.max(Math.abs(input.min), Math.abs(input.max)) * 1e-9)) return fail('bad_input', 'That range is too narrow to plot.');
  const samples = Math.max(2, Math.min(CALC_LIMITS.maxSamples, Number.isInteger(input.samples) ? input.samples : 61));
  const xs = [];
  const ys = [];
  for (let k = 0; k < samples; k += 1) {
    const x = input.min + ((input.max - input.min) * k) / (samples - 1);
    let y = null;
    try {
      const v = fn(x);
      y = isNum(v) && Math.abs(v) < 1e12 ? roundTo(v, 6) : null;
    } catch {
      y = null;
    }
    xs.push(roundTo(x, 6));
    ys.push(y);
  }
  if (ys.every((y) => y === null)) return fail('undefined_function', 'The function has no defined values on that range.');
  // A pole between two samples (1/x across 0) must not be joined by a line:
  // where the sign flips and the function blows up in between, the far sample
  // becomes a gap, so the two branches are drawn apart.
  for (let k = 1; k < samples; k += 1) {
    const a = ys[k - 1];
    const b = ys[k];
    if (a === null || b === null || Math.sign(a) === Math.sign(b) || a === 0 || b === 0) continue;
    let mid;
    try {
      mid = fn((xs[k - 1] + xs[k]) / 2);
    } catch {
      mid = Number.NaN;
    }
    if (!isNum(mid) || Math.abs(mid) > 4 * Math.max(Math.abs(a), Math.abs(b))) ys[k] = null;
  }
  return { ok: true, kind: 'function', xs, ys, formula: `y = ${String(input.expression).trim()}`, inputs: { expression: String(input.expression).trim(), min: input.min, max: input.max, samples } };
}

/** The calculations a chart payload may ask for, by name. */
export const COMPUTE_KINDS = Object.freeze(['compound_growth', 'growth_with_churn', 'cumulative_net', 'break_even', 'function']);

/** Run a named calculation. Unknown names are refused, never guessed. */
export function runCompute(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return fail('missing_input', 'No calculation was requested.');
  let out;
  switch (request.kind) {
    case 'compound_growth':
      out = compoundGrowth(request);
      break;
    case 'growth_with_churn':
      out = growthWithChurn(request);
      break;
    case 'cumulative_net': {
      const { exact: _exact, ...net } = cumulativeNet(request);
      out = net;
      break;
    }
    case 'break_even':
      out = breakEven(request);
      break;
    case 'function':
      out = evaluateFunction(request);
      break;
    default:
      return fail('unknown_calculation', 'That calculation is not one this app can run.');
  }
  if (!out.ok) return out;
  // Whatever the inputs, nothing non-finite or beyond what a double can state
  // exactly leaves here (1e308 compounding printed "Infinity" in the table).
  const numbers = [...(out.values || []), ...(out.ys || []), ...(out.xs || [])].filter((v) => v !== null && v !== undefined);
  if (numbers.some((v) => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > CALC_LIMITS.maxMagnitude)) {
    return fail('too_large', 'These numbers are too large to chart here.');
  }
  return out;
}

// ── small formatting helpers (also used by the chart table) ─────────────────

function labelOf(stage) {
  return String(stage?.label ?? stage?.name ?? '').trim() || 'stage';
}

function plural(word, n) {
  return n === 1 ? word : `${word}s`;
}

function listOf(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** 11576.25 → "11,576.25"; integers stay integers. Locale-independent. */
export function formatNumber(value, decimals) {
  if (!isNum(value)) return '';
  const places = Number.isInteger(decimals) ? decimals : Number.isInteger(value) ? 0 : Math.min(6, (String(roundTo(value, 6)).split('.')[1] || '').length);
  const fixed = roundTo(value, places).toFixed(places);
  const [whole, fraction] = fixed.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}

export function formatPercent(value) {
  return isNum(value) ? `${formatNumber(roundTo(value, 2))}%` : '';
}
