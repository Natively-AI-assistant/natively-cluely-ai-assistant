import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDIT_MODIFIER_FLAGS, editShortcutLetter, pastedText, editCommand, paste, typed, backspace } from '../stealthEdit.mjs';

const CMD = 1 << 20, CTRL = 1 << 18, SHIFT = 1 << 17;
const key = (chars, flags, isKeyDown = true) => ({ chars, flags, isKeyDown });

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
