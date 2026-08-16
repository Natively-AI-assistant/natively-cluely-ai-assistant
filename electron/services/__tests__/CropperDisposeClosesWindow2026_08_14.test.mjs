// F-112 regression test (audit/autopilot-2026-08-14).
//
// dispose() set isDisposed = true and THEN called closeWindow(), whose guard
// includes `!this.isDisposed` — a guaranteed no-op — before dropping the
// window reference. The live BrowserWindow was orphaned on every dispose
// (reached from before-quit), polluting window-all-closed accounting during
// shutdown. Reproduced in scripts/audit/F-112-repro.mjs.
//
// Contract: dispose() must tear the window down (destroy on the forced
// cleanup path) before nulling the reference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPILED = path.resolve(__dirname, '../../../dist-electron/electron/CropperWindowHelper.js');

const fakeElectron = {
  app: { isPackaged: false, getAppPath: () => '/tmp', on: () => {}, removeListener: () => {} },
  ipcMain: { on: () => {}, removeListener: () => {} },
  screen: {
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1440, height: 900 } }],
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  },
  BrowserWindow: function () { throw new Error('not constructed in this test'); },
};

const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') return fakeElectron;
  if (request.endsWith('.node') || request.includes('native-module')) return {};
  return origLoad.apply(this, arguments);
};

const { CropperWindowHelper } = await import(COMPILED);

test('dispose() tears down the live window instead of orphaning it', () => {
  const helper = new CropperWindowHelper();
  const win = {
    closed: 0,
    destroyed: 0,
    isDestroyed: () => false,
    close() { this.closed += 1; },
    destroy() { this.destroyed += 1; },
    hide() {},
  };
  helper.cropperWindow = win;

  helper.dispose();

  assert.ok(
    win.closed + win.destroyed >= 1,
    'dispose() must close/destroy the window — the old closeWindow() call no-op\'d on its own isDisposed guard (F-112)'
  );
});
