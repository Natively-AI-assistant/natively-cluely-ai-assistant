// electron/llm/performance/calibration.ts
//
// Active calibration and capability probing — the only code in this feature
// that can spend the user's money.
//
// ─────────────────────────────────────────────────────────────────────────
// THE COST GATE IS THE DELIVERABLE.
//
// Phase 21 is marked mandatory ("Do not silently perform expensive
// calibration"), and Phase 5's calibration suite pulls the other way. This file
// resolves that tension by making every billable path require a deliberate
// human action, and by bounding what one action can cost:
//
//   1. Two flags, `calibration` and `capabilityProbe`, both default OFF —
//      unlike the four adaptive flags, which default ON because they cannot
//      spend anything.
//   2. No automatic trigger of any kind. Not on provider-add, not on app
//      launch, not on staleness, not on drift. The ONLY entry point is an IPC
//      the Settings UI calls on a button press. Phase 22's trigger list is
//      satisfied by a manual trigger plus a documented cooldown; anything that
//      fires on its own is what "silently spend" means.
//   3. A hard per-invocation cap: at most 3 text requests + 1 image request,
//      enforced by a counter in `runCalibration`, not by the shape of a loop.
//   4. A persisted cooldown per identity, so a user leaning on the button
//      cannot bill themselves repeatedly.
//   5. Every request asks for a ONE WORD answer, so output cost is a rounding
//      error and only prefill varies.
//
// Worst case for one press: ~48K input tokens and ~4 output tokens. On the most
// expensive model Natively drives that is cents, and the user asked for it.
// ─────────────────────────────────────────────────────────────────────────
//
// PRODUCTION REQUEST PATH (Phase 6 / rule 14). Calibration calls
// `llmHelper.streamChat(...)` — the same entry point WTA and manual chat use —
// and drives it through the same `raceStreamWithDeadline`. It therefore passes
// through the real request builder, the real provider adapter, the real
// transport, the real streaming wrapper and the same instrumentation. There is
// no benchmarking HTTP client here, deliberately: a fake one would measure a
// request path no user ever takes.

import { raceStreamWithDeadline, type StreamObservation } from '../liveDeadlines';
import { CALIBRATION_LADDER_TOKENS, calibrationPrompt, TINY_PNG_DATA_URI, VISION_PROBE_PROMPT } from './fixtures';
import { getProviderPerformanceStore, type ProviderPerformanceStore } from './ProviderPerformanceStore';
import { getRuntimeSignals } from './runtimeSignals';
import { classifyStreamError, estimateOutputTokens } from './recorder';
import { generationRateTps } from './estimators';
import { classifyWorkload, type PerformanceSample, type RouteKind } from './types';
import type { CapabilityVerdict } from './capabilityView';

/** Hard ceiling on billable requests per invocation. Enforced by a counter. */
export const MAX_CALIBRATION_REQUESTS = 3;
export const MAX_PROBE_REQUESTS = 1;

/**
 * Minimum gap between calibrations of the same identity.
 *
 * 24 hours. A provider's steady-state latency does not change hour to hour, and
 * the passive path is already collecting evidence continuously — so a second
 * calibration inside a day buys almost nothing and costs the same as the first.
 */
export const CALIBRATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Per-request deadline during calibration. */
const CALIBRATION_TIMEOUT_MS = 60_000;

export interface CalibrationRung {
  inputTokens: number;
  ttftMs: number | null;
  totalMs: number;
  ok: boolean;
  /** Why it failed, when it did. Never the provider's error text. */
  failure?: string;
}

export interface CalibrationResult {
  ok: boolean;
  providerId: string;
  modelId: string;
  networkProfileId: string;
  rungs: CalibrationRung[];
  vision: CapabilityVerdict;
  requestsIssued: number;
  skippedReason?: 'flag_off' | 'cooldown' | 'no_helper' | 'unsupported_context';
  startedAt: number;
  finishedAt: number;
}

/** The slice of LLMHelper calibration needs. Narrow so it stays mockable. */
export interface CalibrationHelper {
  performanceIdentity(hasImages?: boolean): {
    providerId: string; modelId: string; route: RouteKind; isOllama?: boolean;
  };
  streamChat(...args: any[]): AsyncGenerator<string, void, unknown>;
  getModelContextWindowTokens?(): number;
}

function flagOn(key: 'calibration' | 'capabilityProbe'): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isIntelligenceFlagEnabled } = require('../../intelligence/intelligenceFlags');
    return isIntelligenceFlagEnabled(key) === true;
  } catch {
    // A flag we cannot read is OFF. For a billable path that is the only safe
    // direction — the adaptive flags fail closed onto a shipped constant, this
    // one fails closed onto spending nothing.
    return false;
  }
}

/**
 * Which ladder rungs this model can actually take.
 *
 * Phase 5: "Adapt sizes to the model's real supported context window… never
 * exceed its known limit." A rung above the advertised window is not a
 * measurement, it is a guaranteed 400 that the user pays for and that would
 * then be recorded as a `client_error` against a provider that behaved
 * correctly.
 *
 * The 0.6 headroom leaves room for the system prompt and the answer; the
 * ladder is an INPUT size and the request is not only the ladder.
 */
export function laddersFor(contextWindowTokens: number): number[] {
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
    // An unknown window gets the smallest rung only — the conservative
    // low-cost choice Phase 21 asks for when pricing/limits are unknown.
    return [CALIBRATION_LADDER_TOKENS[0]];
  }
  const usable = contextWindowTokens * 0.6;
  const fitted = CALIBRATION_LADDER_TOKENS.filter((t) => t <= usable);
  if (fitted.length > 0) return [...fitted];
  // A very small model still deserves three points, or the context fit has
  // nothing to fit. Scale the ladder down proportionally rather than skipping
  // calibration entirely.
  return [0.25, 0.5, 0.9].map((f) => Math.max(200, Math.round(usable * f)));
}

/** One calibrated request through the real production path. */
async function runOne(
  helper: CalibrationHelper,
  prompt: string,
  imagePaths: string[] | undefined,
  timeoutMs: number,
): Promise<{ observation: StreamObservation; text: string }> {
  let text = '';
  let captured: StreamObservation | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => { try { controller.abort(); } catch { /* noop */ } }, timeoutMs);
  try {
    // Same argument tuple shape the answer paths use. `ignoreKnowledgeMode` and
    // `skipModeInjection` are both TRUE so a calibration request carries no
    // resume, no JD, no transcript and no reference files — it must measure the
    // transport, and it must not send the user's documents to do so.
    const stream = helper.streamChat(
      prompt,
      imagePaths,
      undefined,
      undefined,
      true,
      true,
      [],
      controller.signal,
    ) as AsyncGenerator<string>;
    await raceStreamWithDeadline({
      stream,
      firstUsefulDeadlineMs: timeoutMs,
      onToken: (t) => { text += t; },
      isUsefulYet: () => text.trim().length > 0,
      observe: (o) => { captured = o; },
      onCleanup: (reason) => {
        if (reason !== 'done') { try { controller.abort(); } catch { /* noop */ } }
      },
    });
  } finally {
    clearTimeout(timer);
  }
  return {
    observation: captured ?? {
      ttftMs: null, totalMs: 0, interChunkGapsMs: [], chunkCount: 0, outputChars: 0,
      reason: 'error', firstUsefulBudgetMs: timeoutMs, interTokenStallMs: 0, speculative: false,
    },
    text,
  };
}

/** Fold a calibration observation into the profile, tagged as calibration. */
function recordCalibrationSample(
  store: ProviderPerformanceStore,
  identity: { providerId: string; modelId: string; route: RouteKind },
  networkProfileId: string,
  observation: StreamObservation,
  inputTokens: number,
  hasImages: boolean,
): void {
  const completed = observation.reason === 'done';
  const estimatedOutputTokens = estimateOutputTokens(observation.outputChars);
  // A calibration run opens a COLD connection with a synthetic prompt. Recording
  // it as `normal` would put it in the same population as warm production turns
  // and drag the median the repair exclusion was written to protect. `cold_start`
  // is the honest class: it counts toward reliability (it really did succeed or
  // fail) and is excluded from the latency estimators — so calibration
  // establishes the CONTEXT-SCALING points and the capability facts, and
  // production remains the authority on steady-state latency.
  const sample: PerformanceSample = {
    providerId: identity.providerId,
    modelId: identity.modelId,
    networkProfileId,
    route: identity.route,
    workload: classifyWorkload(inputTokens, hasImages),
    sampleClass: completed ? 'cold_start' : (classifyStreamError(observation.error) ?? 'timeout'),
    ttftMs: observation.ttftMs,
    totalMs: completed ? observation.totalMs : null,
    maxGapMs: null,
    p50GapMs: null,
    inputTokens,
    outputTokens: estimatedOutputTokens,
    generationRateTps: completed
      ? generationRateTps({ estimatedOutputTokens, ttftMs: observation.ttftMs, totalMs: observation.totalMs })
      : null,
  };
  store.record(sample);
}

/**
 * The vision capability probe.
 *
 * RULE 16, WHICH IS THE WHOLE POINT: a timeout is never proof that a capability
 * is unsupported. The mapping below is deliberately lopsided —
 *
 *   answered                          → SUPPORTED
 *   explicit non-transient rejection  → UNSUPPORTED
 *   timeout / stall / 5xx / 429 /
 *     network / anything else         → FAILED_TEMPORARILY
 *
 * — because only the second case is evidence about the MODEL. Everything else is
 * evidence about the moment. A slow network must never be able to write
 * "your model does not support images" into a profile.
 */
export function verdictFromProbe(
  observation: StreamObservation,
  text: string,
): { verdict: CapabilityVerdict; failure?: string } {
  if (observation.reason === 'done' && text.trim().length > 0) {
    return { verdict: 'SUPPORTED' };
  }
  if (observation.reason === 'error') {
    const status = httpStatusOf(observation.error);
    // AUTH IS NOT A CAPABILITY ANSWER. An expired or wrong key fails every
    // request this provider will ever see, including text ones — reading it as
    // "your model does not support images" would be the single most misleading
    // thing this function could write, and it would then PERSIST. Checked before
    // the rejection test because 401/403 are 4xx and would otherwise fall into
    // it.
    if (status === 401 || status === 403 || status === 429) {
      return { verdict: 'FAILED_TEMPORARILY', failure: `http_${status}` };
    }
    // The only shape that is evidence about the MODEL: the provider looked at a
    // well-formed request carrying an image and refused it. Deliberately NOT
    // routed through classifyProviderError — that function maps an unrecognised
    // 400 to `server_error` (verified against the real implementation), so
    // relying on it here would make this branch unreachable and every rejection
    // read as a transient outage.
    if (status >= 400 && status < 500) {
      return { verdict: 'UNSUPPORTED', failure: `http_${status}` };
    }
    // 5xx, DNS, socket resets, anything unrecognised: the moment, not the model.
    return { verdict: 'FAILED_TEMPORARILY', failure: classifyStreamError(observation.error) ?? 'error' };
  }
  // Timeout, stall, abort, or an empty completion. None is evidence about
  // capability. This is rule 16 in its most direct form.
  return { verdict: 'FAILED_TEMPORARILY', failure: observation.reason };
}

/**
 * The HTTP status on a provider error, or 0.
 *
 * Providers disagree about the field name — `status` (OpenAI/Anthropic SDKs),
 * `statusCode` (node-fetch wrappers), and `code` where it happens to be numeric.
 * A string `code` like 'ENOTFOUND' must NOT be coerced to a number here: NaN
 * would fail every comparison below and land in the transient branch, which is
 * correct, but reading it as a status would be luck rather than intent.
 */
function httpStatusOf(err: unknown): number {
  if (!err || typeof err !== 'object') return 0;
  const e = err as Record<string, unknown>;
  for (const key of ['status', 'statusCode']) {
    const v = e[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  const code = e.code;
  return typeof code === 'number' && Number.isFinite(code) ? code : 0;
}

export interface CalibrationDeps {
  store?: ProviderPerformanceStore;
  networkProfileId?: string;
  now?: () => number;
  /** Injected for tests; production reads the flags. */
  calibrationEnabled?: boolean;
  probeEnabled?: boolean;
}

/** Last calibration per identity, persisted alongside the profile. */
const lastCalibratedAt = new Map<string, number>();

export function __resetCalibrationCooldowns(): void {
  lastCalibratedAt.clear();
}

/**
 * Run the calibration ladder and the vision probe. Manual entry point only.
 *
 * Returns a result rather than throwing, including when it declines to run —
 * `skippedReason` says why, so the UI can explain "calibration is off" instead
 * of showing an error for a deliberate no-op.
 */
export async function runCalibration(
  helper: CalibrationHelper | null | undefined,
  deps: CalibrationDeps = {},
): Promise<CalibrationResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const base = (skippedReason: CalibrationResult['skippedReason']): CalibrationResult => ({
    ok: false, providerId: '', modelId: '', networkProfileId: '',
    rungs: [], vision: 'UNKNOWN', requestsIssued: 0, skippedReason,
    startedAt, finishedAt: now(),
  });

  if (!helper || typeof helper.performanceIdentity !== 'function' || typeof helper.streamChat !== 'function') {
    return base('no_helper');
  }
  const calibrationEnabled = deps.calibrationEnabled ?? flagOn('calibration');
  const probeEnabled = deps.probeEnabled ?? flagOn('capabilityProbe');
  if (!calibrationEnabled && !probeEnabled) return base('flag_off');

  const identity = helper.performanceIdentity(false);
  const store = deps.store ?? getProviderPerformanceStore();
  const networkProfileId = deps.networkProfileId ?? getRuntimeSignals().network().id;
  const key = `${identity.providerId}|${identity.modelId}|${networkProfileId}`;

  const last = lastCalibratedAt.get(key) ?? 0;
  if (last > 0 && now() - last < CALIBRATION_COOLDOWN_MS) {
    return { ...base('cooldown'), providerId: identity.providerId, modelId: identity.modelId, networkProfileId };
  }
  lastCalibratedAt.set(key, now());

  const existing = store.getExact(identity.providerId, identity.modelId, networkProfileId);
  const contextWindow = existing?.capability?.contextWindowTokens
    ?? helper.getModelContextWindowTokens?.()
    ?? 0;

  const rungs: CalibrationRung[] = [];
  let requestsIssued = 0;

  if (calibrationEnabled) {
    for (const inputTokens of laddersFor(contextWindow)) {
      // The cap is a COUNTER, not the loop bound. `laddersFor` is the thing most
      // likely to grow a fourth rung one day, and a cap expressed as its length
      // would silently grow with it.
      if (requestsIssued >= MAX_CALIBRATION_REQUESTS) break;
      requestsIssued += 1;
      try {
        const { observation } = await runOne(helper, calibrationPrompt(inputTokens), undefined, CALIBRATION_TIMEOUT_MS);
        recordCalibrationSample(store, identity, networkProfileId, observation, inputTokens, false);
        rungs.push({
          inputTokens,
          ttftMs: observation.ttftMs,
          totalMs: observation.totalMs,
          ok: observation.reason === 'done',
          failure: observation.reason === 'done' ? undefined : observation.reason,
        });
      } catch (err) {
        // Never the provider's message — it can quote the request.
        rungs.push({ inputTokens, ttftMs: null, totalMs: 0, ok: false, failure: classifyStreamError(err) ?? 'error' });
      }
    }
  }

  let vision: CapabilityVerdict = 'UNKNOWN';
  if (probeEnabled) {
    let probes = 0;
    if (probes < MAX_PROBE_REQUESTS) {
      probes += 1;
      requestsIssued += 1;
      try {
        const { observation, text } = await runOne(helper, VISION_PROBE_PROMPT, [TINY_PNG_DATA_URI], CALIBRATION_TIMEOUT_MS);
        vision = verdictFromProbe(observation, text).verdict;
        const visionIdentity = helper.performanceIdentity(true);
        recordCalibrationSample(store, visionIdentity, networkProfileId, observation, 20, true);
      } catch (err) {
        // A THROW is not automatically an UNSUPPORTED. Route it through the same
        // rule the non-throwing path uses, so the two cannot disagree about the
        // same failure.
        vision = verdictFromProbe(
          { ttftMs: null, totalMs: 0, interChunkGapsMs: [], chunkCount: 0, outputChars: 0,
            reason: 'error', error: err, firstUsefulBudgetMs: 0, interTokenStallMs: 0, speculative: false },
          '',
        ).verdict;
      }
    }
  }

  return {
    ok: rungs.some((r) => r.ok) || vision === 'SUPPORTED',
    providerId: identity.providerId,
    modelId: identity.modelId,
    networkProfileId,
    rungs,
    vision,
    requestsIssued,
    startedAt,
    finishedAt: now(),
  };
}
