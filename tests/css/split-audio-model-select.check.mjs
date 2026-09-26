// Regression check: with Split channels ON, the System Audio model dropdown
// must actually be reachable.
//
// The defect this guards (reported 2026-09-07, introduced 5a4e722b0 on
// 2026-08-06): in local audio mode with Split channels enabled you could pick a
// microphone model but not a system-audio model. The System select's trigger
// responded — the chevron rotated, the outside-click listener armed — and the
// listbox painted nothing at all.
//
// Cause: the System column is the half that animates its width open and closed,
// so it carries `overflow: hidden` to stop its own trigger (10px padding either
// side plus a `flex-shrink: 0` chevron, ~39px that does NOT shrink with the
// column) spilling over the Mic column mid-transition. But PremiumSelect's
// listbox is `position: absolute` inside `.aip-select { position: relative }` —
// its containing block is INSIDE that clipper, so overflow clipping applies to
// it and the popup was clipped out of existence. The Mic column has no clipper,
// which is exactly why mic worked and system did not.
//
// The fix keeps the clip only while the width is in motion (`columnAnimating`
// in LocalWhisperModelPanel) and lets it go at rest.
//
// Run: npm run test:css:split-audio-select
//
// Why this runs in Electron rather than by reading the source: "the style says
// visible" cannot tell you whether a popup is hit-testable — clipping does not
// change getBoundingClientRect, only paint and hit testing, so geometry
// assertions would have passed on the broken build too. This resolves the real
// cascade in the real engine and probes the listbox with elementFromPoint,
// which is the thing the user's mouse actually does.
//
// It asserts FOUR directions so it cannot silently rot:
//   1. the overflow expression shipped by the panel, evaluated at rest        → 'visible'
//   2. the same expression while the column animates                          → 'hidden'
//      (the clip is still load-bearing; removing it is not the fix)
//   3. rendered with the at-rest value  → BOTH options are hit-testable
//   4. rendered with a hard 'hidden'    → the system option is NOT hit-testable
//      while mic still is (proves the clip is the defect, so case 3 is not vacuous)
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const PANEL_TSX = resolve(process.cwd(), 'src/components/LocalWhisperModelPanel.tsx');
const AIP_TSX = resolve(process.cwd(), 'src/components/settings/AIProvidersSettings.tsx');

function readSource(path, what) {
  // Distinguish "run from the wrong directory" from a real regression — an
  // ENOENT here would otherwise surface as a failing check and cry wolf.
  if (!existsSync(path)) {
    throw new Error(
      `${what} not found at ${path} — run this from the repo root ` +
        `(npm run test:css:split-audio-select), not from a subdirectory. This is a ` +
        `harness problem, not a UI regression.`,
    );
  }
  return readFileSync(path, 'utf8');
}

// The panel's design-system sheet, taken verbatim from the shipped template
// literal rather than excerpted: `.aip-select { position: relative }` is half of
// why the popup is clippable at all, and an excerpt could drift away from it.
function loadAipCss() {
  const src = readSource(AIP_TSX, 'AIProvidersSettings.tsx');
  const marker = 'export const AIP_CSS = `';
  const start = src.indexOf(marker);
  if (start === -1) {
    throw new Error(
      `"export const AIP_CSS = \`" not found in AIProvidersSettings.tsx — the sheet ` +
        `was renamed or moved. Update this check rather than deleting it.`,
    );
  }
  const bodyStart = start + marker.length;
  // The sheet documents in three places that it contains no backticks, precisely
  // so it can be sliced like this.
  const end = src.indexOf('`', bodyStart);
  if (end === -1) throw new Error('AIP_CSS template literal is unterminated.');
  const css = src.slice(bodyStart, end);
  if (!css.includes('.aip-select {')) {
    throw new Error(
      `extracted AIP_CSS has no ".aip-select {" rule — the slice is wrong, so a ` +
        `passing result would be meaningless.`,
    );
  }
  return css;
}

/**
 * Pull the System column's `overflow` expression straight out of the panel and
 * evaluate it for the states that matter. Reading the shipped expression (rather
 * than restating an expected value here) is what makes this a test of the
 * component and not just of CSS: re-pinning `overflow: 'hidden'` fails case 1
 * immediately.
 */
function readOverflowStates() {
  const src = readSource(PANEL_TSX, 'LocalWhisperModelPanel.tsx');
  const at = src.indexOf('key="system"');
  if (at === -1) {
    throw new Error(
      `the System Audio column (key="system") was not found in LocalWhisperModelPanel.tsx ` +
        `— it was renamed or restructured. Update this check rather than deleting it.`,
    );
  }
  const styleStart = src.indexOf('style={{', at);
  const styleEnd = src.indexOf('}}', styleStart);
  if (styleStart === -1 || styleEnd === -1) {
    throw new Error('could not locate the System column style object.');
  }
  // Strip line comments first: that block is heavily annotated and the prose
  // mentions `overflow` more than once.
  const body = src
    .slice(styleStart + 'style={{'.length, styleEnd)
    .replace(/\/\/[^\n]*/g, '');
  const m = body.match(/\boverflow:\s*([^,\n]+),/);
  if (!m) {
    throw new Error(
      `no "overflow:" entry in the System column style object. If the clip moved ` +
        `elsewhere, update this check — do not delete it: an unconditional clip here ` +
        `is exactly the shipped bug.`,
    );
  }
  const expr = m[1].trim();
  let evaluate;
  try {
    // eslint-disable-next-line no-new-func
    evaluate = new Function('columnAnimating', 'reduceMotion', `return (${expr});`);
  } catch (err) {
    throw new Error(
      `the overflow expression "${expr}" no longer depends only on ` +
        `(columnAnimating, reduceMotion): ${err.message}. Update this check.`,
    );
  }
  return {
    expr,
    atRest: evaluate(false, false),
    whileAnimating: evaluate(true, false),
    reducedMotion: evaluate(true, true),
  };
}

// A faithful slice of the split row: the .aip-card > flex row > [mic column,
// system column] structure from LocalWhisperModelPanel, with PremiumSelect
// rendered in its open state on both sides. The Tailwind atoms the panel uses
// on these elements are spelled out longhand because Tailwind's own sheet is a
// build artefact that cannot resolve from a temp directory.
const page = (css, systemOverflow) => `<meta charset="utf-8"><style>
${css}
/* Tailwind atoms used by the split row and by PremiumSelect, longhand. */
.row        { display:flex; position:relative; z-index:10; align-items:stretch; }
.col-mic    { flex:1 1 0%; min-width:0; }
.col-system { min-width:0; flex-basis:0; flex-shrink:1; flex-grow:1; margin-left:16px; }
.lbl-box    { position:relative; margin-bottom:6px; height:16px; }
.lbl        { position:absolute; inset:0; font-size:11px; line-height:16px; font-weight:500;
              text-transform:uppercase; letter-spacing:0.025em;
              overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.truncate   { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.listbox    { position:absolute; top:100%; left:0; width:100%; z-index:50; }
</style>
<body class="aip-root" data-theme="dark" style="margin:0;padding:24px;width:520px">
<div class="aip-card aip-provider">
  <div class="row">
    <div class="col-mic">${select('mic', 'Mic Audio Model')}</div>
    <div class="col-system" style="overflow:${systemOverflow}">${select('system', 'System Audio Model')}</div>
  </div>
</div>
</body>`;

// PremiumSelect's markup, open. The chevron is the load-bearing part of the
// trigger's minimum width, so it keeps its flex-shrink:0 sizing.
const select = (id, label) => `
  <div class="aip-select">
    <div class="lbl-box"><div class="lbl">${label}</div></div>
    <button type="button" class="aip-select-trigger" aria-haspopup="listbox" aria-expanded="true">
      <span class="truncate">Whisper Small</span>
      <svg class="aip-select-chevron" width="13" height="13" aria-hidden="true"></svg>
    </button>
    <div role="listbox" class="aip-float aip-select-list aip-panel-fade aip-scroll-y listbox">
      <button role="option" id="opt-${id}" class="aip-select-option"><span class="truncate">Whisper Small</span></button>
      <button role="option" class="aip-select-option"><span class="truncate">Whisper Medium</span></button>
    </div>
  </div>`;

// getBoundingClientRect is NOT the measurement — clipping leaves layout geometry
// untouched, so it reports the same box on the broken build. elementFromPoint is
// what distinguishes "laid out" from "reachable by a mouse".
const PROBE = `
  new Promise(resolve => requestAnimationFrame(() => setTimeout(() => {
    const out = {};
    for (const id of ['mic', 'system']) {
      const el = document.getElementById('opt-' + id);
      const r = el.getBoundingClientRect();
      const x = Math.round(r.x + r.width / 2);
      const y = Math.round(r.y + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      out[id] = {
        laidOut: r.width > 0 && r.height > 0,
        inViewport: y > 0 && y < window.innerHeight && x > 0 && x < window.innerWidth,
        reachable: !!hit && (hit === el || el.contains(hit)),
        hitTag: hit ? (hit.id || hit.className || hit.tagName) : null,
      };
    }
    resolve(out);
  }, 400)));`;

async function probeBoth() {
  const css = loadAipCss();
  const overflow = readOverflowStates();
  const win = new BrowserWindow({ width: 700, height: 640, show: false });
  const written = [];
  const load = async (systemOverflow) => {
    const fixture = join(tmpdir(), `natively-split-audio-select-${systemOverflow}.html`);
    writeFileSync(fixture, page(css, systemOverflow));
    written.push(fixture);
    await win.loadFile(fixture);
    return win.webContents.executeJavaScript(PROBE);
  };
  try {
    return {
      overflow,
      fixed: await load(overflow.atRest),
      clipped: await load('hidden'),
    };
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
    const { overflow, fixed, clipped } = await probeBoth();

    // 1 & 2 — the shipped expression itself.
    check(
      overflow.atRest === 'visible',
      `the System column's overflow resolves to "${overflow.atRest}" AT REST ` +
        `(expression: ${overflow.expr}). A permanent clip removes the System Audio ` +
        `dropdown entirely — that is the shipped bug this check exists for.`,
    );
    check(
      overflow.whileAnimating === 'hidden',
      `the System column's overflow resolves to "${overflow.whileAnimating}" WHILE ANIMATING ` +
        `(expression: ${overflow.expr}), expected "hidden". Deleting the clip is not the ` +
        `fix: the trigger's ~39px minimum (padding + non-shrinking chevron) then spills ` +
        `over the Mic column for the length of the open/close spring.`,
    );
    check(
      overflow.reducedMotion === 'visible',
      `under reduced motion the System column resolves to "${overflow.reducedMotion}", ` +
        `expected "visible" — there is no width animation on that path, so there is ` +
        `nothing to clip and clipping only hides the dropdown.`,
    );

    // Harness sanity: both fixtures must actually lay the options out on screen,
    // or "unreachable" would mean nothing.
    for (const [name, res] of [['fixed', fixed], ['clipped', clipped]]) {
      for (const id of ['mic', 'system']) {
        check(
          res[id].laidOut && res[id].inViewport,
          `harness problem: the ${id} option in the ${name} fixture is not laid out in ` +
            `the viewport (${JSON.stringify(res[id])}) — nothing below this is meaningful.`,
        );
      }
    }

    // 3 — with the shipped at-rest value, both dropdowns are usable.
    check(
      fixed.mic.reachable,
      `the MIC model option is not hit-testable at rest (elementFromPoint returned ` +
        `"${fixed.mic.hitTag}") — the Mic column has no clipper, so this is a harness fault.`,
    );
    check(
      fixed.system.reachable,
      `the SYSTEM AUDIO model option is not hit-testable at rest (elementFromPoint ` +
        `returned "${fixed.system.hitTag}"). This is the reported bug: the split-audio ` +
        `system dropdown opens and nothing can be clicked.`,
    );

    // 4 — and with the clip restored it must break again, or case 3 proves nothing.
    check(
      !clipped.system.reachable,
      `baseline (overflow:hidden restored) still reports the SYSTEM option as ` +
        `hit-testable — the clip no longer reaches the popup, so the passing case above ` +
        `is vacuous. Either the popup stopped being positioned inside .aip-select or the ` +
        `fixture drifted from the panel.`,
    );
    check(
      clipped.mic.reachable,
      `baseline reports the MIC option as unreachable too — the fixture is clipping both ` +
        `columns, so it does not reproduce the reported asymmetry (mic works, system does not).`,
    );

    if (failures.length) {
      console.error('✗ split-audio-model-select check FAILED');
      for (const f of failures) console.error('  · ' + f);
      console.error(`  measured: overflow=${JSON.stringify(overflow)}`);
      console.error(`            fixed=${JSON.stringify(fixed)}`);
      console.error(`            clipped=${JSON.stringify(clipped)}`);
      app.exit(1);
      return;
    }
    console.log(
      `✓ split-audio-model-select check passed (System column clips only while animating; ` +
        `both model dropdowns hit-testable at rest; clipped baseline kills the system one ` +
        `and spares mic, Electron ${process.versions.electron} / Chrome ${process.versions.chrome})`,
    );
    app.exit(0);
  } catch (err) {
    console.error('✗ split-audio-model-select check ERRORED:', err.message);
    app.exit(1);
  }
});
