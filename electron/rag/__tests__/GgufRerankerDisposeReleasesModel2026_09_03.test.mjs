// Regression test for: disposing the GGUF reranker never released llama.cpp.
//
// THE BUG. GgufReranker.dispose() went straight to `worker.terminate()`:
//
//     const worker = this.worker;
//     this.worker = null;
//     this.rejectAllPending(...);
//     try { await worker.terminate(); } catch {}
//
// ggufRerankerWorker.ts implements a `dispose` message that calls disposeAll()
// — context.dispose() -> model.dispose() -> llama.dispose(), inner to outer —
// and that message was never sent. So the mmap'd GGUF weights and llama.cpp's
// KV cache were released by thread death rather than through llama.cpp's own
// API, and any cleanup those dispose() calls perform simply never ran.
//
// It is reachable from a plain user action, not just at quit: choosing a
// different local reranker in Settings runs
// `reranker:use-local-model` -> resetLocalGgufPort() -> ggufPort.port.dispose().
//
// The second half of the bug is the timing. `terminate()` unwinds the worker
// thread wherever it happens to be — including inside `context.rankAll()`, a
// native call — which is the same shape as this repo's Nemotron teardown
// SIGABRT. Settings and retrieval share a process, so a rerank genuinely can be
// in flight at the moment the user switches models.
//
// THE FIX, guarded here: dispose() posts `{type:'dispose'}` and awaits the
// worker's acknowledgement (bounded — a wedged worker must not block a quit)
// before terminating. The worker serialises its message handling, so the
// dispose is queued behind any in-flight rankAll instead of racing it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { GgufReranker } = require(path.join(repoRoot, 'dist-electron/electron/rag/GgufReranker.js'));

// ensureLoaded() refuses to spawn a worker for a path that does not exist, so a
// real (empty) file is required to reach the protocol under test. The fake
// worker never opens it.
const MODEL_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gguf-dispose-')), 'model.gguf');
fs.writeFileSync(MODEL_PATH, '');

/**
 * Build the port with the fake worker in the RIGHT positional slot.
 *
 * `spawnWorker` is the LAST constructor parameter, and parameters have been
 * inserted before it (projectorPath, blockBudget). Passing the factory in the
 * wrong slot does not fail — it is silently treated as a projector path, a REAL
 * llama.cpp worker spawns, and the test hangs instead of failing. That cost 12
 * minutes of wall clock once; `assertInjected` below turns it into an
 * immediate, legible failure.
 */
function portWith(worker, scoring = 'rank') {
    let called = 0;
    const port = new GgufReranker(MODEL_PATH, scoring, null, null, (p) => { called += 1; return worker; });
    return {
        port,
        assertInjected() {
            assert.ok(
                called > 0,
                'the injected worker factory was never called — it is almost certainly in the ' +
                'wrong constructor slot after a parameter was added before it, which means this ' +
                'test just spawned a REAL llama.cpp worker.',
            );
        },
    };
}

/**
 * A stand-in for the worker thread that records the protocol traffic.
 * `silentFor` lists message types it refuses to acknowledge, simulating a
 * worker wedged at exactly that point.
 */
function fakeWorker({ silentFor = [] } = {}) {
  const posted = [];
  const listeners = {};
  const w = {
    posted,
    terminated: false,
    terminatedAt: -1,
    on(event, cb) { (listeners[event] ??= []).push(cb); return w; },
    postMessage(msg) {
      posted.push(msg);
      if (silentFor.includes(msg.type)) return;
      // Reply on a later turn, the way a real worker would.
      setImmediate(() => {
        for (const cb of listeners.message ?? []) {
          cb({ type: msg.type === 'rerank' ? 'result' : 'ready', requestId: msg.requestId, scores: [] });
        }
      });
    },
    async terminate() { w.terminated = true; w.terminatedAt = posted.length; },
  };
  return w;
}

test('dispose() asks the worker to release llama.cpp before terminating the thread', async () => {
  const w = fakeWorker();
  const port = new GgufReranker(MODEL_PATH, 'rank', null, null, () => w);

  assert.ok(await port.isAvailable(), 'the fake worker should have acknowledged init');
  await port.dispose();

  const disposeMsg = w.posted.find((m) => m.type === 'dispose');
  assert.ok(
    disposeMsg,
    'dispose() never sent {type:"dispose"} to the worker. ggufRerankerWorker implements that ' +
    'message to run context.dispose() -> model.dispose() -> llama.dispose(); without it the ' +
    'GGUF weights and KV cache are released by thread death instead of llama.cpp\'s own API.',
  );
  assert.ok(w.terminated, 'the worker must still be terminated after the graceful dispose');
  assert.ok(
    w.terminatedAt >= w.posted.indexOf(disposeMsg) + 1,
    'terminate() ran before the dispose message was posted — the release never had a chance',
  );
});

test('dispose() still terminates when the worker never acknowledges', async () => {
  // Acknowledges init, then goes silent — wedged at exactly the moment of
  // teardown, which is when it matters.
  const w = fakeWorker({ silentFor: ['dispose'] });
  const port = new GgufReranker(MODEL_PATH, 'rank', null, null, () => w);

  assert.ok(await port.isAvailable());
  const startedAt = Date.now();
  await port.dispose();          // must not hang the quit path
  assert.ok(Date.now() - startedAt < 10_000, 'dispose() waited far longer than its budget');

  assert.ok(w.terminated, 'a worker that never replies to dispose must still be terminated');
});

test('dispose() is idempotent and safe with no worker ever created', async () => {
  const port = new GgufReranker(MODEL_PATH, 'rank', null, null, () => fakeWorker());
  await port.dispose();
  await port.dispose();
});

test('the worker serialises messages so dispose cannot run during an in-flight rerank', () => {
  // Node delivers worker messages as they arrive; an `async` handler that
  // awaits does NOT delay the next delivery. A `dispose` arriving while
  // `context.rankAll()` is awaited would therefore free the context underneath
  // a live native call. The handler must funnel messages through a queue.
  const source = require('node:fs').readFileSync(
    path.join(repoRoot, 'electron/rag/ggufRerankerWorker.ts'), 'utf8',
  );
  assert.match(
    source,
    /queue\s*=\s*queue\s*\.then\(/,
    'ggufRerankerWorker must chain incoming messages onto a serial queue, so a dispose is ' +
    'handled after any in-flight rerank rather than concurrently with it.',
  );
});
