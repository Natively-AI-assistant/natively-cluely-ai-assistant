// electron/audio/whisper/__tests__/WhisperCatalogRepoMigration2026_10_15.test.mjs
//
// THE CHANGE (2026-10-15): Whisper files come from onnx-community's exports
// instead of Xenova's. The Xenova encoders return every layer's attention map
// as a graph output (Medium: 24 maps, ~3.5 GB per call); onnx-community's
// return the hidden state alone (Small: 0.65 GB peak against 3.04 GB,
// identical output). Large v3 Turbo moves off its `-ONNX` repo, whose decoder
// needs a `cache_position` input transformers.js never sends.
//
// What must hold:
//  - the ids Settings stores do not change;
//  - a machine that downloaded a Xenova copy keeps using it (no forced
//    re-download on update), and moves to the new copy once it has it;
//  - the old Turbo files are never loaded and are swept;
//  - Medium English (no light export) stays for those who have it only;
//  - Whisper gets more encoder threads, other models keep one.
//
// Temp dir with a space in its path; plain files, same on macOS and Windows.
// Not executed on Windows.
//
// Run: npm run build:electron && node --test electron/audio/whisper/__tests__/WhisperCatalogRepoMigration2026_10_15.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let userData = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog repo-'));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') return { app: { getPath: () => userData, isReady: () => true } };
  return origLoad.apply(this, arguments);
};

const dist = path.resolve(__dirname, '../../../../dist-electron/electron');
const mm = await import(pathToFileURL(path.join(dist, 'audio/whisper/modelManager.js')).href);
const { buildWorkerInitMessage, resolveInferenceConfig } = await import(pathToFileURL(path.join(dist, 'audio/whisper/inferenceConfig.js')).href);
const { getBoundedOnnxSessionOptions } = await import(pathToFileURL(path.join(dist, 'utils/onnxThreadConfig.js')).href);

const DTYPE = resolveInferenceConfig().dtype;
const SMALL = 'Xenova/whisper-small';
const SMALL_NEW = 'onnx-community/whisper-small';
const TURBO = 'onnx-community/whisper-large-v3-turbo-ONNX';
const TURBO_NEW = 'onnx-community/whisper-large-v3-turbo';
const MEDIUM_EN = 'Xenova/whisper-medium.en';

beforeEach(() => { userData = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog repo-')); });
const models = () => path.join(userData, 'whisper-models');
const dir = (repo) => path.join(models(), ...repo.split('/'));
/** A complete-looking copy of `modelId`'s files under `repo`. */
function install(modelId, repo) {
  for (const rel of mm.getResumableDownloadFiles(modelId, DTYPE)) {
    const f = path.join(dir(repo), rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'x');
  }
}

test('the ids Settings stores are unchanged; the files come from onnx-community', () => {
  for (const id of [
    'Xenova/whisper-tiny', 'Xenova/whisper-tiny.en', 'Xenova/whisper-base', 'Xenova/whisper-base.en',
    'Xenova/whisper-small', 'Xenova/whisper-small.en', 'Xenova/whisper-medium', 'Xenova/whisper-medium.en',
    'distil-whisper/distil-small.en', TURBO,
  ]) {
    assert.equal(mm.MODEL_CATALOG_IDS.has(id), true, `${id} must stay valid or a saved selection resets to Tiny English`);
  }
  assert.equal(mm.getModelDownloadRepo('Xenova/whisper-base'), 'onnx-community/whisper-base');
  assert.equal(mm.getModelDownloadRepo('Xenova/whisper-medium'), 'onnx-community/whisper-medium-ONNX');
  assert.equal(mm.getModelDownloadRepo('distil-whisper/distil-small.en'), 'onnx-community/distil-small.en');
  assert.equal(mm.getModelDownloadRepo(TURBO), TURBO_NEW);
  assert.equal(mm.getModelDownloadRepo(MEDIUM_EN), MEDIUM_EN, 'no onnx-community medium.en exists');
  assert.equal(mm.getModelDownloadRepo('onnx-community/moonshine-base-ONNX'), 'onnx-community/moonshine-base-ONNX');
});

test('a Xenova copy downloaded before the update keeps working: no forced re-download', () => {
  install(SMALL, SMALL);
  assert.equal(mm.isModelCached(SMALL, DTYPE), true);
  assert.equal(mm.resolveModelSourceRepo(SMALL, DTYPE), SMALL);
  const init = buildWorkerInitMessage(SMALL);
  assert.equal(init.sourceRepoId, undefined, 'loads from the id, as before');
  assert.equal(init.resumableFiles, undefined, 'installed: nothing to download');
});

test('a fresh install downloads the onnx-community copy, resumably', () => {
  assert.equal(mm.isModelCached(SMALL, DTYPE), false);
  const init = buildWorkerInitMessage(SMALL);
  assert.equal(init.modelId, SMALL, 'progress and errors still report the stored id');
  assert.equal(init.sourceRepoId, SMALL_NEW);
  assert.ok(init.resumableFiles.includes('onnx/encoder_model.onnx'));
  assert.ok(init.resumableFiles.some(f => f.startsWith('onnx/decoder_model_merged')));
  mm.markModelDownloadStarted(SMALL);
  assert.equal(fs.existsSync(path.join(dir(SMALL_NEW), mm.DOWNLOAD_INCOMPLETE_MARKER)), true);
});

test('with both copies on disk the new one is loaded, and the launch sweep removes the old one', () => {
  install(SMALL, SMALL);
  install(SMALL, SMALL_NEW);
  assert.equal(buildWorkerInitMessage(SMALL).sourceRepoId, SMALL_NEW);
  const removed = mm.purgeObsoleteModelCaches(models(), DTYPE);
  assert.ok(removed.includes(SMALL));
  assert.equal(fs.existsSync(dir(SMALL)), false);
  assert.equal(mm.isModelCached(SMALL, DTYPE), true);
});

test('the old copy is NOT swept while the new one is incomplete', () => {
  install(SMALL, SMALL);
  install(SMALL, SMALL_NEW);
  mm.markModelDownloadStarted(SMALL);
  assert.equal(mm.resolveModelSourceRepo(SMALL, DTYPE), SMALL, 'the working copy is still the one loaded');
  mm.purgeObsoleteModelCaches(models(), DTYPE);
  assert.equal(fs.existsSync(dir(SMALL)), true, 'BUG: the only working copy deleted mid-download');
  assert.equal(mm.isModelCached(SMALL, DTYPE), true);
});

test('the old Turbo repo is never loaded and is swept at launch', () => {
  install(TURBO, TURBO);
  fs.writeFileSync(path.join(dir(TURBO), 'onnx', 'encoder_model.onnx_data'), 'x');
  assert.equal(mm.isModelCached(TURBO, DTYPE), false, 'its decoder fails every call (cache_position)');
  assert.equal(buildWorkerInitMessage(TURBO).sourceRepoId, TURBO_NEW);
  assert.ok(mm.purgeObsoleteModelCaches(models(), DTYPE).includes(TURBO));
  assert.equal(fs.existsSync(dir(TURBO)), false);
});

test('Turbo from the new repo counts as installed only with its encoder weights file', () => {
  install(TURBO, TURBO_NEW);
  assert.ok(mm.getResumableDownloadFiles(TURBO, DTYPE).includes('onnx/encoder_model.onnx_data'));
  assert.equal(mm.isModelCached(TURBO, DTYPE), true);
  fs.rmSync(path.join(dir(TURBO_NEW), 'onnx', 'encoder_model.onnx_data'));
  assert.equal(mm.isModelCached(TURBO, DTYPE), false);
});

test('Medium English is listed only where it is already installed', () => {
  const listed = () => mm.getAvailableModels().some(m => m.id === MEDIUM_EN);
  assert.equal(listed(), false, 'not offered to new installs: ~3.5 GB of attention maps per call');
  install(MEDIUM_EN, MEDIUM_EN);
  fs.writeFileSync(path.join(dir(MEDIUM_EN), 'onnx', 'decoder_model_merged_quantized.onnx_data'), 'x');
  assert.equal(listed(), true, 'kept for the people using it');
  assert.equal(mm.getAvailableModels().some(m => m.id === 'Xenova/whisper-medium'), true);
});

test('deleting a model removes both copies', () => {
  install(SMALL, SMALL);
  install(SMALL, SMALL_NEW);
  mm.deleteModel(SMALL);
  assert.equal(fs.existsSync(dir(SMALL)), false);
  assert.equal(fs.existsSync(dir(SMALL_NEW)), false);
});

test('a damaged copy is purged; the other copy is left alone', () => {
  install(SMALL, SMALL_NEW);
  install(SMALL, SMALL);
  assert.equal(mm.purgeCorruptModel(SMALL, 'Protobuf parsing failed'), true);
  assert.equal(fs.existsSync(dir(SMALL_NEW)), false, 'the copy that was loaded');
  assert.equal(fs.existsSync(dir(SMALL)), true);
});

test('cleanup before a resumed download never touches the old working copy', () => {
  install(SMALL, SMALL);
  install(SMALL, SMALL_NEW);
  fs.writeFileSync(path.join(dir(SMALL_NEW), 'config.json'), '{');
  mm.deleteInterruptedModelDownload(SMALL, models());
  assert.equal(fs.existsSync(path.join(dir(SMALL_NEW), 'config.json')), false);
  assert.equal(fs.existsSync(path.join(dir(SMALL_NEW), 'onnx', 'encoder_model.onnx')), true, 'resume point kept');
  assert.equal(fs.existsSync(path.join(dir(SMALL), 'onnx', 'encoder_model.onnx')), true);
});

test('Whisper and Distil-Whisper get the multi-thread encoder default; other models keep one thread', () => {
  const expected = getBoundedOnnxSessionOptions('whisper-encode').intraOpNumThreads;
  const cores = os.cpus().length;
  if (!process.env.NATIVELY_ONNX_INTRA_OP_THREADS) {
    assert.equal(expected, Math.max(1, Math.min(4, Math.floor(cores / 2))));
  }
  for (const id of [SMALL, 'Xenova/whisper-tiny.en', 'distil-whisper/distil-small.en', 'distil-whisper/distil-large-v3', TURBO]) {
    assert.equal(buildWorkerInitMessage(id).intraOpThreads, expected, id);
  }
  for (const id of ['onnx-community/moonshine-base-ONNX', 'istupakov/parakeet-tdt-0.6b-v3-onnx', 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4']) {
    assert.equal(buildWorkerInitMessage(id).intraOpThreads, undefined, id);
  }
  assert.equal(getBoundedOnnxSessionOptions().intraOpNumThreads, process.env.NATIVELY_ONNX_INTRA_OP_THREADS ? Number(process.env.NATIVELY_ONNX_INTRA_OP_THREADS) : 1);
});

test('an older copy offers an update; the download targets the current copy while the older one keeps loading', () => {
  install(SMALL, SMALL);
  assert.equal(mm.isModelUpgradeAvailable(SMALL, DTYPE), true);
  assert.equal(mm.getAvailableModels().find(m => m.id === SMALL).upgradeAvailable, true);
  assert.equal(mm.isModelDownloadComplete(SMALL, DTYPE), false);

  const meeting = buildWorkerInitMessage(SMALL);
  assert.equal(meeting.sourceRepoId, undefined, 'a meeting keeps using the older copy');
  assert.equal(meeting.resumableFiles, undefined);
  const download = buildWorkerInitMessage(SMALL, { forDownload: true });
  assert.equal(download.sourceRepoId, SMALL_NEW);
  assert.ok(download.resumableFiles.length > 0);

  // Mid-update: the marker sits on the new copy only; the old one still loads.
  mm.markModelDownloadStarted(SMALL);
  assert.equal(mm.isModelCached(SMALL, DTYPE), true);
  assert.equal(buildWorkerInitMessage(SMALL).sourceRepoId, undefined);

  install(SMALL, SMALL_NEW);
  mm.clearModelDownloadMarker(SMALL);
  assert.equal(mm.isModelDownloadComplete(SMALL, DTYPE), true);
  assert.equal(mm.isModelUpgradeAvailable(SMALL, DTYPE), false);
  assert.equal(mm.getAvailableModels().find(m => m.id === SMALL).upgradeAvailable, false);
  assert.equal(buildWorkerInitMessage(SMALL).sourceRepoId, SMALL_NEW, 'the next meeting uses the lighter copy');
});

test('no update is offered for a fresh install, the current copy, or a model with no lighter copy', () => {
  assert.equal(mm.isModelUpgradeAvailable(SMALL, DTYPE), false, 'nothing installed');
  install(SMALL, SMALL_NEW);
  assert.equal(mm.isModelUpgradeAvailable(SMALL, DTYPE), false);
  install(MEDIUM_EN, MEDIUM_EN);
  assert.equal(mm.isModelUpgradeAvailable(MEDIUM_EN, DTYPE), false);
  install(TURBO, TURBO);
  assert.equal(mm.isModelUpgradeAvailable(TURBO, DTYPE), false, 'the old Turbo is not a working copy');
});
