import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceleratorToKeys, matchesAccelerator } from '../shortcutKeys.mjs';

const ev = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test('keycaps: macOS shows Command, Windows shows Ctrl', () => {
  assert.deepEqual(acceleratorToKeys('CommandOrControl+B', 'darwin'), ['⌘', 'B']);
  assert.deepEqual(acceleratorToKeys('CommandOrControl+B', 'win32'), ['Ctrl', 'B']);
  assert.deepEqual(acceleratorToKeys('CommandOrControl+Shift+h', 'darwin'), ['⌘', '⇧', 'H']);
  assert.deepEqual(acceleratorToKeys('CommandOrControl+Shift+h', 'win32'), ['Ctrl', 'Shift', 'H']);
  assert.deepEqual(acceleratorToKeys('', 'win32'), []);
});

test('match: CommandOrControl is metaKey on macOS and ctrlKey on Windows', () => {
  assert.equal(matchesAccelerator(ev('b', { metaKey: true }), 'CommandOrControl+B', 'darwin'), true);
  assert.equal(matchesAccelerator(ev('b', { ctrlKey: true }), 'CommandOrControl+B', 'darwin'), false);
  assert.equal(matchesAccelerator(ev('b', { ctrlKey: true }), 'CommandOrControl+B', 'win32'), true);
  assert.equal(matchesAccelerator(ev('b', { metaKey: true }), 'CommandOrControl+B', 'win32'), false);
});

test('match: modifiers are exact and the key is case-insensitive', () => {
  assert.equal(matchesAccelerator(ev('B', { ctrlKey: true, shiftKey: true }), 'CommandOrControl+B', 'win32'), false);
  assert.equal(matchesAccelerator(ev('B', { ctrlKey: true, shiftKey: true }), 'CommandOrControl+Shift+B', 'win32'), true);
  assert.equal(matchesAccelerator(ev('1', { ctrlKey: true }), 'CommandOrControl+1', 'win32'), true);
  assert.equal(matchesAccelerator(ev('1'), 'CommandOrControl+1', 'win32'), false);
  assert.equal(matchesAccelerator(ev('b', { ctrlKey: true }), '', 'win32'), false);
});

test('match: the physical key counts when the produced character differs', () => {
  // Shift+1 produces '!'; mac Option+B produces '∫'.
  assert.equal(matchesAccelerator(ev('!', { ctrlKey: true, shiftKey: true, code: 'Digit1' }), 'CommandOrControl+Shift+1', 'win32'), true);
  assert.equal(matchesAccelerator(ev('∫', { altKey: true, code: 'KeyB' }), 'Alt+B', 'darwin'), true);
  // ...but the modifiers are still exact, and a different physical key never matches.
  assert.equal(matchesAccelerator(ev('!', { ctrlKey: true, code: 'Digit1' }), 'CommandOrControl+Shift+1', 'win32'), false);
  assert.equal(matchesAccelerator(ev('!', { ctrlKey: true, shiftKey: true, code: 'Digit2' }), 'CommandOrControl+Shift+1', 'win32'), false);
  assert.equal(matchesAccelerator(ev('Enter', { ctrlKey: true, code: 'Enter' }), 'CommandOrControl+B', 'win32'), false);
});
