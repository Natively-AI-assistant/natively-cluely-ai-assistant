// The "Recap / Brainstorm" shortcut ran Recap whatever the slot was set to
// (2026-10-10).
//
// Settings can switch the Recap button to Brainstorm. The button followed the
// setting; its shortcut (chat:dynamicAction4, Cmd/Ctrl+3) did not. Pressed for
// real in a meeting with the slot on Brainstorm, the button read "Brainstorm"
// and the press logged `runRecap`.
//
// The global-shortcut listener subscribes once (deps []) and read
// `actionButtonMode` from that first render's closure, where it is always the
// initial 'recap': the saved setting arrives later, through state the listener
// never sees again. Its handlers were already read through handlersRef; the
// slot was not. The focused keydown handler had the same read and went stale
// whenever the setting changed without the shortcut table changing.
//
// These pin both listeners to a ref that is written on every render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = readFileSync(join(root, 'src/components/NativelyInterface.tsx'), 'utf8');

// Drop comments so prose that mentions a read cannot satisfy or trip a check.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The text from the first occurrence of `start` to the next occurrence of `end`. */
const between = (text, start, end) => {
  const i = text.indexOf(start);
  assert.notEqual(i, -1, `missing: ${start}`);
  const j = text.indexOf(end, i + start.length);
  assert.notEqual(j, -1, `missing end: ${end}`);
  return text.slice(i, j);
};

test('the slot is mirrored into a ref on every render', () => {
  assert.match(code, /const actionButtonModeRef = useRef\(actionButtonMode\);\s*actionButtonModeRef\.current = actionButtonMode;/);
});

test('the global shortcut picks Recap or Brainstorm from the ref, not the mount-time closure', () => {
  const listener = between(code, 'window.electronAPI.onGlobalShortcut(({ action }) => {', 'return unsubscribe;');
  const branch = between(listener, "action === 'dynamicAction4'", "action === 'answer'");
  assert.match(branch, /actionButtonModeRef\.current === 'brainstorm'/);
  assert.match(branch, /handlers\.handleBrainstorm\(\)/);
  assert.match(branch, /handlers\.handleRecap\(\)/);
  assert.doesNotMatch(listener, /\bactionButtonMode\b(?!Ref)/, 'a bare read here is the value from the first render');
});

test('the focused keydown handler reads the same ref', () => {
  const handler = between(code, 'const handleKeyDown = (e: KeyboardEvent) => {', 'const handleKeyUp = (e: KeyboardEvent) => {');
  const branch = between(handler, "isShortcutPressed(e, 'dynamicAction4')", "isShortcutPressed(e, 'answer')");
  assert.match(branch, /actionButtonModeRef\.current === 'brainstorm'/);
  assert.doesNotMatch(handler, /\bactionButtonMode\b(?!Ref)/);
});
