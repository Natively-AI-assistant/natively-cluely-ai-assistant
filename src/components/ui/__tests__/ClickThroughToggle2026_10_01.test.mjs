// The overlay's click-through button opens into a pill carrying the exit
// hotkey, then settles to the bare accent icon — no bar, no dot (owner's
// call, 2026-10-01). Source-contract test in the repo's style: the component
// renders through framer/lucide in the real app, so what is pinned here is
// the shape that the mocks agreed on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.resolve(here, p), 'utf8');
const component = read('../ClickThroughToggle.tsx');
const overlay = read('../../NativelyInterface.tsx');
const css = read('../../../index.css');

test('the pill opens on off→on, settles after 3 s, closes at once on off', () => {
  assert.match(component, /const turnedOn = on && !wasOn\.current;/);
  assert.match(component, /setPhase\('expanded'\);\s*const timer = setTimeout\(\(\) => setPhase\('settled'\), settleMs\);/);
  assert.match(component, /settleMs = 3000/);
  assert.match(component, /if \(!on\) \{\s*setPhase\('off'\);/);
});

test('keys first, then the exit words; no bar, no dot', () => {
  const label = component.slice(component.indexOf('<span ref={labelRef}'), component.indexOf('</span>\n    </button>'));
  assert.ok(label.indexOf('ov-ct-key') < label.indexOf('ov-ct-exit'), 'caps come before "to exit"');
  // the mechanisms the earlier variants used, not the words (the comments name them)
  assert.doesNotMatch(component, /animate-pulse|progressbar|scaleX|drain/i);
  assert.doesNotMatch(css.slice(css.indexOf('.ov-ct {')), /\.ov-ct[^{]*::after/, 'no ::after dot on the pill');
});

test('the pill is sized from its label, not a fixed width', () => {
  assert.match(component, /setLabelWidth\(Math\.ceil\(el\.getBoundingClientRect\(\)\.width\)\)/);
  assert.match(component, /'--ov-ct-w'/);
  assert.match(css, /\.ov-ct\[data-phase="expanded"\] \{\s*width: var\(--ov-ct-w\);/);
});

// Solid since 2026-10-30 (the owner); it was dashed, for "passes through".
test('the icon is the solid cursor', () => {
  assert.match(component, /<MousePointer2 /);
  assert.doesNotMatch(component, /strokeDasharray/);
});

test('"to exit" takes the secondary text token; edges soften on the light shell only', () => {
  assert.match(css, /\.ov-ct-exit \{\s*color: var\(--overlay-text-secondary\);/);
  assert.match(css, /\[data-theme='light'\] \.ov-ct \{\s*--ov-ct-pill-bg: 9%;\s*--ov-ct-pill-line: 20%;/);
  // glass and modern are dark panels under the light theme too, so they take the dark edges back
  assert.match(css, /\[data-theme='light'\] \[data-interface-theme="liquid-glass"\] \.ov-ct,\s*\[data-theme='light'\] \[data-interface-theme="modern"\] \.ov-ct \{\s*--ov-ct-pill-bg: 16%;/);
});

test('the overlay renders it with the live binding and the toolbar\'s bare-icon idle state', () => {
  assert.match(overlay, /<ClickThroughToggle\s+on=\{isMousePassthrough\}/);
  assert.match(overlay, /keys=\{shortcuts\.toggleMousePassthrough \|\| \[getModifierSymbol\('cmd'\), 'Shift', 'B'\]\}/);
  assert.match(overlay, /exitLabel=\{t\('to exit'\)\}/);
  assert.match(component, /className="ov-ct [^"]*overlay-bare-icon"/);
});

test('liquid glass takes the dark accent under the light theme, like modern', () => {
  const glassLight = css.slice(css.indexOf(`[data-theme='light'] [data-interface-theme="liquid-glass"] {`));
  const block = glassLight.slice(0, glassLight.indexOf('\n}\n'));
  assert.match(block, /--accent-primary: var\(--periwinkle-300\);/);
});

// Motion (transitions polish, 2026-10-30): the pill opens in 250ms and closes
// in 150ms on the smooth-out curve, its keys and "to exit" arrive 40ms apart,
// the cursor pops on turning on, and reduced motion turns all of it off. The
// list lives in --ov-ct-motion so a theme that restyles .interaction-base can
// hand it back: Lavender's own list, at the same weight and loaded later, had
// dropped width and padding, and its pill snapped open and shut.
const lavender = read('../../../overlayLavenderTheme.css');

test('the pill opens in 250ms and closes in 150ms, both on the smooth-out curve', () => {
  const close = css.match(/\.ov-ct \{\s*--ov-ct-motion:([^;]+);/);
  const open = css.match(/\.ov-ct\[data-phase="expanded"\] \{\s*--ov-ct-motion:([^;]+);/);
  assert.ok(close && open);
  assert.match(close[1], /width 150ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.match(open[1], /width 250ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.match(css, /\.ov-ct\.interaction-base \{\s*transition: var\(--ov-ct-motion\);/);
});

test('Lavender hands the pill its own motion back', () => {
  assert.match(lavender, /\[data-interface-theme="lavender"\] \.ov-ct\.interaction-base \{\s*transition: var\(--ov-ct-motion\);/);
});

test('the keys and "to exit" arrive in turn; the cursor pops on turning on', () => {
  assert.match(component, /<kbd key=\{i\} className="ov-ct-key" style=\{\{ \['--ov-ct-i' as string\]: i \}\}>/);
  assert.match(component, /<span className="ov-ct-exit" style=\{\{ \['--ov-ct-i' as string\]: keys\.length \}\}>/);
  assert.match(css, /animation-delay: calc\(80ms \+ var\(--ov-ct-i, 0\) \* 40ms\);/);
  assert.match(css, /\.ov-ct\[data-phase="expanded"\] > svg \{\s*animation: ov-ct-icon-on 250ms/);
});

test('reduced motion turns the pill\'s motion off', () => {
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .ov-ct, .ov-ct[data-phase="expanded"]'));
  assert.match(reduced, /--ov-ct-motion: none;/);
  assert.match(reduced, /\.ov-ct\[data-phase="expanded"\] \.ov-ct-label > \*,\s*\.ov-ct\[data-phase="expanded"\] > svg \{ animation: none; \}/);
});
