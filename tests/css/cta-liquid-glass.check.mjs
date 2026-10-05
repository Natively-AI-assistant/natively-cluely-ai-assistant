// Regression check: the Profile Intelligence "Manage Pro" CTA must keep the
// Liquid Glass material — see src/ui-components/design.md — and must keep it
// differently in each theme, because the two bodies invert.
//
// Run: npm run test:css:cta-liquid-glass
//
// Why this exists. The material is four cooperating layers (flat tint, rim,
// cap shadow, lens) whose values are all small, all subtle, and none of which
// produce an error when they stop working. Every failure mode below has
// already happened once somewhere in this codebase:
//
//   1. The rim reverted to three stacked rings. Correct at the reference's
//      136px, a bevel at 36px — .lg-sm collapses it to one hairline for
//      exactly this reason, and a copy-paste from the hero pill undoes that.
//   2. The cap fade went back to percentages of WIDTH. design.md's stops were
//      tuned on a 535px pill whose caps were 12.7% of it; on this 196px
//      sidebar button the caps are 9%, so a percentage fade ends up INSIDE the
//      flat top face and the rim spends its brightest stretch fading across
//      something that is not curved. That is the bug that shipped on
//      LiquidGlassBadge. Lengths tied to the cap radius are the fix, and they
//      are width-invariant, so narrowing the sidebar cannot re-open it.
//   3. The shimmer moved back onto ::after. Both pseudos belong to the
//      material now (rim and cap shadow); putting the sweep back on ::after
//      silently deletes the cap shadow for the state that shimmers, and
//      nothing visibly breaks.
//   4. The two themes stopped inverting. They carry OPPOSITE bodies, and the
//      rim face falls out of that, not out of taste:
//        dark  = a WHITE pill. A bright rim has nothing to do on a body that
//                already out-shines anything it could catch, so the rim
//                inverts: dark, on the UNDERSIDE, plus the cap shadow and a
//                contact shadow. No sheen — white over white is invisible, and
//                a dark sheen would ramp the body, which this material never does.
//        light = a DARK GREY pill on a white card. It takes a bright specular,
//                but only on the TOP face: there is no bounce off a white card
//                to catch, so a contact shadow does what a bottom rim would.
//      Swap either and the pill stops reading as lit at all.
//   5. The light body went back to #000. Black has no headroom BELOW it the
//      way white has none above: every gram of specular only lifts it, so the
//      body reads as grey anyway while the rim has to be trimmed away to stop
//      it. Naming the grey is what lets the material work, and it is the one
//      thing about this button that was asked for by name.
//
// Why Electron rather than a text assertion on the stylesheet: several of these
// are cascade outcomes (the trial variant's hover tint has to beat a (0,3,0)
// neutral rule; the light theme's no-sheen background has to beat .pi-cta's
// own). Reading the rules cannot tell you who wins. This resolves them in the
// real engine and reads getComputedStyle.
//
// The pixel profile the material is actually specified by — flat body,
// symmetric rim, falloff across the caps — was verified separately by the
// method design.md prescribes (render at device scale 1, sample a vertical
// slice and the top edge). This check guards the CSS that produces it, which
// is what a regression would land in.
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const SOURCE = resolve(process.cwd(), 'src/components/ProfileIntelligenceSettings.tsx');

// The CTA lives in a template-literal stylesheet inside the component, so the
// check reads the real thing rather than a copy that can drift.
function loadCss() {
  if (!existsSync(SOURCE)) {
    throw new Error(
      `component not found at ${SOURCE} — run this from the repo root ` +
        `(npm run test:css:cta-liquid-glass), not from a subdirectory. This is a ` +
        `harness problem, not a CSS regression.`,
    );
  }
  const src = readFileSync(SOURCE, 'utf8');
  const open = src.indexOf('const PI_CSS = `');
  if (open === -1) throw new Error('PI_CSS template literal not found — it was renamed; update this check rather than deleting it.');
  const start = open + 'const PI_CSS = `'.length;
  const end = src.indexOf('`;', start);
  if (end === -1) throw new Error('PI_CSS template literal is unterminated.');
  return src.slice(start, end);
}

// Mirrors the real CTA footer in the component: the class list, the trailing
// ring, the lens span, and width:100% inside the 220px sidebar's 12px padding.
const SIDEBAR_W = 220;
const PAD = 12;
const EXPECT_W = SIDEBAR_W - PAD * 2;   // 196px

const button = (id, variant, label, shimmer) => `
  <button class="pi-cta ${variant}" id="${id}" style="width:100%">
    <span class="pi-cta-lens"></span>
    ${shimmer ? '<span class="pi-cta-shimmer"></span>' : ''}
    <span class="pi-cta-label">${label}</span>
    <div class="pi-cta-ring"></div>
  </button>`;

const page = (css) => `<meta charset="utf-8"><style>
${css}
body { margin: 0; }
.stage { width: ${SIDEBAR_W}px; padding: ${PAD}px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
/* A second, deliberately wider stage: the cap fade must resolve identically in
   both, which is what "width-invariant" means and what a percentage breaks. */
.stage.wide { width: 420px; }
</style>
<body>
<div class="pi-root">
  <div class="stage">
    ${button('dark-premium', '', 'Manage Pro', false)}
    ${button('dark-unlock', 'pi-cta--shimmer', 'Unlock Pro', true)}
    ${button('dark-trial', 'pi-cta--trial', 'Upgrade', false)}
  </div>
  <div class="stage wide">${button('dark-wide', '', 'Manage Pro', false)}</div>
</div>
<div class="pi-root" data-theme="light">
  <div class="stage">
    ${button('light-premium', '', 'Manage Pro', false)}
    ${button('light-trial', 'pi-cta--trial', 'Upgrade', false)}
  </div>
</div>
</body>`;

// ── colour helpers ───────────────────────────────────────────────────────────
// Accepts what getComputedStyle returns for a colour PROPERTY (rgb/rgba) and
// what it returns for a custom property, which is the author's own text — the
// hover tints are declared as hex and are never resolved.
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
// Achromatic within a tolerance. A grey body is the point: design.md rejects a
// faint cool cast outright, because it reads as a blue-grey button, not a lit one.
const chroma = (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

// Counts `inset 0 0 0 <n>px` rings in a box-shadow. One is the small-scale
// treatment; three is the hero pill's, and is the regression.
const countRings = (shadow) => (String(shadow).match(/inset/g) || []).length;

async function measure() {
  const win = new BrowserWindow({ width: 900, height: 700, show: false });
  const fixture = join(tmpdir(), 'natively-cta-liquid-glass.html');
  writeFileSync(fixture, page(loadCss()));
  try {
    await win.loadFile(fixture);
    return await win.webContents.executeJavaScript(`
      new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
        const read = (id) => {
          const el = document.getElementById(id);
          const cs = getComputedStyle(el);
          const before = getComputedStyle(el, '::before');
          const after = getComputedStyle(el, '::after');
          const lensEl = el.querySelector('.pi-cta-lens');
          const lens = getComputedStyle(lensEl);
          const shimEl = el.querySelector('.pi-cta-shimmer');
          return {
            width: el.getBoundingClientRect().width,
            height: el.getBoundingClientRect().height,
            bg: cs.backgroundColor,
            bgImage: cs.backgroundImage,
            fg: cs.color,
            hoverTint: cs.getPropertyValue('--pi-cta-hover').trim(),
            rimShadow: before.boxShadow,
            rimMask: before.maskImage || before.webkitMaskImage,
            rimMaskComposite: before.maskComposite || before.webkitMaskComposite,
            afterAnimation: after.animationName,
            afterPadding: after.paddingTop,
            afterOpacity: after.opacity,
            lensMask: lens.maskImage || lens.webkitMaskImage,
            lensZ: lens.zIndex,
            lensW: lens.getPropertyValue('--pi-lens-w').trim(),
            lensH: lens.getPropertyValue('--pi-lens-h').trim(),
            shimmerAnimation: shimEl ? getComputedStyle(shimEl).animationName : null,
            // Where the label's BOX sits relative to the pill's, so "centred"
            // is measured rather than inferred from text-align.
            labelOffset: (() => {
              const lab = el.querySelector('.pi-cta-label');
              if (!lab) return null;
              const a = el.getBoundingClientRect(), b = lab.getBoundingClientRect();
              return { delta: (b.left + b.right) / 2 - (a.left + a.right) / 2, align: getComputedStyle(lab).textAlign };
            })(),
          };
        };
        // :active and a media query cannot be produced on an element here, so
        // these two come out of the CSSOM: the AUTHORED rule, read back from the
        // sheet the browser actually parsed. Mirroring the rule onto a fixture
        // class instead would assert the fixture, not the stylesheet.
        const ruleFor = (selector, mediaContains) => {
          const walk = (rules, media) => {
            for (const rule of rules) {
              // selectorText FIRST. Chromium supports CSS nesting, so a plain
              // CSSStyleRule now carries an (empty) cssRules list too — testing
              // for cssRules first recurses into every style rule and matches
              // nothing, which is exactly how this returned null on its first run.
              if (!rule.selectorText && rule.cssRules) {
                const text = rule.conditionText || rule.media?.mediaText || '';
                const hit = walk(rule.cssRules, media ? media + ' ' + text : text);
                if (hit) return hit;
                continue;
              }
              if (rule.selectorText !== selector) continue;
              if (mediaContains && !String(media).includes(mediaContains)) continue;
              if (!mediaContains && media) continue;
              return { w: rule.style.getPropertyValue('--pi-lens-w').trim(), h: rule.style.getPropertyValue('--pi-lens-h').trim() };
            }
            return null;
          };
          for (const sheet of document.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch { continue; }
            const hit = walk(rules, '');
            if (hit) return hit;
          }
          return null;
        };
        // Whether --pi-lens-w is DECLARED on .pi-cta, and whether it is
        // REGISTERED. getComputedStyle cannot answer either: an unregistered
        // property still substitutes its text into the mask, and a registered
        // one reports its initial value whether or not anyone declared it. Both
        // of those made an earlier draft of this check pass on a mutant.
        const registered = (() => {
          const out = {};
          for (const sheet of document.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch { continue; }
            for (const rule of rules) if (rule.name) out[rule.name] = rule.syntax;
          }
          return out;
        })();
        r({
          ctaDeclares: ruleFor('.pi-cta'),
          registered,
          pressedRule: ruleFor('.pi-cta:active .pi-cta-lens'),
          reducedRule: ruleFor('.pi-cta-lens', 'reduced-motion'),
          darkPremium: read('dark-premium'),
          darkUnlock: read('dark-unlock'),
          darkTrial: read('dark-trial'),
          darkWide: read('dark-wide'),
          lightPremium: read('light-premium'),
          lightTrial: read('light-trial'),
        });
      })));
    `);
  } finally {
    win.destroy();
    rmSync(fixture, { force: true });
  }
}

const failures = [];
const fail = (msg) => failures.push(msg);

app.whenReady().then(async () => {
  const m = await measure();
  const d = m.darkPremium;
  const l = m.lightPremium;

  // ── geometry ───────────────────────────────────────────────────────────────
  if (Math.round(d.width) !== EXPECT_W) fail(`dark CTA is ${d.width}px wide, expected ${EXPECT_W}px — the fixture no longer mirrors the sidebar.`);
  if (Math.round(d.height) !== 36) fail(`dark CTA is ${d.height}px tall, expected 36px — the cap radius token (--pi-cta-cap-r: 18px) is half this and must track it.`);

  // ── the two bodies, which must stay inverted ───────────────────────────────
  const dBg = rgb(d.bg);
  if (!dBg) fail(`dark body colour unparseable: ${d.bg}`);
  else if (dBg.r !== 255 || dBg.g !== 255 || dBg.b !== 255) fail(`dark body is ${d.bg}, expected pure #ffffff — the white pill is the one the panel ships and the rest of this treatment (inverted rim, no sheen, held hover) exists because of it.`);
  const lBg = rgb(l.bg);
  if (!lBg) fail(`light body colour unparseable: ${l.bg}`);
  else {
    if (chroma(lBg) > 2) fail(`light body ${l.bg} is not achromatic (chroma ${chroma(lBg)}) — a cool cast reads as a blue-grey button, not a lit one.`);
    const v = lBg.r;
    if (v < 24 || v > 90) fail(`light body ${l.bg} is outside the dark-grey band (24..90). Black has no headroom below it, so a #000 pill reads as grey anyway while its rim has to be trimmed away to stop it; naming the grey is what lets the material work.`);
  }

  // ── the sheen follows the body, not the theme ──────────────────────────────
  // background-image reports one entry PER LAYER, and the flat tint is its own
  // layer, so "no sheen" computes to `none, none` rather than `none`.
  const hasSheen = (v) => /gradient|url\(/.test(String(v));
  if (hasSheen(d.bgImage)) fail(`the white CTA carries a background sheen (${d.bgImage}) — white over white is invisible, and a DARK sheen would ramp the body, which is the one thing this material never does.`);
  if (!hasSheen(l.bgImage)) fail(`the grey CTA lost its inner sheen (${l.bgImage}) — the gradient that carries the rim light a few px inward.`);

  // ── 4. the rim ─────────────────────────────────────────────────────────────
  for (const [name, x] of [['dark', d], ['light', l]]) {
    const rings = countRings(x.rimShadow);
    if (rings !== 1) fail(`${name} rim has ${rings} inset rings, expected 1 — the rim does not scale with the pill; three stacked rings read as a bevel at 36px (design.md, .lg-sm).`);
    if (!/radial|linear/.test(String(x.rimMask))) fail(`${name} rim has no mask (${x.rimMask}) — an unmasked ring is a uniform perimeter, which is what makes a pill read as a plastic capsule.`);
  }
  // The two mask layers, split at the horizontal one. Regexing them apart does
  // not work: the stops contain their own parentheses (rgba(...)), and Chromium
  // drops the default `180deg` from the computed value of the vertical layer.
  const layers = (mask) => {
    const s = String(mask);
    const at = s.indexOf('linear-gradient(90deg');
    return at === -1 ? { vertical: s, horizontal: '' } : { vertical: s.slice(0, at).replace(/,\s*$/, ''), horizontal: s.slice(at) };
  };
  const dv = layers(d.rimMask).vertical;
  const lv = layers(l.rimMask).vertical;
  // Symmetry is decided by the LAST stop, not by whether a high percentage
  // appears: a top-only mask still runs to 100%, it just runs there transparent.
  // An earlier draft of this check tested for the number and passed a rim with
  // its bottom half deleted.
  const lastStop = (vertical) => {
    const open = vertical.indexOf('(');
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
  // The white pill's rim is on the UNDERSIDE and the grey pill's on the TOP
  // face, so their masks are mirror images: one starts transparent and ends
  // opaque, the other does the reverse.
  const firstStop = (vertical) => {
    const open = vertical.indexOf('(');
    return vertical.slice(open + 1).split(/,(?![^(]*\))/)[0].trim();
  };
  const isClear = (stop) => /rgba\([^)]*,\s*0\s*\)|transparent/.test(stop);
  if (!isClear(firstStop(dv)) || isClear(lastStop(dv))) {
    fail(`the white pill's rim is not on its underside (first stop ${firstStop(dv)}, last ${lastStop(dv)}). A bright rim has nothing to do on a body that already out-shines anything it could catch, so the rim inverts: dark, on the bottom face.`);
  }
  if (isClear(firstStop(lv)) || !isClear(lastStop(lv))) {
    fail(`the grey pill's rim is not on its top face (first stop ${firstStop(lv)}, last ${lastStop(lv)}). On a white card there is no bounce from below to catch — the contact shadow does what a bottom rim would.`);
  }
  // Polarity: the white pill's rim is a SHADOW, the grey pill's is a specular.
  const rimColour = (shadow) => rgb((String(shadow).match(/rgba?\([^)]*\)/) || [''])[0]);
  const dRim = rimColour(d.rimShadow), lRim = rimColour(l.rimShadow);
  if (dRim && lum(dRim) > 0.2) fail(`the white pill's rim is light (${d.rimShadow}) — on #ffffff it is invisible; its rim has to be the shadow.`);
  if (lRim && lum(lRim) < 0.5) fail(`the grey pill's rim is dark (${l.rimShadow}) — a dark body takes the bright specular.`);

  // ── 2. the cap fade is a LENGTH, and width-invariant ───────────────────────
  const dh = layers(d.rimMask).horizontal;
  const wh = layers(m.darkWide.rimMask).horizontal;
  if (!dh) fail(`dark rim mask has no horizontal (cap) layer: ${d.rimMask}`);
  else {
    if (/\b\d+(\.\d+)?%(?!\s*-)/.test(dh.replace(/calc\([^)]*\)/g, ''))) {
      fail(`cap fade stops are percentages of width (${dh}) — tuned on a 535px pill whose caps were 12.7% of it, they land inside the flat top face here. Pin them to the cap radius as lengths.`);
    }
    if (dh !== wh) fail(`cap fade differs between a ${EXPECT_W}px and a 420px pill:\n    ${dh}\n    ${wh}\n  It must be width-invariant, or narrowing the sidebar re-opens the bug.`);
  }
  if (!/intersect|source-in/.test(String(d.rimMaskComposite))) fail(`rim mask layers are not composited (${d.rimMaskComposite}) — without intersect the two aiming layers stack instead of gating each other.`);

  // ── 3. ::after is the cap shadow, not the shimmer ──────────────────────────
  for (const [name, x] of [['dark premium', d], ['dark unlock', m.darkUnlock]]) {
    if (x.afterAnimation !== 'none') fail(`${name}: ::after is animating (${x.afterAnimation}) — the shimmer moved back onto the pseudo that owns the cap shadow. It has its own element (.pi-cta-shimmer).`);
  }
  if (d.afterPadding !== '1px') fail(`dark cap shadow padding is ${d.afterPadding}, expected 1px — the ring mask width is what confines it to the perimeter, and 2px swallows a 36px pill.`);
  // The caps darken in BOTH themes now: on white it is the layer doing most of
  // the form, so it is dialled back rather than switched off (a #000 body was
  // the only case where it had nothing to do).
  for (const [name, x] of [['white', d], ['grey', l]]) {
    const o = Number(x.afterOpacity);
    if (!(o > 0 && o <= 0.6)) fail(`${name} pill's cap shadow is at opacity ${x.afterOpacity} — expected a real value at or under 0.6. Off means the caps never turn, and heavier than that smudges them.`);
  }
  if (Number(d.afterOpacity) >= Number(l.afterOpacity)) fail(`the white pill's cap shadow (${d.afterOpacity}) is not lighter than the grey pill's (${l.afterOpacity}) — the same black gradient reads far harder on #ffffff.`);
  if (m.darkUnlock.shimmerAnimation !== 'pi-shimmer') fail(`the unlock state's shimmer element is not animating (${m.darkUnlock.shimmerAnimation}).`);
  if (m.darkPremium.shimmerAnimation !== null) fail('the premium state renders a shimmer element; it is meant to be rendered only for the state that uses it.');

  // ── the lens ───────────────────────────────────────────────────────────────
  for (const [name, x] of [['dark', d], ['light', l]]) {
    if (!/radial-gradient/.test(String(x.lensMask))) fail(`${name} lens has no radial mask (${x.lensMask}) — the mask is what localises both the bloom and the rim pickup.`);
    if (x.lensZ !== '1') fail(`${name} lens z-index is ${x.lensZ}, expected 1 — 0 puts it under the rim, 2 puts it over the label.`);
  }
  // useLensTracking writes --lg-mx/--lg-my; if the mask stops reading them the
  // highlight silently parks at the centre and the pointer tracking is dead.
  if (!/var\(--lg-mx|\d/.test(String(d.lensMask))) fail('lens mask does not resolve a pointer position.');
  // The bloom size must be DECLARED on .pi-cta, not left to the @property
  // initial value: an initial is not an author declaration, so the press-tighten
  // on .pi-cta-lens would have nothing to transition back to on release. It also
  // catches the @property registration being removed, which silently degrades
  // the custom property to syntax '*' and kills the 150ms ease with no error.
  if (d.lensW !== '90px' || d.lensH !== '40px') fail(`resting lens bloom resolves to ${d.lensW} x ${d.lensH}, expected 90px x 40px — the hero pill's 200x150 covers a 36px button whole and stops reading as a local highlight.`);
  if (!m.ctaDeclares || m.ctaDeclares.w !== '90px' || m.ctaDeclares.h !== '40px') {
    fail(`.pi-cta does not DECLARE --pi-lens-w/--pi-lens-h (got ${JSON.stringify(m.ctaDeclares)}). Leaning on the @property initial value works by accident: it inherits: true, so anything declaring these higher up leaks into the pill, and the press-tighten has no author value on the button to return to.`);
  }
  for (const name of ['--pi-lens-w', '--pi-lens-h']) {
    if (m.registered[name] !== '<length>') {
      fail(`${name} is not registered as <length> (@property gave ${JSON.stringify(m.registered[name])}). Unregistered it is a text token: the mask still substitutes it and looks right, but the 150ms press-tighten silently does not interpolate.`);
    }
  }
  if (!m.pressedRule) fail('no `.pi-cta:active .pi-cta-lens` rule — :active fires on pointer-down and the lens tightening is the material compressing; without it the press has no surface feedback.');
  else if (m.pressedRule.w !== '66px' || m.pressedRule.h !== '30px') fail(`the press tightens the bloom to ${m.pressedRule.w} x ${m.pressedRule.h}, expected 66px x 30px.`);
  if (!m.reducedRule) fail('prefers-reduced-motion does not resize the lens — a still, centred highlight at the tracking size reads as a stuck spot rather than as a surface.');
  else if (Number.parseFloat(m.reducedRule.w) <= Number.parseFloat(d.lensW)) fail(`under reduced motion the bloom is ${m.reducedRule.w}, not larger than the tracking bloom ${d.lensW} — with tracking pinned to the centre it has to open out to cover the pill.`);

  // ── the hover tint ─────────────────────────────────────────────────────────
  if (d.hoverTint === '') fail('white CTA has no --pi-cta-hover declared.');
  else if (rgb(d.hoverTint) && lum(rgb(d.hoverTint)) !== 1) fail(`the white pill's hover tint is ${d.hoverTint} — #ffffff is the ceiling, so it is held at the body colour and the lift, the contact shadow and the lens carry that state.`);
  if (l.hoverTint === '') fail('grey CTA has no --pi-cta-hover declared.');
  else if (rgb(l.hoverTint) && lBg && lum(rgb(l.hoverTint)) <= lum(lBg)) fail(`the grey pill's hover tint ${l.hoverTint} is not brighter than its body ${l.bg} — an achromatic body has brightness as its only lever.`);
  // The neutral hover rule is (0,3,0) and .pi-cta--trial is (0,1,0), so the
  // variant has to declare its own or the purple cross-fades to grey.
  const t = rgb(m.darkTrial.hoverTint);
  if (!t) fail(`trial variant has no own --pi-cta-hover (${m.darkTrial.hoverTint}) — it would lose the cascade to the neutral hover rule and turn grey under the pointer.`);
  else if (chroma(t) < 40) fail(`trial hover tint ${m.darkTrial.hoverTint} has lost its hue (chroma ${chroma(t)}).`);

  // ── the label is centred on the PILL, not beside the ring ──────────────────
  for (const [name, x] of [['white', d], ['grey', l], ['trial', m.darkTrial]]) {
    if (!x.labelOffset) { fail(`${name}: no .pi-cta-label element — the label carries the centring and the ellipsis.`); continue; }
    if (x.labelOffset.align !== 'center') fail(`${name} label is text-align: ${x.labelOffset.align}.`);
    if (Math.abs(x.labelOffset.delta) > 0.5) {
      fail(`${name} label track is off the pill's centre by ${x.labelOffset.delta.toFixed(2)}px. Centring inside a flex:1 that stops short of the ring lands (ring + gap) / 2 = 18px left of where the eye expects it — the leading padding has to carry the ring's own footprint.`);
    }
  }

  // ── the label ──────────────────────────────────────────────────────────────
  for (const [name, x] of [['dark', d], ['light', l], ['trial', m.darkTrial]]) {
    const fg = rgb(x.fg), bg = rgb(x.bg);
    if (!fg || !bg) { fail(`${name}: label or body colour unparseable (${x.fg} / ${x.bg})`); continue; }
    const c = contrast(fg, bg);
    if (c < 4.5) fail(`${name} label contrast is ${c.toFixed(2)}:1 on ${x.bg}, under the 4.5:1 AA floor for 13px text.`);
  }

  if (failures.length) {
    console.error(`\ncta-liquid-glass: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error('  ✗ ' + f + '\n');
    app.exit(1);
  } else {
    console.log('cta-liquid-glass: OK — material, both theme branches, all three CTA states.');
    app.exit(0);
  }
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
