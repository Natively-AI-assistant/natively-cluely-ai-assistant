// electron/rag/__tests__/KnowledgeDegradeToLocal.test.mjs
//
// MEDIUM-2 fix: when the cloud embedder can't converge the knowledge corpus into
// the active (cloud) space (sustained 429 / network down), ensureEmbeddingSpace
// DEGRADES the ENTIRE corpus to the local space — all-or-nothing — so resume/JD
// grounding keeps working (lower quality) instead of going silently empty. It
// commits _indexSpace to whichever space the corpus FULLY converged to, and never
// leaves a mixed corpus (which _spaceGatedNodes would partially hide).
//
// Drives the REAL compiled KnowledgeOrchestrator methods (Object.create + real
// KnowledgeDatabaseManager on in-memory SQLite).
//
// Run under Electron ABI: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const koPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');
const kdbPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js');
const { KnowledgeOrchestrator } = await import(pathToFileURL(koPath).href);
const { KnowledgeDatabaseManager } = await import(pathToFileURL(kdbPath).href);

const CLOUD = 'gemini:gemini-embedding-2:768';
const LOCAL = 'local:xenova/all-minilm-l6-v2:384';
const vec = (fill, dim = 768) => new Array(dim).fill(fill);

function makeOrch(db, { embedFn, fastQueryEmbedFn, activeSpaceFn } = {}) {
  const orch = Object.create(KnowledgeOrchestrator.prototype);
  orch.db = new KnowledgeDatabaseManager(db);
  orch.db.initializeSchema();
  orch.cachedNodes = [];
  orch._reembedInFlight = false;
  orch._indexSpace = undefined;
  orch.embedFn = embedFn ?? null;
  orch.fastQueryEmbedFn = fastQueryEmbedFn ?? null;
  orch.activeSpaceFn = activeSpaceFn ?? null;
  return orch;
}

function seed(db, title, space, fill = 0.1, dim = 768) {
  const blob = Buffer.alloc(dim * 4);
  for (let i = 0; i < dim; i++) blob.writeFloatLE(fill, i * 4);
  db.prepare(
    `INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space)
     VALUES ('RESUME','experience',?,?,'[]',?,?)`
  ).run(title, `content ${title}`, blob, space);
}

describe('ensureEmbeddingSpace degrade-to-local (MEDIUM-2)', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); });
  afterEach(() => db.close());

  test('cloud healthy → converges corpus to cloud space, commits _indexSpace=cloud', async () => {
    const orch = makeOrch(db, {
      activeSpaceFn: () => CLOUD,
      embedFn: async () => vec(0.9),
      fastQueryEmbedFn: () => ({ dimensions: 384, space: LOCAL, embed: async () => vec(0.5, 384) }),
    });
    seed(db, 'v1a', 'gemini:gemini-embedding-001:768');
    seed(db, 'v1b', 'gemini:gemini-embedding-001:768');
    orch.cachedNodes = orch.db.getAllNodes();

    await orch.ensureEmbeddingSpace();

    assert.equal(orch._indexSpace, CLOUD, 'committed to cloud space');
    assert.equal(orch.db.getNodesNeedingReembed(CLOUD).length, 0, 'whole corpus in cloud space');
  });

  test('cloud DOWN + local available → degrades ENTIRE corpus to local, commits _indexSpace=local', async () => {
    const orch = makeOrch(db, {
      activeSpaceFn: () => CLOUD,
      embedFn: async () => { throw new Error('429 rate limited'); }, // cloud fully down
      fastQueryEmbedFn: () => ({ dimensions: 384, space: LOCAL, embed: async () => vec(0.5, 384) }),
    });
    seed(db, 'a', 'gemini:gemini-embedding-001:768');
    seed(db, 'b', 'gemini:gemini-embedding-001:768');
    orch.cachedNodes = orch.db.getAllNodes();

    await orch.ensureEmbeddingSpace();

    assert.equal(orch._indexSpace, LOCAL, 'degraded: committed to local space');
    assert.equal(orch.db.getNodesNeedingReembed(LOCAL).length, 0, 'ENTIRE corpus converged to local (all-or-nothing)');
    // And the corpus is NOT split: zero nodes remain in the old cloud-v1 space.
    const spaces = new Set(orch.cachedNodes.filter(n => n.embedding).map(n => n.embedding_space));
    assert.deepEqual([...spaces], [LOCAL], 'no split corpus — every embedded node is in the local space');
  });

  test('degrade moves even already-cloud-converged nodes to local (no mixed corpus)', async () => {
    // Partial cloud success then failure must NOT leave a v2-cloud + v1-stale split;
    // the degrade re-embeds everything (including any cloud-space nodes) to local.
    const orch = makeOrch(db, {
      activeSpaceFn: () => CLOUD,
      embedFn: async () => { throw new Error('down'); },
      fastQueryEmbedFn: () => ({ dimensions: 384, space: LOCAL, embed: async () => vec(0.5, 384) }),
    });
    seed(db, 'alreadyCloud', CLOUD);          // already in active cloud space
    seed(db, 'stale', 'gemini:gemini-embedding-001:768');
    orch.cachedNodes = orch.db.getAllNodes();

    await orch.ensureEmbeddingSpace();

    assert.equal(orch._indexSpace, LOCAL);
    assert.equal(orch.db.getNodesNeedingReembed(LOCAL).length, 0, 'both nodes (incl. the already-cloud one) now in local space');
  });

  test('cloud DOWN + NO local → does not commit a space, leaves corpus stale for next retry', async () => {
    const orch = makeOrch(db, {
      activeSpaceFn: () => CLOUD,
      embedFn: async () => { throw new Error('down'); },
      fastQueryEmbedFn: null, // no local embedder
    });
    seed(db, 'a', 'gemini:gemini-embedding-001:768');
    orch.cachedNodes = orch.db.getAllNodes();

    await orch.ensureEmbeddingSpace();

    assert.equal(orch._indexSpace, undefined, 'no consistent space achievable → _indexSpace uncommitted');
  });

  test('recovery: after a degrade, a later pass with cloud healthy restores the corpus to cloud', async () => {
    let cloudUp = false;
    const orch = makeOrch(db, {
      activeSpaceFn: () => CLOUD,
      embedFn: async () => { if (!cloudUp) throw new Error('down'); return vec(0.9); },
      fastQueryEmbedFn: () => ({ dimensions: 384, space: LOCAL, embed: async () => vec(0.5, 384) }),
    });
    seed(db, 'a', 'gemini:gemini-embedding-001:768');
    orch.cachedNodes = orch.db.getAllNodes();

    await orch.ensureEmbeddingSpace();
    assert.equal(orch._indexSpace, LOCAL, 'first pass degrades to local');

    cloudUp = true;
    orch._reembedInFlight = false; // (guard auto-reset in finally; explicit for clarity)
    await orch.ensureEmbeddingSpace();
    assert.equal(orch._indexSpace, CLOUD, 'recovery pass restores cloud space');
    assert.equal(orch.db.getNodesNeedingReembed(CLOUD).length, 0, 'corpus fully back in cloud space');
  });

  test('already fully in active space → no-op, commits cloud (idempotent)', async () => {
    const orch = makeOrch(db, {
      activeSpaceFn: () => CLOUD,
      embedFn: async () => { throw new Error('should not be called'); },
      fastQueryEmbedFn: () => ({ dimensions: 384, space: LOCAL, embed: async () => vec(0.5, 384) }),
    });
    seed(db, 'a', CLOUD);
    seed(db, 'b', CLOUD);
    orch.cachedNodes = orch.db.getAllNodes();

    await orch.ensureEmbeddingSpace();
    assert.equal(orch._indexSpace, CLOUD, 'already-converged corpus commits cloud without calling embedFn');
  });

  test('debounce: a rapid second call on a fully-healthy corpus is skipped (no redundant re-embed)', async () => {
    let embedCalls = 0;
    const orch = makeOrch(db, {
      activeSpaceFn: () => CLOUD,
      embedFn: async () => { embedCalls++; return vec(0.9); },
      fastQueryEmbedFn: () => ({ dimensions: 384, space: LOCAL, embed: async () => vec(0.5, 384) }),
    });
    seed(db, 'a', 'gemini:gemini-embedding-001:768'); // 1 stale node → first pass re-embeds it
    orch.cachedNodes = orch.db.getAllNodes();

    await orch.ensureEmbeddingSpace();
    assert.equal(orch._indexSpace, CLOUD);
    const afterFirst = embedCalls;
    assert.ok(afterFirst >= 1, 'first pass embedded the stale node');

    // Immediate second call: fully healthy (committed===active, no stale) + within
    // the debounce window → skipped, embedFn not called again.
    await orch.ensureEmbeddingSpace();
    assert.equal(embedCalls, afterFirst, 'rapid re-call is debounced — no redundant re-embed');
  });

  test('debounce does NOT block recovery from a degraded corpus', async () => {
    let cloudUp = false;
    const orch = makeOrch(db, {
      activeSpaceFn: () => CLOUD,
      embedFn: async () => { if (!cloudUp) throw new Error('down'); return vec(0.9); },
      fastQueryEmbedFn: () => ({ dimensions: 384, space: LOCAL, embed: async () => vec(0.5, 384) }),
    });
    seed(db, 'a', 'gemini:gemini-embedding-001:768');
    orch.cachedNodes = orch.db.getAllNodes();

    await orch.ensureEmbeddingSpace();              // degrades → _indexSpace=local, _lastConvergeAt=now
    assert.equal(orch._indexSpace, LOCAL);

    cloudUp = true;
    // Immediate recovery call: even though _lastConvergeAt is fresh, _indexSpace
    // (local) !== activeSpace (cloud) → NOT debounced → recovery proceeds.
    await orch.ensureEmbeddingSpace();
    assert.equal(orch._indexSpace, CLOUD, 'recovery is never debounced (committed != active)');
  });
});
