import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_STEALTH_PASTE_CHARS, normalizePastedText } from '../stealthPasteText.mjs';

// Pure module, so both platform branches' behaviour is exercised from either
// OS. Only Windows reaches this code at runtime (macOS pastes through
// Chromium's own DOM handler), but the function itself is platform-free and is
// tested as such.

test('flattens every newline flavour and tabs to a single space', () => {
  assert.equal(normalizePastedText('hello\r\nworld'), 'hello world');
  assert.equal(normalizePastedText('hello\nworld'), 'hello world');
  assert.equal(normalizePastedText('hello\rworld'), 'hello world');
  assert.equal(normalizePastedText('hello\tworld'), 'hello world');
});

test('collapses a run of line breaks into ONE space, not one per break', () => {
  // A paragraph break pasted from a doc is \n\n. Emitting two spaces would
  // show up as a visible double gap mid-question.
  assert.equal(normalizePastedText('a\n\n\nb'), 'a b');
  assert.equal(normalizePastedText('a\r\n\r\nb'), 'a b');
  assert.equal(normalizePastedText('a\n\t\nb'), 'a b');
});

test('strips C0/C1 control characters, NUL included', () => {
  // NUL truncates strings in some downstream consumers; the rest render as
  // nothing or as tofu. None of them are typeable, so none survive.
  assert.equal(normalizePastedText('a\u0000b'), 'ab');
  assert.equal(normalizePastedText('a\u0007b\u001Fc'), 'abc');
  assert.equal(normalizePastedText('a\u007Fb\u009Fc'), 'abc');
  // Stripped, NOT turned into spaces — only line breaks and tabs earn a space.
  assert.equal(normalizePastedText('ab\u0000'), 'ab');
});

test('leaves ordinary text — including unicode and emoji — untouched', () => {
  assert.equal(normalizePastedText('Wie geht es dir?'), 'Wie geht es dir?');
  assert.equal(normalizePastedText('café 日本語 🚀'), 'café 日本語 🚀');
  // Interior spacing is the user's, not ours to normalise.
  assert.equal(normalizePastedText('a  b'), 'a  b');
});

test('an all-whitespace clipboard yields empty so the caller sends nothing', () => {
  // Otherwise Ctrl+V on a blank clipboard would silently append a space to the
  // user's question.
  assert.equal(normalizePastedText('   '), '');
  assert.equal(normalizePastedText('\n\n'), '');
  assert.equal(normalizePastedText('\r\n\t '), '');
  assert.equal(normalizePastedText('\u0000'), '');
});

test('empty, null and undefined are all empty string, never a throw', () => {
  // handleStealthPaste calls this with whatever clipboard.readText() returned;
  // an image-only clipboard yields ''.
  assert.equal(normalizePastedText(''), '');
  assert.equal(normalizePastedText(null), '');
  assert.equal(normalizePastedText(undefined), '');
});

test('caps the paste so a huge clipboard cannot stall the overlay renderer', () => {
  const huge = 'x'.repeat(MAX_STEALTH_PASTE_CHARS * 3);
  assert.equal(normalizePastedText(huge).length, MAX_STEALTH_PASTE_CHARS);
  // Anything at or below the cap is passed through whole.
  const atCap = 'y'.repeat(MAX_STEALTH_PASTE_CHARS);
  assert.equal(normalizePastedText(atCap).length, MAX_STEALTH_PASTE_CHARS);
});

test('the cap is applied AFTER flattening, so it measures what is actually typed', () => {
  // If the slice ran first, control characters and newlines would eat into the
  // budget and the user would get less than the cap's worth of real text.
  const withBreaks = ('word\n'.repeat(MAX_STEALTH_PASTE_CHARS)).slice(0);
  assert.equal(normalizePastedText(withBreaks).length, MAX_STEALTH_PASTE_CHARS);
});

test('the result can never contain a newline or tab the input cannot render', () => {
  const messy = 'one\r\ntwo\tthree\nfour five';
  const out = normalizePastedText(messy);
  assert.ok(!/[\r\n\t]/.test(out), `flattened text still holds a break: ${JSON.stringify(out)}`);
  assert.equal(out, 'one two three four five');
});
