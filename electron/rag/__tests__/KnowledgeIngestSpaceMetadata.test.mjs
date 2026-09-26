// electron/rag/__tests__/KnowledgeIngestSpaceMetadata.test.mjs
//
// Regression for profile/JD ingestion after single-embedding fallback promotion.
// KnowledgeOrchestrator used to snapshot activeSpace BEFORE embedding, then stamp
// every saved node with that stale value. If getEmbedding() promoted cloud→local
// mid-ingest, local vectors were persisted as cloud-space vectors.
//
// Run under Electron ABI: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>
//
// ─── STATUS 2026-08-16: THIS TEST HAS NEVER PASSED — READ BEFORE "FIXING" IT ──
//
// It fails with `TypeError: orch.setEmbedWithMetadataFn is not a function`,
// which reads like a broken test but is not. Provenance:
//
//   * Added 2026-07-11 in a476bac5, titled "chore(wip): snapshot in-flight
//     RAG/embedding + Hindsight + STT work" — a WIP snapshot.
//   * `setEmbedWithMetadataFn` has NEVER existed on any premium branch
//     (`git log --all -S setEmbedWithMetadataFn` over all 120 commits / 20
//     branches returns nothing, while the control `setActiveSpaceFn` hits
//     immediately). The seam this test drives was never written.
//
// So the header above describes the fix in the PAST TENSE ("used to snapshot
// activeSpace BEFORE embedding") while the code still does exactly that. The
// test documents an intended design, not a regression.
//
// THE UNDERLYING BUG IS REAL, and is worth fixing properly:
//
//   premium/electron/knowledge/KnowledgeOrchestrator.ts:1034
//       const activeSpace = this.activeSpaceFn?.();          // snapshot
//       const nodesWithEmbeddings = await chunkAndEmbedDocument(..., this.embedFn);
//   :1040  this.db.saveNodes(this._stampSpace(nodesWithEmbeddings, activeSpace), docId);
//   :1047  (same for generateStarStoryNodes' STAR nodes)
//   :580   (same shape on the confirmed-evidence path)
//
// The space is snapshotted BEFORE embedding and stamped after. If embedFn
// degrades cloud->local mid-ingest, local vectors are persisted labelled as
// cloud-space vectors, and retrieval then computes cosine similarity across
// two incompatible embedding spaces — silently, with no error.
//
// Why this was NOT auto-fixed: satisfying this test is not a stamp fix. It
// requires (a) a new premium API returning producer metadata, (b) threading it
// through chunkAndEmbedDocument and generateStarStoryNodes, and (c) a
// BEHAVIOURAL change to space-convergence policy — line 94 below demands that
// a cloud convergence DEGRADE to the local producer space on metadata
// mismatch. That is a design decision for the premium owner, in a separate
// private repo, needing its own PR plus a gitlink bump.
//
// Note also: this test loads dist-electron/premium/**, which comes from the
// gitlink. It therefore CANNOT be made green from the outer repo at all — CI
// will report it red until premium itself ships the seam.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const koPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');
const kdbPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js');
const typesPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/types.js');

const { KnowledgeOrchestrator } = await import(pathToFileURL(koPath).href);
const { KnowledgeDatabaseManager } = await import(pathToFileURL(kdbPath).href);
const { DocType } = await import(pathToFileURL(typesPath).href);

const CLOUD = 'gemini:gemini-embedding-2:768';
const LOCAL = 'local:xenova/all-minilm-l6-v2:384';
const vec = (dim, fill) => new Array(dim).fill(fill);

let tmpFiles = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try { fs.rmSync(f, { force: true }); } catch {}
  }
});

function makeResumeFile() {
  const file = path.join(os.tmpdir(), `profile-space-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(file, `Evin Example\nSoftware Engineer at Natively\nBuilt resilient local RAG and Electron systems.\nSkills: TypeScript, SQLite, RAG`, 'utf8');
  tmpFiles.push(file);
  return file;
}

describe('KnowledgeOrchestrator ingestion uses producer embedding space metadata', () => {
  test('cloud→local fallback during ingest stamps saved nodes with local space, not pre-call active cloud space', async () => {
    const db = new Database(':memory:');
    try {
      const knowledgeDb = new KnowledgeDatabaseManager(db);
      const orch = new KnowledgeOrchestrator(knowledgeDb);

      orch.setGenerateContentFn(async () => JSON.stringify({
        identity: { name: 'Evin Example' },
        skills: { languages: ['TypeScript'], frameworks: [], cloud: [], databases: ['SQLite'], ml: ['RAG'], devops: [], tools: [] },
        experience: [{ company: 'Natively', role: 'Software Engineer', start_date: '2024-01', end_date: null, bullets: ['Built resilient local RAG and Electron systems.'] }],
        projects: [],
        education: [],
        achievements: [],
        certifications: [],
        leadership: [],
      }));

      orch.setActiveSpaceFn(() => CLOUD);
      orch.setEmbedWithMetadataFn(async () => ({
        embedding: vec(384, 0.42),
        space: LOCAL,
        provider: 'local',
        dimensions: 384,
      }));
      orch.setFastQueryEmbedFn(() => ({
        dimensions: 384,
        space: LOCAL,
        embed: async () => vec(384, 0.42),
      }));

      const result = await orch.ingestDocument(makeResumeFile(), DocType.RESUME);
      assert.equal(result.success, true, result.error || 'ingest should succeed');

      const rows = db.prepare(`SELECT embedding_space, length(embedding) AS bytes FROM context_nodes WHERE embedding IS NOT NULL`).all();
      assert.ok(rows.length > 0, 'fixture should save embedded nodes');
      assert.ok(rows.every((r) => r.embedding_space === LOCAL), 'every produced local vector must be stamped local');
      assert.ok(rows.every((r) => r.bytes === 384 * 4), 'stored vectors should be local-width vectors');
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM context_nodes WHERE embedding_space = ?`).get(CLOUD).n, 0, 'no local vector may be mislabeled as cloud');

      // Wait for any background re-embed pass to finish
      for (let i = 0; i < 100 && orch._reembedInFlight; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // The background convergence pass must also refuse to write local vectors
      // into the cloud target space: it should fail the cloud attempt, then settle
      // on the real local committed index space.
      await orch.ensureEmbeddingSpace();
      assert.equal(orch._indexSpace, LOCAL, 'metadata mismatch makes cloud convergence degrade to the producer local space');
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM context_nodes WHERE embedding_space != ?`).get(LOCAL).n, 0, 'post-convergence corpus remains local-only');
    } finally {
      db.close();
    }
  });
});
