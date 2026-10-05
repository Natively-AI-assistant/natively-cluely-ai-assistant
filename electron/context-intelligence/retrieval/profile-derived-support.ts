// electron/context-intelligence/retrieval/profile-derived-support.ts
//
// Derived-evidence hygiene for Profile Intelligence (2026-09-30).
//
// THE PROBLEM
// The résumé's structured extraction is an LLM call, and one of its fields is
// allowed to be WRITTEN rather than extracted: the premium StructuredExtractor
// prompt says "if a description is not explicitly provided, generate a concise
// 1-sentence summary based on the project name, technologies used, and any
// available context clues". That sentence then renders as RESUME evidence —
// the highest-authority source for claims about the user — so a model-invented
// "used by 2,000 students" is indistinguishable from a line the candidate wrote.
// The extractor also fills missing identity with placeholders ("Unknown
// Candidate", "Unknown Role", "Unknown Location") that are not in any document.
//
// THE RULE
// A derived field is kept only if the raw document text SUPPORTS it:
//   1. every number it states appears in the raw text (after the tokenizer's
//      numeral canonicalisation, so "16k" and "16,000" are the same quantity) —
//      an invented figure is the costliest fabrication in an interview answer,
//      so one unsupported number rejects the field outright; and
//   2. at least DERIVED_SUPPORT_MIN_COVERAGE of its distinctive content words
//      (function words removed, light suffix folding) occur in the raw text.
// No raw text ⇒ nothing can be verified ⇒ the derived field is dropped (fail
// closed). Only DERIVED fields are tested; extracted fields (names, bullets,
// highlights, skills) and the lossless raw-text chunks are untouched, so the
// facts a generated summary was paraphrasing stay reachable.
//
// WHY THIS IS ROBUST
// It asks one question — "does the candidate's own document say this?" — with
// the same tokenizer the retrieval ranker uses, so there is no second notion of
// a "word". It needs no model and no list of suspicious phrasings; a summary
// that paraphrases the résumé in the résumé's own vocabulary passes, while a
// sentence built from "context clues" (a purpose, an audience, a metric the
// document never states) fails on the words it had to add. Coverage is a
// fraction, so a stray connective does not sink a faithful summary.
//
// Pure: no Electron, no DB — importable from the V3 port and the legacy JIT.

import { wordsOf, isProbeFunctionWord } from '../../services/modes/lexicalTokens';

/** Fraction of a derived field's distinctive content words the raw text must contain. */
export const DERIVED_SUPPORT_MIN_COVERAGE = 0.75;

/** Values the extractor substitutes when a field is missing. Never document facts. */
const EXTRACTOR_PLACEHOLDERS = new Set(['unknown', 'unknown candidate', 'unknown role', 'unknown location', 'n/a']);

export function isExtractorPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && EXTRACTOR_PLACEHOLDERS.has(value.trim().toLowerCase());
}

/** Symmetric light suffix folding so "expenses"/"expense" and "managed"/"manage" meet. */
function fold(word: string): string {
  if (/\d/.test(word)) return word;
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

const tokensOf = (text: string): string[] => wordsOf(text, { shortNumerics: true })
  .filter((w) => !isProbeFunctionWord(w))
  .map(fold);

export interface SupportIndex {
  readonly tokens: ReadonlySet<string>;
}

/** Index the raw document text once per document; null when there is no text. */
export function buildSupportIndex(rawText: string | null | undefined): SupportIndex | null {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;
  return { tokens: new Set(tokensOf(rawText)) };
}

export type DerivedSupportReason = 'supported' | 'no_raw_text' | 'unsupported_number' | 'low_coverage';

export interface DerivedSupportVerdict {
  supported: boolean;
  reason: DerivedSupportReason;
  /** Share of distinctive non-numeric words found in the raw text (1 when there are none). */
  coverage: number;
}

/** Does the raw document support this derived text? See the file header for the rule. */
export function assessDerivedSupport(
  text: string,
  index: SupportIndex | null,
  minCoverage: number = DERIVED_SUPPORT_MIN_COVERAGE,
): DerivedSupportVerdict {
  if (!index) return { supported: false, reason: 'no_raw_text', coverage: 0 };
  const distinct = [...new Set(tokensOf(text))];
  // Pure digit strings only: "16k" also yields its canonical "16000", which is
  // the form compared, so the notation a summary chose cannot fail it.
  const numbers = distinct.filter((t) => /^\d+$/.test(t));
  if (numbers.some((n) => !index.tokens.has(n))) {
    return { supported: false, reason: 'unsupported_number', coverage: 0 };
  }
  const words = distinct.filter((t) => !/\d/.test(t));
  if (words.length === 0) return { supported: true, reason: 'supported', coverage: 1 };
  const found = words.filter((w) => index.tokens.has(w)).length;
  const coverage = found / words.length;
  return coverage >= minCoverage
    ? { supported: true, reason: 'supported', coverage }
    : { supported: false, reason: 'low_coverage', coverage };
}

/**
 * A copy of a structured résumé with its UNSUPPORTED derived content removed:
 * project descriptions the raw text does not support, and extractor
 * placeholder identity values. Everything else is returned as-is. Never throws;
 * a non-object input is returned unchanged.
 */
export function stripUnsupportedDerivedResumeFields<T>(structured: T, rawText: string | null | undefined): T {
  if (!structured || typeof structured !== 'object') return structured;
  try {
    const sd = structured as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = { ...sd };
    const identity = sd.identity;
    if (identity && typeof identity === 'object') {
      const id = { ...(identity as Record<string, unknown>) };
      for (const key of ['name', 'location']) {
        if (isExtractorPlaceholder(id[key])) id[key] = '';
      }
      out.identity = id;
    }
    if (Array.isArray(sd.projects)) {
      const index = buildSupportIndex(rawText);
      out.projects = sd.projects.map((p) => {
        if (!p || typeof p !== 'object') return p;
        const proj = p as Record<string, unknown>;
        const desc = typeof proj.description === 'string' ? proj.description.trim() : '';
        if (!desc) return p;
        if (assessDerivedSupport(desc, index).supported) return p;
        const { description: _dropped, ...rest } = proj;
        return rest;
      });
    }
    return out as unknown as T;
  } catch {
    return structured;
  }
}

/**
 * Is this OKF card LLM-composed rather than rendered from the documents?
 * AOT artifact cards (intro, gap-analysis pivot scripts, mock-interview
 * answer keys, culture mapping, negotiation strategy) are model output about
 * the candidate; serving them as RESUME / JOB_DESCRIPTION evidence gives them
 * the authority of the documents they were generated from.
 */
export function isGeneratedArtifactCard(card: { type?: string; generatedFrom?: string }): boolean {
  return card.generatedFrom === 'aot_artifact'
    || (typeof card.type === 'string' && card.type.startsWith('artifact_'));
}
