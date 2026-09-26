// Regression check: the Plans & Billing pricing surfaces must keep the Liquid
// Glass material — see src/ui-components/design.md — and must keep it on the
// SHIPPING interface theme, in both colour themes.
//
// Run: npm run test:css:pricing-liquid-glass
//
// Why this exists. Every assertion below corresponds to something that was
// measured true of the shipped stylesheet before the rules it guards were
// written, or to a failure mode design.md names:
//
//   1. THE DEFAULT THEME IS THE SHIPPING ONE. getMeetingInterfaceTheme()
//      returns 'default' (src/lib/meetingInterfaceTheme.ts:17) unless the user
//      picks otherwise, and NativelyApiSettings / NativelyProSettings write it
//      straight onto their roots. `default` matches [data-interface-theme]
//      (presence) and matches NEITHER ="liquid-glass" NOR ="modern". Half of
//      the pricing CSS is anchored on those two values, and everything anchored
//      there is invisible to almost every user. The measured consequences:
//      all three cards rendered at `border-radius: 0px`, and the three purchase
//      buttons rendered with `background: rgba(0,0,0,0)` and
//      `box-shadow: none` — no material at all. THIS is why the fixture drives
//      "default" first and asserts on it. A fixture that only exercised
//      "liquid-glass" would have passed the whole time the bug was shipping.
//
//   2. The cap fade must be LENGTHS, and derived from the corner. design.md's
//      stops are percentages of the width of ONE pill; on a wider surface a
//      percentage lands inside the flat top face and the rim spends its
//      brightest stretch fading across something that is not curved. That is
//      failure mode 2 in cta-liquid-glass.check.mjs and it has shipped twice.
//      The fix is stops tied to the radius the specular actually dies across,
//      which is also width-invariant — asserted by rendering the same surface
//      at two widths and requiring an identical computed mask.
//
//   3. The light rim must NOT be symmetric. On a light ground there is no
//      bounce from below, so the specular stays on the top face, the underside
//      darkens and a contact shadow does the rest (design.md, "Light mode is
//      derived, not measured"). The shipped light override changed only
//      `box-shadow` and inherited the dark mask, so the underside stayed lit.
//
//   4. One hairline ring, not three. A 3px rim is 2% of the 136px hero and 9%
//      of a 32px control; design.md calls it "visibly chunky by 44px", which is
//      the height of these pills, and .lg-sm collapses it for that reason.
//
//   5. The radius tokens must track the box. --lgc-r is the cap radius the
//      whole fade is derived from; on a pill it is half the height, and a
//      height change that does not move it silently detunes every stop.
//
// Why Electron rather than a text assertion on the stylesheet: nearly all of
// these are cascade outcomes. The presence-anchored rules have to beat
// value-anchored rules of IDENTICAL specificity on source order alone, and the
// light rules have to beat (0,3,0) light rules the same way. Reading the rules
// cannot tell you who wins. This resolves them in the real engine.
//
// A note on what is NOT asserted: no mean-absolute-error against a reference.
// design.md's reference is a 1206x410 shot of OPAQUE pills; there is nothing in
// it to sample for a 300px translucent card over a blurred backdrop, and a
// slice through one measures the backdrop rather than the material. Items 3
// and 2 are derived the way design.md says light mode was derived, not
// sampled, and this check guards the CSS that produces them.
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const SOURCE = resolve(process.cwd(), 'src/index.css');

function loadCss() {
  if (!existsSync(SOURCE)) {
    throw new Error(
      `stylesheet not found at ${SOURCE} — run this from the repo root ` +
        `(npm run test:css:pricing-liquid-glass), not from a subdirectory. This is a ` +
        `harness problem, not a CSS regression.`,
    );
  }
  // The three @tailwind directives are the only thing in this file a browser
  // cannot parse; there is no @apply and no @layer (checked), so removing them
  // leaves every rule under test byte-identical to what ships. The utilities
  // they would have generated are supplied inline on the fixture nodes below,
  // which is also what keeps the fixture honest about geometry.
  return readFileSync(SOURCE, 'utf8').replace(/^@tailwind .*;$/gm, '');
}

// Real geometry, from the components. Pro cards sit two-up (`grid-cols-2
// gap-3`) in the settings panel; the API tier card spans it.
const CARD_W = 300;
const CARD_H = 200;
const WIDE_W = 640;   // the API tier card — the second width cap-fade invariance is proved at
const CTA_W = 240;
const CTA_H = 44;     // h-11
const PILL_H = 36;    // h-9, the teaser's pill

const surfaces = (theme) => `
<div data-interface-theme="${theme}">
  <div class="pricing-card-yearly" id="cardY" style="width:${CARD_W}px;height:${CARD_H}px"></div>
  <div class="pricing-card-lifetime" id="cardL" style="width:${CARD_W}px;height:${CARD_H}px"></div>
  <div class="natively-api-detail-card natively-api-detail-card-pro" id="cardApi" style="width:${WIDE_W}px;height:220px"></div>
  <!-- all four tiers, resting and active: the per-tier hue moved out of the
       border and onto the rim, and the luminance ladder those alphas encode
       has to survive the move. -->
  ${['standard','pro','max','ultra'].map((t) => `
  <div class="natively-api-detail-card natively-api-detail-card-${t}" id="tier-${t}" style="width:${WIDE_W}px;height:220px">
    <button class="natively-api-pricing-cta" id="tierCta-${t}" style="width:240px"></button>
    <span class="natively-api-fill-pill" id="tierPill-${t}" style="display:inline-flex;padding:3px 10px;border-radius:999px">BEST VALUE</span>
  </div>
  <div class="natively-api-detail-card natively-api-detail-card-${t}" id="tierA-${t}" data-active="true" style="width:${WIDE_W}px;height:220px"></div>`).join('')}
  <button class="natively-api-pricing-cta natively-api-pricing-cta-max" id="apiCta" style="width:240px"></button>
  <button class="natively-api-pricing-cta natively-api-pricing-cta-neutral" id="apiCtaN" style="width:240px"></button>
  <div class="natively-api-selector-bar"><button class="natively-api-selector-tab active" id="apiTab"></button></div>
  <button class="pricing-cta-yearly" id="ctaY" style="width:${CTA_W}px;height:${CTA_H}px;border-radius:9999px"></button>
  <!-- the CTA in its real 3D stack: an InteractiveCard is .perspective-1000 and
       the card sets preserve-3d, so the inline translateZ on the button is a
       magnification, not a no-op. -->
  <div class="perspective-1000" style="width:${CARD_W}px">
    <div style="transform-style:preserve-3d">
      <button class="pricing-cta-yearly" id="ctaZ" style="width:${CTA_W}px;height:${CTA_H}px;border-radius:9999px;transform:translateZ(28px)"></button>
    </div>
  </div>
  <button class="pricing-cta-lifetime" id="ctaL" style="width:${CTA_W}px;height:${CTA_H}px;border-radius:9999px"></button>
  <button class="pro-teaser" id="teaser" style="width:${WIDE_W}px;height:96px">
    <span class="pro-teaser-cta" id="teaserCta" style="display:inline-flex;height:${PILL_H}px;padding:0 16px;border-radius:9999px"></span>
  </button>
  <!-- a second, deliberately wider card: the cap fade must resolve identically
       in both, which is what "width-invariant" means and what a percentage
       breaks. -->
  <div class="pricing-card-yearly" id="cardYWide" style="width:${WIDE_W}px;height:${CARD_H}px"></div>
</div>`;

// Deliberately OUTSIDE any [data-interface-theme] wrapper. Every other rule on
// this screen is anchored on that attribute and half on a specific value, which
// is how the plan switcher, the tier CTA and the Pro card buttons all shipped as
// native OS controls. A usage meter must not depend on it at all.
const meters = `
  <div class="natively-meter-track" id="mTrack" style="height:3px;width:300px">
    <div class="natively-meter-fill" id="mFill" style="width:63%"></div>
  </div>
  <div class="natively-meter-track" style="height:3px;width:300px">
    <div class="natively-meter-fill natively-meter-fill--high" id="mHigh" style="width:86%"></div>
  </div>
  <div class="natively-meter-track" style="height:3px;width:300px">
    <div class="natively-meter-fill natively-meter-fill--over" id="mOver" style="width:100%"></div>
  </div>`;

const page = (css) => `<meta charset="utf-8"><style>
${css}
body { margin: 0; }
</style>
<body>
  <div data-theme="dark" id="darkRoot">${surfaces('default')}${meters}</div>
  <div data-theme="light" id="lightRoot">${surfaces('default')}${meters}</div>
  <div data-theme="dark" id="glassRoot">${surfaces('liquid-glass')}</div>
</body>`;

// ── colour helpers (same shapes as cta-liquid-glass.check.mjs) ───────────────
function rgb(color) {
  const s = String(color).trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) return null;
  const p = m[1].split(/[,/]/).map((x) => Number.parseFloat(x.trim()));
  if (p.length < 3 || p.some(Number.isNaN)) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
const lum = (c) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const countRings = (shadow) => (String(shadow).match(/inset/g) || []).length;

// Split the two mask layers at the horizontal one. Regexing them apart does not
// work: the stops carry their own parentheses (rgba(...)), and Chromium drops
// the default `180deg` from the computed value of the vertical layer.
const layers = (mask) => {
  const s = String(mask);
  const at = s.indexOf('linear-gradient(90deg');
  return at === -1 ? { vertical: s, horizontal: '' } : { vertical: s.slice(0, at).replace(/,\s*$/, ''), horizontal: s.slice(at) };
};
// Symmetry is decided by the LAST stop, not by whether a high percentage
// appears: a top-only mask still runs to 100%, it just runs there transparent.
const lastStop = (vertical) => {
  const open = vertical.indexOf('(');
  if (open === -1) return vertical;
  const inner = vertical.slice(open + 1, vertical.lastIndexOf(')'));
  const stops = [];
  let depth = 0, buf = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { stops.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  stops.push(buf.trim());
  return stops[stops.length - 1];
};
const opaqueEnd = (vertical) => !/rgba\([^)]*,\s*0\s*\)/.test(lastStop(vertical));

async function measure() {
  const win = new BrowserWindow({ width: 1100, height: 900, show: false });
  const fixture = join(tmpdir(), 'natively-pricing-liquid-glass.html');
  writeFileSync(fixture, page(loadCss()));
  try {
    await win.loadFile(fixture);
    return await win.webContents.executeJavaScript(`
      new Promise((r, reject) => requestAnimationFrame(() => requestAnimationFrame(() => {
       try {
        const read = (rootId, id) => {
          const el = document.getElementById(rootId).querySelector('#' + id);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const before = getComputedStyle(el, '::before');
          const after = getComputedStyle(el, '::after');
          const box = el.getBoundingClientRect();
          return {
            w: box.width, h: box.height,
            radius: cs.borderRadius,
            capR: cs.getPropertyValue('--lgc-r').trim(),
            zToken: cs.getPropertyValue('--lgc-z').trim(),
            bg: cs.backgroundColor,
            bgImage: cs.backgroundImage,
            fg: cs.color,
            shadow: cs.boxShadow,
            overflow: cs.overflow,
            borderW: cs.borderTopWidth,
            borderStyle: cs.borderTopStyle,
            beforeShadow: before.boxShadow,
            beforeMask: before.maskImage || before.webkitMaskImage,
            beforeImage: before.backgroundImage,
            beforeSize: before.backgroundSize,
            beforeComposite: before.maskComposite || before.webkitMaskComposite,
            afterShadow: after.boxShadow,
            afterMask: after.maskImage || after.webkitMaskImage,
            afterComposite: after.maskComposite || after.webkitMaskComposite,
          };
        };
        // Every AUTHORED rule that sets a transform on a pricing CTA. These
        // cannot be read off an element: :hover and :active cannot be produced
        // here, and prefers-reduced-motion cannot be forced. Mirroring them onto
        // a fixture class would assert the fixture, not the stylesheet.
        // Scoped to the rules THIS change authored, by document order. The
        // older value-anchored rules carry the same latent bug but are dead —
        // superseded on source order by the block below them — and were
        // deliberately left alone rather than edited to satisfy a check.
        // The marker is the one rule that declares --lgc-z, which opens that
        // block; anything after it in document order is in scope.
        const transformRules = [];
        let order = 0, marker = Infinity;
        (function walk(rules, media) {
          for (const rule of rules) {
            if (!rule.selectorText && rule.cssRules) {
              walk(rule.cssRules, (media ? media + ' ' : '') + (rule.conditionText || rule.media?.mediaText || ''));
              continue;
            }
            if (!rule.selectorText) continue;
            const n = order++;
            if (marker === Infinity && rule.style.getPropertyValue('--lgc-z')) marker = n;
            if (!/pricing-cta-yearly|pricing-cta-lifetime|pro-teaser-cta/.test(rule.selectorText)) continue;
            const t = rule.style.getPropertyValue('transform');
            if (t) transformRules.push({ selector: rule.selectorText, media, transform: t, order: n });
          }
        })([...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch { return []; } }), '');
        const inScope = transformRules.filter(r => r.order > marker);
        if (marker === Infinity) inScope.push({ selector: '(none)', media: '', transform: 'MARKER-MISSING' });

        const ids = ['cardY','cardL','cardApi','ctaY','ctaL','teaser','teaserCta','cardYWide','ctaZ',
          'apiCta','apiCtaN','apiTab','mTrack','mFill','mHigh','mOver',
          ...['standard','pro','max','ultra'].flatMap(t => ['tier-' + t, 'tierA-' + t, 'tierCta-' + t, 'tierPill-' + t])];
        const out = {};
        for (const root of ['darkRoot','lightRoot','glassRoot']) {
          out[root] = {};
          for (const id of ids) out[root][id] = read(root, id);
        }
        out.transformRules = inScope;
        r(out);
       } catch (e) { reject(new Error('fixture probe threw: ' + (e && e.stack || e))); }
      })));
    `);
  } finally {
    win.destroy();
    rmSync(fixture, { force: true });
  }
}

const failures = [];
const fail = (msg) => failures.push(msg);

// design.md's measured cap stops (24 / 62 / 142px) against the reference pill's
// own cap radius (136/2 = 68px). Everything here is that ratio times the
// surface's corner.
const CAP_RATIOS = [24 / 68, 62 / 68, 142 / 68];

app.whenReady().then(async () => {
  const m = await measure();
  const dark = m.darkRoot, light = m.lightRoot, glass = m.glassRoot;

  // ── 1. the default theme paints at all ─────────────────────────────────────
  // The regression that actually shipped. Asserted on "default" specifically.
  for (const [name, x, wantR] of [
    ['.pricing-card-yearly', dark.cardY, 28],
    ['.pricing-card-lifetime', dark.cardL, 28],
    ['.natively-api-detail-card', dark.cardApi, 26],
    ['.pro-teaser', dark.teaser, 20],
  ]) {
    if (!x) { fail(`${name}: not in the fixture`); continue; }
    const r = Number.parseFloat(x.radius);
    if (!(r > 0)) {
      fail(`${name} renders at border-radius: ${x.radius} on data-interface-theme="default" — the shipping theme. Radius lives only in the ="liquid-glass" / ="modern" blocks unless it is anchored on presence, and a square card is what the rim above it is being drawn on.`);
    } else if (Math.round(r) !== wantR) {
      fail(`${name} radius is ${x.radius}, expected ${wantR}px — the corner and --lgc-r must agree, because every cap stop is derived from it.`);
    }
    if (x.capR !== `${wantR}px`) fail(`${name} declares --lgc-r: ${x.capR || '(nothing)'}, expected ${wantR}px.`);
  }

  for (const [name, x] of [
    ['.pricing-cta-yearly', dark.ctaY],
    ['.pricing-cta-lifetime', dark.ctaL],
    ['.pro-teaser-cta', dark.teaserCta],
  ]) {
    if (!x) { fail(`${name}: not in the fixture`); continue; }
    const bg = rgb(x.bg);
    if (!bg || bg.a === 0) fail(`${name} has background ${x.bg} on data-interface-theme="default" — the shipping theme. Every rule for this button was anchored on ="liquid-glass" / ="modern", so it painted no material at all for almost every user.`);
    if (x.shadow === 'none') fail(`${name} has box-shadow: none on the default theme — no rim, no contact shadow, nothing.`);
    if (!/inset/.test(String(x.beforeShadow))) fail(`${name} has no rim on ::before (${x.beforeShadow}) — the depth in this material IS the rim.`);
  }

  // ── 5. the pill tokens track the box ───────────────────────────────────────
  for (const [name, x] of [['.pricing-cta-yearly', dark.ctaY], ['.pricing-cta-lifetime', dark.ctaL], ['.pro-teaser-cta', dark.teaserCta]]) {
    if (!x) continue;
    const r = Number.parseFloat(x.capR);
    if (!(Math.abs(r * 2 - x.h) < 0.6)) {
      fail(`${name} is ${x.h}px tall but declares --lgc-r: ${x.capR}. On a pill the cap radius is half the height; a height change that does not move this silently detunes every cap stop derived from it.`);
    }
  }

  // ── the 3D stack must survive every state ─────────────────────────────────
  // Both card CTAs carry an inline `transform: translateZ(28px)` inside a
  // preserve-3d card under .perspective-1000. An author !important transform
  // outranks a style-attribute one, so a :hover / :active / reduced-motion rule
  // that sets `transform` without re-stating the Z flattens the button to z=0
  // the moment the pointer arrives. Measured below rather than assumed.
  if (dark.ctaY && dark.ctaZ) {
    const flat = dark.ctaY.w, lifted = dark.ctaZ.w;
    const mag = lifted / flat;
    if (!(mag > 1.005)) {
      fail(`the translateZ(28px) fixture measures ${lifted}px against a flat ${flat}px — the 3D stack is not reproducing, so the assertion below is vacuous. Check .perspective-1000 and preserve-3d in the fixture.`);
    } else {
      for (const [name, x] of [['.pricing-cta-yearly', dark.ctaY], ['.pricing-cta-lifetime', dark.ctaL]]) {
        if (x && x.zToken !== '28px') fail(`${name} declares --lgc-z: ${x.zToken || '(nothing)'}, expected 28px — it must mirror the inline translateZ in NativelyProSettings.tsx, or every transform below drops the button out of the card's 3D stack.`);
      }
      if (m.transformRules.some((r) => r.transform === 'MARKER-MISSING')) {
        fail('no rule declares --lgc-z, so the transform scan found no starting point and asserted nothing. The block that owns the pricing CTAs was renamed or removed; update this check rather than deleting it.');
      }
      for (const r of m.transformRules) {
        if (r.transform === 'MARKER-MISSING') continue;
        // A rule scoped only to the teaser's pill has no Z to preserve, but it
        // still has to compose the variable rather than hardcode a bare value.
        if (!/--lgc-z/.test(r.transform)) {
          fail(`a rule sets a bare transform on a pricing CTA and will flatten its translateZ(28px):\n      ${r.media ? '@media ' + r.media + ' ' : ''}${r.selector} { transform: ${r.transform} }\n  Compose it: translateZ(var(--lgc-z)) <your transform>. Measured magnification at z=28 under perspective:1000 is x${mag.toFixed(4)}, so losing it shrinks the button by ${((1 - 1 / mag) * 100).toFixed(1)}% as the pointer arrives.`);
        }
      }
    }
  }

  // ── 2. the cap fade: lengths, radius-derived, width-invariant ──────────────
  const capChecks = [
    ['.pricing-card-yearly', dark.cardY, 28],
    ['.natively-api-detail-card', dark.cardApi, 26],
    ['.pro-teaser', dark.teaser, 20],
    ['.pricing-cta-lifetime', dark.ctaL, 22],
  ];
  for (const [name, x, R] of capChecks) {
    if (!x) continue;
    const mask = name.startsWith('.pricing-cta') ? x.beforeMask : x.afterMask;
    const h = layers(mask).horizontal;
    if (!h) { fail(`${name} rim mask has no horizontal (cap) layer: ${mask}`); continue; }
    // Percentages of WIDTH are the bug. calc(100% - …) is the mirrored half and
    // is fine, so strip calc() before looking.
    if (/\b\d+(\.\d+)?%/.test(h.replace(/calc\([^)]*\)/g, ''))) {
      fail(`${name} cap stops are percentages of width (${h}) — tuned on one surface they land inside the flat top face of a wider one. Pin them to the corner radius as lengths.`);
    }
    // Derived from the corner, not guessed: the first three stop positions must
    // be design.md's own measured ratios times this surface's radius.
    const got = [...h.matchAll(/(\d+(?:\.\d+)?)px/g)].map((mm) => Number.parseFloat(mm[1])).slice(0, 3);
    if (got.length < 3) { fail(`${name} cap layer exposes ${got.length} px stops, expected 3: ${h}`); continue; }
    CAP_RATIOS.forEach((ratio, i) => {
      const want = ratio * R;
      if (Math.abs(got[i] - want) > 0.6) {
        fail(`${name} cap stop ${i} is ${got[i]}px; derived from a ${R}px corner it should be ${want.toFixed(2)}px (design.md's measured ${[24, 62, 142][i]}px over the reference pill's own 68px cap radius).`);
      }
    });
    // The mirrored halves must never meet, however narrow the panel gets.
    if (got[2] * 2 >= x.w) {
      fail(`${name}: the cap fade reaches full strength ${got[2]}px in from each side of a ${x.w}px surface — the two halves cross and the rim never reaches full brightness anywhere.`);
    }
  }
  // Width-invariance, proved rather than asserted.
  if (dark.cardY && dark.cardYWide) {
    const a = layers(dark.cardY.afterMask).horizontal;
    const b = layers(dark.cardYWide.afterMask).horizontal;
    if (a !== b) fail(`cap fade differs between a ${CARD_W}px and a ${WIDE_W}px card:\n    ${a}\n    ${b}\n  It must be width-invariant, or narrowing the settings panel re-opens the bug.`);
  }

  // ── 3. dark rim symmetric, light rim top-face only ─────────────────────────
  const rimPairs = [
    ['.pricing-card-yearly', 'after', dark.cardY, light.cardY],
    ['.pricing-card-lifetime', 'after', dark.cardL, light.cardL],
    ['.natively-api-detail-card', 'after', dark.cardApi, light.cardApi],
    ['.pro-teaser', 'after', dark.teaser, light.teaser],
    ['.pricing-cta-lifetime', 'before', dark.ctaL, light.ctaL],
  ];
  for (const [name, pseudo, d, l] of rimPairs) {
    if (!d || !l) continue;
    const dv = layers(pseudo === 'after' ? d.afterMask : d.beforeMask).vertical;
    const lv = layers(pseudo === 'after' ? l.afterMask : l.beforeMask).vertical;
    if (!opaqueEnd(dv)) fail(`${name}: dark rim mask ends transparent (last stop: ${lastStop(dv)}) — on a dark ground the surface catches a bounce from below, and the symmetric rim IS the material.`);
    if (opaqueEnd(lv)) fail(`${name}: light rim mask ends opaque (last stop: ${lastStop(lv)}) — on a light ground there is no bounce to catch; the specular stays on the top face and a contact shadow does the rest (design.md, "Light mode is derived, not measured").`);
  }
  // A light BODY inverts for the same reason a light ground does, even in dark
  // theme — .lg-sky and .natively-api-pricing-cta-neutral already do this.
  for (const [name, x] of [['.pricing-cta-yearly', dark.ctaY], ['.pro-teaser-cta', dark.teaserCta]]) {
    if (!x) continue;
    const v = layers(x.beforeMask).vertical;
    if (opaqueEnd(v)) fail(`${name} has a near-white body but a symmetric rim (last stop: ${lastStop(v)}) — a fill this bright is already brighter than any bounce, so a bottom rim has nothing to do and only lifts the pill toward grey.`);
  }

  // ── mask layers must actually gate each other ──────────────────────────────
  for (const [name, comp] of [
    ['.pricing-card-yearly::after', dark.cardY?.afterComposite],
    ['.pro-teaser::after', dark.teaser?.afterComposite],
    ['.pricing-cta-lifetime::before', dark.ctaL?.beforeComposite],
    ['.pricing-cta-yearly::before', dark.ctaY?.beforeComposite],
  ]) {
    if (comp == null) continue;
    if (!/intersect|source-in/.test(String(comp))) {
      fail(`${name} mask layers are not composited (${comp}) — without intersect the two aiming layers stack instead of gating each other, and the vertical one alone is a uniform perimeter.`);
    }
  }

  // ── 4. one hairline ring at this scale, not the hero's three ───────────────
  for (const [name, shadow] of [
    ['.pricing-card-yearly::after', dark.cardY?.afterShadow],
    ['.pricing-card-lifetime::after', dark.cardL?.afterShadow],
    ['.pro-teaser::after', dark.teaser?.afterShadow],
    ['.pricing-cta-lifetime::before', dark.ctaL?.beforeShadow],
  ]) {
    if (shadow == null) continue;
    const rings = countRings(shadow);
    if (rings !== 1) fail(`${name} has ${rings} inset rings, expected 1 — design.md calls a 3px rim "visibly chunky by 44px" and .lg-sm collapses it to one hairline for exactly this reason.`);
  }

  // ── the body must be flat ──────────────────────────────────────────────────
  // A vertical ramp through the body is the glossy-gradient construction
  // design.md opens by rejecting. The two thin 8% bands at the extreme top and
  // bottom are the sheen that carries the rim inward and are part of the
  // material; a ramp that runs through the middle is not.
  for (const [name, x] of [['.pricing-cta-lifetime', dark.ctaL]]) {
    if (!x) continue;
    const mid = /rgba\(255,\s*255,\s*255,\s*0\)\s+14%[\s\S]*rgba\(255,\s*255,\s*255,\s*0\)\s+86%/.test(x.bgImage);
    if (x.bgImage !== 'none' && !mid) {
      fail(`${name} body gradient does not hold flat through the middle (${x.bgImage}) — the sheen belongs in the top and bottom bands only; a ramp across the body is the glossy pill design.md rejects.`);
    }
  }

  // ── the API tier card: hue on the rim, not on a perimeter border ──────────
  // The card measured `border: 1.5px solid rgba(136,77,138,0.42)` — a uniform
  // ring, which design.md names as what makes a surface read as plastic rather
  // than glass, and which buried the correctly-masked rim underneath it.
  const TIERS = ['standard', 'pro', 'max', 'ultra'];
  for (const theme of [['dark', dark], ['light', light]]) {
    const [tname, root] = theme;
    const seen = new Set();
    for (const t of TIERS) {
      const rest = root['tier-' + t], act = root['tierA-' + t];
      if (!rest || !act) { fail(`${tname} .natively-api-detail-card-${t}: not in the fixture`); continue; }
      if (Number.parseFloat(rest.borderW) !== 0) {
        fail(`${tname} .natively-api-detail-card-${t} still has a ${rest.borderW} ${rest.borderStyle} perimeter border — a uniform ring is the construction this material replaces, and it buries the masked rim underneath it. It is also a 1.5px length that floors to 1px at DPR 1 (the Windows default).`);
      }
      const rim = rgb(String(rest.afterShadow).match(/rgba?\([^)]*\)/)?.[0]);
      const rimA = rgb(String(act.afterShadow).match(/rgba?\([^)]*\)/)?.[0]);
      if (!rim || !rimA) { fail(`${tname} ${t}: rim colour unreadable (${rest.afterShadow} / ${act.afterShadow})`); continue; }
      // The hue has to actually differ per tier, or "the hue moved to the rim"
      // quietly became "every card got the same grey rim".
      const key = `${rim.r},${rim.g},${rim.b}`;
      if (seen.has(key)) fail(`${tname} ${t} rim ${key} duplicates another tier's — the four-hue ladder collapsed when the colour moved off the border.`);
      seen.add(key);
      // …and the active rung must stay the stronger one.
      if (!(rimA.a > rim.a)) fail(`${tname} ${t}: active rim alpha ${rimA.a} is not above resting ${rim.a} — the ladder that told a selected tier from an unselected one lived in those alphas.`);
    }
  }
  for (const [name, x] of [['.natively-api-pricing-cta', dark.apiCta], ['…-neutral', dark.apiCtaN]]) {
    if (!x) continue;
    const rings = countRings(x.beforeShadow);
    if (rings !== 1) fail(`${name}::before has ${rings} inset rings at ${Math.round(x.h)}px, expected 1 — three stacked rings read as a raised plastic bezel beside the flat pills on the Pro cards.`);
    if (Number.parseFloat(x.borderW) !== 0) fail(`${name} has a ${x.borderW} ${x.borderStyle} border — on the default theme that is native OS button chrome, and a transparent one would hold the ::before rim inside the pill's real edge.`);
    if (Math.round(x.radius === '9999px' ? 9999 : Number.parseFloat(x.radius)) < 16) fail(`${name} radius is ${x.radius} — the pill shape is anchored on ="liquid-glass"/="modern" unless it is presence-anchored.`);
  }
  if (dark.apiTab) {
    const bg = rgb(dark.apiTab.bg);
    if (bg && bg.a !== 0) fail(`.natively-api-selector-tab paints ${dark.apiTab.bg} on the default theme — that is the native OS button face (rgb(239,239,239)); every rule for this tab is anchored on ="liquid-glass"/="modern". It is the control that has to be pressed before any pricing can be read.`);
    if (Number.parseFloat(dark.apiTab.borderW) !== 0) fail(`.natively-api-selector-tab has a ${dark.apiTab.borderW} ${dark.apiTab.borderStyle} border — the native button bevel.`);
  }

  // ── the CTA carries no tier weight ───────────────────────────────────────
  // Pro used to gain `box-shadow: 0 0 0 3px` — spread-only, so a hard-edged
  // ring "visually indistinguishable from a border" (the file's own words). It
  // was the last uniform ring on this screen once the card, the badges and the
  // switcher pill moved to masked rims, and on the most prominent control it
  // read as an artefact rather than as emphasis. "Recommended" is the badge's
  // job now, so the four CTAs must be identical — and the badge must still
  // actually differ, or removing the ring left Pro unmarked.
  for (const [tname, root] of [['dark', dark], ['light', light]]) {
    const shadows = TIERS.map((t) => [t, root['tierCta-' + t]?.shadow]).filter(([, v]) => v);
    for (const [t, v] of shadows) {
      if (/(^|,)\s*rgba?\([^)]*\)\s+0px 0px 0px \d+px(?!\s+inset)/.test(String(v))) {
        fail(`${tname} ${t}: the CTA has a spread-only ring (${v}) — no offset, no blur, so it paints a hard border. That construction is what the rest of this surface stopped using.`);
      }
    }
    const distinct = new Set(shadows.map(([, v]) => v));
    if (distinct.size > 1) {
      fail(`${tname}: the four tier CTAs no longer share one treatment (${distinct.size} variants) — nothing about this button should encode which tier you are looking at.`);
    }
    // …and the signal that replaced the ring has to still be there.
    const pro = root['tierPill-pro'], others = TIERS.filter((t) => t !== 'pro').map((t) => root['tierPill-' + t]?.bg);
    if (pro && others.every((b) => b === pro.bg)) {
      fail(`${tname}: Pro's badge is the same fill as every other tier (${pro.bg}) — with the CTA ring gone the badge is the ONLY thing marking Pro as recommended, so this leaves it unmarked.`);
    }
  }

  // ── one texture across every pricing surface ─────────────────────────────
  // The grid was removed from these cards and a noise texture put in its place;
  // the grid is back, and the failure mode now is a surface left wearing the
  // substitute. Both are ::before background-images, so "has a texture" is not
  // enough — it has to be the SAME one.
  for (const [name, x] of [
    ['.pricing-card-yearly', dark.cardY], ['.pricing-card-lifetime', dark.cardL],
    ['.natively-api-detail-card', dark.cardApi], ['.pro-teaser', dark.teaser],
  ]) {
    if (!x) continue;
    const img = String(x.beforeImage || '');
    if (/feTurbulence|data:image\/svg/.test(img)) {
      fail(`${name} still carries the feTurbulence noise on ::before — that was the stand-in for the 24px grid, and every other pricing surface now draws the grid. One surface wearing the substitute is what made these read as different components.`);
    }
    // The grid is TWO layers (horizontal + vertical), so the computed size is
    // a two-entry list. Requiring the single-layer string fails on the correct
    // value — which it did on the first run of this assertion.
    const sizes = String(x.beforeSize || '').split(',').map((v) => v.trim());
    if (!/linear-gradient/.test(img) || sizes.length < 2 || !sizes.every((v) => v === '24px 24px')) {
      fail(`${name} has no 24px blueprint grid on ::before (image: ${img.slice(0, 60)}, size: ${x.beforeSize}) — the texture the rest of this app never stopped drawing (.natively-key-card, .about-jelly-card).`);
    }
  }

  // ── the usage meters ─────────────────────────────────────────────────────
  for (const [tname, root] of [['dark', dark], ['light', light]]) {
    const t = root.mTrack, f = root.mFill;
    if (!t || !f) { fail(`${tname}: the usage meter is not in the fixture`); continue; }
    // Anchored on nothing: the fixture renders these OUTSIDE any
    // [data-interface-theme] wrapper, so a rule that grew that prefix would
    // leave the track unpainted here exactly as it did on the real default theme.
    if (!/inset/.test(String(t.shadow))) {
      fail(`${tname}: .natively-meter-track has no inset shadow (${t.shadow}) — either the recess is gone, or the rule grew a [data-interface-theme] prefix and stopped matching outside one.`);
    }
    // An outer box-shadow inside overflow:hidden is simply deleted.
    if (t.overflow === 'hidden') {
      fail(`${tname}: .natively-meter-track is overflow:hidden — that silently clips the fill's bloom, which is the half of the material that says the bar is lit rather than painted.`);
    }
    if (!/0px 1px 0px 0px inset|inset 0px 1px 0px/.test(String(f.shadow).replace(/rgba?\([^)]*\)\s*/g, ''))) {
      fail(`${tname}: .natively-meter-fill has no top-face specular (${f.shadow}) — a 3px rod has no underside to catch a bounce, so the top face is the whole rim.`);
    }
  }
  // The hue is ONE token driving body and bloom together. Tailwind fills would
  // set the body only, and the bloom would silently stay accent-coloured while
  // the bar turned amber.
  {
    const hues = [['default', dark.mFill], ['--high', dark.mHigh], ['--over', dark.mOver]]
      .filter(([, x]) => x)
      .map(([n, x]) => [n, x.bg, String(x.shadow)]);
    const bodies = new Set(hues.map(([, bg]) => bg));
    if (bodies.size !== hues.length) fail(`the meter states do not resolve distinct fills (${[...bodies].join(' | ')}) — "running low" is the only thing colour means on this surface.`);
    for (const [n, bg, shadow] of hues) {
      if (!shadow.includes(bg)) {
        fail(`meter state ${n}: the body is ${bg} but the bloom does not use it (${shadow}) — the hue must drive both, or a bar turns amber while its glow stays accent-coloured.`);
      }
    }
  }

  // ── labels clear AA ────────────────────────────────────────────────────────
  for (const [name, x] of [
    ['dark .pricing-cta-yearly', dark.ctaY],
    ['dark .pricing-cta-lifetime', dark.ctaL],
    ['dark .pro-teaser-cta', dark.teaserCta],
    ['light .pricing-cta-yearly', light.ctaY],
    ['light .pricing-cta-lifetime', light.ctaL],
    ['light .pro-teaser-cta', light.teaserCta],
  ]) {
    if (!x) continue;
    const fg = rgb(x.fg), bg = rgb(x.bg);
    if (!fg || !bg) { fail(`${name}: label or body colour unparseable (${x.fg} / ${x.bg})`); continue; }
    const c = contrast(fg, bg);
    if (c < 4.5) fail(`${name} label contrast is ${c.toFixed(2)}:1 on ${x.bg}, under the 4.5:1 AA floor for 13px text.`);
  }

  // ── the named themes must not have been left behind ────────────────────────
  // The presence-anchored rules are declared last precisely so they also win
  // under ="liquid-glass" and ="modern". If a value-anchored rule ever moves
  // below them the old gloss comes back for those users only, which is the
  // hardest kind of regression to notice.
  for (const [name, d, g] of [
    ['.pricing-cta-yearly', dark.ctaY, glass.ctaY],
    ['.pricing-cta-lifetime', dark.ctaL, glass.ctaL],
    ['.pricing-card-yearly', dark.cardY, glass.cardY],
    ['.pro-teaser', dark.teaser, glass.teaser],
  ]) {
    if (!d || !g) continue;
    if (d.bg !== g.bg) fail(`${name} paints ${d.bg} on data-interface-theme="default" but ${g.bg} on ="liquid-glass" — the presence-anchored material lost the source-order tie to a value-anchored rule, so those users still see the retired gloss.`);
  }

  if (failures.length) {
    console.error(`\npricing-liquid-glass: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error('  ✗ ' + f + '\n');
    app.exit(1);
  } else {
    console.log('pricing-liquid-glass: OK — material, geometry, both theme branches, all four surfaces.');
    app.exit(0);
  }
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
