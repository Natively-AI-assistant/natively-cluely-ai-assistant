// activateWithApiKey must tell three different failures apart.
//
// From a 2026-08-27 win32 user report: the log read
//   [LicenseManager] activateWithApiKey: plan has no Pro — undefined
//   [IPC] set-natively-api-key: Pro not activated — Your plan does not include Natively Pro.
// The user was NOT on a free plan. natively-api's /v1/pro/verify (server.js:5716)
// always emits `plan` on its success path (`auth.user.plan || 'standard'`), so a
// genuine standard-plan user logs "— standard". `undefined` can only come from
// the !auth.ok branch, which returns {ok:false, error} with NO plan field. The
// server had REFUSED the key; the old `if (!data.ok || !data.has_pro)` read that
// body as a plan verdict, discarded the server's actual reason (and its
// account-specific `message`), and reported a wrong, unactionable cause.
//
// The distinction matters beyond the message. /v1/chat authenticates through the
// same validateKey and has NO plan gate — PRO_PLANS is referenced only by
// /v1/pro/verify — so:
//   - refused key (4xx)  → authenticates nowhere; the caller must undo any
//                          auto-promotion it made on the strength of this key
//   - no Pro    (200)    → chat still works; app state must NOT change
//   - 5xx / bad body     → no verdict at all; app state must NOT change
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-license-verdict-'));
process.env.NATIVELY_TEST_USERDATA = USER_DATA;
const LICENSE_PATH = path.join(USER_DATA, 'license.enc');

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

const { LicenseManager } = await import(
  '../../../dist-electron/premium/electron/services/LicenseManager.js'
);

after(() => {
  Module._resolveFilename = originalResolve;
  globalThis.fetch = originalFetch;
  fs.rmSync(USER_DATA, { recursive: true, force: true });
});

function freshManager() {
  delete globalThis.__nativelyLicenseManagerV1__;
  LicenseManager.instance = undefined;
  return LicenseManager.getInstance();
}

const originalFetch = globalThis.fetch;

/** Duck-typed Response: activateWithApiKey reads only ok/status/json(). */
function reply(status, body, { jsonThrows = false } = {}) {
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (jsonThrows) throw new SyntaxError('Unexpected token < in JSON at position 0');
      return body;
    },
  });
}

beforeEach(() => {
  // No stored license → perpetualLicenseGuard passes and the network path runs.
  fs.rmSync(LICENSE_PATH, { force: true });
});

before(() => {
  assert.equal(
    typeof freshManager().activateWithApiKey,
    'function',
    'precondition failed: compiled LicenseManager did not load',
  );
});

describe('4xx — the server refused the key', () => {
  test('an inactive subscription surfaces the SERVER\'s own next step', async () => {
    reply(403, { ok: false, error: 'subscription_inactive', message: 'Renew at natively.software/api' });

    const r = await freshManager().activateWithApiKey('natively_sk_lapsed');

    assert.equal(r.success, false);
    assert.equal(r.keyRejected, true, 'a 4xx refusal must be distinguishable from a plan verdict');
    assert.equal(r.code, 'subscription_inactive');
    assert.equal(r.status, 403);
    assert.equal(
      r.error,
      'Renew at natively.software/api',
      "the server's account-specific message is the only source that knows the next step — it must not be replaced",
    );
    assert.notEqual(
      r.error,
      'Your plan does not include Natively Pro.',
      'this is the exact misreport from the 2026-08-27 user log',
    );
  });

  test('a refusal with no server message still names an actionable cause', async () => {
    reply(401, { ok: false, error: 'key_not_found' });

    const r = await freshManager().activateWithApiKey('natively_sk_ghost');

    assert.equal(r.keyRejected, true);
    assert.equal(r.code, 'key_not_found');
    assert.match(r.error, /not recognised/i, 'the user must learn the KEY was rejected, not their plan');
  });

  test('a rate-limited refusal reports the retry window', async () => {
    reply(429, { ok: false, error: 'identity_blocked', retry_after: 42 });

    const r = await freshManager().activateWithApiKey('natively_sk_blocked');

    assert.equal(r.keyRejected, true);
    assert.match(r.error, /42/, 'retry_after is the only actionable detail on a 429');
  });
});

describe('200 — the key authenticates, the plan simply has no Pro', () => {
  test('a standard plan is NOT a rejected key', async () => {
    reply(200, { ok: true, has_pro: false, plan: 'standard' });

    const r = await freshManager().activateWithApiKey('natively_sk_standard');

    assert.equal(r.success, false);
    assert.ok(
      !r.keyRejected,
      'CRITICAL: a standard-plan key authenticates against /v1/chat (the server gates only /v1/pro/verify on PRO_PLANS). Marking it rejected would tear down a WORKING configuration.',
    );
    assert.equal(r.error, 'Your plan does not include Natively Pro.');
  });
});

describe('no verdict — nothing may be torn down', () => {
  test('a 5xx is transient, not a statement about the key', async () => {
    reply(503, { error: 'upstream_unavailable' });

    const r = await freshManager().activateWithApiKey('natively_sk_valid');

    assert.equal(r.success, false);
    assert.ok(!r.keyRejected, 'an outage must never be reported as a bad key');
    assert.equal(r.status, 503);
  });

  test('an HTML error page (json() throws) is transient, not "could not reach server"', async () => {
    // A proxy answering 502 with HTML used to throw out of res.json() into the
    // outer catch and be reported as a network failure — wrong for a server that
    // answered, and it hid the status.
    reply(502, null, { jsonThrows: true });

    const r = await freshManager().activateWithApiKey('natively_sk_valid');

    assert.ok(!r.keyRejected);
    assert.equal(r.status, 502, 'the status must survive a body that will not parse');
  });

  test('a 2xx with an unexpected body is not read as a plan verdict', async () => {
    reply(200, { unexpected: true });

    const r = await freshManager().activateWithApiKey('natively_sk_valid');

    assert.equal(r.success, false);
    assert.ok(!r.keyRejected, 'refuse to guess in either direction on a malformed body');
    assert.notEqual(r.error, 'Your plan does not include Natively Pro.');
  });
});

describe('robustness of the success test itself', () => {
  test('a Response-like object with no `ok` property is judged by status, not by the missing field', async () => {
    // This is a real regression, not a hypothetical: the first cut of this fix
    // read `res.ok`, and the existing LicenseNativeModule*.test.mjs doubles
    // return { status, json } with no `ok`. An absent property is falsy, so a
    // plain 200 was read as a 4xx — a VALID pro key reported as refused, which
    // would then tear down the user's working configuration. Response.ok is
    // defined as status in [200,299]; derive it, never read it.
    globalThis.fetch = async () => ({
      status: 200,
      json: async () => ({ ok: true, has_pro: true, plan: 'ultra' }),
    });

    const r = await freshManager().activateWithApiKey('natively_sk_pro');

    assert.ok(!r.keyRejected, 'a 200 with no `ok` field on the Response must never read as a refused key');
    assert.equal(r.success, true);
  });
});

describe('positive control', () => {
  test('a pro plan still activates (the happy path is not collateral damage)', async () => {
    reply(200, { ok: true, has_pro: true, plan: 'pro' });

    const r = await freshManager().activateWithApiKey('natively_sk_pro');

    assert.equal(r.success, true, 'a genuine pro key must still activate');
    assert.ok(!r.keyRejected);
  });
});
