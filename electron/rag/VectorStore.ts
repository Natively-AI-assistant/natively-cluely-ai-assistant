// electron/rag/VectorStore.ts
// SQLite-based vector storage with native sqlite-vec search (fallback to JS cosine similarity)

import Database from 'better-sqlite3';
import { Chunk } from './SemanticChunker';

export interface StoredChunk extends Chunk {
    id: number;
    embedding?: number[];
}

export interface ScoredChunk extends StoredChunk {
    similarity: number;
    finalScore?: number;
}

/**
 * VectorStore - SQLite-backed vector storage
 * 
 * Uses sqlite-vec extension for native vector similarity search (O(1) per query via ANN).
 * Falls back to pure JS cosine similarity if sqlite-vec is unavailable.
 */
export class VectorStore {
    private db: Database.Database;
    private useNativeVec: boolean;

    constructor(db: Database.Database) {
        this.db = db;
        this.useNativeVec = this.detectVecSupport();
    }

    /**
     * Detect if sqlite-vec vec0 tables are available
     */
    private detectVecSupport(): boolean {
        try {
            this.db.prepare("SELECT count(*) as cnt FROM vec_chunks LIMIT 1").get();
            console.log('[VectorStore] Using native sqlite-vec for vector search');
            return true;
        } catch (e: any) {
            console.warn('[VectorStore] sqlite-vec not available, using JS cosine similarity fallback. Reason:', e.message);
            return false;
        }
    }

    /**
     * Save chunks to database (without embeddings)
     */
    saveChunks(chunks: Chunk[]): number[] {
        const insert = this.db.prepare(`
            INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const ids: number[] = [];

        const insertAll = this.db.transaction(() => {
            for (const chunk of chunks) {
                const result = insert.run(
                    chunk.meetingId,
                    chunk.chunkIndex,
                    chunk.speaker,
                    chunk.startMs,
                    chunk.endMs,
                    chunk.text,
                    chunk.tokenCount
                );
                ids.push(result.lastInsertRowid as number);
            }
        });

        insertAll();
        return ids;
    }

    /**
     * Store embedding for a chunk (dual-write: BLOB column + vec0 table)
     */
    storeEmbedding(chunkId: number, embedding: number[]): void {
        const blob = this.embeddingToBlob(embedding);
        this.db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?').run(blob, chunkId);

        // Also insert into vec0 virtual table for native search
        if (this.useNativeVec) {
            try {
                // sqlite-vec requires primary key to be a strict integer
                this.db.prepare(
                    'INSERT OR REPLACE INTO vec_chunks(chunk_id, embedding) VALUES (?, ?)'
                ).run(BigInt(chunkId), blob);
            } catch (e) {
                console.warn('[VectorStore] Failed to insert into vec_chunks:', e);
            }
        }
    }

    /**
     * Get chunks without embeddings for a meeting
     */
    getChunksWithoutEmbeddings(meetingId: string): StoredChunk[] {
        const rows = this.db.prepare(`
            SELECT * FROM chunks 
            WHERE meeting_id = ? AND embedding IS NULL
            ORDER BY chunk_index ASC
        `).all(meetingId) as any[];

        return rows.map(this.rowToChunk);
    }

    /**
     * Get all chunks for a meeting
     */
    getChunksForMeeting(meetingId: string): StoredChunk[] {
        const rows = this.db.prepare(`
            SELECT * FROM chunks 
            WHERE meeting_id = ?
            ORDER BY chunk_index ASC
        `).all(meetingId) as any[];

        return rows.map(this.rowToChunk);
    }

    /**
     * Search for similar chunks using native sqlite-vec or JS fallback
     */
    searchSimilar(
        queryEmbedding: number[],
        options: {
            meetingId?: string;
            limit?: number;
            minSimilarity?: number;
        } = {}
    ): ScoredChunk[] {
        const { meetingId, limit = 8, minSimilarity = 0.25 } = options;

        if (this.useNativeVec) {
            return this.searchSimilarNative(queryEmbedding, meetingId, limit, minSimilarity);
        }
        return this.searchSimilarJS(queryEmbedding, meetingId, limit, minSimilarity);
    }

    /**
     * Native vec0 search — pushes similarity math into SQLite's C layer
     */
    private searchSimilarNative(
        queryEmbedding: number[],
        meetingId: string | undefined,
        limit: number,
        minSimilarity: number
    ): ScoredChunk[] {
        const queryBlob = this.embeddingToBlob(queryEmbedding);

        try {
            // Fetch top-K from vec0, then join with chunks for metadata
            // We fetch more than limit to allow post-filtering by meetingId and minSimilarity
            const fetchLimit = meetingId ? limit * 4 : limit;

            const vecRows = this.db.prepare(`
                SELECT chunk_id, distance
                FROM vec_chunks
                WHERE embedding MATCH ?
                ORDER BY distance
                LIMIT ?
            `).all(queryBlob, fetchLimit) as any[];

            if (vecRows.length === 0) return [];

            // Batch-fetch chunk metadata for matched IDs
            const chunkIds = vecRows.map(r => r.chunk_id);
            const placeholders = chunkIds.map(() => '?').join(',');

            let chunkQuery = `SELECT * FROM chunks WHERE id IN (${placeholders})`;
            const params: any[] = [...chunkIds];

            if (meetingId) {
                chunkQuery += ' AND meeting_id = ?';
                params.push(meetingId);
            }

            const chunkRows = this.db.prepare(chunkQuery).all(...params) as any[];

            // Build a lookup map for chunk data
            const chunkMap = new Map<number, any>();
            for (const row of chunkRows) {
                chunkMap.set(row.id, row);
            }

            // Combine distance scores with chunk data
            const scored: ScoredChunk[] = [];
            for (const vecRow of vecRows) {
                const chunkData = chunkMap.get(vecRow.chunk_id);
                if (!chunkData) continue; // Filtered out by meetingId

                const similarity = 1 - vecRow.distance; // cosine distance → similarity

                if (similarity >= minSimilarity) {
                    scored.push({
                        ...this.rowToChunk(chunkData),
                        similarity
                    });
                }
            }

            // Already ordered by distance (ascending = best first)
            return scored.slice(0, limit);

        } catch (e) {
            console.error('[VectorStore] Native vec search failed, falling back to JS:', e);
            return this.searchSimilarJS(queryEmbedding, meetingId, limit, minSimilarity);
        }
    }

    /**
     * JS fallback — original O(N) cosine similarity for when sqlite-vec is unavailable
     */
    private searchSimilarJS(
        queryEmbedding: number[],
        meetingId: string | undefined,
        limit: number,
        minSimilarity: number
    ): ScoredChunk[] {
        let query = 'SELECT * FROM chunks WHERE embedding IS NOT NULL';
        const params: any[] = [];

        if (meetingId) {
            query += ' AND meeting_id = ?';
            params.push(meetingId);
        }

        const rows = this.db.prepare(query).all(...params) as any[];
        const scored: ScoredChunk[] = [];

        for (const row of rows) {
            const chunkEmbedding = this.blobToEmbedding(row.embedding);
            const similarity = this.cosineSimilarity(queryEmbedding, chunkEmbedding);

            if (similarity >= minSimilarity) {
                scored.push({
                    ...this.rowToChunk(row),
                    embedding: chunkEmbedding,
                    similarity
                });
            }
        }

        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, limit);
    }

    /**
     * Delete all chunks for a meeting
     */
    deleteChunksForMeeting(meetingId: string): void {
        // Delete from vec0 first (need to get IDs)
        if (this.useNativeVec) {
            try {
                const ids = this.db.prepare(
                    'SELECT id FROM chunks WHERE meeting_id = ?'
                ).all(meetingId) as any[];

                if (ids.length > 0) {
                    const placeholders = ids.map(() => '?').join(',');
                    this.db.prepare(
                        `DELETE FROM vec_chunks WHERE chunk_id IN (${placeholders})`
                    ).run(...ids.map(r => r.id));
                }
            } catch (e) {
                console.warn('[VectorStore] Failed to delete from vec_chunks:', e);
            }
        }

        this.db.prepare('DELETE FROM chunks WHERE meeting_id = ?').run(meetingId);
    }

    /**
     * Check if meeting has embeddings
     */
    hasEmbeddings(meetingId: string): boolean {
        const row = this.db.prepare(`
            SELECT COUNT(*) as count FROM chunks 
            WHERE meeting_id = ? AND embedding IS NOT NULL
        `).get(meetingId) as any;

        return row.count > 0;
    }

    // ============================================
    // Summary Methods (for global search)
    // ============================================

    /**
     * Save or update meeting summary
     */
    saveSummary(meetingId: string, summaryText: string): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO chunk_summaries (meeting_id, summary_text)
            VALUES (?, ?)
        `).run(meetingId, summaryText);
    }

    /**
     * Store embedding for meeting summary (dual-write: BLOB + vec0)
     */
    storeSummaryEmbedding(meetingId: string, embedding: number[]): void {
        const blob = this.embeddingToBlob(embedding);
        this.db.prepare('UPDATE chunk_summaries SET embedding = ? WHERE meeting_id = ?').run(blob, meetingId);

        // Also insert into vec0 virtual table
        if (this.useNativeVec) {
            try {
                // Get the summary's integer ID for vec0
                const row = this.db.prepare(
                    'SELECT id FROM chunk_summaries WHERE meeting_id = ?'
                ).get(meetingId) as any;

                if (row) {
                    // sqlite-vec requires primary key to be a strict integer
                    this.db.prepare(
                        'INSERT OR REPLACE INTO vec_summaries(summary_id, embedding) VALUES (?, ?)'
                    ).run(BigInt(row.id), blob);
                }
            } catch (e) {
                console.warn('[VectorStore] Failed to insert into vec_summaries:', e);
            }
        }
    }

    /**
     * Search summaries for global queries using native vec0 or JS fallback
     */
    searchSummaries(
        queryEmbedding: number[],
        limit: number = 5
    ): { meetingId: string; summaryText: string; similarity: number }[] {
        if (this.useNativeVec) {
            return this.searchSummariesNative(queryEmbedding, limit);
        }
        return this.searchSummariesJS(queryEmbedding, limit);
    }

    /**
     * Native vec0 summary search
     */
    private searchSummariesNative(
        queryEmbedding: number[],
        limit: number
    ): { meetingId: string; summaryText: string; similarity: number }[] {
        const queryBlob = this.embeddingToBlob(queryEmbedding);

        try {
            const vecRows = this.db.prepare(`
                SELECT summary_id, distance
                FROM vec_summaries
                WHERE embedding MATCH ?
                ORDER BY distance
                LIMIT ?
            `).all(queryBlob, limit) as any[];

            if (vecRows.length === 0) return [];

            const ids = vecRows.map(r => r.summary_id);
            const placeholders = ids.map(() => '?').join(',');

            const summaryRows = this.db.prepare(
                `SELECT * FROM chunk_summaries WHERE id IN (${placeholders})`
            ).all(...ids) as any[];

            const summaryMap = new Map<number, any>();
            for (const row of summaryRows) {
                summaryMap.set(row.id, row);
            }

            const results: { meetingId: string; summaryText: string; similarity: number }[] = [];
            for (const vecRow of vecRows) {
                const summaryData = summaryMap.get(vecRow.summary_id);
                if (!summaryData) continue;

                results.push({
                    meetingId: summaryData.meeting_id,
                    summaryText: summaryData.summary_text,
                    similarity: 1 - vecRow.distance
                });
            }

            return results;

        } catch (e) {
            console.error('[VectorStore] Native summary search failed, falling back to JS:', e);
            return this.searchSummariesJS(queryEmbedding, limit);
        }
    }

    /**
     * JS fallback summary search
     */
    private searchSummariesJS(
        queryEmbedding: number[],
        limit: number
    ): { meetingId: string; summaryText: string; similarity: number }[] {
        const rows = this.db.prepare(`
            SELECT * FROM chunk_summaries WHERE embedding IS NOT NULL
        `).all() as any[];

        const scored: { meetingId: string; summaryText: string; similarity: number }[] = [];

        for (const row of rows) {
            const summaryEmbedding = this.blobToEmbedding(row.embedding);
            const similarity = this.cosineSimilarity(queryEmbedding, summaryEmbedding);

            scored.push({
                meetingId: row.meeting_id,
                summaryText: row.summary_text,
                similarity
            });
        }

        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, limit);
    }

    // ============================================
    // Private Helpers
    // ============================================

    private rowToChunk(row: any): StoredChunk {
        return {
            id: row.id,
            meetingId: row.meeting_id,
            chunkIndex: row.chunk_index,
            speaker: row.speaker,
            startMs: row.start_timestamp_ms,
            endMs: row.end_timestamp_ms,
            text: row.cleaned_text,
            tokenCount: row.token_count,
            embedding: row.embedding ? this.blobToEmbedding(row.embedding) : undefined
        };
    }

    /**
     * Convert embedding array to binary BLOB (Float32)
     */
    private embeddingToBlob(embedding: number[]): Buffer {
        const buffer = Buffer.alloc(embedding.length * 4);
        for (let i = 0; i < embedding.length; i++) {
            buffer.writeFloatLE(embedding[i], i * 4);
        }
        return buffer;
    }

    /**
     * Convert binary BLOB back to embedding array
     */
    private blobToEmbedding(blob: Buffer): number[] {
        const embedding: number[] = [];
        for (let i = 0; i < blob.length; i += 4) {
            embedding.push(blob.readFloatLE(i));
        }
        return embedding;
    }

    /**
     * Compute cosine similarity between two vectors (JS fallback only)
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
        return magnitude === 0 ? 0 : dotProduct / magnitude;
    }
}
