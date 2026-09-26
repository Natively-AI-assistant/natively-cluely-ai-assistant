// scripts/intent-benchmark/lib/metrics.mjs
//
// Scoring for the router benchmark. Pure functions, no I/O.
//
// These decide which model ships, so the edge cases matter more than the happy
// path. Three of them bite hard on this dataset in particular:
//
//   1. A label with ZERO support. `follow_up` fires on 0.2% of production
//      turns. On a 300-row held-out split it may be absent entirely. F1 is 0/0
//      there, and the convention you pick changes macro F1 by several points.
//      This module EXCLUDES zero-support labels from the macro average and
//      reports how many it excluded, rather than scoring them as 0 (which
//      punishes a model for a label nobody asked about) or as 1 (which is
//      free credit).
//
//   2. Macro vs micro. The brief's bar is macro F1, which weights every class
//      equally regardless of frequency. That is the right choice for a router
//      whose rare classes matter, and it means a model can score well on
//      accuracy and fail the bar.
//
//   3. Calibration. ECE is only meaningful if confidences are real. Seven of
//      the ten legacy regex rules return a HARDCODED confidence, so the control
//      model's ECE measures a constant, not a belief. Reported anyway, flagged
//      in the report.

// ---------------------------------------------------------------------------
// confusion + per-label PRF
// ---------------------------------------------------------------------------

/** Build a confusion matrix as a nested Map: actual -> predicted -> count. */
export function confusionMatrix(pairs) {
  const m = new Map();
  for (const { actual, predicted } of pairs) {
    if (!m.has(actual)) m.set(actual, new Map());
    const row = m.get(actual);
    row.set(predicted, (row.get(predicted) ?? 0) + 1);
  }
  return m;
}

/**
 * Per-label precision, recall, F1 and support.
 *
 * `support` is the number of times the label appears as the ACTUAL value. A
 * label predicted but never actual has support 0 and is a pure false-positive
 * source; it still gets a row so the report can show it.
 */
export function perLabelScores(pairs, labels = null) {
  const universe = labels
    ? [...labels]
    : [...new Set(pairs.flatMap((p) => [p.actual, p.predicted]))].sort();

  const out = {};
  for (const label of universe) {
    let tp = 0, fp = 0, fn = 0, support = 0;
    for (const { actual, predicted } of pairs) {
      if (actual === label) support++;
      if (predicted === label && actual === label) tp++;
      else if (predicted === label && actual !== label) fp++;
      else if (predicted !== label && actual === label) fn++;
    }
    const precision = tp + fp === 0 ? null : tp / (tp + fp);
    const recall = tp + fn === 0 ? null : tp / (tp + fn);
    const f1 = precision === null || recall === null || precision + recall === 0
      ? (tp === 0 && fp === 0 && fn === 0 ? null : 0)
      : (2 * precision * recall) / (precision + recall);
    out[label] = { precision, recall, f1, support, tp, fp, fn };
  }
  return out;
}

/**
 * Macro F1 over labels WITH SUPPORT.
 *
 * Zero-support labels are excluded rather than scored 0. Scoring them 0 would
 * mean a held-out split that happens to omit `follow_up` silently drags every
 * candidate's macro F1 down by 1/8, and would reward a corpus that quietly
 * dropped hard labels. The count of excluded labels is returned so the report
 * can say the average is over 7 of 8 classes rather than pretending otherwise.
 */
/**
 * Support below which a per-label F1 is not a measurement.
 *
 * Macro F1 averages every class equally, so a class with a handful of held-out
 * rows moves the headline as much as one with four hundred, while its own F1 is
 * mostly sampling noise. dialogue_act carries `interruption` at 6 held-out rows
 * against `ask`'s 407: that one class caps the axis near 80 however good the
 * model is, and a reader comparing the number to a 0.80 bar cannot see why.
 *
 * Fifteen is the smallest support at which one misclassification moves F1 by
 * less than about ten points, so below it the per-class score says more about
 * which rows landed in the split than about the model.
 */
export const MIN_LABEL_SUPPORT = 15;

export function macroF1(pairs, labels = null) {
  const per = perLabelScores(pairs, labels);
  const scored = Object.entries(per).filter(([, s]) => s.support > 0);
  const excluded = Object.entries(per).filter(([, s]) => s.support === 0).map(([l]) => l);
  if (scored.length === 0) return { macroF1: null, labelsScored: 0, excludedLabels: excluded };
  const sum = scored.reduce((a, [, s]) => a + (s.f1 ?? 0), 0);

  // The same average over adequately supported classes only. Reported ALONGSIDE
  // the headline, never instead of it: dropping a thin class is a way of making
  // a number look better, so both travel together and the thin ones are named.
  const wellSupported = scored.filter(([, s]) => s.support >= MIN_LABEL_SUPPORT);
  const thin = scored.filter(([, s]) => s.support < MIN_LABEL_SUPPORT)
    .map(([l, s]) => ({ label: l, support: s.support, f1: s.f1 }));

  return {
    macroF1: sum / scored.length,
    labelsScored: scored.length,
    excludedLabels: excluded,
    macroF1WellSupported: wellSupported.length
      ? wellSupported.reduce((a, [, s]) => a + (s.f1 ?? 0), 0) / wellSupported.length
      : null,
    labelsWellSupported: wellSupported.length,
    thinLabels: thin,
    perLabel: per,
  };
}

export function accuracy(pairs) {
  if (pairs.length === 0) return null;
  return pairs.filter((p) => p.actual === p.predicted).length / pairs.length;
}

// ---------------------------------------------------------------------------
// calibration
// ---------------------------------------------------------------------------

/**
 * Expected Calibration Error over equal-width bins.
 *
 * Returns `{ ece, bins, degenerate }`. `degenerate` is true when every
 * confidence is the same value, which is the case for the regex control: it
 * returns hardcoded 0.95/0.9/0.85. ECE is still computable there and still
 * meaningless, so the flag travels with the number.
 */
export function expectedCalibrationError(items, binCount = 10) {
  const usable = items.filter((i) => typeof i.confidence === 'number' && Number.isFinite(i.confidence));
  if (usable.length === 0) return { ece: null, bins: [], degenerate: false, n: 0 };

  const bins = Array.from({ length: binCount }, (_, i) => ({
    lo: i / binCount, hi: (i + 1) / binCount, n: 0, correct: 0, confSum: 0,
  }));

  for (const it of usable) {
    const c = Math.min(0.999999, Math.max(0, it.confidence));
    const idx = Math.min(binCount - 1, Math.floor(c * binCount));
    const b = bins[idx];
    b.n++;
    b.confSum += c;
    if (it.correct) b.correct++;
  }

  let ece = 0;
  for (const b of bins) {
    if (b.n === 0) continue;
    const acc = b.correct / b.n;
    const conf = b.confSum / b.n;
    ece += (b.n / usable.length) * Math.abs(acc - conf);
    b.accuracy = acc;
    b.avgConfidence = conf;
  }

  const distinct = new Set(usable.map((i) => i.confidence.toFixed(6)));
  return { ece, bins: bins.filter((b) => b.n > 0), degenerate: distinct.size <= 1, n: usable.length };
}

// ---------------------------------------------------------------------------
// multi-intent
// ---------------------------------------------------------------------------

/**
 * Secondary-task recall: of the secondary tasks that were actually present, how
 * many did the candidate find. Rows with no secondary tasks are EXCLUDED from
 * the denominator rather than counted as perfect, because a model that never
 * predicts a secondary task would otherwise score near 1.0 on a corpus where
 * 92% of rows have none.
 */
export function secondaryTaskRecall(pairs) {
  let found = 0, expected = 0, rowsWithAny = 0;
  for (const { actual, predicted } of pairs) {
    const a = new Set(actual ?? []);
    if (a.size === 0) continue;
    rowsWithAny++;
    const p = new Set(predicted ?? []);
    for (const t of a) { expected++; if (p.has(t)) found++; }
  }
  return { recall: expected === 0 ? null : found / expected, expected, found, rowsWithAny };
}

// ---------------------------------------------------------------------------
// latency
// ---------------------------------------------------------------------------

/** Percentile over a numeric array. Nearest-rank, so p50 of [1,2] is 2. */
export function percentile(values, p) {
  const v = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const rank = Math.ceil((p / 100) * v.length);
  return v[Math.min(v.length - 1, Math.max(0, rank - 1))];
}

export function latencyStats(samples) {
  return {
    n: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    mean: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null,
    max: samples.length ? Math.max(...samples) : null,
  };
}

// ---------------------------------------------------------------------------
// weighted reporting
// ---------------------------------------------------------------------------

/**
 * Re-weight per-row results to a target label distribution.
 *
 * The corpus is generated BALANCED so every class is learnable and measurable.
 * Production is not balanced: `general` is 37.5% of real turns and `follow_up`
 * is 0.2%. Both views are wanted, and the honest way to have both is to score
 * once and re-weight, rather than build two corpora.
 *
 * Weights are per ACTUAL label, normalised, and applied to the accuracy
 * numerator. A label present in the corpus but absent from `targetShares` gets
 * weight 0 and is reported as excluded.
 */
export function weightedAccuracy(pairs, targetShares) {
  const byLabel = new Map();
  for (const p of pairs) {
    if (!byLabel.has(p.actual)) byLabel.set(p.actual, { n: 0, correct: 0 });
    const b = byLabel.get(p.actual);
    b.n++;
    if (p.actual === p.predicted) b.correct++;
  }
  let weightSum = 0, acc = 0;
  const missing = [];
  for (const [label, b] of byLabel) {
    const w = targetShares[label];
    if (w == null) { missing.push(label); continue; }
    weightSum += w;
    acc += w * (b.correct / b.n);
  }
  return {
    weightedAccuracy: weightSum === 0 ? null : acc / weightSum,
    labelsWeighted: byLabel.size - missing.length,
    missingFromWeights: missing,
  };
}
