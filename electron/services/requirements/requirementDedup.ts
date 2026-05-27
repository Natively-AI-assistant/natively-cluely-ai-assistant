/** Normalize requirement text for dedup comparisons (format only — not semantic classification). */
export function normalizeRequirementText(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Word-set Jaccard similarity for near-duplicate detection after LLM extraction. */
export function requirementSimilarity(a: string, b: string): number {
    const wordsA = new Set(normalizeRequirementText(a).split(' ').filter(Boolean));
    const wordsB = new Set(normalizeRequirementText(b).split(' ').filter(Boolean));
    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let intersection = 0;
    wordsA.forEach((w) => { if (wordsB.has(w)) intersection++; });
    return intersection / (wordsA.size + wordsB.size - intersection);
}

export const REQUIREMENT_DEDUP_THRESHOLD = 0.72;

export function isDuplicateRequirement(a: string, b: string): boolean {
    return requirementSimilarity(a, b) >= REQUIREMENT_DEDUP_THRESHOLD;
}
