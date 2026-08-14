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
  | 'rate_limited';

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
  telemetry?: (event: VisionTelemetryEvent) => void;
}

export type VisionTelemetryEvent =
  | { type: 'vision_attempt'; provider: string; model?: string }
  | { type: 'vision_success'; provider: string; model?: string; durationMs: number }
  | { type: 'vision_fallback'; from: string; to: string }
  | { type: 'vision_skipped'; provider: string; reason: VisionSkipReason }
  | { type: 'vision_failed'; provider: string; errorClass: VisionErrorClass; durationMs: number };

const DEFAULT_PER_PROVIDER_TIMEOUT_MS = 12_000;

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
    const timeoutMs = provider.timeoutMs ?? perProviderTimeoutMs;
    const timer = setTimeout(() => controller.abort(new Error('per-provider-timeout')), timeoutMs);

    try {
      const output = await provider.invoke({
        optimized,
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        signal: controller.signal,
      });
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
      if (i < params.providers.length - 1) {
        const next = params.providers[i + 1];
        params.telemetry?.({ type: 'vision_fallback', from: provider.id, to: next.id });
      }
    } catch (err: any) {
      clearTimeout(timer);
      const durationMs = Date.now() - providerStarted;
      const errorClass = classifyError(err, controller.signal.aborted);
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        errorClass,
        durationMs,
      });
      params.telemetry?.({ type: 'vision_failed', provider: provider.id, errorClass, durationMs });
      if (i < params.providers.length - 1) {
        const next = params.providers[i + 1];
        params.telemetry?.({ type: 'vision_fallback', from: provider.id, to: next.id });
      }
    }
  }

  // No provider succeeded. Pick the most specific failure reason.
  let failureReason: VisionFailureReason;
  if (sawAtLeastOneAttempt) {
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
