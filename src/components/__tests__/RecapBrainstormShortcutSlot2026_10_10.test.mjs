// The "Recap / Brainstorm" slot is gone (2026-10-20).
//
// Interview Mode used to switch the overlay's Recap button, and its shortcut
// (chat:dynamicAction4, Cmd/Ctrl+3), to Brainstorm. On 2026-10-10 the shortcut
// was caught running Recap with the button reading Brainstorm (a stale closure,
// fixed with a ref). Since 2026-10-20 Brainstorm is a button of its own, put in
// the overlay's row from Settings › Overlay, and Interview Mode is removed: the
// slot shortcut always runs Recap, and Brainstorm keeps its own shortcut.
//
// These pin that the slot, its toggle and its IPC are all gone, so nothing can
// read a stale Recap/Brainstorm value again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
// Drop comments so prose that mentions a name cannot satisfy or trip a check.
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** The text from the first occurrence of `start` to the next occurrence of `end`. */
const between = (text, start, end) => {
  const i = text.indexOf(start);
  assert.notEqual(i, -1, `missing: ${start}`);
  const j = text.indexOf(end, i + start.length);
  assert.notEqual(j, -1, `missing end: ${end}`);
  return text.slice(i, j);
};

const overlay = code('src/components/NativelyInterface.tsx');

test('the overlay has no Recap/Brainstorm slot left', () => {
  assert.doesNotMatch(overlay, /actionButtonMode|ActionButtonMode|shownActionMode|labelActionMode/);
});

test('the global slot shortcut runs Recap, and Brainstorm keeps its own', () => {
  const listener = between(overlay, 'window.electronAPI.onGlobalShortcut(({ action }) => {', 'return unsubscribe;');
  assert.match(listener, /action === 'dynamicAction4'\) handlers\.handleRecap\(\);/);
  assert.match(listener, /action === 'brainstorm'\) handlers\.handleBrainstorm\(\);/);
});

test('the focused slot shortcut runs Recap, and Brainstorm keeps its own', () => {
  const handler = between(overlay, 'const handleKeyDown = (e: KeyboardEvent) => {', 'const handleKeyUp = (e: KeyboardEvent) => {');
  const slot = between(handler, "isShortcutPressed(e, 'dynamicAction4')", "isShortcutPressed(e, 'answer')");
  assert.match(slot, /handleRecap\(\);/);
  assert.doesNotMatch(slot, /handleBrainstorm/);
  assert.match(between(handler, "isShortcutPressed(e, 'brainstorm')", '} else if'), /handleBrainstorm\(\);/);
});

test('Interview Mode is gone from the quick-settings popup, the preload and main', () => {
  assert.doesNotMatch(code('src/components/SettingsPopup.tsx'), /Interview Mode|interview-mode|ActionButtonMode/);
  assert.doesNotMatch(code('electron/preload.ts'), /action-button-mode|ActionButtonMode/);
  assert.doesNotMatch(code('electron/ipcHandlers.ts'), /'(get|set)-action-button-mode'|action-button-mode-changed/);
  assert.doesNotMatch(read('src/types/electron.d.ts'), /ActionButtonMode/);
});
