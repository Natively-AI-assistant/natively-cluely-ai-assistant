// natively-browser/src/__tests__/permissions.test.mjs
//
// Tests the optional-host-permission flow: request, already-granted short
// circuit, and the DENIED path (which must resolve gracefully, never throw, so
// manual capture keeps working). Fake chrome.permissions API injected.
//
// Run: npm run build:test && node --test src/__tests__/permissions.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/capture/permissions.js');
const { requestCodingHostPermissions, hasCodingHostPermissions, codingOrigins } =
  await import(pathToFileURL(modPath).href);

function fakeApi({ contains = false, request = true, throwOn = null } = {}) {
  return {
    calls: { contains: 0, request: 0 },
    async contains() {
      this.calls.contains++;
      if (throwOn === 'contains') throw new Error('boom');
      return contains;
    },
    async request() {
      this.calls.request++;
      if (throwOn === 'request') throw new Error('boom');
      return request;
    },
  };
}

describe('coding host permissions', () => {
  test('codingOrigins includes known coding platforms, excludes blocked hosts', () => {
    const o = codingOrigins();
    assert.ok(o.some((x) => x.includes('leetcode.com')));
    assert.ok(o.some((x) => x.includes('coderpad.io')));
    assert.ok(!o.some((x) => x.includes('mail.google.com')));
    assert.ok(!o.includes('<all_urls>'));
  });

  test('grant path: not-yet-had, request succeeds', async () => {
    const api = fakeApi({ contains: false, request: true });
    const r = await requestCodingHostPermissions(api, ['https://leetcode.com/*']);
    assert.equal(r.granted, true);
    assert.equal(r.alreadyHad, false);
    assert.equal(api.calls.request, 1);
  });

  test('already-granted short-circuits without a request', async () => {
    const api = fakeApi({ contains: true });
    const r = await requestCodingHostPermissions(api, ['https://leetcode.com/*']);
    assert.equal(r.granted, true);
    assert.equal(r.alreadyHad, true);
    assert.equal(api.calls.request, 0);
  });

  test('DENIED path resolves gracefully (granted:false, no throw)', async () => {
    const api = fakeApi({ contains: false, request: false });
    const r = await requestCodingHostPermissions(api, ['https://leetcode.com/*']);
    assert.equal(r.granted, false);
    assert.ok(r.reason && r.reason.includes('denied'));
  });

  test('API throw is swallowed into granted:false, never propagates', async () => {
    const api = fakeApi({ throwOn: 'request' });
    const r = await requestCodingHostPermissions(api, ['https://leetcode.com/*']);
    assert.equal(r.granted, false);
  });

  test('empty origin list is a no-op grant', async () => {
    const api = fakeApi();
    const r = await requestCodingHostPermissions(api, []);
    assert.equal(r.granted, true);
    assert.equal(api.calls.contains, 0);
  });

  test('hasCodingHostPermissions reflects contains()', async () => {
    assert.equal(await hasCodingHostPermissions(fakeApi({ contains: true }), ['https://leetcode.com/*']), true);
    assert.equal(await hasCodingHostPermissions(fakeApi({ contains: false }), ['https://leetcode.com/*']), false);
  });

  test('hasCodingHostPermissions returns false on API error (safe default)', async () => {
    assert.equal(await hasCodingHostPermissions(fakeApi({ throwOn: 'contains' }), ['https://leetcode.com/*']), false);
  });
});

// ── Per-origin, on-demand host grant (2026-08-02) ───────────────────────────
// The optional-permission list above is the CODING registry (~44 fixed hosts).
// Any other site the user is actually looking at — a ChatGPT thread, a YouTube
// page, an internal wiki — could never be captured by the desktop pull, because
// nothing anywhere requested its origin. These cover the narrow per-site grant
// that fixes it, and pin the "never widen the grant" invariant.
const { requestOriginPermission, originPatternFromUrl } = await import(pathToFileURL(modPath).href);

describe('originPatternFromUrl', () => {
  test('narrows a real page URL to a host-scoped pattern', () => {
    assert.equal(originPatternFromUrl('https://www.youtube.com/shorts/abc?t=1'), 'https://www.youtube.com/*');
    assert.equal(originPatternFromUrl('https://chatgpt.com/c/6a6e-31c0'), 'https://chatgpt.com/*');
    assert.equal(originPatternFromUrl('http://localhost:3000/x/y'), 'http://localhost:3000/*');
  });

  test('never widens to a wildcard subdomain or <all_urls>', () => {
    const p = originPatternFromUrl('https://docs.corp.example.com/secret');
    assert.equal(p, 'https://docs.corp.example.com/*');
    assert.ok(!p.includes('*.'));
    assert.ok(!p.includes('<all_urls>'));
  });

  test('port is part of the host and is preserved', () => {
    assert.equal(originPatternFromUrl('http://127.0.0.1:8080/a'), 'http://127.0.0.1:8080/*');
  });

  test('refuses non-http(s) and malformed URLs', () => {
    for (const u of ['chrome://extensions', 'file:///etc/passwd', 'about:blank',
                     'devtools://devtools/x', 'view-source:https://a.com', 'not a url', '', null, undefined]) {
      assert.equal(originPatternFromUrl(u), null, `should refuse: ${String(u)}`);
    }
  });
});

describe('requestOriginPermission', () => {
  test('requests exactly the one origin given — never the coding list', async () => {
    const api = fakeApi({ contains: false, request: true });
    let seen = null;
    api.request = async function (p) { this.calls.request++; seen = p; return true; };
    const r = await requestOriginPermission(api, 'https://chatgpt.com/*');
    assert.equal(r.granted, true);
    assert.deepEqual(seen, { origins: ['https://chatgpt.com/*'] });
  });

  test('already-granted short circuits without prompting', async () => {
    const api = fakeApi({ contains: true });
    const r = await requestOriginPermission(api, 'https://chatgpt.com/*');
    assert.equal(r.granted, true);
    assert.equal(r.alreadyHad, true);
    assert.equal(api.calls.request, 0);
  });

  test('denial resolves gracefully — never throws', async () => {
    const api = fakeApi({ contains: false, request: false });
    const r = await requestOriginPermission(api, 'https://chatgpt.com/*');
    assert.equal(r.granted, false);
    assert.ok(r.reason && r.reason.includes('denied'));
  });

  test('API throw is swallowed into granted:false', async () => {
    const r = await requestOriginPermission(fakeApi({ throwOn: 'request' }), 'https://chatgpt.com/*');
    assert.equal(r.granted, false);
  });

  test('empty origin is refused without touching the API', async () => {
    const api = fakeApi();
    const r = await requestOriginPermission(api, '');
    assert.equal(r.granted, false);
    assert.equal(api.calls.contains, 0);
    assert.equal(api.calls.request, 0);
  });
});
