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

/**
 * Containment for MIC-ECHO detection, which `tokenContainment` cannot do.
 *
 * When the interviewer's audio bleeds into the microphone, the two STT
 * sessions segment the same speech at DIFFERENT boundaries, so the echoed
 * fragment routinely straddles two interviewer finals and its edge token is a
 * cut-off word: "technolog" for "technology", "equ" for "equals", "ph" for
 * "phones", "disp" for "display". Exact token equality scores every one of
 * those a miss, which is why a real bled session measured a median containment
 * of 0.80 against a 0.85 bar — the whole population sat just under it.
 *
 * So an edge token also counts when one side is a prefix of the other. The
 * 3-character floor keeps "a"/"an"/"of" from matching half the dictionary;
 * `tokenContainment` is deliberately left alone because the judge's grounding
 * check uses it and wants exact words.
 */
export function echoContainment(needle: string, haystack: string): number {
    const nq = normalizeForCompare(needle).split(' ').filter(Boolean);
    if (nq.length === 0) return 0;
    const hv = normalizeForCompare(haystack).split(' ').filter(Boolean);
    const have = new Set(hv);
    let hit = 0;
    for (const t of nq) {
        if (have.has(t)) { hit++; continue; }
        if (t.length < 3) continue;
        if (hv.some(h => h.length >= 3 && (h.startsWith(t) || t.startsWith(h)))) hit++;
    }
    return hit / nq.length;
}
