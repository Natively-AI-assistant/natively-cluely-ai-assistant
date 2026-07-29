// electron/services/__tests__/ToggleShortcutsKeybind.test.mjs
//
// Tier-0: general:toggle-shortcuts default is CommandOrControl+/, global.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const electronStub = {
  BrowserWindow: class {},
  Menu: { buildFromTemplate: () => ({}) },
  globalShortcut: {
    register: () => true,
    unregister: () => {},
    unregisterAll: () => {},
    isRegistered: () => false,
  },
  app: {
    getAppPath: () => ROOT,
    isPackaged: false,
    getPath: () => '/tmp',
  },
  ipcMain: { handle: () => {}, removeHandler: () => {} },
};

require.cache[require.resolve('electron')] = {
  id: require.resolve('electron'),
  filename: require.resolve('electron'),
  loaded: true,
  exports: electronStub,
};

const distPath = path.join(ROOT, 'dist-electron/electron/services/KeybindManager.js');

test('DEFAULT_KEYBINDS includes general:toggle-shortcuts at CommandOrControl+/', () => {
  const { DEFAULT_KEYBINDS } = require(distPath);
  const kb = DEFAULT_KEYBINDS.find((k) => k.id === 'general:toggle-shortcuts');
  assert.ok(kb, 'general:toggle-shortcuts must exist in DEFAULT_KEYBINDS');
  assert.equal(kb.accelerator, 'CommandOrControl+/');
  assert.equal(kb.defaultAccelerator, 'CommandOrControl+/');
  assert.equal(kb.isGlobal, true);
});
