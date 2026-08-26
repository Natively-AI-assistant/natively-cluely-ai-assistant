// Regression tests for the 2026-08-27 win32 cropper-misplacement report
// (user log: Natively 2.8.7, win32, mixed-DPI multi-monitor).
//
// The log showed createWindow() asking for {x:0, y:-442, w:3627, h:1509} and
// getBounds() immediately returning {x:569, y:-83, w:3628, h:1510} — the
// explicit multi-monitor spanning setBounds did NOT take, and nothing in the
// code noticed. Two failures follow from that silence:
//
//   1. Desktop regions outside the misplaced window are unselectable.
//   2. The confirm listener maps window-local -> global using the window's REAL
//      origin while validateBounds() checks against the IDEAL combined display
//      bounds, so legitimate selections are silently rejected.
//
// validateBounds() is intentionally NOT loosened (a selection mapping outside
// real screen territory genuinely cannot be captured). Instead every path that
// positions the cropper verifies the result and says so loudly.
//
// This file also pins the platform gate on `enableLargerThanScreen`, which was
// INVERTED: Electron documents it as macOS-only ("Only relevant for macOS, as
// other OSes allow larger-than-screen windows by default"), yet it was set on
// win32 (a documented no-op) and omitted on darwin — the one platform whose
// -[NSWindow constrainFrameRect:toScreen:] clamps a window to a single screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPILED = path.resolve(__dirname, '../../../dist-electron/electron/CropperWindowHelper.js');

// The exact layout from the user's log: a 2560x1600 @150% primary (1707x1067
// DIP) with a 1920x1080 @100% secondary above-right. Combined virtual desktop
// is {x:0, y:-442, w:3627, h:1509} — the rectangle the log asked for.
const MIXED_DPI_DISPLAYS = [
  { bounds: { x: 0, y: 0, width: 1707, height: 1067 }, scaleFactor: 1.5 },
  { bounds: { x: 1707, y: -442, width: 1920, height: 1080 }, scaleFactor: 1 },
];
const COMBINED = { x: 0, y: -442, width: 3627, height: 1509 };
// What Windows actually handed back on the reporting user's machine.
const CLAMPED = { x: 569, y: -83, width: 3628, height: 1510 };

let displays = MIXED_DPI_DISPLAYS;
const fakeElectron = {
  app: { isPackaged: false, getAppPath: () => '/tmp', on: () => {}, removeListener: () => {} },
  ipcMain: { on: () => {}, removeListener: () => {} },
  screen: {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
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

const { CropperWindowHelper, buildCropperWindowSettings } = await import(COMPILED);

// --- platform gate on enableLargerThanScreen -------------------------------

test('darwin gets enableLargerThanScreen (macOS clamps a window to one screen without it)', () => {
  const settings = buildCropperWindowSettings(COMBINED, 'darwin');
  assert.equal(
    settings.enableLargerThanScreen,
    true,
    'without enableLargerThanScreen, -[NSWindow constrainFrameRect:toScreen:] clamps the cropper to a single display, so a multi-monitor virtual desktop cannot be spanned on macOS',
  );
  assert.equal(
    settings.type,
    'toolbar',
    'type:toolbar is load-bearing for the macOS NSPanel stealth path and must survive the platform-gate fix',
  );
});

test('win32 options are UNCHANGED by the platform-gate fix', () => {
  // The fix is additive on purpose. Electron implements enableLargerThanScreen
  // only in shell/browser/ui/cocoa/electron_ns_window.mm, so it is never read on
  // Windows — but "documented dead" cannot be executed from macOS, and this is
  // the sole line in the change that could conceivably alter Windows behaviour.
  // Keeping it makes the change provably Windows-neutral. Pinned so a later
  // cleanup has to make that decision deliberately.
  const settings = buildCropperWindowSettings(COMBINED, 'win32');
  assert.equal(settings.enableLargerThanScreen, true, 'win32 kept the flag it has always had');
  assert.equal(settings.type, undefined, 'win32 must not receive a window type');
});

test('the FULL win32 options object is byte-for-byte what it was before the fix', () => {
  // The strongest form of the Windows-neutrality claim: not "the flag is still
  // there", but "nothing else moved either". This literal is the pre-fix inline
  // object from createWindow(), transcribed. If anyone changes the builder in a
  // way that reaches Windows, this fails and they have to justify it on a
  // platform nobody here can execute.
  const settings = buildCropperWindowSettings(COMBINED, 'win32');
  const { webPreferences, ...rest } = settings;

  assert.deepEqual(rest, {
    width: COMBINED.width,
    height: COMBINED.height,
    x: COMBINED.x,
    y: COMBINED.y,
    frame: false,
    transparent: true,
    resizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    show: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
  });

  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.contextIsolation, true);
  assert.match(String(webPreferences.preload), /preload\.js$/, 'preload path is absolute and machine-specific; only its target matters');
});

test('linux keeps type:toolbar (unchanged by the platform-gate fix)', () => {
  const settings = buildCropperWindowSettings(COMBINED, 'linux');
  assert.equal(settings.type, 'toolbar');
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'enableLargerThanScreen'), false);
});

test('the builder positions the window at the combined virtual-desktop rect', () => {
  const settings = buildCropperWindowSettings(COMBINED, 'win32');
  assert.deepEqual(
    { x: settings.x, y: settings.y, width: settings.width, height: settings.height },
    COMBINED,
  );
});

// --- verify-after-set ------------------------------------------------------

function makeWindow({ clampTo = null, initial } = {}) {
  return {
    bounds: { ...initial },
    isDestroyed: () => false,
    getBounds() { return { ...this.bounds }; },
    setBounds(b) { this.bounds = clampTo ? { ...clampTo } : { ...b }; },
    webContents: { send: () => {} },
    setContentProtection: () => {},
    setOpacity: () => {},
    show: () => {},
    hide: () => {},
    focus: () => {},
    destroy: () => {},
  };
}

async function runShowCropper(win) {
  const helper = new CropperWindowHelper();
  helper.cropperWindow = win;
  const errors = [];
  const origError = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    await helper.showCropper(120).catch(() => null);
  } finally {
    console.error = origError;
  }
  return errors;
}

test('a setBounds the OS refuses is reported, not swallowed', async () => {
  displays = MIXED_DPI_DISPLAYS;
  const win = makeWindow({ clampTo: CLAMPED, initial: CLAMPED });

  const errors = await runShowCropper(win);

  const mismatch = errors.find(args => String(args[0]).includes('bounds NOT honored'));
  assert.ok(
    mismatch,
    'the cropper silently accepted a window that does not cover the virtual desktop — that silence is the whole defect: the user sees unselectable regions and silently rejected selections with nothing in the log to explain either',
  );

  const payload = mismatch[1];
  assert.deepEqual(payload.requested, COMBINED, 'the log must name the rectangle we asked for');
  assert.deepEqual(payload.actual, CLAMPED, 'the log must name the rectangle we actually got');
  assert.deepEqual(
    payload.displays.map(d => d.scaleFactor),
    [1.5, 1],
    'per-display scale factors are the evidence needed to confirm or kill the mixed-DPI hypothesis from a user log',
  );
});

test('a setBounds the OS honors logs no error (guards against a vacuously passing mismatch test)', async () => {
  displays = MIXED_DPI_DISPLAYS;
  const win = makeWindow({ initial: { x: 0, y: 0, width: 800, height: 600 } });

  const errors = await runShowCropper(win);

  assert.equal(
    errors.filter(args => String(args[0]).includes('bounds NOT honored')).length,
    0,
    'a compliant window must not be reported as misplaced',
  );
  assert.deepEqual(win.getBounds(), COMBINED, 'the refit must still land the window on the combined bounds');
});
