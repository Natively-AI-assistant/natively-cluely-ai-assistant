// Verifies extractCodeBlocks captures code VERBATIM from <pre>/<code> and live
// editors (Monaco .view-line, CodeMirror .cm-line) — the fix for coding-page
// captures where Readability/innerText drop the real function signature and the
// model then hallucinates variable names / the wrong skeleton.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/extract.js');
const { extractPageContent } = await import(pathToFileURL(modPath).href);

// Fake DOM that supports tag selectors, simple `.class` selectors, descendant
// combinators ("a b"), closest(), and textContent — the surface extract.ts uses.
function el(tag, { className = '', text = '', children = [] } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    className,
    _text: text,
    children,
    parentNode: null,
    get textContent() {
      if (this.children.length) return this.children.map((c) => c.textContent).join('');
      return this._text;
    },
    matches(sel) {
      sel = sel.trim();
      if (sel.startsWith('.')) return ('' + this.className).split(/\s+/).includes(sel.slice(1));
      return this.tagName === sel.toUpperCase();
    },
    closest(sel) {
      let n = this;
      while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentNode; }
      return null;
    },
    cloneNode() {
      return el(tag, { className, text, children: children.map((c) => c.cloneNode()) });
    },
    get innerText() {
      return this.textContent;
    },
    querySelectorAll(sel) {
      const groups = sel.split(',').map((s) => s.trim());
      const out = [];
      const all = [];
      const collect = (n) => { for (const c of n.children) { all.push(c); collect(c); } };
      collect(this);
      for (const g of groups) {
        const parts = g.split(/\s+/);
        for (const cand of all) {
          if (!cand.matches(parts[parts.length - 1])) continue;
          // descendant combinator: ensure an ancestor matches the earlier part
          if (parts.length === 2) {
            let anc = cand.parentNode, ok = false;
            while (anc) { if (anc.matches(parts[0])) { ok = true; break; } anc = anc.parentNode; }
            if (!ok) continue;
          }
          if (!out.includes(cand)) out.push(cand);
        }
      }
      return out;
    },
  };
  for (const c of children) c.parentNode = node;
  return node;
}

function makeDoc(bodyChildren, { title = 'Problem' } = {}) {
  const body = el('body', { children: bodyChildren });
  const doc = {
    title,
    body,
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    cloneNode: () => makeDoc(bodyChildren, { title }),
  };
  return doc;
}

describe('extractCodeBlocks (via extractPageContent)', () => {
  test('captures a <pre> code block verbatim with newlines', () => {
    const pre = el('pre', { text: 'class Solution:\n    def twoSum(self, nums, target):\n        pass' });
    const doc = makeDoc([pre]);
    const r = extractPageContent({ document: doc, getSelection: () => '' });
    assert.match(r.text, /CODE ON PAGE/);
    assert.match(r.text, /def twoSum\(self, nums, target\)/);
    // newline preserved (not whitespace-collapsed)
    assert.match(r.text, /class Solution:\n/);
  });

  test('captures Monaco editor starter signature from .view-line', () => {
    const lines = [
      el('div', { className: 'view-line', text: 'function twoSum(nums, target) {' }),
      el('div', { className: 'view-line', text: '  // write code here' }),
      el('div', { className: 'view-line', text: '}' }),
    ];
    const editor = el('div', { className: 'monaco-editor', children: [el('div', { className: 'view-lines', children: lines })] });
    const doc = makeDoc([editor]);
    const r = extractPageContent({ document: doc, getSelection: () => '' });
    assert.match(r.text, /function twoSum\(nums, target\)/);
    assert.match(r.text, /write code here/);
  });

  test('captures CodeMirror .cm-line content', () => {
    const lines = [
      el('div', { className: 'cm-line', text: 'def solve(arr: list[int]) -> int:' }),
      el('div', { className: 'cm-line', text: '    return 0' }),
    ];
    const editor = el('div', { className: 'cm-content', children: lines });
    const doc = makeDoc([editor]);
    const r = extractPageContent({ document: doc, getSelection: () => '' });
    assert.match(r.text, /def solve\(arr: list\[int\]\) -> int:/);
  });

  test('no code on a prose page → no CODE ON PAGE section', () => {
    const p = el('p', { text: 'Just an article about cats and dogs and weather today.' });
    const doc = makeDoc([p]);
    const r = extractPageContent({ document: doc, getSelection: () => '' });
    assert.doesNotMatch(r.text, /CODE ON PAGE/);
  });
});

describe('selection-first + page-type (P4)', () => {
  test('substantial selection becomes the primary signal, page body dropped', () => {
    const body = el('p', { text: 'Lots of unrelated page navigation and sidebar noise here.' });
    const doc = makeDoc([body], { title: 'Some Page' });
    const sel = 'How do I reverse a linked list in place without recursion?';
    const r = extractPageContent({ document: doc, getSelection: () => sel });
    assert.equal(r.source, 'selection');
    assert.match(r.text, /answer about THIS highlighted text/);
    assert.match(r.text, /reverse a linked list in place/);
    assert.doesNotMatch(r.text, /sidebar noise/); // page body dropped
  });

  test('short selection does NOT hijack — normal extraction', () => {
    const body = el('p', { text: 'The full article body about distributed systems and consensus.' });
    const doc = makeDoc([body]);
    const r = extractPageContent({ document: doc, getSelection: () => 'ok' }); // < 40 chars
    assert.notEqual(r.source, 'selection');
    assert.match(r.text, /distributed systems/);
  });

  test('pageType=coding when a Monaco editor is present', () => {
    const editor = el('div', { className: 'monaco-editor', children: [
      el('div', { className: 'view-lines', children: [el('div', { className: 'view-line', text: 'def f(): pass' })] }),
    ] });
    const doc = makeDoc([editor]);
    const r = extractPageContent({ document: doc, getSelection: () => '' });
    assert.equal(r.pageType, 'coding');
  });

  test('pageType=app for a plain non-article page', () => {
    const doc = makeDoc([el('div', { text: 'tiny' })]);
    const r = extractPageContent({ document: doc, getSelection: () => '' });
    assert.equal(r.pageType, 'app');
  });

  test('selection on a coding page still wins (selection > site-type)', () => {
    const editor = el('div', { className: 'monaco-editor', children: [
      el('div', { className: 'view-lines', children: [el('div', { className: 'view-line', text: 'def f(): pass' })] }),
    ] });
    const doc = makeDoc([editor]);
    const sel = 'Explain the time complexity of this binary search variant please.';
    const r = extractPageContent({ document: doc, getSelection: () => sel });
    assert.equal(r.source, 'selection');
    assert.match(r.text, /time complexity of this binary search/);
  });

  test('firstLine is populated for the preview chip', () => {
    const editor = el('div', { className: 'monaco-editor', children: [
      el('div', { className: 'view-lines', children: [el('div', { className: 'view-line', text: 'class Solution: pass' })] }),
    ] });
    const doc = makeDoc([editor], { title: 'Two Sum' });
    const r = extractPageContent({ document: doc, getSelection: () => '' });
    assert.ok(r.firstLine.length > 0);
    assert.doesNotMatch(r.firstLine, /^TITLE:/); // labels skipped
  });
});
