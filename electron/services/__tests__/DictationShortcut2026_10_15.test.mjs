// The dictation shortcut (KeybindManager 'dictation:toggle', 2026-10-15) takes
// its key from other apps only while Settings › Audio › Dictation is on, in
// the launcher and in a meeting alike. Runs the REAL compiled KeybindManager
// against a stub `electron` that records what globalShortcut holds. The Win32
// chord table (the Windows stealth hook's copy of the same set) is built from
// the same gate, so it is asserted too: both platforms read one decision.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dictation-shortcut-'));
const registered = new Set();
const fired = [];
const handlers = new Map();
const electronStub = {
    app: { getPath: () => userData, isReady: () => true, isPackaged: false, getVersion: () => '0.0.0', on() {}, whenReady: () => Promise.resolve() },
    globalShortcut: {
        register(acc, fn) { registered.add(acc); handlers.set(acc, fn); return true; },
        unregister(acc) { registered.delete(acc); handlers.delete(acc); },
        unregisterAll() { registered.clear(); handlers.clear(); },
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
let settings;
before(() => {
    const { KeybindManager } = require(path.resolve(repoRoot, 'dist-electron/electron/services/KeybindManager.js'));
    const { SettingsManager } = require(path.resolve(repoRoot, 'dist-electron/electron/services/SettingsManager.js'));
    settings = SettingsManager.getInstance();
    km = KeybindManager.getInstance();
    km.onShortcutTriggered((id) => fired.push(id));
});

const ACC = 'CommandOrControl+Shift+D';

test('off (the default): the key is never taken, in the launcher or in a meeting, on either path', () => {
    assert.equal(settings.get('dictationEnabled'), undefined, 'unset means off');
    for (const mode of ['launcher', 'overlay']) {
        km.setMode(mode);
        assert.ok(!registered.has(ACC), `${mode}: Cmd/Ctrl+Shift+D stays with the focused app`);
        assert.ok(!km.getGlobalChordTable().some((c) => c.id === 'dictation:toggle'), `${mode}: not on the Windows hook either`);
    }
});

test('on: registered in both modes and on the Windows chord table; a press reaches the dictation handler', () => {
    settings.set('dictationEnabled', true);
    try {
        for (const mode of ['launcher', 'overlay']) {
            km.setMode(mode);
            km.refreshRegistrations();
            assert.ok(registered.has(ACC), `${mode}: registered`);
            assert.ok(km.getGlobalChordTable().some((c) => c.id === 'dictation:toggle'), `${mode}: on the Windows hook`);
        }
        fired.length = 0;
        handlers.get(ACC)();
        assert.deepEqual(fired, ['dictation:toggle']);
    } finally {
        settings.set('dictationEnabled', false);
        km.refreshRegistrations();
    }
    assert.ok(!registered.has(ACC), 'turned off: released at once');
});

test('global shortcuts switched off: dictation is not registered either', () => {
    settings.set('dictationEnabled', true);
    try {
        km.setGlobalShortcutsEnabled(false);
        km.setMode('launcher');
        km.refreshRegistrations();
        assert.ok(!registered.has(ACC));
    } finally {
        km.setGlobalShortcutsEnabled(true);
        settings.set('dictationEnabled', false);
        km.refreshRegistrations();
    }
});
