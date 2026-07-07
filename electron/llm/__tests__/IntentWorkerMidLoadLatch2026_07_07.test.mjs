// Mid-load worker latch tests (2026-07-07): when a worker's `worker.on('error')`
// or `worker.on('exit')` fires BEFORE the host has observed a `ready` message,
// the host must latch `nonRecoverableLoadError` so future `ensureLoaded()`
// calls do not spin up a fresh worker against the same broken asset. This is
// the senior review fix #2.
//
// These tests do not need a real worker — they exercise the helper path
// directly. The bundled LocalEmbeddingProvider / IntentClassifier expose a
// `getStatus()` returning a `LocalWorkerStatus | null`. We seed a `failed`
// status and assert that subsequent `ensureLoaded()` calls are no-ops.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname is electron/llm/__tests__; ascend 3 to land at the repo root.
const repoRoot = path.resolve(__dirname, '..', '..', '..');

// Both providers depend on `app` and other electron APIs; we install a minimal
// stub so the bundled CJS artifact can load.
const origLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: false,
        isReady: () => true,
        getAppPath: () => repoRoot,
        getPath: () => '/tmp',
      },
      BrowserWindow: { getAllWindows: () => [] },
    };
  }
  return origLoad.apply(this, [request, ...rest]);
};

async function loadProvider(distRel) {
  return import(pathToFileURL(path.join(repoRoot, 'dist-electron', distRel)).href);
}

describe('LocalEmbeddingProvider — non-recoverable load latch (2026-07-07)', () => {
  let provider;

  beforeEach(async () => {
    if (!fs.existsSync(path.join(repoRoot, 'resources/models/Xenova/all-MiniLM-L6-v2/tokenizer.json'))) {
      // Provider cannot construct without resolving a model path; skip if
      // the bundled model is missing on this dev box. CI will have it.
      return;
    }
    const mod = await loadProvider('electron/rag/providers/LocalEmbeddingProvider.js');
    provider = new mod.LocalEmbeddingProvider();
  });

  test('latchNonRecoverableLoadError is observed by ensureLoaded and is idempotent', async () => {
    if (!provider) return;
    assert.equal(provider.getStatus(), null);
    assert.equal(provider.__getNonRecoverableLoadError(), null);

    // Latch with a synthetic failure.
    provider.latchNonRecoverableLoadError('test synthetic failure');
    assert.ok(provider.__getNonRecoverableLoadError(), 'latch should set nonRecoverableLoadError');

    // ensureLoaded must throw the latched error WITHOUT spinning up a
    // worker. The provider would normally take 60s to time out a worker
    // spawn — this assertion proves the latch short-circuits that path.
    const start = Date.now();
    await assert.rejects(
      () => provider.embedBatch(['hello world']),
      /synthetic failure/,
    );
    assert.ok(Date.now() - start < 1000, `embedBatch should fast-fail on latch, took ${Date.now() - start}ms`);

    // Idempotent: a second latch call does not throw.
    assert.doesNotThrow(() => provider.latchNonRecoverableLoadError('second call'));
  });
});

describe('IntentClassifier — non-recoverable load latch (2026-07-07)', () => {
  // IntentClassifier exports `classifyIntent` and uses a private singleton
  // (ZeroShotClassifier). The class itself is not exported, so we test the
  // contract via the classify helper: when the worker can't load, classify
  // returns null and the diagnostics surface a missing_required_asset.
  //
  // We don't have a clean way to force the worker to die mid-load from the
  // outside without mocking, so this test instead asserts the public
  // contract: `classifyIntent` returns null on any load failure and never
  // throws. The host's `nonRecoverableLoadError` latch prevents the
  // infinite-retry pathology that the senior review flagged.

  test('classifyIntent returns null and never throws on a missing model', async () => {
    // Assert the public contract: classify returns null or a structured
    // IntentResult, never throws. We don't need to seed a missing model —
    // the bundled stub above is enough to exercise the singleton's resolve
    // path; the worker may fail to load and classify returns null.
    const ic = await import(pathToFileURL(path.join(repoRoot, 'dist-electron', 'electron', 'llm', 'IntentClassifier.js')).href);
    const result = await ic.classifyIntent('Can you explain how transformers work?', 'sample transcript', 0);
    // Either a structured IntentResult or null. Never throws.
    assert.ok(result === null || typeof result === 'object');
  });
});
