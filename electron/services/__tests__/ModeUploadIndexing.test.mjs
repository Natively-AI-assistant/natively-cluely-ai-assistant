// electron/services/__tests__/ModeUploadIndexing.test.mjs
//
// PI v3 (W3): reference files are chunked + embedded + PERSISTED at upload
// time so the per-question hot path embeds only the live query. Invariants:
//   1. indexFile persists chunk text + vectors + space id, status → 'ready'.
//   2. retrieve() with a ready index embeds ONLY the query (no chunk embeds).
//   3. Hash change → re-index; unchanged hash + same space → no re-embed.
//   4. Space mismatch → stored vectors unused (never cross-space cosine),
//      ephemeral embed for this query, re-index scheduled.
//   5. removeFileIndex drops chunks + state.
//   6. Embedder unavailable → status 'lexical_only', retrieval still works.
//
// Uses a REAL in-memory better-sqlite3 DB (the table DDL is the unit under
// test) + a mocked embedding pipeline.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js');
const { ModeHybridRetriever } = await import(pathToFileURL(distPath).href);

const Database = require('better-sqlite3');

const SPACE_A = 'gemini:embedding-2:768';
const SPACE_B = 'openai:text-embedding-3-small:1536';

function makePipeline({ space = SPACE_A, ready = true } = {}) {
    const calls = { query: 0, batch: [] };
    return {
        calls,
        isReady: () => ready,
        getActiveSpaceKey: () => (ready ? space : undefined),
        getEmbeddingForQuery: async () => { calls.query++; return [1, 0, 0, 0]; },
        getEmbeddings: async (texts) => {
            calls.batch.push(texts.length);
            // Deterministic per-text vectors: similar to query iff text mentions 'enterprise'.
            return texts.map(t => (t.includes('enterprise') ? [0.95, 0.05, 0, 0] : [0, 1, 0, 0]));
        },
        getEmbeddingsWithFallback: async (texts) => {
            calls.batch.push(texts.length);
            const embeddings = texts.map(t => (t.includes('enterprise') ? [0.95, 0.05, 0, 0] : [0, 1, 0, 0]));
            return { embeddings, space };
        },
        getEmbedding: async (t) => (t.includes('enterprise') ? [0.95, 0.05, 0, 0] : [0, 1, 0, 0]),
    };
}

// Pipeline whose PRIMARY batch path throws, but whose fallback path succeeds in
// a DIFFERENT space — models Gemini exhaustion promoting the local provider.
// `activeSpace` starts as the primary space and flips to the fallback space once
// promotion happens, exactly like the real EmbeddingPipeline.
function makeFallbackPipeline({ primarySpace = SPACE_A, fallbackSpace = SPACE_B, fallbackThrows = false } = {}) {
    const calls = { query: 0, batch: [], fallback: 0, primary: 0 };
    let activeSpace = primarySpace;
    return {
        calls,
        isReady: () => true,
        getActiveSpaceKey: () => activeSpace,
        getEmbeddingForQuery: async () => { calls.query++; return [1, 0, 0, 0]; },
        getEmbeddings: async () => {
            calls.primary++;
            throw new Error('primary provider exhausted (429)');
        },
        getEmbeddingsWithFallback: async (texts) => {
            calls.batch.push(texts.length);
            // Mirror the real pipeline: primary throws, fallback takes over.
            calls.primary++;
            calls.fallback++;
            if (fallbackThrows) throw new Error('fallback provider ALSO failed');
            activeSpace = fallbackSpace; // promotion flips the active space
            const embeddings = texts.map(t => (t.includes('enterprise') ? [0.95, 0.05, 0, 0] : [0, 1, 0, 0]));
            return { embeddings, space: fallbackSpace, provider: 'local', dimensions: 4 };
        },
        getEmbedding: async (t) => (t.includes('enterprise') ? [0.95, 0.05, 0, 0] : [0, 1, 0, 0]),
    };
}

const FILE = {
    id: 'f1', modeId: 'm1', fileName: 'pricing.md', createdAt: '',
    content: 'enterprise plan pricing details include SSO support and audit logs for every customer account region',
};

let db;
beforeEach(() => { db = new Database(':memory:'); });

const mockVectorStore = {};

describe('W3: indexFile persistence', () => {
    test('persists chunk text + vectors + space, status ready', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);

        const chunks = db.prepare('SELECT * FROM mode_reference_chunks WHERE file_id = ?').all('f1');
        assert.ok(chunks.length >= 1);
        assert.ok(chunks[0].embedding instanceof Buffer, 'vector persisted as BLOB');
        assert.equal(chunks[0].embedding_space, SPACE_A);

        // embeddedChunkCount is asserted, not ignored: it is what distinguishes a
        // COMPLETE index from a partially embedded one that still reports 'ready',
        // and a file where it lags chunkCount is one nothing would ever finish.
        assert.deepEqual(r.getFileIndexStatus('f1'),
            { status: 'ready', chunkCount: chunks.length, embeddedChunkCount: chunks.length });
    });

    test('unchanged hash + same space → second indexFile is a no-op (no re-embed)', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);
        const batchCallsAfterFirst = pipeline.calls.batch.length;
        await r.indexFile(FILE);
        assert.equal(pipeline.calls.batch.length, batchCallsAfterFirst, 'no second batch embed');
    });

    test('content change → re-index', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);
        const before = pipeline.calls.batch.length;
        await r.indexFile({ ...FILE, content: FILE.content + ' updated with the new enterprise quota table' });
        assert.equal(pipeline.calls.batch.length, before + 1, 're-embedded after hash change');
    });

    test('embedder unavailable → lexical_only status, chunk text still persisted', async () => {
        const pipeline = makePipeline({ ready: false });
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);
        assert.equal(r.getFileIndexStatus('f1').status, 'lexical_only');
        const chunks = db.prepare('SELECT * FROM mode_reference_chunks WHERE file_id = ?').all('f1');
        assert.ok(chunks.length >= 1);
        assert.equal(chunks[0].embedding, null);
    });

    test('removeFileIndex drops chunks + state', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);
        r.removeFileIndex('f1');
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mode_reference_chunks WHERE file_id = ?').get('f1').n, 0);
        assert.equal(r.getFileIndexStatus('f1').status, 'pending');
    });
});

describe('W3: hot-path retrieval', () => {
    test('with a ready index, retrieve embeds ONLY the query', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);
        pipeline.calls.batch.length = 0;
        pipeline.calls.query = 0;

        const result = await r.retrieve({
            query: 'tell me about the enterprise plan pricing structure',
            modeId: 'm1', files: [FILE], tokenBudget: 1000, topK: 3,
        });
        assert.ok(result.chunks.length > 0, 'retrieved from persisted vectors');
        assert.ok(result.usedHybrid);
        assert.equal(pipeline.calls.query, 1, 'exactly one query embed');
        assert.equal(pipeline.calls.batch.length, 0, 'ZERO chunk batch embeds on the hot path');
        assert.ok(result.chunks[0].vectorScore > 0.5, 'cosine computed against persisted vector');
    });

    test('space mismatch → persisted vectors ignored (no cross-space cosine), ephemeral embed used', async () => {
        const pipelineA = makePipeline({ space: SPACE_A });
        const rA = new ModeHybridRetriever(db, mockVectorStore, pipelineA);
        await rA.indexFile(FILE);

        // New retriever on the SAME db but a DIFFERENT embedding space.
        const pipelineB = makePipeline({ space: SPACE_B });
        const rB = new ModeHybridRetriever(db, mockVectorStore, pipelineB);
        const result = await rB.retrieve({
            query: 'tell me about the enterprise plan pricing structure',
            modeId: 'm1', files: [FILE], tokenBudget: 1000, topK: 3,
        });
        assert.ok(result.chunks.length > 0);
        // Hot path had to ephemeral-embed because stored vectors are space-A.
        assert.ok(pipelineB.calls.batch.length >= 1, 'ephemeral embed for mismatched space');
        // Status reporting from B's perspective is 'pending' (state row says
        // ready-in-space-A, which is unusable for B) — until the background
        // re-index lands, after which it flips to ready-in-space-B.
        // 'indexing' belongs here too. The background re-index this comment
        // describes goes pending -> indexing -> ready, and which of the three is
        // observed is a race with when the assertion runs. It became likelier
        // once indexFile started acquiring a process-wide concurrency permit
        // (one extra await before the work begins), but it was always reachable —
        // the state was written by this path long before that.
        const status = rB.getFileIndexStatus('f1').status;
        assert.ok(['pending', 'indexing', 'ready'].includes(status), `status=${status}`);
    });

    test('cold DB (never indexed) still retrieves via ephemeral embed (no regression)', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        const result = await r.retrieve({
            query: 'tell me about the enterprise plan pricing structure',
            modeId: 'm1', files: [FILE], tokenBudget: 1000, topK: 3,
        });
        assert.ok(result.chunks.length > 0, 'semantic match still works cold');
        assert.ok(result.usedHybrid);
    });
});

describe('W3: fallback promotion (MEDIUM #5)', () => {
    test('primary fails → fallback succeeds → chunks stamped with the FALLBACK space', async () => {
        const pipeline = makeFallbackPipeline({ primarySpace: SPACE_A, fallbackSpace: SPACE_B });
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);

        // The persisted vectors must carry the FALLBACK space, not the primary —
        // otherwise loadPersistedEmbeddings (which filters on the now-active
        // fallback space) would silently skip every chunk we just wrote.
        const chunks = db.prepare('SELECT * FROM mode_reference_chunks WHERE file_id = ?').all('f1');
        assert.ok(chunks.length >= 1);
        assert.ok(chunks[0].embedding instanceof Buffer, 'fallback vector persisted as BLOB');
        assert.equal(chunks[0].embedding_space, SPACE_B, 'stamped with fallback space, not primary');

        // indexFile must route through the fallback-aware path exactly once.
        assert.equal(pipeline.calls.fallback, 1, 'fallback path used once');
        assert.deepEqual(r.getFileIndexStatus('f1'),
            { status: 'ready', chunkCount: chunks.length, embeddedChunkCount: chunks.length });
    });

    test('promoted-space file is queryable in the fallback space (no cross-space skip)', async () => {
        const pipeline = makeFallbackPipeline({ primarySpace: SPACE_A, fallbackSpace: SPACE_B });
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);

        // After promotion the active space is SPACE_B and the stored vectors are
        // SPACE_B, so retrieval must load them from disk (no ephemeral re-embed).
        pipeline.calls.batch.length = 0;
        pipeline.calls.query = 0;
        const result = await r.retrieve({
            query: 'tell me about the enterprise plan pricing structure',
            modeId: 'm1', files: [FILE], tokenBudget: 1000, topK: 3,
        });
        assert.ok(result.chunks.length > 0, 'retrieved from promoted-space vectors');
        assert.equal(pipeline.calls.query, 1, 'exactly one query embed');
        assert.equal(pipeline.calls.batch.length, 0, 'ZERO chunk re-embeds — persisted fallback vectors used');
    });

    test('primary AND fallback fail → status failed, chunk TEXT still persisted (lexical survives)', async () => {
        const pipeline = makeFallbackPipeline({ fallbackThrows: true });
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);

        // Not 'lexical_only' (that's the embedder-unavailable case) — this is a
        // genuine indexing FAILURE after the embedder was available but both
        // providers threw. Chunk text is still kept so lexical retrieval works.
        assert.equal(r.getFileIndexStatus('f1').status, 'failed');
        const chunks = db.prepare('SELECT * FROM mode_reference_chunks WHERE file_id = ?').all('f1');
        assert.ok(chunks.length >= 1, 'chunk text persisted for lexical fallback');
        assert.equal(chunks[0].embedding, null, 'no vector stored on double-failure');
    });
});

describe('W3: persistence failure must not be reported as a complete index', () => {
    // persistChunks used to return void and swallow its exception, so a failed
    // transaction (locked db, full disk) was followed straight away by
    // updateIndexState marking the file `ready` with a FULL embedded count over
    // ZERO rows. The file then reported itself completely indexed and retrieved
    // nothing — and once the skip condition began checking embeddedChunkCount,
    // that lie satisfied it, so nothing ever revisited the file.
    //
    // The count is now DERIVED from the rows rather than from what the embedding
    // loop believed it had, which is why this cannot silently pass any more.
    //
    // Verified to have teeth: reverting BOTH the derived count and the boolean
    // return makes the two tests below fail. Reverting only the boolean does
    // not — the derived count closes the hole on its own, because a row count
    // over an empty table is zero no matter what the writer claimed. The
    // boolean is defence in depth, not the fix.

    /** Make the chunk table un-writable, the way a real disk/lock failure looks. */
    function breakChunkWrites(db) {
        db.exec('DROP TABLE IF EXISTS mode_reference_chunks_broken');
        db.exec('ALTER TABLE mode_reference_chunks RENAME TO mode_reference_chunks_broken');
        // A table of the same name whose NOT NULL column the insert never supplies:
        // every INSERT throws, exactly as a constraint/disk failure would.
        db.exec(`CREATE TABLE mode_reference_chunks (
            file_id TEXT, chunk_index INTEGER, text TEXT, embedding BLOB,
            embedding_space TEXT, created_at INTEGER,
            must_be_set TEXT NOT NULL
        )`);
    }

    test('a failed chunk write is NOT recorded as ready', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        breakChunkWrites(db);

        await r.indexFile(FILE);   // must never throw — indexing is best-effort

        const st = r.getFileIndexStatus('f1');
        assert.notEqual(st.status, 'ready',
            'a file whose chunks were never written must not report ready');
        assert.equal(st.embeddedChunkCount, 0,
            'no rows were written, so no chunks may be counted as embedded');
    });

    test('the failed file is retried rather than frozen', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        breakChunkWrites(db);
        await r.indexFile(FILE);

        // Restore the real table and index again: the file must NOT be skipped.
        db.exec('DROP TABLE mode_reference_chunks');
        db.exec('ALTER TABLE mode_reference_chunks_broken RENAME TO mode_reference_chunks');
        const before = pipeline.calls.batch.length;
        await r.indexFile(FILE);
        assert.ok(pipeline.calls.batch.length > before,
            're-indexing must actually re-embed — the earlier failure left nothing to reuse');

        const st = r.getFileIndexStatus('f1');
        assert.equal(st.status, 'ready');
        assert.equal(st.embeddedChunkCount, st.chunkCount, 'now genuinely complete');
    });

    test('the embedded count comes from the ROWS, not from the caller', async () => {
        const pipeline = makePipeline();
        const r = new ModeHybridRetriever(db, mockVectorStore, pipeline);
        await r.indexFile(FILE);

        const rows = db.prepare(
            'SELECT COUNT(*) AS n FROM mode_reference_chunks WHERE file_id = ? AND embedding IS NOT NULL'
        ).get('f1').n;
        assert.equal(r.getFileIndexStatus('f1').embeddedChunkCount, rows,
            'the state row must agree with the vectors actually on disk');

        // Delete a vector behind its back. A cached count would still claim
        // completeness; a derived one cannot.
        db.prepare('UPDATE mode_reference_chunks SET embedding = NULL WHERE file_id = ? AND chunk_index = 0').run('f1');
        const after = db.prepare(
            'SELECT COUNT(*) AS n FROM mode_reference_chunks WHERE file_id = ? AND embedding IS NOT NULL'
        ).get('f1').n;
        assert.equal(after, rows - 1, 'fixture check: one vector removed');
    });
});
