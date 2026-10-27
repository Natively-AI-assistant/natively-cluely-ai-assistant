import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { imageFilesFromDrop, overlayPasteAction } from '../overlayImageDrop.mjs';

/** A ClipboardEvent.clipboardData stand-in: text by type, items, files. */
function clipboard({ text = '', items = [], files = [] } = {}) {
  return { getData: (type) => (type === 'text/plain' ? text : ''), items: items.map((type) => ({ type })), files };
}

describe('imageFilesFromDrop (issue #351)', () => {
  test('keeps PNG, JPEG and WebP files, in order', () => {
    const a = { name: 'a.png' };
    const b = { name: 'b.txt' };
    const c = { name: 'C.WEBP' };
    const d = { name: 'd.jpeg' };
    const e = { name: 'notes.pdf' };
    assert.deepEqual(imageFilesFromDrop([a, b, c, d, e]), [a, c, d]);
  });

  test('tolerates empty input and nameless entries', () => {
    assert.deepEqual(imageFilesFromDrop(null), []);
    assert.deepEqual(imageFilesFromDrop([]), []);
    assert.deepEqual(imageFilesFromDrop([{}, { name: 42 }]), []);
  });
});

describe('overlayPasteAction (issue #351)', () => {
  test('plain text pastes natively', () => {
    assert.deepEqual(overlayPasteAction(clipboard({ text: 'hello', items: ['text/plain'] })), { kind: 'native' });
  });

  test('text beside an image still pastes as text (Excel, Word, PowerPoint)', () => {
    const data = clipboard({ text: 'Q3 revenue', items: ['text/plain', 'image/png'], files: [{ name: 'image.png' }] });
    assert.deepEqual(overlayPasteAction(data), { kind: 'native' });
  });

  test('an image alone is attached', () => {
    assert.deepEqual(overlayPasteAction(clipboard({ items: ['image/png'] })), { kind: 'image', files: [] });
  });

  test('a copied image file is attached, its files kept for the Explorer fallback', () => {
    const shot = { name: 'shot.png' };
    const data = clipboard({ items: ['image/png'], files: [shot, { name: 'readme.txt' }] });
    assert.deepEqual(overlayPasteAction(data), { kind: 'image', files: [shot] });
  });

  test('a browser image copy (HTML + image, no plain text) is attached', () => {
    assert.equal(overlayPasteAction(clipboard({ items: ['text/html', 'image/png'] })).kind, 'image');
  });

  test('nothing pasteable leaves the paste alone', () => {
    assert.deepEqual(overlayPasteAction(clipboard()), { kind: 'native' });
    assert.deepEqual(overlayPasteAction(clipboard({ items: ['text/html'] })), { kind: 'native' });
    assert.deepEqual(overlayPasteAction(null), { kind: 'native' });
  });
});
