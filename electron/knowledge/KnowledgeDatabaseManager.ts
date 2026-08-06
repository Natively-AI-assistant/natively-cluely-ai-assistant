// electron/knowledge/KnowledgeDatabaseManager.ts
// SQLite-backed store for ingested knowledge documents (resume / JD / reference
// / lesson) and their embedded chunks. Reuses the meeting-RAG vector infra:
// sqlite-vec vec0 tables (vec_knowledge_chunks_{dim}) for native ANN search,
// with a pure-JS cosine fallback when the extension is unavailable.
//
// Schema is owned by DatabaseManager migration v26 — this class only reads/writes
// it. Constructed with the shared better-sqlite3 handle (same pattern as
// VectorStore), so it participates in the app's single connection + WAL + the
// `foreign_keys = ON` pragma DatabaseManager sets at boot (re-asserted here so
// the cascade holds even if this manager is constructed against a bare handle,
// e.g. an in-memory test DB).

import Database from 'better-sqlite3';
import { DatabaseManager } from '../db/DatabaseManager';
import { DocType } from './types';

export interface KnowledgeDocument {
    id: number;
    docType: DocType;
    filePath: string | null;
    fileName: string | null;
    rawText: string;
    structuredData: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface KnowledgeChunkInput {
    chunkIndex: number;
    text: string;
    embedding?: number[];
    embeddingProvider?: string;
    embeddingDimensions?: number;
    embeddingSpace?: string;
}

export interface ScoredKnowledgeChunk {
    id: number;
    documentId: number;
    docType: DocType;
    chunkIndex: number;
    text: string;
    similarity: number;
    // Validation metadata: lexical/vector similarity alone is NOT proof. Callers
    // upgrade a match to evidence only after checking these against the active
    // embedding space + requested doc scope.
    embeddingSpace: string | null;
    vectorSearch: boolean;
}

export class KnowledgeDatabaseManager {
    private db: Database.Database;
    private useNativeVec: boolean;

    constructor(db: Database.Database) {
        this.db = db;
        try {
            this.db.pragma('foreign_keys = ON');
        } catch { /* best-effort — shared connection already enables this */ }
        this.useNativeVec = this.detectVecSupport();
    }

    private detectVecSupport(): boolean {
        try {
            this.db.prepare('SELECT count(*) as cnt FROM vec_knowledge_chunks_768 LIMIT 1').get();
            return true;
        } catch (e: any) {
            console.warn('[KnowledgeDatabaseManager] sqlite-vec not available, using JS cosine similarity fallback. Reason:', e.message);
            return false;
        }
    }

    /**
     * Insert or update the single document of a given type. Knowledge documents
     * are singletons per doc_type (one resume, one JD, …): upsert replaces the
     * existing row of that type — and its chunks cascade out — so re-ingesting a
     * file never leaves stale chunks behind.
     */
    upsertDocument(doc: {
        docType: DocType;
        filePath?: string | null;
        fileName?: string | null;
        rawText: string;
        structuredData?: string | null;
    }): number {
        const upsert = this.db.transaction(() => {
            this.deleteByDocType(doc.docType);
            const result = this.db.prepare(`
                INSERT INTO knowledge_documents (doc_type, file_path, file_name, raw_text, structured_data, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(
                doc.docType,
                doc.filePath ?? null,
                doc.fileName ?? null,
                doc.rawText,
                doc.structuredData ?? null,
            );
            return result.lastInsertRowid as number;
        });
        return upsert();
    }

    /**
     * Append (or replace-by-file) a document WITHOUT wiping the rest of the
     * doc_type — the multi-document path for LESSON, where the corpus is many
     * files. Re-ingesting the same file_path replaces just that file's row +
     * chunks (idempotent re-upload); a new file_path adds to the corpus. Contrast
     * with upsertDocument, which is singleton (one RESUME / one JD).
     */
    appendDocument(doc: {
        docType: DocType;
        filePath?: string | null;
        fileName?: string | null;
        rawText: string;
        structuredData?: string | null;
    }): number {
        const append = this.db.transaction(() => {
            if (doc.filePath) this.deleteByFilePath(doc.docType, doc.filePath);
            const result = this.db.prepare(`
                INSERT INTO knowledge_documents (doc_type, file_path, file_name, raw_text, structured_data, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(
                doc.docType,
                doc.filePath ?? null,
                doc.fileName ?? null,
                doc.rawText,
                doc.structuredData ?? null,
            );
            return result.lastInsertRowid as number;
        });
        return append();
    }

    /** Reap a single document (by doc_type + file_path) and its chunks/vec rows. */
    private deleteByFilePath(docType: DocType, filePath: string): void {
        const chunkIds = this.db.prepare(`
            SELECT c.id FROM knowledge_chunks c
            JOIN knowledge_documents d ON c.document_id = d.id
            WHERE d.doc_type = ? AND d.file_path = ?
        `).all(docType, filePath) as { id: number }[];
        this.reapVecRows(chunkIds);
        this.db.prepare('DELETE FROM knowledge_documents WHERE doc_type = ? AND file_path = ?').run(docType, filePath);
    }

    /** Delete vec0 rows for the given chunk ids across all provisioned dims. */
    private reapVecRows(chunkIds: { id: number }[]): void {
        if (!this.useNativeVec || chunkIds.length === 0) return;
        const placeholders = chunkIds.map(() => '?').join(',');
        const idList = chunkIds.map(r => r.id);
        for (const dim of DatabaseManager.getInstance().getExistingVecDims()) {
            try {
                this.db.prepare(
                    `DELETE FROM vec_knowledge_chunks_${dim} WHERE chunk_id IN (${placeholders})`
                ).run(...idList);
            } catch (_) { /* dim table may not exist */ }
        }
    }

    /**
     * Delete every document of a doc_type (and, via ON DELETE CASCADE, its
     * chunks). Also reaps the vec0 rows for those chunks across all provisioned
     * dimensions — sqlite-vec virtual tables are NOT reached by FK cascade.
     */
    deleteByDocType(docType: DocType): void {
        const chunkIds = this.db.prepare(`
            SELECT c.id FROM knowledge_chunks c
            JOIN knowledge_documents d ON c.document_id = d.id
            WHERE d.doc_type = ?
        `).all(docType) as { id: number }[];

        this.reapVecRows(chunkIds);
        this.db.prepare('DELETE FROM knowledge_documents WHERE doc_type = ?').run(docType);
    }

    /**
     * Persist chunks for a document (with embeddings if provided). Dual-writes
     * each embedding to the chunks.embedding BLOB and the per-dimension vec0
     * table, mirroring VectorStore.storeEmbedding. Returns inserted chunk ids.
     */
    saveChunks(documentId: number, chunks: KnowledgeChunkInput[]): number[] {
        const insert = this.db.prepare(`
            INSERT INTO knowledge_chunks
                (document_id, chunk_index, text, embedding, embedding_provider, embedding_dimensions, embedding_space)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const ids: number[] = [];

        const insertAll = this.db.transaction(() => {
            for (const chunk of chunks) {
                const blob = chunk.embedding ? this.embeddingToBlob(chunk.embedding) : null;
                const result = insert.run(
                    documentId,
                    chunk.chunkIndex,
                    chunk.text,
                    blob,
                    chunk.embeddingProvider ?? null,
                    chunk.embeddingDimensions ?? (chunk.embedding ? chunk.embedding.length : null),
                    chunk.embeddingSpace ?? null,
                );
                const chunkId = result.lastInsertRowid as number;
                ids.push(chunkId);

                if (blob && this.useNativeVec && chunk.embedding) {
                    const dim = chunk.embedding.length;
                    DatabaseManager.getInstance().ensureVecTableForDim(dim);
                    try {
                        this.db.prepare(
                            `INSERT OR REPLACE INTO vec_knowledge_chunks_${dim}(chunk_id, embedding) VALUES (?, ?)`
                        ).run(BigInt(chunkId), blob);
                    } catch (e) {
                        console.warn(`[KnowledgeDatabaseManager] Failed to insert into vec_knowledge_chunks_${dim}:`, e);
                    }
                }
            }
        });

        insertAll();
        return ids;
    }

    /**
     * Top-k chunks by vector similarity, optionally scoped to a doc_type.
     *
     * HARD INVARIANT (same as VectorStore.searchSimilar): without an active
     * spaceKey we return NOTHING rather than comparing across embedding spaces —
     * v1 and v2 vectors of the same dimension are silently incomparable, so a
     * missing space filter would leak semantically-random matches. Every result
     * carries its embedding_space + vectorSearch flag so a caller can enforce
     * "similarity is not proof" downstream.
     */
    async queryChunksByEmbedding(
        queryEmbedding: number[],
        options: {
            docType?: DocType;
            limit?: number;
            minSimilarity?: number;
            spaceKey?: string;
        } = {}
    ): Promise<ScoredKnowledgeChunk[]> {
        const { docType, limit = 8, minSimilarity = 0.25, spaceKey } = options;

        if (!spaceKey) {
            console.warn('[KnowledgeDatabaseManager] queryChunksByEmbedding called without an active spaceKey — returning empty (refusing to search across embedding spaces).');
            return [];
        }

        if (this.useNativeVec) {
            const native = this.queryNative(queryEmbedding, docType, limit, minSimilarity, spaceKey);
            if (native !== null) return native;
        }
        return this.queryJs(queryEmbedding, docType, limit, minSimilarity, spaceKey);
    }

    /** Returns null on native-path failure so the caller can fall back to JS. */
    private queryNative(
        queryEmbedding: number[],
        docType: DocType | undefined,
        limit: number,
        minSimilarity: number,
        spaceKey: string
    ): ScoredKnowledgeChunk[] | null {
        const dim = queryEmbedding.length;
        const queryBlob = this.embeddingToBlob(queryEmbedding);
        const fetchLimit = limit * 4; // over-fetch, then filter by space/doc_type
        try {
            const vecRows = this.db.prepare(`
                SELECT chunk_id, distance FROM vec_knowledge_chunks_${dim}
                WHERE embedding MATCH ? ORDER BY distance LIMIT ?
            `).all(queryBlob, fetchLimit) as { chunk_id: number; distance: number }[];

            if (vecRows.length === 0) return [];

            const chunkIds = vecRows.map(r => r.chunk_id);
            const ph = chunkIds.map(() => '?').join(',');
            let q = `
                SELECT c.id, c.document_id, c.chunk_index, c.text, c.embedding_space, d.doc_type
                FROM knowledge_chunks c
                JOIN knowledge_documents d ON c.document_id = d.id
                WHERE c.id IN (${ph}) AND c.embedding_space = ?
            `;
            const params: any[] = [...chunkIds, spaceKey];
            if (docType) { q += ' AND d.doc_type = ?'; params.push(docType); }

            const rows = this.db.prepare(q).all(...params) as any[];
            const byId = new Map<number, any>();
            for (const r of rows) byId.set(r.id, r);

            const scored: ScoredKnowledgeChunk[] = [];
            for (const vr of vecRows) {
                const r = byId.get(vr.chunk_id);
                if (!r) continue;
                const similarity = 1 - vr.distance;
                if (similarity >= minSimilarity) {
                    scored.push(this.toScored(r, similarity, true));
                }
            }
            return scored.slice(0, limit);
        } catch (e) {
            console.error('[KnowledgeDatabaseManager] Native vec search failed, falling back to JS:', e);
            return null;
        }
    }

    private queryJs(
        queryEmbedding: number[],
        docType: DocType | undefined,
        limit: number,
        minSimilarity: number,
        spaceKey: string
    ): ScoredKnowledgeChunk[] {
        let q = `
            SELECT c.id, c.document_id, c.chunk_index, c.text, c.embedding, c.embedding_space, d.doc_type
            FROM knowledge_chunks c
            JOIN knowledge_documents d ON c.document_id = d.id
            WHERE c.embedding IS NOT NULL AND c.embedding_space = ?
        `;
        const params: any[] = [spaceKey];
        if (docType) { q += ' AND d.doc_type = ?'; params.push(docType); }

        const rows = this.db.prepare(q).all(...params) as any[];
        const dim = queryEmbedding.length;
        const expectedByteLength = dim * 4;

        const scored: ScoredKnowledgeChunk[] = [];
        for (const r of rows) {
            const buffer = r.embedding as Buffer;
            if (!buffer || buffer.byteLength !== expectedByteLength) continue;
            const similarity = this.cosineSimilarity(queryEmbedding, buffer, dim);
            if (similarity >= minSimilarity) {
                scored.push(this.toScored(r, similarity, false));
            }
        }
        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, limit);
    }

    /**
     * True if any embedded chunk of this doc_type is NOT in the active space
     * (a different/older space, or NULL-space-with-embedding). Drives the
     * orchestrator's re-embed self-heal — the knowledge analogue of the
     * meeting-RAG re-index sweep. Chunks with no embedding are ignored (nothing
     * to compare). Returns false when nothing needs re-embedding.
     */
    hasChunksOutsideSpace(docType: DocType, activeSpace: string): boolean {
        const row = this.db.prepare(`
            SELECT COUNT(*) AS n FROM knowledge_chunks c
            JOIN knowledge_documents d ON c.document_id = d.id
            WHERE d.doc_type = ?
              AND c.embedding IS NOT NULL
              AND (c.embedding_space IS NULL OR c.embedding_space != ?)
        `).get(docType, activeSpace) as { n: number };
        return (row?.n ?? 0) > 0;
    }

    /** Latest document of a type, or null. Documents are singletons per type. */
    getDocumentByType(docType: DocType): KnowledgeDocument | null {
        const row = this.db.prepare(`
            SELECT * FROM knowledge_documents WHERE doc_type = ? ORDER BY id DESC LIMIT 1
        `).get(docType) as any;
        return row ? this.rowToDocument(row) : null;
    }

    /**
     * Cheap GROUP BY for the phone knowledge gateway `/knowledge/docs` list —
     * document counts only (no chunk/embedding scan).
     */
    countDocumentsByType(): Array<{ docType: DocType; count: number }> {
        const rows = this.db.prepare(`
            SELECT doc_type AS docType, COUNT(*) AS count
            FROM knowledge_documents
            GROUP BY doc_type
            ORDER BY doc_type
        `).all() as Array<{ docType: string; count: number }>;
        return rows.map((r) => ({
            docType: r.docType as DocType,
            count: Number(r.count) || 0,
        }));
    }

    // ============================================
    // Private Helpers
    // ============================================

    private toScored(row: any, similarity: number, vectorSearch: boolean): ScoredKnowledgeChunk {
        return {
            id: row.id,
            documentId: row.document_id,
            docType: row.doc_type as DocType,
            chunkIndex: row.chunk_index,
            text: row.text,
            similarity,
            embeddingSpace: row.embedding_space ?? null,
            vectorSearch,
        };
    }

    private rowToDocument(row: any): KnowledgeDocument {
        return {
            id: row.id,
            docType: row.doc_type as DocType,
            filePath: row.file_path ?? null,
            fileName: row.file_name ?? null,
            rawText: row.raw_text,
            structuredData: row.structured_data ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private embeddingToBlob(embedding: number[]): Buffer {
        const buffer = Buffer.alloc(embedding.length * 4);
        for (let i = 0; i < embedding.length; i++) {
            buffer.writeFloatLE(embedding[i], i * 4);
        }
        return buffer;
    }

    private cosineSimilarity(query: number[], blob: Buffer, dim: number): number {
        let dot = 0;
        let magQ = 0;
        let magB = 0;
        for (let i = 0; i < dim; i++) {
            const b = blob.readFloatLE(i * 4);
            dot += query[i] * b;
            magQ += query[i] * query[i];
            magB += b * b;
        }
        const denom = Math.sqrt(magQ) * Math.sqrt(magB);
        return denom === 0 ? 0 : dot / denom;
    }
}
