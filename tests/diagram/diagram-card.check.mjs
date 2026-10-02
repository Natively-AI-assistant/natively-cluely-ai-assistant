// Real-renderer check for the diagram card (src/components/diagram/DiagramArtifact.tsx).
//
// The repo has no DOM test harness (component tests read source), and the
// questions here are about what is on screen and what gets called:
//
//   - a block still streaming shows "Generating diagram…", never an error, and
//     never asks for a repair;
//   - the diagram is drawn as soon as the block is complete, while the answer
//     is still streaming, as an <img> (no injected SVG markup), fitted to the
//     card on a wide and on a narrow layout;
//   - a broken block gets ONE automatic repair on a live answer, none on a
//     replay, none when cut off, none for a policy rejection; a failed repair
//     falls back to a readable card and does not loop; unmounting cancels it;
//   - an update keeps the previous version on screen until the new one draws;
//   - source-only stays source; a newer source wins over a slower older render;
//   - two cards with the same source do not interfere; unmount leaves nothing;
//   - a plain wheel is never captured, ctrl+wheel zooms, Fit resets;
//   - SVG / PNG / .mmd exports carry the accepted artifact;
//   - a theme change redraws without anything being asked of a model;
//   - reduced motion removes the card's transitions.
//
// Run: npm run test:diagram:card
import { app, BrowserWindow } from 'electron';
import { build } from 'esbuild';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const COMPONENT = resolve(ROOT, 'src/components/diagram/DiagramArtifact.tsx');
const WRAPPER = resolve(ROOT, 'src/components/diagram/DiagramAwareMarkdown.tsx');
const INDEX_CSS = resolve(ROOT, 'src/index.css');
if (!existsSync(COMPONENT) || !existsSync(INDEX_CSS)) {
  console.error('run from the repo root (npm run test:diagram:card).');
  process.exit(2);
}

const CARD_START = '/* @diagram-card:start */';
const CARD_END = '/* @diagram-card:end */';
function cardCss() {
  const css = readFileSync(INDEX_CSS, 'utf8');
  const a = css.indexOf(CARD_START);
  const b = css.indexOf(CARD_END);
  if (a < 0 || b < a) throw new Error('diagram card CSS fences not found in src/index.css — they were renamed or removed.');
  return css.slice(a, b + CARD_END.length);
}

const GOOD = 'flowchart LR\n    producer["Producer Service"] -->|"enqueue"| queue["Notification Queue"]\n    queue --> worker["Delivery Worker"]\n    worker -->|"send"| provider["Email / SMS Provider"]';
const GOOD_V2 = GOOD + '\n    worker -->|"failed"| retry["Retry Queue"]\n    worker -->|"exhausted"| dlq["Dead-Letter Queue"]';
const OTHER = 'sequenceDiagram\n    participant Gamma\n    participant Delta\n    Gamma->>Delta: ping';
const BROKEN = 'flowchart LR\n    producer["Producer Service" --> queue[Notification Queue';
const UNSAFE = 'flowchart LR\n    a["<script>alert(1)</script>"] --> b';
const WIDE = ['flowchart LR', ...Array.from({ length: 14 }, (_, i) => `    n${i}["Service number ${i}"] --> n${i + 1}["Service number ${i + 1}"]`)].join('\n');

const failures = [];
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`);
    failures.push(name);
  }
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'natively-diagram-card-'));
  let win;
  try {
    const entry = join(dir, 'entry.tsx');
    writeFileSync(
      entry,
      `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DiagramArtifact } from ${JSON.stringify(COMPONENT)};
import { DiagramAwareMarkdown } from ${JSON.stringify(WRAPPER)};

const calls = { repair: [], cancel: [], accept: [], export: [], repaired: [] };
let repairPlan = [];
let repairDelayMs = 0;
window.electronAPI = {
  getDiagramsEnabled: async () => true,
  onDiagramsEnabledChanged: () => () => {},
  repairDiagram: (payload) => new Promise((res) => {
    calls.repair.push(payload);
    const outcome = repairPlan.length ? repairPlan.shift() : { ok: false, reason: 'provider_error' };
    setTimeout(() => res(outcome), repairDelayMs);
  }),
  cancelDiagramRepair: async (id) => { calls.cancel.push(id); return true; },
  acceptDiagramRepair: async (payload) => { calls.accept.push(payload); return true; },
  exportDiagram: async (payload) => { calls.export.push({ format: payload.format, name: payload.name, head: String(payload.data).slice(0, 40), length: String(payload.data).length }); return { saved: true, fileName: 'x.' + payload.format }; },
};

const roots = new Map();
function mount(slot) {
  let host = document.getElementById(slot);
  if (!host) {
    host = document.createElement('div');
    host.id = slot;
    host.className = 'slot';
    document.getElementById('app').appendChild(host);
  }
  if (!roots.has(slot)) roots.set(slot, createRoot(host));
  return { host, root: roots.get(slot) };
}
window.__card = {
  calls,
  planRepairs(plan, delayMs = 0) { repairPlan = plan.slice(); repairDelayMs = delayMs; },
  render(slot, props) {
    const { root } = mount(slot);
    root.render(<DiagramArtifact onRepaired={(a, b) => calls.repaired.push([a, b])} {...props} />);
  },
  renderMarkdown(slot, props) {
    const { root } = mount(slot);
    root.render(<DiagramAwareMarkdown {...props} renderMarkdown={(chunk, key) => <p key={key} className="md-chunk">{chunk}</p>} />);
  },
  unmount(slot) {
    const r = roots.get(slot);
    if (r) { r.unmount(); roots.delete(slot); }
    const host = document.getElementById(slot);
    if (host) host.remove();
  },
  width(slot, px) { mount(slot).host.style.width = px + 'px'; },
};
`,
    );
    const bundle = join(dir, 'bundle.js');
    await build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      outfile: bundle,
      logLevel: 'error',
      jsx: 'automatic',
      nodePaths: [resolve(ROOT, 'node_modules')],
      define: { 'process.env.NODE_ENV': '"production"' },
      loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty' },
    });
    const page = join(dir, 'index.html');
    writeFileSync(
      page,
      '<!doctype html><html data-theme="dark"><head><meta charset="utf-8">' +
        `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' file:; img-src 'self' data:; style-src 'self' 'unsafe-inline'">` +
        '<style>' +
        ':root{--overlay-code-bg:rgba(255,255,255,.03);--overlay-code-border:rgba(255,255,255,.08);--overlay-code-header-bg:rgba(255,255,255,.05);--overlay-text-muted:rgba(255,255,255,.7)}' +
        'body{margin:0;background:#101216;color:#f1f5f9;font:14px system-ui}#app{padding:16px}.slot{width:640px;margin-bottom:12px}' +
        '.overlay-code-block-surface{background:var(--overlay-code-bg);border-color:var(--overlay-code-border)}' +
        '.overlay-code-header-surface{background:var(--overlay-code-header-bg);border-bottom-color:var(--overlay-code-border)}' +
        '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}button{background:none;border:0;cursor:pointer}' +
        cardCss() +
        `</style></head><body><div id="app"></div><script src="${pathToFileURL(bundle).href}"></script></body></html>`,
    );

    win = new BrowserWindow({ width: 1000, height: 900, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await win.loadFile(page);
    const run = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
    const render = (slot, props) => run((s, p) => window.__card.render(s, p), slot, props);
    /** Poll the card until `predicate(state)` holds; returns the last state. */
    const settle = (slot, want, timeoutMs = 6000) =>
      run(
        async (s, wanted, limit) => {
          const read = () => {
            const host = document.getElementById(s);
            const fig = host && host.querySelector('figure.diagram-card');
            const img = fig && fig.querySelector('img.diagram-card__img');
            const viewport = fig && fig.querySelector('.diagram-card__viewport');
            return {
              mounted: Boolean(fig),
              state: fig ? fig.getAttribute('data-diagram-state') : null,
              artifactId: fig ? fig.getAttribute('data-diagram-artifact') : null,
              label: fig ? fig.querySelector('.diagram-card__label')?.textContent : null,
              text: fig ? fig.textContent : '',
              hasImg: Boolean(img),
              imgLoaded: Boolean(img && img.complete && img.naturalWidth > 0),
              imgSrcHead: img ? img.src.slice(0, 36) : '',
              imgSvg: img ? decodeURIComponent(img.src.slice(img.src.indexOf(',') + 1)) : '',
              imgAlt: img ? img.alt : '',
              imgWidth: img ? img.getBoundingClientRect().width : 0,
              viewportWidth: viewport ? viewport.clientWidth : 0,
              viewportHeight: viewport ? viewport.clientHeight : 0,
              previous: Boolean(viewport && viewport.classList.contains('is-previous')),
              spinner: fig ? fig.querySelectorAll('.natively-thinking-label').length : 0,
              svgInDom: fig ? fig.querySelectorAll('svg svg, foreignObject, script').length : 0,
              inlineDiagramSvg: fig ? [...fig.querySelectorAll('svg')].filter((n) => n.querySelector('g.node, .actor, .statediagram')).length : 0,
              source: fig && fig.querySelector('.diagram-card__source') ? fig.querySelector('.diagram-card__source').textContent : null,
              selectedTab: fig ? [...fig.querySelectorAll('[role=tab]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent : null,
              fixButton: fig ? [...fig.querySelectorAll('button')].some((b) => /Try to fix/.test(b.textContent)) : false,
              caption: fig ? fig.querySelector('figcaption')?.textContent : null,
            };
          };
          const started = performance.now();
          let last = read();
          while (performance.now() - started < limit) {
            last = read();
            if (wanted === 'img' ? last.imgLoaded && last.state === 'ready' : last.state === wanted) return last;
            await new Promise((r) => setTimeout(r, 25));
          }
          return { ...last, timedOut: true };
        },
        slot,
        want,
        timeoutMs,
      );
    const calls = () => run(() => JSON.parse(JSON.stringify(window.__card.calls)));
    const click = (slot, label) =>
      run(
        (s, l) => {
          const fig = document.getElementById(s).querySelector('figure.diagram-card');
          const btn = [...fig.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent || '').trim() === l);
          if (!btn) return false;
          btn.click();
          return true;
        },
        slot,
        label,
      );

    // ── 1. streaming → complete ─────────────────────────────────────────────
    console.log('streaming a diagram');
    await render('a', { artifactId: 'm1:d0', source: 'flowchart LR\n    producer["Producer Ser', complete: false, streaming: true, allowAutoRepair: true });
    let s = await settle('a', 'generating');
    check('an open block shows "Generating diagram…"', s.state === 'generating' && /Generating diagram…/.test(s.text) && !s.hasImg, JSON.stringify(s));
    check('…with no error text and no repair request', !/syntax error|could not be drawn|cut off/.test(s.text) && (await calls()).repair.length === 0, s.text);
    await click('a', 'Source');
    s = await settle('a', 'generating');
    check('the Source tab shows the incoming Mermaid', s.selectedTab === 'Source' && s.source === 'flowchart LR\n    producer["Producer Ser', JSON.stringify(s.source));
    await click('a', 'Diagram');

    await render('a', { artifactId: 'm1:d0', source: GOOD, complete: true, streaming: true, allowAutoRepair: true, description: "I'd queue every send." });
    s = await settle('a', 'img');
    check('the diagram is drawn when the block completes, while the answer still streams', s.imgLoaded && s.state === 'ready', JSON.stringify({ state: s.state, timedOut: s.timedOut }));
    check('it is an <img> with an SVG data URL, not injected markup', s.imgSrcHead.startsWith('data:image/svg+xml;charset=utf-8,') && s.inlineDiagramSvg === 0 && s.svgInDom === 0, JSON.stringify({ head: s.imgSrcHead, inline: s.inlineDiagramSvg }));
    // Labels are laid out as SVG <tspan>s, one per word, so match on words.
    check('the drawing is the block that was given', s.imgSvg.includes('Producer') && s.imgSvg.includes('Delivery') && s.imgSvg.includes('enqueue'), s.imgSvg.slice(0, 120));
    // The description lives in the image's alt text only: a hidden caption would
    // repeat the answer's lead sentence in the selectable text (found by the overlay check).
    check('title and accessible description come from the answer, without repeating it as text', s.label === 'Diagram' && s.imgAlt === "Diagram. I'd queue every send." && s.caption == null, JSON.stringify({ label: s.label, alt: s.imgAlt, caption: s.caption }));
    check('no spinner is left once it is drawn', s.spinner === 0, String(s.spinner));
    check('it fits the card', s.imgWidth <= s.viewportWidth + 0.5 && s.viewportHeight <= 420, JSON.stringify({ img: s.imgWidth, viewport: s.viewportWidth, h: s.viewportHeight }));
    check('a valid diagram never asks for a repair', (await calls()).repair.length === 0);

    // Optional: DIAGRAM_CHECK_SHOTS=<dir> saves what the card looks like, for a human to look at.
    const shotDir = process.env.DIAGRAM_CHECK_SHOTS;
    const shot = async (name) => {
      if (!shotDir) return;
      await new Promise((r) => setTimeout(r, 150));
      writeFileSync(join(shotDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    await shot('card-dark');

    // ── 2. fit on wide content and narrow layouts ───────────────────────────
    console.log('fitting');
    await run(() => window.__card.width('w', 640));
    await render('w', { artifactId: 'm2:d0', source: WIDE, complete: true, streaming: false });
    s = await settle('w', 'img');
    check('a very wide diagram is scaled to the card, never wider than it', s.imgLoaded && s.imgWidth <= 640.5 && s.viewportWidth <= 640, JSON.stringify({ img: s.imgWidth, viewport: s.viewportWidth }));
    const pageOverflow = await run(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('and does not make the page scroll sideways', pageOverflow <= 0, String(pageOverflow));
    await run(() => window.__card.width('w', 300));
    // Waits for the refit instead of a fixed 250 ms: a slow machine (the
    // Windows CI runner) had resized the viewport and not yet the drawing.
    s = await run(async () => {
      const read = () => {
        const img = document.querySelector('#w img.diagram-card__img');
        const vp = document.querySelector('#w .diagram-card__viewport');
        return { img: img.getBoundingClientRect().width, viewport: vp.clientWidth };
      };
      const started = Date.now();
      let now = read();
      while (!(now.img <= now.viewport + 0.5 && now.viewport <= 300) && Date.now() - started < 4000) {
        await new Promise((r) => setTimeout(r, 50));
        now = read();
      }
      return { ...now, waitedMs: Date.now() - started };
    });
    check('on a narrow layout (300px) it refits', s.img <= s.viewport + 0.5 && s.viewport <= 300, JSON.stringify(s));
    await run(() => window.__card.unmount('w'));

    // ── 3. zoom, wheel, fit ─────────────────────────────────────────────────
    console.log('zoom and wheel');
    const wheel = await run(async () => {
      const vp = document.querySelector('#a .diagram-card__viewport');
      const img = () => document.querySelector('#a img.diagram-card__img').getBoundingClientRect().width;
      const w0 = img();
      const plain = new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true });
      vp.dispatchEvent(plain);
      await new Promise((r) => setTimeout(r, 60));
      const afterPlain = img();
      const pinch = new WheelEvent('wheel', { deltaY: -60, ctrlKey: true, bubbles: true, cancelable: true, clientX: 100, clientY: 40 });
      vp.dispatchEvent(pinch);
      await new Promise((r) => setTimeout(r, 60));
      return { w0, afterPlain, afterPinch: img(), plainPrevented: plain.defaultPrevented, pinchPrevented: pinch.defaultPrevented };
    });
    check('a plain wheel is not captured and does not zoom (the chat scrolls)', wheel.plainPrevented === false && wheel.afterPlain === wheel.w0, JSON.stringify(wheel));
    check('ctrl+wheel (pinch) zooms and is consumed', wheel.pinchPrevented === true && wheel.afterPinch > wheel.w0, JSON.stringify(wheel));
    await click('a', 'Zoom in');
    const zoomed = await run(() => new Promise((r) => setTimeout(() => r(document.querySelector('#a img.diagram-card__img').getBoundingClientRect().width), 60)));
    check('the Zoom in button zooms further', zoomed > wheel.afterPinch, `${wheel.afterPinch} → ${zoomed}`);
    await click('a', 'Fit to card');
    const fitted = await run(() => new Promise((r) => setTimeout(() => r(document.querySelector('#a img.diagram-card__img').getBoundingClientRect().width), 60)));
    check('Fit returns to the fitted size', Math.abs(fitted - wheel.w0) < 0.5, `${fitted} vs ${wheel.w0}`);

    // ── 4. export ───────────────────────────────────────────────────────────
    console.log('export');
    for (const format of ['SVG', 'PNG', 'Mermaid (.mmd)']) {
      await click('a', 'Export');
      await run(
        (l) =>
          new Promise((res) => {
            setTimeout(() => {
              const btn = [...document.querySelectorAll('#a .diagram-card__export button')].find((b) => b.textContent.trim() === l);
              if (btn) btn.click();
              setTimeout(res, 400);
            }, 30);
          }),
        format,
      );
    }
    const exported = (await calls()).export;
    check('SVG export carries the accepted drawing', exported[0]?.format === 'svg' && exported[0].head.startsWith('<svg'), JSON.stringify(exported[0]));
    check('PNG export is a real PNG (base64)', exported[1]?.format === 'png' && exported[1].head.startsWith('iVBORw0KGgo') && exported[1].length > 500, JSON.stringify(exported[1]));
    check('.mmd export carries the source', exported[2]?.format === 'mmd' && exported[2].head.startsWith('flowchart LR'), JSON.stringify(exported[2]));

    // ── 5. theme ────────────────────────────────────────────────────────────
    console.log('theme');
    const darkSvg = (await settle('a', 'img')).imgSvg;
    await run(() => {
      document.body.style.color = '#1d1d1f';
      document.body.style.background = '#ffffff';
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await render('a', { artifactId: 'm1:d0', source: GOOD, complete: true, streaming: false, allowAutoRepair: true, description: "I'd queue every send.", themeKey: 'l:default' });
    const light = await run(
      async (before) => {
        const started = performance.now();
        while (performance.now() - started < 4000) {
          const img = document.querySelector('#a img.diagram-card__img');
          const svg = img ? decodeURIComponent(img.src.slice(img.src.indexOf(',') + 1)) : '';
          if (svg && svg !== before && img.complete) return { changed: true, hasLightText: svg.toLowerCase().includes('#1d1d1f') };
          await new Promise((r) => setTimeout(r, 25));
        }
        return { changed: false };
      },
      darkSvg,
    );
    check('a theme change redraws the same source in the new colours', light.changed && light.hasLightText, JSON.stringify(light));
    check('…without asking a model for anything', (await calls()).repair.length === 0);
    await shot('card-light');
    await run(() => {
      document.body.style.color = '#f1f5f9';
      document.body.style.background = '#101216';
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    // ── 6. repair ───────────────────────────────────────────────────────────
    console.log('repair');
    await run((fixed) => window.__card.planRepairs([{ ok: true, source: fixed }]), GOOD);
    await render('r1', { artifactId: 'm3:d0', source: BROKEN, complete: true, streaming: false, allowAutoRepair: true });
    s = await settle('r1', 'img');
    let c = await calls();
    check('a broken block on a live answer gets ONE automatic repair request', c.repair.length === 1 && c.repair[0].source === BROKEN && c.repair[0].manual === false && c.repair[0].stage === 'parse', JSON.stringify(c.repair).slice(0, 300));
    check('the request carries a bounded diagnostic and nothing else', typeof c.repair[0]?.diagnostic === 'string' && c.repair[0].diagnostic.length > 0 && c.repair[0].diagnostic.length <= 600 && Object.keys(c.repair[0]).sort().join() === 'diagnostic,manual,requestId,source,stage', JSON.stringify(Object.keys(c.repair[0] || {})));
    check('the repaired diagram is drawn', s.imgLoaded && s.imgSvg.includes('Producer') && s.imgSvg.includes('Notification'), JSON.stringify({ state: s.state, timedOut: s.timedOut }));
    check('the owner is told which source replaced which', c.repaired.length === 1 && c.repaired[0][0] === BROKEN && c.repaired[0][1] === GOOD, JSON.stringify(c.repaired).slice(0, 200));
    check('and the main process is told to record it', c.accept.length === 1 && c.accept[0].originalSource === BROKEN && c.accept[0].repairedSource === GOOD);

    const BROKEN2 = BROKEN + '\n    queue --> worker[';
    await run((again) => window.__card.planRepairs([{ ok: true, source: again }]), BROKEN2 + '\n  still --> [broken');
    await render('r2', { artifactId: 'm4:d0', source: BROKEN2, complete: true, streaming: false, allowAutoRepair: true });
    s = await settle('r2', 'error');
    c = await calls();
    check('a repair that still does not draw falls back to a readable card', s.state === 'error' && /syntax error/.test(s.text) && s.spinner === 0, JSON.stringify({ state: s.state, text: s.text.slice(0, 120) }));
    check('…and does not loop: still exactly one request for that block', c.repair.filter((r) => r.source === BROKEN2).length === 1, String(c.repair.length));
    check('nothing was recorded for the failed repair', c.accept.length === 1 && c.repaired.length === 1);
    check('the fallback offers the source and a manual retry', s.fixButton && /View source/.test(s.text));
    await shot('card-states');
    await run((fixed) => window.__card.planRepairs([{ ok: true, source: fixed }]), GOOD_V2);
    await click('r2', 'Try to fix');
    s = await settle('r2', 'img');
    c = await calls();
    check('"Try to fix" is a deliberate manual attempt', c.repair[c.repair.length - 1].manual === true && s.imgLoaded, JSON.stringify(c.repair[c.repair.length - 1]).slice(0, 160));

    const before = (await calls()).repair.length;
    await render('r3', { artifactId: 'm5:d0', source: BROKEN + '\n    x --> y[', complete: true, streaming: false, allowAutoRepair: false });
    s = await settle('r3', 'error');
    check('a replayed answer (no auto repair) never spends a call', (await calls()).repair.length === before && s.state === 'error', String((await calls()).repair.length - before));

    await render('r4', { artifactId: 'm6:d0', source: 'flowchart LR\n    producer["Producer Service"] --> que', complete: false, streaming: false, allowAutoRepair: true });
    s = await settle('r4', 'cut-off');
    check('an answer that ended inside the block says it was cut off', s.state === 'cut-off' && /cut off before it finished/.test(s.text), s.text.slice(0, 120));
    check('…with no spinner, no repair, and no retry offer', s.spinner === 0 && !s.fixButton && (await calls()).repair.length === before, JSON.stringify({ spinner: s.spinner, fix: s.fixButton }));

    await render('r5', { artifactId: 'm7:d0', source: UNSAFE, complete: true, streaming: false, allowAutoRepair: true });
    s = await settle('r5', 'error');
    check('a policy rejection is explained and never sent for repair', /contains HTML, which is not allowed/.test(s.text) && !s.fixButton && (await calls()).repair.length === before, s.text.slice(0, 160));
    const alerted = await run(() => document.querySelectorAll('script:not([src])').length);
    check('and nothing from it reached the document', alerted === 0, String(alerted));

    await run(() => window.__card.planRepairs([{ ok: true, source: 'flowchart LR\n    late --> result' }], 800));
    await render('r6', { artifactId: 'm8:d0', source: BROKEN + '\n    z --> w[', complete: true, streaming: false, allowAutoRepair: true });
    await settle('r6', 'repairing');
    await run(() => window.__card.unmount('r6'));
    await run(() => new Promise((r) => setTimeout(r, 1000)));
    c = await calls();
    check('unmounting during a repair cancels it', c.cancel.length === 1 && c.cancel[0] === c.repair[c.repair.length - 1].requestId, JSON.stringify(c.cancel));
    check('and its late result is applied nowhere', c.repaired.length === 2 && c.accept.length === 2, JSON.stringify({ repaired: c.repaired.length, accept: c.accept.length }));

    // ── 7. update keeps the previous version ────────────────────────────────
    console.log('updates');
    await render('u', { artifactId: 'm9:d0', source: 'flowchart LR\n    producer["Producer Service"] --> queue["Notification Queue"]\n    queue --> wor', complete: false, streaming: true, previousSource: GOOD });
    s = await run(async () => {
      const started = performance.now();
      while (performance.now() - started < 4000) {
        const vp = document.querySelector('#u .diagram-card__viewport');
        const img = document.querySelector('#u img.diagram-card__img');
        if (vp && img && img.complete) return { previous: vp.classList.contains('is-previous'), text: document.querySelector('#u figure').textContent, state: document.querySelector('#u figure').getAttribute('data-diagram-state') };
        await new Promise((r) => setTimeout(r, 25));
      }
      return { previous: false, text: document.querySelector('#u figure').textContent };
    });
    check('while an update is written, the previous version stays on screen, marked as updating', s.previous && /Updating diagram…/.test(s.text) && s.state === 'generating', JSON.stringify(s));
    await render('u', { artifactId: 'm9:d0', source: GOOD_V2, complete: true, streaming: true, previousSource: undefined });
    s = await settle('u', 'img');
    check('it is replaced only when the new version has drawn', s.imgLoaded && !s.previous && s.imgSvg.includes('Dead-Letter') && !/Updating diagram…/.test(s.text), JSON.stringify({ previous: s.previous, state: s.state }));

    // ── 8. source-only, stale renders, duplicates, cleanup ──────────────────
    console.log('source-only, ordering, duplicates');
    await render('so', { artifactId: 'm10:d0', source: GOOD, info: 'mermaid source', complete: true, streaming: false });
    s = await run(() => new Promise((r) => setTimeout(() => {
      const fig = document.querySelector('#so figure');
      r({ tab: [...fig.querySelectorAll('[role=tab]')].find((t) => t.getAttribute('aria-selected') === 'true').textContent, img: Boolean(fig.querySelector('img')), source: fig.querySelector('.diagram-card__source')?.textContent });
    }, 500)));
    check('"mermaid source" stays source: no drawing unless the user opens the Diagram tab', s.tab === 'Source' && !s.img && s.source === GOOD, JSON.stringify(s));
    await click('so', 'Diagram');
    s = await settle('so', 'img');
    check('opening the Diagram tab draws it on request', s.imgLoaded);

    await render('o', { artifactId: 'm11:d0', source: WIDE, complete: true, streaming: false });
    await render('o', { artifactId: 'm11:d0', source: OTHER, complete: true, streaming: false });
    s = await settle('o', 'img');
    await run(() => new Promise((r) => setTimeout(r, 400)));
    s = await settle('o', 'img');
    check('a newer source wins over an older render finishing late', s.imgSvg.includes('Gamma') && !s.imgSvg.includes('Service number'), s.imgSvg.slice(0, 100));
    check('and the card is retitled for it', s.label === 'Sequence diagram', String(s.label));

    await render('d1', { artifactId: 'ma:d0', source: GOOD, complete: true, streaming: false });
    await render('d2', { artifactId: 'mb:d0', source: GOOD, complete: true, streaming: false });
    const d1 = await settle('d1', 'img');
    const d2 = await settle('d2', 'img');
    check('the same source in two answers is two independent cards', d1.imgLoaded && d2.imgLoaded && d1.artifactId === 'ma:d0' && d2.artifactId === 'mb:d0');
    const ids = await run(() => {
      const all = [...document.querySelectorAll('[id]')].map((n) => n.id).filter((id) => /mermaid|natively-diagram/i.test(id));
      return { all, duplicates: all.length - new Set(all).size };
    });
    check('no Mermaid ids are left in the document to collide', ids.all.length === 0 && ids.duplicates === 0, JSON.stringify(ids));
    await run(() => window.__card.unmount('d1'));
    s = await settle('d2', 'img');
    check('removing one leaves the other drawn', s.imgLoaded);

    // ── 9. the Markdown wrapper used by saved answers and meeting chat ──────
    console.log('markdown wrapper');
    await run((text) => window.__card.renderMarkdown('md', { text, streaming: false }), `Lead sentence.\n\n\`\`\`mermaid\n${GOOD}\n\`\`\`\n\nClosing sentence with \`\`\`ts\nconst x = 1;\n\`\`\``);
    s = await run(async () => {
      const started = performance.now();
      while (performance.now() - started < 4000) {
        const img = document.querySelector('#md img.diagram-card__img');
        if (img && img.complete) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      const host = document.getElementById('md');
      return { order: [...host.children].map((n) => (n.matches('figure') ? 'diagram' : 'md')), chunks: [...host.querySelectorAll('.md-chunk')].map((n) => n.textContent), img: Boolean(host.querySelector('img.diagram-card__img')) };
    });
    check('prose → diagram → prose, in the answer\'s own order', s.order.join() === 'md,diagram,md' && s.img, JSON.stringify(s.order));
    check('the surface\'s own renderer gets everything except the Mermaid block, untouched', s.chunks[0] === 'Lead sentence.\n\n' && s.chunks[1].includes('```ts\nconst x = 1;\n```') && !s.chunks.join('').includes('flowchart'), JSON.stringify(s.chunks));
    await run((text) => window.__card.renderMarkdown('md2', { text, streaming: false }), 'No diagram here, just `code`.');
    s = await run(() => ({ chunks: [...document.querySelectorAll('#md2 .md-chunk')].map((n) => n.textContent), figures: document.querySelectorAll('#md2 figure').length }));
    check('an answer without a diagram is one untouched chunk', s.chunks.length === 1 && s.chunks[0] === 'No diagram here, just `code`.' && s.figures === 0, JSON.stringify(s));

    // ── charts and notation diagrams (the same card, a different adapter) ───
    console.log('charts and notation diagrams');
    const FORECAST = JSON.stringify({ v: 1, type: 'line', title: 'Monthly revenue at 5% net growth', x: { label: 'Month' }, y: { label: 'Revenue', unit: 'USD' }, compute: { kind: 'compound_growth', baseline: 10000, ratePercent: 5, period: 'month', periods: 3 }, assumptions: ['Net growth stays at 5% every month'] });
    const FORECAST_3 = FORECAST.replace('"ratePercent":5', '"ratePercent":3').replace('at 5% net', 'at 3% net');
    const extra = (slot) =>
      run((sl) => {
        const fig = document.getElementById(sl).querySelector('figure.diagram-card');
        return {
          kind: fig.getAttribute('data-diagram-kind'),
          missing: fig.getAttribute('data-diagram-missing'),
          tabs: [...fig.querySelectorAll('[role=tab]')].map((t) => t.textContent),
          table: fig.querySelector('.diagram-card__table') ? fig.querySelector('.diagram-card__table').innerText.replace(/\s+/g, ' ').trim() : null,
          notes: [...fig.querySelectorAll('.diagram-card__notes li')].map((n) => n.textContent),
          exportButtons: [...fig.querySelectorAll('.diagram-card__export button')].map((b) => b.textContent),
          copyTitle: fig.querySelector('.diagram-card__actions button[title^="Cop"]')?.getAttribute('title'),
        };
      }, slot);

    const repairsBeforeCharts = (await calls()).repair.length;
    await render('chart', { kind: 'chart', artifactId: 'm9:d0', source: FORECAST.slice(0, 80), complete: false, streaming: true, allowAutoRepair: true });
    s = await settle('chart', 'generating');
    let x = await extra('chart');
    check('an open chart block shows "Generating chart…", under a Chart / Data pair of tabs', /Generating chart…/.test(s.text) && s.label === 'Chart' && JSON.stringify(x.tabs) === '["Chart","Data"]' && x.kind === 'chart', JSON.stringify({ text: s.text, x }));
    check('…and nothing is drawn or validated from a partial payload', !s.hasImg && !/could not be read|needs/.test(s.text), s.text);

    await render('chart', { kind: 'chart', artifactId: 'm9:d0', source: FORECAST, complete: true, streaming: true, allowAutoRepair: true, description: 'A scenario at 5%.' });
    s = await settle('chart', 'img');
    x = await extra('chart');
    check('the chart is drawn when its block completes', s.imgLoaded && s.state === 'ready', JSON.stringify({ state: s.state, timedOut: s.timedOut }));
    check('it is titled for what it is: a forecast', s.label === 'Forecast', s.label);
    check('the image is the chart the payload describes, with computed values and a scenario label', s.imgSvg.includes('data-visual="chart:line"') && s.imgSvg.includes('>11,576.25<') && s.imgSvg.includes('>Scenario<'), s.imgSvg.slice(0, 200));
    check('the alt text says what it shows, exactly', s.imgAlt === 'Forecast. Line chart: Monthly revenue at 5% net growth. Revenue goes from 10,000 USD to 11,576.25 USD at Month 3. Scenario.', s.imgAlt);
    check('what it rests on is listed under the drawing, without repeating the line already in the image', x.notes.length === 1 && x.notes[0] === 'Net growth stays at 5% every month', JSON.stringify(x.notes));
    check('nothing is injected as markup: an <img> with an SVG data URL', s.imgSrcHead.startsWith('data:image/svg+xml') && s.svgInDom === 0, s.imgSrcHead);
    check('a valid chart never asks a model for a repair', (await calls()).repair.length === repairsBeforeCharts);

    await click('chart', 'Data');
    s = await settle('chart', 'ready');
    x = await extra('chart');
    check('the Data tab shows the same numbers as a table', x.table === 'Month Revenue (USD) Now 10,000 Month 1 10,500 Month 2 11,025 Month 3 11,576.25', x.table);
    check('…and the payload, indented', s.source && s.source.includes('"compute": {\n    "kind": "compound_growth"'), String(s.source).slice(0, 160));
    await click('chart', 'Chart');
    await settle('chart', 'img');

    await run(() => { window.__card.calls.export.length = 0; });
    await click('chart', 'Export');
    x = await extra('chart');
    check('a chart exports as SVG, PNG, CSV and JSON — and is never offered as Mermaid', JSON.stringify(x.exportButtons) === '["SVG","PNG","CSV","JSON"]', JSON.stringify(x.exportButtons));
    await click('chart', 'CSV');
    await new Promise((r) => setTimeout(r, 150));
    await click('chart', 'Export');
    await click('chart', 'JSON');
    await new Promise((r) => setTimeout(r, 150));
    const chartExports = (await calls()).export;
    check('the CSV is the data table', chartExports[0]?.format === 'csv' && chartExports[0].head.startsWith('Month,Revenue (USD)'), JSON.stringify(chartExports[0]));
    check('the JSON is the inputs as written, with what was computed beside them', chartExports[1]?.format === 'json' && chartExports[1].head.startsWith('{\n  "v": 1,\n  "type": "line"') && chartExports[1].length > FORECAST.length, JSON.stringify(chartExports[1]));
    check('the file is named after the chart', chartExports[0]?.name === 'monthly-revenue-at-5-net-growth', chartExports[0]?.name);
    check('Copy copies the data, and says so', x.copyTitle === 'Copy data', x.copyTitle);

    // An update: the previous version stays until the new one has drawn.
    // A new answer is a new card (as in the overlay, where each answer is its own row).
    await run(() => window.__card.unmount('chart'));
    await render('chart', { kind: 'chart', artifactId: 'm10:d0', source: FORECAST_3.slice(0, 120), complete: false, streaming: true, previousSource: FORECAST });
    await new Promise((r) => setTimeout(r, 250));
    s = await settle('chart', 'generating');
    check('while an update is written, the previous chart stays on screen, marked as updating', s.hasImg && s.previous && /Updating diagram…/.test(s.text) && s.imgSvg.includes('>11,576.25<'), JSON.stringify({ hasImg: s.hasImg, previous: s.previous, text: s.text }));
    // The moment the new block closes, the previous drawing must still be up:
    // it used to drop to a bare "Drawing…" box between the two.
    const gapProbe = await run(async (props) => {
      const seen = [];
      const host = document.getElementById('chart');
      const sample = () => seen.push(Boolean(host.querySelector('img.diagram-card__img')));
      window.__card.render('chart', props);
      for (let i = 0; i < 12; i += 1) {
        await new Promise((r) => requestAnimationFrame(r));
        sample();
      }
      return seen;
    }, { kind: 'chart', artifactId: 'm10:d0', source: FORECAST_3, complete: true, streaming: false, previousSource: FORECAST });
    check('there is a drawing on screen in every frame between the old chart and the new one', gapProbe.every(Boolean), JSON.stringify(gapProbe));
    s = await settle('chart', 'img');
    check('"make it 3%" redraws from the changed input alone', s.imgLoaded && !s.previous && s.imgSvg.includes('>10,927.27<') && !s.imgSvg.includes('>11,576.25<'), s.imgSvg.slice(0, 120));

    // Missing input: a readable reason, never a made-up chart, never a model repair.
    const beforeRepairs = (await calls()).repair.length;
    await render('nobase', { kind: 'chart', artifactId: 'm11:d0', source: JSON.stringify({ v: 1, type: 'line', compute: { kind: 'compound_growth', ratePercent: 5, period: 'month', periods: 3 } }), complete: true, streaming: false, allowAutoRepair: true });
    s = await settle('nobase', 'error');
    x = await extra('nobase');
    check('a forecast with no starting value says what it needs instead of drawing', s.state === 'error' && /This forecast needs a starting value\./.test(s.text) && !s.hasImg && x.missing === 'a starting value', JSON.stringify({ text: s.text, x }));
    check('…with no automatic repair and no "Try to fix": a model could only invent the number', (await calls()).repair.length === beforeRepairs && !s.fixButton, JSON.stringify({ repairs: (await calls()).repair.length, fix: s.fixButton }));
    check('…and the payload is one tap away', /View source/.test(s.text));

    await render('hostile', { kind: 'chart', artifactId: 'm12:d0', source: JSON.stringify({ v: 1, type: 'bar', title: '"><script>window.__pwned = 1</script>', x: { values: ['<img src=x onerror="window.__pwned=1">', 'b'] }, sources: ['</li><script>window.__pwned=1</script>'], series: [{ name: '<b>S</b>', status: 'observed', values: [1, 2] }] }), complete: true, streaming: false });
    s = await settle('hostile', 'img');
    check('labels written by a model are drawn as text and run nothing', s.imgLoaded && s.svgInDom === 0 && (await run(() => window.__pwned === undefined)) && !(await run(() => Boolean(document.querySelector('#hostile script, #hostile img[src="x"]')))), JSON.stringify({ state: s.state }));

    // Chen: drawn by the local adapter, with what was not stated listed.
    const CHEN_SPEC = JSON.stringify({ kind: 'chen-er', title: 'Orders', entities: [{ name: 'Order', attributes: [{ name: 'order_id', key: true }] }, { name: 'Line Item', weak: true, attributes: [{ name: 'line_no', partialKey: true }] }, { name: 'Product', attributes: [{ name: 'sku', key: true }] }], relationships: [{ name: 'contains', identifying: true, participants: [{ entity: 'Order', cardinality: '1', participation: 'partial' }, { entity: 'Line Item', cardinality: 'N' }] }, { name: 'refers to', participants: [{ entity: 'Line Item', cardinality: 'N', participation: 'total' }, { entity: 'Product', cardinality: '1' }] }] });
    await render('chen', { kind: 'notation', artifactId: 'm13:d0', source: CHEN_SPEC, complete: true, streaming: false });
    s = await settle('chen', 'img');
    x = await extra('chen');
    check('a Chen model is drawn with its real symbols', s.imgLoaded && s.label === 'ER diagram (Chen)' && s.imgSvg.includes('chen-weak') && s.imgSvg.includes('chen-identifying') && s.imgSvg.includes('chen-partial-key-underline'), JSON.stringify({ label: s.label, state: s.state }));
    check('a constraint nobody stated is listed under the drawing, not drawn', x.notes.some((n) => /^Not stated, so not drawn: Whether every Product takes part/.test(n)), JSON.stringify(x.notes));
    check('it exports as SVG, PNG and JSON (its model), under Diagram / Source tabs', JSON.stringify(x.tabs) === '["Diagram","Source"]' && x.copyTitle === 'Copy source', JSON.stringify(x));
    await click('chen', 'Export');
    check('…never as Mermaid', JSON.stringify((await extra('chen')).exportButtons) === '["SVG","PNG","JSON"]', JSON.stringify((await extra('chen')).exportButtons));

    await render('chenbad', { kind: 'notation', artifactId: 'm14:d0', source: JSON.stringify({ kind: 'chen-er', entities: [{ name: 'Dependent', weak: true }, 'Employee'], relationships: [{ name: 'has', participants: ['Employee', 'Dependent'] }] }), complete: true, streaming: false, allowAutoRepair: true });
    s = await settle('chenbad', 'error');
    check('a model that contradicts itself is refused with the reason', /"Dependent" is a weak entity but has no identifying relationship to an owner\./.test(s.text) && !s.fixButton, s.text);

    // An automaton: validated, then drawn through Mermaid from source this app wrote.
    const DFA_SPEC = JSON.stringify({ kind: 'automaton', type: 'dfa', title: 'Ends in ab', alphabet: ['a', 'b'], states: ['q0', 'q1', 'q2'], start: 'q0', accepting: ['q2'], transitions: [{ from: 'q0', symbol: 'a', to: 'q1' }, { from: 'q0', symbol: 'b', to: 'q0' }, { from: 'q1', symbol: 'a', to: 'q1' }, { from: 'q1', symbol: 'b', to: 'q2' }, { from: 'q2', symbol: 'a', to: 'q1' }, { from: 'q2', symbol: 'b', to: 'q0' }] });
    await render('dfa', { kind: 'notation', artifactId: 'm15:d0', source: DFA_SPEC, complete: true, streaming: false });
    s = await settle('dfa', 'img');
    check('a DFA is drawn, titled DFA, and described in words', s.imgLoaded && s.label === 'DFA' && /^DFA\. Deterministic finite automaton over \{a, b\}/.test(s.imgAlt) && ['q0', 'q1', 'q2'].every((q) => s.imgSvg.includes(`>${q}<`)), JSON.stringify({ label: s.label, alt: s.imgAlt.slice(0, 80), state: s.state }));
    await click('dfa', 'Source');
    x = await extra('dfa');
    check('its Source tab holds the transition table and the model — not Mermaid', x.table === 'State a b → q0 q1 q0 q1 q1 q2 * q2 q1 q0' && (await settle('dfa', 'ready')).source.includes('"kind": "automaton"'), x.table);
    await render('nfa-as-dfa', { kind: 'notation', artifactId: 'm16:d0', source: DFA_SPEC.replace('{"from":"q0","symbol":"b","to":"q0"}', '{"from":"q0","symbol":"a","to":"q2"}'), complete: true, streaming: false, allowAutoRepair: true });
    s = await settle('nfa-as-dfa', 'error');
    check('an automaton that is not deterministic is not drawn as a DFA', /more than one target, so this is not a DFA/.test(s.text) && !s.hasImg, s.text);

    // A crow's-foot ER (Mermaid) is read back in words and checked for the solid-line slip.
    await render('er', { artifactId: 'm17:d0', source: 'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER {\n        int order_id PK\n        int customer_id FK\n    }', complete: true, streaming: false, description: 'Customers place orders.' });
    s = await settle('er', 'img');
    x = await extra('er');
    check('an ER diagram is read back in both directions in its alt text', s.imgAlt === 'Data model. Customers place orders. Each ORDER relates to exactly one CUSTOMER; each CUSTOMER relates to zero or many ORDER (places).', s.imgAlt);
    check('a solid line on a child with its own key is pointed out under the drawing', x.notes.length === 1 && /non-identifying: a dashed line/.test(x.notes[0]), JSON.stringify(x.notes));

    // Saved answers: the wrapper hands each block to the card with its kind.
    await run((answer) => window.__card.renderMarkdown('md-chart', { text: answer }), `Scenario.\n\n\`\`\`natively-chart\n${FORECAST}\n\`\`\`\n\nRests on one assumption.`);
    await new Promise((r) => setTimeout(r, 400));
    const md = await run(() => {
      const host = document.getElementById('md-chart');
      const fig = host.querySelector('figure.diagram-card');
      return { kind: fig?.getAttribute('data-diagram-kind'), chunks: [...host.querySelectorAll('.md-chunk')].map((n) => n.textContent.trim()), label: fig?.querySelector('.diagram-card__label')?.textContent, raw: /natively-chart/.test(host.innerText) };
    });
    check('a saved answer shows its chart as a card, between its own prose, with no raw payload', md.kind === 'chart' && md.label === 'Forecast' && md.chunks.length === 2 && md.chunks[0] === 'Scenario.' && !md.raw, JSON.stringify(md));
    // A diagram made only of placeholders is not drawn at all.
    const PLACEHOLDER = 'flowchart TD\n    paper["Paper (not retrieved)"] -->|"steps unknown"| method["Method (unknown)"]\n    method --> inputs["Inputs (unknown)"]';
    await render('gap', { artifactId: 'm18:d0', source: PLACEHOLDER.slice(0, 40), complete: false, streaming: true, allowAutoRepair: true });
    s = await settle('gap', 'generating');
    check('while it is still arriving it is a card like any other', /Generating diagram…/.test(s.text), s.text);
    const repairsBeforeGap = (await calls()).repair.length;
    await render('gap', { artifactId: 'm18:d0', source: PLACEHOLDER, complete: true, streaming: false, allowAutoRepair: true });
    await new Promise((r) => setTimeout(r, 500));
    const gap = await run(() => ({ figures: document.querySelectorAll('#gap figure.diagram-card').length, text: document.getElementById('gap').innerText.trim() }));
    check('once complete, a placeholder-only diagram leaves nothing on screen', gap.figures === 0 && gap.text === '', JSON.stringify(gap));
    check('…and asks nothing of a model', (await calls()).repair.length === repairsBeforeGap);
    await render('gap-source', { artifactId: 'm19:d0', source: PLACEHOLDER, info: 'mermaid source', complete: true, streaming: false });
    s = await settle('gap-source', 'ready');
    check('asked for as source, the text is still given', s.source && s.source.includes('Paper (not retrieved)'), String(s.source).slice(0, 80));
    await render('gap-real', { artifactId: 'm20:d0', source: 'flowchart LR\n    api["API"] --> auth["Auth (unknown)"]', complete: true, streaming: false });
    s = await settle('gap-real', 'img');
    check('one real node keeps the drawing', s.imgLoaded, JSON.stringify({ state: s.state }));
    for (const slot of ['chart', 'nobase', 'hostile', 'chen', 'chenbad', 'dfa', 'nfa-as-dfa', 'er', 'md-chart', 'gap', 'gap-source', 'gap-real']) await run((sl) => window.__card.unmount(sl), slot);

    // ── 10. reduced motion ──────────────────────────────────────────────────
    console.log('reduced motion');
    // "Normal" is set, not assumed: a CI runner (macOS and Windows both)
    // reports reduced motion as the machine's own preference.
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const normal = await run(() => getComputedStyle(document.querySelector('#a figure.diagram-card')).transitionDuration);
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = await run(() => ({
      card: getComputedStyle(document.querySelector('#a figure.diagram-card')).transitionDuration,
      tab: getComputedStyle(document.querySelector('#a .diagram-card__tab')).transitionDuration,
      visible: document.querySelector('#a img.diagram-card__img').getBoundingClientRect().width > 0,
    }));
    win.webContents.debugger.detach();
    check('with reduced motion the card has no transitions and stays visible', normal !== '0s' && reduced.card === '0s' && reduced.tab === '0s' && reduced.visible, JSON.stringify({ normal, reduced }));

    // ── 11. cleanup ─────────────────────────────────────────────────────────
    console.log('cleanup');
    await run(() => {
      for (const slot of ['a', 'r1', 'r2', 'r3', 'r4', 'r5', 'u', 'so', 'o', 'd2', 'md', 'md2']) window.__card.unmount(slot);
    });
    const left = await run(() => ({ app: document.getElementById('app').children.length, body: document.body.children.length, figures: document.querySelectorAll('figure').length }));
    check('unmounting leaves nothing behind', left.app === 0 && left.figures === 0 && left.body === 2, JSON.stringify(left));

    if (failures.length) {
      console.error(`\n${failures.length} check(s) failed.`);
      app.exit(1);
      return;
    }
    console.log('\nAll diagram card checks passed.');
    app.exit(0);
  } catch (err) {
    console.error('diagram card check crashed:', err);
    app.exit(1);
  } finally {
    try {
      if (win && !win.isDestroyed()) win.destroy();
    } catch {
      /* window already gone */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
