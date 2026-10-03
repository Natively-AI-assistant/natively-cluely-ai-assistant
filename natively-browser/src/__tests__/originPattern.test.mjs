// natively-browser/src/__tests__/originPattern.test.mjs
//
// Unit tests for capture/originPattern.ts — originPatternFromUrl(), which turns
// a tab URL into the narrowest host-scoped match pattern to request permission
// for. Imports the standalone compiled module from dist-test/ (the service
// worker's import path), not the re-export through permissions.ts.
//
// Run (from natively-browser/): npm run build:test && node --test src/__tests__/originPattern.test.mjs
// (or just: npm test)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/capture/originPattern.js');
const { originPatternFromUrl } = await import(pathToFileURL(modPath).href);

describe('originPatternFromUrl — http(s) pages', () => {
  test('drops path, query and fragment, keeping scheme and host', () => {
    assert.equal(originPatternFromUrl('https://www.youtube.com/shorts/abc?t=1'), 'https://www.youtube.com/*');
    assert.equal(originPatternFromUrl('https://example.com/a/b/c.html#section'), 'https://example.com/*');
  });

  test('a bare origin with or without a trailing slash gives the same pattern', () => {
    assert.equal(originPatternFromUrl('https://example.com'), 'https://example.com/*');
    assert.equal(originPatternFromUrl('https://example.com/'), 'https://example.com/*');
  });

  test('http stays http — the scheme is never widened or upgraded', () => {
    assert.equal(originPatternFromUrl('http://example.com/page'), 'http://example.com/*');
  });

  test('keeps the exact subdomain and never introduces a wildcard host', () => {
    const p = originPatternFromUrl('https://docs.corp.example.com/secret');
    assert.equal(p, 'https://docs.corp.example.com/*');
    assert.equal(p.includes('*.'), false);
    assert.equal(p.includes('://*'), false);
  });

  test('sibling subdomains produce different patterns', () => {
    assert.notEqual(
      originPatternFromUrl('https://a.example.com/'),
      originPatternFromUrl('https://b.example.com/'),
    );
  });

  test('keeps a non-default port', () => {
    assert.equal(originPatternFromUrl('http://localhost:3000/x/y'), 'http://localhost:3000/*');
    assert.equal(originPatternFromUrl('https://example.com:8443/'), 'https://example.com:8443/*');
  });

  test('omits the default port for the scheme', () => {
    assert.equal(originPatternFromUrl('https://example.com:443/a'), 'https://example.com/*');
    assert.equal(originPatternFromUrl('http://example.com:80/a'), 'http://example.com/*');
  });

  test('normalises scheme and host case', () => {
    assert.equal(originPatternFromUrl('HTTPS://WWW.Example.COM/Path'), 'https://www.example.com/*');
  });

  test('never leaks embedded credentials into the pattern', () => {
    assert.equal(originPatternFromUrl('https://user:secret@example.com/private'), 'https://example.com/*');
  });

  test('handles IPv4 and bracketed IPv6 hosts', () => {
    assert.equal(originPatternFromUrl('http://127.0.0.1:8080/a'), 'http://127.0.0.1:8080/*');
    assert.equal(originPatternFromUrl('http://[::1]:5173/app'), 'http://[::1]:5173/*');
  });

  test('tolerates surrounding whitespace', () => {
    assert.equal(originPatternFromUrl('  https://example.com/a  '), 'https://example.com/*');
  });

  test('accepts a URL object as well as a string', () => {
    assert.equal(originPatternFromUrl(new URL('https://example.com/a?b=1')), 'https://example.com/*');
  });

  test('every pattern is scheme://host/* with exactly one wildcard', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=1',
      'http://localhost:3000/',
      'https://sub.domain.example.co.uk/deep/path?x=*',
    ]) {
      const p = originPatternFromUrl(url);
      assert.match(p, /^https?:\/\/[^/*]+\/\*$/, url);
      assert.equal(p.split('*').length - 1, 1, url);
    }
  });
});

describe('originPatternFromUrl — refuses anything that is not a real http(s) page', () => {
  for (const url of [
    'chrome://extensions/',
    'chrome-extension://abcdefghijklmnop/popup.html',
    'file:///Users/someone/notes.html',
    'about:blank',
    'devtools://devtools/bundled/inspector.html',
    'view-source:https://example.com/',
    'data:text/html,<h1>x</h1>',
    'javascript:alert(1)',
    'blob:https://example.com/5f3c2a',
    'ftp://example.com/file.txt',
    'ws://example.com/socket',
    'edge://settings',
  ]) {
    test(`null for ${url}`, () => {
      assert.equal(originPatternFromUrl(url), null);
    });
  }

  for (const [label, value] of [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a plain object', {}],
    ['a bare hostname with no scheme', 'example.com'],
    ['a relative path', '/just/a/path'],
    ['free text', 'not a url'],
    ['a scheme with no host', 'https://'],
    ['a scheme-relative URL', '//example.com/a'],
  ]) {
    test(`null for ${label} (never throws)`, () => {
      assert.equal(originPatternFromUrl(value), null);
    });
  }
});
