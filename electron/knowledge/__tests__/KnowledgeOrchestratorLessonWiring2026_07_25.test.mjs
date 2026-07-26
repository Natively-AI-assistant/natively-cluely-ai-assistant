// electron/knowledge/__tests__/KnowledgeOrchestratorLessonWiring2026_07_25.test.mjs
//
// Tier 0 stub-inject: proves KnowledgeOrchestrator.queryRelevantChunks wires
// embedFn → db.queryChunksByEmbedding for DocType.LESSON.
//
// Real SQLite in a temp NATIVELY_TEST_USERDATA dir (not mocked). Fake embedFn
// returns a fixed vector; no network, no real LLM, no embedding provider.
//
// Run: npm run build:electron && node --test electron/knowledge/__tests__/KnowledgeOrchestratorLessonWiring2026_07_25.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distKnowledge = path.resolve(__dirname, '../../../dist-electron/electron/knowledge');

const { KnowledgeDatabaseManager } = await import(
  pathToFileURL(path.join(distKnowledge, 'KnowledgeDatabaseManager.js')).href
);
const { KnowledgeOrchestrator } = await import(
  pathToFileURL(path.join(distKnowledge, 'KnowledgeOrchestrator.js')).href
);
const { DocType } = await import(pathToFileURL(path.join(distKnowledge, 'types.js')).href);

/** Fixed 8-d query/chunk vector — cosine similarity with itself is 1.0. */
const FIXED_VEC = Object.freeze([1, 0, 0, 0, 0, 0, 0, 0]);
/** Orthogonal distractor vector for non-LESSON chunks. */
const OTHER_VEC = Object.freeze([0, 1, 0, 0, 0, 0, 0, 0]);
const SPACE_KEY = 'test:fake-embed:8';
const LESSON_TEXT =
  'Use consistent hashing to shard a URL shortener across cache nodes.';
const RESUME_TEXT = 'Jordan Lee — Software Engineer at Acme Corp.';
const JD_TEXT = 'Looking for a backend engineer with Redis experience.';
const REFERENCE_TEXT = 'Company handbook: remote work policy.';

/** Mirror DatabaseManager migration v26 knowledge tables (JS cosine path; no vec0). */
function createKnowledgeSchema(db) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type TEXT NOT NULL,
      file_path TEXT,
      file_name TEXT,
      raw_text TEXT NOT NULL DEFAULT '',
      structured_data TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB,
      embedding_provider TEXT,
      embedding_dimensions INTEGER,
      embedding_space TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
    );
  `);
}

function seedDocWithChunk(kdb, { docType, filePath, rawText, chunkText, embedding }) {
  const documentId =
    docType === DocType.LESSON
      ? kdb.appendDocument({ docType, filePath, fileName: path.basename(filePath), rawText })
      : kdb.upsertDocument({ docType, filePath, fileName: path.basename(filePath), rawText });
  kdb.saveChunks(documentId, [
    {
      chunkIndex: 0,
      text: chunkText,
      embedding: [...embedding],
      embeddingDimensions: embedding.length,
      embeddingSpace: SPACE_KEY,
    },
  ]);
}

describe('KnowledgeOrchestrator.queryRelevantChunks — LESSON wiring', () => {
  let tmpDir;
  let rawDb;
  let kdb;
  let orch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-lesson-wiring-'));
    process.env.NATIVELY_TEST_USERDATA = tmpDir;

    const dbPath = path.join(tmpDir, 'natively.db');
    rawDb = new Database(dbPath);
    createKnowledgeSchema(rawDb);
    kdb = new KnowledgeDatabaseManager(rawDb);

    // LESSON at FIXED_VEC; other doc types at OTHER_VEC (and one RESUME with
    // FIXED_VEC) so LESSON scope cannot leak resume/jd/reference hits.
    seedDocWithChunk(kdb, {
      docType: DocType.LESSON,
      filePath: '/lessons/url-shortener.md',
      rawText: LESSON_TEXT,
      chunkText: LESSON_TEXT,
      embedding: FIXED_VEC,
    });
    seedDocWithChunk(kdb, {
      docType: DocType.RESUME,
      filePath: '/profile/resume.txt',
      rawText: RESUME_TEXT,
      chunkText: RESUME_TEXT,
      embedding: FIXED_VEC, // same vector — must still be filtered by docType
    });
    seedDocWithChunk(kdb, {
      docType: DocType.JD,
      filePath: '/profile/jd.txt',
      rawText: JD_TEXT,
      chunkText: JD_TEXT,
      embedding: OTHER_VEC,
    });
    seedDocWithChunk(kdb, {
      docType: DocType.REFERENCE,
      filePath: '/refs/handbook.md',
      rawText: REFERENCE_TEXT,
      chunkText: REFERENCE_TEXT,
      embedding: OTHER_VEC,
    });

    orch = new KnowledgeOrchestrator(kdb);
  });

  afterEach(() => {
    try {
      rawDb?.close?.();
    } catch {
      /* ignore */
    }
    delete process.env.NATIVELY_TEST_USERDATA;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('embedFn wired + matching LESSON chunk → returns expected text (≥1)', async () => {
    orch.setEmbedFn(async () => [...FIXED_VEC]);
    orch.setActiveSpaceFn(() => SPACE_KEY);

    const results = await orch.queryRelevantChunks('design a URL shortener', DocType.LESSON, 5);

    assert.ok(results.length >= 1, `expected ≥1 LESSON hit, got ${results.length}`);
    assert.ok(
      results.some((r) => r.text.includes('consistent hashing')),
      'expected LESSON chunk text in results',
    );
    assert.ok(
      results.every((r) => r.docType === DocType.LESSON),
      'LESSON scope must not return RESUME/JD/REFERENCE chunks',
    );
    assert.ok(
      !results.some((r) => /Jordan Lee|backend engineer|Company handbook/i.test(r.text)),
      'non-LESSON chunk text must not appear under LESSON scope',
    );
  });

  test('embedFn null → returns [] (silent degradation, does not throw)', async () => {
    orch.setActiveSpaceFn(() => SPACE_KEY);
    // intentionally leave embedFn unset

    let threw = false;
    let results;
    try {
      results = await orch.queryRelevantChunks('design a URL shortener', DocType.LESSON, 5);
    } catch (e) {
      threw = true;
      results = e;
    }

    assert.equal(threw, false, 'must not throw when embedFn is null');
    assert.deepEqual(results, []);
  });

  test('activeSpaceFn returns null → returns [] (cross-space guard)', async () => {
    orch.setEmbedFn(async () => [...FIXED_VEC]);
    orch.setActiveSpaceFn(() => null);

    const results = await orch.queryRelevantChunks('design a URL shortener', DocType.LESSON, 5);
    assert.deepEqual(results, []);
  });
});
