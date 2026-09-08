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
 * 90s == two full idle windows. Worst realistic case with
 * DIRECT_ASSIST_SELECTED_MAX_ATTEMPTS = 2: a vision selection burns 2 x 30s on
 * the adapter's connect ceiling, leaving 30s for a fallback rung to answer.
 * Short enough to still be a bounded wait.
 *
 * Checked BEFORE a rung is opened, against elapsed time PLUS
 * DIRECT_ASSIST_MIN_VIABLE_TTFT_MS, not elapsed alone. Elapsed-alone would let
 * a rung open with, say, 100ms left on the clock — provably unable to reach a
 * first token before the ceiling — and the ladder would sit silent until
 * whichever guard fires next, which defeats the point of a ceiling that is
 * supposed to end the ladder promptly.
 *
 * That margin is MIN_VIABLE_TTFT (a realistic floor, ~5s), deliberately NOT a
 * rung's full configured ttftTimeoutMs (35s). Checking against the full
 * ttftTimeoutMs was tried first and rejected: at the worst-case point two
 * paragraphs up — elapsed ~60s after 2 x 30s on the selected rung — 60s + 35s
 * exceeds 90s, so that check would refuse the very fallback rung this budget
 * exists to let open, making the feature inert for precisely the vision-selection
 * case DIRECT_ASSIST_SELECTED_MAX_ATTEMPTS's comment describes. A healthy
 * provider's first token lands in 2-5s (same comment), so a rung with at least
 * MIN_VIABLE_TTFT of budget left can plausibly still answer; a rung with less
 * cannot, and only that second case is what the ceiling refuses to open.
 */
export const DIRECT_ASSIST_TOTAL_BUDGET_MS = 90_000;

/**
 * The realistic floor on "can this rung plausibly still answer", used by
 * DIRECT_ASSIST_TOTAL_BUDGET_MS's pre-open check — see that constant's
 * comment for why this is a small floor and not a rung's full ttftTimeoutMs.
 * ~5s, the upper end of "a healthy provider's first token is 2-5s" (see
 * DIRECT_ASSIST_SELECTED_MAX_ATTEMPTS's comment): below this, opening a rung
 * is not offering it a real chance, so the budget refuses rather than opening
 * something that would almost certainly still time out.
 */
export const DIRECT_ASSIST_MIN_VIABLE_TTFT_MS = 5_000;

/**
 * Attempts on the SELECTED provider before the ladder moves on.
 *
 * TWO, not three, and the budget is why. The adapters' own connect ceilings
 * are 15s (text) and 30s (vision) — LLMHelper.ts:193-194 — so three attempts
 * on a failing VISION selection would burn 3 x 30s = 90s, which is the entire
 * DIRECT_ASSIST_TOTAL_BUDGET_MS. The ladder would exhaust its budget inside
 * the selected rung and never open a fallback at all, leaving this feature
 * inert for precisely the case it was built for: a screenshot turn whose
 * provider times out. At two, the worst vision case is 60s and a fallback rung
 * still has 30s to answer in — a healthy provider's first token is 2-5s.
 *
 * Raising the budget instead was rejected: 90s of silence is already a long
 * wait, and a third attempt on a provider that has failed twice is worth less
 * than a first attempt on one that has not.
 */
export const DIRECT_ASSIST_SELECTED_MAX_ATTEMPTS = 2;

/**
 * ONE attempt per fallback rung: breadth, not depth.
 *
 * Once the user's chosen provider has failed twice, the goal stops being "make
 * this provider work" and becomes "find ANY provider that answers". Within the
 * ~30s the budget has left after a failing vision selection, one attempt each
 * across three different providers is a far better bet than two attempts on
 * one — a second try only helps if the SAME provider was transiently unlucky,
 * which is the case the selected rung's own retry already covered.
 */
export const DIRECT_ASSIST_FALLBACK_MAX_ATTEMPTS = 1;

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
