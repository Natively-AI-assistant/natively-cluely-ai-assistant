/**
 * Filters common Whisper hallucinations.
 * Returns an empty string if the text is a known hallucination,
 * otherwise returns the trimmed text.
 */

const EXACT_BLOCKS = new Set([
  '[music]',
  '[applause]',
  '[inaudible]',
  '(music)',
  'thank you for watching',
  'thanks for watching',
  'you',
  'bye',
  '...',
  '.',
]);

// Matches any token that is entirely wrapped in square brackets e.g. [Noise], [BLANK_AUDIO]
const BRACKET_TOKEN_RE = /^\[.*\]$/;

export function filterHallucination(text: string): string {
  const trimmed = text.trim();

  // Too short
  if (trimmed.length < 2) return '';

  const lower = trimmed.toLowerCase();

  // Exact match against known hallucinations
  if (EXACT_BLOCKS.has(lower)) return '';

  // Any token that is purely a bracketed tag
  if (BRACKET_TOKEN_RE.test(trimmed)) return '';

  return trimmed;
}
