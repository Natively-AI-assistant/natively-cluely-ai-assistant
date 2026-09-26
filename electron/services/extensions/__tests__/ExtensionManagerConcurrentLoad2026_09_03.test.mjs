// Regression test for: two concurrent load()s spawned two utilityProcesses and
// orphaned one of them.
//
// THE BUG. ExtensionManager.load() registered the host in `this.hosts` only
// AFTER `await host.start()` resolved:
//
//     const existing = this.hosts.get(id);
//     if (existing) return existing;          // <- both callers miss here
//     const host = this.createHost({...});    // <- both spawn a utilityProcess
//     await host.start();                     // <- both await
//     this.hosts.set(id, host);               // <- second overwrites the first
//
// Two calls that overlap anywhere inside `start()` therefore both construct a
// host. The second `hosts.set` overwrites the first entry, so unload() and
// unloadAll() — which both read `this.hosts` — can only ever stop the survivor.
// The first utilityProcess stays alive for the rest of the session with its
// model resident (hundreds of MB for a reranker), is invisible to running(),
// and is never stopped even on quit.
//
// The overlap is reachable in production, not theoretical:
//   - RerankerRegistry.rerankVia() calls source.load(id) guarded only by
//     source.running(), which reads hosts.keys() and is still empty during a
//     cold start (RerankerRegistry.ts).
//   - ipcHandlers' `extensions:set-enabled` fires `void manager.load(id)`
//     without awaiting it.
//   - loadEnabled() may still be starting the same id at boot.
// A single rerank can reach it on its own: the seam port declares no batchSize,
// so one 30-candidate query issues 5 sequential rerankVia() calls, and a
// timeout on the first leaves its load() running while the second starts
// another.
//
// THE FIX, guarded here: an in-flight promise map. The first caller stores its
// pending load under the id before awaiting anything; every concurrent caller
// returns that same promise, so exactly one host is ever constructed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const base = path.join(repoRoot, 'dist-electron/electron/services/extensions');
const { ExtensionManager } = require(path.join(base, 'ExtensionManager.js'));

const manifest = {
  id: 'test-ext',
  name: 'Test Extension',
  version: '1.0.0',
  author: 'test',
  main: 'index.js',
  permissions: [],
  natively: { minVersion: '0.0.1' },
};

const record = { id: 'test-ext', manifest, config: {}, enabled: true, installedAt: 0 };

/** A manager whose host construction is observable and whose start() we gate. */
function makeManager() {
  const created = [];
  let releaseStart;
  const startGate = new Promise((resolve) => { releaseStart = resolve; });

  const manager = new ExtensionManager({
    registry: { get: (id) => (id === record.id ? record : null), list: () => [record] },
    modelStore: { modelDir: () => path.join(repoRoot, 'no-such-model-dir') },
    appVersion: '2.8.8',
    confirmInstall: async () => true,
    logger: { info() {}, warn() {}, error() {} },
    rootOverride: path.join(repoRoot, 'no-such-extension-root'),
    createHost: () => {
      const host = {
        started: false,
        stopped: false,
        async start() { await startGate; this.started = true; },
        async stop() { this.stopped = true; },
      };
      created.push(host);
      return host;
    },
  });

  return { manager, created, releaseStart: () => releaseStart() };
}

test('two concurrent load()s construct exactly one host', async () => {
  const { manager, created, releaseStart } = makeManager();

  // Both calls enter load() before either start() resolves — the exact overlap
  // the production call sites produce.
  const both = Promise.all([manager.load('test-ext'), manager.load('test-ext')]);
  releaseStart();
  const [a, b] = await both;

  assert.equal(
    created.length,
    1,
    `concurrent load() calls constructed ${created.length} hosts. Each host is a utilityProcess ` +
    'with the extension model resident; only the last one registered in `hosts` can ever be ' +
    'stopped, so every extra one is orphaned for the life of the app.',
  );
  assert.equal(a, b, 'both callers must receive the same host instance');
  assert.equal(manager.running().length, 1, 'exactly one extension should be reported running');
});

test('no host survives unloadAll() after concurrent loads — nothing is orphaned', async () => {
  const { manager, created, releaseStart } = makeManager();

  const both = Promise.all([manager.load('test-ext'), manager.load('test-ext')]);
  releaseStart();
  await both;
  await manager.unloadAll();

  const orphans = created.filter((h) => h.started && !h.stopped);
  assert.deepEqual(
    orphans,
    [],
    `${orphans.length} started host(s) were never stopped by unloadAll(). An unstopped host is a ` +
    'live utilityProcess holding its model, unreachable through the manager.',
  );
  assert.equal(manager.running().length, 0, 'unloadAll() must leave nothing running');
});

test('unload() during an in-flight load does not leave a started host behind', async () => {
  const { manager, created, releaseStart } = makeManager();

  const loading = manager.load('test-ext');
  // unload() arrives while start() is still pending — e.g. the user toggles the
  // extension off during a cold start.
  const unloading = manager.unload('test-ext');
  releaseStart();
  await Promise.all([loading, unloading]);

  const orphans = created.filter((h) => h.started && !h.stopped);
  assert.deepEqual(
    orphans,
    [],
    'a load that completes after unload() left a running host the manager no longer tracks',
  );
  assert.equal(manager.running().length, 0, 'unload() must win over an in-flight load');
});

test('a second load() after the first completes still reuses the registered host', async () => {
  const { manager, created, releaseStart } = makeManager();
  releaseStart();

  const first = await manager.load('test-ext');
  const second = await manager.load('test-ext');

  assert.equal(created.length, 1, 'the cached-host fast path must not construct a second host');
  assert.equal(first, second);
});

test('a failed start() is not cached — a later load() may retry', async () => {
  let attempts = 0;
  const manager = new ExtensionManager({
    registry: { get: (id) => (id === record.id ? record : null), list: () => [record] },
    modelStore: { modelDir: () => path.join(repoRoot, 'no-such-model-dir') },
    appVersion: '2.8.8',
    confirmInstall: async () => true,
    logger: { info() {}, warn() {}, error() {} },
    rootOverride: path.join(repoRoot, 'no-such-extension-root'),
    createHost: () => {
      attempts += 1;
      const failing = attempts === 1;
      return {
        async start() { if (failing) throw new Error('boom'); },
        async stop() {},
      };
    },
  });

  assert.equal(await manager.load('test-ext'), null, 'a failed start must resolve null');
  assert.notEqual(
    await manager.load('test-ext'),
    null,
    'the in-flight latch must be cleared after a failure, otherwise a single transient start ' +
    'error would permanently wedge the extension for the rest of the session',
  );
  assert.equal(attempts, 2);
});
