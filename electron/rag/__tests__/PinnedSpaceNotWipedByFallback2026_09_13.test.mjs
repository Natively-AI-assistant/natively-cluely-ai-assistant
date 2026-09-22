// A stand-in embedding provider must not migrate the corpus into its own space.
//
// Measured 2026-09-13 against Evin's live corpus. Settings held
// { mode:'manual', provider:'natively', model:'voyage-4' } and the corpus was
// natively:voyage-4:2048. The Natively key was absent at boot, so:
//
//   buildCandidates() never built NativelyEmbeddingProvider (no key)
//   → the manual filter `c.name === 'natively'` returned an EMPTY list
//   → the probe loop never ran, so demotedPinned stayed null and no re-probe
//     was ever armed
//   → the resolver logged the generic auto-mode "No cloud/Ollama provider
//     available" line, naming nothing about the pin
//   → 15s later scheduleAutoReindex() saw 3 meetings whose space != the active
//     (local) space and cleared every 2048-d vector, re-embedding the corpus at
//     384-d MiniLM. Entering the key re-ran the whole migration in reverse.
//
// EmbeddingBootDemotionReprobe2026_09_11 cannot catch this: it asserts the
// TRANSIENT path, which builds the provider. A pin with no key never gets built.

import { test, describe, mock } from 'node:test';
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

const { EmbeddingProviderResolver } = await import(pathToFileURL(
  path.resolve(root, 'dist-electron/electron/rag/EmbeddingProviderResolver.js')).href);
const { EmbeddingPipeline } = await import(pathToFileURL(
  path.resolve(root, 'dist-electron/electron/rag/EmbeddingPipeline.js')).href);

const PINNED_NO_KEY = { embeddingMode: 'manual', embeddingProvider: 'natively', geminiKey: 'g_key' };

describe('a pinned provider that produced no candidate', () => {
  test('resolves to the bundled model and reports no demotion (the hole this test exists for)', async () => {
    assert.deepEqual(EmbeddingProviderResolver.buildCandidates(PINNED_NO_KEY).map(c => c.name), [],
      'a natively pin with no key builds no candidate — not even a failing one');
    const r = await EmbeddingProviderResolver.resolveWithDemotion(PINNED_NO_KEY);
    assert.equal(r.provider.name, 'local');
    assert.equal(r.demotedPinned, null, 'nothing was built, so there is no instance to re-probe');
  });

  test('names the user\'s selection instead of reporting a generic fallthrough', async () => {
    const warn = mock.method(console, 'warn');
    try { await EmbeddingProviderResolver.resolveWithDemotion(PINNED_NO_KEY); } finally { warn.mock.restore(); }
    const said = warn.mock.calls.map(c => String(c.arguments[0])).join('\n');
    assert.match(said, /selected 'natively'/, 'the log must name the pin, not read as an auto-mode fallthrough');
    assert.match(said, /not configured/);
  });
});

/** A pipeline with its provider fields forced, so the predicate is testable without a DB or a network. */
function pipelineRunning({ pinned, activeName }) {
  const p = Object.create(EmbeddingPipeline.prototype);
  p.pinnedProviderName = pinned;
  p.provider = activeName ? { name: activeName, dimensions: 384, space: `${activeName}:x:384` } : null;
  return p;
}

describe('isRunningOnUnpinnedFallback', () => {
  test('TRUE when a pin is set and something else is active — both the no-candidate and transient-demotion cases land here', () => {
    assert.equal(pipelineRunning({ pinned: 'natively', activeName: 'local' }).isRunningOnUnpinnedFallback(), true);
  });
  test('FALSE when the pinned provider is the one running', () => {
    assert.equal(pipelineRunning({ pinned: 'natively', activeName: 'natively' }).isRunningOnUnpinnedFallback(), false);
  });
  test('FALSE for a deliberate local pin — local IS the choice, so its space is the right migration target', () => {
    assert.equal(pipelineRunning({ pinned: 'local', activeName: 'local' }).isRunningOnUnpinnedFallback(), false);
  });
  test('FALSE in auto mode — the chain is the intent, so a fallthrough is a real provider switch', () => {
    assert.equal(pipelineRunning({ pinned: '', activeName: 'local' }).isRunningOnUnpinnedFallback(), false);
  });
  test('FALSE before anything has resolved — nothing active means nothing to sweep either', () => {
    assert.equal(pipelineRunning({ pinned: 'natively', activeName: null }).isRunningOnUnpinnedFallback(), false);
  });
});

describe('scheduleAutoReindex is gated on the pin, and re-armed when it returns', () => {
  /** RAGManager with only the collaborators scheduleAutoReindex touches. */
  async function managerWith(pipeline, incompatibleCount = 3) {
    const { RAGManager } = await import(pathToFileURL(
      path.resolve(root, 'dist-electron/electron/rag/RAGManager.js')).href);
    const m = Object.create(RAGManager.prototype);
    m.embeddingPipeline = pipeline;
    m.vectorStore = { getIncompatibleSpaceCount: () => incompatibleCount };
    m._autoReindexTimer = null;
    return m;
  }

  test('does NOT arm the corpus-clearing sweep while a stand-in is active', async () => {
    const pipe = pipelineRunning({ pinned: 'natively', activeName: 'local' });
    pipe.getActiveSpaceKey = () => 'local:xenova/all-minilm-l6-v2:384';
    pipe.getActiveProviderName = () => 'local';
    const m = await managerWith(pipe);
    m.scheduleAutoReindex();
    assert.equal(m._autoReindexTimer, null,
      'a deferred sweep must leave NO timer — arming it clears every vector in the pinned space');
  });

  test('DOES arm it when the pinned provider is the one running', async () => {
    const pipe = pipelineRunning({ pinned: 'natively', activeName: 'natively' });
    pipe.getActiveSpaceKey = () => 'natively:voyage-4:2048';
    pipe.getActiveProviderName = () => 'natively';
    const m = await managerWith(pipe);
    m.scheduleAutoReindex();
    assert.notEqual(m._autoReindexTimer, null, 'a genuine provider switch still migrates the corpus');
    clearTimeout(m._autoReindexTimer);
  });

  test('promoting the pinned provider back re-arms the sweep that was deferred', () => {
    const pipe = pipelineRunning({ pinned: 'natively', activeName: 'local' });
    pipe.db = { prepare: () => ({ run: () => {} }) };
    let rearmed = 0;
    pipe.onPinnedSpaceRestored = () => { rearmed++; };
    pipe.promoteFallbackProvider({ name: 'natively', dimensions: 2048, space: 'natively:voyage-4:2048' });
    assert.equal(rearmed, 1, 'the deferred sweep runs once the pinned space is back — it reconciles the gap');
  });

  test('a promotion that does NOT restore the pin re-arms nothing', () => {
    const pipe = pipelineRunning({ pinned: 'natively', activeName: 'natively' });
    pipe.db = { prepare: () => ({ run: () => {} }) };
    let rearmed = 0;
    pipe.onPinnedSpaceRestored = () => { rearmed++; };
    pipe.promoteFallbackProvider({ name: 'local', dimensions: 384, space: 'local:xenova/all-minilm-l6-v2:384' });
    assert.equal(rearmed, 0, 'demoting AWAY from the pin must not trigger a migration into the stand-in');
  });
});
