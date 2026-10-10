// Motion of the overlay's banner, captured-page chip and tab picker — the
// rules it moves by (2026-10-05).
//
// These three animate on the transitions.dev motion-token scale and under the
// meeting overlay's own motion rules (the `@overlay-motion` block in
// index.css). Motion is visual, but the rules that keep it from breaking the
// overlay are checkable from the source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(dirname, rel), 'utf8');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
// Each stylesheet keeps its motion under a "── Motion" heading, at the end.
const motionOf = (rel) => {
  const source = read(rel);
  const at = source.indexOf('── Motion');
  assert.ok(at !== -1, `${rel} has a Motion section`);
  return stripComments(source.slice(source.lastIndexOf('/*', at)));
};
const FILES = ['../../ui/OverlayBanner.css', '../PageContextChip.css', '../TabPicker.css'];
const sections = Object.fromEntries(FILES.map((rel) => [rel, motionOf(rel)]));

// The transitions.dev scale (skills/transitions-dev, "Motion tokens").
const DURATIONS = ['0ms', '40ms', '80ms', '150ms', '250ms', '350ms', '400ms', '500ms'];
// Loops have no token: the spinner's turn and the shimmer's sweep.
const LOOPS = ['1400ms', '2000ms'];
const EASINGS = ['cubic-bezier(0.22, 1, 0.36, 1)', 'cubic-bezier(0.34, 1.36, 0.64, 1)'];
// A size here would feed the viewport ResizeObserver every frame and fight
// the card's own height tween. Colour and the tick's stroke are paint only.
// border-color is the banner body's hairline, and --ovb-cta-tone the registered
// colour triple its mark and primary button are tinted from: paint only, both.
const MAY_MOVE = ['opacity', 'transform', 'filter', 'background-color', 'border-color', 'color', 'stroke-dashoffset', '--ovb-cta-tone'];

for (const [rel, css] of Object.entries(sections)) {
  const name = path.basename(rel);

  test(`${name}: only paint and compositor properties are transitioned`, () => {
    const transitions = [...css.matchAll(/(?<![-\w])transition:\s*([^;]+);/g)].map((match) => match[1]);
    assert.ok(transitions.length >= 2, 'the section declares its transitions');
    for (const declaration of transitions) {
      if (declaration.trim() === 'none !important') continue;
      for (const part of declaration.split(/,(?![^(]*\))/)) {
        const property = part.trim().split(/\s+/)[0];
        assert.ok(MAY_MOVE.includes(property), `"${property}" must not be transitioned`);
      }
    }
    assert.doesNotMatch(css, /transition:\s*all\b/);
  });

  test(`${name}: every duration and easing is on the motion-token scale`, () => {
    for (const [, value] of css.matchAll(/(?<![\w.-])(\d+ms)\b/g)) {
      assert.ok(DURATIONS.includes(value) || LOOPS.includes(value), `${value} is not a token duration`);
    }
    for (const [value] of css.matchAll(/cubic-bezier\([^)]*\)/g)) {
      assert.ok(EASINGS.includes(value), `${value} is not a token easing`);
    }
  });

  test(`${name}: entrances play once, and reduced motion switches them off`, () => {
    // @starting-style runs when the node is inserted and never on a re-render.
    assert.match(css, /@starting-style\s*\{/);
    assert.doesNotMatch(css, /animation:[^;]*\b(?:forwards|both)\b/, 'no keyframe entrances: they replay on re-mount');
    const guard = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/);
    assert.ok(guard, 'the section ends with a reduced-motion guard');
    assert.match(guard[1], /transition:\s*none\s*!important/);
  });
}

test('nothing that holds glass is faded or blurred', () => {
  // A box with opacity < 1 or a filter is the backdrop root: glass inside it
  // samples nothing until the fade ends, then snaps in (see ChromeFold). So
  // the entrances are on text and icons, never on the mark, the chip or a pill.
  const all = Object.values(sections).join('\n');
  const starting = [...all.matchAll(/@starting-style\s*\{\s*([^{]+)\{/g)].map((match) => match[1].trim());
  assert.ok(starting.length >= 6);
  for (const selector of starting) {
    assert.doesNotMatch(selector, /\.lg-button|\.ov-banner-mark(?!-icon)|\.pc-chip(?![-\w])|\.tp-bead(?!-icon)/, `${selector} is glass`);
  }
});

test('the tab list is readable at once: its fade is quick and eases out', () => {
  // The placeholder rows leave the instant the list lands. On the snippet's
  // 400ms ease-in-out the panel stood empty for the first 130ms.
  const css = sections['../TabPicker.css'];
  assert.match(css, /--tp-fade-dur:\s*250ms;/);
  assert.match(css, /opacity\s+var\(--tp-fade-dur\)\s+ease-out/);
  // Six steps of 40ms: the last row of a long list is never late.
  assert.match(read('../TabPicker.tsx'), /const STAGGER_CAP = 6;/);
  assert.match(css, /--tp-stagger:\s*40ms;/);
});
