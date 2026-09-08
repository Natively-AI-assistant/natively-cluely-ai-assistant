// electron/llm/performance/deadlines.ts
//
// The selectors that turn profile evidence into a deadline.
//
// DIRECTION OF DEPENDENCY, deliberately: this module imports liveDeadlines.ts,
// never the reverse. liveDeadlines.ts imports exactly one type today and is
// consumed by the benchmark runners, which run outside Electron; making it
// depend on a persisted store would drag fs and the Electron app into every one
// of those. So the shipped route table stays where it is and stays pure, and
// the adaptive layer sits above it as a set of functions that take a profile as
// an argument.
//
// WHAT THIS LAYER MAY AND MAY NOT DO. It may only ever move a value INSIDE the
// range the shipped route table already considers sane (ROUTE_TTFT_BOUNDS), and
// on routes the table says are adaptive at all (TTFT_ADAPTIVE_ROUTES). With no
// evidence, every function here returns exactly what ships today — that is
// Phase 0 rule 20, enforced by construction rather than by care.

import { LIVE_INTER_TOKEN_STALL_MS, totalHardTimeoutMs } from '../liveDeadlines';
import { clamp } from './estimators';
import { projectTtft } from './estimators';
import {
  ROUTE_STREAM_IDLE_PRIOR_MS,
  ROUTE_TTFT_BOUNDS,
  STREAM_IDLE_GAP_MULTIPLIER,
  STREAM_IDLE_MAX_MS,
  STREAM_IDLE_MIN_MS,
  STREAM_IDLE_MIN_SAMPLES_TO_NARROW,
  STREAM_IDLE_ADAPTIVE_ROUTES,
  TTFT_ADAPTIVE_ROUTES,
} from './priors';
import { quantile } from './estimators';
import {
  confidenceFor,
  type ProviderPerformanceProfile,
  type RouteKind,
  type Urgency,
  type WorkloadClass,
} from './types';

/** Where a deadline's value came from. Carried into diagnostics verbatim. */
export type DeadlineSource = 'shipped_prior' | 'profile' | 'clamped_floor' | 'clamped_ceiling';

export interface DeadlineDecision {
  valueMs: number;
  source: DeadlineSource;
  /** What the evidence alone would have said, before clamping. Null with none. */
  rawMs: number | null;
  sampleCount: number;
  confidence: ReturnType<typeof confidenceFor>;
}

/**
 * The stream-idle (inter-token stall) bound.
 *
 * THE ONE MAJOR DEADLINE WITH NO ADAPTATION TODAY. Every call site passes the
 * bare `LIVE_INTER_TOKEN_STALL_MS = 8000`. It is also the safest one to make
 * adaptive first, and the asymmetry is worth being explicit about: when a TTFT
 * deadline fires the turn is DISCARDED and replaced with a canned line, but when
 * the stall guard fires the partial answer is KEPT (see raceStreamWithDeadline's
 * 'stall_timeout' branch, and LiveDeadlines.test.mjs's "keeps partial"). So a
 * stall guard set slightly too tight costs the tail of one answer; a TTFT
 * deadline set slightly too tight costs the whole answer. That is why this knob
 * moves and the others mostly do not.
 *
 * Derivation: 3x the decayed worst gap observed on streams that COMPLETED,
 * clamped to [2500, 8000], and never allowed to narrow below the prior until 5
 * healthy streams have been seen.
 */
export function streamIdleTimeoutMs(
  route: RouteKind,
  profile: ProviderPerformanceProfile | null,
): DeadlineDecision {
  const prior = ROUTE_STREAM_IDLE_PRIOR_MS[route] ?? LIVE_INTER_TOKEN_STALL_MS;
  const gaps = profile?.stream;
  const confidence = confidenceFor(gaps?.count ?? 0);

  // A local model competes for the machine's own CPU/GPU/memory, so a multi-second
  // mid-generation pause can be thermal throttling rather than a dead stream.
  // Same reasoning that gives local a 30s TTFT ceiling rather than 8s.
  if (!STREAM_IDLE_ADAPTIVE_ROUTES.has(route)) {
    return { valueMs: prior, source: 'shipped_prior', rawMs: null, sampleCount: gaps?.count ?? 0, confidence };
  }

  if (!gaps || gaps.count <= 0 || !Number.isFinite(gaps.maxGapMs) || gaps.maxGapMs <= 0) {
    return { valueMs: prior, source: 'shipped_prior', rawMs: null, sampleCount: 0, confidence };
  }

  const raw = Math.round(gaps.maxGapMs * STREAM_IDLE_GAP_MULTIPLIER);

  // Widening is free — the guard only fires on a stream that has already gone
  // quiet — so it applies from the first healthy sample, exactly as
  // userEndpointBudgetMs widens from the first. Narrowing needs evidence.
  if (raw <= prior && gaps.count < STREAM_IDLE_MIN_SAMPLES_TO_NARROW) {
    return { valueMs: prior, source: 'shipped_prior', rawMs: raw, sampleCount: gaps.count, confidence };
  }

  const clamped = clamp(raw, STREAM_IDLE_MIN_MS, STREAM_IDLE_MAX_MS);
  const source: DeadlineSource = clamped === raw
    ? 'profile'
    : clamped === STREAM_IDLE_MIN_MS ? 'clamped_floor' : 'clamped_ceiling';
  return { valueMs: clamped, source, rawMs: raw, sampleCount: gaps.count, confidence };
}

export interface TtftContext {
  route: RouteKind;
  workload: WorkloadClass;
  /** Whatever the shipped route table already decided for this turn. */
  shippedMs: number;
}

/**
 * The first-token ceiling, adjusted by evidence where the route table permits.
 *
 * For every route except `user_endpoint` this returns the shipped value
 * unchanged, and that is the correct answer rather than a cautious one: those
 * numbers are derived from a mechanism we can read (a cold weight load, an image
 * prefill, natively-api's own 10s cutover, a direct call with nothing behind it
 * to rescue it), not guessed at, so there is nothing for measurement to correct.
 * Narrowing `server_cascade` in particular would re-create F-301 — the client
 * abandoning a turn 2s before the server rotates.
 */
export function adaptiveTtftCeilingMs(
  ctx: TtftContext,
  profile: ProviderPerformanceProfile | null,
): DeadlineDecision {
  const bounds = ROUTE_TTFT_BOUNDS[ctx.route];
  const workload = profile?.workloads?.[ctx.workload];
  const count = workload?.ttft.count ?? 0;
  const confidence = confidenceFor(count);

  if (!TTFT_ADAPTIVE_ROUTES.has(ctx.route) || !workload || count <= 0) {
    return { valueMs: ctx.shippedMs, source: 'shipped_prior', rawMs: null, sampleCount: count, confidence };
  }

  // The margin is the one liveDeadlines already sized and justified: 5s over the
  // slowest first token actually observed, because a ceiling 1.4s above an
  // 11.6s observed tail killed 21% of one real user's turns. Reused rather than
  // re-derived so the two cannot drift.
  const raw = workload.ttft.maxMs + 5_000;
  const clamped = clamp(raw, bounds.min, bounds.max);

  // THIS FILTER MAY ONLY WIDEN. `shippedMs` on the one adaptive route is not a
  // constant — it is already `userEndpointBudgetMs(observedAnswerLatency())`,
  // computed from LLMHelper's session map. So two populations now answer the
  // same question, and they are not the same population: the session map is
  // route-wide, this profile is per-workload and per-network.
  //
  // Letting the profile win outright is the "second latency statistic for one
  // provider" this codebase names as its recurring mistake, and it has a
  // concrete failure: a user with twenty fast 4K turns and one 11.6s 32K turn
  // would have their NEXT large turn sized from the small bucket — narrower
  // than the session map's answer, on exactly the turn shape that produced the
  // 21%-death defect.
  //
  // Widening past the session map is new information (this network, this
  // workload, and it survived a restart). Narrowing below it is discarding
  // evidence the session map holds and this profile does not. The asymmetry
  // this whole area is built on says which of those is safe, and the cost of
  // refusing to narrow is small: a shorter ceiling saves a few seconds on a
  // turn that was going to fail, while a too-short one loses an answer.
  const widened = Math.max(clamped, ctx.shippedMs);
  if (widened === ctx.shippedMs && clamped < ctx.shippedMs) {
    return { valueMs: ctx.shippedMs, source: 'clamped_floor', rawMs: raw, sampleCount: count, confidence };
  }
  const source: DeadlineSource = widened === raw
    ? 'profile'
    : widened === bounds.max ? 'clamped_ceiling' : 'clamped_floor';
  return { valueMs: widened, source, rawMs: raw, sampleCount: count, confidence };
}

/**
 * The shipped ceiling for a turn, unchanged — re-exported so a caller can get
 * both halves from one module rather than importing two.
 */
export const shippedTotalHardTimeoutMs = totalHardTimeoutMs;

// ─── large-context projection (Phase 14) ──────────────────────────────────

export interface LargeContextProjection {
  predictedTtftMs: number;
  /** The fit's RMSE. A projection with error comparable to its own value is noise. */
  rmseMs: number;
  /** True when the projection is precise enough to act on. */
  actionable: boolean;
  /** Input size the projection was made for. */
  inputTokens: number;
}

/**
 * Predict this provider's first-token latency at an input size we have not
 * measured — the alternative to firing five 100K-token requests at onboarding.
 *
 * `actionable` is the load-bearing field. A straight-line fit through three
 * bucket means is a weak instrument, and reporting its output as a number
 * without its error is precisely the "misleading precision" Phase 20 rules out.
 * The threshold is RMSE < half the prediction: below that the line explains more
 * than it invents, above it the honest answer is "we do not know yet".
 */
export function projectLargeContext(
  profile: ProviderPerformanceProfile | null,
  inputTokens: number,
): LargeContextProjection | null {
  const projected = projectTtft(profile?.contextScaling ?? null, inputTokens);
  if (!projected) return null;
  return {
    predictedTtftMs: projected.ttftMs,
    rmseMs: projected.rmseMs,
    actionable: projected.ttftMs > 0 && projected.rmseMs < projected.ttftMs * 0.5,
    inputTokens,
  };
}

// ─── user-facing grading (Phase 20) ───────────────────────────────────────

export type PerformanceGrade = 'fast' | 'good' | 'moderate' | 'slow' | 'unreliable' | 'unknown';

/**
 * A word, not a number.
 *
 * Phase 20 asks for "Fast / Good / Moderate / Slow / Unreliable" and explicitly
 * rules out surfacing "P95 = 83.274 seconds". The bands are cut against what
 * this product is: a live assistant where a 2s answer feels instant and a 10s
 * answer has already lost the moment. They are NOT general latency bands.
 *
 * Reliability outranks latency: a provider that answers in 900ms and fails a
 * fifth of the time is not "fast", it is unreliable, and calling it fast would
 * be the most misleading thing this function could say.
 */
export function performanceGrade(profile: ProviderPerformanceProfile | null): PerformanceGrade {
  if (!profile || profile.sampleCount <= 0) return 'unknown';

  let ok = 0;
  let bad = 0;
  for (const w of Object.values(profile.workloads)) {
    if (!w) continue;
    const r = w.reliability;
    ok += r.ok;
    bad += r.timeout + r.stall + r.serverError + r.connectionFailure + r.rateLimit;
  }
  const attempts = ok + bad;
  if (attempts >= 10 && bad / attempts > 0.15) return 'unreliable';

  // Grade on the SMALL workload: it is the one every user exercises, and mixing
  // a 32K analysis turn into the headline number would make a healthy provider
  // look slow because the user asked it something big.
  const small = profile.workloads.small ?? profile.workloads.medium;
  if (!small || small.ttft.count <= 0) return 'unknown';
  const ttft = small.ttft.p50Ms > 0 ? small.ttft.p50Ms : small.ttft.maxMs;
  if (ttft < 1_200) return 'fast';
  if (ttft < 2_500) return 'good';
  if (ttft < 5_000) return 'moderate';
  return 'slow';
}

// ─── diagnostics (Phase 27) ───────────────────────────────────────────────
//
// There is deliberately NO diagnostics record type here. `PerformanceTurnRecord`
// in wiring.ts is the one that actually fires on every turn, and a second record
// answering the same question is the duplication this codebase warns about
// repeatedly — two structures describing one turn is how two surfaces come to
// disagree about it. If a richer record is ever needed, widen that one.

// ─── total-request ceiling, and the "too slow to be useful" signal ────────

/**
 * How long an answer of `expectedOutputTokens` should take END TO END on this
 * provider, given what we have measured.
 *
 * ADVISORY ONLY. This value is deliberately NOT handed to the deadline driver,
 * and that restraint is the most important thing about it. Everything else this
 * layer produces either widens a budget or is clamped at today's constant; a
 * total-request ceiling is the first derived number that could terminate a
 * stream mid-answer that would otherwise have completed. The inputs are an
 * estimated generation rate and a GUESSED output length, and the codebase
 * already documents legitimately long answers — a six-section coding answer at
 * ~8000 chars (CODING_REGEN_ABORT_CHARS), a meeting summary up to 120000
 * (MAX_SUMMARY_OUTPUT_CHARS). Enforcing a ceiling built on two estimates against
 * those would re-create exactly what LIVE_INTER_TOKEN_STALL_MS promises never to
 * do: truncate a healthy long answer mid-sentence.
 *
 * So it feeds diagnostics and {@link workloadTooSlowFor}, which changes what
 * Natively SENDS rather than when it gives up. The stall guard remains the only
 * thing that ends a stream that is still producing.
 */
export function projectTotalDurationMs(
  profile: ProviderPerformanceProfile | null,
  workload: WorkloadClass,
  expectedOutputTokens: number,
): { totalMs: number; ttftMs: number; generationMs: number } | null {
  const w = profile?.workloads?.[workload];
  if (!w || w.ttft.count <= 0) return null;
  const rate = w.generationRate;
  if (!rate || rate.tokensPerSecond <= 0) return null;
  const ttftMs = w.ttft.maxMs;
  const generationMs = Math.round((expectedOutputTokens / rate.tokensPerSecond) * 1000);
  return { ttftMs, generationMs, totalMs: ttftMs + generationMs };
}

/**
 * The wall-clock past which an answer has stopped being useful, by urgency.
 *
 * These are not latency opinions, they are transcriptions of what this codebase
 * already enforces. `live` is the "never make the user wait 10s+" contract that
 * opens liveDeadlines.ts. `interactive` is the vision ceiling — the longest any
 * single user-facing attempt is currently allowed to run. `background` is
 * effectively unbounded because a meeting summary legitimately takes minutes.
 */
export const USEFUL_BY_MS: Record<Urgency, number> = {
  live: 10_000,
  interactive: 20_000,
  background: Number.POSITIVE_INFINITY,
};

/**
 * "This workload is likely to be too slow" — the signal Phase 18 asks the
 * profile to be able to raise.
 *
 * It answers a question about USEFULNESS, not about failure: a 30-second answer
 * on a live meeting turn will very likely succeed, and will still be worthless.
 * That is the distinction Phase 12 makes ("Timeout is not success"), and it is
 * why this is separate from every deadline above.
 *
 * Returns null when we cannot tell — no profile, no measured generation rate,
 * or a background workload where nothing is too slow.
 */
export function workloadTooSlowFor(opts: {
  profile: ProviderPerformanceProfile | null;
  workload: WorkloadClass;
  urgency: Urgency;
  expectedOutputTokens: number;
}): { predictedMs: number; budgetMs: number; overBy: number } | null {
  const budgetMs = USEFUL_BY_MS[opts.urgency];
  if (!Number.isFinite(budgetMs)) return null;
  const projected = projectTotalDurationMs(opts.profile, opts.workload, opts.expectedOutputTokens);
  if (!projected) return null;
  if (projected.totalMs <= budgetMs) return null;
  return { predictedMs: projected.totalMs, budgetMs, overBy: projected.totalMs - budgetMs };
}

/**
 * True quantiles, once there are enough samples to claim one.
 *
 * Phase 7: "Do not claim a real P95 with n=5." The gate is the same 50 the
 * confidence ladder uses for 'high', so a p95 appears exactly when the profile
 * starts calling itself confident, and is null before that rather than silently
 * degrading to the maximum.
 */
export const MIN_SAMPLES_FOR_QUANTILE = 50;

export function ttftQuantiles(
  profile: ProviderPerformanceProfile | null,
  workload: WorkloadClass,
): { p50: number; p95: number } | null {
  const samples = profile?.workloads?.[workload]?.ttft.samplesMs;
  const p50 = quantile(samples, 0.5, MIN_SAMPLES_FOR_QUANTILE);
  const p95 = quantile(samples, 0.95, MIN_SAMPLES_FOR_QUANTILE);
  return p50 != null && p95 != null ? { p50, p95 } : null;
}
