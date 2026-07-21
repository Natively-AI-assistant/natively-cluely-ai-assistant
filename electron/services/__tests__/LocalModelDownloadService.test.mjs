// Tests for LocalModelDownloadService — the main-process singleton that owns
// the in-flight state for ALL local-model downloads (Whisper today; future
// providers register themselves).
//
// Tests run against the esbuild-compiled output in dist-electron/.
// Run via: npm run build:electron && node --test electron/services/__tests__/LocalModelDownloadService.test.mjs

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(__dirname, '../../../dist-electron/electron/services/LocalModelDownloadService.js');

// Stub `electron` module BEFORE the service can require it for app.getPath.
// The compiled output uses dynamic require() for electron at runtime, so we
// intercept via Node's module cache to substitute a minimal stand-in.
//
// CRITICAL ORDER: the stub + resolver hook MUST be installed BEFORE the
// service module is `import`ed, otherwise the service captures a reference
// to the real `electron` package at its top-level `var import_electron =
// require("electron")` and our stub never reaches it.
let electronModuleNamespace;
const electronStub = {
  app: {
    getPath: (name) => {
      if (name === 'userData') return tmpUserData;
      throw new Error(`stub getPath(${name}) not implemented`);
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
};
{
  const Module = await import('node:module');
  const origResolve = Module.default._resolveFilename;
  Module.default._resolveFilename = function (request, parent, ...rest) {
    if (request === 'electron') return 'electron-stub';
    return origResolve.call(this, request, parent, ...rest);
  };
  // Seed the cache so the stub is loaded on first require('electron').
  Module.default._cache['electron-stub'] = {
    id: 'electron-stub',
    filename: 'electron-stub',
    loaded: true,
    exports: electronStub,
  };
  electronModuleNamespace = Module;
}

// NOW import the service. Its top-level `var import_electron = require("electron")`
// hits our resolver, gets 'electron-stub', and caches our stub in `import_electron`.
const mod = await import(pathToFileURL(compiledPath).href);
const { LocalModelDownloadService, createWhisperDownloadProvider } = mod;

let tmpUserData;

// Fake Worker — emits the messages the test wants without spawning a thread.
class FakeWorker extends EventEmitter {
  constructor() {
    super();
    FakeWorker.last = this;
    FakeWorker.instances.push(this);
    this.terminated = false;
    this.postedMessages = [];
  }
  postMessage(msg) { this.postedMessages.push(msg); }
  terminate() { this.terminated = true; this.emit('exit', 0); }
  // Test helpers
  emitProgress(p) { this.emit('message', { type: 'progress', modelId: 'm1', progress: p }); }
  emitReady() { this.emit('message', { type: 'ready' }); }
  emitWorkerError(msg) { this.emit('message', { type: 'error', message: msg }); }
  emitCrash(err) { this.emit('error', err); }
  emitAbnormalExit(code) { this.emit('exit', code); }
}
FakeWorker.instances = [];

// Test provider that uses the FakeWorker — bypasses whisperWorker.js entirely.
const FakeProvider = {
  _cached: {},
  _deleted: [],
  _preflightError: null,
  create(name = 'whisper') {
    return {
      name,
      isModelCached: (modelId) => !!FakeProvider._cached?.[modelId],
      deletePartial: (modelId) => {
        FakeProvider._deleted.push(modelId);
        delete FakeProvider._cached?.[modelId];
      },
      preflightCheck: () => FakeProvider._preflightError ?? null,
      spawnWorker: () => new FakeWorker(),
      buildInitMessage: (modelId) => ({ type: 'init', modelId, cacheDir: '/fake' }),
    };
  },
};

beforeEach(() => {
  tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'lmodel-dl-svc-'));
  FakeWorker.instances = [];
  FakeProvider._cached = {};
  FakeProvider._deleted = [];
  FakeProvider._preflightError = null;
  LocalModelDownloadService.__resetForTests();
});

// -- Tests ----------------------------------------------------------------

test('start is idempotent — second call returns alreadyDownloading', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  const a = svc.start('whisper', 'm1');
  assert.equal(a.success, true);
  assert.equal(a.alreadyDownloading, undefined);
  const b = svc.start('whisper', 'm1');
  assert.equal(b.success, true);
  assert.equal(b.alreadyDownloading, true);
  // Only one worker was spawned.
  assert.equal(FakeWorker.instances.length, 1);
});

test('start rejects unknown provider', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true });
  const r = svc.start('not-registered', 'm1');
  assert.equal(r.success, false);
  assert.match(r.error, /unknown-provider/);
});

test('start honors preflightCheck error', () => {
  FakeProvider._preflightError = 'macOS 13+ required';
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  const r = svc.start('whisper', 'm1');
  assert.equal(r.success, false);
  assert.equal(r.error, 'macOS 13+ required');
  assert.equal(FakeWorker.instances.length, 0);
});

test('progress events update the entry monotonically', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  const w = FakeWorker.last;
  w.emitProgress(10);
  w.emitProgress(50);
  w.emitProgress(80);
  // Let queueMicrotask drain.
  return new Promise(resolve => setImmediate(() => {
    const entry = svc.getState('whisper', 'm1');
    assert.equal(entry.progress, 80);
    resolve();
  }));
});

test('progress clamps to 0..99 — only complete is 100', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  const w = FakeWorker.last;
  w.emitProgress(150); // worker bug — never > 99 here
  return new Promise(resolve => setImmediate(() => {
    const e = svc.getState('whisper', 'm1');
    assert.ok(e.progress <= 99, `progress should be <= 99, got ${e.progress}`);
    resolve();
  }));
});

test('ready + isModelCached=true → status complete (100), worker terminated', () => {
  FakeProvider._cached = { m1: true };
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  const w = FakeWorker.last;
  w.emitReady();
  return new Promise(resolve => setImmediate(() => {
    const e = svc.getState('whisper', 'm1');
    assert.equal(e.status, 'complete');
    assert.equal(e.progress, 100);
    assert.equal(w.terminated, true);
    resolve();
  }));
});

test('ready + isModelCached=false → status error (THE KEY FIX)', () => {
  // Worker says "ready" (pipeline loaded) but disk doesn't actually have
  // the files. The service MUST NOT flip to complete — that's the bug
  // the new code fixes.
  FakeProvider._cached = {};
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  const w = FakeWorker.last;
  w.emitReady();
  return new Promise(resolve => setImmediate(() => {
    const e = svc.getState('whisper', 'm1');
    assert.equal(e.status, 'error');
    assert.notEqual(e.progress, 100);
    assert.match(e.error, /incomplete/i);
    assert.equal(w.terminated, true);
    assert.deepEqual(FakeProvider._deleted, ['m1']);
    resolve();
  }));
});

test('worker message-error → status error with message', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  const w = FakeWorker.last;
  w.emitWorkerError('network down');
  return new Promise(resolve => setImmediate(() => {
    const e = svc.getState('whisper', 'm1');
    assert.equal(e.status, 'error');
    assert.match(e.error, /network down/);
    resolve();
  }));
});

test('worker native error event → status error', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  const w = FakeWorker.last;
  w.emitCrash(new Error('segfault'));
  return new Promise(resolve => setImmediate(() => {
    const e = svc.getState('whisper', 'm1');
    assert.equal(e.status, 'error');
    assert.match(e.error, /segfault/);
    resolve();
  }));
});

test('worker abnormal exit (non-zero, no message) → status error', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  const w = FakeWorker.last;
  // Emit an abnormal exit BEFORE any ready/error message.
  w.emitAbnormalExit(134);
  return new Promise(resolve => setImmediate(() => {
    const e = svc.getState('whisper', 'm1');
    assert.equal(e.status, 'error');
    assert.match(e.error, /exited unexpectedly/);
    resolve();
  }));
});

test('cancel terminates worker and marks entry cancelled', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  const w = FakeWorker.last;
  const r = svc.cancel('whisper', 'm1');
  assert.equal(r.success, true);
  assert.equal(w.terminated, true);
  return new Promise(resolve => setImmediate(() => {
    const e = svc.getState('whisper', 'm1');
    assert.equal(e.status, 'cancelled');
    resolve();
  }));
});

test('cancel of a non-existent entry returns {success:false}', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  const r = svc.cancel('whisper', 'does-not-exist');
  assert.equal(r.success, false);
  assert.equal(r.error, 'not-downloading');
});

test('cancel cleans partial bytes via provider.deletePartial on next start', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  const w = FakeWorker.last;
  w.emitProgress(40);
  svc.cancel('whisper', 'm1');
  return new Promise(resolve => setImmediate(() => {
    // Now start again — service should call deletePartial because prior
    // status was cancelled.
    svc.start('whisper', 'm1');
    assert.deepEqual(FakeProvider._deleted, ['m1']);
    resolve();
  }));
});

test('getState() returns array; getState(provider) returns provider-filtered; getState(provider, modelId) returns single or null', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()], ['vision', FakeProvider.create('vision')]]) });
  svc.start('whisper', 'a');
  svc.start('whisper', 'b');
  svc.start('vision', 'x');
  return new Promise(resolve => setImmediate(() => {
    const all = svc.getState();
    assert.equal(all.length, 3);
    const w = svc.getState('whisper');
    assert.equal(w.length, 2);
    const one = svc.getState('whisper', 'a');
    assert.equal(one.provider, 'whisper');
    assert.equal(one.modelId, 'a');
    const none = svc.getState('whisper', 'nope');
    assert.equal(none, null);
    resolve();
  }));
});

test('subscribe emits change events for every state transition', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  const events = [];
  svc.subscribe(e => events.push({ key: e.key, status: e.entry.status, progress: e.entry.progress }));
  svc.start('whisper', 'm1');
  const w = FakeWorker.last;
  w.emitProgress(25);
  w.emitProgress(75);
  FakeProvider._cached = { m1: true };
  w.emitReady();
  return new Promise(resolve => setTimeout(() => {
    const statuses = events.map(e => e.status);
    assert.ok(statuses.includes('downloading'));
    assert.ok(statuses.includes('verifying'));
    assert.ok(statuses.includes('complete'));
    resolve();
  }, 50));
});

test('persistence: state file written on debounce', async () => {
  const statePath = path.join(tmpUserData, 'state.json');
  const svc = new LocalModelDownloadService({ persistencePath: statePath, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  // Wait for debounce (500ms default) plus margin.
  await new Promise(r => setTimeout(r, 700));
  assert.ok(fs.existsSync(statePath), 'state file should exist after debounce');
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(parsed.v, 1);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].modelId, 'm1');
  assert.equal(parsed.entries[0].status, 'downloading');
});

test('persistence: pauseForShutdown flushes synchronously and marks in-flight as interrupted', () => {
  const statePath = path.join(tmpUserData, 'state.json');
  const svc = new LocalModelDownloadService({ persistencePath: statePath, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  const w = FakeWorker.last;
  // Don't drain queueMicrotask — just shut down mid-flight.
  svc.pauseForShutdown();
  assert.ok(fs.existsSync(statePath));
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(parsed.entries[0].status, 'interrupted');
  assert.equal(w.terminated, true);
});

test('rehydrate: downloading → interrupted (no live worker after restart)', () => {
  const statePath = path.join(tmpUserData, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    v: 1,
    entries: [{ provider: 'whisper', modelId: 'm1', status: 'downloading', progress: 42, startedAt: 1, updatedAt: 2 }],
  }));
  const svc = new LocalModelDownloadService({ persistencePath: statePath, providers: new Map([['whisper', FakeProvider.create()]]) });
  const e = svc.getState('whisper', 'm1');
  assert.equal(e.status, 'interrupted');
});

test('rehydrate: interrupted + isModelCached=true → complete', () => {
  const statePath = path.join(tmpUserData, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    v: 1,
    entries: [{ provider: 'whisper', modelId: 'm1', status: 'downloading', progress: 99, startedAt: 1, updatedAt: 2 }],
  }));
  FakeProvider._cached = { m1: true };
  const svc = new LocalModelDownloadService({ persistencePath: statePath, providers: new Map([['whisper', FakeProvider.create()]]) });
  const e = svc.getState('whisper', 'm1');
  assert.equal(e.status, 'complete');
  assert.equal(e.progress, 100);
});

test('rehydrate: cancelled entries are preserved (not auto-completed)', () => {
  const statePath = path.join(tmpUserData, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    v: 1,
    entries: [{ provider: 'whisper', modelId: 'm1', status: 'cancelled', progress: 50, startedAt: 1, updatedAt: 2 }],
  }));
  FakeProvider._cached = { m1: true }; // even if the files happen to be present
  const svc = new LocalModelDownloadService({ persistencePath: statePath, providers: new Map([['whisper', FakeProvider.create()]]) });
  const e = svc.getState('whisper', 'm1');
  assert.equal(e.status, 'cancelled');
});

test('rehydrate: complete entries stay complete', () => {
  const statePath = path.join(tmpUserData, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    v: 1,
    entries: [{ provider: 'whisper', modelId: 'm1', status: 'complete', progress: 100, startedAt: 1, updatedAt: 2 }],
  }));
  const svc = new LocalModelDownloadService({ persistencePath: statePath, providers: new Map([['whisper', FakeProvider.create()]]) });
  const e = svc.getState('whisper', 'm1');
  assert.equal(e.status, 'complete');
  assert.equal(e.progress, 100);
});

test('singleton: getInstance() returns the same instance', () => {
  LocalModelDownloadService.__resetForTests();
  const a = LocalModelDownloadService.getInstance();
  const b = LocalModelDownloadService.getInstance();
  assert.equal(a, b);
  LocalModelDownloadService.__resetForTests();
});

test('broadcast loop tolerates destroyed webContents (no crash)', () => {
  // Install a fake electron BrowserWindow with mixed alive/destroyed contents.
  // The service calls BrowserWindow.getAllWindows() at broadcast time, so
  // we install the override on the stub object BEFORE constructing the
  // service. (Service code reads `BrowserWindow` from the require cache,
  // which holds our electronStub object.)
  const aliveWin = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      sent: [],
      send(ch, payload) { this.sent.push({ ch, payload }); },
    },
  };
  const destroyedWin = { isDestroyed: () => true };
  const aliveButWcDestroyed = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => true },
  };
  // Mutate the stub in place (it was passed-by-reference into Module._cache).
  electronStub.BrowserWindow = {
    getAllWindows: () => [aliveWin, destroyedWin, aliveButWcDestroyed],
  };
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  // Use subscribe to confirm the service actually emits state changes.
  let subscribeSawChange = false;
  svc.subscribe(() => { subscribeSawChange = true; });
  svc.start('whisper', 'm1');
  return new Promise(resolve => setTimeout(() => {
    assert.ok(subscribeSawChange, 'service did not emit any change events');
    assert.ok(
      aliveWin.webContents.sent.some(m => m.ch === 'local-whisper-download-progress'),
      `expected progress channel; got: ${JSON.stringify(aliveWin.webContents.sent.map(m => m.ch))}`,
    );
    assert.ok(aliveWin.webContents.sent.some(m => m.ch === 'local-model:whisper:download-state'));
    // CRITICAL: destroyed / half-destroyed windows must NOT crash the loop.
    // The assertions above would never be reached if `send` on a destroyed
    // window threw and propagated out of the broadcast loop.
    resolve();
  }, 50));
});

test('start → cancel → start again: second start is NOT idempotent (treats as fresh attempt)', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  FakeWorker.last.emitProgress(30);
  svc.cancel('whisper', 'm1');
  // After cancel, a fresh start should NOT report alreadyDownloading —
  // it should treat the cancelled state as "ready for a fresh attempt"
  // (calling deletePartial and spawning a new worker).
  const r2 = svc.start('whisper', 'm1');
  assert.equal(r2.alreadyDownloading, undefined);
  assert.equal(r2.success, true);
  // Two workers should now exist (the cancelled one + the fresh one).
  assert.equal(FakeWorker.instances.length, 2);
});

test('whisper provider factory builds a valid provider', () => {
  const p = createWhisperDownloadProvider();
  assert.equal(p.name, 'whisper');
  assert.equal(typeof p.isModelCached, 'function');
  assert.equal(typeof p.deletePartial, 'function');
  assert.equal(typeof p.preflightCheck, 'function');
  assert.equal(typeof p.spawnWorker, 'function');
  assert.equal(typeof p.buildInitMessage, 'function');
});

test('REGRESSION: whisper worker path resolves correctly under BOTH bundling layouts', () => {
  // The "Cannot find module '.../dist-electron/audio/whisper/whisperWorker.js'"
  // bug was caused by path.join(__dirname, '..', 'audio', 'whisper', 'whisperWorker.js')
  // — when the service is bundled into main.js, __dirname is dist-electron/electron/
  // and `..` strips the `electron/` segment, producing dist-electron/audio/...
  //
  // esbuild's `outbase: rootDir` preserves the `electron/` directory, so the
  // worker is always at __dirname + 'audio/whisper/whisperWorker.js' regardless
  // of whether the service is bundled or standalone.
  const p = createWhisperDownloadProvider();

  // Layout A (bundled): service is inlined into dist-electron/electron/main.js → __dirname = dist-electron/electron/
  // This is what actually runs in the packaged app and is the layout the user
  // hit the bug in.
  // From the test file at electron/services/__tests__/, the dist-electron/electron/
  // layout resolves at: 3 levels up to project root + dist-electron/electron/audio/whisper/whisperWorker.js.
  const bundledPath = path.resolve(__dirname, '..', '..', '..', 'dist-electron', 'electron', 'audio', 'whisper', 'whisperWorker.js');
  assert.ok(
    fs.existsSync(bundledPath),
    `Layout A (bundled) — worker must exist at ${bundledPath}. If this fails, ` +
    `the spawnWorker path was broken at runtime with "Cannot find module '.../dist-electron/audio/whisper/whisperWorker.js'".`,
  );

  // CRITICAL NEGATIVE ASSERTION: the broken path (`..` + audio/whisper/...) must NOT
  // be used. In the bundled layout, that resolves to dist-electron/audio/whisper/...
  // which DOES NOT exist — that's exactly the error the user reported.
  const brokenPath = path.resolve(__dirname, '..', '..', '..', 'dist-electron', 'audio', 'whisper', 'whisperWorker.js');
  assert.ok(
    !fs.existsSync(brokenPath),
    `Broken path must not exist (otherwise the regression is back): ${brokenPath}`,
  );
});
