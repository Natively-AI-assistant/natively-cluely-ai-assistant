import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDIT_MODIFIER_FLAGS, editShortcutLetter, pastedText, editCommand, paste, typed, backspace, WORD_DELETE_FLAGS, isWordDelete, deleteWord } from '../stealthEdit.mjs';

const CMD = 1 << 20, OPT = 1 << 19, CTRL = 1 << 18, SHIFT = 1 << 17;
const key = (chars, flags, isKeyDown = true) => ({ chars, flags, isKeyDown });
const BACKSPACE = 51;

// Ctrl/Cmd+V/A/C/X used to pass through to the foreground app while typing in
// the overlay, so Ctrl+V pasted into the meeting app. The hooks now deliver them.
test('recognises the four shortcuts under Cmd (macOS) and Ctrl (Windows)', () => {
  assert.equal(EDIT_MODIFIER_FLAGS, CMD | CTRL);
  for (const c of ['v', 'a', 'c', 'x', 'V']) {
    assert.equal(editShortcutLetter(key(c, CMD)), c.toLowerCase());
    assert.equal(editShortcutLetter(key(c, CTRL | SHIFT)), c.toLowerCase());
  }
});

test('plain typing, other letters and key-ups are not shortcuts', () => {
  assert.equal(editShortcutLetter(key('v', 0)), null, 'plain v is text');
  assert.equal(editShortcutLetter(key('v', SHIFT)), null, 'Shift alone is text');
  assert.equal(editShortcutLetter(key('z', CMD)), null);
  assert.equal(editShortcutLetter(key('v', CMD, false)), null, 'key-up');
  assert.equal(editShortcutLetter(null), null);
});

test('select all, then copy / cut act on the whole text', () => {
  const s = { value: 'hello', allSelected: false };
  assert.deepEqual(editCommand(s, 'c'), s, 'nothing selected: copy does nothing');
  const sel = editCommand(s, 'a');
  assert.deepEqual(sel, { value: 'hello', allSelected: true });
  assert.deepEqual(editCommand(sel, 'c'), { value: 'hello', allSelected: true, copy: 'hello' });
  assert.deepEqual(editCommand(sel, 'x'), { value: '', allSelected: false, copy: 'hello' });
  assert.deepEqual(editCommand({ value: '', allSelected: false }, 'a'), { value: '', allSelected: false }, 'empty box selects nothing');
});

test('paste appends, or replaces a selection; line breaks become spaces', () => {
  assert.deepEqual(paste({ value: 'ask ', allSelected: false }, 'this'), { value: 'ask this', allSelected: false });
  assert.deepEqual(paste({ value: 'old', allSelected: true }, 'new'), { value: 'new', allSelected: false });
  assert.equal(pastedText('a\r\nb\nc\td'), 'a b c d');
  assert.deepEqual(paste({ value: 'keep', allSelected: true }, ''), { value: 'keep', allSelected: true }, 'empty clipboard changes nothing');
});

test('typing and Backspace replace or clear a selection', () => {
  assert.deepEqual(typed({ value: 'old', allSelected: true }, 'n'), { value: 'n', allSelected: false });
  assert.deepEqual(typed({ value: 'ol', allSelected: false }, 'd'), { value: 'old', allSelected: false });
  assert.deepEqual(backspace({ value: 'old', allSelected: true }), { value: '', allSelected: false });
  assert.deepEqual(backspace({ value: 'old', allSelected: false }), { value: 'ol', allSelected: false });
});

// Word-delete: Ctrl+Backspace / Ctrl+Delete (Windows) or Option+Backspace (macOS).
// The hooks deliver these as the Backspace keyCode (51) tagged with the modifier.
test('isWordDelete only fires on a Backspace key-down carrying Ctrl or Option', () => {
  assert.equal(WORD_DELETE_FLAGS, CTRL | OPT);
  assert.equal(isWordDelete({ keyCode: BACKSPACE, flags: CTRL, isKeyDown: true }), true, 'Ctrl+Backspace (Windows)');
  assert.equal(isWordDelete({ keyCode: BACKSPACE, flags: OPT, isKeyDown: true }), true, 'Option+Backspace (macOS)');
  assert.equal(isWordDelete({ keyCode: BACKSPACE, flags: 0, isKeyDown: true }), false, 'plain Backspace is one-char');
  assert.equal(isWordDelete({ keyCode: BACKSPACE, flags: SHIFT, isKeyDown: true }), false, 'Shift+Backspace is one-char');
  assert.equal(isWordDelete({ keyCode: BACKSPACE, flags: CMD, isKeyDown: true }), false, 'Cmd+Backspace is NOT word-delete (would be line-delete)');
  assert.equal(isWordDelete({ keyCode: 0, flags: CTRL, isKeyDown: true }), false, 'only the Backspace keyCode counts');
  assert.equal(isWordDelete({ keyCode: BACKSPACE, flags: CTRL, isKeyDown: false }), false, 'key-up ignored');
  assert.equal(isWordDelete(null), false);
});

test('deleteWord removes the last word and the whitespace before it', () => {
  assert.deepEqual(deleteWord({ value: 'hello world', allSelected: false }), { value: 'hello', allSelected: false });
  assert.deepEqual(deleteWord({ value: 'hello world ', allSelected: false }), { value: 'hello', allSelected: false }, 'trailing space too');
  assert.deepEqual(deleteWord({ value: 'one two three', allSelected: false }), { value: 'one two', allSelected: false });
  assert.deepEqual(deleteWord({ value: 'solo', allSelected: false }), { value: '', allSelected: false }, 'single word clears');
  assert.deepEqual(deleteWord({ value: '', allSelected: false }), { value: '', allSelected: false }, 'empty stays empty');
  // repeated presses chew back word by word
  let s = { value: 'the quick brown fox', allSelected: false };
  s = deleteWord(s); assert.equal(s.value, 'the quick brown');
  s = deleteWord(s); assert.equal(s.value, 'the quick');
  s = deleteWord(s); assert.equal(s.value, 'the');
  s = deleteWord(s); assert.equal(s.value, '');
  // a selection clears everything, same as Backspace on a selection
  assert.deepEqual(deleteWord({ value: 'hello world', allSelected: true }), { value: '', allSelected: false });
});
