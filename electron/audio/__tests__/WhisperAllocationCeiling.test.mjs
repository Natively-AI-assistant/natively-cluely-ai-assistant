// Regression test for the Whisper Large v3 Turbo SIGTRAP (issue #402, 2026-07-28).
//
// Chromium's PartitionAlloc refuses any SINGLE allocation of 2 GiB - 2 MiB or
// more, and it does not return NULL — it traps:
//
//   MaxDirectMapped() = (1UL << 31) - kSuperPageSize   // partition_alloc_constants.h
//
// WHISPER_SAFE_DTYPE pins `encoder_model: 'fp32'` for every Whisper-family
// model. Whisper Large v3 Turbo's fp32 encoder weights are ~2.4 GB
// (encoder_model.onnx_data), ONNX Runtime materialises those initializers in
// one block, and the request lands exactly on the ceiling: posix_memalign →
// PartitionAlloc → `brk 0` → EXC_BREAKPOINT (SIGTRAP). The whole app dies with
// no catchable JS error and nothing in telemetry, and because the selected
// model preloads at startup the app crash-loops with no way into Settings.
//
// This is NOT out-of-memory (reproduces with 82% of RAM free) and it is NOT
// fixed by arena settings — onnxThreadConfig already defaults
// enableCpuMemArena:false and the crash happens anyway, because a single fp32
// initializer tensor is itself over the cap.
//
// Guards the two-layer fix:
//   1. buildWorkerInitMessage resolves the ENCODER (only) to q8 for checkpoints
//      whose catalog fp32 encoder size is at or above the cap.
//   2. preflightAllocation refuses such a load with a structured error before
//      pipeline()/CreateSession, for callers that bypass layer 1.
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-alloc-'));
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return { app: { getPath: () => userData, isReady: () => true } };
  }
  return origLoad.apply(this, arguments);
};

const guardPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/audio/whisper/allocationGuard.js',
);
const modelMgrPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/audio/whisper/modelManager.js',
);
const inferenceCfgPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/audio/whisper/inferenceConfig.js',
);

const {
  PARTITION_ALLOC_MAX_BYTES,
  ENCODER_FALLBACK_DTYPE,
  exceedsPartitionAllocCap,
  guardEncoderDtype,
  preflightAllocation,
} = await import(pathToFileURL(guardPath).href);
const { getModelEncoderFp32Bytes, getAvailableModels } = await import(
  pathToFileURL(modelMgrPath).href
);
const { buildWorkerInitMessage } = await import(pathToFileURL(inferenceCfgPath).href);

const TURBO = 'onnx-community/whisper-large-v3-turbo-ONNX';
const TINY_EN = 'Xenova/whisper-tiny.en';

// The per-module map the resolver produces on every platform.
const SAFE_DTYPE = {
  encoder_model: 'fp32',
  decoder_model: 'q8',
  decoder_model_merged: 'q8',
  decoder_with_past_model: 'q8',
};

const GIB = 1024 ** 3;

test('the cap is Chromium PartitionAlloc MaxDirectMapped: 2 GiB - 2 MiB', () => {
  assert.equal(PARTITION_ALLOC_MAX_BYTES, 2 ** 31 - 2 * 1024 * 1024);
  // Sanity: the crashing request in the report was exactly 0x80000000 (2 GiB),
  // which must be over the cap.
  assert.equal(exceedsPartitionAllocCap(0x80000000), true);
});

test('exceedsPartitionAllocCap: boundary is inclusive, unknown sizes are safe', () => {
  assert.equal(exceedsPartitionAllocCap(PARTITION_ALLOC_MAX_BYTES - 1), false);
  assert.equal(exceedsPartitionAllocCap(PARTITION_ALLOC_MAX_BYTES), true);
  assert.equal(exceedsPartitionAllocCap(PARTITION_ALLOC_MAX_BYTES + 1), true);
  // Unknown / absent / nonsense sizes must never block a load that works today.
  assert.equal(exceedsPartitionAllocCap(0), false);
  assert.equal(exceedsPartitionAllocCap(undefined), false);
  assert.equal(exceedsPartitionAllocCap(null), false);
  assert.equal(exceedsPartitionAllocCap(NaN), false);
  assert.equal(exceedsPartitionAllocCap(-1), false);
});

test('guardEncoderDtype downgrades ONLY the encoder for turbo-sized fp32 weights', () => {
  const res = guardEncoderDtype(SAFE_DTYPE, Math.round(2400 * 1024 * 1024));
  assert.equal(res.downgraded, true);
  assert.equal(res.dtype.encoder_model, ENCODER_FALLBACK_DTYPE);
  assert.equal(ENCODER_FALLBACK_DTYPE, 'q8');
  // Decoder entries are untouched — this fix must not silently change decoder
  // precision, and it must not drop keys the loader relies on.
  assert.equal(res.dtype.decoder_model, 'q8');
  assert.equal(res.dtype.decoder_model_merged, 'q8');
  assert.equal(res.dtype.decoder_with_past_model, 'q8');
  assert.ok(res.reason && res.reason.length > 0);
  // Input must not be mutated in place.
  assert.equal(SAFE_DTYPE.encoder_model, 'fp32');
});

test('guardEncoderDtype leaves small models, already-quantized encoders and unknown sizes alone', () => {
  // Small model (tiny.en fp32 encoder is a few tens of MB).
  const small = guardEncoderDtype(SAFE_DTYPE, 40 * 1024 * 1024);
  assert.equal(small.downgraded, false);
  assert.deepEqual(small.dtype, SAFE_DTYPE);

  // Encoder already quantized → nothing to downgrade, even at turbo size.
  const q8Encoder = { ...SAFE_DTYPE, encoder_model: 'q8' };
  const already = guardEncoderDtype(q8Encoder, 3 * GIB);
  assert.equal(already.downgraded, false);
  assert.deepEqual(already.dtype, q8Encoder);
  const uniformQ8 = guardEncoderDtype('q8', 3 * GIB);
  assert.equal(uniformQ8.downgraded, false);
  assert.equal(uniformQ8.dtype, 'q8');

  // Size unknown → treated as safe (no catalog figure must never break a load).
  const unknown = guardEncoderDtype(SAFE_DTYPE, undefined);
  assert.equal(unknown.downgraded, false);
  assert.deepEqual(unknown.dtype, SAFE_DTYPE);
});

test('guardEncoderDtype widens a uniform fp32 string into a map instead of quantizing everything', () => {
  const res = guardEncoderDtype('fp32', 3 * GIB);
  assert.equal(res.downgraded, true);
  assert.equal(typeof res.dtype, 'object');
  assert.equal(res.dtype.encoder_model, ENCODER_FALLBACK_DTYPE);
  // The rest of the graph keeps the requested fp32 — quantizing the decoder as
  // a side effect of an allocation fix would be a silent accuracy change.
  assert.equal(res.dtype.decoder_model, 'fp32');
  assert.equal(res.dtype.decoder_model_merged, 'fp32');
  assert.equal(res.dtype.decoder_with_past_model, 'fp32');
});

test('preflightAllocation refuses the untenable load and passes everything else', () => {
  // Layer-2: an init message hand-built with an fp32 encoder for turbo.
  const msg = preflightAllocation(TURBO, SAFE_DTYPE, Math.round(2400 * 1024 * 1024));
  assert.equal(typeof msg, 'string');
  assert.match(msg, /whisper-large-v3-turbo/);

  // Guarded config → safe to attempt.
  const guarded = guardEncoderDtype(SAFE_DTYPE, Math.round(2400 * 1024 * 1024)).dtype;
  assert.equal(preflightAllocation(TURBO, guarded, Math.round(2400 * 1024 * 1024)), null);
  // Small / unknown-size models are never refused.
  assert.equal(preflightAllocation(TINY_EN, SAFE_DTYPE, 40 * 1024 * 1024), null);
  assert.equal(preflightAllocation(TINY_EN, SAFE_DTYPE, undefined), null);
});

test('catalog records the turbo fp32 encoder size, and only where it matters', () => {
  const bytes = getModelEncoderFp32Bytes(TURBO);
  assert.equal(typeof bytes, 'number');
  assert.equal(exceedsPartitionAllocCap(bytes), true);
  assert.equal(getModelEncoderFp32Bytes(TINY_EN), undefined);
  assert.equal(getModelEncoderFp32Bytes('does/not-exist'), undefined);
});

test('buildWorkerInitMessage never sends an fp32 encoder for Whisper Large v3 Turbo', () => {
  // THE BUG: this used to resolve encoder_model:'fp32' → 2 GiB allocation → SIGTRAP.
  const init = buildWorkerInitMessage(TURBO);
  const encoder = typeof init.dtype === 'string' ? init.dtype : init.dtype.encoder_model;
  assert.notEqual(encoder, 'fp32');
  assert.equal(encoder, ENCODER_FALLBACK_DTYPE);
  // And the size travels with the message so the worker can preflight too.
  assert.equal(exceedsPartitionAllocCap(init.encoderFp32Bytes), true);
  // The guarded config must itself pass the worker's preflight.
  assert.equal(preflightAllocation(TURBO, init.dtype, init.encoderFp32Bytes), null);
});

test('buildWorkerInitMessage leaves small models exactly as before', () => {
  const init = buildWorkerInitMessage(TINY_EN);
  const encoder = typeof init.dtype === 'string' ? init.dtype : init.dtype.encoder_model;
  // Encoder accuracy is preserved for everything that can actually be loaded.
  assert.equal(encoder, 'fp32');
  assert.equal(init.encoderFp32Bytes, undefined);
  assert.equal(preflightAllocation(TINY_EN, init.dtype, init.encoderFp32Bytes), null);
});

test('model status is computed for the dtype turbo will actually load', () => {
  // The guard makes turbo load a QUANTIZED encoder. Reporting "available"
  // because the old fp32 encoder happens to sit in the cache would show a
  // ready-to-use model whose encoder still has to be downloaded.
  const onnxDir = path.join(userData, 'whisper-models', TURBO, 'onnx');
  fs.mkdirSync(onnxDir, { recursive: true });
  for (const f of ['encoder_model.onnx', 'encoder_model.onnx_data', 'decoder_model_merged_quantized.onnx']) {
    fs.writeFileSync(path.join(onnxDir, f), Buffer.alloc(4096, 1));
  }
  const before = getAvailableModels().find(m => m.id === TURBO);
  assert.equal(before.status, 'missing');

  // With the q8 encoder present it is genuinely usable.
  fs.writeFileSync(path.join(onnxDir, 'encoder_model_quantized.onnx'), Buffer.alloc(4096, 1));
  const after = getAvailableModels().find(m => m.id === TURBO);
  assert.equal(after.status, 'available');
});

test.after(() => {
  Module._load = origLoad;
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* noop */ }
});
