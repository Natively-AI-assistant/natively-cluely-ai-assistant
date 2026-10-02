// One entry point for the visual artifacts that are NOT written as Mermaid:
// charts (`natively-chart`) and notation-specific diagrams (`natively-diagram`:
// Chen ER, formal automata).
//
// A block's text goes in; either a finished drawing comes out, or a readable
// reason why it cannot be drawn. Everything here is local and deterministic:
// validate the payload, run any calculation it names, draw. No model call, no
// network, no DOM — so the overlay, the main process (for the phone) and the
// tests all use this same function.
//
//   compileVisualSource('chart' | 'notation', text, colors) →
//     { ok: true, renderer: 'svg', svg, width, height, … }        charts, Chen ER
//     { ok: true, renderer: 'mermaid', mermaid, … }               automata: source
//                                                                 this app wrote,
//                                                                 for the Mermaid
//                                                                 renderer
//     { ok: false, stage: 'spec', code, message, missing? }
//
// Every success also carries what the card needs besides the picture: a title,
// a plain-language description, notes (what was corrected or is unknown), a
// data table where there is one, and the texts the export buttons write.

import { normaliseChartSpec, parseChartJson, chartCsv, chartLabel, describeChart } from './chartSpec.mjs';
import { renderChartSvg } from './chartSvg.mjs';
import { validateChenEr, renderChenErSvg, describeChenEr } from './chenEr.mjs';
import { validateAutomaton, automatonToMermaid, describeAutomaton, automatonTable } from './automaton.mjs';
import { isSafeDiagramSvg } from './diagramPolicy.mjs';

export { VISUAL_FENCE_LANGS, VISUAL_FENCE_TAG } from './fencedBlocks.mjs';

export const NOTATION_KINDS = Object.freeze(['chen-er', 'automaton']);

/** The fixed light palette used for the phone (its card is white in both themes). */
export const PHONE_VISUAL_COLORS = Object.freeze({
  text: '#111827',
  muted: '#4b5563',
  nodeFill: '#f3f4f6',
  stroke: '#6b7280',
  groupFill: '#f9fafb',
  accent: '#2563eb',
  dark: false,
});

function fail(code, message, extra = {}) {
  return { ok: false, stage: 'spec', code, message, ...extra };
}

const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;

function compileChart(source, colors) {
  const result = normaliseChartSpec(source);
  if (!result.ok) return fail(result.code, result.message, result.missing ? { missing: result.missing } : {});
  const drawn = renderChartSvg(result.chart, colors);
  if (!isSafeDiagramSvg(drawn.svg)) return fail('unsafe_output', 'The chart was blocked because it is not safe to display.');
  const parsed = parseChartJson(source);
  const chart = result.chart;
  return {
    ok: true,
    renderer: 'svg',
    artifact: 'chart',
    view: 'chart',
    svg: drawn.svg,
    width: drawn.width,
    height: drawn.height,
    label: chartLabel(chart),
    title: chart.title,
    description: describeChart(chart),
    badges: chart.badges,
    notes: chart.notes,
    assumptions: chart.assumptions,
    sources: chart.sources,
    table: result.table,
    exports: {
      // The inputs as written, with what the app computed from them beside it.
      json: pretty({ ...(parsed.ok ? parsed.value : {}), computed: { table: result.table, ...(chart.calc ? { calculation: chart.calc } : {}), status: chart.badges, notes: chart.notes } }),
      csv: chartCsv(chart, result.table),
    },
  };
}

const CHEN_MAX_WIDTH = 2200;

function compileNotation(source, colors) {
  const parsed = parseChartJson(source);
  if (!parsed.ok) return fail(parsed.code === 'too_large' ? 'too_large' : 'syntax', parsed.code === 'too_large' ? 'This diagram is too large to draw here.' : 'The diagram data could not be read.');
  const spec = parsed.value;
  const kind = String(spec.kind ?? '').toLowerCase();
  if (kind === 'chen-er' || kind === 'chen') {
    const checked = validateChenEr(spec);
    if (!checked.ok) return fail(checked.code, checked.message);
    const drawn = renderChenErSvg(checked.model, colors);
    // Fitted to a card, anything wider than this is too small to read. Saying
    // so is more use than a picture nobody can make out.
    if (drawn.width > CHEN_MAX_WIDTH) return fail('too_large', 'This model is too wide to draw here. Show fewer entities or attributes at a time.');
    if (!isSafeDiagramSvg(drawn.svg)) return fail('unsafe_output', 'The diagram was blocked because it is not safe to display.');
    const unknown = checked.model.unknowns.length ? [`Not stated, so not drawn: ${checked.model.unknowns.join('; ')}.`] : [];
    return {
      ok: true,
      renderer: 'svg',
      artifact: 'notation',
      view: 'chen',
      svg: drawn.svg,
      width: drawn.width,
      height: drawn.height,
      label: 'ER diagram (Chen)',
      title: checked.model.title,
      description: describeChenEr(checked.model),
      badges: [],
      notes: [...unknown, ...checked.model.notes],
      assumptions: [],
      sources: [],
      table: null,
      exports: { json: pretty(spec) },
    };
  }
  if (kind === 'automaton' || kind === 'dfa' || kind === 'nfa') {
    const checked = validateAutomaton(kind === 'automaton' ? spec : { ...spec, type: spec.type ?? kind });
    if (!checked.ok) return fail(checked.code, checked.message);
    return {
      ok: true,
      renderer: 'mermaid',
      artifact: 'notation',
      view: 'automaton',
      mermaid: automatonToMermaid(checked.model),
      label: checked.model.type === 'dfa' ? 'DFA' : 'NFA',
      title: checked.model.title,
      description: describeAutomaton(checked.model),
      badges: [],
      notes: checked.model.notes,
      assumptions: [],
      sources: [],
      table: automatonTable(checked.model),
      exports: { json: pretty(spec) },
    };
  }
  return fail('unsupported_notation', 'That notation is not supported here.');
}

/**
 * Compile a chart or notation block. Never throws.
 *
 * @param {'chart' | 'notation'} kind
 * @param {string} source the fenced block's content
 * @param {object} [colors] theme palette (see mermaidRenderer's DiagramThemeColors)
 */
export function compileVisualSource(kind, source, colors) {
  try {
    if (kind === 'chart') return compileChart(source, colors);
    if (kind === 'notation') return compileNotation(source, colors);
    return fail('unsupported_kind', 'This block is not a chart or a notation diagram.');
  } catch {
    // A drawing bug must degrade to the readable fallback, never take the answer down.
    return fail('internal', kind === 'chart' ? 'This chart could not be drawn.' : 'This diagram could not be drawn.');
  }
}

/**
 * Is this chart / notation block valid, and what does it show? The same checks
 * compileVisualSource runs, without drawing anything (the main process calls
 * this for every finished answer that holds such a block).
 *
 * @returns {{ ok: true, view: string, type: string } | { ok: false, code: string }}
 */
export function checkVisualSource(kind, source) {
  try {
    // One definition of "valid": what the card would draw. The session records
    // an artifact through this check, and it must never remember one the card
    // then refuses (a width, an output check).
    const compiled = compileVisualSource(kind, source);
    if (!compiled.ok) return { ok: false, code: compiled.code };
    if (kind === 'chart') {
      const result = normaliseChartSpec(source);
      return result.ok ? { ok: true, view: 'chart', type: result.chart.type } : { ok: false, code: result.code };
    }
    if (kind === 'notation') {
      const parsed = parseChartJson(source);
      if (!parsed.ok) return { ok: false, code: 'syntax' };
      const k = String(parsed.value.kind ?? '').toLowerCase();
      if (k === 'chen-er' || k === 'chen') {
        const checked = validateChenEr(parsed.value);
        return checked.ok ? { ok: true, view: 'chen', type: 'chen-er' } : { ok: false, code: checked.code };
      }
      if (k === 'automaton' || k === 'dfa' || k === 'nfa') {
        const checked = validateAutomaton(k === 'automaton' ? parsed.value : { ...parsed.value, type: parsed.value.type ?? k });
        return checked.ok ? { ok: true, view: 'automaton', type: checked.model.type } : { ok: false, code: checked.code };
      }
      return { ok: false, code: 'unsupported_notation' };
    }
    return { ok: false, code: 'unsupported_kind' };
  } catch {
    return { ok: false, code: 'internal' };
  }
}

/** A stable identity for a chart / notation block: what its lineage and "same artifact" checks compare. */
export function visualSourceSummary(kind, source) {
  const parsed = parseChartJson(source);
  if (!parsed.ok) return { ok: false, view: kind === 'chart' ? 'chart' : 'notation', words: [] };
  const spec = parsed.value;
  const words = new Set();
  const add = (value) => {
    if (typeof value !== 'string') return;
    for (const w of value.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3) words.add(w);
  };
  const walk = (value, depth) => {
    if (depth > 4) return;
    if (typeof value === 'string') add(value);
    else if (Array.isArray(value)) for (const v of value.slice(0, 60)) walk(v, depth + 1);
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        // Labels and names carry the identity; the numbers and the status words do not.
        if (['status', 'type', 'kind', 'period', 'participation', 'cardinality', 'v'].includes(k)) continue;
        walk(v, depth + 1);
      }
    }
  };
  walk(spec, 0);
  const k = String(spec.kind ?? '').toLowerCase();
  const view = kind === 'chart' ? 'chart' : k === 'automaton' || k === 'dfa' || k === 'nfa' ? 'automaton' : 'chen';
  return { ok: true, view, words: [...words] };
}
