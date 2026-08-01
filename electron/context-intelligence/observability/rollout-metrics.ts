// electron/context-intelligence/observability/rollout-metrics.ts
//
// Phase 10 §4 — the decision-layer signals, which did not exist.
//
// §4 lists the signals "that would have caught the failures this mission
// investigated, and none of them exist today". A rollout plan whose monitoring
// section is unimplemented cannot gate a rollout: every stage exit criterion in
// §3 and every abort condition in §5 is stated in terms of these rates, so
// without them "5% production, watch the contamination rate" is not a plan.
//
// Derived ENTIRELY from the AnswerTrace + decision that already exist — this
// module adds no new instrumentation to the answer path, it only counts what the
// trace already records. That matters for the abort conditions: a monitoring
// layer that itself touches the answer path can cause the regression it watches
// for.
//
// PRIVACY, and it is structural rather than a rule to remember: this file only
// ever reads counts, enum values, ids and durations. It has no code path that
// can hold evidence text, so §4's "telemetry must not carry private evidence
// text" cannot be violated by a future edit here without adding a field that
// obviously does not belong. The trace it reads is already redacted at
// construction (redactTrace).

import type { AnswerTrace } from './answer-trace';

/** Counters only — no identifiers of people, no content, no free text. */
export interface RolloutCounters {
  turns: number;
  engine: { legacy: number; v3: number };

  /** §4: fast/grounded/verification split. A collapse toward grounded means the
   *  fast path is broken and latency follows. */
  path: Record<string, number>;
  /** §4: answerability distribution, the shape of what the layer decided. */
  answerability: Record<string, number>;
  /** §4: strict-refusal and general-fallback rates live here. */
  fallback: Record<string, number>;

  /** §4 TOP RISK: a superseded version reaching retrieval at all. */
  retrieval: {
    turnsWithRetrieval: number;
    /** Turns where the filter REJECTED at least one superseded revision. */
    staleVersionRejectedTurns: number;
    /** Turns where a foreign scope (other meeting / other user) was rejected. */
    outOfScopeRejectedTurns: number;
    /** §4: distinguishes "not found" from "retrieval failed" — indistinguishable
     *  in the legacy path, where both became {fallback:true}. */
    groundedWithNoEvidenceTurns: number;
    dependencyFailureTurns: number;
  };

  /** §4/§5: prohibited source type present in ACCEPTED evidence. Should be
   *  structurally impossible — the port filters on authorized types — so a
   *  non-zero value here means the filter was bypassed, which is an abort
   *  condition, not a metric to trend. */
  contaminationTurns: number;
  /** Turns where contamination COULD be evaluated (the trace carried planned
   *  source types). A rate over turns that could not be checked would read 0%
   *  and look like a pass — the same vacuity that hid four gates earlier. */
  contaminationCheckableTurns: number;

  /** §4: F4 — stale answers overwriting current ones. */
  supersededTurns: number;
  /** V3 path threw and the surface silently reverted to the legacy assembly.
   *  Keyed by surface. A rising count here means "the new system is off and
   *  nobody knows" — the exact silent-fallback failure §22.1 forbids. */
  v3FallbackBySurface: Record<string, number>;

  /** Milliseconds, for the p95 TTFT abort condition. Bounded ring buffer: an
   *  unbounded latency array in a long meeting is its own leak. */
  latencyMs: number[];
}

const MAX_LATENCY_SAMPLES = 512;

function emptyCounters(): RolloutCounters {
  return {
    turns: 0,
    engine: { legacy: 0, v3: 0 },
    path: {}, answerability: {}, fallback: {},
    retrieval: {
      turnsWithRetrieval: 0, staleVersionRejectedTurns: 0, outOfScopeRejectedTurns: 0,
      groundedWithNoEvidenceTurns: 0, dependencyFailureTurns: 0,
    },
    contaminationTurns: 0,
    contaminationCheckableTurns: 0,
    supersededTurns: 0,
    v3FallbackBySurface: {},
    latencyMs: [],
  };
}

// PROCESS-GLOBAL, deliberately — not a module-level `let`.
//
// The build produces self-contained esbuild bundles, so the same source file is
// duplicated into several of them and a module-scoped variable becomes a
// SEPARATE instance per bundle. The orchestrator writes counters inside its
// bundle; the IPC handler reads them inside another; the numbers would have been
// permanently zero in production while every gate reported a clean pass.
//
// Caught by this module's own vacuity guard on the first Stage-0 run: 42 turns
// executed and the counters read 0, and because rates are null-with-no-data
// rather than 0, the gate reported `insufficientData` instead of "0%
// contamination, stage green". A metric that cannot see its own writes is the
// exact failure this mission exists to end, and it very nearly shipped inside
// the tool built to detect it.
const GLOBAL_KEY = '__nativelyCiV3RolloutCounters__';
const store = globalThis as unknown as Record<string, RolloutCounters | undefined>;
if (!store[GLOBAL_KEY]) store[GLOBAL_KEY] = emptyCounters();

/** The one shared counter set, whichever bundle asks. */
const c0 = (): RolloutCounters => {
  if (!store[GLOBAL_KEY]) store[GLOBAL_KEY] = emptyCounters();
  return store[GLOBAL_KEY]!;
};

const bump = (m: Record<string, number>, k: string | undefined) => {
  if (!k) return;
  m[k] = (m[k] ?? 0) + 1;
};

/**
 * Record one completed turn.
 *
 * Never throws: this is observability on a live answer path, and the whole
 * mission's evidence is that a monitoring defect must degrade the metric, never
 * the answer. Callers are not expected to wrap it.
 */
export function recordTurnMetrics(trace: AnswerTrace | null | undefined): void {
  try {
    if (!trace) return;
    const t = trace as unknown as Record<string, any>;
    const counters = c0();
    counters.turns += 1;
    if (t.engine === 'v3') counters.engine.v3 += 1;
    else counters.engine.legacy += 1;

    bump(counters.path, t.retrievalPath ?? t.decision?.retrievalPlan?.path);
    bump(counters.answerability, t.answerability);
    bump(counters.fallback, t.fallbackUsed);

    if (t.status === 'SUPERSEDED') counters.supersededTurns += 1;

    const attempts: any[] = Array.isArray(t.retrievalAttempts) ? t.retrievalAttempts : [];
    if (attempts.length) {
      counters.retrieval.turnsWithRetrieval += 1;
      const reasons = attempts.flatMap((a) => (a?.rejections ?? []).map((r: any) => r?.reason));
      if (reasons.includes('SUPERSEDED_VERSION')) counters.retrieval.staleVersionRejectedTurns += 1;
      if (reasons.includes('OUT_OF_SCOPE')) counters.retrieval.outOfScopeRejectedTurns += 1;
      if (attempts.some((a) => a?.failed)) counters.retrieval.dependencyFailureTurns += 1;

      const accepted = Array.isArray(t.acceptedEvidence) ? t.acceptedEvidence.length : 0;
      const path = t.retrievalPath ?? t.decision?.retrievalPlan?.path;
      if (path && path !== 'FAST' && accepted === 0) {
        counters.retrieval.groundedWithNoEvidenceTurns += 1;
      }
    }

    // Contamination: an accepted item whose source type the turn's PLAN never
    // authorized. Structurally impossible via the port, so a non-zero value
    // means the filter was bypassed — §5 treats it as immediate rollback.
    //
    // Must compare against plannedSourceTypes, NOT trace.authorizedSources:
    // the latter is built from the accepted evidence, so the comparison is
    // tautological, and it holds objects rather than type strings. Both
    // mistakes were live at once and produced a 45.2% false contamination rate.
    const planned: unknown = t.plannedSourceTypes;
    if (Array.isArray(planned) && planned.length && Array.isArray(t.acceptedEvidence)) {
      counters.contaminationCheckableTurns += 1;
      const allowed = new Set(planned.map(String));
      const bad = t.acceptedEvidence.some((e: any) => e?.sourceType && !allowed.has(String(e.sourceType)));
      if (bad) counters.contaminationTurns += 1;
    }

    const ttft = Number(t.timings?.providerTtfbMs ?? t.timings?.totalMs ?? NaN);
    if (Number.isFinite(ttft) && ttft >= 0) {
      counters.latencyMs.push(ttft);
      if (counters.latencyMs.length > MAX_LATENCY_SAMPLES) counters.latencyMs.shift();
    }
  } catch { /* a metrics defect must never affect an answer */ }
}

const pct = (n: number, d: number) => (d > 0 ? n / d : null);

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

/**
 * The §4 signals as RATES, plus the raw counters.
 *
 * Rates are null rather than 0 when the denominator is zero. A rollout gate that
 * reads 0% contamination from zero turns and calls the stage green is the
 * vacuous-gate failure this mission spent its whole investigation removing.
 */
export function getRolloutMetrics(): {
  counters: RolloutCounters;
  rates: Record<string, number | null>;
  latency: { p50: number | null; p95: number | null; samples: number };
} {
  const c = c0();
  const withRetrieval = c.retrieval.turnsWithRetrieval;
  return {
    counters: { ...c, latencyMs: [...c.latencyMs] },
    rates: {
      staleVersionRejected: pct(c.retrieval.staleVersionRejectedTurns, withRetrieval),
      outOfScopeRejected: pct(c.retrieval.outOfScopeRejectedTurns, withRetrieval),
      groundedWithNoEvidence: pct(c.retrieval.groundedWithNoEvidenceTurns, withRetrieval),
      retrievalDependencyFailure: pct(c.retrieval.dependencyFailureTurns, withRetrieval),
      // Denominator is CHECKABLE turns, so an uninstrumented path reports null
      // rather than a reassuring 0%.
      contamination: pct(c.contaminationTurns, c.contaminationCheckableTurns),
      superseded: pct(c.supersededTurns, c.turns),
      strictRefusal: pct(c.fallback.STRICT_NOT_FOUND ?? 0, c.turns),
      generalFallback: pct(c.fallback.GENERAL_KNOWLEDGE ?? 0, c.turns),
      // Deep-run 2 (issue 14): document-specific retrieval misses now carry
      // their own label instead of hiding inside generalFallback.
      documentFactMiss: pct(c.fallback.DOCUMENT_FACT_NOT_FOUND ?? 0, c.turns),
      clarification: pct(c.fallback.CLARIFICATION ?? 0, c.turns),
      fastPath: pct(c.path.FAST ?? 0, c.turns),
      v3Share: pct(c.engine.v3, c.turns),
    },
    latency: {
      p50: quantile(c.latencyMs, 0.5),
      p95: quantile(c.latencyMs, 0.95),
      samples: c.latencyMs.length,
    },
  };
}

/**
 * Abort conditions from §5, evaluated rather than described.
 *
 * Returns the triggered conditions. `minTurns` exists because every one of these
 * is a RATE: firing an abort off two turns would make the rollout unshippable for
 * noise reasons, and reporting "no aborts" from zero turns would be the vacuous
 * pass. Below the threshold this returns `insufficientData` and nothing else.
 */
export function evaluateAbortConditions(input: {
  minTurns?: number;
  /** Legacy contamination rate to compare against, when one has been measured. */
  baselineContamination?: number | null;
  /** Legacy p95 TTFT in ms, when one has been measured. */
  baselineP95Ms?: number | null;
} = {}): { insufficientData: boolean; triggered: string[]; detail: Record<string, unknown> } {
  const minTurns = input.minTurns ?? 50;
  const m = getRolloutMetrics();
  if (m.counters.turns < minTurns) {
    return { insufficientData: true, triggered: [], detail: { turns: m.counters.turns, minTurns } };
  }

  const triggered: string[] = [];

  // "any stale-version or cross-meeting leak observed in production" — a LEAK is
  // an accepted stale/foreign item, which is what contaminationTurns counts.
  // Rejections are the filter WORKING and are deliberately not an abort.
  if (m.counters.contaminationTurns > 0) triggered.push('contamination_any');

  if (input.baselineContamination != null && m.rates.contamination != null
      && m.rates.contamination > input.baselineContamination) {
    triggered.push('contamination_above_baseline');
  }

  if (input.baselineP95Ms != null && m.latency.p95 != null
      && m.latency.p95 > input.baselineP95Ms * 1.2) {
    triggered.push('p95_regression_over_20pct');
  }

  // Over-refusal: strict refusals rising while general fallback is flat/low.
  // §27.2 forbids hiding failures behind refusal.
  if ((m.rates.strictRefusal ?? 0) > 0.25
      && ((m.rates.generalFallback ?? 0) + ((m.rates as Record<string, number | null>).documentFactMiss ?? 0)) < 0.05) {
    triggered.push('over_refusal_suspected');
  }

  return { insufficientData: false, triggered, detail: { rates: m.rates, latency: m.latency } };
}

/** Test seam / session boundary. */
export function resetRolloutMetrics(): void { store[GLOBAL_KEY] = emptyCounters(); }

/**
 * Record a V3 -> legacy fallback. The bridge and the wired IPC surface call
 * this from their catch blocks; a fallback also emits one structured
 * [V3-FALLBACK] line so a session log shows WHEN the decision layer went dark,
 * not just that counters drifted.
 */
export function recordV3Fallback(surface: string, error?: unknown): void {
  try {
    const counters = c0();
    // Older persisted counter objects (created before this field existed) can
    // arrive via the globalThis slot without it.
    if (!counters.v3FallbackBySurface) (counters as RolloutCounters).v3FallbackBySurface = {};
    counters.v3FallbackBySurface[surface] = (counters.v3FallbackBySurface[surface] ?? 0) + 1;
    console.error('[V3-FALLBACK]', JSON.stringify({
      surface,
      error: error instanceof Error ? error.message : String(error ?? 'unknown'),
    }));
  } catch { /* observability only */ }
}
