// 2026-11-21. A customer pasted a valid natively_sk_ key from the key email and
// got "network: error sending request for url (https://api.gumroad.com/v2/licenses/verify)".
// The pasted text did not start with natively_sk_, so it skipped the Natively API
// route, went to Dodo, then Gumroad, and the Gumroad network failure was shown.
//
// Now: the key is pulled out of whatever was pasted, and text that is meant as a
// Natively key but is unusable is refused WITHOUT ever being sent to Dodo/Gumroad.
// A genuine Gumroad/Dodo key is untouched.
//
// Runs the compiled LicenseManager with the fake native module (as
// LicenseNativeModulePresent.test.mjs). No process.platform branch is involved:
// the routing is identical on macOS and Windows, so one run covers both.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pasted-key-'));
process.env.NATIVELY_TEST_USERDATA = USER_DATA;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const electronStub = path.join(HERE, '__electron_license_stub.mjs');
const nativeStub = path.join(HERE, '__native_module_stub.cjs');
const { control: native } = createRequire(import.meta.url)(nativeStub);

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  if (typeof request === 'string' && request.endsWith('.node')) return nativeStub;
  return originalResolve.call(this, request, ...rest);
};

const { LicenseManager } = await import('../../../dist-electron/premium/electron/services/LicenseManager.js');
const { normalizePastedKey, looksLikeNativelyKey } = await import(
  '../../../dist-electron/premium/electron/services/licenseVerifyPolicy.js'
);

const KEY = 'natively_sk_CENo5bzrIyek9ex0qGKIXUzV9bRTHp306F2ZDj7A';
const originalFetch = globalThis.fetch;
let fetched;

function freshManager() {
  delete globalThis.__nativelyLicenseManagerV1__;
  LicenseManager.instance = undefined;
  return LicenseManager.getInstance();
}

beforeEach(() => {
  fs.rmSync(path.join(USER_DATA, 'license.enc'), { force: true });
  native.reset();
  fetched = [];
  // The server refuses the key: nothing is stored, and the call is recorded.
  globalThis.fetch = async (url, init) => {
    fetched.push({ url: String(url), key: init?.headers?.['x-natively-key'] });
    return new Response(JSON.stringify({ ok: false, error: 'key_not_found' }), { status: 404 });
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  Module._resolveFilename = originalResolve;
  fs.rmSync(USER_DATA, { recursive: true, force: true });
});

describe('normalizePastedKey', () => {
  test('a clean key is unchanged', () => {
    assert.equal(normalizePastedKey(KEY), KEY);
  });

  for (const [name, pasted] of [
    ['straight quotes', `"${KEY}"`],
    ['curly quotes', `“${KEY}”`],
    ['quoted-reply marker', `> ${KEY}`],
    ['angle brackets', `<${KEY}>`],
    ['zero-width space in front', `​${KEY}`],
    ['zero-width space inside the prefix gap', `﻿  ${KEY}​ `],
    ['trailing full stop', `${KEY}.`],
    ['key on a line with its label', `Here's your API key:\n\n${KEY}\n\nOpen Natively, go to Settings`],
    ['upper-case prefix', KEY.replace('natively_sk_', 'NATIVELY_SK_')],
  ]) {
    test(`pulls the key out of: ${name}`, () => {
      assert.equal(normalizePastedKey(pasted), KEY);
    });
  }

  test('a Gumroad-style key is only cleaned, never rewritten', () => {
    assert.equal(normalizePastedKey('  "ABCD1234-EFGH5678-IJKL9012-MNOP3456" ​'), 'ABCD1234-EFGH5678-IJKL9012-MNOP3456');
  });

  test('non-strings and blanks become an empty string', () => {
    assert.equal(normalizePastedKey(undefined), '');
    assert.equal(normalizePastedKey(null), '');
    assert.equal(normalizePastedKey('  ​ '), '');
  });

  test('looksLikeNativelyKey: Natively text yes, Gumroad/Dodo keys no', () => {
    assert.equal(looksLikeNativelyKey('natively_sk_'), true);
    assert.equal(looksLikeNativelyKey('natively-sk-abc'), true);
    assert.equal(looksLikeNativelyKey('ABCD1234-EFGH5678-IJKL9012-MNOP3456'), false);
  });
});

describe('activateLicense routing', () => {
  test('a key pasted inside quotes and a quote marker still goes to the Natively API, not Dodo/Gumroad', async () => {
    const res = await freshManager().activateLicense(`> "${KEY}"`);
    assert.equal(fetched.length, 1, 'the Natively API was asked');
    assert.match(fetched[0].url, /\/v1\/pro\/verify$/);
    assert.equal(fetched[0].key, KEY, 'the clean key was sent, not the pasted text');
    assert.equal(native.calls.verifyDodo.length, 0);
    assert.equal(native.calls.verifyGumroad.length, 0);
    assert.equal(res.success, false);
    assert.doesNotMatch(String(res.error), /gumroad|network:/i);
  });

  test('a zero-width character in front no longer sends the key to Gumroad', async () => {
    await freshManager().activateLicense(`​${KEY}`);
    assert.equal(fetched[0]?.key, KEY);
    assert.equal(native.calls.verifyGumroad.length, 0);
  });

  test('a cut-short Natively key (prefix incomplete) is refused with a plain message, and never reaches Dodo or Gumroad', async () => {
    native.verifyGumroad = 'ERR:gumroad:network: error sending request for url (https://api.gumroad.com/v2/licenses/verify)';
    const res = await freshManager().activateLicense('natively_sk');
    assert.equal(res.success, false);
    assert.match(res.error, /complete Natively API key/);
    assert.doesNotMatch(res.error, /gumroad|network:/i);
    assert.equal(native.calls.verifyDodo.length, 0);
    assert.equal(native.calls.verifyGumroad.length, 0);
    assert.equal(fetched.length, 0);
  });

  test('the bare prefix goes to the Natively API (which refuses it), never to Gumroad', async () => {
    native.verifyGumroad = 'ERR:gumroad:network: error sending request for url (https://api.gumroad.com/v2/licenses/verify)';
    const res = await freshManager().activateLicense('natively_sk_');
    assert.equal(res.success, false);
    assert.doesNotMatch(res.error, /gumroad|network:/i);
    assert.equal(native.calls.verifyDodo.length, 0);
    assert.equal(native.calls.verifyGumroad.length, 0);
  });

  test('a mistyped prefix is refused the same way', async () => {
    const res = await freshManager().activateLicense('natively-sk-CENo5bzrIyek9ex0qGKIXUzV');
    assert.match(res.error, /complete Natively API key/);
    assert.equal(native.calls.verifyGumroad.length, 0);
  });

  test('a real Gumroad key still takes the Dodo then Gumroad path (regression guard)', async () => {
    native.verifyGumroad = 'ERR:gumroad:invalid';
    const res = await freshManager().activateLicense(' "ABCD1234-EFGH5678-IJKL9012-MNOP3456" ');
    assert.equal(native.calls.verifyDodo.length, 1);
    assert.equal(native.calls.verifyGumroad.length, 1);
    assert.equal(native.calls.verifyGumroad[0].key, 'ABCD1234-EFGH5678-IJKL9012-MNOP3456');
    assert.equal(fetched.length, 0);
    assert.equal(res.success, false);
  });
});
