// Regression check: `.lg-bubble`, the meeting notes Usage tab's question bubble,
// and `.lg-chip`, the gist tag beside it — see src/ui-components/design.md.
//
// Run: npm run test:css:bubble-liquid-glass
//
// The bubble is THE ORIGINAL Liquid Glass material (the measured macOS 27
// pill, as .lg-action draws it) by owner request, turned SUBTLE (the owner
// found full strength "too evident"), with nothing painted outside it and no
// hover effect — both of which the owner had removed earlier.
//
// What each failure below protects:
//
//   1. THE BODY STOPS BEING THE TOGGLE COLOUR. The fill is the Settings
//      toggle's ON colour (--toggle-on, #6688F5) in dark mode and that colour
//      lifted 25% toward white (~#8CA6F8) in light mode, both mixed from the one
//      token. The tokens are read out of src/index.css, not restated here, so a
//      light block going back to a dark fill, or the bubble drifting off
//      --toggle-on, fails this check rather than passing a fixture.
//
//   2. THE ORIGINAL LIGHTING BREAKS. The top face carries the specular rim in
//      both themes; the bottom face catches the bounce in dark and is the
//      underside in shadow in light (.lg-action's light rule); both side faces
//      sit in shadow (the original's caps) — but only just: upper bars fail the
//      original's full-strength weights; the rim reaches full strength by the
//      corner radius (.lg-wide's px cap stops); and the text's ink band sits on
//      the flat fill, so the sheens stay in the padding.
//
//   3. SOMETHING IS PAINTED AROUND THE CARD AGAIN. The pane 6px below and 8px
//      beside it must be the pane in both themes, and in light mode nothing may
//      darken the pane from the first clean pixel out.
//
//   4. HOVERING CHANGES THE CARD. The original's lens and hover tint are left
//      off (the owner had the pointer effect removed as "water-like"); a
//      pointer over the card must leave every sampled pixel as it was.
//
//   5. THE FOREGROUND TOKEN STOPS REACHING THE TEXT.
//
//   6. HIGH CONTRAST STOPS DOING WHAT THE ORIGINAL DOES: the rim gives way and
//      the body darkens to #2C5BF1, where white text clears AA.
//
//   7. THE GIST CHIP (.lg-chip, a very quiet glass that stays). Rendered beside
//      a plain twin using the real .overlay-gist-chip rules from src/index.css:
//      the box must not move (the ring replaces the border and the padding
//      takes its 1px back), the top-left crescent must read, the chip's
//      interior must be the host's own fill, and high contrast drops the light.
//
// Electron rather than stylesheet-text assertions, for the same reason as the
// clear-variant check: every one of these is a composited pixel or a resolved
// value, not a rule.
//
// CAPTURE TRAPS, all measured: the 2x capture is upscaled with a sharpening
// filter that rings beside every edge — about +10 luma just inside an edge
// meeting a darker pane, about -18 just outside a bright edge on the dark
// pane, +8 just outside the card on the light pane. None of it is paint and
// all of it is gone within 4px, which is why the samples below sit where they
// do, and why the light-mode near-edge check is one-sided.
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const CSS_PATH = resolve(process.cwd(), 'src/ui-components/LiquidGlassButton.css');
const TOKENS_PATH = resolve(process.cwd(), 'src/index.css');

// MeetingDetails' panes: bg-bg-elevated in dark, bg-bg-secondary in light.
const PANES = { dark: '#151515', light: '#EBEBF0' };
const TOGGLE = [0x66, 0x88, 0xF5];    // --toggle-on, the Settings toggle's ON colour
// The rendered body per theme: the toggle colour in dark, and in light the
// toggle mixed 75/25 with white (140.25, 165.75, 247.5 before 8-bit rounding).
const FILLS = { dark: TOGGLE, light: [0x8C, 0xA6, 0xF8] };
const HC_FILL = 'rgb(44, 91, 241)';    // #2C5BF1, prefers-contrast: more
const CORNER = 16;                     // rounded-2xl
const WIDE = 666;                      // the tall bubble's width in the real Usage tab
const WIDTH = 760;
const HEIGHT = 420;

// Measured on the SUBTLE original (luma against the body, edge row 0.75px in,
// mid-edge): top rim +50 dark / +24 light; bottom +50 dark (the bounce) / -15
// light (the underside); side faces, 1.25px in, -17 dark / -38 light. A bare
// edge reads +10 dark / -9 light on top and bottom, and +6 dark / -5 light on
// the sides, from the capture's ringing alone — every lower bar clears that.
// The UPPER bars keep it subtle: at the original's full strength the owner
// found it "too evident, like trying too hard" — sides -54 dark / -95 light,
// underside -30 — and each of those fails here.
const MIN_TOP_RIM = { dark: 25, light: 10 };
const MIN_BOUNCE_RIM = 25;             // dark, bottom face
const MIN_UNDERSIDE = 12;              // light, bottom face darker than the body
const MAX_UNDERSIDE = 22;
const MIN_SIDE_SHADE = 10;
const MAX_SIDE_SHADE = { dark: 30, light: 60 };
// Ink band: the fill, +-2 per channel.
const MAX_FILL_DRIFT = 2;
// The pane 6px below / 8px beside the card. The removed halo measured -35.
const MAX_HALO = 3;
// Light mode, 0.75-2px below, one-sided: the removed 1px contact shadow
// measured -17 / -11 / -6 there; the capture's own overshoot is BRIGHTER (+8).
const MAX_EDGE_SHADOW = 5;
// A hover must not move a sampled pixel by more than this.
const MAX_HOVER_CHANGE = 2;
// The chip's crescent is deliberately faint: measured +13 (light) / +16 (dark)
// over the middle of its own top edge. Both samples sit on the same edge, so
// the ringing cancels out of the difference.
const MIN_CHIP_CRESCENT = 8;
const SETTLE_MS = 350;
const HOVER_SETTLE_MS = 450;           // longer than any transition the glint had

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

function mustRead(path) {
    if (!existsSync(path)) {
        throw new Error(
            `${path} not found — run this from the repo root ` +
            `(npm run test:css:bubble-liquid-glass). This is a harness problem, not a CSS regression.`,
        );
    }
    return readFileSync(path, 'utf8');
}

// The periwinkle scale, the toggle palette (--bubble-user-bg points at
// --toggle-on) and the bubble pair, from every top-level block whose
// selector is exactly `selector`, in source order so a later block wins as it
// does in the cascade. Only custom-property declarations are taken.
function tokensFrom(css, selector) {
    const out = [];
    let at = 0;
    while ((at = css.indexOf(`\n${selector} {`, at)) !== -1) {
        const open = css.indexOf('{', at);
        let depth = 1;
        let i = open + 1;
        for (; i < css.length && depth > 0; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
        }
        const body = css.slice(open + 1, i - 1).replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of body.matchAll(/(--(?:periwinkle|toggle|bubble-user)-[\w-]+)\s*:\s*([^;]+);/g)) {
            out.push(`${m[1]}: ${m[2].trim()};`);
        }
        at = i;
    }
    return out.join('\n  ');
}

// Every top-level rule in src/index.css whose selector starts with
// .overlay-gist-chip (the host's chip, and its .lg-chip adaptation), so the
// chip twins below render with the real host styles, not a restatement.
function chipHostRules(css) {
    const out = [];
    const re = /\n(\.overlay-gist-chip[^{\n]*)\{([^}]*)\}/g;
    for (const m of css.matchAll(re)) out.push(`${m[1]}{${m[2]}}`);
    return out.join('\n');
}

function sampler(shot) {
    const size = shot.getSize();
    const bitmap = shot.toBitmap();                  // BGRA
    const scale = size.width / WIDTH;
    // floor, not round: a sample at y + h - 0.5 must stay on the box's last
    // row at 1x too, where round() lands on the first pane row below.
    const rgb = (x, y) => {
        const i = (Math.floor(y * scale) * size.width + Math.floor(x * scale)) * 4;
        return [bitmap[i + 2], bitmap[i + 1], bitmap[i]];
    };
    const lum = (x, y) => {
        const [r, g, b] = rgb(x, y);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const hex = (c) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    return { rgb, lum, hex };
}

// The host's Tailwind classes, spelled out: px-5 py-2.5 rounded-2xl
// rounded-tr-sm max-w-[80%] text-[15px]. The one deliberate difference is the
// leading: leading-relaxed is 24.375px, which leaves every box on a fractional
// height and blends the edge rows with the pane; 24px lands them on whole pixels.
const bubble = (id, text, style = '') =>
    `<div id="${id}" class="lg-bubble" style="padding:10px 20px;` +
    `border-radius:${CORNER}px 2px ${CORNER}px ${CORNER}px;max-width:80%;font-size:15px;` +
    `line-height:24px;${style}">${text}</div>`;

const chip = (id, glass, text) =>
    `<div class="chip-row"><div id="${id}" class="overlay-gist-chip${glass ? ' lg-chip' : ''}">${text}</div></div>`;

const page = (css, rootTokens, lightTokens, chipCss) => `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>
  :root { ${rootTokens} }
  [data-theme='light'] { ${lightTokens} }
  html, body { margin:0; padding:0; font-family: Inter, system-ui, sans-serif; }
  html[data-theme="dark"]  body { background:${PANES.dark}; }
  html[data-theme="light"] body { background:${PANES.light}; }
  .stage { width:${WIDTH}px; padding:24px; box-sizing:border-box; }
  .row { width:500px; margin:0 0 28px auto; display:flex; flex-direction:column; align-items:flex-end; }
  .row.wide { width:auto; }
  .chip-row { margin: 0 0 12px; }
  :root { --hotword-color: #C4B5FD; --overlay-text-secondary: rgba(255, 255, 255, 0.9); }
  [data-theme='light'] { --hotword-color: #6D5AC7; --overlay-text-secondary: rgba(110, 110, 115, 0.95); }
${chipCss}
${css}
</style></head><body><div class="stage">
  <div class="row">${bubble('short', 'What was the budget?')}</div>
  <div class="row">${bubble('tall', 'Can you walk me through how the migration plan handles the ledger ' +
      'rollback if the second batch fails halfway, and who owns the call to abort it?')}</div>
  <div class="row wide">${bubble('wide', 'Transparent text, so the ink band can be sampled as fill.',
      `width:${WIDE}px;max-width:none;box-sizing:border-box;height:92px;color:transparent`)}</div>
  ${chip('chip-plain', false, 'Q4 spend 8% under plan')}
  ${chip('chip-glass', true, 'Q4 spend 8% under plan')}
</div><span id="fg-probe" style="color:var(--bubble-user-fg)"></span>
<span id="bg-probe" style="background-color:var(--bubble-user-bg)"></span>
<span id="toggle-probe" style="background-color:var(--toggle-on)"></span></body></html>`;

const readState = `(() => {
  const out = {};
  for (const id of ['short', 'tall', 'wide', 'chip-plain', 'chip-glass']) {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    out[id] = { x: r.x, y: r.y, w: r.width, h: r.height, color: getComputedStyle(el).color };
  }
  // The token's resolved value, so failure 5 checks that the token reaches the
  // text rather than that the text is white: swapping --bubble-user-fg to a dark
  // foreground is the documented contrast fix and must not trip this check.
  out.fgToken = getComputedStyle(document.getElementById('fg-probe')).color;
  // No fallback on these, unlike .lg-bubble's own var(): the stylesheet falls
  // back to the same #6688f5, so a --bubble-user-bg that failed to resolve
  // would paint the right body and pass failure 1 without testing the token.
  out.bgToken = getComputedStyle(document.getElementById('bg-probe')).backgroundColor;
  out.toggleToken = getComputedStyle(document.getElementById('toggle-probe')).backgroundColor;
  return JSON.stringify(out);
})()`;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
    let win;
    try {
        const tokenCss = mustRead(TOKENS_PATH);
        const rootTokens = tokensFrom(tokenCss, ':root');
        const lightTokens = tokensFrom(tokenCss, "[data-theme='light']");
        check(rootTokens.includes('--bubble-user-bg'),
            `harness drift — no --bubble-user-bg found in a top-level :root block of ` +
            `src/index.css, so the bubble renders on the stylesheet's fallback and ` +
            `failure 1 can no longer fail.`);
        const chipCss = chipHostRules(tokenCss);
        check(chipCss.includes('.overlay-gist-chip.lg-chip'),
            `harness drift — no .overlay-gist-chip.lg-chip rule found in src/index.css, so ` +
            `failure 7 renders a chip without the host's border-to-ring swap.`);

        const file = join(tmpdir(), `lg-bubble-check-${process.pid}.html`);
        writeFileSync(file, page(mustRead(CSS_PATH), rootTokens, lightTokens, chipCss));

        win = new BrowserWindow({
            width: WIDTH, height: HEIGHT, show: false,
            webPreferences: { offscreen: true, deviceScaleFactor: 1 },
        });
        await win.loadFile(file);
        const js = (src) => win.webContents.executeJavaScript(src);

        const bgTokens = {};
        for (const theme of ['dark', 'light']) {
            await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); 1`);
            // Park the pointer off every card before the resting capture.
            win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
            await new Promise(r => setTimeout(r, SETTLE_MS));

            const state = JSON.parse(await js(readState));
            const { rgb, lum, hex } = sampler(await win.webContents.capturePage());
            const FILL = FILLS[theme];

            const { short: s, tall: t, wide: w } = state;
            check(t.h > s.h * 1.8,
                `[${theme}] fixture drift: the tall bubble is ${t.h}px against the short one's ` +
                `${s.h}px, so it no longer wraps.`);
            check(Math.round(w.w) === WIDE && [w.x, w.y, w.w, w.h].every(Number.isInteger),
                `[${theme}] fixture drift: the wide bubble is ${JSON.stringify(w)}, not a whole-pixel ` +
                `${WIDE}px box, so failures 2-4 no longer sample what they claim.`);

            // ── 1. the body is the toggle colour in this theme ─────────────
            const toggleRgb = `rgb(${TOGGLE.join(', ')})`;
            check(state.toggleToken === toggleRgb,
                `[${theme}] FAILURE 1 — --toggle-on resolves to ${state.toggleToken}, not ` +
                `${toggleRgb}. Either the toggle was retuned (update TOGGLE and FILLS here) or ` +
                `the harness no longer picks the --toggle-* tokens out of src/index.css.`);
            if (theme === 'dark') {
                check(state.bgToken === state.toggleToken,
                    `[dark] FAILURE 1 — --bubble-user-bg resolves to ${state.bgToken}, not ` +
                    `--toggle-on (${state.toggleToken}).`);
            }
            bgTokens[theme] = state.bgToken;
            const body = rgb(w.x + w.w / 2, w.y + w.h / 2);
            check(body.every((v, i) => Math.abs(v - FILL[i]) <= 1),
                `[${theme}] FAILURE 1 — the bubble body renders ${hex(body)}, not ` +
                `${hex(FILL)}. Check --bubble-user-bg in src/index.css: var(--toggle-on) in ` +
                `:root, and the 75% color-mix of it with white in [data-theme='light'].`);

            // ── 2. the original lighting ───────────────────────────────────
            const mid = lum(w.x + w.w / 2, w.y + w.h / 2);
            const topMid = lum(w.x + w.w / 2, w.y + 0.75);
            const botMid = lum(w.x + w.w / 2, w.y + w.h - 0.75);
            check(topMid - mid >= MIN_TOP_RIM[theme],
                `[${theme}] FAILURE 2 — the top rim does not read: ${topMid.toFixed(1)} mid-edge ` +
                `against the body's ${mid.toFixed(1)} (want +${MIN_TOP_RIM[theme]}).`);
            if (theme === 'dark') {
                check(botMid - mid >= MIN_BOUNCE_RIM,
                    `[dark] FAILURE 2 — the bottom rim does not read: ${botMid.toFixed(1)} against ` +
                    `the body's ${mid.toFixed(1)}. On a dark stage the material catches a bounce from below.`);
            } else {
                check(mid - botMid >= MIN_UNDERSIDE,
                    `[light] FAILURE 2 — the underside is not in shadow: ${botMid.toFixed(1)} against ` +
                    `the body's ${mid.toFixed(1)}. On a light card there is no bounce.`);
                check(mid - botMid <= MAX_UNDERSIDE,
                    `[light] FAILURE 2 — the underside is too heavy: ${botMid.toFixed(1)} against the ` +
                    `body's ${mid.toFixed(1)}. It is meant to be subtle.`);
            }
            for (const [side, x] of [['left', w.x + 1.25], ['right', w.x + w.w - 1.25]]) {
                const face = lum(x, w.y + w.h / 2);
                check(mid - face >= MIN_SIDE_SHADE,
                    `[${theme}] FAILURE 2 — the ${side} side face is not in shadow: ${face.toFixed(1)} ` +
                    `against the body's ${mid.toFixed(1)} (want ${MIN_SIDE_SHADE} darker).`);
                check(mid - face <= MAX_SIDE_SHADE[theme],
                    `[${theme}] FAILURE 2 — the ${side} side face is too dark: ${face.toFixed(1)} ` +
                    `against the body's ${mid.toFixed(1)}. It is meant to be subtle, not the ` +
                    `original's full-strength caps.`);
            }
            const atCorner = lum(w.x + CORNER, w.y + 0.75);
            const across = lum(w.x + 60, w.y + 0.75);
            check(Math.abs(across - atCorner) <= 3,
                `[${theme}] FAILURE 2 — the top rim is still changing past the corner: ` +
                `${atCorner.toFixed(1)} at ${CORNER}px vs ${across.toFixed(1)} at 60px. The cap stops ` +
                `must be px lengths pinned to the corner radius (.lg-wide), not percentages of width.`);
            let worst = { d: 0 };
            for (let y = w.y + 14; y <= w.y + w.h - 14; y += 3) {
                for (let x = w.x + 20; x <= w.x + w.w - 20; x += 6) {
                    const c = rgb(x, y);
                    const d = Math.max(...c.map((v, i) => Math.abs(v - FILL[i])));
                    if (d > worst.d) worst = { d, x: x - w.x, y: y - w.y, c: hex(c) };
                }
            }
            check(worst.d <= MAX_FILL_DRIFT,
                `[${theme}] FAILURE 2 — the text does not sit on the flat fill: ${worst.c} at ` +
                `(+${worst.x}, +${worst.y}), ${worst.d} levels off ${hex(FILL)}. The sheens must end ` +
                `inside the 10px padding.`);

            // ── 3. nothing painted around the card ─────────────────────────
            const pane = lum(4, 4);
            for (const [where, x, y] of [
                ['6px below', w.x + w.w / 2, w.y + w.h + 6],
                ['8px left of', w.x - 8, w.y + w.h / 2],
            ]) {
                const around = lum(x, y);
                check(Math.abs(pane - around) <= MAX_HALO,
                    `[${theme}] FAILURE 3 — a halo is back around the card: the pane reads ` +
                    `${around.toFixed(1)} ${where} it against ${pane.toFixed(1)} clear of it.`);
            }
            // Below only: a contact shadow is offset DOWN, and that is where the
            // removed one measured -17 / -11 / -6. Beside the card the side
            // face's dark cap ring makes the capture ring (-5 at 2px, nothing
            // painted there), so a sideways near-edge sample cannot tell.
            if (theme === 'light') {
                for (const d of [0.75, 1.25, 2]) {
                    for (const [where, x, y] of [
                        ['below', w.x + w.w / 2, w.y + w.h + d],
                    ]) {
                        const edge = lum(x, y);
                        check(pane - edge <= MAX_EDGE_SHADOW,
                            `[light] FAILURE 3 — a shadow line is back at the card's edge: the ` +
                            `pane reads ${edge.toFixed(1)} ${d}px ${where} it against ` +
                            `${pane.toFixed(1)}.`);
                    }
                }
            }

            // ── 4. hovering changes nothing ────────────────────────────────
            const probes = [
                [w.x + 24, w.y + 0.75], [w.x + 60, w.y + 0.75], [w.x + w.w / 2, w.y + 0.75],
                [w.x + 0.75, w.y + w.h / 2], [w.x + 60, w.y + 6], [w.x + 60, w.y + w.h / 2],
                [w.x + w.w - 24, w.y + w.h - 0.75],
            ];
            const before = probes.map(([x, y]) => lum(x, y));
            win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(w.x + 60), y: Math.round(w.y + 20) });
            await new Promise(r => setTimeout(r, HOVER_SETTLE_MS));
            const hovered = sampler(await win.webContents.capturePage());
            const moved = probes
                .map(([x, y], i) => ({ x: x - w.x, y: y - w.y, d: Math.abs(hovered.lum(x, y) - before[i]) }))
                .filter(p => p.d > MAX_HOVER_CHANGE);
            check(moved.length === 0,
                `[${theme}] FAILURE 4 — hovering changes the card: ${JSON.stringify(moved)}. No ` +
                `lens and no hover tint: the owner had the pointer effect removed.`);
            win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });

            // ── 5. the foreground token reaches the text ───────────────────
            check(t.color === state.fgToken,
                `[${theme}] FAILURE 5 — the bubble text is ${t.color}, not --bubble-user-fg ` +
                `(${state.fgToken}).`);

            // ── 7. the gist chip ───────────────────────────────────────────
            const cp = state['chip-plain'];
            const cg = state['chip-glass'];
            check(cg.w === cp.w && cg.h === cp.h,
                `[${theme}] FAILURE 7 — the glass chip is ${cg.w}x${cg.h}, its plain twin ` +
                `${cp.w}x${cp.h}: dropping the border without adding 1px to the padding moves ` +
                `everything around it.`);
            // Inside the pill but clear of the text, which runs to 11px from the
            // right end: 6px in, mid-height, inside the right padding and well
            // clear of the 1px ring.
            const inner = (b) => rgb(b.x + b.w - 6, b.y + b.h / 2);
            const fillPlain = inner(cp);
            const fillGlass = inner(cg);
            check(fillGlass.every((v, i) => Math.abs(v - fillPlain[i]) <= 2),
                `[${theme}] FAILURE 7 — the glass chip's interior is ${hex(fillGlass)} where the ` +
                `host fill is ${hex(fillPlain)}: a glow has reached the body.`);
            const chipTopLeft = lum(cg.x + 10, cg.y + 0.75);
            const chipTopMid = lum(cg.x + cg.w / 2, cg.y + 0.75);
            check(chipTopLeft - chipTopMid >= MIN_CHIP_CRESCENT,
                `[${theme}] FAILURE 7 — no top-left crescent on the chip: ${chipTopLeft.toFixed(1)} ` +
                `at the corner vs ${chipTopMid.toFixed(1)} mid-edge.`);
        }

        // Both themes must READ --toggle-on rather than hold a copy of a hex,
        // or they drift the next time the toggle is retuned. Equal resolved
        // values cannot tell those apart; retuning the toggle in place can.
        await js(`document.documentElement.style.setProperty('--toggle-on', 'rgb(1, 2, 3)'); 1`);
        for (const theme of ['dark', 'light']) {
            await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); 1`);
            const followed = await js(`getComputedStyle(document.getElementById('bg-probe')).backgroundColor`);
            const ok = theme === 'dark' ? followed === 'rgb(1, 2, 3)' : followed !== bgTokens.light;
            check(ok,
                `[${theme}] FAILURE 1 — retuning --toggle-on left --bubble-user-bg at ` +
                `${followed}: the bubble holds a copy of a colour instead of reading ` +
                `var(--toggle-on).`);
        }
        await js(`document.documentElement.style.removeProperty('--toggle-on'); 1`);

        // ── 6. high contrast (and the chip's, failure 7) ───────────────────
        win.webContents.debugger.attach('1.3');
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',
            { features: [{ name: 'prefers-contrast', value: 'more' }] });
        for (const theme of ['dark', 'light']) {
            await js(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); 1`);
            const hc = await js(`getComputedStyle(document.getElementById('wide')).backgroundColor`);
            const rim = await js(`getComputedStyle(document.getElementById('wide'), '::before').content`);
            check(hc === HC_FILL && rim === 'none',
                `[${theme}] FAILURE 6 — prefers-contrast: more leaves the body at ${hc} (want ` +
                `${HC_FILL}) with the rim ${rim === 'none' ? 'gone' : 'still drawn'}.`);
            const chipHc = await js(`getComputedStyle(document.getElementById('chip-glass'), '::after').content`);
            check(chipHc === 'none',
                `[${theme}] FAILURE 7 — the chip keeps its crescents under prefers-contrast: more ` +
                `(::after content ${chipHc}).`);
        }
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    } catch (err) {
        failures.push(`harness error: ${err && err.stack ? err.stack : err}`);
    } finally {
        if (win) win.destroy();
    }

    if (failures.length) {
        console.error(`\n✗ bubble-liquid-glass: ${failures.length} failure(s)\n`);
        for (const f of failures) console.error(`  • ${f}\n`);
        app.exit(1);
    } else {
        console.log('✓ bubble-liquid-glass: toggle-colour bubble (lifted in light mode) in the original '
            + 'material — top rim, bounce (dark) / underside (light), sides in shadow, px cap stops, text on '
            + 'the flat fill; nothing painted around it, hover changes nothing, high contrast drops the rim; '
            + 'foreground token applied; gist chip glass keeps its box and fill, crescent reads');
        app.exit(0);
    }
});
