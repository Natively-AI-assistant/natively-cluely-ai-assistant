/**
 * The two text utilities Auto Answer still needs after the V3 detector was
 * retired (2026-08-25). They were the only part of ~400 lines of heuristic
 * question-shape matching that survived the move to an LLM judge: everything
 * else — the interrogative regexes, dialogue-act classification, the
 * answerability composite — existed to GUESS what the judge now decides, and
 * generalised badly enough across five test videos to be worth deleting
 * rather than maintaining.
 *
 * Pure, no state, no I/O.
 */

export function normalizeForCompare(s: string): string {
    return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function tokenContainment(needle: string, haystack: string): number {
    const nq = normalizeForCompare(needle).split(' ').filter(Boolean);
    if (nq.length === 0) return 0;
    const have = new Set(normalizeForCompare(haystack).split(' ').filter(Boolean));
    let hit = 0;
    for (const t of nq) if (have.has(t)) hit++;
    return hit / nq.length;
}
