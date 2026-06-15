// Regression test for the Whisper external-data download bug (2026-06-13).
//
// Large ONNX checkpoints (e.g. onnx-community/whisper-large-v3-turbo-ONNX) store
// the graph in a tiny `encoder_model.onnx` stub but the ~820MB of weights in a
// sibling `encoder_model.onnx_data`. @huggingface/transformers only fetches that
// companion when `use_external_data_format` is truthy. That model's config.json
// does NOT declare it, so without the catalog flag the weight file was never
// downloaded and ONNX Runtime aborted on load:
//   "filesystem error: in file_size: ... encoder_model.onnx_data".
//
// Guards three properties of the fix:
//   1. buildWorkerInitMessage forwards useExternalDataFormat for the flagged
//      model (and the worker passes it to pipeline()).
//   2. self-declaring / non-external models do NOT get the flag (undefined),
//      so transformers keeps reading their own config.json (no spurious 404).
//   3. isModelCached requires the encoder's .onnx_data companion — a graph-stub-
//      only directory (the broken on-disk state) reports missing → re-downloads.
//
// Runs against the esbuild/tsc-compiled modules in dist-electron/.
// Run via: npm run build:electron && node --test electron/audio/__tests__/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// modelManager + inferenceConfig both pull in `electron` via getModelsDir().
// Point userData at a fresh temp dir so we can stage real files on disk.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-extdata-'));
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return { app: { getPath: () => userData, isReady: () => true } };
  }
  return origLoad.apply(this, arguments);
};

const modelMgrPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/audio/whisper/modelManager.js',
);
const inferenceCfgPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/audio/whisper/inferenceConfig.js',
);

const {
  getModelExternalDataFormat,
  isModelCached,
} = await import(pathToFileURL(modelMgrPath).href);
const { buildWorkerInitMessage } = await import(pathToFileURL(inferenceCfgPath).href);

const TURBO = 'onnx-community/whisper-large-v3-turbo-ONNX';
const MOONSHINE = 'onnx-community/moonshine-tiny-ONNX';
// distil-large-v3 self-declares external data in ITS OWN config.json. The
// catalog ALSO records the layout (matching value) so the cache check can
// require the companion — but transformers still reads the model's own config
// at download time. medium.en puts the split on the DECODER instead.
const DISTIL = 'distil-whisper/distil-large-v3';
const MEDIUM_EN = 'Xenova/whisper-medium.en';

// Stage the onnx/ directory for a model with an explicit set of files. Each
// entry is [name, bytes]. Returns the onnx dir path.
function stageOnnx(modelId, files) {
  const onnxDir = path.join(userData, 'whisper-models', modelId, 'onnx');
  fs.mkdirSync(onnxDir, { recursive: true });
  for (const [name, bytes] of files) {
    fs.writeFileSync(path.join(onnxDir, name), Buffer.alloc(bytes, 1));
  }
  return onnxDir;
}

test('catalog records external-data layout for every split checkpoint, none for others', () => {
  // turbo: split on the encoder, and its config does NOT self-declare → this
  // catalog entry is the ONLY thing that makes the weight file download.
  assert.deepEqual(getModelExternalDataFormat(TURBO), { 'encoder_model.onnx': true });
  // distil-large-*: split on the encoder (self-declared in config; recorded
  // here too so the cache check requires the companion).
  assert.deepEqual(getModelExternalDataFormat(DISTIL), { 'encoder_model.onnx': true });
  // medium.en: split on the DECODER, not the encoder.
  assert.deepEqual(getModelExternalDataFormat(MEDIUM_EN), { 'decoder_model_merged.onnx': true });
  // No split → no entry.
  assert.equal(getModelExternalDataFormat(MOONSHINE), undefined);
  assert.equal(getModelExternalDataFormat('does/not-exist'), undefined);
});

test('buildWorkerInitMessage forwards use_external_data_format for split checkpoints', () => {
  // turbo MUST carry it (config omits it; this is the actual bug fix).
  assert.deepEqual(buildWorkerInitMessage(TURBO).useExternalDataFormat, { 'encoder_model.onnx': true });
  // Self-declaring models forward the same value — harmless (transformers uses
  // options ?? config, identical here) and robust against config drift.
  assert.deepEqual(buildWorkerInitMessage(DISTIL).useExternalDataFormat, { 'encoder_model.onnx': true });
});

test('buildWorkerInitMessage leaves the flag undefined for non-split models', () => {
  // undefined → worker omits use_external_data_format → transformers behaves
  // exactly as before for self-contained models (moonshine, tiny/base/small).
  assert.equal(buildWorkerInitMessage(MOONSHINE).useExternalDataFormat, undefined);
});

test('isModelCached: graph stub WITHOUT encoder_model.onnx_data reports missing (the bug)', () => {
  // The exact broken on-disk state: 0.4MB encoder stub + decoder, but no
  // encoder_model.onnx_data. Must NOT be reported as cached, or the missing
  // weights never re-download and ORT keeps aborting.
  stageOnnx(TURBO, [
    ['encoder_model.onnx', 4096],
    ['decoder_model_merged.onnx', 4096],
  ]);
  assert.equal(isModelCached(TURBO, 'fp32'), false);
});

test('isModelCached: turbo WITH encoder_model.onnx_data reports cached', () => {
  stageOnnx(TURBO, [
    ['encoder_model.onnx', 4096],
    ['encoder_model.onnx_data', 4096],
    ['decoder_model_merged.onnx', 4096],
  ]);
  assert.equal(isModelCached(TURBO, 'fp32'), true);
});

test('isModelCached: zero-byte companion (aborted download) reports missing', () => {
  stageOnnx(TURBO, [
    ['encoder_model.onnx', 4096],
    ['encoder_model.onnx_data', 0], // partial/aborted
    ['decoder_model_merged.onnx', 4096],
  ]);
  assert.equal(isModelCached(TURBO, 'fp32'), false);
});

test('isModelCached: a non-external model needs no .onnx_data (regression guard)', () => {
  // Moonshine is self-contained — the encoder-data requirement must not leak
  // onto models the catalog does not flag.
  stageOnnx(MOONSHINE, [
    ['encoder_model.onnx', 4096],
    ['decoder_model_merged.onnx', 4096],
  ]);
  assert.equal(isModelCached(MOONSHINE, 'fp32'), true);
});

test('isModelCached: DECODER-side split (medium.en) requires the decoder .onnx_data on fp32', () => {
  // medium.en's split is on decoder_model_merged. On Apple Silicon (uniform
  // fp32) the merged decoder is the fp32 file, so its companion is required.
  // Stub-without-data must report missing.
  // Sizes are token (>0) — isModelCached only checks existence + non-zero size.
  stageOnnx(MEDIUM_EN, [
    ['encoder_model.onnx', 4096],
    ['decoder_model_merged.onnx', 4096], // stub
  ]);
  assert.equal(isModelCached(MEDIUM_EN, 'fp32'), false);

  // With the decoder companion present → cached.
  fs.writeFileSync(
    path.join(userData, 'whisper-models', MEDIUM_EN, 'onnx', 'decoder_model_merged.onnx_data'),
    Buffer.alloc(4096, 1),
  );
  assert.equal(isModelCached(MEDIUM_EN, 'fp32'), true);
});

test('isModelCached: DECODER-side split needs NO .onnx_data when decoder is quantized', () => {
  // Off Apple Silicon the per-module map quantizes the decoder to q8, loading
  // decoder_model_merged_quantized.onnx — which has no split. The external-data
  // requirement is keyed by the RESOLVED filename, so it must not demand a
  // companion that doesn't exist for the quantized variant.
  const dtype = {
    encoder_model: 'fp32',
    decoder_model_merged: 'q8',
    decoder_model: 'q8',
    decoder_with_past_model: 'q8',
  };
  stageOnnx(MEDIUM_EN, [
    ['encoder_model.onnx', 4096],
    ['decoder_model_merged_quantized.onnx', 4096], // self-contained q8
  ]);
  assert.equal(isModelCached(MEDIUM_EN, dtype), true);
});

test.after(() => {
  Module._load = origLoad;
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* noop */ }
});
