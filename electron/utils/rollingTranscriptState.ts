/**
 * Pure helpers for the overlay rolling transcript bar.
 *
 * Coalesced OpenAI STT emits growing partial previews (full segment text per
 * tick) and one final per utterance. These helpers replace the in-progress
 * tail on partials and avoid duplicating text when a final matches the preview.
 */

const FINAL_SEPARATOR = '  ·  ';

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

  // Same utterance — coalescer preview grew within the current segment.
  if (!prefix && inProgress && (text.startsWith(inProgress) || inProgress.startsWith(text))) {
    return text;
  }
  if (prefix && (text.startsWith(inProgress) || inProgress.startsWith(text) || !inProgress)) {
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

  if (inProgress && (text.startsWith(inProgress) || inProgress.startsWith(text))) {
    return prefix + text;
  }

  if (prev.endsWith(text) && inProgress.endsWith(text)) {
    return prev;
  }

  return prev ? prev + FINAL_SEPARATOR + text : text;
}
