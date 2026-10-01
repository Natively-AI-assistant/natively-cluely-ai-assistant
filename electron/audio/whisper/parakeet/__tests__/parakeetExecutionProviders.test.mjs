// Parakeet TDT runs CPU-only (resolveParakeetExecutionProviders): CoreML
// fragments the int8 encoder into 344 partitions and was ~4.7x slower to load
// and ~2x slower per warm pass on an M4; DirectML was never measured.
//
// The platform lists below are the ones resolveInferenceConfig() returns on
// Apple Silicon and Windows, so both platform branches are exercised without
// touching process.platform.
//
// Runs against dist-electron/. Run via: npm run build:electron && npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// inferenceConfig pulls in `electron` via getModelsDir().
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-eps-'));
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return { app: { getPath: () => userData, isReady: () => true } };
  }
  return origLoad.apply(this, arguments);
};

const {
  buildWorkerInitMessage,
  resolveInferenceConfig,
  resolveParakeetExecutionProviders,
} = await import(pathToFileURL(path.resolve(
  __dirname,
  '../../../../../dist-electron/electron/audio/whisper/inferenceConfig.js',
)).href);

const PARAKEET = 'istupakov/parakeet-tdt-0.6b-v3-onnx';
const WHISPER = 'Xenova/whisper-small';

test('Parakeet drops the platform accelerator on every platform list', () => {
  assert.deepEqual(resolveParakeetExecutionProviders(['coreml', 'cpu']), ['cpu'], 'Apple Silicon');
  assert.deepEqual(resolveParakeetExecutionProviders(['dml', 'cpu']), ['cpu'], 'Windows');
  assert.deepEqual(resolveParakeetExecutionProviders(['cpu']), ['cpu'], 'Intel Mac / Linux');
  assert.deepEqual(resolveParakeetExecutionProviders([]), ['cpu'], 'empty list still yields cpu');
});

test('the Parakeet worker init message carries CPU-only providers', () => {
  const msg = buildWorkerInitMessage(PARAKEET);
  assert.equal(msg.sessionLayout, 'parakeet-tdt');
  assert.deepEqual(msg.executionProviders, ['cpu']);
});

test('other local models keep the platform providers', () => {
  const msg = buildWorkerInitMessage(WHISPER);
  assert.deepEqual(msg.executionProviders, resolveInferenceConfig().executionProviders);
});

test.after(() => {
  Module._load = origLoad;
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* noop */ }
});
