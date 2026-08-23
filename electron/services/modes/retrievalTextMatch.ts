// electron/services/modes/retrievalTextMatch.ts
//
// Tiny shared, deterministic text-match primitives for document-grounded
// retrieval. These deliberately stay below the retriever/planner layers: they
// never see source content outside the currently authorized reference file.

/** Returns true only when `a` and `b` differ by exactly one edit. */
export function levenshtein1(a: string, b: string): boolean {
  const left = String(a || '').toLowerCase();
  const right = String(b || '').toLowerCase();
  if (left === right || Math.abs(left.length - right.length) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (left.length > right.length) i++;
    else if (right.length > left.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + ((left.length - i) || (right.length - j)) === 1;
}

/**
 * Exact substring match first; otherwise permit a one-edit match only for
 * meaningful word tokens. This lets a planner connect ordinary grammatical
 * variants ("weighs" → "weight") without fuzzing short acronyms, IDs, or
 * numeric ordinals.
 */
export function includesPlannerTerm(text: string, term: string): boolean {
  const haystack = String(text || '').toLowerCase();
  const needle = String(term || '').toLowerCase();
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  if (needle.length < 4 || /\d/.test(needle)) return false;
  const words: string[] = haystack.match(/[a-z][a-z-]*/g) || [];
  return words.some((word: string) =>
    word.length >= 4 && (levenshtein1(word, needle)
      // Common English inflection can change two suffix characters ("weigh" →
      // "weighs", "study" → "studies"). This bounded suffix rule remains
      // token-only and never fuzzes acronyms, IDs, or numeric ordinals.
      || (word.startsWith(needle) && word.length === needle.length + 1 && /s$/.test(word))
      || (needle.endsWith('y') && word === `${needle.slice(0, -1)}ies`)),
  );
}
