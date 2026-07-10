// electron/rag/__tests__/EmbeddingMigrationLive.test.mjs
//
// Runs the REAL compiled DatabaseManager.runMigrations() (the genuine v0→v16 chain,
// including the v16 embedding_space backfill built from the shared LEGACY_PROVIDER_MODEL
// map) against an on-DISK temp file DB — NOT the verbatim-SQL replica the existing
// EmbeddingSpaceMigration.test.mjs uses, and NOT :memory:, so persistence + idempotency
// across "re-launches" is genuinely exercised.
//
// How we invoke the real method without the provider-/electron-heavy constructor:
//   DatabaseManager's constructor calls app.getPath('userData') (unavailable under
//   ELECTRON_RUN_AS_NODE) and loads the sqlite-vec extension (dlopen aborts the process
//   in this test env). So we build the instance via Object.create(prototype), attach a
//   real file-backed better-sqlite3 handle + the ensuredDims cache, and call the genuine
//   compiled runMigrations() directly. The vec0 CREATE VIRTUAL TABLE calls in the v8/v9
//   migrations fail-soft (no extension) inside ensureVecTableForDim's try/catch, exactly
//   as they would on a machine where sqlite-vec didn't load — the migration still
//   completes and reaches user_version 16.
//
// Covers mandate #2: realistic mixed-row DB, post-migration state, RE-RUN idempotency
// (no double-application, no clobbering), and user_version >= 16.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dmPath = path.resolve(__dirname, '../../../dist-electron/electron/db/DatabaseManager.js');
const { DatabaseManager } = await import(pathToFileURL(dmPath).href);

const SPACE_V2 = 'gemini:gemini-embedding-2:768';

function newDM(db) {
  const dm = Object.create(DatabaseManager.prototype);
  dm.db = db;
  dm.ensuredDims = new Set();
  return dm;
}

function cleanup(file) {
  for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(file + ext); } catch { /* ignore */ } }
}

describe('REAL v0→v16 migration on a persisted file DB (mandate #2)', () => {
  let file, db;

  beforeEach(() => {
    file = path.join(os.tmpdir(), `miglive_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    db = new Database(file);
    db.pragma('journal_mode = WAL');
    // Stand the DB up at exactly user_version 15 with the v15 schema shape the real
    // migration expects (meetings has embedding_provider/embedding_dimensions but NOT
    // embedding_space yet). We seed via the real v0→v15 chain, then plant mixed rows.
    const dm = newDM(db);
    // Run the real chain ONCE to materialize the full v15 schema, then reset to 15 so
    // the v16 arm runs against authentic tables (chunks/chunk_summaries/etc.).
    dm.runMigrations();
    // Sanity: the real chain reached 16 already; we now simulate a DB that PRE-DATES v16
    // by dropping the column + index and rewinding the version to 15.
    // (SQLite can't DROP COLUMN on very old versions, but this build supports it.)
    try { db.exec('DROP INDEX IF EXISTS idx_meetings_embedding_space'); } catch { /* */ }
    try { db.exec('ALTER TABLE meetings DROP COLUMN embedding_space'); } catch (e) {
      // If DROP COLUMN unsupported, recreate via NULLing — but modern sqlite supports it.
      throw new Error('Test setup requires SQLite DROP COLUMN support: ' + e.message);
    }
    db.pragma('user_version = 15');

    // ── Mixed realistic rows (all is_processed=1 unless noted) ──
    const insM = db.prepare(
      `INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, source, is_processed, embedding_provider, embedding_dimensions)
       VALUES (?, ?, 0, 0, '{}', ?, 'manual', ?, ?, ?)`
    );
    insM.run('gem768', 'g', '2026-05-01', 1, 'gemini', 768);     // legacy gemini v1
    insM.run('oll768', 'o', '2026-05-02', 1, 'ollama', 768);     // ollama (same dims, diff provider)
    insM.run('oai1536', 'a', '2026-05-03', 1, 'openai', 1536);   // openai
    insM.run('loc384', 'l', '2026-05-04', 1, 'local', 384);      // local minilm
    insM.run('nullprov', 'n', '2026-05-05', 1, null, null);      // NULL provider, but HAS chunks
    insM.run('nulleverything', 'z', '2026-05-06', 1, null, null);// NULL provider, NO embeddings
    insM.run('unproc', 'u', '2026-05-07', 0, 'gemini', 768);     // is_processed=0 (live placeholder)
    insM.run('mystery', 'm', '2026-05-08', 1, 'cohere', 1024);   // UNKNOWN provider (not in CASE map)

    // chunks/embeddings: give the rows that should carry embeddings a non-NULL blob.
    const insChunk = db.prepare(
      `INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding)
       VALUES (?, 0, 'A', 0, 1, 'text', 1, ?)`
    );
    const blob768 = Buffer.alloc(768 * 4);
    for (const id of ['gem768', 'oll768', 'unproc', 'mystery']) insChunk.run(id, blob768);
    insChunk.run('oai1536', Buffer.alloc(1536 * 4));
    insChunk.run('loc384', Buffer.alloc(384 * 4));
    insChunk.run('nullprov', blob768); // NULL-provider WITH embeddings (the critical sweep case)
    // nulleverything: a chunk row but NULL embedding (nothing to rebuild)
    db.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding)
                VALUES ('nulleverything', 0, 'A', 0, 1, 't', 1, NULL)`).run();
  });

  afterEach(() => { db.close(); cleanup(file); });

  test('user_version ends at >= 16 after applying v16', () => {
    newDM(db).runMigrations();
    assert.ok(db.pragma('user_version', { simple: true }) >= 16);
  });

  test('embedding_space column is added + backfilled from the shared CASE map', () => {
    newDM(db).runMigrations();
    const get = (id) => db.prepare('SELECT embedding_space FROM meetings WHERE id=?').get(id).embedding_space;
    assert.equal(get('gem768'), 'gemini:gemini-embedding-001:768');
    assert.equal(get('oll768'), 'ollama:nomic-embed-text:768');
    assert.equal(get('oai1536'), 'openai:text-embedding-3-small:1536');
    assert.equal(get('loc384'), 'local:xenova/all-minilm-l6-v2:384');
  });

  test('UNKNOWN provider (not in CASE map) backfills to "<name>:unknown:<dims>"', () => {
    newDM(db).runMigrations();
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='mystery'").get().embedding_space, 'cohere:unknown:1024');
  });

  test('NULL-provider rows are LEFT NULL by backfill (provider IS NOT NULL guard)', () => {
    newDM(db).runMigrations();
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='nullprov'").get().embedding_space, null);
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='nulleverything'").get().embedding_space, null);
  });

  test('is_processed=0 row STILL gets backfilled (backfill is independent of processed state) but is excluded from the reindex sweep', () => {
    newDM(db).runMigrations();
    // Backfill keys on provider, not processed-state:
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='unproc'").get().embedding_space, 'gemini:gemini-embedding-001:768');
    // But the reindex predicate requires is_processed=1, so unproc is NOT swept:
    const cnt = db.prepare(`
      SELECT COUNT(*) c FROM meetings m WHERE m.is_processed=1
      AND ((m.embedding_space IS NOT NULL AND m.embedding_space != ?)
           OR (m.embedding_space IS NULL AND EXISTS(SELECT 1 FROM chunks c WHERE c.meeting_id=m.id AND c.embedding IS NOT NULL)))
      AND m.id='unproc'
    `).get(SPACE_V2).c;
    assert.equal(cnt, 0, 'unprocessed placeholder must never be swept');
  });

  test('the v16 index idx_meetings_embedding_space exists after migration', () => {
    newDM(db).runMigrations();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_meetings_embedding_space'").get();
    assert.ok(idx, 'composite-space index must be created');
  });

  test('RE-RUN (simulated relaunch) is idempotent: no double-application, no clobber', () => {
    const dm = newDM(db);
    dm.runMigrations(); // first apply → 16
    // Snapshot every meeting's space after first run.
    const snapAfterFirst = db.prepare('SELECT id, embedding_space FROM meetings ORDER BY id').all();
    // Simulate a meeting being re-embedded in the active v2 space between launches.
    db.prepare("UPDATE meetings SET embedding_space=? WHERE id='gem768'").run(SPACE_V2);

    // Re-run migrations (fresh DatabaseManager, same on-disk DB) — v16 arm must NOT
    // re-fire because user_version is already 16, AND even if the backfill SQL ran it
    // is gated on `embedding_space IS NULL` so it cannot clobber the v2 stamp.
    const dm2 = newDM(db);
    dm2.runMigrations();
    assert.equal(db.pragma('user_version', { simple: true }), 24, 'version stays 24');
    assert.equal(
      db.prepare("SELECT embedding_space FROM meetings WHERE id='gem768'").get().embedding_space,
      SPACE_V2,
      'a row re-stamped to the active space between launches must NOT be reverted by re-migration'
    );
    // Every other row unchanged from the first apply.
    const snapAfterSecond = db.prepare('SELECT id, embedding_space FROM meetings ORDER BY id').all();
    for (const r of snapAfterSecond) {
      if (r.id === 'gem768') continue;
      const before = snapAfterFirst.find(x => x.id === r.id);
      assert.equal(r.embedding_space, before.embedding_space, `row ${r.id} must be stable across re-migration`);
    }
  });

  test('post-migration, flipping active space to v2 sweeps exactly the right rows', () => {
    newDM(db).runMigrations();
    const ids = db.prepare(`
      SELECT m.id FROM meetings m WHERE m.is_processed=1
      AND ((m.embedding_space IS NOT NULL AND m.embedding_space != ?)
           OR (m.embedding_space IS NULL AND (
                EXISTS(SELECT 1 FROM chunks c WHERE c.meeting_id=m.id AND c.embedding IS NOT NULL)
                OR EXISTS(SELECT 1 FROM chunk_summaries s WHERE s.meeting_id=m.id AND s.embedding IS NOT NULL))))
      ORDER BY m.id
    `).all(SPACE_V2).map(r => r.id).sort();
    // Should sweep: gem768, oll768, oai1536, loc384 (known-incompatible) + mystery
    // (incompatible 'cohere:unknown:1024') + nullprov (NULL space WITH embeddings).
    // Should NOT sweep: nulleverything (NULL space, NO embeddings), unproc (is_processed=0).
    assert.deepEqual(ids, ['gem768', 'loc384', 'mystery', 'nullprov', 'oai1536', 'oll768']);
  });

  test('data persists across a CLOSE+REOPEN of the file (not :memory:)', () => {
    newDM(db).runMigrations();
    db.close();
    // Reopen the SAME file — proves the ALTER + backfill were durably committed.
    const db2 = new Database(file);
    try {
      assert.equal(db2.pragma('user_version', { simple: true }), 24);
      assert.equal(db2.prepare("SELECT embedding_space FROM meetings WHERE id='gem768'").get().embedding_space, 'gemini:gemini-embedding-001:768');
    } finally {
      db2.close();
      // Reassign so afterEach's db.close() on the original (already closed) handle is harmless.
      db = db2;
    }
  });
});
