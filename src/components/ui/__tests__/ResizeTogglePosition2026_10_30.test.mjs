// The resize toggle sits 4px inside its own 36px window, placed by
// position: fixed and its top/right offsets. Lavender gives every
// .overlay-resize-toggle-surface `position: relative` (the top pill's wrapper
// needs it for its gloss), which beat the `fixed` class: the offsets then
// nudged the button 4px left and the window cut its left side off, so the
// expand/contract button read as a squashed blob (the owner, 2026-10-30).
// `fixed` is inline now, where no theme rule reaches.
//
// Source reads only. Rendered in headless Chrome in a 36px box: every style,
// both icons, the button sits at 4px / 4px, and at the hover grow (×1.06)
// it keeps 3.16px each side. The window is the same on macOS and Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.resolve(here, p), 'utf8');
const toggle = read('../ResizeToggle.tsx');
const aux = read('../../OverlayAuxWindows.tsx');
const lavender = read('../../../overlayLavenderTheme.css');

test('the button pins position: fixed inline, beside its offsets', () => {
  assert.match(toggle, /position: 'fixed',\s*top: topOffset \?\? 12,\s*right: rightOffset \?\? 12,/);
  // after the spread, so appearance.shellStyle cannot override it either
  assert.ok(toggle.indexOf("position: 'fixed'") > toggle.indexOf('...appearance.shellStyle'));
});

test('why: Lavender still sets relative on the shared class', () => {
  assert.match(lavender, /\[data-interface-theme="lavender"\] \.overlay-resize-toggle-surface \{\s*position: relative;/);
});

test('its window centres the 28px button with 4px on every side', () => {
  assert.match(aux, /<ResizeToggle[\s\S]{0,300}topOffset=\{4\}\s*rightOffset=\{4\}/);
  assert.match(toggle, /h-\[28px\] w-\[28px\]/);
});

// Hiding or showing the panel (Cmd+B, the pill's chevron) fades the panel out
// in 220ms, but main hides the windows only when the overlay asks, 400ms
// later. The pill fades with the panel on a wrapper; the button did not and
// stayed fully drawn until its window went (the owner, 2026-10-30). It now
// fades on the panel's own timings.
test('the button fades with the panel on its timings, out 220ms and in 340ms', () => {
  const win = aux.slice(aux.indexOf('export function OverlayToggleWindow'));
  assert.match(win, /opacity: state\.expanded === false \? 0 : 1,/);
  assert.match(win, /pointerEvents: state\.expanded === false \? 'none' : 'auto',/);
  assert.match(win, /\? 'opacity 0\.22s cubic-bezier\(0\.32, 0, 0\.67, 0\)'\s*: 'opacity 0\.34s cubic-bezier\(0\.23, 1, 0\.32, 1\)'/);
  // the panel's own fade, which these mirror
  const overlay = read('../../NativelyInterface.tsx');
  assert.match(overlay, /transition: \{ duration: 0\.34, ease: \[0\.23, 1, 0\.32, 1\] \}/);
  assert.match(overlay, /transition: \{ duration: 0\.22, ease: \[0\.32, 0, 0\.67, 0\] \}/);
  assert.match(overlay, /setTimeout\(\(\) => window\.electronAPI\.hideWindow\(\), 400\)/);
});
