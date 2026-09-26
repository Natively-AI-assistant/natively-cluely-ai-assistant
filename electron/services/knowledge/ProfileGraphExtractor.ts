// electron/services/knowledge/ProfileGraphExtractor.ts
//
// OKF Profile Intelligence — Phase 4 (default OFF via okfProfileGraphExpansion).
// Derives typed relations between profile cards/entities for internal graph
// expansion only. Exported cards stay plain Markdown links (OKF requires no
// typed relations). Every relation cites the source card ids it was derived
// from; the graph is EXPANSION-ONLY and never overrides direct card/node
// evidence at query time.
//
// Profile relation semantics are mapped onto the existing fixed RelationPredicate
// union (types.ts) so the shared knowledge_relations table + GraphRetriever work
// unchanged — no schema fork:
//   candidate has_experience_at <Company>  → 'is_part_of'  (card is_part_of company entity)
//   candidate built <Project>              → 'authored_by' (project authored_by candidate)
//   <Project> uses <Skill>                 → 'uses'
//   candidate studied_at <Institution>     → 'is_part_of'
//   <JD requirement> matched_by skill      → 'implements'
// The human-readable predicate label lives in the card prose (per OKF's "links
// imply relationships, prose conveys the kind" convention); the enum value is an
// internal retrieval hint only.

import crypto from 'node:crypto';
import type { KnowledgeCard, KnowledgeEntity, KnowledgeRelation, RelationPredicate } from './types';

function relId(seed: string): string {
  return `prel_${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}

export function extractProfileGraphRelations(
  cards: KnowledgeCard[],
  entities: KnowledgeEntity[],
): KnowledgeRelation[] {
  const relations: KnowledgeRelation[] = [];
  const nowIso = new Date().toISOString();
  const entityByNameLower = new Map(entities.map((e) => [e.name.toLowerCase(), e]));

  const addRel = (
    subjectId: string, subjectType: 'entity' | 'card',
    predicate: RelationPredicate,
    objectId: string, objectType: 'entity' | 'card',
    sourceCardIds: string[],
  ): void => {
    if (subjectId === objectId) return;
    relations.push({
      id: relId(`${subjectId}:${predicate}:${objectId}`),
      packId: cards[0]?.packId || '',
      subjectId, subjectType, predicate, objectId, objectType,
      sourceCardIds, sourcePages: [], confidence: 'medium', createdAt: nowIso,
    });
  };

  for (const card of cards) {
    // Link each card to the entities it names (card is_part_of entity / uses entity).
    for (const name of card.entities) {
      const ent = entityByNameLower.get(name.toLowerCase());
      if (!ent) continue;
      const predicate: RelationPredicate =
        card.type === 'candidate_project' ? 'uses'
        : card.type === 'candidate_experience' || card.type === 'candidate_education' ? 'is_part_of'
        : 'cites';
      addRel(card.id, 'card', predicate, ent.id, 'entity', [card.id]);
    }
  }

  return relations;
}
