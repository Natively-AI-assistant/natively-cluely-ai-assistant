// electron/llm/liveDeadlines.ts
//
// Single source of truth for the LIVE-COPILOT latency contract (Issue 1, P0).
// What-to-answer and live manual chat must NEVER make the user wait 10s+ or show
// an empty answer. These budgets are shared by IntelligenceEngine (WTA),
// ipcHandlers (manual chat), and the benchmark runners so the product and its
// measurement agree exactly.
//
// The mechanism that ENFORCES these is a `Promise.race` per iterator.next()
// against a deadline — a bare `for await` + setTimeout(.return()) cannot
// interrupt an already-pending next() on a hung provider (this is what caused a
// 134-second hang). See raceStreamWithDeadline() below.

import type { AnswerType } from './AnswerPlanner';

/** First-useful-token budget by difficulty (ms). Mirrors the planner targets. */
export const LIVE_FIRST_USEFUL_BUDGET_MS = {
  direct: 1200,
  medium: 1800,
  hard: 2500,
  very_hard: 3500,
} as const;

/**
 * Hard cap on the FIRST useful token from the provider before we abort.
 *
 * 7000ms, NOT 3500ms. MiniMax (the strong fallback when the Gemini chain is down —
 * see natively-api lib/minimaxProvider.js) has a 4-6s first-token latency; a 3500ms
 * cap aborted every MiniMax stream before it produced a token, so the fallback could
 * never serve a live answer. Raising the cap is near-free on healthy responses: this
 * deadline only FIRES when a provider is genuinely slow to first-token — a healthy
 * Gemini/Groq still streams its first token in <1s and never reaches the cap, whether
 * it's set to 3.5s or 7s. The cost is paid only in the narrow window where a provider
 * takes 3.5-7s AND aborting to the next fallback would have been faster — rare, since
 * MiniMax IS the next strong fallback.
 */
export const LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS = 7000;
/**
 * First-useful cap for genuinely complex answers (coding/system-design). Equal to the
 * standard cap now that both must clear MiniMax's 4-6s first-token; kept as a separate
 * symbol so the two can diverge again without touching call sites.
 */
export const LIVE_PROVIDER_FIRST_USEFUL_COMPLEX_TIMEOUT_MS = 7000;
/**
 * First-useful cap for a LOCAL provider (Ollama). The 7s cloud cap is wrong for a
 * local model: a cold model must load its weights into RAM before the first token,
 * which on a laptop is 8-12s for a 7-9B model (measured: qwen3.5:9b cold-loads in
 * ~8.5s on a 16GB MacBook Air, before a single token). With the 7s cap, every cold
 * local generation was aborted to zero tokens and the user saw the canned
 * "Let me come back to that in just a moment." fallback. 30s covers a cold load +
 * a slow first token; once the model is warm (we pin keep_alive from prewarm), the
 * real first token still arrives in <1s and this ceiling is never reached — so the
 * cost is paid only on the genuine first cold call. This guards first-token only;
 * the inter-token stall guard (unchanged) still protects against a mid-stream hang.
 */
export const LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS = 30000;
/**
 * Absolute ceiling on a live answer's first-useful token (the no-fallback budget).
 * Sits above the 7s first-useful cap so a MiniMax stream about to deliver at
 * ~6.5s isn't guillotined by this ceiling.
 *
 * MUST ALSO STAY ABOVE natively-api's AI_TTFT_BUDGET_MS (10s), and this is the
 * binding constraint. A Natively-key user's chat goes to
 * `${NATIVELY_API_URL}/v1/chat` (LLMHelper.ts), where the server runs a
 * SEQUENTIAL provider cascade (Gemini Flash -> MiniMax-M3 -> Gemini Pro) and
 * cuts over to the next provider when one is slow to first token. That cutover
 * is the thing that actually RESCUES a slow turn — the client, by contrast, can
 * only give up.
 *
 * At the previous 8000 the ordering was inverted: the client abandoned the turn
 * 2s BEFORE the server would have rotated, so the user got the local fallback
 * (or, for coding, a fabricated scaffold) instead of the answer the server was
 * about to deliver. 13000 = the server's 10s cutover + 3s for the next leg to
 * produce a first token. DeadlineBudgetOrdering2026_08_10.test.mjs reads
 * AI_TTFT_BUDGET_MS out of server.js and fails if these drift back out of order.
 *
 * Cost of the raise is near-zero: this ceiling only fires when a provider is
 * genuinely slow to first token — a healthy stream delivers in <1s and never
 * approaches it. The inter-token stall guard (unchanged, 8s) still bounds a
 * mid-stream hang, which is a different failure mode.
 */
export const LIVE_TOTAL_HARD_TIMEOUT_MS = 13000;
/**
 * Local-provider counterpart to LIVE_TOTAL_HARD_TIMEOUT_MS: the no-fallback ceiling
 * when there is no deterministic fallback to swap in. Matches the local first-useful
 * cap so a cold local load isn't aborted to an empty answer.
 */
export const LIVE_LOCAL_TOTAL_HARD_TIMEOUT_MS = 30000;
/**
 * After the first useful token has streamed, a long answer (coding scaffold +
 * sections) may legitimately keep flowing — we only abort on a genuine
 * inter-token STALL, never a wall-clock cap, so healthy long answers are never
 * truncated mid-sentence.
 */
export const LIVE_INTER_TOKEN_STALL_MS = 8000;
/** Benchmark per-question hard timeout — the outer wrapper that must never be exceeded. */
export const BENCHMARK_PER_QUESTION_HARD_TIMEOUT_MS = 30000;

/**
 * Absolute ceiling on the TOTAL characters one answer may stream.
 *
 * This is a CHARACTER bound, not a wall-clock one — a different instrument from
 * LIVE_INTER_TOKEN_STALL_MS, which bounds a mid-stream hang.
 *
 * Be honest about the tension (code review 2026-08-12). LIVE_INTER_TOKEN_STALL_MS
 * promises unconditionally that "healthy long answers are never truncated
 * mid-sentence". This cap DOES truncate mid-sentence, at whatever chunk boundary
 * crosses the limit, and it cannot tell a looping model from a genuinely long
 * answer — only their size. The earlier wording here reconciled the two by
 * redefining "healthy" as "passes the time-based checks", which is not what that
 * promise said. The real position: above this size an answer is treated as a
 * runaway, accepting that a legitimate answer that large is cut off. It is set
 * high enough (below) that no measured answer comes close, and it is
 * env-overridable for anyone who hits it.
 *
 * Live capture 2026-08-12 (what_to_answer): the model produced 8047 tokens /
 * 22871 chars over 61s before the SERVER aborted it. tfft was 2084ms and tokens
 * flowed continuously, so no client guard applied — not the first-token ceiling
 * (LIVE_TOTAL_HARD_TIMEOUT_MS), not the inter-token stall guard. Nothing on the
 * client bounded total output at all.
 *
 * Sized off measured data, not intuition. Across 19 real answers captured in
 * that same session the largest was 2530 chars (median 639). 16000 is ~6x that
 * p100, and ~2x a generous estimate for the longest legitimate answer this
 * pipeline can produce (a six-section coding answer with multiple code blocks,
 * ~8000). An answer that reaches this has stopped being an answer.
 *
 * DEFENCE IN DEPTH, NOT THE FIX. The real fix is an output bound on the
 * request: streamWithNatively's body sends { messages, stream, fast_mode,
 * system, language, images } and no max_tokens — it is the ONLY provider in
 * LLMHelper that does not bound output (DeepSeek, LiteLLM, Claude, Gemini and
 * Groq all do). Adding it needs a natively-api change too, because /v1/chat
 * destructures a fixed field list and would silently ignore the field today.
 */
export const MAX_STREAM_OUTPUT_CHARS = 16000;

const COMPLEX_TYPES = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer', 'debugging_question_answer',
]);

/**
 * The first-useful-token deadline for a given answer type: the complex cap for
 * coding/system-design, otherwise the standard hard cap. Used as the time the
 * provider has to produce a useful token before we abort and fall back.
 *
 * `isLocal` (Ollama / on-device): the cloud caps assume sub-second first-token; a
 * local model may need to cold-load its weights first, so a local provider gets the
 * far longer LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS regardless of answer type. The
 * caller passes llmHelper.isUsingOllama(). Defaults false (cloud) for back-compat.
 */
export function firstUsefulDeadlineMs(answerType: AnswerType, isLocal: boolean = false): number {
  if (isLocal) return LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS;
  return COMPLEX_TYPES.has(answerType)
    ? LIVE_PROVIDER_FIRST_USEFUL_COMPLEX_TIMEOUT_MS
    : LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS;
}

const DEADLINE = Symbol('deadline');

/**
 * Drive an async stream with the live deadline contract. Races each next()
 * against the active budget:
 *   • before the first useful token — the first-useful deadline (abort→fallback)
 *   • after — an inter-token stall guard (abort only on a real mid-stream stall)
 *
 * Calls `onToken(value)` for each token. `markUseful(accumulated)` returns true
 * once the accumulated output is user-useful (so the deadline switches to the
 * stall guard). Returns why the loop ended. ALWAYS closes the iterator.
 *
 * `isSpeculative` (prefetch) disables the deadline (no user waiting).
 */
export async function raceStreamWithDeadline(opts: {
  stream: AsyncGenerator<string> | AsyncIterable<string>;
  firstUsefulDeadlineMs: number;
  interTokenStallMs?: number;
  isSpeculative?: boolean;
  onToken: (value: string) => void | Promise<void>;
  /** Return true once `accumulated` is user-useful. */
  isUsefulYet: () => boolean;
  /** Called once the deadline fires before any useful token (for telemetry). */
  onFirstUsefulTimeout?: () => void;
  /** Called on an inter-token stall after streaming began (for telemetry). */
  onStallTimeout?: () => void;
  /** Bail predicate (e.g. superseded by a newer generation). */
  shouldAbort?: () => boolean;
  /**
   * Called once when the loop ends. The reason distinguishes normal completion
   * from a timeout/stall/supersession, so callers can abort an underlying HTTP
   * request only when it still needs cancellation. Fire-and-forget iterator
   * cleanup alone cannot interrupt a fetch parked in an await. Synchronous; it
   * must not throw.
   */
  onCleanup?: (reason: 'done' | 'first_useful_timeout' | 'stall_timeout' | 'aborted' | 'error') => void;
}): Promise<'done' | 'first_useful_timeout' | 'stall_timeout' | 'aborted'> {
  const {
    stream, firstUsefulDeadlineMs: fuMs, interTokenStallMs = LIVE_INTER_TOKEN_STALL_MS,
    isSpeculative = false, onToken, isUsefulYet, onFirstUsefulTimeout, onStallTimeout, shouldAbort, onCleanup,
  } = opts;
  const iterator = (stream as AsyncIterable<string>)[Symbol.asyncIterator]();
  const start = Date.now();
  let lastTokenAt = start;
  let useful = false;
  // Fire-and-forget cleanup. A generator stuck in `await sleep()` (a hung
  // provider) will NOT honor iterator.return() until its await unblocks, so we
  // must NOT `await` the cleanup on the deadline path — that would re-introduce
  // the multi-second hang we're guarding against. The underlying SDK stream
  // closes when the generator next checks its abort signal / yields.
  const cleanup = (reason: 'done' | 'first_useful_timeout' | 'stall_timeout' | 'aborted' | 'error') => {
    try { onCleanup?.(reason); } catch { /* abort callback must not break cleanup */ }
    try { const p = iterator.return?.(undefined); if (p && typeof (p as any).then === 'function') (p as Promise<unknown>).catch(() => {}); } catch { /* already closed */ }
  };
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (shouldAbort?.()) { cleanup('aborted'); return 'aborted'; }
      let res: IteratorResult<string> | typeof DEADLINE;
      if (!isSpeculative) {
        if (!useful) useful = isUsefulYet();
        const remaining = !useful
          ? Math.max(50, fuMs - (Date.now() - start))
          : Math.max(50, interTokenStallMs - (Date.now() - lastTokenAt));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<typeof DEADLINE>((r) => { timer = setTimeout(() => r(DEADLINE), remaining); });
        // DEFUSE the racing next() promise: if the deadline wins, this promise is
        // still pending and unobserved — when the hung provider's request later
        // rejects (timeout / 429 / socket reset) it would surface as an
        // unhandledRejection (fatal in Electron main). Attach a no-op catch so the
        // loser can never be an unhandled rejection (code-review 2026-06-05, HIGH).
        const nextP = iterator.next();
        nextP.catch(() => { /* loser of the race — defused */ });
        res = await Promise.race([nextP, deadline]);
        if (timer) clearTimeout(timer);
        if (res === DEADLINE) {
          if (!useful) {
            cleanup('first_useful_timeout');
            onFirstUsefulTimeout?.();
            return 'first_useful_timeout';
          }
          cleanup('stall_timeout');
          onStallTimeout?.();
          return 'stall_timeout';
        }
      } else {
        res = await iterator.next();
      }
      if (res.done) { cleanup('done'); return 'done'; }
      lastTokenAt = Date.now();
      await onToken(res.value);
      if (!useful) useful = isUsefulYet();
    }
  } catch (e) {
    cleanup('error');
    throw e;
  }
}
