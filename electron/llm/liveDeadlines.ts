// electron/llm/liveDeadlines.ts
//
// Single source of truth for the LIVE-COPILOT latency contract (Issue 1, P0).
// What-to-answer and live manual chat must NEVER make the user wait 10s+ or show
// an empty answer.
//
// That sentence was written for, and still governs, the TEXT path. It does not
// hold for a turn carrying a screenshot: image encode + multimodal prefill put
// a healthy vision first-token at 3-8s (measured p50 5.6s, tail 11.6s), so a
// 10s-shaped ceiling there does not protect the user, it just replaces a real
// answer with a canned line. LIVE_VISION_TOTAL_HARD_TIMEOUT_MS is the vision
// ceiling and is deliberately above 10s — see its own comment.
//
// These budgets are shared by IntelligenceEngine (WTA),
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
 * 8000ms as of 2026-09-06 (was 7000). This is the DEFAULT-PROVIDER route's budget:
 * a shipped provider-list entry called directly (Gemini / Groq / Claude / OpenAI /
 * DeepSeek), where the client is the ONLY layer that can recover — there is no
 * server cascade behind it to rotate, so the client giving up and falling back is
 * the whole recovery story. See totalHardTimeoutMs() for the full route table.
 *
 * The history below explains the 3500 -> 7000 move and still governs the floor.
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
export const LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS = 8000;
/**
 * First-useful cap for genuinely complex answers (coding/system-design). Equal to the
 * standard cap now that both must clear MiniMax's 4-6s first-token; kept as a separate
 * symbol so the two can diverge again without touching call sites.
 */
export const LIVE_PROVIDER_FIRST_USEFUL_COMPLEX_TIMEOUT_MS = 8000;
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
 * Is `text` a COMPLETE short answer, as opposed to a truncated fragment?
 *
 * The live path replaces a sub-threshold buffer with a canned "no answer" line
 * when the first-useful deadline fires. That is right for an empty result, and
 * right for the fragment case its own comment cites — a provider finalizing
 * "Sure," after an 8s timeout, which was never visible and is not an answer.
 *
 * It is WRONG for a complete short answer. Measured through the real app: a
 * provider that delivered "Yes — lead with the AWS migration." and then held the
 * stream open had that answer DISCARDED after 32s and replaced, even though a
 * correct answer existed from t=0. Length alone cannot separate the two cases,
 * so this asks the question length was standing in for: does the text end like a
 * finished utterance, and is there enough of it to be an answer at all?
 *
 * Deliberately conservative — a fragment misjudged as complete would paint half
 * a sentence, which is worse than the canned line. Terminal punctuation AND a
 * minimum word count must BOTH hold, so "Sure," (no terminal mark) and "Sure."
 * (too short) both remain fragments.
 */
export function isCompleteShortAnswer(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  // Allow a closing quote/bracket to follow the terminal mark.
  if (!/[.!?][)\]"'’”]*$/.test(t)) return false;
  return t.split(/\s+/).filter(Boolean).length >= 5;
}
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
 * VISION counterpart to LIVE_TOTAL_HARD_TIMEOUT_MS: the ceiling for an
 * image-bearing turn served by a provider OTHER than the natively cascade.
 *
 * 13000 is not a general-purpose number. Its derivation — read the comment
 * above — is "the natively-api server's 10s cutover + 3s for the next leg".
 * A user whose selected model is their own OpenRouter/LiteLLM/Gemini key never
 * touches that server, so on their turns 13000 is an arbitrary bound applied
 * for a reason that does not hold, and it was truncating the vision layer's own
 * budget: streamVisionWithFallback deliberately runs at ttftTimeoutMs 20_000
 * ("Vision TTFT is slower than text — image encode + multimodal prefill"), and
 * the vision call site scales FLASH_TTFT_MS/PRO_TTFT_MS up from 20s with image
 * count. Every one of those was dead: the outer 13s always fired first.
 *
 * Measured through the real app (natively_debug (3).log, one meeting, 33 vision
 * turns on a Custom/OpenRouter provider): 26 answers delivered with TTFT p50
 * 5.6s and a maximum of 11.6s; the remaining 7 (21%) were aborted at the 13.0s
 * ceiling and replaced with "The model did not produce an answer in time…". A
 * ceiling 1.4s above the observed tail is not a safety net — it is a coin flip.
 * 20_000 matches the vision chain's own base budget so a single attempt gets
 * the time that layer was already designed to give it.
 *
 * What this does NOT do: resurrect attempts 2 and 3. The chain is 3 attempts of
 * up to 20s, and no ceiling compatible with the live-copilot latency contract
 * can span that — the second provider stays unreachable on a first-token
 * timeout, by design. This buys the FIRST attempt its documented budget and
 * nothing more; say so plainly rather than letting the next reader re-derive
 * the confusion the 20_000 constant has already caused once.
 */
export const LIVE_VISION_TOTAL_HARD_TIMEOUT_MS = 20000;
/**
 * Ceiling for a provider the USER pointed at us: an OpenAI-compatible Custom
 * Provider, a cURL provider, a LiteLLM gateway, an NVIDIA NIM endpoint.
 *
 * Same argument as the vision ceiling above, applied to the text path. 13000 is
 * "the natively-api server's 10s cutover + 3s"; a user on their own endpoint
 * never reaches that server, so on their turns 13000 is a bound imported from a
 * mechanism that is not in the request path. The number that IS in the path is
 * whatever their gateway does — a LiteLLM proxy fronting a slow upstream, a
 * self-hosted NIM cold-starting a container, an OpenRouter model queueing — and
 * none of it is observable from here.
 *
 * 15000 buys those routes ~2s over the natively ceiling. It is deliberately
 * BELOW the 20s vision ceiling and not merged with it: vision is sized off a
 * measured 11.6s tail on image turns (see above), and a text turn on the same
 * provider has no image encode or multimodal prefill to pay for.
 */
export const LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS = 15000;
/**
 * Floor and ceiling for the ADAPTIVE user-endpoint budget below.
 *
 * The floor is the default-provider ceiling: however fast a gateway is measured
 * to be, it never earns a shorter leash than a direct API call. The ceiling is
 * the vision ceiling: a text turn never out-waits an image turn.
 */
export const LIVE_USER_ENDPOINT_MIN_TOTAL_HARD_TIMEOUT_MS = 8000;
export const LIVE_USER_ENDPOINT_MAX_TOTAL_HARD_TIMEOUT_MS = LIVE_VISION_TOTAL_HARD_TIMEOUT_MS;
/**
 * How much headroom to leave above the slowest first token actually observed
 * from this endpoint.
 *
 * Sized off the defect this whole area keeps producing: a 13s ceiling sitting
 * 1.4s above an 11.6s observed tail killed 21% of one user's turns. 5s is the
 * margin that would have made that session succeed outright.
 */
export const USER_ENDPOINT_LATENCY_MARGIN_MS = 5000;
/**
 * Widening is free; NARROWING can cut off a turn that was about to succeed. So
 * widening applies from the first sample that warrants it, and narrowing waits
 * for this many committed turns from the same endpoint.
 */
export const USER_ENDPOINT_MIN_SAMPLES_TO_NARROW = 5;

/** What the caller has actually measured from one endpoint this session. */
export interface ObservedLatency {
  /** Slowest first token seen, decayed — see LLMHelper.recordAnswerFirstToken. */
  maxMs: number;
  /** Committed turns observed. 0 means we know nothing. */
  count: number;
}

/**
 * The user-endpoint budget, given what we have measured from that endpoint.
 *
 * 15000 is a GUESS. It is the honest answer for an address we have never called
 * — a proxy fronting an unknown upstream, a container that may be cold, a
 * marketplace model that may be queueing — but it stays a guess only until the
 * endpoint has answered once. After that we are no longer guessing, and a
 * deadline derived from what this endpoint actually does beats a constant
 * derived from what gateways in general might do.
 *
 * DERIVED FROM A MAX, NOT A MEAN. An EWMA of TTFT lands near p50; a deadline
 * placed there guillotines the tail, which is precisely the geometry of the
 * bug this file already documents twice. `maxMs` is a decaying maximum, so the
 * budget tracks the worst first token this endpoint has actually produced and
 * forgets it slowly as the endpoint proves faster.
 *
 * ASYMMETRIC. Widening costs a healthy turn nothing — the ceiling only fires
 * when a provider is slow — and it fixes a known user-visible failure, so it
 * applies from the first sample. Narrowing is the direction that can kill a
 * turn that was about to succeed, so it needs USER_ENDPOINT_MIN_SAMPLES_TO_NARROW
 * turns of evidence and can never go below the default-provider ceiling.
 */
export function userEndpointBudgetMs(observed?: ObservedLatency | null): number {
  if (!observed || observed.count <= 0 || !Number.isFinite(observed.maxMs)) {
    return LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS;
  }
  const want = Math.round(observed.maxMs) + USER_ENDPOINT_LATENCY_MARGIN_MS;
  if (want > LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS) {
    // Widen immediately: this endpoint has already been slower than the guess.
    return Math.min(want, LIVE_USER_ENDPOINT_MAX_TOTAL_HARD_TIMEOUT_MS);
  }
  if (observed.count < USER_ENDPOINT_MIN_SAMPLES_TO_NARROW) {
    return LIVE_USER_ENDPOINT_TOTAL_HARD_TIMEOUT_MS;
  }
  return Math.max(want, LIVE_USER_ENDPOINT_MIN_TOTAL_HARD_TIMEOUT_MS);
}
/**
 * Ceiling for a shipped provider-list entry called directly — Gemini, Groq,
 * Claude, OpenAI, DeepSeek — on the user's own key or ours.
 *
 * These are well-known endpoints with sub-second healthy first-token latency,
 * and, unlike the natively route, nothing behind them can rescue a slow turn.
 * Waiting 13s to conclude that a direct Gemini call is not coming back spends
 * 13s of the user's meeting to reach a fallback that was available at 8. Equal
 * to LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS by construction: on a route with
 * one layer there is no honest difference between "the provider's cap" and "the
 * ceiling", and keeping them equal is what stops the two selectors below from
 * disagreeing about the same turn.
 */
export const LIVE_DEFAULT_PROVIDER_TOTAL_HARD_TIMEOUT_MS = LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS;
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
/**
 * First-token budget for a post-answer REPAIR or REGENERATION stream.
 *
 * A repair has different economics from the answer. The user already has an
 * answer on screen; if the repair times out they keep it. So the cost of a
 * short deadline here is a wasted repair, not a lost answer — which is why
 * these have always been shorter than the answer ceiling, and should stay so.
 *
 * But a FIXED 7000 was wrong for the same reason a fixed 13000 was wrong for
 * the answer: it ignored the route. On a gateway whose first token measures 9s,
 * a 7s repair window can never succeed — so every repair on that provider was
 * spent and thrown away, every time. That is the actual defect here, and it is
 * silent: the user just never sees their answer improve.
 *
 * Derived from the route's own budget so the two cannot drift, and clamped so
 * the derivation can never make a repair LONGER than a repair should be:
 *
 *   default provider   8000 * 0.6 -> floored to  7000   (unchanged)
 *   server cascade    13000 * 0.6 ->             7800
 *   user endpoint     15000 * 0.6 ->             9000   (adaptive; up to 12000)
 *   local                          LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS (unchanged)
 *
 * The floor is today's value, so no repair anywhere gets SHORTER than it is
 * now — this change only ever buys a slow route more room. Local is passed
 * through untouched: a cold weight load is not a fraction of anything.
 */
export const REPAIR_BUDGET_SHARE_OF_ROUTE = 0.6;
export const REPAIR_MIN_FIRST_USEFUL_MS = 7000;
export const REPAIR_MAX_FIRST_USEFUL_MS = 12000;
/**
 * Headroom the repair window must leave over the endpoint's OBSERVED first
 * token, when we have one.
 *
 * A share of the answer budget alone does not do this, and the live probe
 * caught it: a gateway measured at 9s got 15000 * 0.6 = 9000, a repair window
 * exactly equal to the tail it has to clear. That is a zero-margin deadline —
 * the same "1.4s above the tail is a coin flip" geometry this file already
 * documents, at margin zero. Smaller than the answer path's 5000 because a lost
 * repair costs the user nothing they can see; it only needs to clear the
 * measurement, not comfortably outlast it.
 */
export const REPAIR_LATENCY_MARGIN_MS = 2000;
/**
 * Floor for a repair that carries the turn's SCREENSHOT.
 *
 * These deadlines were sized when a repair was text-only, because that is all
 * they were — the repair call passed `undefined` for imagePaths. Now that a
 * repair inherits the answer's images it pays image encode + multimodal
 * prefill, which this file measures at p50 5.6s and a tail of 11.6s. A 7000ms
 * window there can never reliably finish, which would re-create the
 * "wasted repair" defect from the other direction, one commit after fixing it.
 *
 * Above REPAIR_MAX_FIRST_USEFUL_MS deliberately: that cap exists to stop a
 * background repair holding the UI, and it was also sized for text. A vision
 * repair that cannot clear the measured tail is not cheaper, it is free to
 * throw away. Still well under the 20s vision ANSWER ceiling.
 */
export const REPAIR_VISION_MIN_FIRST_USEFUL_MS = 14000;

export function repairDeadlineMs(opts: {
  isLocal?: boolean;
  viaServerCascade?: boolean;
  isUserEndpoint?: boolean;
  observedUserEndpointLatency?: ObservedLatency | null;
  /**
   * The value this call site used before it became route-aware, kept as its own
   * floor. Two of the eleven sites were tuned to 8000 rather than 7000, and a
   * single shared floor would have quietly SHORTENED them — turning a change
   * that is supposed to only ever add room into a regression on two paths.
   * Defaults to REPAIR_MIN_FIRST_USEFUL_MS.
   */
  minMs?: number;
  /** The repair inherits the answer's screenshot, so it pays a vision prefill. */
  hasImages?: boolean;
}): number {
  if (opts.isLocal) return LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS;
  const floor = Math.max(
    REPAIR_MIN_FIRST_USEFUL_MS,
    opts.minMs ?? 0,
    opts.hasImages ? REPAIR_VISION_MIN_FIRST_USEFUL_MS : 0,
  );
  const routeBudget = totalHardTimeoutMs({
    viaServerCascade: opts.viaServerCascade,
    isUserEndpoint: opts.isUserEndpoint,
    observedUserEndpointLatency: opts.observedUserEndpointLatency,
  });
  const share = Math.round(routeBudget * REPAIR_BUDGET_SHARE_OF_ROUTE);
  // If this endpoint has been measured, the window must actually clear that
  // measurement — a repair that cannot finish is not a shorter repair, it is a
  // wasted one, which is the whole defect being fixed here.
  const obs = opts.isUserEndpoint ? opts.observedUserEndpointLatency : null;
  const clearsObserved = obs && obs.count > 0 && Number.isFinite(obs.maxMs)
    ? Math.round(obs.maxMs) + REPAIR_LATENCY_MARGIN_MS
    : 0;
  return Math.min(
    Math.max(REPAIR_MAX_FIRST_USEFUL_MS, floor),
    Math.max(floor, share, clearsObserved),
  );
}

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
 * high enough (below) that no measured answer comes close.
 *
 * It is NOT env-overridable, despite this comment previously saying so
 * (code-review 2026-08-14): there is no `process.env` read anywhere in this
 * file. Raising it requires a code change.
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

/**
 * Abort ceiling for a coding REGENERATION (the meta-reply retry and the
 * completeness retry).
 *
 * F-305: both regens used a hardcoded 4000, which is HALF the size this file
 * already measures for the very artifact their prompt asks for — "a six-section
 * coding answer with multiple code blocks, ~8000" (see MAX_STREAM_OUTPUT_CHARS
 * above). A correct answer therefore got cut mid-sentence, and because the
 * meta-retry accepted on nothing more than "length >= 20 and some closed code
 * fence", that truncation was accepted and atomically REPLACED the streamed
 * row — the user's final answer ended mid-word. Sized to the documented
 * estimate; MAX_STREAM_OUTPUT_CHARS remains the outer runaway bound.
 */
export const CODING_REGEN_ABORT_CHARS = 8000;

/**
 * The same runaway bound for BATCH generations that are legitimately long —
 * today only `generateMeetingSummary`.
 *
 * MAX_STREAM_OUTPUT_CHARS above is calibrated from LIVE what_to_answer answers
 * (19 captured, p100 2530 chars). A meeting summary is a different artifact: a
 * structured multi-section document over a whole session, where 16k is a
 * plausible LENGTH rather than 6x the p100. Because the cap ends the stream by
 * RETURNING, `generateMeetingSummary`'s `text.trim().length > 0` check passed
 * and a summary that stopped mid-sentence was persisted as complete
 * (code-review 2026-08-13).
 *
 * Still a runaway bound, not a licence: a summary reaching 120k chars has
 * stopped being a summary.
 *
 * NOT env-overridable — neither this nor MAX_STREAM_OUTPUT_CHARS reads
 * process.env, despite that constant's doc claiming otherwise (code-review
 * 2026-08-14 caught the claim being repeated here). Changing either requires a
 * code change; an operator hitting the ceiling has no runtime lever.
 */
export const MAX_SUMMARY_OUTPUT_CHARS = 120000;

const COMPLEX_TYPES = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer', 'debugging_question_answer',
]);

/**
 * The first-useful-token deadline for a given answer type: the complex cap for
 * coding/system-design, otherwise the standard hard cap. Used as the time the
 * provider has to produce a useful token before we abort and fall back.
 *
 * ROUTE FIRST, ANSWER TYPE SECOND. The answer-type split (complex vs standard)
 * applies only on the DEFAULT-PROVIDER route; every other route's budget is a
 * property of the transport, which a coding question cannot change. The route
 * flags are checked in the same order, and return the same numbers, as
 * {@link totalHardTimeoutMs} — see that function's table. Keeping the two in
 * lockstep is deliberate: WTA reads the ceiling and manual chat reads this, so a
 * divergence is invisible from either surface.
 *
 * `isLocal` (Ollama / on-device): the cloud caps assume sub-second first-token; a
 * local model may need to cold-load its weights first, so a local provider gets the
 * far longer LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS regardless of answer type. The
 * caller passes llmHelper.isUsingOllama(). Checked FIRST, so a local rung is never
 * re-classified by another flag. Defaults false (cloud) for back-compat.
 *
 * `viaServerCascade`: llmHelper.isUsingNativelyServerCascade().
 * `isUserEndpoint`: llmHelper.isUsingUserEndpoint() — Custom / cURL / LiteLLM /
 * NVIDIA NIM. Both default false, so an un-updated caller still gets the previous
 * default-route behaviour.
 *
 * NOT applied to the regen/repair streams, which pass their own literals
 * (IntelligenceEngine 4026/4328/4547/4953/5167/5568, ipcHandlers
 * 3903/4012/4129/5144/5598). Those bound a post-answer repair, not the answer the
 * user is waiting on, and were left alone deliberately.
 */
export function firstUsefulDeadlineMs(
  answerType: AnswerType,
  isLocal: boolean = false,
  viaServerCascade: boolean = false,
  isUserEndpoint: boolean = false,
  observedUserEndpointLatency?: ObservedLatency | null,
): number {
  if (isLocal) return LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS;
  // F-301: on the natively-api route the SERVER runs a sequential cascade and
  // cuts over to the next provider at AI_TTFT_BUDGET_MS (10s). Aborting at the
  // 7s provider cap tore down the HTTP request 3s BEFORE that rescue could
  // happen, so the user got "The model did not produce an answer in time" on a
  // turn the server was about to deliver. This is the same ordering invariant
  // LIVE_TOTAL_HARD_TIMEOUT_MS documents — it had only ever been applied to
  // the WTA path, never to manual chat, which is the path its own rationale
  // describes. Reuse that constant so the two cannot drift apart.
  if (viaServerCascade) return LIVE_TOTAL_HARD_TIMEOUT_MS;
  // A user-supplied endpoint (Custom / cURL / LiteLLM / NVIDIA NIM) gets the same
  // budget here as it does from totalHardTimeoutMs(). These two functions answer
  // the same question for two surfaces — WTA reads the ceiling, manual chat reads
  // this — and every time they have been allowed to disagree, one surface has
  // silently inherited a bound written for the other. That is how the natively
  // ceiling came to govern vision turns, and how this cap governed manual chat
  // while WTA used a different one.
  if (isUserEndpoint) return userEndpointBudgetMs(observedUserEndpointLatency);
  return COMPLEX_TYPES.has(answerType)
    ? LIVE_PROVIDER_FIRST_USEFUL_COMPLEX_TIMEOUT_MS
    : LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS;
}

/**
 * The absolute first-token ceiling for a turn — the companion to
 * {@link firstUsefulDeadlineMs}, which answers the same question for the
 * per-provider soft cap.
 *
 * Lives here, not inline at the call site, because the choice is a policy with
 * FIVE cases and each one exists for a documented reason (see the constants
 * above, and the table in the body). Inline it was two cases and a comment,
 * which is how the vision budget came to be truncated silently for every user
 * not on the natively cascade — and how the natively cascade's own number came
 * to govern direct provider calls that have no cascade behind them.
 *
 * Returns the same value as {@link firstUsefulDeadlineMs} for every route except
 * vision, which only this function knows about (a screenshot turn does not reach
 * the manual-chat path).
 */
export function totalHardTimeoutMs(opts: {
  /** Ollama / on-device: cold weight load dominates first-token. */
  isLocal?: boolean;
  /** The turn carries a screenshot, so it is served by the vision chain. */
  isVisionTurn?: boolean;
  /** Routed through natively-api, whose own cutover LIVE_TOTAL_HARD_TIMEOUT_MS encodes. */
  viaServerCascade?: boolean;
  /** A provider the user pointed at us: Custom / cURL / LiteLLM / NVIDIA NIM. */
  isUserEndpoint?: boolean;
  /**
   * What this endpoint's first token has actually cost so far, from
   * llmHelper.observedAnswerLatency(). Only consulted on the user-endpoint
   * route — every other route's number is derived from something we know about
   * the transport, not guessed, so measurement has nothing to correct.
   */
  observedUserEndpointLatency?: ObservedLatency | null;
}): number {
  // ROUTE TABLE, most-specific first. Each number exists because something in
  // THAT route's request path justifies it; none of them is a general default:
  //
  //   local            30000  cold weight load precedes the first token
  //   vision           20000  image encode + multimodal prefill (measured 11.6s tail)
  //   server cascade   13000  natively-api's 10s provider cutover + 3s
  //   user endpoint    15000  a gateway we have not measured YET — adaptive once
  //                           we have, between 8000 and 20000 (see
  //                           userEndpointBudgetMs)
  //   default provider  8000  a direct call with nothing behind it to rescue it
  //
  // Order matters twice over. Vision stays ABOVE the user-endpoint case, so a
  // screenshot turn on a Custom provider keeps the 20s that turn was measured to
  // need rather than being shortened to 15s. And the server cascade is now an
  // EXPLICIT branch rather than the fallthrough: 13000 was reaching the default
  // providers only because they shared its `return`, which is the same silent
  // inheritance that put it on vision turns.
  if (opts.isLocal) return LIVE_LOCAL_TOTAL_HARD_TIMEOUT_MS;
  if (opts.isVisionTurn && !opts.viaServerCascade) return LIVE_VISION_TOTAL_HARD_TIMEOUT_MS;
  if (opts.viaServerCascade) return LIVE_TOTAL_HARD_TIMEOUT_MS;
  if (opts.isUserEndpoint) return userEndpointBudgetMs(opts.observedUserEndpointLatency);
  return LIVE_DEFAULT_PROVIDER_TOTAL_HARD_TIMEOUT_MS;
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
