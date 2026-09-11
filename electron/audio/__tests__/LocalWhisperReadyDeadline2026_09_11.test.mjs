// electron/audio/__tests__/LocalWhisperReadyDeadline2026_09_11.test.mjs
//
// Live-reproduced 2026-09-11 (isolated profile, per-channel local parakeet):
// the channel that cold-started its worker logged "Loading …" and then
// nothing for minutes. Every VAD segment sat in pendingAudio, the channel
// transcribed nothing, and the user-visible symptom was "No speech detected"
// — with no log line saying the model had not finished loading.
//
// Pinned here: the cold start arms a readiness deadline right after the init
// post, `ready` clears it and logs the load time, and the deadline tears the
// instance down and emits an actionable 'error' (the same clean teardown
// start()'s spawnWorker catch performs) instead of queueing audio forever.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '../LocalWhisperSTT.ts'), 'utf8');

function method(name) {
  const m = source.match(new RegExp(`private\\s+${name}\\s*\\([^)]*\\)\\s*:\\s*void\\s*\\{([\\s\\S]*?)\\n    \\}`));
  assert.ok(m, `${name} must exist`);
  return m[1];
}

test('the readiness deadline is a documented, env-overridable constant in a sane band', () => {
  assert.match(source, /const WORKER_READY_TIMEOUT_MS = \(\(\) => \{/);
  assert.match(source, /process\.env\.NATIVELY_LOCAL_STT_READY_TIMEOUT_MS/);
  const def = source.match(/: 120_000;/);
  assert.ok(def, 'default must stay 120s: model loads are legitimately slow on first run, but a meeting cannot wait forever');
});

test('the cold start arms the deadline immediately after posting init', () => {
  const idx = source.indexOf('this.worker.postMessage(buildWorkerInitMessage(this.modelId));');
  assert.ok(idx >= 0);
  const after = source.slice(idx, idx + 200);
  assert.match(after, /this\.armWorkerReadyDeadline\(\);/, 'BUG: a cold start with no deadline is a silent dead channel');
});

test('ready clears the deadline and logs how long the load took', () => {
  const ready = source.slice(source.indexOf("if (msg.type === 'ready') {"), source.indexOf('this.flushPending();', source.indexOf("if (msg.type === 'ready') {")));
  assert.match(ready, /this\.clearWorkerReadyDeadline\(\);/);
  assert.match(ready, /worker ready in \$\{Date\.now\(\) - this\.workerSpawnedAt\}ms/);
});

test('the deadline tears the instance down and emits an actionable error', () => {
  const body = method('scheduleWorkerReadyTimers');
  assert.match(body, /this\.stopStreamingLoop\(\);/);
  assert.match(body, /this\.vad = null;/);
  assert.match(body, /this\.isActive = false;/);
  assert.match(body, /this\.beginWorkerTermination\(w\);/, 'the slot must be released and the worker terminated');
  assert.match(body, /this\.emit\('error', markLocalSttUnavailable\(new Error\(/, 'the error must carry the terminal marker main.ts classifies as failed');
  assert.match(body, /did not finish loading within/);
  assert.match(body, /cloud STT provider/);
  // A graceful give-up is not a crash: the load sentinel must be cleared or
  // the next launch "recovers" by resetting the user's model.
  assert.match(body, /clearLoadSentinel\(this\.modelId\);/);
  // Never fire on a worker that already answered, or on a stopped instance.
  assert.match(body, /if \(this\.workerReady \|\| !this\.isActive\) return;/);
  // Main-process timers never pin the event loop.
  assert.equal((body.match(/\.unref\?\.\(\)/g) ?? []).length, 2);
});

test('a worker that dies during load clears the deadline; progress re-arms it', () => {
  const err = source.slice(source.indexOf('const errorHandler = (err: Error) => {'), source.indexOf("this.worker.on('error', errorHandler);"));
  assert.match(err.slice(0, 400), /this\.clearWorkerReadyDeadline\(\);/);
  const exit = source.slice(source.indexOf('const exitHandler = (code: number) => {'), source.indexOf("this.worker.on('exit', exitHandler);"));
  assert.match(exit.slice(0, 200), /this\.clearWorkerReadyDeadline\(\);/);
  const progress = source.slice(source.indexOf("if ((msg as any).type === 'progress') {"), source.indexOf("if (msg.type === 'ready') {"));
  assert.match(progress, /this\.scheduleWorkerReadyTimers\(\)/);
  assert.match(source, /stop\(\): void \{\n        if \(!this\.isActive\) return;\n        this\.isActive = false;\n        this\.spawnGeneration\+\+;\n        this\.clearWorkerReadyDeadline\(\);/);
});

test('a slot wait that settles after stop() neither spawns an orphan nor tears down the next session', () => {
  const cold = source.slice(source.indexOf('const generation = ++this.spawnGeneration;'), source.indexOf('console.log(`[LocalWhisperSTT] Cold-starting worker'));
  assert.match(cold, /if \(generation !== this\.spawnGeneration \|\| !this\.isActive\) return;/, 'stale rejection must be swallowed');
  assert.match(cold, /slotRelease\(\);\n            return;/, 'a slot arriving after stop() must be handed straight back');
  assert.match(cold, /throw markLocalSttUnavailable\(err\);/);
});

test('finalize reports whether a final is now in flight', () => {
  assert.match(source, /finalize\(\): boolean \{[\s\S]*?return segs\.length > 0 \|\| this\.pendingAudio\.length > 0;/);
});

test('termination always clears the deadline so a torn-down instance cannot fire it later', () => {
  const body = method('beginWorkerTermination');
  assert.match(body.slice(0, 120), /this\.clearWorkerReadyDeadline\(\);/);
});
