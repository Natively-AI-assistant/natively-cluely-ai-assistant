// electron/rag/vectorSearchWorker.ts
// Worker thread for offloading ALL vector search computation from the Electron main thread.
//
// Handles TWO search strategies:
//   1. nativeVecSearch / nativeSummarySearch: opens its own read-only DB connection
//      and calls sqlite-vec in the worker (avoids blocking the main thread's event loop).
//   2. searchChunks / searchSummaries: pure-JS cosine similarity on pre-fetched Float32 blobs.
//
// All responses are sent back as { type: 'result' | 'error', requestId, data? }.

import { parentPort } from 'worker_threads';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';

interface NativeVecSearchChunksMessage {
    type: 'nativeVecSearch';
    requestId: number;
    dbPath: string;
    extPath: string; // path to sqlite-vec extension (without platform suffix)
    queryBlob: Buffer;
    dim: number;        // embedding dimension — selects vec_chunks_{dim} table
    meetingId?: string;
    providerName?: string;
    limit: number;
    minSimilarity: number;
    fetchMultiplier: number;
}

interface NativeVecSearchSummariesMessage {
    type: 'nativeVecSearchSummaries';
    requestId: number;
    dbPath: string;
    extPath: string;
    queryBlob: Buffer;
    dim: number;        // embedding dimension — selects vec_summaries_{dim} table
    providerName?: string;
    limit: number;
}

interface SearchChunksMessage {
    type: 'searchChunks';
    requestId: number;
    queryEmbedding: Float32Array;  // Transferred, not copied
    rowCount: number;
    embeddingDim: number;
    embeddings: Float32Array;      // Flat buffer: N rows × D dims, transferred
    rowMeta: Array<{               // Lightweight metadata (no embedding copy)
        id: number;
        meeting_id: string;
        chunk_index: number;
        speaker: string;
        start_timestamp_ms: number;
        end_timestamp_ms: number;
        cleaned_text: string;
        token_count: number;
    }>;
    minSimilarity: number;
    limit: number;
}

interface SearchSummariesMessage {
    type: 'searchSummaries';
    requestId: number;
    queryEmbedding: Float32Array;
    rowCount: number;
    embeddingDim: number;
    embeddings: Float32Array;
    rowMeta: Array<{
        id: number;
        meeting_id: string;
        summary_text: string;
    }>;
    limit: number;
}

type WorkerMessage = NativeVecSearchChunksMessage | NativeVecSearchSummariesMessage | SearchChunksMessage | SearchSummariesMessage;

// ============================================
// Math helpers — operates directly on Float32Array slices
// ============================================

function cosineSimilarityF32(
    a: Float32Array,
    b: Float32Array,
    bOffset: number,
    dim: number
): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < dim; i++) {
        const ai = a[i];
        const bi = b[bOffset + i];
        dotProduct += ai * bi;
        normA += ai * ai;
        normB += bi * bi;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// ============================================
// Message handler
// ============================================

if (!parentPort) {
    throw new Error('vectorSearchWorker must be run as a worker_threads Worker');
}

// Cache for DB connections keyed by DB path to avoid re-opening on every call.
// The worker is long-lived, so this is safe and efficient.
const dbCache = new Map<string, Database.Database>();

function getDb(dbPath: string, extPath: string): Database.Database {
    if (dbCache.has(dbPath)) return dbCache.get(dbPath)!;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        db.loadExtension(extPath);
    } catch (e) {
        // Extension may already be loaded or unavailable; proceed anyway.
    }
    dbCache.set(dbPath, db);
    return db;
}

parentPort.on('message', (message: WorkerMessage) => {
    try {
        switch (message.type) {
            case 'searchChunks': {
                const { requestId, queryEmbedding, embeddings, embeddingDim, rowMeta, minSimilarity, limit } = message;
                const scored: Array<{
                    id: number;
                    meetingId: string;
                    chunkIndex: number;
                    speaker: string;
                    startMs: number;
                    endMs: number;
                    text: string;
                    tokenCount: number;
                    similarity: number;
                }> = [];

                for (let i = 0; i < rowMeta.length; i++) {
                    const similarity = cosineSimilarityF32(queryEmbedding, embeddings, i * embeddingDim, embeddingDim);
                    if (similarity >= minSimilarity) {
                        const meta = rowMeta[i];
                        scored.push({
                            id: meta.id,
                            meetingId: meta.meeting_id,
                            chunkIndex: meta.chunk_index,
                            speaker: meta.speaker,
                            startMs: meta.start_timestamp_ms,
                            endMs: meta.end_timestamp_ms,
                            text: meta.cleaned_text,
                            tokenCount: meta.token_count,
                            similarity
                        });
                    }
                }

                scored.sort((a, b) => b.similarity - a.similarity);
                parentPort!.postMessage({
                    type: 'result',
                    requestId,
                    data: scored.slice(0, limit)
                });
                break;
            }

            case 'searchSummaries': {
                const { requestId, queryEmbedding, embeddings, embeddingDim, rowMeta, limit } = message;
                const scored: Array<{
                    meetingId: string;
                    summaryText: string;
                    similarity: number;
                }> = [];

                for (let i = 0; i < rowMeta.length; i++) {
                    const similarity = cosineSimilarityF32(queryEmbedding, embeddings, i * embeddingDim, embeddingDim);
                    const meta = rowMeta[i];
                    scored.push({
                        meetingId: meta.meeting_id,
                        summaryText: meta.summary_text,
                        similarity
                    });
                }

                scored.sort((a, b) => b.similarity - a.similarity);
                parentPort!.postMessage({
                    type: 'result',
                    requestId,
                    data: scored.slice(0, limit)
                });
                break;
            }

            case 'nativeVecSearch': {
                const { requestId, dbPath, extPath, queryBlob, dim, meetingId, providerName, limit, minSimilarity, fetchMultiplier } = message;
                const db = getDb(dbPath, extPath);
                const fetchLimit = (meetingId || providerName) ? limit * fetchMultiplier : limit;
                const vecTable = `vec_chunks_${dim}`;

                const vecRows = db.prepare(`
                    SELECT chunk_id, distance FROM ${vecTable}
                    WHERE embedding MATCH ? ORDER BY distance LIMIT ?
                `).all(queryBlob, fetchLimit) as any[];

                if (vecRows.length === 0) { parentPort!.postMessage({ type: 'result', requestId, data: [] }); break; }

                const chunkIds = vecRows.map((r: any) => r.chunk_id);
                const ph = chunkIds.map(() => '?').join(',');
                let q = `SELECT c.* FROM chunks c JOIN meetings m ON c.meeting_id = m.id WHERE c.id IN (${ph})`;
                const params: any[] = [...chunkIds];
                if (meetingId) { q += ' AND c.meeting_id = ?'; params.push(meetingId); }
                if (providerName) { q += ' AND m.embedding_provider = ?'; params.push(providerName); }

                const chunkRows = db.prepare(q).all(...params) as any[];
                const chunkMap = new Map<number, any>();
                for (const row of chunkRows) chunkMap.set(row.id, row);

                const scored: any[] = [];
                for (const vecRow of vecRows) {
                    const c = chunkMap.get(vecRow.chunk_id);
                    if (!c) continue;
                    const similarity = 1 - vecRow.distance;
                    if (similarity >= minSimilarity) {
                        scored.push({ id: c.id, meetingId: c.meeting_id, chunkIndex: c.chunk_index,
                            speaker: c.speaker, startMs: c.start_timestamp_ms, endMs: c.end_timestamp_ms,
                            text: c.cleaned_text, tokenCount: c.token_count, similarity });
                    }
                }
                parentPort!.postMessage({ type: 'result', requestId, data: scored.slice(0, limit) });
                break;
            }

            case 'nativeVecSearchSummaries': {
                const { requestId, dbPath, extPath, queryBlob, dim, providerName, limit } = message;
                const db = getDb(dbPath, extPath);
                const fetchLimit = providerName ? limit * 4 : limit;
                const vecTable = `vec_summaries_${dim}`;

                const vecRows = db.prepare(`
                    SELECT summary_id, distance FROM ${vecTable}
                    WHERE embedding MATCH ? ORDER BY distance LIMIT ?
                `).all(queryBlob, fetchLimit) as any[];

                if (vecRows.length === 0) { parentPort!.postMessage({ type: 'result', requestId, data: [] }); break; }

                const ids = vecRows.map((r: any) => r.summary_id);
                const ph = ids.map(() => '?').join(',');
                let sq = `SELECT s.* FROM chunk_summaries s JOIN meetings m ON s.meeting_id = m.id WHERE s.id IN (${ph})`;
                const params: any[] = [...ids];
                if (providerName) { sq += ' AND m.embedding_provider = ?'; params.push(providerName); }

                const summaryRows = db.prepare(sq).all(...params) as any[];
                const summaryMap = new Map<number, any>();
                for (const row of summaryRows) summaryMap.set(row.id, row);

                const results: any[] = [];
                for (const vecRow of vecRows) {
                    const s = summaryMap.get(vecRow.summary_id);
                    if (!s) continue;
                    results.push({ meetingId: s.meeting_id, summaryText: s.summary_text, similarity: 1 - vecRow.distance });
                }
                parentPort!.postMessage({ type: 'result', requestId, data: results.slice(0, limit) });
                break;
            }

            default:

                parentPort!.postMessage({
                    type: 'error',
                    requestId: (message as any).requestId,
                    error: `Unknown message type: ${(message as any).type}`
                });
        }
    } catch (error: any) {
        parentPort!.postMessage({
            type: 'error',
            requestId: (message as any).requestId,
            error: error.message
        });
    }
});
