// Any failed call to the Natively API starts the connection check (2026-11-18, #759).
//
// Before, only the Pro check could. A Standard-plan key, a trial, live
// transcription or chat that could not reach us started nothing. The hook sits
// on fetch for the API's origin only, changes nothing about the request or its
// failure, and hands the watcher a description of a network-shaped failure.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { wrapFetchForApiFailures } from '../apiFailureHook.ts';
import https from 'node:https';
import { looksLikeNetworkFailure, settleRetry } from '../connectivityWatcher.ts';

const API = 'https://api.natively.software';
const netError = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code: 'CERT_HAS_EXPIRED' }) });

function rig(original) {
  const seen = [];
  const f = wrapFetchForApiFailures(original, { apiOrigin: API, onFailure: (reason, text) => seen.push({ reason, text }), describe: (e) => `${e.name} · ${e.message} · cause: ${e.cause?.code ?? ''}` });
  return { f, seen };
}

describe('what counts', () => {
  test('a network failure to the API is reported once, as an api_call, and still thrown unchanged', async () => {
    const err = netError();
    const { f, seen } = rig(async () => { throw err; });
    await assert.rejects(() => f(`${API}/v1/usage`), (e) => e === err);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].reason, 'api_call');
    assert.match(seen[0].text, /fetch failed.*CERT_HAS_EXPIRED/);
  });

  test('URL and Request inputs are recognised too', async () => {
    const { f, seen } = rig(async () => { throw netError(); });
    await assert.rejects(() => f(new URL(`${API}/v1/chat`)));
    await assert.rejects(() => f(new Request(`${API}/v1/chat`)));
    assert.equal(seen.length, 2);
  });

  test('any answer is not a network failure, whatever its status', async () => {
    for (const status of [200, 401, 429, 503]) {
      const res = new Response('x', { status });
      const { f, seen } = rig(async () => res);
      assert.equal(await f(`${API}/v1/usage`), res, 'the very same Response');
      assert.equal(seen.length, 0, String(status));
    }
  });

  test('another site failing is none of our business', async () => {
    const { f, seen } = rig(async () => { throw netError(); });
    await assert.rejects(() => f('https://example.com/x'));
    await assert.rejects(() => f(`${API}.evil.com/v1/usage`));
    assert.equal(seen.length, 0);
  });

  test('a cancel or a timeout is not a connection problem', async () => {
    for (const e of [Object.assign(new Error('aborted'), { name: 'AbortError' }), Object.assign(new Error('t'), { name: 'TimeoutError' })]) {
      const { f, seen } = rig(async () => { throw e; });
      await assert.rejects(() => f(`${API}/v1/chat`));
      assert.equal(seen.length, 0, e.name);
    }
  });

  test('background reporting to our own servers is not a trigger', async () => {
    const { f, seen } = rig(async () => { throw netError(); });
    for (const p of ['/v1/telemetry/funnel', '/v1/usage/audit']) await assert.rejects(() => f(`${API}${p}`));
    assert.equal(seen.length, 0);
  });
});

describe('it never makes anything worse', () => {
  test('a callback or description that throws does not change what the caller sees', async () => {
    const err = netError();
    const f = wrapFetchForApiFailures(async () => { throw err; }, { apiOrigin: API, onFailure: () => { throw new Error('x'); }, describe: () => { throw new Error('y'); } });
    await assert.rejects(() => f(`${API}/v1/usage`), (e) => e === err);
  });

  test('arguments reach the original untouched', async () => {
    let got;
    const f = wrapFetchForApiFailures(async (...a) => { got = a; return new Response('x'); }, { apiOrigin: API, onFailure() {}, describe: String });
    const init = { method: 'POST', headers: { a: 'b' } };
    await f(`${API}/v1/chat`, init);
    assert.deepEqual(got, [`${API}/v1/chat`, init]);
    assert.equal(got[1], init);
  });
});

describe('which failure texts the watcher accepts', () => {
  test('the ways Node and the sockets spell a connection failure', () => {
    for (const s of ['TypeError · fetch failed · cause: CERT_HAS_EXPIRED', 'Error · unable to verify the first certificate', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'self signed certificate in certificate chain', 'ECONNRESET', 'ECONNREFUSED', 'EPROTO', 'ENETUNREACH', 'EHOSTUNREACH', 'socket hang up', 'Error: getaddrinfo ENOTFOUND api.natively.software']) {
      assert.equal(looksLikeNetworkFailure(s), true, s);
    }
  });
  test('a status or a refusal is still not one', () => {
    for (const s of ['HTTP 503 · Service Unavailable', 'the server refused the key', 'key REFUSED by server', 'plan lookup answered 429']) assert.equal(looksLikeNetworkFailure(s), false, s);
  });
});

describe('real fetch', () => {
  test('a refused connection and an untrusted certificate are both TypeErrors the hook recognises', async () => {
    const dead = await new Promise((res) => { const sv = https.createServer(); sv.listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => res(p)); }); });
    const seen = [];
    const f = wrapFetchForApiFailures(globalThis.fetch, { apiOrigin: `https://127.0.0.1:${dead}`, onFailure: (r, t) => seen.push(t), describe: (e) => `${e.name} · ${e.message} · cause: ${e.cause?.code ?? ''}` });
    await assert.rejects(() => f(`https://127.0.0.1:${dead}/v1/usage`));
    assert.equal(seen.length, 1);
    assert.match(seen[0], /fetch failed.*ECONNREFUSED/);
    assert.equal(looksLikeNetworkFailure(seen[0]), true);
  });
});

describe('settleRetry: did the retry after the certificate undo get an answer?', () => {
  test('a Pro check that ran decides', async () => {
    assert.equal(await settleRetry(async () => 'activated', async () => { throw new Error('unused'); }), 'activated');
    assert.equal(await settleRetry(async () => 'retrying', async () => true), 'retrying');
  });
  test('nothing to check (no key, or no Pro on the plan): a plain request to Natively stands in', async () => {
    assert.equal(await settleRetry(async () => 'not_needed', async () => true), 'activated');
    assert.equal(await settleRetry(async () => 'not_needed', async () => false), 'retrying');
  });
  test('a Pro check that throws falls back to the plain request', async () => {
    assert.equal(await settleRetry(async () => { throw new Error('x'); }, async () => true), 'activated');
    assert.equal(await settleRetry(async () => { throw new Error('x'); }, async () => { throw new Error('y'); }), 'retrying');
  });
});
