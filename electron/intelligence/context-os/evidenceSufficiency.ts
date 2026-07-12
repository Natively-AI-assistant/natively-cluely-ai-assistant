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

/** Keep only the smallest high-confidence subset appropriate for the answer form. */
export function selectSmallestSufficientEvidence(input: {
  items: EvidenceItem[];
  requestedProperty: RequestedProperty;
  answerShape: 'list' | 'comparison' | string;
  targetEntities?: string[];
}): EvidenceItem[] {
  const entities = [...new Set((input.targetEntities || []).map(normalize).filter(Boolean))];
  const eligible = input.items.filter((item) => item.authority === 'evidence')
    .filter((item) => input.requestedProperty === 'unknown' || itemSupportsProperty(item, input.requestedProperty))
    .filter((item) => entities.length === 0 || entities.some((entity) => supportsEntity(item, entity)))
    .sort((left, right) => right.score.final - left.score.final);
  const limit = input.answerShape === 'comparison' ? 6 : input.answerShape === 'list' ? 5 : 3;
  const selected: EvidenceItem[] = [];
  const selectedIds = new Set<string>();
  for (const entity of entities) {
    const match = eligible.find((item) => supportsEntity(item, entity));
    if (match && !selectedIds.has(match.evidenceId)) {
      selected.push(match);
      selectedIds.add(match.evidenceId);
    }
  }
  for (const item of eligible) {
    if (selected.length >= limit) break;
    if (!selectedIds.has(item.evidenceId)) {
      selected.push(item);
      selectedIds.add(item.evidenceId);
    }
  }
  return selected;
}
