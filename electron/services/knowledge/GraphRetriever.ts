// electron/services/knowledge/GraphRetriever.ts
//
// OKF Phase 4 — graph EXPANSION over a pack's KnowledgeRelations. Per the
// migration plan: "graph is expansion only, not primary truth; raw
// chunks/cards override graph if conflict; graph depth max 2." This module
// only ever RETURNS related card titles/ids as additional retrieval
// signals — it never asserts a fact on its own, and callers must not treat
// its output as citable evidence without also having the underlying card.

import type { KnowledgeCard, KnowledgeEntity, KnowledgePack, KnowledgeRelation } from './types';

export interface GraphExpansionHit {
  relation: KnowledgeRelation;
  depth: 1 | 2;
  /** The related card, when the relation's non-target side resolves to a card (directly or via its entity's sourceCardIds). */
  relatedCard?: KnowledgeCard;
}

const MAX_DEPTH = 2;

function otherSide(rel: KnowledgeRelation, nodeId: string): { id: string; type: 'entity' | 'card' } | null {
  if (rel.subjectId === nodeId) return { id: rel.objectId, type: rel.objectType };
  if (rel.objectId === nodeId) return { id: rel.subjectId, type: rel.subjectType };
  return null;
}

/**
 * Expand from a set of target entity/card ids (typically the entities named
 * in the user's question, resolved via OkfRetriever's targetEntities) out to
 * `maxDepth` (capped at 2) hops through the pack's relations. Returns hits
 * with the relation, its depth, and — when resolvable — the related card
 * for prompt display. NEVER returns a bare unsupported claim: every hit
 * carries `sourceCardIds`/`sourcePages` on the relation itself.
 */
export function expandGraph(
  pack: KnowledgePack,
  startNodeIds: string[],
  maxDepth: 1 | 2 = 2,
): GraphExpansionHit[] {
  const depth = Math.min(maxDepth, MAX_DEPTH) as 1 | 2;
  if (pack.relations.length === 0 || startNodeIds.length === 0) return [];

  const cardById = new Map(pack.cards.map((c) => [c.id, c]));
  const entityById = new Map(pack.entities.map((e) => [e.id, e]));

  function resolveCard(nodeId: string, nodeType: 'entity' | 'card'): KnowledgeCard | undefined {
    if (nodeType === 'card') return cardById.get(nodeId);
    const entity = entityById.get(nodeId);
    if (!entity || entity.sourceCardIds.length === 0) return undefined;
    return cardById.get(entity.sourceCardIds[0]);
  }

  const visited = new Set<string>(startNodeIds);
  const hits: GraphExpansionHit[] = [];
  let frontier = new Set<string>(startNodeIds);

  for (let hop = 1; hop <= depth; hop++) {
    const nextFrontier = new Set<string>();
    for (const rel of pack.relations) {
      for (const nodeId of frontier) {
        const other = otherSide(rel, nodeId);
        if (!other || visited.has(other.id)) continue;
        hits.push({ relation: rel, depth: hop as 1 | 2, relatedCard: resolveCard(other.id, other.type) });
        visited.add(other.id);
        nextFrontier.add(other.id);
      }
    }
    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }

  return hits;
}

/**
 * Resolves a set of target entity NAMES (e.g. from QuestionClassification.targetEntities)
 * to their pack node ids (entity id if tracked, else the card whose title
 * matches), for use as expandGraph's startNodeIds.
 */
export function resolveStartNodeIds(pack: KnowledgePack, targetEntityNames: string[]): string[] {
  const namesLower = new Set(targetEntityNames.map((n) => n.toLowerCase()));
  const ids: string[] = [];
  for (const e of pack.entities) {
    if (namesLower.has(e.name.toLowerCase())) ids.push(e.id);
  }
  for (const c of pack.cards) {
    if (namesLower.has(c.title.toLowerCase())) ids.push(c.id);
  }
  return [...new Set(ids)];
}

/**
 * Formats graph hits as a short "related concepts" hint block — NOT
 * asserted as fact, explicitly labeled as a retrieval signal so the model
 * doesn't treat it as citable on its own (the underlying card/chunk is
 * still required for any concrete claim).
 */
export function formatGraphHintsForPrompt(hits: GraphExpansionHit[]): string {
  if (hits.length === 0) return '';
  const lines = hits
    .filter((h) => h.relatedCard)
    .slice(0, 8)
    .map((h) => `- ${h.relation.predicate.replace(/_/g, ' ')} → ${h.relatedCard!.title} (see card above/below if relevant)`);
  if (lines.length === 0) return '';
  return ['## RELATED CONCEPTS (retrieval hints only — not citable facts on their own)', ...lines].join('\n');
}
