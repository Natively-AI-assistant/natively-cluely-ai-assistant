// electron/services/knowledge/OkfRetriever.ts
//
// OKF Phase 3 — queries OKF Knowledge Cards for a question. Deterministic
// lexical scoring (no embeddings — cards are few enough per pack, typically
// 20-60, that a full lexical scan is cheap and avoids a second embedding
// space). For synthesis questions (main_topic, summary, research_questions,
// objectives, conclusion) returns ALL cards ordered by document position
// (cards array is already front-matter-first per OkfExtractor's section
// order) — per the migration plan's retrieval design.

import type { KnowledgeCard, KnowledgePack } from './types';
import type { QuestionClassification } from './QuestionClassifier';
import { getCachedRetrieval, setCachedRetrieval } from './KnowledgeCache';

export interface ScoredCard {
  card: KnowledgeCard;
  score: number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or',
  'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those',
  'it', 'its', 'as', 'by', 'from', 'has', 'have', 'had', 'not', 'but', 'which',
  'what', 'when', 'where', 'who', 'how', 'why', 'does', 'did', 'my', 'about',
]);

function contentWords(text: string): string[] {
  const matches: string[] = text.toLowerCase().match(/\b[a-z0-9][a-z0-9-]*[a-z0-9]\b/g) || [];
  return matches.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

const CONFIDENCE_BOOST: Record<KnowledgeCard['confidence'], number> = { high: 0.15, medium: 0.05, low: 0 };
const TYPE_BOOST_FOR_QUESTION_TYPE: Partial<Record<string, Partial<Record<KnowledgeCard['type'], number>>>> = {
  research_questions: { concept: 0.2, section: 0.1 },
  objectives: { concept: 0.2, section: 0.1 },
  result: { result: 0.25 },
  conclusion: { conclusion: 0.25, section: 0.1 },
  method: { methodology: 0.25 },
  definition: { definition: 0.25, concept: 0.15 },
};

function scoreCard(card: KnowledgeCard, queryWords: Set<string>, targetEntities: string[], classification: QuestionClassification): number {
  const titleWords = contentWords(card.title);
  const titleHits = titleWords.filter((w) => queryWords.has(w)).length;
  const titleScore = titleWords.length > 0 ? titleHits / Math.sqrt(titleWords.length) : 0;

  const bodyWords = contentWords(card.body);
  const bodyWordSet = new Set(bodyWords);
  const bodyHits = [...queryWords].filter((w) => bodyWordSet.has(w)).length;
  const bodyScore = queryWords.size > 0 ? bodyHits / queryWords.size : 0;

  const entityLower = card.entities.map((e) => e.toLowerCase());
  const entityHits = targetEntities.filter((e) => entityLower.includes(e.toLowerCase())).length;
  const entityScore = targetEntities.length > 0 ? entityHits / targetEntities.length : 0;

  // Exact title match (case-insensitive) is a strong signal for entity_lookup questions.
  const exactTitleBoost = targetEntities.some((e) => e.toLowerCase() === card.title.toLowerCase()) ? 0.4 : 0;

  const tagWords = card.tags.flatMap((t) => contentWords(t));
  const tagHits = tagWords.filter((w) => queryWords.has(w)).length;
  const tagScore = tagWords.length > 0 ? tagHits / tagWords.length : 0;

  const typeBoost = TYPE_BOOST_FOR_QUESTION_TYPE[classification.type]?.[card.type] || 0;
  const confidenceBoost = CONFIDENCE_BOOST[card.confidence];

  return (
    0.35 * titleScore +
    0.30 * bodyScore +
    0.20 * entityScore +
    0.05 * tagScore +
    exactTitleBoost +
    typeBoost +
    confidenceBoost
  );
}

export interface OkfRetrieveOptions {
  topN?: number;
  minScore?: number;
  /** OKF Phase 7: when set, enables the retrieval-result cache keyed by (fileId, pack.packVersion, topN, question). */
  fileId?: string;
}

/**
 * Queries `pack.cards` for the given question. Synthesis questions return
 * ALL cards (capped at topN) in document order, since the answer requires
 * spanning multiple sections — scoring would arbitrarily drop relevant
 * context. Non-synthesis questions return the topN highest-scoring cards
 * above minScore.
 *
 * OKF Phase 7: when `options.fileId` is provided, results are cached
 * (keyed by fileId + pack.packVersion + topN + normalized question) so a
 * repeated identical question — e.g. the false-refusal validator's
 * re-retrieval in ipcHandlers.ts hitting the SAME question the main answer
 * path just scored — skips the lexical scoring pass entirely. Cache is
 * invalidated automatically on packVersion bump (regenerate/edit/approve/
 * reject all increment it), so a stale scored card can never leak through.
 */
export function queryOkfCards(
  pack: KnowledgePack,
  question: string,
  classification: QuestionClassification,
  options: OkfRetrieveOptions = {},
): ScoredCard[] {
  const topN = options.topN ?? 6;
  const minScore = options.minScore ?? 0.12;

  if (options.fileId) {
    const cached = getCachedRetrieval(options.fileId, pack.packVersion, question, topN);
    if (cached) return cached;
  }

  // OKF Phase 6: a user-rejected card is excluded from retrieval entirely —
  // approved/generated/needs_review cards are all still served (rejection is
  // the only status that opts a card OUT). User-edited card bodies are
  // whatever is currently in `card.body`, which is exactly what
  // OkfCardEditor.editCard() writes — no separate "edited" lookup needed,
  // the card row IS the edit.
  const retrievableCards = pack.cards.filter((c) => c.approvalStatus !== 'rejected');

  let result: ScoredCard[];
  if (classification.isSynthesis) {
    result = retrievableCards.slice(0, topN).map((card) => ({ card, score: 1 }));
  } else {
    const queryWords = new Set(contentWords(question));
    if (queryWords.size === 0 && classification.targetEntities.length === 0) {
      result = [];
    } else {
      const scored: ScoredCard[] = retrievableCards.map((card) => ({
        card,
        score: scoreCard(card, queryWords, classification.targetEntities, classification),
      }));
      result = scored
        .filter((s) => s.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topN);
    }
  }

  if (options.fileId) setCachedRetrieval(options.fileId, pack.packVersion, question, topN, result);
  return result;
}
