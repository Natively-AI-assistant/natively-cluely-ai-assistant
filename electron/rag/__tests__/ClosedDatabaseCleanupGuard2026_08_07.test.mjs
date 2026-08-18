// Regression test: RAG cleanup boundaries must not call prepare() on a closed
// database handle.
//
// THE DEFECT (reproduced against a real DB + real Gemini embeddings before the
// fix): VectorStore and RAGManager are handed a RAW better-sqlite3 handle in
// their constructors (`this.db = config.db`) and keep their own reference to
// it. When the fatal path runs emergencyCloseDatabase() ->
// closeWithoutCheckpoint(), the DatabaseManager singleton nulls ITS handle, but
// these copies are left pointing at a closed connection. Every
// `this.db.prepare(...)` then throws straight out of the driver:
//
//     TypeError: The database connection is not open
//
// Measured post-close, before the fix:
//     clearEmbeddingsForMeeting: THREW -> The database connection is not open
//     deleteChunksForMeeting:    THREW -> The database connection is not open
//
// Production callers do catch it (the background-teardown try/catch in
// endMeetingTransition, and processQueue()'s .catch), so this was never a
// crash. The cost is that a raw driver error escapes an internal abstraction:
// the caller cannot distinguish "the database is gone, which is EXPECTED during
// shutdown" from "cleanup is genuinely broken", and the throw skips whatever
// teardown steps followed it.
//
// The contract: at a cleanup boundary an unavailable database is a controlled,
// logged no-op — not an exception. Defense in depth for the shutdown window
// ONLY; nothing here reopens the database.
//
// ISOLATION: this test owns its own better-sqlite3 connection and never touches
// the DatabaseManager singleton. An earlier draft closed the shared singleton,
// which poisoned every RAG test file that ran after it in the same process
// (8 files failed to load). Closing shared state from a test is never worth it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = Module.createRequire(path.join(repoRoot, 'package.json'));

// better-sqlite3 is built against Electron's ABI (NODE_MODULE_VERSION 148), so
// it cannot load under plain `node --test` (141). Every real-SQLite test in
// this directory has the same constraint; the difference is that they hard-fail
// and add noise to an already-red suite. Skip cleanly instead, and run for real
// under:
//     ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>
// (which is what `npm run test:electron` and the RAG suite use).
// NOTE: require() alone does NOT surface the mismatch — better-sqlite3 loads
// its native binding lazily, so the ABI error is thrown by `new Database(...)`.
// The probe therefore has to actually open a connection.
let Database = null;
let skipReason = null;
try {
    Database = require('better-sqlite3');
    new Database(':memory:').close();
} catch (err) {
    skipReason = /NODE_MODULE_VERSION/.test(String(err?.message))
        ? 'better-sqlite3 is built for the Electron ABI — run under ELECTRON_RUN_AS_NODE'
        : `better-sqlite3 unavailable: ${err?.message}`;
}

// node:test treats the PRESENCE of a `skip` key as a skip, even when its value
// is null — so only include it when we actually mean to skip.
const opts = skipReason ? { skip: skipReason } : {};

const { VectorStore } = await import(
    path.join(repoRoot, 'dist-electron/electron/rag/VectorStore.js'));

const MEETING = 'rag-guard-meeting';

/** A private database with just the tables the cleanup boundaries touch. */
function makeIsolatedDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-ragguard-'));
    const db = new Database(path.join(dir, 'natively.db'));
    db.exec(`
        CREATE TABLE meetings (
            id TEXT PRIMARY KEY, title TEXT, start_time INTEGER, duration_ms INTEGER,
            created_at TEXT, embedding_provider TEXT, embedding_dimensions INTEGER,
            embedding_space TEXT
        );
        CREATE TABLE chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL, speaker TEXT,
            start_timestamp_ms INTEGER, end_timestamp_ms INTEGER,
            cleaned_text TEXT NOT NULL, token_count INTEGER NOT NULL,
            embedding BLOB, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE chunk_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT NOT NULL UNIQUE,
            summary_text TEXT, embedding BLOB
        );
    `);
    db.prepare('INSERT INTO meetings (id,title,start_time,duration_ms,created_at) VALUES (?,?,?,?,?)')
        .run(MEETING, 'RAG guard probe', Date.now(), 1000, String(Date.now()));
    // A 768-dim vector, the shape gemini-embedding-001 returns.
    const blob = Buffer.from(new Float32Array(768).fill(0.01).buffer);
    db.prepare(
        `INSERT INTO chunks (meeting_id, chunk_index, cleaned_text, token_count, embedding,
                             start_timestamp_ms, end_timestamp_ms)
         VALUES (?,?,?,?,?,?,?)`
    ).run(MEETING, 0, 'quarterly revenue target', 4, blob, 0, 1000);
    return { db, dir };
}

test('sanity: the cleanup boundaries do their job while the database is OPEN', opts, () => {
    const { db, dir } = makeIsolatedDb();
    const store = new VectorStore(db, path.join(dir, 'natively.db'), '');

    const embeddedBefore = db.prepare(
        'SELECT COUNT(*) c FROM chunks WHERE meeting_id = ? AND embedding IS NOT NULL').get(MEETING).c;
    store.clearEmbeddingsForMeeting(MEETING);
    const embeddedAfter = db.prepare(
        'SELECT COUNT(*) c FROM chunks WHERE meeting_id = ? AND embedding IS NOT NULL').get(MEETING).c;

    assert.equal(embeddedBefore, 1, 'setup must leave one embedded chunk');
    assert.equal(embeddedAfter, 0, 'the guard must not stop real cleanup on an open database');

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

test('cleanup boundaries are a controlled no-op once the database is closed', opts, () => {
    const { db, dir } = makeIsolatedDb();
    const store = new VectorStore(db, path.join(dir, 'natively.db'), '');

    // Exactly the state emergencyCloseDatabase() leaves behind: the handle the
    // VectorStore is holding has been closed out from under it.
    db.close();
    assert.equal(db.open, false, 'the raw handle VectorStore still holds is closed');

    assert.doesNotThrow(
        () => store.clearEmbeddingsForMeeting(MEETING),
        'clearEmbeddingsForMeeting must not throw a raw SqliteError once the ' +
        'database is closed — it must detect the unavailable handle and return.'
    );
    assert.doesNotThrow(
        () => store.deleteChunksForMeeting(MEETING),
        'deleteChunksForMeeting must not throw a raw SqliteError once the ' +
        'database is closed — it must detect the unavailable handle and return.'
    );

    fs.rmSync(dir, { recursive: true, force: true });
});

test('the guard keys off availability, so real errors on an OPEN database still surface', opts, () => {
    // If this were a blanket try/catch instead of an availability check, it
    // would mask genuine cleanup bugs during normal operation.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-ragguard-bare-'));
    const db = new Database(path.join(dir, 'bare.db'));   // deliberately no schema
    const store = new VectorStore(db, path.join(dir, 'bare.db'), '');

    assert.equal(db.open, true, 'this handle IS open');
    assert.throws(
        () => store.clearEmbeddingsForMeeting('nope'),
        /no such table/i,
        'on an OPEN database a genuine schema error must still surface'
    );

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RAGManager.deleteMeetingData is guarded at the boundary too', opts, async () => {
    // RAGManager holds its own raw handle and is the entry point the meeting
    // teardown block actually calls (main.ts: ragManager.deleteMeetingData).
    const { RAGManager } = await import(path.join(repoRoot, 'dist-electron/electron/rag/RAGManager.js'));
    const { db, dir } = makeIsolatedDb();

    const mgr = new RAGManager({ db, dbPath: path.join(dir, 'natively.db'), extPath: '' });
    db.close();

    assert.doesNotThrow(
        () => mgr.deleteMeetingData(MEETING),
        'deleteMeetingData must return a controlled result when the database is closed'
    );

    fs.rmSync(dir, { recursive: true, force: true });
});
