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
const genie = await import('../genieMotion.mjs');
const source = readFileSync(resolve(__dirname, '../BrowserExtensionToaster.tsx'), 'utf8');

// What reaches the screen: the source with every comment removed. Copy and
// styling rules apply to rendered code, not to prose explaining it.
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\n]*?\/\/[^\n]*$/gm, '');
const rendered = stripComments(source);

// The card opens and closes through GenieModal, like every other popup; the
// genie itself lives in useGenieCard underneath it. Their contracts are
// asserted against those files.
const hookSource = readFileSync(resolve(__dirname, '../useGenieCard.ts'), 'utf8');
const hook = stripComments(hookSource);
const modal = stripComments(readFileSync(resolve(__dirname, '../../ui/GenieModal.tsx'), 'utf8'));

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
  assert.ok(rendered.includes('onBackdropClick={handlePermanentDismiss}'));
  assert.ok(modal.includes('if (e.target === e.currentTarget && !closing) onBackdropClick?.();'),
    'a click on the dim, not on the card');
});

test('"Not now" dismisses permanently and reports the skip', () => {
  const notNow = source.slice(source.indexOf('const handleNotNow'), source.indexOf('const handleInstall'));
  assert.ok(notNow.includes('persistDismiss()'));
  assert.ok(notNow.includes('onDismiss(); onSkip?.();'), 'both reports wait for the exit, in order');
});

// ─── Close sequencing ───────────────────────────────────────────
// OrchestratedToasterHost returns null the moment it hears onDismiss, which
// unmounts this component and cuts any exit animation off. The card has to
// close itself first and report after.

test('every way out plays the genie before reporting to the host', () => {
  const handlers = rendered.slice(rendered.indexOf('const handlePermanentDismiss'), rendered.indexOf('const item = reduced'));
  // No handler may call the host directly: only through closeThen.
  const direct = handlers.match(/^\s*onDismiss\(\);/gm) || [];
  assert.equal(direct.length, 0, 'onDismiss called outside closeThen');
  assert.ok(handlers.includes('closeThen(onDismiss)'), 'Escape, backdrop and close');
  assert.ok(handlers.includes('closeThen(() => onDismiss())'), 'install');
  assert.ok(hook.includes('Promise.all([a, b]).then(() => { if (!live) return; setDone(true); finishClose(); });'),
    'reports once the card and scrim have both finished');
  assert.ok(hook.includes('cleanup = () => { live = false; clearTimeout(t); a.stop(); b.stop(); stopTrack(); runRef.current = null; };'),
    'a close the backstop already released cannot mark a later open as done');
  assert.ok(hook.includes('const shown = isOpen && !done;'));
  // The card keeps its own open state and reports once GenieModal says the
  // close has played.
  assert.ok(rendered.includes('open={visible}'));
  assert.ok(rendered.includes('setVisible(isOpen || testForceShow);'));
  assert.ok(rendered.includes('onClosed={() => { const after = afterCloseRef.current; afterCloseRef.current = null; after?.(); }}'));
  const own = rendered.slice(rendered.indexOf('const closeThen'), rendered.indexOf('const persistDismiss'));
  assert.ok(own.includes('if (afterCloseRef.current) return;'), 'the first way out wins');
  assert.ok(own.includes('setVisible(false);'));
  assert.ok(!/after\s*\(/.test(own), 'closeThen only schedules the report');
});

test('pours out of one picture of itself, like every other popup', () => {
  // useGenieCard on its own has no pictures, so it pours dozens of live copies
  // of the card: the stutter the picture genie replaced. GenieModal hands it
  // the pictures.
  assert.ok(source.includes("import { GenieModal } from '../ui/GenieModal';"));
  assert.ok(rendered.includes('<GenieModal') && rendered.includes('label="BrowserExtensionToaster"'));
  assert.ok(!/useGenieCard/.test(rendered), 'no direct hook: that is the live-copy genie');
  assert.ok(modal.includes('const genie = useGenieCard(presence.mounted, label, {') && modal.includes('    snapshots,'),
    'GenieModal gives the hook its pictures');
  // A picture of the card opening the store must not be the next open's.
  assert.ok(rendered.includes('keepPictures={!opening}'));
  const reset = rendered.slice(rendered.indexOf('if (!visible) { setPlateHover(false);'), rendered.indexOf('const item = reduced'));
  assert.ok(!reset.includes('setOpening(false)'), 'opening stays set through the close picture');
});

test('a close that never finishes animating still releases the slot', () => {
  // Chromium stops animation frames in a hidden window; the genie would never
  // complete and the onboarding queue would stall behind this card.
  assert.ok(hook.includes('setTimeout(finishClose, CLOSE_FALLBACK_MS)'));
  const n = Number(hookSource.match(/const CLOSE_FALLBACK_MS\s*=\s*(\d+)/)[1]);
  const close = Number(hookSource.match(/const GENIE_CLOSE\s*=\s*\{ duration: ([\d.]+)/)[1]) * 1000;
  assert.ok(n > close + 100, 'the backstop must not cut a healthy close short');
  assert.ok(n <= 1000, 'but it must release the slot promptly');
});

test('the report fires once, however many ways out are taken', () => {
  const closeThen = hook.slice(hook.indexOf('const closeThen'), hook.indexOf('const finishClose'));
  assert.ok(closeThen.includes('if (afterCloseRef.current) return;'));
  assert.ok(!/report\s*\(/.test(closeThen), 'closeThen only schedules the report; calling it here would unmount the card mid-genie');
  const start = hook.indexOf('const finishClose');
  const finish = hook.slice(start, hook.indexOf('useEffect', start));
  assert.ok(finish.includes('afterCloseRef.current = null;'), 'cleared before the report, so the fallback cannot repeat it');
});

test('clicks pass through while the card drains away', () => {
  // Otherwise "Add to Chrome" could still be hit mid-close.
  assert.ok(modal.includes("pointerEvents: closing ? 'none' : 'auto'"));
  assert.ok(modal.includes("...(closing ? { pointerEvents: 'none' } : null)"), 'the dim too');
});

test('the genie is drawn by one per-frame write, straight to the DOM', () => {
  assert.ok(hookSource.includes("from './genieMotion.mjs'"));
  assert.ok(hook.includes("useEffect(() => genie.on('change', renderGenie), [genie, renderGenie]);"));
  assert.ok(!/useTransform\(/.test(hook), 'no per-property transforms recomputing the same frame');
  assert.ok(hook.includes('const r = wrapRef.current?.getBoundingClientRect();'),
    'the transformed card cannot report its resting position; the wrapper can');
  assert.ok(hook.includes('slotY: window.innerHeight - SLOT_INSET'), 'the slot is at the bottom of the window');
  assert.ok(hook.includes('animate(genie, 1, reduced ? REDUCED_FADE : GENIE_CLOSE)'));
  assert.ok(hook.includes('animate(genie, 0, reduced ? REDUCED_FADE : GENIE_OPEN)'));
});

test('the content warps with the funnel: bands of the card, not a clipped card', () => {
  assert.ok(hook.includes('const transforms = genieBands(p, geom, rows);'));
  assert.ok(hook.includes("card.style.visibility = 'hidden';"),
    'visibility, not display: the wrapper must keep its size for the measurement');
  // A band is a picture of the card, never a second dialog (sanitizeCopy).
  const build = hook.slice(hook.indexOf('const buildBands'), hook.indexOf('const clearBands'));
  assert.ok(build.includes('sanitizeCopy(copy);'));
  for (const attr of ['role', 'aria-modal', 'aria-labelledby', 'aria-describedby']) {
    assert.ok(hook.includes(`copy.removeAttribute('${attr}');`), attr);
  }
  assert.ok(hook.includes("querySelectorAll<HTMLElement>('[id]').forEach(el => el.removeAttribute('id'))"), 'no duplicate ids');
  assert.ok(hook.includes("el.style.willChange = 'auto';"), 'no layer per copy per promoted child');
  assert.ok(modal.includes('ref={bandsRef}') && /ref=\{bandsRef\}\s*aria-hidden\s*inert/.test(modal),
    'the band layer is hidden from assistive tech and unreachable by keyboard');
});

test('the bands exist only while the genie runs', () => {
  const rest = hook.slice(hook.indexOf('if ((p <= 0.001 && settling) || !geom) {'), hook.indexOf('if (!rowsRef.current'));
  assert.ok(rest.includes('clearBands();'));
  assert.ok(rest.includes("card.style.visibility = '';"));
});

test('if the bands cannot be built, the outline genie still runs', () => {
  assert.ok(hook.includes('bandsFailedRef.current = !buildBands();'));
  assert.ok(hook.includes('const f = genieFrame(p, geom);'));
});

test('the shadow is moved, never re-rasterised', () => {
  assert.ok(!/drop-shadow|filter: liftShadow/.test(rendered + hook), 'no per-frame filter');
  assert.ok(rendered.includes('shadow={isLight ? SHADOW_LIGHT : SHADOW_DARK}'), 'the stand-in is the card\'s own shadow');
  assert.ok(modal.includes('boxShadow: shadow,'));
  assert.ok(rendered.includes("' + SHADOW_LIGHT") && rendered.includes("' + SHADOW_DARK"), 'shared with the card, so the hand-over is exact');
  assert.ok(hook.includes('shadow.style.opacity = String(genieShadowOpacity(p, geom));'),
    'gone within a few px of the card pinching in (GenieModal.test.mjs executes it)');
});

test('the genie does not bring the content in twice', () => {
  assert.ok(rendered.includes("variants={STAGGER} initial={reduced ? 'hidden' : false} animate=\"show\""));
});

test('reduced motion gets a plain fade, with no warp or travel', () => {
  const reducedBranch = hook.slice(hook.indexOf('if (reduced) {'), hook.indexOf('if ((p <= 0.001 && settling) || !geom) {'));
  assert.ok(reducedBranch.includes('card.style.opacity = String(1 - p);'));
  assert.ok(reducedBranch.includes('return;'));
});

// ─── Genie geometry (executed, not read) ────────────────────────
// A 600x440 card centred in a 1200x800 launcher, as it ships.
const GEOM = { top: 180, bottom: 620, width: 600, slotY: 800 - genie.SLOT_INSET };

test('genie: at rest the card is whole, unclipped and in place', () => {
  assert.deepEqual(genie.genieFrame(0, GEOM), { transform: 'none', clipPath: 'none', opacity: 1 });
  assert.deepEqual(genie.genieFrame(0.5, null), { transform: 'none', clipPath: 'none', opacity: 1 },
    'unmeasured: no warp rather than a warp from nonsense');
});

test('genie: it ends at the bottom centre, slot-wide, and gone', () => {
  const { top, bottom } = genie.genieEdges(1, GEOM);
  assert.equal(top, GEOM.slotY);
  assert.equal(bottom, GEOM.slotY);
  assert.ok(GEOM.slotY < 800 && GEOM.slotY > 790, 'the slot is inside the window, at its bottom');
  assert.equal(genie.genieHalfWidthAt(1, GEOM, GEOM.slotY), genie.SLOT_WIDTH / 2);
  assert.equal(genie.genieOpacity(1), 0);
  // Symmetric about the card's centre line, which is the window's.
  const pts = genie.genieFrame(0.99, GEOM).clipPath.replace(/^polygon\(|\)$/g, '').split(', ');
  const xs = pts.map(pt => parseFloat(pt));
  assert.ok(Math.abs(Math.max(...xs) + Math.min(...xs) - 100) < 0.02, 'centred');
});

test('genie: the funnel is fixed on screen, not carried with the card', () => {
  // The same screen row has the same width whether the card's top edge is
  // still high or already halfway down: the card moves through the funnel.
  const y = 700;
  const early = genie.genieHalfWidthAt(0.6, GEOM, y);
  const late = genie.genieHalfWidthAt(0.9, GEOM, y);
  assert.ok(Math.abs(early - late) < 1e-9, `${early} vs ${late}`);
});

test('genie: the bottom stretches into the slot before the top starts down', () => {
  assert.equal(genie.genieDrain(0.3), 0, 'the top holds while the funnel forms');
  const e = genie.genieEdges(0.3, GEOM);
  assert.equal(e.top, GEOM.top);
  assert.ok(e.bottom > GEOM.bottom + 50, 'the bottom edge is already reaching down');
});

test('genie: the sides bow in an S-curve, and the top corners stay square', () => {
  const p = 0.3;   // funnel formed, top edge not yet moving
  const { top, bottom } = genie.genieEdges(p, GEOM);
  const at = u => genie.genieHalfWidthAt(p, GEOM, top + u * (bottom - top));
  assert.equal(at(0), GEOM.width / 2, 'top edge full width');
  assert.ok(at(0.25) > at(0) + (at(1) - at(0)) * 0.25 + 1, 'not a straight taper');
  assert.ok(at(1) < at(0.5) && at(0.5) < at(0), 'narrows downward');
});

test('genie: every quantity moves one way only, so the open is the close reversed', () => {
  let prev = { top: -Infinity, bottom: -Infinity, w: Infinity, o: Infinity };
  for (let p = 0; p <= 1.0001; p += 0.02) {
    const { top, bottom } = genie.genieEdges(p, GEOM);
    const w = genie.genieHalfWidthAt(p, GEOM, 700), o = genie.genieOpacity(p);
    assert.ok(top >= prev.top - 1e-9 && bottom >= prev.bottom - 1e-9 && w <= prev.w + 1e-9 && o <= prev.o + 1e-9,
      `jump at p=${p.toFixed(2)}`);
    prev = { top, bottom, w, o };
  }
});

test('genie: the clip path is a polygon of fixed size inside the card', () => {
  const pts = genie.genieFrame(0.5, GEOM).clipPath.replace(/^polygon\(|\)$/g, '').split(', ');
  assert.equal(pts.length, 42, 'a fixed point count, so it tweens without popping');
  for (const pt of pts) {
    const [x, y] = pt.split(' ').map(parseFloat);
    assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100, pt);
  }
});

test('bands: whole-pixel rows that tile the card exactly', () => {
  for (const [h, n] of [[440, 48], [437, 48], [300, 7]]) {
    const rows = genie.genieBandRows(h, n);
    assert.equal(rows[0][0], 0);
    assert.equal(rows.at(-1)[1], h);
    for (let i = 0; i < rows.length; i++) {
      assert.ok(Number.isInteger(rows[i][0]) && Number.isInteger(rows[i][1]), `row ${i} is whole pixels`);
      if (i) assert.equal(rows[i][0], rows[i - 1][1], `row ${i} continues the last`);
    }
  }
});

// Apply a matrix3d to a point, perspective divide included.
const apply = (m3d, x, y) => {
  const M = m3d.match(/\(([^)]+)\)/)[1].split(',').map(Number);
  const w = M[3] * x + M[7] * y + M[15];
  return [(M[0] * x + M[4] * y + M[12]) / w, (M[1] * x + M[5] * y + M[13]) / w];
};

test('bands: quadMatrix3d lands every corner exactly', () => {
  const q = [[10, 5], [90, 5], [70, 25], [30, 25]];
  const m = genie.quadMatrix3d(100, 20, q);
  [[0, 0], [100, 0], [100, 20], [0, 20]].forEach(([x, y], i) => {
    const [X, Y] = apply(m, x, y);
    assert.ok(Math.abs(X - q[i][0]) < 1e-6 && Math.abs(Y - q[i][1]) < 1e-6, `corner ${i}: ${X},${Y}`);
  });
});

test('bands: each band sits on the funnel, and neighbours share an edge', () => {
  // To a thousandth of a pixel: the matrix is serialised to 10 significant figures.
  const H = GEOM.bottom - GEOM.top;
  const rows = genie.genieBandRows(H, 48);
  for (const p of [0.2, 0.5, 0.8]) {
    const mats = genie.genieBands(p, GEOM, rows);
    const { top, bottom } = genie.genieEdges(p, GEOM);
    const span = bottom - top;
    mats.forEach((m, i) => {
      const [r0, r1] = rows[i];
      // Band-local corners -> screen (the band sits at GEOM.top + r0).
      const tl = apply(m, 0, 0), br = apply(m, GEOM.width, r1 - r0);
      const y0 = GEOM.top + r0 + tl[1], y1 = GEOM.top + r0 + br[1];
      assert.ok(Math.abs(y0 - (top + (r0 / H) * span)) < 1e-3, `p=${p} band ${i} top row`);
      assert.ok(Math.abs(y1 - (top + (r1 / H) * span)) < 1e-3, `p=${p} band ${i} bottom row`);
      const half = genie.genieHalfWidthAt(p, GEOM, y0);
      assert.ok(Math.abs(tl[0] - (GEOM.width / 2 - half)) < 1e-3, `p=${p} band ${i} left edge on the funnel`);
      if (i) {
        const prevBottomLeft = apply(mats[i - 1], 0, rows[i - 1][1] - rows[i - 1][0]);
        assert.ok(Math.abs(GEOM.top + rows[i - 1][0] + prevBottomLeft[1] - y0) < 1e-3
          && Math.abs(prevBottomLeft[0] - tl[0]) < 1e-3, `p=${p} seam ${i} shared`);
      }
    });
  }
});

test('closing is quicker than opening', () => {
  const open = Number(hookSource.match(/const GENIE_OPEN\s*=\s*\{ duration: ([\d.]+)/)[1]);
  const close = Number(hookSource.match(/const GENIE_CLOSE\s*=\s*\{ duration: ([\d.]+)/)[1]);
  assert.ok(close < open);
});

// ─── Accessibility ──────────────────────────────────────────────

test('dialog semantics point at elements that exist', () => {
  assert.ok(rendered.includes("role: 'dialog'"));
  assert.ok(rendered.includes("'aria-modal': true"));
  assert.ok(rendered.includes("'aria-labelledby': 'ext-toast-title'") && rendered.includes('id="ext-toast-title"'));
  assert.ok(rendered.includes("'aria-describedby': 'ext-toast-desc'") && rendered.includes('id="ext-toast-desc"'));
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
  assert.ok(source.includes("import chromeArt from '../../assets/cards/chrome.jpg'"));
  assert.ok(/backgroundImage:\s*`url\(\$\{chromeArt\}\)`/.test(rendered), 'the panel shows the Chrome art');
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
