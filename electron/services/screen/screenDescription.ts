import type { ScreenUnderstandingResult } from './ScreenUnderstandingService';

/**
 * The screenshot a user attached, rendered as text so it survives its own turn.
 *
 * The image itself is gone from the payload long before a follow-up arrives —
 * ScreenshotHelper unlinks past a 5-deep queue, and no path re-sends bytes for
 * an old turn — so this string is ALL a later "what was in that screenshot?"
 * has to read. That is why it is assembled here, once, rather than inline at
 * each call site: the version at ipcHandlers.ts:1488 silently omitted
 * `errors`, so the field the extraction schema names for error lines never
 * reached the conversation ring, and the single most common follow-up
 * ("what was the error code?") lost the one field written to answer it.
 *
 * FIELD ORDER IS LOAD-BEARING. Whatever truncates this — the ring's per-turn
 * cap, the mode's conversation budget — truncates the TAIL, so the sections
 * are ordered by how often a follow-up asks about them. Errors and identifiers
 * are the most-asked and the least reconstructible; a table usually is not.
 *
 * Sections are labelled because the result reaches the model days-deep in a
 * history block with no other framing, and an unlabelled wall of screen text
 * reads as prose the model may treat as its own prior claim.
 */

/**
 * Recorded when a screenshot WAS attached but could not be transcribed — the
 * vision chain had no configured provider, the call failed, or the scope was
 * denied.
 *
 * Observed live: when understand() fails, the turn still answers correctly,
 * because the raw image bytes reach the answering model on a separate path. So
 * nothing looks wrong at the time. Two turns later the follow-up said "I don't
 * have a record of a screenshot ... in our conversation history" — flatly
 * DENYING the screenshot existed, which is worse than admitting it cannot be
 * read: the user knows they sent one, so the answer reads as the assistant
 * losing their data rather than as a transcription gap.
 */
export const SCREEN_NOT_TRANSCRIBED =
  '[a screenshot was attached on this turn, but it could not be transcribed — '
  + 'its contents are NOT available here. Say that it cannot be read back rather '
  + 'than denying a screenshot was sent, and never guess what it showed.]';

/** Section labels, exported so tests and the truncation notice can name them. */
export const SCREEN_DESCRIPTION_SECTIONS = Object.freeze({
  errors: 'Errors on screen',
  summary: 'What was on screen',
  text: 'Visible text',
  code: 'Code on screen',
  tables: 'Tables on screen',
});

function section(label: string, body: string): string {
  const trimmed = body.trim();
  return trimmed ? `${label}:\n${trimmed}` : '';
}

function joinNonEmpty(values: readonly unknown[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
    .join('\n\n');
}

export function composeScreenDescription(
  result: ScreenUnderstandingResult | null | undefined,
): string {
  // `status` is the contract for "there is something to read here". A failed or
  // unavailable result can still carry partial fields, and recording those as
  // though they were a description would put a half-observed screen into the
  // history ring as fact.
  if (!result || result.status !== 'available') return '';

  const errors = joinNonEmpty(result.errors ?? []);
  const code = joinNonEmpty(result.codeBlocks ?? []);
  const tables = joinNonEmpty((result.tables ?? []).map((table) => table?.markdown));

  return [
    section(SCREEN_DESCRIPTION_SECTIONS.errors, errors),
    section(SCREEN_DESCRIPTION_SECTIONS.summary, result.visibleSummary ?? ''),
    section(SCREEN_DESCRIPTION_SECTIONS.text, result.extractedText ?? ''),
    section(SCREEN_DESCRIPTION_SECTIONS.code, code),
    section(SCREEN_DESCRIPTION_SECTIONS.tables, tables),
  ].filter(Boolean).join('\n\n');
}
