// electron/context-intelligence/retrieval/query-rewrite.ts
//
// Distilling a retrieval query the QUESTION declares structurally.
//
// Extracted from `legacy-retrieval-port.ts` (2026-08-28) without behaviour
// change, so a second caller can use it: the post-stream doc-grounded validator
// in IntelligenceEngine, which used to retry a failed check with the SAME query
// text that had just failed. A second identical retrieval is not a repair
// attempt — it is the same attempt — so the refusal it guarded shipped whenever
// the first pass missed.
//
// The port's original note, which still explains the whole design:
//
//   * "What is TECH-PDF-START-481 associated with?" — the chunk containing the
//     identifier was never a candidate; six sibling chunks of the same PDF were.
//   * "What is the last-page canary?" — the last-page chunk (chunk 13 of 14)
//     missed the cut while pages 3-13 filled every accepted slot.
//
// Both are exact lookups the QUESTION declares structurally, so they can be
// recovered without fixture knowledge and without raising topK globally: ONE
// bounded retry with a distilled query, fired only when the admitted evidence
// visibly lacks what was asked for.

/**
 * Hyphenated codes: >=2 hyphen segments AND (a digit or all-caps), so
 * "QF-2026-0514" and "TECH-PDF-START-481" match while hyphenated prose
 * ("state-of-the-art", "end-to-end") does not.
 */
const IDENTIFIER_RE = /\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+){2,}\b/g;

export const extractIdentifiers = (question: string): string[] =>
  (question.match(IDENTIFIER_RE) ?? ([] as string[])).filter((t) => /\d/.test(t) || t === t.toUpperCase());

/**
 * Positional-page qualifiers: the compound form only ("last-page", "first
 * section"), never a bare positional word — "last quarter revenue" must not
 * trigger document-position targeting.
 */
export const POSITIONAL_RE = /\b(first|last|final|middle|start|starting|opening|end|ending|closing)[-\s](page|pages|section|paragraph|line|chunk)s?\b/i;

export type PositionalDirection = 'first' | 'last' | 'middle';

export const positionalDirection = (question: string): PositionalDirection | undefined => {
  const m = question.match(POSITIONAL_RE);
  if (!m) return undefined;
  const w = m[1].toLowerCase();
  if (w === 'middle') return 'middle';
  return w === 'first' || w === 'start' || w === 'starting' || w === 'opening' ? 'first' : 'last';
};

/**
 * A DIFFERENT query to retry a failed retrieval with, or null when the question
 * offers nothing to distil.
 *
 * Returning null is the important half. A retry is only worth a second
 * retrieval when the question carries a structural handle the first pass may
 * have ranked past — an exact identifier, or a document-position compound that
 * lexical search reads as part of the head term. When it carries neither, the
 * honest answer is "no rewrite available" and the caller should not spend a
 * retrieval to ask the same thing twice.
 *
 * `alreadyCovered` lets the caller say which identifiers the first pass DID
 * return, so an identifier retry fires only when one is genuinely missing.
 */
export function rewriteQueryForRetry(
  question: string,
  alreadyCovered: string = '',
): { query: string; reason: 'targeted_exact_lookup' | 'targeted_positional' } | null {
  const identifiers = extractIdentifiers(question);
  const haystack = alreadyCovered.toLowerCase();
  const missing = identifiers.filter((id) => !haystack.includes(id.toLowerCase()));
  if (missing.length > 0) {
    return { query: missing.join(' '), reason: 'targeted_exact_lookup' };
  }
  if (positionalDirection(question)) {
    // Strip the positional compound so lexical search finds the asked-for head
    // term wherever it sits ("last-page canary" -> "canary").
    const stripped = question.replace(new RegExp(POSITIONAL_RE.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
    if (stripped && stripped !== question.trim()) {
      return { query: stripped, reason: 'targeted_positional' };
    }
  }
  return null;
}
