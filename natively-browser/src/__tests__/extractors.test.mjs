// natively-browser/src/__tests__/extractors.test.mjs
//
// Tests the structured extractors: coding problem/editor, docs/notes (manual-
// first), article, selection-only, and the blocked path. Uses a hand-rolled fake
// DOM (querySelector/querySelectorAll with class + descendant selectors), the
// repo convention. Imports compiled dist-test/ modules.
//
// Run: npm run build:test && node --test src/__tests__/extractors.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ext = await import(pathToFileURL(path.resolve(__dirname, '../../dist-test/capture/extractors/index.js')).href);
const reg = await import(pathToFileURL(path.resolve(__dirname, '../../dist-test/capture/registry/registry.js')).href);
const cls = await import(pathToFileURL(path.resolve(__dirname, '../../dist-test/capture/classifier/tab-classifier.js')).href);

const R = reg.DEFAULT_REGISTRY;

// ---- Fake DOM (class + descendant selectors, textarea value, getElementById) --
function el(tag, { className = '', text = '', id = '', value, children = [] } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    className, id, value,
    _text: text,
    children,
    parentNode: null,
    get textContent() {
      if (this.children.length) return this.children.map((c) => c.textContent).join('');
      return this._text;
    },
    get innerText() { return this.textContent; },
    matches(sel) {
      sel = sel.trim();
      if (sel.startsWith('.')) return ('' + this.className).split(/\s+/).includes(sel.slice(1));
      if (sel.startsWith('#')) return this.id === sel.slice(1);
      if (sel.startsWith('[contenteditable')) return this._contenteditable === true;
      return this.tagName === sel.toUpperCase();
    },
    closest(sel) {
      let n = this;
      while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentNode; }
      return null;
    },
    cloneNode() {
      const c = el(tag, { className, text, id, value, children: children.map((x) => x.cloneNode()) });
      c._contenteditable = this._contenteditable;
      return c;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
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

function makeDoc(bodyChildren, { title = 'Page', host = 'example.com' } = {}) {
  const body = el('body', { children: bodyChildren });
  const doc = {
    title,
    body,
    location: { hostname: host },
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    getElementById: (id) => body.querySelectorAll(`#${id}`)[0] || null,
    cloneNode: () => makeDoc(bodyChildren, { title, host }),
  };
  return doc;
}

function input(doc, { host, url, title, selection = '', captureMode = 'auto', signals } = {}) {
  const candidate = cls.classifyTab({ registry: R, host, url, title: title ?? doc.title, signals });
  const platform = reg.findPlatform(R, host, url);
  return {
    document: doc,
    getSelection: () => selection,
    contextId: 'ctx-test',
    capturedAt: 1_000_000,
    candidate,
    platform,
    captureMode,
  };
}

describe('extractors — coding problem (LeetCode-like)', () => {
  test('captures title, statement, constraints, examples, editor code', () => {
    const lines = ['class Solution:', '    def twoSum(self, nums, target):', '        pass'].map(
      (t) => el('div', { className: 'view-line', text: t }),
    );
    const editor = el('div', { className: 'monaco-editor', children: [el('div', { className: 'view-lines', children: lines })] });
    const titleEl = el('div', { className: 'css-title', text: '1. Two Sum' });
    const stmt = el('div', {
      className: 'elfjS',
      text: 'Given an array of integers nums...\n\nExample 1:\nInput: nums = [2,7]\nOutput: [0,1]\n\nConstraints:\n2 <= nums.length <= 10^4',
    });
    const doc = makeDoc([titleEl, stmt, editor], { title: 'Two Sum - LeetCode', host: 'leetcode.com' });

    // platformHints for leetcode point at [data-track-load=description_content]/.elfjS etc.
    const out = ext.runExtractor(input(doc, {
      host: 'leetcode.com',
      url: 'https://leetcode.com/problems/two-sum/',
      title: 'Two Sum - LeetCode',
      signals: { codeEditorPresent: true, ioConstraintSignals: true },
    }));

    assert.ok(out.envelope);
    assert.equal(out.envelope.category, 'coding_problem');
    assert.equal(out.envelope.payload.platform, 'LeetCode');
    assert.match(out.envelope.payload.visibleCode, /def twoSum\(self, nums, target\)/);
    assert.match(out.dom, /CODE ON PAGE/);
    // statement carried (from .elfjS selector)
    assert.match(out.envelope.payload.problemStatement, /Given an array of integers/);
    // constraints sliced out
    assert.match(out.envelope.payload.constraints, /Constraints/);
  });

  test('selection becomes the primary signal', () => {
    const doc = makeDoc([el('div', { text: 'noise' })], { title: 'X', host: 'leetcode.com' });
    const out = ext.runExtractor(input(doc, {
      host: 'leetcode.com',
      url: 'https://leetcode.com/problems/two-sum/',
      selection: 'Why is my binary search off by one here?',
    }));
    assert.equal(out.envelope.meta.extractionSource, 'selection');
    assert.match(out.envelope.payload.selectedText, /off by one/);
  });
});

describe('extractors — coding editor (CoderPad-like)', () => {
  test('captures visible editor code as starter code', () => {
    const lines = ['function solve(input) {', '  // here', '}'].map((t) => el('div', { className: 'cm-line', text: t }));
    const editor = el('div', { className: 'cm-content', children: lines });
    const doc = makeDoc([editor], { title: 'CoderPad', host: 'app.coderpad.io' });
    const out = ext.runExtractor(input(doc, {
      host: 'app.coderpad.io',
      url: 'https://app.coderpad.io/ABCXYZ',
      signals: { codeEditorPresent: true },
    }));
    assert.equal(out.envelope.category, 'interview_assessment');
    assert.match(out.envelope.payload.visibleCode, /function solve\(input\)/);
  });
});

describe('extractors — docs/notes are manual-first (partial only)', () => {
  test('Google Docs: never claims full document; selection first', () => {
    const doc = makeDoc([el('div', { text: 'visible doc body' })], { title: 'Spec - Google Docs', host: 'docs.google.com' });
    const out = ext.runExtractor(input(doc, {
      host: 'docs.google.com',
      url: 'https://docs.google.com/document/d/abc/edit',
      selection: 'just this paragraph',
      captureMode: 'manual',
    }));
    assert.equal(out.envelope.category, 'google_docs_visible');
    assert.equal(out.envelope.payload.editorType, 'google_docs');
    assert.match(out.dom, /Partial document/);
    assert.match(out.envelope.payload.selectedText, /just this paragraph/);
  });

  test('Notion: detects prosemirror/contenteditable, visible blocks only', () => {
    const block = el('div', { className: 'notion-page-content', text: 'my note content' });
    const doc = makeDoc([block], { title: 'My Notes', host: 'notion.so' });
    const out = ext.runExtractor(input(doc, { host: 'notion.so', url: 'https://www.notion.so/My-Notes', captureMode: 'manual' }));
    assert.equal(out.envelope.category, 'notes');
    assert.match(out.dom, /Partial notes/);
  });
});

describe('extractors — blocked pages produce nothing', () => {
  test('Gmail → no envelope, empty dom', () => {
    const doc = makeDoc([el('div', { text: 'inbox' })], { title: 'Gmail', host: 'mail.google.com' });
    const out = ext.runExtractor(input(doc, { host: 'mail.google.com', url: 'https://mail.google.com/' }));
    assert.equal(out.envelope, null);
    assert.equal(out.dom, '');
  });

  test('a login page → blocked, nothing extracted', () => {
    const doc = makeDoc([el('div', { text: 'sign in' })], { title: 'Sign in', host: 'acme.com' });
    const out = ext.runExtractor(input(doc, { host: 'acme.com', url: 'https://acme.com/login' }));
    assert.equal(out.envelope, null);
  });
});

describe('extractors — envelope shape', () => {
  test('envelope carries version, contextId, urlHash (not the secret), charCount', () => {
    const doc = makeDoc([el('pre', { text: 'def f(): pass' })], { title: 'P', host: 'codeforces.com' });
    const out = ext.runExtractor(input(doc, {
      host: 'codeforces.com',
      url: 'https://codeforces.com/problemset/problem/1/A?token=SECRET',
      signals: { codeEditorPresent: false },
    }));
    assert.equal(out.envelope.envelopeVersion, 1);
    assert.equal(out.envelope.contextId, 'ctx-test');
    assert.equal(out.envelope.source, 'browser_extension');
    assert.ok(out.envelope.meta.urlHash && out.envelope.meta.urlHash.length > 0);
    assert.equal(out.envelope.meta.charCount, out.dom.length);
  });

  test('legacy dom string is capped to 25000 chars', () => {
    const big = 'x'.repeat(60000);
    const doc = makeDoc([el('div', { className: 'elfjS', text: big })], { title: 'Big', host: 'leetcode.com' });
    const out = ext.runExtractor(input(doc, {
      host: 'leetcode.com',
      url: 'https://leetcode.com/problems/big/',
    }));
    assert.ok(out.dom.length <= 25000);
  });
});

describe('extractors — partial-capture honesty signal', () => {
  test('coding page with NEITHER statement nor code → partial:true with missing fields', () => {
    // A coding host but the editor is non-standard (no Monaco/CM/Ace/textarea)
    // and there is no statement selector content — the thin-capture case.
    const doc = makeDoc([el('div', { className: 'mystery-canvas-editor', text: '' })], { title: 'Problem', host: 'codeforces.com' });
    const out = ext.runExtractor(input(doc, {
      host: 'codeforces.com',
      url: 'https://codeforces.com/problemset/problem/1/A',
    }));
    assert.ok(out.envelope);
    assert.equal(out.envelope.meta.partial, true);
    assert.ok(out.envelope.meta.missing.includes('problem statement'));
    assert.ok(out.envelope.meta.missing.includes('visible code'));
  });

  test('coding page WITH statement → not partial (usable capture)', () => {
    const stmt = el('div', { className: 'elfjS', text: 'Given an array of integers, return indices...' });
    const doc = makeDoc([stmt], { title: 'Two Sum - LeetCode', host: 'leetcode.com' });
    const out = ext.runExtractor(input(doc, {
      host: 'leetcode.com',
      url: 'https://leetcode.com/problems/two-sum/',
    }));
    assert.notEqual(out.envelope.meta.partial, true);
  });

  test('coding page WITH visible code only → not partial', () => {
    const lines = ['function solve(a){', '  return a;', '}'].map((t) => el('div', { className: 'view-line', text: t }));
    const editor = el('div', { className: 'monaco-editor', children: [el('div', { className: 'view-lines', children: lines })] });
    const doc = makeDoc([editor], { title: 'Editor', host: 'app.coderpad.io' });
    const out = ext.runExtractor(input(doc, {
      host: 'app.coderpad.io',
      url: 'https://app.coderpad.io/ABCXYZ',
      signals: { codeEditorPresent: true },
    }));
    assert.notEqual(out.envelope.meta.partial, true);
  });

  test('a user selection always counts as complete (never partial)', () => {
    const doc = makeDoc([el('div', { text: 'noise' })], { title: 'P', host: 'codeforces.com' });
    const out = ext.runExtractor(input(doc, {
      host: 'codeforces.com',
      url: 'https://codeforces.com/problemset/problem/1/A',
      selection: 'this specific snippet the user highlighted intentionally',
    }));
    assert.notEqual(out.envelope.meta.partial, true);
  });
});
