// electron/llm/performance/types.ts
//
// The Provider Performance Profile — the shared evidence layer behind every
// adaptive deadline in liveDeadlines.ts.
//
// WHY THIS EXISTS, stated against what was already here. liveDeadlines.ts
// already had adaptation: a route table, a decaying-max budget, asymmetric
// widen/narrow, and clamps. What it did NOT have was anything to adapt FROM on
// most routes. `LLMHelper.answerLatencyKey()` returns null for every route
// except Custom / cURL / LiteLLM / NIM, so Gemini, Groq, Claude, OpenAI,
// DeepSeek, the natively cascade and Ollama were measured not at all, the map
// died with the process, and the one deadline with no adaptation whatsoever —
// the inter-token stall guard — had no distribution to be derived from.
//
// This module is the data model for that evidence. It is deliberately PURE:
// no fs, no electron, no singleton. The store that persists it lives next door;
// the selectors that consume it take a profile as an argument. That is what
// keeps liveDeadlines.ts importable from the benchmark runners, which run
// outside Electron.

/**
 * Which of Natively's request paths produced a sample.
 *
 * Not an invention — these are exactly the five cases `totalHardTimeoutMs`
 * already branches on, and each one's budget is justified by something in THAT
 * route's request path. Carrying the route on the sample is what lets the store
 * refuse to let one route's evidence size another's deadline.
 */
export type RouteKind =
  | 'local'            // Ollama / Codex CLI — cold weight load precedes first token
  | 'vision'           // image-bearing turn, served by the vision chain
  | 'server_cascade'   // natively-api, which rotates providers at its own 10s cutover
  | 'user_endpoint'    // Custom / cURL / LiteLLM / NVIDIA NIM
  | 'default_provider'; // a shipped provider called directly

/**
 * Workload class. Bucketed by INPUT size because that is what actually moves
 * prefill latency, plus a separate vision bucket because an image turn pays
 * encode + multimodal prefill that no token count predicts.
 *
 * Boundaries are the ones Phase 5 names (4K / 12K / 32K), expressed as the
 * ranges between them.
 */
export type WorkloadClass = 'small' | 'medium' | 'large' | 'vision';

/**
 * How much the user is waiting, derived from Natively's OWN `streamRoute`
 * vocabulary — not an invented taxonomy (Phase 12: "Do not invent modes that
 * don't exist. Use real Natively modes.").
 *
 * The real values in the codebase are `wta_live`, `manual_chat_stream`,
 * `phone_mirror` and `unknown`, and they genuinely differ in urgency:
 *
 *   live         wta_live — the auto-answer path during a meeting. The whole
 *                latency contract in liveDeadlines.ts was written for this:
 *                "must NEVER make the user wait 10s+". An answer that arrives
 *                after the moment has passed is worthless however correct.
 *   interactive  manual_chat_stream / phone_mirror — the user typed and is
 *                looking at a spinner. Slower is tolerable; useless is not.
 *   background   meeting summaries, post-call generation. Nobody is watching;
 *                MAX_SUMMARY_OUTPUT_CHARS already allows 120k chars here.
 *
 * `unknown` maps to `background`, the MOST PERMISSIVE tier. An unrecognised
 * route must never be treated as the most urgent one — that would let a new
 * call site inherit the tightest budget in the system by forgetting to label
 * itself.
 */
export type Urgency = 'live' | 'interactive' | 'background';

export function urgencyForStreamRoute(streamRoute: string | null | undefined): Urgency {
  switch (streamRoute) {
    case 'wta_live': return 'live';
    case 'manual_chat_stream':
    case 'phone_mirror': return 'interactive';
    default: return 'background';
  }
}

/** Upper bound (exclusive) of each text workload class, in input tokens. */
export const WORKLOAD_BOUNDS: { readonly small: number; readonly medium: number } = {
  small: 8_000,
  medium: 24_000,
};

export function classifyWorkload(inputTokens: number, hasImages: boolean): WorkloadClass {
  if (hasImages) return 'vision';
  if (!Number.isFinite(inputTokens) || inputTokens < WORKLOAD_BOUNDS.small) return 'small';
  if (inputTokens < WORKLOAD_BOUNDS.medium) return 'medium';
  return 'large';
}

/**
 * Why a sample is or is not representative of normal latency.
 *
 * Phase 10. The distinction that matters: a class is either admissible into the
 * LATENCY estimators or it is not, but NO class is discarded — the inadmissible
 * ones are exactly the reliability signal. `isLatencyAdmissible` below is the
 * single place that decision is made.
 */
export type SampleClass =
  | 'normal'            // a committed turn on a warm path — the only true latency signal
  /**
   * A CALIBRATION rung: synthetic prompt, cold connection, deliberate size.
   *
   * Latency-admissible, and that is a correction made from real data. These
   * were first classified `cold_start` to keep a cold synthetic request out of
   * the warm production median — but a live run showed what that actually cost:
   * the `medium` and `large` buckets stayed at n=0 even after three successful
   * rungs measured 1026ms / 1755ms / 3664ms, because excluded samples populate
   * neither `ttft` nor `meanInputTokens`. Those two fields ARE the
   * context-scaling fit's coordinates, and in practice calibration is the only
   * thing that ever fills the large bucket — a user rarely sends 32K by hand.
   * So excluding it made Phase 14's whole purpose unreachable: the ladder ran,
   * cost money, and produced no fit.
   *
   * The contamination worry it was guarding against is real but narrow: it
   * applies to the SMALL bucket, where warm production samples already exist.
   * `source: 'calibration'` on the profile records the provenance so a reader
   * can tell measured-from-traffic from measured-on-purpose.
   */
  | 'calibration'
  | 'cold_start'        // first call to this provider this session (or after a long idle)
  | 'network_switch'    // the network profile changed within this turn's lifetime
  | 'app_resumed'       // powerMonitor reported a resume inside this turn
  | 'user_cancelled'    // the user superseded or stopped the turn
  | 'timeout'           // our own deadline fired — see the ratchet note below
  | 'stall'             // the stream went silent mid-answer
  | 'rate_limit'        // 429
  | 'server_error'      // 5xx
  | 'client_error'      // 4xx other than 429
  | 'connection_failure'
  | 'unknown';

/**
 * Does this sample belong in the LATENCY estimators?
 *
 * `timeout` is excluded for the reason `recordAnswerFirstToken` already states
 * in prose: a turn the deadline killed would otherwise teach the budget that
 * this endpoint takes exactly as long as the budget allows, "a feedback loop
 * that can only ratchet upward". `cold_start` is excluded because a cold weight
 * load or a cold container is a real event but not the steady state a deadline
 * should be sized for — it is why the LOCAL route has a 30s constant rather
 * than an adaptive number.
 */
export function isLatencyAdmissible(cls: SampleClass): boolean {
  return cls === 'normal' || cls === 'calibration';
}

/** Does this sample belong in the RELIABILITY counters? */
export function isReliabilitySignal(cls: SampleClass): boolean {
  return cls !== 'user_cancelled';
}

/**
 * A decaying maximum plus the bookkeeping needed to know how much to trust it.
 *
 * DERIVED FROM A MAX, NOT A MEAN — the argument is liveDeadlines.ts's, kept
 * verbatim in spirit: "An EWMA of TTFT lands near p50; a deadline placed there
 * guillotines the tail". `p50Ms` is carried alongside for DIAGNOSTICS only, so
 * a human reading a profile can see the spread; nothing sizes a deadline off it.
 */
export interface LatencyEstimate {
  /** Decaying maximum — what a deadline is sized from. */
  maxMs: number;
  /** Rolling median approximation, for display. Never a deadline. */
  p50Ms: number;
  /** Admissible samples seen. 0 means we know nothing and the prior stands. */
  count: number;
  /**
   * The most recent samples, bounded. Backs TRUE quantiles once there are
   * enough of them — Phase 7's "compute actual quantiles" half, as opposed to
   * the decaying max above, which is the "size a deadline" half.
   *
   * Optional so a v1 profile persisted before this existed still loads: an
   * absent reservoir simply means no quantile can be claimed yet, which is the
   * correct answer for a profile that never collected one.
   */
  samplesMs?: number[];
}

/** Inter-chunk gap statistics — the input to the adaptive stream-idle bound. */
export interface StreamGapEstimate {
  /**
   * Decaying maximum gap between two consecutive chunks on a HEALTHY stream
   * (one that reached `done`). A stream that stalled contributes nothing here,
   * for the same ratchet reason a timed-out turn teaches no TTFT.
   */
  maxGapMs: number;
  /** Rolling median gap. Diagnostics + a sanity floor. */
  p50GapMs: number;
  /** Healthy streams observed. */
  count: number;
}

export interface ReliabilityCounters {
  ok: number;
  timeout: number;
  stall: number;
  rateLimit: number;
  serverError: number;
  clientError: number;
  connectionFailure: number;
  /**
   * TRANSPORT retries folded in from the adapters — a DNS re-resolve, a
   * reconnect — not turn-level regenerations, which are secondary streams and
   * reach no profile at all.
   *
   * A DIAGNOSTIC counter, never a deadline input. It answers "is this endpoint
   * making us work for its answers?", which a success rate alone hides: a
   * provider that succeeds every time on its third attempt looks perfect by
   * `ok`, and feels slow.
   */
  retries: number;
}

export function emptyReliability(): ReliabilityCounters {
  return { ok: 0, timeout: 0, stall: 0, rateLimit: 0, serverError: 0, clientError: 0, connectionFailure: 0, retries: 0 };
}

/** Per-workload evidence. */
export interface WorkloadEvidence {
  ttft: LatencyEstimate;
  /** Total wall clock of a COMPLETED stream. Diagnostics; not a deadline input. */
  total: LatencyEstimate;
  reliability: ReliabilityCounters;
  /**
   * Output tokens per second, measured over the GENERATION window
   * (total − ttft), never over the total — see generationRateTps.
   *
   * ESTIMATED, because no provider in this codebase surfaces a usage count to
   * the streaming caller; the numerator comes from characters yielded. It is
   * good enough for its one job: predicting roughly how long an answer of a
   * given length will take to finish, which is what separates "this provider is
   * slow to START" from "this provider is slow to WRITE".
   */
  generationRate: { tokensPerSecond: number; count: number } | null;
  /**
   * Mean input tokens of the admissible samples in this bucket, so the
   * large-context fit has an x-coordinate rather than assuming the bucket
   * midpoint. `0` when unknown (a route that reports no usage).
   */
  meanInputTokens: number;
}

/**
 * Capability FACTS, copied from the existing registries. Never inferred from
 * latency (Phase 0 rules 16–17), and never used to gate a request in this
 * release — this is a read-only diagnostic view so a user can see WHY a warning
 * appeared. The gates keep the inputs they already have.
 */
export interface CapabilityFacts {
  streaming: boolean;
  vision: boolean | 'unknown';
  tools: boolean | 'unknown';
  structuredOutput: boolean | 'unknown';
  /** Advertised context window in tokens, from modelCapabilities.getModelCapabilities. */
  contextWindowTokens: number;
  /** Where each fact came from, so a wrong one can be traced to its registry. */
  source: 'model_registry' | 'prior' | 'unknown';
}

export type ProfileSource = 'shipped_prior' | 'calibration' | 'production';

/**
 * Confidence in this profile's latency numbers.
 *
 * Phase 7 says not to claim a P95 at n=5, and this is how that is enforced:
 * nothing downstream reads a quantile, and the confidence tier is what selectors
 * consult to decide how far they may move from the shipped default.
 */
export type Confidence = 'none' | 'low' | 'medium' | 'high';

export function confidenceFor(sampleCount: number): Confidence {
  if (sampleCount <= 0) return 'none';
  if (sampleCount < 6) return 'low';
  if (sampleCount < 50) return 'medium';
  return 'high';
}

/**
 * Coefficients of the input-size → TTFT model.
 *
 * ttft ≈ interceptMs + slopeMsPerKToken × (inputTokens / 1000)
 *
 * A straight line, deliberately. Phase 14 warns against assuming linearity, and
 * the honest answer from this data is that we cannot distinguish linear from
 * log-linear with three bucket means — so use the simplest model that fits and
 * carry its error, rather than a curve whose shape is unevidenced. `rmseMs` is
 * what makes the prediction usable: a projection is only allowed to move a
 * deadline when its own error is small relative to the move.
 */
export interface ContextScalingModel {
  interceptMs: number;
  slopeMsPerKToken: number;
  /** Root-mean-square error of the fit, in ms. Higher = trust it less. */
  rmseMs: number;
  /** Distinct workload buckets that contributed. A fit needs at least 2. */
  points: number;
}

/** The profile itself: one provider × model × network. */
export interface ProviderPerformanceProfile {
  /** Schema version — bumped when a field's meaning changes. See MIGRATIONS. */
  version: number;
  providerId: string;
  modelId: string;
  networkProfileId: string;
  /** The route this identity was observed on. A profile never blends routes. */
  route: RouteKind;

  capability: CapabilityFacts;
  workloads: Partial<Record<WorkloadClass, WorkloadEvidence>>;
  /**
   * Time from request start to RESPONSE HEADERS — the connect phase.
   *
   * Profile-level rather than per-workload, deliberately: a TLS handshake and a
   * DNS lookup do not care how many tokens the prompt has, so bucketing it by
   * workload would split one population four ways for no gain.
   *
   * Optional so a profile persisted before this existed still loads.
   */
  connect?: LatencyEstimate;
  /**
   * When `connect` was last written, SEPARATE from `lastUpdated`.
   *
   * Two timestamps because there are two kinds of evidence with different
   * lifetimes, and conflating them was a real defect: `lastUpdated` is what
   * `isStale()` and the eviction sort read, so letting a connect measurement
   * touch it would resurrect a profile holding months-old LATENCY samples and
   * let them size a live deadline — and would let a connect-only row with zero
   * latency samples outrank a 50-sample row in eviction. A handshake time says
   * nothing about how fresh a TTFT population is.
   */
  connectUpdatedAt?: number;
  stream: StreamGapEstimate;
  /** Fit over the workload buckets' (meanInputTokens, ttft.maxMs) points. */
  contextScaling: ContextScalingModel | null;

  source: ProfileSource;
  /** Total admissible latency samples across all workloads. */
  sampleCount: number;
  /** ms since epoch. */
  lastUpdated: number;
  /** ms since epoch of the first sample — for staleness and for the UI. */
  firstObserved: number;
}

export const PROFILE_SCHEMA_VERSION = 1;

/**
 * How long a profile's evidence stays trustworthy.
 *
 * 30 days. A provider's steady-state latency is a property of their
 * infrastructure, which does change — model swaps behind a stable id, region
 * migrations, capacity changes — but not weekly. Past this the profile is not
 * deleted (its reliability history is still worth showing); it stops sizing
 * deadlines and the shipped prior takes over until fresh samples arrive.
 */
export const PROFILE_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function isStale(profile: ProviderPerformanceProfile, now: number = Date.now()): boolean {
  return now - profile.lastUpdated > PROFILE_STALE_AFTER_MS;
}

/**
 * WHERE PHASE 6'S TIMING VOCABULARY LANDS, so a reader can tell what is
 * measured from what is merely named:
 *
 *   connection start / request start  the instant the adapter issues its fetch
 *   first byte                        response headers — `connect`. For an SSE
 *                                     response the headers and the first body
 *                                     bytes arrive together, so these are one
 *                                     measurement, not two
 *   first semantic streaming event    `ttft`, taken by the deadline driver at
 *                                     the first PARSED chunk
 *   inter-chunk gaps                  `stream`
 *   generation duration               total - ttft, the denominator of
 *                                     `generationRate`
 *   total duration                    `total`
 *   input / output tokens             `inputTokens` / `outputTokens`, both
 *                                     ESTIMATED — no provider here reports a
 *                                     usage count to the streaming caller
 *   success / error classification    `sampleClass`
 *   retry count                       `retryCount`
 *
 * NOT measured, and not faked: "first complete token". A stream chunk is not a
 * token — a provider may split one token across two chunks or pack several into
 * one — so the first complete token is not observable at this layer. Reporting
 * the first chunk under that name would be a fiction.
 */

/** One observation, as handed to the store. */
export interface PerformanceSample {
  providerId: string;
  modelId: string;
  networkProfileId: string;
  route: RouteKind;
  workload: WorkloadClass;
  sampleClass: SampleClass;
  /** Time to the first token that actually arrived, ms. Null if none arrived. */
  ttftMs: number | null;
  /** Wall clock to stream end, ms. Null unless the stream completed. */
  totalMs: number | null;
  /** Largest gap between consecutive chunks, ms. Null unless the stream completed. */
  maxGapMs: number | null;
  /** Median gap between consecutive chunks, ms. Null unless the stream completed. */
  p50GapMs: number | null;
  /** Input tokens, when the route reports them. 0 = unknown. */
  inputTokens: number;
  /**
   * Output tokens, ESTIMATED from the characters the stream yielded. 0 =
   * unknown. Named for what it is: no provider here reports a real count to the
   * streaming caller.
   */
  outputTokens: number;
  /** Generation-window rate, when it could be measured. */
  generationRateTps: number | null;
  /** Transport retries attributed to this turn. See ReliabilityCounters.retries. */
  retryCount: number;
}
