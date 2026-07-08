// Regression test for the startup poison-recovery path (2026-07-08).
//
// When the previous app process died while loading a local Whisper model
// natively, the leftover whisper-load-sentinel.json must be consumed BEFORE
// any validation/preload work in electron/main.ts. If it points to a model
// id that is currently selected (global or per-channel), those settings must
// be reset to the safe fallback and a recovery notice must be stashed on
// AppState for the renderer to pull.
//
// Guards (source-extracted, since main.ts is a 6500+ line file we don't want
// to load in a unit test):
//   1. main.ts calls modelPreloader.consumePoisonedLoadSentinel() before any
//      preload/validation logic in the setImmediate block.
//   2. main.ts resets matching localWhisperModel{,Mic,System} settings to
//      'Xenova/whisper-tiny.en'.
//   3. AppState exposes setLocalWhisperRecoveryNotice /
//      takeLocalWhisperRecoveryNotice for the pull IPC.
//   4. ipcHandlers registers a `local-whisper-get-recovery-notice` handler
//      that calls takeLocalWhisperRecoveryNotice.
//   5. preload.ts exposes electronAPI.localWhisperGetRecoveryNotice().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function readSrc(relPath) {
  return fs.readFileSync(path.resolve(root, relPath), 'utf8');
}

test('main.ts consumes the Whisper load sentinel before any preload/validation', () => {
  const src = readSrc('electron/main.ts');
  const setImmediateStart = src.indexOf('setImmediate(() => {');
  assert.ok(setImmediateStart > -1, 'expected setImmediate(() => { block in main.ts');
  const block = src.slice(setImmediateStart, setImmediateStart + 8000);
  const consumeIdx = block.indexOf('consumePoisonedLoadSentinel');
  assert.ok(consumeIdx > -1, 'main.ts must call consumePoisonedLoadSentinel in the local Whisper preload block');
  const catalogIdx = block.indexOf('MODEL_CATALOG_IDS.has(rawModelId)');
  assert.ok(catalogIdx > -1, 'main.ts must still validate against MODEL_CATALOG_IDS');
  assert.ok(consumeIdx < catalogIdx, 'sentinel consume must run BEFORE catalog validation');
  // Must reset matching settings to the safe fallback BEFORE the preloader call.
  const fallbackIdx = block.indexOf("'Xenova/whisper-tiny.en'");
  assert.ok(fallbackIdx > -1, 'main.ts must reference the safe fallback id');
  const preloadCallIdx = block.indexOf('modelPreloader.preload(');
  assert.ok(preloadCallIdx > -1, 'main.ts must call modelPreloader.preload somewhere in the block');
  assert.ok(consumeIdx < preloadCallIdx, 'sentinel consume must run BEFORE preload()');
  // Must stash the recovery notice for the renderer.
  assert.ok(
    block.includes('setLocalWhisperRecoveryNotice'),
    'main.ts must stash a recovery notice on AppState so the renderer can surface it',
  );
});

test('AppState exposes the recovery-notice getter/setter pair', () => {
  const src = readSrc('electron/main.ts');
  assert.ok(src.includes('setLocalWhisperRecoveryNotice'), 'AppState.setLocalWhisperRecoveryNotice must exist');
  assert.ok(src.includes('takeLocalWhisperRecoveryNotice'), 'AppState.takeLocalWhisperRecoveryNotice must exist');
  const take = src.indexOf('takeLocalWhisperRecoveryNotice');
  // take should null the field after returning it, so callers don't see the
  // same notice twice across reloads.
  assert.ok(take > -1);
  const body = src.slice(take, take + 600);
  assert.ok(
    body.includes('this.localWhisperRecoveryNotice = null'),
    'takeLocalWhisperRecoveryNotice must clear the stashed notice so it is one-shot',
  );
});

test('ipcHandlers registers the recovery-notice pull IPC', () => {
  const src = readSrc('electron/ipcHandlers.ts');
  assert.ok(
    src.includes("safeHandle('local-whisper-get-recovery-notice'"),
    'ipcHandlers must register local-whisper-get-recovery-notice',
  );
  // The handler should defer to AppState's take method, not invent the
  // shape itself (single source of truth).
  assert.ok(
    src.includes('takeLocalWhisperRecoveryNotice'),
    'the handler must consume the notice via AppState.takeLocalWhisperRecoveryNotice()',
  );
});

test('preload exposes localWhisperGetRecoveryNotice on the renderer bridge', () => {
  const preload = readSrc('electron/preload.ts');
  assert.ok(
    preload.includes('localWhisperGetRecoveryNotice'),
    'preload.ts must expose localWhisperGetRecoveryNotice',
  );
  assert.ok(
    preload.includes("ipcRenderer.invoke('local-whisper-get-recovery-notice')"),
    'preload bridge must invoke the recovery-notice IPC',
  );
});