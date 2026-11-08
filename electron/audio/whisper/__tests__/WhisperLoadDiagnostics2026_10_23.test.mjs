// electron/audio/whisper/__tests__/WhisperLoadDiagnostics2026_10_23.test.mjs
//
// Issue #668 (Windows, 2.9.2, Xenova/whisper-small): the reporter read the
// worker's load diagnostics to find out why nothing was transcribed, and two
// lines pointed the wrong way.
//
//  - `[WhisperWorker][diag]` built the file names itself. For the default
//    mixed dtype map (fp32 encoder, q8 decoders) it named
//    `decoder_model_merged.onnx` with size -1, while the file transformers.js
//    loads, and that was on disk, is `decoder_model_merged_quantized.onnx`.
//    A plain 'q8' string came out as `encoder_model_q8.onnx`, also wrong, and
//    external-data companions were never listed. The diag now stats
//    loadedOnnxFiles(), the list the resumable downloader and the install
//    check are built from.
//  - `SystemAudio->STT: chunk ... googleSTT=active` on Local STT: the field
//    holds the interviewer provider of any kind. The log now names the one
//    createSTTProvider built (Google when a key was missing).
//
// The cause of the empty meetings themselves (passes piling up on a slow
// CPU) is covered by the whisperTaskQueue tests (43f036ed).
//
// Plain files in a temp dir with a space in its path; same on macOS and
// Windows. Not executed on Windows.
//
// Run: npm run build:electron && node --test electron/audio/whisper/__tests__/WhisperLoadDiagnostics2026_10_23.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../../..');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper diag-'));
after(() => fs.rmSync(userData, { recursive: true, force: true }));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') return { app: { getPath: () => userData, isReady: () => true } };
  return origLoad.apply(this, arguments);
};

const dist = path.resolve(repo, 'dist-electron/electron');
const mm = await import(pathToFileURL(path.join(dist, 'audio/whisper/modelManager.js')).href);

// The loader's own table, from the installed (pinned) transformers.js, so a
// drift on either side fails here instead of agreeing with itself.
const transformersDir = path.join(repo, 'node_modules', '@huggingface', 'transformers');
const { DEFAULT_DTYPE_SUFFIX_MAPPING } = await import(pathToFileURL(path.join(transformersDir, 'src/utils/dtypes.js')).href);

const MIXED = {
  decoder_model: 'q8',
  decoder_model_merged: 'q8',
  decoder_with_past_model: 'q8',
  encoder_model: 'fp32',
  model: 'q8',
};

test('the default mixed map lists the fp32 encoder and the quantized merged decoder', () => {
  assert.deepEqual(mm.loadedOnnxFiles(MIXED), ['encoder_model.onnx', 'decoder_model_merged_quantized.onnx']);
});

test('every dtype gets the suffix transformers.js loads', () => {
  for (const [dtype, suffix] of Object.entries(DEFAULT_DTYPE_SUFFIX_MAPPING)) {
    assert.deepEqual(
      mm.loadedOnnxFiles(dtype),
      [`encoder_model${suffix}.onnx`, `decoder_model_merged${suffix}.onnx`],
      dtype,
    );
  }
  assert.equal(DEFAULT_DTYPE_SUFFIX_MAPPING.q8, '_quantized');
});

test('a module missing from the map is fp32, which is what transformers.js picks on the CPU', () => {
  assert.deepEqual(mm.loadedOnnxFiles({ encoder_model: 'q8' }), ['encoder_model_quantized.onnx', 'decoder_model_merged.onnx']);
});

test('external-data companions are listed, so a stub without its weights shows up', () => {
  assert.deepEqual(
    mm.loadedOnnxFiles(MIXED, { encoder_model: true }),
    ['encoder_model.onnx', 'encoder_model.onnx_data', 'decoder_model_merged_quantized.onnx'],
  );
});

test("a 'single' layout lists its one model file", () => {
  assert.deepEqual(mm.loadedOnnxFiles(MIXED, undefined, 'single'), ['model_quantized.onnx']);
});

test('the onnx folder is the one the install check reads, for a path with spaces', () => {
  const cacheDir = path.join(userData, 'whisper-models');
  assert.equal(mm.onnxDirFor(cacheDir, 'Xenova/whisper-small'), path.join(cacheDir, 'Xenova', 'whisper-small', 'onnx'));

  const id = 'onnx-community/moonshine-base-ONNX';
  const onnxDir = mm.onnxDirFor(cacheDir, mm.getModelDownloadRepo(id));
  for (const dtype of [MIXED, 'fp32', 'q8']) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(onnxDir, { recursive: true });
    fs.writeFileSync(path.join(path.dirname(onnxDir), 'config.json'), '{}');
    for (const f of mm.loadedOnnxFiles(dtype)) fs.writeFileSync(path.join(onnxDir, f), 'x');
    assert.equal(mm.isModelCached(id, dtype), true, JSON.stringify(dtype));
  }
});

test('the worker diag stats loadedOnnxFiles in onnxDirFor, not names of its own', () => {
  const src = fs.readFileSync(path.join(repo, 'electron/audio/whisper/whisperWorker.ts'), 'utf8');
  assert.match(src, /onnxDirFor\(String\(msg\.cacheDir\), String\(sourceRepoId\)\)/);
  assert.match(src, /loadedOnnxFiles\(dtype, msg\.useExternalDataFormat, msg\.sessionLayout\)/);
  assert.doesNotMatch(src, /decoder_model_merged_\$\{/);
  assert.doesNotMatch(src, /encoder_model_\$\{/);
});

test('the system-audio chunk log names the provider that was built, not "googleSTT"', () => {
  const src = fs.readFileSync(path.join(repo, 'electron/main.ts'), 'utf8');
  const line = src.split('\n').find((l) => l.includes('SystemAudio->STT: chunk #'));
  assert.ok(line, 'chunk log line present');
  assert.doesNotMatch(line, /googleSTT=/);
  assert.match(line, /stt=\$\{sttLabel\}/);
  const label = src.slice(src.indexOf('const sttLabel = this.googleSTT'), src.indexOf('SystemAudio->STT: chunk #'));
  // From the constructed instance, so a missing key that fell back to Google
  // reads 'google'; and says when a stand-in carries the audio.
  assert.match(label, /this\._sttGapProvider\.system\.effective/);
  assert.match(label, /this\._sttFailover\.system\?\.active \? ' \(stand-in carrying\)'/);
  assert.match(src, /stt instanceof GoogleSTT \? 'google'/);
  assert.match(src, /this\._sttGapProvider\[gapSource\] = \{\s*effective: effectiveSttId,/);
});
