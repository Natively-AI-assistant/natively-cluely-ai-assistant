// Cap a resume summary at exactly three rendered lines in the candidate
// snapshot card.
//
// The Identity → Resume card uses fontSize 11, lineHeight 1.55, with an inner
// content width of ~360px. Empirically that fits ~70 characters per line,
// so the cap that reliably fills 3 lines is ~210 characters (~30 words,
// give or take). Longer summaries snap back to the nearest sentence
// terminator inside the cap so we never end on a sentence fragment and we
// never produce an "…" ellipsis — a clipped thought reads better than a
// fragment with "…".
//
// - Empty / null / non-string input → null (render nothing).
// - Summary at or under SUMMARY_CHAR_CAP → render whole, untouched.
// - Summary over the cap → first SUMMARY_CHAR_CAP characters, snapped to
//   the last sentence terminator (. ! ?) inside the cap that ends ≥ 8 words
//   in (avoid "Hi." being a "complete sentence"). If no terminator exists
//   in the cap, emit the cap verbatim.
//
// Pure function — easy to unit-test, no DOM, no React.

export const SUMMARY_CHAR_CAP = 210;

export const truncateResumeSummary = (raw) => {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.length <= SUMMARY_CHAR_CAP) return trimmed;
    // Cut at SUMMARY_CHAR_CAP, then snap back to the nearest sentence
    // terminator inside the cap. Trim any trailing whitespace/punctuation
    // before re-attaching the terminator.
    const head = trimmed.slice(0, SUMMARY_CHAR_CAP);
    const termMatch = head.match(/([\s\S]*?[.!?])(\s|$)/);
    if (termMatch && termMatch[1].trim().split(/\s+/).length >= 8) {
        return termMatch[1].trim();
    }
    // No terminator inside the cap — emit verbatim (no ellipsis).
    return head;
};