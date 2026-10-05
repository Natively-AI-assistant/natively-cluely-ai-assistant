// The model picker must be raised above the click catcher when it opens.
//
// While a dropdown is open over the meeting overlay, WindowHelper shows a
// full-display transparent "catcher" window so a click anywhere outside
// Natively closes the dropdown. The catcher has to sit BELOW Natively's own
// windows, or it takes their clicks too: a click on a model row would then
// only close the picker, and no model would be chosen.
//
// On macOS that order is a window level (the catcher is 'floating' -1). On
// Windows there is no such level, so syncPopoverCatcher re-raises each
// Natively window with moveTop() after showing the catcher, and it skips
// windows that are not visible (moveTop would show them).
//
// The settings dropdown shows itself and THEN reports that it is open, so it
// is visible when that loop runs. The model picker reported first and showed
// itself afterwards, so the loop skipped the one window it was opening for.
// Whether the picker then ended up above the catcher was left to whatever
// z-order slot Windows had kept for it while hidden.
//
// Source-order assertions, in the style of WindowsCropperFocusIssue518: the
// z-order itself can only be observed on a physical Windows machine, and has
// not been: on macOS the picker was seen in front of the catcher with this
// order (2026-10-05, dev build), which the window level already guaranteed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { methodBody, readSource } from './_sourceSlices.mjs';

const lastIndexOfAny = (text, needles) => Math.max(...needles.map((n) => text.lastIndexOf(n)));

test('the catcher only re-raises windows that are already visible', () => {
  const sync = methodBody(readSource('electron/WindowHelper.ts'), 'syncPopoverCatcher');
  assert.match(sync, /modelSelectorWindowHelper\?\.getWindow\?\.\(\)/, 'the picker is one of the windows it raises');
  assert.match(sync, /w\.isVisible\(\)\)\s*\{\s*try\s*\{\s*w\.moveTop\(\)/, 'and it raises only visible ones');
});

test('the model picker reports itself open only after it is on screen', () => {
  const show = methodBody(readSource('electron/ModelSelectorWindowHelper.ts'), 'showWindow');
  const reported = show.indexOf("notifyOverlayPopover?.('model'");
  const shown = lastIndexOfAny(show, ['this.window.show()', 'this.window.showInactive()']);
  assert.ok(reported !== -1 && shown !== -1);
  assert.ok(
    reported > shown,
    'reporting before show() runs the raise loop while the picker is still hidden, so it is skipped',
  );
});

test('both show branches (the Windows opacity shield and the plain one) are covered by the one report', () => {
  const show = methodBody(readSource('electron/ModelSelectorWindowHelper.ts'), 'showWindow');
  assert.equal(show.split("notifyOverlayPopover?.('model'").length - 1, 1);
  const shield = show.indexOf("process.platform === 'win32' && this.contentProtection");
  assert.ok(shield !== -1 && show.indexOf("notifyOverlayPopover?.('model'") > shield);
});

test('the settings dropdown already works this way', () => {
  const show = methodBody(readSource('electron/SettingsWindowHelper.ts'), 'showWindow');
  const reported = show.indexOf('this.emitVisibilityChange(true)');
  const shown = lastIndexOfAny(show, ['this.settingsWindow.show()', 'this.settingsWindow.showInactive()']);
  assert.ok(reported > shown && shown !== -1);
});
