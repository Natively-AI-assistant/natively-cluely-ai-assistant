/**
 * How long the rerank stage is allowed to take.
 *
 * The seam races the reranker against a deadline and keeps the pre-rerank
 * ordering if it loses. That deadline was written for the BUNDLED reranker, so
 * a user who never opened the panel would not pay a cold 400MB ONNX load on
 * their first-useful-token path just because reranking exists.
 *
 * That reason still holds. `bge-reranker-base` was removed outright (it
 * benchmarked WORSE than no reranker at all: MRR 0.7558 against a 0.8368
 * baseline), but a bundled default remains — `Xenova/ms-marco-MiniLM-L-6-v2` —
 * and `shouldRerank` is `explicitlySelected || lowConfidence || rerankerOverride`,
 * so a low-confidence turn still escalates to it. BUNDLED_RERANK_BUDGET_MS is
 * therefore the budget of a real shipping path, not a vestige.
 *
 * It is the wrong deadline for a reranker the user chose. Measured on a real
 * configuration (2026-09-04): `qwen/qwen3-reranker-8b` via OpenRouter, whose
 * own Test Connection reported `ok` at 2052ms, lost the 1200ms race on every
 * query. The order never changed, and nothing surfaced that. Downloading a
 * model, selecting it, and watching its test pass bought nothing at all.
 *
 * So the budget follows the CHOICE, not just the surface:
 *
 *   bundled default  -> 1200ms on every surface (unchanged)
 *   user selected    -> 3000ms live, 8000ms manual
 *
 * The two selected budgets differ because the surfaces differ. A live
 * transcript turn is racing the speaker; a manual answer is already bounded by
 * MANUAL_HYBRID_RERANK_BUDGET_MS (8000ms) upstream, so matching it here spends
 * no deadline that was not already committed.
 */

/** The budget for the reranker nobody opted into. Unchanged, deliberately. */
export const BUNDLED_RERANK_BUDGET_MS = 1200;

/** The budget for a reranker the user downloaded, selected and verified. */
export const SELECTED_RERANK_BUDGET_MS = Object.freeze({
    live: 3000,
    manual: 8000,
});

/** Which deadline the calling turn is racing. */
export type RerankSurface = 'live' | 'manual';

/**
 * Resolve the rerank deadline.
 *
 * An ABSENT surface resolves to the live (tighter) budget on purpose. A caller
 * that has not been taught to declare itself must never be handed the 8s manual
 * budget on a latency-critical live turn — the failure mode of guessing wrong
 * in that direction is a visibly stalled answer, which is worse than a rerank
 * that does not finish.
 */
export function resolveRerankBudgetMs(opts: {
    explicitlySelected: boolean;
    surface?: RerankSurface;
}): number {
    if (!opts.explicitlySelected) return BUNDLED_RERANK_BUDGET_MS;
    return opts.surface === 'manual'
        ? SELECTED_RERANK_BUDGET_MS.manual
        : SELECTED_RERANK_BUDGET_MS.live;
}

/** What a measured Test Connection latency means for whether reranking runs. */
export interface RerankLatencyFit {
    liveBudgetMs: number;
    manualBudgetMs: number;
    fitsLive: boolean;
    fitsManual: boolean;
    /** Present only when the measured latency will cost the user reranking. */
    warning?: string;
}

/**
 * Turn a Test Connection latency into a statement about whether this reranker
 * will actually do anything.
 *
 * "ok, 2052ms" was true and useless: it did not say that 2052ms lost to a
 * 1200ms budget on every query. A probe that reports success for a model which
 * cannot affect a single answer is the failure this exists to prevent.
 *
 * An unknown or non-positive latency (a failed probe) yields no warning — there
 * is nothing measured to warn about, and a failed test already reports itself.
 */
export function describeRerankLatencyFit(latencyMs?: number): RerankLatencyFit {
    const liveBudgetMs = SELECTED_RERANK_BUDGET_MS.live;
    const manualBudgetMs = SELECTED_RERANK_BUDGET_MS.manual;
    const base = { liveBudgetMs, manualBudgetMs };

    if (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs <= 0) {
        return { ...base, fitsLive: true, fitsManual: true };
    }

    const fitsLive = latencyMs <= liveBudgetMs;
    const fitsManual = latencyMs <= manualBudgetMs;

    if (fitsLive && fitsManual) return { ...base, fitsLive, fitsManual };

    if (fitsManual) {
        return {
            ...base, fitsLive, fitsManual,
            warning: `Measured at ${latencyMs}ms, over the ${liveBudgetMs}ms live budget. `
                + 'This reranker will not affect live answers, but still applies to manual '
                + 'and document-grounded ones.',
        };
    }

    return {
        ...base, fitsLive, fitsManual,
        warning: `Measured at ${latencyMs}ms, over both rerank budgets `
            + `(${liveBudgetMs}ms live, ${manualBudgetMs}ms manual). `
            + 'This reranker will not change your results. Choose a faster model.',
    };
}
