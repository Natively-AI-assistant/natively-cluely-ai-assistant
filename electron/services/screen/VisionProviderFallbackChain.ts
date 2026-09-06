// electron/services/screen/VisionProviderFallbackChain.ts
//
// Vision-first provider fallback chain.
//
// Replaces the legacy OCR/vision-mixed routing inside ScreenUnderstandingService.
// This module tries every CONFIGURED vision-capable provider in a safe, low-latency
// order, with hard per-provider timeouts, scope/privacy enforcement, and redacted
// telemetry. The first provider that returns non-empty output wins.
//
// Provider order (vision_first / vision_only):
//   1. Natively API (if configured)
//   2. OpenAI vision (if configured)
//   3. Gemini Flash vision (if configured)
//   4. Claude vision (if configured)
//   5. Gemini Pro vision (if configured)
//   6. Groq Llama-4-Scout vision (if configured)
//   7. Ollama local vision (if configured AND the active Ollama model is vision-capable)
//   8. Codex CLI vision (if enabled AND CLI supports vision)
//   9. Custom cURL provider (only if multimodal=true AND screenshots scope enabled)
//
// Provider order (private_vision): only steps 7–9, and step 9 only if the custom
// provider is flagged local-only.
//
// Telemetry redaction:
//   - We never log image paths, base64 payloads, or full prompts.
//   - We log provider name, model id, ok/skipped/error code, duration.
//   - Errors are classified into safe buckets (timeout, rate_limited, no_vision,
//     provider_error, network, auth_error).

import fs from 'node:fs/promises';
import { ImageOptimizer, OptimizedImage, ProviderHint, getImageOptimizer } from './ImageOptimizer';

// ─── Public types ─────────────────────────────────────────────────────────

export type VisionMode = 'vision_first' | 'vision_only' | 'private_vision';

export type VisionFailureReason =
  | 'no_vision_provider'
  | 'all_vision_failed'
  | 'privacy_blocked'
  | 'scope_blocked'
  | 'provider_timeout';

export type VisionSkipReason =
  | 'not_configured'
  | 'no_vision'
  | 'privacy_blocked'
  | 'scope_blocked'
  | 'rate_limited'
  | 'circuit_open';

export type VisionErrorClass =
  | 'timeout'
  | 'rate_limited'
  | 'auth_error'
  | 'network'
  | 'provider_error'
  | 'no_vision'
  | 'invalid_payload'
  | 'unknown';

export interface VisionProviderAttempt {
  provider: string;
  model?: string;
  ok: boolean;
  skipped?: boolean;
  skipReason?: VisionSkipReason;
  errorClass?: VisionErrorClass;
  durationMs: number;
}

export interface VisionFallbackResult {
  ok: boolean;
  providerUsed?: string;
  modelUsed?: string;
  outputText?: string;
  attempts: VisionProviderAttempt[];
  failureReason?: VisionFailureReason;
  durationMs: number;
}

// What the chain needs to know to try each provider. The chain is intentionally
// decoupled from LLMHelper — callers inject this configuration so tests can
// substitute fake providers without bringing up the whole LLM stack.
export interface VisionProviderConfig {
  id: string;                                     // unique provider id, used in telemetry
  displayName: string;                            // e.g. "Natively API"
  modelId?: string;                               // resolved model id for telemetry
  isLocal: boolean;                               // true for ollama / codex local / approved-local-custom
  isConfigured: boolean;                          // API key / runtime available
  supportsVision: boolean;                        // selected model is vision-capable
  scopeAllowsScreenshots: boolean;                // per-provider data scope check
  timeoutMs?: number;                             // override default 12s
  hint: ProviderHint;                             // used by ImageOptimizer
  /**
   * Provider-specific invocation. Receives an optimized image and the prompt.
   * Returns the raw model output text. Should throw on failure with a message
   * that the chain can classify (network, timeout, rate-limited, auth, etc).
   */
  invoke: (params: VisionInvocationParams) => Promise<string>;
}

export interface VisionInvocationParams {
  optimized: OptimizedImage;
  systemPrompt: string;
  userPrompt: string;
  signal: AbortSignal;
  /**
   * The budget this attempt is being given, in ms — the same value that arms
   * `signal`. Passed explicitly because a provider implementation may hold its
   * OWN inner deadline that would otherwise fire first and make both this
   * number and `signal` decorative. `generateWithNatively` did exactly that: an
   * 8s default written for cheap text calls governed a non-streaming VISION
   * extraction, so the chain's 12s never applied and every screenshot died at
   * 8.0s (31/31 non-cached turns in natively_debug (3).log). A provider that
   * reads this can align its inner bound with the chain's.
   */
  timeoutMs: number;
}

/**
 * Per-rung failure memory, owned by the CALLER so it survives across turns —
 * same shape and the same reason as `runStreamingVisionFallback`'s `health`.
 *
 * Without it this chain had no memory at all: a rung that timed out on every
 * turn was still tried FIRST on every turn. Measured over three consecutive
 * screenshots against a dead gateway, the pre-pass cost 4001 / 4011 / 3959 ms —
 * identical, forever, because nothing recorded that the rung had just failed
 * three times in a row.
 */
export interface VisionRungHealth {
  /** Epoch ms until which this rung is skipped. */
  openUntil: number;
}

export interface RunFallbackParams {
  imagePath: string;
  cacheKey?: string;                              // typically perceptual hash for optimizer cache
  mode: VisionMode;
  providers: VisionProviderConfig[];              // order matters — callers preorder
  systemPrompt: string;
  userPrompt: string;
  optimizer?: ImageOptimizer;
  optimizationProfile?: 'fast' | 'balanced' | 'technical' | 'best';
  perProviderTimeoutMs?: number;                  // default 12_000
  totalDeadlineMs?: number;                       // optional ceiling across all attempts
  /** Caller-owned failure memory; omit to keep the previous memoryless behaviour. */
  health?: Map<string, VisionRungHealth>;
  /** Injectable clock so the cooldown is testable without waiting it out. */
  now?: () => number;
  telemetry?: (event: VisionTelemetryEvent) => void;
}

export type VisionTelemetryEvent =
  | { type: 'vision_attempt'; provider: string; model?: string }
  | { type: 'vision_success'; provider: string; model?: string; durationMs: number }
  | { type: 'vision_fallback'; from: string; to: string }
  | { type: 'vision_skipped'; provider: string; reason: VisionSkipReason }
  | { type: 'vision_failed'; provider: string; errorClass: VisionErrorClass; durationMs: number };

const DEFAULT_PER_PROVIDER_TIMEOUT_MS = 12_000;

/**
 * Largest share of `totalDeadlineMs` one attempt may take while an eligible
 * rung still waits behind it. 0.6 leaves 40% for the rest of the chain — enough
 * that the rung after a dead one gets a real attempt rather than 0ms.
 */
const FIRST_RUNG_BUDGET_SHARE = 0.6;

/**
 * Cooldowns after a failed attempt. Deliberately the same magnitudes as
 * visionStreamFallback's `transientCooldownMs` / `authCooldownMs`, so the two
 * chains cannot form different opinions about the same provider.
 *
 * A bad key or a revoked one will not fix itself in 30s; a timeout or a 503
 * often does.
 */
const RUNG_TRANSIENT_COOLDOWN_MS = 30_000;
const RUNG_AUTH_COOLDOWN_MS = 300_000;

// ─── Implementation ───────────────────────────────────────────────────────

/**
 * Run a vision-provider fallback chain.
 *
 * Behavior:
 *   - Optimizes the image ONCE up front (per provider hint when possible). We
 *     re-encode per provider only if the hint differs in a way that changes the
 *     payload (e.g. Ollama may want a smaller buffer than Claude).
 *   - Tries each configured + vision-capable provider in order.
 *   - Honors privacy/scope:
 *       - private_vision: skip every non-local provider with skipReason='privacy_blocked'.
 *       - scopeAllowsScreenshots=false: skip with skipReason='scope_blocked'.
 *   - Each provider attempt is wrapped in an AbortController with `perProviderTimeoutMs`.
 *   - On the first non-empty success, returns immediately.
 *   - If every provider is skipped, returns failureReason='no_vision_provider'
 *     (or 'privacy_blocked' / 'scope_blocked' when those reasons dominate).
 *   - If providers were attempted but none succeeded, returns 'all_vision_failed'.
 */
export async function runVisionFallback(params: RunFallbackParams): Promise<VisionFallbackResult> {
  const started = Date.now();
  const optimizer = params.optimizer ?? getImageOptimizer();
  const perProviderTimeoutMs = params.perProviderTimeoutMs ?? DEFAULT_PER_PROVIDER_TIMEOUT_MS;
  const totalDeadlineMs = params.totalDeadlineMs;
  const nowMs = params.now ?? Date.now;
  const health = params.health;
  const attempts: VisionProviderAttempt[] = [];

  // Validate source exists once so we don't keep re-statting per provider.
  try {
    await fs.stat(params.imagePath);
  } catch (err: any) {
    return {
      ok: false,
      attempts: [],
      failureReason: 'all_vision_failed',
      durationMs: Date.now() - started,
    };
  }

  // Track skip reasons so we can pick the most specific failureReason later.
  let sawScopeBlocked = false;
  let sawPrivacyBlocked = false;
  let sawAtLeastOneAttempt = false;
  // Tracked separately from the skip flags above: a rung skipped because it is
  // cooling down is a rung that EXISTS and recently failed. Folding it into the
  // others would resolve failureReason to 'no_vision_provider' and tell a user
  // who has a provider configured that they have none — the exact class of
  // misleading message the registry comments keep having to undo.
  let sawCircuitOpen = false;

  for (let i = 0; i < params.providers.length; i++) {
    const provider = params.providers[i];

    // 1. configured check
    if (!provider.isConfigured) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        skipped: true,
        skipReason: 'not_configured',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_skipped', provider: provider.id, reason: 'not_configured' });
      continue;
    }

    // 2. vision capability check
    if (!provider.supportsVision) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        skipped: true,
        skipReason: 'no_vision',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_skipped', provider: provider.id, reason: 'no_vision' });
      continue;
    }

    // 3. scope check (custom-provider screenshots data scope)
    if (!provider.scopeAllowsScreenshots) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        skipped: true,
        skipReason: 'scope_blocked',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_skipped', provider: provider.id, reason: 'scope_blocked' });
      sawScopeBlocked = true;
      continue;
    }

    // 4. privacy check: private_vision forbids any non-local provider
    if (params.mode === 'private_vision' && !provider.isLocal) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        skipped: true,
        skipReason: 'privacy_blocked',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_skipped', provider: provider.id, reason: 'privacy_blocked' });
      sawPrivacyBlocked = true;
      continue;
    }

    // 4b. failure memory: skip a rung that just failed, so a chronically dead
    // one stops charging the user its share of the budget on every turn.
    const entry = health?.get(provider.id);
    if (entry && entry.openUntil > nowMs()) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        skipped: true,
        skipReason: 'circuit_open',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_skipped', provider: provider.id, reason: 'circuit_open' });
      sawCircuitOpen = true;
      continue;
    }

    // 5. total-deadline check
    if (totalDeadlineMs && Date.now() - started > totalDeadlineMs) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        errorClass: 'timeout',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_failed', provider: provider.id, errorClass: 'timeout', durationMs: 0 });
      break;
    }

    // 6. optimize for this provider hint
    let optimized: OptimizedImage;
    try {
      optimized = await optimizer.optimize(params.imagePath, {
        profile: params.optimizationProfile || 'balanced',
        provider: provider.hint,
        cacheKey: params.cacheKey,
      });
    } catch (err: any) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        errorClass: 'invalid_payload',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_failed', provider: provider.id, errorClass: 'invalid_payload', durationMs: 0 });
      continue;
    }

    // 7. invoke with timeout
    sawAtLeastOneAttempt = true;
    params.telemetry?.({ type: 'vision_attempt', provider: provider.id, model: provider.modelId });

    const providerStarted = Date.now();
    const controller = new AbortController();
    // `totalDeadlineMs` used to be checked only BETWEEN rungs (step 5 above),
    // which made it advisory: one slow rung could overrun the whole budget by
    // its full per-provider timeout before anyone looked at the clock. Clamp
    // each attempt to whatever is actually left so the total bound binds.
    const remainingMs = totalDeadlineMs
      ? Math.max(0, totalDeadlineMs - (Date.now() - started))
      : Number.POSITIVE_INFINITY;
    // A total budget alone lets the FIRST rung eat all of it, which starves
    // every rung behind it — and the rung behind is usually the provider the
    // user actually selected. Observed immediately after adding the budget: a
    // dead Natively rung consumed 6000/6000ms and the ledger read
    // `custom:timeout(0ms)`, so the user's own OpenRouter provider was reached
    // and given nothing. That would have quietly cancelled out 3e29a67f, whose
    // whole point was to let the chain reach that rung at all.
    //
    // So while an eligible rung remains behind this one, cap this attempt's
    // share of the budget. Not a health tracker — this is mechanical and has no
    // memory; a chronically-dead leading rung still burns its share on every
    // single turn. Fixing THAT needs failure memory in this chain.
    // The circuit state is part of eligibility. Without it this cap starved a
    // healthy leading rung for the benefit of a rung that step 4b then skipped
    // as circuit_open — the chain gave away 40% of its budget to nobody. The
    // comment above used to end "Fixing THAT needs failure memory in this
    // chain"; the failure memory now exists, so it is consulted here.
    const laterRungEligible = params.providers.slice(i + 1).some(p =>
      p.isConfigured && p.supportsVision && p.scopeAllowsScreenshots
      && (params.mode !== 'private_vision' || p.isLocal)
      && (health?.get(p.id)?.openUntil ?? 0) <= nowMs());
    // No lower floor here: a `Math.max(1000, …)` guard against absurdly small
    // slices made the share EQUAL the whole budget whenever the total was
    // <= ~1.7s, so the cap silently did nothing in exactly the tight cases it
    // exists for. A rung handed a uselessly small slice fails fast, which for a
    // best-effort pre-pass is the correct outcome.
    const shareMs = (totalDeadlineMs && laterRungEligible)
      ? Math.floor(totalDeadlineMs * FIRST_RUNG_BUDGET_SHARE)
      : Number.POSITIVE_INFINITY;
    const timeoutMs = Math.min(provider.timeoutMs ?? perProviderTimeoutMs, remainingMs, shareMs);
    const timer = setTimeout(() => controller.abort(new Error('per-provider-timeout')), timeoutMs);

    try {
      // RACED, not merely awaited (2026-09-06). Of the providers behind
      // runVisionRequest only Natively receives {signal, timeoutMs}; OpenAI,
      // Claude, Groq, LiteLLM, NIM, Gemini and custom ignore both, so the timer
      // above aborted a controller nobody was listening to and this await kept
      // waiting on the provider's own timeout, or forever. The budget was
      // non-binding on every cloud rung but one. The abort now rejects this
      // await directly; the orphaned request finishes in the background and
      // its late result is discarded.
      const invocation = provider.invoke({
        optimized,
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        signal: controller.signal,
        timeoutMs,
      });
      invocation.catch(() => { /* late failure of an orphaned attempt: already accounted for */ });
      const output = await Promise.race([
        invocation,
        new Promise<never>((_, reject) => {
          if (controller.signal.aborted) { reject(controller.signal.reason ?? new Error('per-provider-timeout')); return; }
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('per-provider-timeout')), { once: true });
        }),
      ]);
      clearTimeout(timer);
      const durationMs = Date.now() - providerStarted;

      if (typeof output === 'string' && output.trim().length > 0) {
        attempts.push({
          provider: provider.id,
          model: provider.modelId,
          ok: true,
          durationMs,
        });
        params.telemetry?.({ type: 'vision_success', provider: provider.id, model: provider.modelId, durationMs });
        health?.delete(provider.id);
        return {
          ok: true,
          providerUsed: provider.id,
          modelUsed: provider.modelId,
          outputText: output,
          attempts,
          durationMs: Date.now() - started,
        };
      }

      // Empty output → treat as provider error and continue.
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        errorClass: 'provider_error',
        durationMs,
      });
      params.telemetry?.({ type: 'vision_failed', provider: provider.id, errorClass: 'provider_error', durationMs });
      noteRungFailure(health, provider.id, 'provider_error', nowMs);
      if (i < params.providers.length - 1) {
        const next = params.providers[i + 1];
        params.telemetry?.({ type: 'vision_fallback', from: provider.id, to: next.id });
      }
    } catch (err: any) {
      clearTimeout(timer);
      const durationMs = Date.now() - providerStarted;
      const errorClass = classifyError(err, controller.signal.aborted);
      // Was the deadline that fired the provider's own, or one WE imposed? When
      // shareMs (the 60% cap that exists to leave room for a later rung) or the
      // chain's remaining time is what cut the attempt short, a resulting
      // 'timeout' says nothing about the provider's health — it says we did not
      // give it enough time. Cooling it for RUNG_TRANSIENT_COOLDOWN_MS on that
      // basis disables the leading rung that would have answered inside the
      // full budget, which is the opposite of what the cap is for.
      const selfInflictedTimeout = errorClass === 'timeout'
        && timeoutMs < (provider.timeoutMs ?? perProviderTimeoutMs);
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        errorClass,
        durationMs,
      });
      params.telemetry?.({ type: 'vision_failed', provider: provider.id, errorClass, durationMs });
      if (!selfInflictedTimeout) noteRungFailure(health, provider.id, errorClass, nowMs);
      if (i < params.providers.length - 1) {
        const next = params.providers[i + 1];
        params.telemetry?.({ type: 'vision_fallback', from: provider.id, to: next.id });
      }
    }
  }

  // No provider succeeded. Pick the most specific failure reason.
  let failureReason: VisionFailureReason;
  if (sawAtLeastOneAttempt || sawCircuitOpen) {
    failureReason = 'all_vision_failed';
  } else if (params.mode === 'private_vision' && sawPrivacyBlocked && !sawScopeBlocked) {
    failureReason = 'privacy_blocked';
  } else if (sawScopeBlocked && !sawPrivacyBlocked) {
    failureReason = 'scope_blocked';
  } else {
    failureReason = 'no_vision_provider';
  }

  return {
    ok: false,
    attempts,
    failureReason,
    durationMs: Date.now() - started,
  };
}

// Map a raw error onto one of our redacted error classes. No message bodies are
// exposed to telemetry — only the class.
/**
 * Open this rung's circuit for a cooldown proportional to how recoverable the
 * failure looks. `invalid_payload` and `no_vision` are deliberately NOT cooled
 * down: they are properties of THIS request (an oversized image, a model that
 * cannot take one), not of the provider, so the next turn deserves a fresh try.
 */
function noteRungFailure(
  health: Map<string, VisionRungHealth> | undefined,
  id: string,
  errorClass: VisionErrorClass,
  now: () => number,
): void {
  if (!health) return;
  if (errorClass === 'invalid_payload' || errorClass === 'no_vision') return;
  const cooldown = errorClass === 'auth_error' ? RUNG_AUTH_COOLDOWN_MS : RUNG_TRANSIENT_COOLDOWN_MS;
  health.set(id, { openUntil: now() + cooldown });
}

function classifyError(err: any, aborted: boolean): VisionErrorClass {
  if (aborted) return 'timeout';
  const msg = String(err?.message || err || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('aborted') || msg.includes('etimedout')) return 'timeout';
  if (msg.includes('429') || msg.includes('rate') || msg.includes('quota')) return 'rate_limited';
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('api key') || msg.includes('invalid_api')) return 'auth_error';
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network') || msg.includes('fetch failed')) return 'network';
  if (msg.includes('does not support') || msg.includes('no vision') || msg.includes('image not supported')) return 'no_vision';
  if (msg.includes('payload') || msg.includes('too large') || msg.includes('413')) return 'invalid_payload';
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return 'provider_error';
  return 'unknown';
}
