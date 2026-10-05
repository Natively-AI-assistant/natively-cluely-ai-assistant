// The NEWEST embedding initialization wins, not the slowest (2026-09-22).
//
// Found by the live-session embedding comparison (docs/local-embedding-benchmark.md
// §9d). A boot-time `auto` init was probing cloud providers through 429 retries
// when the user's `manual/local` selection arrived. Both _doInitialize() calls
// ran concurrently and each assigned `this.provider` after its await, so the
// SLOW boot resolve finished last and replaced the user's choice:
//
//   Selected provider: local (384d)      ← the user's manual/local, honoured
//   Selected provider: gemini (3072d)    ← the stale boot init, finishing late
//
// Reference files then embedded with a cloud provider while Settings showed
// on-device, and the corpus split across two spaces.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const electronId = require.resolve('electron');
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { isPackaged: false, getAppPath: () => root, getPath: () => os.tmpdir() } } };

const { EmbeddingPipeline } = await import(pathToFileURL(
  path.resolve(root, 'dist-electron/electron/rag/EmbeddingPipeline.js')).href);

const AUTO = { embeddingMode: 'auto', geminiKey: 'g_key' };
const MANUAL_LOCAL = { embeddingMode: 'manual', embeddingProvider: 'local' };

const cloud = (name) => ({ name, dimensions: 3072, space: `${name}:m:3072`, isAvailable: async () => true });
const localish = () => ({ name: 'local', dimensions: 384, space: 'local:xenova/multilingual-e5-small:384', isAvailable: async () => true });

function pipeline() {
  const writes = [];
  const pipe = new EmbeddingPipeline(
    { prepare: (sql) => ({ get: () => undefined, run: (...a) => { if (/last_embedding_space/.test(sql)) writes.push(a[0]); } }) },
    { getIncompatibleSpaceCount: () => 0 },
  );
  pipe.processQueue = async () => {};
  return { pipe, writes };
}

/**
 * Resolver whose latency and result are chosen per config. Installed through
 * the pipeline's resolveEmbeddingProvider seam: the resolver class is inlined
 * into the pipeline bundle, so patching the separately imported class does
 * nothing (the first draft of this test did that, and the real resolver found
 * a local Ollama server).
 */
function withResolver(plan) {
  const proto = EmbeddingPipeline.prototype;
  const original = proto.resolveEmbeddingProvider;
  assert.equal(typeof original, 'function', 'the pipeline exposes the resolve seam');
  proto.resolveEmbeddingProvider = async (config) => {
    const { ms, provider, demotedPinned = null } = plan(config);
    await new Promise((r) => setTimeout(r, ms));
    if (provider instanceof Error) throw provider;
    return { provider, demotedPinned };
  };
  return () => { proto.resolveEmbeddingProvider = original; };
}

describe('overlapping initialize() calls', () => {
  test('a slow stale auto resolve finishing LAST does not replace a newer manual/local selection', async () => {
    const restore = withResolver((c) => c.embeddingMode === 'auto'
      ? { ms: 60, provider: cloud('gemini') }
      : { ms: 5, provider: localish() });
    try {
      const { pipe, writes } = pipeline();
      const stale = pipe.initialize(AUTO);
      const fresh = pipe.initialize(MANUAL_LOCAL);
      await Promise.all([stale, fresh]);
      assert.equal(pipe.getActiveProviderName(), 'local', 'the user\'s newer choice must survive the stale completion');
      assert.deepEqual(writes, ['local:xenova/multilingual-e5-small:384'],
        'only the newest init may persist its space — a stale write flips last_embedding_space');
    } finally { restore(); }
  });

  test('a stale init that THROWS late does not demote the newer provider to the fallback', async () => {
    const restore = withResolver((c) => c.embeddingMode === 'auto'
      ? { ms: 60, provider: new Error('all cloud probes failed') }
      : { ms: 5, provider: cloud('openai') });
    try {
      const { pipe } = pipeline();
      const stale = pipe.initialize(AUTO);
      const fresh = pipe.initialize({ embeddingMode: 'manual', embeddingProvider: 'openai', openaiKey: 'k' });
      await Promise.all([stale, fresh]);
      assert.equal(pipe.getActiveProviderName(), 'openai');
    } finally { restore(); }
  });

  test('the in-order case is unchanged: the newest init still takes effect', async () => {
    const restore = withResolver((c) => c.embeddingMode === 'auto'
      ? { ms: 5, provider: cloud('gemini') }
      : { ms: 30, provider: localish() });
    try {
      const { pipe } = pipeline();
      await Promise.all([pipe.initialize(AUTO), pipe.initialize(MANUAL_LOCAL)]);
      assert.equal(pipe.getActiveProviderName(), 'local');
    } finally { restore(); }
  });

  test('a single initialize still selects its provider', async () => {
    const restore = withResolver(() => ({ ms: 1, provider: cloud('gemini') }));
    try {
      const { pipe } = pipeline();
      await pipe.initialize(AUTO);
      assert.equal(pipe.getActiveProviderName(), 'gemini');
    } finally { restore(); }
  });
});
