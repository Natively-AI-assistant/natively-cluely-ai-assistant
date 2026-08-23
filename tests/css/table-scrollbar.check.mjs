// Regression check: an overflowing GFM table must not reserve a horizontal
// scrollbar gutter.
//
// Background: the app-wide `::-webkit-scrollbar { width: 0 }` in src/index.css
// sets WIDTH only. A horizontal scrollbar is sized by HEIGHT, so a wide table
// used to reserve Chromium's full default bar (~16px) inside the answer bubble,
// inconsistent with every other chromeless scroll surface.
//
// Why this runs in Electron rather than Playwright: Playwright's bundled
// chromium uses overlay scrollbars on macOS and reserves 0px with OR without
// the fix, which makes the assertion vacuous — verified, including with
// --disable-features=OverlayScrollbar. Electron's build reproduces the real
// condition, and Electron is the actual runtime, so the check belongs here.
//
// Run: npm run test:css
//
// The check asserts BOTH directions so it cannot silently rot:
//   1. with the shipped rules      → gutter === 0
//   2. with the scrollbar rules cut → gutter > 0   (proves 1 is load-bearing)
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const INDEX_CSS = resolve(process.cwd(), 'src/index.css');

const MARKERS = {
  layoutStart: '.markdown-content table {',
  layoutEnd: '/* ── Manager panel shell',
  scrollStart: '.code-scroll,\n.markdown-content table {',
  scrollEnd: '.code-scroll::-webkit-scrollbar {',
};

function sliceCss(withScrollbarRules) {
  // Distinguish "run from the wrong directory" from a real regression — an
  // ENOENT here would otherwise surface as a failing check and cry wolf.
  if (!existsSync(INDEX_CSS)) {
    throw new Error(
      `stylesheet not found at ${INDEX_CSS} — run this from the repo root ` +
      `(npm run test:css), not from a subdirectory. This is a harness problem, ` +
      `not a CSS regression.`,
    );
  }
  const css = readFileSync(INDEX_CSS, 'utf8');
  for (const [name, marker] of Object.entries(MARKERS)) {
    if (css.indexOf(marker) === -1) {
      throw new Error(
        `index.css marker "${name}" not found (${JSON.stringify(marker)}). ` +
        `The rules were renamed or removed — update this check rather than deleting it.`,
      );
    }
  }
  const layout = css.slice(css.indexOf(MARKERS.layoutStart), css.indexOf(MARKERS.layoutEnd));
  if (!withScrollbarRules) return layout;
  return layout + css.slice(css.indexOf(MARKERS.scrollStart), css.indexOf(MARKERS.scrollEnd));
}

const page = (rules) => `<meta charset="utf-8"><style>
  ::-webkit-scrollbar { width: 0px; background: transparent; }
  :root { --border-muted: #333333; }
  ${rules}
  body { margin: 0; font: 13.5px sans-serif; }
  .markdown-content { width: 380px; }
  th, td { white-space: nowrap; }
</style>
<div class="markdown-content"><table id="t"></table></div>
<script>
  const head = ['Step','Source','Confidence','Latency','Tokens','Outcome','Provider'];
  document.getElementById('t').innerHTML =
    '<thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead>' +
    '<tbody><tr>' + head.map((_, c) => '<td>value-' + c + '</td>').join('') + '</tr></tbody>';
</script>`;

// One window, loaded twice. Creating a second BrowserWindow after destroying
// the first intermittently fails to load in this Electron build, so the window
// is reused rather than recreated per measurement.
async function measureBoth() {
  const win = new BrowserWindow({ width: 520, height: 240, show: false });
  const written = [];
  const load = async (withScrollbarRules) => {
    const fixture = join(tmpdir(), `natively-table-scrollbar-${withScrollbarRules}.html`);
    writeFileSync(fixture, page(sliceCss(withScrollbarRules)));
    written.push(fixture);
    await win.loadFile(fixture);
    return win.webContents.executeJavaScript(`
      new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
        const t = document.getElementById('t');
        r({ gutter: t.offsetHeight - t.clientHeight,
            overflowing: t.scrollWidth > t.clientWidth });
      })));
    `);
  };
  try {
    return { fixed: await load(true), baseline: await load(false) };
  } finally {
    win.destroy();
    for (const f of written) rmSync(f, { force: true });
  }
}

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    const { fixed, baseline } = await measureBoth();

    // A table that fits would make every assertion below meaningless.
    check(fixed.overflowing, 'fixture table did not overflow — the check proves nothing');
    check(baseline.overflowing, 'baseline fixture table did not overflow');

    check(
      fixed.gutter === 0,
      `overflowing table reserved a ${fixed.gutter}px scrollbar gutter, expected 0`,
    );
    check(
      baseline.gutter > 0,
      `baseline (scrollbar rules removed) reserved ${baseline.gutter}px, expected > 0 — ` +
      `this engine no longer reproduces the bug, so the passing case is vacuous`,
    );

    if (failures.length) {
      console.error('✗ table-scrollbar check FAILED');
      for (const f of failures) console.error('  · ' + f);
      console.error(`  measured: fixed=${fixed.gutter}px baseline=${baseline.gutter}px`);
      app.exit(1);
      return;
    }
    console.log(
      `✓ table-scrollbar check passed (fixed=${fixed.gutter}px, baseline=${baseline.gutter}px, ` +
      `Electron ${process.versions.electron} / Chrome ${process.versions.chrome})`,
    );
    app.exit(0);
  } catch (err) {
    console.error('✗ table-scrollbar check ERRORED:', err.message);
    app.exit(1);
  }
});
