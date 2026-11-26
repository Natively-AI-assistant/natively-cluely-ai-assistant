// natively-browser/src/__tests__/run-result.test.mjs
//
// Issue #646: after Run Code on HackerRank, Ctrl+Y must carry the result the
// page shows (status, compiler message, the run's input, the program's output,
// the expected output, stderr) as labelled fields next to the code and the
// problem, so the model can debug the real failure.
//
// The markup below is HackerRank's result panel as its shipped bundle builds
// it (hrcdn.net fcore chunks 496 and 4955, read 2026-11-26): the
// `.code-compile-test-view` card, the `.compile-error-wrapper` status line,
// the `.testcases-result-wrapper` tabs, and one `.run-time-message` per field.
//
// Run: npm run build:test && node --test src/__tests__/run-result.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHtml } from './fake-html.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../dist-test', p)).href;
const { extractPageContent } = await import(dist('extract.js'));
const { readRunResult, RUN_RESULT_MAX_CHARS } = await import(dist('capture/run-result.js'));
const ext = await import(dist('capture/extractors/index.js'));
const reg = await import(dist('capture/registry/registry.js'));

const URL_HR = 'https://www.hackerrank.com/challenges/matrix-rotation-algo/problem?isFullScreen=true';
const TITLE = 'Matrix Layer Rotation | HackerRank';

const STATEMENT = `<div class="challenge-body-html"><div class="problem-statement">
<p>You are given a 2D matrix of dimension m x n and a positive integer r. You have to rotate the matrix r times and print the resultant matrix.</p>
<p><strong>Constraints</strong></p><p>2 &lt;= m, n &lt;= 300</p>
<p><strong>Sample Input</strong></p><pre>4 4 2
1 2 3 4</pre>
<p><strong>Sample Output</strong></p><pre>3 4 8 12</pre>
</div></div>`;

const EDITOR = `<div class="monaco-editor" data-mode-id="java"><div class="view-lines">
<div class="view-line">public static void matrixRotation(List&lt;List&lt;Integer&gt;&gt; matrix, int r) {</div>
<div class="view-line">    System.out.println(0);</div>
<div class="view-line">}</div></div></div>`;

/** One `.run-time-message` field, as renderRunTimeSingleMessage draws it. */
function field(cls, label, value, { links = '', lineNumbers = false } = {}) {
  const shown = lineNumbers
    ? `<ul class="lines-container">${value
        .split('\n')
        .map((l) => `<li class="d-flex lines-container__line"><span class="lines-container__content-wrapper"><pre class="lines-container__content">${l}</pre></span></li>`)
        .join('')}</ul>`
    : `<div class="d-flex compiler-message"><div class="compiler-message__message-wrapper"><pre class="compiler-message__value"><code>${value}</code></pre></div></div>`;
  return `<div class="${cls} run-time-message flex-display"><div class="d-flex compile-field-label">${label}<span class="compile-field-label__links">${links}</span> </div><div class="compile-output-message">${shown}</div></div>`;
}

function tab(title, color, selected) {
  return `<div role="tab" aria-selected="${selected}"><div class="d-flex testcase-tab-item tab-item-color-${color} testcase-item"><span class="ui-icon-label tab-item-label">${title}</span></div></div>`;
}

function resultCard({ status, advice, tabs = '', fields = '', extra = '' }) {
  return `<div class="code-compile-test-view theme-m-content">
<div class="compile-error-wrapper"><p class="status compile-error">${status}</p><p class="compile-advice">${advice}</p></div>
${extra}
<section class="testcases-result-wrapper theme-m"><div role="tablist">${tabs}</div>
<div class="tab-content d-flex"><div class="tab-pane-content"><div id="testcases-result__id" class="d-flex flex-column flex-wrap compilation-time-response">${fields}</div></div></div></section>
</div>`;
}

const WRONG_ANSWER = resultCard({
  status: 'Wrong Answer :(',
  advice: '1/2 test cases failed',
  tabs: tab('Sample Test case 0', 'error', true) + tab('Sample Test case 1', 'success', false),
  fields:
    field('compile-message', 'Compiler Message', 'Wrong Answer') +
    field('stdin', 'Input (stdin)', '4 4 2\n1 2 3 4\n5 6 7 8', {
      links: '<a>Run as Custom Input</a><span class="divider">|</span><a>Download</a>',
    }) +
    field('stdout', 'Your Output (stdout)', '0') +
    field('expected-output', 'Expected Output', '3 4 8 12\n2 11 10 16', { links: '<a>Download</a>' }),
});

const COMPILE_ERROR = `<div class="code-compile-test-view theme-m-content">
<div class="compile-error-wrapper"><p class="status compile-error">Compilation error :(</p><p class="compile-advice">Check the compiler output, fix the error and try again.</p></div>
<div class="compile-time-response"><div class="compile-time full-width">
<div class="compile-message"><p class="compile-field-label">Compile Message</p><pre class="compile-output-message compile-message"><code class="bold">Solution.java:12: error: ';' expected
        int x = 1
                 ^
1 error</code></pre></div>
<div class="exit-status"><p class="compile-field-label">Exit Status</p><pre class="compile-output-message compile-message"><code class="bold">1</code></pre></div>
</div></div></div>`;

const RUNTIME_ERROR = resultCard({
  status: 'Runtime Error :(',
  advice: '',
  tabs: tab('Sample Test case 0', 'error', true),
  fields:
    field('compile-message', 'Compiler Message', 'Runtime Error') +
    field(
      'stderr',
      'Error (stderr)',
      'Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index 4 out of bounds for length 4\n\tat Result.matrixRotation(Solution.java:31)\n\tat Solution.main(Solution.java:58)',
      { lineNumbers: true },
    ) +
    field('stdin', 'Input (stdin)', '4 4 2\n1 2 3 4', { lineNumbers: true }),
});

const page = (card, { before = '' } = {}) =>
  parseHtml(`<body>${before}${STATEMENT}${EDITOR}${card}</body>`, { title: TITLE, url: URL_HR });

/** The RUN RESULT block of a capture, up to the next front-matter section. */
function runBlock(text) {
  const start = text.indexOf('RUN RESULT');
  assert.ok(start >= 0, `no RUN RESULT in:\n${text.slice(0, 1500)}`);
  const rest = text.slice(start);
  const end = rest.search(/\n\n(HEADINGS:|---\n)/);
  return end > 0 ? rest.slice(0, end) : rest;
}

describe('#646 Ctrl+Y carries the HackerRank run result', () => {
  test('wrong answer: input, actual output and expected output are separate labelled fields', () => {
    const r = extractPageContent({ document: page(WRONG_ANSWER) });
    const block = runBlock(r.text);
    assert.match(block, /STATUS: Wrong Answer :\( \(1\/2 test cases failed\)/);
    assert.match(block, /TEST CASES: Sample Test case 0 failed, Sample Test case 1 passed/);
    assert.match(block, /SHOWN: Sample Test case 0 \(failed\)/);
    assert.match(block, /Compiler Message:\nWrong Answer\n/);
    assert.match(block, /Input \(stdin\):\n4 4 2\n1 2 3 4\n5 6 7 8\n/);
    // A single "0" is a real output and must survive.
    assert.match(block, /Your Output \(stdout\):\n0\n/);
    assert.match(block, /Expected Output:\n3 4 8 12\n2 11 10 16/);
    // The label's links are not part of the label.
    assert.doesNotMatch(block, /Run as Custom Input|Download/);
    // Says it is the run's own data, and that the page does not tie it to an edit.
    assert.match(block, /not the problem's samples/);
    assert.match(block, /does not say which version of the code/);
  });

  test('wrong answer: the code, the language and the problem still come with it', () => {
    const r = extractPageContent({ document: page(WRONG_ANSWER) });
    assert.match(r.text, /LANGUAGE: java/);
    const code = r.text.slice(r.text.indexOf('CODE ON PAGE'), r.text.indexOf('RUN RESULT'));
    assert.match(code, /\npublic static void matrixRotation\(List<List<Integer>> matrix, int r\) \{\n {4}System\.out\.println\(0\);/);
    assert.match(r.text, /rotate the matrix r times/);
    assert.match(r.text, /Constraints/);
  });

  test('the result panel is not copied into CODE ON PAGE', () => {
    const r = extractPageContent({ document: page(WRONG_ANSWER) });
    const code = r.text.slice(r.text.indexOf('CODE ON PAGE'), r.text.indexOf('RUN RESULT'));
    assert.doesNotMatch(code, /2 11 10 16|5 6 7 8|Wrong Answer/);
  });

  test('compilation error: the compiler output keeps its line breaks and line number', () => {
    const r = extractPageContent({ document: page(COMPILE_ERROR) });
    const block = runBlock(r.text);
    assert.match(block, /STATUS: Compilation error :\( \(Check the compiler output, fix the error and try again\.\)/);
    assert.match(block, /Compile Message:\nSolution\.java:12: error: ';' expected\n {8}int x = 1\n {17}\^\n1 error\n/);
    assert.match(block, /Exit Status:\n1/);
    assert.match(r.text, /public static void matrixRotation/);
  });

  test('runtime error: the stack trace and the test input, one line per line', () => {
    const r = extractPageContent({ document: page(RUNTIME_ERROR) });
    const block = runBlock(r.text);
    assert.match(block, /STATUS: Runtime Error :\(\n/);
    assert.match(
      block,
      /Error \(stderr\):\nException in thread "main" java\.lang\.ArrayIndexOutOfBoundsException: Index 4 out of bounds for length 4\n\tat Result\.matrixRotation\(Solution\.java:31\)\n\tat Solution\.main\(Solution\.java:58\)\n/,
    );
    assert.match(block, /Input \(stdin\):\n4 4 2\n1 2 3 4/);
    assert.doesNotMatch(block, /^- /m);
  });

  test('a long problem statement does not push out a short result', () => {
    const essay = `<div class="problem-statement"><p>${'Rotate the layers of the matrix anticlockwise. '.repeat(600)}</p></div>`;
    const r = extractPageContent({ document: page(WRONG_ANSWER, { before: essay }) });
    assert.ok(r.text.length <= 25000);
    const block = runBlock(r.text);
    assert.match(block, /Your Output \(stdout\):\n0\n/);
    assert.match(block, /Expected Output:\n3 4 8 12/);
  });

  test('a highlighted selection keeps the result with it', () => {
    const sel = 'You have to rotate the matrix r times and print the resultant matrix.';
    const r = extractPageContent({ document: page(WRONG_ANSWER), getSelection: () => sel });
    assert.equal(r.source, 'selection');
    assert.match(runBlock(r.text), /Your Output \(stdout\):\n0\n/);
  });

  test('a hidden test case says its details are withheld', () => {
    const card = resultCard({
      status: 'Wrong Answer :(',
      advice: '1/3 test cases failed',
      tabs: tab('Test case 2', 'error', true),
      fields: '',
    }).replace(
      '<div class="tab-pane-content">',
      '<div class="tab-pane-content"><section class="hidden-testcase-wrapper"><div class="hidden-testcase-wrapper__content"><header class="ui-icon-label">Hidden Test Case</header><p class="hidden-testcase-wrapper__content__help-text">Use print or log statements to debug.</p></div></section>',
    );
    const block = runBlock(extractPageContent({ document: page(card) }).text);
    assert.match(block, /SHOWN: Test case 2 \(failed\)/);
    assert.match(block, /HackerRank hides this test case's input and expected output/);
  });

  test('output HackerRank cut short, and output too long to send, are both marked', () => {
    const long = Array.from({ length: 400 }, (_, i) => `line ${i} of the output`).join('\n');
    const card = resultCard({
      status: 'Wrong Answer :(',
      advice: '1/1 test case failed',
      tabs: tab('Sample Test case 0', 'error', true),
      fields: field('stdin', 'Input (stdin)', '1 2 3{-truncated-}') + field('stdout', 'Your Output (stdout)', long),
    });
    const block = runBlock(extractPageContent({ document: page(card) }).text);
    assert.match(block, /Input \(stdin\):\n1 2 3\{-truncated-\}\n\(HackerRank cut this short on the page; the rest is only in its Download link\.\)/);
    assert.match(block, /line 0 of the output/);
    assert.match(block, /…\(\d+ more characters of this field not captured\)/);
    assert.ok(block.length <= RUN_RESULT_MAX_CHARS + 200);
  });

  test('a run still in progress is flagged', () => {
    const card = `<div class="code-compile-test-view theme-m-content"><div class="tc-live-status d-flex"><div class="d-flex testcase-tab-item tab-item-color-info testcase-item"><span class="ui-icon-label tab-item-label">Test case 0</span></div></div></div>`;
    const block = runBlock(extractPageContent({ document: page(card) }).text);
    assert.match(block, /still running/);
  });

  test('no result panel → no RUN RESULT, the capture is as before', () => {
    const r = extractPageContent({ document: page('') });
    assert.doesNotMatch(r.text, /RUN RESULT/);
    assert.match(r.text, /CODE ON PAGE/);
  });

  test('another site with the same class names is not read as HackerRank', () => {
    const doc = parseHtml(`<body>${STATEMENT}${WRONG_ANSWER}</body>`, { title: 'x', url: 'https://example.com/post' });
    assert.equal(readRunResult(doc, 'example.com', 'https://example.com/post'), '');
  });
});

// LeetCode's result panel as its bundle builds it (leetcode.com _next chunk
// 00rr3b16oc2yw, read 2026-11-26): the panel div, the status heading three
// levels down with data-e2e-locator="console-result", then a label line and a
// `whitespace-pre-wrap` value for each part. Not checked against a live Run:
// the Chrome profile was not logged in to LeetCode.
const URL_LC = 'https://leetcode.com/problems/two-sum/description/';
const LC_EDITOR = `<div class="monaco-editor" data-mode-id="cpp"><div class="view-lines">
<div class="view-line">class Solution {</div><div class="view-line">public:</div>
<div class="view-line">    vector&lt;int&gt; twoSum(vector&lt;int&gt;&amp; nums, int target) {</div>
<div class="view-line">        return {};</div><div class="view-line">    }</div><div class="view-line">};</div></div></div>`;

function lcPanel(status, inner) {
  return `<div class="mx-5 my-4 space-y-4"><div class="flex items-center justify-between gap-2"><div class="flex items-center gap-1">
<span class="mr-2 whitespace-nowrap text-xl font-medium text-red-s" data-e2e-locator="console-result">${status}</span>
<div class="text-xs text-label-3">Runtime: 0 ms</div></div>
<button class="rounded-lg"><svg></svg>Analyze Complexity</button></div>${inner}</div>`;
}
const lcValue = (label, value, param = '') =>
  `<div class="flex h-full w-full flex-col space-y-2"><div class="flex text-xs font-medium">${label}</div>
<div class="rounded-lg"><div class="relative py-3">${param ? `<div class="mx-3 mb-2 text-xs">${param} =</div>` : ''}
<div class="font-menlo mx-3 whitespace-pre-wrap break-all leading-5">${value}</div>
<button class="absolute right-0 top-0"><svg></svg></button></div></div></div>`;

const LC_WRONG = lcPanel(
  'Wrong Answer',
  `<div class="space-y-4"><div class="relative"><div><div class="mb-2 text-xs font-medium">Input</div><div class="space-y-2">
${lcValue('', '[2,7,11,15]', 'nums')}${lcValue('', '9', 'target')}</div></div>
<div class="absolute flex flex-row -top-1 right-0"><button>Use Testcase</button></div></div>
${lcValue('Stdout', 'checking 2\nchecking 7')}${lcValue('Output', '[]')}${lcValue('Expected', '[0,1]')}</div>`,
);
const LC_COMPILE = lcPanel(
  'Compile Error',
  `<div class="group relative rounded-lg bg-red"><div class="whitespace-pre-wrap break-all font-menlo text-xs">Line 4: Char 18: error: expected ';' after return statement
    4 |         return {}
      |                  ^
      |                  ;
1 error generated.</div><button>Copy</button></div>`,
);

const lcPage = (card) =>
  parseHtml(`<body><div class="elfjS"><p>Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.</p></div>${LC_EDITOR}${card}</body>`, {
    title: 'Two Sum - LeetCode',
    url: URL_LC,
  });

describe('#646 Ctrl+Y carries the LeetCode run result', () => {
  test('wrong answer: status, input, stdout, output and expected in page order', () => {
    const block = runBlock(extractPageContent({ document: lcPage(LC_WRONG) }).text);
    assert.match(block, /^RUN RESULT \(LeetCode, the result panel for the last Run: the run's own test data/);
    assert.match(block, /\nSTATUS: Wrong Answer\nRuntime: 0 ms\n/);
    assert.match(block, /\nInput\nnums =\n\[2,7,11,15\]\ntarget =\n9\n/);
    assert.match(block, /\nStdout\nchecking 2\nchecking 7\nOutput\n\[\]\nExpected\n\[0,1\]$/);
    // Buttons are not part of the result.
    assert.doesNotMatch(block, /Analyze Complexity|Use Testcase/);
    // The status is said once.
    assert.equal(block.match(/Wrong Answer/g).length, 1);
  });

  test('compile error: the compiler output keeps its line breaks and caret', () => {
    const r = extractPageContent({ document: lcPage(LC_COMPILE) });
    const block = runBlock(r.text);
    assert.match(block, /STATUS: Compile Error\n/);
    assert.match(
      block,
      /Line 4: Char 18: error: expected ';' after return statement\n {4}4 \| {9}return \{\}\n {6}\| {18}\^\n {6}\| {18};\n1 error generated\./,
    );
    assert.doesNotMatch(block, /Copy/);
    assert.match(r.text, /LANGUAGE: cpp/);
    assert.match(r.text, /vector<int> twoSum/);
  });

  test('a long LeetCode value is cut with a marker', () => {
    const big = `[${Array.from({ length: 2000 }, (_, i) => i).join(',')}]`;
    const block = runBlock(extractPageContent({ document: lcPage(lcPanel('Wrong Answer', lcValue('Output', big))) }).text);
    assert.match(block, /…\(\d+ more characters of this field not captured\)/);
    assert.ok(block.length <= RUN_RESULT_MAX_CHARS + 200);
  });

  test('the same locator on another site is not read', () => {
    const doc = parseHtml(`<body>${LC_WRONG}</body>`, { title: 'x', url: 'https://example.com/a' });
    assert.equal(readRunResult(doc, 'example.com', 'https://example.com/a'), '');
  });

  test('no LeetCode result panel → no RUN RESULT', () => {
    assert.doesNotMatch(extractPageContent({ document: lcPage('') }).text, /RUN RESULT/);
  });
});

describe('#646 the auto capture carries the run result too', () => {
  test('codingProblem extractor: RUN RESULT in the dom, language in the payload', () => {
    const doc = page(WRONG_ANSWER);
    const platform = reg.findPlatform(reg.DEFAULT_REGISTRY, 'www.hackerrank.com', URL_HR);
    const out = ext.runExtractor({
      document: doc,
      contextId: 'c1',
      capturedAt: 1,
      captureMode: 'auto',
      platform,
      candidate: {
        tabId: -1,
        host: 'www.hackerrank.com',
        url: URL_HR,
        matchedCategory: 'coding_problem',
        matchedPlatform: 'hackerrank',
        confidenceScore: 95,
        autoPolicy: 'auto',
        lastSeenAt: 0,
        reasons: [],
      },
    });
    assert.match(runBlock(out.dom), /Your Output \(stdout\):\n0\n/);
    assert.equal(out.envelope.payload.language, 'java');
    // The desktop puts the payload's copy in its RUN_RESULT section, inside its budget.
    assert.match(out.envelope.payload.runResult, /^RUN RESULT \(HackerRank/);
    assert.match(out.envelope.payload.runResult, /Your Output \(stdout\):\n0\n/);
    // The result panel is not the problem's examples.
    assert.doesNotMatch(out.envelope.payload.examples || '', /2 11 10 16/);
  });
});
