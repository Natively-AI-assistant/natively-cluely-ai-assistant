// Draws a normalised chart (chartSpec.mjs) as a self-contained SVG string.
//
// Pure: no DOM, no library, no network. The same function draws in the
// overlay, in the main process for the phone, and under Node in tests. The
// output has no script, no link and no external reference; the only `url(#…)`
// values point at patterns defined in the same document.
//
// What the drawing must keep true (and what the tests check):
//   - bars are measured from zero unless the chart carries a stated exception;
//   - a missing value is a gap, never a point at zero;
//   - projected and scenario values look different from observed ones without
//     relying on colour (dashed lines, hatched bars), and the image itself
//     says "Scenario" / "Illustrative" so an exported picture keeps the label;
//   - a scenario range is drawn as a plain band and named as one.

import { estimateTextWidth, truncateToWidth, svgText, svgDocument, svgNum } from './svgText.mjs';
import { formatNumber } from './chartCompute.mjs';

export const CHART_WIDTH = 640;

const DARK_PALETTE = ['#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#f7768e', '#73daca', '#ff9e64', '#a9b1d6'];
const LIGHT_PALETTE = ['#2563eb', '#15803d', '#b45309', '#7c3aed', '#be123c', '#0f766e', '#c2410c', '#475569'];

const DEFAULT_COLORS = Object.freeze({ text: '#111827', muted: '#4b5563', nodeFill: '#f3f4f6', stroke: '#6b7280', groupFill: '#f9fafb', accent: '#2563eb', dark: false });

function paletteFor(colors) {
  return colors.dark ? DARK_PALETTE : LIGHT_PALETTE;
}

/** "Nice" axis ticks covering [min, max]. */
export function niceTicks(minIn, maxIn, target = 5) {
  // Total by construction: this runs during render (and in the main process
  // for the phone), where a loop that never ends is a frozen window. It used
  // to step with `v += step`, which never advances when the range is smaller
  // than the spacing of floating-point numbers ([0.3, 0.30000000000000004]),
  // and to concatenate when handed numeric strings.
  let min = typeof minIn === 'number' ? minIn : Number.NaN;
  let max = typeof maxIn === 'number' ? maxIn : Number.NaN;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min > max) [min, max] = [max, min];
  const scale = Math.max(Math.abs(min), Math.abs(max));
  // A range the axis cannot resolve is one value: pad around it.
  if (!(max - min > scale * 1e-9)) {
    const pad = scale > 0 ? scale * 0.1 : 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / Math.max(1, Number.isFinite(target) ? target : 5);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / pow;
  const step = (unit > 5 ? 10 : unit > 2 ? 5 : unit > 1 ? 2 : 1) * pow;
  if (!Number.isFinite(step) || !(step > 0)) return [min, max];
  const start = Math.floor(min / step) * step;
  const ticks = [];
  // Counted, never accumulated: at most a few dozen ticks whatever the input.
  for (let i = 0; i <= 40; i += 1) {
    const v = start + i * step;
    if (v > max + step * 0.5) break;
    ticks.push(Number(v.toPrecision(12)));
  }
  if (ticks.length > 0 && ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks.length >= 2 ? ticks : [min, max];
}

/** cos(38°): how much of a rotated label's length runs horizontally. */
const ROTATED_COS = 0.788;

/**
 * Greedy label placement: a label is drawn only where it does not cover one
 * already drawn. `boxes` collects [x0, y0, x1, y1]. Returns whether it fits.
 */
function claim(boxes, x0, y0, x1, y1) {
  if (boxes.some(([a, b, c, d]) => x0 < c && x1 > a && y0 < d && y1 > b)) return false;
  boxes.push([x0, y0, x1, y1]);
  return true;
}

function compact(value) {
  const abs = Math.abs(value);
  // The unit is chosen from the ROUNDED figure: 999,999 is "1M", never "1,000.0k".
  if (abs >= 999.95e6) return `${formatNumber(value / 1e9, abs % 1e9 === 0 ? 0 : 1)}B`;
  if (abs >= 999.95e3) return `${formatNumber(value / 1e6, abs % 1e6 === 0 ? 0 : 1)}M`;
  if (abs >= 1e4) return `${formatNumber(value / 1e3, abs % 1e3 === 0 ? 0 : 1)}k`;
  return formatNumber(value);
}

/** A value written on a mark: exact below a million (11,576.25 must not read "11.6k"). */
function exact(value) {
  return Math.abs(value) >= 1e6 ? compact(value) : formatNumber(value);
}

function header(chart, colors, width) {
  const parts = [];
  let y = 0;
  const badgeText = chart.badges.join(' · ');
  const badgeWidth = badgeText ? estimateTextWidth(badgeText, 10.5, 600) + 16 : 0;
  if (chart.title) {
    y += 20;
    parts.push(svgText(14, y, truncateToWidth(chart.title, width - 28 - badgeWidth - (badgeWidth ? 8 : 0), 13.5, 600), { size: 13.5, weight: 600, fill: colors.text }));
  }
  if (badgeText) {
    const by = chart.title ? y - 13 : 6;
    parts.push(
      `<rect x="${svgNum(width - 14 - badgeWidth)}" y="${by}" width="${svgNum(badgeWidth)}" height="18" rx="9" fill="none" stroke="${colors.stroke}" stroke-dasharray="3 2"/>`,
      svgText(width - 14 - badgeWidth / 2, by + 12.5, badgeText, { size: 10.5, weight: 600, fill: colors.text, anchor: 'middle', cls: 'chart-badge' }),
    );
    if (!chart.title) y += 24;
  }
  return { markup: parts.join(''), height: y + (y ? 10 : 8) };
}

function footer(chart, colors, width, top) {
  // The first assumption and source travel inside the image, so an exported
  // picture still says what it rests on.
  const lines = [];
  if (chart.assumptions[0]) lines.push(chart.assumptions[0]);
  if (chart.sources[0]) lines.push(`Source: ${chart.sources[0]}`);
  let y = top;
  const out = [];
  for (const line of lines.slice(0, 2)) {
    y += 14;
    out.push(svgText(14, y, truncateToWidth(line, width - 28, 10.5), { size: 10.5, fill: colors.muted, cls: 'chart-footnote' }));
  }
  return { markup: out.join(''), height: lines.length ? y - top + 8 : 6 };
}

function legend(items, colors, width, top) {
  if (items.length < 2) return { markup: '', height: 0 };
  const out = [];
  let x = 14;
  let y = top + 10;
  for (const item of items) {
    const label = truncateToWidth(item.label, 150, 11);
    const w = 18 + estimateTextWidth(label, 11) + 14;
    if (x + w > width - 14 && x > 14) {
      x = 14;
      y += 16;
    }
    out.push(item.swatch(x, y - 4), svgText(x + 18, y, label, { size: 11, fill: colors.muted }));
    x += w;
  }
  return { markup: out.join(''), height: y - top + 10 };
}

function hatch(id, color) {
  return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${color}" fill-opacity="0.16"/><line x1="0" y1="0" x2="0" y2="6" stroke="${color}" stroke-width="2.2"/></pattern>`;
}

/** Is value `i` of this series a projection (rather than an observation)? */
function isProjected(series, i) {
  if (series.status === 'scenario' || series.status === 'illustrative') return series.projectedFrom === null ? true : i >= series.projectedFrom;
  return series.projectedFrom !== null && i >= series.projectedFrom;
}

// ── cartesian: line / bar / grouped / stacked ───────────────────────────────

function drawCartesian(chart, colors, palette) {
  const width = CHART_WIDTH;
  const head = header(chart, colors, width);
  const n = chart.x.values.length;
  const stacked = chart.type === 'stacked-bar';
  const isLine = chart.type === 'line';
  const numericX = chart.x.kind === 'number';

  const allValues = [];
  if (stacked) {
    for (let i = 0; i < n; i += 1) allValues.push(chart.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  } else {
    for (const s of chart.series) for (const v of s.values) if (v !== null) allValues.push(v);
  }
  if (chart.band) for (const v of [...chart.band.low, ...chart.band.high]) if (v !== null) allValues.push(v);
  let lo = Math.min(...allValues);
  let hi = Math.max(...allValues);
  if (!isLine) {
    // Bars are lengths: they are measured from zero (or from a stated, disclosed floor).
    lo = chart.y.min !== null ? Math.min(chart.y.min, lo) : Math.min(0, lo);
    hi = Math.max(0, hi);
  } else if (chart.y.min !== null) lo = Math.min(chart.y.min, lo);
  const ticks = niceTicks(lo, hi, 5);
  const yMin = isLine && chart.y.min === null ? ticks[0] : Math.min(lo, ticks[0]);
  const yMax = ticks[ticks.length - 1];

  const leg = legend(
    chart.series.map((s, k) => ({
      label: `${s.name}${s.status === 'scenario' ? ' (scenario)' : s.status === 'illustrative' ? ' (illustrative)' : ''}`,
      swatch: (x, y) =>
        isLine
          ? `<line x1="${x}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="${palette[k % palette.length]}" stroke-width="2.2"${s.status !== 'observed' && s.status !== 'calculated' ? ' stroke-dasharray="4 3"' : ''}/>`
          : `<rect x="${x}" y="${y - 5}" width="12" height="10" rx="2" fill="${s.status === 'observed' || s.status === 'calculated' ? palette[k % palette.length] : `url(#hatch${k})`}" stroke="${palette[k % palette.length]}"/>`,
    })),
    colors,
    width,
    head.height,
  );

  const tickLabels = ticks.map(compact);
  const left = Math.max(40, Math.ceil(Math.max(...tickLabels.map((t) => estimateTextWidth(t, 10.5))) + 16 + (chart.y.label ? 14 : 0)));
  const right = 18;
  const top = head.height + leg.height + 8;
  const plotW = width - left - right;
  const plotH = 208;
  const slot = plotW / n;
  const xLabelSize = 10.5;
  const longest = Math.max(...chart.x.values.map((v) => estimateTextWidth(numericX ? compact(v) : v, xLabelSize)));
  const rotate = !numericX && longest > slot - 6;
  const xLabelHeight = rotate ? Math.min(64, longest * 0.72 + 12) : 18;
  const bottomAxis = top + plotH;
  const yOf = (v) => bottomAxis - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const xMinNum = numericX ? chart.x.values[0] : 0;
  const xMaxNum = numericX ? chart.x.values[n - 1] : 0;
  const xOf = (i) => (numericX ? left + ((chart.x.values[i] - xMinNum) / (xMaxNum - xMinNum || 1)) * plotW : isLine ? left + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1)) : left + slot * (i + 0.5));

  const defs = chart.series.map((_s, k) => hatch(`hatch${k}`, palette[k % palette.length])).join('');
  const out = [`<defs>${defs}</defs>`, head.markup, leg.markup];

  // grid + y labels
  ticks.forEach((t, i) => {
    if (t < yMin - 1e-9) return;
    const y = yOf(t);
    out.push(`<line x1="${left}" y1="${svgNum(y)}" x2="${width - right}" y2="${svgNum(y)}" stroke="${colors.stroke}" stroke-opacity="${t === 0 ? 0.9 : 0.22}" stroke-width="1"/>`);
    out.push(svgText(left - 6, y + 3.5, tickLabels[i], { size: 10.5, fill: colors.muted, anchor: 'end' }));
  });
  if (chart.y.label || chart.y.unit) {
    const label = chart.y.unit ? `${chart.y.label || 'Value'} (${chart.y.unit})` : chart.y.label;
    out.push(svgText(12, top + plotH / 2, truncateToWidth(label, plotH, 10.5), { size: 10.5, fill: colors.muted, anchor: 'middle', transform: `rotate(-90 12 ${svgNum(top + plotH / 2)})` }));
  }

  // x labels
  if (numericX) {
    const xTicks = niceTicks(xMinNum, xMaxNum, 6).filter((t) => t >= xMinNum - 1e-9 && t <= xMaxNum + 1e-9);
    for (const t of xTicks) {
      const x = left + ((t - xMinNum) / (xMaxNum - xMinNum || 1)) * plotW;
      out.push(svgText(x, bottomAxis + 14, compact(t), { size: xLabelSize, fill: colors.muted, anchor: 'middle' }));
    }
  } else {
    const every = rotate ? Math.ceil(n / 24) : Math.ceil((longest + 8) / Math.max(1, isLine && n > 1 ? plotW / (n - 1) : slot));
    chart.x.values.forEach((label, i) => {
      if (i % Math.max(1, every) !== 0 && i !== n - 1) return;
      const x = xOf(i);
      // A label rotated about its end runs down and to the LEFT: it gets only
      // as much room as there is between its anchor and the canvas edge.
      if (rotate) out.push(svgText(x, bottomAxis + 10, truncateToWidth(label, Math.max(18, Math.min(84, (x - 4) / ROTATED_COS)), xLabelSize), { size: xLabelSize, fill: colors.muted, anchor: 'end', transform: `rotate(-38 ${svgNum(x)} ${svgNum(bottomAxis + 10)})` }));
      else {
        // On a line chart the first and last points sit on the plot's edges.
        const anchor = isLine && n > 1 && i === 0 ? 'start' : isLine && n > 1 && i === n - 1 ? 'end' : 'middle';
        out.push(svgText(x, bottomAxis + 14, label, { size: xLabelSize, fill: colors.muted, anchor }));
      }
    });
  }
  let below = bottomAxis + xLabelHeight;
  if (chart.x.label) {
    below += 12;
    out.push(svgText(left + plotW / 2, below, chart.x.unit ? `${chart.x.label} (${chart.x.unit})` : chart.x.label, { size: 10.5, fill: colors.muted, anchor: 'middle' }));
  }

  // scenario range / interval
  if (chart.band) {
    const up = [];
    const down = [];
    for (let i = 0; i < n; i += 1) {
      if (chart.band.low[i] === null || chart.band.high[i] === null) continue;
      up.push(`${svgNum(xOf(i))},${svgNum(yOf(chart.band.high[i]))}`);
      down.unshift(`${svgNum(xOf(i))},${svgNum(yOf(chart.band.low[i]))}`);
    }
    if (up.length > 1) out.push(`<polygon class="chart-band" data-meaning="${chart.band.meaning}" points="${[...up, ...down].join(' ')}" fill="${palette[0]}" fill-opacity="0.14" stroke="none"/>`);
  }

  // Where a break-even calculation crosses zero, say so on the drawing.
  const breakEvenRun = chart.calc ? chart.calc.runs.find((r) => r.kind === 'break_even' && Number.isInteger(r.breakEvenPeriod)) : null;
  if (breakEvenRun && isLine && breakEvenRun.breakEvenPeriod < n) {
    const bx = xOf(breakEvenRun.breakEvenPeriod);
    out.push(`<line class="chart-marker" x1="${svgNum(bx)}" y1="${top}" x2="${svgNum(bx)}" y2="${bottomAxis}" stroke="${colors.stroke}" stroke-dasharray="2 3"/>`);
    const markerText = `Break-even: ${chart.x.values[breakEvenRun.breakEvenPeriod]}`;
    const markerW = estimateTextWidth(markerText, 10.5);
    // To the left of the line when it fits inside the plot there, else to the right.
    const onLeft = bx - 5 - markerW >= left + 2;
    out.push(svgText(onLeft ? bx - 5 : bx + 5, top + 11, markerText, { size: 10.5, fill: colors.text, anchor: onLeft ? 'end' : 'start', cls: 'chart-marker-label' }));
  }

  if (isLine) {
    chart.series.forEach((s, k) => {
      const color = palette[k % palette.length];
      // Split into runs at gaps; within a run, split again where projection starts.
      let run = [];
      const flush = () => {
        if (run.length === 0) return;
        const solid = run.filter((p) => !p.projected);
        const firstProjected = run.findIndex((p) => p.projected);
        if (solid.length > 1) out.push(`<polyline class="chart-line" data-status="${s.status}" points="${solid.map((p) => `${svgNum(p.x)},${svgNum(p.y)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`);
        if (firstProjected !== -1) {
          // The dashed part starts at the last observed point, so the two join.
          const from = Math.max(0, firstProjected - 1);
          const dashed = run.slice(from);
          if (dashed.length > 1) out.push(`<polyline class="chart-line chart-line--projected" data-status="${s.status}" points="${dashed.map((p) => `${svgNum(p.x)},${svgNum(p.y)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.2" stroke-dasharray="${s.status === 'illustrative' ? '1.5 4' : '6 4'}" stroke-linejoin="round" stroke-linecap="round"/>`);
        }
        run = [];
      };
      s.values.forEach((v, i) => {
        if (v === null) {
          flush();
          return;
        }
        run.push({ x: xOf(i), y: yOf(v), projected: isProjected(s, i), i });
      });
      flush();
      if (n <= 36) {
        s.values.forEach((v, i) => {
          if (v === null) return;
          const projected = isProjected(s, i);
          out.push(`<circle class="chart-point" cx="${svgNum(xOf(i))}" cy="${svgNum(yOf(v))}" r="3" fill="${projected ? 'none' : color}" stroke="${color}" stroke-width="1.6"/>`);
        });
      }
      // Label the ends when there is room for it.
      if (chart.series.length === 1 && n <= 8) {
        s.values.forEach((v, i) => {
          if (v === null) return;
          out.push(svgText(xOf(i), yOf(v) - 8, exact(v), { size: 10.5, fill: colors.text, anchor: i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', cls: 'chart-value' }));
        });
      }
    });
  } else {
    const groupW = Math.min(slot * 0.72, 84);
    const barW = stacked ? groupW : groupW / chart.series.length;
    const showValues = n * (stacked ? 1 : chart.series.length) <= 10;
    for (let i = 0; i < n; i += 1) {
      let stackBase = 0;
      chart.series.forEach((s, k) => {
        const v = s.values[i];
        if (v === null) return;
        const color = palette[k % palette.length];
        const projected = isProjected(s, i);
        const x0 = stacked ? xOf(i) - groupW / 2 : xOf(i) - groupW / 2 + k * barW;
        const from = stacked ? stackBase : Math.max(yMin, Math.min(0, yMax));
        const to = stacked ? stackBase + v : v;
        if (stacked) stackBase += v;
        const y1 = yOf(Math.max(from, to));
        const h = Math.max(1, Math.abs(yOf(from) - yOf(to)));
        out.push(`<rect class="chart-bar${projected ? ' chart-bar--projected' : ''}" data-status="${s.status}" x="${svgNum(x0 + 1)}" y="${svgNum(y1)}" width="${svgNum(Math.max(2, barW - 2))}" height="${svgNum(h)}" rx="2" fill="${projected ? `url(#hatch${k})` : color}" stroke="${color}" stroke-width="1"/>`);
        if (showValues && !stacked) {
          // The exact figure when it fits over its bar, the short form when
          // only that fits, nothing when neither does (the Data tab has it).
          const room = (chart.series.length > 1 ? barW : slot) - 2;
          const full = n * chart.series.length <= 6 ? exact(v) : compact(v);
          const shown = estimateTextWidth(full, 10) <= room ? full : estimateTextWidth(compact(v), 10) <= room ? compact(v) : '';
          if (shown) out.push(svgText(x0 + barW / 2, (v >= 0 ? y1 : y1 + h + 11) - 4 + (v >= 0 ? 0 : 4), shown, { size: 10, fill: colors.text, anchor: 'middle', cls: 'chart-value' }));
        }
      });
    }
  }

  const foot = footer(chart, colors, width, below + 2);
  out.push(foot.markup);
  return { body: out.join(''), width, height: below + 2 + foot.height };
}

// ── pie ─────────────────────────────────────────────────────────────────────

function drawPie(chart, colors, palette) {
  const width = CHART_WIDTH;
  const head = header(chart, colors, width);
  const r = 84;
  const cx = 14 + r + 6;
  const cy = head.height + r + 10;
  const total = chart.parts.reduce((sum, p) => sum + p.value, 0);
  const out = [head.markup];
  let angle = -Math.PI / 2;
  chart.parts.forEach((p, k) => {
    const sweep = (p.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
    // A sliver too thin to draw (one in a million) is named in the legend only.
    if (sweep < 0.004) return;
    // A part that is (all but) the whole is a full circle; an arc of 2π has no length.
    const shape = sweep >= Math.PI * 2 - 0.004
      ? `<circle class="chart-slice" cx="${cx}" cy="${cy}" r="${r}" fill="${palette[k % palette.length]}"/>`
      : `<path class="chart-slice" d="M${cx} ${cy}L${svgNum(p0[0])} ${svgNum(p0[1])}A${r} ${r} 0 ${large} 1 ${svgNum(p1[0])} ${svgNum(p1[1])}Z" fill="${palette[k % palette.length]}" stroke="${colors.dark ? '#111318' : '#ffffff'}" stroke-width="1.5"/>`;
    out.push(shape);
  });
  const lx = cx + r + 28;
  chart.parts.forEach((p, k) => {
    const y = head.height + 26 + k * 22;
    out.push(`<rect x="${lx}" y="${y - 9}" width="11" height="11" rx="2" fill="${palette[k % palette.length]}"/>`);
    out.push(svgText(lx + 18, y, truncateToWidth(p.label, width - lx - 18 - 150, 11.5), { size: 11.5, fill: colors.text }));
    out.push(svgText(width - 16, y, `${compact(p.value)}${chart.y.unit ? ` ${chart.y.unit}` : ''} · ${formatNumber(p.percent, 1)}%`, { size: 11.5, fill: colors.muted, anchor: 'end', cls: 'chart-value' }));
  });
  const bottom = Math.max(cy + r + 8, head.height + 26 + chart.parts.length * 22);
  const foot = footer(chart, colors, width, bottom);
  out.push(foot.markup);
  return { body: out.join(''), width, height: bottom + foot.height };
}

// ── ordered stage counts ────────────────────────────────────────────────────

function drawFunnel(chart, colors, palette) {
  const width = CHART_WIDTH;
  const head = header(chart, colors, width);
  const labelW = Math.min(170, Math.max(...chart.stages.map((s) => estimateTextWidth(s.label, 11.5))) + 12);
  const valueW = 150;
  const left = 14 + labelW;
  const barMax = width - left - valueW - 14;
  const max = Math.max(...chart.stages.map((s) => s.value), 1);
  const rowH = 30;
  const out = [head.markup];
  chart.stages.forEach((s, i) => {
    const y = head.height + 6 + i * rowH;
    const w = Math.max(2, (s.value / max) * barMax);
    out.push(svgText(left - 10, y + 16, truncateToWidth(s.label, labelW - 6, 11.5), { size: 11.5, fill: colors.text, anchor: 'end' }));
    out.push(`<rect class="chart-bar chart-stage" x="${left}" y="${y + 4}" width="${svgNum(w)}" height="${rowH - 10}" rx="3" fill="${palette[0]}" fill-opacity="${svgNum(1 - i * (0.5 / Math.max(1, chart.stages.length - 1)))}"/>`);
    const rate = s.ratePercent === null ? '' : ` · ${formatNumber(s.ratePercent, 1)}% of previous`;
    const valueText = `${compact(s.value)}${chart.y.unit ? ` ${chart.y.unit}` : ''}${rate}`;
    out.push(svgText(left + w + 8, y + 16, truncateToWidth(valueText, width - (left + w + 8) - 8, 11), { size: 11, fill: colors.muted, cls: 'chart-value' }));
  });
  const bottom = head.height + 6 + chart.stages.length * rowH + 4;
  const foot = footer(chart, colors, width, bottom);
  out.push(foot.markup);
  return { body: out.join(''), width, height: bottom + foot.height };
}

// ── waterfall ───────────────────────────────────────────────────────────────

function drawWaterfall(chart, colors, palette) {
  const width = CHART_WIDTH;
  const head = header(chart, colors, width);
  const n = chart.steps.length;
  const values = chart.steps.flatMap((s) => [s.start, s.end]);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 5);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const tickLabels = ticks.map(compact);
  const left = Math.max(40, Math.ceil(Math.max(...tickLabels.map((t) => estimateTextWidth(t, 10.5))) + 16));
  const right = 18;
  const top = head.height + 8;
  const plotW = width - left - right;
  const plotH = 208;
  const slot = plotW / n;
  const yOf = (v) => top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const up = colors.dark ? '#9ece6a' : '#15803d';
  const down = colors.dark ? '#f7768e' : '#be123c';
  const out = [head.markup];
  ticks.forEach((t, i) => {
    const y = yOf(t);
    out.push(`<line x1="${left}" y1="${svgNum(y)}" x2="${width - right}" y2="${svgNum(y)}" stroke="${colors.stroke}" stroke-opacity="${t === 0 ? 0.9 : 0.22}"/>`);
    out.push(svgText(left - 6, y + 3.5, tickLabels[i], { size: 10.5, fill: colors.muted, anchor: 'end' }));
  });
  const barW = Math.min(slot * 0.66, 72);
  const longest = Math.max(...chart.steps.map((s) => estimateTextWidth(s.label, 10.5)));
  const rotate = longest > slot - 6;
  chart.steps.forEach((s, i) => {
    const cx = left + slot * (i + 0.5);
    const y1 = yOf(Math.max(s.start, s.end));
    const h = Math.max(1, Math.abs(yOf(s.start) - yOf(s.end)));
    const fill = s.kind === 'delta' ? (s.value >= 0 ? up : down) : palette[0];
    out.push(`<rect class="chart-bar chart-step" data-kind="${s.kind}" x="${svgNum(cx - barW / 2)}" y="${svgNum(y1)}" width="${svgNum(barW)}" height="${svgNum(h)}" rx="2" fill="${fill}"/>`);
    // A minus sign as well as the colour says which way a change goes.
    const label = s.kind === 'delta' ? `${s.value >= 0 ? '+' : '−'}${compact(Math.abs(s.value))}` : compact(s.end);
    out.push(svgText(cx, y1 - 5, label, { size: 10, fill: colors.text, anchor: 'middle', cls: 'chart-value' }));
    if (i < n - 1) {
      const nx = left + slot * (i + 1.5);
      out.push(`<line x1="${svgNum(cx + barW / 2)}" y1="${svgNum(yOf(s.end))}" x2="${svgNum(nx - barW / 2)}" y2="${svgNum(yOf(s.end))}" stroke="${colors.stroke}" stroke-dasharray="2 3"/>`);
    }
    const ly = top + plotH + (rotate ? 10 : 14);
    if (rotate) out.push(svgText(cx, ly, truncateToWidth(s.label, Math.max(18, Math.min(84, (cx - 4) / ROTATED_COS)), 10.5), { size: 10.5, fill: colors.muted, anchor: 'end', transform: `rotate(-38 ${svgNum(cx)} ${svgNum(ly)})` }));
    else out.push(svgText(cx, ly, s.label, { size: 10.5, fill: colors.muted, anchor: 'middle' }));
  });
  const bottom = top + plotH + (rotate ? Math.min(64, longest * 0.72 + 12) : 20);
  const foot = footer(chart, colors, width, bottom);
  out.push(foot.markup);
  return { body: out.join(''), width, height: bottom + foot.height };
}

// ── matrix ──────────────────────────────────────────────────────────────────

function drawHeatmap(chart, colors, palette) {
  const width = CHART_WIDTH;
  const head = header(chart, colors, width);
  const { rows, cols, cells, numeric } = chart.heat;
  const labelW = Math.min(190, Math.max(...rows.map((r) => estimateTextWidth(r, 11))) + 14);
  const left = 14 + labelW;
  const cellW = (width - left - 14) / cols.length;
  const cellH = 28;
  const top = head.height + 22;
  const out = [head.markup];
  cols.forEach((c, j) => out.push(svgText(left + cellW * (j + 0.5), top - 7, truncateToWidth(c, cellW - 6, 10.5, 600), { size: 10.5, weight: 600, fill: colors.muted, anchor: 'middle' })));
  const flat = numeric ? cells.flat().filter((v) => v !== null) : [];
  const lo = numeric ? Math.min(...flat) : 0;
  const hi = numeric ? Math.max(...flat) : 0;
  const categories = numeric ? [] : [...new Set(cells.flat().filter(Boolean))];
  rows.forEach((r, i) => {
    const y = top + i * cellH;
    out.push(svgText(left - 8, y + cellH / 2 + 4, truncateToWidth(r, labelW - 8, 11), { size: 11, fill: colors.text, anchor: 'end' }));
    cols.forEach((_c, j) => {
      const v = cells[i][j];
      const x = left + j * cellW;
      const empty = v === null || v === '';
      let fill = 'none';
      let opacity = 1;
      if (!empty && numeric) {
        fill = palette[0];
        opacity = 0.12 + 0.6 * ((v - lo) / (hi - lo || 1));
      } else if (!empty) {
        fill = palette[categories.indexOf(v) % palette.length];
        opacity = 0.22;
      }
      out.push(`<rect class="chart-cell" x="${svgNum(x + 1)}" y="${svgNum(y + 1)}" width="${svgNum(cellW - 2)}" height="${cellH - 2}" rx="3" fill="${fill}" fill-opacity="${svgNum(opacity)}" stroke="${colors.stroke}" stroke-opacity="0.3"${empty ? ' stroke-dasharray="3 3"' : ''}/>`);
      // The value is written in the cell: the shade alone is never the message.
      if (!empty) out.push(svgText(x + cellW / 2, y + cellH / 2 + 4, truncateToWidth(numeric ? compact(v) : v, cellW - 8, 10.5), { size: 10.5, fill: colors.text, anchor: 'middle', cls: 'chart-value' }));
    });
  });
  const bottom = top + rows.length * cellH + 6;
  const foot = footer(chart, colors, width, bottom);
  out.push(foot.markup);
  return { body: out.join(''), width, height: bottom + foot.height };
}

// ── scatter / quadrant ──────────────────────────────────────────────────────

function drawPoints(chart, colors, palette) {
  const width = CHART_WIDTH;
  const head = header(chart, colors, width);
  const q = chart.quadrant;
  const xs = chart.points.map((p) => p.x);
  const ys = chart.points.map((p) => p.y);
  const xTicks = q ? niceTicks(q.xMin, q.xMax, 4) : niceTicks(Math.min(...xs), Math.max(...xs), 5);
  const yTicks = q ? niceTicks(q.yMin, q.yMax, 4) : niceTicks(Math.min(...ys), Math.max(...ys), 5);
  const xMin = q ? q.xMin : xTicks[0];
  const xMax = q ? q.xMax : xTicks[xTicks.length - 1];
  const yMin = q ? q.yMin : yTicks[0];
  const yMax = q ? q.yMax : yTicks[yTicks.length - 1];
  const left = 52;
  const right = 20;
  const top = head.height + 10;
  const plotW = width - left - right;
  const plotH = 232;
  const xOf = (v) => left + ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const yOf = (v) => top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const out = [head.markup, `<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="none" stroke="${colors.stroke}" stroke-opacity="0.5"/>`];
  /** Label boxes already drawn (corner labels, then point names). */
  const taken = [];
  for (const t of xTicks.filter((v) => v >= xMin && v <= xMax)) out.push(svgText(xOf(t), top + plotH + 14, compact(t), { size: 10.5, fill: colors.muted, anchor: 'middle' }));
  for (const t of yTicks.filter((v) => v >= yMin && v <= yMax)) out.push(svgText(left - 6, yOf(t) + 3.5, compact(t), { size: 10.5, fill: colors.muted, anchor: 'end' }));
  if (q) {
    const mx = xOf((xMin + xMax) / 2);
    const my = yOf((yMin + yMax) / 2);
    out.push(`<line class="chart-midline" x1="${svgNum(mx)}" y1="${top}" x2="${svgNum(mx)}" y2="${top + plotH}" stroke="${colors.stroke}" stroke-dasharray="4 4"/>`);
    out.push(`<line class="chart-midline" x1="${left}" y1="${svgNum(my)}" x2="${left + plotW}" y2="${svgNum(my)}" stroke="${colors.stroke}" stroke-dasharray="4 4"/>`);
    const corners = [[left + 8, top + 15, 'start'], [left + plotW - 8, top + 15, 'end'], [left + 8, top + plotH - 8, 'start'], [left + plotW - 8, top + plotH - 8, 'end']];
    q.labels.forEach((label, i) => {
      if (!label || !corners[i]) return;
      const w = estimateTextWidth(label, 10.5);
      const [cx, cy, anchor] = corners[i];
      claim(taken, anchor === 'start' ? cx : cx - w, cy - 10, anchor === 'start' ? cx + w : cx, cy + 3);
      out.push(svgText(cx, cy, label, { size: 10.5, fill: colors.muted, anchor, italic: true }));
    });
  }
  chart.points.forEach((p, k) => {
    const x = xOf(p.x);
    const y = yOf(p.y);
    out.push(`<circle class="chart-point" cx="${svgNum(x)}" cy="${svgNum(y)}" r="4.5" fill="${palette[q ? 0 : k % palette.length]}" stroke="${colors.dark ? '#111318' : '#ffffff'}" stroke-width="1.2"/>`);
    if (p.label && chart.points.length <= 14) {
      // A name is written beside its point on whichever side is free; a point
      // with no free side keeps its dot and is named in the Data tab.
      const text = truncateToWidth(p.label, 130, 10.5);
      const w = estimateTextWidth(text, 10.5);
      const preferLeft = x > left + plotW * 0.72;
      for (const toLeft of [preferLeft, !preferLeft]) {
        const x0 = toLeft ? x - 8 - w : x + 8;
        if (x0 < left - 2 || x0 + w > width - 4) continue;
        if (!claim(taken, x0, y - 7, x0 + w, y + 6)) continue;
        out.push(svgText(x + (toLeft ? -8 : 8), y + 3.5, text, { size: 10.5, fill: colors.text, anchor: toLeft ? 'end' : 'start' }));
        break;
      }
    }
  });
  let bottom = top + plotH + 20;
  if (chart.x.label) {
    bottom += 12;
    out.push(svgText(left + plotW / 2, bottom, chart.x.unit ? `${chart.x.label} (${chart.x.unit})` : chart.x.label, { size: 10.5, fill: colors.muted, anchor: 'middle' }));
  }
  if (chart.y.label) out.push(svgText(14, top + plotH / 2, truncateToWidth(chart.y.unit ? `${chart.y.label} (${chart.y.unit})` : chart.y.label, plotH, 10.5), { size: 10.5, fill: colors.muted, anchor: 'middle', transform: `rotate(-90 14 ${svgNum(top + plotH / 2)})` }));
  const foot = footer(chart, colors, width, bottom + 2);
  out.push(foot.markup);
  return { body: out.join(''), width, height: bottom + 2 + foot.height };
}

/**
 * Draw a normalised chart.
 *
 * @param {object} chart  the `chart` returned by normaliseChartSpec
 * @param {{ text: string, muted: string, stroke: string, nodeFill: string, groupFill: string, accent: string, dark: boolean }} [colors]
 * @returns {{ svg: string, width: number, height: number }}
 */
export function renderChartSvg(chart, colors = DEFAULT_COLORS) {
  const palette = paletteFor(colors);
  let drawn;
  if (chart.type === 'pie') drawn = drawPie(chart, colors, palette);
  else if (chart.type === 'funnel') drawn = drawFunnel(chart, colors, palette);
  else if (chart.type === 'waterfall') drawn = drawWaterfall(chart, colors, palette);
  else if (chart.type === 'heatmap') drawn = drawHeatmap(chart, colors, palette);
  else if (chart.type === 'scatter' || chart.type === 'quadrant') drawn = drawPoints(chart, colors, palette);
  else drawn = drawCartesian(chart, colors, palette);
  const height = Math.ceil(drawn.height);
  return { svg: svgDocument(drawn.width, height, drawn.body, { title: chart.title || 'Chart', kind: `chart:${chart.type}` }), width: drawn.width, height };
}
