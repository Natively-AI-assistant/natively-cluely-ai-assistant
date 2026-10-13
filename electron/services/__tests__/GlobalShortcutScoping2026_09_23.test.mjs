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
// What a window is pushed: the overlay's conflict banner learns from these alone.
const pushed = [];
const listeningWindow = { isDestroyed: () => false, webContents: { send: (channel, payload) => pushed.push({ channel, ...payload }) } };
const electronStub = {
  app: { getPath: () => userData, isReady: () => true, isPackaged: false, getVersion: () => '0.0.0', on() {}, whenReady: () => Promise.resolve() },
  globalShortcut: {
    register(acc) { if (refused.has(acc)) return false; registered.add(acc); return true; },
    unregister(acc) { registered.delete(acc); },
    unregisterAll() { registered.clear(); },
    isRegistered(acc) { return registered.has(acc); },
  },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
  BrowserWindow: { getAllWindows: () => [listeningWindow] },
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

    km.setMode('overlay');
    for (const acc of ['CommandOrControl+H', 'CommandOrControl+Shift+H']) {
      assert.ok(registered.has(acc), `${acc} works in a meeting`);
    }
    const meetingChords = km.getGlobalChordTable().map((c) => c.id);
    assert.ok(meetingChords.includes('general:take-screenshot'));
    assert.ok(meetingChords.includes('general:selective-screenshot'));
  });

  // 2026-10-10: the other two capture shortcuts had the same fault, with a cost
  // the screenshot pair did not have. Pressed for real outside a meeting,
  // Cmd+Shift+Enter did take the picture: the launcher hid, the screen was
  // captured into the queue, the launcher came back, and nothing was shown or
  // asked, because the listener for what main sends next is the overlay. Cmd+Y
  // delivers to that same overlay or falls back to that same screenshot.
  test('Capture Screen & Ask AI and Capture Page are registered only while a meeting is up', () => {
    km.setMode('launcher');
    for (const acc of ['CommandOrControl+Shift+Enter', 'CommandOrControl+Y']) {
      assert.ok(!registered.has(acc), `${acc} must not take a picture of the screen that nothing will use`);
    }
    const launcherChords = km.getGlobalChordTable().map((c) => c.id);
    assert.ok(!launcherChords.includes('general:capture-and-process'), 'the Windows hook must not swallow Ctrl+Shift+Enter outside a meeting');
    assert.ok(!launcherChords.includes('general:capture-dom'), 'the Windows hook must not swallow Ctrl+Y (Redo) outside a meeting');
    assert.deepEqual([...registered].sort(), ['CommandOrControl+B', 'CommandOrControl+Shift+B'].sort(), 'outside a meeting: show or hide, and click-through');
    assert.deepEqual(launcherChords.sort(), ['general:toggle-mouse-passthrough', 'general:toggle-visibility'], 'the same two on the Windows path');

    km.setMode('overlay');
    for (const acc of ['CommandOrControl+Shift+Enter', 'CommandOrControl+Y']) {
      assert.ok(registered.has(acc), `${acc} works in a meeting`);
    }
    const meetingChords = km.getGlobalChordTable().map((c) => c.id);
    assert.ok(meetingChords.includes('general:capture-and-process'));
    assert.ok(meetingChords.includes('general:capture-dom'));
  });

  // 2026-10-12: Answer Multiple Choice on Screen screenshots and answers into
  // the overlay, so like the other capture keys it must only hold its chord
  // while a meeting (the overlay) is up — on both the globalShortcut and the
  // Windows hook paths.
  test('Answer Multiple Choice on Screen is registered only while a meeting is up', () => {
    km.setMode('launcher');
    assert.ok(!registered.has('CommandOrControl+Shift+M'), 'outside a meeting nothing would show the answer');
    assert.ok(!km.getGlobalChordTable().some((c) => c.id === 'general:answer-screen-mcq'));

    km.setMode('overlay');
    assert.ok(registered.has('CommandOrControl+Shift+M'), 'default chord works in a meeting');
    assert.ok(km.getGlobalChordTable().some((c) => c.id === 'general:answer-screen-mcq'));
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
      assert.deepEqual(await ids(), ['general:take-screenshot'], 'and still there for Settings, where it is asked again and refused again');
      await invoke('keybinds:set', 'general:take-screenshot', 'CommandOrControl+Alt+J');
      assert.deepEqual(await ids(), [], 'rebound: the old verdict is about a shortcut it no longer has');
    } finally {
      refused.delete('CommandOrControl+H');
      await invoke('keybinds:reset');
    }
  });

  // 2026-10-10: with the capture shortcuts released outside a meeting, one that
  // another app holds was only found when a meeting started. Every meeting-only
  // shortcut had that gap (Cmd/Ctrl+1 to 6 always did). The launcher pass now
  // asks the OS about each and gives it straight back.
  test('a meeting-only shortcut another app holds is found outside a meeting, and nothing stays registered', async () => {
    const ids = async () => (await invoke('keybinds:get-registration-failures')).map((f) => f.id);
    km.setMode('overlay');
    refused.add('CommandOrControl+Shift+Enter');
    refused.add('CommandOrControl+1');
    try {
      km.setMode('launcher');
      assert.deepEqual(await ids(), ['chat:whatToAnswer', 'general:capture-and-process'], 'both conflicts are known before any meeting');
      assert.deepEqual([...registered].sort(), ['CommandOrControl+B', 'CommandOrControl+Shift+B'].sort(), 'asking leaves nothing registered');
      assert.deepEqual(km.getGlobalChordTable().map((c) => c.id).sort(), ['general:toggle-mouse-passthrough', 'general:toggle-visibility'], 'and nothing extra on the Windows path');

      // The other app lets go: the next pass outside a meeting clears it.
      refused.delete('CommandOrControl+Shift+Enter');
      refused.delete('CommandOrControl+1');
      km.registerGlobalShortcuts();
      assert.deepEqual(await ids(), []);
      assert.deepEqual([...registered].sort(), ['CommandOrControl+B', 'CommandOrControl+Shift+B'].sort());
    } finally {
      refused.clear();
      await invoke('keybinds:reset');
    }
  });

  // Found in review. A window that only hears the pushes (the overlay's
  // banner) was told of a conflict found outside a meeting and never told it
  // was gone: the meeting pass drops the verdict before re-testing, so the
  // successful registration had nothing to clear and announced nothing.
  test('a conflict that is gone when the meeting starts is announced as cleared, once', async () => {
    const about = (id) => pushed.filter((p) => p.id === id && /registration-(failed|succeeded)$/.test(p.channel)).map((p) => p.channel.split(':')[1]);
    km.setMode('overlay');
    refused.add('CommandOrControl+1');
    try {
      pushed.length = 0;
      km.setMode('launcher');
      assert.deepEqual(about('chat:whatToAnswer'), ['registration-failed'], 'told when it is found');
      refused.delete('CommandOrControl+1'); // the other app quits
      pushed.length = 0;
      km.setMode('overlay');
      assert.deepEqual(about('chat:whatToAnswer'), ['registration-succeeded'], 'and told when it works again');
      assert.ok(registered.has('CommandOrControl+1'));
    } finally {
      refused.clear();
      await invoke('keybinds:reset');
    }
  });

  test('a conflict cleared by the next look outside a meeting is announced once, not twice', async () => {
    km.setMode('overlay');
    refused.add('CommandOrControl+1');
    try {
      km.setMode('launcher');
      refused.delete('CommandOrControl+1');
      pushed.length = 0;
      km.registerGlobalShortcuts();
      assert.equal(pushed.filter((p) => p.id === 'chat:whatToAnswer' && p.channel === 'keybinds:registration-succeeded').length, 1);
    } finally {
      refused.clear();
      await invoke('keybinds:reset');
    }
  });

  test('asking never drops a shortcut this app really holds', () => {
    km.setMode('launcher');
    const kb = km.keybinds.get('general:take-screenshot');
    const was = kb.accelerator;
    kb.accelerator = 'CommandOrControl+B'; // two actions on one key
    try {
      km.registerGlobalShortcuts();
      assert.ok(registered.has('CommandOrControl+B'), 'Toggle Visibility is still registered');
    } finally {
      kb.accelerator = was;
      km.registerGlobalShortcuts();
    }
  });

  test('with global shortcuts off, nothing is asked about', async () => {
    km.setMode('launcher');
    await invoke('keybinds:set-global-enabled', false);
    refused.add('CommandOrControl+1');
    try {
      km.registerGlobalShortcuts();
      assert.deepEqual(await invoke('keybinds:get-registration-failures'), [], 'a shortcut that is switched off has no conflict to report');
    } finally {
      refused.delete('CommandOrControl+1');
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
