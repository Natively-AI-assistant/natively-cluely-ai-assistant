/**
 * Auto Answer thresholds. The ternary policy function that used to live here
 * went with the V3 controller (2026-08-25): the judge now returns the decision
 * itself, so there is nothing left to compute from a score — only the bars the
 * engine compares its verdict against, which the mode policy registry
 * overrides per mode.
 */

export interface AutoAnswerThresholds {
    /** Fire an automatic answer at or above this answerability. */
    autoThreshold: number;
    /** Render the offer card at or above this answerability (below autoThreshold). */
    offerThreshold: number;
    /** Start speculative preparation at or above this (pre-commit). */
    speculationThreshold: number;
}

/**
 * The compiled-in fallback, used only until the mode policy registry resolves
 * the real per-mode bars at meeting start. These were the retired detector's
 * interrogative constants (0.88 / 0.65 / 0.82); they are inlined here now that
 * the detector is gone, and production overrides them with the stricter
 * no-mode meeting bar anyway. Unfitted placeholders.
 */
export const DEFAULT_THRESHOLDS: AutoAnswerThresholds = {
    autoThreshold: 0.88,
    offerThreshold: 0.65,
    speculationThreshold: 0.82,
};

