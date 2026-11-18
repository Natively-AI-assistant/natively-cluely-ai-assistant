// LicenseManager says WHY it could not reach the server (2026-11-18, issue #759).
//
// A Windows customer's Pro never activated and the log read only
// "activateWithApiKey network error: fetch failed": a certificate failure and
// being offline looked the same. The user still sees the same friendly message;
// only the log line gains the reason.
//
// Run with: npm run build:electron && node --test electron/services/__tests__/LicenseNetworkCauseLogged2026_11_18.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-license-cause-'));
process.env.NATIVELY_TEST_USERDATA = USER_DATA;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const electronStub = path.join(HERE, '__electron_license_stub.mjs');
const nativeStub = path.join(HERE, '__native_module_stub.cjs');
createRequire(import.meta.url)(nativeStub);

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  if (typeof request === 'string' && request.endsWith('.node')) return nativeStub;
  return originalResolve.call(this, request, ...rest);
};

const { LicenseManager } = await import('../../../dist-electron/premium/electron/services/LicenseManager.js');

const originalFetch = globalThis.fetch;
const originalError = console.error;
after(() => {
  Module._resolveFilename = originalResolve;
  globalThis.fetch = originalFetch;
  console.error = originalError;
  fs.rmSync(USER_DATA, { recursive: true, force: true });
});

test('activateWithApiKey logs the certificate failure behind "fetch failed"', async () => {
  delete globalThis.__nativelyLicenseManagerV1__;
  LicenseManager.instance = undefined;
  const manager = LicenseManager.getInstance();

  const cause = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
  globalThis.fetch = async () => { throw new TypeError('fetch failed', { cause }); };
  const lines = [];
  console.error = (...args) => { lines.push(args.map(String).join(' ')); };

  const result = await manager.activateWithApiKey('natively_sk_abcdefghijklmnopqrstuvwxyz0123');
  console.error = originalError;

  assert.equal(result.success, false);
  assert.equal(result.error, 'Could not reach server. Please try again.', 'the user-facing message is unchanged');
  const line = lines.find((l) => l.includes('activateWithApiKey network error'));
  assert.ok(line, `no network-error line in: ${JSON.stringify(lines)}`);
  assert.match(line, /fetch failed · cause: CERT_HAS_EXPIRED/);
  assert.doesNotMatch(line, /abcdefghijklmnopqrstuvwxyz0123/, 'the key never reaches the log');
});
