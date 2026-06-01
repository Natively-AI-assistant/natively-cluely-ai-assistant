// electron/rag/__tests__/EmbeddingSpaceMigration.test.mjs
//
// Integration test against a REAL SQLite engine proving the v15→v16 migration
// backfill + the space-based incompatibility predicate behave end-to-end:
//   1. A legacy DB (gemini v1, no embedding_space column) gets backfilled to
//      'gemini:gemini-embedding-001:768'.
//   2. With v1 still active → incompatible count is 0 (migration is INERT — no
//      spurious re-index of already-correct data).
//   3. With v2 active (gemini:gemini-embedding-2:768) → count flips to the number
//      of legacy meetings → auto-reindex fires.
//   4. The reindex SELECTION predicate also sweeps NULL-space rows that still
//      have embeddings (unknown space → must re-embed, never trust).
//   5. The CASE arms are built from the SAME shared map (LEGACY_PROVIDER_MODEL)
//      the runtime uses, so backfill and runtime key can't drift.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingSpace.js');
const { LEGACY_PROVIDER_MODEL, legacySpaceForProvider, buildLegacySpaceCaseSql } = await import(pathToFileURL(modPath).href);

// --- v16 backfill CASE from the SAME shared function DatabaseManager uses ---
// (not a re-implementation — this is the actual exported builder, so a drift between
// the migration SQL and the runtime key would surface here).
const caseArms = buildLegacySpaceCaseSql();
const V16_BACKFILL = `
  UPDATE meetings
  SET embedding_space =
      embedding_provider || ':' ||
      CASE embedding_provider
        ${caseArms}
        ELSE 'unknown'
      END || ':' ||
      COALESCE(CAST(embedding_dimensions AS TEXT), 'unknown')
  WHERE embedding_provider IS NOT NULL
    AND embedding_space IS NULL;
`;

// --- verbatim predicates (VectorStore.ts: getIncompatibleSpaceCount / getMeetingIdsNeedingReindex) ---
const INCOMPATIBLE_COUNT = `
  SELECT COUNT(*) as count FROM meetings m
  WHERE m.is_processed = 1
  AND (
      (m.embedding_space IS NOT NULL AND m.embedding_space != ?)
      OR (m.embedding_space IS NULL AND (
          EXISTS (SELECT 1 FROM chunks c WHERE c.meeting_id = m.id AND c.embedding IS NOT NULL)
          OR EXISTS (SELECT 1 FROM chunk_summaries s WHERE s.meeting_id = m.id AND s.embedding IS NOT NULL)
      ))
  )
`;
const REINDEX_IDS = `
  SELECT m.id FROM meetings m
  WHERE m.is_processed = 1
  AND (
      (m.embedding_space IS NOT NULL AND m.embedding_space != ?)
      OR (m.embedding_space IS NULL AND (
          EXISTS (SELECT 1 FROM chunks c WHERE c.meeting_id = m.id AND c.embedding IS NOT NULL)
          OR EXISTS (SELECT 1 FROM chunk_summaries s WHERE s.meeting_id = m.id AND s.embedding IS NOT NULL)
      ))
  )
  ORDER BY m.created_at DESC
`;

const SPACE_V1 = 'gemini:gemini-embedding-001:768';
const SPACE_V2 = 'gemini:gemini-embedding-2:768';

describe('v16 migration + space predicate (real SQLite)', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        is_processed INTEGER DEFAULT 1,
        embedding_provider TEXT,
        embedding_dimensions INTEGER
      );
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT,
        embedding BLOB
      );
      CREATE TABLE chunk_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT,
        embedding BLOB
      );
    `);
    // m1,m2,m3: legacy gemini-v1, processed, with embedded chunks.
    for (const [id, ts] of [['m1', '2026-05-01'], ['m2', '2026-05-03'], ['m3', '2026-05-02']]) {
      db.prepare("INSERT INTO meetings (id, created_at, is_processed, embedding_provider, embedding_dimensions) VALUES (?,?,1,'gemini',768)").run(id, ts);
      db.prepare("INSERT INTO chunks (meeting_id, embedding) VALUES (?, x'00')").run(id);
    }
    // m4: never-processed (live placeholder) — must be excluded from reindex sweep.
    db.prepare("INSERT INTO meetings (id, created_at, is_processed, embedding_provider, embedding_dimensions) VALUES ('m4','2026-05-04',0,NULL,NULL)").run();
  });

  afterEach(() => db.close());

  function runV16() {
    db.exec('ALTER TABLE meetings ADD COLUMN embedding_space TEXT');
    db.exec(V16_BACKFILL);
  }

  test('backfill synthesizes the v1 space for legacy rows (matches legacySpaceForProvider)', () => {
    runV16();
    const rows = db.prepare("SELECT id, embedding_space FROM meetings WHERE embedding_provider IS NOT NULL ORDER BY id").all();
    for (const r of rows) {
      assert.equal(r.embedding_space, SPACE_V1, `row ${r.id}`);
      assert.equal(r.embedding_space, legacySpaceForProvider('gemini', 768), 'CASE map must equal legacySpaceForProvider');
    }
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='m4'").get().embedding_space, null);
  });

  test('DRIFT GUARD: buildLegacySpaceCaseSql backfill == legacySpaceForProvider for EVERY provider', () => {
    // Insert one processed meeting per known provider, run the real shared-function
    // CASE, and assert each backfilled space equals legacySpaceForProvider(name, dims).
    // This is what makes "the migration CASE and the runtime key can't drift" a
    // tested guarantee rather than a hope — both flow through buildLegacySpaceCaseSql.
    const dimsByProvider = { gemini: 768, ollama: 768, openai: 1536, local: 384 };
    let i = 100;
    for (const [name, dims] of Object.entries(dimsByProvider)) {
      const id = `p${i++}`;
      db.prepare("INSERT INTO meetings (id, created_at, is_processed, embedding_provider, embedding_dimensions) VALUES (?,?,1,?,?)").run(id, '2026-01-01', name, dims);
    }
    runV16();
    for (const [name, dims] of Object.entries(dimsByProvider)) {
      const idLike = `p%`;
      const row = db.prepare("SELECT embedding_space FROM meetings WHERE embedding_provider = ? AND id LIKE ?").get(name, idLike);
      assert.equal(row.embedding_space, legacySpaceForProvider(name, dims), `${name} backfill must equal legacySpaceForProvider`);
    }
  });

  test('migration is INERT while v1 stays active (count = 0)', () => {
    runV16();
    assert.equal(db.prepare(INCOMPATIBLE_COUNT).get(SPACE_V1).count, 0);
  });

  test('flipping to v2 makes all 3 processed legacy meetings incompatible', () => {
    runV16();
    assert.equal(db.prepare(INCOMPATIBLE_COUNT).get(SPACE_V2).count, 3);
  });

  test('never-processed meeting is NOT swept into re-index', () => {
    runV16();
    const ids = db.prepare(REINDEX_IDS).all(SPACE_V2).map(r => r.id);
    assert.ok(!ids.includes('m4'));
  });

  test('reindex ids are returned most-recent-first', () => {
    runV16();
    const ids = db.prepare(REINDEX_IDS).all(SPACE_V2).map(r => r.id);
    assert.deepEqual(ids, ['m2', 'm3', 'm1']); // 05-03 > 05-02 > 05-01
  });

  test('NULL-space row WITH embeddings is swept (the CRITICAL #1 fix)', () => {
    runV16();
    // Simulate a legacy meeting that has embeddings but whose space was never
    // stamped (NULL provider path). It MUST be re-indexed, not trusted.
    db.prepare("INSERT INTO meetings (id, created_at, is_processed, embedding_provider, embedding_dimensions, embedding_space) VALUES ('m5','2026-05-05',1,NULL,NULL,NULL)").run();
    db.prepare("INSERT INTO chunks (meeting_id, embedding) VALUES ('m5', x'00')").run();
    const ids = db.prepare(REINDEX_IDS).all(SPACE_V2).map(r => r.id);
    assert.ok(ids.includes('m5'), 'NULL-space-with-embeddings must be swept for re-index');
  });

  test('NULL-space row WITHOUT embeddings is NOT swept (nothing to rebuild)', () => {
    runV16();
    // m6: no provider, no embeddings (e.g. never embedded). Excluded.
    db.prepare("INSERT INTO meetings (id, created_at, is_processed, embedding_provider, embedding_dimensions, embedding_space) VALUES ('m6','2026-05-06',1,NULL,NULL,NULL)").run();
    const ids = db.prepare(REINDEX_IDS).all(SPACE_V2).map(r => r.id);
    assert.ok(!ids.includes('m6'));
  });

  test('NULL-space row matched only via summary embedding is swept', () => {
    runV16();
    db.prepare("INSERT INTO meetings (id, created_at, is_processed, embedding_provider, embedding_dimensions, embedding_space) VALUES ('m7','2026-05-07',1,NULL,NULL,NULL)").run();
    db.prepare("INSERT INTO chunk_summaries (meeting_id, embedding) VALUES ('m7', x'00')").run();
    const ids = db.prepare(REINDEX_IDS).all(SPACE_V2).map(r => r.id);
    assert.ok(ids.includes('m7'), 'summary-only embedded meeting must be swept');
  });

  test('idempotent backfill: re-run does not clobber an already-set space', () => {
    runV16();
    db.prepare("UPDATE meetings SET embedding_space=? WHERE id='m1'").run(SPACE_V2);
    db.exec(V16_BACKFILL); // re-run
    assert.equal(db.prepare("SELECT embedding_space FROM meetings WHERE id='m1'").get().embedding_space, SPACE_V2);
  });
});
