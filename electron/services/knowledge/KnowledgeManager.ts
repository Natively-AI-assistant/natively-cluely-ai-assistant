// electron/services/knowledge/KnowledgeManager.ts
//
// OKF Phase 2 — orchestration entry point. Generates a KnowledgePack from a
// reference file's stored content (deterministic, no LLM call), verifies
// each card against the source, persists via KnowledgePackStore, and
// invalidates/regenerates on content-hash change. This is the single
// integration point ModesManager/ipcHandlers should call — it does not
// change retrieval (Phase 3's job); it only generates and persists knowledge.

import crypto from 'node:crypto';
import { isOkfKnowledgePacksEnabled, isOkfGraphExpansionEnabled } from '../../intelligence/intelligenceFlags';
import { extractFromContent } from './OkfExtractor';
import { buildKnowledgeCards, buildKnowledgeEntities, linkRelatedCards } from './OkfCardBuilder';
import { verifyCards } from './OkfVerifier';
import { slugifyDir } from './OkfMarkdownExporter';
import { extractGraphRelations } from './GraphExtractor';
import { DatabaseManager } from '../../db/DatabaseManager';
import { KnowledgePackStore } from './KnowledgePackStore';
import { getCachedPack, setCachedPack, invalidatePackCache } from './KnowledgeCache';
import { PROFILE_OKF_MODE_ID } from './ProfilePackBuilder';
import type { KnowledgePack, KnowledgeSource } from './types';

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function shortId(prefix: string, seed: string): string {
  return `${prefix}_${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}

export interface ReferenceFileInput {
  id: string;
  modeId: string;
  fileName: string;
  content: string;
  pageCount?: number;
  extractedPageCount?: number;
}

export interface GenerateResult {
  status: 'generated' | 'skipped_flag_off' | 'skipped_unchanged' | 'skipped_empty' | 'failed';
  pack?: KnowledgePack;
  error?: string;
}

export class KnowledgeManager {
  private static instance: KnowledgeManager | null = null;
  private store: KnowledgePackStore;

  private constructor() {
    this.store = new KnowledgePackStore();
  }

  static getInstance(): KnowledgeManager {
    if (!KnowledgeManager.instance) KnowledgeManager.instance = new KnowledgeManager();
    return KnowledgeManager.instance;
  }

  /**
   * Generate (or regenerate, if the content hash changed) a Knowledge Pack
   * for a reference file. Idempotent — a second call with unchanged content
   * is a no-op (status: 'skipped_unchanged'). Synchronous: heuristic v1
   * extraction is pure string/regex work, ~2-5s on a 66-page PDF per the
   * migration plan's cost estimate — safe to run inline at upload time.
   */
  generateForFile(file: ReferenceFileInput, force = false): GenerateResult {
    if (!isOkfKnowledgePacksEnabled()) return { status: 'skipped_flag_off' };
    const content = file.content?.trim() || '';
    if (!content) return { status: 'skipped_empty' };

    const contentHash = sha256(content);
    const existingSource = this.store.getSourceByFileId(file.id);
    if (!force && existingSource && existingSource.contentHash === contentHash) {
      return { status: 'skipped_unchanged' };
    }

    const t0 = Date.now();
    try {
      const sourceChecksum = contentHash; // no separate byte-level checksum available here; content hash doubles as both (see KnowledgeSource docs)
      const sourceId = existingSource?.id || shortId('src', file.id);
      const nowIso = new Date().toISOString();

      const bundleDir = slugifyDir(file.fileName);
      const { cards: cardDrafts, entities: entityDrafts } = extractFromContent(content, bundleDir);

      const packId = shortId('pack', file.id);
      let cards = buildKnowledgeCards(cardDrafts, { packId, sourceId, sourceChecksum, nowIso });

      const { accepted, rejected } = verifyCards(cards, content);
      cards = linkRelatedCards(accepted);

      const cardsByConceptId = new Map(cards.map((c) => [c.conceptId, c]));
      const entities = buildKnowledgeEntities(entityDrafts, cardsByConceptId, { packId, nowIso })
        // Only keep entities whose source cards survived verification.
        .filter((e) => e.sourceCardIds.length > 0);

      const sourcePages = new Set<number>();
      const sourceSections = new Set<string>();
      let confSum = 0;
      const confScore = { high: 1, medium: 0.6, low: 0.3 } as const;
      for (const c of cards) {
        c.sourcePages.forEach((p) => sourcePages.add(p));
        c.sourceSections.forEach((s) => sourceSections.add(s));
        confSum += confScore[c.confidence];
      }

      // OKF Phase 4 (default OFF): typed relation extraction over the
      // verified cards + entities. Expansion-only per the migration plan —
      // never overrides direct card/chunk evidence at query time
      // (GraphRetriever.expandGraph only ever ADDS retrieval hints).
      const relations = isOkfGraphExpansionEnabled() ? extractGraphRelations(cards, entities) : [];

      const pack: KnowledgePack = {
        id: packId,
        sourceId,
        modeId: file.modeId,
        fileName: file.fileName,
        cards,
        entities,
        relations,
        indexMd: '',
        stats: {
          cardCount: cards.length,
          entityCount: entities.length,
          relationCount: relations.length,
          sourcePages: sourcePages.size,
          sourceSections: sourceSections.size,
          avgConfidence: cards.length > 0 ? confSum / cards.length : 0,
          extractionMs: Date.now() - t0,
        },
        packVersion: (this.store.getPackBySourceId(sourceId)?.packVersion || 0) + 1,
        generatedBy: 'okf_extractor_v1',
        updatedAt: nowIso,
      };

      const source: KnowledgeSource = {
        id: sourceId,
        type: 'reference_file',
        fileId: file.id,
        modeId: file.modeId,
        fileName: file.fileName,
        sourceChecksum,
        contentHash,
        createdAt: existingSource?.createdAt || nowIso,
        indexedAt: nowIso,
        pageCount: file.pageCount,
        extractedPageCount: file.extractedPageCount,
        indexVersion: 'knowledge_pack_v1',
      };

      // Persist source + pack (its 4 internal writes) + index-version as ONE
      // atomic transaction (senior review HIGH, 2026-07-01). Previously these
      // were separate transactions: a throw partway through (e.g. in
      // replaceKnowledgeEntities) would leave the source row already advanced
      // to the new contentHash while the pack was half-written — and because
      // the contentHash gate at the top of this method then reports the
      // source as "unchanged", the inconsistent pack would NEVER self-heal on
      // subsequent uploads/access unless the document content changed or a
      // force-regenerate was triggered. Wrapping all three in one
      // better-sqlite3 transaction means any failure rolls back the source
      // row too, so the next generateForFile re-runs cleanly.
      DatabaseManager.getInstance().runInTransaction(() => {
        this.store.saveSource(source);
        // Pass sourceChecksum explicitly — always known here regardless of
        // how many cards this extraction pass produced, closing the
        // needs_review-never-fires gap for a degenerate/empty extraction (see
        // KnowledgePackStore.savePack's doc comment).
        this.store.savePack(pack, sourceChecksum);
        this.store.saveIndexVersion({
          id: shortId('kiv', sourceId),
          sourceId,
          packId,
          packVersion: pack.packVersion,
          contentHash,
          status: 'ready',
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      });
      // OKF Phase 7: warm the pack cache from what was ACTUALLY persisted —
      // NOT the in-memory `pack` object built above. replaceKnowledgeCards
      // preserves user-edited cards server-side (WHERE user_edited = 0
      // guard), so a card a user edited before this regeneration survives
      // in the DB but is NOT reflected in the freshly-extracted in-memory
      // `pack` — caching that object directly would silently serve the
      // pre-edit text until the next unrelated cache invalidation. Re-read
      // from the store so the cache always mirrors ground truth.
      const persistedPack = this.store.getPackBySourceId(sourceId);
      if (persistedPack) setCachedPack(file.id, persistedPack, contentHash);

      if (rejected.length > 0) {
        console.log(`[KnowledgeManager] pack ${packId}: ${rejected.length} card(s) rejected by OkfVerifier`, {
          reasons: rejected.slice(0, 5).map((r) => r.result.reasons),
        });
      }

      // Return the PERSISTED pack (reflects any surviving user-edited
      // cards), not the freshly-extracted in-memory object — same reasoning
      // as the cache warm above.
      return { status: 'generated', pack: persistedPack ?? pack };
    } catch (err: any) {
      console.error('[KnowledgeManager] generateForFile failed:', err?.message || err);
      try {
        this.store.saveIndexVersion({
          id: shortId('kiv', existingSource?.id || file.id),
          sourceId: existingSource?.id || shortId('src', file.id),
          packVersion: 1,
          contentHash,
          status: 'failed',
          errorMessage: String(err?.message || err),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch { /* best effort */ }
      return { status: 'failed', error: String(err?.message || err) };
    }
  }

  getPackForFile(fileId: string): KnowledgePack | null {
    const source = this.store.getSourceByFileId(fileId);
    if (!source) return null;
    // OKF Phase 7: cache HIT only when the cached pack's contentHash still
    // matches the source row (a real content change always mints a new
    // contentHash, which invalidates by construction). Card edits/approvals/
    // rejections do NOT change contentHash — they explicitly call
    // invalidatePackCache() (see OkfCardEditor.ts) so a stale cached pack is
    // never served after those mutations either.
    const cached = getCachedPack(fileId, source.contentHash);
    if (cached) return cached;
    const pack = this.store.getPackBySourceId(source.id);
    if (pack) setCachedPack(fileId, pack, source.contentHash);
    return pack;
  }

  getPacksForMode(modeId: string): KnowledgePack[] {
    // OKF Profile Intelligence (2026-07-02): the document KnowledgeManager path
    // (retrieval + the knowledge:list-packs UI channel) must NEVER surface
    // profile OKF packs. Those hang off the reserved '__profile_okf__' mode
    // (migration v23); refuse it here so no caller passing the reserved id — even
    // an ungated UI handler — can read profile pack metadata through the document
    // channel. Profile packs are reached only via ProfilePackBuilder.
    if (modeId === PROFILE_OKF_MODE_ID) return [];
    return this.store.getPacksByModeId(modeId);
  }

  /**
   * Invalidate/delete the pack for a deleted reference file. This codebase
   * never enables `PRAGMA foreign_keys = ON`, so the declared `ON DELETE
   * CASCADE` on knowledge_sources' children is inert — DatabaseManager.
   * deleteKnowledgeSource performs an EXPLICIT cascade (packs, cards,
   * entities, relations, card_versions, index_versions) rather than relying
   * on FK enforcement that never fires.
   */
  deleteForFile(fileId: string): void {
    const source = this.store.getSourceByFileId(fileId);
    if (source) this.store.deleteSource(source.id);
    invalidatePackCache(fileId);
    try {
      require('./KnowledgeIndexQueue').knowledgeIndexQueue.cancel(fileId);
    } catch { /* best effort — queue module always loads in practice */ }
  }

  /**
   * Invalidate/delete every knowledge source (and their packs/cards/
   * entities/relations) belonging to a deleted Mode. Wired into
   * ModesManager.deleteMode — without this, deleting a whole Mode (as
   * opposed to deleting one reference file at a time) would orphan every
   * knowledge_* row for every reference file that Mode owned, since
   * DatabaseManager.deleteMode only removes the `modes` row itself.
   */
  deleteForMode(modeId: string): void {
    const sources = this.store.getSourcesByModeId(modeId);
    for (const source of sources) {
      this.store.deleteSource(source.id);
      if (source.fileId) {
        invalidatePackCache(source.fileId);
        try {
          require('./KnowledgeIndexQueue').knowledgeIndexQueue.cancel(source.fileId);
        } catch { /* best effort */ }
      }
    }
  }

  /**
   * OKF Phase 7: background variant of generateForFile for callers that want
   * to avoid blocking on extraction (e.g. a very large document upload).
   * Single-flight per fileId via KnowledgeIndexQueue — a duplicate call
   * while one is in flight returns the same promise. Emits 'progress'
   * events on knowledgeIndexQueue (queued/running/done/failed/cancelled)
   * that ipcHandlers can forward to the renderer.
   */
  generateForFileInBackground(file: ReferenceFileInput, force = false): Promise<GenerateResult> {
    const { knowledgeIndexQueue } = require('./KnowledgeIndexQueue') as typeof import('./KnowledgeIndexQueue');
    return knowledgeIndexQueue.enqueue(file, force, (f, fo) => this.generateForFile(f, fo));
  }
}
