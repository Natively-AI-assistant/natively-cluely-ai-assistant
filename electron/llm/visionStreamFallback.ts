/**
 * Vision-flavoured binding of the shared fallback engine.
 *
 * The engine moved to ./streamFallbackEngine.ts when Direct Assist needed the
 * same retry/ladder semantics (see docs/superpowers/specs/
 * 2026-09-08-direct-assist-fallback-design.md). Nothing in it was ever
 * vision-specific — a rung is just `open(signal, attempt)`. This module keeps
 * the vision NAMES and the vision TUNING so every existing call site and test
 * is untouched.
 */
export {
  runStreamingFallback as runStreamingVisionFallback,
  classifyStreamError as classifyVisionError,
  orderByHealth as orderVisionByHealth,
  markHealthy as markVisionHealthy,
  markUnhealthy as markVisionUnhealthy,
  recordTtft as recordVisionTtft,
  closeIteratorBounded,
  openHedged,
  isProviderErrorProse,
  MODEL_GONE_COOLDOWN_MS,
} from './streamFallbackEngine';

export type {
  StreamErrorClass as VisionErrorClass,
  StreamProvider as VisionStreamProvider,
  HealthEntry as VisionHealthEntry,
  FallbackConfig as VisionFallbackConfig,
  FallbackHooks as VisionFallbackHooks,
} from './streamFallbackEngine';

import type { FallbackConfig } from './streamFallbackEngine';
import { MODEL_GONE_COOLDOWN_MS } from './streamFallbackEngine';

export const DEFAULT_VISION_FALLBACK_CONFIG: FallbackConfig = {
  logPrefix: 'Vision',
  maxAttempts: 3,
  // Vision TTFT is slower than text (image encode + multimodal prefill). 8s was
  // too aggressive and aborted healthy first tokens on screenshots — especially
  // multi-screenshot requests. 20s base; per-provider overrides bump Pro higher
  // and the call site scales with image count.
  ttftTimeoutMs: 20_000,
  interChunkTimeoutMs: 15_000,
  authCooldownMs: 300_000,
  transientCooldownMs: 30_000,
  incompatibleCooldownMs: 600_000,
  // A retired model id does not come back. Reusing incompatibleCooldownMs
  // (10 min) would only turn "3 wasted retries per call" into "3 wasted
  // retries every 10 minutes, forever" — the log would still fill and every
  // window would still cost the user latency. Recovery here is a NEW MODEL ID
  // from the version manager (see the onModelGone hook), not the clock.
  modelGoneCooldownMs: MODEL_GONE_COOLDOWN_MS,
  backoffInitialMs: 250,
  backoffMaxMs: 10_000,
  cleanupTimeoutMs: 2_000,
  // Hedging defaults — off unless the caller opts in (and a provider sets hedgeWith).
  hedgeEnabled: false,
  hedgeDelayDefaultMs: 3_000,
  hedgeDelayEmaFactor: 0.6,
  hedgeDelayMinMs: 2_500,
  hedgeDelayMaxMs: 6_000,
};

