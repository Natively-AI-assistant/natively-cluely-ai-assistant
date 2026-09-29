// Quitting while the local embedder is mid-batch must not abort the app (2026-09-22).
//
// Live-reproduced: quit (the app's own 'quit-app' IPC) while reference files
// were indexing → SIGABRT, "terminating due to uncaught exception of type
// Napi::Error", 4/4 on multilingual-e5-small and 3/3 on MiniLM. Process exit
// tore the worker thread down inside a native ONNX run. With before-quit
// deferring until the in-flight batch finishes: 0/4, exit code 0, drained in
// 1.1-3.5s. These tests pin the provider half of that contract without ONNX;
// the main.ts half is pinned by source.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const electronId = require.resolve('electron');
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { isPackaged: false, getAppPath: () => root, getPath: () => os.tmpdir() } } };
const { LocalEmbeddingProvider } = await import(pathToFileURL(
  path.resolve(root, 'dist-electron/electron/rag/providers/LocalEmbeddingProvider.js')).href);

/** A provider whose worker is a fake that records terminate() and when it happened. */
function providerWithFakeWorker() {
  const p = new LocalEmbeddingProvider();
  const events = [];
  p.worker = { terminate: async () => { events.push({ ev: 'terminate', pending: p.pendingRequests.size }); }, postMessage: () => {} };
  globalThis.__nativelyLiveLocalEmbeddingProviders?.add(p) ?? (globalThis.__nativelyLiveLocalEmbeddingProviders = new Set([p]));
  return { p, events };
}
const owe = (p, id) => p.pendingRequests.set(id, { resolve: () => {}, reject: () => {}, timer: setTimeout(() => {}, 0) });

describe('LocalEmbeddingProvider.shutdownForQuit', () => {
  test('waits for the in-flight batch before terminating the worker', async () => {
    const { p, events } = providerWithFakeWorker();
    owe(p, 1);
    setTimeout(() => p.pendingRequests.delete(1), 120);   // the batch finishes
    const outcome = await p.shutdownForQuit(2000);
    assert.equal(outcome, 'drained');
    assert.deepEqual(events, [{ ev: 'terminate', pending: 0 }], 'terminate() only once nothing is in flight');
  });

  test('refuses new requests once closing, so the drain cannot be refilled', async () => {
    const { p } = providerWithFakeWorker();
    await p.shutdownForQuit(100);
    await assert.rejects(p.postToWorker({ type: 'embed', texts: ['x'] }, 1000), /quitting/);
  });

  test('is bounded: a wedged worker is terminated at the deadline', async () => {
    const { p, events } = providerWithFakeWorker();
    owe(p, 7);                                   // never answers
    const t0 = Date.now();
    const outcome = await p.shutdownForQuit(150);
    assert.equal(outcome, 'timed-out');
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(events.length, 1);
    p.pendingRequests.clear();
  });

  test('an idle provider reports idle and needs no wait', async () => {
    const { p, events } = providerWithFakeWorker();
    assert.equal(await p.shutdownForQuit(5000), 'idle');
    assert.equal(events.length, 1);
  });

  test('hasInFlightWorkForQuit sees only providers that still owe a reply', async () => {
    globalThis.__nativelyLiveLocalEmbeddingProviders?.clear();
    const { p } = providerWithFakeWorker();
    assert.equal(LocalEmbeddingProvider.hasInFlightWorkForQuit(), false);
    owe(p, 3);
    assert.equal(LocalEmbeddingProvider.hasInFlightWorkForQuit(), true);
    p.pendingRequests.clear();
  });
});

describe('main.ts defers the quit for the drain (source pin)', () => {
  const src = fs.readFileSync(path.resolve(root, 'electron/main.ts'), 'utf8');
  const helper = src.slice(src.indexOf('const deferQuitForLocalEmbeddingDrain'), src.indexOf('app.on("before-quit"'));
  const handler = src.slice(src.indexOf('app.on("before-quit"'), src.indexOf('console.log("App is quitting, cleaning up resources...");'));
  test('before-quit consults the drain FIRST and returns while it runs', () => {
    assert.match(handler, /^app\.on\("before-quit", \(event\) => \{\s*if \(deferQuitForLocalEmbeddingDrain\(event\)\) return;/);
  });
  test('the helper runs once, only with work in flight, and re-quits when done', () => {
    assert.match(helper, /if \(localEmbeddingQuitDrainStarted\) return false;\s*localEmbeddingQuitDrainStarted = true;/, 'marked before deferring, so the second quit is not deferred again');
    assert.match(helper, /if \(!LocalEmbeddingProvider\.hasInFlightWorkForQuit\(\)\) return false;/);
    assert.match(helper, /event\.preventDefault\(\)/);
    assert.match(helper, /shutdownAllForQuit\(LOCAL_EMBEDDING_QUIT_DRAIN_MS\)/);
    assert.match(helper, /\.finally\(\(\) => app\.quit\(\)\)/);
  });
});
