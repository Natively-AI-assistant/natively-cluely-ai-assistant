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

/**
 * The relay finalizes a PREFIX of its own interim, cut at an arbitrary
 * character offset — which lands mid-word often enough to mangle every
 * downstream reader:
 *
 *   interim  ", and where it gets interesting is I want you to"
 *   final    ", and where it gets interest"     <- 28 chars, cut inside a word
 *   interim  "ing is I want you to be able to get a"   (resumes at the cut)
 *
 * Joining those two finals with a space yields "gets interest ing", and the
 * judge, the answer and every token comparison read the mangled form. A real
 * session produced "Inserting a val ue", "no duplic ates allowed" and
 * "And among the val".
 *
 * The cut is DECIDABLE, not guessable: at the moment a final arrives the
 * interim it was cut from is still in hand, so the character sitting at the
 * cut offset says whether a word was split. Both sides must be word
 * characters — "…you to" + "be able…" is a space in the interim and must stay
 * two words, which is exactly the case a lowercase-continuation heuristic
 * would get wrong.
 */
export function isMidWordCut(finalText: string, latestInterim: string): boolean {
    if (!finalText || !latestInterim) return false;
    if (latestInterim.length <= finalText.length) return false;
    if (!latestInterim.startsWith(finalText)) return false;   // the STT revised it: no claim
    const before = finalText[finalText.length - 1];
    const after = latestInterim[finalText.length];
    // A contraction may be cut on EITHER side of its apostrophe — the live
    // session split "we|'re going" and "I'|m just curious" — so an apostrophe
    // counts as word-continuation. Requiring at least one true word character
    // keeps the sentence seam ("…probability.|So just these") unglued, which
    // is the case the word-character test exists for.
    const word = (c: string) => /\w/.test(c);
    const apos = (c: string) => c === "'" || c === '\u2019';
    if (apos(before) && apos(after)) return false;
    return (word(before) || apos(before)) && (word(after) || apos(after));
}

/** Join relay finals, closing the seam where `glueNext` marks a split word. */
export function joinTranscriptParts(parts: ReadonlyArray<{ text: string; glueNext?: boolean }>): string {
    let out = '';
    for (let i = 0; i < parts.length; i++) {
        if (i === 0) { out = parts[i].text; continue; }
        out += (parts[i - 1].glueNext ? '' : ' ') + parts[i].text;
    }
    return out.replace(/\s+/g, ' ').trim();
}
