// How a drawing arrives (display-only motion added to the copy of the SVG the card shows).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withArrivalMotion, ARRIVAL_CSS, ARRIVAL_STEP_MS, ARRIVAL_TOTAL_MS } from '../diagramReveal.mjs';
import { normaliseChartSpec } from '../chartSpec.mjs';
import { renderChartSvg } from '../chartSvg.mjs';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>#d .node{fill:red}</style><g class="nodes"><g class="node"/></g></svg>';

describe('arrival motion', () => {
  test('it is one style block, last in the document, and added once', () => {
    const out = withArrivalMotion(SVG);
    assert.equal((out.match(/data-arrival/g) || []).length, 1);
    assert.ok(out.endsWith('</style></svg>'), out.slice(-40));
    assert.ok(out.indexOf('data-arrival') > out.indexOf('#d .node'), 'after the drawing\'s own styles');
    assert.equal(withArrivalMotion(out), out, 'a second pass changes nothing');
    assert.equal(out.replace(/<style data-arrival="1">[\s\S]*?<\/style>/, ''), SVG, 'nothing else in the document changed');
  });

  test('what is not an SVG document comes back as it was', () => {
    for (const value of ['', 'flowchart LR\n a-->b', '<svg', null, undefined, 42]) assert.equal(withArrivalMotion(value), value);
  });

  test('it is app-owned styling only: nothing is loaded, nothing runs', () => {
    assert.doesNotMatch(ARRIVAL_CSS, /url\(|@import|expression|javascript:|<|behavior/i);
    assert.match(ARRIVAL_CSS, /prefers-reduced-motion: reduce\)\{\*\{animation:none!important\}\}/);
  });

  test('every part is held back only until it starts (never left hidden), and the whole thing is short', () => {
    // `backwards` shows the first frame during the delay and lets go at the end;
    // `forwards` or `both` would pin the last frame over the card's own states.
    assert.doesNotMatch(ARRIVAL_CSS, /\b(forwards|both)\b/);
    const longest = Math.max(
      ...[...ARRIVAL_CSS.matchAll(/animation:[a-z-]+ (\d+)ms[^;}]*?(?:;animation-delay:(\d+)ms)?[;}]/g)].map((m) => Number(m[1]) + Number(m[2] || 0)),
      ...[...ARRIVAL_CSS.matchAll(/animation-delay:(\d+)ms/g)].map((m) => Number(m[1]) + 250),
    );
    assert.ok(longest <= ARRIVAL_TOTAL_MS, `${longest} ms`);
    assert.equal(ARRIVAL_STEP_MS, 40);
  });

  test('the classes it moves are the ones the chart renderer writes', () => {
    const draw = (spec) => renderChartSvg(normaliseChartSpec(JSON.stringify({ v: 1, status: 'observed', sources: ['CRM export'], ...spec })).chart).svg;
    const pie = draw({ type: 'pie', whole: 'the budget', parts: [{ label: 'A', value: 3 }, { label: 'B', value: 5 }] });
    const bar = draw({ type: 'bar', x: { label: 'Quarter', values: ['Q1', 'Q2'] }, y: { label: 'Deals' }, series: [{ name: 'Won', values: [4, 9] }] });
    const line = draw({ type: 'line', x: { kind: 'time', label: 'Week', values: ['W1', 'W2', 'W3'] }, y: { label: 'Tickets' }, series: [{ name: 'Tickets', status: 'observed', values: [120, 134, 150], source: 'support export' }] });
    for (const [svg, cls] of [[pie, 'chart-slice'], [pie, 'chart-swatch'], [pie, 'chart-legend'], [pie, 'chart-total'], [bar, 'chart-bar'], [line, 'chart-line'], [line, 'chart-point']]) {
      assert.match(svg, new RegExp(`class="[^"]*${cls}`), cls);
      assert.ok(ARRIVAL_CSS.includes(`.${cls}`), cls);
    }
  });
});

describe('the pie is a ring', () => {
  const draw = (parts, extra = {}) => renderChartSvg(normaliseChartSpec(JSON.stringify({ v: 1, type: 'pie', status: 'observed', sources: ['budget sheet'], whole: 'the budget', parts, ...extra })).chart).svg;

  test('parts are separated by a gap in their own shape, not by an outline in a guessed surface colour', () => {
    const svg = draw([{ label: 'Salaries', value: 60 }, { label: 'Tools', value: 25 }, { label: 'Travel', value: 15 }]);
    const slices = [...svg.matchAll(/<path class="chart-slice"[^>]*>/g)].map((m) => m[0]);
    assert.equal(slices.length, 3);
    for (const slice of slices) {
      assert.doesNotMatch(slice, /stroke=/);
      // outer arc, a line in, inner arc back: a ring segment
      assert.match(slice, /d="M[\d. -]+A84 84 0 [01] 1 [\d. -]+L[\d. -]+A50 50 0 [01] 0 [\d. -]+Z"/);
    }
  });

  test('the whole is named in the middle, and a single part is a full ring', () => {
    const svg = draw([{ label: 'Salaries', value: 60 }, { label: 'Tools', value: 40 }]);
    assert.match(svg, /class="chart-total"[^>]*>100</);
    // One part that is all but the whole: an arc of a full turn has no length, so it is drawn as a ring.
    const one = draw([{ label: 'Nearly everything', value: 1000000 }, { label: 'A sliver', value: 1 }]);
    assert.equal((one.match(/class="chart-slice"/g) || []).length, 1);
    assert.match(one, /class="chart-slice" fill-rule="evenodd"/);
  });

  test('each value sits beside its label, and the ring with its legend is centred', () => {
    const xOf = (svg, cls, anchor = '') => [...svg.matchAll(new RegExp(`<text x="([\\d.]+)"[^>]*${anchor}class="${cls}"`, 'g'))].map((m) => Number(m[1]));
    const short = draw([{ label: 'A', value: 60 }, { label: 'B', value: 40 }]);
    const values = xOf(short, 'chart-value', 'text-anchor="end"[^>]*');
    const labels = xOf(short, 'chart-legend');
    assert.ok(values.length === 2 && labels.length === 2, `${values} ${labels}`);
    // Beside: a value ends within its own width and a gap of its label, not at the chart's far edge.
    assert.ok(values.every((x, i) => x - labels[i] < 140), `${values} ${labels}`);
    // Centred: as much room left of the ring (radius 84) as right of the values.
    const [cx] = xOf(short, 'chart-total', 'text-anchor="middle"[^>]*');
    assert.ok(Math.abs(cx - 84 - (640 - values[0])) < 1, `left ${cx - 84}, right ${640 - values[0]}`);
    // A label too long for the chart is cut, and the block then starts at the left margin.
    const long = draw([{ label: 'A very long name for a part of the whole budget that goes on and on', value: 60 }, { label: 'B', value: 40 }]);
    assert.ok(xOf(long, 'chart-value', 'text-anchor="end"[^>]*').every((x) => x <= 640 - 16));
    assert.equal(xOf(long, 'chart-total', 'text-anchor="middle"[^>]*')[0], 20 + 84);
  });
});
