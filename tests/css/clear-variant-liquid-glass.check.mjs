// Regression check: the `clear` Liquid Glass variant, and the `.lg-wide`
// modifier it ships with — see the two sections in src/ui-components/design.md.
//
// Run: npm run test:css:clear-variant
//
// `clear` is the material with no body of its own: the host's surface shows
// through and the rim is the only thing it contributes. That makes it the one
// variant whose correctness cannot be read off the stylesheet, because three of
// its four properties are cascade or geometry outcomes. Each failure below was
// either measured happening in this component or has already shipped elsewhere
// in this codebase:
//
//   1. THE LABEL GOES BLACK IN BOTH THEMES. A <button> gets `color: buttontext`
//      from the UA stylesheet — an INITIAL value, not an inherited one. The
//      other four variants never notice, because each pins a colour in a
//      `.lg-X .lg-content` rule. `clear` must not pin one (the body is the
//      host's surface, so the label has to be the host's text colour), so it
//      carries `color: inherit` instead. Measured without that line:
//      rgb(0,0,0) in BOTH themes, i.e. black on #0e0e0e. Deleting it, or
//      "tidying" it into a fixed colour, restores the bug silently.
//
//   2. THE CAP FADE GOES BACK TO PERCENTAGES OF WIDTH. design.md's stops were
//      tuned on a 535x136 pill whose caps were 12.7% of it. On a 216px-wide,
//      30px-tall sidebar button the caps are 15px — 6.9% — while --lg-cap-2
//      still says 26.5%, i.e. 57px. The rim then spends a quarter of the
//      button's width climbing across a face that stopped curving at 15px.
//      This is the THIRD appearance of that bug (LiquidGlassBadge at 42px, the
//      Profile Intelligence CTA at 196px), which is why `.lg-wide` names it.
//      Lengths pinned to the cap radius are the fix and are width-invariant.
//
//   3. THE TWO THEMES STOP INVERTING. They are not a light/dark recolour of one
//      another; the body is transparent in both, so what changes is which
//      layers can work at all:
//        dark  = a WHITE specular rim, bright on the top AND bottom faces,
//                because the panel is darker than the rim can be.
//        light = the rim INVERTS to dark — a white rim on a near-white body is
//                invisible at any alpha — and the UNDERSIDE carries more of it
//                than the top, because that is the face in shadow.
//      Swap either and the material stops reading as lit.
//
//   4. A CONTACT SHADOW APPEARS IN LIGHT MODE. `.lg-action` and `.lg-sky` both
//      cast one, so copying their light treatment wholesale is the obvious
//      mistake. They have a solid body sitting ON the card to cast it; a chip
//      you can see the panel through is not sitting on anything, and a drop
//      shadow under it claims a height the material does not have.
//
// Why Electron rather than asserting on the stylesheet text: every one of these
// is a resolved value, not a rule. Whether `color` reaches the label depends on
// the UA sheet; whether the cap stops are 15px or 57px depends on which element
// a percentage resolves against; whether the rim reads depends on compositing
// an inset shadow over a translucent fill. Reading the rules cannot tell you.
//
// The component's own stylesheet is used verbatim, at device scale 1, on the
// two surfaces `clear` was derived for — the modes manager sidebar's
// #0e0e0e / #f9f9f9.
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const CSS_PATH = resolve(process.cwd(), 'src/ui-components/LiquidGlassButton.css');

// The modes manager sidebar: 240px wide, 12px side padding -> a 216px button.
const SIDEBAR_W = 240;
const SIDE_PAD = 12;
const BUTTON_W = SIDEBAR_W - SIDE_PAD * 2;
const PILL_H = 30;              // .lg-sm's box
const CAP_R = PILL_H / 2;       // where the curvature actually ends

const SURFACES = {
    dark: { bg: '#0e0e0e', text: 'rgba(255, 255, 255, 0.85)' },
    light: { bg: '#f9f9f9', text: 'rgb(55, 65, 81)' },       // --mm-text-primary
};

// A rim this faint resolves in getComputedStyle but does not read on screen —
// the premise of the variant is that it DOES, so assert on pixels.
const MIN_RIM_CONTRAST = 12;

// Long enough that nothing is sampled mid-transition.
const SETTLE_MS = 350;

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

function loadCss() {
    // Distinguish "run from the wrong directory" from a real regression.
    if (!existsSync(CSS_PATH)) {
        throw new Error(
            `stylesheet not found at ${CSS_PATH} — run this from the repo root ` +
            `(npm run test:css:clear-variant), not from a subdirectory. This is a ` +
            `harness problem, not a CSS regression.`,
        );
    }
    return readFileSync(CSS_PATH, 'utf8');
}

// Mirrors LiquidGlassButton's own render: `lg-button lg-${variant} ${className}`,
// a .lg-content wrapper and a .lg-lens sibling. A fixture that omitted the
// wrapper would not exercise failure 1 at all, since that is where colour lands.
const button = (id, cls) =>
    `<button id="${id}" class="lg-button ${cls}" style="width:100%">` +
    `<span class="lg-content"><span class="lg-label">New Mode</span></span>` +
    `<span class="lg-lens"></span></button>`;

const page = (css) => `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>
  html, body { margin:0; padding:0; font-family: Inter, system-ui, sans-serif; }
  html[data-theme="dark"]  body { background:${SURFACES.dark.bg};  color:${SURFACES.dark.text}; }
  html[data-theme="light"] body { background:${SURFACES.light.bg}; color:${SURFACES.light.text}; }
  .sidebar { width:${SIDEBAR_W}px; padding:40px ${SIDE_PAD}px; box-sizing:border-box; }
  #stage-neutral { background:#242424; }   /* the reference stage, for the rim comparison */
${css}
</style></head><body>
  <div class="sidebar">
    ${button('wide', 'lg-clear lg-sm lg-wide')}
    <div style="height:24px"></div>
    ${button('nowide', 'lg-clear lg-sm')}
  </div>
  <div class="sidebar" id="stage-neutral">${button('neutral', 'lg-neutral lg-sm lg-wide')}</div>
</body></html>`;

// --lg-cap-* are UNREGISTERED custom properties, so getComputedStyle hands back
// the literal token ("26.542%", "calc(30px / 2)") rather than a length. Handing
// the value to a probe as a width and reading its rect is what resolves it —
// and the probe must sit INSIDE the button, or a percentage resolves against
// the wrong containing block and reads ~2.2x too large.
const readState = `(() => {
  const out = {};
  for (const id of ['wide', 'nowide', 'neutral']) {
    const el = document.getElementById(id);
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:1px';
    el.appendChild(probe);
    const px = (v) => { probe.style.width = v; return +probe.getBoundingClientRect().width.toFixed(2); };
    out[id] = {
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      capStops: ['--lg-cap-0', '--lg-cap-1', '--lg-cap-2'].map(n => px(cs.getPropertyValue(n).trim())),
      boxShadow: cs.boxShadow,
      labelColor: getComputedStyle(el.querySelector('.lg-content')).color,
      hostColor: getComputedStyle(document.body).color,
    };
    probe.remove();
  }
  return JSON.stringify(out);
})()`;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
    let win;
    try {
        const file = join(tmpdir(), `lg-clear-check-${process.pid}.html`);
        writeFileSync(file, page(loadCss()));

        // ONE window, theme toggled in place: a second offscreen BrowserWindow
        // fails to load in this Electron with ERR_FAILED, which would read as a
        // light-mode regression rather than as a harness limitation.
        win = new BrowserWindow({
            width: 520, height: 260, show: false,
            webPreferences: { offscreen: true, deviceScaleFactor: 1 },
        });
        await win.loadFile(file);

        for (const theme of ['dark', 'light']) {
            await win.webContents.executeJavaScript(
                `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); 1`);
            await new Promise(r => setTimeout(r, SETTLE_MS));

            const state = JSON.parse(await win.webContents.executeJavaScript(readState));
            const shot = await win.webContents.capturePage();
            const size = shot.getSize();
            const bitmap = shot.toBitmap();                  // BGRA
            const scale = size.width / 520;
            const lum = (x, y) => {
                const i = (Math.round(y * scale) * size.width + Math.round(x * scale)) * 4;
                return 0.2126 * bitmap[i + 2] + 0.7152 * bitmap[i + 1] + 0.0722 * bitmap[i];
            };

            const w = state.wide;
            check(Math.round(w.box.w) === BUTTON_W,
                `[${theme}] fixture drift: the button is ${w.box.w}px, not the ${BUTTON_W}px ` +
                `sidebar width these thresholds were derived for.`);

            // ── 1. the label follows the host, in both themes ──────────────
            check(w.labelColor === w.hostColor,
                `[${theme}] FAILURE 1 — the label is ${w.labelColor}, not the host's ` +
                `${w.hostColor}. \`color: inherit\` was removed from .lg-button.lg-clear, ` +
                `so the UA's \`color: buttontext\` is winning — which lands as black on ` +
                `${SURFACES[theme].bg} here, and as black on ${SURFACES.dark.bg} on the ` +
                `dark sidebar.`);

            // ── 2. the cap fade is a LENGTH tied to the cap radius ─────────
            check(Math.abs(w.capStops[2] - CAP_R) < 0.5,
                `[${theme}] FAILURE 2 — .lg-wide's --lg-cap-2 resolves to ${w.capStops[2]}px, ` +
                `not the ${CAP_R}px cap radius. The stops reverted to percentages of width ` +
                `(26.542% of ${BUTTON_W} = ${(BUTTON_W * 0.26542).toFixed(1)}px), so the rim ` +
                `fades across a face that stopped curving at ${CAP_R}px.`);
            check(state.nowide.capStops[2] > CAP_R * 2,
                `[${theme}] harness drift — the control button (no .lg-wide) resolves ` +
                `--lg-cap-2 to ${state.nowide.capStops[2]}px, so the percentage default it ` +
                `is meant to demonstrate is gone. Failure 2 can no longer fail.`);

            // The rim must reach full strength by the cap and HOLD across the
            // flat face. Sampled as the spread over 15px -> 60px: with lengths
            // it is flat, with percentages it is still climbing at 45px.
            const edge = (dx) => lum(w.box.x + dx, w.box.y + 0.5);
            const atCap = edge(CAP_R);
            const drift = Math.abs(edge(60) - atCap);
            check(drift <= 3,
                `[${theme}] FAILURE 2 — the rim is still changing past the cap: ` +
                `${atCap.toFixed(1)} at ${CAP_R}px vs ${edge(60).toFixed(1)} at 60px ` +
                `(${drift.toFixed(1)} levels). It should be at full strength by the cap ` +
                `and flat after it.`);

            // ── 3. the themes invert, and the rim actually reads ───────────
            const body = lum(w.box.x + 40, w.box.y + w.box.h / 2);   // clear of the centred label
            const top = lum(w.box.x + w.box.w / 2, w.box.y);
            const bottom = lum(w.box.x + w.box.w / 2, w.box.y + w.box.h - 1);

            if (theme === 'dark') {
                check(top - body >= MIN_RIM_CONTRAST && bottom - body >= MIN_RIM_CONTRAST,
                    `[${theme}] FAILURE 3 — the rim must be BRIGHT on both faces over a ` +
                    `#0e0e0e panel: body ${body.toFixed(1)}, top ${top.toFixed(1)}, ` +
                    `bottom ${bottom.toFixed(1)}.`);

                // The premise of the variant: a transparent fill is a DARKER
                // floor, so the rim reads better here than the tinted variant
                // does on the stage it was measured on.
                const n = state.neutral;
                const nBody = lum(n.box.x + 40, n.box.y + n.box.h / 2);
                const nTop = lum(n.box.x + n.box.w / 2, n.box.y);
                check((top - body) > (nTop - nBody),
                    `[${theme}] FAILURE 3 — clear's top rim contrast (+${(top - body).toFixed(1)}) ` +
                    `has fallen below neutral's on #242424 (+${(nTop - nBody).toFixed(1)}). ` +
                    `The whole argument for putting this material on a flat near-black panel ` +
                    `is that it reads BETTER there, not worse.`);
            } else {
                check(body - top >= MIN_RIM_CONTRAST && body - bottom >= MIN_RIM_CONTRAST,
                    `[${theme}] FAILURE 3 — the rim must INVERT to dark over a #f9f9f9 panel ` +
                    `(a white rim on a near-white body is invisible): body ${body.toFixed(1)}, ` +
                    `top ${top.toFixed(1)}, bottom ${bottom.toFixed(1)}.`);
                check(bottom < top,
                    `[${theme}] FAILURE 3 — the underside is the face in shadow and must be ` +
                    `darker than the top: top ${top.toFixed(1)}, bottom ${bottom.toFixed(1)}.`);

                // ── 4. no contact shadow on a body you can see through ─────
                const outer = w.boxShadow.split(/,(?![^(]*\))/).filter(s => !s.includes('inset'));
                check(outer.length === 0,
                    `[${theme}] FAILURE 4 — clear picked up a contact shadow (${outer.join(', ')}). ` +
                    `action and sky cast one because a solid body sits ON the card; a chip you ` +
                    `can see the panel through is not sitting on anything.`);
                check(w.boxShadow.includes('inset'),
                    `[${theme}] FAILURE 3 — the underside inset is gone, and it is the whole of ` +
                    `the depth in light mode now that there is no contact shadow.`);
            }
        }
    } catch (err) {
        failures.push(`harness error: ${err && err.stack ? err.stack : err}`);
    } finally {
        if (win) win.destroy();
    }

    if (failures.length) {
        console.error(`\n✗ clear-variant-liquid-glass: ${failures.length} failure(s)\n`);
        for (const f of failures) console.error(`  • ${f}\n`);
        app.exit(1);
    } else {
        console.log('✓ clear-variant-liquid-glass: label inherits, cap fade is length-pinned, '
            + 'both themes invert, no contact shadow on a transparent body');
        app.exit(0);
    }
});
