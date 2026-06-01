// electron/rag/__tests__/CrossFeatureReindexConcurrency.test.mjs
//
// CROSS-FEATURE CONCURRENCY — the meetings RAG auto-reindex (RAGManager._runReindex +
// EmbeddingPipeline.processQueue) and the premium knowledge re-embed (KnowledgeOrchestrator.
// ensureEmbeddingSpace) run as independent background jobs and, in production, can overlap
// at startup (main.ts awaits the pipeline, then kicks knowledge ensureEmbeddingSpace while
// the deferred meetings auto-reindex fires ~15s later). They touch DISJOINT tables
// (meetings/chunks/chunk_summaries/embedding_queue vs context_nodes) but share ONE SQLite
// connection (better-sqlite3 is synchronous + serialized per statement, so interleaving is
// at await boundaries).
//
// No existing test runs both subsystems concurrently against the same DB. This proves:
//   - Both converge: meetings end up stamped in the active space; knowledge nodes end up
//     in the active space.
//   - Neither corrupts the other's tables (row counts + spaces of the OTHER feature are
//     exactly as expected after both jobs finish).
//   - The meetings worklist/queue and the knowledge worklist are computed independently and
//     don't leak across the JOIN-less table boundary.
//
// Uses the REAL compiled VectorStore + EmbeddingPipeline + RAGManager + KnowledgeOrchestrator
// + KnowledgeDatabaseManager on a single in-memory SQLite DB. Embedders are stubbed
// (deterministic, instant) so the test is fast and the convergence is observable.
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
const rmPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/RAGManager.js');
const koPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');
const kdbPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js');
const esPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingSpace.js');

const { VectorStore } = await import(pathToFileURL(vsPath).href);
const { EmbeddingPipeline } = await import(pathToFileURL(epPath).href);
const { RAGManager } = await import(pathToFileURL(rmPath).href);
const { KnowledgeOrchestrator } = await import(pathToFileURL(koPath).href);
const { KnowledgeDatabaseManager } = await import(pathToFileURL(kdbPath).href);
const { embeddingSpaceKey } = await import(pathToFileURL(esPath).href);

const SPACE_V1 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 768 });
const SPACE_V2 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 768 });

function vec(fill) { return new Array(768).fill(fill); }
function blob(fill = 0.1) {
  const b = Buffer.alloc(768 * 4);
  for (let i = 0; i < 768; i++) b.writeFloatLE(fill, i * 4);
  return b;
}

function makeMeetingsSchema(db) {
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP, is_processed INTEGER DEFAULT 1,
      embedding_provider TEXT, embedding_dimensions INTEGER, embedding_space TEXT
    );
    CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, cleaned_text TEXT, embedding BLOB);
    CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, summary_text TEXT, embedding BLOB);
    CREATE TABLE embedding_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, chunk_id INTEGER, status TEXT,
      retry_count INTEGER DEFAULT 0, error_message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT, UNIQUE(meeting_id, chunk_id)
    );
  `);
}

// A real EmbeddingPipeline with a stubbed v2 provider injected (skip initialize()/network).
function makePipeline(db, vectorStore) {
  const pipeline = new EmbeddingPipeline(db, vectorStore);
  const provider = {
    name: 'gemini', model: 'gemini-embedding-2', dimensions: 768, space: SPACE_V2,
    embed: async () => vec(0.5),
    embedQuery: async () => vec(0.5),
    embedBatch: async (texts) => texts.map(() => vec(0.5)),
    isAvailable: async () => true,
  };
  pipeline.provider = provider;
  pipeline.fallbackProvider = provider;
  return pipeline;
}

function makeRagManager(db, vectorStore, pipeline) {
  const mgr = Object.create(RAGManager.prototype);
  mgr._reindexInFlight = false;
  mgr._autoReindexTimer = null;
  mgr.db = db;
  mgr.vectorStore = vectorStore;
  mgr.embeddingPipeline = pipeline;
  mgr.liveIndexer = { isRunning: () => false };
  mgr._emitReindex = () => {};
  return mgr;
}

function makeKnowledge(db, { embedFn, activeSpaceFn }) {
  const orch = Object.create(KnowledgeOrchestrator.prototype);
  orch.db = new KnowledgeDatabaseManager(db);
  orch.db.initializeSchema(); // creates context_nodes (disjoint from meetings tables)
  orch.cachedNodes = [];
  orch._reembedInFlight = false;
  orch.activeResume = null;
  orch.activeJD = null;
  orch._processedResumeCache = null;
  orch.embedFn = embedFn;
  orch.activeSpaceFn = activeSpaceFn;
  return orch;
}

describe('cross-feature: meetings reindex + knowledge re-embed concurrently (one DB)', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); makeMeetingsSchema(db); });
  afterEach(() => { try { db.close(); } catch { /* */ } });

  test('both jobs run concurrently and converge without corrupting each other', async () => {
    // ── Seed meetings in the OLD space (v1) — eligible for reindex into active v2.
    const meetingIds = ['mtgA', 'mtgB', 'mtgC'];
    for (const id of meetingIds) {
      db.prepare("INSERT INTO meetings (id, embedding_provider, embedding_dimensions, embedding_space) VALUES (?,'gemini',768,?)").run(id, SPACE_V1);
      for (let i = 0; i < 3; i++) db.prepare('INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES (?,?,?)').run(id, `chunk ${i}`, blob());
      db.prepare('INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES (?,?,?)').run(id, 'summary', blob());
    }

    const vectorStore = new VectorStore(db, ':memory:', '/nonexistent-ext');
    const pipeline = makePipeline(db, vectorStore);
    const rag = makeRagManager(db, vectorStore, pipeline);

    // ── Seed knowledge nodes in the OLD space (v1) — eligible for re-embed into active v2.
    const knowledge = makeKnowledge(db, { embedFn: async () => vec(0.9), activeSpaceFn: () => SPACE_V2 });
    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space)
         VALUES ('RESUME','experience',?,?,'[]',?,?)`
      ).run(`node${i}`, `text ${i}`, blob(), SPACE_V1);
    }
    knowledge.cachedNodes = knowledge.db.getAllNodes();

    // Pre-conditions: both populations are incompatible with active v2.
    assert.equal(vectorStore.getIncompatibleSpaceCount(SPACE_V2), 3, 'all 3 meetings need reindex');
    assert.equal(knowledge.db.getNodesNeedingReembed(SPACE_V2).length, 5, 'all 5 nodes need re-embed');

    // ── Fire BOTH jobs concurrently. _runReindex clears+requeues meetings then drains the
    // queue (processQueue runs synchronously between awaits); ensureEmbeddingSpace re-embeds
    // nodes. They interleave at await points but write disjoint tables.
    await Promise.all([
      rag._runReindex(),
      knowledge.ensureEmbeddingSpace(),
    ]);

    // ── KNOWLEDGE converged AND meetings tables untouched by it.
    assert.equal(knowledge.db.getNodesNeedingReembed(SPACE_V2).length, 0, 'knowledge nodes converged to v2');
    assert.equal(knowledge.db.getAllNodes().length, 5, 'no knowledge nodes lost/duplicated');
    assert.ok(knowledge.db.getAllNodes().every(n => n.embedding_space === SPACE_V2), 'every node stamped active v2');

    // ── MEETINGS converged AND knowledge table untouched by it.
    // After requeue+drain, every meeting's chunks/summary are re-embedded and the meeting is
    // stamped v2 (stampMeetingSpaceIfUnset / embedChunk metadata write).
    const stillPending = pipeline.getQueueStatus().pending;
    assert.equal(stillPending, 0, 'embedding queue fully drained');
    for (const id of meetingIds) {
      const space = db.prepare('SELECT embedding_space FROM meetings WHERE id=?').get(id).embedding_space;
      assert.equal(space, SPACE_V2, `meeting ${id} re-stamped to active v2`);
      const embedded = db.prepare('SELECT COUNT(*) c FROM chunks WHERE meeting_id=? AND embedding IS NOT NULL').get(id).c;
      assert.equal(embedded, 3, `meeting ${id} chunks re-embedded`);
    }
    // The meetings reindex must NOT have touched context_nodes (no shared rows, no JOIN leak).
    assert.equal(db.prepare('SELECT COUNT(*) c FROM context_nodes').get().c, 5, 'context_nodes row count untouched by meetings reindex');

    // Final coherence: nothing left incompatible for either feature.
    assert.equal(vectorStore.getIncompatibleSpaceCount(SPACE_V2), 0, 'no meetings remain incompatible');
    assert.equal(knowledge.db.getNodesNeedingReembed(SPACE_V2).length, 0, 'no knowledge nodes remain incompatible');

    await vectorStore.destroy();
  });

  test('knowledge re-embed failing does NOT stall or corrupt the meetings reindex (independence)', async () => {
    // Knowledge embedder is down; meetings embedder is fine. Meetings must still converge.
    const meetingIds = ['m1', 'm2'];
    for (const id of meetingIds) {
      db.prepare("INSERT INTO meetings (id, embedding_provider, embedding_dimensions, embedding_space) VALUES (?,'gemini',768,?)").run(id, SPACE_V1);
      for (let i = 0; i < 2; i++) db.prepare('INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES (?,?,?)').run(id, `c${i}`, blob());
      db.prepare('INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES (?,?,?)').run(id, 's', blob());
    }
    const vectorStore = new VectorStore(db, ':memory:', '/nonexistent-ext');
    const pipeline = makePipeline(db, vectorStore);
    const rag = makeRagManager(db, vectorStore, pipeline);

    const knowledge = makeKnowledge(db, { embedFn: async () => { throw new Error('knowledge embedder down'); }, activeSpaceFn: () => SPACE_V2 });
    for (let i = 0; i < 3; i++) {
      db.prepare(
        `INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space)
         VALUES ('RESUME','experience',?,?,'[]',?,?)`
      ).run(`n${i}`, `t${i}`, blob(), SPACE_V1);
    }
    knowledge.cachedNodes = knowledge.db.getAllNodes();

    await Promise.all([
      rag._runReindex(),
      knowledge.ensureEmbeddingSpace(), // will fail-fast (passProgress=0) but must not throw out
    ]);

    // Meetings converged despite knowledge failure.
    assert.equal(pipeline.getQueueStatus().pending, 0, 'meetings queue drained');
    assert.equal(vectorStore.getIncompatibleSpaceCount(SPACE_V2), 0, 'meetings fully reindexed');
    // Knowledge stayed stale (self-heal next refresh) — not corrupted, not lost.
    assert.equal(knowledge.db.getNodesNeedingReembed(SPACE_V2).length, 3, 'failed knowledge nodes remain stale (intact)');
    assert.equal(knowledge.db.getAllNodes().length, 3, 'no knowledge nodes lost on failure');

    await vectorStore.destroy();
  });
});
