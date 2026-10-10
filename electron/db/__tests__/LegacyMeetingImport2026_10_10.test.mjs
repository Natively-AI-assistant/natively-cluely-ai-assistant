// Meetings left in the old profile folder come across (2026-10-10).
//
// 2.9.2 moved the packaged profile from `Natively` to the disguise name and
// changed the app id in the same release, so the update installs next to the
// old app. The old app, opened afterwards, starts an empty `Natively` folder
// and records there. Users reported "old meetings are not showing up".
// db/legacyMeetingImport copies what the old folder's database has and this
// one lacks. Behavioural tests against real SQLite files.
//
// Run under `ELECTRON_RUN_AS_NODE=1 electron --test` (native ABI).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');
const {
  importLegacyMeetings,
  importLegacyProfiles,
  legacyProfileDatabases,
  LEGACY_IMPORT_SEEN_PREFIX,
  LEGACY_IMPORT_SOURCES_KEY,
  UNFINISHED_WAIT_MS,
} = require(path.join(repoRoot, 'dist-electron/electron/db/legacyMeetingImport.js'));

let Sqlite = null;
try { Sqlite = require('better-sqlite3'); new Sqlite(':memory:').close(); } catch { Sqlite = null; }

let appData;
let dbMgr;
let dest;

/** The profile this app runs in: `<appData>/corespeechd`, current schema. */
function openDest() {
  const userData = path.join(appData, 'corespeechd');
  fs.mkdirSync(userData, { recursive: true });
  process.env.NATIVELY_TEST_USERDATA = userData;
  try { delete require.cache[DB_PATH]; } catch {}
  dbMgr = require(DB_PATH).DatabaseManager.getInstance();
  dest = dbMgr.getDb();
  return userData;
}

/** An old profile database with the columns 2.8.x shipped (schema 25). */
function makeLegacy(dir, { wal = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'natively.db');
  const db = new Sqlite(file);
  if (wal) db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY, title TEXT, start_time INTEGER, duration_ms INTEGER, summary_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, calendar_event_id TEXT, source TEXT, is_processed INTEGER DEFAULT 1,
      embedding_provider TEXT, embedding_dimensions INTEGER, embedding_space TEXT, summary_status TEXT DEFAULT 'completed',
      a_column_this_app_dropped TEXT
    );
    CREATE TABLE transcripts (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, speaker TEXT, content TEXT, timestamp_ms INTEGER);
    CREATE TABLE ai_interactions (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, type TEXT, timestamp INTEGER,
      user_query TEXT, ai_response TEXT, metadata_json TEXT);
  `);
  return { file, db };
}

function addLegacyMeeting(db, id, { title = `Meeting ${id}`, lines = 2, answers = 1, createdAt = '2026-09-01T10:00:00.000Z', processed = 1 } = {}) {
  db.prepare(`INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, source, is_processed,
      embedding_provider, embedding_dimensions, embedding_space, summary_status, a_column_this_app_dropped)
    VALUES (?, ?, 1000, 65000, ?, ?, 'manual', ?, 'gemini', 3072, 'gemini:old:3072', 'completed', 'x')`)
    .run(id, title, JSON.stringify({ legacySummary: `summary of ${id}` }), createdAt, processed);
  for (let i = 0; i < lines; i++) {
    db.prepare('INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms) VALUES (?, ?, ?, ?)')
      .run(id, i % 2 ? 'user' : 'interviewer', `${id} line ${i}`, 1000 + i);
  }
  for (let i = 0; i < answers; i++) {
    db.prepare('INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response, metadata_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, 'answer', 2000 + i, `${id} q${i}`, `${id} a${i}`, '{}');
  }
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const count = (sql, ...args) => dest.prepare(sql).get(...args).n;
const titles = () => dbMgr.getRecentMeetings(500).map((m) => m.title).sort();
const remembered = () => dest.prepare(`SELECT key FROM app_state WHERE key LIKE 'legacy!_meeting!_seen!_v1:%' ESCAPE '!' ORDER BY key`).all()
  .map((r) => r.key.slice(LEGACY_IMPORT_SEEN_PREFIX.length));
// rag/backfillRearm, read by RAGManager's two walks: the lowest rowid copied.
const REARM_KEYS = ['chunk_backfill_rearm_v1', 'summary_backfill_rearm_v1'];
const rowidOf = (id) => String(dest.prepare('SELECT rowid AS r FROM meetings WHERE id = ?').get(id).r);

/** The pieces importLegacyProfiles wires up, for calling the core directly. */
let signatures = 0;
function deps(file, over = {}) {
  return {
    dest,
    sourcePath: file,
    openSource: (p) => new Sqlite(p, { readonly: true, fileMustExist: true }),
    // A new value every call unless the test pins one: "the file changed".
    signature: () => `sig-${++signatures}`,
    ...over,
  };
}

const usable = () => Sqlite !== null && dbMgr?.isAvailable?.() === true;
const NO_SQLITE = 'better-sqlite3 is not loadable here (run under ELECTRON_RUN_AS_NODE=1 electron --test)';

describe('meetings in the old profile folder', () => {
  beforeEach(() => { appData = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-import-')); openDest(); });
  afterEach(() => {
    try { dbMgr?.close?.(); } catch {}
    try { delete require.cache[DB_PATH]; } catch {}
    delete process.env.NATIVELY_TEST_USERDATA;
    try { fs.rmSync(appData, { recursive: true, force: true }); } catch {}
  });

  test('every meeting this profile lacks arrives with its transcript and answers', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE); // native binding not loadable in this env
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'old-1', { lines: 3, answers: 2 });
    addLegacyMeeting(db, 'old-2', { lines: 1, answers: 0, createdAt: '2026-09-02T10:00:00.000Z' });
    db.close();

    const result = await importLegacyMeetings(deps(file));

    assert.deepEqual({ status: result.status, found: result.found, imported: result.imported }, { status: 'imported', found: 2, imported: 2 });
    assert.deepEqual(titles(), ['Meeting old-1', 'Meeting old-2'], 'both are in the list the Launcher reads');
    const details = dbMgr.getMeetingDetails('old-1');
    assert.equal(details.transcript.length, 3, 'the transcript came with it');
    assert.deepEqual(details.transcript.map((t) => t.text), ['old-1 line 0', 'old-1 line 1', 'old-1 line 2'], 'in the order it was said');
    assert.equal(details.usage.length, 2, 'and so did the answers');
    assert.equal(details.summary, 'summary of old-1');
    const row = dest.prepare(`SELECT embedding_provider, embedding_dimensions, embedding_space, duration_ms, created_at FROM meetings WHERE id = 'old-1'`).get();
    assert.deepEqual(row, { embedding_provider: null, embedding_dimensions: null, embedding_space: null, duration_ms: 65000, created_at: '2026-09-01T10:00:00.000Z' },
      'no chunks were copied, so the meeting must not claim to be indexed');
  });

  test('a meeting this profile already has is left exactly as it is', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    dbMgr.saveMeeting({
      id: 'both', title: 'Kept title', date: '2026-10-01T10:00:00.000Z', duration: '0:05', summary: '',
      detailedSummary: { actionItems: [], keyPoints: [] },
      transcript: [{ speaker: 'user', text: 'the line this profile has', timestamp: 1000, origin: 'stt' }],
      usage: [], isProcessed: true,
    }, 1000, 5000);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'both', { title: 'Old title', lines: 4 });
    addLegacyMeeting(db, 'only-old');
    db.close();

    const result = await importLegacyMeetings(deps(file));

    assert.equal(result.imported, 1);
    assert.equal(dest.prepare(`SELECT title FROM meetings WHERE id = 'both'`).get().title, 'Kept title');
    assert.equal(count(`SELECT COUNT(*) AS n FROM transcripts WHERE meeting_id = 'both'`), 1, 'its transcript is not added to');
  });

  test('a meeting that appears here while the import is running is not overwritten either', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'first');
    addLegacyMeeting(db, 'raced', { title: 'Old title', lines: 4 });
    db.close();
    let saved = false;
    const pause = async () => {
      if (saved) return;
      saved = true;
      dbMgr.saveMeeting({
        id: 'raced', title: 'Saved meanwhile', date: '2026-10-01T10:00:00.000Z', duration: '0:05', summary: '',
        detailedSummary: { actionItems: [], keyPoints: [] },
        transcript: [{ speaker: 'user', text: 'one line', timestamp: 1000, origin: 'stt' }],
        usage: [], isProcessed: true,
      }, 1000, 5000);
    };

    const result = await importLegacyMeetings(deps(file, { batchSize: 1, pause }));

    assert.equal(result.imported, 1);
    assert.equal(dest.prepare(`SELECT title FROM meetings WHERE id = 'raced'`).get().title, 'Saved meanwhile');
    assert.equal(count(`SELECT COUNT(*) AS n FROM transcripts WHERE meeting_id = 'raced'`), 1);
  });

  test('the demo meeting and the live placeholder are never copied', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'demo-meeting', { title: 'Old demo' });
    addLegacyMeeting(db, 'live-meeting-current', { title: 'Live' });
    addLegacyMeeting(db, 'real');
    db.close();

    const result = await importLegacyMeetings(deps(file));

    assert.deepEqual({ found: result.found, imported: result.imported }, { found: 1, imported: 1 });
    assert.equal(count(`SELECT COUNT(*) AS n FROM meetings WHERE title IN ('Old demo', 'Live')`), 0);
  });

  test('running again copies nothing twice', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'old-1', { lines: 3, answers: 2 });
    db.close();

    await importLegacyMeetings(deps(file));
    const again = await importLegacyMeetings(deps(file));

    assert.deepEqual({ status: again.status, imported: again.imported }, { status: 'nothing-new', imported: 0 });
    assert.equal(count(`SELECT COUNT(*) AS n FROM meetings WHERE id = 'old-1'`), 1);
    assert.equal(count(`SELECT COUNT(*) AS n FROM transcripts WHERE meeting_id = 'old-1'`), 3);
    assert.equal(count(`SELECT COUNT(*) AS n FROM ai_interactions WHERE meeting_id = 'old-1'`), 2);
  });

  test('an old database that has not changed is not opened again', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'old-1');
    db.close();
    let opens = 0;
    const pinned = deps(file, { signature: () => 'same', openSource: (p) => { opens++; return new Sqlite(p, { readonly: true, fileMustExist: true }); } });

    await importLegacyMeetings(pinned);
    const again = await importLegacyMeetings(pinned);

    assert.equal(again.status, 'unchanged');
    assert.equal(opens, 1);
  });

  test('a copied meeting deleted here stays deleted, and a later one still arrives', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'old-1');
    await importLegacyMeetings(deps(file));
    dbMgr.deleteMeeting('old-1');

    // The old app is opened again and records another meeting.
    addLegacyMeeting(db, 'old-2');
    db.close();
    const result = await importLegacyMeetings(deps(file));

    assert.equal(result.imported, 1);
    assert.deepEqual(titles(), ['Meeting old-2'], 'the deleted meeting did not come back');
    assert.deepEqual(remembered(), ['old-1', 'old-2']);
  });

  // The new folder was adopted or copied by hand: both databases hold the same
  // meetings, so nothing is copied. Deleting one here must still be final.
  test('a meeting both databases held, deleted here, does not come back', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    dbMgr.saveMeeting({
      id: 'both', title: 'In both', date: '2026-10-01T10:00:00.000Z', duration: '0:05', summary: '',
      detailedSummary: { actionItems: [], keyPoints: [] },
      transcript: [{ speaker: 'user', text: 'a line', timestamp: 1000, origin: 'stt' }],
      usage: [], isProcessed: true,
    }, 1000, 5000);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'both');
    db.close();

    const first = await importLegacyMeetings(deps(file));
    assert.equal(first.imported, 0);
    dbMgr.deleteMeeting('both');
    const second = await importLegacyMeetings(deps(file));

    assert.equal(second.imported, 0);
    assert.deepEqual(titles(), []);
  });

  test('clearing all data here does not bring the old meetings back', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'old-1');
    addLegacyMeeting(db, 'old-2');
    db.close();
    await importLegacyMeetings(deps(file));

    assert.equal(dbMgr.clearAllData(), true);
    const again = await importLegacyMeetings(deps(file));

    assert.equal(again.imported, 0);
    assert.equal(count('SELECT COUNT(*) AS n FROM meetings'), 0);
  });

  // The old app saves a placeholder when a meeting stops and the notes later.
  test('a meeting the old app is still writing notes for waits until it is finished', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const now = Date.parse('2026-10-10T12:00:00.000Z');
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'in-progress', { title: 'Processing...', createdAt: '2026-10-10T11:30:00.000Z', processed: 0 });
    addLegacyMeeting(db, 'finished', { createdAt: '2026-10-10T09:00:00.000Z' });

    const first = await importLegacyMeetings(deps(file, { now: () => now }));

    assert.deepEqual({ imported: first.imported, waiting: first.waiting }, { imported: 1, waiting: 1 });
    assert.deepEqual(titles(), ['Meeting finished']);
    assert.equal(dbMgr.getAppState(LEGACY_IMPORT_SOURCES_KEY), null, 'the file is looked at again next launch even if it does not change');

    db.prepare(`UPDATE meetings SET title = 'Roadmap review', is_processed = 1 WHERE id = 'in-progress'`).run();
    db.close();
    const second = await importLegacyMeetings(deps(file, { now: () => now + 60_000 }));

    assert.deepEqual({ imported: second.imported, waiting: second.waiting }, { imported: 1, waiting: 0 });
    assert.deepEqual(titles(), ['Meeting finished', 'Roadmap review'], 'with the title the old app gave it, not the placeholder');
    assert.notEqual(dbMgr.getAppState(LEGACY_IMPORT_SOURCES_KEY), null);
  });

  test('a meeting the old app never finished comes across as it is after a day', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const created = Date.parse('2026-10-08T11:30:00.000Z');
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'stuck', { createdAt: '2026-10-08T11:30:00.000Z', processed: 0, lines: 3 });
    db.close();

    const early = await importLegacyMeetings(deps(file, { now: () => created + UNFINISHED_WAIT_MS - 1 }));
    assert.deepEqual({ imported: early.imported, waiting: early.waiting }, { imported: 0, waiting: 1 });

    const later = await importLegacyMeetings(deps(file, { now: () => created + UNFINISHED_WAIT_MS }));
    assert.deepEqual({ imported: later.imported, waiting: later.waiting }, { imported: 1, waiting: 0 });
    assert.equal(dest.prepare(`SELECT is_processed FROM meetings WHERE id = 'stuck'`).get().is_processed, 0, 'still unfinished, so this app recovers it');
    assert.equal(count(`SELECT COUNT(*) AS n FROM transcripts WHERE meeting_id = 'stuck'`), 3);
  });

  test('an unfinished meeting dated in the future is a wrong clock, not a meeting in progress', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'future', { createdAt: '2030-01-01T00:00:00.000Z', processed: 0 });
    db.close();

    const result = await importLegacyMeetings(deps(file, { now: () => Date.parse('2026-10-10T12:00:00.000Z') }));

    assert.deepEqual({ imported: result.imported, waiting: result.waiting }, { imported: 1, waiting: 0 });
  });

  test('the request to index the copied meetings is saved with them', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    db.close();
    await importLegacyMeetings(deps(file));
    for (const key of REARM_KEYS) assert.equal(dbMgr.getAppState(key), null, 'nothing copied, nothing asked for');

    const again = new Sqlite(file);
    for (const id of ['old-1', 'old-2', 'old-3']) addLegacyMeeting(again, id);
    again.close();
    // The app quits the moment the first batch is committed: no code after it runs.
    await importLegacyMeetings(deps(file, { batchSize: 2, pause: async () => { throw new Error('quit'); } }));

    assert.equal(count('SELECT COUNT(*) AS n FROM meetings'), 2);
    for (const key of REARM_KEYS) assert.equal(dbMgr.getAppState(key), rowidOf('old-1'), 'the first row search has to go back to');
  });

  test('a later batch does not move the request past the earlier one', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    for (const id of ['a', 'b', 'c']) addLegacyMeeting(db, id);
    db.close();

    await importLegacyMeetings(deps(file, { batchSize: 1 }));

    for (const key of REARM_KEYS) assert.equal(dbMgr.getAppState(key), rowidOf('a'));
  });

  // The old app is running and saves the meeting's final title and lines
  // between this app reading the row and reading the lines.
  test('a meeting the old app saves during the copy arrives as one version, not a mix of two', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'), { wal: true });
    addLegacyMeeting(db, 'm', { title: 'First title', lines: 2 });
    let saves = 0;
    dest.function('old_app_saves', () => {
      saves++;
      db.transaction(() => {
        db.prepare(`UPDATE meetings SET title = 'Second title' WHERE id = 'm'`).run();
        db.prepare(`DELETE FROM transcripts WHERE meeting_id = 'm'`).run();
        for (let i = 0; i < 5; i++) db.prepare('INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms) VALUES (?, ?, ?, ?)').run('m', 'user', `second line ${i}`, 5000 + i);
      })();
      return 0;
    });
    dest.exec(`CREATE TRIGGER while_copying AFTER INSERT ON meetings WHEN NEW.id = 'm' BEGIN SELECT old_app_saves(); END;`);

    try {
      await importLegacyMeetings(deps(file));
    } finally {
      dest.exec('DROP TRIGGER while_copying');
      db.close();
    }

    assert.equal(saves, 1, 'the old app did save in the middle of the copy');
    assert.equal(dest.prepare(`SELECT title FROM meetings WHERE id = 'm'`).get().title, 'First title');
    assert.deepEqual(dest.prepare(`SELECT content FROM transcripts WHERE meeting_id = 'm' ORDER BY id`).all().map((r) => r.content),
      ['m line 0', 'm line 1'], 'the lines that belong to that title');
  });

  test('a meeting this database refuses for another reason than its id is counted, not dropped', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    dbMgr.saveMeeting({
      id: 'here', title: 'Same title', date: '2026-10-01T10:00:00.000Z', duration: '0:05', summary: '',
      detailedSummary: { actionItems: [], keyPoints: [] }, transcript: [], usage: [], isProcessed: true,
    }, 1000, 5000);
    dest.exec('CREATE UNIQUE INDEX one_title ON meetings(title)');
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'refused', { title: 'Same title' });
    addLegacyMeeting(db, 'fine');
    db.close();

    const result = await importLegacyMeetings(deps(file));

    assert.deepEqual({ imported: result.imported, failed: result.failed }, { imported: 1, failed: 1 });
    assert.match(result.reason, /UNIQUE/i);
    assert.equal(dbMgr.getAppState(LEGACY_IMPORT_SOURCES_KEY), null, 'so it is tried again next launch');
    assert.deepEqual(remembered(), ['fine']);
  });

  test('a full disk stops the run at once instead of failing every meeting in turn', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    const big = 'x'.repeat(40_000);
    for (let i = 0; i < 6; i++) {
      addLegacyMeeting(db, `m${i}`, { lines: 0 });
      db.prepare('INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms) VALUES (?, ?, ?, ?)').run(`m${i}`, 'user', big, 1000);
    }
    db.close();
    const pages = dest.pragma('page_count', { simple: true });
    dest.pragma(`max_page_count = ${pages}`);

    const full = await importLegacyMeetings(deps(file));

    assert.equal(full.status, 'failed');
    assert.match(full.reason, /full/i);
    assert.deepEqual({ imported: full.imported, failed: full.failed }, { imported: 0, failed: 0 }, 'no meeting is blamed, and none is retried one by one');
    assert.equal(count('SELECT COUNT(*) AS n FROM meetings'), 0);
    assert.equal(dbMgr.getAppState(LEGACY_IMPORT_SOURCES_KEY), null);

    dest.pragma('max_page_count = 1073741823');
    const later = await importLegacyMeetings(deps(file));
    assert.deepEqual({ status: later.status, imported: later.imported }, { status: 'imported', imported: 6 });
  });

  test('a quit in the middle keeps what was copied and writes nothing more', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    for (const id of ['a', 'b', 'c']) addLegacyMeeting(db, id);
    db.close();
    const userData = process.env.NATIVELY_TEST_USERDATA;

    const result = await importLegacyMeetings(deps(file, { batchSize: 1, pause: async () => { dbMgr.close(); } }));

    assert.deepEqual({ status: result.status, imported: result.imported }, { status: 'interrupted', imported: 1 });
    const reopened = new Sqlite(path.join(userData, 'natively.db'), { readonly: true });
    try {
      assert.deepEqual(reopened.prepare('SELECT id FROM meetings ORDER BY id').all().map((r) => r.id), ['a']);
      assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM app_state WHERE key = ?').get(LEGACY_IMPORT_SOURCES_KEY).n, 0, 'the old file is read again next launch');
    } finally {
      reopened.close();
    }
  });

  test('a meeting deleted in the old app before it could be copied asks for nothing', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'gone');
    // The clock is read after the old database's list and before the copy.
    const now = () => { db.prepare(`DELETE FROM meetings WHERE id = 'gone'`).run(); return Date.now(); };

    const result = await importLegacyMeetings(deps(file, { now }));
    db.close();

    assert.deepEqual({ found: result.found, imported: result.imported, failed: result.failed }, { found: 1, imported: 0, failed: 0 });
    for (const key of REARM_KEYS) assert.equal(dbMgr.getAppState(key), null, 'no meeting arrived, so search has nothing to index');
    assert.deepEqual(remembered(), []);
  });

  test('one meeting that cannot be copied leaves no half meeting and does not hold up the others', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'good-1');
    addLegacyMeeting(db, 'bad', { lines: 3 });
    addLegacyMeeting(db, 'good-2');
    db.close();
    dest.exec(`CREATE TRIGGER refuse_line BEFORE INSERT ON transcripts WHEN NEW.content = 'bad line 2' BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);

    // All three in one batch: the batch rolls back, then each is tried alone.
    const first = await importLegacyMeetings(deps(file));

    assert.deepEqual({ status: first.status, imported: first.imported, failed: first.failed }, { status: 'imported', imported: 2, failed: 1 });
    assert.match(first.reason, /disk full/);
    assert.deepEqual(titles(), ['Meeting good-1', 'Meeting good-2'], 'the meeting after the bad one arrived');
    assert.equal(count(`SELECT COUNT(*) AS n FROM meetings WHERE id = 'bad'`), 0, 'the meeting row was rolled back');
    assert.equal(count(`SELECT COUNT(*) AS n FROM transcripts WHERE meeting_id = 'bad'`), 0, 'with the lines written before the failure');
    assert.equal(count(`SELECT COUNT(*) AS n FROM transcripts WHERE meeting_id = 'good-1'`), 2, 'the rolled-back batch did not double the others');
    assert.deepEqual(remembered(), ['good-1', 'good-2'], 'the bad one is not written off');
    assert.equal(dbMgr.getAppState(LEGACY_IMPORT_SOURCES_KEY), null, 'the source is not marked as read');

    // Still refused on the next launch: the others are not copied twice.
    const second = await importLegacyMeetings(deps(file));
    assert.deepEqual({ status: second.status, imported: second.imported, failed: second.failed }, { status: 'failed', imported: 0, failed: 1 });

    dest.exec('DROP TRIGGER refuse_line');
    const third = await importLegacyMeetings(deps(file));

    assert.deepEqual({ status: third.status, imported: third.imported, failed: third.failed }, { status: 'imported', imported: 1, failed: 0 });
    assert.deepEqual(titles(), ['Meeting bad', 'Meeting good-1', 'Meeting good-2']);
    assert.equal(count(`SELECT COUNT(*) AS n FROM transcripts WHERE meeting_id = 'bad'`), 3);
    assert.notEqual(dbMgr.getAppState(LEGACY_IMPORT_SOURCES_KEY), null);
  });

  test('a file that is not a database is reported, not thrown, and tried again later', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const dir = path.join(appData, 'Natively');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'natively.db');
    fs.writeFileSync(file, 'this is not sqlite');

    const result = await importLegacyMeetings(deps(file));

    assert.equal(result.status, 'unreadable');
    assert.equal(dbMgr.getAppState(LEGACY_IMPORT_SOURCES_KEY), null);
    assert.equal(count('SELECT COUNT(*) AS n FROM meetings'), 0);
  });

  test('each batch is announced so the open list can refresh', async (t) => {
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    for (const id of ['a', 'b', 'c', 'd', 'e']) addLegacyMeeting(db, id);
    db.close();
    const batches = [];
    let pauses = 0;

    await importLegacyMeetings(deps(file, { batchSize: 2, onBatch: (n) => batches.push(n), pause: async () => { pauses++; } }));

    assert.deepEqual(batches, [2, 2, 1]);
    assert.equal(pauses, 3, 'the event loop runs between batches');
  });
});

describe('the old folder as the app finds it on disk', () => {
  beforeEach(() => { appData = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-import-fs-')); });
  afterEach(() => {
    try { dbMgr?.close?.(); } catch {}
    try { delete require.cache[DB_PATH]; } catch {}
    delete process.env.NATIVELY_TEST_USERDATA;
    try { fs.rmSync(appData, { recursive: true, force: true }); } catch {}
  });

  const run = (userData, over = {}) => importLegacyProfiles({
    platform: process.platform, appDataDir: appData, userDataDir: userData, dest, ...over,
  });

  test('the old app re-created "Natively" after the move: its meetings come across and its database is untouched', async (t) => {
    const userData = openDest();
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'));
    addLegacyMeeting(db, 'stranded', { lines: 2, answers: 1 });
    db.close();
    const before = sha(file);
    let announced = 0;

    const results = await run(userData, { onBatch: (n) => { announced += n; } });

    assert.equal(results.length, 1);
    assert.deepEqual({ status: results[0].status, imported: results[0].imported }, { status: 'imported', imported: 1 });
    assert.equal(announced, 1);
    assert.deepEqual(titles(), ['Meeting stranded']);
    assert.equal(sha(file), before, 'the old database file is byte for byte what it was');

    const again = await run(userData);
    assert.equal(again[0].status, 'unchanged', 'the next launch sees the same file and does not open it');
  });

  test('the old app is running and has not checkpointed: what it wrote is still read', async (t) => {
    const userData = openDest();
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'), { wal: true });
    db.pragma('wal_autocheckpoint = 0');
    addLegacyMeeting(db, 'in-the-wal', { lines: 2 });
    assert.ok(fs.statSync(`${file}-wal`).size > 0, 'the meeting is only in the WAL');
    try {
      const results = await run(userData);
      assert.deepEqual({ status: results[0].status, imported: results[0].imported }, { status: 'imported', imported: 1 });
      assert.equal(dbMgr.getMeetingDetails('in-the-wal').transcript.length, 2);

      // It keeps recording while this app runs; the next launch picks that up.
      addLegacyMeeting(db, 'recorded-later');
      const next = await run(userData);
      assert.deepEqual({ status: next[0].status, imported: next[0].imported }, { status: 'imported', imported: 1 });
    } finally {
      db.close();
    }
  });

  // Reading a closed WAL database leaves an empty -wal beside it. That must
  // not make the file look changed, or every launch would read it again.
  test('reading a WAL database that nobody has open does not make it look changed', async (t) => {
    const userData = openDest();
    if (!usable()) return t.skip(NO_SQLITE);
    const { file, db } = makeLegacy(path.join(appData, 'Natively'), { wal: true });
    addLegacyMeeting(db, 'old-1');
    db.close();
    assert.equal(fs.existsSync(`${file}-wal`), false, 'closed cleanly: no WAL on disk');
    const before = sha(file);

    const first = await run(userData);
    const second = await run(userData);

    assert.deepEqual({ status: first[0].status, imported: first[0].imported }, { status: 'imported', imported: 1 });
    assert.equal(second[0].status, 'unchanged');
    assert.equal(sha(file), before);
  });

  test('this app running in the old folder itself imports nothing from itself', async (t) => {
    if (Sqlite === null) return t.skip(NO_SQLITE);
    const userData = path.join(appData, 'Natively');
    fs.mkdirSync(userData, { recursive: true });
    process.env.NATIVELY_TEST_USERDATA = userData;
    try { delete require.cache[DB_PATH]; } catch {}
    dbMgr = require(DB_PATH).DatabaseManager.getInstance();
    dest = dbMgr.getDb();
    if (!usable()) return t.skip(NO_SQLITE);

    assert.deepEqual(await run(userData), []);
  });

  test('no old folder, or no database in it: nothing to do', async (t) => {
    const userData = openDest();
    if (!usable()) return t.skip(NO_SQLITE);
    assert.deepEqual(await run(userData), []);
    fs.mkdirSync(path.join(appData, 'Natively'));
    assert.deepEqual(await run(userData), []);
  });

  test('a closed database is not written to', async (t) => {
    const userData = openDest();
    if (!usable()) return t.skip(NO_SQLITE);
    assert.deepEqual(await run(userData, { dest: null }), []);
  });
});

describe('which folders count as the old profile', () => {
  // A disk described as a map from the path as typed to the path as stored.
  const lookup = (platform, disk, userDataDir) => legacyProfileDatabases({
    platform,
    appDataDir: '/appdata',
    userDataDir,
    join: (...parts) => parts.join('/'),
    exists: (p) => Object.prototype.hasOwnProperty.call(disk, p),
    realpath: (p) => { if (!(p in disk)) throw new Error('ENOENT'); return disk[p]; },
  });

  test('macOS: "Natively" and "natively" are one folder and it is read once', () => {
    const disk = {
      '/appdata/corespeechd': '/appdata/corespeechd',
      '/appdata/Natively': '/appdata/Natively',
      '/appdata/natively': '/appdata/Natively',
      '/appdata/Natively/natively.db': '/appdata/Natively/natively.db',
    };
    assert.deepEqual(lookup('darwin', disk, '/appdata/corespeechd'), ['/appdata/Natively/natively.db']);
  });

  test('Windows: the same folder spelled in another case is the folder in use', () => {
    const disk = {
      '/appdata/Natively': 'C:/Users/u/AppData/Roaming/natively',
      '/appdata/natively': 'C:/Users/u/AppData/Roaming/natively',
      'C:/Users/u/AppData/Roaming/Natively': 'C:/Users/u/AppData/Roaming/Natively',
      'C:/Users/u/AppData/Roaming/natively/natively.db': 'x',
    };
    assert.deepEqual(lookup('win32', disk, 'C:/Users/u/AppData/Roaming/Natively'), []);
  });

  test('Windows: the profile is in "audiodg" and the old app left "Natively"', () => {
    const disk = {
      '/appdata/audiodg': '/appdata/audiodg',
      '/appdata/Natively': '/appdata/Natively',
      '/appdata/natively': '/appdata/Natively',
      '/appdata/Natively/natively.db': 'x',
    };
    assert.deepEqual(lookup('win32', disk, '/appdata/audiodg'), ['/appdata/Natively/natively.db']);
  });

  test('a case-sensitive disk: the pinned "Natively" still reads the lower-case folder older builds used', () => {
    const disk = {
      '/appdata/Natively': '/appdata/Natively',
      '/appdata/natively': '/appdata/natively',
      '/appdata/natively/natively.db': 'x',
    };
    assert.deepEqual(lookup('linux', disk, '/appdata/Natively'), ['/appdata/natively/natively.db']);
  });

  test('a folder with no database in it is not a source', () => {
    const disk = { '/appdata/corespeechd': '/appdata/corespeechd', '/appdata/Natively': '/appdata/Natively', '/appdata/natively': '/appdata/Natively' };
    assert.deepEqual(lookup('darwin', disk, '/appdata/corespeechd'), []);
  });
});

describe('where the import is started', () => {
  const main = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');

  test('only a packaged build imports: a dev or agent profile must not take a developer\'s meetings', () => {
    const at = main.indexOf(`require('./db/legacyMeetingImport')`);
    assert.ok(at > 0, 'main.ts starts the import');
    const guard = main.lastIndexOf('if (app.isPackaged) {', at);
    assert.ok(guard > 0 && at - guard < 400, 'inside an app.isPackaged block');
    assert.match(main.slice(guard, at), /setTimeout\(/, 'and off the boot path: it opens a second database on the main process');
  });

  test('copied meetings are put back in search and the open list is told', () => {
    const at = main.indexOf(`require('./db/legacyMeetingImport')`);
    const block = main.slice(at, at + 1700);
    assert.match(block, /scheduleChunkBackfill\(\)/);
    assert.match(block, /'meetings-updated'/);
  });
});
