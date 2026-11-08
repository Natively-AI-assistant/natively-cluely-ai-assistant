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
const { LocalModelDownloadService, createWhisperDownloadProvider, createNemotronDownloadProvider, resolveLocalModelProviderName } = mod;

let tmpUserData;

// Fake Worker — emits the messages the test wants without spawning a thread.
class FakeWorker extends EventEmitter {
  constructor() {
    super();
    FakeWorker.last = this;
    FakeWorker.instances.push(this);
    this.terminated = false;
    this.retired = false;
    this.postedMessages = [];
  }
  // A real worker answers `shutdown` by exiting itself with code 0 at its next
  // idle point (whisperWorker.ts). The service must stop a worker ONLY this
  // way: terminate() on a worker inside a native ONNX call aborts the app.
  postMessage(msg) {
    this.postedMessages.push(msg);
    if (msg?.type === 'shutdown' && !this.holdExit) { this.retired = true; this.emit('exit', 0); }
    else if (msg?.type === 'shutdown') { this.retired = true; }
  }
  terminate() { this.terminated = true; this.emit('exit', 1); }
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
    assert.equal(w.retired, true, 'the worker must be asked to shut down');
    assert.equal(w.terminated, false, 'BUG: terminate() on an ONNX worker can abort the whole app');
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
    assert.equal(w.retired, true, 'the worker must be asked to shut down');
    assert.equal(w.terminated, false, 'BUG: terminate() on an ONNX worker can abort the whole app');
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
  assert.equal(w.retired, true, 'the worker must be asked to shut down');
  assert.equal(w.terminated, false, 'BUG: terminate() on an ONNX worker can abort the whole app');
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
  assert.equal(w.retired, true, 'the worker must be asked to shut down');
  assert.equal(w.terminated, false, 'BUG: terminate() on an ONNX worker can abort the whole app');
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

test('REGRESSION: rehydrate drops a stale wrong-provider entry (whisper:<nemotron-id> ghost error)', () => {
  // Before resolveLocalModelProviderName existed, every download call site
  // hardcoded provider 'whisper' — so a failed real Nemotron attempt
  // persisted as `whisper:<nemotron modelId>` carrying the stale
  // "init.channelId is required" error. That ghost entry re-marked the
  // Nemotron row as errored in Settings on EVERY launch, even after the
  // routing fix, and manual state-file edits were overwritten by the
  // running app's own re-persist. rehydrate() must drop it.
  const NEMOTRON_ID = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';
  const statePath = path.join(tmpUserData, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    v: 1,
    entries: [
      // The mis-keyed ghost — must be dropped:
      { provider: 'whisper', modelId: NEMOTRON_ID, status: 'error', progress: 0, startedAt: 1, updatedAt: 2, error: 'Failed to load model: init.channelId is required for sessionLayout "nemotron-rnnt"' },
      // A correctly-keyed nemotron entry — must survive:
      { provider: 'nemotron', modelId: NEMOTRON_ID, status: 'cancelled', progress: 0, startedAt: 3, updatedAt: 4 },
      // A correctly-keyed whisper entry — must survive:
      { provider: 'whisper', modelId: 'Xenova/whisper-tiny.en', status: 'complete', progress: 100, startedAt: 5, updatedAt: 6 },
    ],
  }));
  const svc = new LocalModelDownloadService({ persistencePath: statePath, providers: new Map([['whisper', FakeProvider.create()]]) });
  assert.equal(svc.getState('whisper', NEMOTRON_ID), null, 'mis-keyed whisper:<nemotron-id> ghost must be dropped at rehydrate');
  assert.equal(svc.getState('nemotron', NEMOTRON_ID)?.status, 'cancelled', 'correctly-keyed nemotron entry must survive');
  assert.equal(svc.getState('whisper', 'Xenova/whisper-tiny.en')?.status, 'complete', 'correctly-keyed whisper entry must survive');
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

test('nemotron provider factory builds a valid provider', () => {
  const p = createNemotronDownloadProvider();
  assert.equal(p.name, 'nemotron');
  assert.equal(typeof p.isModelCached, 'function');
  assert.equal(typeof p.deletePartial, 'function');
  assert.equal(typeof p.preflightCheck, 'function');
  assert.equal(typeof p.spawnWorker, 'function');
  assert.equal(typeof p.buildInitMessage, 'function');
});

test('REGRESSION: nemotron init message includes a channelId — every "Download" click in Settings failed without this', () => {
  // whisperWorker.ts's nemotron-rnnt init branch (added by the dual-channel
  // fix) rejects any init lacking a channelId with "Failed to load model:
  // init.channelId is required for sessionLayout \"nemotron-rnnt\"". This
  // provider predates that requirement and was never updated for it, so
  // clicking "Download"/"Install" on the Nemotron catalog entry in Settings
  // failed immediately, every time, with that exact message.
  const p = createNemotronDownloadProvider();
  const msg = p.buildInitMessage('onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4');
  assert.equal(msg.sessionLayout, 'nemotron-rnnt');
  assert.ok(msg.channelId, `buildInitMessage() must include a truthy channelId — got ${JSON.stringify(msg.channelId)}`);
  assert.equal(typeof msg.channelId, 'string');
});

test('REGRESSION: resolveLocalModelProviderName routes the Nemotron catalog entry to "nemotron", not "whisper"', () => {
  // The real bug this fixes: every real download call site
  // (ipcHandlers.ts's local-whisper-start-download/cancel-download/
  // get-download-state handlers, and main.ts's background auto-download
  // loop) hardcoded 'whisper' as the provider name for every model,
  // including Nemotron. createNemotronDownloadProvider() (Task 9) was
  // registered but NEVER actually invoked for a real download as a
  // result — every real "Download" click for Nemotron routed through the
  // whisper provider's buildInitMessage() (which has no channelId logic
  // at all), reproducing "Failed to load model: init.channelId is
  // required for sessionLayout \"nemotron-rnnt\"" regardless of the
  // separate provider-level fix above. Confirmed live: the persisted
  // local-model-download-state.json entry for a failed real attempt
  // recorded `"provider": "whisper"` for the Nemotron modelId.
  assert.equal(
    resolveLocalModelProviderName('onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4'),
    'nemotron',
  );
});

test('REGRESSION: resolveLocalModelProviderName routes every non-Nemotron catalog entry to "whisper" (unchanged)', () => {
  assert.equal(resolveLocalModelProviderName('Xenova/whisper-tiny.en'), 'whisper');
  assert.equal(resolveLocalModelProviderName('istupakov/parakeet-tdt-0.6b-v3-onnx'), 'whisper');
  assert.equal(resolveLocalModelProviderName('onnx-community/moonshine-tiny-ONNX'), 'whisper');
});

test('REGRESSION: an unknown modelId falls back to "whisper" (fail into the existing generic path, not a crash)', () => {
  assert.equal(resolveLocalModelProviderName('not-a-real-model-id'), 'whisper');
});


// ── 2026-10-14: one download owner, an on-disk "in progress" mark, a
//    cooperative stop, and errors worded by cause ─────────────────────────────

function trackingProvider(overrides = {}) {
  const calls = [];
  return {
    calls,
    provider: {
      ...FakeProvider.create(),
      prepareDownload: (id) => calls.push(`prepare:${id}`),
      finishDownload: (id) => calls.push(`finish:${id}`),
      ...overrides,
    },
  };
}
const settle = () => new Promise((r) => setImmediate(r));

test('the download is marked in progress BEFORE the worker is spawned, and cleared only after it loaded', () => {
  let onDisk = false;
  const { calls, provider } = trackingProvider({
    spawnWorker: () => { calls.push('spawn'); return new FakeWorker(); },
    isModelCached: (id) => { calls.push(`verify:${id}`); return onDisk; },
  });
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', provider]]) });
  svc.start('whisper', 'm1');
  assert.deepEqual(calls, ['verify:m1', 'prepare:m1', 'spawn'], 'a quit or crash from the first byte on must leave the mark behind');
  onDisk = true;
  FakeWorker.last.emitReady();
  assert.deepEqual(calls.slice(3), ['finish:m1', 'verify:m1'], 'the mark is lifted before the cache check, or the check could never pass');
  assert.equal(svc.getState('whisper', 'm1').status, 'complete');
});

test('re-verifying a model that is already whole never marks it as a download in progress', () => {
  // start() on an installed model only loads it to check it. Marking it would
  // turn a quit during that check into a full re-download of good files.
  const { calls, provider } = trackingProvider({ isModelCached: () => true });
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', provider]]) });
  assert.equal(svc.start('whisper', 'm1').success, true);
  assert.equal(calls.includes('prepare:m1'), false);
});

test('a worker error leaves the in-progress mark in place', () => {
  const { calls, provider } = trackingProvider();
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', provider]]) });
  svc.start('whisper', 'm1');
  FakeWorker.last.emitWorkerError('Failed to load model: fetch failed');
  assert.equal(calls.includes('finish:m1'), false, 'BUG: a failed download would count as installed');
  assert.equal(svc.getState('whisper', 'm1').status, 'error');
});

test('a worker error is shown as the provider words it; the raw text is not what the user sees', () => {
  const { provider } = trackingProvider({ describeError: (raw) => `Worded: ${raw.includes('fetch failed') ? 'no connection' : 'other'}` });
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', provider]]) });
  svc.start('whisper', 'm1');
  FakeWorker.last.emitWorkerError('Failed to load model: fetch failed');
  assert.equal(svc.getState('whisper', 'm1').error, 'Worded: no connection');
});

test('a describeError that throws falls back to the raw message instead of losing the error', () => {
  const { provider } = trackingProvider({ describeError: () => { throw new Error('boom'); } });
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', provider]]) });
  svc.start('whisper', 'm1');
  FakeWorker.last.emitWorkerError('raw reason');
  assert.equal(svc.getState('whisper', 'm1').error, 'raw reason');
});

test('ensureDownloaded resolves at once for a model that is already on disk and starts nothing', async () => {
  FakeProvider._cached = { m1: true };
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  await svc.ensureDownloaded('whisper', 'm1');
  assert.equal(FakeWorker.instances.length, 0);
});

test('ensureDownloaded JOINS a download already in flight — one worker, not two', async () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1'); // the launch-time auto-download
  const progress = [];
  let done = false;
  const waiting = svc.ensureDownloaded('whisper', 'm1', { onProgress: (p) => progress.push(p) }).then(() => { done = true; });
  await settle();
  assert.equal(FakeWorker.instances.length, 1, 'BUG: two workers writing the same model files');
  FakeWorker.last.emitProgress(40);
  await settle();
  assert.equal(done, false);
  assert.ok(progress.includes(40), 'the waiter sees progress, so it can tell "slow" from "stalled"');
  FakeProvider._cached = { m1: true };
  FakeWorker.last.emitReady();
  await waiting;
  assert.equal(done, true);
});

test('ensureDownloaded starts the download when nothing has, and rejects with the worded error when it fails', async () => {
  const { provider } = trackingProvider({ describeError: () => 'The local model could not be downloaded.' });
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', provider]]) });
  const waiting = svc.ensureDownloaded('whisper', 'm1');
  await settle();
  assert.equal(FakeWorker.instances.length, 1);
  FakeWorker.last.emitWorkerError('Failed to load model: fetch failed');
  await assert.rejects(waiting, /could not be downloaded/);
});

test('ensureDownloaded rejects when the download is cancelled, and for an unknown provider', async () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  const waiting = svc.ensureDownloaded('whisper', 'm1');
  await settle();
  svc.cancel('whisper', 'm1');
  await assert.rejects(waiting, /cancelled/);
  await assert.rejects(svc.ensureDownloaded('nope', 'm1'), /unknown-provider/);
});

test('a waiter that has moved on is dropped without cancelling the download for everyone else', async () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  let abandon = false;
  const waiting = svc.ensureDownloaded('whisper', 'm1', { shouldAbandon: () => abandon });
  await settle();
  abandon = true;
  FakeWorker.last.emitProgress(10);
  await assert.rejects(waiting, /abandoned/);
  assert.equal(svc.getState('whisper', 'm1').status, 'downloading', 'the download carries on');
  assert.equal(FakeWorker.last.retired, false);
});

test('start() refuses while the cancelled download\'s worker is still on its way out', () => {
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', FakeProvider.create()]]) });
  svc.start('whisper', 'm1');
  const first = FakeWorker.last;
  first.holdExit = true; // inside a native model load: it cannot exit yet
  svc.cancel('whisper', 'm1');
  const again = svc.start('whisper', 'm1');
  assert.equal(again.success, false, 'BUG: deleting and rewriting files the old worker may still hold open');
  assert.match(again.error, /still stopping/);
  assert.equal(FakeWorker.instances.length, 1);
  first.emit('exit', 0);
  assert.equal(svc.start('whisper', 'm1').success, true, 'once it has gone the download starts normally');
});

test('startWhenReady waits for that worker instead of refusing the click, and runs the provider\'s preparation first', async () => {
  const order = [];
  const { provider } = trackingProvider({
    beforeSpawn: async () => { order.push('beforeSpawn'); },
    spawnWorker: () => { order.push('spawn'); return new FakeWorker(); },
  });
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', provider]]) });
  svc.start('whisper', 'm1');
  const first = FakeWorker.last;
  first.holdExit = true;
  svc.cancel('whisper', 'm1');
  order.length = 0;
  const restarting = svc.startWhenReady('whisper', 'm1');
  await settle();
  assert.deepEqual(order, ['beforeSpawn'], 'not spawned while the old worker is alive');
  first.emit('exit', 0);
  const r = await restarting;
  assert.equal(r.success, true);
  assert.deepEqual(order, ['beforeSpawn', 'spawn']);
});

test('a beforeSpawn that rejects never blocks the download', async () => {
  const { provider } = trackingProvider({ beforeSpawn: async () => { throw new Error('proxy lookup failed'); } });
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', provider]]) });
  assert.equal((await svc.startWhenReady('whisper', 'm1')).success, true);
});

test('every bundle reaches the same service instance (globalThis, not a static field)', () => {
  const a = LocalModelDownloadService.getInstance();
  assert.strictEqual(globalThis.__nativelyLocalModelDownloadServiceV1__, a);
  assert.strictEqual(LocalModelDownloadService.getInstance(), a);
  LocalModelDownloadService.__resetForTests();
  assert.notStrictEqual(LocalModelDownloadService.getInstance(), a);
});

test('the real whisper and nemotron providers carry the new hooks', () => {
  for (const p of [createWhisperDownloadProvider(), createNemotronDownloadProvider()]) {
    for (const hook of ['prepareDownload', 'finishDownload', 'describeError', 'beforeSpawn']) {
      assert.equal(typeof p[hook], 'function', `${p.name}.${hook}`);
    }
  }
});

// -- Updating a model that works from an older copy (2026-10-15) ------------
//
// A Whisper model downloaded before its catalog repoId existed is usable but
// heavier. "Download" on it must fetch the current copy (isDownloadComplete
// false) while a meeting must NOT wait for or trigger that download
// (isModelReady stays "usable").

function upgradeProvider(state) {
  const prepared = [];
  return {
    prepared,
    provider: {
      ...FakeProvider.create(),
      isModelCached: () => true,                       // the older copy works
      isDownloadComplete: () => state.currentCopyDone, // the current copy
      prepareDownload: (id) => prepared.push(id),
    },
  };
}

test('update: download runs (and marks in progress) although the model is usable', () => {
  const state = { currentCopyDone: false };
  const { provider, prepared } = upgradeProvider(state);
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', provider]]) });
  assert.equal(svc.isModelReady('whisper', 'm1'), true, 'a meeting starts on the older copy without waiting');
  assert.equal(svc.start('whisper', 'm1').success, true);
  assert.deepEqual(prepared, ['m1'], 'BUG: an installed-looking model skips the download and never updates');
});

test('update: verified against the current copy, not the usable older one', () => {
  const state = { currentCopyDone: false };
  const { provider } = upgradeProvider(state);
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', provider]]) });
  svc.start('whisper', 'm1');
  FakeWorker.last.emitReady();
  assert.equal(svc.getState('whisper', 'm1').status, 'error',
    'the older copy must not make an unfinished update look complete');

  state.currentCopyDone = true;
  svc.start('whisper', 'm2');
  FakeWorker.last.emitReady();
  assert.equal(svc.getState('whisper', 'm2').status, 'complete');
});

// -- Damaged downloads and kept files (2026-10-15 review) --------------------

test('a download that fails as damaged files is discarded on the next start; other failures keep their resume points', () => {
  const discarded = [];
  const provider = {
    ...FakeProvider.create(),
    isDamagedError: (m) => /Protobuf parsing failed/.test(m),
    discardDamaged: (id) => discarded.push(id),
  };
  const svc = new LocalModelDownloadService({ disablePersistence: true, providers: new Map([['whisper', provider]]) });

  svc.start('whisper', 'm1');
  FakeWorker.last.emitWorkerError('Failed to load model: Load model from /x/encoder_model.onnx failed:Protobuf parsing failed.');
  assert.equal(svc.getState('whisper', 'm1').damaged, true);
  svc.start('whisper', 'm1');
  assert.deepEqual(discarded, ['m1'], 'BUG: Retry kept the damaged file of the right size and failed the same way forever');
  assert.deepEqual(FakeProvider._deleted, []);

  svc.start('whisper', 'm2');
  FakeWorker.last.emitWorkerError('Failed to load model: fetch failed');
  assert.equal(svc.getState('whisper', 'm2').damaged, undefined);
  svc.start('whisper', 'm2');
  assert.deepEqual(FakeProvider._deleted, ['m2'], 'a network failure keeps what a resume can use');
  assert.deepEqual(discarded, ['m1']);
});

test('the download path words damaged files as "install again", not a Delete button the failed row lacks', async () => {
  const lf = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/audio/whisper/loadFailure.js')).href);
  const msg = 'Failed to load model: Load model from /x/encoder_model.onnx failed:Protobuf parsing failed.';
  assert.match(lf.describeLocalModelLoadFailure(msg, { reinstallReplacesDamaged: true }), /Install the model again/);
  assert.doesNotMatch(lf.describeLocalModelLoadFailure(msg, { reinstallReplacesDamaged: true }), /Delete/);
  assert.match(lf.describeLocalModelLoadFailure(msg, {}), /Delete the model/, 'a meeting (installed row, Delete shown) keeps its wording');
});

test('Nemotron: cleanup after an interruption keeps complete files and removes only partials', async () => {
  const nd = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/audio/whisper/nemotron/downloadFiles.js')).href);
  const dir = path.join(tmpUserData, 'nemotron model');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['encoder.onnx', 'encoder.onnx.data', 'decoder.onnx.partial.123.456.abc', '.natively-download-incomplete']) {
    fs.writeFileSync(path.join(dir, f), 'x');
  }
  nd.deletePartialNemotronFiles(dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.natively-download-incomplete', 'encoder.onnx', 'encoder.onnx.data'],
    'BUG: a quit during the final load deleted 700 MB of finished files');
  nd.discardNemotronFiles(dir);
  assert.equal(fs.existsSync(dir), false);
});
