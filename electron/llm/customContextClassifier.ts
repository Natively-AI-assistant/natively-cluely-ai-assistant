// electron/llm/customContextClassifier.ts
//
// Backward-compatible custom-context categorisation (REPORT_TO_CHATGPT Phase 3).
//
// Custom context is stored today as a SINGLE trusted blob (Mode.customContext).
// The spec wants it split into three categories so the
// prompt can decide what to include per answer type:
//
//   - pinned     : short, broadly-useful user instructions ("speak concisely",
//                  "I'm a senior backend engineer"). Always safe to surface in a
//                  compressed form.
//   - searchable : facts/notes/docs that should only appear when relevant to the
//                  current question (longer, topical chunks).
//   - sensitive  : salary, confidential pricing, private metrics, hidden
//                  strategy. Only surfaced when the answerType genuinely needs it
//                  (negotiation/sales) — never leaked into a coding/identity turn.
//
// This module does NOT change storage. It is a PURE, read-time classifier over
// the existing blob, so old users keep working with zero migration. It splits on
// blank-line / bullet boundaries, tags each chunk by content heuristics, and
// exposes a selector that picks the categories an AnswerType is allowed to see.
// No I/O, no LLM, no embeddings — cheap enough for the live path and unit-testable.

import type { AnswerType } from './AnswerPlanner';

export type CustomContextCategory = 'pinned' | 'searchable' | 'sensitive';

export interface CustomContextChunk {
  text: string;
  category: CustomContextCategory;
  /** Machine reason for the tag (debug metadata only — safe, no raw content). */
  reason: string;
}

export interface ClassifiedCustomContext {
  pinned: CustomContextChunk[];
  searchable: CustomContextChunk[];
  sensitive: CustomContextChunk[];
  /** True when the blob held any sensitive chunk (for safety telemetry). */
  hasSensitive: boolean;
}

// A chunk is "pinned" when it is a short directive — an instruction about HOW to
// answer rather than a fact to retrieve. Imperative openers + brevity are the
// signal. Kept deliberately small so long notes fall through to searchable.
const PINNED_MAX_CHARS = 160;
const PINNED_DIRECTIVE_RE =
  /^(always|never|please|use|prefer|avoid|keep|be |speak|respond|answer|don'?t|do not|make sure|remember|note:|tone:|style:|i am |i'?m |my role|my name is|call me)\b/i;

// Sensitive = compensation / confidential commercial data / private strategy.
// Matched per-chunk so only the sensitive lines are gated, not the whole blob.
// Deliberately broad: a false POSITIVE (a benign line gated to negotiation-only)
// is a minor relevance loss, but a false NEGATIVE leaks salary/pricing into a
// coding/behavioral answer — the exact failure this gate exists to prevent. The
// lexicon was hardened against real comp/pricing phrasings the original missed
// ("30 lakhs", "$185k base", "TC", "gross margins", "COGS", "do not disclose").
const SENSITIVE_RE =
  /\b(salar(?:y|ies)|compensation|\bctc\b|\blpa\b|\btc\b|lakhs?|\bcrore?s?\b|\bcr\b|base\s+(?:pay|salary)|total\s+comp(?:ensation)?|take[- ]?home|equity|stock|\brsu\b|options?\b|bonus|commission|severance|notice period|garden(?:ing)? leave|confidential|do not (?:share|disclose|reveal|leak)|don'?t (?:share|disclose|reveal)|keep (?:this )?(?:internal|private|confidential)|internal only|\bnda\b|under embargo|gross margins?|net margins?|\bmargins?\b|cost price|\bcogs\b|\bebitda\b|wholesale price|discount (?:floor|ceiling|limit|cap)|(?:price|pricing) (?:floor|cap)|floor price|list price|rack rate|\barr\b|\bmrr\b|\bacv\b|\btcv\b|churn|win rate|quota|burn rate|runway|cap table|valuation|rebate|take rate|bookings)\b/i;

// A money amount (₹/$/explicit unit + number, or number + comp unit) is treated
// as sensitive even when the surrounding word didn't match the lexicon —
// "I make 185k base", "₹30,00,000", "320k TC", "$50/seat" all trip this.
const MONEY_AMOUNT_RE =
  /(?:[$₹€£]\s?\d[\d,.]*|(?<![\w.])\d[\d,.]*\s?(?:k\b|m\b|mm\b|lpa\b|lakhs?\b|cr\b|crores?\b|usd\b|inr\b|million\b|\/(?:seat|user|month|mo|year|yr|seat\/mo)))/i;

const isSensitive = (chunk: string): boolean => SENSITIVE_RE.test(chunk) || MONEY_AMOUNT_RE.test(chunk);

const isLikelyDirective = (chunk: string): boolean =>
  chunk.length <= PINNED_MAX_CHARS && PINNED_DIRECTIVE_RE.test(chunk.trim());

/**
 * Split a raw custom-context blob into chunks. Prefers blank-line separated
 * paragraphs; if there are none, falls back to bullet/newline lines so a flat
 * list of notes still categorises per-line. Empty fragments are dropped.
 */
export const splitCustomContextChunks = (raw: string): string[] => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];
  const byBlankLine = trimmed.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
  if (byBlankLine.length > 1) return byBlankLine;
  // Single paragraph: split on bullet markers / newlines so a notes list still
  // categorises line-by-line (a salary line shouldn't taint a style line).
  // Drop fragments that are only bullet glyphs / punctuation after stripping.
  const hasWordChar = (s: string): boolean => /[A-Za-z0-9]/.test(s);
  const byLine = trimmed
    .split(/\n+/)
    .map(s => s.replace(/^[-*•\s]+/, '').trim())
    .filter(s => s.length > 0 && hasWordChar(s));
  return byLine.length > 0 ? byLine : (hasWordChar(trimmed) ? [trimmed] : []);
};

/**
 * Classify a raw custom-context blob into pinned/searchable/sensitive chunks.
 * Pure and deterministic. Order of precedence per chunk: sensitive > pinned >
 * searchable (a short directive that also names salary is treated as sensitive
 * so it can never leak into a non-negotiation answer).
 */
export const classifyCustomContext = (raw: string): ClassifiedCustomContext => {
  const result: ClassifiedCustomContext = { pinned: [], searchable: [], sensitive: [], hasSensitive: false };
  for (const text of splitCustomContextChunks(raw)) {
    if (isSensitive(text)) {
      result.sensitive.push({ text, category: 'sensitive', reason: 'matched_sensitive_terms' });
      result.hasSensitive = true;
    } else if (isLikelyDirective(text)) {
      result.pinned.push({ text, category: 'pinned', reason: 'short_imperative_directive' });
    } else {
      result.searchable.push({ text, category: 'searchable', reason: 'topical_fact_or_note' });
    }
  }
  return result;
};

// Which answer types are permitted to see SENSITIVE custom context. Sensitive
// data (salary/pricing/strategy) is only justified for compensation and sales
// answers — never for coding, identity, behavioral, JD-fit, etc.
const SENSITIVE_ALLOWED_TYPES = new Set<AnswerType>([
  'negotiation_answer',
]);

// Answer types where NO custom context (not even pinned) should appear, because
// the answer is a self-contained algorithmic/identity artifact and any custom
// note risks polluting it. Mirrors AnswerPlanner's forbidden-layer rules for
// custom_context (coding/DSA/system-design/debugging forbid it).
const CUSTOM_CONTEXT_FORBIDDEN_TYPES = new Set<AnswerType>([
  'coding_question_answer',
  'dsa_question_answer',
  'system_design_answer',
  'debugging_question_answer',
  'identity_answer',
]);

export interface CustomContextSelection {
  /** Chunks selected to include, already category-gated for this answer type. */
  included: CustomContextChunk[];
  /** Categories that were excluded, with a reason (debug metadata, no content). */
  excluded: { category: CustomContextCategory; reason: string }[];
  /** True when a sensitive chunk was deliberately included (safety telemetry). */
  sensitiveIncluded: boolean;
}

/**
 * Select which classified chunks to surface for a given answer type. Pinned and
 * searchable are included for context-bearing answers; sensitive only for the
 * narrow set that needs it. Coding/identity answers get nothing (forbidden).
 *
 * `searchable` selection is intentionally NOT semantic here — that is the job of
 * the existing retrieval layer. This selector's contract is the CATEGORY GATE
 * (what an answer type is allowed to see), so a downstream retriever can still
 * narrow `included` further by relevance.
 */
export const selectCustomContextForAnswer = (
  classified: ClassifiedCustomContext,
  answerType: AnswerType,
): CustomContextSelection => {
  const excluded: CustomContextSelection['excluded'] = [];

  if (CUSTOM_CONTEXT_FORBIDDEN_TYPES.has(answerType)) {
    if (classified.pinned.length) excluded.push({ category: 'pinned', reason: 'forbidden_for_answer_type' });
    if (classified.searchable.length) excluded.push({ category: 'searchable', reason: 'forbidden_for_answer_type' });
    if (classified.sensitive.length) excluded.push({ category: 'sensitive', reason: 'forbidden_for_answer_type' });
    return { included: [], excluded, sensitiveIncluded: false };
  }

  const included: CustomContextChunk[] = [...classified.pinned, ...classified.searchable];

  let sensitiveIncluded = false;
  if (classified.sensitive.length) {
    if (SENSITIVE_ALLOWED_TYPES.has(answerType)) {
      included.push(...classified.sensitive);
      sensitiveIncluded = true;
    } else {
      excluded.push({ category: 'sensitive', reason: 'not_relevant_to_answer_type' });
    }
  }

  return { included, excluded, sensitiveIncluded };
};

/**
 * Convenience: classify + select + render the included chunks back into a single
 * blob suitable for the existing single-string custom-context slot. Backward
 * compatible — when nothing is gated out this returns the same content the old
 * single-blob path would have used. Returns '' when nothing is selected.
 */
export const buildScopedCustomContext = (
  raw: string,
  answerType: AnswerType,
): { text: string; selection: CustomContextSelection; classified: ClassifiedCustomContext } => {
  const classified = classifyCustomContext(raw);
  const selection = selectCustomContextForAnswer(classified, answerType);
  const text = selection.included.map(c => c.text).join('\n');
  return { text, selection, classified };
};

/** PII-free summary of a selection for telemetry (counts + categories only). */
export const summarizeCustomContextSelection = (
  selection: CustomContextSelection,
  classified: ClassifiedCustomContext,
): Record<string, unknown> => ({
  pinned: classified.pinned.length,
  searchable: classified.searchable.length,
  sensitive: classified.sensitive.length,
  includedCount: selection.included.length,
  sensitiveIncluded: selection.sensitiveIncluded,
  excluded: selection.excluded.map(e => `${e.category}:${e.reason}`),
});
