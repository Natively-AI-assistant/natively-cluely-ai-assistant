// Pure tab-selection logic: isCapturable + pickBestTab. No browser/chrome stub.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/service-worker.js');
const { isCapturable, pickBestTab, LAST_ACTIVE_TTL_MS } = await import(pathToFileURL(modPath).href);

describe('isCapturable', () => {
  test('accepts a normal web page', () => {
    assert.equal(isCapturable({ id: 1, url: 'https://leetcode.com/problems/two-sum' }), true);
    assert.equal(isCapturable({ id: 2, url: 'http://localhost:3000/app' }), true);
  });
  test('rejects internal / extension / devtools / view-source / NTP', () => {
    for (const url of [
      'chrome://newtab', 'chrome://settings', 'edge://settings', 'about:blank',
      'chrome-extension://abc/page.html', 'devtools://devtools/bundled/x.html',
      'view-source:https://x.com', 'chrome-untrusted://foo', 'moz-extension://x',
    ]) {
      assert.equal(isCapturable({ id: 1, url }), false, url);
    }
  });
  test('rejects incognito tabs', () => {
    assert.equal(isCapturable({ id: 1, url: 'https://x.com', incognito: true }), false);
  });
  test('rejects missing id or url', () => {
    assert.equal(isCapturable({ url: 'https://x.com' }), false);
    assert.equal(isCapturable({ id: 1 }), false);
    assert.equal(isCapturable(undefined), false);
    assert.equal(isCapturable(null), false);
  });
});

describe('pickBestTab', () => {
  const now = 1_000_000_000;
  const fresh = (over = {}) => ({ tabId: 7, ts: now - 1000, ...over });

  test('prefers a fresh last-active tab that is still an active capturable tab', () => {
    const windows = [
      { id: 3, url: 'https://a.com', active: true },
      { id: 7, url: 'https://leetcode.com', active: true },
    ];
    assert.equal(pickBestTab(fresh(), windows, now), 7);
  });

  test('falls through when last-active is stale (> TTL) → first capturable window', () => {
    const stale = fresh({ ts: now - LAST_ACTIVE_TTL_MS - 1 });
    const windows = [
      { id: 3, url: 'https://a.com', active: true },
      { id: 7, url: 'https://leetcode.com', active: true },
    ];
    assert.equal(pickBestTab(stale, windows, now), 3); // last-focused window first
  });

  test('falls through when the last-active tab was closed (not in window set)', () => {
    const windows = [{ id: 9, url: 'https://b.com', active: true }];
    assert.equal(pickBestTab(fresh({ tabId: 7 }), windows, now), 9);
  });

  test('falls through an internal active tab to the next capturable window', () => {
    const windows = [
      { id: 3, url: 'chrome://newtab', active: true }, // last-focused but not capturable
      { id: 7, url: 'https://leetcode.com', active: true },
    ];
    assert.equal(pickBestTab(null, windows, now), 7);
  });

  test('returns null when nothing is capturable', () => {
    const windows = [
      { id: 3, url: 'chrome://newtab', active: true },
      { id: 4, url: 'devtools://x', active: true },
    ];
    assert.equal(pickBestTab(null, windows, now), null);
    assert.equal(pickBestTab(null, [], now), null);
  });

  test('does not pick a stale last-active even if present & capturable', () => {
    // Staleness must force a live re-pick, not trust the old id.
    const stale = { tabId: 7, ts: now - LAST_ACTIVE_TTL_MS - 1 };
    const windows = [
      { id: 5, url: 'https://current.com', active: true },
      { id: 7, url: 'https://old.com', active: true },
    ];
    assert.equal(pickBestTab(stale, windows, now), 5);
  });
});
