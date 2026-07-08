// Regression test for the Whisper load sentinel (2026-07-08).
//
// A persisted "load in progress" sentinel is written to disk BEFORE a Whisper
// worker is spawned, and cleared on `ready` / clean exit. If the previous app
// process died while loading a model natively (before JS error handlers could
// persist a recent-failure cooldown), the leftover sentinel survives. On the
// next launch, modelPreloader.consumePoisonedLoadSentinel() reads it, records
// a recent-failure cooldown, and returns the offending model id so main.ts
// can reset matching settings headlessly. This converts "crashes forever"
// into "crashes at most once, then self-heals".
//
// Guards:
//   1. writeLoadSentinel → consume returns the model id, removes the file,
//      and records a recent-failure cooldown for that id.
//   2. writeLoadSentinel → clearLoadSentinel → consume returns null.
//   3. Repeated write for the same model increments `attempt`.
//   4. clearLoadSentinel is a no-op when the on-disk sentinel is for a
//      DIFFERENT model (don't clobber another loader's sentinel).
//   5. consumePoisonedLoadSentinel is idempotent — second call returns null.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-load-sentinel-'));
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return { app: { getPath: () => userData, isReady: () => true } };
  }
  return origLoad.apply(this, arguments);
};

const preloaderPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/audio/whisper/modelPreloader.js',
);
const {
  modelPreloader,
  writeLoadSentinel,
  clearLoadSentinel,
} = await import(pathToFileURL(preloaderPath).href);

function sentinelPath() {
  return path.join(userData, 'onnx-load-sentinel-whisper.json');
}

function failuresPath() {
  return path.join(userData, 'whisper-recent-failures.json');
}

test('write → consume returns the model id and records a cooldown', () => {
  clearLoadSentinel();
  writeLoadSentinel('distil-whisper/distil-medium.en');
  assert.ok(fs.existsSync(sentinelPath()), 'sentinel file should exist after write');
  const poisoned = modelPreloader.consumePoisonedLoadSentinel();
  assert.ok(poisoned, 'consume should return a sentinel');
  assert.equal(poisoned.modelId, 'distil-whisper/distil-medium.en');
  assert.equal(poisoned.attempt, 1);
  assert.ok(!fs.existsSync(sentinelPath()), 'consume should remove the sentinel file');
  const failures = JSON.parse(fs.readFileSync(failuresPath(), 'utf8'));
  assert.ok(
    failures['distil-whisper/distil-medium.en'] && failures['distil-whisper/distil-medium.en'] > Date.now(),
    'consume should persist a recent-failure cooldown for the poisoned model id',
  );
});

test('write → clear → consume returns null', () => {
  clearLoadSentinel();
  writeLoadSentinel('Xenova/whisper-tiny.en');
  clearLoadSentinel('Xenova/whisper-tiny.en');
  assert.ok(!fs.existsSync(sentinelPath()), 'clear should remove the sentinel');
  const poisoned = modelPreloader.consumePoisonedLoadSentinel();
  assert.equal(poisoned, null, 'consume after clear should return null');
});

test('repeated writes for the same model increment attempt', () => {
  clearLoadSentinel();
  writeLoadSentinel('onnx-community/moonshine-base-ONNX');
  writeLoadSentinel('onnx-community/moonshine-base-ONNX');
  writeLoadSentinel('onnx-community/moonshine-base-ONNX');
  const poisoned = modelPreloader.consumePoisonedLoadSentinel();
  assert.ok(poisoned);
  assert.equal(poisoned.modelId, 'onnx-community/moonshine-base-ONNX');
  assert.equal(poisoned.attempt, 3);
});

test('clearLoadSentinel(modelId) does not clobber a different model\'s sentinel', () => {
  clearLoadSentinel();
  writeLoadSentinel('Xenova/whisper-base.en');
  clearLoadSentinel('Xenova/whisper-tiny.en');
  const persisted = JSON.parse(fs.readFileSync(sentinelPath(), 'utf8'));
  assert.equal(persisted.modelId, 'Xenova/whisper-base.en');
  clearLoadSentinel();
});

test('consumePoisonedLoadSentinel is idempotent', () => {
  clearLoadSentinel();
  writeLoadSentinel('Xenova/whisper-small.en');
  const first = modelPreloader.consumePoisonedLoadSentinel();
  assert.ok(first);
  const second = modelPreloader.consumePoisonedLoadSentinel();
  assert.equal(second, null, 'second consume should return null after the sentinel is cleared');
});

test('atomic write leaves no half-written sentinel behind', () => {
  clearLoadSentinel();
  writeLoadSentinel('Xenova/whisper-medium.en');
  assert.ok(!fs.existsSync(`${sentinelPath()}.tmp`), 'no .tmp file should remain after a clean write');
  clearLoadSentinel();
});