// electron/rag/__tests__/KnowledgeReembedIntegration.test.mjs
//
// CRITICAL — integration test for the premium knowledge-base v1→v2 re-embed fix.
// This is the knowledge-base analogue of the meetings auto-reindex. It exercises the
// REAL compiled KnowledgeOrchestrator method bodies (ensureEmbeddingSpace,
// _spaceGatedNodes, _stampSpace, refreshCache) driven against a REAL compiled
// KnowledgeDatabaseManager on an in-memory SQLite DB.
//
// We build the orchestrator with Object.create(prototype) — same trick as
// ReindexGuard.test.mjs — to skip the heavy constructor (which instantiates
// CompanyResearchEngine / AOTPipeline / SalaryIntelligenceEngine / etc.) while still
// running the genuine method bodies under test. The collaborators those methods touch
// (db, embedFn, activeSpaceFn, cachedNodes, _reembedInFlight) are attached manually.
//
// Run under Electron ABI:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const koPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');
const kdbPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeDatabaseManager.js');
const esPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingSpace.js');

const { KnowledgeOrchestrator } = await import(pathToFileURL(koPath).href);
const { KnowledgeDatabaseManager } = await import(pathToFileURL(kdbPath).href);
const { embeddingSpaceKey } = await import(pathToFileURL(esPath).href);

const SPACE_V1 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 768 });
const SPACE_V2 = embeddingSpaceKey({ name: 'gemini', model: 'gemini-embedding-2', dimensions: 768 });

function vec(fill) { return new Array(768).fill(fill); }

// Build a KnowledgeOrchestrator WITHOUT running its constructor, attaching only the
// collaborators that ensureEmbeddingSpace / _spaceGatedNodes / _stampSpace / refreshCache
// actually touch. The method bodies are the REAL compiled ones.
function makeOrch(db, { embedFn, activeSpaceFn } = {}) {
  const orch = Object.create(KnowledgeOrchestrator.prototype);
  orch.db = new KnowledgeDatabaseManager(db);
  orch.db.initializeSchema();
  orch.cachedNodes = [];
  orch._reembedInFlight = false;
  orch.activeResume = null;
  orch.activeJD = null;
  orch._processedResumeCache = null;
  orch.embedFn = embedFn ?? null;
  orch.activeSpaceFn = activeSpaceFn ?? null;
  // refreshCache reads documents by type; the orchestrator's db.getDocumentByType
  // returns null when no docs exist (fine for these tests).
  return orch;
}

function seedNode(db, { title, space, fill = 0.1, embedded = true }) {
  const blob = embedded ? Buffer.alloc(768 * 4) : null;
  if (blob && fill !== undefined) {
    for (let i = 0; i < 768; i++) blob.writeFloatLE(fill, i * 4);
  }
  db.prepare(
    `INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space)
     VALUES ('RESUME','experience',?,?,?,?,?)`
  ).run(title, `content of ${title}`, '[]', blob, space);
}

describe('KnowledgeOrchestrator.ensureEmbeddingSpace (real compiled method + real DB)', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); });
  afterEach(() => db.close());

  test('stale v1 nodes get re-embedded into the active v2 space', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'v1a', space: SPACE_V1, fill: 0.11 });
    seedNode(db, { title: 'v1b', space: SPACE_V1, fill: 0.12 });
    seedNode(db, { title: 'v2c', space: SPACE_V2, fill: 0.99 }); // already current

    // embedFn returns a deterministic distinct vector so we can prove the rewrite.
    const embedded = [];
    orch.embedFn = async (txt) => { embedded.push(txt); return vec(0.5); };

    orch.cachedNodes = orch.db.getAllNodes();
    await orch.ensureEmbeddingSpace();

    // Both v1 nodes (not the v2 one) were re-embedded.
    assert.equal(embedded.length, 2, 'only the two v1 nodes re-embedded');
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 0, 'no stale nodes remain');
    // Cache reloaded with new spaces + vectors.
    const reloaded = orch.cachedNodes.filter(n => n.embedding_space === SPACE_V2);
    assert.equal(reloaded.length, 3, 'all three now in v2 space');
    const v1a = orch.cachedNodes.find(n => n.title === 'v1a');
    assert.ok(Math.abs(v1a.embedding[0] - 0.5) < 1e-6, 'v1a vector rewritten');
    const v2c = orch.cachedNodes.find(n => n.title === 'v2c');
    assert.ok(Math.abs(v2c.embedding[0] - 0.99) < 1e-6, 'v2c vector untouched');
    assert.equal(orch._reembedInFlight, false, 'flag reset after pass');
  });

  test('partial embedFn failure leaves some stale → self-heals next pass', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'good1', space: SPACE_V1 });
    seedNode(db, { title: 'bad', space: SPACE_V1 });
    seedNode(db, { title: 'good2', space: SPACE_V1 });
    orch.cachedNodes = orch.db.getAllNodes();

    // Fail only the 'bad' node on the first pass.
    let failBad = true;
    orch.embedFn = async (txt) => {
      if (failBad && txt.includes('bad')) throw new Error('429 rate limit');
      return vec(0.7);
    };

    await orch.ensureEmbeddingSpace();
    let stale = orch.db.getNodesNeedingReembed(SPACE_V2);
    assert.equal(stale.length, 1, 'the failed node remains stale');
    assert.equal(stale[0].title, 'bad');
    assert.equal(orch._reembedInFlight, false, 'flag reset even with a partial failure');

    // Next pass: API recovered → the remaining stale node converges.
    failBad = false;
    await orch.ensureEmbeddingSpace();
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 0, 'self-healed on next pass');
  });

  test('embedFn returning empty/non-array does NOT mark node done (stays stale, no garbage)', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'n1', space: SPACE_V1 });
    orch.cachedNodes = orch.db.getAllNodes();
    orch.embedFn = async () => []; // empty array — provider returned nothing useful

    await orch.ensureEmbeddingSpace();
    // updateNodeEmbedding must NOT have been called (guard: Array.isArray(vec) && vec.length>0).
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 1, 'empty vector must not be persisted');
    // And the node's embedding_space is still v1 (not silently stamped v2 with garbage).
    assert.equal(orch.db.getAllNodes()[0].embedding_space, SPACE_V1);
  });

  test('_reembedInFlight prevents a concurrent second pass from double-embedding', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'n1', space: SPACE_V1 });
    seedNode(db, { title: 'n2', space: SPACE_V1 });
    orch.cachedNodes = orch.db.getAllNodes();

    let release;
    const gate = new Promise(r => { release = r; });
    let calls = 0;
    orch.embedFn = async () => { calls++; await gate; return vec(0.3); };

    const first = orch.ensureEmbeddingSpace();   // enters, sets flag, awaits gate on first node
    await Promise.resolve();
    const second = orch.ensureEmbeddingSpace();  // must see flag=true and return immediately
    await second;
    assert.ok(calls <= 1, 'second pass must not start embedding while first in flight');

    release();
    await first;
    assert.equal(calls, 2, 'first pass embedded both nodes exactly once total');
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 0);
    assert.equal(orch._reembedInFlight, false);
  });

  test('no active space (pipeline not ready) → ensureEmbeddingSpace is a no-op', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => undefined });
    seedNode(db, { title: 'n1', space: SPACE_V1 });
    orch.cachedNodes = orch.db.getAllNodes();
    let calls = 0;
    orch.embedFn = async () => { calls++; return vec(0.1); };
    await orch.ensureEmbeddingSpace();
    assert.equal(calls, 0, 'no embed calls when active space unknown');
    assert.equal(orch.db.getAllNodes()[0].embedding_space, SPACE_V1, 'nothing touched');
  });

  test('no embedFn → ensureEmbeddingSpace is a no-op (best-effort skip)', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    orch.embedFn = null;
    seedNode(db, { title: 'n1', space: SPACE_V1 });
    orch.cachedNodes = orch.db.getAllNodes();
    await orch.ensureEmbeddingSpace(); // must not throw
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 1, 'still stale, untouched');
  });

  test('all nodes already in active space → no embed churn', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'a', space: SPACE_V2 });
    seedNode(db, { title: 'b', space: SPACE_V2 });
    orch.cachedNodes = orch.db.getAllNodes();
    let calls = 0;
    orch.embedFn = async () => { calls++; return vec(0.1); };
    await orch.ensureEmbeddingSpace();
    assert.equal(calls, 0, 'no needless re-embed when everything already matches active space');
  });
});

describe('KnowledgeOrchestrator._spaceGatedNodes (real compiled method)', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); });
  afterEach(() => db.close());

  function loadCache(orch) { orch.cachedNodes = orch.db.getAllNodes(); }

  test('keyword-only nodes (no embedding) ALWAYS survive the gate', () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'kw', space: null, embedded: false });
    loadCache(orch);
    const gated = orch._spaceGatedNodes();
    assert.equal(gated.length, 1);
    assert.equal(gated[0].title, 'kw');
  });

  test('active-space nodes survive; v1 + NULL-space-with-embedding excluded when active known', () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'v2', space: SPACE_V2 });
    seedNode(db, { title: 'v1', space: SPACE_V1 });
    // legacy NULL-space WITH embedding
    db.prepare(
      `INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space)
       VALUES ('RESUME','experience','nullspace','x','[]',?,NULL)`
    ).run(Buffer.alloc(768 * 4));
    loadCache(orch);
    const titles = orch._spaceGatedNodes().map(n => n.title).sort();
    assert.deepEqual(titles, ['v2'], 'only the active-space embedded node survives');
  });

  test('active space UNDEFINED (pipeline not ready) + mixed corpus → gate to the MAJORITY embedded space (safer than no-gate)', () => {
    // When the active space is unknown, _committedIndexSpace derives the majority
    // space among embedded nodes rather than disabling the gate. This is SAFER than
    // the old "no gate" behavior: returning mixed-space embedded nodes to be scored
    // against one query vector is the exact cross-space hazard. Here v2-space nodes
    // are the majority → only they (+ keyword-only nodes) survive.
    const orch = makeOrch(db, { activeSpaceFn: () => undefined });
    seedNode(db, { title: 'v2a', space: SPACE_V2 });
    seedNode(db, { title: 'v2b', space: SPACE_V2 }); // v2 is the majority (2 vs 1)
    seedNode(db, { title: 'v1', space: SPACE_V1 });
    seedNode(db, { title: 'kw', space: null, embedded: false });
    loadCache(orch);
    const titles = orch._spaceGatedNodes().map(n => n.title).sort();
    assert.deepEqual(titles, ['kw', 'v2a', 'v2b'], 'majority (v2) + keyword-only survive; the v1 straggler is excluded');
  });

  test('active space UNDEFINED + single-space corpus → all embedded survive (no spurious exclusion)', () => {
    const orch = makeOrch(db, { activeSpaceFn: () => undefined });
    seedNode(db, { title: 'a', space: SPACE_V2 });
    seedNode(db, { title: 'b', space: SPACE_V2 });
    seedNode(db, { title: 'kw', space: null, embedded: false });
    loadCache(orch);
    assert.equal(orch._spaceGatedNodes().length, 3, 'a consistent single-space corpus is fully searchable even when active space is unknown');
  });

  test('activeSpaceFn unset entirely (null) → NO gate (optional()), all survive', () => {
    const orch = makeOrch(db, {});
    orch.activeSpaceFn = null;
    seedNode(db, { title: 'v1', space: SPACE_V1 });
    loadCache(orch);
    assert.equal(orch._spaceGatedNodes().length, 1);
  });

  test('refreshCache fires ensureEmbeddingSpace fire-and-forget and converges the cache', async () => {
    // Drives the REAL refreshCache body: it reloads cachedNodes, then fires
    // ensureEmbeddingSpace().catch(...). Because it's fire-and-forget, we must await
    // the microtasks/embed promise to settle before asserting convergence.
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'v1', space: SPACE_V1 });
    orch.embedFn = async () => vec(0.4);

    orch.refreshCache(); // synchronous reload + async re-embed kicked off
    // The cache immediately after refreshCache still shows the v1 node (re-embed async).
    // Wait for the in-flight pass to finish.
    await new Promise(r => setTimeout(r, 20));
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 0, 'converged after fire-and-forget pass');
  });

  test('in-flight guard + loop-until-empty: a node added mid-pass is converged within the SAME call (not lost, not deferred)', async () => {
    // Scenario: a re-embed pass is in flight. A second refreshCache (e.g. a new stale
    // node appears) fires ensureEmbeddingSpace again, which is a NO-OP due to
    // _reembedInFlight. The newly stale node must NOT be lost. With the loop-until-empty
    // fix, the in-flight pass re-queries getNodesNeedingReembed after its first batch and
    // converges the late arrival in a subsequent loop iteration — so by the time the
    // single ensureEmbeddingSpace() promise resolves, ZERO stale nodes remain.
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'first', space: SPACE_V1 });
    orch.cachedNodes = orch.db.getAllNodes();

    let release;
    const gate = new Promise(r => { release = r; });
    let firstCall = true;
    // Gate only the FIRST embed so 'second' can be seeded while pass1 is mid-flight.
    orch.embedFn = async () => {
      if (firstCall) { firstCall = false; await gate; }
      return vec(0.5);
    };

    const pass1 = orch.ensureEmbeddingSpace();
    await Promise.resolve();
    // While pass1 is gated on the first node, a new stale node appears + a second
    // ensure is attempted (no-op, guarded by _reembedInFlight).
    seedNode(db, { title: 'second', space: SPACE_V1 });
    await orch.ensureEmbeddingSpace(); // no-op (guarded)
    release();
    await pass1;

    // The loop re-queried after batch 1 and picked up 'second' in the same call.
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 0, 'loop-until-empty converges the mid-pass arrival within the same call — not lost, not left stale');
  });

  test('DURING re-embed a v1 node is excluded; AFTER convergence it is included', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'v1', space: SPACE_V1, fill: 0.2 });
    loadCache(orch);
    // Before re-embed: v1 node is gated OUT (would be cross-space comparison).
    assert.equal(orch._spaceGatedNodes().length, 0, 'v1 node excluded before convergence');

    orch.embedFn = async () => vec(0.6);
    await orch.ensureEmbeddingSpace();
    // After re-embed: node is now in v2 space → included.
    const gated = orch._spaceGatedNodes();
    assert.equal(gated.length, 1, 'node included after re-embed to active space');
    assert.equal(gated[0].embedding_space, SPACE_V2);
  });
});

describe('KnowledgeOrchestrator.resolveQueryEmbedder space-gating (real compiled method)', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); });
  afterEach(() => db.close());

  // The fix: the fast LOCAL query embedder is used ONLY when its space equals the
  // active space — not merely its dimension. This prevents a same-dimension but
  // different-space collision (e.g. Gemini pinned to 384d via env lever colliding
  // with local MiniLM 384d) from producing a query vector incomparable to the nodes.

  function withFast(orch, { dimensions, space }) {
    orch.fastQueryEmbedFn = () => ({
      dimensions,
      space,
      embed: async () => vec(0.7),
    });
  }

  test('uses fast local when its SPACE matches active (local IS the active provider)', async () => {
    const LOCAL = 'local:xenova/all-minilm-l6-v2:384';
    const orch = makeOrch(db, { activeSpaceFn: () => LOCAL });
    orch.embedFn = async () => vec(0.1);
    withFast(orch, { dimensions: 384, space: LOCAL });
    const embedder = orch.resolveQueryEmbedder();
    const out = await embedder('q');
    assert.equal(out[0], vec(0.7)[0], 'fast local used (space matches active)');
  });

  test('FALLS BACK to embedFn when local space != active even if DIMENSION matches (the fix)', async () => {
    // Active space is Gemini pinned to 384d; local is also 384d but a DIFFERENT space.
    // Old dim-only check would WRONGLY use local → cross-space garbage. Now: fall back.
    const GEMINI_384 = 'gemini:gemini-embedding-2:384';
    const LOCAL_384 = 'local:xenova/all-minilm-l6-v2:384';
    const orch = makeOrch(db, { activeSpaceFn: () => GEMINI_384 });
    let embedFnUsed = false;
    orch.embedFn = async () => { embedFnUsed = true; return vec(0.2); };
    withFast(orch, { dimensions: 384, space: LOCAL_384 }); // same dim, different space
    const embedder = orch.resolveQueryEmbedder();
    const out = await embedder('q');
    assert.ok(embedFnUsed, 'must fall back to embedFn — local space != active despite equal dims');
    assert.equal(out[0], vec(0.2)[0]);
  });

  test('active space unknown → falls back to legacy DIMENSION check', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => undefined });
    orch.embedFn = async () => vec(0.3);
    // Seed an indexed node at 768d so the dim check has something to compare.
    seedNode(db, { title: 'n', space: 'whatever', fill: 0.1 });
    orch.cachedNodes = orch.db.getAllNodes();
    withFast(orch, { dimensions: 384, space: null }); // 384 != indexed 768 → fall back
    let embedFnUsed = false;
    orch.embedFn = async () => { embedFnUsed = true; return vec(0.3); };
    const embedder = orch.resolveQueryEmbedder();
    await embedder('q');
    assert.ok(embedFnUsed, 'unknown active space → legacy dim check diverts 384-vs-768 to embedFn');
  });

  test('no fastQueryEmbedFn → returns embedFn directly', () => {
    const orch = makeOrch(db, { activeSpaceFn: () => 'x' });
    const fn = async () => vec(0.4);
    orch.embedFn = fn;
    assert.equal(orch.resolveQueryEmbedder(), fn);
  });
});
