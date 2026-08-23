// F-113 regression test (audit/autopilot-2026-08-14).
//
// createWindow() computed getCombinedDisplayBounds() ONCE; the window is
// preloaded at startup and reused forever (hideOrClose only hides), and no
// display-change listener exists anywhere in electron/. After a monitor
// plug/unplug or DPI change, regions of the new virtual screen were
// unselectable and the confirm listener's local→global mapping (stale
// origin) disagreed with validateBounds' fresh combined bounds — valid area
// selections were silently rejected. Reproduced in
// scripts/audit/F-113-repro.mjs.
//
// Contract: showCropper()'s reuse branch re-fits the window to the CURRENT
// combined display bounds before arming the selection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPILED = path.resolve(__dirname, '../../../dist-electron/electron/CropperWindowHelper.js');

let displays = [{ bounds: { x: 0, y: 0, width: 1440, height: 900 } }];
const fakeElectron = {
  app: { isPackaged: false, getAppPath: () => '/tmp', on: () => {}, removeListener: () => {} },
  ipcMain: { on: () => {}, removeListener: () => {} },
  screen: {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[displays.length - 1],
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
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

test('showCropper re-fits a reused window to the current display arrangement', async () => {
  const helper = new CropperWindowHelper();
  const win = {
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    isDestroyed: () => false,
    getBounds() { return { ...this.bounds }; },
    setBounds(b) { this.bounds = { ...b }; },
    webContents: { send: () => {} },
    setContentProtection: () => {},
    setOpacity: () => {},
    show: () => {},
    hide: () => {},
    focus: () => {},
    destroy: () => {},
  };
  helper.cropperWindow = win;

  // A second monitor appears to the LEFT of the primary after creation.
  displays = [
    { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: 0, y: 0, width: 1440, height: 900 } },
  ];

  const p = helper.showCropper(150).catch(() => null);
  const after = win.getBounds();
  await p;

  assert.deepEqual(
    after,
    { x: -1920, y: 0, width: 3360, height: 1080 },
    'reuse branch must re-fit the window to the fresh combined bounds — stale bounds make new monitors unselectable and break the local→global mapping (F-113)'
  );
});
