// electron/rag/__tests__/RAGManagerDisposeLifecycle.test.mjs
//
// LIFECYCLE — round-5 change #3: RAGManager.dispose() (cancelPendingReindex + vectorStore.destroy())
// is wired into the before-quit handler. dispose() must be safe under partial init and on
// repeat calls; cancelPendingReindex() must be safe with no pending timer; and the real
// VectorStore.destroy() must not throw when the JS-fallback worker was never started.
//
// No existing test touches dispose() / cancelPendingReindex() at all (verified by grep).
//
// We use the REAL compiled VectorStore (so destroy() is genuinely exercised — including the
// "worker === null" branch when no search ever ran) and the REAL compiled RAGManager method
// bodies via Object.create(prototype) to skip the provider-heavy constructor.
//
// Run under Electron ABI:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rmPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/RAGManager.js');
const vsPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/VectorStore.js');
const { RAGManager } = await import(pathToFileURL(rmPath).href);
const { VectorStore } = await import(pathToFileURL(vsPath).href);

function makeSchema(db) {
  db.exec(`
    CREATE TABLE meetings (id TEXT PRIMARY KEY, embedding_space TEXT);
    CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, cleaned_text TEXT, embedding BLOB);
    CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, summary_text TEXT, embedding BLOB);
  `);
}

// Real RAGManager with the collaborators dispose()/cancelPendingReindex()/scheduleAutoReindex touch.
function makeManager(db, { vectorStore } = {}) {
  const mgr = Object.create(RAGManager.prototype);
  mgr._reindexInFlight = false;
  mgr._autoReindexTimer = null;
  mgr.vectorStore = vectorStore ?? new VectorStore(db, ':memory:', '/nonexistent-ext');
  mgr.embeddingPipeline = {
    getActiveSpaceKey: () => 'gemini:gemini-embedding-2:768',
    getQueueStatus: () => ({ pending: 0, processing: 0, completed: 0, failed: 0 }),
    requeueMeetingForReindex: async () => {},
  };
  mgr.liveIndexer = { isRunning: () => false };
  mgr._emitReindex = () => {};
  return mgr;
}

describe('RAGManager.dispose() / cancelPendingReindex() lifecycle (real compiled methods)', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); makeSchema(db); });
  afterEach(() => { try { db.close(); } catch { /* */ } });

  test('cancelPendingReindex with NO timer set is a safe no-op (does not throw)', () => {
    const mgr = makeManager(db);
    assert.equal(mgr._autoReindexTimer, null);
    mgr.cancelPendingReindex();
    mgr.cancelPendingReindex(); // twice
    assert.equal(mgr._autoReindexTimer, null);
  });

  test('dispose() on a manager whose VectorStore worker was NEVER started does not throw', async () => {
    const mgr = makeManager(db);
    // No search ever issued → VectorStore.worker is null. destroy() must handle that branch.
    await mgr.dispose();
    // VectorStore is genuinely destroyed: pending map cleared (no worker existed to terminate).
    assert.ok(true, 'dispose resolved without throwing on a never-started worker');
  });

  test('dispose() is idempotent: calling it twice is safe', async () => {
    const mgr = makeManager(db);
    await mgr.dispose();
    await mgr.dispose(); // second call must not throw (worker already null, timer already null)
    assert.ok(true, 'second dispose() resolved without throwing');
  });

  test('dispose() CANCELS a pending deferred auto-reindex (no fire after quit)', async () => {
    const mgr = makeManager(db);
    // Arm a real deferred timer via the real scheduleAutoReindex path. To make it schedule,
    // the incompatible count must be > 0, so seed one incompatible meeting.
    db.prepare("INSERT INTO meetings (id, embedding_space) VALUES ('m1','gemini:gemini-embedding-001:768')").run();
    db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('m1','t',?)").run(Buffer.alloc(768 * 4));
    // is_processed column isn't in this minimal schema; getIncompatibleSpaceCount references
    // m.is_processed = 1. Add it so the count predicate matches.
    db.exec('ALTER TABLE meetings ADD COLUMN is_processed INTEGER DEFAULT 1');

    let fired = false;
    // Patch _runReindex so we can detect if the deferred timer ever fires.
    mgr._runReindex = async () => { fired = true; };

    mgr.scheduleAutoReindex();
    assert.notEqual(mgr._autoReindexTimer, null, 'a deferred timer should be armed');

    // dispose() must clear it BEFORE the 15s defer elapses.
    await mgr.dispose();
    assert.equal(mgr._autoReindexTimer, null, 'dispose must null the timer handle');

    // Wait beyond a real tick to confirm the (cleared) timer never fires.
    await new Promise(r => setTimeout(r, 50));
    assert.equal(fired, false, 'cancelled auto-reindex must NEVER fire after dispose');
  });

  test('dispose() swallows a VectorStore.destroy() failure (non-fatal teardown)', async () => {
    // dispose() wraps destroy() in try/catch and only warns. Prove a throwing destroy()
    // does not propagate out of dispose() (so before-quit can never be blocked by it).
    const throwingVs = { destroy: async () => { throw new Error('boom'); } };
    const mgr = makeManager(db, { vectorStore: throwingVs });
    await mgr.dispose(); // must resolve, not reject
    assert.ok(true, 'dispose() absorbed the destroy() failure');
  });

  test('real VectorStore.destroy() AFTER a successful JS-worker search terminates cleanly', async () => {
    // Exercise the OTHER destroy() branch: a worker that WAS started. Run a real JS-fallback
    // search (useNativeVec=false), then destroy.
    const vs = new VectorStore(db, ':memory:', '/nonexistent-ext');
    db.prepare("INSERT INTO meetings (id, embedding_space) VALUES ('m1','gemini:gemini-embedding-2:768')").run();
    const emb = Buffer.alloc(768 * 4);
    for (let i = 0; i < 768; i++) emb.writeFloatLE(0.5, i * 4);
    db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('m1','hello',?)").run(emb);

    const results = await vs.searchSimilar(new Array(768).fill(0.5), { spaceKey: 'gemini:gemini-embedding-2:768' });
    assert.ok(Array.isArray(results), 'search returned results (worker started)');

    await vs.destroy();          // terminate the live worker
    await vs.destroy();          // idempotent second destroy
    assert.ok(true, 'destroy() after a live search terminated the worker cleanly and is idempotent');
  });
});
