// The `natively-chart` payload: what is accepted, what is refused, what is
// corrected, and what the drawing keeps true.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseChartSpec, parseChartJson, chartCsv, chartLabel, describeChart, CHART_LIMITS } from '../chartSpec.mjs';
import { renderChartSvg, niceTicks } from '../chartSvg.mjs';
import { compileVisualSource, checkVisualSource } from '../visualArtifact.mjs';
import { isSafeDiagramSvg } from '../diagramPolicy.mjs';

const ok = (spec) => {
  const r = normaliseChartSpec(typeof spec === 'string' ? spec : JSON.stringify(spec));
  assert.equal(r.ok, true, r.message);
  return r;
};
const bad = (spec) => {
  const r = normaliseChartSpec(typeof spec === 'string' ? spec : JSON.stringify(spec));
  assert.equal(r.ok, false, 'expected the payload to be refused');
  return r;
};
const FORECAST = { v: 1, type: 'line', title: 'Monthly revenue at 5% net growth', x: { label: 'Month' }, y: { label: 'Revenue', unit: 'USD' }, compute: { kind: 'compound_growth', baseline: 10000, ratePercent: 5, period: 'month', periods: 3 } };
const OBSERVED = { v: 1, type: 'line', title: 'Tickets', x: { kind: 'time', label: 'Week', values: ['W1', 'W2', 'W3', 'W4'] }, y: { label: 'Tickets' }, series: [{ name: 'Tickets', status: 'observed', values: [120, 134, null, 150], source: 'support export' }] };

describe('the forecast fixture, end to end', () => {
  test('the app computes the values; the payload only held inputs', () => {
    const { chart, table } = ok(FORECAST);
    assert.deepEqual(chart.series[0].values, [10000, 10500, 11025, 11576.25]);
    assert.deepEqual(chart.x.values, ['Now', 'Month 1', 'Month 2', 'Month 3']);
    assert.deepEqual(table.rows, [['Now', 10000], ['Month 1', 10500], ['Month 2', 11025], ['Month 3', 11576.25]]);
    assert.deepEqual(table.columns, ['Month', 'Revenue (USD)']);
  });

  test('it is labelled a scenario, with the assumption in words', () => {
    const { chart } = ok(FORECAST);
    assert.deepEqual(chart.badges, ['Scenario']);
    assert.equal(chart.series[0].status, 'scenario');
    assert.equal(chart.series[0].projectedFrom, 1);
    assert.equal(chart.assumptions[0], 'Constant 5% net growth per month from 10,000 over 3 months.');
    assert.equal(chartLabel(chart), 'Forecast');
  });

  test('the stored calculation says which rules produced it', () => {
    const { chart } = ok(FORECAST);
    assert.equal(chart.calc.version, 1);
    assert.equal(chart.calc.runs[0].kind, 'compound_growth');
    assert.deepEqual(chart.calc.runs[0].inputs, { baseline: 10000, ratePercent: 5, period: 'month', periods: 3 });
  });

  test('a model-supplied array is not used for a computed series', () => {
    // The payload tries to state its own results next to the calculation.
    const { chart } = ok({ ...FORECAST, series: [], values: [10000, 12000, 15000, 20000] });
    assert.deepEqual(chart.series[0].values, [10000, 10500, 11025, 11576.25]);
  });

  test('title, table, description and CSV agree exactly', () => {
    const { chart, table } = ok(FORECAST);
    const csv = chartCsv(chart, table);
    assert.ok(csv.startsWith('Month,Revenue (USD)\r\nNow,10000\r\nMonth 1,10500\r\nMonth 2,11025\r\nMonth 3,11576.25\r\n'));
    assert.match(csv, /Status,Scenario/);
    assert.match(csv, /Assumption,"?Constant 5% net growth per month from "?"?10,000/);
    assert.match(csv, /Calculation,R\(t\) = R\(0\) × \(1 \+ g\)\^t \(rules v1\)/);
    assert.equal(describeChart(chart), 'Line chart: Monthly revenue at 5% net growth. Revenue goes from 10,000 USD to 11,576.25 USD at Month 3. Scenario.');
    const svg = renderChartSvg(chart).svg;
    for (const value of ['10,000', '10,500', '11,025', '11,576.25']) assert.ok(svg.includes(`>${value}<`), `${value} is not written on the chart`);
  });

  test('two scenarios in one chart must cover the same periods', () => {
    const two = ok({ v: 1, type: 'line', y: { label: 'Revenue' }, compute: [{ ...FORECAST.compute, name: '5%' }, { ...FORECAST.compute, ratePercent: 3, name: '3%' }] });
    assert.deepEqual(two.chart.series.map((s) => s.name), ['5%', '3%']);
    assert.deepEqual(two.chart.series[1].values, [10000, 10300, 10609, 10927.27]);
    assert.equal(bad({ v: 1, type: 'line', compute: [FORECAST.compute, { ...FORECAST.compute, periods: 6 }] }).code, 'mismatched_scenarios');
  });
});

describe('a chart is refused rather than invented', () => {
  test('a forecast with no baseline names what is missing', () => {
    const r = bad({ v: 1, type: 'line', compute: { kind: 'compound_growth', ratePercent: 5, period: 'month', periods: 3 } });
    assert.equal(r.code, 'missing_input');
    assert.deepEqual(r.missing, ['a starting value']);
  });

  test('observed data with no source', () => {
    const r = bad({ ...OBSERVED, series: [{ name: 'Tickets', status: 'observed', values: [1, 2, 3, 4] }] });
    assert.equal(r.code, 'no_source');
    assert.match(r.message, /real data but names no source/);
  });

  test('a series that does not say what its numbers are', () => {
    assert.equal(bad({ ...OBSERVED, series: [{ name: 'Tickets', values: [1, 2, 3, 4] }] }).code, 'no_status');
  });

  test('a scenario with no assumptions', () => {
    assert.equal(bad({ ...OBSERVED, series: [{ name: 'Plan', status: 'scenario', values: [1, 2, 3, 4] }] }).code, 'no_assumptions');
  });

  test('"calculated" values with no derivation', () => {
    assert.equal(bad({ ...OBSERVED, series: [{ name: 'Rate', status: 'calculated', values: [1, 2, 3, 4] }] }).code, 'no_derivation');
    ok({ ...OBSERVED, series: [{ name: 'Rate', status: 'calculated', values: [1, 2, 3, 4], derivation: 'closed ÷ opened, from the export' }] });
  });

  test('a value written as text is not a number', () => {
    assert.equal(bad({ ...OBSERVED, series: [{ name: 'T', status: 'observed', source: 'CRM export', values: [1, 'about 2', 3, 4] }] }).code, 'bad_values');
  });

  test('a funnel without counts is a process, not a funnel', () => {
    const r = bad({ v: 1, type: 'funnel', status: 'observed', sources: ['CRM export'], stages: [{ label: 'Lead' }, { label: 'Won' }] });
    assert.equal(r.code, 'missing_input');
    assert.match(r.message, /process, not a funnel/);
  });

  test('a quadrant without a rubric', () => {
    const r = bad({ v: 1, type: 'quadrant', status: 'observed', sources: ['CRM export'], points: [{ label: 'A', x: 1, y: 2 }] });
    assert.equal(r.code, 'no_rubric');
  });

  test('a waterfall whose stated total disagrees with its steps', () => {
    const r = bad({ v: 1, type: 'waterfall', status: 'observed', sources: ['invoice'], steps: [{ label: 'Start', value: 100, kind: 'start' }, { label: 'Fee', value: 20 }, { label: 'End', value: 150, kind: 'total' }] });
    assert.equal(r.code, 'total_mismatch');
    assert.match(r.message, /add up to 120/);
  });

  test('an unknown type, a newer format, unreadable text', () => {
    assert.equal(bad({ v: 1, type: 'radar' }).code, 'unsupported_type');
    assert.equal(bad({ v: 7, type: 'line' }).code, 'unsupported_version');
    assert.equal(bad('{ not json').code, 'syntax');
    assert.equal(bad('[1, 2, 3]').code, 'syntax');
    assert.equal(bad(`{"type":"line","title":"${'x'.repeat(CHART_LIMITS.maxSourceChars)}"}`).code, 'too_large');
  });
});

describe('units and comparability', () => {
  test('series in different units cannot share an axis', () => {
    const r = bad({ v: 1, type: 'grouped-bar', x: { values: ['Q1', 'Q2'] }, sources: ['plan'], series: [{ name: 'Hours', unit: 'hours', status: 'observed', values: [10, 12] }, { name: 'Cost', unit: 'USD', status: 'observed', values: [900, 1000] }] });
    assert.equal(r.code, 'mixed_units');
    assert.match(r.message, /hours, USD/);
  });

  test('stacked bars cannot hold a negative value', () => {
    assert.equal(bad({ v: 1, type: 'stacked-bar', x: { values: ['a', 'b'] }, sources: ['CRM export'], series: [{ name: 'A', status: 'observed', values: [1, -2] }, { name: 'B', status: 'observed', values: [1, 2] }] }).code, 'negative_stack');
  });

  test('every series needs one value per label', () => {
    assert.equal(bad({ ...OBSERVED, series: [{ name: 'Tickets', status: 'observed', source: 'CRM export', values: [1, 2] }] }).code, 'length_mismatch');
  });
});

describe('a representation that would mislead is swapped, and the swap is said', () => {
  test('a line over unordered categories becomes bars', () => {
    const { chart } = ok({ v: 1, type: 'line', x: { values: ['Free', 'Pro', 'Team'] }, sources: ['console'], series: [{ name: 'Users', status: 'observed', values: [1200, 340, 90] }] });
    assert.equal(chart.type, 'bar');
    assert.match(chart.notes[0], /categories have no order/);
  });

  test('one observation is not a trend', () => {
    const { chart } = ok({ v: 1, type: 'line', x: { kind: 'time', values: ['Jan', 'Feb'] }, sources: ['CRM export'], series: [{ name: 'MRR', status: 'observed', values: [5000, null] }] });
    assert.equal(chart.type, 'bar');
    assert.ok(chart.notes.some((n) => /one observation is not a trend/.test(n)));
  });

  test('a pie that is not parts of one stated whole becomes bars', () => {
    const noWhole = ok({ v: 1, type: 'pie', status: 'observed', sources: ['CRM export'], parts: [{ label: 'A', value: 3 }, { label: 'B', value: 5 }] }).chart;
    assert.equal(noWhole.type, 'bar');
    assert.match(noWhole.notes[0], /not stated to make up one whole/);
    const negative = ok({ v: 1, type: 'pie', status: 'observed', sources: ['CRM export'], whole: 'the budget', parts: [{ label: 'A', value: 3 }, { label: 'B', value: -5 }] }).chart;
    assert.equal(negative.type, 'bar');
    const unknown = ok({ v: 1, type: 'pie', status: 'observed', sources: ['CRM export'], whole: 'the budget', parts: [{ label: 'A', value: 3 }, { label: 'B', value: null }] }).chart;
    assert.equal(unknown.type, 'bar');
    assert.deepEqual(unknown.series[0].values, [3, null]);
  });

  test('a valid pie keeps its shares, and a zero part is listed rather than drawn', () => {
    const { chart, table } = ok({ v: 1, type: 'pie', status: 'observed', sources: ['budget sheet'], whole: 'the FY26 budget', parts: [{ label: 'Salaries', value: 60 }, { label: 'Tools', value: 25 }, { label: 'Travel', value: 15 }, { label: 'Training', value: 0 }] });
    assert.equal(chart.type, 'pie');
    assert.deepEqual(chart.parts.map((p) => p.percent), [60, 25, 15]);
    assert.match(chart.notes[0], /zero: Training/);
    assert.equal(table.rows.length, 3);
  });

  test('bars start at zero unless an exception is stated, and then it is disclosed', () => {
    const silent = ok({ v: 1, type: 'bar', x: { values: ['a', 'b'] }, y: { min: 90 }, sources: ['CRM export'], series: [{ name: 'S', status: 'observed', values: [95, 99] }] }).chart;
    assert.equal(silent.y.min, null, 'an unexplained floor is ignored');
    const stated = ok({ v: 1, type: 'bar', x: { values: ['a', 'b'] }, y: { min: 90, minReason: 'uptime is only meaningful above 90%' }, sources: ['CRM export'], series: [{ name: 'S', status: 'observed', values: [95, 99] }] }).chart;
    assert.equal(stated.y.min, 90);
    assert.ok(stated.notes.some((n) => /starts at 90, not zero/.test(n)));
  });
});

describe('missing data stays missing', () => {
  test('null is a gap in the table, the CSV and the line', () => {
    const { chart, table } = ok(OBSERVED);
    assert.deepEqual(table.rows[2], ['W3', '']);
    assert.ok(chartCsv(chart, table).includes('W3,\r\n'));
    assert.ok(chart.notes.some((n) => /nothing is filled in/.test(n)));
    const svg = renderChartSvg(chart).svg;
    // Two separate runs either side of the gap: W1–W2 as a line, W4 alone as a point.
    assert.equal((svg.match(/class="chart-line"/g) || []).length, 1);
    assert.equal((svg.match(/class="chart-point"/g) || []).length, 3);
  });

  test('a heatmap cell with no value is empty, never zero', () => {
    const { chart, table } = ok({ v: 1, type: 'heatmap', status: 'observed', sources: ['export'], rows: ['Jan', 'Feb'], cols: ['M1', 'M2'], cells: [[82, 71], [85, null]] });
    assert.equal(chart.heat.cells[1][1], null);
    assert.deepEqual(table.rows[1], ['Feb', 85, '']);
    assert.ok(chart.notes.some((n) => /unknown, not zero/.test(n)));
  });

  test('an item with no score is listed, never placed', () => {
    const { chart } = ok({ v: 1, type: 'quadrant', status: 'observed', sources: ['meeting'], quadrant: { rubric: '1 to 10, scored in the meeting' }, points: [{ label: 'SSO', x: 3, y: 8 }, { label: 'Audit log' }] });
    assert.equal(chart.points.length, 1);
    assert.match(chart.notes[0], /Not placed because a score is missing: Audit log/);
  });
});

describe('a range is a scenario range unless it is a stated interval', () => {
  const withBand = (band) => ({ ...OBSERVED, band: { low: [100, 110, 115, 120], high: [140, 150, 160, 170], ...band } });

  test('low and high assumptions make a scenario range', () => {
    const { chart } = ok(withBand({}));
    assert.equal(chart.band.meaning, 'scenario-range');
    assert.equal(chart.band.name, 'Scenario range');
    assert.ok(chart.notes.some((n) => /not a confidence interval/.test(n)));
    assert.match(renderChartSvg(chart).svg, /class="chart-band" data-meaning="scenario-range"/);
  });

  test('calling it a confidence interval without a level and a source does not make it one', () => {
    assert.equal(ok(withBand({ meaning: 'confidence-interval' })).chart.band.meaning, 'scenario-range');
    assert.equal(ok(withBand({ meaning: 'confidence-interval', level: 95 })).chart.band.meaning, 'scenario-range');
  });

  test('a stated interval keeps its level and source', () => {
    const { chart } = ok(withBand({ meaning: 'confidence-interval', level: 95, source: 'bootstrap, n = 400' }));
    assert.equal(chart.band.meaning, 'confidence-interval');
    assert.equal(chart.band.name, '95% confidence interval');
    assert.equal(chart.band.source, 'bootstrap, n = 400');
  });
});

describe('funnel and waterfall arithmetic', () => {
  test('stage rates are computed, and the cohort is carried', () => {
    const { chart, table } = ok({ v: 1, type: 'funnel', status: 'observed', sources: ['Q3 export'], cohort: 'leads created in Q3', stages: [{ label: 'Leads', value: 200 }, { label: 'Qualified', value: 120 }, { label: 'Won', value: 40 }] });
    assert.deepEqual(chart.stages.map((s) => s.ratePercent), [null, 60, 33.3]);
    assert.equal(chart.assumptions[0], 'Cohort: leads created in Q3.');
    assert.deepEqual(table.rows[1], ['Qualified', 120, '60.0%']);
  });

  test('a funnel with no cohort says its rates assume one', () => {
    const { chart } = ok({ v: 1, type: 'funnel', status: 'observed', sources: ['CRM export'], stages: [{ label: 'A', value: 10 }, { label: 'B', value: 4 }] });
    assert.ok(chart.notes.some((n) => /cohort and time window were not stated/.test(n)));
  });

  test('a waterfall total is computed from its steps', () => {
    const { chart } = ok({ v: 1, type: 'waterfall', status: 'observed', sources: ['invoices'], steps: [{ label: 'Last month', value: 84, kind: 'start' }, { label: 'Extra data', value: 12 }, { label: 'Credit', value: -15 }, { label: 'This month', kind: 'total' }] });
    assert.deepEqual(chart.steps.map((s) => s.end), [84, 96, 81, 81]);
    const svg = renderChartSvg(chart).svg;
    assert.ok(svg.includes('>+12<') && svg.includes('>−15<'), 'the direction of a change is written, not only coloured');
  });
});

describe('the drawing', () => {
  const colors = { text: '#f1f5f9', muted: '#a8b0bd', nodeFill: '#272a31', stroke: '#868c98', groupFill: '#1c1e24', accent: '#7aa2f7', dark: true };

  test('every chart type draws a self-contained, inert SVG', () => {
    const specs = [
      FORECAST,
      OBSERVED,
      { v: 1, type: 'bar', x: { values: ['a', 'b'] }, sources: ['CRM export'], series: [{ name: 'S', status: 'observed', values: [3, 5] }] },
      { v: 1, type: 'grouped-bar', x: { values: ['a', 'b'] }, sources: ['CRM export'], series: [{ name: 'S', status: 'observed', values: [3, 5] }, { name: 'T', status: 'observed', values: [4, null] }] },
      { v: 1, type: 'stacked-bar', x: { values: ['a', 'b'] }, sources: ['CRM export'], assumptions: ['plan'], series: [{ name: 'S', status: 'observed', values: [3, 5] }, { name: 'T', status: 'scenario', values: [4, 2] }] },
      { v: 1, type: 'scatter', status: 'illustrative', points: [{ label: 'a', x: 1, y: 2 }, { label: 'b', x: 3, y: 5 }] },
      { v: 1, type: 'quadrant', status: 'observed', sources: ['CRM export'], quadrant: { rubric: 'scored in the meeting' }, points: [{ label: 'a', x: 1, y: 2 }] },
      { v: 1, type: 'waterfall', status: 'observed', sources: ['CRM export'], steps: [{ label: 'a', value: 5, kind: 'start' }, { label: 'b', value: -2 }] },
      { v: 1, type: 'heatmap', status: 'observed', sources: ['CRM export'], rows: ['r'], cols: ['c1', 'c2'], cells: [['supported', null]] },
      { v: 1, type: 'funnel', status: 'observed', sources: ['CRM export'], cohort: 'c', stages: [{ label: 'a', value: 9 }, { label: 'b', value: 3 }] },
      { v: 1, type: 'pie', status: 'observed', sources: ['CRM export'], whole: 'w', parts: [{ label: 'a', value: 9 }, { label: 'b', value: 3 }] },
      { v: 1, type: 'line', compute: { kind: 'function', expression: 'x^2', min: -2, max: 2 } },
      { v: 1, type: 'line', y: { unit: 'USD' }, compute: { kind: 'break_even', initialCost: 12000, periodSaving: 2500, period: 'month', periods: 8 } },
    ];
    for (const spec of specs) {
      for (const palette of [colors, undefined]) {
        const { chart } = ok(spec);
        const drawn = renderChartSvg(chart, palette);
        assert.ok(drawn.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), spec.type);
        assert.ok(drawn.width > 0 && drawn.height > 60, spec.type);
        assert.equal(isSafeDiagramSvg(drawn.svg), true, `${spec.type} is not an inert drawing`);
        assert.ok(!/NaN|undefined|Infinity/.test(drawn.svg), `${spec.type} drew a broken number`);
        assert.ok(!/<script|<foreignObject|href=|<image|on[a-z]+=/i.test(drawn.svg), spec.type);
      }
    }
  });

  test('projected values look different without relying on colour, and the image says so', () => {
    const svg = renderChartSvg(ok(FORECAST).chart).svg;
    assert.match(svg, /chart-line--projected[^>]*stroke-dasharray/);
    assert.match(svg, /class="chart-badge"[^>]*>Scenario</);
    const stacked = renderChartSvg(ok({ v: 1, type: 'stacked-bar', x: { values: ['a'] }, sources: ['CRM export'], assumptions: ['plan'], series: [{ name: 'S', status: 'observed', values: [3] }, { name: 'T', status: 'scenario', values: [4] }] }).chart).svg;
    assert.match(stacked, /chart-bar--projected[^>]*fill="url\(#hatch1\)"/);
    assert.match(stacked, /<pattern id="hatch1"/);
  });

  test('the first assumption and source travel inside the image (an export keeps them)', () => {
    const svg = renderChartSvg(ok({ ...OBSERVED, assumptions: [] }).chart).svg;
    assert.match(svg, /class="chart-footnote"[^>]*>Source: support export</);
    assert.match(renderChartSvg(ok(FORECAST).chart).svg, /class="chart-footnote"[^>]*>Constant 5% net growth per month/);
  });

  test('bars are measured from zero', () => {
    const { chart } = ok({ v: 1, type: 'bar', x: { values: ['a', 'b'] }, sources: ['CRM export'], series: [{ name: 'S', status: 'observed', values: [95, 99] }] });
    const svg = renderChartSvg(chart).svg;
    // The lowest tick label is 0, and both bars are nearly the full plot height.
    assert.match(svg, />0<\/text>/);
    const heights = [...svg.matchAll(/class="chart-bar"[^>]*height="([\d.]+)"/g)].map((m) => Number(m[1]));
    assert.equal(heights.length, 2);
    assert.ok(Math.abs(heights[0] / heights[1] - 95 / 99) < 0.01, 'bar heights are proportional to the values');
  });

  test('a label written by a model cannot break out of the markup', () => {
    const { chart } = ok({ v: 1, type: 'bar', title: '</text><script>alert(1)</script>', x: { values: ['"><img src=x onerror=1>', 'b'] }, sources: ['CRM export'], series: [{ name: '<b>S</b>', status: 'observed', values: [1, 2] }] });
    const svg = renderChartSvg(chart).svg;
    assert.ok(!svg.includes('<script') && !svg.includes('<img') && !svg.includes('<b>'));
    assert.equal(isSafeDiagramSvg(svg), true);
  });

  test('a break-even chart marks where it crosses zero', () => {
    const svg = renderChartSvg(ok({ v: 1, type: 'line', compute: { kind: 'break_even', initialCost: 12000, periodSaving: 2500, period: 'month', periods: 8 } }).chart).svg;
    assert.match(svg, /class="chart-marker-label"[^>]*>Break-even: Month 5</);
  });

  test('axis ticks are round numbers that cover the data', () => {
    assert.deepEqual(niceTicks(0, 100), [0, 20, 40, 60, 80, 100]);
    const t = niceTicks(10000, 11576.25);
    assert.ok(t[0] <= 10000 && t[t.length - 1] >= 11576.25);
    assert.ok(niceTicks(5, 5).length >= 2, 'a flat series still gets an axis');
  });
});

describe('parsing', () => {
  test('a trailing comma is tolerated; nothing else is "fixed"', () => {
    assert.equal(parseChartJson('{"type":"bar","x":{"values":["a","b",]},}').ok, true);
    assert.equal(parseChartJson("{'type':'bar'}").ok, false);
    assert.equal(parseChartJson('{"type":"bar"} trailing words').ok, false);
    assert.equal(parseChartJson('').code, 'empty');
  });

  test('a payload cannot name a URL, a function or an expression to run', () => {
    // Unknown keys are ignored, so nothing here has any effect.
    const { chart } = ok({ ...OBSERVED, data: { url: 'https://example.com/data.csv' }, transform: [{ calculate: 'datum.x * 2' }], onClick: 'alert(1)' });
    const svg = renderChartSvg(chart).svg;
    assert.ok(!svg.includes('example.com') && !svg.includes('datum') && !svg.includes('alert'));
  });

  test('a CSV cell that would be read as a formula is neutralised', () => {
    const { chart, table } = ok({ v: 1, type: 'bar', x: { values: ['=HYPERLINK("http://x")', '+1', 'ok'] }, sources: ['CRM export'], series: [{ name: 'S', status: 'observed', values: [1, 2, 3] }] });
    const csv = chartCsv(chart, table);
    assert.ok(csv.includes('"\'=HYPERLINK(""http://x"")",1'), csv);
    assert.ok(csv.includes("'+1,2"));
  });
});

describe('compileVisualSource (what the card and the phone call)', () => {
  test('a chart compiles to a drawing with its table, description and export texts', () => {
    const c = compileVisualSource('chart', JSON.stringify(FORECAST));
    assert.equal(c.ok, true);
    assert.equal(c.renderer, 'svg');
    assert.equal(c.label, 'Forecast');
    assert.deepEqual(c.badges, ['Scenario']);
    assert.ok(c.exports.csv.includes('Month 3,11576.25'));
    const exported = JSON.parse(c.exports.json);
    assert.deepEqual(exported.compute, FORECAST.compute, 'the canonical inputs are kept as written');
    assert.deepEqual(exported.computed.table.rows[3], ['Month 3', 11576.25], 'and the computed table travels beside them');
    assert.equal(exported.computed.calculation.version, 1);
  });

  test('a refused chart carries a readable reason and what was missing', () => {
    const c = compileVisualSource('chart', JSON.stringify({ v: 1, type: 'line', compute: { kind: 'compound_growth', ratePercent: 5, period: 'month', periods: 3 } }));
    assert.deepEqual({ ok: c.ok, stage: c.stage, code: c.code, missing: c.missing }, { ok: false, stage: 'spec', code: 'missing_input', missing: ['a starting value'] });
  });

  test('never throws on hostile input', () => {
    for (const hostile of ['', 'null', '{"type":{"toString":1}}', '{"type":"line","series":"x"}', '{"type":"line","x":{"values":{"length":9e9}}}', `{"type":"heatmap","rows":[${'"r",'.repeat(400)}"r"],"cols":["c"],"cells":[]}`, '{"type":"line","compute":{"kind":"function","expression":"while(true){}","min":0,"max":1}}', '{"__proto__":{"type":"line"}}']) {
      const c = compileVisualSource('chart', hostile);
      assert.equal(c.ok, false, hostile.slice(0, 40));
      assert.ok(typeof c.message === 'string' && c.message.length > 5);
    }
  });
});

// Seen live: a model listed "sources" and left "status" out; the chart was refused.
describe('a chart that names its source', () => {
  const parts = [{ label: 'Engineering', value: 420 }, { label: 'Marketing', value: 210 }, { label: 'Design', value: 120 }, { label: 'Support', value: 90 }];

  test('is read as observed data: naming the source is the claim', () => {
    const r = ok({ v: 1, type: 'pie', title: 'Budget split', whole: 'Total budget', parts, sources: ['Stated in the meeting'] });
    assert.equal(r.chart.type, 'pie');
    assert.deepEqual(r.chart.sources, ['Stated in the meeting']);
    assert.deepEqual(r.table.rows.map((row) => row[1]), [420, 210, 120, 90]);
    const series = ok({ v: 1, type: 'bar', x: { values: ['Q1', 'Q2'] }, series: [{ name: 'Tickets', source: 'Support export', values: [40, 55] }] });
    assert.equal(series.chart.series[0].status, 'observed');
  });

  test('with neither a status nor a source it is still refused', () => {
    const r = normaliseChartSpec(JSON.stringify({ v: 1, type: 'pie', whole: 'Total budget', parts }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'no_status');
    assert.equal(normaliseChartSpec(JSON.stringify({ v: 1, type: 'bar', x: { values: ['Q1', 'Q2'] }, series: [{ name: 'Tickets', values: [40, 55] }] })).code, 'no_status');
  });

  test('a stated status is never overridden by a source', () => {
    const r = ok({ v: 1, type: 'bar', x: { values: ['Q1', 'Q2'] }, sources: ['Sketch'], series: [{ name: 'Tickets', status: 'illustrative', values: [40, 55] }] });
    assert.equal(r.chart.series[0].status, 'illustrative');
    assert.ok(r.chart.badges.includes('Illustrative'));
  });
});

// Seen live: "Monthly revenue at 5% net growth (illustrative baseline)".
describe('a calculation that says its own input is made up', () => {
  const spec = (extra) => ({ v: 1, type: 'line', title: 'Monthly revenue at 5% net growth', compute: { kind: 'compound_growth', baseline: 10000, ratePercent: 5, period: 'month', periods: 3 }, assumptions: ['Net growth stays at 5% every month'], ...extra });

  test('is stamped Illustrative, in the picture, instead of Scenario', () => {
    for (const extra of [
      { title: 'Monthly revenue at 5% net growth (illustrative baseline)' },
      { assumptions: ['Illustrative $10,000 starting monthly revenue, not your actual figure'] },
      { assumptions: ['Starting revenue to be confirmed by you'] },
      { assumptions: ['A made-up starting value of 10,000'] },
      { note: 'Placeholder baseline until the real number is known' },
    ]) {
      const r = ok(spec(extra));
      assert.deepEqual(r.chart.badges, ['Illustrative'], JSON.stringify(extra));
      assert.equal(r.chart.series[0].status, 'illustrative');
      const svg = renderChartSvg(r.chart).svg;
      assert.ok(svg.includes('>Illustrative<') && !svg.includes('>Scenario<'));
    }
  });

  test('a scenario on stated inputs stays a scenario', () => {
    const r = ok(spec({}));
    assert.deepEqual(r.chart.badges, ['Scenario']);
    assert.equal(r.chart.series[0].status, 'scenario');
  });
});

// Seen live: {"series":[{"name":"At 5% monthly growth","compute":{…}}]} was refused as a series with no values.
describe('a calculation written inside a series', () => {
  const compute = { kind: 'compound_growth', baseline: 10000, ratePercent: 5, period: 'month', periods: 3 };

  test('is computed exactly like a top-level one', () => {
    const nested = ok({ v: 1, type: 'line', title: 'Revenue', series: [{ name: 'At 5% monthly growth', compute }], assumptions: ['Net growth stays at 5%'] });
    const top = ok({ v: 1, type: 'line', title: 'Revenue', compute: { ...compute, name: 'At 5% monthly growth' }, assumptions: ['Net growth stays at 5%'] });
    assert.deepEqual(nested.table, top.table);
    assert.deepEqual(nested.table.rows.map((r) => r[1]), [10000, 10500, 11025, 11576.25]);
    assert.equal(nested.chart.series[0].name, 'At 5% monthly growth');
    assert.deepEqual(nested.chart.badges, ['Scenario']);
  });

  test('two of them are two scenarios side by side', () => {
    const r = ok({ v: 1, type: 'line', series: [{ name: '5%', compute }, { name: '3%', compute: { ...compute, ratePercent: 3 } }], assumptions: ['Constant net growth'] });
    assert.deepEqual(r.chart.series.map((s) => s.name), ['5%', '3%']);
    assert.deepEqual(r.table.rows[3].slice(1), [11576.25, 10927.27]);
  });

  test('a series with neither values nor a calculation is still refused', () => {
    const r = normaliseChartSpec(JSON.stringify({ v: 1, type: 'line', x: { values: ['a', 'b'] }, series: [{ name: 'Empty', status: 'illustrative' }] }));
    assert.equal(r.ok, false);
  });

  test('a nested calculation with a missing input is refused with what it needs', () => {
    const r = normaliseChartSpec(JSON.stringify({ v: 1, type: 'line', series: [{ name: 'Growth', compute: { ...compute, baseline: null } }] }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'missing_input');
    assert.deepEqual(r.missing, ['a starting value']);
  });
});

// ── found in review (2026-10-01): every case below was reproduced first ──────

describe('axis ticks always terminate', () => {
  test('a range smaller than floating-point spacing, numeric strings and non-finite bounds all return at once', () => {
    const cases = [[0.3, 0.30000000000000004], [1.1, 1.1000000000000005], [1, 1.0000000000000002], [4503599627370496, 4503599627370497], ['0', '1e9'], [Number.NaN, 5], [0, Number.POSITIVE_INFINITY], [5, 5], [0, 0], [-1e308, 1e308], [10, 2]];
    for (const [min, max] of cases) {
      const started = Date.now();
      const ticks = niceTicks(min, max);
      assert.ok(Date.now() - started < 50, `${min}..${max} took too long`);
      assert.ok(Array.isArray(ticks) && ticks.length >= 2 && ticks.length <= 45, `${min}..${max}: ${ticks.length} ticks`);
      assert.ok(ticks.every((t) => typeof t === 'number' && Number.isFinite(t)), `${min}..${max}: ${ticks}`);
    }
  });

  test('a chart of values one float apart is drawn (it used to exhaust the heap)', () => {
    const r = compileVisualSource('chart', JSON.stringify({ type: 'line', x: { kind: 'time', values: ['Jan', 'Feb', 'Mar'] }, series: [{ name: 'Rate', status: 'observed', source: 'CRM export', values: [0.3, 0.30000000000000004, 0.3] }] }));
    assert.equal(r.ok, true, r.message);
    assert.ok(!/NaN|Infinity/.test(r.svg));
  });

  test('ordinary ranges keep their round ticks', () => {
    assert.deepEqual(niceTicks(0, 100), [0, 20, 40, 60, 80, 100]);
    assert.deepEqual(niceTicks(10000, 11576.25), [10000, 10500, 11000, 11500, 12000]);
  });
});

describe('a horizontal axis is numeric only if its positions are numbers, in order', () => {
  const series = [{ name: 'S', status: 'illustrative', values: [1, 2, 3] }];
  const draw = (x, extra = {}) => compileVisualSource('chart', JSON.stringify({ type: 'line', x, series, ...extra }));

  test('a calculation on a "number" axis is drawn as steps in time', () => {
    const r = compileVisualSource('chart', JSON.stringify({ type: 'line', x: { kind: 'number' }, compute: { kind: 'compound_growth', baseline: 10000, ratePercent: 5, period: 'month', periods: 3 }, assumptions: ['Net growth stays at 5%'] }));
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(r.table.rows.map((row) => row[0]), ['Now', 'Month 1', 'Month 2', 'Month 3']);
  });

  test('text, unordered numbers and a mix fall back to categories; nothing is placed by a value it does not have', () => {
    for (const values of [[1, 'two', 3], [5, 1, 3], ['a', 'b', 'c']]) {
      const r = draw({ kind: 'number', values });
      assert.equal(r.ok, true, JSON.stringify(values));
      assert.ok(!/NaN|Infinity/.test(r.svg), JSON.stringify(values));
      const xs = [...r.svg.matchAll(/c?x="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
      assert.ok(xs.every((v) => v >= -1 && v <= 641), `${JSON.stringify(values)}: ${Math.max(...xs)}`);
    }
  });

  test('numbers written as text, in order, are read as numbers', () => {
    const r = draw({ kind: 'number', values: ['2020', '2021', '2022'] });
    assert.equal(r.ok, true);
    assert.ok(/>2,?020</.test(r.svg) || />2020</.test(r.svg), 'the axis is labelled');
  });
});

describe('labels are cut by whole characters and written as well-formed XML', () => {
  test('an emoji at the length limit is kept or dropped whole, in every label field', () => {
    const cut = (len) => `${'x'.repeat(len)}\u{1F680} tail`;
    const payloads = [
      { type: 'bar', title: cut(89), x: { values: [cut(31), 'b'] }, y: { unit: cut(15) }, series: [{ name: cut(59), status: 'illustrative', values: [1, 2] }] },
      { type: 'bar', title: 'a\ud83d', x: { values: ['a￿b', 'x￾y'] }, series: [{ name: 'S', status: 'illustrative', values: [1, 2] }] },
    ];
    for (const p of payloads) {
      const r = compileVisualSource('chart', JSON.stringify(p));
      assert.equal(r.ok, true, r.message);
      assert.doesNotThrow(() => encodeURIComponent(r.svg));
      assert.ok(!/[￾￿]/.test(r.svg));
    }
    const chen = compileVisualSource('notation', JSON.stringify({ kind: 'chen-er', title: cut(60), entities: [{ name: cut(31), attributes: [{ name: 'k', key: true }] }, { name: 'B', attributes: [{ name: 'k', key: true }] }], relationships: [{ name: 'r', participants: ['B', cut(31)] }] }));
    assert.equal(chen.ok, true, chen.message);
    assert.doesNotThrow(() => encodeURIComponent(chen.svg));
  });
});

describe('label text is text, not markup', () => {
  test('titles and labels that mention "url(", "JavaScript:" or "x = y" are drawn', () => {
    const titles = ['Priority scale: one = low, five = high', 'Retries: once = ok, twice = alert', 'Clicks per short URL(code)', 'JavaScript: 62% of repos', 'Signups: online = 60%, offline = 40%', 'CSS audit of @import usage'];
    for (const title of titles) {
      const r = compileVisualSource('chart', JSON.stringify({ type: 'bar', title, x: { label: 'JavaScript: The Good Parts', values: ['url(img.png)', 'b'] }, sources: [title], series: [{ name: 'Revenue', status: 'observed', values: [1, 2] }] }));
      assert.equal(r.ok, true, `${title}: ${r.message}`);
      assert.equal(checkVisualSource('chart', JSON.stringify({ type: 'bar', title, x: { values: ['a', 'b'] }, sources: ['CRM export'], series: [{ name: 'Revenue', status: 'observed', values: [1, 2] }] })).ok, true);
    }
    const chen = compileVisualSource('notation', JSON.stringify({ kind: 'chen-er', entities: [{ name: 'JavaScript: runtime', attributes: [{ name: 'id', key: true }] }, { name: 'B', attributes: [{ name: 'id', key: true }] }], relationships: [{ name: 'onload = x', participants: ['B', 'JavaScript: runtime'] }] }));
    assert.equal(chen.ok, true, chen.message);
  });

  test('markup that can load or run something is still refused, wherever it hides', () => {
    const svg = (inner, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${inner}</svg>`;
    assert.equal(isSafeDiagramSvg(svg('<text>JavaScript: fine, url(x) fine, a = b</text>')), true);
    for (const bad of [
      svg('<rect onload="x()"/>'),
      svg('<g data-x="a>" onload="x()"><rect/></g>'),
      svg('<rect style="fill:url(https://e.com/a.svg#p)"/>'),
      svg('<style>rect { fill: url(https://e.com/a) }</style>'),
      svg('<style>@import "https://e.com/a.css";</style>'),
      svg('<a href="https://e.com">x</a>'),
      svg('<rect href="javascript:alert(1)"/>'),
      svg('<script>1</script>'),
      svg('<foreignObject><div/></foreignObject>'),
      svg('<image href="https://e.com/a.png"/>'),
      svg('<!-- --><rect onload="x()"/>'),
      svg('<rect/>', ' onload="x()"'),
    ]) {
      assert.equal(isSafeDiagramSvg(bad), false, bad);
    }
    assert.equal(isSafeDiagramSvg(svg('<rect fill="url(#hatch1)"/><style>.a{fill:url(#g)}</style>')), true);
  });
});

describe('numbers that cannot be stated are refused, and large ones are stated exactly', () => {
  test('non-finite and beyond-1e15 values never reach a table, a label or a CSV', () => {
    for (const payload of [
      '{"type":"waterfall","status":"illustrative","steps":[{"label":"a","value":1e308},{"label":"b","value":1e308}]}',
      '{"type":"bar","x":{"values":["a","b"]},"series":[{"name":"A","status":"illustrative","values":[1e21,2e21]}]}',
      '{"type":"bar","x":{"values":["a","b"]},"series":[{"name":"A","status":"illustrative","values":[1e999,1]}]}',
      '{"type":"line","compute":{"kind":"compound_growth","baseline":1e300,"ratePercent":5,"period":"month","periods":3}}',
      '{"type":"line","compute":{"kind":"compound_growth","baseline":1e14,"ratePercent":900,"period":"month","periods":3}}',
    ]) {
      const r = compileVisualSource('chart', payload);
      assert.equal(r.ok, false, payload);
      assert.equal(r.code, 'too_large', payload);
    }
  });

  test('a forecast in the trillions keeps its whole numbers', () => {
    const r = ok({ type: 'line', compute: { kind: 'compound_growth', baseline: 6000000000000, ratePercent: 5, period: 'year', periods: 2 }, assumptions: ['Net growth stays at 5%'] });
    assert.deepEqual(r.table.rows.map((row) => row[1]), [6000000000000, 6300000000000, 6615000000000]);
  });
});

describe('what a chart claims has to be something', () => {
  const bars = (extra) => normaliseChartSpec(JSON.stringify({ type: 'bar', x: { values: ['a', 'b'] }, series: [{ name: 'A', values: [1, 2], ...extra.series }], ...extra.chart }));

  test('"n/a", "-", an invisible character and a lone letter are not a source or an assumption', () => {
    for (const source of ['n/a', '-', '​', 'x', 'unknown', 'TBD']) {
      assert.equal(bars({ series: { status: 'observed', source } }).code, 'no_source', JSON.stringify(source));
      assert.equal(bars({ series: { status: 'observed' }, chart: { sources: [source] } }).code, 'no_source', JSON.stringify(source));
      assert.equal(bars({ series: { status: 'scenario' }, chart: { assumptions: [source] } }).code, 'no_assumptions', JSON.stringify(source));
    }
    assert.equal(bars({ series: { status: 'observed', source: 'Q3 board deck' } }).ok, true);
  });

  test('a range is an interval only with a level that is a percentage, and never has its low above its high', () => {
    const line = (band) => normaliseChartSpec(JSON.stringify({ type: 'line', x: { kind: 'time', values: ['a', 'b'] }, series: [{ name: 'A', status: 'illustrative', values: [2, 3] }], band }));
    assert.equal(line({ low: [3, 4], high: [1, 2] }).code, 'bad_band');
    const loose = line({ name: '95% confidence interval', low: [1, 2], high: [3, 4] });
    assert.equal(loose.chart.band.meaning, 'scenario-range');
    assert.equal(loose.chart.band.name, 'Scenario range', 'a scenario range is never named an interval');
    assert.equal(line({ meaning: 'confidence-interval', level: 250, source: 'Model v2', low: [1, 2], high: [3, 4] }).chart.band.meaning, 'scenario-range');
    assert.equal(line({ meaning: 'confidence-interval', level: 95, source: 'Model v2', low: [1, 2], high: [3, 4] }).chart.band.meaning, 'confidence-interval');
  });

  test('an axis floor above the smallest value is not applied, and a stack always stands on zero', () => {
    const r = ok({ type: 'bar', x: { values: ['a', 'b', 'c'] }, y: { min: 15, minReason: 'to show the change' }, series: [{ name: 'A', status: 'illustrative', values: [10, 20, 30] }] });
    assert.equal(r.chart.y.min, null);
    assert.ok(r.chart.notes.some((n) => /above the smallest value \(10\), so that was not applied/.test(n)));
    const stacked = ok({ type: 'stacked-bar', x: { values: ['a', 'b'] }, y: { min: 50, minReason: 'zoom' }, series: [{ name: 'A', status: 'illustrative', values: [100, 110] }, { name: 'B', status: 'illustrative', values: [100, 120] }] });
    assert.equal(stacked.chart.y.min, null);
    assert.equal(ok({ type: 'bar', x: { values: ['a', 'b'] }, y: { min: 95, minReason: '.' }, series: [{ name: 'A', status: 'illustrative', values: [100, 110] }] }).chart.y.min, null, 'a reason has to be a reason');
  });
});

describe('a share of a whole adds up to the whole', () => {
  const pie = (extra) => ok({ type: 'pie', status: 'observed', sources: ['Survey 2026'], whole: 'all respondents', parts: [{ label: 'Yes', value: 40 }, { label: 'No', value: 30 }], ...extra });

  test('percentages that fall short of 100 leave a remainder, shown as such', () => {
    const r = pie({ unit: '%' });
    assert.deepEqual(r.chart.parts.map((p) => [p.label, p.percent]), [['Yes', 40], ['No', 30], ['Not stated', 30]]);
    assert.ok(r.chart.notes.some((n) => /add up to 70 of 100/.test(n)));
  });

  test('a stated total works the same way; parts beyond it become bars', () => {
    assert.deepEqual(pie({ total: 100 }).chart.parts.map((p) => p.percent), [40, 30, 30]);
    const over = pie({ total: 50 });
    assert.equal(over.chart.type, 'bar');
    assert.ok(over.chart.notes.some((n) => /more than the stated whole of 50/.test(n)));
  });

  test('with no stated size the parts are the whole (unchanged)', () => {
    assert.deepEqual(pie({}).chart.parts.map((p) => p.percent), [57.1, 42.9]);
  });
});

describe('scenarios side by side', () => {
  const growth = (ratePercent, periods = 3) => ({ kind: 'compound_growth', baseline: 10000, ratePercent, period: 'month', periods });

  test('two unnamed scenarios are told apart by their rate', () => {
    const r = ok({ type: 'line', compute: [growth(3), growth(5)], assumptions: ['Constant net growth'] });
    assert.deepEqual(r.chart.series.map((s) => s.name), ['3% per month', '5% per month']);
  });

  test('a five-year monthly forecast is drawn (60 steps used to be refused)', () => {
    const r = ok({ type: 'line', compute: growth(1, 60), assumptions: ['Constant net growth'] });
    assert.equal(r.table.rows.length, 61);
    assert.equal(normaliseChartSpec(JSON.stringify({ type: 'line', compute: growth(1, 121) })).ok, false);
  });
});

describe('final review (2026-10-02): numbers a model wrote as text', () => {
  test('a forecast whose inputs are quoted is drawn, with the same numbers as the unquoted one', () => {
    const quoted = normaliseChartSpec('{"v":1,"type":"line","title":"Revenue","compute":{"kind":"compound_growth","baseline":"10000","ratePercent":"5","period":"month","periods":"3"}}');
    const plain = normaliseChartSpec('{"v":1,"type":"line","title":"Revenue","compute":{"kind":"compound_growth","baseline":10000,"ratePercent":5,"period":"month","periods":3}}');
    assert.equal(quoted.ok, true, JSON.stringify(quoted));
    assert.deepEqual(quoted.chart.series, plain.chart.series);
    assert.equal(normaliseChartSpec('{"v":1,"type":"line","title":"Revenue","compute":{"kind":"compound_growth","baseline":"10,000","ratePercent":"5%","period":"month","periods":3}}').ok, true);
  });

  test('series values written as text are numbers; category labels that look like numbers stay labels', () => {
    const out = normaliseChartSpec('{"v":1,"type":"bar","title":"Tickets","x":{"values":["2023","2024"]},"series":[{"name":"Tickets","values":["120","134"],"status":"observed","source":"the support export"}]}');
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(out.chart.series[0].values, [120, 134]);
    assert.deepEqual(out.chart.x.values, ['2023', '2024']);
    assert.equal(out.chart.x.kind, 'category');
  });

  test('text that is not just a number is still refused, not guessed at', () => {
    for (const baseline of ['"about 10000"', '"10k"', '"ten thousand"', '"1e400"', '"10000 USD"']) {
      const out = normaliseChartSpec(`{"v":1,"type":"line","title":"Revenue","compute":{"kind":"compound_growth","baseline":${baseline},"ratePercent":5,"period":"month","periods":3}}`);
      assert.equal(out.ok, false, baseline);
    }
  });
});

describe('text width, estimated: scripts other than Latin', async () => {
  const { estimateTextWidth, truncateToWidth } = await import('../svgText.mjs');

  test('Cyrillic is wider than Latin, and its wide letters and capitals wider still', () => {
    // Measured in Chromium at 12px (2026-10-02): the old estimate, which
    // counted Cyrillic as Latin, came out at 70–94% of the real width.
    const real = { 'Очередь сообщений': 121.8, 'ШИРОКИЕ ЖЁЛТЫЕ ЩИТЫ': 161.7, 'жшщмюы': 56.7, 'Июль': 31.7, 'Ежемесячная выручка при росте 5%': 216.4 };
    for (const [text, width] of Object.entries(real)) {
      const estimate = estimateTextWidth(text, 12);
      assert.ok(estimate >= width, `${text}: ${estimate.toFixed(1)} < ${width}`);
      assert.ok(estimate <= width * 1.2, `${text}: ${estimate.toFixed(1)} is more than 20% over ${width}`);
    }
  });

  test('Chinese and Japanese are a full em per character; half-width kana are not', () => {
    assert.equal(estimateTextWidth('订单数据库', 12), 60);
    assert.equal(estimateTextWidth('カレンダー', 12), 60);
    assert.ok(estimateTextWidth('ﾊﾝｶｸ', 12) < 30);
  });

  test('a label cut to fit a box fits it in every script', () => {
    for (const text of ['Количество пользователей по месяцам за год', '每月活跃用户数量变化情况统计图表', '月次アクティブユーザー数の推移グラフ', 'Monthly active users by cohort and region']) {
      const cut = truncateToWidth(text, 120, 12);
      assert.ok(estimateTextWidth(cut, 12) <= 120, cut);
      assert.ok(cut.endsWith('…'), cut);
    }
  });
});
