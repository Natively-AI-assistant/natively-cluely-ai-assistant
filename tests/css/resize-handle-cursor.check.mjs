// Regression check: the overlay resize handles must show a resize cursor.
//
// Background: the overlay's drag strips are invisible 16px regions at the
// panel's east and south edges (see NativelyInterface's `data-resize-handle`
// elements). The cursor IS the entire affordance — nothing else marks them —
// so a handle that renders `cursor: default` is a handle no user can find.
//
// The defect this guards: src/index.css carries a global cursor lock,
// `*, *:hover, … { cursor: default !important }`, added five months before
// PR #499 shipped the handles. PR #499's `.resize-handle-e { cursor: ew-resize }`
// is a single class (0,1,0) with no `!important`, so it lost the cascade to the
// lock on both counts and never once took effect in a shipped build. Adding
// `!important` alone does NOT fix it either: that ties `.resize-handle-e`
// (0,1,0) against `*:hover` (0,1,0) and the lock still wins on source order.
// Only a selector ABOVE (0,1,0) clears it — hence the doubled class in the
// override block this check pins.
//
// Why this runs in Electron rather than by reading the stylesheet: a text
// assertion ("the rule contains !important") cannot tell you who wins the
// cascade — that was exactly the reasoning error that shipped the bug. This
// resolves the real cascade in the real engine and reads getComputedStyle,
// including in the :hover state that `*:hover` targets.
//
// Run: npm run test:css:resize-handle
//
// The check asserts THREE directions so it cannot silently rot:
//   1. with the shipped stylesheet    → each handle gets its resize cursor
//   2. in undetectable mode           → every handle keeps the arrow (the
//      pointer is captured even when the window is not — a resize cursor over
//      "empty desktop" would betray the overlay)
//   3. with the override block cut    → every handle falls back to `default`
//      (proves the override is load-bearing, not decoration)
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const INDEX_CSS = resolve(process.cwd(), 'src/index.css');

// Fences around the override block, so the baseline can remove exactly it and
// nothing else. Renaming them without updating this check fails loudly below.
const OVERRIDE_START = '/* @cursor-lock-exception:start */';
const OVERRIDE_END = '/* @cursor-lock-exception:end */';

// The real class lists, copied from the three handle elements in
// src/components/NativelyInterface.tsx. `no-drag` matters: it is itself one of
// the lock's selectors, so a fixture that omitted it would under-test.
const HANDLES = [
  { id: 'e', className: 'resize-handle resize-handle-e no-drag touch-none', expected: 'ew-resize' },
  { id: 's', className: 'resize-handle resize-handle-s no-drag touch-none', expected: 'ns-resize' },
  { id: 'se', className: 'resize-handle resize-handle-se no-drag touch-none', expected: 'nwse-resize' },
];

function loadCss(withOverride) {
  // Distinguish "run from the wrong directory" from a real regression — an
  // ENOENT here would otherwise surface as a failing check and cry wolf.
  if (!existsSync(INDEX_CSS)) {
    throw new Error(
      `stylesheet not found at ${INDEX_CSS} — run this from the repo root ` +
        `(npm run test:css:resize-handle), not from a subdirectory. This is a ` +
        `harness problem, not a CSS regression.`,
    );
  }
  const css = readFileSync(INDEX_CSS, 'utf8');
  const start = css.indexOf(OVERRIDE_START);
  const end = css.indexOf(OVERRIDE_END);
  if (start === -1 || end === -1) {
    throw new Error(
      `cursor-lock exception fences not found in index.css ` +
        `(${OVERRIDE_START} … ${OVERRIDE_END}). The override block was renamed or ` +
        `removed — update this check rather than deleting it.`,
    );
  }
  if (withOverride) return css;
  return css.slice(0, start) + css.slice(end + OVERRIDE_END.length);
}

// The whole stylesheet is used verbatim rather than sliced: source order is
// half of what decides this cascade, so any excerpt could resolve differently
// from the file that actually ships. @font-face/@tailwind at-rules that cannot
// resolve from a temp directory are inert for a cursor measurement.
const page = (css) => `<meta charset="utf-8"><style>
${css}
</style>
<body style="margin:0">
${HANDLES.map((h) => `<div id="h-${h.id}" class="${h.className}" style="width:40px;height:40px"></div>`).join('\n')}
</body>`;

async function measureBoth() {
  const win = new BrowserWindow({ width: 320, height: 240, show: false });
  const written = [];
  const load = async (withOverride) => {
    const fixture = join(tmpdir(), `natively-resize-cursor-${withOverride}.html`);
    writeFileSync(fixture, page(loadCss(withOverride)));
    written.push(fixture);
    await win.loadFile(fixture);
    // Measured in the :hover state as well as at rest, because `*:hover` is a
    // distinct selector in the lock and is the state a user is actually in
    // when they reach for a handle. CDP's Input domain drives a real hover;
    // executeJavaScript alone cannot set :hover.
    const ids = HANDLES.map((h) => h.id);
    const rest = await win.webContents.executeJavaScript(`
      new Promise(r => requestAnimationFrame(() => {
        const out = {};
        for (const id of ${JSON.stringify(ids)}) {
          out[id] = getComputedStyle(document.getElementById('h-' + id)).cursor;
        }
        r(out);
      }));
    `);
    const hovered = {};
    for (const h of HANDLES) {
      const box = await win.webContents.executeJavaScript(
        `(() => { const r = document.getElementById('h-${h.id}').getBoundingClientRect();
                  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      await win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(box.x), y: Math.round(box.y) });
      hovered[h.id] = await win.webContents.executeJavaScript(
        `new Promise(r => requestAnimationFrame(() => r(
           getComputedStyle(document.getElementById('h-${h.id}')).cursor)));`,
      );
    }
    // Undetectable mode: flip the root attribute the renderer mirrors and
    // re-measure — every handle must fall back to the arrow. This is the
    // stealth contract: the pointer is captured even when the window is not.
    await win.webContents.executeJavaScript(
      `document.documentElement.dataset.undetectable = 'true'`,
    );
    const undetectable = await win.webContents.executeJavaScript(`
      new Promise(r => requestAnimationFrame(() => {
        const out = {};
        for (const id of ${JSON.stringify(ids)}) {
          out[id] = getComputedStyle(document.getElementById('h-' + id)).cursor;
        }
        r(out);
      }));
    `);
    await win.webContents.executeJavaScript(`delete document.documentElement.dataset.undetectable`);
    return { rest, hovered, undetectable };
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
    const { fixed, baseline } = await measureBoth();

    for (const h of HANDLES) {
      check(
        fixed.rest[h.id] === h.expected,
        `.${h.className.split(' ')[1]} resolved cursor "${fixed.rest[h.id]}" at rest, expected "${h.expected}" ` +
          `— the global cursor lock is winning and the handle is undiscoverable`,
      );
      check(
        fixed.hovered[h.id] === h.expected,
        `.${h.className.split(' ')[1]} resolved cursor "${fixed.hovered[h.id]}" while HOVERED, ` +
          `expected "${h.expected}" — \`*:hover\` in the cursor lock is winning`,
      );
      check(
        fixed.undetectable[h.id] === 'default',
        `.${h.className.split(' ')[1]} resolved "${fixed.undetectable[h.id]}" in UNDETECTABLE mode, ` +
          `expected "default" — the cursor would betray the overlay in a screen capture`,
      );
      // Without the override the lock must reclaim the handle. If it does not,
      // the lock changed shape and the passing case above proves nothing.
      check(
        baseline.rest[h.id] === 'default',
        `baseline (override block cut) resolved "${baseline.rest[h.id]}" for ` +
          `.${h.className.split(' ')[1]}, expected "default" — the cursor lock no longer ` +
          `claims this element, so the passing case is vacuous`,
      );
    }

    if (failures.length) {
      console.error('✗ resize-handle-cursor check FAILED');
      for (const f of failures) console.error('  · ' + f);
      console.error(`  measured: fixed=${JSON.stringify(fixed)} baseline=${JSON.stringify(baseline)}`);
      app.exit(1);
      return;
    }
    console.log(
      `✓ resize-handle-cursor check passed (e/s/se resolve ew-/ns-/nwse-resize at rest and hovered, ` +
        `arrow in undetectable mode, baseline falls back to default, Electron ${process.versions.electron} / Chrome ${process.versions.chrome})`,
    );
    app.exit(0);
  } catch (err) {
    console.error('✗ resize-handle-cursor check ERRORED:', err.message);
    app.exit(1);
  }
});
