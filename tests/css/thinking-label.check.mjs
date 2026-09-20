// Regression check: the overlay's "Thinking..." waiting indicator must be
// legible in every interface theme x colour theme, and must still be VISIBLE
// when the user has asked for reduced motion.
//
// Why this check exists, in one sentence: this element has now regressed on the
// theme matrix twice. Once as the dot it replaced ("no thinking-dot under
// liquid-glass/modern", which is why src/dev/thinkingDotHarness.tsx exists), and
// once during the dot -> label change itself, where the first draft keyed its
// colours off `[data-theme='light']` and washed out in FOUR of the six
// combinations.
//
// The trap is specific and it is not obvious from reading the rule.
// `isLightTheme` in NativelyInterface.tsx means exactly
// `documentElement[data-theme] === 'light'` (useResolvedTheme.ts) — the COLOUR
// theme. But liquid-glass and modern paint a DARK panel in BOTH colour themes
// and therefore force WHITE text under [data-theme='light'] (see their token
// blocks in index.css, which say so). So anything that picks a light/dark pair
// off the colour theme alone is wrong wherever the interface theme disagrees
// with it. The label avoids that by reading --overlay-text-muted /
// --overlay-text-strong, which already encode the right answer for all six.
// This check pins that wiring.
//
// Why it runs in Electron rather than reading the stylesheet: the question is
// which declaration WINS across two independent theme axes, and reading rule
// text cannot answer that. It is also the only way to reach the reduced-motion
// branch, which is emulated over CDP below.
//
// Run: npm run test:css:thinking-label
//
// FOUR directions, so it cannot silently rot:
//   1. every combo     -> the gradient's base/sweep stops equal that combo's
//                         --overlay-text-muted / --overlay-text-strong
//   2. the light trap  -> light + liquid-glass/modern resolve to WHITE, not to
//                         the light theme's near-black
//   3. reduced motion  -> animation off AND the text is painted OPAQUE
//   4. block cut       -> without the fenced block nothing else clips to text,
//                         so the passing case is not vacuous
//
// The reduced-motion direction is the one most worth having. The label paints
// itself with `color: transparent` + `background-clip: text`, so if that branch
// ever stops re-asserting a real -webkit-text-fill-color, the indicator does not
// merely stop animating for those users — it becomes INVISIBLE, with no error
// anywhere. That failure is silent, affects only users who asked for less
// motion, and would never show up on the author's machine.
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const INDEX_CSS = resolve(process.cwd(), 'src/index.css');

// Fences around the label block, so the baseline can remove exactly it and
// nothing else. Renaming them without updating this check fails loudly below.
const LABEL_START = '/* @thinking-label:start */';
const LABEL_END = '/* @thinking-label:end */';

// Copied from the real pre-placeholder row in NativelyInterface.tsx. Only the
// span's own class matters to the measurements, but the wrapper is reproduced
// so the fixture stays greppable against the real source.
const ROW_HTML =
  '<div class="flex justify-start my-2.5 min-h-[24px] items-center">' +
  '<span id="label-THEME" class="natively-thinking-label text-[13px]">Thinking...</span>' +
  '</div>';

const INTERFACE_THEMES = ['default', 'liquid-glass', 'modern'];
const COLOR_THEMES = ['dark', 'light'];

// A base this faint resolves fine and is unreadable on screen.
const MIN_BASE_ALPHA = 0.4;

const EXPECTED_ANIMATION = 'natively-thinking-sweep';
const EXPECTED_DURATION = '1.6s';

function loadCss(withLabel) {
  // Distinguish "run from the wrong directory" from a real regression — an
  // ENOENT here would otherwise surface as a failing check and cry wolf.
  if (!existsSync(INDEX_CSS)) {
    throw new Error(
      `stylesheet not found at ${INDEX_CSS} — run this from the repo root ` +
        `(npm run test:css:thinking-label), not from a subdirectory. This is a ` +
        `harness problem, not a CSS regression.`,
    );
  }
  const css = readFileSync(INDEX_CSS, 'utf8');
  const start = css.indexOf(LABEL_START);
  const end = css.indexOf(LABEL_END);
  if (start === -1 || end === -1) {
    throw new Error(
      `thinking-label fences not found in index.css (${LABEL_START} … ${LABEL_END}). ` +
        `The label block was renamed or removed — update this check rather than deleting it.`,
    );
  }
  if (withLabel) return css;
  return css.slice(0, start) + css.slice(end + LABEL_END.length);
}

// The whole stylesheet is used verbatim rather than sliced: the token blocks
// this check is about live hundreds of lines away from the label rule, and
// source order decides ties between them.
const page = (css) => `<meta charset="utf-8"><style>
${css}
</style>
<body style="margin:0">
${INTERFACE_THEMES.map(
  (it) => `<div data-interface-theme="${it}">
  <div data-shell-card="" class="overlay-shell-surface">
    ${ROW_HTML.replaceAll('THEME', it)}
    <span id="probe-muted-${it}" style="color: var(--overlay-text-muted)"></span>
    <span id="probe-strong-${it}" style="color: var(--overlay-text-strong)"></span>
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

const isWhiteish = (c) => /^rgba?\(255,\s*255,\s*255/.test(String(c).trim());

async function measure() {
  const win = new BrowserWindow({ width: 800, height: 600, show: false });
  const written = [];

  // Reduced motion cannot be set by a stylesheet or an attribute — it is a
  // media feature. CDP emulation is the only way to reach that branch from a
  // test, and reaching it is the point (see the header).
  win.webContents.debugger.attach('1.3');
  const setReducedMotion = (on) =>
    win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }],
    });

  const sample = async (colorTheme) => {
    await win.webContents.executeJavaScript(
      `document.documentElement.dataset.theme = ${JSON.stringify(colorTheme)}`,
    );
    return win.webContents.executeJavaScript(`
      new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
        const out = {};
        for (const it of ${JSON.stringify(INTERFACE_THEMES)}) {
          const el = document.getElementById('label-' + it);
          const cs = getComputedStyle(el);
          out[it] = {
            // Canonicalised through real elements so "#ffffff" and
            // "rgb(255, 255, 255)" compare equal — the tokens are authored in
            // both notations.
            muted: getComputedStyle(document.getElementById('probe-muted-' + it)).color,
            strong: getComputedStyle(document.getElementById('probe-strong-' + it)).color,
            stops: (cs.backgroundImage.match(/rgba?\\([^)]*\\)/g) || []),
            clip: cs.backgroundClip || cs.webkitBackgroundClip,
            fill: cs.webkitTextFillColor,
            anim: cs.animationName,
            dur: cs.animationDuration,
            iter: cs.animationIterationCount,
          };
        }
        r(out);
      })));
    `);
  };

  const load = async (withLabel) => {
    const fixture = join(tmpdir(), `natively-thinking-label-${withLabel}.html`);
    writeFileSync(fixture, page(loadCss(withLabel)));
    written.push(fixture);
    await win.loadFile(fixture);
    const out = {};
    for (const colorTheme of COLOR_THEMES) {
      await setReducedMotion(false);
      out[`${colorTheme}/motion`] = await sample(colorTheme);
      await setReducedMotion(true);
      out[`${colorTheme}/reduced`] = await sample(colorTheme);
    }
    await setReducedMotion(false);
    return out;
  };

  try {
    return { fixed: await load(true), baseline: await load(false) };
  } finally {
    try {
      win.webContents.debugger.detach();
    } catch {
      /* already gone */
    }
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
        const m = fixed[`${colorTheme}/motion`][it];
        const where = `[data-theme=${colorTheme}][data-interface-theme=${it}]`;

        // Without background-clip:text the label is `color: transparent` over a
        // gradient painted across its whole box — i.e. an invisible word.
        check(
          m.clip === 'text',
          `${where}: background-clip resolved "${m.clip}", expected "text" — the label ` +
            `paints itself transparent and relies on clipping the gradient to the glyphs, ` +
            `so losing this makes the word invisible rather than merely unstyled`,
        );

        check(
          m.stops.length === 5,
          `${where}: gradient has ${m.stops.length} colour stops, expected 5 ` +
            `(base, base, sweep, base, base) — got ${JSON.stringify(m.stops)}`,
        );

        if (m.stops.length === 5) {
          // THE invariant: the colours come from the overlay text tokens, which
          // are the only thing that knows about BOTH theme axes.
          check(
            m.stops[0] === m.muted && m.stops[1] === m.muted && m.stops[4] === m.muted,
            `${where}: gradient base is "${m.stops[0]}" but --overlay-text-muted is ` +
              `"${m.muted}" — the label has stopped reading the overlay text tokens. ` +
              `A hand-picked light/dark pair cannot be correct here: this interface theme ` +
              `may paint a dark panel under [data-theme='light']`,
          );
          check(
            m.stops[2] === m.strong,
            `${where}: gradient sweep is "${m.stops[2]}" but --overlay-text-strong is ` +
              `"${m.strong}" — the highlight has stopped reading the overlay text tokens`,
          );
          // A gradient whose stops are all the same colour animates invisibly:
          // every assertion above would still pass.
          check(
            m.stops[0] !== m.stops[2],
            `${where}: base and sweep are both "${m.stops[0]}" — the highlight is ` +
              `indistinguishable from the base, so the sweep animates but nothing moves`,
          );
          const alpha = parseAlpha(m.stops[0]);
          check(
            alpha !== null,
            `${where}: base colour "${m.stops[0]}" could not be parsed — ` +
              `getComputedStyle's colour format changed, update parseAlpha`,
          );
          check(
            alpha === null || alpha >= MIN_BASE_ALPHA,
            `${where}: base colour "${m.stops[0]}" has alpha ${alpha}, below the ` +
              `${MIN_BASE_ALPHA} floor — the word resolves but is too faint to read`,
          );
        }

        check(
          m.anim === EXPECTED_ANIMATION,
          `${where}: animation-name resolved "${m.anim}", expected "${EXPECTED_ANIMATION}" ` +
            `— the label is static, so nothing signals that an answer is on its way`,
        );
        check(
          m.dur === EXPECTED_DURATION,
          `${where}: animation-duration resolved "${m.dur}", expected "${EXPECTED_DURATION}"`,
        );
        check(
          m.iter === 'infinite',
          `${where}: animation-iteration-count resolved "${m.iter}", expected "infinite" — ` +
            `a one-shot sweep stops moving while the user is still waiting`,
        );

        // Reduced motion: still visible, just still. The dot this replaced kept
        // a gentle opacity cycle here because one motionless dot reads as a
        // stray artifact; a word does not need that, so the branch goes flat —
        // but it MUST re-assert an opaque fill, or the transparent text that
        // background-clip relies on is all that is left.
        const r = fixed[`${colorTheme}/reduced`][it];
        check(
          r.anim === 'none',
          `${where}: under prefers-reduced-motion the animation-name is "${r.anim}", ` +
            `expected "none"`,
        );
        check(
          parseAlpha(r.fill) !== 0,
          `${where}: under prefers-reduced-motion -webkit-text-fill-color is "${r.fill}" — ` +
            `fully transparent, so the indicator is INVISIBLE for reduced-motion users. ` +
            `That branch must repaint the text with a real colour, not just drop the ` +
            `animation and the gradient`,
        );
        check(
          r.fill === r.muted,
          `${where}: under prefers-reduced-motion the text is "${r.fill}", expected the ` +
            `muted token "${r.muted}" — the static branch has drifted from the animated one`,
        );

        // Without the label block nothing else may clip to text. If something
        // does, every assertion above could be measuring that instead.
        const b = baseline[`${colorTheme}/motion`][it];
        check(
          b.clip !== 'text',
          `${where}: baseline (label block cut) still resolved background-clip "text" — ` +
            `the styling comes from somewhere other than the block under test, so the ` +
            `passing case is vacuous`,
        );
        check(
          b.anim === 'none',
          `${where}: baseline (label block cut) still resolved animation-name "${b.anim}" — ` +
            `something outside the fenced block is animating this element`,
        );
      }
    }

    // The specific trap, asserted on its own so the failure message names it.
    // [data-theme='light'] + liquid-glass/modern paint a DARK panel, so their
    // text must stay WHITE. This is the case a colour-theme-only check misses,
    // and it is the one that actually regressed.
    for (const it of ['liquid-glass', 'modern']) {
      const stops = fixed['light/motion'][it].stops;
      check(
        stops.length === 5 && isWhiteish(stops[0]),
        `[data-theme=light][data-interface-theme=${it}]: base colour "${stops[0]}" is not ` +
          `white — this theme paints a DARK panel in light mode, so dark text on it is ` +
          `unreadable. Read --overlay-text-muted rather than branching on [data-theme]`,
      );
    }
    // …and the converse, so the check cannot pass by painting everything white.
    const lightDefault = fixed['light/motion'].default.stops;
    check(
      lightDefault.length === 5 && !isWhiteish(lightDefault[0]),
      `[data-theme=light][data-interface-theme=default]: base colour "${lightDefault[0]}" is ` +
        `white, but this theme paints a LIGHT panel in light mode — the light override for ` +
        `--overlay-text-muted is not being reached`,
    );

    if (failures.length) {
      console.error('✗ thinking-label check FAILED');
      for (const f of failures) console.error('  · ' + f);
      console.error(`  measured: ${JSON.stringify(fixed, null, 2)}`);
      app.exit(1);
      return;
    }
    console.log(
      `✓ thinking-label check passed (base/sweep track --overlay-text-muted / ` +
        `--overlay-text-strong in ${INTERFACE_THEMES.length} interface themes x ` +
        `${COLOR_THEMES.length} colour themes, visible + static under reduced motion, ` +
        `baseline clean, Electron ${process.versions.electron} / Chrome ${process.versions.chrome})`,
    );
    app.exit(0);
  } catch (err) {
    console.error('✗ thinking-label check ERRORED');
    console.error(err);
    app.exit(1);
  }
});
