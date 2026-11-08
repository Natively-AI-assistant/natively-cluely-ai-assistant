// natively-browser/src/__tests__/block-text.test.mjs
//
// Text read from a DETACHED clone keeps its block boundaries. Chrome's
// innerText on a clone is its textContent (no layout), so the automatic
// capture read Codeforces as "A. Primary Tasktime limit per test1 second…",
// HackerRank's constraints ran into "Sample Input", and Codeforces' EXAMPLES
// repeated the whole statement (seen live on 2026-10-30). Real markup via
// fake-html.mjs, so childNodes/nodeType are the ones blockText walks.
//
// Run (from natively-browser/): npm test

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHtml } from './fake-html.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (f) => pathToFileURL(path.resolve(__dirname, '../../dist-test', f)).href;
const { blockText, bodyInnerText } = await import(dist('capture/extractors/dom-helpers.js'));
const { extractPageContent } = await import(dist('extract.js'));
const ext = await import(dist('capture/extractors/index.js'));
const reg = await import(dist('capture/registry/registry.js'));
const cls = await import(dist('capture/classifier/tab-classifier.js'));

const body = (html) => parseHtml(`<body>${html}</body>`).body;

describe('blockText', () => {
  test('paragraphs are set apart by a blank line, divs and list items by a line break', () => {
    assert.equal(
      blockText(body('<p>One</p><p>Two</p><div>a</div><div>b</div><ul><li>x</li><li>y</li></ul><p>End</p>')),
      'One\n\nTwo\n\na\nb\n\n- x\n- y\n\nEnd',
    );
  });

  test('nested blocks make one break, not one per level', () => {
    assert.equal(blockText(body('<div><div><div>a</div></div></div><div><div>b</div></div>')), 'a\nb');
  });

  test('source line breaks are spaces outside <pre>, kept inside it', () => {
    assert.equal(
      blockText(body('<p>instead of the integer\n    $10^5$, he would</p><pre>4 4 2\n1 2 3 4\n</pre><p>after</p>')),
      'instead of the integer $10^5$, he would\n\n4 4 2\n1 2 3 4\n\nafter',
    );
  });

  test('<br> breaks the line, table cells keep a gap, script and svg are not text', () => {
    assert.equal(
      blockText(body('<p>a<br>b</p><table><tr><td>N</td><td>10^5</td></tr></table><script>x()</script><svg><text>t</text></svg>')),
      'a\nb\n\nN 10^5',
    );
  });

  test('bodyInnerText reads a real clone block by block', () => {
    const doc = parseHtml('<body><div>A. Primary Task</div><div>time limit per test</div><p>Statement</p></body>');
    assert.equal(bodyInnerText(doc), 'A. Primary Task\ntime limit per test\n\nStatement');
  });
});

const CODEFORCES_URL = 'https://codeforces.com/problemset/problem/2000/A';
const CODEFORCES = `<body><div class="problem-statement">
  <div class="header">
    <div class="title">A. Primary Task</div>
    <div class="time-limit"><div class="property-title">time limit per test</div>1 second</div>
    <div class="memory-limit"><div class="property-title">memory limit per test</div>256 megabytes</div>
    <div class="input-file"><div class="property-title">input</div>standard input</div>
    <div class="output-file"><div class="property-title">output</div>standard output</div>
  </div>
  <div><p>Dmitry wrote down $t$ integers on the board.</p>
  <p>For example, instead of the integer
  $10^5$, he would have written $105$.</p></div>
  <div class="input-specification"><div class="section-title">Input</div><p>The first line contains one integer $t$.</p></div>
  <div class="output-specification"><div class="section-title">Output</div><p>For each integer, output "YES" or "NO".</p></div>
  <div class="sample-tests"><div class="section-title">Example</div>
    <div class="sample-test"><div class="input"><div class="title">Input</div><pre>
<div class="test-example-line">3</div><div class="test-example-line">100</div><div class="test-example-line">1010</div></pre></div>
    <div class="output"><div class="title">Output</div><pre>
NO
YES
NO
</pre></div></div></div>
</div></body>`;

const HACKERRANK_URL = 'https://www.hackerrank.com/challenges/matrix-rotation-algo/problem';
const HACKERRANK = `<body><div class="challenge-body-html">
<div class="challenge_problem_statement"><p>You are given a 2D matrix of dimension $m \\times n$.</p></div>
<div class="challenge_constraints"><strong>Constraints</strong>
<div class="challenge_constraints_body"><p>$2 \\le m, n \\le 300$<br>$1 \\le r \\le 10^9$</p></div></div>
<div class="challenge_sample_input"><strong>Sample Input</strong><pre>4 4 2
1 2 3 4</pre></div>
</div></body>`;

/** The automatic capture's payload for `html` at `url`, as the content script builds it. */
function autoCapture(html, url, title) {
  const doc = parseHtml(html, { title, url });
  const host = new URL(url).hostname.replace(/^www\./, '');
  const candidate = cls.classifyTab({
    registry: reg.DEFAULT_REGISTRY, host, url, title,
    signals: { codeEditorPresent: true, ioConstraintSignals: true },
  });
  return ext.runExtractor({
    document: doc, getSelection: () => '', contextId: 'ctx-blocks', capturedAt: 1,
    candidate, platform: reg.findPlatform(reg.DEFAULT_REGISTRY, host, url), captureMode: 'auto',
  });
}

describe('automatic capture keeps block boundaries', () => {
  test('Codeforces: the header rows are lines, and EXAMPLES is the sample test', () => {
    const out = autoCapture(CODEFORCES, CODEFORCES_URL, 'Problem - 2000A - Codeforces');
    const p = out.envelope.payload;
    assert.match(p.problemStatement, /^A\. Primary Task\ntime limit per test\n1 second\nmemory limit per test\n/);
    assert.doesNotMatch(p.problemStatement, /Tasktime|second memory|inputstandard/);
    assert.match(p.problemStatement, /instead of the integer \$10\^5\$, he would/);
    // "Example" is the heading, not the "input / standard input" header row.
    assert.equal(p.examples, 'Example\nInput\n3\n100\n1010\nOutput\nNO\nYES\nNO');
  });

  test('HackerRank: CONSTRAINTS stops before the sample input', () => {
    const out = autoCapture(HACKERRANK, HACKERRANK_URL, 'Matrix Layer Rotation | HackerRank');
    assert.equal(out.envelope.payload.constraints, 'Constraints\n\n$2 \\le m, n \\le 300$\n$1 \\le r \\le 10^9$');
    assert.match(out.dom, /^CONSTRAINTS:\nConstraints\n\n\$2 \\le m, n \\le 300\$\n\$1 \\le r \\le 10\^9\$$/m);
  });
});

describe('manual capture keeps block boundaries', () => {
  test('Codeforces: one line per header row and per sample line, no blank line between them', () => {
    const doc = parseHtml(CODEFORCES, { title: 'Problem - 2000A - Codeforces', url: CODEFORCES_URL });
    const r = extractPageContent({ document: doc, readabilityFactory: () => ({ parse: () => null }) });
    assert.match(r.text, /A\. Primary Task\ntime limit per test\n1 second\n/);
    assert.match(r.text, /Example\nInput\n3\n100\n1010\nOutput\nNO\nYES\nNO/);
  });
});

describe('manual capture keeps block boundaries without Readability', () => {
  test('the body fallback reads line by line', () => {
    const doc = parseHtml('<body><div><div>A. Primary Task</div><div>time limit per test</div></div><p>The statement.</p></body>');
    const r = extractPageContent({ document: doc, readabilityFactory: () => ({ parse: () => null }) });
    assert.match(r.text, /A\. Primary Task\ntime limit per test\n\nThe statement\./);
  });
});
