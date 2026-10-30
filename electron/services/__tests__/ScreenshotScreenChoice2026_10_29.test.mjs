// "With three monitors there is no way to choose which one is captured"
// (customer report, Windows, 2026-10-29).
//
//  - Settings › Overlay › Screenshot screen: the overlay's screen (default),
//    the screen under the mouse, or one fixed screen; an unplugged screen
//    falls back to the default.
//  - In the area selector a click without a drag captures the whole screen
//    the mouse is on.
//  - Windows with mixed scale factors: one window spanning the screens maps
//    selections to the wrong pixels, so the selector covers the screen under
//    the mouse and follows it; macOS and uniform layouts keep the span.
//  - The "Select area" hint was placed in desktop coordinates on a page that
//    draws in window coordinates, so it sat on the wrong screen whenever a
//    screen lies left of or above the main one.
//
// Run with: npm run build:electron && node --test electron/services/__tests__/ScreenshotScreenChoice2026_10_29.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = (p) => pathToFileURL(path.resolve(root, 'dist-electron/electron', p)).href;

// Three screens like the customer's: a 150% laptop on the left, two 100%
// monitors, the main one in the middle at the origin.
const LAPTOP = { id: 11, label: '', bounds: { x: -1280, y: 180, width: 1280, height: 800 }, scaleFactor: 1.5 };
const MAIN = { id: 22, label: 'DELL U2720Q', bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1 };
const RIGHT = { id: 33, label: 'LG HDR 4K', bounds: { x: 2560, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
const THREE = [MAIN, RIGHT, LAPTOP];

let displays = THREE;
let cursor = { x: 3000, y: 500 };
const ipcHandlers = new Map();
const fakeElectron = {
  app: { isPackaged: false, getAppPath: () => '/tmp', on: () => {}, removeListener: () => {} },
  ipcMain: { on: (ch, fn) => ipcHandlers.set(ch, fn), removeListener: () => {} },
  globalShortcut: { register: () => true, unregister: () => {}, isRegistered: () => false },
  screen: {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => MAIN,
    getCursorScreenPoint: () => cursor,
    getDisplayNearestPoint: (p) => displays.find((d) => p.x >= d.bounds.x && p.x < d.bounds.x + d.bounds.width
      && p.y >= d.bounds.y && p.y < d.bounds.y + d.bounds.height) ?? displays[0],
  },
  BrowserWindow: function () { throw new Error('not constructed in this test'); },
};
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') return fakeElectron;
  if (request.endsWith('.node') || request.includes('native-module')) return {};
  return origLoad.apply(this, arguments);
};

const shot = await import(dist('screenshotDisplay.js'));
const cropper = await import(dist('CropperWindowHelper.js'));

describe('Screenshot screen setting', () => {
  test('stored values parse; anything else is the default', () => {
    assert.equal(shot.parseScreenshotDisplayPreference('overlay'), 'overlay');
    assert.equal(shot.parseScreenshotDisplayPreference('cursor'), 'cursor');
    assert.equal(shot.parseScreenshotDisplayPreference('display:33'), 'display:33');
    assert.equal(shot.parseScreenshotDisplayPreference('display:-5'), 'display:-5');
    for (const bad of [undefined, null, '', 'display:', 'display:abc', 'screen:2', 42, { displayId: 3 }]) {
      assert.equal(shot.parseScreenshotDisplayPreference(bad), 'overlay', String(bad));
    }
  });

  test('screens are numbered left to right, with their own names and pixel sizes', () => {
    assert.deepEqual(shot.listScreenshotDisplays(THREE, MAIN.id), [
      { id: 11, number: 1, name: '', width: 1920, height: 1200, primary: false },
      { id: 22, number: 2, name: 'DELL U2720Q', width: 2560, height: 1440, primary: true },
      { id: 33, number: 3, name: 'LG HDR 4K', width: 1920, height: 1080, primary: false },
    ]);
  });

  test('each choice resolves to its screen; an unplugged one falls back to the overlay\'s', () => {
    const overlayScreen = MAIN;
    const underMouse = RIGHT;
    const pick = (pref, list = THREE) => shot.resolveScreenshotDisplay(pref, list, overlayScreen, underMouse).id;
    assert.equal(pick('overlay'), MAIN.id);
    assert.equal(pick('cursor'), RIGHT.id);
    assert.equal(pick('display:11'), LAPTOP.id);
    assert.equal(pick('display:11', [MAIN, RIGHT]), MAIN.id, 'laptop closed: the default, not an error');
  });

  test('main\'s full screenshot reads the setting; IPC and preload expose it', () => {
    const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const block = main.slice(main.indexOf('private getTargetDisplayForFullScreenshot('));
    assert.match(block.slice(0, 1800), /resolveScreenshotDisplay\(preference, screen\.getAllDisplays\(\), overlayDisplay, cursorDisplay\)/);
    assert.match(block.slice(0, 1800), /SettingsManager\.getInstance\(\)\.get\('screenshotDisplay'\)/);
    const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
    assert.match(ipc, /safeHandle\('get-screenshot-display'/);
    assert.match(ipc, /safeHandle\('set-screenshot-display'[\s\S]{0,400}preference !== value\) return \{ success: false/);
    const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
    assert.match(preload, /getScreenshotDisplay: \(\) => ipcRenderer\.invoke\('get-screenshot-display'\)/);
    assert.match(preload, /cropperPickDisplay: \(\) => ipcRenderer\.send\('cropper-display-picked'\)/);
    assert.match(preload, /cropperDrag: \(active: boolean\) => ipcRenderer\.send\('cropper-drag', active === true\)/);
  });
});

describe('selector placement', () => {
  test('Windows, mixed scale factors: the screen under the mouse only', () => {
    assert.deepEqual(cropper.planCropperCoverage(THREE, { x: 3000, y: 500 }, 'win32'), { bounds: RIGHT.bounds, displayId: 33 });
    assert.deepEqual(cropper.planCropperCoverage(THREE, { x: -600, y: 400 }, 'win32'), { bounds: LAPTOP.bounds, displayId: 11 });
    // Between screens (the gap above the laptop): the nearest one.
    assert.equal(cropper.planCropperCoverage(THREE, { x: -600, y: 10 }, 'win32').displayId, 11);
  });

  test('Windows, one scale factor: one window across every screen, as before', () => {
    const uniform = THREE.map((d) => ({ ...d, scaleFactor: 1.25 }));
    assert.deepEqual(cropper.planCropperCoverage(uniform, { x: 3000, y: 500 }, 'win32'),
      { bounds: { x: -1280, y: 0, width: 5760, height: 1440 }, displayId: null });
  });

  test('macOS keeps the span on any layout (points, not pixels)', () => {
    assert.equal(cropper.planCropperCoverage(THREE, { x: 3000, y: 500 }, 'darwin').displayId, null);
    assert.equal(cropper.hasMixedScaleFactors(THREE), true);
    assert.equal(cropper.hasMixedScaleFactors([MAIN, RIGHT]), false);
  });

  test('the hint lands on the screen under the mouse, in window coordinates', () => {
    // Window spanning all three: its origin is the laptop's left edge.
    const span = { x: -1280, y: 0, width: 5760, height: 1440 };
    assert.deepEqual(cropper.hudPositionFor(THREE, { x: 100, y: 100 }, span), { x: 1280 + 1280, y: 32 });
    // Window covering only the right screen.
    assert.deepEqual(cropper.hudPositionFor(THREE, { x: 3000, y: 500 }, RIGHT.bounds), { x: 960, y: 32 });
  });

  test('intersectRect keeps the overlap, or nothing', () => {
    assert.deepEqual(cropper.intersectRect({ x: 2400, y: 100, width: 400, height: 200 }, RIGHT.bounds), { x: 2560, y: 100, width: 240, height: 200 });
    assert.equal(cropper.intersectRect({ x: 0, y: 0, width: 100, height: 100 }, RIGHT.bounds), null);
  });
});

describe('the selector window', () => {
  function shownHelper(windowBounds) {
    const helper = new cropper.CropperWindowHelper();
    const sent = [];
    const win = {
      bounds: { ...windowBounds },
      isDestroyed: () => false,
      getBounds() { return { ...this.bounds }; },
      setBounds(b) { this.bounds = { ...b }; },
      webContents: { send: (ch, payload) => sent.push([ch, payload]) },
      setContentProtection: () => {}, setOpacity: () => {}, showInactive: () => {}, moveTop: () => {},
      show: () => {}, hide: () => {}, focus: () => {}, destroy: () => {},
    };
    helper.cropperWindow = win;
    return { helper, win, sent };
  }

  test('a click resolves to the whole screen under the mouse', async () => {
    displays = THREE;
    const { helper } = shownHelper({ x: -1280, y: 0, width: 5760, height: 1440 });
    const selection = helper.showCropper(2000);
    cursor = { x: 3100, y: 700 };
    ipcHandlers.get('cropper-display-picked')();
    assert.deepEqual(await selection, RIGHT.bounds);
    helper.dispose?.();
  });

  test('a drag past the covered screen\'s edge keeps the part on that screen', async () => {
    displays = THREE;
    const { helper } = shownHelper(RIGHT.bounds);
    // What planCropperCoverage gives on Windows with mixed scale factors
    // (asserted above); this test runs on any platform.
    helper.planCoverage = () => ({ bounds: { ...RIGHT.bounds }, displayId: RIGHT.id });
    const selection = helper.showCropper(2000);
    // Window-local: starts 100 px inside the right screen, runs 300 px past its bottom.
    ipcHandlers.get('cropper-confirmed')({}, { x: 100, y: 900, width: 200, height: 480 });
    assert.deepEqual(await selection, { x: 2660, y: 900, width: 200, height: 180 });
    helper.dispose?.();
  });

  test('a shown selector sends the hint in window coordinates', async () => {
    displays = THREE;
    cursor = { x: 100, y: 100 };
    const { helper, sent } = shownHelper({ x: -1280, y: 0, width: 5760, height: 1440 });
    const selection = helper.showCropper(2000);
    const reset = sent.find(([ch]) => ch === 'reset-cropper');
    assert.deepEqual(reset?.[1], { hudPosition: { x: 2560, y: 32 } });
    ipcHandlers.get('cropper-cancelled')();
    assert.equal(await selection, null);
    helper.dispose?.();
  });
});
