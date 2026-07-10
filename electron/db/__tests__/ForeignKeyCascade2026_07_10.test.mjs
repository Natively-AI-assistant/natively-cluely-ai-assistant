// Foreign-key cascade enforcement on the shared connection (2026-07-10).
//
// THE BUG THIS PINS: several delete paths (deleteMeeting, deleteMode,
// deleteKnowledgePack) do a bare parent-row DELETE and rely ENTIRELY on
// `ON DELETE CASCADE` to reap child rows (transcripts, ai_interactions, chunks,
// chunk_summaries). SQLite ships with `foreign_keys` OFF per-connection, so
// those cascades are INERT unless the pragma is enabled. Historically the only
// code that enabled it was the *premium* KnowledgeDatabaseManager constructor —
// so FK enforcement silently depended on the premium submodule loading. If
// premium failed to load (source-available build / packaging regression), every
// meeting/mode/pack delete would orphan its children (unreclaimable disk growth).
//
// THE FIX: DatabaseManager.initialize() now runs `PRAGMA foreign_keys = ON`
// directly on the shared connection, with NO dependency on premium.
//
// This test constructs a bare DatabaseManager (premium is NOT loaded in this
// runner) and asserts (a) the pragma is ON and (b) a parent delete cascades to
// children. Run under `ELECTRON_RUN_AS_NODE=1 electron --test` (native ABI) or
// `node --test` after `npm run build:electron`.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');

let DatabaseManager;
let dbMgr;

describe('DatabaseManager — foreign_keys cascade without premium (2026-07-10)', () => {
  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cascade-test-'));
    process.env.NATIVELY_TEST_USERDATA = tmp;
    try { delete require.cache[DB_PATH]; } catch {}
    DatabaseManager = require(DB_PATH).DatabaseManager;
    dbMgr = DatabaseManager.getInstance();
  });

  afterEach(() => {
    try { dbMgr?.close?.(); } catch {}
    try { delete require.cache[DB_PATH]; } catch {}
    delete process.env.NATIVELY_TEST_USERDATA;
  });

  test('PRAGMA foreign_keys is ON on the shared connection (no premium)', () => {
    if (!dbMgr.isAvailable()) return; // native binding not loadable in this env
    const db = dbMgr.getDb();
    assert.ok(db, 'shared connection should exist');
    const fk = db.pragma('foreign_keys', { simple: true });
    assert.equal(fk, 1, 'foreign_keys must be enabled without the premium module');
  });

  test('a bare meeting parent delete cascades to transcript/RAG child rows', () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();

    const meetingId = 'fk-test-meeting-1';
    db.prepare(
      `INSERT INTO meetings (id, title, start_time, duration_ms) VALUES (?, ?, ?, ?)`
    ).run(meetingId, 'FK test', Date.now(), 1000);

    db.prepare(
      `INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms) VALUES (?, ?, ?, ?)`
    ).run(meetingId, 'user', 'hello', Date.now());
    db.prepare(
      `INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response) VALUES (?, ?, ?, ?, ?)`
    ).run(meetingId, 'answer', Date.now(), 'q', 'a');
    db.prepare(
      `INSERT INTO chunks (meeting_id, chunk_index, cleaned_text, token_count) VALUES (?, ?, ?, ?)`
    ).run(meetingId, 0, 'chunk text', 2);
    db.prepare(
      `INSERT INTO chunk_summaries (meeting_id, summary_text) VALUES (?, ?)`
    ).run(meetingId, 'summary text');

    const childCount = () =>
      db.prepare(`SELECT COUNT(*) AS n FROM transcripts WHERE meeting_id = ?`).get(meetingId).n +
      db.prepare(`SELECT COUNT(*) AS n FROM ai_interactions WHERE meeting_id = ?`).get(meetingId).n +
      db.prepare(`SELECT COUNT(*) AS n FROM chunks WHERE meeting_id = ?`).get(meetingId).n +
      db.prepare(`SELECT COUNT(*) AS n FROM chunk_summaries WHERE meeting_id = ?`).get(meetingId).n;

    assert.equal(childCount(), 4, 'precondition: 4 child rows inserted');

    // Bare parent delete — the exact shape deleteMeeting uses. With FK ON this
    // MUST cascade; with FK OFF (the pre-fix bug) the children would be orphaned.
    db.prepare(`DELETE FROM meetings WHERE id = ?`).run(meetingId);

    assert.equal(childCount(), 0, 'all child rows must be cascaded away by the parent delete');
  });

  test('mode reference file create/delete cascades knowledge-pack children', () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();

    const modeId = 'fk-mode-1';
    const fileId = 'fk-file-1';
    const sourceId = 'fk-source-1';
    const packId = 'fk-pack-1';
    const cardId = 'fk-card-1';

    dbMgr.createMode({ id: modeId, name: 'FK Mode', templateType: 'general', customContext: '' });
    dbMgr.addReferenceFile({ id: fileId, modeId, fileName: 'test.pdf', content: '[Page 1]\nhello', pageCount: 1, extractedPageCount: 1 });
    dbMgr.upsertKnowledgeSource({ id: sourceId, type: 'reference_file', fileId, modeId, fileName: 'test.pdf', sourceChecksum: 'sc', contentHash: 'ch' });
    dbMgr.upsertKnowledgePack({ id: packId, sourceId, modeId, fileName: 'test.pdf', indexMd: '# Index', statsJson: '{}', packVersion: 1, generatedBy: 'test' });
    dbMgr.replaceKnowledgeCards(packId, sourceId, [{
      id: cardId,
      type: 'concept',
      title: 'Card',
      slug: 'card',
      conceptId: 'concept-card',
      body: 'Body',
      sourcePagesJson: '[]',
      sourceSectionsJson: '[]',
      sourceQuotesJson: '[]',
      entitiesJson: '[]',
      tagsJson: '[]',
      relatedCardIdsJson: '[]',
      confidence: 'high',
      generatedFrom: 'test',
      sourceChecksum: 'sc',
      cardVersion: 1,
    }], 'sc');
    dbMgr.replaceKnowledgeEntities(packId, [{ id: 'fk-entity-1', slug: 'entity', name: 'Entity', type: 'concept', aliasesJson: '[]', description: 'Entity', sourceCardIdsJson: JSON.stringify([cardId]), sourcePagesJson: '[]' }]);
    dbMgr.replaceKnowledgeRelations(packId, [{ id: 'fk-relation-1', subjectId: 'a', subjectType: 'concept', predicate: 'relates_to', objectId: 'b', objectType: 'concept', sourceCardIdsJson: JSON.stringify([cardId]), sourcePagesJson: '[]', confidence: 'medium' }]);
    dbMgr.upsertKnowledgeIndexVersion({ id: 'fk-index-1', sourceId, packId, packVersion: 1, contentHash: 'ch', status: 'complete' });
    dbMgr.snapshotKnowledgeCardVersion(cardId, 'test', 'snapshot');

    const countAll = () => ({
      source: db.prepare(`SELECT COUNT(*) AS n FROM knowledge_sources WHERE id = ?`).get(sourceId).n,
      pack: db.prepare(`SELECT COUNT(*) AS n FROM knowledge_packs WHERE id = ?`).get(packId).n,
      card: db.prepare(`SELECT COUNT(*) AS n FROM knowledge_cards WHERE id = ?`).get(cardId).n,
      version: db.prepare(`SELECT COUNT(*) AS n FROM knowledge_card_versions WHERE card_id = ?`).get(cardId).n,
      entity: db.prepare(`SELECT COUNT(*) AS n FROM knowledge_entities WHERE pack_id = ?`).get(packId).n,
      relation: db.prepare(`SELECT COUNT(*) AS n FROM knowledge_relations WHERE pack_id = ?`).get(packId).n,
      indexVersion: db.prepare(`SELECT COUNT(*) AS n FROM knowledge_index_versions WHERE source_id = ?`).get(sourceId).n,
    });

    assert.deepEqual(countAll(), { source: 1, pack: 1, card: 1, version: 1, entity: 1, relation: 1, indexVersion: 1 }, 'precondition: full reference-file knowledge pack graph inserted');

    dbMgr.deleteReferenceFile(fileId);

    assert.deepEqual(countAll(), { source: 0, pack: 0, card: 0, version: 0, entity: 0, relation: 0, indexVersion: 0 }, 'deleting a reference file cascades all OKF knowledge children');
  });

  test('bare mode delete cascades reference files, note sections, and knowledge packs', () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();

    const modeId = 'fk-mode-2';
    const fileId = 'fk-file-2';
    const sourceId = 'fk-source-2';
    const packId = 'fk-pack-2';

    dbMgr.createMode({ id: modeId, name: 'FK Mode 2', templateType: 'general', customContext: '' });
    dbMgr.addNoteSection({ id: 'fk-note-2', modeId, title: 'Notes', description: 'Desc', sortOrder: 0 });
    dbMgr.addReferenceFile({ id: fileId, modeId, fileName: 'test2.pdf', content: 'hello', pageCount: 1, extractedPageCount: 1 });
    dbMgr.upsertKnowledgeSource({ id: sourceId, type: 'reference_file', fileId, modeId, fileName: 'test2.pdf', sourceChecksum: 'sc2', contentHash: 'ch2' });
    dbMgr.upsertKnowledgePack({ id: packId, sourceId, modeId, fileName: 'test2.pdf', indexMd: '# Index', statsJson: '{}', packVersion: 1, generatedBy: 'test' });

    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM modes WHERE id = ?`).get(modeId).n, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM mode_reference_files WHERE mode_id = ?`).get(modeId).n, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM mode_note_sections WHERE mode_id = ?`).get(modeId).n, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM knowledge_sources WHERE mode_id = ?`).get(modeId).n, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM knowledge_packs WHERE mode_id = ?`).get(modeId).n, 1);

    dbMgr.deleteMode(modeId);

    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM modes WHERE id = ?`).get(modeId).n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM mode_reference_files WHERE mode_id = ?`).get(modeId).n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM mode_note_sections WHERE mode_id = ?`).get(modeId).n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM knowledge_sources WHERE mode_id = ?`).get(modeId).n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM knowledge_packs WHERE mode_id = ?`).get(modeId).n, 0);
  });
});
