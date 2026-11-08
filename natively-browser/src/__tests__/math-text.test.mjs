// natively-browser/src/__tests__/math-text.test.mjs
//
// Issue #645: the manual capture (Ctrl/Cmd+Y) lost HackerRank's problem
// statement and Constraints. Two causes, both seen on the live page on
// 2026-10-24:
//   1. Readability keeps only its highest-scoring section, the Sample
//      Input/Output blocks; the statement, Input Format and Constraints never
//      reached the capture.
//   2. HackerRank draws every formula with server-rendered MathJax 2 SVG (bare
//      <path> outlines, no TeX, no labels), so even read directly, a
//      Constraints list is empty bullets, and the capture still looked
//      complete.
// The fixture copies the structure of
// https://www.hackerrank.com/challenges/matrix-rotation-algo/problem (paths
// shortened, samples trimmed).
//
// Run: npm test

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHtml } from './fake-html.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (f) => pathToFileURL(path.resolve(__dirname, '../../dist-test', f)).href;
const { extractPageContent } = await import(dist('extract.js'));
const { inlineFormulas, countUnreadableFormulas, UNREADABLE_FORMULA } = await import(dist('math-text.js'));
const ext = await import(dist('capture/extractors/index.js'));
const reg = await import(dist('capture/registry/registry.js'));
const cls = await import(dist('capture/classifier/tab-classifier.js'));

// Readability stand-in: the article text is the clone's body text without
// <script>/<style> (Readability drops those), so whatever was done to the clone
// before parse() shows up in the result.
const textWithoutScripts = (n) =>
  n.nodeType === 3 ? n.data : ['script', 'style'].includes(n.localName) ? '' : n.childNodes.map(textWithoutScripts).join('');
const fakeReadability = (doc) => ({ parse: () => ({ title: doc.title, textContent: textWithoutScripts(doc.body) }) });

const svgFormula = (n) =>
  `<span style="font-size: 100%; display: inline-block;" class="MathJax_SVG" id="MathJax-Element-${n}-Frame">` +
  `<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="6.276ex" height="1.676ex" style="vertical-align: -0.338ex;" viewBox="0 -576.1 2701.9 721.6" role="img" focusable="false">` +
  `<g stroke="currentColor" fill="currentColor" stroke-width="0" transform="matrix(1 0 0 -1 0 0)">` +
  `<path stroke-width="1" d="M213 578L200 573Q186 568 160 563T102 556H83V602H102Q149 604 189 617Z"></path>` +
  `<g transform="translate(778,0)"><path stroke-width="1" d="M674 636Q682 636 688 630T694 615T687 601"></path></g>` +
  `</g></svg></span>`;

const HACKERRANK_URL = 'https://www.hackerrank.com/challenges/matrix-rotation-algo/problem?isFullScreen=true';
const HACKERRANK = `<body><nav>Prepare Algorithms Implementation</nav>
<div class="challenge-body-html">
<div class="challenge_problem_statement"><div class="msB challenge_problem_statement_body"><div class="hackdown-content">
<svg style="display: none;"><defs id="MathJax_SVG_glyphs"></defs></svg>
<p>You are given a 2D matrix of dimension ${svgFormula(1)} and a positive integer ${svgFormula(2)}. You have to rotate the matrix ${svgFormula(3)} times.</p>
</div></div></div>
<div class="challenge_constraints"><strong>Constraints</strong>
<div class="msB challenge_constraints_body"><div class="hackdown-content"><p>${svgFormula(4)}<br>${svgFormula(5)}<br>${svgFormula(6)}<br>${svgFormula(7)}</p></div></div></div>
<div class="challenge_sample_input"><strong>Sample Input</strong><pre>4 4 2
1 2 3 4</pre></div>
</div><div class="code-editor">Run Code Submit Code</div></body>`;

const hackerRankDoc = () => parseHtml(HACKERRANK, { title: 'Matrix Layer Rotation | HackerRank', url: HACKERRANK_URL });

// What Readability returned on the live page: the samples section alone.
const readabilityKeepsSamplesOnly = (doc) => ({
  parse: () => ({
    title: doc.title,
    textContent: doc.querySelectorAll('.challenge_sample_input').map((n) => n.textContent).join('\n'),
  }),
});

describe('issue #645: HackerRank statement, Constraints and SVG-only formulas', () => {
  test('the statement and Constraints are read from the statement container, not Readability', () => {
    const r = extractPageContent({ document: hackerRankDoc(), readabilityFactory: readabilityKeepsSamplesOnly });
    assert.equal(r.source, 'statement');
    const body = r.text.split('\n\n---\n\n')[1];
    assert.match(body, /You are given a 2D matrix of dimension/);
    assert.match(body, /Constraints/);
    assert.match(body, /Sample Input/);
    assert.doesNotMatch(body, /Prepare Algorithms|Submit Code/);
  });

  test('each unreadable formula is marked where it stood, and counted', () => {
    const r = extractPageContent({ document: hackerRankDoc(), readabilityFactory: readabilityKeepsSamplesOnly });
    assert.equal(r.unreadableFormulas, 7);
    assert.equal(countUnreadableFormulas(r.text.split('\n\n---\n\n')[1]), 7);
    assert.match(r.text, /matrix of dimension \[formula not captured\] and a positive integer \[formula not captured\]\./);
    assert.match(r.text, /Constraints\n+\[formula not captured\]\n\[formula not captured\]\n\[formula not captured\]\n\[formula not captured\]/);
  });

  test('without a registry match (unknown site) Readability still decides', () => {
    const doc = parseHtml(HACKERRANK, { url: 'https://judge.example.org/problem/1' });
    const r = extractPageContent({ document: doc, readabilityFactory: fakeReadability });
    assert.equal(r.source, 'readability');
    assert.equal(r.unreadableFormulas, 7);
  });

  test('the front matter tells the model the text is incomplete', () => {
    const r = extractPageContent({ document: hackerRankDoc(), readabilityFactory: fakeReadability });
    const front = r.text.split('\n\n---\n\n')[0];
    assert.match(front, /^FORMULAS: some formulas on this page are drawn as pictures/m);
    assert.match(front, /never guess their values/i);
  });

  test('the innerText fallback (no registry match, Readability found nothing) marks them too', () => {
    const r = extractPageContent({ document: parseHtml(HACKERRANK, { url: 'https://judge.example.org/p/1' }) });
    assert.equal(r.source, 'innertext');
    assert.equal(r.unreadableFormulas, 7);
  });

  test('the live page is never modified', () => {
    const doc = hackerRankDoc();
    extractPageContent({ document: doc, readabilityFactory: fakeReadability });
    assert.equal(doc.textContent, null);
    assert.ok(!doc.body.textContent.includes(UNREADABLE_FORMULA));
    assert.equal(
      doc.querySelectorAll('span').filter((s) => s.getAttribute('class') === 'MathJax_SVG').length,
      7,
    );
  });

  test('a long highlighted selection is the body, so nothing is counted', () => {
    const r = extractPageContent({
      document: hackerRankDoc(),
      readabilityFactory: fakeReadability,
      getSelection: () => 'Rotate the matrix r times and print the resulting matrix, one row per line.',
    });
    assert.equal(r.source, 'selection');
    assert.equal(r.unreadableFormulas, 0);
    assert.doesNotMatch(r.text, /FORMULAS:/);
  });

  test('formulas cut off by the coding body cap are not counted', () => {
    const filler = 'x '.repeat(2500);
    const doc = parseHtml(`<body><div class="challenge-body-html"><p>${filler}</p><p>${svgFormula(1)}</p></div></body>`, {
      url: HACKERRANK_URL,
    });
    const r = extractPageContent({ document: doc, readabilityFactory: fakeReadability });
    assert.equal(r.pageType, 'coding');
    assert.equal(r.unreadableFormulas, 0);
    assert.doesNotMatch(r.text, /FORMULAS:/);
  });
});

describe('formulas whose text the page does provide', () => {
  const extractBody = (html) => {
    const r = extractPageContent({ document: parseHtml(`<body>${html}</body>`), readabilityFactory: fakeReadability });
    return r;
  };

  test('MathJax 2 with its TeX source script → the TeX', () => {
    const r = extractBody(
      `<p>Bounds: <span class="MathJax_Preview"></span>${svgFormula(9)}<script type="math/tex" id="MathJax-Element-9">1 \\le T \\le 50</script>.</p>`,
    );
    assert.match(r.text, /Bounds: \$1 \\le T \\le 50\$\./);
    assert.equal(r.unreadableFormulas, 0);
    assert.doesNotMatch(r.text, /FORMULAS:/);
  });

  test('MathJax 2 innerText fallback keeps the TeX even though scripts are dropped', () => {
    const doc = parseHtml(
      `<body><p>Bounds: ${svgFormula(9)}<script type="math/tex" id="MathJax-Element-9">1 \\le T</script></p></body>`,
    );
    const r = extractPageContent({ document: doc });
    assert.equal(r.source, 'innertext');
    assert.match(r.text, /Bounds: \$1 \\le T\$/);
  });

  test('KaTeX → the TeX annotation, once (not the duplicated HTML rendering)', () => {
    const r = extractBody(
      `<p>Let <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>n</mi><mo>≤</mo><msup><mn>10</mn><mn>5</mn></msup></mrow>` +
        `<annotation encoding="application/x-tex">n \\le 10^5</annotation></semantics></math></span>` +
        `<span class="katex-html" aria-hidden="true"><span class="base">n≤10</span><span>5</span></span></span> hold.</p>`,
    );
    assert.match(r.text, /Let \$n \\le 10\^5\$ hold\./);
    assert.doesNotMatch(r.text, /n≤105/);
  });

  test('MathJax 3 SVG with assistive MathML → the MathML text', () => {
    const r = extractBody(
      `<p>Here <mjx-container class="MathJax" jax="SVG"><svg aria-hidden="true" role="img"><g><path d="M1 2"></path></g></svg>` +
        `<mjx-assistive-mml><math><mn>1</mn><mo>≤</mo><mi>T</mi></math></mjx-assistive-mml></mjx-container> holds.</p>`,
    );
    assert.match(r.text, /Here 1≤T holds\./);
  });

  test('MathML keeps its structure: powers, indices and fractions are not run together', () => {
    // As MathJax 3 draws x_1 = (a_1^2 + 1)/(b_1 - 1) <= 10^2 (seen live): its
    // textContent read "x1=a12+1b1−1≤102".
    const mml =
      '<math><msub><mi>x</mi><mrow><mn>1</mn></mrow></msub><mo>=</mo><mfrac><mrow><msubsup><mi>a</mi><mrow><mn>1</mn></mrow><mrow><mn>2</mn></mrow></msubsup><mo>+</mo><mn>1</mn></mrow>' +
      '<mrow><msub><mi>b</mi><mrow><mn>1</mn></mrow></msub><mo>−</mo><mn>1</mn></mrow></mfrac><mo>≤</mo><msup><mn>10</mn><mrow><mn>2</mn></mrow></msup></math>';
    const r = extractBody(`<p>Here <mjx-container class="MathJax" jax="SVG"><svg aria-hidden="true"><path d="M1"></path></svg><mjx-assistive-mml>${mml}</mjx-assistive-mml></mjx-container> holds.</p>`);
    assert.match(r.text, /Here x_1=\(a_1\^2\+1\)\/\(b_1−1\)≤10\^2 holds\./);
  });

  test('square roots, roots, multi-part exponents and limits', () => {
    const r = extractBody(
      `<p>A <math><msqrt><mi>n</mi></msqrt></math>, B <math><mroot><mi>x</mi><mn>3</mn></mroot></math>, ` +
        `C <math><msup><mn>2</mn><mrow><mi>n</mi><mo>+</mo><mn>1</mn></mrow></msup></math>, ` +
        `D <math><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msub><mi>a</mi><mi>i</mi></msub></math>, ` +
        `E <math><mover accent="true"><mi>x</mi><mo>¯</mo></mover></math>.</p>`,
    );
    assert.match(r.text, /A √n, B 3√x, C 2\^\(n\+1\), D ∑_\(i=1\)\^na_i, E x¯\./);
  });

  test('MathJax 2 MathML in data-mathml or a math/mml script reads the same way', () => {
    const mml = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mn>1</mn><mo>&#x2264;</mo><mi>n</mi><mo>&lt;</mo><msup><mn>10</mn><mn>5</mn></msup></math>';
    const attr = mml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const viaAttr = extractBody(`<p>A <span class="MathJax_SVG" id="F-Frame" data-mathml="${attr}"><svg><path d="M1"></path></svg></span>.</p>`);
    assert.match(viaAttr.text, /A 1≤n<10\^5\./);
    // A script's text is raw markup; the test parser would read it as elements.
    const doc = parseHtml(`<body><p>B ${svgFormula(4)}<script type="math/mml" id="MathJax-Element-4"></script>.</p></body>`);
    doc.querySelectorAll('script')[0].appendChild(doc.createTextNode(mml));
    const viaScript = extractPageContent({ document: doc, readabilityFactory: fakeReadability });
    assert.match(viaScript.text, /B 1≤n<10\^5\./);
  });

  test('an accessible label → the label', () => {
    const r = extractBody(`<p>Size <mjx-container class="MathJax" aria-label="n squared"><svg><path d="M1"></path></svg></mjx-container>.</p>`);
    assert.match(r.text, /Size n squared\./);
  });

  test('MediaWiki math → the alttext once, not alttext + fallback image', () => {
    const r = extractBody(
      `<p>Area <span class="mwe-math-element"><span style="display: none;"><math alttext="{\\displaystyle \\pi r^{2}}"><mi>π</mi></math></span>` +
        `<img class="mwe-math-fallback-image-inline" alt="{\\displaystyle \\pi r^{2}}"></span>.</p>`,
    );
    assert.match(r.text, /Area \$\{\\displaystyle \\pi r\^\{2\}\}\$\./);
  });

  // From PR #678 (nero-harsh): formula source kept in data attributes.
  test('data-latex / data-tex on the formula element → the TeX', () => {
    const r = extractBody(
      `<p>Bounds <span data-latex="1 \\le n \\le 10^5"><svg><path d="M1"></path></svg></span> and ` +
        `<span data-tex="k &lt; n"><svg><path d="M1"></path></svg></span>.</p>`,
    );
    assert.match(r.text, /Bounds \$1 \\le n \\le 10\^5\$ and \$k < n\$\./);
    assert.equal(r.unreadableFormulas, 0);
  });

  test('data-math / data-formula are read inside a formula, never as a formula of their own', () => {
    const r = extractBody(
      `<p>A <span class="MathJax_SVG" data-math="x^2"><svg><path d="M1"></path></svg></span>.</p>` +
        `<div data-math="true"><p>Given an array of n integers, return the sum.</p></div>` +
        `<div data-formula="a + b"><p>Read two numbers.</p></div>` +
        `<p>B <span data-latex="true"><svg><path d="M1"></path></svg></span>.</p>`,
    );
    assert.match(r.text, /A \$x\^2\$\./);
    assert.match(r.text, /Given an array of n integers, return the sum\./);
    assert.match(r.text, /Read two numbers\./);
    assert.doesNotMatch(r.text, /\$true\$|a \+ b/);
  });

  test('MathJax 3 CommonHTML with nothing readable → marked unreadable', () => {
    const r = extractBody(`<p>Then <mjx-container class="MathJax" jax="CHTML"><mjx-math><mjx-mi><mjx-c class="mjx-c1D45B"></mjx-c></mjx-mi></mjx-math></mjx-container>.</p>`);
    assert.match(r.text, /Then \[formula not captured\]\./);
    assert.equal(r.unreadableFormulas, 1);
  });
});

describe('pages without formulas are unchanged', () => {
  test('an icon svg (role=img, no math class) is left alone and nothing is counted', () => {
    const r = extractPageContent({
      document: parseHtml(`<body><p>Settings <svg role="img"><path d="M1"></path></svg> open the menu.</p></body>`),
      readabilityFactory: fakeReadability,
    });
    assert.equal(r.unreadableFormulas, 0);
    assert.doesNotMatch(r.text, /formula|FORMULAS/);
    assert.match(r.text, /Settings\s+open the menu\./);
  });

  test('inlineFormulas reports what it found', () => {
    const doc = hackerRankDoc();
    assert.deepEqual(inlineFormulas(doc), { found: 7, unreadable: 7 });
    assert.equal(countUnreadableFormulas(doc.body.textContent), 7);
    assert.equal(countUnreadableFormulas(''), 0);
  });
});

describe('#645 review follow-ups — manual capture', () => {
  test('table cells keep a gap between them', () => {
    const doc = parseHtml(
      '<body><div class="challenge-body-html"><p>Limits</p><table><tr><th>Name</th><th>Bound</th></tr>' +
        '<tr><td>N</td><td>10^5</td></tr></table></div></body>',
      { title: 'Table | HackerRank', url: HACKERRANK_URL },
    );
    const r = extractPageContent({ document: doc, readabilityFactory: fakeReadability });
    assert.equal(r.source, 'statement');
    assert.match(r.text, /\bN 10\^5\b/);
    assert.match(r.text, /\bName Bound\b/);
  });

  test('the FORMULAS note goes only with a body that still holds a marker', () => {
    // Front matter (code + a long headings outline) fills most of the 25k
    // budget, so the statement body is cut before its only formula.
    const code = `<pre>${'x = 1;\n'.repeat(1200)}</pre>` +
      `<nav>${Array.from({ length: 1400 }, (_, i) => `<h2>Part ${i}</h2>`).join('')}</nav>`;
    const prose = 'Read the matrix row by row and rotate each layer. '.repeat(30);
    const doc = parseHtml(
      `<body>${code}<div class="challenge-body-html"><p>${prose}</p><p>${svgFormula(9)}</p></div></body>`,
      { title: 'Budget | HackerRank', url: HACKERRANK_URL },
    );
    const r = extractPageContent({ document: doc, readabilityFactory: fakeReadability });
    assert.equal(r.unreadableFormulas, 0);
    assert.doesNotMatch(r.text, /^FORMULAS:/m, 'note promises formulas that were not sent');
  });
});

describe('#645 review follow-ups — automatic capture (Smart Browser Context v2)', () => {
  const run = (doc) => {
    const host = 'www.hackerrank.com';
    const candidate = cls.classifyTab({
      registry: reg.DEFAULT_REGISTRY, host, url: HACKERRANK_URL, title: doc.title,
      signals: { codeEditorPresent: true, ioConstraintSignals: true },
    });
    return ext.runExtractor({
      document: doc, getSelection: () => '', contextId: 'ctx-645', capturedAt: 1,
      candidate, platform: reg.findPlatform(reg.DEFAULT_REGISTRY, host, HACKERRANK_URL), captureMode: 'auto',
    });
  };

  test('unreadable formulas are marked where they stood and the capture says so', () => {
    const out = run(hackerRankDoc());
    assert.ok(out.envelope, 'nothing captured');
    assert.equal(countUnreadableFormulas(out.envelope.payload.problemStatement), 7);
    assert.match(out.envelope.payload.problemStatement, /dimension \[formula not captured\] and a positive integer/);
    assert.match(out.dom, /^FORMULAS: /m);
  });

  test('a formula with TeX source arrives as text, with no note', () => {
    const doc = parseHtml(
      '<body><div class="challenge-body-html"><p>Constraints</p><p>' +
        '<span class="MathJax_SVG" id="MathJax-Element-1-Frame"><svg><path d="M0 0"></path></svg></span>' +
        '<script type="math/tex" id="MathJax-Element-1">1 \\le T \\le 50</script></p></div></body>',
      { title: 'TeX | HackerRank', url: HACKERRANK_URL },
    );
    const out = run(doc);
    assert.match(out.envelope.payload.problemStatement, /\$1 \\le T \\le 50\$/);
    assert.doesNotMatch(out.dom, /^FORMULAS:/m);
    // The source <script> is read for the formula, not kept as text after it.
    assert.equal(out.envelope.payload.problemStatement.split('1 \\le T \\le 50').length - 1, 1);
    assert.equal(out.envelope.payload.constraints.split('1 \\le T \\le 50').length - 1, 1);
  });

  test('scripts and styles inside the statement are not read as text', () => {
    const doc = parseHtml(
      '<body><div class="challenge-body-html"><p>Rotate the matrix.</p>' +
        '<script>window.hr = {track: true};</script><style>.x { color: red; }</style></div></body>',
      { title: 'Script | HackerRank', url: HACKERRANK_URL },
    );
    const statement = run(doc).envelope.payload.problemStatement;
    assert.match(statement, /Rotate the matrix\./);
    assert.doesNotMatch(statement, /window\.hr|color: red/);
  });

  test('the live page is not changed', () => {
    const doc = hackerRankDoc();
    run(doc);
    assert.equal(doc.querySelectorAll('.MathJax_SVG').length, 7);
  });
});

// LeetCode writes exponents and indices as HTML <sup>/<sub>, not as a formula.
// Their textContent runs the parts together, so "10<sup>4</sup>" read "104" and
// "-10<sup>9</sup>" read "-109": the bounds the model sees were wrong (seen on
// https://leetcode.com/problems/two-sum/ on 2026-10-26, both capture paths).
describe('HTML superscripts and subscripts', () => {
  const LEETCODE_URL = 'https://leetcode.com/problems/two-sum/description/';
  const leetCodeDoc = () =>
    parseHtml(
      '<body><div data-track-load="description_content" class="elfjS"><p>Given an array of integers nums.</p>' +
        '<p><strong>Constraints:</strong></p><ul>' +
        '<li><code>2 &lt;= nums.length &lt;= 10<sup>4</sup></code></li>' +
        '<li><code>-10<sup>9</sup> &lt;= nums[i] &lt;= 10<sup>9</sup></code></li>' +
        '<li><code>2<sup>n - 1</sup></code> and <code>a<sub>i</sub></code></li>' +
        '</ul></div></body>',
      { title: 'Two Sum - LeetCode', url: LEETCODE_URL },
    );

  test('manual capture keeps the exponent', () => {
    const r = extractPageContent({ document: leetCodeDoc(), readabilityFactory: fakeReadability });
    assert.match(r.text, /2 <= nums\.length <= 10\^4/);
    assert.match(r.text, /-10\^9 <= nums\[i\] <= 10\^9/);
    assert.match(r.text, /2\^\(n - 1\)/);
    assert.match(r.text, /a_i/);
    // CODE ON PAGE reads the same <code> snippets; no copy may say 104 or -109.
    assert.doesNotMatch(r.text, /<= 104\b|-109\b/);
    assert.equal(r.unreadableFormulas, 0);
    assert.doesNotMatch(r.text, /FORMULAS:/);
  });

  test('automatic capture keeps the exponent', () => {
    const doc = leetCodeDoc();
    const host = 'leetcode.com';
    const candidate = cls.classifyTab({
      registry: reg.DEFAULT_REGISTRY, host, url: LEETCODE_URL, title: doc.title,
      signals: { codeEditorPresent: true, ioConstraintSignals: true },
    });
    const out = ext.runExtractor({
      document: doc, getSelection: () => '', contextId: 'ctx-sup', capturedAt: 1,
      candidate, platform: reg.findPlatform(reg.DEFAULT_REGISTRY, host, LEETCODE_URL), captureMode: 'auto',
    });
    assert.match(out.envelope.payload.problemStatement, /nums\.length <= 10\^4/);
    assert.match(out.envelope.payload.problemStatement, /-10\^9 <= nums\[i\] <= 10\^9/);
    assert.doesNotMatch(out.dom, /^FORMULAS:/m);
  });

  test('footnotes, ordinals and marks are left as they are, and nothing is counted', () => {
    const doc = parseHtml(
      '<body><p>Founded on the 1<sup>st</sup> of May<sup><a href="#n1">[1]</a></sup>, Acme<sup>TM</sup> grew.<sup>[2]</sup></p></body>',
    );
    assert.deepEqual(inlineFormulas(doc), { found: 0, unreadable: 0 });
    assert.equal(doc.body.textContent, 'Founded on the 1st of May[1], AcmeTM grew.[2]');
  });
});
