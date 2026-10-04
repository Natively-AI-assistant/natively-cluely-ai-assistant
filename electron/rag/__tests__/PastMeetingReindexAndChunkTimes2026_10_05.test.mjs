// Two things about a meeting's place in search (2026-10-05).
//
// 1. Past meetings had a transcript and nothing to search it by: until
//    2026-10-04 the final save of a meeting deleted the chunks indexed a
//    moment earlier. A cursor-walked launch job puts them back.
// 2. A chunk's header in the answer prompt printed its clock time as if it
//    were an offset: "[29851971:37]".
//
// Run under Electron ABI (better-sqlite3):
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = (p) => path.join(root, 'dist-electron/electron', p);
const DB_PATH = dist('db/DatabaseManager.js');
const { RAGManager } = require(dist('rag/RAGManager.js'));
const { VectorStore } = require(dist('rag/VectorStore.js'));
const { EmbeddingPipeline } = require(dist('rag/EmbeddingPipeline.js'));
const { formatChunkForContext } = require(dist('rag/SemanticChunker.js'));

const CURSOR_KEY = 'chunk_backfill_cursor_v1';
const T0 = 1791118297000; // a real clock time, the scale saved transcripts use

describe('a chunk header shows time into the meeting', () => {
  const chunk = (over) => ({ meetingId: 'm', chunkIndex: 0, speaker: 'Me', startMs: T0 + 125000, endMs: T0 + 130000, text: 'we ship on friday', tokenCount: 5, ...over });

  test('clock time is measured from the meeting start', () => {
    assert.equal(formatChunkForContext(chunk(), T0), '[2:05] Me: we ship on friday');
    assert.equal(formatChunkForContext(chunk({ startMs: T0 }), T0), '[0:00] Me: we ship on friday');
  });

  test('clock time with no known start gets no bracket rather than a wrong one', () => {
    assert.equal(formatChunkForContext(chunk()), 'Me: we ship on friday');
    assert.equal(formatChunkForContext(chunk(), T0 + 999999999), 'Me: we ship on friday', 'a start after the chunk is not a start');
    assert.doesNotMatch(formatChunkForContext(chunk()), /\d{6,}/);
  });

  test('a chunk whose times are already offsets prints as before', () => {
    assert.equal(formatChunkForContext(chunk({ startMs: 65000 })), '[1:05] Me: we ship on friday');
    assert.equal(formatChunkForContext(chunk({ startMs: 0 })), '[0:00] Me: we ship on friday');
  });

  test('a chunk that labels its own turns keeps them on their own lines', () => {
    const labelled = chunk({ text: 'THEM: when do we ship?\nME: friday' });
    assert.equal(formatChunkForContext(labelled, T0), '[2:05]\nTHEM: when do we ship?\nME: friday');
    assert.equal(formatChunkForContext(labelled), 'THEM: when do we ship?\nME: friday');
  });
});

describe('past meetings get their transcript back in search', () => {
  let tmp, dbMgr, db, rag, ready, standIn, live, loadable, loads;

  const spoken = (n) => Array.from({ length: n }, (_, i) => ({
    speaker: i % 2 ? 'user' : 'interviewer',
    text: `Line ${i}: we went through the launch plan, the budget for the quarter and who owns the rollout checklist.`,
    timestamp: T0 + i * 4000,
    origin: 'stt',
  }));
  const save = (id, transcript) => dbMgr.saveMeeting({
    id, title: `Meeting ${id}`, date: '2026-09-20T10:00:00.000Z', duration: '5:00', summary: '',
    detailedSummary: { actionItems: [], keyPoints: [] }, transcript, usage: [], isProcessed: true,
  });
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  const chunksOf = (id) => count('SELECT COUNT(*) AS n FROM chunks WHERE meeting_id = ?', id);
  const pendingOf = (id) => count(`SELECT COUNT(*) AS n FROM embedding_queue WHERE meeting_id = ? AND chunk_id IS NOT NULL AND status = 'pending'`, id);
  const cursor = () => db.prepare('SELECT value FROM app_state WHERE key = ?').get(CURSOR_KEY)?.value;
  const quiet = async (fn) => {
    const log = console.log, warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { return await fn(); } finally { console.log = log; console.warn = warn; }
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-backfill-'));
    process.env.NATIVELY_TEST_USERDATA = tmp;
    delete require.cache[DB_PATH];
    dbMgr = require(DB_PATH).DatabaseManager.getInstance();
    db = dbMgr.getDb();
    globalThis.__nativelyChunkBackfillInFlightV1__ = false;
    ready = true; standIn = false; live = false; loadable = false; loads = 0;

    // The real manager, store and pipeline over a real database. The pipeline
    // is never initialized (no provider, so nothing is embedded and no network
    // is touched); only its two state questions are answered by the test.
    rag = Object.create(RAGManager.prototype);
    rag.db = db;
    rag.vectorStore = new VectorStore(db, ':memory:', '/nonexistent-ext');
    rag.embeddingPipeline = new EmbeddingPipeline(db, rag.vectorStore);
    rag.embeddingPipeline.isReady = () => ready;
    rag.embeddingPipeline.getActiveSpaceKey = () => 'test:space:16';
    // A lazily-loaded provider (the bundled model): not ready until asked to load.
    rag.embeddingPipeline.ensureProviderLoaded = async () => { loads++; if (loadable) ready = true; return ready; };
    rag.embeddingPipeline.isRunningOnUnpinnedFallback = () => standIn;
    rag.liveIndexer = { isRunning: () => live };
    // Each compiled file is its own bundle with its own DatabaseManager
    // singleton, so the manager reads meetings through the one opened here.
    rag.loadMeetingForIndexing = (id) => dbMgr.getMeetingDetails(id);
    rag._chunkBackfillTimer = null;
    rag._chunkBackfillLiveWaits = 0;
  });

  afterEach(() => {
    rag.cancelPendingReindex();
    try { dbMgr.close?.(); } catch {}
    delete require.cache[DB_PATH];
    delete process.env.NATIVELY_TEST_USERDATA;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('a meeting with speech and no chunks is chunked and queued; then the walk is done', async () => {
    if (!dbMgr.isAvailable()) return;
    save('lost', spoken(8));
    assert.equal(chunksOf('lost'), 0);

    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 1);
    assert.ok(chunksOf('lost') > 0, 'chunks exist again');
    assert.equal(pendingOf('lost'), chunksOf('lost'), 'every chunk is waiting to be embedded');
    assert.equal(cursor(), 'done');

    // The next launch reads one row and does nothing.
    globalThis.__nativelyChunkBackfillInFlightV1__ = false;
    const before = chunksOf('lost');
    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 0);
    assert.equal(chunksOf('lost'), before);
  });

  test('typed chat and the assistant are not indexed as speech; an indexed meeting is left alone', async () => {
    if (!dbMgr.isAvailable()) return;
    save('chat-only', [
      { speaker: 'user', text: 'what model are you and what can you do for me in this meeting?', timestamp: T0, origin: 'manual_chat' },
      { speaker: 'assistant', text: 'I am Natively, an AI assistant that can help with this meeting.', timestamp: T0 + 1, origin: 'assistant', chatReply: true },
    ]);
    save('indexed', spoken(8));
    db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding) VALUES ('indexed', 0, 'Me', ?, ?, 'kept as it is', 3, ?)`)
      .run(T0, T0 + 1000, Buffer.alloc(16));

    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 0);
    assert.equal(chunksOf('chat-only'), 0);
    assert.equal(chunksOf('indexed'), 1);
    assert.equal(db.prepare(`SELECT cleaned_text FROM chunks WHERE meeting_id = 'indexed'`).get().cleaned_text, 'kept as it is');
    assert.equal(cursor(), 'done');
  });

  test('queue rows left behind by the deleted chunks do not hide the meeting, and are cleared', async () => {
    if (!dbMgr.isAvailable()) return;
    save('lost', spoken(8));
    db.prepare(`INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('lost', 9001, 'completed')`).run();
    db.prepare(`INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('lost', 9002, 'failed')`).run();

    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 1);
    assert.equal(count(`SELECT COUNT(*) AS n FROM embedding_queue WHERE meeting_id = 'lost' AND chunk_id IN (9001, 9002)`), 0);
    assert.equal(pendingOf('lost'), chunksOf('lost'));
  });

  test('chunks saved while no provider was ready (never queued) are replaced, not doubled', async () => {
    if (!dbMgr.isAvailable()) return;
    save('unqueued', spoken(8));
    db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count) VALUES ('unqueued', 0, 'Me', ?, ?, 'stale unembedded chunk', 3)`)
      .run(T0, T0 + 1000);

    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 1);
    assert.equal(count(`SELECT COUNT(*) AS n FROM chunks WHERE meeting_id = 'unqueued' AND cleaned_text = 'stale unembedded chunk'`), 0);
    assert.equal(pendingOf('unqueued'), chunksOf('unqueued'));
  });

  test('a meeting whose chunks are already waiting in the queue is not indexed a second time', async () => {
    if (!dbMgr.isAvailable()) return;
    save('queued', spoken(8));
    const id = db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count) VALUES ('queued', 0, 'Me', ?, ?, 'waiting its turn', 3)`)
      .run(T0, T0 + 1000).lastInsertRowid;
    db.prepare(`INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('queued', ?, 'pending')`).run(id);

    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 0);
    assert.equal(chunksOf('queued'), 1);
  });

  test('the per-launch cap holds and the walk resumes, newest meeting first', async () => {
    if (!dbMgr.isAvailable()) return;
    save('older', spoken(8));
    save('newer', spoken(8));

    assert.equal(await quiet(() => rag.backfillMeetingChunks(1)), 1);
    assert.ok(chunksOf('newer') > 0, 'the newest meeting goes first');
    assert.equal(chunksOf('older'), 0);
    assert.notEqual(cursor(), 'done');

    assert.equal(await quiet(() => rag.backfillMeetingChunks(1)), 1);
    assert.ok(chunksOf('older') > 0);
  });

  test('with no provider ready nothing is saved and the cursor does not move', async () => {
    if (!dbMgr.isAvailable()) return;
    save('lost', spoken(8));
    ready = false;
    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 0);
    assert.equal(chunksOf('lost'), 0, 'chunks saved unembedded would never be picked up again');
    assert.equal(cursor(), undefined);

    ready = true;
    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 1);
  });

  test('a provider that loads on demand is loaded when there is work, and only then', async () => {
    if (!dbMgr.isAvailable()) return;
    ready = false; loadable = true;
    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 0);
    assert.equal(loads, 0, 'nothing to re-index, so the model is not loaded for it');
    assert.equal(cursor(), 'done');

    db.prepare('DELETE FROM app_state WHERE key = ?').run(CURSOR_KEY);
    ready = false;
    save('lost', spoken(8));
    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 1);
    assert.equal(loads, 1);
    assert.equal(pendingOf('lost'), chunksOf('lost'), 'queued, not left unembedded');
  });

  // Found while testing the above: the bundled local model reports not-ready
  // until its first embed, and indexing a meeting gated its queueing on that —
  // so on the local model alone a meeting's chunks were saved and never queued.
  describe('indexing a meeting while the model is not loaded yet', () => {
    const segments = () => spoken(8).map(({ speaker, text, timestamp }) => ({ speaker, text, timestamp }));
    const settle = () => new Promise(resolve => setTimeout(resolve, 20));

    test('at meeting end it returns at once and queues when the model is up', async () => {
      if (!dbMgr.isAvailable()) return;
      save('ended', spoken(8));
      ready = false; loadable = true;
      let release;
      rag.embeddingPipeline.ensureProviderLoaded = () => new Promise(resolve => { release = () => { ready = true; resolve(true); }; });

      const { chunkCount } = await quiet(() => rag.processMeeting('ended', segments()));
      assert.ok(chunkCount > 0);
      assert.equal(pendingOf('ended'), 0, 'returned without waiting for the load');
      await quiet(async () => { release(); await settle(); });
      assert.equal(pendingOf('ended'), chunksOf('ended'));
    });

    test('the cold-start demo check never loads a model', async () => {
      if (!dbMgr.isAvailable()) return;
      save('demo-like', spoken(8));
      ready = false; loadable = true;
      await quiet(() => rag.processMeeting('demo-like', segments(), undefined, { providerLoad: 'never' }));
      await settle();
      assert.equal(loads, 0);
      assert.equal(pendingOf('demo-like'), 0);
      const src = fs.readFileSync(path.join(root, 'electron/rag/RAGManager.ts'), 'utf8');
      assert.match(src, /await this\.reprocessMeeting\(demoId, \{ providerLoad: 'never' \}\);/);
    });

    test('a model that will not load leaves the chunks saved and nothing queued', async () => {
      if (!dbMgr.isAvailable()) return;
      save('ended', spoken(8));
      ready = false; loadable = false;
      await quiet(async () => { await rag.processMeeting('ended', segments()); await settle(); });
      assert.equal(loads, 1);
      assert.ok(chunksOf('ended') > 0);
      assert.equal(pendingOf('ended'), 0);
    });
  });

  test('a stand-in provider does not re-index the corpus at its own width', async () => {
    if (!dbMgr.isAvailable()) return;
    save('lost', spoken(8));
    standIn = true;
    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 0);
    assert.equal(chunksOf('lost'), 0);
    assert.equal(cursor(), undefined);
  });

  test('a live meeting postpones it', async () => {
    if (!dbMgr.isAvailable()) return;
    save('lost', spoken(8));
    live = true;
    assert.equal(await quiet(() => rag.backfillMeetingChunks()), 0);
    assert.equal(chunksOf('lost'), 0);
    assert.equal(cursor(), undefined);
    assert.notEqual(rag._chunkBackfillTimer, null, 'it checks again later');
  });

  test('it is armed wherever the embedding provider is resolved, and cancelled on teardown', () => {
    const src = fs.readFileSync(path.join(root, 'electron/rag/RAGManager.ts'), 'utf8');
    assert.equal((src.match(/this\.scheduleChunkBackfill\(\);/g) || []).length, 3, 'constructor init, initializeEmbeddings, and its synchronous path');
    const cancel = src.slice(src.indexOf('cancelPendingReindex(): void {'));
    assert.match(cancel.slice(0, 500), /_chunkBackfillTimer/);
    // processMeeting, not reprocessMeeting: the latter deletes the summary and
    // its queue row, so the summary backfill's embedding would be paid for twice.
    const body = src.slice(src.indexOf('async backfillMeetingChunks('), src.indexOf('* Ensure demo meeting is processed'));
    assert.match(body, /await this\.processMeeting\(/);
    assert.doesNotMatch(body, /this\.reprocessMeeting\(/);
  });
});
