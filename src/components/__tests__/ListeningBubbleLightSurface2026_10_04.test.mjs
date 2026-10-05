// The overlay's Listening bubble (Answer pressed, mic transcribing) has to be
// readable on the light panel.
//
// It was written for the dark panel only: emerald-300 text and emerald-400
// level bars, the bars also resting at 0.3 opacity. On the light panel that is
// about 1.1:1, so the transcript washed out and the bars all but vanished.
//
// - The light branch takes its colours from the dark end of the emerald scale,
//   and the contrast is measured here rather than trusted.
// - Only the DEFAULT interface theme has a light panel. Glass and modern keep a
//   dark one under the light app theme, so they must stay on the pale branch.
// - Both branches keep `bg-emerald-500/10`: the glass and modern recipes in
//   index.css select on that class.
// - On every panel the bars rest at 0.55, and on the dark ones the label is the
//   transcript's colour at full strength: at 0.3 and 70% they were the faintest
//   things on the glass and modern panels.
//
// Source assertions plus arithmetic: the overlay is not unit-rendered here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const overlay = readFileSync(join(here, '..', 'NativelyInterface.tsx'), 'utf8');
const css = readFileSync(join(here, '..', '..', 'index.css'), 'utf8');
const appearance = readFileSync(join(here, '..', '..', 'lib', 'overlayAppearance.ts'), 'utf8');

const block = overlay.slice(
  overlay.indexOf('{isManualRecording && (\n                    <div className="ov-listening-in'),
  overlay.indexOf("{t('Listening...')}</span>"),
);

// Tailwind's emerald scale, the shades this bubble may use.
const EMERALD = {
  300: [110, 231, 183],
  400: [52, 211, 153],
  500: [16, 185, 129],
  600: [5, 150, 105],
  700: [4, 120, 87],
  800: [6, 95, 70],
  900: [6, 78, 59],
};

const luminance = ([r, g, b]) => {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (top, alpha, under) => top.map((v, i) => v * alpha + under[i] * (1 - alpha));

// The light panel, read from the shell's own colour, with the bubble's 10%
// emerald fill on top of it.
const shell = appearance.match(/if \(theme === 'light'\) \{[\s\S]*?shellStyle: \{\s*backgroundColor: `rgba\((\d+), (\d+), (\d+),/);
assert.ok(shell, 'the light shell colour is where this test reads it');
const pane = over(EMERALD[500], 0.1, shell.slice(1, 4).map(Number));

// The shade a `isLightSurface ? '<prefix>-emerald-NNN' : …` ternary picks.
const lightShade = (prefix) => {
  const m = block.match(new RegExp(`isLightSurface \\? '${prefix}-emerald-(\\d+)' : '${prefix}-emerald-(\\d+)`));
  assert.ok(m, `the ${prefix} colour has a light branch`);
  return { light: EMERALD[m[1]], dark: EMERALD[m[2]], lightName: m[1], darkName: m[2] };
};

test('the listening block is found', () => {
  assert.ok(block.length > 0 && block.length < 3000);
});

test('only the default interface theme counts as a light surface', () => {
  assert.ok(overlay.includes('const isLightSurface = isLightTheme && !isGlassTheme && !isModernTheme;'));
});

test('the transcript and the label clear AA on the light panel', () => {
  const text = lightShade('text');
  assert.ok(contrast(text.light, pane) >= 4.5, `transcript emerald-${text.lightName}: ${contrast(text.light, pane).toFixed(2)}:1`);
  assert.equal(text.darkName, '300', 'the dark panel keeps its pale text');

  const label = block.slice(block.lastIndexOf('<span className={`text-[10px]'));
  const m = label.match(/isLightSurface \? 'text-emerald-(\d+)' : 'text-emerald-300'/);
  assert.ok(m, 'the label has a light branch, and on dark panels matches the transcript at full strength');
  assert.ok(contrast(EMERALD[m[1]], pane) >= 4.5, `label emerald-${m[1]}: ${contrast(EMERALD[m[1]], pane).toFixed(2)}:1`);
});

test('the level bars clear 3:1 at their peak and stay readable at rest', () => {
  const bars = lightShade('bg');
  assert.equal(bars.darkName, '300', 'on dark panels the bars match the transcript and the label');
  assert.ok(contrast(bars.light, pane) >= 3, `bars emerald-${bars.lightName}: ${contrast(bars.light, pane).toFixed(2)}:1`);

  const frames = css.match(/@keyframes ov-listening-wave-bar \{([\s\S]*?)\n\}/);
  assert.ok(frames, 'the bars have their own keyframes');
  const rest = Math.min(...[...frames[1].matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1])));
  assert.ok(rest >= 0.5, `rest opacity ${rest}`);
  // At rest the bar is its colour at that opacity over the pane. The old pair
  // (emerald-400 at 0.3) measured 1.12:1 here.
  assert.ok(contrast(over(bars.light, rest, pane), pane) >= 1.8, `bars at rest: ${contrast(over(bars.light, rest, pane), pane).toFixed(2)}:1`);

  // Every panel: the rule is not scoped to a theme or a surface.
  assert.ok(css.includes("\n.ov-listening-wave .stt-wave-dot {\n  animation-name: ov-listening-wave-bar;\n}"));
  // The dark panel's bars at rest: emerald-400 at 0.3 measured 1.94:1 on the
  // default dark shell, and reads lower still on the grey glass panels.
  const darkPane = over(EMERALD[500], 0.1, [24, 26, 32]);
  assert.ok(contrast(over(bars.dark, rest, darkPane), darkPane) >= 3, `dark bars at rest: ${contrast(over(bars.dark, rest, darkPane), darkPane).toFixed(2)}:1`);
});

test('reduced motion still stops the bars', () => {
  // Both rules weigh the same, so the later reduced-motion one wins the tie.
  const bars = css.indexOf('\n.ov-listening-wave .stt-wave-dot {\n  animation-name:');
  const reduced = css.indexOf('.ov-listening-wave .stt-wave-dot {\n    animation: none;');
  assert.ok(bars !== -1 && reduced > bars);
});

test('both branches keep the fill the glass and modern recipes select on', () => {
  assert.equal(block.match(/bg-emerald-500\/10 border /g)?.length, 2);
  assert.ok(css.includes('[data-interface-theme="liquid-glass"] [class*="bg-emerald-500/10"] {'));
  assert.ok(css.includes('[data-interface-theme="modern"] [class*="bg-emerald-500/10"] {'));
});
