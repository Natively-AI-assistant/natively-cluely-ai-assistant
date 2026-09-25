/**
 * SupportToaster.test.mjs
 *
 * Source-level tests for the "support the developer" onboarding card. The
 * project runs `node --test` with no JSX renderer, so the component is read as
 * text and its contracts asserted directly:
 *
 *   1. Behaviour: the support link, the "returned after 20s means donated"
 *      heuristic, and every way of dismissing it.
 *   2. Accessibility: dialog semantics, and WCAG contrast COMPUTED from the
 *      ink tokens, so ratios quoted in the source cannot drift from what ships.
 *   3. Design contracts shared with the browser-extension card: split layout
 *      in both themes, a scrim that dims but never blurs, no perpetual motion.
 *
 * Run: node --test src/components/__tests__/SupportToaster.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../SupportToaster.tsx'), 'utf8');

// What reaches the screen: the source with every comment removed.
const rendered = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\n]*?\/\/[^\n]*$/gm, '');

// ─── Behaviour ──────────────────────────────────────────────────

test('support opens Buy Me a Coffee, with a browser fallback', () => {
  assert.ok(source.includes("const SUPPORT_URL = 'https://buymeacoffee.com/evinjohnn'"));
  assert.ok(rendered.includes('window.electronAPI.openExternal(SUPPORT_URL)'));
  assert.ok(rendered.includes("window.open(SUPPORT_URL, '_blank')"));
});

test('returning after 20s from the support page is treated as a donation', () => {
  assert.match(source, /const PRESUMED_DONATION_MS = 20_000;/);
  const focus = source.slice(source.indexOf('const handleFocus'), source.indexOf("window.addEventListener('focus'"));
  assert.ok(focus.includes('if (elapsed > PRESUMED_DONATION_MS)'));
  assert.ok(focus.includes('window.electronAPI?.setDonationComplete?.()'));
  assert.ok(focus.includes('dismiss();'), 'the card closes itself (the genie) first');
  // The click time is consumed on the first refocus, so an unrelated later
  // focus cannot be mistaken for a return from the support page.
  assert.ok(focus.indexOf('clickTimeRef.current = null') < focus.indexOf('if (elapsed'),
    'the stamp is cleared before the check, whatever the outcome');
  assert.ok(rendered.includes("window.removeEventListener('focus', handleFocus)"));
});

test('Escape, backdrop, close and "Maybe later" all dismiss', () => {
  assert.ok(rendered.includes("if (e.key === 'Escape') dismiss();"));
  assert.ok(rendered.includes('onBackdropClick={dismiss}'));
  assert.equal((rendered.match(/onClick=\{dismiss\}/g) || []).length, 2,
    'the close button and "Maybe later"');
  // The orchestrator unmounts the card the moment it hears "dismissed", so
  // the host is told only once the genie has played.
  assert.ok(rendered.includes('onClosed={() => { if (dismissedRef.current) onDismiss(); }}'));
});

test('every electronAPI access is guarded', () => {
  const calls = rendered.match(/window\.electronAPI[^\s(;]*/g) || [];
  for (const c of calls) {
    // One direct call is allowed: inside the `if (window.electronAPI?.openExternal)` guard.
    if (c === 'window.electronAPI.openExternal') continue;
    assert.ok(c.startsWith('window.electronAPI?.'), `unsafe access: ${c}`);
  }
  assert.ok(rendered.includes('if (window.electronAPI?.openExternal)'));
});

// ─── Accessibility ──────────────────────────────────────────────

test('dialog semantics point at elements that exist', () => {
  // On the genie's card element, via GenieModal's cardProps.
  assert.ok(rendered.includes("role: 'dialog'"));
  assert.ok(rendered.includes("'aria-modal': true"));
  assert.ok(rendered.includes("'aria-labelledby': 'support-toast-title'") && rendered.includes('id="support-toast-title"'));
  assert.ok(rendered.includes("'aria-describedby': 'support-toast-desc'") && rendered.includes('id="support-toast-desc"'));
  assert.ok(rendered.includes('aria-label="Close"'));
});

test('respects prefers-reduced-motion', () => {
  assert.ok(source.includes('useReducedMotion()'));
  // The genie is the entrance; with reduced motion there is no genie, so
  // the column fades in instead.
  assert.ok(rendered.includes("initial={reduced ? 'hidden' : false}"));
  assert.ok(rendered.includes("transform: ctaActive && !reduced ? 'translateX(3px)'"));
});

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function parseColour(value, ground) {
  if (value.startsWith('#')) return hexToRgb(value);
  const m = value.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  assert.ok(m, `unparseable colour ${value}`);
  const [r, g, b, a] = [+m[1], +m[2], +m[3], +m[4]];
  return [r, g, b].map((c, i) => a * c + (1 - a) * ground[i]);
}
function luminance([r, g, b]) {
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function inkSet(name) {
  const block = source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`));
  assert.ok(block, `${name} missing`);
  return Object.fromEntries([...block[1].matchAll(/(\w+):\s*'([^']+)'/g)].map(m => [m[1], m[2]]));
}

for (const [name, groundHex] of [['INK_DARK', '#1C1C1E'], ['INK_LIGHT', '#F7F8FC']]) {
  test(`${name} clears WCAG AA on its own ground (${groundHex})`, () => {
    assert.ok(source.includes(`'${groundHex}'`), `the card ground ${groundHex} is still what ships`);
    const ground = hexToRgb(groundHex);
    const ink = inkSet(name);
    assert.ok(contrast(parseColour(ink.strong, ground), ground) >= 7, `${name}.strong below 7:1`);
    // "faint" is "Maybe later", a control: no tier may drop under 4.5:1.
    for (const tier of ['body', 'quiet', 'faint']) {
      const ratio = contrast(parseColour(ink[tier], ground), ground);
      assert.ok(ratio >= 4.5, `${name}.${tier} is ${ratio.toFixed(2)}:1, below AA`);
    }
  });
}

// ─── Design contracts ───────────────────────────────────────────

test('split layout with the support art, one tree for both themes', () => {
  assert.ok(source.includes("import supportArt from '../assets/cards/support.jpg'"));
  assert.match(rendered, /backgroundImage:\s*`url\(\$\{supportArt\}\)`/);
  assert.ok(!/isLight\s*\?\s*\(\s*</.test(rendered), 'no JSX forked on the theme');
  assert.ok(rendered.includes("background: isLight ? '#F7F8FC' : '#1C1C1E'"));
});

test('the scrim dims but never blurs the launcher', () => {
  assert.ok(!/backdropFilter|WebkitBackdropFilter|backdrop-blur/.test(rendered));
});

test('nothing animates forever', () => {
  // The old card ran an infinite border gradient and a wave loop. A card that
  // is sitting still waiting for a decision should be still.
  assert.ok(!/\binfinite\b|repeat:\s*Infinity/.test(rendered), 'no perpetual animation');
  assert.ok(!/@keyframes/.test(rendered), 'no keyframe loops');
});

test('CTA is outlined and neutral; the image carries the colour', () => {
  assert.ok(rendered.includes('Support the Builder'));
  assert.ok(!/#FF6A5C|#E55B4D|rose-500/i.test(rendered), 'no coral left in the chrome');
  assert.ok(rendered.includes("transform: ctaPressed && !reduced ? 'scale(0.97)' : 'none'"));
  assert.ok(!/transition:[^`']*\ball\b/.test(rendered), 'never transition all');
});

test('exits are quicker than entrances', () => {
  const n = name => Number(source.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`))[1]);
  assert.ok(n('CTA_OUT') < n('CTA_IN'));
  assert.ok(n('PLATE_ZOOM_OUT') < n('PLATE_ZOOM_IN'));
});

test('copy is present, sentence case, and dash-free', () => {
  for (const s of ['Support Natively', 'Built by one.', 'Used by thousands.', 'Support the Builder', 'Maybe later']) {
    assert.ok(rendered.includes(s), `missing copy: ${s}`);
  }
  assert.ok(!/textTransform:\s*'uppercase'|\buppercase\b/.test(rendered), 'no tracked-out caps');
  for (const glyph of ['—', '–', '−']) {
    assert.ok(!rendered.includes(glyph), `rendered copy contains ${glyph}`);
  }
});
