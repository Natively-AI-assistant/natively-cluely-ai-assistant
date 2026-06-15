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
 * Absolute ceiling on a live answer's first-useful token (the no-fallback budget).
 * Sits just above the 7s first-useful cap so a MiniMax stream about to deliver at
 * ~6.5s isn't guillotined by this ceiling.
 */
export const LIVE_TOTAL_HARD_TIMEOUT_MS = 8000;
/**
 * After the first useful token has streamed, a long answer (coding scaffold +
 * sections) may legitimately keep flowing — we only abort on a genuine
 * inter-token STALL, never a wall-clock cap, so healthy long answers are never
 * truncated mid-sentence.
 */
export const LIVE_INTER_TOKEN_STALL_MS = 8000;
/** Benchmark per-question hard timeout — the outer wrapper that must never be exceeded. */
export const BENCHMARK_PER_QUESTION_HARD_TIMEOUT_MS = 30000;

const COMPLEX_TYPES = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer', 'debugging_question_answer',
]);

/**
 * The first-useful-token deadline for a given answer type: the complex cap for
 * coding/system-design, otherwise the standard hard cap. Used as the time the
 * provider has to produce a useful token before we abort and fall back.
 */
export function firstUsefulDeadlineMs(answerType: AnswerType): number {
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
   * Called once when the loop ends for ANY reason (timeout/stall/abort/done).
   * Use it to abort the underlying provider request (e.g. controller.abort()) so
   * a timed-out HTTP stream doesn't keep running to its own network timeout —
   * fire-and-forget iterator.return() alone cannot cancel a fetch parked in an
   * await. Synchronous; must not throw.
   */
  onCleanup?: () => void;
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
  const cleanup = () => {
    try { onCleanup?.(); } catch { /* abort callback must not break cleanup */ }
    try { const p = iterator.return?.(undefined); if (p && typeof (p as any).then === 'function') (p as Promise<unknown>).catch(() => {}); } catch { /* already closed */ }
  };
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (shouldAbort?.()) { cleanup(); return 'aborted'; }
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
          cleanup();
          if (!useful) { onFirstUsefulTimeout?.(); return 'first_useful_timeout'; }
          onStallTimeout?.(); return 'stall_timeout';
        }
      } else {
        res = await iterator.next();
      }
      if (res.done) { cleanup(); return 'done'; }
      lastTokenAt = Date.now();
      await onToken(res.value);
      if (!useful) useful = isUsefulYet();
    }
  } catch (e) {
    cleanup();
    throw e;
  }
}
