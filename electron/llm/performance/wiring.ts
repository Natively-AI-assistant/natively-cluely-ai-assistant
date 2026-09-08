// electron/llm/performance/wiring.ts
//
// The three lines a call site adds to participate in the profile.
//
// WHY A HELPER AND NOT INLINE CODE. `raceStreamWithDeadline` has ~18 call sites
// across IntelligenceEngine, ipcHandlers and the phone-mirror path. Every fact
// this area has learned the hard way is about those sites drifting apart —
// liveDeadlines.ts documents a first-useful cap and a total ceiling that
// "disagreed about the same turn", a vision budget silently truncated at one
// surface but not another, and eleven repair sites that each carried their own
// literal. A call site that has to assemble an identity, look up a profile,
// derive a stall guard and build an observer will drift the same way. So it
// assembles none of that: it calls one function and spreads the result.
//
// EVERY PATH HERE IS FAIL-OPEN. Flags off, store unavailable, identity
// unresolvable — each returns the shipped constant and an undefined observer,
// which is byte-for-byte today's behaviour.

import type { StreamObservation } from '../liveDeadlines';
import { LIVE_INTER_TOKEN_STALL_MS } from '../liveDeadlines';
import { streamIdleTimeoutMs, adaptiveTtftCeilingMs, type DeadlineDecision } from './deadlines';
import { getProviderPerformanceStore } from './ProviderPerformanceStore';
import { getRuntimeSignals } from './runtimeSignals';
import {
  recordStreamObservation, telemetryFor, recordSecondaryStream,
  type TurnIdentity, type SecondaryStreamKind,
} from './recorder';
import { readCapabilityFacts } from './capabilityView';
import {
  classifyWorkload, urgencyForStreamRoute,
  type RouteKind, type Urgency, type WorkloadClass,
} from './types';
import { workloadTooSlowFor } from './deadlines';

/** Minimal surface this module needs from LLMHelper — keeps it mockable. */
export interface PerformanceIdentitySource {
  performanceIdentity(hasImages?: boolean): {
    providerId: string; modelId: string; route: RouteKind; isOllama?: boolean;
  };
}

function flagOn(
  key: 'providerPerformanceProfile' | 'adaptiveStreamIdle' | 'adaptiveTtft',
): boolean {
  try {
    // Dynamic require, matching how liveDeadlines is imported inside LLMHelper:
    // a static import here would close a module cycle
    // (intelligenceFlags → SettingsManager → … → llm).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isIntelligenceFlagEnabled } = require('../../intelligence/intelligenceFlags');
    return isIntelligenceFlagEnabled(key) === true;
  } catch {
    // A flag we cannot read is a flag that is OFF. The adaptive consumers ship
    // dark, so failing closed here lands on the shipped constant.
    return false;
  }
}

/**
 * Identities called at least once this process.
 *
 * Session-scoped and deliberately not persisted: "cold" means the weights are
 * not in RAM and the TLS session is not open, which is a fact about THIS
 * process, not about this machine's history. A cold-start flag restored from
 * disk would mark a warm provider cold on every launch.
 */
const seenThisSession = new Set<string>();

/**
 * Identities whose capability FACTS have been copied into the profile.
 *
 * Once per identity per session. The facts come from the existing registries
 * (`getModelCapabilities`, `groqModels`), so re-reading them per turn would be
 * pure waste — and, more importantly, capability is a fact about the model that
 * cannot change mid-session, unlike the latency beside it.
 */
const capabilitiesSeeded = new Set<string>();

export interface PerformanceHookOptions {
  llmHelper: PerformanceIdentitySource | null | undefined;
  hasImages: boolean;
  /** Best available estimate of the request's input size. 0 when unknown. */
  inputTokens: number;
  /** Output tokens, when the route reports them. Usually 0 at open time. */
  outputTokens?: number;
  /** True when the turn was ended by the user/supersession rather than a deadline. */
  isUserCancelled?: () => boolean;
  /** Called with the finished diagnostics record, for logging. */
  onDiagnostics?: (record: PerformanceTurnRecord) => void;
}

export interface PerformanceTurnRecord {
  providerId: string;
  modelId: string;
  route: RouteKind;
  workload: WorkloadClass;
  networkProfileId: string;
  interfaceClass: string;
  ttftMs: number | null;
  totalMs: number;
  chunkCount: number;
  maxGapMs: number | null;
  terminationReason: StreamObservation['reason'];
  sampleClass: string | null;
  streamIdleMs: number;
  streamIdleSource: DeadlineDecision['source'];
  firstUsefulBudgetMs: number;
}

export interface PerformanceHooks {
  /** Pass straight into raceStreamWithDeadline. */
  observe?: (observation: StreamObservation) => void;
  /**
   * The stall guard to use. Equals LIVE_INTER_TOKEN_STALL_MS unless the
   * adaptiveStreamIdle flag is on AND there is enough evidence to move it.
   */
  interTokenStallMs: number;
  /** The stall decision, for diagnostics. */
  streamIdle: DeadlineDecision;
}

/**
 * Build the hooks for one turn.
 *
 * Called once, just before `raceStreamWithDeadline`, with the same `hasImages`
 * the call site already used to pick its deadline — passing a different value
 * here than there would file a vision turn's evidence under the text route.
 */
export function performanceHooks(opts: PerformanceHookOptions): PerformanceHooks {
  const shipped: PerformanceHooks = {
    observe: undefined,
    interTokenStallMs: LIVE_INTER_TOKEN_STALL_MS,
    streamIdle: {
      valueMs: LIVE_INTER_TOKEN_STALL_MS,
      source: 'shipped_prior',
      rawMs: null,
      sampleCount: 0,
      confidence: 'none',
    },
  };

  if (!opts.llmHelper || typeof opts.llmHelper.performanceIdentity !== 'function') return shipped;
  if (!flagOn('providerPerformanceProfile')) return shipped;

  let identity: { providerId: string; modelId: string; route: RouteKind; isOllama?: boolean };
  try {
    identity = opts.llmHelper.performanceIdentity(opts.hasImages);
  } catch {
    return shipped;
  }

  const signals = getRuntimeSignals();
  const store = getProviderPerformanceStore();
  const network = signals.network();
  const profile = store.lookup(identity.providerId, identity.modelId, network.id);
  const workload = classifyWorkload(opts.inputTokens, opts.hasImages);

  const streamIdle = streamIdleTimeoutMs(identity.route, profile);
  // The flag gates the ACT, not the MEASUREMENT. With adaptiveStreamIdle off we
  // still compute the decision (so diagnostics can show what it would have
  // been) and still hand the driver the shipped constant.
  const effectiveStallMs = flagOn('adaptiveStreamIdle') ? streamIdle.valueMs : LIVE_INTER_TOKEN_STALL_MS;

  const sessionKey = `${identity.providerId}|${identity.modelId}`;
  const coldStart = !seenThisSession.has(sessionKey);
  seenThisSession.add(sessionKey);
  const startedAt = Date.now();
  // The generation is taken when the stream OPENS, not when it ends: a user who
  // hits "reset" mid-meeting means "forget what you knew", and a turn already in
  // flight would otherwise resurrect one row after the wipe.
  const generation = store.currentGeneration();

  // Seed capability facts from the registries that already own them. READ-ONLY
  // and never inferred from anything measured — a slow provider is a
  // performance fact, an image-refusing model is a capability fact, and this
  // feature exists partly because conflating them shows a user
  // "your model does not support vision" when their network was simply bad.
  if (!capabilitiesSeeded.has(sessionKey)) {
    capabilitiesSeeded.add(sessionKey);
    try {
      store.setCapabilities(
        identity.providerId,
        identity.modelId,
        network.id,
        readCapabilityFacts(identity.modelId, identity.isOllama === true),
      );
    } catch { /* capability seeding must never break a turn */ }
  }

  const observe = (observation: StreamObservation) => {
    const turn: TurnIdentity = {
      providerId: identity.providerId,
      modelId: identity.modelId,
      route: identity.route,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens ?? 0,
      hasImages: opts.hasImages,
      startedAt,
      coldStart,
      userCancelled: (() => {
        try { return opts.isUserCancelled?.() === true; } catch { return false; }
      })(),
    };
    const sample = recordStreamObservation(observation, turn, {
      store,
      signals,
      networkProfileId: network.id,
      generation,
    });

    if (sample) emitTelemetry(sample, network.interfaceClass);

    try {
      opts.onDiagnostics?.({
        providerId: identity.providerId,
        modelId: identity.modelId,
        route: identity.route,
        workload,
        networkProfileId: network.id,
        interfaceClass: network.interfaceClass,
        ttftMs: observation.ttftMs,
        totalMs: observation.totalMs,
        chunkCount: observation.chunkCount,
        maxGapMs: sample?.maxGapMs ?? null,
        terminationReason: observation.reason,
        sampleClass: sample?.sampleClass ?? null,
        streamIdleMs: effectiveStallMs,
        streamIdleSource: streamIdle.source,
        firstUsefulBudgetMs: observation.firstUsefulBudgetMs,
      });
    } catch { /* diagnostics must never break a turn */ }
  };

  return { observe, interTokenStallMs: effectiveStallMs, streamIdle };
}

/**
 * Emit through the telemetry service that already exists.
 *
 * `interfaceClass` and NOT the network id — a per-network identifier leaving the
 * device would be a location beacon, which is the one thing Phase 24 names
 * outright. The class ('wifi' | 'ethernet' | …) is enough to tell a hotspot from
 * fibre in aggregate and identifies nobody.
 */
function emitTelemetry(sample: Parameters<typeof telemetryFor>[0], interfaceClass: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { telemetryService } = require('../../services/telemetry/TelemetryService');
    const { name, properties } = telemetryFor(sample);
    telemetryService.record(name, { ...properties, interface_class: interfaceClass });
  } catch { /* telemetry is best-effort by contract */ }
}

/**
 * An observer for a stream that is NOT the answer the user is waiting on.
 *
 * Repairs, verbatim regenerations and verification passes. They reach NO
 * profile — see `recordSecondaryStream`'s comment for the three reasons (a
 * truncated replay lands in the wrong workload bucket; a warm-connection TTFT
 * drags the median down; a deliberately-short budget makes a timeout meaningless
 * as a health signal).
 *
 * They are still worth watching. This codebase has already shipped a defect
 * where "a repair window that expires before a slow gateway's first token is a
 * repair that can never land" — and the symptom was silence: the user simply
 * never saw their answer improve. A tally makes that visible without letting it
 * near a deadline.
 *
 * Returns `undefined` when the profile is off, so a call site can spread it
 * unconditionally.
 */
export function secondaryStreamObserver(
  kind: SecondaryStreamKind,
): ((observation: StreamObservation) => void) | undefined {
  if (!flagOn('providerPerformanceProfile')) return undefined;
  return (observation) => {
    try {
      const tally = recordSecondaryStream(kind, observation);
      if (observation.reason === 'first_useful_timeout' || observation.reason === 'stall_timeout') {
        console.log('[Perf] secondary stream did not land', {
          kind,
          reason: observation.reason,
          budgetMs: observation.firstUsefulBudgetMs,
          ttftMs: observation.ttftMs,
          // The ratio a reader actually needs: a repair whose budget sits below
          // the first token this provider has been seen to produce can never
          // succeed, and that is a sizing bug, not a provider fault.
          maxObservedTtftMs: tally.maxObservedTtftMs,
          landed: `${tally.completed}/${tally.attempts}`,
        });
      }
    } catch { /* observation must never break a repair */ }
  };
}

/**
 * The first-token ceiling for this turn, with evidence applied where allowed.
 *
 * Takes the value the SHIPPED route table already produced and returns it
 * unchanged unless `adaptiveTtft` is on and the route is one the table marks
 * adaptive. Written this way round on purpose: the call site keeps calling
 * `totalHardTimeoutMs`/`firstUsefulDeadlineMs` exactly as it does now, and this
 * is a post-filter — so deleting the call restores today's behaviour with no
 * other edit, which is the rollback story Phase 29 asks for.
 */
export function applyAdaptiveTtft(
  shippedMs: number,
  opts: { llmHelper: PerformanceIdentitySource | null | undefined; hasImages: boolean; inputTokens: number },
): number {
  try {
    if (!opts.llmHelper || typeof opts.llmHelper.performanceIdentity !== 'function') return shippedMs;
    if (!flagOn('providerPerformanceProfile') || !flagOn('adaptiveTtft')) return shippedMs;
    const identity = opts.llmHelper.performanceIdentity(opts.hasImages);
    const network = getRuntimeSignals().network();
    const profile = getProviderPerformanceStore().lookup(identity.providerId, identity.modelId, network.id);
    return adaptiveTtftCeilingMs(
      { route: identity.route, workload: classifyWorkload(opts.inputTokens, opts.hasImages), shippedMs },
      profile,
    ).valueMs;
  } catch {
    return shippedMs;
  }
}


/**
 * "This workload is likely to be too slow for what the user is doing."
 *
 * Phase 18's ask, and the shape it asks for: the profile RAISES a signal and
 * the mechanisms Natively already has respond. It does not itself reduce
 * context, compress an image or summarise anything — inventing a new context
 * manager beside the existing one is exactly what Phase 18 rules out.
 *
 * What it returns is a recommendation an existing call site can act on, plus
 * the numbers that justify it so a log line can explain the decision.
 *
 * DELIBERATELY ADVISORY. Nothing here shortens a deadline. The distinction
 * Phase 12 draws is that a 30-second answer on a live meeting turn will very
 * likely SUCCEED and still be useless — so the correct response is to send less,
 * not to give up sooner. Giving up sooner would just convert a slow answer into
 * no answer.
 */
export interface SlowWorkloadAdvice {
  tooSlow: true;
  predictedMs: number;
  budgetMs: number;
  urgency: Urgency;
  workload: WorkloadClass;
  /**
   * What an existing mechanism could do about it, most-preferred first.
   *
   * `reduce_context` maps to truncateTranscriptToFit / the retrieval budget,
   * both of which already exist. `compress_image` maps to the screenshot
   * pipeline's existing resize. `defer` means "this is not a live-answerable
   * request" — the honest recommendation when the input is simply too big for
   * the provider to answer inside the moment.
   */
  suggestions: Array<'reduce_context' | 'compress_image' | 'defer'>;
}

/**
 * Ask the profile whether this turn is going to be too slow to be useful.
 *
 * Returns null when we cannot tell (no profile, no measured generation rate) or
 * when there is nothing to worry about — so a caller can treat any non-null
 * result as actionable rather than having to inspect a boolean.
 */
export function slowWorkloadAdvice(opts: {
  llmHelper: PerformanceIdentitySource | null | undefined;
  hasImages: boolean;
  inputTokens: number;
  /** Natively's own `streamRoute` value — 'wta_live' | 'manual_chat_stream' | … */
  streamRoute?: string | null;
  /** How long an answer of this shape usually is. Callers pass their own norm. */
  expectedOutputTokens?: number;
}): SlowWorkloadAdvice | null {
  try {
    if (!opts.llmHelper || typeof opts.llmHelper.performanceIdentity !== 'function') return null;
    if (!flagOn('providerPerformanceProfile')) return null;
    const identity = opts.llmHelper.performanceIdentity(opts.hasImages);
    const network = getRuntimeSignals().network();
    const profile = getProviderPerformanceStore().lookup(identity.providerId, identity.modelId, network.id);
    const workload = classifyWorkload(opts.inputTokens, opts.hasImages);
    const urgency = urgencyForStreamRoute(opts.streamRoute);
    const verdict = workloadTooSlowFor({
      profile,
      workload,
      urgency,
      // 400 tokens is a spoken live answer's rough size — the measured p100 in
      // liveDeadlines' own capture was 2530 chars across 19 real answers, and
      // 400 tokens is about that. Callers with a better norm pass it.
      expectedOutputTokens: opts.expectedOutputTokens ?? 400,
    });
    if (!verdict) return null;

    const suggestions: SlowWorkloadAdvice['suggestions'] = [];
    if (opts.hasImages) suggestions.push('compress_image');
    if (workload === 'large' || workload === 'medium') suggestions.push('reduce_context');
    if (suggestions.length === 0) suggestions.push('defer');
    return {
      tooSlow: true,
      predictedMs: verdict.predictedMs,
      budgetMs: verdict.budgetMs,
      urgency,
      workload,
      suggestions,
    };
  } catch {
    return null;
  }
}


/**
 * The image-optimisation profile a vision turn should use, given how slow this
 * provider is measured to be.
 *
 * PHASE 18, USING A MECHANISM THAT ALREADY EXISTS. `ImageOptimizer` already
 * ships four presets — fast/balanced/technical/best, differing in long edge and
 * JPEG quality — and every vision call site already passes one. So the profile
 * does not compress anything itself; it answers "which of the presets you
 * already have should this turn use", which is exactly the shape Phase 18 asks
 * for ("Do not invent an entirely new context management system").
 *
 * The trade is honest and worth stating. `fast` is 1024px @ q78 against
 * `balanced`'s 1280px @ q85 — a real quality reduction, and on a screenshot of
 * dense code it can cost legibility, which is why `technical` exists at 1536px.
 * So this only ever fires when the profile predicts the turn will BLOW ITS
 * URGENCY BUDGET, and never on the `technical` preset: a coding screenshot that
 * arrives fast and unreadable has not been improved.
 *
 * Returns the caller's own choice unchanged in every other case, so a call site
 * can wrap its existing argument with no branch.
 */
export function imageProfileForTurn(
  requested: 'fast' | 'balanced' | 'technical' | 'best',
  opts: {
    llmHelper: PerformanceIdentitySource | null | undefined;
    inputTokens: number;
    streamRoute?: string | null;
  },
): 'fast' | 'balanced' | 'technical' | 'best' {
  try {
    // A screenshot of code is sent BECAUSE the text has to be readable. Trading
    // its legibility for latency answers a different question than the user
    // asked, so this preset is never downgraded.
    if (requested === 'technical') return requested;
    if (requested === 'fast') return requested;
    const advice = slowWorkloadAdvice({
      llmHelper: opts.llmHelper,
      hasImages: true,
      inputTokens: opts.inputTokens,
      streamRoute: opts.streamRoute,
    });
    if (!advice || !advice.suggestions.includes('compress_image')) return requested;
    console.log('[Perf] downgrading image profile to fit the urgency budget', {
      from: requested, to: 'fast', predictedMs: advice.predictedMs, budgetMs: advice.budgetMs,
    });
    return 'fast';
  } catch {
    return requested;
  }
}
