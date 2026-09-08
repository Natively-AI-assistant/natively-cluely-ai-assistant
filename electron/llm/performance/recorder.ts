// electron/llm/performance/recorder.ts
//
// Turns one `StreamObservation` from the deadline driver into one classified
// `PerformanceSample` in the store.
//
// THIS IS WHERE SAMPLE HYGIENE HAPPENS (Phase 10), and it is one function on
// purpose. The recurring failure in this area is two surfaces disagreeing about
// when a measurement counts — liveDeadlines.ts documents exactly that
// ("These two surfaces feed ONE latency map, so if they disagree about when a
// measurement counts the map means nothing"). So every route's observation
// funnels through `classifySample` and nothing else decides.

import type { StreamObservation } from '../liveDeadlines';
import { summarizeGaps, generationRateTps } from './estimators';
import { getRuntimeSignals, type RuntimeSignals } from './runtimeSignals';
import { getProviderPerformanceStore, type ProviderPerformanceStore } from './ProviderPerformanceStore';
import {
  classifyWorkload,
  type PerformanceSample,
  type RouteKind,
  type SampleClass,
} from './types';

/**
 * Map the provider error classifier's nine kinds onto the four error slots a
 * sample has.
 *
 * WRITTEN OUT DELIBERATELY, not defaulted. A `default: 'unknown'` here would
 * silently swallow `auth`, and an expired API key is precisely the condition a
 * user needs a reliability signal for — it is one of the diagnostic gaps this
 * feature exists to close. Every kind therefore has an explicit destination and
 * a reason:
 *
 *   rate_limit  → rate_limit         the provider is throttling us
 *   auth        → client_error       the KEY is wrong; retrying cannot fix it
 *   overloaded  → server_error       503/529 is the provider's capacity, not ours
 *   server_error→ server_error
 *   network     → connection_failure DNS/ECONNRESET never reached the provider
 *   timeout     → null               our OWN deadline; the driver's `reason`
 *                                    already says that, and classifying it here
 *                                    too would double-count one event
 *   zero_token  → null               the stream ENDED cleanly with no text. That
 *                                    is an answer-quality failure, not a
 *                                    transport one, and the answer layer already
 *                                    owns it (regeneration / canned line)
 *   stall       → null               a content-free clarification is likewise a
 *                                    quality judgement about text we received
 *   none        → null               not a provider failure at all
 *
 * `null` means "this classifier has nothing to add" — the sample then falls
 * through to the stream's own outcome, which is the honest answer.
 */
export function sampleClassForProviderError(kind: string): SampleClass | null {
  switch (kind) {
    case 'rate_limit': return 'rate_limit';
    case 'auth': return 'client_error';
    case 'overloaded': return 'server_error';
    case 'server_error': return 'server_error';
    case 'network': return 'connection_failure';
    case 'timeout': return null;
    case 'zero_token': return null;
    case 'stall': return null;
    case 'none': return null;
    default: return 'unknown';
  }
}

/**
 * Classify the error the driver caught, without letting it out of this function.
 *
 * The error object is read here and dropped here. Only the derived class
 * escapes, which is what keeps a provider's error text — which can quote the
 * request that produced it — out of the profile and out of telemetry.
 */
export function classifyStreamError(error: unknown): SampleClass | null {
  if (error === undefined || error === null) return null;
  try {
    // Dynamic, so this module does not pull the classifier into every bundle
    // that only needs the estimators.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { classifyProviderError } = require('../providerErrorClassifier');
    return sampleClassForProviderError(classifyProviderError(error).kind);
  } catch {
    return 'unknown';
  }
}

/**
 * A stream that is NOT the answer the user is waiting on: a post-answer repair,
 * a verbatim regeneration, a verification pass.
 *
 * These are excluded from the profile entirely, and the reason is not caution:
 *
 *   • `replayAnswerCall` truncates the inherited prompt at 24000 chars, so a
 *     repair on a 32K turn is actually a ~6K request. Filing it under the
 *     answer's workload bucket corrupts `meanInputTokens`, which is the
 *     x-coordinate the whole context fit stands on.
 *   • A repair fires immediately after the answer on a WARM connection, so its
 *     TTFT is systematically lower. `foldLatency` nudges `p50Ms` toward each
 *     sample and `performanceGrade` reads `p50Ms` first — a slow provider could
 *     grade "fast" on the strength of its own repair latencies.
 *   • Their deadline is deliberately SHORTER than the answer's
 *     (`repairDeadlineMs` is a fraction of the route budget), so a repair
 *     timeout says nothing about provider health.
 *
 * They are still worth OBSERVING. A repair window that expires before a slow
 * gateway's first token is a repair that can never land, and that failure is
 * silent — the user simply never sees their answer improve. So the outcomes are
 * tallied process-locally and surfaced in diagnostics, and reach no profile.
 */
export type SecondaryStreamKind = 'repair' | 'regeneration' | 'verification';

export interface SecondaryStreamTally {
  kind: SecondaryStreamKind;
  attempts: number;
  completed: number;
  firstTokenTimeouts: number;
  stalls: number;
  aborted: number;
  errors: number;
  /** Largest first-token time seen on a repair that DID land, for sizing. */
  maxObservedTtftMs: number;
}

const secondaryTallies = new Map<string, SecondaryStreamTally>();

export function recordSecondaryStream(
  kind: SecondaryStreamKind,
  observation: StreamObservation,
): SecondaryStreamTally {
  const t = secondaryTallies.get(kind) ?? {
    kind, attempts: 0, completed: 0, firstTokenTimeouts: 0, stalls: 0, aborted: 0, errors: 0, maxObservedTtftMs: 0,
  };
  t.attempts += 1;
  switch (observation.reason) {
    case 'done': t.completed += 1; break;
    case 'first_useful_timeout': t.firstTokenTimeouts += 1; break;
    case 'stall_timeout': t.stalls += 1; break;
    case 'aborted': t.aborted += 1; break;
    case 'error': t.errors += 1; break;
  }
  if (observation.ttftMs != null && observation.ttftMs > t.maxObservedTtftMs) {
    t.maxObservedTtftMs = observation.ttftMs;
  }
  secondaryTallies.set(kind, t);
  return t;
}

export function secondaryStreamTallies(): SecondaryStreamTally[] {
  return [...secondaryTallies.values()];
}

/** Test helper. */
export function __resetSecondaryStreamTallies(): void {
  secondaryTallies.clear();
}

/**
 * Intervals a stream must contain before its gaps are evidence about the
 * provider's gap distribution rather than about one lucky moment.
 */
export const MIN_GAPS_FOR_EVIDENCE = 3;

/**
 * Characters → tokens, using the estimator the context budgets already use.
 *
 * Kept as its own named function rather than an inline call so that the one
 * place this approximation is made is greppable — the day a provider starts
 * reporting real usage to the streaming caller, this is what gets replaced.
 */
export function estimateOutputTokens(outputChars: number): number {
  if (!Number.isFinite(outputChars) || outputChars <= 0) return 0;
  // Mirrors `estimateTokens` in modelCapabilities.ts, which is `ceil(len / 4)`.
  // Deliberately NOT calling it: that function takes TEXT, and we hold only a
  // length — calling it would mean allocating a megabyte-scale string to count
  // its own characters back. A test asserts the two agree, so the duplication
  // cannot drift silently.
  return Math.ceil(outputChars / 4);
}

/** Everything the driver cannot know, supplied by the call site. */
export interface TurnIdentity {
  providerId: string;
  modelId: string;
  route: RouteKind;
  /** Input tokens if the route reports them, else 0. */
  inputTokens: number;
  outputTokens: number;
  hasImages: boolean;
  /** When the turn's stream was opened. Used for contamination windows. */
  startedAt: number;
  /** True when this identity has not been called yet this session. */
  coldStart: boolean;
  /** True when the caller (not a deadline) ended the turn. */
  userCancelled: boolean;
  /** Provider error class, when the turn ended in a thrown provider error. */
  errorClass?: 'rate_limit' | 'server_error' | 'client_error' | 'connection_failure';
}

/**
 * The one place a sample's class is decided.
 *
 * ORDER IS THE ARGUMENT. Environmental contamination is checked BEFORE the
 * stream's own outcome, because a turn that timed out while the laptop was
 * waking up is not evidence about the provider — recording it as `timeout`
 * would count an outage against a provider that was never asked. Conversely a
 * user cancellation outranks everything: the user stopping a turn says nothing
 * at all about latency and must not reach the reliability counters either.
 */
export function classifySample(
  observation: StreamObservation,
  identity: TurnIdentity,
  signals: Pick<RuntimeSignals, 'contaminatedSince'>,
): SampleClass {
  if (identity.userCancelled || observation.reason === 'aborted') return 'user_cancelled';
  if (identity.errorClass) return identity.errorClass;

  const contamination = signals.contaminatedSince(identity.startedAt);
  if (contamination) return contamination;

  switch (observation.reason) {
    case 'first_useful_timeout': return 'timeout';
    case 'stall_timeout': return 'stall';
    case 'error': {
      // Ask the provider error classifier what actually went wrong. Without
      // this every thrown failure — an expired key, a 429, a DNS failure —
      // collapsed to 'unknown' and reached NO reliability counter, which
      // silently defeated the diagnostics this feature exists to provide.
      const classified = classifyStreamError(observation.error);
      return classified ?? 'unknown';
    }
    case 'done':
      // A cold start SUCCEEDED, so it belongs in the reliability numerator — but
      // its latency is a weight load or a container spin-up, not the steady
      // state a deadline should be sized for. That split is the whole reason
      // `isLatencyAdmissible` and `isReliabilitySignal` are two predicates.
      return identity.coldStart ? 'cold_start' : 'normal';
    default: return 'unknown';
  }
}

/**
 * Fold an observation into the profile store.
 *
 * Never throws. This runs inside the deadline driver's cleanup, on the answer
 * path, and a measurement that can break a turn is worse than no measurement.
 */
export function recordStreamObservation(
  observation: StreamObservation,
  identity: TurnIdentity,
  deps: {
    store?: ProviderPerformanceStore;
    signals?: RuntimeSignals;
    networkProfileId?: string;
    /** The store's wipe generation when this stream OPENED. */
    generation?: number;
  } = {},
): PerformanceSample | null {
  try {
    // A speculative (prefetch) stream ran with the deadline DISABLED, so its
    // timings describe a request nobody was waiting on and no budget bounded.
    // Feeding it to a deadline estimator would be measuring a different thing
    // than the one being sized.
    if (observation.speculative) return null;

    const signals = deps.signals ?? getRuntimeSignals();
    const store = deps.store ?? getProviderPerformanceStore();
    const networkProfileId = deps.networkProfileId ?? signals.network().id;
    const sampleClass = classifySample(observation, identity, signals);

    // Gaps are taken ONLY from a stream that completed. On a stall the largest
    // gap IS the guard's own value, so feeding it back would teach the guard
    // that this provider's normal gap equals whatever the guard allows — the
    // upward ratchet recordAnswerFirstToken's contract already forbids for TTFT.
    //
    // AND only from a stream long enough to have a gap DISTRIBUTION. A two-chunk
    // answer has exactly one interval, and one interval cannot distinguish "this
    // provider streams smoothly" from "this provider happened not to pause in
    // the 40ms we watched". Since the stall guard now derives from these, a thin
    // sample would pin `maxGapMs` artificially low and narrow a live deadline on
    // the strength of almost no evidence.
    const gaps = observation.reason === 'done'
      && observation.interChunkGapsMs.length >= MIN_GAPS_FOR_EVIDENCE
      ? summarizeGaps(observation.interChunkGapsMs)
      : null;

    // ESTIMATED from characters yielded — see StreamObservation.outputChars for
    // why no real count is available at this layer. `estimateTokens` is the same
    // estimator the context budgets already fit prompts with, so a token figure
    // here means what it means there.
    const estimatedOutputTokens = estimateOutputTokens(observation.outputChars);
    const completed = observation.reason === 'done';
    const sample: PerformanceSample = {
      providerId: identity.providerId,
      modelId: identity.modelId,
      networkProfileId,
      route: identity.route,
      workload: classifyWorkload(identity.inputTokens, identity.hasImages),
      sampleClass,
      ttftMs: observation.ttftMs,
      totalMs: completed ? observation.totalMs : null,
      maxGapMs: gaps?.maxGapMs ?? null,
      p50GapMs: gaps?.p50GapMs ?? null,
      inputTokens: identity.inputTokens,
      outputTokens: estimatedOutputTokens,
      // Only from a stream that finished. A stream cut by the runaway character
      // cap or by the stall guard has a truncated numerator over an untruncated
      // denominator, which reads as a provider that writes slowly when in fact
      // it was interrupted.
      generationRateTps: completed
        ? generationRateTps({ estimatedOutputTokens, ttftMs: observation.ttftMs, totalMs: observation.totalMs })
        : null,
    };
    store.record(sample, deps.generation);
    return sample;
  } catch {
    return null;
  }
}

/**
 * Map a classified sample onto the telemetry vocabulary that already exists.
 *
 * Phase 18 forbids a second telemetry pipeline, and there is no need for one:
 * `TelemetryService` already defines `llm_first_token_latency`, `llm_completed`,
 * `provider_error` and `provider_fallback`. This returns the event name and a
 * METADATA-ONLY property bag for the caller to hand to the existing service —
 * it does not import TelemetryService, so this module stays free of Electron
 * and testable in isolation.
 *
 * Property bag rules, enforced by what this function can see: it is given a
 * sample, and a sample has no content fields. There is nothing here that could
 * carry a prompt even by accident. The NETWORK ID is deliberately omitted — a
 * per-network identifier leaving the device is a location beacon; only the
 * coarse interface class is safe, and the caller supplies that.
 */
export function telemetryFor(sample: PerformanceSample): {
  name: 'llm_first_token_latency' | 'llm_completed' | 'provider_error';
  properties: Record<string, string | number | boolean>;
} {
  const base = {
    provider: sample.providerId,
    model: sample.modelId,
    route: sample.route,
    workload: sample.workload,
    sample_class: sample.sampleClass,
    input_tokens: sample.inputTokens,
    output_tokens: sample.outputTokens,
  };
  if (sample.sampleClass === 'normal' || sample.sampleClass === 'cold_start') {
    return sample.totalMs != null
      ? { name: 'llm_completed', properties: { ...base, ttft_ms: sample.ttftMs ?? -1, total_ms: sample.totalMs } }
      : { name: 'llm_first_token_latency', properties: { ...base, ttft_ms: sample.ttftMs ?? -1 } };
  }
  return { name: 'provider_error', properties: { ...base, ttft_ms: sample.ttftMs ?? -1 } };
}
