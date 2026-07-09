// electron/services/knowledge/OkfProfileVerifier.ts
//
// OKF Profile Intelligence upgrade (2026-07-02) — verifies each generated
// profile card is grounded in the candidate's structured source text, the
// direct analogue of OkfVerifier for document cards. Profile cards differ from
// document cards in one structural way: they have NO source page numbers (a
// resume is a structured JSON blob, not a paginated PDF), so the "no source
// page" rejection in OkfVerifier does NOT apply here. Everything else — empty
// type, invalid conceptId/slug, no source quote, body-not-grounded-in-source —
// is enforced identically, so a hallucinated profile card (an invented employer
// or fabricated metric) is rejected before it can ever reach retrieval.
//
// "Source text" for a profile card is the serialized structured_data the card
// was transformed from (identity + experience bullets + projects + skills for a
// resume; requirements + keywords for a JD; the artifact JSON for an AOT card).
// Because ProfileCardTemplates only ever copies fields OUT of that structured
// data (never invents), a correctly-built card's body words are all present in
// the source string and it passes; a future LLM-synthesized profile card that
// drifts from the source would fail here exactly as a document card would.

import type { CardVerificationResult, KnowledgeCard } from './types';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or',
  'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those',
  'it', 'its', 'as', 'by', 'from', 'has', 'have', 'had', 'not', 'but', 'which',
  // Deterministic connective/scaffolding vocabulary the ProfileCardTemplates
  // builders emit around the real substantive tokens ("The candidate lists the
  // following...", "Approximately N years of total professional experience.").
  // These words are template-introduced, not source-derived, so counting them
  // against grounding would penalise honest cards while doing nothing to detect
  // fabrication (a fabricated card fails because its SUBSTANTIVE tokens — invented
  // companies, skills, metrics — are absent from source, not because of scaffolding).
  'candidate', 'resume', 'lists', 'following', 'key', 'contributions',
  'name', 'based', 'approximately', 'professional', 'experience', 'total',
  'years', 'year', 'month', 'months', 'present', 'gpa', 'technologies',
  'target', 'role', 'level', 'location', 'company', 'suggested', 'range',
  'match', 'matched', 'gaps', 'gap', 'values', 'terms', 'job', 'description',
]);

function contentWords(text: string): string[] {
  const matches: string[] = text.toLowerCase().match(/\b[a-z0-9][a-z0-9+#.-]*[a-z0-9]\b/g) || [];
  return matches.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

// Looser than the document verifier's 0.3: profile card bodies contain
// deterministic connective scaffolding ("Key contributions from the resume:",
// "The candidate lists the following...") that is intentionally NOT in the raw
// structured source, plus formatting tokens. The real fabrication signal is
// whether the SUBSTANTIVE tokens (names, companies, skills, bullet words) are
// present — those all come from the source by construction. 0.5 catches a card
// whose body is genuinely disconnected from its source while tolerating the
// template scaffolding (which the STOPWORDS set above already strips).
const REJECT_GROUNDING_THRESHOLD = 0.5;

function groundingScore(cardBody: string, sourceText: string): number {
  const bodyWords = new Set(contentWords(cardBody));
  if (bodyWords.size === 0) return 1; // empty-after-stopwords body (pure scaffold) — nothing to fabricate
  const sourceLower = sourceText.toLowerCase();
  let found = 0;
  for (const w of bodyWords) {
    if (sourceLower.includes(w)) found++;
  }
  return found / bodyWords.size;
}

export function verifyProfileCard(card: KnowledgeCard, sourceText: string): CardVerificationResult {
  const reasons: string[] = [];

  if (!card.type) reasons.push('empty type');
  if (!card.conceptId || card.conceptId.trim().length === 0) reasons.push('invalid conceptId');
  if (!card.slug || card.slug.trim().length === 0) reasons.push('invalid slug');
  // NOTE: profile cards legitimately have no source PAGE (no pagination), so —
  // unlike OkfVerifier — "no source page" is NOT a rejection reason here. A
  // source QUOTE is still required: it's the traceable evidence phrase.
  if (!card.sourceQuotes || card.sourceQuotes.length === 0 || !card.sourceQuotes[0]?.text?.trim()) {
    reasons.push('no source quote');
  }

  const score = groundingScore(card.body, sourceText);
  let downgradedConfidence: CardVerificationResult['downgradedConfidence'];
  if (score < REJECT_GROUNDING_THRESHOLD) {
    reasons.push(`profile card body not grounded in structured source (overlap=${score.toFixed(2)})`);
  } else if (score < 0.75 && card.confidence === 'high') {
    downgradedConfidence = 'medium';
  }

  const structuralFailure = reasons.some((r) =>
    r === 'empty type' || r === 'invalid conceptId' || r === 'invalid slug' || r === 'no source quote',
  );
  const rejected = structuralFailure || score < REJECT_GROUNDING_THRESHOLD;

  return { cardId: card.id, ok: reasons.length === 0, downgradedConfidence, rejected, reasons };
}

export function verifyProfileCards(cards: KnowledgeCard[], sourceText: string): {
  accepted: KnowledgeCard[];
  rejected: Array<{ card: KnowledgeCard; result: CardVerificationResult }>;
  results: CardVerificationResult[];
} {
  const accepted: KnowledgeCard[] = [];
  const rejected: Array<{ card: KnowledgeCard; result: CardVerificationResult }> = [];
  const results: CardVerificationResult[] = [];

  for (const card of cards) {
    const result = verifyProfileCard(card, sourceText);
    results.push(result);
    if (result.rejected) {
      rejected.push({ card, result });
      continue;
    }
    accepted.push(result.downgradedConfidence ? { ...card, confidence: result.downgradedConfidence } : card);
  }

  return { accepted, rejected, results };
}
