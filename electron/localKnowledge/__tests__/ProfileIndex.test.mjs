// Tests for profile document storage and retrieval (task 6).
//
// These run against a real SQLite file rather than a mock, because the
// behaviour worth testing is the storage contract: replace-on-reupload, and a
// delete that takes the document and its vectors together or not at all. A
// mock would assert that the code calls the statements it already calls.
//
// The embedding pipeline is not exercised. Building a real one loads an
// embedding model, and the module's own rule is that it must never construct a
// pipeline itself, so the paths under test here are the ones that run before
// or without one.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dist = (rel) => path.join(repoRoot, 'dist-electron/electron/localKnowledge', rel);

const Database = require(path.join(repoRoot, 'node_modules/better-sqlite3'));
const { ProfileIndex, profileFileId, PROFILE_MODE_ID } = require(dist('ProfileIndex.js'));
const { DocType } = require(dist('types.js'));

let dir;
let db;
let index;

const makeDocument = (docType, overrides = {}) => ({
  docType,
  filePath: `/Users/example/Documents/${docType}.pdf`,
  fileName: `${docType}.pdf`,
  extension: '.pdf',
  content: 'Staff Engineer at Northwind Systems. Owned the rate-limiting platform.',
  binarySha256: 'a'.repeat(64),
  contentSha256: 'b'.repeat(64),
  pageCount: 1,
  extractedPageCount: 1,
  ingestedAt: 1_755_000_000_000,
  ...overrides,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-profileindex-'));
  db = new Database(path.join(dir, 'test.db'));
  index = new ProfileIndex({ db, dbPath: path.join(dir, 'test.db') });
});

afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('storing a profile document', () => {
  test('stores and reads back every field', async () => {
    const result = await index.put(makeDocument(DocType.RESUME));
    assert.equal(result.stored, true);

    const stored = index.get(DocType.RESUME);
    assert.equal(stored.fileName, 'resume.pdf');
    assert.equal(stored.extension, '.pdf');
    assert.equal(stored.pageCount, 1);
    assert.equal(stored.ingestedAt, 1_755_000_000_000);
    assert.match(stored.content, /Northwind/);
  });

  test('stores the structured profile alongside the text', async () => {
    await index.put(makeDocument(DocType.RESUME), {
      structured_data: { name: 'Marcus J. Holloway', experience: [{ role: 'Staff Engineer' }] },
      extractionMode: 'local_llm',
    });

    const stored = index.get(DocType.RESUME);
    assert.equal(stored.structuredData.name, 'Marcus J. Holloway');
    assert.equal(stored.extractionMode, 'local_llm');
  });

  test('re-uploading replaces the document rather than adding a second one', async () => {
    await index.put(makeDocument(DocType.RESUME, { fileName: 'old.pdf', content: 'old text' }));
    await index.put(makeDocument(DocType.RESUME, { fileName: 'new.pdf', content: 'new text' }));

    const all = index.getAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].fileName, 'new.pdf');
    assert.equal(all[0].content, 'new text');
  });

  test('keeps the resume and the job description as separate documents', async () => {
    await index.put(makeDocument(DocType.RESUME));
    await index.put(makeDocument(DocType.JD));

    assert.equal(index.getAll().length, 2);
    assert.ok(index.get(DocType.RESUME));
    assert.ok(index.get(DocType.JD));
  });

  test('reports that indexing did not happen when no embedding pipeline exists', async () => {
    // Storing must still succeed. The document is saved and answerable
    // lexically; only the vectors are missing.
    const result = await index.put(makeDocument(DocType.RESUME));
    assert.equal(result.stored, true);
    assert.equal(result.embedded, false);
    assert.match(result.reason, /embedding pipeline/i);
  });

  test('survives a structured_json value that is not valid JSON', async () => {
    await index.put(makeDocument(DocType.RESUME));
    db.prepare('UPDATE local_profile_documents SET structured_json = ? WHERE doc_type = ?')
      .run('{ truncated', DocType.RESUME);

    const stored = index.get(DocType.RESUME);
    assert.equal(stored.structuredData, null);
    // The document text must remain usable regardless.
    assert.match(stored.content, /Northwind/);
  });
});

describe('deleting a profile document', () => {
  /** Create the engine's tables and a chunk row, as a real index would. */
  const seedChunks = (fileId) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mode_reference_chunks (
        file_id TEXT, chunk_index INTEGER, text TEXT, embedding BLOB, embedding_space TEXT
      );
      CREATE TABLE IF NOT EXISTS mode_reference_index_state (
        file_id TEXT PRIMARY KEY, status TEXT, file_hash TEXT, embedding_space TEXT, chunk_count INTEGER
      );
    `);
    db.prepare('INSERT INTO mode_reference_chunks (file_id, chunk_index, text) VALUES (?, ?, ?)')
      .run(fileId, 0, 'chunk text');
    db.prepare('INSERT INTO mode_reference_index_state (file_id, status) VALUES (?, ?)')
      .run(fileId, 'ready');
  };

  const countChunks = (fileId) =>
    db.prepare('SELECT COUNT(*) AS n FROM mode_reference_chunks WHERE file_id = ?').get(fileId).n;

  test('removes the document and its vectors together', async () => {
    await index.put(makeDocument(DocType.RESUME));
    const fileId = profileFileId(DocType.RESUME);
    seedChunks(fileId);
    assert.equal(countChunks(fileId), 1);

    assert.equal(index.deleteByType(DocType.RESUME), true);
    assert.equal(index.get(DocType.RESUME), null);
    assert.equal(countChunks(fileId), 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM mode_reference_index_state WHERE file_id = ?').get(fileId).n,
      0,
    );
  });

  test('leaves the other document untouched', async () => {
    await index.put(makeDocument(DocType.RESUME));
    await index.put(makeDocument(DocType.JD));
    seedChunks(profileFileId(DocType.RESUME));
    seedChunks(profileFileId(DocType.JD));

    index.deleteByType(DocType.RESUME);

    assert.equal(index.get(DocType.JD).fileName, 'jd.pdf');
    assert.equal(countChunks(profileFileId(DocType.JD)), 1);
  });

  test('deletes a document stored before any vectors existed', async () => {
    // The engine creates its tables only once an embedding pipeline exists, so
    // this path runs with those tables absent. Issuing the delete anyway would
    // throw "no such table" and abort the whole transaction.
    await index.put(makeDocument(DocType.RESUME));
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'mode_reference_chunks'").get().n,
      0,
      'precondition: the engine tables must not exist',
    );

    assert.equal(index.deleteByType(DocType.RESUME), true);
    assert.equal(index.get(DocType.RESUME), null);
  });

  test('reports false when there was nothing to delete', () => {
    assert.equal(index.deleteByType(DocType.JD), false);
  });
});

describe('status and retrieval preconditions', () => {
  test('status reports which documents are present', async () => {
    let status = index.getStatus();
    assert.equal(status.hasResume, false);
    assert.equal(status.hasJD, false);
    assert.equal(status.embeddingReady, false);

    await index.put(makeDocument(DocType.RESUME));
    status = index.getStatus();
    assert.equal(status.hasResume, true);
    assert.equal(status.hasJD, false);
    assert.equal(status.documents[0].fileName, 'resume.pdf');
    assert.equal(status.documents[0].indexStatus, 'pending');
  });

  test('retrieval returns null when nothing is stored', async () => {
    assert.equal(await index.retrieve('what did I do at Northwind'), null);
  });

  test('retrieval returns null while no embedding pipeline has been supplied', async () => {
    // Null means "no grounding available", which the caller treats as an
    // ungrounded turn rather than as an error.
    await index.put(makeDocument(DocType.RESUME));
    assert.equal(await index.retrieve('what did I do at Northwind'), null);
  });
});

describe('identifiers', () => {
  test('file ids are stable per document type', () => {
    assert.equal(profileFileId(DocType.RESUME), 'local-profile-resume');
    assert.equal(profileFileId(DocType.JD), 'local-profile-jd');
    // Stability is what makes a re-upload replace the previous index rather
    // than accumulate a second copy of the vectors.
    assert.equal(profileFileId(DocType.RESUME), profileFileId(DocType.RESUME));
  });

  test('the reserved mode id cannot collide with a real mode', () => {
    assert.equal(PROFILE_MODE_ID, '__local_profile__');
  });
});
