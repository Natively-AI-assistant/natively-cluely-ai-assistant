// natively-browser/src/__tests__/formula-image.test.mjs
//
// Issue #645 follow-up: the manual capture draws formulas that have no text
// into an image sent with the page text, so the answer no longer waits for a
// desktop screenshot; and formulas in a highlighted selection are read too.
//
// Run: npm test

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHtml } from './fake-html.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (f) => pathToFileURL(path.resolve(__dirname, '../../dist-test', f)).href;
const { extractPageContent, finishFormulaImages } = await import(dist('extract.js'));
const { UNREADABLE_FORMULA, countFormulaMarkers, FormulaTokens } = await import(dist('math-text.js'));
const ext = await import(dist('capture/extractors/index.js'));
const reg = await import(dist('capture/registry/registry.js'));
const cls = await import(dist('capture/classifier/tab-classifier.js'));
const { smartCapture, finishSmartFormulaImages } = await import(dist('capture/smart-capture.js'));
const { layoutFormulaSheets, drawFormulaSheets, formulaImageLimitsOf } = await import(dist('formula-sheet.js'));

const svgFormula = (n) =>
  `<span class="MathJax_SVG" id="MathJax-Element-${n}-Frame">` +
  `<svg width="6.276ex" height="1.676ex" viewBox="0 -576.1 2701.9 721.6" role="img" focusable="false">` +
  `<g stroke="currentColor" fill="currentColor"><path d="M213 578L200 573Z"></path></g></svg></span>`;

const HACKERRANK_URL = 'https://www.hackerrank.com/challenges/matrix-rotation-algo/problem';
const PAGE = `<body><nav>Prepare Algorithms</nav>
<div class="challenge-body-html">
<div class="challenge_problem_statement"><div class="hackdown-content">
<p id="stmt">You are given a 2D matrix of dimension ${svgFormula(1)} and a positive integer ${svgFormula(2)}. You have to rotate the matrix ${svgFormula(3)} times.</p>
</div></div>
<div class="challenge_constraints"><strong>Constraints</strong>
<div class="hackdown-content"><p>${svgFormula(4)}<br>${svgFormula(5)}<br>${svgFormula(6)}<br>${svgFormula(7)}</p></div></div>
<div class="challenge_sample_input"><strong>Sample Input</strong><pre>4 4 2
1 2 3 4</pre></div>
</div></body>`;

const doc = () => parseHtml(PAGE, { title: 'Matrix Layer Rotation | HackerRank', url: HACKERRANK_URL });
const textOf = (n) => (n.nodeType === 3 ? n.data : ['script', 'style'].includes(n.localName) ? '' : n.childNodes.map(textOf).join(''));
const fakeReadability = (d) => ({ parse: () => ({ title: d.title, textContent: textOf(d.body) }) });
// Stands in for serializeFormulaSvg: names the formula it was given.
const serializeFormula = (el) => `svg:${el.getAttribute('id')}`;
const body = (r) => r.text.split('\n\n---\n\n')[1];
const statementP = (d) => d.querySelectorAll('p').find((p) => p.getAttribute('id') === 'stmt');

describe('#645: formulas with no text go into an image with the capture', () => {
  test('each one is numbered in reading order, and its SVG is returned under that number', () => {
    const r = extractPageContent({ document: doc(), readabilityFactory: fakeReadability, serializeFormula });
    assert.equal(r.source, 'statement');
    assert.match(body(r), /matrix of dimension \[formula 1, see image\] and a positive integer \[formula 2, see image\]\. You have to rotate the matrix \[formula 3, see image\] times/);
    assert.match(body(r), /Constraints\n+\[formula 4, see image\]\n\[formula 5, see image\]\n\[formula 6, see image\]\n\[formula 7, see image\]/);
    // Readability's clone was tokenised too; only the body that was sent is numbered.
    assert.deepEqual(r.formulas, [1, 2, 3, 4, 5, 6, 7].map((n) => `svg:MathJax-Element-${n}-Frame`));
    assert.equal(r.unreadableFormulas, 0);
    assert.match(r.text, /^FORMULAS: /m);
  });

  test('a formula that repeats keeps its first number and is drawn once', () => {
    // Formula 3 draws the same as formula 1 (a page repeats its variables).
    const same = (el) => serializeFormula(el).replace('Element-3-', 'Element-1-');
    const r = extractPageContent({ document: doc(), readabilityFactory: fakeReadability, serializeFormula: same });
    assert.match(body(r), /dimension \[formula 1, see image\] and a positive integer \[formula 2, see image\]\. You have to rotate the matrix \[formula 1, see image\] times/);
    assert.match(body(r), /Constraints\n+\[formula 3, see image\]\n\[formula 4, see image\]\n\[formula 5, see image\]\n\[formula 6, see image\]/);
    assert.deepEqual(r.formulas, [1, 2, 4, 5, 6, 7].map((n) => `svg:MathJax-Element-${n}-Frame`));
    // Formula 1 is not drawn: both places it stood are marked, and it counts once.
    const done = finishFormulaImages(r, new Set([2, 3, 4, 5, 6]));
    assert.equal(countFormulaMarkers(body(done)), 7);
    assert.equal((body(done).match(/\[formula not captured\]/g) || []).length, 2);
    assert.equal(done.unreadableFormulas, 1);
  });

  test('a formula the sheet could not draw becomes [formula not captured] and is counted', () => {
    const r = extractPageContent({ document: doc(), readabilityFactory: fakeReadability, serializeFormula });
    const done = finishFormulaImages(r, new Set([1, 2, 4, 5, 6, 7]));
    assert.match(done.text, /rotate the matrix \[formula not captured\] times/);
    assert.match(done.text, /\[formula 4, see image\]/);
    assert.equal(done.unreadableFormulas, 1);
    assert.equal(done.formulas[2], '');
  });

  test('nothing drawn: the same text as a capture with no image at all', () => {
    const plain = extractPageContent({ document: doc(), readabilityFactory: fakeReadability });
    const r = extractPageContent({ document: doc(), readabilityFactory: fakeReadability, serializeFormula });
    const done = finishFormulaImages(r, new Set());
    assert.equal(done.text, plain.text);
    assert.equal(done.unreadableFormulas, 7);
    assert.equal(plain.unreadableFormulas, 7);
    assert.deepEqual(plain.formulas, []);
  });

  test('a formula the serializer cannot draw stays [formula not captured]', () => {
    const r = extractPageContent({
      document: doc(),
      readabilityFactory: fakeReadability,
      serializeFormula: (el) => (el.getAttribute('id') === 'MathJax-Element-2-Frame' ? null : serializeFormula(el)),
    });
    assert.match(body(r), /dimension \[formula 1, see image\] and a positive integer \[formula not captured\]\. You have to rotate the matrix \[formula 2, see image\]/);
    assert.equal(r.formulas.length, 6);
    assert.equal(r.unreadableFormulas, 1);
  });

  test('the text stays within the capture budget once the markers are numbered', () => {
    const many = Array.from({ length: 1400 }, (_, i) => svgFormula(100 + i)).join(' ');
    const d = parseHtml(`<body><p>${many}</p></body>`, { url: 'https://judge.example.org/p/1' });
    const r = extractPageContent({ document: d, readabilityFactory: fakeReadability, serializeFormula });
    assert.ok(r.text.length <= 25000, `${r.text.length}`);
    const numbers = [...r.text.matchAll(/\[formula (\d+), see image\]/g)].map((m) => Number(m[1]));
    assert.equal(numbers.length, r.formulas.length);
    assert.deepEqual(numbers, numbers.map((_, i) => i + 1));
  });
});

// The automatic capture (What to answer pulls the page just before the answer).
function autoCapture(serialize) {
  const host = 'hackerrank.com';
  const candidate = cls.classifyTab({
    registry: reg.DEFAULT_REGISTRY, host, url: HACKERRANK_URL, title: 'Matrix Layer Rotation | HackerRank',
    signals: { codeEditorPresent: true, ioConstraintSignals: true },
  });
  return ext.runExtractor({
    document: doc(), getSelection: () => '', contextId: 'ctx-auto', capturedAt: 1,
    candidate, platform: reg.findPlatform(reg.DEFAULT_REGISTRY, host, HACKERRANK_URL), captureMode: 'auto',
    ...(serialize ? { serializeFormula: serialize } : {}),
  });
}
const CONSTRAINT_MARKERS = /Constraints\n+\[formula 4, see image\]\n\[formula 5, see image\]\n\[formula 6, see image\]\n\[formula 7, see image\]/;

describe('#645: the automatic capture sends an image of its formulas too', () => {
  test('they are numbered once, alike in the text and in the structured fields', () => {
    const out = autoCapture(serializeFormula);
    const p = out.envelope.payload;
    assert.match(out.dom, /CONSTRAINTS:\nConstraints\n+\[formula 4, see image\]/);
    assert.match(out.dom, CONSTRAINT_MARKERS);
    assert.match(p.constraints, CONSTRAINT_MARKERS);
    assert.match(p.problemStatement, /dimension \[formula 1, see image\] and a positive integer \[formula 2, see image\]\. You have to rotate the matrix \[formula 3, see image\] times/);
    assert.deepEqual(out.formulas, [1, 2, 3, 4, 5, 6, 7].map((n) => `svg:MathJax-Element-${n}-Frame`));
    // The note says what the markers mean; nothing of the placeholders is left.
    assert.match(out.dom, /^FORMULAS: /m);
    assert.doesNotMatch(out.dom + JSON.stringify(p), /[\uE000\uE001]/);
    assert.equal(out.envelope.meta.charCount, out.dom.length);
  });

  test('without a desktop that takes the image, they stay [formula not captured], as before', () => {
    const out = autoCapture();
    assert.equal(out.formulas, undefined);
    assert.doesNotMatch(out.dom, /\[formula \d+, see image\]/);
    assert.equal((out.envelope.payload.constraints.match(/\[formula not captured\]/g) || []).length, 4);
    assert.match(out.dom, /^FORMULAS: /m);
  });

  test('a formula the sheet could not draw becomes [formula not captured] in both, and is counted', () => {
    const out = autoCapture(serializeFormula);
    const done = finishSmartFormulaImages({ candidate: {}, blocked: false, ...out }, new Set([1, 2, 3, 4, 5, 6]));
    assert.match(done.dom, /\[formula 6, see image\]\n\[formula not captured\]/);
    assert.match(done.envelope.payload.constraints, /\[formula 6, see image\]\n\[formula not captured\]/);
    assert.equal(done.unreadableFormulas, 1);
    assert.equal(done.formulas, undefined);
    // The capture it came from is left as it was.
    assert.match(out.envelope.payload.constraints, /\[formula 7, see image\]/);
  });

  test('smartCapture passes the serializer through to the extractor', () => {
    const r = smartCapture({
      document: doc(), host: 'www.hackerrank.com', url: HACKERRANK_URL, title: 'Matrix Layer Rotation | HackerRank',
      contextId: 'ctx-smart', capturedAt: 1, captureMode: 'auto', serializeFormula,
    });
    assert.equal(r.formulas?.length, 7);
    assert.match(r.dom, /\[formula 7, see image\]/);
  });

  test('a placeholder cut short by a length cap leaves nothing behind', () => {
    let n = 0;
    const tokens = new FormulaTokens(() => `svg${++n}`);
    const { markerFor } = tokens.options();
    const a = markerFor({});
    const b = markerFor({});
    assert.equal(tokens.number(`x ${a} y ${b.slice(0, 2)}`), 'x [formula 1, see image] y ');
    // Later texts of the same capture keep the numbers.
    assert.equal(tokens.number(`${b} ${a}`), '[formula 2, see image] [formula 1, see image]');
    assert.deepEqual(tokens.formulas, ['svg1', 'svg2']);
  });
});

describe('#645: formulas inside a highlighted selection', () => {
  const longSelection = 'You are given a 2D matrix of dimension  and a positive integer . You have to rotate the matrix  times.';

  test('the selection\'s markup is read, so its formulas are marked where they stood', () => {
    const d = doc();
    const r = extractPageContent({
      document: d,
      readabilityFactory: fakeReadability,
      getSelection: () => longSelection,
      getSelectionFragment: () => statementP(d).cloneNode(true),
      serializeFormula,
    });
    assert.equal(r.source, 'selection');
    assert.match(r.text, /SELECTED TEXT:\n\(answer about THIS highlighted text\)\nYou are given a 2D matrix of dimension \[formula 1, see image\] and a positive integer \[formula 2, see image\]\./);
    assert.equal(r.formulas.length, 3);
    assert.match(r.text, /^FORMULAS: /m);
  });

  test('a selection of formulas alone is the subject, as its text would be', () => {
    const d = doc();
    const constraints = d.querySelectorAll('p')[1];
    const r = extractPageContent({
      document: d,
      readabilityFactory: fakeReadability,
      getSelection: () => '\n\n',
      getSelectionFragment: () => constraints.cloneNode(true),
      serializeFormula,
    });
    assert.equal(r.source, 'selection');
    assert.match(r.text, /\(answer about THIS highlighted text\)\n\[formula 1, see image\]\n\[formula 2, see image\]\n\[formula 3, see image\]\n\[formula 4, see image\]/);
    assert.equal(r.formulas.length, 4);
  });

  test('with no image, the selection\'s gaps are marked and counted', () => {
    const d = doc();
    const r = extractPageContent({
      document: d,
      readabilityFactory: fakeReadability,
      getSelection: () => longSelection,
      getSelectionFragment: () => statementP(d).cloneNode(true),
    });
    assert.match(r.text, /dimension \[formula not captured\] and a positive integer \[formula not captured\]/);
    assert.equal(r.unreadableFormulas, 3);
  });

  test('the TeX source is found even though the selection does not hold its script', () => {
    const d = parseHtml(
      `<body><p id="b">Bounds hold for every test case: ${svgFormula(9)} and nothing else.</p>` +
        `<script type="math/tex" id="MathJax-Element-9">1 \\le T \\le 50</script></body>`,
    );
    const p = d.querySelectorAll('p')[0];
    const r = extractPageContent({
      document: d,
      readabilityFactory: fakeReadability,
      getSelection: () => 'Bounds hold for every test case:  and nothing else.',
      getSelectionFragment: () => p.cloneNode(true),
    });
    assert.match(r.text, /Bounds hold for every test case: \$1 \\le T \\le 50\$ and nothing else\./);
    assert.equal(r.unreadableFormulas, 0);
    assert.doesNotMatch(r.text, /FORMULAS:/);
  });

  test('a selection with no formula is read from its own string, as before', () => {
    const code = 'def rotate(matrix, r):\n    for layer in range(4):\n        pass  # rotate this layer';
    const run = (withFragment) => {
      const d = doc();
      return extractPageContent({
        document: d,
        readabilityFactory: fakeReadability,
        getSelection: () => code,
        ...(withFragment ? { getSelectionFragment: () => d.querySelectorAll('pre')[0].cloneNode(true), serializeFormula } : {}),
      });
    };
    const r = run(true);
    assert.equal(r.text, run(false).text);
    assert.match(r.text, /def rotate\(matrix, r\):\n for layer in range\(4\):/);
    assert.deepEqual(r.formulas, []);
  });
});

describe('#645: a statement container nested in another is read once', () => {
  test('HackerRank nests .problem-statement; the statement is not doubled', () => {
    // As on the live page: div.problem-statement.split > ... > div.problem-statement.
    const html = `<body><div class="problem-statement split"><div class="side">
<div class="problem-statement theme-m"><p>Rotate the matrix ${svgFormula(1)} times.</p>
<strong>Constraints</strong><p>${svgFormula(2)}</p></div></div></div></body>`;
    const d = parseHtml(html, { title: 'Matrix Layer Rotation | HackerRank', url: HACKERRANK_URL });
    const r = extractPageContent({ document: d, readabilityFactory: fakeReadability, serializeFormula });
    assert.equal(r.source, 'statement');
    assert.equal(body(r).match(/Rotate the matrix/g).length, 1);
    assert.deepEqual(r.formulas, ['svg:MathJax-Element-1-Frame', 'svg:MathJax-Element-2-Frame']);
  });
});

describe('formula sheet layout', () => {
  test('formulas sit side by side in a row, each after its label', () => {
    const [sheet, ...rest] = layoutFormulaSheets([{ w: 120, h: 30 }, null, { w: 300, h: 40 }]);
    assert.equal(rest.length, 0);
    assert.deepEqual(sheet.cells.map((c) => c.n), [1, 3]);
    assert.deepEqual(sheet.cells.map((c) => c.x), [16 + 130, 16 + 130 + 120 + 40 + 130]);
    // Centred on one row.
    assert.equal(sheet.cells[0].y + 15, sheet.cells[1].y + 20);
    assert.equal(sheet.width, 436 + 300 + 16);
    assert.equal(sheet.height, 16 + 40 + 16);
  });

  test('a row wraps when the next formula would not fit', () => {
    const [sheet] = layoutFormulaSheets([{ w: 500, h: 44 }, { w: 500, h: 44 }, { w: 500, h: 44 }]);
    const [a, b, c] = sheet.cells;
    assert.equal(a.y, b.y);
    assert.ok(c.y > a.y + 44);
    assert.equal(c.x, a.x);
    assert.ok(sheet.width <= 1500);
  });

  test('a formula wider than the sheet is scaled down, keeping its shape', () => {
    const [sheet] = layoutFormulaSheets([{ w: 6000, h: 60 }]);
    assert.ok(sheet.width <= 1500);
    const cell = sheet.cells[0];
    // Rounded to whole pixels: within 5% of the original 100:1.
    assert.ok(Math.abs(cell.w / cell.h - 100) < 5, `${cell.w}x${cell.h}`);
  });

  test('past the last sheet the rest are left out, in order, each sheet within 1500 px', () => {
    const sheets = layoutFormulaSheets(Array.from({ length: 2000 }, () => ({ w: 200, h: 44 })));
    assert.equal(sheets.length, 3);
    assert.ok(sheets.every((s) => s.height <= 1500 && s.width <= 1500));
    const numbers = sheets.flatMap((s) => s.cells.map((c) => c.n));
    assert.deepEqual(numbers, numbers.map((_, i) => i + 1));
    // Four to a row, 25 rows a sheet.
    assert.equal(numbers.length, 300);
  });

  test('a smaller scale fits more, and maxSheets is kept', () => {
    const sizes = Array.from({ length: 2000 }, () => ({ w: 200, h: 44 }));
    const count = (sheets) => sheets.reduce((n, s) => n + s.cells.length, 0);
    assert.ok(count(layoutFormulaSheets(sizes, { scale: 0.64 })) > count(layoutFormulaSheets(sizes)));
    assert.equal(layoutFormulaSheets(sizes, { maxSheets: 1 }).length, 1);
  });
});

describe('drawing the sheets', () => {
  const LIMITS = { maxImages: 3, maxImageChars: 533_332, maxTotalChars: 1_200_000 };
  const env = ({ png = 1000, jpeg = 500, failing = '', size = { w: 100, h: 40 } } = {}) => {
    const calls = [];
    const widths = [];
    return {
      calls,
      widths,
      loadImage: async (url) =>
        failing && decodeURIComponent(url).includes(failing) ? null : { naturalWidth: size.w, naturalHeight: size.h },
      createCanvas: () => ({
        getContext: () => ({
          fillRect() {},
          fillText(t) { calls.push(t); },
          drawImage(_img, _x, _y, w) { widths.push(w); },
        }),
        toDataURL: (type) => `data:${type};base64,` + 'A'.repeat(type === 'image/png' ? png : jpeg),
      }),
    };
  };

  test('every loaded formula is drawn under its number', async () => {
    const e = env({ failing: 'bad' });
    const { images, ranges, drawn } = await drawFormulaSheets(['<svg>a</svg>', '<svg>bad</svg>', '', '<svg>d</svg>'], e, LIMITS);
    assert.equal(images.length, 1);
    assert.ok(images[0].startsWith('data:image/png;base64,'));
    assert.deepEqual([...drawn], [1, 4]);
    assert.deepEqual(ranges, [[1, 4]]);
    assert.deepEqual(e.calls, ['formula 1', 'formula 4']);
  });

  test('a PNG over the per-image limit is sent as JPEG; one still over is left out', async () => {
    const asJpeg = await drawFormulaSheets(['<svg/>'], env({ png: 600_000, jpeg: 1000 }), LIMITS);
    assert.ok(asJpeg.images[0].startsWith('data:image/jpeg;base64,'));
    const none = await drawFormulaSheets(['<svg/>'], env({ png: 600_000, jpeg: 600_000 }), LIMITS);
    assert.deepEqual(none.images, []);
    assert.equal(none.drawn.size, 0);
  });

  test('formulas are drawn smaller rather than left out', async () => {
    // 405 fit at full size; 500 need the 0.8 scale.
    const e = env();
    const { images, ranges, drawn } = await drawFormulaSheets(Array.from({ length: 500 }, (_, i) => `<svg>${i}</svg>`), e, LIMITS);
    assert.equal(drawn.size, 500);
    assert.ok(images.length <= 3);
    // One range per image, together covering every number once, in order.
    assert.equal(ranges.length, images.length);
    assert.deepEqual(ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)), Array.from({ length: 500 }, (_, i) => i + 1));
    assert.ok(e.widths.every((w) => w === 80), `widths ${[...new Set(e.widths)]}`);
  });

  test('within the total budget, the scale that shows the most formulas wins', async () => {
    // Each sheet is 500 000 characters and only one fits the total: 135 of the
    // 200 at full size, 192 at the smaller scales.
    const e = env({ png: 500_000, jpeg: 500_000 });
    const svgs = Array.from({ length: 200 }, (_, i) => `<svg>${i}</svg>`);
    const { images, ranges, drawn } = await drawFormulaSheets(svgs, e, { ...LIMITS, maxTotalChars: 700_000 });
    assert.equal(images.length, 1);
    assert.deepEqual(ranges, [[1, 192]]);
    assert.equal(drawn.size, 192);
    assert.deepEqual([...drawn], Array.from({ length: 192 }, (_, i) => i + 1));
  });

  test('by the deadline it stops: formulas still loading are left out', async () => {
    const e = env();
    const slow = { ...e, loadImage: (url) => (decodeURIComponent(url).includes('slow') ? new Promise(() => {}) : e.loadImage(url)), now: () => performance.now() };
    const t0 = performance.now();
    const { images, drawn } = await drawFormulaSheets(['<svg>a</svg>', '<svg>slow</svg>', '<svg>c</svg>'], slow, LIMITS, performance.now() + 50);
    assert.ok(performance.now() - t0 < 1000);
    assert.equal(images.length, 1);
    assert.deepEqual([...drawn], [1, 3]);
  });

  test('past the deadline no smaller size is tried once something is drawn', async () => {
    // 250 formulas of 200x60 fit at 0.8, but only one sheet fits the total:
    // 92 at 0.8, 140 at 0.64.
    const big = (now) => ({ ...env({ png: 500_000, jpeg: 500_000, size: { w: 200, h: 60 } }), now });
    const svgs = Array.from({ length: 250 }, (_, i) => `<svg>${i}</svg>`);
    const limits = { ...LIMITS, maxTotalChars: 700_000 };
    assert.equal((await drawFormulaSheets(svgs, big(() => 0), limits)).drawn.size, 140);
    assert.equal((await drawFormulaSheets(svgs, big(() => 10), limits, 5)).drawn.size, 92);
  });

  test('the desktop limits are read from its desktop-features frame, or not at all', () => {
    assert.deepEqual(formulaImageLimitsOf({ maxImages: 3, maxImageChars: 533_332, maxTotalChars: 1_200_000 }), LIMITS);
    assert.equal(formulaImageLimitsOf(undefined), null);
    assert.equal(formulaImageLimitsOf({ maxImages: 3, maxImageChars: 533_332 }), null);
    assert.equal(formulaImageLimitsOf({ maxImages: 0, maxImageChars: 1, maxTotalChars: 1 }), null);
    assert.equal(formulaImageLimitsOf({ maxImages: 1.5, maxImageChars: 1, maxTotalChars: 1 }), null);
  });

  test('countFormulaMarkers counts both kinds of marker', () => {
    assert.equal(countFormulaMarkers(`a ${UNREADABLE_FORMULA} b [formula 2, see image] c [formula 10, see image]`), 3);
  });
});
