// src/components/__tests__/LavenderDefault2026_10_30.test.mjs
//
// Lavender became the light Default (the owner, 2026-10-30, option a of the
// options page): a Default pick paints Lavender under the light app theme and
// keeps its own dark panel under the dark one. With it Lavender took Default's
// colour rule (neutral controls, violet only on the question, the gist,
// highlighted words and send), a half-tinted body, a light code well, the
// Notes / click-through buttons and the screenshot hint it used to hide, and
// one violet scale in place of five ad hoc violets.
//
// This holds:
//   1. the Default mapping itself, under both app themes;
//   2. every window that paints the overlay, or a preview of it, resolving
//      through it (a window that skipped it would draw the old light Default
//      beside a Lavender overlay);
//   3. the overlay showing click-through and the hint in every style, and
//      no Notes button in any (the owner, later the same day: the notepad is
//      reached from Settings › Overlay);
//   4. the scale (one ramp, roles on named steps, no stray violet hex);
//   5. WCAG contrast for every text and control colour on the panel, at the
//      default opacity over white and fully opaque.
//
// Pure source reads and colour maths: no DOM, no build, no platform branch
// (the style is the same CSS on macOS and Windows).
//
// Run: node --experimental-strip-types --test src/components/__tests__/LavenderDefault2026_10_30.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMeetingInterfaceTheme } from '../../lib/meetingInterfaceTheme.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(src, rel), 'utf8');

describe('Default is Lavender in light and dark mode', () => {
  test('a Default pick paints Lavender under the light app theme', () => {
    assert.equal(resolveMeetingInterfaceTheme('default', 'light'), 'lavender');
  });

  test('a Default pick paints dark Lavender under the dark app theme (2026-10-31)', () => {
    assert.equal(resolveMeetingInterfaceTheme('default', 'dark'), 'lavender');
  });

  test('every other pick paints itself under both app themes', () => {
    for (const theme of ['liquid-glass', 'modern', 'lavender']) {
      assert.equal(resolveMeetingInterfaceTheme(theme, 'light'), theme);
      assert.equal(resolveMeetingInterfaceTheme(theme, 'dark'), theme);
    }
  });
});

describe('every window paints the resolved style', () => {
  test('App: the overlay and the popup windows it hosts', () => {
    const app = read('App.tsx');
    assert.match(app, /const paintedInterfaceTheme = resolveMeetingInterfaceTheme\(meetingInterfaceTheme, isLight \? 'light' : 'dark'\)/);
    assert.match(app, /interfaceThemeAttribute = paintedInterfaceTheme === 'default'/);
    assert.match(app, /<NativelyInterface[\s\S]{0,200}?interfaceTheme=\{paintedInterfaceTheme\}/);
  });

  test('AuxRoot: the panel shell around the split popup routes', () => {
    const aux = read('AuxRoot.tsx');
    assert.match(aux, /const painted = resolveMeetingInterfaceTheme\(theme, useResolvedTheme\(\)\)/);
    assert.match(aux, /data-interface-theme=\{painted === 'default' \? undefined : painted\}/);
  });

  test('the model picker and the settings popup', () => {
    assert.match(read('components/ModelSelectorWindow.tsx'), /const interfaceTheme = resolveMeetingInterfaceTheme\(chosenInterfaceTheme, isLight \? 'light' : 'dark'\)/);
    assert.match(read('components/SettingsPopup.tsx'), /const interfaceTheme = resolveMeetingInterfaceTheme\(chosenInterfaceTheme, isLightTheme \? 'light' : 'dark'\)/);
  });

  test('the Settings previews draw the resolved style; the picker keeps the pick', () => {
    const overlaySettings = read('components/settings/OverlaySettings.tsx');
    assert.match(overlaySettings, /const paintedTheme = resolveMeetingInterfaceTheme\(theme, useResolvedTheme\(\)\)/);
    assert.match(overlaySettings, /<Preview opacity=\{opacity\} theme=\{paintedTheme\} \/>/);
    assert.match(overlaySettings, /<StylePicker theme=\{theme\} /);
    assert.match(read('components/SettingsOverlay.tsx'), /<MockupNativelyInterface opacity=\{previewOverlayOpacity\} theme=\{resolveMeetingInterfaceTheme\(meetingInterfaceTheme, resolvedTheme\)\} \/>/);
  });
});

describe('the overlay shows its controls in every style', () => {
  const overlay = read('components/NativelyInterface.tsx');

  test('click-through is not gated on Lavender', () => {
    assert.doesNotMatch(overlay, /!isLavenderTheme && \(<>/);
    assert.ok(overlay.indexOf('<ClickThroughToggle') > 0);
  });

  test('no style has a Notes button', () => {
    assert.doesNotMatch(overlay, /notesWindowToggle/);
    assert.doesNotMatch(overlay, /<NotebookPen/);
  });

  test('the placeholder carries the screenshot hint in every style', () => {
    const placeholder = overlay.slice(overlay.indexOf('{/* Custom Rich Placeholder */}'), overlay.indexOf("t('Ask anything…')"));
    assert.match(placeholder, /for selective screenshot/);
    assert.doesNotMatch(placeholder, /isLavenderTheme/);
  });

  test('Lavender takes the light code theme, as every light panel does', () => {
    assert.match(overlay, /const useDarkCodeTheme = !isLightSurface;/);
  });
});

// ── Colour ──────────────────────────────────────────────────────────────────

const css = read('overlayLavenderTheme.css');
const PART2 = css.indexOf('Part 2: the Lavender colour system');
const colourSystem = css.slice(PART2);
// Declarations only: comments and selectors (`.bg-\[\#B0ABBB\]`) carry hexes
// that are not colours on screen.
const declarations = colourSystem
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/[^{}]*\{/g, '{');

const scale = Object.fromEntries(
  [...css.matchAll(/--lavender-(\d+):\s*(#[0-9A-Fa-f]{6});/g)].map(([, step, hex]) => [Number(step), hex.toUpperCase()]),
);
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(m, `--${name} is declared`);
  return m[1].trim();
};

const hexToRgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16));
const lum = ([r, g, b]) => {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// `fg` at `alpha` over the opaque `bg`.
const over = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
const hsl = ([r, g, b]) => {
  const [R, G, B] = [r, g, b].map((c) => c / 255);
  const max = Math.max(R, G, B); const min = Math.min(R, G, B); const l = (max + min) / 2; const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? 60 * (((G - B) / d) % 6) : max === G ? 60 * ((B - R) / d + 2) : 60 * ((R - G) / d + 4);
  return { h: (h + 360) % 360, s, l };
};

describe('one violet scale', () => {
  test('ten steps, each darker than the one before', () => {
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    assert.deepEqual(Object.keys(scale).map(Number), steps);
    for (let i = 1; i < steps.length; i++) {
      assert.ok(lum(hexToRgb(scale[steps[i]])) < lum(hexToRgb(scale[steps[i - 1]])), `--lavender-${steps[i]} is darker than ${steps[i - 1]}`);
    }
  });

  test('the roles sit on named steps', () => {
    assert.equal(token('lv-accent'), 'var(--lavender-700)');
    assert.equal(token('lv-accent-solid'), 'var(--lavender-600)');
    assert.match(declarations, /--toggle-on: var\(--lavender-600\)/);
  });

  test('no violet hex outside the scale in the colour system', () => {
    const stray = [...declarations.matchAll(/#[0-9A-Fa-f]{6}\b/g)]
      .map(([hex]) => hex.toUpperCase())
      .filter((hex) => {
        const { h, s } = hsl(hexToRgb(hex));
        return h >= 240 && h <= 300 && s >= 0.35;
      })
      .filter((hex) => !Object.values(scale).includes(hex));
    assert.deepEqual(stray, []);
  });
});

describe('contrast on the panel', () => {
  const AA_TEXT = 4.5;
  const AA_UI = 3;
  const WHITE = [255, 255, 255];
  const glass = token('lv-glass').split(/\s+/).map(Number);
  // The body's alpha at the default opacity (0.70): 0.085 + 0.915 * n.
  assert.match(token('lv-body'), /calc\(0\.085 \+ 0\.915 \* var\(--lv-n\)\)/);
  const n = (0.7 - 0.35) / 0.65;
  const bodies = {
    'the body at 0.70 over white': over(glass, 0.085 + 0.915 * n, WHITE),
    'the body fully opaque': glass,
  };
  const ink = hexToRgb(token('lv-ink'));
  const ink2 = hexToRgb(token('lv-ink-2'));
  const ink3 = hexToRgb(token('lv-ink-3'));

  // The fixed whites and tints these faces are built from, read back from the
  // sheet so a retune here cannot leave the maths behind.
  test('the faces the maths uses are the sheet\'s', () => {
    assert.match(css, /\.hero-pill \{\s*--glass-inner-tint: rgba\(255, 255, 255, 0\);[\s\S]{0,200}rgba\(255, 255, 255, 0\.62\);/);
    assert.match(css, /\.hero-bubble \{\s*--glass-inner-tint: rgba\(156, 111, 243, 0\.24\);[\s\S]{0,800}rgba\(255, 255, 255, 0\.74\);/);
    assert.match(css, /\.overlay-gist-chip \{\s*color: var\(--lavender-800\);\s*background:\s*linear-gradient\(rgba\(156, 111, 243, 0\.24\), rgba\(156, 111, 243, 0\.24\)\),\s*rgba\(255, 255, 255, 0\.74\);/);
  });

  for (const [where, body] of Object.entries(bodies)) {
    test(`text on ${where}`, () => {
      for (const [label, fg] of [['ink', ink], ['ink-2', ink2], ['ink-3', ink3], ['accent 700', hexToRgb(scale[700])]]) {
        const ratio = contrast(fg, body);
        assert.ok(ratio >= AA_TEXT, `${label} on ${where}: ${ratio.toFixed(2)}`);
      }
    });

    test(`a neutral button on ${where}`, () => {
      const face = over(WHITE, 0.62, body);
      assert.ok(contrast(ink, face) >= AA_TEXT, `label ${contrast(ink, face).toFixed(2)}`);
      assert.ok(contrast(ink3, face) >= AA_UI, `icon ${contrast(ink3, face).toFixed(2)}`);
    });

    test(`your question and the gist on ${where}`, () => {
      const card = over(hexToRgb(scale[400]), 0.24, over(WHITE, 0.74, body));
      const ratio = contrast(hexToRgb(scale[800]), card);
      assert.ok(ratio >= AA_TEXT, `800 on the question card: ${ratio.toFixed(2)}`);
    });

    test(`a switch on ${where}`, () => {
      const ratio = contrast(hexToRgb(scale[600]), body);
      assert.ok(ratio >= AA_UI, `600 track: ${ratio.toFixed(2)}`);
    });
  }

  test('inline code: 700 on 100', () => {
    const ratio = contrast(hexToRgb(scale[700]), hexToRgb(scale[100]));
    assert.ok(ratio >= AA_TEXT, ratio.toFixed(2));
  });
});

// ── Lavender in the dark (2026-10-31) ───────────────────────────────────────

describe('Lavender in the dark', () => {
  const PART4 = css.indexOf('Part 4: Lavender in the dark');
  // From the opening of Part 4's comment, so comments strip cleanly.
  const dark = css.slice(css.lastIndexOf('/*', PART4));
  const darkToken = (name) => {
    const m = dark.match(new RegExp(`--${name}:\\s*([^;]+);`));
    assert.ok(m, `dark --${name} is declared`);
    return m[1].trim();
  };

  test('every dark rule sits under the app\'s dark theme', () => {
    assert.ok(PART4 > PART2, 'Part 4 comes after the light colour system');
    const selectors = dark.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g)
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('@'));
    assert.ok(selectors.length > 20);
    for (const s of selectors) assert.match(s, /^\[data-theme='dark'\] \[data-interface-theme="lavender"\]/, s);
  });

  test('it keeps Default dark\'s see-through curve', () => {
    assert.equal(darkToken('lv-body'), 'rgb(var(--lv-glass) / calc(0.12 + 0.88 * var(--lv-n)))');
    assert.equal(darkToken('lv-blur'), 'calc(6px + 14px * var(--lv-n))');
  });

  // The owner (2026-10-31): less purple, the notepad's dark body. Its
  // surface, ink and periwinkle accent (index.css .notepad dark).
  test('the body, ink and accent are the notepad\'s dark ones', () => {
    assert.equal(darkToken('lv-glass'), '28 28 31');
    assert.equal(darkToken('lv-ink'), '#ECECF0');
    assert.equal(darkToken('lv-accent'), '#B8C6FF');
    // The question card and gist: "Midnight indigo" (2026-10-31, owner pick from
    // eight side by side). Send and the open click-through pill: the
    // Settings switch periwinkle, no longer Apple's blue.
    assert.equal(darkToken('lv-q-bg'), '#2B2A52');
    assert.equal(darkToken('lv-q-edge'), 'rgba(160, 165, 255, 0.22)');
    assert.equal(darkToken('lv-q-ink'), '#D6D8FF');
    assert.equal(darkToken('lv-send'), 'var(--periwinkle-500)');
    assert.equal(darkToken('lv-send-ink'), '#FFFFFF');
    assert.doesNotMatch(dark, /#007AFF;|--lv-blue/);
    assert.match(dark, /--toggle-on: var\(--lavender-500\)/);
  });

  test('no violet on the edges, chips or code', () => {
    const rules = dark.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(rules, /rgba\(156, 111, 243|rgba\(196, 179, 251|26 21 40|14 11 24/);
    assert.equal(darkToken('lv-chip-tint'), 'rgba(255, 255, 255, 0)');
    assert.equal(darkToken('lv-hairline'), '0 0 0 1px rgba(255, 255, 255, 0.10)');
  });

  test('the question card and gist are one solid face with no coloured glow in the dark', () => {
    const q = dark.slice(dark.indexOf('.hero-bubble {'), dark.indexOf('.overlay-gist-chip::before'));
    assert.doesNotMatch(q, /0 14px 30px -12px rgba\((37|59|156)/);
    assert.equal(q.match(/background: var\(--lv-q-bg\);/g)?.length, 2);
  });


  test('the top pill has no sheen in the dark', () => {
    assert.match(dark, /\.overlay-resize-toggle-surface::before,\s*\[data-theme='dark'\] \[data-interface-theme="lavender"\] \.overlay-icon-surface::before \{\s*opacity: 0;/);
  });

  // Over a dark desktop and fully opaque. Over a white page at a low opacity
  // the dark glass gives up contrast for transparency, as Default dark does.
  const AA_TEXT = 4.5;
  const AA_UI = 3;
  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];
  const glass = darkToken('lv-glass').split(/\s+/).map(Number);
  const n = (0.7 - 0.35) / 0.65;
  const ink = hexToRgb(darkToken('lv-ink'));
  const alphaOf = (name) => Number(darkToken(name).match(/\/\s*([\d.]+)\)/)[1]);
  const bodies = {
    'the dark body at 0.70 over black': over(glass, 0.12 + 0.88 * n, BLACK),
    'the dark body fully opaque': glass,
  };
  for (const [where, body] of Object.entries(bodies)) {
    test(`text on ${where}`, () => {
      for (const [label, fg] of [
        ['ink', ink],
        ['ink-2', over(ink, alphaOf('lv-ink-2'), body)],
        ['ink-3', over(ink, alphaOf('lv-ink-3'), body)],
        ['accent', hexToRgb(darkToken('lv-accent'))],
      ]) {
        const ratio = contrast(fg, body);
        assert.ok(ratio >= AA_TEXT, `${label} on ${where}: ${ratio.toFixed(2)}`);
      }
    });

    test(`a neutral button and the question on ${where}`, () => {
      const face = over(WHITE, 0.08, body);
      assert.ok(contrast(ink, face) >= AA_TEXT, `label ${contrast(ink, face).toFixed(2)}`);
      assert.ok(contrast(over(ink, alphaOf('lv-ink-3'), face), face) >= AA_UI, 'icon');
      // The question card: solid deep indigo, so the body under it does
      // not matter.
      const qInk = hexToRgb(darkToken('lv-q-ink'));
      const card = hexToRgb(darkToken('lv-q-bg'));
      assert.ok(contrast(qInk, card) >= AA_TEXT, `ink on the question card: ${contrast(qInk, card).toFixed(2)}`);
      // Send's white arrow on the switch periwinkle #6688F5 (3.3:1, a
      // glyph: the 3:1 UI floor).
      assert.ok(contrast(hexToRgb(darkToken('lv-send-ink')), hexToRgb('#6688F5')) >= AA_UI, 'send arrow');
    });

    test(`a switch on ${where}`, () => {
      assert.ok(contrast(hexToRgb(scale[500]), body) >= AA_UI, contrast(hexToRgb(scale[500]), body).toFixed(2));
    });
  }

  test('the surface follows the app and the overlay picks its code theme from it', () => {
    assert.match(read('lib/meetingInterfaceTheme.ts'), /if \(theme === 'liquid-glass' \|\| theme === 'modern'\) return 'dark';\s*return appTheme;/);
  });
});
