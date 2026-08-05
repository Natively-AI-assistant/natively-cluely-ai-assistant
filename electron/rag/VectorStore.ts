// electron/rag/VectorStore.ts
// SQLite-based vector storage with native sqlite-vec search (fallback to JS cosine similarity)
//
// Runs synchronously on the SAME better-sqlite3 connection the rest of the app
// already uses (the one DatabaseManager opened and loaded sqlite-vec on). No
// worker_threads, no second connection to the same file, no message-passing
// protocol, no independent ABI dependency, no hand-rolled deadman-switch timer.
//
// This replaces an earlier design that offloaded search to a worker_threads
// Worker with its own read-only connection. That added an entire class of
// silent-hang failure modes — a worker whose module-level require() throws
// before its message handler registers drops every message forever with no
// error and no timeout; a worker wedged inside a synchronous native call
// can't be interrupted by anything, not even its own deadman-switch timer,
// because that timer lives on the MAIN thread and only protects the
// round-trip, not the worker's internal state. For the corpus sizes this app
// actually deals with (a handful of embedded chunks per meeting, low
// thousands of chunks total even for a heavy user), a worker thread buys no
// measurable performance benefit — better-sqlite3 calls here are single
// indexed lookups or small full-table scans, not seconds-long computation —
// so the added surface area was pure risk for no upside. If a future corpus
// size genuinely needs main-thread relief, offload the WHOLE synchronous
// call (not a hand-split protocol) via Electron's utilityProcess or a
// promise-wrapped `setImmediate` batch, not a bespoke message protocol.
import Database from 'better-sqlite3';
import { Chunk } from './SemanticChunker';
import { DatabaseManager } from '../db/DatabaseManager';

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
 * Uses sqlite-vec extension for native vector similarity search (O(1) per
 * query via ANN) when available. Falls back to pure JS cosine similarity,
 * computed synchronously in-process, when it isn't.
 */
export class VectorStore {
    private db: Database.Database;
    private useNativeVec: boolean;

    constructor(db: Database.Database, _dbPath: string, _extPath: string) {
        // dbPath/extPath are retained in the constructor signature for
        // backward compatibility with every existing call site (RAGManager,
        // ModeContextRetriever, and the real-SQLite test suite all construct
        // VectorStore this way) — they were only ever needed by the worker
        // thread to open its OWN connection and load its OWN copy of the
        // extension. This class now uses the caller's connection directly,
        // which already has the extension loaded by DatabaseManager at
        // startup, so both params are unused here.
        this.db = db;
        this.useNativeVec = this.detectVecSupport();
    }

    /**
     * Detect if sqlite-vec is available (per-dimension vec0 tables must exist)
     */
    private detectVecSupport(): boolean {
        try {
            this.db.prepare("SELECT count(*) as cnt FROM vec_chunks_768 LIMIT 1").get();
            console.log('[VectorStore] Using native sqlite-vec for vector search');
            return true;
        } catch (e: any) {
            console.warn('[VectorStore] sqlite-vec not available, using JS cosine similarity fallback. Reason:', e.message);
            return false;
        }
    }

    /**
     * Retained for API compatibility with the previous worker-thread design
     * (RAGManager.dispose() calls this on app quit). There is no worker to
     * terminate anymore — this is a no-op that resolves immediately.
     */
    async destroy(): Promise<void> {
        // Intentionally empty.
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
     * Store embedding for a chunk (dual-write: BLOB column + per-dimension vec0 table)
     */
    storeEmbedding(chunkId: number, embedding: number[]): void {
        const blob = this.embeddingToBlob(embedding);
        this.db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?').run(blob, chunkId);

        // Also insert into the dimension-specific vec0 virtual table for native search
        if (this.useNativeVec) {
            const dim = embedding.length;
            // Lazily provision the table if it's a novel dimension (e.g., a new provider)
            DatabaseManager.getInstance().ensureVecTableForDim(dim);
            try {
                this.db.prepare(
                    `INSERT OR REPLACE INTO vec_chunks_${dim}(chunk_id, embedding) VALUES (?, ?)`
                ).run(BigInt(chunkId), blob);
            } catch (e) {
                console.warn(`[VectorStore] Failed to insert into vec_chunks_${dim}:`, e);
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

        return rows.map(r => this.rowToChunk(r));
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

        return rows.map(r => this.rowToChunk(r));
    }

    /**
     * Search for similar chunks using native sqlite-vec or JS fallback.
     * Fully synchronous under the hood (better-sqlite3 has no async API) —
     * wrapped in `async` only to keep the call signature unchanged for
     * every existing caller.
     */
    async searchSimilar(
        queryEmbedding: number[],
        options: {
            meetingId?: string;
            limit?: number;
            minSimilarity?: number;
            spaceKey?: string;
        } = {}
    ): Promise<ScoredChunk[]> {
        const { meetingId, limit = 8, minSimilarity = 0.25, spaceKey } = options;

        // Hard invariant: without an active space we return NOTHING rather than
        // leaking every space. The downstream filter is `if (spaceKey)`, so omitting
        // it would otherwise match ALL spaces and silently reintroduce the v1/v2 leak.
        // On the live query path spaceKey is always defined (provider.space is a
        // non-empty readonly string); this guards future callers.
        if (!spaceKey) {
            console.warn('[VectorStore] searchSimilar called without an active spaceKey — returning empty (refusing to search across embedding spaces).');
            return [];
        }

        if (this.useNativeVec) {
            try {
                return this.searchSimilarNative(queryEmbedding, meetingId, limit, minSimilarity, spaceKey);
            } catch (e) {
                console.error('[VectorStore] Native vec search failed, falling back to JS:', e);
                return this.searchSimilarJS(queryEmbedding, meetingId, limit, minSimilarity, spaceKey);
            }
        }
        return this.searchSimilarJS(queryEmbedding, meetingId, limit, minSimilarity, spaceKey);
    }

    /**
     * Native vec0 search — runs directly on the shared connection.
     */
    private searchSimilarNative(
        queryEmbedding: number[],
        meetingId: string | undefined,
        limit: number,
        minSimilarity: number,
        spaceKey: string
    ): ScoredChunk[] {
        const queryBlob = this.embeddingToBlob(queryEmbedding);
        const dim = queryEmbedding.length;
        const vecTable = `vec_chunks_${dim}`;
        const fetchLimit = (meetingId || spaceKey) ? limit * 4 : limit;

        const vecRows = this.db.prepare(`
            SELECT chunk_id, distance FROM ${vecTable}
            WHERE embedding MATCH ? ORDER BY distance LIMIT ?
        `).all(queryBlob, fetchLimit) as any[];

        if (vecRows.length === 0) return [];

        const chunkIds = vecRows.map((r: any) => r.chunk_id);
        const ph = chunkIds.map(() => '?').join(',');
        let q = `SELECT c.* FROM chunks c JOIN meetings m ON c.meeting_id = m.id WHERE c.id IN (${ph})`;
        const params: any[] = [...chunkIds];
        if (meetingId) { q += ' AND c.meeting_id = ?'; params.push(meetingId); }
        // Filter by composite embedding SPACE, not provider name. v1 and v2 Gemini
        // are both provider='gemini' @ 768d, so a provider filter would leak v1
        // vectors into v2 queries. A NULL space (not yet stamped / mid-reindex) is
        // intentionally excluded → "empty, not wrong".
        if (spaceKey) { q += ' AND m.embedding_space = ?'; params.push(spaceKey); }

        const chunkRows = this.db.prepare(q).all(...params) as any[];
        const chunkMap = new Map<number, any>();
        for (const row of chunkRows) chunkMap.set(row.id, row);

        const scored: ScoredChunk[] = [];
        for (const vecRow of vecRows) {
            const c = chunkMap.get(vecRow.chunk_id);
            if (!c) continue;
            const similarity = 1 - vecRow.distance;
            if (similarity >= minSimilarity) {
                scored.push({ ...this.rowToChunk(c), similarity });
            }
        }
        return scored.slice(0, limit);
    }

    /**
     * Pure-JS cosine similarity fallback — computed synchronously in-process.
     */
    private searchSimilarJS(
        queryEmbedding: number[],
        meetingId: string | undefined,
        limit: number,
        minSimilarity: number,
        spaceKey?: string
    ): ScoredChunk[] {
        let query = `
            SELECT c.*
            FROM chunks c
            JOIN meetings m ON c.meeting_id = m.id
            WHERE c.embedding IS NOT NULL
        `;
        const params: any[] = [];

        if (meetingId) {
            query += ' AND c.meeting_id = ?';
            params.push(meetingId);
        }
        // Filter by composite embedding SPACE, not provider name. The byteLength check
        // below only excludes DIFFERENT-dimension vectors — it cannot tell v1 768d from
        // v2 768d (same dims, incompatible space). Without this, v1 vectors would be
        // cosine-compared against v2 queries. NULL space (not yet stamped / mid-reindex)
        // is intentionally excluded → "empty, not wrong".
        if (spaceKey) {
            query += ' AND m.embedding_space = ?';
            params.push(spaceKey);
        }

        const rows = this.db.prepare(query).all(...params) as any[];
        if (rows.length === 0) return [];

        const dim = queryEmbedding.length;
        const expectedByteLength = dim * 4; // Float32 = 4 bytes

        const scored: ScoredChunk[] = [];
        for (const row of rows) {
            if (!row.embedding) continue;
            const buffer: Buffer = row.embedding;
            if (buffer.byteLength !== expectedByteLength) continue; // different-dimension provider
            const similarity = this.cosineSimilarity(queryEmbedding, buffer, dim);
            if (similarity >= minSimilarity) {
                scored.push({ ...this.rowToChunk(row), similarity });
            }
        }

        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, limit);
    }

    /**
     * Delete all chunks for a meeting (removes from all tracked dimension tables)
     */
    deleteChunksForMeeting(meetingId: string): void {
        if (this.useNativeVec) {
            try {
                const ids = this.db.prepare(
                    'SELECT id FROM chunks WHERE meeting_id = ?'
                ).all(meetingId) as any[];

                if (ids.length > 0) {
                    const placeholders = ids.map(() => '?').join(',');
                    const idList = ids.map(r => r.id);
                    // Delete from all known dimension-specific vec0 tables
                    for (const dim of DatabaseManager.getInstance().getExistingVecDims()) {
                        try {
                            this.db.prepare(
                                `DELETE FROM vec_chunks_${dim} WHERE chunk_id IN (${placeholders})`
                            ).run(...idList);
                        } catch (_) { /* dim table may not exist */ }
                    }
                }
            } catch (e) {
                console.warn('[VectorStore] Failed to delete from vec_chunks dimension tables:', e);
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

    /**
     * Backfill embedding_provider metadata for meetings that have embedded chunks
     * but a NULL embedding_provider column.
     *
     * This is a one-time migration for meetings that were embedded before the
     * provider metadata write was introduced (or if the write silently failed).
     * It is safe to call on every startup — it only touches rows where
     * embedding_provider IS NULL and the meeting has at least one embedded chunk.
     *
     * @param providerName The active embedding provider name (e.g. "local", "openai")
     * @param dimensions   The provider's embedding dimensions (e.g. 384, 1536)
     *
     * IMPORTANT: This deliberately does NOT stamp `embedding_space`. We cannot
     * prove a NULL-provider row's vectors were produced by the *current* model —
     * after a model upgrade they may be in an OLD, incompatible space (e.g. v1
     * 768d while active is v2 768d). Stamping the active space here would mislabel
     * them as compatible and they'd never be re-indexed → silent garbage similarity.
     * Instead we leave `embedding_space` NULL; the auto-reindex sweep treats
     * NULL-space-with-embeddings rows as unknown-space and safely re-embeds them.
     */
    backfillEmbeddingProviderMetadata(providerName: string, dimensions: number): number {
        try {
            // Stamp provider/dims for legacy diagnostic value only. Space stays NULL
            // on purpose (see method doc) so the re-index sweep owns the decision.
            const affected = this.db.prepare(`
                UPDATE meetings
                SET embedding_provider = ?, embedding_dimensions = ?
                WHERE embedding_provider IS NULL
                  AND id IN (
                      SELECT DISTINCT meeting_id FROM chunks WHERE embedding IS NOT NULL
                  )
            `).run(providerName, dimensions);

            if (affected.changes > 0) {
                console.log(`[VectorStore] Backfilled provider metadata for ${affected.changes} meeting(s) (space left NULL for re-index sweep)`);
            }
            return affected.changes;
        } catch (e) {
            console.warn('[VectorStore] Failed to backfill embedding_provider metadata:', e);
            return 0;
        }
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
     * Store embedding for meeting summary (dual-write: BLOB + per-dimension vec0 table)
     */
    storeSummaryEmbedding(meetingId: string, embedding: number[]): void {
        const blob = this.embeddingToBlob(embedding);
        this.db.prepare('UPDATE chunk_summaries SET embedding = ? WHERE meeting_id = ?').run(blob, meetingId);

        if (this.useNativeVec) {
            try {
                const row = this.db.prepare(
                    'SELECT id FROM chunk_summaries WHERE meeting_id = ?'
                ).get(meetingId) as any;

                if (row) {
                    const dim = embedding.length;
                    DatabaseManager.getInstance().ensureVecTableForDim(dim);
                    this.db.prepare(
                        `INSERT OR REPLACE INTO vec_summaries_${dim}(summary_id, embedding) VALUES (?, ?)`
                    ).run(BigInt(row.id), blob);
                }
            } catch (e) {
                console.warn('[VectorStore] Failed to insert into vec_summaries dim table:', e);
            }
        }
    }

    /**
     * Stamp a meeting's embedding space/provider/dims if not already set.
     * Called by the live indexer right after storing an embedding so that
     * in-session meetings are correctly labeled with the ACTIVE space — which
     * makes them searchable in-session (search filters on space) and keeps them
     * out of the "unknown-space" re-index sweep. Idempotent; only sets when NULL.
     */
    stampMeetingSpaceIfUnset(meetingId: string, providerName: string, dimensions: number, space: string): void {
        try {
            this.db.prepare(
                'UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ?, embedding_space = ? WHERE id = ? AND embedding_space IS NULL'
            ).run(providerName, dimensions, space, meetingId);
        } catch (e) {
            // Non-fatal — re-index sweep will catch an unstamped meeting later.
        }
    }

    /**
     * Search summaries for global queries using native vec0 or JS fallback.
     * Fully synchronous under the hood; `async` kept for call-signature parity.
     */
    async searchSummaries(
        queryEmbedding: number[],
        limit: number = 5,
        spaceKey?: string
    ): Promise<{ meetingId: string; summaryText: string; similarity: number }[]> {
        // Same hard invariant as searchSimilar: no active space → return nothing
        // rather than leaking every space (see searchSimilar for rationale).
        if (!spaceKey) {
            console.warn('[VectorStore] searchSummaries called without an active spaceKey — returning empty.');
            return [];
        }
        if (this.useNativeVec) {
            try {
                return this.searchSummariesNative(queryEmbedding, limit, spaceKey);
            } catch (e) {
                console.error('[VectorStore] Native summary search failed, falling back to JS:', e);
                return this.searchSummariesJS(queryEmbedding, limit, spaceKey);
            }
        }
        return this.searchSummariesJS(queryEmbedding, limit, spaceKey);
    }

    /**
     * Native vec0 summary search — runs directly on the shared connection.
     */
    private searchSummariesNative(
        queryEmbedding: number[],
        limit: number,
        spaceKey: string
    ): { meetingId: string; summaryText: string; similarity: number }[] {
        const queryBlob = this.embeddingToBlob(queryEmbedding);
        const dim = queryEmbedding.length;
        const vecTable = `vec_summaries_${dim}`;
        const fetchLimit = spaceKey ? limit * 4 : limit;

        const vecRows = this.db.prepare(`
            SELECT summary_id, distance FROM ${vecTable}
            WHERE embedding MATCH ? ORDER BY distance LIMIT ?
        `).all(queryBlob, fetchLimit) as any[];

        if (vecRows.length === 0) return [];

        const ids = vecRows.map((r: any) => r.summary_id);
        const ph = ids.map(() => '?').join(',');
        let sq = `SELECT s.* FROM chunk_summaries s JOIN meetings m ON s.meeting_id = m.id WHERE s.id IN (${ph})`;
        const params: any[] = [...ids];
        // Filter by composite embedding SPACE, not provider name (see searchSimilarNative).
        if (spaceKey) { sq += ' AND m.embedding_space = ?'; params.push(spaceKey); }

        const summaryRows = this.db.prepare(sq).all(...params) as any[];
        const summaryMap = new Map<number, any>();
        for (const row of summaryRows) summaryMap.set(row.id, row);

        const results: { meetingId: string; summaryText: string; similarity: number }[] = [];
        for (const vecRow of vecRows) {
            const s = summaryMap.get(vecRow.summary_id);
            if (!s) continue;
            results.push({ meetingId: s.meeting_id, summaryText: s.summary_text, similarity: 1 - vecRow.distance });
        }
        return results.slice(0, limit);
    }

    /**
     * JS fallback summary search — computed synchronously in-process.
     */
    private searchSummariesJS(
        queryEmbedding: number[],
        limit: number,
        spaceKey?: string
    ): { meetingId: string; summaryText: string; similarity: number }[] {
        // Filter by composite embedding SPACE, not provider name (see searchSimilarJS).
        // The byte-length dimension check below cannot distinguish v1 768d from v2 768d.
        // NULL space is intentionally excluded → "empty, not wrong".
        let query = `
            SELECT s.*
            FROM chunk_summaries s
            JOIN meetings m ON s.meeting_id = m.id
            WHERE s.embedding IS NOT NULL
        `;
        const params: any[] = [];
        if (spaceKey) {
            query += ' AND m.embedding_space = ?';
            params.push(spaceKey);
        }

        const rows = this.db.prepare(query).all(...params) as any[];

        const dim = queryEmbedding.length;
        const expectedByteLength = dim * 4;

        const results: { meetingId: string; summaryText: string; similarity: number }[] = [];
        for (const row of rows) {
            if (!row.embedding) continue;
            const buffer: Buffer = row.embedding;
            if (buffer.byteLength !== expectedByteLength) continue;
            const similarity = this.cosineSimilarity(queryEmbedding, buffer, dim);
            results.push({ meetingId: row.meeting_id, summaryText: row.summary_text, similarity });
        }

        results.sort((a, b) => b.similarity - a.similarity);
        return results.slice(0, limit);
    }

    // ============================================
    // Re-indexing Utilities
    // ============================================

    /**
     * Get count of meetings whose embeddings must be rebuilt for the active space.
     *
     * Two populations qualify:
     *  1. KNOWN-INCOMPATIBLE: embedding_space is set and differs from active
     *     (e.g. gemini-embedding-001 768d while active is gemini-embedding-2 768d —
     *     same name/dims, different space; the whole reason space keys on the
     *     composite `${name}:${model}:${dims}`, see embeddingSpace.ts).
     *  2. UNKNOWN-SPACE-WITH-EMBEDDINGS: embedding_space IS NULL but the meeting
     *     has stored embeddings (legacy rows, or pre-metadata embeds). We cannot
     *     prove these are in the active space, so they MUST be re-embedded rather
     *     than trusted — trusting them is exactly the silent-garbage hazard.
     */
    /**
     * Shared WHERE body identifying meetings that need re-embedding for the active
     * space. Two populations: (1) KNOWN-INCOMPATIBLE — embedding_space set and !=
     * active (e.g. gemini-embedding-001 768d vs active -2 768d; the whole reason
     * space keys on the composite `${name}:${model}:${dims}`). (2) UNKNOWN-SPACE-
     * WITH-EMBEDDINGS — embedding_space NULL but the meeting has stored vectors
     * (legacy / pre-metadata); we can't prove they're in the active space so they
     * MUST be re-embedded, not trusted.
     *
     * SINGLE SOURCE so getIncompatibleSpaceCount (the trigger) and
     * getMeetingIdsNeedingReindex (the worklist) can NEVER drift — a mismatch would
     * make the count say "N to reindex" while a different set actually gets requeued.
     * The bound parameter is `activeSpace` (the `!= ?` placeholder).
     */
    private static readonly REINDEX_PREDICATE = `
        m.is_processed = 1
        AND (
            (m.embedding_space IS NOT NULL AND m.embedding_space != ?)
            OR (m.embedding_space IS NULL AND (
                EXISTS (SELECT 1 FROM chunks c WHERE c.meeting_id = m.id AND c.embedding IS NOT NULL)
                OR EXISTS (SELECT 1 FROM chunk_summaries s WHERE s.meeting_id = m.id AND s.embedding IS NOT NULL)
            ))
        )
    `;

    getIncompatibleSpaceCount(activeSpace: string): number {
        const row = this.db.prepare(
            `SELECT COUNT(*) as count FROM meetings m WHERE ${VectorStore.REINDEX_PREDICATE}`
        ).get(activeSpace) as any;

        return row.count || 0;
    }

    /**
     * Return meeting ids that need re-embedding for the active space, most-recent
     * first. SELECTION ONLY — does not mutate. Uses the SAME REINDEX_PREDICATE as
     * getIncompatibleSpaceCount so the trigger and the worklist can't diverge.
     */
    getMeetingIdsNeedingReindex(activeSpace: string): string[] {
        const rows = this.db.prepare(
            `SELECT m.id FROM meetings m WHERE ${VectorStore.REINDEX_PREDICATE} ORDER BY m.created_at DESC`
        ).all(activeSpace) as any[];
        return rows.map(r => r.id);
    }

    /**
     * Delete embeddings for meetings whose space differs from the active one,
     * to prep for the re-indexer. Returns affected meeting ids, most-recent-first.
     *
     * NOTE: bulk variant — prefer the per-meeting clearEmbeddingsForMeeting() inside
     * the re-index loop for crash-resumability. Retained for the manual IPC path.
     */
    deleteEmbeddingsForSpace(activeSpace: string): string[] {
        const meetingIds = this.getMeetingIdsNeedingReindex(activeSpace);
        if (meetingIds.length === 0) return [];

        for (const id of meetingIds) {
            // Nullify embeddings
            this.db.prepare('UPDATE chunks SET embedding = NULL WHERE meeting_id = ?').run(id);
            this.db.prepare('UPDATE chunk_summaries SET embedding = NULL WHERE meeting_id = ?').run(id);
            this.db.prepare('UPDATE meetings SET embedding_provider = NULL, embedding_dimensions = NULL, embedding_space = NULL WHERE id = ?').run(id);

            // Delete from per-dimension vec0 tables
            if (this.useNativeVec) {
                try {
                    const cIds = this.db.prepare('SELECT id FROM chunks WHERE meeting_id = ?').all(id) as any[];
                    if (cIds.length > 0) {
                        const placeholders = cIds.map(() => '?').join(',');
                        const idList = cIds.map(r => r.id);
                        for (const dim of DatabaseManager.getInstance().getExistingVecDims()) {
                            try {
                                this.db.prepare(`DELETE FROM vec_chunks_${dim} WHERE chunk_id IN (${placeholders})`).run(...idList);
                            } catch (_) { /* dim table may not exist */ }
                        }
                    }

                    const sIds = this.db.prepare('SELECT id FROM chunk_summaries WHERE meeting_id = ?').get(id) as any;
                    if (sIds) {
                        for (const dim of DatabaseManager.getInstance().getExistingVecDims()) {
                            try {
                                this.db.prepare(`DELETE FROM vec_summaries_${dim} WHERE summary_id = ?`).run(sIds.id);
                            } catch (_) { /* dim table may not exist */ }
                        }
                    }
                } catch (e) {
                    console.warn(`[VectorStore] deleteEmbeddingsForSpace: vec0 cleanup failed for meeting ${id}:`, e);
                }
            }
        }
        return meetingIds;
    }


    /**
     * Clear embeddings for a single meeting without deleting chunks.
     * Used when falling back to a different provider mid-stream — the chunks
     * are kept but their embedding BLOBs, vec0 rows, and provider metadata
     * are wiped so the new provider can embed them cleanly.
     */
    clearEmbeddingsForMeeting(meetingId: string): void {
        // Wipe embedding blobs from chunks and summaries
        this.db.prepare('UPDATE chunks SET embedding = NULL WHERE meeting_id = ?').run(meetingId);
        this.db.prepare('UPDATE chunk_summaries SET embedding = NULL WHERE meeting_id = ?').run(meetingId);

        // Reset provider metadata so it gets re-assigned by the fallback provider
        this.db.prepare(
            'UPDATE meetings SET embedding_provider = NULL, embedding_dimensions = NULL, embedding_space = NULL WHERE id = ?'
        ).run(meetingId);

        // Delete rows from all per-dimension vec0 tables
        if (this.useNativeVec) {
            try {
                const cIds = this.db.prepare('SELECT id FROM chunks WHERE meeting_id = ?').all(meetingId) as any[];
                if (cIds.length > 0) {
                    const placeholders = cIds.map(() => '?').join(',');
                    const idList = cIds.map(r => r.id);
                    for (const dim of DatabaseManager.getInstance().getExistingVecDims()) {
                        try {
                            this.db.prepare(
                                `DELETE FROM vec_chunks_${dim} WHERE chunk_id IN (${placeholders})`
                            ).run(...idList);
                        } catch (_) { /* dim table may not exist */ }
                    }
                }

                const sRow = this.db.prepare('SELECT id FROM chunk_summaries WHERE meeting_id = ?').get(meetingId) as any;
                if (sRow) {
                    for (const dim of DatabaseManager.getInstance().getExistingVecDims()) {
                        try {
                            this.db.prepare(`DELETE FROM vec_summaries_${dim} WHERE summary_id = ?`).run(sRow.id);
                        } catch (_) { /* dim table may not exist */ }
                    }
                }
            } catch (e) {
                console.warn('[VectorStore] clearEmbeddingsForMeeting: error deleting from vec0 tables:', e);
            }
        }

        console.log(`[VectorStore] Cleared embeddings for meeting ${meetingId} (chunks preserved for re-embedding)`);
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
            embedding: undefined // Explicitly avoiding buffer parsing unless needed
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
     * Cosine similarity between a plain query vector and a Float32 BLOB
     * (read directly from the buffer, no intermediate array allocation).
     */
    private cosineSimilarity(query: number[], blob: Buffer, dim: number): number {
        let dot = 0, normQ = 0, normB = 0;
        for (let i = 0; i < dim; i++) {
            const q = query[i];
            const b = blob.readFloatLE(i * 4);
            dot += q * b;
            normQ += q * q;
            normB += b * b;
        }
        const magnitude = Math.sqrt(normQ) * Math.sqrt(normB);
        return magnitude === 0 ? 0 : dot / magnitude;
    }

}
