// electron/intelligence/context-os/evidenceSufficiency.ts
//
// Canonical pre-dispatch decision for a governed factual turn. This is pure on
// purpose: every generation surface can make the same provider/no-provider
// decision from the exact EvidencePack it will render.

import type { EvidenceItem, EvidencePack } from './evidencePack';
import type { RequestedProperty } from './types';
import { itemSupportsProperty } from './propertyEvidenceValidator';

export type EvidenceSufficiencyReason =
  | 'direct'
  | 'multi_item'
  | 'property_missing'
  | 'entity_missing'
  | 'conflicting'
  | 'low_confidence'
  | 'resolver_unavailable';

export interface EvidenceSufficiency {
  answerable: boolean;
  propertySatisfied: boolean;
  entitySatisfied: boolean;
  confidence: number;
  reason: EvidenceSufficiencyReason;
  usableEvidenceIds: string[];
}

/** Shared resolver/sufficiency floor: below this evidence may not dispatch a factual provider answer. */
export const MIN_ANSWER_CONFIDENCE = 0.32;

const normalize = (value: string): string => value
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const supportsEntity = (item: EvidenceItem, entity: string): boolean => {
  const normalizedEntity = normalize(entity);
  if (!normalizedEntity) return true;
  return normalize(item.supports.entity || '').includes(normalizedEntity)
    || normalize(item.text).includes(normalizedEntity);
};

export function deriveEvidenceSufficiency(input: {
  pack: Pick<EvidencePack, 'items' | 'requestedProperty' | 'coverage' | 'conflicts'>;
  targetEntities?: string[];
  isSynthesis?: boolean;
  resolverUnavailable?: boolean;
}): EvidenceSufficiency {
  const factual = input.pack.items.filter((item) => item.authority === 'evidence');
  const property: RequestedProperty = input.pack.requestedProperty;
  const propertyItems = factual.filter((item) => itemSupportsProperty(item, property));
  const propertySatisfied = property === 'unknown' ? factual.length > 0 : propertyItems.length > 0;
  const entities = [...new Set((input.targetEntities || []).map(normalize).filter(Boolean))];
  const evidenceToCheck = property === 'unknown' ? factual : propertyItems;
  const entitySatisfied = input.isSynthesis === true || entities.length === 0
    || entities.every((entity) => evidenceToCheck.some((item) => supportsEntity(item, entity)));
  const usable = evidenceToCheck.filter((item) => entities.length === 0 || entities.some((entity) => supportsEntity(item, entity)));
  const confidence = usable.length > 0
    ? Math.max(...usable.map((item) => item.score.final || 0))
    : 0;

  if (input.resolverUnavailable) {
    return { answerable: false, propertySatisfied: false, entitySatisfied: false, confidence: 0, reason: 'resolver_unavailable', usableEvidenceIds: [] };
  }
  if (input.pack.conflicts.length > 0) {
    return { answerable: false, propertySatisfied, entitySatisfied, confidence, reason: 'conflicting', usableEvidenceIds: usable.map((item) => item.evidenceId) };
  }
  if (!propertySatisfied) {
    return { answerable: false, propertySatisfied, entitySatisfied, confidence, reason: 'property_missing', usableEvidenceIds: [] };
  }
  if (!entitySatisfied) {
    return { answerable: false, propertySatisfied, entitySatisfied, confidence, reason: 'entity_missing', usableEvidenceIds: [] };
  }
  if (confidence < MIN_ANSWER_CONFIDENCE) {
    return { answerable: false, propertySatisfied, entitySatisfied, confidence, reason: 'low_confidence', usableEvidenceIds: usable.map((item) => item.evidenceId) };
  }
  return {
    answerable: true,
    propertySatisfied,
    entitySatisfied,
    confidence,
    reason: usable.length > 1 ? 'multi_item' : 'direct',
    usableEvidenceIds: usable.map((item) => item.evidenceId),
  };
}

const tokenize = (text: string): string[] =>
  String(text || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) || [];

// Answer-shaped tokens a direct-value question is usually looking for: a number
// (with optional unit/exponent), a bracketed placeholder ("[color]"), a quoted
// literal, or a capitalized multi-word proper noun / model identifier. Purely
// structural — no document vocabulary — so this generalizes across corpora.
const ANSWER_SHAPE_RES: readonly RegExp[] = [
  /\d/u,
  /\[[^\]]+\]/u,
  /["“][^"”]{2,}["”]/u,
  /\b[A-Z][A-Za-z0-9.+#-]*(?:\s+[A-Z0-9][A-Za-z0-9.+#-]*)+/u,
];

/**
 * Generic answer-bearing relevance of one evidence item for a question.
 * Combines (a) the fraction of the question's DISTINCTIVE terms the item
 * contains — the terms that actually pin the answer, not the topical entity
 * words — with (b) whether the item contains an answer-shaped token, and (c)
 * the property-proof flag. Pure + deterministic; every signal is derived from
 * the question and the item text, never from any hardcoded document value.
 */
export function answerRelevanceScore(
  item: EvidenceItem,
  distinctiveTerms: string[],
  requestedProperty: RequestedProperty,
): number {
  const itemWords = new Set(tokenize(item.text));
  const distinctive = [...new Set(distinctiveTerms.map((t) => t.toLowerCase()).filter(Boolean))];
  const coverage = distinctive.length === 0
    ? 0
    : distinctive.filter((t) => itemWords.has(t)).length / distinctive.length;
  const hasAnswerShape = ANSWER_SHAPE_RES.some((re) => re.test(item.text)) ? 1 : 0;
  const provesProperty = requestedProperty !== 'unknown'
    && (item.score.propertyMatch === 1 || item.supports.property === requestedProperty) ? 1 : 0;
  // Weighted so distinctive-term coverage dominates (it is the strongest
  // answer-bearing signal), answer-shape and property-proof are secondary
  // tie-breakers. Bounded to [0, 1].
  return Math.min(1, 0.6 * coverage + 0.25 * hasAnswerShape + 0.15 * provesProperty);
}

/**
 * Keep the smallest sufficient subset appropriate for the answer form, ranked by
 * ANSWER-BEARING relevance rather than raw retrieval score. Raw score ranks a
 * topical chunk that merely mentions the subject above the chunk that carries
 * the specific value; blending in distinctive-term coverage + answer-shape
 * density pulls the value-bearing chunk to the front. Selection is dynamic: it
 * stops once the marginal candidate adds no new distinctive-term coverage
 * (Priority 7), bounded by a per-answer-shape cap for prompt-size safety.
 */
export function selectSmallestSufficientEvidence(input: {
  items: EvidenceItem[];
  requestedProperty: RequestedProperty;
  answerShape: 'list' | 'comparison' | string;
  targetEntities?: string[];
  /** Distinctive (non-entity, non-stopword) query terms — enables answer-aware ranking. */
  distinctiveTerms?: string[];
}): EvidenceItem[] {
  const entities = [...new Set((input.targetEntities || []).map(normalize).filter(Boolean))];
  const distinctive = input.distinctiveTerms || [];
  // Composite rank = answer-relevance first, raw retrieval score as tie-break.
  // When no distinctive terms are available (e.g. a bare synthesis query) the
  // relevance score is 0 for every item and this degrades to the prior
  // raw-score ordering — no behavior change on that path.
  const rankOf = (item: EvidenceItem): number =>
    answerRelevanceScore(item, distinctive, input.requestedProperty) + 0.001 * (item.score.final || 0);
  // Property filter still hard-excludes items that cannot prove a KNOWN property.
  // The entity filter, however, must NOT hard-exclude: the answer chunk for
  // "what controller does Mercury X1 use" often lives in a sub-section
  // ("Main controller: …") that never repeats the subject "Mercury X1", so
  // requiring the entity token would drop the very chunk that carries the value.
  // Instead, an item that BOTH covers a distinctive answer term AND is highly
  // answer-relevant is retained even without the literal entity — entity match
  // still boosts ranking below and still seeds guaranteed coverage.
  const distinctiveForFilter = new Set(distinctive.map((t) => t.toLowerCase()).filter(Boolean));
  const isAnswerRelevantWithoutEntity = (item: EvidenceItem): boolean => {
    if (distinctiveForFilter.size === 0) return false;
    const words = new Set(tokenize(item.text));
    return [...distinctiveForFilter].some((t) => words.has(t));
  };
  const eligible = input.items.filter((item) => item.authority === 'evidence')
    .filter((item) => input.requestedProperty === 'unknown' || itemSupportsProperty(item, input.requestedProperty))
    .filter((item) => entities.length === 0
      || entities.some((entity) => supportsEntity(item, entity))
      || isAnswerRelevantWithoutEntity(item))
    .sort((left, right) => rankOf(right) - rankOf(left));
  const cap = input.answerShape === 'comparison' ? 6 : input.answerShape === 'list' ? 5 : 3;
  const selected: EvidenceItem[] = [];
  const selectedIds = new Set<string>();
  // Guarantee at least one item that supports each target entity (unchanged).
  for (const entity of entities) {
    const match = eligible.find((item) => supportsEntity(item, entity));
    if (match && !selectedIds.has(match.evidenceId)) {
      selected.push(match);
      selectedIds.add(match.evidenceId);
    }
  }
  // Dynamic marginal-coverage fill: add the next-highest-ranked item only while
  // it either (a) contributes a distinctive term not yet covered, or (b) we
  // have not yet reached a minimum floor of 3 (the prior fixed count, kept as a
  // floor so recall never drops below the previous behavior). Stop at the cap.
  const coveredTerms = new Set<string>();
  const distinctiveLc = [...new Set(distinctive.map((t) => t.toLowerCase()).filter(Boolean))];
  const addCoverage = (item: EvidenceItem): void => {
    const words = new Set(tokenize(item.text));
    for (const t of distinctiveLc) if (words.has(t)) coveredTerms.add(t);
  };
  selected.forEach(addCoverage);
  const floor = Math.min(3, eligible.length);
  for (const item of eligible) {
    if (selected.length >= cap) break;
    if (selectedIds.has(item.evidenceId)) continue;
    const words = new Set(tokenize(item.text));
    const addsNewTerm = distinctiveLc.some((t) => words.has(t) && !coveredTerms.has(t));
    const belowFloor = selected.length < floor;
    // Once every distinctive term is already covered AND we are at/above the
    // floor, additional topical-only items add nothing but prompt bloat — stop.
    if (!addsNewTerm && !belowFloor && distinctiveLc.length > 0) break;
    selected.push(item);
    selectedIds.add(item.evidenceId);
    addCoverage(item);
  }
  return selected;
}
