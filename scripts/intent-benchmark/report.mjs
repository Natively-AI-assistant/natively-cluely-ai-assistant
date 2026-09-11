#!/usr/bin/env node
// scripts/intent-benchmark/report.mjs
//
// Turn a raw run result into the tables the Phase 5 decision needs, and say
// plainly what each number is over. Every table names its denominator, because
// the Phase 1 audit's own priors doc showed how easily three different ones get
// combined by a later reader.

import { macroF1, MIN_LABEL_SUPPORT, accuracy, expectedCalibrationError, secondaryTaskRecall, latencyStats, weightedAccuracy, perLabelScores } from './lib/metrics.mjs';
import { SCORED_AXES } from './providers/contract.mjs';

/** Production label shares, measured. See docs/natively-router-production-priors-2026-09.md */
export const PRODUCTION_LEGACY_SHARES = {
  general: 0.375, deep_dive: 0.215, clarification: 0.178, coding: 0.074,
  behavioral: 0.073, summary_probe: 0.047, example_request: 0.036, follow_up: 0.002,
};

export function scoreRun({ providerId, results, latencies = [], meta = {}, rowsById = null }) {
  const out = { providerId, meta, axes: {}, n: results.length };

  for (const axis of SCORED_AXES) {
    const pairs = results
      .filter((r) => r.expected?.[axis] !== undefined)
      .map((r) => ({
        actual: r.expected[axis],
        // A provider that did not resolve an axis is scored WRONG, never
        // skipped. Skipping would let a model that answers only the easy axes
        // outrank one that attempts all of them.
        predicted: r.predicted?.[axis] ?? '<unresolved>',
      }));
    if (pairs.length === 0) continue;

    const m = macroF1(pairs);
    const calItems = results
      .filter((r) => r.expected?.[axis] !== undefined)
      .map((r) => ({
        confidence: r.predicted?.confidence?.[axis],
        correct: r.expected[axis] === r.predicted?.[axis],
      }));
    const cal = expectedCalibrationError(calItems);

    out.axes[axis] = {
      n: pairs.length,
      accuracy: accuracy(pairs),
      macroF1: m.macroF1,
      labelsScored: m.labelsScored,
      excludedLabels: m.excludedLabels,
      // Carried so a low axis score can be read. A class with a handful of
      // held-out rows moves macro F1 as much as one with four hundred.
      macroF1WellSupported: m.macroF1WellSupported,
      labelsWellSupported: m.labelsWellSupported,
      thinLabels: m.thinLabels,
      perLabel: m.perLabel,
      unresolved: pairs.filter((p) => p.predicted === '<unresolved>').length,
      ece: cal.ece,
      eceDegenerate: cal.degenerate,
      eceN: cal.n,
    };
  }

  // COVERAGE, per axis. A provider that resolves few rows but is right on those
  // is a different animal from one that guesses everywhere, and accuracy alone
  // conflates them. The rules control is exactly the first kind: the brief asks
  // for it specifically as a "control for rules hit rate and false positives",
  // so hit rate and precision-when-fired are first-class outputs, not a
  // footnote. Reading its 2.9% accuracy without them would be reading the wrong
  // number entirely.
  for (const [axis, a] of Object.entries(out.axes)) {
    const fired = a.n - a.unresolved;
    a.coverage = {
      fired,
      total: a.n,
      hitRate: a.n ? fired / a.n : null,
      // Of the rows where the provider committed to an answer, how often was it
      // right. This is the number that says whether the rules are trustworthy
      // when they do fire.
      precisionWhenFired: fired ? (a.perLabel
        ? Object.entries(a.perLabel).reduce((acc, [l, s2]) => acc + (l === '<unresolved>' ? 0 : s2.tp), 0) / fired
        : null) : null,
    };
  }

  // mode_intent PER MODE, because that is what the acceptance bar specifies
  // ("macro F1 >= 0.70 on mode_intent per mode") and because a global figure is
  // meaningless here: the 78 mode_intent labels are partitioned BY MODE, so a
  // holdout of a few hundred rows leaves single-digit support per label and the
  // global macro is mostly sampling noise. Each mode is scored against its own
  // label set, and modes with too little support to be meaningful are reported
  // as such rather than given a number.
  if (rowsById) {
    const byMode = new Map();
    for (const r of results) {
      const row = rowsById.get(r.id);
      if (!row || r.expected?.mode_intent === undefined) continue;
      const key = row.custom_mode_key ?? row.mode;
      if (!byMode.has(key)) byMode.set(key, []);
      byMode.get(key).push({ actual: r.expected.mode_intent, predicted: r.predicted?.mode_intent ?? '<unresolved>' });
    }
    out.modeIntentByMode = {};
    for (const [mode, pairs] of byMode) {
      const m = macroF1(pairs);
      out.modeIntentByMode[mode] = {
        n: pairs.length,
        accuracy: accuracy(pairs),
        macroF1: m.macroF1,
        labelsScored: m.labelsScored,
        // Below roughly 10 rows per label the per-label F1 is dominated by
        // whether a single example happened to land in this split.
        underpowered: m.labelsScored > 0 && pairs.length / m.labelsScored < 10,
      };
    }
  }

  out.secondaryTasks = secondaryTaskRecall(
    results.map((r) => ({ actual: r.expected?.secondary_tasks ?? [], predicted: r.predicted?.secondary_tasks ?? [] })),
  );

  out.latency = latencyStats(latencies);

  // The legacy control axis, re-weighted to the measured production
  // distribution. Balanced accuracy says what a model CAN learn; weighted says
  // what it would do on real traffic. Both are reported; neither is "the"
  // number.
  const legacyPairs = results
    .filter((r) => r.expectedLegacyIntent)
    .map((r) => ({ actual: r.expectedLegacyIntent, predicted: r.predictedLegacyIntent ?? '<unresolved>' }));
  if (legacyPairs.length) {
    const lm = macroF1(legacyPairs);
    out.legacy = {
      n: legacyPairs.length,
      balancedAccuracy: accuracy(legacyPairs),
      macroF1: lm.macroF1,
      labelsScored: lm.labelsScored,
      excludedLabels: lm.excludedLabels,
      perLabel: perLabelScores(legacyPairs),
      productionWeighted: weightedAccuracy(legacyPairs, PRODUCTION_LEGACY_SHARES),
    };
  }

  return out;
}

/** Acceptance bar from the campaign brief, section 8. */
export const ACCEPTANCE = {
  needs_response: { macroF1: 0.85 },
  dialogue_act: { macroF1: 0.80 },
  mode_intent: { macroF1: 0.70 },
  p95Ms: 25,
  ece: 0.08,
};

export function checkAcceptance(scored) {
  const rows = [];
  const g = (axis) => scored.axes?.[axis];
  for (const [axis, req] of Object.entries(ACCEPTANCE)) {
    if (axis === 'p95Ms' || axis === 'ece') continue;
    const a = g(axis);
    rows.push({
      what: `${axis} macro F1`,
      required: req.macroF1,
      actual: a?.macroF1 ?? null,
      pass: a?.macroF1 != null && a.macroF1 >= req.macroF1,
      // Named so a reader can tell a weak model from a thin class. Never
      // replaces `actual`: this is context for the headline, not a second bar.
      thinNote: a?.thinLabels?.length
        ? (() => {
            // Named individually only while a reader can still hold the list.
            // mode_intent has 77 thin labels and printing them all buries the
            // one sentence that matters. Beyond four they are counted instead.
            const t = [...a.thinLabels].sort((x, y) => x.support - y.support);
            const shown = t.slice(0, 4).map((x) => `${x.label} (${x.support})`).join(', ');
            const rest = t.length > 4 ? `, and ${t.length - 4} more` : '';
            return `${t.length} of ${a.labelsScored} labels are under ${MIN_LABEL_SUPPORT} held-out rows `
              + `[${shown}${rest}] so their F1 is sampling noise; over the ${a.labelsWellSupported} `
              + `adequately supported labels this axis is `
              + `${a.macroF1WellSupported != null ? a.macroF1WellSupported.toFixed(3) : 'n/a'}`;
          })()
        : '',
      note: a ? `over ${a.labelsScored} labels with support${a.excludedLabels?.length ? `, ${a.excludedLabels.length} excluded for zero support` : ''}` : 'axis not scored',
    });
  }
  rows.push({
    what: 'p95 latency (ms)', required: `<= ${ACCEPTANCE.p95Ms}`, actual: scored.latency?.p95 ?? null,
    pass: scored.latency?.p95 != null && scored.latency.p95 <= ACCEPTANCE.p95Ms,
    note: 'measured inside the worker; the brief specifies the Intel Mac, which is a separate hardware cell',
  });
  const nr = g('needs_response');
  rows.push({
    what: 'ECE (needs_response)', required: `<= ${ACCEPTANCE.ece}`, actual: nr?.ece ?? null,
    pass: nr?.ece != null && nr.ece <= ACCEPTANCE.ece && !nr.eceDegenerate,
    note: nr?.eceDegenerate ? 'DEGENERATE: every confidence is the same value, so this number is not a calibration measurement' : '',
  });
  return rows;
}

export function formatReport(scored) {
  const L = [];
  const pc = (x) => (x == null ? '   n/a' : `${(x * 100).toFixed(1)}%`.padStart(6));
  L.push(`\n═══ ${scored.providerId} ═══`);
  L.push(`runtime ${scored.meta?.runtime ?? '?'}  family ${scored.meta?.family ?? '?'}  size ${scored.meta?.sizeOnDiskMB ?? '?'}MB  n=${scored.n}`);

  L.push(`\naxis                 n   acc   macroF1  labels  unresolved   ECE`);
  for (const [axis, a] of Object.entries(scored.axes)) {
    const ece = a.ece == null ? '  n/a' : a.ece.toFixed(3);
    L.push(`  ${axis.padEnd(16)} ${String(a.n).padStart(4)}  ${pc(a.accuracy)} ${pc(a.macroF1)}   ${String(a.labelsScored).padStart(2)}/${String(a.labelsScored + (a.excludedLabels?.length ?? 0)).padEnd(2)}  ${String(a.unresolved).padStart(6)}  ${ece}${a.eceDegenerate ? ' (degenerate)' : ''}`);
  }

  const anySparse = Object.values(scored.axes).some((a) => a.coverage?.hitRate != null && a.coverage.hitRate < 0.95);
  if (anySparse) {
    L.push(`\ncoverage (a provider that rarely fires is not the same as one that guesses)`);
    L.push(`axis                fired/total   hit-rate  precision-when-fired`);
    for (const [axis, a] of Object.entries(scored.axes)) {
      const c = a.coverage;
      if (!c) continue;
      L.push(`  ${axis.padEnd(16)} ${String(c.fired).padStart(4)}/${String(c.total).padEnd(5)}  ${pc(c.hitRate)}  ${pc(c.precisionWhenFired)}`);
    }
  }

  if (scored.modeIntentByMode) {
    L.push(`\nmode_intent per mode (the bar is >= 0.70 per mode, not globally)`);
    for (const [mode, m] of Object.entries(scored.modeIntentByMode)) {
      L.push(`  ${mode.padEnd(28)} n=${String(m.n).padStart(3)}  acc ${pc(m.accuracy)}  macroF1 ${pc(m.macroF1)}  over ${m.labelsScored} labels${m.underpowered ? '   UNDERPOWERED (<10 rows/label)' : ''}`);
    }
  }

  if (scored.secondaryTasks?.recall != null) {
    L.push(`\nsecondary-task recall  ${pc(scored.secondaryTasks.recall)}  over ${scored.secondaryTasks.rowsWithAny} rows that actually have one`);
  }

  const lat = scored.latency;
  if (lat?.n) L.push(`\nlatency  p50 ${lat.p50}ms  p95 ${lat.p95}ms  p99 ${lat.p99}ms  max ${lat.max}ms  n=${lat.n}`);

  if (scored.legacy) {
    L.push(`\nlegacy 8-label control  n=${scored.legacy.n}`);
    L.push(`  balanced accuracy   ${pc(scored.legacy.balancedAccuracy)}   (what the model can learn)`);
    L.push(`  macro F1            ${pc(scored.legacy.macroF1)}   over ${scored.legacy.labelsScored} labels with support`);
    L.push(`  production-weighted ${pc(scored.legacy.productionWeighted.weightedAccuracy)}   (what it would do on real traffic)`);
    if (scored.legacy.excludedLabels?.length) {
      L.push(`  excluded, zero support in this split: ${scored.legacy.excludedLabels.join(', ')}`);
    }
  }

  L.push(`\nacceptance bar`);
  for (const r of checkAcceptance(scored)) {
    const a = typeof r.actual === 'number' ? (r.what.includes('latency') ? `${r.actual}ms` : r.actual.toFixed(3)) : 'n/a';
    L.push(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.what.padEnd(22)} required ${String(r.required).padEnd(6)} actual ${a}${r.note ? `   ${r.note}` : ''}`);
    if (r.thinNote) L.push(`          ${r.thinNote}`);
  }
  return L.join('\n');
}
