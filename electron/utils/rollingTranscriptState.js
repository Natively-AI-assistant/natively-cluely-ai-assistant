/**
 * Pure helpers for the overlay rolling transcript bar.
 *
 * Coalesced OpenAI STT emits growing partial previews (full segment text per
 * tick) and one final per utterance. These helpers replace the in-progress
 * tail on partials and avoid duplicating text when a final matches the preview.
 *
 * Google STT quirk: interims arrive lowercase without punctuation ("hello world how")
 * while finals have proper capitalisation and punctuation ("Hello world, how are you?")
 * because enableAutomaticPunctuation only applies to final results. All startsWith
 * comparisons must therefore be done on normalised (lowercased, punctuation-stripped)
 * copies — the display strings are never mutated.
 */
const FINAL_SEPARATOR = '  ·  ';
/**
 * Hard cap on the rolling-transcript display string. The bar only ever shows the
 * most recent line or two, but the merge helpers appended every finalized segment
 * forever, so a long meeting grew this React state string without bound — each
 * subsequent merge re-normalised/re-scanned a string that kept getting larger
 * (audit finding #7). 8 KiB is far more than the few hundred chars the UI shows
 * yet small enough that the per-event string work stays flat over a long meeting.
 * The cap drops from the FRONT (oldest committed segments) on a finalized-segment
 * boundary so the visible tail is never cut mid-word.
 */
export const ROLLING_TRANSCRIPT_MAX_CHARS = 8192;
/**
 * Bound a rolling-transcript string to ROLLING_TRANSCRIPT_MAX_CHARS by dropping
 * whole leading segments (split on FINAL_SEPARATOR). Pure; never splits a segment.
 * Returns the input unchanged when already within budget.
 */
export function capRollingTranscript(s, maxChars = ROLLING_TRANSCRIPT_MAX_CHARS) {
    if (s.length <= maxChars)
        return s;
    // Drop whole leading segments until we fit. Keep at least the final segment,
    // even if it alone exceeds the cap (truncating the visible line is worse than
    // a slightly-over-budget single segment, which is already bounded by STT turn).
    let idx = s.indexOf(FINAL_SEPARATOR);
    let out = s;
    while (out.length > maxChars && idx >= 0) {
        out = out.substring(idx + FINAL_SEPARATOR.length);
        idx = out.indexOf(FINAL_SEPARATOR);
    }
    return out;
}
/** Normalise a string for overlap comparison only — never used for display. */
function norm(s) {
    return s.toLowerCase()
        .replace(/[\p{Pd}]+/gu, ' ') // dashes/hyphens → space (state-of-the-art → state of the art)
        .replace(/[\p{P}\p{S}]+/gu, '') // strip remaining punctuation and symbols (curly quotes, periods, etc.)
        .replace(/\s+/g, ' ')
        .trim();
}
/** Index after the last finalized segment separator, or -1 when none. */
export function lastFinalSeparatorIndex(prev) {
    return prev.lastIndexOf(FINAL_SEPARATOR);
}
/** Prefix containing all committed (finalized) segments including trailing separator. */
export function committedRollingPrefix(prev) {
    const idx = lastFinalSeparatorIndex(prev);
    return idx >= 0 ? prev.substring(0, idx + FINAL_SEPARATOR.length) : '';
}
/** In-progress (non-final) tail after the last separator. */
export function inProgressRollingTail(prev) {
    const idx = lastFinalSeparatorIndex(prev);
    return idx >= 0 ? prev.substring(idx + FINAL_SEPARATOR.length) : prev;
}
/** Apply a partial preview — replaces the in-progress tail, never clears committed text. */
export function mergeRollingTranscriptPartial(prev, partialText) {
    const text = partialText.trim();
    if (!text)
        return prev;
    const prefix = committedRollingPrefix(prev);
    const inProgress = inProgressRollingTail(prev);
    const normText = norm(text);
    const normInProgress = norm(inProgress);
    // Same utterance — coalescer preview grew within the current segment.
    if (!prefix && inProgress && (normText.startsWith(normInProgress) || normInProgress.startsWith(normText))) {
        return text;
    }
    if (prefix && (normText.startsWith(normInProgress) || normInProgress.startsWith(normText) || !inProgress)) {
        return prefix + text;
    }
    // New utterance after prior committed content.
    if (prev) {
        return capRollingTranscript(prev + FINAL_SEPARATOR + text);
    }
    return text;
}
/** Commit a final segment — replaces matching in-progress tail instead of duplicating. */
export function mergeRollingTranscriptFinal(prev, finalText) {
    const text = finalText.trim();
    if (!text)
        return prev;
    const prefix = committedRollingPrefix(prev);
    const inProgress = inProgressRollingTail(prev);
    const normText = norm(text);
    const normInProgress = norm(inProgress);
    if (inProgress && (normText.startsWith(normInProgress) || normInProgress.startsWith(normText))) {
        return prefix + text;
    }
    if (norm(inProgress).endsWith(normText) && norm(prev).endsWith(normText)) {
        return prev;
    }
    return capRollingTranscript(prev ? prev + FINAL_SEPARATOR + text : text);
}
