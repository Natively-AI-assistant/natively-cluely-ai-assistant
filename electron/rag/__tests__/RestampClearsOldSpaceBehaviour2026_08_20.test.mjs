// R-21 behavioural test — the REAL compiled VectorStore against real SQLite.
//
// The companion source-assertion test pins the ORDERING (clear before the
// UPDATE; re-stamp before storeEmbedding). This one pins what actually lands in
// the database, which ordering assertions cannot show.
//
// Same harness as RequeueReindexAtomicity: an in-memory DB with no vec_chunks_*
// table, so detectVecSupport() is false, the pure-SQL path runs, and there is no
// DatabaseManager singleton dependency.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vsPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/VectorStore.js');
const { VectorStore } = await import(pathToFileURL(vsPath).href);

const CLOUD = 'gemini:gemini-embedding-001:768';
const LOCAL = 'local:bge-small:384';

describe('restampMeetingSpaceOnChange (real VectorStore + SQLite)', () => {
  let db, vectorStore;

  beforeEach(() => {
    db = new Database(':memory:');
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
    `);
    vectorStore = new VectorStore(db, ':memory:', '/nonexistent-ext');

    // A live meeting whose first ticks embedded 3 chunks under the CLOUD space.
    const blob = Buffer.alloc(768 * 4);
    db.prepare("INSERT INTO meetings (id, embedding_provider, embedding_dimensions, embedding_space) VALUES ('live-meeting-current','gemini',768,?)").run(CLOUD);
    for (let i = 0; i < 3; i++) {
      db.prepare("INSERT INTO chunks (meeting_id, cleaned_text, embedding) VALUES ('live-meeting-current', ?, ?)").run(`cloud chunk ${i}`, blob);
    }
    db.prepare("INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('live-meeting-current','sum', ?)").run(blob);
  });

  afterEach(() => db.close());

  const embeddedCount = () =>
    db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE meeting_id='live-meeting-current' AND embedding IS NOT NULL").get().n;
  const meeting = () =>
    db.prepare("SELECT embedding_provider AS p, embedding_dimensions AS d, embedding_space AS s FROM meetings WHERE id='live-meeting-current'").get();

  test('a mid-meeting provider fallback discards the old space\'s vectors', () => {
    assert.equal(embeddedCount(), 3, 'precondition: three chunks embedded under the cloud space');

    const changed = vectorStore.restampMeetingSpaceOnChange('live-meeting-current', 'local', 384, LOCAL);
    assert.equal(changed, true, 'a genuine space change must be reported');

    assert.equal(embeddedCount(), 0,
      'the cloud-space vectors must be gone — left in place they are scored against local-space queries');
    assert.equal(meeting().s, LOCAL, 'the meeting must now claim the local space');
    assert.equal(meeting().d, 384);
    assert.equal(meeting().p, 'local');
  });

  test('the summary embedded under the old space is discarded too', () => {
    vectorStore.restampMeetingSpaceOnChange('live-meeting-current', 'local', 384, LOCAL);
    const n = db.prepare("SELECT COUNT(*) AS n FROM chunk_summaries WHERE meeting_id='live-meeting-current' AND embedding IS NOT NULL").get().n;
    assert.equal(n, 0, 'chunk_summaries is space-bound the same way chunks are');
  });

  test('an unchanged space is a no-op — it must not wipe a healthy meeting', () => {
    const changed = vectorStore.restampMeetingSpaceOnChange('live-meeting-current', 'gemini', 768, CLOUD);
    assert.equal(changed, false, 'the common case must stay a no-op');
    assert.equal(embeddedCount(), 3, 'nothing may be cleared when the space did not change');
    assert.equal(meeting().s, CLOUD);
  });

  test('an unstamped meeting is left to stampMeetingSpaceIfUnset', () => {
    db.prepare("UPDATE meetings SET embedding_space = NULL WHERE id='live-meeting-current'").run();
    const changed = vectorStore.restampMeetingSpaceOnChange('live-meeting-current', 'local', 384, LOCAL);
    assert.equal(changed, false, 'no prior space means nothing to re-stamp — and nothing to discard');
    assert.equal(embeddedCount(), 3);
  });

  test('after a re-stamp, stampMeetingSpaceIfUnset does not overwrite it', () => {
    vectorStore.restampMeetingSpaceOnChange('live-meeting-current', 'local', 384, LOCAL);
    // This is the very next call in runTick; its WHERE ... AND embedding_space IS NULL
    // must make it a no-op so the stamp is written from exactly one place.
    vectorStore.stampMeetingSpaceIfUnset('live-meeting-current', 'gemini', 768, CLOUD);
    assert.equal(meeting().s, LOCAL, 'the re-stamped space must survive the follow-up call');
    assert.equal(meeting().d, 384);
  });

  test('a failed re-stamp rolls back rather than half-clearing the meeting', () => {
    // Make the UPDATE fail AFTER the clear has run inside the transaction.
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (sql.startsWith('UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ?, embedding_space = ? WHERE id = ?')) {
        throw new Error('simulated write failure');
      }
      return realPrepare(sql);
    };

    const changed = vectorStore.restampMeetingSpaceOnChange('live-meeting-current', 'local', 384, LOCAL);
    db.prepare = realPrepare;

    assert.equal(changed, false, 'a failure must be reported, not swallowed as success');
    assert.equal(embeddedCount(), 3,
      'the clear must roll back — a half-cleared meeting still claiming the old space is worse than before the call');
    assert.equal(meeting().s, CLOUD, 'and the meeting must still claim its original space');
  });
});
