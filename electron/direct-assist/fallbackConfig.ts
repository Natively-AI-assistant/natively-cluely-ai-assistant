import type { FallbackConfig } from '../llm/streamFallbackEngine';
import { MODEL_GONE_COOLDOWN_MS } from '../llm/streamFallbackEngine';

/**
 * Whole-ladder ceiling.
 *
 * WHY THIS EXISTS. DirectAssistService re-arms its 45s idle watchdog per
 * ATTEMPT, which is correct — one budget spanning every attempt would let the
 * first rung eat the whole allowance. But per-attempt arming with no outer
 * ceiling is the opposite failure: rungs x attempts x 45s plus backoff is
 * minutes of silence on a request someone is waiting on live. The live path
 * never had this problem because LIVE_TOTAL_HARD_TIMEOUT_MS caps the turn from
 * outside (electron/llm/liveDeadlines.ts:127); Direct Assist has no equivalent,
 * and until now the single idle watchdog WAS its ceiling.
 *
 * 90s == two full idle windows: enough for a selected provider to fail slowly
 * and one fallback to answer, and short enough to still be a bounded wait.
 * Checked BEFORE a rung is opened, so an exhausted budget ends the ladder
 * rather than starting a rung that cannot finish inside it.
 */
export const DIRECT_ASSIST_TOTAL_BUDGET_MS = 90_000;

/** The selected provider is the one the user asked for — try it hardest. */
export const DIRECT_ASSIST_SELECTED_MAX_ATTEMPTS = 3;

/**
 * Fallback rungs get fewer. Three attempts against a rate-limited fallback
 * spends backoff to reach a provider that is already known to be second
 * choice; two reaches a WORKING provider sooner.
 */
export const DIRECT_ASSIST_FALLBACK_MAX_ATTEMPTS = 2;

/**
 * Direct Assist's own engine tuning, deliberately NOT the vision config.
 *
 * The connect budgets are already enforced inside the adapters
 * (DIRECT_ASSIST_CONNECT_TIMEOUT_MS 15s / DIRECT_ASSIST_VISION_CONNECT_TIMEOUT_MS
 * 30s, LLMHelper.ts:193-194), so ttftTimeoutMs here is the outer guard for a
 * provider that connects and then says nothing.
 */
export const DEFAULT_DIRECT_ASSIST_FALLBACK_CONFIG: FallbackConfig = {
  logPrefix: 'DirectAssist',
  maxAttempts: DIRECT_ASSIST_SELECTED_MAX_ATTEMPTS,
  ttftTimeoutMs: 35_000,
  interChunkTimeoutMs: 15_000,
  authCooldownMs: 300_000,
  transientCooldownMs: 30_000,
  incompatibleCooldownMs: 600_000,
  modelGoneCooldownMs: MODEL_GONE_COOLDOWN_MS,
  backoffInitialMs: 250,
  backoffMaxMs: 4_000,
  cleanupTimeoutMs: 2_000,
  // See the spec's non-goals: hedging bills two providers to shave tail
  // latency, which is the wrong trade on a determinism-first path.
  hedgeEnabled: false,
  hedgeDelayDefaultMs: 3_000,
  hedgeDelayEmaFactor: 0.6,
  hedgeDelayMinMs: 2_500,
  hedgeDelayMaxMs: 6_000,
};
