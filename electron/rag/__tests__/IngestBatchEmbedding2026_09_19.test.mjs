// Profile ingest embeds its nodes a BATCH at a time (2026-09-19).
//
// Measured LIVE on the natively stack with a 15k-token résumé: the ingest fired
// 10 CONCURRENT single-text embed requests per batch; /v1/embed answered 429 Too
// Many Requests; EmbeddingPipeline fell back to the bundled model per call with
// only a warn; and all 238 knowledge nodes ended in `local:…minilm…:384` while
// natively embeddings were selected and working. One request per batch, with the
// per-text path (retry included) kept as the fallback.
//
// Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge');
const { chunkAndEmbedDocument, embedTextsBatched } = await import(pathToFileURL(path.join(dist, 'DocumentChunker.js')).href);
const { KnowledgeOrchestrator } = await import(pathToFileURL(path.join(dist, 'KnowledgeOrchestrator.js')).href);
const { KnowledgeDatabaseManager } = await import(pathToFileURL(path.join(dist, 'KnowledgeDatabaseManager.js')).href);
const { DocType } = await import(pathToFileURL(path.join(dist, 'types.js')).href);

const RESUME = {
  identity: { name: 'Maya Okonkwo-Reyes' },
  skills: { languages: ['Go', 'Rust'], frameworks: ['gRPC'], cloud: ['AWS'], databases: ['PostgreSQL'], ml: [], devops: ['Kubernetes'], tools: [] },
  experience: Array.from({ length: 6 }, (_, i) => ({ company: `Company ${i}`, role: 'Staff Engineer', start_date: `20${10 + i}-01`, end_date: `20${11 + i}-01`,
    bullets: Array.from({ length: 5 }, (_, b) => `Rebuilt pipeline ${i}-${b}, improving p99 latency by ${20 + i + b}%.`) })),
  projects: [], education: [], achievements: [], certifications: [], leadership: [],
};
const vec = () => new Array(8).fill(0.01);
const counters = () => ({ single: 0, batch: 0, batchSizes: [] });

describe('chunkAndEmbedDocument', () => {
  test('with a batch embedder: one request per batch, NO single-text requests', async () => {
    const c = counters();
    const nodes = await chunkAndEmbedDocument(RESUME, DocType.RESUME,
      async () => { c.single++; return vec(); },
      async (texts) => { c.batch++; c.batchSizes.push(texts.length); return texts.map(vec); });
    assert.ok(nodes.length > 20, `${nodes.length} nodes`);
    assert.equal(c.single, 0, `${c.single} single-text requests were still sent`);
    assert.equal(c.batch, Math.ceil(nodes.length / 10));
    assert.ok(nodes.every((n) => Array.isArray(n.embedding) && n.embedding.length === 8));
  });
  test('without one: the per-text path, unchanged', async () => {
    const c = counters();
    const nodes = await chunkAndEmbedDocument(RESUME, DocType.RESUME, async () => { c.single++; return vec(); });
    assert.equal(c.single, nodes.length);
  });
  test('a failing batch call falls back to per-text for THAT batch and loses no node', async () => {
    const c = counters();
    const nodes = await chunkAndEmbedDocument(RESUME, DocType.RESUME,
      async () => { c.single++; return vec(); },
      async (texts) => { c.batch++; if (c.batch === 2) throw new Error('429 Too Many Requests'); return texts.map(vec); });
    assert.equal(c.single, 10, 'exactly the failed batch was embedded one by one');
    assert.ok(nodes.every((n) => Array.isArray(n.embedding)));
  });
  test('a batch reply of the wrong length is refused, never zipped onto the wrong nodes', async () => {
    assert.equal(await embedTextsBatched(['a', 'b', 'c'], async () => [vec(), vec()]), null);
    assert.equal(await embedTextsBatched(['a'], undefined), null);
  });
});

describe('orchestrator: nodes are stamped with the space the BATCH reported', () => {
  const tmp = [];
  afterEach(() => { for (const f of tmp.splice(0)) { try { fs.rmSync(f, { force: true }); } catch {} } });
  test('a whole ingest goes through the batch embedder and lands in one space', async () => {
    const file = path.join(os.tmpdir(), `ingest-batch-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(file, 'Maya Okonkwo-Reyes\nStaff Engineer at several companies.\n' + 'Rebuilt pipelines and improved latency. '.repeat(10), 'utf8');
    tmp.push(file);
    const db = new Database(':memory:');
    const orch = new KnowledgeOrchestrator(new KnowledgeDatabaseManager(db));
    orch.setGenerateContentFn(async (parts) => {
      const text = Array.isArray(parts) ? parts.map((p) => p?.text ?? '').join(' ') : String(parts ?? '');
      return /STAR \(Situation, Task, Action, Result\)/.test(text) ? '[]' : JSON.stringify(RESUME);
    });
    const c = counters();
    orch.setEmbedFn(async () => { c.single++; return vec(); });
    orch.setEmbedWithMetadataFn(async () => { c.single++; return { embedding: vec(), space: 'local:xenova/all-minilm-l6-v2:384' }; });
    orch.setEmbedBatchWithMetadataFn(async (texts) => { c.batch++; return { embeddings: texts.map(vec), space: 'natively:voyage-4:2048' }; });
    orch.setActiveSpaceFn?.(() => 'natively:voyage-4:2048');
    const r = await orch.ingestDocument(file, DocType.RESUME);
    assert.equal(r.success, true, JSON.stringify(r));
    assert.ok(c.batch > 0, 'the batch embedder was never called');
    assert.equal(c.single, 0, `${c.single} single-text embeds during ingest`);
    const spaces = db.prepare('SELECT DISTINCT embedding_space AS s FROM context_nodes WHERE embedding IS NOT NULL').all().map((x) => x.s);
    assert.deepEqual(spaces, ['natively:voyage-4:2048']);
  });
});
