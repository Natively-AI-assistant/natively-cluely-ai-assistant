// Issue #645 follow-up: a page capture's formula images join the overlay's
// attached images, which hold five (one answer request's worth). They must
// never push out the user's own screenshots, and one capture's must not ride
// along with the next capture's, since both are numbered from 1.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addAttachment, withoutFormulaImages, MAX_ATTACHMENTS } from '../attachmentTray.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shot = (n) => ({ path: `/s/${n}.png`, preview: '' });
const sheet = (capture, n) => ({ path: `/s/formulas-${capture}-${n}.png`, preview: '', formulaCapture: capture });
const paths = (tray) => tray.map((s) => s.path);
const fill = (items) => items.reduce((tray, item) => addAttachment(tray, item), []);

describe('addAttachment', () => {
  test('screenshots alone: the oldest goes past five, as before; a duplicate is ignored', () => {
    const tray = fill([1, 2, 3, 4, 5, 6].map(shot));
    assert.equal(MAX_ATTACHMENTS, 5);
    assert.deepEqual(paths(tray), [2, 3, 4, 5, 6].map((n) => `/s/${n}.png`));
    assert.equal(addAttachment(tray, shot(4)), tray);
  });

  test('formula images take only the places left', () => {
    const tray = fill([shot(1), shot(2), shot(3), shot(4), sheet('a', 1), sheet('a', 2)]);
    assert.deepEqual(paths(tray), ['/s/1.png', '/s/2.png', '/s/3.png', '/s/4.png', '/s/formulas-a-1.png']);
    const full = fill([1, 2, 3, 4, 5].map(shot));
    assert.deepEqual(paths(addAttachment(full, sheet('a', 1))), paths(full));
  });

  test('a screenshot taken later pushes out a formula image, the last one first', () => {
    const tray = fill([shot(1), shot(2), sheet('a', 1), sheet('a', 2), sheet('a', 3), shot(3)]);
    assert.deepEqual(paths(tray), ['/s/1.png', '/s/2.png', '/s/formulas-a-1.png', '/s/formulas-a-2.png', '/s/3.png']);
  });

  test('a new capture\'s formula images replace the earlier capture\'s', () => {
    const tray = fill([shot(1), sheet('a', 1), sheet('a', 2), sheet('b', 1)]);
    assert.deepEqual(paths(tray), ['/s/1.png', '/s/formulas-b-1.png']);
  });

  test('a new page capture drops the earlier capture\'s formula images, even with none of its own', () => {
    const tray = fill([shot(1), sheet('a', 1), shot(2), sheet('a', 2)]);
    assert.deepEqual(paths(withoutFormulaImages(tray)), ['/s/1.png', '/s/2.png']);
    const plain = fill([shot(1), shot(2)]);
    assert.equal(withoutFormulaImages(plain), plain, 'unchanged, so no re-render');
  });

  test('the overlay adds every attached image through it, and a page capture clears old formula images', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../components/NativelyInterface.tsx'), 'utf8');
    assert.match(src, /import \{ addAttachment, revealsOverlay, withoutFormulaImages \} from '\.\.\/lib\/attachmentTray\.mjs';/);
    assert.equal(src.match(/addAttachment\(/g).length, 3);
    assert.doesNotMatch(src, /\]\.slice\(-5\)|updated\.slice\(-5\)/);
    const handler = src.slice(src.indexOf('window.electronAPI?.onDomContextReceived?.('));
    assert.match(handler.slice(0, 1500), /setAttachedContext\(\(prev\) => withoutFormulaImages\(prev\)\);/);
  });
});
