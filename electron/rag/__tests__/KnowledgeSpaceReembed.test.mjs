// electron/rag/__tests__/KnowledgeSpaceReembed.test.mjs
//
// CRITICAL fix verification: the premium knowledge base (resume/JD grounding) must
// NOT compare v1 node vectors against v2 query vectors. gemini-embedding-001 and
// gemini-embedding-2 are both 768d, so the old dimension-only guard could not catch
// it — same silent-garbage hazard as meetings, on the most user-visible surface.
//
// This test drives the REAL compiled KnowledgeDatabaseManager:
//   - context_nodes persists + reads embedding_space
//   - getNodesNeedingReembed sweeps nodes in an OLD space AND legacy NULL-space-with-embedding
//   - updateNodeEmbedding rewrites embedding + space in place
// plus the embeddingSpace key helpers used to stamp them.
//
// Run under Electron ABI: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kdbPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js');
const esPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingSpace.js');
const { KnowledgeDatabaseManager } = await import(pathToFileURL(kdbPath).href);
const { embeddingSpaceKey } = await import(pathToFileURL(esPath).href);

const SPACE_V1 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 768 });
const SPACE_V2 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 768 });

function vec(fill) { return new Array(768).fill(fill); }

describe('Knowledge base embedding-space (real KnowledgeDatabaseManager)', () => {
  let db, kdb;

  beforeEach(() => {
    db = new Database(':memory:');
    kdb = new KnowledgeDatabaseManager(db);
    kdb.initializeSchema();
  });

  afterEach(() => db.close());

  test('schema has embedding_space column; saveNodes persists + reads it back', () => {
    kdb.saveNodes([
      { source_type: 'RESUME', category: 'experience', title: 'A', text_content: 'a', tags: [], embedding: vec(0.1), embedding_space: SPACE_V2 },
    ]);
    const nodes = kdb.getAllNodes();
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].embedding_space, SPACE_V2);
    assert.equal(nodes[0].embedding.length, 768);
  });

  test('getNodesNeedingReembed sweeps OLD-space nodes (v1 while active is v2)', () => {
    kdb.saveNodes([
      { source_type: 'RESUME', category: 'experience', title: 'v1node', text_content: 'old', tags: [], embedding: vec(0.1), embedding_space: SPACE_V1 },
      { source_type: 'RESUME', category: 'experience', title: 'v2node', text_content: 'new', tags: [], embedding: vec(0.2), embedding_space: SPACE_V2 },
    ]);
    const stale = kdb.getNodesNeedingReembed(SPACE_V2);
    assert.equal(stale.length, 1, 'only the v1 node needs re-embed');
    assert.equal(stale[0].title, 'v1node');
  });

  test('getNodesNeedingReembed sweeps legacy NULL-space nodes that HAVE an embedding', () => {
    // Simulate a pre-migration node: embedded but no space recorded.
    db.prepare(
      "INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space) VALUES ('RESUME','experience','legacy','x','[]',?,NULL)"
    ).run(Buffer.alloc(768 * 4));
    const stale = kdb.getNodesNeedingReembed(SPACE_V2);
    assert.equal(stale.length, 1, 'legacy NULL-space embedded node must be swept');
    assert.equal(stale[0].title, 'legacy');
  });

  test('getNodesNeedingReembed ignores nodes with NO embedding (nothing to compare)', () => {
    db.prepare(
      "INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space) VALUES ('RESUME','experience','noemb','x','[]',NULL,NULL)"
    ).run();
    assert.equal(kdb.getNodesNeedingReembed(SPACE_V2).length, 0);
  });

  test('updateNodeEmbedding rewrites embedding + space in place → no longer stale', () => {
    kdb.saveNodes([
      { source_type: 'RESUME', category: 'experience', title: 'v1node', text_content: 'old', tags: [], embedding: vec(0.1), embedding_space: SPACE_V1 },
    ]);
    const [node] = kdb.getNodesNeedingReembed(SPACE_V2);
    kdb.updateNodeEmbedding(node.id, vec(0.9), SPACE_V2);
    assert.equal(kdb.getNodesNeedingReembed(SPACE_V2).length, 0, 'no stale nodes after re-embed');
    const updated = kdb.getAllNodes().find(n => n.id === node.id);
    assert.equal(updated.embedding_space, SPACE_V2);
    assert.ok(Math.abs(updated.embedding[0] - 0.9) < 1e-6, 'embedding rewritten (float32 round-trip of 0.9)');
  });

  test('all nodes already in active space → nothing to re-embed (no needless churn)', () => {
    kdb.saveNodes([
      { source_type: 'RESUME', category: 'experience', title: 'a', text_content: 'a', tags: [], embedding: vec(0.1), embedding_space: SPACE_V2 },
      { source_type: 'JD', category: 'requirement', title: 'b', text_content: 'b', tags: [], embedding: vec(0.2), embedding_space: SPACE_V2 },
    ]);
    assert.equal(kdb.getNodesNeedingReembed(SPACE_V2).length, 0);
  });

  test('idempotent ALTER: initializeSchema twice does not throw / duplicate column', () => {
    kdb.initializeSchema(); // second call — ADD COLUMN guarded by try/catch
    kdb.saveNodes([{ source_type: 'RESUME', category: 'c', title: 't', text_content: 'x', tags: [], embedding: vec(0.1), embedding_space: SPACE_V2 }]);
    assert.equal(kdb.getAllNodes()[0].embedding_space, SPACE_V2);
  });
});
