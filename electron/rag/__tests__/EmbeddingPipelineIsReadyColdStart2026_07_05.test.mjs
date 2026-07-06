// electron/rag/__tests__/EmbeddingPipelineIsReadyColdStart2026_07_05.test.mjs
//
// Regression for the "first mode query after startup falls back to lexical
// even though a cloud/local embedder is configured" class of symptom
// reported 2026-07-05 (repeated "[ModeHybridRetriever] Embedding provider
// unavailable, using lexical fallback" warnings).
//
// ROOT CAUSE: EmbeddingPipeline.isReady() only checked `provider !== null`.
// LocalEmbeddingProvider is assigned as `this.provider` (either as the
// primary or as the exhaustion fallback) the INSTANT _doInitialize()
// resolves it — its constructor is cheap (no worker spawn, no ONNX load).
// The actual model load happens LAZILY inside LocalEmbeddingProvider's
// private ensureLoaded(), triggered only by the FIRST real embed() call, and
// can take up to 60s cold (disk read + ONNX session init in a worker
// thread). So isReady() reported `true` during that whole cold-start
// window, even though the very next embed() call would block for up to a
// minute. ModeHybridRetriever.isEmbeddingAvailable() gates on isReady() as a
// synchronous "is it safe to do hybrid retrieval right now" check inside a
// live per-query retrieval budget — seeing `true` during the cold window,
// it took the hybrid branch and then stalled.
//
// FIX: IEmbeddingProvider gained an OPTIONAL synchronous isLoaded() method.
// LocalEmbeddingProvider implements it by returning its own `loaded` field
// (the exact boolean ensureLoaded() flips true only after the worker
// confirms init). Cloud HTTP providers (Gemini/OpenAI/Ollama) don't
// implement it at all — no warm-up cost, so EmbeddingPipeline.isReady()
// defaults to true for them via `provider.isLoaded?.() ?? true`, preserving
// their existing behavior exactly.
//
// This test drives EmbeddingPipeline.isReady() directly against BOTH real
// provider shapes:
//   1. A LocalEmbeddingProvider-shaped duck-typed mock with isLoaded() wired
//      to a controllable boolean — proves isReady() correctly reflects the
//      cold/warm transition.
//   2. A duck-typed mock with NO isLoaded() method at all (matching every
//      existing test fixture in this repo, e.g.
//      CrossFeatureReindexConcurrency.test.mjs's `provider` object literal,
//      and every real cloud provider) — proves isReady() still returns true
//      immediately, so this fix cannot regress any existing caller.
//
// EmbeddingPipeline's constructor only stores its (db, vectorStore) args —
// it never queries either until initialize()/processQueue() are called — so
// this test passes `null` for both and never touches SQLite. Runs under
// plain `node --test`, no ELECTRON_RUN_AS_NODE needed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const epPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/EmbeddingPipeline.js');
const { EmbeddingPipeline } = await import(pathToFileURL(epPath).href);

function makePipeline() {
  // Constructor only assigns db/vectorStore to private fields — isReady()
  // never dereferences either, so passing null is safe for this test.
  return new EmbeddingPipeline(null, null);
}

describe('EmbeddingPipeline.isReady() — cold-start awareness (2026-07-05 fix)', () => {
  test('provider === null → not ready (baseline, unchanged behavior)', () => {
    const pipeline = makePipeline();
    assert.equal(pipeline.isReady(), false);
  });

  test('local-shaped provider with isLoaded() → false while cold, true once loaded', () => {
    const pipeline = makePipeline();
    let loaded = false;
    pipeline.provider = {
      name: 'local',
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: 384,
      space: 'local:xenova/all-minilm-l6-v2:384',
      isLoaded: () => loaded,
      isAvailable: async () => loaded,
      embed: async () => [],
      embedQuery: async () => [],
      embedBatch: async () => [],
    };

    assert.equal(pipeline.isReady(), false, 'must report not-ready while the worker has not yet confirmed init');

    loaded = true;
    assert.equal(pipeline.isReady(), true, 'must report ready once isLoaded() flips true');

    // Mirrors LocalEmbeddingProvider resetting `loaded = false` on a worker
    // error/exit event — isReady() must reflect that regression too.
    loaded = false;
    assert.equal(pipeline.isReady(), false, 'must report not-ready again if the provider unloads (worker crash/exit)');
  });

  test('cloud/legacy-shaped provider WITHOUT isLoaded() → always ready the instant it is assigned (no regression)', () => {
    const pipeline = makePipeline();
    // Exact shape used by CrossFeatureReindexConcurrency.test.mjs and every
    // real cloud provider (Gemini/OpenAI/Ollama never implement isLoaded()).
    pipeline.provider = {
      name: 'gemini',
      model: 'gemini-embedding-2',
      dimensions: 768,
      space: 'gemini:gemini-embedding-2:768',
      embed: async () => [],
      embedQuery: async () => [],
      embedBatch: async () => [],
      isAvailable: async () => true,
    };
    assert.equal(pipeline.isReady(), true, 'providers without isLoaded() must default to ready — this must never change for HTTP-wrapper providers');
  });
});
