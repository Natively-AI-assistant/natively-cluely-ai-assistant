// electron/llm/performance/autoFastRanking.ts
//
// Orders Fast Response Mode's Auto candidates by THIS user's own measurements —
// the passive first-token samples every answered turn files in the Provider
// Performance Profile (`providerPerformanceProfile`, on by default). Pure:
// evidence in, order out. No store, no clock, no electron.
//
// The rules, each for a reason:
//  - Only one bucket is compared, AUTO_FAST_WORKLOAD. Live answers (message +
//    context under 8K tokens) land in 'small'; a sample from another bucket
//    would make a model look faster or slower than it is on the turns that
//    matter. A candidate with evidence only elsewhere counts as unmeasured.
//  - An UNMEASURED candidate keeps its shipped slot; MEASURED candidates re-sort
//    among the slots measured candidates hold. So nothing is promoted without
//    evidence — no live meeting answer is spent exploring an unmeasured model —
//    and nothing is pushed below its shipped position without evidence either
//    ("never demote an UNMEASURED provider behind a measured-but-slow one").
//  - A measured-UNRELIABLE candidate goes last: rankProvidersFor's reasoning, a
//    model that answers fast and fails a fifth of the time is not the one to
//    route to.
//  - A later candidate must be clearly faster (AUTO_FAST_SWITCH_MARGIN) to move
//    ahead of an earlier one, so near-ties do not flip the answering model from
//    turn to turn.
//
// p50, not the decaying max: this ranks typical speed. The max sizes deadlines
// and stays there.

import type { ProviderPerformanceProfile, WorkloadClass } from './types';

export const AUTO_FAST_WORKLOAD: WorkloadClass = 'small';
/** Latency samples before a candidate's p50 is trusted over its shipped slot. */
export const AUTO_FAST_MIN_SAMPLES = 3;
/** Attempts before a success rate can mark a candidate unreliable. */
export const AUTO_FAST_MIN_ATTEMPTS = 5;
export const AUTO_FAST_MIN_SUCCESS_RATE = 0.8;
/** How much faster (fractionally) a later candidate must be to overtake. */
export const AUTO_FAST_SWITCH_MARGIN = 0.15;

export interface AutoFastEvidence {
  p50Ms: number;
  samples: number;
  attempts: number;
  successRate: number | null;
}

/**
 * The evidence for one candidate from the profiles its samples may be filed
 * under (Codex has two ids). The profile with the most samples in the bucket
 * wins; null when none has any.
 */
export function autoFastEvidence(
  profiles: ReadonlyArray<ProviderPerformanceProfile | null | undefined>,
  workload: WorkloadClass = AUTO_FAST_WORKLOAD,
): AutoFastEvidence | null {
  let best: AutoFastEvidence | null = null;
  for (const p of profiles) {
    const w = p?.workloads?.[workload];
    if (!w) continue;
    const r = w.reliability;
    const attempts = r
      ? r.ok + r.timeout + r.stall + r.rateLimit + r.serverError + r.clientError + r.connectionFailure
      : 0;
    const e: AutoFastEvidence = {
      p50Ms: w.ttft.p50Ms,
      samples: w.ttft.count,
      attempts,
      successRate: attempts > 0 ? r.ok / attempts : null,
    };
    if (!best || e.samples > best.samples) best = e;
  }
  return best && (best.samples > 0 || best.attempts > 0) ? best : null;
}

/** Candidates in shipped order, each with its evidence, best first out. */
export function orderAutoFastCandidates<T extends { evidence: AutoFastEvidence | null }>(prior: readonly T[]): T[] {
  const unreliable = (c: T) => !!c.evidence
    && c.evidence.attempts >= AUTO_FAST_MIN_ATTEMPTS
    && (c.evidence.successRate ?? 1) < AUTO_FAST_MIN_SUCCESS_RATE;
  const measured = (c: T) => !!c.evidence && c.evidence.samples >= AUTO_FAST_MIN_SAMPLES && !unreliable(c);

  const kept = prior.filter((c) => !unreliable(c));
  // Measured candidates in shipped order, each inserted ahead of the first one
  // it CLEARLY beats — the margin is what keeps near-ties in shipped order.
  const sorted: T[] = [];
  for (const c of kept.filter(measured)) {
    const at = sorted.findIndex((s) => c.evidence!.p50Ms * (1 + AUTO_FAST_SWITCH_MARGIN) < s.evidence!.p50Ms);
    if (at === -1) sorted.push(c); else sorted.splice(at, 0, c);
  }
  let next = 0;
  const ordered = kept.map((c) => (measured(c) ? sorted[next++] : c));
  return [...ordered, ...prior.filter(unreliable)];
}
