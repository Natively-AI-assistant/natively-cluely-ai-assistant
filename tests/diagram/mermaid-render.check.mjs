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
        `import * as visual from ${JSON.stringify(resolve(ROOT, 'src/lib/diagram/visualArtifact.mjs'))};`,
        `import * as svgText from ${JSON.stringify(resolve(ROOT, 'src/lib/diagram/svgText.mjs'))};`,
        'window.__diagram = { ...renderer, ...examples, ...policy, ...visual, ...svgText };',
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
      // Mermaid entries only; chart and notation entries are checked in section 1b.
      for (const ex of d.DIAGRAM_EXAMPLES.filter((e) => !e.fence || e.fence === 'mermaid')) {
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

    // ── 1b. the wider catalog: every family, in the real browser ───────────
    console.log('catalog families');
    const families = await run(async (colors) => {
      const d = window.__diagram;
      const types = d.DIAGRAM_EXAMPLES.filter((e) => !e.fence || e.fence === 'mermaid').map((e) => d.checkDiagramSource(e.mermaid).type);
      // A drawing only counts if a real <img> can decode it: that is how every surface shows it.
      const decodes = (svg) => new Promise((done) => {
        const img = new Image();
        img.onload = () => done(img.naturalWidth > 0 && img.naturalHeight > 0);
        img.onerror = () => done(false);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      });
      const payloads = [];
      for (const ex of d.DIAGRAM_EXAMPLES.filter((e) => e.fence === 'natively-chart' || e.fence === 'natively-diagram')) {
        const compiled = d.compileVisualSource(ex.fence === 'natively-chart' ? 'chart' : 'notation', ex.body, colors);
        let ok = compiled.ok;
        let viaMermaid = false;
        let svg = compiled.ok && compiled.renderer === 'svg' ? compiled.svg : '';
        if (compiled.ok && compiled.renderer === 'mermaid') {
          viaMermaid = true;
          const r = await d.renderDiagram(compiled.mermaid, colors);
          ok = r.ok;
          svg = r.ok ? r.svg : '';
        }
        payloads.push({ id: ex.id, ok, viaMermaid, decodes: svg ? await decodes(svg) : false, safe: svg ? d.isSafeDiagramSvg(svg) : false, sanitised: svg ? d.sanitiseDiagramSvg(svg).ok : false, message: compiled.ok ? '' : compiled.message });
      }
      // The automaton's drawing: a start arrow from nowhere and a double circle.
      const dfa = d.compileVisualSource('notation', JSON.stringify({ kind: 'automaton', type: 'dfa', alphabet: ['a', 'b'], states: ['q0', 'q1', 'q2'], start: 'q0', accepting: ['q2'], transitions: [{ from: 'q0', symbol: 'a', to: 'q1' }, { from: 'q0', symbol: 'b', to: 'q0' }, { from: 'q1', symbol: 'a', to: 'q1' }, { from: 'q1', symbol: 'b', to: 'q2' }, { from: 'q2', symbol: 'a', to: 'q1' }, { from: 'q2', symbol: 'b', to: 'q0' }] }), colors);
      const dfaDrawn = await d.renderDiagram(dfa.mermaid, colors);
      const dfaSvg = dfaDrawn.ok ? dfaDrawn.svg : '';
      // Families that are refused on purpose stay refused in the browser too.
      const refused = {};
      for (const [name, src] of Object.entries({ pie: 'pie title x\n    "a" : 1', xychart: 'xychart-beta\n    bar [1, 2]', quadrant: 'quadrantChart\n    title x', sankey: 'sankey-beta\nA,B,1', journey: 'journey\n    title x\n    section s\n      t: 3: me' })) {
        const r = await d.renderDiagram(src, colors);
        refused[name] = !r.ok && r.stage === 'policy' && r.code === 'unsupported_type';
      }
      // Presentation fix-ups for two families.
      const shaped = await d.renderDiagram('mindmap\n  root((Launch plan))\n    Product\n      id1[Pricing]\n    Risks', colors);
      const gantt = await d.renderDiagram('gantt\n    title Rollout\n    dateFormat YYYY-MM-DD\n    section Pilot\n    Pilot team :p1, 2026-10-05, 5d\n    click p1 href "https://example.com"\n    section Rollout\n    All teams :r1, after p1, 10d', colors);
      // Two layouts of an ordinary flowchart: swimlanes (one subgraph per
      // lane) and a tree (top-down, one parent per node).
      const LANES = 'flowchart LR\n    subgraph sales["Sales"]\n        close["Close deal"] --> brief["Write handoff brief"]\n    end\n    subgraph success["Customer Success"]\n        kickoff["Kickoff call"] --> plan["Onboarding plan"]\n    end\n    subgraph support["Support"]\n        access["Grant access"]\n    end\n    brief -->|"account notes"| kickoff\n    plan -->|"access request"| access';
      const TREE = 'flowchart TD\n    ceo["CEO"] --> cto["CTO"]\n    ceo --> cfo["CFO"]\n    cto --> eng["Engineering"]\n    cto --> data["Data"]\n    cfo --> fin["Finance"]\n    cfo --> legal["Legal"]';
      const textOf = (svg) => svg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const lanesDrawn = await d.renderDiagram(LANES, colors);
      const treeDrawn = await d.renderDiagram(TREE, colors);
      const yOf = (svg, label) => {
        // The vertical position of the node that holds this label.
        const at = svg.indexOf(`>${label}<`);
        const head = at === -1 ? '' : svg.slice(0, at);
        const m = [...head.matchAll(/transform="translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)"/g)];
        const node = [...head.matchAll(/<g class="node[^"]*"[^>]*transform="translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)"/g)].pop();
        return node ? Number(node[2]) : m.length ? Number(m[m.length - 1][2]) : null;
      };
      // Labels in the four other languages the app ships in: a request made
      // in one of them is answered with labels in it.
      const SCRIPTS = {
        russian: ['flowchart LR\n    gw["API-шлюз"] --> svc["Сервис заказов"]\n    svc --> q["Очередь уведомлений"]', 'Очередь уведомлений'],
        chinese: ['flowchart LR\n    gw["API 网关"] --> svc["订单服务"]\n    svc --> db[("订单数据库")]', '订单数据库'],
        japanese: ['sequenceDiagram\n    participant U as ユーザー\n    participant A as 認証サービス\n    U->>A: ログイン要求\n    A-->>U: トークン', '認証サービス'],
        spanish: ['flowchart TD\n    a["Inicio de sesión"] --> b{"¿Credenciales válidas?"}\n    b -->|"sí"| c["Emitir token"]\n    b -->|"no"| e["Mostrar error"]', '¿Credenciales válidas?'],
      };
      const scripts = {};
      for (const [name, [source, label]] of Object.entries(SCRIPTS)) {
        const drawn = await d.renderDiagram(source, colors);
        scripts[name] = {
          ok: drawn.ok,
          label: drawn.ok ? textOf(drawn.svg).replace(/\s+/g, '').includes(label.replace(/\s+/g, '')) : false,
          decodes: drawn.ok ? await decodes(drawn.svg) : false,
          safe: drawn.ok ? d.isSafeDiagramSvg(drawn.svg) : false,
          message: drawn.ok ? '' : `${drawn.stage}:${drawn.code}`,
        };
      }
      return {
        types: [...new Set(types)].sort(),
        supported: [...d.SUPPORTED_DIAGRAM_TYPES].sort(),
        scripts,
        layouts: {
          lanes: {
            ok: lanesDrawn.ok,
            clusters: lanesDrawn.ok ? (lanesDrawn.svg.match(/class="cluster[ "]/g) || []).length : 0,
            // (Labels are SVG text, one <tspan> per word: read them with the markup removed.)
            titles: lanesDrawn.ok ? ['Sales', 'Customer Success', 'Support'].every((t) => textOf(lanesDrawn.svg).includes(t)) : false,
            handoff: lanesDrawn.ok ? textOf(lanesDrawn.svg).includes('account notes') : false,
            decodes: lanesDrawn.ok ? await decodes(lanesDrawn.svg) : false,
            safe: lanesDrawn.ok ? d.isSafeDiagramSvg(lanesDrawn.svg) : false,
            message: lanesDrawn.ok ? '' : `${lanesDrawn.stage}:${lanesDrawn.code}`,
          },
          tree: {
            ok: treeDrawn.ok,
            root: treeDrawn.ok ? yOf(treeDrawn.svg, 'CEO') : null,
            mid: treeDrawn.ok ? [yOf(treeDrawn.svg, 'CTO'), yOf(treeDrawn.svg, 'CFO')] : [],
            leaves: treeDrawn.ok ? ['Engineering', 'Data', 'Finance', 'Legal'].map((l) => yOf(treeDrawn.svg, l)) : [],
            decodes: treeDrawn.ok ? await decodes(treeDrawn.svg) : false,
            safe: treeDrawn.ok ? d.isSafeDiagramSvg(treeDrawn.svg) : false,
            message: treeDrawn.ok ? '' : `${treeDrawn.stage}:${treeDrawn.code}`,
          },
        },
        payloads,
        dfa: { ok: dfaDrawn.ok, doubleCircles: (dfaSvg.match(/class="[^"]*outer-path|<g class="node[^"]*"[^>]*>\s*<g class="outer-path"/g) || []).length, circles: (dfaSvg.match(/<circle/g) || []).length, labels: ['q0', 'q1', 'q2'].every((q) => dfaSvg.includes(`>${q}<`)), startInvisible: /fill:\s*none[^"]*stroke:\s*none|stroke:\s*none[^"]*fill:\s*none/.test(dfaSvg), decodes: dfaSvg ? await decodes(dfaSvg) : false },
        refused,
        mindmap: { ok: shaped.ok, neutralised: shaped.ok ? shaped.neutralised : [], hasLabel: shaped.ok ? shaped.svg.includes('Launch') : false },
        gantt: { ok: gantt.ok, neutralised: gantt.ok ? gantt.neutralised : [], noLink: gantt.ok ? !gantt.svg.includes('example.com') : false, todayOff: gantt.ok ? gantt.renderSource.includes('todayMarker off') : false, width: gantt.ok ? gantt.width : 0 },
      };
    }, DARK);
    check('there is a drawn Mermaid example for every Mermaid family the policy allows', families.supported.every((t) => families.types.includes(t)), `${families.types} vs ${families.supported}`);
    for (const p of families.payloads) {
      check(`${p.id}: compiles and draws${p.viaMermaid ? ' (through Mermaid)' : ''}`, p.ok, p.message);
      check(`${p.id}: the drawing decodes as an image and is inert`, p.decodes && p.safe && p.sanitised, JSON.stringify(p));
    }
    check('a DFA draws: three states, labelled, with a double circle for the accepting one', families.dfa.ok && families.dfa.labels && families.dfa.circles >= 4 && families.dfa.decodes, JSON.stringify(families.dfa));
    check('…and its start arrow comes from an invisible node', families.dfa.startInvisible, JSON.stringify(families.dfa));
    check('numeric Mermaid families are refused by policy, not attempted', Object.values(families.refused).every(Boolean), JSON.stringify(families.refused));
    {
      const { lanes, tree } = families.layouts;
      check('swimlanes draw: one box per lane, titled, with the handoff labelled', lanes.ok && lanes.clusters === 3 && lanes.titles && lanes.handoff && lanes.decodes && lanes.safe, JSON.stringify(lanes));
      const level = (ys) => ys.every((y) => y !== null && Math.abs(y - ys[0]) < 2);
      check('a tree draws top-down: the root above its children, each level on one row', tree.ok && tree.decodes && tree.safe && level(tree.mid) && level(tree.leaves) && tree.root < tree.mid[0] && tree.mid[0] < tree.leaves[0], JSON.stringify(tree));
    }
    for (const [name, r] of Object.entries(families.scripts)) {
      check(`labels in ${name} draw, are readable in the drawing, and the image is inert`, r.ok && r.label && r.decodes && r.safe, JSON.stringify(r));
    }
    // ── text in the app's OWN drawings (charts, Chen ER), in every script ────
    // Those drawings size every box from an ESTIMATE of text width. A request
    // in Russian, Chinese or Japanese is answered with labels in that script.
    const ownText = await run(async () => {
      const d = window.__diagram;
      const ctx = document.createElement('canvas').getContext('2d');
      const SAMPLES = {
        latin: ['Monthly revenue at 5% growth', 'Notification Service'],
        spanish: ['Ingresos mensuales con crecimiento', 'Año próximo'],
        russian: ['Ежемесячная выручка при росте 5%', 'Очередь сообщений', 'ШИРОКИЕ ЖЁЛТЫЕ ЩИТЫ', 'жшщмюы', 'Количество пользователей по месяцам'],
        chinese: ['每月收入按百分之五增长', '订单数据库'],
        japanese: ['月次売上（成長率5%）', 'カレンダーのデータベース'],
      };
      const ratios = {};
      for (const [script, list] of Object.entries(SAMPLES)) {
        ratios[script] = Math.min(...list.flatMap((t) => [400, 600].map((weight) => {
          ctx.font = `${weight} 12px ${d.SVG_FONT_FAMILY}`;
          return d.estimateTextWidth(t, 12, weight) / ctx.measureText(t).width;
        })));
      }
      // Drawn, and looked at: no label outside the drawing, no two labels on top of each other.
      const CHARTS = {
        russian: { v: 1, type: 'bar', title: 'Количество пользователей по месяцам', x: { label: 'Месяц', values: ['Январь', 'Февраль', 'Март', 'Апрель', 'Сентябрь', 'Декабрь'] }, y: { label: 'Пользователи' }, series: [{ name: 'Активные пользователи', values: [1200, 1350, 1500, 1620, 1810, 2040], status: 'illustrative' }] },
        chinese: { v: 1, type: 'bar', title: '每月活跃用户数量变化情况', x: { label: '月份', values: ['一月', '二月', '三月', '四月', '九月', '十二月'] }, y: { label: '用户数' }, series: [{ name: '活跃用户', values: [1200, 1350, 1500, 1620, 1810, 2040], status: 'illustrative' }] },
        japanese: { v: 1, type: 'line', title: '月次アクティブユーザー数の推移', compute: { kind: 'compound_growth', baseline: 12000, ratePercent: 4, period: 'month', periods: 8 } },
      };
      const CHEN = {
        'japanese (Chen ER)': { kind: 'chen-er', title: '顧客と注文', entities: [{ name: '顧客', attributes: [{ name: '顧客番号', key: true }, { name: 'メールアドレス' }] }, { name: '注文', attributes: [{ name: '注文番号', key: true }, { name: '合計金額' }] }], relationships: [{ name: '注文する', participants: [{ entity: '顧客', cardinality: '1' }, { entity: '注文', cardinality: 'N', participation: 'total' }] }] },
        'russian (Chen ER)': { kind: 'chen-er', title: 'Клиенты и заказы', entities: [{ name: 'Клиент', attributes: [{ name: 'номер клиента', key: true }, { name: 'электронная почта' }] }, { name: 'Заказ', attributes: [{ name: 'номер заказа', key: true }, { name: 'общая сумма' }] }], relationships: [{ name: 'оформляет', participants: [{ entity: 'Клиент', cardinality: '1' }, { entity: 'Заказ', cardinality: 'N', participation: 'total' }] }] },
      };
      const laid = {};
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:0;top:0;';
      document.body.appendChild(host);
      for (const [script, spec] of [...Object.entries(CHARTS), ...Object.entries(CHEN)]) {
        const compiled = d.compileVisualSource(spec.kind === 'chen-er' ? 'notation' : 'chart', JSON.stringify(spec));
        if (!compiled.ok) { laid[script] = { ok: false, message: compiled.message || compiled.code }; continue; }
        host.innerHTML = compiled.svg;
        const svg = host.querySelector('svg');
        const frame = svg.getBoundingClientRect();
        const boxes = [...svg.querySelectorAll('text')].map((t) => ({ text: t.textContent, r: t.getBoundingClientRect() })).filter((b) => b.text.trim() && b.r.width > 0);
        const outside = boxes.filter((b) => b.r.left < frame.left - 1 || b.r.right > frame.right + 1 || b.r.top < frame.top - 1 || b.r.bottom > frame.bottom + 1).map((b) => b.text);
        const overlaps = [];
        for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i].r; const b = boxes[j].r;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 2 && h > 2) overlaps.push(`${boxes[i].text} × ${boxes[j].text}`);
        }
        laid[script] = { ok: true, labels: boxes.length, outside, overlaps: overlaps.slice(0, 4), safe: d.isSafeDiagramSvg(compiled.svg) };
      }
      host.remove();
      return { ratios, laid };
    });
    for (const [script, ratio] of Object.entries(ownText.ratios)) {
      // Latin has always been within a few percent; the others must not come out short.
      check(`text width in ${script} is not underestimated (estimate ÷ real ≥ ${script === 'latin' || script === 'spanish' ? '0.93' : '0.99'})`, ratio >= (script === 'latin' || script === 'spanish' ? 0.93 : 0.99), `min ratio ${ratio.toFixed(3)}`);
    }
    for (const [script, r] of Object.entries(ownText.laid)) {
      check(`a drawing labelled in ${script} has every label inside it and none on top of another`, r.ok && r.labels > 5 && r.outside.length === 0 && r.overlaps.length === 0 && r.safe, JSON.stringify(r));
    }
    check('a mind map node written with a shape is drawn as plain text', families.mindmap.ok && families.mindmap.neutralised.includes('node_shape') && families.mindmap.hasLabel, JSON.stringify(families.mindmap));
    check('a Gantt chart draws at card width, without its click link or a "today" line', families.gantt.ok && families.gantt.neutralised.includes('interaction') && families.gantt.noLink && families.gantt.todayOff && families.gantt.width <= 760, JSON.stringify(families.gantt));

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

    // ── text that used to break the image itself ───────────────────────────
    // Found in review: the sanitiser serialises as HTML, so a no-break space
    // came out as `&nbsp;` — undefined in an SVG document, and the whole image
    // failed to load under a card that said "ready". And a label ending in half
    // an emoji made the data URL encoder throw during render.
    console.log('text that breaks an image');
    const awkward = await run(async (colors) => {
      const d = window.__diagram;
      const loads = (url) => new Promise((done) => {
        const img = new Image();
        img.onload = () => done(img.naturalWidth > 0);
        img.onerror = () => done(false);
        img.src = url;
      });
      const nbsp = ' ';
      const half = '\ud83d';
      const cases = {
        'sequence message with a no-break space': `sequenceDiagram\n    participant A as Client\n    participant B as API\n    A->>B: wait 10${nbsp}ms\n    Note over A,B: retry${nbsp}once`,
        'state label with a no-break space': `stateDiagram-v2\n    [*] --> Paid: pay${nbsp}now\n    Paid --> [*]`,
        'class member with a no-break space': `classDiagram\n    class Order {\n        +total${nbsp}amount\n    }`,
        'ER attribute comment with a no-break space': `erDiagram\n    ORDER {\n        int id PK "order${nbsp}id"\n    }`,
        'timeline event with a no-break space': `timeline\n    title Plan\n    Week${nbsp}1 : Kick${nbsp}off`,
        'mind map branch with a no-break space': `mindmap\n  root((Plan))\n    First${nbsp}step`,
        'flowchart label ending in half an emoji': `flowchart LR\n    a["Ship it ${half}"] --> b["Done"]`,
      };
      const out = {};
      for (const [name, source] of Object.entries(cases)) {
        const r = await d.renderDiagram(source, colors);
        let url = '';
        let threw = false;
        try {
          url = r.ok ? d.svgToDataUrl(r.svg) : '';
        } catch {
          threw = true;
        }
        out[name] = { ok: r.ok, code: r.ok ? '' : r.code, threw, entity: r.ok && /&nbsp;/.test(r.svg), loads: url ? await loads(url) : false };
      }
      // A chart whose title is cut through an emoji by a length limit.
      const title = `${'x'.repeat(89)}😀 tail`;
      const chart = d.compileVisualSource('chart', JSON.stringify({ v: 1, type: 'bar', title, x: { values: ['a', 'b'] }, series: [{ name: 's', status: 'illustrative', values: [1, 2] }] }), colors);
      let chartThrew = false;
      let chartUrl = '';
      try {
        chartUrl = chart.ok ? d.svgToDataUrl(chart.svg) : '';
      } catch {
        chartThrew = true;
      }
      out['chart title cut through an emoji'] = { ok: chart.ok, code: chart.ok ? '' : chart.code, threw: chartThrew, entity: false, loads: chartUrl ? await loads(chartUrl) : false };
      // Encoding is total whatever it is given.
      let total = true;
      try {
        d.svgToDataUrl('<svg xmlns="http://www.w3.org/2000/svg">\ud83d</svg>');
        d.svgToDataUrl('\udc00');
      } catch {
        total = false;
      }
      return { out, total };
    }, DARK);
    for (const [name, r] of Object.entries(awkward.out)) {
      check(`${name}: drawn, and the image loads`, r.ok && !r.threw && !r.entity && r.loads, JSON.stringify(r));
    }
    check('the data-URL encoder never throws', awkward.total);

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
        gantt: 'sankey-beta\nA,B,1',
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
    check('unsupported families are rejected (pie, sankey)', !policy.unsupported.ok && policy.unsupported.code === 'unsupported_type' && !policy.gantt.ok);
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
