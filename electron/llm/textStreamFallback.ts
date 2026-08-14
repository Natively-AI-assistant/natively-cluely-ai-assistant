// electron/llm/textStreamFallback.ts
//
// Text-streaming provider fallback — the text-path twin of the vision fallback.
//
// PROBLEM (REPORT_TO_CHATGPT §21, hypothesis L1 + §18 "why the app feels like
// 10s"): the text streaming path (`LLMHelper._streamChatInner`) used a plain
// serial loop — try Natively, on THROW try Groq, on THROW try Gemini. The
// catch only fires on a thrown error; a provider that *connects* but then
// stalls before the first token blocks the user with no fallback. Worse, the
// Natively connect timeout was 10_000ms and only guarded the connect phase, so
// a slow prefill could wait the full budget before anyone saw a token.
//
// FIX: reuse the already-unit-tested commit-point state machine from
// visionStreamFallback (it is SDK/Electron-free and provider-agnostic — the
// "Vision" naming is historical). Each provider is opened but NOT forwarded
// until its first content token races a short TTFT timeout; the first provider
// to actually produce a token WINS and we commit to it. A stalled or erroring
// primary fails over to the next provider in ~ttftTimeoutMs instead of up to
// 10s. Post-commit failures never switch providers (would duplicate output).
//
// This module owns ONLY text-tuned config + a tiny re-export so LLMHelper can
// build a concrete text-provider list and delegate. No behavior of the vision
// path changes.

import {
  runStreamingVisionFallback,
  orderVisionByHealth,
  type VisionStreamProvider,
  type VisionHealthEntry,
  type VisionFallbackConfig,
  type VisionFallbackHooks,
} from './visionStreamFallback';

/** A text provider attempt. Same shape as the vision engine expects. */
export type TextStreamProvider = VisionStreamProvider;
export type TextHealthEntry = VisionHealthEntry;
export type TextFallbackHooks = VisionFallbackHooks;

/**
 * Text-tuned fallback config. Text first-token is far faster than vision
 * prefill, so the TTFT budget is much tighter — a healthy text provider emits
 * its first token well under 2.5s; beyond that we'd rather race the next
 * provider than keep the user waiting. interChunkTimeout stays generous so a
 * long, correct answer mid-stream is never cut off.
 *
 *   ttftTimeoutMs: 2_500   — primary must produce a token in 2.5s or we fail over
 *   interChunkTimeoutMs: 20_000 — only abort a committed stream if it goes silent 20s
 *   maxAttempts: 2         — per provider (tier retry); the chain has many providers
 */
export const DEFAULT_TEXT_FALLBACK_CONFIG: VisionFallbackConfig = {
  maxAttempts: 2,
  ttftTimeoutMs: 2_500,
  interChunkTimeoutMs: 20_000,
  authCooldownMs: 300_000,
  transientCooldownMs: 30_000,
  incompatibleCooldownMs: 600_000,
  backoffInitialMs: 200,
  backoffMaxMs: 4_000,
  cleanupTimeoutMs: 2_000,
  // Text never hedges (it's already fast: 2.5s TTFT budget). Fields present to
  // satisfy the shared VisionFallbackConfig type.
  hedgeEnabled: false,
  hedgeDelayDefaultMs: 3_000,
  hedgeDelayEmaFactor: 0.6,
  hedgeDelayMinMs: 2_500,
  hedgeDelayMaxMs: 6_000,
};

/** Re-export the health-ordering helper under a text-flavored name. */
export const orderTextByHealth = orderVisionByHealth;

/**
 * Run the text-provider fallback chain. Thin wrapper over the shared engine so
 * callers read as "text" while reusing the proven orchestration. `onWinner` (in
 * hooks) is not part of the engine; callers that want race-winner telemetry
 * should wrap each provider's `open` to record TTFT, or read the health map.
 */
export async function* runStreamingTextFallback(
  orderedProviders: TextStreamProvider[],
  health: Map<string, TextHealthEntry>,
  cfg: VisionFallbackConfig = DEFAULT_TEXT_FALLBACK_CONFIG,
  hooks: TextFallbackHooks = {},
  abortSignal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  yield* runStreamingVisionFallback(orderedProviders, cfg, health, hooks, abortSignal);
}
