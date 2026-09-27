// electron/utils/__tests__/OnnxSentinelSelfPoison2026_09_22.test.mjs
//
// A launch must never read its OWN in-flight load sentinel as a crash.
//
// The ONNX load sentinel is a cross-launch crash guard: a loader writes it just
// before spawning an ONNX worker and clears it once the model is ready, so a
// native abort mid-load leaves a record behind and the NEXT launch skips that
// model instead of crash-looping. The next launch finds it via
// consumePoisonedOnnxLoad(), which main.ts runs once at cold start inside a
// setImmediate.
//
// That consume could not tell WHICH launch wrote the record. Anything that
// started a load before the setImmediate ran — a startup re-index of reference
// files — wrote a fresh sentinel, and the consume then reported this launch's
// own in-flight load as a previous crash, poisoned the model for the rest of the
// launch, and every other load fast-failed.
//
// REPRODUCED LIVE (2026-09-22) on an upgrade: a profile with reference files
// indexed under the previous model was relaunched on the new build. Startup
// re-indexing began loading Xenova/multilingual-e5-base, the consume logged
// "Recovered from a local embedding crash. Xenova/multilingual-e5-base is
// skipped this launch" — a model no previous launch had ever loaded — and all
// six files were written off as lexical_only (0/9 chunks embedded) while the
// model itself went on to load successfully.
//
// Invariants pinned here:
//   1. This launch's own in-flight record is not a crash (consume -> null) and
//      is LEFT on disk, so if this launch dies hard the next one still sees it.
//   2. A genuine previous-launch record is still reported — including when this
//      launch overwrote it by starting a load before the consume ran.
//   3. A record written by an older build (no launch id) is still honoured.
//   4. Consume stays idempotent.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'onnx-sentinel-selfpoison-'));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') return { app: { getPath: () => userData, isReady: () => true } };
  return origLoad.apply(this, arguments);
};

const {
  writeLoadSentinel,
  consumePoisonedOnnxLoad,
  __simulateNewLaunchForTests,
} = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/utils/onnxLoadSentinel.js')).href);

const file = (family) => path.join(userData, `onnx-load-sentinel-${family}.json`);
const MODEL = 'Xenova/multilingual-e5-base';

beforeEach(() => {
  delete process.env.NATIVELY_ONNX_SENTINEL_DISABLED;
  for (const f of fs.readdirSync(userData)) fs.rmSync(path.join(userData, f), { force: true });
  __simulateNewLaunchForTests();
});

test('the exact live sequence: a load started before the cold-start consume is NOT a crash', () => {
  // This launch begins loading (startup re-index) before the setImmediate consume.
  writeLoadSentinel('embeddings', MODEL);
  const consumed = consumePoisonedOnnxLoad('embeddings');
  assert.equal(consumed, null,
    'the launch reported its own in-flight load as a previous crash and poisoned itself');
});

test('the in-flight record stays on disk, so a hard death of THIS launch is still caught next time', () => {
  writeLoadSentinel('embeddings', MODEL);
  consumePoisonedOnnxLoad('embeddings');
  assert.ok(fs.existsSync(file('embeddings')), 'consume must not delete a live in-flight record');

  // This launch dies before ready; the next launch must see the crash.
  __simulateNewLaunchForTests();
  const next = consumePoisonedOnnxLoad('embeddings');
  assert.ok(next, 'a launch that died mid-load must still poison the next launch');
  assert.equal(next.modelId, MODEL);
});

test('a genuine previous-launch crash is reported when the consume runs first (normal order)', () => {
  writeLoadSentinel('embeddings', MODEL);   // previous launch, died mid-load
  __simulateNewLaunchForTests();            // relaunch
  const consumed = consumePoisonedOnnxLoad('embeddings');
  assert.ok(consumed, 'previous-launch crash lost');
  assert.equal(consumed.modelId, MODEL);
});

test('a genuine previous-launch crash is STILL reported when this launch overwrote it first', () => {
  writeLoadSentinel('embeddings', MODEL);   // previous launch, died mid-load
  __simulateNewLaunchForTests();            // relaunch
  writeLoadSentinel('embeddings', MODEL);   // this launch starts loading before the consume
  const consumed = consumePoisonedOnnxLoad('embeddings');
  assert.ok(consumed, 'overwriting the file must not erase the evidence of the previous crash');
  assert.equal(consumed.modelId, MODEL);
});

test('a record written by an older build (no launch id) is still honoured', () => {
  fs.writeFileSync(file('embeddings'), JSON.stringify({
    family: 'embeddings', modelId: 'Xenova/all-MiniLM-L6-v2', startedAt: Date.now(), attempt: 1,
  }));
  const consumed = consumePoisonedOnnxLoad('embeddings');
  assert.ok(consumed, 'a legacy sentinel must keep its crash-guard meaning across the upgrade');
  assert.equal(consumed.modelId, 'Xenova/all-MiniLM-L6-v2');
});

test('consume is idempotent', () => {
  writeLoadSentinel('reranker', 'Xenova/ms-marco-MiniLM-L-6-v2');
  __simulateNewLaunchForTests();
  assert.ok(consumePoisonedOnnxLoad('reranker'));
  assert.equal(consumePoisonedOnnxLoad('reranker'), null);
});

// ── Duplicate-bundle hazard ─────────────────────────────────────────────────
// build-electron.js gives many files their own esbuild entry, so this module is
// INLINED into several dist bundles, each with its own module scope. The launch
// identity must be process-global, or a sentinel written by one copy and
// consumed by another reads as a different launch and the self-poison returns.
// modelPreloader.js carries its own inlined copy — exercise both copies at once.
const { writeLoadSentinel: preloaderWrite, modelPreloader } = await import(pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/audio/whisper/modelPreloader.js')).href);

test('two inlined copies of the module agree on the launch (write in one, consume in the other)', () => {
  preloaderWrite('Xenova/whisper-tiny.en');                       // copy A: modelPreloader.js
  assert.equal(consumePoisonedOnnxLoad('whisper'), null,          // copy B: onnxLoadSentinel.js
    'a sentinel from another bundle copy in the SAME process was read as a previous crash');
  __simulateNewLaunchForTests();                                  // rotate via copy B
  const poisoned = modelPreloader.consumePoisonedLoadSentinel();  // consume via copy A
  assert.ok(poisoned, 'a relaunch rotated in one copy must be seen by the other');
  assert.equal(poisoned.modelId, 'Xenova/whisper-tiny.en');
});
