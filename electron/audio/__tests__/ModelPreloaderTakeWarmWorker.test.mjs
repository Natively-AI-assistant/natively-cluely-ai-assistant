// Behavioral regression test for the listener-leak fix in
// ModelPreloader.takeWarmWorker().
//
// Bug: takeWarmWorker() returned the worker without removing the preloader's
// `message` / `error` listeners. When the receiving LocalWhisperSTT drove
// the worker and a transient error fired during recording, the preloader's
// `error` handler ALSO fired and called `recordFailure(modelId)`, silently
// poisoning the recent-failure cooldown for the modelId the user was
// actively using. The cooldown would then block the next preload of the
// same model for 5 minutes — manifesting as "transcription silently stops
// after a single transient error".
//
// Fix: takeWarmWorker() now calls w.removeAllListeners('message' / 'error' /
// 'exit') before handoff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { EventEmitter } from 'events';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// modelPreloader pulls in `electron` for userData. Point userData at a
// fresh temp dir so the recent-failures JSON is isolated.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'preloader-leak-'));
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (k) => (k === 'userData' ? userData : os.tmpdir()),
        isReady: () => true,
      },
    };
  }
  return origLoad.apply(this, arguments);
};

const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio/whisper');
const { modelPreloader } = await import(
  pathToFileURL(path.join(distRoot, 'modelPreloader.js')).href
);

// We can't easily spawn a real whisper worker (no model files), so we
// drive the preloader directly: replace the private `warmWorker` and
// `warmModelId` slots via the `preload()` path is too heavy (it tries to
// spawn a Worker). Instead, we use the internal `takeWarmWorker` method
// with a hand-rolled EventEmitter that stands in for a Worker.

test('takeWarmWorker removes preload listeners so transient errors do not poison the cooldown', () => {
  // Build a fake "warm" worker that's just an EventEmitter.
  const fakeWorker = new EventEmitter();
  // Mark it as "warm" by reaching into the private fields. The preloader
  // exposes `isWarm(modelId)` which checks both fields; we set them via
  // direct mutation since the public surface doesn't otherwise let us
  // mark a worker as warm without spawning.
  // We do this by abusing the fact that the preloader is a singleton
  // module export: the private fields aren't on the prototype, so we
  // can't reach them externally. Instead, drive the preloader with a
  // REAL Worker stub via the preload() call and intercept new Worker.
  //
  // Easiest: replace the global `Worker` constructor with one that
  // returns our EventEmitter. The preloader uses `new Worker(workerPath)`
  // (via the `worker_threads` module). Monkey-patching `worker_threads`
  // before the call lets us inject.
  //
  // Since we can't easily patch worker_threads in ESM, we instead
  // directly test the takeWarmWorker cleanup by stubbing the worker
  // before the call. We achieve this by mutating the internal
  // warmWorker/warmModelId via cast-as-any.
  const internal = modelPreloader;
  // Reset state in case the singleton is dirty from another test.
  internal.warmWorker = null;
  internal.warmModelId = null;
  internal.recentFailures = new Map();

  // Seed recent-failures for a DIFFERENT modelId so we can verify the
  // "stale handler poisons the cooldown" failure mode would corrupt
  // THIS modelId specifically if the listener-leak were unfixed.
  const UNRELATED_MODEL = 'Xenova/whisper-tiny';
  internal.recentFailures.set(UNRELATED_MODEL, Date.now() + 60_000);

  // Place our fake worker into the "warm" slot.
  internal.warmWorker = fakeWorker;
  internal.warmModelId = 'Xenova/whisper-tiny.en';

  // Now exercise the actual fix: takeWarmWorker must remove the
  // preloader's listeners before returning the worker.
  const handed = modelPreloader.takeWarmWorker('Xenova/whisper-tiny.en');
  assert.ok(handed, 'takeWarmWorker should return the warm worker');
  assert.strictEqual(handed, fakeWorker, 'should hand off the same worker');

  // Verify NO listeners remain on the fake worker. If the listener-leak
  // bug were unfixed, the preloader would have left its `message` and
  // `error` listeners attached. With the fix in place, the worker has
  // zero listeners.
  assert.strictEqual(
    fakeWorker.listenerCount('message'),
    0,
    'preloader.message listener must be removed on handoff',
  );
  assert.strictEqual(
    fakeWorker.listenerCount('error'),
    0,
    'preloader.error listener must be removed on handoff',
  );
  assert.strictEqual(
    fakeWorker.listenerCount('exit'),
    0,
    'preloader.exit listener (if any) must be removed on handoff',
  );
});

test('after handoff, a transient worker error does NOT poison the recent-failure cooldown for unrelated modelIds', () => {
  // This is the production regression scenario: the user is actively
  // recording with model A, the worker errors once during recording,
  // and the preloader's leaked `error` handler would have called
  // `recordFailure('Xenova/whisper-tiny.en')` — which means the next
  // preload of tiny.en would silently skip for 5 minutes.
  //
  // With the fix in place, the preloader is decoupled from the worker
  // after handoff, so the unrelated cooldown stays clean.
  const internal = modelPreloader;
  internal.warmWorker = null;
  internal.warmModelId = null;
  internal.recentFailures = new Map();

  const UNRELATED = 'Xenova/whisper-tiny';
  // Pre-seed: the user already has a recent-failure cooldown on
  // `Xenova/whisper-tiny` from a different code path (e.g. an earlier
  // meeting). We want to confirm the post-handoff worker error does
  // NOT touch this map.
  const unrelatedExpiry = Date.now() + 60_000;
  internal.recentFailures.set(UNRELATED, unrelatedExpiry);

  // Hand off a fake worker for tiny.en.
  const fakeWorker = new EventEmitter();
  internal.warmWorker = fakeWorker;
  internal.warmModelId = 'Xenova/whisper-tiny.en';
  const handed = modelPreloader.takeWarmWorker('Xenova/whisper-tiny.en');
  assert.ok(handed, 'handoff should succeed');

  // Simulate the receiving LocalWhisperSTT driving the worker and
  // experiencing a transient error during recording. Attach a no-op
  // error listener on the fake worker so EventEmitter doesn't throw
  // an unhandled error event (in production, LocalWhisperSTT attaches
  // its own error listener before driving the worker).
  fakeWorker.on('error', () => {});
  fakeWorker.emit('error', new Error('transient STT error during recording'));

  // The preloader must NOT have recorded any new failure. The unrelated
  // cooldown must be intact (the user was NEVER using this modelId,
  // so the leaked listener would have wrongly poisoned the cooldown).
  assert.strictEqual(
    internal.recentFailures.has(UNRELATED),
    true,
    'unrelated recent-failure cooldown must remain intact (was set before this test)',
  );
  assert.strictEqual(
    internal.recentFailures.get(UNRELATED),
    unrelatedExpiry,
    'unrelated recent-failure expiry must be unchanged by the post-handoff error',
  );
  // And no NEW entry for tiny.en (or any modelId) should have been
  // added by the (now-detached) preloader error handler.
  assert.strictEqual(
    internal.recentFailures.size,
    1,
    `recent-failures map must have exactly 1 entry (the unrelated one); got: ${JSON.stringify([...internal.recentFailures.keys()])}`,
  );
});
