// electron/services/knowledge/OkfCardBuilder.ts
//
// OKF Phase 2 — turns OkfExtractor's BuiltCardDraft/BuiltEntityDraft into
// fully-typed KnowledgeCard/KnowledgeEntity objects (ids, checksums,
// confidence, timestamps). Pure functions — no DB access (KnowledgePackStore
// owns persistence).

import crypto from 'node:crypto';
import type { BuiltCardDraft, BuiltEntityDraft } from './OkfExtractor';
import type { KnowledgeCard, KnowledgeCardConfidence, KnowledgeEntity } from './types';

function shortId(prefix: string, seed: string): string {
  const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
  return `${prefix}_${hash}`;
}

/** Confidence heuristic v1: a card with a real section number + non-trivial body is high; short/no-number bodies are medium. */
function inferCardConfidence(draft: BuiltCardDraft): KnowledgeCardConfidence {
  // Atomic front-matter facts are a printed Label: value taken verbatim from the
  // title page — the single most reliable evidence unit for a document-identity
  // question. They are intrinsically high-confidence despite a short body.
  if (draft.type === 'metadata') return 'high';
  const hasSection = draft.sourceSections.some((s) => /^\d/.test(s));
  const bodyWords = draft.body.split(/\s+/).filter(Boolean).length;
  if (hasSection && bodyWords >= 30) return 'high';
  if (bodyWords >= 15) return 'medium';
  return 'low';
}

export function buildKnowledgeCards(
  drafts: BuiltCardDraft[],
  params: { packId: string; sourceId: string; sourceChecksum: string; nowIso: string },
): KnowledgeCard[] {
  return drafts.map((draft) => ({
    id: shortId('card', `${params.sourceId}:${draft.conceptId}`),
    packId: params.packId,
    sourceId: params.sourceId,
    type: draft.type,
    title: draft.title,
    slug: draft.slug,
    conceptId: draft.conceptId,
    body: draft.body,
    sourcePages: draft.sourcePages,
    sourceSections: draft.sourceSections,
    sourceQuotes: draft.sourceQuotes,
    entities: draft.entities,
    tags: [] as string[],
    relatedCardIds: [] as string[],
    confidence: inferCardConfidence(draft),
    generatedFrom: 'pdf_extraction',
    sourceChecksum: params.sourceChecksum,
    userEdited: false,
    approvalStatus: 'generated',
    updatedAt: params.nowIso,
    cardVersion: 1,
  }));
}

export function buildKnowledgeEntities(
  drafts: BuiltEntityDraft[],
  cardsByConceptId: Map<string, KnowledgeCard>,
  params: { packId: string; nowIso: string },
): KnowledgeEntity[] {
  return drafts.map((draft) => {
    const sourceCardIds = [...new Set(
      draft.sourceCardConceptIds.map((cid) => cardsByConceptId.get(cid)?.id).filter((id): id is string => Boolean(id)),
    )];
    return {
      id: shortId('ent', `${params.packId}:${draft.slug}`),
      packId: params.packId,
      slug: draft.slug,
      name: draft.name,
      type: draft.type,
      aliases: [] as string[],
      description: '',
      sourceCardIds,
      sourcePages: draft.sourcePages,
      firstSeenAt: params.nowIso,
    };
  });
}

/** Cross-reference pass: populate relatedCardIds bidirectionally for cards that share an entity. */
export function linkRelatedCards(cards: KnowledgeCard[]): KnowledgeCard[] {
  const cardsByEntityLower = new Map<string, KnowledgeCard[]>();
  for (const card of cards) {
    for (const e of card.entities) {
      const key = e.toLowerCase();
      const list = cardsByEntityLower.get(key) || [];
      list.push(card);
      cardsByEntityLower.set(key, list);
    }
  }
  for (const card of cards) {
    const related = new Set<string>();
    for (const e of card.entities) {
      const siblings = cardsByEntityLower.get(e.toLowerCase()) || [];
      for (const sib of siblings) {
        if (sib.id !== card.id) related.add(sib.id);
      }
    }
    card.relatedCardIds = [...related].slice(0, 8);
  }
  return cards;
}
