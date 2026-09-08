// electron/llm/performance/estimators.ts
//
// The statistics behind the profile. Pure functions, no state, no I/O.
//
// Every estimator here answers one question: given what we have seen, what
// number should a deadline be sized from? The recurring wrong answer in this
// area is "the mean" — liveDeadlines.ts documents the resulting defect twice
// (a ceiling 1.4s above an 11.6s observed tail killed 21% of one user's turns).
// So the primary estimator is a DECAYING MAXIMUM, and the median exists only
// for display and for the context fit.

import type { LatencyEstimate, StreamGapEstimate, ContextScalingModel } from './types';

/**
 * Decay applied to the stored maximum on each new sample.
 *
 * 0.9 — inherited verbatim from LLMHelper.recordAnswerFirstToken, whose comment
 * sizes it: "lets one freak sample age out over ~10 healthy turns instead of
 * pinning the budget for the session". Changing it here would silently change
 * the behaviour of the user-endpoint budget that already ships, so it does not
 * change.
 */
export const MAX_DECAY = 0.9;

/**
 * Weight of a new sample in the rolling median approximation.
 *
 * A true streaming median needs the sample history; we keep O(1) state, so this
 * is a frugal approximation — nudge the estimate toward the sample by a fixed
 * fraction of the current spread. It converges to the median rather than the
 * mean because the step size does not scale with the residual, so a single huge
 * outlier moves it by one step instead of dragging it. Nothing sizes a deadline
 * off this, which is why an approximation is acceptable here and would not be
 * for maxMs.
 */
export const P50_STEP = 0.12;

export function emptyLatency(): LatencyEstimate {
  return { maxMs: 0, p50Ms: 0, count: 0, samplesMs: [] };
}

export function emptyGaps(): StreamGapEstimate {
  return { maxGapMs: 0, p50GapMs: 0, count: 0 };
}

/**
 * Fold one admissible latency sample into an estimate.
 *
 * Returns a NEW object — profiles are treated as immutable so a half-applied
 * update can never be persisted.
 */
export function foldLatency(prev: LatencyEstimate | undefined, ms: number): LatencyEstimate {
  if (!Number.isFinite(ms) || ms < 0) return prev ?? emptyLatency();
  if (!prev || prev.count <= 0) {
    return { maxMs: Math.round(ms), p50Ms: Math.round(ms), count: 1, samplesMs: pushSample([], ms) };
  }
  // Rounded for the same reason the original does it: this feeds a setTimeout
  // and a log line, and a decaying float grows an unreadable fractional tail.
  const maxMs = Math.round(Math.max(ms, prev.maxMs * MAX_DECAY));
  const spread = Math.max(1, Math.abs(ms - prev.p50Ms));
  const nudged = Math.round(prev.p50Ms + Math.sign(ms - prev.p50Ms) * spread * P50_STEP);
  // CLAMPED TO THE MAX. Caught on real traffic: six live turns produced
  // `p50=1797ms` against `max=1477ms`, which is incoherent — a median cannot
  // exceed a maximum. The two estimators move on different clocks (the max
  // DECAYS by MAX_DECAY on every sample, the median only steps toward the
  // newest one), so a decaying max can slide underneath a median that has not
  // caught up. Clamping keeps the pair readable; the max stays authoritative
  // because it is the one a deadline is sized from.
  const p50Ms = Math.min(nudged, maxMs);
  return { maxMs, p50Ms, count: prev.count + 1, samplesMs: pushSample(prev.samplesMs, ms) };
}

/** The same fold for inter-chunk gaps on a stream that completed healthily. */
export function foldGaps(
  prev: StreamGapEstimate | undefined,
  maxGapMs: number,
  p50GapMs: number,
): StreamGapEstimate {
  if (!Number.isFinite(maxGapMs) || maxGapMs < 0) return prev ?? emptyGaps();
  const p50In = Number.isFinite(p50GapMs) && p50GapMs >= 0 ? p50GapMs : maxGapMs;
  if (!prev || prev.count <= 0) {
    return { maxGapMs: Math.round(maxGapMs), p50GapMs: Math.round(p50In), count: 1 };
  }
  const decayed = Math.round(Math.max(maxGapMs, prev.maxGapMs * MAX_DECAY));
  const spread = Math.max(1, Math.abs(p50In - prev.p50GapMs));
  const p50 = Math.round(prev.p50GapMs + Math.sign(p50In - prev.p50GapMs) * spread * P50_STEP);
  return { maxGapMs: decayed, p50GapMs: p50, count: prev.count + 1 };
}

/**
 * Running mean, used only for a workload bucket's mean input size.
 *
 * A mean is right here and wrong for latency, and the difference is worth
 * stating: this number is an X-COORDINATE for the context fit — "roughly how
 * big were the requests in this bucket" — not a budget anything must clear.
 */
export function foldMean(prevMean: number, prevCount: number, sample: number): number {
  if (!Number.isFinite(sample) || sample < 0) return prevMean;
  if (prevCount <= 0) return Math.round(sample);
  return Math.round(prevMean + (sample - prevMean) / (prevCount + 1));
}

/**
 * Ordinary least squares of ttft against input size, in thousands of tokens.
 *
 * Phase 14 asks for "the simplest model that performs well on actual data" and
 * warns against assuming linearity. Three bucket means cannot distinguish a line
 * from a log curve, so fitting a curve would be picking a shape we have no
 * evidence for. A line, plus its RMSE, is the honest artifact: the error is what
 * downstream uses to decide whether the projection may move anything.
 *
 * Returns null with fewer than two DISTINCT x values — a fit through one point
 * is not a fit, and two points at the same x is one point.
 */
export function fitContextScaling(
  points: Array<{ inputTokens: number; ttftMs: number }>,
): ContextScalingModel | null {
  const usable = points.filter(
    (p) => Number.isFinite(p.inputTokens) && p.inputTokens > 0 && Number.isFinite(p.ttftMs) && p.ttftMs > 0,
  );
  const xs = usable.map((p) => p.inputTokens / 1000);
  const ys = usable.map((p) => p.ttftMs);
  const distinctX = new Set(xs.map((x) => Math.round(x * 100)));
  if (usable.length < 2 || distinctX.size < 2) return null;

  const n = usable.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;

  let sse = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * xs[i];
    sse += (ys[i] - predicted) ** 2;
  }
  const rmse = Math.sqrt(sse / n);

  return {
    interceptMs: Math.round(intercept),
    // A NEGATIVE slope means bigger requests measured faster, which is noise,
    // not a discovered efficiency. Clamp at zero so a projection can never
    // predict that a 100K request beats a 4K one.
    slopeMsPerKToken: Math.round(Math.max(0, slope)),
    rmseMs: Math.round(rmse),
    points: distinctX.size,
  };
}

/**
 * Predicted TTFT at a given input size, with the fit's own error attached.
 *
 * The caller decides what to do with `rmseMs`; this function does not hide a
 * bad fit behind a confident-looking number.
 */
export function projectTtft(
  model: ContextScalingModel | null,
  inputTokens: number,
): { ttftMs: number; rmseMs: number } | null {
  if (!model || !Number.isFinite(inputTokens) || inputTokens < 0) return null;
  const ttftMs = Math.round(model.interceptMs + model.slopeMsPerKToken * (inputTokens / 1000));
  return { ttftMs: Math.max(0, ttftMs), rmseMs: model.rmseMs };
}

/**
 * Asymmetric adaptation between an old value and a new observation.
 *
 * Phase 16. Degradation must be adopted fast and improvement slowly, and the
 * reason is not symmetry-breaking for its own sake: WIDENING a deadline costs a
 * healthy turn nothing (the ceiling only fires when a provider is slow), while
 * NARROWING can cut off a turn that was about to succeed. liveDeadlines.ts
 * already reaches the same conclusion by a different route — it widens from the
 * first sample and requires five before narrowing.
 *
 * `alphaUp` >> `alphaDown` by default, and `alphaDown` is additionally gated by
 * the caller's sample count.
 */
export function adaptAsymmetric(
  current: number,
  observed: number,
  opts: { alphaUp?: number; alphaDown?: number } = {},
): number {
  const alphaUp = opts.alphaUp ?? 0.7;
  const alphaDown = opts.alphaDown ?? 0.15;
  if (!Number.isFinite(observed)) return current;
  if (!Number.isFinite(current) || current <= 0) return Math.round(observed);
  const alpha = observed > current ? alphaUp : alphaDown;
  return Math.round(current + alpha * (observed - current));
}

/** Clamp with explicit, named bounds so a caller cannot silently invert them. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (min > max) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Max and median of a list of inter-chunk gaps.
 *
 * A real median here, not the streaming approximation: the caller has the whole
 * (short) list of gaps for one stream in hand, so there is no reason to
 * approximate at the point where the data is complete.
 */
export function summarizeGaps(gaps: number[]): { maxGapMs: number; p50GapMs: number } | null {
  const clean = gaps.filter((g) => Number.isFinite(g) && g >= 0);
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const p50 = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { maxGapMs: Math.round(sorted[sorted.length - 1]), p50GapMs: Math.round(p50) };
}

// ─── true quantiles (Phase 7) ─────────────────────────────────────────────
//
// The decaying max above is what SIZES a deadline, and it stays that way. This
// is the other half of Phase 7: "once enough real production observations
// exist, compute actual quantiles."
//
// A real quantile needs the samples, so we keep a bounded reservoir. The length
// is not arbitrary — the confidence tiers promise quantile statistics at 50+
// samples, and a reservoir shorter than that could never produce the p95 it
// exists for. 64 is the smallest round number above that promise.

/**
 * Retained samples per workload.
 *
 * Sized against the confidence ladder (50+ = "reliable quantile statistics"),
 * not against a storage budget — a reservoir of 32 would make the p95 this
 * exists to compute a lie at exactly the sample count that unlocks it.
 */
export const RESERVOIR_SIZE = 64;

/**
 * Append one sample, keeping the most recent RESERVOIR_SIZE.
 *
 * MOST RECENT, not a random reservoir sample. A uniform reservoir describes the
 * whole history equally, which is wrong for a provider whose infrastructure
 * changed last week — the same reason the estimators decay rather than average.
 * Values are rounded integers so the persisted array stays compact.
 */
export function pushSample(reservoir: number[] | undefined, ms: number): number[] {
  if (!Number.isFinite(ms) || ms < 0) return reservoir ?? [];
  const next = [...(reservoir ?? []), Math.round(ms)];
  return next.length > RESERVOIR_SIZE ? next.slice(next.length - RESERVOIR_SIZE) : next;
}

/**
 * A real quantile over the reservoir, or null when there is not enough data to
 * claim one.
 *
 * `minSamples` is the honesty gate. Phase 7 says plainly: "Do not claim a real
 * P95 with n=5." Returning null there — rather than the max, which is what a
 * naive implementation returns for p95 at small n — is what stops a diagnostics
 * surface printing a confident number derived from four measurements.
 */
export function quantile(reservoir: number[] | undefined, q: number, minSamples: number): number | null {
  if (!reservoir || reservoir.length < minSamples) return null;
  if (!(q > 0 && q < 1)) return null;
  const sorted = [...reservoir].sort((a, b) => a - b);
  // Linear interpolation between order statistics (the "R-7" convention, which
  // is what numpy and most spreadsheets do), so p95 of 64 samples is not simply
  // "the 61st value".
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return Math.round(sorted[lo]);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

/**
 * Tokens per second, measured over the GENERATION window only.
 *
 * `outputTokens / totalMs` is the tempting form and it is wrong: totalMs
 * includes prefill, so the rate lands systematically low, and it lands lowest
 * for exactly the providers with the slowest prefill — the ones a rate estimate
 * is most needed for. The correct denominator is `totalMs - ttftMs`.
 *
 * Returns null rather than Infinity when the window is non-positive (a
 * single-chunk stream, where first token and last token are the same event).
 */
export function generationRateTps(opts: {
  estimatedOutputTokens: number;
  ttftMs: number | null;
  totalMs: number;
}): number | null {
  const { estimatedOutputTokens, ttftMs, totalMs } = opts;
  if (ttftMs == null || !Number.isFinite(totalMs) || estimatedOutputTokens <= 0) return null;
  const windowMs = totalMs - ttftMs;
  if (windowMs <= 0) return null;
  const tps = (estimatedOutputTokens * 1000) / windowMs;
  return Number.isFinite(tps) && tps > 0 ? Math.round(tps * 10) / 10 : null;
}
