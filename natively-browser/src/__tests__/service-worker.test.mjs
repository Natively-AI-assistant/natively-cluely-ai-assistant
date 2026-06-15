// natively-browser/src/__tests__/service-worker.test.mjs
//
// Tests the pure service-worker core: the loopback POST classifier and the
// pairing-string parser. Imports compiled JS from dist-test/. The chrome.*
// event wiring is import-guarded (hasChrome) so it never runs under node --test.
//
// Run: npm run build:test && node --test src/__tests__/service-worker.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/service-worker.js');
const { postDomToDesktop, parsePairingString } = await import(pathToFileURL(modPath).href);

const PAIRING = { port: 4123, token: 'A'.repeat(32) };

function fakeResponse(status, body) {
  return {
    status,
    json: async () => body,
  };
}

describe('postDomToDesktop', () => {
  test('uses port + token from pairing in the loopback URL', async () => {
    let seenUrl = '';
    let seenInit = null;
    const fetchImpl = async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return fakeResponse(200, { success: true });
    };
    const out = await postDomToDesktop(PAIRING, 'hello', fetchImpl);
    assert.equal(out.kind, 'success');
    assert.match(seenUrl, /^http:\/\/127\.0\.0\.1:4123\/dom\?t=/);
    assert.match(seenUrl, new RegExp('t=' + 'A'.repeat(32)));
    assert.equal(seenInit.method, 'POST');
    assert.equal(seenInit.headers['Content-Type'], 'application/json');
    assert.equal(seenInit.body, JSON.stringify({ dom: 'hello' }));
  });

  test('200 without success:true is an error, not success', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(200, { success: false }));
    assert.equal(out.kind, 'error');
  });

  test('401 maps to unauthorized (triggers re-pair)', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(401, null));
    assert.equal(out.kind, 'unauthorized');
  });

  test('409 maps to no-session (Natively running but no active overlay)', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () =>
      fakeResponse(409, { error: 'no_active_session' }),
    );
    assert.equal(out.kind, 'no-session');
  });

  test('400 maps to bad-request', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(400, null));
    assert.equal(out.kind, 'bad-request');
  });

  test('413 maps to too-large', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(413, null));
    assert.equal(out.kind, 'too-large');
  });

  test('429 maps to rate-limited', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(429, null));
    assert.equal(out.kind, 'rate-limited');
  });

  test('fetch throw (connection refused) maps to refused', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => {
      throw new TypeError('Failed to fetch');
    });
    assert.equal(out.kind, 'refused');
  });

  test('unknown status maps to http-error with the status', async () => {
    const out = await postDomToDesktop(PAIRING, 'x', async () => fakeResponse(500, null));
    assert.equal(out.kind, 'http-error');
    assert.equal(out.status, 500);
  });

  test('the dom payload is the only body — token never appears in body', async () => {
    let bodySeen = '';
    await postDomToDesktop(PAIRING, 'page text', async (_url, init) => {
      bodySeen = init.body;
      return fakeResponse(200, { success: true });
    });
    assert.equal(bodySeen, JSON.stringify({ dom: 'page text' }));
    assert.ok(!bodySeen.includes(PAIRING.token), 'token must not be in the request body');
  });
});

describe('parsePairingString', () => {
  test('parses valid port:token', () => {
    const p = parsePairingString('4123:AbC123_-xyzAbC123_-xyz98765432');
    assert.deepEqual(p, { port: 4123, token: 'AbC123_-xyzAbC123_-xyz98765432' });
  });

  test('trims surrounding whitespace', () => {
    const p = parsePairingString('  4130:' + 'Z'.repeat(32) + '  ');
    assert.equal(p.port, 4130);
    assert.equal(p.token, 'Z'.repeat(32));
  });

  test('rejects missing colon', () => {
    assert.equal(parsePairingString('4123AbC'), null);
  });

  test('rejects non-numeric port', () => {
    assert.equal(parsePairingString('abc:' + 'A'.repeat(32)), null);
  });

  test('rejects out-of-range port', () => {
    assert.equal(parsePairingString('70000:' + 'A'.repeat(32)), null);
  });

  test('rejects too-short token', () => {
    assert.equal(parsePairingString('4123:short'), null);
  });

  test('rejects token with illegal characters', () => {
    assert.equal(parsePairingString('4123:has spaces and !!! chars here xx'), null);
  });
});
