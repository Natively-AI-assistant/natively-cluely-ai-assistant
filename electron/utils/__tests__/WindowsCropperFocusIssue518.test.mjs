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

  test('CropperWindowHelper applyOpacityShield uses showInactive on Windows', () => {
    // Extract the win32 branch of applyOpacityShield
    const shieldStart = cropperSource.indexOf('private applyOpacityShield(');
    assert.ok(shieldStart !== -1, 'applyOpacityShield must exist');
    const shieldBody = cropperSource.slice(shieldStart, shieldStart + 1200);

    const win32Arm = shieldBody.slice(
      shieldBody.indexOf("process.platform === 'win32'"),
      shieldBody.indexOf('} else {'),
    );
    assert.ok(win32Arm.length > 0, 'win32 branch in applyOpacityShield not found');

    assert.match(
      win32Arm,
      /showInactive\(\)/,
      'BUG (#518): applyOpacityShield on Windows must use showInactive() instead of activating show().',
    );
  });

  test('CropperWindowHelper applyOpacityShield NEVER calls focus() on Windows', () => {
    const shieldStart = cropperSource.indexOf('private applyOpacityShield(');
    assert.ok(shieldStart !== -1, 'applyOpacityShield must exist');
    const shieldBody = cropperSource.slice(shieldStart, shieldStart + 1200);

    const win32Arm = shieldBody.slice(
      shieldBody.indexOf("process.platform === 'win32'"),
      shieldBody.indexOf('} else {'),
    );
    assert.ok(win32Arm.length > 0, 'win32 branch in applyOpacityShield not found');

    assert.doesNotMatch(
      win32Arm,
      /\.focus\(\)/,
      'BUG (#518): applyOpacityShield on Windows must NOT call focus() — calling focus() deactivates ' +
        'the foreground application and emits browser blur/focus transitions.',
    );
  });

  test('CropperWindowHelper manages global Escape shortcut for non-activating cancellation on Windows', () => {
    assert.match(
      cropperSource,
      /globalShortcut/,
      'CropperWindowHelper must import and use globalShortcut for non-activating Escape cancellation.',
    );
    assert.match(
      cropperSource,
      /registerEscapeShortcut|globalShortcut\.register\(\s*['"]Escape['"]/,
      'CropperWindowHelper must register global Escape shortcut during cropper session.',
    );
    assert.match(
      cropperSource,
      /unregisterEscapeShortcut|globalShortcut\.unregister\(\s*['"]Escape['"]/,
      'CropperWindowHelper must unregister global Escape shortcut when cropper closes or cancels.',
    );
  });
});
