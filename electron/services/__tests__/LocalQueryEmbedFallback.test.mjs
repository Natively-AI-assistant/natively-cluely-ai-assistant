// electron/services/__tests__/LocalQueryEmbedFallback.test.mjs
// Verifies resolveQueryEmbedder's dimension-checked fallback in
// KnowledgeOrchestrator: the fast on-device query embedder (MiniLM, ~10ms) is
// used ONLY when its dimension matches the indexed nodes — otherwise it falls
// back to the index-matching embedder, because HybridSearchEngine.cosineSimilarity
// silently returns 0 across mismatched dimensions (semantic score → 0).
// Replicates resolveQueryEmbedder's decision logic exactly.
// Run: node --test electron/services/__tests__/LocalQueryEmbedFallback.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of KnowledgeOrchestrator.resolveQueryEmbedder (kept in sync).
function resolveQueryEmbedder({ fastQueryEmbedFn, embedFn, cachedNodes }) {
  if (!fastQueryEmbedFn) return embedFn;
  const fast = fastQueryEmbedFn();
  if (fast.dimensions == null) return embedFn;

  const indexedDim = cachedNodes.find(n => n.embedding && n.embedding.length > 0)?.embedding?.length ?? null;
  if (indexedDim != null && indexedDim !== fast.dimensions) return embedFn;

  const fallback = embedFn;
  return async (text) => {
    const v = await fast.embed(text);
    if (v && v.length > 0) return v;
    if (fallback) return fallback(text);
    return [];
  };
}

const vec = (d, fill = 0.1) => Array(d).fill(fill);
const nodesAt = (d) => [{ embedding: vec(d) }, { embedding: vec(d) }];

describe('local query embed: dimension-checked fallback', () => {
  test('index 384d + local 384d → uses fast local embedder', async () => {
    let localCalls = 0, cloudCalls = 0;
    const embedFn = async () => { cloudCalls++; return vec(384); };
    const fastQueryEmbedFn = () => ({ dimensions: 384, embed: async () => { localCalls++; return vec(384); } });
    const e = resolveQueryEmbedder({ fastQueryEmbedFn, embedFn, cachedNodes: nodesAt(384) });
    const out = await e('q');
    assert.strictEqual(out.length, 384);
    assert.strictEqual(localCalls, 1, 'should use local');
    assert.strictEqual(cloudCalls, 0, 'should NOT call cloud when dims match');
  });

  test('index 1536d (cloud) + local 384d → falls back to cloud embedFn (no silent break)', async () => {
    let localCalls = 0, cloudCalls = 0;
    const embedFn = async () => { cloudCalls++; return vec(1536); };
    const fastQueryEmbedFn = () => ({ dimensions: 384, embed: async () => { localCalls++; return vec(384); } });
    const e = resolveQueryEmbedder({ fastQueryEmbedFn, embedFn, cachedNodes: nodesAt(1536) });
    const out = await e('q');
    assert.strictEqual(out.length, 1536, 'must return index-matching 1536d vector');
    assert.strictEqual(cloudCalls, 1, 'dimension mismatch → must use cloud embedder');
    assert.strictEqual(localCalls, 0, 'must NOT use local on mismatch');
  });

  test('empty index (no embeddings yet) → safe to use local', async () => {
    let localCalls = 0;
    const embedFn = async () => vec(1536);
    const fastQueryEmbedFn = () => ({ dimensions: 384, embed: async () => { localCalls++; return vec(384); } });
    const e = resolveQueryEmbedder({ fastQueryEmbedFn, embedFn, cachedNodes: [{ embedding: undefined }, {}] });
    await e('q');
    assert.strictEqual(localCalls, 1, 'no indexed dim to mismatch → local is safe');
  });

  test('local returns null (model missing) → falls back to cloud embedFn', async () => {
    let cloudCalls = 0;
    const embedFn = async () => { cloudCalls++; return vec(384); };
    const fastQueryEmbedFn = () => ({ dimensions: 384, embed: async () => null });
    const e = resolveQueryEmbedder({ fastQueryEmbedFn, embedFn, cachedNodes: nodesAt(384) });
    const out = await e('q');
    assert.strictEqual(cloudCalls, 1, 'null local result → cloud fallback');
    assert.strictEqual(out.length, 384);
  });

  test('local dimensions unknown (null) → uses cloud embedFn directly', async () => {
    let cloudCalls = 0, fastFactoryCalls = 0;
    const embedFn = async () => { cloudCalls++; return vec(384); };
    const fastQueryEmbedFn = () => { fastFactoryCalls++; return { dimensions: null, embed: async () => vec(384) }; };
    const e = resolveQueryEmbedder({ fastQueryEmbedFn, embedFn, cachedNodes: nodesAt(384) });
    const out = await e('q');
    assert.strictEqual(cloudCalls, 1);
    assert.strictEqual(out.length, 384);
  });

  test('no fast embedder registered → uses embedFn (unchanged legacy behavior)', async () => {
    let cloudCalls = 0;
    const embedFn = async () => { cloudCalls++; return vec(768); };
    const e = resolveQueryEmbedder({ fastQueryEmbedFn: null, embedFn, cachedNodes: nodesAt(768) });
    const out = await e('q');
    assert.strictEqual(cloudCalls, 1);
    assert.strictEqual(out.length, 768);
  });

  test('local + null embedFn fallback + null local result → returns [] (never throws)', async () => {
    const fastQueryEmbedFn = () => ({ dimensions: 384, embed: async () => null });
    const e = resolveQueryEmbedder({ fastQueryEmbedFn, embedFn: null, cachedNodes: nodesAt(384) });
    const out = await e('q');
    assert.deepStrictEqual(out, [], 'graceful empty → getRelevantNodes degrades to keyword-only');
  });
});
