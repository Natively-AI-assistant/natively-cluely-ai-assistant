// F-112 repro: CropperWindowHelper.dispose() never closes its window.
//
// dispose() sets isDisposed = true, then calls closeWindow() — whose guard
// includes `!this.isDisposed` — so the close is a guaranteed no-op, and the
// live BrowserWindow is orphaned by `this.cropperWindow = null` on the next
// line. Reached from the before-quit handler; the orphan also pollutes
// window-all-closed accounting during shutdown.
//
// Harness: fake-electron Module._load hook against the dist bundle (same
// pattern as CropperWindowHelper.bounds.test.mjs); a fake window is placed in
// the private field and dispose() is called.
//
// Expected (correct): the window is closed/destroyed during dispose → exit 0.
// Bug (F-112): neither close() nor destroy() ever called → exit 1.
//
// Run: node scripts/audit/F-112-repro.mjs   (requires npm run build:electron)
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPILED = path.resolve(__dirname, '../../dist-electron/electron/CropperWindowHelper.js');

const fakeElectron = {
  app: { isPackaged: false, getAppPath: () => '/tmp', on: () => {}, removeListener: () => {} },
  ipcMain: { on: () => {}, removeListener: () => {} },
  screen: {
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1440, height: 900 } }],
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  },
  BrowserWindow: function () { throw new Error('not used'); },
};

const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') return fakeElectron;
  if (request.endsWith('.node') || request.includes('native-module')) return {};
  return origLoad.apply(this, arguments);
};

const { CropperWindowHelper } = await import(COMPILED);
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

const torndown = win.closed + win.destroyed;
console.log('[F-112] close calls:', win.closed, '| destroy calls:', win.destroyed);
if (torndown === 0) {
  console.error('[F-112] FAIL: dispose() orphaned the live BrowserWindow — closeWindow() no-ops because isDisposed was already set (F-112 reproduced).');
  process.exit(1);
}
console.log('[F-112] PASS: dispose() tears the window down.');
process.exit(0);
