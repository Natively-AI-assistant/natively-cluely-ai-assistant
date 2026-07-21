// natively-browser/src/__tests__/smart-capture.test.mjs
//
// Tests the in-page smart-capture orchestrator: it classifies, enforces the
// blocked floor, and runs the structured extractor. Verifies the just-in-time
// path produces an envelope for coding pages and NOTHING for sensitive pages.
//
// Run: npm run build:test && node --test src/__tests__/smart-capture.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sc = await import(pathToFileURL(path.resolve(__dirname, '../../dist-test/capture/smart-capture.js')).href);

// Minimal fake DOM with class selectors + input[type] attribute selectors.
function el(tag, { className = '', text = '', attrs = {}, value, children = [] } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    className, value, attrs,
    _text: text,
    children,
    parentNode: null,
    get textContent() {
      return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
    },
    get innerText() { return this.textContent; },
    matches(sel) {
      sel = sel.trim();
      if (sel.startsWith('.')) return ('' + this.className).split(/\s+/).includes(sel.slice(1));
      // attribute selector like input[type="password"] or input[name*="card" i]
      const am = sel.match(/^(\w+)?\[([\w-]+)([*^$]?)=?"?([^"\]]*)"?\s*(i)?\]$/);
      if (am) {
        const [, t, attr, op, val] = am;
        if (t && this.tagName !== t.toUpperCase()) return false;
        const got = (this.attrs[attr] || '').toLowerCase();
        const want = (val || '').toLowerCase();
        if (op === '*') return got.includes(want);
        return got === want;
      }
      return this.tagName === sel.toUpperCase();
    },
    closest() { return null; },
    cloneNode() { return el(tag, { className, text, attrs, value, children: children.map((c) => c.cloneNode()) }); },
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

function makeDoc(bodyChildren, title = 'Page') {
  const body = el('body', { children: bodyChildren });
  return {
    title,
    body,
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    getElementById: () => null,
    cloneNode: () => makeDoc(bodyChildren, title),
  };
}

const base = (doc, host, url, selection = '') => ({
  document: doc,
  host,
  url,
  title: doc.title,
  getSelection: () => selection,
  contextId: 'ctx1',
  capturedAt: 1000,
  captureMode: 'auto',
});

describe('smart-capture — coding page (auto-eligible)', () => {
  test('LeetCode problem → envelope + dom, not blocked, auto policy', () => {
    const lines = ['def two_sum(nums, target):', '    pass'].map((t) => el('div', { className: 'view-line', text: t }));
    const editor = el('div', { className: 'monaco-editor', children: [el('div', { className: 'view-lines', children: lines })] });
    const stmt = el('div', { className: 'elfjS', text: 'Given nums...\nConstraints:\n1 <= n' });
    const doc = makeDoc([stmt, editor], 'Two Sum - LeetCode');
    const r = sc.smartCapture(base(doc, 'leetcode.com', 'https://leetcode.com/problems/two-sum/'));
    assert.equal(r.blocked, false);
    assert.ok(r.envelope);
    assert.equal(r.envelope.category, 'coding_problem');
    assert.ok(['auto', 'auto_if_high_confidence'].includes(r.candidate.autoPolicy));
    assert.match(r.envelope.payload.visibleCode, /def two_sum/);
  });
});

describe('smart-capture — sensitive page (blocked floor)', () => {
  test('Gmail → blocked, no envelope, no dom', () => {
    const doc = makeDoc([el('div', { text: 'inbox' })], 'Gmail');
    const r = sc.smartCapture(base(doc, 'mail.google.com', 'https://mail.google.com/'));
    assert.equal(r.blocked, true);
    assert.equal(r.envelope, null);
    assert.equal(r.dom, '');
  });

  test('page with a password field → blocked even on an unknown host', () => {
    const pwd = el('input', { attrs: { type: 'password' } });
    const doc = makeDoc([pwd], 'Login');
    const r = sc.smartCapture(base(doc, 'acme.com', 'https://acme.com/account'));
    assert.equal(r.blocked, true);
    assert.equal(r.envelope, null);
  });
});

describe('smart-capture — non-coding page is not auto-eligible', () => {
  test('Google Docs → not blocked but manual policy (not auto)', () => {
    const doc = makeDoc([el('div', { text: 'doc body' })], 'Spec - Google Docs');
    const r = sc.smartCapture(base(doc, 'docs.google.com', 'https://docs.google.com/document/d/x/edit'));
    assert.equal(r.blocked, false);
    assert.equal(r.candidate.autoPolicy, 'manual');
  });

  test('unknown host → not auto (ask/manual), envelope still buildable for manual', () => {
    const doc = makeDoc([el('div', { text: 'hello world' })], 'Some Site');
    const r = sc.smartCapture(base(doc, 'random.example', 'https://random.example/page'));
    assert.notEqual(r.candidate.autoPolicy, 'auto');
  });
});

describe('smart-capture — autoEligibleOnly skips extraction for non-coding', () => {
  test('auto pull on Google Docs extracts NOTHING (no body read)', () => {
    const doc = makeDoc([el('div', { text: 'private doc body' })], 'Spec - Google Docs');
    const r = sc.smartCapture({ ...base(doc, 'docs.google.com', 'https://docs.google.com/document/d/x/edit'), autoEligibleOnly: true });
    assert.equal(r.blocked, false);
    assert.equal(r.envelope, null);
    assert.equal(r.dom, '');
  });

  test('auto pull on a LeetCode problem still extracts (auto-eligible)', () => {
    const lines = ['def f(): pass'].map((t) => el('div', { className: 'view-line', text: t }));
    const editor = el('div', { className: 'monaco-editor', children: [el('div', { className: 'view-lines', children: lines })] });
    const doc = makeDoc([el('div', { className: 'elfjS', text: 'Given...\nConstraints:\n1' }), editor], 'Two Sum - LeetCode');
    const r = sc.smartCapture({ ...base(doc, 'leetcode.com', 'https://leetcode.com/problems/two-sum/'), autoEligibleOnly: true });
    assert.ok(r.envelope);
    assert.match(r.dom, /CODE ON PAGE|def f/);
  });

  test('manual capture (autoEligibleOnly=false) extracts non-coding too', () => {
    const doc = makeDoc([el('div', { text: 'doc body' })], 'Spec - Google Docs');
    const r = sc.smartCapture({ ...base(doc, 'docs.google.com', 'https://docs.google.com/document/d/x/edit'), captureMode: 'manual', autoEligibleOnly: false });
    assert.ok(r.envelope);
  });
});

describe('smart-capture — EXPERIMENTAL full-page mode', () => {
  // A long unknown-host body so readability/innerText has real content to grab.
  const longBody = () =>
    el('article', {
      children: [
        el('h1', { text: 'Quarterly Planning Notes' }),
        el('p', { text: 'This is the full readable text of an ordinary, non-sensitive page. '.repeat(8) }),
      ],
    });

  test('full-page mode on an UNKNOWN page → NOT blocked, envelope + non-empty dom', () => {
    const doc = makeDoc([longBody()], 'Planning — Acme Wiki');
    const r = sc.smartCapture({
      ...base(doc, 'wiki.example', 'https://wiki.example/planning'),
      autoEligibleOnly: true,
      fullPageMode: true,
    });
    assert.equal(r.blocked, false);
    assert.ok(r.envelope, 'envelope should be present in full-page mode');
    assert.ok(r.dom.length > 0, 'full page text should be captured');
    assert.match(r.dom, /full readable text/);
  });

  test('same UNKNOWN page WITHOUT full-page mode (autoEligibleOnly) → captures NOTHING', () => {
    const doc = makeDoc([longBody()], 'Planning — Acme Wiki');
    const r = sc.smartCapture({
      ...base(doc, 'wiki.example', 'https://wiki.example/planning'),
      autoEligibleOnly: true,
    });
    assert.equal(r.blocked, false);
    assert.equal(r.envelope, null);
    assert.equal(r.dom, '');
  });

  test('PRIVACY FLOOR: Gmail in full-page mode → STILL blocked (envelope null, dom empty)', () => {
    const doc = makeDoc([el('div', { text: 'inbox' })], 'Gmail');
    const r = sc.smartCapture({
      ...base(doc, 'mail.google.com', 'https://mail.google.com/'),
      autoEligibleOnly: true,
      fullPageMode: true,
    });
    assert.equal(r.blocked, true);
    assert.equal(r.envelope, null);
    assert.equal(r.dom, '');
  });

  test('PRIVACY FLOOR: a page with a password field in full-page mode → STILL blocked', () => {
    const pwd = el('input', { attrs: { type: 'password' } });
    const doc = makeDoc([pwd], 'Login');
    const r = sc.smartCapture({
      ...base(doc, 'acme.com', 'https://acme.com/account'),
      autoEligibleOnly: true,
      fullPageMode: true,
    });
    assert.equal(r.blocked, true);
    assert.equal(r.envelope, null);
    assert.equal(r.dom, '');
  });
});

describe('smart-capture — AI round-trip + extra categories', () => {
  const longBody = () =>
    el('article', {
      children: [
        el('h1', { text: 'Some Heading' }),
        el('p', { text: 'A reasonably long body of readable text for extraction. '.repeat(8) }),
      ],
    });

  test('classifyOnly → builds safeMetadata, reads NO body (envelope null, dom empty)', () => {
    const doc = makeDoc([longBody()], 'Some Page');
    const r = sc.smartCapture({
      ...base(doc, 'wiki.example', 'https://wiki.example/page'),
      autoEligibleOnly: true,
      classifyOnly: true,
    });
    assert.equal(r.blocked, false);
    assert.equal(r.envelope, null);
    assert.equal(r.dom, '');
    assert.ok(r.safeMetadata, 'safeMetadata must be present for the AI round-trip');
    assert.equal(r.safeMetadata.host, 'wiki.example');
  });

  test('classifyOnly on Gmail → blocked, NO safeMetadata (never describe a sensitive page)', () => {
    const doc = makeDoc([el('div', { text: 'inbox' })], 'Gmail');
    const r = sc.smartCapture({
      ...base(doc, 'mail.google.com', 'https://mail.google.com/'),
      autoEligibleOnly: true,
      classifyOnly: true,
    });
    assert.equal(r.blocked, true);
    assert.equal(r.safeMetadata, undefined);
  });

  test('aiApproved → an otherwise-ineligible page gets extracted', () => {
    const doc = makeDoc([longBody()], 'Some Page');
    const r = sc.smartCapture({
      ...base(doc, 'wiki.example', 'https://wiki.example/page'),
      autoEligibleOnly: true,
      aiApproved: true,
    });
    assert.equal(r.blocked, false);
    assert.ok(r.envelope, 'aiApproved should make the page eligible for extraction');
    assert.ok(r.dom.length > 0);
  });

  test('PRIVACY FLOOR: aiApproved CANNOT override the sensitive block', () => {
    const doc = makeDoc([el('div', { text: 'inbox' })], 'Gmail');
    const r = sc.smartCapture({
      ...base(doc, 'mail.google.com', 'https://mail.google.com/'),
      autoEligibleOnly: true,
      aiApproved: true,
    });
    assert.equal(r.blocked, true);
    assert.equal(r.envelope, null);
    assert.equal(r.dom, '');
  });

  test('extraEligibleCategories makes a job-description page auto-eligible', () => {
    // A LinkedIn job page → local category job_description (registry policy 'ask').
    const doc = makeDoc(
      [el('article', { children: [el('p', { text: 'Responsibilities: build things. Requirements: experience. '.repeat(6) })] })],
      'Senior Engineer - Jobs',
    );
    const withoutOptIn = sc.smartCapture({
      ...base(doc, 'linkedin.com', 'https://www.linkedin.com/jobs/view/123'),
      autoEligibleOnly: true,
    });
    // Without the opt-in, a JD page is NOT auto-eligible → nothing captured.
    assert.equal(withoutOptIn.dom, '');

    const withOptIn = sc.smartCapture({
      ...base(doc, 'linkedin.com', 'https://www.linkedin.com/jobs/view/123'),
      autoEligibleOnly: true,
      extraEligibleCategories: new Set(['job_description']),
    });
    assert.equal(withOptIn.candidate.matchedCategory, 'job_description');
    assert.ok(withOptIn.dom.length > 0, 'opt-in JD page should be captured');
  });
});

describe('smart-capture — FINAL-REVIEW MEDIUM fixes', () => {
  test('codingEnabled:false drops the coding branch — a LeetCode page is NOT captured', () => {
    const lines = ['def f(): pass'].map((t) => el('div', { className: 'view-line', text: t }));
    const editor = el('div', { className: 'monaco-editor', children: [el('div', { className: 'view-lines', children: lines })] });
    const stmt = el('div', { className: 'elfjS', text: 'Given...\nConstraints:\n1' });
    const doc = makeDoc([stmt, editor], 'Two Sum - LeetCode');

    // Coding ON (default) → captured.
    const on = sc.smartCapture({ ...base(doc, 'leetcode.com', 'https://leetcode.com/problems/two-sum/'), autoEligibleOnly: true });
    assert.ok(on.dom.length > 0);

    // Coding OFF → the high-confidence coding page is NOT eligible → nothing captured.
    const off = sc.smartCapture({ ...base(doc, 'leetcode.com', 'https://leetcode.com/problems/two-sum/'), autoEligibleOnly: true, codingEnabled: false });
    assert.equal(off.blocked, false);
    assert.equal(off.dom, '');
    assert.equal(off.envelope, null);
  });

  test('codingEnabled:false still lets an opted-in JD page through (other paths unaffected)', () => {
    const doc = makeDoc(
      [el('article', { children: [el('p', { text: 'Responsibilities: build. Requirements: experience. '.repeat(6) })] })],
      'Engineer - Jobs',
    );
    const r = sc.smartCapture({
      ...base(doc, 'linkedin.com', 'https://www.linkedin.com/jobs/view/123'),
      autoEligibleOnly: true,
      codingEnabled: false,
      extraEligibleCategories: new Set(['job_description']),
    });
    assert.equal(r.candidate.matchedCategory, 'job_description');
    assert.ok(r.dom.length > 0);
  });

  test('dev-docs over-match fix: an internal /api page on an unknown host is NOT classified developer_docs', () => {
    // internal.corp.com/api/patients — only "doc-like" feature is the /api token.
    const doc = makeDoc([el('div', { text: 'patient records' })], 'Patients');
    const r = sc.smartCapture({
      ...base(doc, 'internal.corp.com', 'https://internal.corp.com/api/patients'),
      autoEligibleOnly: true,
      extraEligibleCategories: new Set(['developer_docs']),
    });
    // Must NOT become developer_docs (host not in the registry) → not captured.
    assert.notEqual(r.candidate.matchedCategory, 'developer_docs');
    assert.equal(r.dom, '');
  });

  test('dev-docs still works on a known docs HOST (MDN)', () => {
    const doc = makeDoc(
      [el('article', { children: [el('p', { text: 'The fetch() method... parameters... returns... '.repeat(6) })] })],
      'fetch - MDN',
    );
    const r = sc.smartCapture({
      ...base(doc, 'developer.mozilla.org', 'https://developer.mozilla.org/en-US/docs/Web/API/fetch'),
      autoEligibleOnly: true,
      extraEligibleCategories: new Set(['developer_docs']),
    });
    assert.equal(r.candidate.matchedCategory, 'developer_docs');
    assert.ok(r.dom.length > 0);
  });
});
