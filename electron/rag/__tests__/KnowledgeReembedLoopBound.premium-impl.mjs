// electron/rag/__tests__/KnowledgeReembedLoopBound.test.mjs
//
// ROUND-5 #5 (loop-until-empty bound) + #2/#3 matrix completion for the premium
// KnowledgeOrchestrator. Complements KnowledgeReembedIntegration.test.mjs, which proves
// convergence + the in-flight guard but does NOT exercise:
//   (a) a PERSISTENTLY-failing embedFn TERMINATES (MAX_REEMBED_PASSES bound / passProgress=0
//       break) rather than spinning forever, and leaves nodes stale for self-heal next call;
//   (b) an embedFn that fails the first N times then succeeds CONVERGES;
//   (c) MULTIPLE passes genuinely happen (a >1-pass scenario observed by pass count);
//   (d) resolveQueryEmbedder matrix rows not already covered:
//        - fast.dimensions == null  → embedFn
//        - active unknown + matching dim → fast USED
//        - cloud-active, DIFFERENT dims (not just diff space) → embedFn
//
// REAL compiled KnowledgeOrchestrator + KnowledgeDatabaseManager on in-memory SQLite,
// via Object.create(prototype) to skip the heavy constructor.
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
  orch.embedQueryFn = null;
  orch.activeSpaceFn = activeSpaceFn ?? null;
  orch._indexSpace = undefined;
  return orch;
}

function seedNode(db, { title, space, fill = 0.1 }) {
  const blob = Buffer.alloc(768 * 4);
  for (let i = 0; i < 768; i++) blob.writeFloatLE(fill, i * 4);
  db.prepare(
    `INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space)
     VALUES ('RESUME','experience',?,?,?,?,?)`
  ).run(title, `content of ${title}`, '[]', blob, space);
}

describe('ensureEmbeddingSpace loop bound + self-heal (real compiled method)', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); });
  afterEach(() => db.close());

  test('embedFn that ALWAYS throws TERMINATES (no infinite loop) and leaves nodes stale', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    for (let i = 0; i < 4; i++) seedNode(db, { title: `n${i}`, space: SPACE_V1 });
    orch.cachedNodes = orch.db.getAllNodes();

    let calls = 0;
    orch.embedFn = async () => { calls++; throw new Error('network down'); };

    // If the loop were unbounded on failure it would never resolve. A hard timeout proves
    // termination. passProgress=0 on pass 1 → break after exactly one pass over the stale set.
    await Promise.race([
      orch.ensureEmbeddingSpace(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('ensureEmbeddingSpace DID NOT TERMINATE')), 5000)),
    ]);

    // All 4 nodes attempted exactly once (single pass, then passProgress=0 break) — NOT
    // 4 * MAX_REEMBED_PASSES (which would mean it re-looped the failing set).
    assert.equal(calls, 4, `expected one attempt per node then break, got ${calls}`);
    // Nodes remain stale → excluded from retrieval, retried on next refresh (self-heal).
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 4, 'all nodes stay stale for next-call self-heal');
    // Guard is released so the next call can retry.
    assert.equal(orch._reembedInFlight, false);
  });

  test('SELF-HEAL: a failing call leaves nodes stale; a later call (network back) converges', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'n', space: SPACE_V1 });
    orch.cachedNodes = orch.db.getAllNodes();

    orch.embedFn = async () => { throw new Error('down'); };
    await orch.ensureEmbeddingSpace();
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 1, 'stale after failure');

    // "Next refresh" — network back.
    orch.embedFn = async () => vec(0.9);
    await orch.ensureEmbeddingSpace();
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 0, 'converged on the self-heal call');
  });

  test('embedFn failing the FIRST attempt-per-pass-but-some-progress then succeeding converges', async () => {
    // Two stale nodes A and B. B's embed fails on its first attempt but succeeds thereafter;
    // A always succeeds. Pass 1: A succeeds (passProgress>0 keeps the loop alive), B fails and
    // stays stale. Pass 2: B (now its 2nd attempt) succeeds. Converges within the bound.
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'A', space: SPACE_V1 });
    seedNode(db, { title: 'B', space: SPACE_V1 });
    orch.cachedNodes = orch.db.getAllNodes();

    const bAttempts = new Map();
    orch.embedFn = async (text) => {
      if (text.includes('B')) {
        const n = (bAttempts.get('B') ?? 0) + 1;
        bAttempts.set('B', n);
        if (n === 1) throw new Error('flaky first attempt'); // fail B once
      }
      return vec(0.5);
    };

    await orch.ensureEmbeddingSpace();
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 0, 'flaky node B converges on its 2nd attempt in a later pass');
    assert.equal(bAttempts.get('B'), 2, 'B was attempted exactly twice (fail, then success)');
  });

  test('MULTIPLE passes genuinely occur: a node added each pass is converged in the SAME call', async () => {
    // Drive >1 pass deterministically by inserting a fresh stale node from inside embedFn,
    // so each completed pass leaves the worklist non-empty until we stop. Cap insertions so
    // the loop terminates by exhausting the worklist BEFORE MAX_REEMBED_PASSES (=5), proving
    // the loop is the mechanism (not the bound).
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'seed', space: SPACE_V1 });
    orch.cachedNodes = orch.db.getAllNodes();

    let inserted = 0;
    orch.embedFn = async () => {
      // After embedding the current node, add one more stale node — but only 3 times,
      // forcing pass2, pass3, pass4 to each find exactly one new node.
      if (inserted < 3) {
        inserted++;
        seedNode(db, { title: `late${inserted}`, space: SPACE_V1 });
      }
      return vec(0.5);
    };

    await orch.ensureEmbeddingSpace();
    // All seeded + late-inserted nodes converged within the single call across multiple passes.
    assert.equal(orch.db.getNodesNeedingReembed(SPACE_V2).length, 0, 'multi-pass loop converged every late arrival');
    // 1 seed + 3 late = 4 nodes total, all now in v2.
    assert.equal(orch.db.getAllNodes().length, 4);
    assert.ok(orch.db.getAllNodes().every(n => n.embedding_space === SPACE_V2));
  });

  test('BOUND CAP: passes that keep finding NEW stale nodes stop at MAX_REEMBED_PASSES (no runaway)', async () => {
    // Adversarial: embedFn adds a NEW stale node on EVERY call, so the worklist never empties.
    // The loop must still terminate at MAX_REEMBED_PASSES (5) rather than spinning forever.
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    seedNode(db, { title: 'seed', space: SPACE_V1 });
    orch.cachedNodes = orch.db.getAllNodes();

    let added = 0;
    orch.embedFn = async () => {
      added++;
      seedNode(db, { title: `runaway${added}`, space: SPACE_V1 }); // always adds more
      return vec(0.5);
    };

    await Promise.race([
      orch.ensureEmbeddingSpace(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('loop did not respect MAX_REEMBED_PASSES')), 5000)),
    ]);

    // It terminated. At least one stale node remains (the last-added ones, embedded in a pass
    // that the bound prevented) → picked up by the NEXT refreshCache. Proves bounded, not stuck.
    const remaining = orch.db.getNodesNeedingReembed(SPACE_V2).length;
    assert.ok(remaining > 0, 'bounded loop leaves the unconverged tail for next call');
    assert.equal(orch._reembedInFlight, false, 'guard released after the bounded loop');
  });
});

describe('resolveQueryEmbedder matrix completion (real compiled method)', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); });
  afterEach(() => db.close());

  function withFast(orch, { dimensions, space, embedImpl }) {
    orch.fastQueryEmbedFn = () => ({ dimensions, space, embed: embedImpl ?? (async () => vec(0.7)) });
  }

  test('fast.dimensions == null → embedFn (cannot dimension-check, refuse fast path)', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    let embedFnUsed = false;
    orch.embedFn = async () => { embedFnUsed = true; return vec(0.2); };
    withFast(orch, { dimensions: null, space: SPACE_V2 }); // null dims even though space matches
    const embedder = orch.resolveQueryEmbedder();
    await embedder('q');
    assert.ok(embedFnUsed, 'null fast.dimensions must divert to embedFn (line 173 guard)');
  });

  test('active space UNKNOWN + EMPTY corpus + fast dim present → legacy dim check allows fast local', async () => {
    // With no embedded nodes AND no active space, _committedIndexSpace() is undefined,
    // so resolveQueryEmbedder falls to the legacy dimension guard. fast has dims and
    // there's no indexed dim to mismatch → fast local is used.
    const orch = makeOrch(db, { activeSpaceFn: () => undefined });
    orch.cachedNodes = []; // empty corpus → no derivable committed space
    orch.embedFn = async () => vec(0.2);
    withFast(orch, { dimensions: 768, space: null });
    const embedder = orch.resolveQueryEmbedder();
    const out = await embedder('q');
    assert.equal(out[0], vec(0.7)[0], 'empty corpus + unknown space + present dims → legacy check allows fast local');
  });

  test('active space UNKNOWN but corpus has a derivable committed space → query in THAT space (not fast-local with diff space)', async () => {
    // A node in space S makes _committedIndexSpace() = S even with active unknown. The
    // fast local embedder (space null/different) is then NOT comparable → embedFn used.
    const orch = makeOrch(db, { activeSpaceFn: () => undefined });
    seedNode(db, { title: 'n', space: SPACE_V2, fill: 0.1 });
    orch.cachedNodes = orch.db.getAllNodes();
    let embedFnUsed = false;
    orch.embedFn = async () => { embedFnUsed = true; return vec(0.2); };
    withFast(orch, { dimensions: 768, space: null }); // fast space != committed S
    const embedder = orch.resolveQueryEmbedder();
    await embedder('q');
    assert.ok(embedFnUsed, 'committed space derivable → must query in it, not via a different-space fast local');
  });

  test('cloud-active with DIFFERENT dimensions (1536 vs fast 384) → embedFn', async () => {
    const CLOUD_1536 = 'openai:text-embedding-3-small:1536';
    const orch = makeOrch(db, { activeSpaceFn: () => CLOUD_1536 });
    let embedFnUsed = false;
    orch.embedFn = async () => { embedFnUsed = true; return vec(0.3); };
    // Space differs AND dims differ — caught by the space-mismatch arm (fast.space != active).
    withFast(orch, { dimensions: 384, space: 'local:xenova/all-minilm-l6-v2:384' });
    const embedder = orch.resolveQueryEmbedder();
    await embedder('q');
    assert.ok(embedFnUsed, 'cloud-active different dims/space → embedFn');
  });

  test('committed==local-space + fast embed returns null → returns [] (NO cross-space cloud fallback — the MEDIUM-2 fix)', async () => {
    // When the corpus is committed to the LOCAL space (fast.space === committed) and
    // the local embed fails at runtime, we must NOT fall back to the cloud embedFn —
    // that would produce a cloud-space query vector compared against local-space nodes
    // (silent garbage). Returning [] is correct (empty, not wrong).
    const LOCAL = 'local:xenova/all-minilm-l6-v2:384';
    const orch = makeOrch(db, { activeSpaceFn: () => undefined });
    orch._indexSpace = LOCAL; // corpus committed to local (degraded mode)
    let embedFnUsed = false;
    orch.embedFn = async () => { embedFnUsed = true; return vec(0.4); };
    withFast(orch, { dimensions: 384, space: LOCAL, embedImpl: async () => null });
    const embedder = orch.resolveQueryEmbedder();
    const out = await embedder('q');
    assert.ok(!embedFnUsed, 'must NOT cloud-fall-back when committed to local space');
    assert.deepEqual(out, [], 'empty result, never a cross-space query');
  });

  test('committed==local-space + fast embed succeeds → fast local used', async () => {
    const LOCAL = 'local:xenova/all-minilm-l6-v2:384';
    const orch = makeOrch(db, { activeSpaceFn: () => undefined });
    orch._indexSpace = LOCAL;
    orch.embedFn = async () => vec(0.4);
    withFast(orch, { dimensions: 384, space: LOCAL });
    const embedder = orch.resolveQueryEmbedder();
    const out = await embedder('q');
    assert.equal(out[0], vec(0.7)[0], 'local embedder used when committed to local space');
  });

  test('fast embed null AND no embedFn → returns [] (never throws, never cross-space)', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    orch.embedFn = null;
    withFast(orch, { dimensions: 768, space: SPACE_V2, embedImpl: async () => null });
    const embedder = orch.resolveQueryEmbedder();
    const out = await embedder('q');
    assert.deepEqual(out, [], 'null fast + no embedFn → empty array (caller treats as no-retrieval)');
  });

  test('cloud branch PREFERS the asymmetric embedQueryFn over the document embedFn', async () => {
    // committed == cloud (SPACE_V2), fast local is a different space → cloud branch.
    // When an embedQueryFn (asymmetric retrieval framing) is registered, it must be
    // used for the query instead of embedFn (document framing). Same space, better recall.
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    let docUsed = false, queryUsed = false;
    orch.embedFn = async () => { docUsed = true; return vec(0.1); };
    orch.embedQueryFn = async () => { queryUsed = true; return vec(0.2); };
    withFast(orch, { dimensions: 384, space: 'local:xenova/all-minilm-l6-v2:384' }); // diff space → cloud branch
    const embedder = orch.resolveQueryEmbedder();
    const out = await embedder('q');
    assert.ok(queryUsed, 'asymmetric embedQueryFn must be used on the cloud query path');
    assert.ok(!docUsed, 'document embedFn must NOT be used for queries when embedQueryFn is wired');
    assert.equal(out[0], vec(0.2)[0]);
  });

  test('cloud branch falls back to embedFn when no embedQueryFn registered (back-compat)', async () => {
    const orch = makeOrch(db, { activeSpaceFn: () => SPACE_V2 });
    let docUsed = false;
    orch.embedFn = async () => { docUsed = true; return vec(0.1); };
    orch.embedQueryFn = null; // not wired
    withFast(orch, { dimensions: 384, space: 'local:xenova/all-minilm-l6-v2:384' });
    const embedder = orch.resolveQueryEmbedder();
    await embedder('q');
    assert.ok(docUsed, 'with no embedQueryFn, the cloud query path uses embedFn (prior behavior)');
  });
});
