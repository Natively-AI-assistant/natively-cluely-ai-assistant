// natively-browser/src/__tests__/extract.test.mjs
//
// Unit tests for the pure DOM->clean-text extractor. Imports the compiled
// module from dist-test/ (built by esbuild.test.mjs), matching the main repo's
// "import compiled JS from a dist dir" convention.
//
// Run: npm run build:test && node --test src/__tests__/extract.test.mjs
// (or just: npm test)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/extract.js');
const { extractPageContent, DOM_CONTEXT_MAX_CHARS } = await import(pathToFileURL(modPath).href);

// ---- Minimal fake DOM -------------------------------------------------------
// We only implement the surface extract.ts touches: title, body (clone +
// querySelectorAll + innerText/textContent), querySelectorAll('h1,h2,h3'),
// and cloneNode for the document (Readability path is injected separately).

function makeEl(tagName, text, children = []) {
  const el = {
    tagName: tagName.toUpperCase(),
    textContent: text,
    children,
    parentNode: null,
    querySelectorAll(sel) {
      const tags = sel.split(',').map((s) => s.trim().toUpperCase());
      const out = [];
      const walk = (node) => {
        for (const c of node.children || []) {
          if (tags.includes(c.tagName)) out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out;
    },
    cloneNode() {
      return makeEl(tagName, text, children.map((c) => c.cloneNode()));
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
    },
  };
  for (const c of children) c.parentNode = el;
  return el;
}

function makeDoc({ title = '', bodyText = '', headings = [], bodyChildren = [] } = {}) {
  const headingEls = headings.map((h) => makeEl(h.tag, h.text));
  const body = makeEl('body', bodyText, [...headingEls, ...bodyChildren]);
  body.innerText = bodyText;
  const doc = {
    title,
    body,
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    cloneNode() {
      // Return a shallow doc clone; Readability factory is injected, so the
      // clone only needs to be a distinct object for the non-Readability paths.
      return makeDoc({ title, bodyText, headings, bodyChildren });
    },
  };
  return doc;
}

describe('extractPageContent', () => {
  test('Readability path produces clean title + body', () => {
    const doc = makeDoc({ title: 'Raw Page Title', bodyText: 'noisy nav menu footer' });
    const r = extractPageContent({
      document: doc,
      readabilityFactory: () => ({
        parse: () => ({ title: 'Clean Article Title', textContent: 'The real article body text.' }),
      }),
      getSelection: () => '',
    });
    assert.equal(r.source, 'readability');
    assert.match(r.text, /TITLE: Clean Article Title/);
    assert.match(r.text, /The real article body text\./);
    assert.equal(r.title, 'Clean Article Title');
  });

  test('falls back to innerText when Readability returns null', () => {
    const doc = makeDoc({ title: 'App Page', bodyText: 'Dashboard widget content here' });
    const r = extractPageContent({
      document: doc,
      readabilityFactory: () => ({ parse: () => null }),
      getSelection: () => '',
    });
    assert.equal(r.source, 'innertext');
    assert.match(r.text, /Dashboard widget content here/);
    assert.match(r.text, /TITLE: App Page/);
  });

  test('falls back to innerText when Readability throws', () => {
    const doc = makeDoc({ title: 'T', bodyText: 'body body body' });
    const r = extractPageContent({
      document: doc,
      readabilityFactory: () => ({
        parse: () => {
          throw new Error('readability blew up');
        },
      }),
      getSelection: () => '',
    });
    assert.equal(r.source, 'innertext');
    assert.match(r.text, /body body body/);
  });

  test('prepends title, selection, and heading outline', () => {
    const doc = makeDoc({
      title: 'My Doc',
      bodyText: 'paragraph text',
      headings: [
        { tag: 'h1', text: 'Top Heading' },
        { tag: 'h2', text: 'Sub Heading' },
        { tag: 'h3', text: 'Deep Heading' },
      ],
    });
    const r = extractPageContent({
      document: doc,
      readabilityFactory: () => ({ parse: () => null }),
      getSelection: () => 'the user highlighted this',
    });
    assert.match(r.text, /TITLE: My Doc/);
    assert.match(r.text, /SELECTED TEXT:\nthe user highlighted this/);
    assert.match(r.text, /HEADINGS:/);
    assert.match(r.text, /Top Heading/);
    assert.match(r.text, /  Sub Heading/);
    assert.match(r.text, /    Deep Heading/);
    // Ordering: front matter precedes the body separator.
    assert.ok(r.text.indexOf('TITLE:') < r.text.indexOf('---'));
    assert.ok(r.text.indexOf('paragraph text') > r.text.indexOf('---'));
  });

  test('caps at DOM_CONTEXT_MAX_CHARS and keeps front matter at the front', () => {
    const hugeBody = 'B'.repeat(60000);
    const doc = makeDoc({ title: 'KeepMe', bodyText: hugeBody });
    const r = extractPageContent({
      document: doc,
      readabilityFactory: () => ({ parse: () => ({ title: 'KeepMe', textContent: hugeBody }) }),
      getSelection: () => 'KEEP THIS SELECTION',
    });
    assert.equal(r.text.length, DOM_CONTEXT_MAX_CHARS);
    assert.equal(DOM_CONTEXT_MAX_CHARS, 25000);
    // Front matter survives the trim.
    assert.match(r.text.slice(0, 200), /TITLE: KeepMe/);
    assert.match(r.text.slice(0, 200), /KEEP THIS SELECTION/);
    // Body was trimmed from the end (only B's after the separator).
    assert.ok(r.text.endsWith('B'));
  });

  test('empty document yields empty source', () => {
    const doc = makeDoc({ title: '', bodyText: '' });
    const r = extractPageContent({
      document: doc,
      readabilityFactory: () => ({ parse: () => null }),
      getSelection: () => '',
    });
    assert.equal(r.source, 'empty');
    assert.equal(r.text, '');
  });

  test('does not mutate the live document (Readability gets a clone)', () => {
    const doc = makeDoc({ title: 'T', bodyText: 'x' });
    let parsedDoc = null;
    extractPageContent({
      document: doc,
      readabilityFactory: (d) => {
        parsedDoc = d;
        return { parse: () => ({ title: 'T', textContent: 'clean' }) };
      },
      getSelection: () => '',
    });
    assert.notEqual(parsedDoc, doc, 'Readability must receive a clone, not the live doc');
  });
});
