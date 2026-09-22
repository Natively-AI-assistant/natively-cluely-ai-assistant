// Regression check: the overlay shell card must carry a visible dashed ring
// while undetectable mode is on, in every interface theme.
//
// Background: undetectable mode has no in-panel tell. It flips
// setContentProtection on the overlay/pill/toggle windows, hides the macOS
// Dock entry and the Windows taskbar button — all state you can only confirm
// by looking somewhere other than the panel you are using. The dashed ring
// added in src/index.css (@undetectable-ring fences) is that tell.
//
// The defect this guards is a cascade one, and it is the reason the ring is an
// OUTLINE rather than a restyled border. `.overlay-shell-surface` is redefined
// per interface theme with `border-color: … !important` — liquid-glass forces
// it to `transparent` outright — and `appearance.shellStyle` sets
// `borderColor` INLINE on the same element. A `border-style`/`border-color`
// rule for the ring would therefore lose the cascade in exactly the themes
// nobody would think to check, and ship as dead CSS. That is the same failure
// documented for PR #499 in the cursor lock directly above the ring rule.
//
// Why this runs in Electron rather than by reading the stylesheet: a text
// assertion cannot tell you who WINS a cascade — and reading the rule is what
// missed the `!important` the first time. This resolves the real cascade in
// the real engine, across the full theme matrix, and reads getComputedStyle.
//
// Run: npm run test:css:undetectable-ring
//
// The check asserts FOUR directions so it cannot silently rot:
//   1. undetectable on            → dashed 2px ring at offset +3px, in every
//                                   interface theme × colour theme
//   2. the ring colour is VISIBLE → non-transparent, and alpha above a floor
//                                   (a ring at alpha 0.05 is not an indicator)
//   3. undetectable off / unset   → the ring stays in the box (so the colour
//                                   channel can fade it) but fully TRANSPARENT
//                                   — invisibility, not absence
//   4. with the ring block cut    → no outline even with the mode on (proves
//                                   the rule is load-bearing, not decoration)
//
// The WIDTH assertion is load-bearing, and is why it is a whole number.
// Chromium resolves the USED outline-width per device-pixel-ratio: the first
// draft of this ring specified 1.5px, which came back as 1.5px on the Retina
// display it was written on but was floored to 1px at DPR 1, where the dashes
// collapse into a hairline nobody can see. The width also sets the DASH
// geometry (Chromium derives dash length and gap from it), so it is not a free
// knob. DPR 1 is the DEFAULT on most Windows
// displays, so that draft would have shipped an invisible indicator to most
// Windows users while looking correct on the author's Mac. It also would have
// made THIS check flaky — passing on a Retina display and failing on a 1x one.
// An integer width resolves identically at every scale, which is what makes the
// assertion below DPI-invariant. Verified live under --force-device-scale-factor=1.
//
// The offset assertion is load-bearing too, and its direction is the whole
// point. The ring sits OUTSIDE the card, in a transparent gutter that had to be
// created for it: the card used to be flush to the native window on both axes
// (measured live at y=0, h=153.625 in a 154px window), so anything painted past
// the card's box was clipped away. OVERLAY_PANEL_INSET (padding on contentRef,
// whose offsetHeight is the window height) is that gutter, and offset + width
// must fit inside it. Overflowing produces no error and no warning — the ring
// just loses an edge — so both halves are asserted here.
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const INDEX_CSS = resolve(process.cwd(), 'src/index.css');

// Fences around the ring block, so the baseline can remove exactly it and
// nothing else. Renaming them without updating this check fails loudly below.
const RING_START = '/* @undetectable-ring:start */';
const RING_END = '/* @undetectable-ring:end */';

// Copied from the real card in src/components/NativelyInterface.tsx. The class
// list matters: `overlay-shell-surface` is the element every theme block
// re-declares with !important, so a fixture that omitted it would under-test.
const CARD_CLASS =
  'relative max-w-full backdrop-blur-2xl border rounded-[24px] overflow-hidden ' +
  'flex flex-col draggable-area overlay-shell-surface overlay-shell-container';

// Mirrors appearance.shellStyle (src/lib/overlayAppearance.ts) — an INLINE
// borderColor on the same element. Present so the fixture reproduces the
// highest-priority declaration the ring has to coexist with.
const CARD_INLINE_STYLE =
  'width:600px;height:200px;background-color:rgba(24,26,32,0.67);' +
  'border-color:rgba(255,255,255,0.13);box-shadow:none;';

const INTERFACE_THEMES = ['default', 'liquid-glass', 'modern'];
const COLOR_THEMES = ['dark', 'light'];

// A ring this faint is present in getComputedStyle but invisible on screen —
// the check would pass while the feature did nothing.
const MIN_ALPHA = 0.3;

// Longer than the 340ms enter fade, so every sample is taken at rest rather
// than mid-interpolation.
const SETTLE_MS = 500;

// Must track OVERLAY_PANEL_INSET in src/lib/overlayCustomSize.mjs, and the
// p-[6px] on the overlay's contentRef that realises it.
const GUTTER_PX = 6;

function loadCss(withRing) {
  // Distinguish "run from the wrong directory" from a real regression — an
  // ENOENT here would otherwise surface as a failing check and cry wolf.
  if (!existsSync(INDEX_CSS)) {
    throw new Error(
      `stylesheet not found at ${INDEX_CSS} — run this from the repo root ` +
        `(npm run test:css:undetectable-ring), not from a subdirectory. This is a ` +
        `harness problem, not a CSS regression.`,
    );
  }
  const css = readFileSync(INDEX_CSS, 'utf8');
  const start = css.indexOf(RING_START);
  const end = css.indexOf(RING_END);
  if (start === -1 || end === -1) {
    throw new Error(
      `undetectable-ring fences not found in index.css (${RING_START} … ${RING_END}). ` +
        `The ring block was renamed or removed — update this check rather than deleting it.`,
    );
  }
  if (withRing) return css;
  return css.slice(0, start) + css.slice(end + RING_END.length);
}

// The whole stylesheet is used verbatim rather than sliced: source order is
// half of what decides this cascade (the `*:focus-visible { outline: … }` rule
// sits AFTER the ring block), so any excerpt could resolve differently from the
// file that actually ships. @tailwind/@font-face at-rules that cannot resolve
// from a temp directory are inert for an outline measurement.
const page = (css) => `<meta charset="utf-8"><style>
${css}
</style>
<body style="margin:0">
${INTERFACE_THEMES.map(
  (it) => `<div data-interface-theme="${it}">
  <div data-shell-root="">
    <div id="card-${it}" data-shell-card="" class="${CARD_CLASS}" style="${CARD_INLINE_STYLE}"></div>
  </div>
</div>`,
).join('\n')}
</body>`;

// getComputedStyle gives `rgb(r, g, b)` when fully opaque and
// `rgba(r, g, b, a)` otherwise. Returns null for anything unparseable so a
// format change surfaces as a failure rather than a bogus alpha of 0.
function parseAlpha(color) {
  const m = /^rgba?\(([^)]+)\)$/.exec(String(color).trim());
  if (!m) return null;
  const parts = m[1].split(/[,/]/).map((s) => s.trim());
  if (parts.length === 3) return 1;
  if (parts.length === 4) return Number.parseFloat(parts[3]);
  return null;
}

async function measure() {
  const win = new BrowserWindow({ width: 800, height: 600, show: false });
  const written = [];
  const load = async (withRing) => {
    const fixture = join(tmpdir(), `natively-undetectable-ring-${withRing}.html`);
    writeFileSync(fixture, page(loadCss(withRing)));
    written.push(fixture);
    await win.loadFile(fixture);
    const out = {};
    for (const colorTheme of COLOR_THEMES) {
      for (const mode of ['on', 'off', 'unset']) {
        await win.webContents.executeJavaScript(`(() => {
          const r = document.documentElement;
          r.dataset.theme = ${JSON.stringify(colorTheme)};
          if (${JSON.stringify(mode)} === 'unset') delete r.dataset.undetectable;
          else r.dataset.undetectable = ${JSON.stringify(mode)} === 'on' ? 'true' : 'false';
        })()`);
        // Settle past the 340ms enter / 220ms exit fade before sampling. One
        // rAF would land MID-TRANSITION and read an interpolated colour, which
        // would make this check flaky by construction.
        const measured = await win.webContents.executeJavaScript(`
          new Promise(r => setTimeout(() => requestAnimationFrame(() => {
            const out = {};
            for (const it of ${JSON.stringify(INTERFACE_THEMES)}) {
              const cs = getComputedStyle(document.getElementById('card-' + it));
              out[it] = {
                style: cs.outlineStyle,
                width: cs.outlineWidth,
                offset: cs.outlineOffset,
                color: cs.outlineColor,
              };
            }
            r(out);
          }), ${SETTLE_MS}));
        `);
        out[`${colorTheme}/${mode}`] = measured;
      }
    }
    return out;
  };
  try {
    return { fixed: await load(true), baseline: await load(false) };
  } finally {
    win.destroy();
    for (const f of written) rmSync(f, { force: true });
  }
}

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    const { fixed, baseline } = await measure();

    for (const colorTheme of COLOR_THEMES) {
      for (const it of INTERFACE_THEMES) {
        const on = fixed[`${colorTheme}/on`][it];
        const where = `[data-theme=${colorTheme}][data-interface-theme=${it}]`;

        check(
          on.style === 'dashed',
          `${where}: outline-style resolved "${on.style}" with undetectable mode ON, ` +
            `expected "dashed" — the mode has no visual tell in this theme`,
        );
        check(
          on.width === '2px',
          `${where}: outline-width resolved "${on.width}", expected "2px" — a fractional width is floored to 1px at DPR 1 (the Windows default) and the dots collapse into an invisible hairline`,
        );
        // POSITIVE: the ring paints in the transparent gutter outside the card.
        // offset + width must stay within OVERLAY_PANEL_INSET or the native
        // window clips it, silently and with no error — the ring just loses an
        // edge. GUTTER_PX below pins the other half of that invariant.
        check(
          on.offset === '3px',
          `${where}: outline-offset resolved "${on.offset}", expected "3px"`,
        );
        check(
          parseFloat(on.offset) + parseFloat(on.width) <= GUTTER_PX,
          `${where}: offset ${on.offset} + width ${on.width} exceeds the ${GUTTER_PX}px ` +
            `panel gutter — the ring paints past the window edge and is clipped away. ` +
            `Raise OVERLAY_PANEL_INSET (and contentRef's padding with it) or shrink the ring`,
        );

        const alpha = parseAlpha(on.color);
        check(
          alpha !== null,
          `${where}: outline-color "${on.color}" could not be parsed — ` +
            `getComputedStyle's colour format changed, update parseAlpha`,
        );
        check(
          alpha === null || alpha >= MIN_ALPHA,
          `${where}: outline-color "${on.color}" has alpha ${alpha}, below the ${MIN_ALPHA} ` +
            `floor — the ring resolves but is too faint to read as an indicator. ` +
            `--overlay-undetectable-ring is probably unset for this theme and falling ` +
            `back to a hairline border colour`,
        );

        // Off and unset must both be inert. `unset` is the real boot state:
        // NativelyInterface mirrors the attribute asynchronously, so the very
        // first frames have no attribute at all.
        // Off and unset must both be INVISIBLE — not absent. The ring is
        // permanently in the box as `2px dashed transparent` so that the colour
        // channel can carry the fade (outline-style is not animatable), which
        // means the honest assertion is alpha 0, not `outline-style: none`.
        for (const mode of ['off', 'unset']) {
          const m = fixed[`${colorTheme}/${mode}`][it];
          const a = parseAlpha(m.color);
          check(
            m.style === 'dashed',
            `${where}: outline-style resolved "${m.style}" with undetectable ${mode}, ` +
              `expected "dashed" — the ring must stay in the box at alpha 0 so the colour ` +
              `channel can fade it in; removing it turns the fade back into a cut`,
          );
          check(
            a === 0,
            `${where}: outline-color "${m.color}" (alpha ${a}) with undetectable ${mode}, ` +
              `expected fully transparent — the ring is leaking into normal mode`,
          );
        }

        // Without the ring block the card must have no outline. If it does not,
        // something else is drawing one and the passing case proves nothing.
        check(
          baseline[`${colorTheme}/on`][it].style === 'none',
          `${where}: baseline (ring block cut) resolved outline-style ` +
            `"${baseline[`${colorTheme}/on`][it].style}", expected "none" — the ring is ` +
            `coming from somewhere other than the block under test, so the passing ` +
            `case is vacuous`,
        );
      }

      // The dark/light split must actually be reached: a black ring on the
      // dark panel (or a white one on the light panel) resolves fine and is
      // invisible. Only the DEFAULT interface theme follows data-theme —
      // liquid-glass and modern paint a dark panel either way.
      const def = fixed[`${colorTheme}/on`].default.color;
      check(
        colorTheme === 'light'
          ? /^rgba?\(0, 0, 0/.test(def)
          : /^rgba?\(255, 255, 255/.test(def),
        `[data-theme=${colorTheme}][data-interface-theme=default]: ring colour "${def}" is ` +
          `not the ${colorTheme}-theme value — the ${colorTheme} override for ` +
          `--overlay-undetectable-ring is not being reached`,
      );
    }

    // The specific trap: [data-theme='light'] + liquid-glass/modern still paints
    // a DARK panel, so those themes must NOT inherit the light theme's near-black
    // ring. This is the case a single-theme check would miss.
    for (const it of ['liquid-glass', 'modern']) {
      const c = fixed['light/on'][it].color;
      check(
        /^rgba?\(255, 255, 255/.test(c),
        `[data-theme=light][data-interface-theme=${it}]: ring colour "${c}" inherited the ` +
          `light theme's dark ring, but this theme paints a DARK panel in light mode — ` +
          `the ring is invisible. Re-declare --overlay-undetectable-ring in the ${it} block`,
      );
    }

    if (failures.length) {
      console.error('✗ undetectable-ring check FAILED');
      for (const f of failures) console.error('  · ' + f);
      console.error(`  measured: ${JSON.stringify(fixed, null, 2)}`);
      app.exit(1);
      return;
    }
    console.log(
      `✓ undetectable-ring check passed (dashed 2px ring at offset +3px in ` +
        `${INTERFACE_THEMES.length} interface themes x ${COLOR_THEMES.length} colour themes, ` +
        `transparent when off/unset, baseline clean, Electron ${process.versions.electron} / ` +
        `Chrome ${process.versions.chrome})`,
    );
    app.exit(0);
  } catch (err) {
    console.error('✗ undetectable-ring check ERRORED:', err.message);
    app.exit(1);
  }
});
