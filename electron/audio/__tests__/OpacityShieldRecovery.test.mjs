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
  const opacity = [];
  const window = (name, { visible = true, destroyed = false } = {}) => ({
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    setOpacity: (value) => opacity.push([name, value]),
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

  assert.deepEqual(opacity, [
    ['launcher', 1],
    ['overlay', 1],
    ['launcher', 1],
    ['overlay', 1],
  ]);
});
