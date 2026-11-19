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
  // YouTube outros from Whisper's training subtitles. Nobody says these in a
  // meeting, and they used to pass with their punctuation ("Thanks for watching!").
  'thank you for watching please subscribe',
  'thanks for watching and see you next time',
  'please subscribe',
  'subtitles by the amara org community',
]);

// A result made only of these is a cough, a breath or a click read as a word:
// Parakeet v3 gave a cough as "Uh", Distil Small EN typing as "Oh Whoa. Oh"
// (2026-11-18). Real one-word answers ("yeah", "okay", "no") are not here.
const INTERJECTIONS = new Set(['uh', 'um', 'umm', 'uhm', 'hmm', 'hm', 'mm', 'mhm', 'ah', 'oh', 'eh', 'er', 'erm', 'whoa', 'huh']);

// A whole result that is one sound label: [Noise], [BLANK_AUDIO], and the
// parenthesised kind Whisper Tiny gave typing and coughs as live captions,
// "(upbeat music)" and "(gunshot)" (2026-11-18). Never something a person said.
const BRACKET_TOKEN_RE = /^(\s*(\[[^\]]*\]|\([^)]*\)))+\s*$/;

export function filterHallucination(text: string): string {
  const trimmed = text.trim();

  // Too short
  if (trimmed.length < 2) return '';

  const lower = trimmed.toLowerCase();

  // Exact match against known hallucinations
  if (EXACT_BLOCKS.has(lower)) return '';
  // Same list with punctuation dropped: "Bye.", "You.", "Thanks for watching!"
  const words = lower.replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (words && EXACT_BLOCKS.has(words)) return '';
  if (words && words.split(' ').every((w) => INTERJECTIONS.has(w))) return '';

  // Any token that is purely a bracketed tag
  if (BRACKET_TOKEN_RE.test(trimmed)) return '';

  // No letter or digit at all is not speech: Distil Small EN turned pure
  // noise into "[?" and "[? [? [ [ [........." (2026-11-18).
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return '';

  return trimmed;
}
