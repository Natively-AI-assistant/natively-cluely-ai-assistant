// Ask about a folder (2026-10-15): a global question asked while a folder is
// open searches only that folder's meetings, chunks and summaries alike. The
// scoped search reads the stored vectors (not a global vec0 top-k filtered
// afterwards, which would miss a folder's matches ranked below other meetings').
//
// Real SQLite on a scratch file; the embedder is a stub. No platform branches.
// Run under `ELECTRON_RUN_AS_NODE=1 electron --test` (native ABI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = Module.createRequire(path.join(repoRoot, 'package.json'));

let Database = null;
let skipReason = null;
try {
    Database = require('better-sqlite3');
    new Database(':memory:').close();
} catch (err) {
    skipReason = `better-sqlite3 unavailable here: ${err?.message}`;
}
const opts = skipReason ? { skip: skipReason } : {};

const { VectorStore } = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/rag/VectorStore.js')).href);
const { RAGRetriever } = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/rag/RAGRetriever.js')).href);

const DIM = 8;
const SPACE = 'stub:model:8';
const vec = (lead) => { const v = new Float32Array(DIM).fill(0.05); v[0] = lead; return v; };

function makeDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-folder-scope-'));
    const db = new Database(path.join(dir, 'natively.db'));
    db.exec(`
        CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, start_time INTEGER, duration_ms INTEGER, created_at TEXT,
            embedding_provider TEXT, embedding_dimensions INTEGER, embedding_space TEXT);
        CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, speaker TEXT,
            start_timestamp_ms INTEGER, end_timestamp_ms INTEGER, cleaned_text TEXT NOT NULL, token_count INTEGER NOT NULL,
            embedding BLOB, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT NOT NULL UNIQUE, summary_text TEXT, embedding BLOB);
    `);
    // Meeting A matches the question best; B (the folder's) less well, but still matches.
    for (const [id, lead] of [['A', 1.0], ['B', 0.8], ['C', 0.7]]) {
        db.prepare('INSERT INTO meetings (id, title, start_time, duration_ms, created_at, embedding_space) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, `Meeting ${id}`, Date.now(), 1000, new Date().toISOString(), SPACE);
        db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, cleaned_text, token_count, embedding, start_timestamp_ms, end_timestamp_ms)
            VALUES (?, 0, ?, 5, ?, 0, 1000)`).run(id, `pricing talk in ${id}`, Buffer.from(vec(lead).buffer));
        db.prepare('INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES (?, ?, ?)')
            .run(id, `summary of ${id}`, Buffer.from(vec(lead).buffer));
    }
    return { db, dir };
}

test('chunks and summaries: only the folder\'s meetings when scoped, all of them otherwise', opts, async () => {
    const { db, dir } = makeDb();
    try {
        const store = new VectorStore(db, path.join(dir, 'natively.db'), '');
        const q = Array.from(vec(1.0));
        const all = await store.searchSimilar(q, { spaceKey: SPACE, limit: 8, minSimilarity: 0 });
        assert.deepEqual(all.map((c) => c.meetingId).sort(), ['A', 'B', 'C']);
        const scoped = await store.searchSimilar(q, { spaceKey: SPACE, limit: 8, minSimilarity: 0, meetingIds: ['B'] });
        assert.deepEqual(scoped.map((c) => c.meetingId), ['B']);
        assert.deepEqual(await store.searchSimilar(q, { spaceKey: SPACE, limit: 8, minSimilarity: 0, meetingIds: [] }), [], 'an empty folder finds nothing');

        const sums = await store.searchSummaries(q, 5, SPACE, ['B', 'C']);
        assert.deepEqual(sums.map((s) => s.meetingId).sort(), ['B', 'C']);
        assert.deepEqual(await store.searchSummaries(q, 5, SPACE, []), []);
        assert.equal((await store.searchSummaries(q, 5, SPACE)).length, 3, 'unscoped is unchanged');
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('retrieveGlobal passes the folder through: the context names only its meetings', opts, async () => {
    const { db, dir } = makeDb();
    try {
        const store = new VectorStore(db, path.join(dir, 'natively.db'), '');
        const pipeline = { getEmbeddingForQuery: async () => Array.from(vec(1.0)), getActiveSpaceKey: () => SPACE };
        const retriever = new RAGRetriever(store, pipeline);
        const scoped = await retriever.retrieveGlobal('what about pricing?', { meetingIds: ['C'] });
        assert.deepEqual(scoped.meetingIds, ['C']);
        assert.doesNotMatch(scoped.formattedContext, /Meeting A|Meeting B/);
        const all = await retriever.retrieveGlobal('what about pricing?');
        assert.ok(all.meetingIds.length >= 2, 'unscoped still searches everything');
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
