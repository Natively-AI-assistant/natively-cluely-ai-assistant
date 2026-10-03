// natively-browser/src/__tests__/dom-helpers.test.mjs
//
// Unit tests for capture/extractors/dom-helpers.ts — the shared pure DOM helpers
// the Smart Browser Context extractors are built from. Imports the compiled
// module from dist-test/ (built by esbuild.test.mjs).
//
// There is no jsdom here: the helpers are dependency-injected on a document, so
// the tests hand them a small fake DOM implementing only the surface they touch.
//
// Run (from natively-browser/): npm run build:test && node --test src/__tests__/dom-helpers.test.mjs
// (or just: npm test)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/capture/extractors/dom-helpers.js');
const {
  collapseWhitespace,
  firstText,
  allText,
  extractEditorCode,
  extractPreBlocks,
  sliceSection,
  bodyInnerText,
  readEmbeddedJson,
} = await import(pathToFileURL(modPath).href);

// ---- Minimal fake DOM -------------------------------------------------------
// Surface implemented: textContent (own text + descendants), value, innerText
// (only when given), parentNode, removeChild, cloneNode(deep), querySelector,
// querySelectorAll (returns an array: forEach / length / iterable — all the
// helpers use), and getElementById on the document.
//
// Selector support is the subset the helpers use: comma lists, the descendant
// combinator, and compound `tag`, `.class`, `#id`. Anything else throws a
// SyntaxError, like a real engine does for a selector it cannot parse — which is
// what the helpers' try/catch guards exist for.

function parseCompound(part) {
  if (!/^(?:[a-zA-Z][\w-]*)?(?:[.#][\w-]+)*$/.test(part) || part === '') {
    throw new SyntaxError(`'${part}' is not a valid selector`);
  }
  const tag = (part.match(/^[a-zA-Z][\w-]*/) || [''])[0].toUpperCase();
  const classes = [...part.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const id = (part.match(/#([\w-]+)/) || [])[1];
  return (node) =>
    (!tag || node.tagName === tag) &&
    classes.every((c) => node.classList.includes(c)) &&
    (id === undefined || node.id === id);
}

function parseSelector(selector) {
  return String(selector).split(',').map((alt) => alt.trim().split(/\s+/).map(parseCompound));
}

function matchesChain(node, chain) {
  if (!chain[chain.length - 1](node)) return false;
  let i = chain.length - 2;
  for (let p = node.parentNode; p && i >= 0; p = p.parentNode) {
    if (p.tagName && chain[i](p)) i--;
  }
  return i < 0;
}

function queryAll(root, selector) {
  const alternatives = parseSelector(selector);
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (alternatives.some((chain) => matchesChain(child, chain))) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/**
 * el('div', { class: 'a b', id: 'x', text: 'own text', value, innerText }, [children])
 */
function el(tag, attrs = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(),
    id: attrs.id,
    classList: (attrs.class || '').split(/\s+/).filter(Boolean),
    ownText: attrs.text ?? '',
    children: [...children],
    parentNode: null,
    get textContent() {
      return this.ownText + this.children.map((c) => c.textContent).join('');
    },
    querySelectorAll(selector) {
      return queryAll(this, selector);
    },
    querySelector(selector) {
      return queryAll(this, selector)[0] ?? null;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    cloneNode(deep) {
      return el(tag, attrs, deep ? this.children.map((c) => c.cloneNode(true)) : []);
    },
  };
  if ('value' in attrs) node.value = attrs.value;
  if ('innerText' in attrs) node.innerText = attrs.innerText;
  for (const c of node.children) c.parentNode = node;
  return node;
}

/** A document: a root with the given body children. `body: null` → no body. */
function makeDoc(bodyChildren = [], { body, withGetElementById = true } = {}) {
  const bodyEl = body === undefined ? el('body', {}, bodyChildren) : body;
  const root = el('html', {}, bodyEl ? [bodyEl] : []);
  const doc = {
    body: bodyEl,
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
  };
  if (withGetElementById) {
    doc.getElementById = (id) => root.querySelector(`#${id}`);
  }
  return doc;
}

/** A document on which every query throws (hostile / broken shim). */
const throwingDoc = () => ({
  body: null,
  querySelector() { throw new Error('boom'); },
  querySelectorAll() { throw new Error('boom'); },
  getElementById() { throw new Error('boom'); },
});

const lines = (cls, ...texts) => texts.map((t) => el('div', { class: cls, text: t }));

// The fake DOM itself is load-bearing, so pin the two behaviours tests rely on.
describe('fake DOM self-check', () => {
  test('descendant and comma selectors match in document order', () => {
    const doc = makeDoc([
      el('div', { class: 'a' }, [el('span', { class: 'b', text: '1' })]),
      el('span', { class: 'b', text: '2' }),
    ]);
    assert.deepEqual(doc.querySelectorAll('.a .b').map((n) => n.textContent), ['1']);
    assert.deepEqual(doc.querySelectorAll('.b, .a').map((n) => n.textContent), ['1', '1', '2']);
  });

  test('an unparseable selector throws', () => {
    assert.throws(() => makeDoc().querySelectorAll('div[unclosed'), SyntaxError);
  });
});

describe('collapseWhitespace', () => {
  test('empty and whitespace-only input collapse to the empty string', () => {
    assert.equal(collapseWhitespace(''), '');
    assert.equal(collapseWhitespace(' \t\n\r\n  '), '');
  });

  test('runs of spaces and tabs become one space', () => {
    assert.equal(collapseWhitespace('a   b\t\tc \t d'), 'a b c d');
  });

  test('form feeds and vertical tabs count as horizontal whitespace', () => {
    assert.equal(collapseWhitespace('a\f\vb'), 'a b');
  });

  test('CRLF and lone CR are normalised to LF', () => {
    assert.equal(collapseWhitespace('a\r\nb\rc'), 'a\nb\nc');
  });

  test('a single newline is kept', () => {
    assert.equal(collapseWhitespace('line one\nline two'), 'line one\nline two');
  });

  test('a paragraph break (blank line) is preserved', () => {
    assert.equal(collapseWhitespace('para one\n\npara two'), 'para one\n\npara two');
  });

  test('three or more newlines collapse to a single paragraph break', () => {
    assert.equal(collapseWhitespace('a\n\n\nb'), 'a\n\nb');
    assert.equal(collapseWhitespace('a\n\n\n\n\n\nb'), 'a\n\nb');
  });

  test('indentation after a newline is removed', () => {
    assert.equal(collapseWhitespace('a\n    b\n\t\tc'), 'a\nb\nc');
  });

  test('whitespace-only lines do not survive as extra blank lines', () => {
    assert.equal(collapseWhitespace('a\n   \n   \n   \nb'), 'a\n\nb');
  });

  test('leading and trailing whitespace is trimmed', () => {
    assert.equal(collapseWhitespace('\n\n  hello world  \n\n'), 'hello world');
  });

  test('already-clean text is returned unchanged', () => {
    assert.equal(collapseWhitespace('Two Sum'), 'Two Sum');
  });
});

describe('firstText', () => {
  const doc = makeDoc([
    el('h1', { class: 'title', text: '  Two   Sum \n' }),
    el('h1', { class: 'title', text: 'Second title' }),
    el('div', { class: 'blank', text: '   \n ' }),
    el('div', { class: 'desc' }, [el('p', { text: 'Given an array' }), el('p', { text: ' of integers' })]),
  ]);

  test('returns the trimmed, whitespace-collapsed text of the first match', () => {
    assert.equal(firstText(doc, ['.title']), 'Two Sum');
  });

  test('includes descendant text', () => {
    assert.equal(firstText(doc, ['.desc']), 'Given an array of integers');
  });

  test('tries selectors in order and skips ones that match nothing', () => {
    assert.equal(firstText(doc, ['.missing', '.desc', '.title']), 'Given an array of integers');
  });

  test('skips a match whose text is only whitespace', () => {
    assert.equal(firstText(doc, ['.blank', '.title']), 'Two Sum');
  });

  test('skips a selector the engine rejects and carries on', () => {
    assert.equal(firstText(doc, ['div[unclosed', '.title']), 'Two Sum');
  });

  test("returns '' when nothing matches", () => {
    assert.equal(firstText(doc, ['.missing', '.also-missing']), '');
  });

  test("returns '' for undefined or empty selector lists", () => {
    assert.equal(firstText(doc, undefined), '');
    assert.equal(firstText(doc, []), '');
  });

  test("returns '' when every query throws", () => {
    assert.equal(firstText(throwingDoc(), ['.title', 'h1']), '');
  });

  test('works on an element as well as a document', () => {
    const scope = el('section', {}, [el('h2', { text: 'Scoped' })]);
    assert.equal(firstText(scope, ['h2']), 'Scoped');
  });
});

describe('allText', () => {
  const doc = makeDoc([
    el('li', { class: 'item', text: ' one ' }),
    el('li', { class: 'item', text: '   ' }),
    el('li', { class: 'item', text: 'two' }),
    el('p', { class: 'other', text: 'other text' }),
  ]);

  test('joins every non-empty match of the selector with newlines', () => {
    assert.equal(allText(doc, ['.item']), 'one\ntwo');
  });

  test('the first selector that yields content wins; later ones are not appended', () => {
    assert.equal(allText(doc, ['.item', '.other']), 'one\ntwo');
    assert.equal(allText(doc, ['.other', '.item']), 'other text');
  });

  test('falls through selectors that match nothing or only blank text', () => {
    const blankDoc = makeDoc([el('i', { class: 'blank', text: '  ' }), el('p', { class: 'other', text: 'found' })]);
    assert.equal(allText(blankDoc, ['.missing', '.blank', '.other']), 'found');
  });

  test('skips a selector the engine rejects', () => {
    assert.equal(allText(doc, ['li[unclosed', '.other']), 'other text');
  });

  test('collapses whitespace inside the joined result', () => {
    const d = makeDoc([el('p', { class: 'x', text: 'a    b\n\n\n\nc' })]);
    assert.equal(allText(d, ['.x']), 'a b\n\nc');
  });

  test('truncates to the cap', () => {
    assert.equal(allText(doc, ['.item'], 5), 'one\nt');
  });

  test('text exactly at the cap is not truncated', () => {
    assert.equal(allText(doc, ['.item'], 7), 'one\ntwo');
  });

  test('default cap is 8000 characters', () => {
    const big = makeDoc([el('p', { class: 'big', text: 'x'.repeat(9000) })]);
    assert.equal(allText(big, ['.big']).length, 8000);
  });

  test("returns '' for undefined / empty selectors, no matches, or a throwing document", () => {
    assert.equal(allText(doc, undefined), '');
    assert.equal(allText(doc, []), '');
    assert.equal(allText(doc, ['.missing']), '');
    assert.equal(allText(throwingDoc(), ['.item']), '');
  });

  test('tolerates a shim whose querySelectorAll returns null', () => {
    assert.equal(allText({ querySelectorAll: () => null }, ['.item']), '');
  });
});

describe('extractEditorCode', () => {
  test("returns '' when the page has no editor", () => {
    assert.equal(extractEditorCode(makeDoc([el('p', { text: 'just prose' })])), '');
  });

  test('Monaco: joins .view-line elements with newlines, once', () => {
    // '.monaco-editor .view-lines, .monaco-editor' matches both the editor root
    // and its lines container — the same code must not be emitted twice.
    const doc = makeDoc([
      el('div', { class: 'monaco-editor' }, [
        el('div', { class: 'view-lines' }, lines('view-line', 'def two_sum(nums, target):', '    return []')),
      ]),
    ]);
    assert.equal(extractEditorCode(doc), 'def two_sum(nums, target):\n    return []');
  });

  test('Monaco: a root with no rendered lines contributes nothing', () => {
    const doc = makeDoc([el('div', { class: 'monaco-editor', text: 'Loading editor…' })]);
    assert.equal(extractEditorCode(doc), '');
  });

  test('CodeMirror 6: joins .cm-line elements', () => {
    const doc = makeDoc([el('div', { class: 'cm-content' }, lines('cm-line', 'const a = 1;', 'const b = 2;'))]);
    assert.equal(extractEditorCode(doc), 'const a = 1;\nconst b = 2;');
  });

  test('CodeMirror 5: joins .CodeMirror-line elements', () => {
    const doc = makeDoc([el('div', { class: 'CodeMirror-code' }, lines('CodeMirror-line', 'x = 1', 'y = 2'))]);
    assert.equal(extractEditorCode(doc), 'x = 1\ny = 2');
  });

  test('CodeMirror: falls back to the container text when there are no line elements', () => {
    const doc = makeDoc([el('div', { class: 'cm-content', text: 'SELECT 1;\nSELECT 2;' })]);
    assert.equal(extractEditorCode(doc), 'SELECT 1;\nSELECT 2;');
  });

  test('Ace: joins .ace_line elements', () => {
    const doc = makeDoc([el('div', { class: 'ace_content' }, lines('ace_line', 'int main() {', '  return 0;', '}'))]);
    assert.equal(extractEditorCode(doc), 'int main() {\n  return 0;\n}');
  });

  test('Ace: falls back to the container text when there are no line elements', () => {
    const doc = makeDoc([el('div', { class: 'ace_content', text: 'puts 1' })]);
    assert.equal(extractEditorCode(doc), 'puts 1');
  });

  test('textarea: reads .value', () => {
    const doc = makeDoc([el('textarea', { value: 'print("typed")', text: 'stale initial' })]);
    assert.equal(extractEditorCode(doc), 'print("typed")');
  });

  test('textarea: falls back to textContent when .value is empty', () => {
    const doc = makeDoc([el('textarea', { value: '', text: 'print("initial")' })]);
    assert.equal(extractEditorCode(doc), 'print("initial")');
  });

  test('textarea: an empty textarea contributes nothing', () => {
    assert.equal(extractEditorCode(makeDoc([el('textarea', { value: '' })])), '');
  });

  test('extra selectors add platform-specific code blocks', () => {
    const doc = makeDoc([el('div', { class: 'custom-code', text: 'SELECT * FROM t;' })]);
    assert.equal(extractEditorCode(doc), '');
    assert.equal(extractEditorCode(doc, ['.custom-code']), 'SELECT * FROM t;');
  });

  test('an extra selector the engine rejects is ignored', () => {
    const doc = makeDoc([el('div', { class: 'custom-code', text: 'ok();' })]);
    assert.equal(extractEditorCode(doc, ['div[unclosed', '.custom-code']), 'ok();');
  });

  test('several editors are joined with a blank line, in Monaco → CodeMirror → Ace → textarea → extra order', () => {
    const doc = makeDoc([
      el('div', { class: 'extra', text: 'extra()' }),
      el('textarea', { value: 'textarea()' }),
      el('div', { class: 'ace_content' }, lines('ace_line', 'ace()')),
      el('div', { class: 'cm-content' }, lines('cm-line', 'cm()')),
      el('div', { class: 'monaco-editor' }, lines('view-line', 'monaco()')),
    ]);
    assert.equal(extractEditorCode(doc, ['.extra']), 'monaco()\n\ncm()\n\nace()\n\ntextarea()\n\nextra()');
  });

  test('identical code found through two routes is emitted once', () => {
    const doc = makeDoc([
      el('div', { class: 'cm-content' }, lines('cm-line', 'same();')),
      el('textarea', { value: 'same();' }),
    ]);
    assert.equal(extractEditorCode(doc), 'same();');
  });

  test('indentation and inner blank lines are preserved (this is code)', () => {
    const doc = makeDoc([
      el('div', { class: 'cm-content' }, lines('cm-line', 'def f():', '    if x:', '', '        return 1')),
    ]);
    assert.equal(extractEditorCode(doc), 'def f():\n    if x:\n\n        return 1');
  });

  test('non-breaking spaces (Monaco renders indentation with them) become regular spaces', () => {
    const doc = makeDoc([
      el('div', { class: 'monaco-editor' }, lines('view-line', 'if x:', '\u00a0\u00a0\u00a0\u00a0return\u00a01')),
    ]);
    assert.equal(extractEditorCode(doc), 'if x:\n    return 1');
  });

  test('trailing whitespace is stripped per line and CRLF is normalised', () => {
    const doc = makeDoc([el('textarea', { value: 'a = 1   \r\nb = 2\t\r\n\r\n' })]);
    assert.equal(extractEditorCode(doc), 'a = 1\nb = 2');
  });

  test('chunks shorter than two characters are ignored', () => {
    const doc = makeDoc([el('textarea', { value: 'x' }), el('div', { class: 'cm-content', text: ' ' })]);
    assert.equal(extractEditorCode(doc), '');
  });

  test('a two-character chunk is kept', () => {
    assert.equal(extractEditorCode(makeDoc([el('textarea', { value: 'ab' })])), 'ab');
  });

  test('output over the cap is cut and marked as truncated', () => {
    const doc = makeDoc([el('textarea', { value: 'abcdefghij' })]);
    assert.equal(extractEditorCode(doc, undefined, 4), 'abcd\n…(code truncated)');
  });

  test('output exactly at the cap is not marked', () => {
    const doc = makeDoc([el('textarea', { value: 'abcdefghij' })]);
    assert.equal(extractEditorCode(doc, undefined, 10), 'abcdefghij');
  });

  test('default cap is 8000 characters plus the truncation marker', () => {
    const doc = makeDoc([el('textarea', { value: 'y'.repeat(8001) })]);
    assert.equal(extractEditorCode(doc), 'y'.repeat(8000) + '\n…(code truncated)');
  });

  test("returns '' when every query throws", () => {
    assert.equal(extractEditorCode(throwingDoc(), ['.x']), '');
  });
});

describe('extractPreBlocks', () => {
  test("returns '' when there are no <pre> blocks", () => {
    assert.equal(extractPreBlocks(makeDoc([el('p', { text: 'nothing' })])), '');
  });

  test('joins blocks with a blank line, preserving inner whitespace', () => {
    const doc = makeDoc([
      el('pre', { text: 'Input: nums = [2,7,11,15]\n  target = 9\n' }),
      el('p', { text: 'between' }),
      el('pre', { text: 'Output: [0,1]' }),
    ]);
    assert.equal(extractPreBlocks(doc), 'Input: nums = [2,7,11,15]\n  target = 9\n\nOutput: [0,1]');
  });

  test('finds nested <pre> blocks', () => {
    const doc = makeDoc([el('div', {}, [el('section', {}, [el('pre', { text: 'deep block' })])])]);
    assert.equal(extractPreBlocks(doc), 'deep block');
  });

  test('includes text from child elements of a <pre>', () => {
    const doc = makeDoc([el('pre', {}, [el('strong', { text: 'Input:' }), el('span', { text: ' s = "ab"' })])]);
    assert.equal(extractPreBlocks(doc), 'Input: s = "ab"');
  });

  test('normalises CRLF and trims each block', () => {
    const doc = makeDoc([el('pre', { text: '\r\n  a\r\n  b\r\n' })]);
    assert.equal(extractPreBlocks(doc), 'a\n  b');
  });

  test('drops duplicate blocks', () => {
    const doc = makeDoc([el('pre', { text: 'same' }), el('pre', { text: ' same ' }), el('pre', { text: 'other' })]);
    assert.equal(extractPreBlocks(doc), 'same\n\nother');
  });

  test('ignores empty and single-character blocks, keeps two-character ones', () => {
    const doc = makeDoc([el('pre', { text: '' }), el('pre', { text: ' 1 ' }), el('pre', { text: '42' })]);
    assert.equal(extractPreBlocks(doc), '42');
  });

  test('truncates to the cap with no marker', () => {
    const doc = makeDoc([el('pre', { text: 'abcdef' }), el('pre', { text: 'ghijkl' })]);
    assert.equal(extractPreBlocks(doc, 9), 'abcdef\n\ng');
  });

  test('default cap is 4000 characters', () => {
    const doc = makeDoc([el('pre', { text: 'z'.repeat(5000) })]);
    assert.equal(extractPreBlocks(doc).length, 4000);
  });

  test("returns '' when the query throws or returns null", () => {
    assert.equal(extractPreBlocks(throwingDoc()), '');
    assert.equal(extractPreBlocks({ querySelectorAll: () => null }), '');
  });
});

describe('sliceSection', () => {
  const body = [
    'Two Sum',
    '',
    'Given an array of integers, return indices.',
    '',
    'Example 1:',
    'Input: nums = [2,7,11,15], target = 9',
    'Output: [0,1]',
    '',
    'Constraints:',
    '2 <= nums.length <= 10^4',
    '-10^9 <= nums[i] <= 10^9',
    '',
    'Follow-up: can you do better than O(n^2)?',
  ].join('\n');

  test('slices from the signal to the next blank line', () => {
    assert.equal(
      sliceSection(body, ['Constraints']),
      'Constraints:\n2 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9',
    );
    assert.equal(
      sliceSection(body, ['Example']),
      'Example 1:\nInput: nums = [2,7,11,15], target = 9\nOutput: [0,1]',
    );
  });

  test('the signal is matched case-insensitively and the original casing is returned', () => {
    assert.equal(
      sliceSection(body, ['CONSTRAINTS']),
      'Constraints:\n2 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9',
    );
  });

  test('signals are tried in list order; the first one present wins', () => {
    assert.match(sliceSection(body, ['Limits', 'Constraints', 'Example']), /^Constraints:/);
    assert.match(sliceSection(body, ['Example', 'Constraints']), /^Example 1:/);
  });

  test('runs to the end of the text when there is no later blank line', () => {
    assert.equal(sliceSection(body, ['Follow-up']), 'Follow-up: can you do better than O(n^2)?');
  });

  test('a blank line directly under the heading does not end the section', () => {
    const text = 'Intro\n\nConstraints\n\n1 <= n <= 5\n1 <= m <= 9\n\nNotes: none';
    assert.equal(sliceSection(text, ['Constraints']), 'Constraints\n\n1 <= n <= 5\n1 <= m <= 9');
  });

  test('the slice is limited to maxLen characters from the signal', () => {
    assert.equal(sliceSection('Constraints: ' + 'x'.repeat(100), ['Constraints'], 20), 'Constraints: xxxxxxx');
  });

  test('default maxLen is 1200 characters', () => {
    assert.equal(sliceSection('Constraints: ' + 'x'.repeat(3000), ['Constraints']).length, 1200);
  });

  test('a signal at the very start of the text is found', () => {
    assert.equal(sliceSection('Input: nums = [1,2]\n\nOutput: 3', ['Input']), 'Input: nums = [1,2]');
  });

  test('the result is trimmed', () => {
    assert.equal(sliceSection('x Constraints:   \n  n <= 5   ', ['Constraints']), 'Constraints:   \n  n <= 5');
  });

  test("returns '' when no signal is present", () => {
    assert.equal(sliceSection(body, ['Hints', 'Editorial']), '');
  });

  test("returns '' for an empty body, undefined signals or an empty signal list", () => {
    assert.equal(sliceSection('', ['Constraints']), '');
    assert.equal(sliceSection(body, undefined), '');
    assert.equal(sliceSection(body, []), '');
  });
});

describe('bodyInnerText', () => {
  test("returns '' when the document has no body", () => {
    assert.equal(bodyInnerText(makeDoc([], { body: null })), '');
  });

  test('returns the collapsed body text', () => {
    const doc = makeDoc([el('h1', { text: 'Title\n\n\n\n' }), el('p', { text: 'Some    body   text' })]);
    assert.equal(bodyInnerText(doc), 'Title\n\nSome body text');
  });

  test('removes script, style, noscript and template content, at any depth', () => {
    const doc = makeDoc([
      el('p', { text: 'visible ' }),
      el('script', { text: 'window.secret = 1;' }),
      el('style', { text: '.a { color: red }' }),
      el('noscript', { text: 'enable js' }),
      el('template', { text: 'tpl' }),
      el('div', {}, [el('script', { text: 'nested();' }), el('span', { text: 'also visible' })]),
    ]);
    assert.equal(bodyInnerText(doc), 'visible also visible');
  });

  test('does not mutate the live document', () => {
    const script = el('script', { text: 'keep();' });
    const doc = makeDoc([el('p', { text: 'text' }), script]);
    bodyInnerText(doc);
    assert.equal(doc.body.children.includes(script), true);
    assert.equal(doc.body.textContent, 'textkeep();');
  });

  test('prefers innerText over textContent when the clone has it', () => {
    const body = el('body', { text: 'raw textContent', innerText: 'rendered   innerText' });
    assert.equal(bodyInnerText(makeDoc([], { body })), 'rendered innerText');
  });

  test('truncates to the cap', () => {
    const doc = makeDoc([el('p', { text: 'abcdefghij' })]);
    assert.equal(bodyInnerText(doc, 4), 'abcd');
    assert.equal(bodyInnerText(doc, 10), 'abcdefghij');
  });

  test('default cap is 12000 characters', () => {
    const doc = makeDoc([el('p', { text: 'q'.repeat(13000) })]);
    assert.equal(bodyInnerText(doc).length, 12000);
  });

  test('still returns text when the clone has no working querySelectorAll', () => {
    const body = {
      cloneNode: () => ({
        textContent: '  shim   text ',
        querySelectorAll() { throw new TypeError('not implemented'); },
      }),
    };
    assert.equal(bodyInnerText({ body }), 'shim text');
  });

  test("returns '' when the clone has neither innerText nor textContent", () => {
    const body = { cloneNode: () => ({ querySelectorAll: () => [] }) };
    assert.equal(bodyInnerText({ body }), '');
  });
});

describe('readEmbeddedJson', () => {
  const nextData = { props: { pageProps: { question: { title: 'Two Sum', id: 1 } } } };

  test('parses the JSON text of the element with the given id', () => {
    const doc = makeDoc([el('script', { id: '__NEXT_DATA__', text: JSON.stringify(nextData) })]);
    assert.deepEqual(readEmbeddedJson(doc, ['__NEXT_DATA__']), nextData);
  });

  test('tries ids in order and returns the first that parses', () => {
    const doc = makeDoc([
      el('script', { id: 'second', text: '{"from":"second"}' }),
      el('script', { id: 'first', text: '{"from":"first"}' }),
    ]);
    assert.deepEqual(readEmbeddedJson(doc, ['missing', 'first', 'second']), { from: 'first' });
  });

  test('skips an element whose content is not valid JSON', () => {
    const doc = makeDoc([
      el('script', { id: 'bad', text: '{ not: json, }' }),
      el('script', { id: 'good', text: '[1,2,3]' }),
    ]);
    assert.deepEqual(readEmbeddedJson(doc, ['bad', 'good']), [1, 2, 3]);
  });

  test('never evaluates page script — executable content is just a parse failure', () => {
    const marker = '__domHelpersTestEvalMarker';
    const doc = makeDoc([el('script', { id: 'state', text: `globalThis.${marker} = true; ({a:1})` })]);
    assert.equal(readEmbeddedJson(doc, ['state']), null);
    assert.equal(marker in globalThis, false);
  });

  test('skips an empty element', () => {
    const doc = makeDoc([el('script', { id: 'empty', text: '' }), el('script', { id: 'good', text: '{"ok":true}' })]);
    assert.deepEqual(readEmbeddedJson(doc, ['empty', 'good']), { ok: true });
  });

  test('returns non-object JSON values as-is', () => {
    const doc = makeDoc([
      el('script', { id: 'str', text: '"hello"' }),
      el('script', { id: 'num', text: '0' }),
      el('script', { id: 'bool', text: 'false' }),
    ]);
    assert.equal(readEmbeddedJson(doc, ['str']), 'hello');
    assert.equal(readEmbeddedJson(doc, ['num']), 0);
    assert.equal(readEmbeddedJson(doc, ['bool']), false);
  });

  test('returns null when no id matches, or the id list is empty', () => {
    const doc = makeDoc([el('script', { id: 'x', text: '{}' })]);
    assert.equal(readEmbeddedJson(doc, ['nope']), null);
    assert.equal(readEmbeddedJson(doc, []), null);
  });

  test('falls back to querySelector when the document has no getElementById', () => {
    const doc = makeDoc([el('script', { id: 'state', text: '{"via":"querySelector"}' })], { withGetElementById: false });
    assert.equal(doc.getElementById, undefined);
    assert.deepEqual(readEmbeddedJson(doc, ['state']), { via: 'querySelector' });
  });

  test('falls back to querySelector when getElementById finds nothing', () => {
    const doc = makeDoc([el('script', { id: 'state', text: '{"via":"fallback"}' })]);
    doc.getElementById = () => null;
    assert.deepEqual(readEmbeddedJson(doc, ['state']), { via: 'fallback' });
  });

  test('a lookup that throws is skipped, and later ids are still tried', () => {
    const doc = makeDoc([el('script', { id: 'good', text: '{"ok":1}' })]);
    const real = doc.getElementById;
    doc.getElementById = (id) => {
      if (id === 'explodes') throw new Error('boom');
      return real(id);
    };
    assert.deepEqual(readEmbeddedJson(doc, ['explodes', 'good']), { ok: 1 });
  });

  test('returns null when every lookup throws', () => {
    assert.equal(readEmbeddedJson(throwingDoc(), ['a', 'b']), null);
  });
});
