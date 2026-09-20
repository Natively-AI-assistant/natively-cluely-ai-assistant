// electron/services/__tests__/GlobalShortcutsScoping.test.mjs
// Issue #517 regression tests:
// 1. general:reset-cancel must not be global (isGlobal: false) to prevent hijacking browser reload (Ctrl+R).
// 2. window:move-* shortcuts must not register in launcher mode to prevent hijacking word selection (Ctrl+Shift+Arrow).
// 3. shouldRegister respects globalShortcutsEnabled toggle.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.resolve(repoRoot, rel), 'utf8');

describe('Issue #517 Keybind Scoping and Defaults', () => {
  test('general:reset-cancel is NOT global (isGlobal: false)', () => {
    const src = read('electron/services/KeybindManager.ts');
    const resetLine = src.split('\n').find((l) => l.includes("'general:reset-cancel'"));
    assert.ok(resetLine, 'general:reset-cancel must exist in KeybindManager.ts');
    assert.match(resetLine, /isGlobal:\s*false/, 'general:reset-cancel must have isGlobal: false to avoid intercepting browser Ctrl+R system-wide');
  });

  test('shouldRegister excludes window:move-* in launcher mode', () => {
    const src = read('electron/services/KeybindManager.ts');
    const shouldRegisterMethod = src.slice(
      src.indexOf('shouldRegister('),
      src.indexOf('normalizeAccelerator('),
    );
    // In launcher mode, window:move- must not be permitted
    assert.doesNotMatch(
      shouldRegisterMethod,
      /if\s*\(\s*actionId\.startsWith\(['"]window:move-['"]\)\s*\)\s*return\s*true/,
      'window:move-* must not be registered in launcher mode to prevent suppressing Ctrl+Shift+Arrow text selection',
    );
  });

  test('KeybindManager provides getGlobalShortcutsEnabled and setGlobalShortcutsEnabled', () => {
    const src = read('electron/services/KeybindManager.ts');
    assert.match(src, /getGlobalShortcutsEnabled\s*\(\s*\)/, 'KeybindManager must have getGlobalShortcutsEnabled');
    assert.match(src, /setGlobalShortcutsEnabled\s*\(/, 'KeybindManager must have setGlobalShortcutsEnabled');
  });

  test('KeybindManager exposes keybinds:get-global-enabled and keybinds:set-global-enabled IPC handlers', () => {
    const src = read('electron/services/KeybindManager.ts');
    assert.match(src, /ipcMain\.handle\(['"]keybinds:get-global-enabled['"]/, 'KeybindManager must handle keybinds:get-global-enabled');
    assert.match(src, /ipcMain\.handle\(['"]keybinds:set-global-enabled['"]/, 'KeybindManager must handle keybinds:set-global-enabled');
  });

  test('preload and electron.d.ts expose keybind global shortcut methods', () => {
    const preload = read('electron/preload.ts');
    const types = read('src/types/electron.d.ts');
    assert.match(preload, /getGlobalShortcutsEnabled:/, 'preload.ts must expose getGlobalShortcutsEnabled');
    assert.match(preload, /setGlobalShortcutsEnabled:/, 'preload.ts must expose setGlobalShortcutsEnabled');
    assert.match(types, /getGlobalShortcutsEnabled:/, 'electron.d.ts must type getGlobalShortcutsEnabled');
    assert.match(types, /setGlobalShortcutsEnabled:/, 'electron.d.ts must type setGlobalShortcutsEnabled');
  });
});
