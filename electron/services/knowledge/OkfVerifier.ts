// electron/services/knowledge/OkfVerifier.ts
//
// OKF Phase 2 — Step 8 of the ingestion pipeline: verify each card's body
// claims are actually findable in the underlying source content (token-
// overlap heuristic, no LLM call). Cards with no source page, no source
// quote, empty type, or weak grounding are downgraded or rejected per the
// migration plan's acceptance gate ("OkfVerifier must reject or downgrade
// cards with: no source page, no source quote, unsupported body, empty
// type, invalid YAML frontmatter, invalid conceptId/slug, body not grounded
// in source text").
//
// KNOWN LIMITATIONS (2026-07-01, senior review — documented, not fixed, per
// review triage): this is a bag-of-words token-overlap heuristic, not a
// semantic checker, and two adversarial classes remain that a determined
// attacker (or a hallucinating LLM producing card text some future phase
// might feed through this path) could exploit:
//   1. Multi-sentence-split fabrication: splitting a fabricated claim across
//      several short sentences, each individually below
//      MIN_SENTENCE_WORDS_TO_SCORE, evades the per-sentence check (added
//      below to catch a SINGLE fabricated sentence) since no one sentence
//      is ever scored on its own.
//   2. Negation flip: a sentence asserting the OPPOSITE of the source using
//      the source's own vocabulary ("does NOT achieve 43x faster...") scores
//      identically to a grounded sentence under pure token overlap, since
//      overlap counts shared words, not shared meaning/polarity.
// Both require semantic/NLI-style verification (not pure lexical overlap)
// to close — out of scope for heuristic v1's no-LLM-call design constraint.
// If this matters for a future phase, the fix is an LLM-based verification
// pass, not a bigger regex.

import type { CardVerificationResult, KnowledgeCard } from './types';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or',
  'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those',
  'it', 'its', 'as', 'by', 'from', 'has', 'have', 'had', 'not', 'but', 'which',
]);

function contentWords(text: string): string[] {
  const matches: string[] = text.toLowerCase().match(/\b[a-z0-9][a-z0-9-]*[a-z0-9]\b/g) || [];
  return matches.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

const REJECT_CONFIDENCE_THRESHOLD = 0.3;
// Below this, a single SENTENCE within an otherwise well-grounded body is
// treated as an unsupported addition (see per-sentence check below) — set
// looser than REJECT_CONFIDENCE_THRESHOLD because short sentences naturally
// have fewer content words to overlap on.
const SENTENCE_REJECT_THRESHOLD = 0.15;
// A sentence must have at least this many content words to be scored on its
// own — very short sentences ("Also, the tool helps.") are too noisy to
// judge in isolation and are folded into the whole-body score instead.
const MIN_SENTENCE_WORDS_TO_SCORE = 4;

/**
 * Token-overlap grounding check: what fraction of the card body's unique
 * content words actually appear in the source content? A card whose body is
 * mostly invented (or copy-pasted from elsewhere) will score low.
 */
function groundingScore(cardBody: string, sourceContent: string): number {
  const bodyWords = new Set(contentWords(cardBody));
  if (bodyWords.size === 0) return 0;
  const sourceLower = sourceContent.toLowerCase();
  let found = 0;
  for (const w of bodyWords) {
    if (sourceLower.includes(w)) found++;
  }
  return found / bodyWords.size;
}

/**
 * Per-sentence grounding check. The whole-body `groundingScore` above is a
 * bag-of-words average that a fabricated CLAUSE appended after an otherwise
 * verbatim, well-grounded passage can hide inside (the verbatim majority of
 * the body pulls the average score up past the accept threshold even though
 * one sentence is entirely invented). This scans each sentence independently
 * and flags the weakest one — a single sentence with near-zero word overlap
 * in an otherwise-grounded body is exactly the "one unsupported claim
 * smuggled into an honest card" shape this check exists to catch.
 *
 * Deliberately conservative: only sentences with >= MIN_SENTENCE_WORDS_TO_SCORE
 * content words are scored (short transitional sentences are too noisy to
 * judge alone), and the returned score is the MINIMUM across scored
 * sentences — one bad sentence should not be diluted by several good ones,
 * same reasoning as the whole-body check but applied at finer grain.
 */
function minSentenceGroundingScore(cardBody: string, sourceContent: string): number | null {
  const sourceLower = sourceContent.toLowerCase();
  const sentences = cardBody.split(/(?<=[.!?])\s+/);
  let minScore: number | null = null;
  for (const sentence of sentences) {
    const words = contentWords(sentence);
    if (words.length < MIN_SENTENCE_WORDS_TO_SCORE) continue;
    const uniqueWords = new Set(words);
    let found = 0;
    for (const w of uniqueWords) {
      if (sourceLower.includes(w)) found++;
    }
    const score = found / uniqueWords.size;
    if (minScore === null || score < minScore) minScore = score;
  }
  return minScore;
}

export function verifyCard(card: KnowledgeCard, sourceContent: string): CardVerificationResult {
  const reasons: string[] = [];

  if (!card.type) reasons.push('empty type');
  if (!card.conceptId || card.conceptId.trim().length === 0) reasons.push('invalid conceptId');
  if (!card.slug || card.slug.trim().length === 0) reasons.push('invalid slug');
  if (!card.sourcePages || card.sourcePages.length === 0) reasons.push('no source page');
  if (!card.sourceQuotes || card.sourceQuotes.length === 0 || !card.sourceQuotes[0]?.text?.trim()) {
    reasons.push('no source quote');
  }

  const score = groundingScore(card.body, sourceContent);
  let downgradedConfidence: CardVerificationResult['downgradedConfidence'];
  if (score < REJECT_CONFIDENCE_THRESHOLD) {
    reasons.push(`body not grounded in source text (overlap=${score.toFixed(2)})`);
  } else if (score < 0.6 && card.confidence === 'high') {
    downgradedConfidence = 'medium';
  }

  // Per-sentence check (see minSentenceGroundingScore doc comment): catches
  // a single fabricated sentence hiding inside an otherwise well-grounded
  // body, which the whole-body average above can miss (the grounded
  // majority pulls the average score above REJECT_CONFIDENCE_THRESHOLD even
  // when one sentence is entirely invented).
  const sentenceScore = minSentenceGroundingScore(card.body, sourceContent);
  if (sentenceScore !== null && sentenceScore < SENTENCE_REJECT_THRESHOLD) {
    reasons.push(`body contains a sentence with near-zero grounding in source text (min sentence overlap=${sentenceScore.toFixed(2)})`);
  }

  // Structural failures (missing type/conceptId/page/quote) are always
  // rejected outright — they break OKF conformance or basic traceability.
  const structuralFailure = reasons.some((r) =>
    r === 'empty type' || r === 'invalid conceptId' || r === 'invalid slug' || r === 'no source page' || r === 'no source quote',
  );
  const sentenceGroundingFailure = sentenceScore !== null && sentenceScore < SENTENCE_REJECT_THRESHOLD;
  const rejected = structuralFailure || score < REJECT_CONFIDENCE_THRESHOLD || sentenceGroundingFailure;

  return {
    cardId: card.id,
    ok: reasons.length === 0,
    downgradedConfidence,
    rejected,
    reasons,
  };
}

export function verifyCards(cards: KnowledgeCard[], sourceContent: string): {
  accepted: KnowledgeCard[];
  rejected: Array<{ card: KnowledgeCard; result: CardVerificationResult }>;
  results: CardVerificationResult[];
} {
  const accepted: KnowledgeCard[] = [];
  const rejected: Array<{ card: KnowledgeCard; result: CardVerificationResult }> = [];
  const results: CardVerificationResult[] = [];

  for (const card of cards) {
    const result = verifyCard(card, sourceContent);
    results.push(result);
    if (result.rejected) {
      rejected.push({ card, result });
      continue;
    }
    if (result.downgradedConfidence) {
      accepted.push({ ...card, confidence: result.downgradedConfidence });
    } else {
      accepted.push(card);
    }
  }

  return { accepted, rejected, results };
}
