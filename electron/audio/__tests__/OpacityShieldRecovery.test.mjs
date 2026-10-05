import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const compiled = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../dist-electron/electron/WindowHelper.js',
);
const originalLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return {
      app: { isPackaged: false },
      BrowserWindow: function BrowserWindow() {},
      Menu: {},
      screen: {},
      systemPreferences: {},
      globalShortcut: {},
      ipcMain: {},
    };
  }
  return originalLoad.apply(this, arguments);
};
const { WindowHelper } = await import(pathToFileURL(compiled));
Module._load = originalLoad;

test('minimize and close finish a pending opacity shield', () => {
  const calls = [];
  const window = (name, { visible = true, destroyed = false } = {}) => ({
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    setOpacity: (value) => calls.push([name, 'opacity', value]),
    setAlwaysOnTop: (on, level) => calls.push([name, 'alwaysOnTop', on, level]),
    minimize() {},
    close() {},
  });
  const helper = new WindowHelper({});
  helper.launcherWindow = window('launcher');
  helper.overlayWindow = window('overlay');
  helper.pillWindow = window('pill', { visible: false });
  helper.toggleWindow = window('toggle', { destroyed: true });

  for (const action of ['minimizeWindow', 'closeWindow']) {
    helper.opacityTimeout = setTimeout(
      () => assert.fail(`${action} did not clear the shield timer`),
      1_000,
    );
    helper[action]();
    assert.equal(helper.opacityTimeout, null);
  }

  // The HIDDEN pill still gets its opacity back; only the DESTROYED toggle is
  // skipped. Skipping hidden windows is what caused the invisible-pill gap:
  // applyOverlayAuxVisibility() re-shows the pill without touching opacity, so a
  // pill left at 0 here came back as a hole in the overlay chrome. Confirmed on a
  // real Windows kernel, then re-run against this fix to confirm it closed.
  //
  // The overlay additionally gets the z-order re-assert its own timer would have
  // done — DWM can demote the HWND across a hide/show and that timer is cancelled.
  assert.deepEqual(calls, [
    ['launcher', 'opacity', 1],
    ['overlay', 'opacity', 1],
    ['pill', 'opacity', 1],
    ['overlay', 'alwaysOnTop', true, 'screen-saver'],
    ['launcher', 'opacity', 1],
    ['overlay', 'opacity', 1],
    ['pill', 'opacity', 1],
    ['overlay', 'alwaysOnTop', true, 'screen-saver'],
  ]);
});

// The case above filters pill and toggle out through the guards, so it never
// pins WHICH windows the shield covers. Drop one and the flush strands it.
test('the flush covers every window an arm site can shield', () => {
  const opacity = [];
  const window = (name) => ({
    isDestroyed: () => false,
    isVisible: () => true,
    setOpacity: (value) => opacity.push([name, value]),
    setAlwaysOnTop() {},
    minimize() {},
    close() {},
  });
  const helper = new WindowHelper({});
  helper.launcherWindow = window('launcher');
  helper.overlayWindow = window('overlay');
  helper.pillWindow = window('pill');
  helper.toggleWindow = window('toggle');

  helper.opacityTimeout = setTimeout(() => assert.fail('shield timer survived'), 1_000);
  helper.minimizeWindow();

  assert.equal(helper.opacityTimeout, null);
  assert.deepEqual(opacity, [
    ['launcher', 1],
    ['overlay', 1],
    ['pill', 1],
    ['toggle', 1],
  ]);
});

// Opacity and z-order are guarded DIFFERENTLY, on purpose. A hidden window still
// gets its opacity restored, because that value survives the hide and a later
// show inherits it. Z-order does not: switchToOverlay re-asserts it on the way
// in, so re-asserting on a hidden window would reach past what the flush owns.
test('a hidden overlay gets opacity back but not the z-order re-assert', () => {
  const calls = [];
  const helper = new WindowHelper({});
  helper.overlayWindow = {
    isDestroyed: () => false,
    isVisible: () => false,
    setOpacity: () => calls.push('opacity'),
    setAlwaysOnTop: () => calls.push('alwaysOnTop'),
  };
  helper.launcherWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    setOpacity: () => calls.push('launcher-opacity'),
    setAlwaysOnTop: () => calls.push('launcher-alwaysOnTop'),
    minimize() {},
  };

  helper.opacityTimeout = setTimeout(() => assert.fail('shield timer survived'), 1_000);
  helper.minimizeWindow();

  assert.deepEqual(calls, ['launcher-opacity', 'opacity']);
});

// A flush with nothing pending must stay a no-op. That early return is the whole
// reason the arm sites null the handle when their timer fires: without it every
// later minimize would push opacity 1 onto whatever happens to be visible.
test('finishing with no shield pending touches nothing', () => {
  const calls = [];
  const window = () => ({
    isDestroyed: () => false,
    isVisible: () => true,
    setOpacity: (v) => calls.push(v),
    setAlwaysOnTop: () => calls.push('aot'),
    minimize() {},
    close() {},
  });
  const helper = new WindowHelper({});
  helper.launcherWindow = window();
  helper.overlayWindow = window();
  helper.opacityTimeout = null;

  helper.minimizeWindow();
  helper.closeWindow();

  assert.deepEqual(calls, []);
});
