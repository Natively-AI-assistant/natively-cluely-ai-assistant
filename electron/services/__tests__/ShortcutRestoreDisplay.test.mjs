import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';

const require = createRequire(import.meta.url);
const { shortcutRestoreBounds, shortcutRestoreDisplay } = require('../../../dist-electron/electron/utils/shortcutRestore.js');
const primary = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 850 } };
const secondary = { id: 2, workArea: { x: -1920, y: -1000, width: 1920, height: 950 } };
const original = { x: 120, y: 50, width: 1200, height: 800 };

test('centers on a different display, including negative origins', () => {
  assert.deepEqual(shortcutRestoreBounds(original, secondary.workArea, true), {
    x: -1560, y: -925, width: 1200, height: 800,
  });
});

test('preserves position and size on the same display', () => {
  assert.deepEqual(shortcutRestoreBounds(original, primary.workArea, false), original);
});

test('fits an oversized launcher above the Dock and below the menu bar, keeping 3:2', () => {
  assert.deepEqual(shortcutRestoreBounds(original, { x: 0, y: 25, width: 1000, height: 600 }, true, { launcher: true }), {
    x: 50, y: 25, width: 900, height: 600,
  });
});

test('clamps an offscreen window on the same display after work-area changes', () => {
  assert.deepEqual(shortcutRestoreBounds({ x: -100, y: 0, width: 800, height: 700 }, primary.workArea, false), {
    x: 0, y: 25, width: 800, height: 700,
  });
  assert.deepEqual(shortcutRestoreBounds({ x: 1400, y: 800, width: 800, height: 700 }, primary.workArea, false), {
    x: 640, y: 175, width: 800, height: 700,
  });
});

test('reserves room for the overlay pill above the shell', () => {
  const result = shortcutRestoreBounds({ x: 0, y: 0, width: 600, height: 2000 }, primary.workArea, false, { topInset: 52 });
  assert.equal(result.y, 77);
  assert.equal(result.y + result.height, 875);
});

test('cursor display wins over focused window', () => {
  const displays = {
    getCursorScreenPoint: () => ({ x: -100, y: -500 }),
    getDisplayNearestPoint: () => secondary,
    getDisplayMatching: () => primary,
  };
  assert.equal(shortcutRestoreDisplay(displays, { isDestroyed: () => false, getBounds: () => original }, original), secondary);
});

test('failed or invalid cursor lookup falls back to the focused window', () => {
  for (const lookup of [() => { throw new Error('unavailable'); }, () => ({ x: NaN, y: 0 })]) {
    assert.equal(shortcutRestoreDisplay({
      getCursorScreenPoint: lookup,
      getDisplayMatching: bounds => bounds === original ? primary : secondary,
    }, { isDestroyed: () => false, getBounds: () => ({ ...original }) }, original), secondary);
  }
});

test('no focused window falls back to current display, then primary', () => {
  const displays = {
    getCursorScreenPoint: () => { throw new Error('unavailable'); },
    getDisplayMatching: () => secondary,
    getPrimaryDisplay: () => primary,
  };
  assert.equal(shortcutRestoreDisplay(displays, null, original), secondary);
  displays.getDisplayMatching = () => { throw new Error('removed'); };
  assert.equal(shortcutRestoreDisplay(displays, { isDestroyed: () => true }, original), primary);
});

// Execute the real WindowHelper methods with fake Electron windows. Transpile
// without bundling to isolate its imports from the app/native-module startup.
function helperFixture(mode = 'launcher') {
  let bounds = { ...original };
  const calls = [];
  let minimum = [0, 0];
  const listeners = {};
  const window = {
    isDestroyed: () => false,
    getBounds: () => bounds,
    getMinimumSize: () => minimum,
    setMinimumSize: (...size) => {
      minimum = size;
      bounds = { ...bounds, width: Math.max(bounds.width, size[0]), height: Math.max(bounds.height, size[1]) };
      calls.push(['minimum', ...size]);
    },
    setBounds: value => {
      bounds = { ...value, width: Math.max(value.width, minimum[0]), height: Math.max(value.height, minimum[1]) };
      calls.push(['bounds', bounds]);
    },
    on: (event, handler) => { listeners[event] = handler; },
    webContents: { id: 1, send() {} },
    setOpacity() {}, setContentProtection() {}, hide() {},
    showInactive: () => calls.push(['native-show']),
  };
  const fakeElectron = {
    app: { isPackaged: false },
    BrowserWindow: { getFocusedWindow: () => null },
    screen: {
      getCursorScreenPoint: () => ({ x: -100, y: -500 }),
      getDisplayNearestPoint: () => secondary,
      getDisplayMatching: rect => rect.x < 0 ? secondary : primary,
    },
  };
  const source = fs.readFileSync(new URL('../../WindowHelper.ts', import.meta.url), 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, process, __dirname: '/tmp', console: { log() {} },
    require: name => {
      if (name === 'electron') return fakeElectron;
      if (name === './services/KeybindManager') return { KeybindManager: { getInstance: () => ({ setMode() {} }) } };
      if (name.startsWith('node:')) return require(name);
      if (name === './utils/shortcutRestore') return { shortcutRestoreBounds, shortcutRestoreDisplay };
      if (name === './utils/launcherAspect') return require('../../../dist-electron/electron/utils/launcherAspect.js');
      if (name === '../src/lib/overlayCustomSize.mjs') return { OVERLAY_PANEL_INSET: 12 };
      return {};
    },
  });
  const helper = Object.create(module.exports.WindowHelper.prototype);
  Object.assign(helper, {
    currentWindowMode: mode, launcherWindow: window, overlayWindow: window,
    pillSize: { width: 200, height: 44 }, isWindowVisible: false,
    positionOverlayAuxWindows: () => calls.push(['aux']),
    repositionOverlayPopovers: () => {},
    showMainWindow: inactive => calls.push(['show', inactive]),
    hideMainWindow: () => calls.push(['hide']),
    appState: { settingsWindowHelper: { reposition() {} }, recordNativeOomOutboundIpc() {} },
    rememberLauncherNormalBounds() {},
    setOverlayUiState() {}, applyOverlayAuxVisibility() {},
    getDisplayWorkArea: rect => fakeElectron.screen.getDisplayMatching(rect).workArea,
  });
  return { helper, calls, window, fakeElectron, listeners };
}

test('shortcut restore applies bounds before showing without stealing focus', () => {
  const { helper, calls } = helperFixture();
  helper.toggleMainWindow(true);
  assert.deepEqual(calls.map(c => c[0]), ['minimum', 'bounds', 'show']);
  assert.equal(calls.at(-1)[1], true);
  assert.equal(helper.launcherPosition.x, -1560);
});

test('ordinary/timed restores and hiding do not reposition', () => {
  const { helper, calls } = helperFixture();
  helper.toggleMainWindow();
  assert.deepEqual(calls, [['show', true]]);
  calls.length = 0;
  helper.isWindowVisible = true;
  helper.toggleMainWindow(true);
  assert.deepEqual(calls, [['hide']]);
});

test('small display minimum cannot prevent the launcher from fitting', () => {
  const { helper, calls, fakeElectron } = helperFixture();
  fakeElectron.screen.getDisplayNearestPoint = () => ({ id: 3, workArea: { x: 0, y: 25, width: 1000, height: 600 } });
  helper.toggleMainWindow(true);
  assert.deepEqual(calls[0], ['minimum', 900, 600]);
  assert.equal(calls[1][1].height, 600);
});

test('single-display shortcut restore keeps an already usable position', () => {
  const { helper, calls, fakeElectron } = helperFixture();
  fakeElectron.screen.getDisplayNearestPoint = () => primary;
  helper.toggleMainWindow(true);
  assert.deepEqual(calls[1][1], original);
});

test('direct show used by automatic and screenshot restores does not query the cursor or move', () => {
  const { helper, calls, fakeElectron } = helperFixture();
  fakeElectron.screen.getCursorScreenPoint = () => { assert.fail('direct restore must not query cursor'); };
  helper.switchToLauncher = inactive => calls.push(['launcher', inactive]);
  Object.getPrototypeOf(helper).showMainWindow.call(helper, true);
  assert.deepEqual(calls, [['launcher', true]]);
  helper.currentWindowMode = 'overlay';
  helper.switchToOverlay = inactive => calls.push(['overlay', inactive]);
  Object.getPrototypeOf(helper).showMainWindow.call(helper, true);
  assert.deepEqual(calls.at(-1), ['overlay', true]);
});

test('destroyed windows are ignored during positioning', () => {
  const { helper, window, calls } = helperFixture();
  window.isDestroyed = () => true;
  helper.prepareShortcutRestore();
  assert.deepEqual(calls, []);
});

test('overlay restore saves its relocated bounds and synchronizes auxiliary windows before show', () => {
  const { helper, calls } = helperFixture('overlay');
  helper.toggleMainWindow(true);
  assert.deepEqual(calls.map(c => c[0]), ['bounds', 'aux', 'show']);
  assert.equal(helper.overlayBounds.x, -1560);
  helper.lastOverlayUiState = { expanded: false };
  assert.equal(helper.isOverlayExpanded(), false);
});

test('small-to-large launcher restore centers the final native minimum size', () => {
  const { helper, window } = helperFixture();
  window.setBounds({ x: 50, y: 25, width: 900, height: 600 });
  window.setMinimumSize(900, 600);
  helper.toggleMainWindow(true);
  const actual = window.getBounds();
  assert.deepEqual(actual, { x: -1560, y: -925, width: 1200, height: 800 });
  assert.deepEqual(window.getMinimumSize(), [1200, 800]);
});

test('ordinary drags refresh launcher minimum on both small and large displays', () => {
  const { helper, window, fakeElectron, listeners, calls } = helperFixture();
  helper.overlayWindow = null;
  helper.setupWindowListeners();
  const small = { id: 3, workArea: { x: 0, y: 25, width: 1000, height: 600 } };
  fakeElectron.screen.getDisplayMatching = rect => rect.x < 0 ? secondary : small;
  listeners.move();
  assert.deepEqual(window.getMinimumSize(), [900, 600]);
  window.setBounds({ x: -1800, y: -900, width: 900, height: 600 });
  listeners.move();
  assert.deepEqual(window.getMinimumSize(), [1200, 800]);
  const updates = calls.filter(call => call[0] === 'minimum').length;
  listeners.move();
  assert.equal(calls.filter(call => call[0] === 'minimum').length, updates);
});

test('overlay stays centered through the real show path after width and height limits', () => {
  const { helper, window, fakeElectron, calls } = helperFixture('overlay');
  const small = { id: 3, workArea: { x: -1000, y: 25, width: 1000, height: 800 } };
  fakeElectron.screen.getDisplayNearestPoint = () => small;
  fakeElectron.screen.getDisplayMatching = rect => rect.x < 0 ? small : primary;
  helper.showMainWindow = Object.getPrototypeOf(helper).showMainWindow;
  helper.toggleMainWindow(true);
  assert.deepEqual(window.getBounds(), { x: -950, y: 85, width: 900, height: 720 });
  const applied = calls.filter(call => call[0] === 'bounds');
  assert.deepEqual(applied[0][1], applied[1][1]);
  assert.equal(calls.at(-1)[0], 'native-show');
});

test('overlay birth-height floor is included before centering and showing', () => {
  const { helper, window, calls } = helperFixture('overlay');
  window.setBounds({ ...original, height: 1 });
  helper.showMainWindow = Object.getPrototypeOf(helper).showMainWindow;
  helper.toggleMainWindow(true);
  const applied = calls.filter(call => call[0] === 'bounds');
  assert.equal(window.getBounds().height, 216);
  assert.deepEqual(applied.at(-2)[1], applied.at(-1)[1]);
});

// Exercise the actual AppState toggle method without booting its app singleton.
const mainSource = fs.readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');
const toggleMethod = mainSource.slice(
  mainSource.indexOf('  public toggleMainWindow('),
  mainSource.indexOf('  public setWindowDimensions(', mainSource.indexOf('  public toggleMainWindow(')),
);
const mainModule = { exports: {} };
vm.runInNewContext(transformSync(`export class ToggleHost { ${toggleMethod} }`, { loader: 'ts', format: 'cjs' }).code, {
  module: mainModule, exports: mainModule.exports, console: { log() {} },
});

function toggleFixture({ visible = true, expanded = true, mode = 'overlay' } = {}) {
  const calls = [];
  const host = Object.create(mainModule.exports.ToggleHost.prototype);
  host.screenshotHelper = { getScreenshotQueue: () => [], getExtraScreenshotQueue: () => [] };
  host.windowHelper = {
    getCurrentWindowMode: () => mode,
    isVisible: () => visible,
    isOverlayExpanded: () => expanded,
    prepareShortcutRestore: () => calls.push('position'),
    toggleMainWindow: onCurrent => calls.push(onCurrent ? 'restore-current' : 'restore'),
    getOverlayWindow: () => ({}),
  };
  host.sendToWindow = (_window, channel) => calls.push(channel);
  return { host, calls };
}

test('collapsed overlay is positioned before the expansion IPC even after its hide timer fires', () => {
  for (const visible of [true, false]) {
    const { host, calls } = toggleFixture({ visible, expanded: false });
    host.toggleMainWindow(true);
    assert.deepEqual(calls, ['position', 'toggle-expand']);
  }
});

test('hiding an expanded overlay does not move it', () => {
  const { host, calls } = toggleFixture();
  host.toggleMainWindow(true);
  assert.deepEqual(calls, ['toggle-expand']);
});

test('shortcut restores an independently hidden expanded overlay, without toggling it closed', () => {
  const { host, calls } = toggleFixture({ visible: false });
  host.toggleMainWindow(true);
  assert.deepEqual(calls, ['restore-current']);
});

test('non-shortcut overlay toggle retains its existing route', () => {
  const { host, calls } = toggleFixture({ visible: false, expanded: false });
  host.toggleMainWindow();
  assert.deepEqual(calls, ['toggle-expand']);
});

test('launcher receives the shortcut origin', () => {
  const { host, calls } = toggleFixture({ mode: 'launcher' });
  host.toggleMainWindow(true);
  assert.deepEqual(calls, ['restore-current']);
});
