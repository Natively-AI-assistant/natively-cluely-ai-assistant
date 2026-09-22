/**
 * BrowserExtensionToaster.test.mjs
 *
 * Source-level tests for the browser-extension onboarding toaster. This
 * project runs `node --test` with no JSX renderer, so the component is read
 * as text and its contracts asserted directly:
 *
 *   1. Behaviour: dismiss key, Chrome Store URL, auto-dismiss on connect,
 *      Escape / backdrop dismissal, the test hook, safe preload access.
 *   2. Accessibility: dialog semantics, and WCAG contrast COMPUTED from the
 *      ink tokens themselves, so the ratios quoted in the source comments
 *      cannot drift from the values that actually ship.
 *   3. Design contracts that are easy to regress silently: one split layout
 *      for both themes, a scrim that dims but never blurs, an outlined CTA
 *      whose hover channels all move, and dash-free copy.
 *
 * Gating (version floor, cooldowns, "extension already connected") is the
 * onboarding orchestrator's job and is covered in src/lib/onboarding/.
 *
 * Run: node --test src/components/onboarding/__tests__/BrowserExtensionToaster.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../BrowserExtensionToaster.tsx'), 'utf8');

// What reaches the screen: the source with every comment removed. Copy and
// styling rules apply to rendered code, not to prose explaining it.
const rendered = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\n]*?\/\/[^\n]*$/gm, '');

// ─── Behaviour ──────────────────────────────────────────────────

test('versionGte: boundary cases', () => {
  // Re-derived from the component; the export is a .tsx the runner cannot load.
  function versionGte(a, b) {
    const pa = a.split('.').map(n => parseInt(n, 10));
    const pb = b.split('.').map(n => parseInt(n, 10));
    for (let i = 0; i < 3; i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return true;
      if (na < nb) return false;
    }
    return true;
  }
  assert.equal(versionGte('2.8.0', '2.8.0'), true);
  assert.equal(versionGte('2.8.1', '2.8.0'), true);
  assert.equal(versionGte('3.0.0', '2.8.0'), true);
  assert.equal(versionGte('2.7.9', '2.8.0'), false);
  assert.equal(versionGte('10.0.0', '2.8.0'), true);
  assert.equal(versionGte('1.0.0', '2.8.0'), false);
  assert.match(source, /export function versionGte\(a: string, b: string = MIN_VERSION\)/,
    'the component still exports the comparator this test mirrors');
});

test('dismiss key is the documented one', () => {
  assert.match(source, /const\s+DISMISS_KEY\s*=\s*'natively_ext_connect_dismissed_v1'/);
});

test('CTA opens the canonical Chrome Web Store listing', () => {
  assert.ok(source.includes('chromewebstore.google.com/detail/lmhgnkbjnelmciecjkleaomjpejcgaln'));
  assert.ok(source.includes('utm_source=item-share-cb'));
  assert.ok(source.includes('window.electronAPI?.openExternal?.(CHROME_STORE_URL)'));
});

test('install closes the card WITHOUT the permanent dismiss', () => {
  // A user who opens the store but does not install should see this again.
  const install = source.slice(source.indexOf('const handleInstall'), source.indexOf('// ─── Auto-dismiss'));
  assert.ok(install.includes('onDismiss()'));
  assert.ok(!install.includes('DISMISS_KEY'), 'install must not set the permanent flag');
});

test('auto-dismisses the moment the extension connects', () => {
  assert.ok(source.includes('window.electronAPI?.onPhoneMirrorStatus?.(info =>'));
  assert.ok(source.includes('if (info?.extensionConnected)'));
  assert.ok(source.includes('return () => { unsub?.(); };'), 'subscription is cleaned up');
});

test('Escape and backdrop click both dismiss permanently', () => {
  assert.ok(source.includes("if (e.key === 'Escape') handlePermanentDismiss();"));
  assert.ok(source.includes('if (e.target === e.currentTarget) handlePermanentDismiss();'));
});

test('"Not now" dismisses and reports the skip', () => {
  const notNow = source.slice(source.indexOf('const handleNotNow'), source.indexOf('const handleInstall'));
  assert.ok(notNow.includes('handlePermanentDismiss()'));
  assert.ok(notNow.includes('onSkip?.()'));
});

test('?extToaster=force test hook still bypasses the orchestrator', () => {
  assert.ok(source.includes(".get('extToaster') === 'force'"));
});

test('every electronAPI access is optional-chained', () => {
  const calls = rendered.match(/window\.electronAPI[^\s(;]*/g) || [];
  assert.ok(calls.length >= 2);
  for (const c of calls) {
    assert.ok(c.startsWith('window.electronAPI?.'), `unsafe access: ${c}`);
  }
});

// ─── Accessibility ──────────────────────────────────────────────

test('dialog semantics point at elements that exist', () => {
  assert.ok(rendered.includes('role="dialog"'));
  assert.ok(rendered.includes('aria-modal="true"'));
  assert.ok(rendered.includes('aria-labelledby="ext-toast-title"') && rendered.includes('id="ext-toast-title"'));
  assert.ok(rendered.includes('aria-describedby="ext-toast-desc"') && rendered.includes('id="ext-toast-desc"'));
  assert.ok(rendered.includes('aria-label="Close"'));
});

test('respects prefers-reduced-motion', () => {
  assert.ok(source.includes('useReducedMotion()'));
  assert.ok(source.includes('const item = reduced ? ITEM_REDUCED : ITEM;'));
  assert.ok(rendered.includes("transform: ctaActive && !reduced ? 'translateX(3px)'"),
    'the arrow does not travel under reduced motion');
});

// WCAG relative luminance / contrast, computed from the shipped tokens.
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
    assert.deepEqual(Object.keys(ink).sort(), ['body', 'faint', 'quiet', 'strong']);
    // strong carries the 44px headline and the figures, so it gets the AAA bar.
    assert.ok(contrast(parseColour(ink.strong, ground), ground) >= 7, `${name}.strong below 7:1`);
    // Every other tier is 12-13.5px text, and "faint" is the "Not now" CONTROL:
    // none of them may drop under 4.5:1 however quiet they are meant to look.
    for (const tier of ['body', 'quiet', 'faint']) {
      const ratio = contrast(parseColour(ink[tier], ground), ground);
      assert.ok(ratio >= 4.5, `${name}.${tier} is ${ratio.toFixed(2)}:1, below AA`);
    }
  });
}

// ─── Design contracts ───────────────────────────────────────────

test('one split layout serves both themes', () => {
  assert.ok(source.includes("import beBlack from '../../../assets/BE-black.png'"));
  assert.ok(/backgroundImage:\s*`url\(\$\{beBlack\}\)`/.test(rendered), 'the panel shows BE-black');
  assert.ok(!/earthbg|earthwhite/i.test(source), 'the earth plates are gone');
  // No per-theme layout branch: only colours may depend on the theme.
  assert.ok(!/isLight\s*\?\s*\(\s*</.test(rendered), 'no JSX forked on the theme');
  assert.ok(rendered.includes("background: isLight ? '#F7F8FC' : '#1C1C1E'"));
});

test('the scrim dims but never blurs the launcher', () => {
  // 3a9901ae4 removed backdrop blur from every onboarding scrim: frosting the
  // whole launcher left it unreadable. Any backdrop-filter is a regression.
  assert.ok(!/backdropFilter|WebkitBackdropFilter/.test(rendered));
});

test('close sits on the image panel with dark ink in both themes', () => {
  const close = rendered.slice(rendered.indexOf('aria-label="Close"') - 200);
  assert.ok(close.includes('CLOSE_LIGHT.rest'), 'the panel is light in both themes');
  // The close is a control, so its resting ink must clear 3:1 (WCAG 1.4.11)
  // on the panel it sits on.
  assert.ok(source.includes("background: '#E6E8EE'"), 'the panel ground is still what ships');
  const rest = source.match(/const CLOSE_LIGHT = \{ rest: '([^']+)'/)[1];
  const panel = hexToRgb('#E6E8EE');
  const ratio = contrast(parseColour(rest, panel), panel);
  assert.ok(ratio >= 3, `close rest ink is ${ratio.toFixed(2)}:1, below 3:1`);
});

test('CTA is outlined, and every hover channel moves', () => {
  assert.ok(rendered.includes('Add to Chrome'));
  assert.ok(rendered.includes("ctaActive ? 'rgba(255,255,255,0.44)' : 'rgba(255,255,255,0.24)'"),
    'dark outline brightens on hover');
  assert.ok(rendered.includes("ctaActive ? 'rgba(11,16,32,0.46)' : 'rgba(11,16,32,0.22)'"),
    'light outline darkens on hover');
  assert.ok(rendered.includes('color: ctaActive ? INK.strong'), 'label strengthens on hover');
  assert.ok(rendered.includes("transform: ctaPressed && !reduced ? 'scale(0.97)' : 'none'"),
    'press compresses the button');
  assert.ok(!/transition:[^`']*\ball\b/.test(rendered), 'never transition all');
});

test('exits are quicker than entrances', () => {
  const n = name => Number(source.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`))[1]);
  assert.ok(n('CTA_OUT') < n('CTA_IN'));
  assert.ok(n('PLATE_ZOOM_OUT') < n('PLATE_ZOOM_IN'));
});

test('copy is present and dash-free', () => {
  for (const s of ['Natively for Chrome', 'Skip the', 'Screenshot.', 'Add to Chrome', 'Not now',
    'Faster', 'Fewer Tokens', 'Screenshots']) {
    assert.ok(rendered.includes(s), `missing copy: ${s}`);
  }
  for (const glyph of ['—', '–', '−']) {
    assert.ok(!rendered.includes(glyph), `rendered copy contains ${glyph}`);
  }
});
