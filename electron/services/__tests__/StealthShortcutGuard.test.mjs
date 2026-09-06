import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

// The shortcut-guard shares the single native hook with full stealth
// typing (ACTIVE_HOOK is one global slot), so its lifecycle must be coordinated:
// free the tap before full typing engages, restore it after, and dispatch chords
// while it runs. StealthKeyboardManager imports electron at module scope so it
// can't load under node --test; these pin the coordination invariants in source.

const SKM = 'electron/services/StealthKeyboardManager.ts';

test('full stealth start() frees the guard first; stop() restores it', () => {
  const src = read(SKM);
  const start = src.slice(src.indexOf('public start(): boolean {'), src.indexOf('private hideAuxWindowsForStealth'));
  assert.match(start, /this\.stopGuard\(\)/, 'start() must stop the guard before engaging the full typing tap (one shared hook).');
  const stopStart = src.indexOf('public stop(): void {');
  const stop = src.slice(stopStart, src.indexOf('public setShortcutGuardEnabled(', stopStart));
  assert.match(stop, /this\.maybeStartGuard\(\)/, 'stop() must restore the guard after full stealth typing ends.');
});

test('the guard starts the tap in shortcut-only mode with no overlay bounds', () => {
  const src = read(SKM);
  const fn = src.slice(src.indexOf('private maybeStartGuard('), src.indexOf('private stopGuard('));
  assert.ok(fn.length > 0, 'maybeStartGuard() not found');
  assert.match(fn, /process\.platform !== 'win32'/, 'guard must be Windows-only.');
  assert.match(fn, /if \(!this\.shortcutGuardEnabled\) return/, 'guard must respect the enablement flag.');
  assert.match(fn, /if \(this\.active\) return/, 'guard must not run while full stealth typing owns the tap.');
  assert.match(fn, /\/\* shortcutOnly \*\/ true, \/\* overlayBounds \*\/ null/, 'guard must start the tap in shortcut-only mode with null bounds.');
});

test('app-chord events dispatch in guard mode (active is false then)', () => {
  const src = read(SKM);
  const h = src.slice(src.indexOf('private handleCapturedKey('), src.indexOf('private sendKeyToOverlay('));
  assert.match(h, /if \(!this\.active && !this\.guardRunning\) return/, 'app-chord branch must dispatch when the guard is running, not only when active.');
  assert.match(h, /if \(this\.active\) this\.armIdleTimer\(\)/, 'idle auto-stop applies to full mode only, not the guard.');
});

test('full stealth start() passes shortcutOnly=false (existing behaviour preserved)', () => {
  const src = read(SKM);
  assert.match(src, /\}, appChords, \/\* shortcutOnly \*\/ false, overlayBounds\)/, 'the full typing tap must start with shortcutOnly=false.');
});

test('the guard defaults ON and remains opt-out', () => {
  const src = read(SKM);
  assert.match(src, /private shortcutGuardEnabled = false/, 'runtime state starts inactive until Windows boot applies the policy.');
  const settings = read('electron/services/SettingsManager.ts');
  assert.match(settings, /stealthShortcutGuard\?: boolean/, 'the persisted setting must exist.');
  // Unset enables the guard; an explicit false is the escape hatch.
  const main = read('electron/main.ts');
  assert.match(main, /appState\.getStealthShortcutGuardEnabled\(\)/, 'boot must use the shared default-on policy.');
});

test('a rebind re-arms a running guard with the new chords', () => {
  const km = read('electron/services/KeybindManager.ts');
  const setBlock = km.slice(km.indexOf("ipcMain.handle('keybinds:set'"), km.indexOf("ipcMain.handle('keybinds:get-registration-failures'"));
  assert.match(setBlock, /this\.notifyChordsChanged\(\)/, 'a rebind must notify the guard so it re-arms with the new chord table.');
  const fn = km.slice(km.indexOf('private notifyChordsChanged('));
  assert.match(fn, /refreshShortcutGuard\(\)/, 'notifyChordsChanged must call refreshShortcutGuard.');
});

test('the guard tracks only shortcuts registered in the active app mode', () => {
  const km = read('electron/services/KeybindManager.ts');
  const table = km.slice(km.indexOf('public getGlobalChordTable('), km.indexOf('public triggerActionById('));
  assert.match(table, /filter\(kb => this\.shouldRegister\(kb\.id\)\)/, 'the hook must not dispatch shortcuts disabled in the current mode.');
  const mode = km.slice(km.indexOf("public setMode("), km.indexOf('private shouldRegister('));
  assert.match(mode, /this\.notifyChordsChanged\(\)/, 'switching launcher/overlay mode must re-arm the hook with the active chord table.');
});

test('Ctrl suppression follows the actual overlay window visibility', () => {
  const src = read(SKM);
  const registration = src.slice(src.indexOf('public setOverlayWindow('), src.indexOf('public isAvailable('));
  assert.match(
    registration,
    /win\.on\('show', syncCtrlSuppression\);[\s\S]*win\.on\('hide', syncCtrlSuppression\);[\s\S]*isVisible\(\)[\s\S]*setCtrlSuppressed\(suppress\)/,
    'show/hide must sync BrowserWindow visibility to the native Ctrl suppressor.',
  );
});
