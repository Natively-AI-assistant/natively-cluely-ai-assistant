// Real-renderer check for diagram artifacts.
//
// Runs the app's own diagram renderer (src/lib/diagram/mermaidRenderer.ts) in
// a real Chromium page, against the exact Mermaid version pinned in
// package.json. A Node unit test cannot do this: Mermaid measures text through
// the DOM, and the questions below are about what actually reaches the screen.
//
// What it proves:
//   1. every curated example (diagramExamples.mjs) passes policy, parses and
//      renders to a sanitised SVG with real dimensions;
//   2. the output is plain SVG — no <foreignObject>, no script, no external
//      reference — and can be rasterised to PNG without tainting the canvas;
//   3. model-written config (init directives, frontmatter) and click/link
//      statements are neutralised, not obeyed; remote images, script URLs and
//      active HTML are rejected before Mermaid sees them;
//   4. invalid Mermaid fails at the parse stage with a bounded diagnostic and
//      leaves no temporary nodes in the document;
//   5. the same source requested twice is drawn once (cache), two different
//      sources requested together each get their own drawing, and a theme
//      change produces a different drawing from the same source;
//   6. a large-but-allowed graph renders within a bounded time.
//
// Run: npm run test:diagram:render
// Prints cold-load and warm-render timings as measured on this machine.
import { app, BrowserWindow } from 'electron';
import { build } from 'esbuild';
import { writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const RENDERER = resolve(ROOT, 'src/lib/diagram/mermaidRenderer.ts');
const EXAMPLES = resolve(ROOT, 'src/lib/diagram/diagramExamples.mjs');
const POLICY = resolve(ROOT, 'src/lib/diagram/diagramPolicy.mjs');

if (!existsSync(RENDERER)) {
  console.error(`renderer not found at ${RENDERER} — run from the repo root (npm run test:diagram:render).`);
  process.exit(2);
}

const DARK = { text: '#f1f5f9', muted: '#94a3b8', nodeFill: '#1e293b', stroke: '#64748b', groupFill: '#0f172a', accent: '#38bdf8', dark: true };
const LIGHT = { text: '#0f172a', muted: '#475569', nodeFill: '#f8fafc', stroke: '#94a3b8', groupFill: '#eef2f7', accent: '#0284c7', dark: false };

const failures = [];
const notes = [];
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

function largeFlowchart(nodes, extraEdges) {
  const lines = ['flowchart LR'];
  for (let i = 0; i < nodes; i += 1) lines.push(`    n${i}["Service ${i}"]`);
  for (let i = 0; i + 1 < nodes; i += 1) lines.push(`    n${i} -->|"call ${i}"| n${i + 1}`);
  for (let i = 0; i < extraEdges; i += 1) lines.push(`    n${i % nodes} -.-> n${(i * 7 + 3) % nodes}`);
  return lines.join('\n');
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'natively-diagram-check-'));
  let win;
  try {
    const entry = join(dir, 'entry.mjs');
    writeFileSync(
      entry,
      [
        `import * as renderer from ${JSON.stringify(RENDERER)};`,
        `import * as examples from ${JSON.stringify(EXAMPLES)};`,
        `import * as policy from ${JSON.stringify(POLICY)};`,
        'window.__diagram = { ...renderer, ...examples, ...policy };',
      ].join('\n'),
    );
    const bundle = join(dir, 'bundle.js');
    await build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      outfile: bundle,
      logLevel: 'error',
      nodePaths: [resolve(ROOT, 'node_modules')],
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const page = join(dir, 'index.html');
    writeFileSync(
      page,
      '<!doctype html><html><head><meta charset="utf-8">' +
        // The app's own image policy: data: allowed, blob: not.
        `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' file:; img-src 'self' data:; style-src 'self' 'unsafe-inline'">` +
        `</head><body><div id="app"></div><script src="${pathToFileURL(bundle).href}"></script></body></html>`,
    );

    win = new BrowserWindow({ width: 900, height: 700, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await win.loadFile(page);
    const run = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);

    // ── 1. curated examples ────────────────────────────────────────────────
    console.log('curated examples');
    const exampleResults = await run(async (colors) => {
      const d = window.__diagram;
      const out = [];
      for (const ex of d.DIAGRAM_EXAMPLES) {
        const policy = d.checkDiagramSource(ex.mermaid);
        const r = await d.renderDiagram(ex.mermaid, colors);
        out.push({
          id: ex.id,
          policyOk: policy.ok,
          complexity: policy.complexity,
          ok: r.ok,
          failure: r.ok ? null : { stage: r.stage, code: r.code, diagnostic: r.diagnostic },
          width: r.ok ? r.width : 0,
          height: r.ok ? r.height : 0,
          hasForeignObject: r.ok ? /foreignObject/i.test(r.svg) : false,
          hasText: r.ok ? /<text[\s>]/.test(r.svg) : false,
          timings: r.ok ? r.timings : null,
          type: r.ok ? r.type : null,
        });
      }
      return out;
    }, DARK);
    for (const r of exampleResults) {
      check(`${r.id}: passes policy`, r.policyOk);
      check(`${r.id}: renders`, r.ok, r.failure ? JSON.stringify(r.failure) : '');
      check(`${r.id}: has real size`, r.width > 40 && r.height > 40, `${r.width}x${r.height}`);
      check(`${r.id}: labels are SVG text, no foreignObject`, r.hasText && !r.hasForeignObject);
      check(`${r.id}: within the size the contract asks for (<=12 nodes, <=20 edges)`, r.complexity.nodes <= 12 && r.complexity.edges <= 20, JSON.stringify(r.complexity));
    }
    const cold = exampleResults[0]?.timings;
    if (cold) notes.push(`cold Mermaid load: ${cold.coldLoadMs.toFixed(0)} ms (bundle already in memory; excludes network/disk of a real lazy chunk)`);
    const warm = exampleResults.filter((r) => r.timings).map((r) => r.timings.parseMs + r.timings.renderMs).sort((a, b) => a - b);
    if (warm.length) {
      notes.push(`parse+render per example (n=${warm.length}): min ${warm[0].toFixed(0)} ms, median ${warm[Math.floor(warm.length / 2)].toFixed(0)} ms, max ${warm[warm.length - 1].toFixed(0)} ms (first one includes Mermaid's own lazy diagram init)`);
    }

    // ── 2. output safety + PNG ─────────────────────────────────────────────
    console.log('output');
    const output = await run(async (colors) => {
      const d = window.__diagram;
      const r = await d.renderDiagram(d.DIAGRAM_EXAMPLES[1].mermaid, colors);
      if (!r.ok) return { ok: false };
      const url = d.svgToDataUrl(r.svg);
      const img = new Image();
      const loaded = await new Promise((res) => {
        img.onload = () => res(true);
        img.onerror = () => res(false);
        img.src = url;
      });
      let png = null;
      let tainted = false;
      let painted = 0;
      if (loaded) {
        const canvas = document.createElement('canvas');
        canvas.width = r.width * 2;
        canvas.height = r.height * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          png = canvas.toDataURL('image/png');
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 0; i < data.length; i += 4 * 97) {
            if (data[i] !== 0x0b || data[i + 1] !== 0x12 || data[i + 2] !== 0x20) painted += 1;
          }
        } catch (e) {
          tainted = true;
        }
      }
      return {
        ok: true,
        loaded,
        tainted,
        painted,
        pngPrefix: png ? png.slice(0, 22) : null,
        naturalWidth: img.naturalWidth,
        width: r.width,
        hasXmlns: /<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(r.svg),
        hasStyle: /<style/.test(r.svg),
        external: /https?:|@import|<script|foreignObject|\son[a-z]+=/.test(r.svg.replace(/xmlns(:\w+)?="[^"]*"/g, '')),
      };
    }, DARK);
    check('rendered SVG loads as an <img> from a data: URL under the app image policy', output.ok && output.loaded);
    check('the image has its intrinsic size', output.naturalWidth === output.width, `${output.naturalWidth} vs ${output.width}`);
    check('SVG carries its namespace and its own styles', output.hasXmlns && output.hasStyle);
    check('SVG has no external or active content', output.ok && !output.external);
    check('PNG export: canvas is not tainted and has drawn pixels', !output.tainted && output.pngPrefix === 'data:image/png;base64,' && output.painted > 20, JSON.stringify({ tainted: output.tainted, painted: output.painted }));

    // ── 3. policy: neutralise config/interaction, reject active content ────
    console.log('policy');
    const policy = await run(async (colors) => {
      const d = window.__diagram;
      const base = 'flowchart LR\n    a["Client"] --> b["API"]';
      const cases = {
        initDirective: "%%{init: {'theme':'forest','securityLevel':'loose','themeVariables':{'primaryColor':'#ff0000'}}}%%\n" + base,
        frontmatter: '---\nconfig:\n  theme: forest\n  securityLevel: loose\n---\n' + base,
        click: base + '\n    click a href "https://example.com" "open"\n    click b call alert(1)',
        seqLinks: 'sequenceDiagram\n    participant A\n    participant B\n    link A: Dashboard @ https://example.com\n    A->>B: hello',
        imageShape: 'flowchart LR\n    a@{ img: "https://example.com/x.png", label: "x" } --> b',
        scriptUrl: 'flowchart LR\n    a["x"] --> b["javascript:alert(1)"]',
        imgTag: 'flowchart LR\n    a["<img src=x onerror=alert(1)>"] --> b',
        scriptTag: 'flowchart LR\n    a["<script>alert(1)</script>"] --> b',
        unsupported: 'pie title Pets\n    "Dogs" : 386\n    "Cats" : 85',
        gantt: 'gantt\n    title A\n    section S\n    T1 :a1, 2026-01-01, 30d',
        boldLabel: 'flowchart LR\n    a["<b>bold</b> and List<String>"] --> b["x <br/> y"]',
        stateChoice: 'stateDiagram-v2\n    state check <<choice>>\n    [*] --> check\n    check --> Ok: valid\n    check --> Bad: invalid',
      };
      const out = {};
      for (const [name, source] of Object.entries(cases)) {
        const p = d.checkDiagramSource(source);
        const r = await d.renderDiagram(source, colors);
        out[name] = {
          policyOk: p.ok,
          rejection: p.rejection || null,
          neutralised: p.neutralised,
          ok: r.ok,
          stage: r.ok ? null : r.stage,
          code: r.ok ? null : r.code,
          svgHasRed: r.ok ? /#ff0000/i.test(r.svg) : false,
          svgHasLink: r.ok ? /example\.com|<a[\s>]|href=/i.test(r.svg) : false,
          svgHasBoldEl: r.ok ? /<b[\s>]/i.test(r.svg) : false,
          hasForeignObject: r.ok ? /foreignObject/i.test(r.svg) : false,
        };
      }
      out.alerts = window.__alerts || 0;
      return out;
    }, DARK);
    check('init directive is removed and its theme/securityLevel are not applied', policy.initDirective.ok && policy.initDirective.neutralised.includes('directive') && !policy.initDirective.svgHasRed, JSON.stringify(policy.initDirective));
    check('frontmatter config is removed', policy.frontmatter.ok && policy.frontmatter.neutralised.includes('frontmatter'), JSON.stringify(policy.frontmatter));
    check('click statements are removed and leave no link', policy.click.ok && policy.click.neutralised.includes('interaction') && !policy.click.svgHasLink, JSON.stringify(policy.click));
    check('sequence link menus are removed', policy.seqLinks.ok && !policy.seqLinks.svgHasLink, JSON.stringify(policy.seqLinks));
    check('remote image shape is rejected', !policy.imageShape.ok && policy.imageShape.code === 'remote_resource', JSON.stringify(policy.imageShape));
    check('script URL is rejected', !policy.scriptUrl.ok && policy.scriptUrl.code === 'remote_resource', JSON.stringify(policy.scriptUrl));
    check('<img onerror> label is rejected', !policy.imgTag.ok && policy.imgTag.code === 'raw_html', JSON.stringify(policy.imgTag));
    check('<script> label is rejected', !policy.scriptTag.ok && policy.scriptTag.code === 'raw_html', JSON.stringify(policy.scriptTag));
    check('unsupported families are rejected (pie, gantt)', !policy.unsupported.ok && policy.unsupported.code === 'unsupported_type' && !policy.gantt.ok);
    check('harmless angle brackets render as text, not elements', policy.boldLabel.ok && !policy.boldLabel.svgHasBoldEl && !policy.boldLabel.hasForeignObject, JSON.stringify(policy.boldLabel));
    check('<<choice>> state syntax is not mistaken for HTML', policy.stateChoice.ok, JSON.stringify(policy.stateChoice));

    // ── 4. invalid source ──────────────────────────────────────────────────
    console.log('invalid source');
    const invalid = await run(async (colors) => {
      const d = window.__diagram;
      const before = document.body.children.length;
      const bad = await d.renderDiagram('flowchart LR\n    a["Client" --> b[', colors);
      const truncated = await d.renderDiagram('sequenceDiagram\n    A->>B: hi\n    alt ok\n        B-->>A: yes', colors);
      const after = document.body.children.length;
      return {
        bad: { ok: bad.ok, stage: bad.stage, diagnosticLen: (bad.diagnostic || '').length, message: bad.message },
        truncated: { ok: truncated.ok, stage: truncated.stage },
        leftovers: after - before,
        errorSvgs: document.querySelectorAll('svg[aria-roledescription="error"]').length,
      };
    }, DARK);
    check('invalid Mermaid fails at the parse stage', !invalid.bad.ok && invalid.bad.stage === 'parse', JSON.stringify(invalid.bad));
    check('the parser diagnostic is present and bounded', invalid.bad.diagnosticLen > 0 && invalid.bad.diagnosticLen <= 600, String(invalid.bad.diagnosticLen));
    check('a block cut off mid-structure fails cleanly', !invalid.truncated.ok && invalid.truncated.stage === 'parse', JSON.stringify(invalid.truncated));
    check('failed renders leave nothing in the document', invalid.leftovers === 0 && invalid.errorSvgs === 0, JSON.stringify(invalid));

    // ── 4b. Mermaid keywords used as node ids (found live with a real model) ──
    console.log('keywords as node ids');
    const reserved = await run(async (colors) => {
      const d = window.__diagram;
      // The diagram a real model wrote: the "Social Graph" node is called `graph`.
      const live = [
        'flowchart LR',
        '    client["Client"] -->|"GET /timeline"| tl["Timeline Service"]',
        '    bus["Event Bus"] --> fanout["Fan-out Service"]',
        '    fanout -->|"lookup followers"| graph[("Social Graph")]',
        '    fanout -->|"push tweet id"| cache[("Timeline Cache")]',
        '    tl -->|"read ids"| cache',
      ].join('\n');
      const mermaid = await d.loadMermaid();
      let rawParses = true;
      try {
        await mermaid.parse(live);
      } catch {
        rawParses = false;
      }
      const fixed = await d.renderDiagram(live, colors);
      const perWord = {};
      for (const word of d.RESERVED_FLOWCHART_IDS) {
        const src = `flowchart LR\n    a["A"] -->|"x"| ${word}[("The ${word} label")]\n    ${word} --> b["B"]\n    subgraph zone ["Zone"]\n        c["C"]\n    end\n    b --> c`;
        const r = await d.renderDiagram(src, colors);
        perWord[word] = r.ok && r.neutralised.includes('reserved_id') && r.svg.includes(`${word}`) && /zone|Zone/.test(r.svg);
      }
      return {
        rawParses,
        fixedOk: fixed.ok,
        renamed: fixed.ok ? fixed.neutralised.includes('reserved_id') : false,
        renderSource: fixed.ok ? fixed.renderSource : '',
        labelKept: fixed.ok ? fixed.svg.includes('Social') : false,
        perWord,
        failure: fixed.ok ? null : { stage: fixed.stage, code: fixed.code, diagnostic: fixed.diagnostic },
      };
    }, DARK);
    check('precondition: Mermaid itself rejects a node called `graph`', reserved.rawParses === false);
    check('…and the renderer draws it anyway, by renaming the id locally (no model call)', reserved.fixedOk && reserved.renamed, JSON.stringify(reserved.failure));
    check('the label is untouched and the id is renamed consistently', reserved.labelKept && /graph_node\[\("Social Graph"\)\]/.test(reserved.renderSource) && !/\| graph\[/.test(reserved.renderSource), reserved.renderSource);
    check('every keyword the grammar rejects draws once renamed, subgraph/end intact', Object.values(reserved.perWord).every(Boolean), JSON.stringify(reserved.perWord));

    // ── 5. cache, concurrency, theme ───────────────────────────────────────
    console.log('cache and concurrency');
    const conc = await run(async (dark, light) => {
      const d = window.__diagram;
      d.clearDiagramRenderCache();
      const a = 'flowchart LR\n    alpha["Alpha"] --> beta["Beta"]';
      const b = 'sequenceDiagram\n    participant Gamma\n    participant Delta\n    Gamma->>Delta: ping';
      const [a1, b1, a2] = await Promise.all([d.renderDiagram(a, dark), d.renderDiagram(b, dark), d.renderDiagram(a, dark)]);
      const a3 = await d.renderDiagram(a, dark);
      const aLight = await d.renderDiagram(a, light);
      const aDarkAgain = await d.renderDiagram(a, dark);
      return {
        allOk: a1.ok && b1.ok && a2.ok && aLight.ok,
        sameObject: a1 === a2 && a1 === a3,
        aIsA: /Alpha/.test(a1.svg) && !/Gamma/.test(a1.svg),
        bIsB: /Gamma/.test(b1.svg) && !/Alpha/.test(b1.svg),
        themeDiffers: a1.svg !== aLight.svg && aLight.svg.toLowerCase().includes(light.text) && a1.svg.toLowerCase().includes(dark.text),
        darkStillCached: aDarkAgain === a1,
        peek: d.peekDiagramRender(a, dark) === a1,
        leftovers: document.querySelectorAll('[id^="natively-diagram-"], [id^="dnatively-diagram-"]').length,
      };
    }, DARK, LIGHT);
    check('concurrent requests all resolve', conc.allOk);
    check('the same source + theme is drawn once and shared', conc.sameObject && conc.peek && conc.darkStillCached);
    check('two different sources requested together each get their own drawing', conc.aIsA && conc.bIsB);
    check('a theme change redraws from the same source with the new colours', conc.themeDiffers);
    check('no temporary render nodes remain', conc.leftovers === 0, String(conc.leftovers));

    // ── 6. bounded work ────────────────────────────────────────────────────
    console.log('large graphs');
    const big = await run(async (colors, allowed, tooBig) => {
      const d = window.__diagram;
      const t0 = performance.now();
      const r = await d.renderDiagram(allowed, colors);
      const ms = performance.now() - t0;
      const rejected = await d.renderDiagram(tooBig, colors);
      return { ok: r.ok, ms, failure: r.ok ? null : r, complexity: d.checkDiagramSource(allowed).complexity, rejected: { ok: rejected.ok, stage: rejected.stage, code: rejected.code } };
    }, DARK, largeFlowchart(50, 40), largeFlowchart(90, 60));
    check('a 50-node / 89-edge graph (inside the limits) renders', big.ok, JSON.stringify(big.failure));
    check('…in bounded time (< 4 s on this machine)', big.ms < 4000, `${big.ms.toFixed(0)} ms`);
    check('a graph over the node limit is rejected by policy, not attempted', !big.rejected.ok && big.rejected.stage === 'policy' && big.rejected.code === 'too_large', JSON.stringify(big.rejected));
    notes.push(`large allowed graph (${big.complexity.nodes} nodes / ${big.complexity.edges} edges): ${big.ms.toFixed(0)} ms`);

    console.log('');
    for (const n of notes) console.log(`note: ${n}`);
    if (failures.length) {
      console.error(`\n${failures.length} check(s) failed.`);
      app.exit(1);
      return;
    }
    console.log('\nAll diagram render checks passed.');
    app.exit(0);
  } catch (err) {
    console.error('diagram render check crashed:', err);
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
