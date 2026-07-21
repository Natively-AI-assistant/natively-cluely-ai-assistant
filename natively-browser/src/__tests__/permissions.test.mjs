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
