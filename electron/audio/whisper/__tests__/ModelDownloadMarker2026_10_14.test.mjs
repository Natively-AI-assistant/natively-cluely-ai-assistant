// electron/audio/whisper/__tests__/ModelDownloadMarker2026_10_14.test.mjs
//
// THE BUG: transformers.js writes each model file straight to its final name,
// and "is this model installed" only asked whether the files were bigger than
// zero. A download cut short by quitting the app, losing the network or
// cancelling left a truncated file that looked installed: the next launch
// promoted it to "complete", skipped the download, and every load failed with
// "Protobuf parsing failed". Found on a real profile (2026-10-14): a 2.1 MB
// encoder_model.onnx for whisper-small.en, listed as installed.
//
// THE FIX: a marker file inside the model's directory for as long as its
// download is in progress. While it exists the model is not cached, whatever
// else is on disk.
//
// A plain file in a plain directory: identical on macOS and Windows. Runs
// against a temp dir; not executed on Windows.
//
// Run: npm run build:electron && node --test electron/audio/whisper/__tests__/ModelDownloadMarker2026_10_14.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let userData = fs.mkdtempSync(path.join(os.tmpdir(), 'model-marker-'));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const mm = await import(
  pathToFileURL(path.resolve(__dirname, '../../../../dist-electron/electron/audio/whisper/modelManager.js')).href
);

const WHISPER = 'Xenova/whisper-tiny.en';
const NEMOTRON = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';
const PARAKEET = 'istupakov/parakeet-tdt-0.6b-v3-onnx';
const DTYPE = { encoder_model: 'fp32', decoder_model_merged: 'q8' };

const modelsDir = () => path.join(userData, 'whisper-models');
// Where a download of `id` lands: its catalog repoId (2026-10-15), else the id.
const dirOf = (id) => path.join(modelsDir(), ...mm.getModelDownloadRepo(id).split('/'));
function write(id, rel, bytes = 16) {
  const file = path.join(dirOf(id), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 1));
}
/** Files that pass every size > 0 check for each model family. */
function installLookalike(id) {
  if (id === WHISPER) {
    write(id, 'onnx/encoder_model.onnx');
    write(id, 'onnx/decoder_model_merged_quantized.onnx');
  } else if (id === NEMOTRON) {
    for (const f of mm.NEMOTRON_REQUIRED_FILES) write(id, f);
  } else {
    for (const f of mm.PARAKEET_TDT_REQUIRED_FILES) write(id, f);
  }
}
const cached = (id) => mm.isModelCached(id, DTYPE);

beforeEach(() => { userData = fs.mkdtempSync(path.join(os.tmpdir(), 'model-marker-')); });

for (const id of [WHISPER, NEMOTRON, PARAKEET]) {
  test(`${id}: files that look installed are NOT cached while the download is in progress`, () => {
    mm.markModelDownloadStarted(id);
    installLookalike(id); // a truncated download is indistinguishable from this by size
    assert.equal(mm.isModelDownloadIncomplete(id), true);
    assert.equal(cached(id), false, 'BUG: an interrupted download is promoted to "installed" and every load fails');
  });

  test(`${id}: once the download is finished the same files are cached`, () => {
    mm.markModelDownloadStarted(id);
    installLookalike(id);
    mm.clearModelDownloadMarker(id);
    assert.equal(mm.isModelDownloadIncomplete(id), false);
    assert.equal(cached(id), true);
  });
}

test('a model installed before this fix (no marker) is still cached', () => {
  installLookalike(WHISPER);
  assert.equal(cached(WHISPER), true, 'existing installs must not be re-downloaded');
});

test('the marker is written before any model file exists, into a directory it creates', () => {
  assert.equal(fs.existsSync(dirOf(WHISPER)), false);
  mm.markModelDownloadStarted(WHISPER);
  assert.equal(fs.existsSync(path.join(dirOf(WHISPER), mm.DOWNLOAD_INCOMPLETE_MARKER)), true);
  assert.equal(mm.isModelCached(WHISPER), false, 'the legacy "directory is not empty" check must not count the marker');
});

test('the marker survives a process that dies mid-download (it is on disk, not in memory)', () => {
  mm.markModelDownloadStarted(WHISPER);
  installLookalike(WHISPER);
  // Nothing in this process is consulted — only the file.
  assert.equal(JSON.parse(fs.readFileSync(path.join(dirOf(WHISPER), mm.DOWNLOAD_INCOMPLETE_MARKER), 'utf8')).startedAt > 0, true);
  assert.equal(cached(WHISPER), false);
});

test('deleting the model removes the marker with it', () => {
  mm.markModelDownloadStarted(WHISPER);
  installLookalike(WHISPER);
  mm.deleteModel(WHISPER);
  assert.equal(mm.isModelDownloadIncomplete(WHISPER), false);
});

// 2026-10-15 review: a purge after a failed load must never take a folder a
// download is still writing (its files are not the ones that failed, and
// deleting them under the downloader breaks the download).
test('a damaged-model purge leaves a folder that is still downloading alone', () => {
  mm.markModelDownloadStarted(NEMOTRON);
  installLookalike(NEMOTRON);
  assert.equal(mm.purgeCorruptModel(NEMOTRON, 'Protobuf parsing failed'), false);
  assert.equal(fs.existsSync(dirOf(NEMOTRON)), true);
  mm.clearModelDownloadMarker(NEMOTRON);
  assert.equal(mm.purgeCorruptModel(NEMOTRON, 'Protobuf parsing failed'), true, 'a finished install is purged as before');
  assert.equal(fs.existsSync(dirOf(NEMOTRON)), false);
});

test('clearing a marker that is not there is a no-op', () => {
  assert.doesNotThrow(() => mm.clearModelDownloadMarker('never/downloaded'));
  assert.equal(mm.isModelDownloadIncomplete('never/downloaded'), false);
});

test('an explicit cache dir is honoured (paths are joined, never concatenated)', () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'model marker with spaces-'));
  mm.markModelDownloadStarted(WHISPER, other);
  assert.equal(mm.isModelDownloadIncomplete(WHISPER, other), true);
  assert.equal(mm.isModelDownloadIncomplete(WHISPER), false, 'the default dir is untouched');
  assert.equal(fs.existsSync(path.join(other, 'onnx-community', 'whisper-tiny.en', mm.DOWNLOAD_INCOMPLETE_MARKER)), true);
});
