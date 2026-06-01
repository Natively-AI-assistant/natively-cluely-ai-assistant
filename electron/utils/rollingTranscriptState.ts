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

/** Normalise a string for overlap comparison only — never used for display. */
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/[\p{Pd}]+/gu, ' ')   // dashes/hyphens → space (state-of-the-art → state of the art)
    .replace(/[\p{P}\p{S}]+/gu, '') // strip remaining punctuation and symbols (curly quotes, periods, etc.)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Index after the last finalized segment separator, or -1 when none. */
export function lastFinalSeparatorIndex(prev: string): number {
  return prev.lastIndexOf(FINAL_SEPARATOR);
}

/** Prefix containing all committed (finalized) segments including trailing separator. */
export function committedRollingPrefix(prev: string): string {
  const idx = lastFinalSeparatorIndex(prev);
  return idx >= 0 ? prev.substring(0, idx + FINAL_SEPARATOR.length) : '';
}

/** In-progress (non-final) tail after the last separator. */
export function inProgressRollingTail(prev: string): string {
  const idx = lastFinalSeparatorIndex(prev);
  return idx >= 0 ? prev.substring(idx + FINAL_SEPARATOR.length) : prev;
}

/** Apply a partial preview — replaces the in-progress tail, never clears committed text. */
export function mergeRollingTranscriptPartial(prev: string, partialText: string): string {
  const text = partialText.trim();
  if (!text) return prev;

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
    return prev + FINAL_SEPARATOR + text;
  }

  return text;
}

/** Commit a final segment — replaces matching in-progress tail instead of duplicating. */
export function mergeRollingTranscriptFinal(prev: string, finalText: string): string {
  const text = finalText.trim();
  if (!text) return prev;

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

  return prev ? prev + FINAL_SEPARATOR + text : text;
}
