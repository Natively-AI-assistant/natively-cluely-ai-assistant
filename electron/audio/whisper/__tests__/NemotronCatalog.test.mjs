// Regression/contract test for the Nemotron 3.5 ASR Streaming catalog entry.
//
// Nemotron's onnx-community export ships a FLAT repo layout (no `onnx/`
// subdirectory, no dtype-suffixed filenames) — unlike every other model in
// MODEL_CATALOG, which is encoder-decoder or single-session under `onnx/`.
// isModelCached() branches on `sessionLayout === 'nemotron-rnnt'` before it
// ever reaches the onnx/-subdir assumption, and checks a dedicated fixed file
// list (NEMOTRON_REQUIRED_FILES) instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Module from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nemotron-catalog-test-'));
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return { app: { getPath: (k) => (k === 'userData' ? userData : os.tmpdir()), isReady: () => true } };
  }
  return origLoad.apply(this, arguments);
};

const distRoot = path.resolve(__dirname, '../../../../dist-electron/electron/audio/whisper');
const modelMgrPath = path.join(distRoot, 'modelManager.js');
// pathToFileURL, not a bare path: dynamic import() requires a valid URL, and
// a raw Windows path (C:\...) is not one — StartupModelValidation.test.mjs
// establishes this exact pattern for the same reason.
const {
  isModelCached,
  NEMOTRON_REQUIRED_FILES,
  MODEL_CATALOG_IDS,
  getModelSizeBytes,
  getModelExternalDataFormat,
  getAvailableModels,
} = await import(pathToFileURL(modelMgrPath).href);

const MODEL_ID = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';
const REQUIRED_FILES = [
  'encoder.onnx', 'encoder.onnx.data', 'decoder.onnx', 'decoder.onnx.data',
  'joint.onnx', 'joint.onnx.data', 'tokenizer.json', 'vocab.txt', 'tokenizer_config.json',
];
const modelDir = path.join(userData, 'whisper-models', 'onnx-community', 'nemotron-3.5-asr-streaming-0.6b-onnx-int4');

test('NEMOTRON_REQUIRED_FILES matches the expected 9-file flat layout', () => {
  assert.deepEqual([...NEMOTRON_REQUIRED_FILES].sort(), [...REQUIRED_FILES].sort());
});

test('MODEL_CATALOG_IDS includes the nemotron model id', () => {
  assert.ok(MODEL_CATALOG_IDS.has(MODEL_ID));
});

test('getModelSizeBytes returns the catalog sizeMb (793) in bytes for the nemotron model id', () => {
  assert.equal(getModelSizeBytes(MODEL_ID), Math.round(793 * 1024 * 1024));
});

test('nemotron-rnnt sessionLayout: isModelCached is false when the model dir does not exist', () => {
  assert.equal(isModelCached(MODEL_ID), false);
});

test('nemotron-rnnt sessionLayout: isModelCached is false when only some required files are present', () => {
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, 'encoder.onnx'), 'x');
  fs.writeFileSync(path.join(modelDir, 'decoder.onnx'), 'x');
  // No onnx/ subdir exists here at all — proves this path never falls through
  // to the dtype-suffix / onnx/-subdir logic other catalog entries use.
  assert.equal(fs.existsSync(path.join(modelDir, 'onnx')), false);
  assert.equal(isModelCached(MODEL_ID), false);
});

test('nemotron-rnnt sessionLayout: isModelCached is true once all 9 files are present and non-empty', () => {
  for (const f of REQUIRED_FILES) fs.writeFileSync(path.join(modelDir, f), 'x'); // non-empty is all isModelCached checks
  assert.equal(isModelCached(MODEL_ID), true);
});

test('nemotron-rnnt sessionLayout: isModelCached is false when a required file is present but empty (0 bytes)', () => {
  fs.writeFileSync(path.join(modelDir, 'joint.onnx.data'), ''); // simulate an aborted download
  assert.equal(isModelCached(MODEL_ID), false);
  fs.writeFileSync(path.join(modelDir, 'joint.onnx.data'), 'x'); // restore
  assert.equal(isModelCached(MODEL_ID), true);
});

// ── picker visibility (Task 11 fix1 round: UNHIDDEN — the real go/no-go
// integration test now passes, 77.8% word overlap vs. the required 50%, see
// task-11-fix1-report.md. Previously ship-gated behind `hidden: true`
// because Nemotron transcribed real speech as an empty string — see
// task-11-report.md / task-11-debug1-report.md / task-11-debug2-report.md /
// task-11-debug3-report.md for the full root-cause history. The catalog
// entry, download plumbing, and worker routing were never touched by the
// gating; only getAvailableModels() (the single function every user-facing
// picker consumes) was filtering it out — that filter is now moot for this
// id since `hidden` is no longer set on its catalog entry.

test('getAvailableModels() now includes the previously-hidden nemotron entry', () => {
  const models = getAvailableModels();
  assert.ok(Array.isArray(models) && models.length > 0, 'sanity: catalog is non-empty');
  assert.equal(
    models.some((m) => m.id === MODEL_ID),
    true,
    'nemotron entry must appear in the user-facing picker list now that the go/no-go gate passes',
  );
});

test('MODEL_CATALOG_IDS (unfiltered) still includes the nemotron id', () => {
  assert.ok(MODEL_CATALOG_IDS.has(MODEL_ID));
});

test('getModelSizeBytes / getModelExternalDataFormat resolve for the nemotron id', () => {
  // These back the download/worker-init flow, not the picker — must keep
  // working exactly as before regardless of picker visibility.
  assert.equal(getModelSizeBytes(MODEL_ID), Math.round(793 * 1024 * 1024));
  // Nemotron's catalog entry does not declare externalDataFormat (flat
  // repo layout, no external-data split) — undefined is the correct,
  // unchanged resolution, not a thrown error or a missing-id fallback.
  assert.equal(getModelExternalDataFormat(MODEL_ID), undefined);
});
