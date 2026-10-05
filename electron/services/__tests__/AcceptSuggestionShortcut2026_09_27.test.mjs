// The overlay's suggestion card is accepted with a GLOBAL shortcut, not Tab.
//
// 2026-09-27: the card showed "Tab" and listened for it with a window keydown
// handler. The overlay is a no-activate panel (macOS type:'panel', Windows
// WS_EX_NOACTIVATE) that never takes keyboard focus during a meeting, and
// stealth typing delivers keys by IPC, not DOM events, so Tab went to Zoom or
// Meet and the card never heard it. "Use Suggestion" (chat:acceptSuggestion,
// default Cmd/Ctrl+8) now rides the same path as What to Answer: globalShortcut
// on macOS, the stealth hook's chord table on Windows, relayed by main as the
// 'acceptSuggestion' global-shortcut action.
//
// Runs the REAL compiled KeybindManager against a stub `electron` module (the
// GlobalShortcutScoping2026_09_23 pattern).
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
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-suggestion-'));
const registered = new Set();
const electronStub = {
  app: { getPath: () => userData, isReady: () => true, isPackaged: false, getVersion: () => '0.0.0', on() {}, whenReady: () => Promise.resolve() },
  globalShortcut: {
    register(acc) { registered.add(acc); return true; },
    unregister(acc) { registered.delete(acc); },
    unregisterAll() { registered.clear(); },
    isRegistered(acc) { return registered.has(acc); },
  },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle() {}, on() {}, removeHandler() {} },
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return realLoad.call(this, request, ...rest);
};

let km;
let DEFAULT_KEYBINDS;
before(() => {
  const mod = require(path.resolve(repoRoot, 'dist-electron/electron/services/KeybindManager.js'));
  DEFAULT_KEYBINDS = mod.DEFAULT_KEYBINDS;
  km = mod.KeybindManager.getInstance();
});

describe('Use Suggestion is a global shortcut', () => {
  test('defined as chat:acceptSuggestion, Cmd/Ctrl+8, global', () => {
    const kb = DEFAULT_KEYBINDS.find((k) => k.id === 'chat:acceptSuggestion');
    assert.ok(kb, 'the keybind exists (and so appears in Settings > Keybinds)');
    assert.equal(kb.accelerator, 'CommandOrControl+8');
    assert.equal(kb.defaultAccelerator, 'CommandOrControl+8');
    assert.equal(kb.isGlobal, true, 'a global chord fires whichever app has focus');
    const clash = DEFAULT_KEYBINDS.filter((k) => k.id !== kb.id && k.accelerator === kb.accelerator);
    assert.deepEqual(clash, [], 'no other default uses the same chord');
  });

  test('registered OS-wide while the overlay shows, not from the launcher (macOS/globalShortcut path)', () => {
    km.setMode('overlay');
    assert.ok(registered.has('CommandOrControl+8'));
    km.setMode('launcher');
    assert.ok(!registered.has('CommandOrControl+8'), 'the launcher has no suggestion card to accept');
  });

  test('in the Windows stealth hook chord table as Ctrl+8 while the overlay shows', () => {
    km.setMode('overlay');
    const chord = km.getGlobalChordTable().find((c) => c.id === 'chat:acceptSuggestion');
    assert.ok(chord, 'the hook swallows the chord and dispatches the action instead of leaking it to the meeting app');
    assert.equal(chord.vk, 0x38, "VK '8'");
    assert.equal(chord.mods, 1, 'Ctrl only (MOD_CTRL)');
    km.setMode('launcher');
    assert.ok(!km.getGlobalChordTable().some((c) => c.id === 'chat:acceptSuggestion'));
  });

  test('main relays it to the overlay as the acceptSuggestion global-shortcut action', () => {
    const main = read('electron/main.ts');
    assert.match(main, /actionId === 'chat:acceptSuggestion'/);
    assert.match(main, /'chat:acceptSuggestion': 'acceptSuggestion'/);
  });

  test('the renderer maps every global chat shortcut both ways (drift guard)', () => {
    const hook = read('src/hooks/useShortcuts.ts');
    for (const kb of DEFAULT_KEYBINDS.filter((k) => k.isGlobal && k.id.startsWith('chat:'))) {
      assert.ok(hook.includes(`'${kb.id}':`), `useShortcuts BACKEND_ID_TO_ACTION lacks ${kb.id}`);
      assert.ok(hook.includes(`backendId = '${kb.id}'`), `useShortcuts updateShortcut cannot rebind ${kb.id}`);
    }
    assert.match(hook, /acceptSuggestion: \[mod, '8'\]/, 'the keycap defaults to the same chord');
  });

  test('the bar accepts on the relayed action and no longer listens for keys itself', () => {
    const bar = read('src/components/dynamic-actions/DynamicActionBar.tsx');
    assert.match(bar, /onGlobalShortcut/);
    assert.match(bar, /action !== 'acceptSuggestion'/);
    assert.doesNotMatch(bar, /addEventListener\(\s*'keydown'/, 'an in-page listener never hears keys during a meeting, and took Tab from the page');
  });
});
