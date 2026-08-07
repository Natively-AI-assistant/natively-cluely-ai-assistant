// electron/llm/speculativeSimilarity.ts
//
// Reuse gate for the speculative pre-fetch: when the finished interviewer
// question arrives, decide whether the answer generated from the speculative
// partial can be served, or the generation must restart. Extracted from
// IntelligenceEngine.jaccardSimilarity (PR #427 tech-debt finding, 2026-08-05)
// so the gate is unit-testable and the antonym guard below has a home.

function wordsOf(text: string): Set<string> {
    return new Set(text.toLowerCase().match(/\b\w+\b/g) ?? []);
}

// Blend of Jaccard and containment. Pure Jaccard underestimates similarity
// when the speculative text is a prefix of the final transcript (e.g. "Can you
// walk me through" vs "Can you walk me through your design process?"), so the
// score is max(jaccard, containment * 0.9) — containment being the fraction of
// speculative words covered by the final question.
function blendedTokenSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 1;
    let intersection = 0;
    setA.forEach(w => { if (setB.has(w)) intersection++; });
    const jaccard = intersection / (setA.size + setB.size - intersection);
    const containment = setA.size > 0 ? intersection / setA.size : 0;
    return Math.max(jaccard, containment * 0.9);
}

// Function words plus the generic interview scaffolding ("tell me about a…")
// that appears in nearly every question. These words inflate raw token overlap
// between OPPOSITE questions: "Tell me about a time you succeeded" vs
// "…you failed" shares 6 of its 7 tokens and scored 0.771 — above the 0.75
// reuse threshold — despite needing a completely different answer.
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
    'do', 'does', 'did', 'have', 'has', 'had', 'having',
    'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
    'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
    'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours',
    'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers',
    'it', 'its', 'they', 'them', 'their', 'theirs',
    'and', 'or', 'but', 'not', 'no', 'so', 'if', 'then', 'than',
    'that', 'this', 'these', 'those', 'there', 'here',
    'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'as',
    'some', 'any', 'about', 'please', 'tell', 'give', 'let', 'lets',
]);

function contentWordsOf(text: string): Set<string> {
    const content = new Set<string>();
    wordsOf(text).forEach(w => { if (!STOP_WORDS.has(w)) content.add(w); });
    return content;
}

// Below this blended-similarity level on content words alone, the questions'
// meaning-carrying vocabulary disagrees and a high raw score is stop-word
// inflation. Calibration points: antonym pairs (succeeded/failed,
// strengths/weaknesses) land at 0.45; true prefix completions land at 0.9.
const CONTENT_AGREEMENT_MIN = 0.6;

export function speculativeQuestionSimilarity(speculative: string, final: string): number {
    const raw = blendedTokenSimilarity(wordsOf(speculative), wordsOf(final));
    const contentA = contentWordsOf(speculative);
    const contentB = contentWordsOf(final);
    // A side with no content words (all-scaffold partials like "Can you tell
    // me about") carries no meaning signal — keep the pre-guard behavior.
    if (contentA.size === 0 || contentB.size === 0) return raw;
    const content = blendedTokenSimilarity(contentA, contentB);
    // Content disagreement caps the score below the reuse threshold: stop-word
    // overlap alone must never serve a prepared answer to a different question.
    return content < CONTENT_AGREEMENT_MIN ? Math.min(raw, content) : raw;
}
