// natively-browser/src/__tests__/math-extract.test.mjs
//
// Unit tests for math extraction and SVG formula detection.
// Covers issue #645: preserving mathematical formulas and detecting omitted SVG math.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/math-helpers.js');
const {
  normalizeMathDom,
  SVG_MATH_OMITTED_NOTICE,
  SVG_MATH_PLACEHOLDER,
} = await import(pathToFileURL(modPath).href);

const extractModPath = path.resolve(__dirname, '../../dist-test/extract.js');
const { extractPageContent } = await import(pathToFileURL(extractModPath).href);

const extractorsModPath = path.resolve(__dirname, '../../dist-test/capture/extractors/index.js');
const { runExtractor } = await import(pathToFileURL(extractorsModPath).href);

// ---- Test DOM Mock ----------------------------------------------------------
function makeNode(tagName, { text = '', attrs = {}, children = [], className = '' } = {}) {
  const node = {
    tagName: tagName.toUpperCase(),
    _text: text,
    get textContent() {
      if (this.children && this.children.length > 0) {
        return (this._text || '') + this.children.map((c) => c.textContent).join('');
      }
      return this._text || '';
    },
    set textContent(val) {
      this._text = val;
      this.children = [];
    },
    get innerText() {
      return this.textContent;
    },
    className,
    classList: {
      contains(c) {
        return className.split(/\s+/).includes(c);
      },
    },
    attributes: { ...attrs },
    children: [...children],
    parentNode: null,
    cloneNode() {
      const clonedChildren = (this.children || []).map((c) => c.cloneNode());
      return makeNode(this.tagName, {
        text: this._text,
        attrs: { ...this.attributes },
        children: clonedChildren,
        className: this.className,
      });
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    setAttribute(name, val) {
      this.attributes[name] = val;
    },
    hasAttribute(name) {
      return name in this.attributes;
    },
    replaceWith(replacement) {
      if (!this.parentNode) return;
      const siblings = this.parentNode.children;
      const idx = siblings.indexOf(this);
      if (idx >= 0) {
        if (typeof replacement === 'string') {
          const textNode = makeNode('#text', { text: replacement });
          textNode.parentNode = this.parentNode;
          siblings.splice(idx, 1, textNode);
        } else {
          replacement.parentNode = this.parentNode;
          siblings.splice(idx, 1, replacement);
        }
      }
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      const out = [];
      const parts = sel.split(',').map((s) => s.trim());

      const matches = (n) => {
        for (const s of parts) {
          if (!s) continue;
          if (s.startsWith('.')) {
            const cls = s.slice(1).toLowerCase();
            if (n.className && n.className.toLowerCase().split(/\s+/).includes(cls)) return true;
          } else if (s.startsWith('[') && s.endsWith(']')) {
            const inner = s.slice(1, -1);
            if (inner.includes('^=')) {
              const [k, v] = inner.split('^=').map((x) => x.replace(/["']/g, ''));
              if ((n.getAttribute(k) || '').startsWith(v)) return true;
            } else if (inner.includes('*=')) {
              const [k, v] = inner.split('*=').map((x) => x.replace(/["']/g, ''));
              if ((n.getAttribute(k) || '').includes(v)) return true;
            } else if (inner.includes('=')) {
              const [k, v] = inner.split('=').map((x) => x.replace(/["']/g, ''));
              if (n.getAttribute(k) === v) return true;
            } else {
              if (n.hasAttribute(inner)) return true;
            }
          } else {
            // Tag check, possibly followed by attribute like annotation[encoding...]
            const tagMatch = s.match(/^([a-z0-9_-]+)(.*)$/i);
            if (tagMatch) {
              const expectedTag = tagMatch[1].toUpperCase();
              if (n.tagName !== expectedTag) continue;
              const rest = tagMatch[2];
              if (!rest) return true;
              if (rest.startsWith('[') && rest.endsWith(']')) {
                const inner = rest.slice(1, -1);
                if (inner.includes('*=')) {
                  const [k, v] = inner.split('*=').map((x) => x.replace(/["']/g, ''));
                  if ((n.getAttribute(k) || '').toLowerCase().includes(v.toLowerCase())) return true;
                } else if (inner.includes('=')) {
                  const [k, v] = inner.split('=').map((x) => x.replace(/["']/g, ''));
                  if (n.getAttribute(k) === v) return true;
                } else {
                  if (n.hasAttribute(inner)) return true;
                }
              }
            }
          }
        }
        return false;
      };

      const walk = (n) => {
        for (const c of n.children || []) {
          if (matches(c)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    },
    closest(sel) {
      let cur = this;
      const parts = sel.split(',').map((s) => s.trim().toLowerCase());
      while (cur && cur.tagName) {
        const curTag = cur.tagName.toLowerCase();
        for (const s of parts) {
          if (s.startsWith('.')) {
            const cls = s.slice(1);
            if (cur.className && cur.className.toLowerCase().split(/\s+/).includes(cls)) return cur;
          } else if (s === curTag) {
            return cur;
          }
        }
        cur = cur.parentNode;
      }
      return null;
    },
  };

  for (const c of children) {
    c.parentNode = node;
  }

  // Get full text of tree
  Object.defineProperty(node, 'fullText', {
    get() {
      let t = this.textContent || '';
      for (const c of this.children || []) {
        t += (t && !t.endsWith(' ') ? ' ' : '') + c.fullText;
      }
      return t.replace(/\s+/g, ' ').trim();
    },
  });

  return node;
}

// ---- Test Suites ------------------------------------------------------------

describe('normalizeMathDom : KaTeX and MathML preservation', () => {
  test('extracts TeX formula from KaTeX <annotation> and replaces container', () => {
    const ann = makeNode('annotation', {
      text: '2 \\le m, n \\le 300',
      attrs: { encoding: 'application/x-tex' },
    });
    const math = makeNode('math', { children: [ann] });
    const mathml = makeNode('span', { className: 'katex-mathml', children: [math] });
    const visual = makeNode('span', { className: 'katex-html', text: 'visual rendered output' });
    const katex = makeNode('span', { className: 'katex', children: [mathml, visual] });
    const p = makeNode('p', { text: 'Constraints: ', children: [katex] });

    const result = normalizeMathDom(p);
    assert.equal(result.omittedSvgMathCount, 0);
    assert.match(p.fullText, /2 \\le m, n \\le 300/);
    assert.doesNotMatch(p.fullText, /visual rendered output/);
  });

  test('falls back to aria-label on KaTeX container if no annotation is present', () => {
    const katex = makeNode('span', {
      className: 'katex',
      attrs: { 'aria-label': 'x^2 + y^2 = r^2' },
      children: [makeNode('span', { text: 'visual' })],
    });
    const p = makeNode('p', { children: [katex] });

    const result = normalizeMathDom(p);
    assert.equal(result.omittedSvgMathCount, 0);
    assert.match(p.fullText, /x\^2 \+ y\^2 = r\^2/);
  });

  test('extracts text from standalone MathML <math><annotation>', () => {
    const ann = makeNode('annotation', { text: 'O(N \\log N)' });
    const math = makeNode('math', { children: [ann] });
    const p = makeNode('p', { text: 'Time complexity is ', children: [math] });

    const result = normalizeMathDom(p);
    assert.equal(result.omittedSvgMathCount, 0);
    assert.match(p.fullText, /O\(N \\log N\)/);
  });
});

describe('normalizeMathDom : MathJax and data attributes', () => {
  test('extracts formula from MathJax <script type="math/tex">', () => {
    const script = makeNode('script', {
      text: '1 \\le k \\le 10^5',
      attrs: { type: 'math/tex' },
    });
    const p = makeNode('p', { text: 'Given ', children: [script] });

    const result = normalizeMathDom(p);
    assert.equal(result.omittedSvgMathCount, 0);
    assert.match(p.fullText, /1 \\le k \\le 10\^5/);
  });

  test('extracts formula from [data-math] / [data-formula] attributes', () => {
    const span = makeNode('span', {
      attrs: { 'data-math': 'A \\cap B = \\emptyset' },
    });
    const p = makeNode('p', { text: 'Condition: ', children: [span] });

    const result = normalizeMathDom(p);
    assert.equal(result.omittedSvgMathCount, 0);
    assert.match(p.fullText, /A \\cap B = \\emptyset/);
  });
});

describe('normalizeMathDom : Accessible SVG vs Omitted Raw SVG (Issue #645)', () => {
  test('preserves math text from accessible <svg role="img" aria-label="...">', () => {
    const path = makeNode('path', { attrs: { d: 'M10 20 L30 40' } });
    const svg = makeNode('svg', {
      attrs: { role: 'img', 'aria-label': '1 <= r <= 10^9' },
      children: [path],
    });
    const p = makeNode('p', { children: [svg] });

    const result = normalizeMathDom(p);
    assert.equal(result.omittedSvgMathCount, 0);
    assert.match(p.fullText, /1 <= r <= 10\^9/);
  });

  test('preserves math text from accessible <svg><title>...</title></svg>', () => {
    const title = makeNode('title', { text: '2 <= m, n <= 300' });
    const path = makeNode('path', { attrs: { d: 'M10 20' } });
    const svg = makeNode('svg', { children: [title, path] });
    const p = makeNode('p', { children: [svg] });

    const result = normalizeMathDom(p);
    assert.equal(result.omittedSvgMathCount, 0);
    assert.match(p.fullText, /2 <= m, n <= 300/);
  });

  test('replaces HackerRank constraint raw SVG paths with placeholder and tracks count', () => {
    // Exact reproduction of Issue #645 on HackerRank Matrix Layer Rotation:
    // .challenge_constraints_body has 4 <p> tags, each containing an svg[role="img"] with only <path>
    const pEls = [];
    for (let i = 0; i < 4; i++) {
      const path = makeNode('path', { attrs: { d: 'M0 0 H10 V10 Z' } });
      const svg = makeNode('svg', { attrs: { role: 'img' }, children: [path] });
      pEls.push(makeNode('p', { children: [svg] }));
    }
    const constraints = makeNode('div', {
      className: 'challenge_constraints_body',
      children: pEls,
    });

    const result = normalizeMathDom(constraints);
    assert.equal(result.omittedSvgMathCount, 4);
    assert.match(constraints.fullText, /\[Formula \(SVG\): math expression omitted\]/);
  });

  test('replaces HackerRank inline problem-statement raw SVG paths with placeholder', () => {
    const path = makeNode('path', { attrs: { d: 'M0 0' } });
    const svg = makeNode('svg', { attrs: { role: 'img' }, children: [path] });
    const p = makeNode('p', { text: 'A 2D matrix of size ', children: [svg] });
    const body = makeNode('div', {
      className: 'challenge-body-html',
      children: [p],
    });

    const result = normalizeMathDom(body);
    assert.equal(result.omittedSvgMathCount, 1);
    assert.match(body.fullText, /A 2D matrix of size \[Formula \(SVG\): math expression omitted\]/);
  });

  test('does NOT count or replace navigation/button UI icons as omitted math', () => {
    const path = makeNode('path', { attrs: { d: 'M1 1' } });
    const svgBtn = makeNode('svg', { attrs: { role: 'img' }, children: [path] });
    const button = makeNode('button', { children: [svgBtn] });

    const svgNav = makeNode('svg', { children: [path] });
    const nav = makeNode('nav', { children: [svgNav] });

    const root = makeNode('div', { children: [button, nav] });

    const result = normalizeMathDom(root);
    assert.equal(result.omittedSvgMathCount, 0);
    assert.doesNotMatch(root.fullText, /\[Formula \(SVG\)/);
  });
});

function makeDoc(children, { title = '', host = '' } = {}) {
  const body = makeNode('body', { children });
  const doc = {
    title,
    body,
    location: { hostname: host },
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    querySelector: (sel) => body.querySelector(sel),
    cloneNode() {
      const clonedBody = body.cloneNode();
      const d = {
        title,
        body: clonedBody,
        location: { hostname: host },
        querySelectorAll: (sel) => clonedBody.querySelectorAll(sel),
        querySelector: (sel) => clonedBody.querySelector(sel),
      };
      d.cloneNode = this.cloneNode;
      return d;
    },
  };
  return doc;
}

describe('extractPageContent : HackerRank SVG math drop integration (Issue #645)', () => {
  test('replaces HackerRank raw SVG math, prepends front-matter note, and flags partial', () => {
    const titleEl = makeNode('h1', { text: 'Matrix Layer Rotation' });
    const pEls = [];
    for (let i = 0; i < 4; i++) {
      const path = makeNode('path', { attrs: { d: 'M0 0 H10 V10 Z' } });
      const svg = makeNode('svg', { attrs: { role: 'img' }, children: [path] });
      pEls.push(makeNode('p', { children: [svg] }));
    }
    const constraints = makeNode('div', {
      className: 'challenge_constraints_body',
      children: pEls,
    });
    const problemDesc = makeNode('p', { text: 'You are given a 2D matrix of dimension and a positive integer.' });
    const doc = makeDoc([titleEl, problemDesc, constraints], {
      title: 'Matrix Layer Rotation | HackerRank',
      host: 'hackerrank.com',
    });

    const res = extractPageContent({
      document: doc,
      getSelection: () => '',
    });

    assert.equal(res.omittedSvgMathCount, 4);
    assert.equal(res.partial, true);
    assert.deepEqual(res.missing, ['SVG mathematical expressions']);
    assert.match(res.text, /NOTE: Mathematical formulas on this page are rendered as SVG paths without text/);
    assert.match(res.text, /\[Formula \(SVG\): math expression omitted\]/);
  });

  test('preserves KaTeX formulas without flagging omitted math or partial', () => {
    const titleEl = makeNode('h1', { text: 'LeetCode Problem' });
    const ann = makeNode('annotation', { text: '1 \\le n \\le 10^5' });
    const math = makeNode('math', { children: [ann] });
    const katex = makeNode('span', { className: 'katex', children: [math] });
    const p = makeNode('p', { text: 'Constraints: ', children: [katex] });
    const doc = makeDoc([titleEl, p], { title: 'Problem - LeetCode', host: 'leetcode.com' });

    const res = extractPageContent({
      document: doc,
      getSelection: () => '',
    });

    assert.equal(res.omittedSvgMathCount, 0);
    assert.equal(res.partial, undefined);
    assert.match(res.text, /1 \\le n \\le 10\^5/);
    assert.doesNotMatch(res.text, /NOTE: Mathematical formulas/);
  });
});

describe('runExtractor : HackerRank coding problem envelope integration (Issue #645)', () => {
  test('flags envelope partial and missing SVG math when constraint formulas are raw SVGs', () => {
    const titleEl = makeNode('h1', { text: 'Matrix Layer Rotation' });
    const pEls = [];
    for (let i = 0; i < 4; i++) {
      const path = makeNode('path', { attrs: { d: 'M0 0 H10 V10 Z' } });
      const svg = makeNode('svg', { attrs: { role: 'img' }, children: [path] });
      pEls.push(makeNode('p', { children: [svg] }));
    }
    const constraints = makeNode('div', {
      className: 'challenge_constraints_body',
      children: [makeNode('h3', { text: 'Constraints' }), ...pEls],
    });
    const problemBody = makeNode('div', {
      className: 'challenge-body-html',
      children: [
        makeNode('p', { text: 'You are given a 2D matrix of dimension and a positive integer.' }),
        constraints,
      ],
    });
    const doc = makeDoc([titleEl, problemBody], {
      title: 'Matrix Layer Rotation | HackerRank',
      host: 'hackerrank.com',
    });

    const out = runExtractor({
      candidate: {
        tabId: 1,
        host: 'hackerrank.com',
        url: 'https://www.hackerrank.com/challenges/matrix-rotation-algo/problem',
        matchedCategory: 'coding_problem',
        matchedPlatform: 'HackerRank',
        confidenceScore: 90,
        autoPolicy: 'auto',
        lastSeenAt: Date.now(),
        reasons: [],
      },
      document: doc,
      contextId: 'test-hr-svg',
      capturedAt: Date.now(),
      captureMode: 'manual',
      platform: {
        id: 'hackerrank',
        label: 'HackerRank',
        category: 'coding_problem',
        hostPatterns: ['hackerrank.com'],
        urlPatterns: ['/challenges/'],
        extractor: 'codingProblem',
        platformHints: {
          statementSelectors: ['.challenge-body-html'],
          constraintsSignals: ['Constraints'],
        },
      },
    });

    assert.ok(out.envelope);
    assert.equal(out.envelope.meta.partial, true);
    assert.deepEqual(out.envelope.meta.missing, ['visible code', 'SVG mathematical expressions']);
    assert.match(out.dom, /NOTE: Mathematical formulas on this page are rendered as SVG paths without text/);
    assert.match(out.dom, /\[Formula \(SVG\): math expression omitted\]/);
  });
});
