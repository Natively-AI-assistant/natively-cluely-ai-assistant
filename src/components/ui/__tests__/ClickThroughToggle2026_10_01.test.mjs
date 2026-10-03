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

test('the icon is the dashed cursor', () => {
  assert.match(component, /<MousePointer2 [^>]*strokeDasharray="3 2\.2"/);
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
