// electron/services/knowledge/OkfCardEditor.ts
//
// OKF Phase 6 — user edit/approve/reject/restore workflow for generated
// Knowledge Cards, gated behind okfUserEditableCards. Rules from the
// migration plan:
//   - user edits OVERRIDE generated cards in retrieval (OkfRetriever reads
//     the current row, so an edited body is automatically what gets served —
//     no separate retrieval-path change needed)
//   - unsupported user text is marked user_provided/user_edit, not
//     source_verified (tracked via generatedFrom='user_edit' +
//     approvalStatus, NOT confidence — confidence stays whatever the user
//     leaves it, since we don't second-guess their edit)
//   - preserve source attribution (sourcePages/sourceQuotes/sourceChecksum
//     are NEVER touched by an edit — only title/body/entities/tags/confidence)
//   - never lose the original generated card (every write snapshots the
//     PRIOR row into knowledge_card_versions first)

import { KnowledgePackStore } from './KnowledgePackStore';
import { invalidatePackCache } from './KnowledgeCache';
import type { KnowledgeCard, KnowledgeCardVersion } from './types';

const store = new KnowledgePackStore();

/**
 * Card edits/approvals/rejections mutate a single card row, not the source
 * document — contentHash never changes, so KnowledgeCache's normal
 * invalidation-by-contentHash never fires for these writes. Every mutation
 * below explicitly invalidates the owning file's cache entry so
 * KnowledgeManager.getPackForFile immediately reflects the change instead
 * of serving a stale cached pack until the next unrelated regeneration.
 */
function invalidateCacheForCard(card: KnowledgeCard | null): void {
  if (!card) return;
  const source = store.getSourceById(card.sourceId);
  if (source?.fileId) invalidatePackCache(source.fileId);
}

export interface EditCardParams {
  cardId: string;
  title?: string;
  body?: string;
  entities?: string[];
  tags?: string[];
  editedBy?: string;
  editReason?: string;
}

/** Applies a user edit. Marks the card user_edited=1 and generatedFrom conceptually becomes 'user_edit' via approvalStatus, but the field itself is left as originally set (provenance of the EXTRACTION method is preserved; the edit is tracked separately via user_edited + version history). */
export function editCard(params: EditCardParams): KnowledgeCard | null {
  const { cardId, editedBy = 'user', editReason } = params;
  const card = store.updateCard(cardId, {
    title: params.title,
    body: params.body,
    entities: params.entities,
    tags: params.tags,
    userEdited: true,
    approvalStatus: 'approved', // an edit is an implicit approval of the new text
  }, editedBy, editReason ?? 'user edit');
  invalidateCacheForCard(card);
  return card;
}

export function approveCard(cardId: string, editedBy = 'user'): KnowledgeCard | null {
  const card = store.updateCard(cardId, { approvalStatus: 'approved' }, editedBy, 'approved');
  invalidateCacheForCard(card);
  return card;
}

/** Rejecting a card marks it so retrieval SHOULD exclude it (callers/OkfRetriever check approvalStatus !== 'rejected'), without deleting it — it can still be restored. */
export function rejectCard(cardId: string, editedBy = 'user'): KnowledgeCard | null {
  const card = store.updateCard(cardId, { approvalStatus: 'rejected' }, editedBy, 'rejected');
  invalidateCacheForCard(card);
  return card;
}

/** Restores the card to a previous version (typically the original generated version) — snapshots the CURRENT (edited) state first, so restoring is itself reversible. */
export function restoreCardVersion(cardId: string, versionId: string, editedBy = 'user'): KnowledgeCard | null {
  const versions = store.getCardVersions(cardId);
  const target = versions.find((v) => v.id === versionId);
  if (!target) return null;
  const card = store.updateCard(cardId, {
    title: target.title,
    body: target.body,
    entities: target.entities,
    tags: target.tags,
    confidence: target.confidence,
    // A version row's `editedBy` field names who SUPERSEDED that content
    // (snapshotted just before their edit was applied), not who created it —
    // so it can't identify "the original generated version". cardVersion
    // CAN: every card starts at version 1 when KnowledgeManager first
    // generates it, and updateCard() always increments on write. Restoring
    // to version 1 is therefore restoring to the pristine generated state,
    // which should clear user_edited so the card resumes tracking
    // regeneration again; restoring to any later (user-edited) version keeps
    // it marked user_edited.
    userEdited: target.cardVersion !== 1,
    approvalStatus: 'approved',
  }, editedBy, `restored to version from ${target.createdAt}`);
  invalidateCacheForCard(card);
  return card;
}

export function getCardHistory(cardId: string): KnowledgeCardVersion[] {
  return store.getCardVersions(cardId);
}

/** True when a card is safe to serve to retrieval — i.e. not explicitly rejected by the user. Cards needing review are still served (the flag exists for UI surfacing, not to hide potentially-stale content). */
export function isCardRetrievable(card: KnowledgeCard): boolean {
  return card.approvalStatus !== 'rejected';
}
