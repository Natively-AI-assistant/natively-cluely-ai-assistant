// electron/utils/__tests__/WindowsCropperFocusIssue518.test.mjs
//
// Regression test for Issue #518:
// Selective Screenshot focuses the Windows cropper and exposes browser blur/focus events.
//
// The root causes:
// 1. CropperWindowHelper did not place this.cropperWindow under attachNoActivate().
//    Unlike the main overlay, settings popover, and model selector, clicking or
//    dragging the cropper would activate Natively on Windows and steal focus.
// 2. applyOpacityShield() on Windows called cropperWindow.show() and then unconditionally
//    called cropperWindow.focus() after the opacity timeout, causing the foreground
//    page (e.g. Chrome / Zoom) to receive a blur event.
// 3. To allow Esc key to cancel the cropper without requiring keyboard focus,
//    CropperWindowHelper registers a temporary global shortcut for Escape on Windows
//    while waiting for selection, unregistering it on completion or cancellation.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('Issue #518: Windows selective screenshot focus policy', () => {
  const cropperSource = read('electron/CropperWindowHelper.ts');

  test('CropperWindowHelper places cropperWindow under attachNoActivate at creation', () => {
    assert.match(
      cropperSource,
      /attachNoActivate\(this\.cropperWindow\)/,
      'BUG (#518): CropperWindowHelper must call attachNoActivate(this.cropperWindow) right after ' +
        'creating this.cropperWindow so WS_EX_NOACTIVATE is applied on Windows.',
    );
  });

  // Source between two markers, with // comments stripped so a comment that
  // says "do NOT call focus()" can neither satisfy nor trip an assertion.
  const between = (from, to) => {
    const s = cropperSource.indexOf(from);
    const e = cropperSource.indexOf(to, s + from.length);
    assert.ok(s !== -1 && e !== -1, `markers not found: ${from} … ${to}`);
    return cropperSource.slice(s, e).replace(/\/\/.*$/gm, '');
  };
  // The win32 arm ends at the OUTER else. The first `} else {` inside it is the
  // show() fallback for stubs without showInactive — slicing to that one left
  // the opacity timer (where the #518 focus() lived) outside the assertion.
  const shield = between('private applyOpacityShield(', 'private applyCombinedBounds(');
  const outerElse = shield.search(/\}\s*else\s*\{\s*this\.cropperWindow\.setContentProtection/);
  const win32Arm = shield.slice(shield.indexOf("process.platform === 'win32'"), outerElse);
  const otherArm = shield.slice(outerElse);

  test('applyOpacityShield on Windows shows inactive, raises without activating, never focuses', () => {
    assert.ok(outerElse > 0, 'applyOpacityShield must keep its non-win32 arm');
    assert.match(win32Arm, /\.showInactive\(\)/, 'BUG (#518): Windows must use showInactive(), not show().');
    assert.match(win32Arm, /\.moveTop\(\)/, 'showInactive keeps the stale z-order slot; moveTop() must raise the cropper.');
    assert.doesNotMatch(win32Arm, /\.focus\(\)/, 'BUG (#518): focus() on Windows blurs the foreground app.');
  });

  test('applyOpacityShield keeps the macOS/Linux arm unchanged (show + focus)', () => {
    assert.match(otherArm, /\.show\(\)/);
    assert.match(otherArm, /\.focus\(\)/);
  });

  test('the global Escape is win32-only, armed by showCropper, and released on every exit path', () => {
    assert.match(cropperSource, /registerEscapeShortcut\(\): void \{\s*if \(process\.platform !== 'win32'\) return;/);
    assert.match(between('public async showCropper(', 'return new Promise('), /this\.registerEscapeShortcut\(\)/);
    for (const [from, to] of [
      ['private resolveCurrentSelection(', 'private rejectCurrentSelection('],
      ['private rejectCurrentSelection(', 'public setContentProtection('],
      ['private hideOrClose(', 'public closeWindow('],
      ['public dispose(', 'Clear opacity timeout'],
      ["on('closed'", 'before-input-event'],
      ['this.beforeQuitHandler = () => {', "app.on('before-quit'"],
    ]) {
      assert.match(between(from, to), /this\.unregisterEscapeShortcut\(\)/, `${from} must release the global Escape`);
    }
  });
});
