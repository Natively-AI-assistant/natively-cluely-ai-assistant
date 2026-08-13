// electron/audio/__tests__/NemotronWorkerMessageSerialization2026_08_13.test.mjs
//
// Final review fix round 2: c69c8379 ("fix(stt): serialize Nemotron worker
// messages, surface init failures") added `nemotronChain` to
// whisperWorker.ts so overlapping `transcribe`/`setLanguage` messages that
// touch `nemotronEngine` can no longer interleave inside
// NemotronEngine.pushAudio() and corrupt its stateful RNNT cache/decoder
// buffers. That round never actually shipped the test proving the chaining
// works — this file is that test.
//
// ── Why this can't reuse NemotronDeltaDispatch2026_08_10's exact technique ──
//
// That file mocks `electron` via Module._load and imports the real
// dist-electron/**/LocalWhisperSTT.js (esbuild-bundled). whisperWorker.ts's
// own local dependencies (NemotronEngine, downloadNemotronFiles) can't be
// intercepted the same way against that same esbuild output: the project's
// esbuild config (scripts/build-electron.js) sets `bundle: true` and only
// externalizes a short allowlist (electron, better-sqlite3, keytar,
// sqlite-vec, onnxruntime-node, pdfjs-dist, pdf-parse, mammoth,
// @vectorize-io/hindsight-client) — NemotronEngine and downloadFiles are
// NOT on that list, so esbuild inlines them directly into
// dist-electron/electron/audio/whisper/whisperWorker.js via its deferred
// `__esm`/`init_nemotronEngine()` pattern. There is no separate
// `require('./nemotron/nemotronEngine')` Node module-resolution call left
// at runtime in that bundle to intercept — confirmed by inspecting the
// built output directly (`grep -n "require(" dist-electron/.../whisperWorker.js`
// shows only Node builtins and onnxruntime-node as real `require()` calls;
// NemotronEngine reaches the bundle via `init_nemotronEngine()`, not
// `require`).
//
// So instead this test compiles whisperWorker.ts (and only the local
// dependency subgraph TypeScript's project-file resolution actually pulls
// in for it) with the project's own `tsc` (same compilerOptions as
// electron/tsconfig.json — see `npm run build:electron:tsc` /
// `npm run typecheck:electron`), UNBUNDLED, into an ephemeral temp
// directory, every time this test runs. Unbundled tsc output preserves
// every `require('./nemotron/...')` call as a literal Node module
// resolution — exactly the seam the brief asked for ("mocking
// ./nemotron/nemotronEngine's NemotronEngine.create") — while still
// exercising whisperWorker.ts's REAL, currently-committed message-handler
// source (not a hand-copied reimplementation of its logic). It also proves
// this on every run against the actual current source, not a stale
// pre-built snapshot.
//
// (`downloadFiles.ts` doesn't even need compiling: whisperWorker.ts only
// reaches it via a runtime `require()` inside the handler body, never via a
// type-level reference, so tsc's file-closure resolution never pulls it in
// — confirmed by inspecting the tsc output directory listing. It's mocked
// below purely via Module._load, no real file needed.)
//
// `worker_threads` is mocked the same way `electron` is mocked in
// NemotronDeltaDispatch2026_08_10.test.mjs: a fake `parentPort`
// (EventEmitter + spied `postMessage`) standing in for the real one, scoped
// (via the `parent.filename` check below) to requires originating from the
// compiled whisperWorker.js itself, so this doesn't destabilize `worker_threads`
// or `./nemotron/*` resolution for anything else running in the same test
// process.
//
// Run: npm test (globs electron/audio/__tests__/**/*.test.mjs), or directly:
// ELECTRON_RUN_AS_NODE=1 electron --test electron/audio/__tests__/NemotronWorkerMessageSerialization2026_08_13.test.mjs

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { EventEmitter } from 'events';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const tscBin = path.join(repoRoot, 'node_modules/.bin/tsc');
const workerSrc = path.join(repoRoot, 'electron/audio/whisper/whisperWorker.ts');

/**
 * Compiles whisperWorker.ts (unbundled, real project compilerOptions) into
 * a fresh temp directory and returns the path to the compiled .js entry
 * point. Using `files: [workerSrc]` (rather than the full project
 * tsconfig's `include` globs) keeps this to just whisperWorker.ts's actual
 * dependency closure — a few hundred ms, not a full-project compile.
 */
function compileWorker(outDir) {
  const tsconfigPath = path.join(outDir, 'tsconfig.json');
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        target: 'ESNext',
        module: 'CommonJS',
        allowJs: true,
        skipLibCheck: true,
        esModuleInterop: true,
        noImplicitAny: true,
        sourceMap: false,
        baseUrl: repoRoot,
        rootDir: repoRoot,
        outDir,
        moduleResolution: 'node',
        resolveJsonModule: true,
      },
      files: [workerSrc],
    }),
  );
  execFileSync(tscBin, ['-p', tsconfigPath], { cwd: repoRoot, stdio: 'pipe' });
  return path.join(outDir, 'electron/audio/whisper/whisperWorker.js');
}

/** A resolve()-capturing promise the test can await deterministically. */
function makeDeferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * A fake NemotronEngine whose pushAudio() blocks on an externally-resolved
 * gate (no real timers — zero timing flakiness) and records, for every
 * call: a monotonically increasing concurrency counter (incremented at
 * pushAudio's start, decremented at its end) and a call-order log. The
 * test asserts the counter's peak never exceeds 1.
 */
function makeFakeEngine(callCount) {
  const state = {
    concurrency: 0,
    peakConcurrency: 0,
    callLog: [],
    callIndex: 0,
    starts: Array.from({ length: callCount }, () => makeDeferred()),
    gates: Array.from({ length: callCount }, () => makeDeferred()),
  };
  const engine = {
    reset() { state.callLog.push('reset'); },
    setLanguage(langId) { state.callLog.push(`setLanguage:${langId}`); },
    async pushAudio(_audio) {
      const idx = state.callIndex++;
      state.concurrency++;
      state.peakConcurrency = Math.max(state.peakConcurrency, state.concurrency);
      state.callLog.push(`start${idx}`);
      state.starts[idx].resolve();
      await state.gates[idx].promise;
      state.concurrency--;
      state.callLog.push(`end${idx}`);
      return [{ text: `chunk${idx}`, isFinal: false }];
    },
    async flush() { return null; },
  };
  return { engine, state };
}

/**
 * Loads a freshly-compiled whisperWorker.js with `worker_threads` and the
 * two `./nemotron/*` runtime requires it makes intercepted via
 * `Module._load`, scoped to requests whose parent module is the compiled
 * file itself (so nothing else in the test process is affected). Returns
 * the fake parentPort plus a handle on whatever fake engine the test's
 * `init` message caused `NemotronEngine.create` to hand back.
 */
function loadWorkerWithFakes(workerJsPathRaw, { fakeEngineFactory }) {
  // Resolve symlinks (macOS os.tmpdir() returns a /var/... path that is
  // itself a symlink to /private/var/...; Node's own module loader reports
  // `parent.filename` using the resolved, symlink-free path) so the
  // Module._load scoping check below actually matches.
  const workerJsPath = fs.realpathSync(workerJsPathRaw);
  const fakeParentPort = new EventEmitter();
  const posted = [];
  fakeParentPort.postMessage = (msg) => posted.push(msg);

  let createdEngineHandle = null;

  const origLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (parent && parent.filename === workerJsPath) {
      if (request === 'worker_threads') {
        return { parentPort: fakeParentPort };
      }
      if (request === './nemotron/downloadFiles') {
        return { downloadNemotronFiles: async (_dir, _onProgress) => { /* no-op: pretend already cached */ } };
      }
      if (request === './nemotron/nemotronEngine') {
        return {
          NemotronEngine: {
            create: async (_modelDir, _providers) => {
              createdEngineHandle = fakeEngineFactory();
              return createdEngineHandle.engine;
            },
          },
        };
      }
    }
    return origLoad.apply(this, arguments);
  };

  // Module._load must stay patched for the whole lifetime of this worker
  // instance, not just for the initial require(): whisperWorker.ts's
  // `require('./nemotron/downloadFiles')` and
  // `require('./nemotron/nemotronEngine')` calls happen lazily, inside the
  // async 'init' message handler — i.e. well after this function's own
  // top-level require() call has already returned. The caller must invoke
  // the returned `cleanup()` once it is done sending messages.
  const require = createRequire(import.meta.url);
  require(workerJsPath);

  return {
    fakeParentPort,
    posted,
    getEngineHandle: () => createdEngineHandle,
    cleanup: () => { Module._load = origLoad; },
  };
}

describe('Nemotron worker message serialization (final-review-fix2, proves c69c8379)', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nemotron-worker-serial-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('two overlapping transcribe messages never run pushAudio concurrently', async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, 'compile-'));
    const workerJsPath = compileWorker(outDir);

    let fakeEngineHandle;
    const { fakeParentPort, posted, cleanup } = loadWorkerWithFakes(workerJsPath, {
      fakeEngineFactory: () => {
        fakeEngineHandle = makeFakeEngine(2);
        return fakeEngineHandle;
      },
    });

    try {
      // init → nemotron-rnnt path → NemotronEngine.create() is mocked to
      // return our fake engine.
      fakeParentPort.emit('message', {
        type: 'init',
        sessionLayout: 'nemotron-rnnt',
        modelId: 'fake-org/fake-nemotron',
        cacheDir: '/fake/cache',
        executionProviders: ['cpu'],
      });
      await new Promise((resolve) => {
        const check = () => {
          if (posted.some((m) => m.type === 'ready')) return resolve();
          setImmediate(check);
        };
        check();
      });
      assert.ok(fakeEngineHandle, 'NemotronEngine.create must have been invoked and its result captured');
      const { state } = fakeEngineHandle;

      // Fire two transcribe messages back-to-back with NO await between them
      // — the exact shape that, pre-c69c8379, could interleave inside
      // NemotronEngine.pushAudio().
      fakeParentPort.emit('message', { type: 'transcribe', taskId: 't1', audio: new Float32Array(4), streaming: true, nemotronReset: false });
      fakeParentPort.emit('message', { type: 'transcribe', taskId: 't2', audio: new Float32Array(4), streaming: true, nemotronReset: false });

      // Immediately after both emits (still perfectly synchronous — zero
      // awaits have happened anywhere yet), nothing may have started: if this
      // fires, it means the handler is calling pushAudio() synchronously
      // in-line rather than deferring through a promise chain.
      assert.equal(state.callLog.length, 0, 'pushAudio must not run synchronously inside the message handler');

      // Deterministically wait for call #0 to actually begin (no timers —
      // this resolves the instant pushAudio(idx=0)'s synchronous prologue
      // runs, however many microtask ticks that takes).
      await state.starts[0].promise;
      assert.equal(state.concurrency, 1, 'exactly one pushAudio call must be in flight');
      assert.deepEqual(state.callLog, ['start0'], 'call #1 must not have started while call #0 is still pending');

      // Let call #0 finish. If (and only if) messages are correctly
      // serialized, call #1 cannot begin until call #0's whole async closure
      // (including the `await` inside pushAudio) has fully resolved.
      state.gates[0].resolve();
      await state.starts[1].promise;

      assert.equal(state.concurrency, 1, 'exactly one pushAudio call must be in flight (the second one)');
      assert.deepEqual(
        state.callLog,
        ['start0', 'end0', 'start1'],
        'call #1 must only start strictly after call #0 fully ended — no overlap',
      );
      assert.equal(state.peakConcurrency, 1, 'concurrency must never have exceeded 1 at any point so far');

      // Let call #1 finish and confirm the worker replied to both tasks.
      state.gates[1].resolve();
      await new Promise((resolve) => {
        const check = () => {
          if (posted.filter((m) => m.type === 'partial').length >= 2) return resolve();
          setImmediate(check);
        };
        check();
      });

      assert.deepEqual(state.callLog, ['start0', 'end0', 'start1', 'end1']);
      assert.equal(state.peakConcurrency, 1, 'concurrency must never exceed 1 across the entire exchange');
      assert.equal(state.concurrency, 0);

      const partials = posted.filter((m) => m.type === 'partial');
      assert.equal(partials.length, 2);
      assert.deepEqual(partials.map((p) => p.taskId), ['t1', 't2']);
      assert.equal(partials[0].text, 'chunk0');
      assert.equal(partials[1].text, 'chunk1');
    } finally {
      cleanup();
    }
  });

  test('a setLanguage message chained after a transcribe waits for it to finish', async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, 'compile-'));
    const workerJsPath = compileWorker(outDir);

    let fakeEngineHandle;
    const { fakeParentPort, posted, cleanup } = loadWorkerWithFakes(workerJsPath, {
      fakeEngineFactory: () => {
        fakeEngineHandle = makeFakeEngine(1);
        return fakeEngineHandle;
      },
    });

    try {
      fakeParentPort.emit('message', {
        type: 'init',
        sessionLayout: 'nemotron-rnnt',
        modelId: 'fake-org/fake-nemotron',
        cacheDir: '/fake/cache',
        executionProviders: ['cpu'],
      });
      await new Promise((resolve) => {
        const check = () => (posted.some((m) => m.type === 'ready') ? resolve() : setImmediate(check));
        check();
      });
      const { state } = fakeEngineHandle;

      fakeParentPort.emit('message', { type: 'transcribe', taskId: 't1', audio: new Float32Array(4), streaming: true, nemotronReset: false });
      fakeParentPort.emit('message', { type: 'setLanguage', langId: 7 });

      await state.starts[0].promise;
      // setLanguage must not have run yet — it's chained behind the
      // in-flight transcribe, not applied mid-chunk.
      assert.ok(!state.callLog.includes('setLanguage:7'), 'setLanguage must not run while a transcribe is still in flight');

      state.gates[0].resolve();
      await new Promise((resolve) => {
        const check = () => (state.callLog.includes('setLanguage:7') ? resolve() : setImmediate(check));
        check();
      });

      assert.deepEqual(state.callLog, ['start0', 'end0', 'setLanguage:7']);
    } finally {
      cleanup();
    }
  });
});
