// electron/services/knowledge/KnowledgePackStore.ts
//
// OKF Phase 2 — persistence layer mapping typed KnowledgePack/KnowledgeCard/
// KnowledgeEntity/KnowledgeRelation objects to the knowledge_* DB tables
// (migration v19→v20 in electron/db/DatabaseManager.ts). DatabaseManager rows
// are untyped `any` — this is the single place that (de)serializes the
// *_json columns and maps row <-> typed object.

import { DatabaseManager } from '../../db/DatabaseManager';
import type {
  KnowledgeCard, KnowledgeCardVersion, KnowledgeEntity, KnowledgeIndexVersion, KnowledgePack, KnowledgeRelation, KnowledgeSource,
} from './types';

function parseJsonArray<T>(json: string | null | undefined, fallback: T[] = []): T[] {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function rowToSource(row: any): KnowledgeSource {
  return {
    id: row.id,
    type: row.type,
    fileId: row.file_id ?? undefined,
    modeId: row.mode_id ?? undefined,
    fileName: row.file_name ?? undefined,
    sourceChecksum: row.source_checksum,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    indexedAt: row.indexed_at ?? undefined,
    pageCount: row.page_count ?? undefined,
    extractedPageCount: row.extracted_page_count ?? undefined,
    indexVersion: row.index_version,
    embeddingSpace: row.embedding_space ?? undefined,
  };
}

function rowToCard(row: any): KnowledgeCard {
  return {
    id: row.id,
    packId: row.pack_id,
    sourceId: row.source_id,
    type: row.type,
    title: row.title,
    slug: row.slug,
    conceptId: row.concept_id,
    body: row.body,
    bodyMarkdown: row.body_markdown ?? undefined,
    sourcePages: parseJsonArray<number>(row.source_pages_json),
    sourceSections: parseJsonArray<string>(row.source_sections_json),
    sourceQuotes: parseJsonArray(row.source_quotes_json),
    entities: parseJsonArray<string>(row.entities_json),
    tags: parseJsonArray<string>(row.tags_json),
    relatedCardIds: parseJsonArray<string>(row.related_card_ids_json),
    confidence: row.confidence,
    generatedFrom: row.generated_from,
    sourceChecksum: row.source_checksum,
    userEdited: Boolean(row.user_edited),
    approvalStatus: row.approval_status,
    updatedAt: row.updated_at,
    cardVersion: row.card_version,
    // OKF Profile Intelligence (2026-07-02): pii column added in migration v23.
    // Coalesce so a row read before the column existed (or a NULL) is false.
    pii: Boolean(row.pii),
  };
}

function rowToEntity(row: any): KnowledgeEntity {
  return {
    id: row.id,
    packId: row.pack_id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    aliases: parseJsonArray<string>(row.aliases_json),
    description: row.description,
    sourceCardIds: parseJsonArray<string>(row.source_card_ids_json),
    sourcePages: parseJsonArray<number>(row.source_pages_json),
    firstSeenAt: row.first_seen_at,
  };
}

function rowToRelation(row: any): KnowledgeRelation {
  return {
    id: row.id,
    packId: row.pack_id,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    predicate: row.predicate,
    objectId: row.object_id,
    objectType: row.object_type,
    sourceCardIds: parseJsonArray<string>(row.source_card_ids_json),
    sourcePages: parseJsonArray<number>(row.source_pages_json),
    confidence: row.confidence,
    createdAt: row.created_at,
  };
}

function rowToCardVersion(row: any): KnowledgeCardVersion {
  return {
    id: row.id,
    cardId: row.card_id,
    cardVersion: row.card_version,
    title: row.title,
    body: row.body,
    entities: parseJsonArray<string>(row.entities_json),
    tags: parseJsonArray<string>(row.tags_json),
    confidence: row.confidence,
    editedBy: row.edited_by,
    editReason: row.edit_reason ?? undefined,
    createdAt: row.created_at,
  };
}

function rowToIndexVersion(row: any): KnowledgeIndexVersion {
  return {
    id: row.id,
    sourceId: row.source_id,
    packId: row.pack_id ?? undefined,
    packVersion: row.pack_version,
    contentHash: row.content_hash,
    embeddingSpace: row.embedding_space ?? undefined,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KnowledgePackStore {
  private db = DatabaseManager.getInstance();

  saveSource(source: KnowledgeSource): void {
    this.db.upsertKnowledgeSource({
      id: source.id, type: source.type, fileId: source.fileId, modeId: source.modeId, fileName: source.fileName,
      sourceChecksum: source.sourceChecksum, contentHash: source.contentHash, indexedAt: source.indexedAt,
      pageCount: source.pageCount, extractedPageCount: source.extractedPageCount,
      indexVersion: source.indexVersion, embeddingSpace: source.embeddingSpace,
    });
  }

  getSourceByFileId(fileId: string): KnowledgeSource | null {
    const row = this.db.getKnowledgeSourceByFileId(fileId);
    return row ? rowToSource(row) : null;
  }

  getSourceById(id: string): KnowledgeSource | null {
    const row = this.db.getKnowledgeSourceById(id);
    return row ? rowToSource(row) : null;
  }

  getSourcesByModeId(modeId: string): KnowledgeSource[] {
    return this.db.getKnowledgeSourcesByModeId(modeId).map(rowToSource);
  }

  deleteSource(id: string): void {
    this.db.deleteKnowledgeSource(id);
  }

  /**
   * `currentSourceChecksum` is the content hash of what was JUST extracted
   * (always known to the caller — KnowledgeManager computes it up front from
   * the file content, independent of how many cards the extraction yielded).
   * Passed explicitly to DatabaseManager.replaceKnowledgeCards's
   * needs_review flagging rather than derived from `pack.cards[0]`, which is
   * undefined when extraction yields zero cards — see the fix note on
   * DatabaseManager.replaceKnowledgeCards for the bug this closes.
   */
  savePack(pack: KnowledgePack, currentSourceChecksum?: string): void {
    this.db.upsertKnowledgePack({
      id: pack.id, sourceId: pack.sourceId, modeId: pack.modeId, fileName: pack.fileName,
      indexMd: pack.indexMd, statsJson: JSON.stringify(pack.stats), packVersion: pack.packVersion,
      generatedBy: pack.generatedBy,
    });
    this.db.replaceKnowledgeCards(pack.id, pack.sourceId, pack.cards.map((c) => ({
      id: c.id, type: c.type, title: c.title, slug: c.slug, conceptId: c.conceptId,
      body: c.body, bodyMarkdown: c.bodyMarkdown, sourcePagesJson: JSON.stringify(c.sourcePages),
      sourceSectionsJson: JSON.stringify(c.sourceSections), sourceQuotesJson: JSON.stringify(c.sourceQuotes),
      entitiesJson: JSON.stringify(c.entities), tagsJson: JSON.stringify(c.tags),
      relatedCardIdsJson: JSON.stringify(c.relatedCardIds), confidence: c.confidence,
      generatedFrom: c.generatedFrom, sourceChecksum: c.sourceChecksum, cardVersion: c.cardVersion,
      pii: c.pii === true,
    })), currentSourceChecksum ?? pack.cards[0]?.sourceChecksum);
    this.db.replaceKnowledgeEntities(pack.id, pack.entities.map((e) => ({
      id: e.id, slug: e.slug, name: e.name, type: e.type, aliasesJson: JSON.stringify(e.aliases),
      description: e.description, sourceCardIdsJson: JSON.stringify(e.sourceCardIds), sourcePagesJson: JSON.stringify(e.sourcePages),
    })));
    this.db.replaceKnowledgeRelations(pack.id, pack.relations.map((r) => ({
      id: r.id, subjectId: r.subjectId, subjectType: r.subjectType, predicate: r.predicate,
      objectId: r.objectId, objectType: r.objectType, sourceCardIdsJson: JSON.stringify(r.sourceCardIds),
      sourcePagesJson: JSON.stringify(r.sourcePages), confidence: r.confidence,
    })));
  }

  getPackBySourceId(sourceId: string): KnowledgePack | null {
    const packRow = this.db.getKnowledgePackBySourceId(sourceId);
    if (!packRow) return null;
    return this.assemblePack(packRow);
  }

  getPacksByModeId(modeId: string): KnowledgePack[] {
    return this.db.getKnowledgePacksByModeId(modeId).map((row: any) => this.assemblePack(row));
  }

  private assemblePack(packRow: any): KnowledgePack {
    const cards = this.db.getKnowledgeCardsByPackId(packRow.id).map(rowToCard);
    const entities = this.db.getKnowledgeEntitiesByPackId(packRow.id).map(rowToEntity);
    const relations = this.db.getKnowledgeRelationsByPackId(packRow.id).map(rowToRelation);
    let stats: KnowledgePack['stats'];
    try {
      stats = JSON.parse(packRow.stats_json);
    } catch {
      stats = { cardCount: cards.length, entityCount: entities.length, relationCount: relations.length, sourcePages: 0, sourceSections: 0, avgConfidence: 0, extractionMs: 0 };
    }
    return {
      id: packRow.id,
      sourceId: packRow.source_id,
      modeId: packRow.mode_id,
      fileName: packRow.file_name,
      cards,
      entities,
      relations,
      indexMd: packRow.index_md,
      stats,
      packVersion: packRow.pack_version,
      generatedBy: packRow.generated_by,
      updatedAt: packRow.updated_at,
    };
  }

  deletePack(id: string): void {
    this.db.deleteKnowledgePack(id);
  }

  saveIndexVersion(v: KnowledgeIndexVersion): void {
    this.db.upsertKnowledgeIndexVersion({
      id: v.id, sourceId: v.sourceId, packId: v.packId, packVersion: v.packVersion,
      contentHash: v.contentHash, embeddingSpace: v.embeddingSpace, status: v.status, errorMessage: v.errorMessage,
    });
  }

  getIndexVersionBySourceId(sourceId: string): KnowledgeIndexVersion | null {
    const row = this.db.getKnowledgeIndexVersionBySourceId(sourceId);
    return row ? rowToIndexVersion(row) : null;
  }

  // ── OKF Phase 6: card edit/approve/reject/restore ──────────────

  getCardById(id: string): KnowledgeCard | null {
    const row = this.db.getKnowledgeCardById(id);
    return row ? rowToCard(row) : null;
  }

  /** Snapshots the card's current state, then applies the given field updates. Every write goes through here so history is never skipped. */
  updateCard(id: string, updates: {
    title?: string; body?: string; entities?: string[]; tags?: string[]; confidence?: KnowledgeCard['confidence'];
    userEdited?: boolean; approvalStatus?: KnowledgeCard['approvalStatus'];
  }, editedBy: string, editReason?: string): KnowledgeCard | null {
    this.db.snapshotKnowledgeCardVersion(id, editedBy, editReason);
    this.db.updateKnowledgeCard(id, {
      title: updates.title,
      body: updates.body,
      entitiesJson: updates.entities !== undefined ? JSON.stringify(updates.entities) : undefined,
      tagsJson: updates.tags !== undefined ? JSON.stringify(updates.tags) : undefined,
      confidence: updates.confidence,
      userEdited: updates.userEdited,
      approvalStatus: updates.approvalStatus,
    });
    return this.getCardById(id);
  }

  getCardVersions(cardId: string): KnowledgeCardVersion[] {
    return this.db.getKnowledgeCardVersions(cardId).map(rowToCardVersion);
  }
}
