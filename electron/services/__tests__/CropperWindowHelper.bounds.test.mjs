// electron/services/__tests__/CropperWindowHelper.bounds.test.mjs
//
// Regression test for PR #346 — multi-monitor screenshot bounds mapping.
//
// Pre-PR: the renderer fired 'cropper-confirmed' with WINDOW-LOCAL coordinates
// (e.clientX/clientY inside the cropper BrowserWindow). The main-process
// confirmedListener forwarded those local coords straight to validateBounds
// and resolveCurrentSelection. On a multi-monitor setup where the cropper
// window sits at a negative origin (secondary monitor to the left/above the
// primary), this caused validateBounds to reject the selection as "exceeds
// combined multi-monitor viewport" — silently dropping valid selections.
//
// The fix: add cropperBounds.{x,y} to convert local→global BEFORE validation
// and resolution. This test guards that math against future regressions.
//
// We drive the LISTENER (not the public surface) by intercepting ipcMain.on,
// then synthesize a 'cropper-confirmed' payload and assert the resolved value
// is in GLOBAL screen coordinates. We also assert the safety guard: if the
// cropper window is missing, the selection is rejected (not silently forwarded
// with wrong coords).
//
// Run: `ELECTRON_RUN_AS_NODE=1 electron --test`

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPILED = path.resolve(__dirname, '../../../dist-electron/electron/CropperWindowHelper.js');

// ---- Fake electron surface ----------------------------------------------------

// Records every IPC subscription so the test can grab the cropper-confirmed
// listener after construction. CropperWindowHelper calls ipcMain.on(...) twice
// in its constructor; we capture both.
const ipcHandlers = new Map(); // channel -> Set<listener>

function makeFakeElectron(displays) {
  return {
    app: {
      isPackaged: false,
      getAppPath: () => '/tmp',
      on: () => {},
      removeListener: () => {},
    },
    ipcMain: {
      on: (channel, listener) => {
        if (!ipcHandlers.has(channel)) ipcHandlers.set(channel, new Set());
        ipcHandlers.get(channel).add(listener);
      },
      removeListener: (channel, listener) => {
        ipcHandlers.get(channel)?.delete(listener);
      },
    },
    screen: {
      getAllDisplays: () => displays,
      getPrimaryDisplay: () => displays[0],
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    },
    // If showCropper() ever gets to createWindow() (it shouldn't, because we
    // pre-set helper.cropperWindow below), the test is broken. Throw loudly so
    // the failure points here rather than masquerading as a real BrowserWindow.
    BrowserWindow: function BrowserWindow() {
      throw new Error('fake BrowserWindow should not be instantiated in this test');
    },
  };
}

function makeFakeCropperWindow(bounds) {
  return {
    isDestroyed: () => false,
    getBounds: () => bounds,
    getNativeWindowHandle: () => ({}),
    setContentProtection: () => {},
    setOpacity: () => {},
    show: () => {},
    hide: () => {},
    focus: () => {},
    setVisibleOnAllWorkspaces: () => {},
    setAlwaysOnTop: () => {},
    setBounds: () => {},
    webContents: {
      send: () => {},
      on: () => {},
    },
    once: () => {},
    on: () => {},
    close: () => {},
  };
}

// Two-monitor virtual screen:
//   primary at (0, 0)              size 1920x1080
//   secondary at (-1920, 0)        size 1920x1080  (LEFT of primary)
// Combined viewport: x=-1920, y=0, w=3840, h=1080.
const TWO_DISPLAYS = [
  { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 2, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1080 } },
];

// Window spans the combined viewport (mimics real CropperWindowHelper.createWindow()).
const CROPPER_WIN_BOUNDS = { x: -1920, y: 0, width: 3840, height: 1080 };

// ---- Test harness -------------------------------------------------------------

let CropperWindowHelper;
let originalLoad;

before(async () => {
  originalLoad = Module._load;
  const fakeElectron = makeFakeElectron(TWO_DISPLAYS);
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return fakeElectron;
    return originalLoad.apply(this, arguments);
  };
  const mod = await import(path.sep === '\\'
    ? 'file://' + COMPILED.replace(/\\/g, '/')
    : 'file://' + COMPILED);
  CropperWindowHelper = mod.CropperWindowHelper;
  assert.equal(typeof CropperWindowHelper, 'function', 'compiled CropperWindowHelper class must be importable');
});

after(() => {
  if (originalLoad) Module._load = originalLoad;
});

/**
 * Drive a single selection end-to-end through the IPC listener.
 *
 * IMPORTANT: helper.cropperWindow is set BEFORE showCropper() runs so the
 * lazy createWindow() branch is skipped. This is the only way to drive
 * the listener without instantiating a real BrowserWindow.
 *
 * @param {object} opts
 * @param {Electron.Rectangle|null} opts.cropperBounds  window position; if null, window is "missing"
 * @param {object} opts.localBounds                      payload from the renderer (window-local coords)
 * @param {boolean} [opts.skipShowCropper]               when true, do not call showCropper (use only for the
 *                                                       "window missing" path, where the listener should reject
 *                                                       without ever arming resolvePromise)
 */
async function driveSelection({ cropperBounds, localBounds, skipShowCropper = false }) {
  ipcHandlers.clear();
  const helper = new CropperWindowHelper();
  try {
    // Pre-set (or explicitly clear) the private cropperWindow slot. TS `private`
    // is erased at runtime, so this is a direct field write.
    if (cropperBounds === null) {
      helper.cropperWindow = null;
    } else {
      helper.cropperWindow = makeFakeCropperWindow(cropperBounds);
    }

    // Capture the listener registered with ipcMain.on('cropper-confirmed').
    const confirmedListeners = ipcHandlers.get('cropper-confirmed');
    assert.ok(confirmedListeners && confirmedListeners.size === 1,
      'CropperWindowHelper must register exactly one cropper-confirmed listener');
    const confirmedListener = [...confirmedListeners][0];

    if (skipShowCropper) {
      // Caller wants to drive the listener with no showCropper arming. The
      // listener must reject on its own (window missing).
      confirmedListener({}, localBounds);
      return null;
    }

    // With cropperWindow already set, showCropper() skips createWindow().
    const selectionPromise = helper.showCropper(60_000);

    // Renderer synthesizes payload from mouse coords (CSS pixels, local to
    // the cropper window). Drive the listener directly.
    confirmedListener({}, localBounds);

    return await selectionPromise;
  } finally {
    helper.dispose();
    ipcHandlers.clear();
  }
}

describe('CropperWindowHelper multi-monitor bounds mapping (PR #346 regression)', () => {
  test('selection on left-of-primary secondary monitor → GLOBAL coords forwarded', async () => {
    // Renderer fires window-local: selection starts at (100, 50) inside the
    // cropper window, size 200x100. The cropper window's global origin is
    // (-1920, 0), so the GLOBAL bounds are (-1820, 50, 200, 100).
    const localBounds = { x: 100, y: 50, width: 200, height: 100 };
    const expectedGlobal = { x: -1820, y: 50, width: 200, height: 100 };

    const resolved = await driveSelection({
      cropperBounds: CROPPER_WIN_BOUNDS,
      localBounds,
    });

    assert.deepEqual(resolved, expectedGlobal,
      `expected GLOBAL bounds {x:-1820,y:50,w:200,h:100}; got ${JSON.stringify(resolved)}`);
  });

  test('selection on primary monitor → x is not double-offset', async () => {
    // Local (200, 100, 300, 150) + cropper origin (-1920, 0) = (-1720, 100, 300, 150).
    const localBounds = { x: 200, y: 100, width: 300, height: 150 };

    const resolved = await driveSelection({
      cropperBounds: CROPPER_WIN_BOUNDS,
      localBounds,
    });

    // CRITICAL regression guard: pre-PR the listener would have forwarded
    // (200, 100, 300, 150) as-is, which validateBounds would REJECT because
    // x=200 falls inside the primary monitor (still passes validation) but
    // downstream ScreenshotHelper.takeSelectiveScreenshot would have screenshotted
    // the WRONG area (200px into the primary instead of 200px into the
    // secondary). The post-PR behavior is (-1720, 100, 300, 150).
    assert.equal(resolved.x, -1720,
      'x must be offset by cropperBounds.x (-1920), not forwarded as-is');
    assert.equal(resolved.y, 100, 'y must be offset by cropperBounds.y (0)');
    assert.equal(resolved.width, 300, 'width must NOT be modified');
    assert.equal(resolved.height, 150, 'height must NOT be modified');
  });

  test('selection straddling both monitors → global width is preserved (not clamped)', async () => {
    // Local coords start at (1850, 100) and span to (2050, 200) — i.e. the
    // selection straddles the primary/secondary boundary at x=1920.
    // Local: x=1850, w=400. Cropper origin (-1920, 0). Global: x=-70, w=400.
    // (No clamping: pre-PR would forward (1850, 100, 400, 200), validateBounds
    // would PASS that since x=1850 is inside combinedBounds, but the actual
    // screenshot would be from x=1850 in the primary, NOT from the secondary.)
    const localBounds = { x: 1850, y: 100, width: 400, height: 200 };

    const resolved = await driveSelection({
      cropperBounds: CROPPER_WIN_BOUNDS,
      localBounds,
    });

    assert.equal(resolved.x, -70, 'global x = 1850 + (-1920) = -70');
    assert.equal(resolved.width, 400, 'width must be preserved verbatim — no DPI scaling');
    assert.equal(resolved.height, 200, 'height must be preserved verbatim');
  });

  test('single-monitor (cropper origin = 0,0) → conversion is identity', async () => {
    // Regression check for the single-monitor case (the more common path).
    // The PR's conversion must be a no-op when cropperBounds = (0,0).
    const localBounds = { x: 250, y: 175, width: 640, height: 480 };

    const resolved = await driveSelection({
      cropperBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      localBounds,
    });

    assert.deepEqual(resolved, localBounds,
      'single-monitor conversion must pass coords through unchanged');
  });

  test('cropper window missing → selection rejected (not silently forwarded with wrong coords)', async () => {
    // SAFETY GUARD: if the cropper window is gone (e.g. closed mid-IPC), there
    // is no safe global mapping. The listener must reject the selection rather
    // than forwarding local coords to a global-coordinate consumer.
    const localBounds = { x: 100, y: 50, width: 200, height: 100 };

    // skipShowCropper=true: the listener's safety guard should reject before
    // any resolvePromise is armed.
    const resolved = await driveSelection({
      cropperBounds: null,
      localBounds,
      skipShowCropper: true,
    });

    assert.equal(resolved, null,
      'selection must be rejected (null) when cropper window is missing — not forwarded as local coords');
  });

  test('non-rectangle payload (renderer bug) → listener rejects cleanly', async () => {
    // Even when the cropper window IS available, garbage payloads must not
    // reach resolveCurrentSelection. The pre-existing isRectangle() guard
    // should catch this.
    const localBounds = { x: 'banana', y: null, width: undefined, height: NaN };

    const resolved = await driveSelection({
      cropperBounds: CROPPER_WIN_BOUNDS,
      localBounds,
    });

    assert.equal(resolved, null,
      'non-rectangle payload must reject the selection');
  });
});