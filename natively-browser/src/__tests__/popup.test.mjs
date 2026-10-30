// natively-browser/src/__tests__/popup.test.mjs
//
// The toolbar popup, in the website's look (heynatively.com/companion shows
// it): the shortcut keycaps name the reader's modifier, and the markup holds
// every element the popup's script looks up.
//
// Run (from natively-browser/): npm test

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const { modifierKeyLabel, browserPlatform } = await import(
  pathToFileURL(path.resolve(__dirname, '../../dist-test/hotkey-label.js')).href
);

describe('shortcut keycaps', () => {
  test('macOS shows ⌘', () => {
    for (const p of ['macOS', 'MacIntel', 'Macintosh']) assert.equal(modifierKeyLabel(p), '⌘', p);
  });

  test('Windows shows Ctrl', () => {
    for (const p of ['Windows', 'Win32', 'Win64']) assert.equal(modifierKeyLabel(p), 'Ctrl', p);
  });

  test('elsewhere CommandOrControl is Ctrl too, and an unknown platform says Ctrl', () => {
    for (const p of ['Linux', 'Linux x86_64', 'Chrome OS', '', undefined]) assert.equal(modifierKeyLabel(p), 'Ctrl', String(p));
  });

  test('Client Hints win over the legacy navigator.platform', () => {
    assert.equal(browserPlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }), 'Windows');
    assert.equal(browserPlatform({ userAgentData: { platform: '' }, platform: 'MacIntel' }), 'MacIntel');
    assert.equal(browserPlatform({ platform: 'Win32' }), 'Win32');
    assert.equal(browserPlatform({}), '');
  });
});

describe('popup markup', () => {
  const html = src('popup.html');
  const ts = src('popup.ts');

  test('every element the script looks up is in the page, once', () => {
    const ids = [...ts.matchAll(/\$(?:<[^>]+>)?\('([A-Za-z]+)'\)/g)].map((m) => m[1]);
    assert.ok(ids.length >= 12, `found ${ids.length} lookups`);
    for (const id of ids) {
      assert.equal(html.split(`id="${id}"`).length - 1, 1, `#${id}`);
    }
  });

  test('both hotkeys are keycap rows whose modifier the script fills in', () => {
    assert.equal((html.match(/<kbd data-mod>/g) || []).length, 2);
    assert.match(ts, /querySelectorAll<HTMLElement>\('kbd\[data-mod\]'\)/);
  });

  test('nothing is loaded from the network, and the wordmark is inline', () => {
    assert.doesNotMatch(html, /(?:src|href)="https?:/);
    assert.match(html, /<svg class="brand-word" role="img" aria-label="natively"/);
  });

  test('connected and set up, nothing extra shows: no status, no setup card', () => {
    // The status pill and both permission rows start hidden; the script shows
    // them only when something needs doing.
    assert.match(html, /id="statusText" class="status hidden"/);
    assert.match(html, /id="allSitesRow" class="setup-row hidden"/);
    assert.match(html, /id="meetNamesRow" class="setup-row hidden"/);
    assert.match(html, /\.setup:not\(:has\(\.setup-row:not\(\.hidden\)\)\) \{ display: none; \}/);
    assert.match(ts, /setStatus\(wsOpen \? null : 'Connecting'\)/);
  });
});
