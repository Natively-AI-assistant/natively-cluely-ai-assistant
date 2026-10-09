// electron/services/__tests__/GlobalShortcutScoping2026_09_23.test.mjs
//
// Issue #517 (salvaged from PR #591): Natively's OS-wide shortcuts swallowed
// browser/editor chords — Cmd/Ctrl+R (reload) and Cmd/Ctrl+Shift+Arrow (word
// selection) among them — and there was no way to turn them off.
//
// Runs the REAL compiled KeybindManager against a stub `electron` module that
// records what is registered with globalShortcut. The Win32 chord table (the
// Windows stealth hook's copy of the same set, getGlobalChordTable) is built from
// the same gate, so it is asserted too: both platforms read one decision.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'keybind-scoping-'));
const registered = new Set();
// Accelerators the "OS" will not hand over (another app holds them).
const refused = new Set();
const ipcHandlers = new Map();
const electronStub = {
  app: { getPath: () => userData, isReady: () => true, isPackaged: false, getVersion: () => '0.0.0', on() {}, whenReady: () => Promise.resolve() },
  globalShortcut: {
    register(acc) { if (refused.has(acc)) return false; registered.add(acc); return true; },
    unregister(acc) { registered.delete(acc); },
    unregisterAll() { registered.clear(); },
    isRegistered(acc) { return registered.has(acc); },
  },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle(ch, fn) { ipcHandlers.set(ch, fn); }, on() {}, removeHandler() {} },
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return realLoad.call(this, request, ...rest);
};

let km;
before(() => {
  const { KeybindManager } = require(path.resolve(repoRoot, 'dist-electron/electron/services/KeybindManager.js'));
  km = KeybindManager.getInstance();
  km.setupIpcHandlers();
});

const invoke = (ch, ...args) => ipcHandlers.get(ch)({}, ...args);

describe('global shortcut scoping (#517)', () => {
  test('Reset / Cancel (Cmd/Ctrl+R) is never registered OS-wide', () => {
    km.setMode('overlay');
    assert.ok(registered.has('CommandOrControl+1'), 'overlay mode should register the chat shortcuts');
    assert.ok(!registered.has('CommandOrControl+R'), 'Cmd/Ctrl+R must stay with the focused app (browser reload)');
  });

  test('window:move-* is not registered OS-wide in launcher mode', () => {
    km.setMode('launcher');
    assert.ok(registered.has('CommandOrControl+B'), 'Toggle Visibility stays global in launcher mode');
    for (const acc of ['CommandOrControl+Shift+Up', 'CommandOrControl+Shift+Down', 'CommandOrControl+Shift+Left', 'CommandOrControl+Shift+Right']) {
      assert.ok(!registered.has(acc), `${acc} is word selection in the focused app`);
    }
  });

  // 2026-10-10: Take Screenshot and Selective Screenshot were registered outside
  // a meeting and did nothing there. Main hands both to the meeting overlay's
  // renderer, the only listener, and outside a meeting the press goes to the
  // launcher. Pressed for real: the trigger was logged, no screenshot was taken
  // and no cropper opened. What they did do was take Cmd+H (Hide) on macOS and
  // Ctrl+H (History, Replace) on Windows away from every other app.
  test('the screenshot shortcuts are registered only while a meeting is up', () => {
    km.setMode('launcher');
    for (const acc of ['CommandOrControl+H', 'CommandOrControl+Shift+H']) {
      assert.ok(!registered.has(acc), `${acc} has nothing to attach a screenshot to outside a meeting`);
    }
    const launcherChords = km.getGlobalChordTable().map((c) => c.id);
    assert.ok(!launcherChords.includes('general:take-screenshot'), 'the Windows hook must not swallow Ctrl+H outside a meeting');
    assert.ok(!launcherChords.includes('general:selective-screenshot'), 'the Windows hook must not swallow Ctrl+Shift+H outside a meeting');
    assert.ok(registered.has('CommandOrControl+B'), 'Toggle Visibility stays');
    assert.ok(registered.has('CommandOrControl+Shift+Enter'), 'Capture Screen & Ask AI is left as it was');
    assert.ok(registered.has('CommandOrControl+Y'), 'page capture is left as it was');

    km.setMode('overlay');
    for (const acc of ['CommandOrControl+H', 'CommandOrControl+Shift+H']) {
      assert.ok(registered.has(acc), `${acc} works in a meeting`);
    }
    const meetingChords = km.getGlobalChordTable().map((c) => c.id);
    assert.ok(meetingChords.includes('general:take-screenshot'));
    assert.ok(meetingChords.includes('general:selective-screenshot'));
  });

  // Found in review, 2026-10-10. A conflict recorded in a meeting is kept while
  // the launcher is up (that is where Settings reads it). Rebinding the shortcut
  // there did not clear it: launcher mode does not attempt the id, so nothing
  // re-derived the verdict, and Settings showed "in use" for the new shortcut
  // until the next meeting.
  test('a recorded conflict does not outlive the accelerator it was about', async () => {
    const ids = async () => (await invoke('keybinds:get-registration-failures')).map((f) => f.id);
    refused.add('CommandOrControl+H');
    try {
      km.setMode('launcher');
      km.setMode('overlay');
      assert.deepEqual(await ids(), ['general:take-screenshot'], 'the conflict is seen in a meeting');
      km.setMode('launcher');
      assert.deepEqual(await ids(), ['general:take-screenshot'], 'and kept for Settings, where it is not re-tested');
      await invoke('keybinds:set', 'general:take-screenshot', 'CommandOrControl+Alt+J');
      assert.deepEqual(await ids(), [], 'rebound: the old verdict is about a shortcut it no longer has');
    } finally {
      refused.delete('CommandOrControl+H');
      await invoke('keybinds:reset');
    }
  });

  test('turning global shortcuts off leaves ONLY Toggle Visibility, on both registration paths', async () => {
    km.setMode('overlay');
    assert.equal(await invoke('keybinds:get-global-enabled'), true, 'default is on');
    assert.equal(await invoke('keybinds:set-global-enabled', false), false);
    assert.deepEqual([...registered], ['CommandOrControl+B']);
    const chordIds = km.getGlobalChordTable().map((c) => c.id);
    assert.deepEqual(chordIds, ['general:toggle-visibility'], 'the Windows hook chord table must follow the same switch');
  });

  test('the switch persists in settings.json', () => {
    const settings = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    assert.equal(settings.globalShortcutsEnabled, false);
  });

  test('a non-boolean from the renderer is ignored', async () => {
    assert.equal(await invoke('keybinds:set-global-enabled', 'yes'), false);
  });

  test('turning it back on restores the full overlay set; Restore Default re-enables', async () => {
    assert.equal(await invoke('keybinds:set-global-enabled', true), true);
    assert.ok(registered.has('CommandOrControl+1') && registered.has('CommandOrControl+Enter'));
    await invoke('keybinds:set-global-enabled', false);
    await invoke('keybinds:reset');
    assert.equal(await invoke('keybinds:get-global-enabled'), true);
    assert.ok(registered.has('CommandOrControl+1'));
    // PR #591 moved the switch INTO keybinds.json as an object; older builds
    // iterate that file as an array and would drop every custom binding.
    const kb = JSON.parse(fs.readFileSync(path.join(userData, 'keybinds.json'), 'utf8'));
    assert.ok(Array.isArray(kb), 'keybinds.json must stay an array');
  });
});
