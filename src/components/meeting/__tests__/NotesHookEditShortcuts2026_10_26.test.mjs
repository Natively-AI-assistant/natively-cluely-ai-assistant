// The hooks deliver Ctrl/Cmd+V/A/C/X as their letter tagged with the modifier,
// and word delete as Backspace tagged with Ctrl (Windows) or Option (macOS)
// (PR #633). The notes window types through the same hook (2026-10-20), and it
// typed those letters as text: Ctrl+V put a "v" in the note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyTypedKeyAtEnd } from '../notesView.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const CMD = 1 << 20, OPT = 1 << 19, CTRL = 1 << 18, SHIFT = 1 << 17;
const key = (keyCode, chars = '', flags = 0, isKeyDown = true) => ({ keyCode, chars, flags, isKeyDown });

test('a field never types an editing shortcut as its letter', () => {
  // Windows delivers keyCode 0 with the letter; macOS the real keycode (9 = V).
  assert.equal(applyTypedKeyAtEnd('hello ', key(0, 'v', CTRL)), null);
  assert.equal(applyTypedKeyAtEnd('hello ', key(9, 'v', CMD)), null);
  for (const c of ['a', 'c', 'x']) {
    assert.equal(applyTypedKeyAtEnd('hello ', key(0, c, CTRL)), null, `Ctrl+${c}`);
    assert.equal(applyTypedKeyAtEnd('hello ', key(0, c, CMD)), null, `Cmd+${c}`);
  }
  assert.equal(applyTypedKeyAtEnd('hello ', key(9, 'v')), 'hello v', 'plain v is still text');
  assert.equal(applyTypedKeyAtEnd('hello ', key(9, 'V', SHIFT)), 'hello V', 'Shift alone is still text');
});

test('word delete in a field takes the last word; plain Backspace one character', () => {
  assert.equal(applyTypedKeyAtEnd('find this word', key(51, '', CTRL)), 'find this');
  assert.equal(applyTypedKeyAtEnd('find this word', key(51, '', OPT)), 'find this');
  assert.equal(applyTypedKeyAtEnd('find this word', key(51, '', CMD)), 'find this wor', 'Cmd+Backspace is not word delete');
  assert.equal(applyTypedKeyAtEnd('find this word', key(51)), 'find this wor');
  assert.equal(applyTypedKeyAtEnd('', key(51, '', CTRL)), null);
});

test('the notes window runs the shortcuts before any key is typed', () => {
  const page = read('src/components/NotesWindow.tsx');
  const handler = page.slice(page.indexOf('api.onStealthKeyCaptured('));
  const letterAt = handler.indexOf('editShortcutLetter(ev)');
  assert.ok(letterAt > 0, 'checks for an editing shortcut');
  assert.ok(letterAt < handler.indexOf('editorRef.current?.typeKey(ev)'), 'before the editor types the key');
  assert.ok(letterAt < handler.indexOf('applyTypedKeyAtEnd(tf.get(), ev, allSelected)'), 'before a field types the key');
  assert.match(handler, /stealthReadClipboard\?\.\(\)/);
  assert.match(handler, /editorRef\.current\?\.pasteText\(text\)/);
  assert.match(handler, /stealthWriteClipboard\?\.\(copied\)/);
});

test('the editor pastes through ProseMirror and acts on its drawn selection', () => {
  const editor = read('src/components/notes/NotesEditor.tsx');
  assert.match(editor, /editor\.view\.pasteText\(text\)/, 'a real paste: lines become paragraphs, no HTML parsing');
  assert.match(editor, /tr\.deleteSelection\(\)/);
  assert.match(editor, /isWordDelete\(key\)/);
});

test('main gives the clipboard only to a running session, and only to the window that started it', () => {
  const main = read('electron/main.ts');
  assert.match(main, /const typingSessionOf = \(event: any\): boolean => \{\s*const target = typingTargetOf\(event\);\s*return !!target && stealth\.isActive\(\) && stealth\.getTarget\(\) === target;/);
  assert.match(main, /'stealth-edit:read-clipboard', \(event: any\) =>\s*typingSessionOf\(event\) \? clipboard\.readText\(\) : ''/);
  assert.match(main, /'stealth-edit:write-clipboard', \(event: any, text: unknown\) => \{\s*if \(typingSessionOf\(event\) && typeof text === 'string'\) clipboard\.writeText\(text\);/);
});

test('select all is a text selection, so a key typed over it replaces it once', () => {
  const editor = read('src/components/notes/NotesEditor.tsx');
  assert.match(editor, /TextSelection\.between\(Selection\.atStart\(doc\)\.\$from, Selection\.atEnd\(doc\)\.\$to\)/);
  assert.doesNotMatch(editor, /commands\.selectAll\(\)/, 'an AllSelection stays "everything" after each edit');
});

test('word delete measures inline atoms as one character each', () => {
  const editor = read('src/components/notes/NotesEditor.tsx');
  assert.match(editor, /textBetween\(0, selection\.\$from\.parentOffset, undefined, '\\n'\)/);
});

test('a late paste lands only in a live session, on top of what was typed meanwhile', () => {
  const overlay = read('src/components/NativelyInterface.tsx');
  assert.match(overlay, /if \(!stealthTapActiveRef\.current \|\| escSuppressUntilNextActive \|\| !pastedText\(text\)\) return;/);
  assert.match(overlay, /setInputValue\(\(prev\) => paste\(\{ value: prev, allSelected \}, text \?\? ''\)\.value\)/);
  const page = read('src/components/NotesWindow.tsx');
  assert.match(page, /if \(!text \|\| !hookTypingRef\.current \|\| fieldRef\.current !== f\) return;/);
});

test('a select-all in a field is replaced by the next key, cleared by Backspace', () => {
  assert.equal(applyTypedKeyAtEnd('old query', key(0, 'n'), true), 'n');
  assert.equal(applyTypedKeyAtEnd('old query', key(51), true), '');
  assert.equal(applyTypedKeyAtEnd('old query', key(51, '', OPT), true), '');
  assert.equal(applyTypedKeyAtEnd('old query', key(0, 'n', 0, false), true), null, 'a key-up changes nothing');
  assert.equal(applyTypedKeyAtEnd('old query', key(0, 'c', CMD), true), null, 'a shortcut is still not text');
  assert.equal(applyTypedKeyAtEnd('old query', key(0, 'n')), 'old queryn', 'no selection: appended as before');
});

test('the one-line fields run select all, copy and cut on their whole value', () => {
  const page = read('src/components/NotesWindow.tsx');
  const handler = page.slice(page.indexOf('api.onStealthKeyCaptured('));
  assert.match(handler, /const next = editCommand\(\{ value: tf\.get\(\), allSelected: fieldSelected\(f\) \}, letter\);/);
  assert.match(handler, /if \(next\.copy !== undefined\) api\.stealthWriteClipboard\?\.\(next\.copy\)/);
  assert.match(handler, /setFieldSel\(next\.allSelected \? f : null\);/);
  assert.match(handler, /tf\.set\(paste\(\{ value: tf\.get\(\), allSelected \}, text\)\.value\);/, 'a paste replaces the selection');
  // The selection covers a value: it ends with the session, a field change or any other edit.
  assert.match(page, /if \(sel && \(!hookTyping \|\| field !== sel\.field \|\| !fieldSelected\(sel\.field\)\)\) setFieldSel\(null\);/);
  assert.match(page, /return !!sel && sel\.field === f && textFields\.current\[f\]\?\.get\(\) === sel\.value;/);
  // Drawn, since the unfocused input's own selection does not paint.
  assert.match(page, /input\.dataset\.hookSelected = 'true';/);
  assert.match(read('src/index.css'), /\.notepad input\[data-hook-selected="true"\] \{ background-image: linear-gradient\(var\(--np-selection\), var\(--np-selection\)\);/);
});
