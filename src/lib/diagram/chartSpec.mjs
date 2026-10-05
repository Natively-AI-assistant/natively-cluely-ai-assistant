// The `natively-chart` payload: what a model may ask to have charted, and the
// checks it must pass before anything is drawn.
//
// A chart is written as a small JSON object in a fenced block tagged
// `natively-chart`. It is Natively's own bounded schema — not a Vega or
// Chart.js specification, not code, and it can name no URL: the only things it
// can hold are labels, numbers, and a request for one of the calculations in
// chartCompute.mjs.
//
// normaliseChartSpec(text) → { ok: true, chart, table, issues }
//                          | { ok: false, code, message, missing?, issues }
//
// What "ok" means: the payload is well formed AND honest about what its
// numbers are. Every series says whether it is observed, calculated, a
// scenario or illustrative; observed data names its source; a scenario states
// its assumptions; calculated values come from a named calculation or state
// their derivation. Missing numbers stay missing (null → a gap, never zero).
//
// Two kinds of correction are made here, and both are reported in `notes`:
//   - a representation that would mislead is swapped for one that does not
//     (a line over unordered categories becomes bars; a "pie" of things that
//     are not parts of one whole becomes bars);
//   - JSON slips a model makes (a trailing comma) are tolerated.
// Nothing here ever fills in, rescales or invents a value.
//
// Pure and synchronous. No DOM, no I/O.

import { clipText } from './svgText.mjs';
import { CALC_VERSION, CALC_LIMITS, runCompute, stageConversion, formatNumber, roundTo } from './chartCompute.mjs';

export const CHART_SPEC_VERSION = 1;

export const CHART_TYPES = Object.freeze(['line', 'bar', 'grouped-bar', 'stacked-bar', 'scatter', 'waterfall', 'heatmap', 'funnel', 'pie', 'quadrant']);
export const SERIES_STATUSES = Object.freeze(['observed', 'calculated', 'scenario', 'illustrative']);

export const CHART_LIMITS = Object.freeze({
  maxSourceChars: 12000,
  maxSeries: 6,
  maxCategories: 60,
  maxFunctionSamples: 240,
  maxPoints: 80,
  maxParts: 8,
  maxStages: 12,
  maxSteps: 20,
  maxHeatRows: 16,
  maxHeatCols: 10,
  maxComputes: 4,
  maxLabelChars: 60,
  maxTitleChars: 90,
  maxNoteChars: 200,
  maxNotes: 8,
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function text(value, max = CHART_LIMITS.maxLabelChars) {
  if (value === null || value === undefined) return '';
  // Strings only become labels: anything else a model put here is not text.
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  // Zero-width characters are not content ("\u200b" is not a source).
  return clipText(String(value).replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim(), max);
}

function textList(value, maxItems = CHART_LIMITS.maxNotes) {
  if (typeof value === 'string') return text(value, CHART_LIMITS.maxNoteChars) ? [text(value, CHART_LIMITS.maxNoteChars)] : [];
  if (!Array.isArray(value)) return [];
  return value.map((v) => text(v, CHART_LIMITS.maxNoteChars)).filter(Boolean).slice(0, maxItems);
}

function fail(code, message, extra = {}) {
  return { ok: false, code, message, issues: [], ...extra };
}

/** Remove a comma that is followed only by whitespace and a closing bracket — outside strings only. */
function dropTrailingCommas(raw) {
  let out = '';
  let inString = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        i += 1;
        if (i < raw.length) out += raw[i];
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j += 1;
      if (raw[j] === '}' || raw[j] === ']') continue; // the comma is dropped, the title "Sets {a, b, }" is not touched
    }
    out += ch;
  }
  return out;
}

/** Parse the block. Tolerates a BOM and trailing commas; nothing else is "fixed". */
export function parseChartJson(source) {
  const raw = String(source ?? '').replace(/^﻿/, '').trim();
  if (!raw) return { ok: false, code: 'empty' };
  if (raw.length > CHART_LIMITS.maxSourceChars) return { ok: false, code: 'too_large' };
  const attempts = [raw, dropTrailingCommas(raw)];
  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate);
      if (isObj(value)) return { ok: true, value };
      return { ok: false, code: 'not_an_object' };
    } catch {
      /* try the next form */
    }
  }
  return { ok: false, code: 'syntax' };
}

// Where a chart payload holds numbers. A model (a small or local one most
// often) writes some of them as text — "baseline":"10000", "values":["120",
// "134"] — and the chart was refused as if the number had not been given.
const NUMERIC_KEYS = new Set([
  'baseline', 'periods', 'rate', 'ratePercent', 'growth', 'growthPercent', 'churn', 'churnPercent', 'initialCost', 'periodSaving', 'periodValues',
  'min', 'max', 'decimals', 'samples', 'from', 'to', 'fromPercent', 'toPercent', 'value', 'values', 'count', 'percent', 'total', 'whole',
  'xMin', 'xMax', 'yMin', 'yMax', 'level', 'cells', 'x', 'y',
]);
const PLAIN_NUMBER_RE = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

/**
 * The same payload with numbers that were written as text read as numbers:
 * only under the keys that hold numbers, only text that is nothing but a
 * number ("10000", "10,000", "4.5"; "5%" under a …Percent key). Category
 * labels (`x.values`: "2023", "2024") stay text. Bounded walk.
 */
function unquoteNumbers(value, key = '', parentKey = '', budget = { left: 20000 }, depth = 0) {
  if (budget.left <= 0 || depth > 8) return value;
  budget.left -= 1;
  if (typeof value === 'string') {
    if (!NUMERIC_KEYS.has(key) || (key === 'values' && parentKey === 'x')) return value;
    let raw = value.trim();
    if (/Percent$/.test(key) || key === 'percent') raw = raw.replace(/\s?%$/, '');
    if (!PLAIN_NUMBER_RE.test(raw)) return value;
    const n = Number(raw.replace(/,/g, ''));
    return Number.isFinite(n) ? n : value;
  }
  if (Array.isArray(value)) return value.map((v) => unquoteNumbers(v, key, parentKey, budget, depth + 1));
  if (isObj(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = unquoteNumbers(v, k, key, budget, depth + 1);
    return out;
  }
  return value;
}

function numberOrNull(v) {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (isNum(v)) return { ok: true, value: v };
  return { ok: false };
}

/** Does this payload hold a number no chart can state (non-finite, or past 1e15)? Bounded walk. */
function hasUnchartableNumber(value, budget = { left: 20000 }, depth = 0) {
  if (budget.left <= 0 || depth > 8) return false;
  budget.left -= 1;
  if (typeof value === 'number') return !Number.isFinite(value) || Math.abs(value) > CALC_LIMITS.maxMagnitude;
  if (Array.isArray(value)) return value.some((v) => hasUnchartableNumber(v, budget, depth + 1));
  if (value !== null && typeof value === 'object') return Object.keys(value).some((k) => hasUnchartableNumber(value[k], budget, depth + 1));
  return false;
}

/** Something a person could check: letters or digits, not "n/a", "-", "?" or "tbd". */
function meaningful(value) {
  const t = String(value ?? '').trim();
  if ((t.match(/[\p{L}\p{N}]/gu) || []).length < 2) return false;
  return !/^(?:n\/?a|none|null|nil|unknown|tbd|tbc|todo|not (?:available|applicable|stated|known))\.?$/i.test(t);
}

function readValues(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const v of list) {
    const n = numberOrNull(v);
    if (!n.ok) return null;
    out.push(n.value);
  }
  return out;
}

function axis(input, fallbackLabel = '') {
  const a = isObj(input) ? input : {};
  return {
    label: text(a.label) || fallbackLabel,
    unit: text(a.unit, 16),
  };
}

// How a model words an input it supplied itself.
const MADE_UP_INPUT_RE = /\b(?:illustrative|made[- ]up|placeholder|hypothetical|sample|for illustration|not (?:your|the|an?) (?:actual|real)|to be confirmed|tbc|assumed (?:starting|baseline|initial)|example (?:baseline|starting|figure|number|value))\b/i;

const STATUS_BADGE = { scenario: 'Scenario', illustrative: 'Illustrative', calculated: 'Calculated', observed: '' };

/**
 * Validate and normalise a chart payload.
 *
 * @param {string | object} source the fenced block's text, or an already parsed object
 */
export function normaliseChartSpec(source) {
  let spec = source;
  if (typeof source === 'string') {
    const parsed = parseChartJson(source);
    if (!parsed.ok) {
      if (parsed.code === 'too_large') return fail('too_large', 'This chart is too large to draw here.');
      return fail('syntax', 'The chart data could not be read.');
    }
    spec = parsed.value;
  }
  if (!isObj(spec)) return fail('syntax', 'The chart data could not be read.');
  spec = unquoteNumbers(spec);
  // "v": "1" is version 1 written as text, not a newer format.
  const version = typeof spec.v === 'string' && /^\d+$/.test(spec.v.trim()) ? Number(spec.v) : spec.v;
  if (version !== undefined && version !== CHART_SPEC_VERSION) return fail('unsupported_version', 'This chart was made with a newer format than this app understands.');
  if (hasUnchartableNumber(spec)) return fail('too_large', 'These numbers are too large to chart here.');

  let type = text(spec.type, 20).toLowerCase().replace(/_/g, '-');
  if (type === 'grouped' || type === 'grouped bar') type = 'grouped-bar';
  if (type === 'stacked' || type === 'stacked bar') type = 'stacked-bar';
  if (type === 'column') type = 'bar';
  if (type === 'area') type = 'line';
  if (!CHART_TYPES.includes(type)) return fail('unsupported_type', 'That kind of chart is not supported here.');

  const notes = [];
  const badges = new Set();
  // "-" is not an assumption and "n/a" is not a source.
  const assumptions = textList(spec.assumptions).filter(meaningful);
  const sources = textList(spec.sources ?? spec.source).filter(meaningful);
  const chart = {
    v: CHART_SPEC_VERSION,
    type,
    title: text(spec.title, CHART_LIMITS.maxTitleChars),
    x: { ...axis(spec.x), kind: 'category', values: [] },
    y: { ...axis(spec.y), min: null, minReason: '' },
    series: [],
    band: null,
    points: [],
    quadrant: null,
    parts: [],
    stages: [],
    steps: [],
    heat: null,
    badges: [],
    notes,
    assumptions,
    sources,
    calc: null,
  };
  for (const n of textList(spec.note ?? spec.notes, 3)) notes.push(n);

  // Naming where the numbers come from IS the claim that they are real, so a
  // payload with a source and no "status" is read as observed (seen live: a
  // model wrote "sources" and forgot "status"). Nothing else is inferred: no
  // source and no status is still refused.
  const statusOf = (given, hasOwnSource) => (given || (hasOwnSource || sources.length > 0 ? 'observed' : ''));
  const checkStatus = (status, where, hasOwnSource, derivation) => {
    if (!SERIES_STATUSES.includes(status)) {
      return fail('no_status', `${where} does not say what its numbers are: observed, calculated, a scenario or illustrative.`);
    }
    if (status === 'observed' && !hasOwnSource && sources.length === 0) {
      return fail('no_source', `${where} is presented as real data but names no source.`, { missing: ['where the numbers come from'] });
    }
    if (status === 'scenario' && assumptions.length === 0) {
      return fail('no_assumptions', `${where} is a scenario but states no assumptions.`, { missing: ['the assumptions behind the scenario'] });
    }
    if (status === 'calculated' && !derivation) {
      return fail('no_derivation', `${where} is presented as calculated but does not say how.`, { missing: ['how the values were calculated'] });
    }
    if (STATUS_BADGE[status]) badges.add(STATUS_BADGE[status]);
    return null;
  };

  let result;
  if (type === 'pie') result = buildPie(spec, chart, notes, checkStatus, statusOf);
  else if (type === 'funnel') result = buildFunnel(spec, chart, notes, checkStatus, statusOf);
  else if (type === 'waterfall') result = buildWaterfall(spec, chart, notes, checkStatus, statusOf);
  else if (type === 'heatmap') result = buildHeatmap(spec, chart, notes, checkStatus, statusOf);
  else if (type === 'scatter' || type === 'quadrant') result = buildPoints(spec, chart, notes, checkStatus, statusOf);
  else result = buildCartesian(spec, chart, notes, checkStatus, assumptions, badges, statusOf);
  if (result && result.ok === false) return result;

  chart.badges = [...badges].filter(Boolean);
  if (chart.notes.length > CHART_LIMITS.maxNotes) chart.notes.length = CHART_LIMITS.maxNotes;
  return { ok: true, chart, table: chartTable(chart), issues: [] };
}

// ── line / bar / grouped / stacked ──────────────────────────────────────────

function buildCartesian(spec, chart, notes, checkStatus, assumptions, badges, statusOf) {
  const xIn = isObj(spec.x) ? spec.x : {};
  const kind = ['time', 'number', 'category'].includes(xIn.kind) ? xIn.kind : 'category';
  chart.x.kind = kind;
  let labels = Array.isArray(xIn.values) ? xIn.values.map((v) => (kind === 'number' && isNum(v) ? v : text(v, 32))) : [];

  // Calculations first: they may supply the x labels.
  const computes = spec.compute === undefined || spec.compute === null ? [] : Array.isArray(spec.compute) ? [...spec.compute] : [spec.compute];
  // A calculation written inside a series ({"name": …, "compute": {…}} with no
  // values) means the same thing and is read the same way (seen live).
  const nested = (s) => isObj(s) && isObj(s.compute) && s.values === undefined;
  for (const s of Array.isArray(spec.series) ? spec.series : []) {
    if (nested(s)) computes.push({ ...s.compute, name: s.compute.name ?? s.name, unit: s.compute.unit ?? s.unit });
  }
  if (computes.length > CHART_LIMITS.maxComputes) return fail('too_large', `At most ${CHART_LIMITS.maxComputes} scenarios can be compared in one chart.`);
  const computed = [];
  for (const request of computes) {
    const out = runCompute(request);
    if (!out.ok) return fail(out.code, out.message, out.missing ? { missing: out.missing } : {});
    computed.push({ request, out });
  }

  const series = [];
  const selfDeclaredIllustrative = MADE_UP_INPUT_RE.test([chart.title, ...assumptions, ...notes].join(' \n '));
  if (computed.length > 0) {
    const first = computed[0].out;
    if (first.kind === 'function') {
      if (computed.length > 1 && !computed.every((c) => c.out.kind === 'function' && c.out.xs.length === first.xs.length && c.out.xs[0] === first.xs[0] && c.out.xs[c.out.xs.length - 1] === first.xs[first.xs.length - 1])) {
        return fail('mismatched_scenarios', 'Functions plotted together must use the same range.');
      }
      chart.x.kind = 'number';
      labels = first.xs;
      chart.type = 'line';
    } else {
      if (!computed.every((c) => c.out.labels && c.out.labels.length === first.labels.length)) {
        return fail('mismatched_scenarios', 'Scenarios compared in one chart must cover the same periods.');
      }
      // The model's own labels are used only when there is one per value.
      if (labels.length !== first.labels.length) labels = first.labels;
      // "Now, Month 1, …" are steps in time whatever the payload called the
      // axis (a calculation on a "number" axis recursed until the stack ran out).
      labels = labels.map((l) => (typeof l === 'number' ? formatNumber(l) : l));
      chart.x.kind = 'time';
    }
    for (const { request, out } of computed) {
      const fallback = out.kind === 'function' ? out.formula : out.kind === 'break_even' || out.kind === 'cumulative_net' ? 'Cumulative net' : chart.y.label || 'Projection';
      // Two scenarios nobody named are told apart by what differs between them.
      const rateOf = isNum(request.ratePercent) ? `${formatNumber(request.ratePercent)}%` : isNum(request.rate) ? `${formatNumber(roundTo(request.rate * 100, 4))}%` : '';
      let name = text(request.name) || (computed.length > 1 && rateOf ? `${rateOf} per ${text(request.period, 12) || 'period'}` : fallback);
      if (series.some((s) => s.name === name)) name = `${name} (${series.length + 1})`;
      // "Illustrative $10,000 starting revenue, not your actual figure": a
      // payload that says its own input is made up is an illustration, and is
      // stamped as one, whatever else it calls itself.
      const status = out.kind === 'function' ? 'calculated' : selfDeclaredIllustrative ? 'illustrative' : 'scenario';
      series.push({
        name,
        status,
        values: out.kind === 'function' ? out.ys : out.values,
        projectedFrom: out.kind === 'function' ? null : out.projectedFrom,
        source: '',
        unit: text(request.unit, 16),
        computed: true,
      });
      badges.add(STATUS_BADGE[status]);
      if (out.summary) assumptions.unshift(out.summary);
    }
    chart.calc = {
      version: CALC_VERSION,
      runs: computed.map(({ out }) => ({ kind: out.kind, formula: out.formula, inputs: out.inputs, ...(out.breakEvenPeriod !== undefined ? { breakEvenPeriod: out.breakEvenPeriod } : {}) })),
    };
    for (const { out } of computed) if (out.outcome) notes.push(out.outcome);
    if (assumptions.length > CHART_LIMITS.maxNotes) assumptions.length = CHART_LIMITS.maxNotes;
  }

  const given = (Array.isArray(spec.series) ? spec.series : []).filter((s) => !nested(s));
  if (given.length + series.length > CHART_LIMITS.maxSeries) return fail('too_large', `At most ${CHART_LIMITS.maxSeries} series fit in one chart.`);
  for (const s of given) {
    if (!isObj(s)) return fail('syntax', 'The chart data could not be read.');
    const values = readValues(s.values);
    if (!values) return fail('bad_values', 'A series holds something that is not a number. Missing values must be left empty, not written as text.');
    const name = text(s.name) || `Series ${series.length + 1}`;
    const ownSource = meaningful(text(s.source, 200));
    const status = statusOf(text(s.status, 20).toLowerCase(), ownSource);
    const bad = checkStatus(status, `"${name}"`, ownSource, text(s.derivation, 200));
    if (bad) return bad;
    const projectedFrom = Number.isInteger(s.projectedFrom) && s.projectedFrom >= 0 ? s.projectedFrom : null;
    series.push({ name, status, values, projectedFrom, source: text(s.source, CHART_LIMITS.maxNoteChars), unit: text(s.unit, 16), derivation: text(s.derivation, CHART_LIMITS.maxNoteChars), computed: false });
  }
  if (series.length === 0) return fail('missing_input', 'There are no numbers to chart.', { missing: ['the values to chart'] });

  // A numeric axis is one only if every position on it is a number, in order.
  // Otherwise the points are categories ("2020" as text, or 5, 1, 3): drawn in
  // the order given, never placed by a value they do not have.
  if (chart.x.kind === 'number') {
    const asNumbers = labels.map((l) => (typeof l === 'number' ? l : typeof l === 'string' && /^-?\d+(?:\.\d+)?$/.test(l) ? Number(l) : Number.NaN));
    const ascending = asNumbers.every((n, i) => Number.isFinite(n) && (i === 0 || n > asNumbers[i - 1]));
    if (ascending) labels = asNumbers;
    else {
      chart.x.kind = 'category';
      labels = labels.map((l) => (typeof l === 'number' ? formatNumber(l) : String(l)));
    }
  }
  const maxX = chart.x.kind === 'number' ? CHART_LIMITS.maxFunctionSamples : computed.length > 0 ? CALC_LIMITS.maxPeriods + 1 : CHART_LIMITS.maxCategories;
  if (labels.length === 0) return fail('missing_input', 'The chart has no labels along its horizontal axis.', { missing: ['the labels along the horizontal axis'] });
  if (labels.length > maxX) return fail('too_large', 'This chart has too many points to draw here.');
  for (const s of series) {
    if (s.values.length !== labels.length) return fail('length_mismatch', `"${s.name}" has ${s.values.length} values for ${labels.length} labels.`);
    if (s.values.every((v) => v === null)) return fail('missing_input', `"${s.name}" has no values.`, { missing: [`values for "${s.name}"`] });
  }
  if (new Set(series.map((s) => s.name)).size !== series.length) return fail('duplicate_series', 'Two series share a name.');

  // One axis, one unit.
  const units = new Set(series.map((s) => s.unit || chart.y.unit).filter(Boolean));
  if (units.size > 1) return fail('mixed_units', `These series are in different units (${[...units].join(', ')}) and cannot share one axis.`);
  if (!chart.y.unit && units.size === 1) chart.y.unit = [...units][0];

  // A line needs an ordered axis, and more than one observation.
  if (chart.type === 'line') {
    const ordered = chart.x.kind === 'time' || chart.x.kind === 'number' || xIn.ordered === true;
    const mostPoints = Math.max(...series.map((s) => s.values.filter((v) => v !== null).length));
    if (!ordered) {
      chart.type = series.length > 1 ? 'grouped-bar' : 'bar';
      notes.push('Shown as bars: the categories have no order, so a line between them would suggest a trend that is not there.');
    } else if (mostPoints < 2) {
      chart.type = series.length > 1 ? 'grouped-bar' : 'bar';
      notes.push('Shown as a bar: one observation is not a trend.');
    }
  }
  if (chart.type === 'bar' && series.length > 1) chart.type = 'grouped-bar';
  if (chart.type === 'grouped-bar' && series.length === 1) chart.type = 'bar';
  if (chart.type === 'stacked-bar') {
    if (series.some((s) => s.values.some((v) => v !== null && v < 0))) return fail('negative_stack', 'Stacked bars cannot hold negative values; they would not add up to a meaningful total.');
    if (series.length === 1) chart.type = 'bar';
  }

  // Bars start at zero. A stated, explained exception is disclosed on the chart.
  const yIn = isObj(spec.y) ? spec.y : {};
  if (isNum(yIn.min) && yIn.min !== 0) {
    const reason = text(yIn.minReason, CHART_LIMITS.maxNoteChars);
    const drawn = series.flatMap((s) => s.values).filter((v) => v !== null);
    const smallest = drawn.length ? Math.min(...drawn) : 0;
    if (yIn.min > smallest) {
      // An axis that starts above a value cannot show that value at all.
      notes.push(`The vertical axis was asked to start at ${formatNumber(yIn.min)}, above the smallest value (${formatNumber(smallest)}), so that was not applied.`);
    } else if (chart.type === 'line') {
      chart.y.min = yIn.min;
    } else if (chart.type === 'stacked-bar') {
      // The height of a stack IS its total: it has to stand on zero.
      notes.push('Stacked bars start at zero: their height is the total.');
    } else if (meaningful(reason)) {
      chart.y.min = yIn.min;
      chart.y.minReason = reason;
      notes.push(`The vertical axis starts at ${formatNumber(yIn.min)}, not zero: ${reason}`);
    }
  }

  // A range drawn around a series is a scenario envelope unless it is a stated interval.
  if (isObj(spec.band)) {
    const low = readValues(spec.band.low);
    const high = readValues(spec.band.high);
    if (!low || !high || low.length !== labels.length || high.length !== labels.length) {
      return fail('bad_band', 'The range does not have a low and a high value for every label.');
    }
    if (low.some((v, i) => v !== null && high[i] !== null && v > high[i])) {
      return fail('bad_band', 'The range has a low value above its high value.');
    }
    // An interval is one only with a level that is a percentage and a source to check it against.
    const isInterval = spec.band.meaning === 'confidence-interval' && isNum(spec.band.level) && spec.band.level > 0 && spec.band.level < 100 && meaningful(text(spec.band.source, 200));
    chart.band = {
      // A range that is not a stated interval is never NAMED one.
      name: isInterval ? text(spec.band.name) || `${formatNumber(spec.band.level)}% confidence interval` : (/confiden|interval|\bci\b/i.test(text(spec.band.name)) ? '' : text(spec.band.name)) || 'Scenario range',
      low,
      high,
      meaning: isInterval ? 'confidence-interval' : 'scenario-range',
      level: isInterval ? spec.band.level : null,
      source: isInterval ? text(spec.band.source, CHART_LIMITS.maxNoteChars) : '',
    };
    if (!isInterval) {
      notes.push('The shaded range joins the low and high assumptions. It is a scenario range, not a confidence interval.');
      badges.add('Scenario');
    }
  }

  if (series.some((s) => s.values.some((v) => v === null))) {
    notes.push(series.some((s) => s.status === 'calculated' && s.values.some((v) => v === null))
      ? 'Gaps are where the function is undefined or too large to plot.'
      : 'Gaps are values that were not available; nothing is filled in.');
  }
  // A source given on a series is a source of the chart: it is listed with the
  // others (and so reaches the image, the table export and the phone).
  for (const s of series) {
    if (!s.source) continue;
    const line = series.length > 1 ? `${s.name}: ${s.source}` : s.source;
    if (!chart.sources.includes(line) && !chart.sources.includes(s.source) && chart.sources.length < CHART_LIMITS.maxNotes) chart.sources.push(line);
  }
  chart.x.values = labels;
  chart.series = series;
  return null;
}

// ── pie ─────────────────────────────────────────────────────────────────────

function readParts(list, max) {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (list.length > max) return 'too_large';
  const out = [];
  for (const p of list) {
    if (!isObj(p)) return null;
    const value = numberOrNull(p.value ?? p.count);
    if (!value.ok) return null;
    out.push({ label: text(p.label ?? p.name) || `Item ${out.length + 1}`, value: value.value });
  }
  return out;
}

function buildPie(spec, chart, notes, checkStatus, statusOf) {
  const parts = readParts(spec.parts, CHART_LIMITS.maxCategories);
  if (parts === 'too_large') return fail('too_large', 'This chart has too many parts to draw here.');
  if (!parts) return fail('missing_input', 'There are no parts to chart.', { missing: ['the parts and their values'] });
  const status = statusOf(text(spec.status, 20).toLowerCase(), false);
  const bad = checkStatus(status, 'This chart', false, text(spec.derivation, 200));
  if (bad) return bad;
  chart.y.unit = chart.y.unit || text(spec.unit, 16);
  const known = parts.filter((p) => p.value !== null);
  const whole = text(spec.whole, CHART_LIMITS.maxNoteChars);
  const toBars = (reason) => {
    chart.type = 'bar';
    chart.x.kind = 'category';
    chart.x.values = parts.map((p) => p.label);
    chart.series = [{ name: chart.y.label || chart.title || 'Value', status, values: parts.map((p) => p.value), projectedFrom: null, source: '', unit: chart.y.unit, computed: false }];
    notes.push(reason);
    if (parts.some((p) => p.value === null)) notes.push('Gaps are values that were not available; nothing is filled in.');
    return null;
  };
  if (known.some((p) => p.value < 0)) return toBars('Shown as bars: a share of a whole cannot be negative.');
  if (!whole) return toBars('Shown as bars: the parts were not stated to make up one whole, so shares of a circle would mislead.');
  if (known.length !== parts.length) return toBars('Shown as bars: some parts have no value, so their share of the whole is unknown.');
  const positive = known.filter((p) => p.value > 0);
  if (positive.length < 2) return toBars('Shown as bars: a circle needs at least two parts with a value.');
  if (positive.length > CHART_LIMITS.maxParts) return toBars(`Shown as bars: more than ${CHART_LIMITS.maxParts} parts are hard to compare in a circle.`);
  const zeros = known.filter((p) => p.value === 0).map((p) => p.label);
  if (zeros.length) notes.push(`Not drawn because the value is zero: ${zeros.join(', ')}.`);
  const sum = positive.reduce((acc, p) => acc + p.value, 0);
  // The whole, when its size was stated: a `total`, or 100 when the parts are
  // percentages. Parts that fall short leave a remainder, shown as such; parts
  // that exceed it are not shares of that whole. (Without this, 40% and 30% of
  // "all respondents" were drawn as 57% and 43%.)
  const stated = isNum(spec.total) && spec.total > 0 ? spec.total : /^(?:%|percent|pct)$/i.test(chart.y.unit) ? 100 : null;
  const slices = positive.map((p) => ({ label: p.label, value: p.value }));
  let total = sum;
  if (stated !== null) {
    const tolerance = Math.max(stated * 0.005, 1e-9);
    if (sum > stated + tolerance) return toBars(`Shown as bars: the parts add up to ${formatNumber(roundTo(sum, 2))}, more than the stated whole of ${formatNumber(stated)}.`);
    if (sum < stated - tolerance) {
      slices.push({ label: 'Not stated', value: roundTo(stated - sum, 6) });
      notes.push(`The parts add up to ${formatNumber(roundTo(sum, 2))} of ${formatNumber(stated)}; the rest is shown as "Not stated".`);
    }
    total = stated;
  }
  if (slices.length > CHART_LIMITS.maxParts + 1) return toBars(`Shown as bars: more than ${CHART_LIMITS.maxParts} parts are hard to compare in a circle.`);
  chart.parts = slices.map((p) => ({ label: p.label, value: p.value, percent: roundTo((p.value / total) * 100, 1) }));
  chart.assumptions.unshift(`The whole is ${whole}.`);
  return null;
}

// ── funnel (ordered stage counts) ───────────────────────────────────────────

function buildFunnel(spec, chart, notes, checkStatus, statusOf) {
  const stages = readParts(spec.stages, CHART_LIMITS.maxStages);
  if (stages === 'too_large') return fail('too_large', `At most ${CHART_LIMITS.maxStages} stages can be compared.`);
  if (!stages) return fail('missing_input', 'There are no stage counts to chart. Without counts this is a process, not a funnel.', { missing: ['a count for each stage'] });
  if (stages.some((s) => s.value === null)) return fail('missing_input', 'Every stage needs a count. Without counts this is a process, not a funnel.', { missing: ['a count for every stage'] });
  const status = statusOf(text(spec.status, 20).toLowerCase(), false);
  const bad = checkStatus(status, 'This funnel', false, text(spec.derivation, 200));
  if (bad) return bad;
  const conversion = stageConversion({ stages: stages.map((s) => ({ label: s.label, count: s.value })) });
  if (!conversion.ok) return fail(conversion.code, conversion.message, conversion.missing ? { missing: conversion.missing } : {});
  chart.stages = stages.map((s, i) => ({ label: s.label, value: s.value, ratePercent: i === 0 ? null : conversion.steps[i - 1].ratePercent }));
  chart.calc = { version: CALC_VERSION, runs: [{ kind: 'stage_conversion', formula: conversion.formula, inputs: conversion.inputs, overallPercent: conversion.overallPercent }] };
  for (const n of conversion.notes) notes.push(n);
  const cohort = text(spec.cohort, CHART_LIMITS.maxNoteChars);
  if (cohort) chart.assumptions.unshift(`Cohort: ${cohort}.`);
  else notes.push('The cohort and time window were not stated; the rates only mean something if every stage counts the same group.');
  chart.y.unit = chart.y.unit || text(spec.unit, 16);
  return null;
}

// ── waterfall ───────────────────────────────────────────────────────────────

function buildWaterfall(spec, chart, notes, checkStatus, statusOf) {
  const list = Array.isArray(spec.steps) ? spec.steps : null;
  if (!list || list.length < 2) return fail('missing_input', 'A waterfall needs a starting value and at least one change.', { missing: ['a starting value', 'the changes'] });
  if (list.length > CHART_LIMITS.maxSteps) return fail('too_large', 'This chart has too many steps to draw here.');
  const status = statusOf(text(spec.status, 20).toLowerCase(), false);
  const bad = checkStatus(status, 'This chart', false, text(spec.derivation, 200));
  if (bad) return bad;
  let running = 0;
  const steps = [];
  for (let i = 0; i < list.length; i += 1) {
    const s = list[i];
    if (!isObj(s)) return fail('syntax', 'The chart data could not be read.');
    const kind = ['start', 'delta', 'total'].includes(s.kind) ? s.kind : i === 0 ? 'start' : 'delta';
    const label = text(s.label ?? s.name) || `Step ${i + 1}`;
    if (kind === 'total') {
      // A stated total must be the sum of what came before; it is never trusted over the steps.
      if (isNum(s.value) && Math.abs(s.value - running) > 0.005 + Math.abs(running) * 1e-9) {
        return fail('total_mismatch', `"${label}" is given as ${formatNumber(s.value)}, but the steps before it add up to ${formatNumber(roundTo(running, 2))}.`);
      }
      steps.push({ label, kind, value: roundTo(running, 2), start: 0, end: roundTo(running, 2) });
      continue;
    }
    if (!isNum(s.value)) return fail('missing_input', `"${label}" has no value.`, { missing: [`a value for "${label}"`] });
    if (kind === 'start') {
      running = s.value;
      steps.push({ label, kind, value: s.value, start: 0, end: roundTo(running, 2) });
    } else {
      const start = running;
      running += s.value;
      steps.push({ label, kind, value: s.value, start: roundTo(start, 2), end: roundTo(running, 2) });
    }
  }
  chart.steps = steps;
  chart.y.unit = chart.y.unit || text(spec.unit, 16);
  chart.calc = { version: CALC_VERSION, runs: [{ kind: 'running_total', formula: 'running total = start + Σ changes', inputs: { steps: steps.map((s) => ({ label: s.label, kind: s.kind, value: s.value })) } }] };
  return null;
}

// ── heatmap / categorical matrix ────────────────────────────────────────────

function buildHeatmap(spec, chart, notes, checkStatus, statusOf) {
  const rows = Array.isArray(spec.rows) ? spec.rows.map((r) => text(r, 40)) : [];
  const cols = Array.isArray(spec.cols ?? spec.columns) ? (spec.cols ?? spec.columns).map((c) => text(c, 24)) : [];
  const cells = Array.isArray(spec.cells) ? spec.cells : [];
  if (rows.length === 0 || cols.length === 0) return fail('missing_input', 'A matrix needs row and column labels.', { missing: ['row labels', 'column labels'] });
  if (rows.length > CHART_LIMITS.maxHeatRows || cols.length > CHART_LIMITS.maxHeatCols) return fail('too_large', 'This matrix is too large to draw here.');
  if (cells.length !== rows.length || cells.some((r) => !Array.isArray(r) || r.length !== cols.length)) {
    return fail('length_mismatch', 'The matrix does not have one cell for every row and column.');
  }
  const status = statusOf(text(spec.status, 20).toLowerCase(), false);
  const bad = checkStatus(status, 'This matrix', false, text(spec.derivation, 200));
  if (bad) return bad;
  const flat = cells.flat();
  const numeric = flat.every((c) => c === null || c === undefined || c === '' || isNum(c)) && flat.some(isNum);
  const out = cells.map((r) => r.map((c) => (numeric ? (isNum(c) ? c : null) : c === null || c === undefined ? '' : text(c, 24))));
  chart.heat = { rows, cols, cells: out, numeric };
  chart.y.unit = chart.y.unit || text(spec.unit, 16);
  if (flat.some((c) => c === null || c === undefined || c === '')) notes.push('Empty cells are unknown, not zero.');
  return null;
}

// ── scatter / quadrant ──────────────────────────────────────────────────────

function buildPoints(spec, chart, notes, checkStatus, statusOf) {
  const list = Array.isArray(spec.points) ? spec.points : null;
  if (!list || list.length === 0) return fail('missing_input', 'There are no points to plot.', { missing: ['the points to plot'] });
  if (list.length > CHART_LIMITS.maxPoints) return fail('too_large', 'This chart has too many points to draw here.');
  const status = statusOf(text(spec.status, 20).toLowerCase(), false);
  const bad = checkStatus(status, 'This chart', false, text(spec.derivation, 200));
  if (bad) return bad;
  const points = [];
  const unplaced = [];
  for (const p of list) {
    if (!isObj(p)) return fail('syntax', 'The chart data could not be read.');
    const label = text(p.label ?? p.name, 32);
    if (!isNum(p.x) || !isNum(p.y)) {
      // An item without both scores is listed, never given an arbitrary position.
      if (label) unplaced.push(label);
      continue;
    }
    points.push({ label, x: p.x, y: p.y });
  }
  if (points.length === 0) return fail('missing_input', 'None of the items has both values, so nothing can be placed.', { missing: ['both values for at least one item'] });
  if (unplaced.length) notes.push(`Not placed because a score is missing: ${unplaced.join(', ')}.`);
  chart.points = points;
  if (chart.type === 'quadrant') {
    const q = isObj(spec.quadrant) ? spec.quadrant : {};
    const rubric = text(q.rubric, CHART_LIMITS.maxNoteChars);
    if (!rubric) return fail('no_rubric', 'A quadrant needs the rubric its scores came from. Without scores, a comparison table is the honest view.', { missing: ['the scoring rubric'] });
    const xMin = isNum(q.xMin) ? q.xMin : 0;
    const xMax = isNum(q.xMax) ? q.xMax : 10;
    const yMin = isNum(q.yMin) ? q.yMin : 0;
    const yMax = isNum(q.yMax) ? q.yMax : 10;
    if (!(xMax > xMin) || !(yMax > yMin)) return fail('bad_input', 'The quadrant ranges are not valid.');
    if (points.some((p) => p.x < xMin || p.x > xMax || p.y < yMin || p.y > yMax)) return fail('out_of_range', 'A score is outside the stated scale.');
    const labels = Array.isArray(q.labels) ? q.labels.slice(0, 4).map((l) => text(l, 24)) : [];
    chart.quadrant = { rubric, xMin, xMax, yMin, yMax, labels };
    chart.assumptions.unshift(`Scores: ${rubric}`);
  }
  return null;
}

// ── table + CSV + description ───────────────────────────────────────────────

const withUnit = (label, unit) => (unit ? `${label} (${unit})` : label);

/** The data behind a chart as a plain table: what the Data tab shows and the CSV exports. */
export function chartTable(chart) {
  const unit = chart.y.unit;
  if (chart.type === 'pie') {
    return { columns: [chart.x.label || 'Part', withUnit(chart.y.label || 'Value', unit), 'Share'], rows: chart.parts.map((p) => [p.label, p.value, `${formatNumber(p.percent, 1)}%`]) };
  }
  if (chart.type === 'funnel') {
    return {
      columns: [chart.x.label || 'Stage', withUnit(chart.y.label || 'Count', unit), 'From previous stage'],
      rows: chart.stages.map((s) => [s.label, s.value, s.ratePercent === null ? '' : `${formatNumber(s.ratePercent, 1)}%`]),
    };
  }
  if (chart.type === 'waterfall') {
    return { columns: [chart.x.label || 'Step', withUnit('Change', unit), withUnit('Running total', unit)], rows: chart.steps.map((s) => [s.label, s.kind === 'total' ? '' : s.value, s.end]) };
  }
  if (chart.type === 'heatmap') {
    return { columns: [chart.x.label || '', ...chart.heat.cols], rows: chart.heat.rows.map((r, i) => [r, ...chart.heat.cells[i].map((c) => (c === null ? '' : c))]) };
  }
  if (chart.type === 'scatter' || chart.type === 'quadrant') {
    return { columns: ['Item', withUnit(chart.x.label || 'x', chart.x.unit), withUnit(chart.y.label || 'y', unit)], rows: chart.points.map((p) => [p.label, p.x, p.y]) };
  }
  const columns = [withUnit(chart.x.label || (chart.x.kind === 'time' ? 'Period' : 'Category'), chart.x.unit), ...chart.series.map((s) => withUnit(s.name, s.unit || unit))];
  if (chart.band) columns.push(`${chart.band.name} low`, `${chart.band.name} high`);
  const rows = chart.x.values.map((label, i) => {
    const row = [label, ...chart.series.map((s) => (s.values[i] === null ? '' : s.values[i]))];
    if (chart.band) row.push(chart.band.low[i] ?? '', chart.band.high[i] ?? '');
    return row;
  });
  return { columns, rows };
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // A leading =, +, - or @ would be read as a formula by a spreadsheet.
  const guarded = typeof value === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** RFC 4180 CSV of a chart's table, followed by its status, assumptions and sources. */
export function chartCsv(chart, table = chartTable(chart)) {
  const lines = [table.columns.map(csvCell).join(','), ...table.rows.map((r) => r.map(csvCell).join(','))];
  const meta = [];
  if (chart.title) meta.push(['Title', chart.title]);
  if (chart.badges.length) meta.push(['Status', chart.badges.join('; ')]);
  for (const a of chart.assumptions) meta.push(['Assumption', a]);
  for (const s of chart.sources) meta.push(['Source', s]);
  for (const n of chart.notes) meta.push(['Note', n]);
  if (chart.calc) for (const run of chart.calc.runs) meta.push(['Calculation', `${run.formula} (rules v${chart.calc.version})`]);
  if (meta.length) lines.push('', ...meta.map((m) => m.map(csvCell).join(',')));
  return `${lines.join('\r\n')}\r\n`;
}

const TYPE_WORDS = {
  line: 'Line chart', bar: 'Bar chart', 'grouped-bar': 'Grouped bar chart', 'stacked-bar': 'Stacked bar chart', scatter: 'Scatter plot',
  waterfall: 'Waterfall chart', heatmap: 'Matrix', funnel: 'Stage counts', pie: 'Share of a whole', quadrant: 'Quadrant',
};

/** The card title for a chart. */
export function chartLabel(chart) {
  if (chart.calc && chart.calc.runs.some((r) => r.kind === 'compound_growth' || r.kind === 'growth_with_churn')) return 'Forecast';
  if (chart.calc && chart.calc.runs.some((r) => r.kind === 'break_even')) return 'Break-even';
  return chart.type === 'heatmap' ? 'Matrix' : chart.type === 'funnel' ? 'Stage counts' : chart.type === 'quadrant' ? 'Quadrant' : 'Chart';
}

/** One or two plain sentences saying what the chart shows, for a screen reader and the phone. */
export function describeChart(chart) {
  const what = TYPE_WORDS[chart.type] || 'Chart';
  const title = chart.title ? `: ${chart.title}` : '';
  const status = chart.badges.length ? ` ${chart.badges.join(', ')}.` : '';
  const unit = chart.y.unit ? ` ${chart.y.unit}` : '';
  let detail = '';
  if (chart.series.length) {
    detail = chart.series
      .map((s) => {
        const known = s.values.map((v, i) => [v, i]).filter(([v]) => v !== null);
        if (known.length === 0) return '';
        const [first] = known[0];
        const [last, lastIndex] = known[known.length - 1];
        return known.length === 1
          ? `${s.name}: ${formatNumber(first)}${unit} at ${chart.x.values[known[0][1]]}`
          : `${s.name} goes from ${formatNumber(first)}${unit} to ${formatNumber(last)}${unit} at ${chart.x.values[lastIndex]}`;
      })
      .filter(Boolean)
      .join('; ');
  } else if (chart.parts.length) detail = chart.parts.map((p) => `${p.label} ${formatNumber(p.percent, 1)}%`).join(', ');
  else if (chart.stages.length) detail = chart.stages.map((s) => `${s.label} ${formatNumber(s.value)}`).join(', ');
  else if (chart.steps.length) detail = `from ${formatNumber(chart.steps[0].end)}${unit} to ${formatNumber(chart.steps[chart.steps.length - 1].end)}${unit}`;
  else if (chart.points.length) detail = `${chart.points.length} ${chart.points.length === 1 ? 'item' : 'items'} placed`;
  else if (chart.heat) detail = `${chart.heat.rows.length} rows by ${chart.heat.cols.length} columns`;
  return `${what}${title}.${detail ? ` ${detail}.` : ''}${status}`.trim();
}
