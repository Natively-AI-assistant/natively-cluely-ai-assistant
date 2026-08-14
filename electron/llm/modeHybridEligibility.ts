// electron/llm/modeHybridEligibility.ts
//
// Phase 2 of the semantic-retrieval repair (2026-08-13, audit
// reports/cosine-similarity-relevance-audit-2026-08-13.md §6).
//
// LLMHelper had TWO hybrid-eligibility predicates for mode reference-file
// retrieval, and they disagreed:
//   - chatWithGemini:  `forceDocumentGrounding && typeof …Hybrid === 'function'`
//   - streamChat:      `isRagLocalRerankEnabled() || forceDocumentGrounding`
// In production the two coincide (ragLocalRerank defaults OFF), but in every
// dev/test/benchmark context — the runtimes all measurements come from — the
// same question retrieved differently depending on entry point. Worse, the
// chatWithGemini call passed NO retrievalOptions, so the wrapper's
// `retrievalOptions?.forceDocumentGrounding` branch (fine chunking + identity
// block merge — the entire doc-grounded hybrid path) never fired there even
// though the site only ran when doc-grounded.
//
// This module is the single source of truth for (a) eligibility, (b) the
// argument mapping into buildRetrievedActiveModeContextBlockHybrid, and
// (c) the race-budget policy. Both LLMHelper sites call it.
//
// ── Known, DOCUMENTED divergences that this module does NOT erase ──────────
// 1. Race budget: streamChat races the hybrid call (1000ms, or 2000ms when
//    doc-grounded — large PDFs need embed+rank time) and falls back to sync
//    lexical on timeout, because it sits on the live first-useful deadline.
//    chatWithGemini awaits without a race (budgetMs: null) — it is not on the
//    streaming deadline and a lexical downgrade there is a pure quality loss.
//    This asymmetry is intentional; pass budgetMs accordingly.
// 2. Query preparation: chatWithGemini expands the doc-grounded query
//    (expandQueryWithHints) before retrieval; streamChat — the live-validated
//    real Ask-AI path — passes the raw message, and ModeHybridRetriever
//    normalizes doc-grounded queries internally. Unifying this is a recall
//    behavior choice, not mechanical cleanup; it stays caller-side until
//    measured. (Suspicion, unproven: the site-1 expansion predates the
//    retriever's internal normalization and may be stale.)

export interface HybridEligibilityCtx {
  forceDocumentGrounding: boolean;
}

/**
 * Canonical eligibility: hybrid (FTS + cosine + optional cross-encoder) runs
 * when the local-rerank rollout flag is on OR the active custom mode forces
 * document grounding. These are streamChat's semantics — the live-validated
 * real-path behavior (audit 2026-06-27 lineage) — now shared by both sites.
 */
export function shouldUseHybridRetrieval(ctx: HybridEligibilityCtx): boolean {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isRagLocalRerankEnabled } = require('../intelligence/intelligenceFlags');
  return isRagLocalRerankEnabled() || ctx.forceDocumentGrounding === true;
}

/** streamChat's race budget: doc-grounded gets 2000ms (cold embedder + large
 *  PDFs), everything else 1000ms. */
export function hybridRetrievalBudgetMs(forceDocumentGrounding: boolean): number {
  return forceDocumentGrounding ? 2000 : 1000;
}

/**
 * chatWithGemini's ceiling for the RERANK-ONLY path.
 *
 * That site is not on the streaming deadline, so doc-grounded still awaits to
 * completion (budgetMs: null) — the user uploaded those documents and the answer
 * depends on them; truncating that is worse than waiting.
 *
 * The rerank-only path is different in kind: it became reachable here when
 * eligibility widened to `isRagLocalRerankEnabled() || forceDocumentGrounding`,
 * and it is an OPTIONAL quality boost, not a correctness requirement. Awaiting it
 * unbounded lets a cold embedder + cross-encoder load block a manual answer for
 * as long as the load takes. The ceiling is deliberately generous rather than
 * streamChat's 1000ms: it exists to stop a pathological hang, not to change the
 * normal result, so benchmark runs (where ragLocalRerank is actually on) still
 * complete on the rerank path rather than silently dropping to lexical.
 */
export const MANUAL_HYBRID_RERANK_BUDGET_MS = 8000;

export interface HybridRetrievalArgs {
  query: string;
  context?: string;
  answerType?: string;
  forceDocumentGrounding: boolean;
  pinnedModeId?: string;
  followUpReferentHint?: string;
  /** null = no race (await to completion); a number races against timeout. */
  budgetMs: number | null;
}

export interface HybridRetrievalResult {
  /** The retrieved block; null when the race timed out (caller falls back to
   *  sync lexical) — an EMPTY STRING is a successful "nothing retrieved". */
  block: string | null;
  timedOut: boolean;
}

/**
 * The one argument mapping into buildRetrievedActiveModeContextBlockHybrid.
 * tokenBudget undefined when doc-grounded (the retriever auto-upgrades to
 * DOC_GROUNDED_TOKEN_BUDGET internally), 1800 otherwise; excludeCustomContext
 * true; allowRerank true; retrievalOptions ALWAYS threaded so the wrapper's
 * doc-grounded branch actually fires.
 */
export async function runHybridModeRetrieval(
  modesMgr: {
    buildRetrievedActiveModeContextBlockHybrid?: (...args: any[]) => Promise<string>;
  },
  args: HybridRetrievalArgs,
): Promise<HybridRetrievalResult> {
  if (typeof modesMgr.buildRetrievedActiveModeContextBlockHybrid !== 'function') {
    return { block: null, timedOut: false };
  }
  const hybridPromise = modesMgr.buildRetrievedActiveModeContextBlockHybrid(
    args.query,
    args.context,
    args.forceDocumentGrounding ? undefined : 1800,
    args.answerType,
    /* excludeCustomContext */ true,
    args.pinnedModeId ?? undefined,
    /* allowRerank */ true,
    { forceDocumentGrounding: args.forceDocumentGrounding, followUpReferentHint: args.followUpReferentHint },
  );
  if (args.budgetMs == null) {
    return { block: await hybridPromise, timedOut: false };
  }
  const raced = await Promise.race([
    hybridPromise.then((value: string) => ({ value, timedOut: false })),
    new Promise<{ value: string; timedOut: boolean }>((resolve) =>
      setTimeout(() => resolve({ value: '', timedOut: true }), args.budgetMs as number),
    ),
  ]);
  if (raced.timedOut) {
    // Don't leave the slow hybrid promise unhandled; drop its late result.
    hybridPromise.finally(() => { /* raced timed out — drop result */ }).catch(() => {});
    return { block: null, timedOut: true };
  }
  return { block: raced.value, timedOut: false };
}
