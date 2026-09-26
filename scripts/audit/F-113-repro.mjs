// F-113 repro: the cropper window's bounds are frozen at creation time.
//
// createWindow() computes getCombinedDisplayBounds() ONCE (the window is
// preloaded at app startup and reused forever — hideOrClose() only hides it,
// and no display-added/removed/metrics-changed listener exists anywhere in
// electron/). After docking/undocking a laptop or plugging a monitor:
//   - regions of the new virtual screen are not covered → unselectable;
//   - the confirm listener maps local→global with the STALE window origin
//     while validateBounds checks FRESH combined bounds → valid selections
//     silently rejected (area capture no-ops).
//
// Harness: fake-electron Module._load hook against the dist bundle. A fake
// window with the OLD arrangement's bounds sits in the field; the display
// list then changes; showCropper() runs its reuse branch.
//
// Expected (correct): the window is re-fit to the new combined bounds on
// show → exit 0. Bug (F-113): bounds stay stale → exit 1.
//
// Run: node scripts/audit/F-113-repro.mjs   (requires npm run build:electron)
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPILED = path.resolve(__dirname, '../../dist-electron/electron/CropperWindowHelper.js');

let displays = [{ bounds: { x: 0, y: 0, width: 1440, height: 900 } }];
const fakeElectron = {
  app: { isPackaged: false, getAppPath: () => '/tmp', on: () => {}, removeListener: () => {} },
  ipcMain: { on: () => {}, removeListener: () => {} },
  screen: {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[displays.length - 1],
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
  },
  BrowserWindow: function () { throw new Error('not constructed in this repro'); },
};

const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') return fakeElectron;
  if (request.endsWith('.node') || request.includes('native-module')) return {};
  return origLoad.apply(this, arguments);
};

const { CropperWindowHelper } = await import(COMPILED);
const helper = new CropperWindowHelper();

// Window created under the OLD single-display arrangement.
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

// A second monitor appears to the LEFT of the primary.
displays = [
  { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
  { bounds: { x: 0, y: 0, width: 1440, height: 900 } },
];
const expected = { x: -1920, y: 0, width: 3360, height: 1080 };

const p = helper.showCropper(200).catch(() => null); // reuse branch runs synchronously
const after = win.getBounds();
await p; // let the selection timeout settle

console.log('[F-113] window bounds after show:', JSON.stringify(after), '| expected combined:', JSON.stringify(expected));
const refit =
  after.x === expected.x && after.y === expected.y &&
  after.width === expected.width && after.height === expected.height;
if (!refit) {
  console.error('[F-113] FAIL: cropper kept its creation-time bounds — the new monitor is unselectable and the stale origin breaks the local→global mapping (F-113 reproduced).');
  process.exit(1);
}
console.log('[F-113] PASS: cropper re-fit to the current display arrangement on show.');
process.exit(0);
