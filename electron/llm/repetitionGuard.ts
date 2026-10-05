/**
 * Stop a stuck answer by its repetition, not by its length (2026-10-04).
 *
 * MAX_STREAM_OUTPUT_CHARS was the only stop for a model that loops; at 16,000
 * chars it also cut legitimate long answers (measured: a 900-line list stopped
 * at entry 689, mid-line). A loop has a shape a long answer does not: the text
 * ends in ONE block repeated over and over. Detect that, and the length cap can
 * be generous (48,000) while a loop still ends after a handful of repeats.
 *
 * Periodicity, not block matching: the stream is checked at arbitrary points,
 * usually mid-block, so "the last N·L chars have period L" is the test — it is
 * alignment-independent. Exact characters, no normalisation: a near-repeat is
 * how lists, tables and code legitimately look.
 */

/** Smallest block that counts as a repeated unit (shorter repeats are rules, separators, padding). */
export const REPETITION_MIN_BLOCK = 50;
/** Largest block searched (a paragraph). */
export const REPETITION_MAX_BLOCK = 1500;
/** How many back-to-back copies make a loop. */
export const REPETITION_MIN_REPEATS = 5;
/** A block needs this many distinct characters, so "=====…" or "-----…" is never a loop. */
export const REPETITION_MIN_DISTINCT = 12;
/** Answers shorter than this are never judged. */
export const REPETITION_MIN_TOTAL = 3000;
/** Re-check after this many new characters. */
export const REPETITION_CHECK_EVERY = 400;

export function isRepeatingTail(text: string): boolean {
  const n = text.length;
  for (let L = REPETITION_MIN_BLOCK; L <= REPETITION_MAX_BLOCK; L++) {
    const span = L * REPETITION_MIN_REPEATS;
    if (span > n) break;
    // Period L over the last `span` chars: every char equals the one L before it.
    if (text.slice(n - span + L) !== text.slice(n - span, n - L)) continue;
    if (new Set(text.slice(n - L)).size < REPETITION_MIN_DISTINCT) continue;
    return true;
  }
  return false;
}

/** Streaming wrapper: feed visible text as it arrives; true once the answer is looping. */
export class RepetitionGuard {
  private tail = '';
  private total = 0;
  private sinceCheck = 0;

  feed(chunk: string): boolean {
    if (!chunk) return false;
    this.total += chunk.length;
    this.sinceCheck += chunk.length;
    this.tail = (this.tail + chunk).slice(-(REPETITION_MAX_BLOCK * REPETITION_MIN_REPEATS));
    if (this.total < REPETITION_MIN_TOTAL || this.sinceCheck < REPETITION_CHECK_EVERY) return false;
    this.sinceCheck = 0;
    return isRepeatingTail(this.tail);
  }
}
