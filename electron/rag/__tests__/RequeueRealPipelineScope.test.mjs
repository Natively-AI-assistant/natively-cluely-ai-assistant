// electron/rag/__tests__/RequeueRealPipelineScope.test.mjs
//
// HIGH — drives the REAL compiled EmbeddingPipeline.requeueMeetingForReindex against a
// REAL compiled VectorStore (in-memory SQLite, no vec table → pure-SQL path). The
// existing RequeueReindexAtomicity test REPLICATES the transaction body; this one calls
// the genuine method so the production code path (incl. the post-commit processQueue()
// fire — a no-op here because no provider is initialized) is exercised.
//
// New scope coverage the prior suite lacked:
//   - requeue a meeting with ONLY a summary (no chunks) — must still enqueue the summary row
//   - requeue when the queue already holds stale rows for OTHER meetings — must NOT touch them
//   - DELETE scope is strictly per-meeting (no cross-contamination)
//   - re-requeue is idempotent: no duplicate summary rows accumulate
//
// Run under Electron ABI:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vsPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/VectorStore.js');
const epPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/EmbeddingPipeline.js');
const { VectorStore } = await import(pathToFileURL(vsPath).href);
const { EmbeddingPipeline } = await import(pathToFileURL(epPath).href);

const SPACE_V1 = 'gemini:gemini-embedding-001:768';

function makeSchema(db) {
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      embedding_provider TEXT,
      embedding_dimensions INTEGER,
      embedding_space TEXT
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      cleaned_text TEXT,
      embedding BLOB
    );
    CREATE TABLE chunk_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      summary_text TEXT,
      embedding BLOB
    );
    CREATE TABLE embedding_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      chunk_id INTEGER,
      status TEXT,
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      UNIQUE(meeting_id, chunk_id)
    );
  `);
}

describe('EmbeddingPipeline.requeueMeetingForReindex — real method, scope + idempotency', () => {
  let db, vectorStore, pipeline;

  beforeEach(() => {
    db = new Database(':memory:');
    makeSchema(db);
    vectorStore = new VectorStore(db, ':memory:', '/nonexistent-ext');
    // Real EmbeddingPipeline; no initialize() → provider stays null → the post-commit
    // processQueue() fire-and-forget is a safe no-op (verified: it early-returns on no provider).
    pipeline = new EmbeddingPipeline(db, vectorStore);
  });

  afterEach(() => db.close());

  test('summary-only meeting (no chunks) still enqueues the summary row + clears its space', async () => {
    const blob = Buffer.alloc(768 * 4);
    db.prepare("INSERT INTO meetings (id, embedding_provider, embedding_dimensions, embedding_space) VALUES ('sONLY','gemini',768,?)").run(SPACE_V1);
    db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('sONLY','summary text', ?)").run(blob);

    await pipeline.requeueMeetingForReindex('sONLY');

    const chunkRows = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='sONLY' AND chunk_id IS NOT NULL").get();
    const summaryRows = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='sONLY' AND chunk_id IS NULL").get();
    assert.equal(chunkRows.c, 0, 'no chunk rows (meeting has none)');
    assert.equal(summaryRows.c, 1, 'exactly one summary row queued');
    const space = db.prepare("SELECT embedding_space FROM meetings WHERE id='sONLY'").get().embedding_space;
    assert.equal(space, null, 'space cleared so the meeting is excluded from search until re-embedded');
  });

  test('DELETE scope is per-meeting: requeueing m1 must NOT touch stale queue rows for m2', async () => {
    const blob = Buffer.alloc(768 * 4);
    // Two meetings, each with chunks + summary, both in v1 space.
    for (const m of ['m1', 'm2']) {
      db.prepare("INSERT INTO meetings (id, embedding_provider, embedding_dimensions, embedding_space) VALUES (?,'gemini',768,?)").run(m, SPACE_V1);
      for (let i = 0; i < 2; i++) db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES (?, ?, ?)").run(m, `c${i}`, blob);
      db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES (?, 'sum', ?)").run(m, blob);
    }
    // Pre-existing stale queue rows for BOTH meetings (e.g. a previous partial run).
    const ins = db.prepare("INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES (?, ?, 'pending')");
    ins.run('m2', 999);  // a chunk row for m2 unrelated to current chunk ids
    ins.run('m2', null); // a summary row for m2

    const m2Before = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='m2'").get().c;

    await pipeline.requeueMeetingForReindex('m1');

    // m1's queue rebuilt; m2's pre-existing rows untouched in count.
    const m2After = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='m2'").get().c;
    assert.equal(m2After, m2Before, 'm2 queue rows must be untouched by an m1 requeue');
    // m2's embeddings + space must also be untouched (only m1 cleared).
    const m2Space = db.prepare("SELECT embedding_space FROM meetings WHERE id='m2'").get().embedding_space;
    assert.equal(m2Space, SPACE_V1, 'm2 space untouched');
    const m2Emb = db.prepare("SELECT COUNT(*) c FROM chunks WHERE meeting_id='m2' AND embedding IS NOT NULL").get().c;
    assert.equal(m2Emb, 2, 'm2 chunk embeddings untouched');
    // m1 cleared + queued (2 chunks + 1 summary).
    const m1Queue = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='m1'").get().c;
    assert.equal(m1Queue, 3, 'm1 queued: 2 chunks + 1 summary');
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='m1'").get().embedding_space, null);
  });

  test('re-requeue is idempotent — no duplicate summary rows accumulate', async () => {
    const blob = Buffer.alloc(768 * 4);
    db.prepare("INSERT INTO meetings (id, embedding_provider, embedding_dimensions, embedding_space) VALUES ('m1','gemini',768,?)").run(SPACE_V1);
    for (let i = 0; i < 2; i++) db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('m1', ?, ?)").run(`c${i}`, blob);
    db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('m1','sum', ?)").run(blob);

    await pipeline.requeueMeetingForReindex('m1');
    await pipeline.requeueMeetingForReindex('m1');
    await pipeline.requeueMeetingForReindex('m1');

    const summaryRows = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='m1' AND chunk_id IS NULL").get().c;
    const chunkRows = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='m1' AND chunk_id IS NOT NULL").get().c;
    assert.equal(summaryRows, 1, 'exactly one summary row after 3 requeues (no NULL-dedup leak)');
    assert.equal(chunkRows, 2, 'exactly two chunk rows after 3 requeues');
  });

  test('requeue resets a previously-completed queue row back to pending (re-embeds from scratch)', async () => {
    const blob = Buffer.alloc(768 * 4);
    db.prepare("INSERT INTO meetings (id, embedding_provider, embedding_dimensions, embedding_space) VALUES ('m1','gemini',768,?)").run(SPACE_V1);
    const chunkId = db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('m1','c0', ?)").run(blob).lastInsertRowid;
    // A stale 'completed' row from the prior (incompatible-space) embed.
    db.prepare("INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('m1', ?, 'completed')").run(chunkId);

    await pipeline.requeueMeetingForReindex('m1');

    const row = db.prepare("SELECT status FROM embedding_queue WHERE meeting_id='m1' AND chunk_id = ?").get(chunkId);
    assert.equal(row.status, 'pending', 'completed row replaced with a fresh pending row');
    const total = db.prepare("SELECT COUNT(*) c FROM embedding_queue WHERE meeting_id='m1'").get().c;
    assert.equal(total, 2, 'one chunk + one summary, no duplicate');
  });
});
