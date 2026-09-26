/**
 * PeriwinkleContrastGuard.test.mjs
 *
 * Regression guard for the app-wide accent. Originally written for the Soft
 * Orchid Settings rebrand (2026-07); the accent was re-hued to Periwinkle
 * (2026-08) and this file moved with it — the structure is unchanged, only the
 * hex values and the file name.
 *
 * THE GAP THIS CLOSES: the accent scale is calibrated for a DARK background,
 * so the -300 step used in dark mode is a LIGHT fill that needs a dark
 * foreground, and light mode has to substitute a darker step (-600) to stay
 * legible on white. That substitution was originally picked by eye, not
 * verified against a computed ratio. This test computes the real WCAG 2.x
 * contrast ratio for every accent/foreground pairing actually rendered, across
 * the three token systems (main app `index.css`, Profile Intelligence's
 * `--pi-*`, Modes Manager's `--mm-*`), and fails if any drops below its
 * threshold — so a future hue nudge can't silently reintroduce a legibility
 * regression. The 2026-08 re-hue is exactly the event this was built for: the
 * whole scale moved and every pairing was re-verified here first.
 *
 * HEX VALUES ARE DUPLICATED HERE, not imported — this runs as pure colour math
 * with no build step, so it cannot resolve the CSS custom properties. The
 * 'source sync' block at the bottom reads src/index.css as text and fails if
 * the scale steps these pairings use drift from it, or if any scope redeclares
 * a scale step (the light theme once did, which kept light mode on the old hue
 * after a :root-only retune). When you change the palette, change both.
 *
 * 2026-09: the scale was re-hued to the Settings toggle's blue (--toggle-on
 * #6688F5 = -500); the tokens kept the periwinkle name.
 *
 * Thresholds: WCAG 2.x AA — 4.5:1 for normal text, 3:1 for large text/icons
 * and other non-text UI components (SC 1.4.3, 1.4.11).
 *
 * Run: `node --test src/components/__tests__/PeriwinkleContrastGuard.test.mjs`
 * (pure color math — no build step, no DOM)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function relLuminance([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [r, g, b].map(lin);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hexA, hexB) {
  const La = relLuminance(hexToRgb(hexA));
  const Lb = relLuminance(hexToRgb(hexB));
  const [light, dark] = La > Lb ? [La, Lb] : [Lb, La];
  return (light + 0.05) / (dark + 0.05);
}

const AA_TEXT = 4.5;
const AA_ICON = 3.0;

// Every accent/foreground pairing actually rendered by the rebrand, across
// all three token systems. Keep this list in sync with the hex values in
// src/index.css ([data-settings-theme="periwinkle"] blocks), the `.pi-root`
// block in src/components/ProfileIntelligenceSettings.tsx, and the
// `.modes-manager-root` block in premium/src/ModesSettings.tsx.
const PAIRINGS = [
  // Main Settings modal (src/index.css)
  { label: 'Settings dark: --on-accent text on --accent-primary fill',      fg: '#14102A', bg: '#95AFF6', min: AA_TEXT },
  { label: 'Settings light: --on-accent text on --accent-primary fill',     fg: '#FFFFFF', bg: '#4967D3', min: AA_TEXT },
  { label: 'Settings light: --accent-primary as text/icon on white card',   fg: '#4967D3', bg: '#FFFFFF', min: AA_TEXT },
  { label: 'Settings light: --accent-primary as text/icon on canvas',      fg: '#4967D3', bg: '#FAFAFA', min: AA_TEXT },
  // #FAFAFA above predates the Apple-style light theme; the real light canvas
  // is --bg-main #F2F2F7 and cards are --bg-card #FBFBFD. The canvas is the
  // binding one: the unnudged -600 (#4A68D4) measured 4.46:1 on it.
  { label: 'Settings light: --accent-primary as text/icon on --bg-main',   fg: '#4967D3', bg: '#F2F2F7', min: AA_TEXT },
  { label: 'Settings light: --accent-primary as text/icon on --bg-card',   fg: '#4967D3', bg: '#FBFBFD', min: AA_TEXT },
  { label: 'Settings dark: --on-accent text on --accent-hover fill',       fg: '#14102A', bg: '#B9CCFC', min: AA_TEXT },
  { label: 'Settings dark: --accent-primary as text/icon on main bg',      fg: '#95AFF6', bg: '#1E1E21', min: AA_TEXT },
  { label: 'Settings dark: --accent-primary as text/icon on card bg',      fg: '#95AFF6', bg: '#242429', min: AA_TEXT },

  // Profile Intelligence (--pi-* — ProfileIntelligenceSettings.tsx)
  { label: 'PI dark: --pi-on-accent on --pi-accent fill',                   fg: '#14102A', bg: '#95AFF6', min: AA_TEXT },
  { label: 'PI light: --pi-on-accent on --pi-accent fill',                  fg: '#FFFFFF', bg: '#4967D3', min: AA_TEXT },

  // Meeting notes → Usage tab question bubble (MeetingDetails.tsx, .lg-bubble
  // in src/ui-components/LiquidGlassButton.css, fed by the --bubble-user-bg /
  // --bubble-user-fg pair in index.css). The fill is --toggle-on (#6688F5, the
  // Settings toggle's ON colour) in dark mode and that colour mixed 75/25 with
  // white (#8CA6F8) in light mode. The Liquid Glass rim, sheens and cap
  // shadow all stay in the host's padding, so the token value is the only fill
  // pixel under the glyphs (the ink band is asserted flat in
  // tests/css/bubble-liquid-glass.check.mjs). White on it sits below AA in both
  // themes and lives in KNOWN_DEVIATIONS below, as does the fill against the
  // light pane.
  { label: 'Bubble dark: --bubble-user-bg fill on the #151515 pane',        fg: '#6688F5', bg: '#151515', min: AA_ICON },

  // Modes Manager (--mm-* — premium/src/ModesSettings.tsx). The checkmark
  // dot is a non-text icon, so the 3:1 (not 4.5:1) threshold applies.
  { label: 'MM dark: checkmark (--mm-bg) on --mm-active-blue fill',         fg: '#111111', bg: '#95AFF6', min: AA_ICON },
  { label: 'MM light: checkmark (--mm-bg) on --mm-active-blue fill',        fg: '#FFFFFF', bg: '#4967D3', min: AA_ICON },

  // Teleprompter hot words (--hotword-color, src/index.css): bold words in
  // answers and the gist chip. Lavender until 2026-09, now the toggle blue's
  // hue. Deliberately NOT --accent-primary — the accent also paints buttons,
  // focus rings and usage bars, so the glance highlight owns its own token and
  // moves independently. The token is redefined in every scope that sets
  // --overlay-text-primary, because that is what decides light-on-dark vs
  // dark-on-light and therefore which of the two values is legible. Hot words
  // render at body size in weight 600, which is NOT WCAG "large text", so the
  // 4.5:1 bar applies, not 3:1.
  { label: 'Hotword dark: #A9C0FB on the #1E1E1E overlay',                  fg: '#A9C0FB', bg: '#1E1E1E', min: AA_TEXT },
  { label: 'Hotword light: #4B65BE on the near-white overlay',              fg: '#4B65BE', bg: '#FFFFFF', min: AA_TEXT },
  { label: 'Hotword light: #4B65BE on the #F2F2F7 overlay tint',            fg: '#4B65BE', bg: '#F2F2F7', min: AA_TEXT },
  // "modern" forces white text on the slate gradient in BOTH themes, so it
  // takes the light hot-word blue. Every gradient stop is asserted; the
  // lightest top stop is the worst case and lives in KNOWN_DEVIATIONS below.
  { label: 'Hotword modern: #A9C0FB on gradient MID stop',                  fg: '#A9C0FB', bg: '#373746', min: AA_TEXT },
  { label: 'Hotword modern: #A9C0FB on gradient BOTTOM stop',               fg: '#A9C0FB', bg: '#242432', min: AA_TEXT },
];

// Pairings that knowingly sit below their WCAG threshold. These are NOT waived:
// each pins the ratio measured at sign-off and fails if the real ratio moves in
// EITHER direction, so a later hue nudge still trips the guard and an exception
// that stops being needed surfaces for removal instead of quietly masking a
// pairing that now passes.
const KNOWN_DEVIATIONS = [
  {
    label: 'Bubble dark: white on the flat --toggle-on fill',
    fg: '#FFFFFF', bg: '#6688F5', expected: 3.28, shortfallOf: AA_TEXT,
    why:
      '3.28:1 is under the 4.5:1 AA floor for body text (15px regular, so the ' +
      'large-text allowance does not apply). The fill is the Settings toggle\'s ON ' +
      'colour and the foreground is white, both by explicit owner instruction. ' +
      '--periwinkle-on-accent-dark measures 5.63:1 on this exact fill, and swapping ' +
      '--bubble-user-fg to it is the one-token fix. prefers-contrast: more darkens ' +
      'the body to #2C5BF1 (5.42:1).',
  },
  {
    label: 'Bubble light: white on the lifted --toggle-on fill (75% toggle, 25% white)',
    fg: '#FFFFFF', bg: '#8CA6F8', expected: 2.35, shortfallOf: AA_TEXT,
    why:
      'The owner asked for a lighter bubble on the light pane, which costs white text ' +
      'contrast: 2.35:1 here (2.68:1 at the first, 15% lift) against 3.28:1 in dark mode, ' +
      'and light mode used to clear AA at 5.23:1 on periwinkle-600. --periwinkle-on-accent-dark measures 7.85:1 on ' +
      'this fill; prefers-contrast: more darkens the body to #2C5BF1 (5.42:1).',
  },
  {
    label: 'Bubble light: --bubble-user-bg fill on the --bg-secondary #EBEBF0 pane',
    fg: '#8CA6F8', bg: '#EBEBF0', expected: 1.98, shortfallOf: AA_ICON,
    why:
      'A lifted body on a light pane. The fill alone does not separate the bubble from ' +
      'the pane; the colour step, the specular rim and the shaded side faces carry the ' +
      'edge instead. The ' +
      'bubble is also not a control, so ' +
      'SC 1.4.11 does ' +
      'not strictly bind — pinned so a later hue or pane change still trips the guard.',
  },
  {
    label: 'Hotword modern: #A9C0FB on gradient TOP stop (lightest pixel)',
    fg: '#A9C0FB', bg: '#5A5A6C', expected: 3.73, shortfallOf: AA_TEXT,
    why:
      'Pre-existing and system-wide at this pixel, not introduced by the hot-word ' +
      'colour: the modern theme\'s own accent #8FB4F7 measures 3.22:1 there, the ' +
      'orchid highlight 3.42:1 and the lavender 3.65:1, so the blue is the best of ' +
      'the four. Only the topmost band of the panel is this light — the mid and ' +
      'bottom stops clear AA at 6.46:1 and 8.46:1 and are asserted in PAIRINGS. ' +
      'Fixing it properly means darkening the gradient\'s top stop, which repaints ' +
      'the whole modern surface and is out of scope for a highlight-colour change.',
  },
];

describe('Periwinkle — WCAG AA contrast guard', () => {
  for (const { label, fg, bg, min } of PAIRINGS) {
    test(`${label} (>= ${min}:1)`, () => {
      const ratio = contrastRatio(fg, bg);
      assert.ok(
        ratio >= min,
        `${label}: computed ratio ${ratio.toFixed(2)}:1 is below the required ${min}:1 — ` +
        `this pairing needs a darker/lighter accent step, not a hue tweak alone.`
      );
    });
  }

  for (const { label, fg, bg, expected, shortfallOf, why } of KNOWN_DEVIATIONS) {
    test(`${label} — known deviation, pinned at ${expected}:1 (AA wants ${shortfallOf}:1)`, () => {
      const ratio = Number(contrastRatio(fg, bg).toFixed(2));
      assert.equal(
        ratio, expected,
        `${label}: measured ${ratio}:1 but this deviation was signed off at ${expected}:1. ` +
        `${why}\nIf the colours changed on purpose, update the expected value (or delete the ` +
        `entry and move it into PAIRINGS if it now clears ${shortfallOf}:1).`
      );
    });
  }
});

// ── Source sync ──────────────────────────────────────────────────────────────
// The pairings above duplicate hex values; this block ties the ones that come
// from the scale back to src/index.css, read as text (comments stripped first,
// so prose that quotes an old value cannot match).
const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_CSS = readFileSync(resolve(__dirname, '../../index.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const SCALE_AS_TESTED = {
  '--periwinkle-300': '#95AFF6',            // dark accent-primary fill/text
  '--periwinkle-600': '#4967D3',            // light accent-primary fill/text
  '--periwinkle-on-accent-dark': '#14102A', // dark on-accent
};
const DARK_HOVER_AS_TESTED = '#B9CCFC';

function declarations(name) {
  const re = new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;]+);`, 'g');
  return [...INDEX_CSS.matchAll(re)].map((m) => m[1].trim());
}

describe('Periwinkle — source sync with src/index.css', () => {
  test('every scale step is declared exactly once (no scope redeclares it)', () => {
    const names = new Set(
      [...INDEX_CSS.matchAll(/(--periwinkle-[\w-]+)\s*:/g)].map((m) => m[1])
    );
    assert.ok(names.size >= 12, `expected the 10 steps + 2 on-accent tokens, found ${names.size}`);
    for (const name of names) {
      const values = declarations(name);
      assert.equal(
        values.length, 1,
        `${name} is declared ${values.length} times (${values.join(', ')}). A second ` +
        `declaration in a later scope overrides :root and splits the palette.`
      );
    }
  });

  for (const [name, hex] of Object.entries(SCALE_AS_TESTED)) {
    test(`${name} in index.css matches the ${hex} these pairings test`, () => {
      assert.deepEqual(declarations(name).map((v) => v.toUpperCase()), [hex]);
    });
  }

  test('-500 is --toggle-on (the anchor the scale is built on)', () => {
    const [toggle] = declarations('--toggle-on');
    assert.ok(toggle, '--toggle-on not found in index.css');
    assert.deepEqual(declarations('--periwinkle-500').map((v) => v.toUpperCase()), [toggle.toUpperCase()]);
  });

  test('every --hotword-color declaration is one of the two values tested above', () => {
    const values = declarations('--hotword-color').map((v) => v.toUpperCase());
    assert.ok(values.length >= 2, `expected a dark and a light hot-word colour, found ${values.length}`);
    for (const v of values) assert.ok(['#A9C0FB', '#4B65BE'].includes(v), `untested --hotword-color ${v}`);
  });

  test(`every literal dark hover tint is the ${DARK_HOVER_AS_TESTED} tested above`, () => {
    const literals = ['--accent-hover', '--btn-primary-hover']
      .flatMap(declarations)
      .filter((v) => v.startsWith('#'));
    assert.ok(literals.length > 0, 'no literal hover tint found — update this test');
    for (const v of literals) assert.equal(v.toUpperCase(), DARK_HOVER_AS_TESTED);
  });
});
